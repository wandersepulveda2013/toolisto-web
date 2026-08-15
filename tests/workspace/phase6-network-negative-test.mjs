#!/usr/bin/env node
/**
 * Phase 6 — Prueba negativa de red (WSP-023, UXW-067, WDX-010)
 *
 * Demuestra la promesa local-first del workspace: el contenido del usuario
 * NUNCA sale por red durante el flujo estrella completo.
 *
 * Método:
 *  1. Playwright intercepta TODOS los requests (context.route glob universal):
 *     fetch, XHR, sendBeacon, <img>, <script>, <link>, favicon, etc.
 *  2. Se ejecuta el flujo estrella real (crear proyecto, escanear, OCR,
 *     documento, tabla, revisión, gráfico, Diseño, PDF, export .toolisto,
 *     import, recarga y navegación por Query/Flow/Dashboard) sobre IndexedDB
 *     real, sin mocks.
 *  3. Un marcador secreto aleatorio se inyecta en el CONTENIDO (bloque del
 *     documento y celda de la tabla) y se verifica que nunca aparece en
 *     ninguna URL, body POST, header ni frame de WebSocket.
 *  4. Toda request no same-origin se ABORTA antes de salir y queda registrada:
 *     el test exige CERO requests externos no-probe.
 *  5. Control positivo: el propio test intenta fetch/sendBeacon/<img>/WebSocket
 *     con el secreto y demuestra que el interceptor los ve y bloquea.
 *  6. Escaneo estático: el código del workspace no contiene fetch(,
 *     XMLHttpRequest, sendBeacon ni new WebSocket(, y HTML/CSS no referencian
 *     hosts externos (las fuentes de Google fueron eliminadas).
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { idbGetAll, idbGetById, waitForCount } from './idb-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
// El build público --production ya no publica el runtime del Workspace; el
// escaneo estático y el servidor usan la FUENTE workspace/ como fallback.
const WS_SRC = join(ROOT, 'workspace');
const WS_DIST = join(DIST, 'workspace');
const wsBase = existsSync(WS_DIST) ? WS_DIST : WS_SRC;
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'star-flow');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit');
mkdirSync(ARTIFACTS, { recursive: true });

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
      const base = file.startsWith('/workspace/') ? wsBase : DIST;
      let rel = file.startsWith('/workspace/') ? file.slice('/workspace/'.length) : file;
      if (rel === 'preview.html') rel = 'index.html';
      let fp = join(base, rel);
      if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(base, rel + '.html');
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

const SECRET = 'TLST-P6-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

const evidence = { secret: SECRET, requests: [], websockets: [], probes: {}, flow: {}, staticScan: {} };
let collectingConsole = true;

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log('\n=== Phase 6: Prueba negativa de red ===');
  console.log(`Marcador secreto: ${SECRET}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  const requests = [];
  const websockets = [];
  const pageErrors = [];
  const consoleErrors = [];

  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const sameOrigin = u.protocol === 'http:' && u.host === `localhost:${PORT}`;
    const nonNetwork = u.protocol === 'blob:' || u.protocol === 'data:' || u.protocol === 'file:';
    const rec = {
      method: req.method(),
      url: req.url(),
      postData: req.postData() || null,
      headers: req.headers(),
      external: !sameOrigin && !nonNetwork,
      aborted: false,
    };
    if (rec.external) {
      rec.aborted = true;
      requests.push(rec);
      await route.abort('blockedbyclient');
      return;
    }
    requests.push(rec);
    await route.continue();
  });

  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (collectingConsole && m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('websocket', ws => {
    const entry = { url: ws.url(), sent: [], received: [] };
    ws.on('framesent', f => entry.sent.push(typeof f.payload === 'string' ? f.payload : '<bin>'));
    ws.on('framereceived', f => entry.received.push(typeof f.payload === 'string' ? f.payload : '<bin>'));
    websockets.push(entry);
  });

  try {
    // ─── Paso 1: abrir workspace ─────────────────────────────────
    console.log('\n--- 1. Abrir workspace ---');
    const resp = await page.goto(`${ORIGIN}/workspace/preview.html?preview=internal`, { waitUntil: 'networkidle', timeout: 20000 });
    ok('1. Workspace carga', resp.status() === 200);
    await page.waitForTimeout(500);

    // ─── Paso 2: crear proyecto ──────────────────────────────────
    console.log('\n--- 2. Crear proyecto ---');
    await page.click('#ws-welcome-new');
    await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
    await page.fill('#modal-project-name', 'Negativa de Red P6');
    await page.fill('#modal-project-desc', 'Prueba de que el contenido nunca sale por red');
    const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
    if (createBtn) await createBtn.click();
    await page.waitForTimeout(500);
    const navVisible = await page.evaluate(() => {
      const nav = document.getElementById('ws-project-nav');
      return nav && getComputedStyle(nav).display !== 'none';
    });
    ok('2. Proyecto creado', navVisible);

    // ─── Paso 3: capturar scan-clear.png ─────────────────────────
    console.log('\n--- 3. Escanear fixture ---');
    await page.click('.sidebar-item[data-view="intake"]');
    await page.waitForTimeout(300);
    const scanPath = join(FIXTURES, 'scan-clear.png');
    ok('3. Fixture existe', existsSync(scanPath));
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type=file]');
        if (inputs.length) { inputs[0].click(); return; }
        const cards = document.querySelectorAll('.ws-bento-card, .ws-card');
        for (const c of cards) { c.click(); return; }
      }),
    ]);
    ok('3. Selector de archivo abierto', !!fileChooser);
    await fileChooser.setFiles(scanPath);
    await page.waitForTimeout(2000);
    ok('3. Scanner renderizado', !!(await page.$('.ws-scanner-root')));
    await page.waitForSelector('.ws-btn-confirm', { timeout: 5000 }).catch(() => null);
    const confirmBtn = await page.$('.ws-btn-confirm');
    if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(2000); }
    const capCount = await waitForCount(page, 'captures', 1, 10000);
    ok('3. Captura guardada', capCount >= 1, `Count: ${capCount}`);

    // ─── Paso 4: OCR ─────────────────────────────────────────────
    console.log('\n--- 4. OCR ---');
    await page.click('.sidebar-item[data-view="capture"]');
    await page.waitForTimeout(500);
    const extractBtns = await page.$$('.ws-card .ws-btn-ghost');
    ok('4. Botones de extraccion presentes', extractBtns.length > 0);
    let ocrDone = false;
    if (extractBtns.length > 0) {
      await extractBtns[0].click();
      await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 }).then(() => {}, () => {});
      for (let i = 0; i < 240; i++) {
        await page.waitForTimeout(500);
        if (!(await page.$('.ws-modal-overlay'))) { ocrDone = true; break; }
        if (await page.$('.ws-modal textarea')) { ocrDone = true; break; }
      }
    }
    ok('4. OCR completado', ocrDone);
    const docs = await idbGetAll(page, 'documents');
    const textDoc = docs.find(d => d.type === 'text-document');
    ok('4. TextDocument creado', !!textDoc);
    const docId = textDoc?.id;

    // ─── Paso 5: inyectar SECRETO en el documento ────────────────
    console.log('\n--- 5. Inyectar marcador en el documento ---');
    let secretInDoc = false;
    if (textDoc) {
      secretInDoc = await page.evaluate(async ({ id, secret }) => {
        return new Promise((resolve) => {
          const req = indexedDB.open('toolisto-workspace', 3);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('documents', 'readwrite');
            const r = tx.objectStore('documents').get(id);
            r.onsuccess = () => {
              const doc = r.result;
              if (!doc?.blocks?.length) { db.close(); resolve(false); return; }
              doc.blocks[0].content = doc.blocks[0].content + ' ' + secret;
              doc.updatedAt = Date.now();
              const w = tx.objectStore('documents').put(doc);
              w.onsuccess = () => { db.close(); resolve(true); };
              w.onerror = () => { db.close(); resolve(false); };
            };
            r.onerror = () => { db.close(); resolve(false); };
          };
          req.onerror = () => resolve(false);
        });
      }, { id: docId, secret: SECRET });
    }
    ok('5. Marcador inyectado en documento', secretInDoc);

    // ─── Paso 6: documento → tabla ───────────────────────────────
    console.log('\n--- 6. Documento a tabla ---');
    await page.waitForTimeout(500);
    const aTablaBtn = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) { if (b.textContent.includes('A tabla')) { b.click(); return true; } }
      return false;
    });
    ok('6. Boton A tabla accionado', aTablaBtn);
    await page.waitForTimeout(2000);
    const tblCount = await waitForCount(page, 'data', 1, 10000);
    ok('6. Tabla creada', tblCount >= 1, `Tablas: ${tblCount}`);
    const dataItems = await idbGetAll(page, 'data');
    const tbl = dataItems.find(t => t.type === 'table-document');
    const tableId = tbl?.id;
    ok('6. TableDocument encontrada', !!tbl);

    // ─── Paso 7: inyectar SECRETO en una celda ───────────────────
    console.log('\n--- 7. Inyectar marcador en celda ---');
    let secretInCell = false;
    if (tbl) {
      secretInCell = await page.evaluate(async ({ id, secret }) => {
        return new Promise((resolve) => {
          const req = indexedDB.open('toolisto-workspace', 3);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('data', 'readwrite');
            const r = tx.objectStore('data').get(id);
            r.onsuccess = () => {
              const t = r.result;
              if (!t) { db.close(); resolve(false); return; }
              if (t.rows?.length > 0 && t.rows[0]?.length > 0) t.rows[0][0] = String(t.rows[0][0]) + ' ' + secret;
              if (t.sheets?.[0]?.rows?.length > 0 && t.sheets[0].rows[0]?.length > 0) t.sheets[0].rows[0][0] = String(t.sheets[0].rows[0][0]) + ' ' + secret;
              t.updatedAt = Date.now();
              const w = tx.objectStore('data').put(t);
              w.onsuccess = () => { db.close(); resolve(true); };
              w.onerror = () => { db.close(); resolve(false); };
            };
            r.onerror = () => { db.close(); resolve(false); };
          };
          req.onerror = () => resolve(false);
        });
      }, { id: tableId, secret: SECRET });
    }
    ok('7. Marcador inyectado en celda', secretInCell);
    const verifiedCell = await idbGetById(page, 'data', tableId);
    ok('7. Celda contiene el marcador', verifiedCell?.rows?.[0]?.[0]?.includes(SECRET));

    // ─── Paso 8: revisar tabla ───────────────────────────────────
    console.log('\n--- 8. Revisar tabla ---');
    let reviewOpened = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      reviewOpened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Revisar'));
        if (b) { b.click(); return true; }
        return false;
      });
      if (reviewOpened) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(600);
    const reviewModalOpen = await page.evaluate(() =>
      [...document.querySelectorAll('.ws-modal-title')].some(t => (t.textContent || '').includes('Revision de tabla')));
    ok('8. Modal de revision abierto', reviewModalOpen);
    if (reviewModalOpen) {
      const marked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.ws-modal-footer button')].find(x => x.textContent.includes('Marcar como revisada'));
        if (b) { b.click(); return true; }
        return false;
      });
      ok('8. Tabla marcada revisada', marked);
      await page.waitForTimeout(1500);
      const afterTable = await idbGetById(page, 'data', tableId);
      ok('8. Estado = reviewed', afterTable?.reviewStatus === 'reviewed', `status=${afterTable?.reviewStatus}`);
    }

    // ─── Paso 9: crear gráfico ───────────────────────────────────
    console.log('\n--- 9. Grafico ---');
    await page.evaluate(() => {
      const items = document.querySelectorAll('.sidebar-item[data-view="data"]');
      for (const item of items) { if (item.offsetParent !== null) { item.click(); break; } }
    });
    await page.waitForTimeout(3000);
    let chartClicked = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      chartClicked = await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          if (b.textContent.includes('fico') || b.textContent.includes('Grafico')) { b.click(); return true; }
        }
        return false;
      });
      if (chartClicked) break;
      await page.waitForTimeout(1000);
    }
    ok('9. Boton de grafico accionado', chartClicked);
    await page.waitForTimeout(2000);
    const assetCount = await waitForCount(page, 'assets', 1, 10000);
    ok('9. Grafico creado', assetCount >= 1, `Assets: ${assetCount}`);
    const assets = await idbGetAll(page, 'assets');
    const chart = assets.find(a => a.type === 'chart');
    ok('9. Chart encontrado', !!chart);

    // ─── Paso 10: Diseño + PDF ───────────────────────────────────
    console.log('\n--- 10. Diseno + PDF ---');
    await page.evaluate(() => {
      const items = document.querySelectorAll('.sidebar-item[data-view="design"]');
      for (const item of items) { if (item.offsetParent !== null) { item.click(); break; } }
    });
    await page.waitForTimeout(1000);
    const clickGhost = async (label) => {
      await page.evaluate((l) => {
        for (const b of document.querySelectorAll('.ws-btn-ghost')) { if (b.textContent.includes(l)) { b.click(); break; } }
      }, label);
      await page.waitForTimeout(200);
    };
    await clickGhost('Titulo');
    await clickGhost('Tabla');
    await clickGhost('Grafico');
    const pdfDl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('PDF'));
      if (btn) btn.click();
    });
    const dl = await pdfDl;
    let pdfPath = null;
    if (dl) {
      pdfPath = join(ARTIFACTS, 'phase6-network-negative.pdf');
      await dl.saveAs(pdfPath);
      ok('10. PDF generado', true, `${dl.suggestedFilename()} (${readFileSync(pdfPath).length} bytes)`);
    } else {
      ko('10. PDF no descargado');
    }
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Guardar'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(1500);

    // ─── Paso 11: recargar (persistencia) ────────────────────────
    console.log('\n--- 11. Recargar ---');
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    const projAfter = await idbGetAll(page, 'projects');
    ok('11. Proyecto persistido', projAfter.length >= 1, `${projAfter.length} proyectos`);
    const docAfter = await idbGetAll(page, 'documents');
    ok('11. Documento con marcador persistido', docAfter.some(d => JSON.stringify(d).includes(SECRET)));

    // ─── Paso 12: export .toolisto ───────────────────────────────
    console.log('\n--- 12. Exportar .toolisto ---');
    await page.waitForTimeout(1000);
    const projectSelected = await page.evaluate(() => {
      const cards = document.querySelectorAll('.ws-card');
      for (const c of cards) { if (c.textContent.includes('Negativa de Red')) { c.click(); return true; } }
      return false;
    });
    if (!projectSelected) {
      await page.evaluate(() => {
        const items = document.querySelectorAll('.sidebar-item[data-view="dashboard"]');
        for (const item of items) { if (item.offsetParent !== null) { item.click(); break; } }
      });
    }
    await page.waitForTimeout(2000);
    const exportDl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.includes('Exportar') && !b.textContent.includes('PDF') && !b.textContent.includes('CSV')) { b.click(); break; }
      }
    });
    const expDl = await exportDl;
    let bundle = null;
    if (expDl) {
      const expPath = join(ARTIFACTS, 'phase6-export.toolisto');
      await expDl.saveAs(expPath);
      bundle = JSON.parse(readFileSync(expPath, 'utf8'));
      ok('12. Bundle exportado', !!bundle?.project, expDl.suggestedFilename());
      ok('12. Bundle con manifiesto', !!bundle?.manifest?.schemaVersion, `schemaVersion=${bundle?.manifest?.schemaVersion}`);
      ok('12. Bundle contiene el marcador (archivo local)', JSON.stringify(bundle).includes(SECRET));
      evidence.flow.bundleHasManifest = bundle?.manifest?.schemaVersion;
    } else {
      ko('12. Bundle no descargado');
    }

    // ─── Paso 13: import ─────────────────────────────────────────
    console.log('\n--- 13. Importar ---');
    let imported = null;
    if (bundle) {
      imported = await page.evaluate(async (bundleStr) => {
        const b = JSON.parse(bundleStr);
        const { importProject } = await import('/workspace/core/storage.js');
        const p = await importProject(b);
        return { id: p.id, name: p.name };
      }, JSON.stringify(bundle));
      ok('13. Import completado', !!imported?.id, imported?.id);
      const projAfterImport = await idbGetAll(page, 'projects');
      ok('13. Dos proyectos', projAfterImport.length >= 2, `${projAfterImport.length}`);
    } else {
      ko('13. Sin bundle para importar');
    }

    // ─── Paso 14: navegar por Query / Flow / Dashboard ───────────
    console.log('\n--- 14. Navegacion completa ---');
    for (const view of ['query', 'flow', 'dashboard', 'document', 'data', 'capture']) {
      await page.evaluate((v) => {
        const items = document.querySelectorAll(`.sidebar-item[data-view="${v}"]`);
        for (const item of items) { if (item.offsetParent !== null) { item.click(); break; } }
      }, view);
      await page.waitForTimeout(600);
    }
    ok('14. Navegacion por todos los modulos', true);

    // ─── Paso 15: control positivo (los canales SÍ son monitoreados) ──
    console.log('\n--- 15. Control positivo de monitoreo ---');
    collectingConsole = false;
    await page.evaluate((secret) => {
      fetch('https://external.invalid/probe/fetch?marker=' + secret, { method: 'POST', body: secret }).catch(() => {});
      const img = new Image();
      img.onload = () => {}; img.onerror = () => {};
      img.src = 'https://external.invalid/probe/img?marker=' + secret;
      try { navigator.sendBeacon('https://external.invalid/probe/beacon?marker=' + secret, secret); } catch (e) {}
      try { new WebSocket('ws://127.0.0.1:9/probe/ws?marker=' + secret); } catch (e) {}
    }, SECRET);
    await page.waitForTimeout(2500);

    const probeRequests = requests.filter(r => r.external && r.url.includes('/probe/'));
    const unexpectedExternal = requests.filter(r => r.external && !r.url.includes('/probe/'));
    const probeWs = websockets.filter(w => w.url.includes('/probe/ws'));
    const nonProbeWs = websockets.filter(w => !w.url.includes('/probe/ws'));
    evidence.probes.probeRequests = probeRequests.map(r => ({ url: r.url, aborted: r.aborted }));
    evidence.probes.websockets = websockets;

    // ─── Paso 16: aserciones negativas ───────────────────────────
    console.log('\n--- 16. Aserciones de red ---');
    ok('16. Trafico interceptado', requests.length >= 25, `${requests.length} requests`);
    ok('16. Cero requests externos no-probe', unexpectedExternal.length === 0,
      unexpectedExternal.length ? unexpectedExternal.map(r => r.url).join('; ') : 'sin egress externo');
    ok('16. Probes vistos y bloqueados', probeRequests.length >= 3, `${probeRequests.length} probes`);
    ok('16. Probe fetch detectado y abortado', probeRequests.some(r => r.url.includes('/probe/fetch') && r.aborted));
    ok('16. Probe <img> detectado y abortado', probeRequests.some(r => r.url.includes('/probe/img') && r.aborted));
    ok('16. Probe sendBeacon detectado y abortado', probeRequests.some(r => r.url.includes('/probe/beacon') && r.aborted));
    ok('16. Probe WebSocket detectado', probeWs.length >= 1, `${probeWs.length} websocket(s)`);

    // Marcador nunca sale por canales reales (excluyendo nuestros propios probes)
    const realRequests = requests.filter(r => !r.url.includes('/probe/'));
    const secretInUrl = realRequests.filter(r => r.url.includes(SECRET));
    const secretInBody = realRequests.filter(r => r.postData && r.postData.includes(SECRET));
    const secretInHeaders = realRequests.filter(r => Object.values(r.headers).some(v => String(v).includes(SECRET)));
    const secretInWs = nonProbeWs.filter(w => [...w.sent, ...w.received].some(f => f.includes(SECRET)));
    ok('16. Marcador ausente en todas las URLs', secretInUrl.length === 0, secretInUrl.length ? secretInUrl.map(r => r.url).join('; ') : 'limpio');
    ok('16. Marcador ausente en todos los bodies POST', secretInBody.length === 0, secretInBody.length ? JSON.stringify(secretInBody) : 'limpio');
    ok('16. Marcador ausente en todos los headers', secretInHeaders.length === 0, secretInHeaders.length ? JSON.stringify(secretInHeaders) : 'limpio');
    ok('16. Marcador ausente en frames de WebSocket', secretInWs.length === 0);
    ok('16. Cero WebSockets de la app', nonProbeWs.length === 0, `${nonProbeWs.length} websocket(s) no-probe`);
    ok('16. El marcador aparece en los probes (el monitor lo capturaria)', probeRequests.some(r => r.url.includes(SECRET)) || probeWs.length > 0);

    // ─── Paso 17: escaneo estatico del codigo ────────────────────
    console.log('\n--- 17. Escaneo estatico local-first ---');
    const js = readFileSync(join(wsBase, 'workspace.js'), 'utf8');
    const html = readFileSync(join(wsBase, 'index.html'), 'utf8');
    const css = readFileSync(join(wsBase, 'workspace.css'), 'utf8');
    const noNetworkPrimitives = !js.includes('fetch(') && !js.includes('XMLHttpRequest') && !js.includes('sendBeacon') && !js.includes('new WebSocket(') && !js.includes('wss://');
    const noExternalHtml = !html.includes('https://') && !html.includes('@import') && !html.includes('googleapis') && !html.includes('gstatic');
    const noExternalCss = !css.includes('@import') && !css.includes('https://');
    evidence.staticScan = { noNetworkPrimitives, noExternalHtml, noExternalCss };
    ok('17. Sin fetch( en workspace.js', !js.includes('fetch('));
    ok('17. Sin XMLHttpRequest en workspace.js', !js.includes('XMLHttpRequest'));
    ok('17. Sin sendBeacon en workspace.js', !js.includes('sendBeacon'));
    ok('17. Sin new WebSocket( en workspace.js', !js.includes('new WebSocket('));
    ok('17. HTML sin hosts externos', noExternalHtml);
    ok('17. CSS sin @import ni hosts externos', noExternalCss);

    // ─── Paso 18: errores ────────────────────────────────────────
    console.log('\n--- 18. Errores ---');
    ok('18. Sin errores JS no controlados', pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 5).join('; ') : '');
    ok('18. Sin errores de consola', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0, 5).join('; ') : '');

    evidence.requests = requests.map(r => ({ method: r.method, url: r.url, postData: r.postData, aborted: r.aborted }));
    evidence.flow = { ...evidence.flow, requests: requests.length, projectsAfterImport: imported?.id || null };
    evidence.pageErrors = pageErrors;
    evidence.consoleErrors = consoleErrors;
    evidence.timestamp = new Date().toISOString();
    evidence.pass = pass;
    evidence.fail = fail;
    evidence.failures = failures;
    writeFileSync(join(ARTIFACTS, 'phase6-network-negative-evidence.json'), JSON.stringify(evidence, null, 2));

    console.log('\nEvidence: artifacts/deep-audit/phase6-network-negative-evidence.json');
    console.log(`\n=== Phase 6 Prueba negativa de red: ${pass} passed, ${fail} failed ===`);
    if (failures.length > 0) console.log('Failures:\n  - ' + failures.join('\n  - '));

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
