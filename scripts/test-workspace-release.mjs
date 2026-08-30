#!/usr/bin/env node
/**
 * test:workspace:release — puerta de release para Toolisto Workspace
 *
 * Flujo:
 *   1. Build limpio canónico (scripts/generate-seo-pages.mjs --production)
 *      que copia workspace/ -> dist/workspace/ como artefacto desplegable.
 *   2. Verificación source -> dist (scripts/verify-workspace-sync.mjs).
 *   3. Suites de línea base (Node + E2E real, sin mocks).
 *   4. Manifest de evidencia vinculado al SHA.
 *
 * Prohibido: `|| true`, thresholds relajados, modificar fixtures.
 * Cualquier FAIL devuelve exit 1.
 */
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit', 'release-gate');

let failed = false;
const results = [];

function run(label, cmd, args, opts = {}) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf-8', ...opts });
  const ok = res.status === 0;
  if (!ok) failed = true;
  results.push({ label, ok, exit: res.status });
  return ok;
}

function shaOfFile(p) {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
  catch { return null; }
}

function getHead() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim(); }
  catch { return 'unknown'; }
}

const head = getHead();
console.log('=== Toolisto Workspace — Release Gate ===');
console.log(`HEAD: ${head}\n`);

mkdirSync(ARTIFACTS, { recursive: true });

// 1. Build canónico limpio (el Workspace funcional siempre se incluye en dist)
const buildOk = run('Build limpio (generate-seo-pages --production)', 'node',
  ['scripts/generate-seo-pages.mjs', '--production']);

// 2. source -> dist
const syncOk = run('Verificación source -> dist (workspace)', 'node', ['scripts/verify-workspace-sync.mjs']);

// 3. Suites
run('workspace-test', 'node', ['tests/workspace/workspace-test.mjs']);
run('phase3a-test', 'node', ['tests/workspace/phase3a-test.mjs']);
run('phase3b-test', 'node', ['tests/workspace/phase3b-test.mjs']);
run('phase11-audit', 'node', ['tests/workspace/phase11-audit.mjs']);
run('ocr-source-selection', 'node', ['tests/workspace/ocr-source-selection.mjs']);
run('phase3c-star-flow E2E (OCR real)', 'node', ['tests/workspace/phase3c-star-flow.spec.mjs'], {
  env: { ...process.env, E2E_PORT: '8082' },
});
run('csv-export-bom E2E (UTF-8 BOM)', 'node', ['tests/workspace/csv-export-bom-e2e.mjs'], {
  env: { ...process.env, E2E_PORT: '8082' },
});
run('engine-idle-release (memoria Tesseract)', 'node', ['tests/workspace/engine-idle-release-test.mjs'], {
  env: { ...process.env, E2E_PORT: '8082' },
});
run('workflow-export-md (Markdown/texto plano)', 'node', ['tests/workspace/workflow-export-md-test.mjs']);
run('text-to-document (Markdown -> bloques, CE-064)', 'node', ['tests/workspace/text-to-document-test.mjs']);
run('doc-to-table-multispace (tablas OCR multiespacio, CE-071)', 'node', ['tests/workspace/doc-to-table-multispace-test.mjs']);
run('chart-series-locale (tabla -> grafico con parser canonico, CE-072)', 'node', ['tests/workspace/chart-series-locale-test.mjs']);
// Suites del motor de flujos / parser / planificador (CE-065): antes solo
// pasaban quitando los imports por VM pero crasheaban en aislamiento por
// dependencias sin resolver (WORKFLOW_DEFINITION_VERSION, createExecutionResources).
// Ahora incluyen schema-versions.js y execution-resources.js y se registran en el
// gate para que queden protegidas contra regresion en vez de ser deuda oculta.
run('instruction-parser (intenciones de texto libre)', 'node', ['tests/workspace/instruction-parser-test.mjs']);
run('workflow-engine (motor de flujos, recursos de ejecución)', 'node', ['tests/workspace/workflow-engine-test.mjs']);
run('instruction-planner (planificador de flujos)', 'node', ['tests/workspace/instruction-planner-test.mjs']);
run('workflow-ui (resultados al Workspace, CE-047/048/049)', 'node', ['tests/workspace/workflow-ui-test.mjs'], {
  env: { ...process.env, E2E_PORT: '8082' },
});
// CE-050 hereda el flujo estrella: una captura (imagen escaneada) del proyecto
// entra por referencia al constructor de flujos y llega hasta el OCR real.
run('capture-flow-chain E2E (captura -> flujo -> OCR, CE-050)', 'node', ['tests/workspace/capture-flow-chain-e2e.mjs'], {
  env: { ...process.env, E2E_PORT: '8082' },
});
run('dist-workspace-smoke (validación del artefacto desplegado)', 'node', ['tests/dist-workspace-smoke.mjs'], {
  env: { ...process.env, E2E_PORT: '8082' },
});
run('autosave-lock (serialization lock, CE-057)', 'node', ['tests/workspace/autosave-lock-test.mjs']);
run('cross-entity-integrity (per-entity locks, _writeSeq, flush, CE-058)', 'node', ['tests/workspace/cross-entity-integrity-test.mjs']);
run('review-status-persistence (table review status lock-based, CE-058)', 'node', ['tests/workspace/review-status-persistence-test.mjs']);
run('persistence-sequence-cert (_writeSeq monotonic invariant, CE-058)', 'node', ['tests/workspace/persistence-sequence-cert.mjs']);
run('persistence-adversarial-audit (concurrency, stale-write, mutation-after-enqueue, CE-058)', 'node', ['tests/workspace/persistence-adversarial-audit.mjs']);
run('persistence-lifecycle-audit (fire-and-forget, destroy-recreate, nav stress, perf, CE-058)', 'node', ['tests/workspace/persistence-lifecycle-audit.mjs']);
run('storage-failure-injection (IDB write failure, quota, closed DB, CE-059)', 'node', ['tests/workspace/storage-failure-injection.mjs']);
run('storage-recovery-lifecycle (delete/resurrection, destroy/recreate, CE-059)', 'node', ['tests/workspace/storage-recovery-lifecycle.mjs']);
run('storage-multicontext-migration (multi-tab _writeSeq, schema, legacy records, CE-059)', 'node', ['tests/workspace/storage-multicontext-migration.mjs']);
run('storage-rejection-perf (unhandled rejection, atomicity, perf, CE-059)', 'node', ['tests/workspace/storage-rejection-perf.mjs']);
run('multi-tab-concurrency (different/same entity, _writeSeq, stale overwrite, CE-060)', 'node', ['tests/workspace/multi-tab-concurrency.mjs']);
run('stale-delete-lifecycle (delete vs stale, recreate, reload, background tab, CE-060)', 'node', ['tests/workspace/stale-delete-lifecycle.mjs']);
run('runtime-isolation-review (review/chart cross-tab, versionchange, singletons, CE-060)', 'node', ['tests/workspace/runtime-isolation-review.mjs']);
run('cross-store-integrity (cascade, orphan, import atomicity, CE-061)', 'node', ['tests/workspace/cross-store-integrity.mjs']);
run('storage-surface-audit (LWW stores without _writeSeq, CE-061)', 'node', ['tests/workspace/storage-surface-audit.mjs']);
run('id-collision-serialization (ID uniqueness, roundtrip, localStorage, CE-061)', 'node', ['tests/workspace/id-collision-serialization.mjs']);
run('document-editor-data-loss (HTML export table/chart + autosave estructural, CE-066)', 'node', ['tests/workspace/document-editor-data-loss-test.mjs']);

// 4. Manifest de evidencia
const evidence = {
  sha: head,
  fecha: new Date().toISOString(),
  build: { ok: buildOk, exit: buildOk ? 0 : 1 },
  sync: { ok: syncOk, exit: syncOk ? 0 : 1 },
  suites: results.filter(r => r.label !== 'Build limpio (generate-seo-pages --production)' && r.label !== 'Verificación source -> dist (workspace)'),
  hashes: {
    'workspace/workspace.js': shaOfFile(join(ROOT, 'workspace', 'workspace.js')),
    'dist/workspace/workspace.js': shaOfFile(join(ROOT, 'dist', 'workspace', 'workspace.js')),
  },
  total: results.filter(r => r.label !== 'Build limpio (generate-seo-pages --production)' && r.label !== 'Verificación source -> dist (workspace)').length,
  fail: results.filter(r => !r.ok).length,
};
const manifestPath = join(ARTIFACTS, `release-gate-${head}.json`);
writeFileSync(manifestPath, JSON.stringify(evidence, null, 2), 'utf-8');

console.log(`\n=== Resumen ===`);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}: ${r.label} (exit ${r.exit})`);
console.log(`Manifest: ${manifestPath}`);
console.log(failed ? '\nRELEASE GATE: FALLO' : '\nRELEASE GATE: OK');
process.exit(failed ? 1 : 0);
