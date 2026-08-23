/**
 * Tests for data model migration, backward compatibility, and version registry.
 * Covers: schema-versions.js, models.js migration v1→v2, table-helpers.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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
    console, Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map,
    parseInt, parseFloat, ...deps
  };
  vm.runInNewContext(source, context, { filename: relative });
  const result = {};
  for (const name of exportNames) {
    result[name] = context[name];
  }
  return result;
}

const sv = loadVm('workspace/core/schema-versions.js', [
  'OBJECT_SCHEMA_VERSION', 'DB_SCHEMA_VERSION', 'BUNDLE_SCHEMA_VERSION',
  'STORAGE_ENVELOPE_VERSION', 'SESSION_SCHEMA_VERSION', 'DATA_MODEL_SCHEMA_VERSION'
]);

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}`); }
}

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Version registry ===');

check('OBJECT_SCHEMA_VERSION is 2', sv.OBJECT_SCHEMA_VERSION === 2);
check('DB_SCHEMA_VERSION is 3', sv.DB_SCHEMA_VERSION === 3);
check('BUNDLE_SCHEMA_VERSION is 3', sv.BUNDLE_SCHEMA_VERSION === 3);
check('STORAGE_ENVELOPE_VERSION is 2', sv.STORAGE_ENVELOPE_VERSION === 2);
check('SESSION_SCHEMA_VERSION is 1', sv.SESSION_SCHEMA_VERSION === 1);
check('DATA_MODEL_SCHEMA_VERSION is 1', sv.DATA_MODEL_SCHEMA_VERSION === 1);
check('versions are all numbers', [sv.OBJECT_SCHEMA_VERSION, sv.DB_SCHEMA_VERSION, sv.BUNDLE_SCHEMA_VERSION,
  sv.STORAGE_ENVELOPE_VERSION, sv.SESSION_SCHEMA_VERSION, sv.DATA_MODEL_SCHEMA_VERSION].every(v => typeof v === 'number'));

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Table helpers (backward compat) ===');

const th = loadVm('workspace/core/table-helpers.js', [
  'getActiveSheet', 'getTableHeaders', 'getTableRows', 'getTableColumns'
]);

const canonicalTable = {
  id: 't1', name: 'Test Table',
  sheets: [{ id: 's1', name: 'Sheet 1', index: 0, columns: ['A', 'B'], rows: [['1', '2']] }],
  activeSheetIndex: 0
};
check('getActiveSheet returns first sheet', th.getActiveSheet(canonicalTable).columns.length === 2);
check('getTableHeaders from canonical', th.getTableHeaders(canonicalTable).length === 2);
check('getTableHeaders canonical = ["A", "B"]', th.getTableHeaders(canonicalTable)[0] === 'A');
check('getTableRows from canonical', th.getTableRows(canonicalTable).length === 1);
check('getTableColumns alias', th.getTableColumns(canonicalTable).length === 2);

const legacyTable = {
  id: 't2', name: 'Legacy Table',
  headers: ['X', 'Y', 'Z'],
  rows: [['a', 'b', 'c'], ['d', 'e', 'f']]
};
check('getActiveSheet from legacy (no sheets)', th.getActiveSheet(legacyTable).columns.length === 3);
check('getTableHeaders from legacy', th.getTableHeaders(legacyTable).length === 3);
check('getTableHeaders legacy = ["X","Y","Z"]', th.getTableHeaders(legacyTable)[0] === 'X');
check('getTableRows from legacy', th.getTableRows(legacyTable).length === 2);

const emptyTable = null;
check('getActiveSheet null returns defaults', th.getActiveSheet(emptyTable).columns.length === 0);
check('getTableHeaders null returns []', th.getTableHeaders(emptyTable).length === 0);
check('getTableRows null returns []', th.getTableRows(emptyTable).length === 0);

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Models migration v1→v2 ===');

const dbMock = {
  entries: {},
  async put(store, value) { this.entries[store + ':' + value.id] = value; },
  async get(store, id) { return this.entries[store + ':' + id] || null; }
};

const models = loadVm('workspace/core/models.js', [
  'createDataDocument', 'migrateObject', 'createTableDocument', 'migrateDataModelToV2',
  'MODEL_VERSION', 'OBJECT_SCHEMA_VERSION'
], {
  generateId: () => 'test-id-' + Math.random().toString(36).slice(2, 9),
  OBJECT_SCHEMA_VERSION: sv.OBJECT_SCHEMA_VERSION,
  DATA_MODEL_SCHEMA_VERSION: sv.DATA_MODEL_SCHEMA_VERSION,
});

const legacyDoc = { id: 'd1', type: 'table-document', name: 'Legacy', headers: ['A', 'B'], rows: [['1', '2']] };
const migrated = models.migrateObject(legacyDoc);
check('migrateObject creates sheets from legacy headers/rows', Array.isArray(migrated.sheets));
check('migrated sheets has 1 sheet', migrated.sheets.length === 1);
check('migrated sheet columns = legacy headers', migrated.sheets[0].columns[0] === 'A');
check('migrated sheet rows = legacy rows', migrated.sheets[0].rows[0][0] === '1');
check('migrated activeSheetIndex = 0', migrated.activeSheetIndex === 0);
check('migrated _version = OBJECT_SCHEMA_VERSION', migrated._version === sv.OBJECT_SCHEMA_VERSION);
check('legacy headers preserved (backward compat)', Array.isArray(migrated.headers) && migrated.headers[0] === 'A');
check('legacy rows preserved (backward compat)', Array.isArray(migrated.rows) && migrated.rows[0][0] === '1');

const newDoc = models.createTableDocument('New Table', 'p1');
check('createTableDocument has sheets', Array.isArray(newDoc.sheets));
check('createTableDocument has empty columns', newDoc.sheets[0].columns.length === 0);
check('createTableDocument has empty rows', newDoc.sheets[0].rows.length === 0);

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== Resultado ===');
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
