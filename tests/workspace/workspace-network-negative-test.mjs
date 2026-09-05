#!/usr/bin/env node
/**
 * CE-011 — Gate de red negativa del Workspace como regresión permanente.
 *
 * Promesa del producto: local-first. Todo archivo se procesa en el navegador y
 * NADA sale por red. Este gate lo sostiene de forma permanente y ligero para el
 * runtime del Workspace (sin OCR real), complementando:
 *   - `tests/workspace/phase6-network-negative-test.mjs` (E2E pesado con OCR).
 *   - la verificación "cero requests externos" embebida en los E2E de capturas.
 *
 * Método (4 capas, con controles positivos para que nunca sea una aserción vacía):
 *   1. Flujo real en navegador: intake de un PNG real -> escáner -> captura
 *      guardada en IndexedDB. Todo request ajeno al servidor local se bloquea en
 *      `context.route` y se registra antes de salir. Se recorre la home y las
 *      vistas del proyecto (intake, documentos, tabla, modelo, consulta,
 *      dashboards, flujos, capturas, diseño, herramientas).
 *   2. Marcador secreto: aparece en el nombre de la captura sembrada y en el
 *      nombre del archivo alimentado; no puede aparecer en URL, body ni headers
 *      de ningún request real.
 *   3. Escaneo estático del runtime desplegado (dist/workspace): ninguna
 *      primitiva de red (fetch, XMLHttpRequest, sendBeacon, WebSocket,
 *      EventSource) llamada con una URL absoluta externa.
 *   4. Controles positivos: fetch, sendBeacon, <img>, WebSocket y EventSource
 *      hacia external.invalid deben ser interceptados o bloqueados por el
 *      monitor (demuestra que la aserción negativa no es un no-op).
 *
 * Port: E2E_PORT env var o 8082. Evidencia determinista vía writeEvidence.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { writeEvidence } from '../evidence-helper.mjs';
import { idbGetAll, waitForCount } from './idb-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit', 'toolisto');

const PORT = Number(process.env.E2E_PORT || 8082);
const ORIGIN = `http://localhost:${PORT}`;
const SECRET = 'TLST-WORKSPACE-NET-CANARY-DETERMINISTIC';

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
const checks = [];
function ok(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail });
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}

const SEED = (secret, dataUrl) => `
  (async () => {
  const db = await import('/workspace/core/db.js');
  const S = db.STORES;
  for (const s of Object.values(S)) { try { await db.dbClear(s); } catch (e) {} }
  const now = Date.now();
  const base = (id, type, extra = {}) => ({
    id, type, createdAt: now, updatedAt: now,
    projectId: type === 'project' ? null : 'p-netneg',
    _version: 1, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    ...extra,
  });
  await db.dbPut(S.projects, base('p-netneg', 'project', { name: 'Proyecto Red Negativa' }));
  const asset = base('asset-netneg-1', 'image-asset', {
    name: 'Escaneo sembrado', type: 'image-asset',
    dataUrl: ${JSON.stringify(dataUrl)},
    originalDataUrl: ${JSON.stringify(dataUrl)},
  });
  await db.dbPut(S.assets, asset);
  const cap = base('cap-netneg-1', 'capture', {
    name: ${JSON.stringify('Escaneo ' + secret)},
    timestamp: now,
    correctedAssetId: 'asset-netneg-1',
    metadata: { captureId: 'cap-netneg-1' },
  });
  cap.relations = [{ id: 'r-netneg-1', sourceId: 'cap-netneg-1', targetId: 'asset-netneg-1', type: 'asset' }];
  await db.dbPut(S.captures, cap);
  return true;
})()`;

const DATAURL_IN_PAGE = `
  (() => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = '#eeeeee'; g.fillRect(0, 0, 120, 80);
    g.fillStyle = '#334455'; g.fillRect(10, 10, 100, 60);
    return c.toDataURL('image/png');
  })()`;

// Vistas del sidebar en contexto de proyecto (según workspace/index.html).
const VIEWS = ['dashboard', 'capture', 'documents', 'data', 'model', 'query', 'dashboards', 'design', 'flow', 'tools'];

async function clickVisibleView(page, view) {
  return page.evaluate((v) => {
    const btns = [...document.querySelectorAll(`button.sidebar-item[data-view="${v}"]`)];
    const visible = btns.find((b) => b.getClientRects().length > 0);
    if (visible) { visible.click(); return true; }
    return false;
  }, view);
}

const EXTERNAL_STATUS = 'blockedbyclient';

// Escaneo estático del runtime desplegado: primitivas de red con URL externa literal.
function scanRuntimeForExternalPrimitives() {
  const dir = join(DIST, 'workspace');
  const files = [];
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const path = join(base, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (entry.name.endsWith('.js')) files.push(path);
    }
  };
  walk(dir);
  const findings = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const primitives = content.match(/fetch\s*\(|XMLHttpRequest|sendBeacon\s*\(|new\s+WebSocket\s*\(|new\s+EventSource\s*\(/g) || [];
    for (const match of primitives) {
      // Ventana de contexto de la llamada (argumentos) para decidir si apunta fuera.
      const index = content.indexOf(match);
      const windowText = content.slice(Math.max(0, index - 40), index + 220);
      const urls = windowText.match(/https?:\/\/[^\s'"]+|\b(?:wss?):\/\/[^\s'"]+/g) || [];
      const external = urls.filter((url) => {
        try {
          const host = new URL(url).hostname.toLowerCase();
          return host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.localhost');
        } catch { return false; }
      });
      if (external.length) findings.push({ file: relative(DIST, file), primitive: match, urls: external });
    }
  }
  return findings;
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log('\n=== CE-011: Red negativa del Workspace (local-first permanente) ===');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });

  // El WebSocket real no pasa por context.route: se reemplaza por un stub
  // bloqueante que registra cada intento (mismo patrón que el gate público).
  await context.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__toolistoNetworkWebSockets = [];
    window.WebSocket = class ToolistoBlockedWebSocket {
      constructor(url) {
        window.__toolistoNetworkWebSockets.push(String(url));
        throw new DOMException('WebSocket bloqueado por auditoría local-first', 'SecurityError');
      }
      static get CONNECTING() { return OriginalWebSocket.CONNECTING; }
      static get OPEN() { return OriginalWebSocket.OPEN; }
      static get CLOSING() { return OriginalWebSocket.CLOSING; }
      static get CLOSED() { return OriginalWebSocket.CLOSED; }
    };
  });

  const requests = [];
  context.on('request', (request) => { requests.push(request); });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const local = url === ORIGIN + '/' || url.startsWith(ORIGIN + '/');
    const inert = /^(blob|data|about):/.test(url);
    const external = !local && !inert;
    if (external) { await route.abort(EXTERNAL_STATUS); return; }
    await route.continue();
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  let collectConsole = true;
  page.on('console', (message) => { if (collectConsole && message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => { if (collectConsole) pageErrors.push(error.message); });

  function snapshotRequests() {
    return requests.map((r) => {
      const u = r.url();
      const local = u === ORIGIN + '/' || u.startsWith(ORIGIN + '/');
      const inert = /^(blob|data|about):/.test(u);
      return {
        method: r.method(),
        url: u,
        headers: r.headers(),
        postData: r.postData() || '',
        external: !local && !inert,
      };
    });
  }

  function externalCount() { return snapshotRequests().filter((r) => r.external).length; }
  function assertNoExternal(before, label) {
    const now = externalCount();
    const nuevos = snapshotRequests().filter((r) => r.external).slice(before).map((r) => r.url);
    ok(`${label}: sin requests externos nuevos`, now === before, nuevos.join('; '));
  }
  function assertNoConsole(before, label) {
    ok(`${label}: sin errores de consola no controlados`, consoleErrors.length === before && pageErrors.length === 0, [...consoleErrors.slice(before), ...pageErrors].join(' | '));
  }

  try {
    // ─── 1. Home del Workspace ───────────────────────────────────
    console.log('\n--- 1. Home (carga inicial) ---');
    const errBefore = consoleErrors.length;
    await page.goto(`${ORIGIN}/workspace/?preview=internal`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.ws-home-stats', { timeout: 15000 });
    const reqs = snapshotRequests();
    const exter = reqs.filter((r) => r.external);
    ok('1. Home cargó (stats visibles)', true);
    ok('1. cero egress externo en la carga', exter.length === 0, exter.map((r) => r.url).join(', '));
    assertNoConsole(errBefore, '1');

    // ─── 2. Crear proyecto por UI (flujo real) ──────────────────
    console.log('\n--- 2. Crear proyecto por UI ---');
    let cBefore = externalCount();
    const consoleBefore2 = consoleErrors.length;
    await page.click('#ws-welcome-new', { timeout: 5000 });
    await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
    ok('2. Modal de creación abierto', true);
    await page.fill('#modal-project-name', 'Proyecto Flujo Real');
    await page.fill('#modal-project-desc', 'Flujo real sin OCR: intake -> scanner -> captura, cero egress');
    const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
    ok('2. Botón crear proyecto visible', !!createBtn);
    if (createBtn) { await createBtn.click(); await page.waitForTimeout(600); }
    assertNoExternal(cBefore, '2');
    assertNoConsole(consoleBefore2, '2');

    // ─── 3. Flujo real de archivo (intake -> escáner -> captura) ──
    console.log('\n--- 3. Intake real de archivo ---');
    await clickVisibleView(page, 'intake');
    await page.waitForTimeout(400);
    const intakeHtml = await page.evaluate(() => document.getElementById('ws-main-content')?.innerHTML || '');
    ok('3. Vista intake cargada (Captura Universal)', intakeHtml.includes('Captura Universal'));
    cBefore = externalCount();
    const consoleBefore3 = consoleErrors.length;
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
      page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type=file]');
        if (inputs.length) { inputs[0].click(); return; }
        const card = document.querySelector('.ws-bento-card');
        if (card) { card.click(); return; }
        const btn = document.querySelector('.ws-btn-capture, .ws-intake-gate button');
        if (btn) { btn.click(); return; }
      }),
    ]);
    ok('3. Selector de archivos del intake abierto', !!chooser);
    const scanPath = join(ROOT, 'tests', 'fixtures', 'star-flow', 'scan-clear.png');
    ok('3. fixture de escaneo presente', existsSync(scanPath));
    if (chooser && existsSync(scanPath)) {
      const png = readFileSync(scanPath);
      await chooser.setFiles({ name: `escaneo-${SECRET}.png`, mimeType: 'image/png', buffer: png });
      await page.waitForTimeout(1800);
    }
    const scanner = await page.$('.ws-scanner-root');
    ok('3. Escáner abierto tras el archivo', !!scanner);
    if (scanner) {
      await page.waitForSelector('.ws-btn-confirm', { timeout: 8000 }).catch(() => null);
      const confirmBtn = await page.$('.ws-btn-confirm');
      ok('3. Botón Confirmar del escáner visible', !!confirmBtn);
      if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(1500); }
    }
    const capCountReal = await waitForCount(page, 'captures', 1, 10000);
    ok('3. Captura guardada en IndexedDB (flujo real)', capCountReal >= 1, `capturas: ${capCountReal}`);
    assertNoExternal(cBefore, '3');
    assertNoConsole(consoleBefore3, '3');

    // ─── 4. Seed (IndexedDB) con marcador + recorrer TODAS las vistas ──
    console.log('\n--- 4. Seed del marcador + recorrido de vistas ---');
    const dataUrl = await page.evaluate(DATAURL_IN_PAGE);
    const seeded = await page.evaluate(SEED(SECRET, dataUrl));
    ok('4. Seed de proyecto + captura con marcador completado', seeded === true);
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(400);

    const projectOpened = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.ws-card')];
      const target = cards.find((c) => c.textContent.includes('Proyecto Red Negativa'));
      if (target) { target.click(); return true; }
      return false;
    });
    ok('4. Proyecto sembrado abierto', projectOpened);

    for (const view of VIEWS) {
      const before = externalCount();
      const consoleBefore = consoleErrors.length;
      const clicked = await clickVisibleView(page, view);
      await page.waitForTimeout(220);
      ok(`4. Vista ${view} navegada`, clicked);
      assertNoExternal(before, `4. Vista ${view}`);
      assertNoConsole(consoleBefore, `4. Vista ${view}`);
    }

    // La captura sembrada debe estar visible en la vista Capturas.
    await clickVisibleView(page, 'capture');
    await page.waitForTimeout(400);
    const captureBody = await page.locator('body').innerText();
    ok('4. Captura con marcador visible en la vista Capturas', captureBody.includes(SECRET), captureBody.slice(0, 140).replace(/\n/g, ' '));

    // ─── 5. Fuga del marcador secreto ────────────────────────────
    console.log('\n--- 5. Marcador secreto ausente de toda comunicación ---');
    const real = snapshotRequests().filter((r) => !r.external && !/\/probe\//.test(r.url));
    const leaked = real.filter((r) => r.url.includes(SECRET) || r.postData.includes(SECRET) || Object.values(r.headers || {}).some((v) => String(v).includes(SECRET)));
    ok('5. marcador ausente de URL, body y headers reales', leaked.length === 0, JSON.stringify(leaked.map((r) => r.url)));
    ok('5. requests reales totales registrados (>0)', real.length > 0, `local: ${real.length}`);

    // ─── 6. Escaneo estático del runtime desplegado ──────────────
    console.log('\n--- 6. Runtime desplegado sin primitivas de red externas ---');
    const findings = scanRuntimeForExternalPrimitives();
    ok('6. cero primitivas fetch/XHR/beacon/WebSocket/EventSource con URL externa literal', findings.length === 0, findings.map((f) => `${f.file}: ${f.primitive} ${f.urls.join(' ')}`).join('; '));

    // ─── 7. Controles positivos (el monitor no es una aserción vacía) ──
    console.log('\n--- 7. Controles positivos por canal ---');
    collectConsole = false;
    await page.evaluate((marker) => {
      fetch(`https://external.invalid/probe/fetch?marker=${marker}`, { method: 'POST', body: marker }).catch(() => {});
      navigator.sendBeacon(`https://external.invalid/probe/beacon?marker=${marker}`, marker);
      const image = new Image(); image.src = `https://external.invalid/probe/image?marker=${marker}`;
      try { new WebSocket(`wss://external.invalid/probe/socket?marker=${marker}`); } catch (_) {}
      try { new EventSource(`https://external.invalid/probe/event?marker=${marker}`); } catch (_) {}
    }, SECRET);
    await page.waitForTimeout(500);

    const all = snapshotRequests();
    const probes = all.filter((r) => r.external && r.url.includes('/probe/'));
    const unexpected = all.filter((r) => r.external && !r.url.includes('/probe/'));
    const sockets = await page.evaluate(() => window.__toolistoNetworkWebSockets || []);
    ok('7. control: fetch externo interceptado y bloqueado', probes.some((r) => r.url.includes('/fetch')));
    ok('7. control: sendBeacon externo interceptado', probes.some((r) => r.url.includes('/beacon')));
    ok('7. control: imagen externa interceptada', probes.some((r) => r.url.includes('/image')));
    ok('7. control: EventSource externo interceptado', probes.some((r) => r.url.includes('/event')));
    ok('7. control: WebSocket externo bloqueado por el stub', sockets.some((u) => u.includes('/probe/socket') && u.includes(SECRET)));
    ok('7. cero requests externos fuera de las sondas de control', unexpected.length === 0, unexpected.map((r) => r.url).join(', '));

    // ─── 8. Evidencia determinista ───────────────────────────────
    console.log('\n--- 8. Evidencia ---');
    mkdirSync(ARTIFACTS, { recursive: true });
    const evidence = {
      suite: 'workspace-network-negative',
      secret: SECRET,
      views: VIEWS.length,
      checks,
      requests: {
        real: real.length,
        externalBlocked: unexpected.length,
        probes: probes.length,
        secretLeak: leaked.length > 0,
      },
      staticFindings: findings.length,
    };
    writeEvidence(join(ARTIFACTS, 'TLT-workspace-network-negative-evidence.json'), evidence);
    console.log('Evidence: artifacts/deep-audit/toolisto/TLT-workspace-network-negative-evidence.json');
  } catch (error) {
    ok('sin excepciones no controladas en la suite', false, error.message);
  } finally {
    await browser.close();
    await stopServer();
  }

  console.log(`\nWorkspace network-negative: ${pass}/${pass + fail} PASS.`);
  if (fail) { console.error(failures.join('\n')); process.exit(1); }
}

await main();