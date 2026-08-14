// production-tool-coverage.mjs — cierre verificable de la auditoría funcional pública.
// Vincula cada herramienta habilitada con evidencia de una suite que verificó su output.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = join(root, 'artifacts', 'deep-audit', 'toolisto');
const tools = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8'));
let failures = 0;
const checks = [];

function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  if (pass) console.log(`  PASS: ${name}${detail ? ` (${detail})` : ''}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? ` (${detail})` : ''}`); }
}

function resultOf(evidence) {
  const totals = evidence.totals || evidence;
  return { passed: totals.passed, failed: totals.failed, total: totals.total };
}

console.log('=== Auditoría de cobertura funcional de producción ===\n');
check('Catálogo contiene exactamente 167 herramientas', tools.length === 167, String(tools.length));
const enabled = tools.filter((tool) => tool.enabled);
check('Las 167 herramientas del catálogo están habilitadas', enabled.length === 167, String(enabled.length));

const evidenceFiles = readdirSync(evidenceDir)
  .filter((file) => /^TLT-certify-.*-evidence\.json$/.test(file));
const certifiedBy = new Map();

for (const file of evidenceFiles) {
  const evidence = JSON.parse(readFileSync(join(evidenceDir, file), 'utf8'));
  const covered = evidence.tools || (evidence.tool ? [evidence.tool] : []);
  const result = resultOf(evidence);
  const passed = Number.isInteger(result.passed) && result.passed > 0;
  const failed = result.failed === 0;
  check(`${file}: resultado aprobado`, passed && failed,
    `${result.passed ?? 'sin passed'} PASS / ${result.failed ?? 'sin failed'} FAIL`);
  for (const toolId of covered) {
    if (!certifiedBy.has(toolId)) certifiedBy.set(toolId, []);
    certifiedBy.get(toolId).push({ file, approved: passed && failed });
  }
}

const uncovered = enabled.filter((tool) => !certifiedBy.has(tool.toolId));
const uncertified = enabled.filter((tool) =>
  certifiedBy.has(tool.toolId) && !certifiedBy.get(tool.toolId).some((entry) => entry.approved));
check('Cada herramienta habilitada tiene evidencia funcional', uncovered.length === 0,
  uncovered.map((tool) => tool.id).join(', ') || '167/167');
check('Cada evidencia asignada a una herramienta habilitada aprobó', uncertified.length === 0,
  uncertified.map((tool) => tool.id).join(', ') || '167/167');

const report = {
  suite: 'production-tool-coverage',
  generatedAt: new Date().toISOString(),
  catalogTools: tools.length,
  enabledTools: enabled.length,
  evidenceFiles: evidenceFiles.length,
  coveredTools: enabled.length - uncovered.length,
  uncovered: uncovered.map((tool) => tool.id),
  uncertified: uncertified.map((tool) => tool.id),
  total: checks.length,
  passed: checks.filter((check) => check.pass).length,
  failed: failures,
  checks,
};
const reportPath = join(evidenceDir, 'TLT-production-tool-coverage-evidence.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeEvidence(reportPath, report);
console.log(`\nEvidencia guardada: ${reportPath}`);
console.log(`=== Resultado: ${report.passed} PASS, ${failures} FAIL ===`);
process.exit(failures ? 1 : 0);
