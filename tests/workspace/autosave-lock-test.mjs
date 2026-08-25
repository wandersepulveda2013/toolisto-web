#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Autosave Lock Tests ===\n');

// Extract just the _createSaveLock function from workspace.js
const lockMatch = wsCode.match(/function _createSaveLock\([^)]*\)\s*\{[\s\S]*?return \{ enqueue, cancel \};\s*\}/);
if (!lockMatch) { console.error('FAIL: could not extract _createSaveLock'); process.exit(1); }

const lockSrc = lockMatch[0];
const vmCode = lockSrc + '\n'
  + 'globalThis._createSaveLock = _createSaveLock;\n';

const ctx = vm.createContext({
  console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
  setTimeout, clearTimeout, reportError: function() {},
});
vm.runInContext(vmCode, ctx);

const _createSaveLock = ctx._createSaveLock;

// 1. Basic serialization: two enqueues run sequentially, not concurrently
console.log('1. Basic serialization');
{
  const lock = _createSaveLock();
  let log = [];
  const p1 = new Promise((resolve) => {
    lock.enqueue(async () => {
      log.push('start-1');
      await delay(50);
      log.push('end-1');
      resolve();
    });
  });
  await delay(10);
  const p2 = new Promise((resolve) => {
    lock.enqueue(async () => {
      log.push('start-2');
      await delay(20);
      log.push('end-2');
      resolve();
    });
  });
  await Promise.all([p1, p2]);
  check('two enqueues run sequentially', log.join(',') === 'start-1,end-1,start-2,end-2', log.join(','));
}

// 2. Latest-wins coalescing: three rapid enqueues → only last two run (second is superseded by third)
console.log('\n2. Latest-wins coalescing');
{
  const lock = _createSaveLock();
  let log = [];
  lock.enqueue(async () => {
    log.push('start-1');
    await delay(60);
    log.push('end-1');
  });
  await delay(5);
  lock.enqueue(async () => {
    log.push('start-2');
    await delay(10);
    log.push('end-2');
  });
  await delay(5);
  lock.enqueue(async () => {
    log.push('start-3');
    await delay(10);
    log.push('end-3');
  });
  await delay(200);
  check('first task runs', log.includes('start-1'), log.join(','));
  check('first task completes', log.includes('end-1'), log.join(','));
  check('third task runs (latest-wins over second)', log.includes('start-3'), log.join(','));
  check('second task was superseded', !log.includes('start-2'), log.join(','));
}

// 3. Error handling: a failing enqueue doesn't block subsequent ones
console.log('\n3. Error handling');
{
  const lock = _createSaveLock();
  let log = [];
  lock.enqueue(async () => {
    log.push('start-err');
    throw new Error('test error');
  });
  await delay(50);
  lock.enqueue(async () => {
    log.push('start-after-err');
    await delay(10);
    log.push('end-after-err');
  });
  await delay(100);
  check('failing enqueue ran', log.includes('start-err'), log.join(','));
  check('subsequent enqueue runs after error', log.includes('end-after-err'), log.join(','));
}

// 4. Cancel clears pending
console.log('\n4. Cancel clears pending');
{
  const lock = _createSaveLock();
  let log = [];
  lock.enqueue(async () => {
    log.push('start-1');
    await delay(60);
    log.push('end-1');
  });
  await delay(5);
  lock.enqueue(async () => {
    log.push('start-2');
    await delay(10);
    log.push('end-2');
  });
  lock.cancel();
  await delay(200);
  check('first task ran', log.includes('start-1'), log.join(','));
  check('second task was cancelled', !log.includes('start-2'), log.join(','));
}

// 5. Empty enqueue (no pending) starts immediately
console.log('\n5. Empty enqueue starts immediately');
{
  const lock = _createSaveLock();
  let ran = false;
  lock.enqueue(async () => { ran = true; });
  await delay(20);
  check('empty-enqueue starts immediately', ran);
}

// 6. Many rapid enqueues: only the latest runs after current completes
console.log('\n6. Rapid burst enqueues');
{
  const lock = _createSaveLock();
  let log = [];
  lock.enqueue(async () => {
    log.push('start-current');
    await delay(50);
    log.push('end-current');
  });
  for (let i = 0; i < 20; i++) {
    const idx = i;
    lock.enqueue(async () => {
      log.push('burst-' + idx);
      await delay(5);
    });
  }
  await delay(200);
  check('current task ran', log.includes('start-current'), log.join(','));
  check('current task completed', log.includes('end-current'), log.join(','));
  const burstIdxs = log.filter(l => l.startsWith('burst-')).map(l => parseInt(l.split('-')[1]));
  check('only latest burst task ran (idx 19)', burstIdxs.length === 1 && burstIdxs[0] === 19, burstIdxs.join(','));
}

// 7. No enqueue after drain completes
console.log('\n7. Drain completes cleanly');
{
  const lock = _createSaveLock();
  let count = 0;
  lock.enqueue(async () => { count++; });
  lock.enqueue(async () => { count++; });
  await delay(50);
  check('both queued tasks ran', count === 2, 'count=' + count);
  lock.enqueue(async () => { count++; });
  await delay(50);
  check('task after idle runs', count === 3, 'count=' + count);
}

// 8. Failsafe timeout: lock releases after timeout so new enqueues proceed
console.log('\n8. Failsafe timeout (simulated short)');
{
  const lockSrc2 = lockSrc.replace('60000', '100');
  const ctx2 = vm.createContext({
    console, Map, Array, Object, Error, Date, JSON, Math, Number, Promise, Set,
    setTimeout, clearTimeout, reportError: function() {},
  });
  vm.runInContext(lockSrc2 + '\nglobalThis._createSaveLock2 = _createSaveLock;\n', ctx2);
  const _createSaveLock2 = ctx2._createSaveLock2;
  const lock = _createSaveLock2();
  let log = [];
  lock.enqueue(async () => {
    log.push('start-stuck');
    await delay(300);
    log.push('end-stuck');
  });
  await delay(50);
  lock.enqueue(async () => {
    log.push('queued');
    await delay(10);
  });
  await delay(250);
  check('stuck task started', log.includes('start-stuck'), log.join(','));
  check('queued task eventually ran (after stuck completes)', log.includes('queued'), log.join(','));
  check('stuck task completed', log.includes('end-stuck'), log.join(','));
}

console.log(`\n=== Autosave Lock: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
