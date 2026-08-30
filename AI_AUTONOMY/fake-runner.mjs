// AI_AUTONOMY/fake-runner.mjs — Simulates the LONG-LIVED launcher process that
// holds the single-instance lock for the duration of a real cycle. Unlike the
// transient `cli acquire-lock` invocation, this process stays alive, so its PID
// is a valid non-stale lock owner. Used by CE-068 case G to prove the duplicate
// runner is blocked while the real owner is still running.
//
// Usage: node fake-runner.mjs <token> <dirToHold>
//   - acquires the lock with `token`
//   - writes "HELD <token>" to stdout
//   - stays alive until killed (or a Ctrl-C)
//   - releases the lock on SIGTERM/exit

import { acquireLock, releaseLock } from './lock.mjs';
import { join } from 'path';

const token = process.argv[2] || 'FAKE_RUNNER';
const dirToHold = process.argv[3] || process.cwd();
const lockFile = join(dirToHold, 'AI_AUTONOMY', 'runner.lock');

const r = acquireLock(lockFile, { root: dirToHold, token });
if (!r.ok) {
  console.error('LOCK_CONFLICT ' + JSON.stringify(r));
  process.exit(1);
}
console.log('HELD ' + token);

function cleanup() {
  try { releaseLock(lockFile, token); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// stay alive
setInterval(() => {}, 1000);
