import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const reorderSrc = grabFn(wsCode, 'reorderBlock');
const reorder = new Function(reorderSrc + '\nreturn reorderBlock;')();

const A = { id: 'A', type: 'text' };
const B = { id: 'B', type: 'text' };
const C = { id: 'C', type: 'table' };

function fresh() { return [{ ...A }, { ...B }, { ...C }]; }
function ids(blocks) { return blocks.map(b => b.id).join(','); }

console.log('=== CE-098: el drop de bloques valida el indice (no reordena con NaN) ===');
console.log('(reorderBlock REAL de workspace.js; el bug: parseInt -> NaN -> splice(0,1) reordenaba el primer bloque)');

// 1. Drop extraneo (NaN de un archivo externo) -> no muta el documento
{
  const blocks = fresh();
  const result = reorder(blocks, NaN, 1);
  check('from=NaN devuelve false (no movio)', result === false, 'got ' + result);
  check('from=NaN NO reordena (orden intacto)', ids(blocks) === 'A,B,C', 'got ' + ids(blocks));
}

// 2. Indices fuera de rango -> no op
{
  const blocks = fresh();
  check('from=-1 revuelve false', reorder(blocks, -1, 1) === false);
  check('from>=length revuelve false', reorder(blocks, 3, 1) === false);
  check('to fuera de rango revuelve false', reorder(blocks, 0, 99) === false);
  check('orden intacto tras los no-op', ids(blocks) === 'A,B,C');
}

// 3. from == to -> no op (reenviar al mismo lugar no hace nada)
{
  const blocks = fresh();
  check('from==to revuelve false', reorder(blocks, 1, 1) === false);
  check('orden intacto', ids(blocks) === 'A,B,C');
}

// 4. Reorder valido si: mueve el bloque y devuelve true
{
  const blocks = fresh();
  const moved = reorder(blocks, 0, 2);
  check('reorder valido devuelve true', moved === true);
  check('movio A del inicio al final', ids(blocks) === 'B,C,A', 'got ' + ids(blocks));

  const blocks2 = fresh();
  reorder(blocks2, 2, 0);
  check('movio C del final al inicio', ids(blocks2) === 'C,A,B', 'got ' + ids(blocks2));
}

// 5. Array vacio o no array -> false sin lanzar
{
  check('array vacio revuelve false', reorder([], 0, 1) === false);
  check('no-array revuelve false', reorder(null, 0, 1) === false);
  check('no-array revuelve false', reorder(undefined, 0, 1) === false);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);