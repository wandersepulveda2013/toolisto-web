import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname);
const srcTools = join(root, 'src', 'data', 'tools.json');
let exitCode = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); exitCode = 1; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== Audit: Slugs ===\n');

if (!existsSync(srcTools)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(srcTools, 'utf8'));

const slugs = tools.map((t) => t.slug);
const slugSet = new Set(slugs);

if (slugSet.size !== slugs.length) {
  const seen = {};
  const dupes = [];
  slugs.forEach((s) => { seen[s] = (seen[s] || 0) + 1; });
  Object.entries(seen).filter(([, c]) => c > 1).forEach(([s, c]) => dupes.push(`${s} (${c}x)`));
  fail(`Slugs duplicados: ${dupes.join(', ')}`);
} else {
  pass(`${slugs.length} slugs únicos`);
}

const urlSafe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unsafe = tools.filter((t) => !urlSafe.test(t.slug));
if (unsafe.length > 0) {
  fail(`Slugs no URL-safe: ${unsafe.map((t) => `${t.toolId}: ${t.slug}`).join(', ')}`);
} else {
  pass('Todos los slugs son URL-safe');
}

const reserved = ['api', 'admin', 'login', 'static', 'assets', 'dist', 'src', 'tools'];
const conflicts = tools.filter((t) => reserved.includes(t.slug));
if (conflicts.length > 0) {
  fail(`Slugs en conflicto con rutas reservadas: ${conflicts.map((t) => t.slug).join(', ')}`);
} else {
  pass('Sin conflictos con rutas reservadas');
}

for (const tool of tools) {
  if (!tool.slug || tool.slug.trim() === '') {
    fail(`${tool.toolId} tiene slug vacío`);
  }
}

const activeTools = tools.filter((t) => t.status === 'active');
const activeSlugs = activeTools.map((t) => t.slug);
if (new Set(activeSlugs).size !== activeSlugs.length) {
  fail('Slugs duplicados entre herramientas activas');
} else {
  pass(`${activeSlugs.length} slugs activos únicos`);
}

console.log(`\n=== Resultado ===`);
if (exitCode === 0) {
  console.log('Auditoría de slugs aprobada');
} else {
  console.error('Auditoría de slugs falló');
}
process.exit(exitCode);
