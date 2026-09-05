#!/usr/bin/env node
/**
 * col-filters-roundtrip-test.mjs (CE-130)
 *
 * Bug de fondo: los filtros de columna de la vista de tabla viven en
 * `table._colFilters[ci]` como objetos `Set` (workspace.js). `Set` NO
 * sobrevive a `JSON.stringify` (se serializa como `{}` y pierde los valores):
 *
 *   - `exportProject` (core/storage.js) ensamblaba el bundle con la tabla VIVA
 *     y `exportProjectData` hacía `JSON.stringify(bundle)` -> los `Set` de
 *     `_colFilters` se emitían como `{}`.
 *   - `buildManifest`/`validateManifest` hashean `canonicalJson(obj)`; ambos
 *     lados hashean el MISMO `{}`, así que el manifiesto seguía siendo válido
 *     y la corrupción pasaba la validación de integridad en silencio.
 *   - Tras importar, la vista de tabla lanzaba `TypeError: colFilter.has is
 *     not a function` (render data, workspace.js) al aplicar el filtro.
 *
 * Fijacion (CE-130):
 *   1. NUEVOS helpers en core/table-helpers.js:
 *      - `colFiltersToSerializable(table)` -> copia JSON-safe (arrays
 *        ordenados) de `_colFilters` para el bundle de export (no muta).
 *      - `normalizeColFilters(table)` -> repara `_colFilters` en el import:
 *        arrays -> Set; `Set` se conserva; una forma inválida (el `{}` de un
 *        export viejo) se descarta de esa columna.
 *      - `colFilterHas(colFilter, value)` -> membresía seguro para el render
 *        (una forma corrupta cuenta como "sin filtro", la fila pasa).
 *   2. `exportProject` proyecta los filtros a arrays en el bundle.
 *   3. `importProject` normaliza a `Set` antes de persistir.
 *   4. workspace.js usa `colFilterHas` en los 2 sitios del render.
 *
 * Este test carga el CODIGO REAL de core/{table-helpers,db,state,events,
 * models,bundle,migrations,integrity,workspace-storage,storage}.js en un
 * sandbox (fake-indexeddb) y verifica el round-trip completo con manifiesto,
 * la reparación de bundles legacy corruptos y las anclas estáticas.
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

console.log('=== CE-130: colFilters Set no se corrompe en el round-trip .toolisto (export/import) ===\n');

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
const codeTableHelpers = readFileSync(join(ROOT, 'workspace', 'core', 'table-helpers.js'), 'utf8');
const codeStorage = readFileSync(join(ROOT, 'workspace', 'core', 'storage.js'), 'utf8');
const codeWorkspace = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

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
  codeBundle, codeMigrations, codeIntegrity, codeWstorage, codeTableHelpers, codeStorage,
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
  colFilterHas, colFiltersToSerializable, normalizeColFilters,
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
  dbPut, dbGet, dbGetByIndex,
  STORES, DB_NAME,
  closeDB, deleteDatabase,
  exportProject, importProject,
  colFilterHas, colFiltersToSerializable, normalizeColFilters,
} = sandbox;

async function resetDb() {
  closeDB();
  await deleteDatabase(DB_NAME);
  await new Promise(r => setTimeout(r, 0));
}

console.log('1. Helpers CE-130 (funciones REALES de core/table-helpers.js)');
{
  check('colFilterHas(null) -> true (sin filtro, la fila pasa)', colFilterHas(null, 'x') === true);
  check('colFilterHas(undefined) -> true', colFilterHas(undefined, 'x') === true);
  check('colFilterHas(Set) miembro -> true', colFilterHas(new Set(['a', 'b']), 'a') === true);
  check('colFilterHas(Set) no-miembro -> false', colFilterHas(new Set(['a', 'b']), 'z') === false);
  check('colFilterHas(array) miembro -> true', colFilterHas(['a', 'b'], 'b') === true);
  check('colFilterHas(array) no-miembro -> false', colFilterHas(['a', 'b'], 'z') === false);
  check('colFilterHas({} corrupto) -> true (sin filtro, no crashea)', colFilterHas({}, 'x') === true);
  check('colFilterHas(42 basura) -> true (sin filtro)', colFilterHas(42, 'x') === true);

  const out = colFiltersToSerializable({ _colFilters: { 1: new Set(['mar', 'abr', 'ene']) } });
  check('colFiltersToSerializable: Set -> array ordenado JSON-safe', Array.isArray(out[1]) && out[1].join(',') === 'abr,ene,mar', JSON.stringify(out));
  const src = { _colFilters: { 1: new Set(['mar']) } };
  colFiltersToSerializable(src);
  check('colFiltersToSerializable: NO muta la tabla de origen', src._colFilters[1] instanceof Set);
  check('colFiltersToSerializable: sin _colFilters -> undefined', colFiltersToSerializable({ rows: [] }) === undefined);
  check('colFiltersToSerializable: null -> undefined', colFiltersToSerializable(null) === undefined);
  const mixed = colFiltersToSerializable({ _colFilters: { 0: {}, 1: ['b', 'a'] } });
  check('colFiltersToSerializable: descarta entradas corruptas y conserva la valida',
    mixed && !('0' in mixed) && JSON.stringify(mixed) === JSON.stringify({ 1: ['a', 'b'] }), JSON.stringify(mixed));

  const t1 = { _colFilters: { 0: ['b', 'a'] } };
  normalizeColFilters(t1);
  check('normalizeColFilters: array -> Set', t1._colFilters[0] instanceof Set && t1._colFilters[0].has('a') && t1._colFilters[0].has('b'));
  const t2 = { _colFilters: { 0: new Set(['x']) } };
  normalizeColFilters(t2);
  check('normalizeColFilters: conserva Set', t2._colFilters[0] instanceof Set);
  const t3 = { _colFilters: { 0: {} } };
  normalizeColFilters(t3);
  check('normalizeColFilters: descarta el {} corrupto de la columna', Object.keys(t3._colFilters).length === 0 && typeof t3._colFilters[0] === 'undefined');
  const t4 = { rows: [[1]] };
  check('normalizeColFilters: sin _colFilters -> no-op (misma referencia)', normalizeColFilters(t4) === t4 && !('_colFilters' in t4));
}

console.log('\n2. EXPORT real: el bundle serializa _colFilters como arrays (JSON-safe) sin mutar IDB');
{
  await resetDb();
  const tableId = 'tbl-f1';
  await dbPut(STORES.projects, { id: 'p-f', name: 'ProyFiltros', description: '' });
  await dbPut(STORES.data, {
    id: tableId, type: 'table-document', projectId: 'p-f', name: 'Tabla filtros',
    headers: ['mes', 'v'], rows: [['ene', 1], ['mar', 3], ['abr', 4]],
    _colFilters: { 0: new Set(['mar', 'abr']) },
  });
  const bundle = await exportProject('p-f');
  const t = bundle.dataTables[0];
  check('export: bundle trae la tabla', t && t.id === tableId, t && t.id);
  check('export: _colFilters[0] es un ARRAY (no un Set que corromperia el JSON)',
    t && t._colFilters && Array.isArray(t._colFilters[0]) && !(t._colFilters[0] instanceof Set));
  check('export: el array tiene los valores preservados y ordenados',
    t && JSON.stringify(t._colFilters[0]) === JSON.stringify(['abr', 'mar']), t && JSON.stringify(t && t._colFilters[0]));

  const src = await dbGet(STORES.data, tableId);
  check('export: el Set guardado en IndexedDB NO se muta', src._colFilters[0] instanceof Set && src._colFilters[0].has('mar'));

  const rt = JSON.parse(JSON.stringify(bundle));
  check('export: tras el JSON.stringify del archivo el filtro sigue siendo ARRAY (no {})',
    rt.dataTables[0]._colFilters[0] && Array.isArray(rt.dataTables[0]._colFilters[0]),
    JSON.stringify(rt.dataTables[0]._colFilters && rt.dataTables[0]._colFilters[0]));
}

console.log('\n3. IMPORT real: el bundle exportado (round-trip JSON) vuelve a Set con los valores');
{
  await resetDb();
  await dbPut(STORES.projects, { id: 'p-f', name: 'ProyFiltros', description: '' });
  await dbPut(STORES.data, {
    id: 'tbl-f1', type: 'table-document', projectId: 'p-f', name: 'Tabla filtros',
    headers: ['mes', 'v'], rows: [['ene', 1], ['mar', 3], ['abr', 4]],
    _colFilters: { 0: new Set(['mar', 'abr']) },
  });
  const bundle = await exportProject('p-f');
  const rt = JSON.parse(JSON.stringify(bundle));           // = lo que llega al importador
  const imported = await importProject(rt);                // manifiesto + checksums reales
  check('import: proyecto importado (validacion de integridad OK)', imported && imported.id, imported && imported.id);

  const tables = await dbGetByIndex(STORES.data, 'projectId', imported.id);
  const it = tables.find(x => x.name === 'Tabla filtros');
  check('import: la tabla importada fue persistida', !!it);
  check('import: _colFilters[0] vuelve a ser Set en IndexedDB', it && it._colFilters[0] instanceof Set);
  check('import: valores conservados (mar/abr dentro, ene fuera)',
    it && it._colFilters[0].has('mar') && it._colFilters[0].has('abr') && !it._colFilters[0].has('ene'));

  const f = it._colFilters[0];
  check('render: fila ene queda oculta (no pertenece al filtro)', colFilterHas(f, 'ene') === false);
  check('render: fila mar visible (pertenece)', colFilterHas(f, 'mar') === true);
  check('render: fila abr visible (pertenece)', colFilterHas(f, 'abr') === true);
}

console.log('\n4. LEGACY corrupto (archivo .toolisto producido ANTES del fix): {} no crashea y se descarta');
{
  await resetDb();
  const legacy = {
    version: 2,
    project: { id: 'orig-x', name: 'ProyCorrupto', description: '' },
    documents: [], captures: [], assets: [], executions: [], workflows: [],
    dataTables: [{
      id: 't-old', type: 'table-document', name: 'Tabla vieja',
      headers: ['mes', 'v'], rows: [['ene', 1], ['mar', 3]],
      _colFilters: { 0: {} },   // Set -> JSON.stringify -> {} (forma pre-fix)
    }],
    dashboard: null, query: null, dataModel: null,
  };
  let importedLegacy = null;
  let threw = false;
  try {
    importedLegacy = await importProject(legacy);
  } catch (e) {
    threw = true;
    console.error('  -> import legacy lanzo: ' + e.message);
  }
  check('import legacy corrupto: NO lanza (el import completa)', !threw && !!importedLegacy, String(threw));

  const lt = (await dbGetByIndex(STORES.data, 'projectId', importedLegacy && importedLegacy.id))[0];
  check('import legacy corrupto: la tabla se persiste', !!lt);
  check('import legacy corrupto: el filtro {} corrupto se descarta (sin filtro roto persistido)',
    lt && Object.keys(lt._colFilters).length === 0 && typeof lt._colFilters[0] === 'undefined',
    lt && JSON.stringify(lt._colFilters));
  check('import legacy corrupto: el predicate de render no lanza y deja pasar la fila',
    lt && colFilterHas(lt._colFilters[0], 'ene') === true);
}

console.log('\n5. Anclas estaticas (los 3 puntos del fix estan vivos en el source)');
{
  check('core/table-helpers.js define las 3 funciones nuevas',
    /export function colFilterHas/.test(codeTableHelpers) &&
    /export function colFiltersToSerializable/.test(codeTableHelpers) &&
    /export function normalizeColFilters/.test(codeTableHelpers));
  check('core/storage.js EXPORTA con colFiltersToSerializable',
    /colFiltersToSerializable/.test(codeStorage));
  check('core/storage.js IMPORTA con normalizeColFilters',
    /normalizeColFilters/.test(codeStorage));
  check('workspace.js render cabecera usa colFilterHas en el checkbox',
    /cb\.checked = colFilterHas\(activeFilters, val\)/.test(codeWorkspace));
  check('workspace.js render cuerpo usa colFilterHas y ya NO llama .has() directo sobre la filtro de columna',
    /if \(!colFilterHas\(colFilters\[fci\], fVal\)\) return;/.test(codeWorkspace) &&
    !/colFilters\[[^\]]+\]\.has\(/.test(codeWorkspace));
}

console.log(`\nTOTALS: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);