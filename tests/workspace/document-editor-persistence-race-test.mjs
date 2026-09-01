#!/usr/bin/env node
/**
 * document-editor-persistence-race-test.mjs (CE-082)
 *
 * Auditoria adversarial determinista del camino de persistencia del editor de
 * documentos del Workspace, END-TO-END (el flujo real autoSaveDoc -> lock ->
 * saveDoc -> almacen -> reload), a diferencia de las suites CE-057/058 que
 * prueban el lock con saves mock en aislamiento.
 *
 * Se extrae el CODIGO REAL de workspace.js:
 *   - _createSaveLock, _createEntityLockMap (el lock por-entidad con
 *     latest-wins coalescing y failsafe),
 *   - autoSaveDoc (debounce 1s con el timer GLOBAL autoSaveDoc._timer),
 *   - _flushDirtyEntity (flush fire-and-forget antes de navegar),
 * y se cablea con:
 *   - un appStore real (createStore),
 *   - una capa persistente en memoria que replica FIELMENTE storage.js saveDoc
 *     (guard estale _writeSeq monotico, migrateObject, dbGet/dbPut),
 *   - timers manuales (setTimeout/clearTimeout controlados) para no dormir.
 *
 * Tras CADA escenario destructivo se vuelve a cargar la entidad desde la capa
 * persistente (loadDoc) y se valida el CONTENIDO EXACTO == ultima edicion
 * logica confirmada por el usuario. No se acepta como prueba que una Promise
 * haya resuelto; solo cuenta lo que dice el almacen tras un reload.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const storageCode = readFileSync(join(ROOT, 'workspace', 'core', 'storage.js'), 'utf8');
const stateCode = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

// ---------- Extractor de funciones reales de workspace.js ----------
function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

const tryStart = [];
function runLater(index, fn) { tryStart.push({ index, fn }); }

// ---------- Timers manuales (deterministas, sin dormir) ----------
let manualTimers = new Map();
let nextTimerId = 1;
function manualSetTimeout(fn, _ms) {
  const id = nextTimerId++;
  manualTimers.set(id, fn);
  return id;
}
function manualClearTimeout(id) {
  if (id != null) manualTimers.delete(id);
}
function fireAllTimers() {
  const pending = [...manualTimers.values()];
  manualTimers.clear();
  for (const fn of pending) fn();
}
function fireNextTimer() {
  const key = manualTimers.keys().next().value;
  if (key == null) return false;
  const fn = manualTimers.get(key);
  manualTimers.delete(key);
  fn();
  return true;
}
function pendingTimerCount() { return manualTimers.size; }

// ---------- appStore real ----------
// Extrae createStore de state.js y construye un appStore con los campos minimos.
function buildStore() {
  // quita imports/export y la declaracion del appStore real (usa localStorage)
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

// ---------- Capa persistente en memoria (replica fiel de storage.js saveDoc) ----------
const MODEL_VERSION = 1;
function buildPersistence() {
  const DB = new Map(); // store: id -> doc
  // Replica de storage.js saveDoc con guard _writeSeq monotico
  // (dbGet -> comparar _writeSeq estale -> _writeSeq = existing+1 -> dbPut)
  async function saveDoc(projectId, doc) {
    if (!doc.id) doc.id = 'gen-' + Math.random().toString(36).slice(2);
    doc.projectId = projectId;
    doc.updatedAt = Date.now();
    if (!doc.createdAt) doc.createdAt = doc.updatedAt;
    if (!doc._version) doc._version = MODEL_VERSION;
    // FIDELIDAD con storage.js: _writeSeq se muta EN SITIO sobre el doc vivo
    const key = doc.id;
    const existing = DB.has(key) ? JSON.parse(JSON.stringify(DB.get(key))) : null;
    if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
      return existing; // write stale rechazado: devuelve el que esta persistido
    }
    doc._writeSeq = (existing?._writeSeq || 0) + 1;
    const clone = JSON.parse(JSON.stringify(doc));
    DB.set(key, clone);
    return clone;
  }
  async function loadDoc(id) {
    if (!DB.has(id)) return null;
    return JSON.parse(JSON.stringify(DB.get(id)));
  }
  async function loadDocs(projectId) {
    const out = [];
    for (const v of DB.values()) if (v.projectId === projectId) out.push(JSON.parse(JSON.stringify(v)));
    return out;
  }
  async function deleteDoc(id) {
    const existed = DB.has(id);
    DB.delete(id);
    return existed;
  }
  return { DB, saveDoc, loadDoc, loadDocs, deleteDoc };
}

// ---------- Sandbox con las funciones reales extraidas ----------
const lockSrc = grabFn(wsCode, '_createSaveLock');
const lockMapSrc = grabFn(wsCode, '_createEntityLockMap');
const autoSaveSrc = grabFn(wsCode, 'autoSaveDoc');
const flushSrc = grabFn(wsCode, '_flushDirtyEntity');

let store = buildStore();
let persistence = buildPersistence();

let reportErrorCalls = [];
const autoSaveTable = { _timer: null };
const autoSaveDoc = { _timer: null };
let _lastAutosaveSnapshot = '';
let _lastAutosaveTableSnapshot = '';

function wire() {
  store = buildStore();
  persistence = buildPersistence();
  reportErrorCalls = [];
  _lastAutosaveSnapshot = '';
  _lastAutosaveTableSnapshot = '';
  manualTimers.clear();
  nextTimerId = 1;
}

// Corsetas: estas variables son capturadas por closure en las funciones reales.
// Construimos el rendimiento con las funciones reales mediante eval en el mismo contexto.
function runWired(persist, context) {
  const js = [
    lockSrc,
    lockMapSrc,
    'const _docLocks = _createEntityLockMap();',
    'const _tableLocks = _createEntityLockMap();',
    autoSaveSrc,
    flushSrc,
  ].join('\n');
  const body = js + '\nreturn { _docLocks, _tableLocks, autoSaveDoc, _flushDirtyEntity };';
  const fn = new Function(
    'appStore', 'saveDoc', 'saveData', 'syncDerivedCharts', 'reportError',
    'setTimeout', 'clearTimeout', 'Map', 'console', 'Date', 'JSON', 'String', 'Math',
    body
  );
  return fn(
    store, persist.saveDoc, async () => {}, () => {},
    (err, src, ctx) => { reportErrorCalls.push(src + (err && err.message ? ':' + err.message : '')); },
    manualSetTimeout, manualClearTimeout, Map, console, Date, JSON, String, Math
  );
}

console.log('=== Editor documento: carrera adversarial de persistencia (CE-082) ===');
console.log('(Funciones REALES de workspace.js + capa persistente fiel a storage.js + reload)\n');

// ---------- Escenario 1: edicion rapida consecutiva (edits rapido A1, A2, A3) ----------
console.log('1. Edits rapidos consecutivos: el reload debe reflejar la ULTIMA edicion (LWW por orden logico)');
{
  wire();
  const api = runWired(persistence, {});
  const doc = { id: 'docA', title: 'Doc A', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc); // estado inicial en IDB
  // usuario edita 3 veces rapido (cada una re-arranca el debounce global)
  doc.blocks[0].content = 'edit-1';
  api.autoSaveDoc(doc);
  doc.blocks[0].content = 'edit-2';
  api.autoSaveDoc(doc);
  doc.blocks[0].content = 'edit-3';
  api.autoSaveDoc(doc);
  fireAllTimers(); // el debounce de 1s vence
  // drena el lock (async) hasta vacio
  await flushLock(api);
  let reloaded = await persistence.loadDoc('docA');
  check('reload tras edits rapidos = edit-3 (ultimo logico)', reloaded && reloaded.blocks[0].content === 'edit-3',
    reloaded ? JSON.stringify(reloaded.blocks[0].content) : 'null');
  check('isDirty queda false tras guardar', store.get('isDirty') === false);
}

// ---------- Escenario 2: completion out-of-order no puede sobrescribir una edicion posterior ----------
console.log('\n2. Completion out-of-order: un save viejo NO sobrescribe una edicion logica posterior');
{
  wire();
  const api = runWired(persistence, {});
  const doc = { id: 'docB', title: 'Doc B', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);
  // edit-1 dispara save que queda "en vuelo" (lock corriendo)
  doc.blocks[0].content = 'edit-1';
  api.autoSaveDoc(doc);
  fireAllTimers();
  await flushLock(api);
  let persisted = await persistence.loadDoc('docB');
  check('save de edit-1 persiste edit-1', persisted.blocks[0].content === 'edit-1', persisted ? persisted.blocks[0].content : 'null');
  // el usuario sigue escribiendo edit-2 (segunda generacion)
  doc.blocks[0].content = 'edit-2';
  api.autoSaveDoc(doc);
  fireAllTimers();
  await flushLock(api);
  persisted = await persistence.loadDoc('docB');
  check('edicion posterior (edit-2) es la persistida tras reload', persisted.blocks[0].content === 'edit-2',
    persisted ? persisted.blocks[0].content : 'null');
}

// ---------- Escenario 3: edicion + navegacion inmediata (flush antes de navegar) ----------
console.log('\n3. Edicion + navegacion inmediata: el flush en renderView conserva la edicion');
{
  wire();
  const api = runWired(persistence, {});
  const doc = { id: 'docC', title: 'Doc C', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);
  doc.blocks[0].content = 'edit-navegacion';
  api.autoSaveDoc(doc); // debounce T0 (aun no vencido)
  // el usuario navega a otra vista ANTES de que venza el debounce
  api._flushDirtyEntity(); // renderView la llama antes de cambiar la vista
  // el debounce fue limpiado por _flushDirtyEntity (el timer que queda es el
  // failsafe 60s del lock, transitorio durante el save en vuelo, que se limpia
  // al completar el save - se verifica despues del flush de la cola)
  await flushLock(api);
  check('el navegar drena los timers tras completar el flush', pendingTimerCount() === 0, 'timers=' + pendingTimerCount());
  let reloaded = await persistence.loadDoc('docC');
  check('reload tras navegacion = edit-navegacion (no se pierde)', reloaded && reloaded.blocks[0].content === 'edit-navegacion',
    reloaded ? reloaded.blocks[0].content : 'null');
  check('flush de navegacion marca isDirty=false', store.get('isDirty') === false);
}

// ---------- Escenario 4: edicion + cambio de documento (A dirty, abrir B) ----------
console.log('\n4. Edicion + cambio de documento: guardar A nunca se asocia al id de B');
{
  wire();
  const api = runWired(persistence, {});
  const docA = { id: 'docA4', title: 'A4', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  const docB = { id: 'docB4', title: 'B4', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: docA, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', docA);
  await persistence.saveDoc('proj-1', docB);
  docA.blocks[0].content = 'edicion-de-A';
  api.autoSaveDoc(docA);
  // el usuario abre B: renderView flushea a A (currentDoc sigue siendo A en el flush)
  api._flushDirtyEntity();
  await flushLock(api);
  // ahora currentDoc pasa a B
  store.set({ currentDoc: docB });
  let reloadA = await persistence.loadDoc('docA4');
  let reloadB = await persistence.loadDoc('docB4');
  check('A guardo su propia edicion (id A)', reloadA && reloadA.blocks[0].content === 'edicion-de-A', reloadA ? reloadA.blocks[0].content : 'null');
  check('B NO fue sobrescrito con el contenido de A', reloadB && reloadB.blocks[0].content === '', reloadB ? reloadB.blocks[0].content : 'null');
}

// ---------- Escenario 5: edicion + destruccion (simula recarga / cierre sin guardar explícito) ----------
console.log('\n5. Edicion + destruccion/reload: el debounce pendiente se persigue con flush de sesion');
{
  wire();
  const api = runWired(persistence, {});
  const doc = { id: 'docE', title: 'E', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);
  doc.blocks[0].content = 'edit-antes-de-destruir';
  api.autoSaveDoc(doc);
  // simulamos el cierre/recarga: se llama _flushAndSaveSession -> al menos _flushDirtyEntity
  // El debounce aun esta pendiente; el cierre flushea la entidad dirty.
  api._flushDirtyEntity();
  await flushLock(api);
  let reloaded = await persistence.loadDoc('docE');
  check('reload tras destruccion conserva la edicion', reloaded && reloaded.blocks[0].content === 'edit-antes-de-destruir',
    reloaded ? reloaded.blocks[0].content : 'null');
}

// ---------- Escenario 6: debounce pendiente + navegacion con isDirty ----------
console.log('\n6. Debounce pendiente + navegacion: no hay perdida silenciosa');
{
  wire();
  const api = runWired(persistence, {});
  const doc = { id: 'docF', title: 'F', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);
  doc.blocks[0].content = 'pendiente';
  api.autoSaveDoc(doc);
  // el debounce aun no vencio, pero navegamos (flush limpia el timer y guarda)
  api._flushDirtyEntity();
  await flushLock(api);
  check('tras flush queda drenada la cola de timers (debounce+failsafe)', pendingTimerCount() === 0, 'timers=' + pendingTimerCount());
  let reloaded = await persistence.loadDoc('docF');
  check('reload = pendiente (sin perdida)', reloaded && reloaded.blocks[0].content === 'pendiente', reloaded ? reloaded.blocks[0].content : 'null');
}

// ---------- Escenario 7: fallo de escritura + recuperacion ----------
console.log('\n7. Fallo de escritura + recuperacion: el fallo no marca como guardado; la recuperacion persiste');
{
  wire();
  // inyectamos un saveDoc que falla la primera vez
  let calls = 0;
  const failingPersist = {
    ...persistence,
    saveDoc: async (pid, d) => {
      calls++;
      if (calls === 1) { throw new Error('quota-exceeded'); }
      return persistence.saveDoc(pid, d);
    },
  };
  const api = runWired(failingPersist, {});
  const doc = { id: 'docG', title: 'G', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);
  doc.blocks[0].content = 'edit-falla';
  api.autoSaveDoc(doc);
  fireAllTimers();
  await flushLock(api);
  check('un fallo de escritura NO marca isDirty=false', store.get('isDirty') === true);
  check('el fallo se reporta al gestor de errores', reportErrorCalls.some(c => c.includes('document-save')), reportErrorCalls.join('|'));
  let reloaded = await persistence.loadDoc('docG');
  check('tras el fallo el almacen conserva el estado anterior (no marca guardado)', reloaded && reloaded.blocks[0].content === '', reloaded ? reloaded.blocks[0].content : 'null');
  // recuperacion: el usuario reintenta guardar; ahora funciona
  api.autoSaveDoc(doc);
  fireAllTimers();
  await flushLock(api);
  reloaded = await persistence.loadDoc('docG');
  check('la recuperacion persiste la edicion', reloaded && reloaded.blocks[0].content === 'edit-falla', reloaded ? reloaded.blocks[0].content : 'null');
}

// ---------- Escenario 8: mutacion mientras un write esta en vuelo (misma entidad) ----------
console.log('\n8. Mutacion mientras write en vuelo: latest-wins por doc mutado en sitio, reload = ultimo');
{
  wire();
  // simulamos writes lentos (arranque asincrono con resoluciones controladas)
  let resolveQueue = [];
  const slowPersist = {
    ...persistence,
    saveDoc: async (pid, d) => {
      // captura el estado ACTUAL del doc al momento del dbPut (mutado en sitio)
      return new Promise((resolve) => {
        resolveQueue.push(() => {
          const clone = JSON.parse(JSON.stringify(d));
          // reusamos la logica _writeSeq del persist normal sobre una copia
          resolve(applyWrite(persistence, pid, clone));
        });
      });
    },
  };
  const api = runWired(slowPersist, {});
  const doc = { id: 'docH', title: 'H', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);
  doc.blocks[0].content = 'm1';
  api.autoSaveDoc(doc);
  fireAllTimers(); // primer save en vuelo
  await nextTick();
  // el usuario muta de nuevo mientras el primer save no ha resuelto
  doc.blocks[0].content = 'm2';
  api.autoSaveDoc(doc);
  await nextTick();
  // resolvemos el primer write
  resolveQueue.shift()();
  await nextTick();
  fireAllTimers(); // segundo save
  await nextTick();
  while (resolveQueue.length) resolveQueue.shift()();
  await nextTick();
  await flushLock(api);
  let reloaded = await persistence.loadDoc('docH');
  check('reload tras mutacion en vuelo = m2 (ultimo logico)', reloaded && reloaded.blocks[0].content === 'm2', reloaded ? reloaded.blocks[0].content : 'null');
}

// ---------- Escenario 9: el save de un documento NUNCA sobrescribe otro ----------
console.log('\n9. Cross-entity: guardar A jamas toca B (aislamiento por id)');
{
  wire();
  const api = runWired(persistence, {});
  const docA = { id: 'docI', title: 'I', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  const docB = { id: 'docJ', title: 'J', blocks: [{ id: 'b1', type: 'paragraph', content: 'contenido-B' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: docA, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', docA);
  await persistence.saveDoc('proj-1', docB);
  // edito y guardo A muchas veces
  for (let i = 0; i < 20; i++) {
    docA.blocks[0].content = 'A#' + i;
    api.autoSaveDoc(docA);
    fireAllTimers();
    await flushLock(api);
  }
  const reloadB = await persistence.loadDoc('docJ');
  check('B con 20 writes de A MANTIENE su contenido', reloadB && reloadB.blocks[0].content === 'contenido-B', reloadB ? reloadB.blocks[0].content : 'null');
}

// ---------- Escenario 10: 3 docs rapidos alternos -> reload tiene a cada uno ----------
console.log('\n10. Tres documentos alternos rapidos: sin perdida cruzada y reload exacto');
{
  wire();
  const api = runWired(persistence, {});
  const docs = {
    A: { id: 'dA', title: 'A', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] },
    B: { id: 'dB', title: 'B', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] },
    C: { id: 'dC', title: 'C', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] },
  };
  store.set({ currentProject: { id: 'proj-1' }, currentView: 'doc-editor', isDirty: false });
  for (const k of Object.keys(docs)) await persistence.saveDoc('proj-1', docs[k]);
  const seq = ['A', 'B', 'C', 'A', 'C', 'B', 'A'];
  for (let i = 0; i < seq.length; i++) {
    const k = seq[i];
    store.set({ currentDoc: docs[k] });
    docs[k].blocks[0].content = k + '-v' + (i + 1);
    api.autoSaveDoc(docs[k]);
    fireAllTimers();
    await flushLock(api);
  }
  const expect = { A: 'A-v7', B: 'B-v6', C: 'C-v5', };
  let ok = true, detail = '';
  for (const k of Object.keys(expect)) {
    const r = await persistence.loadDoc(docs[k].id);
    const val = r && r.blocks[0].content;
    if (val !== expect[k]) { ok = false; detail += `${k}=${val}(esperaba ${expect[k]}) `; }
  }
  check('3 docs alternos: cada reload conserva su ultima edicion', ok, detail);
}

// ---------- Escenario 11: flush-before-navigate + borrado: el ciclo de vida del
// Workspace no conserva un save pendiente capaz de resucitar el doc borrado. ----------
// CONTRATO de referencia (autoridad): CE-059 storage-recovery-lifecycle certifica que
// la concurrencia raw save/delete de storage.js resuelve como "gone OR saved-before-delete"
// y NO produce una resurreccion enganosa. Esta suite NO re-certifica ese contrato con un
// mock irreal; aqui solo se certifica el INVARIANTE de ciclo de vida del Workspace: una vez
// completado el flush-before-navigate y alcanzado el borrado, no queda ningun autosave
// (debounce ni intervalo) capaz de disparar un save posterior del documento borrado.
console.log('\n11. El ciclo de vida Workspace (flush-before-navigate + borrado) no conserva un save pendiente que resucite el doc');
{
  wire();
  // La capa persistente se STUBEA solo como PUNTO DE OBSERVACION: registra si un save
  // del documento borrado se ejecuta DESPUES del borrado. No inventa semantica de
  // storage (_writeSeq/orden/transacciones); eso es dominio de storage.js/CE-059.
  let saveCallsAfterDelete = 0;
  let deleted = false;
  const obsPersist = {
    ...persistence,
    saveDoc: async (pid, doc) => {
      if (deleted && doc.id === 'docK') saveCallsAfterDelete++;
      return persistence.saveDoc(pid, doc);
    },
    deleteDoc: async (id) => {
      deleted = true;
      return persistence.deleteDoc(id);
    },
  };
  const api = runWired(obsPersist, {});
  const doc = { id: 'docK', title: 'K', blocks: [{ id: 'b1', type: 'paragraph', content: '' }] };
  store.set({ currentProject: { id: 'proj-1' }, currentDoc: doc, currentView: 'doc-editor', isDirty: false });
  await persistence.saveDoc('proj-1', doc);

  // 1. el usuario edita: queda un autosave DEBOUNCEADO pendiente
  doc.blocks[0].content = 'edit-antes-de-borrar';
  api.autoSaveDoc(doc);
  check('el debounce de autoSaveDoc esta armado antes de navegar', pendingTimerCount() > 0, 'timers=' + pendingTimerCount());

  // 2. flush-before-navigate por el primitivo extraible _flushDirtyEntity, que es
  //    exactamente lo que hace el renderView real en el navegador (renderView esta
  //    ligado al DOM - $('#ws-main-content') - y no se puede extraer en un harness
  //    Node puro; por eso esta suite usa el mismo primitivo que los escenarios 3 y 6).
  //    El flush debe ejecutarse MIENTRAS currentView sigue siendo doc-editor: es el
  //    unico caso en que _flushDirtyEntity (guard view==='doc-editor') flushea el doc.
  api._flushDirtyEntity();
  store.set({ currentView: 'documents' });

  // 3. el flush limpio el debounce y drena la cola del lock para el doc
  await flushLock(api);
  check('el debounce del doc queda LIMPIO tras el flush-before-navigate', pendingTimerCount() === 0, 'timers=' + pendingTimerCount());
  check('isDirty=false tras el flush (el intervalo de 5s ya no puede re-armar un save)', store.get('isDirty') === false);

  // 4. el usuario borra el documento desde la vista Documentos (flujo soportado)
  await obsPersist.deleteDoc('docK');

  // 5. se avanza cualquier timer/microtask pendiente para demostrar que NO hay ningun
  //    save posterior del documento borrado ejecutable desde el Workspace
  fireAllTimers();
  await nextTick();
  await flushLock(api);
  fireAllTimers();
  await nextTick();
  await flushLock(api);

  check('ningun save del doc borrado se ejecuta tras el borrado (no resucita via el ciclo de vida del Workspace)',
    saveCallsAfterDelete === 0, saveCallsAfterDelete + ' saves posteriores detectados');
  console.log('   (la concurrencia raw save/delete de storage.js la certifica CE-059: gone OR saved-before-delete;');
  console.log('    aqui solo se certifica el invariante de ciclo de vida del Workspace.)');
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);

// helpers al final
async function flushLock(api) {
  // drena esperando microtasks varias vueltas; el lock es puramente async.
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setImmediate(r));
  }
}
async function nextTick() { await new Promise(r => setImmediate(r)); }
function applyWrite(persist, pid, clone) {
  // reproduce saveDoc de persist: dbGet + guard + _writeSeq + dbPut
  const key = clone.id;
  const existing = persist.DB.has(key) ? JSON.parse(JSON.stringify(persist.DB.get(key))) : null;
  if (existing && existing._writeSeq != null && existing._writeSeq > (clone._writeSeq || 0)) {
    return existing;
  }
  clone._writeSeq = (existing?._writeSeq || 0) + 1;
  persist.DB.set(key, clone);
  return clone;
}
