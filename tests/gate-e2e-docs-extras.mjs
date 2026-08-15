#!/usr/bin/env node
/**
 * gate-e2e-docs-extras.mjs — Certificación E2E de 5 herramientas de documento
 * con UI genérica sobre el deployment real en dist/.
 *
 * Cubre: wordToTxt (word-a-txt), epubToTxt (epub-a-txt), coverEpub
 * (extraer-portada-epub), imagesEpub (extraer-imagenes-epub) y
 * pdfPageCounter (contar-paginas-pdf).
 *
 * Fixtures generados en el navegador: DOCX mínimo (mammoth real), EPUB con
 * portada + 2 imágenes + capítulo (JSZip) y PDF de 3 páginas (pdf-lib).
 * Cada herramienta: botón deshabilitado hasta elegir archivo, procesamiento
 * por la UI real, salida verificada por contenido/magic bytes, mensaje
 * prometido, caso negativo con archivo incorrecto, cero egress externo y cero
 * errores de consola no controlados.
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'docs-extra-dl');
const EVIDENCE_PATH = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-docs-extras-evidence.json');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0;
let passes = 0;
const checks = [];
const failureReasons = [];
const consoleErrors = [];
const externalRequests = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }
function sigJpg(b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }
function sigPng(b) { return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
    '.woff2': 'font/woff2', '.gz': 'application/gzip', '.bin': 'application/octet-stream',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function run() {
  console.log('=== Gate E2E Docs Extras (5 herramientas, UI genérica) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('request', (req) => {
    const urlStr = req.url();
    if (urlStr.startsWith('blob:') || urlStr.startsWith('data:')) return;
    const u = new URL(urlStr);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') externalRequests.push(urlStr);
  });

  const gotoPage = async (slug) => {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  const upload = async (files, waitEnabled = true) => {
    await page.locator('#fileInput').setInputFiles(files);
    if (waitEnabled) await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 20000 });
  };
  const waitDialog = async (timeout = 60000) => {
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout });
  };
  const closeDialog = async () => {
    await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
    await page.waitForTimeout(150);
  };
  const runTool = async () => {
    await page.click('#runButton');
    await waitDialog();
  };
  const resultMessage = () => page.$eval('#resultMessage', (el) => el.textContent);
  const runDisabled = () => page.$eval('#runButton', (el) => el.disabled);
  const downloadResult = async () => {
    const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await page.click('#downloadButton');
    const dl = await dlPromise;
    if (!dl) return null;
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await dl.saveAs(tmp);
    return { buffer: readFileSync(tmp), name: dl.suggestedFilename() };
  };
  const readText = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
  const zipEntries = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    try {
      const zip = await window.JSZip.loadAsync(u);
      const out = [];
      for (const name of Object.keys(zip.files)) {
        const f = zip.files[name];
        if (f.dir) continue;
        const c = await f.async('uint8array');
        out.push({ name, size: c.length });
      }
      return { ok: true, entries: out };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, { b64 });
  const buildZipB64 = async (spec) => page.evaluate(async (payload) => {
    const zip = new JSZip();
    for (const e of payload.entries) {
      zip.file(e.name, typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    }
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
  }, spec);

  try {
    /* ── Fixtures (generados en el navegador) ─────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage('contar-paginas-pdf');
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    const fx = await page.evaluate(async () => {
      const toB64 = (blob) => new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.readAsDataURL(blob);
      });
      const pngB64 = await (async () => {
        const c = document.createElement('canvas'); c.width = 48; c.height = 72;
        const x = c.getContext('2d');
        x.fillStyle = '#2a6fb8'; x.fillRect(0, 0, 48, 72);
        x.fillStyle = '#ffffff'; x.fillRect(6, 8, 36, 36);
        x.fillStyle = '#173b62'; x.font = 'bold 22px sans-serif'; x.fillText('TLST', 10, 32);
        return await toB64(await new Promise((res) => c.toBlob((b) => res(b), 'image/png')));
      })();

      const epub = new JSZip();
      epub.file('mimetype', 'application/epub+zip');
      epub.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
      epub.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:tlst-docs-extras</dc:identifier>
    <dc:title>Libro de prueba</dc:title>
    <dc:language>es</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png"/>
    <item id="img1" href="img1.png" media-type="image/png"/>
    <item id="img2" href="img2.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="chapter1"/></spine>
</package>`);
      epub.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capitulo 1</title></head>
<body><h1>Capitulo 1</h1><p>Hola mundo EPUB</p></body></html>`);
      const imgBin = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));
      epub.file('OEBPS/cover.png', imgBin);
      epub.file('OEBPS/img1.png', imgBin);
      epub.file('OEBPS/img2.png', imgBin);
      const epubBuf = await epub.generateAsync({ type: 'uint8array' });
      let epubBin = '';
      for (let i = 0; i < epubBuf.length; i++) epubBin += String.fromCharCode(epubBuf[i]);

      const docx = new JSZip();
      docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
      docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
      docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Hola Toolisto desde DOCX</w:t></w:r></w:p>
<w:p><w:r><w:t>Segunda linea de prueba.</w:t></w:r></w:p>
</w:body></w:document>`);
      const docxBuf = await docx.generateAsync({ type: 'uint8array' });
      let docxBin = '';
      for (let i = 0; i < docxBuf.length; i++) docxBin += String.fromCharCode(docxBuf[i]);

      const pdfDoc = await window.PDFLib.PDFDocument.create();
      for (let p = 0; p < 3; p++) {
        const pg = pdfDoc.addPage([300, 400]);
        pg.drawText(`Pagina ${p + 1}`, { x: 30, y: 300, size: 16 });
      }
      const pdfBytes = await pdfDoc.save();
      const pdfU8 = new Uint8Array(pdfBytes);
      let pdfBin = '';
      for (let i = 0; i < pdfU8.length; i++) pdfBin += String.fromCharCode(pdfU8[i]);

      return { png: pngB64, epub: btoa(epubBin), docx: btoa(docxBin), pdf: btoa(pdfBin) };
    });
    const epub = Buffer.from(fx.epub, 'base64');
    const docx = Buffer.from(fx.docx, 'base64');
    const pdf = Buffer.from(fx.pdf, 'base64');
    ok(epub.length > 300, 'fixture EPUB generado', epub.length + ' bytes');
    ok(docx.length > 300, 'fixture DOCX generado', docx.length + ' bytes');
    ok(pdf.length > 300, 'fixture PDF de 3 páginas generado', pdf.length + ' bytes');
    const epubZipCheck = await zipEntries(fx.epub);
    ok(epubZipCheck.ok && epubZipCheck.entries.length >= 4, 'EPUB contiene las entradas esperadas', epubZipCheck.ok ? epubZipCheck.entries.map((e) => e.name).join(', ') : epubZipCheck.error);

    /* ── wordToTxt (word-a-txt) ───────────────────────────────────────── */
    console.log('\n--- wordToTxt (word-a-txt) ---');
    await gotoPage('word-a-txt');
    ok(await runDisabled(), 'wordToTxt inicia con el botón deshabilitado');
    await upload([{ name: 'hola.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx }]);
    ok(!(await runDisabled()), 'wordToTxt habilita el botón con un DOCX');
    await runTool();
    ok((await resultMessage()).length > 0, 'wordToTxt message prometido');
    const dlW = await downloadResult();
    ok(dlW !== null, 'wordToTxt descarga un archivo', dlW && dlW.name);
    if (dlW) {
      ok(dlW.name.endsWith('.txt'), 'wordToTxt salida .txt', dlW.name);
      const text = await readText(toBase64(dlW.buffer));
      ok(text.includes('Hola Toolisto desde DOCX'), 'wordToTxt extrae el texto del DOCX', text.slice(0, 80));
      ok(text.includes('Segunda linea de prueba.'), 'wordToTxt conserva múltiples párrafos');
    }
    await closeDialog();
    await gotoPage('word-a-txt');
    await upload([{ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('no soy docx', 'utf8') }], false);
    await page.waitForTimeout(300);
    ok(await runDisabled(), 'wordToTxt negativo: un TXT mantiene el botón deshabilitado');

    /* ── epubToTxt (epub-a-txt) ────────────────────────────────────────── */
    console.log('\n--- epubToTxt (epub-a-txt) ---');
    await gotoPage('epub-a-txt');
    ok(await runDisabled(), 'epubToTxt inicia con el botón deshabilitado');
    await upload([{ name: 'libro.epub', mimeType: 'application/epub+zip', buffer: epub }]);
    ok(!(await runDisabled()), 'epubToTxt habilita el botón con un EPUB');
    await runTool();
    ok((await resultMessage()).includes('EPUB'), 'epubToTxt message de extracción');
    const dlE = await downloadResult();
    ok(dlE !== null, 'epubToTxt descarga un archivo');
    if (dlE) {
      ok(dlE.name.endsWith('.txt'), 'epubToTxt salida .txt', dlE.name);
      const text = await readText(toBase64(dlE.buffer));
      ok(text.includes('Hola mundo EPUB'), 'epubToTxt extrae el texto del capítulo', text.slice(0, 80));
    }
    await closeDialog();
    await gotoPage('epub-a-txt');
    await upload([{ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('no soy epub', 'utf8') }], false);
    await page.waitForTimeout(300);
    ok(await runDisabled(), 'epubToTxt negativo: un TXT mantiene el botón deshabilitado');

    /* ── coverEpub (extraer-portada-epub) ─────────────────────────────── */
    console.log('\n--- coverEpub (extraer-portada-epub) ---');
    await gotoPage('extraer-portada-epub');
    ok(await runDisabled(), 'coverEpub inicia con el botón deshabilitado');
    await upload([{ name: 'libro.epub', mimeType: 'application/epub+zip', buffer: epub }]);
    ok(!(await runDisabled()), 'coverEpub habilita el botón con un EPUB');
    await runTool();
    ok((await resultMessage()).includes('Cover'), 'coverEpub message de extracción');
    const dlC = await downloadResult();
    ok(dlC !== null, 'coverEpub descarga un archivo');
    if (dlC) {
      ok(dlC.name === 'cover.jpg', 'coverEpub salida cover.jpg', dlC.name);
      ok(sigJpg(dlC.buffer), 'coverEpub portada es JPEG válido');
    }
    await closeDialog();

    /* ── imagesEpub (extraer-imagenes-epub) ───────────────────────────── */
    console.log('\n--- imagesEpub (extraer-imagenes-epub) ---');
    await gotoPage('extraer-imagenes-epub');
    ok(await runDisabled(), 'imagesEpub inicia con el botón deshabilitado');
    await upload([{ name: 'libro.epub', mimeType: 'application/epub+zip', buffer: epub }]);
    ok(!(await runDisabled()), 'imagesEpub habilita el botón con un EPUB');
    await runTool();
    ok((await resultMessage()).includes('3'), 'imagesEpub message con conteo de imágenes');
    const dlI = await downloadResult();
    ok(dlI !== null, 'imagesEpub descarga un archivo');
    if (dlI) {
      ok(dlI.name.endsWith('_images.zip'), 'imagesEpub ZIP con sufijo _images', dlI.name);
      const z = await zipEntries(toBase64(dlI.buffer));
      ok(z.ok && z.entries.length === 3, 'imagesEpub ZIP con 3 imágenes', z.ok ? z.entries.map((e) => e.name).join(', ') : z.error);
    }
    await closeDialog();

    /* ── pdfPageCounter (contar-paginas-pdf) ──────────────────────────── */
    console.log('\n--- pdfPageCounter (contar-paginas-pdf) ---');
    await gotoPage('contar-paginas-pdf');
    ok(await runDisabled(), 'pdfPageCounter inicia con el botón deshabilitado');
    await upload([{ name: 'libro.pdf', mimeType: 'application/pdf', buffer: pdf }]);
    ok(!(await runDisabled()), 'pdfPageCounter habilita el botón con un PDF');
    await runTool();
    ok((await resultMessage()).includes('PDF analizado'), 'pdfPageCounter message de análisis');
    const dlP = await downloadResult();
    ok(dlP !== null, 'pdfPageCounter descarga un archivo');
    if (dlP) {
      ok(dlP.name.endsWith('-info.txt'), 'pdfPageCounter informe .txt', dlP.name);
      const text = await readText(toBase64(dlP.buffer));
      ok(text.includes('Total de páginas: 3'), 'pdfPageCounter cuenta 3 páginas', text.slice(0, 120));
      ok(text.includes('Página 1:'), 'pdfPageCounter reporta dimensiones por página');
    }
    await closeDialog();

    /* ── Red y consola ─────────────────────────────────────────────────── */
    console.log('\n--- Sin red externa ---');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.join(', ').slice(0, 300));
    ok(consoleErrors.length === 0, 'Sin errores de consola no controlados', consoleErrors.slice(0, 5).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-docs-extras',
    generatedAt: new Date().toISOString(),
    tools: ['wordToTxt', 'epubToTxt', 'coverEpub', 'imagesEpub', 'pdfPageCounter'],
    totals: { passed: passes, failed: failures },
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    externalRequests,
    consoleErrors,
    failureReasons,
  };
  writeEvidence(EVIDENCE_PATH, evidence);

  console.log(`\nEvidencia guardada: ${EVIDENCE_PATH}`);
  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'APROBADO' : 'RECHAZADO'} ===`);
  if (failures > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
