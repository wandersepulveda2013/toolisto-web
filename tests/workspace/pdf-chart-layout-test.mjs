#!/usr/bin/env node
// CE-077: «informe → PDF» (document.to-pdf) reservaba para la seccion `chart`
// una altura O(n): `30 + n*18 + 40`. Con <= 5 series infra-reservaba (una sola
// serie reservaba 100 pt pero el render dibuja ~150: el texto siguiente se
// imprimia SOBRE la barra); con 20 series sobre-reservaba ~430 pt de hueco
// vacio, y con 80 (~1510 pt) empujaba el contenido posterior a otra pagina
// casi vacia (agravado por el recorte de CE-075). El render es de altura fija
// (titulo ~12 pt + chartH 100 + etiquetas) independiente del numero de series.
// El fix estima `30 + (tituloLines-1)*16.8 + 120` (150+b para un titulo corto):
// nunca infra-reserva (sin solape con lo siguiente) y ya no empuja huecos.
//
// Pure test (sin navegador): genera PDFs con generatePDF real y verifica que el
// texto siguiente quede debajo de las barras y que un grafico de 80 series mas
// contenido quepa en UNA pagina.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdfSource = readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8')
  .replace(/^export\s+/gm, '');
const generatePDF = new Function(`${pdfSource}\nreturn generatePDF;`)();

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

function textBaselines(pdf, font, size) {
  return [...pdf.matchAll(/BT \/(\w+) (\d+) Tf (-?[\d.]+) (-?[\d.]+) Td \((.*?)\) Tj ET/g)]
    .filter(m => m[1] === font && +m[2] === size)
    .map(m => +m[4]);
}

function barRects(pdf) {
  return [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)]
    .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }))
    .filter(r => r.w > 2 && r.h > 5);
}

function pageCount(pdf) {
  return (pdf.match(/\/Type \/Page\b/g) || []).length;
}

function doc(series) {
  return generatePDF({
    format: 'A4', orientation: 'portrait', title: 'R',
    sections: [
      { type: 'chart', data: { title: 'Ventas', series } },
      { type: 'text', content: 'Siguiente parrafo' },
    ],
  });
}

console.log('=== Informe a PDF: grafico con altura real, sin solape ni hueco (CE-077) ===\n');

// ─── 1. Chart de UNA serie + texto: antes la barra solapaba el parrafo ───
console.log('--- 1. Grafico de una serie: el texto siguiente queda bajo las barras ---');
const one = doc([{ label: 'A', value: 100 }]);
const oneBars = barRects(one);
const oneText = textBaselines(one, 'F1', 12);
const barTop = Math.max(...oneBars.map(b => b.y + b.h));
check('grafico dibujado (1 barra)', oneBars.length === 1);
check('texto siguiente BAJO la barra (sin solape)', oneText.length === 1 && oneText[0] < barTop - 4);

// ─── 2. Chart echo 20 series: sigue sin solape y sin hueco excesivo ───
console.log('--- 2. Grafico con 20 series: sin solape y en la misma pagina ---');
const many20 = doc(Array.from({ length: 20 }, (_, i) => ({ label: 'S' + i, value: i + 1 })));
const bars20 = barRects(many20);
const text20 = textBaselines(many20, 'F1', 12);
const top20 = Math.max(...bars20.map(b => b.y + b.h));
check('barras dentro de la pagina', bars20.every(b => b.x >= 0 && b.x + b.w <= 595 + 0.5 && b.y >= 0));
check('texto bajo las barras en 20 series', text20.length === 1 && text20[0] < top20 - 4);
check('chart + texto caben en UNA pagina', pageCount(many20) === 1);

// ─── 3. Chart de 80 series (recortado a maxFitBars): pagina bien aprovechada ───
console.log('--- 3. Grafico de 80 series no empuja el contenido a otra pagina ---');
const huge = doc(Array.from({ length: 80 }, (_, i) => ({ label: 'R' + i, value: i + 1 })));
const barsHuge = barRects(huge);
const textHuge = textBaselines(huge, 'F1', 12);
const topHuge = Math.max(...barsHuge.map(b => b.y + b.h));
check('barras recortadas dentro de la pagina', barsHuge.length > 0 && barsHuge.length < 80 && barsHuge.every(b => b.x >= 0 && b.x + b.w <= 595 + 0.5));
check('texto bajo las barras en 80 series', textHuge.length === 1 && textHuge[0] < topHuge - 4);
check('chart(80) + texto caben en UNA pagina (antes se creaba una pagina casi vacia)', pageCount(huge) === 1);

// ─── 4. Anti-regresion estatica ───
console.log('--- 4. pdf-generator.js estima el grafico con altura real ---');
check('estimacion de chart constante y >= render', pdfSource.includes('Math.max(150, 30 + (titleLines.length - 1) * 16.8 + 120)'));
check('estimacion antigua O(n) eliminada', !pdfSource.includes('30 + s.length * 18 + 40'));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);