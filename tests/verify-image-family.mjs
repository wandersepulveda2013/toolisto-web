// verify-image-family.mjs — Harness para la familia visual de imágenes certificada.
// Cubre: crop, stripMetadata, socialCrop, fileCompliance, colorPicker, imageCompare,
// docPhoto, censor, fixFormat, rescueDoc, enhanceScannedDocument, advancedConvert.
// Verifica píxeles y dimensiones reales (PNG/JPEG/WebP), eliminación de EXIF y ausencia de descarga
// en herramientas solo-visuales. Ejecutar con dist construido: node tests/verify-image-family.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 8098;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.gz': 'application/gzip', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.zip': 'application/zip',
  '.pdf': 'application/pdf', '.traineddata': 'application/octet-stream', '.traineddata.gz': 'application/gzip'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p.replace(/^\/+/, ''));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const byId = {};
for (const t of tools) byId[t.id] = t;

let passed = 0;
let failed = 0;
const failures = [];
const checks = [];

function ok(cond, msg) {
  checks.push({ name: msg, pass: !!cond });
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  FAIL: ' + msg); }
}

async function expect(page, locatorFn, desc) {
  try {
    await locatorFn().waitFor({ state: 'visible', timeout: 8000 });
    ok(true, desc);
  } catch (e) {
    ok(false, desc + ' (no encontrado)');
  }
}

async function openToolPage(browser, slug, viewport) {
  const ctx = await browser.newContext({
    viewport: viewport || { width: 1280, height: 900 },
    acceptDownloads: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load' });
  return { ctx, page, errors };
}

async function waitForCanvas(page, selector) {
  await page.waitForFunction((sel) => {
    const c = document.querySelector(sel);
    return c && c.width > 0 && c.height > 0;
  }, selector, { timeout: 10000 });
}

async function waitForResultDialog(page) {
  await page.locator('#resultDialog').waitFor({ state: 'visible', timeout: 10000 });
}

function captureDownload(page) {
  return page.waitForEvent('download', { timeout: 20000 });
}

async function saveDownload(download, suffix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlst-img-'));
  const dest = path.join(tmp, 'dl' + (suffix || ''));
  await download.saveAs(dest);
  const buf = fs.readFileSync(dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return buf;
}

async function readImageInBrowser(page, buf) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([bytes]));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    return { w: c.width, h: c.height, data: Array.from(d) };
  }, buf.toString('base64'));
}

function pxAt(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function injectExif(base) {
  const strings = ['Canon Test', 'EOS R50', 'Toolisto Test', 'Test Author'];
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0II*\0\x08\x00\x00\x00', 'latin1'),
    Buffer.from(strings.join('\0'), 'latin1')
  ]);
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xFF; app1[1] = 0xE1;
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}

/* ── Decodificador PNG (Node) para verificar píxeles y dimensiones ───── */

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (buf.length < 24 || buf.slice(1, 4).toString('ascii') !== 'PNG') return null;
  let w = 0, h = 0, colorType = 2;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xFF;
      else if (filter === 2) v = (v + b) & 0xFF;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xFF;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xFF;
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    cur.copy(prev);
  }
  return {
    w, h, colorType, bpp,
    get(x, y) {
      const i = (y * w + x) * bpp;
      const r = out[i], g = out[i + 1], b = out[i + 2];
      const a = bpp === 4 ? out[i + 3] : 255;
      return [r, g, b, a];
    }
  };
}

/* ── Checks por herramienta ──────────────────────────────────────────── */

async function checkCrop(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#cropPreset'), 'crop: controles de formato montados');
  await expect(page, () => page.locator('#cropPreviewWrap canvas'), 'crop: vista previa con marco visible');
  await waitForCanvas(page, '#cropPreviewWrap canvas');

  await page.selectOption('#cropPreset', 'custom');
  await page.fill('#cropWidth', '100');
  await page.fill('#cropHeight', '100');
  await page.selectOption('#cropFormat', 'image/png');
  await page.waitForTimeout(300);

  const canvasDims = await page.evaluate(() => {
    const c = document.querySelector('#cropPreviewWrap canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  ok(canvasDims && canvasDims.w > 0 && canvasDims.h > 0, 'crop: canvas de preview dimensionado');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  const png = decodePng(buf);
  ok(png && png.w === 100 && png.h === 100, 'crop: salida de 100×100 píxeles');
  const px = png ? png.get(50, 50) : null;
  ok(px && px[0] === 0 && px[1] === 100 && px[2] === 200, 'crop: color del origen conservado en el recorte');
  ok(errors.length === 0, 'crop: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkStripMetadata(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const base = Buffer.from(await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0064C8';
    ctx.fillRect(0, 0, 200, 100);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    const ab = await blob.arrayBuffer();
    return Array.from(new Uint8Array(ab));
  }));
  const src = injectExif(base);
  ok(src.toString('latin1').includes('Canon Test') && src.toString('latin1').includes('EOS R50'), 'stripMetadata: fixture con EXIF presente');

  await page.setInputFiles('#fileInput', { name: 'test-exif.jpg', mimeType: 'image/jpeg', buffer: src });
  await expect(page, () => page.locator('#stripDetectedInfo'), 'stripMetadata: detección de metadatos visible');
  await page.selectOption('#stripOutputFormat', 'auto');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Metadatos eliminados') !== -1, 'stripMetadata: título de resultado correcto');

  const dl = await dlP;
  const out = await saveDownload(dl, '.jpg');
  ok(out[0] === 0xFF && out[1] === 0xD8, 'stripMetadata: salida sigue siendo JPEG');
  const outStr = out.toString('latin1');
  ok(outStr.indexOf('Canon Test') === -1 && outStr.indexOf('EOS R50') === -1 && outStr.indexOf('Toolisto Test') === -1,
    'stripMetadata: EXIF eliminado de la salida');
  ok(errors.length === 0, 'stripMetadata: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkSocialCrop(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#socialPreset'), 'socialCrop: controles de plataforma montados');
  await expect(page, () => page.locator('#socialCanvasWrap canvas'), 'socialCrop: lienzo de edición visible');
  await waitForCanvas(page, '#socialCanvasWrap canvas');

  await page.selectOption('#socialPreset', 'igSquare');
  await page.selectOption('#socialFormat', 'image/png');
  await page.waitForTimeout(200);

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  const png = decodePng(buf);
  ok(png && png.w === 1080 && png.h === 1080, 'socialCrop: salida 1080×1080 (preset igSquare)');
  const center = png ? png.get(540, 540) : null;
  ok(center && center[0] === 0 && center[1] === 100 && center[2] === 200, 'socialCrop: color del origen en el centro');
  ok(errors.length === 0, 'socialCrop: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkFileCompliance(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#complianceResults'), 'fileCompliance: análisis automático renderizado');
  await page.waitForTimeout(300);

  const text0 = await page.locator('#complianceResults').textContent();
  ok(text0.indexOf('Cumple') !== -1, 'fileCompliance: badge "Cumple" presente con requisitos permisivos');
  ok(!/[✅❌⚠️🎨🖼🔒]/.test(text0), 'fileCompliance: sin emojis como iconos en el análisis');
  ok(text0.indexOf('Archivo cumple todos los requisitos') !== -1, 'fileCompliance: estado cumple mostrado');

  await page.fill('#complianceMaxKB', '1');
  await page.fill('#complianceMinW', '300');
  await page.fill('#complianceMaxW', '100');
  await page.fill('#complianceMinH', '200');
  await page.click('#complianceAnalyzeBtn');
  await page.waitForTimeout(300);
  const text1 = await page.locator('#complianceResults').textContent();
  const noCumpleCount = (text1.match(/No cumple/g) || []).length;
  ok(noCumpleCount >= 3, 'fileCompliance: múltiples checks marcados como "No cumple"');
  ok(text1.indexOf('Archivo no cumple algunos requisitos') !== -1, 'fileCompliance: estado de incumplimiento mostrado');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  const png = decodePng(buf);
  ok(png && png.w === 100 && png.h === 50, 'fileCompliance: salida ajustada a 100×50');
  const name = dl.suggestedFilename();
  ok(name.indexOf('-cumple') !== -1, 'fileCompliance: nombre de salida -cumple');
  ok(errors.length === 0, 'fileCompliance: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkColorPicker(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#colorPickerWrap canvas').first(), 'colorPicker: lienzo de captura visible');
  await waitForCanvas(page, '#colorPickerWrap canvas');

  await page.locator('#colorPickerWrap canvas').first().click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  const hex = await page.locator('#colorPickerHex').textContent();
  const rgb = await page.locator('#colorPickerRgb').textContent();
  ok(hex === '#0064C8', 'colorPicker: HEX capturado correcto (obtuve ' + hex + ')');
  ok(rgb === 'rgb(0, 100, 200)', 'colorPicker: RGB capturado correcto (obtuve ' + rgb + ')');

  const dlVisibleBefore = await page.locator('#downloadButton').isHidden();
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Color seleccionado') !== -1, 'colorPicker: resumen de resultado mostrado');
  const stats = await page.locator('#resultStats').textContent();
  ok(stats.indexOf('#0064C8') !== -1, 'colorPicker: HEX en estadísticas del resumen');
  ok(dlVisibleBefore, 'colorPicker: sin botón de descarga desde el inicio del análisis');
  const dlHidden = await page.locator('#downloadButton').isHidden();
  ok(dlHidden, 'colorPicker: sin botón de descarga en el resumen');
  ok(errors.length === 0, 'colorPicker: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkImageCompare(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', [
    { name: 'a.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(FIXTURES, 'test-200x100.png')) },
    { name: 'b.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(FIXTURES, 'test-10x10.png')) }
  ]);
  await expect(page, () => page.locator('#compareCanvasWrap canvas'), 'imageCompare: lienzo comparador visible');
  await waitForCanvas(page, '#compareCanvasWrap canvas');

  await page.click('#compareToggleBtn');
  const togLabel = await page.locator('#compareToggleBtn').textContent();
  ok(togLabel.indexOf('Mostrar A') !== -1, 'imageCompare: botón de alternancia cambia a "Mostrar A"');

  await page.selectOption('#compareMode', 'diff');
  await page.waitForTimeout(200);
  const thHidden = await page.locator('#compareThresholdWrap').getAttribute('hidden').catch(() => null);
  ok(thHidden === null, 'imageCompare: umbral visible en modo diferencia');
  const ovHidden = await page.locator('#compareOverlayWrap').getAttribute('hidden').catch(() => null);
  ok(ovHidden !== null, 'imageCompare: opacidad oculta en modo diferencia');

  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Comparación completada') !== -1, 'imageCompare: resumen de comparación mostrado');
  const stats = await page.locator('#resultStats').textContent();
  ok(stats.indexOf('Píxeles diferentes') !== -1 && stats.indexOf('20000 de 20000') !== -1,
    'imageCompare: estadísticas de diferencia correctas (20000/20000)');
  ok(stats.indexOf('Difieren') !== -1, 'imageCompare: dimensiones marcadas como diferentes');
  const dlHidden = await page.locator('#downloadButton').isHidden();
  ok(dlHidden, 'imageCompare: sin botón de descarga (solo visual)');
  ok(errors.length === 0, 'imageCompare: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkImageCompareIdentical(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const buf = fs.readFileSync(path.join(FIXTURES, 'test-200x100.png'));
  await page.setInputFiles('#fileInput', [
    { name: 'a.png', mimeType: 'image/png', buffer: buf },
    { name: 'b.png', mimeType: 'image/png', buffer: buf }
  ]);
  await expect(page, () => page.locator('#compareCanvasWrap canvas'), 'imageCompare(iguales): lienzo comparador visible');
  await waitForCanvas(page, '#compareCanvasWrap canvas');
  await page.click('#runButton');
  await waitForResultDialog(page);
  const msg = await page.locator('#resultMessage').textContent();
  ok(msg.indexOf('idénticas') !== -1, 'imageCompare(iguales): mensaje de imágenes idénticas');
  const stats = await page.locator('#resultStats').textContent();
  ok(stats.indexOf('0 de 20000') !== -1, 'imageCompare(iguales): cero píxeles diferentes');
  ok(errors.length === 0, 'imageCompare(iguales): sin errores de consola');
  await ctx.close();
}

async function checkDocPhoto(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#docPhotoPreset'), 'docPhoto: controles de tipo de documento montados');
  await expect(page, () => page.locator('#docPhotoDpi'), 'docPhoto: control de DPI montado');
  await page.selectOption('#docPhotoPreset', 'passport');
  await page.fill('#docPhotoDpi', '300');
  await page.selectOption('#docPhotoFormat', 'image/jpeg');
  await page.selectOption('#docPhotoSheet', 'photo');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Foto para documento') !== -1, 'docPhoto: título de resultado correcto');
  const stats = await page.locator('#resultStats').textContent();
  ok(stats.indexOf('484×602') !== -1, 'docPhoto: dimensiones 484×602 px en estadísticas');

  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.jpg');
  ok(buf[0] === 0xFF && buf[1] === 0xD8, 'docPhoto: salida es JPEG');
  const img = await readImageInBrowser(page, buf);
  ok(img.w === 484 && img.h === 602, 'docPhoto: salida de 484×602 píxeles');
  const px = pxAt(img, 242, 301);
  ok(px && Math.abs(px[0] - 0) <= 10 && Math.abs(px[1] - 100) <= 10 && Math.abs(px[2] - 200) <= 10,
    'docPhoto: color del origen conservado en el centro de la foto');
  ok(errors.length === 0, 'docPhoto: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkCensor(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#censorConfirm'), 'censor: confirmación de autorización presente');
  await page.check('#censorConfirm');
  await expect(page, () => page.locator('#censorCanvasWrap canvas'), 'censor: lienzo de pintado visible');
  await waitForCanvas(page, '#censorCanvasWrap canvas');
  await page.selectOption('#censorMode', 'solidBlack');

  await page.locator('#censorCanvasWrap canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await page.locator('#censorCanvasWrap canvas').boundingBox();
  ok(box && box.width > 0, 'censor: lienzo dimensionado');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 10, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Información ocultada') !== -1, 'censor: título de resultado correcto');
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  ok(buf[0] === 0x89 && buf[1] === 0x50, 'censor: salida es PNG');
  const img = await readImageInBrowser(page, buf);
  ok(img.w === 200 && img.h === 100, 'censor: dimensiones conservadas');
  const cen = pxAt(img, 100, 50);
  ok(cen && cen[0] === 0 && cen[1] === 0 && cen[2] === 0, 'censor: zona pintada en negro sólido');
  const corner = pxAt(img, 5, 5);
  ok(corner && corner[0] === 0 && corner[1] === 100 && corner[2] === 200, 'censor: zona sin pintar conserva el color');
  ok(errors.length === 0, 'censor: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkFixFormat(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#fixFormatTarget'), 'fixFormat: control de formato de salida montado');
  await expect(page, () => page.locator('#fixFormatDetection'), 'fixFormat: detección de formato visible');
  await page.waitForTimeout(300);
  const det = await page.locator('#fixFormatDetection').textContent();
  ok(det.indexOf('PNG') !== -1, 'fixFormat: formato detectado PNG');
  await page.selectOption('#fixFormatTarget', 'image/jpeg');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Formato reparado') !== -1, 'fixFormat: título de resultado correcto');
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.jpg');
  ok(buf[0] === 0xFF && buf[1] === 0xD8, 'fixFormat: salida re-codificada como JPEG');
  const img = await readImageInBrowser(page, buf);
  ok(img.w === 200 && img.h === 100, 'fixFormat: dimensiones conservadas');
  const px = pxAt(img, 100, 50);
  ok(px && Math.abs(px[0] - 0) <= 10 && Math.abs(px[1] - 100) <= 10 && Math.abs(px[2] - 200) <= 10,
    'fixFormat: color del origen conservado tras re-codificar');
  ok(errors.length === 0, 'fixFormat: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkRescueDoc(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#rescueColorMode'), 'rescueDoc: controles de color montados');
  await expect(page, () => page.locator('#rescueCanvasWrap canvas'), 'rescueDoc: lienzo de preview visible');
  await waitForCanvas(page, '#rescueCanvasWrap canvas');
  await page.selectOption('#rescueColorMode', 'bw');
  await page.selectOption('#rescueOutput', 'auto');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Documento rescatado') !== -1, 'rescueDoc: título de resultado correcto');
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  ok(buf[0] === 0x89 && buf[1] === 0x50, 'rescueDoc: salida es PNG');
  const img = await readImageInBrowser(page, buf);
  ok(img.w === 200 && img.h === 100, 'rescueDoc: dimensiones conservadas');
  const px = pxAt(img, 100, 50);
  ok(px && px[0] === 0 && px[1] === 0 && px[2] === 0, 'rescueDoc: blanco y negro aplicado (centro negro)');
  ok(errors.length === 0, 'rescueDoc: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkEnhanceScanned(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#enhContrast'), 'enhanceScannedDocument: control de contraste montado');
  await expect(page, () => page.locator('#enhAutoCrop'), 'enhanceScannedDocument: control de recorte automático montado');
  await page.fill('#enhContrast', '30');
  await page.selectOption('#enhOutputFormat', 'image/png');
  if (await page.locator('#enhAutoCrop').isChecked()) await page.uncheck('#enhAutoCrop');
  if (await page.locator('#enhAutoRotate').isChecked()) await page.uncheck('#enhAutoRotate');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const msg = await page.locator('#resultMessage').textContent();
  ok(msg.indexOf('escaneado') !== -1, 'enhanceScannedDocument: mensaje de resultado correcto');
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  ok(buf[0] === 0x89 && buf[1] === 0x50, 'enhanceScannedDocument: salida es PNG');
  const img = await readImageInBrowser(page, buf);
  ok(img.w === 200 && img.h === 100, 'enhanceScannedDocument: dimensiones conservadas');
  const px = pxAt(img, 100, 50);
  ok(px && Math.abs(px[0] - 0) <= 4 && Math.abs(px[1] - 93) <= 4 && Math.abs(px[2] - 219) <= 4,
    'enhanceScannedDocument: contraste aplicado en el píxel central (' + (px ? px.slice(0, 3).join(',') : '?') + ')');
  ok(errors.length === 0, 'enhanceScannedDocument: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkAdvancedConvert(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'test-200x100.png'));
  await expect(page, () => page.locator('#advConvertFormat'), 'advancedConvert: control de formato montado');
  await expect(page, () => page.locator('#advResizeMode'), 'advancedConvert: control de redimensionado montado');
  await page.selectOption('#advConvertFormat', 'image/webp');
  await page.selectOption('#advResizeMode', 'width');
  await page.fill('#advResizeValue', '50');

  const dlP = captureDownload(page);
  await page.click('#runButton');
  await waitForResultDialog(page);
  const title = await page.locator('#resultTitle').textContent();
  ok(title.indexOf('Imagen convertida') !== -1, 'advancedConvert: título de resultado correcto');
  await page.click('#downloadButton');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.webp');
  ok(buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP', 'advancedConvert: salida es WebP');
  const img = await readImageInBrowser(page, buf);
  ok(img.w === 50 && img.h === 25, 'advancedConvert: redimensionado a 50×25');
  const name = dl.suggestedFilename();
  ok(name.indexOf('.webp') !== -1, 'advancedConvert: nombre de salida .webp');
  ok(errors.length === 0, 'advancedConvert: sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

/* ── Mapa de ejecución ───────────────────────────────────────────────── */

const EXEC = {
  crop: checkCrop,
  stripMetadata: checkStripMetadata,
  socialCrop: checkSocialCrop,
  fileCompliance: checkFileCompliance,
  colorPicker: checkColorPicker,
  imageCompare: checkImageCompare,
  imageCompareIdentical: (b, t) => checkImageCompareIdentical(b, byId['imageCompare']),
  docPhoto: checkDocPhoto,
  censor: checkCensor,
  fixFormat: checkFixFormat,
  rescueDoc: checkRescueDoc,
  enhanceScannedDocument: checkEnhanceScanned,
  advancedConvert: checkAdvancedConvert
};

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch();

  const ids = process.env.ONLY ? process.env.ONLY.split(',').filter(Boolean) : Object.keys(EXEC);
  for (const id of ids) {
    const tool = id === 'imageCompareIdentical' ? byId['imageCompare'] : byId[id];
    process.stdout.write('  → ' + id + ' ... ');
    try {
      await EXEC[id](browser, tool);
      console.log('ok');
    } catch (e) {
      console.log('ERROR');
      ok(false, id + ': error al ejecutar check -> ' + (e && e.message ? e.message : e));
    }
  }

  await browser.close();
  server.close();
  console.log(`\nVerificación familia visual de imágenes: ${passed} PASS, ${failed} FAIL, ${passed + failed} total.`);
  const evidence = {
    suite: 'verify-image-family',
    updatedAt: new Date().toISOString(),
    tools: Object.keys(EXEC),
    total: passed + failed,
    passed,
    failed,
    checks,
    failures,
  };
  const evidencePath = path.join(ROOT, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-image-family-evidence.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log('Evidencia: ' + evidencePath);
  if (failed > 0) {
    console.log('Fallos:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
