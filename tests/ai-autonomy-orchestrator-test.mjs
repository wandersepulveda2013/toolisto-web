// AI_AUTONOMY/orchestrator-test.mjs — Verifies the autonomous supervision
// runtime: verified-progress model, narration-loop detection, crash recovery,
// ownership guard, safe commit, queue scoring, single-instance lock.
//
// Pure Node, no browser, no network. Registered in tests/run-all.mjs.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
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

async function loadModule(p) {
  return await import(p + '?t=' + Date.now());
}

// Load modules fresh with absolute paths so VM-style isolation still works.
async function importFrom(fname) {
  return await loadModule('file:///' + fname.replace(/\\/g, '/'));
}

const st = await importFrom(join(ROOT, 'AI_AUTONOMY/state.mjs'));
const guard = await importFrom(join(ROOT, 'AI_AUTONOMY/guard.mjs'));
const runner = await importFrom(join(ROOT, 'AI_AUTONOMY/runner.mjs'));
const cg = await importFrom(join(ROOT, 'AI_AUTONOMY/commit-guard.mjs'));
const queue = await importFrom(join(ROOT, 'AI_AUTONOMY/queue.mjs'));
const lock = await importFrom(join(ROOT, 'AI_AUTONOMY/lock.mjs'));

// ---------------------------------------------------------------------------
// 1. Guard: narration loop detection (the "let me read the QUEUE" scenario).
// ---------------------------------------------------------------------------
{
  // Agent says it will act, many times, with zero verified events => NARRATION_LOOP.
  const d = guard.createLoopDetector();
  const narrationLines = [
    'Voy a leer el QUEUE ahora',
    'Voy a leer el QUEUE ahora',
    'Voy a leer el QUEUE ahora',
    'Voy a leer el QUEUE ahora',
    'Voy a leer el QUEUE ahora',
  ];
  for (const l of narrationLines) d.onNarration(l);
  let s = d.summary();
  ok(s.loopTriggered, 'repetition loop triggers (identical narration 5x)');
  eq(s.loopReason, 'REPETITION', 'repetition reason is REPETITION');
  eq(s.verified, 0, 'zero verified events in a loop');
  eq(s.intents, 5, 'five intents counted');

  // Consecutive distinct intents with no interleaved verified => loop.
  const d2 = guard.createLoopDetector();
  const distinct = [
    'Voy a leer el QUEUE',
    'Voy a revisar el estado',
    'Voy a revisar el estado',
    'Voy a revisar el estado',
    'Voy a revisar el estado',
    'Voy a revisar el estado',
  ];
  for (const l of distinct) d2.onNarration(l);
  s = d2.summary();
  ok(s.loopTriggered, 'consecutive-intents loop triggers');
  ok(['CONSECUTIVE_INTENTS', 'RATIO_ZERO_VERIFIED', 'REPETITION'].includes(s.loopReason), 'loop reason is set');

  // Healthy: narration interleaved with verified markers => no loop.
  const d3 = guard.createLoopDetector();
  d3.onNarration('Voy a implementar la funcion foo');
  d3.onVerified('edit:workspace.js');
  d3.onNarration('Voy a correr los tests');
  d3.onVerified('node:test');
  d3.onNarration('Voy a hacer el commit');
  d3.onVerified('git:commit');
  s = d3.summary();
  ok(!s.loopTriggered, 'healthy cycle is not flagged as a loop');
  eq(s.verified, 3, 'three verified events counted');
  eq(s.intents, 3, 'three intents counted');

  // Deliberation precision: a long analysis that pauses to think BETWEEN intent
  // declarations (with real tools at both ends) is REAL work, not a loop. A
  // per-line CONSECUTIVE_INTENTS counter (pre-CE-069 fix) would count every
  // intent-bearing line across the deliberation and interrupt it (cycle 192).
  const d4 = guard.createLoopDetector();
  d4.onVerified('shell:git-status');
  d4.onNarration('Let me look at the working tree to understand what is pending.');
  d4.onNarration('There is an uncommitted change to the QUEUE file related to CE-149.');
  d4.onNarration('Let me check the diff of the QUEUE and STATUS files.');
  d4.onNarration('The diff shows only a marker change, nothing more.');
  d4.onNarration('Let me re-read the recovery context of the interrupted cycle.');
  d4.onNarration('It says to retake only the pending step and make a real commit.');
  d4.onNarration('Let me find queryRunOperation in workspace.js.');
  d4.onNarration('It lives in the runtime of the query pipeline.');
  d4.onNarration('Let me implement the queryRunOperation optimization.');
  d4.onNarration('The change must keep the same shape and only touch the booleans.');
  d4.onNarration('Let me run the workspace table tests afterwards.');
  d4.onVerified('shell:select-string');
  s = d4.summary();
  ok(!s.loopTriggered, 'deliberation with analysis between intents + tools is NOT a loop');
}

// ---------------------------------------------------------------------------
// 2. State machine: legal transitions only.
// ---------------------------------------------------------------------------
{
  ok(st.canTransition('PENDING', 'RUNNING'), 'PENDING->RUNNING allowed');
  ok(st.canTransition('RUNNING', 'IMPLEMENTED'), 'RUNNING->IMPLEMENTED allowed');
  ok(st.canTransition('IMPLEMENTED', 'TRACKERS'), 'IMPLEMENTED->TRACKERS allowed');
  ok(st.canTransition('TRACKERS', 'FINISHED'), 'TRACKERS->FINISHED allowed');
  ok(!st.canTransition('PENDING', 'FINISHED'), 'PENDING->FINISHED illegal');
  ok(!st.canTransition('FINISHED', 'RUNNING'), 'FINISHED->RUNNING illegal');
  ok(!st.canTransition('PENDING', 'TRACKERS'), 'PENDING->TRACKERS illegal');
  ok(st.canTransition('RUNNING', 'FAILED'), 'RUNNING->FAILED allowed');

  // advanceTaskState enforces the table at runtime.
  let s = st.newCycle(1, 1, 'CE-T1', 'aaabbb');
  eq(s.taskState, 'RUNNING', 'new cycle starts RUNNING');
  let thrown = null;
  try {
    st.advanceTaskState(s, 2, 'FINISHED');
  } catch (e) {
    thrown = e;
  }
  ok(thrown, 'illegal transition throws');
  s = st.advanceTaskState(s, 2, 'IMPLEMENTED');
  eq(s.taskState, 'IMPLEMENTED', 'advance to IMPLEMENTED ok');
  s = st.advanceTaskState(s, 3, 'TRACKERS');
  s = st.advanceTaskState(s, 4, 'FINISHED');
  eq(s.taskState, 'FINISHED', 'reaches FINISHED');
}

// ---------------------------------------------------------------------------
// 3. Crash recovery ladder (the checkpoint).
// ---------------------------------------------------------------------------
{
  // No checkpoint => fresh.
  eq(runner.planCycle(null).action, 'FRESH', 'null checkpoint => FRESH');
  eq(runner.planCycle({}).action, 'FRESH', 'empty checkpoint => FRESH');

  // Mid-cycle RUNNING => RESUME with same task.
  const running = st.newCycle(1, 7, 'CE-070', 'h1');
  let p = runner.planCycle(running);
  eq(p.action, 'RESUME', 'RUNNING checkpoint => RESUME');
  eq(p.taskId, 'CE-070', 'RESUME keeps taskId');
  eq(p.cycle, 7, 'RESUME keeps cycle');

  // IMPLEMENTED/TRACKERS => complete trackers only (no re-implement).
  let impl = st.advanceTaskState(st.newCycle(1, 8, 'CE-071', 'h1'), 2, 'IMPLEMENTED');
  p = runner.planCycle(impl);
  eq(p.action, 'COMPLETE_TRACKERS', 'IMPLEMENTED => COMPLETE_TRACKERS');
  let trackers = st.advanceTaskState(st.newCycle(1, 9, 'CE-072', 'h1'), 2, 'IMPLEMENTED');
  trackers = st.advanceTaskState(trackers, 3, 'TRACKERS');
  p = runner.planCycle(trackers);
  eq(p.action, 'COMPLETE_TRACKERS', 'TRACKERS => COMPLETE_TRACKERS');

  // FAILED => RECOVERY with a fresh cycle number.
  let failed = st.advanceTaskState(st.newCycle(1, 10, 'CE-073', 'h1'), 2, 'FAILED');
  p = runner.planCycle(failed);
  eq(p.action, 'RECOVERY', 'FAILED => RECOVERY');
  eq(p.cycle, 11, 'RECOVERY advances cycle number');

  // finished => FRESH with bumped cycle.
  let fin = st.newCycle(1, 12, 'CE-074', 'h1');
  fin = st.advanceTaskState(fin, 2, 'IMPLEMENTED');
  fin = st.advanceTaskState(fin, 3, 'TRACKERS');
  fin = st.advanceTaskState(fin, 4, 'FINISHED');
  fin = { ...fin, finished: true };
  p = runner.planCycle(fin);
  eq(p.action, 'FRESH', 'finished => FRESH');
  eq(p.cycle, 13, 'finished bumps cycle');
}

// ---------------------------------------------------------------------------
// 4. Ordering / verified-progress semantics.
// ---------------------------------------------------------------------------
{
  // recordVerified pushes bounded ring + counts.
  let s = st.newCycle(1, 1, 'T', 'h');
  for (let i = 0; i < 40; i++) {
    s = st.recordVerified(s, i + 2, 'edit:file' + i, 'h' + i);
  }
  eq(s.verifiedCount, 40, 'verified count accumulates');
  eq(s.verifiedSteps.length, 32, 'ring is bounded at 32');
  eq(s.verifiedSteps[0], 'edit:file8', 'ring drops oldest, keeps last 32');
  eq(s.lastVerifiedAt, 40, 'monotonic verified counter');

  // invalid marker throws.
  let thrown = null;
  try {
    st.recordVerified(s, 99, 'THIS MARKER HAS WAY TOO MANY CHARACTERS OVER 64 LIMIT aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'h');
  } catch (e) {
    thrown = e;
  }
  ok(thrown, 'oversized verified marker rejected');
}

// ---------------------------------------------------------------------------
// 5. Ownership guard + safe commit (foreign-file protection).
// ---------------------------------------------------------------------------
{
  // Only owned files in scope.
  const owned = ['AI_AUTONOMY/state.js', 'AI_AUTONOMY/guard.js'];
  const status = ['M AI_AUTONOMY/state.js', 'M AI_AUTONOMY/guard.js'];
  let c = cg.checkOwnedFiles(status, owned);
  ok(c.ok, 'owned files pass');
  eq(c.reason, 'ALL_IN_SCOPE', 'reason ALL_IN_SCOPE');

  // Foreign (unowned) modified file => reject.
  const status2 = ['M AI_AUTONOMY/state.js', 'M src/foo/unrelated.js'];
  c = cg.checkOwnedFiles(status2, owned);
  ok(!c.ok, 'foreign file rejected');
  eq(c.reason, 'OUT_OF_SCOPE_FILES', 'reason OUT_OF_SCOPE_FILES');
  ok(c.outOfScope.includes('src/foo/unrelated.js'), 'foreign path listed');

  // Hard-blocked path always rejected, even if "owned".
  const status3 = ['M AI_AUTONOMY/state.js', 'M opencode.json'];
  c = cg.checkOwnedFiles(status3, ['AI_AUTONOMY/state.js', 'opencode.json']);
  ok(!c.ok, 'hard-blocked path rejected even if owned');
  eq(c.reason, 'HARD_BLOCKED_FILES', 'reason HARD_BLOCKED_FILES');

  // Dangerous stage-all forms rejected.
  ok(cg.isDangerousStage('git add .'), 'git add . dangerous');
  ok(cg.isDangerousStage('git add -A'), 'git add -A dangerous');
  ok(cg.isDangerousStage('git add --all'), 'git add --all dangerous');
  ok(!cg.isDangerousStage('git add AI_AUTONOMY/state.js'), 'explicit path safe');

  // safeCommit path in supervisor.
  const critter = runner.createSupervisor({
    root: ROOT,
    spawnChild: () => ({ pid: 1 }),
    ownedFiles: owned,
  });
  let sc = critter.safeCommit({ commitMsg: 'x', files: owned }, status);
  ok(sc.ok, 'supervisor safeCommit ok for owned');
  sc = critter.safeCommit({ commitMsg: 'x', files: owned }, status2);
  ok(!sc.ok, 'supervisor safeCommit rejects foreign');
}

// ---------------------------------------------------------------------------
// 6. Queue scoring + next-task selection.
// ---------------------------------------------------------------------------
{
  const tasks = [
    { id: 'CE-080', priority: 'P1', state: 'TODO', area: 'Fiabilidad' },
    { id: 'CE-081', priority: 'P0', state: 'TODO', area: 'Flujo estrella' },
    { id: 'CE-082', priority: 'P2', state: 'TODO', area: 'Rendimiento' },
    { id: 'CE-083', priority: 'P3', state: 'ACTIVE', area: 'Auditoria' },
    { id: 'CE-084', priority: 'P2', state: 'BLOCKED', area: 'UX' },
  ];
  const pick = guard.pickNextTask(tasks);
  eq(pick.id, 'CE-081', 'P0 selected over P1/P2');
  ok(pick.score > guard.scoreTask({ id: 'x', priority: 'P2', state: 'TODO', area: 'Rendimiento' }), 'P0 scores higher than P2');

  // State penalties: BLOCKED not eligible.
  const pick2 = guard.pickNextTask([
    { id: 'CE-085', priority: 'P0', state: 'BLOCKED', area: 'Flujo estrella' },
  ]);
  eq(pick2, null, 'no TODO => null pick');

  // tie-break deterministic (higher priority wins).
  const a = guard.scoreTask({ id: 'a', priority: 'P1', state: 'TODO', area: 'Flujo estrella' });
  const b = guard.scoreTask({ id: 'b', priority: 'P1', state: 'TODO', area: 'Auditoria' });
  ok(a > b, 'star-flow fit outranks audit');

  // Markdown queue parse.
  const md = [
    '| ID | Prioridad | Estado | Area | Tarea | Evidencia |',
    '|----|-----------|--------|------|-------|-----------|',
    '| CE-090 | P1 | TODO | Fiabilidad | Arregla X | - |',
    '| CE-091 | P2 | DONE | Workspace | Arreglo Y | - |',
  ].join('\n');
  const parsed = queue.parseMarkdownQueue(md);
  ok(parsed.tasks['CE-090'], 'parses CE-090 from MD');
  eq(parsed.tasks['CE-090'].priority, 'P1', 'priority parsed');
  eq(parsed.tasks['CE-090'].state, 'TODO', 'state parsed');
  eq(parsed.tasks['CE-091'].state, 'DONE', 'done state parsed');

  // reconcile: MD is authority; JSON-only entries flagged.
  const jsonTasks = {
    'CE-090': { id: 'CE-090', priority: 'P1', state: 'TODO', area: 'Fiabilidad' },
    'CE-099': { id: 'CE-099', priority: 'P2', state: 'TODO', area: 'X' },
  };
  const rec = queue.reconcile(jsonTasks, parsed.tasks);
  ok(rec.tasks['CE-090'], 'reconcile keeps MD task');
  eq(rec.tasks['CE-090'].state, 'TODO', 'MD overrides JSON state');
  ok(rec.tasks['CE-099'], 'JSON-only entry kept');
  eq(rec.tasks['CE-099'].state, 'DONE_MISSING', 'JSON-only flagged DONE_MISSING');
}

// ---------------------------------------------------------------------------
// 7. Lock: single-instance + stale detection (PID-based).
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'tlt-lock-'));
  const lockFile = join(dir, 'lock.json');

  // Acquire with the live PID => ok.
  let r = lock.acquireLock(lockFile, { root: ROOT, token: 'cycle-token' });
  ok(r.ok, 'acquire ok for live process');
  ok(lock.readLock(lockFile), 'lock file written');

  // Our own process is alive; status not stale.
  let ls = lock.isLockStale(lockFile);
  ok(!ls.stale, 'lock not stale while PID alive');

  // We are holding it; a second acquire fails ALREADY_RUNNING.
  r = lock.acquireLock(lockFile, { root: ROOT, token: 'other' });
  eq(r.reason, 'ALREADY_RUNNING', 'second acquire refused while alive');

  // Release with wrong token => NOT_OWNER.
  r = lock.releaseLock(lockFile, 'wrong-token');
  eq(r.reason, 'NOT_OWNER', 'release with wrong token refused');

  // Release with correct token.
  r = lock.releaseLock(lockFile, lock.readLock(lockFile).token);
  ok(r.ok, 'release with owner token ok');
  ok(!existsSync(lockFile), 'lock removed after release');

  // Stale: hand-write a lock with a dead PID.
  writeFileSync(lockFile, JSON.stringify({ pid: 999999999, token: 'x', startedAt: 1, root: '' }));
  ls = lock.isLockStale(lockFile);
  ok(ls.stale, 'dead PID => stale lock');
  r = lock.acquireLock(lockFile, { root: ROOT });
  ok(r.ok, 'stale lock replaced on acquire');

  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 8. Supervisor end-to-end (in-process): verified progress + loop interrupt +
//    crash recovery with a real temp store.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'tlt-super-'));
  let events = [];
  const paths = runner.resolvePaths(dir, { state: 'state.json', events: 'events.jsonl', lock: 'lock.json', queue: 'queue.json' });
  const sup = runner.createSupervisor({
    root: dir,
    paths,
    spawnChild: () => ({ pid: 1 }),
    onEvent: (e) => events.push(e),
    ownedFiles: ['AI_AUTONOMY/state.js'],
  });

  // Fresh prepare.
  let p = sup.prepare(1, 'CE-100', 'aaa');
  eq(p.action, 'FRESH', 'supervisor fresh prepare');

  // Record a verified event -> state.json + events.jsonl written.
  const ck1 = sup.verify('edit:state.js', 'bbb', 1, null, 'CE-100');
  ok(existsSync(paths.state), 'state.json written on verified event');
  ok(existsSync(paths.events), 'events.jsonl written on verified event');
  eq(st.readCheckpoint(paths.state).verifiedCount, 1, 'checkpoint reflects verified count');
  const evRead = st.readEvents(paths.events);
  eq(evRead.length, 1, 'one event appended');
  eq(evRead[0].kind, 'verified', 'event kind verified');

  // Advance to IMPLEMENTED, then TRACKERS, then finish.
  let s = st.readCheckpoint(paths.state);
  s = st.advanceTaskState(s, 2, 'IMPLEMENTED');
  s = st.advanceTaskState(s, 3, 'TRACKERS');
  st.writeCheckpoint(s, paths.state);

  // "Crash + restart": a NEW supervisor reads the same store and must plan
  // COMPLETE_TRACKERS (do not re-implement).
  const sup2 = runner.createSupervisor({
    root: dir,
    paths,
    spawnChild: () => ({ pid: 1 }),
    onEvent: () => {},
    ownedFiles: ['AI_AUTONOMY/state.js'],
  });
  p = sup2.prepare(2, 'CE-100', 'aaa');
  eq(p.action, 'COMPLETE_TRACKERS', 'restart after IMPLEMENTED => complete trackers, not re-implement');

  // Finish marks cycle done.
  sup2.finish('MEANINGFUL_TEST_COVERAGE', 'CE-100');
  const fin = st.readCheckpoint(paths.state);
  eq(fin.finished, true, 'cycle finished flag set');
  eq(fin.result, 'MEANINGFUL_TEST_COVERAGE', 'result persisted');
  eq(st.restoreBreakpoint(fin), 'completed', 'breakpoint completed after finish');

  // Narrative loop: feed intent-only and confirm evaluateCycleOutput interrupts.
  const orch = runner.createOrchestrator();
  for (let i = 0; i < 7; i++) orch.onNarration('Voy a leer el QUEUE');
  const ev = runner.evaluateCycleOutput(orch, fin);
  ok(!ev.ok && ev.interrupt === true, 'loop output flagged for interrupt');
  ok(/NARRATION_LOOP|NO_VERIFIED_PROGRESS/.test(ev.reason), 'interrupt reason present');

  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 9. Determinism: writing a checkpoint twice yields identical bytes (no churn).
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'tlt-determ-'));
  const f = join(dir, 'state.json');
  const s = st.newCycle(1, 5, 'CE-110', 'h1');
  const s2 = st.recordVerified(s, 2, 'edit:file', 'h2');
  st.writeCheckpoint(s2, f);
  const bytes1 = readFileSync(f, 'utf8');
  st.writeCheckpoint(s2, f);
  const bytes2 = readFileSync(f, 'utf8');
  eq(bytes1, bytes2, 'checkpoint write is deterministic (diff zero)');
  eq(JSON.parse(bytes1).schema, 1, 'schema present');
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nAI_AUTONOMY orchestrator test: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) {
  console.error('Failures:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
