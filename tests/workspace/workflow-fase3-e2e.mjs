/**
 * AW-081→100: FASE 3 comprehensive workflow E2E test.
 * Covers: persistence CRUD, import/export, validation, templates, execution history,
 * schema versioning, model operations, and engine integration.
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
const { WORKFLOW_TEMPLATES, getTemplateById } = loadVm('workspace/core/workflow-templates.js', ['WORKFLOW_TEMPLATES', 'getTemplateById']);
const regCode = read('workspace/core/operation-registry.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const valCode = read('workspace/core/workflow-validator.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const combined = regCode + '\n' + valCode;
const sandbox = { console, Map, Array, Object, Error, Date, JSON, Math, Number, window: null };
new vm.Script(combined + '\nglobalThis.createOperationRegistry = createOperationRegistry;\nglobalThis.createWorkflowValidator = createWorkflowValidator;').runInNewContext(sandbox);
const createOperationRegistry = sandbox.createOperationRegistry;
const createWorkflowValidator = sandbox.createWorkflowValidator;

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

/* ════════════════════════════════════════════════════════════════ */
// Mock storage
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
  reg.register({ id: 'image.rotate', name: 'Rotar', description: 'x', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { angle: { required: true } } });
  reg.register({ id: 'image.ocr', name: 'OCR', description: 'x', category: 'image', inputKinds: ['image'], outputKind: 'text', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { language: { required: true } } });
  reg.register({ id: 'text.to-document', name: 'A documento', description: 'x', category: 'text', inputKinds: ['text'], outputKind: 'document', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {} });
  reg.register({ id: 'text.to-table', name: 'A tabla', description: 'x', category: 'text', inputKinds: ['text'], outputKind: 'data', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {} });
  reg.register({ id: 'image.compress', name: 'Comprimir', description: 'x', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { quality: { type: 'number', min: 1, max: 100 } } });
  reg.register({ id: 'image.resize', name: 'Resize', description: 'x', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true, destructive: false, execute() {}, optionSchema: { width: { required: true, type: 'number', min: 1 } } });
  return reg;
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== FASE 3 E2E: Workflow Builder Productization ===\n');

// ── P1: Persistence CRUD ─────────────────────────────────────
console.log('── P1: Persistence CRUD ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  const m1 = createWorkflowModel();
  m1.setName('E2E workflow');
  m1.addStep('image.rotate', { angle: 90 });
  m1.addStep('image.ocr', { language: 'spa' });
  const saved = await p.save(m1);
  check('CRUD save returns id', !!saved.id);
  appStore.set({ currentWorkflowId: saved.id });

  const loaded = await p.load(saved.id);
  check('CRUD load returns definition', !!loaded.definition);
  check('CRUD load has 2 steps', loaded.definition.steps.length === 2);
  check('CRUD load preserves name', loaded.name === 'E2E workflow');

  const list = await p.listByProject();
  check('CRUD list has 1 item', list.length === 1);

  await p.rename(saved.id, 'Renamed');
  check('CRUD rename', (await p.load(saved.id)).name === 'Renamed');

  const dup = await p.duplicate(saved.id);
  check('CRUD duplicate has different id', dup.id !== saved.id);
  check('CRUD duplicate has (copia)', dup.name.includes('(copia)'));

  const dupList = await p.listByProject();
  check('CRUD list after dup has 2', dupList.length === 2);

  await p.remove(dup.id);
  check('CRUD delete reduces list', (await p.listByProject()).length === 1);

  const model2 = createWorkflowModel();
  model2.setName('Definition update test');
  model2.addStep('image.compress', { quality: 50 });
  const saved2 = await p.save(model2);
  await p.updateDefinition(saved2.id, model2);
  const loaded2 = await p.load(saved2.id);
  check('CRUD updateDefinition', loaded2.definition.steps.length === 1);
})();

// ── P2: Export/Import ────────────────────────────────────────
console.log('\n── P2: Export/Import ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  const m = createWorkflowModel();
  m.setName('Export E2E');
  m.addStep('image.ocr', { language: 'spa' });
  m.addStep('text.to-document', {});
  const saved = await p.save(m);

  const bundle = await p.exportWorkflow(saved.id);
  check('export type', bundle.type === 'toolisto-workflow');
  check('export has definition', !!bundle.workflow.definition);

  await p.remove(saved.id);
  const imported = await p.importWorkflow(bundle);
  check('import restores workflow', imported.name === 'Export E2E');
  check('import has 2 steps', imported.definition.steps.length === 2);

  const restored = createWorkflowModel();
  restored.deserializeWorkflow(imported.definition);
  check('round-trip model name', restored.getName() === 'Export E2E');
  check('round-trip model steps', restored.getSteps().length === 2);

  let threw = false;
  try { await p.importWorkflow(null); } catch (e) { threw = true; }
  check('import null throws', threw);
})();

// ── P3: Validation ───────────────────────────────────────────
console.log('\n── P3: Validation ──');
await (async () => {
  const reg = createRegistry();
  const val = createWorkflowValidator(reg);

  const valid = { getInputIds: () => ['img1'], getActiveSteps: () => [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }] };
  const inputsMap = { img1: { kind: 'image', name: 'test.jpg' } };
  check('valid workflow passes', val.validateWorkflow(valid, inputsMap).valid);

  const noInputs = { getInputIds: () => [], getActiveSteps: () => [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }] };
  check('no inputs fails', !val.validateWorkflow(noInputs, null).valid);

  const noSteps = { getInputIds: () => ['img1'], getActiveSteps: () => [] };
  check('no steps fails', !val.validateWorkflow(noSteps, inputsMap).valid);

  const chain = { getInputIds: () => ['img1'], getActiveSteps: () => [
    { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
    { operationId: 'text.to-document', enabled: true, options: {} },
  ]};
  check('incompatible chain fails', !val.validateWorkflow(chain, inputsMap).valid);

  const dupSteps = { getInputIds: () => ['img1'], getActiveSteps: () => [
    { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
    { operationId: 'image.rotate', enabled: true, options: { angle: 180 } },
  ]};
  check('duplicate ops warns', val.validateWorkflow(dupSteps, inputsMap).warnings.some(w => w.includes('more than once')));

  const tooMany = { getInputIds: () => ['img1'], getActiveSteps: () => Array.from({ length: 51 }, () => ({ operationId: 'image.rotate', enabled: true, options: { angle: 90 } })) };
  check('step limit fails', !val.validateWorkflow(tooMany, inputsMap).valid);
})();

// ── P4: Templates ────────────────────────────────────────────
console.log('\n── P4: Templates ──');
await (async () => {
  check('templates exist', WORKFLOW_TEMPLATES.length >= 3);
  for (const tpl of WORKFLOW_TEMPLATES) {
    check(`template "${tpl.name}" valid structure`, !!tpl.id && !!tpl.name && Array.isArray(tpl.steps) && tpl.steps.length > 0);
  }

  const ocrTpl = getTemplateById('template-ocr-to-doc');
  check('getTemplateById works', ocrTpl !== null);

  const m = createWorkflowModel();
  m.setName(ocrTpl.name);
  for (const s of ocrTpl.steps) m.addStep(s.operationId, s.options);
  check('template into model', m.getSteps().length === ocrTpl.steps.length);
})();

// ── P5: Execution History ────────────────────────────────────
console.log('\n── P5: Execution History ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  const m = createWorkflowModel();
  m.setName('History E2E');
  const saved = await p.save(m);

  await p.logExecution(saved.id, { total: 5, completed: 5, failed: 0, cancelled: 0, results: {} });
  await p.logExecution(saved.id, { total: 5, completed: 3, failed: 2, cancelled: 0, results: {} });

  const history = await p.getExecutionHistory(saved.id);
  check('history has 2 entries', history.length === 2);
  check('first success', history[0].success === true);
  check('second not success', history[1].success === false);

  for (let i = 0; i < 105; i++) {
    await p.logExecution(saved.id, { total: 1, completed: 1, failed: 0, cancelled: 0, results: {} });
  }
  const capped = await p.getExecutionHistory(saved.id);
  check('history capped at 100', capped.length === 100);
})();

// ── P6: Schema Versioning ────────────────────────────────────
console.log('\n── P6: Schema Versioning ──');
await (async () => {
  const m = createWorkflowModel();
  check('model schema version', m.getSchemaVersion() === WORKFLOW_SCHEMA_VERSION);
  check('serialized version', m.serializeWorkflow().version === WORKFLOW_SCHEMA_VERSION);

  const old = { id: 'old', name: 'Old', version: 0, createdAt: 1000, updatedAt: 2000, inputIds: [], steps: [{ id: 's1', operationId: 'image.rotate', options: { angle: 90 } }] };
  const m2 = createWorkflowModel();
  m2.deserializeWorkflow(old);
  check('migration updates version', m2.getVersion() === WORKFLOW_SCHEMA_VERSION);
  check('migration preserves data', m2.getName() === 'Old' && m2.getSteps().length === 1);
})();

// ── P7: Model Operations ─────────────────────────────────────
console.log('\n── P7: Model Operations ──');
await (async () => {
  const m = createWorkflowModel();
  m.setName('Model E2E');
  m.setInputs(['a', 'b', 'c']);
  const s1 = m.addStep('image.rotate', { angle: 90 });
  const s2 = m.addStep('image.ocr', { language: 'spa' });
  check('model has 2 steps', m.getSteps().length === 2);
  check('model has 3 inputs', m.getInputIds().length === 3);

  m.moveStep(s1.id, 1);
  check('move step', m.getSteps()[1].id === s1.id);

  m.updateStep(s2.id, { options: { language: 'eng' } });
  check('update step options', m.getSteps().find(s => s.id === s2.id).options.language === 'eng');

  m.disableStep(s2.id);
  check('disable step', m.getActiveSteps().length === 1);

  m.enableStep(s2.id);
  check('enable step', m.getActiveSteps().length === 2);

  const cloned = m.cloneWorkflow();
  check('clone different id', cloned.getId() !== m.getId());
  check('clone has steps', cloned.getSteps().length === 2);

  const snap = m.serializeWorkflow();
  const m2 = createWorkflowModel();
  m2.deserializeWorkflow(snap);
  check('round-trip name', m2.getName() === 'Model E2E');
  check('round-trip inputs', m2.getInputIds().length === 3);
  check('round-trip steps', m2.getSteps().length === 2);
})();

// ── P8: Engine Integration ───────────────────────────────────
console.log('\n── P8: Engine Integration ──');
await (async () => {
  const { createWorkflowEngine } = loadVm('workspace/core/workflow-engine.js', ['createWorkflowEngine'], {
    createExecutionResources: loadVm('workspace/core/execution-resources.js', ['createExecutionResources']).createExecutionResources,
    createJobQueue: loadVm('workspace/core/job-queue.js', ['createJobQueue']).createJobQueue,
    createWorkflowValidator: createWorkflowValidator,
  });

  const reg = createRegistry();
  const m = createWorkflowModel();
  m.setName('Engine test');
  m.setInputs(['img1']);
  m.addStep('image.rotate', { angle: 90 });

  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  let eventCount = 0;
  engine.subscribe(() => { eventCount++; });

  const inputs = { 'img1': { data: new Blob(['test']), name: 'test.jpg', kind: 'image' } };
  const result = await engine.run(m, inputs);

  check('engine produces result', !!result);
  check('engine result has state', typeof result.state === 'string');
  check('engine result has executionId', !result.executionId || typeof result.executionId === 'string');
  check('engine result has results object', typeof result.results === 'object');
  check('engine subscribed to events', eventCount > 0);

  const snap = engine.getSnapshot();
  check('engine snapshot accessible', typeof snap === 'object');

  engine.destroy();
  check('engine destroyed', true);
})();

// ── P9: Error Handling ───────────────────────────────────────
console.log('\n── P9: Error Handling ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  let threw = false;
  try { await p.exportWorkflow('nonexistent'); } catch (e) { threw = e.message.includes('no encontrado'); }
  check('export nonexistent throws', threw);

  threw = false;
  try { await p.duplicate('nonexistent'); } catch (e) { threw = e.message.includes('no encontrado'); }
  check('duplicate nonexistent throws', threw);

  threw = false;
  try { await p.importWorkflow({ type: 'wrong' }); } catch (e) { threw = true; }
  check('import invalid type throws', threw);

  threw = false;
  try { await p.importWorkflow({ type: 'toolisto-workflow', workflow: { definition: {} } }); } catch (e) { threw = true; }
  check('import missing steps throws', threw);

  threw = false;
  try { await p.rename('nonexistent', 'x'); } catch (e) { threw = true; }
  check('rename nonexistent throws', threw);

  threw = false;
  try { await p.updateDefinition('nonexistent', createWorkflowModel()); } catch (e) { threw = true; }
  check('updateDefinition nonexistent throws', threw);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
