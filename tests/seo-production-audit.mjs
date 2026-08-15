import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const data = join(root, 'src', 'data');
const artifact = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-seo-production-audit-evidence.json');
const site = JSON.parse(readFileSync(join(data, 'site.config.json'), 'utf8'));
const tools = JSON.parse(readFileSync(join(data, 'tools.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(data, 'categories.json'), 'utf8'));
const failures = [];
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i').exec(html)?.[0];
  return tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] || '' : '';
}

function canonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] || '';
}

function pageFor(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/toolisto' || pathname === '/toolisto/') return join(dist, 'toolisto.html');
  return join(dist, pathname.replace(/^\/+/, ''));
}

const expectedToolistoUrls = [
  `${site.siteUrl}/toolisto`,
  ...['privacidad', 'condiciones', 'apoyar'].map(slug => `${site.siteUrl}/${slug}.html`),
  ...categories.filter(category => category.enabled).map(category => `${site.siteUrl}/${category.slug}.html`),
  ...tools.filter(tool => tool.enabled && tool.indexable && tool.enabledInSitemap).map(tool => `${site.siteUrl}/${tool.slug}.html`)
];

assert(existsSync(join(dist, 'sitemap.xml')), 'Falta dist/sitemap.xml');
assert(existsSync(join(dist, 'robots.txt')), 'Falta dist/robots.txt');
const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap.xml no declara el namespace estándar');
assert(new Set(sitemapUrls).size === sitemapUrls.length, 'sitemap.xml contiene URLs duplicadas');
for (const url of expectedToolistoUrls) assert(sitemapUrls.includes(url), `Falta en sitemap Toolisto: ${url}`);

const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
assert(/User-agent:\s*\*/i.test(robots), 'robots.txt no define User-agent: *');
assert(/^Allow:\s*\/$/mi.test(robots), 'robots.txt no permite la raíz');
assert(new RegExp(`^Sitemap:\\s*${site.siteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/sitemap\\.xml$`, 'mi').test(robots), 'robots.txt no referencia el sitemap canónico');

for (const url of expectedToolistoUrls) {
  const file = pageFor(url);
  assert(existsSync(file), `El sitemap referencia una página ausente: ${url}`);
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  const description = meta(html, 'description');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() || '';
  assert(canonical(html) === url, `Canonical incorrecto en ${url}`);
  assert(meta(html, 'robots').toLowerCase() === 'index, follow', `robots indexable incorrecto en ${url}`);
  assert(title.length >= 15 && title.length <= 70, `Title fuera de rango (15-70) en ${url}`);
  assert(description.length >= 50 && description.length <= 160, `Description fuera de rango (50-160) en ${url}`);
  assert(meta(html, 'og:title') === title, `og:title no coincide con title en ${url}`);
  assert(meta(html, 'og:description') === description, `og:description no coincide con description en ${url}`);
  assert(meta(html, 'og:url') === url, `og:url incorrecto en ${url}`);
  assert(meta(html, 'og:image').startsWith(`${site.siteUrl}/`), `og:image no es una URL local absoluta en ${url}`);
  assert(meta(html, 'twitter:card') === 'summary_large_image', `twitter:card incorrecta en ${url}`);
  assert(meta(html, 'twitter:title') === title, `twitter:title no coincide con title en ${url}`);
  assert(meta(html, 'twitter:description') === description, `twitter:description no coincide con description en ${url}`);
  assert(meta(html, 'twitter:image') === meta(html, 'og:image'), `twitter:image no coincide con og:image en ${url}`);
}

const evidence = {
  gate: 'seo-production-audit',
  result: failures.length ? 'FAIL' : 'PASS',
  checks,
  failed: failures.length,
  sitemapUrls: sitemapUrls.length,
  toolPages: tools.filter(tool => tool.enabled && tool.indexable && tool.enabledInSitemap).length,
  categoryPages: categories.filter(category => category.enabled).length,
  toolistoUrls: expectedToolistoUrls.length,
  failures
};
writeEvidence(artifact, evidence);

if (failures.length) {
  console.error(`SEO Production Audit: ${checks - failures.length}/${checks} PASS`);
  failures.forEach(failure => console.error(`  FAIL: ${failure}`));
  process.exit(1);
}
console.log(`SEO Production Audit: ${checks}/${checks} PASS (${sitemapUrls.length} URLs indexables)`);
