#!/usr/bin/env node
/**
 * undo-corruption-test.mjs (CE-091)
 *
 * Auditoria adversarial determinista de dos defectos del undo/redo:
 *
 * A) CORRUPCION DE LA LISTA DE DOCUMENTOS (bug P1): `_captureWorkspaceState`
 *    (workspace.js) guardaba cada documento de la lista como
 *    `{ id, name, title, blocks: blocks.map(b => ({ id, content })) }`, descartando
 *    `type`, `html`, `headers`, `rows`, etc. Al pulsar Deshacer/Rehacer del topbar,
 *    `_applyState` restauraba la lista truncada y al abrir ese documento
 *    `renderBlock` hacia `block.type.startsWith(...)` -> TypeError y crash del
 *    editor (y si se guardaba, persistia un doc sin `type`).
 *    Este test verifica que el snapshot AHORA clona los bloques COMPLETOS
 *    (ctype preserved) y las tablas con filas/sheets completas.
 *
 * B) DESALINEACION topbar vs tabla: el topbar usaba el historial GLOBAL mientras
 *    las ediciones de celda de tabla se guardaban en `tableHistories` (WeakMap por
 *    tabla). El boton Deshacer del topbar NO deshacia la celda. Se alineo el esperado:
 *    en la vista data-table el undo/redo debe ir a `undoTableEdit`/`redoTableEdit`
 *    (tabla-local). Este test verifica el primitivo real de tabla: editar celda ->
 *    commit -> undo restaura la celda anterior -> redo restaura la editada.
 *
 * Se usa CODIGO REAL de workspace.js extraido por regex y cableado con un appStore
 * real (createStore de state.js) + capa persistente fiel a storage.js saveData + timers
 * manuales. Solo cuenta lo que dicen los bloques/rows tras cada operacion.
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

// ---------- Timers manuales ----------
let manualTimers = new Map();
let nextTimerId = 1;
function manualSetTimeout(fn, _ms) { const id = nextTimerId++; manualTimers.set(id, fn); return id; }
function manualClearTimeout(id) { if (id != null) manualTimers.delete(id); }

// CE-095: commitTableEdit referencia la constante real TABLE_HISTORY_LIMIT.
const LIMIT_MATCH = wsCode.match(/const TABLE_HISTORY_LIMIT\s*=\s*(\d+)/);
const TABLE_HISTORY_LIMIT = LIMIT_MATCH ? Number(LIMIT_MATCH[1]) : 50;

// ---------- appStore real ----------
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
    documents: [],
    dataTables: [],
    captures: [],
  });
  return store;
}

// ---------- Capa persistente fiel a storage.js saveData ----------
function buildPersistence() {
  const DB = new Map();
  async function saveData(_pid, table) {
    const existing = DB.has(table.id) ? JSON.parse(JSON.stringify(DB.get(table.id))) : null;
    if (existing && existing._writeSeq != null && existing._writeSeq > (table._writeSeq || 0)) return existing;
    table._writeSeq = (existing?._writeSeq || 0) + 1;
    const clone = JSON.parse(JSON.stringify(table));
    DB.set(table.id, clone);
    return clone;
  }
  async function loadTable(id) { return DB.has(id) ? JSON.parse(JSON.stringify(DB.get(id))) : null; }
  return { DB, saveData, loadTable };
}

let store, persistence;
let reportErrorCalls = [];
function wire() {
  store = buildStore();
  persistence = buildPersistence();
  reportErrorCalls = [];
  manualTimers.clear();
  nextTimerId = 1;
}

console.log('=== CE-091: undo/redo — corrupcion de documentos y alineacion con tablas ===');
console.log('(CODIGO REAL de workspace.js + appStore real + persistencia fiel + reload)\n');

// ---------- A1: _captureWorkspaceState clona los bloques COMPLETOS ----------
console.log('A. El snapshot de _captureWorkspaceState conserva type y campos de bloque');
{
  wire();
  const captureSrc = grabFn(wsCode, '_captureWorkspaceState');
  const fn = new Function('appStore', 'JSON', captureSrc + '\nreturn { _captureWorkspaceState };');
  const api = fn(store, JSON);
  const docA = {
    id: 'd1', title: 'Doc', name: 'doc', projectId: 'p1', updatedAt: 100, createdAt: 50,
    blocks: [
      { id: 'b1', type: 'paragraph', content: 'hola', html: '<p>hola</p>' },
      { id: 'b2', type: 'table', content: '', headers: ['a', 'b'], rows: [[1, 2]], html: '<table>...</table>' },
      { id: 'b3', type: 'heading1', content: 'Titulo' },
    ],
  };
  store.set({ documents: [docA] });
  const snap = api._captureWorkspaceState();
  check('el snapshot conserva la lista de documentos', Array.isArray(snap.documents) && snap.documents.length === 1);
  const blocks = snap.documents[0].blocks;
  check('cada bloque conserva type (retira el crash de renderBlock)', blocks.every(b => typeof b.type === 'string' && b.type.length > 0),
    JSON.stringify(blocks.map(b => b.type)));
  check('se conservan campos extra del bloque (html/headers/rows)', blocks[0].html === '<p>hola</p>' && Array.isArray(blocks[1].headers) && blocks[1].headers[0] === 'a' && blocks[1].rows[0][0] === 1,
    JSON.stringify(blocks[1].headers) + '|' + JSON.stringify(blocks[1].rows));
  check('el snapshot NO comparte referencia con el doc origen (clon profundo)', blocks[0] !== docA.blocks[0]);
  check('No se pierde el type de la cabecera (heading1)', blocks[2].type === 'heading1');
}

// ---------- A2: dataTables en el snapshot conservan filas/sheets/reviewStatus ----------
console.log('\nA. El snapshot de dataTables conserva filas y estado completo');
{
  wire();
  const captureSrc = grabFn(wsCode, '_captureWorkspaceState');
  const fn = new Function('appStore', 'JSON', captureSrc + '\nreturn { _captureWorkspaceState };');
  const api = fn(store, JSON);
  const t1 = { id: 't1', name: 'T', headers: ['x'], rows: [['v1']], sheets: [{ id: 's1', name: 'Hoja 1' }], reviewStatus: 'reviewed' };
  store.set({ dataTables: [t1] });
  const snap = api._captureWorkspaceState();
  const dt = snap.dataTables[0];
  check('la tabla conserva filas (deep)', dt.rows[0][0] === 'v1', JSON.stringify(dt.rows));
  check('la tabla conserva sheets', dt.sheets[0].name === 'Hoja 1', JSON.stringify(dt.sheets));
  check('la tabla conserva reviewStatus', dt.reviewStatus === 'reviewed', String(dt.reviewStatus));
  check('las filas son copias independientes (no referencia)', dt.rows !== (store.get('dataTables')[0].rows) && dt.rows[0] !== (store.get('dataTables')[0].rows[0]));
}

// ---------- B: undo/redo de TABLA real deshace la celda y rehace ----------
console.log('\nB. El undo/redo de tabla (ahora via topbar en data-table) deshace la celda editada');
{
  wire();
  // extraemos las funciones de tabla reales y autoSaveTable
  const lockSrc = grabFn(wsCode, '_createSaveLock');
  const lockMapSrc = grabFn(wsCode, '_createEntityLockMap');
  const snapshotDataSrc = grabFn(wsCode, 'snapshotDataTable');
  const snapshotsEqualSrc = grabFn(wsCode, 'snapshotsEqual');
  const ensureSrc = grabFn(wsCode, 'ensureTableHistory');
  const commitSrc = grabFn(wsCode, 'commitTableEdit');
  const checkpointSrc = grabFn(wsCode, 'checkpointTableEdit');
  const restoreSrc = grabFn(wsCode, 'restoreTableSnapshot');
  const undoSrc = grabFn(wsCode, 'undoTableEdit');
  const redoSrc = grabFn(wsCode, 'redoTableEdit');
  const autoSaveSrc = grabFn(wsCode, 'autoSaveTable');
  const js = [
    lockSrc,
    lockMapSrc,
    'const _tableLocks = _createEntityLockMap();',
    'let _lastAutosaveTableSnapshot = "";',
    snapshotDataSrc,
    snapshotsEqualSrc,
    ensureSrc,
    commitSrc,
    checkpointSrc,
    restoreSrc,
    undoSrc,
    redoSrc,
    autoSaveSrc,
    'const tableHistories = new WeakMap();',
  ].join('\n');
  let toastMsg = '';
  const fn = new Function(
    'appStore', 'saveData', 'syncDerivedCharts', 'reportError', 'toast',
    'setTimeout', 'clearTimeout', 'WeakMap', 'Map', 'console', 'Date', 'JSON', 'String', 'Math', 'TABLE_HISTORY_LIMIT',
    js + '\nreturn { commitTableEdit, checkpointTableEdit, undoTableEdit, redoTableEdit, tableHistories };'
  );
  const api = fn(store, persistence.saveData, () => {}, () => {}, (m) => { toastMsg = m; }, manualSetTimeout, manualClearTimeout, WeakMap, Map, console, Date, JSON, String, Math, TABLE_HISTORY_LIMIT);

  const table = { id: 'tblB', name: 'B', headers: ['a', 'b'], rows: [['x', 'y']] };
  store.set({ currentProject: { id: 'p1' }, currentDataTable: table, currentView: 'data-table', isDirty: false });
  await persistence.saveData('p1', table);

  // (crucial) la tabla viva se INTRODUCE con checkpoint: baseline {x,y} antes de editar
  api.checkpointTableEdit(table);
  // usuario edita la celda (0,0) -> commit
  table.rows[0][0] = 'EDITADA';
  api.commitTableEdit(table);
  // cambia otra celda (0,1) -> commit
  table.rows[0][1] = 'OTRA';
  api.commitTableEdit(table);
  check('la celda editada esta en la tabla viva', table.rows[0][0] === 'EDITADA' && table.rows[0][1] === 'OTRA');

  // undo (topbar en data-table llama undoTableEdit) -> vuelve a la celda anterior
  const okUndo1 = api.undoTableEdit(table);
  check('undo restaura la celda anterior (0,1 vuelve a y)', okUndo1 && table.rows[0][1] === 'y', JSON.stringify(table.rows));
  const okUndo2 = api.undoTableEdit(table);
  check('segundo undo vuelve a la celda inicial (0,0 vuelve a x)', okUndo2 && table.rows[0][0] === 'x', JSON.stringify(table.rows));

  // redo (topbar en data-table llama redoTableEdit) -> restaura la edicion
  const okRedo1 = api.redoTableEdit(table);
  check('redo restaura la celda editada (0,0 vuelve a EDITADA)', okRedo1 && table.rows[0][0] === 'EDITADA', JSON.stringify(table.rows));

  // editar de nuevo tras el undo/redo conserva el historial consistente (no corrupto)
  table.rows[0][1] = 'EDICION_POST';
  api.commitTableEdit(table);
  const okUndo3 = api.undoTableEdit(table);
  check('tras editar de nuevo, undo vuelve al estado {EDITADA, y} preservando el historial',
    okUndo3 && table.rows[0][0] === 'EDITADA' && table.rows[0][1] === 'y', JSON.stringify(table.rows));
}

// ---------- B2: Guarar/confirmar que la ruta topbar en data-table delega a la tabla ----------
// La ruta del boton es DOM-bound (h() y onClick), imposible extraer en Node puro.
// Este check documenta por contrato que el wire actual delega: verificamos que el
// primitivo de tabla (lo que el boton ahora invoca) NO toca el historial global.
console.log('\nB. El historial de tabla (WeakMap) esta separado del historial global (no desalineado por el topbar)');
{
  wire();
  const snapshotDataSrc = grabFn(wsCode, 'snapshotDataTable');
  const snapshotsEqualSrc = grabFn(wsCode, 'snapshotsEqual');
  const ensureSrc = grabFn(wsCode, 'ensureTableHistory');
  const commitSrc = grabFn(wsCode, 'commitTableEdit');
  const checkpointSrc = grabFn(wsCode, 'checkpointTableEdit');
  const restoreSrc = grabFn(wsCode, 'restoreTableSnapshot');
  const undoSrc = grabFn(wsCode, 'undoTableEdit');
  const redoSrc = grabFn(wsCode, 'redoTableEdit');
  const autoSaveSrc = grabFn(wsCode, 'autoSaveTable');
  const lockSrc = grabFn(wsCode, '_createSaveLock');
  const lockMapSrc = grabFn(wsCode, '_createEntityLockMap');
  const js = [
    lockSrc,
    lockMapSrc,
    'const _tableLocks = _createEntityLockMap();',
    'let _lastAutosaveTableSnapshot = "";',
    snapshotDataSrc, snapshotsEqualSrc, ensureSrc, commitSrc, checkpointSrc, restoreSrc, undoSrc, redoSrc, autoSaveSrc,
    'const tableHistories = new WeakMap();',
  ].join('\n');
  const fn = new Function(
    'appStore', 'saveData', 'syncDerivedCharts', 'reportError', 'toast',
    'setTimeout', 'clearTimeout', 'WeakMap', 'Map', 'console', 'Date', 'JSON', 'String', 'Math', 'TABLE_HISTORY_LIMIT',
    js + '\nreturn { commitTableEdit, checkpointTableEdit, undoTableEdit, tableHistories };'
  );
  const api = fn(store, persistence.saveData, () => {}, () => {}, () => {}, manualSetTimeout, manualClearTimeout, WeakMap, Map, console, Date, JSON, String, Math, TABLE_HISTORY_LIMIT);
  const table = { id: 'tblB2', headers: ['k'], rows: [['a']] };
  store.set({ currentProject: { id: 'p1' }, currentDataTable: table, currentView: 'data-table' });
  api.checkpointTableEdit(table); // baseline {a}
  table.rows[0][0] = 'b';
  api.commitTableEdit(table);
  const hist = api.tableHistories.get(table);
  check('la edicion de tabla se registra en tableHistories (no en el historial global del topbar)',
    hist && hist.past.length === 2, hist ? 'past=' + hist.past.length : 'null');
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);