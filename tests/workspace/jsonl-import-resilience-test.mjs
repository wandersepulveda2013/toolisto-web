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
const parseSrc = grabFn(wsCode, 'parseJsonlText');
const parseJsonlText = new Function(parseSrc + '\nreturn parseJsonlText;')();

console.log('=== CE-118: JSONL import resilient to malformed lines ===');

// 1. All valid lines — no skipped
{
  const input = '{"a":1}\n{"b":2}\n{"c":3}';
  const { records, skipped } = parseJsonlText(input);
  check('3 valid lines -> 3 records', records.length === 3);
  check('0 skipped', skipped === 0);
  check('first record has a=1', records[0].a === 1);
  check('third record has c=3', records[2].c === 3);
}

// 2. One malformed line in the middle — rest preserved
{
  const input = '{"x":10}\nNOT_JSON\n{"x":30}';
  const { records, skipped } = parseJsonlText(input);
  check('2 valid lines out of 3', records.length === 2);
  check('1 skipped', skipped === 1);
  check('first record x=10', records[0].x === 10);
  check('second record x=30', records[1].x === 30);
}

// 3. All malformed — empty records
{
  const input = 'bad1\nbad2\nbad3';
  const { records, skipped } = parseJsonlText(input);
  check('0 records from all-bad input', records.length === 0);
  check('3 skipped', skipped === 3);
}

// 4. Empty input — no crash
{
  const { records, skipped } = parseJsonlText('');
  check('empty input -> 0 records', records.length === 0);
  check('empty input -> 0 skipped', skipped === 0);
}

// 5. Whitespace-only lines filtered
{
  const input = '  \n  \n  ';
  const { records, skipped } = parseJsonlText(input);
  check('whitespace-only -> 0 records', records.length === 0);
  check('whitespace-only -> 0 skipped', skipped === 0);
}

// 6. Mixed: empty lines + valid + bad
{
  const input = '\n{"a":1}\n\nTRASH\n{"a":2}\n';
  const { records, skipped } = parseJsonlText(input);
  check('2 valid from mixed', records.length === 2);
  check('1 skipped from mixed', skipped === 1);
  check('records are in order', records[0].a === 1 && records[1].a === 2);
}

// 7. Trailing comma in JSON object — malformed
{
  const input = '{"a":1,}\n{"b":2}';
  const { records, skipped } = parseJsonlText(input);
  check('trailing comma skipped', records.length === 1);
  check('1 skipped for trailing comma', skipped === 1);
  check('valid record preserved', records[0].b === 2);
}

// 8. Nested objects preserved
{
  const input = '{"user":{"name":"Ana"},"score":95}\n{"user":{"name":"Luis"},"score":80}';
  const { records, skipped } = parseJsonlText(input);
  check('nested objects parsed', records.length === 2);
  check('nested name preserved', records[0].user.name === 'Ana');
  check('0 skipped', skipped === 0);
}

// 9. Unicode preserved
{
  const input = '{"city":"Córdoba"}\n{"city":"Ñuño"}';
  const { records, skipped } = parseJsonlText(input);
  check('unicode preserved', records.length === 2);
  check('accent intact', records[0].city === 'Córdoba');
  check('ñ intact', records[1].city === 'Ñuño');
}

// 10. CRLF line endings
{
  const input = '{"a":1}\r\nBAD\r\n{"a":2}';
  const { records, skipped } = parseJsonlText(input);
  check('CRLF handled: 2 records', records.length === 2);
  check('CRLF handled: 1 skipped', skipped === 1);
}

// 11. Anti-regression: function signature matches workspace.js
{
  check('parseJsonlText is a function', typeof parseJsonlText === 'function');
  check('returns records array', Array.isArray(parseJsonlText('{}').records));
  check('returns skipped number', typeof parseJsonlText('{}').skipped === 'number');
}

console.log(`\n=== jsonl-import-resilience: ${pass}/${pass + fail} PASS ===`);
process.exit(fail > 0 ? 1 : 0);
