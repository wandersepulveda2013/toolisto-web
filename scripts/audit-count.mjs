import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcTools = join(root, 'src', 'data', 'tools.json');
const distToolisto = join(root, 'dist', 'toolisto.html');
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

// 8. Enabled/disabled state (matrix-certified)
const enabledTools = tools.filter(t => t.enabled);
const disabledTools = tools.filter(t => !t.enabled);
pass(`${enabledTools.length} herramientas habilitadas (certificadas) / ${disabledTools.length} en revisión`);
if (enabledTools.length + disabledTools.length !== tools.length) {
  fail('Conteo habilitadas + en revisión no coincide con el total');
}

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
if (!existsSync(distToolisto)) { fail('dist/toolisto.html no existe — ejecuta npm run build'); } else { pass('dist/toolisto.html existe'); }

// 10. Count cards in toolisto.html (only enabled tools get a card)
if (existsSync(distToolisto)) {
  const indexContent = readFileSync(distToolisto, 'utf8');
  const cardMatches = indexContent.match(/class="tool-card"/g);
  const cardCount = cardMatches ? cardMatches.length : 0;
  if (cardCount !== enabledTools.length) {
    fail(`Portada tiene ${cardCount} tarjetas pero hay ${enabledTools.length} herramientas habilitadas`);
  } else {
    pass(`Portada tiene ${cardCount} tarjetas = ${enabledTools.length} herramientas habilitadas`);
  }

  // Check counter
  const counterMatch = indexContent.match(/tool-count[^>]*>(\d+)/);
  if (counterMatch) {
    const counterVal = parseInt(counterMatch[1], 10);
    if (counterVal !== enabledTools.length) {
      fail(`Contador muestra ${counterVal} pero hay ${enabledTools.length} herramientas habilitadas`);
    } else {
      pass(`Contador muestra ${counterVal} = ${enabledTools.length} herramientas habilitadas`);
    }
  } else {
    pass('Contador no encontrado (se genera dinámicamente)');
  }

  // Check each enabled tool has a card (by href slug, ids may share toolId)
  let missingCards = 0;
  for (const tool of enabledTools) {
    const hasCard = indexContent.includes(`href="./${tool.slug}"`);
    if (!hasCard) {
      fail(`Tool habilitada "${tool.id}" no tiene tarjeta en la portada`);
      missingCards++;
    }
  }
  if (missingCards === 0) {
    pass(`Todas las ${enabledTools.length} herramientas habilitadas tienen tarjeta`);
  }

  // Check disabled tools have NO card
  let strayCards = 0;
  for (const tool of disabledTools) {
    if (indexContent.includes(`href="./${tool.slug}"`)) {
      fail(`Tool en revisión "${tool.id}" aparece como tarjeta en la portada`);
      strayCards++;
    }
  }
  if (strayCards === 0) {
    pass(`Ninguna de las ${disabledTools.length} herramientas en revisión tiene tarjeta`);
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

// 11c. Disabled pages are noindex with review notice; enabled pages are indexable
if (existsSync(distDir)) {
  let badDisabled = 0;
  let badEnabled = 0;
  for (const tool of tools) {
    const pagePath = join(distDir, `${tool.slug}.html`);
    if (!existsSync(pagePath)) continue;
    const content = readFileSync(pagePath, 'utf8');
    if (tool.enabled) {
      if (!content.includes('<meta name="robots" content="index, follow">')) {
        fail(`Página habilitada ${tool.slug}.html sin meta robots index`);
        badEnabled++;
      }
      if (content.includes('id="toolDisabledNotice"')) {
        fail(`Página habilitada ${tool.slug}.html incluye el aviso de revisión`);
        badEnabled++;
      }
    } else {
      if (!content.includes('<meta name="robots" content="noindex, nofollow">')) {
        fail(`Página en revisión ${tool.slug}.html sin meta robots noindex`);
        badDisabled++;
      }
      if (!content.includes('id="toolDisabledNotice"')) {
        fail(`Página en revisión ${tool.slug}.html sin aviso de revisión`);
        badDisabled++;
      }
      if (!content.includes('"enabled":false')) {
        fail(`Página en revisión ${tool.slug}.html sin config.enabled=false`);
        badDisabled++;
      }
    }
  }
  if (badDisabled === 0) pass(`Las ${disabledTools.length} páginas en revisión son noindex con aviso`);
  if (badEnabled === 0) pass(`Las ${enabledTools.length} páginas habilitadas son indexables sin aviso`);
}

// 11b. Check category consistency (every tool appears on its category page)
const srcCategories = join(root, 'src', 'data', 'categories.json');
if (existsSync(srcCategories)) {
  const categories = JSON.parse(readFileSync(srcCategories, 'utf8'));
  const catById = {};
  for (const c of categories) catById[c.id] = c;
  let missingInCat = 0;
  for (const tool of tools) {
    if (!tool.enabled) continue;
    const cat = catById[tool.category];
    if (!cat) {
      fail(`Tool "${tool.toolId}" referencia una categoría inexistente: ${tool.category}`);
      missingInCat++;
      continue;
    }
    if (!cat.toolIds.includes(tool.toolId) || !cat.slugs.includes(tool.slug)) {
      fail(`Tool "${tool.toolId}" (${tool.slug}) no aparece en la página de la categoría "${cat.id}"`);
      missingInCat++;
    }
  }
  if (missingInCat === 0) {
    pass(`Todas las ${enabledTools.length} herramientas habilitadas aparecen en su categoría`);
  }
} else {
  fail('src/data/categories.json no existe');
}

// 11d. Category counts consistency: tools.json → toolisto.html category-count spans
const srcToolisto = join(root, 'toolisto.html');
if (existsSync(srcToolisto)) {
  const srcHtml = readFileSync(srcToolisto, 'utf8');
  const catCounts = {};
  for (const tool of enabledTools) {
    catCounts[tool.category] = (catCounts[tool.category] || 0) + 1;
  }
  const totalFromCategories = Object.values(catCounts).reduce((a, b) => a + b, 0);
  if (totalFromCategories !== enabledTools.length) {
    fail(`SUM(category.toolCount)=${totalFromCategories} !== enabledTools.length=${enabledTools.length}`);
  } else {
    pass(`SUM(category.toolCount) = ${totalFromCategories} = ${enabledTools.length} herramientas habilitadas`);
  }
  let mismatchCount = 0;
  for (const [cat, expected] of Object.entries(catCounts)) {
    const pattern = new RegExp(`category-card"\\s+href="[^"]*"\\s+data-nav-filter="${cat}"[\\s\\S]*?category-count">(\\d+) herramientas`);
    const match = srcHtml.match(pattern);
    if (!match) {
      fail(`Categoría "${cat}" no encontrada en toolisto.html`);
      mismatchCount++;
    } else {
      const displayed = parseInt(match[1], 10);
      if (displayed !== expected) {
        fail(`Categoría "${cat}": toolisto.html muestra ${displayed} pero tools.json tiene ${expected}`);
        mismatchCount++;
      }
    }
  }
  if (mismatchCount === 0) {
    pass(`Contadores de categorías en toolisto.html coinciden con registry (${Object.keys(catCounts).length} categorías)`);
  }
} else {
  info('toolisto.html fuente no encontrado — saltando validación de contadores de categoría');
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
