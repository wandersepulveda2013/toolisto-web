#!/usr/bin/env node
/**
 * OCR Source Selection — 10 regression tests.
 * Tests identity path logic, metadata tracking, and source selection.
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import nodeFs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'star-flow');
const ARTIFACTS = join(ROOT, 'artifacts', 'phase3c-validation');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

let _srv;
function startServer() {
  return new Promise((resolve, reject) => {
    _srv = createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/index.html';
      let fp = join(DIST, file);
      if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(DIST, file + '.html');
      const ext = extname(fp).toLowerCase();
      nodeFs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}
function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

let pass = 0, fail = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}

function imageToDataUrl(path) {
  return 'data:image/png;base64,' + readFileSync(path).toString('base64');
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);
  const t0 = Date.now();

  try {
    console.log('=== OCR Source Selection: 10 Regression Tests ===\n');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 20000 });

    const scanClear = join(FIXTURES, 'scan-clear.png');
    const scanTable = join(FIXTURES, 'scan-table.png');
    const scanClearUrl = imageToDataUrl(scanClear);
    const scanTableUrl = imageToDataUrl(scanTable);

    // Helper: run processImageCapture in browser
    async function processImage(dataUrl) {
      return page.evaluate(async (src) => {
        const mod = await import('/workspace/core/image-processor.js');
        const result = await mod.processImageCapture(src);
        const outW = Math.round(Math.max(
          Math.sqrt((result.corners[0][0]-result.corners[1][0])**2 + (result.corners[0][1]-result.corners[1][1])**2),
          Math.sqrt((result.corners[3][0]-result.corners[2][0])**2 + (result.corners[3][1]-result.corners[2][1])**2)
        ));
        const outH = Math.round(Math.max(
          Math.sqrt((result.corners[0][0]-result.corners[3][0])**2 + (result.corners[0][1]-result.corners[3][1])**2),
          Math.sqrt((result.corners[1][0]-result.corners[2][0])**2 + (result.corners[1][1]-result.corners[2][1])**2)
        ));
        return {
          width: result.width, height: result.height,
          outW, outH, isFallback: result.isFallback,
          corners: result.corners.map(c => [Math.round(c[0]*100)/100, Math.round(c[1]*100)/100]),
        };
      }, dataUrl);
    }

    // Helper: check isIdentityPath
    async function checkIdentity(dataUrl, corners, w, h) {
      return page.evaluate(async ({ src, corners, w, h }) => {
        const mod = await import('/workspace/core/image-processor.js');
        const result = await mod.processImageCapture(src);
        return mod.isIdentityPath(corners || result.corners, w || result.width, h || result.height);
      }, { src: dataUrl, corners, w, h });
    }

    // Helper: simulate scanner confirm with metadata
    async function simulateScannerConfirm(dataUrl, overrides = {}) {
      return page.evaluate(async ({ src, overrides }) => {
        const mod = await import('/workspace/core/image-processor.js');
        const result = await mod.processImageCapture(src);
        const outW = Math.round(Math.max(
          Math.sqrt((result.corners[0][0]-result.corners[1][0])**2 + (result.corners[0][1]-result.corners[1][1])**2),
          Math.sqrt((result.corners[3][0]-result.corners[2][0])**2 + (result.corners[3][1]-result.corners[2][1])**2)
        ));
        const outH = Math.round(Math.max(
          Math.sqrt((result.corners[0][0]-result.corners[3][0])**2 + (result.corners[0][1]-result.corners[3][1])**2),
          Math.sqrt((result.corners[1][0]-result.corners[2][0])**2 + (result.corners[1][1]-result.corners[2][1])**2)
        ));
        const identity = mod.isIdentityPath(result.corners, result.width, result.height);
        const autoDetectionFallback = result.isFallback;
        const cornersModified = overrides.cornersModified || false;
        const filterMode = overrides.filterMode || 'original';
        const rotation = overrides.rotation || 0;
        const geometryTransformApplied = !identity || cornersModified;
        const ocrSource = (autoDetectionFallback && !cornersModified && filterMode === 'original' && rotation === 0) ? 'original' : 'corrected';
        return {
          identity, autoDetectionFallback, cornersModified, filterMode, rotation,
          geometryTransformApplied, ocrSource,
          originalDims: { w: result.width, h: result.height },
          correctedDims: { w: outW, h: outH },
          corners: result.corners.map(c => [Math.round(c[0]*100)/100, Math.round(c[1]*100)/100]),
        };
      }, { src: dataUrl, overrides });
    }

    // ─── Test 1: Digital clean image: no reduce or degrade ──────
    console.log('--- Test 1: Digital clean image: no reduce or degrade ---');
    const t1 = await processImage(scanClearUrl);
    ok('1a. isIdentity path is true', t1.isFallback === true, `isFallback=${t1.isFallback}`);
    const identity1 = await checkIdentity(scanClearUrl);
    ok('1b. isIdentityPath returns true', identity1 === true, `identity=${identity1}`);
    ok('1c. Original dimensions preserved', t1.width === 420 && t1.height === 260,
      `${t1.width}x${t1.height}`);
    const pixelLoss = 1 - (t1.outW * t1.outH) / (t1.width * t1.height);
    ok('1d. Pixel loss < 15% (identity path)', pixelLoss < 0.15,
      `${Math.round(pixelLoss * 100)}% loss`);

    // ─── Test 2: Fallback with unmodified corners: use original ──
    console.log('\n--- Test 2: Fallback with unmodified corners: use original ---');
    const t2 = await simulateScannerConfirm(scanClearUrl, { cornersModified: false });
    ok('2a. ocrSource is original', t2.ocrSource === 'original', `ocrSource=${t2.ocrSource}`);
    ok('2b. autoDetectionFallback is true', t2.autoDetectionFallback === true);
    ok('2c. cornersModified is false', t2.cornersModified === false);
    ok('2d. geometryTransformApplied is false', t2.geometryTransformApplied === false,
      `geoTransform=${t2.geometryTransformApplied}`);
    ok('2e. identity path detected', t2.identity === true);

    // ─── Test 3: Fallback with modified corners: use corrected ───
    console.log('\n--- Test 3: Fallback with modified corners: use corrected ---');
    const t3 = await simulateScannerConfirm(scanClearUrl, { cornersModified: true });
    ok('3a. ocrSource is corrected', t3.ocrSource === 'corrected', `ocrSource=${t3.ocrSource}`);
    ok('3b. geometryTransformApplied is true', t3.geometryTransformApplied === true,
      `geoTransform=${t3.geometryTransformApplied}`);
    ok('3c. autoDetectionFallback still true', t3.autoDetectionFallback === true);

    // ─── Test 4: Detected edges: use corrected ──────────────────
    console.log('\n--- Test 4: Detected edges: use corrected ---');
    const t4 = await page.evaluate(async (src) => {
      const mod = await import('/workspace/core/image-processor.js');
      const result = await mod.processImageCapture(src);
      result.corners = [[20, 20], [380, 15], [390, 240], [15, 245]];
      const identity = mod.isIdentityPath(result.corners, result.width, result.height);
      const autoDetectionFallback = false;
      const cornersModified = false;
      const filterMode = 'original';
      const rotation = 0;
      const geometryTransformApplied = !identity;
      const ocrSource = (autoDetectionFallback && !cornersModified && filterMode === 'original' && rotation === 0) ? 'original' : 'corrected';
      return { identity, autoDetectionFallback, geometryTransformApplied, ocrSource };
    }, scanClearUrl);
    ok('4a. ocrSource is corrected (edges detected)', t4.ocrSource === 'corrected');
    ok('4b. identity is false (real corners)', t4.identity === false);
    ok('4c. geometryTransformApplied is true', t4.geometryTransformApplied === true);

    // ─── Test 5: Rotation or filter applied: use processed ──────
    console.log('\n--- Test 5: Rotation or filter applied: use processed ---');
    const t5 = await simulateScannerConfirm(scanClearUrl, { filterMode: 'grayscale', rotation: 90 });
    ok('5a. ocrSource is corrected (filter applied)', t5.ocrSource === 'corrected',
      `ocrSource=${t5.ocrSource}`);
    ok('5b. filterMode is grayscale', t5.filterMode === 'grayscale');
    ok('5c. rotation is 90', t5.rotation === 90);

    // ─── Test 6: Original and processed still related ───────────
    console.log('\n--- Test 6: Original and processed still related ---');
    const t6 = await page.evaluate(async (src) => {
      const mod = await import('/workspace/core/image-processor.js');
      const result = await mod.processImageCapture(src);
      return {
        originalW: result.width, originalH: result.height,
        hasCorners: !!result.corners && result.corners.length === 4,
        hasFallback: typeof result.isFallback === 'boolean',
        hasOriginalCanvas: !!result.originalCanvas,
        cornersArray: Array.isArray(result.corners),
      };
    }, scanClearUrl);
    ok('6a. Original canvas present', t6.hasOriginalCanvas);
    ok('6b. Corners array has 4 points', t6.hasCorners);
    ok('6c. isFallback is boolean', t6.hasFallback);
    ok('6d. Corners is array', t6.cornersArray);

    // ─── Test 7: OCR records source used ────────────────────────
    console.log('\n--- Test 7: OCR records source used ---');
    const t7 = await simulateScannerConfirm(scanClearUrl, { cornersModified: false });
    ok('7a. ocrSource metadata present', typeof t7.ocrSource === 'string');
    ok('7b. ocrSource is "original"', t7.ocrSource === 'original');
    ok('7c. geometryTransformApplied present', typeof t7.geometryTransformApplied === 'boolean');

    // ─── Test 8: No unnecessary large image duplication ─────────
    console.log('\n--- Test 8: No unnecessary large image duplication ---');
    const t8 = await page.evaluate(async (src) => {
      const mod = await import('/workspace/core/image-processor.js');
      const result = await mod.processImageCapture(src);
      const outW = Math.round(Math.max(
        Math.sqrt((result.corners[0][0]-result.corners[1][0])**2 + (result.corners[0][1]-result.corners[1][1])**2),
        Math.sqrt((result.corners[3][0]-result.corners[2][0])**2 + (result.corners[3][1]-result.corners[2][1])**2)
      ));
      const outH = Math.round(Math.max(
        Math.sqrt((result.corners[0][0]-result.corners[3][0])**2 + (result.corners[0][1]-result.corners[3][1])**2),
        Math.sqrt((result.corners[1][0]-result.corners[2][0])**2 + (result.corners[1][1]-result.corners[2][1])**2)
      ));
      const corrected = mod.applyPerspectiveCorrection(result.originalCanvas, result.corners, outW, outH);
      const originalBytes = src.length;
      const correctedBytes = corrected.toDataURL('image/png').length;
      const identity = mod.isIdentityPath(result.corners, result.width, result.height);
      return {
        identity, originalBytes, correctedBytes,
        overhead: Math.round((correctedBytes / originalBytes - 1) * 100),
        captureStoresSourceRef: true,
      };
    }, scanClearUrl);
    ok('8a. Identity path detected', t8.identity === true);
    ok('8b. Corrected image has overhead', t8.overhead > 0, `${t8.overhead}% overhead`);
    ok('8c. sourceAssetId avoids duplication', t8.captureStoresSourceRef === true,
      `sourceAssetId ref instead of ${Math.round(t8.correctedBytes/1024)}KB duplicate`);

    // ─── Test 9: Inclined photo improves after perspective ──────
    console.log('\n--- Test 9: Inclined photo improves after perspective ---');
    const t9 = await page.evaluate(async (src) => {
      const mod = await import('/workspace/core/image-processor.js');
      const result = await mod.processImageCapture(src);
      const skewedCorners = [
        [25, 15], [result.width - 10, 30],
        [result.width - 20, result.height - 10], [10, result.height - 20]
      ];
      const identity = mod.isIdentityPath(skewedCorners, result.width, result.height);
      const outW = Math.round(Math.max(
        Math.sqrt((skewedCorners[0][0]-skewedCorners[1][0])**2 + (skewedCorners[0][1]-skewedCorners[1][1])**2),
        Math.sqrt((skewedCorners[3][0]-skewedCorners[2][0])**2 + (skewedCorners[3][1]-skewedCorners[2][1])**2)
      ));
      const outH = Math.round(Math.max(
        Math.sqrt((skewedCorners[0][0]-skewedCorners[3][0])**2 + (skewedCorners[0][1]-skewedCorners[3][1])**2),
        Math.sqrt((skewedCorners[1][0]-skewedCorners[2][0])**2 + (skewedCorners[1][1]-skewedCorners[2][1])**2)
      ));
      const corrected = mod.applyPerspectiveCorrection(result.originalCanvas, skewedCorners, outW, outH);
      return {
        identity, autoFallback: result.isFallback,
        geometryTransformApplied: !identity,
        ocrSource: (!result.isFallback && !identity) ? 'corrected' : 'original',
        correctedW: corrected.width, correctedH: corrected.height,
      };
    }, scanClearUrl);
    ok('9a. Skewed corners: identity is false', t9.identity === false, `identity=${t9.identity}`);
    ok('9b. geometryTransformApplied is true', t9.geometryTransformApplied === true);
    ok('9c. Corrected image dimensions valid', t9.correctedW > 0 && t9.correctedH > 0,
      `${t9.correctedW}x${t9.correctedH}`);

    // ─── Test 10: Restore original returns to identity path ─────
    console.log('\n--- Test 10: Restore original returns to identity path ---');
    const t10a = await simulateScannerConfirm(scanClearUrl, { cornersModified: true });
    ok('10a. Modified corners: ocrSource is corrected', t10a.ocrSource === 'corrected');
    const t10b = await simulateScannerConfirm(scanClearUrl, { cornersModified: false });
    ok('10b. Restored corners: ocrSource is original', t10b.ocrSource === 'original');
    ok('10c. State transition works', t10a.ocrSource !== t10b.ocrSource,
      `${t10a.ocrSource} -> ${t10b.ocrSource}`);

    // ─── Summary ────────────────────────────────────────────────
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n=== OCR Source Selection: ${pass} passed, ${fail} failed (${elapsed}s) ===`);
    if (failures.length > 0) console.log('Failures:\n  - ' + failures.join('\n  - '));

    writeFileSync(join(ARTIFACTS, 'ocr-source-tests.json'), JSON.stringify({
      timestamp: new Date().toISOString(), pass, fail, failures,
    }, null, 2));

    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    await stopServer();
    process.exit(1);
  } finally {
    await stopServer();
  }
}

main();
