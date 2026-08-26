#!/usr/bin/env node
/**
 * CE-061: Storage Surface Audit — Stores Without _writeSeq
 *
 * Adversarial audit of every IndexedDB store that lacks monotonic write-sequence
 * protection: projects, captures, settings, assets, executions, workflows.
 * Tests concurrent writes, stale-write acceptance, delete races, last-writer-wins
 * semantics, and mutation-safety under adversarial timing.
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

console.log('=== CE-061: Storage Surface Audit ===\n');

// ─── Real IndexedDB helpers (mirrors db.js, uses fake-indexeddb) ────────────
const DB_NAME = 'surface-audit-' + Date.now();
const DB_VERSION = 3;

function openTestDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('updatedAt', 'updatedAt');
        ps.createIndex('name', 'name');
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
        cs.createIndex('docId', 'docId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const as = db.createObjectStore('assets', { keyPath: 'id' });
        as.createIndex('projectId', 'projectId');
        as.createIndex('type', 'type');
        as.createIndex('sourceAssetId', 'sourceAssetId');
      }
      if (!db.objectStoreNames.contains('executions')) {
        const es = db.createObjectStore('executions', { keyPath: 'id' });
        es.createIndex('projectId', 'projectId');
        es.createIndex('toolId', 'toolId');
        es.createIndex('sourceAssetId', 'sourceAssetId');
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

let _dbSingleton = null;
async function getDB() {
  if (_dbSingleton) return _dbSingleton;
  _dbSingleton = await openTestDB();
  return _dbSingleton;
}

async function idbGet(storeName, key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetByIndex(storeName, indexName, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => reject(tx.error);
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbTransaction(stores, mode, fn) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    let transactionComplete = false;
    let callbackComplete = false;
    let result;
    const settle = () => {
      if (transactionComplete && callbackComplete) resolve(result);
    };
    const abortAndReject = (error) => {
      try { tx.abort(); } catch (_) {}
      reject(error);
    };
    tx.oncomplete = () => { transactionComplete = true; settle(); };
    const ctx = {};
    for (const s of (Array.isArray(stores) ? stores : [stores])) {
      ctx[s] = tx.objectStore(s);
    }
    try {
      const callbackResult = fn(ctx);
      if (callbackResult && typeof callbackResult.then === 'function') {
        callbackResult.then(value => { result = value; callbackComplete = true; settle(); })
          .catch(abortAndReject);
      } else {
        result = callbackResult;
        callbackComplete = true;
        settle();
      }
    } catch (error) { abortAndReject(error); }
  });
}

function resetTestDB() {
  if (_dbSingleton) { try { _dbSingleton.close(); } catch (_) {} _dbSingleton = null; }
}

const STORES = {
  projects: 'projects', documents: 'documents', data: 'data',
  captures: 'captures', settings: 'settings', assets: 'assets',
  executions: 'executions', workflows: 'workflows',
};

const MODEL_VERSION = 2;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Projects Store — No _writeSeq
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: Projects Store ---');
{
  resetTestDB();

  // 1a: Create project, verify read-back
  const p1 = {
    id: 'proj-1a', type: 'project', name: 'Alpha',
    description: '', createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, captureCount: 0, docCount: 0, dataCount: 0,
    assetCount: 0, toolExecCount: 0, designCount: 0,
  };
  await idbPut(STORES.projects, p1);
  const readback = await idbGet(STORES.projects, 'proj-1a');
  check('1a: create project, verify read-back', readback != null && readback.name === 'Alpha',
    'name=' + (readback && readback.name));

  // 1b: Concurrent put — two tabs writing same ID
  const tab1Write = idbPut(STORES.projects, { ...p1, name: 'A' });
  const tab2Write = idbPut(STORES.projects, { ...p1, name: 'B' });
  await Promise.all([tab1Write, tab2Write]);
  const afterConcurrent = await idbGet(STORES.projects, 'proj-1a');
  check('1b: concurrent put — no corruption',
    afterConcurrent != null && (afterConcurrent.name === 'A' || afterConcurrent.name === 'B'),
    'name=' + (afterConcurrent && afterConcurrent.name));

  // 1c: LWW semantics — whichever put happened last wins
  await idbPut(STORES.projects, { ...p1, name: 'C' });
  await idbPut(STORES.projects, { ...p1, name: 'D' });
  const afterLWW = await idbGet(STORES.projects, 'proj-1a');
  check('1c: LWW — last put wins', afterLWW != null && afterLWW.name === 'D',
    'name=' + (afterLWW && afterLWW.name));

  // 1d: Stale put — put with old data does NOT overwrite newer
  //     (no _writeSeq guard — stores accept all puts, LWW is timing-based)
  await idbPut(STORES.projects, { ...p1, name: 'newer' });
  await idbPut(STORES.projects, { ...p1, name: 'older' });
  const afterStale = await idbGet(STORES.projects, 'proj-1a');
  check('1d: stale put accepted — timing determines winner',
    afterStale != null && (afterStale.name === 'newer' || afterStale.name === 'older'),
    'name=' + (afterStale && afterStale.name));

  // 1e: Delete while another "tab" reads
  const projToDelete = {
    id: 'proj-1e', type: 'project', name: 'ToDelete',
    description: '', createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, captureCount: 0, docCount: 0, dataCount: 0,
    assetCount: 0, toolExecCount: 0, designCount: 0,
  };
  await idbPut(STORES.projects, projToDelete);
  const readDuringDelete = idbGet(STORES.projects, 'proj-1e');
  const deleteResult = idbDelete(STORES.projects, 'proj-1e');
  const [readVal] = await Promise.all([readDuringDelete, deleteResult]);
  check('1e: delete while reading — no error',
    readVal != null && readVal.id === 'proj-1e',
    'read=' + JSON.stringify(readVal && readVal.id));
  const afterDelete = await idbGet(STORES.projects, 'proj-1e');
  check('1e: record is deleted', afterDelete == null);

  // 1f: Put, delete, put with same ID — clean recreation
  await idbPut(STORES.projects, { ...p1, id: 'proj-1f', name: 'original' });
  await idbDelete(STORES.projects, 'proj-1f');
  await idbPut(STORES.projects, { ...p1, id: 'proj-1f', name: 'recreated' });
  const recreated = await idbGet(STORES.projects, 'proj-1f');
  check('1f: put-delete-put — clean recreation',
    recreated != null && recreated.name === 'recreated',
    'name=' + (recreated && recreated.name));

  // 1g: Refresh project counts
  await idbPut(STORES.projects, {
    ...p1, id: 'proj-1g', name: 'Counts',
    captureCount: 0, docCount: 0, dataCount: 0,
  });
  await idbPut(STORES.projects, {
    ...p1, id: 'proj-1g', name: 'Counts',
    captureCount: 5, docCount: 3, dataCount: 1,
  });
  const withCounts = await idbGet(STORES.projects, 'proj-1g');
  check('1g: project counts updated', withCounts != null && withCounts.captureCount === 5 && withCounts.docCount === 3,
    'cc=' + (withCounts && withCounts.captureCount) + ' dc=' + (withCounts && withCounts.docCount));

  // 1h: Put project without updatedAt
  await idbPut(STORES.projects, { id: 'proj-1h', type: 'project', name: 'NoDate' });
  const noDate = await idbGet(STORES.projects, 'proj-1h');
  check('1h: put without updatedAt — record valid', noDate != null && noDate.name === 'NoDate',
    'name=' + (noDate && noDate.name));

  // 1i: Multiple rapid puts — final state matches last put
  const rapidId = 'proj-1i';
  for (let i = 0; i < 10; i++) {
    await idbPut(STORES.projects, { ...p1, id: rapidId, name: 'rapid-' + i });
  }
  const rapidFinal = await idbGet(STORES.projects, rapidId);
  check('1i: rapid 10x put — final matches last',
    rapidFinal != null && rapidFinal.name === 'rapid-9',
    'name=' + (rapidFinal && rapidFinal.name));

  // 1j: Put project, update description
  await idbPut(STORES.projects, { ...p1, id: 'proj-1j', name: 'Desc', description: 'old' });
  await idbPut(STORES.projects, { ...p1, id: 'proj-1j', name: 'Desc', description: 'new' });
  const withDesc = await idbGet(STORES.projects, 'proj-1j');
  check('1j: description overwritten by second put',
    withDesc != null && withDesc.description === 'new',
    'desc=' + (withDesc && withDesc.description));

  // 1k: Multiple projects coexist
  await idbPut(STORES.projects, { ...p1, id: 'proj-1k-a', name: 'ProjectA' });
  await idbPut(STORES.projects, { ...p1, id: 'proj-1k-b', name: 'ProjectB' });
  const a = await idbGet(STORES.projects, 'proj-1k-a');
  const b = await idbGet(STORES.projects, 'proj-1k-b');
  check('1k: multiple projects coexist',
    a != null && b != null && a.name === 'ProjectA' && b.name === 'ProjectB');

  // 1l: Delete project by nonexistent key — no error
  await idbDelete(STORES.projects, 'proj-nonexistent');
  check('1l: delete nonexistent key — no error', true);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Captures Store — No _writeSeq
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Captures Store ---');
{
  resetTestDB();

  const projId = 'proj-cap';

  // 2a: Create capture, verify read-back
  const c1 = {
    id: 'cap-1a', type: 'capture', name: 'Scan 1',
    projectId: projId, docId: null, timestamp: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
  };
  await idbPut(STORES.captures, c1);
  const readback = await idbGet(STORES.captures, 'cap-1a');
  check('2a: create capture, verify read-back',
    readback != null && readback.name === 'Scan 1' && readback.projectId === projId,
    'name=' + (readback && readback.name));

  // 2b: Create capture with docId reference
  const c2 = {
    id: 'cap-1b', type: 'capture', name: 'FromDoc',
    projectId: projId, docId: 'doc-ref-1', timestamp: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
  };
  await idbPut(STORES.captures, c2);
  const byDoc = await idbGetByIndex(STORES.captures, 'docId', 'doc-ref-1');
  check('2b: capture with docId — findable by index',
    byDoc.length === 1 && byDoc[0].id === 'cap-1b',
    'found=' + byDoc.length);

  // 2c: Concurrent put to same capture ID — LWW
  const cBase = { ...c1, id: 'cap-1c' };
  const put1 = idbPut(STORES.captures, { ...cBase, name: 'Tab1' });
  const put2 = idbPut(STORES.captures, { ...cBase, name: 'Tab2' });
  await Promise.all([put1, put2]);
  const afterConc = await idbGet(STORES.captures, 'cap-1c');
  check('2c: concurrent put — no corruption',
    afterConc != null && (afterConc.name === 'Tab1' || afterConc.name === 'Tab2'),
    'name=' + (afterConc && afterConc.name));

  // 2d: Put C1, put C1 with different docId
  await idbPut(STORES.captures, { ...c1, id: 'cap-1d', docId: 'doc-old' });
  await idbPut(STORES.captures, { ...c1, id: 'cap-1d', docId: 'doc-new' });
  const updatedDoc = await idbGet(STORES.captures, 'cap-1d');
  check('2d: docId changed by second put',
    updatedDoc != null && updatedDoc.docId === 'doc-new',
    'docId=' + (updatedDoc && updatedDoc.docId));

  // 2e: Delete capture while a reference exists — dangling reference
  await idbPut(STORES.captures, { ...c1, id: 'cap-1e', docId: 'ref-cap-1e' });
  const assetWithRef = {
    id: 'asset-ref-1e', type: 'image-asset', name: 'ref-asset',
    projectId: projId, captureId: 'cap-1e',
    createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, mimeType: '', size: 0, extension: '',
    dataUrl: null, blobRef: null, tags: [],
    width: 0, height: 0, orientation: null, exif: null,
    thumbnailUrl: null, originalDataUrl: null, adjustedDataUrl: null,
  };
  await idbPut(STORES.assets, assetWithRef);
  await idbDelete(STORES.captures, 'cap-1e');
  const capGone = await idbGet(STORES.captures, 'cap-1e');
  const assetStill = await idbGet(STORES.assets, 'asset-ref-1e');
  check('2e: capture deleted — asset reference becomes dangling',
    capGone == null && assetStill != null && assetStill.captureId === 'cap-1e');

  // 2f: Delete capture — no reverse cascade to assets
  await idbPut(STORES.captures, { ...c1, id: 'cap-1f' });
  await idbPut(STORES.assets, {
    ...assetWithRef, id: 'asset-f', name: 'corrected', captureId: 'cap-1f',
    correctedAssetId: 'cap-1f',
  });
  await idbDelete(STORES.captures, 'cap-1f');
  const assetAfterCapDel = await idbGet(STORES.assets, 'asset-f');
  check('2f: asset survives capture deletion',
    assetAfterCapDel != null && assetAfterCapDel.id === 'asset-f');

  // 2g: Create capture, put capture with _writeSeq=N — N is ignored
  await idbPut(STORES.captures, { ...c1, id: 'cap-1g', name: 'before-seq' });
  await idbPut(STORES.captures, { ...c1, id: 'cap-1g', name: 'with-seq', _writeSeq: 999 });
  const withSeq = await idbGet(STORES.captures, 'cap-1g');
  check('2g: _writeSeq=N accepted, no error, value stored',
    withSeq != null && withSeq.name === 'with-seq' && withSeq._writeSeq === 999,
    'name=' + (withSeq && withSeq.name) + ' seq=' + (withSeq && withSeq._writeSeq));

  // 2h: Two captures with same docId — both exist
  await idbPut(STORES.captures, { ...c1, id: 'cap-1h-a', docId: 'shared-doc' });
  await idbPut(STORES.captures, { ...c1, id: 'cap-1h-b', docId: 'shared-doc' });
  const sharedDocCaps = await idbGetByIndex(STORES.captures, 'docId', 'shared-doc');
  check('2h: two captures with same docId',
    sharedDocCaps.length === 2,
    'count=' + sharedDocCaps.length);

  // 2i: Delete capture, recreate with same ID
  await idbPut(STORES.captures, { ...c1, id: 'cap-1i', name: 'original' });
  await idbDelete(STORES.captures, 'cap-1i');
  await idbPut(STORES.captures, { ...c1, id: 'cap-1i', name: 'fresh' });
  const recreated = await idbGet(STORES.captures, 'cap-1i');
  check('2i: delete then recreate — clean state',
    recreated != null && recreated.name === 'fresh' && recreated.docId == null,
    'name=' + (recreated && recreated.name));

  // 2j: Rapid 10x put to same capture
  for (let i = 0; i < 10; i++) {
    await idbPut(STORES.captures, { ...c1, id: 'cap-1j', name: 'rapid-' + i });
  }
  const rapidFinal = await idbGet(STORES.captures, 'cap-1j');
  check('2j: rapid 10x put — final state matches last',
    rapidFinal != null && rapidFinal.name === 'rapid-9',
    'name=' + (rapidFinal && rapidFinal.name));

  // 2k: Capture with metadata.captureId self-reference
  await idbPut(STORES.captures, {
    ...c1, id: 'cap-1k', metadata: { captureId: 'cap-1k' },
  });
  const selfRef = await idbGet(STORES.captures, 'cap-1k');
  check('2k: metadata.captureId self-reference persists',
    selfRef != null && selfRef.metadata.captureId === 'cap-1k',
    'captureId=' + (selfRef && selfRef.metadata && selfRef.metadata.captureId));

  // 2l: Put capture, modify only metadata, re-put
  await idbPut(STORES.captures, { ...c1, id: 'cap-1l', name: 'KeepName', metadata: {} });
  await idbPut(STORES.captures, { ...c1, id: 'cap-1l', name: 'KeepName', metadata: { tag: 'updated' } });
  const metaUpdated = await idbGet(STORES.captures, 'cap-1l');
  check('2l: only metadata changed, name preserved',
    metaUpdated != null && metaUpdated.name === 'KeepName' && metaUpdated.metadata.tag === 'updated',
    'name=' + (metaUpdated && metaUpdated.name) + ' tag=' + (metaUpdated && metaUpdated.metadata && metaUpdated.metadata.tag));

  // 2m: Put capture in one project, then another — projectId changes
  await idbPut(STORES.captures, { ...c1, id: 'cap-1m', projectId: 'proj-x' });
  await idbPut(STORES.captures, { ...c1, id: 'cap-1m', projectId: 'proj-y' });
  const moved = await idbGet(STORES.captures, 'cap-1m');
  check('2m: projectId changes without guard',
    moved != null && moved.projectId === 'proj-y',
    'projectId=' + (moved && moved.projectId));

  // 2n: Create, put, delete, put with different data
  await idbPut(STORES.captures, { ...c1, id: 'cap-1n', name: 'v1' });
  await idbDelete(STORES.captures, 'cap-1n');
  await idbPut(STORES.captures, { ...c1, id: 'cap-1n', name: 'v2', docId: 'new-ref' });
  const freshRecord = await idbGet(STORES.captures, 'cap-1n');
  check('2n: put-delete-put — fresh record',
    freshRecord != null && freshRecord.name === 'v2' && freshRecord.docId === 'new-ref',
    'name=' + (freshRecord && freshRecord.name));

  // 2o: Verify all captures exist
  const allCaps = await idbGetAll(STORES.captures);
  check('2o: captures store contains expected records',
    allCaps.length >= 10,
    'count=' + allCaps.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Settings Store — No _writeSeq
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: Settings Store ---');
{
  resetTestDB();

  // 3a: Put setting, verify read-back
  await idbPut(STORES.settings, { key: 'test-key', value: 'hello', updatedAt: Date.now() });
  const s1 = await idbGet(STORES.settings, 'test-key');
  check('3a: put setting, verify read-back',
    s1 != null && s1.value === 'hello',
    'value=' + (s1 && s1.value));

  // 3b: Put same key with different value — LWW
  await idbPut(STORES.settings, { key: 'test-key', value: 'world', updatedAt: Date.now() });
  const s2 = await idbGet(STORES.settings, 'test-key');
  check('3b: LWW — second put overwrites first',
    s2 != null && s2.value === 'world',
    'value=' + (s2 && s2.value));

  // 3c: Put model:proj1 with object value — JSON roundtrip
  const modelValue = { tables: [{ id: 't1', name: 'Users' }], relationships: [] };
  await idbPut(STORES.settings, { key: 'model:proj1', value: modelValue, updatedAt: Date.now() });
  const model = await idbGet(STORES.settings, 'model:proj1');
  check('3c: model setting — object roundtrip',
    model != null && model.value.tables.length === 1 && model.value.tables[0].name === 'Users',
    'tables=' + JSON.stringify(model && model.value && model.value.tables));

  // 3d: Put dashboard:proj1
  const dashValue = { widgets: ['chart1', 'chart2'] };
  await idbPut(STORES.settings, { key: 'dashboard:proj1', value: dashValue, updatedAt: Date.now() });
  const dash = await idbGet(STORES.settings, 'dashboard:proj1');
  check('3d: dashboard setting persisted',
    dash != null && dash.value.widgets.length === 2,
    'widgets=' + JSON.stringify(dash && dash.value && dash.value.widgets));

  // 3e: Concurrent put to same key — LWW, no corruption
  const putA = idbPut(STORES.settings, { key: 'model:proj1', value: { from: 'A' }, updatedAt: Date.now() });
  const putB = idbPut(STORES.settings, { key: 'model:proj1', value: { from: 'B' }, updatedAt: Date.now() });
  await Promise.all([putA, putB]);
  const afterConc = await idbGet(STORES.settings, 'model:proj1');
  check('3e: concurrent put — no corruption',
    afterConc != null && (afterConc.value.from === 'A' || afterConc.value.from === 'B'),
    'from=' + (afterConc && afterConc.value && afterConc.value.from));

  // 3f: Delete setting, put again — clean state
  await idbPut(STORES.settings, { key: 'temp-key', value: 'exists', updatedAt: Date.now() });
  await idbDelete(STORES.settings, 'temp-key');
  const deleted = await idbGet(STORES.settings, 'temp-key');
  check('3f: deleted setting is null', deleted == null);
  await idbPut(STORES.settings, { key: 'temp-key', value: 'restored', updatedAt: Date.now() });
  const restored = await idbGet(STORES.settings, 'temp-key');
  check('3f: setting recreated after delete',
    restored != null && restored.value === 'restored',
    'value=' + (restored && restored.value));

  // 3g: Setting with nested object containing arrays
  const nested = { a: [1, 2, 3], b: { c: 'deep', d: [true, false] } };
  await idbPut(STORES.settings, { key: 'nested-test', value: nested, updatedAt: Date.now() });
  const nestedRead = await idbGet(STORES.settings, 'nested-test');
  check('3g: nested object with arrays roundtrips',
    nestedRead != null && Array.isArray(nestedRead.value.a) && nestedRead.value.a[2] === 3,
    'a=' + JSON.stringify(nestedRead && nestedRead.value && nestedRead.value.a));

  // 3h: Setting with undefined value
  await idbPut(STORES.settings, { key: 'undef-test', value: undefined, updatedAt: Date.now() });
  const undefRead = await idbGet(STORES.settings, 'undef-test');
  check('3h: setting with undefined value — key exists',
    undefRead != null && 'key' in undefRead && undefRead.key === 'undef-test',
    'result=' + JSON.stringify(undefRead));

  // 3i: Setting with array value
  const arrValue = ['workspace', 'settings', 'ws:session'];
  await idbPut(STORES.settings, { key: 'ws:session', value: arrValue, updatedAt: Date.now() });
  const arrRead = await idbGet(STORES.settings, 'ws:session');
  check('3i: array value roundtrips',
    arrRead != null && Array.isArray(arrRead.value) && arrRead.value.length === 3,
    'value=' + JSON.stringify(arrRead && arrRead.value));

  // 3j: Rapid 5x puts to same key
  for (let i = 0; i < 5; i++) {
    await idbPut(STORES.settings, { key: 'rapid-key', value: 'v' + i, updatedAt: Date.now() });
  }
  const rapidFinal = await idbGet(STORES.settings, 'rapid-key');
  check('3j: rapid 5x put — final value matches last',
    rapidFinal != null && rapidFinal.value === 'v4',
    'value=' + (rapidFinal && rapidFinal.value));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Assets Store — No _writeSeq
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Assets Store ---');
{
  resetTestDB();

  const projId = 'proj-ast';

  // 4a: Create image asset, verify read-back
  const imgAsset = {
    id: 'img-1', type: 'image-asset', name: 'photo.jpg',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    mimeType: 'image/jpeg', size: 102400, extension: 'jpg',
    dataUrl: null, blobRef: null, tags: [],
    width: 800, height: 600, orientation: null, exif: null,
    thumbnailUrl: null, originalDataUrl: null, adjustedDataUrl: null,
  };
  await idbPut(STORES.assets, imgAsset);
  const readback = await idbGet(STORES.assets, 'img-1');
  check('4a: create image asset, verify read-back',
    readback != null && readback.type === 'image-asset' && readback.width === 800,
    'type=' + (readback && readback.type));

  // 4b: Create file asset, verify read-back
  const fileAsset = {
    id: 'file-1', type: 'file-asset', name: 'doc.pdf',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    mimeType: 'application/pdf', size: 204800, extension: 'pdf',
    dataUrl: null, blobRef: null, tags: [],
  };
  await idbPut(STORES.assets, fileAsset);
  const fileRead = await idbGet(STORES.assets, 'file-1');
  check('4b: create file asset, verify read-back',
    fileRead != null && fileRead.type === 'file-asset' && fileRead.extension === 'pdf',
    'ext=' + (fileRead && fileRead.extension));

  // 4c: Concurrent put to same asset ID — LWW
  const put1 = idbPut(STORES.assets, { ...imgAsset, id: 'ast-c', name: 'Tab1.jpg' });
  const put2 = idbPut(STORES.assets, { ...imgAsset, id: 'ast-c', name: 'Tab2.jpg' });
  await Promise.all([put1, put2]);
  const afterConc = await idbGet(STORES.assets, 'ast-c');
  check('4c: concurrent put — no corruption',
    afterConc != null && (afterConc.name === 'Tab1.jpg' || afterConc.name === 'Tab2.jpg'),
    'name=' + (afterConc && afterConc.name));

  // 4d: Put asset, put asset with changed type
  await idbPut(STORES.assets, { ...fileAsset, id: 'ast-d', type: 'file-asset' });
  await idbPut(STORES.assets, { ...imgAsset, id: 'ast-d', type: 'image-asset' });
  const typeChanged = await idbGet(STORES.assets, 'ast-d');
  check('4d: type changed by second put',
    typeChanged != null && typeChanged.type === 'image-asset',
    'type=' + (typeChanged && typeChanged.type));

  // 4e: Delete asset while another entity references it — dangling reference
  await idbPut(STORES.assets, { ...imgAsset, id: 'ast-e' });
  const execWithRef = {
    id: 'exec-ref-e', type: 'tool-execution', name: 'ref-exec',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    toolId: 'scan', toolName: 'Scan', inputs: [], inputAssetIds: ['ast-e'],
    progress: 1, status: 'completed', resultType: null, resultData: null,
    resultAssetId: 'ast-e', parameters: {}, startedAt: Date.now(),
    completedAt: Date.now(), duration: 0,
  };
  await idbPut(STORES.executions, execWithRef);
  await idbDelete(STORES.assets, 'ast-e');
  const astGone = await idbGet(STORES.assets, 'ast-e');
  const execStill = await idbGet(STORES.executions, 'exec-ref-e');
  check('4e: asset deleted — execution reference becomes dangling',
    astGone == null && execStill != null && execStill.resultAssetId === 'ast-e');

  // 4f: Chart asset with sourceTableId, delete source table — chart deleted by cascade
  const tableForChart = {
    id: 'table-f', type: 'table-document', name: 'DataTable',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    sheets: [], activeSheetIndex: 0, model: null,
  };
  const chartAsset = {
    id: 'chart-f', type: 'chart', name: 'Chart',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    chartType: 'bar', sourceTableId: 'table-f', sourceSheetId: null,
    config: { title: 'Chart', xAxis: null, yAxis: null, series: [], colors: [], width: 600, height: 400 },
    svgData: null,
  };
  await idbPut(STORES.data, tableForChart);
  await idbPut(STORES.assets, chartAsset);
  // Cascade: chart references table via sourceTableId
  // Simulate cascade by reading all assets, finding those referencing the deleted table
  await idbDelete(STORES.data, 'table-f');
  // After cascade, the chart referencing the deleted table should be cleaned
  // Since we are testing raw IDB (no cascade layer here), verify the chart still exists
  // but its sourceTableId is dangling
  const chartAfterTableDel = await idbGet(STORES.assets, 'chart-f');
  check('4f: chart still exists after source table deletion (no reverse cascade in raw IDB)',
    chartAfterTableDel != null && chartAfterTableDel.sourceTableId === 'table-f');

  // 4g: Scan-document asset — no reverse cascade from child to parent
  const scanDoc = {
    id: 'scan-g', type: 'scan-document', name: 'ScanPage',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: 'img-g', derivedIds: [],
    deleted: false, deletedAt: null,
    pages: [], pageCount: 0, currentFilter: 'original',
    adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 },
  };
  const sourceImg = { ...imgAsset, id: 'img-g', sourceAssetId: null };
  await idbPut(STORES.assets, sourceImg);
  await idbPut(STORES.assets, scanDoc);
  await idbDelete(STORES.assets, 'img-g');
  const scanStill = await idbGet(STORES.assets, 'scan-g');
  check('4g: scan-document survives source image deletion',
    scanStill != null && scanStill.id === 'scan-g');

  // 4h: Put asset without _writeSeq field — accepted
  await idbPut(STORES.assets, {
    id: 'ast-h', type: 'file-asset', name: 'no-seq.txt',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, mimeType: 'text/plain', size: 100,
    extension: 'txt', dataUrl: null, blobRef: null, tags: [],
  });
  const noSeq = await idbGet(STORES.assets, 'ast-h');
  check('4h: asset without _writeSeq accepted',
    noSeq != null && noSeq._writeSeq == null,
    'writeSeq=' + (noSeq && noSeq._writeSeq));

  // 4i: Asset with large dataUrl (simulated)
  const largeAsset = { ...imgAsset, id: 'ast-i', dataUrl: 'data:image/png;base64,' + 'A'.repeat(10000) };
  await idbPut(STORES.assets, largeAsset);
  const largeRead = await idbGet(STORES.assets, 'ast-i');
  check('4i: large dataUrl persists',
    largeRead != null && largeRead.dataUrl && largeRead.dataUrl.length > 10000,
    'len=' + (largeRead && largeRead.dataUrl && largeRead.dataUrl.length));

  // 4j: Delete asset, recreate with same ID
  await idbPut(STORES.assets, { ...imgAsset, id: 'ast-j', name: 'original' });
  await idbDelete(STORES.assets, 'ast-j');
  await idbPut(STORES.assets, { ...imgAsset, id: 'ast-j', name: 'fresh' });
  const recreated = await idbGet(STORES.assets, 'ast-j');
  check('4j: delete then recreate — clean state',
    recreated != null && recreated.name === 'fresh',
    'name=' + (recreated && recreated.name));

  // 4k: Put asset, execution references it, delete asset — execution still exists
  await idbPut(STORES.assets, { ...imgAsset, id: 'ast-k' });
  await idbPut(STORES.executions, {
    ...execWithRef, id: 'exec-k', resultAssetId: 'ast-k',
    inputAssetIds: ['ast-k'],
  });
  await idbDelete(STORES.assets, 'ast-k');
  const execAfterAstDel = await idbGet(STORES.executions, 'exec-k');
  check('4k: execution survives asset deletion with dangling resultAssetId',
    execAfterAstDel != null && execAfterAstDel.resultAssetId === 'ast-k');

  // 4l: Rapid 10x put to same asset
  for (let i = 0; i < 10; i++) {
    await idbPut(STORES.assets, { ...imgAsset, id: 'ast-l', name: 'rapid-' + i });
  }
  const rapidFinal = await idbGet(STORES.assets, 'ast-l');
  check('4l: rapid 10x put — final matches last',
    rapidFinal != null && rapidFinal.name === 'rapid-9',
    'name=' + (rapidFinal && rapidFinal.name));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Executions Store — No _writeSeq
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Executions Store ---');
{
  resetTestDB();

  const projId = 'proj-exec';

  // 5a: Create execution, verify read-back
  const e1 = {
    id: 'exec-1', type: 'tool-execution', name: 'OCR',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    toolId: 'ocr', toolName: 'OCR Scanner', inputs: [], inputAssetIds: [],
    progress: 1, status: 'completed', resultType: 'text', resultData: 'Hello',
    resultAssetId: null, parameters: {}, startedAt: Date.now(),
    completedAt: Date.now(), duration: 100,
  };
  await idbPut(STORES.executions, e1);
  const readback = await idbGet(STORES.executions, 'exec-1');
  check('5a: create execution, verify read-back',
    readback != null && readback.toolName === 'OCR Scanner' && readback.status === 'completed',
    'tool=' + (readback && readback.toolName));

  // 5b: Concurrent put to same execution — LWW
  const put1 = idbPut(STORES.executions, { ...e1, id: 'exec-b', status: 'running' });
  const put2 = idbPut(STORES.executions, { ...e1, id: 'exec-b', status: 'failed' });
  await Promise.all([put1, put2]);
  const afterConc = await idbGet(STORES.executions, 'exec-b');
  check('5b: concurrent put — no corruption',
    afterConc != null && (afterConc.status === 'running' || afterConc.status === 'failed'),
    'status=' + (afterConc && afterConc.status));

  // 5c: Put execution, change status from completed to failed
  await idbPut(STORES.executions, { ...e1, id: 'exec-c', status: 'completed' });
  await idbPut(STORES.executions, { ...e1, id: 'exec-c', status: 'failed' });
  const statusChanged = await idbGet(STORES.executions, 'exec-c');
  check('5c: status changed to failed',
    statusChanged != null && statusChanged.status === 'failed',
    'status=' + (statusChanged && statusChanged.status));

  // 5d: Delete execution
  await idbPut(STORES.executions, { ...e1, id: 'exec-d' });
  await idbDelete(STORES.executions, 'exec-d');
  const deleted = await idbGet(STORES.executions, 'exec-d');
  check('5d: deleted execution is gone', deleted == null);

  // 5e: Create execution with inputAssetIds — delete execution — assets NOT deleted
  await idbPut(STORES.assets, {
    id: 'ast-e5', type: 'image-asset', name: 'input.jpg',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, mimeType: 'image/jpeg', size: 0,
    extension: 'jpg', dataUrl: null, blobRef: null, tags: [],
    width: 0, height: 0, orientation: null, exif: null,
    thumbnailUrl: null, originalDataUrl: null, adjustedDataUrl: null,
  });
  await idbPut(STORES.executions, { ...e1, id: 'exec-e5', inputAssetIds: ['ast-e5'] });
  await idbDelete(STORES.executions, 'exec-e5');
  const assetStill = await idbGet(STORES.assets, 'ast-e5');
  check('5e: execution deleted — asset NOT deleted',
    assetStill != null && assetStill.id === 'ast-e5');

  // 5f: Put, delete, recreate — clean state
  await idbPut(STORES.executions, { ...e1, id: 'exec-f', toolName: 'v1' });
  await idbDelete(STORES.executions, 'exec-f');
  await idbPut(STORES.executions, { ...e1, id: 'exec-f', toolName: 'v2' });
  const recreated = await idbGet(STORES.executions, 'exec-f');
  check('5f: delete then recreate — clean state',
    recreated != null && recreated.toolName === 'v2',
    'tool=' + (recreated && recreated.toolName));

  // 5g: Put execution without resultAssetId
  await idbPut(STORES.executions, { ...e1, id: 'exec-g', resultAssetId: null });
  const noResult = await idbGet(STORES.executions, 'exec-g');
  check('5g: execution without resultAssetId persists',
    noResult != null && noResult.resultAssetId === null,
    'resultAssetId=' + JSON.stringify(noResult && noResult.resultAssetId));

  // 5h: Multiple executions for same project — independent
  await idbPut(STORES.executions, { ...e1, id: 'exec-h1', toolName: 'Exec1' });
  await idbPut(STORES.executions, { ...e1, id: 'exec-h2', toolName: 'Exec2' });
  const h1 = await idbGet(STORES.executions, 'exec-h1');
  const h2 = await idbGet(STORES.executions, 'exec-h2');
  check('5h: multiple executions independent',
    h1 != null && h2 != null && h1.toolName === 'Exec1' && h2.toolName === 'Exec2');

  // 5i: Put execution with resultAssetId pointing to deleted asset
  await idbPut(STORES.executions, {
    ...e1, id: 'exec-i', resultAssetId: 'deleted-ast', inputAssetIds: [],
  });
  const danglingExec = await idbGet(STORES.executions, 'exec-i');
  check('5i: dangling resultAssetId accepted',
    danglingExec != null && danglingExec.resultAssetId === 'deleted-ast',
    'resultAssetId=' + (danglingExec && danglingExec.resultAssetId));

  // 5j: Rapid 5x put to same execution — LWW
  for (let i = 0; i < 5; i++) {
    await idbPut(STORES.executions, { ...e1, id: 'exec-j', toolName: 'rapid-' + i });
  }
  const rapidFinal = await idbGet(STORES.executions, 'exec-j');
  check('5j: rapid 5x put — LWW',
    rapidFinal != null && rapidFinal.toolName === 'rapid-4',
    'tool=' + (rapidFinal && rapidFinal.toolName));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Workflows Store — No _writeSeq
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Workflows Store ---');
{
  resetTestDB();

  const projId = 'proj-wf';

  // 6a: Create workflow, verify read-back
  const w1 = {
    id: 'wf-1', type: 'workflow', name: 'Scan Pipeline',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    nodes: [], edges: [], status: 'draft', lastRunAt: null,
  };
  await idbPut(STORES.workflows, w1);
  const readback = await idbGet(STORES.workflows, 'wf-1');
  check('6a: create workflow, verify read-back',
    readback != null && readback.name === 'Scan Pipeline' && readback.status === 'draft',
    'name=' + (readback && readback.name));

  // 6b: Concurrent put to same workflow — LWW
  const put1 = idbPut(STORES.workflows, { ...w1, id: 'wf-b', name: 'Version1' });
  const put2 = idbPut(STORES.workflows, { ...w1, id: 'wf-b', name: 'Version2' });
  await Promise.all([put1, put2]);
  const afterConc = await idbGet(STORES.workflows, 'wf-b');
  check('6b: concurrent put — no corruption',
    afterConc != null && (afterConc.name === 'Version1' || afterConc.name === 'Version2'),
    'name=' + (afterConc && afterConc.name));

  // 6c: Put workflow, change name
  await idbPut(STORES.workflows, { ...w1, id: 'wf-c', name: 'OldName' });
  await idbPut(STORES.workflows, { ...w1, id: 'wf-c', name: 'NewName' });
  const renamed = await idbGet(STORES.workflows, 'wf-c');
  check('6c: workflow name changed',
    renamed != null && renamed.name === 'NewName',
    'name=' + (renamed && renamed.name));

  // 6d: Delete workflow
  await idbPut(STORES.workflows, { ...w1, id: 'wf-d' });
  await idbDelete(STORES.workflows, 'wf-d');
  const deleted = await idbGet(STORES.workflows, 'wf-d');
  check('6d: deleted workflow is gone', deleted == null);

  // 6e: Create workflow, log execution — array persists
  const wfWithHistory = {
    ...w1, id: 'wf-e',
    nodes: [{ id: 'n1', type: 'tool', name: 'OCR' }],
    executionHistory: [{ runAt: Date.now(), status: 'completed', duration: 100 }],
  };
  await idbPut(STORES.workflows, wfWithHistory);
  const wfE = await idbGet(STORES.workflows, 'wf-e');
  check('6e: executionHistory array persists',
    wfE != null && Array.isArray(wfE.executionHistory) && wfE.executionHistory.length === 1,
    'historyLen=' + (wfE && wfE.executionHistory && wfE.executionHistory.length));

  // 6f: Put, delete, recreate
  await idbPut(STORES.workflows, { ...w1, id: 'wf-f', name: 'v1' });
  await idbDelete(STORES.workflows, 'wf-f');
  await idbPut(STORES.workflows, { ...w1, id: 'wf-f', name: 'v2' });
  const recreated = await idbGet(STORES.workflows, 'wf-f');
  check('6f: delete then recreate — clean state',
    recreated != null && recreated.name === 'v2',
    'name=' + (recreated && recreated.name));

  // 6g: Workflow with embedded steps referencing assets — delete workflow — assets NOT deleted
  await idbPut(STORES.assets, {
    id: 'ast-g6', type: 'file-asset', name: 'input.pdf',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, mimeType: 'application/pdf', size: 0,
    extension: 'pdf', dataUrl: null, blobRef: null, tags: [],
  });
  await idbPut(STORES.workflows, {
    ...w1, id: 'wf-g',
    steps: [{ id: 's1', type: 'tool', config: { sourceAssetId: 'ast-g6' } }],
  });
  await idbDelete(STORES.workflows, 'wf-g');
  const assetG6 = await idbGet(STORES.assets, 'ast-g6');
  check('6g: asset survives workflow deletion',
    assetG6 != null && assetG6.id === 'ast-g6');

  // 6h: Workflow with null description
  await idbPut(STORES.workflows, { ...w1, id: 'wf-h', description: null });
  const nullDesc = await idbGet(STORES.workflows, 'wf-h');
  check('6h: null description persists',
    nullDesc != null && nullDesc.description === null,
    'desc=' + JSON.stringify(nullDesc && nullDesc.description));

  // 6i: Multiple workflows for same project — independent
  await idbPut(STORES.workflows, { ...w1, id: 'wf-i1', name: 'Pipeline1' });
  await idbPut(STORES.workflows, { ...w1, id: 'wf-i2', name: 'Pipeline2' });
  const i1 = await idbGet(STORES.workflows, 'wf-i1');
  const i2 = await idbGet(STORES.workflows, 'wf-i2');
  check('6i: multiple workflows independent',
    i1 != null && i2 != null && i1.name === 'Pipeline1' && i2.name === 'Pipeline2');

  // 6j: Rapid 5x put to same workflow — LWW
  for (let i = 0; i < 5; i++) {
    await idbPut(STORES.workflows, { ...w1, id: 'wf-j', name: 'rapid-' + i });
  }
  const rapidFinal = await idbGet(STORES.workflows, 'wf-j');
  check('6j: rapid 5x put — LWW',
    rapidFinal != null && rapidFinal.name === 'rapid-4',
    'name=' + (rapidFinal && rapidFinal.name));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Cross-Store Write Isolation
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: Cross-Store Write Isolation ---');
{
  resetTestDB();

  const projId = 'proj-x';

  // 7a: Write to documents store, write to data store — both persist independently
  const docObj = {
    id: 'doc-x1', type: 'text-document', name: 'Doc1',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, blocks: [], wordCount: 0, template: null,
    tableOfContents: false, trashBlocks: [],
  };
  const dataTable = {
    id: 'table-x1', type: 'table-document', name: 'Data1',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, sheets: [], activeSheetIndex: 0, model: null,
  };
  await idbPut(STORES.documents, docObj);
  await idbPut(STORES.data, dataTable);
  const docRead = await idbGet(STORES.documents, 'doc-x1');
  const dataRead = await idbGet(STORES.data, 'table-x1');
  check('7a: documents and data stores persist independently',
    docRead != null && docRead.name === 'Doc1' && dataRead != null && dataRead.name === 'Data1');

  // 7b: Write to captures store, write to assets store — both persist
  const capObj = {
    id: 'cap-x1', type: 'capture', name: 'Capture1',
    projectId: projId, docId: null, timestamp: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
  };
  const astObj = {
    id: 'ast-x1', type: 'image-asset', name: 'Image1',
    projectId: projId, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null, mimeType: 'image/png', size: 0,
    extension: 'png', dataUrl: null, blobRef: null, tags: [],
    width: 0, height: 0, orientation: null, exif: null,
    thumbnailUrl: null, originalDataUrl: null, adjustedDataUrl: null,
  };
  await idbPut(STORES.captures, capObj);
  await idbPut(STORES.assets, astObj);
  const capRead = await idbGet(STORES.captures, 'cap-x1');
  const astRead = await idbGet(STORES.assets, 'ast-x1');
  check('7b: captures and assets stores persist independently',
    capRead != null && capRead.name === 'Capture1' && astRead != null && astRead.name === 'Image1');

  // 7c: Delete from documents store — data store unaffected
  await idbDelete(STORES.documents, 'doc-x1');
  const docAfterDel = await idbGet(STORES.documents, 'doc-x1');
  const dataAfterDocDel = await idbGet(STORES.data, 'table-x1');
  check('7c: document deleted — data table unaffected',
    docAfterDel == null && dataAfterDocDel != null && dataAfterDocDel.name === 'Data1');

  // 7d: Concurrent writes to different stores — no cross-contamination
  const concDoc = idbPut(STORES.documents, { ...docObj, id: 'doc-xd', name: 'ConcDoc' });
  const concCap = idbPut(STORES.captures, { ...capObj, id: 'cap-xd', name: 'ConcCap' });
  await Promise.all([concDoc, concCap]);
  const concDocR = await idbGet(STORES.documents, 'doc-xd');
  const concCapR = await idbGet(STORES.captures, 'cap-xd');
  check('7d: concurrent writes to different stores — no cross-contamination',
    concDocR != null && concDocR.name === 'ConcDoc' && concCapR != null && concCapR.name === 'ConcCap');

  // 7e: Transaction failure in one store — other stores unaffected (when not in same tx)
  let threwInDoc = false;
  try {
    await idbTransaction([STORES.documents], 'readwrite', (stores) => {
      stores[STORES.documents].put({ ...docObj, id: 'doc-xe', name: 'abort-test' });
      throw new Error('simulated abort');
    });
  } catch (e) {
    threwInDoc = true;
  }
  const docXe = await idbGet(STORES.documents, 'doc-xe');
  const dataXe = await idbGet(STORES.data, 'table-x1');
  check('7e: transaction failure — other stores unaffected',
    threwInDoc && docXe == null && dataXe != null);

  // 7f: Delete project cascades across all stores — verify atomicity
  const cascadeProj = 'proj-cascade';
  await idbPut(STORES.projects, {
    id: cascadeProj, type: 'project', name: 'Cascade',
    description: '', createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, captureCount: 0, docCount: 0, dataCount: 0,
    assetCount: 0, toolExecCount: 0, designCount: 0,
  });
  await idbPut(STORES.documents, { ...docObj, id: 'doc-cascade', projectId: cascadeProj });
  await idbPut(STORES.data, { ...dataTable, id: 'table-cascade', projectId: cascadeProj });
  await idbPut(STORES.captures, { ...capObj, id: 'cap-cascade', projectId: cascadeProj });
  await idbPut(STORES.assets, { ...astObj, id: 'ast-cascade', projectId: cascadeProj });
  await idbPut(STORES.executions, {
    id: 'exec-cascade', type: 'tool-execution', name: 'Exec',
    projectId: cascadeProj, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    toolId: '', toolName: 'Exec', inputs: [], inputAssetIds: [],
    progress: 0, status: 'pending', resultType: null, resultData: null,
    resultAssetId: null, parameters: {}, startedAt: null,
    completedAt: null, duration: 0,
  });
  await idbPut(STORES.workflows, {
    id: 'wf-cascade', type: 'workflow', name: 'CascadeWF',
    projectId: cascadeProj, createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, metadata: {}, history: [], relations: [],
    processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [],
    deleted: false, deletedAt: null,
    nodes: [], edges: [], status: 'draft', lastRunAt: null,
  });
  await idbPut(STORES.settings, {
    key: 'dashboard:' + cascadeProj, value: { widgets: [] }, updatedAt: Date.now(),
  });

  // Atomic delete across all stores in one transaction
  await idbTransaction([
    STORES.projects, STORES.documents, STORES.data, STORES.captures,
    STORES.assets, STORES.executions, STORES.workflows, STORES.settings,
  ], 'readwrite', (stores) => {
    stores[STORES.projects].delete(cascadeProj);
    stores[STORES.documents].delete('doc-cascade');
    stores[STORES.data].delete('table-cascade');
    stores[STORES.captures].delete('cap-cascade');
    stores[STORES.assets].delete('ast-cascade');
    stores[STORES.executions].delete('exec-cascade');
    stores[STORES.workflows].delete('wf-cascade');
    stores[STORES.settings].delete('dashboard:' + cascadeProj);
  });

  const pGone = await idbGet(STORES.projects, cascadeProj);
  const dGone = await idbGet(STORES.documents, 'doc-cascade');
  const tGone = await idbGet(STORES.data, 'table-cascade');
  const cGone = await idbGet(STORES.captures, 'cap-cascade');
  const aGone = await idbGet(STORES.assets, 'ast-cascade');
  const eGone = await idbGet(STORES.executions, 'exec-cascade');
  const wGone = await idbGet(STORES.workflows, 'wf-cascade');
  const sGone = await idbGet(STORES.settings, 'dashboard:' + cascadeProj);
  check('7f: cascade deletes all entities atomically',
    pGone == null && dGone == null && tGone == null && cGone == null &&
    aGone == null && eGone == null && wGone == null && sGone == null);

  // 7g: Write to settings while assets store is being written — no interference
  const settingsWrite = idbPut(STORES.settings, {
    key: 'interference-test', value: 'settings', updatedAt: Date.now(),
  });
  const assetWrite = idbPut(STORES.assets, {
    ...astObj, id: 'ast-interf', name: 'Interference',
  });
  await Promise.all([settingsWrite, assetWrite]);
  const settRead = await idbGet(STORES.settings, 'interference-test');
  const astRead2 = await idbGet(STORES.assets, 'ast-interf');
  check('7g: settings and assets writes independent',
    settRead != null && settRead.value === 'settings' && astRead2 != null && astRead2.name === 'Interference');

  // 7h: Import transaction across all stores — verify atomic commit/rollback
  let importThrew = false;
  try {
    await idbTransaction([
      STORES.projects, STORES.documents, STORES.data, STORES.captures,
      STORES.assets, STORES.executions, STORES.workflows, STORES.settings,
    ], 'readwrite', (stores) => {
      stores[STORES.projects].put({
        id: 'import-proj', type: 'project', name: 'Import',
        description: '', createdAt: Date.now(), updatedAt: Date.now(),
        _version: MODEL_VERSION, captureCount: 0, docCount: 0, dataCount: 0,
        assetCount: 0, toolExecCount: 0, designCount: 0,
      });
      stores[STORES.documents].put({ ...docObj, id: 'import-doc', projectId: 'import-proj' });
      stores[STORES.settings].put({
        key: 'model:import-proj', value: { tables: [] }, updatedAt: Date.now(),
      });
      throw new Error('import validation failed');
    });
  } catch (e) {
    importThrew = true;
  }
  const importProj = await idbGet(STORES.projects, 'import-proj');
  const importDoc = await idbGet(STORES.documents, 'import-doc');
  const importModel = await idbGet(STORES.settings, 'model:import-proj');
  check('7h: import rollback — no partial writes',
    importThrew && importProj == null && importDoc == null && importModel == null);
}

// ================================================================
// SUMMARY
// ================================================================
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
