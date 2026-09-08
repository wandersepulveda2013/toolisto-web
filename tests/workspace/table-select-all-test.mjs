#!/usr/bin/env node
/**
 * CE-148 — Ctrl+A en la vista de tabla selecciona TODA la tabla (y el Ctrl+C
 * posterior copia todo el grid). Antes el handler hacia setSelection(0,0,false)
 * (anchor Y focus en la esquina) y luego llenaba selection.endRow/endCol, pero
 * tableSelectionBounds solo lee anchor/focus: el barrido pintaba UNA celda y el
 * copy/cut/delete operaba sobre 1 celda. El fix extiende el focus real al final
 * (setSelection(rows-1, cols-1, true)) manteniendo el anchor en (0,0).
 */
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
const tableSelectionBounds = new Function(grabFn(wsCode, 'tableSelectionBounds') + '\nreturn tableSelectionBounds;')();
const selectedTableTsv = new Function(grabFn(wsCode, 'selectedTableTsv') + '\n' + grabFn(wsCode, 'tableSelectionBounds') + '\nreturn selectedTableTsv;')();

console.log('=== CE-148: Ctrl+A en la vista de tabla selecciona y copia TODA la tabla ===\n');

// --- ANCLAS ESTATICAS (rama del keydown de la tabla) ---
{
  const ctrlA = wsCode.indexOf("meta && event.key.toLowerCase() === 'a'");
  const branch = wsCode.slice(ctrlA, wsCode.indexOf("if (event.key === 'Home')"));
  const code = branch.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  check('ancla: la rama Ctrl+A del keydown de la tabla existe', ctrlA >= 0, '');
  check('ancla: ancla la esquina con setSelection(0, 0, false)', code.includes('setSelection(0, 0, false);'), '');
  check('ancla: extiende el focus REAL al final (setSelection(rows-1, cols-1, true))',
    code.includes('setSelection(table.rows.length - 1, table.headers.length - 1, true);'), '');
  check('ancla: guard de tabla vacia (headers/rows >= 1) antes de extender', code.includes('table.rows.length >= 1 && table.headers.length >= 1'), '');
  check('ancla: el mecanismo muerto endRow/endCol quedo eliminado', !code.includes('selection.endRow') && !code.includes('selection.endCol'), '');
  check('ancla: la rama conserva preventDefault', code.includes('event.preventDefault();'), '');
  check('ancla: ya no llama a markTableSelection a mano (setSelection la invoca)', !code.includes('markTableSelection('), '');
}

// --- RAZON DEL BUG: tableSelectionBounds NO lee endRow/endCol ---
{
  const sel = { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0, endRow: 99, endCol: 99, hasValue: true };
  const b = tableSelectionBounds(sel);
  check('regresion: con anchor=focus=(0,0), endRow/endCol 99 NO agrandan el rectangulo (por eso el bug)',
    JSON.stringify(b) === JSON.stringify({ top: 0, bottom: 0, left: 0, right: 0 }), JSON.stringify(b));
}

// --- COMPORTAMIENTO (funciones REALES): replica fiel del handler fix ---
function applySelectAll(sel, rows, cols) {
  // Replica exacta de las decisiones de estado de setSelection en el handler
  // Ctrl+A (workspace.js): extend preserva el anchor cuando hay seleccion.
  const setSelection = (row, col, extend) => {
    if (!extend || !sel.hasValue) { sel.anchorRow = row; sel.anchorCol = col; }
    sel.focusRow = row; sel.focusCol = col; sel.hasValue = true;
  };
  setSelection(0, 0, false);
  if (rows >= 1 && cols >= 1) setSelection(rows - 1, cols - 1, true);
  return sel;
}

{
  const table = { rows: [['a1', 'b1', 'c1', 'd1'], ['a2', 'b2', 'c2', 'd2'], ['a3', 'b3', 'c3', 'd3']], headers: ['A', 'B', 'C', 'D'] };
  const sel = applySelectAll({ hasValue: false }, table.rows.length, table.headers.length);
  const b = tableSelectionBounds(sel);
  check('3x4: bounds cubren TODA la grilla (0,0)-(2,3)', JSON.stringify(b) === JSON.stringify({ top: 0, bottom: 2, left: 0, right: 3 }), JSON.stringify(b));
  check('3x4: anchor sigue en la esquina (0,0)', sel.anchorRow === 0 && sel.anchorCol === 0, `anchor(${sel.anchorRow},${sel.anchorCol})`);
  check('3x4: focus real en la ultima celda', sel.focusRow === 2 && sel.focusCol === 3, `focus(${sel.focusRow},${sel.focusCol})`);
  const tsv = selectedTableTsv(table, sel);
  check('3x4: Ctrl+C (selectedTableTsv) copia las 12 celdas en TSV',
    tsv === 'a1\tb1\tc1\td1\na2\tb2\tc2\td2\na3\tb3\tc3\td3', JSON.stringify(tsv));
}

{
  const table = { rows: [['u']], headers: ['X'] };
  const sel = applySelectAll({ hasValue: false }, table.rows.length, table.headers.length);
  const b = tableSelectionBounds(sel);
  check('1x1: bounds = la unica celda', JSON.stringify(b) === JSON.stringify({ top: 0, bottom: 0, left: 0, right: 0 }), JSON.stringify(b));
  check('1x1: Ctrl+C copia la celda', selectedTableTsv(table, sel) === 'u', '');
}

{
  const sel = applySelectAll({ hasValue: false }, 0, 3);
  check('tabla sin filas: no se extiende a indices -1 (bounds de 1 celda segura)',
    JSON.stringify(tableSelectionBounds(sel)) === JSON.stringify({ top: 0, bottom: 0, left: 0, right: 0 }), '');
  check('tabla sin filas: hasValue activo igual que antes del fix', sel.hasValue === true, '');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);