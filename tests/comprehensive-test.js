const { readFileSync, existsSync, readdirSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Comprehensive Test ===\n');

// 1. tools.json structure
console.log('--- Estructura tools.json ---\n');
if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
let tools;
try {
  tools = JSON.parse(readFileSync(toolsPath, 'utf8'));
  pass('tools.json es JSON válido');
} catch (e) { fail(`tools.json no es JSON válido: ${e.message}`); process.exit(1); }

if (!Array.isArray(tools)) { fail('tools.json no es un array'); process.exit(1); }
pass(`tools.json contiene ${tools.length} herramientas`);

// 2. No empty IDs
const emptyIds = tools.filter((t) => !t.id || !t.id.trim());
if (emptyIds.length > 0) fail(`${emptyIds.length} IDs vacíos`);
else pass('Cero IDs vacíos');

const emptyToolIds = tools.filter((t) => !t.toolId || !t.toolId.trim());
if (emptyToolIds.length > 0) fail(`${emptyToolIds.length} toolIds vacíos`);
else pass('Cero toolIds vacíos');

// 3. No duplicate slugs, IDs, toolIds
function checkUnique(arr, label) {
  const counts = {};
  arr.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const dupes = Object.entries(counts).filter(([, c]) => c > 1);
  if (dupes.length > 0) { fail(`${label} duplicados: ${dupes.map(([v, c]) => `${v} (${c}x)`).join(', ')}`); return false; }
  pass(`${label}: todos únicos`);
  return true;
}

checkUnique(tools.map((t) => t.id), 'IDs');
checkUnique(tools.map((t) => t.toolId), 'ToolIds');
checkUnique(tools.map((t) => t.slug), 'Slugs');

// 4. Status distribution
const active = tools.filter((t) => t.status === 'active');
const blocked = tools.filter((t) => t.status === 'blocked');
const testing = tools.filter((t) => t.status === 'testing');
pass(`Activas: ${active.length}, Bloqueadas: ${blocked.length}, En prueba: ${testing.length}`);

// 5. Processors exist for all active tools
console.log('\n--- Procesadores ---\n');
const procPath = join(root, 'src', 'tool-processors.js');
if (existsSync(procPath)) {
  const procContent = readFileSync(procPath, 'utf8');
  let missing = 0;
  for (const tool of active) {
    const name = tool.processor || tool.toolId;
    const found = procContent.includes(`processors.${name}`) || procContent.includes(`processors['${name}']`);
    if (!found) { fail(`Procesador "${name}" no encontrado`); missing++; }
  }
  if (missing === 0) pass(`Todos los ${active.length} procesadores activos existen`);
} else {
  fail('src/tool-processors.js no existe');
}

// 6. Generated pages consistency
console.log('\n--- Páginas generadas ---\n');
const distDir = join(root, 'dist');
const distIndex = join(distDir, 'index.html');
const distTools = join(distDir, 'tools');

if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');
  const cardCount = (html.match(/class="tool-card"/g) || []).length;
  if (cardCount !== active.length) {
    fail(`Portada: ${cardCount} tarjetas vs ${active.length} activas`);
  } else {
    pass(`Portada: ${cardCount} tarjetas = ${active.length} activas`);
  }

  // Check each active tool has a card
  let missingCards = 0;
  for (const tool of active) {
    if (!html.includes(`data-tool="${tool.toolId}"`)) {
      fail(`${tool.toolId}: sin tarjeta en portada`);
      missingCards++;
    }
  }
  if (missingCards === 0) pass(`Todas las activas tienen tarjeta`);
} else {
  fail('dist/index.html no existe — ejecuta npm run build');
}

if (existsSync(distTools)) {
  let missingPages = 0;
  for (const tool of active) {
    const pagePath = join(distTools, tool.slug, 'index.html');
    if (!existsSync(pagePath)) {
      fail(`${tool.toolId}: página faltante (${tool.slug})`);
      missingPages++;
    }
  }
  if (missingPages === 0) pass(`Todas las ${active.length} páginas generadas existen`);

  const generatedPages = readdirSync(distTools).filter((d) => existsSync(join(distTools, d, 'index.html')));
  if (generatedPages.length !== active.length) {
    fail(`${generatedPages.length} páginas generadas vs ${active.length} activas`);
  } else {
    pass(`${generatedPages.length} páginas generadas = ${active.length} activas`);
  }
} else {
  fail('dist/tools/ no existe — ejecuta npm run build');
}

// 7. Counter consistency
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');
  const counterMatch = html.match(/tool-count[^>]*>(\d+)/);
  if (counterMatch) {
    const count = parseInt(counterMatch[1], 10);
    if (count !== active.length) {
      fail(`Contador: ${count} vs ${active.length} activas`);
    } else {
      pass(`Contador: ${count} = ${active.length} activas`);
    }
  } else {
    pass('Contador dinámico (se genera en runtime)');
  }
}

// 8. Each tool has required fields
console.log('\n--- Campos requeridos ---\n');
const requiredFields = ['id', 'toolId', 'processor', 'slug', 'status', 'icon', 'title', 'description', 'category', 'batch'];
let missingFields = 0;
for (const tool of tools) {
  for (const field of requiredFields) {
    if (!tool[field] && tool[field] !== 0) {
      fail(`${tool.toolId}: campo "${field}" ausente`);
      missingFields++;
    }
  }
}
if (missingFields === 0) pass(`Todos los campos requeridos presentes en ${tools.length} herramientas`);

// 9. Batch numbers
const batches = {};
tools.forEach((t) => { batches[t.batch] = (batches[t.batch] || 0) + 1; });
Object.entries(batches).sort(([a], [b]) => a - b).forEach(([b, c]) => {
  pass(`Batch ${b}: ${c} herramientas`);
});

console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
