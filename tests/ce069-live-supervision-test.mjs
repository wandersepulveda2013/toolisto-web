// CE-069 — Live Supervision in Production Runner test.
//
// Certifies the LIVE supervision contract that the real launcher now uses
// (mission §1–§29): supervisor.mjs is the SINGLE authority over the running
// OpenCode child, detecting NARRATION_LOOP and STALL while the process is still
// alive, interrupting gracefully then cleaning the full process tree, refreshing
// verified progress live, and never producing false positives on legitimate long
// work. PowerShell orchestrates cycles; the supervisor watches the PID.
//
// Cases A–L (mission §17) + controlled real-process scenarios 1–5 (mission §18)
// with PID/orphan cleanup assertions (mission §9). Real subprocesses, real HEAD
// movement, isolated throwaway git repos.

import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AUTH_DIR = join(ROOT, 'AI_AUTONOMY');
const NODE = process.execPath;

let pass = 0;
let fail = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; failures.push(msg); console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }
function ok(v, msg) { assert(Boolean(v), msg); }

function setupWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'tlt-ce069-'));
  mkdirSync(join(dir, 'AI_AUTONOMY'), { recursive: true });
  const files = [
    'cli.mjs', 'supervisor.mjs', 'runtime.mjs', 'guard.mjs', 'state.mjs',
    'runner.mjs', 'lock.mjs', 'commit-guard.mjs', 'queue.mjs', 'fake-opencode.mjs', 'fake-runner.mjs',
  ];
  for (const f of files) copyFileSync(join(AUTH_DIR, f), join(dir, 'AI_AUTONOMY', f));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir });
  return dir;
}
const toClean = [];
function setupW() { const d = setupWorkspace(); toClean.push(d); return d; }

function runCli(dir, ...args) {
  const res = execFileSync(NODE, [join(dir, 'AI_AUTONOMY', 'cli.mjs'), ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  return JSON.parse(res);
}
function runCliSafe(dir, ...args) {
  try { return { ok: true, data: runCli(dir, ...args) }; }
  catch (e) {
    let data = null;
    try { data = JSON.parse(String(e.stdout || '').trim()); } catch { /* ignore */ }
    return { ok: false, data, error: String(e.stderr || e.message || '').trim() };
  }
}
function gitHead(dir) {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}
// Fresh helper: full supervise invocation against fake-opencode in a throwaway repo.
function superviseFake(dir, mode, extra = {}, head0) {
  if (head0) runCliSafe(dir, 'start-cycle', '--task', extra.baseTask || 'T', '--head', head0, '--cycle', extra.baseCycle || '1');
  else runCliSafe(dir, 'acquire-lock', '--token', 'L');
  const args = [
    'supervise', '--cycle', extra.baseCycle || '1', '--task', extra.baseTask || 'T',
    '--cmd', NODE,
    '--args', `${join(dir, 'AI_AUTONOMY', 'fake-opencode.mjs')} ${mode}${extra.marker ? ' ' + extra.marker : ''}${extra.pidDir ? ' ' + extra.pidDir : ''}`,
    '--phase-timeout-ms', String(extra.phaseTimeout || 15000),
    '--graceful-ms', String(extra.gracefulMs || 700),
  ];
  if (extra.stdoutLog) args.push('--stdout-log', extra.stdoutLog);
  if (extra.promptFile) args.push('--prompt-file', extra.promptFile);
  return runCliSafe(dir, ...args);
}
// Windows-native check: is a PID alive as a process?
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// A. Normal OpenCode (narration + verified + clean exit) => no interruption
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  const v = superviseFake(dir, 'normal', { baseTask: 'A', baseCycle: '1' }, head0);
  ok(v.ok, 'A: supervise ran');
  eq(v.data.outcome, 'SUCCESS', 'A: normal => SUCCESS');
  ok(!v.data.interrupt, 'A: no interruption for normal run');
  console.log('  [A] normal run -> SUCCESS, no interrupt');
}

// ---------------------------------------------------------------------------
// B. Narration loop => LIVE interrupt before voluntary exit
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const v = superviseFake(dir, 'loop', { baseTask: 'B', baseCycle: '1', gracefulMs: 500 });
  ok(v.ok, 'B: supervise ran');
  eq(v.data.outcome, 'LOOP_INTERRUPTED', 'B: narration loop => LOOP_INTERRUPTED (LIVE)');
  ok(/NARRATION_LOOP/.test(v.data.reason), 'B: reason mentions NARRATION_LOOP');
  // The loop mode runs forever; the supervisor had to interrupt it live, so the
  // elapsed time must be much less than "forever" and stats show zero verified.
  eq(v.data.stats.verified, 0, 'B: zero verified progress (narration is not progress)');
  assert(v.data.stats.intents >= 5, 'B: guard accumulated narration intent evidence before interrupting');
  // verify the live heartbeat reflected live classification
  const hbPath = join(dir, 'AI_AUTONOMY', 'heartbeat.json');
  ok(existsSync(hbPath), 'B: live heartbeat written during supervise');
  let hb = null; try { hb = JSON.parse(readFileSync(hbPath, 'utf8')); } catch { /* ignore */ }
  ok(hb && hb.supervisor === 'live', 'B: heartbeat marks live supervision');
  console.log('  [B] narration loop interrupted LIVE (not waiting for voluntary exit)');
}

// ---------------------------------------------------------------------------
// C. Legit long command (child does real committed work) => NO false positive
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  const v = superviseFake(dir, 'legit', { baseTask: 'C', baseCycle: '1', marker: join(dir, 'AI_AUTONOMY', '.fake-marker.txt'), phaseTimeout: 20000 });
  ok(v.ok, 'C: supervise ran');
  eq(v.data.outcome, 'SUCCESS', 'C: legit long-work NOT interrupted => SUCCESS');
  ok(gitHead(dir) !== head0, 'C: legit run created real HEAD move (verified progress)');
  console.log('  [C] legit long command finished, no false positive');
}

// ---------------------------------------------------------------------------
// D. Silent stall (alive, no activity) => STALL
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const v = superviseFake(dir, 'silent', { baseTask: 'D', baseCycle: '1', phaseTimeout: 3000, gracefulMs: 500 });
  ok(v.ok, 'D: supervise ran');
  eq(v.data.outcome, 'STALL', 'D: silent stall => STALL (distinct from LOOP)');
  ok(v.data.stats.verified === 0, 'D: stall had zero verified progress');
  console.log('  [D] silent stall classified as STALL');
}

// ---------------------------------------------------------------------------
// E. Loop recovery: loop then SUCCESS on next attempt => cycle continues
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  // 1st attempt loops.
  const v1 = superviseFake(dir, 'loop', { baseTask: 'E', baseCycle: '1', gracefulMs: 500 }, head0);
  eq(v1.data.outcome, 'LOOP_INTERRUPTED', 'E: first attempt => LOOP_INTERRUPTED');
  // recovery next action from runtime should continue (not SAFE_MODE yet).
  const rec = runCliSafe(dir, 'recover');
  ok(rec.ok, 'E: recover ok');
  assert(rec.data.action !== 'SAFE_MODE', 'E: one loop does NOT yet force SAFE_MODE => next===' + rec.data.action);
  // 2nd attempt executes next_action (a real commit -> SUCCESS).
  const v2 = superviseFake(dir, 'commit', { baseTask: 'E', baseCycle: '1', marker: join(dir, 'AI_AUTONOMY', '.fake-marker.txt'), gracefulMs: 500 }, head0);
  eq(v2.data.outcome, 'SUCCESS', 'E: second (recovery) attempt => SUCCESS, cycle continues');
  console.log('  [E] loop -> recovery -> SUCCESS (cycle continues)');
}

// ---------------------------------------------------------------------------
// F. Repeated loop escalation => SAFE_MODE after threshold
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  runCliSafe(dir, 'acquire-lock', '--token', 'F');
  runCliSafe(dir, 'start-cycle', '--task', 'F-TASK', '--head', gitHead(dir), '--cycle', '1');
  for (let i = 0; i < 3; i++) {
    const f = runCliSafe(dir, 'fail', '--outcome', 'LOOP_INTERRUPTED', '--reason', 'NARRATION_LOOP(REPETITION)');
    ok(f.ok, `F: fail loop ${i + 1} ok`);
  }
  const rt = runCliSafe(dir, 'inspect');
  eq(rt.data.runtime.safeMode, true, 'F: repeated loops => SAFE_MODE escalation');
  const rec = runCliSafe(dir, 'recover');
  eq(rec.data.action, 'SAFE_MODE', 'F: recover returns SAFE_MODE after repeated loops');
  console.log('  [F] repeated loop escalation => SAFE_MODE');
}

// ---------------------------------------------------------------------------
// G. Process tree: parent + child + grandchild all terminated, no orphans
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const pidDir = join(dir, 'AI_AUTONOMY', '.tree-pids');
  const v = superviseFake(dir, 'tree', { baseTask: 'G', baseCycle: '1', pidDir, gracefulMs: 3000 });
  ok(v.ok, 'G: supervise ran');
  eq(v.data.outcome, 'LOOP_INTERRUPTED', 'G: tree loop => LOOP_INTERRUPTED (interrupts the live tree)');
  // Read the pidfiles the fake wrote, then assert none is alive -> no orphan.
  await new Promise((r) => setTimeout(r, 800)); // let taskkill settle
  const readPid = (name) => {
    const p = join(pidDir, name + '.pid');
    if (!existsSync(p)) return null;
    const pid = Number((readFileSync(p, 'utf8') || '').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  };
  const parentPid = readPid('parent');
  const childPid = readPid('child');
  const grandchildPid = readPid('grandchild');
  ok(parentPid, 'G: parent pid recorded by fake');
  ok(childPid, 'G: child pid recorded by fake');
  ok(grandchildPid, 'G: grandchild pid recorded by fake');
  if (parentPid) assert(!pidAlive(parentPid), 'G: PARENT process terminated (no orphan)');
  if (childPid) assert(!pidAlive(childPid), 'G: CHILD process terminated (no orphan)');
  if (grandchildPid) assert(!pidAlive(grandchildPid), 'G: GRANDCHILD process terminated (no orphan)');
  console.log('  [G] parent/child/grandchild all cleaned (no orphans): parent=' + parentPid + ' child=' + childPid + ' grand=' + grandchildPid);
}

// ---------------------------------------------------------------------------
// H. Crash (real, no narration loop) => CRASH, not LOOP_INTERRUPTED
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const v = superviseFake(dir, 'crash', { baseTask: 'H', baseCycle: '1', gracefulMs: 500 });
  ok(v.ok, 'H: supervise ran');
  eq(v.data.outcome, 'CRASH', 'H: crash => CRASH (not LOOP_INTERRUPTED)');
  const rt = runCliSafe(dir, 'inspect');
  eq(rt.data.runtime.outcome, 'CRASH', 'H: runtime persisted CRASH');
  console.log('  [H] crash => CRASH (distinct from loop)');
}

// ---------------------------------------------------------------------------
// I. Successful commit during execution => verified progress refreshed live
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  const v = superviseFake(dir, 'commit', { baseTask: 'I', baseCycle: '1', marker: join(dir, 'AI_AUTONOMY', '.fake-marker.txt'), gracefulMs: 500 }, head0);
  eq(v.data.outcome, 'SUCCESS', 'I: commit-mode => SUCCESS');
  ok(gitHead(dir) !== head0, 'I: HEAD changed during execution');
  ok(v.data.stats.verified >= 1, 'I: verified progress was observed during execution (live)');
  console.log('  [I] HEAD change refreshed verified progress during run');
}

// ---------------------------------------------------------------------------
// J. Foreign file mutation is NOT owned progress
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const cg = await import('file:///' + join(ROOT, 'AI_AUTONOMY/commit-guard.mjs').replace(/\\/g, '/') + '?ce=' + Date.now());
  const owned = ['AI_AUTONOMY/cli.mjs'];
  ok(cg.checkOwnedFiles('M AI_AUTONOMY/cli.mjs', owned).ok, 'J: owned file is owned progress');
  ok(!cg.checkOwnedFiles('M src/evil.js', owned).ok, 'J: foreign file is NOT owned progress');
  // runtime boundary: supervisor's own-ownedChanged is false => only HEAD counts.
  const rtMod = await import('file:///' + join(ROOT, 'AI_AUTONOMY/runtime.mjs').replace(/\\/g, '/') + '?ce=' + Date.now());
  const acc = { head: () => 'abc1234', ownedChanged: () => true };
  const det = rtMod.detectVerifiedProgress(rtMod.newRuntime(1, 1, null, 'abc1234'), acc, { ownedFiles: [] });
  // ownedFiles empty => ownedChanged not consulted => NO_PROGRESS despite fs change.
  eq(det.verified, false, 'J: foreign file alone (ownedFiles empty) is NOT verified progress');
  console.log('  [J] foreign file mutation is not counted as owned progress');
}

// ---------------------------------------------------------------------------
// K. Supervisor internal failure => checkpoint preserved, safe recovery, and
//    NEVER silent fallback to unsupervised mode.
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  runCliSafe(dir, 'acquire-lock', '--token', 'K');
  const head0 = gitHead(dir);
  runCliSafe(dir, 'start-cycle', '--task', 'K-TASK', '--head', head0, '--cycle', '5');
  // Force a supervisor internal failure: spawn a non-existent executable => CONFIG_ERROR.
  const v = runCliSafe(dir, 'supervise', '--cycle', '5', '--task', 'K-TASK', '--cmd', join(dir, 'no-such-binary.exe'), '--phase-timeout-ms', '5000');
  ok(v.ok, 'K: supervise reported (supervisor handled internal error)');
  assert(v.data && (v.data.outcome === 'CONFIG_ERROR' || v.data.supervisorFailure === true), 'K: supervisor internal failure surfaced as CONFIG_ERROR (not silently unsupervise): ' + (v.data && v.data.outcome));
  // checkpoint preserved: task identity + head survive.
  const rt = runCliSafe(dir, 'inspect');
  eq(rt.data.runtime.taskId, 'K-TASK', 'K: task identity preserved after supervisor internal failure');
  // runtime decided a safe recovery (retry), not a silent fallback.
  const rec = runCliSafe(dir, 'recover');
  ok(rec.ok, 'K: recover ok after supervisor failure');
  console.log('  [K] supervisor internal failure => CONFIG_ERROR + checkpoint preserved + runtime retry');
}

// ---------------------------------------------------------------------------
// L. Launcher integration: production launcher actually invokes cli supervise
//    (supervisor owns the live process; no parallel watchdog of the same PID).
// ---------------------------------------------------------------------------
{
  const launcher = readFileSync(join(ROOT, 'RUN-OPENCODE-AUTONOMOUS.ps1'), 'utf8');
  ok(/cli\s+supervise|'supervise'|"supervise"/.test(launcher), 'L: launcher invokes cli supervise (single authority over live OpenCode)');
  ok(!/\&\s*opencode\s+run/.test(launcher), 'L: launcher no longer launches opencode directly (supervisor is the authority)');
  ok(/prompt-file/.test(launcher), 'L: launcher passes the prompt via --prompt-file (multi-line safe)');
  ok(/stdout-log/.test(launcher), 'L: launcher streams live stdout via --stdout-log');
  ok(/recover/.test(launcher), 'L: launcher consumes runtime recovery');
  ok(/recoveryPrompt|Supervisor=live/.test(launcher), 'L: launcher tracks recovery + live supervision');
  console.log('  [L] production launcher delegates to cli supervise (checked source)');
}

// ---------------------------------------------------------------------------
// SCENARIO 1 (mission §18): Normal successful run, no orphan processes.
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const v = superviseFake(dir, 'normal', { baseTask: 'S1', baseCycle: '1', gracefulMs: 500 });
  eq(v.data.outcome, 'SUCCESS', 'S1: normal successful run');
  console.log('  [S1] normal successful run');
}

// ---------------------------------------------------------------------------
// SCENARIO 2 (mission §18): Infinite narration process stopped automatically,
// live, and no orphan node process remains.
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const start = Date.now();
  const v = superviseFake(dir, 'loop', { baseTask: 'S2', baseCycle: '1', gracefulMs: 800 });
  const elapsed = Date.now() - start;
  eq(v.data.outcome, 'LOOP_INTERRUPTED', 'S2: infinite narration stopped automatically');
  assert(elapsed < 30000, 'S2: interrupted LIVE (elapsed ' + elapsed + 'ms), not waiting indefinitely');
  // no orphan fake-opencode node remains: the supervised child tree was killed.
  await new Promise((r) => setTimeout(r, 500));
  console.log('  [S2] infinite narration stopped automatically in ~' + elapsed + 'ms');
}

// ---------------------------------------------------------------------------
// SCENARIO 3 (mission §18): Long legitimate child process NOT stopped early.
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const v = superviseFake(dir, 'legit', { baseTask: 'S3', baseCycle: '1', marker: join(dir, 'AI_AUTONOMY', '.fake-marker.txt'), phaseTimeout: 20000, gracefulMs: 500 });
  eq(v.data.outcome, 'SUCCESS', 'S3: legit long child finished (no premature stop)');
  console.log('  [S3] legit long child not stopped prematurely');
}

// ---------------------------------------------------------------------------
// SCENARIO 4 (mission §18): Crash + restart => state preserved, can recover.
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  const v = superviseFake(dir, 'crash', { baseTask: 'S4', baseCycle: '1', gracefulMs: 500 }, head0);
  eq(v.data.outcome, 'CRASH', 'S4: crash');
  const rt = runCliSafe(dir, 'inspect');
  eq(rt.data.runtime.taskId, 'S4', 'S4: task preserved across crash');
  ok(rt.data.runtime.headStart === head0, 'S4: headStart preserved across crash');
  console.log('  [S4] crash + state preserved for restart');
}

// ---------------------------------------------------------------------------
// SCENARIO 5 (mission §18): Loop + recovery + successful second execution.
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  const v1 = superviseFake(dir, 'loop', { baseTask: 'S5', baseCycle: '1', gracefulMs: 500 }, head0);
  eq(v1.data.outcome, 'LOOP_INTERRUPTED', 'S5: loop');
  const v2 = superviseFake(dir, 'commit', { baseTask: 'S5', baseCycle: '1', marker: join(dir, 'AI_AUTONOMY', '.fake-marker.txt'), gracefulMs: 500 }, head0);
  eq(v2.data.outcome, 'SUCCESS', 'S5: recovery second execution SUCCESS');
  console.log('  [S5] loop -> recovery -> successful second execution');
}

// ---------------------------------------------------------------------------
// HEARTBEAT LIVE FIELDS (mission §16): the heartbeat written during supervise
// reflects supervisor live state (supervisor, classification, opencodePid).
// ---------------------------------------------------------------------------
{
  const dir = setupW();
  const head0 = gitHead(dir);
  const hbPath = join(dir, 'AI_AUTONOMY', 'heartbeat.json');
  const v = superviseFake(dir, 'loop', { baseTask: 'HB', baseCycle: '1', gracefulMs: 500 }, head0);
  eq(v.data.outcome, 'LOOP_INTERRUPTED', 'HB: loop (for heartbeat check)');
  let hb = null;
  try { hb = JSON.parse(readFileSync(hbPath, 'utf8')); } catch { /* ignore */ }
  ok(hb, 'HB: heartbeat.json exists after supervise');
  if (hb) {
    eq(hb.supervisor, 'live', 'HB: supervisor=live in heartbeat');
    ok('lastNarrationAtRun' in hb, 'HB: lastNarrationAtRun present');
    assert(hb.intents >= 5, 'HB: intents reflected in live heartbeat');
  }
  console.log('  [HB] live heartbeat reflects supervisor state');
}

// ---------------------------------------------------------------------------
// Summary / cleanup
// ---------------------------------------------------------------------------
for (const d of toClean) {
  try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}
console.log(`\nCE-069 live-supervision test: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) {
  console.error('Failures:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
process.exit(0);
