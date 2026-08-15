// gate-e2e-word-tools.mjs — Certificación E2E de las 20 herramientas de la familia Word
// sobre el deployment real en dist/. Genera fixtures DOCX/ODT/RTF en el navegador (docx.js + JSZip),
// procesa con la UI real y valida los resultados descargados con las librerías del propio sitio.
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'word-dl');
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
    '.json': 'application/json', '.pdf': 'application/pdf',
    '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.epub': 'application/epub+zip', '.odt': 'application/vnd.oasis.opendocument.text',
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

// Genera el fixture DOCX principal con encabezados, tabla, texto de reemplazo y párrafo vacío.
async function genMainDocx(page) {
  return page.evaluate(async () => {
    await new Promise((res, rej) => {
      if (window.docx) return res();
      const s = document.createElement('script');
      s.src = './vendor/docx/docx.min.js';
      s.onload = () => (window.docx ? res() : rej(new Error('no docx'))); s.onerror = () => rej(new Error('load fail docx'));
      document.head.appendChild(s);
    });
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = window.docx;
    const cell = (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text })] })] });
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: 'Informe Trimestral' })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: 'Ventas del primer trimestre 2026.' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Hola mundo, esta es una prueba de reemplazo.' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Total: 1234 unidades.' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Datos' })], heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell('Producto'), cell('Región'), cell('Total')] }),
              new TableRow({ children: [cell('Norte'), cell('Madrid'), cell('300')] }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: '' })] }),
        ],
      }],
    });
    const blob = await Packer.toBlob(doc);
    const buf = await blob.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// Fixture DOCX con metadatos de autor visibles (para stripMetadataWord).
async function genMetaDocx(page) {
  return page.evaluate(async () => {
    await new Promise((res, rej) => {
      if (window.docx) return res();
      const s = document.createElement('script');
      s.src = './vendor/docx/docx.min.js';
      s.onload = () => (window.docx ? res() : rej(new Error('no docx'))); s.onerror = () => rej(new Error('load fail docx'));
      document.head.appendChild(s);
    });
    const { Document, Packer, Paragraph, TextRun } = window.docx;
    const doc = new Document({
      coreProperties: {
        creator: 'Toolisto Test Author', title: 'Documento de prueba', subject: 'Prueba',
        keywords: ['prueba'], lastModifiedBy: 'toolisto',
        created: new Date('2026-01-01T00:00:00Z'), modified: new Date('2026-01-01T00:00:00Z'),
      },
      sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'Documento con metadatos para limpieza.' })] })] }],
    });
    const blob = await Packer.toBlob(doc);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

// Fixture ODT minimal (mismo esquema que genera wordToOdt).
async function genOdt(page) {
  return page.evaluate(async () => {
    if (!window.JSZip) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './vendor/jszip/jszip.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('no JSZip'));
        document.head.appendChild(script);
      });
    }
    const zip = new window.JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    zip.file('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text" office:version="1.2"><office:body><office:text><text:p>Informe Trimestral</text:p><text:p>Ventas del primer trimestre 2026.</text:p></office:text></office:body></office:document-content>');
    zip.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
    const blob = await zip.generateAsync({ type: 'blob' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

async function gotoPage(page, url, slug) {
  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
}

async function waitDialog(page, timeout = 30000) {
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

// Descarga el resultado y devuelve el buffer del archivo (o del ZIP agrupado).
async function downloadResult(page) {
  const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('#downloadButton');
  const dl = await dlPromise;
  if (!dl) return null;
  const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await dl.saveAs(tmp);
  return readFileSync(tmp);
}

// Devuelve el texto plano de un DOCX (carga mammoth si no está).
async function readDocxText(page, b64) {
  return page.evaluate(async (payload) => {
    const b64 = payload.b64;
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const load = (src, g) => new Promise((res, rej) => {
      if (window[g]) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = () => (window[g] ? res() : rej(new Error('no ' + g))); s.onerror = () => rej(new Error('fail ' + src));
      document.head.appendChild(s);
    });
    await load('./vendor/mammoth/mammoth.browser.min.js', 'mammoth');
    const r = await window.mammoth.extractRawText({ arrayBuffer: u.buffer });
    return r.value || '';
  }, { b64 });
}

// Inspección ZIP de un DOCX: entradas, [Content_Types].xml, word/document.xml, docProps/core.xml.
async function docxXmlReport(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const hasContentTypes = !!zip.file('[Content_Types].xml');
    const hasDocumentXml = !!zip.file('word/document.xml');
    let coreXml = null;
    const core = zip.file('docProps/core.xml');
    if (core) coreXml = await core.async('text');
    let docXml = null;
    const docF = zip.file('word/document.xml');
    if (docF) docXml = await docF.async('text');
    return { entries, hasContentTypes, hasDocumentXml, coreXml, docXml };
  }, { b64 });
}

// Texto de un PDF vía pdfjs (worker local).
async function pdfText(page, b64) {
  if (!await page.evaluate(() => !!window.pdfjsLib)) {
    await page.addScriptTag({ url: new URL('/vendor/pdfjs/pdf.min.js', page.url()).href });
  }
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    try {
      const pdf = await window.pdfjsLib.getDocument({ data: u.buffer }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const pg = await pdf.getPage(p);
        const tc = await pg.getTextContent();
        text += tc.items.map((it) => it.str || '').join(' ');
      }
      return { ok: true, pages: pdf.numPages, text };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, { b64 });
}

// Dimensiones + magic bytes de una imagen (JPG/PNG).
async function imageInfo(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const magic = Array.from(u.slice(0, 8)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
    const blob = new Blob([u], { type: payload.mime || 'application/octet-stream' });
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height, magic, bytes: u.length };
  }, { b64, mime: null });
}

// Texto UTF-8 de un archivo de texto.
async function readText(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
}

// Entradas de un ZIP.
async function zipEntries(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
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

// Lee una entrada concreta de un ZIP como texto.
async function zipEntryText(page, b64, entryName) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const f = zip.file(payload.entry);
    if (!f) return null;
    const c = await f.async('uint8array');
    return new TextDecoder('utf-8').decode(c);
  }, { b64, entry: entryName });
}

// Valida que cada entrada .docx de un ZIP sea un DOCX válido.
async function zipDocxValidity(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const out = [];
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir || !name.endsWith('.docx')) continue;
      const c = await zip.files[name].async('uint8array');
      const sub = await window.JSZip.loadAsync(c);
      out.push({ name, hasContentTypes: !!sub.file('[Content_Types].xml'), hasDocumentXml: !!sub.file('word/document.xml') });
    }
    return out;
  }, { b64 });
}

// EPUB: mimetype, dc:title, capítulos.
async function epubInfo(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const mimetype = await zip.file('mimetype').async('text');
    let opf = '';
    const opfF = zip.file('OEBPS/content.opf');
    if (opfF) opf = await opfF.async('text');
    const titleM = opf.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
    const chapters = [];
    for (const name of Object.keys(zip.files)) {
      if (/^OEBPS\/chapter\d+\.xhtml$/.test(name)) {
        const c = await zip.files[name].async('text');
        chapters.push(c);
      }
    }
    return { mimetype, title: titleM ? titleM[1] : null, chapters, entries: Object.keys(zip.files) };
  }, { b64 });
}

// ODT: mimetype + contenido XML.
async function odtInfo(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const mimetype = await zip.file('mimetype').async('text');
    const content = await zip.file('content.xml').async('text');
    return { mimetype, content };
  }, { b64 });
}

// XLSX: hojas + primera hoja en AOA.
async function xlsxAoa(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const wb = window.XLSX.read(u, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return { sheetNames: wb.SheetNames, aoa: window.XLSX.utils.sheet_to_json(ws, { header: 1 }) };
  }, { b64 });
}

async function run() {
  console.log('=== Gate E2E Word Tools (20 herramientas) ===\n');

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

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage(page, url, 'word-a-pdf');
    const mainDocx = Buffer.from(await genMainDocx(page), 'base64');
    ok(mainDocx.length > 1000, 'fixture main.docx generado (docx.js)', mainDocx.length + ' bytes');
    const metaDocx = Buffer.from(await genMetaDocx(page), 'base64');
    ok(metaDocx.length > 800, 'fixture meta.docx generado (coreProperties)', metaDocx.length + ' bytes');
    const odtBuf = Buffer.from(await genOdt(page), 'base64');
    ok(odtBuf.length > 400, 'fixture fixture.odt generado', odtBuf.length + ' bytes');
    const rtfBuf = Buffer.from('{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs28 Informe Trimestral\\par\\par Ventas del primer trimestre 2026.\\par}', 'latin1');
    ok(rtfBuf.length > 0, 'fixture fixture.rtf generado', rtfBuf.length + ' bytes');

    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const mainFile = () => [{ name: 'main.docx', mimeType: DOCX_MIME, buffer: mainDocx }];

    /* ── 1. wordToPdf ──────────────────────────────────────────────────── */
    console.log('\n--- wordToPdf (word-a-pdf) ---');
    await gotoPage(page, url, 'word-a-pdf');
    await upload(page, mainFile());
    await runTool(page);
    const pdfMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Converted 1 file\(s\) to PDF/.test(pdfMsg), `wordToPdf message: "${pdfMsg}"`);
    const pdfBuf = await downloadResult(page);
    ok(pdfBuf && pdfBuf.slice(0, 4).toString('latin1') === '%PDF', 'wordToPdf output es PDF', pdfBuf ? pdfBuf.slice(0, 5).toString('latin1') : 'no buffer');
    if (pdfBuf) {
      const pt = await pdfText(page, toBase64(pdfBuf));
      const extract = pt.ok ? JSON.stringify(pt.text.slice(0, 200)) : JSON.stringify(pt.error);
      ok(pt.ok && pt.text.includes('Informe') && pt.text.includes('Ventas'), 'wordToPdf contiene el texto del documento', `${pt.ok ? pt.text.length + ' chars' : 'error: ' + pt.error} ${extract}`);
    }
    await closeDialog(page);

    /* ── 2. wordToJpg ──────────────────────────────────────────────────── */
    console.log('\n--- wordToJpg (word-a-jpg) ---');
    await gotoPage(page, url, 'word-a-jpg');
    await upload(page, mainFile());
    await runTool(page);
    const jpgMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Converted 1 file\(s\) to JPG/.test(jpgMsg), `wordToJpg message: "${jpgMsg}"`);
    const jpgBuf = await downloadResult(page);
    if (jpgBuf && jpgBuf[0] === 0xFF && jpgBuf[1] === 0xD8 && jpgBuf[2] === 0xFF) pass('wordToJpg output es JPG (FF D8 FF)');
    else fail('wordToJpg output no es JPG');
    if (jpgBuf) {
      const ji = await imageInfo(page, toBase64(jpgBuf));
      ok(ji.w === 800 && ji.h > 100, `wordToJpg dimensiones ${ji.w}×${ji.h}`, `esperado 800×render contenido (>100)`);
    }
    await closeDialog(page);

    /* ── 3. wordToPng ──────────────────────────────────────────────────── */
    console.log('\n--- wordToPng (word-a-png) ---');
    await gotoPage(page, url, 'word-a-png');
    await upload(page, mainFile());
    await runTool(page);
    const pngMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Converted 1 file\(s\) to PNG/.test(pngMsg), `wordToPng message: "${pngMsg}"`);
    const pngBuf = await downloadResult(page);
    if (pngBuf && pngBuf[0] === 0x89 && pngBuf[1] === 0x50) pass('wordToPng output es PNG (89 50)');
    else fail('wordToPng output no es PNG');
    if (pngBuf) {
      const pi = await imageInfo(page, toBase64(pngBuf));
      ok(pi.w === 800 && pi.h > 100, `wordToPng dimensiones ${pi.w}×${pi.h}`, `esperado 800×render contenido (>100)`);
    }
    await closeDialog(page);

    /* ── 4. wordToHtml ─────────────────────────────────────────────────── */
    console.log('\n--- wordToHtml (word-a-html) ---');
    await gotoPage(page, url, 'word-a-html');
    await upload(page, mainFile());
    await runTool(page);
    const htmlBuf = await downloadResult(page);
    if (htmlBuf) {
      const ht = await readText(page, toBase64(htmlBuf));
      ok(ht.includes('<html'), 'wordToHtml output contiene <html>');
      ok(ht.includes('Informe Trimestral'), 'wordToHtml contiene el texto del documento');
    } else fail('wordToHtml sin archivo');
    await closeDialog(page);

    /* ── 5. wordToMarkdown ─────────────────────────────────────────────── */
    console.log('\n--- wordToMarkdown (word-a-markdown) ---');
    await gotoPage(page, url, 'word-a-markdown');
    await upload(page, mainFile());
    await runTool(page);
    const mdBuf = await downloadResult(page);
    if (mdBuf) {
      const md = await readText(page, toBase64(mdBuf));
      ok(md.includes('Informe Trimestral'), 'wordToMarkdown contiene el título');
      ok(md.includes('Ventas del primer trimestre 2026'), 'wordToMarkdown contiene el párrafo');
    } else fail('wordToMarkdown sin archivo');
    await closeDialog(page);

    /* ── 6. wordToEpub ─────────────────────────────────────────────────── */
    console.log('\n--- wordToEpub (word-a-epub) ---');
    await gotoPage(page, url, 'word-a-epub');
    await upload(page, mainFile());
    await runTool(page);
    const epubBuf = await downloadResult(page);
    if (epubBuf) {
      const ei = await epubInfo(page, toBase64(epubBuf));
      ok(ei.mimetype === 'application/epub+zip', 'wordToEpub mimetype correcto', ei.mimetype);
      ok(ei.title === 'main', 'wordToEpub dc:title = main', String(ei.title));
      ok(ei.chapters.length >= 1 && ei.chapters.some((c) => c.includes('Informe Trimestral')), 'wordToEpub capítulos con contenido', ei.chapters.length + ' capítulos');
    } else fail('wordToEpub sin archivo');
    await closeDialog(page);

    /* ── 7. wordToOdt ──────────────────────────────────────────────────── */
    console.log('\n--- wordToOdt (word-a-odt) ---');
    await gotoPage(page, url, 'word-a-odt');
    await upload(page, mainFile());
    await runTool(page);
    const odtOut = await downloadResult(page);
    if (odtOut) {
      const oi = await odtInfo(page, toBase64(odtOut));
      ok(oi.mimetype === 'application/vnd.oasis.opendocument.text', 'wordToOdt mimetype correcto', oi.mimetype);
      ok(oi.content.includes('Informe Trimestral'), 'wordToOdt content.xml contiene el texto');
    } else fail('wordToOdt sin archivo');
    await closeDialog(page);

    /* ── 8. odtToWord ──────────────────────────────────────────────────── */
    console.log('\n--- odtToWord (odt-a-word) ---');
    await gotoPage(page, url, 'odt-a-word');
    await upload(page, [{ name: 'fixture.odt', mimeType: 'application/vnd.oasis.opendocument.text', buffer: odtBuf }]);
    await runTool(page);
    const o2wBuf = await downloadResult(page);
    if (o2wBuf) {
      const rr = await docxXmlReport(page, toBase64(o2wBuf));
      ok(rr.hasContentTypes && rr.hasDocumentXml, 'odtToWord genera DOCX válido');
      const t = await readDocxText(page, toBase64(o2wBuf));
      ok(t.includes('Informe Trimestral'), 'odtToWord conserva el texto del ODT', t.slice(0, 60));
    } else fail('odtToWord sin archivo');
    await closeDialog(page);

    /* ── 9. rtfToWord ──────────────────────────────────────────────────── */
    console.log('\n--- rtfToWord (rtf-a-word) ---');
    await gotoPage(page, url, 'rtf-a-word');
    await upload(page, [{ name: 'fixture.rtf', mimeType: 'application/rtf', buffer: rtfBuf }]);
    await runTool(page);
    const r2wBuf = await downloadResult(page);
    if (r2wBuf) {
      const rr = await docxXmlReport(page, toBase64(r2wBuf));
      ok(rr.hasContentTypes && rr.hasDocumentXml, 'rtfToWord genera DOCX válido');
      const t = await readDocxText(page, toBase64(r2wBuf));
      ok(t.includes('Informe Trimestral'), 'rtfToWord conserva el texto del RTF', t.slice(0, 60));
    } else fail('rtfToWord sin archivo');
    await closeDialog(page);

    /* ── 10. mergeWord ─────────────────────────────────────────────────── */
    console.log('\n--- mergeWord (unir-documentos-word) ---');
    await gotoPage(page, url, 'unir-documentos-word');
    await upload(page, [
      { name: 'main.docx', mimeType: DOCX_MIME, buffer: mainDocx },
      { name: 'meta.docx', mimeType: DOCX_MIME, buffer: metaDocx },
    ]);
    await runTool(page);
    const mergeMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Merged 2 files/.test(mergeMsg), `mergeWord message: "${mergeMsg}"`);
    const mergeBuf = await downloadResult(page);
    if (mergeBuf) {
      const t = await readDocxText(page, toBase64(mergeBuf));
      ok(t.includes('Ventas del primer trimestre 2026'), 'mergeWord incluye el contenido del primer DOCX');
      ok(t.includes('Documento con metadatos para limpieza'), 'mergeWord incluye el contenido del segundo DOCX');
    } else fail('mergeWord sin archivo');
    await closeDialog(page);

    /* ── 11. splitWord ─────────────────────────────────────────────────── */
    console.log('\n--- splitWord (dividir-documento-word) ---');
    await gotoPage(page, url, 'dividir-documento-word');
    await upload(page, mainFile());
    await runTool(page);
    const splitMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Split into \d+ parts/.test(splitMsg), `splitWord message: "${splitMsg}"`);
    const splitBuf = await downloadResult(page);
    if (splitBuf) {
      const z = await zipEntries(page, toBase64(splitBuf));
      const docxParts = z.filter((e) => e.name.endsWith('.docx'));
      ok(docxParts.length >= 2, `splitWord genera ≥2 partes DOCX`, docxParts.length + ' partes');
      if (docxParts.length >= 2) {
        const v = await zipDocxValidity(page, toBase64(splitBuf));
        ok(v.length === docxParts.length && v.every((d) => d.hasDocumentXml), 'splitWord: cada parte es un DOCX válido');
      }
    } else fail('splitWord sin archivo');
    await closeDialog(page);

    /* ── 12. repairWord ────────────────────────────────────────────────── */
    console.log('\n--- repairWord (reparar-word) ---');
    await gotoPage(page, url, 'reparar-word');
    await upload(page, mainFile());
    await runTool(page);
    const repairMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Repair complete/.test(repairMsg), `repairWord message: "${repairMsg}"`);
    const repairZip = await downloadResult(page);
    if (repairZip) {
      const z = await zipEntries(page, toBase64(repairZip));
      const report = z.find((e) => e.name.endsWith('.txt'));
      const repaired = z.find((e) => e.name.endsWith('.docx'));
      ok(report && /_repair_report\.txt$/.test(report.name), 'repairWord incluye el reporte', report ? report.name : 'sin reporte');
      if (report) {
        const rt = await zipEntryText(page, toBase64(repairZip), report.name);
        ok(rt.includes('ZIP structure: OK'), 'repairWord reporte: ZIP OK');
        ok(rt.includes('word/document.xml: Found'), 'repairWord reporte: document.xml encontrado');
      }
      ok(repaired && /_repaired\.docx$/.test(repaired.name), 'repairWord incluye el DOCX reparado', repaired ? repaired.name : 'sin docx');
      if (repaired) {
        const v = await zipDocxValidity(page, toBase64(repairZip));
        ok(v.length >= 1 && v.every((d) => d.hasDocumentXml), 'repairWord DOCX reparado válido');
      }
    } else fail('repairWord sin archivo');
    await closeDialog(page);

    /* ── 13. compressWord ──────────────────────────────────────────────── */
    console.log('\n--- compressWord (comprimir-word) ---');
    await gotoPage(page, url, 'comprimir-word');
    await upload(page, mainFile());
    await runTool(page);
    const compressMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Compressed: \d+ bytes/.test(compressMsg), 'compressWord informa el tamaño comprimido');
    const compressBuf = await downloadResult(page);
    if (compressBuf) {
      const rr = await docxXmlReport(page, toBase64(compressBuf));
      ok(rr.hasContentTypes && rr.hasDocumentXml, 'compressWord genera DOCX válido');
    } else fail('compressWord sin archivo');
    await closeDialog(page);

    /* ── 14. stripMetadataWord ─────────────────────────────────────────── */
    console.log('\n--- stripMetadataWord (eliminar-metadatos-word) ---');
    await gotoPage(page, url, 'eliminar-metadatos-word');
    await upload(page, [{ name: 'meta.docx', mimeType: DOCX_MIME, buffer: metaDocx }]);
    await runTool(page);
    const stripMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Metadata stripped successfully/.test(stripMsg), `stripMetadataWord message: "${stripMsg}"`);
    const stripBuf = await downloadResult(page);
    if (stripBuf) {
      const rr = await docxXmlReport(page, toBase64(stripBuf));
      ok(rr.hasContentTypes && rr.hasDocumentXml, 'stripMetadataWord genera DOCX válido');
      ok(rr.coreXml !== null, 'stripMetadataWord conserva docProps/core.xml');
      ok(rr.coreXml && rr.coreXml.includes('<dc:creator>Anonymous</dc:creator>'), 'stripMetadataWord anonimiza el autor');
      ok(rr.coreXml && !rr.coreXml.includes('Toolisto Test Author'), 'stripMetadataWord elimina el autor original');
    } else fail('stripMetadataWord sin archivo');
    await closeDialog(page);

    /* ── 15. formatDocument ────────────────────────────────────────────── */
    console.log('\n--- formatDocument (uniformar-formato-documento) ---');
    await gotoPage(page, url, 'uniformar-formato-documento');
    await upload(page, mainFile());
    await runTool(page);
    const formatMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Document formatted with/.test(formatMsg), `formatDocument message: "${formatMsg}"`);
    const formatBuf = await downloadResult(page);
    if (formatBuf) {
      const rr = await docxXmlReport(page, toBase64(formatBuf));
      ok(rr.hasContentTypes && rr.hasDocumentXml, 'formatDocument genera DOCX válido');
      const t = await readDocxText(page, toBase64(formatBuf));
      ok(t.includes('Ventas del primer trimestre 2026'), 'formatDocument conserva el texto');
    } else fail('formatDocument sin archivo');
    await closeDialog(page);

    /* ── 16. tocWord ───────────────────────────────────────────────────── */
    console.log('\n--- tocWord (crear-tabla-de-contenido) ---');
    await gotoPage(page, url, 'crear-tabla-de-contenido');
    await upload(page, mainFile());
    await runTool(page);
    const tocMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Table of contents generated with \d+ entries/.test(tocMsg), `tocWord message: "${tocMsg}"`);
    const tocBuf = await downloadResult(page);
    if (tocBuf) {
      const t = await readDocxText(page, toBase64(tocBuf));
      ok(t.includes('Table of Contents'), 'tocWord incluye el título de la TOC');
      ok(t.includes('Informe Trimestral') && t.includes('Datos'), 'tocWord incluye los encabezados');
    } else fail('tocWord sin archivo');
    await closeDialog(page);

    /* ── 17. extractWord ───────────────────────────────────────────────── */
    console.log('\n--- extractWord (extraer-contenido-word) ---');
    await gotoPage(page, url, 'extraer-contenido-word');
    await upload(page, mainFile());
    await runTool(page);
    const extractMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Content extracted in txt format/.test(extractMsg), `extractWord message: "${extractMsg}"`);
    const extractBuf = await downloadResult(page);
    if (extractBuf) {
      const t = await readText(page, toBase64(extractBuf));
      ok(t.includes('Informe Trimestral'), 'extractWord extrae el texto');
      ok(t.includes('Ventas del primer trimestre 2026'), 'extractWord extrae los párrafos');
    } else fail('extractWord sin archivo');
    await closeDialog(page);

    /* ── 18. findReplaceWord ───────────────────────────────────────────── */
    console.log('\n--- findReplaceWord (buscar-reemplazar-documentos) ---');
    await gotoPage(page, url, 'buscar-reemplazar-documentos');
    await upload(page, mainFile());
    await page.waitForSelector('#search', { timeout: 8000, state: 'attached' });
    pass('findReplaceWord: controles de búsqueda visibles (fix htmlByTool)');
    await page.fill('#search', 'Hola');
    await page.fill('#replace', 'Saludos');
    await runTool(page);
    const frMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Replaced 1 occurrence/.test(frMsg), `findReplaceWord message: "${frMsg}"`);
    const frBuf = await downloadResult(page);
    if (frBuf) {
      const t = await readDocxText(page, toBase64(frBuf));
      ok(t.includes('Saludos'), 'findReplaceWord aplica el reemplazo');
      ok(!t.includes('Hola'), 'findReplaceWord elimina el texto original');
    } else fail('findReplaceWord sin archivo');
    await closeDialog(page);

    /* ── 19. tablesWordToExcel ─────────────────────────────────────────── */
    console.log('\n--- tablesWordToExcel (tablas-word-a-excel) ---');
    await gotoPage(page, url, 'tablas-word-a-excel');
    await upload(page, mainFile());
    await runTool(page);
    const xlsMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Extracted 1 table\(s\) to Excel/.test(xlsMsg), `tablesWordToExcel message: "${xlsMsg}"`);
    const xlsBuf = await downloadResult(page);
    if (xlsBuf) {
      const xa = await xlsxAoa(page, toBase64(xlsBuf));
      ok(xa.sheetNames.length >= 1 && xa.sheetNames[0] === 'Producto', 'tablesWordToExcel hoja "Producto"', String(xa.sheetNames[0]));
      ok(xa.aoa[0] && xa.aoa[0][0] === 'Producto' && xa.aoa[0][2] === 'Total', 'tablesWordToExcel header de tabla');
      ok(xa.aoa[1] && xa.aoa[1][0] === 'Norte' && xa.aoa[1][2] === '300', 'tablesWordToExcel fila de datos', JSON.stringify(xa.aoa[1]));
    } else fail('tablesWordToExcel sin archivo');
    await closeDialog(page);

    /* ── 20. removeBlankPagesWord ──────────────────────────────────────── */
    console.log('\n--- removeBlankPagesWord (eliminar-paginas-en-blanco-word) ---');
    await gotoPage(page, url, 'eliminar-paginas-en-blanco-word');
    await upload(page, mainFile());
    await runTool(page);
    const blankMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Removed approximately \d+ blank page/.test(blankMsg), `removeBlankPagesWord message: "${blankMsg}"`);
    const blankBuf = await downloadResult(page);
    if (blankBuf) {
      const rr = await docxXmlReport(page, toBase64(blankBuf));
      ok(rr.hasContentTypes && rr.hasDocumentXml, 'removeBlankPagesWord genera DOCX válido');
      const t = await readDocxText(page, toBase64(blankBuf));
      ok(t.includes('Ventas del primer trimestre 2026'), 'removeBlankPagesWord conserva el contenido');
    } else fail('removeBlankPagesWord sin archivo');
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
    suite: 'gate-e2e-word-tools',
    updatedAt: new Date().toISOString(),
    tools: [
      'wordToPdf', 'wordToJpg', 'wordToPng', 'wordToHtml', 'wordToMarkdown', 'wordToEpub', 'wordToOdt',
      'odtToWord', 'rtfToWord', 'mergeWord', 'splitWord', 'repairWord', 'compressWord', 'stripMetadataWord',
      'formatDocument', 'tocWord', 'extractWord', 'findReplaceWord', 'tablesWordToExcel', 'removeBlankPagesWord',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-word-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
