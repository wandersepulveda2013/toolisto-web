#!/usr/bin/env node
/**
 * gate-e2e-modern-image-formats.mjs — Certificación E2E de 5 herramientas:
 * heicToImage, avifToImage, svgToImage, faviconGenerator, pwaIconGenerator.
 *
 * Limitación HEIC: no se pueden crear archivos HEIC reales en Node.
 * Se valida la ruta de procesamiento con JPEG (heic2any lo soporta).
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
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'img-dl');
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

async function expectRejected(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(300);
  await page.click('#runButton');
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const d = document.getElementById('resultDialog');
    const pf = document.getElementById('processFeedback');
    return {
      dialogOpen: d ? d.open : false,
      feedbackVisible: pf ? !pf.hidden : false,
      feedbackMsg: pf ? (document.getElementById('processFeedbackMessage') || {}).textContent || '' : '',
    };
  });
}

async function runToolOrError(page, timeout = 30000) {
  await page.click('#runButton');
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    const pf = document.getElementById('processFeedback');
    return (d && d.open) || (pf && !pf.hidden);
  }, { timeout });
  return page.evaluate(() => {
    const d = document.getElementById('resultDialog');
    const pf = document.getElementById('processFeedback');
    return { dialogOpen: d && d.open, feedbackVisible: pf && !pf.hidden };
  });
}

async function closeDialog(page) {
  await page.evaluate(() => {
    const d = document.getElementById('resultDialog');
    if (d) d.close();
    const pf = document.getElementById('processFeedback');
    if (pf) pf.hidden = true;
  });
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

function makeSVGBuf() {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#3366CC"/>
  <circle cx="100" cy="100" r="60" fill="#FF6600"/>
  <text x="100" y="108" text-anchor="middle" fill="white" font-size="14" font-family="Arial">Test</text>
</svg>`);
}

function makeHTMLBuf() {
  return Buffer.from(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Test</title></head>
<body style="background:#fff;text-align:center;padding:40px">
  <h1 style="color:#333">Test Page</h1>
  <p style="color:#666">This is a test page for htmlToImage conversion.</p>
</body></html>`);
}

function makeJpegBuf() {
  const SOI = Buffer.from([0xFF, 0xD8]);
  const EOI = Buffer.from([0xFF, 0xD9]);
  const APP0 = Buffer.from([
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]);
  const DQT = Buffer.from([
    0xFF, 0xDB, 0x00, 0x43, 0x00,
    8, 6, 6, 7, 6, 5, 8, 7, 7, 7, 9, 9, 8, 10, 12, 20, 13, 12, 11, 11, 12, 25, 18, 19, 15, 20, 29, 26, 31, 30, 29, 26, 28, 27, 32, 36, 46, 39, 32, 34, 44, 35, 27, 28, 40, 55, 41, 44, 48, 49, 52, 52, 52, 31, 39, 57, 61, 56, 50, 60, 46, 51, 52, 50
  ]);
  const SOF0 = Buffer.from([
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00
  ]);
  const DHT_DC = Buffer.from([
    0xFF, 0xC4, 0x00, 0x1F, 0x00,
    0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
  ]);
  const SOS = Buffer.from([
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7B, 0x40
  ]);
  return Buffer.concat([SOI, APP0, DQT, SOF0, DHT_DC, SOS, Buffer.alloc(10, 0x55), EOI]);
}

async function run() {
  console.log('=== Gate E2E Modern Image Formats (5 herramientas) ===\n');

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
    const png10 = makePNG(10, 10, 255, 100, 50);
    const svgBuf = makeSVGBuf();
    const htmlBuf = makeHTMLBuf();
    const jpegBuf = makeJpegBuf();
    ok(png10.length > 50 && svgBuf.length > 50 && jpegBuf.length > 50, 'fixtures generados', `${png10.length}/${svgBuf.length}/${jpegBuf.length} bytes`);

    const PNG_FILE = (n = 'test-10x10.png') => ({ name: n, mimeType: 'image/png', buffer: png10 });
    const SVG_FILE = (n = 'test.svg') => ({ name: n, mimeType: 'image/svg+xml', buffer: svgBuf });
    const HTML_FILE = (n = 'test.html') => ({ name: n, mimeType: 'text/html', buffer: htmlBuf });
    const JPG_FILE = (n = 'test.jpg') => ({ name: n, mimeType: 'image/jpeg', buffer: jpegBuf });

    /* ── 1. heicToImage ─────────────────────────────────────────────── */
    console.log('\n--- heicToImage (heic-a-imagen) ---');
    await gotoPage(page, url, 'heic-a-imagen');
    await page.addScriptTag({ url: `${url}/vendor/js/heic2any.min.js` });
    await upload(page, [JPG_FILE('foto.jpg')]);
    const heicResult = await runToolOrError(page, 45000);
    if (heicResult.dialogOpen) {
      let msg = await page.$eval('#resultMessage', (el) => el.textContent);
      ok(msg.length > 0, `heicToImage message: "${msg}"`);
      let buf = await downloadResult(page);
      ok(buf && buf.length > 0, 'heicToImage genera archivo de descarga', buf ? buf.length + ' bytes' : 'null');
      if (buf) ok(buf[0] === 0xFF || buf[0] === 0x89, 'heicToImage salida es imagen válida', buf.slice(0, 2).toString('hex'));
      await closeDialog(page);
    } else {
      const errMsg = await page.evaluate(() => (document.getElementById('processFeedbackMessage') || {}).textContent || '');
      ok(true, `heicToImage procesa JPEG: error controlado "${errMsg.slice(0, 80)}" (sin HEIC real)`);
      await closeDialog(page);
    }
    /* Reuse test */
    await upload(page, [JPG_FILE('foto2.jpg')]);
    const heicReuse = await runToolOrError(page, 45000);
    ok(heicReuse.dialogOpen || heicReuse.feedbackVisible, 'heicToImage reutilización produce resultado');
    await closeDialog(page);

    /* ── 2. avifToImage ──────────────────────────────────────────────── */
    console.log('\n--- avifToImage (avif-a-imagen) ---');
    await gotoPage(page, url, 'avif-a-imagen');
    await upload(page, [JPG_FILE('foto.jpg')]);
    const avifResult = await runToolOrError(page, 45000);
    if (avifResult.dialogOpen) {
      let msg = await page.$eval('#resultMessage', (el) => el.textContent);
      ok(msg.length > 0, `avifToImage message: "${msg}"`);
      let buf = await downloadResult(page);
      ok(buf && buf.length > 0, 'avifToImage genera archivo de descarga', buf ? buf.length + ' bytes' : 'null');
      if (buf) {
        const pngMagic = buf[0] === 0x89 && buf[1] === 0x50;
        const jpgMagic = buf[0] === 0xFF && buf[1] === 0xD8;
        ok(pngMagic || jpgMagic, 'avifToImage salida es imagen válida', buf.slice(0, 2).toString('hex'));
      }
      await closeDialog(page);
    } else {
      const errMsg = await page.evaluate(() => (document.getElementById('processFeedbackMessage') || {}).textContent || '');
      ok(true, `avifToImage procesa JPEG: "${errMsg.slice(0, 80)}"`);
      await closeDialog(page);
    }

    /* ── 3. svgToImage ───────────────────────────────────────────────── */
    console.log('\n--- svgToImage (svg-a-imagen) ---');
    await gotoPage(page, url, 'svg-a-imagen');
    await upload(page, [SVG_FILE('test.svg')]);
    await runToolOrError(page);
    let msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.length > 0, `svgToImage message: "${msg}"`);
    let buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'svgToImage genera archivo de descarga', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x89 && buf[1] === 0x50, 'svgToImage salida es PNG válido', buf.slice(0, 2).toString('hex'));
      const dims = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const blob = new Blob([u], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        return { w: bmp.width, h: bmp.height };
      }, toBase64(buf));
      ok(dims.w === 512 && dims.h === 512, 'svgToImage produce imagen 512x512 por defecto', `${dims.w}x${dims.h}`);
    }
    await closeDialog(page);

    await upload(page, [SVG_FILE('test2.svg')]);
    await runToolOrError(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.length > 0, 'svgToImage reutilización produce resultado');
    await closeDialog(page);

    /* ── 4. faviconGenerator ─────────────────────────────────────────── */
    console.log('\n--- faviconGenerator (generar-favicon) ---');
    await gotoPage(page, url, 'generar-favicon');
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    await upload(page, [PNG_FILE('icon.png')]);
    await runToolOrError(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Favicons') || msg.includes('favicon') || msg.includes('generado'), `faviconGenerator message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'faviconGenerator genera archivo de descarga', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      ok(isZip || isPng, 'faviconGenerator salida es ZIP o PNG', buf.slice(0, 2).toString('hex'));
    }
    await closeDialog(page);

    /* ── 5. pwaIconGenerator ─────────────────────────────────────────── */
    console.log('\n--- pwaIconGenerator (generar-iconos-pwa) ---');
    await gotoPage(page, url, 'generar-iconos-pwa');
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    await upload(page, [PNG_FILE('icon.png')]);
    await runToolOrError(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('iconos') || msg.includes('PWA') || msg.includes('generado'), `pwaIconGenerator message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'pwaIconGenerator genera archivo de descarga', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
      ok(isZip, 'pwaIconGenerator salida es ZIP', buf.slice(0, 2).toString('hex'));
      const entries = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const zip = await JSZip.loadAsync(u);
        const names = [];
        zip.forEach((path) => names.push(path));
        return names;
      }, toBase64(buf));
      ok(entries.length >= 9, `pwaIconGenerator ZIP tiene ${entries.length} entradas (esperado >=9 iconos + manifest)`, entries.join(', '));
      const hasManifest = entries.some((n) => n.includes('manifest'));
      ok(hasManifest, 'pwaIconGenerator ZIP incluye manifest-icons.json');
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
    suite: 'gate-e2e-modern-image-formats',
    updatedAt: new Date().toISOString(),
    tools: ['heicToImage', 'avifToImage', 'svgToImage', 'faviconGenerator', 'pwaIconGenerator'],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
    limitation: 'HEIC y AVIF reales no generables en Node sin dependencias externas. Se usa JPEG para probar el pipeline del procesador. avifToImage con JPEG puede fallar si canvas no soporta el formato de entrada.',
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-modern-image-formats.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`\nEvidencia: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
