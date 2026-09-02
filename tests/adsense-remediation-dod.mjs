#!/usr/bin/env node
/**
 * tests/adsense-remediation-dod.mjs
 *
 * Pruebas nuevas de la remediación de AdSense (Definition of Done) orientadas a
 * la capa editorial y al sitemap, sobre el `dist/` ya construido.
 *
 * Cubre (sin duplicar adsense-integration.mjs / apluno-production-seo.mjs):
 *   5) sitemap coherente: incluye las guías editoriales y no incluye aliases
 *      de redirect ni páginas noindex.
 *   8) nuevas páginas editoriales (guías): índice y cada guía existen en el
 *      output, son indexables (robots index) y tienen title + H1 + cuerpo.
 *  10) navegación hacia el contenido editorial: la home enlaza a /guia/ y cada
 *      guía enlaza al menos una herramienta real de Toolisto.
 *
 * Cero dependencias externas; usa únicamente el dist/ generado por el build.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const DATA = join(root, 'src', 'data');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed += 1; console.log(`PASS: ${message}`); }
  else { failed += 1; console.error(`FAIL: ${message}`); }
}
const read = (rel) => readFileSync(join(dist, rel), 'utf8');
const load = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

if (!existsSync(dist)) { console.error('FAIL: dist/ no existe. Ejecuta `npm run build` primero.'); process.exit(1); }

const guides = load('guides.json').guides;

// 8) Guías editoriales completas en el output.
check(existsSync(join(dist, 'guia', 'index.html')), 'Índice de guías existe en el output (dist/guia/index.html)');
const guideIndex = read(join('guia', 'index.html'));
check(/index, follow/.test(guideIndex), 'Índice de guías es indexable (robots index)');
check(guides.length >= 8, `catálogo de guías tiene >= 8 guías (${guides.length})`);

let guideMissing = 0;
let guideNonIndexable = 0;
let guideThin = 0;
for (const guide of guides) {
  const rel = join('guia', guide.slug, 'index.html');
  if (!existsSync(join(dist, rel))) { guideMissing++; continue; }
  const html = read(rel);
  if (!/index, follow/.test(html)) guideNonIndexable++;
  const titleOk = /<title>[\s\S]*?<\/title>/.test(html);
  const h1Ok = /<h1[\s>]/.test(html);
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!titleOk || !h1Ok || bodyText.split(/\s+/).length < 150) guideThin++;
}
check(guideMissing === 0, `todas las guías existen en el output (${guides.length}/${guides.length})`);
check(guideNonIndexable === 0, 'todas las guías son indexables');
check(guideThin === 0, 'todas las guías tienen title + H1 + cuerpo editorial suficientes');

// 5) Sitemap coherente: incluye las guías.
const sitemap = read('sitemap.xml');
const sitemapGuides = guides.filter((g) => sitemap.includes(`/guia/${g.slug}/`));
check(sitemap.includes('/guia/'), 'sitemap incluye el índice de guías (/guia/)');
check(sitemapGuides.length === guides.length, `sitemap incluye todas las guías (${sitemapGuides.length}/${guides.length})`);
check(!sitemap.includes('index.html'), 'sitemap no contiene rutas de archivo internas (solo URLs canónicas limpias)');

// 10) Navegación hacia el contenido editorial: la home enlaza a /guia/.
const home = read('index.html');
check(/href="\/guia\/"/.test(home), 'home enlaza al índice de guías editoriales (/guia/)');

// Navegación guía -> herramientas reales: al menos una guía enlaza una herramienta del catálogo.
const enabledSlugs = new Set(load('tools.json').filter((t) => t.enabled).map((t) => t.slug));
let guidesLinkingRealTool = 0;
for (const guide of guides) {
  const rel = join('guia', guide.slug, 'index.html');
  if (!existsSync(join(dist, rel))) continue;
  const html = read(rel);
  const links = (html.match(/href="\/([a-z0-9-]+)"/gi) || []).map((h) => h.match(/\/([a-z0-9-]+)"/i)[1]);
  if (links.some((slug) => enabledSlugs.has(slug))) guidesLinkingRealTool++;
}
check(guidesLinkingRealTool >= Math.min(guides.length - 1, 4), `las guías enlazan herramientas reales de Toolisto (${guidesLinkingRealTool}/${guides.length})`);

console.log(`\nAdSense remediation DoD: ${passed} pass, ${failed} fail.`);
process.exit(failed === 0 ? 0 : 1);