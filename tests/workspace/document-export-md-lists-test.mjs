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
const woCode = readFileSync(new URL('../../workspace/core/workflow-operations.js', import.meta.url), 'utf8');
const splitSrc = grabFn(woCode, 'splitHtmlAtPageBreak').replace(/^export function/, 'function');
const textSrc = grabFn(woCode, 'htmlFragmentToText').replace(/^export function/, 'function');
const src = grabFn(wsCode, 'exportDocumentMarkdown');
const md = new Function(splitSrc + '\n' + textSrc + '\n' + src + '\nreturn exportDocumentMarkdown;')();

const doc = (blocks, title) => ({ title: title || 'Documento', blocks });

console.log('=== CE-111: exportDocumentMarkdown emite listas e imagenes (no las pierde) ===');
console.log('(exportDocumentMarkdown REAL, pura, sin DOM)');

// 1. bullet-list
{
  const m = md(doc([{ type: 'bullet-list', content: 'Un hallazgo' }], 'Informe'));
  check('bullet-list emite "- Un hallazgo"', m.includes('- Un hallazgo'), JSON.stringify(m));
  check('bullet-list conserva el titulo', m.startsWith('# Informe'), JSON.stringify(m));
}

// 2. numbered-list
{
  const m = md(doc([{ type: 'numbered-list', content: 'Primer paso' }]));
  check('numbered-list emite "1. Primer paso"', m.includes('1. Primer paso'), JSON.stringify(m));
}

// 3. image-block con dataUrl base64
{
  const m = md(doc([{ type: 'image-block', content: 'data:image/png;base64,iVBORw0KGgo=' }]));
  check('image-block emite ![imagen](dataUrl)', m.includes('![imagen](data:image/png;base64,iVBORw0KGgo=)'), JSON.stringify(m));
  check('image-block no vierte la dataUrl como texto plano', !m.includes('data:image/png;base64,iVBORw0KGgo=M'), JSON.stringify(m));
}

// 4. Paridad con blocksToMarkdown: content tiene precedencia sobre dataUrl
//    (misma semantica que workflow-operations.js: String(block.content || block.dataUrl || ''))
{
  const m = md(doc([{ type: 'image-block', content: 'alt', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' }]));
  check('image-block da precedencia a content (paridad blocksToMarkdown)',
    m.includes('![imagen](alt)'), JSON.stringify(m));
}
// 4b. image-block cuyo content ES una data:image se usa directo
{
  const m = md(doc([{ type: 'image-block', content: 'data:image/jpeg;base64,/9j/2Q==', dataUrl: 'data:image/png;base64,IGN' }]));
  check('image-block con content=data:image lo usa (no dataUrl)',
    m.includes('![imagen](data:image/jpeg;base64,/9j/2Q==)') && !m.includes('IGN'), JSON.stringify(m));
}

// 5. image-block vacio no crashea ni emite ruido
{
  const m = md(doc([{ type: 'image-block' }]));
  check('image-block sin fuente no crashea', typeof m === 'string');
}

// 6. Mezcla de lista + imagen + titulo
{
  const m = md(doc([
    { type: 'heading1', content: 'Resumen' },
    { type: 'bullet-list', content: 'Punto A' },
    { type: 'bullet-list', content: 'Punto B' },
    { type: 'numbered-list', content: 'Paso 1' },
    { type: 'image-block', content: 'data:image/png;base64,AAA=' },
  ]));
  check('mezcla conserva heading1 (# Resumen)', m.includes('# Resumen'), JSON.stringify(m));
  check('mezcla conserva ambas viñetas en orden', m.indexOf('- Punto A') < m.indexOf('- Punto B'), JSON.stringify(m));
  check('mezcla conserva numbered-list', m.includes('1. Paso 1'), JSON.stringify(m));
  check('mezcla conserva la imagen', m.includes('![imagen](data:image/png;base64,AAA=)'), JSON.stringify(m));
}

// 7. Tipos preexistentes NO se rompen (regresion): heading, quote, table, callout, code, divider
{
  const m = md(doc([
    { type: 'quote', content: 'Una cita' },
    { type: 'divider' },
    { type: 'callout', content: 'Aviso' },
    { type: 'code', content: 'x = 1' },
    { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
  ]));
  check('quote intacta', m.includes('> Una cita'), JSON.stringify(m));
  check('divider intacto', m.includes('---'), JSON.stringify(m));
  check('callout intacto', m.includes('> **Nota:** Aviso'), JSON.stringify(m));
  check('code intacto', m.includes('```') && m.includes('x = 1'), JSON.stringify(m));
  check('tabla intacta (header+separador)', m.includes('| A | B |') && m.includes('| --- | --- |'), JSON.stringify(m));
  check('tabla intacta (fila)', m.includes('| 1 | 2 |'), JSON.stringify(m));
}

// 8. Bloque desconocido cae al fallback de contenido (sin romper)
{
  const m = md(doc([{ type: 'widget', content: 'texto libre' }]));
  check('bloque desconocido -> contenido', m.includes('texto libre'), JSON.stringify(m));
}

// 9. Anti-regresion estatica: exportDocument usa exportDocumentMarkdown
check('anti-regresion: exportDocument llama a exportDocumentMarkdown', /exportDocumentMarkdown\(doc\)/.test(wsCode));
check('anti-regresion: exportDocumentMarkdown maneja bullet-list', /type === 'bullet-list'/.test(src));
check('anti-regresion: exportDocumentMarkdown maneja numbered-list', /type === 'numbered-list'/.test(src));
check('anti-regresion: exportDocumentMarkdown maneja image-block', /type === 'image-block'/.test(src));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
