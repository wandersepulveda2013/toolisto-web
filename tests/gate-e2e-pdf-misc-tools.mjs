// gate-e2e-pdf-misc-tools.mjs — Certificación E2E de 8 herramientas (PDF + miscelánea)
// sobre el deployment real en dist/. Genera fixtures en el navegador (PDFLib, canvas) y en
// Node (JPEG con EXIF GPS), procesa con la UI real y valida los resultados descargados.
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'pdfmisc-dl');
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

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.xml': 'application/xml',
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

/* ── Helpers de navegador ─────────────────────────────────────────────── */

async function gotoPage(page, url, slug) {
  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 20000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      disabled: document.getElementById('runButton')?.disabled,
      status: document.getElementById('fileStatus')?.textContent,
      feedback: document.getElementById('processFeedbackMessage')?.textContent,
      toast: document.getElementById('toast')?.textContent,
      selectedTool: window.__selectedTool,
      description: document.getElementById('smartDescription')?.textContent,
    }));
    error.message += `\nEstado de carga: ${JSON.stringify(state)}`;
    throw error;
  });
}

async function waitDialog(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function runTool(page) {
  await page.click('#runButton');
  try {
    await waitDialog(page);
  } catch (err) {
    const snapshot = await page.evaluate(() => ({
      runDisabled: document.getElementById('runButton') ? document.getElementById('runButton').disabled : null,
      resultMessage: document.getElementById('resultMessage') ? document.getElementById('resultMessage').textContent : null,
      resultTitle: document.getElementById('resultTitle') ? document.getElementById('resultTitle').textContent : null,
    })).catch(() => null);
    console.error('  [runTool timeout] snapshot:', JSON.stringify(snapshot));
    console.error('  [runTool timeout] consoleErrors:', JSON.stringify(consoleErrors.slice(-10)));
    throw err;
  }
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(120);
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

async function readText(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
}

async function zipEntries(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const out = [];
    for (const name of Object.keys(zip.files)) {
      const f = zip.files[name];
      if (f.dir) continue;
      const c = await f.async('uint8array');
      out.push({ name, size: c.length });
    }
    return out;
  }, { b64 });
}

async function zipEntryText(page, b64, entryName) {
  return page.evaluate(async ({ b64, entry }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const f = zip.file(entry);
    if (!f) return null;
    const c = await f.async('uint8array');
    return new TextDecoder('utf-8').decode(c);
  }, { b64, entry: entryName });
}

/* ── Fixtures generados en el navegador ───────────────────────────────── */

// PDFLib ya no forma parte del payload inicial de las herramientas. El fixture
// sigue siendo real, pero carga su generador explícitamente en esta página de
// preparación, igual que una dependencia de desarrollo.
async function loadFixturePdfLib(page, url) {
  await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
}

// PDF de 2 páginas: página 1 con tabla de 3 columnas x 3 filas + texto de censura.
async function genPdfMain(page) {
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle('Documento confidencial');
    doc.setAuthor('Autor Original');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page1 = doc.addPage([595, 842]);
    const table = [
      ['Producto', 'Cantidad', 'Precio'],
      ['Manzanas', '3', '1.50'],
      ['Peras', '2', '2.25'],
    ];
    let y = 720;
    for (const row of table) {
      let x = 60;
      for (const cell of row) {
        page1.drawText(String(cell), { x, y, size: 12, font });
        x += 130;
      }
      y -= 40;
    }
    page1.drawText('Este documento contiene datos SECRETO internos de la empresa.', { x: 60, y: 140, size: 12, font });
    page1.drawText('SECRETO', { x: 60, y: 120, size: 14, font, color: rgb(0, 0, 0) });
    const page2 = doc.addPage([595, 842]);
    page2.drawText('Segunda página de contexto sin datos sensibles.', { x: 60, y: 700, size: 12, font });
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// PDF A para comparePdfs: página 1 "Versión A", página 2 "Común".
async function genPdfVersionA(page) {
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([595, 842]);
    p1.drawText('Version A del informe', { x: 60, y: 700, size: 12, font });
    const p2 = doc.addPage([595, 842]);
    p2.drawText('Pagina comun a ambas versiones', { x: 60, y: 700, size: 12, font });
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// PDF B para comparePdfs: página 1 diferente, página 2 igual.
async function genPdfVersionB(page) {
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([595, 842]);
    p1.drawText('Version B del informe modificada', { x: 60, y: 700, size: 12, font });
    const p2 = doc.addPage([595, 842]);
    p2.drawText('Pagina comun a ambas versiones', { x: 60, y: 700, size: 12, font });
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// Imagen PNG para cameraDocumentScanner (rectángulo gris + texto).
async function genCameraImage(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#000';
    ctx.font = '24px sans-serif';
    ctx.fillText('DOCUMENTO DE PRUEBA', 24, 110);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// Imagen PNG con tabla para imageTableToExcel (texto grande y separado para OCR spa).
async function genTableImage(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 260;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 640, 260);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 40px sans-serif';
    const rows = ['Nombre   Cantidad   Total', 'Ana   5   10', 'Luis   3   6'];
    rows.forEach((line, i) => ctx.fillText(line, 24, 80 + i * 72));
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// JPEG base (1×1) generado en el navegador; sin el SOI (FFD8) para insertar APP1 EXIF.
async function genBaseJpegBody(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 4, 4);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 2; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

/* ── Fixture JPEG con EXIF GPS (construido en Node) ───────────────────── */

function buildJpegWithExif(bodyWithoutSoi) {
  // tiffStart = SOI(2) + APP1(marker+len, 4) + 'Exif\0\0'(6) = 12 bytes.
  // El parser photo-location.js lee las cadenas y racionales en offset ABSOLUTO
  // (valueOffset = valueRaw) y los punteros de IFD como relativos a tiffStart.
  const tiffStart = 12;
  const abs = (rel) => tiffStart + rel;
  const tiff = Buffer.alloc(240);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  const writeEntry = (off, tag, type, count, valueOrInline) => {
    tiff.writeUInt16LE(tag, off);
    tiff.writeUInt16LE(type, off + 2);
    tiff.writeUInt32LE(count, off + 4);
    if (Buffer.isBuffer(valueOrInline)) {
      valueOrInline.copy(tiff, off + 8);
    } else {
      tiff.writeUInt32LE(valueOrInline >>> 0, off + 8);
    }
  };

  // IFD0 (rel 8): Make, Model, DateTimeOriginal, ExifIFDPointer.
  tiff.writeUInt16LE(4, 8);
  let e = 10;
  writeEntry(e, 0x010F, 2, 6, abs(62)); e += 12;
  writeEntry(e, 0x0110, 2, 7, abs(68)); e += 12;
  writeEntry(e, 0x9003, 2, 20, abs(76)); e += 12;
  writeEntry(e, 0x8769, 4, 1, 96); e += 12;
  tiff.writeUInt32LE(0, e); e += 4;

  tiff.write('Maker\0', 62, 'latin1');
  tiff.write('PhoneX\0', 68, 'latin1');
  tiff.write('2026:01:02 03:04:05\0', 76, 'latin1');

  // Exif IFD (rel 96): GPSInfo.
  tiff.writeUInt16LE(1, 96);
  e = 98;
  writeEntry(e, 0x8825, 4, 1, 114); e += 12;
  tiff.writeUInt32LE(0, e); e += 4;

  // GPS IFD (rel 114): latRef, lat, lngRef, lng, altRef.
  tiff.writeUInt16LE(5, 114);
  e = 116;
  writeEntry(e, 0x0001, 2, 2, Buffer.from('S\0', 'latin1')); e += 12;
  writeEntry(e, 0x0002, 5, 3, abs(180)); e += 12;
  writeEntry(e, 0x0003, 2, 2, Buffer.from('W\0', 'latin1')); e += 12;
  writeEntry(e, 0x0004, 5, 3, abs(204)); e += 12;
  writeEntry(e, 0x0005, 1, 1, 0); e += 12;
  tiff.writeUInt32LE(0, e); e += 4;

  const writeRat = (off, vals) => {
    for (const v of vals) {
      tiff.writeUInt32LE(v[0], off); tiff.writeUInt32LE(v[1], off + 4); off += 8;
    }
  };
  writeRat(180, [[33, 1], [30, 1], [125, 10]]);
  writeRat(204, [[70, 1], [40, 1], [5, 1]]);

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4 + payload.length);
  app1.writeUInt8(0xFF, 0);
  app1.writeUInt8(0xE1, 1);
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);

  const out = Buffer.alloc(2 + app1.length + bodyWithoutSoi.length);
  out.writeUInt8(0xFF, 0);
  out.writeUInt8(0xD8, 1);
  app1.copy(out, 2);
  bodyWithoutSoi.copy(out, 2 + app1.length);
  return out;
}

/* ── Validadores en el navegador ──────────────────────────────────────── */

async function pdfPagesText(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const doc = await window.pdfjsLib.getDocument({ data: u }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p);
      const tc = await pg.getTextContent();
      out.push({ page: p, text: tc.items.map((it) => it.str).join(' ') });
    }
    return { pages: out, numPages: doc.numPages };
  }, { b64 });
}

async function pdfMeta(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const doc = await window.PDFLib.PDFDocument.load(u);
    return { title: doc.getTitle(), author: doc.getAuthor(), pages: doc.getPageCount() };
  }, { b64 });
}

async function xlsxRows(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const wb = window.XLSX.read(u, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return { sheet: wb.SheetNames[0], rows: window.XLSX.utils.sheet_to_json(ws, { header: 1 }) };
  }, { b64 });
}

async function imageStats(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const isPng = u[0] === 0x89 && u[1] === 0x50;
    const isJpeg = u[0] === 0xFF && u[1] === 0xD8;
    const mime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/webp';
    const blob = new Blob([u], { type: mime });
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = 0; let n = 0;
    for (let i = 0; i < d.length; i += 4) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    return { format: isPng ? 'png' : isJpeg ? 'jpeg' : 'other', width: c.width, height: c.height, luma: s / (n || 1) };
  }, { b64 });
}

async function docxText(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const res = await window.mammoth.extractRawText({ arrayBuffer: u.buffer });
    return res.value;
  }, { b64 });
}

async function run() {
  console.log('=== Gate E2E PDF + Misc Tools (8 herramientas) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  let censoredPdf = null;
  let censoredMeta = null;

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage(page, url, 'extraer-tablas-pdf-excel');
    await loadFixturePdfLib(page, url);
    const pdfMain = Buffer.from(await genPdfMain(page), 'base64');
    ok(pdfMain.length > 800, 'fixture main.pdf generado (tabla + SECRETO)', pdfMain.length + ' bytes');
    const pdfA = Buffer.from(await genPdfVersionA(page), 'base64');
    ok(pdfA.length > 400, 'fixture version-a.pdf generado', pdfA.length + ' bytes');
    const pdfB = Buffer.from(await genPdfVersionB(page), 'base64');
    ok(pdfB.length > 400, 'fixture version-b.pdf generado', pdfB.length + ' bytes');
    const cameraImg = Buffer.from(await genCameraImage(page), 'base64');
    ok(cameraImg.length > 300, 'fixture camara.png generado', cameraImg.length + ' bytes');
    const tableImg = Buffer.from(await genTableImage(page), 'base64');
    ok(tableImg.length > 300, 'fixture tabla.png generado', tableImg.length + ' bytes');
    const baseJpegBody = Buffer.from(await genBaseJpegBody(page), 'base64');
    const photoJpeg = buildJpegWithExif(baseJpegBody);
    ok(photoJpeg.length > 400 && photoJpeg[0] === 0xFF && photoJpeg[1] === 0xD8, 'fixture foto.jpg con EXIF GPS generado', photoJpeg.length + ' bytes');

    // Verificación previa: el fixture JPEG se abre con EXIF en el propio navegador.
    const exifCheck = await page.evaluate(async ({ b64 }) => {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const r = await window.PhotoLocation.extractFromJpeg(u.buffer);
      return r.success ? { success: true, lat: r.data.gps.lat, lng: r.data.gps.lng, make: r.data.camera.make, datetime: r.data.datetime } : { success: false, error: r.error };
    }, { b64: toBase64(photoJpeg) });
    ok(exifCheck.success && exifCheck.lat !== undefined, 'fixture JPEG: PhotoLocation extrae GPS', JSON.stringify(exifCheck));

    /* ── 1. pdfTablesToExcel ───────────────────────────────────────────── */
    console.log('\n--- pdfTablesToExcel (extraer-tablas-pdf-excel) ---');
    await gotoPage(page, url, 'extraer-tablas-pdf-excel');
    await upload(page, [{ name: 'main.pdf', mimeType: 'application/pdf', buffer: pdfMain }]);
    await page.waitForSelector('#outputFormat', { timeout: 8000, state: 'attached' });
    pass('pdfTablesToExcel: control outputFormat visible (fix id)');
    await runTool(page);
    const ptMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Extracción de tablas completada/.test(ptMsg), `pdfTablesToExcel message: "${ptMsg}"`);
    const ptBuf = await downloadResult(page);
    if (ptBuf) {
      const xr = await xlsxRows(page, toBase64(ptBuf));
      const flat = JSON.stringify(xr.rows);
      ok(xr.sheet === 'Tablas', 'pdfTablesToExcel: hoja "Tablas"', xr.sheet);
      ok(flat.includes('Producto') && flat.includes('Cantidad') && flat.includes('Precio'), 'pdfTablesToExcel: fila de cabecera extraída');
      ok(flat.includes('Manzanas') && flat.includes('3') && flat.includes('1.50'), 'pdfTablesToExcel: fila 1 extraída');
      ok(flat.includes('Peras') && flat.includes('2') && flat.includes('2.25'), 'pdfTablesToExcel: fila 2 extraída');
    } else fail('pdfTablesToExcel sin archivo');
    await closeDialog(page);

    // Rama CSV (prueba del select outputFormat corregido).
    await page.selectOption('#outputFormat', 'csv');
    await runTool(page);
    const ptCsv = await downloadResult(page);
    if (ptCsv) {
      const csvText = await readText(page, toBase64(ptCsv));
      ok(csvText.includes('Producto') && csvText.includes('Manzanas') && csvText.includes('Peras'), 'pdfTablesToExcel CSV: contiene las filas');
    } else fail('pdfTablesToExcel CSV sin archivo');
    await closeDialog(page);

    /* ── 2. censorPdf ──────────────────────────────────────────────────── */
    console.log('\n--- censorPdf (censurar-pdf-permanente) ---');
    await gotoPage(page, url, 'censurar-pdf-permanente');
    await upload(page, [{ name: 'main.pdf', mimeType: 'application/pdf', buffer: pdfMain }]);
    await page.waitForSelector('#searchTerm', { timeout: 8000, state: 'attached' });
    pass('censorPdf: control searchTerm visible (nuevo htmlByTool)');
    await page.fill('#searchTerm', 'SECRETO');
    await page.check('#removeMetadata');
    await runTool(page);
    const cnMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/zona\(s\) censurada\(s\)/.test(cnMsg), `censorPdf message: "${cnMsg}"`);
    const cnBuf = await downloadResult(page);
    if (cnBuf) {
      censoredPdf = cnBuf;
      const censoredText = await pdfPagesText(page, toBase64(cnBuf));
      const allText = censoredText.pages.map((p) => p.text).join(' ');
      ok(censoredText.numPages === 2, 'censorPdf: PDF resultado tiene 2 páginas', censoredText.numPages + ' páginas');
      ok(!allText.includes('SECRETO'), 'censorPdf: texto censurado no contiene SECRETO');
      ok(allText.trim() === '', 'censorPdf: PDF aplanado sin texto selectable');
      censoredMeta = await pdfMeta(page, toBase64(cnBuf));
      ok(censoredMeta.title === '' && censoredMeta.author === '', 'censorPdf: metadatos eliminados (fix arrayBuffer→load)');
    } else fail('censorPdf sin archivo');
    await closeDialog(page);

    /* ── 3. verifyPdfCensor ────────────────────────────────────────────── */
    console.log('\n--- verifyPdfCensor (verificar-censura-pdf) ---');
    await gotoPage(page, url, 'verificar-censura-pdf');
    await upload(page, [
      { name: 'main.pdf', mimeType: 'application/pdf', buffer: pdfMain },
      { name: 'main-censurado.pdf', mimeType: 'application/pdf', buffer: censoredPdf },
    ]);
    await page.waitForSelector('#searchTerm', { timeout: 8000, state: 'attached' });
    pass('verifyPdfCensor: control searchTerm visible (nuevo htmlByTool)');
    await page.fill('#searchTerm', 'SECRETO');
    await runTool(page);
    const vpMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Verificación completada\./.test(vpMsg), `verifyPdfCensor message: "${vpMsg}"`);
    const vpBuf = await downloadResult(page);
    if (vpBuf) {
      const report = await readText(page, toBase64(vpBuf));
      ok(report.includes('PDF original: main.pdf'), 'verifyPdfCensor: reporte identifica original');
      ok(report.includes('Páginas original: 2') && report.includes('Páginas censurado: 2'), 'verifyPdfCensor: páginas coinciden');
      ok(report.includes('RESULTADO: El PDF censurado está completamente limpio de texto.'), 'verifyPdfCensor: censurado sin texto recuperable');
      ok(report.includes('En original: 1 coincidencias') || report.includes('En original: 2 coincidencias'), 'verifyPdfCensor: el término existía en el original');
    } else fail('verifyPdfCensor sin archivo');
    await closeDialog(page);

    /* ── 4. comparePdfs ────────────────────────────────────────────────── */
    console.log('\n--- comparePdfs (comparar-dos-pdf) ---');
    await gotoPage(page, url, 'comparar-dos-pdf');
    await upload(page, [
      { name: 'version-a.pdf', mimeType: 'application/pdf', buffer: pdfA },
      { name: 'version-b.pdf', mimeType: 'application/pdf', buffer: pdfB },
    ]);
    await runTool(page);
    const cpMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/1 idénticas, 1 modificadas/.test(cpMsg), `comparePdfs message: "${cpMsg}"`);
    const cpBuf = await downloadResult(page);
    if (cpBuf) {
      const z = await zipEntries(page, toBase64(cpBuf));
      const reportEntry = z.find((e) => /^comparacion-.*\.txt$/.test(e.name));
      const diffEntry = z.find((e) => /^diff-pagina-1\.png$/.test(e.name));
      ok(!!reportEntry, 'comparePdfs: incluye reporte .txt', reportEntry ? reportEntry.name : 'sin reporte');
      ok(!!diffEntry, 'comparePdfs: incluye diff-pagina-1.png', diffEntry ? diffEntry.name : 'sin diff');
      if (reportEntry) {
        const rt = await zipEntryText(page, toBase64(cpBuf), reportEntry.name);
        ok(rt.includes('Páginas idénticas: 1'), 'comparePdfs: reporte 1 página idéntica');
        ok(rt.includes('Páginas modificadas: 1'), 'comparePdfs: reporte 1 página modificada');
        ok(rt.includes('Páginas añadidas en B: 0') && rt.includes('Páginas eliminadas en B: 0'), 'comparePdfs: sin añadidas/eliminadas');
      }
    } else fail('comparePdfs sin archivo');
    await closeDialog(page);

    /* ── 5. cameraDocumentScanner ──────────────────────────────────────── */
    console.log('\n--- cameraDocumentScanner (escanear-documento-camara) ---');
    await gotoPage(page, url, 'escanear-documento-camara');
    await upload(page, [{ name: 'camara.png', mimeType: 'image/png', buffer: cameraImg }]);
    await page.waitForSelector('#outputFormat', { timeout: 8000, state: 'attached' });
    pass('cameraDocumentScanner: control outputFormat visible (fix id)');
    await runTool(page);
    const cmMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Imagen de cámara procesada correctamente\./.test(cmMsg), `cameraDocumentScanner message: "${cmMsg}"`);
    const cmBuf = await downloadResult(page);
    if (cmBuf) {
      const inStats = await imageStats(page, toBase64(cameraImg));
      const outStats = await imageStats(page, toBase64(cmBuf));
      ok(outStats.format === 'jpeg', 'cameraDocumentScanner: salida JPEG por defecto', outStats.format);
      ok(outStats.width === inStats.width && outStats.height === inStats.height, 'cameraDocumentScanner: mantiene dimensiones');
      ok(outStats.luma > inStats.luma + 3, 'cameraDocumentScanner: brillo aumentado', `${inStats.luma.toFixed(1)} → ${outStats.luma.toFixed(1)}`);
    } else fail('cameraDocumentScanner sin archivo');
    await closeDialog(page);

    // Rama PNG (prueba del select outputFormat corregido).
    await page.selectOption('#outputFormat', 'png');
    await runTool(page);
    const cmPng = await downloadResult(page);
    if (cmPng) {
      const pngStats = await imageStats(page, toBase64(cmPng));
      ok(pngStats.format === 'png', 'cameraDocumentScanner: salida PNG con el select (fix id)', pngStats.format);
    } else fail('cameraDocumentScanner PNG sin archivo');
    await closeDialog(page);

    /* ── 6. photoLocationExtractor ─────────────────────────────────────── */
    console.log('\n--- photoLocationExtractor (extraer-ubicacion-foto) ---');
    await gotoPage(page, url, 'extraer-ubicacion-foto');
    await upload(page, [{ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: photoJpeg }]);
    await runTool(page);
    const plMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Metadatos extraídos correctamente\./.test(plMsg), `photoLocationExtractor message: "${plMsg}"`);
    const plBuf = await downloadResult(page);
    if (plBuf) {
      const jsonText = await readText(page, toBase64(plBuf));
      const parsed = JSON.parse(jsonText);
      ok(parsed.gps && parsed.gps.lat !== undefined && parsed.gps.lng !== undefined, 'photoLocationExtractor: JSON con gps.lat/lng (fix parseExif→PhotoLocation)');
      ok(parsed.latitud && parsed.latitud.includes('33') && parsed.latitud.includes('S'), 'photoLocationExtractor: latitud 33° S', parsed.latitud);
      ok(parsed.longitud && parsed.longitud.includes('70') && parsed.longitud.includes('W'), 'photoLocationExtractor: longitud 70° W', parsed.longitud);
      ok(parsed.url_mapa && parsed.url_mapa.includes('google.com/maps?q='), 'photoLocationExtractor: url_mapa presente');
      ok(parsed.camara && parsed.camara.make === 'Maker', 'photoLocationExtractor: cámara del EXIF', JSON.stringify(parsed.camara));
      ok(parsed.fecha_hora === '2026:01:02 03:04:05', 'photoLocationExtractor: fecha_hora', String(parsed.fecha_hora));
    } else fail('photoLocationExtractor sin archivo');
    await closeDialog(page);

    /* ── 7. formatDocumentApa7 ─────────────────────────────────────────── */
    console.log('\n--- formatDocumentApa7 (formato-apa-7) ---');
    await gotoPage(page, url, 'formato-apa-7');
    await upload(page, [{ name: 'borrador.txt', mimeType: 'text/plain', buffer: Buffer.from('borrador', 'utf8') }]);
    await page.waitForSelector('#title', { timeout: 8000, state: 'attached' });
    pass('formatDocumentApa7: controles del documento visibles (nuevo htmlByTool)');
    await page.fill('#title', 'Informe de Certificación E2E');
    await page.fill('#authorName', 'Equipo Toolisto');
    await page.fill('#authorAffiliation', 'Universidad de Prueba');
    await page.fill('#abstract', 'Este documento verifica la generación de un DOCX con formato APA 7 desde el navegador.');
    await page.fill('#keywords', 'certificación, e2e, apa7');
    await runTool(page);
    const apMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Documento APA 7 generado correctamente\./.test(apMsg), `formatDocumentApa7 message: "${apMsg}"`);
    const apBuf = await downloadResult(page);
    if (apBuf) {
      const txt = await docxText(page, toBase64(apBuf));
      ok(txt.includes('Informe de Certificación E2E'), 'formatDocumentApa7: DOCX incluye el título');
      ok(txt.includes('Equipo Toolisto'), 'formatDocumentApa7: DOCX incluye el autor');
      ok(txt.includes('Universidad de Prueba'), 'formatDocumentApa7: DOCX incluye la afiliación');
      ok(txt.includes('Resumen'), 'formatDocumentApa7: DOCX incluye "Resumen"');
      ok(txt.includes('Este documento verifica la generación'), 'formatDocumentApa7: DOCX incluye el abstract');
      ok(txt.includes('Palabras clave'), 'formatDocumentApa7: DOCX incluye "Palabras clave"');
    } else fail('formatDocumentApa7 sin archivo');
    await closeDialog(page);

    /* ── 8. imageTableToExcel ──────────────────────────────────────────── */
    console.log('\n--- imageTableToExcel (extraer-tabla-imagen-excel) ---');
    await gotoPage(page, url, 'extraer-tabla-imagen-excel');
    await upload(page, [{ name: 'tabla.png', mimeType: 'image/png', buffer: tableImg }]);
    await page.waitForSelector('#language', { timeout: 8000, state: 'attached' });
    pass('imageTableToExcel: control language visible (fix id)');
    await page.selectOption('#language', 'spa');
    await runTool(page);
    const itMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    const rowMatch = itMsg.match(/Se encontraron (\d+) filas y (\d+) columnas/);
    ok(/Tabla detectada y exportada/.test(itMsg), `imageTableToExcel message: "${itMsg}"`);
    ok(rowMatch && parseInt(rowMatch[1], 10) >= 3, 'imageTableToExcel: OCR detecta al menos 3 filas', itMsg);
    const itBuf = await downloadResult(page);
    if (itBuf) {
      const xr = await xlsxRows(page, toBase64(itBuf));
      const flat = xr.rows.map((r) => (Array.isArray(r) ? r.join(' | ') : String(r))).join(' || ');
      ok(xr.sheet === 'Tabla detectada', 'imageTableToExcel: hoja "Tabla detectada"', xr.sheet);
      ok(xr.rows.length >= 3, 'imageTableToExcel: XLSX con 3+ filas', xr.rows.length + ' filas');
      ok(/Nombre|Cantidad/i.test(flat), 'imageTableToExcel: cabecera reconocida (Nombre/Cantidad)', flat.slice(0, 120));
      ok(/Ana|Luis/i.test(flat), 'imageTableToExcel: filas de datos reconocidas (Ana/Luis)', flat.slice(0, 120));
    } else fail('imageTableToExcel sin archivo');
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
    suite: 'gate-e2e-pdf-misc-tools',
    updatedAt: new Date().toISOString(),
    tools: ['pdfTablesToExcel', 'censorPdf', 'verifyPdfCensor', 'comparePdfs', 'cameraDocumentScanner', 'photoLocationExtractor', 'formatDocumentApa7', 'imageTableToExcel'],
    excluded: {},
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-pdf-misc-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
