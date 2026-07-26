import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcTools = join(root, 'src', 'data', 'tools.json');
const distIndex = join(root, 'dist', 'index.html');
let exitCode = 0;
let issues = [];

function fail(msg) { issues.push(msg); console.error(`  FAIL: ${msg}`); }
function pass(msg) { console.log(`  PASS: ${msg}`); }
function info(msg) { console.log(`  INFO: ${msg}`); }

console.log('=== Audit: Count ===\n');

// 1. Load tools.json
if (!existsSync(srcTools)) { fail('src/data/tools.json no existe'); process.exitCode = 1; process.exit(1); }
const tools = JSON.parse(readFileSync(srcTools, 'utf8'));
pass(`tools.json cargado: ${tools.length} herramientas`);

// 2. Check empty IDs
const emptyIds = tools.filter((t) => !t.id || t.id.trim() === '');
if (emptyIds.length > 0) { fail(`${emptyIds.length} herramientas con ID vacío`); } else { pass('Cero IDs vacíos'); }

// 3. Check empty toolIds
const emptyToolIds = tools.filter((t) => !t.toolId || t.toolId.trim() === '');
if (emptyToolIds.length > 0) { fail(`${emptyToolIds.length} herramientas con toolId vacío`); } else { pass('Cero toolIds vacíos'); }

// 4. Check empty slugs
const emptySlugs = tools.filter((t) => !t.slug || t.slug.trim() === '');
if (emptySlugs.length > 0) { fail(`${emptySlugs.length} herramientas con slug vacío`); } else { pass('Cero slugs vacíos'); }

// 5. Check duplicate slugs
const slugCounts = {};
tools.forEach((t) => { slugCounts[t.slug] = (slugCounts[t.slug] || 0) + 1; });
const dupSlugs = Object.entries(slugCounts).filter(([, c]) => c > 1);
if (dupSlugs.length > 0) { fail(`Slugs duplicados: ${dupSlugs.map(([s, c]) => `${s} (${c}x)`).join(', ')}`); } else { pass('Cero slugs duplicados'); }

// 6. Check duplicate IDs
const idCounts = {};
tools.forEach((t) => { idCounts[t.id] = (idCounts[t.id] || 0) + 1; });
const dupIds = Object.entries(idCounts).filter(([, c]) => c > 1);
if (dupIds.length > 0) { fail(`IDs duplicados: ${dupIds.map(([s, c]) => `${s} (${c}x)`).join(', ')}`); } else { pass('Cero IDs duplicados'); }

// 7. Shared toolIds (informational, not a failure)
const toolIdCounts = {};
tools.forEach((t) => { toolIdCounts[t.toolId] = (toolIdCounts[t.toolId] || 0) + 1; });
const uniqueToolIds = Object.keys(toolIdCounts).length;
const sharedToolIds = Object.entries(toolIdCounts).filter(([, c]) => c > 1);
pass(`${uniqueToolIds} toolIds únicos de ${tools.length} entradas`);
if (sharedToolIds.length > 0) {
  info(`ToolIds compartidos (intencional): ${sharedToolIds.map(([s, c]) => `${s} (${c}x)`).join(', ')}`);
}

// 8. All tools are active (no status field required)
pass(`${tools.length} herramientas (todas activas por defecto)`);

// 8b. Check required fields
const requiredFields = ['id', 'slug', 'toolId', 'name', 'title', 'description', 'summary', 'category'];
let missingFields = 0;
for (const tool of tools) {
  for (const field of requiredFields) {
    if (!tool[field]) {
      fail(`${tool.id}: campo "${field}" faltante`);
      missingFields++;
    }
  }
}
if (missingFields === 0) {
  pass(`Todas las ${tools.length} herramientas tienen campos requeridos (${requiredFields.join(', ')})`);
}

// 9. Check dist exists
if (!existsSync(distIndex)) { fail('dist/index.html no existe — ejecuta npm run build'); } else { pass('dist/index.html existe'); }

// 10. Count cards in index.html
if (existsSync(distIndex)) {
  const indexContent = readFileSync(distIndex, 'utf8');
  const cardMatches = indexContent.match(/class="tool-card"/g);
  const cardCount = cardMatches ? cardMatches.length : 0;
  if (cardCount !== tools.length) {
    fail(`Portada tiene ${cardCount} tarjetas pero tools.json tiene ${tools.length} herramientas`);
  } else {
    pass(`Portada tiene ${cardCount} tarjetas = ${tools.length} herramientas`);
  }

  // Check counter
  const counterMatch = indexContent.match(/tool-count[^>]*>(\d+)/);
  if (counterMatch) {
    const counterVal = parseInt(counterMatch[1], 10);
    if (counterVal !== tools.length) {
      fail(`Contador muestra ${counterVal} pero hay ${tools.length} herramientas`);
    } else {
      pass(`Contador muestra ${counterVal} = ${tools.length} herramientas`);
    }
  } else {
    pass('Contador no encontrado (se genera dinámicamente)');
  }

  // Check each tool has a card
  let missingCards = 0;
  for (const tool of tools) {
    const hasCard = indexContent.includes(`data-tool="${tool.toolId}"`);
    if (!hasCard) {
      fail(`Tool "${tool.toolId}" no tiene tarjeta en la portada`);
      missingCards++;
    }
  }
  if (missingCards === 0) {
    pass(`Todas las ${tools.length} herramientas tienen tarjeta`);
  }
}

// 11. Check tool pages exist (flat structure: dist/{slug}.html)
const distDir = join(root, 'dist');
if (existsSync(distDir)) {
  let missingPages = 0;
  for (const tool of tools) {
    const pagePath = join(distDir, `${tool.slug}.html`);
    if (!existsSync(pagePath)) {
      fail(`Página faltante: dist/${tool.slug}.html`);
      missingPages++;
    }
  }
  if (missingPages === 0) {
    pass(`Todas las ${tools.length} páginas de herramientas existen`);
  }

  // Count generated HTML pages
  const htmlFiles = readdirSync(distDir).filter((f) => f.endsWith('.html'));
  pass(`${htmlFiles.length} archivos HTML en dist/`);
} else {
  fail('dist/ no existe — ejecuta npm run build');
}

// 12. Check processor coverage (tool-processors.js + app.js switch-case)
const processorPath = join(root, 'tool-processors.js');
const appJsPath = join(root, 'app.js');
const coveredTools = new Set();

if (existsSync(processorPath)) {
  const procContent = readFileSync(processorPath, 'utf8');
  const procMatches = procContent.match(/ToolProcessors\.(\w+)\s*=/g) || [];
  procMatches.forEach((m) => {
    const name = m.replace(/ToolProcessors\.|(\s*=)/g, '');
    coveredTools.add(name);
  });
  pass(`tool-processors.js: ${coveredTools.size} procesadores registrados`);
} else {
  fail('tool-processors.js no existe en raíz');
}

if (existsSync(appJsPath)) {
  const appContent = readFileSync(appJsPath, 'utf8');
  const switchMatches = appContent.match(/case\s+'(\w+)':/g) || [];
  const switchCases = switchMatches.map((m) => m.replace(/case\s+'|':/g, ''));
  switchCases.forEach((c) => coveredTools.add(c));
  pass(`app.js: ${switchCases.length} handlers en switch-case`);
}

let missingCoverage = 0;
for (const tool of tools) {
  if (!coveredTools.has(tool.toolId)) {
    fail(`Tool "${tool.toolId}" sin procesador ni handler`);
    missingCoverage++;
  }
}
if (missingCoverage === 0) {
  pass(`Todas las ${tools.length} herramientas tienen cobertura (procesador o handler)`);
}

// 13. Check toolMeta entries (informational — not all tools need entries)
if (existsSync(appJsPath)) {
  const appContent = readFileSync(appJsPath, 'utf8');
  if (appContent.includes('const toolMeta')) {
    const metaMatch = appContent.match(/const toolMeta\s*=\s*\{([\s\S]*?)\};/);
    if (metaMatch) {
      const metaKeys = metaMatch[1].match(/(\w+):\s*\{/g) || [];
      const keyCount = metaKeys.length;
      pass(`toolMeta: ${keyCount} entradas (las herramientas sin entrada usan procesador o handler)`);
    }
  } else {
    pass('app.js no contiene toolMeta estático');
  }
}

console.log(`\n=== Resultado ===`);
if (issues.length > 0) {
  console.error(`${issues.length} problema(s) detectado(s)`);
  process.exit(1);
} else {
  console.log('Auditoría aprobada: todas las verificaciones pasaron');
  process.exit(0);
}
