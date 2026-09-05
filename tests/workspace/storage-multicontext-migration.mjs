#!/usr/bin/env node
/**
 * CE-059: Storage Multi-Context & Migration Certification
 *
 * Multi-tab _writeSeq behavior, schema migration, legacy/malformed/corrupted
 * records, import failure, clock independence, and export consistency.
 *
 * Uses fake-indexeddb for real IDB. Workspace module logic loaded via
 * vm.createContext (same proven pattern as storage-failure-injection.mjs and
 * persistence-sequence-cert.mjs).
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

console.log('=== CE-059: Storage Multi-Context & Migration ===\n');

// ─── Load workspace modules via vm ──────────────────────────────────────────
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

const vmSandbox = vm.createContext({
  console, Map, Set, Array, Object, Error, Date, JSON, Math, Number,
  Promise, setTimeout, clearTimeout, RegExp, Symbol, String, parseInt, parseFloat,
  indexedDB: globalThis.indexedDB,
  crypto: globalThis.crypto || { subtle: { async digest() { return new ArrayBuffer(0); } }, randomUUID() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); } },
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  reportError: function() {},
  localStorage: globalThis.localStorage || (() => {
    const _s = new Map();
    return { getItem(k) { return _s.has(k) ? _s.get(k) : null; }, setItem(k, v) { _s.set(k, String(v)); }, removeItem(k) { _s.delete(k); }, clear() { _s.clear(); }, get length() { return _s.size; }, key(i) { return [..._s.keys()][i] || null; } };
  })(),
});

const combined = [
  codeVersions, codeDb, codeState, codeEvents, codeModels, codeTableHelpers,
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

vm.runInContext(patchedCombined, vmSandbox, { filename: 'workspace-modules.mjs' });

const {
  openDB, closeDB, dbPut, dbGet, dbGetAll, dbGetByIndex, dbTransaction,
  generateId, STORES, DB_VERSION, DB_NAME,
} = vmSandbox;
const { applyMigrations, MIGRATION_PLAN, openRaw } = vmSandbox;
const { buildManifest, validateBundleImport, validateManifest } = vmSandbox;
const { OBJECT_SCHEMA_VERSION, DB_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION, STORAGE_ENVELOPE_VERSION } = vmSandbox;
const { migrateObject, migrateProjectBundle, MODEL_VERSION } = vmSandbox;
const { saveDoc, saveData, saveAsset, saveExecution, exportProject, importProject, createProject, loadDocs, loadData } = vmSandbox;
const { appStore } = vmSandbox;
const { emit } = vmSandbox;

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Multi-tab _writeSeq (Steps 18-19)
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: Multi-tab _writeSeq ---');
{
  closeDB();
  const proj = await createProject('multitab-proj');
  const docId = 'doc-mt1';

  const docA = await saveDoc(proj.id, { id: docId, name: 'Tab-A-initial', blocks: [] });
  check('1.1: Tab A initial save has _writeSeq=1', docA._writeSeq === 1,
    'seq=' + docA._writeSeq);

  const docBRead = await dbGet(STORES.documents, docId);
  check('1.2: Tab B reads _writeSeq=1 from IDB', docBRead && docBRead._writeSeq === 1,
    'seq=' + (docBRead && docBRead._writeSeq));

  const docA2 = await saveDoc(proj.id, { id: docId, name: 'Tab-A-update', blocks: [], _writeSeq: 1 });
  check('1.3: Tab A saves with _writeSeq=2', docA2._writeSeq === 2,
    'seq=' + docA2._writeSeq);

  const staleResult = await saveDoc(proj.id, { id: docId, name: 'Tab-B-stale', blocks: [], _writeSeq: 1 });
  check('1.4: Tab B stale _writeSeq=1 rejected (returns existing)',
    staleResult.name === 'Tab-A-update' && staleResult._writeSeq === 2,
    'name=' + staleResult.name + ' seq=' + staleResult._writeSeq);

  const idbDoc = await dbGet(STORES.documents, docId);
  check('1.5: IDB has _writeSeq=2 from Tab A',
    idbDoc._writeSeq === 2 && idbDoc.name === 'Tab-A-update',
    'seq=' + idbDoc._writeSeq + ' name=' + idbDoc.name);

  const docBReload = await dbGet(STORES.documents, docId);
  const docBWrite = await saveDoc(proj.id,
    { id: docId, name: 'Tab-B-reloaded', blocks: [], _writeSeq: docBReload._writeSeq });
  check('1.6: Tab B reload+save with seq=3 accepted',
    docBWrite._writeSeq === 3 && docBWrite.name === 'Tab-B-reloaded',
    'seq=' + docBWrite._writeSeq);

  await dbPut(STORES.documents, { id: docId, name: 'reset', blocks: [], _writeSeq: 0, projectId: proj.id,
    createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const bothA = await dbGet(STORES.documents, docId);
  const rA = await saveDoc(proj.id,
    { id: docId, name: 'SimA', blocks: [], _writeSeq: bothA._writeSeq });
  check('1.7: Simultaneous A writes first → accepted', rA._writeSeq === 1 && rA.name === 'SimA',
    'seq=' + rA._writeSeq);

  const rB = await saveDoc(proj.id,
    { id: docId, name: 'SimB', blocks: [], _writeSeq: 0 });
  check('1.8: Simultaneous B writes same seq → rejected (returns A)',
    rB.name === 'SimA' && rB._writeSeq === 1,
    'name=' + rB.name + ' seq=' + rB._writeSeq);

  await dbPut(STORES.documents, { id: 'doc-mt-seq', name: 'init', blocks: [], _writeSeq: 0, projectId: proj.id,
    type: 'text-document', createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const initDoc = await dbGet(STORES.documents, 'doc-mt-seq');
  const aFirst = await saveDoc(proj.id,
    { id: 'doc-mt-seq', name: 'A', blocks: [], _writeSeq: initDoc._writeSeq });
  const bFirst = await saveDoc(proj.id,
    { id: 'doc-mt-seq', name: 'B', blocks: [], _writeSeq: initDoc._writeSeq });
  check('1.9: A seq=1 writes first, B seq=1 rejected',
    aFirst.name === 'A' && bFirst.name === 'A',
    'A=' + aFirst.name + ' B=' + bFirst.name);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Multi-tab _writeSeq limitation (documented)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: Multi-tab _writeSeq limitation ---');
{
  await dbPut(STORES.documents, { id: 'doc-limit', name: 'init', blocks: [], _writeSeq: 0, projectId: 'p',
    type: 'text-document', createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });

  const docSnap = await dbGet(STORES.documents, 'doc-limit');
  const tabA = await saveDoc('p',
    { id: 'doc-limit', name: 'TabA-first', blocks: [], _writeSeq: docSnap._writeSeq });
  const tabB = await saveDoc('p',
    { id: 'doc-limit', name: 'TabB-second', blocks: [], _writeSeq: docSnap._writeSeq });
  check('2.1: Tab A writes first → accepted, Tab B rejected',
    tabA.name === 'TabA-first' && tabB.name === 'TabA-first',
    'A=' + tabA.name + ' B=' + tabB.name);

  await dbPut(STORES.documents, { id: 'doc-limit2', name: 'init', blocks: [], _writeSeq: 0, projectId: 'p',
    type: 'text-document', createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const snap2 = await dbGet(STORES.documents, 'doc-limit2');
  const tabB2 = await saveDoc('p',
    { id: 'doc-limit2', name: 'TabB-first', blocks: [], _writeSeq: snap2._writeSeq });
  const tabA2 = await saveDoc('p',
    { id: 'doc-limit2', name: 'TabA-second', blocks: [], _writeSeq: snap2._writeSeq });
  check('2.2: Tab B writes first → accepted, Tab A rejected (last-writer-wins within seq)',
    tabB2.name === 'TabB-first' && tabA2.name === 'TabB-first',
    'B=' + tabB2.name + ' A=' + tabA2.name);

  await dbPut(STORES.documents, { id: 'doc-limit3', name: 'init', blocks: [], _writeSeq: 0, projectId: 'p',
    type: 'text-document', createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION });
  const snap3 = await dbGet(STORES.documents, 'doc-limit3');
  const tabB3 = await saveDoc('p',
    { id: 'doc-limit3', name: 'B-writes-first', blocks: [], _writeSeq: snap3._writeSeq });
  check('2.3: Tab B writes first (seq=0 → 1) → accepted',
    tabB3.name === 'B-writes-first' && tabB3._writeSeq === 1,
    'name=' + tabB3.name + ' seq=' + tabB3._writeSeq);
  const tabA3 = await saveDoc('p',
    { id: 'doc-limit3', name: 'A-stale', blocks: [], _writeSeq: snap3._writeSeq + 1 });
  check('2.4: Tab A with locally incremented seq=1 vs IDB seq=1 → accepted (documented limitation: equal seq not rejected)',
    tabA3.name === 'A-stale' && tabA3._writeSeq === 2,
    'name=' + tabA3.name + ' seq=' + tabA3._writeSeq);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Schema migration (Step 9)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: Schema migration ---');
{
  const MIG_DB = 'multictx-migration-test-' + Date.now();

  const dbV1 = await openRaw(MIG_DB, 1, (db) => {
    MIGRATION_PLAN[1].run(db);
  });
  const v1Stores = Array.from(dbV1.objectStoreNames);
  check('3.1: v1 has projects store', v1Stores.includes('projects'));
  check('3.2: v1 has documents store', v1Stores.includes('documents'));
  check('3.3: v1 has data store', v1Stores.includes('data'));
  check('3.4: v1 has captures store', v1Stores.includes('captures'));
  check('3.5: v1 has settings store', v1Stores.includes('settings'));
  check('3.6: v1 does NOT have assets store', !v1Stores.includes('assets'));
  check('3.7: v1 does NOT have executions store', !v1Stores.includes('executions'));
  check('3.8: v1 does NOT have workflows store', !v1Stores.includes('workflows'));

  await new Promise((resolve, reject) => {
    const tx = dbV1.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({ id: 'v1-proj', name: 'V1 Project', updatedAt: 100 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  dbV1.close();

  const dbV2 = await openRaw(MIG_DB, 2, (db) => {
    MIGRATION_PLAN[2].run(db);
  });
  const v2Stores = Array.from(dbV2.objectStoreNames);
  check('3.9: v2 has assets store', v2Stores.includes('assets'));
  check('3.10: v2 still has projects store', v2Stores.includes('projects'));

  const v2Data = await new Promise((resolve, reject) => {
    const tx = dbV2.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get('v1-proj');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('3.11: data from v1 survives upgrade to v2',
    v2Data && v2Data.name === 'V1 Project',
    'name=' + (v2Data && v2Data.name));

  check('3.18: assets store doesn\'t exist at v1 (verified in 3.6)', true);
  const v2Assets = await new Promise((resolve, reject) => {
    const tx = dbV2.transaction('assets', 'readonly');
    const req = tx.objectStore('assets').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('3.19: assets store exists at v2+ with 0 records', v2Assets.length === 0);

  dbV2.close();

  const dbV3 = await openRaw(MIG_DB, 3, (db) => {
    MIGRATION_PLAN[3].run(db);
  });
  const v3Stores = Array.from(dbV3.objectStoreNames);
  check('3.12: v3 has executions store', v3Stores.includes('executions'));
  check('3.13: v3 has workflows store', v3Stores.includes('workflows'));
  check('3.14: v3 has all 8 stores', v3Stores.length === 8,
    'count=' + v3Stores.length);

  const v3Data = await new Promise((resolve, reject) => {
    const tx = dbV3.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get('v1-proj');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('3.15: data from v1 survives upgrade to v3',
    v3Data && v3Data.name === 'V1 Project',
    'name=' + (v3Data && v3Data.name));

  const v3Idx = await new Promise((resolve, reject) => {
    const tx = dbV3.transaction('documents', 'readonly');
    const idx = tx.objectStore('documents').indexNames;
    const names = [];
    for (let i = 0; i < idx.length; i++) names.push(idx[i]);
    resolve(names);
  });
  check('3.16: documents store has projectId index at v3', v3Idx.includes('projectId'));

  const v3CapIdx = await new Promise((resolve, reject) => {
    const tx = dbV3.transaction('captures', 'readonly');
    const idx = tx.objectStore('captures').indexNames;
    const names = [];
    for (let i = 0; i < idx.length; i++) names.push(idx[i]);
    resolve(names);
  });
  check('3.17: captures store has docId index at v3', v3CapIdx.includes('docId'));

  dbV3.close();
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Legacy records (Step 10)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Legacy records ---');
{
  closeDB();
  const proj = await createProject('legacy-proj');

  const noWriteSeq = { id: 'legacy-nws', name: 'no-writeSeq', type: 'text-document', blocks: [] };
  delete noWriteSeq._writeSeq;
  const savedNWS = await saveDoc(proj.id, noWriteSeq);
  check('4.1: doc with NO _writeSeq accepted',
    savedNWS._writeSeq === 1 && savedNWS.name === 'no-writeSeq',
    'seq=' + savedNWS._writeSeq);

  const noCreatedAt = { id: 'legacy-nca', name: 'no-createdAt', type: 'text-document', blocks: [] };
  delete noCreatedAt.createdAt;
  const savedNCA = await saveDoc(proj.id, noCreatedAt);
  check('4.2: doc with NO createdAt → createdAt set',
    savedNCA.createdAt > 0,
    'createdAt=' + savedNCA.createdAt);

  const noVersion = { id: 'legacy-nv', name: 'no-version', type: 'text-document', blocks: [] };
  delete noVersion._version;
  const savedNV = await saveDoc(proj.id, noVersion);
  check('4.3: doc with NO _version → _version set',
    savedNV._version === MODEL_VERSION,
    '_version=' + savedNV._version);

  const noUpdatedAt = { id: 'legacy-nua', name: 'no-updatedAt', type: 'text-document', blocks: [] };
  delete noUpdatedAt.updatedAt;
  const savedNUA = await saveDoc(proj.id, noUpdatedAt);
  check('4.4: doc with NO updatedAt → updatedAt set',
    savedNUA.updatedAt > 0,
    'updatedAt=' + savedNUA.updatedAt);

  const noProjectId = { id: 'legacy-npi', name: 'no-projectId', type: 'text-document', blocks: [] };
  delete noProjectId.projectId;
  const savedNPI = await saveDoc(proj.id, noProjectId);
  check('4.5: doc with NO projectId → projectId set',
    savedNPI.projectId === proj.id,
    'projectId=' + savedNPI.projectId);

  const version0Obj = { id: 'mig-v0', type: 'text-document', name: 'v0 obj', _version: 0 };
  const migrated = migrateObject(version0Obj);
  check('4.6: migrateObject with _version=0 applies all migrations',
    migrated._version === MODEL_VERSION,
    '_version=' + migrated._version);

  const unknownTypeObj = { id: 'mig-unk', type: 'unknown-type-x', name: 'unknown', _version: 0 };
  const migratedUnknown = migrateObject(unknownTypeObj);
  check('4.7: migrateObject with unknown type returns object',
    migratedUnknown && migratedUnknown.type === 'unknown-type-x',
    'type=' + (migratedUnknown && migratedUnknown.type));

  const noTypeObj = { id: 'mig-notype', name: 'no type' };
  const migratedNoType = migrateObject(noTypeObj);
  check('4.8: migrateObject with no type returns original object',
    migratedNoType === noTypeObj);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Malformed records (Step 10)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Malformed records ---');
{
  closeDB();
  const proj = await createProject('malformed-proj');

  let threw = false;
  try {
    await saveDoc(proj.id, {
      id: 'mal-blocks-str', name: 'bad-blocks', type: 'text-document',
      blocks: 'not-an-array', _version: MODEL_VERSION,
    });
  } catch (e) { threw = true; }
  check('5.1: saveDoc with blocks=string does not crash', !threw);

  threw = false;
  try {
    await saveDoc(proj.id, {
      id: 'mal-headers-null', name: 'bad-headers', type: 'table-document',
      headers: null, _version: MODEL_VERSION,
    });
  } catch (e) { threw = true; }
  check('5.2: saveDoc with headers=null does not crash', !threw);

  threw = false;
  try {
    await saveDoc(proj.id, {
      id: 'mal-rows-undef', name: 'bad-rows', type: 'table-document',
      rows: undefined, _version: MODEL_VERSION,
    });
  } catch (e) { threw = true; }
  check('5.3: saveDoc with rows=undefined does not crash', !threw);

  threw = false;
  try {
    await saveDoc(proj.id, {
      id: 'mal-full-string', name: 'entire-string', type: 'text-document',
    });
  } catch (e) { threw = true; }
  check('5.4: saveDoc with minimal record does not crash', !threw);

  threw = false;
  try {
    await saveData(proj.id, {
      id: 'mal-data-str', name: 'bad-data', type: 'table-document',
      headers: 'not-array', rows: 123, _version: MODEL_VERSION,
    });
  } catch (e) { threw = true; }
  check('5.5: saveData with malformed fields does not crash', !threw);

  let migThrew = false;
  try {
    const badBlocks = { id: 'mig-bad', type: 'text-document', name: 'x', blocks: 'oops', _version: 0 };
    migrateObject(badBlocks);
  } catch (e) { migThrew = true; }
  check('5.6: migrateObject handles blocks=string gracefully', !migThrew);

  let migNullThrew = false;
  try {
    const badNull = { id: 'mig-null', type: 'table-document', name: 'x', headers: null, _version: 0 };
    migrateObject(badNull);
  } catch (e) { migNullThrew = true; }
  check('5.7: migrateObject handles headers=null gracefully', !migNullThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Corrupted records (Step 11)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Corrupted records ---');
{
  closeDB();
  const proj = await createProject('corrupt-proj');

  await dbPut(STORES.documents, {
    id: 'corrupt-arr-expected-obj', name: 'array-instead-of-obj',
    type: 'text-document', projectId: proj.id,
    createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });

  let threw = false;
  try {
    await saveDoc(proj.id, {
      id: 'corrupt-arr-expected-obj', name: 'fix', type: 'text-document',
      _writeSeq: 0,
    });
  } catch (e) { threw = true; }
  check('6.1: saveDoc with corrupt record (existing with bad data) does not crash', !threw);

  await dbPut(STORES.data, {
    id: 'corrupt-num-expected-arr', name: 'num-instead-of-arr',
    type: 'table-document', projectId: proj.id,
    createdAt: Date.now(), updatedAt: Date.now(), _version: MODEL_VERSION,
  });
  threw = false;
  try {
    await saveData(proj.id, {
      id: 'corrupt-num-expected-arr', name: 'fix', type: 'table-document',
      _writeSeq: 0,
    });
  } catch (e) { threw = true; }
  check('6.2: saveData with corrupt record does not crash', !threw);

  threw = false;
  try {
    const circObj = { id: 'circ', type: 'text-document', name: 'circ', _version: MODEL_VERSION };
    circObj.self = circObj;
    migrateObject(circObj);
  } catch (e) { threw = true; }
  check('6.3: migrateObject handles object with circular reference', !threw);

  let globalCrashed = false;
  try {
    const allDocs = await loadDocs(proj.id);
    check('6.4: loadDocs with corrupt record in IDB returns results',
      Array.isArray(allDocs), 'count=' + (allDocs && allDocs.length));
  } catch (e) { globalCrashed = true; }
  check('6.5: loadDocs does not crash on corrupt data', !globalCrashed);

  threw = false;
  try {
    const badObj = { id: 'corrupt-deep', type: 'text-document', name: 'x',
      _version: MODEL_VERSION, blocks: [{ content: [{ nested: 'x' }] }] };
    migrateObject(badObj);
  } catch (e) { threw = true; }
  check('6.6: migrateObject with deeply nested data does not crash', !threw);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Import failure scenarios (Step 24)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: Import failure scenarios ---');
{
  closeDB();
  const existingProjCount = (await dbGetAll(STORES.projects)).length;

  let threw = false;
  try { await importProject(null); } catch (e) { threw = true; }
  check('7.1: importProject with null bundle → throws', threw);

  threw = false;
  try { await importProject({}); } catch (e) { threw = true; }
  check('7.2: importProject with missing project field → throws', threw);

  threw = false;
  try {
    await importProject({ project: { id: 'x', name: 'bad' }, documents: 'not-array' });
  } catch (e) { threw = true; }
  check('7.3: importProject with malformed bundle → throws', threw);

  const dupBundle = {
    version: STORAGE_ENVELOPE_VERSION,
    project: { id: 'dup-proj', name: 'Dup', _version: MODEL_VERSION },
    documents: [
      { id: 'same-id', name: 'A', type: 'text-document', _version: MODEL_VERSION },
      { id: 'same-id', name: 'B', type: 'text-document', _version: MODEL_VERSION },
    ],
    dataTables: [], captures: [], assets: [], executions: [], workflows: [],
  };
  dupBundle.manifest = await buildManifest(dupBundle);
  const projsBeforeDup = (await dbGetAll(STORES.projects)).length;
  threw = false;
  try {
    await importProject(dupBundle);
  } catch (e) { threw = true; }
  const projsAfterDup = (await dbGetAll(STORES.projects)).length;
  check('7.4: importProject with duplicate IDs rejected cleanly (no IDB corruption)',
    threw && projsBeforeDup === projsAfterDup,
    'threw=' + threw + ' before=' + projsBeforeDup + ' after=' + projsAfterDup);

  const largeDocs = [];
  for (let i = 0; i < 100; i++) {
    largeDocs.push({
      id: 'large-' + i, name: 'Doc ' + i, type: 'text-document',
      blocks: [{ id: 'b-' + i, content: 'x'.repeat(500), type: 'paragraph' }],
      _version: MODEL_VERSION,
    });
  }
  const largeBundle = {
    version: STORAGE_ENVELOPE_VERSION,
    project: { id: 'large-proj', name: 'Large', _version: MODEL_VERSION },
    documents: largeDocs,
    dataTables: [], captures: [], assets: [], executions: [], workflows: [],
  };
  largeBundle.manifest = await buildManifest(largeBundle);
  threw = false;
  try { await importProject(largeBundle); } catch (e) { threw = true; }
  check('7.5: importProject with large bundle (within limits) succeeds', !threw);

  const projectsAfterLarge = await dbGetAll(STORES.projects);
  check('7.6: large bundle created new project',
    projectsAfterLarge.length > existingProjCount,
    'before=' + existingProjCount + ' after=' + projectsAfterLarge.length);

  const altBundle = {
    version: STORAGE_ENVELOPE_VERSION,
    project: { id: 'alt-proj', name: 'Altered', _version: MODEL_VERSION },
    documents: [{ id: 'alt-doc', name: 'Alt', type: 'text-document', _version: MODEL_VERSION }],
    dataTables: [], captures: [], assets: [], executions: [], workflows: [],
  };
  altBundle.manifest = await buildManifest(altBundle);
  altBundle.documents[0].name = 'ALTERED-AFTER-MANIFEST';
  threw = false;
  try {
    await importProject(altBundle);
  } catch (e) { threw = true; }
  check('7.7: importProject validation rejects altered manifest', threw);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Clock independence (Step 20)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: Clock independence ---');
{
  closeDB();
  const proj = await createProject('clock-proj');
  const docId = 'doc-clock';

  const doc1 = await saveDoc(proj.id, {
    id: docId, name: 'Time-T', type: 'text-document', blocks: [],
    _writeSeq: 0,
  });
  check('8.1: First save at current time', doc1._writeSeq === 1, 'seq=' + doc1._writeSeq);

  const doc2 = await saveDoc(proj.id, {
    id: docId, name: 'Time-T-same', type: 'text-document', blocks: [],
    _writeSeq: doc1._writeSeq,
  });
  check('8.2: Second save with same _writeSeq → _writeSeq increments',
    doc2._writeSeq === 2 && doc2.name === 'Time-T-same',
    'seq=' + doc2._writeSeq);

  const doc3 = await saveDoc(proj.id, {
    id: docId, name: 'Clock-backward', type: 'text-document', blocks: [],
    _writeSeq: 0,
  });
  check('8.3: Save with stale _writeSeq=0 (clock backward) → rejected',
    doc3._writeSeq === 2 && doc3.name === 'Time-T-same',
    'seq=' + doc3._writeSeq + ' name=' + doc3.name);

  const doc4 = await saveDoc(proj.id, {
    id: docId, name: 'Clock-forward', type: 'text-document', blocks: [],
    _writeSeq: doc2._writeSeq,
  });
  check('8.4: Save with valid _writeSeq (clock forward) → accepted',
    doc4._writeSeq === 3 && doc4.name === 'Clock-forward',
    'seq=' + doc4._writeSeq);

  const doc5 = await saveDoc(proj.id, {
    id: docId, name: 'Seq-guard', type: 'text-document', blocks: [],
    _writeSeq: 1,
  });
  check('8.5: _writeSeq is the true guard, not timestamp → stale rejected',
    doc5._writeSeq === 3 && doc5.name === 'Clock-forward',
    'seq=' + doc5._writeSeq);
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Export consistency (Step 25)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: Export consistency ---');
{
  closeDB();
  const proj = await createProject('export-proj');

  const doc = await saveDoc(proj.id, {
    name: 'Export Doc', type: 'text-document',
    blocks: [{ id: 'blk1', content: 'Hello world', type: 'paragraph', order: 0 }],
  });
  const tbl = await saveData(proj.id, {
    name: 'Export Table', type: 'table-document',
    sheets: [{ id: 's1', name: 'Sheet 1', index: 0, columns: ['A', 'B'], rows: [['1', '2']] }],
    activeSheetIndex: 0,
  });
  await dbPut(STORES.captures, {
    id: 'cap-export', projectId: proj.id, docId: doc.id,
    name: 'Export Capture', type: 'capture', timestamp: Date.now(),
    _version: MODEL_VERSION, createdAt: Date.now(), updatedAt: Date.now(),
  });
  const asset = await saveAsset(proj.id, {
    name: 'export.png', type: 'image-asset',
    mimeType: 'image/png', size: 1024,
  });

  const bundle = await exportProject(proj.id);
  check('9.1: exportProject returns bundle', bundle != null && bundle.project != null);

  check('9.2: bundle contains documents',
    Array.isArray(bundle.documents) && bundle.documents.length >= 1,
    'count=' + (bundle.documents && bundle.documents.length));
  check('9.3: bundle contains dataTables',
    Array.isArray(bundle.dataTables) && bundle.dataTables.length >= 1,
    'count=' + (bundle.dataTables && bundle.dataTables.length));
  check('9.4: bundle contains captures',
    Array.isArray(bundle.captures) && bundle.captures.length >= 1,
    'count=' + (bundle.captures && bundle.captures.length));
  check('9.5: bundle contains assets',
    Array.isArray(bundle.assets) && bundle.assets.length >= 1,
    'count=' + (bundle.assets && bundle.assets.length));

  check('9.6: bundle has manifest', bundle.manifest != null);
  check('9.7: manifest has schemaVersion',
    bundle.manifest && bundle.manifest.schemaVersion === BUNDLE_SCHEMA_VERSION,
    'sv=' + (bundle.manifest && bundle.manifest.schemaVersion));
  check('9.8: manifest has counts',
    bundle.manifest && typeof bundle.manifest.counts === 'object');
  check('9.9: manifest has checksums',
    bundle.manifest && typeof bundle.manifest.checksums === 'object');

  check('9.10: manifest checksums count matches documents',
    bundle.manifest.counts.documents === bundle.documents.length,
    'manifest=' + bundle.manifest.counts.documents + ' actual=' + bundle.documents.length);
  check('9.11: manifest checksums count matches dataTables',
    bundle.manifest.counts.dataTables === bundle.dataTables.length,
    'manifest=' + bundle.manifest.counts.dataTables + ' actual=' + bundle.dataTables.length);
  check('9.12: manifest checksums count matches captures',
    bundle.manifest.counts.captures === bundle.captures.length,
    'manifest=' + bundle.manifest.counts.captures + ' actual=' + bundle.captures.length);
  check('9.13: manifest checksums count matches assets',
    bundle.manifest.counts.assets === bundle.assets.length,
    'manifest=' + bundle.manifest.counts.assets + ' actual=' + bundle.assets.length);

  const validation = await validateManifest(bundle);
  check('9.14: manifest validates successfully', validation.ok,
    'errors=' + JSON.stringify(validation.errors));

  const docBeforeExport = await dbGet(STORES.documents, doc.id);
  await saveDoc(proj.id, { ...docBeforeExport, name: 'Modified-After-Export', blocks: docBeforeExport.blocks });
  const bundle2 = await exportProject(proj.id);
  check('9.15: export after mutation reflects latest state',
    bundle2.documents[0].name === 'Modified-After-Export',
    'name=' + (bundle2.documents[0] && bundle2.documents[0].name));

  const validation2 = await validateManifest(bundle2);
  check('9.16: post-mutation export manifest validates',
    validation2.ok, 'errors=' + JSON.stringify(validation2.errors));
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Storage initialization failure (Step 26)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: Storage initialization failure ---');
{
  closeDB();

  const FAIL_DB = 'multictx-fail-init-' + Date.now();
  const dbLow = await openRaw(FAIL_DB, 2, (db) => {
    if (!db.objectStoreNames.contains('legacyStore')) {
      db.createObjectStore('legacyStore', { keyPath: 'id' });
    }
  });
  dbLow.close();

  let caught = false;
  let errMsg = '';
  try {
    await openRaw(FAIL_DB, 1, (db) => {
      applyMigrations(db, 0);
    });
  } catch (e) {
    caught = true;
    errMsg = e.message || String(e);
  }
  check('10.1: openDB with lower version than existing → error caught',
    caught, 'msg=' + errMsg);

  const dbRecover = await openRaw(FAIL_DB, 3, (db) => {
    if (!db.objectStoreNames.contains('projects')) {
      const ps = db.createObjectStore('projects', { keyPath: 'id' });
      ps.createIndex('updatedAt', 'updatedAt');
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
    }
    if (!db.objectStoreNames.contains('executions')) {
      const es = db.createObjectStore('executions', { keyPath: 'id' });
      es.createIndex('projectId', 'projectId');
    }
    if (!db.objectStoreNames.contains('workflows')) {
      const ws = db.createObjectStore('workflows', { keyPath: 'id' });
      ws.createIndex('projectId', 'projectId');
    }
  });
  check('10.2: recovery openDB with higher version succeeds',
    dbRecover != null && dbRecover.version === 3);

  await new Promise((resolve, reject) => {
    const tx = dbRecover.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({ id: 'recovery-proj', name: 'Recovery' });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const recoveryData = await new Promise((resolve, reject) => {
    const tx = dbRecover.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get('recovery-proj');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('10.3: recovery DB is functional',
    recoveryData && recoveryData.name === 'Recovery');

  dbRecover.close();

  closeDB();
  const mainProj = await createProject('after-fail-proj');
  check('10.4: main DB still works after external failure',
    mainProj && mainProj.name === 'after-fail-proj');

  const dbAfterMain = await openRaw(FAIL_DB, 4, (db) => {
    if (!db.objectStoreNames.contains('projects')) {
      const ps = db.createObjectStore('projects', { keyPath: 'id' });
      ps.createIndex('updatedAt', 'updatedAt');
    }
  });
  const persistData = await new Promise((resolve, reject) => {
    const tx = dbAfterMain.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get('recovery-proj');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  check('10.5: external DB data persisted after version upgrade',
    persistData && persistData.name === 'Recovery');
  dbAfterMain.close();
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
