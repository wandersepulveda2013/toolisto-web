/**
 * core/pdf-images.js — Normalización de imágenes para PDF compartida.
 *
 * El generador PDF solo embebe JPEG (DCTDecode). Este helper re-encoda las
 * secciones de imagen PNG/WebP/SVG a JPEG en canvas cuando hay DOM (navegador)
 * y conserva las secciones tal cual en un entorno sin canvas. Es la única
 * vía de re-encode JPEG por ruta, reutilizada por el flujo `document.to-pdf`
 * (core/workflow-operations.js) y por la ruta de diseños `preparePdfImages`
 * (workspace.js), evitando duplicar el re-encode y sus regresiones de
 * calidad/tamaño.
 */

function loadPdfImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo preparar una imagen del informe'));
    img.src = src;
  });
}

/**
 * Re-encoda las secciones de imagen no JPEG a JPEG (0.9) en canvas.
 *
 * @param {Array} sections Secciones del PDF.
 * @param {Object} [options]
 * @param {boolean} [options.updateSize] Actualizar width/height a las
 *   dimensiones del canvas (usado por el flujo document.to-pdf).
 * @param {Function} [options.onError] Callback de error (usado por la ruta
 *   de diseño para reportError); si no se provee, la sección se conserva.
 * @returns {Promise<Array>} Secciones listas para generatePDF.
 */
export async function normalizePdfImageSections(sections, options = {}) {
  const { updateSize = false, onError } = options;
  if (typeof Image === 'undefined' || typeof document === 'undefined') return sections;
  const ready = [];
  for (const section of sections) {
    const dataUrl = String(section && section.dataUrl || '');
    if (!section || section.type !== 'image' || !/^data:image\//i.test(dataUrl) || /^data:image\/jpe?g;base64,/i.test(dataUrl)) {
      ready.push(section);
      continue;
    }
    try {
      const image = await loadPdfImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const next = { ...section, dataUrl: canvas.toDataURL('image/jpeg', 0.9) };
      if (updateSize) {
        next.width = canvas.width;
        next.height = canvas.height;
      }
      ready.push(next);
    } catch (error) {
      if (onError) onError(error);
      ready.push(section);
    }
  }
  return ready;
}