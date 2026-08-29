// AI_AUTONOMY/state.js — Persistent per-cycle checkpoint + event log for the
// autonomous OpenCode orchestrator.
//
// Goal: make "execution" machine-observable and crash-recoverable. The launcher
// and watchdog consume ONLY this structured state (never narration text) to
// decide whether a cycle is making verified progress, is narrating-in-a-loop,
// is frozen, or crashed mid-cycle. On (re)start the runner uses the checkpoint
// ladder to RESUME/complete a partial cycle instead of blindly re-running it.
//
// Conventions:
//   - Pure Node (no deps), deterministic, all transitions pure.
//   - A "verified event" is one written by an actual side effect (tool call that
//     produced a real change) — NOT the model narrating "I will do X".
//   - State is written atomically (temp + rename) so a crash never leaves a
//     truncated checkpoint.

import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

const EMPTY_STATE = () => ({
  schema: 1,
  cycle: null,
  taskId: null,
  taskState: null, // see TASK_STATES
  headStart: null,
  headCurrent: null,
  lastVerifiedAt: null, // monotonic counter (not wall clock) of verified events
  verifiedSteps: [], // ring of last N verified step markers
  intentCount: 0,
  verifiedCount: 0,
  loopStrikes: 0,
  loopTriggered: false,
  loopReason: null,
  commitHash: null,
  trackersUpdated: false,
  result: null,
  finished: false,
  updatedSeq: 0,
});

// Task lifecycle is a strict DAG; each transition is validated against this.
export const TASK_STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  IMPLEMENTED: 'IMPLEMENTED', // implementation committed
  TRACKERS: 'TRACKERS', // implementation done, trackers remaining
  FINISHED: 'FINISHED',
  RECOVERED: 'RECOVERED',
  FAILED: 'FAILED', // loop exhaustion / infra failure
});

// Allowed transitions for a task id (state machine). LOOP/RECOVER are soft flags
// rather than exclusive states so the cycle can still be recovered.
const ALLOWED = Object.freeze({
  PENDING: new Set(['RUNNING', 'FAILED']),
  RUNNING: new Set(['RUNNING', 'IMPLEMENTED', 'FAILED']),
  IMPLEMENTED: new Set(['TRACKERS', 'FAILED']),
  TRACKERS: new Set(['FINISHED', 'FAILED']),
  FINISHED: new Set([]),
  RECOVERED: new Set([]),
  FAILED: new Set([]),
});

export function allowedFrom(state) {
  return new Set(ALLOWED[state] || []);
}

export function canTransition(from, to) {
  if (from === to) return true;
  return !!(ALLOWED[from] && ALLOWED[from].has(to));
}

// ring buffer of verified step markers (bounded, so state file stays tiny)
export const RING_SIZE = 32;
const MARKER = /^[A-Za-z0-9_.\/:-]{1,64}$/;

export function pushVerifiedStep(step, state) {
  if (typeof step !== 'string' || !MARKER.test(step)) {
    throw new Error('invalid verified step marker: ' + String(step));
  }
  const next = [...(state.verifiedSteps || [])];
  next.push(step);
  if (next.length > RING_SIZE) next.shift();
  return next;
}

// Compute the breakpoint at which a cycle restores from. Returns one of:
//   'fresh'          - nothing persisted, or previous cycle finished; start new.
//   'continue'       - mid-cycle RUNNING; resume (keep same taskId).
//   'complete_trackers' - implementation committed but trackers/status not yet
//                         updated; only finish those, do not re-implement.
//   'completed'      - cycle fully finished (finished === true).
//   'blocked_recover'- previous was FAILED; a RECOVERY cycle is warranted.
export function restoreBreakpoint(state) {
  if (!state || state.cycle == null) return 'fresh';
  if (state.finished) return 'completed';
  if (state.taskState === 'TRACKERS') return 'complete_trackers';
  if (state.taskState === 'IMPLEMENTED') return 'complete_trackers';
  if (state.taskState === 'FAILED') return 'blocked_recover';
  if (state.taskState === 'RUNNING') return 'continue';
  return 'fresh';
}

// Pure transition helpers. Each returns a NEW state object (immutability lets
// the tests assert exact diffs and lets us roll back on crash).

export function newCycle(seq, cycle, taskId, headStart, state = EMPTY_STATE()) {
  if (seq < 1) throw new Error('seq must be >= 1');
  const s = EMPTY_STATE();
  s.updatedSeq = seq;
  s.cycle = cycle;
  s.taskId = taskId || null;
  s.taskState = 'RUNNING';
  s.headStart = headStart || null;
  s.headCurrent = headStart || null;
  s.lastVerifiedAt = 0;
  s.verifiedSteps = [];
  s.intentCount = 0;
  s.verifiedCount = 0;
  return s;
}

export function recordIntent(state, seq) {
  const next = { ...state, intentCount: (state.intentCount || 0) + 1, updatedSeq: seq };
  return next;
}

export function recordVerified(state, seq, step, headCurrent, commit = null) {
  const nv = state.verifiedCount || 0;
  const next = {
    ...state,
    updatedSeq: seq,
    verifiedCount: nv + 1,
    lastVerifiedAt: (state.lastVerifiedAt || 0) + 1,
    verifiedSteps: pushVerifiedStep(step, state),
    headCurrent: headCurrent || state.headCurrent,
  };
  if (commit) next.commitHash = commit;
  return next;
}

// Advance taskState; throws on an illegal transition.
export function advanceTaskState(state, seq, nextState) {
  if (!canTransition(state.taskState, nextState)) {
    throw new Error(
      `illegal transition ${state.taskState} -> ${nextState} for task ${state.taskId}`,
    );
  }
  return { ...state, taskState: nextState, updatedSeq: seq };
}

// Persist a checkpoint atomically.
export function writeCheckpoint(state, filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  const payload = JSON.stringify(sortKeys(state), null, 2) + '\n';
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, filePath);
  return payload;
}

export function readCheckpoint(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Deterministic stable ordering of keys (evidence/convention friendly).
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// Append an event to the append-only JSONL log (structural, not narration).
export function appendEvent(filePath, event) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(sortKeys(event)) + '\n', { flag: 'a' });
}

// Read all events from the log; tolerant of a trailing partial line (crash).
export function readEvents(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // partial trailing line from a crash: ignore
    }
  }
  return out;
}

export { EMPTY_STATE };
export default {
  EMPTY_STATE,
  TASK_STATES,
  allowedFrom,
  canTransition,
  pushVerifiedStep,
  restoreBreakpoint,
  newCycle,
  recordIntent,
  recordVerified,
  advanceTaskState,
  writeCheckpoint,
  readCheckpoint,
  appendEvent,
  readEvents,
  RING_SIZE,
};
