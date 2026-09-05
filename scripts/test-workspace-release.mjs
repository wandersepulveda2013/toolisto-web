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
run('pdf-image-aspect (imagen ancha no se deforma en PDF, CE-073)', 'node', ['tests/workspace/pdf-image-aspect-test.mjs']);
run('pdf-table-wrap (celdas anchas y filas irregulares en PDF, CE-074)', 'node', ['tests/workspace/pdf-table-wrap-test.mjs']);
run('pdf-chart-overflow (barras de grafico siempre dentro del area, CE-075)', 'node', ['tests/workspace/pdf-chart-overflow-test.mjs']);
run('pdf-text-wrap (texto y titulos dentro del area, CE-076)', 'node', ['tests/workspace/pdf-text-wrap-test.mjs']);
run('pdf-chart-layout (grafico sin solape ni hueco por altura real, CE-077)', 'node', ['tests/workspace/pdf-chart-layout-test.mjs']);
run('pdf-image-fit (imagenes encajadas en la pagina, CE-078)', 'node', ['tests/workspace/pdf-image-fit-test.mjs']);
run('design-report-wysiwyg (preview pagina igual que el PDF, CE-087)', 'node', ['tests/workspace/design-report-wysiwyg-test.mjs']);
// Suites del camino PDF que eran HUERFANAS (solo se ejecutaban a mano en cada
// ciclo, nunca registradas ni en run-all ni en este gate): queden protegidas
// contra regresion en vez de ser cobertura silenciosa.
run('pdf-images-shared (normalizacion de imagenes PDF compartida, CE-037)', 'node', ['tests/workspace/pdf-images-shared-test.mjs']);
run('pdf-table-pagination (paginacion de tablas PDF)', 'node', ['tests/workspace/pdf-table-pagination-test.mjs']);
run('workflow-document-pdf (document.to-pdf end to end, tabla/grafico/imagen)', 'node', ['tests/workspace/workflow-document-pdf-test.mjs']);
// Suites del motor de flujos / parser / planificador (CE-065): antes solo
// pasaban quitando los imports por VM pero crasheaban en aislamiento por
// dependencias sin resolver (WORKFLOW_DEFINITION_VERSION, createExecutionResources).
// Ahora incluyen schema-versions.js y execution-resources.js y se registran en el
// gate para que queden protegidas contra regresion en vez de ser deuda oculta.
run('instruction-parser (intenciones de texto libre)', 'node', ['tests/workspace/instruction-parser-test.mjs']);
run('invoice-fields (extraccion de campos de factura, CE-081)', 'node', ['tests/workspace/invoice-fields-test.mjs']);
run('instruction-parser-dest-format (formato de destino prioritario en conversiones, CE-079)', 'node', ['tests/workspace/instruction-parser-dest-format-test.mjs']);
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
run('document-editor-persistence-race (persistencia adversarial con reload y LWW logico, CE-082)', 'node', ['tests/workspace/document-editor-persistence-race-test.mjs']);
run('doc-table-switch-flush (flush-on-switch al cambiar de doc/tabla misma vista, CE-090)', 'node', ['tests/workspace/doc-table-switch-flush-test.mjs']);
run('undo-corruption (undo conserva type de bloques + undo de tabla via topbar, CE-091)', 'node', ['tests/workspace/undo-corruption-test.mjs']);
run('boot-recovery (localStorage corrupto no rompe el arranque, CE-092)', 'node', ['tests/workspace/boot-recovery-test.mjs']);
run('bundle-reference-validation (referencias cruzadas del bundle validadas pre-write, CE-093)', 'node', ['tests/workspace/bundle-reference-validation-test.mjs']);
run('export-flush-fidelity (el export refleja la ultima edicion en memoria, CE-094)', 'node', ['tests/workspace/export-flush-fidelity-test.mjs']);
run('palette-localstorage-recovery (preferencias de la paleta a prueba de localStorage corrupto, CE-095)', 'node', ['tests/workspace/palette-localstorage-recovery-test.mjs']);
run('table-history-cap (historial de deshacer de tabla acotado, CE-095)', 'node', ['tests/workspace/table-history-cap-test.mjs']);
run('session-cleanup (limpieza de entidades borradas en ws:session, CE-096)', 'node', ['tests/workspace/session-cleanup-test.mjs']);
run('flow-snapshot-aliasing (snapshot de Flow clona nodos/edges, CE-097)', 'node', ['tests/workspace/flow-snapshot-aliasing-test.mjs']);
run('block-drop-reorder (el drop de bloques valida el indice, CE-098)', 'node', ['tests/workspace/block-drop-reorder-test.mjs']);
run('block-menu-listener (el menu de bloques desengancha su listener, CE-099)', 'node', ['tests/workspace/block-menu-listener-test.mjs']);
run('undo-clone-once (el historial de undo clona el snapshot una sola vez, CE-100)', 'node', ['tests/workspace/undo-clone-once-test.mjs']);
run('table-csv-escape (exportTableCSV escapa headers y coacciona celdas, CE-101)', 'node', ['tests/workspace/table-csv-escape-test.mjs']);
run('query-date-to-iso (detect-type normaliza fechas sin corrimiento de zona horaria, CE-102)', 'node', ['tests/workspace/query-date-to-iso-test.mjs']);
run('div-by-zero-formula (la division por cero da #FORMULA, no escribe 0, CE-103)', 'node', ['tests/workspace/div-by-zero-formula-test.mjs']);
run('thumbnail-guard (createThumbnail guarda contra dimensiones degradadas 0x0, CE-104)', 'node', ['tests/workspace/thumbnail-guard-test.mjs']);
run('query-column-range-guard (choose/reorder-columns descartan indices fuera de rango, CE-105)', 'node', ['tests/workspace/query-column-range-guard-test.mjs']);
run('md-header-escape-and-replace (encabezados Markdown escapan pipe + replace-values find vacio no destruye, CE-106)', 'node', ['tests/workspace/md-header-escape-and-replace-test.mjs']);
run('formula-unary-and-aggregates (unario negativo en formulas + agregados ignoran celdas no numericas, CE-109)', 'node', ['tests/workspace/formula-unary-and-aggregates-test.mjs']);
run('table-sort-locale (orden de tablas usa parseLocaleNumber canonico, no ad-hoc, CE-110)', 'node', ['tests/workspace/table-sort-locale-test.mjs']);
run('document-export-md-lists (exportDocument Markdown no pierde listas ni imagenes, CE-111)', 'node', ['tests/workspace/document-export-md-lists-test.mjs']);
run('relations-null-guard (export/import no crashean con relation null, CE-112)', 'node', ['tests/workspace/relations-null-guard-test.mjs']);
run('flush-outgoing-view (flush del saliente guiado por prevView al navegar, CE-113)', 'node', ['tests/workspace/flush-outgoing-view-test.mjs']);
run('capture-history-dataurl (el undo ya no trunca dataUrl de capturas, CE-114)', 'node', ['tests/workspace/capture-history-dataurl-test.mjs']);
run('import-sourceid-remap (el import remapea el sourceId top-level de dashboard y query, CE-115)', 'node', ['tests/workspace/import-sourceid-remap-test.mjs']);
run('scanner-refs-in-guards (campos scanner en REF_SOURCE_FIELDS/REF_CONFIG_FIELDS, CE-117)', 'node', ['tests/workspace/scanner-refs-in-guards-test.mjs']);
run('jsonl-import-resilience (import JSONL resiliente a lineas malformadas, CE-118)', 'node', ['tests/workspace/jsonl-import-resilience-test.mjs']);
run('table-chart-oob-guard (tableChartData con <2 headers no crashea ni corrompe, CE-119)', 'node', ['tests/workspace/table-chart-oob-guard-test.mjs']);
run('swallowed-storage-errors (errores de storage ya no se tragan en silencio, CE-120)', 'node', ['tests/workspace/swallowed-storage-errors-test.mjs']);
run('dashboard-chart-category-zero (categoria 0 no cae en "Sin categoría", CE-121)', 'node', ['tests/workspace/dashboard-chart-category-zero-test.mjs']);
run('createPdfBlob-dead-code (createPdfBlob sin scaffolding muerto, mismo output PDF, CE-122)', 'node', ['tests/workspace/createPdfBlob-dead-code-test.mjs']);

// 3.b Rescate de suites huérfanas (CE-123): no estaban registradas en el gate
run('workflow-lifecycle (ciclo completo modelo/validación/ejecución, CE-123)', 'node', ['tests/workspace/workflow-lifecycle-test.mjs']);
run('workflow-persistence (CRUD/export/import/schema/history, CE-123)', 'node', ['tests/workspace/workflow-persistence-test.mjs']);
run('workflow-fase3-extended (AW-081..100 verificación profunda, CE-123)', 'node', ['tests/workspace/workflow-fase3-extended.mjs']);
run('workflow-fase3 (productización P1..P9, CE-123)', 'node', ['tests/workspace/workflow-fase3-e2e.mjs']);
run('workflow-templates (plantillas de flujo, CE-123)', 'node', ['tests/workspace/workflow-templates-test.mjs']);
run('instruction-assistant-ui (UI del asistente de flujos, CE-123)', 'node', ['tests/workspace/instruction-assistant-ui-test.mjs']);
run('workflow-model (modelo de flujos, CE-123)', 'node', ['tests/workspace/workflow-model-test.mjs']);
run('workflow-batch-scale (lotes y concurrencia acotada, CE-123)', 'node', ['tests/workspace/workflow-batch-scale-test.mjs']);
run('deep-regression (regresión profunda del Workspace, CE-123)', 'node', ['tests/workspace/deep-regression-test.mjs']);
run('session-recovery (recuperación de sesión, CE-123)', 'node', ['tests/workspace/session-recovery-test.mjs']);
run('operation-registry (registro de operaciones, CE-123)', 'node', ['tests/workspace/operation-registry-test.mjs']);
run('locale-parser (parseo numérico/fecha/separadores canónico, CE-123)', 'node', ['tests/workspace/locale-parser-test.mjs']);
run('innerhtml-structure (estructura innerHTML sin fugas, CE-123)', 'node', ['tests/workspace/innerhtml-structure-test.mjs']);
run('history-manager (gestor de historial, CE-123)', 'node', ['tests/workspace/history-manager-test.mjs']);
run('migration-compat (compatibilidad de migración, CE-123)', 'node', ['tests/workspace/migration-compat-test.mjs']);
run('workflow-security (seguridad de flujos, CE-123)', 'node', ['tests/workspace/workflow-security-test.mjs']);
run('workspace-storage (sesiones del workspace, CE-123)', 'node', ['tests/workspace/workspace-storage-test.mjs']);
run('concurrency (motor: concurrencia/cancelar/reintento, CE-123)', 'node', ['tests/workspace/concurrency-test.mjs']);
run('workflow-validator (validación de flujos, CE-123)', 'node', ['tests/workspace/workflow-validator-test.mjs']);
run('workflow-cancel-retry (cancelar/reintentar flujos, CE-123)', 'node', ['tests/workspace/workflow-cancel-retry-test.mjs']);
run('model-fk (integridad modelo de datos, CE-123)', 'node', ['tests/workspace/model-fk-test.mjs']);
run('job-queue (cola de trabajos, CE-123)', 'node', ['tests/workspace/job-queue-test.mjs']);
run('error-manager (gestor de errores, CE-123)', 'node', ['tests/workspace/error-manager-test.mjs']);
run('workflow-lifecycle-leak (sin fugas de listeners, CE-123)', 'node', ['tests/workspace/workflow-lifecycle-leak-test.mjs']);
run('tabular-text-parser (parser de texto tabular, CE-123)', 'node', ['tests/workspace/tabular-text-parser-test.mjs']);
run('encoding-audit (codificación workspace.js, CE-123)', 'node', ['tests/workspace/encoding-audit.mjs']);
run('phase3-wsp022-svg-security E2E (SVG no ejecuta scripts, CE-123)', 'node', ['tests/workspace/phase3-wsp022-svg-security-test.mjs']);
run('workflow-builder-a11y E2E (contrato ARIA/teclado del builder, CE-123)', 'node', ['tests/workspace/workflow-builder-a11y-test.mjs']);
run('tabular-detection E2E (detección tabular + botón Informe, CE-123)', 'node', ['tests/workspace/tabular-detection-test.mjs']);
run('workflow-chart E2E (cadena tabular -> gráfico -> PDF, CE-123)', 'node', ['tests/workspace/workflow-chart-e2e.mjs']);

// CE-124: E2E huerfanos rescatados de la DISCOVERY 19va ronda (runtime <30s, autocontenidos)
run('invoice-fields-e2e E2E (extracción de facturas en navegador con OCR real, CE-124)', 'node', ['tests/workspace/invoice-fields-e2e.mjs']);
run('pdf-image-embed-e2e E2E (imágenes JPEG/PNG/WebP embedidas en PDF, CE-124)', 'node', ['tests/workspace/pdf-image-embed-e2e.mjs']);
run('workflow-e2e E2E (flujos reales: batch, fallo parcial, cancelación, persistencia, resultados al Workspace, CE-124)', 'node', ['tests/workspace/workflow-e2e-test.mjs']);
run('instruction-e2e E2E (asistente de flujos: estructura, imports, recursos, CE-124)', 'node', ['tests/workspace/instruction-e2e-test.mjs']);
run('workspace-tabs-a11y E2E (contrato ARIA/teclado de tablists doc/tabla/query, CE-124)', 'node', ['tests/workspace/workspace-tabs-a11y-test.mjs']);
run('workspace-stability-e2e E2E (estabilidad: undo/redo, save indicator, toasts, navegación, CE-124)', 'node', ['tests/workspace/workspace-stability-e2e-test.mjs']);
run('lazy-capture-images-e2e E2E (lazy-load de imágenes de capturas con barrido de scroll determinista, CE-124)', 'node', ['tests/workspace/lazy-capture-images-e2e.mjs']);

// CE-125: censo de huérfanas con guard permanente (DISCOVERY 20ma ronda) + 1 suite rescatada
run('phase3a-manual-verification E2E (10 escenarios scanner + behavioral Canvas, CE-125)', 'node', ['tests/workspace/phase3a-manual-verification.mjs']);
run('orphan-suites-audit (censo: toda suite registrada o con razon documentada, CE-125)', 'node', ['scripts/audit-orphan-suites.mjs']);

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
