/**
 * AW-091/092: Cancel/retry UX tests.
 * Tests: cancel pending, cancel running, cancel between nodes, retry single,
 * retry all, successes preserved.
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

function createRegistry(opts = {}) {
  const reg = createOperationRegistry();
  reg.register({
    id: 'slow.op', name: 'SlowOp', description: 'x', category: 'image',
    inputKinds: ['image'], outputKind: 'image',
    supportsBatch: true, supportsCancellation: true, destructive: false,
    async execute(ctx) {
      if (opts.slowMs) await new Promise(r => setTimeout(r, opts.slowMs));
      if (opts.failOnInput) {
        const name = ctx.input?.name || '';
        if (name.includes(opts.failOnInput)) throw new Error('Intentional failure for ' + name);
      }
      return ctx.input.data || ctx.input;
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
    inputs[id] = { data: new Blob(['file-' + i]), name: 'file-' + i + '.jpg', kind: 'image' };
  }
  return { ids, inputs };
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== AW-091/092: Cancel/Retry Tests ===\n');

// ── AW-091: Cancel ────────────────────────────────────────────
console.log('── AW-091: Cancel Tests ──');

// Cancel running
await (async () => {
  const reg = createRegistry({ slowMs: 50 });
  const { ids, inputs } = makeInputs(4);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 2 });
  const runPromise = engine.run(m, inputs);
  await new Promise(r => setTimeout(r, 10));
  engine.cancel();
  const result = await runPromise;

  check('cancel-running: engine state is cancelled', result.state === 'cancelled' || engine.getState() === 'cancelled');
  check('cancel-running: has results', typeof result.results === 'object');
})();

// Cancel all idle (before running)
await (async () => {
  const reg = createRegistry();
  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  engine.cancel();
  check('cancel-idle: cancel on idle is idempotent', engine.getState() === 'idle' || engine.getState() === 'cancelling');
  engine.destroy();
})();

// Cancel individual job
await (async () => {
  const reg = createRegistry({ slowMs: 200 });
  const { ids, inputs } = makeInputs(3);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  const runPromise = engine.run(m, inputs);
  await new Promise(r => setTimeout(r, 20));
  engine.cancelJob('in-1');
  const result = await runPromise;
  engine.destroy();

  const cancelled = Object.values(result.results).filter(r => r.status === 'cancelled');
  check('cancel-job: at least one cancelled', cancelled.length >= 1);
})();

// Cancel between nodes (multi-step)
await (async () => {
  const reg = createRegistry({ slowMs: 30 });
  reg.register({
    id: 'step2.op', name: 'Step2', description: 'x', category: 'image',
    inputKinds: ['image'], outputKind: 'image',
    supportsBatch: true, supportsCancellation: true, destructive: false,
    async execute(ctx) {
      await new Promise(r => setTimeout(r, 30));
      return ctx.input.data;
    }
  });
  const { ids, inputs } = makeInputs(2);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});
  m.addStep('step2.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  const runPromise = engine.run(m, inputs);
  await new Promise(r => setTimeout(r, 50));
  engine.cancel();
  const result = await runPromise;
  engine.destroy();
  check('cancel-between-nodes: cancelled state', result.state === 'cancelled');
})();

// ── AW-092: Retry ─────────────────────────────────────────────
console.log('\n── AW-092: Retry Tests ──');

// Retry single failed input
await (async () => {
  const reg = createRegistry({ failOnInput: 'fail' });
  const ids = ['ok1', 'fail1', 'ok2'];
  const inputs = {
    ok1: { data: new Blob(['ok1']), name: 'ok1.jpg', kind: 'image' },
    fail1: { data: new Blob(['fail1']), name: 'fail1.jpg', kind: 'image' },
    ok2: { data: new Blob(['ok2']), name: 'ok2.jpg', kind: 'image' },
  };
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  const result = await engine.run(m, inputs);
  check('retry-single: initial has failures', result.results.fail1?.status === 'failed');
  check('retry-single: ok1 completed', result.results.ok1?.status === 'completed');

  const retryResult = await engine.retryFailed();
  check('retry-single: retry finished (failed or completed)', retryResult.state === 'completed' || retryResult.state === 'failed');
  check('retry-single: fail1 still failed', retryResult.results.fail1?.status === 'failed');
  check('retry-single: ok1 preserved', retryResult.results.ok1?.status === 'completed');
  engine.destroy();
})();

// Retry all failed
await (async () => {
  const reg = createRegistry({ failOnInput: 'bad' });
  const ids = ['bad1', 'bad2', 'bad3'];
  const inputs = {
    bad1: { data: new Blob(['x']), name: 'bad1.jpg', kind: 'image' },
    bad2: { data: new Blob(['x']), name: 'bad2.jpg', kind: 'image' },
    bad3: { data: new Blob(['x']), name: 'bad3.jpg', kind: 'image' },
  };
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  const result = await engine.run(m, inputs);
  check('retry-all: all failed initially', Object.values(result.results).every(r => r.status === 'failed'));

  const retryResult = await engine.retryFailed();
  check('retry-all: still all failed after retry', Object.values(retryResult.results).every(r => r.status === 'failed'));
  engine.destroy();
})();

// Retry with no failures
await (async () => {
  const reg = createRegistry();
  const { ids, inputs } = makeInputs(3);
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 2 });
  await engine.run(m, inputs);
  const retryResult = await engine.retryFailed();
  check('retry-none: no-op when no failures', retryResult.state === 'completed');
  engine.destroy();
})();

// Successes preserved across retry
await (async () => {
  const reg = createRegistry({ failOnInput: 'fail' });
  const ids = ['ok1', 'ok2', 'fail1'];
  const inputs = {
    ok1: { data: new Blob(['ok1']), name: 'ok1.jpg', kind: 'image' },
    ok2: { data: new Blob(['ok2']), name: 'ok2.jpg', kind: 'image' },
    fail1: { data: new Blob(['fail1']), name: 'fail1.jpg', kind: 'image' },
  };
  const m = createWorkflowModel();
  m.setInputs(ids);
  m.addStep('slow.op', {});

  const engine = createWorkflowEngine(reg, { maxConcurrency: 1 });
  await engine.run(m, inputs);
  const retryResult = await engine.retryFailed();
  check('retry-preserve: ok1 still completed', retryResult.results.ok1?.status === 'completed');
  check('retry-preserve: ok2 still completed', retryResult.results.ok2?.status === 'completed');
  engine.destroy();
})();

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
