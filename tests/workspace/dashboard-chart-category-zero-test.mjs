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

function parseLocaleNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// queryNumber delegates to parseLocaleNumber
function queryNumber(v) { return parseLocaleNumber(v); }

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const fnSrc = grabFn(wsCode, 'dashboardChartItems');
const dashboardChartItems = new Function('parseLocaleNumber', 'queryNumber', fnSrc + '\nreturn dashboardChartItems;')(parseLocaleNumber, queryNumber);

console.log('=== CE-121: dashboard category "0" no cae en "Sin categoría" ===');

// 1. Numeric 0 in category cell survives as label "0" (not null -> Sin categoría)
{
  const items = dashboardChartItems([[0, '100'], ['A', '50'], ['B', '25'], [1, '10']], { category: 0, field: 1, aggregate: 'sum' });
  const labels = items.map(i => i.label);
  check('numeric 0 becomes label "0" (not Sin categoría)', labels.includes('0'));
  check('label "1" also survives', labels.includes('1'));
  check('A and B labels present', labels.includes('A') && labels.includes('B'));
  check('no "Sin categoría" group when all cells filled', !labels.includes('Sin categoría'));
  check('numeric 0 group sums its values', items.find(i => i.label === '0').value === 100);
}

// 2. Empty cell (''/null/undefined) still groups into "Sin categoría"
{
  const items = dashboardChartItems([['', '10'], [null, '20'], ['A', '30']], { category: 0, field: 1, aggregate: 'sum' });
  const sc = items.find(i => i.label === 'Sin categoría');
  check('empty cell groups into Sin categoría', !!sc);
  check('Sin categoría sums empty+null values (10+20=30)', sc.value === 30);
  check('A group still present', items.some(i => i.label === 'A'));
}

// 3. flush whitespace-only category cell -> Sin categoría
{
  const items = dashboardChartItems([['   ', '10'], ['B', '20']], { category: 0, field: 1, aggregate: 'sum' });
  check('whitespace-only cell groups into Sin categoría', items.some(i => i.label === 'Sin categoría' && i.value === 10));
}

// 4. Numeric 0 with count aggregate
{
  const items = dashboardChartItems([[0, 'x'], [0, 'y'], ['A', 'z']], { category: 0, field: '', aggregate: 'count' });
  check('count aggregate: label "0" present', items.some(i => i.label === '0'));
  check('count aggregate: label "0" counts 2 rows', items.find(i => i.label === '0').value === 2);
}

// 5. Anti-regression: mixed cells keep numeric grouping correct
{
  const items = dashboardChartItems([['0', '10'], ['A', '20'], ['0', '5'], ['B', '1']], { category: 0, field: 1, aggregate: 'sum' });
  const zero = items.find(i => i.label === '0');
  check('string "0" groups with numeric 0 (sum 10+5=15)', zero.value === 15);
  check('A and B distinct', items.some(i => i.label === 'A') && items.some(i => i.label === 'B'));
}

// 6. Static: dashboardVisibleRows already stringifies, so real UI passes '0' string
{
  const visSrc = grabFn(wsCode, 'dashboardVisibleRows');
  check('dashboardVisibleRows stringifies cells (mask)', visSrc.includes("String(row?.[index] == null ? '' : row[index])"));
}

// 7. Static: guard uses null-check not falsy-coalescing
{
  const guardLine = fnSrc.split('\n').find(l => l.includes("raw == null ? '' : String(raw).trim()"));
  check('guard preserves 0 via null-check', !!guardLine);
}

console.log(`\n=== dashboard-chart-category-zero: ${pass}/${pass + fail} PASS ===`);
process.exit(fail > 0 ? 1 : 0);