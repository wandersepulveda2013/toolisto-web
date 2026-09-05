#!/usr/bin/env node
/**
 * import-sourceid-remap-test.mjs (CE-115)
 *
 * Bug de fondo: `importProject` (core/storage.js:383-388) remapeaba los ids de
 * fuente de dashboards y querys SOLO en la forma `dashboard.config.sourceId` /
 * `query.config.sourceId`. Pero el shape REAL que se persiste y exporta es de
 * `sourceId` a nivel TOP:
 *   - dashboard: `dashboardNormalizeConfig` lee `saved.sourceId` (workspace.js:7182)
 *     y lo emite top-level en 7199 (tambien `dashboardDefaultConfig` en 7167).
 *   - query: el modelo serializado lleva `sourceId` top-level (`querySerializeModel`
 *     workspace.js:5732, `queryCreateModel` 5706); al leerlo, `queryModelFromSaved`
 *     hace `tables.find(table => table.id === saved.sourceId)` (5742).
 * Como import re-crea cada tabla con un id NUEVO (`tableIdMap`), el `sourceId`
 * original (p. ej. `table-b`) ya no existe tras el import. Sin remap:
 *   - dashboard: `tables.find(id === viejo)` cae al fallback `tables[0]` ->
 *     el panel muestra datos de la tabla EQUIVOCADA;
 *   - query: `queryModelFromSaved` pierde `currentSource` y se desconecta de su
 *     tabla viva, sirviendo los `baseHeaders/baseRows` embebidos (datos congelados).
 * Ambos dados incorrectos SILENCIOSOS tras un round-trip export->import.
 *
 * Fijacion (CE-115): en `importProject` se remapea TAMBIEN el `sourceId` top-level
 * de dashboard y query (y `query.sheets[].sourceId` si el modelo usara hojas),
 * conservando el `config.sourceId` defensivo para bundles legacy.
 *
 * Este test carga el CODIGO REAL de core/{storage,bundle,...}.js en un sandbox
 * (fake-indexeddb) y verifica que tras `importProject` el dashboard y la query
 * apuntan al id NUEVO de la tabla fuente correcta (NO a `tables[0]`, NO al id
 * original inexistente).
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
  else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); }
}

console.log('=== CE-115: importProject remapea el sourceId top-level de dashboard y query ===\n');
console.log('(CODIGO REAL de bundle.js + storage.js en sandbox; round-trip import + reload)\n');

// ============================================================
// VM bootstrap: load real core modules in dependency order
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
  generateId, appStore, createStore, emit, on, once,
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
  deleteWithCascade, previewCascadeDelete, pruneDanglingReferences, assertIntegrity,
});
`;

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
  localStorage: (() => {
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

const {
  dbGetByIndex,
  STORES, generateId, DB_NAME,
  closeDB, deleteDatabase,
  importProject,
  loadSetting,
} = sandbox;

async function resetDb() {
  closeDB();
  await deleteDatabase(DB_NAME);
  await new Promise(r => setTimeout(r, 0));
}

// ============================================================
// Bundle con dashboard y query apuntando a la tabla "table-b"
// (sourceId a nivel TOP, forma REAL), con 2 tablas para que el
// fallback equivocado (tables[0]) sea distinguible.
// ============================================================
function makeBundle() {
  return {
    version: 2,
    project: { id: 'orig-proj', name: 'ProjSourceId', description: 'test' },
    documents: [],
    dataTables: [
      { id: 'table-a', name: 'Ventas A', headers: ['m', 'v'], rows: [['ene', 100]] },
      { id: 'table-b', name: 'Ventas B', headers: ['m', 'v'], rows: [['ene', 200], ['feb', 400]] },
    ],
    captures: [],
    assets: [],
    executions: [],
    workflows: [],
    dashboard: {
      title: 'Panel B',
      sourceId: 'table-b',                    // TOP-level (forma real)
      filterColumn: '', filterValue: '',
      widgets: [],
    },
    query: {
      projectId: 'orig-proj',
      sheetId: 'q1', sheetName: 'Hoja 1',
      sourceId: 'table-b',                    // TOP-level (forma real)
      sourceName: 'Ventas B',
      baseHeaders: ['m', 'v'],
      baseRows: [['ene', 200], ['feb', 400]],
      steps: [],
    },
    dataModel: null,
  };
}

async function importedTables(projectId) {
  return await dbGetByIndex(STORES.data, 'projectId', projectId);
}

async function importedProjectTables(projectId) {
  return { projectId, tables: await importedTables(projectId) };
}

console.log('1. FIX: dashboard.sourceId top-level se remapea al id NUEVO de la tabla fuente');
{
  await resetDb();
  const bundle = makeBundle();
  const imported = await importProject(bundle);
  check('importProject completado (proyecto creado)', imported && imported.id, imported && imported.id);

  const { projectId, tables } = await importedProjectTables(imported.id);
  check('se importaron 2 tablas (para distinguir tables[0] del target real)', tables.length === 2,
    tables.length + ' tablas');

  // La tabla B importada es la que viene de table-b (name 'Ventas B')
  const tableBNew = tables.find(t => t.name === 'Ventas B');
  const tableANew = tables.find(t => t.name === 'Ventas A');
  check('la tabla "Ventas B" recibio un id NUEVO (distinto del original table-b)', tableBNew && tableBNew.id !== 'table-b',
    tableBNew && tableBNew.id);

  const dash = await loadSetting('dashboard:' + projectId);
  check('el dashboard persistido sigue existiendo', dash && typeof dash === 'object', JSON.stringify(dash));
  check('dashboard.sourceId (top-level) fue remapeado al id nuevo de Ventas B', dash && dash.sourceId === tableBNew.id,
    'dash.sourceId=' + (dash && dash.sourceId) + ' expected=' + (tableBNew && tableBNew.id));
  check('dashboard.sourceId ya NO es el id original inexistente table-b', dash && dash.sourceId !== 'table-b',
    'dash.sourceId=' + (dash && dash.sourceId));
  check('dashboard.sourceId NO cae en tables[0] (Ventas A) — apunta a la fuente correcta', dash && dash.sourceId !== tableANew.id,
    'dash.sourceId=' + (dash && dash.sourceId) + ' tableA=' + (tableANew && tableANew.id));
}

// ============================================================
console.log('\n2. FIX: query.sourceId top-level se remapea al id NUEVO de la tabla fuente');
{
  await resetDb();
  const bundle = makeBundle();
  const imported = await importProject(bundle);
  const { projectId, tables } = await importedProjectTables(imported.id);
  const tableBNew = tables.find(t => t.name === 'Ventas B');

  const q = await loadSetting('query:' + projectId);
  check('la query persistida sigue existiendo', q && typeof q === 'object', JSON.stringify(q));
  check('query.sourceId (top-level) fue remapeado al id nuevo de Ventas B', q && q.sourceId === tableBNew.id,
    'q.sourceId=' + (q && q.sourceId) + ' expected=' + (tableBNew && tableBNew.id));
}

// ============================================================
console.log('\n3. CONTROL NEGATIVO: un sourceId SIN remapear deja dashboard/query en la tabla equivocada');
{
  await resetDb();
  // El sourceId original 'table-b' NO existe en las tablas importadas (todas recibieron id nuevo).
  // Replicamos la resolucion EXACTA de los consumidores (dashboardNormalizeConfig y
  // queryModelFromSaved) con el id que el codigo VIEJO habria persistido (el original sin remapear)
  // contra el conjunto de tablas importadas -> el dashboard cae a tables[0] y la query se desconecta.
  const bundle = makeBundle();
  const imported = await importProject(bundle);
  const { tables } = await importedProjectTables(imported.id);
  const tableBNew = tables.find(t => t.name === 'Ventas B');

  check('(premisa) el id original table-b presente en el bundle', makeBundle().dashboard.sourceId === 'table-b');

  // Resolucion del dashboard (workspace.js:7182: tables.find(id===saved.sourceId) || tables[0])
  const sourceMatch = tables.find(t => t.id === 'table-b');
  const resolved = sourceMatch || tables[0];
  check('(reproduccion) el FIND del sourceId original falla en las tablas importadas',
    sourceMatch === undefined);
  check('(reproduccion) al fallar el find, la resolucion cae en el POSICIONAL tables[0] (ignora el sourceId)',
    resolved === tables[0], 'resolved=' + (resolved && resolved.id));
  check('(reproduccion) la fuente se pierde por posicion: el fallback devuelve una tabla por orden, no por id',
    tables.some(t => t.id === resolved.id));

  // Resolucion de la query (workspace.js:5742: tables.find(id===saved.sourceId)) sin `|| tables[0]`
  const unresolvedQ = tables.find(t => t.id === 'table-b');
  check('(reproduccion) la query pierde su currentSource (find -> undefined) y serviria baseHeaders congelados',
    unresolvedQ === undefined);

  check('(premisa) Ventas B es la fuente correcta importada',
    tableBNew.id !== undefined && tableBNew.id !== 'table-b');
}

// ============================================================
console.log('\n4. Compatibilidad: config.sourceId (legacy) sigue remapeandose');
{
  await resetDb();
  // Bundle con el shape LEGACY config.sourceId: no se rompe el remap defensivo existente.
  const bundle = makeBundle();
  bundle.dashboard = { config: { sourceId: 'table-b' } };
  const imported = await importProject(bundle);
  const { projectId, tables } = await importedProjectTables(imported.id);
  const tableBNew = tables.find(t => t.name === 'Ventas B');
  const dash = await loadSetting('dashboard:' + projectId);
  check('el remap legacy config.sourceId sigue funcionando', dash && dash.config && dash.config.sourceId === tableBNew.id,
    'config.sourceId=' + (dash && dash.config && dash.config.sourceId) + ' expected=' + (tableBNew && tableBNew.id));
}

// ============================================================
console.log('\n5. Anclas estaticas: importProject remapea el sourceId top-level');
{
  check('importProject remapea dashboard.sourceId top-level',
    /if \(dashboard && typeof dashboard === 'object' && dashboard\.sourceId\)\s*dashboard\.sourceId = remapId\(dashboard\.sourceId\)/.test(codeStorage),
    'ancla dashboard');
  check('importProject remapea query.sourceId top-level',
    /if \(query\.sourceId\)\s*query\.sourceId = remapId\(query\.sourceId\)/.test(codeStorage),
    'ancla query');
  check('(paridad) el remap legacy config.sourceId se conserva',
    /dashboard\.config\.sourceId/.test(codeStorage) && /query\.config\.sourceId/.test(codeStorage),
    'ancla legacy');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);