#!/usr/bin/env node
/**
 * flush-outgoing-view-test.mjs (CE-113)
 *
 * Bug de fondo: `_flushDirtyEntity()` decidia QUÉ entidad flushear leyendo
 * `appStore.get('currentView')`. Pero `renderView` corre a traves del subscriber
 * de `currentView`, que en `navigateTo`/historial se dispara DESPUES de que la
 * tienda ya tenga la vista NUEVA. Asi, al salir del editor hacia una vista de
 * tabla (o cualquier vista distinta), `_flushDirtyEntity` leia la vista NUEVA y:
 *   - o flusheaba la entidad NUEVA (la tabla T1 entrante) aprovechando la bandera
 *     COMPARTIDA `isDirty` (que la edicion del documento habia marcado),
 *   - o (vista sin rama doc/table) NO flusheaba nada.
 * En ambos casos el debounce del documento SALIENTE quedaba pendiente y `renderView`
 * lo cancelaba (`clearTimeout(autoSaveDoc._timer)`) justo despues. Como `isDirty`
 * ya quedo en `false`, ni siquiera el intervalo de 5s salvaba la ultima edicion:
 * PERDIDA REAL de datos al navegar del editor a una vista de tabla.
 *
 * Fix (CE-113): se pasa la vista SALIENTE hasta `_flushDirtyEntity`:
 *   - el subscriber de `currentView` recibe `(view, prevView)` (state.js:12) y lo
 *     reenvia a `renderView(view, prevView)`;
 *   - `renderView(view, prevView)` llama `_flushDirtyEntity(prevView)`;
 *   - `_flushDirtyEntity(outgoingView)` usa `outgoingView || currentView` para
 *     flushear la entidad que se DEJA, no la que se entra.
 *
 * La suite usa el CODIGO REAL de workspace.js (`_flushDirtyEntity`, `_flushOutgoingEntity`,
 * autoSaveDoc, autoSaveTable, locks, `installEntitySwitchFlush`) + appStore real de
 * state.js + capa persistente fiel a storage.js + un shim de `renderView` que replica
 * EXACTAMENTE las dos lineas relevantes del `renderView` real (flush + cancelacion de
 * debounce timers) y un subscriber de currentView fiel a la linea 995-1001 real (que
 * reenvia prevView). Tras cada escenario se recarga desde la capa persistente.
 *
 * Los controles negativos demuestran que SIN el fix (flush sin prevView, leyendo la
 * vista nueva) la edicion del saliente se pierde -> la suite no es tautologica.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const stateCode = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.log('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

// ---------- Extractor de funciones reales de workspace.js ----------
function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
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
  const store = createStore({
    currentView: 'projects',
    currentProject: null,
    currentDoc: null,
    currentDataTable: null,
    isDirty: false,
    lastSaved: null,
  });
  return store;
}

// ---------- Capa persistente en memoria (fiel a storage.js) ----------
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
  async function saveDoc(_projectId, doc) { return applyWrite(doc.id, doc); }
  async function saveData(_projectId, table) { return applyWrite(table.id, table); }
  async function loadDoc(id) { return load(id); }
  async function loadTable(id) { return load(id); }
  return { DB, saveDoc, saveData, loadDoc, loadTable };
}

const lockSrc = grabFn(wsCode, '_createSaveLock');
const lockMapSrc = grabFn(wsCode, '_createEntityLockMap');
const autoSaveDocSrc = grabFn(wsCode, 'autoSaveDoc');
const autoSaveTableSrc = grabFn(wsCode, 'autoSaveTable');
const flushDirtySrc = grabFn(wsCode, '_flushDirtyEntity');
const flushOutgoingSrc = grabFn(wsCode, '_flushOutgoingEntity');
const installSwitchSrc = grabFn(wsCode, 'installEntitySwitchFlush');

// Unix script: keep AutoSave objects, snapshots, locks shared across the real fns.
let store, persistence;
let reportErrorCalls = [];
const autoSaveDoc = { _timer: null };
const autoSaveTable = { _timer: null };
let _lastAutosaveSnapshot = '';
let _lastAutosaveTableSnapshot = '';

function wire() {
  store = buildStore();
  persistence = buildPersistence();
  reportErrorCalls = [];
  _lastAutosaveSnapshot = '';
  _lastAutosaveTableSnapshot = '';
  autoSaveDoc._timer = null;
  autoSaveTable._timer = null;
  manualTimers.clear();
  nextTimerId = 1;
}

// Construye un sandbox con las funciones REALES y, opcionalmente, el fix que reenvia
// prevView (usePrevView=true replica la secuencia corregida; false, el comportamiento
// antiguo de leer la vista nueva).
function buildSandbox(usePrevView) {
  const js = [
    lockSrc,
    lockMapSrc,
    'const _docLocks = _createEntityLockMap();',
    'const _tableLocks = _createEntityLockMap();',
    'let _lastAutosaveSnapshot = "";',
    'let _lastAutosaveTableSnapshot = "";',
    autoSaveDocSrc,
    autoSaveTableSrc,
    flushOutgoingSrc,
    installSwitchSrc,
    flushDirtySrc,
    // shim de renderView que replica las DOS lineas relevantes del renderView real:
    // primero flush (con prevView si el fix esta activo) y luego la cancelacion de los
    // debounce timers de doc y tabla (lineas 1244-1246 reales).
    'globalThis.__renderViewShim = function (view, prevView) {',
    '  _flushDirtyEntity(prevView);',
    '  clearTimeout(autoSaveDoc._timer);',
    '  clearTimeout(autoSaveTable._timer);',
    '};',
  ].join('\n');
  const body = js + '\nreturn { _flushDirtyEntity, installEntitySwitchFlush, autoSaveDoc, autoSaveTable };';
  const fn = new Function(
    'appStore', 'saveDoc', 'saveData', 'syncDerivedCharts', 'reportError',
    'setTimeout', 'clearTimeout', 'Map', 'console', 'Date', 'JSON', 'String', 'Math',
    body
  );
  const api = fn(
    store, persistence.saveDoc, persistence.saveData, () => {},
    (err, src, ctx) => { reportErrorCalls.push(src + (err && err.message ? ':' + err.message : '')); },
    manualSetTimeout, manualClearTimeout, Map, console, Date, JSON, String, Math
  );
  // Registra un subscriber de currentView fiel al REAL (workspace.js:995-1001):
  // reenvia prevView a renderView. El modo antiguo NO reenvia prevView (usa la vista
  // nueva -> reproduce el bug).
  store.subscribe('currentView', (view, prevView) => {
    globalThis.__renderViewShim(view, usePrevView ? prevView : undefined);
  });
  return api;
}

async function drain() {
  for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
}

console.log('=== CE-113: _flushDirtyEntity lee la vista nueva -> perdida del saliente al navegar ===');
console.log('(CODIGO REAL extraido + appStore real + capa fiel + shim renderView fiel + reload)\n');

// ---------- Escenario 1 (FIX): doc -> data-table, se flushea el doc SALIENTE ----------
console.log('1. FIX: salir del editor hacia una tabla con flush guiado por prevView');
{
  wire();
  const api = buildSandbox(true);
  api.installEntitySwitchFlush(store);
  const docA = { id: 'docA1', title: 'A1', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  const t1 = { id: 'tbl1', title: 'T1', headers: ['a'], rows: [['']] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, currentDataTable: null, isDirty: true, lastSaved: null });
  await persistence.saveDoc('proj-1', docA);
  await persistence.saveData('proj-1', t1);
  // el usuario edita A: debounce pendiente + isDirty compartida en true
  docA.blocks[0].content = 'ultima-edicion-de-A';
  _lastAutosaveSnapshot = ''; // fuerza diferencia
  api.autoSaveDoc(docA);
  check('el debounce de A esta armado antes de navegar', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  // navegacion real: navigateTo(data-table) pone la tabla y LUEGO la vista nueva.
  // El subscriber de currentView corre con prevView='doc-editor'.
  store.set({ currentDataTable: t1 });
  store.set({ currentView: 'data-table' });
  await drain();
  const reloadA = await persistence.loadDoc('docA1');
  const reloadT = await persistence.loadTable('tbl1');
  check('el documento SALIENTE persistio su ultima edicion al navegar a la tabla', reloadA && reloadA.blocks[0].content === 'ultima-edicion-de-A',
    reloadA ? reloadA.blocks[0].content : 'null');
  // T1 fue escrita por el saveData previo (contenido inicial ''), pero NO debe haber
  // cargado la edicion del doc sobre ella: su celda sigue vacia.
  check('la tabla entrante NO fue contaminada por la edicion del doc', reloadT && reloadT.rows[0][0] === '', reloadT ? JSON.stringify(reloadT.rows) : 'null');
}

// ---------- Escenario 2 (CONTROL NEGATIVO): sin fix, el saliente se pierde ----------
console.log('\n2. CONTROL NEGATIVO: sin prevView (vista nueva), el doc saliente SE PIERDE');
{
  wire();
  const api = buildSandbox(false);
  api.installEntitySwitchFlush(store);
  const docA = { id: 'docA2', title: 'A2', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  const t1 = { id: 'tbl2', title: 'T2', headers: ['a'], rows: [['']] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, currentDataTable: null, isDirty: true, lastSaved: null });
  await persistence.saveDoc('proj-1', docA);
  await persistence.saveData('proj-1', t1);
  docA.blocks[0].content = 'edicion-en-riesgo-de-perdida';
  _lastAutosaveSnapshot = '';
  api.autoSaveDoc(docA);
  check('debounce de A pendiente antes de navegar (sin fix)', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  store.set({ currentDataTable: t1 });
  store.set({ currentView: 'data-table' });
  // Sin fix: _flushDirtyEntity lee currentView='data-table' -> flushea T1 y limpia
  // la bandera COMPARTIDA isDirty (que pertenecia a la edicion del doc A).
  await drain();
  const reloadA = await persistence.loadDoc('docA2');
  const storeState = store.get();
  check('sin fix, la edicion del documento saliente NO quedo persistida (perdida real)', !reloadA || reloadA.blocks[0].content === '',
    reloadA ? reloadA.blocks[0].content : 'null');
  check('sin fix, isDirty quedo en false (la bandera compartida se consumio con la tabla)', storeState.isDirty === false, 'isDirty=' + storeState.isDirty);
  check('sin fix, el debounce del doc quedo cancelado (nadie lo persigue)', pendingTimerCount() === 0, 'timers=' + pendingTimerCount());
}

// ---------- Escenario 3 (FIX simetrico): tabla -> doc, se flushea la tabla SALIENTE ----------
console.log('\n3. FIX: salir de la tabla hacia el editor, flush guiado por prevView');
{
  wire();
  const api = buildSandbox(true);
  api.installEntitySwitchFlush(store);
  const t1 = { id: 'tbl3', title: 'T3', headers: ['a'], rows: [['base']] };
  const docB = { id: 'docB3', title: 'B3', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'data-table', currentDataTable: t1, currentDoc: null, isDirty: true, lastSaved: null });
  await persistence.saveData('proj-1', t1);
  await persistence.saveDoc('proj-1', docB);
  t1.rows[0][0] = 'celda-final-de-T3';
  _lastAutosaveTableSnapshot = '';
  api.autoSaveTable(t1);
  check('el debounce de la tabla esta armado antes de navegar', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  store.set({ currentDoc: docB });
  store.set({ currentView: 'doc-editor' });
  await drain();
  const reloadT = await persistence.loadTable('tbl3');
  const reloadB = await persistence.loadDoc('docB3');
  check('la tabla SALIENTE persistio su celda editada al navegar al editor', reloadT && reloadT.rows[0][0] === 'celda-final-de-T3',
    reloadT ? JSON.stringify(reloadT.rows) : 'null');
  check('el documento entrante NO fue contaminado por la edicion de la tabla', reloadB && reloadB.blocks[0].content === '', reloadB ? reloadB.blocks[0].content : 'null');
}

// ---------- Escenario 4 (CONTROL NEGATIVO simetrico): tabla -> doc sin fix, se pierde ----------
console.log('\n4. CONTROL NEGATIVO: sin prevView, la tabla saliente SE PIERDE');
{
  wire();
  const api = buildSandbox(false);
  api.installEntitySwitchFlush(store);
  const t1 = { id: 'tbl4', title: 'T4', headers: ['a'], rows: [['base']] };
  const docB = { id: 'docB4', title: 'B4', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'data-table', currentDataTable: t1, currentDoc: null, isDirty: true, lastSaved: null });
  await persistence.saveData('proj-1', t1);
  await persistence.saveDoc('proj-1', docB);
  t1.rows[0][0] = 'celda-en-riesgo';
  _lastAutosaveTableSnapshot = '';
  api.autoSaveTable(t1);
  check('debounce de la tabla pendiente antes de navegar (sin fix)', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  store.set({ currentDoc: docB });
  store.set({ currentView: 'doc-editor' });
  await drain();
  const reloadT = await persistence.loadTable('tbl4');
  const storeState = store.get();
  check('sin fix, la celda de la tabla saliente NO quedo persistida (perdida)', !reloadT || reloadT.rows[0][0] === 'base',
    reloadT ? JSON.stringify(reloadT.rows) : 'null');
  check('sin fix, isDirty quedo en false (bandera compartida consumida con el doc)', storeState.isDirty === false, 'isDirty=' + storeState.isDirty);
}

// ---------- Escenario 5 (FIX): salir del editor hacia una vista SIN entidad (dashboard) ----------
console.log('\n5. FIX: salir del editor hacia dashboard (vista sin entidad), se flushea el doc');
{
  wire();
  const api = buildSandbox(true);
  api.installEntitySwitchFlush(store);
  const docA = { id: 'docA5', title: 'A5', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, isDirty: true, lastSaved: null });
  await persistence.saveDoc('proj-1', docA);
  docA.blocks[0].content = 'edicion-pre-dashboard';
  _lastAutosaveSnapshot = '';
  api.autoSaveDoc(docA);
  check('el debounce de A esta armado antes de navegar', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  store.set({ currentView: 'dashboard' });
  await drain();
  const reloadA = await persistence.loadDoc('docA5');
  check('la edicion del documento se persistio al salir hacia una vista sin entidad', reloadA && reloadA.blocks[0].content === 'edicion-pre-dashboard',
    reloadA ? reloadA.blocks[0].content : 'null');
}

// ---------- Escenario 6: guard rapido de compatibilidad (vista no pasada -> currentView) ----------
console.log('\n6. Compatibilidad: _flushDirtyEntity sin prevView cae a currentView (callers directos)');
{
  wire();
  // No se instala subscriber ni shim; llamamos _flushDirtyEntity() directo en el
  // modo OLD (sin prevView) para verificar que el fallback a currentView sigue vivo
  // (callers como refreshCurrentView llaman renderView(view) sin prevView).
  const api = buildSandbox(false);
  const docA = { id: 'docA6', title: 'A6', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, isDirty: false, lastSaved: null });
  await persistence.saveDoc('proj-1', docA);
  docA.blocks[0].content = 'flush-directo';
  store.set({ isDirty: true }); // marca sucia despues de que el subscriber ya corrio
  api._flushDirtyEntity(); // sin arg: fallback a currentView='doc-editor'
  await drain();
  const reloadA = await persistence.loadDoc('docA6');
  check('_flushDirtyEntity() sin prevView usa currentView (doc-editor) y flushea', reloadA && reloadA.blocks[0].content === 'flush-directo',
    reloadA ? reloadA.blocks[0].content : 'null');
}

// ---------- Escenario 7: anclas estaticas anti-regresion del fix ----------
console.log('\n7. Anclas estaticas: el codigo fuente reenvia prevView hasta _flushDirtyEntity');
{
  const hasPrevViewParam = /function _flushDirtyEntity\(outgoingView\)/.test(wsCode);
  const hasRenderPrev = /function renderView\(view,\s*prevView\)[\s\S]*?_flushDirtyEntity\(prevView\)/.test(wsCode);
  const hasSubscriberPrev = /appStore\.subscribe\('currentView',\s*\(view,\s*prevView\)[\s\S]*?renderView\(view,\s*prevView\)/.test(wsCode);
  const hasFallback = /const view = outgoingView\s*\|\|\s*appStore\.get\('currentView'\)/.test(wsCode);
  check('_flushDirtyEntity recibe el parametro outgoingView', hasPrevViewParam);
  check('renderView(view, prevView) reenvia prevView a _flushDirtyEntity', hasRenderPrev);
  check('el subscriber de currentView reenvia prevView a renderView', hasSubscriberPrev);
  check('_flushDirtyEntity hace fallback a currentView cuando no hay outgoingView', hasFallback);
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
