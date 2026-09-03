#!/usr/bin/env node
/**
 * relations-null-guard-test.mjs (CE-112)
 *
 * El export de un proyecto (core/storage.js `exportProject`) construye el
 * manifiesto via `buildManifest` (core/bundle.js) -> `collectRelations`, que
 * recorria `obj.relations` accediendo a `r.targetId || r.to` MIENTRAS el
 * equivalente `collectRefIds` (bundle.js:116) ya tenia su guard `if (!rel)
 * continue;`. Del mismo modo, la importacion remapea los ids via `remapRefs`
 * (storage.js:333) con `obj.relations.map(r => ({ ...r, ... }))` que reventaba
 * con un `null`. Ambos C R a s h con una entrada `null` dentro de la matriz
 * `relations` (ej. tras un borrado parcial o un bundle legacy malformado):
 *   - EXPORT: `buildManifest` -> `collectRelations` lanza
 *     `TypeError: Cannot read properties of null (reading 'targetId')`
 *     y el flujo estrella `documento -> informe` muere.
 *   - IMPORT: `validateBundleImport` (via `collectRefIds`) IGNORA el null (no lo
 *     rechaza) y luego `remapRefs` reventa antes de escribir.
 *
 * Fijacion (paridad con `collectRefIds`): `collectRelations` anade
 * `if (!r) continue;` y `remapRefs` preserva la entrada null sin tocar
 * (condicional) para no unir el `...r` sobre null.
 *
 * Este test carga el CODIGO REAL de core/{bundle,storage,...}.js en un sandbox
 * y verifica ambos caminos contra bundles con `relations: [null, ...]`:
 *   A. IMPORT: `importProject` con relation null no lanza; la relacion valida
 *      queda remapeada al ID nuevo y el null se descarta.
 *   B. EXPORT: `buildManifest` (el mismo que llama `exportProject`) sobre un
 *      bundle con relation null no lanza y el relationCount solo cuenta la
 *      relacion valida.
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

console.log('=== CE-112: guard null en relations (export/import no crashean) ===\n');
console.log('(CODIGO REAL de bundle.js + storage.js en sandbox; ambos caminos export/import)\n');

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
  dbGet, dbGetByIndex,
  STORES, generateId,
  createProject,
  importProject,
  buildManifest, validateBundleImport,
} = sandbox;

// ============================================================
// Bundles de referencia (forma identica a CE-061 CE-066)
// ============================================================
function makeBundle() {
  return {
    version: 2,
    project: { id: 'orig-proj', name: 'ProjRelations', description: 'test' },
    documents: [
      { id: 'doc-a', name: 'DocA', type: 'text-document', blocks: [] },
      { id: 'doc-b', name: 'DocB', type: 'text-document', blocks: [] },
    ],
    dataTables: [],
    captures: [],
    assets: [],
    executions: [],
    workflows: [],
    dashboard: null,
    query: null,
    dataModel: null,
  };
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// ============================================================
// Parte A: IMPORT (remapRefs) no crashea con relation null
// ============================================================
console.log('A. IMPORT: importProject con relations [null, valida] no lanza y remapea');
{
  const bundle = makeBundle();
  bundle.documents[0].relations = [null, { targetId: 'doc-b', type: 'link' }];
  delete bundle.manifest;

  // Control: validateBundleImport IGNORA el null (no lo rechaza) -> el bug
  // habria llegado a remapRefs y reventado.
  const pre = await validateBundleImport(bundle);
  check('validateBundleImport no rechaza el bundle con relation null', pre.ok === true, JSON.stringify(pre.errors));

  let thrown = null;
  let imported = null;
  try { imported = await importProject(bundle); } catch (e) { thrown = e; }

  check('importProject NO lanza con relation null en documents', thrown === null, thrown && thrown.message);

  if (imported) {
    const impDocs = await dbGetByIndex(STORES.documents, 'projectId', imported.id);
    const docA = impDocs.find(d => d.name === 'DocA');
    check('el documento importado conserva relations', Array.isArray(docA && docA.relations), JSON.stringify(docA && docA.relations));

    const valid = (docA.relations || []).filter(r => r !== null && r !== undefined);
    check('el null se descarto: solo queda la relacion valida', valid.length === 1, 'valid=' + valid.length);

    const docB = impDocs.find(d => d.name === 'DocB');
    check('targetId de la relacion valida remapeado al id nuevo de DocB',
      valid[0] && valid[0].targetId === docB.id,
      'got=' + (valid[0] && valid[0].targetId) + ' expected=' + (docB && docB.id));

    check('la relacion valida conserva su tipo', valid[0] && valid[0].type === 'link', JSON.stringify(valid[0]));
    check('no quedan entradas nulas en la matriz persistida',
      (docA.relations || []).every(r => r !== null && r !== undefined));
  }
}

// ============================================================
// Parte B: EXPORT (buildManifest/collectRelations) no crashea
// ============================================================
console.log('\nB. EXPORT: buildManifest (el mismo que usa exportProject) no lanza con relation null');
{
  const bundle = makeBundle();
  bundle.documents[0].relations = [null, { targetId: 'doc-b', type: 'link' }];
  delete bundle.manifest;

  let thrown = null;
  let manifest = null;
  try { manifest = await buildManifest(bundle); } catch (e) { thrown = e; }

  check('buildManifest NO lanza con relation null', thrown === null, thrown && thrown.message);
  check('manifest se construye', manifest !== null && typeof manifest === 'object');
  if (manifest) {
    check('relationCount cuenta solo la relacion valida (=1)', manifest.relationCount === 1, 'count=' + manifest.relationCount);
    check('derivation contiene la relacion valida remapeable',
      Array.isArray(manifest.derivation) && manifest.derivation.length === 1 && manifest.derivation[0].to === 'doc-b',
      JSON.stringify(manifest.derivation));
  }
}

// ============================================================
// Parte C: anti-regresion estatica (guard presente y paridad)
// ============================================================
console.log('\nC. Anti-regresion estatica: los dos sitios ignoran el null como collectRefIds');
{
  check('collectRelations (bundle.js) tiene guard if (!r) continue',
    /for \(const r of \(obj\.relations \|\| \[\]\)\) \{[\s\S]{0,120}if \(!r\) continue;/.test(codeBundle),
    'guard ausente en collectRelations');
  check('remapRefs (storage.js) protege/descarta la entrada null en relations',
    /obj\.relations = obj\.relations[\s\S]{0,200}if \(!r\) return null;/.test(codeStorage),
    'guard ausente en remapRefs');
  check('collectRefIds conserva su guard previo (paridad, no se toco)',
    codeBundle.includes('if (!rel) continue;'),
    'collectRefIds perdio su guard');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
