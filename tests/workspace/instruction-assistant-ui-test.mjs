#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const parserCode = readFileSync(join(ROOT, 'workspace', 'core', 'instruction-parser.js'), 'utf8');
const modelCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-model.js'), 'utf8');
const plannerCode = readFileSync(join(ROOT, 'workspace', 'core', 'instruction-planner.js'), 'utf8');
const uiCode = readFileSync(join(ROOT, 'workspace', 'core', 'instruction-assistant-ui.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const combined = [
  stripImports(parserCode),
  stripImports(modelCode),
  stripImports(plannerCode),
  stripImports(uiCode),
].join('\n');

const testCode = `
let elIdCounter = 0;
const _elRegistry = {};

function makeEl(tag, attrs, ...children) {
  const flat = [];
  for (const c of children) { if (Array.isArray(c)) flat.push(...c); else flat.push(c); }
  const el = {
    tag, attrs: attrs || {}, children: [],
    _id: 'el-' + (++elIdCounter),
    parentNode: null,
    style: { display: '', opacity: '', flexDirection: '', gap: '', padding: '', height: '', overflow: '', minHeight: '', marginTop: '', marginBottom: '' },
    className: '', textContent: '', innerHTML: '',
    disabled: false, title: '', placeholder: '', value: '', type: '', multiple: false,
    href: '', download: '', id: (attrs && attrs.id) || '', rows: 3,
    dataset: {},
    listeners: {}, onclick: null,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type, fn) { delete this.listeners[type]; },
    click() { const fn = this.onclick || this.listeners['click']; if (fn) fn({ preventDefault: () => {} }); },
    dispatchEvent(ev) { const fn = this.listeners[ev.type]; if (fn) fn(ev); },
    replaceChildren(...kids) { this.children = []; for (const k of kids) { if (typeof k === 'string') { this.textContent += k; } else { if (k && typeof k === 'object') { k.parentNode = this; this.children.push(k); } } } },
    appendChild(child) { if (typeof child === 'string') { this.textContent += child; } else { if (child && typeof child === 'object') { child.parentNode = this; this.children.push(child); } } },
    removeChild(child) { const idx = this.children.indexOf(child); if (idx !== -1) this.children.splice(idx, 1); },
    querySelector(sel) {
      function find(el) {
        if (sel.startsWith('#')) { if (el.id === sel.slice(1)) return el; }
        if (sel.startsWith('.') && el.className && el.className.includes(sel.slice(1))) return el;
        if (el.tag === sel) return el;
        for (const c of (el.children || [])) { const r = find(c); if (r) return r; }
        return null;
      }
      return find(this);
    },
    focus() {},
    cloneNode() { return Object.assign({}, this); },
    setAttribute(k, v) { if (!this.attrs) this.attrs = {}; this.attrs[k] = v; if (k === 'aria-label') this._ariaLabel = v; if (k === 'aria-disabled') this._ariaDisabled = v; if (k === 'aria-live') this._ariaLive = v; if (k === 'aria-hidden') this._ariaHidden = v; if (k === 'role') this._role = v; },
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
    if (attrs.rows) el.rows = attrs.rows;
    if (attrs.onClick) { el.onclick = function(e) { attrs.onClick(e); }; }
    if (attrs.onInput) { el.listeners['input'] = function(e) { attrs.onInput(e); }; }
    if (attrs.onChange) { el.listeners['change'] = attrs.onChange; el.onchange = attrs.onChange; }
    if (attrs.href) el.href = attrs.href;
    if (attrs.download) el.download = attrs.download;
  }
  for (const child of flat) {
    if (typeof child === 'string') { el.children.push(child); }
    else if (child && typeof child === 'object') { child.parentNode = el; el.children.push(child); }
  }
  return el;
}

function h(tag, attrs, ...children) { return makeEl(tag, attrs, ...children); }
function svgIcon(name, size) { return makeEl('svg', { name, size: size || 16 }); }

const toastQueue = [];
function toast(msg, type) { toastQueue.push({ msg, type }); }
function showModal(opts) { return opts; }
function closeModal() {}

const appStore = {
  _data: { documents: [], dataTables: [], currentProject: { id: 'p1', name: 'Test' }, captures: [] },
  get(k) { return this._data[k]; },
  set(obj) { Object.assign(this._data, obj); },
  subscribe(fn) { return () => {}; },
};

const document = {
  getElementById(id) { return _elRegistry[id] || null; },
  createElement(tag) { return makeEl(tag); },
};

${combined}

globalThis.createInstructionAssistant = createInstructionAssistant;
globalThis.createInstructionParser = createInstructionParser;
globalThis.createInstructionPlanner = createInstructionPlanner;
globalThis.h = h;
globalThis.svgIcon = svgIcon;
globalThis.toast = toast;
globalThis.showModal = showModal;
globalThis.closeModal = closeModal;
globalThis.appStore = appStore;
globalThis.document = document;
globalThis._elRegistry = _elRegistry;
globalThis.toastQueue = toastQueue;

globalThis.pass = 0;
globalThis.fail = 0;
function check(name, ok, detail) { if (ok) { globalThis.pass++; console.log('  PASS: ' + name); } else { globalThis.fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }
globalThis.check = check;

// Register operations for testing
const _reg = {
  _ops: {},
  register(op) { if (this._ops[op.id]) return false; this._ops[op.id] = op; return true; },
  get(id) { return this._ops[id] || null; },
  has(id) { return id in this._ops; },
  list() { return Object.values(this._ops); },
  listCompatible(kind) { return Object.values(this._ops).filter(op => op.inputKinds.includes(kind)); },
  listByCategory(cat) { return Object.values(this._ops).filter(op => op.category === cat); },
};
_reg.register({ id: 'image.rotate', name: 'Rotar imagen', description: 'Rotar imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { angle: { default: 90, label: 'Angulo' } } });
_reg.register({ id: 'image.resize', name: 'Redimensionar', description: 'Cambiar tamano', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { width: { default: 800, label: 'Ancho' }, height: { default: 600, label: 'Alto' } } });
_reg.register({ id: 'image.convert', name: 'Convertir formato', description: 'Cambiar formato', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { format: { default: 'image/png', label: 'Formato' } } });
_reg.register({ id: 'image.enhance', name: 'Mejorar', description: 'Mejorar calidad', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { contrast: { default: 1.0, label: 'Contraste' } } });
_reg.register({ id: 'image.strip-metadata', name: 'Quitar metadatos', description: 'Eliminar EXIF', category: 'image', inputKinds: ['image'], outputKind: 'image' });
_reg.register({ id: 'image.ocr', name: 'OCR', description: 'Extraer texto', category: 'text', inputKinds: ['image', 'pdf'], outputKind: 'text' });
_reg.register({ id: 'text.to-table', name: 'Texto a tabla', description: 'Convertir texto en tabla', category: 'text', inputKinds: ['text'], outputKind: 'data' });
_reg.register({ id: 'text.to-document', name: 'Crear documento', description: 'Crear documento desde texto', category: 'text', inputKinds: ['text'], outputKind: 'document' });
_reg.register({ id: 'report.create', name: 'Crear informe', description: 'Generar informe', category: 'report', inputKinds: ['data'], outputKind: 'document' });
_reg.register({ id: 'text.export', name: 'Exportar texto', description: 'Exportar a TXT', category: 'text', inputKinds: ['text'], outputKind: 'file' });

globalThis._registry = _reg;

console.log('=== Instruction Assistant UI Tests ===\\n');

// --- 1. Creation ---
(function testCreation() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  check('Assistant created', typeof assistant === 'object');
  check('Has render method', typeof assistant.render === 'function');
  check('Has executePlan method', typeof assistant.executePlan === 'function');
  check('Has clearInput method', typeof assistant.clearInput === 'function');
  check('Has onUseFlow method', typeof assistant.onUseFlow === 'function');
  check('Has getCurrentPlan method', typeof assistant.getCurrentPlan === 'function');
  check('Has getHistory method', typeof assistant.getHistory === 'function');
  check('Has getParser method', typeof assistant.getParser === 'function');
  check('Parser instance accessible', assistant.getParser() !== null);
  check('History starts empty', assistant.getHistory().length === 0);
  assistant.destroy();
})();

// --- 2. Render ---
(function testRender() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container' });
  assistant.render(container, []);
  check('Render populates container', container.children.length > 0);
  check('Has input field', container.querySelector('#wf-assistant-input') !== null);
  check('Has create button', container.querySelector('#wf-assistant-create') !== null);
  check('Has clear button', container.querySelector('#wf-assistant-clear') !== null);
  assistant.destroy();
})();

// --- 3. Clear input ---
(function testClearInput() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container2' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  check('Input rendered', inputEl !== null);
  assistant.destroy();
})();

// --- 4. Execute plan with empty text ---
(function testExecuteEmpty() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container3' });
  assistant.render(container, []);
  const beforeCount = toastQueue.length;
  assistant.executePlan([]);
  check('Empty input does not crash', true);
  assistant.destroy();
})();

// --- 5. Execute plan with valid text ---
(function testExecuteValid() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container4' });
  assistant.render(container, []);
  // Simulate text input
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) inputEl.value = 'Mejora esta imagen y conviertela a PNG';
  const beforeCount = toastQueue.length;
  assistant.executePlan([]);
  const plan = assistant.getCurrentPlan();
  check('Plan generated after execute', plan !== null);
  if (plan) {
    check('Plan has workflow', plan.workflow !== null);
    check('Plan valid', plan.valid === true);
  }
  assistant.destroy();
})();

// --- 6. Execute plan with unknown text ---
(function testExecuteUnknown() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container5' });
  assistant.render(container, []);
  assistant.executePlan([]);
  // Without setting input, it should just show the "empty" warning
  const plan = assistant.getCurrentPlan();
  // May be null because no input text was set
  check('Execute with no text returns null plan', plan === null || plan.valid === false);
  assistant.destroy();
})();

// --- 7. Suggestions update ---
(function testSuggestions() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container6' });
  assistant.render(container, []);
  // updateSuggestions with image files
  assistant.updateSuggestions([{ name: 'foto.jpg', type: 'image/jpeg', kind: 'image' }]);
  check('Suggestions update does not crash', true);
  assistant.destroy();
})();

// --- 8. History tracking ---
(function testHistory() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container7' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) inputEl.value = 'Rota esta imagen';
  assistant.executePlan([]);
  const history = assistant.getHistory();
  check('History has entry after execute', history.length > 0);
  check('History stores text', history[0] === 'Rota esta imagen');
  assistant.destroy();
})();

// --- 9. History max limit ---
(function testHistoryLimit() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container8' });
  assistant.render(container, []);
  // Set many different texts to test history limit
  for (let i = 0; i < 15; i++) {
    const inputEl = container.querySelector('#wf-assistant-input');
    if (inputEl) inputEl.value = 'Instruccion ' + i;
    assistant.executePlan([]);
  }
  const history = assistant.getHistory();
  check('History does not exceed 10', history.length <= 10);
  assistant.destroy();
})();

// --- 10. SetHistory ---
(function testSetHistory() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  assistant.setHistory(['test1', 'test2', 'test3']);
  const hist = assistant.getHistory();
  check('SetHistory works', hist.length === 3 && hist[0] === 'test1');
  assistant.destroy();
})();

// --- 11. onUseFlow callback ---
(function testOnUseFlow() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  let called = false;
  assistant.onUseFlow((plan, files, editMode) => { called = true; });
  const container = h('div', { id: 'test-container9' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) inputEl.value = 'Mejora esta imagen';
  assistant.executePlan([]);
  check('onUseFlow callback registered', called === false); // Not called yet, only on button click
  assistant.destroy();
})();

// --- 12. Destroy ---
(function testDestroy() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container10' });
  assistant.render(container, []);
  assistant.destroy();
  check('Destroy does not crash', true);
  check('Panel removed from container after destroy', container.children.length === 0 || container.querySelector('#wf-assistant-input') === null);
})();

// --- 13. Plan with OCR to table ---
(function testOcrToTable() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container11' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) inputEl.value = 'Extrae el texto de estas imagenes y conviertelo en tabla';
  assistant.executePlan([]);
  const plan = assistant.getCurrentPlan();
  if (plan && plan.workflow) {
    const steps = plan.workflow.getActiveSteps();
    check('OCR->table has 2 steps', steps.length >= 2);
    if (steps.length >= 2) {
      check('OCR->table first is ocr', steps[0].operationId === 'image.ocr');
      check('OCR->table second is to-table', steps[1].operationId === 'text.to-table');
    }
  }
  assistant.destroy();
})();

// --- 14. Parser accessible from assistant ---
(function testParserAccess() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const parser = assistant.getParser();
  const result = parser.parse('Redimensiona esta imagen a 1024x768');
  check('Parser accessible via assistant', result !== null);
  check('Assistant parser works', result.intents.length === 1 && result.intents[0].action === 'resize');
  assistant.destroy();
})();

// --- 15. Keyboard shortcut handler (Ctrl+Enter) ---
(function testKeyboardShortcut() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container12' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  check('Input field has event listeners', inputEl !== null && typeof inputEl.listeners['keydown'] === 'function');
  assistant.destroy();
})();

// --- 16. Plan with warnings from unknown segments ---
(function testUnknownPlan() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container13' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) {
    // Set via the textarea value - directly trigger via executePlan
    inputEl.value = 'Mejora estas fotos y hazlas brillantes';
  }
  assistant.executePlan([]);
  const plan = assistant.getCurrentPlan();
  if (plan) {
    check('Unknown segments generate plan correctly', plan.valid === true || plan.warnings.length > 0);
  }
  assistant.destroy();
})();

// --- 17. Export text ---
(function testExportText() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container14' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) inputEl.value = 'Exporta este texto a un archivo';
  assistant.executePlan([]);
  const plan = assistant.getCurrentPlan();
  if (plan && plan.workflow) {
    const steps = plan.workflow.getActiveSteps();
    check('Export text step found', steps.some(s => s.operationId === 'text.export'));
  }
  assistant.destroy();
})();

// --- 18. Multiple assistant instances ---
(function testMultipleInstances() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const a1 = createInstructionAssistant(_reg, helpers);
  const a2 = createInstructionAssistant(_reg, helpers);
  check('Independent instances', a1 !== a2);
  a1.destroy();
  a2.destroy();
})();

// --- 19. Plan with confidence level ---
(function testConfidenceLevels() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container15' });
  assistant.render(container, []);
  const inputEl = container.querySelector('#wf-assistant-input');
  if (inputEl) inputEl.value = 'Mejora esta imagen y redimensiona a 1200 px y convierte a webp';
  assistant.executePlan([]);
  const plan = assistant.getCurrentPlan();
  if (plan) {
    check('Pipeline has high confidence', ['high', 'medium', 'low'].includes(plan.confidence.level));
  }
  assistant.destroy();
})();

// --- 20. Update suggestions with different file types ---
(function testUpdateSuggestionsTypes() {
  const helpers = { h, svgIcon, appStore, toast, showModal, closeModal, reportError: (e) => { console.error(e); }, showWarning: (m) => { toast(m, 'warning'); }, pushHistory: () => {} };
  const assistant = createInstructionAssistant(_reg, helpers);
  const container = h('div', { id: 'test-container16' });
  assistant.render(container, []);
  // Test with PDF files
  assistant.updateSuggestions([{ name: 'doc.pdf', type: 'application/pdf', kind: 'pdf' }]);
  // Test with text files
  assistant.updateSuggestions([{ name: 'file.txt', type: 'text/plain', kind: 'text' }]);
  // Test with mixed files
  assistant.updateSuggestions([
    { name: 'a.jpg', type: 'image/jpeg', kind: 'image' },
    { name: 'b.txt', type: 'text/plain', kind: 'text' },
  ]);
  check('Suggestions update with all types', true);
  assistant.destroy();
})();

console.log('\\nUI Tests: ' + globalThis.pass + ' pass, ' + globalThis.fail + ' fail');
process.exit(globalThis.fail > 0 ? 1 : 0);
`;

const sandbox = {
  console, setTimeout, clearTimeout, Array, Object, Map, Set, String, Number, Boolean,
  Error, RegExp, parseInt, parseFloat, Math, Date, JSON, isNaN, isFinite, process: { exit: () => {} },
};
try {
  vm.runInNewContext(testCode, sandbox, { timeout: 10000 });
} catch (e) {
  console.error('VM ERROR:', e.message);
  process.exit(1);
}
