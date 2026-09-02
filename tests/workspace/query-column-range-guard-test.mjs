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
const run = (() => {
  const d = grabFn(wsCode, 'queryCloneRows') + '\n' + grabFn(wsCode, 'queryCloneShape') + '\n' + grabFn(wsCode, 'queryRunOperation') + '\nreturn queryRunOperation;';
  return new Function(d)();
})();
const rebuild = new Function(grabFn(wsCode, 'queryCloneRows') + '\n' + grabFn(wsCode, 'queryCloneShape') + '\n' + grabFn(wsCode, 'queryRunOperation') + '\n' + grabFn(wsCode, 'queryRebuildModel') + '\nreturn queryRebuildModel;')();

const hasUndefined = arr => arr.some(v => v === undefined);

console.log('=== CE-105: choose/reorder-columns descartan indices fuera de rango (sin headers undefined) ===');
console.log('(queryRunOperation + queryRebuildModel REALES)');

// 1. choose-columns con un indice fuera de rango: se descarta, no produce undefined
{
  const r = run({ headers: ['A', 'B'], rows: [['1', '2']] }, 'choose-columns', { indexes: [0, 5] });
  check('choose con indice 5 fuera de rango: headers sin undefined', !hasUndefined(r.headers), JSON.stringify(r.headers));
  check('choose conserva la columna valida [A]', JSON.stringify(r.headers) === JSON.stringify(['A']), JSON.stringify(r.headers));
  check('choose rows sin undefined', r.rows.every(row => !hasUndefined(row)), JSON.stringify(r.rows));
}

// 2. choose-columns con SOLO indices fuera de rango: no produce headers vacios/undefined
{
  const r = run({ headers: ['A', 'B'], rows: [['1', '2']] }, 'choose-columns', { indexes: [9, 3] });
  check('choose con indices 9,3: headers sin undefined', !hasUndefined(r.headers), JSON.stringify(r.headers));
  check('choose con indices 9,3: mantiene el modelo intacto', JSON.stringify(r.headers) === JSON.stringify(['A', 'B']), JSON.stringify(r.headers));
}

// 3. reorder-columns con indice fuera de rango: no produce undefined y reordena correctamente
{
  const r = run({ headers: ['A', 'B'], rows: [['1', '2']] }, 'reorder-columns', { indexes: [0, 5] });
  check('reorder con indice 5: headers sin undefined', !hasUndefined(r.headers) && r.headers.length === 2, JSON.stringify(r.headers));
  check('reorder con indice 5: orden [A,B]', JSON.stringify(r.headers) === JSON.stringify(['A', 'B']), JSON.stringify(r.headers));
  check('reorder rows intactas', JSON.stringify(r.rows) === JSON.stringify([['1', '2']]), JSON.stringify(r.rows));
}

// 4. reorder-columns valido sigue funcionando. Nota: los indices se ordenan
//    ascendentemente en queryRunOperation (5858), asi que reordenar a una
//    secuencia no ascendente no es soportado por diseno; un reorder real
//    coloca el subconjunto indicado primero y el resto despues.
{
  const r = run({ headers: ['A', 'B'], rows: [['1', '2']] }, 'reorder-columns', { indexes: [1] });
  check('reorder [1] -> [B,A]', JSON.stringify(r.headers) === JSON.stringify(['B', 'A']), JSON.stringify(r.headers));
  check('reorder [1] filas [2,1]', JSON.stringify(r.rows) === JSON.stringify([['2', '1']]), JSON.stringify(r.rows));
  const all = run({ headers: ['A', 'B', 'C'], rows: [['1', '2', '3']] }, 'reorder-columns', { indexes: [2, 0] });
  check('reorder [2,0] ascendente -> [0,2,1] = A,C,B (sin undefined)', JSON.stringify(all.headers) === JSON.stringify(['A', 'C', 'B']), JSON.stringify(all.headers));
}

// 5. REBUILD EN CADENA: remove-columns seguido de reorder-columns con indices
//    estancos (validos al crear el paso, fuera de rango tras el remove).
{
  const model = {
    baseHeaders: ['A', 'B', 'C', 'D'],
    baseRows: [['a', 'b', 'c', 'd']],
    steps: [
      { operation: 'remove-columns', config: { indexes: [0, 1] } },   // -> headers ['C','D']
      { operation: 'reorder-columns', config: { indexes: [2, 3] } },  // 2,3 OOR contra 2 headers
    ],
  };
  const r = rebuild(model);
  check('rebuild: headers sin undefined (antes headers[2] daba undefined)', !hasUndefined(r.headers), JSON.stringify(r.headers));
  check('rebuild: filas sin undefined (antes normalizaba row[undefined]->\"\")', r.rows.every(row => !hasUndefined(row)), JSON.stringify(r.rows));
  check('rebuild: 2 columnas resultantes (C,D)', r.headers.length === 2 && JSON.stringify(r.headers) === JSON.stringify(['C', 'D']), JSON.stringify(r.headers));
}

// 6. choose-columns OOR en cadena no pierde datos silenciosamente
{
  const model = {
    baseHeaders: ['A', 'B', 'C', 'D'],
    baseRows: [['a', 'b', 'c', 'd']],
    steps: [
      { operation: 'remove-columns', config: { indexes: [0, 1] } },
      { operation: 'choose-columns', config: { indexes: [2, 3] } },  // 2,3 OOR contra 2 headers
    ],
  };
  const r = rebuild(model);
  check('rebuild choose OOR: headers sin undefined', !hasUndefined(r.headers), JSON.stringify(r.headers));
  check('rebuild choose OOR: conserva C,D (sin columnas undefined)', JSON.stringify(r.headers) === JSON.stringify(['C', 'D']), JSON.stringify(r.headers));
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);