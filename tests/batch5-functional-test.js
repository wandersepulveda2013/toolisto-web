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
  { toolId: 'inspectFileMetadata', slug: 'inspeccionar-metadatos-archivo', category: 'files', accepts: 'file' },
  { toolId: 'encryptDecryptFile', slug: 'cifrar-descifrar-archivo', category: 'files', accepts: 'file' },
  { toolId: 'photoLocationExtractor', slug: 'extraer-ubicacion-foto', category: 'images', accepts: 'image' },
  { toolId: 'simpleCalculator', slug: 'calculadora-simple', category: 'calculators', accepts: 'none' },
  { toolId: 'scientificCalculator', slug: 'calculadora-cientifica', category: 'calculators', accepts: 'none' },
  { toolId: 'textToUnicodeBraille', slug: 'texto-a-braille-unicode', category: 'text', accepts: 'text' },
  { toolId: 'formatDocumentApa7', slug: 'formato-apa-7', category: 'documents', accepts: 'none' },
];

const toolsJson = readJson('src/data/tools.json');
const categoriesJson = readJson('src/data/categories.json');

// ═══════════════════════════════════════════════════
// 1. tools.json Structure (7 tools)
// ═══════════════════════════════════════════════════
console.log('\n=== 1. tools.json Structure (7 tools) ===\n');

ok('Total tool count is 144', toolsJson.length === 144);
ok('Total enabled count is 144', toolsJson.filter(t => t.enabled).length === 144);

for (const t of NEW_TOOLS) {
  const tool = toolsJson.find(x => x.toolId === t.toolId);
  ok(`${t.toolId} exists in tools.json`, !!tool);
  if (tool) {
    ok(`${t.toolId} enabled=true`, tool.enabled === true);
    ok(`${t.toolId} category='${t.category}'`, tool.category === t.category);
    ok(`${t.toolId} accepts='${t.accepts}'`, tool.accepts === t.accepts);
    ok(`${t.toolId} slug='${t.slug}'`, tool.slug === t.slug);
    ok(`${t.toolId} has faq array with 2+ entries`, Array.isArray(tool.faq) && tool.faq.length >= 2);
    ok(`${t.toolId} has instructions array with 3+ entries`, Array.isArray(tool.instructions) && tool.instructions.length >= 3);
    ok(`${t.toolId} lastModified='2026-07-26'`, tool.lastModified === '2026-07-26');
    ok(`${t.toolId} has keywords array with 3+ entries`, Array.isArray(tool.keywords) && tool.keywords.length >= 3);
  }
}

// ═══════════════════════════════════════════════════
// 2. categories.json (12 categories)
// ═══════════════════════════════════════════════════
console.log('\n=== 2. categories.json (12 categories) ===\n');

ok('Total category count is 12', categoriesJson.length === 12);

const calcCat = categoriesJson.find(c => c.id === 'calculators');
ok('calculators category exists', !!calcCat);
if (calcCat) {
  ok("calculators id='calculators'", calcCat.id === 'calculators');
  ok("calculators name='Calculadoras'", calcCat.name === 'Calculadoras');
  ok("calculators slug='calculadoras'", calcCat.slug === 'calculadoras');
  ok('calculators has simpleCalculator in toolIds', calcCat.toolIds.includes('simpleCalculator'));
  ok('calculators has scientificCalculator in toolIds', calcCat.toolIds.includes('scientificCalculator'));
  ok('calculators toolIds length=2', calcCat.toolIds.length === 2);
}

const filesCat = categoriesJson.find(c => c.id === 'files');
ok('files category exists', !!filesCat);
if (filesCat) {
  ok('files category includes inspectFileMetadata', filesCat.toolIds.includes('inspectFileMetadata'));
  ok('files category includes encryptDecryptFile', filesCat.toolIds.includes('encryptDecryptFile'));
}

const imagesCat = categoriesJson.find(c => c.id === 'images');
ok('images category exists', !!imagesCat);
if (imagesCat) {
  ok('images category includes photoLocationExtractor', imagesCat.toolIds.includes('photoLocationExtractor'));
}

const textCat = categoriesJson.find(c => c.id === 'text');
ok('text category exists', !!textCat);
if (textCat) {
  ok('text category includes textToUnicodeBraille', textCat.toolIds.includes('textToUnicodeBraille'));
}

const docsCat = categoriesJson.find(c => c.id === 'documents');
ok('documents category exists', !!docsCat);
if (docsCat) {
  ok('documents category includes formatDocumentApa7', docsCat.toolIds.includes('formatDocumentApa7'));
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
  'js/math/expression-parser.js',
  'js/accessibility/braille-es.js',
  'js/security/local-encryption.js',
  'js/metadata/photo-location.js',
  'js/documents/apa7-formatter.js',
];

for (const f of moduleFiles) {
  ok(`${f} exists`, distExists(f));
}

// ═══════════════════════════════════════════════════
// 6. Tool Pages Load Module Scripts
// ═══════════════════════════════════════════════════
console.log('\n=== 6. Tool Pages Load Module Scripts ===\n');

const scriptLoads = [
  { page: 'calculadora-simple.html', script: 'expression-parser.js' },
  { page: 'calculadora-cientifica.html', script: 'expression-parser.js' },
  { page: 'texto-a-braille-unicode.html', script: 'braille-es.js' },
  { page: 'cifrar-descifrar-archivo.html', script: 'local-encryption.js' },
  { page: 'extraer-ubicacion-foto.html', script: 'photo-location.js' },
  { page: 'formato-apa-7.html', script: 'apa7-formatter.js' },
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

ok('index.html has calculators filter chip', indexHtml.includes('data-category="calculators"'));

// ═══════════════════════════════════════════════════
// 9. tool-processors.js Has Processors
// ═══════════════════════════════════════════════════
console.log('\n=== 9. tool-processors.js Has Processors ===\n');

const tpJs = readDist('js/tool-processors.js');

for (const t of NEW_TOOLS) {
  ok(`tool-processors.js has ${t.toolId} processor`, tpJs.includes(`window.ToolProcessors.${t.toolId}`));
}

ok('tool-processors.js has _encryptFile internal processor', tpJs.includes('window.ToolProcessors._encryptFile'));
ok('tool-processors.js has _decryptFile internal processor', tpJs.includes('window.ToolProcessors._decryptFile'));
ok('tool-processors.js has _factorial internal helper', tpJs.includes('window.ToolProcessors._factorial'));

// ═══════════════════════════════════════════════════
// 10. smart-search.js Has Entries
// ═══════════════════════════════════════════════════
console.log('\n=== 10. smart-search.js Has Entries ===\n');

const ssJs = readDist('js/smart-search.js');

for (const t of NEW_TOOLS) {
  ok(`smart-search.js ACTIONS has ${t.toolId}`, ssJs.includes(`${t.toolId}:`));
}

ok("smart-search.js SYNONYMS has 'encriptar' mapping", ssJs.includes("'encriptar'"));
ok("smart-search.js SYNONYMS has 'desencriptar' mapping", ssJs.includes("'desencriptar'"));
ok('smart-search.js INTENT_PATTERNS has braille pattern', /braille|puntos.*ceguera|accesibilidad.*visual/.test(ssJs));
ok('smart-search.js INTENT_PATTERNS has apa pattern', /formato.*apa|normas.*apa|trabajo.*acad.mico|ensayo.*apa/.test(ssJs));
ok('smart-search.js categoryNames has calculators', ssJs.includes("calculators: 'Calculadoras'"));

// ═══════════════════════════════════════════════════
// 11. calculadoras.html Category Page
// ═══════════════════════════════════════════════════
console.log('\n=== 11. calculadoras.html Category Page ===\n');

ok('dist/calculadoras.html exists', distExists('calculadoras.html'));

const calcHtml = readDist('calculadoras.html');
ok('calculadoras.html has "Calculadoras" in title', calcHtml.includes('Calculadoras'));
ok('calculadoras.html has links to calculadora-simple.html', calcHtml.includes('calculadora-simple.html'));
ok('calculadoras.html has links to calculadora-cientifica.html', calcHtml.includes('calculadora-cientifica.html'));

// ═══════════════════════════════════════════════════
// 12. Module JS Syntax Validation
// ═══════════════════════════════════════════════════
console.log('\n=== 12. Module JS Syntax Validation ===\n');

const jsFiles = [
  'js/math/expression-parser.js',
  'js/accessibility/braille-es.js',
  'js/security/local-encryption.js',
  'js/metadata/photo-location.js',
  'js/documents/apa7-formatter.js',
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
