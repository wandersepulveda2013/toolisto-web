#!/usr/bin/env node
// CE-073: «informe → PDF» (document.to-pdf) distorsiona y desborda imagenes
// anchas. `normalizePdfImageSections` escribe width/height (px del canvas) en
// cada seccion de imagen; `renderImagePDF` recortaba el ancho a `contentW`
// pero conservaba el alto crudo: una captura 1600x900 se dibujaba como
// 481.6x900 (ratio 0.53 vs 1.78) y el cajon sobresalia por arriba de la pagina.
// El fix re-escala el alto proporcional cuando el ancho se recorta.
//
// Pure test (sin navegador): genera PDFs con generatePDF real (modulo puro) y
// verifica el ratio y el encaje de la caja dentro de la pagina.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdfSource = readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8')
  .replace(/^export\s+/gm, '');
const generatePDF = new Function(`${pdfSource}\nreturn generatePDF;`)();

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

// JPEG estructural suficiente para readJpegDimensions (SOF0 + dimensiones).
function jpegDataUrl(width, height) {
  const body = [
    0xFF, 0xD8,                       // SOI
    0xFF, 0xC0, 0x00, 0x11, 0x08,     // SOF0, len 17, precision 8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,                             // 3 componentes (DeviceRGB)
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9,                       // EOI
  ];
  return 'data:image/jpeg;base64,' + Buffer.from(body).toString('base64');
}

function extractCm(pdf) {
  const m = pdf.match(/q\s+([\d.]+)\s+0\s+0\s+([\d.]+)\s+([-.\d]+)\s+([-.\d]+)\s+cm\s+\/Im\d+\s+Do\s+Q/);
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
}

const ratio = (w, h) => w / h;
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('=== Informe a PDF: aspecto de imagen ancha conservado (CE-073) ===\n');

// ─── 1. Imagen ancha (1600x900) con width/height en px (como document.to-pdf) ───
console.log('--- 1. Escaneo/captura ancho no se deforma ni desborda ---');
const wide = extractCm(generatePDF({
  format: 'A4', orientation: 'portrait', title: 'Captura',
  sections: [{ type: 'image', dataUrl: jpegDataUrl(1600, 900), width: 1600, height: 900 }],
}));
check('ancho recortado a contentW (481.6 pt)', wide && near(wide.w, 481.6));
check('ratio dibujado == ratio fuente 1600/900 (~1.778)', wide && near(ratio(wide.w, wide.h), 1600 / 900, 0.02));
check('alto re-escalado ~270.9 pt (no 900 crudo)', wide && near(wide.h, 481.6 * 900 / 1600, 0.2));
check('caja dentro de la pagina (y >= 0)', wide && wide.y >= 0);

// ─── 2. Imagen estrecha (200x100) sin recorte: dimensiones pedidas se conservan ───
console.log('--- 2. Imagen mas estrecha que el area: sin deformacion ni agrandado ---');
const narrow = extractCm(generatePDF({
  format: 'A4', orientation: 'portrait', title: 'Logo',
  sections: [{ type: 'image', dataUrl: jpegDataUrl(200, 100), width: 200, height: 100 }],
}));
check('ancho sin recorte (200)', narrow && near(narrow.w, 200));
check('alto sin recorte (100)', narrow && near(narrow.h, 100));
check('ratio 2.0 conservado', narrow && near(ratio(narrow.w, narrow.h), 2));

// ─── 3. Sin width/height (fallback): aspecto derivado de la imagen ───
console.log('--- 3. Imagen sin width/height usa fallback proporcional ---');
const fallback = extractCm(generatePDF({
  format: 'A4', orientation: 'portrait', title: 'Sin tamano',
  sections: [{ type: 'image', dataUrl: jpegDataUrl(200, 100) }],
}));
check('se renderiza con fallback', !!fallback);
check('ratio de fallback conserva 2.0', fallback && near(ratio(fallback.w, fallback.h), 2, 0.02));

// ─── 4. Anti-regresion estatica ───
console.log('--- 4. pdf-generator.js protege el aspecto al recortar el ancho ---');
check('renderImagePDF re-escala alto cuando el ancho se recorta', pdfSource.includes('const scaled = fitImageDisplay(sectionW, sectionH, contentW, usableH)'));
check('fitImageDisplay preserva la proporcion y encaja dentro de la pagina', /function fitImageDisplay\(sectionW, sectionH, contentW, usableH\)[\s\S]*?let w = Math\.min\(contentW, sectionW\)[\s\S]*?let h = sectionH \* \(w \/ sectionW\)/.test(pdfSource));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);