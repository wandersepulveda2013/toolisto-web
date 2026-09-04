#!/usr/bin/env node
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'stability-e2e');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://localhost:${PORT}/workspace/index.html?preview=internal`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
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
      const data = readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}
function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS: ${msg}`); }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

await startServer();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

try {
  console.log('=== Workspace Stability E2E Tests ===\n');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ws-home-stats', { timeout: 15000 });
  assert(true, 'Workspace home page loads');

  // Verify undo/redo buttons exist
  const undoBtn = page.locator('#ws-undo-btn');
  const redoBtn = page.locator('#ws-redo-btn');
  assert((await undoBtn.count()) === 1, 'Undo button visible in topbar');
  assert((await redoBtn.count()) === 1, 'Redo button visible in topbar');

  // Verify save indicator
  const saveIndicator = page.locator('#ws-save-indicator');
  assert((await saveIndicator.count()) === 1, 'Save indicator visible in topbar');

  // Verify toast container
  const toastContainer = page.locator('#ws-toast-container');
  assert((await toastContainer.count()) === 1, 'Toast container exists');

  // Navigate to intake and verify navigation
  await page.locator('button.sidebar-item[data-view="intake"]').first().click();
  await page.waitForTimeout(300);
  assert(await page.locator('.ws-intake-gate, #ws-intake-gate, [data-view="intake"].active').count() >= 1, 'Navigates to intake view');

  // Verify undo/redo buttons still present after navigation
  assert((await page.locator('#ws-undo-btn').count()) === 1, 'Undo button persists after navigation');

  // Verify no console errors
  assert(errors.length === 0, 'No console errors: ' + (errors.length ? errors[0] : ''));

  await page.screenshot({ path: join(ARTIFACTS, 'stability-e2e.png'), fullPage: true });
  assert(true, 'Screenshot saved');

} catch (e) {
  console.error('  ERROR: ' + e.message);
  fail++;
} finally {
  await browser.close();
  await stopServer();
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
