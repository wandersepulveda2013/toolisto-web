import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l) || new RegExp('^export function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');

const augSrc =
  grabFn(wsCode, 'cloneColFilterMap') + '\n' +
  grabFn(wsCode, 'snapshotDataTable') + '\n' +
  grabFn(wsCode, 'removeTableColumn') + '\n' +
  grabFn(wsCode, 'removeTableRow') + '\n' +
  grabFn(wsCode, 'restoreTableSnapshot');

const saveCalls = [];
const stubAutoSave = (t) => { saveCalls.push(t.id); };
const api = new Function('autoSaveTable', augSrc + '\nreturn { cloneColFilterMap, snapshotDataTable, removeTableColumn, removeTableRow, restoreTableSnapshot };')(stubAutoSave);

console.log('=== CE-129: la vista de tabla puede eliminar filas y columnas (con confirmacion y undo) ===');
console.log('(removeTableColumn / removeTableRow / snapshot / restore REALES de workspace.js)');

const mkTable = () => ({
  id: 't1',
  headers: ['A', 'B', 'C'],
  rows: [
    ['a1', 'b1', 'c1'],
    ['a2', 'b2', 'c2'],
    ['a3', 'b3', 'c3'],
  ],
  cellConfidence: [
    [90, 80, 70],
    [91, 81, 71],
    [92, 82, 72],
  ],
  columnTypes: ['text', 'number', 'text'],
  _colFilters: { '1': new Set(['b2', 'b4']), '2': new Set(['x']) },
});

const rowsJSON = (t) => JSON.stringify(t.rows.map(r => r.map(String)));

// ELIMINAR COLUMNA del medio: headers, filas, confianza, columnTypes y colFilters se re-indexan
{
  const t = mkTable();
  const out = api.removeTableColumn(t, 1);
  check('columna media: devuelve true', out === true);
  check('columna media: headers sin la columna [A, C]', JSON.stringify(t.headers) === JSON.stringify(['A', 'C']));
  check('columna media: filas sin la columna', rowsJSON(t) === JSON.stringify([['a1', 'c1'], ['a2', 'c2'], ['a3', 'c3']]));
  check('columna media: cellConfidence sin la columna', JSON.stringify(t.cellConfidence) === JSON.stringify([[90, 70], [91, 71], [92, 72]]));
  check('columna media: columnTypes sin la columna', JSON.stringify(t.columnTypes) === JSON.stringify(['text', 'text']));
  check('columna media: valores del filtro de la columna borrada retirados (b2/b4 fuera)', t._colFilters['1'].has('b2') === false && t._colFilters['1'].has('b4') === false);
  check('columna media: filtro de la columna 2 se re-indexa a columna 1 (Set conservado)', t._colFilters['1'] instanceof Set && t._colFilters['1'].has('x'));
}

// ELIMINAR PRIMERA columna (0): slicing del re-index
{
  const t = mkTable();
  api.removeTableColumn(t, 0);
  check('columna 0: headers [B, C]', JSON.stringify(t.headers) === JSON.stringify(['B', 'C']));
  check('columna 0: filas sin col A', rowsJSON(t) === JSON.stringify([['b1', 'c1'], ['b2', 'c2'], ['b3', 'c3']]));
  check('columna 0: colFilters desplazados (col1->col0, col2->col1)', t._colFilters['0'] instanceof Set && t._colFilters['0'].has('b2') && t._colFilters['1'].has('x'));
}

// ELIMINAR ULTIMA columna
{
  const t = mkTable();
  api.removeTableColumn(t, 2);
  check('columna ultima: headers [A, B]', JSON.stringify(t.headers) === JSON.stringify(['A', 'B']));
  check('columna ultima: filtro de la columna 2 borrada desaparece y col1 no se desplaza', t._colFilters['2'] === undefined && t._colFilters['1'].has('b2'));
}

// ELIMINAR FILA: filas/cellConfidence quitadas; headers, columnTypes y colFilters intactos
{
  const t = mkTable();
  const out = api.removeTableRow(t, 1);
  check('fila media: devuelve true', out === true);
  check('fila media: filas sin la fila 2', rowsJSON(t) === JSON.stringify([['a1', 'b1', 'c1'], ['a3', 'b3', 'c3']]));
  check('fila media: cellConfidence sin la fila 2', JSON.stringify(t.cellConfidence) === JSON.stringify([[90, 80, 70], [92, 82, 72]]));
  check('fila media: headers intactos', JSON.stringify(t.headers) === JSON.stringify(['A', 'B', 'C']));
  check('fila media: columnTypes intactos', JSON.stringify(t.columnTypes) === JSON.stringify(['text', 'number', 'text']));
  check('fila media: _colFilters intactos (indexados por columna, no por fila)', t._colFilters['1'].has('b2') && t._colFilters['2'].has('x'));
}

// GUARDS: indices invalidos -> false y sin mutacion
{
  const t = mkTable();
  const before = JSON.stringify(t);
  check('guard: indice -1 columna -> false', api.removeTableColumn(t, -1) === false);
  check('guard: indice >= headers -> false', api.removeTableColumn(t, 3) === false);
  check('guard: NaN columna -> false', api.removeTableColumn(t, 'x') === false);
  check('guard: indice -1 fila -> false', api.removeTableRow(t, -1) === false);
  check('guard: indice >= rows -> false', api.removeTableRow(t, 3) === false);
  check('guard: sin mutacion tras guards', JSON.stringify(t) === before);
}

// GUARD minimo: una tabla necesita al menos 1 columna y 1 fila
{
  const oneCol = { headers: ['A'], rows: [['x'], ['y']] };
  check('guard minimo: no permite borrar la unica columna', api.removeTableColumn(oneCol, 0) === false && JSON.stringify(oneCol.headers) === JSON.stringify(['A']));
  const oneRow = { headers: ['A', 'B'], rows: [['x', 'y']] };
  check('guard minimo: no permite borrar la unica fila', api.removeTableRow(oneRow, 0) === false && oneRow.rows.length === 1);
}

// GUARD forma invalida de tabla
{
  const e = {};
  check('guard: tabla sin headers/rows -> false', api.removeTableColumn(e, 0) === false && api.removeTableRow(e, 0) === false);
  const emptyRows = { headers: ['A'], rows: [] };
  check('guard: rows vacio -> false (indice fuera de rango)', api.removeTableRow(emptyRows, 0) === false);
}

// Bucle hasta el minimo: 3x3 -> 1x1 (cada borrado devuelve true), el ultimo queda bloqueado
{
  const t = mkTable();
  let ok = true;
  ok = ok && api.removeTableColumn(t, 0) && api.removeTableColumn(t, 0) && api.removeTableRow(t, 0) && api.removeTableRow(t, 0);
  check('bucle: 3x3 puede reducirse hasta 1x1', ok && t.headers.length === 1 && t.rows.length === 1);
  check('bucle: el ultimo borrado queda bloqueado', api.removeTableColumn(t, 0) === false && api.removeTableRow(t, 0) === false);
}

// SNAPSHOT cubre columnTypes y _colFilters clonados
{
  const t = mkTable();
  const snap = api.snapshotDataTable(t);
  check('snapshot: incluye columnTypes clonados', Array.isArray(snap.columnTypes) && JSON.stringify(snap.columnTypes) === JSON.stringify(['text', 'number', 'text']));
  check('snapshot: incluye _colFilters como mapa', snap.colFilters && snap.colFilters['1'] instanceof Set);
  t.columnTypes[0] = 'date';
  t._colFilters['1'].add('zz');
  check('snapshot: columnTypes es copia (no refleja la mutacion posterior)', snap.columnTypes[0] === 'text');
  check('snapshot: Set del filtro es copia (no refleja la mutacion posterior)', snap.colFilters['1'].has('zz') === false);
}

// RESTORE devuelve el estado COMPLETO (incluido columnTypes y _colFilters) y llama autoSave
{
  const t = mkTable();
  const pre = api.snapshotDataTable(t);
  api.removeTableColumn(t, 1);
  api.removeTableRow(t, 0);
  api.restoreTableSnapshot(t, pre);
  check('restore: headers vuelven', JSON.stringify(t.headers) === JSON.stringify(['A', 'B', 'C']));
  check('restore: filas vuelven', rowsJSON(t) === rowsJSON(mkTable()));
  check('restore: cellConfidence vuelve', JSON.stringify(t.cellConfidence) === JSON.stringify([[90, 80, 70], [91, 81, 71], [92, 82, 72]]));
  check('restore: columnTypes vuelve', JSON.stringify(t.columnTypes) === JSON.stringify(['text', 'number', 'text']));
  check('restore: _colFilters vuelve (Set re-construido)', t._colFilters['1'] instanceof Set && t._colFilters['1'].has('b2') && t._colFilters['2'].has('x'));
  check('restore: llama a autoSaveTable', saveCalls.includes('t1'));
}

// RESTORE legacy (snapshot sin columnTypes/_colFilters) conserva los campos vivos
{
  const t = mkTable();
  api.restoreTableSnapshot(t, { headers: ['A', 'B'], rows: [['a1', 'b1']] });
  check('restore legacy: headers/rows restaurados', t.headers.length === 2);
  check('restore legacy: conserva columnTypes vivos', JSON.stringify(t.columnTypes) === JSON.stringify(['text', 'number', 'text']));
  check('restore legacy: conserva _colFilters vivos', t._colFilters['1'] instanceof Set && t._colFilters['1'].has('b2'));
}

// UNDO logico de un borrado (patron checkpoint/commit del historial)
{
  const t = mkTable();
  const past = [api.snapshotDataTable(t)];
  api.removeTableColumn(t, 2);
  api.removeTableRow(t, 0);
  const post = api.snapshotDataTable(t);
  past.push(post);
  api.restoreTableSnapshot(t, past[past.length - 2]);
  check('undo de borrado: estado completo original (headers+filas+confianza+columnTypes+filtros)', JSON.stringify(t.headers) === JSON.stringify(['A', 'B', 'C']) && t._colFilters['2'] instanceof Set && t._colFilters['2'].has('x') && t.rows.length === 3);
}

// ANTI-REGRESION ESTATICA
check('anti-regresion: helpers definidos en workspace.js', wsCode.includes('function removeTableColumn(table, index)') && wsCode.includes('function removeTableRow(table, index)'));
check('anti-regresion: los 2 botones de la vista usan removeTableRow/removeTableColumn con la seleccion', wsCode.includes('removeTableRow(table, ri)') && wsCode.includes('removeTableColumn(table, ci)'));
check('anti-regresion: los 2 botones usan checkpoint/commit/autoSave/rerender (undo)', (wsCode.match(/checkpointTableEdit\(table\);\n          if \(remove/g) || []).length === 2);
check('anti-regresion: snapshotDataTable incluye columnTypes y colFilters', wsCode.includes('columnTypes: Array.isArray(table.columnTypes) ? [...table.columnTypes] : undefined') && wsCode.includes('colFilters: table._colFilters ? cloneColFilterMap(table._colFilters) : undefined'));
check('anti-regresion: restoreTableSnapshot restaura columnTypes y _colFilters usando cloneColFilterMap', wsCode.includes('if (Array.isArray(snapshot.columnTypes)) table.columnTypes = [...snapshot.columnTypes]') && wsCode.includes('if (snapshot.colFilters !== undefined) table._colFilters = cloneColFilterMap(snapshot.colFilters)'));
check('anti-regresion: el dropdown de filtros sigue indexado por columna (colFilterHas ya presente)', (wsCode.match(/colFilterHas\(/g) || []).length >= 2);
check('anti-regresion: no hay un boton "Eliminar" sin confirmacion (siempre abre showModal)', (wsCode.match(/title: 'Eliminar (fila|columna)'/g) || []).length === 2);

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);