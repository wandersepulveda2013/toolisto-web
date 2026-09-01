#!/usr/bin/env node
// CE-087: la vista previa del builder de diseno (WYSIWYG) debe paginar igual
// que el PDF exportado. Antes `estimateSectionHeight` (design-report.js) usaba
// alturas fijas por seccion (tabla = filas*24+30, imagen = section.height|150),
// mientras el generador real (pdf-generator.js) calcula altura variable por
// contenido (celdas envueltas, imagenes re-escaladas, texto multi-linea). El
// resultado: el usuario disenaba un informe esperando WYSIWYG pero el PDF
// refluia de pagina distinto (cortaba tablas, movia secciones).
//
// Fix (CE-087): `design-report.js` reutiliza LA MISMA funcion compartida
// `estimateSectionH` de `pdf-generator.js` (extraida a top-level y exportada)
// para decidir la paginacion de la preview, con conversion de unidades
// (preview px <-> pt del PDF, 1mm = 2.835 pt).
//
// Pure test (sin navegador): carga ambos modulos reales por `new Function`
// (stripping import/export) y verifica que la paginacion de la preview
// coincide bit a bit con una paginacion independiente en pt basada en el
// estimador compartido, y que design-report reutiliza estimateSectionH.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (s) =>
  s
    .replace(/import\s+[^;]*?\s+from\s+['"][^'"]+['"];?/gs, '')
    .replace(/import\s+['"][^'"]+['"];?/gs, '')
    .replace(/export\s+(default\s+)?\{[\s\S]*?\};?/gs, '')
    .replace(/\bexport\s+(default\s+)?/g, '');

const pdfSource = strip(readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8'));
const loadPDF = new Function(`${pdfSource}\nreturn { estimateSectionH, fitImageDisplay, tableColWidth, tableRowHeight, generatePDF };`)();
const { estimateSectionH, generatePDF } = loadPDF;

const designRaw = readFileSync(join(root, 'workspace', 'core', 'design-report.js'), 'utf8');
const designSource = strip(designRaw);
// pdf-generator.js se concatena ANTES de design-report.js (sin su import) para
// que `estimateSectionH` resuelva en el mismo scope, igual que en el navegador.
const { renderReportPreview, estimateSectionHeight } = new Function(
  `${pdfSource}\n${designSource}\nreturn { renderReportPreview, estimateSectionHeight };`
)();

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

const PT_PER_MM = 2.835;
const scale = 2;

// Una seccion de texto multilinea + tabla con celdas que se envuelven + imagen
// ancha + grafico: los casos donde la progresia cruda divergia del render real.
const CONFIG = {
  format: 'A4', orientation: 'portrait', title: 'Informe',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  sections: [
    { type: 'title', content: 'Informe de ventas 2026' },
    { type: 'text', content: 'Resumen '.repeat(20) },
    {
      type: 'table',
      data: {
        headers: ['Concepto', 'Descripcion'],
        rows: [
          ['Item A', 'Una celda muy larga que se tiene que envolver en varias lineas porque supera ampliamente el ancho util de la pagina'],
          ['B', '20'],
          ['C', '30'],
        ],
      },
    },
    { type: 'image', width: 3000, height: 800, dataUrl: null },
    { type: 'chart', data: { title: 'Trimestre', series: [{ label: 'A', value: 1 }] } },
    { type: 'footer', content: 'Pie de pagina' },
  ],
};

console.log('=== Builder de diseno: la preview pagina igual que el PDF (CE-087) ===\n');

const pos = designRaw.indexOf('estimateSectionH');
check('design-report reutiliza el estimador compartido del PDF',
  pos > 0 && designRaw.includes("from './pdf-generator.js'"),
  'debe importar estimateSectionH de pdf-generator.js');

const pmm = { width: 210, height: 297 };
const pageWpx = pmm.width * scale, pageHpx = pmm.height * scale;
const m = CONFIG.margins;
const contentWpx = pageWpx - (m.left + m.right) * scale;
const contentHpx = pageHpx - (m.top + m.bottom) * scale;
const contentWpt = (contentWpx / scale) * PT_PER_MM;
const contentHpt = (contentHpx / scale) * PT_PER_MM;

// Paginacion independiente en pt (fuente de verdad = estimador compartido).
function referencePagination(sections) {
  const pages = [[]];
  let curPt = 0;
  for (const section of sections) {
    if (section.type === 'page-break') { pages.push([]); curPt = 0; continue; }
    const hPt = estimateSectionH(section, contentWpt, contentHpt);
    if (curPt + hPt > contentHpt && pages[pages.length - 1].length > 0) { pages.push([]); curPt = 0; }
    pages[pages.length - 1].push({ type: section.type, yPt: curPt });
    curPt += hPt;
  }
  return pages;
}

const ref = referencePagination(CONFIG.sections);
const preview = renderReportPreview(CONFIG);

check('preview genera el MISMO numero de paginas que la referencia en pt',
  preview.pages.length === ref.length,
  `preview=${preview.pages.length} ref=${ref.length}`);

ref.forEach((refPage, pi) => {
  const prevPage = preview.pages[pi];
  if (!prevPage) return;
  check(`pagina ${pi + 1}: misma cantidad de secciones`, prevPage.length === refPage.length,
    `preview=${prevPage.length} ref=${refPage.length}`);
  refPage.forEach((rs, si) => {
    const ps = prevPage[si];
    if (!ps) return;
    const expectedYPx = (rs.yPt / PT_PER_MM) * scale;
    check(`pagina ${pi + 1}, seccion ${si} (${rs.type}): y identico en px`,
      ps.section.type === rs.type && Math.abs(ps.y - expectedYPx) < 1e-4,
      `preview.y=${Number(ps && ps.y).toFixed(4)} esperado=${expectedYPx.toFixed(4)}`);
  });
});

// estimateSectionHeight (design-report) delega en el estimador compartido.
[CONFIG.sections[0], CONFIG.sections[2], CONFIG.sections[3], CONFIG.sections[4]].forEach(section => {
  const expectedPx = (estimateSectionH({
    ...section,
    data: section.data ? JSON.parse(JSON.stringify(section.data)) : undefined,
  }, contentWpt, contentWpt / 1.4) / PT_PER_MM) * scale;
  const got = estimateSectionHeight(section, contentWpx);
  check(`estimateSectionHeight delegada coincide para seccion ${section.type}`,
    Math.abs(got - expectedPx) < 1e-4,
    `got=${Number(got).toFixed(4)} esperado=${expectedPx.toFixed(4)}`);
});

// Contra el generador real: el numero de paginas del PDF tambien coincide.
const pdfHtml = generatePDF(CONFIG);
const pdfPages = (pdfHtml.match(/\/Type \/Page\b/g) || []).length;
check('preview y PDF exportado generan la misma cantidad de paginas',
  preview.pages.length === pdfPages,
  `preview=${preview.pages.length} pdf=${pdfPages}`);

console.log(`\nResultados: ${pass} PASS, ${fail} FAIL, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);