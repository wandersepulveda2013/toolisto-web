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

const btmSrc = grabFn(woCode, 'blocksToMarkdown');
const fenceSrc = grabFn(woCode, 'fence');
const fenceEndSrc = grabFn(woCode, 'fenceEnd');
const blocksToMarkdownReal = new Function(fenceSrc + '\n' + fenceEndSrc + '\n' + splitSrc + '\n' + textSrc + '\n' + btmSrc + '\nreturn blocksToMarkdown;')();

const doc = (blocks, title) => ({ title: title || 'Documento', blocks });
const fenceOpen = '```' + 'charts';
const fenceClose = '```';

console.log('=== CE-128: exportDocumentMarkdown emite los graficos (case chart) ===');
console.log('(exportDocumentMarkdown REAL, pura, sin DOM; paridad blocksToMarkdown)');

// 1. chart con series: fence ```charts + titulo + tabla Etiqueta/Valor
{
  const m = md(doc([{ type: 'chart', content: 'Ventas 2026', series: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }] }]));
  check('chart abre fence ```charts', m.includes(fenceOpen), JSON.stringify(m));
  check('chart conserva el titulo', m.includes('Ventas 2026'), JSON.stringify(m));
  check('chart emite cabecera Etiqueta/Valor', m.includes('| Etiqueta | Valor |'), JSON.stringify(m));
  check('chart emite separador de tabla', m.includes('| --- | --- |'), JSON.stringify(m));
  check('chart emite serie A=10', m.includes('| A | 10 |'), JSON.stringify(m));
  check('chart emite serie B=20', m.includes('| B | 20 |'), JSON.stringify(m));
  check('chart cierra fence', m.includes(fenceClose), JSON.stringify(m));
  check('chart ya NO cae al fallback de solo contenido', !m.includes('Ventas 2026\n\n\n'), JSON.stringify(m));
}

// 2. pipe en la etiqueta se escapa (paridad con filas/cabeceras de tabla)
{
  const m = md(doc([{ type: 'chart', content: 'T', series: [{ label: 'X | Y', value: 3 }] }]));
  check('chart escapa el pipe de la etiqueta', m.includes('| X \\| Y | 3 |'), JSON.stringify(m));
}

// 3. chart sin content usa el titulo por defecto 'Grafico' (paridad blocksToMarkdown)
{
  const m = md(doc([{ type: 'chart', series: [{ label: 'A', value: 1 }] }]));
  check('chart sin content usa "Grafico"', m.includes('```charts\nGrafico\n'), JSON.stringify(m));
}

// 4. chart sin series: fence + titulo, sin tabla, sin crash
{
  const m = md(doc([{ type: 'chart', content: 'Solo titulo' }]));
  check('chart sin series no crashea', typeof m === 'string');
  check('chart sin series conserva fence y titulo', m.includes(fenceOpen) && m.includes('Solo titulo'), JSON.stringify(m));
  check('chart sin series NO emite cabecera', !m.includes('| Etiqueta | Valor |'), JSON.stringify(m));
}

// 5. valor ausente -> celda vacia (String(value ?? '')); numerico -> String(value)
{
  const m0 = md(doc([{ type: 'chart', content: 'T', series: [{ label: 'C' }] }]));
  const m42 = md(doc([{ type: 'chart', content: 'T', series: [{ label: 'C', value: 42 }] }]));
  check('chart con value undefined emite celda vacia', m0.includes('| C |  |'), JSON.stringify(m0));
  check('chart con value numerico emite String(value)', m42.includes('| C | 42 |') && !m0.includes('42'), JSON.stringify({ m42, m0 }));
}

// 6. mezcla ordenada con otros bloques
{
  const m = md(doc([
    { type: 'heading1', content: 'Resumen' },
    { type: 'chart', content: 'Ventas', series: [{ label: 'A', value: 5 }] },
    { type: 'bullet-list', content: 'Punto' },
  ]));
  check('mezcla conserva heading1', m.includes('# Resumen'), JSON.stringify(m));
  check('mezcla intercala el chart en orden', m.indexOf('# Resumen') < m.indexOf('```charts') && m.indexOf('```charts') < m.indexOf('- Punto'), JSON.stringify(m));
}

// 7. Paridad directa: mismo bloque chart -> mismo contenido que blocksToMarkdown (vm real)
{
  const chart = { type: 'chart', content: 'Paridad', series: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }] };
  const mine = md(doc([chart]));
  const canonical = blocksToMarkdownReal([chart]);
  for (const fragment of [fenceOpen, 'Paridad', '| Etiqueta | Valor |', '| --- | --- |', '| A | 10 |', '| B | 20 |']) {
    check('paridad con blocksToMarkdown: ' + JSON.stringify(fragment), mine.includes(fragment) && canonical.includes(fragment), 'mine=' + JSON.stringify(mine) + ' canon=' + JSON.stringify(canonical));
  }
}

// 8. Anti-regresion estatica
check('anti-regresion: exportDocument llama a exportDocumentMarkdown', /exportDocumentMarkdown\(doc\)/.test(wsCode));
check('anti-regresion: exportDocumentMarkdown maneja chart', /type === 'chart'/.test(src));
check('anti-regresion: chart va despues de image-block y antes del fallback',
  src.indexOf("type === 'image-block'") < src.indexOf("type === 'chart'") && src.indexOf("type === 'chart'") < src.indexOf("md += (block.content || '')"),
  'idx image-block=' + src.indexOf("type === 'image-block'") + ' idx chart=' + src.indexOf("type === 'chart'"));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);