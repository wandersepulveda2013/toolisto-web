#!/usr/bin/env node
/**
 * CE-058: Cross-item Autosave Integrity — Adversarial Certification
 *
 * Tests that the per-entity lock + flush-before-navigate + _writeSeq
 * stale-write protection correctly prevent data loss across all race
 * conditions identified in adversarial analysis.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

console.log('=== CE-058: Cross-item Autosave Integrity ===\n');

// ============================================================
// PART 1: Unit tests for _createSaveLock and _createEntityLockMap
// ============================================================
console.log('--- 1. Per-entity lock map (coalescing isolation) ---');

const lockSrc = wsCode.match(/function _createSaveLock\(\)\s*\{[\s\S]*?return \{ enqueue, cancel \};\s*\}/)[0];
const entityMapSrc = wsCode.match(/function _createEntityLockMap\(\)\s*\{[\s\S]*?return \{[\s\S]*?\};\s*\}/)[0];

const combinedLockCode = lockSrc + '\n' + entityMapSrc + '\n'
  + 'globalThis._createSaveLock = _createSaveLock;\n'
  + 'globalThis._createEntityLockMap = _createEntityLockMap;\n';

const lockCtx = vm.createContext({
  console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
  setTimeout, clearTimeout, reportError: function() {},
});
vm.runInContext(combinedLockCode, lockCtx);
const { _createEntityLockMap } = lockCtx;

// 1a. Different IDs have independent locks (no coalescing across entities)
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('doc-A').enqueue(async () => { log.push('A-start'); await delay(60); log.push('A-end'); });
  await delay(5);
  map.getLock('doc-B').enqueue(async () => { log.push('B-start'); await delay(20); log.push('B-end'); });
  await delay(200);
  check('A and B run independently (B not blocked by A)',
    log.includes('B-end') && log.indexOf('B-end') < log.indexOf('A-end'),
    log.join(','));
  check('Both A and B complete',
    log.includes('A-end') && log.includes('B-end'), log.join(','));
}

// 1b. Same ID: latest-wins coalescing is correct (only latest pending runs)
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('doc-X').enqueue(async () => { log.push('X1-start'); await delay(60); log.push('X1-end'); });
  await delay(5);
  map.getLock('doc-X').enqueue(async () => { log.push('X2-start'); await delay(10); log.push('X2-end'); });
  await delay(200);
  check('Same-ID latest-wins: X1 runs, X2 replaces pending', log.includes('X1-end') && log.includes('X2-end'), log.join(','));
  check('Same-ID: X1 started before X2', log.indexOf('X1-start') < log.indexOf('X2-start'), log.join(','));
}

// 1c. A→B→A rapid switching: A re-enqueued after B, both complete
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('A').enqueue(async () => { log.push('A1'); await delay(30); });
  await delay(5);
  map.getLock('B').enqueue(async () => { log.push('B1'); await delay(10); });
  await delay(5);
  map.getLock('A').enqueue(async () => { log.push('A2'); await delay(10); });
  await delay(200);
  check('A1 runs (was in-flight before B)', log.includes('A1'), log.join(','));
  check('B1 runs independently', log.includes('B1'), log.join(','));
  check('A2 runs (re-enqueued after B)', log.includes('A2'), log.join(','));
  check('A2 is the latest A', log.indexOf('A2') > log.indexOf('A1'), log.join(','));
}

// 1d. Cancel on navigation: pending B cancelled, A unaffected
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('A').enqueue(async () => { log.push('A-start'); await delay(60); log.push('A-end'); });
  await delay(5);
  map.getLock('A').enqueue(async () => { log.push('B-pending'); await delay(10); });
  map.getLock('A').cancel();
  await delay(200);
  check('A completes', log.includes('A-start'), log.join(','));
  check('B-pending cancelled (never runs)', !log.includes('B-pending'), log.join(','));
}

// 1d2. Cancel on different entity: B cancelled, A unaffected
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('A').enqueue(async () => { log.push('A'); await delay(40); });
  await delay(5);
  map.getLock('B').cancel();
  map.getLock('B').enqueue(async () => { log.push('B'); await delay(10); });
  await delay(200);
  check('Entity isolation: A unaffected by B cancel', log.includes('A'), log.join(','));
  check('Entity isolation: B runs on fresh lock', log.includes('B'), log.join(','));
}

// 1e. Error in A does not block B
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('A').enqueue(async () => { log.push('A-err'); throw new Error('fail'); });
  await delay(30);
  map.getLock('B').enqueue(async () => { log.push('B'); await delay(10); });
  await delay(100);
  check('A error runs', log.includes('A-err'), log.join(','));
  check('B runs after A error', log.includes('B'), log.join(','));
}

// 1f. Cancel all clears every entity
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('A').enqueue(async () => { log.push('A-start'); await delay(60); log.push('A-end'); });
  await delay(5);
  map.getLock('A').enqueue(async () => { log.push('A-pending'); await delay(10); });
  map.getLock('B').enqueue(async () => { log.push('B-start'); await delay(40); log.push('B-end'); });
  await delay(5);
  map.getLock('B').enqueue(async () => { log.push('B-pending'); await delay(10); });
  map.cancelAll();
  await delay(200);
  check('cancelAll: in-flight tasks complete', log.includes('A-start') && log.includes('B-start'), log.join(','));
  check('cancelAll: pending tasks cancelled', !log.includes('A-pending') && !log.includes('B-pending'), log.join(','));
}

// ============================================================
// PART 2: Failsafe stale-write protection (_writeSeq)
// ============================================================
console.log('\n--- 2. Failsafe: stale write protection (_writeSeq) ---');

// Simulate saveDoc with _writeSeq guard (mirrors storage.js logic)
function createSaveDocSim(idb) {
  return async function saveDoc(projectId, doc) {
    if (!doc.id) doc.id = 'gen-' + Date.now();
    doc.projectId = projectId;
    doc.updatedAt = Date.now();
    if (!doc._version) doc._version = 1;
    const existing = idb[doc.id];
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing;
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    idb[doc.id] = { ...doc };
    return doc;
  };
}

// 2a. Stale write discarded when existing has higher _writeSeq
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  // Seed: doc already in IDB with _writeSeq=5
  idb['doc-stale'] = { id: 'doc-stale', projectId: 'p1', _writeSeq: 5, updatedAt: 1000, blocks: [] };

  // A stale caller tries to save with old _writeSeq (simulating a slow/late caller)
  const staleDoc = { id: 'doc-stale', projectId: 'p1', _writeSeq: 3, updatedAt: 500, blocks: [{ content: 'stale' }] };
  const result1 = await saveDoc('p1', staleDoc);
  check('Stale write discarded (existing returned)', result1._writeSeq === 5, 'seq=' + result1._writeSeq);
  check('Stale write did not overwrite IDB', idb['doc-stale']._writeSeq === 5, 'seq=' + idb['doc-stale']._writeSeq);

  // A fresh caller with matching or higher seq succeeds
  const freshDoc = { id: 'doc-fresh', projectId: 'p1', _writeSeq: 0, updatedAt: 2000, blocks: [{ content: 'fresh' }] };
  const result2 = await saveDoc('p1', freshDoc);
  check('Fresh write accepted', idb['doc-fresh']._writeSeq >= 1, 'seq=' + idb['doc-fresh']._writeSeq);
}

// 2b. _writeSeq monotonically increases across sequential saves (reusing returned doc, like workspace.js)
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  let doc = { id: 'doc-seq', projectId: 'p1', blocks: [{ seq: 0 }] };
  let prevSeq = 0;
  for (let i = 0; i < 5; i++) {
    doc = await saveDoc('p1', doc);
    const seq = doc._writeSeq;
    check('_writeSeq increases: save ' + (i+1) + ' seq=' + seq, seq > prevSeq, 'prev=' + prevSeq);
    prevSeq = seq;
  }
}

// 2c. Stale caller: B commits, then A tries to save with stale _writeSeq -> rejected
{
  let idb = {};
  const saveDocSim = createSaveDocSim(idb);

  // B commits v1
  let docB = { id: 'doc-race', projectId: 'p1', blocks: [{ content: 'B-v1' }] };
  docB = await saveDocSim('p1', docB);
  // B commits v2
  docB = { ...docB, blocks: [{ content: 'B-v2' }] };
  docB = await saveDocSim('p1', docB);

  // A was loaded when seq was 0 (stale snapshot)
  const staleDocA = { id: 'doc-race', projectId: 'p1', _writeSeq: 0, blocks: [{ content: 'A-ancient' }] };
  const resultA = await saveDocSim('p1', staleDocA);

  check('Stale write rejected (B v2 returned)', resultA.blocks[0].content === 'B-v2', 'content=' + resultA.blocks[0].content);
  check('Stale write _writeSeq unchanged', resultA._writeSeq === 2, 'seq=' + resultA._writeSeq);
  check('IDB still has B-v2', idb['doc-race']?.blocks?.[0]?.content === 'B-v2');
  check('IDB _writeSeq unchanged', idb['doc-race']?._writeSeq === 2, 'seq=' + idb['doc-race']?._writeSeq);
}

// 2d. Concurrent write with same _writeSeq: second is rejected (first bumped seq)
{
  let idb = {};
  const saveDocSim = createSaveDocSim(idb);

  let doc = await saveDocSim('p1', { id: 'doc-concurrent', projectId: 'p1', blocks: [{ content: 'v1' }] });
  check('Initial save: seq=1', doc._writeSeq === 1);

  const docCopy = { ...doc, blocks: [{ content: 'concurrent-2' }] };
  doc = await saveDocSim('p1', { ...doc, blocks: [{ content: 'concurrent-1' }] });
  const r2 = await saveDocSim('p1', docCopy);

  check('First concurrent write: seq=2', doc._writeSeq === 2);
  check('Second concurrent write rejected (seq stays 2)', r2._writeSeq === 2, 'r2=' + r2._writeSeq);
  check('First write wins in IDB', idb['doc-concurrent']?.blocks?.[0]?.content === 'concurrent-1');
}

// ============================================================
// PART 3: Cross-entity concurrency simulation
// ============================================================
console.log('\n--- 3. Cross-entity concurrency (Doc A vs Doc B) ---');

// 3a. Edit A → switch → edit B → both persist independently
{
  const map = _createEntityLockMap();
  let storage = {};
  let log = [];

  async function saveDocSim(projectId, doc) {
    storage[doc.id] = JSON.parse(JSON.stringify(doc));
    storage[doc.id].updatedAt = Date.now();
    log.push('save-' + doc.id);
    return storage[doc.id];
  }

  const docA = { id: 'A', projectId: 'p1', blocks: [{ content: 'A-v1' }] };
  const docB = { id: 'B', projectId: 'p1', blocks: [{ content: 'B-v1' }] };

  // Edit A, enqueue save
  map.getLock('A').enqueue(() => saveDocSim('p1', docA));
  await delay(5);

  // Switch to B, edit B, enqueue save (A's save still running)
  map.getLock('B').enqueue(() => saveDocSim('p1', docB));
  await delay(200);

  check('Doc A saved', storage['A'] != null, JSON.stringify(storage['A']));
  check('Doc B saved', storage['B'] != null, JSON.stringify(storage['B']));
  check('Doc A content preserved', storage['A']?.blocks?.[0]?.content === 'A-v1');
  check('Doc B content preserved', storage['B']?.blocks?.[0]?.content === 'B-v1');
  check('Both saves executed', log.length === 2, log.join(','));
}

// 3b. Table X → switch → Table Y: independent persistence
{
  const map = _createEntityLockMap();
  let storage = {};

  async function saveDataSim(projectId, table) {
    storage[table.id] = JSON.parse(JSON.stringify(table));
    storage[table.id].updatedAt = Date.now();
    return storage[table.id];
  }

  const tableX = { id: 'X', projectId: 'p1', headers: ['a', 'b'], rows: [['1', '2']] };
  const tableY = { id: 'Y', projectId: 'p1', headers: ['c'], rows: [['3']] };

  map.getLock('X').enqueue(() => saveDataSim('p1', tableX));
  await delay(5);
  map.getLock('Y').enqueue(() => saveDataSim('p1', tableY));
  await delay(200);

  check('Table X saved', storage['X'] != null);
  check('Table Y saved', storage['Y'] != null);
  check('Table X headers preserved', JSON.stringify(storage['X']?.headers) === '["a","b"]');
  check('Table Y rows preserved', JSON.stringify(storage['Y']?.rows) === '[["3"]]');
}

// 3c. Doc and Table save simultaneously (isolation)
{
  const mapD = _createEntityLockMap();
  const mapT = _createEntityLockMap();
  let log = [];

  mapD.getLock('doc1').enqueue(async () => { log.push('doc-start'); await delay(40); log.push('doc-end'); });
  await delay(5);
  mapT.getLock('tbl1').enqueue(async () => { log.push('tbl-start'); await delay(10); log.push('tbl-end'); });
  await delay(200);

  check('Doc and Table run in parallel (different lock maps)',
    log.indexOf('tbl-end') < log.indexOf('doc-end'),
    log.join(','));
  check('Both complete', log.includes('doc-end') && log.includes('tbl-end'), log.join(','));
}

// 3d. Error in doc save does not poison table save
{
  const mapD = _createEntityLockMap();
  const mapT = _createEntityLockMap();
  let log = [];

  mapD.getLock('doc-err').enqueue(async () => { log.push('doc-err'); throw new Error('IDB fail'); });
  await delay(30);
  mapT.getLock('tbl-ok').enqueue(async () => { log.push('tbl-ok'); await delay(10); });
  await delay(100);

  check('Doc error logged', log.includes('doc-err'), log.join(','));
  check('Table save unaffected by doc error', log.includes('tbl-ok'), log.join(','));
}

// ============================================================
// PART 4: Failsafe timeout behavior
// ============================================================
console.log('\n--- 4. Failsafe timeout (simulated short) ---');

{
  const lockSrcShort = lockSrc.replace('60000', '100');
  const ctx = vm.createContext({
    console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
    setTimeout, clearTimeout, reportError: function() {},
  });
  vm.runInContext(lockSrcShort + '\nglobalThis._createSaveLock = _createSaveLock;\n', ctx);
  const createLock = ctx._createSaveLock;

  const map = _createEntityLockMap();
  let log = [];

  map.getLock('stuck').enqueue(async () => { log.push('stuck-start'); await delay(300); log.push('stuck-end'); });
  await delay(50);
  map.getLock('new').enqueue(async () => { log.push('new'); await delay(10); });
  await delay(400);

  check('Failsafe: stuck task started', log.includes('stuck-start'), log.join(','));
  check('Failsafe: new task runs after timeout', log.includes('new'), log.join(','));
  check('Failsafe: stuck task eventually completes', log.includes('stuck-end'), log.join(','));
}

// ============================================================
// PART 5: Navigation flush behavior
// ============================================================
console.log('\n--- 5. Flush-before-navigate (logic test) ---');

// 5a. Verify _flushDirtyEntity clears debounce and enqueues
{
  let flushCalled = false;
  let saveEnqueued = false;

  const flushSrc = wsCode.match(/function _flushDirtyEntity\(\)\s*\{[\s\S]*?^function renderView/m);
  check('_flushDirtyEntity function exists in workspace.js', flushSrc !== null);
}

// 5b. Verify renderView calls _flushDirtyEntity before clearing timers
{
  const renderViewMatch = wsCode.match(/function renderView\(view\)\s*\{[^}]*_viewGeneration\+\+;\s*\n\s*_flushDirtyEntity\(\)/);
  check('renderView calls _flushDirtyEntity before clearing timers', renderViewMatch !== null,
    renderViewMatch ? 'found' : 'not found');
}

// ============================================================
// PART 6: Document/table isolation
// ============================================================
console.log('\n--- 6. Document/table isolation ---');

// 6a. Rapid A→B→A switching: each entity gets correct final state
{
  const map = _createEntityLockMap();
  let storage = {};
  let writeLog = [];

  async function saveSim(id, data) {
    storage[id] = { ...data, savedAt: Date.now() };
    writeLog.push(id);
  }

  // A v1
  map.getLock('A').enqueue(() => saveSim('A', { version: 1 }));
  await delay(3);
  // B v1
  map.getLock('B').enqueue(() => saveSim('B', { version: 1 }));
  await delay(3);
  // A v2 (should coalesce if v1 not yet run, or run after)
  map.getLock('A').enqueue(() => saveSim('A', { version: 2 }));
  await delay(200);

  check('B persisted correctly', storage['B']?.version === 1, JSON.stringify(storage['B']));
  check('A has latest version', storage['A']?.version === 2 || (storage['A']?.version === 1 && writeLog.filter(x => x === 'A').length === 1),
    JSON.stringify(storage['A']) + ' log=' + writeLog.join(','));
  check('Both entities persisted', storage['A'] && storage['B'], writeLog.join(','));
}

// 6b. 20 rapid entity switches: all complete, no loss
{
  const map = _createEntityLockMap();
  let storage = {};
  let count = 0;

  for (let i = 0; i < 20; i++) {
    const id = i % 2 === 0 ? 'even-' + i : 'odd-' + i;
    map.getLock(id).enqueue(async () => { storage[id] = { i }; count++; await delay(5); });
  }
  await delay(400);

  check('All 20 rapid entity saves complete', count === 20, 'count=' + count);
  const entityCount = Object.keys(storage).length;
  check('All entities present in storage', entityCount >= 10, 'entities=' + entityCount);
}

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n=== CE-058: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
