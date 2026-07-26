const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Homepage Audit Test ===\n');

if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));

const distIndex = join(root, 'dist', 'index.html');
if (!existsSync(distIndex)) { fail('dist/index.html no existe — ejecuta npm run build'); process.exit(1); }
const html = readFileSync(distIndex, 'utf8');

// Count tool cards
const cardCount = (html.match(/class="tool-card"/g) || []).length;
if (cardCount !== tools.length) {
  fail(`Portada: ${cardCount} tarjetas vs ${tools.length} herramientas`);
} else {
  pass(`Portada: ${cardCount} tarjetas = ${tools.length} herramientas`);
}

// Check each tool has a card
let missingCards = 0;
for (const tool of tools) {
  if (!html.includes(`data-tool="${tool.toolId}"`)) {
    fail(`${tool.toolId}: sin tarjeta`);
    missingCards++;
  }
}
if (missingCards === 0) pass(`Todas las ${tools.length} herramientas tienen tarjeta`);

// Check card attributes (cards are <a> elements, not <button>)
const cardRegex = /<a class="tool-card"[^>]*>/g;
let match;
let cardIndex = 0;
while ((match = cardRegex.exec(html)) !== null) {
  cardIndex++;
  const cardTag = match[0];
  if (!cardTag.includes('data-tool=')) fail(`Tarjeta ${cardIndex}: falta data-tool`);
  if (!cardTag.includes('data-category=')) fail(`Tarjeta ${cardIndex}: falta data-category`);
}
if (cardIndex > 0) pass(`${cardIndex} tarjetas verificadas`);
else fail('No se encontraron tarjetas con <a class="tool-card">');

// Check tool search input exists
if (!html.includes('id="toolSearch"')) {
  fail('Buscador de herramientas no encontrado');
} else {
  pass('Buscador de herramientas presente');
}

// Check filter chips exist
const filterChips = (html.match(/class="filter-chip"/g) || []).length;
if (filterChips < 3) {
  fail(`Solo ${filterChips} filtros (mínimo 3)`);
} else {
  pass(`${filterChips} filtros presentes`);
}

// Check empty tools message
if (!html.includes('id="emptyTools"')) {
  fail('Mensaje de herramientas vacías no encontrado');
} else {
  pass('Mensaje de herramientas vacías presente');
}

// Check title
if (!html.includes('<title>')) {
  fail('Tag title no encontrado');
} else {
  pass('Tag title presente');
}

// Check meta description
if (!html.includes('meta name="description"')) {
  fail('Meta description no encontrado');
} else {
  pass('Meta description presente');
}

// Check theme toggle
if (!html.includes('id="themeToggle"')) {
  fail('Toggle de tema no encontrado');
} else {
  pass('Toggle de tema presente');
}

// Check scripts loaded
if (!html.includes('app.js')) {
  fail('app.js no incluido');
} else {
  pass('app.js incluido');
}

console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
