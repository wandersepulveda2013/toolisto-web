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
  grabFn(wsCode, 'columnNameToIndex') + '\n' +
  grabFn(wsCode, 'indexToColumnName') + '\n' +
  grabFn(wsCode, 'cellReferenceToPosition') + '\n' +
  grabFn(wsCode, 'numericValue') + '\n' +
  grabFn(wsCode, 'safeArithmetic');
const safeArithmetic = new Function(augSrc + '\nreturn safeArithmetic;')();
const evaluate = new Function(augSrc + '\n' + grabFn(wsCode, 'evaluateDataFormula') + '\nreturn evaluateDataFormula;')();

console.log('=== CE-109: operador unario negativo en formulas + agregados que ignoran celdas no numericas ===');
console.log('(safeArithmetic + evaluateDataFormula REALES)');

// 1. NUCLEO safeArithmetic: unario menos/plus en primario
check('safeArithmetic("-5") === -5', safeArithmetic('-5') === -5, String(safeArithmetic('-5')));
check('safeArithmetic("-5+3") === -2', safeArithmetic('-5+3') === -2, String(safeArithmetic('-5+3')));
check('safeArithmetic("5*-3") === -15', safeArithmetic('5*-3') === -15, String(safeArithmetic('5*-3')));
check('safeArithmetic("3*(-1)") === -3', safeArithmetic('3*(-1)') === -3, String(safeArithmetic('3*(-1)')));
check('safeArithmetic("5--3") === 8 (resta)', safeArithmetic('5--3') === 8, String(safeArithmetic('5--3')));
check('safeArithmetic("+7") === 7', safeArithmetic('+7') === 7, String(safeArithmetic('+7')));
check('safeArithmetic("2+3*4") intacta === 14', safeArithmetic('2+3*4') === 14, String(safeArithmetic('2+3*4')));
check('safeArithmetic("5/0") sigue siendo error', safeArithmetic('5/0') === '', String(safeArithmetic('5/0')));

// 2. CONTRATO FINAL: formulas con negativos ya no dan #FORMULA
{
  const t = { headers: ['A', 'B'], rows: [['-5', '3'], ['7', '']] };
  check('=A1+B1 (-5+3) => -2', evaluate(t, '=A1+B1') === '-2', JSON.stringify(evaluate(t, '=A1+B1')));
  check('=A1*B1 (-5*3) => -15', evaluate(t, '=A1*B1') === '-15', JSON.stringify(evaluate(t, '=A1*B1')));
  check('=A1+A2 (-5+7) => 2', evaluate(t, '=A1+A2') === '2', JSON.stringify(evaluate(t, '=A1+A2')));
  check('=MIN(A1:A2) (-5 vs 7) => -5', evaluate(t, '=MIN(A1:A2)') === '-5', JSON.stringify(evaluate(t, '=MIN(A1:A2)')));
}

// 3. Agregados: las celdas NO numericas no cuentan como 0
{
  // abc (texto) + 100 + 200
  const t1 = { headers: ['A'], rows: [['abc'], ['100'], ['200']] };
  check('=COUNT(A1:A3) con abc,100,200 => 2', evaluate(t1, '=COUNT(A1:A3)') === '2', JSON.stringify(evaluate(t1, '=COUNT(A1:A3)')));
  check('=AVERAGE(A1:A3) => 150 (no 100)', evaluate(t1, '=AVERAGE(A1:A3)') === '150', JSON.stringify(evaluate(t1, '=AVERAGE(A1:A3)')));
  check('=MIN(A1:A3) => 100 (no 0)', evaluate(t1, '=MIN(A1:A3)') === '100', JSON.stringify(evaluate(t1, '=MIN(A1:A3)')));
  check('=MAX(A1:A3) => 200', evaluate(t1, '=MAX(A1:A3)') === '200', JSON.stringify(evaluate(t1, '=MAX(A1:A3)')));

  // abc + -5 + -3
  const t2 = { headers: ['A'], rows: [['abc'], ['-5'], ['-3']] };
  check('=MAX(A1:A3) con -5,-3 => -3 (no 0)', evaluate(t2, '=MAX(A1:A3)') === '-3', JSON.stringify(evaluate(t2, '=MAX(A1:A3)')));
  check('=MIN(A1:A3) con -5,-3 => -5', evaluate(t2, '=MIN(A1:A3)') === '-5', JSON.stringify(evaluate(t2, '=MIN(A1:A3)')));

  // texto con decimales europeas (1.234,56)
  const t3 = { headers: ['A'], rows: [['300,75'], ['1.234,56'], ['2.500,00']] };
  check('=SUM(A1:A3) europeo => 4035.31', evaluate(t3, '=SUM(A1:A3)') === '4035.31', JSON.stringify(evaluate(t3, '=SUM(A1:A3)')));
  check('=MAX(A1:A3) europeo => 2500', evaluate(t3, '=MAX(A1:A3)') === '2500', JSON.stringify(evaluate(t3, '=MAX(A1:A3)')));

  // todos no numericos -> COUNT 0, suma 0, sin crash
  const t4 = { headers: ['A'], rows: [['x'], ['y'], ['z']] };
  check('=COUNT(A1:A3) todo no numerico => 0', evaluate(t4, '=COUNT(A1:A3)') === '0', JSON.stringify(evaluate(t4, '=COUNT(A1:A3)')));
  check('=SUM(A1:A3) todo no numerico => 0', evaluate(t4, '=SUM(A1:A3)') === '0', JSON.stringify(evaluate(t4, '=SUM(A1:A3)')));

  // COUNTA sigue contando no vacias (no numericas incluidas)
  check('=COUNTA(A1:A3) => 3 (no vacias)', evaluate(t4, '=COUNTA(A1:A3)') === '3', JSON.stringify(evaluate(t4, '=COUNTA(A1:A3)')));

  // agregado sobre celdas formula (resuelve formulas dentro)
  const t5 = { headers: ['A'], rows: [['1'], ['=A1+1'], ['=A2+1']] };
  check('=SUM(A1:A3) formulas => 6', evaluate(t5, '=SUM(A1:A3)') === '6', JSON.stringify(evaluate(t5, '=SUM(A1:A3)')));
}

// 4. Anti-regresion estatica: la agregacion ya no re-parsea con Number(replace(",","."))
{
  const bad = wsCode.match(/valuesFromArgument\(argument\)/);
  check('valuesFromArgument (corruptor) eliminado', !bad);
  const m = wsCode.match(/const numbers = cellsFromArgument\(argument\)\.filter\(value => value !== null && Number\.isFinite\(value\)\)/);
  check('agregados usan cellsFromArgument + filtro numerico', !!m, m ? 'ok' : 'no match');
  const su = wsCode.match(/let sign = 1;[\s\S]*?while \(tokens\[position\] === '-' \|\| tokens\[position\] === '\+'\)/);
  check('safeArithmetic parsePrimary maneja unario +/-', !!su, su ? 'ok' : 'no match');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
