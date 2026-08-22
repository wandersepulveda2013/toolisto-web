#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ARTIFACTS = join(ROOT, 'artifacts', 'stability-e2e');
import { mkdirSync } from 'node:fs';
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = process.env.E2E_PORT || 8082;
const BASE = `http://localhost:${PORT}/workspace/index.html?preview=internal`;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS: ${msg}`); }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

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
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
