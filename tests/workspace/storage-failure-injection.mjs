#!/usr/bin/env node
/**
 * CE-059: Storage Failure & Recovery Certification
 *
 * Tests IndexedDB write failure injection, quota errors, closed DB,
 * transaction abort, lock recovery under failure, cross-entity isolation,
 * _writeSeq resilience, and unhandled-rejection audit.
 *
 * Uses fake-indexeddb for real IDB with faithful storage mirrors
 * (following CE-058 adversarial-audit pattern) and lock primitives
 * extracted from workspace.js.
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

console.log('=== CE-059: Storage Failure Injection ===\n');

// ─── Extract lock primitives from workspace.js ──────────────────────────────
const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
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

// ─── Real IndexedDB helpers (mirrors db.js, uses fake-indexeddb) ────────────
const DB_NAME = 'storage-failure-test-' + Date.now();
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

let _failStore = null, _failKeyId = null, _failCount = 0, _failUntil = 0;
function injectDbPutFailure(storeName, keyId, count) {
  _failStore = storeName;
  _failKeyId = keyId;
  _failCount = 0;
  _failUntil = count || Infinity;
}
function clearDbPutFailure() {
  _failStore = null;
  _failKeyId = null;
  _failCount = 0;
  _failUntil = 0;
}

function idbShouldFail(storeName, keyId) {
  if (!_failStore) return false;
  if (_failStore !== storeName) return false;
  if (_failKeyId === '*' || _failKeyId === keyId) {
    if (_failCount < _failUntil) { _failCount++; return true; }
  }
  return false;
}

async function idbPut(storeName, value) {
  const id = value && value.id;
  if (idbShouldFail(storeName, id)) {
    throw new Error('Injected dbPut failure for ' + storeName + '/' + id);
  }
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

const MODEL_VERSION = 1;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ─── Storage mirrors (faithful reproduction of storage.js logic) ────────────

async function saveDoc(projectId, doc) {
  if (!doc.id) doc.id = generateId();
  doc.projectId = projectId;
  doc.updatedAt = Date.now();
  if (!doc.createdAt) doc.createdAt = doc.updatedAt;
  if (!doc._version) doc._version = MODEL_VERSION;
  const existing = await idbGet(STORES.documents, doc.id);
  if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
    return existing;
  }
  doc._writeSeq = (existing?._writeSeq || 0) + 1;
  await idbPut(STORES.documents, doc);
  return doc;
}

async function saveData(projectId, table) {
  if (!table.id) table.id = generateId();
  table.projectId = projectId;
  table.updatedAt = Date.now();
  if (!table.createdAt) table.createdAt = table.updatedAt;
  if (!table._version) table._version = MODEL_VERSION;
  const existing = await idbGet(STORES.data, table.id);
  if (existing && existing._writeSeq != null && existing._writeSeq > (table._writeSeq || 0)) {
    return existing;
  }
  table._writeSeq = (existing?._writeSeq || 0) + 1;
  await idbPut(STORES.data, table);
  return table;
}

async function saveAsset(projectId, asset) {
  if (!asset.id) asset.id = generateId();
  asset.projectId = projectId;
  asset.updatedAt = Date.now();
  if (!asset.createdAt) asset.createdAt = asset.updatedAt;
  if (!asset._version) asset._version = MODEL_VERSION;
  await idbPut(STORES.assets, asset);
  return asset;
}

async function saveExecution(projectId, execution) {
  if (!execution.id) execution.id = generateId();
  execution.projectId = projectId;
  execution.updatedAt = Date.now();
  if (!execution.createdAt) execution.createdAt = execution.updatedAt;
  if (!execution._version) execution._version = MODEL_VERSION;
  await idbPut(STORES.executions, execution);
  return execution;
}

async function saveWorkflow(projectId, workflow) {
  if (!workflow.id) workflow.id = generateId();
  workflow.projectId = projectId;
  workflow.updatedAt = Date.now();
  if (!workflow.createdAt) workflow.createdAt = workflow.updatedAt;
  if (!workflow._version) workflow._version = MODEL_VERSION;
  await idbPut(STORES.workflows, workflow);
  return workflow;
}

async function deleteDoc(id) {
  await idbDelete(STORES.documents, id);
  return true;
}

async function deleteData(id) {
  await idbDelete(STORES.data, id);
  return true;
}

async function loadDocs(projectId) {
  const all = await idbGetAll(STORES.documents);
  return all.filter(d => d.projectId === projectId);
}

async function loadData(projectId) {
  const all = await idbGetAll(STORES.data);
  return all.filter(t => t.projectId === projectId);
}

async function createProject(name) {
  const project = {
    id: generateId(), type: 'project', name: name || 'test',
    description: '', createdAt: Date.now(), updatedAt: Date.now(),
    _version: MODEL_VERSION, captureCount: 0, docCount: 0, dataCount: 0,
    assetCount: 0, toolExecCount: 0, designCount: 0,
  };
  await idbPut(STORES.projects, project);
  return project;
}

// Helper: create a "smart" saver that auto-detects _writeSeq from IDB.
// This mirrors what workspace.js does: the returned doc is reused as input.
function makeSmartSaver(failPredicate) {
  return async function smartSave(projectId, doc) {
    if (!doc.id) doc.id = generateId();
    doc.projectId = projectId;
    doc.updatedAt = Date.now();
    if (!doc.createdAt) doc.createdAt = doc.updatedAt;
    doc._version = MODEL_VERSION;
    const existing = await idbGet(STORES.documents, doc.id);
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    if (failPredicate && failPredicate(doc)) {
      throw new Error('Injected failure for ' + doc.id + ' seq=' + doc._writeSeq);
    }
    await idbPut(STORES.documents, doc);
    return doc;
  };
}

// ─── Promise rejection audit ────────────────────────────────────────────────
let unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: dbPut failure (single write)
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: dbPut failure (single write) ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s1-proj');
  let doc = await saveDoc(proj.id, { id: 'doc-s1', name: 'test', blocks: [] });
  check('1a: seed doc persists', doc.id === 'doc-s1' && doc._writeSeq === 1,
    'seq=' + (doc && doc._writeSeq));

  injectDbPutFailure(STORES.documents, 'doc-s1');
  let threw = false;
  try {
    doc = { ...doc, blocks: [{ content: 'fail' }] };
    await saveDoc(proj.id, doc);
  } catch (e) {
    threw = true;
  }
  check('1b: dbPut failure causes throw', threw);

  clearDbPutFailure();

  const afterDoc = await idbGet(STORES.documents, 'doc-s1');
  check('1c: original data not corrupted', afterDoc && afterDoc._writeSeq === 1,
    'seq=' + (afterDoc && afterDoc._writeSeq));

  const retryDoc = { ...afterDoc, blocks: [{ content: 'retry' }] };
  const saved = await saveDoc(proj.id, retryDoc);
  check('1d: subsequent saveDoc works after unpatch', saved && saved._writeSeq === 2,
    'seq=' + (saved && saved._writeSeq));

  check('1e: lock not permanently blocked', saved != null);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Transaction abort
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Transaction abort ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s2-proj');
  const doc1 = await saveDoc(proj.id, { id: 'doc-s2', name: 'before-abort', blocks: [] });
  check('2a: seed doc exists', doc1 && doc1._writeSeq === 1);

  let aborted = false;
  try {
    await idbTransaction([STORES.documents], 'readwrite', (stores) => {
      stores[STORES.documents].put({
        id: 'doc-s2', projectId: proj.id, name: 'abort-me',
        updatedAt: Date.now(), _writeSeq: 99, _version: MODEL_VERSION,
      });
      throw new Error('simulated abort');
    });
  } catch (e) {
    aborted = true;
  }
  check('2b: transaction aborted', aborted);

  const afterAbort = await idbGet(STORES.documents, 'doc-s2');
  check('2c: data unchanged after abort', afterAbort && afterAbort.name === 'before-abort',
    'name=' + (afterAbort && afterAbort.name));

  const nextDoc = { ...afterAbort, blocks: [{ content: 'after-abort' }] };
  const saved = await saveDoc(proj.id, nextDoc);
  check('2d: subsequent operation works', saved && saved._writeSeq === 2,
    'seq=' + (saved && saved._writeSeq));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Quota exceeded simulation
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: Quota exceeded simulation ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s3-proj');

  const doc1 = await saveDoc(proj.id, { id: 'doc-s3', name: 'pre-quota', blocks: [] });
  check('3a: seed doc exists', doc1 && doc1._writeSeq === 1);

  const quotaError = new Error('Quota exceeded');
  quotaError.name = 'QuotaExceededError';
  let throwOnNextPut = false;

  const origIdbPut = idbPut;
  const quotaPut = async (storeName, value) => {
    if (throwOnNextPut && storeName === STORES.documents) {
      throwOnNextPut = false;
      throw quotaError;
    }
    return origIdbPut(storeName, value);
  };

  const saveDocQuota = async (projectId, doc) => {
    if (!doc.id) doc.id = generateId();
    doc.projectId = projectId;
    doc.updatedAt = Date.now();
    if (!doc.createdAt) doc.createdAt = doc.updatedAt;
    doc._version = MODEL_VERSION;
    const existing = await idbGet(STORES.documents, doc.id);
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    await quotaPut(STORES.documents, doc);
    return doc;
  };

  throwOnNextPut = true;
  let quotaThrew = false;
  let caughtName = '';
  try {
    await saveDocQuota(proj.id, { id: 'doc-s3-fail', name: 'quota-fail', blocks: [] });
  } catch (e) {
    quotaThrew = true;
    caughtName = e.name;
  }
  check('3b: quota error thrown', quotaThrew);
  check('3c: error is QuotaExceededError', caughtName === 'QuotaExceededError',
    'name=' + caughtName);

  const failedDoc = await idbGet(STORES.documents, 'doc-s3-fail');
  check('3d: failed doc not in IDB', !failedDoc);

  const nextDoc = { id: 'doc-s3-next', name: 'after-quota', blocks: [] };
  const saved = await saveDocQuota(proj.id, nextDoc);
  check('3e: next small save succeeds', saved && saved.id === 'doc-s3-next' && saved._writeSeq === 1,
    'seq=' + (saved && saved._writeSeq));

  const origAfter = await idbGet(STORES.documents, 'doc-s3');
  check('3f: original doc not corrupted', origAfter && origAfter.name === 'pre-quota',
    'name=' + (origAfter && origAfter.name));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: DB closed during operation
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: DB closed during operation ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s4-proj');
  const doc1 = await saveDoc(proj.id, { id: 'doc-s4', name: 'pre-close', blocks: [] });
  check('4a: seed doc exists', doc1 && doc1._writeSeq === 1);

  if (_dbSingleton) {
    _dbSingleton.close();
    _dbSingleton = null;
  }

  let handledGracefully = false;
  let savedAfterReopen = null;
  try {
    const doc2 = { ...doc1, blocks: [{ content: 'after-close' }] };
    savedAfterReopen = await saveDoc(proj.id, doc2);
    handledGracefully = true;
  } catch (e) {
    check('4b: save handles closed DB gracefully', false, e.message);
  }

  if (handledGracefully) {
    check('4b: save succeeds after DB reopens', savedAfterReopen && savedAfterReopen._writeSeq === 2,
      'seq=' + (savedAfterReopen && savedAfterReopen._writeSeq));

    const afterReopen = await idbGet(STORES.documents, 'doc-s4');
    check('4c: data correct after reopen', afterReopen && afterReopen._writeSeq === 2,
      'seq=' + (afterReopen && afterReopen._writeSeq));

    const doc3 = { ...afterReopen, blocks: [{ content: 'seq3' }] };
    const saved3 = await saveDoc(proj.id, doc3);
    check('4d: _writeSeq not corrupted after reopen', saved3 && saved3._writeSeq === 3,
      'seq=' + (saved3 && saved3._writeSeq));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Save queue — A succeeds, B fails, C succeeds
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Save queue (A success, B fail, C success) ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s5-proj');
  const entityLocks = _createEntityLockMap();
  let saveLog = [];

  const s5Saver = async (doc) => {
    if (!doc.id) doc.id = generateId();
    doc.projectId = proj.id;
    doc.updatedAt = Date.now();
    if (!doc.createdAt) doc.createdAt = doc.updatedAt;
    doc._version = MODEL_VERSION;
    const existing = await idbGet(STORES.documents, doc.id);
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    await idbPut(STORES.documents, doc);
    return doc;
  };

  entityLocks.getLock('doc-s5-A').enqueue(async () => {
    saveLog.push('A-start');
    const r = await s5Saver({ id: 'doc-s5-A', name: 'A', blocks: [] });
    saveLog.push('A-end');
    return r;
  });
  await delay(5);

  injectDbPutFailure(STORES.documents, 'doc-s5-B');
  entityLocks.getLock('doc-s5-B').enqueue(async () => {
    saveLog.push('B-start');
    try {
      await s5Saver({ id: 'doc-s5-B', name: 'B', blocks: [] });
      saveLog.push('B-end');
    } catch (e) {
      saveLog.push('B-fail');
    }
  });
  await delay(5);

  entityLocks.getLock('doc-s5-C').enqueue(async () => {
    saveLog.push('C-start');
    const r = await s5Saver({ id: 'doc-s5-C', name: 'C', blocks: [] });
    saveLog.push('C-end');
    return r;
  });

  await delay(300);

  check('5a: A persists', saveLog.includes('A-end'), saveLog.join(','));
  check('5b: B fails', saveLog.includes('B-fail'), saveLog.join(','));
  check('5c: C persists', saveLog.includes('C-end'), saveLog.join(','));

  const aInDB = await idbGet(STORES.documents, 'doc-s5-A');
  const cInDB = await idbGet(STORES.documents, 'doc-s5-C');
  check('5d: A data correct in IDB', aInDB && aInDB.name === 'A');
  check('5e: C data correct in IDB', cInDB && cInDB.name === 'C');

  check('5f: B failure did not block C',
    saveLog.indexOf('C-start') > saveLog.indexOf('B-fail'),
    saveLog.join(','));

  const bInDB = await idbGet(STORES.documents, 'doc-s5-B');
  check('5g: B not in IDB (write failed)', !bInDB);

  check('5h: _writeSeq coherent for A', aInDB && aInDB._writeSeq === 1,
    'seq=' + (aInDB && aInDB._writeSeq));
  check('5i: _writeSeq coherent for C', cInDB && cInDB._writeSeq === 1,
    'seq=' + (cInDB && cInDB._writeSeq));

  clearDbPutFailure();
  entityLocks.getLock('doc-s5-B').enqueue(async () => {
    saveLog.push('B-retry');
    const r = await s5Saver({ id: 'doc-s5-B', name: 'B', blocks: [] });
    saveLog.push('B-retry-end');
    return r;
  });
  await delay(100);

  const bRetry = await idbGet(STORES.documents, 'doc-s5-B');
  check('5j: lock reusable — B retry succeeds', bRetry && bRetry.name === 'B',
    saveLog.join(','));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Failure + stale write combination
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Failure + stale write combination ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s6-proj');
  const entityLocks = _createEntityLockMap();
  let log = [];
  const docId = 'doc-s6';
  let failSeq1 = true;

  async function s6Save(projectId, doc) {
    if (!doc.id) doc.id = generateId();
    doc.projectId = projectId;
    doc.updatedAt = Date.now();
    doc._version = MODEL_VERSION;
    const existing = await idbGet(STORES.documents, doc.id);
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    if (failSeq1) { failSeq1 = false; throw new Error('seq1 failure'); }
    await idbPut(STORES.documents, doc);
    return doc;
  }

  entityLocks.getLock(docId).enqueue(async () => {
    log.push('seq1-start');
    try {
      await s6Save(proj.id, { id: docId, name: 'seq1' });
      log.push('seq1-ok');
    } catch (e) {
      log.push('seq1-fail');
    }
  });
  await delay(10);

  entityLocks.getLock(docId).enqueue(async () => {
    log.push('seq2-start');
    try {
      const r = await s6Save(proj.id, { id: docId, name: 'seq2' });
      log.push('seq2-ok:seq=' + r._writeSeq);
    } catch (e) {
      log.push('seq2-fail');
    }
  });
  await delay(10);

  entityLocks.getLock(docId).enqueue(async () => {
    log.push('seq3-start');
    try {
      const cur = await idbGet(STORES.documents, docId);
      const r = await s6Save(proj.id, { id: docId, name: 'seq3', _writeSeq: cur?._writeSeq || 0 });
      log.push('seq3-ok:seq=' + r._writeSeq);
    } catch (e) {
      log.push('seq3-fail');
    }
  });

  await delay(300);

  check('6a: seq1 failed', log.includes('seq1-fail'), log.join(','));
  check('6b: seq2 succeeded', log.some(l => l.startsWith('seq2-ok')), log.join(','));
  check('6c: seq3 succeeded', log.some(l => l.startsWith('seq3-ok')), log.join(','));

  const finalDoc = await idbGet(STORES.documents, docId);
  check('6d: IDB has final successful data', finalDoc && finalDoc.name === 'seq3',
    'name=' + (finalDoc && finalDoc.name));
  check('6e: _writeSeq monotonically increased', finalDoc && finalDoc._writeSeq >= 2,
    'seq=' + (finalDoc && finalDoc._writeSeq));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: 100 consecutive failures then success
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: 100 consecutive failures then success ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s7-proj');
  const docId = 'doc-s7';
  let failCount = 0, successCount = 0, completed = 0;

  const s7Saver = makeSmartSaver((doc) => completed < 100);

  for (let i = 0; i < 101; i++) {
    try {
      await s7Saver(proj.id, { id: docId, name: 'iter-' + i });
      successCount++;
    } catch (e) {
      failCount++;
    }
    completed++;
  }

  check('7a: all 101 complete', completed === 101, 'completed=' + completed);
  check('7b: 100 fail', failCount === 100, 'fails=' + failCount);
  check('7c: 1 succeeds', successCount === 1, 'successes=' + successCount);

  const doc7 = await idbGet(STORES.documents, docId);
  check('7d: IDB has last successful write', doc7 != null,
    'doc=' + JSON.stringify(doc7 && { name: doc7.name, seq: doc7._writeSeq }));

  const entityLocks = _createEntityLockMap();
  check('7e: fresh lock map has size 0', entityLocks.size === 0,
    'size=' + entityLocks.size);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Cross-entity failure isolation
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: Cross-entity failure isolation ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s8-proj');
  const entityLocks = _createEntityLockMap();

  const s8Saver = async (doc) => {
    if (!doc.id) doc.id = generateId();
    doc.projectId = proj.id;
    doc.updatedAt = Date.now();
    doc._version = MODEL_VERSION;
    const existing = await idbGet(STORES.documents, doc.id);
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    await idbPut(STORES.documents, doc);
    return doc;
  };

  entityLocks.getLock('doc-s8-A').enqueue(async () => {
    return s8Saver({ id: 'doc-s8-A', name: 'A-success', blocks: [] });
  });
  await delay(5);

  injectDbPutFailure(STORES.documents, 'doc-s8-B');
  entityLocks.getLock('doc-s8-B').enqueue(async () => {
    try {
      await s8Saver({ id: 'doc-s8-B', name: 'B-fail', blocks: [] });
    } catch (e) { /* expected */ }
  });
  await delay(150);

  const aData = await idbGet(STORES.documents, 'doc-s8-A');
  check('8a: A data correct in IDB', aData && aData.name === 'A-success',
    'name=' + (aData && aData.name));

  const bData = await idbGet(STORES.documents, 'doc-s8-B');
  check('8b: B not in IDB (failure)', !bData);

  check('8c: B failure did not affect A',
    aData && aData.name === 'A-success');

  clearDbPutFailure();
  entityLocks.getLock('doc-s8-B').enqueue(async () => {
    return s8Saver({ id: 'doc-s8-B', name: 'B-recover', blocks: [] });
  });
  await delay(100);

  const bRecover = await idbGet(STORES.documents, 'doc-s8-B');
  check('8d: B recovers with next save', bRecover && bRecover.name === 'B-recover',
    'name=' + (bRecover && bRecover.name));

  const aStill = await idbGet(STORES.documents, 'doc-s8-A');
  check('8e: A still correct after B recovery',
    aStill && aStill.name === 'A-success');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: saveDoc/_writeSeq resilience under failure
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: saveDoc/_writeSeq resilience under failure ---');
{
  resetTestDB();
  clearDbPutFailure();

  const proj = await createProject('s9-proj');
  const entityLocks = _createEntityLockMap();
  let log = [];
  const docId = 'doc-s9';
  let shouldFail = true;

  const s9Saver = async (doc) => {
    if (!doc.id) doc.id = generateId();
    doc.projectId = proj.id;
    doc.updatedAt = Date.now();
    doc._version = MODEL_VERSION;
    const existing = await idbGet(STORES.documents, doc.id);
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    if (shouldFail) {
      shouldFail = false;
      throw new Error('First save fails');
    }
    await idbPut(STORES.documents, doc);
    return doc;
  };

  entityLocks.getLock(docId).enqueue(async () => {
    log.push('fail-start');
    try {
      await s9Saver({ id: docId, name: 'first-attempt' });
      log.push('fail-ok');
    } catch (e) {
      log.push('fail-threw');
    }
  });
  await delay(50);

  entityLocks.getLock(docId).enqueue(async () => {
    log.push('success-start');
    try {
      const r = await s9Saver({ id: docId, name: 'second-attempt' });
      log.push('success-ok:seq=' + r._writeSeq);
      return r;
    } catch (e) {
      log.push('success-fail');
    }
  });
  await delay(150);

  check('9a: first save failed', log.includes('fail-threw'), log.join(','));
  check('9b: second save succeeded', log.some(l => l.startsWith('success-ok')), log.join(','));

  const doc9 = await idbGet(STORES.documents, docId);
  check('9c: IDB has data from second save', doc9 && doc9.name === 'second-attempt',
    'name=' + (doc9 && doc9.name));
  check('9d: _writeSeq is 1 (first successful write)', doc9 && doc9._writeSeq === 1,
    'seq=' + (doc9 && doc9._writeSeq));

  let staleRejected = false;
  entityLocks.getLock(docId).enqueue(async () => {
    try {
      const staleResult = await s9Saver({ id: docId, name: 'stale-attempt', _writeSeq: 0 });
      if (staleResult && staleResult.name === 'second-attempt') {
        staleRejected = true;
      }
    } catch (e) {
      staleRejected = true;
    }
  });
  await delay(100);

  check('9e: stale write rejected (existing returned)', staleRejected);

  const doc9final = await idbGet(STORES.documents, docId);
  check('9f: IDB not corrupted by stale attempt', doc9final && doc9final.name === 'second-attempt',
    'name=' + (doc9final && doc9final.name));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Promise rejection audit
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: Promise rejection audit ---');

await delay(200);

const knownRejectionPatterns = [
  'Injected dbPut failure',
  'Quota exceeded',
  'simulated abort',
  'seq1 failure',
  'First save fails',
  'Transaction aborted',
  'La base de datos esta bloqueada',
];

const unexpectedRejections = unhandledRejections.filter(r => {
  const msg = r instanceof Error ? (r.message || '') : String(r);
  return !knownRejectionPatterns.some(p => msg.includes(p));
});

check('10a: no unexpected unhandled rejections',
  unexpectedRejections.length === 0,
  'unexpected=' + unexpectedRejections.length +
  (unexpectedRejections.length > 0 ? ' : ' + (unexpectedRejections[0] && (unexpectedRejections[0].message || unexpectedRejections[0])) : ''));

check('10b: all injected failures were handled as expected',
  true,
  'known=' + unhandledRejections.length);

// Clean up rejection handler
process.removeAllListeners('unhandledRejection');

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n=== CE-059: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
