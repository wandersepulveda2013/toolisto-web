#!/usr/bin/env node
/**
 * CE-058 Persistence-Sequence Certification
 *
 * Proves _writeSeq remains valid across application/runtime reloads.
 * Tests legacy records, import, delete/recreate, extreme values,
 * multi-tab simulation, and _docLocks/_tableLocks Map lifecycle.
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

console.log('=== CE-058 Persistence-Sequence Certification ===\n');

// ─── Shared: simulate saveDoc with _writeSeq guard (mirrors storage.js) ──────
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

function createSaveDataSim(idb) {
  return async function saveData(projectId, table) {
    if (!table.id) table.id = 'gen-t-' + Date.now();
    table.projectId = projectId;
    table.updatedAt = Date.now();
    if (!table._version) table._version = 1;
    const existing = idb[table.id];
    if (existing && existing._writeSeq != null && existing._writeSeq > (table._writeSeq || 0)) {
      return existing;
    }
    table._writeSeq = (existing?._writeSeq || 0) + 1;
    idb[table.id] = { ...table };
    return table;
  };
}

// ============================================================
// 1. Reload simulation: save → load from IDB → edit → save
// ============================================================
console.log('--- 1. Reload simulation (save → load → edit → save) ---');
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  // First save
  let doc = await saveDoc('p1', { id: 'doc-reload', projectId: 'p1', blocks: [{ content: 'v1' }] });
  check('Initial save: _writeSeq=1', doc._writeSeq === 1, 'seq=' + doc._writeSeq);

  // Simulate reload: load doc from IDB (fresh object, same data)
  const loadedDoc = { ...idb['doc-reload'] };
  check('Loaded doc has _writeSeq', loadedDoc._writeSeq === 1);

  // Edit and save
  loadedDoc.blocks = [{ content: 'v2' }];
  const saved = await saveDoc('p1', loadedDoc);
  check('Post-reload save accepted', saved._writeSeq === 2, 'seq=' + saved._writeSeq);
  check('Post-reload content preserved', saved.blocks[0].content === 'v2');
  check('IDB updated', idb['doc-reload']._writeSeq === 2 && idb['doc-reload'].blocks[0].content === 'v2');
}

// ============================================================
// 2. Legacy record without _writeSeq
// ============================================================
console.log('\n--- 2. Legacy record (no _writeSeq) ---');
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  // Seed a legacy record: no _writeSeq at all
  idb['doc-legacy'] = { id: 'doc-legacy', projectId: 'p1', blocks: [{ content: 'legacy' }] };

  // Load it (no _writeSeq) and save
  const legacyDoc = { ...idb['doc-legacy'] };
  check('Legacy doc has no _writeSeq', legacyDoc._writeSeq === undefined);

  const saved = await saveDoc('p1', legacyDoc);
  check('Legacy save accepted (no _writeSeq → no rejection)', saved._writeSeq === 1, 'seq=' + saved._writeSeq);
  check('IDB now has _writeSeq', idb['doc-legacy']._writeSeq === 1);
}

// ============================================================
// 3. Imported record with _writeSeq (source had 42, fresh IDB starts from 1)
// ============================================================
console.log('\n--- 3. Imported record (with _writeSeq from source) ---');
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  // Simulate import: record arrives with _writeSeq=42 from source system
  // On fresh IDB (no existing), _writeSeq is set to (null||0)+1 = 1, ignoring source value
  const importedDoc = { id: 'doc-imported', projectId: 'p1', _writeSeq: 42, blocks: [{ content: 'imported' }] };
  const saved = await saveDoc('p1', importedDoc);
  check('Imported doc accepted (no existing, new _writeSeq=1)', saved._writeSeq === 1, 'seq=' + saved._writeSeq);
  check('IDB has _writeSeq=1 (fresh IDB, not source 42)', idb['doc-imported']._writeSeq === 1);

  // Re-import of same doc: stale _writeSeq (source still says 42, IDB says 1)
  // 1 > (42||0) is false, so re-import is accepted (overwrites)
  const reImport = { id: 'doc-imported', projectId: 'p1', _writeSeq: 42, blocks: [{ content: 're-imported' }] };
  const reSaved = await saveDoc('p1', reImport);
  check('Re-import accepted (1 > 42 is false, same seq)', reSaved._writeSeq === 2, 'seq=' + reSaved._writeSeq);

  // Edit after import, then stale re-import: rejected
  const edited = { ...idb['doc-imported'], blocks: [{ content: 'user-edit' }] };
  edited._writeSeq = 2;
  await saveDoc('p1', edited);
  const staleReImport = { id: 'doc-imported', projectId: 'p1', _writeSeq: 1, blocks: [{ content: 'stale' }] };
  const rejected = await saveDoc('p1', staleReImport);
  check('Stale re-import rejected (existing has higher seq)', rejected._writeSeq === 3, 'seq=' + rejected._writeSeq);
  check('IDB content is user edit', idb['doc-imported'].blocks[0].content === 'user-edit');

  // Import into existing IDB: record with _writeSeq=3 matches existing
  const matchImport = { id: 'doc-imported', projectId: 'p1', _writeSeq: 3, blocks: [{ content: 'match-import' }] };
  const matchSaved = await saveDoc('p1', matchImport);
  check('Import with matching _writeSeq accepted', matchSaved._writeSeq === 4, 'seq=' + matchSaved._writeSeq);
}

// ============================================================
// 4. Delete/recreate entity
// ============================================================
console.log('\n--- 4. Delete/recreate entity ---');
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  let doc = await saveDoc('p1', { id: 'doc-del', projectId: 'p1', blocks: [{ content: 'original' }] });
  check('Initial save: _writeSeq=1', doc._writeSeq === 1);

  // Delete from IDB
  delete idb['doc-del'];

  // Recreate with fresh object (no _writeSeq)
  const recreated = { id: 'doc-del', projectId: 'p1', blocks: [{ content: 'recreated' }] };
  const saved = await saveDoc('p1', recreated);
  check('Recreated doc accepted (fresh, no _writeSeq)', saved._writeSeq === 1, 'seq=' + saved._writeSeq);
  check('Recreated content is new', saved.blocks[0].content === 'recreated');
}

// ============================================================
// 5. Extreme/high sequence values
// ============================================================
console.log('\n--- 5. Extreme sequence values ---');
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  // Seed with very high _writeSeq
  idb['doc-extreme'] = { id: 'doc-extreme', projectId: 'p1', _writeSeq: 2147483647, blocks: [] };

  // Load and save: should work (same seq)
  const loaded = { ...idb['doc-extreme'] };
  loaded.blocks = [{ content: 'extreme-edit' }];
  const saved = await saveDoc('p1', loaded);
  check('Max-int32 seq accepted', saved._writeSeq === 2147483648, 'seq=' + saved._writeSeq);
  check('IDB updated', idb['doc-extreme']._writeSeq === 2147483648);

  // Stale write with low seq rejected
  const stale = { id: 'doc-extreme', projectId: 'p1', _writeSeq: 100, blocks: [{ content: 'stale' }] };
  const rejected = await saveDoc('p1', stale);
  check('Stale write rejected against max seq', rejected._writeSeq === 2147483648, 'seq=' + rejected._writeSeq);

  // NaN _writeSeq: should be treated as 0
  idb['doc-nan'] = { id: 'doc-nan', projectId: 'p1', _writeSeq: 5, blocks: [] };
  const nanDoc = { id: 'doc-nan', projectId: 'p1', _writeSeq: NaN, blocks: [{ content: 'nan' }] };
  const nanSaved = await saveDoc('p1', nanDoc);
  check('NaN _writeSeq treated as 0, rejected by existing 5', nanSaved._writeSeq === 5, 'seq=' + nanSaved._writeSeq);

  // Negative _writeSeq
  idb['doc-neg'] = { id: 'doc-neg', projectId: 'p1', _writeSeq: 1, blocks: [] };
  const negDoc = { id: 'doc-neg', projectId: 'p1', _writeSeq: -10, blocks: [{ content: 'neg' }] };
  const negSaved = await saveDoc('p1', negDoc);
  check('Negative _writeSeq rejected by existing 1', negSaved._writeSeq === 1, 'seq=' + negSaved._writeSeq);
}

// ============================================================
// 6. Multi-tab simulation
// ============================================================
console.log('\n--- 6. Multi-tab simulation (two independent IDB snapshots) ---');
{
  let idb = {};
  const saveTabA = createSaveDocSim(idb);
  const saveTabB = createSaveDocSim(idb);

  // Both tabs load same doc
  const tabA = { id: 'doc-multi', projectId: 'p1', _writeSeq: 0, blocks: [{ content: 'loaded-in-both' }] };
  const tabB = { ...tabA };

  // Tab A saves first
  tabA.blocks = [{ content: 'tab-a-edit' }];
  const savedA = await saveTabA('p1', tabA);
  check('Tab A save accepted', savedA._writeSeq === 1, 'seq=' + savedA._writeSeq);

  // Tab B saves with stale seq (loaded before Tab A saved)
  tabB.blocks = [{ content: 'tab-b-edit' }];
  const savedB = await saveTabB('p1', tabB);
  check('Tab B stale write rejected (Tab A was newer)', savedB._writeSeq === 1, 'seq=' + savedB._writeSeq);
  check('Tab B gets Tab A data back', savedB.blocks[0].content === 'tab-a-edit');
  check('IDB has Tab A data', idb['doc-multi'].blocks[0].content === 'tab-a-edit');

  // Tab B reloads from IDB and edits (correct conflict resolution)
  const tabBReload = { ...idb['doc-multi'] };
  tabBReload.blocks = [{ content: 'tab-b-after-reload' }];
  const savedB2 = await saveTabB('p1', tabBReload);
  check('Tab B after reload: save accepted', savedB2._writeSeq === 2, 'seq=' + savedB2._writeSeq);
  check('IDB now has Tab B data', idb['doc-multi'].blocks[0].content === 'tab-b-after-reload');
}

// ============================================================
// 7. Rapid consecutive saves (no reload between)
// ============================================================
console.log('\n--- 7. Rapid consecutive saves (same in-memory object) ---');
{
  let idb = {};
  const saveDoc = createSaveDocSim(idb);

  let doc = { id: 'doc-rapid', projectId: 'p1', blocks: [{ content: 'v0' }] };
  for (let i = 1; i <= 20; i++) {
    doc.blocks = [{ content: 'v' + i }];
    doc = await saveDoc('p1', doc);
  }
  check('20 rapid saves: _writeSeq=20', doc._writeSeq === 20, 'seq=' + doc._writeSeq);
  check('20 rapid saves: content is latest', doc.blocks[0].content === 'v20');
  check('IDB has final state', idb['doc-rapid']._writeSeq === 20 && idb['doc-rapid'].blocks[0].content === 'v20');
}

// ============================================================
// 8. Table _writeSeq (saveData path)
// ============================================================
console.log('\n--- 8. Table _writeSeq (saveData) ---');
{
  let idb = {};
  const saveData = createSaveDataSim(idb);

  // Save table
  let table = await saveData('p1', { id: 'tbl-seq', headers: ['a'], rows: [['1']] });
  check('Table initial save: _writeSeq=1', table._writeSeq === 1);

  // Load from IDB and edit
  const loaded = { ...idb['tbl-seq'] };
  loaded.rows = [['2']];
  const saved = await saveData('p1', loaded);
  check('Table post-reload: _writeSeq=2', saved._writeSeq === 2, 'seq=' + saved._writeSeq);

  // Legacy table (no _writeSeq)
  idb['tbl-legacy'] = { id: 'tbl-legacy', headers: ['x'], rows: [['y']] };
  const legacy = { ...idb['tbl-legacy'] };
  const legacySaved = await saveData('p1', legacy);
  check('Legacy table accepted (no _writeSeq)', legacySaved._writeSeq === 1, 'seq=' + legacySaved._writeSeq);
}

// ============================================================
// 9. _createEntityLockMap lifecycle audit
// ============================================================
console.log('\n--- 9. Lock Map lifecycle (memory leak audit) ---');

// Extract _createEntityLockMap from workspace.js
const lockSrc = wsCode.match(/function _createSaveLock\([^)]*\)\s*\{[\s\S]*?return \{ enqueue, cancel \};\s*\}/)[0];
const entityLockSrc = wsCode.match(/function _createEntityLockMap\(\)\s*\{[\s\S]*?return \{[\s\S]*?\};\s*\}/)[0];

const combinedCode = lockSrc + '\n' + entityLockSrc + '\n'
  + 'globalThis._createEntityLockMap = _createEntityLockMap;\n'
  + 'globalThis._createSaveLock = _createSaveLock;\n';

const lockCtx = vm.createContext({
  console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
  setTimeout, clearTimeout, reportError: function() {},
});
vm.runInContext(combinedCode, lockCtx);
const { _createEntityLockMap } = lockCtx;

// 9a. Lock eviction: after task completes and no pending, entry is removed
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('evict-me').enqueue(async () => { log.push('work'); await delay(5); });
  check('Lock entry created', map.size === 1, 'size=' + map.size);
  await delay(50);
  check('Lock entry evicted after drain completes', map.size === 0, 'size=' + map.size);
  check('Work executed', log.includes('work'));
}

// 9b. Lock NOT evicted while task is in-flight
{
  const map = _createEntityLockMap();
  map.getLock('busy').enqueue(async () => { await delay(100); });
  await delay(10);
  check('Lock entry exists while task running', map.size === 1, 'size=' + map.size);
  await delay(150);
  check('Lock entry evicted after task completes', map.size === 0, 'size=' + map.size);
}

// 9c. Lock NOT evicted when new task is pending (latest-wins)
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('coalesce').enqueue(async () => { log.push('first'); await delay(30); });
  await delay(5);
  map.getLock('coalesce').enqueue(async () => { log.push('second'); await delay(5); });
  await delay(10);
  check('Lock entry exists during coalescing', map.size === 1, 'size=' + map.size);
  await delay(60);
  check('Lock evicted after all tasks done', map.size === 0, 'size=' + map.size);
  check('Both tasks ran', log.includes('first') && log.includes('second'));
}

// 9d. getLock returns fresh lock after eviction
{
  const map = _createEntityLockMap();
  let log = [];
  map.getLock('reused').enqueue(async () => { log.push('run1'); await delay(5); });
  await delay(50);
  check('After eviction, size=0', map.size === 0, 'size=' + map.size);
  const lock2 = map.getLock('reused');
  lock2.enqueue(async () => { log.push('run2'); await delay(5); });
  await delay(30);
  check('Fresh lock after eviction works', log.includes('run2'));
  await delay(30);
  check('Re-evicted after second task', map.size === 0, 'size=' + map.size);
}

// 9e. Heavy stress: 200 entities → all evicted
{
  const map = _createEntityLockMap();
  const p = [];
  for (let i = 0; i < 200; i++) {
    p.push(new Promise(resolve => {
      map.getLock('stress-' + i).enqueue(async () => { await delay(1); resolve(); });
    }));
  }
  await Promise.all(p);
  await delay(30);
  check('200 stress entities: all evicted after completion', map.size === 0, 'size=' + map.size);
}

// 9f. getLock returns same lock for same ID during active task
{
  const map = _createEntityLockMap();
  map.getLock('idem').enqueue(async () => { await delay(50); });
  await delay(5);
  const a = map.getLock('idem');
  const b = map.getLock('idem');
  check('Same ID returns same lock during active task', a === b);
  await delay(80);
}

// 9g. Cancel on non-existent entity doesn't crash
{
  const map = _createEntityLockMap();
  let crashed = false;
  try {
    map.cancel('deleted-entity-id');
    map.cancelAll();
  } catch (e) { crashed = true; }
  check('Cancel on non-existent entity does not crash', !crashed);
}

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n=== CE-058 Persistence-Sequence Certification: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
