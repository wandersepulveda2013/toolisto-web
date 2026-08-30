#!/usr/bin/env node
// CE-075: «informe → PDF» (document.to-pdf) dibuja los graficos de barras fuera
// del area de contenido (e incluso fuera de la pagina) cuando la tabla tiene
// muchas filas (>= 16 series): el pitch fijo barW+4 empujaba la ultima barra a
// 566.7 pt con 16 series y a 606.3 pt (fuera de la pagina A4) con 20.
// El fix re-escala barW para encajar, y si ni con el ancho minimo (10) caben
// todas las series, recorta a lo que quepan y anade un marcador "+N".
//
// Pure test (sin navegador): genera PDFs con generatePDF real (modulo puro) y
// verifica que toda barra quede dentro de contentW y de la pagina, y que el
// marcador cuente correctamente las series ocultas.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdfSource = readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8')
  .replace(/^export\s+/gm, '');
const generatePDF = new Function(`${pdfSource}\nreturn generatePDF;`)();

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

const CONTENT_X = 56.7;
const CONTENT_W = 481.6;

function chartPDF(seriesCount) {
  const series = Array.from({ length: seriesCount }, (_, i) => ({
    label: 'R' + i,
    value: (i % 2 ? -1 : 1) * (i + 1),
  }));
  return generatePDF({
    format: 'A4', orientation: 'portrait', title: 'Informe',
    sections: [{ type: 'chart', data: { title: 'Ventas', series } }],
  });
}

// Rectangulos rellenos (`re f`) dentro del area de contenido: solo barras.
function chartBarRects(pdf) {
  return [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)]
    .map(m => ({ x: Number(m[1]), w: Number(m[3]) }))
    .filter(r => r.x >= CONTENT_X - 0.1 && r.w > 0);
}

// Ningun rectangulo (ni refill de pagina) escapa de la pagina A4.
function allRectsInPage(pdf) {
  return [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)]
    .every(m => Number(m[1]) >= 0 && Number(m[1]) + Number(m[3]) <= 595 + 0.5);
}

const markerCount = pdf => {
  const m = pdf.match(/\+(\d+)\s*\)?\s*Tj|Td\s\(([+]\d+)\)/);
  const text = m && (m[1] || m[2]);
  return text ? Number(text.replace(/[^\d]/g, '')) : 0;
};

console.log('=== Informe a PDF: barras de grafico siempre dentro del area (CE-075) ===\n');

// ─── 1. Series en rango normal: mismas barras, todo dentro ───
console.log('--- 1. Conteos normales (6) se mantienen dentro ---');
const normal = chartPDF(6);
const normalRects = chartBarRects(normal);
check('6 barras dibujadas', normalRects.length === 6);
check('borde derecho de la ultima barra dentro de contentW', normalRects.every(r => r.x + r.w <= CONTENT_X + CONTENT_W + 0.5));
check('ningun rect fuera de la pagina', allRectsInPage(normal));

// ─── 2. 16 series: el caso limite que antes desbordaba (566.7 pt) ───
console.log('--- 2. 16 series se re-escalan para caber ---');
const mid = chartPDF(16);
const midRects = chartBarRects(mid);
check('todas las 16 barras presentes (sin truncar)', midRects.length === 16);
check('borde derecho <= contentW', midRects.every(r => r.x + r.w <= CONTENT_X + CONTENT_W + 0.5));
check('ningun rect fuera de la pagina', allRectsInPage(mid));

// ─── 3. 20 series: antes fuera de la pagina (606.3 pt) ───
console.log('--- 3. 20 series caben dentro de contentW ---');
const twenty = chartPDF(20);
const twentyRects = chartBarRects(twenty);
check('todas las 20 barras presentes', twentyRects.length === 20);
check('borde derecho <= contentW', twentyRects.every(r => r.x + r.w <= CONTENT_X + CONTENT_W + 0.5));
check('ningun rect fuera de la pagina', allRectsInPage(twenty));

// ─── 4. Muchisimas series: recorta y avisa con "+N" ───
console.log('--- 4. 80 series: recorte informado con marcador ---');
const huge = chartPDF(80);
const hugeRects = chartBarRects(huge);
const hugeMark = markerCount(huge);
check('barras recortadas (no 80)', hugeRects.length < 80);
check('barras dentro de contentW', hugeRects.every(r => r.x + r.w <= CONTENT_X + CONTENT_W + 0.5));
check('ningun rect fuera de la pagina', allRectsInPage(huge));
check('marcador "+N" presente y cuenta las ocultas', hugeMark === 80 - hugeRects.length, `(+${hugeMark} vs 80-${hugeRects.length})`);

// ─── 5. Anti-regresion estatica ───
console.log('--- 5. pdf-generator.js encaja la ultima barra ---');
check('renderChartPDF re-escala o recorta cuando desborda', pdfSource.includes('tooMany') && pdfSource.includes('maxFitBars'));
check('marcador +N presente en el codigo', pdfSource.includes("'+' + hiddenCount"));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);