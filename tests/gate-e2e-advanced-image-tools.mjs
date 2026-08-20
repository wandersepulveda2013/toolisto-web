#!/usr/bin/env node
/**
 * gate-e2e-advanced-image-tools.mjs — Certificación E2E de 5 herramientas:
 * removeBackground, upscaleImage, faceBlur, colorPalette, htmlToImage.
 */
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { deflateSync } from 'zlib';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'adv-img-dl');
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

function makePNG(width, height, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) { raw.push(r, g, b); }
  }
  const compressed = deflateSync(Buffer.from(raw));
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

function makeHTMLBuf() {
  return Buffer.from(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Test</title></head>
<body style="background:#ffffff;margin:0;padding:20px">
  <div style="width:600px;height:400px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);display:flex;align-items:center;justify-content:center">
    <h1 style="color:#fff;font-family:Arial;font-size:32px;margin:0">Test Page</h1>
  </div>
  <p style="font-family:Arial;color:#333">This is a test for html-to-image conversion.</p>
</body></html>`);
}

async function run() {
  console.log('=== Gate E2E Advanced Image Tools (5 herramientas) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('net::ERR')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    console.log('\n--- Fixtures ---');
    const png200 = makePNG(200, 100, 200, 50, 50);
    const htmlBuf = makeHTMLBuf();
    ok(png200.length > 50 && htmlBuf.length > 50, 'fixtures generados');

    const PNG_FILE = (n = 'test-200x100.png') => ({ name: n, mimeType: 'image/png', buffer: png200 });
    const HTML_FILE = (n = 'test.html') => ({ name: n, mimeType: 'text/html', buffer: htmlBuf });

    /* ── 1. removeBackground ─────────────────────────────────────────── */
    console.log('\n--- removeBackground (quitar-fondo-imagen) ---');
    await gotoPage(page, url, 'quitar-fondo-imagen');
    await upload(page, [PNG_FILE('foto.png')]);
    await runTool(page);
    let msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('fondo') || msg.includes('imagen') || msg.includes('eliminado'), `removeBackground message: "${msg}"`);
    let buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'removeBackground genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x89 && buf[1] === 0x50, 'removeBackground salida es PNG válido', buf.slice(0, 2).toString('hex'));
      const hasAlpha = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const blob = new Blob([u], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let transparent = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
        return { transparent, total: data.length / 4, pct: Math.round(100 * transparent / (data.length / 4)) };
      }, toBase64(buf));
      ok(hasAlpha.transparent > 0, `removeBackground produce transparencia (${hasAlpha.pct}% transparente)`, JSON.stringify(hasAlpha));
    }
    await closeDialog(page);

    await upload(page, [PNG_FILE('foto2.png')]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.length > 0, 'removeBackground reutilización produce resultado');
    await closeDialog(page);

    /* ── 2. upscaleImage ─────────────────────────────────────────────── */
    console.log('\n--- upscaleImage (aumentar-resolucion-imagen) ---');
    await gotoPage(page, url, 'aumentar-resolucion-imagen');
    await upload(page, [PNG_FILE('peque.png')]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('ampliada') || msg.includes('imagen') || msg.includes('resolución'), `upscaleImage message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'upscaleImage genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x89 && buf[1] === 0x50, 'upscaleImage salida es PNG válido');
      const dims = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const blob = new Blob([u], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        return { w: bmp.width, h: bmp.height };
      }, toBase64(buf));
      ok(dims.w === 400 && dims.h === 200, `upscaleImage produce imagen ${dims.w}x${dims.h} (esperado 400x200 a 2x)`, JSON.stringify(dims));
    }
    await closeDialog(page);

    /* ── 3. faceBlur ──────────────────────────────────────────────────── */
    console.log('\n--- faceBlur (difuminar-caras-imagen) ---');
    await gotoPage(page, url, 'difuminar-caras-imagen');
    await upload(page, [PNG_FILE('retrato.png')]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('caras') || msg.includes('Procesamiento') || msg.includes('completado'), `faceBlur message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'faceBlur genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x89 && buf[1] === 0x50, 'faceBlur salida es PNG válido');
      const dims = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const blob = new Blob([u], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        return { w: bmp.width, h: bmp.height };
      }, toBase64(buf));
      ok(dims.w === 200 && dims.h === 100, `faceBlur conserva dimensiones ${dims.w}x${dims.h}`, JSON.stringify(dims));
    }
    await closeDialog(page);

    /* ── 4. colorPalette ──────────────────────────────────────────────── */
    console.log('\n--- colorPalette (extraer-paleta-colores) ---');
    await gotoPage(page, url, 'extraer-paleta-colores');
    await upload(page, [PNG_FILE('colores.png')]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('paleta') || msg.includes('colores') || msg.includes('extraída'), `colorPalette message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'colorPalette genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const text = buf.toString('utf-8');
      ok(text.includes('#') && text.includes('rgb'), 'colorPalette salida contiene colores hex y rgb', text.split('\n').slice(0, 5).join(' | '));
      ok(text.includes('Paleta de colores'), 'colorPalette salida tiene cabecera correcta');
      const colorCount = (text.match(/#[0-9a-fA-F]{6}/g) || []).length;
      ok(colorCount >= 1, `colorPalette detecta ${colorCount} colores`);
    }
    await closeDialog(page);

    /* ── 5. htmlToImage ───────────────────────────────────────────────── */
    console.log('\n--- htmlToImage (html-a-imagen) ---');
    await gotoPage(page, url, 'html-a-imagen');
    await page.addScriptTag({ url: `${url}/vendor/js/html2canvas.min.js` });
    await upload(page, [HTML_FILE('pagina.html')]);
    await runTool(page, 45000);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('imagen') || msg.includes('HTML') || msg.includes('generada'), `htmlToImage message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'htmlToImage genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x89 && buf[1] === 0x50, 'htmlToImage salida es PNG válido', buf.slice(0, 2).toString('hex'));
      const dims = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const blob = new Blob([u], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        return { w: bmp.width, h: bmp.height };
      }, toBase64(buf));
      ok(dims.w > 100 && dims.h > 50, `htmlToImage produce imagen ${dims.w}x${dims.h}`, JSON.stringify(dims));
    }
    await closeDialog(page);

    /* ── Errores de consola ──────────────────────────────────────────── */
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
    suite: 'gate-e2e-advanced-image-tools',
    updatedAt: new Date().toISOString(),
    tools: ['removeBackground', 'upscaleImage', 'faceBlur', 'colorPalette', 'htmlToImage'],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
    limitation: 'faceBlur usa heurística de posición central (no ML real). removeBackground usa distancia euclidiana por color (no ML real). upscaleImage es interpolación bicúbica (no super-resolution IA).',
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-advanced-image-tools.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`\nEvidencia: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
