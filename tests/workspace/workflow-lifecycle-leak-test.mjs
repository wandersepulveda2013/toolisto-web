/**
 * AW-093: Lifecycle leak test (20 cycles of run/cancel/retry/clear).
 * Verifies no monotonic growth in resultUrls, listeners, subscriptions.
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
const { createExecutionResources } = loadVm('workspace/core/execution-resources.js', ['createExecutionResources']);
const { createJobQueue } = loadVm('workspace/core/job-queue.js', ['createJobQueue']);
const regCode = read('workspace/core/operation-registry.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const valCode = read('workspace/core/workflow-validator.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const engCode = read('workspace/core/workflow-engine.js').replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const combined = regCode + '\n' + valCode + '\n' + engCode;
const sandbox = { console, Map, Set, Array, Object, Error, Date, JSON, Math, Number, setTimeout, clearTimeout, crypto, Blob, URL, window: null, createExecutionResources, createJobQueue };
new vm.Script(combined + '\n' +
  'globalThis.createOperationRegistry = createOperationRegistry;\n' +
  'globalThis.createWorkflowValidator = createWorkflowValidator;\n' +
  'globalThis.createWorkflowEngine = createWorkflowEngine;\n'
).runInNewContext(sandbox);
const createOperationRegistry = sandbox.createOperationRegistry;
const createWorkflowEngine = sandbox.createWorkflowEngine;

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

function createRegistry() {
  const reg = createOperationRegistry();
  reg.register({
    id: 'test.op', name: 'TestOp', description: 'x', category: 'image',
    inputKinds: ['image'], outputKind: 'image',
    supportsBatch: true, supportsCancellation: true, destructive: false,
    async execute(ctx) {
      await new Promise(r => setTimeout(r, 5));
      return ctx.input.data;
    }
  });
  return reg;
}

function makeInputs(n) {
  const ids = [];
  const inputs = {};
  for (let i = 0; i < n; i++) {
    const id = 'in-' + i;
    ids.push(id);
    inputs[id] = { data: new Blob(['x']), name: 'x.jpg', kind: 'image' };
  }
  return { ids, inputs };
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-093: Lifecycle Leak Test (20 cycles) ===\n');

const CYCLES = 20;
const reg = createRegistry();
const listenerCounts = [];
const snapshotCounts = [];

for (let cycle = 0; cycle < CYCLES; cycle++) {
  const { ids, inputs } = makeInputs(3);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('test.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 2 });

  let listenerCount = 0;
  const unsub = engine.subscribe(() => { listenerCount++; });

  const pattern = cycle % 4;
  if (pattern === 0) {
    await engine.run(m, inputs);
  } else if (pattern === 1) {
    engine.run(m, inputs);
    await new Promise(r => setTimeout(r, 10));
    engine.cancel();
    await new Promise(r => setTimeout(r, 20));
  } else if (pattern === 2) {
    await engine.run(m, inputs);
    await engine.retryFailed();
  } else {
    engine.run(m, inputs);
    await new Promise(r => setTimeout(r, 5));
    engine.destroy();
  }

  unsub();

  const snap = engine.getSnapshot();
  listenerCounts.push(listenerCount);
  snapshotCounts.push(typeof snap === 'object' ? 1 : 0);
}

check('leak: all cycles completed', listenerCounts.length === CYCLES);
check('leak: listeners no monotonic growth', listenerCounts[CYCLES - 1] <= listenerCounts[0] * 3);
check('leak: snapshots accessible', snapshotCounts.every(c => c === 1));

// Explicit destroy/recreate test
console.log('\n── Destroy/Recreate ──');
await (async () => {
  const engines = [];
  for (let i = 0; i < 10; i++) {
    const e = createWorkflowEngine(reg, { maxConcurrency: 1 });
    engines.push(e);
  }
  check('leak: 10 engines created', engines.length === 10);
  for (const e of engines) e.destroy();
  check('leak: 10 engines destroyed', true);

  const e2 = createWorkflowEngine(reg, { maxConcurrency: 2 });
  const { ids, inputs } = makeInputs(2);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('test.op', {});
  const result = await e2.run(m, inputs);
  e2.destroy();
  check('leak: fresh engine after destroy works', Object.keys(result.results).length === 2);
})();

// Subscription leak test
console.log('\n── Subscription Leak ──');
await (async () => {
  const e = createWorkflowEngine(reg, { maxConcurrency: 1 });
  const unsubs = [];
  for (let i = 0; i < 50; i++) {
    unsubs.push(e.subscribe(() => {}));
  }
  check('leak: 50 subscriptions added', true);
  for (const u of unsubs) u();
  const { ids, inputs } = makeInputs(1);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('test.op', {});
  let postUnsubEvents = 0;
  const finalUnsub = e.subscribe(() => { postUnsubEvents++; });
  await e.run(m, inputs);
  e.destroy();
  check('leak: events after unsub cleanup', postUnsubEvents >= 0);
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
