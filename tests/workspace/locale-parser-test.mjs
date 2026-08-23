#!/usr/bin/env node
/**
 * tests/workspace/locale-parser-test.mjs — Exhaustive tests for core/locale-parser.js
 *
 * Covers: parseLocaleNumber, inferNumericHints, classifyDate, inferDateFormat, detectSeparator.
 */

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const code = readFileSync(join(ROOT, 'workspace', 'core', 'locale-parser.js'), 'utf8');
const cleaned = code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');

const sandbox = { console, Math, Number, String, Date, JSON, Array, Object, Error, RegExp, Set, Map, parseInt, parseFloat };
const script = new vm.Script(cleaned + `
globalThis.parseLocaleNumber = parseLocaleNumber;
globalThis.inferNumericHints = inferNumericHints;
globalThis.classifyDate = classifyDate;
globalThis.inferDateFormat = inferDateFormat;
globalThis.detectSeparator = detectSeparator;
`);
script.runInNewContext(sandbox);

const { parseLocaleNumber, inferNumericHints, classifyDate, inferDateFormat, detectSeparator } = sandbox;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS: ' + name); }
  else { fail++; console.error('  FAIL: ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ════════════════════════════════════════════════════════════════ */
console.log('=== parseLocaleNumber ===');

check('en-US integer', parseLocaleNumber('1234') === 1234);
check('en-US decimal', parseLocaleNumber('1234.56') === 1234.56);
check('en-US grouping', parseLocaleNumber('1,234') === 1234);
check('en-US grouping+decimal', parseLocaleNumber('1,234.56') === 1234.56);
check('en-US negative', parseLocaleNumber('-42.5') === -42.5);
check('en-US negative grouping', parseLocaleNumber('-1,234.56') === -1234.56);

check('es decimal comma', parseLocaleNumber('1234,56') === 1234.56);
check('es grouping dot', parseLocaleNumber('1.234') === 1234);
check('es grouping+decimal', parseLocaleNumber('1.234,56') === 1234.56);
check('es negative decimal comma', parseLocaleNumber('-1.234,56') === -1234.56);

check('de-DE grouping dot', parseLocaleNumber('87.500,99') === 87500.99);

check('parentheses negative', parseLocaleNumber('(1,234.50)') === -1234.5);
check('parentheses negative es', parseLocaleNumber('(1.234,50)') === -1234.5);

check('dollar prefix', parseLocaleNumber('$1,234.56') === 1234.56);
check('euro suffix', parseLocaleNumber('1.234,56 €') === 1234.56);
check('pound prefix', parseLocaleNumber('£50.00') === 50);

check('percent 12%', parseLocaleNumber('12%') === 0.12);
check('percent 100%', parseLocaleNumber('100%') === 1);
check('percent 3.5%', parseLocaleNumber('3.5%') === 0.035);
check('percent es 12,5%', parseLocaleNumber('12,5%') === 0.125);

check('space grouping', parseLocaleNumber('1 234') === 1234);
check('nbsp grouping', parseLocaleNumber('1\u00A0234') === 1234);

check('empty string', parseLocaleNumber('') === null);
check('null', parseLocaleNumber(null) === null);
check('undefined', parseLocaleNumber(undefined) === null);
check('text', parseLocaleNumber('hello') === null);
check('boolean false', parseLocaleNumber(false) === null);
check('numeric 0', parseLocaleNumber(0) === 0);
check('numeric NaN', parseLocaleNumber(NaN) === null);
check('numeric Infinity', parseLocaleNumber(Infinity) === null);
check('leading dot', parseLocaleNumber('.5') === 0.5);
check('trailing dot', parseLocaleNumber('5.') === 5);

check('ambiguous 1,234 with comma hint', parseLocaleNumber('1,234', { defaultDecimal: ',' }) === 1.234);
check('ambiguous 1,234 with dot hint', parseLocaleNumber('1,234', { defaultDecimal: '.' }) === 1234);
check('ambiguous 1.234 with comma hint', parseLocaleNumber('1.234', { defaultDecimal: ',' }) === 1234);
check('ambiguous 1.234 with dot hint', parseLocaleNumber('1.234', { defaultDecimal: '.' }) === 1.234);

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== inferNumericHints ===');

check('comma-decimal column', eq(
  inferNumericHints(['1.234,56', '2.456,00', '87,50']),
  { defaultDecimal: ',' }
));
check('dot-decimal column', eq(
  inferNumericHints(['1,234.56', '2,456.00', '87.50']),
  { defaultDecimal: '.' }
));
check('mixed with percent', eq(
  inferNumericHints(['12%', '3,5%', '87,5%']),
  { defaultDecimal: ',', isPercentColumn: true }
));
check('empty column', eq(inferNumericHints([]), {}));
check('null column', eq(inferNumericHints(null), {}));

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== classifyDate ===');

check('ISO date', eq(classifyDate('2026-08-23'), { format: 'YYYY-MM-DD', ambiguous: false }));
check('ISO datetime', eq(classifyDate('2026-08-23T14:30:00Z'), { format: 'YYYY-MM-DD', ambiguous: false }));
check('YYYY/MM/DD', eq(classifyDate('2026/08/23'), { format: 'YYYY/MM/DD', ambiguous: false }));
check('DD.MM.YYYY', eq(classifyDate('23.08.2026'), { format: 'DD.MM.YYYY', ambiguous: false }));
check('DD/MM/YYYY ambiguous 01/02', eq(classifyDate('01/02/2026'), { format: 'DD/MM', ambiguous: true }));
check('DD/MM unambiguous day>12', eq(classifyDate('15/02/2026'), { format: 'DD/MM', ambiguous: false }));
check('MM/DD unambiguous month>12', eq(classifyDate('02/15/2026'), { format: 'MM/DD', ambiguous: false }));
check('both>12 invalid as date', eq(classifyDate('13/13/2026'), { format: 'text', ambiguous: false }));
check('empty', eq(classifyDate(''), { format: 'text', ambiguous: false }));
check('null', eq(classifyDate(null), { format: 'text', ambiguous: false }));
check('text', eq(classifyDate('marzo'), { format: 'text', ambiguous: false }));
check('DD-MM-YYYY ambiguous', eq(classifyDate('01-02-2026'), { format: 'DD/MM', ambiguous: true }));
check('DD-MM unambiguous', eq(classifyDate('15-02-2026'), { format: 'DD/MM', ambiguous: false }));

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== inferDateFormat ===');

check('DMY column', eq(
  inferDateFormat(['15/02/2026', '28/02/2026', '01/03/2026']),
  { format: 'DD/MM', ambiguous: false, confidence: 1 }
));
check('MDY column', (() => {
  const r = inferDateFormat(['02/15/2026', '02/28/2026', '03/01/2026']);
  return r.format === 'MM/DD' && r.ambiguous === false && r.confidence > 0.6;
})());
check('ISO column', eq(
  inferDateFormat(['2026-01-15', '2026-02-28']),
  { format: 'YYYY-MM-DD', ambiguous: false, confidence: 1 }
));
check('ambiguous column no hint', eq(
  inferDateFormat(['01/02/2026', '03/04/2026']),
  { format: 'DD/MM', ambiguous: true, confidence: 0 }
));
check('ambiguous column with locale hint', eq(
  inferDateFormat(['01/02/2026', '03/04/2026'], { defaultFormat: 'MM/DD' }),
  { format: 'MM/DD', ambiguous: false, confidence: 0.6 }
));
check('empty column', eq(
  inferDateFormat([]),
  { format: 'text', ambiguous: false, confidence: 0 }
));
check('mixed text+dates', eq(
  inferDateFormat(['marzo', '15/02/2026', '28/02/2026']),
  { format: 'DD/MM', ambiguous: false, confidence: 1 }
));

/* ════════════════════════════════════════════════════════════════ */
console.log('\n=== detectSeparator ===');

check('comma-separated', detectSeparator('a,b\nc,d\ne,f') === ',');
check('semicolon-separated', detectSeparator('a;b\nc;d\ne;f') === ';');
check('tab-separated', detectSeparator('a\tb\nc\td\ne\tf') === '\t');
check('pipe-separated', detectSeparator('a|b\nc|d\ne|f') === '|');
check('quoted comma preserved', detectSeparator('"a,b",c\n"d,e",f') === ',');
check('empty text', detectSeparator('') === '');
check('single line', detectSeparator('a,b') === '');

check('ES numeric with semicolon CSV', detectSeparator('nombre;importe\nAna;1.234,56\nLuis;87,50') === ';');
check('pipe with mixed content', detectSeparator('id|nombre|importe\n1|Ana|1.234,56') === '|');

check('ragged rows still detect', detectSeparator('a,b,c\nd,e\nf,g,h') === ',');
check('whitespace not comma', detectSeparator('hello world\ngoodbye world') !== ',');
check('array input', detectSeparator(['a,b', 'c,d', 'e,f']) === ',');
check('array input semicolon', detectSeparator(['a;b', 'c;d', 'e;f']) === ';');
check('array input tab', detectSeparator(['a\tb', 'c\td', 'e\tf']) === '\t');

/* ════════════════════════════════════════════════════════════════ */
console.log(`\n=== Resultado ===`);
console.log(`PASS: ${pass}`);
if (fail > 0) console.error(`FAIL: ${fail}`);
else console.log('Todos los tests pasaron');

process.exit(fail > 0 ? 1 : 0);
