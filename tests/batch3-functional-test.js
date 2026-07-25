const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Batch 3 Functional Test ===\n');

if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));
const batch3 = tools.filter((t) => t.batch === 3);

pass(`${batch3.length} herramientas Batch 3 encontradas`);

const expectedBatch3 = ['splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf'];
for (const toolId of expectedBatch3) {
  const tool = batch3.find((t) => t.toolId === toolId);
  if (!tool) { fail(`Batch 3: herramienta "${toolId}" no encontrada`); continue; }
  pass(`${toolId} existe en tools.json`);

  if (!tool.id) fail(`${toolId}: id vacío`);
  else pass(`${toolId}: id = ${tool.id}`);

  if (!tool.slug) fail(`${toolId}: slug vacío`);
  else pass(`${toolId}: slug = ${tool.slug}`);

  if (tool.status !== 'active') fail(`${toolId}: status = ${tool.status} (esperado: active)`);
  else pass(`${toolId}: status = active`);

  if (!tool.processor) fail(`${toolId}: processor vacío`);
  else pass(`${toolId}: processor = ${tool.processor}`);

  if (tool.batch !== 3) fail(`${toolId}: batch = ${tool.batch} (esperado: 3)`);
  else pass(`${toolId}: batch = 3`);

  const distIndex = join(root, 'dist', 'index.html');
  if (existsSync(distIndex)) {
    const html = readFileSync(distIndex, 'utf8');
    if (!html.includes(`data-tool="${tool.toolId}"`)) fail(`${toolId}: sin tarjeta en portada`);
    else pass(`${toolId}: tarjeta en portada`);
  }

  const pagePath = join(root, 'dist', 'tools', tool.slug, 'index.html');
  if (!existsSync(pagePath)) fail(`${toolId}: página generada faltante`);
  else pass(`${toolId}: página generada existe`);
}

// Test PDF processors with fixture
console.log('\n--- Pruebas de procesamiento PDF ---\n');

async function runProcessorTests() {
  let processors;
  try {
    processors = require(join(root, 'src', 'tool-processors.js'));
  } catch (e) {
    fail('No se pudo cargar tool-processors.js: ' + e.message);
    return;
  }

  const fixturePath = join(root, 'tests', 'fixtures', 'five-pages.pdf');
  if (!existsSync(fixturePath)) {
    fail('Fixture five-pages.pdf no existe — ejecuta: node tests/create-fixture.mjs');
    return;
  }

  const fixtureBytes = readFileSync(fixturePath);
  const { PDFDocument } = require('pdf-lib');
  const fixtureDoc = await PDFDocument.load(fixtureBytes);
  const inputPageCount = fixtureDoc.getPageCount();

  if (inputPageCount !== 5) {
    fail(`Fixture tiene ${inputPageCount} páginas, esperado 5`);
    return;
  }
  pass(`Fixture tiene 5 páginas`);

  // Test splitDoublePdf
  console.log('\n  splitDoublePdf:');
  try {
    const result = await processors.splitDoublePdf(fixtureBytes, { direction: 'vertical' });
    if (!result.data || result.data.length === 0) { fail('splitDoublePdf: resultado vacío'); }
    else pass(`splitDoublePdf: ${result.data.length} bytes generados`);

    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages === 0) { fail('splitDoublePdf: 0 páginas en resultado'); }
    else pass(`splitDoublePdf: ${outPages} páginas en resultado`);

    if (outPages < 5) { fail(`splitDoublePdf: menos páginas que entrada (${outPages} < 5)`); }
    else pass(`splitDoublePdf: ${outPages} páginas >= 5`);

    if (!result.message || /\b0\s+páginas\b/.test(result.message)) {
      fail(`splitDoublePdf: mensaje indica 0 páginas: "${result.message}"`);
    } else {
      pass(`splitDoublePdf: mensaje = "${result.message}"`);
    }
  } catch (e) { fail(`splitDoublePdf: excepción: ${e.message}`); }

  // Test splitDoublePdf horizontal
  console.log('\n  splitDoublePdf (horizontal):');
  try {
    const result = await processors.splitDoublePdf(fixtureBytes, { direction: 'horizontal' });
    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages === 0) { fail('splitDoublePdf horizontal: 0 páginas'); }
    else pass(`splitDoublePdf horizontal: ${outPages} páginas`);
  } catch (e) { fail(`splitDoublePdf horizontal: excepción: ${e.message}`); }

  // Test bookletPdf
  console.log('\n  bookletPdf:');
  try {
    const result = await processors.bookletPdf(fixtureBytes);
    if (!result.data || result.data.length === 0) { fail('bookletPdf: resultado vacío'); }
    else pass(`bookletPdf: ${result.data.length} bytes generados`);

    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages === 0) { fail('bookletPdf: 0 páginas en resultado'); }
    else pass(`bookletPdf: ${outPages} páginas en resultado`);

    if (outPages < 5) { fail(`bookletPdf: menos páginas que entrada (${outPages} < 5)`); }
    else pass(`bookletPdf: ${outPages} páginas >= 5`);

    if (outPages % 4 !== 0) { fail(`bookletPdf: páginas no son múltiplo de 4 (${outPages})`); }
    else pass(`bookletPdf: ${outPages} páginas = múltiplo de 4`);

    if (!result.message || result.message.includes('0 pliegos')) {
      fail(`bookletPdf: mensaje incorrecto: "${result.message}"`);
    } else {
      pass(`bookletPdf: mensaje = "${result.message}"`);
    }
  } catch (e) { fail(`bookletPdf: excepción: ${e.message}`); }

  // Test watermarkPdf
  console.log('\n  watermarkPdf:');
  try {
    const result = await processors.watermarkPdf(fixtureBytes, { text: 'BORRADOR', opacity: 0.3 });
    if (!result.data || result.data.length === 0) { fail('watermarkPdf: resultado vacío'); }
    else pass(`watermarkPdf: ${result.data.length} bytes generados`);

    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages !== 5) { fail(`watermarkPdf: ${outPages} páginas (esperado 5)`); }
    else pass(`watermarkPdf: conserva 5 páginas`);

    if (!result.message || /\b0\s+páginas\b/.test(result.message)) {
      fail(`watermarkPdf: mensaje indica 0 páginas: "${result.message}"`);
    } else {
      pass(`watermarkPdf: mensaje = "${result.message}"`);
    }
  } catch (e) { fail(`watermarkPdf: excepción: ${e.message}`); }

  // Test addPageNumbersPdf (normal)
  console.log('\n  addPageNumbersPdf (normal):');
  try {
    const result = await processors.addPageNumbersPdf(fixtureBytes, { style: 'normal' });
    if (!result.data || result.data.length === 0) { fail('addPageNumbersPdf normal: resultado vacío'); }
    else pass(`addPageNumbersPdf normal: ${result.data.length} bytes generados`);

    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages !== 5) { fail(`addPageNumbersPdf normal: ${outPages} páginas (esperado 5)`); }
    else pass(`addPageNumbersPdf normal: conserva 5 páginas`);

    if (!result.message || /\b0\s+páginas\b/.test(result.message)) {
      fail(`addPageNumbersPdf normal: mensaje indica 0 páginas: "${result.message}"`);
    } else {
      pass(`addPageNumbersPdf normal: mensaje = "${result.message}"`);
    }

    if (!result.message.includes('normal')) {
      fail(`addPageNumbersPdf normal: mensaje no menciona estilo normal: "${result.message}"`);
    } else {
      pass(`addPageNumbersPdf normal: mensaje describe estilo correctamente`);
    }
  } catch (e) { fail(`addPageNumbersPdf normal: excepción: ${e.message}`); }

  // Test addPageNumbersPdf (roman)
  console.log('\n  addPageNumbersPdf (romano):');
  try {
    const result = await processors.addPageNumbersPdf(fixtureBytes, { style: 'roman' });
    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages !== 5) { fail(`addPageNumbersPdf roman: ${outPages} páginas (esperado 5)`); }
    else pass(`addPageNumbersPdf roman: conserva 5 páginas`);

    if (!result.message.includes('romana')) {
      fail(`addPageNumbersPdf roman: mensaje no confirma romano: "${result.message}"`);
    } else {
      pass(`addPageNumbersPdf roman: mensaje confirma estilo romano`);
    }
  } catch (e) { fail(`addPageNumbersPdf roman: excepción: ${e.message}`); }

  // Test addHeaderFooterPdf
  console.log('\n  addHeaderFooterPdf (ambos):');
  try {
    const result = await processors.addHeaderFooterPdf(fixtureBytes, { header: 'Documento Confidencial', footer: 'Toolisto', showHeader: true, showFooter: true });
    if (!result.data || result.data.length === 0) { fail('addHeaderFooterPdf ambos: resultado vacío'); }
    else pass(`addHeaderFooterPdf ambos: ${result.data.length} bytes generados`);

    const outDoc = await PDFDocument.load(result.data);
    const outPages = outDoc.getPageCount();
    if (outPages !== 5) { fail(`addHeaderFooterPdf ambos: ${outPages} páginas (esperado 5)`); }
    else pass(`addHeaderFooterPdf ambos: conserva 5 páginas`);

    if (!result.message.includes('encabezado') && !result.message.includes('pie')) {
      fail(`addHeaderFooterPdf ambos: mensaje no describe elementos: "${result.message}"`);
    } else {
      pass(`addHeaderFooterPdf ambos: mensaje = "${result.message}"`);
    }
  } catch (e) { fail(`addHeaderFooterPdf ambos: excepción: ${e.message}`); }

  // Test addHeaderFooterPdf (solo encabezado)
  console.log('\n  addHeaderFooterPdf (solo encabezado):');
  try {
    const result = await processors.addHeaderFooterPdf(fixtureBytes, { header: 'Solo Encabezado', footer: '', showHeader: true, showFooter: false });
    const outDoc = await PDFDocument.load(result.data);
    if (outDoc.getPageCount() !== 5) { fail(`addHeaderFooterPdf header: ${outDoc.getPageCount()} páginas`); }
    else pass(`addHeaderFooterPdf header: conserva 5 páginas`);

    if (!result.message.includes('encabezado')) {
      fail(`addHeaderFooterPdf header: mensaje no confirma encabezado: "${result.message}"`);
    } else {
      pass(`addHeaderFooterPdf header: mensaje confirma encabezado añadido`);
    }
  } catch (e) { fail(`addHeaderFooterPdf header: excepción: ${e.message}`); }

  // Verify all results can be re-opened
  console.log('\n--- Verificación de re-apertura ---\n');
  const allResults = [];
  try { allResults.push({ name: 'splitDoublePdf', data: (await processors.splitDoublePdf(fixtureBytes)).data }); } catch (_) {}
  try { allResults.push({ name: 'bookletPdf', data: (await processors.bookletPdf(fixtureBytes)).data }); } catch (_) {}
  try { allResults.push({ name: 'watermarkPdf', data: (await processors.watermarkPdf(fixtureBytes)).data }); } catch (_) {}
  try { allResults.push({ name: 'addPageNumbersPdf', data: (await processors.addPageNumbersPdf(fixtureBytes)).data }); } catch (_) {}
  try { allResults.push({ name: 'addHeaderFooterPdf', data: (await processors.addHeaderFooterPdf(fixtureBytes)).data }); } catch (_) {}

  for (const r of allResults) {
    try {
      const doc = await PDFDocument.load(r.data);
      if (doc.getPageCount() === 0) fail(`${r.name}: re-apertura produce 0 páginas`);
      else pass(`${r.name}: re-apertura exitosa (${doc.getPageCount()} páginas)`);
    } catch (e) {
      fail(`${r.name}: no se puede re-abrir: ${e.message}`);
    }
  }
}

runProcessorTests().then(() => {
  console.log(`\n=== Resultado Batch 3: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
  process.exit(failures > 0 ? 1 : 0);
}).catch((e) => {
  console.error(`Error fatal: ${e.message}`);
  process.exit(1);
});
