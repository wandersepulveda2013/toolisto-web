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
const exportSrc = grabFn(wsCode, 'exportTableCSV');

let capturedBlob = null;
let clickedA = null;
function h(tag, attrs) { clickedA = { tag, ...attrs, click() { this.clicked = true; } }; return clickedA; }
function toast() {}

function makeFn() {
  globalThis.Blob = class { constructor(parts, opts) { capturedBlob = String(parts[0]); this.opts = opts; } };
  globalThis.URL = { createObjectURL() { return 'blob://x'; }, revokeObjectURL() {} };
  return new Function('h', 'toast', exportSrc + '\nreturn exportTableCSV;')(h, toast);
}

console.log('=== CE-101: exportTableCSV escapa headers y coacciona celdas (CSV valido) ===');
console.log('(exportTableCSV REAL; DOM/Blob/URL stub)');

// 1. Header con comas y un nombre con comillas se escapa correctamente (Bug A)
{
  const table = {
    name: 'Precios', headers: ['Precio, USD', '"Nomina"', 'Cantidad'],
    rows: [['5', 'x', '10'], ['6', 'y', '3']],
  };
  capturedBlob = null;
  makeFn()(table);
  const csv = capturedBlob;
  check('header con coma queda entre comillas', csv.startsWith('"Precio, USD"', 1), csv.split('\n')[0]);
  check('header con comillas se duplica al escapar', csv.includes('"""Nomina"""'), csv.split('\n')[0]);
  check('el CSV conserva el BOM', csv[0] === '\uFEFF');
  check('la primera fila de datos queda intacta', csv.includes('5,x,10'), csv.split('\n')[1]);
}

// 2. Celdas null/undefined/numero/booleano no lanzan y se coaccionan a string (Bug B)
{
  const table = {
    name: 'D', headers: ['A', 'B', 'C', 'D'],
    rows: [[null, undefined, 42, true], ['1', '2', '3', '4']],
  };
  capturedBlob = null;
  let threw = false;
  try {
    makeFn()(table);
  } catch (e) { threw = true; }
  check('celdas no-string no lanzan TypeError', !threw, threw ? 'threw ' + String(threw) : '');
  const csv = capturedBlob;
  check('header fila correcto', csv.startsWith('A,B,C,D', 1), csv.split('\n')[0]);
  check('null/undefined/numero/booleano coaccionados', csv.includes(',,42,true'), csv.split('\n')[1]);
}

// 3. Consistencia: exportTableCSV produce el MISMO formato que queryExportCsv (mismo escape)
{
  const qSrc = grabFn(wsCode, 'queryExportCsv');
  const qfn = new Function(qSrc + '\nreturn queryExportCsv;')();
  const model = { headers: ['Precio, USD', 'Cantidad'], rows: [[null, '5', 'x']] };
  // nota: queryExportCsv no agrega BOM; comparamos la parte de datos/escape 1:1
  const expected = qfn(model);
  const t1 = { headers: ['Precio, USD', 'Cantidad'], rows: [[null, '5', 'x']] };
  capturedBlob = null;
  makeFn()(t1);
  const ours = capturedBlob.replace(/^\uFEFF/, '');
  check('escape identico a queryExportCsv (sin BOM)', ours === expected, JSON.stringify(ours) + ' vs ' + JSON.stringify(expected));
}

// 4. Una celda con comillas internas y salto de linea se escapa (redondeo del escape)
{
  const table = { name: 'D', headers: ['a'], rows: [['hola "mundo"\ny adios']] };
  capturedBlob = null;
  makeFn()(table);
  const csv = capturedBlob;
  check('comillas internas duplicadas', csv.includes('hola ""mundo""'), csv.split('\n')[1]);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);