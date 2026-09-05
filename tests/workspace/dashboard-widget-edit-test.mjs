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

function grabBlock(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('no se encontro ' + needle);
  let start = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{' || src[j] === '[') { start = j; break; }
  }
  if (start < 0) throw new Error('sin bloque para ' + needle);
  let d = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') d--;
    if (d === 0 && j > start) return src.slice(i, j + 1);
  }
  throw new Error('final no encontrado para ' + needle);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');

const augSrc =
  grabBlock(wsCode, 'const DASHBOARD_WIDGET_TYPES = [') + '\n' +
  grabBlock(wsCode, 'const DASHBOARD_AGGREGATES = [') + '\n' +
  grabFn(wsCode, 'dashboardClampWidgetColumns') + '\n' +
  grabFn(wsCode, 'dashboardDefaultConfig') + '\n' +
  grabFn(wsCode, 'dashboardNormalizeConfig');

let nextId = 500;
const genId = () => 'wid-' + (nextId++);
const stubQueryNumber = (value) => {
  const n = Number(String(value ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const api = new Function('generateId', 'queryNumber', augSrc + '\nreturn { dashboardClampWidgetColumns, dashboardDefaultConfig, dashboardNormalizeConfig };')(genId, stubQueryNumber);

const tables = [
  { id: 't1', name: 'Ventas', headers: ['Producto', 'Importe'], rows: [['A', '10'], ['B', '20']] },
];

console.log('=== CE-133: widgets de dashboard editables + refs de columna clampeadas ===');
console.log('(dashboardClampWidgetColumns / dashboardNormalizeConfig REALES de workspace.js)');
console.log('');
console.log('--- 1. Clamp de refs de columna (dashboardClampWidgetColumns puro) ---');

{
  const widget = { field: 1, category: 0, columns: [0, 1] };
  const out = api.dashboardClampWidgetColumns(widget, 2);
  check('field valido se conserva', out.field === 1);
  check('category valido se conserva', out.category === 0);
  check('columns validas se conservan', JSON.stringify(out.columns) === JSON.stringify([0, 1]));
  check('no muta el widget original', widget.field === 1 && JSON.stringify(widget.columns) === JSON.stringify([0, 1]));
}

{
  const out = api.dashboardClampWidgetColumns({ field: 99, category: 99, columns: [0, 1, 9] }, 2);
  check('field fuera de rango -> "" (conteo de filas)', out.field === '');
  check('category fuera de rango -> 0', out.category === 0);
  check('columns fuera de rango filtradas', JSON.stringify(out.columns) === JSON.stringify([0, 1]));
  check('clamp: campo "" se mantiene como ""', out.field === '');
}

{
  const out = api.dashboardClampWidgetColumns({ field: '', category: -3, columns: null }, 3);
  check('field vacio conservado (nunca se convierte a numero)', out.field === '');
  check('category negativa -> 0', out.category === 0);
  check('sin columns: se derivan de headers (hasta 5)', JSON.stringify(out.columns) === JSON.stringify([0, 1, 2]));
}

{
  const out = api.dashboardClampWidgetColumns({ field: 0, category: 0 }, 0);
  check('width 0: field fuera -> ""', out.field === '');
  check('width 0: category -> 0', out.category === 0);
  check('width 0: columns vacias', JSON.stringify(out.columns) === JSON.stringify([]));
  check('width 0: sin crash y objeto valido', typeof out === 'object' && out.title === undefined);
}

{
  const out = api.dashboardClampWidgetColumns({ field: 2, category: 1 }, undefined);
  check('headersLength invalido -> width 0 seguro (field "")', out.field === '');
  check('headersLength invalido -> columns vacias', Array.isArray(out.columns) && out.columns.length === 0);
}

console.log('');
console.log('--- 2. dashboardNormalizeConfig clampea widgets guardados (funcion real) ---');

{
  const saved = {
    sourceId: 't1',
    title: 'Mi panel',
    filterColumn: '',
    filterValue: '',
    widgets: [
      { id: 'w1', type: 'bar', title: 'Por región', field: 99, category: 3, aggregate: 'sum', columns: [0, 1, 9] },
      { id: 'w2', type: 'kpi', title: 'Total', field: 1, aggregate: 'sum' },
      { id: 'w3', type: 'table', title: 'Detalle', columns: [5, 0, 1] },
      { id: 'w4', type: 'nope', title: '', aggregate: 'nope' },
    ],
  };
  const out = api.dashboardNormalizeConfig({ id: 'p1' }, tables, saved);
  check('normalize: field fuera de rango -> ""', out.widgets[0].field === '');
  check('normalize: category fuera de rango -> 0', out.widgets[0].category === 0);
  check('normalize: columns fuera de rango filtradas', JSON.stringify(out.widgets[0].columns) === JSON.stringify([0, 1]));
  check('normalize: field valido conservado', out.widgets[1].field === 1);
  check('normalize: table con columns parciales: solo validas', JSON.stringify(out.widgets[2].columns) === JSON.stringify([0, 1]));
  check('normalize: type invalido -> kpi', out.widgets[3].type === 'kpi');
  check('normalize: aggregate invalido -> count', out.widgets[3].aggregate === 'count');
  check('normalize: widget sin title -> "Visual N" (el find usa el type original invalido)', out.widgets[3].title === 'Visual 4');
  check('normalize: ids inexistentes se generan', // w1..w3 tienen id; w4 no
    out.widgets[0].id === 'w1' && out.widgets[1].id === 'w2' && out.widgets[3].id);
  check('normalize: sourceId conservado', out.sourceId === 't1');
  check('normalize: cloud filtros y titulo conservados', out.filterColumn === '' && out.title === 'Mi panel');
  check('normalize: no muta el saved original', saved.widgets[0].field === 99 && JSON.stringify(saved.widgets[2].columns) === JSON.stringify([5, 0, 1]));
}

{
  const out = api.dashboardNormalizeConfig({ id: 'p1' }, tables, null);
  check('normalize: sin saved -> defaults', out.title === 'Panel ejecutivo' && Array.isArray(out.widgets) && out.widgets.length === 4);
  check('normalize: defaults quedan validos (kpi count sin campo)', out.widgets[0].field === '' && out.widgets[0].aggregate === 'count');
}

{
  const out = api.dashboardNormalizeConfig({ id: 'p1' }, tables, { widgets: [] });
  check('normalize: saved sin widgets -> defaults.widgets', out.widgets.length === 4);
}

{
  const out = api.dashboardNormalizeConfig({ id: 'p1' }, [], { sourceId: 'ghost', widgets: [{ id: 'w', type: 'bar', title: 'X' }] });
  check('normalize: sin fuente -> headers 0, field/category/columns colapsados seguros', out.widgets[0].field === '' && out.widgets[0].category === 0 && JSON.stringify(out.widgets[0].columns) === JSON.stringify([]));
}

console.log('');
console.log('--- 3. Edicion de widgets (statica + contrato del modal) ---');

check('editar: openDashboardWidgetModal acepta (source, commitConfig, existing)', /function openDashboardWidgetModal\(source, commitConfig, existing\)/.test(wsCode));
check('editar: los 5 campos se precargan con existing', (wsCode.match(/if \(existing\) type\.value/g) || []).length === 1 && (wsCode.match(/if \(existing\) category\.value/g) || []).length === 1 && (wsCode.match(/if \(existing\) field\.value/g) || []).length === 1 && (wsCode.match(/if \(existing\) aggregate\.value/g) || []).length === 1 && wsCode.includes("value: existing ? (existing.title || 'Nuevo visual') : 'Nuevo visual'"));
check('editar: titulo del modal cambia en modo edicion', wsCode.includes("title: editing ? 'Editar visual' : 'Añadir visual al dashboard'") && wsCode.includes("confirmText: editing ? 'Guardar cambios' : 'Añadir visual'"));
check('editar: el commit de edicion reemplaza por id (sin re-push)', wsCode.includes('const widget = next.widgets.find(w => w.id === existing.id);') && wsCode.includes('if (widget) {'));
check('editar: en modo creacion sigue con push + id nuevo', wsCode.includes('next.widgets.push({') && wsCode.includes("}, editing ? 'Visual actualizado' : 'Visual añadido');"));
check('editar: el boton de la tarjeta abre el modal con el widget actual', wsCode.includes("actionButton('Editar visual', 'edit', () => openDashboardWidgetModal(source, commitConfig, widget))"));
check('editar: las demas acciones del widget se conservan', wsCode.includes("'Subir visual'") && wsCode.includes("'Bajar visual'") && wsCode.includes("'Duplicar visual'") && wsCode.includes("'Eliminar visual'"));
const normalizeSrcIndex = wsCode.indexOf('function dashboardNormalizeConfig');
const normalizeSrc = wsCode.slice(normalizeSrcIndex, wsCode.indexOf('\n}', normalizeSrcIndex));
check('clamp: dashboardNormalizeConfig usa dashboardClampWidgetColumns', normalizeSrc.includes('dashboardClampWidgetColumns({') && normalizeSrc.includes('headers.length)'));
check('clamp: el modal nuevo sigue creando columns (no chartTable)', /columns: defaultColumns/.test(wsCode));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);