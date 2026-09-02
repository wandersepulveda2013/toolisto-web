#!/usr/bin/env node
/**
 * export-flush-fidelity-test.mjs (CE-094)
 *
 * Auditoria determinista de la fidelidad del export: un bundle exportado debe
 * contener la ULTIMA edicion en memoria, no la fila persistida por el debounce.
 *
 * Problema (CE-094): `exportProject` (core/storage.js:272-291) lee el bundle
 * desde IndexedDB; `exportProjectData` (workspace.js) lo llamaba sin flushear
 * los autosaves pendientes en memoria. Si el usuario edita una celda/doc y pulsa
 * «Exportar» dentro de la ventana del debounce (<1s), el .toolisto llevaba el
 * estado ANTERIOR: perdida silenciosa de la ultima edicion en el snapshot.
 *
 * Fijacion: `exportProjectData` ahora llama `_flushDirtyBeforeExport()` ANTES de
 * `exportProject`. El helper (workspace.js) aguarda a que la entidad actual
 * sucia (doc o tabla) quede guardada en la base (por su lock por-entidad, igual
 * que la sesion), y solo despues se lee el bundle.
 *
 * Este test utiliza el CODIGO REAL de workspace.js:
 *   - _flushDirtyBeforeExport (la ruta nueva que guarda el dirty ANTES del export),
 * y lo cablea con:
 *   - un appStore real (createStore de state.js),
 *   - una capa persistente fiel a storage.js saveDoc/saveData (guard _writeSeq),
 *   - syncDerivedCharts inyectable,
 *   - timers manuales deterministas.
 *
 * Despues de cada escenario, se lee la entidad desde la capa persistente
 * (loadDoc/loadTable) — exactamente lo que leería `exportProject` — y se valida
 * que contenga la ultima edicion.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const stateCode = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

// ---------- Extractor de funciones reales de workspace.js ----------
function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^(async )?function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

// ---------- Timers manuales (deterministas) ----------
let manualTimers = new Map();
let nextTimerId = 1;
function manualSetTimeout(fn, _ms) { const id = nextTimerId++; manualTimers.set(id, fn); return id; }
function manualClearTimeout(id) { if (id != null) manualTimers.delete(id); }
function pendingTimerCount() { return manualTimers.size; }

// ---------- appStore real (createStore de state.js) ----------
function buildStore() {
  let stateSrc = stateCode
    .replace(/^import\s.*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  stateSrc = stateSrc.slice(0, stateSrc.indexOf('const appStore = createStore('));
  const fn = new Function(stateSrc + '\nreturn { createStore };');
  const { createStore } = fn();
  const store = createStore({ currentView: 'doc-editor', currentProject: null, currentDoc: null, currentDataTable: null, isDirty: false, lastSaved: null });
  return store;
}

// ---------- Capa persistente en memoria (fiel a saveDoc/saveData) ----------
function buildPersistence() {
  const DB = new Map();
  function load(id) { return DB.has(id) ? JSON.parse(JSON.stringify(DB.get(id))) : null; }
  function applyWrite(key, entity) {
    const existing = DB.has(key) ? JSON.parse(JSON.stringify(DB.get(key))) : null;
    if (existing && existing._writeSeq != null && existing._writeSeq > (entity._writeSeq || 0)) return existing;
    entity._writeSeq = (existing?._writeSeq || 0) + 1;
    const clone = JSON.parse(JSON.stringify(entity));
    DB.set(key, clone);
    return clone;
  }
  return { DB, saveDoc: (_p, doc) => Promise.resolve(applyWrite(doc.id, doc)), saveData: (_p, t) => Promise.resolve(applyWrite(t.id, t)), loadDoc: (id) => load(id), loadTable: (id) => load(id) };
}

// ---------- Sandbox: ruta real de workspace.js ----------
const lockSrc = grabFn(wsCode, '_createSaveLock');
const lockMapSrc = grabFn(wsCode, '_createEntityLockMap');
const flushBeforeExportSrc = grabFn(wsCode, '_flushDirtyBeforeExport');

let store, persistence;
let chartSyncCalls = 0;
function wire() {
  store = buildStore();
  persistence = buildPersistence();
  chartSyncCalls = 0;
  manualTimers.clear();
  nextTimerId = 1;
}

function buildExportApi({ view, project, doc, table, dirty, pendingBlockContent, pendingCell, syncCharts = false }) {
  const js = [
    lockSrc,
    lockMapSrc,
    'const _docLocks = _createEntityLockMap();',
    'const _tableLocks = _createEntityLockMap();',
    'const autoSaveDoc = { _timer: null };',
    'const autoSaveTable = { _timer: null };',
    'let _lastAutosaveSnapshot = "";',
    'let _lastAutosaveTableSnapshot = "";',
    flushBeforeExportSrc,
  ].join('\n');
  const body = js + '\nreturn { _flushDirtyBeforeExport, autoSaveDoc, autoSaveTable };';
  const fn = new Function(
    'appStore', 'saveDoc', 'saveData', 'syncDerivedCharts', 'reportError',
    'setTimeout', 'clearTimeout', 'Map', 'console', 'Date', 'JSON', 'String', 'Math',
    body
  );
  const api = fn(store, persistence.saveDoc, persistence.saveData, () => { chartSyncCalls++; return Promise.resolve(); }, () => {}, manualSetTimeout, manualClearTimeout, Map, console, Date, JSON, String, Math);
  store.set({ currentView: view, currentProject: project, isDirty: dirty, lastSaved: null });
  if (view === 'doc-editor') store.set({ currentDoc: doc, currentDataTable: null });
  else if (view === 'data-table') store.set({ currentDataTable: table, currentDoc: null });
  return api;
}

async function drain() { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); }

const proj = { id: 'proj-1', name: 'Demo' };

console.log('=== CE-094: el export refleja la ultima edicion en memoria (flush pre-export) ===');
console.log('(_flushDirtyBeforeExport REAL de workspace.js + appStore real + capa persistente + reload)\n');

// ---------- Escenario 1: doc editado con debounce pendiente -> export flushea la ultima edicion ----------
console.log('1. Documento editado dentro del debounce: al exportar se guarda la ultima edicion');
{
  wire();
  const doc = { id: 'docX', title: 'X', blocks: [{ id: 'b1', type: 'paragraph', content: 'ANTES' }] };
  await persistence.saveDoc(proj.id, doc);                              // fila persistida ANTES
  const api = buildExportApi({ view: 'doc-editor', project: proj, doc, dirty: true, pendingBlockContent: 'ultima-edicion-DOC' });
  // usuario edita en memoria: la edicion aun NO esta en la base (solo en memoria)
  doc.blocks[0].content = 'ultima-edicion-DOC';
  // SIN flush, el reload (== lo que leería exportProject) seguiria con 'ANTES' -> hueco
  let before = await persistence.loadDoc('docX');
  check('(control) en la ventana del debounce, la base aun tiene el valor ANTERIOR', before && before.blocks[0].content === 'ANTES', before ? before.blocks[0].content : 'null');
  // el fix: _flushDirtyBeforeExport guarda la ultima edicion ANTES de exportar
  await api._flushDirtyBeforeExport();
  await drain();
  let after = await persistence.loadDoc('docX');
  check('al exportar se persistio la ultima edicion del doc', after && after.blocks[0].content === 'ultima-edicion-DOC',
    after ? after.blocks[0].content : 'null');
  check('el bundle leido por exportProject (reload) ahora lleva la edicion nueva', after && after.blocks[0].content !== 'ANTES');
}

// ---------- Escenario 2: tabla editada con debounce pendiente -> export flushea + sincroniza graficos ----------
console.log('\n2. Tabla editada dentro del debounce: al exportar se persiste la celda y se sincronizan graficos');
{
  wire();
  const table = { id: 'tabX', title: 'T', headers: ['a'], rows: [['ANTES']] };
  await persistence.saveData(proj.id, table);
  const api = buildExportApi({ view: 'data-table', project: proj, table, dirty: true, syncCharts: true });
  table.rows[0][0] = 'celda-exportada-nueva';
  let before = await persistence.loadTable('tabX');
  check('(control) en la ventana del debounce, la tabla persistida aun tiene el valor ANTERIOR', before && before.rows[0][0] === 'ANTES', before ? before.rows[0][0] : 'null');
  await api._flushDirtyBeforeExport();
  await drain();
  let after = await persistence.loadTable('tabX');
  check('al exportar se persistio la celda editada', after && after.rows[0][0] === 'celda-exportada-nueva', after ? after.rows[0][0] : 'null');
  check('syncDerivedCharts se invoco para la tabla exportada', chartSyncCalls >= 1, 'calls=' + chartSyncCalls);
}

// ---------- Escenario 3: proyecto no sucio -> no escribe nada (no tocar filas limpias) ----------
console.log('\n3. Proyecto NO sucio: el flush no escribe nada (sin ruido ni coste)');
{
  wire();
  const doc = { id: 'docY', title: 'Y', blocks: [{ id: 'b1', type: 'paragraph', content: 'persistido' }] };
  await persistence.saveDoc(proj.id, doc);
  const api = buildExportApi({ view: 'doc-editor', project: proj, doc, dirty: false });
  await api._flushDirtyBeforeExport();
  await drain();
  const reload = await persistence.loadDoc('docY');
  check('sin dirty, el doc se mantiene intacto', reload && reload.blocks[0].content === 'persistido', reload ? reload.blocks[0].content : 'null');
  check('no hay timers residuales tras el flush', pendingTimerCount() === 0, 'timers=' + pendingTimerCount());
}

// ---------- Escenario 4: sin proyecto -> no crashea ----------
console.log('\n4. Sin proyecto en curso: el flush no crashea');
{
  wire();
  const api = buildExportApi({ view: 'doc-editor', project: null, dirty: false });
  let ok = true;
  try { await api._flushDirtyBeforeExport(); } catch (e) { ok = false; }
  check('sin project no lanza', ok === true);
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);