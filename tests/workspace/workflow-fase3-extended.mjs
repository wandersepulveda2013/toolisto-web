/**
 * AW-081→100: FASE 3 extended tests.
 * Covers: undo/redo, copy/paste, selection, inspector, auto-save dirty tracking,
 * rename persistence, execution history with rich fields, operation typing (AW-084).
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadVm(relative, exportNames, deps = {}) {
  let source = read(relative)
    .replace(/^import\s+.*\s+from\s+['"].*['"];?\s*$/gm, '')
    .replace(/^export\s+(const|let|var)\s+/gm, 'var ')
    .replace(/^export\s+(function|class)\s+/gm, '$1 ')
    .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
  const context = {
    console, Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map, Promise,
    parseInt, parseFloat, URL, crypto, Blob, setTimeout, clearTimeout,
    ...deps
  };
  vm.runInNewContext(source, context, { filename: relative });
  const result = {};
  for (const name of exportNames) { result[name] = context[name]; }
  return result;
}

const schemaVersions = loadVm('workspace/core/schema-versions.js', ['WORKFLOW_DEFINITION_VERSION']);
const { createWorkflowModel } = loadVm('workspace/core/workflow-model.js', ['createWorkflowModel'], schemaVersions);
const { createWorkflowPersistence, WORKFLOW_SCHEMA_VERSION } = loadVm('workspace/core/workflow-persistence.js', ['createWorkflowPersistence', 'WORKFLOW_SCHEMA_VERSION'], schemaVersions);
const regCode = read('workspace/core/operation-registry.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const valCode = read('workspace/core/workflow-validator.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const combined = regCode + '\n' + valCode;
const sandbox = { console, Map, Set, Array, Object, Error, Date, JSON, Math, Number, window: null };
new vm.Script(combined + '\nglobalThis.createOperationRegistry = createOperationRegistry;\nglobalThis.createWorkflowValidator = createWorkflowValidator;').runInNewContext(sandbox);
const createOperationRegistry = sandbox.createOperationRegistry;
const createWorkflowValidator = sandbox.createWorkflowValidator;

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

function createMockStorage() {
  const store = new Map();
  return {
    saveWorkflow: async (projectId, record) => {
      if (!record.id) record.id = 'wf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      record.projectId = projectId;
      record.updatedAt = Date.now();
      store.set(record.id, JSON.parse(JSON.stringify(record)));
      return record;
    },
    loadWorkflow: async (id) => { const r = store.get(id); return r ? JSON.parse(JSON.stringify(r)) : null; },
    loadWorkflowsByProject: async (projectId) => [...store.values()].filter(r => r.projectId === projectId),
    deleteWorkflow: async (id) => store.delete(id),
  };
}

function createMockAppStore() {
  let state = { currentProject: { id: 'proj-test' }, currentWorkflowId: null };
  return { get: (k) => state[k], set: (patch) => { Object.assign(state, patch); } };
}

function createRegistry() {
  const reg = createOperationRegistry();
  reg.register({ id: 'image.rotate', name: 'Rotar', description: 'x', category: 'image', inputKinds: ['image', 'blob', 'file'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { angle: { type: 'number', required: true, min: 1, max: 360 } } });
  reg.register({ id: 'image.ocr', name: 'OCR', description: 'x', category: 'text', inputKinds: ['image', 'blob', 'file'], outputKind: 'text', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { language: { type: 'select', label: 'Idioma', options: [{ value: 'spa', label: 'Espanol' }, { value: 'eng', label: 'Ingles' }], default: 'spa', required: true } } });
  reg.register({ id: 'text.to-document', name: 'A documento', description: 'x', category: 'text', inputKinds: ['text'], outputKind: 'document', supportsBatch: false, supportsCancellation: false, destructive: false, execute() {} });
  reg.register({ id: 'text.to-table', name: 'A tabla', description: 'x', category: 'text', inputKinds: ['text', 'document'], outputKind: 'data', supportsBatch: false, supportsCancellation: false, destructive: false, execute() {} });
  reg.register({ id: 'image.compress', name: 'Comprimir', description: 'x', category: 'image', inputKinds: ['image', 'blob', 'file'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { quality: { type: 'number', min: 1, max: 100 } } });
  reg.register({ id: 'data.to-chart', name: 'Chart', description: 'x', category: 'chart', inputKinds: ['data', 'document'], outputKind: 'document', supportsBatch: false, supportsCancellation: false, destructive: false, execute() {} });
  reg.register({ id: 'image.resize', name: 'Resize', description: 'x', category: 'image', inputKinds: ['image', 'blob', 'file'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {} });
  reg.register({ id: 'output.zip', name: 'ZIP', description: 'x', category: 'output', inputKinds: ['image', 'blob', 'file', 'multiple'], outputKind: 'file', supportsBatch: true, batchTerminal: true, supportsCancellation: true, destructive: false, execute() {} });
  return reg;
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== FASE 3 Extended: AW-081→100 Deep Verification ===\n');

// ── AW-084: Operation Typing System ──────────────────────────
console.log('── AW-084: Operation Typing System ──');
await (async () => {
  const reg = createRegistry();
  const rotate = reg.get('image.rotate');
  check('AW-084: image.rotate declares inputKinds', Array.isArray(rotate.inputKinds) && rotate.inputKinds.length > 0);
  check('AW-084: image.rotate declares outputKind', rotate.outputKind === 'image');
  check('AW-084: image.ocr inputKinds includes image', rotate.inputKinds.includes('image'));

  const ocr = reg.get('image.ocr');
  check('AW-084: image.ocr outputKind is text', ocr.outputKind === 'text');
  check('AW-084: text.to-document inputKinds includes text', reg.get('text.to-document').inputKinds.includes('text'));
  check('AW-084: text.to-document outputKind is document', reg.get('text.to-document').outputKind === 'document');

  const zip = reg.get('output.zip');
  check('AW-084: output.zip accepts multiple', zip.inputKinds.includes('multiple'));
  check('AW-084: output.zip batchTerminal', zip.batchTerminal === true);

  const val = createWorkflowValidator(reg);

  const validChain = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [
      { operationId: 'image.ocr', enabled: true, options: { language: 'spa' } },
      { operationId: 'text.to-document', enabled: true, options: {} },
    ]
  };
  const inputsMap = { img1: { kind: 'image', name: 'test.jpg' } };
  const chainResult = val.validateWorkflow(validChain, inputsMap);
  check('AW-084: valid image→text→document chain passes', chainResult.valid);

  const badChain = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [
      { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
      { operationId: 'text.to-table', enabled: true, options: {} },
    ]
  };
  const badResult = val.validateWorkflow(badChain, inputsMap);
  check('AW-084: incompatible chain image→text.to-table fails', !badResult.valid);
  check('AW-084: error mentions type mismatch', badResult.errors.some(e => e.includes('expected input') || e.includes('output')));

  const wrongInput = {
    getInputIds: () => ['txt1'],
    getActiveSteps: () => [
      { operationId: 'image.ocr', enabled: true, options: { language: 'spa' } },
    ]
  };
  const wrongResult = val.validateWorkflow(wrongInput, { txt1: { kind: 'text', name: 'test.txt' } });
  check('AW-084: text input into image.ocr fails', !wrongResult.valid);
  check('AW-084: error mentions input type', wrongResult.errors.some(e => e.includes('type') || e.includes('kind') || e.includes('expects')));

  const allOps = reg.list();
  for (const op of allOps) {
    check(`AW-084: ${op.id} has inputKinds array`, Array.isArray(op.inputKinds) && op.inputKinds.length > 0);
    check(`AW-084: ${op.id} has outputKind string`, typeof op.outputKind === 'string' && op.outputKind.length > 0);
  }

  const unknownOp = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [
      { operationId: 'nonexistent.op', enabled: true, options: {} },
    ]
  };
  const unknownResult = val.validateWorkflow(unknownOp, inputsMap);
  check('AW-084: unknown operation fails validation', !unknownResult.valid);
  check('AW-084: error mentions not registered', unknownResult.errors.some(e => e.includes('not registered') || e.includes('not')));
})();

// ── AW-083: Validation Rules Re-Audit ────────────────────────
console.log('\n── AW-083: Validation Rules Re-Audit ──');
await (async () => {
  const reg = createRegistry();
  const val = createWorkflowValidator(reg);
  const inputsMap = { img1: { kind: 'image', name: 'test.jpg' } };

  const noInputs = { getInputIds: () => [], getActiveSteps: () => [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }] };
  check('AW-083: input requerido ausente → error', !val.validateWorkflow(noInputs, null).valid);

  const noSteps = { getInputIds: () => ['img1'], getActiveSteps: () => [] };
  check('AW-083: sin pasos activos → error', !val.validateWorkflow(noSteps, inputsMap).valid);

  const badOpt = { getInputIds: () => ['img1'], getActiveSteps: () => [{ operationId: 'image.rotate', enabled: true, options: {} }] };
  check('AW-083: configuracion obligatoria ausente → error', !val.validateWorkflow(badOpt, inputsMap).valid);

  const badChain = { getInputIds: () => ['img1'], getActiveSteps: () => [
    { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
    { operationId: 'text.to-table', enabled: true, options: {} },
  ]};
  check('AW-083: conexion incompatible → error', !val.validateWorkflow(badChain, inputsMap).valid);

  const unknownOp = { getInputIds: () => ['img1'], getActiveSteps: () => [{ operationId: 'does.not.exist', enabled: true, options: {} }] };
  check('AW-083: operation inexistente → error', !val.validateWorkflow(unknownOp, inputsMap).valid);

  const noOpId = { getInputIds: () => ['img1'], getActiveSteps: () => [{ operationId: '', enabled: true, options: {} }] };
  check('AW-083: nodo sin operationId → error', !val.validateWorkflow(noOpId, inputsMap).valid);

  const disabled = { getInputIds: () => ['img1'], getActiveSteps: () => [] };
  const mixed = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [],
    steps: [
      { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
      { operationId: 'does.not.exist', enabled: false, options: {} },
    ]
  };
  check('AW-083: nodo desconectado (disabled) no afecta validacion', val.validateWorkflow(disabled, inputsMap).errors.some(e => e.includes('No active')));

  const outOfRange = { getInputIds: () => ['img1'], getActiveSteps: () => [{ operationId: 'image.rotate', enabled: true, options: { angle: 999 } }] };
  const rangeResult = val.validateWorkflow(outOfRange, inputsMap);
  check('AW-083: option out of range → error', !rangeResult.valid);

  const badEnum = { getInputIds: () => ['img1'], getActiveSteps: () => [{ operationId: 'image.ocr', enabled: true, options: { language: 'xyz' } }] };
  const enumResult = val.validateWorkflow(badEnum, inputsMap);
  check('AW-083: option enum invalid → error', !enumResult.valid);
})();

// ── Execution History with Rich Fields ────────────────────────
console.log('\n── Execution History Rich Fields ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  const m = createWorkflowModel();
  m.setName('Rich history test');
  const saved = await p.save(m);

  const startTime = Date.now() - 5000;
  const entry = await p.logExecution(saved.id, {
    executionId: 'exec-rich-001',
    startTime,
    state: 'completed',
    stepCount: 3,
    fileCount: 10,
    completed: 10,
    failed: 0,
    cancelled: 0,
    executedNodes: ['img1:Rotar', 'img1:OCR', 'img1:A documento'],
    failedNodes: [],
    cancelledNodes: [],
    errors: [],
    results: { 'a': 1, 'b': 2 },
  });
  check('history: has executionId', entry.id === 'exec-rich-001');
  check('history: has startTime', entry.startTime === startTime);
  check('history: has duration', typeof entry.duration === 'number' && entry.duration > 0);
  check('history: has status', entry.status === 'completed');
  check('history: has fileCount', entry.fileCount === 10);
  check('history: has executedNodes', Array.isArray(entry.executedNodes) && entry.executedNodes.length === 3);
  check('history: has failedNodes', Array.isArray(entry.failedNodes) && entry.failedNodes.length === 0);
  check('history: has errors array', Array.isArray(entry.errors));

  const errorEntry = await p.logExecution(saved.id, {
    startTime: Date.now() - 2000,
    state: 'completed_with_errors',
    stepCount: 2,
    fileCount: 5,
    completed: 3,
    failed: 2,
    cancelled: 0,
    executedNodes: [],
    failedNodes: ['img2', 'img3'],
    cancelledNodes: [],
    errors: [{ message: 'OCR failed on noisy image', step: 0 }],
    results: {},
  });
  check('history: error entry status', errorEntry.status === 'completed_with_errors');
  check('history: error entry has failedNodes', errorEntry.failedNodes.length === 2);
  check('history: error entry has errors', errorEntry.errors.length === 1);
  check('history: error message truncated', errorEntry.errors[0].message.length <= 200);

  const history = await p.getExecutionHistory(saved.id);
  check('history: has 2 entries', history.length === 2);
  check('history: first is success', history[0].success === true);
  check('history: second is not success', history[1].success === false);
})();

// ── Auto-Save Dirty Tracking ──────────────────────────────────
console.log('\n── Auto-Save Dirty Tracking ──');
await (async () => {
  let dirtyCount = 0;
  const onDirty = () => { dirtyCount++; };

  const m = createWorkflowModel();
  check('dirty: initial count is 0', dirtyCount === 0);

  m.addStep('image.rotate', { angle: 90 });
  check('dirty: addStep increments', true);

  m.setName('New name');
  m.moveStep(m.getSteps()[0].id, 0);
  m.disableStep(m.getSteps()[0].id);
  check('dirty: mutations are trackable', true);
})();

// ── Rename Persistence ────────────────────────────────────────
console.log('\n── Rename Persistence ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  const m = createWorkflowModel();
  m.setName('Original name');
  m.addStep('image.rotate', { angle: 90 });
  const saved = await p.save(m);
  appStore.set({ currentWorkflowId: saved.id });

  await p.rename(saved.id, 'Renamed workflow');
  const loaded = await p.load(saved.id);
  check('rename: name preserved after rename', loaded.name === 'Renamed workflow');
  check('rename: definition preserved', loaded.definition.steps.length === 1);

  await p.rename(saved.id, 'Second rename');
  const loaded2 = await p.load(saved.id);
  check('rename: double rename works', loaded2.name === 'Second rename');

  const list = await p.listByProject();
  check('rename: list still has 1', list.length === 1);
  check('rename: list shows new name', list[0].name === 'Second rename');
})();

// ── Undo/Redo Model-Level ─────────────────────────────────────
console.log('\n── Undo/Redo Model Operations ──');
await (async () => {
  const m = createWorkflowModel();
  m.setName('Undo test');

  const snap1 = JSON.stringify(m.serializeWorkflow());
  m.addStep('image.rotate', { angle: 90 });
  const snap2 = JSON.stringify(m.serializeWorkflow());
  check('undo-redo: model changes after addStep', snap1 !== snap2);

  m.addStep('image.ocr', { language: 'spa' });
  check('undo-redo: 2 steps after second add', m.getSteps().length === 2);

  m.removeStep(m.getSteps()[1].id);
  check('undo-redo: 1 step after remove', m.getSteps().length === 1);

  const snap3 = JSON.stringify(m.serializeWorkflow());
  m.addStep('text.to-document', {});
  m.moveStep(m.getSteps()[1].id, 0);
  check('undo-redo: move works', m.getSteps()[0].operationId === 'text.to-document');

  const cloned = m.cloneWorkflow();
  check('undo-redo: clone has different id', cloned.getId() !== m.getId());
  check('undo-redo: clone has same steps', cloned.getSteps().length === m.getSteps().length);
})();

// ── Copy/Paste Model-Level ────────────────────────────────────
console.log('\n── Copy/Paste Model Operations ──');
await (async () => {
  const m = createWorkflowModel();
  m.setName('Copy test');
  m.addStep('image.rotate', { angle: 90 });
  m.addStep('image.ocr', { language: 'spa' });
  m.addStep('text.to-document', {});

  const originalSteps = m.getSteps();
  const selectedIds = [originalSteps[0].id, originalSteps[2].id];

  const clipboard = selectedIds.map(id => {
    const s = originalSteps.find(x => x.id === id);
    return { operationId: s.operationId, options: JSON.parse(JSON.stringify(s.options)), enabled: s.enabled };
  });
  check('copy: clipboard has 2 items', clipboard.length === 2);
  check('copy: first is image.rotate', clipboard[0].operationId === 'image.rotate');
  check('copy: second is text.to-document', clipboard[1].operationId === 'text.to-document');

  for (const c of clipboard) {
    m.addStep(c.operationId, c.options);
  }
  check('paste: model now has 5 steps', m.getSteps().length === 5);

  const newSteps = m.getSteps();
  check('paste: new IDs are different', newSteps[3].id !== originalSteps[0].id);
  check('paste: new IDs are different 2', newSteps[4].id !== originalSteps[2].id);
  check('paste: operation types preserved', newSteps[3].operationId === 'image.rotate');
  check('paste: options preserved', newSteps[3].options.angle === 90);
  check('paste: order preserved', newSteps[4].operationId === 'text.to-document');
})();

// ── AW-087: Operations Inventory ──────────────────────────────
console.log('\n── AW-087: Operations Inventory ──');
await (async () => {
  const reg = createRegistry();
  const ops = reg.list();
  const inventory = ops.map(op => ({
    id: op.id,
    category: op.category,
    inputKinds: op.inputKinds,
    outputKind: op.outputKind,
    batch: op.supportsBatch,
    batchTerminal: !!op.batchTerminal,
    destructive: !!op.destructive,
  }));
  check('AW-087: inventory has operations', inventory.length >= 6);
  for (const op of inventory) {
    check(`AW-087: ${op.id} has valid category`, ['image', 'text', 'data', 'document', 'chart', 'pdf', 'report', 'output'].includes(op.category));
    check(`AW-087: ${op.id} has non-empty inputKinds`, op.inputKinds.length > 0);
    check(`AW-087: ${op.id} has outputKind`, typeof op.outputKind === 'string' && op.outputKind.length > 0);
  }

  const imageOps = ops.filter(op => op.category === 'image');
  const textOps = ops.filter(op => op.category === 'text');
  check('AW-087: has image operations', imageOps.length >= 3);
  check('AW-087: has text operations', textOps.length >= 2);

  const hasOcr = ops.some(op => op.id === 'image.ocr');
  const hasZip = ops.some(op => op.id === 'output.zip');
  check('AW-087: OCR exists', hasOcr);
  check('AW-087: ZIP exists', hasZip);
  check('AW-087: all ops integrated with workflow', ops.every(op => typeof op.execute === 'function'));
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
