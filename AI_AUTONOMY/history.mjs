// AI_AUTONOMY/history.mjs — Evidence-driven autonomous optimization (CE-070).
//
// Until CE-069 the system could DETECT -> INTERRUPT -> PRESERVE -> RECOVER ->
// CONTINUE. This module lets it ALSO learn from its OWN operational history:
// a machine-readable cycle model (history.jsonl), deterministic outcome/value
// classification, evidence-aware task scoring with explainable selection,
// historical penalties (task vs environment failure), recovery-strategy
// analysis, robust timeout recommendations (never from few samples), prompt
// bloat detection, LOW_VALUE_ACTIVITY detection, policy versioning/rollback,
// and productivity metrics.
//
// Principles (mission §36):
//   DETERMINISTIC — pure functions, stable key order, no randomness.
//   EXPLAINABLE   — every decision carries a list of components/reasons.
//   BOUNDED       — timeout/score adjustments respect hard safety bounds.
//   REVERSIBLE    — policy changes are versioned and can be rolled back.
//   EVIDENCE-BASED— never auto-adjust with insufficient samples.
//
// The authoritative Markdown QUEUE/STATUS stay human; history.jsonl is the
// runtime/machine-readable record (mission §29). No ML, no opaque heuristics.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { dirname } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OUTCOME_CLASSES = Object.freeze([
  'SUCCESS_PRODUCT',
  'SUCCESS_BUG_FIX',
  'SUCCESS_RELIABILITY',
  'SUCCESS_TEST_DEBT',
  'SUCCESS_ARCHITECTURE',
  'PARTIAL',
  'DEFERRED',
  'BLOCKED_EXTERNAL',
  'FAILED',
  'SAFE_MODE',
  'INVALID',
]);

export const VALUE_BANDS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const VALUE_ORDER = Object.freeze({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 });

// Supervisor verdicts known to the runtime (mission §15).
export const VERDICTS = Object.freeze([
  'SUCCESS',
  'CRASH',
  'LOOP_INTERRUPTED',
  'STALL',
  'TIMEOUT',
  'CONFIG_ERROR',
  'CONFIG_FAILURE',
]);

// Recovery strategies the runtime can recommend (§9).
export const RECOVERY_STRATEGIES = Object.freeze([
  'DIRECT_RETRY',
  'COMPACT_PROMPT',
  'STRICT_EXECUTION_ONLY',
  'CONTEXT_RESET',
  'DEFER_TASK',
  'SAFE_MODE',
]);

// Low-value flags detected on a cycle entry (§23).
export const LOW_VALUE_SIGNALS = Object.freeze([
  'TEST_ONLY_NO_BUG',
  'NO_BEHAVIOR_CHANGE',
  'DOC_ONLY',
  'COSMETIC_ONLY',
]);

const DEFAULT_BOUNDS = Object.freeze({
  // phDefaults: current policy timeout per phase (ms), clamped afterwards.
  hardMinMs: Object.freeze({
    DISCOVERY: 10 * 60 * 1000,
    IMPLEMENTING: 30 * 60 * 1000,
    VALIDATING: 15 * 60 * 1000,
    COMMITTING: 5 * 60 * 1000,
    TRACKERS: 5 * 60 * 1000,
    DEFAULT: 15 * 60 * 1000,
  }),
  hardMaxMs: Object.freeze({
    DISCOVERY: 120 * 60 * 1000,
    IMPLEMENTING: 360 * 60 * 1000,
    VALIDATING: 240 * 60 * 1000,
    COMMITTING: 60 * 60 * 1000,
    TRACKERS: 60 * 60 * 1000,
    DEFAULT: 180 * 60 * 1000,
  }),
  minSamples: 10,
  maxAdjustmentPct: 0.2, // ±20% per recommendation
  minMeaningfulDeltaPct: 0.05, // ignore sub-5% adjustments (drift §20)
  cooldownCycles: 5,
});

// ---------------------------------------------------------------------------
// Stable key sort (determinism: regenerating = diff zero, mission CE-012)
// ---------------------------------------------------------------------------

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Cycle model
// ---------------------------------------------------------------------------

// The minimum useful cycle record (mission §3). Every field is optional at
// record time; classifyOutcome/valueSignal/metrics use whatever exists.
export function normalizeCycleEntry(raw = {}) {
  const flags = Array.isArray(raw.flags) ? raw.flags.slice() : [];
  const verdicts = Array.isArray(raw.supervisorVerdicts)
    ? raw.supervisorVerdicts.filter((v) => VERDICTS.includes(v))
    : [];
  const strategies = Array.isArray(raw.recoveryStrategies)
    ? raw.recoveryStrategies.filter((s) => RECOVERY_STRATEGIES.includes(s))
    : [];
  const fingerprints = Array.isArray(raw.failureFingerprints)
    ? raw.failureFingerprints.slice()
    : [];
  const phaseDurations = raw.phaseDurations && typeof raw.phaseDurations === 'object'
    ? Object.fromEntries(Object.keys(raw.phaseDurations).map((k) => [k, Number(raw.phaseDurations[k]) || 0]))
    : null;
  return {
    kind: raw.kind || 'cycle',
    cycle: Number(raw.cycle) || 0,
    taskId: String(raw.taskId || ''),
    ce: String(raw.ce || ''),
    taskType: String(raw.taskType || ''),
    source: String(raw.source || 'QUEUE'),
    priority: String(raw.priority || 'P3'),
    selectedScore: Number(raw.selectedScore) || null,
    durationMs: Number(raw.durationMs) || 0,
    initialState: String(raw.initialState || ''),
    finalState: String(raw.finalState || ''),
    filesChanged: Number(raw.filesChanged) || 0,
    commits: Number(raw.commits) || 0,
    focusedTests: Number(raw.focusedTests) || 0,
    regressionTests: Number(raw.regressionTests) || 0,
    retries: Number(raw.retries) || 0,
    crashes: Number(raw.crashes) || 0,
    loops: Number(raw.loops) || 0,
    stalls: Number(raw.stalls) || 0,
    recoveries: Number(raw.recoveries) || 0,
    safeMode: !!raw.safeMode,
    envFailure: !!raw.envFailure,
    blocked: !!raw.blocked,
    promptSizeChars: Number(raw.promptSizeChars) || 0,
    recoveryPromptSizeChars: Number(raw.recoveryPromptSizeChars) || 0,
    supervisorVerdicts: verdicts,
    finalOutcome: String(raw.finalOutcome || ''),
    failureFingerprints: fingerprints,
    recoveryStrategies: strategies,
    phaseDurations,
    partial: !!raw.partial,
    deferred: !!raw.deferred,
    flags,
    lowValueSignals: Array.isArray(raw.lowValueSignals) ? raw.lowValueSignals.slice() : [],
    note: String(raw.note || ''),
  };
}

// ---------------------------------------------------------------------------
// Storage (append-only JSONL + tolerant read)
// ---------------------------------------------------------------------------

export function recordCycle(filePath, raw) {
  const entry = normalizeCycleEntry(raw);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(sortKeys(entry)) + '\n', { flag: 'a' });
  return entry;
}

function sortString(a, b) { return String(a).localeCompare(String(b)); }

// Read history. Corrupt lines are isolated, not fatal: returns the valid
// entries plus { corrupt, total } and flags PARTIAL_HISTORY when mixed
// (mission §32). Tolerant of a trailing partial line.
export function loadHistory(filePath) {
  if (!existsSync(filePath)) return { cycles: [], corrupt: 0, total: 0, partialHistory: false };
  const raw = readFileSync(filePath, 'utf8');
  const cycles = [];
  let corrupt = 0;
  let total = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    total++;
    try {
      const obj = JSON.parse(trimmed);
      const norm = normalizeCycleEntry(obj.kind === 'cycle' ? obj : obj);
      if (obj.kind === 'cycle') cycles.push(norm);
    } catch {
      corrupt++;
    }
  }
  cycles.sort((a, b) => a.cycle - b.cycle);
  return { cycles, corrupt, total, partialHistory: corrupt > 0 };
}

export function allEntries(filePath) {
  if (!existsSync(filePath)) return [];
  const out = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* isolated */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outcome classification (deterministic, mission §4)
// ---------------------------------------------------------------------------

// Map (supervisor verdict, task type, flags) -> OTUCOME_CLASS.
// A clean exit alone is NOT enough: the VALUE class depends on what the cycle
// actually delivered, so metrics don't collapse to "exitCode 0 == good".
export function classifyOutcome(entry) {
  const e = normalizeCycleEntry(entry);
  if (e.safeMode) return 'SAFE_MODE';
  if (e.blocked && !e.finalOutcome && !e.partial) return 'BLOCKED_EXTERNAL';
  if (e.deferred) return 'DEFERRED';
  if (e.partial) return 'PARTIAL';
  const verdict = e.finalOutcome || e.supervisorVerdicts[e.supervisorVerdicts.length - 1] || '';
  if (verdict === 'SUCCESS') {
    const t = e.taskType.toUpperCase();
    if (t === 'BUG_FIX') return 'SUCCESS_BUG_FIX';
    if (t === 'MEANINGFUL_TEST_COVERAGE') return 'SUCCESS_TEST_DEBT';
    if (t === 'ARCHITECTURE_IMPROVEMENT') return 'SUCCESS_ARCHITECTURE';
    if (t === 'SECURITY_FIX' || /RELIAB|PERFORMANCE/i.test(t) || /reliab|storage|persist|fiabilidad|integr/i.test(e.taskType + ' ' + (e.note || ''))) {
      return 'SUCCESS_RELIABILITY';
    }
    if (t === 'FEATURE' || t === 'UX_IMPROVEMENT' || t === 'PERFORMANCE_IMPROVEMENT') return 'SUCCESS_PRODUCT';
    return 'SUCCESS_PRODUCT';
  }
  if (verdict === 'LOOP_INTERRUPTED' || verdict === 'STALL' || verdict === 'TIMEOUT' || verdict === 'CRASH') {
    // Environment failures (external binary denied, infra) are NOT task-quality
    // failures (mission §8/§25-F). classifyOutcome keeps them FAILED for the
    // cycle, but scoring consults envFailure separately.
    return 'FAILED';
  }
  if (verdict === 'CONFIG_ERROR' || verdict === 'CONFIG_FAILURE') return 'FAILED';
  return 'INVALID';
}

// Verified low-value signals (mission §23): does activity without value.
export function detectLowValueActivity(entry) {
  const e = normalizeCycleEntry(entry);
  const signals = [];
  const t = e.taskType.toUpperCase();
  const hasVerictSuccess = e.finalOutcome === 'SUCCESS' || e.supervisorVerdicts.includes('SUCCESS');
  if (t === 'MEANINGFUL_TEST_COVERAGE' && !e.regressionTests && !e.commits) signals.push('TEST_ONLY_NO_BUG');
  if (e.filesChanged === 0 && e.commits === 0 && hasVerictSuccess) signals.push('NO_BEHAVIOR_CHANGE');
  if (/doc|document|evidence|evidencia/i.test(e.taskType + ' ' + (e.note || '')) && e.commits > 0 && e.filesChanged <= 2) {
    signals.push('DOC_ONLY');
  }
  if (hasVerictSuccess && VALUE_ORDER[valueSignal(e)] <= VALUE_ORDER.LOW && e.durationMs > 30 * 60 * 1000) {
    signals.push('COSMETIC_ONLY');
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Value signal (ordinal, mission §5) — no false precision.
// ---------------------------------------------------------------------------

export function valueSignal(entry) {
  const e = normalizeCycleEntry(entry);
  const flags = e.flags.map((f) => String(f).toLowerCase());
  const task = (e.taskType + ' ' + (e.note || '')).toLowerCase();
  const hasSuccess = e.finalOutcome === 'SUCCESS' || e.supervisorVerdicts.includes('SUCCESS');

  const critical = flags.includes('critical')
    || flags.includes('data-loss')
    || /security|seguridad|pago|payment|data.?loss|perdida de datos|auth|rol/.test(task);
  const high = flags.includes('high')
    || flags.includes('bug-reproducible')
    || /bug reproducible|broken|roto|corrupt|crash|integridad|integrity|referenci|horn|fila rota/.test(task);
  const low = flags.includes('low')
    || e.filesChanged > 0 && /cosmetic|cosmetica|tooltip|label|icono|spacing/.test(task)
    || /test.?only|solo test|coverage sin defecto/.test(task);

  if (!hasSuccess) return flags.includes('critical') ? 'CRITICAL' : 'LOW';
  if (critical) return 'CRITICAL';
  if (high) return 'HIGH';
  if (low) return 'LOW';
  if (e.focusedTests > 0 && e.commits > 0) return 'MEDIUM';
  if (e.filesChanged > 0 && e.commits > 0) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Historical penalties (mission §8): same task/strategy failing repeatedly.
// Differentiate TASK FAILURE from ENVIRONMENT FAILURE so a denied external
// binary is not a permanent veto on the task quality.
// ---------------------------------------------------------------------------

// Returns { penalty, envFailures, taskFailures } for a task id over history.
export function historicalPenalty(taskId, history) {
  const entries = (history || []).filter((h) => h.taskId === String(taskId));
  if (entries.length === 0) return { penalty: 0, envFailures: 0, taskFailures: 0, attempts: 0 };
  let envFailures = 0;
  let taskFailures = 0;
  let successes = 0;
  for (const e of entries) {
    const cls = classifyOutcome(e);
    const failed = cls === 'FAILED' || cls === 'PARTIAL' || cls === 'SAFE_MODE';
    if (!failed) { successes++; continue; }
    if (e.envFailure) envFailures++;
    else taskFailures++;
  }
  // Penalty scales with task failures; env failures contribute a tenth (an
  // environment veto should not silently become a task veto, §8).
  const penalty = Math.min(30, taskFailures * 6 + Math.ceil(envFailures * 0.6));
  return { penalty, envFailures, taskFailures, attempts: entries.length, successes };
}

// ---------------------------------------------------------------------------
// Evidence-aware task scoring (mission §6) — explicit, auditable components.
// ---------------------------------------------------------------------------

export const SCORE_COMPONENTS = Object.freeze({
  PRIORITY: 'priority',
  IMPACT: 'impact',
  AREA_FIT: 'area_fit',
  CONFIDENCE: 'confidence',
  EFFORT: 'effort',
  REPETITION: 'historical_penalty',
  DUPLICATE: 'duplicate',
  BLOCKED: 'dependency_blocked',
  LEVERAGE: 'unblocks_multiple',
});

function kw(text, list) {
  text = String(text || '').toLowerCase();
  return list.some((k) => text.includes(k));
}

// EVALUATE a single task candidate with the full factor set (mission §6).
// `history` (cycles) provides repetition/dependency evidence. Deterministic.
export function scoreTaskDetail(task, history = [], opts = {}) {
  const t = { ...task };
  const text = String(t.task || '') + ' ' + String(t.area || '') + ' ' + String(t.note || '');
  const components = {};

  const pr = { P0: 40, P1: 32, P2: 20, P3: 10 };
  components[SCORE_COMPONENTS.PRIORITY] = pr[t.priority] || 0;

  // Impact: reproducible data-loss/security/broken-flow bugs rank far above
  // cosmetic or test-only debt (mission §6 bonifies/penalizes).
  let impact = 0;
  if (kw(text, ['pérdida de datos', 'data loss', 'datos'])) impact += 16;
  if (kw(text, ['seguridad', 'security', 'pago', 'payment', 'auth', 'permiso'])) impact += 14;
  if (kw(text, ['roto', 'broken', 'corrupt', 'crash', 'bucle', 'loop', 'referencia huérfana', 'huérfano'])) impact += 12;
  if (kw(text, ['reproducible', 'repro', 'regresión', 'regression'])) impact += 8;
  if (kw(text, ['usuario', 'user-facing', 'flujo', 'flow', 'ux', 'interfaz'])) impact += 5;
  components[SCORE_COMPONENTS.IMPACT] = impact;

  // Area fit: star-flow / reliability / storage rank higher; audit/docs lower.
  const area = String(t.area || '').toLowerCase();
  let fit = 0;
  if (String(t.area) === 'Flujo estrella') fit += 4;
  if (/fiabilidad|reliab|integr|storage|persist|seguridad/.test(area)) fit += 3;
  if (/rendimiento|performance|perf/.test(area)) fit += 2;
  if (/flujo estrella|flow|ocr|workspace/.test(area)) fit += 2;
  if (/ux|móvil|mobile|accesib|contraste/.test(area)) fit += 1;
  if (/audit|discovery|docs|documentaci|cosmetic|cosmetica/.test(area)) fit -= 1;
  components[SCORE_COMPONENTS.AREA_FIT] = fit;

  // Confidence from history: repeat attempts that eventually succeeded raise
  // confidence; pure repeated task failure lowers it via the repetition term.
  let confidence = 4;
  if (Array.isArray(history) && history.length > 0) {
    const hp = historicalPenalty(t.id, history);
    if (hp.successes > 0 && hp.taskFailures === 0) confidence += 3;
    if (hp.successes > 0 && hp.taskFailures > 0 && hp.successes >= hp.taskFailures) confidence += 1;
  }
  components[SCORE_COMPONENTS.CONFIDENCE] = Math.max(0, confidence);

  // Effort: a task too large for a single cycle is penalized.
  let effort = 0;
  if (kw(text, ['completo', 'all tools', 'todas las', 'entero', 'migrar todo', 'refactor completo'])) effort += 8;
  if (kw(text, ['refactor', 'refactoring']) && !kw(text, ['bug', 'broken', 'roto'])) effort += 5;
  if (kw(text, ['auditor'] ) || /audit/.test(area)) effort += 3;
  components[SCORE_COMPONENTS.EFFORT] = -effort;

  // Repetition penalty (mission §6 penalizes "already attempted many times").
  let repetition = 0;
  let dup = 0;
  if (Array.isArray(history) && history.length > 0) {
    const seen = history.filter((h) => String(h.taskId) === String(t.id));
    if (seen.length >= 2 && classifyOutcome(seen[seen.length - 1]) === 'FAILED') {
      repetition = Math.min(12, seen.filter((h) => classifyOutcome(h) === 'FAILED').length * 4);
    }
    // Duplicate opportunity: very similar task text already DONE recently.
    const doneTexts = history
      .filter((h) => classifyOutcome(h).startsWith('SUCCESS'))
      .map((h) => h.note || '')
      .slice(-8);
    const base = String(t.task || '').toLowerCase();
    if (doneTexts.some((d) => { const dl = String(d).toLowerCase(); return dl.length > 30 && base.slice(0, 40) && base.length > 20 && (dl.includes(base.slice(0, 24)) || base.includes(dl.slice(0, 24))); })) {
      dup = 6;
    }
  }
  components[SCORE_COMPONENTS.REPETITION] = -repetition;
  components[SCORE_COMPONENTS.DUPLICATE] = -dup;

  // Dependency blocking.
  let blocked = 0;
  if (String(t.state || '').toUpperCase() === 'BLOCKED' || String(t.state || '').toUpperCase() === 'BLOCKED_FLAKY') blocked = 14;
  if (kw(text, ['depende', 'blocked', 'pendiente de', 'requiere', 'necesita primero'])) blocked = Math.max(blocked, 8);
  components[SCORE_COMPONENTS.BLOCKED] = -blocked;

  // Leverage: a task that unblocks several others.
  let leverage = 0;
  if (kw(text, ['desbloquea', 'unblocks', 'central', 'shared', 'común', 'base común'])) leverage = 8;
  components[SCORE_COMPONENTS.LEVERAGE] = leverage;

  const score = Object.values(components).reduce((a, b) => a + b, 0);
  return { id: t.id, score, components };
}

export function scoreTask(task, history = []) {
  return scoreTaskDetail(task, history).score;
}

// EXPLAINABLE selection (mission §7): pick best of candidates with the full
// breakdown and reasons why it won / others lost.
export function selectTaskExplainable(candidates, history = []) {
  const eligible = (candidates || []).filter((t) => t.state === 'TODO');
  if (eligible.length === 0) {
    return { selected: null, candidates: [], whyWon: [], whyLost: [], empty: true };
  }
  const scored = eligible.map((t) => ({ ...scoreTaskDetail(t, history), priority: t.priority, state: t.state, area: t.area, task: String(t.task || '').slice(0, 120) }));
  scored.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const winner = scored[0];
  const whyWon = [];
  const whyLost = [];
  for (const s of scored) {
    if (s.id === winner.id) {
      whyWon.push(`${winner.id} selected: score ${winner.score}`);
      for (const k of Object.keys(winner.components)) {
        whyWon.push(`  ${k}: ${winner.components[k]}`);
      }
    } else {
      const probe = `${s.id} rejected (score ${s.score})`;
      whyLost.push(s.score === winner.score ? `${s.id}: tie broken by deterministic id order` : `${s.id}: score ${s.score} < ${winner.score}`);
    }
  }
  return { selected: winner, candidates: scored, whyWon, whyLost };
}

// Task recommendation from the authoritative Markdown QUEUE mirror (mission §21).
// Returns RECOMMENDED_NEXT_TASK with evidence, but NEVER mutates the Markdown.
export function recommendTask(queueTasks, history = []) {
  const todo = (queueTasks || []).filter((t) => t.state === 'TODO');
  if (todo.length > 0) {
    const sel = selectTaskExplainable(todo, history);
    return { recommendation: 'RECOMMENDED_NEXT_TASK', taskId: sel.selected.id, score: sel.selected.score, whyWon: sel.whyWon, whyLost: sel.whyLost };
  }
  // Empty queue -> DISCOVERY that respects history (mission §22): avoid
  // proposing things that previously demonstrated little value.
  const recent = (history || []).slice(-15);
  const testOnlyRecent = recent.filter((h) => detectLowValueActivity(h).includes('TEST_ONLY_NO_BUG')).length;
  const docOnlyRecent = recent.filter((h) => detectLowValueActivity(h).includes('DOC_ONLY')).length;
  const guidance = [];
  if (testOnlyRecent >= 5) guidance.push('PENALIZE_ANOTHER_TEST_ONLY_DISCOVERY');
  if (docOnlyRecent >= 3) guidance.push('PENALIZE_DOC_ONLY_DISCOVERY');
  return {
    recommendation: 'DISCOVERY',
    guidance,
    sinceNoTodo: true,
    suggestedDirections: suggestionsFromAreaDensity(recent),
  };
}

function suggestionsFromAreaDensity(history) {
  if (!history || history.length === 0) return [];
  const byArea = {};
  for (const h of history) { const a = String(h.taskType || 'PRODUCT'); byArea[a] = (byArea[a] || 0) + 1; }
  const lowest = Object.entries(byArea).sort((x, y) => x[1] - y[1])[0];
  return [`recent history under-represented: ${lowest[0]} (${lowest[1]} cycles)`];
}

// ---------------------------------------------------------------------------
// Recovery strategy analysis (mission §9)
// ---------------------------------------------------------------------------

// Per-strategy stats over history: attempts, successes, recurrence, time to
// recovery, and which failure fingerprint each strategy was used for.
export function recoveryStrategyStats(history = []) {
  const stats = {};
  for (const h of history) {
    for (const strat of h.recoveryStrategies || []) {
      if (!RECOVERY_STRATEGIES.includes(strat)) continue;
      const fp = String(h.failureFingerprints && h.failureFingerprints[0] || '');
      const cur = stats[strat] || (stats[strat] = { strategy: strat, attempts: 0, successes: 0, recurrences: 0, recoveryMs: [], fingerprints: [] });
      cur.attempts++;
      const cls = classifyOutcome(h);
      if (cls === 'SUCCESS_PRODUCT' || cls === 'SUCCESS_BUG_FIX' || cls === 'SUCCESS_RELIABILITY' ||
        cls === 'SUCCESS_TEST_DEBT' || cls === 'SUCCESS_ARCHITECTURE' || cls === 'PARTIAL') {
        cur.successes++;
      } else {
        cur.recurrences++;
      }
      if (h.durationMs) cur.recoveryMs.push(h.durationMs);
      if (fp && !cur.fingerprints.includes(fp)) cur.fingerprints.push(fp);
    }
  }
  for (const s of Object.values(stats)) {
    s.successRate = s.attempts ? s.successes / s.attempts : 0;
    const sorted = s.recoveryMs.slice().sort((a, b) => a - b);
    s.p50RecoveryMs = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : null;
  }
  return stats;
}

// For a given failure fingerprint, return the strategy with the best
// demonstrated success (ties: fewest recurrences, then deterministic id).
export function recommendRecovery(failureFingerprintToMatch, history = []) {
  const relevant = (history || []).filter((h) => (h.failureFingerprints || []).includes(failureFingerprintToMatch) || (String(h.note || '').includes(failureFingerprintToMatch)));
  if (relevant.length === 0) return { recommendation: 'DIRECT_RETRY', evidence: 'no history for this fingerprint', candidates: [] };
  const stats = recoveryStrategyStats(relevant);
  const scored = RECOVERY_STRATEGIES
    .map((s) => stats[s] || { strategy: s, attempts: 0, successes: 0, recurrences: 0, successRate: 0, p50RecoveryMs: null })
    .filter((s) => s.attempts > 0)
    .map((s) => ({ ...s, win: s.successRate }));
  scored.sort((a, b) => b.win - a.win || a.recurrences - b.recurrences || String(a.strategy).localeCompare(String(b.strategy)));
  return { recommendation: scored[0].strategy, candidates: scored, evidence: `best success ${Math.round(scored[0].successRate * 100)}% on ${scored[0].attempts} attempts` };
}

// ---------------------------------------------------------------------------
// Adaptive timeout recommendation (mission §10/§11/§20) — robust percentiles.
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * (sorted.length - 1))));
  return sorted[idx];
}

// Recommend a phase timeout from `samplesMs` (observed durations in ms).
//   ph:    phase name
//   currentMs: current policy timeout for the phase
//   bounds:   hardened bounds (defaultDEFAULT_BOUNDS)
// Returns a recommendation with status:
//   INSUFFICIENT_EVIDENCE (minSamples unmet) / WITHIN_BOUNDS / AT_HARD_MIN / AT_HARD_MAX
export function recommendTimeout(ph, samplesMs, currentMs, bounds = {}) {
  const b = { ...DEFAULT_BOUNDS, ...bounds };
  const hardMin = b.hardMinMs[ph] ?? b.hardMinMs.DEFAULT;
  const hardMax = b.hardMaxMs[ph] ?? b.hardMaxMs.DEFAULT;
  const samples = (samplesMs || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (samples.length < b.minSamples) {
    return {
      phase: ph,
      status: 'INSUFFICIENT_EVIDENCE',
      samples: samples.length,
      minSamples: b.minSamples,
      currentMs,
      recommendedMs: null,
      reason: `only ${samples.length} sample(s); minimum ${b.minSamples} required`,
    };
  }
  // Robust: use p90 for the observed duration, not the mean (mission §25-D
  // and §10: an outlier must not drive the recommendation).
  const sorted = samples.slice().sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const observed = p90;
  const coarse = Math.min(currentMs, observed > currentMs * 1.2 ? p90 : p50);
  const raw = currentMs * (1 + Math.max(-b.maxAdjustmentPct, Math.min(b.maxAdjustmentPct, (observed / Math.max(currentMs, 1)) - 1)));
  // Bound the per-step delta (drift protection §20).
  const minAdjusted = currentMs * (1 + Math.max(-b.maxAdjustmentPct, raw / currentMs - 1));
  const maxChange = Math.min(1 + b.maxAdjustmentPct, Math.max(1 - b.maxAdjustmentPct, minAdjusted / currentMs));
  let recommended = Math.round(currentMs * maxChange);
  // Do not suggest a delta below minMeaningfulDeltaPct (would be churn).
  const deltaPct = Math.abs(recommended - currentMs) / currentMs;
  if (deltaPct < (b.minMeaningfulDeltaPct ?? 0.05)) {
    return {
      phase: ph,
      status: 'KEEP_CURRENT',
      samples: samples.length,
      minSamples: b.minSamples,
      currentMs,
      recommendedMs: currentMs,
      p90,
      p50,
      reason: `delta ${(deltaPct * 100).toFixed(1)}% below minimum meaningful change`,
    };
  }
  // Hard clamp.
  recommended = Math.max(hardMin, Math.min(hardMax, recommended));
  const status = recommended === hardMax ? 'AT_HARD_MAX' : recommended === hardMin ? 'AT_HARD_MIN' : 'WITHIN_BOUNDS';
  return {
    phase: ph,
    status,
    samples: samples.length,
    minSamples: b.minSamples,
    currentMs,
    recommendedMs: recommended,
    p90,
    p50,
    reason: `p90=${Math.round(p90 / 1000)}s, p50=${Math.round(p50 / 1000)}s, current=${Math.round(currentMs / 1000)}s`,
  };
}

// ---------------------------------------------------------------------------
// Prompt size / context bloat (mission §12/§14)
// ---------------------------------------------------------------------------

// Detect CONTEXT_BLOAT: prompts growing cycle over cycle, repeated large
// blocks, or trackers embedded whole when a section suffices. Deterministic.
export function detectPromptBloat(history = [], opts = {}) {
  const thresholdChars = opts.thresholdChars || 24000;
  const growthMin = opts.growthMin || 5000;
  const cycleEntries = (history || []).filter((h) => h.kind === 'cycle').sort((a, b) => a.cycle - b.cycle);
  const warnings = [];
  for (let i = 1; i < cycleEntries.length; i++) {
    const prev = cycleEntries[i - 1];
    const cur = cycleEntries[i];
    if (cur.promptSizeChars > prev.promptSizeChars + growthMin) {
      warnings.push({
        warning: 'CONTEXT_BLOAT',
        cycle: cur.cycle,
        reason: `prompt grew ${prev.promptSizeChars} -> ${cur.promptSizeChars} chars`,
      });
    }
  }
  const last = cycleEntries[cycleEntries.length - 1];
  if (last && last.promptSizeChars > thresholdChars) {
    warnings.push({
      warning: 'CONTEXT_BLOAT',
      cycle: last.cycle,
      reason: `prompt ${last.promptSizeChars} chars exceeds ${thresholdChars}`,
      recommendation: 'use compact context (rules criticales + task + foreign files + next action)',
    });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Productivity metrics (mission §15)
// ---------------------------------------------------------------------------

export function metrics(history = []) {
  const cycles = (history || []).filter((h) => h.kind === 'cycle');
  const total = cycles.length;
  if (!total) return { cycles: 0 };
  const clsCount = {};
  for (const h of cycles) {
    const c = classifyOutcome(h);
    clsCount[c] = (clsCount[c] || 0) + 1;
  }
  const success = (clsCount.SUCCESS_PRODUCT || 0) + (clsCount.SUCCESS_BUG_FIX || 0) +
    (clsCount.SUCCESS_RELIABILITY || 0) + (clsCount.SUCCESS_TEST_DEBT || 0) + (clsCount.SUCCESS_ARCHITECTURE || 0);
  const loops = cycles.filter((h) => (h.supervisorVerdicts || []).includes('LOOP_INTERRUPTED') || (h.finalOutcome === 'LOOP_INTERRUPTED')).length;
  const stalls = cycles.filter((h) => (h.supervisorVerdicts || []).includes('STALL') || h.finalOutcome === 'STALL').length;
  const crashes = cycles.filter((h) => (h.supervisorVerdicts || []).includes('CRASH') || h.finalOutcome === 'CRASH').length;
  const recoveries = cycles.reduce((a, h) => a + (h.recoveries || 0), 0);
  const safeMode = cycles.filter((h) => h.safeMode || classifyOutcome(h) === 'SAFE_MODE').length;
  const productFixes = (clsCount.SUCCESS_PRODUCT || 0) + (clsCount.SUCCESS_BUG_FIX || 0) + (clsCount.SUCCESS_ARCHITECTURE || 0) + (clsCount.SUCCESS_RELIABILITY || 0);
  const testWork = clsCount.SUCCESS_TEST_DEBT || 0;
  const topFailure = topFailureFingerprint(cycles);
  const lowValue = cycles.filter((h) => detectLowValueActivity(h).length > 0).length;
  const verifiedHigh = cycles.filter((h) => VALUE_ORDER[valueSignal(h)] >= VALUE_ORDER.HIGH).length;
  const reopens = cycles.filter((h) => /reabri|bug raspons|reopen/i.test(h.note || '') || h.flags.includes('reopened')).length;
  const safetyEvents = (history || []).filter((h) => h.kind === 'safety').length;
  const durationMs = cycles.map((h) => h.durationMs || 0);
  const phaseDurations = {};
  for (const h of cycles) {
    for (const [ph, ms] of Object.entries(h.phaseDurations || {})) {
      (phaseDurations[ph] = phaseDurations[ph] || []).push(ms);
    }
  }
  const phaseP50 = {};
  for (const [ph, arr] of Object.entries(phaseDurations)) {
    const s = arr.slice().sort((a, b) => a - b);
    phaseP50[ph] = s[Math.floor((s.length - 1) * 0.5)] || 0;
  }
  return {
    cycles: total,
    successRate: total ? Math.round((success / total) * 1000) / 1000 : 0,
    successCount: success,
    byOutcome: clsCount,
    loops,
    stalls,
    crashes,
    recoveries,
    safeModeActivations: safeMode,
    productFixes,
    testOnlyWork: testWork,
    lowValueActivity: lowValue,
    highValueCycles: verifiedHigh,
    topFailureFingerprint: topFailure,
    recoveryStats: recoveryStrategyStats(cycles),
    avgDurationMs: total ? Math.round(durationMs.reduce((a, b) => a + b, 0) / total) : 0,
    phaseP50Ms: phaseP50,
    safetyEvents,
    reopenedTasks: reopens,
  };
}

function topFailureFingerprint(cycles) {
  const counts = {};
  for (const h of cycles) {
    for (const fp of h.failureFingerprints || []) counts[fp] = (counts[fp] || 0) + 1;
  }
  const e = Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return e.length ? e[0][0] : null;
}

// ---------------------------------------------------------------------------
// Policy versioning / rollback (mission §19/§20) — reversible, auditable.
// ---------------------------------------------------------------------------

export function policyFileShape(phases, opts = {}) {
  const bounds = { ...DEFAULT_BOUNDS, ...(opts.bounds || {}) };
  return {
    policyVersion: 1,
    previousVersion: null,
    changedAt: null,
    reason: 'initial defaults',
    evidence: null,
    phases: { ...phases },
    bounds,
  };
}

export function readPolicy(filePath) {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return null; }
}

export function writePolicy(filePath, policy) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  const payload = JSON.stringify(sortKeys(policy), null, 2) + '\n';
  writeFileSync(tmp, payload, 'utf8');
  writeFileSync(filePath, payload, 'utf8');
  try { rmSync(tmp, { force: true }); } catch { }
  return payload;
}

// Apply a bounded phase-timeout change to a policy. Returns the new policy with
// the audit trail; rejects (INVALID) when the change is outside hard bounds.
export function applyPolicyChange(current, { phase, newMs, reason, evidence = null }, bounds = {}) {
  const b = { ...DEFAULT_BOUNDS, ...bounds };
  const hardMin = b.hardMinMs[phase] ?? b.hardMinMs.DEFAULT;
  const hardMax = b.hardMaxMs[phase] ?? b.hardMaxMs.DEFAULT;
  const n = Number(newMs) || 0;
  if (n < hardMin || n > hardMax) {
    return { ok: false, reason: `newMs ${n} outside hard bounds [${hardMin}, ${hardMax}]`, status: 'REJECTED_OUT_OF_BOUNDS' };
  }
  const prev = current.phases[phase];
  if (Math.abs(n - prev) / Math.max(prev, 1) < (b.minMeaningfulDeltaPct ?? 0.05)) {
    return { ok: false, reason: `delta below minimum meaningful (${(b.minMeaningfulDeltaPct ?? 0.05) * 100}%)`, status: 'REJECTED_BELOW_MINIMUM' };
  }
  const next = {
    policyVersion: (current.policyVersion || 1) + 1,
    previousVersion: current.policyVersion || 1,
    changedAt: 'see history.jsonl:policy', // deterministic: real timestamp lives in launcher log
    reason: String(reason || ''),
    evidence,
    phases: { ...current.phases, [phase]: n },
    bounds: current.bounds,
    changes: [...(current.changes || []), { policyVersion: (current.policyVersion || 1) + 1, phase, fromMs: prev, toMs: n, reason: String(reason || '') }],
  };
  return { ok: true, policy: next, status: 'APPLIED' };
}

export function rollbackPolicy(current) {
  if (!current || current.policyVersion <= 1) {
    return { ok: false, reason: 'no previous version to roll back to', status: 'NO_PREVIOUS' };
  }
  const changes = current.changes || [];
  const last = changes.slice(-1)[0];
  const prevVersion = current.previousVersion || Math.max(current.policyVersion - 1, 1);
  const prevPhases = last
    ? { ...current.phases, [last.phase]: last.fromMs }
    : current.phases;
  return {
    ok: true,
    policy: {
      ...current,
      policyVersion: prevVersion,
      previousVersion: null,
      reason: 'ROLLBACK',
      evidence: null,
      phases: prevPhases,
      changes: changes.slice(0, -1),
    },
    status: 'ROLLED_BACK',
  };
}

export default {
  OUTCOME_CLASSES,
  VALUE_BANDS,
  VERDICTS,
  RECOVERY_STRATEGIES,
  LOW_VALUE_SIGNALS,
  DEFAULT_BOUNDS,
  sortKeys,
  normalizeCycleEntry,
  recordCycle,
  loadHistory,
  allEntries,
  classifyOutcome,
  valueSignal,
  detectLowValueActivity,
  historicalPenalty,
  scoreTask,
  scoreTaskDetail,
  selectTaskExplainable,
  recommendTask,
  recoveryStrategyStats,
  recommendRecovery,
  percentile,
  recommendTimeout,
  detectPromptBloat,
  metrics,
  policyFileShape,
  readPolicy,
  writePolicy,
  applyPolicyChange,
  rollbackPolicy,
};