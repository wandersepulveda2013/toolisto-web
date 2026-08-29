// AI_AUTONOMY/commit-guard.js — Ownership guard + safe commit for the autonomous
// runner.
//
// Root problem this addresses: an autonomous agent can stage/commit files it does
// not own, silently mixing "foreign" (human/APLUNO/other-work) changes into a
// cycle commit — a real incident class in this repo. The guard makes ownership
// EXPLICIT and machine-enforced:
//   - The runner declares a cycle's owned files (files it intends to modify).
//   - `checkOwnedFiles` rejects a commit that would include any file NOT in the
//     ownership set, and rejects the dangerous `git add .` / `-A` forms outright.
//   - Known foreign roots are hard-blocked regardless of the ownership set.
//
// Pure Node; fs/path injected for testability.

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Paths that must never be staged by the autonomous runner (human/APLUNO work,
// secrets, private workspace internals that belong to the owner).
const HARD_BLOCKED = Object.freeze([
  'ACTIVE-MISSION.md',
  'AUTONOMOUS_STOP',
  'opencode.json',
  'src/apluno/',
  'src/data/guides.json',
  'scripts/generate-apluno-pages.mjs',
  'artifacts/adsense-readiness/',
  'artifacts/phase3c-validation/',
  'artifacts/adsense-content-remediation/',
]);

export function normalizePath(p) {
  // forward slashes, strip leading ./, collapse //
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function isHardBlocked(p) {
  const n = normalizePath(p);
  return HARD_BLOCKED.some((b) => {
    const bn = normalizePath(b);
    if (bn.endsWith('/')) return n === bn.slice(0, -1) || n.startsWith(bn);
    return n === bn;
  });
}

// Normalize a set of owned files (the cycle's declared intent) into stable form.
export function normalizeOwned(files) {
  const out = new Set();
  for (const f of files || []) {
    if (typeof f !== 'string' || !f.trim()) continue;
    const n = normalizePath(f.trim());
    if (n) out.add(n);
  }
  return out;
}

// Given git status output lines ("M path" etc.) plus the ownership set, return:
//   { ok, inScope: [paths], outOfScope: [paths], blocked: [paths], reason }
// A path is in-scope iff it is owned AND not hard-blocked.
export function checkOwnedFiles(statusLines, ownedFiles) {
  const owned = normalizeOwned(ownedFiles);
  const status = Array.isArray(statusLines) ? statusLines : String(statusLines);
  const inScope = [];
  const outOfScope = [];
  const blocked = [];

  const lines = typeof status === 'string' ? status.split(/\n/) : status;
  for (const line of lines) {
    const trimmed = (line || '').trim();
    if (!trimmed) continue;
    // git status short: 'XY path'
    const parts = trimmed.split(/\s+/);
    let path = parts[parts.length - 1];
    if (!path || path.startsWith('"')) continue;
    path = normalizePath(path);
    if (isHardBlocked(path)) {
      blocked.push(path);
      continue;
    }
    if (owned.has(path)) inScope.push(path);
    else outOfScope.push(path);
  }
  const ok = outOfScope.length === 0 && blocked.length === 0;
  return {
    ok,
    inScope,
    outOfScope,
    blocked,
    reason: ok
      ? 'ALL_IN_SCOPE'
      : outOfScope.length > 0 && blocked.length === 0
        ? 'OUT_OF_SCOPE_FILES'
        : blocked.length > 0
          ? 'HARD_BLOCKED_FILES'
          : 'OUT_OF_SCOPE',
  };
}

// Safety: reject dangerous stage-all forms in a proposed `git add` command.
export function isDangerousStage(commandLine) {
  const c = String(commandLine || '').toLowerCase();
  const tokens = c.split(/\s+/);
  return (
    tokens.includes('.') ||
    tokens.includes('-a') ||
    tokens.includes('--all') ||
    tokens.includes('-a') ||
    /\bgit add -A\b/.test(c) ||
    /\bgit add -all\b/.test(c)
  );
}

export default {
  HARD_BLOCKED,
  normalizePath,
  isHardBlocked,
  normalizeOwned,
  checkOwnedFiles,
  isDangerousStage,
};
