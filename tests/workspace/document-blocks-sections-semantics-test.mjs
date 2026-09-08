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

const woCode = readFileSync(new URL('../../workspace/core/workflow-operations.js', import.meta.url), 'utf8');
const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const pdfCode = readFileSync(new URL('../../workspace/core/pdf-generator.js', import.meta.url), 'utf8');

const splitSrc = grabFn(woCode, 'splitHtmlAtPageBreak').replace(/^export function/, 'function');
const textSrc = grabFn(woCode, 'htmlFragmentToText').replace(/^export function/, 'function');
const sectionsReal = new Function(splitSrc + '\n' + textSrc + '\n' + grabFn(woCode, 'documentBlocksToSections').replace(/^export function/, 'function') + '\nreturn documentBlocksToSections;')();
const fenceSrc = grabFn(woCode, 'fence');
const fenceEndSrc = grabFn(woCode, 'fenceEnd');
const btmReal = new Function(splitSrc + '\n' + textSrc + '\n' + fenceSrc + '\n' + fenceEndSrc + '\n' + grabFn(woCode, 'blocksToMarkdown') + '\nreturn blocksToMarkdown;')();
const ptReal = new Function(grabFn(woCode, 'blocksToPlainText') + '\nreturn blocksToPlainText;')();
const mdReal = new Function(splitSrc + '\n' + textSrc + '\n' + grabFn(wsCode, 'exportDocumentMarkdown') + '\nreturn exportDocumentMarkdown;')();
const wrapSrc = grabFn(pdfCode, 'wrapText');
const codeLinesReal = new Function(wrapSrc + '\n' + grabFn(pdfCode, 'codeLinesForWidth') + '\nreturn codeLinesForWidth;')();

const secSrc = grabFn(woCode, 'documentBlocksToSections');
const btmBody = grabFn(woCode, 'blocksToMarkdown');
const ptBody = grabFn(woCode, 'blocksToPlainText');
const mdSrc = grabFn(wsCode, 'exportDocumentMarkdown');

console.log('=== CE-143: degradacion de documento -> informe/PDF -------------');
console.log('');
console.log('--- 1. documentBlocksToSections: numbered-list secuencial ---');

{
  const s = sectionsReal([{ type: 'numbered-list', content: 'Primer paso' }]);
  check('item unico -> text "1. Primer paso"', s.length === 1 && s[0].type === 'text' && s[0].content === '1. Primer paso', JSON.stringify(s));
}
{
  const s = sectionsReal([
    { type: 'numbered-list', content: 'Planear' },
    { type: 'numbered-list', content: 'Ejecutar' },
    { type: 'numbered-list', content: 'Revisar' },
  ]);
  const contents = s.map(x => x.content);
  check('secuencia 3 items -> 1./2./3.', s.length === 3 && JSON.stringify(contents) === JSON.stringify(['1. Planear', '2. Ejecutar', '3. Revisar']), JSON.stringify(contents));
}
{
  const s = sectionsReal([
    { type: 'numbered-list', content: 'Uno' },
    { content: 'Parrafo de por medio' },
    { type: 'numbered-list', content: 'Dos de la segunda lista' },
  ]);
  check('reset tras parrafo -> nueva lista reinicia en 1', JSON.stringify(s.map(x => x.content)) === JSON.stringify(['1. Uno', 'Parrafo de por medio', '1. Dos de la segunda lista']), JSON.stringify(s));
}
{
  const s = sectionsReal([
    { type: 'numbered-list', content: 'Uno' },
    { type: 'bullet-list', content: 'Vinetas no rompen' },
    { type: 'numbered-list', content: 'Segunda lista' },
  ]);
  check('reset tras bullet-list -> nueva lista reinicia en 1', JSON.stringify(s.map(x => x.content)) === JSON.stringify(['1. Uno', '• Vinetas no rompen', '1. Segunda lista']), JSON.stringify(s));
}

console.log('');
console.log('--- 2. documentBlocksToSections: code NO degrada a texto plano ---');

{
  const s = sectionsReal([{ type: 'code', content: 'const x = 1;\nconst y = 2;' }]);
  check('code -> seccion {type:"code"}', s.length === 1 && s[0].type === 'code', JSON.stringify(s));
  check('code conserva el contenido multilinea', s[0].content === 'const x = 1;\nconst y = 2;', JSON.stringify(s[0]));
  check('code ya NO es una seccion text (anti-regresion)', s[0].type !== 'text');
}
{
  const s = sectionsReal([{ type: 'callout', content: 'Aviso importante' }, { type: 'quote', content: 'Una cita' }]);
  check('callout -> text "> Nota: Aviso importante"', s[0].type === 'text' && s[0].content === '> Nota: Aviso importante', JSON.stringify(s));
  check('quote intacta -> text "> Una cita"', s[1].type === 'text' && s[1].content === '> Una cita', JSON.stringify(s));
}

console.log('');
console.log('--- 3. blocksToMarkdown (text.export): paridad para los 3 tipos ---');

{
  const m = btmReal([
    { type: 'numbered-list', content: 'A' },
    { type: 'numbered-list', content: 'B' },
    { type: 'numbered-list', content: 'C' },
  ]);
  const lines = m.trim().split('\n');
  check('listas numeradas -> 1. A / 2. B / 3. C', JSON.stringify(lines) === JSON.stringify(['1. A', '2. B', '3. C']), JSON.stringify(lines));
}
{
  const m = btmReal([{ type: 'numbered-list', content: 'Unico' }]);
  check('item unico -> "1. Unico" (paridad con informe)', m.trim() === '1. Unico', JSON.stringify(m));
}
{
  const m = btmReal([{ type: 'code', content: 'const a = 1;', lang: 'js' }]);
  check('code -> fence con lang', m.trim() === '```js\nconst a = 1;\n```', JSON.stringify(m));
}
{
  const m = btmReal([{ type: 'code', content: 'x' }, { type: 'widget', content: 'texto libre' }, { type: 'quote', content: 'cita' }]);
  check('code sin lang -> fence sin lang', m.includes('```\nx\n```'), JSON.stringify(m));
  check('widget cae al fallback de contenido (regresion)', m.includes('texto libre'), JSON.stringify(m));
  check('quote intacta', m.includes('> cita'), JSON.stringify(m));
}
{
  const m = btmReal([{ type: 'callout', content: 'Aviso' }]);
  check('callout -> "> **Nota:** Aviso" (paridad exportDocumentMarkdown)', m.trim() === '> **Nota:** Aviso', JSON.stringify(m));
}

console.log('');
console.log('--- 4. blocksToPlainText (text.export): paridad para los 3 tipos ---');

{
  const m = ptReal([
    { type: 'numbered-list', content: 'S1' },
    { type: 'numbered-list', content: 'S2' },
  ]);
  const lines = m.trim().split('\n');
  check('listas numeradas -> S1: "1. S1" / "2. S2"', JSON.stringify(lines) === JSON.stringify(['1. S1', '2. S2']), JSON.stringify(lines));
}
{
  const m = ptReal([{ type: 'numbered-list', content: 'X' }, { content: 'p' }, { type: 'numbered-list', content: 'Y' }]);
  check('reset tras parrafo -> "1. Y"', m.includes('1. Y'), JSON.stringify(m));
}
{
  const m = ptReal([{ type: 'code', content: 'a\nb' }, { type: 'callout', content: 'Aviso' }]);
  check('code conserva contenido multilinea', m.includes('a\nb'), JSON.stringify(m));
  check('callout -> "Nota: Aviso"', m.includes('Nota: Aviso'), JSON.stringify(m));
}

console.log('');
console.log('--- 5. exportDocumentMarkdown (toolbar): secuencia + tipos intactos ---');

{
  const m = mdReal({ title: 'Doc', blocks: [
    { type: 'numbered-list', content: 'A' },
    { type: 'numbered-list', content: 'B' },
    { type: 'bullet-list', content: 'C' },
  ] });
  check('secuencia -> "1. A" y "2. B"', m.includes('1. A') && m.includes('2. B'), JSON.stringify(m));
  check('bullet posterior no rompe la secuencia previa', m.includes('- C'), JSON.stringify(m));
}
{
  const m = mdReal({ title: 'Doc', blocks: [{ type: 'numbered-list', content: 'Unico' }] });
  check('item unico -> "1. Unico" (compat CE-111)', m.includes('1. Unico'), JSON.stringify(m));
}
{
  const m = mdReal({ title: 'Doc', blocks: [{ type: 'callout', content: 'Aviso' }, { type: 'code', content: 'x = 1' }] });
  check('callout intacto "> **Nota:** Aviso" (regresion)', m.includes('> **Nota:** Aviso'), JSON.stringify(m));
  check('code intacto con fence (regresion)', m.includes('```') && m.includes('x = 1'), JSON.stringify(m));
}

console.log('');
console.log('--- 6. pdf-generator.js: estimacion y render de la seccion code ---');

{
  check('renderSectionPDF tiene case "code"', /\s+case 'code': renderCodeLines\(parts, section\.content \|\| ''/.test(pdfCode));
  check('estimateSectionH maneja section.type === "code"', /if \(section\.type === 'code'\)/.test(pdfCode));
  check('helper codeLinesForWidth definido', /function codeLinesForWidth\(/.test(pdfCode));
  check('helper renderCodeLines definido', /function renderCodeLines\(/.test(pdfCode));
}
{
  const lines = codeLinesReal('a\n\nb', 500, 9.5);
  check('codeLinesForWidth conserva lineas vacias', JSON.stringify(lines) === JSON.stringify(['a', '', 'b']), JSON.stringify(lines));
  const wrapped = codeLinesReal('palabra extremadamente larga para envolver', 40, 9.5);
  check('codeLinesForWidth envuelve lineas largas', wrapped.length >= 2, JSON.stringify(wrapped));
  check('codeLinesForWidth no colapsa los saltos en una sola linea', codeLinesReal('1\n2', 500, 9.5).length === 2);
}

console.log('');
console.log('--- 7. Anti-regresion estatica ---');

check('sections: numbered-list usa contador secuencial', /sections\.push\(\{ type: 'text', content: olSeq \+ '\. ' \+ content \}\)/.test(secSrc));
check('sections: code se emite como seccion code (no text)', /sections\.push\(\{ type: 'code', content \}\)/.test(secSrc));
check('btm: numbered-list usa contador secuencial', /lines\.push\(olSeq \+ '\. ' \+ content\)/.test(btmBody));
check('btm: code usa fence/fenceEnd', /lines\.push\(fence\(block\.lang \|\| '', content\)\)/.test(btmBody) && /lines\.push\(fenceEnd\(block\.lang \|\| ''\)\)/.test(btmBody));
check('pt: callout marcado con "Nota: "', /lines\.push\('Nota: ' \+ content\)/.test(ptBody));
check('md: exportDocumentMarkdown reinicia el contador', /block\.type !== 'numbered-list'\) olSeq = 0/.test(mdSrc));
check('preview: renderiza la seccion code con fuente mono', /section\.type === 'code'/.test(wsCode));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);