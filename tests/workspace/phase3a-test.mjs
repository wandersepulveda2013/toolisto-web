#!/usr/bin/env node
/**
 * Phase 3A Tests — Image Processor & Scanner UI
 * Tests edge detection, perspective correction, corner detection,
 * bilinear sampling, object URL lifecycle, and scanner UI rendering.
 * 
 * All tests run in-browser via Playwright because Canvas APIs are required.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const SCREENSHOTS = join(ROOT, 'screenshots', 'workspace');
mkdirSync(SCREENSHOTS, { recursive: true });

const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json',
  '.ico':'image/x-icon', '.mjs':'application/javascript; charset=utf-8'
};

const srv = createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  let fp = join(DIST, file);
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
  if (!existsSync(fp)) fp = join(DIST, file + '.html');
  const ext = extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream'});
    res.end(data);
  });
});

let pass = 0, fail = 0;
function ok(n, d='') { pass++; console.log(`  PASS: ${n}${d?' — '+d:''}`); }
function ko(n, d='') { fail++; console.log(`  FAIL: ${n}${d?' — '+d:''}`); }

await new Promise(r => srv.listen(8081, r));
console.log('Server on :8081\n');

try {
  console.log('=== Phase 3A: Image Processor & Scanner Tests ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  await page.goto('http://localhost:8081/workspace/index.html?preview=internal', { waitUntil: 'networkidle', timeout: 15000 });

  // ─── Image Processor Module Loading ───
  console.log('--- 1. Module Loading ---');
  const moduleLoaded = await page.evaluate(async () => {
    try {
      const mod = await import('./core/image-processor.js');
      return typeof mod.processImageCapture === 'function';
    } catch (e) { return false; }
  });
  ok('image-processor.js loads in browser', moduleLoaded);

  const scannerModuleLoaded = await page.evaluate(async () => {
    try {
      const mod = await import('./core/scanner-ui.js');
      return typeof mod.createScannerUI === 'function';
    } catch (e) { return false; }
  });
  ok('scanner-ui.js loads in browser', scannerModuleLoaded);

  // ─── Edge Detection ───
  console.log('\n--- 2. Edge Detection ---');
  const edgeTest = await page.evaluate(async () => {
    const { sobelEdges, toGrayscale, gaussianBlur } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 100; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#000';
    ctx.fillRect(30, 30, 40, 40);
    const imgData = ctx.getImageData(0, 0, 100, 100);
    const gray = toGrayscale(imgData);
    const blurred = gaussianBlur(gray, 100, 100);
    const edges = sobelEdges(blurred, 100, 100);
    let edgeCount = 0;
    for (let i = 0; i < edges.data.length; i += 4) {
      if (edges.data[i] > 0) edgeCount++;
    }
    return { width: edges.width, height: edges.height, edgeCount };
  });
  ok('Sobel edges correct dimensions', edgeTest.width === 100 && edgeTest.height === 100);
  ok('Sobel edges detect black square edges', edgeTest.edgeCount > 100, `Found ${edgeTest.edgeCount} edge pixels`);

  // ─── Grayscale ───
  console.log('\n--- 3. Grayscale ---');
  const grayTest = await page.evaluate(async () => {
    const { toGrayscale } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 10; c.height = 10;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(100, 150, 200)';
    ctx.fillRect(0, 0, 10, 10);
    const imgData = ctx.getImageData(0, 0, 10, 10);
    const gray = toGrayscale(imgData);
    const lum = 0.299 * 100 + 0.587 * 150 + 0.114 * 200;
    const pixel = [gray.data[0], gray.data[1], gray.data[2]];
    return { pixel, expected: Math.round(lum) };
  });
  ok('Grayscale R == G == B', grayTest.pixel[0] === grayTest.pixel[1] && grayTest.pixel[1] === grayTest.pixel[2]);
  ok('Grayscale value matches luminance', Math.abs(grayTest.pixel[0] - grayTest.expected) < 2, `Got ${grayTest.pixel[0]}, expected ~${grayTest.expected}`);

  // ─── Gaussian Blur ───
  console.log('\n--- 4. Gaussian Blur ---');
  const blurTest = await page.evaluate(async () => {
    const { gaussianBlur, toGrayscale } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 20, 20);
    ctx.fillStyle = '#000';
    ctx.fillRect(9, 9, 2, 2);
    const imgData = ctx.getImageData(0, 0, 20, 20);
    const gray = toGrayscale(imgData);
    const blurred = gaussianBlur(gray, 20, 20);
    const centerBefore = gray.data[(9 * 20 + 9) * 4];
    const centerAfter = blurred.data[(9 * 20 + 9) * 4];
    return { centerBefore, centerAfter };
  });
  ok('Blur reduces extreme values', blurTest.centerAfter > blurTest.centerBefore, `${blurTest.centerBefore} → ${blurTest.centerAfter}`);

  // ─── Quadrilateral Detection ───
  console.log('\n--- 5. Quadrilateral Detection ---');
  const quadTest = await page.evaluate(async () => {
    const { findDocumentQuadrilateral } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(40, 30);
    ctx.lineTo(170, 25);
    ctx.lineTo(175, 170);
    ctx.lineTo(35, 175);
    ctx.closePath();
    ctx.fill();
    const imgData = ctx.getImageData(0, 0, 200, 200);
    const result = findDocumentQuadrilateral(imgData, 200, 200);
    return { found: !!result, corners: result };
  });
  ok('Document quadrilateral detected', quadTest.found, quadTest.found ? '' : 'No quad found');
  if (quadTest.found) {
    ok('Quad has 4 corners', quadTest.corners.length === 4);
    ok('Corners are ordered', quadTest.corners[0][0] < quadTest.corners[1][0]);
  }

  // ─── Perspective Correction ───
  console.log('\n--- 6. Perspective Correction ---');
  const perspectiveTest = await page.evaluate(async () => {
    const { applyPerspectiveCorrection } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 300; c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 300, 300);
    ctx.fillStyle = '#000';
    ctx.fillRect(50, 50, 200, 200);
    const corners = [[50, 50], [250, 48], [252, 250], [48, 252]];
    const corrected = applyPerspectiveCorrection(c, corners, 200, 200);
    const cCtx = corrected.getContext('2d');
    const centerPixel = cCtx.getImageData(100, 100, 1, 1).data;
    return { w: corrected.width, h: corrected.height, centerR: centerPixel[0] };
  });
  ok('Perspective output dimensions correct', perspectiveTest.w === 200 && perspectiveTest.h === 200);
  ok('Perspective center pixel is dark (document)', perspectiveTest.centerR < 50, `R=${perspectiveTest.centerR}`);

  // ─── Bilinear Sampling ───
  console.log('\n--- 7. Bilinear Sampling ---');
  const bilinearTest = await page.evaluate(async () => {
    const { bilinearSample } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, 0, 2, 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 2, 2, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, 2, 2, 2);
    const imgData = ctx.getImageData(0, 0, 4, 4);
    const dark = bilinearSample(imgData, 4, 4, 0.5, 0.5);
    const bright = bilinearSample(imgData, 4, 4, 2.5, 0.5);
    return { dark, bright };
  });
  ok('Bilinear dark pixel near 0', bilinearTest.dark[0] < 30, `R=${bilinearTest.dark[0]}`);
  ok('Bilinear bright pixel near 255', bilinearTest.bright[0] > 220, `R=${bilinearTest.bright[0]}`);

  // ─── Perspective edge coverage (CE-018) ───
  console.log('\n--- 7b. Perspective Edge Coverage ---');
  const edgeCoverageTest = await page.evaluate(async () => {
    const { perspectiveCorrectBilinear } = await import('./core/image-processor.js');
    const src = document.createElement('canvas');
    src.width = 80; src.height = 80;
    const sctx = src.getContext('2d');
    sctx.fillStyle = '#ff0000'; sctx.fillRect(0, 0, 40, 40);
    sctx.fillStyle = '#00ff00'; sctx.fillRect(40, 0, 40, 40);
    sctx.fillStyle = '#0000ff'; sctx.fillRect(0, 40, 40, 40);
    sctx.fillStyle = '#ffff00'; sctx.fillRect(40, 40, 40, 40);
    const corners = [[0, 0], [80, 0], [80, 80], [0, 80]];
    const out = perspectiveCorrectBilinear(src, corners, 80, 80);
    const octx = out.getContext('2d');
    const data = octx.getImageData(0, 0, 80, 80).data;
    let transparent = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i + 3] === 0) transparent++; }
    const rgb = (x, y) => {
      const p = octx.getImageData(x, y, 1, 1).data;
      return { r: p[0], g: p[1], b: p[2], a: p[3] };
    };
    return {
      transparent,
      topLeft: rgb(0, 0),
      topRight: rgb(79, 0),
      bottomLeft: rgb(0, 79),
      bottomRight: rgb(79, 79),
    };
  });
  ok('Perspective edge output has no transparent pixels', edgeCoverageTest.transparent === 0, `${edgeCoverageTest.transparent} transparent`);
  ok('Perspective top-left edge maps to top-left source quadrant', edgeCoverageTest.topLeft.r > 200 && edgeCoverageTest.topLeft.g < 50);
  ok('Perspective top-right edge maps to top-right source quadrant', edgeCoverageTest.topRight.g > 200 && edgeCoverageTest.topRight.r < 50);
  ok('Perspective bottom-left edge maps to bottom-left source quadrant', edgeCoverageTest.bottomLeft.b > 200 && edgeCoverageTest.bottomLeft.r < 50);
  ok('Perspective bottom-right edge maps to bottom-right source quadrant', edgeCoverageTest.bottomRight.r > 200 && edgeCoverageTest.bottomRight.g > 200);

  // ─── Object URL Lifecycle ───
  console.log('\n--- 8. Object URL Lifecycle ---');
  const urlTest = await page.evaluate(async () => {
    const { createObjectUrl, revokeObjectUrl, getActiveObjectUrls, revokeAllObjectUrls } = await import('./core/image-processor.js');
    revokeAllObjectUrls();
    const before = getActiveObjectUrls();
    const blob = new Blob(['test'], { type: 'text/plain' });
    const url = createObjectUrl(blob);
    const during = getActiveObjectUrls();
    revokeObjectUrl(url);
    const after = getActiveObjectUrls();
    return { before, during, after };
  });
  ok('No active URLs before', urlTest.before === 0);
  ok('One active URL after create', urlTest.during === 1);
  ok('Zero active URLs after revoke', urlTest.after === 0);

  // ─── Corner Ordering ───
  console.log('\n--- 9. Corner Ordering ---');
  const orderTest = await page.evaluate(async () => {
    const { orderCorners } = await import('./core/image-processor.js');
    const unordered = [[200, 50], [50, 50], [50, 200], [200, 200]];
    const ordered = orderCorners(unordered);
    return { ordered };
  });
  ok('orderCorners returns 4 corners', orderTest.ordered.length === 4);
  ok('TL is top-left-ish', orderTest.ordered[0][0] < 120 && orderTest.ordered[0][1] < 120);
  ok('TR is top-right-ish', orderTest.ordered[1][0] > 120 && orderTest.ordered[1][1] < 120);
  ok('BR is bottom-right-ish', orderTest.ordered[2][0] > 120 && orderTest.ordered[2][1] > 120);
  ok('BL is bottom-left-ish', orderTest.ordered[3][0] < 120 && orderTest.ordered[3][1] > 120);

  // ─── Thumbnail Generation ───
  console.log('\n--- 10. Thumbnail Generation ---');
  const thumbTest = await page.evaluate(async () => {
    const { createThumbnail } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5167E8';
    ctx.fillRect(0, 0, 800, 600);
    const thumb = createThumbnail(c, 100);
    return { w: thumb.width, h: thumb.height };
  });
  ok('Thumbnail width <= 100', thumbTest.w <= 100, `Got ${thumbTest.w}`);
  ok('Thumbnail aspect ratio preserved', Math.abs(thumbTest.w / thumbTest.h - 800 / 600) < 0.1);

  // ─── processImageCapture (full pipeline) ───
  console.log('\n--- 11. Full Pipeline (processImageCapture) ---');
  const pipelineTest = await page.evaluate(async () => {
    const { processImageCapture } = await import('./core/image-processor.js');
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#fff';
    ctx.fillRect(50, 30, 300, 240);
    const dataUrl = c.toDataURL('image/png');
    try {
      const result = await processImageCapture(dataUrl);
      return { ok: true, width: result.width, height: result.height, hasCorners: !!result.corners, isFallback: result.isFallback };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ok('processImageCapture succeeds', pipelineTest.ok, pipelineTest.error || '');
  ok('Pipeline returns image dimensions', pipelineTest.width > 0 && pipelineTest.height > 0);
  ok('Pipeline returns corners', pipelineTest.hasCorners);

  // ─── Scanner UI Rendering ───
  console.log('\n--- 12. Scanner UI Rendering ---');
  const scannerTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#000';
    ctx.fillRect(50, 50, 100, 100);
    const dataUrl = c.toDataURL('image/png');
    const project = { id: 'test', name: 'Test' };
    const scanner = createScannerUI(dataUrl, project, {
      onConfirm: () => {},
      onCancel: () => {},
    });
    const hasRoot = !!scanner.root;
    const hasCornerEls = scanner.root.querySelectorAll('.ws-scanner-corner').length === 4;
    const hasToolbar = !!scanner.root.querySelector('.ws-scanner-toolbar');
    const hasFooter = !!scanner.root.querySelector('.ws-scanner-footer');
    const hasOriginalCanvas = !!scanner.root.querySelector('.ws-scanner-original');
    return { hasRoot, hasCornerEls, hasToolbar, hasFooter, hasOriginalCanvas };
  });
  ok('Scanner UI creates root element', scannerTest.hasRoot);
  ok('Scanner UI has 4 corner handles', scannerTest.hasCornerEls);
  ok('Scanner UI has toolbar', scannerTest.hasToolbar);
  ok('Scanner UI has footer', scannerTest.hasFooter);
  ok('Scanner UI has original canvas', scannerTest.hasOriginalCanvas);

  // ─── Scanner preview/confirm serialization ───
  console.log('\n--- 13. Scanner Preview Serialization ---');
  const previewSerializationTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 200; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 200, 160);
    ctx.fillStyle = '#fff'; ctx.fillRect(20, 20, 160, 120);
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      onConfirm: () => {}, onCancel: () => {},
    });
    const confirmButton = scanner.root.querySelector('[data-action="confirm"]');
    const disabledDuringInitialization = confirmButton.disabled;
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForPreview = () => {
        const state = scanner.getState();
        if (!state.processing && state.renderedPreviewRevision === state.previewRevision && state.correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('La previsualización no terminó'));
        requestAnimationFrame(waitForPreview);
      };
      waitForPreview();
    });
    const state = scanner.getState();
    const result = {
      disabledDuringInitialization,
      enabledAfterLatestPreview: !confirmButton.disabled,
      previewIsCurrent: state.renderedPreviewRevision === state.previewRevision,
    };
    scanner.destroy();
    return result;
  });
  if (previewSerializationTest.disabledDuringInitialization) ok('Scanner confirm is disabled until preview is ready');
  else ko('Scanner confirm is disabled until preview is ready');
  if (previewSerializationTest.enabledAfterLatestPreview) ok('Scanner confirm enables after latest preview');
  else ko('Scanner confirm enables after latest preview');
  if (previewSerializationTest.previewIsCurrent) ok('Scanner preview revision is current before confirm');
  else ko('Scanner preview revision is current before confirm');

  // ─── Scanner corner intent serialization ───
  console.log('\n--- 14. Scanner Corner Intent Serialization ---');
  const cornerIntentTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const makeResult = (corners) => ({
      originalCanvas: c,
      originalImageData: imageData,
      corners,
      isFallback: false,
      width: c.width,
      height: c.height,
    });
    const initial = [[10, 10], [150, 10], [150, 110], [10, 110]];
    const autoCorners = [[20, 20], [140, 20], [140, 100], [20, 100]];
    const resetCorners = [[30, 30], [130, 30], [130, 90], [30, 90]];
    const pending = [];
    let calls = 0;
    const processCapture = () => {
      calls++;
      if (calls === 1) return Promise.resolve(makeResult(initial));
      return new Promise(resolve => pending.push(resolve));
    };
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      onConfirm: () => {}, onCancel: () => {}, processCapture,
    });
    document.body.appendChild(scanner.root);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForReady = () => {
        if (scanner.getState().correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('El escáner no se inicializó'));
        requestAnimationFrame(waitForReady);
      };
      waitForReady();
    });
    scanner.root.querySelector('[data-action="auto-detect"]').click();
    scanner.root.querySelector('[data-action="reset-corners"]').click();
    pending[0](makeResult(autoCorners));
    await new Promise(resolve => setTimeout(resolve, 0));
    const staleResultIgnored = JSON.stringify(scanner.getState().corners) === JSON.stringify(initial);
    pending[1](makeResult(resetCorners));
    await new Promise(resolve => setTimeout(resolve, 0));
    const latestResultApplied = JSON.stringify(scanner.getState().corners) === JSON.stringify(resetCorners);
    scanner.destroy();
    return { staleResultIgnored, latestResultApplied, calls };
  });
  if (cornerIntentTest.staleResultIgnored) ok('Scanner ignores stale corner detection result');
  else ko('Scanner ignores stale corner detection result');
  if (cornerIntentTest.latestResultApplied) ok('Scanner applies only the latest corner intent');
  else ko('Scanner applies only the latest corner intent');
  if (cornerIntentTest.calls === 3) ok('Scanner runs one detection per explicit corner intent');
  else ko('Scanner runs one detection per explicit corner intent', `Got ${cornerIntentTest.calls}`);

  // ─── Scanner detection/confirmation serialization ───
  console.log('\n--- 15. Scanner Detection/Confirmation Serialization ---');
  const detectionConfirmationTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const makeResult = (corners) => ({
      originalCanvas: c, originalImageData: imageData, corners,
      isFallback: false, width: c.width, height: c.height,
    });
    const initial = [[10, 10], [150, 10], [150, 110], [10, 110]];
    const detected = [[20, 20], [140, 20], [140, 100], [20, 100]];
    let resolveDetection;
    let calls = 0;
    let confirmedCorners = null;
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => {
        calls++;
        return calls === 1 ? Promise.resolve(makeResult(initial)) : new Promise(resolve => { resolveDetection = resolve; });
      },
      onConfirm: (payload) => { confirmedCorners = payload.corners; }, onCancel: () => {},
    });
    document.body.appendChild(scanner.root);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForReady = () => {
        if (scanner.getState().correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('El escáner no se inicializó'));
        requestAnimationFrame(waitForReady);
      };
      waitForReady();
    });
    const confirmButton = scanner.root.querySelector('[data-action="confirm"]');
    scanner.root.querySelector('[data-action="auto-detect"]').click();
    const blockedDuringDetection = scanner.getState().processing && confirmButton.disabled;
    scanner.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    const confirmationWaitsForDetection = confirmedCorners === null;
    resolveDetection(makeResult(detected));
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForDetection = () => {
        if (!scanner.getState().processing && scanner.getState().renderedPreviewRevision === scanner.getState().previewRevision) return resolve();
        if (performance.now() > deadline) return reject(new Error('La detección no terminó'));
        requestAnimationFrame(waitForDetection);
      };
      waitForDetection();
    });
    const enabledAfterLatestDetection = !confirmButton.disabled;
    await new Promise(resolve => setTimeout(resolve, 0));
    const confirmedLatestCorners = JSON.stringify(confirmedCorners) === JSON.stringify(detected);
    scanner.destroy();
    return { blockedDuringDetection, confirmationWaitsForDetection, enabledAfterLatestDetection, confirmedLatestCorners };
  });
  if (detectionConfirmationTest.blockedDuringDetection) ok('Scanner blocks confirmation while corner detection is pending');
  else ko('Scanner blocks confirmation while corner detection is pending');
  if (detectionConfirmationTest.confirmationWaitsForDetection) ok('Scanner defers keyboard confirmation until corner detection completes');
  else ko('Scanner defers keyboard confirmation until corner detection completes');
  if (detectionConfirmationTest.enabledAfterLatestDetection && detectionConfirmationTest.confirmedLatestCorners) ok('Scanner confirms only the latest detected preview');
  else ko('Scanner confirms only the latest detected preview', JSON.stringify(detectionConfirmationTest));

  // ─── Scanner keyboard corner controls ───
  console.log('\n--- 16. Scanner Keyboard Corner Controls ---');
  const keyboardCornerTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const result = {
      originalCanvas: c, originalImageData: imageData,
      corners: [[10, 10], [150, 10], [150, 110], [10, 110]],
      isFallback: false, width: c.width, height: c.height,
    };
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.resolve(result), onConfirm: () => {}, onCancel: () => {},
    });
    document.body.appendChild(scanner.root);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForReady = () => {
        if (scanner.getState().correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('El escáner no se inicializó'));
        requestAnimationFrame(waitForReady);
      };
      waitForReady();
    });
    const corner = scanner.root.querySelector('[data-corner="0"]');
    corner.focus();
    corner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    corner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    corner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    const [x, y] = scanner.getState().corners[0];
    const semanticState = {
      focused: document.activeElement === corner,
      role: corner.getAttribute('role'),
      valueNow: corner.getAttribute('aria-valuenow'),
      valueText: corner.getAttribute('aria-valuetext'),
      min: corner.getAttribute('aria-valuemin'),
      max: corner.getAttribute('aria-valuemax'),
    };
    scanner.destroy();
    return { x, y, semanticState };
  });
  if (keyboardCornerTest.x === 0 && keyboardCornerTest.y === 15) ok('Scanner moves and clamps corners with keyboard');
  else ko('Scanner moves and clamps corners with keyboard', JSON.stringify(keyboardCornerTest));
  if (keyboardCornerTest.semanticState.focused && keyboardCornerTest.semanticState.role === 'slider' &&
      keyboardCornerTest.semanticState.valueNow === '0' && keyboardCornerTest.semanticState.valueText === 'X: 0 píxeles; Y: 15 píxeles' &&
      keyboardCornerTest.semanticState.min === '0' && keyboardCornerTest.semanticState.max === '160') {
    ok('Scanner announces keyboard corner coordinates');
  } else ko('Scanner announces keyboard corner coordinates', JSON.stringify(keyboardCornerTest.semanticState));

  // ─── Scanner quadrilateral geometry guard ───
  console.log('\n--- 17. Scanner Quadrilateral Geometry Guard ---');
  const quadrilateralValidationTest = await page.evaluate(async () => {
    const { isValidQuadrilateral } = await import('./core/scanner-ui.js');
    return {
      acceptsDocument: isValidQuadrilateral([[10, 10], [150, 10], [150, 110], [10, 110]], 160, 120),
      rejectsCrossed: !isValidQuadrilateral([[150, 10], [10, 10], [150, 110], [10, 110]], 160, 120),
      rejectsDegenerate: !isValidQuadrilateral([[10, 10], [150, 10], [150, 10], [10, 10]], 160, 120),
    };
  });
  if (quadrilateralValidationTest.acceptsDocument) ok('Scanner accepts a convex document quadrilateral');
  else ko('Scanner accepts a convex document quadrilateral', JSON.stringify(quadrilateralValidationTest));
  if (quadrilateralValidationTest.rejectsCrossed && quadrilateralValidationTest.rejectsDegenerate) ok('Scanner rejects crossed and degenerate quadrilaterals');
  else ko('Scanner rejects crossed and degenerate quadrilaterals', JSON.stringify(quadrilateralValidationTest));
  const quadrilateralGuardTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const initialCorners = [[10, 10], [150, 10], [150, 110], [10, 110]];
    const result = {
      originalCanvas: c, originalImageData: imageData, corners: initialCorners,
      isFallback: false, width: c.width, height: c.height,
    };
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.resolve(result), onConfirm: () => {}, onCancel: () => {},
    });
    document.body.appendChild(scanner.root);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForReady = () => {
        if (scanner.getState().correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('El escáner no se inicializó'));
        requestAnimationFrame(waitForReady);
      };
      waitForReady();
    });
    const corner = scanner.root.querySelector('[data-corner="0"]');
    corner.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const cornersPreserved = JSON.stringify(scanner.getState().corners) === JSON.stringify(initialCorners);
    const status = scanner.root.querySelector('.ws-scanner-status');
    const rejectedWithFeedback = status.classList.contains('error') &&
      status.textContent === 'El ajuste debe mantener un documento con cuatro esquinas válidas.';
    const confirmRemainsUsable = !scanner.root.querySelector('[data-action="confirm"]').disabled;
    scanner.destroy();
    return { cornersPreserved, rejectedWithFeedback, confirmRemainsUsable };
  });
  if (quadrilateralGuardTest.cornersPreserved) ok('Scanner rejects a corner movement that crosses the quadrilateral');
  else ko('Scanner rejects a corner movement that crosses the quadrilateral', JSON.stringify(quadrilateralGuardTest));
  if (quadrilateralGuardTest.rejectedWithFeedback && quadrilateralGuardTest.confirmRemainsUsable) ok('Scanner preserves the valid preview and explains invalid geometry');
  else ko('Scanner preserves the valid preview and explains invalid geometry', JSON.stringify(quadrilateralGuardTest));

  // ─── Scanner confirmation/cancel serialization ───
  console.log('\n--- 18. Scanner Confirmation/Cancel Serialization ---');
  const confirmationCancelTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const result = {
      originalCanvas: c, originalImageData: imageData,
      corners: [[10, 10], [150, 10], [150, 110], [10, 110]],
      isFallback: false, width: c.width, height: c.height,
    };
    let resolveSave;
    let confirms = 0;
    let cancels = 0;
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.resolve(result),
      onConfirm: () => {
        confirms++;
        return new Promise(resolve => { resolveSave = resolve; });
      },
      onCancel: () => { cancels++; },
    });
    document.body.appendChild(scanner.root);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForReady = () => {
        if (scanner.getState().correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('El escáner no se inicializó'));
        requestAnimationFrame(waitForReady);
      };
      waitForReady();
    });
    scanner.root.querySelector('[data-action="confirm"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const cancelButton = scanner.root.querySelector('[data-action="cancel"]');
    const lockedDuringSave = scanner.getState().confirming && cancelButton.disabled && scanner.root.querySelector('.ws-scanner-status').textContent === 'Guardando escaneo...';
    cancelButton.click();
    scanner.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const cancelIgnoredDuringSave = cancels === 0 && confirms === 1;
    resolveSave();
    await new Promise(resolve => setTimeout(resolve, 0));
    const unlockedAfterSave = !scanner.getState().confirming && !cancelButton.disabled;
    scanner.destroy();
    return { lockedDuringSave, cancelIgnoredDuringSave, unlockedAfterSave };
  });
  if (confirmationCancelTest.lockedDuringSave) ok('Scanner locks cancellation while saving confirmation');
  else ko('Scanner locks cancellation while saving confirmation');
  if (confirmationCancelTest.cancelIgnoredDuringSave) ok('Scanner ignores cancel intent while confirmation is saving');
  else ko('Scanner ignores cancel intent while confirmation is saving');
  if (confirmationCancelTest.unlockedAfterSave) ok('Scanner restores cancellation after confirmation saves');
  else ko('Scanner restores cancellation after confirmation saves');

  // ─── Scanner save failure recovery ───
  console.log('\n--- 19. Scanner Save Failure Recovery ---');
  const saveFailureRecoveryTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const result = {
      originalCanvas: c, originalImageData: imageData,
      corners: [[10, 10], [150, 10], [150, 110], [10, 110]],
      isFallback: false, width: c.width, height: c.height,
    };
    let attempts = 0;
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.resolve(result),
      onConfirm: () => {
        attempts++;
        return attempts === 1
          ? { ok: false, message: 'No se pudo guardar el escaneo. Inténtalo de nuevo.' }
          : { ok: true };
      },
      onCancel: () => {},
    });
    document.body.appendChild(scanner.root);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const waitForReady = () => {
        if (scanner.getState().correctedCanvas) return resolve();
        if (performance.now() > deadline) return reject(new Error('El escáner no se inicializó'));
        requestAnimationFrame(waitForReady);
      };
      waitForReady();
    });
    const confirmButton = scanner.root.querySelector('[data-action="confirm"]');
    confirmButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const status = scanner.root.querySelector('.ws-scanner-status');
    const recoveredFromFailure = !scanner.getState().confirming && !confirmButton.disabled &&
      status.classList.contains('error') && status.textContent === 'No se pudo guardar el escaneo. Inténtalo de nuevo.';
    confirmButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const retryAllowed = attempts === 2 && !scanner.getState().confirming && !confirmButton.disabled;
    scanner.destroy();
    return { recoveredFromFailure, retryAllowed };
  });
  if (saveFailureRecoveryTest.recoveredFromFailure) ok('Scanner exposes a retryable error after save failure');
  else ko('Scanner exposes a retryable error after save failure', JSON.stringify(saveFailureRecoveryTest));
  if (saveFailureRecoveryTest.retryAllowed) ok('Scanner allows retry after save failure');
  else ko('Scanner allows retry after save failure', JSON.stringify(saveFailureRecoveryTest));

  // ─── Scanner inactive lifecycle ───
  console.log('\n--- 20. Scanner Inactive Lifecycle ---');
  const inactiveLifecycleTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const result = {
      originalCanvas: c, originalImageData: imageData,
      corners: [[10, 10], [150, 10], [150, 110], [10, 110]],
      isFallback: false, width: c.width, height: c.height,
    };
    let resolveCapture;
    const pendingCapture = new Promise(resolve => { resolveCapture = resolve; });
    const scanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => pendingCapture, onConfirm: () => {}, onCancel: () => {},
    });
    document.body.appendChild(scanner.root);
    scanner.destroy();
    resolveCapture(result);
    await new Promise(resolve => setTimeout(resolve, 0));
    const lateInitIgnored = !scanner.getState().active && !scanner.getState().originalCanvas && scanner.root.childElementCount === 0;

    let added = 0;
    let removed = 0;
    const addEventListener = window.addEventListener;
    const removeEventListener = window.removeEventListener;
    window.addEventListener = function(type, listener, options) {
      if (type === 'resize') added++;
      return addEventListener.call(this, type, listener, options);
    };
    window.removeEventListener = function(type, listener, options) {
      if (type === 'resize') removed++;
      return removeEventListener.call(this, type, listener, options);
    };
    const readyScanner = createScannerUI(c.toDataURL('image/png'), { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.resolve(result), onConfirm: () => {}, onCancel: () => {},
    });
    document.body.appendChild(readyScanner.root);
    await new Promise(resolve => setTimeout(resolve, 0));
    readyScanner.destroy();
    window.addEventListener = addEventListener;
    window.removeEventListener = removeEventListener;
    return { lateInitIgnored, resizeListenerRemoved: added === 1 && removed === 1 };
  });
  if (inactiveLifecycleTest.lateInitIgnored) ok('Scanner ignores initialization that completes after destruction');
  else ko('Scanner ignores initialization that completes after destruction');
  if (inactiveLifecycleTest.resizeListenerRemoved) ok('Scanner removes its resize listener on destruction');
  else ko('Scanner removes its resize listener on destruction');

  // ─── Scanner initial loading failure recovery ───
  console.log('\n--- 21. Scanner Initial Loading Failure Recovery ---');
  const initialFailureRecoveryTest = await page.evaluate(async () => {
    const { createScannerUI } = await import('./core/scanner-ui.js');
    let clickCancels = 0;
    const clickScanner = createScannerUI('data:image/png;base64,AA==', { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.reject(new Error('Imagen no válida')),
      onCancel: () => { clickCancels++; },
    });
    document.body.appendChild(clickScanner.root);
    await new Promise(resolve => setTimeout(resolve, 0));
    const clickStatus = clickScanner.root.querySelector('.ws-scanner-status');
    const errorIsActionable = clickStatus.classList.contains('error') && clickStatus.textContent === 'Error: Imagen no válida';
    clickScanner.root.querySelector('[data-action="cancel"]').click();

    let escapeCancels = 0;
    const escapeScanner = createScannerUI('data:image/png;base64,AA==', { id: 'test', name: 'Test' }, {
      processCapture: () => Promise.reject(new Error('Canvas no disponible')),
      onCancel: () => { escapeCancels++; },
    });
    document.body.appendChild(escapeScanner.root);
    await new Promise(resolve => setTimeout(resolve, 0));
    escapeScanner.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    clickScanner.destroy();
    escapeScanner.destroy();
    return { errorIsActionable, clickCancels, escapeCancels };
  });
  if (initialFailureRecoveryTest.errorIsActionable) ok('Scanner explains an initial loading failure');
  else ko('Scanner explains an initial loading failure', JSON.stringify(initialFailureRecoveryTest));
  if (initialFailureRecoveryTest.clickCancels === 1 && initialFailureRecoveryTest.escapeCancels === 1) ok('Scanner keeps Cancel and Escape operable after initial loading failure');
  else ko('Scanner keeps Cancel and Escape operable after initial loading failure', JSON.stringify(initialFailureRecoveryTest));

  // ─── processImageCapture with invalid data ───
  console.log('\n--- 22. Error Handling ---');
  const errorTest = await page.evaluate(async () => {
    const { processImageCapture } = await import('./core/image-processor.js');
    try {
      await processImageCapture('not-a-valid-dataurl');
      return { caught: false };
    } catch (e) {
      return { caught: true, message: e.message };
    }
  });
  ok('processImageCapture throws on invalid input', errorTest.caught, errorTest.message || '');

  // ─── Scanner image reference and atomic persistence ───
  console.log('\n--- 23. Scanner Image Reference & Atomic Persistence ---');
  const atomicPersistenceTest = await page.evaluate(async () => {
    const { persistScannerResult, createImageAsset, createScanDocument, createToolExecution, addRelation } = await import('./core/storage.js');
    const { resolveCaptureImageDataUrl } = await import('./core/capture-image.js');
    const { dbGet, dbTransaction, STORES, generateId } = await import('./core/db.js');
    const projectId = 'atomic-scanner-' + generateId();
    const source = createImageAsset('Original', projectId, null);
    const scanDoc = createScanDocument('Escaneo', projectId);
    const corrected = createImageAsset('Corregida', projectId, null);
    corrected.dataUrl = 'data:image/png;base64,AA==';
    const capture = { id: generateId(), type: 'scan', sourceAssetId: source.id, scanDocumentId: scanDoc.id, correctedAssetId: corrected.id };
    const execution = createToolExecution('perspective-correction', 'Corrección de perspectiva', projectId);
    execution.resultAssetId = scanDoc.id;
    addRelation(source, scanDoc.id, 'derived-scan');
    addRelation(scanDoc, source.id, 'source');
    const result = await persistScannerResult(projectId, { sourceAsset: source, scanDoc, correctedAsset: corrected, capture, execution });
    const committed = await Promise.all([dbGet(STORES.assets, source.id), dbGet(STORES.assets, scanDoc.id), dbGet(STORES.assets, corrected.id), dbGet(STORES.captures, capture.id), dbGet(STORES.executions, execution.id)]);
    const rollbackId = generateId();
    try {
      await dbTransaction(STORES.assets, 'readwrite', stores => {
        stores[STORES.assets].put({ id: rollbackId, projectId, type: 'image-asset' });
        throw new Error('fallo controlado');
      });
    } catch (_) { /* Contrato esperado: la transacción aborta. */ }
    return {
      committed: committed.every(Boolean)
        && result.capture.id === capture.id
        && !Object.hasOwn(committed[3], 'dataUrl')
        && committed[3].correctedAssetId === corrected.id
        && committed[2].dataUrl === corrected.dataUrl
        && !committed[2].originalDataUrl
        && committed[4].resultAssetId === scanDoc.id,
      resolvedReference: await resolveCaptureImageDataUrl(committed[3], id => Promise.resolve(id === corrected.id ? committed[2] : null)) === corrected.dataUrl,
      resolvedLegacy: await resolveCaptureImageDataUrl({ dataUrl: 'data:image/png;base64,LEGACY' }, () => Promise.resolve(null)) === 'data:image/png;base64,LEGACY',
      rollback: !await dbGet(STORES.assets, rollbackId),
    };
  });
  ok('Scanner persists assets, ScanDocument, capture and execution together', atomicPersistenceTest.committed);
  ok('Scanner capture resolves its corrected asset without duplicating its PNG', atomicPersistenceTest.resolvedReference);
  ok('Scanner capture keeps legacy data URLs readable', atomicPersistenceTest.resolvedLegacy);
  ok('Scanner persistence transaction rolls back on controlled failure', atomicPersistenceTest.rollback);

  // ─── CSS Scanner Classes ───
  console.log('\n--- 24. CSS Scanner Classes ---');
  const cssContent = await page.evaluate(async () => {
    const resp = await fetch('./workspace.css');
    return await resp.text();
  });
  ok('CSS has .ws-scanner-root', cssContent.includes('.ws-scanner-root'));
  ok('CSS has .ws-scanner-corner', cssContent.includes('.ws-scanner-corner'));
  ok('CSS has .ws-scanner-toolbar', cssContent.includes('.ws-scanner-toolbar'));
  ok('CSS has .ws-scanner-footer', cssContent.includes('.ws-scanner-footer'));
  ok('CSS has .ws-scanner-compare-container', cssContent.includes('.ws-scanner-compare-container'));
  ok('CSS has .ws-scanner-corrected', cssContent.includes('.ws-scanner-corrected'));
  ok('CSS has visible scanner corner focus', cssContent.includes('.ws-scanner-corner:focus-visible'));

  // ─── workspace.js Scanner Integration ───
  console.log('\n--- 25. Scanner Integration in workspace.js ---');
  const jsContent = await page.evaluate(async () => {
    const resp = await fetch('./workspace.js');
    return await resp.text();
  });
  ok('workspace.js imports scanner-ui.js', jsContent.includes("import { createScannerUI }"));
  ok('workspace.js has launchScanner function', jsContent.includes('function launchScanner'));
  ok('workspace.js has renderScannerView function', jsContent.includes('function renderScannerView'));
  ok('workspace.js handles scanner view in switch', jsContent.includes("case 'scanner'"));
  ok('workspace.js routes capture to scanner', jsContent.includes('launchScanner('));
  ok('workspace.js persists a scanner result atomically', jsContent.includes('persistScannerResult(project.id'));

  // ─── Errors ───
  console.log('\n--- 26. Errors ---');
  ok('No JS errors during tests', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0,3).join('; ') : '');

  // Screenshots
  await page.screenshot({ path: join(SCREENSHOTS, '08-scanner-module-test.png') });

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  await browser.close();
} finally {
  srv.close();
}
process.exit(fail > 0 ? 1 : 0);
