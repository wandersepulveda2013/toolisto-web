// AI_AUTONOMY/ai-autonomy-resilience-simulation.mjs — Real resilience simulation.
//
// Simulates, entirely in-process against real temp files, the resilience
// guarantees the new autonomous runtime provides, so the operator can trust the
// system before (or without) running a live opencode cycle:
//
//   A. A cycle VERIFIES progress by persisting state.json + events.jsonl on real
//      actions (never on narration).
//   B. A "crash" mid-cycle is recovered: restarting the supervisor on the same
//      store RESUMEs or COMPLETEs TRACKERS instead of re-running blindly.
//   C. A narration loop (many intents, zero verified) is detected and the cycle
//      is interrupted rather than spinning.
//   D. The ownership guard blocks committing a foreign (non-owned) file.
//   E. Determinism: two identical runs produce byte-identical checkpoints.
//   F. Single-instance lock: a second supervisor cannot start while one is alive.
//
// This is the "run real resilience simulation, restart, verify continuation"
// evidence path of the mission, done safely with zero live opencode/network.

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(msg);
    console.error('  FAIL: ' + msg);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function ok(v, msg) {
  assert(Boolean(v), msg);
}

const st = await import('file:///' + join(ROOT, 'AI_AUTONOMY/state.mjs').replace(/\\/g, '/') + '?t=' + Date.now());
const guard = await import('file:///' + join(ROOT, 'AI_AUTONOMY/guard.mjs').replace(/\\/g, '/') + '?t=' + Date.now());
const runner = await import('file:///' + join(ROOT, 'AI_AUTONOMY/runner.mjs').replace(/\\/g, '/') + '?t=' + Date.now());
const lock = await import('file:///' + join(ROOT, 'AI_AUTONOMY/lock.mjs').replace(/\\/g, '/') + '?t=' + Date.now());

const workDir = mkdtempSync(join(tmpdir(), 'tlt-resil-'));
const paths = runner.resolvePaths(workDir, {
  state: 'state.json',
  events: 'events.jsonl',
  lock: 'runner.lock',
  queue: 'queue.json',
});

function makeSuper(onEvent = () => {}) {
  return runner.createSupervisor({
    root: workDir,
    paths,
    spawnChild: () => ({ pid: 9999 }),
    onEvent,
    ownedFiles: ['AI_AUTONOMY/state.mjs', 'AI_AUTONOMY/guard.mjs'],
  });
}

// --- A. Verified progress persists, narration does NOT. -----------------------
{
  const sup = makeSuper();
  // Narration alone writes no checkpoint/events of kind "verified".
  sup.recordIntentLine('Voy a leer el QUEUE');
  sup.recordIntentLine('Voy a revisar el estado');
  ok(!existsSync(paths.state), 'narration alone does NOT write state.json');
  const ev = st.readEvents(paths.events);
  eq(ev.filter((e) => e.kind === 'verified').length, 0, 'narration produces zero verified events');

  // A real action (verified) persists state.json + a verified event.
  sup.verify('edit:state.mjs', 'h1', 1, null, 'CE-R1');
  ok(existsSync(paths.state), 'verified action writes state.json');
  const ev2 = st.readEvents(paths.events);
  eq(ev2.filter((e) => e.kind === 'verified').length, 1, 'verified event recorded in events.jsonl');
  eq(st.readCheckpoint(paths.state).verifiedCount, 1, 'checkpoint verifiedCount == 1');
  console.log('  [A] verified-vs-narration persisted correctly');
}

// --- B. Crash + restart: continuation, not blind re-run. -----------------------
{
  // Fresh store for a new task (section A left a RUNNING task behind).
  rmSync(paths.state, { force: true });
  rmSync(paths.events, { force: true });
  // Fresh supervisor starts and verifies; then "crashes" after IMPLEMENTED.
  let sup = makeSuper();
  let p = sup.prepare(2, 'CE-R1', 'h1');
  eq(p.action, 'FRESH', 'fresh start => FRESH');
  sup.verify('edit:guard.mjs', 'h2', 2, null, 'CE-R1');
  let s = st.readCheckpoint(paths.state);
  s = st.advanceTaskState(s, 3, 'IMPLEMENTED');
  st.writeCheckpoint(s, paths.state);
  // simulated hard crash: supervisor goes away, store stays.

  // Restart with a NEW supervisor instance on the same store.
  sup = makeSuper();
  p = sup.prepare(3, 'CE-R1', 'h1');
  eq(p.action, 'COMPLETE_TRACKERS', 'restart after IMPLEMENTED => COMPLETE_TRACKERS (not re-implement)');
  ok(st.readCheckpoint(paths.state).taskId === 'CE-R1', 'task id preserved across restart');
  console.log('  [B] crash + restart recovers to COMPLETE_TRACKERS');

  // Finish cleanly; a further restart starts FRESH with bumped cycle.
  sup.finish('MEANINGFUL_TEST_COVERAGE', 'CE-R1');
  sup = makeSuper();
  p = sup.prepare(4, 'CE-R2', 'h3');
  eq(p.action, 'FRESH', 'after finish, restart is FRESH');
  ok(p.cycle >= 2, 'cycle number advanced after finish');
}

// --- C. Narration loop detected and interrupts the cycle. ---------------------
{
  // Recreate a fresh store (previous finished) so sizing is clean.
  rmSync(paths.state, { force: true });
  const orch = runner.createOrchestrator();
  for (let i = 0; i < 8; i++) orch.onNarration('Voy a leer el QUEUE otra vez');
  const verdict = runner.evaluateCycleOutput(orch);
  ok(!verdict.ok, 'loop output rejected');
  eq(verdict.interrupt, true, 'loop causes interrupt');
  ok(/NARRATION_LOOP|NO_VERIFIED_PROGRESS/.test(verdict.reason), 'interrupt reason set');
  console.log('  [C] narration loop detected and interrupts cycle');
}
rmSync(paths.state, { force: true });

// --- D. Ownership guard blocks foreign file. ----------------------------------
{
  const sup = makeSuper();
  const status = ['M AI_AUTONOMY/state.mjs', 'M AI_AUTONOMY/guard.mjs', 'M src/foo/evil.js'];
  const sc = sup.safeCommit({ commitMsg: 'x', files: ['AI_AUTONOMY/state.mjs', 'AI_AUTONOMY/guard.mjs'] }, status);
  ok(!sc.ok, 'foreign file blocked at commit');
  ok(/OUT_OF_SCOPE/.test(sc.reason), 'block reason OUT_OF_SCOPE');
  console.log('  [D] ownership guard blocked foreign commit');
}
rmSync(paths.state, { force: true });

// --- E. Determinism: identical checkpoints across identical runs. -------------
{
  const f = join(workDir, 'det.json');
  const s = st.newCycle(1, 3, 'CE-R9', 'h0');
  const s2 = st.recordVerified(s, 2, 'edit:file', 'h1');
  st.writeCheckpoint(s2, f);
  const b1 = readFileSync(f, 'utf8');
  st.writeCheckpoint(s2, f);
  const b2 = readFileSync(f, 'utf8');
  eq(b1, b2, 'checkpoint bytes identical across writes (no churn)');
}

// --- F. Single-instance lock: second supervisor cannot start live. ------------
{
  // fabricate a lock whose PID is THIS process (alive), then building a second
  // supervisor and calling acquire must be refused.
  const lockFile = paths.lock;
  writeFileSync(
    lockFile,
    JSON.stringify({ pid: process.pid, token: 'live', startedAt: 1, root: workDir }),
  );
  const r = lock.acquireLock(lockFile, { root: workDir, token: 'second' });
  eq(r.reason, 'ALREADY_RUNNING', 'second supervisor refused while a live lock is held');
  // clean up
  rmSync(lockFile, { force: true });
}

// --- Summary ------------------------------------------------------------------
rmSync(workDir, { recursive: true, force: true });
console.log(`\nAI_AUTONOMY resilience simulation: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) {
  console.error('Failures:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
