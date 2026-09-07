#!/usr/bin/env node
/**
 * D-14 — keydown global y topbar NO referencian `rerenderTable` fuera de scope.
 *
 * Bug latente pre-existente: `rerenderTable` es un closure definido DENTRO de
 * `renderDataTableView`. Los botones Deshacer/Rehacer del topbar y el listener
 * global de keydown (Ctrl+Z / Ctrl+Y) lo invocaban desde el scope de modulo
 * (updateTopbar / initApp), donde la variable no existe -> ReferenceError al
 * deshacer/rehacer una celda en la vista data-table (la edicion se aplicaba
 * pero la grilla no se re-renderizaba y la consola registraba el error).
 *
 * Fix: holder de modulo `_activeTableRerender` + helper seguro
 * `rerenderActiveTable()`. `renderDataTableView` registra su closure al montar
 * la vista y `renderView` limpia el holder al navegar fuera. Los cuatro call
 * sites fuera de scope (topbar undo/redo, keydown undo/redo) usan el helper.
 *
 * Test de anclas estaticas: fija el contrato para que un futuro refactor no
 * vuelva a conectar un call site fuera de scope a la closure local.
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

console.log('=== D-14: undo/redo global no rompe el scope de rerenderTable ===\n');

const wsSource = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

// --- 1. Helper de modulo con guarda ------------------------------------------
check(/function rerenderActiveTable\(\) \{\n  if \(typeof _activeTableRerender === 'function'\) _activeTableRerender\(\);\n\}/.test(wsSource),
  'existe rerenderActiveTable() como funcion de modulo que solo llama si _activeTableRerender es funcion');

check(wsSource.includes('let _activeTableRerender = null;'),
  'existe el holder de modulo _activeTableRerender inicializado a null');

// --- 2. Los 4 call sites fuera de scope usan el helper ------------------------
check((wsSource.match(/rerenderActiveTable\(\); toast\('Cambio deshecho', 'success'\);/g) || []).length === 2,
  'los DOS call sites de undo (topbar + keydown) usan rerenderActiveTable()');

check((wsSource.match(/rerenderActiveTable\(\); toast\('Cambio rehecho', 'success'\);/g) || []).length === 2,
  'los DOS call sites de redo (topbar + keydown) usan rerenderActiveTable()');

// --- 3. Ningun call site fuera del closure llama rerenderTable() --------------
// renderDataTableView empieza en 'function renderDataTableView(' y termina en la
// primera 'function ' al mismo nivel despues de ella (addColumn). Todos los usos
// de rerenderTable() deben vivir dentro de ese rango.
const fnStart = wsSource.indexOf('function renderDataTableView(');
const fnEnd = wsSource.indexOf('function addColumn(');
check(fnStart !== -1 && fnEnd !== -1 && fnEnd > fnStart, 'localizados los limites de renderDataTableView');

const outOfScopeCalls = [];
if (fnStart !== -1 && fnEnd !== -1) {
  const re = /rerenderTable\(\)/g;
  let m;
  while ((m = re.exec(wsSource)) !== null) {
    if (m.index < fnStart || m.index > fnEnd) outOfScopeCalls.push(m.index);
  }
}
check(outOfScopeCalls.length === 0,
  `cero referencias a rerenderTable() fuera del closure de renderDataTableView (${outOfScopeCalls.length} encontradas)`);

// --- 4. Registro y limpieza del holder ---------------------------------------
const regIdx = wsSource.indexOf('_activeTableRerender = rerenderTable;');
check(regIdx !== -1 && regIdx > fnStart && regIdx < fnEnd,
  'renderDataTableView registra el closure en _activeTableRerender dentro de su cuerpo');

const navIdx = wsSource.indexOf('_activeTableRerender = null;');
const renderViewIdx = wsSource.indexOf('function renderView(');
check(navIdx !== -1 && renderViewIdx !== -1 && navIdx < fnStart,
  'renderView limpia _activeTableRerender a null antes de navegar (fuera de renderDataTableView)');

// --- 5. La registracion NO rompe el contrato CE-139 ---------------------------
const rerenderMatch = wsSource.match(/const rerenderTable = \(\) => \{([\s\S]*?)\n  \};/);
check(!!rerenderMatch && rerenderMatch[1].includes('renderGrid()'),
  'el closure rerenderTable conserva su contrato (delega en renderGrid, CE-139)');

check(!rerenderMatch[1].includes('container.replaceChildren(); renderDataTableView(container);'),
  'el closure rerenderTable sigue siendo grid-only (sin full render, CE-139)');

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);