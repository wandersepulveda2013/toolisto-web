#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  absoluteUrl,
  escapeHtml,
  renderCta,
  renderPage,
  renderProductHero,
  renderProductStatus
} from './apluno-components.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(scriptDir, '..');
const DIST = join(ROOT, 'dist');
const APLUNO_SRC = join(ROOT, 'src', 'apluno');
const DATA = join(ROOT, 'src', 'data');
const APLUNO_ASSETS = join(DIST, 'apluno-assets');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePage(pathname, html) {
  const target = join(DIST, pathname);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
  console.log(`  ✓ ${pathname.replace(/\\/g, '/')}`);
}

const apluno = loadJson(join(DATA, 'apluno.products.json'));
const tools = loadJson(join(DATA, 'tools.json'));
const categories = loadJson(join(DATA, 'categories.json'));
const redirects = loadJson(join(DATA, 'redirects.json'));
const enabledTools = tools.filter((tool) => tool.enabled);
const indexableTools = tools.filter((tool) => tool.enabled && tool.indexable && tool.enabledInSitemap);
const enabledCategories = categories.filter((category) => category.enabled);
const products = Object.fromEntries(apluno.products.map((product) => [product.id, product]));
const hasSocialImage = existsSync(join(APLUNO_SRC, 'assets', 'og.png'));

mkdirSync(DIST, { recursive: true });
mkdirSync(APLUNO_ASSETS, { recursive: true });
cpSync(join(APLUNO_SRC, 'styles.css'), join(APLUNO_ASSETS, 'apluno.css'));
cpSync(join(APLUNO_SRC, 'app.js'), join(APLUNO_ASSETS, 'apluno.js'));
cpSync(join(APLUNO_SRC, 'manifest.webmanifest'), join(DIST, 'manifest.webmanifest'));
if (existsSync(join(APLUNO_SRC, 'assets'))) {
  cpSync(join(APLUNO_SRC, 'assets'), APLUNO_ASSETS, { recursive: true });
}

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Apluno',
  url: absoluteUrl('/'),
  logo: absoluteUrl('/apluno-assets/icon-512.png'),
  email: apluno.site.email,
  brand: apluno.products.map((product) => ({
    '@type': 'Brand',
    name: product.name,
    url: absoluteUrl(product.href)
  }))
};

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Apluno',
  url: absoluteUrl('/'),
  inLanguage: apluno.site.locale,
  potentialAction: {
    '@type': 'SearchAction',
    target: `${absoluteUrl('/toolisto')}?q={search_term_string}`,
    'query-input': 'required name=search_term_string'
  }
};

function pageOptions(options) {
  return { socialImage: hasSocialImage, ...options };
}

const LAUNCHER_CATEGORY_LABELS = {
  pdf: 'PDF',
  images: 'Imágenes',
  documents: 'Documentos',
  spreadsheets: 'Excel',
  text: 'Texto',
  qrcodes: 'QR',
  signatures: 'Firmas',
  ebooks: 'EPUB',
  files: 'Archivos',
  video: 'Video',
  audio: 'Audio',
  calculators: 'Calculadoras'
};

const PRIMARY_CATEGORIES = ['pdf', 'images', 'documents', 'spreadsheets', 'text', 'qrcodes', 'signatures'];

const POPULAR_SLUGS = [
  'unir-pdf',
  'dividir-pdf',
  'comprimir-pdf',
  'firmar-pdf',
  'imagenes-a-pdf',
  'comprimir-imagen',
  'convertir-imagen',
  'jpg-a-png',
  'word-a-pdf',
  'excel-a-csv',
  'generar-qr',
  'extraer-zip'
];

buildLauncherData();

function buildLauncherData() {
  const categoryById = Object.fromEntries(enabledCategories.map((category) => [category.id, category]));
  const enabledSlugs = new Set(enabledTools.map((tool) => tool.slug));

  for (const slug of POPULAR_SLUGS) {
    if (!enabledSlugs.has(slug)) {
      throw new Error(`buildLauncherData: POPULAR_SLUGS referencia "${slug}", que no existe o está deshabilitada en tools.json`);
    }
  }
  for (const category of enabledCategories) {
    if (!LAUNCHER_CATEGORY_LABELS[category.id]) {
      throw new Error(`buildLauncherData: falta etiqueta de launcher para la categoría "${category.id}"`);
    }
  }
  for (const tool of enabledTools) {
    if (!categoryById[tool.category]) {
      throw new Error(`buildLauncherData: la herramienta "${tool.slug}" referencia una categoría inexistente "${tool.category}"`);
    }
  }

  const toolsData = enabledTools.map((tool) => ({
    slug: tool.slug,
    href: `/${tool.slug}`,
    toolId: tool.toolId,
    category: tool.category,
    name: tool.name,
    summary: tool.summary,
    inputFmt: Array.isArray(tool.inputFormats) ? tool.inputFormats.join(',') : String(tool.inputFormats || ''),
    outputFmt: Array.isArray(tool.outputFormats) ? tool.outputFormats.join(',') : String(tool.outputFormats || ''),
    keywords: Array.isArray(tool.keywords) ? tool.keywords.join(' ') : String(tool.keywords || '')
  }));

  const categoriesData = enabledCategories.map((category) => ({
    id: category.id,
    label: LAUNCHER_CATEGORY_LABELS[category.id] || category.name,
    primary: PRIMARY_CATEGORIES.includes(category.id),
    href: `/${category.slug}`
  }));

  const payload = { tools: toolsData, categories: categoriesData, popular: POPULAR_SLUGS };
  const script = `window.APLUNO_TOOLS = ${JSON.stringify(payload).replace(/</g, '\\u003c')};\n`;
  writeFileSync(join(APLUNO_ASSETS, 'apluno-tools-data.js'), script, 'utf8');
  console.log(`  ✓ apluno-assets/apluno-tools-data.js (${toolsData.length} tools, ${categoriesData.length} categorías, ${POPULAR_SLUGS.length} populares)`);
  return payload;
}

function renderChips() {
  const primary = enabledCategories.filter((category) => PRIMARY_CATEGORIES.includes(category.id));
  const secondary = enabledCategories.filter((category) => !PRIMARY_CATEGORIES.includes(category.id));
  const chip = (id, label, { active = false, more = false } = {}) => {
    const dataAttrs = more
      ? ' data-launcher-more aria-expanded="false" aria-label="Ver más categorías"'
      : ` data-launcher-category="${escapeHtml(id)}"${active ? ' aria-pressed="true"' : ''}`;
    return `<button type="button" class="apluno-chip${active ? ' is-active' : ''}${more ? ' apluno-chip--more' : ''}"${dataAttrs}>${escapeHtml(label)}</button>`;
  };
  const primaryChips = primary.map((category) => chip(category.id, LAUNCHER_CATEGORY_LABELS[category.id])).join('');
  const secondaryChips = secondary.map((category) => chip(category.id, LAUNCHER_CATEGORY_LABELS[category.id])).join('');
  return `<div class="apluno-launcher-chips" data-launcher-chips role="group" aria-label="Filtrar herramientas por categoría">
    ${chip('all', 'Todas', { active: true })}
    ${primaryChips}
    ${chip('', 'Más', { more: true })}
    <div class="apluno-chips-more" hidden>${secondaryChips}</div>
  </div>`;
}

function renderHome() {
  const content = `<section class="apluno-launcher" aria-labelledby="apluno-launcher-title">
      <div class="apluno-launcher-copy">
        <p class="apluno-launcher-eyebrow">APLUNO · Herramientas online gratuitas</p>
        <h1 id="apluno-launcher-title">¿Qué necesitas hacer?</h1>
        <p class="apluno-launcher-tagline">Menos pasos. Más hecho.</p>
      </div>
      <form class="apluno-launcher-search" id="apluno-launcher-search" role="search" action="/toolisto" method="get">
        <label class="apluno-visually-hidden" for="apluno-search-input">Buscar herramienta</label>
        <span class="apluno-launcher-search-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </span>
        <input id="apluno-search-input" name="q" type="search" placeholder="Unir PDF, convertir imágenes, limpiar archivos…" autocomplete="off" spellcheck="false" enterkeyhint="search">
        <button class="apluno-launcher-search-clear" type="button" data-launcher-clear aria-label="Limpiar búsqueda" hidden>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <button class="apluno-launcher-search-go" type="submit" aria-label="Buscar">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </form>
      ${renderChips()}
      <div class="apluno-launcher-results" aria-live="polite" aria-atomic="false">
        <p class="apluno-launcher-status" data-launcher-status aria-hidden="true"></p>
        <ul class="apluno-launcher-list" id="apluno-launcher-list" data-launcher-list></ul>
        <p class="apluno-launcher-empty" data-launcher-empty hidden>No encontramos una herramienta para esa búsqueda. Prueba con otras palabras, como «unir», «convertir» o «comprimir».</p>
      </div>
      <p class="apluno-launcher-all" data-launcher-all><a href="/toolisto">Ver las ${enabledTools.length} herramientas disponibles</a></p>
    </section>`;

  return renderPage(pageOptions({
    title: 'APLUNO — Herramientas online para PDF, imágenes y archivos',
    description: 'Busca y usa herramientas online gratuitas para PDF, imágenes, documentos, hojas de cálculo, QR y más. Todo en tu navegador, sin registro.',
    pathname: '/',
    active: '',
    bodyClass: 'apluno-home apluno-launcher-page',
    content,
    schemas: [organizationSchema, websiteSchema],
    header: 'launcher',
    footer: 'minimal',
    headScripts: ['/js/smart-search.js', '/apluno-assets/apluno-tools-data.js']
  }));
}

function renderAbout() {
  const content = `<section class="apluno-page-hero apluno-section" data-reveal>
      <p class="apluno-eyebrow">Acerca de Apluno</p>
      <h1>Software que se aparta del camino.</h1>
      <p>Apluno crea productos digitales diseñados para reducir fricción, pasos innecesarios y complejidad.</p>
    </section>
    <section class="apluno-section apluno-about-statement" data-reveal>
      <p class="apluno-section-number">01 / Por qué</p>
      <div>
        <h2>No estamos construyendo una historia corporativa. Estamos construyendo productos útiles.</h2>
        <p>Toolisto ya resuelve tareas cotidianas con archivos. Workspace y Ordía siguen en desarrollo. Apluno existe para darles una dirección común sin fingir que el trabajo pendiente ya está terminado.</p>
      </div>
    </section>
    <section class="apluno-section apluno-values" aria-labelledby="values-title">
      <div class="apluno-section-heading" data-reveal>
        <p class="apluno-eyebrow">02 / Principios</p>
        <h2 id="values-title">Tres decisiones que guían el producto.</h2>
      </div>
      <div class="apluno-values-grid">
        <article data-reveal><span>01</span><h3>Claridad antes que espectáculo.</h3><p>La interfaz debe explicar qué hace y qué ocurrirá después.</p></article>
        <article data-reveal><span>02</span><h3>Menos configuración manual.</h3><p>El producto debe asumir trabajo útil, no trasladárselo al usuario.</p></article>
        <article data-reveal><span>03</span><h3>Promesas que se pueden demostrar.</h3><p>Lo disponible se puede usar. Lo que sigue en desarrollo se presenta como tal.</p></article>
      </div>
    </section>
    <section class="apluno-section apluno-page-cta" data-reveal>
      <h2>Empieza por lo que ya funciona.</h2>
      <p>Toolisto está disponible ahora.</p>
      ${renderCta({ href: '/toolisto', label: 'Explorar herramientas', tone: 'dark' })}
    </section>`;

  return renderPage(pageOptions({
    title: 'Acerca de Apluno — Productos digitales más simples',
    description: 'Apluno crea productos digitales diseñados para reducir fricción, pasos innecesarios y complejidad.',
    pathname: '/about/',
    active: 'about',
    bodyClass: 'apluno-about',
    content,
    schemas: [{ '@context': 'https://schema.org', '@type': 'AboutPage', name: 'Acerca de Apluno', url: absoluteUrl('/about/'), about: organizationSchema }]
  }));
}

function renderOrdia() {
  const product = products.ordia;
  const content = `${renderProductHero({
      product,
      eyebrow: 'Ordía / Producto 03',
      title: 'Que organizarte no sea otra tarea.',
      description: 'Ordía está pensado para ayudarte a mantener el control de tu día sin obligarte a configurar un sistema complicado.',
      note: 'Estamos construyendo Ordía. Aún no está disponible para descargar.'
    })}
    <section class="apluno-section apluno-product-thesis" data-reveal>
      <p class="apluno-section-number">01 / Idea central</p>
      <div><h2>Menos organización manual.<br>Más ayuda automática.</h2><p>La organización suele fallar cuando mantener el sistema consume tanta energía como hacer el trabajo. Ordía busca reducir esa carga, especialmente para quienes son inconsistentes, se distraen o simplemente no quieren administrar otra herramienta.</p></div>
    </section>
    <section class="apluno-section apluno-direction" aria-labelledby="ordia-direction">
      <div class="apluno-section-heading" data-reveal><p class="apluno-eyebrow">02 / Dirección de producto</p><h2 id="ordia-direction">Lo que estamos explorando.</h2><p>Estas son áreas de trabajo, no funciones anunciadas como terminadas.</p></div>
      <div class="apluno-direction-grid">
        <article data-reveal><span>01</span><h3>Capturar sin detenerte.</h3><p>Tareas, notas e ideas deberían entrar rápido, antes de que se pierdan.</p></article>
        <article data-reveal><span>02</span><h3>Entender qué importa ahora.</h3><p>Menos listas que revisar y más contexto para decidir el siguiente paso.</p></article>
        <article data-reveal><span>03</span><h3>Volver sin culpa.</h3><p>Un sistema que ayude a retomar el ritmo cuando la rutina se rompe.</p></article>
      </div>
    </section>
    <section class="apluno-section apluno-development-note" data-reveal><span aria-hidden="true"></span><div><p class="apluno-eyebrow">Estado actual</p><h2>En desarrollo.</h2><p>No hay descarga, fecha de lanzamiento ni lista de espera activa por ahora.</p></div></section>`;

  return renderPage(pageOptions({
    title: 'Ordía — Que organizarte no sea otra tarea | Apluno',
    description: 'Ordía es una aplicación en desarrollo para ayudarte a mantener el control con menos organización manual y más ayuda automática.',
    pathname: '/ordia/',
    bodyClass: 'apluno-product-page apluno-ordia',
    content,
    schemas: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Ordía', url: absoluteUrl('/ordia/'), description: product.description, isPartOf: websiteSchema }]
  }));
}

function renderWorkspace() {
  const product = products.workspace;
  const content = `${renderProductHero({
      product,
      eyebrow: 'Toolisto Workspace / Producto 02',
      title: 'Tus archivos, herramientas y flujos. Juntos.',
      description: 'Estamos construyendo un espacio de trabajo para reunir procesos que hoy requieren abrir herramientas y archivos por separado.',
      note: 'Workspace sigue en desarrollo y su acceso público permanece cerrado.'
    })}
    <section class="apluno-section apluno-product-thesis" data-reveal>
      <p class="apluno-section-number">01 / Concepto</p>
      <div><h2>Un lugar para continuar el trabajo, no para empezarlo de nuevo.</h2><p>La dirección de Workspace es permitir que varios archivos, utilidades y resultados convivan en un mismo contexto. La meta es reducir tareas repetitivas y hacer más natural encadenar procesos.</p></div>
    </section>
    <section class="apluno-section apluno-direction" aria-labelledby="workspace-direction">
      <div class="apluno-section-heading" data-reveal><p class="apluno-eyebrow">02 / En construcción</p><h2 id="workspace-direction">Una dirección, todavía no una promesa terminada.</h2><p>Estamos trabajando en estas áreas sin presentarlas como disponibles aún.</p></div>
      <div class="apluno-direction-grid">
        <article data-reveal><span>01</span><h3>Trabajar con varios archivos.</h3><p>Mantener documentos y resultados relacionados dentro de un mismo espacio.</p></article>
        <article data-reveal><span>02</span><h3>Encadenar herramientas.</h3><p>Usar la salida de un proceso como punto de partida del siguiente.</p></article>
        <article data-reveal><span>03</span><h3>Repetir menos.</h3><p>Organizar flujos que simplifiquen tareas recurrentes sin ocultar lo que ocurre.</p></article>
      </div>
    </section>
    <section class="apluno-section apluno-development-note" data-reveal><span aria-hidden="true"></span><div><p class="apluno-eyebrow">Estado actual</p><h2>En desarrollo.</h2><p>No hay acceso público ni fecha de lanzamiento anunciada.</p></div></section>`;

  return renderPage(pageOptions({
    title: 'Toolisto Workspace — Archivos, herramientas y flujos | Apluno',
    description: 'Toolisto Workspace es un espacio de trabajo en desarrollo para reunir archivos, herramientas y flujos desde un mismo lugar.',
    pathname: '/workspace/',
    bodyClass: 'apluno-product-page apluno-workspace',
    content,
    schemas: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Toolisto Workspace', url: absoluteUrl('/workspace/'), description: product.description, isPartOf: websiteSchema }]
  }));
}

function renderContact() {
  const email = escapeHtml(apluno.site.email);
  const content = `<section class="apluno-page-hero apluno-section" data-reveal><p class="apluno-eyebrow">Contacto</p><h1>Hablemos con claridad.</h1><p>Para preguntas, comentarios o asuntos relacionados con Apluno y Toolisto, puedes escribirnos por correo.</p></section>
    <section class="apluno-section apluno-contact-card" data-reveal><div><p class="apluno-eyebrow">Correo actual</p><a href="mailto:${email}">${email}</a></div><p>Usamos esta dirección mientras consolidamos la identidad pública de Apluno. No hay oficinas, equipos de ventas ni canales corporativos adicionales que anunciar por ahora.</p></section>`;
  return renderPage(pageOptions({
    title: 'Contacto — Apluno',
    description: 'Contacta con Apluno para preguntas y comentarios sobre sus productos digitales.',
    pathname: '/contact/',
    bodyClass: 'apluno-contact',
    content,
    schemas: [{ '@context': 'https://schema.org', '@type': 'ContactPage', name: 'Contacto — Apluno', url: absoluteUrl('/contact/') }]
  }));
}

function renderPrivacy() {
  const content = `<section class="apluno-page-hero apluno-section" data-reveal><p class="apluno-eyebrow">Legal / Privacidad</p><h1>Privacidad, explicada sin rodeos.</h1><p>Última actualización: 17 de agosto de 2026.</p></section>
    <section class="apluno-section apluno-legal-copy">
      <article data-reveal><h2>El sitio de Apluno</h2><p>Apluno no requiere una cuenta para visitar sus páginas públicas. En las páginas públicas de navegación y catálogo (portada, catálogo de herramientas y páginas de categorías) Apluno puede usar Google AdSense para mostrar anuncios. Google puede utilizar cookies u otros identificadores para la publicación y medición de anuncios, conforme a las opciones de consentimiento aplicables y a la configuración del navegador.</p></article>
      <article data-reveal><h2>Herramientas de archivos (Toolisto)</h2><p>Las herramientas de Toolisto están diseñadas para procesar los archivos en tu navegador. Apluno no recibe ni almacena el contenido que seleccionas para procesar. Por ahora, el código publicitario de Google AdSense no se incluye en las páginas donde Toolisto procesa archivos, y Apluno no envía a Google el contenido de los archivos que seleccionas para procesar. Algunas funciones pueden descargar librerías necesarias para operar, pero tus archivos no se envían con ese fin.</p></article>
      <article data-reveal><h2>Analítica</h2><p>Google Analytics no está activo en este sitio. Si se habilita en el futuro, se actualizará esta página antes de presentarlo como parte del servicio.</p></article>
      <article data-reveal><h2>Mensajes por correo</h2><p>Si nos escribes, recibiremos la dirección, el contenido y los adjuntos que decidas enviar. Usaremos esa información para responder a tu mensaje.</p></article>
      <article data-reveal><h2>Cambios</h2><p>Si incorporamos medición, cuentas u otro tratamiento de datos, actualizaremos esta página antes de presentarlo como parte del servicio.</p></article>
    </section>`;
  return renderPage(pageOptions({ title: 'Privacidad — Apluno', description: 'Conoce cómo Apluno y Toolisto tratan la información y procesan archivos.', pathname: '/privacy/', bodyClass: 'apluno-legal', content }));
}

function renderTerms() {
  const content = `<section class="apluno-page-hero apluno-section" data-reveal><p class="apluno-eyebrow">Legal / Condiciones</p><h1>Condiciones de uso.</h1><p>Última actualización: 14 de agosto de 2026.</p></section>
    <section class="apluno-section apluno-legal-copy">
      <article data-reveal><h2>Uso del sitio</h2><p>Apluno ofrece información sobre sus productos y acceso gratuito a las herramientas disponibles en Toolisto. Eres responsable de contar con autorización para procesar los archivos que utilices.</p></article>
      <article data-reveal><h2>Productos en desarrollo</h2><p>Workspace y Ordía se presentan como productos en desarrollo. Sus conceptos, alcance y disponibilidad pueden cambiar. No anunciamos una descarga ni una fecha de lanzamiento.</p></article>
      <article data-reveal><h2>Disponibilidad</h2><p>Trabajamos para que las herramientas funcionen de forma fiable, pero se ofrecen tal como están y pueden cambiar para corregir errores, mejorar seguridad o simplificar su uso.</p></article>
      <article data-reveal><h2>Responsabilidad</h2><p>Debes conservar copias de tus archivos importantes y revisar cualquier resultado antes de usarlo en un contexto crítico.</p></article>
    </section>`;
  return renderPage(pageOptions({ title: 'Condiciones de uso — Apluno', description: 'Condiciones aplicables al sitio de Apluno y a las herramientas disponibles en Toolisto.', pathname: '/terms/', bodyClass: 'apluno-legal', content }));
}

function renderNotFound() {
  const content = `<section class="apluno-not-found apluno-section" data-reveal><p class="apluno-eyebrow">Error 404</p><p class="apluno-not-found-code" aria-hidden="true">404</p><h1>Esta página no está aquí.</h1><p>Puede que la dirección haya cambiado o que el enlace esté incompleto.</p><div>${renderCta({ href: '/', label: 'Volver a Apluno', tone: 'dark', arrow: false })}${renderCta({ href: '/toolisto', label: 'Ir a Toolisto', tone: 'text', arrow: false })}</div></section>`;
  return renderPage(pageOptions({ title: 'Página no encontrada — Apluno', description: 'La página solicitada no existe.', pathname: '/404.html', bodyClass: 'apluno-404', content, robots: 'noindex, nofollow', schemas: [], socialImage: false }));
}

writePage('index.html', renderHome());
writePage(join('about', 'index.html'), renderAbout());
writePage(join('ordia', 'index.html'), renderOrdia());
writePage(join('workspace', 'index.html'), renderWorkspace());
writePage(join('contact', 'index.html'), renderContact());
writePage(join('privacy', 'index.html'), renderPrivacy());
writePage(join('terms', 'index.html'), renderTerms());
writePage('404.html', renderNotFound());

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sitemapUrls = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/toolisto', priority: '0.9', changefreq: 'weekly' },
  { path: '/about/', priority: '0.6', changefreq: 'monthly' },
  { path: '/ordia/', priority: '0.6', changefreq: 'monthly' },
  { path: '/workspace/', priority: '0.6', changefreq: 'monthly' },
  { path: '/contact/', priority: '0.3', changefreq: 'yearly' },
  { path: '/privacy/', priority: '0.2', changefreq: 'yearly' },
  { path: '/terms/', priority: '0.2', changefreq: 'yearly' },
  { path: '/privacidad', priority: '0.2', changefreq: 'yearly' },
  { path: '/condiciones', priority: '0.2', changefreq: 'yearly' },
  { path: '/apoyar', priority: '0.3', changefreq: 'monthly' },
  ...enabledCategories.map((category) => ({ path: `/${category.slug}`, priority: '0.7', changefreq: 'weekly' })),
  ...indexableTools.map((tool) => ({ path: `/${tool.slug}`, priority: '0.7', changefreq: 'monthly', lastmod: tool.lastModified }))
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((item) => `  <url>\n    <loc>${xmlEscape(absoluteUrl(item.path))}</loc>\n    <changefreq>${item.changefreq}</changefreq>\n    <priority>${item.priority}</priority>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ''}\n  </url>`).join('\n')}\n</urlset>\n`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

const robots = `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`;
writeFileSync(join(DIST, 'robots.txt'), robots, 'utf8');

const redirectLines = [
  '/toolisto/ /toolisto 301',
  '/toolisto /toolisto.html 200',
  ...redirects.map((redirect) => `${redirect.from} ${redirect.to} ${redirect.code}`)
];
writeFileSync(join(DIST, '_redirects'), `${redirectLines.join('\n')}\n`, 'utf8');

// FASE 9: páginas estáticas de redirect (GitHub Pages ignora _redirects; los aliases deben responder
// con una página indexable-solo-vía-canonical que reenvía al destino canónico sin crear cadenas).
function buildRedirectPage(from, to) {
  const url = absoluteUrl(to);
  const safe = escapeHtml(url);
  return `<!doctype html>
<html lang="es-419">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redirección a ${to}</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="canonical" href="${safe}">
  <meta http-equiv="refresh" content="0; url=${safe}">
</head>
<body>
  <p>Esta página se ha movido. <a href="${safe}">Ir a ${to}</a></p>
</body>
</html>`;
}

let redirectPages = 0;
for (const redirect of redirects) {
  const from = redirect.from.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!from || from.includes('/') || redirect.to.startsWith('/') !== true) continue;
  writeFileSync(join(DIST, `${from}.html`), buildRedirectPage(redirect.from, redirect.to), 'utf8');
  redirectPages++;
}
console.log(`  ✓ ${redirectPages} páginas estáticas de redirect (aliases desde redirects.json)`);

const headersSource = join(ROOT, '_headers');
if (existsSync(headersSource)) cpSync(headersSource, join(DIST, '_headers'));
writeFileSync(join(DIST, '.nojekyll'), '', 'utf8');

const required = [
  'index.html',
  'toolisto.html',
  join('about', 'index.html'),
  join('ordia', 'index.html'),
  join('workspace', 'index.html'),
  'sitemap.xml',
  'robots.txt',
  '_redirects',
  join('apluno-assets', 'apluno.css'),
  join('apluno-assets', 'apluno.js'),
  join('apluno-assets', 'apluno-tools-data.js')
];
const missing = required.filter((relative) => !existsSync(join(DIST, relative)));
if (missing.length) {
  console.error('APLUNO build validation failed. Missing:', missing.join(', '));
  process.exit(1);
}

console.log(`APLUNO build complete: ${sitemapUrls.length} indexable URLs, ${enabledTools.length} Toolisto tools, ${apluno.products.length} products.`);
