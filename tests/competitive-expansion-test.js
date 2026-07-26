const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');

let passed = 0;
let failed = 0;
function ok(label, condition) {
  if (condition) { console.log('  \u2713 ' + label); passed++; }
  else { console.log('  \u2717 FAIL: ' + label); failed++; }
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function readDist(relPath) {
  return fs.readFileSync(path.join(DIST, relPath), 'utf8');
}

function distExists(relPath) {
  return fs.existsSync(path.join(DIST, relPath));
}

const NEW_TOOLS = [
  { toolId: 'scannedPdfToSearchablePdf', slug: 'pdf-escaneado-a-pdf-buscable', category: 'pdf', accepts: 'pdf' },
  { toolId: 'imageToSearchablePdf', slug: 'imagen-a-pdf-buscable', category: 'pdf', accepts: 'image' },
  { toolId: 'extractTextFromScannedPdf', slug: 'extraer-texto-pdf-escaneado', category: 'pdf', accepts: 'pdf' },
  { toolId: 'detectOcrNeeded', slug: 'detectar-ocr-pdf', category: 'pdf', accepts: 'pdf' },
  { toolId: 'censorPdf', slug: 'censurar-pdf-permanente', category: 'pdf', accepts: 'pdf' },
  { toolId: 'verifyPdfCensor', slug: 'verificar-censura-pdf', category: 'pdf', accepts: 'pdf' },
  { toolId: 'comparePdfs', slug: 'comparar-dos-pdf', category: 'pdf', accepts: 'pdf' },
];

const toolsJson = readJson('src/data/tools.json');
const categoriesJson = readJson('src/data/categories.json');

// ═══════════════════════════════════════════════════
// 1. tools.json — New tools (7 tools)
// ═══════════════════════════════════════════════════
console.log('\n=== 1. tools.json — New tools (7 tools) ===\n');

ok('Total tool count is 144', toolsJson.length === 144);
ok('Total enabled count is 144', toolsJson.filter(t => t.enabled).length === 144);

for (const t of NEW_TOOLS) {
  const tool = toolsJson.find(x => x.toolId === t.toolId);
  ok(`${t.toolId} exists in tools.json`, !!tool);
  if (tool) {
    ok(`${t.toolId} enabled=true`, tool.enabled === true);
    ok(`${t.toolId} category='${t.category}'`, tool.category === t.category);
    ok(`${t.toolId} slug='${t.slug}'`, tool.slug === t.slug);
    ok(`${t.toolId} accepts='${t.accepts}'`, tool.accepts === t.accepts);
    ok(`${t.toolId} has faq array with 2+ entries`, Array.isArray(tool.faq) && tool.faq.length >= 2);
    ok(`${t.toolId} has instructions array with 3+ entries`, Array.isArray(tool.instructions) && tool.instructions.length >= 3);
    ok(`${t.toolId} lastModified='2026-07-26'`, tool.lastModified === '2026-07-26');
    ok(`${t.toolId} has keywords array with 3+ entries`, Array.isArray(tool.keywords) && tool.keywords.length >= 3);
  }
}

// ═══════════════════════════════════════════════════
// 2. categories.json (12 categories, pdf includes all 7)
// ═══════════════════════════════════════════════════
console.log('\n=== 2. categories.json (12 categories) ===\n');

ok('Total category count is 12', categoriesJson.length === 12);

const pdfCat = categoriesJson.find(c => c.id === 'pdf');
ok('pdf category exists', !!pdfCat);
if (pdfCat) {
  for (const t of NEW_TOOLS) {
    ok(`pdf category includes toolId '${t.toolId}'`, pdfCat.toolIds.includes(t.toolId));
  }
  for (const t of NEW_TOOLS) {
    ok(`pdf category includes slug '${t.slug}'`, pdfCat.slugs.includes(t.slug));
  }
  ok(`pdf category toolIds length includes all 7 new (total ${pdfCat.toolIds.length})`, pdfCat.toolIds.length >= 27);
  ok(`pdf category slugs length includes all 7 new (total ${pdfCat.slugs.length})`, pdfCat.slugs.length >= 27);
}

// ═══════════════════════════════════════════════════
// 3. SEO Pages Exist (7 pages)
// ═══════════════════════════════════════════════════
console.log('\n=== 3. SEO Pages Exist (7 pages) ===\n');

for (const t of NEW_TOOLS) {
  const htmlFile = t.slug + '.html';
  ok(`${htmlFile} exists in dist`, distExists(htmlFile));
}

// ═══════════════════════════════════════════════════
// 4. SEO Page Content (toolId in config)
// ═══════════════════════════════════════════════════
console.log('\n=== 4. SEO Page Content ===\n');

for (const t of NEW_TOOLS) {
  const html = readDist(t.slug + '.html');
  ok(`${t.slug}.html has toolId="${t.toolId}" in config`, html.includes(`"toolId":"${t.toolId}"`));
}

// ═══════════════════════════════════════════════════
// 5. Module JS Files in dist
// ═══════════════════════════════════════════════════
console.log('\n=== 5. Module JS Files in dist ===\n');

const moduleFiles = [
  'js/ocr/pdf-ocr-engine.js',
  'js/security/pdf-censor-engine.js',
];

for (const f of moduleFiles) {
  ok(`${f} exists`, distExists(f));
}

// ═══════════════════════════════════════════════════
// 6. Tool Pages Load Module Scripts
// ═══════════════════════════════════════════════════
console.log('\n=== 6. Tool Pages Load Module Scripts ===\n');

const scriptLoads = [
  { page: 'pdf-escaneado-a-pdf-buscable.html', script: 'pdf-ocr-engine.js' },
  { page: 'censurar-pdf-permanente.html', script: 'pdf-censor-engine.js' },
  { page: 'comparar-dos-pdf.html', script: 'pdf-ocr-engine.js' },
];

for (const s of scriptLoads) {
  const html = readDist(s.page);
  ok(`${s.page} loads ${s.script}`, html.includes(s.script));
}

// ═══════════════════════════════════════════════════
// 7. File Limits Profiles
// ═══════════════════════════════════════════════════
console.log('\n=== 7. File Limits Profiles ===\n');

const fileLimitsJs = readDist('js/file-limits.js');

for (const t of NEW_TOOLS) {
  ok(`file-limits.js has profile mapping for ${t.toolId}`, fileLimitsJs.includes(t.toolId));
}

// ═══════════════════════════════════════════════════
// 8. index.html Tool Cards (7 new cards)
// ═══════════════════════════════════════════════════
console.log('\n=== 8. index.html Tool Cards ===\n');

const indexHtml = readDist('index.html');

for (const t of NEW_TOOLS) {
  ok(`index.html has tool card for ${t.toolId}`, indexHtml.includes(`data-tool="${t.toolId}"`));
}

const cardCount = (indexHtml.match(/class="tool-card"/g) || []).length;
ok(`Total tool cards = 144 (found ${cardCount})`, cardCount === 144);

ok('index.html has pdf filter chip', indexHtml.includes('data-category="pdf"'));

// ═══════════════════════════════════════════════════
// 9. tool-processors.js Has Processors
// ═══════════════════════════════════════════════════
console.log('\n=== 9. tool-processors.js Has Processors ===\n');

const tpJs = readDist('js/tool-processors.js');

for (const t of NEW_TOOLS) {
  ok(`tool-processors.js has ${t.toolId} processor`, tpJs.includes(`window.ToolProcessors.${t.toolId}`));
}

// ═══════════════════════════════════════════════════
// 10. smart-search.js Has Entries
// ═══════════════════════════════════════════════════
console.log('\n=== 10. smart-search.js Has Entries ===\n');

const ssJs = readDist('js/smart-search.js');

for (const t of NEW_TOOLS) {
  ok(`smart-search.js ACTIONS has ${t.toolId}`, ssJs.includes(`${t.toolId}:`));
}

ok("smart-search.js SYNONYMS has 'ocr' mapping", ssJs.includes("'ocr'"));
ok("smart-search.js SYNONYMS has 'redact' mapping", ssJs.includes("'redact'"));
ok("smart-search.js SYNONYMS has 'diff' mapping", ssJs.includes("'diff'"));
ok('smart-search.js INTENT_PATTERNS has ocr pattern', /ocr\|reconocimiento.*texto\|texto.*buscable\|pdf.*escaneado.*buscable/.test(ssJs));
ok('smart-search.js INTENT_PATTERNS has detectOcr pattern', /detectar.*ocr\|analizar.*pdf.*texto\|verificar.*texto.*pdf/.test(ssJs));
ok('smart-search.js INTENT_PATTERNS has censorPdf pattern', /censurar.*pdf\|redact.*pdf\|ocultar.*texto.*pdf/.test(ssJs));
ok('smart-search.js INTENT_PATTERNS has comparePdfs pattern', /comparar.*pdf\|diferencias.*pdf\|diff.*pdf/.test(ssJs));

// ═══════════════════════════════════════════════════
// 11. Module JS Syntax Validation
// ═══════════════════════════════════════════════════
console.log('\n=== 11. Module JS Syntax Validation ===\n');

const jsFiles = [
  'js/ocr/pdf-ocr-engine.js',
  'js/security/pdf-censor-engine.js',
];

for (const f of jsFiles) {
  const code = readDist(f);
  try {
    new Function(code);
    ok(`${f} parses without syntax error`, true);
  } catch (e) {
    ok(`${f} parses without syntax error — ERROR: ${e.message}`, false);
  }
}

// ═══════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════
console.log('\n=== RESULTS ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log(failed === 0 ? '\n\u2713 ALL TESTS PASSED' : '\n\u2717 SOME TESTS FAILED');

process.exit(failed > 0 ? 1 : 0);
