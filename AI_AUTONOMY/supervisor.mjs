// AI_AUTONOMY/supervisor.mjs — Runs ONE supervised child process (OpenCode or a
// fake) to a verdict, governing it with the CE-067/CE-068 runtime: verified-
// progress detection, narration-loop guard, phase-stall detection, process-tree
// termination on interrupt/crash, and clean-success detection.
//
// This is the "body" CE-068 wires to the "brain". It is process-independent and
// testable: tests pass a FAKE child (a node script that prints narration, makes
// commits, loops, crashes, or exits cleanly) so the whole launcher/runtime
// contract is certified without live OpenCode or network.
//
// Verified progress comes from REAL signals (HEAD moved, owned file changed) —
// NEVER from stdout text alone. Narration is only fed to the loop guard.

import { spawn, execFileSync } from 'child_process';
import * as guard from './guard.mjs';
import * as runtime from './runtime.mjs';

const POLL_INTERVAL_MS = 1000;
const STDOUT_FLUSH_MS = 300;

// Kill the whole process tree rooted at `pid` (Windows-safe via taskkill /T /F).
export function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

function gitHead(root, gitCmd = 'git') {
  try {
    const out = execFileSync(gitCmd, ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    return (out || '').trim() || null;
  } catch {
    return null;
  }
}

// Build a repo accessor. HEAD movement is the primary real-progress signal;
// ownedChanged is offered for fs-based tests.
export function makeRepoAccessor({ root, gitCmd = 'git', ownedFiles = [] } = {}) {
  return {
    head: () => gitHead(root, gitCmd),
    ownedChanged: (paths) => false,
  };
}

// Run one supervised child to a verdict.
// opts:
//   root, cmd, args, ownedFiles, gitAccessor, loopLimits,
//   phaseTimeoutMs (override), pollIntervalMs, onLine, onLoop
// Returns Promise<verdict> with { outcome, reason, exitCode, signal,
// headFrom, headTo, stats, interrupt }.
export function superviseChild(r, opts) {
  return new Promise((resolve) => {
    const {
      root,
      cmd,
      args = [],
      ownedFiles = [],
      gitAccessor,
      onLine = () => {},
      onLoop = () => {},
      phase = 'IMPLEMENTING',
    } = opts;
    const phaseTimeoutMs = opts.phaseTimeoutMs || 5 * 60 * 1000;
    const pollInterval = opts.pollIntervalMs || POLL_INTERVAL_MS;
    const detector = guard.createLoopDetector(opts.loopLimits);
    const acc = gitAccessor || makeRepoAccessor({ root, ownedFiles });
    const headFrom = acc.head();

    const stats = { intents: 0, verified: 0, loopReason: null, phase };
    let verifiedHead = headFrom;
    let lastVerifiedAtRun = 0;
    let settled = false;
    const startWall = Date.now();
    let allStdout = '';
    let childPid = null;
    let childExitCode = null;
    let childSignal = null;

    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      resolve({ ...verdict, headFrom, stats, interrupt: verdict.outcome !== 'SUCCESS' });
    };

    const failOutcome = (outcome, reason) => {
      if (settled) return;
      const myPid = childPid;
      killTree(myPid).then(() => {
        finish({
          outcome,
          reason,
          exitCode: childExitCode,
          signal: childSignal,
          headTo: acc.head(),
        });
        onLoop({ outcome, reason });
      });
    };

    const touchVerified = (head) => {
      lastVerifiedAtRun += 1;
      stats.verified += 1;
      verifiedHead = head || verifiedHead;
    };

    // Spawn the child.
    let child;
    try {
      child = spawn(cmd, args, { cwd: root, windowsHide: true, shell: false });
    } catch (e) {
      finish({
        outcome: 'CONFIG_ERROR',
        reason: 'spawn failed: ' + e.message,
        exitCode: -1,
        signal: null,
        headTo: acc.head(),
      });
      return;
    }
    childPid = child.pid;

    // Capture stdout (narration) for the loop guard; buffer for result marker.
    child.stdout && child.stdout.setEncoding('utf8');
    child.stdout && child.stdout.on('data', (d) => {
      allStdout += String(d);
      const lines = String(d).split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        onLine(t);
        detector.onNarration(t);
      }
    });
    child.stderr && child.stderr.resume();

    // Timer: real verified progress + phase stall.
    const verifiedTimer = setInterval(() => {
      const det = runtime.detectVerifiedProgress(r, acc, { ownedFiles });
      if (det.verified) {
        touchVerified(det.head);
        r = runtime.recordVerifiedRuntime(r, (r.updatedSeq || 0) + 1, det.step, det.head);
      }
      // Loop check.
      const s = detector.summary();
      if (s.loopTriggered) {
        stats.loopReason = s.loopReason;
        return failOutcome('LOOP_INTERRUPTED', `NARRATION_LOOP(${s.loopReason})`);
      }
      // Phase stall: budget exceeded with no verified progress.
      const elapsed = Date.now() - startWall;
      if (elapsed > phaseTimeoutMs && lastVerifiedAtRun === 0) {
        return failOutcome('TIMEOUT', 'phase budget exceeded with no verified progress');
      }
    }, pollInterval);

    child.on('error', (err) => {
      clearInterval(verifiedTimer);
      finish({
        outcome: 'CONFIG_ERROR',
        reason: 'process error: ' + err.message,
        exitCode: -1,
        signal: null,
        headTo: acc.head(),
      });
    });

    child.on('close', (code, signal) => {
      childExitCode = code;
      childSignal = signal;
      clearInterval(verifiedTimer);
      // brief flush so trailing stdout is captured before verdict
      setTimeout(() => {
        if (settled) return;
        const headTo = acc.head();
        if (code === 0) {
          const m = allStdout.match(/RESULTADO_CICLO\s*[:=]\s*([A-Z_]+)/);
          finish({
            outcome: 'SUCCESS',
            reason: m ? m[1] : 'clean exit',
            exitCode: 0,
            signal: null,
            headTo,
          });
        } else {
          failOutcome('CRASH', `exit code ${code}`);
        }
      }, STDOUT_FLUSH_MS);
    });
  });
}

// Local helpers.

export default { killTree, makeRepoAccessor, superviseChild };
