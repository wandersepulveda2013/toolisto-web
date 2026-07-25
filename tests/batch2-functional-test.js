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

console.log(`\n=== Resultado Batch 2: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
