/**
 * AW-081: Workflow persistence tests.
 * Tests: create, save, load, edit, duplicate, rename, delete, schema versioning.
 * Uses in-memory mock for IndexedDB storage.
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
    parseInt, parseFloat, URL, crypto, Blob,
    ...deps
  };
  vm.runInNewContext(source, context, { filename: relative });
  const result = {};
  for (const name of exportNames) { result[name] = context[name]; }
  return result;
}

const schemaVersions = loadVm('workspace/core/schema-versions.js', ['WORKFLOW_DEFINITION_VERSION', 'WORKFLOW_SCHEMA_VERSION']);
const { createWorkflowModel } = loadVm('workspace/core/workflow-model.js', ['createWorkflowModel'], schemaVersions);
const { createWorkflowPersistence, WORKFLOW_SCHEMA_VERSION } = loadVm('workspace/core/workflow-persistence.js', ['createWorkflowPersistence', 'WORKFLOW_SCHEMA_VERSION'], schemaVersions);

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
      if (!record.id) record.id = 'wf-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
      record.projectId = projectId;
      record.updatedAt = Date.now();
      store.set(record.id, JSON.parse(JSON.stringify(record)));
      return record;
    },
    loadWorkflow: async (id) => {
      const r = store.get(id);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    loadWorkflowsByProject: async (projectId) => {
      return [...store.values()].filter(r => r.projectId === projectId);
    },
    deleteWorkflow: async (id) => {
      return store.delete(id);
    },
    _store: store,
  };
}

function createMockAppStore() {
  let state = { currentProject: { id: 'proj-1' }, currentWorkflowId: null };
  return {
    get: (k) => state[k],
    set: (patch) => { Object.assign(state, patch); },
  };
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-081: Workflow persistence ===');

// Test 1: Schema version constant
check('WORKFLOW_SCHEMA_VERSION is 1', WORKFLOW_SCHEMA_VERSION === 1);

// Test 2: Create and save a workflow
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Mi primer flujo');
  model.setInputs(['file-1', 'file-2']);
  model.addStep('image.rotate', { angle: 90 });
  model.addStep('image.ocr', { language: 'spa' });

  const saved = await persistence.save(model);
  check('save returns id', !!saved.id);
  check('save sets projectId', saved.projectId === 'proj-1');
  check('save sets schemaVersion', saved.schemaVersion === WORKFLOW_SCHEMA_VERSION);
  check('save stores definition', !!saved.definition);
  check('save definition has steps', saved.definition.steps.length === 2);
  check('save definition preserves name', saved.definition.name === 'Mi primer flujo');
  check('save definition preserves inputs', saved.definition.inputIds.length === 2);
})();

// Test 3: Load a workflow
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Test load');
  model.addStep('image.rotate', { angle: 180 });
  const saved = await persistence.save(model);

  const loaded = await persistence.load(saved.id);
  check('load returns record', !!loaded);
  check('load preserves name', loaded.name === 'Test load');
  check('load definition has step', loaded.definition.steps.length === 1);
  check('load definition step operation', loaded.definition.steps[0].operationId === 'image.rotate');
})();

// Test 4: List workflows by project
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const m1 = createWorkflowModel(); m1.setName('Flow 1');
  const m2 = createWorkflowModel(); m2.setName('Flow 2');
  await persistence.save(m1);
  await persistence.save(m2);

  const list = await persistence.listByProject();
  check('list returns 2 workflows', list.length === 2);
  check('list contains Flow 1', list.some(w => w.name === 'Flow 1'));
  check('list contains Flow 2', list.some(w => w.name === 'Flow 2'));
})();

// Test 5: Delete a workflow
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  const saved = await persistence.save(model);
  check('delete removes workflow', await persistence.remove(saved.id) === true);
  check('deleted workflow not found', (await persistence.load(saved.id)) === null);
})();

// Test 6: Duplicate a workflow
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Original');
  model.addStep('image.ocr', { language: 'spa' });
  const saved = await persistence.save(model);

  const dup = await persistence.duplicate(saved.id);
  check('duplicate creates new record', !!dup.id);
  check('duplicate has different id', dup.id !== saved.id);
  check('duplicate name has (copia)', dup.name.includes('(copia)'));
  check('duplicate preserves definition steps', dup.definition.steps.length === 1);

  const loaded = await persistence.load(dup.id);
  check('duplicate is loadable', !!loaded);
  check('duplicate definition is independent', loaded.definition.id !== saved.definition.id);
})();

// Test 7: Rename a workflow
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Old name');
  const saved = await persistence.save(model);

  const renamed = await persistence.rename(saved.id, 'New name');
  check('rename updates name', renamed.name === 'New name');
  check('rename is loadable with new name', (await persistence.load(saved.id)).name === 'New name');
})();

// Test 8: Update definition
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Editable');
  model.addStep('image.rotate', { angle: 90 });
  const saved = await persistence.save(model);

  model.addStep('image.ocr', { language: 'eng' });
  await persistence.updateDefinition(saved.id, model);

  const loaded = await persistence.load(saved.id);
  check('updateDefinition adds step', loaded.definition.steps.length === 2);
  check('updateDefinition new step is ocr', loaded.definition.steps[1].operationId === 'image.ocr');
})();

// Test 9: Round-trip: serialize → save → load → deserialize
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const original = createWorkflowModel();
  original.setName('Round trip test');
  original.setInputs(['img-1', 'img-2', 'img-3']);
  original.addStep('image.rotate', { angle: 90 });
  original.addStep('image.compress', { quality: 80 });
  original.addStep('output.zip', {});

  const saved = await persistence.save(original);
  const loaded = await persistence.load(saved.id);

  const restored = createWorkflowModel();
  restored.deserializeWorkflow(loaded.definition);

  check('round-trip name', restored.getName() === 'Round trip test');
  check('round-trip inputs', restored.getInputIds().length === 3);
  check('round-trip steps count', restored.getSteps().length === 3);
  check('round-trip step 1 op', restored.getSteps()[0].operationId === 'image.rotate');
  check('round-trip step 2 op', restored.getSteps()[1].operationId === 'image.compress');
  check('round-trip step 3 op', restored.getSteps()[2].operationId === 'output.zip');
  check('round-trip step 1 options', restored.getSteps()[0].options.angle === 90);
  check('round-trip step 2 options', restored.getSteps()[1].options.quality === 80);
})();

// Test 10: Persistence isolation between projects
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model1 = createWorkflowModel(); model1.setName('Project 1 flow');
  await persistence.save(model1, { projectId: 'proj-A' });

  const model2 = createWorkflowModel(); model2.setName('Project 2 flow');
  await persistence.save(model2, { projectId: 'proj-B' });

  const listA = await persistence.listByProject('proj-A');
  const listB = await persistence.listByProject('proj-B');
  check('project A has 1 workflow', listA.length === 1);
  check('project B has 1 workflow', listB.length === 1);
  check('project A workflow name', listA[0].name === 'Project 1 flow');
  check('project B workflow name', listB[0].name === 'Project 2 flow');
})();

// Test 11: Workflow model backward compatibility
await (async () => {
  const model = createWorkflowModel();
  model.setName('Backward compat');
  model.addStep('image.rotate', { angle: 270 });

  const snapshot = model.serializeWorkflow();
  check('snapshot has id field', typeof snapshot.id === 'string');
  check('snapshot has name field', snapshot.name === 'Backward compat');
  check('snapshot has version field', snapshot.version === 1);
  check('snapshot has createdAt', typeof snapshot.createdAt === 'number');
  check('snapshot has updatedAt', typeof snapshot.updatedAt === 'number');
  check('snapshot has inputIds', Array.isArray(snapshot.inputIds));
  check('snapshot has steps array', Array.isArray(snapshot.steps));
  check('snapshot step has id', typeof snapshot.steps[0].id === 'string');
  check('snapshot step has operationId', snapshot.steps[0].operationId === 'image.rotate');
  check('snapshot step has options', snapshot.steps[0].options.angle === 270);
  check('snapshot step has enabled', snapshot.steps[0].enabled === true);
})();

// Test 12: Clear flow creates new model
await (async () => {
  const model = createWorkflowModel();
  model.setName('Will be cleared');
  model.addStep('image.rotate', { angle: 90 });

  const model2 = createWorkflowModel();
  check('new model has default name', model2.getName() === 'Nuevo flujo');
  check('new model has no steps', model2.getSteps().length === 0);
  check('new model has different id', model2.getId() !== model.getId());
})();

// Test 13: Clone preserves all data
await (async () => {
  const original = createWorkflowModel();
  original.setName('Clone me');
  original.setInputs(['a', 'b', 'c']);
  original.addStep('image.rotate', { angle: 90 });
  original.addStep('image.ocr', { language: 'spa' });

  const cloned = original.cloneWorkflow();
  check('clone has different id', cloned.getId() !== original.getId());
  check('clone name has (copia)', cloned.getName().includes('(copia)'));
  check('clone preserves inputs', cloned.getInputIds().length === 3);
  check('clone preserves steps', cloned.getSteps().length === 2);
  check('clone step 1 options are independent', cloned.getSteps()[0].options !== original.getSteps()[0].options);

  original.getSteps()[0].options.angle = 180;
  check('clone is independent from original', cloned.getSteps()[0].options.angle === 90);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-082: Workflow export/import ===');

// Test 14: Export workflow produces valid bundle
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Export test');
  model.addStep('image.ocr', { language: 'spa' });
  const saved = await persistence.save(model);

  const bundle = await persistence.exportWorkflow(saved.id);
  check('export type is toolisto-workflow', bundle.type === 'toolisto-workflow');
  check('export has version', bundle.version === WORKFLOW_SCHEMA_VERSION);
  check('export has exportedAt', typeof bundle.exportedAt === 'number');
  check('export has workflow name', bundle.workflow.name === 'Export test');
  check('export has definition', !!bundle.workflow.definition);
  check('export definition has steps', bundle.workflow.definition.steps.length === 1);
})();

// Test 15: Import workflow into project
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('To import');
  model.addStep('image.rotate', { angle: 45 });
  const saved = await persistence.save(model);

  const bundle = await persistence.exportWorkflow(saved.id);
  await persistence.remove(saved.id);

  const imported = await persistence.importWorkflow(bundle);
  check('import returns record', !!imported.id);
  check('import preserves name', imported.name === 'To import');
  check('import has definition', !!imported.definition);
  check('import definition has step', imported.definition.steps.length === 1);
  check('import step operation', imported.definition.steps[0].operationId === 'image.rotate');
  check('import step options', imported.definition.steps[0].options.angle === 45);
})();

// Test 16: Import rejects invalid bundle
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  let threw = false;
  try { await persistence.importWorkflow(null); } catch (e) { threw = e.message.includes('no válido'); }
  check('import null throws', threw);

  threw = false;
  try { await persistence.importWorkflow({ type: 'wrong' }); } catch (e) { threw = e.message.includes('no válido'); }
  check('import wrong type throws', threw);

  threw = false;
  try { await persistence.importWorkflow({ type: 'toolisto-workflow', workflow: {} }); } catch (e) { threw = e.message.includes('no contiene'); }
  check('import missing definition throws', threw);

  threw = false;
  try { await persistence.importWorkflow({ type: 'toolisto-workflow', workflow: { definition: {} } }); } catch (e) { threw = e.message.includes('pasos válidos'); }
  check('import missing steps throws', threw);
})();

// Test 17: Export round-trip preserves all data
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const original = createWorkflowModel();
  original.setName('Round trip export');
  original.setInputs(['a', 'b']);
  original.addStep('image.rotate', { angle: 90 });
  original.addStep('image.compress', { quality: 75 });
  original.addStep('output.zip', {});

  const saved = await persistence.save(original);
  const bundle = await persistence.exportWorkflow(saved.id);
  await persistence.remove(saved.id);

  const imported = await persistence.importWorkflow(bundle);
  const restored = createWorkflowModel();
  restored.deserializeWorkflow(imported.definition);

  check('round-trip export name', restored.getName() === 'Round trip export');
  check('round-trip export inputs', restored.getInputIds().length === 2);
  check('round-trip export steps', restored.getSteps().length === 3);
  check('round-trip export step 1', restored.getSteps()[0].operationId === 'image.rotate');
  check('round-trip export step 2', restored.getSteps()[1].operationId === 'image.compress');
  check('round-trip export step 3', restored.getSteps()[2].operationId === 'output.zip');
})();

// Test 18: Import into different project
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Cross project');
  const saved = await persistence.save(model);
  const bundle = await persistence.exportWorkflow(saved.id);

  const imported = await persistence.importWorkflow(bundle, { projectId: 'proj-other' });
  check('import to other project has correct projectId', imported.projectId === 'proj-other');
  check('import to other project is loadable', (await persistence.load(imported.id)) !== null);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-084: Schema versioning ===');

// Test 19: Model uses centralized schema version
await (async () => {
  const model = createWorkflowModel();
  check('model schema version matches constant', model.getSchemaVersion() === WORKFLOW_SCHEMA_VERSION);
  check('serialized version matches schema version', model.serializeWorkflow().version === WORKFLOW_SCHEMA_VERSION);
})();

// Test 20: Migration from old version
await (async () => {
  const oldSnapshot = {
    id: 'old-workflow',
    name: 'Old workflow',
    version: 0,
    createdAt: 1000,
    updatedAt: 2000,
    inputIds: ['a'],
    steps: [
      { id: 's1', operationId: 'image.rotate', options: { angle: 90 } },
    ],
  };
  const model = createWorkflowModel();
  const result = model.deserializeWorkflow(oldSnapshot);
  check('migration returns true', result === true);
  check('migration updates version', model.getVersion() === WORKFLOW_SCHEMA_VERSION);
  check('migration preserves name', model.getName() === 'Old workflow');
  check('migration preserves steps', model.getSteps().length === 1);
  check('migration adds enabled default', model.getSteps()[0].enabled === true);
})();

// Test 21: Schema version constant is accessible
await (async () => {
  check('WORKFLOW_SCHEMA_VERSION is number', typeof WORKFLOW_SCHEMA_VERSION === 'number');
  check('WORKFLOW_SCHEMA_VERSION is >= 1', WORKFLOW_SCHEMA_VERSION >= 1);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-085: Execution history logging ===');

// Test 22: Log execution
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Exec test');
  model.addStep('image.rotate', { angle: 90 });
  const saved = await persistence.save(model);

  const log = await persistence.logExecution(saved.id, { total: 3, completed: 2, failed: 1, cancelled: 0, results: { 'a': 1, 'b': 2 } });
  check('log execution returns entry', !!log);
  check('log execution has id', typeof log.id === 'string');
  check('log execution marks success false', log.success === false);
  check('log execution records totals', log.totalSteps === 3);
  check('log execution records completed', log.completed === 2);
  check('log execution records failed', log.failed === 1);
  check('log execution has completedAt', typeof log.completedAt === 'number');
  check('log execution has resultSummary', log.resultSummary.includes('2 outputs'));
})();

// Test 23: Get execution history
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('History test');
  const saved = await persistence.save(model);

  await persistence.logExecution(saved.id, { total: 1, completed: 1, failed: 0, cancelled: 0, results: { 'a': 1 } });
  await persistence.logExecution(saved.id, { total: 2, completed: 2, failed: 0, cancelled: 0, results: { 'a': 1, 'b': 2 } });

  const history = await persistence.getExecutionHistory(saved.id);
  check('history has 2 entries', history.length === 2);
  check('history first entry success', history[0].success === true);
  check('history second entry success', history[1].success === true);
})();

// Test 24: Execution history capped at 100
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Cap test');
  const saved = await persistence.save(model);

  for (let i = 0; i < 110; i++) {
    await persistence.logExecution(saved.id, { total: 1, completed: 1, failed: 0, cancelled: 0, results: {} });
  }

  const history = await persistence.getExecutionHistory(saved.id);
  check('history capped at 100', history.length === 100);
})();

// Test 25: Log execution success flag
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const model = createWorkflowModel();
  model.setName('Success test');
  const saved = await persistence.save(model);

  const logOk = await persistence.logExecution(saved.id, { total: 5, completed: 5, failed: 0, cancelled: 0, results: {} });
  check('all completed is success', logOk.success === true);

  const logFail = await persistence.logExecution(saved.id, { total: 5, completed: 3, failed: 2, cancelled: 0, results: {} });
  check('some failed is not success', logFail.success === false);

  const logCancel = await persistence.logExecution(saved.id, { total: 5, completed: 4, failed: 0, cancelled: 1, results: {} });
  check('cancelled is not success', logCancel.success === false);
})();

// Test 26: Get history for nonexistent workflow
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const persistence = createWorkflowPersistence(storage, appStore);

  const history = await persistence.getExecutionHistory('nonexistent-id');
  check('nonexistent workflow returns empty history', history.length === 0);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
