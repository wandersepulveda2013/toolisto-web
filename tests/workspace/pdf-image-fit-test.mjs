#!/usr/bin/env node
// CE-078: «informe → PDF» (document.to-pdf) no limitaba la ALTURA de las
// imagenes: `renderImagePDF` acotaba solo el ancho (`displayW = min(contentW,
// sectionW)`) y usaba el alto crudo re-escalado por ancho. Si el ancho pedido
// ya cabia (una captura estrecha, o sectionW <= contentW), una imagen muy alta
// se dibujaba SIN limite superior: el rect quedaba por debajo del margen
// inferior de la pagina (se recortaba visualmente) y la estimacion que re-
// escalaba solo cuando `sectionW > contentW` no coincidia con el render
// (paginas casi vacias o imagenes truncadas). El fix introduce
// `fitImageDisplay(sectionW, sectionH, contentW, usableH)`, compartido por
// `estimateSectionH` y `renderImagePDF` (via `context.usableH`), que encaja la
// imagen dentro del area usable conservando la proporcion (primero por ancho,
// luego por alto).
//
// Pure test (sin navegador, sin atob): inyecta un JPEG minimo (1x1, dimensions
// 0x1/1x1) y un viewer de graficos que parsea los `cm` de las imagenes. Dobla
// la funcion global guardandola y restaurandola tras el test para no ensuciar.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdfSource = readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8').replace(/^export\s+/gm, '');

const MINI_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]).toString('base64');

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

const A4 = { w: 595, h: 842 };           // dimensões base A4 portrait
const mTop = 20 * 2.835, mBottom = 20 * 2.835, mLeft = 20 * 2.835, mRight = 20 * 2.835;
const usableH = A4.h - mTop - mBottom;    // 728.6
const contentW = A4.w - mLeft - mRight;   // 481.6

function imageCm(render) {
  const s = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im\d+ Do Q/.exec(render);
  if (!s) return null;
  return { w: +s[1], h: +s[2], left: +s[3], bottom: +s[4] };
}

function doc(width, height) {
  return generatePDF({
    format: 'A4', orientation: 'portrait', title: 'R',
    sections: [{ type: 'image', dataUrl: 'data:image/jpeg;base64,' + MINI_JPEG, width, height }],
  });
}

console.log('=== Informe a PDF: imagenes encajadas en la pagina (CE-078) ===\n');

const generatePDF = new Function(`${pdfSource}\nreturn generatePDF;`)();
global.generatePDF = generatePDF;// ─── 1. Imagen estrecha y alta (400x5000): se encaja por ALTO, no se excede ───
console.log('--- 1. Imagen estrecha y muy alta: encajada por alto dentro de la pagina ---');
{
  const im = imageCm(doc(400, 5000));
  check('imagen dibujada', !!im);
  check('alto <= usableH (era 5000*1.22 hacia abajo, fuera de pagina)', im && im.h <= usableH + 0.01);
  check('base inferior dentro del margen (no recortada)', im && im.bottom >= mBottom - 0.01);
  check('proporcion conservada (w/h = 0.08)', im && Math.abs(im.w / im.h - 400 / 5000) < 0.01);
}

// ─── 2. Imagen mas ancha que el contenido: encajada por ANCHO ───
console.log('--- 2. Imagen ancha (3000x800): reducida al ancho del contenido ---');
{
  const im = imageCm(doc(3000, 800));
  check('ancho <= contentW', im && im.w <= contentW + 0.01);
  check('proporcion conservada (w/h = 3.75)', im && Math.abs(im.w / im.h - 3000 / 800) < 0.01);
}

// ─── 3. Imagen muy alta (768x6000): tambien encajada por alto ───
console.log('--- 3. Imagen alta: no excede el alto usable ---');
{
  const im = imageCm(doc(768, 6000));
  check('alto <= usableH', im && im.h <= usableH + 0.01);
  check('base dentro del margen inferior', im && im.bottom >= mBottom - 0.01);
}

// ─── 4. Imagen que ya cabe: conserva tamano (solo se limita el ancho) ───
console.log('--- 4. Imagen que cabe sin escalar: no se agranda ---');
{
  const im = imageCm(doc(560, 315));
  check('ancho min(contentW, 560) = 481.6 (se recorta el ancho sobrante)', im && Math.abs(im.w - contentW) < 0.01);
  check('alto proporcional 270.9', im && Math.abs(im.h - 270.9) < 0.5);
  check('no se agrando el alto (h < 315)', im && im.h < 315);
}

// ─── 5. Anti-regresion estatica ───
console.log('--- 5. pdf-generator.js encaja imagenes de forma compartida ---');
check('fitImageDisplay presente en el modulo', pdfSource.includes('function fitImageDisplay'));
check('render usa fitImageDisplay', pdfSource.includes('const scaled = fitImageDisplay(sectionW, sectionH, contentW, usableH)'));
check('estimacion de imagen usa fitImageDisplay', pdfSource.includes('const fit = fitImageDisplay(sectionW, sectionH, contentW, usableH)'));
check('contexto pasa usableH al render', pdfSource.includes('usableH,') && pdfSource.includes('usableH'));
check('estimacion antigua de un solo eje eliminada', !pdfSource.includes('sectionW > contentW'));
if (global.generatePDF) delete global.generatePDF;

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);