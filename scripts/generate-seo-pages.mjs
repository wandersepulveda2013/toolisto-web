#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const DATA = join(SRC, 'data');
const DIST = join(ROOT, 'dist');

function loadJSON(name) {
  return JSON.parse(readFileSync(join(DATA, name), 'utf-8'));
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const isProduction = process.argv.includes('--production');
const includeWorkspaceRuntime = !isProduction || process.argv.includes('--include-workspace');
const site = loadJSON('site.config.json');
if (isProduction && site.productionDomain) {
  site.siteUrl = site.productionDomain;
}
if (!site.siteUrl || site.siteUrl.includes('DOMINIO-REAL')) {
  console.error('ERROR: site.config.json must define a real siteUrl before building.');
  process.exit(1);
}
if (isProduction && site.siteUrl.endsWith('.invalid')) {
  console.error('ERROR: Production build rejected. siteUrl ends with .invalid:', site.siteUrl);
  console.error('Replace siteUrl or productionDomain in src/data/site.config.json with your real domain before deploying.');
  process.exit(1);
}
if (site.siteUrl.endsWith('.invalid')) {
  console.warn('WARNING: siteUrl uses .invalid domain:', site.siteUrl, '\n  This is OK for local development. Use --production to enforce a real domain.');
}

site.siteUrl = site.siteUrl.replace(/\/+$/, '');
const brandName = site.brandName || site.siteName || 'APLUNO';
const productName = site.productName || 'Toolisto Herramientas';
const productShortName = site.productShortName || 'Toolisto';
const catalogPath = site.catalogPath || '/toolisto';
if (!/^\/[a-z0-9-]+$/.test(catalogPath)) {
  console.error('ERROR: catalogPath must be a clean absolute path such as "/toolisto":', catalogPath);
  process.exit(1);
}
const brandHref = '/';
const catalogHref = `${catalogPath}#herramientas`;
const catalogUrl = `${site.siteUrl}${catalogPath}`;

const tools = loadJSON('tools.json');
const categories = loadJSON('categories.json');
const redirects = loadJSON('redirects.json');
const TODAY = site.buildDate || new Date().toISOString().slice(0, 10);

const supportCfg = site.support || {};
const analyticsCfg = site.analytics || {};
const feedbackCfg = site.feedback || {};

function buildGoogleAnalyticsTag() {
  if (!analyticsCfg.enabled || analyticsCfg.provider !== 'google-analytics' || !analyticsCfg.measurementId) return '';
  const id = analyticsCfg.measurementId;
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${escAttr(id)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${escAttr(id)}');</script>`;
}

function getSupportButtonHtml() {
  if (!supportCfg.enabled || !supportCfg.url) return '';
  const logoPath = supportCfg.logo ? join(ROOT, supportCfg.logo) : null;
  const logoExists = logoPath && existsSync(logoPath);
  const logoImg = logoExists ? `<img src="${escAttr(supportCfg.logo)}" alt="" width="24" height="24" style="vertical-align:middle;margin-right:6px">` : '';
  return `<a class="support-donate-btn" href="${escAttr(supportCfg.url)}" target="_blank" rel="noopener noreferrer">${logoImg}${escHtml(supportCfg.buttonText || 'Apoyar con PayPal')}</a>`;
}

function getFeedbackHtml() {
  const reportLink = (feedbackCfg.enabled && feedbackCfg.url)
    ? `<a href="${escAttr(feedbackCfg.url)}" target="_blank" rel="noopener noreferrer" id="reportProblemLink">Reportar un problema</a> · `
    : '';
  return `<div class="report-problem">${reportLink}<button type="button" class="copy-tech-btn">Copiar detalles técnicos</button></div>`;
}

mkdirSync(DIST, { recursive: true });
mkdirSync(join(DIST, 'assets'), { recursive: true });
mkdirSync(join(DIST, 'vendor'), { recursive: true });
mkdirSync(join(DIST, 'js'), { recursive: true });

const ASSETS_SRC = join(ROOT, 'assets');
if (existsSync(ASSETS_SRC)) cpSync(ASSETS_SRC, join(DIST, 'assets'), { recursive: true });
cpSync(join(ROOT, 'vendor'), join(DIST, 'vendor'), { recursive: true });
cpSync(join(ROOT, 'app.js'), join(DIST, 'js', 'app.js'));
  cpSync(join(ROOT, 'tool-processors.js'), join(DIST, 'js', 'tool-processors.js'));
  cpSync(join(ROOT, 'js'), join(DIST, 'js'), { recursive: true });
cpSync(join(ROOT, 'styles.css'), join(DIST, 'styles.css'));
cpSync(join(ROOT, 'toolisto.html'), join(DIST, 'toolisto.html'));
cpSync(join(ROOT, 'offline.html'), join(DIST, 'offline.html'));
cpSync(join(ROOT, 'app.js'), join(DIST, 'app.js'));
cpSync(join(ROOT, 'tool-processors.js'), join(DIST, 'tool-processors.js'));
// El Service Worker de Toolisto se genera con la allowlist de rutas públicas de
// APLUNO (portada, legal, contacto y productos) que NUNCA debe interceptar.
const aplunoPublicRoutes = [
  '/',
  '/index.html',
  '/about', '/about/',
  '/contact', '/contact/',
  '/privacy', '/privacy/',
  '/terms', '/terms/',
  '/ordia', '/ordia/',
  '/workspace', '/workspace/',
  '/404.html',
  '/manifest.webmanifest',
  '/sitemap.xml',
  '/robots.txt',
  '/_redirects',
  '/_headers',
  '/.nojekyll',
  '/apluno-assets/',
];
const swSource = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
const swMarker = 'const APLUNO_PUBLIC_ROUTES = [];';
if (!swSource.includes(swMarker)) {
  console.error('FAIL: service-worker.js must expose the APLUNO_PUBLIC_ROUTES initializer.');
  process.exit(1);
}
const generatedSw = swSource.replace(swMarker, `const APLUNO_PUBLIC_ROUTES = ${JSON.stringify(aplunoPublicRoutes)};`);
writeFileSync(join(DIST, 'service-worker.js'), generatedSw, 'utf8');

// Copy Workspace runtime to dist/workspace/ ONLY for local development and the
// Workspace release gate (--include-workspace). The PUBLIC build (--production)
// must NOT publish the internal Workspace runtime (workspace/preview.html);
// dist/workspace/ keeps just the APLUNO landing index.html generated by
// generate-apluno-pages.mjs.
const WS_SRC = join(ROOT, 'workspace');
const WS_DIST = join(DIST, 'workspace');
if (includeWorkspaceRuntime && existsSync(WS_SRC)) {
  mkdirSync(WS_DIST, { recursive: true });
  const wsInternalIndex = join(WS_SRC, 'index.html');
  cpSync(WS_SRC, WS_DIST, {
    recursive: true,
    filter: source => source !== wsInternalIndex,
  });
  if (existsSync(wsInternalIndex)) {
    cpSync(wsInternalIndex, join(WS_DIST, 'preview.html'));
  }
}

const splashCSS = `<style>
html.intro-pending, html.intro-pending body { background: #1C1D21; }
#toolisto-intro { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1C1D21; gap: 16px; opacity: 1; animation: introMaster 280ms ease both; pointer-events: none; }
#toolisto-intro .intro-mark { width: 80px; height: 80px; animation: introScale 180ms ease-out both; }
#toolisto-intro .intro-name { color: #F5F4EF; font-size: 1.8rem; font-weight: 700; letter-spacing: -0.04em; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
#toolisto-intro .intro-accent { width: 48px; height: 3px; background: #2563EB; border-radius: 2px; animation: introScale 180ms 60ms ease-out both; }
@keyframes introMaster { 0% { opacity: 0; } 15% { opacity: 1; } 60% { opacity: 1; } 100% { opacity: 0; } }
@keyframes introScale { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { #toolisto-intro { animation: none; opacity: 0; transition: opacity 80ms ease; } #toolisto-intro .intro-mark, #toolisto-intro .intro-accent { animation: none; opacity: 0; } }
</style>
<noscript><style>#toolisto-intro{display:none!important}.site-header,main,.site-footer{visibility:visible!important;opacity:1!important;pointer-events:auto!important}html,body{overflow:auto!important;background:initial}</style></noscript>`;

const splashHTML = `<div id="toolisto-intro" aria-hidden="true"><img class="intro-mark" src="./assets/toolisto-mark.svg" alt="" width="80" height="80" /><span class="intro-name">Toolisto</span><span class="intro-accent"></span></div>`;

const splashScript = `<script>(function(){var i=document.getElementById('toolisto-intro');if(!i)return;var h=document.documentElement;var r=false;function c(){if(r)return;r=true;if(i.parentNode)i.remove();h.classList.remove('intro-pending');h.classList.remove('intro-active')}var m=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;if(m){c()}else{i.addEventListener('animationend',function(e){if(e.animationName!=='introMaster')return;i.removeEventListener('animationend',c);c()});setTimeout(c,300)}})()</script>`;
const pwaHead = `<link rel="manifest" href="./assets/manifest.webmanifest">`;
const pwaScript = `<script src="./js/pwa-register.js"></script>`;
const ASSET_VERSION = '20260814-apluno';
const appJsTag = (rel) => `<script src="${rel}app.js?v=${ASSET_VERSION}"></script>`;

const headerNav = `<header class="site-header"><div class="header-inner"><a class="brand" href="${escAttr(catalogHref)}" aria-label="Ir al catálogo de ${escAttr(productName)}"><img class="brand-mark-img" src="./assets/toolisto-mark.svg" alt="" width="36" height="36" /><span class="brand-text">${escHtml(productShortName)}</span></a><a class="apluno-parent-link" href="${escAttr(brandHref)}" aria-label="Ir al inicio de ${escAttr(brandName)}">by ${escHtml(brandName)}</a><nav class="desktop-nav" aria-label="Categorías de herramientas"><a href="${escAttr(catalogHref)}" data-nav-filter="images">Imágenes</a><a href="${escAttr(catalogHref)}" data-nav-filter="pdf">PDF</a><a href="${escAttr(catalogHref)}" data-nav-filter="signatures">Firmas</a><a href="${escAttr(catalogHref)}" data-nav-filter="documents">Documentos</a><a href="${escAttr(catalogHref)}" data-nav-filter="spreadsheets">Hojas de cálculo</a><a href="${escAttr(catalogHref)}" data-nav-filter="all">Todas</a></nav><div class="header-actions"><a class="header-action-btn" href="${escAttr(catalogHref)}" aria-label="Buscar herramientas"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg></a><button class="header-action-btn" id="themeToggle" type="button" aria-label="Cambiar tema"><svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button><button class="menu-button" id="menuToggle" type="button" aria-expanded="false" aria-controls="mobileNav"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button></div></div></header><nav class="mobile-nav" id="mobileNav" hidden><a href="${escAttr(catalogHref)}" data-nav-filter="images">Imágenes</a><a href="${escAttr(catalogHref)}" data-nav-filter="pdf">PDF</a><a href="${escAttr(catalogHref)}" data-nav-filter="signatures">Firmas</a><a href="${escAttr(catalogHref)}" data-nav-filter="all">Todas las herramientas</a><a href="${escAttr(brandHref)}">${escHtml(brandName)}</a></nav>`;

const footerHTML = `<footer class="site-footer"><div class="footer-inner"><div class="footer-top"><div class="footer-brand-col"><a class="brand" href="${escAttr(catalogHref)}" aria-label="Ir al catálogo de ${escAttr(productName)}"><img class="brand-mark-img" src="./assets/toolisto-mark.svg" alt="" width="28" height="28" /><span class="brand-text">${escHtml(productShortName)}</span></a><p>Herramientas de archivos directas, rápidas y privadas. Todo se procesa en tu navegador.</p><p>Un producto de <a href="${escAttr(brandHref)}">${escHtml(brandName)}</a>.</p></div><div class="footer-col"><h4>Herramientas</h4><nav aria-label="Categorías"><a href="${escAttr(catalogHref)}">Ver todas</a><a href="${escAttr(catalogHref)}" data-nav-filter="images">Imágenes</a><a href="${escAttr(catalogHref)}" data-nav-filter="pdf">PDF</a><a href="${escAttr(catalogHref)}" data-nav-filter="documents">Documentos</a></nav></div><div class="footer-col"><h4>Productos</h4><nav aria-label="Productos de ${escAttr(brandName)}"><a href="${escAttr(brandHref)}">${escHtml(brandName)}</a><a href="/workspace">Workspace</a><a href="/ordia">Ordía</a></nav></div><div class="footer-col"><h4>Legal</h4><nav aria-label="Legal"><a href="./privacidad">Política de privacidad</a><a href="./condiciones">Condiciones de uso</a><a href="./apoyar">Apoyar</a></nav></div><div class="footer-col"><h4>Contacto</h4><nav aria-label="Contacto"><a href="mailto:toolistoweb@gmail.com">toolistoweb@gmail.com</a></nav></div></div><div class="footer-bottom"><small>© 2026 ${escHtml(productShortName)} · Un producto de ${escHtml(brandName)}.</small><div class="footer-bottom-links"><a href="${escAttr(brandHref)}">${escHtml(brandName)}</a><a href="./privacidad">Privacidad</a><a href="./condiciones">Condiciones</a></div></div></div></footer>`;

function buildAccessibleHeaderNav() {
  return headerNav
    .replace('<header class="site-header">', '<a class="skip-link" href="#contenido">Saltar al contenido principal</a><header class="site-header">')
    .replace('id="menuToggle" type="button" aria-expanded="false" aria-controls="mobileNav"', 'id="menuToggle" type="button" aria-label="Abrir menú de navegación" aria-expanded="false" aria-controls="mobileNav"');
}

function buildRelatedToolGrid(tool) {
  const slugs = (tool.relatedSlugs || []).slice(0, 6);
  if (!slugs.length) return '';
  const links = slugs.map(slug => {
    const found = tools.find(t => t.slug === slug);
    if (!found || !found.enabled) return '';
    return `<a class="tool-card" data-tool="${escAttr(found.toolId)}" data-category="${escAttr(found.category)}" href="./${slug}"><span class="tool-icon">${escHtml(found.icon)}</span><span class="tool-body"><strong>${escHtml(found.name)}</strong></span><span class="tool-arrow" aria-hidden="true">→</span></a>`;
  }).filter(Boolean).join('\n');
  if (!links) return '';
  return `<section class="related-tools"><h2>Herramientas relacionadas</h2><div class="tool-grid">${links}</div><p><a href="${escAttr(catalogHref)}">Ver todas las herramientas →</a></p></section>`;
}

function buildBreadcrumbs(items) {
  const ol = items.map((item, i) => {
    if (i === items.length - 1) return `<li aria-current="page">${escHtml(item.label)}</li>`;
    return `<li><a href="${escAttr(item.href)}">${escHtml(item.label)}</a></li>`;
  }).join('\n            ');
  return `<nav aria-label="Ruta de navegación">\n  <ol class="breadcrumbs">\n    ${ol}\n  </ol>\n</nav>`;
}

function buildFAQ(faq) {
  if (!faq || !faq.length) return '';
  const items = faq.map(f => `
    <details class="faq-item">
      <summary>${escHtml(f.q)}</summary>
      <p>${escHtml(f.a)}</p>
    </details>`).join('\n');
  const faqLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faq.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": f.a
      }
    }))
  }, null, 2);
  return `<section class="faq-section"><h2>Preguntas frecuentes</h2>${items}</section>\n<script type="application/ld+json">${faqLD}</script>`;
}

function buildToolPage(tool) {
  const acceptMap = {
    image: 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tif,.tiff',
    images: 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tif,.tiff',
    pdfs: 'application/pdf',
    docs: 'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-word.document.macroenabled.12,application/vnd.openxmlformats-officedocument.wordprocessingml.template,.doc,.docx,.docm,.dot,.dotx,.dotm',
    odt: 'application/vnd.oasis.opendocument.text',
    odts: 'application/vnd.oasis.opendocument.text',
    rtf: 'text/rtf,application/rtf',
    rtfs: 'text/rtf,application/rtf',
    txts: 'text/plain,.txt,.text,.log,.csv,.tsv',
    text: 'text/plain,.txt,.text,.log,.md,.markdown',
    texts: 'text/plain,.txt,.text,.log,.md,.markdown',
    html: 'text/html,.html,.htm,.xhtml',
    css: 'text/css,.css',
    epubs: 'application/epub+zip',
    mobis: 'application/x-mobipocket-ebook',
    csvs: 'text/csv,.csv',
    excels: 'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,.xlsx',
    xls: 'application/vnd.ms-excel,.xls',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx',
    ods: 'application/vnd.oasis.opendocument.spreadsheet,.ods',
    jsons: 'application/json,.json',
    xmls: 'application/xml,text/xml,.xml',
    zip: 'application/zip,.zip',
    parts: '*/*',
    csv: 'text/csv,.csv',
    any: '*/*',
    none: '*/*',
    audios: 'audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/flac,audio/mp4,audio/webm,.mp3,.wav,.ogg,.aac,.flac,.m4a,.wma,.opus',
    audio: 'audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/flac,audio/mp4,audio/webm,.mp3,.wav,.ogg,.aac,.flac,.m4a,.wma,.opus',
    videos: 'video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/mpeg,video/3gpp,.mp4,.webm,.mov,.avi,.mkv,.mpeg,.mpg,.3gp',
    video: 'video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/mpeg,video/3gpp,.mp4,.webm,.mov,.avi,.mkv,.mpeg,.mpg,.3gp',
  };
  const multiple = tool.accepts === 'images' || tool.accepts === 'pdfs' || tool.accepts === 'docs' || tool.accepts === 'txts' || tool.accepts === 'texts' || tool.accepts === 'epubs' || tool.accepts === 'csvs' || tool.accepts === 'excels' || tool.accepts === 'jsons' || tool.accepts === 'xmls' || tool.accepts === 'any' || tool.accepts === 'audios' || tool.accepts === 'videos';

  const config = { toolId: tool.toolId };
  if (tool.inputAccept) config.inputAccept = tool.inputAccept;
  if (tool.preset) config.preset = tool.preset;
  const disabled = tool.enabled === false;
  if (disabled) config.enabled = false;

  const faqSection = buildFAQ(tool.faq);
  const relatedGridHTML = buildRelatedToolGrid(tool);

  const instructionsHTML = tool.instructions ? `<section class="instructions"><h2>Cómo funciona</h2><ol>${tool.instructions.map(i => `<li>${escHtml(i)}</li>`).join('\n')}</ol></section>` : '';
  const limitationsHTML = tool.limitations ? `<section class="limitations"><h2>Limitaciones</h2><ul>${tool.limitations.map(l => `<li>${escHtml(l)}</li>`).join('\n')}</ul></section>` : '';
  const formatsHTML = `<section class="formats-info" aria-label="Resumen de la herramienta">
    <div><span>Entrada</span><strong>${escHtml(tool.inputFormats.join(', '))}</strong></div>
    <div><span>Salida</span><strong>${escHtml(tool.outputFormats.join(', '))}</strong></div>
    <div><span>Privacidad</span><strong>Se procesa en tu navegador</strong></div>
  </section>
  <section class="tool-capability-strip" aria-label="Qué puedes hacer en esta herramienta">
    <div class="tool-capability-item"><span class="tool-capability-index">01</span><span><strong>Prepara</strong><small>Arrastra uno o varios archivos y revisa el orden antes de empezar.</small></span></div>
    <div class="tool-capability-item"><span class="tool-capability-index">02</span><span><strong>Ajusta</strong><small>Las opciones avanzadas aparecen solo cuando hacen falta.</small></span></div>
    <div class="tool-capability-item"><span class="tool-capability-index">03</span><span><strong>Entrega</strong><small>Descarga el resultado y vuelve a intentarlo sin perder el contexto.</small></span></div>
  </section>`;

  const breadcrumbs = [
    { label: brandName, href: brandHref },
    { label: productName, href: catalogHref },
    { label: tool.name, href: `./${tool.slug}` }
  ];
  const catDef = categories.find(c => c.toolIds.includes(tool.toolId));
  if (catDef) breadcrumbs.splice(2, 0, { label: catDef.name, href: `./${catDef.slug}` });

  const toolPageConfig = `<script type="application/json" id="tool-page-config">${JSON.stringify(config)}</script>`;

  return `<!doctype html>
<html lang="es-419" class="intro-pending">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(tool.title)}</title>
  <meta name="description" content="${escAttr(tool.description)}">
  <link rel="canonical" href="${site.siteUrl}/${tool.slug}">
  <meta name="robots" content="${disabled ? 'noindex, nofollow' : 'index, follow'}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escAttr(brandName)}">
  <meta property="og:title" content="${escAttr(tool.title)}">
  <meta property="og:description" content="${escAttr(tool.description)}">
  <meta property="og:url" content="${site.siteUrl}/${tool.slug}">
  <meta property="og:image" content="${site.siteUrl}${tool.ogImage || site.defaultOgImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(tool.title)}">
  <meta name="twitter:description" content="${escAttr(tool.description)}">
  <meta name="twitter:image" content="${site.siteUrl}${tool.ogImage || site.defaultOgImage}">
  <meta name="theme-color" content="${site.themeColor}">
  <link rel="icon" type="image/svg+xml" href="./assets/toolisto-mark.svg">
  ${pwaHead}
  <link rel="stylesheet" href="./styles.css?v=${ASSET_VERSION}">
  <link rel="stylesheet" href="./js/modes/modes.css?v=20260803-modes">
  ${splashCSS}
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": tool.name,
    "url": `${site.siteUrl}/${tool.slug}`,
    "description": tool.description,
    "applicationCategory": "MultimediaApplication",
    "operatingSystem": "Web Browser",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
  })}</script>
  ${buildGoogleAnalyticsTag()}
</head>
<body>
  ${splashHTML}
  ${toolPageConfig}
  <div id="toolisto-app">
    ${buildAccessibleHeaderNav()}
    ${disabled ? '<div class="tool-disabled-notice" id="toolDisabledNotice" role="alert"><b>Herramienta temporalmente en revisión</b><span>Estamos verificando esta herramienta. Mientras tanto puedes usar otras herramientas del catálogo.</span></div>' : ''}
    <main id="contenido" tabindex="-1">
      <section class="hero hero-tool" id="inicio">
        <div class="hero-inner">
          <div class="hero-left">
            ${buildBreadcrumbs(breadcrumbs)}
            <div class="tool-journey" aria-label="Pasos para usar la herramienta">
              <span class="is-active"><b>1</b>Añade</span>
              <span><b>2</b>Ajusta si quieres</span>
              <span><b>3</b>Descarga</span>
            </div>
            <h1>${escHtml(tool.h1)}</h1>
            <p>${escHtml(tool.summary)}</p>
            <p class="privacy-note">🔒 Tus archivos se quedan contigo. Se procesan en tu navegador.</p>
          </div>
          <div class="hero-right">
            <input id="intentInput" type="hidden" value="" />
            <div class="tool-action-panel">
              <div class="tool-step-header">
                <div><span class="tool-step-kicker">Paso 1</span><strong>Añade tus archivos</strong></div>
                <span class="file-status" id="fileStatus" role="status" aria-live="polite">Sin archivos seleccionados</span>
              </div>
            <div class="drop-zone" id="dropZone" role="group" aria-label="Zona para seleccionar o arrastrar archivos">
              <input id="fileInput" type="file" ${multiple ? 'multiple' : ''} accept="${escAttr(tool.inputAccept || acceptMap[tool.accepts] || '')}" hidden />
              <div class="drop-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
              <strong>Arrastra ${multiple ? 'los archivos' : 'un archivo'}</strong>
              <span>O selecciona desde tu dispositivo</span>
              <span class="formats-hint">Formatos: ${escHtml(tool.inputFormats.join(', '))}</span>
              <button class="primary-button" id="browseButton" type="button">Seleccionar archivo</button>
            </div>
            <div class="tool-input-meta"><span><b>${escHtml(tool.inputFormats.join(' · '))}</b> admitidos</span><span>Procesamiento local</span></div>
            <p class="tool-input-hint">Puedes cambiar el orden o quitar archivos antes de ejecutar.</p>
            </div>
            <div class="file-strip" id="fileStrip" hidden></div>
            <div class="smart-result" id="smartResult" hidden>
              <div class="smart-icon" id="smartIcon">${escHtml(tool.icon)}</div>
              <div class="smart-copy"><span>Acción recomendada</span><strong id="smartTitle">${escHtml(tool.name)}</strong><p id="smartDescription">${escHtml(tool.summary)}</p></div>
              <button class="text-button" id="changeToolButton" type="button">Elegir otra</button>
            </div>
            <details class="advanced-panel" id="advancedPanel" hidden><summary>Opciones de la herramienta <span>Ajustes avanzados</span></summary><div id="advancedControls" class="advanced-controls"></div></details>
            <div class="file-limit-info" id="fileLimitInfo" hidden></div>
            <div class="flow-actions" id="flowActions" hidden>
              <button class="primary-button run-button" id="runButton" type="button" disabled><span id="runButtonLabel">${escHtml(tool.name)}</span><span aria-hidden="true">→</span></button>
              <button class="quiet-button" id="clearFilesButton" type="button" hidden>Quitar archivos</button>
            </div>
            <section class="process-feedback" id="processFeedback" hidden aria-labelledby="processFeedbackTitle">
              <strong id="processFeedbackTitle">No se pudo completar la operación</strong>
              <p id="processFeedbackMessage" role="alert"></p>
              <div class="process-feedback-actions"><button class="secondary-button" id="retryButton" type="button">Reintentar</button><button type="button" class="copy-tech-btn">Copiar detalles técnicos</button></div>
            </section>
          </div>
        </div>
      </section>

      <section class="tool-content" id="content">
        ${formatsHTML}
        ${instructionsHTML}
        ${limitationsHTML}
        ${faqSection}
        ${relatedGridHTML}
      </section>
    </main>

    <dialog class="result-dialog" id="resultDialog"><div class="dialog-header"><h2 id="resultTitle">Resultado</h2><button class="dialog-close" id="dialogClose" type="button" aria-label="Cerrar">×</button></div><p id="resultMessage"></p><div class="result-stats" id="resultStats"></div><div class="preview-area" id="previewArea" hidden></div><div class="result-support" id="resultSupport" hidden><p>${escHtml(supportCfg.message || 'Si Toolisto te ha sido útil, considera apoyarnos con una donación.')}</p>${getSupportButtonHtml()}</div>${getFeedbackHtml()}<div class="dialog-actions"><button class="primary-button" id="downloadButton" type="button">Descargar</button><button class="quiet-button" id="resetButton" type="button">Cerrar</button></div></dialog>
    <dialog class="picker-dialog" id="pickerDialog"><div class="dialog-header"><h2>Elegir herramienta</h2><button class="dialog-close" id="pickerClose" type="button" aria-label="Cerrar">×</button></div><div class="picker-grid" id="pickerGrid"></div></dialog>
    ${footerHTML}
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
  <script src="./vendor/js/qrcode-gen.js"></script>
  <script src="./vendor/js/barcode-gen.js"></script>
  <script src="./vendor/js/jsqr.js"></script>
  <script src="./js/ocr/pdf-ocr-engine.js"></script>
  <script src="./js/security/pdf-censor-engine.js"></script>
  <script src="./js/security/pdf-encryptor.js"></script>
  <script src="./js/math/expression-parser.js"></script>
  <script src="./js/accessibility/braille-es.js"></script>
  <script src="./js/metadata/photo-location.js"></script>
  <script src="./js/file-limits.js"></script>
  <script src="./js/tool-processors.js"></script>
  ${appJsTag('./js/')}
  ${pwaScript}
  <script src="./js/modes/mode-core.js"></script>
  <script src="./js/modes/calc.js"></script>
  <script src="./js/modes/structure.js"></script>
  <script src="./js/modes/file.js"></script>
  <script src="./js/modes/qr.js"></script>
  <script src="./js/modes/excel.js"></script>
  ${splashScript}
</body>
</html>`;
}

function buildCategoryPage(cat) {
  const catTools = cat.slugs.map(slug => tools.find(t => t.slug === slug)).filter(t => t && t.enabled);

  const toolListHTML = catTools.map(t => {
    return `<li class="category-tool-item"><a href="./${t.slug}"><strong>${escHtml(t.name)}</strong></a><p>${escHtml(t.summary)}</p></li>`;
  }).join('\n');

  const breadcrumbs = [
    { label: brandName, href: brandHref },
    { label: productName, href: catalogHref },
    { label: cat.name, href: `./${cat.slug}` }
  ];

  return `<!doctype html>
<html lang="es-419" class="intro-pending">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(cat.name)} - Herramientas online | Toolisto</title>
  <meta name="description" content="${escAttr(cat.description)}">
  <link rel="canonical" href="${site.siteUrl}/${cat.slug}">
  <meta name="robots" content="index, follow">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escAttr(brandName)}">
  <meta property="og:title" content="${escAttr(cat.name)} - Herramientas online | Toolisto">
  <meta property="og:description" content="${escAttr(cat.description)}">
  <meta property="og:url" content="${site.siteUrl}/${cat.slug}">
  <meta property="og:image" content="${site.siteUrl}${site.defaultOgImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(cat.name)} - Herramientas online | Toolisto">
  <meta name="twitter:description" content="${escAttr(cat.description)}">
  <meta name="twitter:image" content="${site.siteUrl}${site.defaultOgImage}">
  <meta name="theme-color" content="${site.themeColor}">
  <link rel="icon" type="image/svg+xml" href="./assets/toolisto-mark.svg">
  ${pwaHead}
  <link rel="stylesheet" href="./styles.css?v=${ASSET_VERSION}">
  ${splashCSS}
  ${buildGoogleAnalyticsTag()}
</head>
<body>
  ${splashHTML}
  <div id="toolisto-app">
    ${buildAccessibleHeaderNav()}
    <main id="contenido" tabindex="-1">
      <section class="hero" id="inicio">
        <div class="hero-inner"><div class="hero-left">
          ${buildBreadcrumbs(breadcrumbs)}
          <h1>${escHtml(cat.icon)} ${escHtml(cat.name)}</h1>
          <p>${escHtml(cat.description)}</p>
        </div></div>
      </section>
      <section class="category-tools">
        <h2>Herramientas de ${escHtml(cat.name)}</h2>
        <ul class="category-tool-list">${toolListHTML}</ul>
      </section>
    </main>
    ${footerHTML}
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
  ${appJsTag('./js/')}
  ${pwaScript}
  ${splashScript}
</body>
</html>`;
}

function build404Page() {
  const popularTools = ['comprimir-imagen', 'unir-pdf', 'convertir-imagen', 'dividir-pdf', 'comprimir-imagenes'];
  const links = popularTools.map(slug => {
    const t = tools.find(x => x.slug === slug && x.enabled);
    return t ? `<li><a href="./${t.slug}">${escHtml(t.name)}</a></li>` : '';
  }).filter(Boolean).join('\n');

  const catLinks = categories.filter(c => c.enabled).map(c =>
    `<li><a href="./${c.slug}">${escHtml(c.name)}</a></li>`
  ).join('\n');

  return `<!doctype html>
<html lang="es-419" class="intro-pending">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página no encontrada | Toolisto</title>
  <meta name="description" content="La página que buscas no existe. Explora las herramientas de Toolisto.">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="./assets/toolisto-mark.svg">
  ${pwaHead}
  <link rel="stylesheet" href="./styles.css?v=${ASSET_VERSION}">
  ${splashCSS}
  ${buildGoogleAnalyticsTag()}
</head>
<body>
  ${splashHTML}
  <div id="toolisto-app">
    ${buildAccessibleHeaderNav()}
    <main id="contenido" tabindex="-1">
      <section class="hero" id="inicio">
        <div class="hero-inner"><div class="hero-left">
          <h1>404 — Página no encontrada</h1>
          <p>La página que buscas no existe o fue movida. Puedes volver a ${escHtml(brandName)} o explorar las herramientas de ${escHtml(productShortName)}.</p>
          <a class="primary-button" href="${escAttr(catalogHref)}" style="display:inline-block;margin-top:1rem;">Explorar herramientas</a>
          <a class="quiet-button" href="${escAttr(brandHref)}" style="display:inline-block;margin-top:1rem;">Ir a ${escHtml(brandName)}</a>
        </div></div>
      </section>
      <section class="error-content">
        <h2>Herramientas populares</h2>
        <ul>${links}</ul>
        <h2>Categorías</h2>
        <ul>${catLinks}</ul>
        <div style="margin-top:1.5rem">
          <h2>Buscar herramienta</h2>
          <input id="toolSearch" type="search" placeholder="Escribe el nombre de una herramienta…" aria-label="Buscar herramientas" style="width:100%;max-width:400px;padding:.6rem 1rem;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.95rem;" />
        </div>
      </section>
    </main>
    ${footerHTML}
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
  ${appJsTag('./js/')}
  ${pwaScript}
  ${splashScript}
</body>
</html>`;
}

function buildLegalPage(slug, title, description, sections) {
  const contentHTML = sections.map(s =>
    `<section class="legal-section"><h2>${escHtml(s.heading)}</h2>${s.body}</section>`
  ).join('\n');

  const breadcrumbs = [
    { label: brandName, href: brandHref },
    { label: productName, href: catalogHref },
    { label: title, href: `./${slug}` }
  ];

  return `<!doctype html>
<html lang="es-419" class="intro-pending">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)} | Toolisto</title>
  <meta name="description" content="${escAttr(description)}">
  <link rel="canonical" href="${site.siteUrl}/${slug}">
  <meta name="robots" content="index, follow">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escAttr(brandName)}">
  <meta property="og:title" content="${escAttr(title)} | Toolisto">
  <meta property="og:description" content="${escAttr(description)}">
  <meta property="og:url" content="${site.siteUrl}/${slug}">
  <meta property="og:image" content="${site.siteUrl}${site.defaultOgImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(title)} | Toolisto">
  <meta name="twitter:description" content="${escAttr(description)}">
  <meta name="twitter:image" content="${site.siteUrl}${site.defaultOgImage}">
  <meta name="theme-color" content="${site.themeColor}">
  <link rel="icon" type="image/svg+xml" href="./assets/toolisto-mark.svg">
  ${pwaHead}
  <link rel="stylesheet" href="./styles.css?v=${ASSET_VERSION}">
  ${splashCSS}
  ${buildGoogleAnalyticsTag()}
</head>
<body>
  ${splashHTML}
  <div id="toolisto-app">
    ${buildAccessibleHeaderNav()}
    <main id="contenido" tabindex="-1">
      <section class="hero" id="inicio">
        <div class="hero-inner"><div class="hero-left">
          ${buildBreadcrumbs(breadcrumbs)}
          <h1>${escHtml(title)}</h1>
        </div></div>
      </section>
      <section class="legal-content">
        ${contentHTML}
      </section>
    </main>
    ${footerHTML}
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
  ${appJsTag('./js/')}
  ${pwaScript}
  ${splashScript}
</body>
</html>`;
}

function buildApoyarPage() {
  const paypalUrl = supportCfg.url || 'https://www.paypal.com/donate/?hosted_button_id=ZSSG3LJQRW3EQ';
  const supportMsg = supportCfg.message || 'Si Toolisto te ha sido útil, considera apoyarnos con una donación.';

  const breadcrumbs = [
    { label: brandName, href: brandHref },
    { label: productName, href: catalogHref },
    { label: 'Apoyar', href: './apoyar' }
  ];

  return `<!doctype html>
<html lang="es-419" class="intro-pending">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apoyar Toolisto | Donaciones</title>
  <meta name="description" content="Apoya a Toolisto con una donación para seguir mejorando las herramientas.">
  <link rel="canonical" href="${site.siteUrl}/apoyar">
  <meta name="robots" content="index, follow">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escAttr(brandName)}">
  <meta property="og:title" content="Apoyar Toolisto | Donaciones">
  <meta property="og:description" content="Apoya a Toolisto con una donación para seguir mejorando las herramientas.">
  <meta property="og:url" content="${site.siteUrl}/apoyar">
  <meta property="og:image" content="${site.siteUrl}${site.defaultOgImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Apoyar Toolisto | Donaciones">
  <meta name="twitter:description" content="Apoya a Toolisto con una donación para seguir mejorando las herramientas.">
  <meta name="twitter:image" content="${site.siteUrl}${site.defaultOgImage}">
  <meta name="theme-color" content="${site.themeColor}">
  <link rel="icon" type="image/svg+xml" href="./assets/toolisto-mark.svg">
  ${pwaHead}
  <link rel="stylesheet" href="./styles.css?v=${ASSET_VERSION}">
  ${splashCSS}
  ${buildGoogleAnalyticsTag()}
</head>
<body>
  ${splashHTML}
  <div id="toolisto-app">
    ${buildAccessibleHeaderNav()}
    <main id="contenido" tabindex="-1">
      <section class="hero" id="inicio">
        <div class="hero-inner"><div class="hero-left">
          ${buildBreadcrumbs(breadcrumbs)}
          <h1>Apoyar Toolisto</h1>
          <p>${escHtml(supportMsg)}</p>
          <a class="support-donate-btn support-donate-btn--large" href="${escAttr(paypalUrl)}" target="_blank" rel="noopener noreferrer">Apoyar con PayPal</a>
        </div></div>
      </section>
      <section class="legal-content">
        <section class="legal-section">
          <h2>¿Por qué donar?</h2>
          <p>Toolisto es una herramienta gratuita que funciona directamente en tu navegador. No mostramos publicidad ni vendemos tus datos. Cada donación nos ayuda a seguir mejorando y manteniendo las herramientas.</p>
        </section>
        <section class="legal-section">
          <h2>¿Cómo funciona?</h2>
          <p>Haz clic en el botón de PayPal y completa la donación con la cantidad que prefieras. No necesitas crear una cuenta en Toolisto.</p>
        </section>
      </section>
    </main>
    ${footerHTML}
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
  ${appJsTag('./js/')}
  ${pwaScript}
  ${splashScript}
</body>
</html>`;
}

function buildSitemap() {
  const urls = [
    { loc: `${site.siteUrl}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: catalogUrl, changefreq: 'weekly', priority: '0.9' },
    { loc: `${site.siteUrl}/privacidad`, changefreq: 'monthly', priority: '0.3' },
    { loc: `${site.siteUrl}/condiciones`, changefreq: 'monthly', priority: '0.3' },
    { loc: `${site.siteUrl}/apoyar`, changefreq: 'monthly', priority: '0.4' }
  ];
  categories.filter(c => c.enabled).forEach(c => {
    urls.push({ loc: `${site.siteUrl}/${c.slug}`, changefreq: 'weekly', priority: '0.8' });
  });
  tools.filter(t => t.enabled && t.indexable && t.enabledInSitemap).forEach(t => {
    urls.push({ loc: `${site.siteUrl}/${t.slug}`, changefreq: 'monthly', priority: '0.7', lastmod: t.lastModified });
  });
  const items = urls.map(u => {
    let xml = `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>`;
    if (u.lastmod) xml += `\n    <lastmod>${u.lastmod}</lastmod>`;
    xml += `\n  </url>`;
    return xml;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

function buildRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${site.siteUrl}/sitemap.xml`;
}

function buildRedirects() {
  const cleanCatalogRoutes = [
    `${catalogPath} ${catalogPath}.html 200`,
    `${catalogPath}/ ${catalogPath}.html 200`,
  ];
  return [...cleanCatalogRoutes, ...redirects.map(r => `${r.from} ${r.to} ${r.code}`)].join('\n') + '\n';
}

const pages = [];

tools.filter(t => t.indexable).forEach(t => {
  const html = buildToolPage(t);
  const file = join(DIST, `${t.slug}.html`);
  writeFileSync(file, html, 'utf-8');
  pages.push(t.slug);
  console.log(`  ✓ ${t.slug}.html`);
});

categories.filter(c => c.enabled).forEach(c => {
  const html = buildCategoryPage(c);
  const file = join(DIST, `${c.slug}.html`);
  writeFileSync(file, html, 'utf-8');
  pages.push(c.slug);
  console.log(`  ✓ ${c.slug}.html (category)`);
});

writeFileSync(join(DIST, '404.html'), build404Page(), 'utf-8');
console.log('  ✓ 404.html');

const privacySections = [
  { heading: 'Privacidad', body: '<p>Toolisto procesa todos los archivos directamente en tu navegador. Ningún archivo se sube a nuestros servidores ni se almacena en ningún lugar externo.</p><p>No recopilamos información personal identificable a menos que tú nos contactes directamente por correo electrónico.</p>' },
  { heading: 'Cookies y tecnologías de seguimiento', body: '<p>Toolisto no utiliza cookies propias. Si se habilita Google Analytics en el futuro, se utilizarán cookies de terceros para fines estadísticos. Puedes desactivar el seguimiento desde las configuraciones de tu navegador.</p>' },
  { heading: 'Servicios de terceros', body: '<p>Toolisto puede utilizar servicios de terceros como Google Fonts para el diseño visual. Estos servicios pueden recopilar información de forma independiente según sus propias políticas de privacidad.</p>' },
  { heading: 'Contacto', body: '<p>Si tienes preguntas sobre esta política de privacidad, puedes escribirnos a <a href="mailto:toolistoweb@gmail.com">toolistoweb@gmail.com</a>.</p>' },
  { heading: 'Última actualización', body: `<p>Esta política fue última vez actualizada el ${TODAY}.</p>` }
];
writeFileSync(join(DIST, 'privacidad.html'), buildLegalPage('privacidad', 'Política de Privacidad', 'Conoce cómo Toolisto procesa tus archivos localmente en tu navegador y protege tu privacidad.', privacySections), 'utf-8');
console.log('  ✓ privacidad.html');

const conditionsSections = [
  { heading: 'Condiciones de uso', body: '<p>El uso de Toolisto implica la aceptación de las siguientes condiciones. Toolisto proporciona herramientas gratuitas de procesamiento de archivos que funcionan directamente en el navegador del usuario.</p>' },
  { heading: 'Uso del servicio', body: '<p>Toolisto es gratuito y no requiere registro. El usuario es responsable del contenido que procesa. Toolisto no se hace responsable del uso que se haga de las herramientas proporcionadas.</p>' },
  { heading: 'Propiedad intelectual', body: '<p>El código fuente de Toolisto es de código abierto. Las herramientas se proporcionan "tal cual" sin garantías de ningún tipo.</p>' },
  { heading: 'Limitación de responsabilidad', body: '<p>En ningún caso Toolisto será responsable por daños directos, indirectos, incidentales o consecuentes derivados del uso o la imposibilidad de uso de las herramientas.</p>' },
  { heading: 'Cambios en las condiciones', body: '<p>Toolisto se reserva el derecho de modificar estas condiciones en cualquier momento. Los cambios serán efectivos desde su publicación en esta página.</p>' },
  { heading: 'Última actualización', body: `<p>Estas condiciones fueron última vez actualizadas el ${TODAY}.</p>` }
];
writeFileSync(join(DIST, 'condiciones.html'), buildLegalPage('condiciones', 'Condiciones de Uso', 'Consulta las condiciones de uso de las herramientas gratuitas y locales de Toolisto.', conditionsSections), 'utf-8');
console.log('  ✓ condiciones.html');

writeFileSync(join(DIST, 'apoyar.html'), buildApoyarPage(), 'utf-8');
console.log('  ✓ apoyar.html');
writeFileSync(join(DIST, 'sitemap.xml'), buildSitemap(), 'utf-8');
console.log('  ✓ sitemap.xml');
writeFileSync(join(DIST, 'robots.txt'), buildRobots(), 'utf-8');
console.log('  ✓ robots.txt');
writeFileSync(join(DIST, '_redirects'), buildRedirects(), 'utf-8');
console.log('  ✓ _redirects');
writeFileSync(join(DIST, 'site.json'), JSON.stringify(site, null, 2), 'utf-8');
console.log('  ✓ site.json');
writeFileSync(join(DIST, '.nojekyll'), '', 'utf-8');
console.log('  ✓ .nojekyll');
const headersSrc = join(ROOT, '_headers');
if (existsSync(headersSrc)) { cpSync(headersSrc, join(DIST, '_headers')); console.log('  ✓ _headers'); }

console.log(`\nBuild complete. ${pages.length} pages generated in dist/.`);

const requiredFiles = [
  join(DIST, 'toolisto.html'),
  join(DIST, 'styles.css'),
  join(DIST, 'js', 'app.js'),
  join(DIST, 'js', 'pwa-register.js'),
  join(DIST, 'service-worker.js'),
];
if (includeWorkspaceRuntime) {
  requiredFiles.push(join(DIST, 'workspace', 'preview.html'));
}
const requiredDirs = [
  join(DIST, 'assets'),
];
let buildFailed = false;
for (const f of requiredFiles) {
  if (!existsSync(f)) {
    console.error(`FAIL: required file missing: ${f}`);
    buildFailed = true;
  }
}
for (const d of requiredDirs) {
  if (!existsSync(d)) {
    console.error(`FAIL: required directory missing: ${d}`);
    buildFailed = true;
  }
}
if (buildFailed) {
  console.error('\nBuild validation FAILED. Missing critical files.');
  process.exit(1);
}
console.log('Build validation OK: all required files present.');
