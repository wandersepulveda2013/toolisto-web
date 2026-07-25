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
  { name: 'Embed PDF', cmd: 'node tests/test-embedpdf.js' },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const test of tests) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Ejecutando: ${test.name}`);
  console.log('='.repeat(60));
  try {
    execSync(test.cmd, { cwd: __dirname + '/..', stdio: 'inherit', timeout: 60000 });
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
