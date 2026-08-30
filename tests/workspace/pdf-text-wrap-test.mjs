#!/usr/bin/env node
// CE-076: «informe → PDF» (document.to-pdf) desbordaba texto por dos vias:
// (a) `wrapText` NO partia tokens mas largos que la linea (URL, nombre largo)
//     -> un token de 130 chars en el titulo se dibujaba en UNA linea a 24 pt
//     (~1560 pt de ancho en una pagina de 595) saliendose por el borde derecho;
// (b) `estimateSectionH` reservaba altos FIJOS (title=36) o contaba lineas con
//     lineHeight 14 cuando el render usa fontSize*1.4 (16.8 pt para texto y
//     33.6 para titulos) -> una vez partido el token, el titulo/texto de varias
//     lineas se dibujaba mas alto de lo reservado, solapando la seccion
//     siguiente y cayendo en el margen inferior al final de pagina.
// El fix: `wrapText` corta tokens largos por charsPerLine (como `cellLines`) y
// `estimateSectionH` usa la altura real del render (size + (lines-1)*size*1.4)
// para todo texto/titulo/subtitulo/fecha/footer.
//
// Pure test (sin navegador): genera PDFs con generatePDF real y verifica en el
// stream que ninguna linea de texto excede el area de contenido, que el texto
// apila tras un titulo multilinea sin solaparse y que al final de pagina la
// ultima linea no cae por debajo del margen inferior.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdfSource = readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8')
  .replace(/^export\s+/gm, '');
const generatePDF = new Function(`${pdfSource}\nreturn generatePDF;`)();

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

const PAGE_W = 595, PAGE_H = 842, MTOP = 20 * 2.835, MBOTTOM = 20 * 2.835;
const CONTENT_X = MTOP;
const CONTENT_W = PAGE_W - 2 * MTOP;
const BOTTOM_EDGE = MBOTTOM;

function textOps(pdf, font, size) {
  return [...pdf.matchAll(/BT \/(\w+) (\d+) Tf (-?[\d.]+) (-?[\d.]+) Td \((.*?)\) Tj ET/g)]
    .filter(m => (font ? m[1] === font : true) && (size ? +m[2] === size : true))
    .map(m => ({ font: m[1], size: +m[2], x: +m[3], y: +m[4], len: m[5].length }));
}

console.log('=== Informe a PDF: texto y titulos dentro del area (CE-076) ===\n');

// ─── 1. Token largo (tipo URL) en parrafo de texto: se parte y no sale del borde ───
console.log('--- 1. URL/token largo en parrafo se parte dentro del area ---');
const url = 'https://ejemplo.com/recursos/archivo-muy-largo-sin-espacios-para-el-informe-final.pdf';
const urlPdf = generatePDF({
  format: 'A4', orientation: 'portrait', title: 'R',
  sections: [{ type: 'text', content: 'Resumen: ' + url + ' Adjunto.' }],
});
const textLines = textOps(urlPdf, 'F1', 12);
check('token partido en varias lineas (no 1)', textLines.length >= 3);
check('ninguna linea de texto excede el borde derecho del area', textLines.every(l => l.x + l.len * 12 * 0.5 <= CONTENT_X + CONTENT_W + 0.5));

// ─── 2. Titulo largo (130 chars, 4 lineas a 24 pt): dentro del area ───
console.log('--- 2. Titulo de 130 chars multilinea dentro del area ---');
const titlePdf = generatePDF({
  format: 'A4', orientation: 'portrait', title: 'R',
  sections: [
    { type: 'title', content: 'Z'.repeat(130) },
    { type: 'text', content: 'siguiente' },
  ],
});
const titleLines = textOps(titlePdf, 'F2', 24);
check('titulo partido en ~4 lineas', titleLines.length >= 3);
check('todas las lineas del titulo dentro del borde derecho', titleLines.every(l => l.x + l.len * 24 * 0.5 <= CONTENT_X + CONTENT_W + 0.5));
const followText = textOps(titlePdf, 'F1', 12).find(l => l.len === 9);
const lastTitle = titleLines[titleLines.length - 1];
check('el texto siguiente apila BAJO el titulo multilinea (sin solape)', followText && lastTitle && followText.y < lastTitle.y);

// ─── 3. Final de pagina: el texto de varias lineas no invade el margen inferior ───
console.log('--- 3. Parrafo que cierra una pagina no cae en el margen inferior ---');
const fillLines = 42; // 42 lineas a 12 pt llenan casi todo el usable (~598 pt)
const nearFull = Array.from({ length: fillLines }, (_, i) => 'P' + (i + 1) + ' '.repeat(60)).join(' ');
const para = Array.from({ length: 8 }, (_, i) => 'palabra-' + (i + 1)).join(' ');
const pagePdf = generatePDF({
  format: 'A4', orientation: 'portrait', title: 'R',
  sections: [
    { type: 'text', content: nearFull },
    { type: 'text', content: para },
  ],
});
const allText = textOps(pagePdf, 'F1', 12);
// Cada operacion Tj debe dibujarse por encima del borde inferior de la pagina
// (y > MBOTTOM en coordenadas PDF sin transform).
check('toda linea de texto esta por encima del margen inferior', allText.every(l => l.y >= BOTTOM_EDGE - 0.5));

// ─── 4. Anti-regresion estatica ───
console.log('--- 4. pdf-generator.js protege texto y estimacion ---');
check('wrapText parte tokens largos', pdfSource.includes('word.length > charsPerLine') && pdfSource.includes('rest.slice(0, charsPerLine)'));
check('estimacion de texto usa alto real del render', pdfSource.includes('estimateTextSectionH') && pdfSource.includes('size * 1.4'));
check('lineHeight fijo eliminado', !pdfSource.includes('const lineHeight = 14;'));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);