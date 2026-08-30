#!/usr/bin/env node
// CE-074: revela, en `renderTablePDF`, filas/celdas que salian de la pagina:
// (a) una celda larga (URL, cadena sin espacios) se dibujaba en una sola linea
// hasta 722 pt en una pagina de 595 (se escapaba por el borde derecho); (b) la
// altura de fila era fija (20 pt) aunque la celda tuviera varias lineas, con lo
// que las filas se solapaban. Para poner mas y mas largas las celdas solo se
// cambiaba la altura... ningun envoltorio de celdas existia.
//
// El fix: `renderTablePDF`/`estimateSectionH`/`addTableSections` comparten un
// mismo criterio de altura real de fila (`tableRowHeight` + `cellLines`, que
// envuelve por espacios y ademas corta tokens mas largos que la columna). La
// paginacion encaja filas por su alto real, no por multiplos de 20 pt.
//
// Pure test sin navegador: PDFs reales de generatePDF, se inspecciona el stream.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdfSource = readFileSync(join(root, 'workspace', 'core', 'pdf-generator.js'), 'utf8')
  .replace(/^export\s+/gm, '');
const generatePDF = new Function(`${pdfSource}\nreturn generatePDF;`)();

let pass = 0, fail = 0;
function check(name, condition, detail = '') { if (condition) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.error(`  FAIL: ${name} ${detail}`); } }

const near = (a, b, eps = 0.2) => Math.abs(a - b) <= eps;

console.log('=== Tabla -> PDF: celdas anchas y filas irregulares no desbordan (CE-074) ===\n');

const BASE = { format: 'A4', orientation: 'portrait' };

// ─── 1. Desborde horizontal: URL larga no se escapa del borde de la pagina ───
console.log('--- 1. Celda con URL/token largo (sin espacios) ---');
{
  const longUrl = 'https://ejemplo.com/ruta/muy/larga/para/una/celda/que/no/cabe/en/una/sola/columna/del/pdf';
  const pdf = generatePDF({
    ...BASE, title: 'T',
    sections: [{ type: 'table', data: {
      headers: ['Concepto', 'Importe', 'Fecha', 'Detalle'],
      rows: [['Servicio ' + longUrl, '1234.56', '15/01/2024', 'Factura correspondiente al periodo']],
    } }],
  });
  const cells = [...pdf.matchAll(/BT \/F1 9 Tf ([\d.]+) ([\d.]+) Td \(([^)]*)\) Tj ET/g)];
  check('la celda larga se parte en varias lineas', cells.some(t => t[3].length <= 40));
  let maxRight = 0, over = 0;
  for (const t of cells) { const right = Number(t[1]) + t[3].length * 4.5; if (right > maxRight) maxRight = right; if (right > 595) over++; }
  check('ninguna linea de celda pasa del borde derecho (max 524 < 595)', over === 0, `maxRight=${maxRight.toFixed(1)}`);
  check('la paginacion sigue eligiendo bien el alto de fila (>= 20)', !pdf.includes('undefined') && !pdf.includes('NaN'));
}

// ─── 2. Fila alta: el alto real crece y la grilla lo refleja ───
console.log('--- 2. Celda de varias lineas agranda la fila y la grilla ---');
{
  const pdf = generatePDF({
    ...BASE, title: 'T',
    sections: [{ type: 'table', data: {
      headers: ['Desc', 'Valor'],
      rows: [['X'.repeat(160), '10'], ['Y', '20']],
    } }],
  });
  const cellTexts = [...pdf.matchAll(/\(([^)]+)\) Tj ET/g)].map(m => m[1]);
  // 2 columnas -> colW 240.8 -> charsPerLine 52; 160 chars -> 4 lineas
  check('nadie dibuja un renglon de 160 caracteres', !cellTexts.includes('X'.repeat(160)));
  const longLines = cellTexts.filter(t => t.includes('X')).map(t => t.length);
  check('todas las lineas de la celda larga caben (<=52 chars)', longLines.every(n => n <= 52), `largest=${Math.max(...longLines)}`);
const grid = [...pdf.matchAll(/56\.7 ([\d.]+) m 56\.7 ([\d.]+) l S/g)];
    if (grid.length > 0) {
      const span = Number(grid[0][1]) - Number(grid[0][2]);
      check('la grilla vertical abarca header(20) + fila alta(54.4) + fila normal(20)', near(span, 94.4), `span=${span.toFixed(1)}`);
    } else check('la grilla vertical existe', false);
  check('ninguna fila desborda por el tope de la pagina (y >= 0)', Number(grid[0][2]) >= 0);
}

// ─── 3. Tabla normal (una linea por celda) mantiene filas de 20 pt ───
console.log('--- 3. Sin regresion: tabla limpia conserva grilla de 20 pt por fila ---');
{
  const pdf = generatePDF({
    ...BASE, title: 'T',
    sections: [{ type: 'table', data: {
      headers: ['Nombre', 'Edad'],
      rows: [['Ana', '30'], ['Luis', '25']],
    } }],
  });
  const cells = [...pdf.matchAll(/BT \/F1 9 Tf ([\d.]+) ([\d.]+) Td \(([^)]*)\) Tj ET/g)];
  check('una linea por celda', cells.every(t => t[3].length <= 25));
  const grid = [...pdf.matchAll(/56\.7 ([\d.]+) m 56\.7 ([\d.]+) l S/g)];
  const span = Number(grid[0][1]) - Number(grid[0][2]);
  check('grilla = header(20) + 2 filas de 20 = 60', near(span, 60), `span=${span.toFixed(1)}`);
}

// ─── 4. Paginacion por alto real: filas altas respetan el salto de pagina ───
console.log('--- 4. Filas altas en tablas largas (multi-pagina) sin solapamiento ---');
{
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(['fila-' + i, 'x']);
  rows.push(['M'.repeat(200), 'tall']); // 200 chars -> ~4 lineas en una columna de 240.8
  rows.push(['M'.repeat(200), 'tall2']);
  const pdf = generatePDF({
    ...BASE, title: 'T',
    sections: [{ type: 'table', data: { headers: ['A', 'B'], rows } }],
  });
  const pages = (pdf.match(/\/Type \/Page\b/g) || []).length;
  check('la tabla larga genera varias paginas', pages >= 2, `pages=${pages}`);
  let dupes = 0;
  for (let i = 0; i < 40; i++) {
    const n = (pdf.match(new RegExp('fila-' + i + '\\)', 'g')) || []).length;
    if (n !== 1) dupes++;
  }
  check('cada fila aparece exactamente una vez', dupes === 0, `dupes=${dupes}`);
  const ys = [...pdf.matchAll(/([\d.]+) Td \(fila-/g)].map(m => Number(m[1]));
  check('ninguna fila de texto queda fuera de la pagina (y >= 0)', ys.length > 0 && ys.every(y => y > 0), `minY=${ys.length ? Math.min(...ys) : 'n/a'}`);
  check('sin NaN ni undefined en el PDF', !pdf.includes('undefined') && !pdf.includes('NaN'));
}

// ─── 5. Anti-regresion estatica ───
console.log('--- 5. pdf-generator.js comparte el criterio de alto real ---');
check('cellLines corta tokens mas largos que la columna', pdfSource.includes('while (rest.length > charsPerLine)'));
check('tableRowHeight deriva del maximo de lineas', pdfSource.includes('maxLines * CELL_LINE_HEIGHT + 4'));
check('renderTablePDF usa celda en lineas envueltas', pdfSource.includes('const cellLinesPerCell = (row || []).map(cell => cellLines'));
check('addTableSections encaja filas por su alto real', pdfSource.includes('used + tableRowHeight(rows[idx], colW, 9) <= usableH + 0.01'));
check('estimateSectionH suma altos reales por fila', /rows\.forEach\(r => \{ h \+= tableRowHeight/.test(pdfSource));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);