// verify-pdf-family.mjs — Harness de certificación para la familia PDF.
// Cubre 22 herramientas PDFLib deterministas: rotatePdf, deletePagesPdf, reversePagesPdf,
// duplicatePagesPdf, insertBlankPagesPdf, editMetadataPdf, compressPdf, cropPdf,
// resizePdfPages, nUpPdf, mergePdf, interleavePdf, splitDoublePdf, bookletPdf, watermarkPdf,
// addPageNumbersPdf, addHeaderFooterPdf, imagesPdf, splitPdf, reorderPdf, pdfToImages, signPdf.
// Verifica página por página con PDFLib y render/texto de pdf.js (rotación, conteo, tamaños,
// metadatos, orden de páginas, marca de agua, numeración, encabezado/pie, imágenes, ZIP,
// drag&drop, firma visual).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 8097;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.gz': 'application/gzip', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.zip': 'application/zip',
  '.pdf': 'application/pdf', '.traineddata': 'application/octet-stream', '.traineddata.gz': 'application/gzip'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p.replace(/^\/+/, ''));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const byId = {};
for (const t of tools) byId[t.id] = t;

let passed = 0;
let failed = 0;
const failures = [];
const checks = [];

function ok(cond, msg) {
  checks.push({ name: msg, pass: !!cond });
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  FAIL: ' + msg); }
}

async function expect(page, locatorFn, desc) {
  try {
    await locatorFn().waitFor({ state: 'visible', timeout: 8000 });
    ok(true, desc);
  } catch (e) {
    ok(false, desc + ' (no encontrado)');
  }
}

async function openToolPage(browser, slug) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load' });
  // Los motores son diferidos en producción. El harness los carga de forma
  // explícita porque inspecciona los archivos producidos con PDFLib y pdf.js.
  await page.addScriptTag({ url: `http://127.0.0.1:${PORT}/vendor/pdflib/pdf-lib.min.js` });
  await page.addScriptTag({ url: `http://127.0.0.1:${PORT}/vendor/pdfjs/pdf.min.js` });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

async function waitForResultDialog(page) {
  await page.locator('#resultDialog').waitFor({ state: 'visible', timeout: 15000 });
}

function captureDownload(page) {
  return page.waitForEvent('download', { timeout: 30000 });
}

async function saveDownload(download, suffix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlst-pdf-'));
  const dest = path.join(tmp, 'dl' + (suffix || ''));
  await download.saveAs(dest);
  const buf = fs.readFileSync(dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return buf;
}

function toBase64(buf) {
  return buf.toString('base64');
}

/* ── Helpers de inspección PDF en el navegador ───────────────────────── */

async function inspectPdf(page, buf) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const doc = await window.PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPageCount();
    const sizes = [];
    const rots = [];
    for (let i = 0; i < pages; i++) {
      const p = doc.getPage(i);
      const s = p.getSize();
      sizes.push([Math.round(s.width * 100) / 100, Math.round(s.height * 100) / 100]);
      rots.push(p.getRotation().angle);
    }
    return {
      pages, sizes, rots,
      title: doc.getTitle() || '',
      author: doc.getAuthor() || '',
      subject: doc.getSubject() || '',
      keywords: String(doc.getKeywords() || '')
    };
  }, toBase64(buf));
}

async function renderHashes(page, buf) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const hashes = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const vp = pg.getViewport({ scale: 0.2 });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width));
      c.height = Math.max(1, Math.floor(vp.height));
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 16) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      hashes.push(h);
    }
    return hashes;
  }, toBase64(buf));
}

async function makeColoredPdf(page, count = 3) {
  return page.evaluate(async (countArg) => {
    const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const palette = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1]];
    for (let i = 0; i < countArg; i++) {
      const color = palette[i % palette.length];
      const p = doc.addPage([300, 300]);
      p.drawRectangle({ x: 0, y: 0, width: 300, height: 300, color: rgb(color[0], color[1], color[2]) });
      p.drawText('PAGINA ' + (i + 1), { x: 80, y: 148, size: 24, font, color: rgb(1, 1, 1) });
    }
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }, count);
}

async function makeDoublePagePdf(page) {
  return page.evaluate(async () => {
    const { PDFDocument, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    const p = doc.addPage([400, 300]);
    p.drawRectangle({ x: 0, y: 0, width: 200, height: 300, color: rgb(1, 0, 0) });
    p.drawRectangle({ x: 200, y: 0, width: 200, height: 300, color: rgb(0, 1, 0) });
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

async function extractTexts(page, buf) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const texts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const tc = await pg.getTextContent();
      texts.push(tc.items.map((it) => it.str || '').join(''));
    }
    return texts;
  }, toBase64(buf));
}

async function sampleCenters(page, buf) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const centers = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const vp = pg.getViewport({ scale: 0.25 });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width));
      c.height = Math.max(1, Math.floor(vp.height));
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      centers.push([d[0], d[1], d[2]]);
    }
    return centers;
  }, toBase64(buf));
}

async function listZip(page, buf) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(bytes);
    const out = [];
    for (const name of Object.keys(zip.files)) {
      const f = zip.files[name];
      if (f.dir) continue;
      const c = await f.async('uint8array');
      let dims = null;
      if (c.length > 8 && c[0] === 0x89 && c[1] === 0x50) {
        try {
          const bmp = await createImageBitmap(new Blob([c], { type: 'image/png' }));
          dims = { width: bmp.width, height: bmp.height };
        } catch (_) { /* ignore */ }
      }
      out.push({ name: f.name, size: c.length, png: c.length > 8 && c[0] === 0x89 && c[1] === 0x50, dims });
    }
    return out;
  }, toBase64(buf));
}

async function renderRegionStats(page, buf, xA, yA, xB, yB, scale = 0.5) {
  return page.evaluate(async ({ b64, xA, yA, xB, yB, scale }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const vp = pg.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width));
      c.height = Math.max(1, Math.floor(vp.height));
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const x0 = Math.max(0, Math.floor(xA * c.width)), x1 = Math.min(c.width, Math.ceil(xB * c.width));
      const y0 = Math.max(0, Math.floor(yA * c.height)), y1 = Math.min(c.height, Math.ceil(yB * c.height));
      const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) dark++;
      }
      out.push({ dark });
    }
    return out;
  }, { b64: toBase64(buf), xA, yA, xB, yB, scale });
}

async function runAndDownload(page) {
  const dlP = captureDownload(page);
  dlP.catch(() => {});
  await page.click('#runButton');
  await waitForResultDialog(page);
  await page.click('#downloadButton');
  const dl = await dlP;
  return saveDownload(dl, '.pdf');
}

async function closeResultDialog(page) {
  await page.evaluate(() => {
    const d = document.getElementById('resultDialog');
    if (d) d.close();
  });
  await page.waitForTimeout(120);
}

/* ── Checks por herramienta ──────────────────────────────────────────── */

async function checkRotatePdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#rotatePdfAngle'), 'rotatePdf: control de ángulo montado');
  await page.selectOption('#rotatePdfAngle', '90');
  await page.selectOption('#rotatePdfPages', 'all');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'rotatePdf: conserva 3 páginas');
  ok(out.rots[0] === 90 && out.rots[1] === 90 && out.rots[2] === 90, 'rotatePdf: todas las páginas giradas 90°');
  ok(errors.length === 0, 'rotatePdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkDeletePagesPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#deletePagesRanges'), 'deletePagesPdf: control de rangos montado');
  await page.fill('#deletePagesRanges', '1');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 2, 'deletePagesPdf: 3 páginas -> 2 al eliminar la 1');
  ok(errors.length === 0, 'deletePagesPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkReversePagesPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeColoredPdf(page);
  const srcBuf = Buffer.from(srcB64, 'base64');
  const srcHashes = await renderHashes(page, srcBuf);
  ok(srcHashes.length === 3 && srcHashes[0] !== srcHashes[1], 'reversePagesPdf: fixture con 3 páginas distinguibles');

  await page.setInputFiles('#fileInput', { name: 'colored-3pages.pdf', mimeType: 'application/pdf', buffer: srcBuf });
  await page.waitForTimeout(300);
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'reversePagesPdf: conserva 3 páginas');
  const outHashes = await renderHashes(page, buf);
  ok(outHashes[0] === srcHashes[2] && outHashes[1] === srcHashes[1] && outHashes[2] === srcHashes[0],
    'reversePagesPdf: orden de páginas invertido (3,2,1)');
  ok(errors.length === 0, 'reversePagesPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkDuplicatePagesPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#duplicatePagesTimes'), 'duplicatePagesPdf: control de veces montado');
  await page.selectOption('#duplicatePagesTarget', 'all');
  await page.fill('#duplicatePagesTimes', '2');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 6, 'duplicatePagesPdf: 3 páginas duplicadas x2 -> 6');
  ok(errors.length === 0, 'duplicatePagesPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkInsertBlankPagesPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#insertBlankPosition'), 'insertBlankPagesPdf: control de posición montado');
  await page.fill('#insertBlankPosition', '1');
  await page.fill('#insertBlankCount', '2');
  await page.selectOption('#insertBlankSize', 'same');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 5, 'insertBlankPagesPdf: 3 + 2 blancas tras posición 1 -> 5 páginas');
  ok(out.sizes[2][0] === 612 && out.sizes[2][1] === 792, 'insertBlankPagesPdf: página en blanco con tamaño del documento');
  ok(errors.length === 0, 'insertBlankPagesPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkEditMetadataPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-meta.pdf'));
  await expect(page, () => page.locator('#editMetaTitle'), 'editMetadataPdf: control de título montado');
  await page.fill('#editMetaTitle', 'TLST-Título');
  await page.fill('#editMetaAuthor', 'TLST-Autor');
  await page.fill('#editMetaSubject', 'TLST-Asunto');
  await page.fill('#editMetaKeywords', 'a, b');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.title === 'TLST-Título', 'editMetadataPdf: título escrito y legible');
  ok(out.author === 'TLST-Autor', 'editMetadataPdf: autor escrito y legible');
  ok(out.subject === 'TLST-Asunto', 'editMetadataPdf: asunto escrito y legible');
  ok(out.keywords.indexOf('a') !== -1 && out.keywords.indexOf('b') !== -1, 'editMetadataPdf: palabras clave escritas y legibles');
  ok(errors.length === 0, 'editMetadataPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkCompressPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const src = fs.readFileSync(path.join(FIXTURES, 'five-pages-fixed.pdf'));
  await page.setInputFiles('#fileInput', { name: 'five-pages-fixed.pdf', mimeType: 'application/pdf', buffer: src });
  await expect(page, () => page.locator('#compressPdfLevel'), 'compressPdf: control de nivel montado');
  await page.selectOption('#compressPdfLevel', 'aggressive');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 5, 'compressPdf: conserva las 5 páginas');
  ok(buf.length < src.length, `compressPdf: salida más pequeña (${buf.length} < ${src.length})`);
  ok(errors.length === 0, 'compressPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkCropPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#cropPdfTop'), 'cropPdf: control de margen montado');
  await page.fill('#cropPdfTop', '20');
  await page.fill('#cropPdfRight', '20');
  await page.fill('#cropPdfBottom', '20');
  await page.fill('#cropPdfLeft', '20');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'cropPdf: conserva 3 páginas');
  ok(out.sizes[0][0] === 572 && out.sizes[0][1] === 752, 'cropPdf: caja recortada a 572×752 pt');
  ok(errors.length === 0, 'cropPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkResizePdfPages(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeColoredPdf(page);
  await page.setInputFiles('#fileInput', { name: 'colored-3pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(srcB64, 'base64') });
  await expect(page, () => page.locator('#resizePdfTarget'), 'resizePdfPages: control de tamaño montado');
  await page.selectOption('#resizePdfTarget', 'a5');
  await page.selectOption('#resizePdfScale', 'fit');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'resizePdfPages: conserva 3 páginas');
  const w = out.sizes[0][0], h = out.sizes[0][1];
  ok(Math.abs(w - 419.53) < 1 && Math.abs(h - 595.28) < 1, `resizePdfPages: página redimensionada a A5 (${w}×${h})`);
  ok(errors.length === 0, 'resizePdfPages: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkNUpPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-5pages.pdf'));
  await expect(page, () => page.locator('#nUpPdfLayout'), 'nUpPdf: control de layout montado');
  await page.selectOption('#nUpPdfLayout', '2');
  await page.selectOption('#nUpPdfOrientation', 'landscape');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'nUpPdf: 5 páginas 2-up -> 3 hojas');
  ok(out.sizes[0][0] === 842 && out.sizes[0][1] === 595, 'nUpPdf: hoja horizontal A4 landscape 842×595');
  ok(errors.length === 0, 'nUpPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkMergePdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', [
    path.join(FIXTURES, 'func-3pages.pdf'),
    path.join(FIXTURES, 'func-5pages.pdf')
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#fileStrip .file-pill').length === 2, null, { timeout: 8000 });
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 8, 'mergePdf: 3 + 5 páginas unidas -> 8');
  const dl = await page.evaluate(() => document.querySelector('#resultTitle')?.textContent || '');
  ok(dl.indexOf('combinado') !== -1, 'mergePdf: título de resultado correcto');
  ok(errors.length === 0, 'mergePdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkInterleavePdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', [
    path.join(FIXTURES, 'func-3pages.pdf'),
    path.join(FIXTURES, 'func-5pages.pdf')
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#fileStrip .file-pill').length === 2, null, { timeout: 8000 });
  await expect(page, () => page.locator('#interleaveFirst'), 'interleavePdf: control de orden montado');
  await page.selectOption('#interleaveFirst', 'a');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 8, 'interleavePdf: 3 + 5 páginas intercaladas -> 8');
  ok(errors.length === 0, 'interleavePdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkSplitDoublePdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeDoublePagePdf(page);
  const srcBuf = Buffer.from(srcB64, 'base64');
  await page.setInputFiles('#fileInput', { name: 'double-page.pdf', mimeType: 'application/pdf', buffer: srcBuf });
  await expect(page, () => page.locator('#splitDoubleOrientation'), 'splitDoublePdf: control de orientación montado');
  await page.selectOption('#splitDoubleOrientation', 'vertical');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 2, 'splitDoublePdf: 1 página doble -> 2 páginas');
  ok(out.sizes[0][0] === 200 && out.sizes[0][1] === 300, 'splitDoublePdf: mitades de 200×300 pt');
  const centers = await sampleCenters(page, buf);
  ok(centers[0][0] > 200 && centers[0][1] < 100, 'splitDoublePdf: mitad izquierda conserva el contenido rojo');
  ok(centers[1][1] > 200 && centers[1][0] < 100, 'splitDoublePdf: mitad derecha conserva el contenido verde');
  ok(errors.length === 0, 'splitDoublePdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkBookletPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeColoredPdf(page, 4);
  const srcBuf = Buffer.from(srcB64, 'base64');
  const srcHashes = await renderHashes(page, srcBuf);
  ok(srcHashes.length === 4, 'bookletPdf: fixture con 4 páginas distinguibles');

  await page.setInputFiles('#fileInput', { name: 'colored-4pages.pdf', mimeType: 'application/pdf', buffer: srcBuf });
  await page.waitForTimeout(300);
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 4, 'bookletPdf: conserva 4 páginas');
  const outHashes = await renderHashes(page, buf);
  ok(outHashes[0] === srcHashes[3] && outHashes[1] === srcHashes[0] && outHashes[2] === srcHashes[2] && outHashes[3] === srcHashes[1],
    'bookletPdf: orden de cuadernillo (4,1,3,2)');
  ok(errors.length === 0, 'bookletPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkWatermarkPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#watermarkText'), 'watermarkPdf: control de texto montado');
  await page.fill('#watermarkText', 'BORRADOR TLST');
  await page.selectOption('#watermarkPosition', 'center');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'watermarkPdf: conserva 3 páginas');
  const texts = await extractTexts(page, buf);
  ok(texts.every((t) => t.indexOf('BORRADOR TLST') !== -1), 'watermarkPdf: marca de agua extraíble en las 3 páginas');
  ok(errors.length === 0, 'watermarkPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkAddPageNumbersPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#pageNumPosition'), 'addPageNumbersPdf: control de posición montado');
  await page.selectOption('#pageNumPosition', 'bottomCenter');
  await page.selectOption('#pageNumFormat', 'number');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'addPageNumbersPdf: conserva 3 páginas');
  const texts = await extractTexts(page, buf);
  ok(texts[0].indexOf('1') !== -1 && texts[1].indexOf('2') !== -1 && texts[2].indexOf('3') !== -1,
    'addPageNumbersPdf: numeración 1, 2, 3 extraíble por página');
  ok(errors.length === 0, 'addPageNumbersPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkAddHeaderFooterPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#headerFooterHeader'), 'addHeaderFooterPdf: control de encabezado montado');
  await page.fill('#headerFooterHeader', 'TLST-ENCABEZADO');
  await page.fill('#headerFooterFooter', 'TLST-PIE');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'addHeaderFooterPdf: conserva 3 páginas');
  const texts = await extractTexts(page, buf);
  ok(texts.every((t) => t.indexOf('TLST-ENCABEZADO') !== -1), 'addHeaderFooterPdf: encabezado extraíble en las 3 páginas');
  ok(texts.every((t) => t.indexOf('TLST-PIE') !== -1), 'addHeaderFooterPdf: pie extraíble en las 3 páginas');
  ok(errors.length === 0, 'addHeaderFooterPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkImagesPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', [
    path.join(FIXTURES, 'test-10x10.png'),
    path.join(FIXTURES, 'test-200x100.png')
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#fileStrip .file-pill').length === 2, null, { timeout: 8000 });
  await expect(page, () => page.locator('#pdfPageSize'), 'imagesPdf: control de tamaño montado');
  await page.selectOption('#pdfPageSize', 'a4');
  await page.selectOption('#pdfOrientation', 'portrait');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 2, 'imagesPdf: 2 imágenes -> 2 páginas PDF');
  ok(Math.abs(out.sizes[0][0] - 595.28) < 1 && Math.abs(out.sizes[0][1] - 841.89) < 1, 'imagesPdf: páginas A4 vertical 595×842 pt');
  ok(out.sizes[1][0] === out.sizes[0][0] && out.sizes[1][1] === out.sizes[0][1], 'imagesPdf: ambas páginas del mismo tamaño');
  ok(errors.length === 0, 'imagesPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkSplitPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeColoredPdf(page);
  const srcBuf = Buffer.from(srcB64, 'base64');
  const srcHashes = await renderHashes(page, srcBuf);
  await page.setInputFiles('#fileInput', { name: 'colored-3pages.pdf', mimeType: 'application/pdf', buffer: srcBuf });
  await page.waitForFunction(() => document.querySelectorAll('#splitPdfThumbs label').length === 3, null, { timeout: 8000 });
  await expect(page, () => page.locator('#splitRanges'), 'splitPdf: control de rangos montado');
  await page.selectOption('#splitMode', 'ranges');
  await page.fill('#splitRanges', '2');
  await page.selectOption('#splitOutput', 'single');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 1, 'splitPdf: rango "2" extrae 1 página');
  const outHashes = await renderHashes(page, buf);
  ok(outHashes[0] === srcHashes[1], 'splitPdf: la página extraída es la correcta (pág 2)');

  await closeResultDialog(page);
  await page.fill('#splitRanges', '1-2');
  const buf2 = await runAndDownload(page);
  const out2 = await inspectPdf(page, buf2);
  const h2 = await renderHashes(page, buf2);
  ok(out2.pages === 2 && h2[0] === srcHashes[0] && h2[1] === srcHashes[1], 'splitPdf: rango "1-2" conserva orden y contenido');
  ok(errors.length === 0, 'splitPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkReorderPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeColoredPdf(page);
  const srcBuf = Buffer.from(srcB64, 'base64');
  const srcHashes = await renderHashes(page, srcBuf);
  await page.setInputFiles('#fileInput', { name: 'colored-3pages.pdf', mimeType: 'application/pdf', buffer: srcBuf });
  await page.waitForFunction(() => document.querySelectorAll('#reorderPdfThumbs > div').length === 3, null, { timeout: 8000 });
  await page.dragAndDrop('#reorderPdfThumbs > div:first-child', '#reorderPdfThumbs > div:last-child');
  await page.waitForTimeout(400);
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'reorderPdf: conserva 3 páginas');
  const outHashes = await renderHashes(page, buf);
  ok(outHashes[0] === srcHashes[1] && outHashes[1] === srcHashes[2] && outHashes[2] === srcHashes[0],
    'reorderPdf: arrastrar 1.ª al final -> orden (2,3,1)');
  ok(errors.length === 0, 'reorderPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkPdfToImages(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'func-3pages.pdf'));
  await expect(page, () => page.locator('#pdfToImagesFormat'), 'pdfToImages: control de formato montado');
  await page.selectOption('#pdfToImagesFormat', 'image/png');
  const buf = await runAndDownload(page);
  const entries = await listZip(page, buf);
  const pngs = entries.filter((e) => e.png);
  ok(entries.length === 3 && pngs.length === 3, 'pdfToImages: ZIP con 3 PNG (una por página)');
  ok(pngs.every((e) => e.name.endsWith('.png')), 'pdfToImages: archivos con extensión .png');
  ok(pngs[0].dims && pngs[0].dims.width === 918 && pngs[0].dims.height === 1188,
    `pdfToImages: página renderizada a 918×1188 px (${pngs[0].dims ? pngs[0].dims.width + '×' + pngs[0].dims.height : 'sin dims'})`);
  ok(pngs.every((e) => e.size > 1000), 'pdfToImages: PNGs con contenido (no vacíos)');
  ok(errors.length === 0, 'pdfToImages: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkSignPdf(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const srcB64 = await makeColoredPdf(page);
  const srcBuf = Buffer.from(srcB64, 'base64');
  const srcHashes = await renderHashes(page, srcBuf);
  await page.setInputFiles('#fileInput', { name: 'colored-3pages.pdf', mimeType: 'application/pdf', buffer: srcBuf });
  await expect(page, () => page.locator('#signPdfType'), 'signPdf: control de tipo montado');
  const signCanvas = page.locator('#signPdfCanvasWrap canvas');
  await signCanvas.scrollIntoViewIfNeeded();
  const box = await signCanvas.boundingBox();
  ok(box && box.width > 50, 'signPdf: lienzo de firma visible');
  if (box) {
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(box.x + 40 + (box.width - 80) * (i / 8), box.y + box.height / 2, { steps: 3 });
    }
    await page.mouse.up();
  }
  await page.selectOption('#signPdfPosition', 'bottomRight');
  await page.fill('#signPdfPage', '1');
  const buf = await runAndDownload(page);
  const out = await inspectPdf(page, buf);
  ok(out.pages === 3, 'signPdf: conserva 3 páginas');
  const stats = await renderRegionStats(page, buf, 0.3, 0.65, 0.9, 0.9, 2.0);
  ok(stats[0].dark > 40, `signPdf: firma visible en la zona inferior derecha de la pág 1 (${stats[0].dark} px oscuros)`);
  ok(stats[1].dark === 0, `signPdf: la página 2 NO tiene firma (${stats[1].dark} px)`);
  const outHashes = await renderHashes(page, buf);
  ok(outHashes[0] !== srcHashes[0], 'signPdf: el contenido de la página firmada cambió');
  ok(errors.length === 0, 'signPdf: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

/* ── Mapa de ejecución ───────────────────────────────────────────────── */

const EXEC = {
  rotatePdf: checkRotatePdf,
  deletePagesPdf: checkDeletePagesPdf,
  reversePagesPdf: checkReversePagesPdf,
  duplicatePagesPdf: checkDuplicatePagesPdf,
  insertBlankPagesPdf: checkInsertBlankPagesPdf,
  editMetadataPdf: checkEditMetadataPdf,
  compressPdf: checkCompressPdf,
  cropPdf: checkCropPdf,
  resizePdfPages: checkResizePdfPages,
  nUpPdf: checkNUpPdf,
  mergePdf: checkMergePdf,
  interleavePdf: checkInterleavePdf,
  splitDoublePdf: checkSplitDoublePdf,
  bookletPdf: checkBookletPdf,
  watermarkPdf: checkWatermarkPdf,
  addPageNumbersPdf: checkAddPageNumbersPdf,
  addHeaderFooterPdf: checkAddHeaderFooterPdf,
  imagesPdf: checkImagesPdf,
  splitPdf: checkSplitPdf,
  reorderPdf: checkReorderPdf,
  pdfToImages: checkPdfToImages,
  signPdf: checkSignPdf
};

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch();

  const ids = process.env.ONLY ? process.env.ONLY.split(',').filter(Boolean) : Object.keys(EXEC);
  for (const id of ids) {
    const tool = byId[id];
    if (!tool) { ok(false, id + ': toolId no encontrado en tools.json'); continue; }
    process.stdout.write('  → ' + id + ' ... ');
    try {
      await EXEC[id](browser, tool);
      console.log('ok');
    } catch (e) {
      console.log('ERROR');
      ok(false, id + ': error al ejecutar check -> ' + (e && e.message ? e.message : e));
    }
  }

  await browser.close();
  server.close();
  console.log(`\nVerificación familia PDF: ${passed} PASS, ${failed} FAIL, ${passed + failed} total.`);
  const evidence = {
    suite: 'verify-pdf-family',
    updatedAt: new Date().toISOString(),
    tools: Object.keys(EXEC),
    total: passed + failed,
    passed,
    failed,
    checks,
    failures,
  };
  const evidencePath = path.join(ROOT, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-pdf-family-evidence.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log('Evidencia: ' + evidencePath);
  if (failed > 0) {
    console.log('Fallos:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
