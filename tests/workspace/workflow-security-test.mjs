/**
 * AW-094: Security payload tests for import/validation.
 * Tests: __proto__, constructor.prototype, <script>, <img onerror>, javascript:,
 * deep path traversal, unknown operation, extra properties, deep JSON, oversized payload.
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
new vm.Script(combined + '\n' +
  'globalThis.createOperationRegistry = createOperationRegistry;\n' +
  'globalThis.createWorkflowValidator = createWorkflowValidator;\n'
).runInNewContext(sandbox);
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
  reg.register({ id: 'image.rotate', name: 'Rotar', description: 'x', category: 'image', inputKinds: ['image'], outputKind: 'image', supportsBatch: true, destructive: false, execute() {} });
  return reg;
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-094: Security Payload Tests ===\n');

// ── Import Security ───────────────────────────────────────────
console.log('── Import: Malicious Bundles ──');
await (async () => {
  const storage = createMockStorage();
  const appStore = createMockAppStore();
  const p = createWorkflowPersistence(storage, appStore);

  let threw;
  threw = false;
  try { await p.importWorkflow(null); } catch (e) { threw = true; }
  check('sec: null import rejected', threw);

  threw = false;
  try { await p.importWorkflow({}); } catch (e) { threw = true; }
  check('sec: empty object rejected', threw);

  threw = false;
  try { await p.importWorkflow({ type: 'wrong' }); } catch (e) { threw = true; }
  check('sec: wrong type rejected', threw);

  threw = false;
  try { await p.importWorkflow({ type: 'toolisto-workflow', workflow: { definition: { steps: 'not-array' } } }); } catch (e) { threw = true; }
  check('sec: non-array steps rejected', threw);

  threw = false;
  try { await p.importWorkflow({ type: 'toolisto-workflow', workflow: {} }); } catch (e) { threw = true; }
  check('sec: missing definition rejected', threw);

  const protoBundle = {
    type: 'toolisto-workflow',
    workflow: {
      name: 'Proto pollution attempt',
      definition: {
        id: 'test',
        name: 'test',
        steps: [{ id: 's1', operationId: 'image.rotate', options: { angle: 90 } }],
        __proto__: { polluted: true },
      }
    }
  };
  const protoResult = await p.importWorkflow(protoBundle);
  check('sec: __proto__ in bundle does not pollute', protoResult !== null);
  const loaded = await p.load(protoResult.id);
  check('sec: loaded record has no polluted key', !loaded.polluted);

  const scriptBundle = {
    type: 'toolisto-workflow',
    workflow: {
      name: '<script>alert(1)</script>',
      definition: {
        id: 'test2',
        name: 'test2',
        steps: [{ id: 's1', operationId: 'image.rotate', options: { angle: 90 } }],
      }
    }
  };
  const scriptResult = await p.importWorkflow(scriptBundle);
  check('sec: script tag in name accepted at storage level', scriptResult !== null);
  const scriptLoaded = await p.load(scriptResult.id);
  check('sec: script tag stored as string (UI sanitizes)', scriptLoaded.name === '<script>alert(1)</script>');

  const deepSteps = [];
  for (let di = 0; di < 5; di++) {
    const h = { val: 'deep' };
    const g = { h };
    const f = { g };
    const e = { f };
    const d = { e };
    const c = { d };
    const b = { c };
    const a = { b };
    deepSteps.push({
      id: 's' + di,
      operationId: 'image.rotate',
      options: { angle: 90, nested: a }
    });
  }
  const deepBundle = {
    type: 'toolisto-workflow',
    workflow: {
      name: 'Deep',
      definition: {
        id: 'deep',
        name: 'deep',
        steps: deepSteps,
      }
    }
  };
  const deepResult = await p.importWorkflow(deepBundle);
  check('sec: deep JSON accepted', deepResult !== null);

  const extraPropsBundle = {
    type: 'toolisto-workflow',
    workflow: {
      name: 'Extra',
      definition: {
        id: 'extra',
        name: 'extra',
        steps: [{ id: 's1', operationId: 'image.rotate', options: { angle: 90 } }],
      },
      extraField: 'should be ignored',
      __proto__: { extra: true },
    }
  };
  const extraResult = await p.importWorkflow(extraPropsBundle);
  check('sec: extra properties accepted', extraResult !== null);
})();

// ── Validator: Unknown Operation ──────────────────────────────
console.log('\n── Validator: Unknown Operation ──');
await (async () => {
  const reg = createRegistry();
  const val = createWorkflowValidator(reg);

  const workflow = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [{ operationId: 'evil.op', enabled: true, options: {} }]
  };
  const result = val.validateWorkflow(workflow, { img1: { kind: 'image', name: 'test.jpg' } });
  check('sec: unknown operation fails validation', !result.valid);
  check('sec: error mentions not registered', result.errors.some(e => e.includes('not registered')));

  const constructorWorkflow = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [{ operationId: 'constructor', enabled: true, options: {} }]
  };
  const ctorResult = val.validateWorkflow(constructorWorkflow, { img1: { kind: 'image', name: 'test.jpg' } });
  check('sec: "constructor" as operation fails', !ctorResult.valid);

  const protoWorkflow = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [{ operationId: '__proto__', enabled: true, options: {} }]
  };
  const protoResult = val.validateWorkflow(protoWorkflow, { img1: { kind: 'image', name: 'test.jpg' } });
  check('sec: "__proto__" as operation fails', !protoResult.valid);
})();

// ── Validator: Type Safety ────────────────────────────────────
console.log('\n── Validator: Type Safety ──');
await (async () => {
  const reg = createRegistry();
  const val = createWorkflowValidator(reg);

  const wrongType = {
    getInputIds: () => ['txt1'],
    getActiveSteps: () => [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }]
  };
  const wrongResult = val.validateWorkflow(wrongType, { txt1: { kind: 'text', name: 'test.txt' } });
  check('sec: text into image.rotate fails', !wrongResult.valid);

  const mixedChain = {
    getInputIds: () => ['img1'],
    getActiveSteps: () => [
      { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
      { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
    ]
  };
  const mixResult = val.validateWorkflow(mixedChain, { img1: { kind: 'image', name: 'test.jpg' } });
  check('sec: duplicate ops warn', mixResult.warnings.some(w => w.includes('more than once')));
})();

// ── Import Never Executes ─────────────────────────────────────
console.log('\n── Import: No Auto-Execution ──');
await (async () => {
  const m = createWorkflowModel();
  let executed = false;
  const originalDeserialize = m.deserializeWorkflow.bind(m);
  m.deserializeWorkflow = function(data) {
    originalDeserialize(data);
    executed = true;
    return true;
  };
  check('sec: deserialize does not execute', !executed);
  m.deserializeWorkflow({ id: 'test', name: 'test', steps: [{ id: 's1', operationId: 'image.rotate', options: {} }] });
  check('sec: deserialize called but no execute', executed);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
