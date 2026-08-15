#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'workspace', 'core', 'tabular-text-parser.js'), 'utf8')
  .replace(/^export\s+/gm, '');
const parseTabularText = new Function(`${source}\nreturn parseTabularText;`)();
let pass = 0, fail = 0;
function check(name, condition) { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name}`); } }

console.log('=== Tabular Text Parser ===\n');
const ocr = parseTabularText('Nombre Valor Estado\nVentas Q1 150 Completado\nDevoluciones −30 Pendiente');
check('OCR whitespace detects three headers', JSON.stringify(ocr.headers) === JSON.stringify(['Nombre', 'Valor', 'Estado']));
check('OCR labels with spaces stay in first column', JSON.stringify(ocr.rows[0]) === JSON.stringify(['Ventas Q1', '150', 'Completado']));
check('OCR unicode minus normalizes and stays numeric', JSON.stringify(ocr.rows[1]) === JSON.stringify(['Devoluciones', '-30', 'Pendiente']));

const csv = parseTabularText('Concepto,Importe\n"Cuota, mensual",1.250,50\nServicio,20,00');
check('Quoted CSV comma remains inside its cell', csv.rows[0][0] === 'Cuota, mensual');
check('CSV restores unquoted comma decimal fields', csv.rows[1][1] === '20,00' && csv.rows[0][1] === '1.250,50');

const semi = parseTabularText('Concepto;Importe\nCuota;1,50\nServicio;20,00');
check('Semicolon takes precedence over decimal comma', semi.delimiter === ';' && semi.rows[0][1] === '1,50');
check('Empty input is rejected', (() => { try { parseTabularText('   '); return false; } catch { return true; } })());

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);
