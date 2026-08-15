#!/usr/bin/env node
/**
 * gate-e2e-structure-tools.mjs — Certificación E2E de las 3 herramientas de estructura
 * (modo `structure`) sobre el deployment real en dist/.
 *
 * Cubre: listToTable (convertir-listas-en-tablas), textToUnicodeBraille (texto-a-braille-unicode),
 * txtToEpub (txt-a-epub).
 *
 * UI del modo: #modeFileInput (input), #modeRun (botón), #structurePreview (vista previa),
 * #toast (mensajes) y descargas vía blob: + a.click().
 *
 * Cada herramienta: (1) abre con botón deshabilitado hasta elegir archivo, (2) vista previa
 * coherente, (3) procesa y descarga, (4) salida reabierta/validada (HTML/CSV/Markdown/EPUB),
 * (5) mensaje prometido, (6) sin red externa, (7) cero errores de consola.
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
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'structure-dl');
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

async function run() {
  console.log('=== Gate E2E Structure Tools (3 herramientas, modo estructura) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const downloads = [];
  page.on('download', (d) => { downloads.push(d); });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const gotoPage = async (slug) => {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  const uploadFiles = async (files) => {
    await page.locator('#modeFileInput').setInputFiles(files);
    await page.waitForFunction(() => !document.getElementById('modeRun').disabled, { timeout: 15000 });
  };
  const waitPreview = async (sub) => {
    await page.waitForFunction((needle) => {
      const el = document.getElementById('structurePreview');
      return el && el.textContent.indexOf(needle) !== -1;
    }, sub, { timeout: 20000 });
  };
  const toastText = () => page.$eval('#toast', (el) => el.textContent);
  const runBtnDisabled = () => page.$eval('#modeRun', (el) => el.disabled);
  const clickRun = async () => {
    await page.evaluate(() => {
      const b = document.getElementById('modeRun');
      if (b) b.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(150);
    await page.click('#modeRun');
    await page.waitForFunction(() => !document.getElementById('modeRun').disabled, { timeout: 30000 });
  };
  const collectDownloads = async (n) => {
    const t0 = Date.now();
    while (downloads.length < n && Date.now() - t0 < 25000) await page.waitForTimeout(50);
    return downloads.slice(0, n);
  };
  const downloadBuffer = async (dl) => {
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await dl.saveAs(tmp);
    return readFileSync(tmp);
  };
  const readText = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
  const inspectEpub = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const chapters = names.filter((n) => /^OEBPS\/chapter\d+\.xhtml$/.test(n));
    const readFile = async (name) => {
      const f = zip.files[name];
      if (!f || f.dir) return null;
      return f.async('string');
    };
    const mimetype = await readFile('mimetype');
    const container = await readFile('META-INF/container.xml');
    const opf = await readFile('OEBPS/content.opf');
    const ncx = await readFile('OEBPS/toc.ncx');
    const ch1 = chapters.length ? await readFile(chapters[0]) : '';
    return {
      names,
      mimetype,
      hasContainer: !!container && container.includes('OEBPS/content.opf'),
      hasOpf: !!opf,
      title: opf ? (opf.match(/<dc:title>([^<]*)<\/dc:title>/) || [])[1] : null,
      creator: opf ? (opf.match(/<dc:creator>([^<]*)<\/dc:creator>/) || [])[1] : null,
      lang: opf ? (opf.match(/<dc:language>([^<]*)<\/dc:language>/) || [])[1] : null,
      chapterCount: chapters.length,
      navCount: ncx ? (ncx.match(/<navPoint /g) || []).length : 0,
      ch1HasTitle: /<h1>/.test(ch1),
    };
  }, { b64 });

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    const listTxt = Buffer.from('nombre,ciudad,edad\nAna,Madrid,30\nLuis,Valencia,25\n');
    const brailleTxt = Buffer.from('hola mundo 123\nsegunda linea\n');
    const epubTxt = Buffer.from('# Capítulo Uno\n\nPrimer párrafo del capítulo uno.\n\n# Capítulo Dos\n\nSegundo párrafo del capítulo dos.\n');
    ok(listTxt.length > 0 && brailleTxt.length > 0 && epubTxt.length > 0, 'fixtures de texto generados', `${listTxt.length}/${brailleTxt.length}/${epubTxt.length} bytes`);

    /* ── 1. listToTable (convertir-listas-en-tablas) ──────────────────── */
    console.log('\n--- listToTable (convertir-listas-en-tablas) ---');
    await gotoPage('convertir-listas-en-tablas');
    ok(await runBtnDisabled(), 'listToTable inicia con el botón deshabilitado');
    await uploadFiles([{ name: 'lista.csv', mimeType: 'text/csv', buffer: listTxt }]);
    await waitPreview('filas');
    let preview = await page.$eval('#structurePreview', (el) => el.textContent);
    ok(preview.includes('3 filas') && preview.includes('3 columnas'), 'listToTable vista previa: 3 filas · 3 columnas', preview.split('\n').pop());
    downloads.length = 0;
    await clickRun();
    let dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'lista_table.html', `listToTable (html) descarga "${dls[0].suggestedFilename()}"`);
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      ok(t.includes('<table>') && t.includes('<td>Ana</td>') && t.includes('<td>Madrid</td>'), 'listToTable (html) genera tabla con las filas');
    } else fail('listToTable (html) sin descarga');
    ok((await toastText()).includes('Converted to HTML table.'), 'listToTable (html) message en toast', JSON.stringify(await toastText()));

    await gotoPage('convertir-listas-en-tablas');
    await uploadFiles([{ name: 'lista.txt', mimeType: 'text/plain', buffer: listTxt }]);
    await waitPreview('filas');
    await page.selectOption('#ltDelimiter', 'comma');
    await page.selectOption('#ltFormat', 'csv');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'lista_table.csv', `listToTable (csv) descarga "${dls[0].suggestedFilename()}"`);
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      const rows = t.split('\n').filter(Boolean);
      ok(rows.length === 3, 'listToTable (csv) genera 3 filas CSV', rows.length + ' filas');
      ok(t.includes('"nombre","ciudad","edad"') && t.includes('"Ana","Madrid","30"'), 'listToTable (csv) conserva los datos con comillas', t.split('\n')[0]);
    } else fail('listToTable (csv) sin descarga');
    ok((await toastText()).includes('Converted to CSV table.'), 'listToTable (csv) message en toast', JSON.stringify(await toastText()));

    await gotoPage('convertir-listas-en-tablas');
    await uploadFiles([{ name: 'lista.dat', mimeType: 'text/plain', buffer: listTxt }]);
    await waitPreview('filas');
    await page.check('#ltHeaders');
    await page.selectOption('#ltFormat', 'markdown');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'lista_table.md', `listToTable (markdown) descarga "${dls[0].suggestedFilename()}"`);
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      ok(t.includes('| nombre | ciudad | edad |'), 'listToTable (markdown) genera encabezado', t.split('\n')[0]);
      ok(t.includes('| --- | --- | --- |'), 'listToTable (markdown) genera separador');
      ok(t.includes('| Ana | Madrid | 30 |'), 'listToTable (markdown) convierte filas');
    } else fail('listToTable (markdown) sin descarga');
    ok((await toastText()).includes('Converted to Markdown table.'), 'listToTable (markdown) message en toast', JSON.stringify(await toastText()));

    /* ── 2. textToUnicodeBraille (texto-a-braille-unicode) ────────────── */
    console.log('\n--- textToUnicodeBraille (texto-a-braille-unicode) ---');
    await gotoPage('texto-a-braille-unicode');
    ok(await runBtnDisabled(), 'textToUnicodeBraille inicia con el botón deshabilitado');
    await uploadFiles([{ name: 'nota.txt', mimeType: 'text/plain', buffer: brailleTxt }]);
    await waitPreview('caracteres convertidos');
    preview = await page.$eval('#structurePreview', (el) => el.textContent);
    ok(preview.includes('caracteres convertidos'), 'textToUnicodeBraille muestra la vista previa con conteo', preview.split('\n').pop());
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'nota-braille.txt', `textToUnicodeBraille descarga "${dls[0].suggestedFilename()}"`);
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      const brailleChars = (t.match(/[\u2800-\u28FF]/g) || []).length;
      ok(brailleChars > 0, 'textToUnicodeBraille convierte a caracteres Braille Unicode', brailleChars + ' caracteres braille');
      ok(t !== brailleTxt.toString('utf-8'), 'textToUnicodeBraille transforma el texto de origen');
      ok(t.includes('\n'), 'textToUnicodeBraille conserva la estructura de líneas');
    } else fail('textToUnicodeBraille sin descarga');
    ok((await toastText()).includes('Texto convertido a Braille Unicode correctamente.'), 'textToUnicodeBraille message en toast', JSON.stringify(await toastText()));

    /* ── 3. txtToEpub (txt-a-epub) ────────────────────────────────────── */
    console.log('\n--- txtToEpub (txt-a-epub) ---');
    await gotoPage('txt-a-epub');
    ok(await runBtnDisabled(), 'txtToEpub inicia con el botón deshabilitado');
    await page.fill('#epTitle', 'Libro de prueba');
    await page.fill('#epAuthor', 'Autor Prueba');
    await page.selectOption('#epLang', 'es');
    await page.selectOption('#epPattern', 'heading');
    await uploadFiles([{ name: 'libro.txt', mimeType: 'text/plain', buffer: epubTxt }]);
    await waitPreview('capítulos detectados');
    preview = await page.$eval('#structurePreview', (el) => el.textContent);
    ok(preview.includes('2 capítulos detectados'), 'txtToEpub detecta 2 capítulos en la vista previa', preview.split('\n').filter((l) => l.includes('capítulo')).join(' | '));
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'libro.epub', `txtToEpub descarga "${dls[0].suggestedFilename()}"`);
      const buf = await downloadBuffer(dls[0]);
      ok(buf.slice(0, 2).toString('latin1') === 'PK', 'txtToEpub produce un archivo ZIP (firma PK)');
      const epub = await inspectEpub(toBase64(buf));
      ok(epub.mimetype === 'application/epub+zip', 'txtToEpub incluye mimetype = application/epub+zip', epub.mimetype || 'null');
      ok(epub.hasContainer && epub.hasOpf, 'txtToEpub incluye container.xml y content.opf');
      ok(epub.title === 'Libro de prueba' && epub.creator === 'Autor Prueba' && epub.lang === 'es', 'txtToEpub escribe título/autor/idioma en OPF', `${epub.title} / ${epub.creator} / ${epub.lang}`);
      ok(epub.chapterCount === 2 && epub.navCount === 2, 'txtToEpub genera 2 capítulos XHTML y 2 navPoints en NCX', `chapters=${epub.chapterCount} nav=${epub.navCount}`);
      ok(epub.ch1HasTitle, 'txtToEpub estructura cada capítulo con <h1>');
      ok(epub.names.includes('OEBPS/styles/default.css') && epub.names.includes('OEBPS/toc.ncx'), 'txtToEpub incluye CSS y NCX', epub.names.join(' | '));
    } else fail('txtToEpub sin descarga');
    ok((await toastText()).includes('EPUB generado con capítulos estructurados.'), 'txtToEpub toast de confirmación', JSON.stringify(await toastText()));

    /* ── 4. Sin red externa ───────────────────────────────────────────── */
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
    await gotoPage('texto-a-braille-unicode');
    await uploadFiles([{ name: 'off.txt', mimeType: 'text/plain', buffer: Buffer.from('sin red\n') }]);
    await waitPreview('caracteres convertidos');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    const offBuf = dls[0] ? await downloadBuffer(dls[0]) : null;
    ok(offBuf && (await readText(toBase64(offBuf))).match(/[\u2800-\u28FF]/g), 'textToUnicodeBraille funciona con toda la red externa bloqueada');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await page.unroute('**/*');

    /* ── 5. Consola ───────────────────────────────────────────────────── */
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
    suite: 'gate-e2e-structure-tools',
    updatedAt: new Date().toISOString(),
    tools: ['listToTable', 'textToUnicodeBraille', 'txtToEpub'],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
    notes: [
      'listToTable y txtToEpub exponen mensajes en inglés (Converted to ... / Converted N file(s) to EPUB.) heredados del procesador; la interfaz del modo está en español.',
    ],
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-structure-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
