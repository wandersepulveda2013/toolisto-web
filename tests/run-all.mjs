import { execSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [
  { name: 'Audit Count', cmd: 'node scripts/audit-count.mjs' },
  { name: 'Slug Audit', cmd: 'node test-slug-audit.mjs' },
  { name: 'Alias Restrictions', cmd: 'node tests/alias-restrictions-test.js' },
  { name: 'Batch 1', cmd: 'node tests/batch1-functional-test.js' },
  { name: 'Batch 2', cmd: 'node tests/batch2-functional-test.js' },
  { name: 'Batch 3', cmd: 'node tests/batch3-functional-test.js' },
  { name: 'Comprehensive', cmd: 'node tests/comprehensive-test.js' },
  { name: 'Homepage Audit', cmd: 'node tests/homepage-audit-test.js' },
  { name: 'QA', cmd: 'node tests/qa-test.js' },
  { name: 'SEO', cmd: 'node tests/seo-functional-test.js' },
  { name: 'SEO Audit', cmd: 'node scripts/seo-audit.mjs' },
  { name: 'SEO Production Audit', cmd: 'node tests/seo-production-audit.mjs' },
  { name: 'Embed PDF', cmd: 'node tests/test-embedpdf.js' },
  { name: 'Lazy Dependencies', cmd: 'node tests/lazy-dependencies.mjs' },
  { name: 'PWA Offline', cmd: 'node tests/pwa-offline.mjs' },
  { name: 'Responsive Matrix', cmd: 'node tests/responsive-matrix.mjs' },
  { name: 'Accessibility Audit', cmd: 'node tests/accessibility-audit.mjs' },
  { name: 'Public Network Negative', cmd: 'node tests/public-site-network-negative.mjs' },
  { name: 'Public Security Audit', cmd: 'node tests/public-site-security-audit.mjs' },
  { name: 'Dead Code Audit', cmd: 'node tests/dead-code-audit.mjs' },
  { name: 'Root Structure Audit', cmd: 'node tests/root-structure-audit.mjs' },
  { name: 'Deployment Guide Audit', cmd: 'node tests/deployment-guide-audit.mjs' },
  { name: 'Toolisto Domain Gate', cmd: 'node tests/toolisto-domain-gate.mjs' },
  { name: 'Evidence Determinism', cmd: 'node tests/evidence-determinism.mjs' },
  { name: 'Image Interactive', cmd: 'node tests/gate-e2e-image-tools.mjs' },
  { name: 'Enhance Scanned Document', cmd: 'node tests/gate-e2e-enhance-scanned-document.mjs' },
  { name: 'Word Family', cmd: 'node tests/gate-e2e-word-tools.mjs' },
  { name: 'EPUB Family', cmd: 'node tests/gate-e2e-epub-tools.mjs' },
  { name: 'PDF + Misc', cmd: 'node tests/gate-e2e-pdf-misc-tools.mjs' },
  { name: 'PDF Encrypt', cmd: 'node tests/gate-e2e-pdf-encrypt.mjs' },
  { name: 'OCR PDF Architecture', cmd: 'node tests/pdf-ocr-architecture.mjs' },
  { name: 'Audio + Video', cmd: 'node tests/gate-e2e-av-tools.mjs' },
  { name: 'OCR-PDF', cmd: 'node tests/gate-e2e-ocr-pdf-tools.mjs' },
  { name: 'Text Family', cmd: 'node tests/gate-e2e-text-tools.mjs' },
  { name: 'Data Family', cmd: 'node tests/gate-e2e-data-tools.mjs' },
  { name: 'File Family', cmd: 'node tests/gate-e2e-file-tools.mjs' },
  { name: 'QR Family', cmd: 'node tests/gate-e2e-qr-tools.mjs' },
  { name: 'Structure Family', cmd: 'node tests/gate-e2e-structure-tools.mjs' },
  { name: 'Calc Family', cmd: 'node tests/gate-e2e-calc-tools.mjs' },
  { name: 'Spreadsheet Family', cmd: 'node tests/gate-e2e-spreadsheet-tools.mjs' },
  { name: 'Image Converters', cmd: 'node tests/gate-e2e-image-converters.mjs' },
  { name: 'Docs Extras', cmd: 'node tests/gate-e2e-docs-extras.mjs' },
  { name: 'File Family Extra', cmd: 'node tests/gate-e2e-file-family-tools.mjs' },
  { name: 'Production Tool Coverage', cmd: 'node tests/production-tool-coverage.mjs' },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const test of tests) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Ejecutando: ${test.name}`);
  console.log('='.repeat(60));
  try {
    // Timeout por suite: las suites E2E de navegador (gate-e2e-*.mjs) lanzan Chromium
    // varias veces con descargas reales; ~117s medidos en QR Family. 300s es margen
    // contra cuelgues, no para ocultar fallos: cada suite auto-informa y sale no-cero.
    execSync(test.cmd, { cwd: __dirname + '/..', stdio: 'inherit', timeout: 300000 });
    passed++;
    console.log(`✓ ${test.name}: PASÓ`);
  } catch (e) {
    failed++;
    failures.push(test.name);
    console.log(`✗ ${test.name}: FALLÓ`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`RESUMEN: ${passed} pasaron, ${failed} fallaron de ${tests.length}`);
console.log('='.repeat(60));

if (failures.length > 0) {
  console.log(`\nFallos: ${failures.join(', ')}`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas pasaron.');
  process.exit(0);
}
