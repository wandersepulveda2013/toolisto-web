#!/usr/bin/env node
/**
 * CE-145 (parte R4) — markTableSelection incremental:
 *   markTableSelection ya NO recorre todas las celdas td[data-row][data-col]
 *   en cada pulsacion de tecla (flechas/Tab/Home/End pasan por setSelection →
 *   markTableSelection en cada tecla). Ahora:
 *     - Guarda el ultimo rectangulo marcado por tableEl (WeakMap) junto con el
 *       tbody al que pertenecio.
 *     - Si el tbody es el mismo y el rectangulo cambio, aplica la diferencia
 *       simetrica (tableSelectionDiff → bandas disjuntas) y la transicion de
 *       foco: solo se tocan las celdas cuyo estado cambia (O(perimetro del
 *       cambio), no O(area total)).
 *     - El barrido completo queda reservado al primer marcado o a un tbody
 *       recien reinstalado (rerender con DOM nuevo), donde no hay estado
 *       previo que reutilizar.
 *     - renderGrid registra un indice fila→<tr> (gridRowMap) por tbody para que
 *       la busqueda incremental de celdas sea O(1) por fila.
 *
 * El test valida:
 *   1. Anclas estaticas: las piezas nuevas existen y el barrido completo solo
 *      aparece como fallback (no como primer camino).
 *   2. Comportamiento puro de tableSelectionDiff (extraido y ejecutado): la
 *      diferencia simetrica es correcta para mover celda, crecer, encoger,
 *      cruzar sin solape y rectangulos identicos.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  PASS: ${msg}`); }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

console.log('=== Data-table selection incremental (CE-145 R4) ===\n');

const wsSource = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

// --- 1. Anclas estaticas ------------------------------------------------------
check(wsSource.includes('const _tableSelectionMarks = new WeakMap();'),
  '_tableSelectionMarks es un WeakMap (estado por tableEl)');
check(wsSource.includes('const _gridRowIndex = new WeakMap();'),
  '_gridRowIndex es un WeakMap (indice fila→tr por tbody)');
check(wsSource.includes('function tableSelectionDiff(prev, curr) {'),
  'existe la funcion pura tableSelectionDiff(prev, curr)');
check(wsSource.includes('tableSelectionDiff(prev.bounds, bounds).forEach(rect => {'),
  'markTableSelection usa la diferencia simetrica cuando hay estado previo');
check(wsSource.includes('cell.classList.toggle(\'selected\', rect.active)'),
  'las bandas de la diferencia solo tocan la clase selected');
check(wsSource.includes("prevFocus.classList.remove('selected-focus')"),
  'la transicion de foco quita selected-focus de la celda previa');
check(wsSource.includes("nextFocus.classList.add('selected-focus')"),
  'la transicion de foco anade selected-focus a la celda nueva');
check(wsSource.includes("if (prev && prev.body === tbody && !sameSelectionRect(prev.bounds, bounds)) {"),
  'la ruta incremental exige mismo tbody y rectangulo distinto');
check(wsSource.includes("$$('td[data-row][data-col]', tableEl).forEach(cell => {"),
  'el barrido completo sigue existiendo como fallback');
check(wsSource.includes('gridRowMap.set(ri, tr);'),
  'renderGrid registra cada fila en el indice gridRowMap');
check(wsSource.includes('_gridRowIndex.set(tbody, gridRowMap);'),
  'renderGrid deja el indice asociado al tbody en _gridRowIndex');
check(wsSource.includes('function gridRowLookup(tableEl, row) {'),
  'existe gridRowLookup (busqueda O(1) de fila por fila)');
check(wsSource.includes('function gridCellAt(tableEl, row, col) {'),
  'existe gridCellAt (localizacion directa de una celda)');
check(wsSource.includes('function forEachGridCellInRect(tableEl, rect, fn) {'),
  'existe forEachGridCellInRect (itera solo el rectangulo pedido)');
check(!wsSource.includes('$$(\'td[data-row][data-col]\', tableEl).forEach(cell => {\n    const row = Number(cell.dataset.row);\n    const col = Number(cell.dataset.col);\n    const active = row >= bounds.top'),
  'el barrido completo ya NO es el unico cuerpo de markTableSelection (no es el primer camino incondicional)');

// --- 2. La ruta incremental se usa en los atajos de seleccion -----------------
check(wsSource.includes('markTableSelection(tableEl, selection)') &&
  wsSource.includes('tableEl.addEventListener(\'keydown\', event => {'),
  'markTableSelection sigue conectado al keydown de la tabla');

// --- 3. Comportamiento de tableSelectionDiff (ejecucion real) -----------------
console.log('\n--- tableSelectionDiff: comportamiento puro ---');

function grabFn(source, name) {
  const lines = source.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('Function not found: ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('Unbalanced function: ' + name);
}

const tableSelectionDiff = new Function('return (' + grabFn(wsSource, 'tableSelectionDiff') + ')')();
const sameSelectionRect = new Function('return (' + grabFn(wsSource, 'sameSelectionRect') + ')')();

function rectsToKey(rects) {
  return rects
    .map(r => `${r.top},${r.bottom},${r.left},${r.right}:${r.active ? 1 : 0}`)
    .sort()
    .join('|');
}

// Mover una celda seleccionada sin Shift: setSelection fija anchor Y focus en la
// celda destino, por lo que el rectangulo previo {0,0} y el nuevo {1,1} son
// disjuntos: solo se tocan 2 celdas (la anterior off, la nueva on).
let diff = tableSelectionDiff({ top: 0, bottom: 0, left: 0, right: 0 }, { top: 0, bottom: 0, left: 1, right: 1 });
check(rectsToKey(diff) === '0,0,0,0:0|0,0,1,1:1',
  'mover una celda a la derecha desmarca la anterior y marca la nueva: ' + rectsToKey(diff));
check(diff.length === 2, 'mover una celda produce exactamente 2 bandas (1 off, 1 on), no toda la cuadricula');

// Extender con Shift+Arrow a la derecha: el rectangulo crece y la celda previa
// SIGUE seleccionada; solo se marca la columna nueva.
diff = tableSelectionDiff({ top: 0, bottom: 0, left: 0, right: 0 }, { top: 0, bottom: 0, left: 0, right: 1 });
check(rectsToKey(diff) === '0,0,1,1:1',
  'extender con Shift+Arrow solo marca la columna nueva (la antigua sigue seleccionada): ' + rectsToKey(diff));

// Crecer la seleccion con Shift+Arrow (0..2 x 0..2 -> 0..2 x 0..3)
diff = tableSelectionDiff({ top: 0, bottom: 2, left: 0, right: 2 }, { top: 0, bottom: 2, left: 0, right: 3 });
check(rectsToKey(diff) === '0,2,3,3:1',
  'crecer a la derecha solo marca la columna nueva (banda unica on): ' + rectsToKey(diff));

// Encoger con Shift+Arrow (0..4 x 0..4 -> 1..3 x 1..3)
diff = tableSelectionDiff({ top: 0, bottom: 4, left: 0, right: 4 }, { top: 1, bottom: 3, left: 1, right: 3 });
check(rectsToKey(diff) === '0,0,0,4:0|1,3,0,0:0|1,3,4,4:0|4,4,0,4:0',
  'encoger desmarca solo 4 bandas (arriba, abajo, izquierda, derecha): ' + rectsToKey(diff));

// Rectangulos disjuntos (Ctrl+Home style jump)
diff = tableSelectionDiff({ top: 0, bottom: 0, left: 0, right: 0 }, { top: 9, bottom: 9, left: 5, right: 5 });
check(rectsToKey(diff) === '0,0,0,0:0|9,9,5,5:1',
  'salto disjunto produce exactamente 2 bandas (1 off, 1 on): ' + rectsToKey(diff));

// Rectangulos identicos: sin bandas (sin trabajo)
diff = tableSelectionDiff({ top: 1, bottom: 2, left: 3, right: 4 }, { top: 1, bottom: 2, left: 3, right: 4 });
check(diff.length === 0, 'rectangulos identicos producen 0 bandas (cero trabajo): ' + rectsToKey(diff));

// Crecimiento en ambas dimensiones: solo anade la fila nueva completa (ancho
// completo del nuevo rectangulo) y la columna nueva (alto del rectangulo
// anterior). El interior compartido nunca se toca.
diff = tableSelectionDiff({ top: 0, bottom: 1, left: 0, right: 1 }, { top: 0, bottom: 2, left: 0, right: 2 });
check(rectsToKey(diff) === '0,1,2,2:1|2,2,0,2:1',
  'crecer en ambas dimensiones produce la columna nueva (rows 0..1) y la fila nueva (cols 0..2): ' + rectsToKey(diff));

// Foco dentro del area: la diferencia no incluye celdas del interior
diff = tableSelectionDiff({ top: 0, bottom: 3, left: 0, right: 3 }, { top: 0, bottom: 3, left: 1, right: 3 });
check(rectsToKey(diff) === '0,3,0,0:0',
  'mover foco con anchor fijo desmarca solo la columna izquierda: ' + rectsToKey(diff));

// Propiedad: area(bandas on) - area(bandas off) == area(curr) - area(prev)
function rectArea(r) { return (r.bottom - r.top + 1) * (r.right - r.left + 1); }
function areaDelta(prev, curr, bands) {
  return bands.reduce((acc, r2) => acc + (r2.active ? rectArea(r2) : -rectArea(r2)), 0);
}
const samples = [
  [{ top: 0, bottom: 0, left: 0, right: 0 }, { top: 0, bottom: 0, left: 0, right: 1 }],
  [{ top: 0, bottom: 4, left: 0, right: 4 }, { top: 1, bottom: 3, left: 1, right: 3 }],
  [{ top: 0, bottom: 1, left: 0, right: 1 }, { top: 0, bottom: 2, left: 0, right: 2 }],
  [{ top: 0, bottom: 0, left: 0, right: 0 }, { top: 9, bottom: 9, left: 5, right: 5 }],
];
let invOk = true;
for (const [p, c] of samples) {
  const bands = tableSelectionDiff(p, c);
  const expect = rectArea(c) - rectArea(p);
  if (areaDelta(p, c, bands) !== expect) invOk = false;
}
check(invOk, 'invariante: area(on) - area(off) == area(curr) - area(prev) en todas las muestras');

// --- 4. sameSelectionRect -----------------------------------------------------
check(sameSelectionRect({ top: 1, bottom: 2, left: 3, right: 4 }, { top: 1, bottom: 2, left: 3, right: 4 }) === true,
  'sameSelectionRect detecta rectangulos identicos');
check(sameSelectionRect({ top: 1, bottom: 2, left: 3, right: 4 }, { top: 1, bottom: 2, left: 3, right: 5 }) === false,
  'sameSelectionRect detecta rectangulos distintos');

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);