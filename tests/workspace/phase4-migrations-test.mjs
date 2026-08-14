#!/usr/bin/env node
/**
 * Phase 4a — Migraciones de IndexedDB (WSP-011)
 *
 * Demuestra el contrato de migración de toolisto-workspace:
 *  1. Plan de migración explícito v1 -> v2 -> v3 con etiquetas.
 *  2. Instalación limpia (v0) construye v3 con los 8 stores.
 *  3. Fixture v1 (datos reales) migra a v3 sin pérdida.
 *  4. Fixture v2 (con assets) migra a v3 preservando activos.
 *  5. Copia de seguridad y recuperación (backupDatabase/restoreDatabase).
 *  6. Rollback ante una migración fallida: la base revierte a la versión
 *     anterior con los datos intactos (upgrade transaccional de IDB).
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
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

const FIXTURE_V1 = {
  projects: { id: 'proj-v1', name: 'Proyecto legado v1', updatedAt: 1000 },
  documents: { id: 'doc-v1', projectId: 'proj-v1', title: 'Documento v1' },
  data: { id: 'tab-v1', projectId: 'proj-v1', name: 'Tabla v1', headers: ['A', 'B'], rows: [['1', '2']] },
  captures: { id: 'cap-v1', projectId: 'proj-v1', filename: 'scan.png' },
  settings: { key: 'theme', value: 'light' },
};

async function createFixtureV1(page) {
  return page.evaluate(async (seed) => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await new Promise((r, j) => {
      const q = indexedDB.open('toolisto-workspace', 1);
      q.onupgradeneeded = (e) => {
        const d = e.target.result;
        const ps = d.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('updatedAt', 'updatedAt');
        ps.createIndex('name', 'name');
        const ds = d.createObjectStore('documents', { keyPath: 'id' });
        ds.createIndex('projectId', 'projectId');
        const dt = d.createObjectStore('data', { keyPath: 'id' });
        dt.createIndex('projectId', 'projectId');
        const cs = d.createObjectStore('captures', { keyPath: 'id' });
        cs.createIndex('projectId', 'projectId');
        cs.createIndex('docId', 'docId');
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      q.onsuccess = () => r(q.result);
      q.onerror = () => j(q.error);
    });
    const stores = Array.from(db.objectStoreNames);
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('projects').put(seed.projects);
    tx.objectStore('documents').put(seed.documents);
    tx.objectStore('data').put(seed.data);
    tx.objectStore('captures').put(seed.captures);
    tx.objectStore('settings').put(seed.settings);
    await new Promise(r => { tx.oncomplete = r; });
    db.close();
    return stores;
  }, FIXTURE_V1);
}

async function createFixtureV2(page) {
  return page.evaluate(async (seed) => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await new Promise((r, j) => {
      const q = indexedDB.open('toolisto-workspace', 2);
      q.onupgradeneeded = (e) => {
        const d = e.target.result;
        const ps = d.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('updatedAt', 'updatedAt');
        ps.createIndex('name', 'name');
        const ds = d.createObjectStore('documents', { keyPath: 'id' });
        ds.createIndex('projectId', 'projectId');
        const dt = d.createObjectStore('data', { keyPath: 'id' });
        dt.createIndex('projectId', 'projectId');
        const cs = d.createObjectStore('captures', { keyPath: 'id' });
        cs.createIndex('projectId', 'projectId');
        cs.createIndex('docId', 'docId');
        d.createObjectStore('settings', { keyPath: 'key' });
        const as = d.createObjectStore('assets', { keyPath: 'id' });
        as.createIndex('projectId', 'projectId');
        as.createIndex('type', 'type');
        as.createIndex('sourceAssetId', 'sourceAssetId');
      };
      q.onsuccess = () => r(q.result);
      q.onerror = () => j(q.error);
    });
    const stores = Array.from(db.objectStoreNames);
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('projects').put(seed.projects);
    tx.objectStore('documents').put(seed.documents);
    tx.objectStore('data').put(seed.data);
    tx.objectStore('captures').put(seed.captures);
    tx.objectStore('settings').put(seed.settings);
    tx.objectStore('assets').put({ id: 'asset-v2', projectId: 'proj-v1', type: 'chart', sourceAssetId: 'tab-v1' });
    await new Promise(r => { tx.oncomplete = r; });
    db.close();
    return stores;
  }, FIXTURE_V1);
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log('\n=== Phase 4a: Migraciones IndexedDB ===');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}/workspace/core/db.js`);

  const jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  // ─── 1. Contrato de migración ─────────────────────────────────
  console.log('\n--- 1. Plan de migracion ---');
  const plan = await page.evaluate(async () => {
    const mig = await import('/workspace/core/migrations.js');
    return mig.getMigrationPlan();
  });
  ok('1. Tres pasos de migracion', plan.length === 3, `${plan.length} pasos`);
  ok('1. v1 desde 0', plan[0]?.version === 1 && plan[0]?.from === 0 && plan[0]?.to === 1);
  ok('1. v2 desde 1', plan[1]?.version === 2 && plan[1]?.from === 1 && plan[1]?.to === 2);
  ok('1. v3 desde 2', plan[2]?.version === 3 && plan[2]?.from === 2 && plan[2]?.to === 3);
  ok('1. Pasos etiquetados', plan.every(p => typeof p.label === 'string' && p.label.length > 3));

  // ─── 2. Instalación limpia ────────────────────────────────────
  console.log('\n--- 2. Instalacion limpia (v0 -> v3) ---');
  const clean = await page.evaluate(async () => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace-backup');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const mig = await import('/workspace/core/migrations.js');
    return mig.getSchemaInfo();
  });
  ok('2. Version 3', clean.version === 3, `version=${clean.version}`);
  ok('2. Ocho stores', clean.stores.length === 8, `${clean.stores.length} stores`);

  // ─── 3. Fixture v1 → v3 ───────────────────────────────────────
  console.log('\n--- 3. Fixture v1 migra a v3 sin perdida ---');
  const v1Stores = await createFixtureV1(page);
  ok('3. Fixture v1 creado (5 stores)', v1Stores.length === 5, v1Stores.join(','));
  const migV1 = await page.evaluate(async () => {
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const mig = await import('/workspace/core/migrations.js');
    const info = await mig.getSchemaInfo();
    const counts = {};
    for (const s of info.stores) {
      const d = await new Promise((r, j) => {
        const q = indexedDB.open(info.name);
        q.onsuccess = () => { const db2 = q.result; const tx = db2.transaction(s, 'readonly'); const req = tx.objectStore(s).count(); req.onsuccess = () => { counts[s] = req.result; db2.close(); r(); }; req.onerror = () => j(req.error); };
        q.onerror = () => j(q.error);
      });
    }
    const project = await new Promise((r, j) => {
      const q = indexedDB.open(info.name);
      q.onsuccess = () => { const db2 = q.result; const req = db2.transaction('projects', 'readonly').objectStore('projects').get('proj-v1'); req.onsuccess = () => { const v = req.result; db2.close(); r(v); }; req.onerror = () => j(req.error); };
      q.onerror = () => j(q.error);
    });
    return { info, counts, project };
  });
  ok('3. Migrado a v3', migV1.info.version === 3, `version=${migV1.info.version}`);
  ok('3. Ocho stores tras migrar', migV1.info.stores.length === 8);
  ok('3. Proyecto preservado', migV1.project?.name === 'Proyecto legado v1', migV1.project?.name);
  ok('3. project count = 1', migV1.counts.projects === 1, `count=${migV1.counts.projects}`);
  ok('3. document count = 1', migV1.counts.documents === 1);
  ok('3. data count = 1', migV1.counts.data === 1);
  ok('3. capture count = 1', migV1.counts.captures === 1);
  ok('3. setting count = 1', migV1.counts.settings === 1);
  ok('3. assets nuevo (0)', migV1.counts.assets === 0);

  // ─── 4. Fixture v2 → v3 ───────────────────────────────────────
  console.log('\n--- 4. Fixture v2 migra a v3 preservando assets ---');
  const v2Stores = await createFixtureV2(page);
  ok('4. Fixture v2 creado (6 stores)', v2Stores.length === 6, v2Stores.join(','));
  const migV2 = await page.evaluate(async () => {
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const mig = await import('/workspace/core/migrations.js');
    const info = await mig.getSchemaInfo();
    const asset = await new Promise((r, j) => {
      const q = indexedDB.open(info.name);
      q.onsuccess = () => { const db2 = q.result; const req = db2.transaction('assets', 'readonly').objectStore('assets').get('asset-v2'); req.onsuccess = () => { const v = req.result; db2.close(); r(v); }; req.onerror = () => j(req.error); };
      q.onerror = () => j(q.error);
    });
    const executions = await new Promise((r, j) => {
      const q = indexedDB.open(info.name);
      q.onsuccess = () => { const db2 = q.result; const req = db2.transaction('executions', 'readonly').objectStore('executions').count(); req.onsuccess = () => { const v = req.result; db2.close(); r(v); }; req.onerror = () => j(req.error); };
      q.onerror = () => j(q.error);
    });
    return { info, asset, executions };
  });
  ok('4. Migrado a v3', migV2.info.version === 3, `version=${migV2.info.version}`);
  ok('4. Ocho stores tras migrar', migV2.info.stores.length === 8);
  ok('4. Asset preservado', migV2.asset?.type === 'chart' && migV2.asset?.sourceAssetId === 'tab-v1');
  ok('4. Executions nuevo (0)', migV2.executions === 0);

  // ─── 5. Backup y recuperación ─────────────────────────────────
  console.log('\n--- 5. Copia de seguridad y recuperacion ---');
  const backup = await page.evaluate(async () => {
    const mig = await import('/workspace/core/migrations.js');
    const b = await mig.backupDatabase();
    return { name: b.backupName, version: b.version, stores: b.stores };
  });
  ok('5. Backup creado con los 8 stores', backup.stores.length === 8, `stores=${backup.stores.length}`);
  ok('5. Backup en version 3', backup.version === 3);
  const restore = await page.evaluate(async () => {
    const mig = await import('/workspace/core/migrations.js');
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    await db.openDB();
    const res = await mig.restoreDatabase();
    const info = await mig.getSchemaInfo();
    const project = await new Promise((r, j) => {
      const q = indexedDB.open(info.name);
      q.onsuccess = () => { const db2 = q.result; const req = db2.transaction('projects', 'readonly').objectStore('projects').get('proj-v1'); req.onsuccess = () => { const v = req.result; db2.close(); r(v); }; req.onerror = () => j(req.error); };
      q.onerror = () => j(q.error);
    });
    return { res, info, project };
  });
  ok('5. Restauracion reportada', restore.res?.restored === true);
  ok('5. Datos recuperados tras borrar', restore.project?.name === 'Proyecto legado v1', restore.project?.name);
  ok('5. Esquema restaurado a v3', restore.info.version === 3);

  // ─── 6. Rollback ante migración fallida ───────────────────────
  console.log('\n--- 6. Rollback ante migracion fallida ---');
  const v1Again = await createFixtureV1(page);
  ok('6. Fixture v1 recreado', v1Again.length === 5);
  const rollback = await page.evaluate(async () => {
    const mig = await import('/workspace/core/migrations.js');
    let upgradeError = null;
    let upgradeSucceeded = false;
    try {
      await new Promise((resolve, reject) => {
        const q = indexedDB.open('toolisto-workspace', 3);
        q.onupgradeneeded = (e) => {
          mig.applyPlan(e.target.result, e.oldVersion, {
            2: { run: () => { throw new Error('fallo deliberado de migracion'); } },
            3: { run: () => {} },
          });
          upgradeSucceeded = true;
        };
        q.onsuccess = () => resolve();
        q.onerror = () => reject(q.error || new Error('upgrade abortado'));
      });
    } catch (e) {
      upgradeError = e.message;
    }
    const info = await new Promise((resolve, reject) => {
      const q = indexedDB.open('toolisto-workspace');
      q.onsuccess = () => {
        const d = q.result;
        const out = { version: d.version, stores: Array.from(d.objectStoreNames) };
        const tx = d.transaction('projects', 'readonly');
        const req = tx.objectStore('projects').get('proj-v1');
        req.onsuccess = () => { out.project = req.result; d.close(); resolve(out); };
        req.onerror = () => { out.project = null; d.close(); resolve(out); };
      };
      q.onerror = () => reject(q.error);
    });
    return { upgradeError, upgradeSucceeded, info };
  });
  ok('6. Migracion fallida lanzo error', !!rollback.upgradeError && !rollback.upgradeSucceeded, rollback.upgradeError);
  ok('6. Base revertida a v1', rollback.info.version === 1, `version=${rollback.info.version}`);
  ok('6. Solo stores v1 tras rollback', rollback.info.stores.length === 5, rollback.info.stores.join(','));
  ok('6. Datos intactos tras rollback', rollback.info.project?.name === 'Proyecto legado v1', rollback.info.project?.name);

  // ─── Resumen ──────────────────────────────────────────────────
  console.log('\n--- Errores ---');
  const unexpectedPageErrors = pageErrors.filter(e => !e.includes('fallo deliberado'));
  ok('No page errors (salvo el deliberado)', unexpectedPageErrors.length === 0, unexpectedPageErrors.join(' | '));
  ok('No console errors', jsErrors.length === 0, jsErrors.join(' | '));

  const dur = Date.now() - 0;
  console.log(`\n=== Phase 4a Migraciones: ${pass} passed, ${fail} failed ===`);

  await browser.close();
  await stopServer();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
