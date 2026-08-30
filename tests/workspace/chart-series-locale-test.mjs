#!/usr/bin/env node
// CE-072: «tabla → gráfico» (data.to-chart / report.create) debe usar el parser
// canonico parseLocaleNumber en lugar de la copia local divergente
// parseLocaleChartNumber. Antes, una tabla OCR con fechas/horas producia
// columnas fantasma en el eslabon estrella: `15/01/2024` -> 15012024,
// `14:30` -> 1430, `(1.234,56)` perdia el signo y `5%` la escala; la MISMA
// tabla daba graficos distintos segun el punto de entrada (boton UI vs flujo).
//
// Pure test (sin navegador): carga locale-parser.js (canonico) + el modulo real
// workflow-operations.js por VM, ejecuta el tableChartSeries REAL y verifica
// que la seleccion de columna numerica y las series coinciden con el contrato
// canonico del repositorio ("All modules must use this instead of ad-hoc parsing").
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stripImports = (src) => src.replace(/^import\s.*;?\s*$/gm, '');
const stripExports = (src) => src.replace(/^export\s+/gm, '');

const localeSource = stripExports(stripImports(readFileSync(join(root, 'workspace', 'core', 'locale-parser.js'), 'utf8')));
const workflowOperSourceRaw = readFileSync(join(root, 'workspace', 'core', 'workflow-operations.js'), 'utf8');
const opsSource = stripExports(stripImports(workflowOperSourceRaw));
const { tableChartSeries } = new Function(`${localeSource}\n${opsSource}\nreturn { tableChartSeries };`)();

const workspaceSource = readFileSync(join(root, 'workspace', 'workspace.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, condition) { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name}`); } }

console.log('=== Tabla a Grafico: parser canonico en data.to-chart/report.create (CE-072) ===\n');

// ─── 1. Repro del bug: columna Fecha no debe ganar la seleccion ───
console.log('--- 1. Fechas/horas no se interpretan como numeros (sin columnas fantasma) ---');
const table = {
  headers: ['Concepto', 'Fecha', 'Monto'],
  rows: [
    ['Alquiler', '15/01/2024', '1234,56'],
    ['Internet', '16/01/2024', ''],
    ['Luz', '17/01/2024', '2500,00'],
  ],
};
const chart = tableChartSeries(table.headers, table.rows);
check('numericIndex apunta a Monto (col 2), no a Fecha', chart.numericIndex === 2);
check('series = [1234.56, 2500] con la celda vacia omitida', JSON.stringify(chart.series.map(s => s.value)) === JSON.stringify([1234.56, 2500]));
check('labels (paridad UI) incluyen Concepto + Fecha antes del numerico', JSON.stringify(chart.series.map(s => s.label)) === JSON.stringify(['Alquiler 15/01/2024', 'Luz 17/01/2024']));

// ─── 2. Datos localizados / signos / porcentajes con el parser canonico ───
console.log('--- 2. Decimal, millares, parentesis y porcentaje segun el contrato canonico ---');
const money = tableChartSeries(['Item', 'Importe'], [
  ['Ingresos', '1.500,25'],
  ['Gastos', '(1.234,56)'],
  ['Comision', '5%'],
]);
check('1.500,25 -> 1500.25', money.series[0].value === 1500.25);
check('(1.234,56) -> -1234.56 (signo conservado)', money.series[1].value === -1234.56);
check('5% -> 0.05 (escala decimal canonica)', money.series[2].value === 0.05);

const hours = tableChartSeries(['Etiqueta', 'Lag', 'Valor'], [
  ['t-3', '14:30', '10'],
  ['t-2', '15:45', '20'],
  ['t-1', '16:00', '30'],
]);
check('horas (14:30) no puntuan como numerico: col 2 (Valor) gana', hours.numericIndex === 2);
check('series numeric = [10, 20, 30]', JSON.stringify(hours.series.map(s => s.value)) === JSON.stringify([10, 20, 30]));

// ─── 3. Tabla limpia estandar (regresion workflow-chart-e2e) ───
console.log('--- 3. Tabla limpia Trimestre|Ventas sigue produciendo 3 series finitas ---');
const clean = tableChartSeries(['Trimestre', 'Ventas'], [
  ['T1', '1200'],
  ['T2', '980'],
  ['T3', '1450'],
]);
check('3 series finitas', clean.series.length === 3 && clean.series.every(s => Number.isFinite(s.value)));
check('numericIndex = 1', clean.numericIndex === 1);
check('valores 1200/980/1450', JSON.stringify(clean.series.map(s => s.value)) === JSON.stringify([1200, 980, 1450]));

// ─── 4. Sin columna numerica: series vacias (data.to-chart arrojaria aviso) ───
console.log('--- 4. Todo texto -> sin serie (aviso accionable, no grafico basura) ---');
const textOnly = tableChartSeries(['A', 'B'], [['x', 'alfa'], ['y', 'beta']]);
check('series vacias', textOnly.series.length === 0);

// ─── 5. Anti-regresion estatica: la copia divergente desaparece ───
console.log('--- 5. workflow-operations.js delega en el parser canonico ---');
check('no queda parseLocaleChartNumber', !workflowOperSourceRaw.includes('parseLocaleChartNumber'));
check("importa parseLocaleNumber de './locale-parser.js'", workflowOperSourceRaw.includes("import { parseLocaleNumber } from './locale-parser.js'"));
check('tableChartSeries usa parseLocaleNumber en scoring y series', (opsSource.match(/parseLocaleNumber\(row\?\.\[/g) || []).length >= 3);
check('sin strip ad-hoc [^\\d,.+\\-()] en el helper', !opsSource.includes("[^\\d,.+\\-()]"));
check('workspace.js (ruta UI) tambien usa parseLocaleNumber en tableChartData', /parseLocaleNumber\(row\?\.\[numericIndex\]\)/.test(workspaceSource));

// ─── 6. Paridad UI vs flujo: misma tabla, mismas series ───
console.log('--- 6. El resultado del flujo es reproducible punto a punto ---');
const dateRepro = tableChartSeries(['Concepto', 'Fecha', 'Monto'], [
  ['A', '01/01/2024', '150'],
  ['B', '02/01/2024', '80'],
  ['C', '03/01/2024', ''],
]);
check('sin punto de entrada: Fecha rechazada, Monto elegida', dateRepro.numericIndex === 2 && JSON.stringify(dateRepro.series.map(s => s.value)) === JSON.stringify([150, 80]));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);