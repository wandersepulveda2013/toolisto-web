#!/usr/bin/env node
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const jqCode = readFileSync(join(ROOT, 'workspace', 'core', 'job-queue.js'), 'utf8');
const valCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-validator.js'), 'utf8');
const engCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-engine.js'), 'utf8');

const combined = [
  regCode, jqCode, valCode, engCode,
].map(c => c.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '')).join('\n');

const sandbox = {
  console, Map, Array, Object, Error, Date, JSON, Math, Number,
  Promise, Set, setTimeout, clearTimeout, URL, String, parseInt, parseFloat,
  AbortController: class AbortController { constructor() { this.signal = { aborted: false }; } },
};
const script = new vm.Script(combined + '\nglobalThis.createWorkflowEngine = createWorkflowEngine;\nglobalThis.createOperationRegistry = createOperationRegistry;');
script.runInNewContext(sandbox);
const createOperationRegistry = sandbox.createOperationRegistry;
const createWorkflowEngine = sandbox.createWorkflowEngine;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Workflow Engine Tests ===\n');

// Setup
const registry = createOperationRegistry();
registry.register({
  id: 'image.resize', name: 'Resize', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true,
  destructive: false, execute() {},
  optionSchema: { width: { required: true } },
});
registry.register({
  id: 'image.rotate', name: 'Rotate', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: true,
  destructive: false, execute() {},
  optionSchema: { angle: { required: true } },
});
registry.register({
  id: 'text.export', name: 'Export', description: 'x', category: 'text',
  inputKinds: ['text'], outputKind: 'text', supportsBatch: false, supportsCancellation: false,
  destructive: false, execute() {},
});
registry.register({
  id: 'image.pass', name: 'Pass', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: false,
  destructive: false, execute(ctx) { return { transformed: ctx.input.data }; },
});
registry.register({
  id: 'output.zip', name: 'ZIP', description: 'x', category: 'output',
  inputKinds: ['image', 'multiple'], outputKind: 'file', supportsBatch: true, batchTerminal: true, supportsCancellation: false,
  destructive: false, execute(ctx) { return { packaged: ctx.input.items.map(item => item.data.data.transformed.id) }; },
});

function makeWF(inputIds, steps) {
  return {
    getInputIds: () => inputIds.slice(),
    getActiveSteps: () => steps.filter(s => s.enabled !== false).map(s => ({ ...s })),
  };
}

// 1. Run single step
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = makeWF(['input1'], [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }]);
  const result = await engine.run(wf, { input1: { data: 'test', kind: 'image', name: 'test.jpg' } });
  check('Engine returns success object', result && typeof result === 'object');
  check('Engine state is completed', engine.getState() === 'completed');
}

// 2. Run multiple steps
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = makeWF(['input1'], [
    { operationId: 'image.resize', enabled: true, options: { width: 800 } },
    { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
  ]);
  const result = await engine.run(wf, { input1: { data: 'test', kind: 'image', name: 'test.jpg' } });
  check('Multi-step: completed', engine.getState() === 'completed');
  check('Multi-step: result exists', result.success === true);
}

// 3. Multiple inputs
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = makeWF(['input1', 'input2'], [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }]);
  const result = await engine.run(wf, {
    input1: { data: 'a', kind: 'image', name: 'a.jpg' },
    input2: { data: 'b', kind: 'image', name: 'b.jpg' },
  });
  check('Multiple inputs: completed', engine.getState() === 'completed');
  const rs = result.results || {};
  const completed = Object.values(rs).filter(r => r.status === 'completed').length;
  check('Multiple inputs: both completed', completed === 2);
}

// 4. State transitions
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  check('Initial state: idle', engine.getState() === 'idle');
}

// 5. Invalid workflow
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = makeWF(['input1'], [{ operationId: 'nonexistent', enabled: true, options: {} }]);
  const result = await engine.run(wf, { input1: { data: 'x', kind: 'image', name: 'x.jpg' } });
  check('Invalid operation: not completed', engine.getState() !== 'completed');
  check('Invalid operation: result has validation', result.validation && !result.validation.valid);
}

// 6. No inputs
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = makeWF([], [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }]);
  const result = await engine.run(wf, {});
  check('No inputs: has validation error', result.validation && !result.validation.valid);
}

// 7. Subscribe to events
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const events = [];
  engine.subscribe((ev) => events.push(ev.type));
  const wf = makeWF(['input1'], [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }]);
  await engine.run(wf, { input1: { data: 'test', kind: 'image', name: 'test.jpg' } });
  check('Subscribe receives events', events.length > 0);
}

// 8. Get snapshot
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const snap = engine.getSnapshot();
  check('Get snapshot returns object', typeof snap === 'object');
  check('Get snapshot has state', typeof snap.state === 'string');
}

// 9. Cancel via destroy
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  engine.destroy();
  check('After destroy: state is idle or cancelled', engine.getState() === 'idle' || engine.getState() === 'cancelled');
}

// 10. Run after cancel
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  engine.cancel();
  const wf = makeWF(['input1'], [{ operationId: 'image.rotate', enabled: true, options: { angle: 90 } }]);
  const result = await engine.run(wf, { input1: { data: 'test', kind: 'image', name: 'test.jpg' } });
  check('Run after cancel works', engine.getState() === 'completed');
}

// 11. Batch terminal operation receives transformed outputs once and preserves opaque data
{
  const engine = createWorkflowEngine(registry, { maxConcurrency: 1 });
  const wf = makeWF(['input1', 'input2'], [
    { operationId: 'image.pass', enabled: true, options: {} },
    { operationId: 'output.zip', enabled: true, options: { name: 'fotos.zip' } },
  ]);
  const result = await engine.run(wf, {
    input1: { data: { id: 'a' }, kind: 'image', name: 'a.jpg' },
    input2: { data: { id: 'b' }, kind: 'image', name: 'b.jpg' },
  });
  check('Batch terminal: completed', engine.getState() === 'completed');
  check('Batch terminal: creates one ZIP result', result.results.__batch__?.data?.packaged?.join(',') === 'a,b');
  check('Batch terminal: keeps per-image output data', result.results.input1.data.data.transformed.id === 'a');
}

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);
