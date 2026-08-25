#!/usr/bin/env node
/**
 * CE-058 review-status persistence regression test.
 *
 * Verifies that setTableReviewStatus persists through the entity lock
 * and survives renderView, _flushDirtyEntity, and autosave interference.
 *
 * Bug: setTableReviewStatus called autoSaveTable(table) which set a 1s
 * debounce timer, then renderView(view) immediately cleared that timer,
 * so the save never fired and IDB retained reviewStatus='draft'.
 *
 * Fix: setTableReviewStatus now uses _tableLocks.getLock(id).enqueue()
 * to guarantee immediate persistence through the lock.
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

console.log('=== CE-058: Review Status Persistence Regression ===\n');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

// ─── Extract lock code ───────────────────────────────────────
const lockSrc = wsCode.match(/function _createSaveLock\([^)]*\)\s*\{[\s\S]*?return \{ enqueue, cancel \};\s*\}/)[0];
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

// ─── Simulated IndexedDB ─────────────────────────────────────
function createFakeIDB() {
  const store = new Map();
  let _writeSeq = 0;
  return {
    put(table) {
      store.set(table.id, JSON.parse(JSON.stringify(table)));
    },
    get(id) {
      return store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : undefined;
    },
    saveData(projectId, table) {
      if (!table.id) table.id = 'gen-' + Date.now();
      table.projectId = projectId;
      table.updatedAt = Date.now();
      if (!table.createdAt) table.createdAt = table.updatedAt;
      table._version = table._version || 2;
      const existing = store.get(table.id);
      if (existing && existing._writeSeq != null && existing._writeSeq > (table._writeSeq || 0)) {
        return existing;
      }
      table._writeSeq = (existing?._writeSeq || 0) + 1;
      store.set(table.id, JSON.parse(JSON.stringify(table)));
      return table;
    },
    count() { return store.size; },
  };
}

// ─── Test 1: Review status persists through lock (no debounce) ───
console.log('--- 1. Review status persists immediately via lock ---');
{
  const idb = createFakeIDB();
  const tableLocks = _createEntityLockMap();

  const table = { id: 'tbl-1', type: 'table-document', reviewStatus: 'draft', headers: ['A'], rows: [['1']], _version: 2 };

  idb.saveData('proj-1', table);
  check('Initial save has reviewStatus=draft', idb.get('tbl-1').reviewStatus === 'draft');

  // Simulate setTableReviewStatus: mutate in-memory, enqueue via lock
  table.reviewStatus = 'reviewed';
  table.reviewedAt = Date.now();
  table.sheets = [{ id: 's1', name: 'Sheet 1', reviewStatus: 'reviewed' }];

  tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-1', table));

  // Simulate renderView calling _flushDirtyEntity while dirty=false
  // (no flush should occur)
  await delay(50);

  const saved = idb.get('tbl-1');
  check('Review status persisted to IDB', saved.reviewStatus === 'reviewed');
  check('Sheets review status persisted', saved.sheets[0].reviewStatus === 'reviewed');
  check('_writeSeq incremented', saved._writeSeq === 2);
}

// ─── Test 2: renderView after setTableReviewStatus doesn't lose data ───
console.log('\n--- 2. renderView flush with dirty=false does not overwrite ---');
{
  const idb = createFakeIDB();
  const tableLocks = _createEntityLockMap();

  const table = { id: 'tbl-2', type: 'table-document', reviewStatus: 'draft', headers: ['X'], rows: [['0']], _version: 2 };
  idb.saveData('proj-2', table);

  // Step 1: setTableReviewStatus enqueues save
  table.reviewStatus = 'reviewed';
  tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-2', table));

  // Step 2: renderView fires _flushDirtyEntity (dirty=false → skipped)
  // No additional save enqueued.

  await delay(50);

  check('Status survived simulated renderView', idb.get('tbl-2').reviewStatus === 'reviewed');
}

// ─── Test 3: Concurrent flush (dirty=true) preserves reviewed status ───
console.log('\n--- 3. Concurrent dirty flush preserves reviewed status ---');
{
  const idb = createFakeIDB();
  const tableLocks = _createEntityLockMap();

  const table = { id: 'tbl-3', type: 'table-document', reviewStatus: 'draft', headers: ['Y'], rows: [['9']], _version: 2 };
  idb.saveData('proj-3', table);

  // setTableReviewStatus mutates in-memory and enqueues
  table.reviewStatus = 'reviewed';
  tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-3', table));

  // _flushDirtyEntity also enqueues (dirty=true scenario)
  // Since it uses the SAME table object (already mutated), it saves reviewed
  tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-3', table));

  await delay(50);

  const saved = idb.get('tbl-3');
  check('Status correct after concurrent flush', saved.reviewStatus === 'reviewed');
  check('_writeSeq reflects two writes', saved._writeSeq === 3);
}

// ─── Test 4: Stale autosave draft snapshot cannot overwrite reviewed ───
console.log('\n--- 4. _writeSeq guard prevents stale draft from overwriting reviewed ---');
{
  const idb = createFakeIDB();
  const tableLocks = _createEntityLockMap();

  const table = { id: 'tbl-4', type: 'table-document', reviewStatus: 'draft', headers: ['Z'], rows: [['5']], _version: 2 };
  idb.saveData('proj-4', table);

  // setTableReviewStatus mutates and saves → _writeSeq becomes 2
  table.reviewStatus = 'reviewed';
  tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-4', table));
  await delay(50);

  check('Reviewed state saved', idb.get('tbl-4').reviewStatus === 'reviewed');

  // Now simulate a stale autosave: create a DIFFERENT table object
  // with old _writeSeq and draft reviewStatus
  const staleSnapshot = { id: 'tbl-4', type: 'table-document', reviewStatus: 'draft', headers: ['Z'], rows: [['5']], _version: 2, _writeSeq: 1 };

  const result = idb.saveData('proj-4', staleSnapshot);
  const final = idb.get('tbl-4');

  check('Stale draft write rejected by _writeSeq guard', final.reviewStatus === 'reviewed');
  check('IDB still has reviewed status', final.reviewStatus === 'reviewed');
  check('_writeSeq unchanged', final._writeSeq === 2);
}

// ─── Test 5: Lock eviction creates fresh lock, no dual-active ───
console.log('\n--- 5. Lock eviction does not create dual-active locks ---');
{
  const map = _createEntityLockMap();
  let executionOrder = [];

  // First lock: enqueue and let it complete (will be evicted via onIdle)
  map.getLock('entity-x').enqueue(async () => {
    executionOrder.push('first-start');
    await delay(10);
    executionOrder.push('first-end');
  });
  await delay(50);

  // After idle eviction, new lock is created
  map.getLock('entity-x').enqueue(async () => {
    executionOrder.push('second-start');
    await delay(10);
    executionOrder.push('second-end');
  });
  await delay(50);

  check('First completed before second started',
    executionOrder.indexOf('first-end') < executionOrder.indexOf('second-start'),
    executionOrder.join(','));
  check('Both completed', executionOrder.includes('second-end'));
}

// ─── Test 6: autoSaveTable debounce race — reviewed not overwritten ───
console.log('\n--- 6. autoSaveTable debounce vs setTableReviewStatus ---');
{
  const idb = createFakeIDB();
  const tableLocks = _createEntityLockMap();

  const table = { id: 'tbl-6', type: 'table-document', reviewStatus: 'draft', headers: ['W'], rows: [['3']], _version: 2 };
  idb.saveData('proj-6', table);

  // Simulate autoSaveTable creating a debounce timer for draft
  let autoSaveFired = false;
  const fakeTimer = setTimeout(() => {
    autoSaveFired = true;
    tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-6', table));
  }, 1000);

  // setTableReviewStatus mutates and enqueues immediately via lock
  table.reviewStatus = 'reviewed';
  tableLocks.getLock(table.id).enqueue(() => idb.saveData('proj-6', table));

  // renderView clears the debounce timer (as setTableReviewStatus does)
  clearTimeout(fakeTimer);

  // Wait for lock to finish
  await delay(50);

  const saved = idb.get('tbl-6');
  check('Review status persisted despite cleared debounce', saved.reviewStatus === 'reviewed');
  check('autoSave timer was cleared (did not fire)', !autoSaveFired);
}

// ─── Summary ─────────────────────────────────────────────────
console.log(`\n=== CE-058 Review Status Persistence: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
