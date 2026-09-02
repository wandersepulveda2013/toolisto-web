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

// helpers REALES: locale-parser (regexes + stripNoise + parseLocaleNumber) y
// columnNameToIndex + indexToColumnName + cellReferenceToPosition + numericValue + safeArithmetic
const stripNoiseSrc = lpCode.match(/function stripNoise\(text\) \{[\s\S]*?\n\}/)[0];
const lpHeader = lpCode.match(/const (CURRENCY_RE|NBSP_RE|GROUP_BREAK_RE) = [^\n]+/g).join('\n');
const parseLocaleNumberSrc = lpCode.match(/export function parseLocaleNumber[\s\S]*?\n\}/)[0].replace(/^export /, '');
const augSrc =
  lpHeader + '\n' +
  stripNoiseSrc + '\n' +
  parseLocaleNumberSrc + '\n' +
  grabFn(wsCode, 'columnNameToIndex') + '\n' +
  grabFn(wsCode, 'indexToColumnName') + '\n' +
  grabFn(wsCode, 'cellReferenceToPosition') + '\n' +
  grabFn(wsCode, 'numericValue') + '\n' +
  grabFn(wsCode, 'safeArithmetic');
const safeArithmetic = new Function(augSrc + '\nreturn safeArithmetic;')();
const evaluate = new Function(augSrc + '\n' + grabFn(wsCode, 'evaluateDataFormula') + '\nreturn evaluateDataFormula;')();

console.log('=== CE-103: division por cero produce error (#FORMULA), no escribe 0 ===');
console.log('(safeArithmetic + evaluateDataFormula REALES)');

// 1. NUCLEO: safeArithmetic rechaza la division por cero (antes devolvia 0)
check('5/0 => \"\" (error)', safeArithmetic('5/0') === '', JSON.stringify(safeArithmetic('5/0')));
check('0/0 => \"\" (error)', safeArithmetic('0/0') === '', JSON.stringify(safeArithmetic('0/0')));
check('10/(2-2) => \"\" (error)', safeArithmetic('10/(2-2)') === '', JSON.stringify(safeArithmetic('10/(2-2)')));
check('5/2 sigue dando 2.5', safeArithmetic('5/2') === 2.5, String(safeArithmetic('5/2')));
check('0/5 sigue dando 0', safeArithmetic('0/5') === 0, String(safeArithmetic('0/5')));
check('aritmetica normal intacta: 2+3*4 = 14', safeArithmetic('2+3*4') === 14, String(safeArithmetic('2+3*4')));

// 2. CONTRATO FINAL: evaluateDataFormula mapea el error a #FORMULA (visible),
//    no a "0".
const table = { headers: ['A', 'B'], rows: [['5', '10'], ['3', '=B1/0']] };
check('=A1/0 => #FORMULA', evaluate(table, '=A1/0') === '#FORMULA', JSON.stringify(evaluate(table, '=A1/0')));
check('=B2/0 (referencia a formula B1/0) => #FORMULA', evaluate(table, '=B2/0') === '#FORMULA', JSON.stringify(evaluate(table, '=B2/0')));
check('=5/2 => 2.5', evaluate(table, '=5/2') === '2.5', JSON.stringify(evaluate(table, '=5/2')));
check('=0/5 => 0', evaluate(table, '=0/5') === '0', JSON.stringify(evaluate(table, '=0/5')));
check('=A1+A2 (5+3) => 8', evaluate(table, '=A1+A2') === '8', JSON.stringify(evaluate(table, '=A1+A2')));

// 3. La implementacion real ya no fuerza 0 en la division por cero
{
  const m = wsCode.match(/value = operator === '\*' \? value \* right : \(right === 0 \? ([^ ]+) : value \/ right\)/);
  check('parseTerm divide por cero con NaN (no 0)', !!m && m[1] === 'NaN', m ? m[1] : 'no match');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);