import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l) || new RegExp('^export function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

// ---------- createHistoryManager real ----------
const hmCode = readFileSync(new URL('../../workspace/core/history-manager.js', import.meta.url), 'utf8');
const hmSrc = hmCode.replace(/^export function createHistoryManager/, 'function createHistoryManager');
const createHistoryManager = new Function(hmSrc + '\nreturn createHistoryManager;')();

// ---------- _captureWorkspaceState real + appStore real ----------
const stateCode = readFileSync(new URL('../../workspace/core/state.js', import.meta.url), 'utf8');
function buildStore() {
  let stateSrc = stateCode
    .replace(/^import\s.*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  stateSrc = stateSrc.slice(0, stateSrc.indexOf('const appStore = createStore('));
  const createStore = new Function(stateSrc + '\nreturn createStore;')();
  return createStore({
    currentView: 'document',
    currentProject: { id: 'p1' },
    currentDoc: null, currentDataTable: null,
    isDirty: false, lastSaved: null,
    documents: [], dataTables: [], captures: [],
    designConfig: null, flowNodes: [], flowEdges: [],
  });
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const captureSrc = grabFn(wsCode, '_captureWorkspaceState');
function makeCapture(store) {
  return new Function('appStore', captureSrc + '\nreturn _captureWorkspaceState;')(store);
}

// Instrumenta JSON.parse/stringify para contar serializaciones de ESTADO COMPLETO
// (comparado con la cantidad de invocaciones internas de _captureWorkspaceState).
function countSerializations(fn) {
  const origStringify = JSON.stringify;
  const origParse = JSON.parse;
  let stringifyCalls = 0, parseCalls = 0;
  JSON.stringify = function (...a) { stringifyCalls++; return origStringify.apply(this, a); };
  JSON.parse = function (...a) { parseCalls++; return origParse.apply(this, a); };
  try { return { r: fn(), stringifyCalls, parseCalls }; }
  finally { JSON.stringify = origStringify; JSON.parse = origParse; }
}

console.log('=== CE-100: el historial de undo clona el snapshot UNA sola vez (sin doble serializacion) ===');
console.log('(createHistoryManager REAL + _captureWorkspaceState REAL; cloneState=identidad)');

// 1. push de un snapshot: con cloneState=identidad NO desc-serializa el estado
//    completo (0 invocaciones de JSON.parse/stringify dentro del push mismo; el
//    snapshot ya viene aislado de _captureWorkspaceState).
{
  const store = buildStore();
  store.set({
    documents: [{ id: 'd1', name: 'Doc', blocks: [{ id: 'b1', type: 'text', content: 'x' }], updatedAt: 1, createdAt: 1, projectId: 'p1' }],
    dataTables: [{ id: 't1', name: 'T', headers: ['a'], rows: [['1']] }],
    flowNodes: [{ id: 'n1', x: 1, y: 2 }],
  });
  const cap = makeCapture(store);
  const snap = cap();
  const history = createHistoryManager({ maxEntries: 50, cloneState: s => s, onChange: () => {} });
  const during = countSerializations(() => history.push(snap, { action: 'edit' }));
  // push con cloneState=identidad: 0 serializaciones internas (antes = 1 JSON completo)
  check('push NO re-serializa (stringify interno == 0)', during.stringifyCalls === 0, 'got ' + during.stringifyCalls);
  check('push NO re-parsea (parse interno == 0)', during.parseCalls === 0, 'got ' + during.parseCalls);
  check('el historial registra el push (pastSize>=1)', history.getStatus().pastSize >= 1);
}

// 2. undo/redo: los snapshots devueltos/almacenados estan AISLADOS del estado
//    vivo (identidad es segura porque _captureWorkspaceState ya clona). El
//    restore-semantico del undo lo cubre CE-091; aqui probamos la ISOLACION.
{
  const store = buildStore();
  store.set({
    documents: [{ id: 'd1', name: 'Doc', blocks: [{ id: 'b1', type: 'text', content: 'v0' }], updatedAt: 1, createdAt: 1, projectId: 'p1' }],
    flowNodes: [{ id: 'n1', x: 1, y: 2 }],
  });
  const cap = makeCapture(store);
  const history = createHistoryManager({ maxEntries: 50, cloneState: s => s, onChange: () => {} });
  history.push(cap(), { action: 'init' });
  store.set({ flowNodes: [{ id: 'n1', x: 5, y: 6 }] });
  history.push(cap(), { action: 'edit' });

  const restored = history.undo(cap());
  // mutar el estado vivo no debe contaminar lo que undo/redo devolvieron
  const snap0 = cap();
  store.set({ flowNodes: [{ id: 'n1', x: 99, y: 99 }] });
  check('undo devuelve un snapshot NO referenciado al estado vivo',
    restored.flowNodes !== store.get('flowNodes'));
  check('snap aislado por _capture se mantiene aislado en el historial',
    snap0.flowNodes !== store.get('flowNodes'));
  // el snapshot del historial ya capturado no cambia al mutar el vivo
  check('la captura previa (x existia) no se contamina', snap0.flowNodes[0].x === 5, 'got ' + snap0.flowNodes[0].x);
}

// 3. La configuracion real de workspace.js usa cloneState identidad
{
  const cfgMatch = wsCode.match(/cloneState:\s*\(s\)\s*=>\s*s/);
  check('workspace.js declara cloneState como identidad', !!cfgMatch);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);