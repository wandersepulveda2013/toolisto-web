/**
 * Tests for core/model.js: inferCardinality + detectDataModelRelationships.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadVm(relative, exportNames) {
  let source = read(relative)
    .replace(/^import\s+.*\s+from\s+['"].*['"];?\s*$/gm, '')
    .replace(/export\s+(default\s+)?/g, '')
    .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
  const context = {
    console,
    Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map,
    parseInt, parseFloat
  };
  vm.runInNewContext(source, context, { filename: relative });
  const result = {};
  for (const name of exportNames) {
    result[name] = context[name];
  }
  return result;
}

const schemaVersions = loadVm('workspace/core/schema-versions.js', ['DATA_MODEL_SCHEMA_VERSION']);
const localeParser = loadVm('workspace/core/locale-parser.js', [
  'parseLocaleNumber', 'inferNumericHints', 'classifyDate', 'inferDateFormat', 'detectSeparator'
]);
const tableHelpers = loadVm('workspace/core/table-helpers.js', [
  'getActiveSheet', 'getTableHeaders', 'getTableRows', 'getTableColumns'
]);

let source = read('workspace/core/model.js')
  .replace(/^import\s+.*\s+from\s+['"].*['"];?\s*$/gm, '')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
const modelCtx = {
  console,
  Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map,
  parseInt, parseFloat,
  DATA_MODEL_SCHEMA_VERSION: schemaVersions.DATA_MODEL_SCHEMA_VERSION,
  parseLocaleNumber: localeParser.parseLocaleNumber,
  inferNumericHints: localeParser.inferNumericHints,
  classifyDate: localeParser.classifyDate,
  inferDateFormat: localeParser.inferDateFormat,
  getTableRows: tableHelpers.getTableRows,
  getTableHeaders: tableHelpers.getTableHeaders,
};
vm.runInNewContext(source, modelCtx, { filename: 'workspace/core/model.js' });

const m = {
  inferCardinality: modelCtx.inferCardinality,
  detectDataModelRelationships: modelCtx.detectDataModelRelationships,
  normalizeDataModel: modelCtx.normalizeDataModel,
  modelFieldMeta: modelCtx.modelFieldMeta,
  modelCanonical: modelCtx.modelCanonical,
};

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== inferCardinality ===');

check('1:* basic (duplicates in FK)',
  m.inferCardinality(['1', '2', '3'], ['1', '1', '2']) === '1:*');

check('1:1 (unique FK, all exist in PK)',
  m.inferCardinality(['1', '2', '3'], ['1', '2', '3']) === '1:1');

check('1:* FK subset (not all PK matched)',
  m.inferCardinality(['1', '2', '3', '4'], ['1', '2']) === '1:*');

check('*:* (FK has values not in PK)',
  m.inferCardinality(['1', '2'], ['1', '99']) === '*:*');

check('*:* with duplicates',
  m.inferCardinality(['1', '2'], ['1', '99', '99']) === '*:*');

check('empty PK returns 1:*', m.inferCardinality([], ['1', '2']) === '1:*');
check('empty FK returns 1:*', m.inferCardinality(['1', '2'], []) === '1:*');
check('both empty returns 1:*', m.inferCardinality([], []) === '1:*');

check('1:1 exact match',
  m.inferCardinality(['a', 'b'], ['a', 'b']) === '1:1');

check('1:* FK has dupes but all in PK',
  m.inferCardinality(['1', '2', '3'], ['1', '1', '2']) === '1:*');

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== detectDataModelRelationships ===');

const tables1 = [
  { id: 'users', name: 'Usuarios', headers: ['id', 'nombre'], rows: [['1', 'Ana'], ['2', 'Luis']] },
  { id: 'orders', name: 'Pedidos', headers: ['id', 'usuario_id'], rows: [['8', '1'], ['9', '1'], ['10', '2']] },
];
const rels1 = m.detectDataModelRelationships(tables1, []);
check('basic 1:* detected', rels1.length === 1);
check('basic 1:* cardinality', rels1[0]?.cardinality === '1:*');
check('basic 1:* from field', rels1[0]?.fromField === 'id');
check('basic 1:* to field', rels1[0]?.toField === 'usuario_id');

const tables2 = [
  { id: 'users', name: 'Usuarios', headers: ['id', 'email'], rows: [['1', 'a@b.com'], ['2', 'c@d.com']] },
  { id: 'profiles', name: 'Perfiles', headers: ['id', 'usuario_id'], rows: [['10', '1'], ['20', '2']] },
];
const rels2 = m.detectDataModelRelationships(tables2, []);
check('1:1 detected (unique FK)',
  rels2.length === 1 && rels2[0]?.cardinality === '1:1');

const tables3 = [
  { id: 'a', name: 'TablaA', headers: ['id', 'token_key'], rows: [['1', 'x']] },
  { id: 'b', name: 'TablaB', headers: ['id', 'token_key'], rows: [['1', 'x']] },
];
const rels3 = m.detectDataModelRelationships(tables3, []);
check('same-key detection works', rels3.length === 1);

const tables4 = [
  { id: 'users', name: 'Usuarios', headers: ['id', 'email'], rows: [['1', 'a@b.com'], ['2', 'c@d.com']] },
  { id: 'orders', name: 'Pedidos', headers: ['id', 'usuario_id'], rows: [['8', '1'], ['9', '1'], ['10', '2'], ['11', '99']] },
];
const rels4 = m.detectDataModelRelationships(tables4, []);
check('*:* (orphan FK value)',
  rels4.length === 1 && rels4[0]?.cardinality === '*:*');

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
