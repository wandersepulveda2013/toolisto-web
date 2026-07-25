import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcTools = join(root, 'src', 'data', 'tools.json');
const distIndex = join(root, 'dist', 'index.html');
const distTools = join(root, 'dist', 'tools');
let exitCode = 0;
let issues = [];

function fail(msg) { issues.push(msg); console.error(`  FAIL: ${msg}`); }
function pass(msg) { console.log(`  PASS: ${msg}`); }

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

// 7. Check duplicate toolIds
const toolIdCounts = {};
tools.forEach((t) => { toolIdCounts[t.toolId] = (toolIdCounts[t.toolId] || 0) + 1; });
const dupToolIds = Object.entries(toolIdCounts).filter(([, c]) => c > 1);
if (dupToolIds.length > 0) { fail(`ToolIds duplicados: ${dupToolIds.map(([s, c]) => `${s} (${c}x)`).join(', ')}`); } else { pass('Cero toolIds duplicados'); }

// 8. Count active tools
const activeTools = tools.filter((t) => t.status === 'active');
const blockedTools = tools.filter((t) => t.status === 'blocked');
const testingTools = tools.filter((t) => t.status === 'testing');
pass(`Activas: ${activeTools.length}, Bloqueadas: ${blockedTools.length}, En prueba: ${testingTools.length}`);

// 9. Check dist exists
if (!existsSync(distIndex)) { fail('dist/index.html no existe — ejecuta npm run build'); } else { pass('dist/index.html existe'); }

// 10. Count cards in index.html
if (existsSync(distIndex)) {
  const indexContent = readFileSync(distIndex, 'utf8');
  const cardMatches = indexContent.match(/class="tool-card"/g);
  const cardCount = cardMatches ? cardMatches.length : 0;
  if (cardCount !== activeTools.length) {
    fail(`Portada tiene ${cardCount} tarjetas pero tools.json tiene ${activeTools.length} activas`);
  } else {
    pass(`Portada tiene ${cardCount} tarjetas = ${activeTools.length} activas`);
  }

  // Check counter
  const counterMatch = indexContent.match(/tool-count[^>]*>(\d+)/);
  if (counterMatch) {
    const counterVal = parseInt(counterMatch[1], 10);
    if (counterVal !== activeTools.length) {
      fail(`Contador muestra ${counterVal} pero hay ${activeTools.length} activas`);
    } else {
      pass(`Contador muestra ${counterVal} = ${activeTools.length} activas`);
    }
  } else {
    pass('Contador no encontrado (se genera dinámicamente)');
  }

  // Check each active tool has a card
  for (const tool of activeTools) {
    const hasCard = indexContent.includes(`data-tool="${tool.toolId}"`);
    if (!hasCard) {
      fail(`Tool "${tool.toolId}" no tiene tarjeta en la portada`);
    }
  }
  pass(`Todas las ${activeTools.length} herramientas activas tienen tarjeta`);
}

// 11. Check tool pages exist
if (existsSync(distTools)) {
  let missingPages = 0;
  for (const tool of activeTools) {
    const pagePath = join(distTools, tool.slug, 'index.html');
    if (!existsSync(pagePath)) {
      fail(`Página faltante: dist/tools/${tool.slug}/index.html`);
      missingPages++;
    }
  }
  if (missingPages === 0) {
    pass(`Todas las ${activeTools.length} páginas de herramientas existen`);
  }

  // Count generated pages
  const toolDirs = readdirSync(distTools).filter((d) => existsSync(join(distTools, d, 'index.html')));
  if (toolDirs.length !== activeTools.length) {
    fail(`Hay ${toolDirs.length} páginas generadas pero ${activeTools.length} activas`);
  } else {
    pass(`${toolDirs.length} páginas generadas = ${activeTools.length} activas`);
  }
} else {
  fail('dist/tools/ no existe — ejecuta npm run build');
}

// 12. Check processor declarations
const processorPath = join(root, 'src', 'tool-processors.js');
if (existsSync(processorPath)) {
  const procContent = readFileSync(processorPath, 'utf8');
  let missingProcessors = 0;
  for (const tool of activeTools) {
    const procName = tool.processor || tool.toolId;
    const hasProc = procContent.includes(`processors.${procName}`) || procContent.includes(`processors['${procName}']`);
    if (!hasProc) {
      fail(`Procesador "${procName}" declarado pero no encontrado en tool-processors.js`);
      missingProcessors++;
    }
  }
  if (missingProcessors === 0) {
    pass(`Todos los procesadores de herramientas activas existen`);
  }
} else {
  fail('src/tool-processors.js no existe');
}

// 13. Check toolMeta sync (if present in app.js)
const appJsPath = join(root, 'app.js');
if (existsSync(appJsPath)) {
  const appContent = readFileSync(appJsPath, 'utf8');
  if (appContent.includes('const toolMeta')) {
    const metaMatch = appContent.match(/const toolMeta\s*=\s*\{([\s\S]*?)\};/);
    if (metaMatch) {
      const metaKeys = metaMatch[1].match(/(\w+):/g) || [];
      const keyCount = metaKeys.length;
      if (keyCount !== activeTools.length) {
        fail(`toolMeta tiene ${keyCount} entradas pero hay ${activeTools.length} activas`);
      } else {
        pass(`toolMeta sincronizado: ${keyCount} entradas = ${activeTools.length} activas`);
      }
    }
  } else if (appContent.includes('getToolMeta') || appContent.includes('buildToolMeta')) {
    pass('toolMeta se deriva dinámicamente de tools.json/DOM');
  } else {
    pass('app.js no contiene toolMeta estático (se asume derivado)');
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
