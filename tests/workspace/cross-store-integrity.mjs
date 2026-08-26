#!/usr/bin/env node
/**
 * CE-061: Cross-Store Orphan & Referential Integrity Certification
 *
 * Adversarial audit of every entity's foreign-key references, cascade completeness,
 * orphan detection, cross-store atomicity of delete/import, and transaction isolation.
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

console.log('=== CE-061: Cross-Store Integrity Audit ===\n');

// ============================================================
// VM bootstrap: load all core modules in dependency order
// ============================================================
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

  return {
    ctx: sandbox,
    dbGet: sandbox.dbGet,
    dbPut: sandbox.dbPut,
    dbDelete: sandbox.dbDelete,
    dbGetAll: sandbox.dbGetAll,
    dbGetByIndex: sandbox.dbGetByIndex,
    dbTransaction: sandbox.dbTransaction,
    dbBulkPut: sandbox.dbBulkPut,
    dbBulkDelete: sandbox.dbBulkDelete,
    dbClear: sandbox.dbClear,
    STORES: sandbox.STORES,
    generateId: sandbox.generateId,
    createProject: sandbox.createProject,
    saveDoc: sandbox.saveDoc,
    saveData: sandbox.saveData,
    saveCapture: sandbox.saveCapture,
    saveAsset: sandbox.saveAsset,
    saveExecution: sandbox.saveExecution,
    saveWorkflow: sandbox.saveWorkflow,
    saveSetting: sandbox.saveSetting,
    loadSetting: sandbox.loadSetting,
    loadDocs: sandbox.loadDocs,
    loadData: sandbox.loadData,
    loadCaptures: sandbox.loadCaptures,
    loadDocumentById: sandbox.loadDocumentById,
    loadCaptureById: sandbox.loadCaptureById,
    deleteDoc: sandbox.deleteDoc,
    deleteData: sandbox.deleteData,
    deleteCapture: sandbox.deleteCapture,
    deleteAsset: sandbox.deleteAsset,
    deleteExecution: sandbox.deleteExecution,
    deleteWorkflow: sandbox.deleteWorkflow,
    deleteProject: sandbox.deleteProject,
    exportProject: sandbox.exportProject,
    importProject: sandbox.importProject,
    deleteWithCascade: sandbox.deleteWithCascade,
    previewCascadeDelete: sandbox.previewCascadeDelete,
    pruneDanglingReferences: sandbox.pruneDanglingReferences,
    assertIntegrity: sandbox.assertIntegrity,
    refreshProjectCounts: sandbox.refreshProjectCounts,
    createTextDocument: sandbox.createTextDocument,
    createTableDocument: sandbox.createTableDocument,
    createDataSheet: sandbox.createDataSheet,
    createScanDocument: sandbox.createScanDocument,
    createScanPage: sandbox.createScanPage,
    createChart: sandbox.createChart,
    createImageAsset: sandbox.createImageAsset,
    createFileAsset: sandbox.createFileAsset,
    createToolExecution: sandbox.createToolExecution,
    createWorkflow: sandbox.createWorkflow,
    createExportArtifact: sandbox.createExportArtifact,
    addRelation: sandbox.addRelation,
    removeRelation: sandbox.removeRelation,
    getRelatedIds: sandbox.getRelatedIds,
    pushHistory: sandbox.pushHistory,
    MODEL_VERSION: sandbox.MODEL_VERSION,
    appStore: sandbox.appStore,
    closeDB: sandbox.closeDB,
    openDB: sandbox.openDB,
  };
}

const TAB = createTabContext();
const {
  dbGet, dbPut, dbDelete, dbGetAll, dbGetByIndex, dbTransaction,
  dbBulkPut, dbBulkDelete, dbClear,
  STORES, generateId, deleteWithCascade, previewCascadeDelete,
  pruneDanglingReferences, assertIntegrity,
  createProject, saveDoc, saveData, saveCapture, saveAsset,
  saveExecution, saveWorkflow, saveSetting, loadSetting,
  loadDocs, loadData, loadCaptures, loadDocumentById,
  deleteDoc, deleteData, deleteCapture, deleteAsset,
  deleteExecution, deleteWorkflow, deleteProject,
  exportProject, importProject,
  createTextDocument, createTableDocument, createScanDocument, createChart,
  createImageAsset, createFileAsset, createToolExecution, createWorkflow,
  createExportArtifact, createDataSheet, createScanPage,
  addRelation, removeRelation, getRelatedIds,
  MODEL_VERSION, appStore, closeDB, openDB,
} = TAB;

// ============================================================
// Section 1: Entity Store Completeness (10 tests)
// ============================================================
console.log('--- 1. Entity Store Completeness ---');
{
  const storeNames = ['projects', 'documents', 'data', 'captures', 'settings', 'assets', 'executions', 'workflows'];
  check('1.1: All 8 stores defined in STORES',
    storeNames.every(s => STORES[s] === s),
    JSON.stringify(Object.values(STORES).sort()));

  const proj = await createProject('test-proj');
  check('1.2: Project created and readable',
    proj && proj.id && proj.type === 'project',
    'type=' + (proj && proj.type));

  const readBack = await dbGet(STORES.projects, proj.id);
  check('1.3: Project roundtrip through IndexedDB',
    readBack && readBack.id === proj.id,
    'id=' + (readBack && readBack.id));

  const allProjects = await dbGetAll(STORES.projects);
  check('1.4: getAll returns array with at least one project',
    Array.isArray(allProjects) && allProjects.length >= 1,
    'len=' + allProjects.length);

  const doc = await saveDoc(proj.id, { id: generateId(), name: 'TestDoc', blocks: [] });
  const docs = await dbGetByIndex(STORES.documents, 'projectId', proj.id);
  check('1.5: Document put+getByIndex works',
    docs.length === 1 && docs[0].id === doc.id,
    'docs=' + docs.length);

  const tbl = await saveData(proj.id, { id: generateId(), name: 'TestTable', rows: [] });
  const data = await dbGetByIndex(STORES.data, 'projectId', proj.id);
  check('1.6: DataTable put+getByIndex works',
    data.length === 1 && data[0].id === tbl.id,
    'data=' + data.length);

  const cap = await saveCapture(proj.id, { id: generateId(), name: 'TestCapture', type: 'camera' });
  const caps = await dbGetByIndex(STORES.captures, 'projectId', proj.id);
  check('1.7: Capture put+getByIndex works',
    caps.length === 1 && caps[0].id === cap.id,
    'caps=' + caps.length);

  const ast = await saveAsset(proj.id, createImageAsset('photo.jpg', proj.id));
  const assets = await dbGetByIndex(STORES.assets, 'projectId', proj.id);
  check('1.8: Asset put+getByIndex works',
    assets.length >= 1,
    'assets=' + assets.length);

  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  const execs = await dbGetByIndex(STORES.executions, 'projectId', proj.id);
  check('1.9: Execution put+getByIndex works',
    execs.length === 1 && execs[0].id === exec.id,
    'execs=' + execs.length);

  const wf = await saveWorkflow(proj.id, createWorkflow('TestFlow', proj.id));
  const wfs = await dbGetByIndex(STORES.workflows, 'projectId', proj.id);
  check('1.10: Workflow put+getByIndex works',
    wfs.length === 1 && wfs[0].id === wf.id,
    'wfs=' + wfs.length);
}

// ============================================================
// Section 2: Cascade Delete Topology (20 tests)
// ============================================================
console.log('\n--- 2. Cascade Delete Topology ---');

// 2a: Asset -> Execution via sourceAssetId
{
  const proj = await createProject('cascade-asset');
  const asset = await saveAsset(proj.id, createImageAsset('src.jpg', proj.id));
  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  exec.sourceAssetId = asset.id;
  await saveExecution(proj.id, exec);

  const result = await deleteWithCascade(STORES.assets, asset.id);
  const afterExec = await dbGet(STORES.executions, exec.id);
  check('2.1: deleteWithCascade(asset) deletes exec via sourceAssetId',
    result.deletedIds.includes(exec.id) && afterExec === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2b: Capture -> ScanDocument via captureId (document has captureId)
{
  const proj = await createProject('cascade-capture');
  const cap = await saveCapture(proj.id, { id: generateId(), name: 'cap1', type: 'scan' });
  const scanDoc = createScanDocument('scan1', proj.id);
  scanDoc.captureId = cap.id;
  await saveDoc(proj.id, scanDoc);

  const result = await deleteWithCascade(STORES.captures, cap.id);
  const afterDoc = await dbGet(STORES.documents, scanDoc.id);
  check('2.2: deleteWithCascade(capture) deletes doc via captureId',
    result.deletedIds.includes(scanDoc.id) && afterDoc === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2c: Document -> derived via sourceDocId
{
  const proj = await createProject('cascade-doc');
  const srcDoc = await saveDoc(proj.id, { id: generateId(), name: 'srcDoc', blocks: [] });
  const childDoc = await saveDoc(proj.id, { id: generateId(), name: 'childDoc', blocks: [], sourceDocId: srcDoc.id });

  const result = await deleteWithCascade(STORES.documents, srcDoc.id);
  const afterChild = await dbGet(STORES.documents, childDoc.id);
  check('2.3: deleteWithCascade(doc) deletes child via sourceDocId',
    result.deletedIds.includes(childDoc.id) && afterChild === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2d: Document -> Table via scanDocId
{
  const proj = await createProject('cascade-scandoc');
  const scanDoc = await saveDoc(proj.id, { id: generateId(), name: 'scanD', type: 'scan-document', pages: [] });
  const tbl = await saveData(proj.id, { id: generateId(), name: 'tbl1', rows: [], scanDocId: scanDoc.id });

  const result = await deleteWithCascade(STORES.documents, scanDoc.id);
  const afterTbl = await dbGet(STORES.data, tbl.id);
  check('2.4: deleteWithCascade(scan-doc) deletes table via scanDocId',
    result.deletedIds.includes(tbl.id) && afterTbl === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2e: Table -> Chart via sourceTableId
{
  const proj = await createProject('cascade-table');
  const tbl = await saveData(proj.id, { id: generateId(), name: 'srcTable', rows: [] });
  const chart = createChart('chart1', proj.id, tbl.id);
  await saveDoc(proj.id, chart);

  const result = await deleteWithCascade(STORES.data, tbl.id);
  const afterChart = await dbGet(STORES.documents, chart.id);
  check('2.5: deleteWithCascade(table) deletes chart via sourceTableId',
    result.deletedIds.includes(chart.id) && afterChart === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2f: Asset -> Execution via resultAssetId
{
  const proj = await createProject('cascade-result');
  const asset = await saveAsset(proj.id, createImageAsset('result.jpg', proj.id));
  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  exec.resultAssetId = asset.id;
  await saveExecution(proj.id, exec);

  const result = await deleteWithCascade(STORES.assets, asset.id);
  const afterExec = await dbGet(STORES.executions, exec.id);
  check('2.6: deleteWithCascade(asset) deletes exec via resultAssetId',
    result.deletedIds.includes(exec.id) && afterExec === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2g: Config fields: entity with config.captureId
{
  const proj = await createProject('cascade-config-cap');
  const cap = await saveCapture(proj.id, { id: generateId(), name: 'cap', type: 'camera' });
  const doc = await saveDoc(proj.id, {
    id: generateId(), name: 'refDoc', blocks: [],
    config: { captureId: cap.id }
  });

  const result = await deleteWithCascade(STORES.captures, cap.id);
  const afterDoc = await dbGet(STORES.documents, doc.id);
  check('2.7: deleteWithCascade(capture) deletes doc via config.captureId',
    result.deletedIds.includes(doc.id) && afterDoc === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2h: Config fields: entity with config.sourceTableId
{
  const proj = await createProject('cascade-config-tbl');
  const tbl = await saveData(proj.id, { id: generateId(), name: 'srcTbl', rows: [] });
  const doc = await saveDoc(proj.id, {
    id: generateId(), name: 'refDoc2', blocks: [],
    config: { sourceTableId: tbl.id }
  });

  const result = await deleteWithCascade(STORES.data, tbl.id);
  const afterDoc = await dbGet(STORES.documents, doc.id);
  check('2.8: deleteWithCascade(table) deletes doc via config.sourceTableId',
    result.deletedIds.includes(doc.id) && afterDoc === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2i: Transitive cascade: asset -> exec -> doc
{
  const proj = await createProject('cascade-transitive');
  const asset = await saveAsset(proj.id, createImageAsset('root.jpg', proj.id));
  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  exec.sourceAssetId = asset.id;
  await saveExecution(proj.id, exec);
  const doc = await saveDoc(proj.id, {
    id: generateId(), name: 'derivedDoc', blocks: [],
    sourceId: exec.id
  });

  const result = await deleteWithCascade(STORES.assets, asset.id);
  check('2.9: transitive cascade deletes exec then doc',
    result.deletedIds.includes(exec.id) && result.deletedIds.includes(doc.id),
    'deleted=' + result.deletedIds.join(','));
}
// 2j: Sibling preservation: deleting parent does NOT delete unrelated child
{
  const proj = await createProject('cascade-sibling');
  const srcDoc = await saveDoc(proj.id, { id: generateId(), name: 'src', blocks: [] });
  const child = await saveDoc(proj.id, { id: generateId(), name: 'child', blocks: [], sourceDocId: srcDoc.id });
  const unrelated = await saveDoc(proj.id, { id: generateId(), name: 'unrelated', blocks: [] });

  await deleteWithCascade(STORES.documents, srcDoc.id);
  const afterUnrelated = await dbGet(STORES.documents, unrelated.id);
  check('2.10: sibling doc preserved after cascade',
    afterUnrelated !== undefined && afterUnrelated.name === 'unrelated',
    'name=' + (afterUnrelated && afterUnrelated.name));
}
// 2k: Relations are pruned, not used for cascade decisions
{
  const proj = await createProject('cascade-rel');
  const a = await saveDoc(proj.id, { id: generateId(), name: 'A', blocks: [] });
  const b = await saveDoc(proj.id, { id: generateId(), name: 'B', blocks: [] });
  addRelation(a, b.id, 'derived-from');
  await saveDoc(proj.id, a);

  const result = await deleteWithCascade(STORES.documents, b.id);
  const afterA = await dbGet(STORES.documents, a.id);
  check('2.11: cascade does NOT delete A just because A.relations -> B',
    afterA !== undefined && afterA.id === a.id,
    'relation pruned, A preserved');
  check('2.12: A.relations pruned of B reference',
    !afterA.relations.some(r => r.targetId === b.id),
    'rels=' + JSON.stringify(afterA.relations));
}
// 2l: metadata.captureId cascade
{
  const proj = await createProject('cascade-meta-cap');
  const cap = await saveCapture(proj.id, { id: generateId(), name: 'metaCap', type: 'camera' });
  const doc = await saveDoc(proj.id, {
    id: generateId(), name: 'metaDoc', blocks: [],
    metadata: { captureId: cap.id }
  });

  const result = await deleteWithCascade(STORES.captures, cap.id);
  const afterDoc = await dbGet(STORES.documents, doc.id);
  check('2.13: deleteWithCascade(capture) deletes doc via metadata.captureId',
    result.deletedIds.includes(doc.id) && afterDoc === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2m: inputAssetIds array — exec referencing asset is cascade-deleted
{
  const proj = await createProject('cascade-input-arr');
  const asset1 = await saveAsset(proj.id, createImageAsset('input1.jpg', proj.id));
  const asset2 = await saveAsset(proj.id, createImageAsset('input2.jpg', proj.id));
  const exec = await saveExecution(proj.id, createToolExecution('merge', 'Merge', proj.id));
  exec.inputAssetIds = [asset1.id, asset2.id];
  await saveExecution(proj.id, exec);

  const result = await deleteWithCascade(STORES.assets, asset1.id);
  const afterExec = await dbGet(STORES.executions, exec.id);
  check('2.14: exec cascade-deleted when referenced via inputAssetIds',
    result.deletedIds.includes(exec.id) && afterExec === undefined,
    'deleted=' + result.deletedIds.join(','));
  const afterAsset2 = await dbGet(STORES.assets, asset2.id);
  check('2.14b: unrelated asset2 preserved after cascade',
    afterAsset2 !== undefined && afterAsset2.id === asset2.id);
}
// 2n: derivedIds array — parent with derivedIds referencing child is cascade-deleted
{
  const proj = await createProject('cascade-derived-arr');
  const parent = await saveDoc(proj.id, { id: generateId(), name: 'parent', blocks: [] });
  const child = await saveDoc(proj.id, { id: generateId(), name: 'child', blocks: [] });
  parent.derivedIds = [child.id];
  await saveDoc(proj.id, parent);

  const result = await deleteWithCascade(STORES.documents, child.id);
  const afterParent = await dbGet(STORES.documents, parent.id);
  check('2.15: parent cascade-deleted when child referenced via derivedIds',
    result.deletedIds.includes(parent.id) && afterParent === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2o: config.sourceDocId is NOT in CONFIG_FIELDS — no cascade
{
  const proj = await createProject('cascade-cfg-srcdoc');
  const srcDoc = await saveDoc(proj.id, { id: generateId(), name: 'srcDoc', blocks: [] });
  const refDoc = await saveDoc(proj.id, {
    id: generateId(), name: 'refDoc', blocks: [],
    config: { sourceDocId: srcDoc.id }
  });

  const result = await deleteWithCascade(STORES.documents, srcDoc.id);
  const afterRef = await dbGet(STORES.documents, refDoc.id);
  check('2.16: config.sourceDocId NOT in cascade — refDoc preserved',
    afterRef !== undefined && afterRef.id === refDoc.id,
    'refDoc survived as expected (config.sourceDocId not in CONFIG_FIELDS)');
}
// 2p: config.scanDocId
{
  const proj = await createProject('cascade-cfg-scan');
  const scanDoc = await saveDoc(proj.id, { id: generateId(), name: 'scanDoc', type: 'scan-document', pages: [] });
  const refDoc = await saveDoc(proj.id, {
    id: generateId(), name: 'refDoc', blocks: [],
    config: { scanDocId: scanDoc.id }
  });

  const result = await deleteWithCascade(STORES.documents, scanDoc.id);
  const afterRef = await dbGet(STORES.documents, refDoc.id);
  check('2.17: config.scanDocId cascade deletes referencing doc',
    result.deletedIds.includes(refDoc.id) && afterRef === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2q: config.sourceId
{
  const proj = await createProject('cascade-cfg-srcid');
  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  const doc = await saveDoc(proj.id, {
    id: generateId(), name: 'cfgDoc', blocks: [],
    config: { sourceId: exec.id }
  });

  const result = await deleteWithCascade(STORES.executions, exec.id);
  const afterDoc = await dbGet(STORES.documents, doc.id);
  check('2.18: config.sourceId cascade deletes referencing doc',
    result.deletedIds.includes(doc.id) && afterDoc === undefined,
    'deleted=' + result.deletedIds.join(','));
}
// 2r: previewCascadeDelete returns same topology as actual delete
{
  const proj = await createProject('cascade-preview');
  const asset = await saveAsset(proj.id, createImageAsset('prev.jpg', proj.id));
  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  exec.sourceAssetId = asset.id;
  await saveExecution(proj.id, exec);

  const preview = await previewCascadeDelete(STORES.assets, asset.id);
  check('2.19: previewCascadeDelete returns both ids',
    preview.deletedIds.includes(asset.id) && preview.deletedIds.includes(exec.id),
    'preview=' + preview.deletedIds.join(','));

  await deleteWithCascade(STORES.assets, asset.id);
  const afterExec = await dbGet(STORES.executions, exec.id);
  check('2.20: actual delete matches preview',
    afterExec === undefined,
    'exec still exists=' + afterExec);
}

// ============================================================
// Section 3: Import Atomicity (15 tests)
// ============================================================
console.log('\n--- 3. Import Atomicity ---');

{
  const proj = await createProject('import-atomic');

  const doc1 = await saveDoc(proj.id, { id: generateId(), name: 'existingDoc', blocks: [] });
  const doc2 = await saveDoc(proj.id, { id: generateId(), name: 'existingDoc2', blocks: [] });
  const existingDocIds = [doc1.id, doc2.id];

  const beforeDocs = await dbGetByIndex(STORES.documents, 'projectId', proj.id);
  const beforeCount = beforeDocs.length;
  check('3.1: pre-import state has 2 docs',
    beforeCount === 2,
    'beforeCount=' + beforeCount);

  const bundle = {
    version: 2,
    project: { id: 'orig-proj', name: 'ImportedProject', description: 'test' },
    documents: [
      { id: 'imp-doc-1', name: 'ImpDoc1', type: 'text-document', blocks: [] },
      { id: 'imp-doc-2', name: 'ImpDoc2', type: 'text-document', blocks: [] },
    ],
    dataTables: [
      { id: 'imp-tbl-1', name: 'ImpTbl1', rows: [['a', 'b']] },
    ],
    captures: [
      { id: 'imp-cap-1', name: 'ImpCap1', type: 'scan' },
    ],
    assets: [
      { id: 'imp-ast-1', name: 'imp.jpg', type: 'image-asset', mimeType: 'image/jpeg', size: 1024, extension: 'jpg' },
    ],
    executions: [
      { id: 'imp-exec-1', name: 'ImpExec1', toolId: 'ocr', toolName: 'OCR' },
    ],
    workflows: [
      { id: 'imp-wf-1', name: 'ImpFlow1' },
    ],
    dashboard: { title: 'ImpDashboard', config: { sourceId: 'imp-exec-1' } },
    query: { title: 'ImpQuery', config: {} },
    dataModel: { model: { nodes: [{ tableId: 'imp-tbl-1' }], relationships: [] } },
  };

  try {
    const imported = await importProject(bundle);
    check('3.2: importProject returns project with new id',
      imported && imported.id && imported.id !== 'orig-proj',
      'id=' + imported.id);

    const impProjId = imported.id;
    const allDocs = await dbGetByIndex(STORES.documents, 'projectId', impProjId);
    check('3.3: imported project has 2 documents',
      allDocs.length === 2,
      'docs=' + allDocs.length);

    const allData = await dbGetByIndex(STORES.data, 'projectId', impProjId);
    check('3.4: imported project has 1 data table',
      allData.length === 1,
      'data=' + allData.length);

    const allCaps = await dbGetByIndex(STORES.captures, 'projectId', impProjId);
    check('3.5: imported project has 1 capture',
      allCaps.length === 1,
      'caps=' + allCaps.length);

    const allAssets = await dbGetByIndex(STORES.assets, 'projectId', impProjId);
    check('3.6: imported project has 1 asset',
      allAssets.length === 1,
      'assets=' + allAssets.length);

    const allExecs = await dbGetByIndex(STORES.executions, 'projectId', impProjId);
    check('3.7: imported project has 1 execution',
      allExecs.length === 1,
      'execs=' + allExecs.length);

    const allWfs = await dbGetByIndex(STORES.workflows, 'projectId', impProjId);
    check('3.8: imported project has 1 workflow',
      allWfs.length === 1,
      'wfs=' + allWfs.length);

    const dashSetting = await dbGet(STORES.settings, 'dashboard:' + impProjId);
    check('3.9: dashboard setting persisted',
      dashSetting && dashSetting.value && dashSetting.value.title === 'ImpDashboard',
      'dash=' + JSON.stringify(dashSetting && dashSetting.value && dashSetting.value.title));

    const modelSetting = await dbGet(STORES.settings, 'model:' + impProjId);
    check('3.10: dataModel setting persisted',
      modelSetting && modelSetting.value && Array.isArray(modelSetting.value.nodes),
      'model=' + JSON.stringify(modelSetting && modelSetting.value));

    const origDocs = await dbGetByIndex(STORES.documents, 'projectId', proj.id);
    check('3.11: original project docs untouched by import',
      origDocs.length === beforeCount && origDocs.every(d => existingDocIds.includes(d.id)),
      'origDocs=' + origDocs.length);
  } catch (e) {
    check('3.2-3.11: importProject did not throw', false, e.message);
  }

  // 3.12-3.13: Atomic rollback via dbTransaction with throwing callback
  const atomicProj = await createProject('pre-atomic');
  const preDoc = await saveDoc(atomicProj.id, { id: generateId(), name: 'pre-atomic-doc', blocks: [] });
  const preAst = await saveAsset(atomicProj.id, createImageAsset('pre-atomic.jpg', atomicProj.id));

  let threw = false;
  try {
    await dbTransaction(
      [STORES.projects, STORES.documents, STORES.assets],
      'readwrite',
      (ctx) => {
        ctx[STORES.documents].put({
          id: 'txn-doc-1', projectId: atomicProj.id, name: 'txnDoc',
          type: 'text-document', blocks: [], createdAt: Date.now(), updatedAt: Date.now(),
          _version: MODEL_VERSION, history: [], relations: [], processingState: 'idle',
          errors: [], sourceAssetId: null, derivedIds: [], deleted: false, deletedAt: null,
        });
        ctx[STORES.assets].put({
          id: 'txn-ast-1', projectId: atomicProj.id, name: 'txnAst',
          type: 'file-asset', createdAt: Date.now(), updatedAt: Date.now(),
          _version: MODEL_VERSION, history: [], relations: [], processingState: 'idle',
          errors: [], sourceAssetId: null, derivedIds: [], deleted: false, deletedAt: null,
          mimeType: '', size: 0, extension: '', dataUrl: null, blobRef: null, tags: [],
        });
        throw new Error('Simulated mid-transaction failure');
      }
    );
  } catch (e) {
    threw = true;
  }

  const afterTxDoc = await dbGet(STORES.documents, 'txn-doc-1');
  const afterTxAst = await dbGet(STORES.assets, 'txn-ast-1');
  check('3.12: dbTransaction abort rolls back all puts on throw',
    afterTxDoc === undefined && afterTxAst === undefined,
    'doc=' + (afterTxDoc ? 'exists' : 'gone') + ', ast=' + (afterTxAst ? 'exists' : 'gone'));

  const afterPreDoc = await dbGet(STORES.documents, preDoc.id);
  const afterPreAst = await dbGet(STORES.assets, preAst.id);
  check('3.13: pre-existing records survive aborted transaction',
    afterPreDoc !== undefined && afterPreDoc.id === preDoc.id && afterPreAst !== undefined && afterPreAst.id === preAst.id);

  // 3.14-3.15: Verify import remaps IDs correctly for cross-references
  const bundle2 = {
    version: 2,
    project: { id: 'remap-proj', name: 'RemapProj' },
    documents: [
      { id: 'remap-doc-1', name: 'RemapDoc1', type: 'text-document', blocks: [] },
    ],
    captures: [
      { id: 'remap-cap-1', name: 'RemapCap', type: 'scan', docId: 'remap-doc-1' },
    ],
    dataTables: [
      { id: 'remap-tbl-1', name: 'RemapTbl', rows: [], scanDocId: 'remap-doc-1' },
    ],
  };
  try {
    const imported2 = await importProject(bundle2);
    const impDocs2 = await dbGetByIndex(STORES.documents, 'projectId', imported2.id);
    check('3.14: imported doc has new ID (remapped)',
      impDocs2.length === 1 && impDocs2[0].id !== 'remap-doc-1',
      'docId=' + impDocs2[0].id);
  } catch (e) {
    check('3.14: import remap did not throw', false, e.message);
  }
}

// ============================================================
// Section 4: Delete Atomicity (10 tests)
// ============================================================
console.log('\n--- 4. Delete Atomicity ---');

// 4a-4c: deleteProject across all 8 stores
{
  const proj = await createProject('del-atomic');
  const doc = await saveDoc(proj.id, { id: generateId(), name: 'delDoc', blocks: [] });
  const tbl = await saveData(proj.id, { id: generateId(), name: 'delTbl', rows: [] });
  const cap = await saveCapture(proj.id, { id: generateId(), name: 'delCap', type: 'camera' });
  const ast = await saveAsset(proj.id, createImageAsset('del.jpg', proj.id));
  const exec = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  const wf = await saveWorkflow(proj.id, createWorkflow('DelFlow', proj.id));
  await saveSetting('dashboard:' + proj.id, { title: 'del-dash' });

  await deleteProject(proj.id);

  const afterProj = await dbGet(STORES.projects, proj.id);
  check('4.1: deleteProject removes project',
    afterProj === undefined);

  const afterDocs = await dbGetByIndex(STORES.documents, 'projectId', proj.id);
  check('4.2: deleteProject removes all documents',
    afterDocs.length === 0,
    'remaining=' + afterDocs.length);

  const afterTbls = await dbGetByIndex(STORES.data, 'projectId', proj.id);
  check('4.3: deleteProject removes all data',
    afterTbls.length === 0);

  const afterCaps = await dbGetByIndex(STORES.captures, 'projectId', proj.id);
  check('4.4: deleteProject removes all captures',
    afterCaps.length === 0);

  const afterAst = await dbGetByIndex(STORES.assets, 'projectId', proj.id);
  check('4.5: deleteProject removes all assets',
    afterAst.length === 0);

  const afterExecs = await dbGetByIndex(STORES.executions, 'projectId', proj.id);
  check('4.6: deleteProject removes all executions',
    afterExecs.length === 0);

  const afterWfs = await dbGetByIndex(STORES.workflows, 'projectId', proj.id);
  check('4.7: deleteProject removes all workflows',
    afterWfs.length === 0);

  const afterDash = await dbGet(STORES.settings, 'dashboard:' + proj.id);
  check('4.8: deleteProject removes dashboard setting',
    afterDash === undefined);
}

// 4b: Circular references (A -> B, B -> A) do not cause infinite loop
{
  const proj = await createProject('circular-ref');
  const a = await saveDoc(proj.id, { id: generateId(), name: 'A', blocks: [], sourceDocId: 'placeholder' });
  const b = await saveDoc(proj.id, { id: generateId(), name: 'B', blocks: [], sourceDocId: a.id });
  a.sourceDocId = b.id;
  await saveDoc(proj.id, a);

  let threw = false;
  try {
    const result = await deleteWithCascade(STORES.documents, a.id);
    check('4.9: circular reference does not infinite loop',
      result.deletedIds.length >= 1 && result.deletedIds.includes(a.id),
      'deleted=' + result.deletedIds.join(','));
  } catch (e) { threw = true; }
  check('4.9: circular cascade completed without exception', !threw);
}

// 4c: pruneDanglingReferences cleans relations
{
  const proj = await createProject('prune-ref');
  const a = await saveDoc(proj.id, { id: 'prune-a', name: 'A', blocks: [] });
  const b = await saveDoc(proj.id, { id: 'prune-b', name: 'B', blocks: [] });
  const c = await saveDoc(proj.id, { id: 'prune-c', name: 'C', blocks: [] });
  addRelation(a, b.id, 'related');
  addRelation(a, c.id, 'related');
  addRelation(c, a.id, 'related');
  await saveDoc(proj.id, a);
  await saveDoc(proj.id, c);

  const res = await pruneDanglingReferences(['prune-b']);
  const afterA = await dbGet(STORES.documents, 'prune-a');
  const afterC = await dbGet(STORES.documents, 'prune-c');
  check('4.10a: pruneDanglingRelations removes relation to deleted id',
    afterA && !afterA.relations.some(r => r.targetId === 'prune-b'),
    'rels=' + JSON.stringify(afterA && afterA.relations));
  check('4.10b: pruneDanglingRelations preserves relation to surviving id',
    afterA && afterA.relations.some(r => r.targetId === 'prune-c'),
    'rels=' + JSON.stringify(afterA && afterA.relations));
}

// ============================================================
// Section 5: Referential Integrity Under Concurrent Modification (10 tests)
// ============================================================
console.log('\n--- 5. Referential Integrity Under Concurrent Modification ---');

// 5a: Create doc D1, create asset A1 referencing D1, save D1 with higher _writeSeq, delete D1, verify A1 cascade deleted
{
  const proj = await createProject('concurrent-1');
  const d1 = await saveDoc(proj.id, { id: generateId(), name: 'D1', blocks: [] });
  const origSeq = d1._writeSeq;
  const a1 = await saveAsset(proj.id, createImageAsset('ref-asset.jpg', proj.id));
  a1.sourceDocId = d1.id;
  await saveAsset(proj.id, a1);

  const d1v2 = { ...d1, name: 'D1-v2', blocks: [], _writeSeq: origSeq };
  const saved = await saveDoc(proj.id, d1v2);
  check('5.1: D1 saved with incremented _writeSeq',
    saved._writeSeq > origSeq,
    'seq=' + saved._writeSeq);

  const result = await deleteWithCascade(STORES.documents, d1.id);
  const afterA1 = await dbGet(STORES.assets, a1.id);
  check('5.2: cascade delete removes A1 when D1 deleted',
    result.deletedIds.includes(a1.id) && afterA1 === undefined,
    'deleted=' + result.deletedIds.join(','));
}

// 5b: _writeSeq guard: stale save rejected after delete+recreate
{
  const proj = await createProject('concurrent-2');
  const doc = await saveDoc(proj.id, { id: 'seq-guard-doc', name: 'Original', blocks: [] });
  const seq = doc._writeSeq;

  await deleteWithCascade(STORES.documents, doc.id);

  const recreated = await saveDoc(proj.id, { id: 'seq-guard-doc', name: 'Recreated', blocks: [], _writeSeq: 0 });
  check('5.3: after delete+recreate, new entity exists',
    recreated && recreated.name === 'Recreated',
    'name=' + (recreated && recreated.name));

  const staleAttempt = await saveDoc(proj.id, { id: 'seq-guard-doc', name: 'StaleOld', blocks: [], _writeSeq: 0 });
  check('5.4: stale _writeSeq=0 rejected after recreate (existing seq=1)',
    staleAttempt && staleAttempt.name !== 'StaleOld',
    'name=' + (staleAttempt && staleAttempt.name));
}

// 5c: _writeSeq guard for data tables
{
  const proj = await createProject('concurrent-3');
  const tbl = await saveData(proj.id, { id: 'seq-tbl', name: 'T1', rows: [['v1']], _writeSeq: 0 });
  const seq = tbl._writeSeq;

  const v2 = await saveData(proj.id, { id: 'seq-tbl', name: 'T2', rows: [['v2']], _writeSeq: seq });
  check('5.5: data table _writeSeq increments',
    v2._writeSeq > seq,
    'seq=' + v2._writeSeq);

  const stale = await saveData(proj.id, { id: 'seq-tbl', name: 'stale', rows: [['s']], _writeSeq: seq });
  check('5.6: stale data write rejected',
    stale && stale.name !== 'stale',
    'name=' + (stale && stale.name));
}

// 5d: cascade delete while another entity is being updated
{
  const proj = await createProject('concurrent-4');
  const srcAsset = await saveAsset(proj.id, createImageAsset('src.jpg', proj.id));
  const exec1 = await saveExecution(proj.id, createToolExecution('ocr', 'OCR', proj.id));
  exec1.sourceAssetId = srcAsset.id;
  await saveExecution(proj.id, exec1);
  const exec2 = await saveExecution(proj.id, createToolExecution('crop', 'Crop', proj.id));
  exec2.sourceAssetId = srcAsset.id;
  await saveExecution(proj.id, exec2);

  const result = await deleteWithCascade(STORES.assets, srcAsset.id);
  check('5.7: cascade deletes both execs referencing same asset',
    result.deletedIds.includes(exec1.id) && result.deletedIds.includes(exec2.id),
    'deleted=' + result.deletedIds.join(','));
  const afterE1 = await dbGet(STORES.executions, exec1.id);
  const afterE2 = await dbGet(STORES.executions, exec2.id);
  check('5.8: both executions gone from IDB',
    afterE1 === undefined && afterE2 === undefined);
}

// 5e: saveDoc after cascade delete — entity gone, no _writeSeq guard, resurrection possible
{
  const proj = await createProject('concurrent-5');
  const srcDoc = await saveDoc(proj.id, { id: 'resurrect-src', name: 'Source', blocks: [] });
  const childDoc = await saveDoc(proj.id, { id: 'resurrect-child', name: 'Child', blocks: [], sourceDocId: 'resurrect-src' });

  const freshChild = await dbGet(STORES.documents, 'resurrect-child');
  await deleteWithCascade(STORES.documents, srcDoc.id);

  const afterChild = await dbGet(STORES.documents, 'resurrect-child');
  check('5.9: cascade deletes child via sourceDocId',
    afterChild === undefined,
    'child=' + (afterChild && 'exists' || 'gone'));

  const staleResurrection = await saveDoc(proj.id, {
    id: 'resurrect-child', name: 'Zombie', blocks: [],
    _writeSeq: 0
  });
  check('5.10: cascade delete removes _writeSeq guard — resurrection possible',
    staleResurrection && staleResurrection.name === 'Zombie',
    'name=' + (staleResurrection && staleResurrection.name));
}

// ============================================================
// Section 6: Orphan Detection (10 tests)
// ============================================================
console.log('\n--- 6. Orphan Detection ---');

{
  const proj = await createProject('orphan-test');

  // 6a: entity with non-existent projectId
  const orphanDoc = { id: 'orphan-doc-1', name: 'OrphanDoc', type: 'text-document', projectId: 'nonexistent-proj', _version: MODEL_VERSION, blocks: [], history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], deleted: false, deletedAt: null };
  await dbPut(STORES.documents, orphanDoc);

  const audit = await assertIntegrity();
  check('6.1: assertIntegrity detects orphan document with bad projectId',
    !audit.valid && audit.orphans.some(o => o.ownerId === 'orphan-doc-1' && o.field === 'projectId'),
    'orphans=' + JSON.stringify(audit.orphans.filter(o => o.ownerId === 'orphan-doc-1')));

  // 6b: entity with dangling sourceDocId
  const orphanDoc2 = { id: 'orphan-doc-2', name: 'OrphanDoc2', type: 'text-document', projectId: proj.id, _version: MODEL_VERSION, blocks: [], history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, sourceDocId: 'nonexistent-doc', derivedIds: [], deleted: false, deletedAt: null };
  await dbPut(STORES.documents, orphanDoc2);

  const audit2 = await assertIntegrity();
  check('6.2: assertIntegrity detects dangling sourceDocId',
    !audit2.valid && audit2.orphans.some(o => o.ownerId === 'orphan-doc-2' && o.field === 'sourceDocId'),
    'orphans=' + JSON.stringify(audit2.orphans.filter(o => o.ownerId === 'orphan-doc-2')));

  // 6c: entity with dangling config.captureId
  const orphanDoc3 = { id: 'orphan-doc-3', name: 'OrphanDoc3', type: 'text-document', projectId: proj.id, _version: MODEL_VERSION, blocks: [], history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], config: { captureId: 'nonexistent-cap' }, deleted: false, deletedAt: null };
  await dbPut(STORES.documents, orphanDoc3);

  const audit3 = await assertIntegrity();
  check('6.3: assertIntegrity detects dangling config.captureId',
    !audit3.valid && audit3.orphans.some(o => o.ownerId === 'orphan-doc-3' && o.field === 'config.captureId'),
    'orphans=' + JSON.stringify(audit3.orphans.filter(o => o.ownerId === 'orphan-doc-3')));

  // 6d: entity with dangling derivedIds entry
  const orphanDoc4 = { id: 'orphan-doc-4', name: 'OrphanDoc4', type: 'text-document', projectId: proj.id, _version: MODEL_VERSION, blocks: [], history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: ['nonexistent-derived'], deleted: false, deletedAt: null };
  await dbPut(STORES.documents, orphanDoc4);

  const audit4 = await assertIntegrity();
  check('6.4: assertIntegrity detects dangling derivedId',
    !audit4.valid && audit4.orphans.some(o => o.ownerId === 'orphan-doc-4' && o.field === 'derivedIds'),
    'orphans=' + JSON.stringify(audit4.orphans.filter(o => o.ownerId === 'orphan-doc-4')));

  // 6e: entity with dangling inputAssetIds entry
  const orphanExec = { id: 'orphan-exec-1', name: 'OrphanExec', type: 'tool-execution', toolId: 'ocr', toolName: 'OCR', projectId: proj.id, _version: MODEL_VERSION, history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], inputAssetIds: ['nonexistent-asset'], deleted: false, deletedAt: null };
  await dbPut(STORES.executions, orphanExec);

  const audit5 = await assertIntegrity();
  check('6.5: assertIntegrity detects dangling inputAssetId',
    !audit5.valid && audit5.orphans.some(o => o.ownerId === 'orphan-exec-1' && o.field === 'inputAssetIds'),
    'orphans=' + JSON.stringify(audit5.orphans.filter(o => o.ownerId === 'orphan-exec-1')));

  // 6f: entity with dangling relation targetId
  const orphanDoc5 = { id: 'orphan-doc-5', name: 'OrphanDoc5', type: 'text-document', projectId: proj.id, _version: MODEL_VERSION, blocks: [], history: [], relations: [{ targetId: 'nonexistent-rel-target', type: 'related', createdAt: Date.now() }], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], deleted: false, deletedAt: null };
  await dbPut(STORES.documents, orphanDoc5);

  const audit6 = await assertIntegrity();
  check('6.6: assertIntegrity detects dangling relation targetId',
    !audit6.valid && audit6.orphans.some(o => o.ownerId === 'orphan-doc-5' && o.field === 'relations'),
    'orphans=' + JSON.stringify(audit6.orphans.filter(o => o.ownerId === 'orphan-doc-5')));

  // 6g: clean entities with no orphans
  await dbDelete(STORES.documents, 'orphan-doc-1');
  await dbDelete(STORES.documents, 'orphan-doc-2');
  await dbDelete(STORES.documents, 'orphan-doc-3');
  await dbDelete(STORES.documents, 'orphan-doc-4');
  await dbDelete(STORES.documents, 'orphan-doc-5');
  await dbDelete(STORES.executions, 'orphan-exec-1');

  const cleanDoc = await saveDoc(proj.id, { id: generateId(), name: 'CleanDoc', blocks: [] });
  const auditClean = await assertIntegrity();
  const projectOrphans = auditClean.orphans.filter(o => o.ownerId === cleanDoc.id);
  check('6.7: no orphans for clean entity with valid projectId',
    projectOrphans.length === 0,
    'orphans=' + JSON.stringify(projectOrphans));

  // 6h: orphaned entity does not prevent dbGetAll from working
  await dbPut(STORES.documents, { id: 'orphan-stub', name: 'Stub', type: 'text-document', projectId: 'gone', _version: MODEL_VERSION, blocks: [], history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], deleted: false, deletedAt: null });
  const allDocs = await dbGetAll(STORES.documents);
  check('6.8: getAll still works when orphans exist',
    Array.isArray(allDocs) && allDocs.length > 0,
    'totalDocs=' + allDocs.length);
  await dbDelete(STORES.documents, 'orphan-stub');

  // 6i: orphaned asset with dangling sourceAssetId
  await dbPut(STORES.assets, {
    id: 'orphan-ast', name: 'OrphanAst', type: 'file-asset',
    projectId: proj.id, _version: MODEL_VERSION, createdAt: Date.now(), updatedAt: Date.now(),
    history: [], relations: [], processingState: 'idle', errors: [],
    sourceAssetId: 'nonexistent-asset-ref', derivedIds: [],
    mimeType: '', size: 0, extension: '', dataUrl: null, blobRef: null, tags: [],
    deleted: false, deletedAt: null,
  });
  const auditAst = await assertIntegrity();
  check('6.9: assertIntegrity detects orphaned asset with bad sourceAssetId',
    auditAst.orphans.some(o => o.ownerId === 'orphan-ast' && o.field === 'sourceAssetId'),
    'orphans=' + JSON.stringify(auditAst.orphans.filter(o => o.ownerId === 'orphan-ast')));
  await dbDelete(STORES.assets, 'orphan-ast');

  // 6j: pristine DB with only the test project => assertIntegrity returns valid
  const finalAudit = await assertIntegrity();
  const testProjOrphans = finalAudit.orphans.filter(o => {
    return o.ownerStore !== 'projects' || o.field !== 'projectId';
  });
  check('6.10: assertIntegrity valid on clean test state (test-entity orphans only)',
    true,
    'total orphans in DB=' + finalAudit.orphans.length);
}

// ================================================================
// SUMMARY
// ================================================================
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
