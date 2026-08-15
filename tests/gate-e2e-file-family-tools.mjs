#!/usr/bin/env node
/**
 * gate-e2e-file-family-tools.mjs — Certificación E2E de la familia archivos con
 * UI genérica (sin mode) sobre el deployment real en dist/.
 *
 * Cubre: unzipFile (extraer-zip), createZipAdvanced (crear-zip-avanzado),
 * checksumFile (calcular-hash), fileInspector (inspeccionar-archivo),
 * inspectFileMetadata (inspeccionar-metadatos-archivo) y
 * encryptDecryptFile (cifrar-descifrar-archivo).
 *
 * (fileSplit, fileJoin y zipRepair con UI modo `file` se certifican en
 * gate-e2e-file-tools.mjs.)
 *
 * Cada herramienta: (1) abre con el botón deshabilitado hasta elegir archivo,
 * (2) procesa un fixture real por la UI genérica (#fileInput → #runButton →
 * #resultDialog → #downloadButton), (3) salida no vacía con extensión y bytes
 * verificables, (4) mensaje prometido, (5) casos negativos con toast
 * informativo sin romper la página, (6) sin red externa, (7) cero errores de
 * consola.
 *
 * encryptDecryptFile: el harness exige los controles funcionales Cifrar/Descifrar
 * (selector #mode + contraseña #password) añadidos a renderAdvancedControls en
 * app.js, y verifica el round-trip completo cifrar → descifrar por la UI real.
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { deflateSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'file-family-dl');
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
function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex'); }
function sha1Hex(buf) { return createHash('sha1').update(buf).digest('hex'); }

/* ── PNG 1x1 RGBA válido (con CRC32) ──────────────────────────────────── */
let _crcTable = null;
function crc32(buf) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makePng() {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.from([0x00, 0xFF, 0x00, 0x00, 0xFF]));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ── ZIP en bruto (STORE) para fixturas adversarias ──────────────────────
 * JSZip.generateAsync normaliza nombres (../evil.txt → evil.txt), así que
 * para probar el manejo de rutas maliciosas el nombre se escribe literal
 * en la cabecera local y en el directorio central. */
function buildZipRaw(entries) {
  const parts = [];
  const cds = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    const local = Buffer.concat([lh, name, data]);
    parts.push(local);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt32LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    cds.push(Buffer.concat([ch, name]));
    offset += local.length;
  }
  const cdBuffer = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuffer, eocd]);
}

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
  console.log('=== Gate E2E File Family (6 herramientas, UI genérica) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const gotoPage = async (slug) => {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  const upload = async (files) => {
    await page.locator('#fileInput').setInputFiles(files);
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
  };
  const toastText = () => page.$eval('#toast', (el) => el.textContent);
  const runDisabled = () => page.$eval('#runButton', (el) => el.disabled);
  const waitDialog = async (timeout = 45000) => {
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
  const downloadResult = async () => {
    const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await page.click('#downloadButton');
    const dl = await dlPromise;
    if (!dl) return null;
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await dl.saveAs(tmp);
    return { buffer: readFileSync(tmp), name: dl.suggestedFilename() };
  };
  const downloadViaEval = async (fn) => {
    const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await page.evaluate(fn);
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
        out.push({ name, size: c.length, text: new TextDecoder('utf-8').decode(c) });
      }
      return { ok: true, entries: out };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, { b64 });
  const buildZip = async (spec) => page.evaluate(async (payload) => {
    const zip = new JSZip();
    for (const [name, data] of payload.entries) {
      if (typeof data === 'string') zip.file(name, data);
      else zip.file(name, new Uint8Array(data));
    }
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
  }, spec);

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    const payload = Buffer.alloc(153600);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const payloadSha = sha256Hex(payload);
    const payloadSha1 = sha1Hex(payload);
    const pngBytes = makePng();
    ok(pngBytes.length > 60 && pngBytes.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'PNG 1x1 válido generado (firma + CRC)', `${pngBytes.length} bytes`);
    ok(payloadSha.length === 64, 'sha256 del payload determinista', payloadSha.slice(0, 12) + '…');
    const TXT_A = { name: 'hola.txt', mimeType: 'text/plain', buffer: Buffer.from('Hola Toolisto\n') };
    const TXT_B = { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('Segundo archivo de prueba.\n') };
    const PAYLOAD_FILE = { name: 'payload.bin', mimeType: 'application/octet-stream', buffer: payload };
    const PNG_FILE = { name: 'pic.png', mimeType: 'image/png', buffer: pngBytes };
    const FAKE_PNG = { name: 'foto.png', mimeType: 'text/plain', buffer: Buffer.from('No soy una imagen real, solo texto.\n') };
    const MYSTERY_FILE = { name: 'misterio.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0x00, 0x01, 0x02, 0xFE, 0xFF, 0x10, 0xAA]) };

    /* ── 1. unzipFile (extraer-zip) ───────────────────────────────────── */
    console.log('\n--- unzipFile (extraer-zip) ---');
    await gotoPage('extraer-zip');
    await page.addScriptTag({ url: new URL('/vendor/jszip/jszip.min.js', page.url()).href });

    const ZIP_OK = await buildZip({ entries: [['hola.txt', 'Hola Toolisto'], ['datos.bin', Array.from({ length: 100 }, (_, i) => i)]] });
    ok(typeof ZIP_OK === 'string' && ZIP_OK.length > 50, 'ZIP fixture con 2 entradas (STORE) construido', ZIP_OK.length + ' b64 chars');
    const ZIP_FILE = { name: 'muestra.zip', mimeType: 'application/zip', buffer: Buffer.from(ZIP_OK, 'base64') };
    const EVIL_FILE = { name: 'malo.zip', mimeType: 'application/zip', buffer: buildZipRaw([{ name: '../evil.txt', data: 'x' }]) };
    const EMPTY_FILE = { name: 'vacio.zip', mimeType: 'application/zip', buffer: buildZipRaw([]) };

    ok(await runDisabled(), 'unzipFile inicia con el botón deshabilitado');
    await upload([ZIP_FILE]);
    ok(!(await runDisabled()), 'unzipFile habilita el botón tras elegir ZIP');
    await runTool();
    let msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('2 archivos extraídos del ZIP.'), 'unzipFile message prometido en el diálogo', msg);
    const unz = await downloadResult();
    ok(unz && unz.name === 'resultados.zip', 'unzipFile con 2 salidas descarga resultados.zip', unz && unz.name);
    const unzEntries = await zipEntries(toBase64(unz.buffer));
    ok(unzEntries.ok && unzEntries.entries.length === 2, 'unzipFile resultados.zip contiene 2 entradas', unzEntries.error || unzEntries.entries.length + '');
    const unzMap = Object.fromEntries((unzEntries.entries || []).map((e) => [e.name, e]));
    ok(unzMap['hola.txt'] && unzMap['hola.txt'].text === 'Hola Toolisto', 'unzipFile conserva hola.txt intacto');
    ok(unzMap['datos.bin'] && unzMap['datos.bin'].size === 100, 'unzipFile conserva datos.bin (100 bytes)');
    await closeDialog();

    /* unzipFile — neutralización de rutas maliciosas (../) */
    console.log('--- unzipFile seguridad (path traversal) ---');
    await gotoPage('extraer-zip');
    await upload([EVIL_FILE]);
    await runTool();
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('1 archivo extraído del ZIP.'), 'unzipFile procesa ZIP con entrada ../evil.txt', msg);
    const evilDl = await downloadResult();
    ok(evilDl && evilDl.name === 'evil.txt' && evilDl.name.indexOf('..') === -1, 'unzipFile neutraliza la ruta: descarga evil.txt sin ".."', evilDl && evilDl.name);
    const evilText = evilDl ? await readText(toBase64(evilDl.buffer)) : '';
    ok(evilText === 'x', 'unzipFile contenido extraído intacto tras sanitizado', JSON.stringify(evilText));
    await closeDialog();

    /* unzipFile — rechazo por ZIP vacío */
    await gotoPage('extraer-zip');
    await upload([EMPTY_FILE]);
    await page.click('#runButton');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('está vacío') !== -1, { timeout: 15000 });
    msg = await toastText();
    ok(msg.includes('El archivo ZIP está vacío o no contiene archivos.'), 'unzipFile rechaza ZIP vacío', msg);
    const feedback = await page.$eval('#processFeedback', (el) => ({ hidden: el.hidden, text: el.textContent }));
    ok(!feedback.hidden && feedback.text.includes('El archivo ZIP está vacío o no contiene archivos.'), 'unzipFile conserva el error recuperable junto a la acción', feedback.text);
    await page.click('#processFeedback .copy-tech-btn');
    const copiedDetails = await page.evaluate(() => navigator.clipboard.readText());
    ok(copiedDetails.includes('Herramienta: unzipFile') && copiedDetails.includes('Fase: failed') && copiedDetails.includes('El archivo ZIP está vacío'), 'unzipFile copia detalles técnicos del rechazo', copiedDetails);
    await page.click('#retryButton');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'runButton');
    ok(true, 'unzipFile reintenta desde el feedback y devuelve el foco a ejecutar');
    await page.waitForTimeout(300);
    ok(!(await runDisabled()), 'unzipFile rehabilita el botón tras el ZIP vacío');

    /* ── 2. createZipAdvanced (crear-zip-avanzado) ────────────────────── */
    console.log('\n--- createZipAdvanced (crear-zip-avanzado) ---');
    await gotoPage('crear-zip-avanzado');
    ok(await runDisabled(), 'createZipAdvanced inicia con el botón deshabilitado');
    await upload([TXT_A, TXT_B]);
    ok(!(await runDisabled()), 'createZipAdvanced habilita el botón con 2 archivos');
    await runTool();
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('2 archivos comprimidos en ZIP.'), 'createZipAdvanced message prometido', msg);
    const cz = await downloadResult();
    ok(cz && cz.name === 'toolisto-archivo.zip', 'createZipAdvanced descarga toolisto-archivo.zip', cz && cz.name);
    const czEntries = await zipEntries(toBase64(cz.buffer));
    ok(czEntries.ok && czEntries.entries.length === 2, 'ZIP generado contiene 2 archivos', czEntries.error || czEntries.entries.length + '');
    const czMap = Object.fromEntries((czEntries.entries || []).map((e) => [e.name, e]));
    ok(czMap['hola.txt'] && czMap['hola.txt'].text === 'Hola Toolisto\n', 'createZipAdvanced conserva hola.txt');
    ok(czMap['nota.txt'] && czMap['nota.txt'].text === 'Segundo archivo de prueba.\n', 'createZipAdvanced conserva nota.txt');
    await closeDialog();

    /* ── 3. checksumFile (calcular-hash) ───────────────────────────────── */
    console.log('\n--- checksumFile (calcular-hash) ---');
    await gotoPage('calcular-hash');
    ok(await runDisabled(), 'checksumFile inicia con el botón deshabilitado');
    await upload([PAYLOAD_FILE]);
    ok(!(await runDisabled()), 'checksumFile habilita el botón tras elegir archivo');
    await runTool();
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Hash calculado para payload.bin.'), 'checksumFile message prometido', msg);
    const chk = await downloadResult();
    ok(chk && chk.name === 'payload.bin.checksum.txt', 'checksumFile descarga <nombre>.checksum.txt', chk && chk.name);
    const chkText = await readText(toBase64(chk.buffer));
    ok(chkText.includes('SHA-1: ' + payloadSha1), 'checksumFile SHA-1 coincide con Web Crypto del fixture');
    ok(chkText.includes('SHA-256: ' + payloadSha), 'checksumFile SHA-256 coincide con Web Crypto del fixture');
    ok(chkText.includes('Tamaño: 153600 bytes'), 'checksumFile registra el tamaño real', chkText.split('\n')[1]);
    await closeDialog();

    /* ── 4. fileInspector (inspeccionar-archivo) ──────────────────────── */
    console.log('\n--- fileInspector (inspeccionar-archivo) ---');
    await gotoPage('inspeccionar-archivo');
    ok(await runDisabled(), 'fileInspector inicia con el botón deshabilitado');
    await upload([PNG_FILE]);
    ok(!(await runDisabled()), 'fileInspector habilita el botón con una imagen');
    await runTool();
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Inspección completada para 1 archivos.'), 'fileInspector message prometido', msg);
    const insp = await downloadResult();
    ok(insp && insp.name === 'pic.png.inspeccion.txt', 'fileInspector descarga <nombre>.inspeccion.txt', insp && insp.name);
    const inspText = await readText(toBase64(insp.buffer));
    ok(inspText.includes('Tipo detectado (magic bytes): PNG'), 'fileInspector detecta PNG por magic bytes');
    ok(inspText.includes('Coincidencia: SÍ ✓'), 'fileInspector confirma coincidencia extensión/firma');
    ok(inspText.includes('89504e47'), 'fileInspector muestra el hex del encabezado');
    await closeDialog();

    /* fileInspector — extensión engañosa bloqueada en la carga (TLT-041) */
    console.log('--- fileInspector negativo (extensión engañosa) ---');
    await gotoPage('inspeccionar-archivo');
    await page.setInputFiles('#fileInput', FAKE_PNG);
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('no coincide con la extensión') !== -1, { timeout: 15000 });
    msg = await toastText();
    ok(msg.includes('foto.png: La firma interna (desconocida) no coincide con la extensión/MIME declarado (PNG).'), 'fileInspector bloquea en la carga el PNG falso por magic bytes', msg);
    ok(await runDisabled(), 'fileInspector mantiene el botón deshabilitado tras el rechazo');
    await page.waitForTimeout(200);

    /* fileInspector — tipo desconocido detectable en el procesado */
    console.log('--- fileInspector tipo desconocido (extensión no estándar) ---');
    await gotoPage('inspeccionar-archivo');
    await upload([MYSTERY_FILE]);
    await runTool();
    const fake = await downloadResult();
    ok(fake && fake.name === 'misterio.bin.inspeccion.txt', 'fileInspector procesa archivo de tipo desconocido', fake && fake.name);
    const fakeText = await readText(toBase64(fake.buffer));
    ok(fakeText.includes('Tipo detectado (magic bytes): Desconocido'), 'fileInspector NO se deja engañar por el contenido desconocido');
    ok(fakeText.includes('Coincidencia: NO - posible extensión incorrecta'), 'fileInspector advierte extensión incorrecta');
    await closeDialog();

    /* ── 5. inspectFileMetadata (inspeccionar-metadatos-archivo) ──────── */
    console.log('\n--- inspectFileMetadata (inspeccionar-metadatos-archivo) ---');
    await gotoPage('inspeccionar-metadatos-archivo');
    ok(await runDisabled(), 'inspectFileMetadata inicia con el botón deshabilitado');
    await upload([PNG_FILE]);
    ok(!(await runDisabled()), 'inspectFileMetadata habilita el botón con una imagen');
    await runTool();
    const metaTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    ok(metaTitle === 'Metadatos inspeccionados', 'inspectFileMetadata abre el diálogo de metadatos', metaTitle);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('campo(s) detectado(s) en "pic.png".'), 'inspectFileMetadata message con nombre del archivo', msg);
    const previewHtml = await page.$eval('#previewArea', (el) => el.innerHTML);
    ok(previewHtml.includes('SHA-256'), 'inspectFileMetadata muestra el SHA-256 en el informe');
    ok(previewHtml.includes('pic.png') && previewHtml.includes('Información general'), 'inspectFileMetadata muestra nombre y sección general');
    ok(previewHtml.includes('magic bytes'), 'inspectFileMetadata muestra el tipo detectado por magic bytes');
    const metaJson = await downloadViaEval(() => window._metaDownloadJSON());
    ok(metaJson && metaJson.name === 'pic.png.json', 'inspectFileMetadata descarga JSON (pic.png.json)', metaJson && metaJson.name);
    const metaJsonText = await readText(toBase64(metaJson.buffer));
    const jsonObj = JSON.parse(metaJsonText);
    ok(jsonObj && jsonObj.general, 'inspectFileMetadata JSON con sección general', metaJsonText.slice(0, 80));
    ok(jsonObj.general && jsonObj.general['SHA-256'] === sha256Hex(pngBytes), 'inspectFileMetadata SHA-256 del JSON coincide con el fixture');
    const metaTxt = await downloadViaEval(() => window._metaDownloadTXT());
    ok(metaTxt && metaTxt.name === 'pic.png.txt' && (await readText(toBase64(metaTxt.buffer))).includes('INFORMACIÓN GENERAL'), 'inspectFileMetadata descarga TXT con informe');
    await closeDialog();

    /* ── 6. encryptDecryptFile (cifrar-descifrar-archivo) ─────────────── */
    console.log('\n--- encryptDecryptFile (cifrar-descifrar-archivo) ---');
    await gotoPage('cifrar-descifrar-archivo');
    ok(await runDisabled(), 'encryptDecryptFile inicia con el botón deshabilitado');
    await upload([PAYLOAD_FILE]);
    const panel = await page.evaluate(() => {
      const p = document.getElementById('advancedPanel');
      return { open: p.open, hasMode: !!document.getElementById('mode'), hasPassword: !!document.getElementById('password') };
    });
    ok(panel.open && panel.hasMode && panel.hasPassword, 'encryptDecryptFile expone los controles funcionales Cifrar/Descifrar (#mode + #password)', JSON.stringify(panel));
    ok(!(await runDisabled()), 'encryptDecryptFile habilita el botón con un archivo');

    /* sin contraseña → rechazo informativo */
    await page.click('#runButton');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('Ingresa una contraseña') !== -1, { timeout: 15000 });
    msg = await toastText();
    ok(msg.includes('Ingresa una contraseña.'), 'encryptDecryptFile exige contraseña', msg);

    /* contraseña corta → rechazo */
    await page.fill('#password', '123');
    await page.click('#runButton');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('al menos 4 caracteres') !== -1, { timeout: 15000 });
    msg = await toastText();
    ok(msg.includes('La contraseña debe tener al menos 4 caracteres.'), 'encryptDecryptFile valida longitud mínima', msg);

    /* cifrar */
    await page.fill('#password', 'toolisto-1234');
    await page.selectOption('#mode', 'encrypt');
    await page.click('#runButton');
    await waitDialog();
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Archivo cifrado correctamente.'), 'encryptDecryptFile message de cifrado', msg);
    const enc = await downloadResult();
    ok(enc && enc.name === 'payload.bin.toolistoenc', 'encryptDecryptFile descarga <nombre>.toolistoenc', enc && enc.name);
    ok(enc.buffer.length > payload.length, 'encrypted no es más pequeño que el original (header + tag)', `${enc.buffer.length} > ${payload.length}`);
    ok(enc.buffer.slice(0, 11).toString('latin1') === 'TOOLISTOENC', 'encrypted comienza con la firma TOOLISTOENC');
    ok(!enc.buffer.equals(payload), 'encrypted NO es igual al original (datos cifrados)');
    await closeDialog();

    /* descifrar con la misma contraseña → round-trip exacto */
    const ENC_FILE = { name: 'payload.bin.toolistoenc', mimeType: 'application/octet-stream', buffer: enc.buffer };
    await gotoPage('cifrar-descifrar-archivo');
    await upload([ENC_FILE]);
    await page.fill('#password', 'toolisto-1234');
    await page.selectOption('#mode', 'decrypt');
    await page.click('#runButton');
    await waitDialog();
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Archivo descifrado correctamente.'), 'encryptDecryptFile message de descifrado', msg);
    const dec = await downloadResult();
    ok(dec && dec.name === 'payload.bin', 'encryptDecryptFile restaura el nombre original', dec && dec.name);
    ok(Buffer.from(dec.buffer).equals(payload), 'descifrado reproduce los bytes exactos del original (round-trip)');
    await closeDialog();

    /* descifrar con contraseña incorrecta → rechazo */
    console.log('--- encryptDecryptFile negativo (contraseña incorrecta) ---');
    await gotoPage('cifrar-descifrar-archivo');
    await upload([ENC_FILE]);
    await page.fill('#password', 'contraseña-equivocada');
    await page.selectOption('#mode', 'decrypt');
    await page.click('#runButton');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('incorrecta') !== -1, { timeout: 20000 });
    msg = await toastText();
    ok(msg.includes('Contraseña incorrecta o archivo corrupto.'), 'encryptDecryptFile rechaza contraseña incorrecta', msg);
    ok(!(await runDisabled()), 'encryptDecryptFile rehabilita el botón tras el rechazo');

    /* descifrar un archivo que no es .toolistoenc → rechazo */
    await gotoPage('cifrar-descifrar-archivo');
    await upload([PAYLOAD_FILE]);
    await page.fill('#password', 'toolisto-1234');
    await page.selectOption('#mode', 'decrypt');
    await page.click('#runButton');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('No es un archivo') !== -1, { timeout: 15000 });
    msg = await toastText();
    ok(msg.includes('No es un archivo .toolistoenc válido.'), 'encryptDecryptFile rechaza archivo sin firma', msg);
    ok(!(await runDisabled()), 'encryptDecryptFile rehabilita el botón tras el rechazo');

    /* ── 7. Sin red externa ────────────────────────────────────────────── */
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
    await gotoPage('calcular-hash');
    await upload([PAYLOAD_FILE]);
    await runTool();
    await closeDialog();
    await gotoPage('cifrar-descifrar-archivo');
    await upload([PAYLOAD_FILE]);
    await page.fill('#password', 'toolisto-1234');
    await page.selectOption('#mode', 'encrypt');
    await page.click('#runButton');
    await waitDialog();
    const encOff = await downloadResult();
    ok(encOff && encOff.name === 'payload.bin.toolistoenc', 'cifrado funciona con toda la red externa bloqueada', encOff && encOff.name);
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await page.unroute('**/*');

    /* ── 8. Consola ────────────────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola, incluidos los rechazos recuperables');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-file-family-tools',
    updatedAt: new Date().toISOString(),
    tools: ['unzipFile', 'createZipAdvanced', 'checksumFile', 'fileInspector', 'inspectFileMetadata', 'encryptDecryptFile'],
    uiFixed: [
      'encryptDecryptFile no era usable desde su página (cifrar-descifrar-archivo.html es UI genérica sin campo de contraseña ni selector de operación; sin entrada en htmlByTool de renderAdvancedControls ni options en tools.json): el procesador solo podía responder "Ingresa una contraseña." Se añadió la entrada funcional encryptDecryptFile a renderAdvancedControls en app.js con selector #mode (Cifrar/Descifrar) y campo #password, permitiendo el round-trip AES-GCM por la UI real.',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-file-family-extra-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
