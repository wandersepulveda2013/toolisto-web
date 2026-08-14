import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadModule(relative, exports) {
  const source = read(relative).replace(/export\s*\{[\s\S]*?\};\s*$/, exports.map(name => `globalThis.${name} = ${name};`).join('\n'));
  const context = { console, localStorage: { getItem: () => null, setItem: () => {} } };
  vm.runInNewContext(source, context, { filename: relative });
  return context;
}

const state = loadModule('workspace/core/state.js', ['appStore', 'createStore']);
const storeA = state.createStore({ value: 0 });
const storeB = state.createStore({ value: 0 });
let callsA = 0;
let callsB = 0;
storeA.subscribe('value', () => { callsA += 1; });
storeB.subscribe('value', () => { callsB += 1; });
storeB.set({ value: 1 });
assert.equal(callsA, 0, 'un store no debe recibir cambios de otro store');
assert.equal(callsB, 1, 'el store propio debe recibir su cambio');
storeA.set({ value: 1 });
assert.equal(callsA, 1, 'el listener propio debe seguir funcionando');

const model = loadModule('workspace/core/model.js', ['MODEL_VERSION', 'modelCanonical', 'modelFieldMeta', 'modelIsKeyName', 'normalizeDataModel', 'detectDataModelRelationships', 'modelRelationshipKey', 'modelRelationshipTitle']);
const tables = [
  { id: 'users', name: 'Usuarios', headers: ['id', 'nombre'], rows: [['1', 'Ana']] },
  { id: 'orders', name: 'Pedidos', headers: ['id', 'usuario_id'], rows: [['8', '1']] },
];
const normalized = model.normalizeDataModel({ id: 'p1' }, tables, null);
const relationships = model.detectDataModelRelationships(tables, normalized.relationships);
assert.equal(relationships.length, 1, 'el modelo debe detectar users.id -> orders.usuario_id');

const stateSource = read('workspace/core/state.js');
const dbSource = read('workspace/core/db.js');
const sessionSource = read('workspace/core/workspace-storage.js');
const storageSource = read('workspace/core/storage.js');
const workspaceSource = read('workspace/workspace.js');
assert.match(stateSource, /function createStore\(initialState\)\s*\{\s*let state = \{ \.\.\.initialState \};\s*const listeners = new Map\(\)/);
assert.match(dbSource, /req\.onblocked\s*=\s*\(\)\s*=>[\s\S]*reject\(/);
assert.match(dbSource, /if \(_db\) _db\.close\(\)/);
assert.ok(dbSource.indexOf('tx.oncomplete =') < dbSource.indexOf('const callbackResult = fn(ctx)'), 'la transacción debe registrar oncomplete antes del callback');
assert.match(sessionSource, /workflowDefinition: sessionData\?\.workflowDefinition \|\| null/);
assert.match(sessionSource, /sessions\.filter\(item => item\.sessionId !== sessionId\)/);
assert.match(storageSource, /await dbTransaction\(\[[\s\S]*STORES\.projects[\s\S]*'readwrite'/);
assert.match(storageSource, /stores\[STORES\.settings\]\.delete\('model:' \+ id\)/);
assert.match(workspaceSource, /await saveDoc\(project\.id, doc\)/);
assert.match(workspaceSource, /await saveData\(project\.id, table\)/);
assert.doesNotMatch(workspaceSource, /await saveDoc\(doc\)/);
assert.doesNotMatch(workspaceSource, /await saveData\(table\)/);
assert.match(workspaceSource, /case 'model': if \(project\) renderModelView/);
assert.match(workspaceSource, /let _operationRegistry = null/);
assert.match(workspaceSource, /createWorkflowUI\(_operationRegistry/);

for (const relative of ['workspace/core/state.js', 'workspace/core/db.js', 'workspace/core/workspace-storage.js', 'workspace/workspace.js']) {
  assert.equal(read(relative), read(relative.replace(/^workspace/, 'dist/workspace')), `${relative} debe coincidir con su copia servida`);
}

console.log('Deep regression: 24 assertions passed');
