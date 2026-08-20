#!/usr/bin/env node
/**
 * gate-e2e-pdf-office-new.mjs — Certificación E2E de 13 herramientas:
 * extractTextPdf, extractImagesPdf, pdfToPptx, pptxToPdf, excelToPdf,
 * htmlToPdf, pdfToPdfa, pdfToMarkdown, pdfFormFiller, flattenPdf,
 * imagesToPdfAdvanced, pdfExtractResources, csvToPdf.
 */
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'pdf-new-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0, passes = 0;
const checks = [], failureReasons = [], consoleErrors = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
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
  await page.waitForTimeout(300);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
}

async function runTool(page, timeout = 30000) {
  await page.click('#runButton');
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(150);
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
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
}

async function makePdfInBrowser(page) {
  await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page1 = doc.addPage([595, 842]);
    page1.drawText('Hello World', { x: 60, y: 700, size: 24, font, color: rgb(0, 0, 0) });
    page1.drawText('Toolisto Test PDF', { x: 60, y: 650, size: 14, font });
    page1.drawText('This is a test document for certification.', { x: 60, y: 620, size: 11, font });
    const page2 = doc.addPage([595, 842]);
    page2.drawText('Page Two', { x: 60, y: 700, size: 24, font });
    page2.drawText('Second page content.', { x: 60, y: 650, size: 11, font });
    doc.setTitle('Test PDF');
    doc.setAuthor('Toolisto Test');
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

async function makePdfWithFormFields(page) {
  await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();
    const page1 = doc.addPage([595, 842]);
    page1.drawText('Form Test', { x: 60, y: 700, size: 24, font });
    const nameField = form.createTextField('nombre');
    nameField.addToPage(page1, { x: 60, y: 650, width: 200, height: 20 });
    const emailField = form.createTextField('email');
    emailField.addToPage(page1, { x: 60, y: 610, width: 200, height: 20 });
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

async function xlsxFromAoa(page, aoa, sheetName) {
  return page.evaluate(async (payload) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(payload.aoa);
    XLSX.utils.book_append_sheet(wb, ws, payload.sheetName);
    const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return Array.from(new Uint8Array(arr));
  }, { aoa, sheetName });
}

let url;

async function run() {
  console.log('=== Gate E2E PDF/Office New (13 herramientas) ===\n');

  const server = await startServer();
  url = server.url;
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('net::ERR')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    console.log('\n--- Generating fixtures ---');
    await gotoPage(page, url, 'extraer-texto-pdf');
    const pdfBase64 = await makePdfInBrowser(page);
    const pdfBuf = Buffer.from(pdfBase64, 'base64');
    ok(pdfBuf.length > 100, 'PDF fixture generado', pdfBuf.length + ' bytes');

    const formPdfBase64 = await makePdfWithFormFields(page);
    const formPdfBuf = Buffer.from(formPdfBase64, 'base64');
    ok(formPdfBuf.length > 100, 'PDF con formularios generado', formPdfBuf.length + ' bytes');

    await page.addScriptTag({ url: `${url}/vendor/xlsx/xlsx.min.js` });
    const xlsxBuf = Buffer.from(await xlsxFromAoa(page, [['Ciudad', 'Ventas', 'Anio'], ['Madrid', 120, 2023], ['Barcelona', 80, 2022], ['Valencia', 200, 2024]], 'Datos'));
    ok(xlsxBuf.slice(0, 2).toString('latin1') === 'PK', 'XLSX fixture generado', xlsxBuf.length + ' bytes');

    const csvBuf = Buffer.from('Ciudad,Ventas,Anio\nMadrid,120,2023\nBarcelona,80,2022\nValencia,200,2024\n');
    const htmlBuf = Buffer.from('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Test</title></head><body><h1>Hello PDF</h1><p>This is a test page for HTML to PDF conversion.</p></body></html>');
    const pngBuf = readFileSync(join(root, 'tests', 'fixtures', 'tiny.png')).length > 10
      ? readFileSync(join(root, 'tests', 'fixtures', 'tiny.png'))
      : Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const pngFile = () => ({ name: 'tiny.png', mimeType: 'image/png', buffer: pngBuf });
    const pdfFile = (n = 'test.pdf') => ({ name: n, mimeType: 'application/pdf', buffer: pdfBuf });
    const formPdfFile = (n = 'form.pdf') => ({ name: n, mimeType: 'application/pdf', buffer: formPdfBuf });
    const xlsxFile = () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf });
    const csvFile = (n = 'datos.csv') => ({ name: n, mimeType: 'text/csv', buffer: csvBuf });
    const htmlFile = (n = 'test.html') => ({ name: n, mimeType: 'text/html', buffer: htmlBuf });

    /* ── 1. extractTextPdf ───────────────────────────────────────────── */
    console.log('\n--- extractTextPdf (extraer-texto-pdf) ---');
    await gotoPage(page, url, 'extraer-texto-pdf');
    await upload(page, [pdfFile()]);
    await runTool(page);
    let msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Texto extraído') || msg.includes('página'), `extractTextPdf message: "${msg}"`);
    let buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'extractTextPdf genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Hello World'), 'extractTextPdf extrae texto de la página 1');
      ok(t.includes('Page Two'), 'extractTextPdf extrae texto de la página 2');
    }
    await closeDialog(page);

    /* ── 2. extractImagesPdf ─────────────────────────────────────────── */
    console.log('\n--- extractImagesPdf (extraer-imagenes-pdf) ---');
    await gotoPage(page, url, 'extraer-imagenes-pdf');
    await upload(page, [pdfFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('página') || msg.includes('extraída') || msg.includes('imagen'), `extractImagesPdf message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'extractImagesPdf genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      ok(isZip || isPng, 'extractImagesPdf salida es ZIP o PNG', buf.slice(0, 2).toString('hex'));
    }
    await closeDialog(page);

    /* ── 3. pdfToPptx ────────────────────────────────────────────────── */
    console.log('\n--- pdfToPptx (pdf-a-powerpoint) ---');
    await gotoPage(page, url, 'pdf-a-powerpoint');
    await upload(page, [pdfFile()]);
    await runTool(page, 60000);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('diapositiva') || msg.includes('generada') || msg.includes('PPTX'), `pdfToPptx message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pdfToPptx genera archivo PPTX', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
      ok(isZip, 'pdfToPptx salida es ZIP (PPTX OOXML)', buf.slice(0, 2).toString('hex'));
      const entries = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const zip = await JSZip.loadAsync(u);
        const names = [];
        zip.forEach((path) => names.push(path));
        return names;
      }, toBase64(buf));
      ok(entries.some((n) => n.includes('ppt/presentation.xml')), 'pdfToPptx PPTX tiene presentation.xml', entries.filter((n) => n.includes('ppt/')).join(', '));
      ok(entries.some((n) => n.includes('[Content_Types].xml')), 'pdfToPptx PPTX tiene [Content_Types].xml');
      const slideCount = entries.filter((n) => n.match(/^ppt\/slides\/slide\d+\.xml$/)).length;
      ok(slideCount === 2, `pdfToPptx genera ${slideCount} slides (esperado 2)`);
    }
    await closeDialog(page);

    /* ── 4. pptxToPdf ────────────────────────────────────────────────── */
    console.log('\n--- pptxToPdf (powerpoint-a-pdf) ---');
    await gotoPage(page, url, 'powerpoint-a-pdf');
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    const pptxBase64 = await page.evaluate(async () => {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
      zip.file('ppt/slides/slide1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:r><a:t>Slide One</a:t></a:r></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
      const c = document.createElement('canvas');
      c.width = 200; c.height = 100;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#3366CC'; ctx.fillRect(0, 0, 200, 100);
      ctx.fillStyle = '#fff'; ctx.font = '20px Arial'; ctx.fillText('Test Slide', 40, 55);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const arr = await blob.arrayBuffer();
      zip.file('ppt/media/image1.png', arr);
      const presXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldIdLst></p:presentation>';
      zip.file('ppt/presentation.xml', presXml);
      zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
      const data = await zip.generateAsync({ type: 'uint8array' });
      let bin = '';
      for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
      return btoa(bin);
    });
    const pptxBuf = Buffer.from(pptxBase64, 'base64');
    ok(pptxBuf.length > 50, 'PPTX fixture generado', pptxBuf.length + ' bytes');

    await upload(page, [{ name: 'test.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptxBuf }]);
    await runTool(page, 45000);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('PPTX') || msg.includes('archivo'), `pptxToPdf message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pptxToPdf genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x25 && buf[1] === 0x50, 'pptxToPdf salida es PDF válido', buf.slice(0, 4).toString('ascii'));
    }
    await closeDialog(page);

    /* ── 5. excelToPdf ───────────────────────────────────────────────── */
    console.log('\n--- excelToPdf (excel-a-pdf) ---');
    await gotoPage(page, url, 'excel-a-pdf');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [xlsxFile()]);
    await runTool(page, 30000);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('Excel') || msg.includes('archivo'), `excelToPdf message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'excelToPdf genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) ok(buf[0] === 0x25 && buf[1] === 0x50, 'excelToPdf salida es PDF válido');
    await closeDialog(page);

    /* ── 6. htmlToPdf ────────────────────────────────────────────────── */
    console.log('\n--- htmlToPdf (html-a-pdf) ---');
    await gotoPage(page, url, 'html-a-pdf');
    await page.addScriptTag({ url: `${url}/vendor/js/html2canvas.min.js` });
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [htmlFile()]);
    await runTool(page, 45000);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('HTML') || msg.includes('archivo'), `htmlToPdf message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'htmlToPdf genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) ok(buf[0] === 0x25 && buf[1] === 0x50, 'htmlToPdf salida es PDF válido');
    await closeDialog(page);

    /* ── 7. pdfToPdfa ────────────────────────────────────────────────── */
    console.log('\n--- pdfToPdfa (pdf-a-pdfa) ---');
    await gotoPage(page, url, 'pdf-a-pdfa');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [pdfFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('PDF/A') || msg.includes('convertido') || msg.includes('formato'), `pdfToPdfa message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pdfToPdfa genera PDF + informe', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x25 && buf[1] === 0x50, 'pdfToPdfa salida principal es PDF válido');
    }
    await closeDialog(page);

    /* ── 8. pdfToMarkdown ────────────────────────────────────────────── */
    console.log('\n--- pdfToMarkdown (pdf-a-markdown) ---');
    await gotoPage(page, url, 'pdf-a-markdown');
    await upload(page, [pdfFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Markdown') || msg.includes('generado') || msg.includes('página'), `pdfToMarkdown message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pdfToMarkdown genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('#'), 'pdfToMarkdown salida contiene cabeceras Markdown');
      ok(t.includes('Hello World'), 'pdfToMarkdown extrae texto de la página 1');
      ok(t.includes('Page Two'), 'pdfToMarkdown extrae texto de la página 2');
      ok(t.includes('---'), 'pdfToMarkdown usa separadores ---');
    }
    await closeDialog(page);

    /* ── 9. pdfFormFiller ────────────────────────────────────────────── */
    console.log('\n--- pdfFormFiller (rellenar-formulario-pdf) ---');
    await gotoPage(page, url, 'rellenar-formulario-pdf');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [formPdfFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('rellenado') || msg.includes('campo') || msg.includes('form'), `pdfFormFiller message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pdfFormFiller genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) ok(buf[0] === 0x25 && buf[1] === 0x50, 'pdfFormFiller salida es PDF válido');
    await closeDialog(page);

    /* ── 10. flattenPdf ──────────────────────────────────────────────── */
    console.log('\n--- flattenPdf (aplanar-pdf) ---');
    await gotoPage(page, url, 'aplanar-pdf');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [formPdfFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('aplanado') || msg.includes('form') || msg.includes('anotacion'), `flattenPdf message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'flattenPdf genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x25 && buf[1] === 0x50, 'flattenPdf salida es PDF válido');
      const formFieldsAfter = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const pdfDoc = await PDFLib.PDFDocument.load(u);
        const form = pdfDoc.getForm();
        return form.getFields().length;
      }, toBase64(buf));
      ok(formFieldsAfter === 0, `flattenPdf elimina campos de formulario (${formFieldsAfter} campos restantes)`);
    }
    await closeDialog(page);

    /* ── 11. imagesToPdfAdvanced ─────────────────────────────────────── */
    console.log('\n--- imagesToPdfAdvanced (imagenes-a-pdf-optimizado) ---');
    await gotoPage(page, url, 'imagenes-a-pdf-optimizado');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [pngFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('imagen') || msg.includes('PDF') || msg.includes('optimizado'), `imagesToPdfAdvanced message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'imagesToPdfAdvanced genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) ok(buf[0] === 0x25 && buf[1] === 0x50, 'imagesToPdfAdvanced salida es PDF válido');
    await closeDialog(page);

    /* ── 12. pdfExtractResources ─────────────────────────────────────── */
    console.log('\n--- pdfExtractResources (extraer-fuentes-recursos-pdf) ---');
    await gotoPage(page, url, 'extraer-fuentes-recursos-pdf');
    await upload(page, [pdfFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('recurso') || msg.includes('detectado') || msg.includes('Páginas'), `pdfExtractResources message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pdfExtractResources genera reporte', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Reporte de recursos') || t.includes('Páginas'), 'pdfExtractResources salida tiene cabecera de reporte');
    }
    await closeDialog(page);

    /* ── 13. csvToPdf ────────────────────────────────────────────────── */
    console.log('\n--- csvToPdf (csv-a-pdf) ---');
    await gotoPage(page, url, 'csv-a-pdf');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await upload(page, [csvFile()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('CSV') || msg.includes('PDF'), `csvToPdf message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'csvToPdf genera PDF', buf ? buf.length + ' bytes' : 'null');
    if (buf) ok(buf[0] === 0x25 && buf[1] === 0x50, 'csvToPdf salida es PDF válido');
    await closeDialog(page);

    /* ── Errores de consola ──────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola en toda la suite');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.server.close();
  }

  const evidence = {
    suite: 'gate-e2e-pdf-office-new',
    updatedAt: new Date().toISOString(),
    tools: [
      'extractTextPdf', 'extractImagesPdf', 'pdfToPptx', 'pptxToPdf', 'excelToPdf',
      'htmlToPdf', 'pdfToPdfa', 'pdfToMarkdown', 'pdfFormFiller', 'flattenPdf',
      'imagesToPdfAdvanced', 'pdfExtractResources', 'csvToPdf',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
    limitation: 'pdfToPdfa solo optimiza metadatos, no genera PDF/A ISO-certificado. pdfToPptx rasteriza páginas como imágenes. pptxToPdf extrae imágenes incrustadas (no renderiza diapositivas). extractImagesPdf renderiza páginas (no extrae imágenes embebidas originales). pdfFormFiller rellena campos TextField, checkbox/radio limitados.',
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-pdf-office-new.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`\nEvidencia: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
