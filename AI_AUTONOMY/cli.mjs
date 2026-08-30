#!/usr/bin/env node
// AI_AUTONOMY/cli.mjs — Thin PowerShell <-> runtime bridge.
//
// Exposes the CE-067/CE-068 runtime as machine-readable commands. PowerShell
// calls this CLI and consumes JSON on stdout; the runtime is the SINGLE source
// of truth for state machine + recovery. PowerShell never reimplements the
// logic it already has in JS.
//
// Convention:
//   - stdout: exactly one JSON object (no human narration mixed in).
//   - stderr: human diagnostics only.
//   - exit:  0 = ok, 1 = expected/defined non-ok (see JSON), 2 = usage error,
//            3 = internal error.
//
// Commands:
//   boot
//   plan
//   acquire-lock [--token T]
//   release-lock [--token T]
//   start-cycle --task T --head H [--cycle N]
//   supervise --cmd CMD [--args "a b"] [--cycle N] [--task T] [--phase P]
//             [--phase-timeout-ms N] [--owned a,b] [--recovery 1]
//   record-action --step S [--head H] [--commit C]
//   set-phase --phase P
//   heartbeat [--pid P]
//   inspect
//   finish --result R
//   fail --reason R [--outcome O]
//   recover
//   read-state

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import {
  acquireLock,
  releaseLock,
  isLockStale,
  readLock,
} from './lock.mjs';
import * as state from './state.mjs';
import * as runtime from './runtime.mjs';
import * as runner from './runner.mjs';
import * as queue from './queue.mjs';

// ROOT = the workspace root that contains AI_AUTONOMY/. Resolved from this file's
// own location (not process.cwd()) so PowerShell can invoke the CLI from anywhere.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(MODULE_DIR);
export const FILE = {
  runtime: join(ROOT, 'AI_AUTONOMY', 'runtime.json'),
  state: join(ROOT, 'AI_AUTONOMY', 'state.json'),
  events: join(ROOT, 'AI_AUTONOMY', 'events.jsonl'),
  lock: join(ROOT, 'AI_AUTONOMY', 'runner.lock'),
  heartbeat: join(ROOT, 'AI_AUTONOMY', 'heartbeat.json'),
};

function out(obj) {
  // Stable key order for determinism-friendly output.
  process.stdout.write(JSON.stringify(stable(obj)) + '\n');
}
function okExit(obj) {
  out({ ok: true, ...obj });
  process.exit(0);
}
function nokExit(obj, code = 1) {
  out({ ok: false, ...obj });
  process.exit(code);
}
function err(msg, code = 3) {
  // diagnostics to stderr only
  process.stderr.write('AI_AUTONOMY cli: ' + msg + '\n');
  process.exit(code);
}

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

function parseArgs(argv) {
  const s = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      s[key] = val !== undefined && !String(val).startsWith('--') ? val : true;
      if (s[key] === true) {
        // still consume next if value expected and not a flag
      } else {
        i++;
      }
    }
  }
  return s;
}

function readRuntimeOrNull() {
  return runtime.readRuntime(FILE.runtime);
}
function readStateOrNull() {
  return state.readCheckpoint(FILE.state);
}

function currentHead() {
  try {
    const h = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    return (h || '').trim() || null;
  } catch {
    return null;
  }
}

// BOOT: decide the initial action from persisted state + lock + crash-loop level.
function cmdBoot() {
  const lockStale = isLockStale(FILE.lock);
  const running = readRuntimeOrNull();
  const ck = readStateOrNull();
  const plan = runner.planCycle(ck);

  // Single-instance: if another runner holds a live lock, we must back off.
  const holder = readLock(FILE.lock);
  if (holder && !lockStale.stale) {
    return nokExit({ action: 'BLOCKED_OWNER', reason: 'lock held by live runner', owner: holder.pid });
  }

  // SAFE_MODE if crash-loop already triggered or runtime says safe.
  if (running && (running.safeMode || (running.crashLoopStreak || 0) >= runtime.RETRY_BUDGET.crashLoopThreshold)) {
    return okExit({
      action: 'SAFE_MODE',
      reason: running.safeModeReason || 'crash-loop threshold reached',
      cycle: running.cycle,
      taskId: running.taskId,
    });
  }

  const action = plan.action;
  return okExit({
    action,
    reason: plan.reason,
    cycle: plan.cycle,
    taskId: plan.taskId,
    plan,
    runtime: running ? { crashLoopStreak: running.crashLoopStreak, recoveryCount: running.recoveryCount, safeMode: !!running.safeMode } : null,
  });
}

// START-CYCLE: seed a RUNNING runtime+state (only meaningful for FRESH/RESUME).
function cmdStartCycle(args) {
  const task = args.task || null;
  const head = args.head || currentHead();
  const cycle = args.cycle != null ? Number(args.cycle) : null;
  let rt = readRuntimeOrNull();
  let ck = readStateOrNull();
  let seq = (rt?.updatedSeq || ck?.updatedSeq || 0) + 1;
  const finalCycle = cycle != null ? cycle : (rt?.cycle || 0) + 1;

  if (!ck || ck.finished) {
    ck = state.newCycle(seq, finalCycle, task, head);
    state.writeCheckpoint(ck, FILE.state);
  }
  if (!rt) {
    rt = runtime.newRuntime(seq, finalCycle, task, head);
    runtime.writeRuntime(rt, FILE.runtime);
  } else if (rt.finished) {
    rt = runtime.newRuntime(seq, finalCycle, task, head);
    runtime.writeRuntime(rt, FILE.runtime);
  }
  return okExit({ cycle: finalCycle, taskId: task, seq });
}

// RECORD-ACTION: register verified progress (called by launcher on real signals).
function cmdRecordAction(args) {
  const step = args.step || 'action';
  const head = args.head || currentHead();
  const commit = args.commit || null;
  let rt = readRuntimeOrNull();
  if (!rt) return nokExit({ reason: 'no runtime state; start a cycle first' });
  const seq = rt.updatedSeq + 1;
  rt = runtime.recordVerifiedRuntime(rt, seq, step, head, commit);
  runtime.writeRuntime(rt, FILE.runtime);
  // also mirror into the CE-067 checkpoint
  let ck = readStateOrNull();
  if (ck) {
    ck = state.recordVerified(ck, seq, step, head, commit);
    state.writeCheckpoint(ck, FILE.state);
    state.appendEvent(FILE.events, { kind: 'verified', seq, taskId: ck.taskId, step, head, commit, verifiedAt: ck.verifiedCount });
  }
  return okExit({ step, verifiedAt: rt.lastVerifiedAt, head: rt.headCurrent });
}

// HEARTBEAT: write machine-readable liveness + snapshot.
function cmdHeartbeat(args) {
  const rt = readRuntimeOrNull() || runtime.newRuntime(1, null, null, currentHead());
  const beat = runtime.buildHeartbeat(rt, {
    launcherAlive: true,
    opencodePid: args.pid != null ? Number(args.pid) : rt.opencodePid,
  });
  runtime.writeRuntime(rt, FILE.runtime);
  writeFileSyncAtomic(FILE.heartbeat, JSON.stringify(stable(beat), null, 2) + '\n');
  return okExit({ heartbeat: beat });
}

// SET-PHASE.
function cmdSetPhase(args) {
  let rt = readRuntimeOrNull();
  if (!rt) return nokExit({ reason: 'no runtime state' });
  const seq = rt.updatedSeq + 1;
  try {
    rt = runtime.setPhase(rt, seq, String(args.phase || '').toUpperCase());
  } catch (e) {
    return nokExit({ reason: e.message });
  }
  runtime.writeRuntime(rt, FILE.runtime);
  return okExit({ phase: rt.phase });
}

// FINISH: terminal success.
function cmdFinish(args) {
  let rt = readRuntimeOrNull();
  if (!rt) return nokExit({ reason: 'no runtime state' });
  const seq = rt.updatedSeq + 1;
  rt = runtime.onSuccess(rt, seq);
  rt = runtime.setPhase(rt, seq + 1, 'DONE');
  runtime.writeRuntime(rt, FILE.runtime);
  let ck = readStateOrNull();
  if (ck) {
    try {
      ck = state.advanceTaskState(ck, seq, 'IMPLEMENTED');
      ck = state.advanceTaskState(ck, seq + 1, 'TRACKERS');
      ck = state.advanceTaskState(ck, seq + 2, 'FINISHED');
      ck = { ...ck, result: args.result || 'SUCCESS', finished: true };
      state.writeCheckpoint(ck, FILE.state);
      state.appendEvent(FILE.events, { kind: 'cycle_finished', taskId: ck.taskId, result: args.result || 'SUCCESS' });
    } catch (e) {
      // checkpoint path is best-effort; runtime is authoritative
    }
  }
  return okExit({ outcome: 'SUCCESS', result: args.result || 'SUCCESS', cycle: rt.cycle });
}

// FAIL: record a failure (outcome inferred or given) + return next action.
function cmdFail(args) {
  let rt = readRuntimeOrNull();
  if (!rt) return nokExit({ reason: 'no runtime state' });
  const seq = rt.updatedSeq + 1;
  const outcome = args.outcome || inferOutcome(args.reason);
  rt = runtime.onFailure(rt, seq, { outcome, reason: args.reason || null });
  runtime.writeRuntime(rt, FILE.runtime);
  let ck = readStateOrNull();
  if (ck) {
    try {
      ck = state.advanceTaskState(ck, seq, 'FAILED');
      state.writeCheckpoint(ck, FILE.state);
      state.appendEvent(FILE.events, { kind: 'cycle_failed', taskId: ck.taskId, reason: args.reason || null, outcome });
    } catch (e) { /* best-effort */ }
  }
  return okExit({ outcome, next: rt._next, reason: args.reason, safeMode: !!rt.safeMode, crashLoopStreak: rt.crashLoopStreak });
}

function inferOutcome(reason) {
  const r = String(reason || '').toUpperCase();
  if (r.includes('LOOP')) return 'LOOP_INTERRUPTED';
  if (r.includes('TIMEOUT') || r.includes('STALL')) return 'TIMEOUT';
  if (r.includes('CRASH') || r.includes('EXIT CODE') || r.includes('FAILED')) return 'CRASH';
  return 'RECOVERABLE_FAILURE';
}

// RECOVER: compute next action from runtime.
function cmdRecover() {
  const rt = readRuntimeOrNull();
  const ck = readStateOrNull();
  if (!rt) return okExit({ action: 'FRESH', reason: 'no runtime; fresh start' });
  if (rt.safeMode) return okExit({ action: 'SAFE_MODE', reason: rt.safeModeReason, backoffMinutes: runtime.backoffMinutes(rt) });
  const next = rt._next || 'RETRY_DIRECT';
  return okExit({
    action: mapNextToAction(next),
    next,
    reason: rt.outcome ? `after ${rt.outcome}` : 'recover',
    backoffMinutes: rt.crashLoopStreak ? runtime.backoffMinutes(rt) : 0,
    cycle: rt.cycle,
  });
}
function mapNextToAction(next) {
  switch (next) {
    case 'SAFE_MODE': return 'SAFE_MODE';
    case 'DEFER_TASK': return 'DEFER_TASK';
    case 'CONTEXT_RESET': return 'CONTEXT_RESET';
    case 'STRATEGY_SWITCH': return 'STRATEGY_SWITCH';
    default: return 'RETRY_DIRECT';
  }
}

// INSPECT: full snapshot (runtime + state + heartbeat + lock).
function cmdInspect() {
  const rt = readRuntimeOrNull() || runtime.EMPTY_RUNTIME();
  const ck = readStateOrNull();
  const ls = isLockStale(FILE.lock);
  let hb = null;
  try {
    hb = readFileSafe(FILE.heartbeat) ? JSON.parse(readFileSafe(FILE.heartbeat)) : null;
  } catch { /* ignore */ }
  return okExit({ runtime: rt, checkpoint: ck, heartbeat: hb, lock: ls });
}

// READ-STATE: raw checkpoint.
function cmdReadState() {
  return okExit({ checkpoint: readStateOrNull() });
}

function writeFileSyncAtomic(p, content) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}
function readFileSafe(p) {
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

// SUPERVISE: run the controlled child and persist the result.
async function cmdSupervise(args) {
  const { superviseChild, makeRepoAccessor } = await import('./supervisor.mjs');
  // Build runtime seed.
  let rt = readRuntimeOrNull();
  if (!rt) {
    rt = runtime.newRuntime(1, args.cycle != null ? Number(args.cycle) : 1, args.task || null, currentHead());
  }
  const ownedFiles = String(args.owned || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cmd = args.cmd;
  if (!cmd) return nokExit({ reason: '--cmd required' });
  const childArgs = String(args.args || '').length ? String(args.args).split(/\s+/).filter(Boolean) : [];

  const verdict = await superviseChild(rt, {
    root: ROOT,
    cmd,
    args: childArgs,
    ownedFiles,
    gitAccessor: makeRepoAccessor({ root: ROOT }),
    phase: args.phase || 'IMPLEMENTING',
    phaseTimeoutMs: args['phase-timeout-ms'] != null ? Number(args['phase-timeout-ms']) : 5 * 60 * 1000,
    pollIntervalMs: 500,
    onLine: (l) => { /* narration only used by guard inside supervisor */ },
  });

  // Persist outcome into runtime + state.
  const seq = (rt.updatedSeq || 0) + 1;
  if (verdict.outcome === 'SUCCESS') {
    rt = runtime.onSuccess(rt, seq);
    rt = { ...rt, phase: 'DONE', headFrom: verdict.headFrom, headTo: verdict.headTo };
    rt = runtime.setPhase(rt, seq + 1, 'DONE');
    runtime.writeRuntime(rt, FILE.runtime);
    let ck = readStateOrNull();
    if (ck) {
      try {
        ck = state.advanceTaskState(ck, seq, 'IMPLEMENTED');
        ck = state.advanceTaskState(ck, seq + 1, 'TRACKERS');
        ck = state.advanceTaskState(ck, seq + 2, 'FINISHED');
        ck = { ...ck, result: verdict.reason || 'SUCCESS', finished: true };
        state.writeCheckpoint(ck, FILE.state);
        state.appendEvent(FILE.events, { kind: 'cycle_finished', taskId: ck.taskId, result: verdict.reason });
      } catch (e) { /* best-effort */ }
    }
  } else {
    rt = runtime.onFailure(rt, seq, { outcome: verdict.outcome, reason: verdict.reason });
    rt = { ...rt, headFrom: verdict.headFrom, headTo: verdict.headTo };
    runtime.writeRuntime(rt, FILE.runtime);
    let ck = readStateOrNull();
    if (ck) {
      try {
        ck = state.advanceTaskState(ck, seq, 'FAILED');
        state.writeCheckpoint(ck, FILE.state);
        state.appendEvent(FILE.events, { kind: 'cycle_failed', taskId: ck.taskId, reason: verdict.reason, outcome: verdict.outcome });
      } catch (e) { /* best-effort */ }
    }
  }
  return okExit({
    outcome: verdict.outcome,
    reason: verdict.reason,
    exitCode: verdict.exitCode,
    headFrom: verdict.headFrom,
    headTo: verdict.headTo,
    stats: verdict.stats,
    next: rt._next || null,
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) return err('usage: cli.mjs <command> [args]', 2);
  const args = parseArgs(rest);
  switch (cmd) {
    case 'boot': return cmdBoot();
    case 'plan': return cmdBoot();
    case 'acquire-lock': {
      const r = acquireLock(FILE.lock, { root: ROOT, token: args.token });
      return r.ok ? okExit({ lock: r.owner }) : nokExit({ reason: r.reason, owner: r.owner });
    }
    case 'release-lock': {
      const r = releaseLock(FILE.lock, args.token);
      return r.ok ? okExit({ released: true }) : nokExit({ reason: r.reason });
    }
    case 'start-cycle': return cmdStartCycle(args);
    case 'record-action': return cmdRecordAction(args);
    case 'heartbeat': return cmdHeartbeat(args);
    case 'set-phase': return cmdSetPhase(args);
    case 'finish': return cmdFinish(args);
    case 'fail': return cmdFail(args);
    case 'recover': return cmdRecover();
    case 'inspect': return cmdInspect();
    case 'read-state': return cmdReadState();
    case 'supervise': return cmdSupervise(args);
    case 'lock-status': {
      const ls = isLockStale(FILE.lock);
      return okExit({ stale: ls.stale, lock: ls.lock });
    }
    default: return err('unknown command: ' + cmd, 2);
  }
}

main().catch((e) => {
  process.stderr.write('AI_AUTONOMY cli error: ' + (e && e.stack || e) + '\n');
  process.exit(3);
});
