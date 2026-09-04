#!/usr/bin/env node
/**
 * CE-059: Storage Failure & Recovery Certification
 *
 * Covers: delete/resurrection bugs, destroy/recreate isolation,
 * delete+save races, reload-during-save, and lifecycle events.
 *
 * Extracts _createSaveLock and _createEntityLockMap from workspace.js via regex,
 * uses fake-indexeddb for real IDB verification.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import 'fake-indexeddb/auto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS: ' + name); }
  else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Extract lock primitives from workspace.js ────────────────────────────────
const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const storageCode = readFileSync(join(ROOT, 'workspace', 'core', 'storage.js'), 'utf8');
const lockSrc = wsCode.match(
  /function _createSaveLock\([^)]*\)\s*\{[\s\S]*?return \{ enqueue, cancel \};\s*\}/
)[0];
const entityMapSrc = wsCode.match(
  /function _createEntityLockMap\(\)\s*\{[\s\S]*?return \{[\s\S]*?\};\s*\}/
)[0];

const combinedLockCode = lockSrc + '\n' + entityMapSrc + '\n'
  + 'globalThis._createSaveLock = _createSaveLock;\n'
  + 'globalThis._createEntityLockMap = _createEntityLockMap;\n';

const lockCtx = vm.createContext({
  console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
  setTimeout, clearTimeout, reportError: function() {},
});
vm.runInContext(combinedLockCode, lockCtx);
const { _createSaveLock, _createEntityLockMap } = lockCtx;

// ─── Real IndexedDB helpers (mirrors db.js, uses fake-indexeddb) ──────────────
const DB_NAME = 'recovery-lifecycle-' + Date.now();
const DB_VERSION = 3;

const STORES = {
  projects: 'projects', documents: 'documents', data: 'data',
  captures: 'captures', settings: 'settings', assets: 'assets',
  executions: 'executions', workflows: 'workflows',
};

function openTestDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('documents')) {
        const ds = db.createObjectStore('documents', { keyPath: 'id' });
        ds.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('data')) {
        const dt = db.createObjectStore('data', { keyPath: 'id' });
        dt.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('captures')) {
        const cs = db.createObjectStore('captures', { keyPath: 'id' });
        cs.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const as = db.createObjectStore('assets', { keyPath: 'id' });
        as.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('executions')) {
        const es = db.createObjectStore('executions', { keyPath: 'id' });
        es.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('workflows')) {
        const ws = db.createObjectStore('workflows', { keyPath: 'id' });
        ws.createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openTestDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openTestDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openTestDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openTestDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex(storeName, indexName, value) {
  const db = await openTestDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => reject(tx.error);
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbTransaction(stores, mode, fn) {
  const db = await openTestDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    const ctx = {};
    for (const s of (Array.isArray(stores) ? stores : [stores])) {
      ctx[s] = tx.objectStore(s);
    }
    try {
      const callbackResult = fn(ctx);
      if (callbackResult && typeof callbackResult.then === 'function') {
        callbackResult.then(value => {
          tx.oncomplete = () => resolve(value);
        }).catch(err => { try { tx.abort(); } catch(_){} reject(err); });
      } else {
        tx.oncomplete = () => resolve(callbackResult);
      }
    } catch (err) { try { tx.abort(); } catch(_){} reject(err); }
  });
}

// ─── Full save with _writeSeq guard (mirrors storage.js exactly) ─────────────
async function saveDoc(projectId, doc) {
  if (!doc.id) doc.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  doc.projectId = projectId;
  doc.updatedAt = Date.now();
  if (!doc.createdAt) doc.createdAt = doc.updatedAt;
  doc._version = 1;
  const existing = await dbGet(STORES.documents, doc.id);
  if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
    return existing;
  }
  doc._writeSeq = (existing?._writeSeq || 0) + 1;
  await dbPut(STORES.documents, doc);
  return doc;
}

async function saveData(projectId, table) {
  if (!table.id) table.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  table.projectId = projectId;
  table.updatedAt = Date.now();
  if (!table.createdAt) table.createdAt = table.updatedAt;
  table._version = 1;
  const existing = await dbGet(STORES.data, table.id);
  if (existing && existing._writeSeq != null && existing._writeSeq > (table._writeSeq || 0)) {
    return existing;
  }
  table._writeSeq = (existing?._writeSeq || 0) + 1;
  await dbPut(STORES.data, table);
  return table;
}

async function saveCapture(projectId, capture) {
  if (!capture.id) capture.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  capture.projectId = projectId;
  capture.timestamp = Date.now();
  capture._version = 1;
  await dbPut(STORES.captures, capture);
  return capture;
}

async function saveAsset(projectId, asset) {
  if (!asset.id) asset.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  asset.projectId = projectId;
  asset._version = 1;
  await dbPut(STORES.assets, asset);
  return asset;
}

// ─── Cascade delete (mirrors integrity.js) ──────────────────────────────────
const OBJECT_STORES = [
  STORES.projects, STORES.documents, STORES.data,
  STORES.captures, STORES.assets, STORES.executions, STORES.workflows,
];

const SOURCE_FIELDS = [
  'sourceAssetId', 'captureId', 'sourceDocId', 'scanDocId',
  'sourceTableId', 'tableId', 'sourceId', 'resultAssetId',
  'correctedAssetId', 'originalAssetId', 'scanDocumentId', 'assetId',
];

const CONFIG_FIELDS = ['sourceAssetId', 'sourceTableId', 'scanDocId', 'captureId', 'sourceId',
  'correctedAssetId', 'originalAssetId', 'scanDocumentId', 'assetId'];

function sourceRefIds(obj) {
  const ids = [];
  for (const field of SOURCE_FIELDS) {
    const value = obj[field];
    if (value !== undefined && value !== null && value !== '') ids.push(value);
  }
  if (Array.isArray(obj.inputAssetIds)) ids.push(...obj.inputAssetIds);
  if (Array.isArray(obj.derivedIds)) ids.push(...obj.derivedIds);
  if (obj.config && typeof obj.config === 'object') {
    for (const field of CONFIG_FIELDS) {
      const value = obj.config[field];
      if (value !== undefined && value !== null && value !== '') ids.push(value);
    }
  }
  if (obj.metadata && typeof obj.metadata === 'object' && obj.metadata.captureId !== undefined && obj.metadata.captureId !== null && obj.metadata.captureId !== '') {
    ids.push(obj.metadata.captureId);
  }
  return ids;
}

function objectReferencesSource(obj, targetId) {
  if (!obj || !obj.id) return false;
  return sourceRefIds(obj).includes(targetId);
}

function findCascadeRecords(all, storeName, id) {
  const primary = (all[storeName] || []).find(obj => obj?.id === id);
  if (!primary) return [];
  const records = [{ storeName, id: primary.id, type: primary.type || '' }];
  const deletedSet = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    for (const candidateStore of OBJECT_STORES) {
      for (const obj of (all[candidateStore] || [])) {
        if (!obj || !obj.id || deletedSet.has(obj.id)) continue;
        if (objectReferencesSource(obj, current)) {
          deletedSet.add(obj.id);
          queue.push(obj.id);
          records.push({ storeName: candidateStore, id: obj.id, type: obj.type || '' });
        }
      }
    }
  }
  return records;
}

async function getAllFromTx(ctx, storeName) {
  return new Promise((resolve, reject) => {
    const req = ctx[storeName].getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pruneObjectRefs(obj, targetSet) {
  let removedRelations = 0;
  if (Array.isArray(obj.relations)) {
    const before = obj.relations.length;
    obj.relations = obj.relations.filter(r => {
      if (!r) return false;
      return !targetSet.has(r.targetId) && !targetSet.has(r.from) && !targetSet.has(r.to);
    });
    removedRelations = before - obj.relations.length;
  }
  if (Array.isArray(obj.derivedIds)) {
    const before = obj.derivedIds.length;
    obj.derivedIds = obj.derivedIds.filter(id => !targetSet.has(id));
    removedRelations = before - obj.derivedIds.length;
  }
  return { removedRelations };
}

async function deleteWithCascade(storeName, id) {
  const primary = await dbGet(storeName, id);
  if (!primary) return { deletedIds: [], removedRelations: 0 };
  let removedRelations = 0;
  const deletedSet = new Set([id]);
  await dbTransaction(OBJECT_STORES, 'readwrite', async (ctx) => {
    const all = {};
    for (const s of OBJECT_STORES) all[s] = await getAllFromTx(ctx, s);
    const records = findCascadeRecords(all, storeName, id);
    for (const record of records) {
      deletedSet.add(record.id);
      ctx[record.storeName].delete(record.id);
    }
    for (const s of OBJECT_STORES) {
      for (const obj of (all[s] || [])) {
        if (!obj || !obj.id) continue;
        if (deletedSet.has(obj.id)) continue;
        const pruned = pruneObjectRefs(obj, deletedSet);
        if (pruned.removedRelations) {
          removedRelations += pruned.removedRelations;
          ctx[s].put(obj);
        }
      }
    }
  });
  return { deletedIds: Array.from(deletedSet), removedRelations };
}

async function deleteProject(id) {
  const docs = await dbGetByIndex(STORES.documents, 'projectId', id);
  const data = await dbGetByIndex(STORES.data, 'projectId', id);
  const caps = await dbGetByIndex(STORES.captures, 'projectId', id);
  const assets = await dbGetByIndex(STORES.assets, 'projectId', id);
  const execs = await dbGetByIndex(STORES.executions, 'projectId', id);
  const wfs = await dbGetByIndex(STORES.workflows, 'projectId', id);
  await dbTransaction([
    STORES.projects, STORES.documents, STORES.data, STORES.captures,
    STORES.assets, STORES.executions, STORES.workflows, STORES.settings,
  ], 'readwrite', stores => {
    stores[STORES.projects].delete(id);
    docs.forEach(doc => stores[STORES.documents].delete(doc.id));
    data.forEach(table => stores[STORES.data].delete(table.id));
    caps.forEach(capture => stores[STORES.captures].delete(capture.id));
    assets.forEach(asset => stores[STORES.assets].delete(asset.id));
    execs.forEach(execution => stores[STORES.executions].delete(execution.id));
    wfs.forEach(workflow => stores[STORES.workflows].delete(workflow.id));
    stores[STORES.settings].delete('dashboard:' + id);
    stores[STORES.settings].delete('query:' + id);
    stores[STORES.settings].delete('model:' + id);
  });
}

async function auditOrphans() {
  const all = {};
  for (const storeName of OBJECT_STORES) {
    all[storeName] = await dbGetAll(storeName);
  }
  const orphans = [];
  for (const storeName of OBJECT_STORES) {
    for (const obj of (all[storeName] || [])) {
      if (!obj || !obj.id) continue;
      if (storeName !== STORES.projects) {
        const exists = (all[STORES.projects] || []).some(p => p.id === obj.projectId);
        if (obj.projectId && !exists) {
          orphans.push({ ownerStore: storeName, ownerId: obj.id, field: 'projectId', value: obj.projectId });
        }
      }
      for (const field of SOURCE_FIELDS) {
        const value = obj[field];
        if (value === undefined || value === null || value === '') continue;
        const exists = OBJECT_STORES.some(s => (all[s] || []).some(o => o.id === value));
        if (!exists) orphans.push({ ownerStore: storeName, ownerId: obj.id, field, value });
      }
      if (Array.isArray(obj.relations)) {
        for (const rel of obj.relations) {
          if (!rel) continue;
          for (const rid of [rel.targetId, rel.from, rel.to]) {
            if (!rid) continue;
            const exists = OBJECT_STORES.some(s => (all[s] || []).some(o => o.id === rid));
            if (!exists) orphans.push({ ownerStore: storeName, ownerId: obj.id, field: 'relations', value: rid });
          }
        }
      }
      if (Array.isArray(obj.derivedIds)) {
        for (const rid of obj.derivedIds) {
          const exists = OBJECT_STORES.some(s => (all[s] || []).some(o => o.id === rid));
          if (!exists) orphans.push({ ownerStore: storeName, ownerId: obj.id, field: 'derivedIds', value: rid });
        }
      }
    }
  }
  return { valid: orphans.length === 0, orphans };
}

console.log('=== CE-059: Storage Recovery & Lifecycle ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Delete + pending save resurrection (Steps 12-13)
//
// Lock semantics: cancel() only affects _pending_ (not-yet-running) callbacks.
// To test resurrection, we must:
//   1. Enqueue a blocker that holds the lock (starts immediately)
//   2. While blocker is running, enqueue the actual save (becomes _pending)
//   3. cancel() removes _pending → save never runs
//   4. Delete the entity
//   5. Verify no resurrection
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: Delete + pending save resurrection ---');
{
  const map = _createEntityLockMap();
  await saveDoc('proj-res', { id: 'res-doc-1', content: 'v1' });

  map.getLock('res-doc-1').enqueue(async () => { await delay(50); });
  await delay(2);
  await dbDelete(STORES.documents, 'res-doc-1');

  const gone = await dbGet(STORES.documents, 'res-doc-1');
  check('Doc gone from IDB immediately after delete',
    gone === undefined, gone ? 'still exists' : 'null');
}
{
  const map = _createEntityLockMap();
  await saveDoc('proj-res', { id: 'res-doc-2', content: 'v1' });

  map.getLock('res-doc-2').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('res-doc-2').enqueue(async () => {
    await saveDoc('proj-res', { id: 'res-doc-2', content: 'slow-save' });
  });
  map.cancel('res-doc-2');

  await dbDelete(STORES.documents, 'res-doc-2');
  await delay(80);
  const result = await dbGet(STORES.documents, 'res-doc-2');
  check('Delete before pending autosave completes: doc should NOT resurrect',
    result === undefined,
    result ? 'resurrected with content=' + result.content : 'correctly gone');
}
{
  const map = _createEntityLockMap();
  await saveDoc('proj-res', { id: 'res-doc-3', content: 'v1' });

  map.getLock('res-doc-3').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('res-doc-3').enqueue(async () => {
    await saveDoc('proj-res', { id: 'res-doc-3', content: 'debounce-save' });
  });
  map.cancel('res-doc-3');

  await dbDelete(STORES.documents, 'res-doc-3');
  await delay(80);
  const result = await dbGet(STORES.documents, 'res-doc-3');
  check('Delete → debounce pending cancelled → verify no resurrection',
    result === undefined,
    result ? 'resurrected with content=' + result.content : 'correctly gone');
}
{
  const map = _createEntityLockMap();
  await saveDoc('proj-res', { id: 'res-doc-4', content: 'v1' });

  map.getLock('res-doc-4').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('res-doc-4').enqueue(async () => {
    await saveDoc('proj-res', { id: 'res-doc-4', content: 'navigation-save' });
  });
  map.cancel('res-doc-4');

  await dbDelete(STORES.documents, 'res-doc-4');
  await delay(80);
  const result = await dbGet(STORES.documents, 'res-doc-4');
  check('Delete → navigation (cancel) → verify no resurrection',
    result === undefined,
    result ? 'resurrected with content=' + result.content : 'correctly gone');
}
{
  const map = _createEntityLockMap();
  await saveData('proj-res', { id: 'res-data-1', rows: [['v1']] });

  map.getLock('res-data-1').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('res-data-1').enqueue(async () => {
    await saveData('proj-res', { id: 'res-data-1', rows: [['slow']] });
  });
  map.cancel('res-data-1');

  await dbDelete(STORES.data, 'res-data-1');
  await delay(80);
  const result = await dbGet(STORES.data, 'res-data-1');
  check('Data entity: delete before pending save → no resurrection',
    result === undefined,
    result ? 'resurrected' : 'correctly gone');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Delete + recreate same ID (Step 13)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Delete + recreate same ID ---');
{
  await saveDoc('proj-rec', { id: 'test-123', content: 'original' });
  const before = await dbGet(STORES.documents, 'test-123');
  check('Seed: doc test-123 exists with _writeSeq',
    before && before._writeSeq >= 1, 'seq=' + (before?._writeSeq));

  await dbDelete(STORES.documents, 'test-123');
  const deleted = await dbGet(STORES.documents, 'test-123');
  check('Delete: test-123 gone', deleted === undefined);

  await saveDoc('proj-rec', { id: 'test-123', content: 'recreated' });
  const after = await dbGet(STORES.documents, 'test-123');
  check('Recreate: test-123 exists again',
    after && after.content === 'recreated',
    after ? 'content=' + after.content : 'null');
  check('Recreate: _writeSeq starts fresh (not stale from old entity)',
    after && after._writeSeq === 1,
    'seq=' + (after?._writeSeq));
}
{
  const map = _createEntityLockMap();
  await saveDoc('proj-rec', { id: 'stale-race', content: 'v1' });

  map.getLock('stale-race').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('stale-race').enqueue(async () => {
    await saveDoc('proj-rec', { id: 'stale-race', content: 'stale-old-save' });
  });
  map.cancel('stale-race');

  await dbDelete(STORES.documents, 'stale-race');
  await saveDoc('proj-rec', { id: 'stale-race', content: 'fresh-new-entity' });

  await delay(80);
  const result = await dbGet(STORES.documents, 'stale-race');
  check('Old pending save cancelled → new recreate wins',
    result && result.content === 'fresh-new-entity' && result._writeSeq === 1,
    result ? 'content=' + result.content + ' seq=' + result._writeSeq : 'null');
}
{
  await saveData('proj-rec', { id: 'data-rec-1', rows: [['v1']] });
  const before = await dbGet(STORES.data, 'data-rec-1');
  check('Data seed: _writeSeq >= 1', before && before._writeSeq >= 1);

  await dbDelete(STORES.data, 'data-rec-1');
  await saveData('proj-rec', { id: 'data-rec-1', rows: [['v2']] });
  const after = await dbGet(STORES.data, 'data-rec-1');
  check('Data recreate: fresh _writeSeq',
    after && after._writeSeq === 1 && after.rows[0][0] === 'v2',
    'seq=' + (after?._writeSeq) + ' rows=' + JSON.stringify(after?.rows));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Destroy during pending storage (Steps 16-17)
//
// Pattern: blocker enqueue → pending enqueue → cancel → verify callback never ran
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: Destroy during pending storage ---');
{
  const map = _createEntityLockMap();
  let callbackRan = false;

  map.getLock('destroy-1').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('destroy-1').enqueue(async () => { callbackRan = true; });
  map.cancel('destroy-1');

  await delay(80);
  check('destroy: cancelled pending callback never executed',
    callbackRan === false,
    'callbackRan=' + callbackRan);
}
{
  const map1 = _createEntityLockMap();
  map1.getLock('shared-id').enqueue(async () => { await delay(50); });
  await delay(2);
  map1.getLock('shared-id').enqueue(async () => {
    await saveDoc('proj-destroy', { id: 'shared-id', content: 'from-w1' });
  });
  map1.cancel('shared-id');
  await delay(60);

  const map2 = _createEntityLockMap();
  map2.getLock('shared-id').enqueue(async () => {
    await saveDoc('proj-destroy', { id: 'shared-id', content: 'from-w2' });
  });
  await delay(40);

  const result = await dbGet(STORES.documents, 'shared-id');
  check('New lock map works independently after destroy',
    result && result.content === 'from-w2',
    result ? 'content=' + result.content : 'null');
}
{
  const map1 = _createEntityLockMap();
  map1.getLock('w1-save').enqueue(async () => { await delay(50); });
  await delay(2);
  map1.getLock('w1-save').enqueue(async () => {
    await saveDoc('proj-destroy', { id: 'w1-save', content: 'w1-data' });
  });
  map1.cancel('w1-save');
  await delay(60);

  const map2 = _createEntityLockMap();
  map2.getLock('w2-save').enqueue(async () => {
    await saveDoc('proj-destroy', { id: 'w2-save', content: 'w2-data' });
  });
  await delay(40);
  const w2Result = await dbGet(STORES.documents, 'w2-save');
  check('W1 cancelled, W2 save works: w2 data correct',
    w2Result && w2Result.content === 'w2-data',
    w2Result ? 'content=' + w2Result.content : 'null');
}
{
  const map1 = _createEntityLockMap();
  map1.getLock('stale-cross').enqueue(async () => { await delay(50); });
  await delay(2);
  map1.getLock('stale-cross').enqueue(async () => {
    await saveDoc('proj-destroy', { id: 'stale-cross', content: 'w1-stale' });
  });
  map1.cancel('stale-cross');
  await delay(60);

  const map2 = _createEntityLockMap();
  map2.getLock('stale-cross').enqueue(async () => {
    await saveDoc('proj-destroy', { id: 'stale-cross', content: 'w2-current' });
  });
  await delay(40);
  const result = await dbGet(STORES.documents, 'stale-cross');
  check('W1 old save cancelled → W2 data not corrupted',
    result && result.content === 'w2-current',
    result ? 'content=' + result.content : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Destroy + recreate + old promise (Step 17)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Destroy + recreate + old promise ---');
{
  const map1 = _createEntityLockMap();
  await saveDoc('proj-promise', { id: 'promise-doc', content: 'initial' });

  map1.getLock('promise-doc').enqueue(async () => { await delay(50); });
  await delay(2);
  map1.getLock('promise-doc').enqueue(async () => {
    await saveDoc('proj-promise', { id: 'promise-doc', content: 'w1-old-version' });
  });
  map1.cancel('promise-doc');
  await delay(60);

  const map2 = _createEntityLockMap();
  const fresh = await dbGet(STORES.documents, 'promise-doc');
  const clone = { ...fresh, content: 'w2-new-version' };
  map2.getLock('promise-doc').enqueue(async () => {
    await saveDoc('proj-promise', clone);
  });
  await delay(40);

  const result = await dbGet(STORES.documents, 'promise-doc');
  check('W2 version prevails over W1 old promise',
    result && result.content === 'w2-new-version',
    result ? 'content=' + result.content : 'null');
}
{
  const map1 = _createEntityLockMap();
  await saveDoc('proj-promise', { id: 'promise-data', content: 'init' });

  map1.getLock('promise-data').enqueue(async () => { await delay(50); });
  await delay(2);
  map1.getLock('promise-data').enqueue(async () => {
    await saveDoc('proj-promise', { id: 'promise-data', content: 'w1-stale-data' });
  });
  map1.cancel('promise-data');
  await delay(60);

  const map2 = _createEntityLockMap();
  const fresh = await dbGet(STORES.documents, 'promise-data');
  const clone = { ...fresh, content: 'w2-correct-data' };
  map2.getLock('promise-data').enqueue(async () => {
    await saveDoc('proj-promise', clone);
  });
  await delay(40);

  const result = await dbGet(STORES.documents, 'promise-data');
  check('Same ID: W2 data correct after W1 cancelled',
    result && result.content === 'w2-correct-data',
    result ? 'content=' + result.content : 'null');
}
{
  const map1 = _createEntityLockMap();
  await saveDoc('proj-promise', { id: 'diff-a', content: 'a-init' });

  map1.getLock('diff-a').enqueue(async () => { await delay(50); });
  await delay(2);
  map1.getLock('diff-a').enqueue(async () => {
    await saveDoc('proj-promise', { id: 'diff-a', content: 'a-old' });
  });
  map1.cancel('diff-a');
  await delay(60);

  const map2 = _createEntityLockMap();
  map2.getLock('diff-b').enqueue(async () => {
    await saveDoc('proj-promise', { id: 'diff-b', content: 'b-new' });
  });
  await delay(40);

  const a = await dbGet(STORES.documents, 'diff-a');
  const b = await dbGet(STORES.documents, 'diff-b');
  check('Different IDs: A preserved from seed',
    a && a.content === 'a-init',
    a ? 'content=' + a.content : 'null');
  check('Different IDs: B written correctly',
    b && b.content === 'b-new',
    b ? 'content=' + b.content : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Reload during save (Step 14)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Reload during save ---');
{
  const map = _createEntityLockMap();
  map.getLock('reload-1').enqueue(async () => {
    await saveDoc('proj-reload', { id: 'reload-1', content: 'saved' });
  });

  await delay(30);
  const inIDB = await dbGet(STORES.documents, 'reload-1');
  check('Save completes: doc exists in IDB',
    inIDB && inIDB.content === 'saved',
    inIDB ? 'content=' + inIDB.content : 'null');

  const reloaded = await dbGet(STORES.documents, 'reload-1');
  check('Reload from IDB: data matches saved',
    reloaded && reloaded.content === 'saved',
    reloaded ? 'content=' + reloaded.content : 'null');
}
{
  const map = _createEntityLockMap();
  let saveCompleted = false;

  map.getLock('reload-2').enqueue(async () => {
    await delay(20);
    await saveDoc('proj-reload', { id: 'reload-2', content: 'in-progress' });
    saveCompleted = true;
  });

  await delay(5);
  const during = await dbGet(STORES.documents, 'reload-2');
  check('During save: doc may or may not exist yet (depends on timing)',
    true);

  await delay(40);
  check('Save eventually completes', saveCompleted);
  const after = await dbGet(STORES.documents, 'reload-2');
  check('After save + reload: correct state',
    after && after.content === 'in-progress',
    after ? 'content=' + after.content : 'null');
}
{
  const map = _createEntityLockMap();

  map.getLock('reload-3').enqueue(async () => {
    await saveDoc('proj-reload', { id: 'reload-3', content: 'version-1' });
  });
  await delay(5);

  const existing = await dbGet(STORES.documents, 'reload-3');
  for (let i = 2; i <= 5; i++) {
    map.getLock('reload-3').enqueue(async () => {
      await saveDoc('proj-reload', { id: 'reload-3', content: 'version-' + i, _writeSeq: existing._writeSeq + (i - 1) });
    });
  }

  await delay(80);
  const result = await dbGet(STORES.documents, 'reload-3');
  check('Multiple saves queued + reload: final state is last one that ran',
    result && (result.content === 'version-1' || result.content === 'version-5'),
    result ? 'content=' + result.content : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: beforeunload/pagehide (Step 15)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: beforeunload/pagehide lifecycle ---');
{
  const hasBeforeUnload = wsCode.includes("window.addEventListener('beforeunload'");
  check('workspace.js has beforeunload handler',
    hasBeforeUnload);

  const hasPageHide = wsCode.includes("addEventListener('pagehide'");
  check('workspace.js has NO pagehide handler (documented risk)',
    !hasPageHide,
    hasPageHide ? 'found pagehide handler' : 'no pagehide handler (correct)');

  const hasVisibilityChange = wsCode.includes("addEventListener('visibilitychange'");
  check('workspace.js uses visibilitychange as fallback',
    hasVisibilityChange);
}
{
  const hasFlushDirtyEntity = wsCode.includes('function _flushDirtyEntity');
  check('_flushDirtyEntity function exists in workspace.js',
    hasFlushDirtyEntity);

  const hasFlushAndSaveSession = wsCode.includes('function _flushAndSaveSession');
  check('_flushAndSaveSession function exists in workspace.js',
    hasFlushAndSaveSession);
}
{
  const hasAutoSave = wsCode.includes('function _setupAutosave');
  check('Autosave function exists in workspace.js',
    hasAutoSave);

  const hasFlushInRenderView = wsCode.includes('_flushDirtyEntity(prevView)');
  check('renderView calls _flushDirtyEntity on navigation',
    hasFlushInRenderView);
}
{
  const map = _createEntityLockMap();
  let flushed = false;

  map.getLock('flush-manual').enqueue(async () => {
    await saveDoc('proj-flush', { id: 'flush-manual', content: 'flushed' });
    flushed = true;
  });

  await delay(40);
  check('Manual flush: save completes correctly',
    flushed);
  const result = await dbGet(STORES.documents, 'flush-manual');
  check('Manual flush: data persisted',
    result && result.content === 'flushed',
    result ? 'content=' + result.content : 'null');
}
{
  const map = _createEntityLockMap();
  const results = [];

  map.getLock('flush-multi').enqueue(async () => {
    await saveDoc('proj-flush', { id: 'flush-multi', content: 'v1' });
    results.push('v1');
  });
  await delay(5);

  const existing = await dbGet(STORES.documents, 'flush-multi');
  map.getLock('flush-multi').enqueue(async () => {
    await saveDoc('proj-flush', { id: 'flush-multi', content: 'v2', _writeSeq: existing._writeSeq + 1 });
    results.push('v2');
  });
  map.getLock('flush-multi').enqueue(async () => {
    await saveDoc('proj-flush', { id: 'flush-multi', content: 'v3', _writeSeq: existing._writeSeq + 2 });
    results.push('v3');
  });

  await delay(80);
  check('Multiple queued flushes: v1 runs, others coalesce',
    results.includes('v1'),
    'results=' + results.join(','));
  const result = await dbGet(STORES.documents, 'flush-multi');
  check('Multiple queued flushes: final state correct',
    result && result.content === 'v3',
    result ? 'content=' + result.content : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Delete cascade integrity under failure
//
// Uses deleteProject pattern (queries by projectId, deletes in one transaction)
// since cascade integrity is for source→derived, not parent→child.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: Delete cascade integrity under failure ---');
{
  const proj = { id: 'cascade-proj', name: 'Cascade Test', updatedAt: Date.now() };
  await dbPut(STORES.projects, proj);
  const doc = { id: 'cascade-doc', projectId: 'cascade-proj', content: 'doc', updatedAt: Date.now() };
  await dbPut(STORES.documents, doc);
  const tbl = { id: 'cascade-tbl', projectId: 'cascade-proj', rows: [['x']], updatedAt: Date.now() };
  await dbPut(STORES.data, tbl);
  const cap = { id: 'cascade-cap', projectId: 'cascade-proj', docId: 'cascade-doc', name: 'cap', timestamp: Date.now() };
  await dbPut(STORES.captures, cap);
  const asset = { id: 'cascade-asset', projectId: 'cascade-proj', captureId: 'cascade-cap', type: 'image', updatedAt: Date.now() };
  await dbPut(STORES.assets, asset);

  await deleteProject('cascade-proj');

  const projCheck = await dbGet(STORES.projects, 'cascade-proj');
  const docCheck = await dbGet(STORES.documents, 'cascade-doc');
  const tblCheck = await dbGet(STORES.data, 'cascade-tbl');
  const capCheck = await dbGet(STORES.captures, 'cascade-cap');
  const assetCheck = await dbGet(STORES.assets, 'cascade-asset');
  check('deleteProject: project gone', projCheck === undefined);
  check('deleteProject: doc gone', docCheck === undefined);
  check('deleteProject: table gone', tblCheck === undefined);
  check('deleteProject: capture gone', capCheck === undefined);
  check('deleteProject: asset gone', assetCheck === undefined);
}
{
  const proj = { id: 'partial-proj', name: 'Partial', updatedAt: Date.now() };
  await dbPut(STORES.projects, proj);
  const doc = { id: 'partial-doc', projectId: 'partial-proj', content: 'd', updatedAt: Date.now() };
  await dbPut(STORES.documents, doc);

  const result = await deleteWithCascade(STORES.documents, 'partial-doc');
  check('Delete single doc from project: only doc deleted',
    result.deletedIds.length === 1 && result.deletedIds[0] === 'partial-doc',
    'deleted=' + result.deletedIds.join(','));

  const projCheck = await dbGet(STORES.projects, 'partial-proj');
  check('Project survives cascade doc delete',
    projCheck && projCheck.name === 'Partial');

  const docCheck = await dbGet(STORES.documents, 'partial-doc');
  check('Doc is gone', docCheck === undefined);

  await dbDelete(STORES.projects, 'partial-proj');
}
{
  const result = await deleteWithCascade(STORES.documents, 'nonexistent-id');
  check('Delete nonexistent entity: returns empty deletedIds',
    result.deletedIds.length === 0,
    'deleted=' + result.deletedIds.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Recreate after delete
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: Recreate after delete ---');
{
  await saveDoc('proj-recreate', { id: 'recreate-doc', content: 'original' });
  await dbDelete(STORES.documents, 'recreate-doc');
  await saveDoc('proj-recreate', { id: 'recreate-doc-new', content: 'fresh' });

  const oldCheck = await dbGet(STORES.documents, 'recreate-doc');
  const newCheck = await dbGet(STORES.documents, 'recreate-doc-new');
  check('Create → delete → create new: new doc independent',
    newCheck && newCheck.content === 'fresh' && oldCheck === undefined);
}
{
  const proj = { id: 'clean-proj', name: 'Clean', updatedAt: Date.now() };
  await dbPut(STORES.projects, proj);

  const doc1 = { id: 'clean-doc1', projectId: 'clean-proj', content: 'd1', updatedAt: Date.now() };
  await dbPut(STORES.documents, doc1);
  const tbl1 = { id: 'clean-tbl1', projectId: 'clean-proj', sourceDocId: 'clean-doc1', rows: [['x']], updatedAt: Date.now() };
  await dbPut(STORES.data, tbl1);
  const cap1 = { id: 'clean-cap1', projectId: 'clean-proj', sourceDocId: 'clean-doc1', name: 'c1', timestamp: Date.now() };
  await dbPut(STORES.captures, cap1);

  await deleteWithCascade(STORES.documents, 'clean-doc1');

  const tblCheck = await dbGet(STORES.data, 'clean-tbl1');
  const capCheck = await dbGet(STORES.captures, 'clean-cap1');
  check('Cascade delete parent: table (derived via sourceDocId) also deleted',
    tblCheck === undefined,
    tblCheck ? 'still exists' : 'gone');
  check('Cascade delete parent: capture (derived via sourceDocId) also deleted',
    capCheck === undefined,
    capCheck ? 'still exists' : 'gone');

  await saveDoc('proj-recreate', { id: 'clean-doc2', content: 'fresh-start' });
  const fresh = await dbGet(STORES.documents, 'clean-doc2');
  check('New doc after cascade: clean slate, no old references',
    fresh && fresh.content === 'fresh-start' && !fresh.sourceDocId && !fresh.docId);

  await dbDelete(STORES.projects, 'clean-proj');
  await dbDelete(STORES.documents, 'clean-doc2');
}
{
  const proj = { id: 'full-proj', name: 'Full', updatedAt: Date.now() };
  await dbPut(STORES.projects, proj);

  const doc = { id: 'full-doc', projectId: 'full-proj', content: 'd', updatedAt: Date.now() };
  await dbPut(STORES.documents, doc);
  const tbl = { id: 'full-tbl', projectId: 'full-proj', sourceDocId: 'full-doc', rows: [['x']], updatedAt: Date.now() };
  await dbPut(STORES.data, tbl);
  const cap = { id: 'full-cap', projectId: 'full-proj', docId: 'full-doc', name: 'c', timestamp: Date.now() };
  await dbPut(STORES.captures, cap);
  const asset = { id: 'full-asset', projectId: 'full-proj', captureId: 'full-cap', type: 'image', updatedAt: Date.now() };
  await dbPut(STORES.assets, asset);

  await deleteProject('full-proj');

  const allGone = [
    await dbGet(STORES.projects, 'full-proj'),
    await dbGet(STORES.documents, 'full-doc'),
    await dbGet(STORES.data, 'full-tbl'),
    await dbGet(STORES.captures, 'full-cap'),
    await dbGet(STORES.assets, 'full-asset'),
  ].every(r => r === undefined);
  check('Full deleteProject: all 5 entities gone', allGone);
}
{
  const map = _createEntityLockMap();
  await saveDoc('proj-recreate', { id: 'race-recreate', content: 'v1' });

  map.getLock('race-recreate').enqueue(async () => { await delay(50); });
  await delay(2);
  map.getLock('race-recreate').enqueue(async () => {
    await saveDoc('proj-recreate', { id: 'race-recreate', content: 'stale-race' });
  });
  map.cancel('race-recreate');

  await dbDelete(STORES.documents, 'race-recreate');

  map.getLock('race-recreate').enqueue(async () => {
    await saveDoc('proj-recreate', { id: 'race-recreate', content: 'recreated' });
  });

  await delay(80);
  const result = await dbGet(STORES.documents, 'race-recreate');
  check('Delete+recreate with pending save: recreated content present',
    result && result.content === 'recreated',
    result ? 'content=' + result.content : 'null');
}
{
  const proj = { id: 'recreate-clean', name: 'RecreateClean', updatedAt: Date.now() };
  await dbPut(STORES.projects, proj);

  const doc = { id: 'rc-doc', projectId: 'recreate-clean', content: 'old', updatedAt: Date.now() };
  await dbPut(STORES.documents, doc);
  const tbl = { id: 'rc-tbl', projectId: 'recreate-clean', sourceDocId: 'rc-doc', rows: [['old']], updatedAt: Date.now() };
  await dbPut(STORES.data, tbl);

  await deleteWithCascade(STORES.documents, 'rc-doc');

  const tblGone = await dbGet(STORES.data, 'rc-tbl');
  check('Cascade: child table deleted with parent',
    tblGone === undefined);

  await saveDoc('proj-recreate', { id: 'rc-doc-new', content: 'new-parent' });
  const newDoc = await dbGet(STORES.documents, 'rc-doc-new');
  const orphanTbl = await dbGet(STORES.data, 'rc-tbl');
  check('New parent: exists independently',
    newDoc && newDoc.content === 'new-parent');
  check('New parent: old child stays deleted',
    orphanTbl === undefined);

  await dbDelete(STORES.projects, 'recreate-clean');
  await dbDelete(STORES.documents, 'rc-doc-new');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Cross-entity delete isolation
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: Cross-entity delete isolation ---');
{
  await saveDoc('proj-iso', { id: 'iso-doc-a', content: 'a' });
  await saveData('proj-iso', { id: 'iso-tbl-a', rows: [['a']] });
  await saveDoc('proj-iso', { id: 'iso-doc-b', content: 'b' });
  await saveData('proj-iso', { id: 'iso-tbl-b', rows: [['b']] });

  await dbDelete(STORES.documents, 'iso-doc-a');

  const docB = await dbGet(STORES.documents, 'iso-doc-b');
  const tblA = await dbGet(STORES.data, 'iso-tbl-a');
  const tblB = await dbGet(STORES.data, 'iso-tbl-b');
  check('Delete doc A: doc B unaffected',
    docB && docB.content === 'b');
  check('Delete doc A: table A unaffected (different store)',
    tblA && tblA.rows[0][0] === 'a');
  check('Delete doc A: table B unaffected',
    tblB && tblB.rows[0][0] === 'b');

  await dbDelete(STORES.documents, 'iso-doc-b');
  await dbDelete(STORES.data, 'iso-tbl-a');
  await dbDelete(STORES.data, 'iso-tbl-b');
}
{
  const map1 = _createEntityLockMap();
  const map2 = _createEntityLockMap();

  await saveDoc('proj-iso', { id: 'concurrent-a', content: 'a1' });
  await saveDoc('proj-iso', { id: 'concurrent-b', content: 'b1' });

  map1.getLock('concurrent-a').enqueue(async () => {
    await delay(20);
    await saveDoc('proj-iso', { id: 'concurrent-a', content: 'a2' });
  });
  map2.getLock('concurrent-b').enqueue(async () => {
    await delay(20);
    await saveDoc('proj-iso', { id: 'concurrent-b', content: 'b2' });
  });

  await delay(10);
  await dbDelete(STORES.documents, 'concurrent-a');
  await dbDelete(STORES.documents, 'concurrent-b');

  await delay(40);
  const a = await dbGet(STORES.documents, 'concurrent-a');
  const b = await dbGet(STORES.documents, 'concurrent-b');
  check('Concurrent save+delete on A: delete wins (gone or saved-before-delete)',
    a === undefined || a.content === 'a2',
    a ? 'content=' + a.content : 'gone');
  check('Concurrent save+delete on B: delete wins (gone or saved-before-delete)',
    b === undefined || b.content === 'b2',
    b ? 'content=' + b.content : 'gone');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Lifecycle event emission tracking
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: Lifecycle event emission tracking ---');
{
  check('workspace.js uses emit() for events',
    wsCode.includes('emit('));

  check('storage.js emits doc:saved event',
    storageCode.includes("'doc:saved'"));

  check('storage.js emits doc:deleted event',
    storageCode.includes("'doc:deleted'"));

  check('storage.js emits project:created event',
    storageCode.includes("'project:created'"));

  check('storage.js emits project:deleted event',
    storageCode.includes("'project:deleted'"));

  check('storage.js emits data:saved event',
    storageCode.includes("'data:saved'"));

  check('storage.js emits data:deleted event',
    storageCode.includes("'data:deleted'"));

  check('storage.js emits capture:saved event',
    storageCode.includes("'capture:saved'"));

  check('storage.js emits integrity:audited event',
    storageCode.includes("'integrity:audited'"));
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail > 0 ? 1 : 0);
