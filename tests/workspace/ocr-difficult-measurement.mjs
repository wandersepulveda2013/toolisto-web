#!/usr/bin/env node
/**
 * OCR Difficult Fixture Measurement — medir honestamente la precision de
 * Tesseract (modelo local spa) sobre scan-difficult.png.
 *
 * El fixture comparte expected-ocr.txt con scan-clear.png y degrada la
 * captura de forma reproducible (12px, bajo contraste, reduccion, blur,
 * ruido). No se define ningun umbral reducido: el resultado se registra tal
 * cual, incluso si la precision es baja.
 *
 * Desde 2026-08-02 extractTextFromScan ya NO hace upscale (el upscale >=800px
 * degradaba imagenes ruidosas y producia el artefacto 1-30 en el limpio).
 * El modo "upscale" de este script queda solo como referencia historica.
 *
 * Desde 2026-08-03 el pipeline usa OEM 3 (DEFAULT: LSTM + legacy) en
 * vendor/js/engine-loader.js: el fixture dificil sube a 76% chars / 43% words
 * (confianza 62%) SIN degradar el limpio (sigue 100/100).
 *
 * Metodo de precision: distancia de Levenshtein sobre texto normalizado,
 * identico al usado por phase3c-star-flow.spec.mjs (99% chars / 96% words
 * en el fixture limpio).
 *
 * El script también mide candidatos acotados de preproceso y segmentación.
 * Sirven para descartar regresiones antes de incorporarlos al pipeline real;
 * ningún candidato se activa sin superar a la vía cruda y preservar el control
 * limpio.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'star-flow');
const ARTIFACTS = join(ROOT, 'artifacts', 'phase3c-validation');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

let _srv;
function startServer() {
  return new Promise((resolve, reject) => {
    _srv = createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/index.html';
      let fp = join(DIST, file);
      if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(DIST, file + '.html');
      const ext = extname(fp).toLowerCase();
      const data = readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}
function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

function normalizeText(s) { return (s || '').replace(/\r\n/g, '\n').replace(/ +/g, ' ').trim(); }
function editDistance(expected, actual) {
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let i = 1; i <= expected.length; i++) {
    const current = [i];
    for (let j = 1; j <= actual.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[actual.length];
}
function charAccuracy(expected, actual) {
  const a = normalizeText(expected), b = normalizeText(actual);
  const edits = editDistance(a, b);
  if (a.length === 0) return { expected: 0, matched: 0, edits, pct: b.length === 0 ? 100 : 0 };
  const matched = Math.max(0, a.length - edits);
  return { expected: a.length, matched, edits, pct: Math.round(matched * 100 / a.length) };
}
function wordAccuracy(expected, actual) {
  const aWords = normalizeText(expected).split(/\s+/).filter(Boolean);
  const bWords = normalizeText(actual).split(/\s+/).filter(Boolean);
  const edits = editDistance(aWords, bWords);
  const matched = Math.max(0, aWords.length - edits);
  return { expected: aWords.length, matched, edits, pct: aWords.length > 0 ? Math.round(matched * 100 / aWords.length) : (bWords.length === 0 ? 100 : 0) };
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);

  const difficultPath = join(FIXTURES, 'scan-difficult.png');
  const clearPath = join(FIXTURES, 'scan-clear.png');
  if (!existsSync(difficultPath)) { console.error('Missing fixture:', difficultPath); process.exit(1); }
  const expectedText = readFileSync(join(FIXTURES, 'expected-ocr.txt'), 'utf8');
  const difficultDataUrl = 'data:image/png;base64,' + readFileSync(difficultPath).toString('base64');
  const clearDataUrl = 'data:image/png;base64,' + readFileSync(clearPath).toString('base64');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 20000 });

  async function runOcr(dataUrl, preprocessing, pageSegmentationMode) {
    return page.evaluate(async ({ src, preprocessing, pageSegmentationMode }) => {
      const img = new Image();
      img.src = src;
      await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('img load fail')); });
      let canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      if (preprocessing === 'upscale800') {
        const MIN_OCR_DIM = 800;
        if (canvas.width < MIN_OCR_DIM || canvas.height < MIN_OCR_DIM) {
          const scale = Math.max(MIN_OCR_DIM / canvas.width, MIN_OCR_DIM / canvas.height);
          const scaledW = Math.round(canvas.width * scale);
          const scaledH = Math.round(canvas.height * scale);
          const scaled = document.createElement('canvas');
          scaled.width = scaledW;
          scaled.height = scaledH;
          const sctx = scaled.getContext('2d');
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(canvas, 0, 0, scaledW, scaledH);
          canvas = scaled;
        }
      }
      if (preprocessing === 'contrast') {
        const ctx = canvas.getContext('2d');
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const gray = 0.299 * pixels.data[index] + 0.587 * pixels.data[index + 1] + 0.114 * pixels.data[index + 2];
          const enhanced = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.8 + 128)));
          pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = enhanced;
        }
        ctx.putImageData(pixels, 0, 0);
      }
      if (preprocessing === 'threshold') {
        const ctx = canvas.getContext('2d');
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const gray = 0.299 * pixels.data[index] + 0.587 * pixels.data[index + 1] + 0.114 * pixels.data[index + 2];
          const value = gray < 170 ? 0 : 255;
          pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
        }
        ctx.putImageData(pixels, 0, 0);
      }
      if (typeof window.EngineLoader === 'undefined' || !window.EngineLoader.loadTesseract) {
        return { text: '', confidence: 0, error: 'Tesseract not available' };
      }
      const worker = await window.EngineLoader.loadTesseract('spa', () => {});
      if (pageSegmentationMode) {
        await worker.setParameters({ tessedit_pageseg_mode: String(pageSegmentationMode) });
      }
      const result = await worker.recognize(canvas);
      return {
        text: (result.data.text || '').trim(),
        confidence: result.data.confidence || 0,
        width: canvas.width,
        height: canvas.height,
        charCount: result.data.text?.length || 0,
      };
    }, { src: dataUrl, preprocessing, pageSegmentationMode });
  }

  const evidence = {
    fixture: { path: 'tests/fixtures/star-flow/scan-difficult.png' },
    method: 'Levenshtein edit distance (mismo metodo que phase3c-star-flow.spec.mjs)',
    expectedText,
  };

  console.log('=== OCR Difficult Fixture Measurement ===\n');
  console.log('--- Referencia: scan-clear.png (control) ---');
  console.log('    (extractTextFromScan ya NO hace upscale: el pipeline real coincide con esta via)');
  const clearResult = await runOcr(clearDataUrl, 'raw');
  evidence.clearOcr = {
    ...clearResult,
    pipeline: 'raw',
    charAccuracy: charAccuracy(expectedText, clearResult.text),
    wordAccuracy: wordAccuracy(expectedText, clearResult.text),
  };
  console.log(`  Char: ${evidence.clearOcr.charAccuracy.matched}/${evidence.clearOcr.charAccuracy.expected} = ${evidence.clearOcr.charAccuracy.pct}%`);
  console.log(`  Word: ${evidence.clearOcr.wordAccuracy.matched}/${evidence.clearOcr.wordAccuracy.expected} = ${evidence.clearOcr.wordAccuracy.pct}%`);
  console.log(`  Text: ${JSON.stringify(clearResult.text)}\n`);

  console.log('--- Fixture: scan-difficult.png (via pipeline actual: sin upscale) ---');
  const diffRaw = await runOcr(difficultDataUrl, 'raw');
  evidence.difficultPipeline = {
    ...diffRaw,
    pipeline: 'raw',
    charAccuracy: charAccuracy(expectedText, diffRaw.text),
    wordAccuracy: wordAccuracy(expectedText, diffRaw.text),
  };
  console.log(`  Dimensions: ${diffRaw.width}x${diffRaw.height}`);
  console.log(`  Confidence: ${diffRaw.confidence}%`);
  console.log(`  Char accuracy: ${evidence.difficultPipeline.charAccuracy.matched}/${evidence.difficultPipeline.charAccuracy.expected} = ${evidence.difficultPipeline.charAccuracy.pct}%`);
  console.log(`  Word accuracy: ${evidence.difficultPipeline.wordAccuracy.matched}/${evidence.difficultPipeline.wordAccuracy.expected} = ${evidence.difficultPipeline.wordAccuracy.pct}%`);
  console.log(`  Text: ${JSON.stringify(diffRaw.text)}\n`);

  console.log('--- Fixture: scan-difficult.png (referencia: upscale >=800px, ELIMINADO del pipeline) ---');
  const diffPipe = await runOcr(difficultDataUrl, 'upscale800');
  evidence.difficultLegacyUpscale = {
    ...diffPipe,
    pipeline: 'upscale800',
    charAccuracy: charAccuracy(expectedText, diffPipe.text),
    wordAccuracy: wordAccuracy(expectedText, diffPipe.text),
  };
  console.log(`  Dimensions: ${diffPipe.width}x${diffPipe.height}`);
  console.log(`  Confidence: ${diffPipe.confidence}%`);
  console.log(`  Char accuracy: ${evidence.difficultLegacyUpscale.charAccuracy.matched}/${evidence.difficultLegacyUpscale.charAccuracy.expected} = ${evidence.difficultLegacyUpscale.charAccuracy.pct}%`);
  console.log(`  Word accuracy: ${evidence.difficultLegacyUpscale.wordAccuracy.matched}/${evidence.difficultLegacyUpscale.wordAccuracy.expected} = ${evidence.difficultLegacyUpscale.wordAccuracy.pct}%`);
  console.log(`  Text: ${JSON.stringify(diffPipe.text)}`);

  for (const preprocessing of ['contrast', 'threshold']) {
    console.log(`\n--- Fixture: scan-difficult.png (experimento: ${preprocessing}) ---`);
    const result = await runOcr(difficultDataUrl, preprocessing);
    const key = `difficult${preprocessing[0].toUpperCase()}${preprocessing.slice(1)}`;
    evidence[key] = {
      ...result,
      pipeline: preprocessing,
      charAccuracy: charAccuracy(expectedText, result.text),
      wordAccuracy: wordAccuracy(expectedText, result.text),
    };
    console.log(`  Char accuracy: ${evidence[key].charAccuracy.pct}%`);
    console.log(`  Word accuracy: ${evidence[key].wordAccuracy.pct}%`);
    console.log(`  Text: ${JSON.stringify(result.text)}`);
  }

  for (const pageSegmentationMode of [4, 6, 11]) {
    console.log(`\n--- Fixture: scan-difficult.png (experimento: PSM ${pageSegmentationMode}) ---`);
    const result = await runOcr(difficultDataUrl, 'raw', pageSegmentationMode);
    const key = `difficultPsm${pageSegmentationMode}`;
    evidence[key] = {
      ...result,
      pipeline: `raw-psm${pageSegmentationMode}`,
      charAccuracy: charAccuracy(expectedText, result.text),
      wordAccuracy: wordAccuracy(expectedText, result.text),
    };
    console.log(`  Char accuracy: ${evidence[key].charAccuracy.pct}%`);
    console.log(`  Word accuracy: ${evidence[key].wordAccuracy.pct}%`);
    console.log(`  Text: ${JSON.stringify(result.text)}`);
  }

  evidence.summary = {
    clearCharPct: evidence.clearOcr.charAccuracy.pct,
    clearWordPct: evidence.clearOcr.wordAccuracy.pct,
    difficultPipelineCharPct: evidence.difficultPipeline.charAccuracy.pct,
    difficultPipelineWordPct: evidence.difficultPipeline.wordAccuracy.pct,
    difficultLegacyUpscaleCharPct: evidence.difficultLegacyUpscale.charAccuracy.pct,
    difficultLegacyUpscaleWordPct: evidence.difficultLegacyUpscale.wordAccuracy.pct,
    note: 'Medicion honesta sin umbral reducido. extractTextFromScan ya NO hace upscale (el upscale >=800px degradaba imagenes ruidosas y producia el artefacto 1-30 en el fixture limpio). Pipeline con OEM 3 (DEFAULT: LSTM + legacy) desde 2026-08-03.',
  };
  evidence.summary.experiments = {
    contrast: evidence.difficultContrast.charAccuracy.pct,
    threshold: evidence.difficultThreshold.charAccuracy.pct,
    psm4: evidence.difficultPsm4.charAccuracy.pct,
    psm6: evidence.difficultPsm6.charAccuracy.pct,
    psm11: evidence.difficultPsm11.charAccuracy.pct,
  };
  evidence.summary.note += ' Los experimentos contrast, umbral y PSM 4/6/11 se registran para impedir activar un candidato que degrade la referencia cruda.';

  const out = join(ARTIFACTS, 'fixture-difficult-measurement.json');
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence saved to: artifacts/phase3c-validation/fixture-difficult-measurement.json`);

  await browser.close();
  await stopServer();
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
