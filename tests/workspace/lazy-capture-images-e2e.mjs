#!/usr/bin/env node
/**
 * CE-008 — Lazy-load de imágenes de capturas en el Workspace
 *
 * Verifica que la vista de Capturas con muchas capturas NO resuelve ni decodifica
 * todas las imágenes de golpe: cada tarjeta muestra un placeholder hasta que entra
 * al viewport (IntersectionObserver), y solo entonces se resuelve el dataUrl.
 *
 * Método:
 *  1. Playwright abre el workspace con preview=internal.
 *  2. Seed directo en IndexedDB real (sin mocks): 1 proyecto + N capturas con
 *     dataUrl propio + assets corregidos opcionales.
 *  3. Múltiples capturas fuera del viewport inicial: se verifican dos invariantes:
 *       a. Total de tarjetas renderizadas = N.
 *       b. Inicialmente solo las tarjetas visibles tienen <img>; las de abajo
 *          conservan el placeholder `.ws-card-thumb` sin imagen.
 *  4. Al hacer scroll hasta el final (disparando IntersectionObserver), todas las
 *     tarjetas terminan con <img> resuelto.
 *  5. Se confirma que las <img> usan loading="lazy" decoding="async" y que no
 *     hubo errores de consola ni requests externos.
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');

const PORT = Number(process.env.E2E_PORT || 8082);
const ORIGIN = `http://localhost:${PORT}`;

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
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}
function ko(name, detail = '') { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }

const N_CAPTURES = 24;

// Seed: 1 proyecto + N capturas; cada captura con dataUrl propio para que
// resolveCaptureImageDataUrl devuelva inmediatamente sin depender de assets.
const SEED = `
  (async () => {
  const __db = await import('/workspace/core/db.js');
  const __S = __db.STORES;
  for (const s of Object.values(__S)) { try { await __db.dbClear(s); } catch (e) {} }
  const __now = Date.now();
  const __base = (id, type, extra = {}) => ({
    id, type, createdAt: __now, updatedAt: __now, projectId: 'p-lazy', _version: 1,
    metadata: {}, history: [], relations: [], processingState: 'idle', errors: [],
    sourceAssetId: null, derivedIds: [],
    ...extra,
  });
  await __db.dbPut(__S.projects, __base('p-lazy', 'project', { projectId: null, name: 'Proyecto Lazy' }));
  const __png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  for (let i = 0; i < ${N_CAPTURES}; i++) {
    await __db.dbPut(__S.captures, __base('cap-lazy-' + i, 'capture', {
      name: 'Captura Lazy ' + i,
      timestamp: __now + i,
      dataUrl: __png,
      metadata: { captureId: 'cap-lazy-' + i },
    }));
  }
  return true;
})()`;

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log('\n=== CE-008: Lazy-load de imágenes de capturas ===');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  const externalRequests = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  ctx.on('request', r => {
    const u = new URL(r.url());
    const sameOrigin = u.protocol === 'http:' && u.host === `localhost:${PORT}`;
    const nonNetwork = u.protocol === 'blob:' || u.protocol === 'data:' || u.protocol === 'file:';
    if (!sameOrigin && !nonNetwork) externalRequests.push(r.url());
  });

  try {
    // ─── 1. Abrir workspace ─────────────────────────────────────
    console.log('\n--- 1. Abrir workspace ---');
    const resp = await page.goto(`${ORIGIN}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 20000 });
    ok('1. Workspace carga', resp.status() === 200);
    await page.waitForTimeout(300);

    // ─── 2. Seed del proyecto con 24 capturas ───────────────────
    console.log('\n--- 2. Seed en IndexedDB (sin mocks) ---');
    const seeded = await page.evaluate(SEED);
    ok('2. Seed de capturas completado', seeded === true);

    // Recargar para que la app re-lea IndexedDB
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(300);

    // ─── 3. Abrir el proyecto y la vista Capturas ───────────────
    console.log('\n--- 3. Navegar a Capturas ---');
    const projectOpened = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.ws-card')];
      const target = cards.find(c => c.textContent.includes('Proyecto Lazy'));
      if (target) { target.click(); return true; }
      return false;
    });
    ok('3. Proyecto seed seleccionado', projectOpened);

    await page.waitForTimeout(500);
    await page.click('.sidebar-item[data-view="capture"]');
    await page.waitForTimeout(600);

    // ─── 4. Invariante: total de tarjetas y lazy-load inicial ──
    console.log('\n--- 4. Lazy-load inicial (solo visibles cargan) ---');
    const initial = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.ws-card-grid .ws-card')];
      const imgs = cards.filter(c => c.querySelector('img')).length;
      const thumbs = cards.filter(c => c.querySelector('.ws-card-thumb')).length;
      const lazyImgs = cards.filter(c => {
        const img = c.querySelector('img');
        return img && img.getAttribute('loading') === 'lazy' && img.getAttribute('decoding') === 'async';
      }).length;
      return { total: cards.length, imgs, thumbs, lazyImgs, hasPlaceholder: thumbs > 0 };
    });
    ok('4. Todas las tarjetas renderizadas', initial.total === N_CAPTURES, `${initial.total}/${N_CAPTURES}`);
    ok('4. Placeholder presente en al menos una tarjeta', initial.hasPlaceholder, `${initial.thumbs} placeholders`);
    ok('4. No todas las imágenes cargadas de golpe', initial.imgs < initial.total, `${initial.imgs} img de ${initial.total}`);
    ok('4. Al menos una imagen resuelta en el viewport inicial', initial.imgs > 0, `${initial.imgs} img`);
    ok('4. <img> usan loading=lazy + decoding=async', initial.lazyImgs === initial.imgs && initial.imgs > 0, `${initial.lazyImgs} con atributos lazy`);

    // ─── 5. Scroll dispara la carga del resto ───────────────────
    console.log('\n--- 5. Scroll hasta el final carga todas ---');
    const scrolledLoaded = await page.evaluate(async (expected) => {
      const main = document.querySelector('#ws-main-content') || document.documentElement;
      for (let i = 0; i < 40; i++) {
        main.scrollTop = main.scrollHeight;
        const loaded = document.querySelectorAll('.ws-card-grid .ws-card img').length;
        if (loaded >= expected) return { done: true, loaded };
        await new Promise(r => setTimeout(r, 200));
      }
      return { done: false, loaded: document.querySelectorAll('.ws-card-grid .ws-card img').length };
    }, N_CAPTURES);
    ok('5. Scroll resuelve todas las imágenes', scrolledLoaded.done, `${scrolledLoaded.loaded}/${N_CAPTURES}`);

    // ─── 6. Sin errores ni egress externo ───────────────────────
    console.log('\n--- 6. Salud: errores y red ---');
    ok('6. Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
    ok('6. Sin errores de consola', consoleErrors.length === 0, consoleErrors.join(' | '));
    ok('6. Cero requests externos', externalRequests.length === 0, externalRequests.join(' | '));
  } finally {
    await browser.close();
    await stopServer();
  }

  console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===`);
  if (failures.length > 0) {
    console.log('Fallos: ' + failures.join(', '));
    process.exit(1);
  }
  console.log('CE-008 lazy-load: OK');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
