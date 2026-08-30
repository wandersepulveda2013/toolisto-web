#!/usr/bin/env node
// CE-071: «documento → tabla» debe reconstruir columnas en tablas OCR alineadas
// por espacios MULTIPLES (antes `line.split(' ')` creaba columnas fantasma y
// celdas vacias). El fix delega en `parseTabularText` (split /\s+/ + ancla
// numerica) dentro de `convertDocToTable`, conservando confianza/relaciones.
//
// Pure test (sin navegador): carga el parser real por new Function igual que
// tabular-text-parser-test.mjs, mas un chequeo estatico de que workspace.js
// ya no divide por separador ' ' en convertDocToTable.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const parserSource = readFileSync(join(root, 'workspace', 'core', 'tabular-text-parser.js'), 'utf8')
  .replace(/^import\s.*;?\s*$/gm, '')
  .replace(/^export\s+/gm, '');
const localeSource = readFileSync(join(root, 'workspace', 'core', 'locale-parser.js'), 'utf8')
  .replace(/^import\s.*;?\s*$/gm, '')
  .replace(/^export\s+/gm, '');
const parseTabularText = new Function(`${localeSource}\n${parserSource}\nreturn parseTabularText;`)();
const workspaceSource = readFileSync(join(root, 'workspace', 'workspace.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, condition) { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name}`); } }

console.log('=== Documento a Tabla: tablas OCR multiespacio (CE-071) ===\n');

// ─── 1. Multi-espacio real (caso del bug) ───
console.log('--- 1. Parsea tablas alineadas por espacios multiples ---');
const multi = parseTabularText('Nombre   Valor   Estado\nVentas Q1   150     Completado\nCostos   -200   Pagado\nGanancia neta   0   Calculado');
check('3 headers, sin columnas fantasma', JSON.stringify(multi.headers) === JSON.stringify(['Nombre', 'Valor', 'Estado']));
check('label con espacios queda en col 1', multi.rows[0][0] === 'Ventas Q1');
check('col 2 es el numerico', multi.rows[0][1] === '150');
check('col 3 es el estado', multi.rows[0][2] === 'Completado');
check('negativo normalizado', multi.rows[1][1] === '-200');
check('multi-word label reconstruido', multi.rows[2][0] === 'Ganancia neta' && multi.rows[2][1] === '0' && multi.rows[2][2] === 'Calculado');

// ─── 2. Fixture Star-Flow (espacios simples) sigue intacto ───
console.log('--- 2. Fixture Star-Flow esperado se reproduce con el parser ---');
const star = parseTabularText('Nombre Valor Estado\nVentas Q1 150 Completado\nVentas Q2 80 En progreso\nDevoluciones -30 Pendiente\nCostos fijos -200 Pagado\nGanancia neta 0 Calculado');
check('headers = Nombre Valor Estado', JSON.stringify(star.headers) === JSON.stringify(['Nombre', 'Valor', 'Estado']));
const expectedRows = [
  ['Ventas Q1', '150', 'Completado'],
  ['Ventas Q2', '80', 'En progreso'],
  ['Devoluciones', '-30', 'Pendiente'],
  ['Costos fijos', '-200', 'Pagado'],
  ['Ganancia neta', '0', 'Calculado'],
];
check('5 filas exactas (15 celdas)', star.rows.length === 5 && star.rows.every((row, i) => JSON.stringify(row) === JSON.stringify(expectedRows[i])));
check('contiene negativos', star.rows.flat().some(c => String(c).includes('-')));

// ─── 3. Delimitadores explicitos siguen funcionando ───
console.log('--- 3. Delimitador explicito (; y |) intacto ---');
const semi = parseTabularText('Concepto;Importe\nCuota;1,50\nServicio;20,00');
check('semicolon headers', JSON.stringify(semi.headers) === JSON.stringify(['Concepto', 'Importe']));
check('semicolon filas', semi.rows[0][1] === '1,50');
const pipe = parseTabularText('A|B|C\nx|1|y\nz|-2|w');
check('pipe headers', JSON.stringify(pipe.headers) === JSON.stringify(['A', 'B', 'C']));

// ─── 4. convertDocToTable delega en parseTabularText (anti-regresion) ───
console.log('--- 4. workspace.js usa parseTabularText en convertDocToTable ---');
check('importa parseTabularText', /import\s*\{[\s\S]*?parseTabularText[\s\S]*?\}\s*from\s*['"]\.\/core\/tabular-text-parser\.js['"]/.test(workspaceSource));
const convertBlock = workspaceSource.slice(workspaceSource.indexOf('function convertDocToTable'), workspaceSource.indexOf('function tableChartData'));
check('convertDocToTable llama parseTabularText', convertBlock.includes('parseTabularText(lines.join'));
check('no divide por separador simple en convertDocToTable', !convertBlock.includes("line.split(separator)") && !convertBlock.includes("split(separator).map"));
check("no usa separador ' ' como fallback", !convertBlock.includes("|| ' '"));
check('usa parsed.headers / parsed.rows (sin columnas fantasma)', convertBlock.includes('parsed.headers') && convertBlock.includes('parsed.rows'));
check('no queda rebuildTableRow muerto', !workspaceSource.includes('function rebuildTableRow('));
check('conserva confidence matrix', convertBlock.includes('buildCellConfidenceMatrix'));
check('conserva relacion source-document', convertBlock.includes("'source-document'"));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);