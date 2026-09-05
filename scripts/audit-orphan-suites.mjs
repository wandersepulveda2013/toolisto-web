#!/usr/bin/env node
/**
 * CE-125 — Census guard: todo archivo .mjs en tests/workspace debe estar
 * registrado en el release gate o tener una razon documentada en DEFERRED.
 *
 * Previene la deuda silenciosa de tests huerfanos (regresion invisible):
 * si alguien anade una suite nueva sin registrarla (y sin whitelist),
 * este guard falla el gate.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GATE = join(ROOT, 'scripts', 'test-workspace-release.mjs');
const DIR = join(ROOT, 'tests', 'workspace');

const DEFERRED_REASONS = {
  'idb-helpers.mjs': 'helper (no suite: no ejecuta tests, se importa desde otras suites)',
  'ocr-word-confidence.mjs': 'diagnostico OCR (medicion por palabra, no gate)',
  'ocr-reliability-diagnostic.mjs': 'diagnostico OCR E2E (CE-051), no gate',
  'ocr-difficult-measurement.mjs': 'diagnostico OCR fixture dificil (medicion honesta, no gate)',
  'perspective-bench.mjs': 'benchmark de coste de perspectiva (CE-014), rendimiento variable, no gate',
  'playwright-render.mjs': 'herramienta de render/screenshots para revision visual, no gate',
  'phase3-integrity-test.mjs': 'E2E OCR real pesado (>120s), ejecucion manual/de ciclo dedicado',
  'phase4-integrity-test.mjs': 'E2E pesado (integridad referencial), ejecucion manual/de ciclo dedicado',
  'phase4-migrations-test.mjs': 'E2E pesado (migraciones IndexedDB), ejecucion manual/de ciclo dedicado',
  'phase5-bundle-trust-test.mjs': 'E2E pesado (confianza export/import), ejecucion manual/de ciclo dedicado',
  'phase6-network-negative-test.mjs': 'E2E pesado (prueba negativa de red), ejecucion manual/de ciclo dedicado',
  'step8-validation.mjs': '10 corridas OCR real (>120s), ejecucion manual/de ciclo dedicado',
  'production-validation.mjs': 'exige servidor externo en :8080, no autocontenido para el gate',
};

const gateSrc = readFileSync(GATE, 'utf8');
const registered = new Set(
  [...gateSrc.matchAll(/tests\/workspace\/([^'"\]\s]+\.mjs)/g)].map(m => m[1])
);

const files = readdirSync(DIR).filter(f => f.endsWith('.mjs')).sort();
const orphans = files.filter(f => !registered.has(f));
const unexplained = orphans.filter(f => !DEFERRED_REASONS[f]);

console.log(`Censo tests/workspace: ${files.length} archivos, ${files.length - orphans.length} registradas en el gate, ${orphans.length} sin registrar (deferidas documentadas).`);

if (unexplained.length > 0) {
  console.error('\nSuites sin registrar SIN razon documentada (deuda silenciosa):');
  for (const f of unexplained) console.error('  ' + f);
  console.error(`\nRegistralas en ${GATE} o anadelas a DEFERRED_REASONS con su por que.`);
  process.exit(1);
}

if (orphans.length > 0) {
  console.log('\nDeferidas (con razon):');
  for (const f of orphans) console.log(`  ${f} -> ${DEFERRED_REASONS[f]}`);
}

console.log('\nCensus guard CE-125: OK');