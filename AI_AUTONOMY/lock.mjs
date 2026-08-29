// AI_AUTONOMY/lock.js — PID+timestamp single-instance lock with stale detection.
//
// The previous launcher used a Windows Mutex object, which disappears when the
// owning process dies — good against orphans, but it also meant the LOCK gave
// no durable signal to an external watchdog/STATUS script beyond a best-effort
// file write. Here we keep a PID-verified lock FILE:
//   { pid, token, startedAt, root }
// and define "stale" as "lock file exists but PID is not a live process".
// A second runner refuses to start while the lock is held by a live PID.
//
// Pure Node; no deps. Functions are pure/unit-testable (fs is injected so the
// tests can use a temp dir and can simulate "PID not alive").

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { dirname } from 'path';

export function acquireLock(lockFile, meta = {}) {
  const existing = readLock(lockFile);
  if (existing && processAlive(existing.pid)) {
    return { ok: false, reason: 'ALREADY_RUNNING', owner: existing };
  }
  const record = {
    pid: process.pid,
    startedAt: monotonicNow(),
    root: String(meta.root || ''),
    token: String(meta.token || ''),
  };
  writeFileSync(lockFile, JSON.stringify(record, null, 2) + '\n');
  return { ok: true, owner: record };
}

export function releaseLock(lockFile, token) {
  const existing = readLock(lockFile);
  if (existing && token != null && existing.token && existing.token !== token) {
    return { ok: false, reason: 'NOT_OWNER' };
  }
  try {
    unlinkSync(lockFile);
  } catch {
    // already gone
  }
  return { ok: true };
}

export function readLock(lockFile) {
  if (!existsSync(lockFile)) return null;
  try {
    const o = JSON.parse(readFileSync(lockFile, 'utf8'));
    return o && typeof o.pid === 'number' ? o : null;
  } catch {
    return null;
  }
}

export function isLockStale(lockFile) {
  const lock = readLock(lockFile);
  if (!lock) return { stale: false, lock: null };
  return { stale: !processAlive(lock.pid), lock };
}

export function processAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM'; // exists but not ours to signal
  }
}

// A stable, testable "now" (ms since module load) — avoids absolute timestamps
// in machine state, keeping evidence/state deterministic across a run.
let _t0 = Date.now();
export function monotonicNow() {
  return Date.now() - _t0;
}

export default {
  acquireLock,
  releaseLock,
  readLock,
  isLockStale,
  processAlive,
  monotonicNow,
};
