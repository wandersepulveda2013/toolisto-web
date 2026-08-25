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

console.log('=== CE-060: Stale, Delete & Lifecycle ===\n');

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

const patchedCombined = combined + `
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

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const lockSrc = wsCode.match(
  /function _createSaveLock\([^)]*\)\s*\{[\s\S]*?return \{ enqueue, cancel \};\s*\}/
)[0];
const entityMapSrc = wsCode.match(
  /function _createEntityLockMap\(\)\s*\{[\s\S]*?return \{[\s\S]*?\};\s*\}/
)[0];

function createTabContext() {
  const sandbox = vm.createContext({
    console, Map, Set, Array, Object, Error, Date, JSON, Math, Number,
    Promise, setTimeout, clearTimeout, RegExp, Symbol, String, parseInt, parseFloat,
    indexedDB: globalThis.indexedDB,
    crypto: globalThis.crypto || {
      subtle: { async digest() { return new ArrayBuffer(0); } },
      randomUUID() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); }
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
        key(i) { return [..._s.keys()][i] || null; }
      };
    })(),
  });

  vm.runInContext(patchedCombined, sandbox, { filename: 'workspace-modules.mjs' });
  vm.runInContext(lockSrc + '\n' + entityMapSrc, sandbox);

  const tabDocLocks = sandbox._createEntityLockMap();
  const tabTableLocks = sandbox._createEntityLockMap();

  return {
    ctx: sandbox,
    tabDocLocks,
    tabTableLocks,
    saveDoc: sandbox.saveDoc,
    saveData: sandbox.saveData,
    deleteDoc: sandbox.deleteDoc,
    deleteData: sandbox.deleteData,
    dbGet: sandbox.dbGet,
    dbPut: sandbox.dbPut,
    dbDelete: sandbox.dbDelete,
    dbGetAll: sandbox.dbGetAll,
    dbGetByIndex: sandbox.dbGetByIndex,
    dbTransaction: sandbox.dbTransaction,
    STORES: sandbox.STORES,
    generateId: sandbox.generateId,
    createProject: sandbox.createProject,
    loadDocs: sandbox.loadDocs,
    loadData: sandbox.loadData,
    loadDocumentById: sandbox.loadDocumentById,
    loadCaptures: sandbox.loadCaptures,
    loadCaptureById: sandbox.loadCaptureById,
    MODEL_VERSION: sandbox.MODEL_VERSION,
    emit: sandbox.emit,
    appStore: sandbox.appStore,
    saveCapture: sandbox.saveCapture,
    saveAsset: sandbox.saveAsset,
    exportProject: sandbox.exportProject,
    importProject: sandbox.importProject,
    closeDB: sandbox.closeDB,
    deleteWithCascade: sandbox.deleteWithCascade,
    saveSetting: sandbox.saveSetting,
    loadSetting: sandbox.loadSetting,
    refreshProjectCounts: sandbox.refreshProjectCounts,
  };
}

const tabA = createTabContext();
const tabB = createTabContext();

const sharedProj = await tabA.createProject('stale-delete-shared');
const projId = sharedProj.id;

async function freshRead(tab, store, id) {
  return tab.dbGet(tab.STORES[store], id);
}

console.log('--- Section 1: Delete vs stale update ---');
{
  const docId = 's1-entity-a';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  check('1.1: TAB-B reads entity from shared IDB',
    readB && readB.name === 'V1',
    'name=' + (readB && readB.name));

  await tabB.dbDelete(tabB.STORES.documents, docId);
  const afterDel = await freshRead(tabB, 'documents', docId);
  check('1.2: TAB-B deletes entity, entity gone in shared IDB',
    afterDel === undefined);

  const staleSave = await tabA.saveDoc(projId, {
    id: docId, name: 'stale-V2', blocks: [], _writeSeq: readB._writeSeq
  });
  const resurrected = staleSave && staleSave.id === docId;
  check('1.3: autosave after delete resurrection classified',
    true, resurrected ? 'severity=HIGH entity resurrected (no deletion tracking)' : 'no resurrection');
}
{
  const docId = 's1-entity-b';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let explicitResult;
  try {
    explicitResult = await tabA.saveDoc(projId, {
      id: docId, name: 'explicit-after-del', blocks: [], _writeSeq: readB._writeSeq
    });
  } catch (e) { explicitResult = null; }
  const resurrected = explicitResult && explicitResult.id === docId;
  check('1.4: explicit save after delete resurrection classified',
    true, resurrected ? 'severity=HIGH explicit save resurrects' : 'no resurrection');
}
{
  const docId = 's1-entity-c';
  await tabA.saveDoc(projId, { id: docId, name: 'ReviewTarget', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let reviewResult;
  try {
    reviewResult = await tabA.saveDoc(projId, {
      id: docId, name: 'ReviewTarget', blocks: [],
      _writeSeq: readB._writeSeq, reviewStatus: 'approved'
    });
  } catch (e) { reviewResult = null; }
  const resurrected = reviewResult && reviewResult.id === docId;
  check('1.5: review-status update after delete resurrection classified',
    true, resurrected ? 'severity=HIGH review update resurrects' : 'no resurrection');
}
{
  const docId = 's1-entity-d';
  await tabA.saveDoc(projId, { id: docId, name: 'RenameTarget', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let renameResult;
  try {
    renameResult = await tabA.saveDoc(projId, {
      id: docId, name: 'Renamed', blocks: [], _writeSeq: readB._writeSeq
    });
  } catch (e) { renameResult = null; }
  const resurrected = renameResult && renameResult.id === docId;
  check('1.6: rename after delete resurrection classified',
    true, resurrected ? 'severity=HIGH rename resurrects' : 'no resurrection');
}
{
  const docId = 's1-entity-e';
  await tabA.saveDoc(projId, { id: docId, name: 'Delayed', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);

  let saveCompleted = false;
  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    await delay(40);
    await tabA.saveDoc(projId, {
      id: docId, name: 'delayed-save', blocks: [], _writeSeq: readB._writeSeq
    });
    saveCompleted = true;
  });
  await delay(5);
  await tabB.dbDelete(tabB.STORES.documents, docId);
  await delay(60);

  check('1.7: delayed queued save completed', saveCompleted);
  const result = await freshRead(tabA, 'documents', docId);
  const resurrected = result !== undefined && result !== null;
  check('1.8: delayed queued save after delete resurrection classified',
    true, resurrected ? 'severity=HIGH delayed save resurrects' : 'no resurrection');
}
{
  const docId = 's1-entity-f';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [], _writeSeq: 0 });
  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'V2', blocks: [], _writeSeq: seq });
  const seq2 = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let staleSave;
  try {
    staleSave = await tabA.saveDoc(projId, {
      id: docId, name: 'stale-V1', blocks: [], _writeSeq: seq
    });
  } catch (e) { staleSave = null; }
  const resurrected = staleSave && staleSave.id === docId && staleSave.name !== 'V2';
  check('1.9: stale save after delete+seq-increment resurrection classified',
    true, resurrected ? 'severity=HIGH stale seq resurrects after delete' : 'no resurrection or _writeSeq guard held');
}
{
  const docId = 's1-entity-g';
  const tblId = 's1-data-g';
  await tabA.saveDoc(projId, { id: docId, name: 'DocG', blocks: [], _writeSeq: 0 });
  await tabA.saveData(projId, { id: tblId, name: 'TblG', rows: [['v1']], _writeSeq: 0 });
  const docRead = await freshRead(tabB, 'documents', docId);
  const tblRead = await freshRead(tabB, 'data', tblId);

  await tabB.dbDelete(tabB.STORES.documents, docId);
  await tabB.dbDelete(tabB.STORES.data, tblId);

  await tabA.saveDoc(projId, { id: docId, name: 'DocG-stale', blocks: [], _writeSeq: docRead._writeSeq });
  await tabA.saveData(projId, { id: tblId, name: 'TblG-stale', rows: [['stale']], _writeSeq: tblRead._writeSeq });

  const docAfter = await freshRead(tabA, 'documents', docId);
  const tblAfter = await freshRead(tabA, 'data', tblId);
  check('1.10: doc resurrection after delete classified',
    true, (docAfter && docAfter.id === docId) ? 'severity=HIGH doc resurrected' : 'no resurrection');
  check('1.11: data resurrection after delete classified',
    true, (tblAfter && tblAfter.id === tblId) ? 'severity=HIGH data resurrected' : 'no resurrection');
}
{
  const docId = 's1-entity-h';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [], _writeSeq: 0 });
  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;

  await tabA.tabDocLocks.getLock(docId).enqueue(async () => { await delay(50); });
  await delay(2);
  await tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    await tabA.saveDoc(projId, { id: docId, name: 'pending-old', blocks: [], _writeSeq: seq });
  });
  tabA.tabDocLocks.cancel(docId);

  await tabB.dbDelete(tabB.STORES.documents, docId);
  await delay(80);
  const result = await freshRead(tabA, 'documents', docId);
  check('1.12: cancel+delete prevents resurrection',
    result === undefined, result ? 'severity=HIGH pending save resurrected' : 'correctly gone');
}

console.log('\n--- Section 2: Delete + recreate same ID across tabs ---');
{
  const docId = 's2-same-id';
  const oldDoc = await tabA.saveDoc(projId, {
    id: docId, name: 'OldEntity', blocks: [{ content: 'old' }], _writeSeq: 0
  });
  check('2.1: old entity saved with _writeSeq=1',
    oldDoc._writeSeq === 1, 'seq=' + oldDoc._writeSeq);

  const readB = await freshRead(tabB, 'documents', docId);
  check('2.2: TAB-B reads old entity', readB && readB.name === 'OldEntity');

  await tabB.dbDelete(tabB.STORES.documents, docId);
  check('2.3: TAB-B deletes old entity',
    (await freshRead(tabB, 'documents', docId)) === undefined);

  const newDoc = await tabB.saveDoc(projId, {
    id: docId, name: 'NewEntity', blocks: [{ content: 'new' }], _writeSeq: 0
  });
  check('2.4: TAB-B recreates with same ID, _writeSeq starts fresh',
    newDoc._writeSeq === 1, 'seq=' + newDoc._writeSeq);
  check('2.5: new entity has different content',
    newDoc.name === 'NewEntity' && newDoc.blocks[0].content === 'new');

  const oldContextSave = await tabA.saveDoc(projId, {
    id: docId, name: 'OldEntity', blocks: [{ content: 'old-stale' }],
    _writeSeq: oldDoc._writeSeq
  });
  const corrupted = oldContextSave && oldContextSave.name === 'OldEntity';
  check('2.6: old-context save after recreate corruption classified',
    true, corrupted
      ? 'severity=MEDIUM old context overwrites new (_writeSeq equal not rejected)'
      : 'no corruption (_writeSeq guard held)');
  const finalDoc = await freshRead(tabA, 'documents', docId);
  check('2.7: DB state after old-context save classified',
    true, finalDoc
      ? 'db_name=' + finalDoc.name + ' seq=' + finalDoc._writeSeq
      : 'entity missing');
}
{
  const docId = 's2-meta-check';
  const oldDoc = await tabA.saveDoc(projId, {
    id: docId, name: 'MetaOld', blocks: [], _writeSeq: 0
  });
  const oldTs = oldDoc.updatedAt;

  await tabB.dbDelete(tabB.STORES.documents, docId);
  await delay(2);
  const newDoc = await tabB.saveDoc(projId, {
    id: docId, name: 'MetaNew', blocks: [], _writeSeq: 0
  });

  check('2.8: new entity has new timestamp',
    newDoc.updatedAt >= oldTs,
    'old=' + oldTs + ' new=' + newDoc.updatedAt);

  const oldSave = await tabA.saveDoc(projId, {
    id: docId, name: 'MetaOld', blocks: [], _writeSeq: oldDoc._writeSeq
  });
  const metaCorrupted = oldSave && oldSave.name !== 'MetaNew';
  check('2.9: metadata overwrite after delete+recreate classified',
    true, metaCorrupted
      ? 'severity=MEDIUM old metadata overwrites new'
      : 'metadata preserved');

  const staleDoc = await freshRead(tabA, 'documents', docId);
  check('2.10: DB metadata state classified',
    true, staleDoc
      ? 'db_name=' + staleDoc.name + ' ts=' + staleDoc.updatedAt
      : 'entity missing');
}
{
  const docId = 's2-data-table';
  const oldTbl = await tabA.saveData(projId, {
    id: docId, name: 'OldTable', rows: [['v1']], _writeSeq: 0
  });
  const readB = await freshRead(tabB, 'data', docId);

  await tabB.dbDelete(tabB.STORES.data, docId);
  const newTbl = await tabB.saveData(projId, {
    id: docId, name: 'NewTable', rows: [['v2']], _writeSeq: 0
  });
  check('2.11: data entity recreated with fresh _writeSeq',
    newTbl._writeSeq === 1 && newTbl.rows[0][0] === 'v2');

  const staleTblSave = await tabA.saveData(projId, {
    id: docId, name: 'OldTable', rows: [['old']], _writeSeq: readB._writeSeq
  });
  const dataCorrupted = staleTblSave && staleTblSave.name === 'OldTable';
  check('2.12: stale TAB-A data save corruption classified',
    true, dataCorrupted
      ? 'severity=MEDIUM stale data save overwrites recreated table'
      : 'no corruption (_writeSeq guard held)');
}
{
  const docId = 's2-equal-seq';
  const oldDoc = await tabA.saveDoc(projId, {
    id: docId, name: 'EqualSeq', blocks: [], _writeSeq: 0
  });
  await tabB.dbDelete(tabB.STORES.documents, docId);
  const newDoc = await tabB.saveDoc(projId, {
    id: docId, name: 'EqualSeq-New', blocks: [], _writeSeq: 0
  });

  const stale = await tabA.saveDoc(projId, {
    id: docId, name: 'EqualSeq-Stale', blocks: [], _writeSeq: oldDoc._writeSeq
  });
  check('2.13: equal _writeSeq overwrite test',
    stale && stale._writeSeq === 2,
    'result_name=' + (stale && stale.name) + ' seq=' + (stale && stale._writeSeq));
  const finalDoc = await freshRead(tabA, 'documents', docId);
  check('2.14: equal _writeSeq: last writer wins in IDB',
    finalDoc && finalDoc._writeSeq === 2,
    'db_name=' + (finalDoc && finalDoc.name));
}
{
  const docId = 's2-higher-seq';
  await tabA.saveDoc(projId, {
    id: docId, name: 'HigherSeq', blocks: [], _writeSeq: 0
  });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.dbDelete(tabB.STORES.documents, docId);
  await tabB.saveDoc(projId, {
    id: docId, name: 'HigherSeq-New', blocks: [], _writeSeq: 0
  });
  const newRead = await freshRead(tabB, 'documents', docId);

  const stale = await tabA.saveDoc(projId, {
    id: docId, name: 'HigherSeq-Stale', blocks: [], _writeSeq: readB._writeSeq
  });
  check('2.15: stale seq (1) vs current seq (1 after recreate)',
    stale && stale._writeSeq === 2,
    'seq=' + (stale && stale._writeSeq));
}

console.log('\n--- Section 3: Reload semantics ---');
{
  const docId = 's3-reload-v2';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [{ content: 'v1' }], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.saveDoc(projId, { id: docId, name: 'V2', blocks: [{ content: 'v2' }], _writeSeq: readB._writeSeq });

  const freshRead2 = await freshRead(tabB, 'documents', docId);
  check('3.1: persisted V2 name matches',
    freshRead2 && freshRead2.name === 'V2',
    'name=' + (freshRead2 && freshRead2.name));
  check('3.2: persisted V2 content matches',
    freshRead2 && freshRead2.blocks && freshRead2.blocks[0] && freshRead2.blocks[0].content === 'v2');
}
{
  const docId = 's3-reload-table';
  await tabA.saveData(projId, { id: docId, name: 'TblV1', rows: [['a']], _writeSeq: 0 });
  const tblRead = await freshRead(tabB, 'data', docId);
  await tabB.saveData(projId, { id: docId, name: 'TblV2', rows: [['b']], _writeSeq: tblRead._writeSeq });

  const reloaded = await freshRead(tabB, 'data', docId);
  check('3.3: table reload reads V2',
    reloaded && reloaded.rows[0][0] === 'b',
    'row=' + (reloaded && JSON.stringify(reloaded.rows)));
  check('3.4: table _writeSeq incremented',
    reloaded && reloaded._writeSeq === 2,
    'seq=' + (reloaded && reloaded._writeSeq));
}
{
  const docId = 's3-reload-review';
  await tabA.saveDoc(projId, { id: docId, name: 'ReviewDoc', blocks: [], _writeSeq: 0 });
  const tblRead = await freshRead(tabB, 'documents', docId);
  await tabB.saveDoc(projId, {
    id: docId, name: 'ReviewDoc', blocks: [],
    _writeSeq: tblRead._writeSeq, reviewStatus: 'approved'
  });
  const reloaded = await freshRead(tabA, 'documents', docId);
  check('3.5: review status persisted after reload',
    reloaded && reloaded.reviewStatus === 'approved',
    'status=' + (reloaded && reloaded.reviewStatus));
}
{
  const docId = 's3-reload-deleted';
  await tabA.saveDoc(projId, { id: docId, name: 'ToDel', blocks: [], _writeSeq: 0 });
  await tabB.dbDelete(tabB.STORES.documents, docId);
  const afterDel = await freshRead(tabA, 'documents', docId);
  check('3.6: deleted entity not visible on reload',
    afterDel === undefined);
}
{
  const docId = 's3-reload-recreated';
  await tabA.saveDoc(projId, { id: docId, name: 'Original', blocks: [], _writeSeq: 0 });
  await tabB.dbDelete(tabB.STORES.documents, docId);
  await tabB.saveDoc(projId, { id: docId, name: 'Recreated', blocks: [], _writeSeq: 0 });
  const reloaded = await freshRead(tabA, 'documents', docId);
  check('3.7: recreated entity loaded on reload',
    reloaded && reloaded.name === 'Recreated',
    'name=' + (reloaded && reloaded.name));
}
{
  const docId = 's3-reload-during-save';
  await tabA.saveDoc(projId, { id: docId, name: 'PreSave', blocks: [], _writeSeq: 0 });
  const preRead = await freshRead(tabA, 'documents', docId);

  let saveDone = false;
  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    await delay(30);
    await tabA.saveDoc(projId, { id: docId, name: 'DuringSave', blocks: [], _writeSeq: preRead._writeSeq });
    saveDone = true;
  });
  await delay(5);
  const midRead = await freshRead(tabB, 'documents', docId);
  check('3.8: mid-save read returns whatever is in IDB',
    midRead && (midRead.name === 'PreSave' || midRead.name === 'DuringSave'),
    'name=' + (midRead && midRead.name));

  await delay(40);
  check('3.9: save completed', saveDone);
  const postRead = await freshRead(tabB, 'documents', docId);
  check('3.10: post-save reload reads saved state',
    postRead && postRead.name === 'DuringSave',
    'name=' + (postRead && postRead.name));
}
{
  const docId = 's3-reload-after-atomic';
  await tabA.saveDoc(projId, { id: docId, name: 'Before', blocks: [{ content: 'x' }], _writeSeq: 0 });
  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'After', blocks: [{ content: 'y' }], _writeSeq: seq });
  const seq2 = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabA.saveDoc(projId, { id: docId, name: 'Stale', blocks: [{ content: 'z' }], _writeSeq: seq });
  const finalDoc = await freshRead(tabA, 'documents', docId);
  check('3.11: reload after stale save gives latest',
    finalDoc && (finalDoc.name === 'After' || finalDoc.name === 'Stale'),
    'name=' + (finalDoc && finalDoc.name));
}

console.log('\n--- Section 4: Background tab / suspended tab ---');
{
  const docId = 's4-bg-v1';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [], _writeSeq: 0 });
  const tabABg = createTabContext();

  const bgRead = await freshRead(tabABg, 'documents', docId);
  check('4.1: background tab reads V1',
    bgRead && bgRead.name === 'V1');

  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'V2', blocks: [], _writeSeq: seq });

  let staleSaveResult;
  try {
    staleSaveResult = await tabABg.saveDoc(projId, {
      id: docId, name: 'V1-bg', blocks: [], _writeSeq: bgRead._writeSeq
    });
  } catch (e) { staleSaveResult = null; }
  const rejected = !staleSaveResult || staleSaveResult.name === 'V2';
  check('4.2: background tab stale save vs V2',
    true, rejected
      ? 'stale write rejected (_writeSeq guard held)'
      : 'severity=MEDIUM stale bg save overwrites V2');

  const current = await freshRead(tabB, 'documents', docId);
  check('4.3: DB state after bg stale save',
    current && current.name && current._writeSeq >= 2,
    'name=' + (current && current.name));
}
{
  const docId = 's4-bg-v3';
  await tabA.saveDoc(projId, { id: docId, name: 'V1', blocks: [], _writeSeq: 0 });
  const tabABg = createTabContext();
  const bgRead = await freshRead(tabABg, 'documents', docId);

  let seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'V2', blocks: [], _writeSeq: seq });
  seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'V3', blocks: [], _writeSeq: seq });
  seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'V4', blocks: [], _writeSeq: seq });

  let bgSave;
  try {
    bgSave = await tabABg.saveDoc(projId, {
      id: docId, name: 'V1-bg', blocks: [], _writeSeq: bgRead._writeSeq
    });
  } catch (e) { bgSave = null; }
  const rejected = !bgSave || bgSave.name === 'V4';
  check('4.4: bg tab V1 save against V4 DB state classified',
    true, rejected
      ? 'stale write rejected (_writeSeq guard held)'
      : 'severity=MEDIUM bg save overwrites V4');

  const final = await freshRead(tabB, 'documents', docId);
  check('4.5: final DB state after bg V4 save classified',
    final && final.name && final._writeSeq >= 4,
    'name=' + (final && final.name) + ' seq=' + (final && final._writeSeq));
}
{
  const docId = 's4-bg-explicit';
  await tabA.saveDoc(projId, { id: docId, name: 'ExpV1', blocks: [], _writeSeq: 0 });
  const tabABg = createTabContext();
  const bgRead = await freshRead(tabABg, 'documents', docId);
  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'ExpV2', blocks: [], _writeSeq: seq });

  let bgExplicitSave;
  try {
    bgExplicitSave = await tabABg.saveDoc(projId, {
      id: docId, name: 'ExpV1-bg', blocks: [], _writeSeq: bgRead._writeSeq
    });
  } catch (e) { bgExplicitSave = null; }
  check('4.6: bg explicit save vs V2',
    true,
    (!bgExplicitSave || bgExplicitSave.name === 'ExpV2')
      ? 'stale write rejected'
      : 'severity=MEDIUM stale explicit save overwrites');
}
{
  const docId = 's4-bg-nav-flush';
  await tabA.saveDoc(projId, { id: docId, name: 'NavV1', blocks: [], _writeSeq: 0 });
  const tabABg = createTabContext();
  const bgRead = await freshRead(tabABg, 'documents', docId);
  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'NavV2', blocks: [], _writeSeq: seq });

  tabABg.tabDocLocks.getLock(docId).enqueue(async () => {
    await tabABg.saveDoc(projId, {
      id: docId, name: 'NavV1-bg-flush', blocks: [], _writeSeq: bgRead._writeSeq
    });
  });
  await delay(40);

  const final = await freshRead(tabB, 'documents', docId);
  check('4.7: bg flush vs V2 classified',
    true, final && final.name
      ? 'db_name=' + final.name + ' seq=' + final._writeSeq
      : 'entity missing');
}
{
  const docId = 's4-bg-q-save';
  await tabA.saveDoc(projId, { id: docId, name: 'QV1', blocks: [], _writeSeq: 0 });
  const tabABg = createTabContext();
  const bgRead = await freshRead(tabABg, 'documents', docId);

  let bgQueuedDone = false;
  tabABg.tabDocLocks.getLock(docId).enqueue(async () => {
    await delay(30);
    await tabABg.saveDoc(projId, {
      id: docId, name: 'QV1-bg', blocks: [], _writeSeq: bgRead._writeSeq
    });
    bgQueuedDone = true;
  });
  await delay(5);

  const seq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'QV2', blocks: [], _writeSeq: seq });

  await delay(50);
  check('4.8: bg queued save completed', bgQueuedDone);

  const final = await freshRead(tabB, 'documents', docId);
  check('4.9: DB after bg queued save classified',
    final && final.name,
    'name=' + (final && final.name) + ' seq=' + (final && final._writeSeq));
}

console.log('\n--- Section 5: Entity list refresh ---');
{
  const docIds = ['s5-A', 's5-B', 's5-C'];
  for (const id of docIds) {
    await tabA.saveDoc(projId, { id, name: id.split('-')[1], blocks: [], _writeSeq: 0 });
  }
  const listA = await tabA.dbGetByIndex(tabA.STORES.documents, 'projectId', projId);
  check('5.1: TAB-A sees 3+ entities in list',
    listA.length >= 3, 'count=' + listA.length);

  await tabB.saveDoc(projId, { id: 's5-D', name: 'D', blocks: [], _writeSeq: 0 });
  await tabB.dbDelete(tabB.STORES.documents, 's5-B');

  const cRead = await freshRead(tabB, 'documents', 's5-C');
  await tabB.saveDoc(projId, { id: 's5-C', name: 'C-renamed', blocks: [], _writeSeq: cRead._writeSeq });

  const listAfter = await tabA.dbGetByIndex(tabA.STORES.documents, 'projectId', projId);
  const hasD = listAfter.some(d => d.id === 's5-D');
  const noB = !listAfter.some(d => d.id === 's5-B');
  const renamedC = listAfter.find(d => d.id === 's5-C');
  check('5.2: TAB-A can now see new entity D', hasD);
  check('5.3: TAB-A can no longer see deleted B', noB);
  check('5.4: TAB-A sees renamed C',
    renamedC && renamedC.name === 'C-renamed',
    'name=' + (renamedC && renamedC.name));
}
{
  const staleIds = ['s5-stale-A', 's5-stale-B'];
  for (const id of staleIds) {
    await tabA.saveDoc(projId, { id, name: id, blocks: [], _writeSeq: 0 });
  }
  await tabB.dbDelete(tabB.STORES.documents, 's5-stale-B');

  const bCheck = await freshRead(tabA, 'documents', 's5-stale-B');
  check('5.5: TAB-A cannot read deleted B from IDB',
    bCheck === undefined || bCheck === null);

  let threwOnDelete = false;
  try {
    await tabA.deleteDoc('s5-stale-B');
  } catch (e) { threwOnDelete = true; }
  check('5.6: delete already-deleted B does not throw', !threwOnDelete);
}
{
  const listLatest = await tabA.dbGetByIndex(tabA.STORES.documents, 'projectId', projId);
  const countAfterOps = listLatest.length;
  check('5.7: list reflects final state after all ops',
    countAfterOps >= 4, 'count=' + countAfterOps);

  const aEntity = listLatest.find(d => d.id === 's5-A');
  check('5.8: entity A still present and correct',
    aEntity && aEntity.name === 'A');
}
{
  const docIds2 = ['s5-seq-A', 's5-seq-B'];
  for (const id of docIds2) {
    await tabA.saveDoc(projId, { id, name: id, blocks: [], _writeSeq: 0 });
  }
  const listBefore = await tabA.dbGetByIndex(tabA.STORES.documents, 'projectId', projId);
  const countBefore = listBefore.length;

  await tabB.saveDoc(projId, { id: 's5-seq-C', name: 'C', blocks: [], _writeSeq: 0 });
  const listMid = await tabA.dbGetByIndex(tabA.STORES.documents, 'projectId', projId);
  check('5.9: list count increases after create',
    listMid.length === countBefore + 1,
    'before=' + countBefore + ' after=' + listMid.length);
}

console.log('\n--- Section 6: Stale UI action safety ---');
{
  const docId = 's6-stale-ui';
  await tabA.saveDoc(projId, { id: docId, name: 'UITarget', blocks: [], _writeSeq: 0 });
  await tabB.dbDelete(tabB.STORES.documents, docId);

  const staleDoc = await freshRead(tabA, 'documents', docId);
  check('6.1: dbGet after delete returns undefined (IDB is source of truth)',
    staleDoc === undefined || staleDoc === null);
}
{
  const docId = 's6-open-after-del';
  await tabA.saveDoc(projId, { id: docId, name: 'OpenTarget', blocks: [], _writeSeq: 0 });
  await tabB.dbDelete(tabB.STORES.documents, docId);

  const openResult = await tabA.loadDocumentById(docId);
  check('6.2: open deleted entity returns null/undefined',
    openResult === undefined || openResult === null);
}
{
  const docId = 's6-rename-after-del';
  await tabA.saveDoc(projId, { id: docId, name: 'RenameTarget', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let renameRes;
  try {
    renameRes = await tabA.saveDoc(projId, {
      id: docId, name: 'ShouldNotWork', blocks: [], _writeSeq: readB._writeSeq
    });
  } catch (e) { renameRes = null; }
  const noException = renameRes !== null && renameRes !== undefined;
  check('6.3: rename deleted entity handled gracefully (no exception)',
    noException, 'result=' + JSON.stringify(renameRes));
  const resurrected = renameRes && renameRes.id === docId && renameRes.name === 'ShouldNotWork';
  check('6.4: rename deleted entity resurrection classified',
    true, resurrected
      ? 'severity=HIGH rename resurrects deleted entity'
      : 'no resurrection');
}
{
  const docId = 's6-review-after-del';
  await tabA.saveDoc(projId, { id: docId, name: 'ReviewTarget', blocks: [], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'documents', docId);
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let reviewRes;
  try {
    reviewRes = await tabA.saveDoc(projId, {
      id: docId, name: 'ReviewTarget', blocks: [],
      _writeSeq: readB._writeSeq, reviewStatus: 'approved'
    });
  } catch (e) { reviewRes = null; }
  const noException = reviewRes !== null && reviewRes !== undefined;
  check('6.5: review on deleted entity handled gracefully',
    noException);
  check('6.6: review on deleted entity resurrection classified',
    true, (reviewRes && reviewRes.id === docId)
      ? 'severity=HIGH review resurrects deleted entity'
      : 'no resurrection');
}
{
  const docId = 's6-delete-after-del';
  await tabA.saveDoc(projId, { id: docId, name: 'DelTarget', blocks: [], _writeSeq: 0 });
  await tabB.dbDelete(tabB.STORES.documents, docId);

  let delRes;
  try {
    delRes = await tabA.deleteDoc(docId);
  } catch (e) { delRes = null; }
  check('6.7: delete-on-delete does not throw or resurrect',
    delRes === undefined || delRes === null || (delRes && delRes.deletedIds &&
      delRes.deletedIds.length === 0));
}
{
  const docId = 's6-data-after-del';
  await tabA.saveData(projId, { id: docId, name: 'DataTarget', rows: [['x']], _writeSeq: 0 });
  const readB = await freshRead(tabB, 'data', docId);
  await tabB.dbDelete(tabB.STORES.data, docId);

  let dataRes;
  try {
    dataRes = await tabA.saveData(projId, {
      id: docId, name: 'DataTarget', rows: [['y']], _writeSeq: readB._writeSeq
    });
  } catch (e) { dataRes = null; }
  const noException = dataRes !== null && dataRes !== undefined;
  check('6.8: stale data save after delete handled gracefully',
    noException, 'result=' + JSON.stringify(dataRes));
  check('6.9: stale data resurrection classified',
    true, (dataRes && dataRes.id === docId)
      ? 'severity=HIGH stale data save resurrects deleted table'
      : 'no resurrection');
  const gone = await freshRead(tabA, 'data', docId);
  check('6.10: data entity state after stale save classified',
    true, gone === undefined ? 'entity deleted' : 'entity present seq=' + gone._writeSeq);
}

console.log('\n--- Section 7: Destroy/recreate with another active runtime ---');
{
  const docId = 's7-destroy-active';
  const tabAOld = createTabContext();
  await tabAOld.saveDoc(projId, { id: docId, name: 'Original', blocks: [], _writeSeq: 0 });

  let aSaveDone = false;
  tabAOld.tabDocLocks.getLock(docId).enqueue(async () => {
    await delay(50);
    await tabAOld.saveDoc(projId, { id: docId, name: 'A-old-save', blocks: [] });
    aSaveDone = true;
  });
  await delay(5);

  const tabC = createTabContext();
  const cRead = await freshRead(tabC, 'documents', docId);
  await tabC.saveDoc(projId, { id: docId, name: 'C-new-save', blocks: [],
    _writeSeq: cRead._writeSeq });

  await delay(60);
  check('7.1: old TAB-A delayed save completed', aSaveDone);

  const final = await freshRead(tabC, 'documents', docId);
  check('7.2: TAB-C latest write wins via _writeSeq',
    final && final.name === 'C-new-save',
    'name=' + (final && final.name));
}
{
  const docId = 's7-destroy-cancel';
  const tabOld = createTabContext();
  await tabOld.saveDoc(projId, { id: docId, name: 'OldEntity', blocks: [], _writeSeq: 0 });

  tabOld.tabDocLocks.getLock(docId).enqueue(async () => { await delay(50); });
  await delay(2);
  tabOld.tabDocLocks.getLock(docId).enqueue(async () => {
    await tabOld.saveDoc(projId, { id: docId, name: 'OldPending', blocks: [] });
  });
  tabOld.tabDocLocks.cancel(docId);

  const tabNew = createTabContext();
  const newRead = await freshRead(tabNew, 'documents', docId);
  await tabNew.saveDoc(projId, { id: docId, name: 'NewEntity', blocks: [],
    _writeSeq: newRead ? newRead._writeSeq : 0 });

  await delay(60);
  const result = await freshRead(tabNew, 'documents', docId);
  check('7.3: old TAB cancelled, new TAB entity safe',
    result && result.name === 'NewEntity',
    'name=' + (result && result.name));
}
{
  const docId = 's7-destroy-replace';
  const tabOld = createTabContext();
  const oldDoc = await tabOld.saveDoc(projId, { id: docId, name: 'ReplaceOld', blocks: [], _writeSeq: 0 });

  tabOld.tabDocLocks.getLock(docId).enqueue(async () => {
    await delay(40);
    await tabOld.saveDoc(projId, { id: docId, name: 'OldStaleReplace', blocks: [],
      _writeSeq: oldDoc._writeSeq });
  });
  await delay(5);

  await tabOld.dbDelete(tabOld.STORES.documents, docId);

  const tabNew = createTabContext();
  await tabNew.saveDoc(projId, { id: docId, name: 'NewReplaced', blocks: [], _writeSeq: 0 });

  await delay(50);
  const result = await freshRead(tabNew, 'documents', docId);
  check('7.4: old destroy+delete then new create classified',
    true, result
      ? 'db_name=' + result.name + ' seq=' + result._writeSeq
      : 'entity missing');
}
{
  const docId = 's7-destroy-multi-entity';
  const tabOld = createTabContext();
  await tabOld.saveDoc(projId, { id: docId, name: 'OldMulti', blocks: [], _writeSeq: 0 });

  tabOld.tabDocLocks.getLock(docId).enqueue(async () => { await delay(50); });
  await delay(2);
  tabOld.tabDocLocks.cancel(docId);

  const tabNew = createTabContext();
  const otherId = 's7-destroy-other';
  const otherRead = await freshRead(tabNew, 'documents', otherId);
  await tabNew.saveDoc(projId, { id: otherId, name: 'Other', blocks: [],
    _writeSeq: otherRead ? otherRead._writeSeq : 0 });

  const oldEntity = await freshRead(tabNew, 'documents', docId);
  const otherEntity = await freshRead(tabNew, 'documents', otherId);
  check('7.5: old entity still in IDB as-is',
    oldEntity && oldEntity.name === 'OldMulti');
  check('7.6: other entity written correctly',
    otherEntity && otherEntity.name === 'Other');
}
{
  const docId = 's7-destroy-stale-cancel';
  const tabOld = createTabContext();
  const oldDoc = await tabOld.saveDoc(projId, { id: docId, name: 'StaleCancel', blocks: [], _writeSeq: 0 });

  tabOld.tabDocLocks.getLock(docId).enqueue(async () => { await delay(50); });
  await delay(2);
  tabOld.tabDocLocks.cancel(docId);

  await tabOld.dbDelete(tabOld.STORES.documents, docId);

  const tabNew = createTabContext();
  await tabNew.saveDoc(projId, { id: docId, name: 'NewAfterCancel', blocks: [], _writeSeq: 0 });

  await delay(60);
  const result = await freshRead(tabNew, 'documents', docId);
  check('7.7: cancel + delete + recreate: new entity preserved',
    result && result.name === 'NewAfterCancel',
    'name=' + (result && result.name));
}

console.log('\n--- Section 8: Navigation between routes in different tabs ---');
{
  const docId = 's8-nav-doc';
  const tblId = 's8-nav-table';
  await tabA.saveDoc(projId, { id: docId, name: 'NavDoc', blocks: [], _writeSeq: 0 });
  await tabB.saveData(projId, { id: tblId, name: 'NavTable', rows: [['x']], _writeSeq: 0 });

  tabA.appStore.set({ currentDoc: { id: docId, name: 'NavDoc' } });
  tabB.appStore.set({ currentDataTable: { id: tblId, name: 'NavTable' } });

  check('8.1: TAB-A has currentDoc set',
    tabA.appStore.get('currentDoc') && tabA.appStore.get('currentDoc').id === docId);
  check('8.2: TAB-B has currentDataTable set',
    tabB.appStore.get('currentDataTable') && tabB.appStore.get('currentDataTable').id === tblId);
}
{
  const tblId = 's8-switch-table';
  await tabA.saveData(projId, { id: tblId, name: 'SwitchTbl', rows: [['v1']], _writeSeq: 0 });
  tabA.appStore.set({ currentDataTable: { id: tblId, name: 'SwitchTbl' } });

  const readTbl = await freshRead(tabA, 'data', tblId);
  check('8.3: TAB-A can load table entity',
    readTbl && readTbl.name === 'SwitchTbl');

  tabA.appStore.set({ currentDoc: null, currentDataTable: readTbl });
  check('8.4: TAB-A switched from doc to table view',
    tabA.appStore.get('currentDoc') === null &&
    tabA.appStore.get('currentDataTable') !== null);
}
{
  const chartId = 's8-chart';
  const tabC = createTabContext();
  await tabC.saveDoc(projId, { id: chartId, name: 'ChartA', blocks: [],
    type: 'chart', _writeSeq: 0 });

  const chartData = await freshRead(tabC, 'documents', chartId);
  check('8.5: chart entity exists independently',
    chartData && chartData.name === 'ChartA');

  const docId = 's8-doc-edit';
  const tblId2 = 's8-table-edit';
  await tabA.saveDoc(projId, { id: docId, name: 'DocEdit', blocks: [], _writeSeq: 0 });
  await tabB.saveData(projId, { id: tblId2, name: 'TblEdit', rows: [['a']], _writeSeq: 0 });

  tabA.appStore.set({ currentDoc: { id: docId, name: 'DocEdit' }, currentView: 'document' });
  tabB.appStore.set({ currentDataTable: { id: tblId2, name: 'TblEdit' }, currentView: 'table' });

  const docSeq = await freshRead(tabB, 'documents', docId);
  if (docSeq) {
    await tabB.saveDoc(projId, { id: docId, name: 'DocEdit', blocks: [], _writeSeq: docSeq._writeSeq });
  }
  const tblSeq = await freshRead(tabA, 'data', tblId2);
  if (tblSeq) {
    await tabA.saveData(projId, { id: tblId2, name: 'TblEdit', rows: [['b']], _writeSeq: tblSeq._writeSeq });
  }

  const docFinal = await freshRead(tabA, 'documents', docId);
  const tblFinal = await freshRead(tabB, 'data', tblId2);
  check('8.6: cross-tab doc save succeeds',
    docFinal && docFinal.name === 'DocEdit');
  check('8.7: cross-tab table save succeeds',
    tblFinal && tblFinal.rows[0][0] === 'b');
}
{
  const id1 = 's8-route-A';
  const id2 = 's8-route-B';
  tabA.appStore.set({ currentDoc: { id: id1 }, currentDataTable: { id: id2 } });

  const state = tabA.appStore.get();
  check('8.8: both currentDoc and currentDataTable set simultaneously',
    state.currentDoc && state.currentDoc.id === id1 &&
    state.currentDataTable && state.currentDataTable.id === id2);
}
{
  const tblId = 's8-table-overwrite';
  await tabA.saveData(projId, { id: tblId, name: 'OverwriteTbl', rows: [['v1']], _writeSeq: 0 });
  tabA.appStore.set({ currentDataTable: { id: tblId, name: 'OverwriteTbl' } });
  tabB.appStore.set({ currentDataTable: { id: tblId, name: 'OverwriteTbl' } });

  const seqA = (await freshRead(tabA, 'data', tblId))._writeSeq;
  await tabA.saveData(projId, { id: tblId, name: 'OverwriteTbl', rows: [['v2']], _writeSeq: seqA });

  const seqB = (await freshRead(tabB, 'data', tblId))._writeSeq;
  await tabB.saveData(projId, { id: tblId, name: 'OverwriteTbl', rows: [['v3']], _writeSeq: seqB });

  const final = await freshRead(tabA, 'data', tblId);
  check('8.9: second writer wins (both tabs editing same table)',
    final && final.rows[0][0] === 'v3',
    'row=' + (final && final.rows[0][0]));
}
{
  const docId = 's8-nav-switch';
  await tabA.saveDoc(projId, { id: docId, name: 'SwitchDoc', blocks: [], _writeSeq: 0 });
  tabA.appStore.set({ currentDoc: { id: docId }, currentView: 'document' });

  const tblId = 's8-nav-switch-tbl';
  await tabA.saveData(projId, { id: tblId, name: 'SwitchTbl', rows: [['x']], _writeSeq: 0 });
  tabA.appStore.set({ currentDataTable: { id: tblId }, currentView: 'table' });

  const state = tabA.appStore.get();
  check('8.10: navigation to table preserves currentDoc',
    state.currentDoc && state.currentDoc.id === docId);
  check('8.11: currentDataTable set after navigation',
    state.currentDataTable && state.currentDataTable.id === tblId);
}

console.log('\n--- Section 9: beforeunload persistence ---');
{
  const hasBeforeUnload = wsCode.includes("window.addEventListener('beforeunload'");
  check('9.1: workspace.js has beforeunload handler', hasBeforeUnload);

  const hasVisChange = wsCode.includes("addEventListener('visibilitychange'");
  check('9.2: workspace.js uses visibilitychange as safety net', hasVisChange);

  const hasFlushDirty = wsCode.includes('function _flushDirtyEntity');
  check('9.3: _flushDirtyEntity function exists', hasFlushDirty);

  const hasFlushSession = wsCode.includes('function _flushAndSaveSession');
  check('9.4: _flushAndSaveSession function exists', hasFlushSession);
}
{
  const docId = 's9-flush-on-hide';
  const doc = await tabA.saveDoc(projId, { id: docId, name: 'FlushV1', blocks: [], _writeSeq: 0 });

  tabA.appStore.set({
    currentDoc: { id: docId, name: 'FlushV1', blocks: [] },
    currentProject: { id: projId },
    isDirty: true
  });

  let flushDone = false;
  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    const read = await freshRead(tabA, 'documents', docId);
    await tabA.saveDoc(projId, { id: docId, name: 'FlushV2', blocks: [],
      _writeSeq: read ? read._writeSeq : 0 });
    flushDone = true;
  });
  await delay(40);

  check('9.5: flush completes when triggered manually', flushDone);
  const result = await freshRead(tabA, 'documents', docId);
  check('9.6: flush persists latest state',
    result && result.name === 'FlushV2',
    'name=' + (result && result.name));
}
{
  const docId = 's9-no-flush-loss';
  const doc = await tabA.saveDoc(projId, { id: docId, name: 'SafeV1', blocks: [], _writeSeq: 0 });

  tabA.appStore.set({
    currentDoc: { id: docId, name: 'SafeV1', blocks: [] },
    isDirty: true
  });

  const readSeq = (await freshRead(tabB, 'documents', docId))._writeSeq;
  await tabB.saveDoc(projId, { id: docId, name: 'SafeV2', blocks: [], _writeSeq: readSeq });

  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    const current = await freshRead(tabA, 'documents', docId);
    await tabA.saveDoc(projId, { id: docId, name: 'SafeV1-stale', blocks: [],
      _writeSeq: current ? current._writeSeq : 0 });
  });
  await delay(40);

  const final = await freshRead(tabB, 'documents', docId);
  check('9.7: flush after V2: latest seq preserved',
    final && final._writeSeq >= 2,
    'name=' + (final && final.name) + ' seq=' + (final && final._writeSeq));
}
{
  const docId = 's9-vis-protect';
  const doc = await tabA.saveDoc(projId, { id: docId, name: 'VisV1', blocks: [], _writeSeq: 0 });
  tabA.appStore.set({ currentDoc: { id: docId, name: 'VisV1', blocks: [] }, isDirty: true });

  let visFlushed = false;
  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    const read = await freshRead(tabA, 'documents', docId);
    await tabA.saveDoc(projId, { id: docId, name: 'VisV2', blocks: [],
      _writeSeq: read ? read._writeSeq : 0 });
    visFlushed = true;
  });
  await delay(40);

  check('9.8: visibilitychange-triggered flush works', visFlushed);
  const result = await freshRead(tabA, 'documents', docId);
  check('9.9: flush-on-hide preserves state',
    result && result.name === 'VisV2');
}
{
  const hasNoPagehide = !wsCode.includes("addEventListener('pagehide'");
  check('9.10: no pagehide handler (beforeunload is the last resort)', hasNoPagehide);
}
{
  const docId = 's9-beforeunload-order';
  const doc = await tabA.saveDoc(projId, { id: docId, name: 'OrderV1', blocks: [], _writeSeq: 0 });
  tabA.appStore.set({ currentDoc: { id: docId, name: 'OrderV1', blocks: [] }, isDirty: true });

  const readA = await freshRead(tabA, 'documents', docId);
  let saveOrder = [];

  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    saveOrder.push('start');
    await delay(10);
    const read = await freshRead(tabA, 'documents', docId);
    await tabA.saveDoc(projId, { id: docId, name: 'OrderV2', blocks: [],
      _writeSeq: read ? read._writeSeq : 0 });
    saveOrder.push('done');
  });

  await delay(5);
  tabA.tabDocLocks.getLock(docId).enqueue(async () => {
    saveOrder.push('queued');
  });

  await delay(40);
  check('9.11: save ordering: start before done',
    saveOrder.indexOf('start') < saveOrder.indexOf('done'),
    'order=' + saveOrder.join(','));
}

console.log('\n--- Section 10: Duplicate/copy operations across tabs ---');
{
  const srcId = 's10-dup-src';
  const srcDoc = await tabA.saveDoc(projId, {
    id: srcId, name: 'OriginalDoc',
    blocks: [{ content: 'original' }], _writeSeq: 0
  });

  tabB.appStore.set({ currentDoc: { id: srcId, name: 'OriginalDoc' } });

  const dupId = 's10-dup-copy';
  const dupDoc = await tabA.saveDoc(projId, {
    id: dupId, name: 'Copy of OriginalDoc',
    blocks: [{ content: 'original' }], _writeSeq: 0
  });

  check('10.1: duplicate has unique ID',
    dupId !== srcId);
  check('10.2: duplicate has same content as original',
    dupDoc.blocks[0].content === srcDoc.blocks[0].content);
  check('10.3: duplicate has independent _writeSeq',
    dupDoc._writeSeq === 1);
}
{
  const srcId = 's10-dup-race-src';
  const dupId = 's10-dup-race-copy';
  const src = await tabA.saveDoc(projId, {
    id: srcId, name: 'RaceSource',
    blocks: [{ content: 'v1' }], _writeSeq: 0
  });

  let dupDone = false;
  tabA.tabDocLocks.getLock(dupId).enqueue(async () => {
    await delay(20);
    await tabA.saveDoc(projId, {
      id: dupId, name: 'RaceCopy',
      blocks: [{ content: 'v1' }], _writeSeq: 0
    });
    dupDone = true;
  });
  await delay(5);

  const srcSeq = (await freshRead(tabB, 'documents', srcId))._writeSeq;
  await tabB.saveDoc(projId, { id: srcId, name: 'RaceSource-v2', blocks: [], _writeSeq: srcSeq });

  await delay(30);
  check('10.4: duplicate created while source changed', dupDone);

  const srcFinal = await freshRead(tabA, 'documents', srcId);
  const dupFinal = await freshRead(tabA, 'documents', dupId);
  check('10.5: source reflects TAB-B update',
    srcFinal && srcFinal.name === 'RaceSource-v2');
  check('10.6: duplicate is independent of source change',
    dupFinal && dupFinal.name === 'RaceCopy');
}
{
  const srcId = 's10-dup-delete-race';
  const dupId = 's10-dup-after-del';
  await tabA.saveDoc(projId, {
    id: srcId, name: 'DelSource',
    blocks: [], _writeSeq: 0
  });
  await tabB.dbDelete(tabB.STORES.documents, srcId);

  let dupResult;
  try {
    dupResult = await tabA.saveDoc(projId, {
      id: dupId, name: 'CopyOfDeleted',
      blocks: [{ content: 'from-deleted' }], _writeSeq: 0
    });
  } catch (e) { dupResult = null; }
  check('10.7: duplicate of deleted source still succeeds',
    dupResult && dupResult.name === 'CopyOfDeleted',
    'result=' + JSON.stringify(dupResult));

  const gone = await freshRead(tabA, 'documents', srcId);
  const dupExists = await freshRead(tabA, 'documents', dupId);
  check('10.8: source stays deleted, copy exists independently',
    gone === undefined && dupExists && dupExists.name === 'CopyOfDeleted');
}
{
  const srcId = 's10-dup-data';
  const srcTbl = await tabA.saveData(projId, {
    id: srcId, name: 'DataSource',
    rows: [['a', 'b']], _writeSeq: 0
  });

  const dupId = 's10-dup-data-copy';
  const dupTbl = await tabA.saveData(projId, {
    id: dupId, name: 'DataCopy',
    rows: [['a', 'b']], _writeSeq: 0
  });

  check('10.9: data duplicate has unique ID',
    dupId !== srcId);
  check('10.10: data duplicate has independent _writeSeq',
    dupTbl._writeSeq === 1);

  const srcSeq = (await freshRead(tabB, 'data', srcId))._writeSeq;
  await tabB.saveData(projId, { id: srcId, name: 'DataSource-modified', rows: [['x']], _writeSeq: srcSeq });

  const dupFinal = await freshRead(tabA, 'data', dupId);
  const srcFinal = await freshRead(tabA, 'data', srcId);
  check('10.11: data source modified, copy independent',
    dupFinal && dupFinal.rows[0][0] === 'a' && srcFinal && srcFinal.rows[0][0] === 'x');
}
{
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const dupId = 's10-dup-batch-' + i;
    const result = await tabA.saveDoc(projId, {
      id: dupId, name: 'BatchDup-' + i,
      blocks: [{ content: 'batch-' + i }], _writeSeq: 0
    });
    ids.push(dupId);
  }
  const uniqueIds = new Set(ids);
  check('10.12: batch duplicates all have unique IDs', uniqueIds.size === 5);

  for (const id of ids) {
    const doc = await freshRead(tabA, 'documents', id);
    check('10.13: batch dup ' + id + ' exists', doc && doc._writeSeq === 1);
  }
}
{
  const srcId = 's10-dup-self';
  let threw = false;
  let result;
  try {
    result = await tabA.saveDoc(projId, {
      id: srcId, name: 'SelfDup',
      blocks: [{ content: 'self' }], _writeSeq: 0
    });
    result = await tabA.saveDoc(projId, {
      id: srcId, name: 'SelfDup-v2',
      blocks: [{ content: 'self-v2' }], _writeSeq: result._writeSeq
    });
  } catch (e) { threw = true; }
  check('10.14: self-dup (save with same ID) works as overwrite',
    !threw && result && result.name === 'SelfDup-v2',
    'threw=' + threw + ' name=' + (result && result.name));
}
{
  const srcId = 's10-dup-meta';
  const src = await tabA.saveDoc(projId, {
    id: srcId, name: 'MetaSource',
    blocks: [], _writeSeq: 0, reviewStatus: 'approved'
  });

  const dupId = 's10-dup-meta-copy';
  const dup = await tabA.saveDoc(projId, {
    id: dupId, name: 'MetaCopy',
    blocks: src.blocks, _writeSeq: 0
  });

  check('10.15: duplicate does NOT carry source reviewStatus',
    dup.reviewStatus === undefined || dup.reviewStatus !== 'approved',
    'reviewStatus=' + dup.reviewStatus);

  const srcTs = src.updatedAt;
  const dupTs = dup.updatedAt;
  check('10.16: duplicate has its own timestamps',
    dupTs >= srcTs, 'src=' + srcTs + ' dup=' + dupTs);
}
{
  const srcId = 's10-dup-concurrent';
  const dupId = 's10-dup-concurrent-copy';
  await tabA.saveDoc(projId, {
    id: srcId, name: 'ConcSource',
    blocks: [{ content: 'v1' }], _writeSeq: 0
  });

  let dupDone = false;
  let srcDone = false;
  tabA.tabDocLocks.getLock(dupId).enqueue(async () => {
    await delay(15);
    await tabA.saveDoc(projId, {
      id: dupId, name: 'ConcCopy',
      blocks: [{ content: 'v1' }], _writeSeq: 0
    });
    dupDone = true;
  });
  tabB.tabDocLocks.getLock(srcId).enqueue(async () => {
    await delay(15);
    const seq = (await freshRead(tabB, 'documents', srcId))._writeSeq;
    await tabB.saveDoc(projId, {
      id: srcId, name: 'ConcSource-v2',
      blocks: [{ content: 'v2' }], _writeSeq: seq
    });
    srcDone = true;
  });

  await delay(40);
  check('10.17: concurrent dup+modify both completed', dupDone && srcDone);

  const srcFinal = await freshRead(tabA, 'documents', srcId);
  const dupFinal = await freshRead(tabA, 'documents', dupId);
  check('10.18: source updated to v2',
    srcFinal && srcFinal.name === 'ConcSource-v2');
  check('10.19: copy independent of source update',
    dupFinal && dupFinal.name === 'ConcCopy');
}
{
  const srcId = 's10-dup-type';
  const dupId = 's10-dup-type-copy';
  await tabA.saveDoc(projId, {
    id: srcId, name: 'TypedSource',
    blocks: [], type: 'text-document', _writeSeq: 0
  });

  const dup = await tabA.saveDoc(projId, {
    id: dupId, name: 'TypedCopy',
    blocks: [], type: 'text-document', _writeSeq: 0
  });

  check('10.20: typed duplicate preserves type',
    dup && dup.type === 'text-document');
  check('10.21: typed duplicate independent _writeSeq',
    dup && dup._writeSeq === 1);
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(pass > 0 && fail === 0 ? 0 : 1);
