import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^(?:export )?function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) {
      let src = lines.slice(i, j + 1).join('\n');
      src = src.replace(/^export\s+/m, '');
      return src;
    }
  }
  throw new Error('sin final para ' + name);
}

const opsCode = readFileSync(new URL('../../workspace/core/workflow-operations.js', import.meta.url), 'utf8');
const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');

const textSrc = grabFn(opsCode, 'htmlFragmentToText');
const textFn = new Function('return (' + textSrc + ');')();
const splitSrc = grabFn(opsCode, 'splitHtmlAtPageBreak');
const splitFn = new Function('htmlFragmentToText', 'return (' + splitSrc + ');')(textFn);
const secSrc = grabFn(opsCode, 'documentBlocksToSections');
const secFn = new Function('splitHtmlAtPageBreak', 'htmlFragmentToText', 'return (' + secSrc + ');')(splitFn, textFn);

console.log('=== CE-136: un bloque con salto de pagina no pierde su texto ===');
console.log('(splitHtmlAtPageBreak / htmlFragmentToText / documentBlocksToSections REALES de workflow-operations.js)');
console.log('');

console.log('--- 1. splitHtmlAtPageBreak (helper puro) ---');

const parts1 = splitFn('<p>Primera parte</p><div data-page-break="true"></div><p>Segunda parte</p>');
check('split: devuelve 3 segmentos', parts1.length === 3);
check('split: el primero es texto con el contenido anterior', parts1[0].type === 'text' && /Primera parte/.test(parts1[0].html));
check('split: el del medio es page-break sin html', parts1[1].type === 'page-break' && parts1[1].html === '');
check('split: el ultimo es texto con el contenido posterior', parts1[2].type === 'text' && /Segunda parte/.test(parts1[2].html));
check('split: orden texto -> break -> texto', parts1[0].type === 'text' && parts1[1].type === 'page-break' && parts1[2].type === 'text');

const partsOnly = splitFn('<div data-page-break="true"></div>');
check('split: solo marcador -> 1 segmento page-break', partsOnly.length === 1 && partsOnly[0].type === 'page-break');

const partsPlain = splitFn('<p>Sin saltos</p>');
check('split: sin marcador -> 1 segmento de texto intacto', partsPlain.length === 1 && partsPlain[0].type === 'text' && /Sin saltos/.test(partsPlain[0].html));

const partsMulti = splitFn('<p>A</p><div data-page-break="true"></div><p>B</p><div   data-page-break="true"    ></div><p>C</p>');
check('split: multiples marcadores con espacios irregulares', partsMulti.length === 5 && partsMulti[1].type === 'page-break' && partsMulti[3].type === 'page-break');

const partsNone = splitFn(undefined);
check('split: html undefined -> sin segmentos', partsNone.length === 0);

const partsSpace = splitFn('  <p> x </p>  ');
check('split: recorta espacios externos', partsSpace.length === 1 && /x/.test(partsSpace[0].html));

console.log('');
console.log('--- 2. htmlFragmentToText (helper puro) ---');

check('texto: elimina etiquetas y colapsa espacios', textFn('<p>Hola&nbsp;<b>mundo</b></p>') === 'Hola mundo');
check('texto: decodifica entidades', textFn('<p>a &lt; b &amp; c &gt; d &quot;e&quot;</p>') === 'a < b & c > d "e"');
check('texto: vacio devuelve cadena vacia', textFn('') === '');
check('texto: null devuelve cadena vacia', textFn(null) === '');

console.log('');
console.log('--- 3. documentBlocksToSections: bloque mezclado NO pierde texto ---');

const mixed = [{ type: 'paragraph', content: 'Primera parteSegunda parte', html: '<p>Primera parte</p><div data-page-break="true"></div><p>Segunda parte</p>' }];
const secMixed = secFn(mixed);
check('sections: bloque mixto genera 3 secciones', secMixed.length === 3);
check('sections: seccion 1 es texto "Primera parte"', secMixed[0].type === 'text' && secMixed[0].content === 'Primera parte');
check('sections: seccion 2 es page-break', secMixed[1].type === 'page-break');
check('sections: seccion 3 es texto "Segunda parte"', secMixed[2].type === 'text' && secMixed[2].content === 'Segunda parte');
check('sections: el texto posterior ya no se descarta (bug principal)', secMixed.some(s => s.type === 'text' && /Segunda parte/.test(s.content)));

const mixedMid = [{ type: 'paragraph', content: 'AB', html: '<p>A</p><div data-page-break="true"></div><p>B</p>' }];
const secMid = secFn(mixedMid);
check('sections: marcador en medio conserva A y B', secMid.length === 3 && secMid[0].content === 'A' && secMid[2].content === 'B');

const mixedEnd = [{ type: 'paragraph', content: 'Solo antes', html: '<p>Solo antes</p><div data-page-break="true"></div><p></p>' }];
const secEnd = secFn(mixedEnd);
check('sections: marcador al final conserva el texto previo', secEnd.length === 2 && secEnd[0].content === 'Solo antes' && secEnd[1].type === 'page-break');

console.log('');
console.log('--- 4. Regresion: el marcador unico sigue siendo page-break ---');

const onlyMarker = secFn([{ type: 'paragraph', html: '<div data-page-break="true"></div>' }]);
check('regresion: bloque solo-marcador -> 1 seccion page-break', onlyMarker.length === 1 && onlyMarker[0].type === 'page-break');
check('regresion: block.type page-break explicito se preserva', secFn([{ type: 'page-break', content: '' }])[0].type === 'page-break');

const normal = secFn([{ type: 'paragraph', content: 'Texto normal' }]);
check('regresion: parrafo sin marcador inalterado', normal.length === 1 && normal[0].type === 'text' && normal[0].content === 'Texto normal');

console.log('');
console.log('--- 5. exportDocumentMarkdown (workspace.js) usa el split ---');

const mdSrc = wsCode.slice(wsCode.indexOf('function exportDocumentMarkdown'), wsCode.indexOf('function exportDocument('));
check('md: importa splitHtmlAtPageBreak desde core', /import \{[\s\S]*?splitHtmlAtPageBreak[\s\S]*?htmlFragmentToText[\s\S]*?\} from '\.\/core\/workflow-operations\.js'/.test(wsCode));
check('md: recorre los segmentos del bloque mezclado', /for \(const seg of splitHtmlAtPageBreak\(block\.html\)\)/.test(mdSrc));
check('md: emite el divisor como page-break-after', /if \(seg\.type === 'page-break'\) md \+= '<div style="page-break-after:always"><\/div>\\n\\n'/.test(mdSrc));
check('md: emite el texto previo/posterior', /htmlFragmentToText\(seg\.html\)[\s\S]*?md \+= text \+ '\\n\\n'/.test(mdSrc));
check('md: el bloque mixto no retorna sin texto', /if \(text\) md \+= text \+ '\\n\\n'/.test(mdSrc));

console.log('');
console.log('--- 6. blocksToMarkdown (text.export) conserva el salto ---');

const btSrc = opsCode.slice(opsCode.indexOf('function blocksToMarkdown'), opsCode.indexOf('function blocksToPlainText'));
check('txt: interpeta el marcador antes del switch', /if \(block\.html && \/data-page-break="true"\/\.test\(block\.html\)\)[\s\S]*?for \(const seg of splitHtmlAtPageBreak\(block\.html\)\)/.test(btSrc));
check('txt: emite salto como linea vacia y texto como parrafo', /if \(seg\.type === 'page-break'\) lines\.push\(''\);[\s\S]*?if \(t\) lines\.push\(t\)/.test(btSrc));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);