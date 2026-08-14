#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'workspace', 'core', 'job-queue.js');
const code = readFileSync(SRC, 'utf8');

const body = code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const sandbox = { console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set, setTimeout, clearTimeout };
const script = new vm.Script(body + '\n;globalThis.createJobQueue = createJobQueue;');
script.runInNewContext(sandbox);
const createJobQueue = sandbox.createJobQueue;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Job Queue Tests ===\n');

// 1. Create queue
const q = createJobQueue({ maxConcurrency: 2 });
check('Queue created', !!q);
check('GetSnapshot returns object', typeof q.getSnapshot() === 'object');

// 2. Max concurrency
let runningCount = 0;
let maxRunningSeen = 0;
const finishJobs = [];
for (let i = 0; i < 5; i++) {
  q.add({
    id: 'job-' + i,
    execute: (ctx) => new Promise(resolve => {
      runningCount++;
      maxRunningSeen = Math.max(maxRunningSeen, runningCount);
      finishJobs.push(() => { runningCount--; resolve('result-' + i); });
    }),
  });
}
check('Max concurrency respected (<=2)', maxRunningSeen <= 2);

// Finish all pending
await Promise.all(finishJobs.map(f => f()));
await new Promise(r => setTimeout(r, 50));

// 3. Order (FIFO)
{
  const q2 = createJobQueue({ maxConcurrency: 1 });
  const order = [];
  q2.add({ id: 'a', execute: async () => { order.push('a'); } });
  q2.add({ id: 'b', execute: async () => { order.push('b'); } });
  q2.add({ id: 'c', execute: async () => { order.push('c'); } });
  await new Promise(r => setTimeout(r, 100));
  check('FIFO order preserved', order.length === 3);
  check('FIFO order: a first', order[0] === 'a');
  check('FIFO order: b second', order[1] === 'b');
  check('FIFO order: c third', order[2] === 'c');
}

// 4. Pause/Resume
{
  const q3 = createJobQueue({ maxConcurrency: 1 });
  let execCount = 0;
  q3.pause();
  q3.add({ id: 'p1', execute: async () => { execCount++; } });
  q3.add({ id: 'p2', execute: async () => { execCount++; } });
  await new Promise(r => setTimeout(r, 30));
  check('Paused: no executions', execCount === 0);
  q3.resume();
  await new Promise(r => setTimeout(r, 100));
  check('Resumed: executions completed', execCount === 2);
}

// 5. Cancel pending
{
  const q4 = createJobQueue({ maxConcurrency: 1 });
  let execCount2 = 0;
  let c1Done = false;
  q4.add({ id: 'c1', execute: async () => { execCount2++; await new Promise(r => setTimeout(r, 100)); c1Done = true; } });
  q4.add({ id: 'c2', execute: async () => { execCount2++; } });
  await new Promise(r => setTimeout(r, 20));
  q4.cancel('c2');
  await new Promise(r => setTimeout(r, 150));
  check('Cancel pending: only first executed', execCount2 === 1);
  check('C1 completed normally', c1Done === true);
}

// 6. Cancel active
{
  const q5 = createJobQueue({ maxConcurrency: 1 });
  let wasCancelled = false;
  q5.add({
    id: 'active',
    execute: async (ctx) => {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (ctx.signal.cancelled) { wasCancelled = true; clearInterval(check); resolve(); }
        }, 5);
        ctx._cleanup = () => clearInterval(check);
      });
    },
  });
  await new Promise(r => setTimeout(r, 10));
  q5.cancel('active');
  await new Promise(r => setTimeout(r, 50));
  check('Cancel active job', wasCancelled);
}

// 7. Failed job
{
  const q6 = createJobQueue({ maxConcurrency: 1 });
  let failNotified = false;
  q6.subscribe(e => { if (e.type === 'failed') failNotified = true; });
  q6.add({ id: 'fail1', execute: async () => { throw new Error('test error'); } });
  await new Promise(r => setTimeout(r, 50));
  check('Failed job notification', failNotified);
}

// 8. Continue after failure
{
  const q7 = createJobQueue({ maxConcurrency: 1 });
  let successCount = 0;
  q7.add({ id: 'fail2', execute: async () => { throw new Error('fail'); } });
  q7.add({ id: 'ok1', execute: async () => { successCount++; } });
  await new Promise(r => setTimeout(r, 50));
  check('Continue after failure', successCount === 1);
}

// 9. Retry failed
{
  const q8 = createJobQueue({ maxConcurrency: 1 });
  let attempts = 0;
  const retryId = q8.add({ id: 'retry1', execute: async () => { attempts++; if (attempts < 2) throw new Error('not yet'); } });
  await new Promise(r => setTimeout(r, 50));
  check('Retry returns true', q8.retry('retry1'));
  await new Promise(r => setTimeout(r, 50));
  check('Retry successful on second attempt', attempts === 2);
}

// 10. Destroy
{
  const q9 = createJobQueue({ maxConcurrency: 1 });
  q9.add({ id: 'd1', execute: async () => { await new Promise(r => setTimeout(r, 10)); } });
  q9.destroy();
  check('Add after destroy returns false', q9.add({ id: 'd2', execute: async () => {} }) === false);
}

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);
