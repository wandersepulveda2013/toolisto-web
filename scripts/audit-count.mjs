// audit-count.mjs — Verify tool counts across all sources
import { readFileSync, readdirSync } from 'fs';

// 1. Count tools in tools.json
const tools = JSON.parse(readFileSync('src/data/tools.json', 'utf8'));
const toolIds = tools.map(t => t.id);
const toolToolIds = tools.map(t => t.toolId);
const uniqueToolIds = [...new Set(toolIds)];
const uniqueToolToolIds = [...new Set(toolToolIds)];
const toolSlugs = tools.map(t => t.slug);
console.log(`=== TOOLS.JSON ===`);
console.log(`Total tools: ${toolIds.length}`);
console.log(`Unique tool IDs (id field): ${uniqueToolIds.length}`);
console.log(`Unique toolIds (processor): ${uniqueToolToolIds.length}`);

// 2. Count tool cards in index.html
const indexHtml = readFileSync('index.html', 'utf8');
const cardRe = /data-tool="([^"]+)"/g;
let m;
const allCards = [];
while ((m = cardRe.exec(indexHtml)) !== null) {
  allCards.push(m[1]);
}
const uniqueCards = [...new Set(allCards)];
console.log(`\n=== INDEX.HTML TOOL CARDS ===`);
console.log(`Total card links: ${allCards.length}`);
console.log(`Unique data-tool values: ${uniqueCards.length}`);

// 3. Count tool pages in dist
const distFiles = readdirSync('dist').filter(f => f.endsWith('.html') && f !== 'index.html' && f !== '404.html');
const categories = ['pdf','imagenes','firmas','documentos-word','texto','epub-mobi','hojas-de-calculo'];
const toolPages = distFiles.map(f => f.replace('.html','')).filter(s => !categories.includes(s));
const categoryPages = distFiles.map(f => f.replace('.html','')).filter(s => categories.includes(s));
console.log(`\n=== DIST PAGES ===`);
console.log(`Total HTML files: ${distFiles.length}`);
console.log(`Tool pages: ${toolPages.length}`);
console.log(`Category pages: ${categoryPages.length}`);

// 4. Compare: tools.json slugs vs tool pages
const toolPageSet = new Set(toolPages);
const missingPages = toolSlugs.filter(s => !toolPageSet.has(s));
const extraPages = toolPages.filter(s => !toolSlugs.includes(s));

console.log(`\n=== DISCREPANCY ===`);
console.log(`Tools in tools.json: ${toolIds.length}`);
console.log(`Cards in index.html: ${allCards.length}`);
console.log(`Tool pages in dist: ${toolPages.length}`);
console.log(`Missing pages (in tools.json but no page): ${missingPages.length}`);
if (missingPages.length > 0) missingPages.forEach(s => console.log(`  - ${s}`));
console.log(`Extra pages (page exists but not in tools.json): ${extraPages.length}`);
if (extraPages.length > 0) extraPages.forEach(s => console.log(`  - ${s}`));

// 5. Check toolMeta coverage (keyed by unique toolId)
const appJs = readFileSync('app.js', 'utf8');
const metaKeys = [];
const metaRe = /(\w+):\s*\{\s*icon:/g;
while ((m = metaRe.exec(appJs)) !== null) {
  metaKeys.push(m[1]);
}
console.log(`\n=== TOOLMETA KEYS ===`);
console.log(`Total toolMeta entries: ${metaKeys.length}`);
const missingMeta = uniqueToolToolIds.filter(id => !metaKeys.includes(id));
if (missingMeta.length > 0) {
  console.log(`Missing from toolMeta: ${missingMeta.join(', ')}`);
}

// 6. Check tool-processors.js coverage
const processors = readFileSync('tool-processors.js', 'utf8');
const procFuncs = [];
const procRe = /window\.ToolProcessors\.(\w+)\s*=/g;
while ((m = procRe.exec(processors)) !== null) {
  procFuncs.push(m[1]);
}
console.log(`\n=== PROCESSORS ===`);
console.log(`Total processors: ${procFuncs.length}`);

// 7. Summary and exit code
console.log(`\n=== SUMMARY ===`);
const mismatches = [];
// Total cards in index.html must match total tools in tools.json (each tool has a card)
if (allCards.length !== toolIds.length) mismatches.push(`index.html cards (${allCards.length}) ≠ tools.json (${toolIds.length})`);
// Each tools.json slug must have a dist page
if (missingPages.length > 0) mismatches.push(`${missingPages.length} missing pages`);
if (extraPages.length > 0) mismatches.push(`${extraPages.length} extra pages`);
// toolMeta must cover all unique toolIds (processor function names)
if (missingMeta.length > 0) mismatches.push(`${missingMeta.length} toolIds missing from toolMeta`);

if (mismatches.length > 0) {
  console.log('MISMATCHES:');
  mismatches.forEach(m => console.log(`  ✗ ${m}`));
  process.exit(1);
} else {
  console.log('✓ All counts match');
  process.exit(0);
}
