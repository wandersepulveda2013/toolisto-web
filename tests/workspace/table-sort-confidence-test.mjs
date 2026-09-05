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
const lpCode = readFileSync(new URL('../../workspace/core/locale-parser.js', import.meta.url), 'utf8');

const stripNoiseSrc = lpCode.match(/function stripNoise\(text\) \{[\s\S]*?\n\}/)[0];
const lpHeader = lpCode.match(/const (CURRENCY_RE|NBSP_RE|GROUP_BREAK_RE) = [^\n]+/g).join('\n');
const parseLocaleNumberSrc = lpCode.match(/export function parseLocaleNumber[\s\S]*?\n\}/)[0].replace(/^export /, '');
const augSrc =
  lpHeader + '\n' +
  stripNoiseSrc + '\n' +
  parseLocaleNumberSrc + '\n' +
  grabFn(wsCode, 'compareTableValues') + '\n' +
  grabFn(wsCode, 'sortTableRows') + '\n' +
  grabFn(wsCode, 'snapshotDataTable') + '\n' +
  grabFn(wsCode, 'restoreTableSnapshot');

const saveCalls = [];
const stubAutoSave = (t) => { saveCalls.push(t.id); };
const api = new Function('autoSaveTable', augSrc + '\nreturn { sortTableRows, snapshotDataTable, restoreTableSnapshot, compareTableValues, parseLocaleNumber };')(stubAutoSave);

const cmp = api.compareTableValues;

console.log('=== CE-126: sort de tabla mantiene alineada cellConfidence (revision de celdas correcta) ===');
console.log('(sortTableRows / snapshotDataTable / restoreTableSnapshot REALES de workspace.js)');

const mkTable = () => ({
  id: 't1',
  headers: ['Nombre', 'Cant'],
  rows: [
    ['Ana', '3'],
    ['Beto', '100'],
    ['Caro', '20'],
  ],
  cellConfidence: [
    [92, 90],
    [88, 75],
    [95, 80],
  ],
});
const byCol1 = (a, b) => cmp(a[1], b[1]);
const byCol1Desc = (a, b) => -cmp(a[1], b[1]);

// ALINEACION asc
{
  const t = mkTable();
  api.sortTableRows(t, byCol1);
  check('asc: filas ordenadas [Ana(3), Caro(20), Beto(100)]', JSON.stringify(t.rows.map(r => r[1])) === JSON.stringify(['3', '20', '100']));
  const c = t.cellConfidence.map(r => r[1]);
  check('asc: cellConfidence reordenada al mismo orden [90, 80, 75]', JSON.stringify(c) === JSON.stringify([90, 80, 75]));
  check('asc: pares celda-confianza intactos (Ana->90, Beto->75, Caro->80)', t.cellConfidence[0][0] === 92 && t.cellConfidence[1][0] === 95 && t.cellConfidence[2][0] === 88);
}

// ALINEACION desc
{
  const t = mkTable();
  api.sortTableRows(t, byCol1Desc);
  check('desc: filas ordenadas [Beto(100), Caro(20), Ana(3)]', JSON.stringify(t.rows.map(r => r[1])) === JSON.stringify(['100', '20', '3']));
  const c = t.cellConfidence.map(r => r[1]);
  check('desc: cellConfidence reordenada [75, 80, 90]', JSON.stringify(c) === JSON.stringify([75, 80, 90]));
}

// PARIDAD con valores europeos (mismo comparator del sort de cabecera)
{
  const t = { headers: ['A', 'B'], rows: [['x', '1.200'], ['y', '1.3']], cellConfidence: [[90, 50], [80, 60]] };
  api.sortTableRows(t, byCol1);
  check('europeos: 1.3 < 1.200 numericamente (orden [1.3, 1.200])', JSON.stringify(t.rows.map(r => r[1])) === JSON.stringify(['1.3', '1.200']));
  check('europeos: confianza alineada [60, 50]', JSON.stringify(t.cellConfidence.map(r => r[1])) === JSON.stringify([60, 50]));
}

// SIN cellConfidence (tabla limpia, sin revision) no rompe
{
  const t = { id: 't2', headers: ['A'], rows: [['b'], ['a']] };
  const out = api.sortTableRows(t, (a, b) => String(a[0]).localeCompare(String(b[0])));
  check('sin cellConfidence: filas ordenadas y devueltas', JSON.stringify(out.map(r => r[0])) === JSON.stringify(['a', 'b']));
  check('sin cellConfidence: no se crea la matriz', t.cellConfidence === undefined);
}

// cellConfidence con longitud distinta a filas (fila añadida post-conversion) NO se toca (parity guard)
{
  const t = { headers: ['A'], rows: [['b'], ['a']], cellConfidence: [[90]] };
  api.sortTableRows(t, (a, b) => String(a[0]).localeCompare(String(b[0])));
  check('longitud distinta: filas se ordenan, confianza intacta', JSON.stringify(t.cellConfidence) === JSON.stringify([[90]]));
}

// cellConfidence null no rompe
{
  const t = { rows: [['b'], ['a']], cellConfidence: null };
  api.sortTableRows(t, (a, b) => String(a[0]).localeCompare(String(b[0])));
  check('cellConfidence null: sin crash y sin tocar', t.cellConfidence === null && JSON.stringify(t.rows.map(r => r[0])) === JSON.stringify(['a', 'b']));
}

// vacio
{
  const t = { rows: [] };
  const out = api.sortTableRows(t, byCol1);
  check('rows vacio: devuelve [] sin crash', Array.isArray(out) && out.length === 0);
}

const rowsJSON = (t) => JSON.stringify(t.rows.map(r => r.map(String)));
const confJSON = (t) => JSON.stringify(t.cellConfidence);

// SNAPSHOT incluye cellConfidence como clon profundo
{
  const t = { headers: ['A'], rows: [['v']], cellConfidence: [[91]] };
  const snap = api.snapshotDataTable(t);
  t.rows[0][0] = 'z';
  t.cellConfidence[0][0] = 5;
  check('snapshot: cellConfidence clonada (no refleja la mutacion posterior)', snap.cellConfidence[0][0] === 91);
  check('snapshot: rows clonada igual que siempre', snap.rows[0][0] === 'v');
}

// RESTORE restaura cellConfidence alineada (deep copy)
{
  const t = mkTable();
  const before = api.snapshotDataTable(t);
  api.sortTableRows(t, byCol1Desc);
  api.restoreTableSnapshot(t, before);
  check('restore: filas vuelven al orden original', rowsJSON(t) === rowsJSON(mkTable()));
  check('restore: cellConfidence vuelve al orden original', confJSON(t) === confJSON(mkTable()));
  check('restore: llama a autoSaveTable', saveCalls.includes('t1'));
  t.cellConfidence[0][0] = 0;
  check('restore: la restauracion fue deep (mutar no afecta decisivo)', before.cellConfidence[0][0] === 92);
}

// UNDO logico de un sort: snapshot -> sort -> restore == estado original alineado
{
  const t = mkTable();
  const past = [api.snapshotDataTable(t)];
  const current = api.snapshotDataTable(t); // estado post-sort snapshot
  api.sortTableRows(t, byCol1);
  past.push(api.snapshotDataTable(t));
  globalThis.future = [current];
  api.restoreTableSnapshot(t, past[past.length - 2]);
  check('undo de sort: filas y confianza vuelven juntas al pre-sort', rowsJSON(t) === rowsJSON(mkTable()) && confJSON(t) === confJSON(mkTable()));
  check('undo de sort: la fila 1 vuelve a ser Ana(3)/92', t.rows[0][0] === 'Ana' && t.cellConfidence[0][0] === 92);
  delete globalThis.future;
}

// REDO logico: restaunrar el snapshot posterior deja confianza alineada al estado post-sort
{
  const t = mkTable();
  api.sortTableRows(t, byCol1Desc);
  const sortedSnap = api.snapshotDataTable(t);
  api.restoreTableSnapshot(t, api.snapshotDataTable(mkTable()));
  api.restoreTableSnapshot(t, sortedSnap);
  check('redo de sort: filas y confianza re-ordenadas juntas (desc)', rowsJSON(t) === JSON.stringify([['Beto', '100'], ['Caro', '20'], ['Ana', '3']]) && confJSON(t) === JSON.stringify([[88, 75], [95, 80], [92, 90]]));
  check('redo de sort: Beto(100)/75 queda en la fila 0', t.rows[0][0] === 'Beto' && t.cellConfidence[0][1] === 75);
}

// RESTORE backward-compat: snapshot sin cellConfidence conserva la matriz viva
{
  const t = { headers: ['A'], rows: [['x']], cellConfidence: [[90]] };
  api.restoreTableSnapshot(t, { headers: ['A'], rows: [['x']] });
  check('restore legacy: conserva cellConfidence', t.cellConfidence === undefined || JSON.stringify(t.cellConfidence) === JSON.stringify([[90]]));
}

// ANTI-REGRESION ESTATICA
check('anti-regresion: sortTableRows se usa en los 2 sitios de sort (modal + cabecera)', (wsCode.match(/sortTableRows\(table, \(/g) || []).length === 2);
check('anti-regresion: ya no queda table.rows.sort en workspace.js (solo Query usa result.rows.sort)', (wsCode.match(/table\.rows\.sort\(/g) || []).length === 0);
check('anti-regresion: snapshotDataTable incluye cellConfidence', wsCode.includes('cellConfidence: (table.cellConfidence || []).map(row => [...row])'));
check('anti-regresion: restoreTableSnapshot restaura cellConfidence', wsCode.includes('if (Array.isArray(snapshot.cellConfidence)) table.cellConfidence = snapshot.cellConfidence.map(row => [...row])'));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);