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
  console,
  Map, Array, Object, Error, Math, Date, JSON, Number, String,
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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('=== Workflow text.export (Markdown / texto plano) Tests ===\n');

const registry = createOperationRegistry();
registerWorkflowOperations(registry);
const op = registry.get('text.export');
check('text.export is registered', !!op);
check('text.export category text', op && op.category === 'text');
check('text.export outputs text', op && op.outputKind === 'text');
check('text.export accepts text+document', op && op.inputKinds.includes('text') && op.inputKinds.includes('document'));

const doc = {
  type: 'document',
  title: 'Mi documento',
  name: 'Mi documento',
  blocks: [
    { id: 'a', type: 'heading1', content: 'Titulo' },
    { id: 'b', type: 'heading2', content: 'Seccion' },
    { id: 'c', type: 'heading3', content: 'Subseccion' },
    { id: 'd', type: 'paragraph', content: 'Un parrafo de ejemplo.' },
    { id: 'e', type: 'bullet-list', content: 'Primer item' },
    { id: 'f', type: 'bullet-list', content: 'Segundo item' },
    { id: 'g', type: 'quote', content: 'Una cita' },
    { id: 'h', type: 'divider' },
    { id: 'i', type: 'table', headers: ['Etiqueta', 'Ventas'], rows: [['Q1', '1200'], ['Q2', '980']] },
  ],
};

// 1. Markdown export renders block structure
{
  const result = await op.execute({ input: { data: doc }, options: { format: 'md' } });
  check('md returns a Blob', result instanceof Blob);
  check('md mime is text/markdown', result instanceof Blob && result.type === 'text/markdown');
  const text = await result.text();
  check('md renders h1', text.includes('# Titulo'));
  check('md renders h2', text.includes('## Seccion'));
  check('md renders h3', text.includes('### Subseccion'));
  check('md renders paragraph', text.includes('Un parrafo de ejemplo.'));
  check('md renders bullet list', text.includes('- Primer item') && text.includes('- Segundo item'));
  check('md renders quote', text.includes('> Una cita'));
  check('md renders divider', text.includes('---'));
  check('md renders table header', text.includes('| Etiqueta | Ventas |'));
  check('md renders table separator', text.includes('| --- | --- |'));
  check('md renders table rows', text.includes('Q1') && text.includes('1200') && text.includes('980'));
}

// 2. Chart block renders as a fenced block with series table
{
  const chartDoc = {
    type: 'document', title: 'G',
    blocks: [
      { id: 'c', type: 'heading1', content: 'Grafico' },
      { id: 'd', type: 'chart', content: 'Ventas por trimestre', series: [{ label: 'Q1', value: 1200 }, { label: 'Q2', value: 980 }] },
    ],
  };
  const result = await op.execute({ input: { data: chartDoc }, options: { format: 'md' } });
  const text = await result.text();
  check('md chart includes fenced block', text.includes('```charts'));
  check('md chart includes title', text.includes('Ventas por trimestre'));
  check('md chart includes series values', text.includes('Q1') && text.includes('1200'));
  check('md chart closes fence', text.trimEnd().endsWith('```'));
}

// 3. Plain text export preserves structure without markdown markers
{
  const result = await op.execute({ input: { data: doc }, options: { format: 'txt' } });
  check('txt returns a Blob', result instanceof Blob);
  check('txt mime is text/plain', result instanceof Blob && result.type === 'text/plain');
  const text = await result.text();
  check('txt does not contain markdown # marker', !text.includes('# Titulo') && !text.includes('## '));
  check('txt retains content words', text.includes('Titulo') && text.includes('Seccion'));
  check('txt renders bullet with bullet char', text.includes('• Primer item'));
  check('txt renders table cell', text.includes('Etiqueta | Ventas'));
  check('txt renders a data cell', text.includes('1200'));
}

// 4. String input is exported verbatim regardless of format
{
  const result = await op.execute({ input: { data: 'texto suelto' }, options: { format: 'md' } });
  const text = await result.text();
  check('string input stays verbatim in md', text.includes('texto suelto'));
  const txtResult = await op.execute({ input: { data: 'texto suelto' }, options: { format: 'txt' } });
  check('string input stays verbatim in txt', (await txtResult.text()).includes('texto suelto'));
}

// 5. Empty blocks does not crash
{
  const result = await op.execute({ input: { data: { type: 'document', blocks: [] } }, options: { format: 'md' } });
  const text = await result.text();
  check('empty blocks md does not crash', typeof text === 'string');
}

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);
