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
const parserCode = readFileSync(new URL('../../workspace/core/locale-parser.js', import.meta.url), 'utf8');
// locale-parser.js es ESM sin "type":"module": se compila el bloque completo con los
// helpers (stripNoise y constantes) quitando los "export" para que valide en new Function.
const parserHead = parserCode.slice(parserCode.indexOf('const CURRENCY_RE'), parserCode.indexOf('export function classifyDate')).replace(/^export function/gm, 'function');
const parseLocaleNumber = new Function(parserHead + '\nreturn parseLocaleNumber;')();
const deps =
  grabFn(wsCode, 'queryCloneRows') + '\n' +
  grabFn(wsCode, 'queryCloneShape') + '\n' +
  grabFn(wsCode, 'queryNumber') + '\n' +
  grabFn(wsCode, 'queryIsDate') + '\n' +
  grabFn(wsCode, 'queryDateToIso') + '\n' +
  grabFn(wsCode, 'queryUniqueHeader') + '\n';
const run = new Function('parseLocaleNumber', deps + grabFn(wsCode, 'queryRunOperation') + '\nreturn queryRunOperation;')(parseLocaleNumber);
const rebuild = new Function('parseLocaleNumber', deps + grabFn(wsCode, 'queryRunOperation') + '\n' + grabFn(wsCode, 'queryRebuildModel') + '\nreturn queryRebuildModel;')(parseLocaleNumber);

function makeModel(headers, rows) {
  return {
    baseHeaders: [...headers],
    baseRows: rows.map(row => [...row]),
    headers: [...headers],
    rows: rows.map(row => [...row]),
    steps: [],
  };
}

// Aplica pasos INCREMENTALMENTE (misma semantica que el nuevo queryApplyStep:
// queryRunOperation sobre el modelo materializado + push del paso).
function incrementalApply(model, operation, config) {
  const result = run(model, operation, config || {});
  model.headers = result.headers;
  model.rows = result.rows;
  model.steps = [...(model.steps || []), { operation, config: { ...(config || {}) } }];
  return model;
}

let step = 0;
function scenario(name, headers, rows, actions, extra) {
  step++;
  console.log(`=== CE-149: ${name} ===`);
  const incremental = makeModel(headers, rows);
  const baseline = makeModel(headers, rows);
  for (const [op, config] of actions) {
    incrementalApply(incremental, op, config);   // incremental (lo que hace la UI)
    baseline.steps = [...baseline.steps, { operation: op, config: { ...config } }]; // solo acumula
  }
  const replayed = rebuild(baseline); // replay completo desde la fuente (autoridad previa)
  const same = JSON.stringify(replayed.headers) === JSON.stringify(incremental.headers) &&
    JSON.stringify(replayed.rows) === JSON.stringify(incremental.rows);
  check(`pasos #${step}: incremental == replay completo (headers+rows)`, same,
    JSON.stringify({ inc: incremental.rows, replay: replayed.rows }));
  if (extra) extra(incremental, replayed);
  return incremental;
}

console.log('=== CE-149 R3: queryRunOperation/detect-type y queryApplyStep sin barridos redundantes ===\n');

// --- ANCLAS ESTATICAS ---
{
  const branchStart = wsCode.indexOf("['trim', 'clean', 'uppercase', 'lowercase', 'fill-down', 'fill-up', 'detect-type'].includes(operation)");
  const branch = wsCode.slice(branchStart, wsCode.indexOf("if (operation === 'replace-values')"));
  check('ancla: el ramo de text-ops no vuelve a clonar filas (rows.map(row => [...row]))',
    !branch.includes('rows.map(row => [...row])'), 'eliminado el 2do clon');
  check('ancla: el ramo transforma result.rows EN SITIO en una sola pasada',
    branch.includes('result.rows.forEach(row => {') && branch.trim().split('result.rows.forEach(').length >= 3,
    '1 forEach de transform por fila + los 2 fill (down/up)');
  const applyStep = wsCode.slice(wsCode.indexOf('function queryApplyStep'), wsCode.indexOf('function queryFormField'));
  check('ancla: queryApplyStep aplica SOLO el paso nuevo con queryRunOperation(model, operation, config)',
    applyStep.includes('queryRunOperation(model, operation, config)'), '');
  check('ancla: queryApplyStep ya NO re-ejecuta la cadena completa (sin queryRebuildModel)',
    !applyStep.includes('queryRebuildModel(model)'), 'replay solo queda en undo/reset/quitar paso');
  const rebuildSrc = grabFn(wsCode, 'queryRebuildModel');
  check('ancla: queryRebuildModel sigue siendo autoridad de replay desde base',
    rebuildSrc.includes('baseHeaders') && rebuildSrc.includes('baseRows'), '');
}

// Comportamiento 1: detect-type sigue normalizando (numeros y fechas) en UNA pasa,
// sin mutar la estructura de entrada (aislamiento del clon de queryCloneShape).
{
  const shape = { headers: ['A'], rows: [[' 12,5 '], ['03/05/2024'], ['abc']] };
  const frozen = JSON.stringify(shape.rows);
  const r = run(shape, 'detect-type', { index: 0 });
  check('detect-type normaliza numero europeo 12,5 -> 12.5', r.rows[0][0] === '12.5', JSON.stringify(r.rows[0]));
  check('detect-type normaliza fecha a ISO 2024-03-05', r.rows[1][0] === '2024-03-05', JSON.stringify(r.rows[1]));
  check('detect-type deja texto intacto', r.rows[2][0] === 'abc', JSON.stringify(r.rows[2]));
  check('detect-type NO muta la estructura de entrada (clon profundo aislado)', JSON.stringify(shape.rows) === frozen, '');
}

// Comportamiento 2: equivalencia incremental == replay en cadenas reales.
scenario('cadena detect-type + filter + sort', ['Nombre', 'Edad', 'Ciudad'], [
  ['ana', '12,5', 'madrid  '],
  ['bob', ' 30 ', '  barcelona'],
  ['ana', '7', ' sevilla'],
  ['carl', '22', 'madrid'],
], [
  ['detect-type', { index: 1 }],
  ['trim', { index: 2 }],
  ['filter', { index: 0, operator: 'contains', value: 'ana' }],
  ['sort', { index: 1, direction: 'asc' }],
]);

scenario('cadena uppercase multi-columna + add-index + dedup', ['X', 'Y'], [
  ['a', '1'],
  ['b', '2'],
  ['a', '1'],
], [
  ['uppercase', { indexes: [0, 1] }],
  ['add-index', { start: 1 }],
  ['remove-duplicates', {}],
]);

// Comportamiento 3: fill-down / fill-up siguen secuenciales (cada celda no vacia
// se convierte en semilla) y aislados (no tocan otras columnas ni el origen).
{
  const base = { headers: ['A', 'B'], rows: [['a', ''], ['b', 'x'], ['c', ''], ['d', '']] };
  const d = run(base, 'fill-down', { index: 1 });
  check('fill-down rellena las vacias con la semilla previa', JSON.stringify(d.rows.map(r => r[1])) === JSON.stringify(['', 'x', 'x', 'x']), JSON.stringify(d.rows.map(r => r[1])));
  check('fill-down no toca la columna 0 del resultado', JSON.stringify(d.rows.map(r => r[0])) === JSON.stringify(['a', 'b', 'c', 'd']), '');
  check('fill-down no muta el origen', JSON.stringify(base.rows) === JSON.stringify([['a', ''], ['b', 'x'], ['c', ''], ['d', '']]), '');
  const u = run({ headers: ['A', 'B'], rows: [['a', ''], ['b', 'x'], ['c', ''], ['d', '']] }, 'fill-up', { index: 1 });
  check('fill-up rellena desde la semilla que viene de abajo', JSON.stringify(u.rows.map(r => r[1])) === JSON.stringify(['x', 'x', '', '']), JSON.stringify(u.rows.map(r => r[1])));
  check('fill-up no toca la columna 0 del resultado', JSON.stringify(u.rows.map(r => r[0])) === JSON.stringify(['a', 'b', 'c', 'd']), '');
}

// Comportamiento 4: la cadena incremental y el replay coinciden en cada aplicacion
// intermedia (no solo al final).
{
  const headers = ['A', 'B'];
  const rows = [['1', 'zzz'], ['2', 'AAA'], ['3', 'm  i  x']];
  const chain = [
    ['detect-type', { index: 0 }],
    ['lowercase', { index: 1 }],
    ['clean', { index: 1 }],
    ['add-index', {}],
  ];
  const inc = makeModel(headers, rows);
  const base = makeModel(headers, rows);
  let allEqual = true;
  for (let n = 1; n <= chain.length; n++) {
    const [op, config] = chain[n - 1];
    incrementalApply(inc, op, config);
    base.steps = chain.slice(0, n).map(([o, c]) => ({ operation: o, config: { ...c } }));
    const rp = rebuild(base);
    if (JSON.stringify(rp.headers) !== JSON.stringify(inc.headers) ||
        JSON.stringify(rp.rows) !== JSON.stringify(inc.rows)) allEqual = false;
  }
  check('equivalencia en CADA aplicacion intermedia (n=1..4)', allEqual, JSON.stringify(inc.rows));
}

// Comportamiento 5: undo/reset siguen autoritativos: tras aplicar pasos
// incrementales, quitar el ultimo paso + replay devuelve el estado previo.
{
  const inc = scenario('undo tras cadena incremental', ['P', 'Q'], [['a', '1'], ['b', '2']], [
    ['uppercase', { indexes: [0, 1] }],
    ['sort', { index: 1, direction: 'desc' }],
  ]);
  const beforeRows = JSON.stringify(inc.rows);
  inc.steps = inc.steps.slice(0, -1);
  const undone = rebuild(inc);
  check('undo (quitar ultimo paso + replay) deja el estado de un solo paso',
    JSON.stringify(undone.rows) === JSON.stringify([['A', '1'], ['B', '2']]), JSON.stringify(undone.rows));
  check('undo no borra la fila recuperada del paso previo (distinto del estado de 2 pasos)',
    JSON.stringify(undone.rows) !== beforeRows, '');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);