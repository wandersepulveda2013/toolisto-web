// gate-e2e-epub-tools.mjs — Certificación E2E de las 7 herramientas de la familia EPUB
// sobre el deployment real en dist/. Genera fixtures EPUB en el navegador (JSZip), procesa
// con la UI real y valida los resultados descargados (JSZip + DOMParser).
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'epub-dl');
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
    '.ttf': 'font/ttf', '.epub': 'application/epub+zip',
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

// Construye un ZIP en el navegador y devuelve base64.
async function buildZip(page, entryList) {
  return page.evaluate(async (payload) => {
    const zip = new window.JSZip();
    for (const e of payload.entries) {
      const opts = e.store ? { compression: 'STORE' } : undefined;
      zip.file(e.name, e.content, opts);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }, { entries: entryList });
}

// Fixture EPUB principal: 2 capítulos + imagen + metadatos completos.
async function genEpubMain(page) {
  const containerXml = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>';
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:title>El Arte de Certificar EPUBs</dc:title>
    <dc:creator>Autor Original</dc:creator>
    <dc:language>es</dc:language>
    <dc:description>Descripción original del libro</dc:description>
    <dc:publisher>Toolisto Press</dc:publisher>
    <dc:rights>Copyright original</dc:rights>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="styles/default.css" media-type="text/css"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:11111111-2222-3333-4444-555555555555"/></head>
  <docTitle><text>El Arte de Certificar EPUBs</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1"><navLabel><text>Capítulo Uno</text></navLabel><content src="chapter1.xhtml"/></navPoint>
    <navPoint id="np2" playOrder="2"><navLabel><text>Capítulo Dos</text></navLabel><content src="chapter2.xhtml"/></navPoint>
  </navMap>
</ncx>`;
  const ch1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="UTF-8"/><title>Capítulo Uno</title></head>
<body>
<h1>Capítulo Uno</h1>
<p>El arte de certificar herramientas EPUB comienza con un buen fixture.</p>
<ul>
<li>Primer punto</li>
<li>Segundo punto</li>
</ul>
<p><strong>Negrita</strong> y <em>cursiva</em> en el texto.</p>
<img src="images/cover.png" alt="portada de prueba"/>
</body>
</html>`;
  const ch2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="UTF-8"/><title>Capítulo Dos</title></head>
<body>
<h2>Capítulo Dos</h2>
<p>El flujo de archivo a resultado dentro del propio navegador.</p>
<blockquote>Local-first, sin salir del proyecto.</blockquote>
<table>
<tr><th>Producto</th><th>Total</th></tr>
<tr><td>Libro</td><td>10</td></tr>
</table>
</body>
</html>`;
  // PNG 1×1 transparente.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return buildZip(page, [
    { name: 'mimetype', content: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', content: containerXml },
    { name: 'OEBPS/content.opf', content: opf },
    { name: 'OEBPS/toc.ncx', content: ncx },
    { name: 'OEBPS/styles/default.css', content: 'body{font-family:serif;line-height:1.6;margin:1em}' },
    { name: 'OEBPS/chapter1.xhtml', content: ch1 },
    { name: 'OEBPS/chapter2.xhtml', content: ch2 },
    { name: 'OEBPS/images/cover.png', content: png },
  ]);
}

// Segundo fixture EPUB (para mergeEpub): 1 capítulo.
async function genEpubBook2(page) {
  const containerXml = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>';
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:aaaa-bbbb-cccc-dddd-eeee00000000</dc:identifier>
    <dc:title>El Segundo Libro de Prueba</dc:title>
    <dc:creator>Autora Secundaria</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="capitulo.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>`;
  const ncx = '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="urn:uuid:aaaa-bbbb-cccc-dddd-eeee00000000"/></head>\n  <docTitle><text>El Segundo Libro de Prueba</text></docTitle>\n  <navMap>\n    <navPoint id="np1" playOrder="1"><navLabel><text>Capítulo Tres</text></navLabel><content src="capitulo.xhtml"/></navPoint>\n  </navMap>\n</ncx>';
  const ch = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="UTF-8"/><title>Capítulo Tres</title></head>
<body>
<h1>Capítulo Tres</h1>
<p>Contenido del segundo libro para probar la unión de EPUBs.</p>
</body>
</html>`;
  return buildZip(page, [
    { name: 'mimetype', content: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', content: containerXml },
    { name: 'OEBPS/content.opf', content: opf },
    { name: 'OEBPS/toc.ncx', content: ncx },
    { name: 'OEBPS/capitulo.xhtml', content: ch },
  ]);
}

// Fixture EPUB roto (para validateEpub/repairEpub): sin mimetype, sin container.xml,
// manifiesto con referencias rotas (styles/default.css y missing.xhtml) y toc.ncx ausente.
async function genEpubBroken(page) {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:99999999-9999-9999-9999-999999999999</dc:identifier>
    <dc:title>Libro Roto</dc:title>
    <dc:language>es</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="styles/default.css" media-type="text/css"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="missing.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;
  const ch1 = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo Único</title></head><body><h1>Capítulo Único</h1><p>Contenido del capítulo roto.</p></body></html>`;
  const ncx = '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="urn:uuid:99999999-9999-9999-9999-999999999999"/></head>\n  <docTitle><text>Libro Roto</text></docTitle>\n  <navMap>\n    <navPoint id="np1" playOrder="1"><navLabel><text>Capítulo Único</text></navLabel><content src="chapter1.xhtml"/></navPoint>\n  </navMap>\n</ncx>';
  return buildZip(page, [
    { name: 'OEBPS/content.opf', content: opf },
    { name: 'OEBPS/chapter1.xhtml', content: ch1 },
    { name: 'OEBPS/toc.ncx', content: ncx },
  ]);
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

async function zipEntries(page, b64) {
  if (!await page.evaluate(() => !!window.JSZip)) {
    await page.addScriptTag({ url: new URL('/vendor/jszip/jszip.min.js', page.url()).href });
  }
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

// Bytes crudos de una entrada (base64), sin round-trip de texto.
async function zipEntryB64(page, b64, entryName) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const f = zip.file(payload.entry);
    if (!f) return null;
    const c = await f.async('uint8array');
    let out = '';
    for (let i = 0; i < c.length; i++) out += String.fromCharCode(c[i]);
    return btoa(out);
  }, { b64, entry: entryName });
}

// Inspección completa de un EPUB: mimetype, container.xml, OPF (en OEBPS/ o raíz),
// metadatos y capítulos XHTML.
async function epubInspect(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    let mimetype = null;
    const mt = zip.file('mimetype');
    if (mt) mimetype = (await mt.async('text')).trim();
    let containerXml = null;
    const ctr = zip.file('META-INF/container.xml');
    if (ctr) containerXml = await ctr.async('text');
    let opf = null;
    let opfPath = null;
    for (const cand of ['OEBPS/content.opf', 'content.opf']) {
      const f = zip.file(cand);
      if (f) { opf = await f.async('text'); opfPath = cand; break; }
    }
    const get = (re) => { const m = opf ? opf.match(re) : null; return m ? m[1] : null; };
    const chapters = [];
    for (const name of entries) {
      if (/\.x?html$/i.test(name) && !/^OEBPS\/toc/.test(name)) {
        chapters.push({ name, text: await zip.files[name].async('text') });
      }
    }
    return {
      entries, mimetype, containerXml, opfPath, opf,
      title: get(/<dc:title>([\s\S]*?)<\/dc:title>/),
      creator: get(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/),
      language: get(/<dc:language>([\s\S]*?)<\/dc:language>/),
      description: get(/<dc:description>([\s\S]*?)<\/dc:description>/),
      publisher: get(/<dc:publisher>([\s\S]*?)<\/dc:publisher>/),
      rights: get(/<dc:rights>([\s\S]*?)<\/dc:rights>/),
      identifier: get(/<dc:identifier[^>]*>([\s\S]*?)<\/dc:identifier>/),
      chapters,
    };
  }, { b64 });
}

// Inspección de cada parte EPUB dentro de un ZIP (salida de splitEpub).
async function zipEpubParts(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const out = [];
    for (const name of Object.keys(zip.files)) {
      const f = zip.files[name];
      if (f.dir || !name.endsWith('.epub')) continue;
      const c = await f.async('uint8array');
      const sub = await window.JSZip.loadAsync(c);
      let mimetype = null;
      const mt = sub.file('mimetype');
      if (mt) mimetype = (await mt.async('text')).trim();
      let opf = null;
      const opfF = sub.file('OEBPS/content.opf');
      if (opfF) opf = await opfF.async('text');
      const chapters = [];
      for (const innerName of Object.keys(sub.files)) {
        if (/\.x?html$/i.test(innerName) && !/^OEBPS\/toc/.test(innerName)) {
          chapters.push(await sub.files[innerName].async('text'));
        }
      }
      out.push({
        name,
        hasContainer: !!sub.file('META-INF/container.xml'),
        hasOpf: !!opfF,
        mimetype,
        title: opf ? (opf.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1] : null,
        chapters,
      });
    }
    return out;
  }, { b64 });
}

async function run() {
  console.log('=== Gate E2E EPUB Tools (7 herramientas) ===\n');

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

  const EPUB_MIME = 'application/epub+zip';

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage(page, url, 'epub-a-html');
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    const mainEpub = Buffer.from(await genEpubMain(page), 'base64');
    ok(mainEpub.length > 600, 'fixture main.epub generado', mainEpub.length + ' bytes');
    const book2Epub = Buffer.from(await genEpubBook2(page), 'base64');
    ok(book2Epub.length > 400, 'fixture book2.epub generado', book2Epub.length + ' bytes');
    const brokenEpub = Buffer.from(await genEpubBroken(page), 'base64');
    ok(brokenEpub.length > 300, 'fixture broken.epub generado', brokenEpub.length + ' bytes');

    /* ── 1. epubToHtml ─────────────────────────────────────────────────── */
    console.log('\n--- epubToHtml (epub-a-html) ---');
    await gotoPage(page, url, 'epub-a-html');
    await upload(page, [{ name: 'main.epub', mimeType: EPUB_MIME, buffer: mainEpub }]);
    await page.waitForSelector('#singleFile', { timeout: 8000, state: 'attached' });
    pass('epubToHtml: control singleFile visible');
    await runTool(page);
    const htmlMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Extracted HTML from EPUB\./.test(htmlMsg), `epubToHtml message: "${htmlMsg}"`);
    const htmlBuf = await downloadResult(page);
    if (htmlBuf) {
      const ht = await readText(page, toBase64(htmlBuf));
      ok(ht.includes('<html'), 'epubToHtml output contiene <html>');
      ok(ht.includes('Capítulo Uno') && ht.includes('Capítulo Dos'), 'epubToHtml incluye ambos capítulos');
      ok(ht.includes('certificar herramientas EPUB'), 'epubToHtml incluye el texto del capítulo 1');
      ok(ht.includes('Local-first, sin salir del proyecto.'), 'epubToHtml incluye el texto del capítulo 2');
    } else fail('epubToHtml sin archivo');
    await closeDialog(page);

    // Rama multi-archivo (singleFile desactivado).
    await page.uncheck('#singleFile');
    await runTool(page);
    const htmlZip = await downloadResult(page);
    if (htmlZip) {
      const z = await zipEntries(page, toBase64(htmlZip));
      const xhtml = z.filter((e) => /\.xhtml$/.test(e.name));
      ok(xhtml.length === 2, 'epubToHtml multi genera 2 XHTML', xhtml.length + ' archivos');
      if (xhtml.length === 2) {
        const c1 = await zipEntryText(page, toBase64(htmlZip), xhtml[0].name);
        const c2 = await zipEntryText(page, toBase64(htmlZip), xhtml[1].name);
        ok((c1.includes('Capítulo Uno') || c2.includes('Capítulo Uno')) && (c1.includes('Capítulo Dos') || c2.includes('Capítulo Dos')), 'epubToHtml multi reparte los capítulos');
      }
    } else fail('epubToHtml multi sin archivo');
    await closeDialog(page);

    /* ── 2. epubToMarkdown ─────────────────────────────────────────────── */
    console.log('\n--- epubToMarkdown (epub-a-markdown) ---');
    await gotoPage(page, url, 'epub-a-markdown');
    await upload(page, [{ name: 'main.epub', mimeType: EPUB_MIME, buffer: mainEpub }]);
    await page.waitForSelector('#singleFile', { timeout: 8000, state: 'attached' });
    pass('epubToMarkdown: control singleFile visible');
    await runTool(page);
    const mdMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Converted EPUB to Markdown\./.test(mdMsg), `epubToMarkdown message: "${mdMsg}"`);
    const mdBuf = await downloadResult(page);
    if (mdBuf) {
      const md = await readText(page, toBase64(mdBuf));
      ok(md.includes('# Capítulo Uno'), 'epubToMarkdown H1 → "# Capítulo Uno"');
      ok(md.includes('## Capítulo Dos'), 'epubToMarkdown H2 → "## Capítulo Dos"');
      ok(md.includes('- Primer punto') && md.includes('- Segundo punto'), 'epubToMarkdown lista → "-"');
      ok(md.includes('**Negrita**') && md.includes('*cursiva*'), 'epubToMarkdown negrita/cursiva');
      ok(md.includes('![portada de prueba](images/cover.png)'), 'epubToMarkdown imagen markdown');
      ok(md.includes('> Local-first, sin salir del proyecto.'), 'epubToMarkdown cita → ">"');
      ok(md.includes('| Producto | Total |') && md.includes('| Libro | 10 |'), 'epubToMarkdown tabla markdown');
    } else fail('epubToMarkdown sin archivo');
    await closeDialog(page);

    // Rama multi-archivo (fix singleFile en tool-processors.js).
    await page.uncheck('#singleFile');
    await runTool(page);
    const mdZip = await downloadResult(page);
    if (mdZip) {
      const z = await zipEntries(page, toBase64(mdZip));
      const mds = z.filter((e) => /\.md$/.test(e.name));
      ok(mds.length === 2, 'epubToMarkdown multi genera 2 .md', mds.length + ' archivos');
    } else fail('epubToMarkdown multi sin archivo');
    await closeDialog(page);

    /* ── 3. mergeEpub ──────────────────────────────────────────────────── */
    console.log('\n--- mergeEpub (unir-epub) ---');
    await gotoPage(page, url, 'unir-epub');
    await upload(page, [
      { name: 'main.epub', mimeType: EPUB_MIME, buffer: mainEpub },
      { name: 'book2.epub', mimeType: EPUB_MIME, buffer: book2Epub },
    ]);
    await page.waitForSelector('#title', { timeout: 8000, state: 'attached' });
    pass('mergeEpub: controles de título/autor/idioma visibles');
    await page.fill('#title', 'Libro Unificado de Prueba');
    await page.fill('#author', 'Toolisto');
    await page.fill('#language', 'es');
    await runTool(page);
    const mergeMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Merged 2 EPUBs with 3 chapters\./.test(mergeMsg), `mergeEpub message: "${mergeMsg}"`);
    const mergeBuf = await downloadResult(page);
    if (mergeBuf) {
      const ei = await epubInspect(page, toBase64(mergeBuf));
      ok(ei.mimetype === 'application/epub+zip', 'mergeEpub mimetype correcto', String(ei.mimetype));
      ok(ei.title === 'Libro Unificado de Prueba', 'mergeEpub dc:title del control', String(ei.title));
      ok(ei.creator === 'Toolisto', 'mergeEpub dc:creator del control', String(ei.creator));
      ok(ei.language === 'es', 'mergeEpub dc:language del control', String(ei.language));
      ok(ei.containerXml && ei.containerXml.includes('OEBPS/content.opf'), 'mergeEpub container.xml presente');
      ok(ei.chapters.length === 3, 'mergeEpub 3 capítulos', ei.chapters.length + ' capítulos');
      const allText = ei.chapters.map((c) => c.text).join('\n');
      ok(allText.includes('Capítulo Uno') && allText.includes('Capítulo Dos') && allText.includes('Capítulo Tres'), 'mergeEpub conserva el contenido de los 3 libros');
    } else fail('mergeEpub sin archivo');
    await closeDialog(page);

    /* ── 4. splitEpub ──────────────────────────────────────────────────── */
    console.log('\n--- splitEpub (dividir-epub-por-capitulos) ---');
    await gotoPage(page, url, 'dividir-epub-por-capitulos');
    await upload(page, [{ name: 'main.epub', mimeType: EPUB_MIME, buffer: mainEpub }]);
    await runTool(page);
    const splitMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/Split into 2 EPUBs\./.test(splitMsg), `splitEpub message: "${splitMsg}"`);
    const splitBuf = await downloadResult(page);
    if (splitBuf) {
      const parts = await zipEpubParts(page, toBase64(splitBuf));
      ok(parts.length === 2, `splitEpub genera 2 partes EPUB`, parts.length + ' partes');
      if (parts.length === 2) {
        ok(parts.every((p) => p.hasContainer && p.hasOpf && p.mimetype === 'application/epub+zip'), 'splitEpub: cada parte es un EPUB válido');
        const t1 = parts[0].chapters.join('');
        const t2 = parts[1].chapters.join('');
        ok(t1.includes('Capítulo Uno') && t2.includes('Capítulo Dos'), 'splitEpub parte 1 = cap1, parte 2 = cap2');
        ok(parts.every((p) => p.title && /Part \d/.test(p.title)), 'splitEpub títulos "Part N"', parts.map((p) => p.title).join(' | '));
      }
    } else fail('splitEpub sin archivo');
    await closeDialog(page);

    /* ── 5. editMetadataEpub ───────────────────────────────────────────── */
    console.log('\n--- editMetadataEpub (editar-metadatos-epub) ---');
    await gotoPage(page, url, 'editar-metadatos-epub');
    await upload(page, [{ name: 'main.epub', mimeType: EPUB_MIME, buffer: mainEpub }]);
    for (const id of ['title', 'author', 'language', 'description', 'publisher', 'identifier', 'rights']) {
      await page.waitForSelector(`#${id}`, { timeout: 8000, state: 'attached' });
    }
    pass('editMetadataEpub: controles de metadatos visibles (fix htmlByTool)');
    await page.fill('#title', 'Nuevo Título Certificado');
    await page.fill('#author', 'Nueva Autora');
    await page.fill('#language', 'fr');
    await page.fill('#description', 'Nueva descripción del libro');
    await page.fill('#publisher', 'Editorial Nueva');
    await page.fill('#identifier', 'urn:uuid:12345678-0000-0000-0000-000000000000');
    await page.fill('#rights', 'Licencia nueva');
    await runTool(page);
    const metaMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/EPUB metadata updated\./.test(metaMsg), `editMetadataEpub message: "${metaMsg}"`);
    const metaBuf = await downloadResult(page);
    if (metaBuf) {
      const ei = await epubInspect(page, toBase64(metaBuf));
      ok(ei.mimetype === 'application/epub+zip', 'editMetadataEpub mimetype correcto');
      ok(ei.title === 'Nuevo Título Certificado', 'editMetadataEpub dc:title actualizado', String(ei.title));
      ok(ei.creator === 'Nueva Autora', 'editMetadataEpub dc:creator actualizado', String(ei.creator));
      ok(ei.language === 'fr', 'editMetadataEpub dc:language actualizado', String(ei.language));
      ok(ei.description === 'Nueva descripción del libro', 'editMetadataEpub dc:description actualizado', String(ei.description));
      ok(ei.publisher === 'Editorial Nueva', 'editMetadataEpub dc:publisher actualizado', String(ei.publisher));
      ok(ei.identifier === 'urn:uuid:12345678-0000-0000-0000-000000000000', 'editMetadataEpub dc:identifier actualizado', String(ei.identifier));
      ok(ei.rights === 'Licencia nueva', 'editMetadataEpub dc:rights actualizado', String(ei.rights));
      ok(ei.chapters.some((c) => c.text.includes('certificar herramientas EPUB')), 'editMetadataEpub conserva el contenido');
    } else fail('editMetadataEpub sin archivo');
    await closeDialog(page);

    /* ── 6. validateEpub (válido + roto) ───────────────────────────────── */
    console.log('\n--- validateEpub (validar-epub) ---');
    await gotoPage(page, url, 'validar-epub');
    await upload(page, [{ name: 'main.epub', mimeType: EPUB_MIME, buffer: mainEpub }]);
    await runTool(page);
    const valMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/EPUB is valid with 0 warning\(s\)\./.test(valMsg), `validateEpub válido message: "${valMsg}"`);
    const valBuf = await downloadResult(page);
    if (valBuf) {
      const report = await readText(page, toBase64(valBuf));
      ok(report.includes('[PASS] mimetype file present and correct'), 'validateEpub: mimetype PASS');
      ok(report.includes('[PASS] All spine references resolve to existing files'), 'validateEpub: spine PASS');
      ok(report.includes('Status: VALID (with 0 warnings)'), 'validateEpub: Status VALID');
    } else fail('validateEpub válido sin archivo');
    await closeDialog(page);

    await gotoPage(page, url, 'validar-epub');
    await upload(page, [{ name: 'broken.epub', mimeType: EPUB_MIME, buffer: brokenEpub }]);
    await runTool(page);
    const valBadMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/EPUB has 2 error\(s\)\./.test(valBadMsg), `validateEpub roto message: "${valBadMsg}"`);
    const valBadBuf = await downloadResult(page);
    if (valBadBuf) {
      const report = await readText(page, toBase64(valBadBuf));
      ok(report.includes('[FAIL] mimetype file missing'), 'validateEpub roto: mimetype FAIL');
      ok(report.includes('[FAIL] META-INF/container.xml missing'), 'validateEpub roto: container FAIL');
      ok(report.includes('[PASS] content.opf found at: OEBPS/content.opf'), 'validateEpub roto: OPF localizado sin container (fix)');
      ok(report.includes('Status: INVALID'), 'validateEpub roto: Status INVALID');
    } else fail('validateEpub roto sin archivo');
    await closeDialog(page);

    /* ── 7. repairEpub ─────────────────────────────────────────────────── */
    console.log('\n--- repairEpub (reparar-epub) ---');
    await gotoPage(page, url, 'reparar-epub');
    await upload(page, [{ name: 'broken.epub', mimeType: EPUB_MIME, buffer: brokenEpub }]);
    await runTool(page);
    const repMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/EPUB repair complete\. See report for details\./.test(repMsg), `repairEpub message: "${repMsg}"`);
    const repZip = await downloadResult(page);
    if (repZip) {
      const z = await zipEntries(page, toBase64(repZip));
      const reportEntry = z.find((e) => /_repair_report\.txt$/.test(e.name));
      const repairedEntry = z.find((e) => /_repaired\.epub$/.test(e.name));
      ok(!!reportEntry, 'repairEpub incluye el reporte', reportEntry ? reportEntry.name : 'sin reporte');
      ok(!!repairedEntry, 'repairEpub incluye el EPUB reparado', repairedEntry ? repairedEntry.name : 'sin epub');
      if (reportEntry) {
        const rt = await zipEntryText(page, toBase64(repZip), reportEntry.name);
        ok(rt.includes('[FIXED] Added missing mimetype file'), 'repairEpub: reporte añade mimetype');
        ok(rt.includes('[FIXED] Created META-INF/container.xml'), 'repairEpub: reporte crea container.xml');
        ok(rt.includes('[FIXED] Removed 2 broken manifest reference(s)'), 'repairEpub: reporte elimina 2 referencias rotas');
        ok(rt.includes('[OK] toc.ncx present'), 'repairEpub: reporte conserva toc.ncx');
      }
      if (repairedEntry) {
        const repEpubB64 = await zipEntryB64(page, toBase64(repZip), repairedEntry.name);
        if (repEpubB64) {
          const ei = await epubInspect(page, repEpubB64);
          ok(ei.mimetype === 'application/epub+zip', 'repairEpub: EPUB reparado con mimetype');
          ok(!!ei.containerXml && ei.containerXml.includes('OEBPS/content.opf'), 'repairEpub: container.xml reconstruido');
          ok(ei.opf && !ei.opf.includes('missing.xhtml') && !ei.opf.includes('styles/default.css'), 'repairEpub: manifest sin referencias rotas (fix)');
          ok(ei.opf && /<spine[^>]*>[\s\S]*?<itemref idref="ch1"\/>[\s\S]*?<\/spine>/.test(ei.opf) && !/<spine[^>]*>[\s\S]*?<itemref idref="ch2"/.test(ei.opf), 'repairEpub: spine sin el capítulo eliminado (fix)');
          ok(ei.chapters.some((c) => c.text.includes('charset="UTF-8"')), 'repairEpub: charset añadido al capítulo');
        }
      }
    } else fail('repairEpub sin archivo');
    await closeDialog(page);

    // Cross-check: el EPUB reparado pasa la validación.
    console.log('\n--- repairEpub → revalidación ---');
    await gotoPage(page, url, 'validar-epub');
    if (repZip) {
      const z = await zipEntries(page, toBase64(repZip));
      const repairedEntry = z.find((e) => /_repaired\.epub$/.test(e.name));
      if (repairedEntry) {
        const repEpubB64 = await zipEntryB64(page, toBase64(repZip), repairedEntry.name);
        if (repEpubB64) {
          await upload(page, [{ name: 'repaired.epub', mimeType: EPUB_MIME, buffer: Buffer.from(repEpubB64, 'base64') }]);
          await runTool(page);
          const revalMsg = await page.$eval('#resultMessage', (el) => el.textContent);
          ok(/EPUB is valid with 0 warning\(s\)\./.test(revalMsg), `repairEpub: reparado pasa validateEpub ("${revalMsg}")`);
          await closeDialog(page);
        }
      }
    }

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
    suite: 'gate-e2e-epub-tools',
    updatedAt: new Date().toISOString(),
    tools: ['epubToHtml', 'epubToMarkdown', 'mergeEpub', 'splitEpub', 'editMetadataEpub', 'validateEpub', 'repairEpub'],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-epub-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
