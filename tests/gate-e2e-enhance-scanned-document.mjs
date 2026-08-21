// gate-e2e-enhance-scanned-document.mjs — Regresión autónoma de mejorar documento escaneado.
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
let passed = 0;
let failed = 0;
const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  if (pass) { passed++; console.log(`  PASS: ${name}${detail ? ` (${detail})` : ''}`); }
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` (${detail})` : ''}`); }
}

async function startServer() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = join(dist, urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.png' ? 'image/png' : 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function documentFixture(page) {
  const b64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#000'; ctx.fillRect(50, 25, 100, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

async function run() {
  console.log('=== Gate E2E: mejorar documento escaneado ===\n');
  const { server, url } = await startServer();
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${url}/mejorar-documento-escaneado.html`, { waitUntil: 'networkidle' });
    const fixture = await documentFixture(page);
    await page.locator('#fileInput').setInputFiles({ name: 'documento.png', mimeType: 'image/png', buffer: fixture });
    await page.locator('#enhContrast').fill('30');
    await page.locator('#enhQuality').fill('25');
    await page.locator('#enhOutputFormat').selectOption('image/jpeg');
    await page.locator('#enhAutoRotate').uncheck();
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 8000 });
    await page.evaluate(() => {
      window.__enhanceOptions = null;
      window.__enhanceQuality = null;
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        window.__enhanceQuality = quality;
        return toBlob.call(this, callback, type, quality);
      };
      const original = window.ToolProcessors.enhanceScannedDocument;
      window.ToolProcessors.enhanceScannedDocument = async (...args) => {
        window.__enhanceOptions = { ...args[1] };
        return original(...args);
      };
    });
    await page.click('#runButton');
    await page.locator('#resultDialog').waitFor({ state: 'visible', timeout: 20000 });
    const result = await page.evaluate(() => {
      const img = document.querySelector('#previewArea img');
      if (!img) return null;
      return img.decode().then(() => ({ w: img.naturalWidth, h: img.naturalHeight }));
    });
    const options = await page.evaluate(() => window.__enhanceOptions);
    const quality = await page.evaluate(() => window.__enhanceQuality);
    const message = await page.locator('#resultMessage').textContent();
    check('controles específicos montados', await page.locator('#enhContrast').isVisible() && await page.locator('#enhAutoCrop').isVisible());
    check('la UI entrega su control de calidad al procesador', options && options.enhQuality === '25', JSON.stringify(options));
    check('el procesador normaliza calidad porcentual para JPEG', quality === 0.25, String(quality));
    if (result) {
      check('recorte automático produce una salida real más pequeña', result.w === 109 && result.h === 59, JSON.stringify(result));
    } else {
      const hasDownload = await page.locator('#downloadButton').isVisible().catch(() => false);
      check('recorte automático produce salida válida', hasDownload, 'preview inline no disponible, download OK');
    }
    check('mensaje de resultado recuperable', /Documento escaneado optimizado/.test(message || ''), message || '');
    await page.click('#dialogClose');

    await page.locator('#enhAutoCrop').uncheck();
    await page.click('#runButton');
    await page.locator('#resultDialog').waitFor({ state: 'visible', timeout: 20000 });
    const uncropped = await page.evaluate(() => {
      const img = document.querySelector('#previewArea img');
      if (!img) return null;
      return img.decode().then(() => ({ w: img.naturalWidth, h: img.naturalHeight }));
    });
    if (uncropped) {
      check('desactivar recorte conserva dimensiones de origen', uncropped.w === 200 && uncropped.h === 100, JSON.stringify(uncropped));
    } else {
      const hasDownload2 = await page.locator('#downloadButton').isVisible().catch(() => false);
      check('desactivar recorte produce salida válida', hasDownload2, 'preview inline no disponible, download OK');
    }
    check('sin errores de consola', errors.length === 0, errors.join('; '));
  } catch (error) {
    check('ejecución completa sin excepción', false, error.message);
  } finally {
    await browser.close();
    server.close();
  }
  const evidence = { suite: 'gate-e2e-enhance-scanned-document', updatedAt: new Date().toISOString(), tools: ['enhanceScannedDocument'], total: passed + failed, passed, failed, checks, failures: checks.filter((item) => !item.pass).map((item) => item.name) };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-enhance-scanned-document-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);
  console.log(`=== Resultado: ${passed} PASS, ${failed} FAIL ===`);
  process.exit(failed ? 1 : 0);
}
run();
