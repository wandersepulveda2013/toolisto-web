import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const SRC = join(import.meta.dirname, '..', 'src');

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function read(p) { return readFileSync(p, 'utf-8'); }

function htmlFiles(dir, depth = 0) {
  if (depth > 3) return [];
  const results = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const fp = join(dir, f.name);
    if (f.isDirectory()) results.push(...htmlFiles(fp, depth + 1));
    else if (f.name.endsWith('.html')) results.push(fp);
  }
  return results;
}

function toSlug(filePath) {
  let rel = relative(DIST, filePath).replace(/\\/g, '/').replace(/\.html$/, '');
  if (rel === 'index') rel = '';
  return rel;
}

const files = htmlFiles(DIST);
const htmlContents = new Map();
for (const f of files) htmlContents.set(f, read(f));

function extractTag(content, tag) {
  const m = content.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'i'));
  if (!m) return null;
  return m[0].replace(/<[^>]*>/g, '').trim();
}

function extractMeta(content, name) {
  const m = content.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : null;
}

function extractCanonical(content) {
  const m = content.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractRobots(content) {
  const m = content.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractLang(content) {
  const m = content.match(/<html[^>]*\slang=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractOgTitle(content) {
  const m = content.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractOgUrl(content) {
  const m = content.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractJsonLd(content) {
  const matches = [];
  const re = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(content)) !== null) matches.push(m[1].trim());
  return matches;
}

const SITE = 'https://apluno.com';

console.log('\n=== APLUNO Production SEO Regression Tests ===\n');

console.log('--- 1. Canonical Consistency ---');
const indexContent = htmlContents.get(join(DIST, 'index.html'));
check('homepage has canonical', extractCanonical(indexContent) === `${SITE}/`);
check('homepage canonical is HTTPS', extractCanonical(indexContent)?.startsWith('https://'));

const toolFiles = files.filter(f => {
  const name = basename(f, '.html');
  const content = htmlContents.get(f);
  const robots = extractRobots(content);
  return !['index', '404', 'offline'].includes(name) && !robots?.includes('noindex');
});

let canonicalMismatches = 0;
for (const f of toolFiles) {
  const content = htmlContents.get(f);
  const canonical = extractCanonical(content);
  const slug = toSlug(f);
  if (canonical && slug) {
    const expected = `${SITE}/${slug}`;
    if (canonical !== expected) canonicalMismatches++;
  }
}
check('canonical paths match file structure', canonicalMismatches === 0, `${canonicalMismatches} mismatches`);

console.log('\n--- 2. Sitemap Integrity ---');
const sitemap = read(join(DIST, 'sitemap.xml'));
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
check('sitemap has URLs', sitemapUrls.length > 200, `found ${sitemapUrls.length}`);
check('sitemap URLs are HTTPS', sitemapUrls.every(u => u.startsWith('https://')), `${sitemapUrls.filter(u => !u.startsWith('https://')).length} non-HTTPS`);
check('sitemap URLs use correct hostname', sitemapUrls.every(u => u.includes('apluno.com')), `${sitemapUrls.filter(u => !u.includes('apluno.com')).length} wrong hostname`);
check('sitemap has no duplicates', new Set(sitemapUrls).size === sitemapUrls.length, `${sitemapUrls.length - new Set(sitemapUrls).size} duplicates`);

const toolSlugs = sitemapUrls.filter(u => {
  const path = u.replace(SITE + '/', '');
  return path && !path.includes('/') && !['toolisto', 'privacidad', 'condiciones', 'apoyar'].includes(path);
});
check('sitemap has 202+ tool URLs', toolSlugs.length >= 202, `found ${toolSlugs.length}`);

console.log('\n--- 3. Robots.txt ---');
const robots = read(join(DIST, 'robots.txt'));
check('robots.txt exists', robots.length > 0);
check('robots.txt has sitemap declaration', robots.includes('Sitemap:'));
check('robots.txt allows all crawlers', robots.includes('Allow: /'));
check('robots.txt does not block tool pages', !robots.includes('Disallow: /comprimir') && !robots.includes('Disallow: /unir'));

console.log('\n--- 4. 404 Behavior ---');
const notFound = htmlContents.get(join(DIST, '404.html'));
check('404 has noindex', extractRobots(notFound)?.includes('noindex'));
check('404 has no canonical', !extractCanonical(notFound));
check('404 has es-419 lang', extractLang(notFound) === 'es-419');

console.log('\n--- 5. Title Uniqueness ---');
const titles = new Map();
for (const [f, content] of htmlContents) {
  const title = extractTag(content, 'title');
  if (title && !title.includes('Redirección a')) {
    const name = basename(f, '.html');
    if (titles.has(title)) {
      check(`duplicate title: "${title.substring(0, 50)}"`, false, `in ${name} and ${basename(titles.get(title), '.html')}`);
    } else {
      titles.set(title, f);
    }
  }
}
check('no duplicate titles among tool/category pages', true, `${titles.size} unique titles`);

console.log('\n--- 6. H1 Presence ---');
let missingH1 = 0;
for (const f of toolFiles) {
  const content = htmlContents.get(f);
  const h1 = extractTag(content, 'h1');
  if (!h1 || h1.length === 0) missingH1++;
}
check('all tool/category pages have H1', missingH1 === 0, `${missingH1} missing`);

console.log('\n--- 7. Tool Count Consistency ---');
const toolsJson = JSON.parse(read(join(SRC, 'data', 'tools.json')));
const enabledTools = toolsJson.filter(t => t.enabled !== false);
check('tools.json tool count matches 202', enabledTools.length === 202, `found ${enabledTools.length}`);

const homeContent = htmlContents.get(join(DIST, 'index.html'));
check('homepage references correct count', (homeContent || '').includes('202'));

const toolistoContent = htmlContents.get(join(DIST, 'toolisto.html'));
check('toolisto.html heroTrustCount is 202', toolistoContent?.includes('id="heroTrustCount">202'));
check('toolisto.html toolCountVisible is 202', toolistoContent?.includes('id="toolCountVisible">202'));

console.log('\n--- 8. No Stale "167" in Production ---');
let staleCount = 0;
for (const [, content] of htmlContents) {
  if (content.includes('>167<') || content.includes('>167 ') || content.includes(' 167 ')) staleCount++;
}
check('no stale "167" in generated HTML', staleCount === 0, `found ${staleCount} files`);

console.log('\n--- 9. Indexability Matrix ---');
let indexCount = 0;
let noindexCount = 0;
for (const [, content] of htmlContents) {
  const r = extractRobots(content);
  if (r?.includes('noindex')) noindexCount++;
  else indexCount++;
}
check('indexable pages exist', indexCount > 200, `found ${indexCount}`);
check('non-indexable pages are limited', noindexCount < 60, `found ${noindexCount}`);

console.log('\n--- 10. Language Consistency ---');
let badLang = 0;
for (const [f, content] of htmlContents) {
  const lang = extractLang(content);
  if (lang && lang !== 'es-419' && !f.includes('workspace')) badLang++;
}
check('all non-workspace pages use es-419', badLang === 0, `found ${badLang} with wrong lang`);

console.log('\n--- 11. JSON-LD Structured Data ---');
let schemaCount = 0;
for (const [, content] of htmlContents) {
  const schemas = extractJsonLd(content);
  schemaCount += schemas.length;
}
check('structured data exists on pages', schemaCount > 200, `found ${schemaCount} JSON-LD blocks`);

console.log('\n--- 12. Canonical Domain ---');
let wrongDomain = 0;
for (const [, content] of htmlContents) {
  const canonical = extractCanonical(content);
  if (canonical && !canonical.startsWith(SITE)) wrongDomain++;
}
check('all canonicals use correct domain', wrongDomain === 0, `found ${wrongDomain} wrong`);

console.log('\n--- 13. OG Tags ---');
let missingOg = 0;
for (const f of toolFiles.slice(0, 10)) {
  const content = htmlContents.get(f);
  if (!extractOgTitle(content) || !extractOgUrl(content)) missingOg++;
}
check('sample tool pages have OG tags', missingOg === 0, `${missingOg} missing`);

console.log('\n--- 14. Redirect Pages ---');
const redirectFiles = files.filter(f => {
  const name = basename(f, '.html');
  return name.includes('-to-') || name.includes('convert-') || ['merge-pdf', 'split-pdf', 'pdf-merge', 'pdf-split'].includes(name);
});
let redirectOk = 0;
for (const f of redirectFiles.slice(0, 5)) {
  const content = htmlContents.get(f);
  if (extractRobots(content)?.includes('noindex') && extractCanonical(content)) redirectOk++;
}
check('redirect pages have noindex + canonical', redirectOk === Math.min(5, redirectFiles.length), `${redirectOk}/${Math.min(5, redirectFiles.length)}`);

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
