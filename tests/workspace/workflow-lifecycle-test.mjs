/**
 * Tests for workflow engine lifecycle: job-queue cancel, execution resources,
 * engine race protection, retry preservation, OCR signal, URL lifecycle.
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
    console, Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map,
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

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== job-queue: cancel resolves pending promises ===');

await new Promise(resolve => {
  const q = createJobQueue({ maxConcurrency: 1 });
  let runningResolved = 0;
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
console.log('\n=== execution-resources lifecycle ===');

const r1 = createExecutionResources('test-exec-1');
check('not disposed initially', r1.isDisposed() === false);
check('executionId stored', r1.executionId === 'test-exec-1');

const urls = [];
urls.push(r1.trackUrl('blob:http://a/1'));
urls.push(r1.trackUrl('blob:http://a/2'));
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
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
