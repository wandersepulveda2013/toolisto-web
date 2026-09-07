// AI_AUTONOMY/runtime-policy-test — Unit tests for the CE-068 runtime state
// machine + recovery policy (retry budget, crash-loop backoff, SAFE_MODE, phase
// stall, verified-progress detection, heartbeat, restart-no-reset). Pure Node,
// no subprocesses. Complements the E2E integration test.

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const rt = await import('file:///' + join(ROOT, 'AI_AUTONOMY/runtime.mjs').replace(/\\/g, '/') + '?t=' + Date.now());

let pass = 0, fail = 0;
const fails = [];
function assert(c, m) { c ? pass++ : (fail++, fails.push(m), console.error('  FAIL: ' + m)); }
function eq(a, b, m) { assert(a === b, `${m} (${JSON.stringify(a)} !== ${JSON.stringify(b)})`); }
function ok(c, m) { assert(Boolean(c), m); }

// --- newRuntime + setPhase ---
{
  const r = rt.newRuntime(1, 5, 'T1', 'h0');
  eq(r.schema, 1, 'schema set');
  eq(r.cycle, 5, 'cycle carried');
  eq(r.taskId, 'T1', 'task carried');
  eq(r.phase, null, 'initial phase null until setPhase');
  const r2 = rt.setPhase(r, 2, 'IMPLEMENTING');
  eq(r2.phase, 'IMPLEMENTING', 'setPhase works');
  eq(r2.updatedSeq, 2, 'setPhase bumps seq');
  let threw = false;
  try { rt.setPhase(r2, 3, 'NOPE'); } catch { threw = true; }
  ok(threw, 'setPhase rejects invalid phase');
}

// --- recordVerifiedRuntime (real progress) ---
{
  let r = rt.newRuntime(1, 1, null, 'h0');
  r = rt.recordVerifiedRuntime(r, 2, 'commit:x', 'h1', 'abc123');
  eq(r.lastVerifiedAt, 1, 'verified count increments');
  eq(r.lastVerifiedStep, 'commit:x', 'last step recorded');
  eq(r.headCurrent, 'h1', 'headCurrent updated');
  eq(r.recoveryCount, 0, 'verified progress does not count as recovery');
}

// --- detectVerifiedProgress from accessor ---
{
  let r = rt.newRuntime(1, 1, null, 'h0');
  // no accessor change -> not verified
  const d0 = rt.detectVerifiedProgress(r, { head: () => 'h0' }, {});
  eq(d0.verified, false, 'no HEAD change => not verified');
  // HEAD moved => verified
  const d1 = rt.detectVerifiedProgress(r, { head: () => 'h1' }, {});
  eq(d1.verified, true, 'HEAD moved => verified');
  eq(d1.step, 'git:commit', 'step names the commit signal');
  // owned files changed => verified
  const d2 = rt.detectVerifiedProgress(r, { head: () => 'h0', ownedChanged: () => true }, { ownedFiles: ['x'] });
  eq(d2.verified, true, 'owned file changed => verified');
}

// --- failure fingerprint + retry ladder ---
{
  let r = rt.newRuntime(1, 1, null, 'h0');
  r = rt.onFailure(r, 2, { outcome: 'CRASH', reason: 'exit code 1' });
  eq(r.crashLoopStreak, 1, 'first crash -> streak 1');
  eq(r.retryBudget.directRetries, 1, 'direct retry consumed');
  // same fingerprint (restart should not increase distinct budget buckets)
  r = rt.onFailure(r, 3, { outcome: 'CRASH', reason: 'exit code 1' });
  eq(r.crashLoopStreak, 2, 'second same crash -> streak 2');
  const fp = rt.failureFingerprint('CRASH', 'exit code 1');
  // third crash -> SAFE_MODE
  r = rt.onFailure(r, 4, { outcome: 'CRASH', reason: 'exit code 1' });
  eq(r.crashLoopStreak, 3, 'third crash -> streak 3');
  eq(r.safeMode, true, 'third crash triggers SAFE_MODE');
}

// --- CONFIG_ERROR is infrastructure crash-loop material (mission §14: a
// supervisor that persistently cannot start must halt for human intervention).---
{
  let r = rt.newRuntime(1, 1, null, 'h0');
  r = rt.onFailure(r, 2, { outcome: 'CONFIG_ERROR', reason: 'supervisor internal: boom' });
  eq(r.crashLoopStreak, 1, 'first CONFIG_ERROR -> streak 1');
  eq(r.safeMode, false, 'first CONFIG_ERROR not SAFE_MODE yet');
  r = rt.onFailure(r, 3, { outcome: 'CONFIG_ERROR', reason: 'supervisor internal: boom' });
  eq(r.crashLoopStreak, 2, 'second CONFIG_ERROR -> streak 2');
  r = rt.onFailure(r, 4, { outcome: 'CONFIG_ERROR', reason: 'supervisor internal: boom' });
  eq(r.crashLoopStreak, 3, 'third CONFIG_ERROR -> streak 3');
  eq(r.safeMode, true, 'third CONFIG_ERROR => SAFE_MODE (infra failure halts for human)');
  // a success after infra failure resets the streak
  r = rt.onSuccess(r, 5);
  eq(r.crashLoopStreak, 0, 'success resets streak after CONFIG_ERROR');
}

// --- backoff escalation (driven by backoffLevel, 0-indexed) ---
{
  let r = rt.newRuntime(1, 1, null, 'h0');
  eq(rt.backoffMinutes(r), 1, 'fresh runtime backoff level 0 => 1 min');
  r = { ...r, backoffLevel: 0 };
  eq(rt.backoffMinutes(r), 1, 'level 0 -> 1 min');
  r = rt.onFailure(r, 2, { outcome: 'CRASH', reason: 'x' }); // streak 1 -> level 0
  eq(rt.backoffMinutes(r), 1, 'streak 1 (level 0) -> 1 min');
  r = rt.onFailure(r, 3, { outcome: 'CRASH', reason: 'x' }); // streak 2 -> level 1
  eq(rt.backoffMinutes(r), 2, 'streak 2 (level 1) -> 2 min');
  r = rt.onFailure(r, 4, { outcome: 'CRASH', reason: 'x' }); // streak 3 -> level 2
  eq(rt.backoffMinutes(r), 5, 'streak 3 (level 2) -> 5 min');
  const r4 = { ...r, backoffLevel: 3 };
  eq(rt.backoffMinutes(r4), 10, 'level 3 -> 10 min');
  const r9 = { ...r, backoffLevel: 99 };
  eq(rt.backoffMinutes(r9), 10, 'high level -> capped 10');
}

// --- evaluateSafeMode / isPhaseStalled ---
{
  // isPhaseStalled(r, seq, opts): seq & phaseStartedAt are sequence counters,
  // compared against a budget (ms). Use a tiny timeout budget for the test.
  const base = rt.newRuntime(1, 1, null, 'h0');
  // stalled: budget exceeded and no verified progress in the phase window
  const rStall = { ...base, phase: 'IMPLEMENTING', phaseStartedAt: 5, lastVerifiedAt: 0 };
  const stalled = rt.isPhaseStalled(rStall, 15, { timeouts: { IMPLEMENTING: 5 } });
  eq(stalled.stalled, true, 'budget exceeded + no progress => stalled');
  // not stalled: verified progress happened within the phase window
  const rOk = { ...base, phase: 'IMPLEMENTING', phaseStartedAt: 5, lastVerifiedAt: 10 };
  const notStalled = rt.isPhaseStalled(rOk, 15, { timeouts: { IMPLEMENTING: 5 } });
  eq(notStalled.stalled, false, 'budget exceeded but recent progress => not stalled');
  // SAFE_MODE triggers
  const ev = rt.evaluateSafeMode(base, {});
  eq(ev.safeMode, false, 'no triggers => not safe');
  const ev2 = rt.evaluateSafeMode(base, { tooManyCrashes: true, gitConflict: true });
  eq(ev2.safeMode, true, 'trigger => safe');
  ok(ev2.reasons.includes('TOO_MANY_CRASHES'), 'reason recorded');
}

// --- onSuccess resets ---
{
  let r = rt.newRuntime(1, 1, null, 'h0');
  r = rt.onFailure(r, 2, { outcome: 'CRASH', reason: 'x' });
  r = rt.onSuccess(r, 3);
  eq(r.crashLoopStreak, 0, 'success resets crash streak');
  eq(r.retryBudget.directRetries, 0, 'success resets retry budget');
  eq(r.safeMode, false, 'success clears SAFE_MODE');
  eq(r.outcome, 'SUCCESS', 'outcome recorded SUCCESS');
}

// --- buildHeartbeat ---
{
  let r = rt.newRuntime(1, 7, 'T9', 'h0');
  r = rt.setPhase(r, 2, 'IMPLEMENTING');
  r = { ...r, opencodePid: 4242 };
  const beat = rt.buildHeartbeat(r, { launcherAlive: true });
  eq(beat.cycle, 7, 'heartbeat carries cycle');
  eq(beat.taskId, 'T9', 'heartbeat carries task');
  eq(beat.phase, 'IMPLEMENTING', 'heartbeat carries phase');
  eq(beat.launcherAlive, true, 'heartbeat launcherAlive flag');
  eq(beat.opencodePid, 4242, 'heartbeat carries pid');
  ok(beat.updatedSeq >= 0, 'heartbeat has seq');
}

// --- write/read runtime (persistence) + restart-no-reset ---
{
  const dir = mkdtempSync(join(tmpdir(), 'tlt-runtime-'));
  const file = join(dir, 'runtime.json');
  let r = rt.newRuntime(1, 1, 'T-A', 'ha');
  r = rt.onFailure(r, 2, { outcome: 'CRASH', reason: 'boom' });
  rt.writeRuntime(r, file);
  // "launcher restarts": re-read from disk -> crash counter NOT reset.
  const r2 = rt.readRuntime(file);
  eq(r2.crashLoopStreak, 1, 'restart preserves crashLoopStreak (must NOT reset)');
  eq(r2.retryBudget.directRetries, 1, 'restart preserves retry budget (must NOT reset)');
  eq(r2.taskId, 'T-A', 'restart preserves task');
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log(`\nAI_AUTONOMY runtime policy test: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) { for (const f of fails) console.error('  - ' + f); process.exit(1); }
