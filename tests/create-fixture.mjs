import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdflib/pdf-lib.min.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'fixtures', 'five-pages.pdf');

if (!existsSync(join(__dirname, 'fixtures'))) {
  const { mkdirSync } = await import('fs');
  mkdirSync(join(__dirname, 'fixtures'), { recursive: true });
}

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

for (let i = 1; i <= 5; i++) {
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText(`Page ${i}`, { x: 200, y: 700, size: 36, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(`This is page ${i} of 5 for testing purposes.`, { x: 120, y: 650, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(`Content area ${i}`, { x: 200, y: 400, size: 20, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawRectangle({ x: 50, y: 50, width: 495, height: 1, color: rgb(0.8, 0.8, 0.8) });
  page.drawText(`Footer page ${i}`, { x: 230, y: 30, size: 10, font, color: rgb(0.6, 0.6, 0.6) });
}

const bytes = await pdf.save();
writeFileSync(outPath, bytes);
console.log(`Fixture creado: ${outPath} (${bytes.length} bytes, 5 páginas)`);
