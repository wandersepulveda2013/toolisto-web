// AI_AUTONOMY/runner.js — Supervision layer for an autonomous OpenCode cycle.
//
// WHAT IT SOLVES (the "let me read the QUEUE" loop + crash loss):
//   1. VERIFIED PROGRESS: every real tool/side-effect writes a checkpoint + event
//      (state.json / events.jsonl). Narration alone never writes state.
//   2. NARRATION-LOOP DETECTION: the runner watches the child's stdout, feeds each
//      line to the pure guard engine, and interleaves verified markers for real
//      tool calls. When the guard flags a loop (the agent keeps SAYING it will act
//      without a verified event), the runner interrupts the child, changes tactic,
//      and finally FAILS the cycle cleanly instead of spinning.
//   3. CRASH RECOVERY (checkpoint ladder): on (re)start, restoreBreakpoint decides
//      whether to start fresh, resume a mid-RUNNING cycle, complete only trackers,
//      or enter RECOVERY after a FAILED cycle.
//   4. OWNERSHIP GUARD: the runner declares owned files and refuses to commit
//      out-of-scope/blocked files, so a cycle never stages foreign work.
//
// The orchestration is split from process spawning so the tests can run the whole
// decision logic in-process without launching real opencode.

import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import * as state from './state.mjs';
import * as guard from './guard.mjs';
import * as commitGuard from './commit-guard.mjs';
import {
  acquireLock,
  releaseLock,
  isLockStale,
  readLock,
} from './lock.mjs';

export const DIRECTORY = 'AI_AUTONOMY';
export const DEFAULT_FILES = Object.freeze({
  state: 'state.json',
  events: 'events.jsonl',
  lock: 'runner.lock',
  queue: 'queue.json',
});

// ---------------------------------------------------------------------------
// 1) Orchestrator (pure decision engine; no child processes).
// ---------------------------------------------------------------------------

export function createOrchestrator(opts = {}) {
  const {
    seq = 0, // monotonic sequence (incremented by caller per verified step)
    loop = guard.createLoopDetector(opts.loopLimits),
    stateRef = null,
  } = opts;

  return {
    onNarration(text) {
      loop.onNarration(text);
      return loop.summary();
    },
    onVerified(step, headCurrent, commit = null, _seq = seq) {
      loop.onVerified(step);
      const s = state.recordVerified(
        stateRef || state.EMPTY_STATE(),
        _seq,
        step,
        headCurrent,
        commit,
      );
      return { summary: loop.summary(), state: s };
    },
    isLooping() {
      return loop.summary().loopTriggered;
    },
    loopReason() {
      return loop.summary().loopReason;
    },
    summary() {
      return loop.summary();
    },
  };
}

// Decide what to do for the upcoming cycle given a persisted checkpoint.
export function planCycle(checkpoint, opts = {}) {
  const bp = state.restoreBreakpoint(checkpoint);
  switch (bp) {
    case 'continue':
      return {
        action: 'RESUME',
        taskId: checkpoint.taskId,
        cycle: checkpoint.cycle,
        reason: 'mid-cycle RUNNING; resume same task, keep intent+verified counters',
      };
    case 'complete_trackers':
      return {
        action: 'COMPLETE_TRACKERS',
        taskId: checkpoint.taskId,
        cycle: checkpoint.cycle,
        reason: 'implementation committed (IMPLEMENTED/TRACKERS); finish status/queue, do not re-implement',
      };
    case 'blocked_recover':
      return {
        action: 'RECOVERY',
        taskId: checkpoint.taskId,
        cycle: checkpoint.cycle == null ? 1 : checkpoint.cycle + 1,
        reason: 'previous cycle FAILED; enter RECOVERY with a different technique',
      };
    case 'completed':
      return {
        action: 'FRESH',
        taskId: null,
        cycle: (checkpoint.cycle || 0) + 1,
        reason: 'previous cycle finished; start a new one',
      };
    default:
      return { action: 'FRESH', taskId: null, cycle: 1, reason: 'no persisted state' };
  }
}

// The full loop-guard plus recovery decision used by the supervisor: given what
// the child produced and what was verified, return {ok, interrupt, reason}.
export function evaluateCycleOutput(orchestrator, checkpoint) {
  const s = orchestrator.summary();
  if (s.loopTriggered) {
    return {
      ok: false,
      interrupt: true,
      reason: `NARRATION_LOOP(${s.loopReason}): ${s.intents} intents vs ${s.verified} verified`,
    };
  }
  if (s.verified === 0) {
    return {
      ok: false,
      interrupt: true,
      reason: 'NO_VERIFIED_PROGRESS: narration without execution',
    };
  }
  return { ok: true, interrupt: false, reason: 'OK' };
}

// ---------------------------------------------------------------------------
// 2) File helpers for the persistent store (paths, ensure dir).
// ---------------------------------------------------------------------------

export function resolvePaths(root, files = DEFAULT_FILES) {
  const dir = join(root, DIRECTORY);
  return {
    dir,
    state: join(dir, files.state),
    events: join(dir, files.events),
    lock: join(dir, files.lock),
    queue: join(dir, files.queue),
  };
}

export function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true });
}

// ---------------------------------------------------------------------------
// 3) Supervisor: real process wiring. Prefabricated so tests can drive it
//    without real network/opencode by injecting a fake "spawn".
// ---------------------------------------------------------------------------

export function createSupervisor(opts) {
  const {
    root,
    paths = resolvePaths(root),
    spawnChild, // (cmd, args, {onLine, onClose}) => { pid }
    onEvent = () => {},
    ownedFiles = [],
    headNow = () => null,
  } = opts;

  const lockFile = paths.lock;
  const stateFile = paths.state;
  const eventsFile = paths.events;

  function loadOrInit(taskId, headStart) {
    const ck = state.readCheckpoint(stateFile);
    if (ck) return ck;
    return null;
  }

  // Returns { started, checkpoint, reason } — does not spawn; just prepares.
  function prepare(cycle, taskId, headStart) {
    ensureDir(stateFile);
    const ck = state.readCheckpoint(stateFile);
    return planCycle(ck, { cycle, taskId });
  }

  // Persist a verified event: write checkpoint + append event atomically.
  function verify(step, headCurrent, seq, commit = null, taskId) {
    const prev = state.readCheckpoint(stateFile) || state.EMPTY_STATE();
    let next = prev;
    // If this is an entirely new cycle, seed it first.
    if (prev.cycle == null || prev.finished) {
      next = state.newCycle(seq, prev.cycle == null ? 1 : prev.cycle + 1, taskId, headCurrent);
    }
    next = state.recordVerified(next, seq, step, headCurrent, commit);
    state.writeCheckpoint(next, stateFile);
    state.appendEvent(eventsFile, {
      kind: 'verified',
      seq,
      taskId: taskId ?? next.taskId,
      step,
      head: headCurrent,
      commit,
      verifiedAt: next.verifiedCount,
    });
    onEvent({ kind: 'verified', step, seq });
    return next;
  }

  function recordIntentLine(text) {
    state.appendEvent(eventsFile, { kind: 'intent', text: guard.normalizeNarration(text) });
    onEvent({ kind: 'intent', text });
  }

  // Safe-commit: verify staged files against ownership before running git commit.
  function safeCommit({ commitMsg, files }, statusLines) {
    const check = commitGuard.checkOwnedFiles(statusLines, files);
    if (!check.ok) {
      return { ok: false, reason: check.reason, check };
    }
    return { ok: true, reason: 'CLEAN', check };
  }

  function finish(result, taskId) {
    const prev = state.readCheckpoint(stateFile) || state.EMPTY_STATE();
    let next = { ...prev };
    let seq = prev.updatedSeq || 0;
    // Reach FINISHED through the legal path (IMPLEMENTED -> TRACKERS -> FINISHED).
    if (next.taskState === 'IMPLEMENTED') {
      seq += 1;
      next = state.advanceTaskState(next, seq, 'TRACKERS');
    }
    seq += 1;
    next = state.advanceTaskState(next, seq, 'FINISHED');
    next = { ...next, result, finished: true, updatedSeq: seq };
    state.writeCheckpoint(next, stateFile);
    state.appendEvent(eventsFile, { kind: 'cycle_finished', taskId: taskId ?? next.taskId, result });
    onEvent({ kind: 'cycle_finished', result });
    return next;
  }

  function fail(reason, taskId) {
    const prev = state.readCheckpoint(stateFile) || state.EMPTY_STATE();
    let next = state.advanceTaskState(prev, (prev.updatedSeq || 0) + 1, 'FAILED');
    next = { ...next, failReason: reason };
    state.writeCheckpoint(next, stateFile);
    state.appendEvent(eventsFile, { kind: 'cycle_failed', taskId: taskId ?? next.taskId, reason });
    onEvent({ kind: 'cycle_failed', reason });
    return next;
  }

  return {
    paths,
    prepare,
    verify,
    recordIntentLine,
    safeCommit,
    finish,
    fail,
    acquire: () => acquireLock(lockFile, { root }),
    release: (token) => releaseLock(lockFile, token),
    lockStatus: () => isLockStale(lockFile),
  };
}

export default {
  DIRECTORY,
  DEFAULT_FILES,
  createOrchestrator,
  planCycle,
  evaluateCycleOutput,
  resolvePaths,
  ensureDir,
  createSupervisor,
};
