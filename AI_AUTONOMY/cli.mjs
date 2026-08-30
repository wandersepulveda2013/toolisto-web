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
//   supervise --cmd CMD [--args "a b"] [--prompt-file F] [--stdout-log L]
//             [--cycle N] [--task T] [--phase P] [--phase-timeout-ms N]
//             [--graceful-ms N] [--owned a,b] [--live-heartbeat H]
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
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';
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
import * as history from './history.mjs';

// ROOT = the workspace root that contains AI_AUTONOMY/. Resolved from this file's
// own location (not process.cwd()) so PowerShell can invoke the CLI from anywhere.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(MODULE_DIR);
export const FILE = {
  runtime: process.env.TOOLISTO_RUNTIME_FILE || join(ROOT, 'AI_AUTONOMY', 'runtime.json'),
  state: process.env.TOOLISTO_STATE_FILE || join(ROOT, 'AI_AUTONOMY', 'state.json'),
  events: process.env.TOOLISTO_EVENTS_FILE || join(ROOT, 'AI_AUTONOMY', 'events.jsonl'),
  lock: process.env.TOOLISTO_LOCK_FILE || join(ROOT, 'AI_AUTONOMY', 'runner.lock'),
  heartbeat: process.env.TOOLISTO_HEARTBEAT_FILE || join(ROOT, 'AI_AUTONOMY', 'heartbeat.json'),
  history: process.env.TOOLISTO_HISTORY_FILE || join(ROOT, 'AI_AUTONOMY', 'history.jsonl'),
  policy: process.env.TOOLISTO_POLICY_FILE || join(ROOT, 'AI_AUTONOMY', 'policy.json'),
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

// SUPERVISE: run the controlled child (OpenCode or fake) to a verdict, with live
// supervision: verified-progress detection, narration-loop/stall classification,
// graceful-then-hard interrupt, process-tree cleanup, live heartbeat, and live
// stdout streaming to --stdout-log when requested. PowerShell delegates to this
// ONE authority over the child (CE-069: supervisor owns the live process; the
// PowerShell launcher only orchestrates cycles, never watches the same PID).
async function cmdSupervise(args) {
  const { superviseChild, makeRepoAccessor } = await import('./supervisor.mjs');
  // Preserve the checkpoint from the previous cycle so a supervisor failure or
  // crash never loses what we already committed (mission §14: checkpoint saved).
  let rt = readRuntimeOrNull();
  if (!rt) {
    rt = runtime.newRuntime(1, args.cycle != null ? Number(args.cycle) : 1, args.task || null, currentHead());
  }
  const ownedFiles = String(args.owned || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cmd = args.cmd;
  if (!cmd) return nokExit({ reason: '--cmd required' });
  // --args is whitespace-split (opencode flags). The prompt itself MUST ride on
  // --prompt-file so multi-line Spanish prompts survive intact (never embedded in
  // the whitespace-split flag list).
  const childArgs = String(args.args || '').length ? String(args.args).split(/\s+/).filter(Boolean) : [];
  if (args['prompt-file']) {
    try {
      childArgs.push(readFileSync(String(args['prompt-file']), 'utf8'));
    } catch (e) {
      return nokExit({ reason: '--prompt-file unreadable: ' + e.message });
    }
  }
  const stdoutLog = args['stdout-log'] ? String(args['stdout-log']) : null;
  if (stdoutLog) {
    mkdirSync(dirname(stdoutLog), { recursive: true });
  }
  const liveBeat = args['live-heartbeat'] ? String(args['live-heartbeat']) : FILE.heartbeat;

  // Live heartbeat writer: reflects supervisor live state during the run (§16).
  const liveFields = {
    supervisor: 'live',
    launcherPid: Number.isFinite(Number(process.ppid)) ? process.ppid : null,
    cycle: args.cycle != null ? Number(args.cycle) : rt.cycle,
    taskId: args.task || rt.taskId,
  };
  const writeLiveBeat = (snap) => {
    try {
      const beat = runtime.buildHeartbeat(
        { ...rt, opencodePid: snap.rootPid || rt.opencodePid, lastVerifiedStep: rt.lastVerifiedStep },
        { launcherAlive: true }
      );
      const merged = {
        ...beat,
        supervisor: 'live',
        classification: snap.classification || beat.supervisor,
        lastVerifiedAtRun: snap.lastVerifiedAt || 0,
        lastNarrationAtRun: snap.lastNarrationAt || 0,
        intents: snap.intents || 0,
        verified: snap.verified || 0,
        loopCount: rt.loopCount || 0,
        crashLoopStreak: rt.crashLoopStreak || 0,
      };
      writeFileSyncAtomic(liveBeat, JSON.stringify(stable(merged), null, 2) + '\n');
    } catch { /* best-effort */ }
  };

  let verdict;
  try {
    verdict = await superviseChild(rt, {
      root: ROOT,
      cmd,
      args: childArgs,
      ownedFiles,
      gitAccessor: makeRepoAccessor({ root: ROOT }),
      phase: args.phase || 'IMPLEMENTING',
      phaseTimeoutMs: args['phase-timeout-ms'] != null ? Number(args['phase-timeout-ms']) : 5 * 60 * 1000,
      gracefulMs: args['graceful-ms'] != null ? Number(args['graceful-ms']) : 5000,
      pollIntervalMs: 500,
      onLive: (snap) => writeLiveBeat(snap),
      onLine: (line, isStderr) => {
        if (stdoutLog) {
          try { appendFileSync(stdoutLog, (isStderr ? '[stderr] ' : '') + line + '\n', 'utf8'); } catch { /* best-effort */ }
        }
      },
    });
  } catch (e) {
    // Supervisor internal failure (mission §14): never silent-unsupervise. Keep
    // the checkpoint we loaded and persist a CONFIG_ERROR so the runtime can
    // decide a safe retry. Do NOT fall back to the old unsupervised launcher.
    rt = runtime.onFailure(rt, (rt.updatedSeq || 0) + 1, { outcome: 'CONFIG_ERROR', reason: 'supervisor internal: ' + e.message });
    runtime.writeRuntime(rt, FILE.runtime);
    writeFileSyncAtomic(liveBeat, JSON.stringify(stable({ supervisor: 'error', error: String(e && e.message || e) }), null, 2) + '\n');
    return okExit({
      ok: false,
      supervisorFailure: true,
      outcome: 'CONFIG_ERROR',
      reason: 'supervisor internal: ' + e.message,
      next: rt._next || null,
    });
  }

  if (stdoutLog) {
    try { appendFileSync(stdoutLog, `\n[SUPERVISOR] outcome=${verdict.outcome} reason=${verdict.reason} treeCleaned=${verdict.treeCleaned}\n`, 'utf8'); } catch { /* best-effort */ }
  }

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
    treeCleaned: verdict.treeCleaned,
    next: rt._next || null,
  });
}

// HISTORY / METRICS / RECOMMEND / TUNE / POLICY — Evidence-driven autonomy (CE-070).
// These read/write history.jsonl (append-only) and policy.json (versioned). All
// pure logic lives in history.mjs; the CLI is a thin bridge so PowerShell can
// consume machine-readable JSON like the rest of the runtime bridge.

function durToPhases(ms) {
  const ph = {};
  for (const p of runtime.PHASES) {
    if (p === 'DONE') continue;
    ph[p] = ms;
  }
  return ph;
}

function cmdHistoryRecord(args) {
  const entry = history.normalizeCycleEntry({
    kind: 'cycle',
    cycle: args.cycle,
    taskId: args.task,
    ce: args.ce,
    taskType: args['task-type'],
    source: args.source,
    priority: args.priority,
    selectedScore: args['selected-score'],
    durationMs: args['duration-ms'] || (args['duration-s'] ? Number(args['duration-s']) * 1000 : 0),
    initialState: args['from-state'],
    finalState: args['to-state'],
    filesChanged: args['files-changed'],
    commits: args.commits,
    focusedTests: args['focused-tests'],
    regressionTests: args['regression-tests'],
    retries: args.retries,
    crashes: args.crashes,
    loops: args.loops,
    stalls: args.stalls,
    recoveries: args.recoveries,
    safeMode: args['safe-mode'] === 'true' || args['safe-mode'] === '1',
    envFailure: args['env-failure'] === 'true' || args['env-failure'] === '1',
    blocked: args.blocked === 'true' || args.blocked === '1',
    promptSizeChars: args['prompt-size'],
    recoveryPromptSizeChars: args['recovery-size'],
    supervisorVerdicts: String(args.verdicts || '').split(',').map((s) => s.trim()).filter(Boolean),
    finalOutcome: args.outcome || args.verdict,
    failureFingerprints: String(args.fingerprints || '').split(',').map((s) => s.trim()).filter(Boolean),
    recoveryStrategies: String(args.strategies || '').split(',').map((s) => s.trim()).filter(Boolean),
    phaseDurations: durToPhases(args['duration-ms'] ? Number(args['duration-ms']) : (args['duration-s'] ? Number(args['duration-s']) * 1000 : 0)),
    partial: args.partial === 'true' || args.partial === '1',
    deferred: args.deferred === 'true' || args.deferred === '1',
    flags: String(args.flags || '').split(',').map((s) => s.trim()).filter(Boolean),
    note: args.note,
  });
  const stored = history.recordCycle(FILE.history, entry);
  return okExit({ recorded: true, cycle: stored.cycle, taskId: stored.taskId, outcome: history.classifyOutcome(stored) });
}

function cmdHistoryList(args) {
  const { cycles } = history.loadHistory(FILE.history);
  const limit = args.limit ? Number(args.limit) : 0;
  const arr = limit > 0 ? cycles.slice(-limit) : cycles;
  return okExit({ cycles: arr, count: cycles.length });
}

function cmdMetrics() {
  const { cycles, corrupt, total, partialHistory } = history.loadHistory(FILE.history);
  return okExit({
    metrics: history.metrics(cycles),
    corruption: { corrupt, total, partialHistory },
    foreignSafetyEvents: allEntries(FILE.history).filter((e) => e.kind === 'safety').length,
  });
}

function cmdRecommend(args) {
  const { cycles } = history.loadHistory(FILE.history);
  const policy = history.readPolicy(FILE.policy) || history.policyFileShape(runtime.PHASE_TIMEOUTS_MS);
  const taskRec = history.recommendTask(
    Object.values(queue.parseMarkdownQueue(safeRead(join(ROOT, 'workspace', 'CONTINUOUS-EVOLUTION-QUEUE.md'))).tasks),
    cycles
  );
  const timeouts = {};
  for (const ph of runtime.PHASES) {
    if (ph === 'DONE') continue;
    const samples = cycles.flatMap((c) => (c.phaseDurations && c.phaseDurations[ph]) ? [c.phaseDurations[ph]] : [c.durationMs || 0]);
    timeouts[ph] = history.recommendTimeout(ph, samples, policy.phases[ph] ?? runtime.PHASE_TIMEOUTS_MS[ph], policy.bounds || {});
  }
  const bloat = history.detectPromptBloat(cycles);
  const lowValue = cycles.map((c) => ({ cycle: c.cycle, value: history.valueSignal(c), signals: history.detectLowValueActivity(c) })).filter((x) => x.signals.length > 0);
  const recovery = history.recommendRecovery(args.fp || null, cycles);
  return okExit({
    taskRecommendation: taskRec,
    timeoutRecommendations: history.sortKeys(timeouts),
    contextWarnings: bloat,
    lowValueActivity: lowValue,
    recoveryRecommendation: recovery,
    policy: policy.policyVersion,
  });
}

// TUNE: recommendation-first. Default recommendation mode (mission §27);
// auto-apply PREVIEW only via --preview (never silent, always bounded).
function cmdTune(args) {
  const { cycles } = history.loadHistory(FILE.history);
  let policy = history.readPolicy(FILE.policy) || history.policyFileShape(runtime.PHASE_TIMEOUTS_MS);
  const timeouts = {};
  for (const ph of runtime.PHASES) {
    if (ph === 'DONE') continue;
    const samples = cycles.flatMap((c) => (c.phaseDurations && c.phaseDurations[ph]) ? [c.phaseDurations[ph]] : [c.durationMs || 0]);
    timeouts[ph] = history.recommendTimeout(ph, samples, policy.phases[ph] ?? runtime.PHASE_TIMEOUTS_MS[ph], policy.bounds || {});
  }
  const applied = [];
  if (args['apply'] === 'true' || args.apply === '1') {
    for (const [ph, rec] of Object.entries(timeouts)) {
      if (rec.status !== 'INSUFFICIENT_EVIDENCE' && rec.recommendedMs !== rec.currentMs && rec.status !== 'KEEP_CURRENT') {
        const res = history.applyPolicyChange(policy, {
          phase: ph,
          newMs: rec.recommendedMs,
          reason: rec.reason,
          evidence: `samples ${rec.samples}, p90 ${rec.p90}, p50 ${rec.p50}`,
        });
        if (res.ok) {
          applied.push({ phase: ph, fromMs: policy.phases[ph], toMs: res.policy.phases[ph] });
          policy = res.policy;
        }
      }
    }
    if (applied.length) history.writePolicy(FILE.policy, policy);
  }
  return okExit({
    mode: args['apply'] === 'true' || args.apply === '1' ? 'apply' : 'recommend',
    autoApplyDefault: false,
    explanation: 'adaptive auto-tuning OFF by default; recommendations must be reviewed before apply (CE-070 §27)',
    timeouts: history.sortKeys(timeouts),
    appliedChanges: applied,
    policyVersion: policy.policyVersion,
  });
}

// POLICY: versioning + rollback (mission §19).
function cmdPolicy(args) {
  const policy = history.readPolicy(FILE.policy) || history.policyFileShape(runtime.PHASE_TIMEOUTS_MS);
  if (args.apply) {
    const res = history.applyPolicyChange(policy, {
      phase: args['phase'] || args.phase,
      newMs: args['new-ms'] || args.newMs,
      reason: args.reason,
      evidence: args.evidence,
    });
    if (!res.ok) return nokExit({ reason: res.reason, status: res.status });
    history.writePolicy(FILE.policy, res.policy);
    return okExit({ policyVersion: res.policy.policyVersion, status: res.status, phases: res.policy.phases });
  }
  if (args.rollback) {
    const res = history.rollbackPolicy(policy);
    if (!res.ok) return nokExit({ reason: res.reason, status: res.status });
    history.writePolicy(FILE.policy, res.policy);
    return okExit({ policyVersion: res.policy.policyVersion, status: res.status, phases: res.policy.phases });
  }
  return okExit({ policy, autoApply: false });
}

function safeRead(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}
function allEntries(p) {
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* isolated */ }
  }
  return out;
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
    case 'history': {
      const sub = args.sub || args.record ? 'record' : 'list';
      if (args.record) return cmdHistoryRecord(args);
      return cmdHistoryList(args);
    }
    case 'metrics': return cmdMetrics();
    case 'recommend': return cmdRecommend(args);
    case 'tune': return cmdTune(args);
    case 'policy': return cmdPolicy(args);
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
