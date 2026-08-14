#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'workspace', 'core', 'operation-registry.js');
const code = readFileSync(SRC, 'utf8');

const body = code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const sandbox = { console, Map, Array, Object, Error, setTimeout, clearTimeout };
const fn = new Function('console', 'Map', 'Array', 'Object', 'Error', 'setTimeout', 'clearTimeout',
  body + '\nreturn createOperationRegistry;'
);
const createOperationRegistry = fn(console, Map, Array, Object, Error, setTimeout, clearTimeout);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('=== Operation Registry Tests ===\n');

// 1. Register valid operation
const registry = createOperationRegistry();
const validOp = {
  id: 'test.op',
  name: 'Test Operation',
  description: 'A test operation',
  category: 'test',
  inputKinds: ['image'],
  outputKind: 'image',
  supportsBatch: true,
  supportsCancellation: false,
  destructive: false,
  validate() { return { valid: true }; },
  execute() { return 'result'; },
};
check('Register valid operation', registry.register(validOp));
check('Has registered operation', registry.has('test.op'));
check('Get returns operation', registry.get('test.op') !== null);
check('Get returns correct id', registry.get('test.op').id === 'test.op');

// 2. Reject duplicate ID
check('Reject duplicate ID', registry.register(validOp) === false);

// 3. Reject incomplete descriptor
const incompleteOps = [
  { id: 'no-name', description: 'x', category: 'x', inputKinds: ['image'], outputKind: 'image', execute() {} },
  { name: 'no-id', description: 'x', category: 'x', inputKinds: ['image'], outputKind: 'image', execute() {} },
  { id: 'no-desc', name: 'x', category: 'x', inputKinds: ['image'], outputKind: 'image', execute() {} },
  { id: 'no-cat', name: 'x', description: 'x', inputKinds: ['image'], outputKind: 'image', execute() {} },
  { id: 'no-inputs', name: 'x', description: 'x', category: 'x', inputKinds: [], outputKind: 'image', execute() {} },
  { id: 'no-output', name: 'x', description: 'x', category: 'x', inputKinds: ['image'], execute() {} },
  { id: 'no-execute', name: 'x', description: 'x', category: 'x', inputKinds: ['image'], outputKind: 'image' },
];
for (const op of incompleteOps) {
  check('Reject incomplete: ' + (op.id || '?'), registry.register(op) === false);
}

// 4. List all operations
check('List returns non-empty', registry.list().length > 0);
check('List returns array', Array.isArray(registry.list()));

// 5. List compatible
const imageOps = registry.listCompatible('image');
check('List compatible returns array', Array.isArray(imageOps));
check('List compatible finds image ops', imageOps.length > 0);

// 6. List by category
const testOps = registry.listByCategory('test');
check('List by category works', testOps.length > 0);

// 7. Unregister
check('Unregister returns true', registry.unregister('test.op'));
check('Get after unregister returns null', registry.get('test.op') === null);
check('Has after unregister returns false', registry.has('test.op') === false);

// 8. Validate operation
registry.register(validOp);
check('Validate valid operation', registry.validate('test.op', { kind: 'image' }, {}).valid);
const invalidValidation = registry.validate('test.op', { kind: 'pdf' }, {});
check('Validate incompatible input', !invalidValidation.valid);

// 9. Validate non-existent operation
const noOpValidation = registry.validate('nonexistent', { kind: 'image' }, {});
check('Validate non-existent operation', !noOpValidation.valid);

// 10. Operation not available
const unregisteredValidation = registry.validate('unknown.op', { kind: 'image' }, {});
check('Validate unknown operation', !unregisteredValidation.valid);

// 11. Clear
registry.clear();
check('Clear removes all', registry.count() === 0);

// 12. Invalid input kinds
check('Reject invalid inputKind', registry.register({
  id: 'bad-kind', name: 'x', description: 'x', category: 'x',
  inputKinds: ['invalid_type'], outputKind: 'image', execute() {},
}) === false);

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);
