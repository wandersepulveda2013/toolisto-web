#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const pdfCode = readFileSync(join(ROOT, 'workspace', 'core', 'pdf-generator.js'), 'utf8');
const pdfImagesCode = readFileSync(join(ROOT, 'workspace', 'core', 'pdf-images.js'), 'utf8');
const opsCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-operations.js'), 'utf8');
const parserCode = readFileSync(join(ROOT, 'workspace', 'core', 'tabular-text-parser.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const combined = [
  stripImports(regCode),
  stripImports(pdfCode),
  stripImports(pdfImagesCode),
  stripImports(parserCode),
  stripImports(opsCode),
].join('\n');

const sandbox = {
  console,
  Map, Array, Object, Error, Math, Date, JSON, Number, String,
  Promise, Set, setTimeout, clearTimeout, parseInt, parseFloat,
  Uint8Array, TextEncoder, TextDecoder, atob,
  AbortController: class AbortController { constructor() { this.signal = { aborted: false }; } },
};
// Node traits that pdf-generator leans on when atob is absent; keep both paths.
if (typeof globalThis.Buffer !== 'undefined') sandbox.Buffer = globalThis.Buffer;
sandbox.Blob = globalThis.Blob;

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

console.log('=== Workflow document.to-pdf Tests ===\n');

// 1. Operation is registered with a coherent descriptor
const registry = createOperationRegistry();
const registered = registerWorkflowOperations(registry);
const op = registry.get('document.to-pdf');
check('document.to-pdf is registered', registered > 0 && !!op);
check('document.to-pdf has name', op && op.name === 'Convertir documento a PDF');
check('document.to-pdf category pdf', op && op.category === 'pdf');
check('document.to-pdf accepts document input', op && op.inputKinds.includes('document'));
check('document.to-pdf outputs file', op && op.outputKind === 'file');
check('document.to-pdf not batch terminal', op && !op.batchTerminal);
check('document.to-pdf visible in pdf category', registry.listByCategory('pdf').some(o => o.id === 'document.to-pdf'));

// 2. Executes against a Toolisto document and returns a valid PDF Blob
{
  const doc = {
    name: 'Informe de ventas',
    title: 'Informe de ventas',
    type: 'document',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Informe de ventas' },
      { id: 'b2', type: 'heading2', content: 'Resumen Q1' },
      { id: 'b3', type: 'paragraph', content: 'Las ventas crecieron un 12%.' },
      { id: 'b4', type: 'bullet-list', content: 'Primer hallazgo' },
      { id: 'b5', type: 'divider' },
      { id: 'b6', type: 'heading2', content: 'Proximos pasos' },
      { id: 'b7', type: 'paragraph', content: 'Revisar las exportaciones.' },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: {} });
  check('document.to-pdf returns a Blob', result instanceof Blob);
  check('document.to-pdf mime is application/pdf', result instanceof Blob && result.type === 'application/pdf');
  const text = await result.text();
  check('PDF header present', text.startsWith('%PDF-1'));
  check('PDF has xref', text.includes('xref'));
  check('PDF has trailer', text.includes('trailer') || text.includes('startxref'));
  check('PDF has /Info', text.includes('/Info'));
  check('PDF has /Title', text.includes('/Title'));
  check('PDF embeds document title text', text.includes('Informe de ventas'));
  check('PDF embeds a body line', text.includes('Las ventas crecieron'));
  check('PDF contains no NaN', !text.includes('NaN'));
  check('PDF contains no undefined', !text.includes('undefined'));
  check('PDF size > 100 bytes', text.length > 100);
}

// 3. Honors includeTitle=false by rendering heading as subtitle, not dropping it
{
  const doc = {
    title: 'Sin titulo en portada',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Seccion principal' },
      { id: 'b2', type: 'paragraph', content: 'Contenido directo.' },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: { includeTitle: false } });
  const text = await result.text();
  check('includeTitle=false still renders heading text', text.includes('Seccion principal'));
  check('includeTitle=false keeps body', text.includes('Contenido directo'));
}

// 4. Empty / missing blocks does not crash and yields a usable PDF
{
  const result = await op.execute({ input: { data: { title: 'Vacio', name: 'Vacio' } }, options: {} });
  const text = await result.text();
  check('Empty document yields a valid PDF header', text.startsWith('%PDF-1'));
  check('Empty document PDF has xref', text.includes('xref'));
}

// 5. Compatibility with report.create output (heading + paragraph blocks)
{
  const reportInput = {
    data: {
      title: 'Informe', type: 'report',
      blocks: [
        { id: 'a', type: 'heading1', content: 'Informe' },
        { id: 'c', type: 'paragraph', content: 'Basado en los datos proporcionados.' },
      ],
    },
  };
  const result = await op.execute({ input: reportInput, options: { title: 'Informe final' } });
  const text = await result.text();
  check('Report blocks convert to PDF', text.startsWith('%PDF-1'));
  check('Report PDF title honors explicit option', text.includes('Informe final') || text.includes('Informe'));
  check('Report PDF includes content line', text.includes('Basado en los datos'));
}

// 6. report.create embeds a real table block when fed headers + rows
{
  const reportOp = registry.get('report.create');
  const doc = await reportOp.execute({
    input: { data: { headers: ['Etiqueta', 'Ventas'], rows: [['Q1', '1200'], ['Q2', '980']] } },
    options: { includeDate: false },
  });
  const tableBlock = (doc.blocks || []).find(b => b.type === 'table');
  check('report.create emits a table block', !!tableBlock);
  check('report.create table block carries headers', tableBlock && Array.isArray(tableBlock.headers) && tableBlock.headers.length === 2);
  check('report.create table block carries rows', tableBlock && Array.isArray(tableBlock.rows) && tableBlock.rows.length === 2);
}

// 7. document.to-pdf renders a table block as a real PDF grid
{
  const doc = {
    title: 'Informe con tabla',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Informe con tabla' },
      { id: 'b2', type: 'table', headers: ['Etiqueta', 'Ventas'], rows: [['Q1', '1200'], ['Q2', '980']] },
      { id: 'b3', type: 'paragraph', content: 'Fin del informe.' },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: {} });
  const text = await result.text();
  check('PDF table section renders header cell', text.includes('Etiqueta'));
  check('PDF table section renders row cells', text.includes('Q1') && text.includes('1200'));
  check('PDF table section renders last row', text.includes('Q2') && text.includes('980'));
  check('PDF table section keeps body after grid', text.includes('Fin del informe'));
}

// 8. Star flow chain: text.to-table -> report.create -> document.to-pdf keeps real grid
{
  const toTable = registry.get('text.to-table');
  const table = await toTable.execute({ input: { data: { blocks: [{ id: 't', type: 'paragraph', content: 'Categoria|Ventas\nA|10\nB|20' }] } }, options: {} });
  const reportOp = registry.get('report.create');
  const report = await reportOp.execute({ input: { data: table }, options: { includeDate: false } });
  const pdf = await op.execute({ input: report, options: {} });
  const text = await pdf.text();
  check('Star flow chain preserves header cell', text.includes('Categoria') && text.includes('Ventas'));
  check('Star flow chain preserves a data cell', text.includes('10') && text.includes('20'));
}

// 9. image-block with real JPEG dataUrl is embedded as a real PDF image
{
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
  const doc = {
    title: 'Informe con imagen',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Informe con imagen' },
      { id: 'b2', type: 'image-block', content: jpeg },
      { id: 'b3', type: 'paragraph', content: 'Fin del informe.' },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: {} });
  const text = await result.text();
  check('PDF embeds a real /Subtype /Image object', text.includes('/Subtype /Image'));
  check('PDF image uses DCTDecode (JPEG)', text.includes('/DCTDecode'));
  check('PDF image does not leak its base64 as text', !text.includes('/9j/4AAQSk'));
  check('PDF page links the image XObject resource', text.includes('/XObject <<') && text.includes('/Im1'));
  check('PDF keeps body text after the image', text.includes('Fin del informe'));
}

// 10. image-block with PNG in a canvas-less environment does not leak base64 as text
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ9wAAAABJRU5ErkJggg==';
  const doc = {
    title: 'Doc con PNG',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Doc con PNG' },
      { id: 'b2', type: 'image-block', content: png },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: {} });
  const text = await result.text();
  check('PNG image-block is mapped to an image section', text.includes('[Imagen embebida]') || text.includes('/Subtype /Image'));
  check('PNG base64 is not emitted as renderable text', !text.includes('iVBORw0KGgo'));
}

// 11. empty image-block renders an explicit placeholder, not base64
{
  const doc = {
    title: 'Doc sin imagen',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Doc sin imagen' },
      { id: 'b2', type: 'image-block' },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: {} });
  const text = await result.text();
  check('Empty image-block shows non-available placeholder', text.includes('Imagen no disponible'));
}

// 12. data.to-chart is registered with a coherent descriptor and numeric series
{
  const chartOp = registry.get('data.to-chart');
  check('data.to-chart is registered', !!chartOp);
  check('data.to-chart has name', chartOp && chartOp.name === 'Crear grafico');
  check('data.to-chart category chart', chartOp && chartOp.category === 'chart');
  check('data.to-chart accepts data input', chartOp && chartOp.inputKinds.includes('data'));
  check('data.to-chart outputs document', chartOp && chartOp.outputKind === 'document');
  check('data.to-chart visible in chart category', registry.listByCategory('chart').some(o => o.id === 'data.to-chart'));
}

// 13. data.to-chart converts a table into a chart document block
{
  const chartOp = registry.get('data.to-chart');
  const result = await chartOp.execute({
    input: { data: { headers: ['Etiqueta', 'Ventas'], rows: [['Q1', '1200'], ['Q2', '980'], ['Q3', '1450']] } },
    options: { title: 'Ventas 2026' },
  });
  const chartBlock = (result.blocks || []).find(b => b.type === 'chart');
  check('data.to-chart emits a chart block', !!chartBlock);
  check('data.to-chart chart block carries title', chartBlock && chartBlock.content === 'Ventas 2026');
  check('data.to-chart chart block carries numeric series', chartBlock && Array.isArray(chartBlock.series) && chartBlock.series.length === 3);
  check('data.to-chart series values are finite numbers', chartBlock && chartBlock.series.every(s => Number.isFinite(s.value) && typeof s.label === 'string'));
  check('data.to-chart honors Spanish decimal commas', chartBlock && chartBlock.series.some(s => s.value === 980));
}

// 14. document.to-pdf renders a chart block as a real PDF chart section
{
  const doc = {
    title: 'Informe con grafico',
    blocks: [
      { id: 'b1', type: 'heading1', content: 'Informe con grafico' },
      { id: 'b2', type: 'chart', content: 'Ventas por trimestre', series: [{ label: 'Q1', value: 1200 }, { label: 'Q2', value: 980 }, { label: 'Q3', value: 1450 }] },
      { id: 'b3', type: 'paragraph', content: 'Fin del informe.' },
    ],
  };
  const result = await op.execute({ input: { data: doc }, options: {} });
  const text = await result.text();
  check('PDF chart renders the chart title', text.includes('Ventas por trimestre'));
  check('PDF chart renders series labels', text.includes('Q1') && text.includes('Q3'));
  check('PDF chart renders a series value', text.includes('1200') || text.includes('1450'));
  check('PDF chart draws bars (re f)', /re\s+f/.test(text));
  check('PDF chart keeps body after chart', text.includes('Fin del informe'));
}

// 15. Star flow chain: text.to-table -> data.to-chart -> document.to-pdf embeds a real chart
{
  const toTable = registry.get('text.to-table');
  const table = await toTable.execute({ input: { data: { blocks: [{ id: 't', type: 'paragraph', content: 'Categoria|Ventas\nA|10\nB|20\nC|30' }] } }, options: {} });
  const chartOp = registry.get('data.to-chart');
  const chartDoc = await chartOp.execute({ input: { data: table }, options: { title: 'Ventas por categoria' } });
  const pdf = await op.execute({ input: chartDoc, options: {} });
  const text = await pdf.text();
  check('Star flow chart chain produces a valid PDF', text.startsWith('%PDF-1'));
  check('Star flow chart chain keeps the chart title', text.includes('Ventas por categoria'));
  check('Star flow chart chain draws bars', /re\s+f/.test(text));
  check('Star flow chart chain renders a numeric value', text.includes('20') || text.includes('30'));
}

// 16. report.create embeds a chart block when the table has a numeric column, and document.to-pdf renders it
{
  const reportOp = registry.get('report.create');
  const doc = await reportOp.execute({
    input: { data: { headers: ['Etiqueta', 'Ventas'], rows: [['Q1', '1200'], ['Q2', '980']] } },
    options: { includeDate: false },
  });
  const chartBlock = (doc.blocks || []).find(b => b.type === 'chart');
  check('report.create embeds a chart block for numeric data', !!chartBlock);
  check('report.create chart block carries series', chartBlock && Array.isArray(chartBlock.series) && chartBlock.series.length === 2);
  const pdf = await op.execute({ input: doc, options: {} });
  const text = await pdf.text();
  check('report chart reaches the PDF and draws bars', text.includes('Grafico de Ventas') && /re\s+f/.test(text));
}

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);