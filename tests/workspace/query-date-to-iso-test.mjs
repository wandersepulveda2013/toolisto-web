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
const isoSrc = grabFn(wsCode, 'queryDateToIso');
const queryDateToIso = new Function(isoSrc + '\nreturn queryDateToIso;')();

// Offset del proceso (minutos). Si != 0, la fecha via toISOString() se desplaza
// respecto a la fecha local escrita; el fix debe devolver SIEMPRE la fecha
// escrita (independiente de la zona horaria).
const probe = new Date('2024-12-31T00:00:00');
const tzOffset = probe.getTimezoneOffset(); // minutos al OESTE de UTC

console.log('=== CE-102: detect-type normaliza fechas SIN corrimiento de zona horaria ===');
console.log('(queryDateToIso REAL; offset UTC actual = ' + tzOffset + ' min)');

// 1. Año primero (ISO o barra): la fecha escrita se conserva sin TZ.
check('YYYY-MM-DD conserva el dia', queryDateToIso('2024-12-31') === '2024-12-31', queryDateToIso('2024-12-31'));
check('YYYY/MM/DD conserva el dia', queryDateToIso('2024/12/31') === '2024-12-31', queryDateToIso('2024/12/31'));

// 2. Año al final (semantica US mes/dia/año, p. ej. MM/DD/YYYY): la fecha
//    escrita se conserva (antes, new Date(...).toISOString() desplazaba a UTC).
check('MM/DD/YYYY (31 dic) conserva la fecha', queryDateToIso('12/31/2024') === '2024-12-31', queryDateToIso('12/31/2024'));
check('MM/DD/YYYY (15 ene) conserva la fecha', queryDateToIso('01/15/2024') === '2024-01-15', queryDateToIso('01/15/2024'));

// 3. Componentes con padding zero se normalizan a dos digitos.
check('mes/dia con ceros se normalizan', queryDateToIso('03/05/2024') === '2024-03-05', queryDateToIso('03/05/2024'));
check('YYYY/2/7 se rellena', queryDateToIso('2024/2/7') === '2024-02-07', queryDateToIso('2024/2/7'));

// 4. La fecha escrita es SIEMPRE la salida (invariante de TZ): comparar la
//    reconstruction contra la fecha escrita en el formato original.
{
  const cases = ['2024-12-31', '2024/12/31', '12/31/2024', '01/15/2024', '2024/2/7'];
  let stable = true;
  for (const s of cases) {
    const out = queryDateToIso(s);
    // desarmar el escrito (año inequívoco al inicio o al final)
    const m = s.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})/);
    let y, mo, d;
    if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else { mo = +m[1]; d = +m[2]; y = +m[3]; }
    const exp = String(y) + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (out !== exp) stable = false;
  }
  check('salida == fecha escrita en todos los formatos (TZ-fertilizante)', stable, JSON.stringify(cases.map(queryDateToIso)));
}

// 5. Invariante de zona horaria: la salida es la fecha CALENDARIO LOCAL escrita
//    (la que ve el usuario al teclear), no una conversion a UTC. Para formatos
//    barra, Date.parse los toma como medianoche local; queryDateToIso debe
//    devolver los mismos componentes locales, sin importar el offset del host.
{
  const localOf = s => {
    const d = new Date(s);
    return String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const cases = ['12/31/2024', '12/31/2024', '01/15/2024', '03/05/2024', '2024/12/31'];
  let match = true;
  for (const s of cases) {
    if (queryDateToIso(s) !== localOf(s)) match = false;
  }
  check('salida == fecha local escrita (TZ) en formatos barra/anio', match, 'offset=' + tzOffset + 'min; ' + JSON.stringify(cases.map(s => queryDateToIso(s) + ' vs ' + localOf(s))));
  // YYYY/MM/DD tambien debe preservar la fecha escrita, no el corrimiento a UTC.
  check('YYYY/MM/DD == fecha local escrita', queryDateToIso('2024/12/31') === localOf('2024/12/31'), queryDateToIso('2024/12/31'));
}

// 6. El bloque real de detect-type en queryRunOperation usa queryDateToIso
//    (en lugar del viejo new Date(...).toISOString().slice(0,10)).
{
  const dtBlock = wsCode.slice(wsCode.indexOf("if (operation === 'detect-type')"), wsCode.indexOf('operation === \'replace-values\''));
  check('detect-type usa queryDateToIso', dtBlock.includes('queryDateToIso'), dtBlock.split('\n')[2]?.trim() || '');
  check('detect-type ya no usa toISOString para normalizar', !dtBlock.includes('.toISOString()'), '');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);