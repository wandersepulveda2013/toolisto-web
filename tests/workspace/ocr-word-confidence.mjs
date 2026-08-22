#!/usr/bin/env node
/**
 * OCR Word Confidence Measurement — mide la confianza POR PALABRA de
 * Tesseract (modelo local spa) sobre scan-clear.png y scan-difficult.png.
 *
 * Objetivo: calibrar el umbral OCR_LOW_CONFIDENCE y verificar que el fixture
 * limpio queda con confianza alta (sin bloqueos espurios) mientras que el
 * fixture dificil expone celdas de baja confianza.
 *
 * Port: E2E_PORT env var or 8082
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
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit', 'workspace-baseline');
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

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => typeof window.EngineLoader !== 'undefined', null, { timeout: 20000 }).catch(() => {});

  async function runOcr(dataUrl) {
    return page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('img load fail')); });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      if (typeof window.EngineLoader === 'undefined' || !window.EngineLoader.loadTesseract) {
        return { text: '', confidence: 0, error: 'Tesseract not available' };
      }
      const worker = await window.EngineLoader.loadTesseract('spa', () => {});
      const result = await worker.recognize(canvas);
      const words = Array.isArray(result.data.words)
        ? result.data.words.map(w => ({ text: String(w.text || ''), confidence: Math.round(Number(w.confidence) || 0) }))
        : [];
      return {
        text: (result.data.text || '').trim(),
        confidence: result.data.confidence || 0,
        wordCount: words.length,
        words,
      };
    }, dataUrl);
  }

  const clearPath = join(FIXTURES, 'scan-clear.png');
  const diffPath = join(FIXTURES, 'scan-difficult.png');
  const clearDataUrl = 'data:image/png;base64,' + readFileSync(clearPath).toString('base64');
  const diffDataUrl = 'data:image/png;base64,' + readFileSync(diffPath).toString('base64');

  const evidence = { timestamp: new Date().toISOString(), threshold: 85 };
  console.log('=== OCR Word Confidence Measurement ===\n');

  console.log('--- scan-clear.png ---');
  const clearResult = await runOcr(clearDataUrl);
  const clearLow = clearResult.words.filter(w => w.confidence < 85);
  console.log(`  Global confidence: ${clearResult.confidence}%`);
  console.log(`  Words: ${clearResult.wordCount}`);
  console.log(`  Words < 85: ${clearLow.length}`);
  clearLow.forEach(w => console.log(`    LOW ${w.confidence}: ${JSON.stringify(w.text)}`));
  evidence.clear = {
    globalConfidence: clearResult.confidence,
    wordCount: clearResult.wordCount,
    lowCount: clearLow.length,
    words: clearResult.words,
  };

  console.log('\n--- scan-difficult.png ---');
  const diffResult = await runOcr(diffDataUrl);
  const diffLow = diffResult.words.filter(w => w.confidence < 85);
  console.log(`  Global confidence: ${diffResult.confidence}%`);
  console.log(`  Words: ${diffResult.wordCount}`);
  console.log(`  Words < 85: ${diffLow.length}`);
  diffLow.forEach(w => console.log(`    LOW ${w.confidence}: ${JSON.stringify(w.text)}`));
  evidence.difficult = {
    globalConfidence: diffResult.confidence,
    wordCount: diffResult.wordCount,
    lowCount: diffLow.length,
    words: diffResult.words,
  };

  const out = join(ARTIFACTS, 'ocr-word-confidence.json');
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence saved to: ${out}`);

  await browser.close();
  await stopServer();
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
