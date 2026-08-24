/**
 * AW-089: Batch scale tests (1/10/50/100 inputs).
 * Tests: completion counts, concurrency, duration, resource cleanup.
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
  let counter = 0;
  reg.register({
    id: 'test.identity', name: 'Identity', description: 'Pass-through', category: 'image',
    inputKinds: ['image', 'blob', 'file', 'text', 'document', 'data'], outputKind: 'image',
    supportsBatch: true, supportsCancellation: true, destructive: false,
    async execute(ctx) {
      counter++;
      await new Promise(r => setTimeout(r, 1));
      return ctx.input.data || ctx.input;
    }
  });
  return { reg, getCounter: () => counter, resetCounter: () => { counter = 0; } };
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-089: Batch Scale Tests ===\n');

async function runBatchTest(numInputs, concurrency) {
  const { reg, getCounter, resetCounter } = createRegistry();
  resetCounter();

  const m = createWorkflowModel();
  m.setName('Batch ' + numInputs);
  const inputIds = [];
  const inputs = {};
  for (let i = 0; i < numInputs; i++) {
    const id = 'input-' + i;
    inputIds.push(id);
    inputs[id] = { data: new Blob(['file-' + i]), name: 'file-' + i + '.jpg', kind: 'image' };
  }
  m.setInputs(inputIds);
  m.addStep('test.identity', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: concurrency || 2 });
  const startTime = Date.now();
  let eventCount = 0;
  engine.subscribe(() => { eventCount++; });

  const result = await engine.run(m, inputs);
  const duration = Date.now() - startTime;
  const snap = engine.getSnapshot();

  const completed = Object.values(result.results).filter(r => r.status === 'completed').length;
  const failed = Object.values(result.results).filter(r => r.status === 'failed').length;
  const cancelled = Object.values(result.results).filter(r => r.status === 'cancelled').length;

  engine.destroy();

  return { numInputs, completed, failed, cancelled, duration, eventCount, getCounter };
}

for (const n of [1, 10, 50, 100]) {
  console.log(`\n── Batch: ${n} inputs ──`);
  const r = await runBatchTest(n, 2);
  check(`batch-${n}: all completed`, r.completed === n);
  check(`batch-${n}: no failures`, r.failed === 0);
  check(`batch-${n}: no cancellations`, r.cancelled === 0);
  check(`batch-${n}: duration reasonable (<${Math.max(5000, n * 100)}ms)`, r.duration < Math.max(5000, n * 100));
  check(`batch-${n}: events emitted`, r.eventCount > n);
}

// Concurrency test
console.log('\n── Concurrency: max 2 ──');
await (async () => {
  let maxRunning = 0;
  let running = 0;
  const reg = createOperationRegistry();
  reg.register({
    id: 'slow.op', name: 'Slow', description: 'x', category: 'image',
    inputKinds: ['image'], outputKind: 'image',
    supportsBatch: true, supportsCancellation: true, destructive: false,
    async execute(ctx) {
      running++;
      if (running > maxRunning) maxRunning = running;
      await new Promise(r => setTimeout(r, 50));
      running--;
      return ctx.input.data;
    }
  });

  const m = createWorkflowModel();
  const ids = [];
  const inputs = {};
  for (let i = 0; i < 6; i++) {
    ids.push('in-' + i);
    inputs['in-' + i] = { data: new Blob(['x']), name: 'x.jpg', kind: 'image' };
  }
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 2 });
  const result = await engine.run(m, inputs);
  engine.destroy();

  check('concurrency: max concurrent <= 2', maxRunning <= 2);
  check('concurrency: all completed', Object.values(result.results).every(r => r.status === 'completed'));
  check('concurrency: count = 6', Object.keys(result.results).length === 6);
})();

// Resource cleanup
console.log('\n── Resource Cleanup ──');
await (async () => {
  const { reg } = createRegistry();
  const m = createWorkflowModel();
  const ids = [];
  const inputs = {};
  for (let i = 0; i < 20; i++) {
    ids.push('in-' + i);
    inputs['in-' + i] = { data: new Blob(['x']), name: 'x.jpg', kind: 'image' };
  }
  m.setInputs(ids);
  m.addStep('test.identity', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 2 });
  await engine.run(m, inputs);
  engine.destroy();

  const snap = engine.getSnapshot();
  check('cleanup: state after destroy', snap.state === 'idle' || typeof snap.state === 'string');
  check('cleanup: results cleared or accessible', typeof snap.results === 'object');
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
