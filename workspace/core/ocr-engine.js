// core/ocr-engine.js — Motor OCR compartido del Workspace (Tesseract.js via EngineLoader).
//
// Extrae la logica de extraccion de texto OCR que vivia duplicada en
// workspace.js (extractTextFromScan) y en core/workflow-operations.js
// (operacion image.ocr) a un unico punto canonico.
//
// Pipeline actual: reconocimiento sobre el canvas CRUDO (sin upscale; el
// upscale >=800px degradaba imagenes ruidosas) con OEM 3 (DEFAULT: LSTM +
// legacy, Tesseract elige el mejor por bloque) configurado en
// vendor/js/engine-loader.js (createWorker(lang, 3, {...})).
//
// Los PDF del sitio público usan js/ocr/pdf-ocr-engine.js como adaptador de
// script clásico: no puede importar este módulo sin añadir el bundle completo
// del Workspace a las 167 rutas públicas. La frontera y el contrato paralelo
// se certifican en tests/pdf-ocr-architecture.mjs.

export function isOcrEngineAvailable() {
  return typeof window.EngineLoader !== 'undefined' &&
    typeof window.EngineLoader.loadTesseract === 'function';
}

export function loadOcrEngine(lang, onProgress) {
  if (!isOcrEngineAvailable()) {
    throw new Error('OCR engine not available (Tesseract.js not loaded)');
  }
  return window.EngineLoader.loadTesseract(lang || 'spa', onProgress);
}

export function releaseOcrEngine(lang) {
  if (typeof window.EngineLoader !== 'undefined' &&
      typeof window.EngineLoader.releaseTesseract === 'function') {
    return window.EngineLoader.releaseTesseract(lang);
  }
  return false;
}

export function loadCanvasFromImageSource(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({ canvas, width: canvas.width, height: canvas.height });
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

export async function recognizeText(canvas, options = {}) {
  const lang = options.lang || 'spa';
  const onProgress = options.onProgress || (() => {});
  const onPhase = options.onPhase || (() => {});
  onPhase('loading');
  const worker = await loadOcrEngine(lang, onProgress);
  onPhase('recognizing');
  const result = await worker.recognize(canvas);
  const data = (result && result.data) || {};
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  const confidence = Number(data.confidence) || 0;
  const words = Array.isArray(data.words)
    ? data.words
      .map(w => ({ text: String(w.text || '').trim(), confidence: Math.round(Number(w.confidence) || 0) }))
      .filter(w => w.text)
    : [];
  return { text, confidence, words };
}
