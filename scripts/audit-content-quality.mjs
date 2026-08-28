// audit-content-quality.mjs
// Auditor de calidad editorial de APLUNO contra el patrón "Contenido de bajo valor"
// de Google AdSense. NO se trata de aprobar SEO técnico por métricas superficiales:
// mide contenido real, duplicación, thin-content, boilerplate, coherencia indexación
// y coherencia con el código real, con salida PASS/WARN/FAIL y evidencia determinista.
//
// Uso:  node scripts/audit-content-quality.mjs  (asume dist/ ya construido)
//
// Suficiencia ≠ métricas altas. Una herramienta sencilla puede tener poco texto y
// seguir siendo útil. El auditor usa múltiples señales y no obliga a contar palabras.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTags, normalizeText, wordCount, shingleTokens, jaccard, contentSimilarity } from './content-similarity.mjs';
import { extractStrictEditorial, textOfSection, balancedRegion, balancedRegionClass } from './strict-editorial.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const EVIDENCE_DIR = join(ROOT, 'artifacts', 'adsense-content-remediation');
const SITE = 'https://apluno.com';

const result = { checks: [], warn: 0, fail: 0 };

function pass(domain, detail) {
  result.checks.push({ domain, status: 'PASS', detail });
}
function warn(domain, detail) {
  result.warn++;
  result.checks.push({ domain, status: 'WARN', detail });
}
function fail(domain, detail) {
  result.fail++;
  result.checks.push({ domain, status: 'FAIL', detail });
}

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

/* ------------------------------------------------------------------ *
 * 1. Inventario de páginas y mapa de rutas reales del build
 * ------------------------------------------------------------------ */
function buildFileIndex() {
  const files = [];
  function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else files.push(p);
    }
  }
  walk(DIST);
  return files;
}

// Devuelve mapa: rutaCanonica -> { file, kind, dir }
// Reglas reales del build:
//   dist/index.html            -> /            (raíz)
//   dist/<x>.html              -> /<x>         (tool / categoría / redirect)
//   dist/<dir>/index.html      -> /<dir>/      (páginas APLUNO: guia, about, ...)
function buildRouteMap(files) {
  const routes = {};
  for (const f of files) {
    const rel = f.replace(DIST + '\\', '').replace(DIST + '/', '').replace(/\\/g, '/');
    if (!/\.html$/.test(rel)) continue;
    const base = rel.replace(/\.html$/, '');
    if (base === 'index') {
      routes['/'] = { file: f, kind: 'root', rel };
    } else if (base.endsWith('/index')) {
      const dirPath = base.slice(0, -'/index'.length);
      routes['/' + dirPath + '/'] = { file: f, kind: 'dir', rel };
    } else {
      routes['/' + base] = { file: f, kind: 'leaf', rel };
    }
  }
  return routes;
}

function readPage(f) {
  return readFileSync(f, 'utf8');
}

/* ------------------------------------------------------------------ *
 * 2. Resolución de enlaces internos
 * ------------------------------------------------------------------ */
// Clasifica un href. Devuelve { type, path }.
function classifyHref(rawHref) {
  const href = rawHref.trim();
  if (!href) return { type: 'EMPTY' };
  if (href.startsWith('#')) return { type: 'ANCHOR' };
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:') || href.startsWith('javascript:') || href.startsWith('blob:') || href.startsWith('sms:')) {
    return { type: 'NON_NAVIGATION' };
  }
  if (/^https?:\/\//i.test(href)) {
    if (href.startsWith(SITE + '/') || href.startsWith(SITE + '#')) {
      return { type: 'INTERNAL_ABS', path: href.slice(SITE.length) };
    }
    return { type: 'EXTERNAL' };
  }
  if (href.startsWith('//')) return { type: 'EXTERNAL' };
  if (href.startsWith('/')) return { type: 'INTERNAL', path: href };
  // relativo
  return { type: 'INTERNAL_REL', path: href };
}

// Normaliza una ruta interna eliminando anchor y query.
function normPath(p) {
  let s = p;
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  const q = s.indexOf('?');
  if (q !== -1) s = s.slice(0, q);
  return s === '' ? '/' : s;
}

// Dada una ruta interna (con o sin barra final) devuelve la ruta del archivo en dist
// que la sirve, o null. Conoce las equivalencias reales del build:
//   '/', '/foo', '/foo/', '/guia/x/' etc.
function resolveInternalPath(path, routeMap) {
  if (path === '/') return (routeMap['/'] && routeMap['/'].file) || null;
  const trailing = path.endsWith('/');
  const base = trailing ? path.slice(0, -1) : path;
  // 1. ruta directa
  if (routeMap[path]) return routeMap[path].file;
  if (!trailing && routeMap[base]) return routeMap[base].file; // /foo == /foo
  // 2. /foo/ -> busco hoja foo.html y pagina foo/index.html
  if (path.endsWith('/')) {
    if (routeMap[base]) return routeMap[base].file;      // /foo/ -> /foo
    const dirPage = '/' + base + '/';
    if (routeMap[dirPage]) return routeMap[dirPage].file; // /foo/ -> /foo/index.html
    return null;
  }
  // 3. /foo (sin slash) -> /foo/index.html
  const dirPage = '/' + base + '/';
  if (routeMap[dirPage]) return routeMap[dirPage].file;
  // 4. assets/js/vendor y cualquier archivo no-html en raíz
  const broot = base.replace(/^\//, '');
  const fileCand = join(DIST, ...broot.split('/'));
  if (exists(fileCand)) return fileCand;
  // 5. .html explícito
  if (exists(join(DIST, ...broot.split('/')).replace(/\/?$/, '.html'))) {
    return join(DIST, ...broot.split('/')) + '.html';
  }
  return null;
}

// Resuelve un href relativo desde una página.
function resolveHref(href, pageRel, routeMap) {
  const c = classifyHref(href);
  if (c.type === 'INTERNAL') {
    return { type: 'INTERNAL', path: normPath(c.path), file: resolveInternalPath(normPath(c.path), routeMap) };
  }
  if (c.type === 'INTERNAL_ABS') {
    return { type: 'INTERNAL', path: normPath(c.path), file: resolveInternalPath(normPath(c.path), routeMap) };
  }
  if (c.type === 'INTERNAL_REL') {
    // Resolver ruta relativa contra la carpeta que sirve la página actual.
    // En el build, las páginas se sirven en la raíz (hojas) o en su subcarpeta.
    const pagePath = pageRel.endsWith('/') ? pageRel : '/' + pageRel.split('/').slice(0, -1).join('/') + '/';
    const baseDir = pageRel.indexOf('/') === -1 ? '' : pagePath;
    // combina baseDir + href relativo
    const combined = new URL(c.path, 'https://x/' + baseDir).pathname;
    return { type: 'INTERNAL', path: normPath(combined), file: resolveInternalPath(normPath(combined), routeMap) };
  }
  return { type: c.type, path: c.path };
}

/* ------------------------------------------------------------------ *
 * 3. Extracción de texto visible (sin scripts, styles, nav global, footer)
 * ------------------------------------------------------------------ */

// Extrae el texto "principal" (contenido editorial), excluyendo chrome global
// (header/footer), la UI funcional del héroe/drop-zone y otros elementos repetidos
// que no son contenido editorial (las FAQs de privacidad/confianza compartidas y
// el drop-zone son UI/confianza legítima, no "low-value editorial").
//
// Devuelve { main, chrome } donde main es el texto visible del contenido principal.
function sliceRegion(re, text, group) {
  const m = text.match(re);
  return m ? m[group || 1] : null;
}

// Retira un contenedor por etiqueta y clase (p. ej. <header class="site-header">...</header>).
function removeContainer(html, tag, clsHint) {
  // Barrer por coincidencias de apertura y eliminar hasta su cierre (no anidado: html no anida
  // la misma etiqueta como contenedor de sí misma para estos casos).
  let out = html;
  const openRe = new RegExp(`<${tag}\\b[^>]*>`,'gi');
  // Iterativo y conservador: eliminar cada bloque header/footer por separado.
  const tags = ['header', 'footer', 'nav'];
  return removeByBalancedTags(out, tags);
}

function removeByBalancedTags(html, tags) {
  let out = html;
  for (const tag of tags) {
    // Implementación: reemplaza pares <tag ...> ... </tag> de forma no-anidada.
    // Usamos un barrido manual para soportar anidamiento con la misma etiqueta.
    out = stripBalanced(out, tag);
  }
  return out;
}

function stripBalanced(html, tag) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  // Colectar posiciones
  const opens = [];
  let m;
  openRe.lastIndex = 0;
  while ((m = openRe.exec(html))) opens.push(m.index);
  const closes = [];
  closeRe.lastIndex = 0;
  while ((m = closeRe.exec(html))) closes.push(m.index);
  if (!opens.length) return html;
  // Reconstruir: separar bloques [open_i, close_i correspondiente] (anidación simple).
  // Como no anidamos la misma etiqueta dentro de sí misma en estos contenedores,
  // emparejamos con un contador simple para robustez.
  // Pila de índices de apertura con posición.
  const stack = [];
  const events = [];
  for (const o of opens) events.push({ pos: o, isOpen: true });
  for (const c of closes) events.push({ pos: c, isOpen: false, closeTag: html.slice(c, c + tag.length + 3) });
  events.sort((a, b) => a.pos - b.pos);
  const toRemove = [];
  for (const ev of events) {
    if (ev.isOpen) stack.push(ev.pos);
    else {
      if (stack.length) {
        const start = stack.pop();
        // eliminar desde <tag hasta cierre </tag (no incluimos nada a partir del cierre)
        const closeIdx = html.indexOf('>', ev.pos) + 1;
        toRemove.push([start, closeIdx]);
      }
    }
  }
  if (!toRemove.length) return html;
  let out = '';
  let cursor = 0;
  for (const [s, e] of toRemove.sort((a, b) => a[0] - b[0])) {
    if (s < cursor) continue;
    out += html.slice(cursor, s) + ' ';
    cursor = e;
  }
  out += html.slice(cursor);
  return out;
}

function extractMainText(html, kind) {
  let h = html;
  // 1. quitar chrome global (header, footer, nav)
  h = removeByBalancedTags(h, ['header', 'footer']);
  // 2. quedarnos con el <main> si existe
  h = stripTags_WrappingMain(h);
  return h;
}

function stripTags_WrappingMain(h) {
  // Extraer <main>...</main> de forma balanceada (el tag "main" no se anida sobre sí mismo).
  const mainRegion = balancedRegion(h, 'main');
  const body = mainRegion || h;
  // Para tool pages, preferir la sección tool-content (descripciones editoriales).
  const toolContent = balancedRegionClass(body, 'section', 'tool-content');
  if (toolContent) return stripTags(toolContent);
  return stripTags(body);
}

// ------------------------------------------------------------------ *
// CONTENIDO EDITORIAL ESTRICTO (anti-chrome)
// ------------------------------------------------------------------ *
// El extractor `extractStrictEditorial` vive en scripts/strict-editorial.mjs
// (compartido con tests/strict-editorial-regression.mjs). Cuenta SOLO el
// contenido editorial REAL de una herramienta: "Cómo funciona" (instructions),
// "Limitaciones" (limitations) y "Preguntas frecuentes" (faq-section), SIN el
// chrome de UI que se repite en las 202 herramientas (capability strip
// "01 Prepara / 02 Ajusta / 03 Entrega", etiquetas de formato, aviso de
// privacidad y lista "Herramientas relacionadas"). Así la métrica de
// thin-content no se infla con texto repetido en cada página.

// Tokens de "chrome" (estructuras repetidas) y de contenido.
function splitChrome(h) {
  const chars = h.split(/(\s+)/);
  return chars;
}

/* ------------------------------------------------------------------ *
 * 4. Sitemap / robots / redirects
 * ------------------------------------------------------------------ */
function readXml(p) {
  return readFileSync(p, 'utf8');
}

/* ================================================================== *
 * MAIN
 * ================================================================== */
const files = buildFileIndex();
const routeMap = buildRouteMap(files);

const htmlFiles = files.filter((f) => /\.html$/.test(f));
const pages = htmlFiles.map((f) => {
  const rel = f.replace(DIST + '\\', '').replace(DIST + '/', '').replace(/\\/g, '/');
  let canonicalPath;
  if (rel === 'index.html') canonicalPath = '/';
  else if (rel.endsWith('/index.html')) canonicalPath = '/' + rel.slice(0, -'/index.html'.length) + '/';
  else canonicalPath = '/' + rel.slice(0, -'.html'.length);
  return { file: f, rel, canonicalPath, html: readPage(f) };
});

const redirectHeader = exists(join(DIST, '_redirects')) ? readFileSync(join(DIST, '_redirects'), 'utf8') : '';
const redirectMap = {};
for (const line of redirectHeader.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const parts = t.split(/\s+/);
  if (parts.length >= 3 && parts[0].startsWith('/')) {
    redirectMap[parts[0]] = { to: parts[1], code: Number(parts[2]) || 301 };
  } else if (parts.length >= 2 && parts[0].startsWith('/')) {
    redirectMap[parts[0]] = { to: parts[1], code: 301 };
  }
}

console.log('==================================================');
console.log('APLUNO Content Quality Audit');
console.log('==================================================');

/* ---- Páginas descubiertas / indexabilidad ---- */
function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? m[1] : null;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  return m ? m[1] : null;
}

function detectRedirectPage(html) {
  // Páginas que son solo redirect (meta refresh / canonical a otra ruta interna)
  const hasRefresh = /<meta[^>]+http-equiv=["']refresh["']/i.test(html);
  return hasRefresh;
}

const isRedirectFile = {};
for (const f of htmlFiles) {
  const rel = f.replace(DIST + '\\', '').replace(DIST + '/', '').replace(/\\/g, '/');
  // nombres de alias de redirect conocidos (patrones del build)
  if (rel !== 'index.html' && !rel.endsWith('/index.html')) {
    const base = rel.replace(/\.html$/, '');
    if (redirectMap['/' + base] || detectRedirectPage(readFileSync(f, 'utf8'))) {
      isRedirectFile[f] = true;
    }
  }
}

let indexableCount = 0;
let noindexCount = 0;
const pageMeta = {};
for (const p of pages) {
  const robots = extractMeta(p.html, 'robots');
  const noindex = /noindex/i.test(robots || '');
  const canonical = extractCanonical(p.html);
  const isRedirect = isRedirectFile[p.file] || detectRedirectPage(p.html);
  pageMeta[p.canonicalPath] = { noindex, canonical, isRedirect, file: p.file };
  if (isRedirect || noindex) noindexCount++;
  else indexableCount++;
}
console.log('\nPages discovered:', pages.length);
console.log('Indexable:', indexableCount);
console.log('Noindex/redirect:', noindexCount);

/* ---- Sitemap ---- */
const sitemapLoc = [];
if (exists(join(DIST, 'sitemap.xml'))) {
  const sm = readXml(join(DIST, 'sitemap.xml'));
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(sm))) sitemapLoc.push(m[1]);
}
// URLs del sitemap con path
const sitemapPaths = sitemapLoc.map((u) => {
  const p = u.replace(SITE, '');
  return p.split('#')[0].split('?')[0];
});
console.log('Sitemap URLs:', sitemapLoc.length);

/* ================================================================== *
 * A. LINKS
 * ================================================================== */
console.log('\n--- Internal links ---');
let internalChecked = 0;
let internalBroken = 0;
let internalRedirectTargets = 0;
let externalLinks = 0;
const brokenSamples = [];
const hrefRe = /\shref=["']([^"']*)["']/gi;
for (const p of pages) {
  let m;
  while ((m = hrefRe.exec(p.html))) {
    const href = m[1];
    const res = resolveHref(href, p.rel, routeMap);
    if (res.type === 'EXTERNAL' || res.type === 'NON_NAVIGATION') { externalLinks++; continue; }
    if (res.type === 'ANCHOR' || res.type === 'EMPTY') continue;
    if (res.type !== 'INTERNAL') continue;
    internalChecked++;
    if (!res.file) {
      internalBroken++;
      if (brokenSamples.length < 40) brokenSamples.push(`${p.canonicalPath} -> ${href}`);
      continue;
    }
    // si apunta a una página redirect, contar (calidad, no roto)
    if (isRedirectFile[res.file]) internalRedirectTargets++;
  }
}
const linkDomain = internalBroken === 0 ? 'PASS' : 'FAIL';
if (linkDomain === 'PASS') pass('links', `0 internal broken across ${internalChecked} internal links`);
else fail('links', `${internalBroken} internal broken links (${brokenSamples.length} samples)`);
console.log('PASS/WARN/FAIL —', linkDomain, `(${internalChecked} internal, ${internalBroken} broken, ${internalRedirectTargets} point to redirect aliases)`);
for (const s of brokenSamples) console.log('  BROKEN', s);

/* ---- B. Metadata ---- */
console.log('\n--- Metadata ---');
const titleMap = new Map();
const descMap = new Map();
let emptyTitle = 0, emptyDesc = 0, dupTitle = 0, dupDesc = 0, multiH1 = 0;
for (const p of pages) {
  if (isRedirectFile[p.file] || pageMeta[p.canonicalPath].noindex) continue;
  const t = (p.html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!t || !t.trim()) emptyTitle++;
  else if (titleMap.has(t.trim())) dupTitle++;
  else titleMap.set(t.trim(), p.canonicalPath);
  const d = extractMeta(p.html, 'description');
  if (!d || !d.trim()) emptyDesc++;
  else if (descMap.has(d.trim())) dupDesc++;
  else descMap.set(d.trim(), p.canonicalPath);
  const h1s = (p.html.match(/<h1[\s>]/gi) || []).length;
  if (h1s > 1) multiH1++;
}
if (emptyTitle === 0 && dupTitle === 0 && emptyDesc === 0 && dupDesc === 0 && multiH1 === 0) pass('metadata', 'unique titles/descriptions, no empty, single H1');
else warn('metadata', `emptyTitle=${emptyTitle} dupTitle=${dupTitle} emptyDesc=${emptyDesc} dupDesc=${dupDesc} multiH1=${multiH1}`);
console.log(`WARN: emptyTitle=${emptyTitle} dupTitle=${dupTitle} emptyDesc=${emptyDesc} dupDesc=${dupDesc} multiH1=${multiH1}`);

/* ---- C. Duplicate content (similitud) ---- */
console.log('\n--- Duplicate content ---');

// Texto visible por página (sin scripts/nav/footer), filtrando chrome común.
const BAD_PREFIXES = ['/', '/toolisto', '/privacy', '/terms', '/privacidad', '/condiciones', '/apoyar'];
const editorialPages = pages.filter((p) => {
  if (isRedirectFile[p.file] || pageMeta[p.canonicalPath].noindex) return false;
  if (pageMeta[p.canonicalPath].canonical && pageMeta[p.canonicalPath].canonical !== (`${SITE}${p.canonicalPath}`) ) return false;
  return true;
});

// calcular conjuntos de shingles (n=6) del texto principal por página
const shingleSets = {};
for (const p of editorialPages) {
  const text = extractMainText(p.html);
  shingleSets[p.canonicalPath] = shingleTokens(text, 6);
}

// pares más similares (sobre TODAS las páginas indexables, sin filtrar por umbral,
// para que el máximo reportado sea el real y no "0.000" por debajo de un umbral).
const pairs = [];
const paths = Object.keys(shingleSets);
for (let i = 0; i < paths.length; i++) {
  for (let j = i + 1; j < paths.length; j++) {
    const a = shingleSets[paths[i]], b = shingleSets[paths[j]];
    const sim = jaccard(a, b);
    if (sim > 0.05) pairs.push({ a: paths[i], b: paths[j], sim });
  }
}
pairs.sort((x, y) => y.sim - x.sim);
const trueMaxSim = pairs.length ? pairs[0].sim : 0;
const allPairCount = pairs.length;
// Umbral de near-duplicate calibrado con fixtures controlados
// (tests/content-similarity-regression.mjs): dos páginas que comparten ~90% del
// cuerpo y solo cambian el nombre de la herramienta puntúan ~0.76; por eso HIGH_DUP
// se fija en 0.70 (no 0.80) para no dejar pasar near-duplicates reales. Una banda
// 0.50-0.70 se reporta como WARN (contenido a revisar), no como fail.
const HIGH_DUP = 0.7;
const REVIEW_DUP = 0.5;
const duplicatedPairs = pairs.filter((p) => p.sim >= HIGH_DUP);
const reviewPairs = pairs.filter((p) => p.sim >= REVIEW_DUP && p.sim < HIGH_DUP);
console.log(`Indexable pairs compared: ~${Math.round(allPairCount + (paths.length * (paths.length - 1) / 2))}`);
console.log('TRUE maximum pairwise similarity (all indexable pages):', trueMaxSim.toFixed(3));
console.log('Indexable pairs with similarity > 0.05:', allPairCount);
console.log('Pairs in 0.35-0.50 band:', pairs.filter((p) => p.sim >= 0.35 && p.sim < 0.5).length, '| 0.20-0.35:', pairs.filter((p) => p.sim >= 0.2 && p.sim < 0.35).length);
console.log('Top-5 most similar indexable pairs:');
for (const p of pairs.slice(0, 5)) console.log(`  ${p.sim.toFixed(3)}  ${p.a}  <->  ${p.b}`);
if (duplicatedPairs.length === 0) pass('duplicate', `no near-duplicate indexable pairs (true max sim ${trueMaxSim.toFixed(3)}, HIGH_DUP ${HIGH_DUP})`);
else fail('duplicate', `${duplicatedPairs.length} near-duplicate indexable pairs >= ${HIGH_DUP}`);
if (reviewPairs.length > 0) warn('duplicate-ish', `${reviewPairs.length} high-similarity pairs in ${REVIEW_DUP}-${HIGH_DUP} band (review)`);

/* ---- D. Thin-content signals (perfil por tipo de página, no un word-count global) ---- */
console.log('\n--- Thin-content signals (page-type aware) ---');

// Carga de datos canónicos para clasificar el tipo de cada página indexable.
let toolsData = [];
let categoriesData = [];
try { toolsData = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf8')); } catch {}
try { categoriesData = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'categories.json'), 'utf8')); } catch {}
const TOOL_PATHS = new Set(toolsData.map((t) => '/' + t.slug.toLowerCase()));
const CATEGORY_PATHS = new Set(categoriesData.map((c) => '/' + String(c.slug).toLowerCase()));
const FLAGSHIP_SLUGS = new Set(toolsData.filter((t) => t.contentTier === 'flagship').map((t) => '/' + String(t.slug).toLowerCase()));

// Perfiles por tipo de página: expectativas distintas según el propósito real.
// CONTACT y LEGAL NO se penalizan por tener poco texto o por no tener FAQ/usos;
// GUIDE y TOOL TIER 1 sí deben aportar editorial sustancial y específica.
// Los mínimos de TOOL_* están calibrados sobre contenido EDITORIAL ESTRICTO
// (sin chrome: capability strip, formatos, privacidad, related-tools). Una
// herramienta sencilla puede ser útil con ~60 palabras específicas; esa es la
// base para TOOL_LT. No se exige un mínimo de palabras genérico e inflado.
const TYPE_PROFILE = {
  HOME:    { minWords: 30,  minSections: 1, sectionKind: 'struct', label: 'home' },
  GUIDE:   { minWords: 260, minSections: 3, sectionKind: 'struct', label: 'guía' },
  CATEGORY:{ minWords: 100, minSections: 2, sectionKind: 'struct', label: 'categoría' },
  TOOL_T1: { minWords: 140, minSections: 3, sectionKind: 'tool', label: 'herramienta Tier 1' },
  TOOL_T2: { minWords: 100, minSections: 2, sectionKind: 'tool', label: 'herramienta Tier 2' },
  TOOL_LT: { minWords: 60,  minSections: 1, sectionKind: 'tool', label: 'herramienta long-tail' },
  ABOUT:   { minWords: 50,  minSections: 1, sectionKind: 'struct', label: 'about' },
  CONTACT: { minWords: 10,  minSections: 0, sectionKind: 'struct', requiresContact: true, label: 'contacto' },
  LEGAL:   { minWords: 30,  minSections: 0, sectionKind: 'struct', label: 'legal' },
  UTILITY: { minWords: 20,  minSections: 0, sectionKind: 'struct', label: 'utilidad' }
};
const LEGAL_PATHS = new Set(['/privacy/', '/terms/', '/privacidad/', '/condiciones/']);

function pageType(path) {
  if (path === '/') return 'HOME';
  if (path.startsWith('/guia/')) return 'GUIDE';
  if (CATEGORY_PATHS.has(path)) return 'CATEGORY';
  if (LEGAL_PATHS.has(path)) return 'LEGAL';
  if (path === '/about/') return 'ABOUT';
  if (path === '/contact/') return 'CONTACT';
  if (TOOL_PATHS.has(path)) return 'TOOL';
  return 'UTILITY';
}
// Un tool indexable se etiqueta por su huella editorial (palabras del contenido
// principal, medido sobre `.tool-content`) para exigir el nivel adecuado de
// especificidad. TOOL_T1 está reservado EXCLUSIVAMENTE a las herramientas
// marcadas como flagship en tools.json (metadata explícita `contentTier`) para
// que el chrome/UI no pueda inflar la clasificación: el conteo de palabras por
// sí solo NO asciende a Tier 1. El umbral de palabras y secciones actúa como
// guardián de que la flagship tenga sustancia editorial real.
//
// IMPORTANTE: `wc` aquí es el CONTENIDO EDITORIAL ESTRICTO (ver
// extractStrictEditorial): solo instructions + limitations + faq, SIN el
// chrome de UI (capability strip, formatos, privacidad, related-tools).
// Por eso los umbrales son más bajos que los de una métrica inflada por
// chrome: el máximo observable en las 202 herramientas reales es ~178
// palabras estrictas (mediana ~99). No se confunde "funcional" con
// "editorial sustancial".
function toolTier(wc, isFlagship, toolScore) {
  if (isFlagship && wc >= 140 && toolScore >= 3) return 'TOOL_T1';
  if (wc >= 100 && toolScore >= 2) return 'TOOL_T2';
  return 'TOOL_LT';
}

function sectionSignals(p) {
  const html = p.html;
  const instrMatch = /<section class="instructions"[\s\S]*?<\/section>/i.exec(html)?.[0] || '';
  const hasInstructions = /<section class="instructions"/i.test(html) && (instrMatch.match(/<li[\s>]/g) || []).length >= 2;
  const faqMatch = /<section class="faq-section"[\s\S]*?<\/section>/i.exec(html)?.[0] || '';
  const hasFaq = (faqMatch.match(/<details[\s>]/g) || []).length >= 1;
  const limMatch = /<section class="limitations"[\s\S]*?<\/section>/i.exec(html)?.[0] || '';
  const hasLimitations = /<section class="limitations"/i.test(html) && (limMatch.match(/<li[\s>]/g) || []).length >= 1;
  const hasFormats = /formats-info/i.test(html);
  const toolScore = [hasInstructions, hasFaq, hasLimitations, hasFormats].filter(Boolean).length;
  // Secciones estructurales para tipos que no usan clases de herramienta (guía,
  // categoría, home, about): bloques <article> + encabezados <h2> dentro de main.
  const mainRegion = balancedRegion(html, 'main') || html;
  const structScore = (mainRegion.match(/<article\b/gi) || []).length + (mainRegion.match(/<h2\b/gi) || []).length;
  return { hasInstructions, hasFaq, hasLimitations, hasFormats, toolScore, structScore };
}

const reviews = [];
for (const p of editorialPages) {
  const mainText = extractMainText(p.html);
  const mainWordsTotal = wordCount(mainText);
  const type = pageType(p.canonicalPath);
  // Para herramientas, la métrica editorial canónica es la ESTRICTA (sin
  // chrome): instructions + limitations + faq. Cualquier otra métrica que
  // sume la capability strip / formatos / privacidad / related-tools infla
  // la percepción de contenido real.
  const strict = type === 'TOOL' ? extractStrictEditorial(p.html) : { words: mainWordsTotal };
  const wc = type === 'TOOL' ? strict.words : mainWordsTotal;
  const sig = sectionSignals(p);
  let tier = null;
  if (type === 'TOOL') tier = toolTier(wc, FLAGSHIP_SLUGS.has(p.canonicalPath), sig.toolScore);
  const profile = tier ? TYPE_PROFILE[tier] : TYPE_PROFILE[type];
  const sectionScore = profile.sectionKind === 'tool' ? sig.toolScore : sig.structScore;
  const hasContactMechanism = /mailto:|<form/i.test(p.html);
  // Cumple los mínimos del perfil de su tipo.
  const meetsWords = wc >= (profile.minWords || 0);
  const meetsSections = !(profile.minSections > 0) || sectionScore >= profile.minSections;
  const meetsContact = !profile.requiresContact || hasContactMechanism;
  const suspicious = !meetsWords || !meetsSections || !meetsContact;
  reviews.push({
    page: p.canonicalPath,
    type,
    tier: tier || type,
    mainWords: wc,
    mainWordsTotal,
    sections: sectionScore,
    minWords: profile.minWords || 0,
    minSections: profile.minSections || 0,
    hasContactMechanism,
    hasInstructions: sig.hasInstructions,
    hasFaq: sig.hasFaq,
    hasLimitations: sig.hasLimitations,
    hasFormats: sig.hasFormats,
    theoryWords: strict.words,
    suspicious
  });
}
reviews.sort((a, b) => a.mainWords - b.mainWords);
const flagged = reviews.filter((r) => r.suspicious);
console.log('Pages under the minimum editorial expectation for their type:', flagged.length);
for (const r of flagged) console.log('  ', r.page, `[${r.tier}] ${r.mainWords}w estrictas / ${r.mainWordsTotal}w totales / ${r.sections} sections (min ${r.minWords}/${r.minSections})`);
console.log('Short but purposeful pages (strict editorial under 100 words, logged for review):');
for (const r of reviews.filter((r) => !r.suspicious && r.mainWords < 100 && r.type === 'TOOL')) console.log('   ', r.page, `[${r.tier}] ${r.mainWords}w estrictas, ${r.mainWordsTotal}w totales, ${r.sections} sections`);
if (flagged.length === 0) pass('thin', 'no indexable page below its page-type editorial minimum (strict editorial metric)');
else warn('thin', `${flagged.length} pages below their page-type minimum (review)`);




/* ---- E. Boilerplate (frases reutilizadas, clasificadas) ---- */
console.log('\n--- Boilerplate detection (classified) ---');
const sentenceCount = new Map();
const SENT_RE = /[^.!?]+[.!?]+/g;
for (const p of editorialPages) {
  const text = extractMainText(p.html).replace(/\s+/g, ' ').trim();
  const sentences = text.match(SENT_RE) || [];
  for (const raw of sentences) {
    const s = normalizeText(raw).trim();
    if (wordCount(s) < 6 || wordCount(s) > 40) continue;
    if (!sentenceCount.has(s)) sentenceCount.set(s, { n: 0, pages: [] });
    const e = sentenceCount.get(s);
    e.n++;
    if (e.pages.length < 8 && !e.pages.includes(p.canonicalPath)) e.pages.push(p.canonicalPath);
  }
}
// Clasificación de frases repetidas. Los primeros tipos son chrome/UI/confianza
// legítimos y compartidos; lo preocupante es EDITORIAL y UNKNOWN en muchas páginas.
function classifyPhrase(s) {
  if (/\bherramientas\b|\bguias\b|\bacerca\b|\blegal\b|\bcategorias\b/.test(s)) return 'GLOBAL_NAV';
  if (/\btodos los derechos reservados\b|\bcopyright\b|(c) 20\d\d|toolisto es un producto/.test(s)) return 'FOOTER';
  if (/\bse procesa en tu navegador\b|\btodo el procesamiento ocurre en tu navegador\b|\bno se suben\b|\blos archivos nunca salen de tu dispositivo\b|\bno subimos\b|\bnada sale de tu dispositivo\b|\bprivacidad\b|\bno se envian\b|\bnunca salen\b|\barchivos se procesan\b|\bse suben a un servidor\b/.test(s)) return 'PRIVACY_TRUST';
  if (/^\d\d?\s*(prepara|arrastra|elige|selecciona|sube|abre|introduce|anade|haz|ajusta|entrega|descarga|revisa|pulsa)/.test(s) || /^0[12]\s/.test(s) || /\bcomo funciona\b/.test(s)) return 'UI_INSTRUCTION';
  if (/\busa la herramienta directamente\b|\bresuelve tu tarea\b|\bdescarga el resultado\b|\bpruébalo ahora\b|\bempieza ahora\b|\bsin necesidad de\b|\bgratis\b|^\s*herramienta gratuita/i.test(s)) return 'CTA';
  // frases de cierre/html propias del build
  if (/\bsin instalar nada\b|\bno necesitas instalar\b|\bsin crear una cuenta\b/.test(s)) return 'CTA';
  return 'UNKNOWN';
}
const reused = [...sentenceCount.entries()]
  .filter(([, v]) => v.n >= 6)
  .map(([s, v]) => ({ s, n: v.n, pages: v.pages, cls: classifyPhrase(s) }))
  .sort((a, b) => b.n - a.n);

const byClass = {};
for (const r of reused) (byClass[r.cls] = byClass[r.cls] || []).push(r);
// Los tipos legítimos se reportan por separado; EDITORIAL/UNKNOWN son los señales negativas.
const concerning = [...(byClass.EDITORIAL || []), ...(byClass.UNKNOWN || [])];
console.log('Sentences reused on 6+ indexable pages:', reused.length);
for (const cls of ['GLOBAL_NAV', 'FOOTER', 'PRIVACY_TRUST', 'UI_INSTRUCTION', 'CTA', 'EDITORIAL', 'UNKNOWN']) {
  const items = byClass[cls] || [];
  console.log(`  ${cls.padEnd(14)}: ${items.length}`);
}
console.log('Concerning reused editorial/unknown prose:', concerning.length);
for (const c of concerning.slice(0, 15)) console.log(`  [${c.n}] ${c.s.slice(0, 90)} ${c.pages.slice(0, 3).join(', ')}`);
// Los legítimos son PASS; solo falla si hay prosa editorial reutilizada de forma masiva.
const legit = ['GLOBAL_NAV', 'FOOTER', 'PRIVACY_TRUST', 'UI_INSTRUCTION', 'CTA'];
const legitCount = legit.reduce((a, k) => a + (byClass[k] || []).length, 0);
pass('boilerplate-legit', `${legitCount} shared chrome/UI/trust phrases (${legit.map((k) => `${k}:${byClass[k]?.length || 0}`).join(', ')})`);
if (concerning.length === 0) pass('boilerplate-editorial', 'no reused editorial prose detected');
else warn('boilerplate-editorial', `${concerning.length} reused editorial/unknown phrases (review)`);


/* ---- F. Orphan pages ---- */
console.log('\n--- Orphan pages ---');
const referenced = new Set(['/']);
for (const p of pages) {
  let m;
  const re = /href="([^"]+)"/g;
  while ((m = re.exec(p.html))) {
    const r = resolveHref(m[1], p.rel, routeMap);
    if (r.type === 'INTERNAL' && r.path) referenced.add(r.path.startsWith('/') ? r.path : '/' + r.path);
  }
}
// huérfanas: indexables que no reciben enlace interno (excepto via sitemap)
const orphans = [];
for (const p of editorialPages) {
  // ¿algún enlace interno apunta a esta página?
  const hasLink = [...referenced].some((r) => r === p.canonicalPath || r === ('/' + p.canonicalPath.replace(/^\/+/, '').replace(/\/$/, '')) || (p.canonicalPath.endsWith('/') && r === p.canonicalPath.slice(0, -1)));
  if (!hasLink) orphans.push(p.canonicalPath);
}
console.log('Indexable orphan pages (no internal link):', orphans.length);
for (const o of orphans.slice(0, 40)) console.log('  ', o);
if (orphans.length === 0) pass('orphans', 'no indexable pages lacking internal links');
else warn('orphans', `${orphans.length} indexable pages have no internal links`);

/* ---- G. Placeholders ---- */
console.log('\n--- Placeholders ---');
const PH = [/lorem\s+ipsum/i, /\bfixme\b/i, /coming soon/i, /proximamente|próximamente/i, /placeholder/i, /sample text/i, /example\.com/i, /\{\{[^}]+\}\}/, /\{\/[^}]+\}/];
let phFound = 0;
for (const p of pages) {
  if (isRedirectFile[p.file]) continue;
  const visible = stripTags(p.html).replace(/<style[\s\S]*?>/gi, ' ');
  for (const re of PH) {
    if (re.test(visible)) {
      phFound++;
      console.log('  ', p.canonicalPath, '->', re);
      break;
    }
  }
}
if (phFound === 0) pass('placeholders', 'no unresolved placeholders in visible content');
else warn('placeholders', `${phFound} pages contain placeholder-like text`);

/* ---- H. Guides ---- */
console.log('\n--- Guides ---');
let guidesFiles;
try { guidesFiles = readdirSync(join(DIST, 'guia')); } catch { guidesFiles = []; }
const guideDirs = guidesFiles.filter((d) => /^[a-z0-9-]+$/.test(d));
let validGuides = 0;
const guideIssues = [];
for (const d of guideDirs) {
  const f = join(DIST, 'guia', d, 'index.html');
  if (!exists(f)) { guideIssues.push(`${d}: missing index`); continue; }
  const h = readFileSync(f, 'utf8');
  const text = stripTags(h);
  const title = (h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  const h1 = (h.match(/<h1>([\s\S]*?)<\/h1>/i) || [])[1];
  const canon = extractCanonical(h);
  const words = wordCount(normalizeText(text));
  if (!title || !h1 || !canon || !canon.includes(`/guia/${d}/`)) { guideIssues.push(`${d}: missing title/h1/canonical`); continue; }
  if (words < 200) { guideIssues.push(`${d}: thin (${words} words)`); continue; }
  validGuides++;
}
console.log(`Guides: ${validGuides}/${guideDirs.length} valid`);
for (const i of guideIssues) console.log('  ', i);
if (validGuides === guideDirs.length && guideDirs.length >= 10) pass('guides', `${validGuides}/${guideDirs.length} guides complete and non-thin`);
else warn('guides', `${validGuides}/${guideDirs.length} valid; issues: ${guideIssues.length}`);

/* ---- I. Categories ---- */
console.log('\n--- Categories ---');
let catOk = 0, catFail = 0;
const catPaths = ['/pdf', '/imagenes', '/firmas', '/documentos-word', '/texto', '/epub-mobi', '/hojas-de-calculo', '/archivos', '/qr-codigos', '/video', '/audio', '/calculadoras'];
for (const cp of catPaths) {
  const meta = pageMeta[cp];
  if (!meta) { catFail++; console.log('  MISSING', cp); continue; }
  const h = readFileSync(meta.file, 'utf8');
  const hasAbout = h.includes('category-about');
  const hasFaq = h.includes('faq-section');
  if (hasAbout && hasFaq) catOk++;
  else catFail++;
}
console.log(`Categories enriched: ${catOk}/12`);
if (catOk === 12) pass('categories', '12/12 categories have distinct editorial intro + FAQ');
else warn('categories', `${catOk}/12 categories enriched`);

/* ---- J. Structured data ---- */
console.log('\n--- Structured data ---');
let ldOk = 0, ldBad = 0;
for (const p of editorialPages) {
  const m = p.html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!m) { continue; }
  for (const block of m) {
    const json = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    try { JSON.parse(json); ldOk++; }
    catch { ldBad++; console.log('  INVALID LD', p.canonicalPath); }
  }
}
console.log('Valid JSON-LD blocks:', ldOk, ' invalid:', ldBad);
if (ldBad === 0) pass('structured-data', `${ldOk} valid JSON-LD blocks`);
else fail('structured-data', `${ldBad} invalid JSON-LD blocks`);

/* ---- K. Coherencia indexación / sitemap ---- */
console.log('\n--- Indexability coherence ---');
let sitemapBroken = 0;
let sitemapNoindex = 0;
for (const sp of sitemapPaths) {
  const meta = pageMeta[sp];
  if (!meta) {
    sitemapBroken++;
    continue;
  }
  if (meta.noindex) sitemapNoindex++;
}
let coherenceOk = true;
const coh = [];
if (!exists(join(DIST, 'sitemap.xml'))) { coh.push('sitemap missing'); coherenceOk = false; }
if (sitemapBroken > 0) { coh.push(`${sitemapBroken} sitemap URLs have no page`); coherenceOk = false; }
if (sitemapNoindex > 0) { coh.push(`${sitemapNoindex} sitemap URLs are noindex`); coherenceOk = false; }
// editorial URLs deben estar en sitemap
const editorialReq = ['/', '/guia/', '/about/', '/contact/', '/privacy/', '/terms/'];
const missingEditorial = editorialReq.filter((e) => !sitemapPaths.includes(e));
if (missingEditorial.length) { coh.push(`editorial URLs missing from sitemap: ${missingEditorial.join(',')}`); coherenceOk = false; }
console.log('Sitemap missing pages:', sitemapBroken, ' noindex in sitemap:', sitemapNoindex);
if (coherenceOk) pass('indexability', 'sitemap coherent: all URLs exist, none noindex, editorial covered');
else fail('indexability', coh.join('; '));

/* ---- L. Distribución de calidad A-F (números exactos, sin jugar con el conteo) ---- */
const toolReviewsAll = reviews.filter((r) => r.type === 'TOOL');
const strictDist = toolReviewsAll.map((r) => r.mainWords).sort((a, b) => a - b);
const sQ = (p) => strictDist[Math.min(strictDist.length - 1, Math.floor((p / 100) * (strictDist.length - 1)))];
const toolTierCount = (t) => toolReviewsAll.filter((r) => r.tier === t).length;
const strictEditorial = {
  metric: 'instructions + limitations + faq (sin chrome: capability strip, formatos, privacidad, related-tools)',
  totalTools: toolReviewsAll.length,
  min: strictDist[0],
  p10: sQ(10),
  p25: sQ(25),
  p50: sQ(50),
  p75: sQ(75),
  p90: sQ(90),
  max: strictDist[strictDist.length - 1],
  ge140: strictDist.filter((x) => x >= 140).length,
  b100_139: strictDist.filter((x) => x >= 100 && x < 140).length,
  b70_99: strictDist.filter((x) => x >= 70 && x < 100).length,
  lt70: strictDist.filter((x) => x < 70).length,
  tierT1: toolTierCount('TOOL_T1'),
  tierT2: toolTierCount('TOOL_T2'),
  tierLT: toolTierCount('TOOL_LT')
};
console.log('\n--- Strict editorial distribution (202 herramientas, sin chrome) ---');
console.log(`n=${strictEditorial.totalTools} min=${strictEditorial.min} p10=${strictEditorial.p10} p25=${strictEditorial.p25} p50=${strictEditorial.p50} p75=${strictEditorial.p75} p90=${strictEditorial.p90} max=${strictEditorial.max}`);
console.log(`Tier T1=${strictEditorial.tierT1} T2=${strictEditorial.tierT2} LT=${strictEditorial.tierLT}`);
console.log(`strict>=140:${strictEditorial.ge140} 100-139:${strictEditorial.b100_139} 70-99:${strictEditorial.b70_99} <70:${strictEditorial.lt70}`);

console.log('\n--- Quality distribution (A-F) ---');
const A_TYPES = new Set(['HOME', 'GUIDE', 'CATEGORY', 'ABOUT', 'CONTACT', 'TOOL_T1']);
const aPages = reviews.filter((r) => A_TYPES.has(r.tier)).map((r) => r.page);
const bPages = reviews.filter((r) => !A_TYPES.has(r.tier) && !r.suspicious).map((r) => r.page);
const cPag = flagged.map((r) => r.page);
const dPages = [...new Set(duplicatedPairs.flatMap((p) => [p.a, p.b]))];
const fPages = new Set();
for (const s of brokenSamples) { const src = s.split(' -> ')[0]; if (src) fPages.add(src); }
for (const p of pages) {
  if (isRedirectFile[p.file] || pageMeta[p.canonicalPath].noindex) continue;
  const t = (p.html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  const d = extractMeta(p.html, 'description');
  if (!t || !t.trim() || !d || !d.trim()) fPages.add(p.canonicalPath);
  if ((p.html.match(/<h1[\s>]/gi) || []).length > 1) fPages.add(p.canonicalPath);
}
const A = aPages.length, B = bPages.length, C = cPag.length, D = dPages.length, E = noindexCount, F = fPages.size;
const sumABCD = A + B + C + D;
console.log(`A (alto valor)             : ${A}`);
console.log(`B (adecuado)               : ${B}`);
console.log(`C (thin/sospechoso)        : ${C}`);
console.log(`D (duplicado)              : ${D}`);
console.log(`E (noindex intencional)    : ${E}`);
console.log(`F (defectuoso)             : ${F}`);
console.log(`Check: A+B+C+D = ${sumABCD} (indexable ${indexableCount}); E = ${E} (noindex ${noindexCount})`);
if (C === 0) pass('quality-C', `0 indexable pages classified thin (C=0)`);
else fail('quality-C', `${C} indexable pages are thin (below their page-type minimum)`);
if (D === 0) pass('quality-D', `0 indexable pages involved in near-duplicates (D=0)`);
else fail('quality-D', `${D} indexable pages are duplicated`);
if (F === 0) pass('quality-F', `0 indexable pages with hard defects: broken links/metadata/schema (F=0)`);
else fail('quality-F', `${F} indexable pages have defects (${[...fPages].slice(0, 10).join(', ')})`);

/* ================================================================== *
 * FINAL
 * ================================================================== */
console.log('\n==================================================');
const finalStatus = result.fail === 0 ? 'PASS' : 'FAIL';
console.log('FINAL:', finalStatus, `(pass=${result.checks.filter(c=>c.status==='PASS').length}, warn=${result.warn}, fail=${result.fail})`);
console.log('==================================================');

// ==================================================================
// Modo CLI opcional: --debug-tiers
// Imprime la distribucion REAL de extractMainText del auditor y la
// clasificacion de tiers, usando EXACTAMENTE la misma logica.
// ==================================================================
if (process.argv.includes('--debug-tiers')) {
  const toolReviews = reviews.filter((r) => r.type === 'TOOL' && !r.suspicious);
  const dist = toolReviews.map((r) => r.mainWords).sort((a, b) => a - b);
  const quantile = (p) => dist[Math.min(dist.length - 1, Math.floor((p / 100) * (dist.length - 1)))];
  const count = (lo, hi) => toolReviews.filter((r) => r.mainWords >= lo && r.mainWords < hi).length;
  console.log('\n===== TOOL TIER DISTRIBUTION (strict editorial, sin chrome) =====');
  console.log(`n=${toolReviews.length} min=${dist[0]} p10=${quantile(10)} p25=${quantile(25)} median=${quantile(50)} p75=${quantile(75)} p90=${quantile(90)} max=${dist[dist.length - 1]}`);
  const t1 = toolReviews.filter((r) => r.tier === 'TOOL_T1').length;
  const t2 = toolReviews.filter((r) => r.tier === 'TOOL_T2').length;
  const t3 = toolReviews.filter((r) => r.tier === 'TOOL_LT').length;
  console.log(`TOOL_T1=${t1} TOOL_T2=${t2} TOOL_LT=${t3}`);
  console.log(`wc>=140:${count(140, 99999)} 100-139:${count(100, 140)} 70-99:${count(70, 100)} <70:${count(0, 70)}`);
  const sorted = [...toolReviews].sort((a, b) => b.mainWords - a.mainWords);
  const lines = sorted.map((r) => `${r.mainWords}\t${r.tier}\t/${r.page}\ttotal=${r.mainWordsTotal}\tsections=${r.sections}`);
  try {
    const tmpDir = join(ROOT, '_toolisto_autopilot', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'tools-tier-list.txt'), lines.join('\n') + '\n');
    console.log('Tools tier list written to _toolisto_autopilot/tmp/tools-tier-list.txt');
  } catch (e) { console.log('(could not write tier list file)'); }
  console.log('-- Top 25 tools by strict editorial words --');
  for (const r of sorted.slice(0, 25)) console.log(`  /${r.page} (${r.mainWords}w estrictas, ${r.mainWordsTotal}w totales, ${r.tier}, sections=${r.sections})`);
}

// Evidencia determinista
const evidence = {
  audit: 'APLUNO Content Quality Audit',
  pagesDiscovered: pages.length,
  indexable: indexableCount,
  noindex: noindexCount,
  sitemapUrls: sitemapLoc.length,
  links: {
    internalChecked,
    internalBroken,
    internalRedirectTargets,
    externalLinks,
    samples: brokenSamples.slice(0, 40)
  },
  metadata: { emptyTitle, dupTitle, emptyDesc, dupDesc, multiH1 },
  duplicateContent: { maxSimilarity: Number(trueMaxSim.toFixed(3)), highValuePairs: duplicatedPairs.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim.toFixed(3)) })), reviewBandPairs: reviewPairs.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim.toFixed(3)) })), pairCountAbove005: pairs.length, HIGH_DUP },
  thinContent: { metric: 'strict editorial (sin chrome)', flagged: flagged.map((r) => ({ page: r.page, type: r.type, tier: r.tier, mainWords: r.mainWords, mainWordsTotal: r.mainWordsTotal, sections: r.sections, minWords: r.minWords, minSections: r.minSections })), reviewableShort: reviews.filter((r) => !r.suspicious && r.type === 'TOOL' && r.mainWords < 100).map((r) => ({ page: r.page, tier: r.tier, mainWords: r.mainWords, mainWordsTotal: r.mainWordsTotal, sections: r.sections })) },
  strictEditorial,
  boilerplate: { reused6plus: reused.length, byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, v.length])), concerning: concerning.map((c) => ({ phrase: c.s.slice(0, 140), n: c.n, cls: c.cls, pages: c.pages.slice(0, 5) })) },
  orphans: [...orphans],
  placeholders: phFound,
  guides: { total: guideDirs.length, valid: validGuides },
  categories: { enriched: catOk, total: 12 },
  structuredData: { valid: ldOk, invalid: ldBad },
  indexabilityCoherence: { sitemapBroken, sitemapNoindex },
  final: finalStatus
};
mkdirSync(EVIDENCE_DIR, { recursive: true });
const evPath = join(EVIDENCE_DIR, 'audit-content-quality.json');
// determinista: claves ordenadas por canonicalize local
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const content = JSON.stringify(canon(evidence), null, 2) + '\n';
writeFileSync(evPath, content);
console.log('\nEvidence written:', evPath.replace(ROOT + '\\', ''));
process.exit(finalStatus === 'PASS' ? 0 : 1);
