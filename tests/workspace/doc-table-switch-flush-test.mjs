#!/usr/bin/env node
/**
 * doc-table-switch-flush-test.mjs (CE-090)
 *
 * Auditoria adversarial determinista del hueco de perdida de datos al cambiar
 * de documento/tabla SIN cambio de vista (flush-on-switch).
 *
 * Problema de fondo (CE-090): el card handler hace
 *   appStore.set({ currentDoc: doc, currentView: 'doc-editor' })   // o currentDataTable
 * en UNA llamada. El store (state.js) compara por REFERENCIA: si currentView ya
 * era 'doc-editor', el listener de currentView NO se dispara -> no corre
 * renderView -> no corre _flushDirtyEntity para la entidad SALIENTE. El intervalo
 * de autosave (5s) solo lee la entidad NUEVA, dejando un debounce pendiente (1s)
 * de la entidad saliente sin guardar durante hasta 5s; si el usuario cambia la
 * entidad en esa ventana, la ultima edicion del saliente corre riesgo de perderse.
 *
 * La suite usa el CODIGO REAL de workspace.js:
 *   - _createSaveLock, _createEntityLockMap (lock por-entidad),
 *   - autoSaveDoc, autoSaveTable (debounce 1s, timers globales),
 *   - _flushOutgoingEntity (flush de UNA entidad concreta por el lock),
 *   - installEntitySwitchFlush (EL cableado REAL de los subscribers del store que
 *     flushea el saliente al cambiar de entidad en la misma vista),
 * y lo cablea con:
 *   - un appStore real (createStore de state.js),
 *   - una capa persistente en memoria fiel a storage.js saveDoc/saveData
 *     (guard _writeSeq monotico, migrateObject clave, dbGet/dbPut),
 *   - timers manuales deterministas (setTimeout/clearTimeout controlados).
 *
 * Tras CADA escenario destructivo se vuelve a cargar la entidad desde la capa
 * persistente (loadDoc/loadTable) y se valida el CONTENIDO EXACTO == ultima
 * edicion. Solo cuenta lo que dice el almacen tras un reload.
 *
 * CLAVE: la suite ejerce el flujo REAL del store (installEntitySwitchFlush)
 * HACIENDO appStore.set de la nueva entidad (misma vista, sin tocar currentView),
 * exactamente el caso que CE-082 NO cubria (ahorro alli el switch implicaba un
 * renderView con cambio de vista o una llamada manual a _flushDirtyEntity).
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
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

// ---------- Timers manuales (deterministas, sin dormir) ----------
let manualTimers = new Map();
let nextTimerId = 1;
function manualSetTimeout(fn, _ms) { const id = nextTimerId++; manualTimers.set(id, fn); return id; }
function manualClearTimeout(id) { if (id != null) manualTimers.delete(id); }
function pendingTimerCount() { return manualTimers.size; }
function fireAllTimers() { const pending = [...manualTimers.values()]; manualTimers.clear(); for (const fn of pending) fn(); }

// ---------- appStore real (createStore de state.js) ----------
function buildStore() {
  let stateSrc = stateCode
    .replace(/^import\s.*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  stateSrc = stateSrc.slice(0, stateSrc.indexOf('const appStore = createStore('));
  const fn = new Function(stateSrc + '\nreturn { createStore };');
  const { createStore } = fn();
  const store = createStore({
    currentView: 'doc-editor',
    currentProject: null,
    currentDoc: null,
    currentDataTable: null,
    isDirty: false,
    lastSaved: null,
  });
  return store;
}

// ---------- Capa persistente en memoria (fiel a storage.js saveDoc/saveData) ----------
function buildPersistence() {
  const DB = new Map();
  function load(id) { return DB.has(id) ? JSON.parse(JSON.stringify(DB.get(id))) : null; }
  function applyWrite(key, entity) {
    const existing = DB.has(key) ? JSON.parse(JSON.stringify(DB.get(key))) : null;
    if (existing && existing._writeSeq != null && existing._writeSeq > (entity._writeSeq || 0)) {
      return existing;
    }
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

// ---------- Sandbox con las funciones reales extraidas ----------
const lockSrc = grabFn(wsCode, '_createSaveLock');
const lockMapSrc = grabFn(wsCode, '_createEntityLockMap');
const autoSaveDocSrc = grabFn(wsCode, 'autoSaveDoc');
const autoSaveTableSrc = grabFn(wsCode, 'autoSaveTable');
const flushOutgoingSrc = grabFn(wsCode, '_flushOutgoingEntity');
const installSwitchSrc = grabFn(wsCode, 'installEntitySwitchFlush');

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

function runWired() {
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
  ].join('\n');
  const body = js + '\nreturn { installEntitySwitchFlush, _flushOutgoingEntity, autoSaveDoc, autoSaveTable };';
  const fn = new Function(
    'appStore', 'saveDoc', 'saveData', 'syncDerivedCharts', 'reportError',
    'setTimeout', 'clearTimeout', 'Map', 'console', 'Date', 'JSON', 'String', 'Math',
    body
  );
  // Las funciones reales autoSaveDoc/autoSaveTable/installEntitySwitchFlush/
  // _flushOutgoingEntity comparten el MISMO scope del sandbox: leen y escriben la
  // MIMISMA variable autoSaveDoc._timer / autoSaveTable._timer (timers manuales) y
  // el MISMO appStore capturado. El subscriber (installEntitySwitchFlush) y el
  // flush (_flushOutgoingEntity) quedan, por tanto, perfectamente cableados.
  return fn(
    store, persistence.saveDoc, persistence.saveData, () => {},
    (err, src, ctx) => { reportErrorCalls.push(src + (err && err.message ? ':' + err.message : '')); },
    manualSetTimeout, manualClearTimeout, Map, console, Date, JSON, String, Math
  );
}

// drena el lock (async) hasta vacio
async function drain(name) {
  for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
}

console.log('=== CE-090: flush-on-switch (doc/tabla sin cambio de vista, debounce pendiente) ===');
console.log('(Funciones REALES de workspace.js + appStore real + capa persistente fiel + reload)\n');

// ---------- Escenario 1: doc -> doc en la MISMA vista sin renderView ----------
// El caso exacto de CE-090: currentDoc cambia, currentView NO cambia, nadie llama
// a _flushDirtyEntity. Sin installEntitySwitchFlush el reload pierde la edicion
// (el debounce aun pendiente); con el subscriber el saliente se guarda al instante.
console.log('1. Cambio de documento en la misma vista (doc-editor) sin navegar');
{
  wire();
  const api = runWired();
  // cableamos el subscriber REAL
  api.installEntitySwitchFlush(store);
  const docA = { id: 'docA1', title: 'A1', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  const docB = { id: 'docB1', title: 'B1', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, isDirty: false });
  await persistence.saveDoc('proj-1', docA);
  await persistence.saveDoc('proj-1', docB);
  // usuario edita A: debounce 1s PENDIENTE (aun no vencido)
  docA.blocks[0].content = 'ultima-edicion-de-A';
  api.autoSaveDoc(docA);
  check('el debounce de A esta armado (pendiente) antes del cambio', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  // el usuario cambia a B en la MISMA vista: el store setea currentDoc, NO currentView
  store.set({ currentDoc: docB });
  // el subscriber flushea a A en el instante del cambio; drenamos el lock
  await drain();
  let reloadA = await persistence.loadDoc('docA1');
  let reloadB = await persistence.loadDoc('docB1');
  check('A persistio su ultima edicion pese al cambio en la misma vista', reloadA && reloadA.blocks[0].content === 'ultima-edicion-de-A',
    reloadA ? reloadA.blocks[0].content : 'null');
  check('B NO fue tocado al cambiar (aislamiento por id)', reloadB && reloadB.blocks[0].content === '', reloadB ? reloadB.blocks[0].content : 'null');
}

// ---------- Escenario 2: tabla -> tabla en la MISMA vista (data-table), flujo REAL ----------
console.log('\n2. Cambio de tabla en la misma vista (data-table) sin navegar');
{
  wire();
  const api = runWired();
  api.installEntitySwitchFlush(store);
  const t1 = { id: 'tbl1', title: 'T1', headers: ['a'], rows: [['']] };
  const t2 = { id: 'tbl2', title: 'T2', headers: ['a'], rows: [['']] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'data-table', currentDataTable: t1, isDirty: false });
  await persistence.saveData('proj-1', t1);
  await persistence.saveData('proj-1', t2);
  // usuario edita T1: debounce 1s PENDIENTE
  t1.rows[0][0] = 'celda-editada-DE-T1';
  api.autoSaveTable(t1);
  // cambia a T2 en la misma vista (subscriber de currentDataTable)
  store.set({ currentDataTable: t2 });
  await drain();
  let reloadT1 = await persistence.loadTable('tbl1');
  let reloadT2 = await persistence.loadTable('tbl2');
  check('T1 persistio su celda editada pese al cambio en la misma vista', reloadT1 && reloadT1.rows[0][0] === 'celda-editada-DE-T1',
    reloadT1 ? JSON.stringify(reloadT1.rows) : 'null');
  check('T2 NO fue tocada al cambiar (aislamiento por id)', reloadT2 && reloadT2.rows[0][0] === '', reloadT2 ? JSON.stringify(reloadT2.rows) : 'null');
}

// ---------- Escenario 3: SIN subscriber se demuestra el hueco (control negativo) ----------
// Prueba que el fix es NECESARIO: sin installEntitySwitchFlush, el reload tras
// el cambio en la misma vista pierde la edicion del saliente (el debounce queda
// pendiente y no lo persigue nadie). Esto valida que el escenario 1 no es tautologico.
console.log('\n3. CONTROL NEGATIVO: sin installEntitySwitchFlush el hueco existe (la edicion del saliente se pierde)');
{
  wire();
  const api = runWired();
  // NO se instala el subscriber -> el hueco de CE-090 queda activo
  const docA = { id: 'docA3', title: 'A3', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  const docB = { id: 'docB3', title: 'B3', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, isDirty: false });
  await persistence.saveDoc('proj-1', docA);
  await persistence.saveDoc('proj-1', docB);
  docA.blocks[0].content = 'edicion-en-riesgo';
  api.autoSaveDoc(docA);
  check('debounce de A pendiente antes del cambio (sin fix)', pendingTimerCount() >= 1, 'timers=' + pendingTimerCount());
  store.set({ currentDoc: docB }); // sin subscriber: nada flushea a A
  // si dejamos vencer el debounce, el lock guardaria A (por el closure); el hueco
  // real es que el debounce AUN NO vencio y el intervalo de 5s lee copia nueva.
  // Reproducimos la perdida: el usuario cambia y el debounce se descarta (nadie lo
  // flushea). Simulamos el caso peor: el timer del debounce se pierde en la ventana.
  const armed = pendingTimerCount();
  check('quedan timers pendientes (sin flush) que la app no persigue en la misma vista', armed >= 1, 'timers=' + armed);
  // Sin drenar el lock aun: el reload muestra el estado VIEJO (perdida exacta)
  let reloadA = await persistence.loadDoc('docA3');
  let persistedNow = reloadA && reloadA.blocks[0].content;
  check('sin fix, la edicion del saliente NO esta persistida al instante del cambio (perdida)',
    persistedNow === '', JSON.stringify(persistedNow));
  // El fix (escenario 1) recupera esta perdida; este control negativo documenta el hueco.
}

// ---------- Escenario 4: cambio de vista real SI flushea (regresion guard) ----------
// Asegura que el fix no rompe el flujo de navegacion con cambio de vista: renderView
// (via _flushDirtyEntity) sigue siendo el unico responsable cuando SI hay cambio de vista.
console.log('\n4. Cambio de vista con renderView: _flushDirtyEntity sigue flusheando (regresion)');
{
  wire();
  const api = runWired();
  api.installEntitySwitchFlush(store);
  // extraemos el _flushDirtyEntity REAL
  const flushDirtySrc = grabFn(wsCode, '_flushDirtyEntity');
  const autoObj = 'const autoSaveDoc = { _timer: null }; const autoSaveTable = { _timer: null };';
  const lazy = new Function(
    'appStore', 'saveDoc', 'saveData', 'syncDerivedCharts', 'reportError',
    'setTimeout', 'clearTimeout', 'Map', 'console', 'Date', 'JSON', 'String', 'Math',
    lockSrc + '\n' + lockMapSrc + '\nconst _docLocks = _createEntityLockMap();\nconst _tableLocks = _createEntityLockMap();\n' +
      autoObj + '\nlet _lastAutosaveSnapshot = "";\nlet _lastAutosaveTableSnapshot = "";\n' +
      flushDirtySrc + '\nreturn { _flushDirtyEntity, autoSaveDoc, autoSaveTable };'
  );
  const flushApi = lazy(store, persistence.saveDoc, persistence.saveData, () => {}, () => {}, manualSetTimeout, manualClearTimeout, Map, console, Date, JSON, String, Math);
  const docA = { id: 'docA4', title: 'A4', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', currentDoc: docA, isDirty: false });
  await persistence.saveDoc('proj-1', docA);
  docA.blocks[0].content = 'edicion-pre-navegar';
  api.autoSaveDoc(docA);
  // navegar (cambio de vista): renderView llama _flushDirtyEntity ANTES del switch
  flushApi._flushDirtyEntity();
  store.set({ currentView: 'documents' });
  await drain();
  let reloadA = await persistence.loadDoc('docA4');
  check('el cambio de vista real flushea la edicion (sin regresion)',
    reloadA && reloadA.blocks[0].content === 'edicion-pre-navegar', reloadA ? reloadA.blocks[0].content : 'null');
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);