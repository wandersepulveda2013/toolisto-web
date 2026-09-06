#!/usr/bin/env node
/**
 * CE-139 — data-table rerender scope: rerenderTable ya NO reconstruye la vista
 * completa (toolbar/ribbon/formula-bar/sheet-tabs, con todos sus closures y
 * listeners). Reinstala solo el grid (thead + tbody) dentro del MODO tableEl:
 *   - El swap usa renderGrid() (mismo codigo del montaje inicial: una sola
 *     definicion para ambos paths de vida).
 *   - Se preservan los listeners de tabla (copy/cut/paste/keydown), el estado
 *     de seleccion y el valor del formula bar.
 *   - El path estructural (applyClipboardGrid / cambio de hoja) sigue usando el
 *     full render SO LO cuando la estructura (headers/rows) cambia.
 *
 * Ahora es un test de anclas estaticas: un gate que fija el contrato de render
 * contract so a future refactor cannot silently reintroduce the O(N) full
 * rebuild on every cell-level operation.
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

console.log('=== Data-table rerender scope (CE-139) ===\n');

const wsSource = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

// --- 1. rerenderTable: body extraido del closure -----------------------------
const rerenderMatch = wsSource.match(/const rerenderTable = \(\) => \{([\s\S]*?)\n  \};/);
check(!!rerenderMatch, 'rerenderTable sigue siendo una arrow function que actua sobre el container');
const rerenderBody = rerenderMatch ? rerenderMatch[1] : '';

check(rerenderBody.includes('renderGrid()'),
  'rerenderTable delega en renderGrid()');
check(!rerenderBody.includes('container.replaceChildren(); renderDataTableView(container);'),
  'rerenderTable NO repinta el container completo (anti-regresion: antes hacía replaceChildren + renderDataTableView)');
check(!rerenderBody.includes('renderDataTableView(container)'),
  'rerenderTable NO vuelve a montar renderDataTableView');
check(rerenderBody.includes("existingHead.replaceWith(mounted.head)"),
  'rerenderTable reemplaza in-place el thead existente');
check(rerenderBody.includes("existingBody.replaceWith(mounted.body)"),
  'rerenderTable reemplaza in-place el tbody existente');
check(rerenderBody.includes('markTableSelection(tableEl, selection)'),
  'rerenderTable restaura la seleccion visual sobre el grid nuevo');
check(rerenderBody.includes('formulaInput.value'),
  'rerenderTable refresca el formula bar sin reconstruir el input');
check(!rerenderBody.includes('formulaInput = h('),
  'rerenderTable NO recrea el input de formula');
check(!rerenderBody.includes('sheetTabs'), 'rerenderTable NO reconstruye las pestañas de hoja');
check(!rerenderBody.includes('toolbarGroup('), 'rerenderTable NO reconstruye los grupos de la ribbon');
check(!rerenderBody.includes('toolbarTop'), 'rerenderTable NO reconstruye la barra superior');

// --- 2. renderGrid: una sola definicion montada y reutilizada -----------------
check((wsSource.match(/const renderGrid = \(\) => \{/g) || []).length === 1,
  'renderGrid se define una sola vez en workspace.js');

const mountIdx = wsSource.indexOf('const mountedGrid = renderGrid();');
const gridDefIdx = wsSource.indexOf('const renderGrid = () => {');
check(gridDefIdx !== -1 && mountIdx > gridDefIdx,
  'renderGrid se define ANTES de su montaje inicial');
check(mountIdx !== -1,
  'el montaje inicial usa renderGrid()');
check(wsSource.includes('tableEl.appendChild(mountedGrid.head);') && wsSource.includes('tableEl.appendChild(mountedGrid.body);'),
  'el montaje inicial anade head y body devueltos por renderGrid');

const gridBody = gridDefIdx !== -1 && mountIdx > gridDefIdx
  ? wsSource.slice(gridDefIdx, mountIdx)
  : '';

check(gridBody.includes("const thead = h('thead');"), 'renderGrid construye thead');
check(gridBody.includes('thead.appendChild(headerRow);'), 'renderGrid anade la fila de cabecera');
check(gridBody.includes("const tbody = h('tbody');"), 'renderGrid construye tbody');
check(gridBody.includes("tr.appendChild(h('td', { className: 'row-number' }, String(ri + 1)));"),
  'renderGrid conserva la columna de numeros de fila');
check(gridBody.includes("td.addEventListener('click', event => setSelection(ri, ci, event.shiftKey));"),
  'renderGrid conserva la seleccion por click (una sola definicion)');
check(gridBody.includes("td.addEventListener('dblclick', () => {"), 'renderGrid conserva la edicion por dblclick');
check(gridBody.includes('return { head: thead, body: tbody };'), 'renderGrid devuelve head+body');
check(!gridBody.includes("tableEl.addEventListener('copy'"), 'renderGrid NO re-suscribe el listener copy');
check(!gridBody.includes("tableEl.addEventListener('cut'"), 'renderGrid NO re-suscribe el listener cut');
check(!gridBody.includes("tableEl.addEventListener('paste'"), 'renderGrid NO re-suscribe el listener paste');
check(!gridBody.includes("tableEl.addEventListener('keydown'"), 'renderGrid NO re-suscribe el listener keydown');
check(!gridBody.includes('gridContainer.appendChild(tableEl)'), 'renderGrid NO vuelve a montar el table en el container');
check(!gridBody.includes('container.replaceChildren'), 'renderGrid no repinta el container');

// --- 3. Listeners de tabla: exactamente una vez por evento --------------------
for (const evt of ['copy', 'cut', 'paste', 'keydown']) {
  check((wsSource.match(new RegExp(`tableEl\\.addEventListener\\('${evt}'`)) || []).length === 1,
    `listener tableEl.${evt} suscrito exactamente una vez`);
}

// --- 4. El full render estructural sigue existiendo donde toca ----------------
check(wsSource.includes('container.replaceChildren();\n  renderDataTableView(container);'),
  'el full render estructural (paste que extiende headers/rows y cambio de hoja) sigue presente');
check(!wsSource.includes('const rerenderTable = () => { container.replaceChildren(); renderDataTableView(container); };'),
  'el cuerpo antiguo inline de rerenderTable (una linea) ha desaparecido');

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);