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
const drCode = readFileSync(new URL('../../workspace/core/design-report.js', import.meta.url), 'utf8');

const blocksToSectionsReal = new Function(grabFn(woCode, 'documentBlocksToSections').replace(/^export function/, 'function') + '\nreturn documentBlocksToSections;')();
const createReportSectionReal = new Function(grabFn(drCode, 'createReportSection') + '\nreturn createReportSection;')();
const helperSrc = grabFn(wsCode, 'documentBlocksToReportSections');
const helper = new Function('documentBlocksToSections', 'createReportSection', helperSrc + '\nreturn documentBlocksToReportSections;')(
  blocksToSectionsReal,
  createReportSectionReal,
);

const starFlowBlocks = [
  { type: 'heading1', content: 'Resumen Ejecutivo' },
  { content: 'Parrafo introductorio del informe.' },
  { type: 'bullet-list', content: 'Punto A' },
  { type: 'table', headers: ['Met', 'Valor'], rows: [['A', '1'], ['B', '2']] },
  { type: 'chart', content: 'Ventas', series: [{ label: 'Q1', value: 10 }, { label: 'Q2', value: 20 }] },
  { type: 'image-block', content: 'data:image/png;base64,AAA=', width: 200, height: 100 },
  { type: 'quote', content: 'Una cita' },
  { type: 'divider' },
];

console.log('=== CE-127: boton Informe del documento preserva la estructura (documentBlocksToReportSections) ===');
console.log('(documentBlocksToSections REAL de workflow-operations.js + createReportSection REAL de design-report.js, VM puro)');

// 1. Documento mixto Star-Flow -> secciones por tipo, ya NO una sola Text Section
{
  const sections = helper(starFlowBlocks);
  check('doc mixto genera 8 secciones (no 1 Text Section)', sections.length === 8, 'len=' + sections.length);
  check('ya NO es una unica seccion text con todo concatenado', !(sections.length === 1 && sections[0].type === 'text'));
  check('primer heading1 -> seccion title', sections[0].type === 'title' && sections[0].content === 'Resumen Ejecutivo', JSON.stringify({ t: sections[0].type, c: sections[0].content }));
  const types = sections.map(s => s.type);
  check('tipos incluyen title/text/table/chart/image/divider',
    ['title', 'text', 'table', 'chart', 'image', 'divider'].every(t => types.includes(t)), JSON.stringify(types));
  check('el texto del documento ya NO se aplanada en un solo bloque', types.filter(t => t === 'text').length >= 2);
}

// 2. Table conserva headers/rows reales (misma semantica que CE-033 en document.to-pdf)
{
  const s = helper(starFlowBlocks).find(x => x.type === 'table');
  check('tabla -> seccion table con data.headers', JSON.stringify(s.data.headers) === JSON.stringify(['Met', 'Valor']), JSON.stringify(s.data));
  check('tabla -> seccion table con data.rows', JSON.stringify(s.data.rows) === JSON.stringify([['A', '1'], ['B', '2']]), JSON.stringify(s.data));
}

// 3. Chart conserva las series
{
  const s = helper(starFlowBlocks).find(x => x.type === 'chart');
  check('chart -> seccion chart con content', s.content === 'Ventas', JSON.stringify(s));
  check('chart -> data.series conserva label/value', JSON.stringify(s.data.series) === JSON.stringify([{ label: 'Q1', value: 10 }, { label: 'Q2', value: 20 }]), JSON.stringify(s.data));
}

// 4. Imagen conserva dataUrl y dimensiones
{
  const s = helper(starFlowBlocks).find(x => x.type === 'image');
  check('image -> dataUrl de la imagen', s.dataUrl === 'data:image/png;base64,AAA=', JSON.stringify(s));
  check('image -> width/height del bloque', s.width === 200 && s.height === 100, JSON.stringify({ w: s.width, h: s.height }));
}

// 5. bullet-list/quote -> texto marcado (paridad documentBlocksToSections)
{
  const s = helper(starFlowBlocks);
  check('bullet-list -> text "• Punto A"', s.some(x => x.type === 'text' && x.content === '• Punto A'), JSON.stringify(s));
  check('quote -> text "> Una cita"', s.some(x => x.type === 'text' && x.content === '> Una cita'), JSON.stringify(s));
  check('divider -> seccion divider', s.some(x => x.type === 'divider'), JSON.stringify(s));
}

// 6. Cada seccion tiene el shape completo de design-report (id/style/assetId/data/dataUrl)
{
  const sections = helper(starFlowBlocks);
  const okShape = sections.every(x => typeof x.id === 'string' && x.id && typeof x.style === 'object' && x.style !== null && 'assetId' in x);
  check('todas las secciones tienen id/style/assetId (shape createReportSection)', okShape);
  check('tabla/chart/image usan data/dataUrl, no el texto aplanado',
    sections.find(x => x.type === 'table').data && sections.find(x => x.type === 'chart').data && sections.find(x => x.type === 'image').dataUrl);
}

// 7. heading2 -> subtitle; heading3 -> text; segundo heading1 -> subtitle
{
  const s = helper([
    { type: 'heading1', content: 'Titulo' },
    { type: 'heading2', content: 'Seccion 1' },
    { type: 'heading3', content: 'Detalle' },
  ]);
  check('heading2 -> subtitle', s[1].type === 'subtitle' && s[1].content === 'Seccion 1', JSON.stringify(s));
  check('heading3 -> text', s[2].type === 'text' && s[2].content === 'Detalle', JSON.stringify(s));
}

// 8. Documento vacio -> una seccion text vacia (fallback, no crash)
{
  const s = helper([]);
  check('doc vacio no crashea', Array.isArray(s) && s.length === 1 && s[0].type === 'text', JSON.stringify(s));
}

// 9. Documento solo-texto (caso antiguo) -> seccion text equivalente (sin romper el flujo anterior)
{
  const s = helper([{ content: 'Hola mundo' }]);
  check('doc solo-texto -> una seccion text con el contenido', s.length === 1 && s[0].type === 'text' && s[0].content === 'Hola mundo', JSON.stringify(s));
}

// 10. Anti-regresion estatica
check('anti-regresion: workflow-operations.js exporta documentBlocksToSections', /export function documentBlocksToSections/.test(woCode));
check('anti-regresion: workspace.js importa documentBlocksToSections', /import \{[^}]*documentBlocksToSections/.test(wsCode));
check('anti-regresion: helper usa documentBlocksToSections + createReportSection', /documentBlocksToSections\(/.test(helperSrc) && /createReportSection\(/.test(helperSrc));
{
  const uses = (wsCode.match(/documentBlocksToReportSections\(doc\.blocks/g) || []).length;
  check('anti-regresion: los 2 botones Informe usan el helper (2 call-sites)', uses === 2, 'uses=' + uses);
  check('anti-regresion: el flatten viejo de los botones Informe (docText) fuera', !/const docText =/.test(wsCode));
  check('anti-regresion: ya no hay createReportSection("text", docText)', !/createReportSection\('text', docText/.test(wsCode));
}

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);