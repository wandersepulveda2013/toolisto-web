#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const opsCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-operations.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const combined = [stripImports(regCode), stripImports(opsCode)].join('\n');

const sandbox = {
  console, Map, Array, Object, Error, Math, Date, JSON, Number, String,
  Promise, Set, setTimeout, clearTimeout, parseInt, parseFloat,
  Uint8Array, TextEncoder, TextDecoder, atob,
  Blob: globalThis.Blob,
  AbortController: class AbortController { constructor() { this.signal = { aborted: false }; } },
};
if (typeof globalThis.Buffer !== 'undefined') sandbox.Buffer = globalThis.Buffer;

const script = new vm.Script(
  combined + '\nglobalThis.createOperationRegistry = createOperationRegistry;\n' +
  'globalThis.registerWorkflowOperations = registerWorkflowOperations;'
);
script.runInNewContext(sandbox);

const createOperationRegistry = sandbox.createOperationRegistry;
const registerWorkflowOperations = sandbox.registerWorkflowOperations;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Workflow text.to-document (Markdown -> bloques) Tests ===\n');

const registry = createOperationRegistry();
registerWorkflowOperations(registry);
const op = registry.get('text.to-document');
check('text.to-document is registered', !!op);
check('text.to-document outputKind document', op && op.outputKind === 'document');

const run = async (text, options = {}) => {
  const res = await op.execute({ input: { data: text }, options });
  return res.blocks;
};

let res = await run('| Ciudad | Poblacion |\n| --- | --- |\n| Madrid | 3200000 |\n| Roma | 2800000 |\n');
check('tabla GFM -> un bloque table', res.length === 1 && res[0].type === 'table');
check('tabla GFM headers', res.length === 1 && JSON.stringify(res[0].headers) === JSON.stringify(['Ciudad', 'Poblacion']));
check('tabla GFM rows', res.length === 1 && res[0].rows.length === 2 && res[0].rows[0][0] === 'Madrid');
check('tabla GFM rows sanas (sin separador)', res[0].rows.every(r => r.length === 2 && !r.some(c => /^---$/.test(c))));

res = await run('# Titulo\n\n- uno\n- dos\n\nParrafo normal');
const types = res.map(b => b.type);
check('titulo -> heading1', types[0] === 'heading1');
check('lista -> bullet-list x2', types.filter(t => t === 'bullet-list').length === 2);
check('parrafo al final', types[types.length - 1] === 'paragraph');

res = await run('> Cita importante\n\n```js\nconst x = 1;\n```');
const hasQuote = res.some(b => b.type === 'quote' && b.content === 'Cita importante');
const hasCode = res.some(b => b.type === 'code' && b.content === 'const x = 1;' && b.lang === 'js');
check('cita > -> quote', hasQuote);
check('bloque fenced -> code con lang', hasCode);

res = await run('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nDespues de la tabla');
check('tabla seguida de parrafo', res.length === 2 && res[0].type === 'table' && res[1].type === 'paragraph');

res = await run('linea con | pipe pero sin separador de tabla');
check('pipe sin separador NO es tabla', res.length === 1 && res[0].type === 'paragraph');

res = await run('');
check('texto vacio -> sin bloques', res.length === 0);

const res2 = await run('| x | y |\n| --- | --- |\n| a\\|b | c |');
check('celdas escapan pipe', res2[0].rows[0][0] === 'a|b');

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
