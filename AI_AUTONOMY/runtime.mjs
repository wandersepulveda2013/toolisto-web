// AI_AUTONOMY/runtime.mjs — Persistent operational state + supervision policies
// for the autonomous OpenCode launcher.
//
// CE-067 built the CORE brain (state machine, guard, checkpoint). CE-068 wires
// it to the REAL loop. This module holds the OPERATIONAL state that must survive
// launcher restarts (the mission's "a restart must not magically reset retries"):
//   - retry budget / recovery counters
//   - crash-loop streck + progressive backoff
//   - SAFE_MODE triggers
//   - phase timeouts (DISCOVERY/IMPLEMENTING/VALIDATING/COMMITTING/TRACKERS)
//   - verified-progress detection (HEAD moved, owned-file changed, commit)
//   - heartbeat model
//
// Everything is pure/unit-testable; filesystem+git ops are injected so tests can
// simulate without touching the real repo or real processes.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { dirname } from 'path';

// ---------------------------------------------------------------------------
// Constants / policy
// ---------------------------------------------------------------------------

export const PHASES = Object.freeze([
  'DISCOVERY',
  'IMPLEMENTING',
  'VALIDATING',
  'COMMITTING',
  'TRACKERS',
  'DONE',
]);

// Default wall-clock budgets (ms) per phase. Stall is a DIFFERENT concept from
// long-running: a phase may legitimately take long IF verified progress is
// advancing; if a phase exceeds its budget with NO verified progress, it is a
// stall. These are generous to avoid killing legitimate slow work.
export const PHASE_TIMEOUTS_MS = Object.freeze({
  DISCOVERY: 30 * 60 * 1000, // 30 min
  IMPLEMENTING: 4 * 60 * 60 * 1000, // 4 h
  VALIDATING: 2 * 60 * 60 * 1000, // 2 h
  COMMITTING: 30 * 60 * 1000, // 30 min
  TRACKERS: 30 * 60 * 1000, // 30 min
  DEFAULT: 3 * 60 * 60 * 1000, // 3 h
});

// Retry budget (mission §12): decompose a recurring failure, don't loop forever.
export const RETRY_BUDGET = Object.freeze({
  maxSameFailureDirectRetries: 2, // same failure fingerprint
  maxStrategySwitches: 2, // after direct retries, switch technique up to 2x
  maxContextResets: 1, // then reset context
  crashLoopThreshold: 3, // >=3 rapid crashes => SAFE_MODE
  afterBudgetAction: 'DEFER_TASK', // then defer/fail task and continue with safe work
});

// Progressive backoff for crash loops / repeated immediate failures (minutes).
export const BACKOFF_MINUTES = Object.freeze([1, 2, 5, 10]);
export const MAX_BACKOFF_MINUTES = 10;

// ---------------------------------------------------------------------------
// Operational state shape
// ---------------------------------------------------------------------------

export const EMPTY_RUNTIME = () => ({
  schema: 1,
  cycle: null,
  taskId: null,
  taskState: null,
  phase: null,
  phaseStartedAt: 0,
  headStart: null,
  headCurrent: null,
  lastVerifiedStep: null,
  lastVerifiedAt: 0, // monotonic counter (sequential, not wall clock)
  recoveryCount: 0,
  loopCount: 0,
  crashLoopStreak: 0,
  backoffLevel: 0,
  nextBackoffAt: 0,
  retryBudget: {
    directRetries: 0,
    strategySwitches: 0,
    contextResets: 0,
    lastFailureFingerprint: null,
  },
  opencodePid: null,
  childStartMs: 0,
  safeMode: false,
  safeModeReason: null,
  exited: false,
  exitCode: null,
  outcome: null, // SUCCESS / RECOVERABLE_FAILURE / TIMEOUT / LOOP_INTERRUPTED / CRASH / OWNER_BLOCKED / SAFE_MODE / CONFIG_ERROR
  updatedSeq: 0,
});

// ---------------------------------------------------------------------------
// Pure transition helpers (immutable; return new runtime object)
// ---------------------------------------------------------------------------

export function newRuntime(seq, cycle, taskId, head) {
  const r = EMPTY_RUNTIME();
  r.updatedSeq = seq;
  r.cycle = cycle;
  r.taskId = taskId || null;
  r.headStart = head || null;
  r.headCurrent = head || null;
  return r;
}

// Set the current phase and reset its start clock.
export function setPhase(r, seq, phase) {
  if (!PHASES.includes(phase)) throw new Error('invalid phase: ' + phase);
  return { ...r, updatedSeq: seq, phase, phaseStartedAt: seq };
}

// Commit to an outcome (terminal-ish; recording what happened).
export function setOutcome(r, seq, outcome, opts = {}) {
  return {
    ...r,
    updatedSeq: seq,
    outcome,
    exitCode: opts.exitCode != null ? opts.exitCode : r.exitCode,
    exited: true,
    safeMode: opts.safeMode != null ? opts.safeMode : r.safeMode,
    safeModeReason: opts.safeModeReason != null ? opts.safeModeReason : r.safeModeReason,
  };
}

// Record verified progress from a real signal (HEAD moved, owned file changed).
// This is the ONLY thing that resets the stall/recovery clocks and confirms a
// phase is alive.
export function recordVerifiedRuntime(r, seq, step, head, commit = null) {
  return {
    ...r,
    updatedSeq: seq,
    lastVerifiedStep: step,
    lastVerifiedAt: (r.lastVerifiedAt || 0) + 1,
    headCurrent: head || r.headCurrent,
    lastCommit: commit != null ? commit : r.lastCommit,
  };
}

// ---------------------------------------------------------------------------
// Retry budget (mission §12) and crash-loop handling (mission §13)
// ---------------------------------------------------------------------------

// Classify a failure into a stable fingerprint so "same failure" is measurable.
export function failureFingerprint(outcome, reason) {
  return String(outcome || '') + '::' + String(reason || '').slice(0, 60);
}

// Register a failure; returns updated runtime + a recommended next step:
//   { next: 'RETRY_DIRECT' | 'STRATEGY_SWITCH' | 'CONTEXT_RESET' | 'DEFER_TASK' | 'SAFE_MODE', ... }
// A failed start (crash) increases crashLoopStreak; a crash loop beyond the
// threshold forces SAFE_MODE with progressive backoff.
export function onFailure(r, seq, { outcome = 'CRASH', reason = null } = {}) {
  const fp = failureFingerprint(outcome, reason);
  const same = r.retryBudget.lastFailureFingerprint === fp;
  let budget = { ...r.retryBudget };
  if (same) {
    budget.directRetries = (budget.directRetries || 0) + 1;
  } else {
    budget = {
      directRetries: 0,
      strategySwitches: 0,
      contextResets: 0,
      lastFailureFingerprint: fp,
    };
    budget.directRetries = 1;
  }
  let next;
  // Crash-loop protection: repeated rapid crashes escalate to SAFE_MODE.
  if (outcome === 'CRASH' || outcome === 'LOOP_INTERRUPTED' || outcome === 'TIMEOUT') {
    const streak = (r.crashLoopStreak || 0) + 1;
    const backoffLevel = Math.min(streak - 1, BACKOFF_MINUTES.length - 1);
    if (streak >= RETRY_BUDGET.crashLoopThreshold) {
      next = 'SAFE_MODE';
    } else if (budget.directRetries > RETRY_BUDGET.maxSameFailureDirectRetries) {
      next = budget.strategySwitches >= RETRY_BUDGET.maxStrategySwitches
        ? budget.contextResets >= RETRY_BUDGET.maxContextResets
          ? 'DEFER_TASK'
          : 'CONTEXT_RESET'
        : 'STRATEGY_SWITCH';
    } else {
      next = 'RETRY_DIRECT';
    }
    return {
      ...r,
      updatedSeq: seq,
      retryBudget: budget,
      crashLoopStreak: streak,
      backoffLevel,
      nextBackoffAt: seq + BACKOFF_MINUTES[backoffLevel],
      outcome,
      exited: true,
      safeMode: next === 'SAFE_MODE',
      safeModeReason: next === 'SAFE_MODE' ? `crash-loop (streak ${streak})` : r.safeModeReason,
      _next: next,
    };
  }
  // Recoverable (non-crash) failure: simpler budget ladder.
  if (budget.directRetries > RETRY_BUDGET.maxSameFailureDirectRetries) {
    next = budget.strategySwitches >= RETRY_BUDGET.maxStrategySwitches ? 'DEFER_TASK' : 'STRATEGY_SWITCH';
  } else {
    next = 'RETRY_DIRECT';
  }
  return {
    ...r,
    updatedSeq: seq,
    retryBudget: budget,
    outcome,
    exited: true,
    _next: next,
  };
}

// On success, reset the recovery/crash/retry clocks so a healthy run is clean.
export function onSuccess(r, seq) {
  return {
    ...r,
    updatedSeq: seq,
    crashLoopStreak: 0,
    backoffLevel: 0,
    retryBudget: {
      directRetries: 0,
      strategySwitches: 0,
      contextResets: 0,
      lastFailureFingerprint: null,
    },
    outcome: 'SUCCESS',
    exited: true,
  };
}

// Compute backoff minutes for the current crashLoop/level.
export function backoffMinutes(r) {
  const level = Math.max(0, r.backoffLevel || 0);
  return BACKOFF_MINUTES[Math.min(level, BACKOFF_MINUTES.length - 1)];
}

// ---------------------------------------------------------------------------
// SAFE_MODE triggers (mission §14)
// ---------------------------------------------------------------------------

// Given a proposed next action and reasons, decide if we must enter SAFE_MODE.
export function evaluateSafeMode(r, triggers = {}) {
  const reasons = [];
  if (r.safeMode) reasons.push('ALREADY_SAFE');
  if (triggers.corruptCheckpoint) reasons.push('CORRUPT_CHECKPOINT');
  if (triggers.gitConflict) reasons.push('GIT_MERGE_REBASE_CONFLICT');
  if (triggers.tooManyCrashes) reasons.push('TOO_MANY_CRASHES');
  if (triggers.invalidTransition) reasons.push('INVALID_STATE_TRANSITION');
  if (triggers.lockInconsistent) reasons.push('LOCK_INCONSISTENT');
  if (triggers.repeatedCommitGuardViolation) reasons.push('REPEATED_COMMIT_GUARD_VIOLATION');
  if (reasons.length === 0) return { safeMode: false, reasons: [] };
  return { safeMode: true, reasons };
}

// ---------------------------------------------------------------------------
// Phase stall detection (mission §9, §16)
// ---------------------------------------------------------------------------

// A phase is STALLED if it exceeded its budget AND there was NO verified progress
// within the window (lastVerifiedAt hasn't advanced since phase start for a
// "long" time). Long-running-but-progressing is NOT a stall.
export function isPhaseStalled(r, seq, opts = {}) {
  const timeouts = { ...PHASE_TIMEOUTS_MS, ...(opts.timeouts || {}) };
  const budget = timeouts[r.phase] ?? timeouts.DEFAULT;
  const elapsed = seq - (r.phaseStartedAt || 0);
  if (elapsed <= budget) return { stalled: false, budget };
  // Budget exceeded: stalled only if we also saw no verified progress recently.
  // We approximate "recent" as the last budget window.
  const progressedInWindow = (r.lastVerifiedAt || 0) >= (r.phaseStartedAt || 0);
  return {
    stalled: !progressedInWindow,
    budget,
    elapsed,
    lastVerifiedAt: r.lastVerifiedAt,
    phaseStartedAt: r.phaseStartedAt,
  };
}

// ---------------------------------------------------------------------------
// Verified-progress detection (mission §6) — real machine signals.
// ---------------------------------------------------------------------------

// Given a repo accessor (injected for testability), detect whether real progress
// happened since lastObservedHead: either HEAD moved (a commit was created) or an
// owned file changed on disk (accessor.ownedChanged). Returns
// { verified, step, head, reason }.
export function detectVerifiedProgress(r, accessor, opts = {}) {
  const nextHead = accessor.head();
  if (nextHead && r.headCurrent && nextHead !== r.headCurrent) {
    return { verified: true, step: 'git:commit', head: nextHead, reason: 'HEAD_MOVED' };
  }
  const owned = opts.ownedFiles || [];
  if (owned.length > 0 && typeof accessor.ownedChanged === 'function') {
    if (accessor.ownedChanged(owned)) {
      return { verified: true, step: 'fs:owned', head: nextHead || r.headCurrent, reason: 'FS_CHANGED' };
    }
  }
  return { verified: false, step: null, head: nextHead || r.headCurrent, reason: 'NO_PROGRESS' };
}

// ---------------------------------------------------------------------------
// Heartbeat model (mission §16)
// ---------------------------------------------------------------------------

export function buildHeartbeat(r, opts = {}) {
  return {
    cycle: r.cycle,
    taskId: r.taskId,
    taskState: r.taskState,
    phase: r.phase,
    opencodePid: r.opencodePid,
    lastVerifiedStep: r.lastVerifiedStep,
    lastVerifiedAt: r.lastVerifiedAt,
    recoveryCount: r.recoveryCount,
    loopCount: r.loopCount,
    crashLoopStreak: r.crashLoopStreak,
    safeMode: r.safeMode,
    launcherAlive: !!opts.launcherAlive,
    headStart: r.headStart,
    headCurrent: r.headCurrent,
    updatedSeq: r.updatedSeq,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function writeRuntime(r, filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  const payload = JSON.stringify(sortKeys(r), null, 2) + '\n';
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, filePath);
  return payload;
}

export function readRuntime(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export default {
  PHASES,
  PHASE_TIMEOUTS_MS,
  RETRY_BUDGET,
  BACKOFF_MINUTES,
  EMPTY_RUNTIME,
  newRuntime,
  setPhase,
  setOutcome,
  recordVerifiedRuntime,
  failureFingerprint,
  onFailure,
  onSuccess,
  backoffMinutes,
  evaluateSafeMode,
  isPhaseStalled,
  detectVerifiedProgress,
  buildHeartbeat,
  writeRuntime,
  readRuntime,
};
