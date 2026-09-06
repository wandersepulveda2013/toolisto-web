#!/usr/bin/env node
/**
 * table-history-cap-test.mjs (CE-095)
 *
 * Auditoria del limite de memoria del historial de deshacer de tabla.
 *
 * Problema (CE-095, P3): `commitTableEdit` (workspace.js) se dispara en cada blur
 * de celda y empujaba un snapshot profundo de headers+rows en `history.past` SIN
 * limite. Ediciones rapidas (Tab por celda) generan N snapshots profundos ->
 * crecimiento lineal de memoria en tablas grandes, frente a `_appHistory` que si
 * tiene `maxEntries:50`.
 *
 * Fijacion: acotar `history.past` a `TABLE_HISTORY_LIMIT` (50), descartando las
 * entradas mas antiguas al exceder, preservando el undo reciente.
 *
 * Este test carga el CODIGO REAL de workspace.js (commitTableEdit,
 * ensureTableHistory, snapshotDataTable, snapshotsEqual, tableHistories) en un
 * sandbox y verifica:
 *   1. Tras N=EJEMPLOS ediciones distintas (muy por encima del limite), el
 *      historial NO supera el limite.
 *   2. La ultima edicion se conserva (top reciente intacto).
 *   3. Las mas antiguas se descartan (el mini-historial queda acotado).
 *   4. El undo sigue funcionando correctamente DESPUES de que el cap se active.
 *   5. Los snapshots que NO cambian el contenido no se apilan (commit no-op).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^(async )?function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

const snapshotDataSrc = grabFn(wsCode, 'snapshotDataTable');
const snapshotsEqualSrc = grabFn(wsCode, 'snapshotsEqual');
const ensureSrc = grabFn(wsCode, 'ensureTableHistory');
const commitSrc = grabFn(wsCode, 'commitTableEdit');
const restoreSrc = grabFn(wsCode, 'restoreTableSnapshot');
const undoTableEditSrc = grabFn(wsCode, 'undoTableEdit');

const LIMIT_MATCH = wsCode.match(/const TABLE_HISTORY_LIMIT\s*=\s*(\d+)/);
const TABLE_HISTORY_LIMIT = LIMIT_MATCH ? Number(LIMIT_MATCH[1]) : 50;

// restoreTableSnapshot llama autoSaveTable(t) al restaurar; aqui es un no-op:
// la persistencia real del autosave y el undo/redo con cableado completo ya los
// cubre CE-091. Este test se centra solo en el CAP del historial y en que el undo
// siga siendo CORRECTO (semantica) despues de activarse el limite.
function buildApi() {
  const js = [
    snapshotDataSrc, snapshotsEqualSrc, ensureSrc, commitSrc, restoreSrc, undoTableEditSrc,
    'const autoSaveTable = () => {};',
    'const toast = () => {};',
    'const tableHistories = new WeakMap();',
  ].join('\n');
  const fn = new Function('WeakMap', 'JSON', 'String', 'Math', 'TABLE_HISTORY_LIMIT',
    js + '\nreturn { commitTableEdit, undoTableEdit, tableHistories, snapshotsEqual };');
  return fn(WeakMap, JSON, String, Math, TABLE_HISTORY_LIMIT);
}

console.log('=== CE-095: historial de deshacer de tabla acotado ===');
console.log('(commitTableEdit real de workspace.js; limite=' + TABLE_HISTORY_LIMIT + ')\n');

// ---------- 1. Tras muchas ediciones el historial queda acotado al limite ----------
console.log('1. Ediciones rapidas (por encima del limite): history.past no excede ' + TABLE_HISTORY_LIMIT);
{
  const api = buildApi();
  const table = { id: 'tblCap', name: 'Cap', headers: ['a'], rows: [['base']] };
  const EDITS = TABLE_HISTORY_LIMIT * 3; // 150 ediciones distintas
  for (let i = 1; i <= EDITS; i++) {
    table.rows[0][0] = 'v' + i;
    api.commitTableEdit(table);
  }
  const hist = api.tableHistories.get(table);
  check('history.past no supera el limite tras 3x ediciones', hist.past.length <= TABLE_HISTORY_LIMIT, 'past=' + hist.past.length);
  // la ultima edicion (mas reciente) se conserva en el tope
  const last = hist.past[hist.past.length - 1];
  check('la edicion mas reciente se conserva en el tope del historial', last && last.rows[0][0] === 'v' + EDITS, JSON.stringify(last && last.rows));
  // el historial NO incluye las entradas mas antiguas (descartadas)
  const oldestKept = hist.past[0].rows[0][0];
  const expectedOldestKept = 'v' + (EDITS - (TABLE_HISTORY_LIMIT - 1));
  check('las mas antiguas se descartan y el primer elemento es circa ' + expectedOldestKept,
    oldestKept === expectedOldestKept, 'primer=' + oldestKept + ' esperado=' + expectedOldestKept);
}

// ---------- 2. El undo funciona DESPUES de activarse el cap ----------
console.log('\n2. Undo correcto tras el cap: deshace la ultima edicion y encadena');
{
  const api = buildApi();
  const table = { id: 'tblUndo', title: 'U', headers: ['a'], rows: [['base']] };
  for (let i = 1; i <= TABLE_HISTORY_LIMIT + 10; i++) { // excede el limite
    table.rows[0][0] = 'v' + i;
    api.commitTableEdit(table);
  }
  const before = table.rows[0][0];
  const okUndo = api.undoTableEdit(table);
  check('undo regresa de la ultima edicion a la previa', okUndo && table.rows[0][0] !== before && table.rows[0][0] === 'v' + (TABLE_HISTORY_LIMIT + 10 - 1),
    'undo -> ' + table.rows[0][0]);
  const okUndo2 = api.undoTableEdit(table);
  check('el encadenado de undo sigue (vuelve a v' + (TABLE_HISTORY_LIMIT + 10 - 2) + ')',
    okUndo2 && table.rows[0][0] === 'v' + (TABLE_HISTORY_LIMIT + 10 - 2), table.rows[0][0]);
}

// ---------- 3. Commit sin cambio de contenido NO apila (no-op) ----------
console.log('\n3. Commit sin cambio real no apila snapshots repetidos');
{
  const api = buildApi();
  const table = { id: 'tblNoop', name: 'N', headers: ['a'], rows: [['x']] };
  api.commitTableEdit(table);
  api.commitTableEdit(table); // mismo contenido
  api.commitTableEdit(table);
  const hist = api.tableHistories.get(table);
  check('3 commits identicos apilan SOLO 1 snapshot (dedup)', hist.past.length === 1, 'past=' + hist.past.length);
}

// ---------- 4. Tabla con muchas filas: el limite aplica igualmente ----------
console.log('\n4. Tabla grande: el cap tambien protege el historial (memoria acotada)');
{
  const api = buildApi();
  const table = { id: 'tblBig', name: 'Big', headers: ['a', 'b', 'c', 'd'], rows: Array.from({ length: 500 }, (_, i) => ['r' + i, i, 'x', 'y']) };
  for (let i = 1; i <= TABLE_HISTORY_LIMIT * 2; i++) {
    table.rows[0][0] = 'edit-' + i;
    api.commitTableEdit(table);
  }
  const hist = api.tableHistories.get(table);
  check('tabla de 500 filas: history.past acotado al limite', hist.past.length <= TABLE_HISTORY_LIMIT, 'past=' + hist.past.length);
  check('memoria acotada: no crecio con 2x ediciones', hist.past.length === TABLE_HISTORY_LIMIT);
}

// ---------- 5. snapshotsEqual (CE-140): dedup sin JSON.stringify, con Sets reales ----------
console.log('\n5. snapshotsEqual (CE-140): comparacion estructural sin stringify de toda la tabla');
{
  const api = buildApi();
  const eq = api.snapshotsEqual;
  const sample = { headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], cellConfidence: [[90, 85], [95, 88]], columnTypes: ['text', 'number'], colFilters: { '0': new Set(['1']) } };
  check('igual a si misma', eq(sample, sample));
  const deepCopy = {
    headers: [...sample.headers],
    rows: sample.rows.map(r => [...r]),
    cellConfidence: sample.cellConfidence.map(r => [...r]),
    columnTypes: [...sample.columnTypes],
    colFilters: { '0': new Set(sample.colFilters['0']) },
  };
  check('copia profunda identica -> iguales', eq(deepCopy, sample));
  const diffCell = { headers: ['A', 'B'], rows: [['1', 'X'], ['3', '4']], cellConfidence: [[90, 85], [95, 88]], columnTypes: ['text', 'number'], colFilters: { '0': new Set(['1']) } };
  check('una celda distinta -> desigual', !eq(diffCell, sample));
  check('header distinto -> desigual', !eq({ headers: ['A', 'C'], rows: sample.rows }, sample));
  check('fila extra -> desigual', !eq({ headers: ['A', 'B'], rows: [['1', '2'], ['3', '4'], ['5', '6']], cellConfidence: [[90, 85], [95, 88]] }, sample));
  check('columnTypes distinto -> desigual', !eq({ ...sample, columnTypes: ['date', 'number'] }, sample));
  const filtroDistinto = { headers: ['A', 'B'], rows: sample.rows, colFilters: { '0': new Set(['2']) } };
  check('Set de colFilters con contenido distinto -> desigual (bug del JSON.stringify(Set)={} corregido)', !eq(filtroDistinto, sample));
  check('Set de colFilters identico -> iguales', eq({ ...sample }, sample));
  check('sin colFilters ambos -> iguales', eq({ headers: ['A'] }, { headers: ['A'] }));
  check('colFilters solo en uno -> desigual', !eq({ headers: ['A'], colFilters: { '0': new Set(['x']) } }, { headers: ['A'] }));
}

// ---------- 6. Anti-regresion CE-140: el hot-path ya no stringifica la tabla ----------
console.log('\n6. Anti-regresion CE-140: commit/checkpoint usan snapshotsEqual, no JSON.stringify');
{
  check('commitTableEdit compara con snapshotsEqual', wsCode.includes('if (!snapshotsEqual(current, next)) history.past.push(next);'));
  check('checkpointTableEdit compara con snapshotsEqual', wsCode.includes('if (!snapshotsEqual(history.past[history.past.length - 1], current)) history.past.push(current);'));
  check('snapshotKey (stringify total) eliminado', !wsCode.includes('snapshotKey'));
  const commitBody = wsCode.slice(wsCode.indexOf('function commitTableEdit('), wsCode.indexOf('function restoreTableSnapshot('));
  const checkpointBody = wsCode.slice(wsCode.indexOf('function checkpointTableEdit('), wsCode.indexOf('function parseClipboardGrid('));
  check('ni commit ni checkpoint llaman JSON.stringify', !commitBody.includes('JSON.stringify') && !checkpointBody.includes('JSON.stringify'));
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);