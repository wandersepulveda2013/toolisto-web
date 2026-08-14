const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Embed PDF Test ===\n');

async function run() {
  let PDFDocument;
  try {
    PDFDocument = require('../vendor/pdflib/pdf-lib.min.js').PDFDocument;
    pass('pdf-lib cargado desde el vendor local');
  } catch (e) {
    fail(`No se pudo cargar pdf-lib: ${e.message}`);
    console.log(`\n=== Resultado: FALLO ===`);
    process.exit(1);
    return;
  }

  // Test: Create a PDF
  console.log('\n--- Crear PDF ---\n');
  try {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const bytes = await pdf.save();
    if (bytes.length === 0) fail('PDF creado tiene 0 bytes');
    else pass(`PDF creado: ${bytes.length} bytes`);
  } catch (e) { fail(`Crear PDF: ${e.message}`); }

  // Test: Load a PDF
  console.log('\n--- Cargar PDF ---\n');
  const fixturePath = join(root, 'tests', 'fixtures', 'five-pages.pdf');
  if (existsSync(fixturePath)) {
    try {
      const fixtureBytes = readFileSync(fixturePath);
      const doc = await PDFDocument.load(fixtureBytes);
      const pageCount = doc.getPageCount();
      if (pageCount === 0) fail('PDF cargado tiene 0 páginas');
      else pass(`PDF cargado: ${pageCount} páginas`);
      if (pageCount !== 5) fail(`Esperado 5 páginas, obtenido ${pageCount}`);
      else pass('Fixture tiene exactamente 5 páginas');
    } catch (e) { fail(`Cargar PDF: ${e.message}`); }

    // Test: Copy pages
    console.log('\n--- Copiar páginas ---\n');
    try {
      const fixtureBytes = readFileSync(fixturePath);
      const src = await PDFDocument.load(fixtureBytes);
      const dst = await PDFDocument.create();
      const copied = await dst.copyPages(src, src.getPageIndices());
      copied.forEach((p) => dst.addPage(p));
      const outBytes = await dst.save();
      const outDoc = await PDFDocument.load(outBytes);
      if (outDoc.getPageCount() !== 5) fail(`Copia tiene ${outDoc.getPageCount()} páginas (esperado 5)`);
      else pass('Copia tiene 5 páginas');
      if (outBytes.length === 0) fail('Copia tiene 0 bytes');
      else pass(`Copia tiene ${outBytes.length} bytes`);
    } catch (e) { fail(`Copiar páginas: ${e.message}`); }

    // Test: Embed font and draw text
    console.log('\n--- Embed font + draw text ---\n');
    try {
      const { StandardFonts, rgb } = require('../vendor/pdflib/pdf-lib.min.js');
      const fixtureBytes = readFileSync(fixturePath);
      const doc = await PDFDocument.load(fixtureBytes);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      for (const page of pages) {
        const { width, height } = page.getSize();
        page.drawText('Test', { x: 50, y: height - 50, size: 12, font, color: rgb(0, 0, 0) });
      }
      const outBytes = await doc.save();
      const outDoc = await PDFDocument.load(outBytes);
      if (outDoc.getPageCount() !== 5) fail(`Después de dibujar: ${outDoc.getPageCount()} páginas`);
      else pass('Después de dibujar texto: 5 páginas conservadas');
    } catch (e) { fail(`Embed font: ${e.message}`); }
  } else {
    fail(`Fixture no encontrado: ${fixturePath}`);
    console.log('Ejecuta: node tests/create-fixture.mjs');
  }

  // Test: Load and modify
  console.log('\n--- Cargar, modificar y re-guardar ---\n');
  try {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 400]);
    const firstBytes = await pdf.save();
    const doc = await PDFDocument.load(firstBytes);
    doc.addPage([300, 300]);
    const secondBytes = await doc.save();
    const final = await PDFDocument.load(secondBytes);
    if (final.getPageCount() !== 2) fail(`Esperado 2 páginas, obtenido ${final.getPageCount()}`);
    else pass('Round-trip: 2 páginas después de modificar');
  } catch (e) { fail(`Round-trip: ${e.message}`); }

  console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
