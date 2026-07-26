const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const toolsPath = join(root, 'src', 'data', 'tools.json');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== SEO Functional Test ===\n');

if (!existsSync(toolsPath)) { fail('tools.json no existe'); process.exit(1); }
const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));

// Check main page SEO
const distIndex = join(root, 'dist', 'index.html');
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');

  if (!html.includes('<title>')) fail('Tag title faltante');
  else pass('Tag title presente');

  if (!html.includes('meta name="description"')) fail('Meta description faltante');
  else pass('Meta description presente');

  if (!html.includes('meta name="viewport"')) fail('Meta viewport faltante');
  else pass('Meta viewport presente');

  if (!html.includes('lang="es"')) fail('Attribute lang faltante');
  else pass('Attribute lang="es" presente');

  // Check semantic HTML
  if (!html.includes('<main')) fail('Elemento <main> faltante');
  else pass('Elemento <main> presente');

  if (!html.includes('<header')) fail('Elemento <header> faltante');
  else pass('Elemento <header> presente');

  if (!html.includes('<footer')) fail('Elemento <footer> faltante');
  else pass('Elemento <footer> presente');

  if (!html.includes('<nav')) fail('Elemento <nav> faltante');
  else pass('Elemento <nav> presente');

  // Check heading hierarchy
  if (!html.includes('<h1>')) fail('Tag <h1> faltante');
  else pass('Tag <h1> presente');

} else {
  fail('dist/index.html no existe');
}

// Check tool pages SEO (flat structure: dist/{slug}.html)
const distDir = join(root, 'dist');
if (existsSync(distDir)) {
  let pagesChecked = 0;
  let pagesFailed = 0;
  for (const tool of tools) {
    const pagePath = join(distDir, `${tool.slug}.html`);
    if (!existsSync(pagePath)) {
      fail(`${tool.toolId}: página faltante (dist/${tool.slug}.html)`);
      pagesFailed++;
      continue;
    }
    const pageHtml = readFileSync(pagePath, 'utf8');

    if (!pageHtml.includes('<title>')) fail(`${tool.toolId}: title faltante`);
    else pagesChecked++;

    if (!pageHtml.includes('meta name="description"')) fail(`${tool.toolId}: meta description faltante`);
    else pagesChecked++;

    if (!pageHtml.includes(`<script type="application/json" id="tool-page-config">`)) {
      fail(`${tool.toolId}: tool-page-config faltante`);
    } else if (!pageHtml.includes(`"toolId":"${tool.toolId}"`)) {
      fail(`${tool.toolId}: toolId no coincide en config`);
    } else {
      pagesChecked++;
    }
  }
  if (pagesChecked > 0) pass(`${pagesChecked} verificaciones SEO en páginas de herramientas (${tools.length - pagesFailed} páginas)`);
} else {
  fail('dist/ no existe');
}

// Check sitemap.xml
const sitemapPath = join(root, 'dist', 'sitemap.xml');
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  if (!sitemap.includes('<?xml')) fail('sitemap.xml no es XML válido');
  else pass('sitemap.xml es XML válido');

  const urlCount = (sitemap.match(/<url>/g) || []).length;
  if (urlCount < tools.length) {
    fail(`sitemap.xml tiene ${urlCount} URLs vs ${tools.length} herramientas`);
  } else {
    pass(`sitemap.xml tiene ${urlCount} URLs`);
  }

  let missingSlugs = 0;
  for (const tool of tools) {
    if (!sitemap.includes(tool.slug)) {
      fail(`${tool.toolId}: slug no en sitemap`);
      missingSlugs++;
    }
  }
  if (missingSlugs === 0) pass(`Todos los slugs en sitemap`);
} else {
  fail('dist/sitemap.xml no existe');
}

console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
