import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const ROOT = join(import.meta.dirname, '..');

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function read(p) { return readFileSync(p, 'utf-8'); }

function toolPages() {
  const results = [];
  for (const f of readdirSync(DIST, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith('.html') || f.name === 'index.html' || f.name === '404.html') continue;
    const fp = join(DIST, f.name);
    const html = read(fp);
    if (html.includes('tool-page-config')) results.push({ file: f.name, html });
  }
  return results;
}

function extractScripts(html) {
  return [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g)].map(m => ({
    path: m[1],
    hasDefer: m[0].includes('defer'),
    full: m[0]
  }));
}

function scriptsByCategory() {
  const byCategory = {};
  const tools = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf-8'));
  for (const tool of tools) {
    if (!tool.enabled) continue;
    const cat = tool.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(tool);
  }
  return byCategory;
}

console.log('=== Performance & Loading Regression Tests ===\n');

// ── 1. All external scripts must have defer ──
console.log('--- 1. Defer attribute on all scripts ---');
const pages = toolPages();
for (const p of pages.slice(0, 20)) {
  const scripts = extractScripts(p.html);
  const blocked = scripts.filter(s => !s.hasDefer && s.path.endsWith('.js'));
  check(`${p.file}: all scripts deferred`, blocked.length === 0,
    blocked.length ? `blocked: ${blocked.map(s => s.path).join(', ')}` : '');
}

// Also check catalog, 404, legal pages
for (const f of ['toolisto.html', '404.html', 'privacidad.html', 'condiciones.html', 'apoyar.html']) {
  const fp = join(DIST, f);
  if (!existsSync(fp)) continue;
  const html = read(fp);
  const scripts = extractScripts(html);
  const blocked = scripts.filter(s => !s.hasDefer && s.path.endsWith('.js'));
  check(`${f}: all scripts deferred`, blocked.length === 0,
    blocked.length ? `blocked: ${blocked.map(s => s.path).join(', ')}` : '');
}

// ── 2. Category-specific script loading ──
console.log('\n--- 2. Category-specific vendor adapters ---');
const ADAPTER_MAP = {
  qrcodes: ['qrcode-gen.js', 'barcode-gen.js', 'jsqr.js'],
  pdf: ['pdf-ocr-engine.js', 'pdf-censor-engine.js', 'pdf-encryptor.js'],
  images: ['photo-location.js'],
  text: ['braille-es.js'],
  calculators: ['expression-parser.js']
};

const MODE_MAP = {
  qrcodes: ['qr.js'],
  spreadsheets: ['excel.js'],
  files: ['file.js'],
  calculators: ['calc.js'],
  documents: ['structure.js'],
  text: ['structure.js'],
  ebooks: ['structure.js']
};

const ALL_ADAPTERS = ['qrcode-gen.js', 'barcode-gen.js', 'jsqr.js', 'pdf-ocr-engine.js',
  'pdf-censor-engine.js', 'pdf-encryptor.js', 'expression-parser.js', 'braille-es.js', 'photo-location.js'];
const ALL_MODES = ['calc.js', 'structure.js', 'file.js', 'qr.js', 'excel.js'];

const catTools = scriptsByCategory();
const sampledPages = [];
for (const [cat, tools] of Object.entries(catTools)) {
  if (tools.length > 0) sampledPages.push({ cat, tool: tools[0] });
}

for (const { cat, tool } of sampledPages) {
  const fp = join(DIST, `${tool.slug}.html`);
  if (!existsSync(fp)) continue;
  const html = read(fp);
  const scriptPaths = extractScripts(html).map(s => s.path);

  const expectedAdapters = ADAPTER_MAP[cat] || [];
  const unexpectedAdapters = ALL_ADAPTERS.filter(a => !expectedAdapters.includes(a) && scriptPaths.some(sp => sp.includes(a)));
  const missingAdapters = expectedAdapters.filter(a => !scriptPaths.some(sp => sp.includes(a)));

  check(`${tool.slug} (${cat}): no unexpected adapters`,
    unexpectedAdapters.length === 0,
    unexpectedAdapters.length ? `should not load: ${unexpectedAdapters.join(', ')}` : '');

  check(`${tool.slug} (${cat}): has expected adapters`,
    missingAdapters.length === 0,
    missingAdapters.length ? `missing: ${missingAdapters.join(', ')}` : '');

  const expectedModes = MODE_MAP[cat] || [];
  const unexpectedModes = ALL_MODES.filter(m => !expectedModes.includes(m) && scriptPaths.some(sp => sp.includes(m)));
  const missingModes = expectedModes.filter(m => !scriptPaths.some(sp => sp.includes(m)));

  check(`${tool.slug} (${cat}): no unexpected modes`,
    unexpectedModes.length === 0,
    unexpectedModes.length ? `should not load: ${unexpectedModes.join(', ')}` : '');

  check(`${tool.slug} (${cat}): has expected modes`,
    missingModes.length === 0,
    missingModes.length ? `missing: ${missingModes.join(', ')}` : '');
}

// ── 3. Script count reduction ──
console.log('\n--- 3. Script count budget (max 12 per tool page) ---');
for (const p of pages) {
  const scripts = extractScripts(p.html).filter(s => s.path.endsWith('.js'));
  check(`${p.file}: ${scripts.length} scripts (max 12)`, scripts.length <= 12,
    scripts.length > 12 ? `has ${scripts.length} scripts` : '');
}

// ── 4. Core scripts always present ──
console.log('\n--- 4. Core scripts always present ---');
const CORE = ['file-limits.js', 'tool-processors.js', 'app.js', 'pwa-register.js'];
for (const p of pages.slice(0, 10)) {
  const scriptPaths = extractScripts(p.html).map(s => s.path);
  for (const core of CORE) {
    check(`${p.file}: has ${core}`, scriptPaths.some(sp => sp.includes(core)));
  }
}

// ── 5. CSS fetchpriority ──
console.log('\n--- 5. CSS fetchpriority="high" ---');
for (const p of pages.slice(0, 10)) {
  const hasHigh = p.html.includes('styles.css') && p.html.includes('fetchpriority="high"');
  check(`${p.file}: CSS fetchpriority="high"`, hasHigh);
}

// Also check non-tool pages
for (const f of ['toolisto.html', '404.html', 'privacidad.html']) {
  const fp = join(DIST, f);
  if (!existsSync(fp)) continue;
  const html = read(fp);
  const hasCssLink = html.includes('rel="stylesheet"');
  const hasHigh = hasCssLink && html.includes('fetchpriority="high"');
  check(`${f}: CSS fetchpriority="high"`, hasHigh);
}

// ── 6. No render-blocking scripts ──
console.log('\n--- 6. No render-blocking scripts ---');
for (const p of pages.slice(0, 10)) {
  const scripts = extractScripts(p.html);
  const renderBlocking = scripts.filter(s => s.path.endsWith('.js') && !s.hasDefer);
  check(`${p.file}: zero render-blocking scripts`, renderBlocking.length === 0,
    renderBlocking.length ? `blocking: ${renderBlocking.map(s => s.path).join(', ')}` : '');
}

// ── 7. No unused heavy components on non-PDF pages ──
console.log('\n--- 7. PDF components only on PDF tools ---');
const pdfPages = pages.filter(p => {
  const fp = join(DIST, p.file);
  const html = read(fp);
  return html.includes('pdf-page-navigator.js') || html.includes('pdf-result-viewer.js');
});
const nonPdfPages = pages.filter(p => !pdfPages.includes(p));
const pdfSample = nonPdfPages.filter(p => {
  const html = read(p.html, { encoding: 'utf-8' });
  return html.includes('pdf-page-navigator.js') || html.includes('pdf-result-viewer.js');
});

for (const p of nonPdfPages.slice(0, 15)) {
  const html = read(join(DIST, p.file), { encoding: 'utf-8' });
  const hasPdfNav = html.includes('pdf-page-navigator.js');
  const hasPdfViewer = html.includes('pdf-result-viewer.js');
  const isPdfTool = p.html.includes('pdf-ocr-engine.js') || p.html.includes('pdf-censor-engine.js') || p.html.includes('pdf-encryptor.js');
  if (!isPdfTool) {
    check(`${p.file}: no pdf-page-navigator`, !hasPdfNav);
    check(`${p.file}: no pdf-result-viewer`, !hasPdfViewer);
  }
}

// ── 8. mode-core only with modes ──
console.log('\n--- 8. mode-core.js only loaded when modes needed ---');
for (const p of pages) {
  const html = p.html;
  const scriptPaths = extractScripts(html).map(s => s.path);
  const hasModeCore = scriptPaths.some(sp => sp.includes('mode-core.js'));
  const hasAnyMode = ALL_MODES.some(m => scriptPaths.some(sp => sp.includes(m)));
  check(`${p.file}: mode-core matches mode usage`, hasModeCore === hasAnyMode,
    hasModeCore && !hasAnyMode ? 'mode-core loaded but no modes' : !hasModeCore && hasAnyMode ? 'modes loaded without mode-core' : '');
}

// ── 9. Workspace lazy-load: vendor libs NOT eagerly loaded ──
console.log('\n--- 9. Workspace lazy-load (CE-062) ---');
const wsHtmlPath = join(DIST, 'workspace', 'index.html');
if (existsSync(wsHtmlPath)) {
  const wsHtml = read(wsHtmlPath);
  check('workspace: pdf.min.js NOT eagerly loaded', !wsHtml.includes('pdfjs/pdf.min.js'));
  check('workspace: jszip.min.js NOT eagerly loaded', !wsHtml.includes('jszip/jszip.min.js'));
  check('workspace: lazy-loader.js IS present', wsHtml.includes('lazy-loader.js'));
  check('workspace: engine-loader.js IS present', wsHtml.includes('engine-loader.js'));
  check('workspace: all external scripts deferred or module', (() => {
    const scriptTags = [...wsHtml.matchAll(/<script([^>]*)>/gi)];
    const external = scriptTags.filter(s => s[1].includes('src'));
    return external.every(s => s[1].includes('defer') || s[1].includes('type="module"') || s[1].includes("type='module'"));
  })());

  // Verify lazy-loader.js defines expected functions
  const lazyPath = join(DIST, 'workspace', 'lazy-loader.js');
  if (existsSync(lazyPath)) {
    const lazy = read(lazyPath);
    check('workspace: lazy-loader defines __ensurePdfJs', lazy.includes('__ensurePdfJs'));
    check('workspace: lazy-loader defines __ensureJSZip', lazy.includes('__ensureJSZip'));
    check('workspace: lazy-loader defines __lazyLoadScript', lazy.includes('__lazyLoadScript'));
  } else {
    check('workspace: lazy-loader.js exists in dist', false, 'file not found');
  }
} else {
  console.log('  SKIPPED: workspace/index.html not found in dist');
}

// ── Summary ──
console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
