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

// Force-kill the whole process tree rooted at `pid` (Windows-safe via taskkill /T /F).
// This is the HARD path, used only after a graceful interrupt fails to stop the
// child within the grace period (mission §10: graceful first, then process tree).
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

// CE-069: graceful interrupt FIRST. On node, `child.kill()` sends a terminate
// signal to the child tree root and exits cooperatively. On Windows the direct
// kill only stops the ROOT process, so we ALWAYS follow with a process-tree kill
// (taskkill /T /F, idempotent on dead PIDs) after the grace period to guarantee
// NO orphan survives (§9, §10). Resolves true if the root exited gracefully,
// false if the tree needed a hard force-kill after the grace wait.
export function terminateTree(child, pid, { graceMs = 5000, onGraceful = () => {}, onHard = () => {} } = {}) {
  return new Promise((resolve) => {
    if (!child || !pid) { resolve(true); return; }
    let rootExited = false;
    const mark = () => { rootExited = true; };
    child.once('exit', mark);
    let childHandle = null;
    try { childHandle = child.kill(); } catch { childHandle = false; }
    onGraceful({ pid, signalSent: childHandle });
    setTimeout(() => {
      // Grace period elapsed. Always force-clean the whole tree (children and
      // grandchildren can outlive the root on Windows). killTree is harmless if
      // the root is already dead, and /T /F guarantees descendants are gone.
      onHard({ pid });
      killTree(pid)
        .then(() => resolve(rootExited))
        .catch(() => resolve(rootExited));
    }, graceMs);
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
      onLive = () => {},
      phase = 'IMPLEMENTING',
    } = opts;
    const phaseTimeoutMs = opts.phaseTimeoutMs || 5 * 60 * 1000;
    const gracefulMs = opts.gracefulMs != null ? opts.gracefulMs : 5000;
    const pollInterval = opts.pollIntervalMs || POLL_INTERVAL_MS;
    const detector = guard.createLoopDetector(opts.loopLimits);
    const acc = gitAccessor || makeRepoAccessor({ root, ownedFiles });
    const headFrom = acc.head();

    const stats = { intents: 0, verified: 0, loopReason: null, phase, classification: null, narrations: 0, stalled: false };
    let verifiedHead = headFrom;
    let lastVerifiedAtRun = 0;
    let lastNarrationAtRun = 0;
    let settled = false;
    // Set when we deliberately interrupt a LIVE process (loop/stall). While true,
    // the close/error handlers must NOT classify the outcome (booted child death
    // would otherwise race and mislabel it CRASH); terminateTree's finish decides.
    let interrupting = false;
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

    // Live snapshot callback (used by the CLI to refresh heartbeat during run).
    const emitLive = (classification, extra = {}) => {
      const s = detector.summary();
      onLive({
        rootPid: childPid,
        phase,
        classification,
        lastNarrationAt: lastNarrationAtRun,
        lastVerifiedAt: lastVerifiedAtRun,
        intents: s.intents,
        verified: s.verified,
        verifiedHead,
        ...extra,
      });
    };

    // Graceful first, then hard process-tree kill (§10). The checkpoint is
    // persisted by the caller (cli.mjs) before/after this; here we only stop the
    // child tree and report the result so no orphan survives.
    const failOutcome = (outcome, reason, opts2 = {}) => {
      if (settled) return;
      stats.classification = opts2.classification || null;
      const myPid = childPid;
      const verdictBase = {
        outcome,
        reason,
        exitCode: childExitCode,
        signal: childSignal,
        headTo: acc.head(),
      };
      // If the child already exited (CRASH path), there is no tree to terminate —
      // finish immediately without a gratuitous grace wait. Otherwise use the
      // graceful-first-then-hard sequence for a LIVE process (§10).
      if (opts2.alreadyExited) {
        finish({ ...verdictBase, treeCleaned: true });
        onLoop({ outcome, reason, treeCleaned: true });
        return;
      }
      interrupting = true;
      terminateTree(child, myPid, {
        graceMs: gracefulMs,
        onGraceful: (g) => emitLive('GRACEFUL_INTERRUPT', { intro: g }),
        onHard: () => { emitLive('HARD_KILL'); },
      }).then((clean) => {
        finish({ ...verdictBase, treeCleaned: clean });
        onLoop({ outcome, reason, treeCleaned: clean });
      }).catch(() => {
        finish({ ...verdictBase, treeCleaned: false });
        onLoop({ outcome, reason, treeCleaned: false });
      });
    };

    const touchVerified = (head) => {
      lastVerifiedAtRun += 1;
      stats.verified += 1;
      verifiedHead = head || verifiedHead;
      emitLive('VERIFIED_PROGRESS');
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
        lastNarrationAtRun += 1;
        stats.narrations += 1;
        onLine(t);
        detector.onNarration(t);
      }
      emitLive('NARRATION_ACTIVITY');
    });
    child.stderr && child.stderr.setEncoding('utf8');
    child.stderr && child.stderr.on('data', (d) => {
      const lines = String(d).split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        onLine(t, true);
      }
    });

    // Timer: real verified progress + live classification (loop vs stall).
    const verifiedTimer = setInterval(() => {
      const det = runtime.detectVerifiedProgress(r, acc, { ownedFiles });
      if (det.verified) {
        touchVerified(det.head);
        r = runtime.recordVerifiedRuntime(r, (r.updatedSeq || 0) + 1, det.step, det.head);
      }
      // Loop check (narration loop = repetitive narration, no action).
      const s = detector.summary();
      if (s.loopTriggered) {
        stats.loopReason = s.loopReason;
        stats.intents = s.intents;
        return failOutcome('LOOP_INTERRUPTED', `NARRATION_LOOP(${s.loopReason})`, { classification: 'NARRATION_LOOP' });
      }
      const elapsed = Date.now() - startWall;
      // STALL: conservative phase budget exceeded with ZERO verified progress.
      // Any of silent, chatting (non-intent), or plan-never-act qualifies. Legit
      // long work (test/build/install/OCR) always produces a verified signal
      // (HEAD move / owned change) well within the budget, so it is NOT flagged
      // here (§7, §8). NARRATION_LOOP is already handled above by the guard.
      if (elapsed > phaseTimeoutMs && lastVerifiedAtRun === 0) {
        stats.classification = 'STALL';
        return failOutcome(
          'STALL',
          `phase budget exceeded (${Math.round(elapsed / 1000)}s) with ${s.intents} intents and 0 verified`,
          { classification: 'STALL' }
        );
      }
    }, pollInterval);

    child.on('error', (err) => {
      clearInterval(verifiedTimer);
      if (interrupting || settled) return; // deliberate interrupt in progress; terminateTree decides
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
        if (settled || interrupting) return; // deliberate interrupt in progress; terminateTree decides
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
          failOutcome('CRASH', `exit code ${code}`, { alreadyExited: true, classification: 'CRASH' });
        }
      }, STDOUT_FLUSH_MS);
    });
  });
}

// Local helpers.

export default { killTree, terminateTree, makeRepoAccessor, superviseChild };
