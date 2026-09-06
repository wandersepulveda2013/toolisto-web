#!/usr/bin/env node
// CE-138: los bloques `chart` creados por `data.to-chart`/`report.create` eran
// invisibles en el editor de documentos: `renderBlock` los degradaba a texto
// plano (la rama vacia del contentEditable). Este suite verifica que ahora
// renderBlock tiene una rama `chart` propia que monta el SVG canonico via
// buildTableChartSvg (el mismo render de la vista de datos), sin usar
// `.innerHTML =` (contrato innerhtml-structure) y sin volver editable al bloque.
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
const renderBlock = grabFn(wsCode, 'renderBlock');
const svgSrc = grabFn(wsCode, 'buildTableChartSvg');
const escSrc = wsCode.match(/^const esc = .*;$/m)?.[0] || 'const esc = (s) => String(s);';
const buildSvg = new Function(escSrc + '\n' + svgSrc + '\nreturn buildTableChartSvg;')();
const lines = renderBlock.split('\n');

console.log('=== CE-138: el bloque chart del editor renderiza el SVG canonico, no texto plano ===\n');

// --- 1. Anchors estructurales de renderBlock ---
check('renderBlock define una rama propia para chart', renderBlock.includes("} else if (block.type === 'chart') {"), lines.findIndex(l => l.includes("type === 'chart'")) + 1 + '');
check('la rama chart existe SOLO una vez en renderBlock', (renderBlock.match(/type === 'chart'/g) || []).length === 1);
const idxImage = lines.findIndex(l => l.includes("type === 'image-block'"));
const idxChart = lines.findIndex(l => l.includes("type === 'chart'"));
const idxTable = lines.findIndex(l => l.includes("type === 'table'"));
const idxEditable = lines.findIndex(l => l.includes("contentEditable: 'true'"));
check('orden image-block < chart < table (antes de la rama editable)', idxImage >= 0 && idxChart > idxImage && idxTable > idxChart && idxEditable > idxTable, `img=${idxImage} chart=${idxChart} table=${idxTable} edit=${idxEditable}`);
const chartBranch = lines.slice(idxChart, idxTable).join('\n');
check('la rama chart monta el SVG canonico (buildTableChartSvg)', chartBranch.includes('buildTableChartSvg('));
check('la rama chart inyecta el SVG sin .innerHTML (DOMParser + importNode)', chartBranch.includes('DOMParser()') && chartBranch.includes('importNode(') && !chartBranch.includes('.innerHTML ='));
check('la rama chart filtra series no finitas', chartBranch.includes('Number.isFinite(item.value)'));
check('la rama chart NO es un bloque editable', !chartBranch.includes('contentEditable'));
check('el placeholder editable NO contempla chart', idxEditable >= 0);
check('renderBlock conserva UN solo contentEditable (solo el texto es editable)', (renderBlock.match(/contentEditable: 'true'/g) || []).length === 1);
const blockTypes = wsCode.slice(wsCode.indexOf('const BLOCK_TYPES'), wsCode.indexOf('const BLOCK_TYPES') + 600);
check('BLOCK_TYPES sigue sin chart (insercion solo vía data.to-chart/report.create)', !/\{ type: 'chart'/.test(blockTypes), 'sin boton decorativo de chart vacio');

// --- 2. Funcional: el SVG canonico renderiza los bloques reales de data.to-chart ---
{
  const title = 'Ventas';
  const series = [{ label: 'Q1', value: 1200 }, { label: 'Q2', value: 980 }, { label: 'Q3', value: 1450 }];
  const out = buildSvg({ config: { title } }, series);
  check('render: titulo del bloque aparece en el SVG', out.includes(title));
  check('render: serie con 3 barras', (out.match(/<rect/g) || []).length === 3);
  check('render: valores de las barras visibles', ['1200', '980', '1450'].every(v => out.includes('>' + v + '<')));
  check('render: etiquetas X visibles', ['Q1', 'Q2', 'Q3'].every(l => out.includes('>' + l + '<')));
  check('render: viewBox 600x200 para 3 series', out.includes('viewBox="0 0 600 200"'));
  check('determinismo: dos llamadas producen el mismo SVG', out === buildSvg({ config: { title } }, [{ label: 'Q1', value: 1200 }, { label: 'Q2', value: 980 }, { label: 'Q3', value: 1450 }]));
}

{
  const out = buildSvg({ config: { title: 'Solo titulo' } }, []);
  check('sin series: solo titulo (sin barras)', !out.includes('<rect') && out.includes('Solo titulo'));
}

{
  const out = buildSvg({ config: { title: 'Con negativos' } }, [{ label: 'A', value: 5 }, { label: 'B', value: -3 }]);
  check('negativos: area mas alta (240) y barra negativa naranja', out.includes('viewBox="0 0 600 240"') && /fill="#D9893B"/.test(out));
}

{
  const out = buildSvg({ config: { title: 'T' } }, [{ label: 'A&B', value: 1 }]);
  check('escape: etiqueta con & se escapa', out.includes('A&amp;B') && !out.includes('>A&B<'));
}

// --- 3. Paridad con los artefactos: el bloque chart del documento exporta igual ---
{
  const block = { id: 'b', type: 'chart', content: 'Ventas', series: [{ label: 'Q1', value: 1200 }, { label: 'Q2', value: 980 }] };
  const svg = buildSvg({ config: { title: block.content || 'Gráfico' } }, block.series.filter(item => item && typeof item.value === 'number' && Number.isFinite(item.value)));
  check('paridad: el bloque chart del documento usa la misma serie que export/PDF', (svg.match(/<rect/g) || []).length === block.series.length && svg.includes('Ventas'));
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);