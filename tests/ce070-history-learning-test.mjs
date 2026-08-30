// CE-070 — Evidence-Driven Autonomous Optimization. Verifies AI_AUTONOMY/history.mjs
// (cycle history, outcome/value classification, evidence-aware task scoring,
// historical penalties with env-failure differentiation, recovery-strategy
// analysis, robust timeouts, prompt bloat, LOW_VALUE_ACTIVITY, policy
// versioning/rollback, metrics) plus the CLI bridge (history record/list,
// metrics, recommend, tune, policy) against isolated fixture files.
//
// Pure Node, no browser, no network. Registered in tests/run-all.mjs.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; failures.push(msg); console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function ok(v, msg) { assert(Boolean(v), msg); }

async function importFrom(fname) {
  return await import('file:///' + fname.replace(/\\/g, '/') + '?t=' + Date.now());
}

const h = await importFrom(join(ROOT, 'AI_AUTONOMY/history.mjs'));
const hBounds = h.default.DEFAULT_BOUNDS;

// Isolated runtime dir for this test.
const TMP = mkdtempSync(join(tmpdir(), 'ce070-'));
const HIST = join(TMP, 'history.jsonl');
const POL = join(TMP, 'policy.json');
function rmp() { try { rmSync(TMP, { recursive: true, force: true }); } catch { } }
process.on('exit', rmp);

function cliRun(cliArgs, env) {
  const out = execFileSync(process.execPath, [join(ROOT, 'AI_AUTONOMY/cli.mjs'), ...cliArgs], {
    encoding: 'utf8',
    env: { ...process.env, TOOLISTO_HISTORY_FILE: HIST, TOOLISTO_POLICY_FILE: POL, ...env },
  });
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// A. Outcome classification is deterministic and maps correctly.
// ---------------------------------------------------------------------------
{
  eq(h.classifyOutcome({ finalOutcome: 'SUCCESS', taskType: 'BUG_FIX' }), 'SUCCESS_BUG_FIX', 'A1 bug_fix -> SUCCESS_BUG_FIX');
  eq(h.classifyOutcome({ finalOutcome: 'SUCCESS', taskType: 'FEATURE' }), 'SUCCESS_PRODUCT', 'A2 feature -> SUCCESS_PRODUCT');
  eq(h.classifyOutcome({ finalOutcome: 'SUCCESS', taskType: 'MEANINGFUL_TEST_COVERAGE' }), 'SUCCESS_TEST_DEBT', 'A3 test coverage -> SUCCESS_TEST_DEBT');
  eq(h.classifyOutcome({ finalOutcome: 'SUCCESS', taskType: 'ARCHITECTURE_IMPROVEMENT' }), 'SUCCESS_ARCHITECTURE', 'A4 architecture');
  eq(h.classifyOutcome({ finalOutcome: 'SUCCESS', taskType: 'RELIABILITY' }), 'SUCCESS_RELIABILITY', 'A5 reliability');
  eq(h.classifyOutcome({ finalOutcome: 'CRASH' }), 'FAILED', 'A6 crash -> FAILED');
  eq(h.classifyOutcome({ finalOutcome: 'LOOP_INTERRUPTED' }), 'FAILED', 'A7 loop -> FAILED');
  eq(h.classifyOutcome({ finalOutcome: 'STALL' }), 'FAILED', 'A8 stall -> FAILED');
  eq(h.classifyOutcome({ finalOutcome: 'TIMEOUT' }), 'FAILED', 'A9 timeout -> FAILED');
  eq(h.classifyOutcome({ finalOutcome: 'CONFIG_FAILURE' }), 'FAILED', 'A10 config -> FAILED');
  eq(h.classifyOutcome({ safeMode: true }), 'SAFE_MODE', 'A11 safe_mode');
  eq(h.classifyOutcome({ deferred: true, finalOutcome: 'SUCCESS' }), 'DEFERRED', 'A12 deferred');
  eq(h.classifyOutcome({ partial: true, finalOutcome: 'SUCCESS' }), 'PARTIAL', 'A13 partial');
  eq(h.classifyOutcome({ blocked: true }), 'BLOCKED_EXTERNAL', 'A14 blocked external');
  eq(h.classifyOutcome({}), 'INVALID', 'A15 no data -> INVALID');
}

// ---------------------------------------------------------------------------
// B. Value signal (ordinal) with no false precision.
// ---------------------------------------------------------------------------
{
  eq(h.valueSignal({ finalOutcome: 'SUCCESS', taskType: 'BUG_FIX', flags: ['critical'] }), 'CRITICAL', 'B1 critical bug');
  eq(h.valueSignal({ finalOutcome: 'SUCCESS', taskType: 'BUG_FIX', flags: ['high'] }), 'HIGH', 'B2 high');
  eq(h.valueSignal({ finalOutcome: 'SUCCESS', taskType: 'BUG_FIX', flags: ['bug-reproducible'] }), 'HIGH', 'B3 reproducible');
  eq(h.valueSignal({ finalOutcome: 'CRASH' }), 'LOW', 'B4 failure is low value');
  eq(h.valueSignal({ finalOutcome: 'CRASH', flags: ['critical'] }), 'CRITICAL', 'B5 critical failure still flags');
  eq(h.valueSignal({ finalOutcome: 'SUCCESS', taskType: 'FEATURE', filesChanged: 2, commits: 1 }), 'MEDIUM', 'B6 medium feature');
  eq(h.valueSignal({ finalOutcome: 'SUCCESS', taskType: 'FEATURE', note: 'cosmetic button tooltip spacing' }), 'LOW', 'B7 cosmetic low');
}

// ---------------------------------------------------------------------------
// C. LOW_VALUE_ACTIVITY / no behavior change detected.
// ---------------------------------------------------------------------------
{
  const sigs = h.detectLowValueActivity({ finalOutcome: 'SUCCESS', taskType: 'MEANINGFUL_TEST_COVERAGE', regressionTests: 12, commits: 1 });
  eq(sigs.includes('TEST_ONLY_NO_BUG'), false, 'C1 real test debt not flagged');
  const sigs2 = h.detectLowValueActivity({ finalOutcome: 'SUCCESS', taskType: 'MEANINGFUL_TEST_COVERAGE', regressionTests: 0, commits: 0 });
  ok(sigs2.includes('TEST_ONLY_NO_BUG'), 'C2 test-only no bug flagged');
  const sigs3 = h.detectLowValueActivity({ finalOutcome: 'SUCCESS', filesChanged: 0, commits: 0 });
  ok(sigs3.includes('NO_BEHAVIOR_CHANGE'), 'C3 no behavior change flagged');
  const sigs4 = h.detectLowValueActivity({ finalOutcome: 'SUCCESS', taskType: 'DOCUMENTATION', filesChanged: 1, commits: 1, note: 'documentacion del proceso' });
  ok(sigs4.includes('DOC_ONLY'), 'C4 doc-only flagged');
}

// ---------------------------------------------------------------------------
// D. Historical penalty distinguishes TASK vs ENVIRONMENT failures.
// ---------------------------------------------------------------------------
{
  const hist = [
    h.normalizeCycleEntry({ taskId: 'T1', finalOutcome: 'CRASH', envFailure: false }),
    h.normalizeCycleEntry({ taskId: 'T1', finalOutcome: 'CRASH', envFailure: false }),
    h.normalizeCycleEntry({ taskId: 'T1', finalOutcome: 'SUCCESS', taskType: 'BUG_FIX' }),
    h.normalizeCycleEntry({ taskId: 'T2', finalOutcome: 'CRASH', envFailure: true }),
    h.normalizeCycleEntry({ taskId: 'T2', finalOutcome: 'CRASH', envFailure: true }),
    h.normalizeCycleEntry({ taskId: 'T2', finalOutcome: 'CRASH', envFailure: true }),
  ];
  const p1 = h.historicalPenalty('T1', hist);
  eq(p1.taskFailures, 2, 'D1 T1 task failures counted');
  eq(p1.envFailures, 0, 'D2 T1 no env failures');
  ok(p1.penalty > 0, 'D3 T1 penalized');
  const p2 = h.historicalPenalty('T2', hist);
  eq(p2.taskFailures, 0, 'D4 T2 env failures NOT task failure');
  eq(p2.envFailures, 3, 'D5 T2 env failures counted separately');
  ok(p2.penalty < p1.penalty, 'D6 env failures penalize far less');
  eq(h.historicalPenalty('UNKNOWN', hist).penalty, 0, 'D7 unknown task no penalty');
}

// ---------------------------------------------------------------------------
// E. Evidence-aware task scoring is explainable.
// ---------------------------------------------------------------------------
{
  const task = { id: 'E1', priority: 'P0', area: 'Flujo estrella', task: 'fila rota produce pérdida de datos reproducible', state: 'TODO' };
  const detail = h.scoreTaskDetail(task, []);
  ok(detail.score > 40, 'E1 P0+impact scores high');
  ok(Array.isArray(detail.components) !== true, 'E2 components is a breakdown object');
  const evalTask = h.scoreTaskDetail({ id: 'E3', priority: 'P3', area: 'Docs', task: 'documentacion', state: 'TODO' }, []);
  ok(evalTask.score < detail.score, 'E3 low-value task scores lower');
}

// ---------------------------------------------------------------------------
// F. Explainable selection picks winner + reasons.
// ---------------------------------------------------------------------------
{
  const candidates = [
    { id: 'F1', priority: 'P0', area: 'Flujo estrella', task: 'bug reproducible de perfil', state: 'TODO' },
    { id: 'F2', priority: 'P3', area: 'Cosmetic', task: 'cambio cosmetico tooltip', state: 'TODO' },
    { id: 'F3', priority: 'P2', area: 'Docs', task: 'documentacion interna', state: 'TODO' },
    { id: 'FDONE', priority: 'P0', area: 'Flujo estrella', task: 'ya hecho', state: 'DONE' },
  ];
  const sel = h.selectTaskExplainable(candidates, []);
  eq(sel.selected.id, 'F1', 'F1 winner by impact+priority');
  ok(sel.whyWon.some((w) => w.includes('F1 selected')), 'F2 explainable win');
  ok(sel.whyLost.length >= 2, 'F3 losers explained');
  // deterministic tie-break
  const tieA = h.selectTaskExplainable([
    { id: 'ZA', priority: 'P3', area: 'Other', task: 'x', state: 'TODO' },
    { id: 'AB', priority: 'P3', area: 'Other', task: 'x', state: 'TODO' },
  ], []).selected.id;
  const tieB = h.selectTaskExplainable([
    { id: 'AB', priority: 'P3', area: 'Other', task: 'x', state: 'TODO' },
    { id: 'ZA', priority: 'P3', area: 'Other', task: 'x', state: 'TODO' },
  ], []).selected.id;
  eq(tieA, tieB, 'F4 deterministic tie-break');
}

// ---------------------------------------------------------------------------
// G. Task recommendation: with TODOs -> RECOMMENDED_NEXT_TASK; empty -> DISCOVERY.
// ---------------------------------------------------------------------------
{
  const rec = h.recommendTask([{ id: 'G1', priority: 'P0', area: 'Flujo estrella', task: 'bug de datos', state: 'TODO' }], []);
  eq(rec.recommendation, 'RECOMMENDED_NEXT_TASK', 'G1 todo recommendation');
  eq(rec.taskId, 'G1', 'G2 recommended id');
  const disc = h.recommendTask([], []);
  eq(disc.recommendation, 'DISCOVERY', 'G3 empty -> discovery');
  ok(Array.isArray(disc.guidance), 'G4 guidance array');
  const testOnlyHist = [];
  for (let i = 0; i < 6; i++) testOnlyHist.push(h.normalizeCycleEntry({ kind: 'cycle', cycle: i, taskType: 'MEANINGFUL_TEST_COVERAGE', regressionTests: 0, commits: 0, finalOutcome: 'SUCCESS' }));
  const disc2 = h.recommendTask([], testOnlyHist);
  ok(disc2.guidance.includes('PENALIZE_ANOTHER_TEST_ONLY_DISCOVERY'), 'G5 test-only discovery guidance');
  ok(disc2.suggestedDirections.length >= 1, 'G6 under-represented areas suggested');
}

// ---------------------------------------------------------------------------
// H. Backtest (mission §26): recompute deterministic scores over the fixtures
//     and assert stability (rerun == same output).
// ---------------------------------------------------------------------------
{
  const backHist = [];
  for (let i = 1; i <= 12; i++) {
    backHist.push(h.normalizeCycleEntry({
      kind: 'cycle', cycle: i,
      taskId: (i === 3 || i === 7) ? 'BT-BUG' : 'BT-' + i,
      taskType: i % 3 === 0 ? 'BUG_FIX' : (i % 3 === 1 ? 'FEATURE' : 'MEANINGFUL_TEST_COVERAGE'),
      finalOutcome: (i === 3 || i === 7) ? 'CRASH' : (i % 5 === 0 ? 'CRASH' : 'SUCCESS'),
      filesChanged: (i === 3 || i === 7) ? 0 : (i % 5 === 0 ? 0 : 3),
      commits: (i === 3 || i === 7) ? 0 : (i % 5 === 0 ? 0 : 1),
      durationMs: 30 * 60 * 1000 + i * 1000,
    }));
  }
  const scores1 = backHist.map((x) => h.scoreTask({ id: 'BT-BUG', priority: 'P0', area: 'Flujo estrella', task: 'bug reproducible', state: 'TODO' }, backHist.slice(0, x.cycle)));
  const scores2 = backHist.map((x) => h.scoreTask({ id: 'BT-BUG', priority: 'P0', area: 'Flujo estrella', task: 'bug reproducible', state: 'TODO' }, backHist.slice(0, x.cycle)));
  eq(JSON.stringify(scores1), JSON.stringify(scores2), 'H1 backtest deterministic across reruns');
  eq(h.metrics(backHist).cycles, 12, 'H2 metrics count');
  const penAfterCrash = h.historicalPenalty('BT-BUG', backHist);
  ok(penAfterCrash.taskFailures >= 1, 'H3 historical tactic reproduces in backtest');
}

// ---------------------------------------------------------------------------
// I. Robust timeout recommendations (never from few samples; bounded).
// ---------------------------------------------------------------------------
{
  const few = [1000, 2000, 3000];
  const r = h.recommendTimeout('DISCOVERY', few, 30 * 60 * 1000);
  eq(r.status, 'INSUFFICIENT_EVIDENCE', 'I1 <10 samples blocked');
  eq(r.recommendedMs, null, 'I2 no recommendation');
  const one = h.recommendTimeout('DISCOVERY', [5000], 30 * 60 * 1000);
  eq(one.status, 'INSUFFICIENT_EVIDENCE', 'I3 single sample blocked');
  const b = hBounds;
  // 12 samples of ~10min validations, current 7min -> should recommend above.
  const samples = Array.from({ length: 12 }, (_, i) => 9 * 60 * 1000 + i * 1000);
  const rr = h.recommendTimeout('VALIDATING', samples, 7 * 60 * 1000, b);
  ok(rr.status === 'WITHIN_BOUNDS' || rr.status === 'AT_HARD_MIN' || rr.status === 'AT_HARD_MAX' || rr.status === 'KEEP_CURRENT', 'I4 recommendable with enough evidence, status ' + rr.status);
  if (rr.recommendedMs) ok(rr.recommendedMs >= b.hardMinMs.VALIDATING && rr.recommendedMs <= b.hardMaxMs.VALIDATING, 'I5 hard clamp respected');
  const kg = h.recommendTimeout('DISCOVERY', Array.from({ length: 12 }, () => 30 * 60 * 1000 + 1000), 30 * 60 * 1000, b);
  ok(kg.status === 'KEEP_CURRENT', 'I6 near-current -> keep (no drift churn)');
  // Extreme p90 much larger than current: drift protection caps the step at
  // +maxAdjustmentPct (20%) and the result stays inside hard bounds. A single
  // recommendation must NOT jump the whole way to the hard max (mission §20).
  const step = h.recommendTimeout('COMMITTING', Array.from({ length: 12 }, () => 3 * 60 * 60 * 1000), 5 * 60 * 1000, b);
  ok(step.status === 'WITHIN_BOUNDS' || step.status === 'KEEP_CURRENT', 'I7 one-step drift protection, status ' + step.status);
  ok(step.recommendedMs <= Math.round(5 * 60 * 1000 * (1 + (b.maxAdjustmentPct ?? 0.2))), 'I8 step capped by maxAdjustmentPct');
  ok(step.recommendedMs >= b.hardMinMs.COMMITTING && step.recommendedMs <= b.hardMaxMs.COMMITTING, 'I9 stays inside hard bounds');
  // Reaching the hard max requires the adjusted value to actually get there.
  const nearMax = h.recommendTimeout('COMMITTING', Array.from({ length: 12 }, () => 5 * 60 * 1000), 5 * 60 * 1000, b);
  eq(nearMax.status, 'KEEP_CURRENT', 'I10 near current -> keep');
}

// ---------------------------------------------------------------------------
// J. Prompt bloat detection.
// ---------------------------------------------------------------------------
{
  const hist = [
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 1, promptSizeChars: 8000 }),
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 2, promptSizeChars: 9000 }),
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 3, promptSizeChars: 22000 }),
  ];
  const w = h.detectPromptBloat(hist);
  ok(w.length >= 1, 'J1 growth flagged');
  ok(w.some((x) => x.warning === 'CONTEXT_BLOAT'), 'J2 bloat warning label');
  const histBig = [h.normalizeCycleEntry({ kind: 'cycle', cycle: 1, promptSizeChars: 50000 })];
  const w2 = h.detectPromptBloat(histBig);
  ok(w2.some((x) => x.reason.includes('exceeds')), 'J3 absolute threshold');
}

// ---------------------------------------------------------------------------
// K. Recovery strategy analysis and recommendation.
// ---------------------------------------------------------------------------
{
  const hist = [
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 1, taskId: 'K1', finalOutcome: 'CRASH', recoveryStrategies: ['DIRECT_RETRY'], failureFingerprints: ['fp-x'], durationMs: 600000 }),
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 2, taskId: 'K2', finalOutcome: 'CRASH', recoveryStrategies: ['COMPACT_PROMPT'], failureFingerprints: ['fp-x'], durationMs: 300000 }),
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 3, taskId: 'K3', finalOutcome: 'SUCCESS', taskType: 'BUG_FIX', recoveryStrategies: ['COMPACT_PROMPT'], failureFingerprints: ['fp-x'], durationMs: 600000 }),
    h.normalizeCycleEntry({ kind: 'cycle', cycle: 4, taskId: 'K4', finalOutcome: 'SUCCESS', taskType: 'FEATURE', recoveryStrategies: ['STRICT_EXECUTION_ONLY'], failureFingerprints: ['fp-y'], durationMs: 120000 }),
  ];
  const stats = h.recoveryStrategyStats(hist);
  ok(stats.COMPACT_PROMPT, 'K1 compact recorded');
  eq(stats.COMPACT_PROMPT.attempts, 2, 'K2 attempts counted');
  eq(stats.COMPACT_PROMPT.successes, 1, 'K3 successes counted');
  const rec = h.recommendRecovery('fp-x', hist);
  eq(rec.recommendation, 'COMPACT_PROMPT', 'K4 best strategy for fp-x');
  ok(rec.candidates.filter((c) => c.strategy === 'DIRECT_RETRY').length === 1, 'K5 candidate enumerated');
  const none = h.recommendRecovery('fp-unknown', hist);
  eq(none.recommendation, 'DIRECT_RETRY', 'K6 no evidence -> direct retry');
  eq(none.evidence, 'no history for this fingerprint', 'K7 honest evidence');
}

// ---------------------------------------------------------------------------
// L. Storage: record -> load round trip; corrupt lines isolated.
// ---------------------------------------------------------------------------
{
  const f = join(TMP, 'histL.jsonl');
  h.recordCycle(f, { kind: 'cycle', cycle: 1, taskId: 'L1', finalOutcome: 'SUCCESS', taskType: 'BUG_FIX' });
  h.recordCycle(f, { kind: 'cycle', cycle: 2, taskId: 'L2', finalOutcome: 'CRASH' });
  let loaded = h.loadHistory(f);
  eq(loaded.cycles.length, 2, 'L1 two cycles loaded');
  eq(loaded.corrupt, 0, 'L2 no corruption');
  writeFileSync(f, '{corrupt-json-line\n', { flag: 'a' });
  loaded = h.loadHistory(f);
  eq(loaded.cycles.length, 2, 'L3 corrupt line isolated');
  eq(loaded.corrupt, 1, 'L4 corrupt counted');
  eq(loaded.partialHistory, true, 'L5 PARTIAL_HISTORY flag');
  // sorted keys => deterministic diffs
  const l1 = h.loadHistory(f);
  const l2 = h.loadHistory(f);
  eq(JSON.stringify(l1.cycles), JSON.stringify(l2.cycles), 'L6 deterministic reload');
}

// ---------------------------------------------------------------------------
// M. Metrics aggregation.
// ---------------------------------------------------------------------------
{
  const f = join(TMP, 'histM.jsonl');
  h.recordCycle(f, { kind: 'cycle', cycle: 1, taskType: 'BUG_FIX', finalOutcome: 'SUCCESS', filesChanged: 3, commits: 1, durationMs: 600000, flags: ['high'] });
  h.recordCycle(f, { kind: 'cycle', cycle: 2, taskType: 'FEATURE', finalOutcome: 'SUCCESS', filesChanged: 2, commits: 1, durationMs: 300000 });
  h.recordCycle(f, { kind: 'cycle', cycle: 3, taskType: 'BUG_FIX', finalOutcome: 'CRASH', envFailure: true });
  const m = h.metrics(h.loadHistory(f).cycles);
  eq(m.cycles, 3, 'M1 total');
  eq(m.successCount, 2, 'M2 successes');
  ok(Math.abs(m.successRate - 0.667) < 0.01, 'M3 success rate');
  eq(m.crashes, 1, 'M4 crash count');
  eq(m.byOutcome.SUCCESS_BUG_FIX, 1, 'M5 per-outcome');
  eq(m.highValueCycles, 1, 'M6 high value cycles');
  eq(m.lowValueActivity, 0, 'M7 no low-value flagged');
  ok(m.avgDurationMs > 100000, 'M8 avg duration');
}

// ---------------------------------------------------------------------------
// N. Policy versioning / rollback / bounds.
// ---------------------------------------------------------------------------
{
  const f = join(TMP, 'policyN.json');
  const shape = h.policyFileShape({ DISCOVERY: 1800000, IMPLEMENTING: 14400000 }, hBounds);
  h.writePolicy(f, shape);
  let p = h.readPolicy(f);
  eq(p.policyVersion, 1, 'N1 initial version');
  const applied = h.applyPolicyChange(p, { phase: 'DISCOVERY', newMs: 3000000, reason: 'test', evidence: 'backtest' });
  eq(applied.ok, true, 'N2 applied');
  eq(applied.policy.policyVersion, 2, 'N3 version bumped');
  eq(applied.policy.phases.DISCOVERY, 3000000, 'N4 phase updated');
  eq(applied.policy.changeStore?.length ?? applied.policy.changes.length, 1, 'N5 audit trail');
  h.writePolicy(f, applied.policy);
  const roll = h.rollbackPolicy(h.readPolicy(f));
  eq(roll.ok, true, 'N6 rollback ok');
  eq(roll.policy.policyVersion, 1, 'N7 rollback version');
  eq(roll.policy.phases.DISCOVERY, 1800000, 'N8 phase restored');
  // bounds
  const bad = h.applyPolicyChange(shape, { phase: 'DISCOVERY', newMs: 100, reason: 'x' });
  eq(bad.ok, false, 'N9 out-of-bounds rejected');
  eq(bad.status, 'REJECTED_OUT_OF_BOUNDS', 'N10 rejection status');
  // no rollback below 1
  const noPrev = h.rollbackPolicy(shape);
  eq(noPrev.ok, false, 'N11 cannot roll back v1');
  eq(noPrev.status, 'NO_PREVIOUS', 'N12 status');
}

// ---------------------------------------------------------------------------
// O. CLI bridge end-to-end (isolated files via env).
// ---------------------------------------------------------------------------
{
  writeFileSync(HIST, '');
  try { rmSync(POL, { force: true }); } catch { }
  const r1 = cliRun(['history', '--record', '--cycle', '1', '--task', 'O1', '--ce', 'CE', '--task-type', 'BUG_FIX', '--duration-s', '600', '--commits', '1', '--files-changed', '3', '--verdicts', 'SUCCESS', '--outcome', 'SUCCESS', '--prompt-size', '9000']);
  eq(r1.ok, true, 'O1 record via CLI');
  eq(r1.outcome, 'SUCCESS_BUG_FIX', 'O2 classified via CLI');
  const r2 = cliRun(['history', '--record', '--cycle', '2', '--task', 'O2', '--ce', 'CE', '--task-type', 'FEATURE', '--duration-s', '300', '--commits', '1', '--files-changed', '2', '--verdicts', 'SUCCESS', '--outcome', 'SUCCESS', '--prompt-size', '10000']);
  eq(r2.ok, true, 'O3 record 2');
  const met = cliRun(['metrics']);
  eq(met.ok, true, 'O4 metrics ok');
  eq(met.metrics.cycles, 2, 'O5 metrics count');
  const rec = cliRun(['recommend']);
  eq(rec.ok, true, 'O6 recommend ok');
  eq(rec.taskRecommendation.recommendation, 'DISCOVERY', 'O7 no TODO -> discovery');
  ok(rec.timeoutRecommendations.DISCOVERY.status === 'INSUFFICIENT_EVIDENCE', 'O8 <10 samples blocked via CLI');
  const tune = cliRun(['tune']);
  eq(tune.mode, 'recommend', 'O9 tune default = recommend');
  eq(tune.appliedChanges.length, 0, 'O10 no auto-apply by default');
  const pol = cliRun(['policy']);
  eq(pol.ok, true, 'O11 policy show');
  const list = cliRun(['history', '--list', '--limit', '1']);
  eq(list.cycles.length, 1, 'O12 history list limit');
  const apply = cliRun(['policy', '--phase', 'DISCOVERY', '--new-ms', '3000000', '--reason', 'cli-test', '--evidence', 'e2e', '--apply']);
  eq(apply.ok, true, 'O13 policy apply via CLI');
  eq(apply.policyVersion, 2, 'O14 version 2');
  const rb = cliRun(['policy', '--rollback']);
  eq(rb.ok, true, 'O15 rollback via CLI');
  eq(rb.policyVersion, 1, 'O16 back to v1');
}

// ---------------------------------------------------------------------------
// Performance: large history stays fast (mission §36 bounded).
// ---------------------------------------------------------------------------
{
  const f = join(TMP, 'histPerf.jsonl');
  const n = 3000;
  let payload = '';
  for (let i = 1; i <= n; i++) {
    payload += JSON.stringify({ kind: 'cycle', cycle: i, taskId: 'perf-' + (i % 20), taskType: i % 3 === 0 ? 'BUG_FIX' : 'FEATURE', finalOutcome: i % 7 === 0 ? 'CRASH' : 'SUCCESS', durationMs: 600000 + (i * 1000), filesChanged: 2, commits: 1, phaseDurations: { DISCOVERY: 300000 + i, IMPLEMENTING: 1800000 + i } }) + '\n';
  }
  writeFileSync(f, payload);
  const t0 = Date.now();
  const loaded = h.loadHistory(f);
  const loadMs = Date.now() - t0;
  eq(loaded.cycles.length, n, 'P1 loaded all');
  const t1 = Date.now();
  const m = h.metrics(loaded.cycles);
  const mMs = Date.now() - t1;
  eq(m.cycles, n, 'P2 metrics over large set');
  assert(mMs < 2000, 'P3 metrics < 2s (' + mMs + 'ms)');
  assert(loadMs < 3000, 'P4 load < 3s (' + loadMs + 'ms)');
  const t2 = Date.now();
  const rec = h.recommendRecovery('no-fp', loaded.cycles);
  assert(Date.now() - t2 < 1000, 'P5 recovery scan < 1s');
  eq(rec.recommendation, 'DIRECT_RETRY', 'P6 graceful with no match');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = pass + fail;
console.log(`CE-070 history-learning: ${pass}/${total} PASS${fail ? `, ${fail} FAIL` : ''}`);
if (fail) {
  console.error('Failures:');
  for (const f of failures) console.error('  - ' + f);
  process.exitCode = 1;
}