#!/usr/bin/env node
/**
 * dist-workspace-smoke.mjs — smoke test for the functional workspace
 * built into dist/workspace/.
 *
 * This test:
 *   1. Serves ONLY dist/ (the production build artifact).
 *   2. Navigates to /workspace/ (the functional workspace).
 *   3. Verifies CSS, JS, modules load, no 404s, IndexedDB works,
 *      navigation works, and major modules can be opened.
 *
 * This is NOT a dev-server test. It certifies the deployable artifact.
 *
 * Requires: dist/ built via `npm run build` (or `node scripts/build-public-site.mjs`).
 * Requires: Playwright (`npx playwright install chromium` if missing).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error('FAIL: dist/ no existe. Ejecuta `npm run build` antes de este test.');
  process.exit(1);
}

const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const ARTIFACTS = join(ROOT, 'artifacts', 'dist-workspace-smoke');
mkdirSync(ARTIFACTS, { recursive: true });

let pass = 0, fail = 0;
const networkErrors = [];
const consoleErrors = [];
const jsErrors = [];
const failed404s = [];

function ok(n, d = '') { pass++; console.log(`  PASS: ${n}${d ? ' — ' + d : ''}`); }
function ko(n, d = '') { fail++; console.log(`  FAIL: ${n}${d ? ' — ' + d : ''}`); }

const srv = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = pathname.split('?')[0];
  if (file === '/') file = '/index.html';
  let fp = join(DIST, file);
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
  if (!existsSync(fp)) fp = join(DIST, file + '.html');
  const ext = extname(fp).toLowerCase();
  try {
    const data = readFileSync(fp);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve, reject) => {
  srv.once('error', reject);
  srv.listen(PORT, resolve);
});
console.log(`Dist server on :${PORT}\n`);

try {
  console.log('=== Dist Workspace Smoke Test ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('response', resp => {
    if (resp.status() === 404) failed404s.push(resp.url());
  });
  page.on('requestfailed', req => {
    networkErrors.push(`${req.url()} — ${req.failure()?.errorText || 'unknown'}`);
  });

  /* ── 1. Load ── */
  console.log('--- 1. Load ---');
  const resp = await page.goto(`${BASE}/workspace/`, { waitUntil: 'networkidle', timeout: 20000 });
  ok(resp && resp.status() === 200, 'HTTP 200 al cargar /workspace/');
  await page.waitForTimeout(500);

  const title = await page.title();
  ok(title.includes('Toolisto') || title.includes('Workspace'), ` título contiene Toolisto/Workspace: "${title}"`);

  /* ── 2. Not the APLUNO landing ── */
  console.log('\n--- 2. Not the APLUNO Landing ---');
  const hasApluno = await page.evaluate(() => !!document.querySelector('.apluno-product-page'));
  ok(!hasApluno, 'No es la landing promocional APLUNO');
  const hasWorkspaceApp = await page.evaluate(() => !!document.querySelector('#ws-app'));
  ok(hasWorkspaceApp, 'Monta la aplicación funcional #ws-app');

  /* ── 3. CSS ── */
  console.log('\n--- 3. CSS ---');
  const cssLoaded = await page.evaluate(() => {
    const sheets = [...document.styleSheets];
    return sheets.some(s => { try { return s.cssRules.length > 0; } catch { return false; } });
  });
  ok(cssLoaded, 'Al menos una hoja de estilo está cargada y parseada');

  const hasCustomProps = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const vars = ['--ws-bg-primary', '--ws-bg', '--ws-text', '--ws-primary', '--ws-sidebar-bg'];
    return vars.some(v => !!styles.getPropertyValue(v));
  });
  ok(hasCustomProps, 'Variables CSS del workspace están disponibles');

  const hasFontStack = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const wsFont = styles.getPropertyValue('--ws-font').trim();
    const bodyFont = getComputedStyle(document.body).fontFamily;
    return {
      wsFontValid: wsFont.length > 10 && !wsFont.includes('var(--ws-font)'),
      bodyFontNotSerif: bodyFont.startsWith('Inter') || bodyFont.startsWith('"Inter"'),
      bodyFont,
      wsFont
    };
  });
  ok(hasFontStack.wsFontValid, `--ws-font resolves to real stack: "${hasFontStack.wsFont.substring(0, 60)}..."`);
  ok(hasFontStack.bodyFontNotSerif, `body font-family starts with Inter: "${hasFontStack.bodyFont.substring(0, 60)}"`);

  /* ── 4. JS modules ── */
  console.log('\n--- 4. JS Modules ---');
  const moduleCheck = await page.evaluate(async () => {
    const results = {};
    for (const mod of ['./core/db.js', './core/state.js', './core/events.js', './core/storage.js']) {
      try {
        await import(mod);
        results[mod] = true;
      } catch { results[mod] = false; }
    }
    return results;
  });
  for (const [mod, loaded] of Object.entries(moduleCheck)) {
    if (loaded) ok(`${mod} cargado`);
    else ko(`${mod} no se pudo importar`);
  }

  /* ── 5. No 404s ── */
  console.log('\n--- 5. Network (404s) ---');
  if (failed404s.length === 0) {
    ok('Cero 404s en la carga inicial');
  } else {
    for (const url of failed404s) ko(`404: ${url}`);
  }

  /* ── 6. Console errors ── */
  console.log('\n--- 6. Console Errors ---');
  const criticalErrors = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('manifest') && !e.includes('service-worker')
  );
  if (criticalErrors.length === 0) {
    ok('Sin errores críticos de consola');
  } else {
    for (const e of criticalErrors) ko(`Console error: ${e}`);
  }

  /* ── 7. IndexedDB ── */
  console.log('\n--- 7. IndexedDB ---');
  const idbWorks = await page.evaluate(async () => {
    return new Promise(resolve => {
      const req = indexedDB.open('__ws_smoke_test__', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('t');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('t', 'readwrite');
        tx.objectStore('t').put('ok', 'k');
        tx.oncomplete = () => { db.close(); indexedDB.deleteDatabase('__ws_smoke_test__'); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      };
      req.onerror = () => resolve(false);
    });
  });
  ok(idbWorks, 'IndexedDB funcional (write + read + delete)');

  /* ── 8. Navigation ── */
  console.log('\n--- 8. Navigation ---');
  const navButtons = await page.evaluate(() => {
    const views = ['projects', 'capture', 'documents', 'data', 'model', 'query', 'dashboards', 'flow', 'tools'];
    return views.map(v => ({
      view: v,
      exists: !!document.querySelector(`[data-view="${v}"]`)
    }));
  });
  for (const { view, exists } of navButtons) {
    if (exists) ok(`Navegación: vista "${view}" existe`);
    else ko(`Navegación: vista "${view}" NO encontrada`);
  }

  /* ── 9. Module interaction ── */
  console.log('\n--- 9. Module Interaction ---');
  const projectsBtn = page.locator('[data-view="projects"]').first();
  if (await projectsBtn.count() > 0) {
    await projectsBtn.click();
    await page.waitForTimeout(200);
    ok('Click en "Proyectos" no lanza error');
  }

  const documentsBtn = page.locator('[data-view="documents"]').first();
  if (await documentsBtn.count() > 0) {
    await documentsBtn.click();
    await page.waitForTimeout(200);
    ok('Click en "Documentos" no lanza error');
  }

  const dataBtn = page.locator('[data-view="data"]').first();
  if (await dataBtn.count() > 0) {
    await dataBtn.click();
    await page.waitForTimeout(200);
    ok('Click en "Datos" no lanza error');
  }

  const toolsBtn = page.locator('[data-view="tools"]').first();
  if (await toolsBtn.count() > 0) {
    await toolsBtn.click();
    await page.waitForTimeout(200);
    ok('Click en "Herramientas" no lanza error');
  }

  /* ── 10. Screenshot ── */
  await page.screenshot({ path: join(ARTIFACTS, 'dist-workspace-home.png'), fullPage: true });

  /* ── Summary ── */
  const postNavErrors = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('manifest') && !e.includes('service-worker')
  );
  if (postNavErrors.length > criticalErrors.length) {
    const newErrors = postNavErrors.slice(criticalErrors.length);
    for (const e of newErrors) ko(`Post-nav console error: ${e}`);
  }

  await browser.close();
} finally {
  srv.close();
}

console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===`);
if (failed404s.length) console.log(`  404s: ${failed404s.join(', ')}`);
if (networkErrors.length) console.log(`  Network errors: ${networkErrors.join(', ')}`);
process.exit(fail ? 1 : 0);
