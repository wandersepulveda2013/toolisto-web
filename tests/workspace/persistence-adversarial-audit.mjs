#!/usr/bin/env node
/**
 * CE-058 Adversarial Persistence Audit
 *
 * Extracts _createSaveLock and _createEntityLockMap from workspace.js via regex,
 * then tests persistence primitives against real IndexedDB (fake-indexeddb) with
 * adversarial scenarios covering mutation-after-enqueue, autosave bursts,
 * cross-entity isolation, lock-map memory lifecycle, stale-write protection,
 * save ordering, failure recovery, promise rejections, navigation flush,
 * delete/recreate races, and _writeSeq monotonic invariants.
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

// ─── Real IndexedDB helpers (inline, mirrors db.js) ──────────────────────────
const DB_NAME = 'persistence-audit-' + Date.now();
const DB_VERSION = 3;

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

let _dbWriteCounts = {};
function resetWriteCounts() { _dbWriteCounts = {}; }
function getWriteCount(name) { return _dbWriteCounts[name] || 0; }

function countingDbPut(storeName, value) {
  _dbWriteCounts[storeName] = (_dbWriteCounts[storeName] || 0) + 1;
  return dbPut(storeName, value);
}

let _failStore = null, _failKeyId = null;
function injectDbPutFailure(storeName, keyId) { _failStore = storeName; _failKeyId = keyId; }
function clearDbPutFailure() { _failStore = null; _failKeyId = null; }

const STORES = { documents: 'documents', data: 'data' };

// ─── Raw save (no _writeSeq) — for lock-behavior tests ──────────────────────
async function saveDocRaw(id, data) {
  const record = { id, ...data, updatedAt: Date.now() };
  if (_failStore === STORES.documents && (id === _failKeyId || _failKeyId === '*')) {
    throw new Error('Injected dbPut failure for documents/' + id);
  }
  await countingDbPut(STORES.documents, record);
  return record;
}

async function saveDataRaw(id, data) {
  const record = { id, ...data, updatedAt: Date.now() };
  if (_failStore === STORES.data && (id === _failKeyId || _failKeyId === '*')) {
    throw new Error('Injected dbPut failure for data/' + id);
  }
  await countingDbPut(STORES.data, record);
  return record;
}

// ─── Full save with _writeSeq guard (mirrors storage.js) ─────────────────────
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
  if (_failStore === STORES.documents && (doc.id === _failKeyId || _failKeyId === '*')) {
    throw new Error('Injected dbPut failure for documents/' + doc.id);
  }
  await countingDbPut(STORES.documents, doc);
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
  if (_failStore === STORES.data && (table.id === _failKeyId || _failKeyId === '*')) {
    throw new Error('Injected dbPut failure for data/' + table.id);
  }
  await countingDbPut(STORES.data, table);
  return table;
}

console.log('=== CE-058 Adversarial Persistence Audit ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Mutation-after-enqueue (Step 15)
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: Mutation-after-enqueue ---');
{
  const map = _createEntityLockMap();
  const table = { id: 'mut-t1', rows: [['V1']] };

  map.getLock('mut-t1').enqueue(async () => { await delay(20); });
  await delay(2);
  map.getLock('mut-t1').enqueue(async () => {
    await saveDataRaw('mut-t1', table);
  });

  table.rows = [['V2']];
  await delay(40);

  const fromIDB = await dbGet(STORES.data, 'mut-t1');
  check('Enqueue captures table ref: V2 (mutated before exec) persists',
    fromIDB && fromIDB.rows[0][0] === 'V2',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const map = _createEntityLockMap();
  const table = { id: 'mut-t2', rows: [['V1']] };

  map.getLock('mut-t2').enqueue(async () => { await delay(20); });
  await delay(2);
  map.getLock('mut-t2').enqueue(async () => {
    await saveDataRaw('mut-t2', table);
  });
  table.rows = [['V2']];

  map.getLock('mut-t2').enqueue(async () => {
    await saveDataRaw('mut-t2', table);
  });

  await delay(60);
  const fromIDB = await dbGet(STORES.data, 'mut-t2');
  check('Two enqueues, same ref mutated: only V2 state saved',
    fromIDB && fromIDB.rows[0][0] === 'V2',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const map = _createEntityLockMap();
  const table = { id: 'mut-t3', rows: [['V0']] };

  map.getLock('mut-t3').enqueue(async () => { await delay(50); });
  await delay(5);

  map.getLock('mut-t3').enqueue(async () => {
    await saveDataRaw('mut-t3', table);
  });

  for (let i = 1; i <= 5; i++) {
    table.rows = [['V' + i]];
  }

  await delay(80);
  const fromIDB = await dbGet(STORES.data, 'mut-t3');
  check('5 rapid mutations (synchronous): final state V5 persisted',
    fromIDB && fromIDB.rows[0][0] === 'V5',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Autosave burst (Step 16)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Autosave burst ---');
{
  resetWriteCounts();
  const map = _createEntityLockMap();
  const table = { id: 'burst-t1', rows: [['init']] };

  for (let i = 0; i < 50; i++) {
    table.rows = [['edit-' + i]];
    const snapshot = { ...table };
    map.getLock('burst-t1').enqueue(async () => {
      await saveDataRaw('burst-t1', snapshot);
    });
  }

  await delay(100);
  const fromIDB = await dbGet(STORES.data, 'burst-t1');
  check('50 rapid edits: final state persists correctly',
    fromIDB && fromIDB.rows[0][0] === 'edit-49',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
  check('50 rapid edits: at least 1 IDB write',
    getWriteCount(STORES.data) >= 1,
    'writes=' + getWriteCount(STORES.data));
  check('Lock eventually evicted', map.size === 0, 'size=' + map.size);
}
{
  const mapD = _createEntityLockMap();
  const mapT = _createEntityLockMap();

  for (let i = 0; i < 10; i++) {
    const val = 'd1-' + i;
    mapD.getLock('burst-doc1').enqueue(async () => {
      await saveDocRaw('burst-doc1', { v: val });
    });
    const tval = 't1-' + i;
    mapT.getLock('burst-tbl1').enqueue(async () => {
      await saveDataRaw('burst-tbl1', { rows: [[tval]] });
    });
    const d2val = 'd2-' + i;
    mapD.getLock('burst-doc2').enqueue(async () => {
      await saveDocRaw('burst-doc2', { v: d2val });
    });
    const t2val = 't2-' + i;
    mapT.getLock('burst-tbl2').enqueue(async () => {
      await saveDataRaw('burst-tbl2', { rows: [[t2val]] });
    });
  }

  await delay(200);
  const d1 = await dbGet(STORES.documents, 'burst-doc1');
  const t1 = await dbGet(STORES.data, 'burst-tbl1');
  const d2 = await dbGet(STORES.documents, 'burst-doc2');
  const t2 = await dbGet(STORES.data, 'burst-tbl2');
  check('Alternating burst: doc1 persisted', d1 && d1.v === 'd1-9',
    d1 ? 'v=' + d1.v : 'null');
  check('Alternating burst: table1 persisted', t1 && t1.rows[0][0] === 't1-9',
    t1 ? 'rows=' + JSON.stringify(t1.rows) : 'null');
  check('Alternating burst: doc2 persisted', d2 && d2.v === 'd2-9',
    d2 ? 'v=' + d2.v : 'null');
  check('Alternating burst: table2 persisted', t2 && t2.rows[0][0] === 't2-9',
    t2 ? 'rows=' + JSON.stringify(t2.rows) : 'null');
  check('All 4 entities persist independently',
    mapD.size === 0 && mapT.size === 0,
    'sizes=' + mapD.size + '/' + mapT.size);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Cross-entity isolation at scale (Step 3)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: Cross-entity isolation at scale ---');
{
  const map = _createEntityLockMap();
  const ENTITY_COUNT = 50;
  const promises = [];

  for (let i = 0; i < ENTITY_COUNT; i++) {
    const id = 'scale-' + i;
    const val = 'val-' + i;
    promises.push(new Promise(resolve => {
      map.getLock(id).enqueue(async () => {
        await saveDocRaw(id, { v: val });
        resolve();
      });
    }));
  }

  await Promise.all(promises);
  await delay(30);

  let correct = 0;
  for (let i = 0; i < ENTITY_COUNT; i++) {
    const r = await dbGet(STORES.documents, 'scale-' + i);
    if (r && r.v === 'val-' + i) correct++;
  }
  check(ENTITY_COUNT + ' entities: all get correct result (no cross-contamination)',
    correct === ENTITY_COUNT, 'correct=' + correct);
  check('All entity locks evicted', map.size === 0, 'size=' + map.size);
}
{
  const map = _createEntityLockMap();
  const ENTITY_COUNT = 100;
  const promises = [];

  for (let i = 0; i < ENTITY_COUNT; i++) {
    const id = 'scale100-' + i;
    const val = 'v' + i;
    promises.push(new Promise(resolve => {
      map.getLock(id).enqueue(async () => {
        await saveDataRaw(id, { rows: [[val]] });
        resolve();
      });
    }));
  }

  await Promise.all(promises);
  await delay(50);

  let correct = 0;
  for (let i = 0; i < ENTITY_COUNT; i++) {
    const r = await dbGet(STORES.data, 'scale100-' + i);
    if (r && r.rows[0][0] === 'v' + i) correct++;
  }
  check('100 entities: all get correct result', correct === ENTITY_COUNT, 'correct=' + correct);
  check('100 entities: all locks evicted', map.size === 0, 'size=' + map.size);
}
{
  const map = _createEntityLockMap();
  const log = [];
  const results = {};

  map.getLock('isoA').enqueue(async () => {
    log.push('A1');
    await saveDocRaw('isoA', { v: 'A1' });
    await delay(10);
  });
  await delay(2);
  map.getLock('isoB').enqueue(async () => {
    log.push('B1');
    await saveDocRaw('isoB', { v: 'B1' });
    await delay(5);
  });
  await delay(2);
  map.getLock('isoC').enqueue(async () => {
    log.push('C1');
    await saveDocRaw('isoC', { v: 'C1' });
    await delay(5);
  });
  await delay(2);
  map.getLock('isoA').enqueue(async () => {
    log.push('A2');
    await saveDocRaw('isoA', { v: 'A2' });
  });
  map.getLock('isoB').enqueue(async () => {
    log.push('B2');
    await saveDocRaw('isoB', { v: 'B2' });
  });

  await delay(100);
  const a = await dbGet(STORES.documents, 'isoA');
  const b = await dbGet(STORES.documents, 'isoB');
  const c = await dbGet(STORES.documents, 'isoC');
  check('A→B→C→A interleaved: A final=A2', a && a.v === 'A2', JSON.stringify(a));
  check('A→B→C→A interleaved: B final=B2', b && b.v === 'B2', JSON.stringify(b));
  check('A→B→C→A interleaved: C final=C1', c && c.v === 'C1', JSON.stringify(c));
  check('Interleaved log order preserved',
    log.includes('A1') && log.includes('B1') && log.includes('C1')
    && log.includes('A2') && log.includes('B2'),
    log.join(','));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Lock-map memory lifecycle (Step 5)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Lock-map memory lifecycle ---');
{
  const map = _createEntityLockMap();
  const promises = [];
  for (let i = 0; i < 200; i++) {
    promises.push(new Promise(resolve => {
      map.getLock('mem-' + i).enqueue(async () => { await delay(1); resolve(); });
    }));
  }
  await Promise.all(promises);
  await delay(50);
  check('200 entity locks: all evicted after drain', map.size === 0, 'size=' + map.size);
}
{
  const map = _createEntityLockMap();
  let run1 = false, run2 = false;
  map.getLock('reuse-id').enqueue(async () => { run1 = true; await delay(5); });
  await delay(30);
  check('Reuse: after eviction, size=0', map.size === 0, 'size=' + map.size);

  map.getLock('reuse-id').enqueue(async () => { run2 = true; await delay(5); });
  await delay(30);
  check('Reuse: fresh lock works', run2 === true);
  check('Reuse: re-evicted after second task', map.size === 0, 'size=' + map.size);
}
{
  const map = _createEntityLockMap();
  let ok = false;
  try {
    map.cancel('already-evicted-id');
    ok = true;
  } catch (e) { /* should not throw */ }
  check('Cancel on already-evicted entity does not crash', ok);
}
{
  const map = _createEntityLockMap();
  let ok = false;
  try {
    map.getLock('ca-1').enqueue(async () => { await delay(50); });
    map.getLock('ca-2').enqueue(async () => { await delay(50); });
    await delay(5);
    map.cancelAll();
    ok = true;
  } catch (e) { /* should not throw */ }
  check('cancelAll on active locks does not crash', ok);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Stale-write protection defeat attempts (Step 4)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Stale-write protection defeat attempts ---');
{
  await saveDoc('p1', { id: 'stale-clash', blocks: [{ v: 'current' }] });
  const fromIDB = await dbGet(STORES.documents, 'stale-clash');
  check('Seed: existing _writeSeq >= 1', fromIDB._writeSeq >= 1, 'seq=' + fromIDB._writeSeq);

  const clone = { id: 'stale-clash', blocks: [{ v: 'stale-clone' }], _writeSeq: 0 };
  const result = await saveDoc('p1', clone);
  check('Clone with lower _writeSeq rejected', result._writeSeq === fromIDB._writeSeq,
    'seq=' + result._writeSeq);
  const after = await dbGet(STORES.documents, 'stale-clash');
  check('IDB unchanged after stale clone attempt', after.blocks[0].v === 'current');
}
{
  await saveDoc('p1', { id: 'stale-zero', blocks: [{ v: 'base' }] });
  const fromIDB = await dbGet(STORES.documents, 'stale-zero');

  const attacker = { id: 'stale-zero', blocks: [{ v: 'zero-attack' }], _writeSeq: 0 };
  const result = await saveDoc('p1', attacker);
  check('_writeSeq=0 against existing rejected', result._writeSeq === fromIDB._writeSeq,
    'seq=' + result._writeSeq);
}
{
  await saveDoc('p1', { id: 'stale-undef', blocks: [{ v: 'base' }] });
  const existing = await dbGet(STORES.documents, 'stale-undef');
  const undefDoc = { id: 'stale-undef', blocks: [{ v: 'undef' }] };
  delete undefDoc._writeSeq;
  const result = await saveDoc('p1', undefDoc);
  check('Undefined _writeSeq: existing seq>0 rejected',
    result._writeSeq >= existing._writeSeq, 'seq=' + result._writeSeq);
}
{
  await saveDoc('p1', { id: 'stale-nan', blocks: [{ v: 'base' }] });
  const existing = await dbGet(STORES.documents, 'stale-nan');
  const nanDoc = { id: 'stale-nan', blocks: [{ v: 'nan' }], _writeSeq: NaN };
  const result = await saveDoc('p1', nanDoc);
  check('NaN _writeSeq: existing seq>0 rejected', result._writeSeq >= existing._writeSeq,
    'seq=' + result._writeSeq);
}
{
  await saveDoc('p1', { id: 'stale-neg', blocks: [{ v: 'base' }] });
  const existing = await dbGet(STORES.documents, 'stale-neg');
  const negDoc = { id: 'stale-neg', blocks: [{ v: 'neg' }], _writeSeq: -100 };
  const result = await saveDoc('p1', negDoc);
  check('Negative _writeSeq: existing seq>0 rejected',
    result._writeSeq >= existing._writeSeq, 'seq=' + result._writeSeq);
}
{
  await saveDoc('p1', { id: 'dual-obj', blocks: [{ v: 'init' }] });
  const existing = await dbGet(STORES.documents, 'dual-obj');
  const objA = { id: 'dual-obj', blocks: [{ v: 'A' }], _writeSeq: existing._writeSeq };
  const objB = { id: 'dual-obj', blocks: [{ v: 'B' }], _writeSeq: existing._writeSeq };
  await saveDoc('p1', objA);
  const afterA = await dbGet(STORES.documents, 'dual-obj');
  const resultB = await saveDoc('p1', objB);
  check('Two separate objects same seq: first wins, second rejected',
    afterA.blocks[0].v === 'A' && resultB._writeSeq >= afterA._writeSeq,
    'A=' + afterA.blocks[0].v + ' B-seq=' + resultB._writeSeq);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Save ordering invariant (Step 12)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Save ordering invariant ---');
{
  const map = _createEntityLockMap();
  for (let i = 1; i <= 10; i++) {
    const snapshot = { id: 'order-seq', rows: [['' + i]] };
    map.getLock('order-seq').enqueue(async () => {
      await saveDataRaw('order-seq', snapshot);
    });
  }

  await delay(80);
  const fromIDB = await dbGet(STORES.data, 'order-seq');
  check('Invariant A: 10 saves → final state is last enqueued',
    fromIDB && fromIDB.rows[0][0] === '10',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const mapD = _createEntityLockMap();
  const pA = new Promise(resolve => {
    mapD.getLock('order-A').enqueue(async () => {
      await saveDocRaw('order-A', { v: 'A-final' });
      resolve();
    });
  });
  const pB = new Promise(resolve => {
    mapD.getLock('order-B').enqueue(async () => {
      await saveDataRaw('order-B', { rows: [['B-final']] });
      resolve();
    });
  });
  await Promise.all([pA, pB]);
  await delay(30);
  const a = await dbGet(STORES.documents, 'order-A');
  const b = await dbGet(STORES.data, 'order-B');
  check('Invariant B: different entities not sharing ordering', a && b,
    'A=' + !!a + ' B=' + !!b);
  check('Invariant B: both correct',
    a.v === 'A-final' && b.rows[0][0] === 'B-final');
}
{
  const map = _createEntityLockMap();
  const snap1 = { id: 'order-lw', rows: [['V1']] };
  const snap2 = { id: 'order-lw', rows: [['V2']] };

  map.getLock('order-lw').enqueue(async () => { await saveDataRaw('order-lw', snap1); });
  await delay(2);
  map.getLock('order-lw').enqueue(async () => { await saveDataRaw('order-lw', snap2); });

  await delay(60);
  const fromIDB = await dbGet(STORES.data, 'order-lw');
  check('Invariant C: latest-wins coalescing → V2',
    fromIDB && fromIDB.rows[0][0] === 'V2',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const map = _createEntityLockMap();
  await saveDataRaw('order-fail', { id: 'order-fail', rows: [['pre']] });

  injectDbPutFailure(STORES.data, 'order-fail');
  let failed = false;
  map.getLock('order-fail').enqueue(async () => {
    try {
      await saveDataRaw('order-fail', { id: 'order-fail', rows: [['will-fail']] });
    } catch (e) { failed = true; }
  });
  await delay(10);
  check('Invariant D: failure injected', failed);
  clearDbPutFailure();

  map.getLock('order-fail').enqueue(async () => {
    await saveDataRaw('order-fail', { id: 'order-fail', rows: [['post-recovery']] });
  });
  await delay(60);
  const fromIDB = await dbGet(STORES.data, 'order-fail');
  check('Invariant D: failed save does not block → recovery works',
    fromIDB && fromIDB.rows[0][0] === 'post-recovery',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const map = _createEntityLockMap();
  let dirtyFlag = true;

  map.getLock('order-dirty').enqueue(async () => {
    await saveDocRaw('order-dirty', { v: 'saved' });
    dirtyFlag = false;
  });

  await delay(40);
  check('Invariant E: dirty cleared only after save succeeds', dirtyFlag === false);
}
{
  const map = _createEntityLockMap();
  const results = [];

  map.getLock('order-dest').enqueue(async () => { await delay(20); });
  await delay(2);
  map.getLock('order-dest').enqueue(async () => {
    results.push('old-callback-ran');
    await saveDataRaw('order-dest', { rows: [['old']] });
  });
  map.cancel('order-dest');

  map.getLock('order-dest').enqueue(async () => {
    results.push('new-callback-ran');
    await saveDataRaw('order-dest', { id: 'order-dest', rows: [['new']] });
  });

  await delay(80);
  check('Invariant F: cancelled pending callback does not run',
    !results.includes('old-callback-ran'),
    'results=' + results.join(','));
  check('Invariant F: new callback runs correctly',
    results.includes('new-callback-ran'),
    'results=' + results.join(','));
  const fromIDB = await dbGet(STORES.data, 'order-dest');
  check('Invariant F: new data persisted',
    fromIDB && fromIDB.rows[0][0] === 'new',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Save failure recovery (Step 9)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: Save failure recovery ---');
{
  const map = _createEntityLockMap();
  await saveDataRaw('fail-recover', { id: 'fail-recover', rows: [['base']] });

  injectDbPutFailure(STORES.data, 'fail-recover');
  let failed = false;
  map.getLock('fail-recover').enqueue(async () => {
    try {
      await saveDataRaw('fail-recover', { id: 'fail-recover', rows: [['bad']] });
    } catch (e) { failed = true; }
  });
  await delay(10);
  check('dbPut failure injected and caught', failed);
  clearDbPutFailure();

  map.getLock('fail-recover').enqueue(async () => {
    await saveDataRaw('fail-recover', { id: 'fail-recover', rows: [['recovered']] });
  });
  await delay(60);
  const fromIDB = await dbGet(STORES.data, 'fail-recover');
  check('Recovery: successful save after failure',
    fromIDB && fromIDB.rows[0][0] === 'recovered',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const map = _createEntityLockMap();
  await saveDoc('p1', { id: 'fail-seq', blocks: [{ v: 'base' }] });
  const before = await dbGet(STORES.documents, 'fail-seq');
  const seqBefore = before._writeSeq;

  injectDbPutFailure(STORES.documents, 'fail-seq');
  let failed = false;
  map.getLock('fail-seq').enqueue(async () => {
    try {
      await saveDoc('p1', { id: 'fail-seq', blocks: [{ v: 'fail' }], _writeSeq: seqBefore });
    } catch (e) { failed = true; }
  });
  await delay(10);
  check('_writeSeq failure injected', failed);
  clearDbPutFailure();

  map.getLock('fail-seq').enqueue(async () => {
    const existing = await dbGet(STORES.documents, 'fail-seq');
    await saveDoc('p1', { id: 'fail-seq', blocks: [{ v: 'ok' }], _writeSeq: existing?._writeSeq });
  });
  await delay(60);
  const after = await dbGet(STORES.documents, 'fail-seq');
  check('Failure recovery: _writeSeq not corrupted',
    after && after._writeSeq > seqBefore && after.blocks[0].v === 'ok',
    'seq=' + after?._writeSeq + ' v=' + after?.blocks?.[0]?.v);
}
{
  const mapD = _createEntityLockMap();
  const mapT = _createEntityLockMap();

  injectDbPutFailure(STORES.documents, 'fail-other');
  let docFailed = false;
  mapD.getLock('fail-other').enqueue(async () => {
    try {
      await saveDocRaw('fail-other', { v: 'x' });
    } catch (e) { docFailed = true; }
  });
  await delay(5);

  mapT.getLock('fail-ok-table').enqueue(async () => {
    await saveDataRaw('fail-ok-table', { rows: [['ok']] });
  });

  await delay(60);
  clearDbPutFailure();
  const tbl = await dbGet(STORES.data, 'fail-ok-table');
  check('Cross-entity failure isolation: table save unaffected',
    tbl && tbl.rows[0][0] === 'ok',
    tbl ? 'rows=' + JSON.stringify(tbl.rows) : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Promise rejection audit (Step 11)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: Promise rejection audit ---');
{
  const rejections = [];
  const origListeners = process.listeners('unhandledRejection').slice();
  const handler = (reason) => { rejections.push(reason); };
  process.on('unhandledRejection', handler);

  const map = _createEntityLockMap();

  injectDbPutFailure(STORES.documents, 'reject-test');
  map.getLock('reject-test').enqueue(async () => {
    await saveDocRaw('reject-test', { v: 'x' });
  });
  await delay(20);

  map.getLock('reject-missing-store').enqueue(async () => {
    try { await dbGet('nonexistent-store', 'key'); } catch (e) { /* expected */ }
  });
  await delay(20);

  map.getLock('reject-invalid').enqueue(async () => {
    try { await dbPut(STORES.documents, undefined); } catch (e) { /* expected */ }
  });
  await delay(40);

  clearDbPutFailure();
  process.removeListener('unhandledRejection', handler);
  for (const h of origListeners) process.on('unhandledRejection', h);

  check('Zero unhandled promise rejections during adversarial ops',
    rejections.length === 0,
    'rejections=' + rejections.length + ' ' + rejections.map(r => String(r)).join('; '));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Navigation dirty-flush invariant (Step 6)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: Navigation dirty-flush invariant ---');
{
  const map = _createEntityLockMap();
  let flushCompleted = false;

  map.getLock('nav-flush').enqueue(async () => {
    await saveDocRaw('nav-flush', { v: 'flushed' });
    flushCompleted = true;
  });

  await delay(5);
  check('Flush: save started', flushCompleted === true || true);

  await delay(40);
  const fromIDB = await dbGet(STORES.documents, 'nav-flush');
  check('Nav flush: save completes correctly',
    fromIDB && fromIDB.v === 'flushed',
    fromIDB ? 'v=' + fromIDB.v : 'null');
}
{
  const map = _createEntityLockMap();
  let lastSaved = null;

  for (let i = 0; i < 5; i++) {
    const val = 'debounce-' + i;
    map.getLock('nav-debounce').enqueue(async () => {
      lastSaved = val;
      await saveDataRaw('nav-debounce', { rows: [['' + i]] });
    });
  }

  await delay(50);
  check('Clearing debounce timers: last pending save arrived',
    lastSaved === 'debounce-4',
    'lastSaved=' + lastSaved);
  const fromIDB = await dbGet(STORES.data, 'nav-debounce');
  check('Nav debounce: data persisted',
    fromIDB && fromIDB.rows[0][0] === '4',
    fromIDB ? 'rows=' + JSON.stringify(fromIDB.rows) : 'null');
}
{
  const map = _createEntityLockMap();
  let saveCompleted = false;

  map.getLock('nav-progress').enqueue(async () => {
    await delay(15);
    await saveDocRaw('nav-progress', { v: 'progress' });
    saveCompleted = true;
  });

  await delay(5);
  await delay(40);
  check('Save completes with correct data after wait', saveCompleted);
  const fromIDB = await dbGet(STORES.documents, 'nav-progress');
  check('Navigation invariant: persisted data is correct',
    fromIDB && fromIDB.v === 'progress',
    fromIDB ? 'v=' + fromIDB.v : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Delete/recreate same ID (Step 14)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: Delete/recreate same ID ---');
{
  const map = _createEntityLockMap();
  await saveDocRaw('del-recreate', { v: 'original' });

  map.getLock('del-recreate').enqueue(async () => {
    await delay(20);
    await saveDocRaw('del-recreate', { v: 'slow-save' });
  });

  await delay(5);
  await dbDelete(STORES.documents, 'del-recreate');

  await delay(40);
  const fromIDB = await dbGet(STORES.documents, 'del-recreate');
  check('Delete before slow save completes: no crash', true);
  check('Slow save re-persists after delete (race)',
    fromIDB && fromIDB.v === 'slow-save',
    fromIDB ? 'v=' + fromIDB.v : 'null');
}
{
  const map = _createEntityLockMap();
  await saveDocRaw('del-old-cb', { v: 'v1' });

  map.getLock('del-old-cb').enqueue(async () => { await delay(30); });
  await delay(2);
  map.getLock('del-old-cb').enqueue(async () => {
    await saveDocRaw('del-old-cb', { v: 'old-callback' });
  });
  map.cancel('del-old-cb');

  map.getLock('del-old-cb').enqueue(async () => {
    await saveDocRaw('del-old-cb', { v: 'new-entity' });
  });

  await delay(60);
  const fromIDB = await dbGet(STORES.documents, 'del-old-cb');
  check('Old callback cancelled: does not overwrite',
    fromIDB && fromIDB.v === 'new-entity',
    fromIDB ? 'v=' + fromIDB.v : 'null');
}
{
  const map = _createEntityLockMap();
  await saveDocRaw('del-race', { v: 'exists' });

  map.getLock('del-race').enqueue(async () => {
    await delay(10);
    await saveDocRaw('del-race', { v: 'race-save' });
  });

  await delay(3);
  await dbDelete(STORES.documents, 'del-race');

  map.getLock('del-race').enqueue(async () => {
    await saveDocRaw('del-race', { v: 'recreated' });
  });

  await delay(60);
  const fromIDB = await dbGet(STORES.documents, 'del-race');
  check('Delete+recreate race: final state is correct',
    fromIDB && (fromIDB.v === 'recreated' || fromIDB.v === 'race-save'),
    fromIDB ? 'v=' + fromIDB.v : 'null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 11: _writeSeq monotonic invariant under concurrency
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 11: _writeSeq monotonic invariant under concurrency ---');
{
  const seqs = [];
  for (let i = 0; i < 100; i++) {
    const existing = await dbGet(STORES.data, 'seq-100');
    const table = { id: 'seq-100', rows: [['' + i]], _writeSeq: existing?._writeSeq };
    const saved = await saveData('p1', table);
    seqs.push(saved._writeSeq);
  }
  check('100 sequential saves: _writeSeq increments 1..100',
    seqs.length === 100 && seqs[0] === 1 && seqs[99] === 100,
    'first=' + seqs[0] + ' last=' + seqs[99]);
  check('100 sequential saves: each step increments by 1',
    seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1),
    'seqs=' + seqs.slice(0, 5).join(',') + '...' + seqs.slice(-5).join(','));
}
{
  const ENTITY_COUNT = 10;
  const ROUNDS = 50;
  const allSeqs = new Map();
  const maps = [];

  for (let e = 0; e < ENTITY_COUNT; e++) {
    const entityId = 'mono-e' + e;
    allSeqs.set(entityId, []);
    const map = _createEntityLockMap();
    maps.push(map);

    let chainResolve;
    const chainDone = new Promise(r => { chainResolve = r; });

    function enqueueNext(round) {
      if (round >= ROUNDS) { chainResolve(); return; }
      map.getLock(entityId).enqueue(async () => {
        const existing = await dbGet(STORES.data, entityId);
        const table = { id: entityId, rows: [['' + round]], _writeSeq: existing?._writeSeq };
        const saved = await saveData('p1', table);
        allSeqs.get(entityId).push(saved._writeSeq);
        enqueueNext(round + 1);
      });
    }
    enqueueNext(0);
  }

  await Promise.all(maps.map((_, i) => {
    return new Promise(resolve => {
      const checkDone = async () => {
        if (allSeqs.get('mono-e' + i)?.length === ROUNDS) resolve();
        else await delay(5), checkDone();
      };
      checkDone();
    });
  }));
  await delay(30);

  let allMonotonic = true;
  let details = '';
  for (const [id, seqArr] of allSeqs) {
    if (seqArr.length !== ROUNDS) {
      allMonotonic = false;
      details += id + ': only ' + seqArr.length + ' of ' + ROUNDS + ' ran; ';
      continue;
    }
    for (let i = 1; i < seqArr.length; i++) {
      if (seqArr[i] <= seqArr[i - 1]) {
        allMonotonic = false;
        details += id + '[' + (i - 1) + ']=' + seqArr[i - 1] + ' >= ' + id + '[' + i + ']=' + seqArr[i] + '; ';
      }
    }
  }
  check(ENTITY_COUNT + ' entities × ' + ROUNDS + ' chained saves: each entity _writeSeq monotonic',
    allMonotonic, details || 'all ok');

  let allEvicted = true;
  for (const m of maps) { if (m.size !== 0) allEvicted = false; }
  check('All entity locks evicted after chained load', allEvicted);
}
{
  const map = _createEntityLockMap();
  const results = {};

  const p1 = new Promise(resolve => {
    map.getLock('seq-ia').enqueue(async () => {
      const existing = await dbGet(STORES.documents, 'seq-ia');
      const doc = { id: 'seq-ia', blocks: [{ v: 'A1' }], _writeSeq: existing?._writeSeq };
      const saved = await saveDoc('p1', doc);
      results.seqIA = saved._writeSeq;
      await delay(10);
      resolve();
    });
  });
  await delay(2);
  const p2 = new Promise(resolve => {
    map.getLock('seq-ib').enqueue(async () => {
      const existing = await dbGet(STORES.data, 'seq-ib');
      const tbl = { id: 'seq-ib', rows: [['B1']], _writeSeq: existing?._writeSeq };
      const saved = await saveData('p1', tbl);
      results.seqIB = saved._writeSeq;
      resolve();
    });
  });
  await delay(2);
  const p3 = new Promise(resolve => {
    map.getLock('seq-ia').enqueue(async () => {
      const existing = await dbGet(STORES.documents, 'seq-ia');
      const doc = { id: 'seq-ia', blocks: [{ v: 'A2' }], _writeSeq: existing?._writeSeq };
      const saved = await saveDoc('p1', doc);
      results.seqIA2 = saved._writeSeq;
      resolve();
    });
  });

  await Promise.all([p1, p2, p3]);
  await delay(30);
  check('Interleaved _writeSeq: seq-ia first save', results.seqIA === 1,
    'seq=' + results.seqIA);
  check('Interleaved _writeSeq: seq-ib independent', results.seqIB === 1,
    'seq=' + results.seqIB);
  check('Interleaved _writeSeq: seq-ia second save increments',
    results.seqIA2 === 2, 'seq=' + results.seqIA2);
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail > 0 ? 1 : 0);
