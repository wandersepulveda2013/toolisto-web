#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'workspace', 'core', 'workflow-model.js');
const code = readFileSync(SRC, 'utf8');

const body = code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const sandbox = { console, Map, Array, Object, Error, Date, JSON, Math, Number };
const fn = new Function('console', 'Map', 'Array', 'Object', 'Error', 'Date', 'JSON', 'Math', 'Number',
  body + '\nreturn createWorkflowModel;'
);
const createWorkflowModel = fn(console, Map, Array, Object, Error, Date, JSON, Math, Number);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Workflow Model Tests ===\n');

// 1. Create workflow
const wf = createWorkflowModel();
check('Create workflow has id', typeof wf.getId() === 'string');
check('Create workflow has name', wf.getName() === 'Nuevo flujo');
check('Get steps returns empty array', Array.isArray(wf.getSteps()) && wf.getSteps().length === 0);

// 2. Add step
const step1 = wf.addStep('image.resize', { width: 800 });
check('Add step returns step object', step1 && step1.id && step1.operationId === 'image.resize');
check('Steps length is 1', wf.getSteps().length === 1);

// 3. Add step at index
const step2 = wf.addStep('image.convert', { format: 'webp' }, 0);
check('Add step at index 0', wf.getSteps().length === 2);
check('Step at index 0 is convert', wf.getSteps()[0].operationId === 'image.convert');

// 4. Remove step
check('Remove step returns true', wf.removeStep(step2.id));
check('Steps length is 1 after remove', wf.getSteps().length === 1);

// 5. Remove non-existent step
check('Remove non-existent returns false', wf.removeStep('nonexistent') === false);

// 6. Move step
const s1 = wf.addStep('image.rotate', { angle: 90 });
const s2 = wf.addStep('image.enhance', {});
check('Move step returns true', wf.moveStep(s1.id, 2));
check('Moved step is at index 2', wf.getSteps()[2].operationId === 'image.rotate');

// 7. Move step invalid
check('Move to invalid index returns false', wf.moveStep(s1.id, -1) === false);
check('Move non-existent returns false', wf.moveStep('nonexistent', 0) === false);

// 8. Update step options
check('Update step options', wf.updateStep(s2.id, { options: { brightness: 1.5 } }));
check('Updated options reflected', wf.getStep(s2.id).options.brightness === 1.5);

// 9. Update non-existent step
check('Update non-existent returns false', wf.updateStep('nonexistent', {}) === false);

// 10. Disable/Enable step
check('Disable step', wf.disableStep(s1.id));
check('Disabled step not in active steps', wf.getActiveSteps().filter(s => s.id === s1.id).length === 0);
check('Disabled step still in all steps', wf.getSteps().filter(s => s.id === s1.id).length === 1);
check('Enable step', wf.enableStep(s1.id));
check('Enabled step back in active', wf.getActiveSteps().filter(s => s.id === s1.id).length === 1);

// 11. Clone workflow
const clone = wf.cloneWorkflow();
check('Clone has different id', clone.getId() !== wf.getId());
check('Clone has same step count', clone.getSteps().length === wf.getSteps().length);
check('Clone has copy suffix in name', clone.getName().includes('(copia)'));

// 12. Serialize
const serialized = wf.serializeWorkflow();
check('Serialized has id', typeof serialized.id === 'string');
check('Serialized has steps', Array.isArray(serialized.steps));
check('Serialized steps have no functions', !serialized.steps[0].execute);

// 13. Deserialize valid
const wf2 = createWorkflowModel();
check('Deserialize valid returns true', wf2.deserializeWorkflow(serialized));
check('Deserialized has same step count', wf2.getSteps().length === serialized.steps.length);
check('Deserialized has same id', wf2.getId() === serialized.id);

// 14. Reject corrupt workflow
check('Deserialize null returns false', wf2.deserializeWorkflow(null) === false);
check('Deserialize non-object returns false', wf2.deserializeWorkflow('string') === false);
check('Deserialize no steps returns false', wf2.deserializeWorkflow({ id: 'x' }) === false);

// 15. Set inputs
wf.setInputs(['input-1', 'input-2']);
check('Set inputs works', wf.getInputIds().length === 2);
check('Inputs are copied', wf.getInputIds()[0] === 'input-1');

// 16. Stable step IDs
const stepIds = wf.getSteps().map(s => s.id);
check('All step IDs are unique', new Set(stepIds).size === stepIds.length);
check('Step IDs are strings', stepIds.every(id => typeof id === 'string'));

// 17. Order preserved after clone
const originalOrder = wf.getSteps().map(s => s.operationId);
const clonedOrder = clone.getSteps().map(s => s.operationId);
check('Clone preserves step order', JSON.stringify(originalOrder) === JSON.stringify(clonedOrder));

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);
