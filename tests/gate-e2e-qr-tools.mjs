#!/usr/bin/env node
/**
 * gate-e2e-qr-tools.mjs — Certificación E2E de las 7 herramientas QR/códigos con la
 * UI real del modo `qr` sobre el deployment en dist/.
 *
 * Cubre: qrGenerate, qrWifi, qrVcard, barcodeGenerate, qrReadFromImage,
 * barcodeReadFromImage, qrBatchFromCsv.
 *
 * Cada herramienta: (1) abre, (2) formulario/archivo real, (3) resultado descargado,
 * (4) firma PNG / reapertura, (5) decodificación del contenido con jsQR del sitio,
 * (6) mensaje prometido, (7) rechazos de validación, (8) sin red externa,
 * (9) cero errores de consola.
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
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'qr-dl');
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

async function waitRunReady(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('qrRun');
    return b && !b.disabled;
  }, { timeout: 15000 });
}

async function clickRun(page) {
  await page.waitForFunction(() => !!document.getElementById('qrForm'), { timeout: 15000 });
  const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.evaluate(() => {
    const b = document.getElementById('qrRun');
    if (b) b.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(150);
  await page.click('#qrRun');
  await waitRunReady(page);
  return dlPromise;
}

async function saveDownload(page, dl) {
  if (!dl) return null;
  const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await dl.saveAs(tmp);
  return readFileSync(tmp);
}

async function toastText(page) {
  return page.evaluate(() => (document.getElementById('toast') ? document.getElementById('toast').textContent : ''));
}

async function readText(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
}

async function decodeQr(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const blob = new Blob([u], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const code = window.JsQR(id.data, c.width, c.height);
    URL.revokeObjectURL(url);
    return code ? { data: code.data, type: code.type } : null;
  }, { b64 });
}

async function inspectZip(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const zip = await window.JSZip.loadAsync(u);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const pngNames = names.filter((n) => n.toLowerCase().endsWith('.png'));
    let firstData = null;
    if (pngNames.length) {
      const blob = await zip.files[pngNames[0]].async('blob');
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const code = window.JsQR(id.data, c.width, c.height);
      URL.revokeObjectURL(url);
      firstData = code ? code.data : null;
    }
    return { names, pngCount: pngNames.length, firstData };
  }, { b64 });
}

async function run() {
  console.log('=== Gate E2E QR / Códigos (7 herramientas) ===\n');

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
    /* ── 1. qrGenerate (generar-qr) ───────────────────────────────────── */
    console.log('\n--- qrGenerate (generar-qr) ---');
    await gotoPage(page, url, 'generar-qr');
    await page.fill('#text', 'https://toolisto.app/certificar');
    const dl = await clickRun(page);
    const buf = await saveDownload(page, dl);
    if (buf) {
      const dlName = dl.suggestedFilename();
      ok(dlName === 'toolisto-qr.png', `qrGenerate descarga "${dlName}"`, dlName);
      ok(buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'qrGenerate produce una imagen PNG con firma correcta');
      const code = await decodeQr(page, toBase64(buf));
      ok(code && code.data === 'https://toolisto.app/certificar', `qrGenerate codifica el texto exacto (decodificado con jsQR)`, code ? code.data : 'null');
    } else fail('qrGenerate sin descarga');
    let toast = await toastText(page);
    ok(toast.includes('Código QR generado para: "https://toolisto.app/certificar"'), `qrGenerate message: "${toast}"`, toast);

    /* ── 2. qrWifi (generar-qr-wifi) ──────────────────────────────────── */
    console.log('\n--- qrWifi (generar-qr-wifi) ---');
    await gotoPage(page, url, 'generar-qr-wifi');
    await page.fill('#wifiSsid', 'MiRedWiFi');
    await page.fill('#wifiPassword', 'clave123');
    await page.selectOption('#wifiAuth', 'WPA');
    let dl2 = await clickRun(page);
    let buf2 = await saveDownload(page, dl2);
    if (buf2) {
      ok(dl2.suggestedFilename() === 'toolisto-wifi-qr.png', `qrWifi descarga "${dl2.suggestedFilename()}"`);
      ok(buf2.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'qrWifi produce una imagen PNG');
      const code = await decodeQr(page, toBase64(buf2));
      ok(code && code.data === 'WIFI:T:WPA;S:MiRedWiFi;P:clave123;;', `qrWifi codifica la cadena WIFI estándar`, code ? code.data : 'null');
    } else fail('qrWifi sin descarga');
    toast = await toastText(page);
    ok(toast.includes('QR de Wi-Fi generado para la red "MiRedWiFi".'), `qrWifi message: "${toast}"`);

    /* ── 3. qrVcard (generar-qr-contacto) ─────────────────────────────── */
    console.log('\n--- qrVcard (generar-qr-contacto) ---');
    await gotoPage(page, url, 'generar-qr-contacto');
    await page.fill('#vcardName', 'Maria Garcia');
    await page.fill('#vcardOrg', 'Toolisto');
    await page.fill('#vcardPhone', '+34 600 000 000');
    await page.fill('#vcardEmail', 'maria@toolisto.app');
    let dl3 = await clickRun(page);
    let buf3 = await saveDownload(page, dl3);
    if (buf3) {
      ok(dl3.suggestedFilename() === 'toolisto-contacto-qr.png', `qrVcard descarga "${dl3.suggestedFilename()}"`);
      ok(buf3.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'qrVcard produce una imagen PNG');
      const code = await decodeQr(page, toBase64(buf3));
      ok(code && code.data.includes('BEGIN:VCARD') && code.data.includes('FN:Maria Garcia') && code.data.includes('TEL:+34 600 000 000') && code.data.includes('EMAIL:maria@toolisto.app') && code.data.includes('END:VCARD'), 'qrVcard codifica una vCard completa (FN/TEL/EMAIL/ORG)', code ? code.data.split('\n').join(' | ') : 'null');
    } else fail('qrVcard sin descarga');
    toast = await toastText(page);
    ok(toast.includes('QR de contacto generado para "Maria Garcia".'), `qrVcard message: "${toast}"`);

    /* ── 4. barcodeGenerate (generar-codigo-barras) ───────────────────── */
    console.log('\n--- barcodeGenerate (generar-codigo-barras) ---');
    await gotoPage(page, url, 'generar-codigo-barras');
    await page.fill('#barcodeText', '1234567890128');
    await page.selectOption('#barcodeFormat', 'CODE128');
    let dl4 = await clickRun(page);
    let buf4 = await saveDownload(page, dl4);
    if (buf4) {
      ok(dl4.suggestedFilename() === 'toolisto-barcode.code128.png', `barcodeGenerate descarga "${dl4.suggestedFilename()}"`);
      ok(buf4.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'barcodeGenerate produce una imagen PNG');
      ok(buf4.length > 500, 'barcodeGenerate genera un PNG con barras (mayor a 500 bytes)', buf4.length + ' bytes');
    } else fail('barcodeGenerate sin descarga');
    toast = await toastText(page);
    ok(toast.includes('Código de barras code128 generado para "1234567890128"'), `barcodeGenerate message: "${toast}"`);

    /* ── 5. qrReadFromImage (leer-qr-imagen) ──────────────────────────── */
    console.log('\n--- qrReadFromImage (leer-qr-imagen) ---');
    await gotoPage(page, url, 'leer-qr-imagen');
    await page.locator('#readFile').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: buf });
    let dl5 = await clickRun(page);
    let buf5 = await saveDownload(page, dl5);
    if (buf5) {
      ok(dl5.suggestedFilename() === 'toolisto-qr-contenido.txt', `qrReadFromImage descarga "${dl5.suggestedFilename()}"`);
      const t = await readText(page, toBase64(buf5));
      ok(t.includes('Contenido del QR:\nhttps://toolisto.app/certificar'), 'qrReadFromImage extrae el contenido exacto del QR', t.split('\n')[1]);
      ok(t.includes('Tipo:') && t.includes('Posición detectada: Sí'), 'qrReadFromImage reporta tipo y posición', t.split('\n').slice(2).join(' | '));
    } else fail('qrReadFromImage sin descarga');
    toast = await toastText(page);
    ok(toast.includes('QR leído exitosamente. Contenido: "https://toolisto.app/certificar"'), `qrReadFromImage message: "${toast}"`);

    /* ── 6. barcodeReadFromImage con QR (leer-codigo-barras-imagen) ───── */
    console.log('\n--- barcodeReadFromImage con imagen QR ---');
    await gotoPage(page, url, 'leer-codigo-barras-imagen');
    await page.locator('#readFile').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: buf });
    let dl6 = await clickRun(page);
    let buf6 = await saveDownload(page, dl6);
    if (buf6) {
      ok(dl6.suggestedFilename() === 'toolisto-barcode-resultado.txt', `barcodeReadFromImage descarga "${dl6.suggestedFilename()}"`);
      const t = await readText(page, toBase64(buf6));
      ok(t.includes('Se detectó un código QR (no un código de barras lineal)') && t.includes('https://toolisto.app/certificar'), 'barcodeReadFromImage detecta el QR y reporta el contenido', t.split('\n').slice(0, 3).join(' | '));
      ok(t.includes('Dimensiones:') && t.includes('px'), 'barcodeReadFromImage reporta dimensiones de la imagen');
    } else fail('barcodeReadFromImage sin descarga');
    toast = await toastText(page);
    ok(toast.includes('Se detectó un código QR. Ver resultado.'), `barcodeReadFromImage message: "${toast}"`);

    /* ── 7. barcodeReadFromImage con código de barras lineal ───────────── */
    console.log('\n--- barcodeReadFromImage con código de barras lineal ---');
    await gotoPage(page, url, 'leer-codigo-barras-imagen');
    await page.locator('#readFile').setInputFiles({ name: 'barcode.png', mimeType: 'image/png', buffer: buf4 });
    let dl7 = await clickRun(page);
    let buf7 = await saveDownload(page, dl7);
    if (buf7) {
      const t = await readText(page, toBase64(buf7));
      ok(t.includes('No se detectó ningún código QR en la imagen.'), 'barcodeReadFromImage analiza la imagen sin QR (reporta honestamente)', t.split('\n')[3]);
      ok(t.includes('Archivo: barcode.png'), 'barcodeReadFromImage conserva el nombre del archivo');
    } else fail('barcodeReadFromImage (barras) sin descarga');
    toast = await toastText(page);
    ok(toast.includes('No se detectó código. Ver análisis.'), `barcodeReadFromImage (barras) message: "${toast}"`);

    /* ── 8. Negativo qrReadFromImage (imagen sin QR) ───────────────────── */
    console.log('\n--- qrReadFromImage negativo (imagen sin QR) ---');
    await gotoPage(page, url, 'generar-qr');
    const plainB64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#4488cc';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(10, 10, 24, 24);
      return c.toDataURL('image/png').split(',')[1];
    });
    const plainBuf = Buffer.from(plainB64, 'base64');
    await gotoPage(page, url, 'leer-qr-imagen');
    await page.locator('#readFile').setInputFiles({ name: 'plano.png', mimeType: 'image/png', buffer: plainBuf });
    const dlNeg = await clickRun(page);
    const bufNeg = await saveDownload(page, dlNeg);
    ok(bufNeg === null, 'qrReadFromImage no descarga nada con imagen sin QR');
    toast = await toastText(page);
    ok(toast.includes('No se detectó ningún código QR en la imagen.'), `qrReadFromImage negativo toast: "${toast}"`, toast);

    /* ── 9. Validación de formulario ──────────────────────────────────── */
    console.log('\n--- Validación de formulario ---');
    await gotoPage(page, url, 'generar-qr');
    const dlEmpty = await clickRun(page);
    const bufEmpty = await saveDownload(page, dlEmpty);
    ok(bufEmpty === null, 'qrGenerate no descarga con texto vacío');
    toast = await toastText(page);
    ok(toast.includes('Completa los campos obligatorios.'), `qrGenerate vacío toast: "${toast}"`);
    await gotoPage(page, url, 'generar-qr-wifi');
    const dlEmpty2 = await clickRun(page);
    const bufEmpty2 = await saveDownload(page, dlEmpty2);
    ok(bufEmpty2 === null, 'qrWifi no descarga con SSID vacío');
    toast = await toastText(page);
    ok(toast.includes('Completa los campos obligatorios.'), `qrWifi vacío toast: "${toast}"`);

    /* ── 10. qrBatchFromCsv (generar-qr-por-lote) ─────────────────────── */
    console.log('\n--- qrBatchFromCsv (generar-qr-por-lote) ---');
    const csvLote = Buffer.from(
      'contenido\nhttps://toolisto.app/a\nhttps://toolisto.app/b\nhttps://toolisto.app/c\n'
    );
    await gotoPage(page, url, 'generar-qr-por-lote');
    await page.locator('#csvFile').setInputFiles({ name: 'lotes.csv', mimeType: 'text/csv', buffer: csvLote });
    await page.waitForFunction(() => {
      const s = document.getElementById('csvTextCol');
      return s && s.options.length > 0;
    }, { timeout: 15000 });
    await page.selectOption('#csvTextCol', '0');
    let dl8 = await clickRun(page);
    let buf8 = await saveDownload(page, dl8);
    if (buf8) {
      ok(dl8.suggestedFilename() === 'toolisto-qr-lote.zip', `qrBatchFromCsv descarga "${dl8.suggestedFilename()}"`);
      ok(buf8.slice(0, 2).toString('latin1') === 'PK', 'qrBatchFromCsv produce un ZIP con firma PK');
      const zip = await inspectZip(page, toBase64(buf8));
      ok(zip.pngCount === 3, 'qrBatchFromCsv empaqueta 3 PNG (uno por fila)', zip.names.join(' | '));
      ok(zip.names.every((n) => /^qr_00[123]_/.test(n) && n.endsWith('.png')), 'qrBatchFromCsv nombra los PNG con índice', zip.names.join(' | '));
      ok(zip.firstData === 'https://toolisto.app/a', 'qrBatchFromCsv codifica el contenido de la columna en cada QR', zip.firstData || 'null');
    } else fail('qrBatchFromCsv sin descarga');
    toast = await toastText(page);
    ok(toast.includes('3 códigos QR generados desde CSV y empaquetados en ZIP.'), `qrBatchFromCsv message: "${toast}"`);

    /* ── 11. Sin red externa ──────────────────────────────────────────── */
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
    await gotoPage(page, url, 'generar-qr');
    await page.fill('#text', 'https://toolisto.app/hermetico');
    const dlOff = await clickRun(page);
    const bufOff = await saveDownload(page, dlOff);
    if (bufOff) {
      const code = await decodeQr(page, toBase64(bufOff));
      ok(code && code.data === 'https://toolisto.app/hermetico', 'qrGenerate funciona con toda la red externa bloqueada', code ? code.data : 'null');
    } else fail('qrGenerate (offline) sin descarga');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await page.unroute('**/*');

    /* ── 12. Consola ──────────────────────────────────────────────────── */
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
    suite: 'gate-e2e-qr-tools',
    updatedAt: new Date().toISOString(),
    tools: [
      'qrGenerate', 'qrWifi', 'qrVcard', 'barcodeGenerate',
      'qrReadFromImage', 'barcodeReadFromImage', 'qrBatchFromCsv',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-qr-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
