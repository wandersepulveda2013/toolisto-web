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

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const combined = [regCode, modelCode, valCode, jqCode, engCode].map(stripImports).join('\n');

const fullCode = combined + '\n'
  + 'globalThis.createOperationRegistry = createOperationRegistry;\n'
  + 'globalThis.createJobQueue = createJobQueue;\n'
  + 'globalThis.createWorkflowEngine = createWorkflowEngine;\n'
  + 'globalThis.createWorkflowValidator = createWorkflowValidator;\n';

const ctx = vm.createContext({
  console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
  String, parseInt, parseFloat, setTimeout, clearTimeout, RegExp, Boolean, Symbol,
  URL: { createObjectURL() { return 'blob:mock'; }, revokeObjectURL() {} },
  AbortController: class { constructor() { this.signal = { aborted: false, addEventListener() {}, removeEventListener() {} }; } },
});
vm.runInContext(fullCode, ctx);

const createOperationRegistry = ctx.createOperationRegistry;
const createWorkflowEngine = ctx.createWorkflowEngine;
const createJobQueue = ctx.createJobQueue;
const createWorkflowValidator = ctx.createWorkflowValidator;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Concurrency & Race Condition Tests ===\n');

// Setup
const registry = createOperationRegistry();
registry.register({
  id: 'test.op', name: 'Test', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true,
  destructive: false,
  execute(ctx) { return { processed: true, inputId: ctx.metadata.inputId }; },
});

// Track execution concurrency
let maxConcurrentReached = 0;
let currentConcurrent = 0;
registry.register({
  id: 'test.slow', name: 'Slow', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true,
  destructive: false,
  async execute(ctx) {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrentReached) maxConcurrentReached = currentConcurrent;
    await new Promise(r => setTimeout(r, 50));
    currentConcurrent--;
    return { processed: true };
  },
});

// Test 1: Max concurrency not exceeded
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 2 });
  const steps = [{ operationId: 'test.slow', enabled: true, options: {} }];
  const inputs = { i1: { data: 'x', kind: 'image' }, i2: { data: 'x', kind: 'image' }, i3: { data: 'x', kind: 'image' } };
  const wf = { getInputIds: () => ['i1', 'i2', 'i3'], getActiveSteps: () => steps };
  const result = await engine.run(wf, inputs);
  check('1. Max concurrency respected (<=2)', maxConcurrentReached <= 2);
  check('2. All completed', result.state === 'completed');
}

// Test 2: Two engines do not share state
{
  const e1 = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const e2 = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = { getInputIds: () => ['i1'], getActiveSteps: () => [{ operationId: 'test.op', enabled: true, options: {} }] };
  const r1 = await e1.run(wf, { i1: { data: 'a', kind: 'image' } });
  const r2 = await e2.run(wf, { i1: { data: 'b', kind: 'image' } });
  check('3. Engine 1 isolated', r1.state === 'completed');
  check('4. Engine 2 isolated', r2.state === 'completed');
}

// Test 3: Cancel then re-run works
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = { getInputIds: () => ['i1'], getActiveSteps: () => [{ operationId: 'test.slow', enabled: true, options: {} }] };
  const runPromise = engine.run(wf, { i1: { data: 'x', kind: 'image' } });
  await new Promise(r => setTimeout(r, 10));
  engine.cancel();
  const r1 = await runPromise;
  check('5. Cancel returns cancelled state', r1.state === 'cancelled' || r1.state === 'cancelling');

  // Re-run
  const r2 = await engine.run(wf, { i1: { data: 'x', kind: 'image' } });
  check('6. Re-run after cancel works', r2.state === 'completed');
}

// Test 4: Double run is rejected
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = { getInputIds: () => ['i1'], getActiveSteps: () => [{ operationId: 'test.op', enabled: true, options: {} }] };
  engine.run(wf, { i1: { data: 'x', kind: 'image' } }).catch(() => {});
  let threw = false;
  try { await engine.run(wf, { i1: { data: 'x', kind: 'image' } }); } catch (e) { threw = true; }
  check('7. Double run throws', threw);
}

// Test 5: Per-file error isolation
{
  registry.register({
    id: 'test.fail', name: 'Fail', description: 'x', category: 'image',
    inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true,
    destructive: false,
    async execute(ctx) {
      if (ctx.metadata.inputId === 'i2') throw new Error('Intentional failure');
      return { ok: true };
    },
  });
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const steps = [{ operationId: 'test.fail', enabled: true, options: {} }];
  const wf = { getInputIds: () => ['i1', 'i2', 'i3'], getActiveSteps: () => steps };
  const r = await engine.run(wf, { i1: { data: 'a', kind: 'image' }, i2: { data: 'b', kind: 'image' }, i3: { data: 'c', kind: 'image' } });
  const results = r.results;
  check('8. Input 1 completed', results.i1 && results.i1.status === 'completed');
  check('9. Input 2 failed', results.i2 && results.i2.status === 'failed');
  check('10. Input 3 completed', results.i3 && results.i3.status === 'completed');
  check('11. State is completed_with_errors', r.state === 'completed_with_errors');
}

// Test 6: Retry only failed inputs
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const steps = [{ operationId: 'test.fail', enabled: true, options: {} }];
  const wf = { getInputIds: () => ['i1', 'i2'], getActiveSteps: () => steps, setInputs: (ids) => { wf._ids = ids; } };
  await engine.run(wf, { i1: { data: 'a', kind: 'image' }, i2: { data: 'b', kind: 'image' } });
  const snap = engine.getSnapshot();
  check('12. Snapshot shows 1 failed', snap.failed === 1);
}

// Test 7: Subscribe listener is cleaned
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const events = [];
  const unsub = engine.subscribe((ev) => events.push(ev.type));
  unsub();
  const wf = { getInputIds: () => ['i1'], getActiveSteps: () => [{ operationId: 'test.op', enabled: true, options: {} }] };
  await engine.run(wf, { i1: { data: 'a', kind: 'image' } });
  check('13. Unsubscribed listener not called', events.length === 0);
}

// Test 8: Destroy clears everything
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = { getInputIds: () => ['i1'], getActiveSteps: () => [{ operationId: 'test.slow', enabled: true, options: {} }] };
  engine.run(wf, { i1: { data: 'a', kind: 'image' } }).catch(() => {});
  await new Promise(r => setTimeout(r, 5));
  engine.destroy();
  const snap = engine.getSnapshot();
  check('14. After destroy state is idle or cancelling', snap.state === 'idle' || snap.state === 'cancelling' || snap.state === 'cancelled');
}

// Test 9: Cancel race — cancel near completion
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const steps = [{ operationId: 'test.op', enabled: true, options: {} }];
  const wf = { getInputIds: () => ['i1', 'i2'], getActiveSteps: () => steps };
  const p = engine.run(wf, { i1: { data: 'a', kind: 'image' }, i2: { data: 'b', kind: 'image' } });
  engine.cancel();
  const r = await p;
  check('15. Cancel race ends cleanly', r.state === 'cancelled' || r.state === 'completed' || r.state === 'completed_with_errors');
}

// Test 10: Queue wrapper integration
{
  const q = createJobQueue({ maxConcurrency: 1 });
  let completed = 0;
  q.subscribe((ev) => { if (ev.type === 'completed') completed++; });
  q.add({ execute: () => new Promise(r => setTimeout(() => r('a'), 10)) });
  q.add({ execute: () => new Promise(r => setTimeout(() => r('b'), 10)) });
  await new Promise(r => setTimeout(() => r(), 100));
  check('16. Queue runs both jobs', completed === 2);
}

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
