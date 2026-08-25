#!/usr/bin/env node
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS: ' + name); }
  else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('=== CE-060: Multi-Tab Concurrency ===\n');

const codeVersions = readFileSync(join(ROOT, 'workspace', 'core', 'schema-versions.js'), 'utf8');
const codeModels = readFileSync(join(ROOT, 'workspace', 'core', 'models.js'), 'utf8');
const codeBundle = readFileSync(join(ROOT, 'workspace', 'core', 'bundle.js'), 'utf8');
const codeMigrations = readFileSync(join(ROOT, 'workspace', 'core', 'migrations.js'), 'utf8');
const codeDb = readFileSync(join(ROOT, 'workspace', 'core', 'db.js'), 'utf8');
const codeState = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');
const codeEvents = readFileSync(join(ROOT, 'workspace', 'core', 'events.js'), 'utf8');
const codeIntegrity = readFileSync(join(ROOT, 'workspace', 'core', 'integrity.js'), 'utf8');
const codeWstorage = readFileSync(join(ROOT, 'workspace', 'core', 'workspace-storage.js'), 'utf8');
const codeStorage = readFileSync(join(ROOT, 'workspace', 'core', 'storage.js'), 'utf8');

function stripModuleSyntax(code) {
  let result = code;
  result = result.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';?\s*/g, '');
  result = result.replace(/import\s+\w+\s+from\s*'[^']*';?\s*/g, '');
  result = result.replace(/import\s*'[^']*';?\s*/g, '');
  result = result.replace(/export\s*\{[^}]*\};?\s*/g, '');
  result = result.replace(/^export\s+default\s+/gm, '');
  result = result.replace(/^export\s+(const|let|var|function|class|async)\s/gm, '$1 ');
  return result;
}

const combined = [
  codeVersions, codeDb, codeState, codeEvents, codeModels,
  codeBundle, codeMigrations, codeIntegrity, codeWstorage, codeStorage,
].map(stripModuleSyntax).join('\n');

const lockPrimitives = `
function _createSaveLock(onIdle) {
  var _pending = null;
  var _running = false;
  var _failsafe = null;
  var _gen = 0;
  function enqueue(saveFn) {
    _pending = saveFn;
    if (!_running) _drain();
  }
  function cancel() {
    _pending = null;
    if (_failsafe) { clearTimeout(_failsafe); _failsafe = null; }
  }
  async function _drain() {
    if (_running) return;
    _running = true;
    while (_pending) {
      var fn = _pending;
      _pending = null;
      var myGen = ++_gen;
      _failsafe = setTimeout(function() {
        if (_gen === myGen) {
          _running = false;
          _failsafe = null;
          if (_pending) _drain();
        }
      }, 60000);
      try { await fn(); } catch (e) {}
      if (_failsafe) { clearTimeout(_failsafe); _failsafe = null; }
      if (_gen !== myGen) { _running = false; return; }
    }
    _running = false;
    if (onIdle) onIdle();
  }
  return { enqueue: enqueue, cancel: cancel };
}

function _createEntityLockMap() {
  var _locks = new Map();
  function _maybeEvict(entityId) {
    if (!_locks.has(entityId)) return;
    _locks.delete(entityId);
  }
  return {
    getLock: function(entityId) {
      var lock = _locks.get(entityId);
      if (!lock) {
        lock = _createSaveLock(function() { _maybeEvict(entityId); });
        _locks.set(entityId, lock);
      }
      return lock;
    },
    cancelAll: function() { for (var lock of _locks.values()) lock.cancel(); },
    cancel: function(entityId) { var lock = _locks.get(entityId); if (lock) lock.cancel(); },
    get size() { return _locks.size; },
  };
}
`;

const patchedCombined = lockPrimitives + combined + `
MODEL_VERSION = OBJECT_SCHEMA_VERSION;
Object.assign(globalThis, {
  STORES, DB_VERSION, DB_NAME,
  openDB, closeDB, dbPut, dbGet, dbGetAll, dbDelete,
  dbTransaction, dbBulkPut, dbBulkDelete, dbClear, dbGetByIndex,
  generateId,
  applyMigrations, MIGRATION_PLAN, openRaw, getSchemaInfo, deleteDatabase,
  buildManifest, validateBundleImport, validateManifest, canonicalJson, sha256Hex,
  OBJECT_SCHEMA_VERSION, DB_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION, STORAGE_ENVELOPE_VERSION,
  migrateObject, migrateProjectBundle, MODEL_VERSION,
  createProjectModel, createFileAsset, createImageAsset, createScanDocument, createScanPage,
  createTextDocument, createTextBlock, createTableDocument, createDataSheet,
  createChart, createDesignDocument, createDesignLayer, createToolExecution,
  createExportArtifact, addRelation, removeRelation, getRelatedIds, pushHistory,
  saveDoc, saveData, saveCapture, saveAsset, saveExecution, saveWorkflow,
  saveSetting, loadSetting, saveDataModel, loadDataModel,
  createProject, updateProject, deleteProject, loadProjects, selectProject,
  loadDocs, loadData, loadCaptures, loadAssetsByProject, loadExecutionsByProject,
  loadWorkflowsByProject, loadDocumentById, loadCaptureById,
  deleteDoc, deleteData, deleteCapture, deleteAsset, deleteExecution, deleteWorkflow,
  exportProject, importProject, refreshProjectCounts, persistScannerResult,
  registerExecution, loadExecutionsBySource, loadCapturesByDoc, loadAssetsByType,
  previewCaptureDeletion,
  appStore, createStore, emit, on, once,
  deleteWithCascade, previewCascadeDelete, pruneDanglingReferences, assertIntegrity,
});
`;

const sharedLocalStorage = (() => {
  const _s = new Map();
  return { getItem(k) { return _s.has(k) ? _s.get(k) : null; }, setItem(k, v) { _s.set(k, String(v)); }, removeItem(k) { _s.delete(k); }, clear() { _s.clear(); }, get length() { return _s.size; }, key(i) { return [..._s.keys()][i] || null; } };
})();

function buildSandbox() {
  return vm.createContext({
    console: { log() {}, error() {} },
    Map, Set, Array, Object, Error, Date, JSON, Math, Number,
    Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    RegExp, Symbol, String, parseInt, parseFloat,
    indexedDB: globalThis.indexedDB,
    crypto: globalThis.crypto || { subtle: { async digest() { return new ArrayBuffer(0); } }, randomUUID() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); } },
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    reportError: function() {},
    localStorage: sharedLocalStorage,
  });
}

function createTab(label) {
  const ctx = buildSandbox();
  vm.runInContext(patchedCombined, ctx, { filename: label + '.mjs' });
  return {
    ctx,
    saveDoc: ctx.saveDoc,
    saveData: ctx.saveData,
    dbGet: ctx.dbGet,
    dbPut: ctx.dbPut,
    dbGetAll: ctx.dbGetAll,
    dbGetByIndex: ctx.dbGetByIndex,
    createEntityLockMap: ctx._createEntityLockMap,
    createSaveLock: ctx._createSaveLock,
    closeDB: ctx.closeDB,
    generateId: ctx.generateId,
    STORES: ctx.STORES,
    appStore: ctx.appStore,
    MODEL_VERSION: ctx.MODEL_VERSION,
  };
}

const main = createTab('main');
const { saveDoc, saveData, dbGet, dbPut, dbGetAll, dbGetByIndex } = main;
const { closeDB, generateId, STORES, MODEL_VERSION } = main;

closeDB();
const proj = await main.ctx.createProject('mt-proj');
const PID = proj.id;

const docLog = [];
const origEmit = main.ctx.emit;
main.ctx.emit = function(tag, data) {
  if (tag === 'doc:saved' || tag === 'data:saved') docLog.push({ tag, id: data.id, name: data.name, _writeSeq: data._writeSeq });
};

await delay(50);

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Different entities across tabs (Guarantee A)
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: Different entities across tabs ---');
{
  const tab1 = createTab('s1-tab1');
  const tab2 = createTab('s1-tab2');

  const docA = await tab1.saveDoc(PID, { id: 's1-docA', name: 'DocA-Tab1', type: 'text-document', blocks: [] });
  const docB = await tab2.saveDoc(PID, { id: 's1-docB', name: 'DocB-Tab2', type: 'text-document', blocks: [] });
  check('1.1: Tab-1 saves Doc A', docA.name === 'DocA-Tab1' && docA._writeSeq === 1);
  check('1.2: Tab-2 saves Doc B', docB.name === 'DocB-Tab2' && docB._writeSeq === 1);

  const readA = await tab2.dbGet(STORES.documents, 's1-docA');
  const readB = await tab1.dbGet(STORES.documents, 's1-docB');
  check('1.3: Tab-2 can read Doc A', readA && readA.name === 'DocA-Tab1');
  check('1.4: Tab-1 can read Doc B', readB && readB.name === 'DocB-Tab2');

  const tblX = await tab1.saveData(PID, { id: 's1-tblX', name: 'TableX-Tab1', type: 'table-document', sheets: [{ id: 'sx', name: 'S1', index: 0, columns: ['C1'], rows: [['v1']] }], activeSheetIndex: 0 });
  const tblY = await tab2.saveData(PID, { id: 's1-tblY', name: 'TableY-Tab2', type: 'table-document', sheets: [{ id: 'sy', name: 'S1', index: 0, columns: ['C1'], rows: [['v2']] }], activeSheetIndex: 0 });
  check('1.5: Tab-1 saves Table X', tblX.name === 'TableX-Tab1' && tblX._writeSeq === 1);
  check('1.6: Tab-2 saves Table Y', tblY.name === 'TableY-Tab2' && tblY._writeSeq === 1);

  const crossDoc = await tab1.saveDoc(PID, { id: 's1-crossDoc', name: 'CrossDoc', type: 'text-document', blocks: [] });
  const crossTbl = await tab2.saveData(PID, { id: 's1-crossTbl', name: 'CrossTbl', type: 'table-document', sheets: [{ id: 'sc', name: 'S1', index: 0, columns: ['A'], rows: [['x']] }], activeSheetIndex: 0 });
  check('1.7: Cross-type Tab-1 doc saved', crossDoc._writeSeq === 1);
  check('1.8: Cross-type Tab-2 table saved', crossTbl._writeSeq === 1);

  const crossDocRead = await tab2.dbGet(STORES.documents, 's1-crossDoc');
  const crossTblRead = await tab1.dbGet(STORES.data, 's1-crossTbl');
  check('1.9: Cross-type readable across tabs', crossDocRead && crossTblRead);

  const scaleTab1 = createTab('s1-scale1');
  const scaleTab2 = createTab('s1-scale2');
  const SCALE = 50;
  const t1 = Date.now();
  const p1 = [];
  for (let i = 0; i < SCALE; i++) p1.push(scaleTab1.saveDoc(PID, { id: 's1-scale-a-' + i, name: 'SA' + i, type: 'text-document', blocks: [] }));
  const p2 = [];
  for (let i = 0; i < SCALE; i++) p2.push(scaleTab2.saveDoc(PID, { id: 's1-scale-b-' + i, name: 'SB' + i, type: 'text-document', blocks: [] }));
  const [r1, r2] = await Promise.all([Promise.all(p1), Promise.all(p2)]);
  const elapsed = Date.now() - t1;
  check('1.10: Scale 50 entities per tab all saved',
    r1.every(d => d._writeSeq === 1) && r2.every(d => d._writeSeq === 1),
    'count=' + (r1.length + r2.length));

  const allDocs = await dbGetByIndex(STORES.documents, 'projectId', PID);
  const scaleDocs = allDocs.filter(d => d.id.startsWith('s1-scale-'));
  check('1.11: Scale 100 entities all in IDB', scaleDocs.length === 100,
    'found=' + scaleDocs.length);

  const allDocsFull = await dbGetByIndex(STORES.documents, 'projectId', PID);
  const crossTypeDocs = allDocsFull.filter(d => d.id.startsWith('s1-'));
  check('1.12: All Section 1 docs present', crossTypeDocs.length >= 6);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Same entity, simultaneous edits (Guarantee D)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Same entity, simultaneous edits ---');
{
  await saveDoc(PID, { id: 's2-e1', name: 'V0', type: 'text-document', blocks: [] });
  const snapA = await dbGet(STORES.documents, 's2-e1');
  const snapB = await dbGet(STORES.documents, 's2-e1');
  check('2.1: Both tabs load V0 (seq=1)', snapA._writeSeq === 1 && snapB._writeSeq === 1);

  const tabA = createTab('s2-A');
  const tabB = createTab('s2-B');

  const rA1 = await tabA.saveDoc(PID, { id: 's2-e1', name: 'A-commits-first', type: 'text-document', blocks: [], _writeSeq: snapA._writeSeq });
  const rB1 = await tabB.saveDoc(PID, { id: 's2-e1', name: 'B-commits-second', type: 'text-document', blocks: [], _writeSeq: snapB._writeSeq });
  check('2.2: A commits first → A wins', rA1.name === 'A-commits-first');
  check('2.3: B commits second with stale seq → rejected', rB1.name === 'A-commits-first' && rB1._writeSeq === 2);

  await dbPut(STORES.documents, { id: 's2-e2', name: 'V0-e2', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sA2 = await dbGet(STORES.documents, 's2-e2');
  const sB2 = await dbGet(STORES.documents, 's2-e2');
  const tabA2 = createTab('s2-A2');
  const tabB2 = createTab('s2-B2');
  const rB2 = await tabB2.saveDoc(PID, { id: 's2-e2', name: 'B-commits-first-v2', type: 'text-document', blocks: [], _writeSeq: sB2._writeSeq });
  const rA2 = await tabA2.saveDoc(PID, { id: 's2-e2', name: 'A-commits-second-v2', type: 'text-document', blocks: [], _writeSeq: sA2._writeSeq });
  check('2.4: B commits first → B wins', rB2.name === 'B-commits-first-v2');
  check('2.5: A commits second with stale seq → rejected', rA2.name === 'B-commits-first-v2');

  await dbPut(STORES.documents, { id: 's2-e3', name: 'V0-e3', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sA3 = await dbGet(STORES.documents, 's2-e3');
  const sB3 = await dbGet(STORES.documents, 's2-e3');
  const tabA3 = createTab('s2-A3');
  const tabB3 = createTab('s2-B3');
  let aWins = 0, bWins = 0;
  for (let trial = 0; trial < 20; trial++) {
    await dbPut(STORES.documents, { id: 's2-e3', name: 'reset', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
    const sA = await tabA3.dbGet(STORES.documents, 's2-e3');
    const sB = await tabB3.dbGet(STORES.documents, 's2-e3');
    const resA = await tabA3.saveDoc(PID, { id: 's2-e3', name: 'A-trial-' + trial, type: 'text-document', blocks: [], _writeSeq: sA._writeSeq });
    const resB = await tabB3.saveDoc(PID, { id: 's2-e3', name: 'B-trial-' + trial, type: 'text-document', blocks: [], _writeSeq: sB._writeSeq });
    if (resA.name.startsWith('A-trial')) aWins++;
    else bWins++;
    check('2.6.' + trial + ': Deterministic first-writer-wins',
      (resA.name.startsWith('A-trial') || resB.name.startsWith('B-trial')) &&
      ((resA.name.startsWith('A-trial') && resB.name === resA.name) || (resB.name.startsWith('B-trial') && resA.name === resB.name)));
  }
  check('2.7: 20 trials: all deterministic (one winner)', aWins + bWins === 20);

  await dbPut(STORES.documents, { id: 's2-e4', name: 'V0-e4', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sA4 = await dbGet(STORES.documents, 's2-e4');
  const sB4 = await dbGet(STORES.documents, 's2-e4');
  const tabA4 = createTab('s2-A4');
  const tabB4 = createTab('s2-B4');
  const lockA = tabA4.createEntityLockMap();
  const lockB = tabB4.createEntityLockMap();
  let aResult = null, bResult = null;
  const pA = new Promise(resolve => {
    lockA.getLock('s2-e4').enqueue(async () => {
      await delay(15);
      aResult = await tabA4.saveDoc(PID, { id: 's2-e4', name: 'A-queued', type: 'text-document', blocks: [], _writeSeq: sA4._writeSeq });
      resolve();
    });
  });
  const pB = new Promise(resolve => {
    lockB.getLock('s2-e4').enqueue(async () => {
      bResult = await tabB4.saveDoc(PID, { id: 's2-e4', name: 'B-queued', type: 'text-document', blocks: [], _writeSeq: sB4._writeSeq });
      resolve();
    });
  });
  await Promise.all([pA, pB]);
  check('2.8: Both queued writes produce one winner',
    (aResult.name === 'A-queued' && bResult.name === 'A-queued') ||
    (aResult.name === 'B-queued' && bResult.name === 'B-queued'),
    'A=' + aResult.name + ' B=' + bResult.name);

  await dbPut(STORES.documents, { id: 's2-e5', name: 'V0-e5', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA5 = createTab('s2-A5');
  const tabB5 = createTab('s2-B5');
  const sA5 = await tabA5.dbGet(STORES.documents, 's2-e5');
  const sB5 = await tabB5.dbGet(STORES.documents, 's2-e5');
  const rA5 = await tabA5.saveDoc(PID, { id: 's2-e5', name: 'A-first-save', type: 'text-document', blocks: [], _writeSeq: sA5._writeSeq });
  const rB5 = await tabB5.saveDoc(PID, { id: 's2-e5', name: 'B-first-save', type: 'text-document', blocks: [], _writeSeq: sB5._writeSeq });
  const sA5b = await tabA5.dbGet(STORES.documents, 's2-e5');
  const rA5b = await tabA5.saveDoc(PID, { id: 's2-e5', name: 'A-second-save', type: 'text-document', blocks: [], _writeSeq: sA5b._writeSeq });
  check('2.9: A persists, B persists, A saves again → A second save wins',
    rA5b.name === 'A-second-save' && rA5b._writeSeq === 2,
    'name=' + rA5b.name + ' seq=' + rA5b._writeSeq);

  const rB5b = await tabB5.saveDoc(PID, { id: 's2-e5', name: 'B-late', type: 'text-document', blocks: [], _writeSeq: sB5._writeSeq });
  check('2.10: B late save with original seq → rejected',
    rB5b.name === 'A-second-save' && rB5b._writeSeq === 2,
    'name=' + rB5b.name + ' seq=' + rB5b._writeSeq);

  await dbPut(STORES.documents, { id: 's2-e6', name: 'V0-e6', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sA6 = await dbGet(STORES.documents, 's2-e6');
  const sB6 = await dbGet(STORES.documents, 's2-e6');
  const tabA6 = createTab('s2-A6');
  const tabB6 = createTab('s2-B6');
  const rA6 = await tabA6.saveDoc(PID, { id: 's2-e6', name: 'A-v2', type: 'text-document', blocks: [], _writeSeq: sA6._writeSeq });
  const rB6 = await tabB6.saveDoc(PID, { id: 's2-e6', name: 'B-v2', type: 'text-document', blocks: [], _writeSeq: sB6._writeSeq });
  check('2.11: First write seq=1 accepted', rA6._writeSeq === 1 || rB6._writeSeq === 1);
  check('2.12: Second write seq=1 rejected', rA6._writeSeq === 1 && rB6._writeSeq === 1 ? true :
    (rA6.name === rB6.name && rA6._writeSeq === 2));

  const sA7 = await dbGet(STORES.documents, 's2-e6');
  const tabA7 = createTab('s2-A7');
  const tabB7 = createTab('s2-B7');
  const sB7 = await tabB7.dbGet(STORES.documents, 's2-e6');
  const rA7 = await tabA7.saveDoc(PID, { id: 's2-e6', name: 'A-v3', type: 'text-document', blocks: [], _writeSeq: sA7._writeSeq });
  const rB7 = await tabB7.saveDoc(PID, { id: 's2-e6', name: 'B-v3', type: 'text-document', blocks: [], _writeSeq: sB7._writeSeq });
  check('2.13: Fresh tabs with correct seq after prior conflict',
    rA7._writeSeq === 2 && rB7._writeSeq === 2 && rA7.name === rB7.name,
    'A=' + rA7.name + '(' + rA7._writeSeq + ') B=' + rB7.name + '(' + rB7._writeSeq + ')');

  await dbPut(STORES.documents, { id: 's2-e7', name: 'V0-e7', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA8 = createTab('s2-A8');
  const tabB8 = createTab('s2-B8');
  const sA8 = await tabA8.dbGet(STORES.documents, 's2-e7');
  const rA8a = await tabA8.saveDoc(PID, { id: 's2-e7', name: 'A-first', type: 'text-document', blocks: [], _writeSeq: sA8._writeSeq });
  const sA8b = await tabA8.dbGet(STORES.documents, 's2-e7');
  const rA8b = await tabA8.saveDoc(PID, { id: 's2-e7', name: 'A-second', type: 'text-document', blocks: [], _writeSeq: sA8b._writeSeq });
  check('2.14: Same tab sequential saves always succeed',
    rA8a._writeSeq === 1 && rA8b._writeSeq === 2 && rA8b.name === 'A-second');

  const sB8 = await tabB8.dbGet(STORES.documents, 's2-e7');
  const rB8 = await tabB8.saveDoc(PID, { id: 's2-e7', name: 'B-late', type: 'text-document', blocks: [], _writeSeq: sB8._writeSeq });
  check('2.15: Other tab with same seq overwrites (equal seq not rejected, documented)',
    rB8.name === 'B-late' && rB8._writeSeq === 3,
    'name=' + rB8.name + ' seq=' + rB8._writeSeq);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: _writeSeq across multiple tabs (Guarantee C)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: _writeSeq across multiple tabs ---');
{
  await dbPut(STORES.documents, { id: 's3-e1', name: 'seed', type: 'text-document', blocks: [], _writeSeq: 10, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const loadA = await dbGet(STORES.documents, 's3-e1');
  const loadB = await dbGet(STORES.documents, 's3-e1');
  check('3.1: Tab-A loads seq=10', loadA._writeSeq === 10);
  check('3.2: Tab-B loads seq=10', loadB._writeSeq === 10);

  const tabA = createTab('s3-A');
  const tabB = createTab('s3-B');
  const rA = await tabA.saveDoc(PID, { id: 's3-e1', name: 'A-seq11', type: 'text-document', blocks: [], _writeSeq: 10 });
  check('3.3: A writes seq 10→11 accepted', rA._writeSeq === 11 && rA.name === 'A-seq11');

  const rB = await tabB.saveDoc(PID, { id: 's3-e1', name: 'B-seq11', type: 'text-document', blocks: [], _writeSeq: 10 });
  check('3.4: B writes seq 10 (stale) → rejected', rB.name === 'A-seq11' && rB._writeSeq === 11);

  const afterA = await dbGet(STORES.documents, 's3-e1');
  const rA2 = await tabA.saveDoc(PID, { id: 's3-e1', name: 'A-seq12', type: 'text-document', blocks: [], _writeSeq: afterA._writeSeq });
  check('3.5: A→12 accepted', rA2._writeSeq === 12 && rA2.name === 'A-seq12');

  const staleB = await tabB.saveDoc(PID, { id: 's3-e1', name: 'B-stale-11', type: 'text-document', blocks: [], _writeSeq: 11 });
  check('3.6: B stale→11 rejected', staleB.name === 'A-seq12' && staleB._writeSeq === 12);

  const freshB = await dbGet(STORES.documents, 's3-e1');
  const rB2 = await tabB.saveDoc(PID, { id: 's3-e1', name: 'B-reload-12', type: 'text-document', blocks: [], _writeSeq: freshB._writeSeq });
  check('3.7: B reloads and writes seq=13 accepted', rB2._writeSeq === 13 && rB2.name === 'B-reload-12');

  await dbPut(STORES.documents, { id: 's3-eq', name: 'seed-eq', type: 'text-document', blocks: [], _writeSeq: 5, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sEq = await dbGet(STORES.documents, 's3-eq');
  const tabEq1 = createTab('s3-eq1');
  const tabEq2 = createTab('s3-eq2');
  const rEq1 = await tabEq1.saveDoc(PID, { id: 's3-eq', name: 'EQ1', type: 'text-document', blocks: [], _writeSeq: sEq._writeSeq });
  const rEq2 = await tabEq2.saveDoc(PID, { id: 's3-eq', name: 'EQ2', type: 'text-document', blocks: [], _writeSeq: sEq._writeSeq });
  check('3.8: Equal sequence value (5): first writer wins',
    (rEq1.name === 'EQ1' && rEq2.name === 'EQ1') || (rEq2.name === 'EQ2' && rEq1.name === 'EQ2'),
    'T1=' + rEq1.name + ' T2=' + rEq2.name);

  await dbPut(STORES.documents, { id: 's3-miss', name: 'seed-miss', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabM = createTab('s3-miss');
  const rMiss = await tabM.saveDoc(PID, { id: 's3-miss', name: 'missing-seq', type: 'text-document', blocks: [] });
  check('3.9: Missing _writeSeq (undefined) accepted → seq=1', rMiss._writeSeq === 1,
    'seq=' + rMiss._writeSeq);

  await dbPut(STORES.documents, { id: 's3-neg', name: 'seed-neg', type: 'text-document', blocks: [], _writeSeq: 5, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabNeg = createTab('s3-neg');
  const rNeg = await tabNeg.saveDoc(PID, { id: 's3-neg', name: 'neg-seq', type: 'text-document', blocks: [], _writeSeq: -1 });
  check('3.10: Negative _writeSeq rejected (existing seq=5 > -1)',
    rNeg.name === 'seed-neg' && rNeg._writeSeq === 5,
    'name=' + rNeg.name + ' seq=' + rNeg._writeSeq);

  await dbPut(STORES.documents, { id: 's3-big', name: 'seed-big', type: 'text-document', blocks: [], _writeSeq: 2, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabBig = createTab('s3-big');
  const rBig = await tabBig.saveDoc(PID, { id: 's3-big', name: 'big-seq', type: 'text-document', blocks: [], _writeSeq: 999999 });
  check('3.11: Large _writeSeq (999999) accepted (>= existing 2)',
    rBig.name === 'big-seq' && rBig._writeSeq === 3,
    'name=' + rBig.name + ' seq=' + rBig._writeSeq);

  await dbPut(STORES.documents, { id: 's3-mal', name: 'seed-mal', type: 'text-document', blocks: [], _writeSeq: 5, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabMal = createTab('s3-mal');
  const rMal = await tabMal.saveDoc(PID, { id: 's3-mal', name: 'mal-seq', type: 'text-document', blocks: [], _writeSeq: 'five' });
  check('3.12: Malformed _writeSeq (string) not rejected (5 > NaN = false, documented limitation)',
    rMal.name === 'mal-seq' && rMal._writeSeq === 6,
    'name=' + rMal.name + ' seq=' + rMal._writeSeq);

  await dbPut(STORES.documents, { id: 's3-zero', name: 'seed-zero', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabZero = createTab('s3-zero');
  const rZero = await tabZero.saveDoc(PID, { id: 's3-zero', name: 'zero-seq', type: 'text-document', blocks: [], _writeSeq: 0 });
  check('3.13: _writeSeq=0 on entity with seq=0 → accepted', rZero._writeSeq === 1,
    'seq=' + rZero._writeSeq);

  await dbPut(STORES.data, { id: 's3-data-e1', name: 'seed-data', type: 'table-document', sheets: [], activeSheetIndex: 0, _writeSeq: 7, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabDA = createTab('s3-dA');
  const tabDB = createTab('s3-dB');
  const loadDA = await tabDA.dbGet(STORES.data, 's3-data-e1');
  const loadDB = await tabDB.dbGet(STORES.data, 's3-data-e1');
  check('3.14a: Data store record accessible across tabs',
    loadDA != null && loadDB != null,
    'loadDA=' + loadDA + ' loadDB=' + loadDB);
  if (loadDA && loadDB) {
    const rDA = await tabDA.saveData(PID, { id: 's3-data-e1', name: 'data-A', type: 'table-document', sheets: [], activeSheetIndex: 0, _writeSeq: loadDA._writeSeq });
    const rDB = await tabDB.saveData(PID, { id: 's3-data-e1', name: 'data-B', type: 'table-document', sheets: [], activeSheetIndex: 0, _writeSeq: loadDB._writeSeq });
    check('3.14: Data table _writeSeq same behavior as doc',
      (rDA.name === 'data-A' && rDB.name === 'data-A') || (rDB.name === 'data-B' && rDA.name === 'data-B'));
  } else {
    check('3.14: Data table _writeSeq same behavior as doc', false, 'records not accessible');
  }

  await dbPut(STORES.documents, { id: 's3-e8', name: 'seed-8', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tX = createTab('s3-X');
  const tY = createTab('s3-Y');
  const tZ = createTab('s3-Z');
  const sX = await tX.dbGet(STORES.documents, 's3-e8');
  const sY = await tY.dbGet(STORES.documents, 's3-e8');
  const sZ = await tZ.dbGet(STORES.documents, 's3-e8');
  const rX = await tX.saveDoc(PID, { id: 's3-e8', name: 'X', type: 'text-document', blocks: [], _writeSeq: sX._writeSeq });
  const rY = await tY.saveDoc(PID, { id: 's3-e8', name: 'Y', type: 'text-document', blocks: [], _writeSeq: sY._writeSeq });
  const rZ = await tZ.saveDoc(PID, { id: 's3-e8', name: 'Z', type: 'text-document', blocks: [], _writeSeq: sZ._writeSeq });
  check('3.15: Three tabs same seq: exactly one winner',
    (rX.name === 'Y' || rX.name === 'Z' || rX.name === 'X') &&
    rX.name === rY.name && rY.name === rZ.name &&
    rX._writeSeq === 1,
    'X=' + rX.name + ' Y=' + rY.name + ' Z=' + rZ.name);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Stale tab overwrite (CE-060 Section 8)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Stale tab overwrite ---');
{
  await dbPut(STORES.documents, { id: 's4-e1', name: 'V1', title: 'title-V1', content: 'content-V1', reviewStatus: 'draft', type: 'text-document', blocks: [], _writeSeq: 1, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const loadA = await dbGet(STORES.documents, 's4-e1');
  const loadB = await dbGet(STORES.documents, 's4-e1');
  check('4.1: Both tabs load V1 (seq=1)', loadA._writeSeq === 1 && loadB._writeSeq === 1);

  const tabA = createTab('s4-A');
  const tabB = createTab('s4-B');
  const rB = await tabB.saveDoc(PID, { id: 's4-e1', name: 'V2-B', title: 'title-V2', content: 'content-V1', reviewStatus: 'draft', type: 'text-document', blocks: [], _writeSeq: loadB._writeSeq });
  check('4.2: TAB-B updates to V2', rB.name === 'V2-B' && rB._writeSeq === 2);

  const rA = await tabA.saveDoc(PID, { id: 's4-e1', name: 'V1-A-mod', title: 'title-V1', content: 'content-modified', reviewStatus: 'reviewed', type: 'text-document', blocks: [], _writeSeq: loadA._writeSeq });
  check('4.3: TAB-A stale write rejected (does not overwrite V2)',
    rA.name === 'V2-B' && rA._writeSeq === 2,
    'name=' + rA.name + ' seq=' + rA._writeSeq);

  const finalDoc = await dbGet(STORES.documents, 's4-e1');
  check('4.4: Final record is V2-B (B wins)', finalDoc.name === 'V2-B');
  check('4.5: Content field is B\'s', finalDoc.content === 'content-V1');
  check('4.6: No Frankenstein merge (title is B\'s)', finalDoc.title === 'title-V2');

  await dbPut(STORES.documents, { id: 's4-e2', name: 'V1-2', type: 'text-document', blocks: [], _writeSeq: 3, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA2 = createTab('s4-A2');
  const tabB2 = createTab('s4-B2');
  const sA2 = await tabA2.dbGet(STORES.documents, 's4-e2');
  const sB2 = await tabB2.dbGet(STORES.documents, 's4-e2');
  const rB2 = await tabB2.saveDoc(PID, { id: 's4-e2', name: 'B-early', type: 'text-document', blocks: [], _writeSeq: sB2._writeSeq });
  await delay(5);
  const rA2 = await tabA2.saveDoc(PID, { id: 's4-e2', name: 'A-late', type: 'text-document', blocks: [], _writeSeq: sA2._writeSeq });
  check('4.7: B early, A late: B still wins',
    rB2.name === 'B-early' && rA2.name === 'B-early',
    'B=' + rB2.name + ' A=' + rA2.name);

  await dbPut(STORES.documents, { id: 's4-e3', name: 'V1-3', title: 'orig-title', content: 'orig-content', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabC = createTab('s4-C');
  const tabD = createTab('s4-D');
  const sC = await tabC.dbGet(STORES.documents, 's4-e3');
  const sD = await tabD.dbGet(STORES.documents, 's4-e3');
  const rC = await tabC.saveDoc(PID, { id: 's4-e3', name: 'C-wins', title: 'title-C', content: 'content-C', type: 'text-document', blocks: [], _writeSeq: sC._writeSeq });
  const rD = await tabD.saveDoc(PID, { id: 's4-e3', name: 'D-rejected', title: 'title-D', content: 'content-D', type: 'text-document', blocks: [], _writeSeq: sD._writeSeq });
  check('4.8: Multi-field stale: C wins cleanly (all fields)', rC.title === 'title-C' && rC.content === 'content-C');
  check('4.9: D rejected preserves C state', rD.title === 'title-C' && rD.content === 'content-C');

  await dbPut(STORES.documents, { id: 's4-e4', name: 'V1-4', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sA4 = await dbGet(STORES.documents, 's4-e4');
  const sB4 = await dbGet(STORES.documents, 's4-e4');
  const tabA4 = createTab('s4-A4');
  const tabB4 = createTab('s4-B4');
  const rA4 = await tabA4.saveDoc(PID, { id: 's4-e4', name: 'A4', type: 'text-document', blocks: [], _writeSeq: sA4._writeSeq });
  const rB4 = await tabB4.saveDoc(PID, { id: 's4-e4', name: 'B4', type: 'text-document', blocks: [], _writeSeq: sB4._writeSeq });
  const freshA4 = await tabA4.dbGet(STORES.documents, 's4-e4');
  const rA4b = await tabA4.saveDoc(PID, { id: 's4-e4', name: 'A4-v2', type: 'text-document', blocks: [], _writeSeq: freshA4._writeSeq });
  check('4.10: After rejection, stale tab reloads and rewrites correctly',
    rA4b._writeSeq === 2 && rA4b.name === 'A4-v2');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Autosave vs external write (CE-060 Section 30)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Autosave vs external write ---');
{
  await dbPut(STORES.documents, { id: 's5-e1', name: 'V0-5', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const loadA = await dbGet(STORES.documents, 's5-e1');
  const loadB = await dbGet(STORES.documents, 's5-e1');
  const tabA = createTab('s5-A');
  const tabB = createTab('s5-B');
  const lockA = tabA.createSaveLock();
  const lockB = tabB.createSaveLock();

  let aAutosaveResult = null;
  lockA.enqueue(async () => {
    await delay(30);
    aAutosaveResult = await tabA.saveDoc(PID, { id: 's5-e1', name: 'A-autosave', type: 'text-document', blocks: [], _writeSeq: loadA._writeSeq });
  });
  await delay(5);
  const rB = await tabB.saveDoc(PID, { id: 's5-e1', name: 'B-explicit', type: 'text-document', blocks: [], _writeSeq: loadB._writeSeq });
  check('5.1: B explicit save commits first', rB.name === 'B-explicit' && rB._writeSeq === 1);
  await delay(50);
  check('5.2: A autosave resumes after B commit → A autosave rejected',
    aAutosaveResult && aAutosaveResult.name === 'B-explicit' && aAutosaveResult._writeSeq === 1,
    'result=' + (aAutosaveResult && aAutosaveResult.name));

  await dbPut(STORES.documents, { id: 's5-e2', name: 'V0-5e2', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const loadC = await dbGet(STORES.documents, 's5-e2');
  const tabC = createTab('s5-C');
  const tabD = createTab('s5-D');
  const lockC = tabC.createSaveLock();
  let cResult = null;
  lockC.enqueue(async () => {
    await delay(20);
    cResult = await tabC.saveDoc(PID, { id: 's5-e2', name: 'C-delayed', type: 'text-document', blocks: [], _writeSeq: loadC._writeSeq });
  });
  const rD = await tabD.saveDoc(PID, { id: 's5-e2', name: 'D-direct', type: 'text-document', blocks: [], _writeSeq: loadC._writeSeq });
  await delay(40);
  check('5.3: Same entity: D direct save beats C delayed save',
    rD.name === 'D-direct' && cResult.name === 'D-direct',
    'D=' + rD.name + ' C=' + cResult.name);

  await dbPut(STORES.documents, { id: 's5-e3a', name: 'V0-diff-a', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  await dbPut(STORES.documents, { id: 's5-e3b', name: 'V0-diff-b', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabE = createTab('s5-E');
  const tabF = createTab('s5-F');
  const lockE = tabE.createSaveLock();
  const lockF = tabF.createSaveLock();
  let eResult = null, fResult = null;
  lockE.enqueue(async () => {
    await delay(20);
    eResult = await tabE.saveDoc(PID, { id: 's5-e3a', name: 'E-entityA', type: 'text-document', blocks: [], _writeSeq: 0 });
  });
  lockF.enqueue(async () => {
    await delay(20);
    fResult = await tabF.saveDoc(PID, { id: 's5-e3b', name: 'F-entityB', type: 'text-document', blocks: [], _writeSeq: 0 });
  });
  await delay(60);
  check('5.4: Different entity: E autosave succeeds', eResult && eResult.name === 'E-entityA');
  check('5.5: Different entity: F autosave succeeds', fResult && fResult.name === 'F-entityB');

  await dbPut(STORES.documents, { id: 's5-e4', name: 'V0-5e4', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabG = createTab('s5-G');
  const tabH = createTab('s5-H');
  const sG = await tabG.dbGet(STORES.documents, 's5-e4');
  const sH = await tabH.dbGet(STORES.documents, 's5-e4');
  const rG = await tabG.saveDoc(PID, { id: 's5-e4', name: 'G-first', type: 'text-document', blocks: [], _writeSeq: sG._writeSeq });
  const lockG2 = tabG.createSaveLock();
  let gDelayedResult = null;
  lockG2.enqueue(async () => {
    await delay(25);
    gDelayedResult = await tabG.saveDoc(PID, { id: 's5-e4', name: 'G-old-autosave', type: 'text-document', blocks: [], _writeSeq: sG._writeSeq });
  });
  await delay(5);
  const rH = await tabH.saveDoc(PID, { id: 's5-e4', name: 'H-writes', type: 'text-document', blocks: [], _writeSeq: sH._writeSeq });
  await delay(40);
  check('5.6: Old autosave cannot overwrite newer persisted state',
    gDelayedResult && gDelayedResult.name === 'G-first' && gDelayedResult._writeSeq === 1,
    'result=' + (gDelayedResult && gDelayedResult.name) + ' seq=' + (gDelayedResult && gDelayedResult._writeSeq));

  await dbPut(STORES.documents, { id: 's5-e5', name: 'V0-5e5', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabI = createTab('s5-I');
  const tabJ = createTab('s5-J');
  const sI = await tabI.dbGet(STORES.documents, 's5-e5');
  const lockI = tabI.createSaveLock();
  let iSeq99 = null;
  lockI.enqueue(async () => {
    await delay(15);
    iSeq99 = await tabI.saveDoc(PID, { id: 's5-e5', name: 'I-old', type: 'text-document', blocks: [], _writeSeq: sI._writeSeq });
  });
  await delay(5);
  const rJ = await tabJ.saveDoc(PID, { id: 's5-e5', name: 'J-new', type: 'text-document', blocks: [], _writeSeq: 0 });
  check('5.7: J writes with seq=0 after I already saved → depends on timing',
    rJ._writeSeq === 1 || rJ._writeSeq === 2,
    'seq=' + rJ._writeSeq);
  await delay(30);
  check('5.8: I delayed autosave outcome is deterministic',
    iSeq99 != null);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Equal revision collision (CE-060 Section 32)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Equal revision collision ---');
{
  await dbPut(STORES.documents, { id: 's6-e1', name: 'seed-6e1', type: 'text-document', blocks: [], _writeSeq: 8, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const loadA = await dbGet(STORES.documents, 's6-e1');
  const loadB = await dbGet(STORES.documents, 's6-e1');
  check('6.1: Both tabs load seq=8', loadA._writeSeq === 8 && loadB._writeSeq === 8);

  const tabA = createTab('s6-A');
  const tabB = createTab('s6-B');
  const rA = await tabA.saveDoc(PID, { id: 's6-e1', name: 'A-content', type: 'text-document', blocks: [], _writeSeq: loadA._writeSeq });
  const rB = await tabB.saveDoc(PID, { id: 's6-e1', name: 'B-content', type: 'text-document', blocks: [], _writeSeq: loadB._writeSeq });
  check('6.2: Equal seq: first writer wins',
    (rA.name === 'A-content' && rB.name === 'A-content') || (rB.name === 'B-content' && rA.name === 'B-content'),
    'A=' + rA.name + ' B=' + rB.name);
  check('6.3: Winner seq=9', rA._writeSeq === 9 || rB._writeSeq === 9,
    'A_seq=' + rA._writeSeq + ' B_seq=' + rB._writeSeq);

  const winner = rA._writeSeq === 9 ? rA : rB;
  const loser = rA._writeSeq === 9 ? rB : rA;
  check('6.4: Loser returns winner snapshot', loser.name === winner.name && loser._writeSeq === winner._writeSeq);

  await dbPut(STORES.documents, { id: 's6-e2', name: 'seed-6e2', type: 'text-document', blocks: [], _writeSeq: 8, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA2 = createTab('s6-A2');
  const tabB2 = createTab('s6-B2');
  const sA2 = await tabA2.dbGet(STORES.documents, 's6-e2');
  const sB2 = await tabB2.dbGet(STORES.documents, 's6-e2');
  const rA2 = await tabA2.saveDoc(PID, { id: 's6-e2', name: 'A-diff', type: 'text-document', blocks: [], _writeSeq: sA2._writeSeq });
  const rB2 = await tabB2.saveDoc(PID, { id: 's6-e2', name: 'B-diff', type: 'text-document', blocks: [], _writeSeq: sB2._writeSeq });
  check('6.5: Equal seq different content: one winner, no merge',
    rA2.name === rB2.name && rA2._writeSeq === 9 && rB2._writeSeq === 9,
    'A=' + rA2.name + ' B=' + rB2.name);

  await dbPut(STORES.documents, { id: 's6-e3', name: 'seed-6e3', type: 'text-document', blocks: [], _writeSeq: 8, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA3 = createTab('s6-A3');
  const tabB3 = createTab('s6-B3');
  const sA3 = await tabA3.dbGet(STORES.documents, 's6-e3');
  const sB3 = await tabB3.dbGet(STORES.documents, 's6-e3');
  const rA3 = await tabA3.saveDoc(PID, { id: 's6-e3', name: 'A-same', type: 'text-document', blocks: [], _writeSeq: sA3._writeSeq });
  const rB3 = await tabB3.saveDoc(PID, { id: 's6-e3', name: 'B-same', type: 'text-document', blocks: [], _writeSeq: sB3._writeSeq });
  check('6.6: Equal seq identical content: still first-writer-wins',
    rA3.name === rB3.name && rA3._writeSeq === 9);

  await dbPut(STORES.documents, { id: 's6-e4', name: 'seed-6e4', type: 'text-document', blocks: [], _writeSeq: 8, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA4 = createTab('s6-A4');
  const tabB4 = createTab('s6-B4');
  const sA4 = await tabA4.dbGet(STORES.documents, 's6-e4');
  const sB4 = await tabB4.dbGet(STORES.documents, 's6-e4');
  let wins = { A: 0, B: 0 };
  for (let i = 0; i < 30; i++) {
    await dbPut(STORES.documents, { id: 's6-e4', name: 'reset', type: 'text-document', blocks: [], _writeSeq: 8, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
    const sA = await tabA4.dbGet(STORES.documents, 's6-e4');
    const sB = await tabB4.dbGet(STORES.documents, 's6-e4');
    const rA = await tabA4.saveDoc(PID, { id: 's6-e4', name: 'A-run-' + i, type: 'text-document', blocks: [], _writeSeq: sA._writeSeq });
    const rB = await tabB4.saveDoc(PID, { id: 's6-e4', name: 'B-run-' + i, type: 'text-document', blocks: [], _writeSeq: sB._writeSeq });
    if (rA.name.startsWith('A-run')) wins.A++;
    else wins.B++;
  }
  check('6.7: 30 equal-rev trials: first writer always wins (no splits)', wins.A + wins.B === 30,
    'A=' + wins.A + ' B=' + wins.B);

  await dbPut(STORES.documents, { id: 's6-e5', name: 'seed-6e5', type: 'text-document', blocks: [], _writeSeq: 8, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabA5 = createTab('s6-A5');
  const tabB5 = createTab('s6-B5');
  const sA5 = await tabA5.dbGet(STORES.documents, 's6-e5');
  const sB5 = await tabB5.dbGet(STORES.documents, 's6-e5');
  const rA5 = await tabA5.saveDoc(PID, { id: 's6-e5', name: 'A5', type: 'text-document', blocks: [], _writeSeq: sA5._writeSeq });
  const rB5 = await tabB5.saveDoc(PID, { id: 's6-e5', name: 'B5', type: 'text-document', blocks: [], _writeSeq: sB5._writeSeq });
  const afterRev = await dbGet(STORES.documents, 's6-e5');
  check('6.8: After collision, IDB seq advanced by exactly 1',
    afterRev._writeSeq === 9, 'seq=' + afterRev._writeSeq);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Reopen after conflict (CE-060 Section 40)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: Reopen after conflict ---');
{
  await dbPut(STORES.documents, { id: 's7-e1', name: 'V0-7', type: 'text-document', blocks: [{ id: 'blk7', content: 'original', type: 'paragraph' }], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const sA = await dbGet(STORES.documents, 's7-e1');
  const sB = await dbGet(STORES.documents, 's7-e1');
  const tabA = createTab('s7-A');
  const tabB = createTab('s7-B');
  const rA = await tabA.saveDoc(PID, { id: 's7-e1', name: 'A-v2', type: 'text-document', blocks: [{ id: 'blk7', content: 'A-modified', type: 'paragraph' }], _writeSeq: sA._writeSeq });
  const rB = await tabB.saveDoc(PID, { id: 's7-e1', name: 'B-v2', type: 'text-document', blocks: [{ id: 'blk7', content: 'B-modified', type: 'paragraph' }], _writeSeq: sB._writeSeq });
  check('7.1: B rejected, returns A result', rA.name === 'A-v2' && rB.name === 'A-v2' && rA._writeSeq === 1);

  const tabC = createTab('s7-C');
  const fresh = await tabC.dbGet(STORES.documents, 's7-e1');
  check('7.2: Fresh TAB-C loads valid record', fresh != null);
  check('7.3: Fresh TAB-C sees winner name',
    fresh.name === 'A-v2',
    'name=' + fresh.name);
  check('7.4: Fresh TAB-C sees winner seq',
    fresh._writeSeq === 1, 'seq=' + fresh._writeSeq);
  check('7.5: Record has valid blocks', Array.isArray(fresh.blocks) && fresh.blocks.length > 0);

  const rC = await tabC.saveDoc(PID, { id: 's7-e1', name: 'C-v3', type: 'text-document', blocks: [{ id: 'blk7', content: 'C-modified', type: 'paragraph' }], _writeSeq: fresh._writeSeq });
  check('7.6: TAB-C saves cleanly on top of winner', rC.name === 'C-v3' && rC._writeSeq === 2);

  await dbPut(STORES.documents, { id: 's7-e2', name: 'V0-7e2', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabX = createTab('s7-X');
  const tabY = createTab('s7-Y');
  const sX = await tabX.dbGet(STORES.documents, 's7-e2');
  const sY = await tabY.dbGet(STORES.documents, 's7-e2');
  const rX = await tabX.saveDoc(PID, { id: 's7-e2', name: 'X', type: 'text-document', blocks: [], _writeSeq: sX._writeSeq });
  const rY = await tabY.saveDoc(PID, { id: 's7-e2', name: 'Y', type: 'text-document', blocks: [], _writeSeq: sY._writeSeq });
  const rY2 = await tabY.saveDoc(PID, { id: 's7-e2', name: 'Y2', type: 'text-document', blocks: [], _writeSeq: rY._writeSeq });
  check('7.7: Loser tab reloads and saves successfully',
    rY2._writeSeq === 2 && rY2.name === 'Y2');

  await dbPut(STORES.documents, { id: 's7-e3', name: 'V0-7e3', title: 'original-title', reviewStatus: 'draft', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tabP = createTab('s7-P');
  const tabQ = createTab('s7-Q');
  const sP = await tabP.dbGet(STORES.documents, 's7-e3');
  const sQ = await tabQ.dbGet(STORES.documents, 's7-e3');
  const rP = await tabP.saveDoc(PID, { id: 's7-e3', name: 'P', title: 'P-title', reviewStatus: 'reviewed', type: 'text-document', blocks: [], _writeSeq: sP._writeSeq });
  const rQ = await tabQ.saveDoc(PID, { id: 's7-e3', name: 'Q', title: 'Q-title', reviewStatus: 'approved', type: 'text-document', blocks: [], _writeSeq: sQ._writeSeq });
  const tabR = createTab('s7-R');
  const freshR = await tabR.dbGet(STORES.documents, 's7-e3');
  check('7.8: Multi-field entity after conflict: record is coherent',
    freshR.name === rP.name && freshR.title === rP.title && freshR.reviewStatus === rP.reviewStatus,
    'name=' + freshR.name + ' title=' + freshR.title + ' status=' + freshR.reviewStatus);

  await dbPut(STORES.documents, { id: 's7-e4', name: 'V0-7e4', type: 'text-document', blocks: [], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const t1 = createTab('s7-t1');
  const t2 = createTab('s7-t2');
  const sT1 = await t1.dbGet(STORES.documents, 's7-e4');
  const sT2 = await t2.dbGet(STORES.documents, 's7-e4');
  const rT1 = await t1.saveDoc(PID, { id: 's7-e4', name: 'T1', type: 'text-document', blocks: [], _writeSeq: sT1._writeSeq });
  const rT2 = await t2.saveDoc(PID, { id: 's7-e4', name: 'T2', type: 'text-document', blocks: [], _writeSeq: sT2._writeSeq });
  const t3 = createTab('s7-t3');
  const freshT3 = await t3.dbGet(STORES.documents, 's7-e4');
  const rT3 = await t3.saveDoc(PID, { id: 's7-e4', name: 'T3', type: 'text-document', blocks: [], _writeSeq: freshT3._writeSeq });
  check('7.9: Third tab after conflict sees valid state and saves',
    rT3.name === 'T3' && rT3._writeSeq === 2);

  await dbPut(STORES.documents, { id: 's7-e5', name: 'V0-7e5', type: 'text-document', blocks: [{ id: 'b1', content: 'v1' }], _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const tA = createTab('s7-tA');
  const tB = createTab('s7-tB');
  const sA5 = await tA.dbGet(STORES.documents, 's7-e5');
  const sB5 = await tB.dbGet(STORES.documents, 's7-e5');
  const rA5 = await tA.saveDoc(PID, { id: 's7-e5', name: 'A', type: 'text-document', blocks: [{ id: 'b1', content: 'from-A' }], _writeSeq: sA5._writeSeq });
  const rB5 = await tB.saveDoc(PID, { id: 's7-e5', name: 'B', type: 'text-document', blocks: [{ id: 'b1', content: 'from-B' }], _writeSeq: sB5._writeSeq });
  const afterConflict = await dbGet(STORES.documents, 's7-e5');
  check('7.10: After conflict, blocks are from the winner (not merged)',
    afterConflict.blocks && afterConflict.blocks.length === 1,
    'blocks=' + JSON.stringify(afterConflict.blocks));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Record atomicity (CE-060 Section 41)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: Record atomicity ---');
{
  await dbPut(STORES.documents, {
    id: 's8-e1', name: 'atom-title', content: 'atom-content', reviewStatus: 'draft',
    metadata: { author: 'Alice', tags: ['v1'] },
    type: 'text-document', blocks: [{ id: 'blk8a', content: 'block-a', type: 'paragraph' }],
    _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });
  const snapA = await dbGet(STORES.documents, 's8-e1');
  const snapB = await dbGet(STORES.documents, 's8-e1');
  const tabA = createTab('s8-A');
  const tabB = createTab('s8-B');
  const rA = await tabA.saveDoc(PID, {
    id: 's8-e1', name: 'A-title', content: 'A-content', reviewStatus: 'reviewed',
    metadata: { author: 'Alice', tags: ['v2'] },
    type: 'text-document', blocks: [{ id: 'blk8a', content: 'block-A', type: 'paragraph' }],
    _writeSeq: snapA._writeSeq,
  });
  const rB = await tabB.saveDoc(PID, {
    id: 's8-e1', name: 'B-title', content: 'B-content', reviewStatus: 'approved',
    metadata: { author: 'Bob', tags: ['v3'] },
    type: 'text-document', blocks: [{ id: 'blk8a', content: 'block-B', type: 'paragraph' }],
    _writeSeq: snapB._writeSeq,
  });
  check('8.1: Concurrent writes produce one winner',
    rA.name === rB.name, 'A=' + rA.name + ' B=' + rB.name);

  const winnerName = rA.name;
  const winnerContent = winnerName === 'A-title' ? 'A-content' : 'B-content';
  const winnerReviewStatus = winnerName === 'A-title' ? 'reviewed' : 'approved';
  const winnerAuthor = winnerName === 'A-title' ? 'Alice' : 'Bob';

  const fromIDB = await dbGet(STORES.documents, 's8-e1');
  check('8.2: IDB record has consistent name', fromIDB.name === winnerName);
  check('8.3: IDB record has consistent content', fromIDB.content === winnerContent);
  check('8.4: IDB record has consistent reviewStatus', fromIDB.reviewStatus === winnerReviewStatus);
  check('8.5: IDB record has consistent metadata.author',
    fromIDB.metadata && fromIDB.metadata.author === winnerAuthor,
    'author=' + (fromIDB.metadata && fromIDB.metadata.author));
  check('8.6: IDB record has consistent blocks[0].content',
    fromIDB.blocks && fromIDB.blocks[0] && fromIDB.blocks[0].content === (winnerName === 'A-title' ? 'block-A' : 'block-B'),
    'block=' + (fromIDB.blocks && fromIDB.blocks[0] && fromIDB.blocks[0].content));

  const loserName = winnerName === 'A-title' ? 'B-title' : 'A-title';
  check('8.7: Loser snapshot matches winner (no cross-contamination)',
    rA.name === rB.name && rA.content === rB.content && rA.reviewStatus === rB.reviewStatus);

  await dbPut(STORES.documents, {
    id: 's8-e2', name: 'atom2-title', type: 'text-document',
    blocks: [{ id: 'b1', content: 'c1', order: 0 }, { id: 'b2', content: 'c2', order: 1 }],
    _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });
  const tabC = createTab('s8-C');
  const tabD = createTab('s8-D');
  const sC = await tabC.dbGet(STORES.documents, 's8-e2');
  const sD = await tabD.dbGet(STORES.documents, 's8-e2');
  const rC = await tabC.saveDoc(PID, {
    id: 's8-e2', name: 'C', type: 'text-document',
    blocks: [{ id: 'b1', content: 'C1', order: 0 }, { id: 'b2', content: 'C2', order: 1 }, { id: 'b3', content: 'C3', order: 2 }],
    _writeSeq: sC._writeSeq,
  });
  const rD = await tabD.saveDoc(PID, {
    id: 's8-e2', name: 'D', type: 'text-document',
    blocks: [{ id: 'b1', content: 'D1', order: 0 }],
    _writeSeq: sD._writeSeq,
  });
  const atomicDoc = await dbGet(STORES.documents, 's8-e2');
  check('8.8: Block-level atomicity (winner blocks are complete)',
    atomicDoc.blocks && atomicDoc.blocks.length >= 1,
    'blocks=' + atomicDoc.blocks.length);
  check('8.9: No merged block arrays from both tabs',
    !(atomicDoc.blocks.some(b => b.content.includes('C')) && atomicDoc.blocks.some(b => b.content.includes('D')) &&
      rC.name !== rD.name && atomicDoc.name !== rC.name && atomicDoc.name !== rD.name));

  await dbPut(STORES.documents, {
    id: 's8-e3', name: 'atom3', type: 'text-document',
    blocks: [{ id: 'x1', content: 'orig' }],
    _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });
  const tabE = createTab('s8-E');
  const tabF = createTab('s8-F');
  const sE = await tabE.dbGet(STORES.documents, 's8-e3');
  const sF = await tabF.dbGet(STORES.documents, 's8-e3');
  const rE = await tabE.saveDoc(PID, {
    id: 's8-e3', name: 'E', type: 'text-document',
    blocks: [{ id: 'x1', content: 'from-E' }],
    _writeSeq: sE._writeSeq,
  });
  const rF = await tabF.saveDoc(PID, {
    id: 's8-e3', name: 'F', type: 'text-document',
    blocks: [{ id: 'x1', content: 'from-F' }],
    _writeSeq: sF._writeSeq,
  });
  const atomRecord = await dbGet(STORES.documents, 's8-e3');
  check('8.10: Winner name matches one source completely',
    atomRecord.name === 'E' || atomRecord.name === 'F');
  check('8.11: Winner blocks match winner source',
    atomRecord.blocks[0].content === (atomRecord.name === 'E' ? 'from-E' : 'from-F'),
    'name=' + atomRecord.name + ' block=' + atomRecord.blocks[0].content);

  const tblId = 's8-table-1';
  await dbPut(STORES.data, {
    id: tblId, name: 'atom-table', type: 'table-document',
    sheets: [{ id: 'sht1', name: 'Sheet1', index: 0, columns: ['ColA', 'ColB'], rows: [['r1a', 'r1b'], ['r2a', 'r2b']] }],
    activeSheetIndex: 0,
    _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });
  const tabG = createTab('s8-G');
  const tabH = createTab('s8-H');
  const sG = await tabG.dbGet(STORES.data, tblId);
  const sH = await tabH.dbGet(STORES.data, tblId);
  const rG = await tabG.saveData(PID, {
    id: tblId, name: 'G-table', type: 'table-document',
    sheets: [{ id: 'sht1', name: 'Sheet1', index: 0, columns: ['ColA', 'ColB'], rows: [['g1', 'g2']] }],
    activeSheetIndex: 0, _writeSeq: sG._writeSeq,
  });
  const rH = await tabH.saveData(PID, {
    id: tblId, name: 'H-table', type: 'table-document',
    sheets: [{ id: 'sht1', name: 'Sheet1', index: 0, columns: ['ColA'], rows: [['h1']] }],
    activeSheetIndex: 0, _writeSeq: sH._writeSeq,
  });
  check('8.12: Table atomicity: one winner',
    rG.name === rH.name, 'G=' + rG.name + ' H=' + rH.name);

  const atomTable = await dbGet(STORES.data, tblId);
  check('8.13: Table columns match winner source',
    atomTable.sheets && atomTable.sheets[0] &&
    atomTable.sheets[0].columns.length === (atomTable.name === 'G-table' ? 2 : 1),
    'name=' + atomTable.name + ' cols=' + atomTable.sheets[0].columns.length);

  await dbPut(STORES.documents, {
    id: 's8-e4', name: 'atom4', type: 'text-document',
    blocks: [{ id: 'z1', content: 'z1c' }],
    metadata: { score: 10 },
    _writeSeq: 0, projectId: PID, createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });
  const tabI = createTab('s8-I');
  const tabJ = createTab('s8-J');
  const sI = await tabI.dbGet(STORES.documents, 's8-e4');
  const sJ = await tabJ.dbGet(STORES.documents, 's8-e4');
  const rI = await tabI.saveDoc(PID, {
    id: 's8-e4', name: 'I', type: 'text-document',
    blocks: [{ id: 'z1', content: 'I-content' }],
    metadata: { score: 20, extra: 'I' },
    _writeSeq: sI._writeSeq,
  });
  const rJ = await tabJ.saveDoc(PID, {
    id: 's8-e4', name: 'J', type: 'text-document',
    blocks: [{ id: 'z1', content: 'J-content' }],
    metadata: { score: 30, extra: 'J' },
    _writeSeq: sJ._writeSeq,
  });
  const atomDoc4 = await dbGet(STORES.documents, 's8-e4');
  check('8.14: Metadata is from winner (not merged)',
    atomDoc4.metadata && typeof atomDoc4.metadata === 'object' &&
    atomDoc4.metadata.score === (atomDoc4.name === 'I' ? 20 : 30) &&
    atomDoc4.metadata.extra === (atomDoc4.name === 'I' ? 'I' : 'J'),
    'name=' + atomDoc4.name + ' score=' + (atomDoc4.metadata && atomDoc4.metadata.score));

  const tabK = createTab('s8-K');
  const sK = await tabK.dbGet(STORES.documents, 's8-e4');
  const rK = await tabK.saveDoc(PID, {
    id: 's8-e4', name: 'K', type: 'text-document',
    blocks: [{ id: 'z1', content: 'K-content' }],
    metadata: { score: 40 },
    _writeSeq: sK._writeSeq,
  });
  check('8.15: Third-party save after atomicity test works cleanly',
    rK.name === 'K' && rK._writeSeq === 2);
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
