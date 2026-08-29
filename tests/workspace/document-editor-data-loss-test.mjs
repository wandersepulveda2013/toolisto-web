#!/usr/bin/env node
/**
 * document-editor-data-loss-test.mjs (CE-066)
 * Protege contra regresiones de dos perdidas de datos reales del editor de
 * documentos del Workspace:
 *
 * 1. Exportacion HTML: los bloques `table` y `chart` generados por los flujos
 *    se descartaban (un `<table>` salia como `<p></p>` vacio). Ahora
 *    `documentBlocksToHtml` (core/workflow-operations.js) preserva la data.
 * 2. Autosave de ediciones estructurales: borrar un bloque (Backspace),
 *    crear uno nuevo (Enter) o cambiar el tipo (menu `slash`) solo llamaba a
 *    `renderBlocks()` sin marcar el documento como pendiente de guardar, asi
 *    que el cambio se perdia al recargar. Ahora esas tres rutas llaman a
 *    `autoSaveDoc(doc)`.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const regCode = readFileSync(join(ROOT, 'workspace', 'core', 'operation-registry.js'), 'utf8');
const opsCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-operations.js'), 'utf8');
const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

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
  combined + '\nglobalThis.documentBlocksToHtml = documentBlocksToHtml;'
);
script.runInNewContext(sandbox);

const documentBlocksToHtml = sandbox.documentBlocksToHtml;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

console.log('=== Editor documento: perdida de datos (CE-066) Tests ===\n');

console.log('-- documentBlocksToHtml: table --');
let html = documentBlocksToHtml([{ type: 'table', headers: ['Ciudad', 'Poblacion'], rows: [['Madrid', '3200000'], ['Roma', '2800000']] }], { esc });
check('tabla genera <table>', html.includes('<table>'));
check('tabla conserva headers en <th>', html.includes('<th>Ciudad</th>') && html.includes('<th>Poblacion</th>'));
check('tabla conserva filas en <td>', html.includes('<td>Madrid</td>') && html.includes('<td>3200000</td>'));
check('tabla con filas sueltas conserva fila', documentBlocksToHtml([{ type: 'table', rows: [['a', 'b']] }], { esc }).includes('<td>a</td>'));

console.log('-- documentBlocksToHtml: chart --');
html = documentBlocksToHtml([{ type: 'chart', content: 'Ventas', series: [{ label: 'T1', value: 1200 }, { label: 'T2', value: 980 }] }], { esc });
check('chart renderiza titulo', html.includes('<h2>Ventas</h2>'));
check('chart conserva etiquetas', html.includes('<td>T1</td>') && html.includes('<td>T2</td>'));
check('chart conserva valores', html.includes('<td>1200</td>') && html.includes('<td>980</td>'));
check('chart sin series no rompe', documentBlocksToHtml([{ type: 'chart', content: 'X' }], { esc }).includes('X'));

console.log('-- documentBlocksToHtml: otros bloques --');
html = documentBlocksToHtml([
  { type: 'heading1', content: 'Titulo' },
  { type: 'paragraph', content: 'Parrafo <b>raro</b>' },
  { type: 'quote', content: 'Cita' },
  { type: 'code', content: 'const a = 1;' },
  { type: 'divider' },
], { esc });
check('heading1 -> h1', html.includes('<h1>Titulo</h1>'));
check('texto escapado (no inyecta HTML crudo)', html.includes('&lt;b&gt;') && !/<p>Parrafo <b>raro<\/b>/.test(html));
check('quote -> blockquote', html.includes('<blockquote>Cita</blockquote>'));
check('code -> pre', html.includes('<pre>const a = 1;</pre>'));
check('divider -> hr', html.includes('<hr>'));

console.log('-- documentBlocksToHtml: rico (html + sanitize) --');
html = documentBlocksToHtml([{ type: 'paragraph', content: 'x', html: '<b>negrita</b>' }], { esc, sanitizeHtml: (h) => h });
check('preserva html rico cuando existe', html.includes('<p><b>negrita</b></p>'));

console.log('-- Autosave de ediciones estructurales en workspace.js --');
const autoSaveCalls = wsCode.split('\n')
  .map((line, i) => ({ line: line.trim(), i: i + 1 }))
  .filter(e => /autoSaveDoc\(doc\);/.test(e.line))
  .map(e => e.i);
check('workspace.js declara autoSaveDoc(doc)', /function autoSaveDoc\(doc\)/.test(wsCode));
check('3 rutas estructurales llaman a autoSaveDoc', autoSaveCalls.length >= 3,
  'visto: ' + autoSaveCalls.join(', '));

function hasSequence(startLine, afterPattern) {
  const lines = wsCode.split('\n');
  for (let i = startLine - 1; i < lines.length; i++) {
    if (/renderBlocks\(\);/.test(lines[i])) {
      return i + 2 <= lines.length && /autoSaveDoc\(doc\);/.test(lines[i + 1]);
    }
  }
  return false;
}
const backspaceIdx = wsCode.split('\n').map(l => l.trim()).findIndex(l => /Backspace' && block.content === ''/.test(l) || /Backspace' && block/.test(l));
check('Borrar bloque (Backspace) guarda tras renderBlocks', hasSequence(Math.max(0, backspaceIdx)));
check('Enter crea bloque y guarda tras renderBlocks', /doc\.blocks\.splice\(index \+ 1, 0, newBlock\);\s*\n\s*renderBlocks\(\);\s*\n\s*autoSaveDoc\(doc\);/.test(wsCode.replace(/\r/g, '')));
check('cambio de tipo (slash) guarda tras renderBlocks', /hideSlashMenu\(\);\s*\n\s*renderBlocks\(\);\s*\n\s*autoSaveDoc\(doc\);/.test(wsCode.replace(/\r/g, '')));

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
