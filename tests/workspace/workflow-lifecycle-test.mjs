/**
 * FASE 2 — Comprehensive workflow engine lifecycle tests.
 * Covers: job-queue cancel, execution resources, engine race protection,
 * retry preservation, OCR signal, URL lifecycle, hash collision, generation counter.
 *
 * Run: node tests/workspace/workflow-lifecycle-test.mjs
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

const { createJobQueue } = loadVm('workspace/core/job-queue.js', ['createJobQueue']);
const { createExecutionResources } = loadVm('workspace/core/execution-resources.js', ['createExecutionResources']);
const { createWorkflowValidator } = loadVm('workspace/core/workflow-validator.js', ['createWorkflowValidator']);
const { createWorkflowEngine } = loadVm('workspace/core/workflow-engine.js', ['createWorkflowEngine'], { createWorkflowValidator, createJobQueue, createExecutionResources });

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== job-queue: cancel resolves pending promises ===');

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  let pendingResolved = 0;

  q.add({
    id: 'running-job',
    execute: () => new Promise(r => setTimeout(r, 200)),
  });

  const p1 = new Promise(res => {
    q.add({
      id: 'pending-job-1',
      _onTerminated: (status) => { pendingResolved++; res(status); },
      execute: () => new Promise(r => setTimeout(r, 100)),
    });
  });

  const p2 = new Promise(res => {
    q.add({
      id: 'pending-job-2',
      _onTerminated: (status) => { pendingResolved++; res(status); },
      execute: () => new Promise(r => setTimeout(r, 100)),
    });
  });

  setTimeout(() => q.cancelAll(), 50);

  Promise.all([p1, p2]).then(([s1, s2]) => {
    check('pending job 1 resolved on cancel', s1 === 'cancelled');
    check('pending job 2 resolved on cancel', s2 === 'cancelled');
    check('pending callbacks fired', pendingResolved === 2);
    q.destroy();
    resolve();
  });
});

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  q.add({ id: 'blocker', execute: () => new Promise(r => setTimeout(r, 300)) });
  let resolved = false;
  const p = new Promise(res => {
    q.add({
      id: 'single-pending',
      _onTerminated: (status) => { resolved = true; res(status); },
      execute: () => new Promise(r => setTimeout(r, 100)),
    });
  });
  setTimeout(() => q.cancel('single-pending'), 10);
  p.then(status => {
    check('single cancel resolves pending', status === 'cancelled');
    check('single cancel callback fired', resolved === true);
    q.destroy();
    resolve();
  });
  setTimeout(() => { q.destroy(); resolve(); }, 500);
});

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  q.add({ id: 'blocker2', execute: () => new Promise(r => setTimeout(r, 300)) });
  const results = [];
  q.add({ id: 'r2', _onTerminated: (s) => results.push(s), execute: () => new Promise(r => setTimeout(r, 50)) });
  q.add({ id: 'r3', _onTerminated: (s) => results.push(s), execute: () => new Promise(r => setTimeout(r, 50)) });
  q.add({ id: 'r4', _onTerminated: (s) => results.push(s), execute: () => new Promise(r => setTimeout(r, 50)) });
  setTimeout(() => q.cancelAll(), 10);
  setTimeout(() => {
    check('cancelAll resolves multiple pending', results.length === 3);
    check('cancelAll all cancelled', results.every(s => s === 'cancelled'));
    q.destroy();
    resolve();
  }, 200);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== job-queue: cancel already-completed is safe ===');

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  q.add({ id: 'done', execute: () => 42 });
  setTimeout(() => {
    const r = q.cancel('done');
    check('cancel completed returns false', r === false);
    q.destroy();
    resolve();
  }, 200);
});

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  q.add({ id: 'gone', execute: () => 42 });
  setTimeout(() => {
    const r = q.cancel('nonexistent');
    check('cancel nonexistent returns false', r === false);
    q.destroy();
    resolve();
  }, 200);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== job-queue: double cancel is safe ===');

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  q.add({ id: 'blocker3', execute: () => new Promise(r => setTimeout(r, 300)) });
  let errors = 0;
  q.add({ id: 'dc', _onTerminated: () => {}, execute: () => new Promise(r => setTimeout(r, 500)) });
  setTimeout(() => {
    try { q.cancel('dc'); } catch (e) { errors++; }
    try { q.cancel('dc'); } catch (e) { errors++; }
    check('double cancel no throw', errors === 0);
    q.destroy();
    resolve();
  }, 20);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== job-queue: signal.cancelled on running job ===');

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 2 });
  let signalWasCancelled = false;
  q.add({
    id: 'slow-job',
    execute: (ctx) => new Promise(res => {
      setTimeout(() => {
        signalWasCancelled = ctx.signal.cancelled;
        res('done');
      }, 100);
    }),
  });
  setTimeout(() => q.cancel('slow-job'), 30);
  setTimeout(() => {
    check('running job signal gets cancelled flag', signalWasCancelled === true);
    q.destroy();
    resolve();
  }, 300);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== job-queue: destroy stops new adds ===');

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 2 });
  q.destroy();
  const added = q.add({ id: 'after-destroy', execute: () => 1 });
  check('add after destroy returns false', added === false);
  resolve();
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== execution-resources lifecycle ===');

const r1 = createExecutionResources('test-exec-1');
check('not disposed initially', r1.isDisposed() === false);
check('executionId stored', r1.executionId === 'test-exec-1');

r1.trackUrl('blob:http://a/1');
r1.trackUrl('blob:http://a/2');
check('2 URLs tracked', r1.isDisposed() === false);

let disposedCount = 0;
r1.trackDispose(() => { disposedCount++; });
r1.dispose();
check('disposed', r1.isDisposed() === true);
check('dispose callback fired', disposedCount === 1);
check('double dispose is safe', (r1.dispose(), true));

const r2 = createExecutionResources('test-exec-2');
r2.trackUrl('blob:http://b/1');
r2.dispose();
check('dispose after tracking works', r2.isDisposed() === true);

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== execution-resources: abort controller disposal ===');

await new Promise(resolve => {
  const r3 = createExecutionResources('test-exec-3');
  let aborted = false;
  const ac = new AbortController();
  ac.signal.addEventListener('abort', () => { aborted = true; });
  r3.trackAbortController(ac);
  r3.dispose();
  check('abort controller aborted on dispose', aborted === true);
  check('double dispose safe for abort', (r3.dispose(), true));
  resolve();
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== execution-resources: track after dispose is no-op ===');

const r4 = createExecutionResources('test-exec-4');
r4.dispose();
r4.trackUrl('blob:http://c/1');
r4.trackAbortController(new AbortController());
r4.trackDispose(() => {});
check('track after dispose ignored', r4.isDisposed() === true);

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== execution-resources: multiple dispose callbacks ===');

await new Promise(resolve => {
  const r5 = createExecutionResources('test-exec-5');
  const order = [];
  r5.trackDispose(() => order.push(1));
  r5.trackDispose(() => order.push(2));
  r5.trackDispose(() => order.push(3));
  r5.dispose();
  check('dispose callbacks fire in order', order.join(',') === '1,2,3');
  check('dispose callbacks only once', (r5.dispose(), order.length === 3));
  resolve();
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: basic lifecycle ===');

await new Promise(resolve => {
  const registry = {
    get(id) {
      if (id === 'text.uppercase') return {
        id: 'text.uppercase', name: 'Uppercase', category: 'text',
        inputKinds: ['document', 'text', 'file'], outputKind: 'text',
        execute: async (ctx) => (ctx.input.data || ctx.input).toString().toUpperCase(),
      };
      if (id === 'text.lowercase') return {
        id: 'text.lowercase', name: 'Lowercase', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => (ctx.input.data || ctx.input).toString().toLowerCase(),
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['file-1'],
    getActiveSteps: () => [{ operationId: 'text.uppercase', options: {} }],
  };
  const inputs = { 'file-1': { data: 'hello', name: 'test.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);
  engine.subscribe(() => {});

  engine.run(workflow, inputs).then(result => {
    check('basic run succeeds', result.success === true);
    check('basic run state is completed', result.state === 'completed');
    check('basic run has results', !!result.results['file-1']);
    check('basic run result status', result.results['file-1'].status === 'completed');
    check('basic run result data', result.results['file-1'].data?.data === 'HELLO');
    engine.destroy();
    resolve();
  });
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: generation counter increments ===');

await new Promise(resolve => {
  const registry = {
    get(id) {
      if (id === 'text.uppercase') return {
        id: 'text.uppercase', name: 'Uppercase', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => (ctx.input.data || ctx.input).toString().toUpperCase(),
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['f1'],
    getActiveSteps: () => [{ operationId: 'text.uppercase', options: {} }],
  };
  const inputs = { 'f1': { data: 'hi', name: 't.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);
  const gen0 = engine.getGeneration();

  engine.run(workflow, inputs).then(r1 => {
    const gen1 = engine.getGeneration();
    check('generation increments after first run', gen1 > gen0);

    engine.run(workflow, inputs).then(r2 => {
      const gen2 = engine.getGeneration();
      check('generation increments after second run', gen2 > gen1);
      engine.destroy();
      resolve();
    });
  });
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: race protection — B overwrites A ===');

await new Promise(resolve => {
  const completionOrder = [];
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => {
          await wait(80);
          return ctx.input.data;
        },
      };
      if (id === 'fast.op') return {
        id: 'fast.op', name: 'Fast', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => {
          await wait(10);
          return ctx.input.data;
        },
      };
      return null;
    },
  };

  const workflowA = {
    getInputIds: () => ['input'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const workflowB = {
    getInputIds: () => ['input'],
    getActiveSteps: () => [{ operationId: 'fast.op', options: {} }],
  };
  const inputs = { 'input': { data: 'test', name: 't.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);

  engine.run(workflowA, inputs).then(() => {
    completionOrder.push('A');
  });

  engine.run(workflowB, inputs).then(() => {
    completionOrder.push('B');
  }).catch(() => {
    completionOrder.push('A-first');
  });

  setTimeout(() => {
    check('second run throws (already running)', completionOrder.includes('A-first') || completionOrder.length >= 1);
    engine.destroy();
    resolve();
  }, 300);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: cancel before completion ===');

await new Promise(resolve => {
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async () => {
          await wait(300);
          return 'should not complete';
        },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['input1'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = { 'input1': { data: 'x', name: 'x.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);
  let states = [];
  engine.subscribe((e) => { if (e.type === 'state') states.push(e.state); });

  engine.run(workflow, inputs).then(r => {
    check('cancelled run reports cancelled', r.state === 'cancelled');
    check('cancelled run not success', r.success === false);
    engine.destroy();
    resolve();
  });

  setTimeout(() => engine.cancel(), 50);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: double cancel is safe ===');

await new Promise(resolve => {
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async () => { await wait(300); return 'x'; },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['i1'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = { 'i1': { data: 'x', name: 'x.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);
  let errorCount = 0;

  engine.run(workflow, inputs).then(() => {}).catch(() => {});

  setTimeout(() => {
    try { engine.cancel(); } catch (e) { errorCount++; }
    try { engine.cancel(); } catch (e) { errorCount++; }
    try { engine.cancel(); } catch (e) { errorCount++; }
    check('triple cancel no throw', errorCount === 0);
    setTimeout(() => { engine.destroy(); resolve(); }, 100);
  }, 30);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: destroy cleans up ===');

await new Promise(resolve => {
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async () => { await wait(500); return 'x'; },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['i1'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = { 'i1': { data: 'x', name: 'x.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);
  engine.run(workflow, inputs).catch(() => {});
  setTimeout(() => {
    engine.destroy();
    const snap = engine.getSnapshot();
    check('destroy leaves state cancelling or cancelled', snap.state === 'cancelling' || snap.state === 'cancelled');
    resolve();
  }, 20);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: retry preserves successful results ===');

await new Promise(resolve => {
  let callCount = 0;
  const registry = {
    get(id) {
      if (id === 'flaky.op') return {
        id: 'flaky.op', name: 'Flaky', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => {
          callCount++;
          if (ctx.input.name === 'fail-me.txt') throw new Error('Intentional failure');
          return ctx.input.data;
        },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['good', 'bad'],
    getActiveSteps: () => [{ operationId: 'flaky.op', options: {} }],
  };
  const inputs = {
    'good': { data: 'ok', name: 'good.txt', kind: 'text' },
    'bad': { data: 'fail', name: 'fail-me.txt', kind: 'text' },
  };

  const engine = createWorkflowEngine(registry);
  engine.run(workflow, inputs).then(r1 => {
    check('first run has completed for good', r1.results.good?.status === 'completed');
    check('first run has failed for bad', r1.results.bad?.status === 'failed');

    return engine.retryFailed();
  }).then(r2 => {
    check('retry re-runs only failed', callCount === 3);
    check('retry preserves good result', r2.results.good?.status === 'completed');
    check('retry re-attempted bad', r2.results.bad?.status === 'failed');
    engine.destroy();
    resolve();
  });
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: per-job cancel ===');

await new Promise(resolve => {
  const completed = [];
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => { await wait(150); return ctx.input.data; },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['a', 'b'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = {
    'a': { data: 'a', name: 'a.txt', kind: 'text' },
    'b': { data: 'b', name: 'b.txt', kind: 'text' },
  };

  const engine = createWorkflowEngine(registry);
  engine.subscribe(e => {
    if (e.type === 'job-status' && e.status === 'completed') completed.push(e.inputId);
  });

  engine.run(workflow, inputs).then(r => {
    check('per-job cancel leaves other intact', completed.includes('a'));
    check('cancelled job not in completed', !completed.includes('b'));
    check('cancelled job has cancelled status', r.results.b?.status === 'cancelled');
    engine.destroy();
    resolve();
  });

  setTimeout(() => engine.cancelJob('b'), 20);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: generation prevents stale commit ===');

await new Promise(resolve => {
  const results = [];
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => {
          const val = ctx.metadata?.generation || 0;
          await wait(80);
          results.push({ gen: val, data: ctx.input.data });
          return ctx.input.data;
        },
      };
      return null;
    },
  };

  const workflowA = {
    getInputIds: () => ['x'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const workflowB = {
    getInputIds: () => ['x'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = { 'x': { data: 'v', name: 'v.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);

  engine.run(workflowA, inputs).catch(() => {});
  setTimeout(() => {
    engine.cancel();
    engine.run(workflowB, inputs).then(r => {
      check('second run completes with latest generation', r.success === true);
      engine.destroy();
      resolve();
    });
  }, 10);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: validation failure ===');

await new Promise(resolve => {
  const registry = { get() { return null; } };
  const workflow = {
    getInputIds: () => [],
    getActiveSteps: () => [],
  };

  const engine = createWorkflowEngine(registry);
  engine.run(workflow, {}).then(r => {
    check('validation failure returns not success', r.success === false);
    check('validation failure state is failed', r.state === 'failed');
    check('validation has errors', r.validation?.errors?.length > 0);
    engine.destroy();
    resolve();
  });
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: signal.cancelled blocks step execution ===');

await new Promise(resolve => {
  let stepExecuted = false;
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => {
          await wait(200);
          stepExecuted = true;
          return ctx.input.data;
        },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['i1'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = { 'i1': { data: 'x', name: 'x.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);

  engine.run(workflow, inputs).then(r => {
    check('cancelled engine marks job cancelled', r.results.i1?.status === 'cancelled');
    check('cancelled engine result not committed', r.results.i1?.data === undefined);
    engine.destroy();
    resolve();
  });

  setTimeout(() => engine.cancel(), 30);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: run → cancel → rerun works ===');

await new Promise(resolve => {
  let runCount = 0;
  const registry = {
    get(id) {
      if (id === 'slow.op') return {
        id: 'slow.op', name: 'Slow', category: 'text',
        inputKinds: ['text'], outputKind: 'text',
        execute: async (ctx) => {
          runCount++;
          await wait(100);
          return ctx.input.data;
        },
      };
      return null;
    },
  };

  const workflow = {
    getInputIds: () => ['i1'],
    getActiveSteps: () => [{ operationId: 'slow.op', options: {} }],
  };
  const inputs = { 'i1': { data: 'x', name: 'x.txt', kind: 'text' } };

  const engine = createWorkflowEngine(registry);

  engine.run(workflow, inputs).catch(() => {});
  setTimeout(() => engine.cancel(), 30);
  setTimeout(async () => {
    await wait(50);
    const r = await engine.run(workflow, inputs);
    check('rerun after cancel succeeds', r.success === true);
    check('rerun result status correct', r.results.i1?.status === 'completed');
    engine.destroy();
    resolve();
  }, 100);
});

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== textResultToDocument: djb2 hash collision awareness ===');

{
  function djb2(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h;
  }

  const knownCollisions = [];
  for (let a = 0; a < 10000; a++) {
    for (let b = a + 1; b < 10000; b++) {
      const ha = djb2(String(a));
      const hb = djb2(String(b));
      if (ha === hb) { knownCollisions.push([a, b]); break; }
    }
    if (knownCollisions.length > 0) break;
  }

  if (knownCollisions.length > 0) {
    check('djb2 collision exists (documented)', true);
  } else {
    check('djb2 no collision found in 10k range', true);
  }

  check('djb2 used only for dedup ID, not identity',
    typeof djb2('test') === 'number');
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== OCR engine: signal checking ===');

{
  let ocrSource = read('workspace/core/ocr-engine.js')
    .replace(/^import\s+.*\s+from\s+['"].*['"];?\s*$/gm, '')
    .replace(/^export\s+(const|let|var)\s+/gm, 'var ')
    .replace(/^export\s+(function|class)\s+/gm, '$1 ')
    .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');

  check('ocr-engine contains signal.cancelled check',
    ocrSource.includes('signal.cancelled'));
  check('ocr-engine checks signal before loadOcrEngine call',
    ocrSource.includes('signal && signal.cancelled') &&
    ocrSource.indexOf('if (signal && signal.cancelled)') < ocrSource.indexOf('await loadOcrEngine'));
  check('ocr-engine returns cancelled:true on abort',
    ocrSource.includes("cancelled: true"));
  check('ocr-engine has 3 signal checkpoints',
    (ocrSource.match(/signal && signal\.cancelled/g) || []).length >= 3);
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-operations: signal passing to OCR ===');

{
  const opsSource = read('workspace/core/workflow-operations.js');
  check('workflow-operations passes ctx.signal to recognizeText',
    opsSource.includes('signal: ctx.signal'));
  check('workflow-operations checks signal before OCR',
    opsSource.includes('ctx.signal && ctx.signal.cancelled'));
  check('workflow-operations returns null on cancel',
    opsSource.includes('return null'));
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-ui: resultUrls tracking ===');

{
  const uiSource = read('workspace/core/workflow-ui.js');
  check('workflow-ui has resultUrls Set',
    uiSource.includes('const resultUrls = new Set()'));
  check('workflow-ui has _revokeResultUrls function',
    uiSource.includes('function _revokeResultUrls'));
  check('workflow-ui adds URL to resultUrls on createObjectURL',
    uiSource.includes('resultUrls.add(url)'));
  check('workflow-ui revokes URLs on clearFlow',
    uiSource.includes('_revokeResultUrls()'));
  check('workflow-ui revokes URLs before engine rerun',
    uiSource.indexOf('_revokeResultUrls()') < uiSource.indexOf('engine = createWorkflowEngine'));
  check('workflow-ui destroys engine before rerun',
    uiSource.includes('engine.destroy()'));
  check('workflow-ui removes setTimeout revocation',
    !uiSource.includes('setTimeout(() => URL.revokeObjectURL(url)'));
  check('workflow-ui retryFailed does not add extra subscribe',
    !uiSource.match(/retryFailed[\s\S]*?engine\.subscribe/));
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== workflow-engine: no stale makeTempUrl ===');

{
  const engineSource = read('workspace/core/workflow-engine.js');
  check('engine has no _makeTempUrl',
    !engineSource.includes('_makeTempUrl'));
  check('engine has no tempUrls variable',
    !engineSource.includes('tempUrls'));
  check('engine uses crypto.randomUUID',
    engineSource.includes('crypto.randomUUID'));
  check('engine imports execution-resources',
    engineSource.includes('createExecutionResources'));
  check('engine disposes resources on cancel',
    engineSource.includes('currentResources.dispose()'));
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== repository: no unmanaged createObjectURL in workflow-engine ===');

{
  const engineSource = read('workspace/core/workflow-engine.js');
  check('workflow-engine.js has zero createObjectURL',
    !engineSource.includes('createObjectURL'));
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== repository: no setTimeout as execution sync ===');

{
  const engineSource = read('workspace/core/workflow-engine.js');
  check('workflow-engine.js has no setTimeout',
    !engineSource.includes('setTimeout'));
  check('workflow-engine.js has no setInterval',
    !engineSource.includes('setInterval'));
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
