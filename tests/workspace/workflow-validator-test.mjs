#!/usr/bin/env node
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const valCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-validator.js'), 'utf8');

const combined = regCode.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '')
  + '\n'
  + valCode.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');

const sandbox = { console, Map, Array, Object, Error, Date, JSON, Math, Number, window: null };
const script = new vm.Script(combined + '\nglobalThis.createOperationRegistry = createOperationRegistry;\nglobalThis.createWorkflowValidator = createWorkflowValidator;');
script.runInNewContext(sandbox);
const createOperationRegistry = sandbox.createOperationRegistry;
const createWorkflowValidator = sandbox.createWorkflowValidator;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Workflow Validator Tests ===\n');

const registry = createOperationRegistry();
registry.register({
  id: 'image.resize', name: 'Resize', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: false,
  destructive: false, execute() {},
  optionSchema: { width: { required: true } },
});
registry.register({
  id: 'image.rotate', name: 'Rotate', description: 'x', category: 'image',
  inputKinds: ['image'], outputKind: 'image', supportsBatch: true, supportsCancellation: false,
  destructive: false, execute() {},
  optionSchema: { angle: { required: true } },
});
registry.register({
  id: 'text.export', name: 'Export Text', description: 'x', category: 'text',
  inputKinds: ['text'], outputKind: 'text', supportsBatch: false, supportsCancellation: false,
  destructive: false, execute() {},
});

const validator = createWorkflowValidator(registry);

function makeMock(inputIds, steps) {
  return {
    getInputIds: () => inputIds.slice(),
    getActiveSteps: () => steps.filter(s => s.enabled !== false).map(s => ({ ...s })),
  };
}

const inputsMap = {
  'img1': { kind: 'image', name: 'foto.jpg' },
  'img2': { kind: 'image', name: 'foto2.png' },
  'txt1': { kind: 'text', name: 'texto.txt' },
};

check('No inputs rejected', !validator.validateWorkflow(makeMock([], [{ operationId: 'image.resize', enabled: true, options: { width: 800 } }]), inputsMap).valid);
check('No steps rejected', !validator.validateWorkflow(makeMock(['img1'], []), null).valid);
check('Null workflow rejected', !validator.validateWorkflow(null, null).valid);
check('Non-existent operation rejected', !validator.validateWorkflow(makeMock(['img1'], [{ operationId: 'nonexistent', enabled: true, options: {} }]), inputsMap).valid);
check('Incompatible input rejected', !validator.validateWorkflow(makeMock(['txt1'], [{ operationId: 'image.resize', enabled: true, options: { width: 800 } }]), inputsMap).valid);
check('Missing required options rejected', !validator.validateWorkflow(makeMock(['img1'], [{ operationId: 'image.resize', enabled: true, options: {} }]), inputsMap).valid);
check('Batch not supported rejected', !validator.validateWorkflow(makeMock(['img1', 'img2'], [{ operationId: 'text.export', enabled: true, options: {} }]), inputsMap).valid);
check('Valid workflow accepted', validator.validateWorkflow(makeMock(['img1'], [{ operationId: 'image.resize', enabled: true, options: { width: 800 } }]), inputsMap).valid);
check('Has resolved steps', validator.validateWorkflow(makeMock(['img1'], [{ operationId: 'image.resize', enabled: true, options: { width: 800 } }]), inputsMap).resolvedSteps.length === 1);
check('Has estimated work', typeof validator.validateWorkflow(makeMock(['img1'], [{ operationId: 'image.resize', enabled: true, options: { width: 800 } }]), inputsMap).estimatedWork === 'object');
check('Estimated work count', validator.validateWorkflow(makeMock(['img1', 'img2'], [
  { operationId: 'image.resize', enabled: true, options: { width: 800 } },
  { operationId: 'image.rotate', enabled: true, options: { angle: 90 } },
]), inputsMap).estimatedWork.totalJobs === 4);

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);
