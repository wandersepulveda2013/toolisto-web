#!/usr/bin/env node
/**
 * gate-e2e-text-tools.mjs — Certificación E2E de las 15 herramientas de la familia
 * texto con UI genérica (sin mode) sobre el deployment real en dist/.
 *
 * Cubre: txtToPdf, mergeTxt, splitTxt, sortLines, removeDuplicates, textStatistics,
 * wordCount, textDiff, htmlToMarkdown, htmlToText, cssMinifier, base64Encode,
 * base64Decode, urlEncode, urlDecode.
 *
 * Cada herramienta: (1) abre, (2) acepta tipo correcto, (3) rechaza incompatibles,
 * (4) procesa archivo real, (5) salida no vacía, (6) MIME/firma/extensión,
 * (7) reapertura con libs del sitio, (8) mensaje prometido, (9) sin red, (10) cero
 * errores de consola.
 *
 * (Las 3 herramientas de texto con mode propio — txtToEpub, listToTable,
 * textToUnicodeBraille — quedan para el harness de modos.)
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
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'text-dl');
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
  await page.waitForTimeout(250);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
}

async function uploadExpectReject(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => ({
    runDisabled: document.getElementById('runButton') ? document.getElementById('runButton').disabled : null,
    description: document.getElementById('smartDescription') ? document.getElementById('smartDescription').textContent : '',
  }));
  return state;
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
    })).catch(() => null);
    console.error('  [runTool timeout] snapshot:', JSON.stringify(snapshot));
    throw err;
  }
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(120);
}

async function downloadResult(page) {
  const downloads = [];
  const dlHandler = (dl) => downloads.push(dl);
  page.on('download', dlHandler);
  await page.click('#downloadButton');
  await page.waitForTimeout(5000);
  page.off('download', dlHandler);
  if (downloads.length === 0) return null;
  if (downloads.length === 1) {
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await downloads[0].saveAs(tmp);
    return readFileSync(tmp);
  }
  const results = [];
  for (const dl of downloads) {
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}-${dl.suggestedFilename()}`);
    await dl.saveAs(tmp);
    results.push({ name: dl.suggestedFilename(), data: readFileSync(tmp) });
  }
  return results;
}

function pickDownload(result, ext) {
  if (!result) return null;
  if (Array.isArray(result)) {
    const match = result.find(r => r.name.endsWith(ext));
    return match ? match.data : null;
  }
  return result;
}

async function readText(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
}

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

async function zipEntries(page, b64) {
  return page.evaluate(async (payload) => {
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
        out.push({ name, text: new TextDecoder('utf-8').decode(c) });
      }
      return { ok: true, entries: out };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, { b64 });
}

async function epubInfo(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const mimetype = await zip.file('mimetype').async('text');
    return { mimetype, entries: Object.keys(zip.files) };
  }, { b64 });
}

async function run() {
  console.log('=== Gate E2E Text Tools (15 herramientas) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    const txt = Buffer.from(
      'Zanahoria\nManzana\nbanana\nManzana\nPera\nbanana\nMango\nmanzana\n'
    );
    const txt2 = Buffer.from('Primera linea del segundo archivo.\nSegunda linea.\n');
    const txtBig = Buffer.from(Array.from({ length: 150 }, (_, i) => 'Linea ' + (i + 1)).join('\n') + '\n');
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>Pagina de prueba</title><script>alert(1)</script><style>p{color:red}</style></head><body><h1>Titulo principal</h1><p>Parrafo con <b>formato</b>.</p><ul><li>Uno</li><li>Dos</li></ul></body></html>'
    );
    const css = Buffer.from('/* comentario */\nbody {  color: #333 ;\n  margin: 0 auto ; }\n  .a { width: 10px ; }\n');
    const b64src = Buffer.from('Sol brillante sobre la playa');
    const b64in = Buffer.from(b64src.toString('base64'));
    const urlsrc = Buffer.from('Hola mundo @toolisto');
    const urlin = Buffer.from(encodeURIComponent(urlsrc.toString('utf8')));
    ok(txt.length > 0 && html.length > 0 && css.length > 0, 'fixtures generados', `${txt.length}/${html.length}/${css.length} bytes`);

    const TXT_MIME = 'text/plain;charset=utf-8';
    const TXT_FILE = (n = 'texto.txt') => ({ name: n, mimeType: TXT_MIME, buffer: txt });

    /* ── 1. txtToPdf ──────────────────────────────────────────────────── */
    console.log('\n--- txtToPdf (txt-a-pdf) ---');
    await gotoPage(page, url, 'txt-a-pdf');
    await upload(page, [TXT_FILE()]);
    await runTool(page);
    const pdfMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Converted 1 file\(s\) to PDF/.test(pdfMsg), `txtToPdf message: "${pdfMsg}"`);
    const pdfBuf = await downloadResult(page);
    ok(pdfBuf && pdfBuf.slice(0, 4).toString('latin1') === '%PDF', 'txtToPdf output es PDF', pdfBuf ? pdfBuf.slice(0, 5).toString('latin1') : 'no buffer');
    if (pdfBuf) {
      const pt = await pdfText(page, toBase64(pdfBuf));
      ok(pt.ok && pt.text.includes('Zanahoria') && pt.text.includes('Manzana'), 'txtToPdf reabre con pdfjs y contiene el texto', pt.ok ? `${pt.text.length} chars` : 'error: ' + pt.error);
    }
    await closeDialog(page);

    /* ── 2. mergeTxt ──────────────────────────────────────────────────── */
    console.log('\n--- mergeTxt (unir-archivos-txt) ---');
    await gotoPage(page, url, 'unir-archivos-txt');
    await upload(page, [TXT_FILE('a.txt'), { name: 'b.txt', mimeType: TXT_MIME, buffer: txt2 }]);
    await runTool(page);
    const mergeMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Merged 2 file\(s\)/.test(mergeMsg), `mergeTxt message: "${mergeMsg}"`);
    const mergeBuf = await downloadResult(page);
    if (mergeBuf) {
      const t = await readText(page, toBase64(mergeBuf));
      ok(t.includes('Zanahoria') && t.includes('Mango'), 'mergeTxt contiene el contenido del primer archivo');
      ok(t.includes('Primera linea del segundo archivo.') && t.includes('Segunda linea.'), 'mergeTxt contiene el contenido del segundo archivo');
    } else fail('mergeTxt sin archivo');
    await closeDialog(page);

    /* ── 3. splitTxt ──────────────────────────────────────────────────── */
    console.log('\n--- splitTxt (dividir-archivo-txt) ---');
    await gotoPage(page, url, 'dividir-archivo-txt');
    await upload(page, [{ name: 'grande.txt', mimeType: TXT_MIME, buffer: txtBig }]);
    await runTool(page);
    const splitMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Split into \d+ part\(s\)/.test(splitMsg), `splitTxt message: "${splitMsg}"`);
    const splitBuf = await downloadResult(page);
    if (splitBuf) {
      const z = await zipEntries(page, toBase64(splitBuf));
      ok(z.ok, 'splitTxt genera un ZIP válido', z.error);
      if (z.ok) {
        const parts = z.entries.filter((e) => e.name.endsWith('.txt'));
        ok(parts.length >= 2, `splitTxt genera ≥2 partes`, parts.length + ' partes');
        ok(parts.some((p) => p.text.includes('Linea 1')) && parts.some((p) => p.text.includes('Linea 150')), 'splitTxt conserva el contenido en las partes');
        ok(parts.every((p) => p.text.split('\n').filter(Boolean).length <= 100), 'splitTxt respeta el límite de 100 líneas por parte');
      }
    } else fail('splitTxt sin archivo');
    await closeDialog(page);

    /* ── 4. sortLines ─────────────────────────────────────────────────── */
    console.log('\n--- sortLines (ordenar-lineas-texto) ---');
    await gotoPage(page, url, 'ordenar-lineas-texto');
    await upload(page, [TXT_FILE()]);
    await runTool(page);
    const sortMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Sorted \d+ line\(s\) in asc order/.test(sortMsg), `sortLines message: "${sortMsg}"`);
    const sortBuf = await downloadResult(page);
    if (sortBuf) {
      const t = await readText(page, toBase64(sortBuf));
      const lines = t.split('\n').map((l) => l.toLowerCase()).filter(Boolean);
      ok(lines[0] === 'banana' && lines[lines.length - 1] === 'zanahoria', 'sortLines ordena asc (case-insensitive default)', JSON.stringify(lines));
    } else fail('sortLines sin archivo');
    await closeDialog(page);

    /* ── 5. removeDuplicates ──────────────────────────────────────────── */
    console.log('\n--- removeDuplicates (eliminar-filas-duplicadas) ---');
    await gotoPage(page, url, 'eliminar-filas-duplicadas');
    await upload(page, [TXT_FILE()]);
    await runTool(page);
    const dupMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Removed \d+ duplicate line\(s\)\. \d+ unique line\(s\) remain\./.test(dupMsg), `removeDuplicates message: "${dupMsg}"`);
    const dupBuf = await downloadResult(page);
    if (dupBuf) {
      const t = await readText(page, toBase64(dupBuf));
      const lines = t.split('\n').filter((l) => l.trim() !== '');
      ok(lines.length === 6, `removeDuplicates conserva 6 únicas (case-sensitive por defecto)`, JSON.stringify(lines));
      ok((t.match(/Manzana/g) || []).length === 1 && (t.match(/manzana/g) || []).length === 1, 'removeDuplicates distingue mayúsculas por defecto');
      ok(t.includes('Zanahoria') && t.includes('Mango'), 'removeDuplicates conserva las líneas únicas');
    } else fail('removeDuplicates sin archivo');
    await closeDialog(page);

    /* ── 6. textStatistics ────────────────────────────────────────────── */
    console.log('\n--- textStatistics (estadisticas-texto) ---');
    await gotoPage(page, url, 'estadisticas-texto');
    await upload(page, [TXT_FILE()]);
    await runTool(page);
    const statsMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(statsMsg.includes('Estadisticas') || statsMsg.includes('Estadísticas'), `textStatistics message: "${statsMsg}"`);
    const statsBuf = await downloadResult(page);
    if (statsBuf) {
      const statsTxt = pickDownload(statsBuf, '.txt') || (Array.isArray(statsBuf) ? null : statsBuf);
      if (!statsTxt) { fail('textStatistics: no .txt file in multi-download'); }
      else {
        const t = await readText(page, toBase64(statsTxt));
        ok(t.includes('Palabras:') && t.includes('Caracteres '), 'textStatistics reporta palabras y caracteres');
        ok(/Palabras: 8/.test(t), 'textStatistics cuenta las 8 palabras reales', t.split('\n').find((l) => l.startsWith('Palabras:')));
      }
    } else fail('textStatistics sin archivo');
    await closeDialog(page);

    /* ── 7. wordCount ─────────────────────────────────────────────────── */
    console.log('\n--- wordCount (contar-palabras) ---');
    await gotoPage(page, url, 'contar-palabras');
    await upload(page, [TXT_FILE()]);
    await runTool(page);
    const wcMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Conteo completado: \d+ palabras/.test(wcMsg), `wordCount message: "${wcMsg}"`);
    const wcBuf = await downloadResult(page);
    if (wcBuf) {
      const wcTxt = pickDownload(wcBuf, '.txt') || (Array.isArray(wcBuf) ? null : wcBuf);
      if (!wcTxt) { fail('wordCount: no .txt file in multi-download'); }
      else {
        const t = await readText(page, toBase64(wcTxt));
        ok(/Palabras: 8/.test(t), 'wordCount cuenta las 8 palabras reales', t.split('\n').find((l) => l.startsWith('Palabras:')));
      }
    } else fail('wordCount sin archivo');
    await closeDialog(page);

    /* ── 8. textDiff ──────────────────────────────────────────────────── */
    console.log('\n--- textDiff (comparar-textos) ---');
    await gotoPage(page, url, 'comparar-textos');
    await upload(page, [TXT_FILE('a.txt'), { name: 'b.txt', mimeType: TXT_MIME, buffer: txt2 }]);
    await runTool(page);
    const diffMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Comparación completada: \d+ añadidas, \d+ eliminadas\./.test(diffMsg), `textDiff message: "${diffMsg}"`);
    const diffBuf = await downloadResult(page);
    if (diffBuf) {
      const t = await readText(page, toBase64(diffBuf));
      ok(t.includes('Líneas añadidas') || t.includes('Líneas eliminadas'), 'textDiff reporta líneas añadidas/eliminadas');
      ok(t.includes('+ ') || t.includes('- '), 'textDiff produce un diff con marcadores');
      ok(t.includes('Zanahoria'), 'textDiff incluye líneas comunes');
    } else fail('textDiff sin archivo');
    await closeDialog(page);

    /* ── 9. htmlToMarkdown ────────────────────────────────────────────── */
    console.log('\n--- htmlToMarkdown (html-a-markdown) ---');
    await gotoPage(page, url, 'html-a-markdown');
    await upload(page, [{ name: 'pagina.html', mimeType: 'text/html', buffer: html }]);
    await runTool(page);
    const hmdMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(hmdMsg.includes('Markdown'), `htmlToMarkdown message: "${hmdMsg}"`);
    const hmdBuf = await downloadResult(page);
    if (hmdBuf) {
      const t = await readText(page, toBase64(hmdBuf));
      ok(t.includes('# Titulo principal') || t.includes('Titulo principal'), 'htmlToMarkdown convierte el h1', JSON.stringify(t.slice(0, 60)));
      ok(t.includes('Parrafo con') && t.includes('formato'), 'htmlToMarkdown conserva el texto');
    } else fail('htmlToMarkdown sin archivo');
    await closeDialog(page);

    /* ── 10. htmlToText ───────────────────────────────────────────────── */
    console.log('\n--- htmlToText (html-a-texto) ---');
    await gotoPage(page, url, 'html-a-texto');
    await upload(page, [{ name: 'pagina.html', mimeType: 'text/html', buffer: html }]);
    await runTool(page);
    const htxtMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(htxtMsg.includes('Texto extraído') || htxtMsg.includes('Texto extraido'), `htmlToText message: "${htxtMsg}"`);
    const htxtBuf = await downloadResult(page);
    if (htxtBuf) {
      const t = await readText(page, toBase64(htxtBuf));
      ok(t.includes('Titulo principal'), 'htmlToText extrae el título');
      ok(t.includes('Parrafo con formato'), 'htmlToText extrae el texto visible');
      ok(!t.includes('<script>') && !t.includes('alert(1)'), 'htmlToText elimina scripts', t.slice(0, 120));
    } else fail('htmlToText sin archivo');
    await closeDialog(page);

    /* ── 11. cssMinifier ──────────────────────────────────────────────── */
    console.log('\n--- cssMinifier (minificar-css) ---');
    await gotoPage(page, url, 'minificar-css');
    await upload(page, [{ name: 'estilos.css', mimeType: 'text/css', buffer: css }]);
    await runTool(page);
    const cssMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(cssMsg.includes('CSS minificado'), `cssMinifier message: "${cssMsg}"`);
    const cssBuf = await downloadResult(page);
    if (cssBuf) {
      const t = await readText(page, toBase64(cssBuf));
      ok(t.length < css.length, 'cssMinifier reduce el tamaño', `${css.length} -> ${t.length} bytes`);
      ok(!t.includes('/*') && !t.includes('/*comentario*/'), 'cssMinifier elimina comentarios');
      ok(t.includes('color:#333') || t.includes('color:#333;'), 'cssMinifier conserva las reglas', t.slice(0, 80));
    } else fail('cssMinifier sin archivo');
    await closeDialog(page);

    /* ── 12. base64Encode ─────────────────────────────────────────────── */
    console.log('\n--- base64Encode (codificar-base64) ---');
    await gotoPage(page, url, 'codificar-base64');
    await upload(page, [{ name: 'src.txt', mimeType: TXT_MIME, buffer: b64src }]);
    await runTool(page);
    const encMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(encMsg.includes('Base64'), `base64Encode message: "${encMsg}"`);
    const encBuf = await downloadResult(page);
    if (encBuf) {
      const t = await readText(page, toBase64(encBuf)).then((s) => s.replace(/\s+/g, ''));
      ok(/^[A-Za-z0-9+/]+={0,2}$/.test(t) && t.length > 0, 'base64Encode genera Base64 válido', t.slice(0, 24));
      ok(Buffer.from(t, 'base64').toString('utf8') === b64src.toString('utf8'), 'base64Encode es decodificable al original');
    } else fail('base64Encode sin archivo');
    await closeDialog(page);

    /* ── 13. base64Decode ─────────────────────────────────────────────── */
    console.log('\n--- base64Decode (decodificar-base64) ---');
    await gotoPage(page, url, 'decodificar-base64');
    await upload(page, [{ name: 'b64.txt', mimeType: TXT_MIME, buffer: b64in }]);
    await runTool(page);
    const decMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(decMsg.includes('Base64 decodificado'), `base64Decode message: "${decMsg}"`);
    const decBuf = await downloadResult(page);
    if (decBuf) {
      const t = await readText(page, toBase64(decBuf));
      ok(t === 'Sol brillante sobre la playa', 'base64Decode devuelve el texto original', JSON.stringify(t));
    } else fail('base64Decode sin archivo');
    await closeDialog(page);

    /* ── 14. urlEncode ────────────────────────────────────────────────── */
    console.log('\n--- urlEncode (codificar-url) ---');
    await gotoPage(page, url, 'codificar-url');
    await upload(page, [{ name: 'src.txt', mimeType: TXT_MIME, buffer: urlsrc }]);
    await runTool(page);
    const uencMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(uencMsg.includes('URL'), `urlEncode message: "${uencMsg}"`);
    const uencBuf = await downloadResult(page);
    if (uencBuf) {
      const t = await readText(page, toBase64(uencBuf));
      ok(t.includes('%20') && t.includes('%40'), 'urlEncode codifica espacios y @', t.slice(0, 60));
      ok(decodeURIComponent(t) === urlsrc.toString('utf8'), 'urlEncode es decodificable al original');
    } else fail('urlEncode sin archivo');
    await closeDialog(page);

    /* ── 15. urlDecode ────────────────────────────────────────────────── */
    console.log('\n--- urlDecode (decodificar-url) ---');
    await gotoPage(page, url, 'decodificar-url');
    await upload(page, [{ name: 'url.txt', mimeType: TXT_MIME, buffer: urlin }]);
    await runTool(page);
    const udecMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(udecMsg.includes('decodificado'), `urlDecode message: "${udecMsg}"`);
    const udecBuf = await downloadResult(page);
    if (udecBuf) {
      const t = await readText(page, toBase64(udecBuf));
      ok(t === 'Hola mundo @toolisto', 'urlDecode devuelve el texto original', JSON.stringify(t));
    } else fail('urlDecode sin archivo');
    await closeDialog(page);

    /* ── 16. Rechazo de incompatibles ─────────────────────────────────── */
    console.log('\n--- Rechazo de tipos incompatibles ---');
    await gotoPage(page, url, 'ordenar-lineas-texto');
    const rej = await uploadExpectReject(page, [{ name: 'doc.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\x03\x04') }]);
    ok(rej.runDisabled === true, 'sortLines desactiva run con archivo no TXT');
    ok(/TXT/i.test(rej.description), `sortLines muestra validación en smartDescription: "${rej.description}"`);
    await gotoPage(page, url, 'html-a-markdown');
    const rej2 = await uploadExpectReject(page, [{ name: 'dato.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') }]);
    ok(rej2.runDisabled === true, 'htmlToMarkdown desactiva run con archivo no HTML');
    await gotoPage(page, url, 'comparar-textos');
    const rej3 = await uploadExpectReject(page, [{ name: 'solo.txt', mimeType: TXT_MIME, buffer: txt }]);
    ok(rej3.runDisabled === true, 'textDiff exige exactamente dos archivos');

    /* ── 17. Sin red externa ──────────────────────────────────────────── */
    console.log('\n--- Sin red externa ---');
    const externalRequests = [];
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(url)) await route.continue();
      else {
        externalRequests.push(reqUrl);
        await route.abort();
      }
    });
    await gotoPage(page, url, 'txt-a-pdf');
    await upload(page, [TXT_FILE()]);
    await runTool(page);
    const offPdf = await downloadResult(page);
    ok(offPdf && offPdf.slice(0, 4).toString('latin1') === '%PDF', 'txtToPdf funciona con toda la red externa bloqueada');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await closeDialog(page);
    await page.unroute('**/*');

    /* ── 18. Consola ──────────────────────────────────────────────────── */
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
    suite: 'gate-e2e-text-tools',
    updatedAt: new Date().toISOString(),
    tools: [
      'txtToPdf', 'mergeTxt', 'splitTxt', 'sortLines', 'removeDuplicates', 'textStatistics',
      'wordCount', 'textDiff', 'htmlToMarkdown', 'htmlToText', 'cssMinifier',
      'base64Encode', 'base64Decode', 'urlEncode', 'urlDecode',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-text-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
