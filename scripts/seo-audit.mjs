#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'src', 'data');

function loadJSON(name) {
  return JSON.parse(readFileSync(join(DATA, name), 'utf-8'));
}

const site = loadJSON('site.config.json');
const tools = loadJSON('tools.json');
const categories = loadJSON('categories.json');
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf-8');
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf-8');

let errors = 0;
let warnings = 0;
let passed = 0;

function error(msg) { console.error(`  ✗ ERROR: ${msg}`); errors++; }
function warn(msg) { console.warn(`  ⚠ WARN: ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✓ ${msg}`); passed++; }

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  return m ? m[1] : null;
}

function countH1(html) {
  const matches = html.match(/<h1[\s>]/gi);
  return matches ? matches.length : 0;
}

function hasBreadcrumbs(html) {
  return html.includes('aria-label="Ruta de navegación"') || html.includes('breadcrumbs');
}

function hasNoindex(html) {
  const m = html.match(/<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["']/i);
  return !!m;
}

const indexablePages = [];
const allSlugs = [];
const knownSiteUrls = new Set([
  `${site.siteUrl}/`,
  `${site.siteUrl}/toolisto`,
  `${site.siteUrl}/about/`,
  `${site.siteUrl}/ordia/`,
  `${site.siteUrl}/workspace/`,
  `${site.siteUrl}/contact/`,
  `${site.siteUrl}/privacy/`,
  `${site.siteUrl}/terms/`,
  ...['privacidad', 'condiciones', 'apoyar'].map((slug) => `${site.siteUrl}/${slug}.html`),
]);

const htmlFiles = readdirSync(DIST).filter(f => f.endsWith('.html') && f !== '404.html');
const toolPages = htmlFiles.filter(f => tools.some(t => t.slug + '.html' === f));
const catPages = htmlFiles.filter(f => categories.some(c => c.slug + '.html' === f));

console.log(`\n=== SEO AUDIT ===`);
console.log(`HTML pages: ${htmlFiles.length} (${toolPages.length} tools, ${catPages.length} categories, 1 404)\n`);

console.log('--- TOOL PAGES ---');
toolPages.forEach(file => {
  const slug = basename(file, '.html');
  const html = readFileSync(join(DIST, file), 'utf-8');
  const tool = tools.find(t => t.slug === slug);
  if (!tool) { error(`${file}: no matching tool in tools.json`); return; }

  console.log(`\n📄 ${slug}`);

  if (!tool.enabled) {
    if (hasNoindex(html)) pass(`${slug}: disabled page has noindex`);
    else error(`${slug}: tool is disabled but page is indexable`);
  } else {
    if (!tool.indexable) { error(`${slug}: tool is not indexable but page exists`); }
    if (!tool.enabledInSitemap) { warn(`${slug}: tool not in sitemap`); }
  }

  const title = extractTitle(html);
  if (!title) error(`${slug}: missing <title>`); else pass(`title: "${title}"`);

  const desc = extractMeta(html, 'description');
  if (!desc) error(`${slug}: missing meta description`); else pass(`meta description present (${desc.length} chars)`);

  const h1Count = countH1(html);
  if (h1Count === 0) error(`${slug}: no H1 found`);
  else if (h1Count > 1) error(`${slug}: multiple H1s (${h1Count})`);
  else pass(`exactly 1 H1`);

  const canonical = extractCanonical(html);
  if (!canonical) error(`${slug}: missing canonical`);
  else if (!canonical.includes(site.siteUrl)) error(`${slug}: canonical does not contain siteUrl: ${canonical}`);
  else if (canonical !== site.siteUrl + '/' + slug + '.html') error(`${slug}: canonical does not match deployed URL: ${canonical}`);
  else pass(`canonical: ${canonical}`);

  const ogTitle = extractMeta(html, 'og:title');
  if (!ogTitle) error(`${slug}: missing og:title`); else pass(`og:title present`);

  const ogDesc = extractMeta(html, 'og:description');
  if (!ogDesc) error(`${slug}: missing og:description`); else pass(`og:description present`);

  const ogUrl = extractMeta(html, 'og:url');
  if (!ogUrl) error(`${slug}: missing og:url`);
  else if (ogUrl !== site.siteUrl + '/' + slug + '.html') error(`${slug}: og:url mismatch: ${ogUrl}`);
  else pass(`og:url correct`);

  if (!hasBreadcrumbs(html)) error(`${slug}: missing breadcrumbs`); else pass(`breadcrumbs present`);

  if (!html.includes('tool-page-config')) error(`${slug}: missing tool-page-config`); else pass(`tool-page-config present`);

  if (!html.includes('dropZone')) error(`${slug}: missing drop zone`); else pass(`drop zone present`);

  const inSitemap = sitemap.includes(site.siteUrl + '/' + slug + '.html');
  if (tool.enabled && !inSitemap && tool.enabledInSitemap) error(`${slug}: not in sitemap.xml`);
  else if (tool.enabled && inSitemap) pass(`in sitemap.xml`);
  else if (!tool.enabled && inSitemap) error(`${slug}: disabled tool present in sitemap`);
  else if (!tool.enabled) pass(`${slug}: excluded from sitemap`);

  if (tool.enabled && tool.indexable && tool.enabledInSitemap) indexablePages.push(slug);
  allSlugs.push(slug);
});

console.log('\n--- CATEGORY PAGES ---');
catPages.forEach(file => {
  const slug = basename(file, '.html');
  const html = readFileSync(join(DIST, file), 'utf-8');
  console.log(`\n📂 ${slug}`);

  const title = extractTitle(html);
  if (!title) error(`${slug}: missing <title>`); else pass(`title: "${title}"`);

  const desc = extractMeta(html, 'description');
  if (!desc) error(`${slug}: missing meta description`); else pass(`meta description present`);

  const h1Count = countH1(html);
  if (h1Count === 0) error(`${slug}: no H1 found`);
  else if (h1Count > 1) error(`${slug}: multiple H1s (${h1Count})`);
  else pass(`exactly 1 H1`);

  const canonical = extractCanonical(html);
  if (!canonical) error(`${slug}: missing canonical`);
  else if (canonical !== site.siteUrl + '/' + slug + '.html') error(`${slug}: canonical does not match deployed URL: ${canonical}`);
  else pass(`canonical: ${canonical}`);

  const ogUrl = extractMeta(html, 'og:url');
  if (!ogUrl) error(`${slug}: missing og:url`);
  else if (ogUrl !== site.siteUrl + '/' + slug + '.html') error(`${slug}: og:url mismatch: ${ogUrl}`);
  else pass(`og:url correct`);

  if (!hasBreadcrumbs(html)) error(`${slug}: missing breadcrumbs`); else pass(`breadcrumbs present`);

  const toolLinks = (html.match(/href="\.\/[^"]*\.html"/g) || []).length;
  if (toolLinks < 3) warn(`${slug}: only ${toolLinks} tool links (aim for 3+)`);
  else pass(`${toolLinks} tool links`);

  const inSitemap = sitemap.includes(site.siteUrl + '/' + slug + '.html');
  if (inSitemap) pass(`in sitemap.xml`); else warn(`${slug}: not in sitemap.xml`);

  indexablePages.push(slug);
  allSlugs.push(slug);
});

// Páginas de sitio propias (fuera de herramientas/categorías) presentes en sitemap.xml
['privacidad', 'condiciones', 'apoyar'].forEach((s) => allSlugs.push(s));

console.log('\n--- 404 PAGE ---');
const html404 = readFileSync(join(DIST, '404.html'), 'utf-8');
if (hasNoindex(html404)) pass('404 has noindex'); else error('404 missing noindex');
if (html404.includes('404')) pass('404 shows error code'); else error('404 missing error display');

console.log('\n--- TOOLISTO CATALOGUE ---');
const toolistoPath = join(DIST, 'toolisto.html');
if (!existsSync(toolistoPath)) {
  error('toolisto.html: missing catalogue');
} else {
  const toolistoHtml = readFileSync(toolistoPath, 'utf-8');
  if (extractCanonical(toolistoHtml) === `${site.siteUrl}/toolisto`) pass('toolisto: canonical correct');
  else error(`toolisto: canonical mismatch (${extractCanonical(toolistoHtml) || 'missing'})`);
  if (extractMeta(toolistoHtml, 'og:url') === `${site.siteUrl}/toolisto`) pass('toolisto: og:url correct');
  else error(`toolisto: og:url mismatch (${extractMeta(toolistoHtml, 'og:url') || 'missing'})`);
  if (countH1(toolistoHtml) === 1) pass('toolisto: exactly 1 H1');
  else error(`toolisto: expected 1 H1, found ${countH1(toolistoHtml)}`);
}

console.log('\n--- GLOBAL CHECKS ---');

const titles = indexablePages.map(s => {
  const html = readFileSync(join(DIST, s + '.html'), 'utf-8');
  return { slug: s, title: extractTitle(html) };
});
const dupTitles = titles.filter((t, i) => titles.findIndex(x => x.title === t.title) !== i);
if (dupTitles.length) error(`Duplicate titles: ${dupTitles.map(d => d.slug + ' → ' + d.title).join(', ')}`);
else pass('No duplicate titles');

const descs = indexablePages.map(s => {
  const html = readFileSync(join(DIST, s + '.html'), 'utf-8');
  return { slug: s, desc: extractMeta(html, 'description') };
});
const dupDescs = descs.filter((d, i) => descs.findIndex(x => x.desc === d.desc) !== i);
if (dupDescs.length) warn(`Similar descriptions: ${dupDescs.map(d => d.slug).join(', ')}`);
else pass('No duplicate descriptions');

const canonicals = indexablePages.map(s => {
  const html = readFileSync(join(DIST, s + '.html'), 'utf-8');
  return extractCanonical(html);
}).filter(Boolean);
const dupCanonicals = canonicals.filter((c, i) => canonicals.indexOf(c) !== i);
if (dupCanonicals.length) error(`Duplicate canonicals: ${dupCanonicals.join(', ')}`);
else pass('No duplicate canonicals');

const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
const missingFromSitemap = indexablePages.filter(s => !sitemapUrls.includes(site.siteUrl + '/' + s + '.html'));
if (missingFromSitemap.length) error(`Missing from sitemap: ${missingFromSitemap.join(', ')}`);
else pass('All indexable pages in sitemap');

const extraInSitemap = sitemapUrls.filter(u => !allSlugs.some(s => u === site.siteUrl + '/' + s + '.html') && !knownSiteUrls.has(u));
if (extraInSitemap.length) warn(`In sitemap but no page: ${extraInSitemap.join(', ')}`);

const orphanPages = allSlugs.filter(s => {
  const html = readFileSync(join(DIST, s + '.html'), 'utf-8');
  return !sitemapUrls.includes(site.siteUrl + '/' + s + '.html') && !html.includes('noindex');
});
if (orphanPages.length) warn(`Possible orphan pages (not in sitemap): ${orphanPages.join(', ')}`);

const disallowRules = robots.split(/\r?\n/).filter((line) => /^Disallow:/i.test(line.trim()));
if (disallowRules.length) warn(`robots.txt contains unexpected Disallow rules: ${disallowRules.join(', ')}`);
else pass('robots.txt has no Disallow rules (full public crawl allowed)');

console.log(`\n=== RESULTS ===`);
console.log(`  Passed:   ${passed}`);
console.log(`  Errors:   ${errors}`);
console.log(`  Warnings: ${warnings}`);

if (errors > 0) {
  console.error(`\n✗ AUDIT FAILED with ${errors} error(s)`);
  process.exit(1);
} else {
  console.log(`\n✓ AUDIT PASSED`);
}
