#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const modelCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-model.js'), 'utf8');
const valCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-validator.js'), 'utf8');
const jqCode = readFileSync(join(ROOT, 'workspace', 'core', 'job-queue.js'), 'utf8');
const engCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-engine.js'), 'utf8');
const ocrCode = readFileSync(join(ROOT, 'workspace', 'core', 'ocr-engine.js'), 'utf8');
const uiCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-ui.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const combined = [
  stripImports(regCode),
  stripImports(modelCode),
  stripImports(valCode),
  stripImports(jqCode),
  stripImports(engCode),
  stripImports(ocrCode),
  stripImports(uiCode),
].join('\n');

// Build the full test harness code including mock DOM, exports, and test runner
const fullCode = `
let elIdCounter = 0;
const _elRegistry = {};

function makeEl(tag, attrs, ...children) {
  const flat = [];
  for (const c of children) { if (Array.isArray(c)) flat.push(...c); else flat.push(c); }
  const el = {
    tag, attrs: attrs || {}, children: [],
    _id: 'el-' + (++elIdCounter),
    parentNode: null,
    style: { display: '', opacity: '' },
    className: '', textContent: '', innerHTML: '',
    disabled: false, title: '', placeholder: '', value: '', type: '', multiple: false,
    href: '', download: '', id: (attrs && attrs.id) || '',
    listeners: {}, onclick: null,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type, fn) { delete this.listeners[type]; },
    click() { const fn = this.onclick || this.listeners['click']; if (fn) fn(); },
    dispatchEvent(ev) { const fn = this.listeners[ev.type]; if (fn) fn(ev); },
    replaceChildren(...kids) { this.children = []; for (const k of kids) { if (typeof k === 'string') { this.textContent = k; } else { k.parentNode = this; this.children.push(k); } } },
    appendChild(child) { if (typeof child === 'string') { this.textContent += child; } else { child.parentNode = this; this.children.push(child); } },
    querySelector(sel) {
      function find(el) {
        if (sel.startsWith('#')) { if (el.id === sel.slice(1)) return el; }
        for (const c of (el.children || [])) { const r = find(c); if (r) return r; }
        return null;
      }
      return find(this);
    },
    focus() {},
    cloneNode() { return Object.assign({}, this); },
    setAttribute(k, v) { if (!this.attrs) this.attrs = {}; this.attrs[k] = v; if (k === 'aria-disabled') this._ariaDisabled = v; },
    getAttribute(k) { return this.attrs && this.attrs[k]; },
    hasAttribute(k) { return this.attrs && k in this.attrs; },
    removeAttribute(k) { if (this.attrs) delete this.attrs[k]; },
  };
  if (attrs) {
    if (attrs.className) el.className = attrs.className;
    if (typeof attrs.style === 'string') {
      attrs.style.split(';').filter(Boolean).forEach(s => { const [k, v] = s.split(':'); if (k && v) el.style[k.trim()] = v.trim(); });
    } else if (attrs.style) {
      for (const k of Object.keys(attrs.style)) el.style[k] = attrs.style[k];
    }
    if (attrs.id) { el.id = attrs.id; _elRegistry[attrs.id] = el; }
    if (attrs.placeholder) el.placeholder = attrs.placeholder;
    if (attrs.type) el.type = attrs.type;
    if (attrs.title) el.title = attrs.title;
    if (attrs.disabled !== undefined) el.disabled = attrs.disabled;
    if (attrs.onClick) el.onclick = function(e) { attrs.onClick(e); };
    if (attrs.onInput) el.listeners['input'] = attrs.onInput;
    if (attrs.onKeyDown) el.listeners['keydown'] = attrs.onKeyDown;
    if (attrs.onMouseEnter) el.onmouseenter = attrs.onMouseEnter;
    if (attrs.onMouseLeave) el.onmouseleave = attrs.onMouseLeave;
    if (attrs.onChange) { el.listeners['change'] = attrs.onChange; el.onchange = attrs.onChange; }
    if (attrs.href) el.href = attrs.href;
    if (attrs.download) el.download = attrs.download;
  }
  for (const child of flat) {
    if (typeof child === 'string') { el.children.push(child); }
    else if (child) { child.parentNode = el; el.children.push(child); }
  }
  return el;
}

function h(tag, attrs, ...children) { return makeEl(tag, attrs, ...children); }
function svgIcon(name, size) { return makeEl('svg', { name, size: size || 16 }); }

const toastQueue = [];
function toast(msg, type) { toastQueue.push({ msg, type }); }
function showModal(opts) { return opts; }
function closeModal() {}
function pushHistory(data) {}

const appStore = {
  _data: { documents: [], dataTables: [], currentProject: { id: 'p1', name: 'Test' }, captures: [] },
  get(k) { return this._data[k]; },
  set(obj) { Object.assign(this._data, obj); },
  subscribe(fn) { return () => {}; },
};

let savedDocs = [];
let savedTables = [];
let savedImages = [];
let refreshCountCalls = 0;
async function saveDoc(id, doc) { savedDocs.push(doc); return doc; }
async function saveData(id, table) { savedTables.push(table); return table; }
async function saveImageCapture(project, blob, name) { savedImages.push({ project: project ? project.id : null, blob, name }); return { capture: { id: 'cap-' + savedImages.length } }; }
async function refreshProjectCounts(id) { refreshCountCalls++; }

const document = {
  getElementById(id) { return _elRegistry[id] || null; },
  createElement(tag) { return makeEl(tag); },
};

let _blobCounter = 0;
let _revoked = [];
const _URL = {
  createObjectURL(b) { _blobCounter++; const u = 'blob:mock-' + _blobCounter; return u; },
  revokeObjectURL(u) { _revoked.push(u); },
};

${combined}

// Expose APIs
globalThis.createOperationRegistry = createOperationRegistry;
globalThis.createWorkflowUI = createWorkflowUI;
globalThis.h = h;
globalThis.svgIcon = svgIcon;
globalThis.toast = toast;
globalThis.showModal = showModal;
globalThis.closeModal = closeModal;
globalThis.pushHistory = pushHistory;
globalThis.appStore = appStore;
globalThis._revoked = _revoked;
globalThis._URL = _URL;
globalThis.toastQueue = toastQueue;
globalThis.document = document;
globalThis.savedDocs = savedDocs;
globalThis.savedTables = savedTables;
globalThis.refreshCountCalls = refreshCountCalls;
globalThis._elRegistry = _elRegistry;
globalThis.makeEl = makeEl;

// Test runner globals
globalThis.pass = 0;
globalThis.fail = 0;
function check(name, ok, detail) { if (ok) { globalThis.pass++; console.log('  PASS: ' + name); } else { globalThis.fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }
globalThis.check = check;

// Registry setup
const _reg = createOperationRegistry();
_reg.register({ id: 'img.resize', name: 'Redimensionar', description: 'Cambiar tamano', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { width: { required: true, type: 'number' } } });
_reg.register({ id: 'img.rotate', name: 'Rotar', description: 'Rotar imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { angle: { required: true, type: 'number' } } });
_reg.register({ id: 'txt.export', name: 'Exportar texto', description: 'Exportar a TXT', category: 'text', inputKinds: ['text'], outputKind: 'text', supportsBatch: false, supportsCancellation: false, destructive: false, execute() {} });
_reg.register({ id: 'txt.toTable', name: 'Texto a tabla', description: 'Convertir texto en tabla', category: 'text', inputKinds: ['text'], outputKind: 'data', supportsBatch: false, supportsCancellation: false, destructive: false, execute() {} });
_reg.register({ id: 'img.convert', name: 'Convertir formato', description: 'Cambiar formato de imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { format: { required: true, type: 'string' } } });
_reg.register({ id: 'rpt.create', name: 'Crear informe', description: 'Generar informe PDF', category: 'report', inputKinds: ['document', 'data'], outputKind: 'pdf', supportsBatch: false, supportsCancellation: false, destructive: false, execute() {} });
_reg.register({ id: 'img.enhance', name: 'Mejorar', description: 'Mejorar calidad', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: true, execute() {} });
globalThis._registry = _reg;

function createAppHelpers() {
  return { h, svgIcon, appStore, toast, showModal, closeModal, pushHistory, saveDoc, saveData, saveImageCapture, refreshProjectCounts };
}

function makeContainer() { return h('div', { id: 'wf-test-container' }); }

console.log('=== Workflow UI Tests ===\\n');

// --- 1. Initialization ---
(function testInit() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  const c = makeContainer();
  ui.render(c);
  check('1. UI created without errors', !!ui);
  check('2. Has no workflow initially', !ui.hasWorkflow());
})();

// --- 3. Render does not throw ---
(function testRender() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  const c = makeContainer();
  let threw = false;
  try { ui.render(c); } catch (e) { threw = true; console.error('Render threw:', e.message); }
  check('3. Render does not throw', !threw);
})();

// --- 4-5. Add files, check workflow state ---
(function testAddFiles() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const file = { name: 'test.png', size: 1000, type: 'image/png' };
  ui.addFiles([file]);
  check('4. Has workflow after adding files', ui.hasWorkflow());
  const snap = ui.getWorkflowSnapshot();
  check('5. Snapshot is object', snap && typeof snap === 'object');
})();

// --- 6. Clear flow resets state ---
(function testClear() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  ui.addFiles([{ name: 't.png', size: 100, type: 'image/png' }]);
  ui.clearFlow();
  check('6. Clear removes workflow', !ui.hasWorkflow());
})();

// --- 7-9. Set workflow from snapshot ---
(function testSetSnapshot() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const steps = [{ operationId: 'img.resize', enabled: true, options: { width: 800 } }];
  ui.setWorkflowFromSnapshot({ id: 'test-id', name: 'Test WF', steps, inputIds: [] });
  check('7. Has workflow after restore', ui.hasWorkflow());
  const snap = ui.getWorkflowSnapshot();
  check('8. Steps count matches after restore', snap && snap.steps && snap.steps.length === 1);
  check('9. Operation ID preserved', snap.steps[0].operationId === 'img.resize');
})();

// --- 10-11. Multiple steps, order preserved ---
(function testMultipleSteps() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const steps = [
    { operationId: 'img.resize', enabled: true, options: { width: 800 } },
    { operationId: 'img.rotate', enabled: true, options: { angle: 90 } },
    { operationId: 'img.convert', enabled: false, options: { format: 'png' } },
  ];
  ui.setWorkflowFromSnapshot({ id: 'm', name: 'M', steps, inputIds: [] });
  const snap = ui.getWorkflowSnapshot();
  check('10. Restored 3 steps', snap && snap.steps && snap.steps.length === 3);
  check('11. Step order preserved (step 2 is rotate)', snap.steps[1].operationId === 'img.rotate');
})();

// --- 12. Options preserved in snapshot ---
(function testOptions() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const steps = [{ operationId: 'img.resize', enabled: true, options: { width: 1024 } }];
  ui.setWorkflowFromSnapshot({ id: 'o', name: 'O', steps, inputIds: [] });
  const snap = ui.getWorkflowSnapshot();
  check('12. Options preserved', snap.steps[0].options && snap.steps[0].options.width === 1024);
})();

// --- 13. Disabled step state ---
(function testDisabled() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const steps = [{ operationId: 'img.resize', enabled: false, options: { width: 800 } }];
  ui.setWorkflowFromSnapshot({ id: 'd', name: 'D', steps, inputIds: [] });
  const snap = ui.getWorkflowSnapshot();
  check('13. Disabled step persists', snap.steps[0].enabled === false);
})();

// --- 14-15. Null/undefined snapshot ---
(function testNullSnapshot() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  ui.setWorkflowFromSnapshot(null);
  check('14. Null snapshot safe', !ui.hasWorkflow());
  ui.setWorkflowFromSnapshot(undefined);
  check('15. Undefined snapshot safe', !ui.hasWorkflow());
})();

// --- 16. Double clear ---
(function testDoubleClear() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  ui.addFiles([{ name: 'a.png', size: 100, type: 'image/png' }]);
  ui.clearFlow();
  ui.clearFlow();
  check('16. Double clear safe', !ui.hasWorkflow());
})();

// --- 17. Clear and re-add ---
(function testClearReAdd() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  ui.addFiles([{ name: 'x.png', size: 100, type: 'image/png' }]);
  ui.clearFlow();
  ui.addFiles([{ name: 'y.png', size: 200, type: 'image/png' }]);
  check('17. Re-add after clear works', ui.hasWorkflow());
})();

// --- 18. Snapshot JSON-serializable ---
(function testJSONSafe() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const steps = [{ operationId: 'img.resize', enabled: true, options: { width: 800 } }];
  ui.setWorkflowFromSnapshot({ id: 's', name: 'S', steps, inputIds: [] });
  const snap = ui.getWorkflowSnapshot();
  let threw = false;
  try { JSON.stringify(snap); } catch (e) { threw = true; }
  check('18. Snapshot JSON-serializable', !threw);
})();

// --- 19. Execute button state (needs inputs + steps) ---
(function testExecuteBtn() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  const c = makeContainer();
  ui.render(c);
  const steps = [{ operationId: 'img.resize', enabled: true, options: { width: 800 } }];
  ui.setWorkflowFromSnapshot({ id: 'e', name: 'E', steps, inputIds: [] });
  // without inputs, execute should be disabled
  const hasSteps = ui.hasWorkflow();
  check('19. Has workflow with steps only (no inputs)', hasSteps);
})();

// --- 20. Toast tracking ---
(function testToast() {
  toastQueue.length = 0;
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  check('20. Toast queue empty initially', toastQueue.length === 0);
})();

// --- 21. Multiple file types ---
(function testFileTypes() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  ui.addFiles([{ name: 'photo.jpg', size: 5000, type: 'image/jpeg' }]);
  ui.addFiles([{ name: 'notes.txt', size: 200, type: 'text/plain' }]);
  ui.addFiles([{ name: 'report.pdf', size: 10000, type: 'application/pdf' }]);
  check('21. Multiple file types accepted', ui.hasWorkflow());
})();

// --- 22-23. Empty clear multiple times ---
(function testEmptyClear() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  ui.clearFlow();
  check('22. Clear empty safe', !ui.hasWorkflow());
  ui.clearFlow();
  check('23. Clear empty twice safe', !ui.hasWorkflow());
})();

// --- 24. Re-render ---
(function testReRender() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  const c1 = makeContainer();
  const c2 = makeContainer();
  ui.render(c1);
  let threw = false;
  try { ui.render(c2); } catch (e) { threw = true; }
  check('24. Re-render does not throw', !threw);
})();

// --- 25-27. Registry introspection ---
(function testRegistry() {
  const compatible = _registry.listCompatible('image');
  const names = compatible.map(o => o.id).sort();
  check('25. Image-compatible ops listed', names.includes('img.resize') && names.includes('img.rotate'));
  const all = _registry.list();
  check('26. All 7 operations registered', all.length === 7);
  const imageOps = _registry.listByCategory('image');
  check('27. Category filter returns 4 image ops', imageOps.length === 4);
})();

// --- 28-29. Revocation tracking ---
(function testRevocation() {
  const before = _revoked.length;
  _URL.revokeObjectURL('blob:test');
  check('28. Revoke tracking works', _revoked.length === before + 1);
  const u = _URL.createObjectURL(new Blob(['test']));
  check('29. CreateObjectURL tracking works', u && u.startsWith('blob:'));
})();

// --- 30. Text operation in flow ---
(function testTextOp() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const steps = [{ operationId: 'txt.export', enabled: true, options: {} }];
  ui.setWorkflowFromSnapshot({ id: 't', name: 'T', steps, inputIds: [] });
  const snap = ui.getWorkflowSnapshot();
  check('30. Text operation in snapshot', snap.steps[0].operationId === 'txt.export');
})();

// --- 31-33. Project items can enter a compatible workflow without copying their data ---
(function testWorkspaceInputs() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const added = ui.addWorkspaceItems([{ id: 'table-t1', name: 'Ventas', kind: 'data' }]);
  const duplicate = ui.addWorkspaceItems([{ id: 'table-t1', name: 'Ventas', kind: 'data' }]);
  const snap = ui.getWorkflowSnapshot();
  check('31. Adds a table from Workspace as flow input', added === 1 && snap.inputIds.length === 1);
  check('32. Does not duplicate the same Workspace input', duplicate === 0 && snap.inputIds.length === 1);
  check('33. Rejects unsupported Workspace input kinds', ui.addWorkspaceItems([{ id: 'asset-1', name: 'Archivo', kind: 'file' }]) === 0);
})();

// --- 57-59. Captures (scanned images) chain into flows as image inputs (CE-050) ---
(function testCaptureInputs() {
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());
  const added = ui.addWorkspaceItems([{ id: 'capture-c1', name: 'Escanera clara', kind: 'image' }]);
  const duplicate = ui.addWorkspaceItems([{ id: 'capture-c1', name: 'Escanera clara', kind: 'image' }]);
  const snap = ui.getWorkflowSnapshot();
  check('57. Adds a capture from Workspace as image flow input', added === 1 && snap.inputIds.length === 1);
  check('58. Does not duplicate the same capture input', duplicate === 0 && snap.inputIds.length === 1);
  // La entrada de imagen permite encadenar operaciones de imagen (OCR, rotar…):
  // el constructor filtra por kind 'image' y las operaciones de imagen son compatibles.
  const compatible = _registry.listCompatible('image');
  const imageOpIds = compatible.map(o => o.id);
  check('59. Image capture input is compatible with image operations', imageOpIds.includes('img.resize') && imageOpIds.includes('img.rotate'), 'image ops=' + imageOpIds.join(','));
})();

// --- 34-40. Results added to Workspace persist to the project (CE-047) ---
async function testAddResultPersists() {
  savedDocs.length = 0;
  savedTables.length = 0;
  refreshCountCalls = 0;
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());

  const docResult = { kind: 'document', data: { blocks: [{ id: 'b1', type: 'paragraph', content: 'Hola' }], name: 'Doc resultado', title: 'Doc resultado', type: 'document' }, name: 'Doc resultado' };
  await ui.addResultToWorkspace(docResult);
  check('34. Document result persisted via saveDoc', savedDocs.length === 1 && savedDocs[0].blocks && savedDocs[0].blocks.length === 1);
  check('35. Document result added to documents state', (appStore.get('documents') || []).some(d => d.name === 'Doc resultado'));
  check('36. Refresh counts called for document', refreshCountCalls === 1);

  savedTables.length = 0;
  refreshCountCalls = 0;
  const tableResult = { kind: 'data', data: { headers: ['A', 'B'], rows: [[1, 2]], name: 'Tabla resultado' }, name: 'Tabla resultado' };
  await ui.addResultToWorkspace(tableResult);
  check('37. Table result persisted via saveData', savedTables.length === 1 && savedTables[0].headers && savedTables[0].headers.length === 2);
  check('38. Table result added to dataTables state', (appStore.get('dataTables') || []).some(t => t.name === 'Tabla resultado'));
  check('39. Refresh counts called for table', refreshCountCalls === 1);

  savedTables.length = 0;
  await ui.addResultToWorkspace({ kind: 'data', data: { headers: ['A', 'B'], rows: [[1, 2]], name: 'Duplicada', id: 'T-1' }, name: 'Duplicada' });
  await ui.addResultToWorkspace({ kind: 'data', data: { headers: ['A', 'B'], rows: [[1, 2]], name: 'Duplicada', id: 'T-1' }, name: 'Duplicada' });
  check('40. Duplicate table result saved once', savedTables.length === 1, 'saves=' + savedTables.length);
}

// --- 41-46. Image results and wrapped payloads added to Workspace (CE-048) ---
async function testAddImageResultPersists() {
  savedImages.length = 0;
  savedDocs.length = 0;
  savedTables.length = 0;
  refreshCountCalls = 0;
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());

  // El engine envuelve cada resultado como { data: <payload>, kind, name }.
  const wrappedImage = { kind: 'image', name: 'foto-salida.png', data: { data: new Blob(['img']), kind: 'image', name: 'foto-salida.png' } };
  await ui.addResultToWorkspace(wrappedImage);
  check('41. Image result persisted via saveImageCapture', savedImages.length === 1 && savedImages[0].blob instanceof Blob && savedImages[0].name === 'foto-salida.png', 'images=' + savedImages.length);
  check('42. Image result uses current project id', savedImages.length === 1 && savedImages[0].project === 'p1');
  check('43. Refresh counts called for image', refreshCountCalls === 1);

  savedImages.length = 0;
  refreshCountCalls = 0;
  const rawImage = { kind: 'image', name: 'foto-directa.png', data: new Blob(['raw']) };
  await ui.addResultToWorkspace(rawImage);
  check('44. Raw Blob image result persisted', savedImages.length === 1 && savedImages[0].blob instanceof Blob && savedImages[0].name === 'foto-directa.png');

  savedImages.length = 0;
  await ui.addResultToWorkspace({ kind: 'image', data: { data: new Blob(['x']), kind: 'image' } });
  check('45. Image result without name falls back to default', savedImages.length === 1 && savedImages[0].name === 'Imagen del flujo');

  // El payload envuelto del engine tambien debe persistir para document/data
  // (CE-047 leia result.data.blocks directamente y se omitia en un flujo real).
  savedDocs.length = 0;
  savedTables.length = 0;
  const wrappedDoc = { kind: 'document', name: 'Doc envuelto', data: { data: { id: 'D-1', blocks: [{ id: 'b', type: 'paragraph', content: 'Hola' }], name: 'Doc envuelto', title: 'Doc envuelto', type: 'document' }, kind: 'document', name: 'Doc envuelto' } };
  await ui.addResultToWorkspace(wrappedDoc);
  check('46. Wrapped document payload persisted via saveDoc', savedDocs.length === 1 && savedDocs[0].id === 'D-1' && savedDocs[0].blocks && savedDocs[0].blocks.length === 1, 'docs=' + savedDocs.length);

  const wrappedTable = { kind: 'data', name: 'Tabla envuelta', data: { data: { id: 'T-9', headers: ['A', 'B'], rows: [[1, 2]], name: 'Tabla envuelta' }, kind: 'data', name: 'Tabla envuelta' } };
  await ui.addResultToWorkspace(wrappedTable);
  check('47. Wrapped table payload persisted via saveData', savedTables.length === 1 && savedTables[0].id === 'T-9' && savedTables[0].headers && savedTables[0].headers.length === 2, 'tables=' + savedTables.length);

  savedImages.length = 0;
  await ui.addResultToWorkspace({ kind: 'image', data: { data: 'not-a-blob', kind: 'image' }, name: 'no.png' });
  check('48. Image result without a Blob does not persist', savedImages.length === 0, 'images=' + savedImages.length);
}

// --- 49-56. Text results added to Workspace as documents (CE-049) ---
async function testAddTextResultPersists() {
  savedDocs.length = 0;
  savedTables.length = 0;
  refreshCountCalls = 0;
  const ui = createWorkflowUI(_registry, createAppHelpers());
  ui.render(makeContainer());

  // El engine envuelve cada resultado como { data: <payload>, kind, name }:
  // la salida OCR de image.ocr llega como { data: 'texto', kind: 'text', name }.
  const wrappedText = { kind: 'text', name: 'ocr-salida.txt', data: { data: 'Linea uno\\nUltima linea', kind: 'text', name: 'ocr-salida.txt' } };
  await ui.addResultToWorkspace(wrappedText);
  check('49. Wrapped text result persisted as document via saveDoc', savedDocs.length === 1 && savedDocs[0].blocks && savedDocs[0].blocks.length === 2, 'docs=' + savedDocs.length);
  check('50. Text document uses stable id derived from content', savedDocs.length === 1 && /^flow-text-/.test(savedDocs[0].id), 'id=' + (savedDocs[0] && savedDocs[0].id));
  check('51. Text document added to documents state', (appStore.get('documents') || []).some(d => d.name === 'ocr-salida.txt' && d.blocks.length === 2));
  check('52. Refresh counts called for text document', refreshCountCalls === 1);

  const prevDocCount = savedDocs.length;
  await ui.addResultToWorkspace(wrappedText);
  check('53. Re-adding the same text result does not duplicate', savedDocs.length === prevDocCount, 'docs=' + savedDocs.length + '/' + prevDocCount);

  savedDocs.length = 0;
  refreshCountCalls = 0;
  const rawText = { kind: 'text', name: 'md.flujo.md', data: '# Titulo\\n-  item\\nParrafo' };
  await ui.addResultToWorkspace(rawText);
  check('54. Text headings and bullets mapped to blocks', savedDocs.length === 1 && savedDocs[0].blocks[0].type === 'heading1' && savedDocs[0].blocks[1].type === 'bullet-list', 'types=' + savedDocs.map(d => d.blocks.map(b => b.type).join('|')).join(','));
  check('55. Named text result uses its own name', savedDocs.length === 1 && savedDocs[0].name === 'md.flujo.md');

  savedDocs.length = 0;
  await ui.addResultToWorkspace({ kind: 'text', data: '   ' });
  check('56. Empty text result does not persist', savedDocs.length === 0, 'docs=' + savedDocs.length);
}

// --- 49-53. Keyboard/ARIA contract of dynamic widgets (CE-009) ---
(function testAccessibilityContract() {
  function walk(el, fn) {
    fn(el);
    const kids = el.children || [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] && typeof kids[i] === 'object') walk(kids[i], fn);
    }
  }
  function findByText(root, text) {
    let found = null;
    walk(root, (el) => {
      if (found) return;
      const ownText = (Array.isArray(el.children) ? el.children.filter(c => typeof c === 'string').join('') : '') + (el.textContent || '');
      if (ownText.includes(text)) found = el;
    });
    return found;
  }

  const ui = createWorkflowUI(_registry, createAppHelpers());
  const container = makeContainer();
  ui.render(container);
  ui.addFiles([{ name: 'foto.png', size: 100, type: 'image/png' }]);

  // Open the operation selector.
  const addBtn = findByText(container, 'Anadir operacion');
  check('41. "Anadir operacion" button exists', !!addBtn);
  if (addBtn) addBtn.click();

  const opRows = [];
  walk(container, (el) => { if (el.attrs && el.attrs.role === 'button' && el.getAttribute('aria-label')) opRows.push(el); });
  check('42. Operation picker rows expose role=button with aria-label', opRows.length > 0, 'rows=' + opRows.length);
  check('43. Operation picker rows are focusable (tabindex=0)', opRows.length > 0 && opRows.every(r => Number(r.attrs['tabindex']) === 0));

  // Keyboard activation via Enter adds a step.
  if (opRows.length > 0) {
    const before = ui.getWorkflowSnapshot();
    const stepsBefore = (before && before.steps ? before.steps.length : 0);
    opRows[0].dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    const after = ui.getWorkflowSnapshot();
    const stepsAfter = (after && after.steps ? after.steps.length : 0);
    check('44. Enter on an op row adds a step', stepsAfter === stepsBefore + 1, stepsBefore + ' -> ' + stepsAfter);
  }

  // Category filter buttons track the active category with aria-pressed.
  const CAT_LABELS = ['Todas', 'Imagen', 'Texto', 'Informe', 'Grafico', 'PDF', 'Salida'];
  const catButtons = [];
  walk(container, (el) => {
    if (el.attrs && el.attrs['aria-pressed'] !== undefined) {
      const txt = (Array.isArray(el.children) ? el.children.filter(c => typeof c === 'string').join('') : '') + (el.textContent || '');
      if (CAT_LABELS.includes(txt.trim())) catButtons.push(el);
    }
  });
  check('45. Category filter buttons carry aria-pressed', catButtons.length === 7, 'count=' + catButtons.length);
  const pressedCount = catButtons.filter(b => b.getAttribute('aria-pressed') === 'true').length;
  check('46. Exactly one category is active at a time', pressedCount === 1, 'pressed=' + pressedCount);
})();

globalThis.__vmProm = testAddResultPersists().then(() => testAddImageResultPersists()).then(() => testAddTextResultPersists()).then(() => {
  console.log('\\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\\n');
}).catch(e => { console.error('ASYNC TEST ERROR:', e && (e.stack || e.message) || e); fail++; console.log('\\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\\n'); });
`;

const ctx = vm.createContext({
  console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
  String, parseInt, parseFloat, setTimeout, clearTimeout, RegExp, Boolean, Symbol,
  Blob: class Blob { constructor(parts) { this.parts = parts || []; this.size = (parts || []).reduce((s, p) => s + (p.length || 0), 0); } },
  URL: class MockURL {
    static createObjectURL(b) { return 'blob:mock-' + (++counter); }
    static revokeObjectURL(u) { revoked.push(u); }
  },
  AbortController: class { constructor() { this.signal = { aborted: false, addEventListener() {}, removeEventListener() {} }; } },
  window: {},
});
let counter = 0, revoked = [];
ctx.URL._counter = counter;
ctx.URL.revoked = revoked;

await vm.runInContext(fullCode, ctx);
if (ctx.__vmProm) await ctx.__vmProm;
await new Promise(r => setTimeout(r, 0));
const finalPass = ctx.pass || 0;
const finalFail = ctx.fail || 0;

console.log('\n=== Workflow UI Tests (from vm): ' + finalPass + ' pass, ' + finalFail + ' fail ===\n');
process.exit(finalFail > 0 ? 1 : 0);
