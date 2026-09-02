import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

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

// ---------- appStore real (state.js createStore) ----------
const stateCode = readFileSync(new URL('../../workspace/core/state.js', import.meta.url), 'utf8');
function buildStore() {
  let stateSrc = stateCode
    .replace(/^import\s.*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  stateSrc = stateSrc.slice(0, stateSrc.indexOf('const appStore = createStore('));
  const fn = new Function(stateSrc + '\nreturn { createStore };');
  const { createStore } = fn();
  return createStore({
    currentView: 'flow',
    currentProject: { id: 'p1' },
    currentDoc: null,
    currentDataTable: null,
    isDirty: false,
    lastSaved: null,
    documents: [],
    dataTables: [],
    captures: [],
    designConfig: null,
    flowNodes: [],
    flowEdges: [],
  });
}

// ---------- _captureWorkspaceState real de workspace.js ----------
const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const captureSrc = grabFn(wsCode, '_captureWorkspaceState');

console.log('=== CE-097: _captureWorkspaceState clona flowNodes/flowEdges (undo de Flow no corre rompe) ===');
console.log('(funcion REAL de workspace.js + appStore real; el bug: flowNodes/flowEdges por referencia -> undo aliaseado)');

// El helper extrae la funcion real y la une a un appStore concreto
function makeCapture(store) {
  return new Function('appStore', captureSrc + '\nreturn _captureWorkspaceState;')(store);
}

// 1. flujo con NODOS: capturar no debe compartir la referencia con el estado vivo
{
  const store = buildStore();
  const flowNodes = [{ id: 'n1', x: 1, y: 2 }, { id: 'n2', x: 5, y: 6, data: { label: 'A' } }];
  const flowEdges = [{ id: 'e1', source: 'n1', target: 'n2' }];
  store.set({ flowNodes, flowEdges });
  const capFn = makeCapture(store);
  const snap = capFn();

  check('snapshot.flowNodes existe con 2 nodos', Array.isArray(snap.flowNodes) && snap.flowNodes.length === 2);
  check('snapshot.flowNodes NO es la misma referencia que el estado vivo',
    snap.flowNodes !== flowNodes, snap.flowNodes === flowNodes ? 'misma ref' : 'copia');
  check('cada nodo del snapshot NO comparte referencia con el vivo',
    snap.flowNodes[0] !== flowNodes[0]);

  // mutamos el ESTADO VIVO DESPUES de capturar -> el snapshot no debe cambiar
  flowNodes[0].x = 99;
  flowNodes[1].data.label = 'MUTADO';
  flowEdges[0].source = 'n9';

  check('el snapshot conserva el x original del nodo (no aliasado)',
    snap.flowNodes[0].x === 1, 'got ' + snap.flowNodes[0].x);
  check('el snapshot conserva el label original (anidado) del nodo',
    snap.flowNodes[1].data.label === 'A', 'got ' + snap.flowNodes[1].data.label);
  check('el snapshot.flowEdges conserva el source original',
    snap.flowEdges[0].source === 'n1', 'got ' + snap.flowEdges[0].source);
  check('snapshot.flowEdges NO es la misma referencia que el vivo',
    snap.flowEdges !== flowEdges);
}

// 2. sin nodes/edges: retorna arrays vacios (no null)
{
  const store = buildStore();
  store.set({ flowNodes: [], flowEdges: [] });
  const capFn = makeCapture(store);
  const snap = capFn();
  check('sin flowNodes retorna []', Array.isArray(snap.flowNodes) && snap.flowNodes.length === 0);
  check('sin flowEdges retorna []', Array.isArray(snap.flowEdges) && snap.flowEdges.length === 0);
}

// 3. re-capturar tras una mutacion de un nodo no "contamina" la falta de referencia
{
  const store = buildStore();
  const nodes = [{ id: 'n1', x: 1, y: 2 }];
  store.set({ flowNodes: nodes, flowEdges: [] });
  const capFn = makeCapture(store);
  const s1 = capFn();
  nodes[0].x = 42; // el editor muta la misma instancia
  const s2 = capFn(); // segunda captura sobre el mismo estado vivo
  check('la captura nueva refleja el cambio (s2.x=42)', s2.flowNodes[0].x === 42);
  check('la captura antigua NO se contamina (s1.x=1)', s1.flowNodes[0].x === 1, 'got ' + s1.flowNodes[0].x);
  check('s1 y s2 no comparten el mismo nodo', s1.flowNodes[0] !== s2.flowNodes[0]);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);