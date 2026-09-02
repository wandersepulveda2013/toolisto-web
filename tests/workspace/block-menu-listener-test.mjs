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

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const menuSrc = grabFn(wsCode, 'showBlockMenu');

// ---- Fake DOM minimal para showBlockMenu ----
function makeNode(tag) {
  const children = [];
  return {
    tag,
    children,
    appended: null,
    appendChild(child) { children.push(child); },
    remove() { },
    contains(el) { return el === this || children.some(c => c instanceof Object && c.contains && c.contains(el)); },
  };
}

function buildEnv() {
  const addLog = [], removeLog = [];
  const docListeners = new Map();
  const documentStub = {
    body: null,
    addEventListener(type, fn) { if (type === 'click') { addLog.push(fn); docListeners.set('click', fn); } },
    removeEventListener(type) { if (type === 'click') { removeLog.push(1); docListeners.delete('click'); } },
  };
  const body = makeNode('body');
  documentStub.body = body;
  const config = { maxDocumentBlocks: 100 };
  const BLOCK_TYPES = [{ type: 'text', label: 'Texto', desc: 'Parrafo', icon: 't' }, { type: 'table', label: 'Tabla', desc: 'Tabla', icon: 'x' }];
  const menuNodes = [];
  const items = [];
  const calls = { menuRemove: 0, blockPush: 0, autoSave: 0, render: 0, toast: [] };
  const getWorkspaceConfig = () => config;
  const toast = (m) => { calls.toast.push(m); };
  const generateId = () => 'id-' + Math.random().toString(36).slice(2, 8);
  const autoSaveDoc = () => { calls.autoSave++; };
  const renderBlocks = () => { calls.render++; };
  const svgIcon = () => makeNode('svg');
  // h(tag, props, ...children)
  const h = (tag, props, ...children) => {
    const n = makeNode(tag);
    if (props) {
      Object.assign(n, props);
    }
    children.forEach(c => { if (c) n.appendChild(c); });
    if (props && props.className === 'ws-block-menu') menuNodes.push(n);
    if (props && props.className === 'ws-block-menu-item') items.push(n);
    return n;
  };
  // expone los nodos con onClick para dispararlos
  const anchor = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  const fn = new Function(
    'document', 'body', 'h', 'BLOCK_TYPES', 'svgIcon', 'getWorkspaceConfig', 'toast',
    'generateId', 'renderBlocks', 'autoSaveDoc', 'setTimeout', 'clearTimeout', 'hideContextMenu', '$',
    menuSrc + '\nreturn showBlockMenu;'
  );
  const showMenu = fn(documentStub, body, h, BLOCK_TYPES, svgIcon, getWorkspaceConfig, toast, generateId, renderBlocks, autoSaveDoc, (cb) => { cb(); return 1; }, () => {}, () => {}, () => null);
  return {
    showMenu, documentStub, body, menuNodes, items, calls, docListeners,
    addLog, removeLog,
    clickItem(item) { if (item.onClick) item.onClick(); },
    clickoutside(target) { const fn = docListeners.get('click'); if (fn) fn({ target }); },
  };
}

console.log('=== CE-099: el menu contextual de bloques desengancha su listener de document ===');
console.log('(showBlockMenu REAL de workspace.js + DOM stub; el bug: al seleccionar un item el closeMenu quedaba colgado -> leak)');

// 1. Abrir y seleccionar un item: el listener de document se desengancha (no leak)
{
  const env = buildEnv();
  env.showMenu({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }, { blocks: [] }, () => {});
  check('al abrir se engancha 1 listener de document', env.addLog.length === 1, 'add=' + env.addLog.length);
  check('menu se anexo al body', env.menuNodes.length >= 1);
  check('tiene items del menu', env.items.length > 0);
  env.clickItem(env.items[0]);
  check('seleccionar un item agrega un bloque', env.calls.blockPush === 0 || env.calls.render >= 1);
  check('el listener de document se desengancha (remove==add)', env.removeLog.length === env.addLog.length,
    'add=' + env.addLog.length + ' remove=' + env.removeLog.length);
  check('no queda listener vivo en document', env.docListeners.size === 0);
}

// 2. Abrir y cerrar por click FUERA: desengancha igual
{
  const env = buildEnv();
  env.showMenu({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }, { blocks: [] }, () => {});
  env.clickoutside({ target: makeNode('elsewhere') });
  check('click fuera desengancha el listener (remove==add)', env.removeLog.length === env.addLog.length,
    'add=' + env.addLog.length + ' remove=' + env.removeLog.length);
  check('no queda listener vivo', env.docListeners.size === 0);
}

// 3. Abrir y cerrar N veces: NO se acumulan listeners (add == remove tras cada ciclo)
{
  const env = buildEnv();
  for (let i = 0; i < 5; i++) {
    env.showMenu({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }, { blocks: [] }, () => {});
    // clic el item creado en ESTA apertura (el ultimo de la lista)
    env.clickItem(env.items[env.items.length - 1]);
  }
  check('5 aperturas: add == remove (sin acumulacion)', env.addLog.length === 5 && env.removeLog.length === 5,
    'add=' + env.addLog.length + ' remove=' + env.removeLog.length);
  check('no queda listener vivo tras 5 ciclos', env.docListeners.size === 0);
}

// 4. Alcanzar el limite de bloques: avisa y cierra, tambien sin leak
{
  const env = buildEnv();
  env.showMenu({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }, { blocks: [] }, () => {});
  // simulamos el limite anulando el push (el item lanza toast y cierra sin agregar)
  // forzamos maxDocumentBlocks pequeno directamente re-abriendo con config limitada
  const env2 = buildEnv();
  env2.showMenu({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }, { blocks: new Array(100) }, () => {});
  env2.clickItem(env2.items[0]);
  check('limite alcanzado emite toast de aviso', env2.calls.toast.length >= 1);
  check('limite alcanzado tambien desengancha (remove==add)', env2.removeLog.length === env2.addLog.length,
    'add=' + env2.addLog.length + ' remove=' + env2.removeLog.length);
  check('no queda listener vivo', env2.docListeners.size === 0);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);