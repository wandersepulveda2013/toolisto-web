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
const lpCode = readFileSync(new URL('../../workspace/core/locale-parser.js', import.meta.url), 'utf8');

const stripNoiseSrc = lpCode.match(/function stripNoise\(text\) \{[\s\S]*?\n\}/)[0];
const lpHeader = lpCode.match(/const (CURRENCY_RE|NBSP_RE|GROUP_BREAK_RE) = [^\n]+/g).join('\n');
const parseLocaleNumberSrc = lpCode.match(/export function parseLocaleNumber[\s\S]*?\n\}/)[0].replace(/^export /, '');
const augSrc =
  lpHeader + '\n' +
  stripNoiseSrc + '\n' +
  parseLocaleNumberSrc + '\n' +
  grabFn(wsCode, 'compareTableValues');
const cmp = new Function(augSrc + '\nreturn compareTableValues;')();

const asc = (arr) => arr.slice().sort((a, b) => cmp(a, b));
const desc = (arr) => arr.slice().sort((a, b) => -cmp(a, b));

console.log('=== CE-110: orden de tablas usa parseLocaleNumber canonico (compareTableValues REAL) ===');
console.log('(compareTableValues + parseLocaleNumber REALES)');

check('parseLocaleNumber("1.234,56") === 1234.56 (sanity del parser)', new Function(augSrc + '\nreturn parseLocaleNumber("1.234,56");')() === 1234.56);

// NUMERICOS SIMPLES sin regresion
check('asc [3,1,2] => [1,2,3]', JSON.stringify(asc(['3', '1', '2'])) === JSON.stringify(['1', '2', '3']));
check('asc ["100","20","3"] => [3,20,100] (numerico, no lexico)', JSON.stringify(asc(['100', '20', '3'])) === JSON.stringify(['3', '20', '100']));
check('desc ["100","20","3"] => [100,20,3]', JSON.stringify(desc(['100', '20', '3'])) === JSON.stringify(['100', '20', '3']));
check('asc ["10","9","8"] => [8,9,10]', JSON.stringify(asc(['10', '9', '8'])) === JSON.stringify(['8', '9', '10']));

// DECIMALES CON COMA (locale espanol)
check('asc ["2,5","1,5","3"] => [1.5,2.5,3] (decimal con coma)', JSON.stringify(asc(['2,5', '1,5', '3'])) === JSON.stringify(['1,5', '2,5', '3']));
check('asc ["1.234,56","2","999,99"] => [2,999.99,1234.56] (millares europeos)', JSON.stringify(asc(['1.234,56', '2', '999,99'])) === JSON.stringify(['2', '999,99', '1.234,56']));

// NEGATIVOS con signo
check('asc ["-5","-3","2","1"] => [-5,-3,1,2]', JSON.stringify(asc(['-5', '-3', '2', '1'])) === JSON.stringify(['-5', '-3', '1', '2']));
check('desc ["-5","-3","2","1"] => [2,1,-3,-5]', JSON.stringify(desc(['-5', '-3', '2', '1'])) === JSON.stringify(['2', '1', '-3', '-5']));

// VALORES NO NUMERICOS -> siguen comparando como texto (fallback localeCompare)
check('texto puro: asc ["b","a","c"] => [a,b,c]', JSON.stringify(asc(['b', 'a', 'c'])) === JSON.stringify(['a', 'b', 'c']));
check('texto puro: desc ["b","a","c"] => [c,b,a]', JSON.stringify(desc(['b', 'a', 'c'])) === JSON.stringify(['c', 'b', 'a']));
check('vacio y nulo no crashean y van al fallback', (() => {
  const r = [undefined, '', 'abc'].slice().sort((a, b) => cmp(a, b));
  return Array.isArray(r) && r.length === 3;
})());

// MEZCLA numerico + texto
check('mezcla: asc ["100","abc","20"] => [20,100,abc] (numericos primero, texto despues)', JSON.stringify(asc(['100', 'abc', '20'])) === JSON.stringify(['20', '100', 'abc']));

// PARIDAD con sort de cabecera: valores con formato europeo no se separan como string
check('"1.200" y "1.3" => numerico 1200 > 1.3, no lexico "1.200" < "1.3"', (() => {
  const na = cmp('1.200', '1.3');
  return na > 0;
})());

// ANTI-REGRESION ESTATICA: el patron ad-hoc Number(replace(',','.')) ya no esta en sort
check('anti-regresion: compareTableValues definida y usada en 2 sitios de sort', !!(wsCode.includes('function compareTableValues(a, b)')) && ((wsCode.match(/compareTableValues\(/g) || []).length === 3));
check('anti-regresion: workspace.js ya no usa Number(a.replace(\',\',\'.\'))', !/\.replace\('(,|\.)','(\.|,)'\)/.test(wsCode));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
