// gate-e2e-ocr-pdf-tools.mjs — Certificación E2E de las 4 herramientas OCR-PDF
// (scannedPdfToSearchablePdf, imageToSearchablePdf, extractTextFromScannedPdf,
// detectOcrNeeded) sobre el deployment real en dist/. Genera PDFs escaneados
// (solo imagen) y con texto real en el navegador con PDFLib, procesa con la UI
// real y valida los resultados descargados: PDF buscable con capa de texto
// extraíble (pdfjs), TXT con el texto OCR y reporte de detección.
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'ocrpdf-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0;
let passes = 0;
const checks = [];
const failureReasons = [];
const consoleErrors = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }

function magic(buf) {
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === '%PDF') return 'pdf';
  if (buf.length > 8 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return 'unknown';
}

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.xml': 'application/xml',
    '.wasm': 'application/wasm', '.traineddata.gz': 'application/octet-stream',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function gotoPage(page, url, slug) {
  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
}

async function upload(page, files) {
  await page.evaluate(() => { const b = document.getElementById('clearFilesButton'); if (b && !b.hidden) b.click(); });
  await page.waitForTimeout(120);
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 30000 });
}

async function waitDialog(page, timeout = 120000) {
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function runTool(page) {
  await page.click('#runButton');
  await waitDialog(page);
}

async function runToolExpectToast(page, expected) {
  await page.click('#runButton');
  try {
    await page.waitForFunction((exp) => {
      const t = document.getElementById('toast');
      return t && t.textContent && t.textContent.includes(exp);
    }, expected, { timeout: 60000 });
    return true;
  } catch (e) {
    return false;
  }
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(100);
}

async function downloadResult(page) {
  const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('#downloadButton');
  const dl = await dlPromise;
  if (!dl) return null;
  const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await dl.saveAs(tmp);
  return readFileSync(tmp);
}

async function resultMessage(page) {
  return page.$eval('#resultMessage', (el) => el.textContent).catch(() => null);
}

async function extractPdfText(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const task = window.pdfjsLib.getDocument({ data: u.slice(0) });
    const pdf = await task.promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      for (const it of tc.items) out += (it.str || '');
      out += '\n';
    }
    return { numPages: pdf.numPages, text: out };
  }, { b64 });
}

/* ── Fixtures OCR-PDF generados con PDFLib real en el navegador ─────────── */

async function genPdfFixtures(page) {
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const OCR_LINES = ['INFORME DE VENTAS', 'Ventas totales: 12500', 'Gastos operativos: 3200', 'GANANCIA NETA: 9300'];
    const OCR_LINES_2 = ['SEGUNDO DOCUMENTO', 'Resultado: 850', 'TOTAL PAGADO'];

    function drawDocCanvas(lines) {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 640;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 84px Arial, Helvetica, sans-serif';
      lines.forEach((ln, i) => ctx.fillText(ln, c.width / 2, 120 + i * 105));
      return c;
    }

    function toJpeg(c) {
      return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.95));
    }

    function bytesToB64(u) {
      let bin = '';
      for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
      return btoa(bin);
    }

    async function makeScannedPdf(canvases) {
      const doc = await PDFDocument.create();
      for (const canvas of canvases) {
        const blob = await toJpeg(canvas);
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const page = doc.addPage([600, 320]);
        page.drawImage(img, { x: 0, y: 0, width: 600, height: 320 });
      }
      return { b64: bytesToB64(await doc.save()), numPages: canvases.length };
    }

    async function makeTextPdf() {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 320]);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const lines = ['INFORME DE VENTAS', 'Ventas totales: 12500', 'Gastos operativos: 3200', 'GANANCIA NETA: 9300', 'Mes de julio', 'Cierre anual'];
      lines.forEach((ln, i) => page.drawText(ln, { x: 40, y: 260 - i * 38, size: 18, font, color: rgb(0, 0, 0) }));
      return { b64: bytesToB64(await doc.save()), numPages: 1 };
    }

    const scanned1 = await makeScannedPdf([drawDocCanvas(OCR_LINES)]);
    const scanned2 = await makeScannedPdf([drawDocCanvas(OCR_LINES), drawDocCanvas(OCR_LINES_2)]);
    const textPdf = await makeTextPdf();
    return { scanned1, scanned2, textPdf };
  });
}

async function genWebpImage(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 400;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 80px Arial, Helvetica, sans-serif';
    ctx.fillText('DOCUMENTO WEBP', c.width / 2, 150);
    ctx.fillText('REF 77', c.width / 2, 260);
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.9));
    const u = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin);
  });
}

async function run() {
  console.log('=== Gate E2E OCR-PDF Tools (4 herramientas) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage(page, url, 'detectar-ocr-pdf');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await page.addScriptTag({ url: `${url}/vendor/pdfjs/pdf.min.js` });
    const fx = await genPdfFixtures(page);
    const scanned1 = Buffer.from(fx.scanned1.b64, 'base64');
    const scanned2 = Buffer.from(fx.scanned2.b64, 'base64');
    const textPdf = Buffer.from(fx.textPdf.b64, 'base64');
    ok(scanned1.length > 500 && magic(scanned1) === 'pdf', 'fixture scanned1.pdf (1 página, solo imagen)', `${scanned1.length} bytes`);
    ok(scanned2.length > 900 && magic(scanned2) === 'pdf', 'fixture scanned2.pdf (2 páginas, solo imagen)', `${scanned2.length} bytes`);
    ok(textPdf.length > 500 && magic(textPdf) === 'pdf', 'fixture text.pdf (con texto real)', `${textPdf.length} bytes`);

    const scanClear = readFileSync(join(root, 'tests', 'fixtures', 'star-flow', 'scan-clear.png'));
    ok(scanClear.length > 1000 && magic(scanClear) === 'png', 'fixture scan-clear.png real (tests/fixtures/star-flow)', `${scanClear.length} bytes`);

    const webp = Buffer.from(await genWebpImage(page), 'base64');
    ok(webp.length > 500 && magic(webp) === 'webp', 'fixture webp.webp generado (imagen WebP)', `${webp.length} bytes`);

    const txtProbe = await extractPdfText(page, fx.textPdf.b64);
    ok(txtProbe.numPages === 1 && /VENTAS/.test(txtProbe.text), 'text.pdf tiene texto real extraíble (pdfjs)', JSON.stringify(txtProbe));
    const scanProbe = await extractPdfText(page, fx.scanned1.b64);
    ok(scanProbe.numPages === 1 && !scanProbe.text.trim(), 'scanned1.pdf NO tiene capa de texto (imagen pura)', JSON.stringify(scanProbe));

    /* ── 1. detectOcrNeeded ────────────────────────────────────────────── */
    console.log('\n--- detectOcrNeeded (detectar-ocr-pdf) ---');
    await gotoPage(page, url, 'detectar-ocr-pdf');
    await upload(page, [{ name: 'scanned1.pdf', mimeType: 'application/pdf', buffer: scanned1 }]);
    await runTool(page);
    const dMsg = await resultMessage(page);
    ok(/1 de 1 página\(s\) necesitan OCR\./.test(dMsg), `detectOcrNeeded scanned: "${dMsg}"`);
    const dBuf = await downloadResult(page);
    if (dBuf) {
      const txt = dBuf.toString('utf8');
      ok(txt.includes('NECESITA OCR'), 'detectOcrNeeded: reporte contiene "NECESITA OCR"', txt.slice(0, 80));
      ok(txt.includes('Páginas que necesitan OCR: 1'), 'detectOcrNeeded: reporte lista página 1', txt.slice(0, 80));
    } else fail('detectOcrNeeded scanned sin archivo');
    await closeDialog(page);

    // Text PDF: no necesita OCR.
    await upload(page, [{ name: 'text.pdf', mimeType: 'application/pdf', buffer: textPdf }]);
    await runTool(page);
    const dMsg2 = await resultMessage(page);
    ok(/El PDF ya tiene texto seleccionable en todas las páginas\./.test(dMsg2), `detectOcrNeeded text: "${dMsg2}"`);
    const dBuf2 = await downloadResult(page);
    if (dBuf2) {
      ok(dBuf2.toString('utf8').includes('No necesita OCR'), 'detectOcrNeeded: reporte "No necesita OCR"', dBuf2.toString('utf8').slice(0, 80));
    } else fail('detectOcrNeeded text sin archivo');
    await closeDialog(page);

    // 2 pages.
    await upload(page, [{ name: 'scanned2.pdf', mimeType: 'application/pdf', buffer: scanned2 }]);
    await runTool(page);
    const dMsg3 = await resultMessage(page);
    ok(/2 de 2 página\(s\) necesitan OCR\./.test(dMsg3), `detectOcrNeeded scanned2: "${dMsg3}"`);
    await closeDialog(page);

    /* ── 2. extractTextFromScannedPdf ──────────────────────────────────── */
    console.log('\n--- extractTextFromScannedPdf (extraer-texto-pdf-escaneado) ---');
    await gotoPage(page, url, 'extraer-texto-pdf-escaneado');
    await page.waitForSelector('#ocrLanguage', { timeout: 8000, state: 'attached' });
    pass('extractTextFromScannedPdf: control ocrLanguage visible');
    await upload(page, [{ name: 'scanned1.pdf', mimeType: 'application/pdf', buffer: scanned1 }]);
    await runTool(page);
    const eMsg = await resultMessage(page);
    ok(/Texto extraído de 1 página\(s\)\./.test(eMsg), `extractTextFromScannedPdf message: "${eMsg}"`);
    const eBuf = await downloadResult(page);
    if (eBuf) {
      const txt = eBuf.toString('utf8');
      ok(txt.includes('INFORME') && txt.includes('9300'), 'extractTextFromScannedPdf: TXT con texto OCR real', txt.slice(0, 90).replace(/\n/g, ' '));
    } else fail('extractTextFromScannedPdf sin archivo');
    await closeDialog(page);

    /* ── 3. scannedPdfToSearchablePdf ──────────────────────────────────── */
    console.log('\n--- scannedPdfToSearchablePdf (pdf-escaneado-a-pdf-buscable) ---');
    await gotoPage(page, url, 'pdf-escaneado-a-pdf-buscable');
    await page.waitForSelector('#ocrLanguage', { timeout: 8000, state: 'attached' });
    await page.waitForSelector('#ocrPages', { timeout: 8000, state: 'attached' });
    pass('scannedPdfToSearchablePdf: controles ocrLanguage + ocrPages visibles');
    await upload(page, [{ name: 'scanned1.pdf', mimeType: 'application/pdf', buffer: scanned1 }]);
    await runTool(page, 180000);
    const sMsg = await resultMessage(page);
    ok(/PDF buscable creado: 1 página\(s\) procesada\(s\)/.test(sMsg), `scannedPdfToSearchablePdf message: "${sMsg}"`);
    const sBuf = await downloadResult(page);
    if (sBuf) {
      ok(magic(sBuf) === 'pdf', 'scannedPdfToSearchablePdf: salida PDF real (magic)', magic(sBuf));
      const sProbe = await extractPdfText(page, toBase64(sBuf));
      ok(sProbe.numPages === 1, 'scannedPdfToSearchablePdf: PDF de 1 página', JSON.stringify(sProbe));
      ok(sProbe.text.includes('INFORME') && sProbe.text.includes('9300'), 'scannedPdfToSearchablePdf: capa de texto buscable extraíble', sProbe.text.slice(0, 90).replace(/\n/g, ' '));
    } else fail('scannedPdfToSearchablePdf sin archivo');
    await closeDialog(page);

    // PDF ya con texto: no debe generar nada (toast).
    await upload(page, [{ name: 'text.pdf', mimeType: 'application/pdf', buffer: textPdf }]);
    const sNegOk = await runToolExpectToast(page, 'El PDF ya tiene texto seleccionable. No necesita OCR.');
    ok(sNegOk, 'scannedPdfToSearchablePdf text: mensaje toast "ya tiene texto" sin generar archivo');
    await page.waitForTimeout(400);

    // Opción de páginas: solo procesa la página 2 de scanned2.
    await upload(page, [{ name: 'scanned2.pdf', mimeType: 'application/pdf', buffer: scanned2 }]);
    await page.fill('#ocrPages', '2');
    await runTool(page, 180000);
    const sMsg2 = await resultMessage(page);
    ok(/PDF buscable creado: 1 página\(s\) procesada\(s\)/.test(sMsg2), `scannedPdfToSearchablePdf ocrPages=2 (solo página 2): "${sMsg2}"`);
    const sBuf2 = await downloadResult(page);
    if (sBuf2) {
      const sProbe2 = await extractPdfText(page, toBase64(sBuf2));
      ok(sProbe2.numPages === 1, 'scannedPdfToSearchablePdf ocrPages=2: PDF con la página procesada', JSON.stringify(sProbe2));
      ok(sProbe2.text.includes('SEGUNDO') || sProbe2.text.includes('850'), 'scannedPdfToSearchablePdf ocrPages=2: texto de la página 2', sProbe2.text.slice(0, 90).replace(/\n/g, ' '));
    } else fail('scannedPdfToSearchablePdf ocrPages=2 sin archivo');
    await closeDialog(page);

    /* ── 4. imageToSearchablePdf ───────────────────────────────────────── */
    console.log('\n--- imageToSearchablePdf (imagen-a-pdf-buscable) ---');
    await gotoPage(page, url, 'imagen-a-pdf-buscable');
    await page.waitForSelector('#ocrLanguage', { timeout: 8000, state: 'attached' });
    pass('imageToSearchablePdf: control ocrLanguage visible');
    await upload(page, [{ name: 'scan-clear.png', mimeType: 'image/png', buffer: scanClear }]);
    await runTool(page, 180000);
    const iMsg = await resultMessage(page);
    ok(/Se procesaron 1 imagen\(es\) a PDF buscable\./.test(iMsg), `imageToSearchablePdf message: "${iMsg}"`);
    const iBuf = await downloadResult(page);
    if (iBuf) {
      ok(magic(iBuf) === 'pdf', 'imageToSearchablePdf: salida PDF real (magic)', magic(iBuf));
      // pdf.js es deliberadamente ajeno a esta herramienta: solo el oráculo
      // de la prueba lo necesita para leer la capa de texto producida.
      await page.addScriptTag({ url: `${url}/vendor/pdfjs/pdf.min.js` });
      const iProbe = await extractPdfText(page, toBase64(iBuf));
      ok(iProbe.numPages === 1, 'imageToSearchablePdf: PDF de 1 página', JSON.stringify(iProbe));
      ok(iProbe.text.includes('Ventas') && iProbe.text.includes('150'), 'imageToSearchablePdf: OCR real del fixture (Ventas/150)', iProbe.text.slice(0, 120).replace(/\n/g, ' '));
    } else fail('imageToSearchablePdf sin archivo');
    await closeDialog(page);

    // Rama WebP (fix: embed via canvas → JPEG).
    await upload(page, [{ name: 'webp.webp', mimeType: 'image/webp', buffer: webp }]);
    await runTool(page, 180000);
    const iMsg2 = await resultMessage(page);
    ok(/Se procesaron 1 imagen\(es\) a PDF buscable\./.test(iMsg2), `imageToSearchablePdf WebP message: "${iMsg2}"`);
    const iBuf2 = await downloadResult(page);
    if (iBuf2) {
      const iProbe2 = await extractPdfText(page, toBase64(iBuf2));
      ok(iProbe2.text.includes('DOCUMENTO') || iProbe2.text.includes('REF'), 'imageToSearchablePdf WebP: OCR real del WebP (fix embed)', iProbe2.text.slice(0, 90).replace(/\n/g, ' '));
    } else fail('imageToSearchablePdf WebP sin archivo');
    await closeDialog(page);

    /* ── Consola ───────────────────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola en toda la suite');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-ocr-pdf-tools',
    updatedAt: new Date().toISOString(),
    tools: ['scannedPdfToSearchablePdf', 'imageToSearchablePdf', 'extractTextFromScannedPdf', 'detectOcrNeeded'],
    fixes: [
      'app.js: htmlByTool (idioma + páginas), optionAliases (ocrLanguage/ocrPages) y validateToolFiles para las 4 herramientas; accepts pdf→pdfs para aceptar PDF en el input.',
      'js/ocr/pdf-ocr-engine.js loadPdf y extractTextFromScannedPdf: pdfjs detachaba el ArrayBuffer al reutilizar el buffer (detectNeedsOcr → renderPageToCanvas) → slice(0).',
      'tool-processors imageToSearchablePdf: incrusta la imagen vía canvas → JPEG (antes el blob original rompía con WebP/BMP/GIF/TIFF en embedPng/embedJpg).',
    ],
    excluded: {},
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-ocr-pdf-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
