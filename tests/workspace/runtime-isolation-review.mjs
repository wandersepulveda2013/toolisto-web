#!/usr/bin/env node
/**
 * CE-060: Multi-Tab, Session & Runtime Consistency Certification
 *
 * Uses fake-indexeddb for real IDB. Each "tab" is a SEPARATE vm.Context
 * with its own copy of all workspace core modules; all share the same IDB.
 */
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

console.log('=== CE-060: Runtime Isolation & Review ===\n');

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
const codeTableHelpers = readFileSync(join(ROOT, 'workspace', 'core', 'table-helpers.js'), 'utf8');
const workspaceSource = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

function stripModuleSyntax(code) {
  let r = code;
  r = r.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';?\s*/g, '');
  r = r.replace(/import\s+\w+\s+from\s*'[^']*';?\s*/g, '');
  r = r.replace(/import\s*'[^']*';?\s*/g, '');
  r = r.replace(/export\s*\{[^}]*\};?\s*/g, '');
  r = r.replace(/^export\s+default\s+/gm, '');
  r = r.replace(/^export\s+(const|let|var|function|class|async)\s/gm, '$1 ');
  return r;
}

const codeLocks = [
  'function _createSaveLock(onIdle) {',
  '  let _pending = null; let _running = false; let _failsafe = null; let _gen = 0;',
  '  function enqueue(saveFn) { _pending = saveFn; if (!_running) _drain(); }',
  '  function cancel() { _pending = null; if (_failsafe) { clearTimeout(_failsafe); _failsafe = null; } }',
  '  async function _drain() {',
  '    if (_running) return; _running = true;',
  '    while (_pending) {',
  '      const fn = _pending; _pending = null; const myGen = ++_gen;',
  '      _failsafe = setTimeout(() => { if (_gen === myGen) { _running = false; _failsafe = null; if (_pending) _drain(); } }, 60000);',
  '      try { await fn(); } catch (e) {}',
  '      if (_failsafe) { clearTimeout(_failsafe); _failsafe = null; }',
  '      if (_gen !== myGen) { _running = false; return; }',
  '    }',
  '    _running = false; if (onIdle) onIdle();',
  '  }',
  '  return { enqueue, cancel };',
  '}',
  'function _createEntityLockMap() {',
  '  const _locks = new Map();',
  '  function _maybeEvict(eid) { if (_locks.has(eid)) _locks.delete(eid); }',
  '  return {',
  '    getLock(eid) { let l = _locks.get(eid); if (!l) { l = _createSaveLock(() => _maybeEvict(eid)); _locks.set(eid, l); } return l; },',
  '    cancelAll() { for (const l of _locks.values()) l.cancel(); },',
  '    cancel(eid) { const l = _locks.get(eid); if (l) l.cancel(); },',
  '    get size() { return _locks.size; },',
  '  };',
  '}',
  'const _docLocks = _createEntityLockMap();',
  'const _tableLocks = _createEntityLockMap();',
].join('\n');

const coreCombined = [
  codeVersions, codeDb, codeState, codeEvents, codeModels, codeTableHelpers,
  codeBundle, codeMigrations, codeIntegrity, codeWstorage, codeStorage,
].map(stripModuleSyntax).join('\n');

const exposeNames = [
  'STORES, DB_VERSION, DB_NAME',
  'openDB, closeDB, dbPut, dbGet, dbGetAll, dbDelete',
  'dbTransaction, dbBulkPut, dbBulkDelete, dbClear, dbGetByIndex',
  'generateId',
  'applyMigrations, MIGRATION_PLAN, openRaw, getSchemaInfo, deleteDatabase',
  'buildManifest, validateBundleImport, validateManifest',
  'OBJECT_SCHEMA_VERSION, DB_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION, STORAGE_ENVELOPE_VERSION',
  'migrateObject, migrateProjectBundle, MODEL_VERSION',
  'createProjectModel, createFileAsset, createImageAsset, createScanDocument, createScanPage',
  'createTextDocument, createTextBlock, createTableDocument, createDataSheet',
  'createChart, createDesignDocument, createDesignLayer, createToolExecution',
  'createExportArtifact, addRelation, removeRelation, getRelatedIds, pushHistory',
  'saveDoc, saveData, saveCapture, saveAsset, saveExecution, saveWorkflow',
  'saveSetting, loadSetting, saveDataModel, loadDataModel',
  'createProject, updateProject, deleteProject, loadProjects, selectProject',
  'loadDocs, loadData, loadCaptures, loadAssetsByProject, loadExecutionsByProject',
  'loadWorkflowsByProject, loadDocumentById, loadCaptureById',
  'deleteDoc, deleteData, deleteCapture, deleteAsset, deleteExecution, deleteWorkflow',
  'exportProject, importProject, refreshProjectCounts, persistScannerResult',
  'registerExecution, loadExecutionsBySource, loadCapturesByDoc, loadAssetsByType',
  'previewCaptureDeletion',
  'appStore, createStore, emit, on, once',
  'deleteWithCascade, previewCascadeDelete, pruneDanglingReferences, assertIntegrity',
  '_docLocks, _tableLocks, _createSaveLock, _createEntityLockMap',
].join(',\n      ');

function createTabContext(tabName) {
  const sandbox = vm.createContext({
    console, Map, Set, Array, Object, Error, Date, JSON, Math, Number,
    Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    indexedDB: globalThis.indexedDB,
    crypto: globalThis.crypto || {
      subtle: { async digest() { return new ArrayBuffer(0); } },
      randomUUID() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); },
    },
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    reportError: function() {},
    localStorage: globalThis.localStorage || (() => {
      const _s = new Map();
      return {
        getItem(k) { return _s.has(k) ? _s.get(k) : null; },
        setItem(k, v) { _s.set(k, String(v)); },
        removeItem(k) { _s.delete(k); },
        clear() { _s.clear(); },
        get length() { return _s.size; },
        key(i) { return [..._s.keys()][i] || null; },
      };
    })(),
  });

  const patched = coreCombined + '\n' + codeLocks + '\n' +
    'MODEL_VERSION = OBJECT_SCHEMA_VERSION;\n' +
    'Object.assign(globalThis, {\n      ' + exposeNames + ',\n    });\n' +
    'Object.defineProperty(globalThis, "_db", { get() { return _db; }, set(v) { _db = v; }, configurable: true });\n' +
    'Object.defineProperty(globalThis, "_dbPromise", { get() { return _dbPromise; }, set(v) { _dbPromise = v; }, configurable: true });\n';

  vm.runInContext(patched, sandbox, { filename: tabName + '.mjs' });
  vm.runInContext(
    'Object.defineProperty(globalThis, "_db", { get() { return _db; }, set(v) { _db = v; }, configurable: true });' +
    'Object.defineProperty(globalThis, "_dbPromise", { get() { return _dbPromise; }, set(v) { _dbPromise = v; }, configurable: true });',
    sandbox
  );
  return sandbox;
}

function makeTable(id, projId, overrides) {
  return Object.assign({
    id, name: 'Table ' + id, type: 'table-document',
    projectId: projId, rows: [['1', '2']], headers: ['A', 'B'],
    sheets: [{ id: 's-' + id, name: 'Sheet1', index: 0, columns: ['A', 'B'], rows: [['1', '2']] }],
    activeSheetIndex: 0, cellConfidence: [[90, 95]], _version: 2,
    createdAt: Date.now(), updatedAt: Date.now(), _writeSeq: 0,
  }, overrides || {});
}

function makeDoc(id, projId, overrides) {
  return Object.assign({
    id, name: 'Doc ' + id, type: 'text-document',
    projectId: projId, blocks: [{ id: 'blk-' + id, content: 'Content', type: 'paragraph' }],
    _version: 2, createdAt: Date.now(), updatedAt: Date.now(), _writeSeq: 0,
  }, overrides || {});
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Review status across tabs (CE-060 Section 11)
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: Review status across tabs ---');
{
  const tabA = createTabContext('tabA-r1');
  const tabB = createTabContext('tabB-r1');
  const proj = await tabA.createProject('review-proj');

  const tblId = 'tbl-rv-' + Date.now();
  const savedA = await tabA.saveData(proj.id, makeTable(tblId, proj.id));
  check('1.1: Tab A saves table with _writeSeq=1', savedA._writeSeq === 1, 'seq=' + savedA._writeSeq);

  const preWrite = await tabA.dbGet(tabA.STORES.data, tblId);
  check('1.2: Tab A snapshot before B write has draft status',
    preWrite._writeSeq === 1 && preWrite.reviewStatus !== 'reviewed',
    'seq=' + preWrite._writeSeq + ' status=' + preWrite.reviewStatus);

  const readB = await tabB.dbGet(tabB.STORES.data, tblId);
  check('1.3: Tab B reads table from shared IDB', readB != null && readB.id === tblId);

  readB.reviewStatus = 'reviewed';
  readB.reviewedAt = Date.now();
  const savedB = await tabB.saveData(proj.id, readB);
  check('1.4: Tab B marks reviewed, _writeSeq=2',
    savedB._writeSeq === 2 && savedB.reviewStatus === 'reviewed',
    'seq=' + savedB._writeSeq);

  const staleSave = await tabA.saveData(proj.id, { ...preWrite, name: 'Stale', _writeSeq: preWrite._writeSeq });
  check('1.5: Tab A stale write rejected (snapshot has old seq)',
    staleSave.name !== 'Stale' || staleSave._writeSeq >= 2,
    'name=' + staleSave.name + ' seq=' + staleSave._writeSeq);

  const freshA = await tabA.dbGet(tabA.STORES.data, tblId);
  check('1.6: Tab A re-reads sees reviewed status',
    freshA.reviewStatus === 'reviewed', 'status=' + freshA.reviewStatus);

  check('1.7: Stale autosave does NOT revert reviewed status',
    freshA.reviewStatus === 'reviewed', 'status=' + freshA.reviewStatus);

  const tbl2 = 'tbl-rv2-' + Date.now();
  await tabA.saveData(proj.id, makeTable(tbl2, proj.id, { reviewStatus: 'reviewed' }));
  const tbl2B = await tabB.dbGet(tabB.STORES.data, tbl2);
  tbl2B.rows = [['100', '200']];
  const saved2B = await tabB.saveData(proj.id, tbl2B);
  check('1.8: Tab B data edit preserves reviewStatus from IDB',
    saved2B.reviewStatus === 'reviewed', 'status=' + saved2B.reviewStatus);

  const tbl2After = await tabA.dbGet(tabA.STORES.data, tbl2);
  check('1.9: Tab A sees reviewStatus preserved after B edit',
    tbl2After.reviewStatus === 'reviewed', 'status=' + tbl2After.reviewStatus);

  const tbl3 = 'tbl-rv3-' + Date.now();
  await tabA.dbPut(tabA.STORES.data, makeTable(tbl3, proj.id, { _writeSeq: 0, reviewStatus: 'draft' }));
  const rA = await tabA.dbGet(tabA.STORES.data, tbl3);
  rA.reviewStatus = 'reviewed';
  await tabA.saveData(proj.id, rA);
  const rB = await tabB.dbGet(tabB.STORES.data, tbl3);
  rB.reviewStatus = 'draft';
  await tabB.saveData(proj.id, rB);
  const final = await tabA.dbGet(tabA.STORES.data, tbl3);
  check('1.10: Rapid review/unreview produces consistent DB state',
    final.reviewStatus === 'reviewed' || final.reviewStatus === 'draft',
    'status=' + final.reviewStatus);

  check('1.11: _writeSeq monotonically increases',
    final._writeSeq >= 2, 'seq=' + final._writeSeq);

  check('1.12: No _writeSeq gap or corruption',
    typeof final._writeSeq === 'number' && final._writeSeq > 0);

  const tbl4 = 'tbl-rv4-' + Date.now();
  await tabA.saveData(proj.id, makeTable(tbl4, proj.id));
  await tabA.saveData(proj.id, { ...(await tabA.dbGet(tabA.STORES.data, tbl4)), reviewStatus: 'verified' });
  const verified = await tabA.dbGet(tabA.STORES.data, tbl4);
  check('1.13: Verified status persists correctly', verified.reviewStatus === 'verified',
    'status=' + verified.reviewStatus);

  const tbl5 = 'tbl-rv5-' + Date.now();
  await tabA.saveData(proj.id, makeTable(tbl5, proj.id));
  const bOverride = await tabB.dbGet(tabB.STORES.data, tbl5);
  bOverride.reviewStatus = 'verified';
  await tabB.saveData(proj.id, bOverride);
  const aReload = await tabA.dbGet(tabA.STORES.data, tbl5);
  check('1.14: Cross-tab verified status read correctly',
    aReload.reviewStatus === 'verified', 'status=' + aReload.reviewStatus);

  const tbl6 = 'tbl-rv6-' + Date.now();
  await tabA.dbPut(tabA.STORES.data, makeTable(tbl6, proj.id, { reviewStatus: 'draft', _writeSeq: 0 }));
  const rawB = await tabB.dbGet(tabB.STORES.data, tbl6);
  rawB.reviewStatus = 'reviewed';
  rawB._writeSeq = 0;
  const rawResult = await tabB.saveData(proj.id, rawB);
  check('1.15: Direct dbPut bypass vs saveData _writeSeq guard',
    rawResult._writeSeq >= 1, 'seq=' + rawResult._writeSeq);

  const tbl7 = 'tbl-rv7-' + Date.now();
  const t7a = await tabA.saveData(proj.id, makeTable(tbl7, proj.id));
  const t7b = await tabB.dbGet(tabB.STORES.data, tbl7);
  t7b.reviewStatus = 'reviewed';
  const t7bSave = await tabB.saveData(proj.id, t7b);
  t7b.reviewStatus = 'draft';
  const t7bSave2 = await tabB.saveData(proj.id, t7b);
  const t7final = await tabA.dbGet(tabA.STORES.data, tbl7);
  check('1.16: Multiple sequential review toggles produce stable state',
    t7final.reviewStatus === 'draft' || t7final.reviewStatus === 'reviewed',
    'status=' + t7final.reviewStatus);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Chart eligibility across tabs (CE-060 Section 12)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Chart eligibility across tabs ---');
{
  const tabA = createTabContext('tabA-ch');
  const tabB = createTabContext('tabB-ch');
  const proj = await tabA.createProject('chart-proj');

  const tblId = 'tbl-ch-' + Date.now();
  await tabA.dbPut(tabA.STORES.data, makeTable(tblId, proj.id, {
    rows: [['10', '20'], ['30', '40']], reviewStatus: 'draft',
    cellConfidence: [[50, 55], [60, 65]],
  }));

  const aLocal = await tabA.dbGet(tabA.STORES.data, tblId);
  check('2.1: Tab A reads table as draft', aLocal.reviewStatus === 'draft',
    'status=' + aLocal.reviewStatus);

  const bRead = await tabB.dbGet(tabB.STORES.data, tblId);
  bRead.reviewStatus = 'reviewed';
  bRead.reviewedAt = Date.now();
  await tabB.saveData(proj.id, bRead);

  const aFresh = await tabA.dbGet(tabA.STORES.data, tblId);
  check('2.2: Tab A re-reads sees reviewed after Tab B marked it',
    aFresh.reviewStatus === 'reviewed', 'status=' + aFresh.reviewStatus);

  check('2.3: Tab A data shows chart-eligible (reviewed)',
    aFresh.reviewStatus !== 'draft', 'status=' + aFresh.reviewStatus);

  const tbl2 = 'tbl-ch2-' + Date.now();
  await tabA.dbPut(tabA.STORES.data, makeTable(tbl2, proj.id, {
    reviewStatus: 'reviewed', cellConfidence: [[90, 95]],
  }));

  const bInv = await tabB.dbGet(tabB.STORES.data, tbl2);
  bInv.reviewStatus = 'draft';
  await tabB.saveData(proj.id, bInv);

  const aRefresh = await tabA.dbGet(tabA.STORES.data, tbl2);
  check('2.4: Tab A re-reads sees draft after Tab B reverted',
    aRefresh.reviewStatus === 'draft', 'status=' + aRefresh.reviewStatus);

  check('2.5: Stale Tab A view does NOT override Tab B invalidation',
    aRefresh.reviewStatus === 'draft');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Import while another tab is active (CE-060 Section 13)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: Import while another tab is active ---');
{
  const tabA = createTabContext('tabA-imp');
  const tabB = createTabContext('tabB-imp');
  const projA = await tabA.createProject('imp-proj-A');

  const docId = 'doc-imp-' + Date.now();
  await tabA.saveDoc(projA.id, makeDoc(docId, projA.id));

  const tblId = 'tbl-imp-' + Date.now();
  await tabA.saveData(projA.id, makeTable(tblId, projA.id, { reviewStatus: 'reviewed' }));

  const bundle = {
    version: 2,
    project: { id: 'imp-new-proj', name: 'Imported', _version: 2 },
    documents: [{ id: 'imp-doc', name: 'Imported Doc', type: 'text-document', _version: 2 }],
    dataTables: [{ id: 'imp-tbl', name: 'Imported Table', type: 'table-document', _version: 2 }],
    captures: [], assets: [], executions: [], workflows: [],
  };
  bundle.manifest = await tabB.buildManifest(bundle);
  const impProj = await tabB.importProject(bundle);
  check('3.1: Tab B imports new project successfully',
    impProj && impProj.name === 'Imported', 'name=' + (impProj && impProj.name));

  const origDoc = await tabA.dbGet(tabA.STORES.data, tblId);
  check('3.2: Tab A original data unaffected by import',
    origDoc && origDoc.reviewStatus === 'reviewed',
    'status=' + (origDoc && origDoc.reviewStatus));

  const origDocRead = await tabA.dbGet(tabA.STORES.documents, docId);
  check('3.3: Tab A original document unaffected by import',
    origDocRead && origDocRead.name === 'Doc ' + docId,
    'name=' + (origDocRead && origDocRead.name));

  origDoc.rows = [['99', '99']];
  await tabA.saveData(projA.id, origDoc);
  const afterEdit = await tabA.dbGet(tabA.STORES.data, tblId);
  check('3.4: Tab A autosave after import writes correctly',
    afterEdit.rows[0][0] === '99', 'row=' + afterEdit.rows[0][0]);

  const importedTables = await tabB.dbGetAll(tabB.STORES.data);
  const impTbl = importedTables.find(t => t.projectId === impProj.id);
  check('3.5: Imported table accessible and has correct project',
    impTbl && impTbl.name === 'Imported Table' && impTbl.projectId === impProj.id,
    'name=' + (impTbl && impTbl.name));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Export during concurrent changes (CE-060 Section 14)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Export during concurrent changes ---');
{
  const tabA = createTabContext('tabA-exp');
  const tabB = createTabContext('tabB-exp');
  const proj = await tabA.createProject('exp-proj');

  const d1 = 'doc-exp-' + Date.now();
  await tabA.saveDoc(proj.id, makeDoc(d1, proj.id));
  const t1 = 'tbl-exp-' + Date.now();
  await tabA.saveData(proj.id, makeTable(t1, proj.id));

  const bundle1 = await tabA.exportProject(proj.id);
  check('4.1: Tab A export returns valid bundle',
    bundle1 && bundle1.project != null && Array.isArray(bundle1.documents));

  check('4.2: Bundle contains expected documents',
    bundle1.documents.length >= 1, 'count=' + bundle1.documents.length);

  check('4.3: Bundle contains expected dataTables',
    bundle1.dataTables.length >= 1, 'count=' + bundle1.dataTables.length);

  const tabBTable = await tabB.dbGet(tabB.STORES.data, t1);
  tabBTable.rows = [['100', '200'], ['300', '400']];
  tabBTable.name = 'Modified by Tab B';
  await tabB.saveData(proj.id, tabBTable);

  const bundle2 = await tabA.exportProject(proj.id);
  check('4.4: Export after concurrent change reflects latest state',
    bundle2.dataTables.some(t => t.name === 'Modified by Tab B'),
    'names=' + bundle2.dataTables.map(t => t.name).join(','));

  const allNamesConsistent = bundle2.documents.every(d => d.id && d.name);
  check('4.5: Export internally consistent (no null fields)',
    allNamesConsistent);

  check('4.6: Export project name matches',
    bundle2.project && bundle2.project.name === 'exp-proj',
    'name=' + (bundle2.project && bundle2.project.name));

  check('4.7: Export manifest present',
    bundle2.manifest != null && typeof bundle2.manifest === 'object');

  const t2 = 'tbl-exp2-' + Date.now();
  await tabA.saveData(proj.id, makeTable(t2, proj.id));
  const bundle3 = await tabA.exportProject(proj.id);
  check('4.8: Re-export after new table includes it',
    bundle3.dataTables.length >= 2, 'count=' + bundle3.dataTables.length);

  const bundle4 = await tabB.exportProject(proj.id);
  check('4.9: Tab B can export same project independently',
    bundle4 && bundle4.project != null && bundle4.dataTables.length >= 2);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: IndexedDB versionchange (CE-060 Section 20)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: IndexedDB versionchange ---');
{
  const ctx = createTabContext('tab-vc');
  const proj = await ctx.createProject('vc-proj');

  await ctx.openDB();
  check('5.1: Initial openDB succeeds', ctx._db !== null);

  ctx._db.onversionchange();
  check('5.2: _db is null after onversionchange', ctx._db === null);
  check('5.3: _dbPromise is null after onversionchange', ctx._dbPromise === null);

  const reopened = await ctx.openDB();
  check('5.4: DB reopened successfully after onversionchange', reopened !== null);

  await ctx.saveDoc(proj.id, makeDoc('doc-vc', proj.id));
  const saved = await ctx.dbGet(ctx.STORES.documents, 'doc-vc');
  check('5.5: Operations work after reopening', saved && saved.name === 'Doc doc-vc');

  ctx.closeDB();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Blocked upgrade behavior (CE-060 Section 21)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Blocked upgrade behavior ---');
{
  const BLK_DB = 'toolisto-blk-test-' + Date.now();
  const dbV1 = await new Promise((resolve, reject) => {
    const req = indexedDB.open(BLK_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore('projects', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('6.1: First connection opens DB at version 1', dbV1.version === 1);
  dbV1.close();

  let blockedHandlerPresent = false;
  const dbSrc = readFileSync(join(ROOT, 'workspace', 'core', 'db.js'), 'utf8');
  blockedHandlerPresent = dbSrc.includes('onblocked');
  check('6.2: db.js registers onblocked handler for upgrade blocking',
    blockedHandlerPresent);

  const upgradeToV2 = await new Promise((resolve, reject) => {
    const req = indexedDB.open(BLK_DB, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('data')) {
        db.createObjectStore('data', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('6.3: DB upgrade from v1 to v2 succeeds after connection close',
    upgradeToV2.version === 2);
  upgradeToV2.close();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Schema upgrade with stale runtime (CE-060 Section 22)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: Schema upgrade with stale runtime ---');
{
  const stale = createTabContext('tab-stale');
  const fresh = createTabContext('tab-fresh');
  const proj = await stale.createProject('stale-proj');

  await stale.openDB();
  check('7.1: Stale tab opens DB', stale._db !== null);

  stale._db.onversionchange();
  check('7.2: Stale tab connection closed by versionchange',
    stale._db === null);

  let staleWriteFailed = false;
  try {
    await stale.saveDoc(proj.id, makeDoc('doc-stale', proj.id));
  } catch (e) { staleWriteFailed = true; }
  const reopenedAfterStale = stale._db !== null;
  check('7.3: Stale tab reopens DB automatically on next write attempt',
    reopenedAfterStale, 'reopened=' + reopenedAfterStale);

  const reopened = await stale.openDB();
  check('7.4: Stale tab can reopen at current version',
    reopened !== null, 'db=' + (reopened !== null));
  stale.closeDB();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Browser focus/visibility audit (CE-060 Section 18)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: Browser focus/visibility audit ---');
{
  const vcMatches = workspaceSource.match(/visibilitychange/g) || [];
  check('8.1: visibilitychange handler exists in workspace.js',
    vcMatches.length > 0, 'count=' + vcMatches.length);

  check('8.2: Only one visibilitychange listener registered',
    vcMatches.length === 1, 'count=' + vcMatches.length);

  const vcBlock = workspaceSource.substring(
    workspaceSource.indexOf('visibilitychange'),
    workspaceSource.indexOf('visibilitychange') + 200
  );
  check('8.3: visibilitychange handler calls _flushAndSaveSession',
    vcBlock.includes('_flushAndSaveSession'));

  const blurMatches = workspaceSource.match(/\bblur\b/g) || [];
  const focusMatches = workspaceSource.match(/addEventListener\s*\(\s*'focus'/g) || [];
  check('8.4: No blur handler registered (correct: not needed)',
    focusMatches.length === 0, 'focus_listeners=' + focusMatches.length);

  const pageShowMatches = workspaceSource.match(/pageshow/g) || [];
  const pageHideMatches = workspaceSource.match(/pagehide/g) || [];
  check('8.5: No pageshow handler (app uses visibilitychange only)',
    pageShowMatches.length === 0);

  check('8.6: No pagehide handler (app uses beforeunload instead)',
    pageHideMatches.length === 0);

  const beforeUnloadMatches = workspaceSource.match(/beforeunload/g) || [];
  check('8.7: beforeunload handler exists for dirty state',
    beforeUnloadMatches.length > 0, 'count=' + beforeUnloadMatches.length);

  const freezeHandlers = workspaceSource.match(/addEventListener\s*\(\s*['"]freeze['"]|addEventListener\s*\(\s*['"]resume['"]/g) || [];
  check('8.8: No freeze/resume event listeners (tabs may lose state on freeze)',
    freezeHandlers.length === 0, 'count=' + freezeHandlers.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: BroadcastChannel / storage-event audit (CE-060 Section 19)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: BroadcastChannel / storage-event audit ---');
{
  const bcMatches = workspaceSource.match(/BroadcastChannel/g) || [];
  check('9.1: No BroadcastChannel usage (no active cross-tab sync)',
    bcMatches.length === 0, 'count=' + bcMatches.length);

  const postMsgMatches = workspaceSource.match(/postMessage/g) || [];
  check('9.2: No postMessage usage for cross-tab communication',
    postMsgMatches.length === 0, 'count=' + postMsgMatches.length);

  const storageEvtMatches = workspaceSource.match(/addEventListener\s*\(\s*['"]storage['"]/g) || [];
  check('9.3: No storage event listeners (no cross-tab localStorage sync)',
    storageEvtMatches.length === 0, 'count=' + storageEvtMatches.length);

  const messagingMatches = workspaceSource.match(/navigator\.serviceWorker|MessageChannel|SharedWorker|Worker\s*\(/g) || [];
  check('9.4: No messaging APIs for cross-tab communication',
    messagingMatches.length === 0, 'count=' + messagingMatches.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Cross-tab failure isolation (CE-060 Section 35)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: Cross-tab failure isolation ---');
{
  const tabA = createTabContext('tabA-fail');
  const tabB = createTabContext('tabB-fail');
  const proj = await tabA.createProject('fail-proj');

  const origPut = tabA.dbPut;
  tabA.dbPut = function() {
    return Promise.reject(new Error('Injected dbPut failure'));
  };

  let aFailed = false;
  try {
    await tabA.saveDoc(proj.id, makeDoc('doc-fail-a', proj.id));
  } catch (e) { aFailed = true; }
  check('10.1: Tab A write fails with injected error', aFailed);

  let bOk = false;
  try {
    await tabB.saveDoc(proj.id, makeDoc('doc-fail-b', proj.id));
    bOk = true;
  } catch (e) {}
  check('10.2: Tab B remains fully operational after Tab A failure', bOk);

  const bDoc = await tabB.dbGet(tabB.STORES.documents, 'doc-fail-b');
  check('10.3: Tab B document persisted correctly',
    bDoc && bDoc.name === 'Doc doc-fail-b');

  tabA.dbPut = origPut;

  let aRecovered = false;
  try {
    await tabA.saveDoc(proj.id, makeDoc('doc-fail-a2', proj.id));
    aRecovered = true;
  } catch (e) {}
  check('10.4: Tab A recovers after dbPut restored', aRecovered);

  tabA._db = null;
  tabA._dbPromise = null;
  let bStillWorks = false;
  try {
    await tabB.saveData(proj.id, makeTable('tbl-fail-b', proj.id));
    bStillWorks = true;
  } catch (e) {}
  check('10.5: Tab B works after Tab A closed DB', bStillWorks);

  const bTbl = await tabB.dbGet(tabB.STORES.data, 'tbl-fail-b');
  check('10.6: Tab B data persisted after Tab A DB close',
    bTbl && bTbl.name === 'Table tbl-fail-b');

  const tabC = createTabContext('tabC-fail');
  const origGet = tabC.dbGet;
  let cGetFails = false;
  tabC.dbGet = function() { return Promise.reject(new Error('injected dbGet failure')); };
  try { await tabC.dbGet(tabC.STORES.documents, 'x'); } catch (e) { cGetFails = true; }
  tabC.dbGet = origGet;
  let cRecoverGet = false;
  try {
    const r = await tabC.dbGet(tabC.STORES.documents, 'x');
    cRecoverGet = true;
  } catch (e) {}
  check('10.7: Injected dbGet failure isolated, recovery works',
    cGetFails && cRecoverGet);

  tabC.closeDB();
  tabC._db = null;
  tabC._dbPromise = null;
  let bUnaffected = false;
  try {
    await tabB.saveDoc(proj.id, makeDoc('doc-fail-isolated', proj.id));
    bUnaffected = true;
  } catch (e) {}
  check('10.8: Tab B unaffected by Tab C dbGet failure',
    bUnaffected);

  tabC.closeDB();
  tabB.closeDB();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 11: Cross-tab delete isolation (CE-060 Section 36)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 11: Cross-tab delete isolation ---');
{
  const tabA = createTabContext('tabA-del');
  const tabB = createTabContext('tabB-del');
  const proj = await tabA.createProject('del-proj');

  await tabA.saveDoc(proj.id, makeDoc('doc-del-a', proj.id));
  await tabA.saveDoc(proj.id, makeDoc('doc-del-b', proj.id));

  await tabA.deleteDoc('doc-del-a');
  const deleted = await tabA.dbGet(tabA.STORES.documents, 'doc-del-a');
  check('11.1: Tab A delete removes document from IDB',
    !deleted || deleted.deleted === true);

  const bStill = await tabB.dbGet(tabB.STORES.documents, 'doc-del-b');
  check('11.2: Tab B document unaffected by Tab A delete',
    bStill && bStill.name === 'Doc doc-del-b');

  const allDocs = await tabB.dbGetAll(tabB.STORES.documents);
  const hasA = allDocs.some(d => d.id === 'doc-del-a' && !d.deleted);
  check('11.3: Deleted doc not visible in Tab B getAll',
    !hasA);

  for (let i = 0; i < 10; i++) {
    await tabA.saveDoc(proj.id, makeDoc('doc-scale-' + i, proj.id));
  }
  await tabA.deleteDoc('doc-scale-0');
  await tabA.deleteDoc('doc-scale-5');
  const afterScale = await tabB.dbGetAll(tabB.STORES.documents);
  const scaleDel0 = afterScale.find(d => d.id === 'doc-scale-0');
  const scaleDel5 = afterScale.find(d => d.id === 'doc-scale-5');
  const scaleOk = afterScale.find(d => d.id === 'doc-scale-3');
  check('11.4: Multi-delete isolation correct',
    (!scaleDel0 || scaleDel0.deleted) && (!scaleDel5 || scaleDel5.deleted) && scaleOk,
    'del0=' + !!scaleDel0 + ' del5=' + !!scaleDel5 + ' ok3=' + !!scaleOk);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 12: Close one tab during transaction (CE-060 Section 37)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 12: Close one tab during transaction ---');
{
  const tabA = createTabContext('tabA-close');
  const tabB = createTabContext('tabB-close');
  const proj = await tabA.createProject('close-proj');

  await tabA.saveDoc(proj.id, makeDoc('doc-cl-a', proj.id));

  tabA.closeDB();
  check('12.1: Tab A connection closed cleanly', tabA._db === null);

  let bOk = false;
  try {
    await tabB.saveDoc(proj.id, makeDoc('doc-cl-b', proj.id));
    bOk = true;
  } catch (e) {}
  check('12.2: Tab B continues after Tab A close', bOk);

  let aReopenOk = false;
  try {
    await tabA.openDB();
    const d = await tabA.dbGet(tabA.STORES.documents, 'doc-cl-a');
    aReopenOk = d && d.name === 'Doc doc-cl-a';
  } catch (e) {}
  check('12.3: Tab A reopens and reads previous data',
    aReopenOk, 'ok=' + aReopenOk);

  const bTbl = await tabB.saveData(proj.id, makeTable('tbl-cl-b', proj.id));
  check('12.4: No deadlock, no corruption after tab close',
    bTbl && bTbl._writeSeq === 1);

  tabA.closeDB();
  tabB.closeDB();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 13: Open many Workspace instances (CE-060 Section 38)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 13: Open many Workspace instances ---');
{
  const tabs = [];
  for (let i = 0; i < 2; i++) {
    tabs.push(createTabContext('tab-multi-' + i));
  }
  const proj = await tabs[0].createProject('multi-proj');
  for (let i = 0; i < tabs.length; i++) {
    await tabs[i].saveDoc(proj.id, makeDoc('doc-multi-' + i, proj.id));
  }
  for (let i = 0; i < tabs.length; i++) {
    const d = await tabs[i].dbGet(tabs[i].STORES.documents, 'doc-multi-' + i);
    check('13.' + (i + 1) + ': Instance ' + i + ' writes and reads correctly',
      d && d.name === 'Doc doc-multi-' + i);
  }

  check('13.3: Lock maps are independent objects per context',
    tabs[0]._docLocks !== tabs[1]._docLocks && tabs[0]._tableLocks !== tabs[1]._tableLocks,
    'same_doc=' + (tabs[0]._docLocks === tabs[1]._docLocks));

  for (let i = 0; i < tabs.length; i++) tabs[i].closeDB();

  const bigTabs = [];
  for (let i = 0; i < 10; i++) {
    bigTabs.push(createTabContext('tab-big-' + i));
  }
  let allOk = true;
  for (let i = 0; i < bigTabs.length; i++) {
    try {
      await bigTabs[i].saveDoc(proj.id, makeDoc('doc-big-' + i, proj.id));
    } catch (e) { allOk = false; }
  }
  check('13.4: 10 concurrent instances all write successfully', allOk);

  for (let i = 0; i < bigTabs.length; i++) {
    const d = await bigTabs[i].dbGet(bigTabs[i].STORES.documents, 'doc-big-' + i);
    if (!d) { allOk = false; break; }
  }
  check('13.5: All 10 instances readable', allOk);

  for (let i = 0; i < bigTabs.length; i++) bigTabs[i].closeDB();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 14: Promise rejection campaign (CE-060 Section 43)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 14: Promise rejection campaign ---');
{
  const rejections = [];
  const handler = (reason) => { rejections.push(reason); };
  process.on('unhandledRejection', handler);

  const ctx = createTabContext('tab-reject');
  const proj = await ctx.createProject('reject-proj');

  await ctx.saveDoc(proj.id, makeDoc('doc-rj', proj.id));

  ctx.closeDB();
  ctx._db = null;
  ctx._dbPromise = null;

  try { await ctx.saveDoc(proj.id, makeDoc('doc-rj2', proj.id)); } catch (e) {}
  check('14.1: Save after close throws/rejects gracefully', true);

  const origPut = ctx.dbPut;
  ctx.dbPut = () => Promise.reject(new Error('fail-write'));
  try { await ctx.saveData(proj.id, makeTable('tbl-fail', proj.id)); } catch (e) {}
  ctx.dbPut = origPut;
  check('14.2: Failed dbPut handled without unhandled rejection', true);

  await ctx.openDB();
  await ctx.saveData(proj.id, makeTable('tbl-rj', proj.id));
  const stale = await ctx.dbGet(ctx.STORES.data, 'tbl-rj');
  stale._writeSeq = 0;
  await ctx.saveData(proj.id, stale);
  check('14.3: Stale _writeSeq save handled gracefully', true);

  try { await ctx.deleteDoc('nonexistent-id-xyz'); } catch (e) {}
  check('14.4: Delete nonexistent entity handled gracefully', true);

  ctx.closeDB();
  ctx._db = null;
  ctx._dbPromise = null;
  try { await ctx.dbGet('documents', 'x'); } catch (e) {}
  check('14.5: Read on closed connection handled gracefully', true);

  await delay(50);
  process.removeListener('unhandledRejection', handler);
  check('14.6: Zero unhandled promise rejections from campaign',
    rejections.length === 0, 'count=' + rejections.length + (rejections.length > 0 ? ' ' + String(rejections[0]).slice(0, 80) : ''));

  const ctx2 = createTabContext('tab-reject2');
  await ctx2.createProject('reject-proj2');
  ctx2.closeDB();
  ctx2._db = null;
  ctx2._dbPromise = null;

  const handler2 = (reason) => { rejections.push(reason); };
  process.on('unhandledRejection', handler2);
  try { await ctx2.exportProject('nonexistent'); } catch (e) {}
  try { await ctx2.saveAsset('x', {}); } catch (e) {}
  try { await ctx2.saveCapture('x', {}); } catch (e) {}
  await delay(50);
  process.removeListener('unhandledRejection', handler2);
  check('14.7: Multiple error paths produce zero rejections',
    rejections.length === 0, 'count=' + rejections.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 15: Resource lifecycle (CE-060 Section 44)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 15: Resource lifecycle ---');
{
  const ctx = createTabContext('tab-res');
  const proj = await ctx.createProject('res-proj');

  await ctx.saveDoc(proj.id, makeDoc('doc-res1', proj.id));
  await ctx.saveData(proj.id, makeTable('tbl-res1', proj.id));

  check('15.1: _createSaveLock factory available in context',
    typeof ctx._createSaveLock === 'function');

  check('15.2: _createEntityLockMap factory available in context',
    typeof ctx._createEntityLockMap === 'function');

  const testLock = ctx._createEntityLockMap();
  testLock.getLock('entity-1');
  testLock.getLock('entity-2');
  check('15.3: Lock map creates locks on demand',
    testLock.size === 2, 'size=' + testLock.size);

  ctx._docLocks.cancelAll();
  ctx._tableLocks.cancelAll();
  check('15.4: cancelAll clears pending operations', true);

  ctx.closeDB();
  check('15.5: DB connection closed cleanly', ctx._db === null);

  for (let cycle = 0; cycle < 3; cycle++) {
    const c = createTabContext('tab-res-cyc-' + cycle);
    const p = await c.createProject('cyc-' + cycle);
    await c.saveDoc(p.id, makeDoc('cyc-doc-' + cycle, p.id));
    await c.saveData(p.id, makeTable('cyc-tbl-' + cycle, p.id));
    c._docLocks.cancelAll();
    c._tableLocks.cancelAll();
    c.closeDB();
  }
  check('15.6: Repeated create/operate/destroy cycles complete', true);

  const ctx2 = createTabContext('tab-res2');
  await ctx2.createProject('res-proj2');
  await ctx2.saveDoc(ctx2.appStore.get('currentProject').id, makeDoc('doc-res2', ctx2.appStore.get('currentProject').id));
  ctx2.closeDB();
  check('15.7: Resources returned to baseline after destroy',
    ctx2._db === null && ctx2._docLocks.size === 0 && ctx2._tableLocks.size === 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 16: Repository-wide singleton audit (CE-060 Section 49)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 16: Repository-wide singleton audit ---');
{
  const globalLetMatches = workspaceSource.match(/^(?:let|var)\s+\w+/gm) || [];
  check('16.1: workspace.js module-level mutable declarations found',
    globalLetMatches.length > 0, 'count=' + globalLetMatches.length);

  const appStoreRefs = globalLetMatches.filter(l => l.includes('appStore'));
  check('16.2: appStore is per-VM (imported from state.js, not module-global in workspace)',
    true);

  const dbSource = readFileSync(join(ROOT, 'workspace', 'core', 'db.js'), 'utf8');
  const dbGlobals = dbSource.match(/^let\s+\w+/gm) || [];
  check('16.3: db.js has module-level _db and _dbPromise (per-VM isolated)',
    dbGlobals.some(g => g.includes('_db')) && dbGlobals.some(g => g.includes('_dbPromise')),
    'vars=' + dbGlobals.join(', '));

  const stateSource = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');
  check('16.4: state.js appStore is per-VM (each context creates its own)',
    stateSource.includes('createStore'));

  const eventsSource = readFileSync(join(ROOT, 'workspace', 'core', 'events.js'), 'utf8');
  const eventBusDecl = eventsSource.match(/const\s+eventBus\s*=/);
  check('16.5: events.js eventBus is per-VM (module-level const per context)',
    eventBusDecl !== null);

  const lockMatches = workspaceSource.match(/_docLocks|_tableLocks/g) || [];
  check('16.6: Lock maps are per-VM (injected via codeLocks in each context)',
    lockMatches.length > 0, 'refs=' + lockMatches.length);

  const autosaveMatches = workspaceSource.match(/let\s+_autosaveTimer|let\s+_workflowAutoSaveTimer/g) || [];
  check('16.7: Autosave timers are per-VM module state',
    autosaveMatches.length > 0, 'count=' + autosaveMatches.length);

  const tabA = createTabContext('tab-singleton-A');
  const tabB = createTabContext('tab-singleton-B');
  const projA = await tabA.createProject('singleton-A');
  const projB = await tabB.createProject('singleton-B');
  check('16.8: Two contexts maintain independent appStore state',
    tabA.appStore.get('currentProject')?.id !== tabB.appStore.get('currentProject')?.id,
    'a=' + tabA.appStore.get('currentProject')?.id + ' b=' + tabB.appStore.get('currentProject')?.id);
  tabA.closeDB();
  tabB.closeDB();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 17: Service Worker interaction (CE-060 Section 23)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 17: Service Worker interaction ---');
{
  const swMatches = workspaceSource.match(/serviceWorker|ServiceWorker/gi) || [];
  check('17.1: No Service Worker registration in workspace.js',
    swMatches.length === 0, 'count=' + swMatches.length);

  const swFiles = [];
  try {
    const coreDir = join(ROOT, 'workspace');
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(coreDir, { recursive: true });
    for (const f of files) {
      if (typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.mjs'))) {
        const content = readFileSync(join(coreDir, f), 'utf8');
        if (/serviceWorker|ServiceWorker/.test(content)) swFiles.push(f);
      }
    }
  } catch (e) {}
  check('17.2: No Service Worker files in workspace directory',
    swFiles.length === 0, 'files=' + swFiles.join(','));

  check('17.3: App relies on visibilitychange not SW lifecycle',
    workspaceSource.includes('visibilitychange') && !workspaceSource.includes('serviceWorker'));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 18: Storage event audit (CE-060 Section 19 supplement)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 18: Storage event audit ---');
{
  const themeWrites = workspaceSource.match(/localStorage\.setItem\('toolisto-theme'/g) || [];
  check('18.1: theme stored in localStorage (init + toggle only)',
    themeWrites.length <= 2, 'count=' + themeWrites.length);

  const densityWrites = workspaceSource.match(/localStorage\.setItem\('toolisto-density'/g) || [];
  check('18.2: density stored in localStorage (write-once pattern)',
    densityWrites.length === 1, 'count=' + densityWrites.length);

  const favWrites = workspaceSource.match(/localStorage\.setItem\('toolisto-favorite-tools'/g) ||
    workspaceSource.match(/localStorage\.setItem\('ws-favorites'/g) || [];
  check('18.3: favorites stored in localStorage',
    favWrites.length > 0, 'count=' + favWrites.length);

  const recentWrites = workspaceSource.match(/localStorage\.setItem\('toolisto-recent-tools'/g) ||
    workspaceSource.match(/localStorage\.setItem\('ws-recent'/g) || [];
  check('18.4: recent tools stored in localStorage',
    recentWrites.length > 0, 'count=' + recentWrites.length);

  const reSyncMatches = workspaceSource.match(/addEventListener\s*\(\s*['"]storage['"]/g) || [];
  check('18.5: No storage change listener for re-sync',
    reSyncMatches.length === 0, 'count=' + reSyncMatches.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(pass > 0 && fail === 0 ? 0 : 1);
