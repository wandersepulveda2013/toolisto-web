const { strict: assert } = require('assert');
const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Batch 1 Functional Test ===\n');

if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));
const batch1 = tools.filter((t) => t.batch === 1);

pass(`${batch1.length} herramientas Batch 1 encontradas`);

const expectedBatch1 = ['compress', 'crop', 'convert', 'signature', 'mergePdf', 'imagesPdf'];
for (const toolId of expectedBatch1) {
  const tool = batch1.find((t) => t.toolId === toolId);
  if (!tool) { fail(`Batch 1: herramienta "${toolId}" no encontrada`); continue; }
  pass(`${toolId} existe`);

  if (!tool.id) fail(`${toolId}: id vacío`);
  else pass(`${toolId}: id = ${tool.id}`);

  if (!tool.toolId) fail(`${toolId}: toolId vacío`);
  else pass(`${toolId}: toolId = ${tool.toolId}`);

  if (!tool.processor) fail(`${toolId}: processor vacío`);
  else pass(`${toolId}: processor = ${tool.processor}`);

  if (!tool.slug) fail(`${toolId}: slug vacío`);
  else pass(`${toolId}: slug = ${tool.slug}`);

  if (tool.status !== 'active') fail(`${toolId}: status = ${tool.status} (esperado: active)`);
  else pass(`${toolId}: status = active`);

  if (!tool.icon) fail(`${toolId}: icon vacío`);
  else pass(`${toolId}: icon = ${tool.icon}`);

  if (!tool.title) fail(`${toolId}: title vacío`);
  else pass(`${toolId}: title = ${tool.title}`);

  if (!tool.description) fail(`${toolId}: description vacío`);
  else pass(`${toolId}: description presente`);

  if (!tool.category) fail(`${toolId}: category vacío`);
  else pass(`${toolId}: category = ${tool.category}`);
}

const procPath = join(root, 'src', 'tool-processors.js');
if (existsSync(procPath)) {
  const procContent = readFileSync(procPath, 'utf8');
  for (const tool of batch1) {
    const hasProc = procContent.includes(`processors.${tool.processor}`) || procContent.includes(`processors['${tool.processor}']`);
    if (!hasProc) fail(`Procesador "${tool.processor}" no encontrado`);
    else pass(`${tool.toolId}: procesador declarado`);
  }
} else {
  fail('src/tool-processors.js no existe');
}

const distIndex = join(root, 'dist', 'index.html');
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');
  for (const tool of batch1) {
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
} else {
  fail('dist/index.html no existe — ejecuta npm run build');
}

console.log(`\n=== Resultado Batch 1: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
