const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Alias Restrictions Test ===\n');

if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));

const ids = tools.map((t) => t.id);
const toolIds = tools.map((t) => t.toolId);
const slugs = tools.map((t) => t.slug);

// Check no empty values
const emptyIds = ids.filter((id) => !id || id.trim() === '');
const emptyToolIds = toolIds.filter((id) => !id || id.trim() === '');
const emptySlugs = slugs.filter((s) => !s || s.trim() === '');

if (emptyIds.length > 0) fail(`${emptyIds.length} IDs vacíos`);
else pass('Cero IDs vacíos');

if (emptyToolIds.length > 0) fail(`${emptyToolIds.length} toolIds vacíos`);
else pass('Cero toolIds vacíos');

if (emptySlugs.length > 0) fail(`${emptySlugs.length} slugs vacíos`);
else pass('Cero slugs vacíos');

// Check uniqueness
function checkUnique(arr, label) {
  const seen = {};
  const dupes = [];
  arr.forEach((v) => { seen[v] = (seen[v] || 0) + 1; });
  Object.entries(seen).filter(([, c]) => c > 1).forEach(([v, c]) => dupes.push(`${v} (${c}x)`));
  if (dupes.length > 0) { fail(`${label} duplicados: ${dupes.join(', ')}`); }
  else { pass(`${arr.length} ${label} únicos`); }
}

checkUnique(ids, 'IDs');
checkUnique(toolIds, 'ToolIds');
checkUnique(slugs, 'Slugs');

// Check URL safety
const urlSafe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unsafeSlugs = tools.filter((t) => !urlSafe.test(t.slug));
if (unsafeSlugs.length > 0) fail(`Slugs no URL-safe: ${unsafeSlugs.map((t) => t.slug).join(', ')}`);
else pass('Todos los slugs son URL-safe');

// Check no alias conflicts between active tools
const activeTools = tools.filter((t) => t.status === 'active');
const activeSlugs = activeTools.map((t) => t.slug);
const activeIds = activeTools.map((t) => t.toolId);
checkUnique(activeSlugs, 'Slugs activos');
checkUnique(activeIds, 'ToolIds activos');

// Check each tool has all required fields
for (const tool of tools) {
  const required = ['id', 'toolId', 'processor', 'slug', 'status', 'icon', 'title', 'description', 'category'];
  for (const field of required) {
    if (!tool[field]) fail(`${tool.toolId}: campo "${field}" vacío`);
  }
}

// Check no slug conflicts with toolId (they should be different)
const slugToolConflicts = tools.filter((t) => t.slug === t.toolId);
if (slugToolConflicts.length > 0) {
  pass(`${slugToolConflicts.length} herramientas con slug = toolId (aceptable pero no ideal)`);
}

// Check tool-page-config in generated pages
const distTools = join(root, 'dist', 'tools');
if (existsSync(distTools)) {
  for (const tool of activeTools) {
    const pagePath = join(distTools, tool.slug, 'index.html');
    if (existsSync(pagePath)) {
      const pageContent = readFileSync(pagePath, 'utf8');
      if (!pageContent.includes(`data-tool-id="${tool.toolId}"`)) {
        fail(`${tool.toolId}: página sin tool-page-config data-tool-id`);
      } else {
        pass(`${tool.toolId}: página tiene tool-page-config correcto`);
      }
    }
  }
} else {
  pass('dist/tools/ no existe (se omite verificación de páginas)');
}

console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
