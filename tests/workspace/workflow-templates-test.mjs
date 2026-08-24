/**
 * AW-088: Workflow templates tests.
 * Verifies template definitions, lookup, and model integration.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadVm(relative, exportNames, deps = {}) {
  let source = read(relative)
    .replace(/^import\s+.*\s+from\s+['"].*['"];?\s*$/gm, '')
    .replace(/^export\s+(const|let|var)\s+/gm, 'var ')
    .replace(/^export\s+(function|class)\s+/gm, '$1 ')
    .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
  const context = {
    console, Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map, Promise,
    parseInt, parseFloat, URL, crypto, Blob,
    ...deps
  };
  vm.runInNewContext(source, context, { filename: relative });
  const result = {};
  for (const name of exportNames) { result[name] = context[name]; }
  return result;
}

const { WORKFLOW_TEMPLATES, getTemplateById, getTemplatesByCategory } = loadVm(
  'workspace/core/workflow-templates.js', ['WORKFLOW_TEMPLATES', 'getTemplateById', 'getTemplatesByCategory']
);
const schemaVersions = loadVm('workspace/core/schema-versions.js', ['WORKFLOW_DEFINITION_VERSION']);
const { createWorkflowModel } = loadVm('workspace/core/workflow-model.js', ['createWorkflowModel'], schemaVersions);

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

console.log('\n=== AW-088: Workflow templates ===');

check('templates is array', Array.isArray(WORKFLOW_TEMPLATES));
check('has at least 3 templates', WORKFLOW_TEMPLATES.length >= 3);

for (const tpl of WORKFLOW_TEMPLATES) {
  check(`template "${tpl.name}" has id`, typeof tpl.id === 'string' && tpl.id.length > 0);
  check(`template "${tpl.name}" has name`, typeof tpl.name === 'string' && tpl.name.length > 0);
  check(`template "${tpl.name}" has description`, typeof tpl.description === 'string');
  check(`template "${tpl.name}" has category`, typeof tpl.category === 'string');
  check(`template "${tpl.name}" has steps`, Array.isArray(tpl.steps) && tpl.steps.length > 0);
  for (const step of tpl.steps) {
    check(`template "${tpl.name}" step has operationId`, typeof step.operationId === 'string');
    check(`template "${tpl.name}" step has options`, typeof step.options === 'object');
  }
}

check('getTemplateById finds template', getTemplateById('template-ocr-to-doc') !== null);
check('getTemplateById returns null for unknown', getTemplateById('nonexistent') === null);

const imgTemplates = getTemplatesByCategory('Imagen');
check('getTemplatesByCategory filters', imgTemplates.every(t => t.category === 'Imagen'));
check('all category returns all', getTemplatesByCategory('all').length === WORKFLOW_TEMPLATES.length);
check('unknown category returns empty', getTemplatesByCategory('unknown').length === 0);

const tpl = getTemplateById('template-ocr-to-doc');
const model = createWorkflowModel();
model.setName(tpl.name);
for (const step of tpl.steps) {
  model.addStep(step.operationId, step.options);
}
check('template loads into model', model.getSteps().length === tpl.steps.length);
check('template steps match operationIds', model.getSteps()[0].operationId === tpl.steps[0].operationId);
check('template steps match options', model.getSteps()[0].options.language === 'spa');

console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
