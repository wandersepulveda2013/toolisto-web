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
const tdSrc = grabFn(wsCode, 'tableChartData');
function parseLocaleNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const tableChartData = new Function('parseLocaleNumber', tdSrc + '\nreturn tableChartData;')(parseLocaleNumber);

console.log('=== CE-119: tableChartData guards for <2 headers ===');

// 1. 1 header only — returns empty series, numericIndex null
{
  const result = tableChartData({ headers: ['Name'], rows: [['Alice'], ['Bob']] });
  check('1 header: series is empty', result.series.length === 0);
  check('1 header: numericIndex is null', result.numericIndex === null);
}

// 2. 0 headers — returns empty series, numericIndex null
{
  const result = tableChartData({ headers: [], rows: [['Alice']] });
  check('0 headers: series is empty', result.series.length === 0);
  check('0 headers: numericIndex is null', result.numericIndex === null);
}

// 3. No headers at all — returns empty series, numericIndex null
{
  const result = tableChartData({});
  check('missing headers: series is empty', result.series.length === 0);
  check('missing headers: numericIndex is null', result.numericIndex === null);
}

// 4. null table — returns empty series, numericIndex null
{
  const result = tableChartData(null);
  check('null table: series is empty', result.series.length === 0);
  check('null table: numericIndex is null', result.numericIndex === null);
}

// 5. 2 headers with numeric data — works normally
{
  const result = tableChartData({ headers: ['City', 'Pop'], rows: [['Lima', '100'], ['Cuzco', '50']] });
  check('2 headers: series has 2 items', result.series.length === 2);
  check('2 headers: numericIndex is 1', result.numericIndex === 1);
  check('2 headers: first value 100', result.series[0].value === 100);
}

// 6. 3 headers — picks best numeric column
{
  const result = tableChartData({
    headers: ['Name', 'Text', 'Score'],
    rows: [['Ana', 'hello', '95'], ['Luis', 'world', '80']]
  });
  check('3 headers: numericIndex is 2 (Score)', result.numericIndex === 2);
  check('3 headers: series has 2 items', result.series.length === 2);
}

// 7. 1 header with empty rows — returns empty
{
  const result = tableChartData({ headers: ['Only'], rows: [] });
  check('1 header empty rows: series is empty', result.series.length === 0);
  check('1 header empty rows: numericIndex is null', result.numericIndex === null);
}

// 8. 2 headers but all non-numeric second column — series is empty but numericIndex valid
{
  const result = tableChartData({ headers: ['A', 'B'], rows: [['x', 'text'], ['y', 'more']] });
  check('2 headers non-numeric: series is empty (no numeric values)', result.series.length === 0);
  check('2 headers non-numeric: numericIndex is 1 (column exists)', result.numericIndex === 1);
}

// 9. Anti-regression: tableChartSeries wrapper returns just series
{
  const wsCode2 = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
  const tsSrc = grabFn(wsCode2, 'tableChartSeries');
  const tableChartSeries = new Function('tableChartData', tsSrc + '\nreturn tableChartSeries;')(tableChartData);
  const result = tableChartSeries({ headers: ['X'], rows: [['a']] });
  check('tableChartSeries 1 header: returns empty series', Array.isArray(result) && result.length === 0);
  const result2 = tableChartSeries({ headers: ['X', 'Y'], rows: [['a', '10']] });
  check('tableChartSeries 2 headers: returns series', result2.length === 1);
}

// 10. workflow-operations.js tableChartSeries also has the guard
{
  const wfCode = readFileSync(new URL('../../workspace/core/workflow-operations.js', import.meta.url), 'utf8');
  const wfSrc = grabFn(wfCode, 'tableChartSeries');
  check('workflow tableChartSeries has length<2 guard', wfSrc.includes('safeHeaders.length < 2'));
  const tableChartSeriesWf = new Function('parseLocaleNumber', wfSrc + '\nreturn tableChartSeries;')(parseLocaleNumber);
  const r1 = tableChartSeriesWf(['Only'], [['a']]);
  check('workflow tableChartSeries 1 header: empty series', r1.series.length === 0);
  check('workflow tableChartSeries 1 header: numericIndex null', r1.numericIndex === null);
  const r2 = tableChartSeriesWf(['A', 'B'], [['x', '42']]);
  check('workflow tableChartSeries 2 headers: works', r2.series.length === 1);
}

// 11. workspace.js tableChartData has length<2 guard
{
  check('workspace tableChartData has length<2 guard', tdSrc.includes('headers.length < 2'));
}

// 12. syncDerivedCharts has length<2 guard
{
  const syncIdx = wsCode.indexOf('async function syncDerivedCharts');
  const syncBody = wsCode.slice(syncIdx, syncIdx + 400);
  check('syncDerivedCharts has length<2 guard', syncBody.includes('length < 2'));
}

console.log(`\n=== table-chart-oob-guard: ${pass}/${pass + fail} PASS ===`);
process.exit(fail > 0 ? 1 : 0);
