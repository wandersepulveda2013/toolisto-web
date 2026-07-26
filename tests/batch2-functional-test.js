const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Batch 2 Functional Test ===\n');

if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));
const batch2 = tools.filter((t) => t.batch === 2);

pass(`${batch2.length} herramientas Batch 2 encontradas`);

for (const tool of batch2) {
  if (!tool.id) fail(`${tool.toolId}: id vacío`);
  else pass(`${tool.toolId}: id = ${tool.id}`);

  if (!tool.slug) fail(`${tool.toolId}: slug vacío`);
  else pass(`${tool.toolId}: slug = ${tool.slug}`);

  if (tool.status !== 'active') fail(`${tool.toolId}: status = ${tool.status} (esperado: active)`);
  else pass(`${tool.toolId}: status = active`);

  if (!tool.processor) fail(`${tool.toolId}: processor vacío`);
  else pass(`${tool.toolId}: processor = ${tool.processor}`);

  if (!tool.batch || tool.batch !== 2) fail(`${tool.toolId}: batch = ${tool.batch} (esperado: 2)`);
  else pass(`${tool.toolId}: batch = 2`);
}

const procPath = join(root, 'src', 'tool-processors.js');
if (existsSync(procPath)) {
  const procContent = readFileSync(procPath, 'utf8');
  for (const tool of batch2) {
    const hasProc = procContent.includes(`processors.${tool.processor}`) || procContent.includes(`processors['${tool.processor}']`);
    if (!hasProc) fail(`Procesador "${tool.processor}" no encontrado`);
    else pass(`${tool.toolId}: procesador declarado`);
  }
}

const distIndex = join(root, 'dist', 'index.html');
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');
  for (const tool of batch2) {
    if (!html.includes(`data-tool="${tool.toolId}"`)) {
      fail(`${tool.toolId}: sin tarjeta en portada`);
    } else {
      pass(`${tool.toolId}: tarjeta en portada`);
    }
    const pagePath = join(root, 'dist', 'tools', tool.slug, 'index.html');
    if (!existsSync(pagePath)) {
      fail(`${tool.toolId}: página generada faltante`);
    } else {
      pass(`${tool.toolId}: página generada existe`);
    }
  }
}

// ─── Pruebas de procesamiento real ─────────────────────────────────────
console.log('\n--- Pruebas de procesamiento rotatePdf ---\n');

async function runProcessorTests() {
  let processors;
  try {
    processors = require(join(root, 'src', 'tool-processors.js'));
  } catch (e) {
    fail('No se pudo cargar tool-processors.js: ' + e.message);
    return;
  }

  const { PDFDocument, degrees } = require('pdf-lib');
  const fixturePath = join(root, 'tests', 'fixtures', 'five-pages.pdf');
  if (!existsSync(fixturePath)) {
    fail('Fixture five-pages.pdf no existe — ejecuta: node tests/create-fixture.mjs');
    return;
  }
  const fixtureBytes = readFileSync(fixturePath);

  const angles = [90, 180, 270];
  for (const angle of angles) {
    console.log(`  rotatePdf (${angle}°):`);
    try {
      const result = await processors.rotatePdf(fixtureBytes, { degrees: angle });
      if (!result.data || result.data.length === 0) {
        fail(`rotatePdf ${angle}°: resultado vacío`);
        continue;
      }
      pass(`rotatePdf ${angle}°: ${result.data.length} bytes generados`);

      const outDoc = await PDFDocument.load(result.data);
      if (outDoc.getPageCount() !== 5) {
        fail(`rotatePdf ${angle}°: ${outDoc.getPageCount()} páginas (esperado 5)`);
        continue;
      }
      pass(`rotatePdf ${angle}°: conserva 5 páginas`);

      for (let i = 0; i < outDoc.getPageCount(); i++) {
        const rotation = outDoc.getPage(i).getRotation();
        const actualAngle = rotation.angle;
        if (actualAngle !== angle) {
          fail(`rotatePdf ${angle}°: página ${i + 1} tiene rotación ${actualAngle}° (esperado ${angle}°)`);
        } else {
          pass(`rotatePdf ${angle}°: página ${i + 1} rotación real = ${actualAngle}°`);
        }
      }

      if (!result.message.includes(String(angle))) {
        fail(`rotatePdf ${angle}°: mensaje no confirma grados: "${result.message}"`);
      } else {
        pass(`rotatePdf ${angle}°: mensaje = "${result.message}"`);
      }
    } catch (e) {
      fail(`rotatePdf ${angle}°: excepción: ${e.message}`);
    }
  }

  // Test validación: rotación inválida debe fallar
  console.log('\n  rotatePdf (rotación inválida):');
  try {
    await processors.rotatePdf(fixtureBytes, { degrees: 45 });
    fail('rotatePdf 45°: debería haber lanzado error');
  } catch (e) {
    pass(`rotatePdf 45°: rechazado correctamente — "${e.message}"`);
  }

  // Test re-apertura del resultado
  console.log('\n  rotatePdf (re-apertura):');
  try {
    const result = await processors.rotatePdf(fixtureBytes, { degrees: 90 });
    const reopened = await PDFDocument.load(result.data);
    if (reopened.getPageCount() === 0) {
      fail('rotatePdf: re-apertura produce 0 páginas');
    } else {
      pass(`rotatePdf: re-apertura exitosa (${reopened.getPageCount()} páginas)`);
    }
  } catch (e) {
    fail(`rotatePdf: re-apertura falló: ${e.message}`);
  }
}

runProcessorTests().then(() => {
  console.log(`\n=== Resultado Batch 2: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
  process.exit(failures > 0 ? 1 : 0);
}).catch((e) => {
  console.error(`Error fatal: ${e.message}`);
  process.exit(1);
});
