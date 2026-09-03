#!/usr/bin/env node
// CE-106: las tablas Markdown escapan el pipe '|' en los ENCABEZADOS (las filas ya lo
//         hacian; los encabezados rompian la estructura de la tabla).
// CE-108: replace-values en modo 'contains' con 'find' vacio partia cada celda en
//         caracteres (split('')) destruyendo la columna; ahora deja la celda intacta.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

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

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

// ---------- CE-108: replace-values (queryRunOperation real) ----------
console.log('=== CE-108: replace-values "contains" con find vacio no destruye la celda ===');
const replaceOp = (() => {
  const d = grabFn(wsCode, 'queryCloneRows') + '\n' + grabFn(wsCode, 'queryCloneShape') + '\n' + grabFn(wsCode, 'queryRunOperation') + '\nreturn queryRunOperation;';
  return new Function(d)();
})();

// 1. find vacio + contains: celda intacta (antes split('').join('X') -> "XFXaXcXtXuXrXaX")
{
  const r = replaceOp({ headers: ['A'], rows: [['Factura'], ['123'], ['']] }, 'replace-values', { index: 0, mode: 'contains', find: '', replace: 'X' });
  check('find vacio: "Factura" intacta', JSON.stringify(r.rows) === JSON.stringify([['Factura'], ['123'], ['']]), JSON.stringify(r.rows));
}

// 2. find no vacio + contains: comportamiento normal conservado
{
  const r = replaceOp({ headers: ['A'], rows: [['factura'], ['Prefactura'], ['']] }, 'replace-values', { index: 0, mode: 'contains', find: 'factura', replace: 'X' });
  check('contains no vacio reemplaza coincidencias', JSON.stringify(r.rows) === JSON.stringify([['X'], ['PreX'], ['']]), JSON.stringify(r.rows));
}

// 3. modo exacto con find vacio conserva el comportamiento: solo celdas vacias cambian
{
  const r = replaceOp({ headers: ['A'], rows: [['Factura'], ['']] }, 'replace-values', { index: 0, mode: 'exact', find: '', replace: 'X' });
  check('exact find vacio: celda vacia -> X, otra intacta', JSON.stringify(r.rows) === JSON.stringify([['Factura'], ['X']]), JSON.stringify(r.rows));
}

// 4. find no vacio + exact: comportamiento normal conservado
{
  const r = replaceOp({ headers: ['A'], rows: [['Factura'], ['Pedido']] }, 'replace-values', { index: 0, mode: 'exact', find: 'Factura', replace: 'X' });
  check('exact no vacio reemplaza solo iguales', JSON.stringify(r.rows) === JSON.stringify([['X'], ['Pedido']]), JSON.stringify(r.rows));
}

// 5. find vacio contiene: no corrompe numeros
{
  const r = replaceOp({ headers: ['A'], rows: [['1500'], ['2500']] }, 'replace-values', { index: 0, mode: 'contains', find: '', replace: 'Z' });
  check('find vacio: numeros intactos', JSON.stringify(r.rows) === JSON.stringify([['1500'], ['2500']]), JSON.stringify(r.rows));
}

// 6. anti-regresion estatica: el UI valida find vacio en modo contains
{
  const guard = "config.mode === 'contains' && !config.find";
  const needle = "operation === 'replace-values'";
  // la rama del modal es la ULTIMA aparicion; buscar el guard a partir de ahi
  let last = -1, from = 0;
  while (true) {
    const idx = wsCode.indexOf(needle, from);
    if (idx === -1) break;
    last = idx;
    from = idx + 1;
  }
  const modalSlice = last !== -1 ? wsCode.slice(last, last + 2000) : '';
  check('UI avisa con find vacio en contains', last !== -1 && modalSlice.includes(guard), '');
}

// ---------- CE-106: Markdown table header pipe escaping ----------
console.log('\n=== CE-106: encabezados de tabla Markdown escapan el pipe ===');

// Harness VM para text.export (workflow path) igual que workflow-export-md-test
const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const opsCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-operations.js'), 'utf8');
function stripImports(code) { return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, ''); }
const combined = [stripImports(regCode), stripImports(opsCode)].join('\n');
const sandbox = {
  console, Map, Array, Object, Error, Math, Date, JSON, Number, String,
  Promise, Set, setTimeout, clearTimeout, parseInt, parseFloat,
  Uint8Array, TextEncoder, TextDecoder, atob, Blob: globalThis.Blob,
  AbortController: class AbortController { constructor() { this.signal = { aborted: false }; } },
};
if (typeof globalThis.Buffer !== 'undefined') sandbox.Buffer = globalThis.Buffer;
const script = new vm.Script(combined + '\nglobalThis.createOperationRegistry = createOperationRegistry;\nglobalThis.registerWorkflowOperations = registerWorkflowOperations;');
script.runInNewContext(sandbox);
const registry = sandbox.createOperationRegistry();
sandbox.registerWorkflowOperations(registry);
const exportOp = registry.get('text.export');
assert(exportOp, 'text.export debe estar registrado');

// 7. header con pipe se escapa en la ruta de flujo (workflow-operations blocksToMarkdown)
{
  const doc = {
    type: 'document', title: 'T', name: 'T',
    blocks: [{ id: 't', type: 'table', headers: ['Precio | IVA', 'Total'], rows: [['100', '121'], ['200', '242']] }],
  };
  const result = await exportOp.execute({ input: { data: doc }, options: { format: 'md' } });
  const text = await result.text();
  check('header con pipe se escapa', text.includes('| Precio \\| IVA | Total |'), JSON.stringify(text.split('\n')[0]));
  check('separador generado', text.includes('| --- | --- |'), '');
  check('filas intactas', text.includes('| 100 | 121 |') && text.includes('| 200 | 242 |'), '');
}

// 8. header SIN pipe no cambia (regresion: salida identica a antes)
{
  const doc = {
    type: 'document', title: 'T', name: 'T',
    blocks: [{ id: 't', type: 'table', headers: ['Etiqueta', 'Ventas'], rows: [['Q1', '1200'], ['Q2', '980']] }],
  };
  const result = await exportOp.execute({ input: { data: doc }, options: { format: 'md' } });
  const text = await result.text();
  check('header sin pipe queda igual', text.includes('| Etiqueta | Ventas |'), '');
  check('separador | --- | --- |', text.includes('| --- | --- |'), '');
}

// 9. anti-regresion estatica: exportDocument (workspace.js) tambien escapa encabezados
{
  const idx = wsCode.indexOf('async function exportDocument');
  assert(idx !== -1, 'exportDocument debe existir');
  const headerLine = wsCode.indexOf('headersT.map(', idx);
  const slice = wsCode.slice(headerLine, headerLine + 120);
  check('exportDocument escapa headers con replace(\\|)', slice.includes('replace(/\\|/g'), slice.split('\n')[0]);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
