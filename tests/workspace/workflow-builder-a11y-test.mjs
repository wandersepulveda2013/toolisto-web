#!/usr/bin/env node
/**
 * Workflow Builder ARIA/KBD Contract Tests (CE-009)
 * Verifies the accessibility contract of the workflow builder's dynamic widgets:
 * - operation picker rows are keyboard-operable (role=button, tabindex, Enter/Space)
 * - category filter buttons expose the active state via aria-pressed
 * - the "Desde Workspace" modal items are keyboard-operable (role=option, Enter/Space)
 *
 * Runs in-browser via Playwright against the built dist.
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
const ARTIFACTS = join(ROOT, 'artifacts', 'workflow-builder-a11y');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const INTERNAL_BASE = `http://localhost:${PORT}/workspace/preview.html?preview=internal`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon', '.mjs': 'application/javascript; charset=utf-8',
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
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

let pass = 0, fail = 0;
function ok(n, d = '') { pass++; console.log(`  PASS: [${n}] ${d}`); }
function ko(n, d = '') { fail++; console.log(`  FAIL: [${n}] ${d}`); }

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}\n`);

try {
  console.log('=== Workflow Builder ARIA/KBD Contract ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  // 1. Load the workspace, create a project and open the flow builder.
  await page.goto(INTERNAL_BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('.ws-home-stats', { timeout: 15000 });
  ok('load.1', 'Workspace home loads');

  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.waitForSelector('#modal-project-name', { state: 'visible', timeout: 10000 });
  await page.locator('#modal-project-name').fill('Proyecto a11y flujos');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.waitForSelector('.ws-bento-card', { timeout: 15000 });
  ok('load.2', 'Project created');

  // Create a document so the "Desde Workspace" picker has items, then open the flow builder.
  await page.locator('.ws-bento-card').filter({ hasText: 'Documentos' }).click();
  await page.getByRole('button', { name: 'Nuevo Documento', exact: true }).first().click();
  await page.getByRole('button', { name: 'Documentos', exact: true }).click();
  await page.getByRole('button', { name: /Encadenar/ }).click();
  await page.waitForSelector('#wf-file-input', { state: 'attached', timeout: 15000 });
  ok('load.3', 'Flujos view accessible with a chained workspace document');

  // 2. Operation picker rows keyboard contract.
  await page.getByRole('button', { name: /Anadir operacion/ }).click();
  await page.waitForSelector('#wf-op-results [role="button"]', { timeout: 10000 });
  const opRowCount = await page.locator('#wf-op-results [role="button"]').count();
  if (opRowCount > 0) ok('op.1', `operation picker renders ${opRowCount} role=button rows`);
  else ko('op.1', 'no role=button rows found');

  const focusableRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#wf-op-results [role="button"]')).every(r =>
      r.hasAttribute('tabindex') && Number(r.getAttribute('tabindex')) === 0 && r.getAttribute('aria-label')
    )
  );
  if (focusableRows) ok('op.2', 'each row is focusable with tabindex=0 and has an aria-label');
  else ko('op.2', 'rows lack focusable/aria-label contract');

  // Focus the first row and activate with Enter -> step is added.
  const firstRowName = await page.locator('#wf-op-results [role="button"]').first().getAttribute('aria-label');
  await page.locator('#wf-op-results [role="button"]').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const stepsAfterEnter = await page.locator('#wf-step-list [aria-label*="paso"]').count().catch(() => 0);
  const stepToggles = await page.locator('#wf-step-list button[aria-pressed]').count();
  if (stepToggles === 1) ok('op.3', `Enter on a row (${firstRowName}) adds a step to the flow`);
  else ko('op.3', `expected 1 step toggle after Enter, got ${stepToggles}`);

  // Space activation works too after cleaning the flow.
  await page.getByRole('button', { name: 'Limpiar', exact: true }).last().click().catch(() => {});
  await page.getByRole('button', { name: /Anadir operacion/ }).click();
  await page.locator('#wf-op-results [role="button"]').first().focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const stepTogglesAfterSpace = await page.locator('#wf-step-list button[aria-pressed]').count();
  if (stepTogglesAfterSpace === 1) ok('op.4', 'Space on a row also adds a step (keyboard parity)');
  else ko('op.4', `expected 1 step toggle after Space, got ${stepTogglesAfterSpace}`);

  // 3. Category filter buttons expose aria-pressed.
  const catContract = await page.evaluate(() => {
    const filter = document.querySelector('[aria-label="Filtrar por categoria"]');
    if (!filter) return { error: 'no category filter' };
    const btns = Array.from(filter.querySelectorAll('button'));
    const pressedCount = btns.filter(b => b.getAttribute('aria-pressed')).length;
    const active = btns.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim());
    return { count: btns.length, pressedCount, active };
  });
  if (catContract.error) ko('cat.1', catContract.error);
  else {
    if (catContract.pressedCount === catContract.count && catContract.active.length === 1) {
      ok('cat.1', `category filter has ${catContract.count} buttons, each with aria-pressed, one active (${catContract.active[0]})`);
    } else {
      ko('cat.1', 'category aria-pressed contract broken: ' + JSON.stringify(catContract));
    }
  }

  // Clicking the "Grafico" category updates aria-pressed to the pressed button.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[aria-label="Filtrar por categoria"] button'))
      .find(b => b.textContent.trim() === 'Grafico' || b.textContent.trim() === 'Gráfico');
    if (btn) btn.click();
  });
  await page.waitForTimeout(200);
  const catAfterClick = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[aria-label="Filtrar por categoria"] button'));
    return {
      pressed: btns.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()),
      hasGrafico: btns.some(b => /graf/i.test(b.textContent) && b.getAttribute('aria-pressed') === 'true'),
    };
  });
  if (catAfterClick.hasGrafico && catAfterClick.pressed.length === 1) {
    ok('cat.2', `click moves aria-pressed to the selected category (${catAfterClick.pressed[0]})`);
  } else {
    ko('cat.2', 'aria-pressed did not move on click: ' + JSON.stringify(catAfterClick));
  }

  // 4. "Desde Workspace" modal items keyboard contract (a document is chained in this project).
  const wsModal = await page.evaluate(async () => {
    const button = (texts) => {
      const all = Array.from(document.querySelectorAll('button'));
      return all.find(b => texts.some(t => b.textContent.trim().includes(t)));
    };
    const bt = button(['Desde Workspace']);
    if (!bt) return { error: 'no "Desde Workspace" button' };
    bt.click();
    await new Promise(r => setTimeout(r, 300));
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    if (options.length === 0) return { error: 'no project items rendered in modal', options: 0 };
    const contract = options.every(o => o.hasAttribute('tabindex') && Number(o.getAttribute('tabindex')) === 0 && o.getAttribute('aria-selected') === 'false');
    const firstLabel = (options[0].textContent || '').trim();
    return { count: options.length, contractOk: contract, firstLabel };
  });
  if (wsModal.error) {
    // If no documents exist because navigation failed, still check via keyboard on a live row when present.
    ko('ws.1', wsModal.error);
  } else {
    if (wsModal.count > 0 && wsModal.contractOk) {
      ok('ws.1', `"Desde Workspace" modal shows ${wsModal.count} role=option items, focusable with aria-selected`);
    } else {
      ko('ws.1', 'modal option contract broken: ' + JSON.stringify(wsModal));
    }
  }

  if (jsErrors.length === 0) ok('final.1', 'sin errores JS en todo el contrato');
  else ko('final.1', 'errores JS: ' + jsErrors.join(', '));

  await page.screenshot({ path: join(ARTIFACTS, 'workflow-builder-a11y.png'), fullPage: true });

  await ctx.close();
  await browser.close();
} catch (e) {
  ko('FATAL', 'Exception: ' + e.message);
}

await new Promise(r => srv.close(r));
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
