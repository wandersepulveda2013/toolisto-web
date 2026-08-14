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
  renderProductCard,
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

const toolistoSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Toolisto Herramientas',
  url: absoluteUrl('/toolisto'),
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Cualquier sistema con un navegador moderno',
  description: products.toolisto.description,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD'
  },
  creator: {
    '@type': 'Organization',
    name: 'Apluno',
    url: absoluteUrl('/')
  }
};

function pageOptions(options) {
  return { socialImage: hasSocialImage, ...options };
}

function renderHome() {
  const ledgerRows = apluno.products.map((product, index) => `<li>
    <span>0${index + 1}</span>
    <a href="${escapeHtml(product.href)}">${escapeHtml(product.shortName)}</a>
    ${renderProductStatus(product)}
  </li>`).join('');

  const cards = apluno.products.map((product, index) => renderProductCard(product, {
    index: index + 1,
    featured: product.id === 'toolisto',
    toolCount: enabledTools.length
  })).join('');

  const content = `<section class="apluno-hero">
      <div class="apluno-hero-grid">
        <div class="apluno-hero-copy" data-reveal>
          <p class="apluno-eyebrow"><span>APLUNO</span><span>Productos digitales</span></p>
          <h1>Menos pasos.<br><span>Más hecho.</span></h1>
          <p class="apluno-hero-description">Creamos herramientas y productos digitales que reducen la fricción entre lo que necesitas hacer y el resultado.</p>
          <div class="apluno-hero-actions">
            ${renderCta({ href: '/toolisto', label: 'Explorar herramientas', tone: 'dark' })}
            ${renderCta({ href: '/about/', label: 'Conocer Apluno', tone: 'text', arrow: false })}
          </div>
        </div>
        <aside class="apluno-product-ledger" aria-label="Productos de Apluno" data-reveal>
          <div class="apluno-ledger-heading"><span>APL / SISTEMAS</span><span>2026—</span></div>
          <ol>${ledgerRows}</ol>
          <p><span aria-hidden="true"></span> Un producto disponible. Dos en construcción.</p>
        </aside>
      </div>
      <a class="apluno-scroll-cue" href="#productos"><span>Ver productos</span><span aria-hidden="true">↓</span></a>
    </section>

    <section class="apluno-section apluno-products-section" id="productos" aria-labelledby="productos-title">
      <div class="apluno-section-heading" data-reveal>
        <p class="apluno-eyebrow">01 / Productos</p>
        <h2 id="productos-title">Un ecosistema pequeño.<br>Una intención muy clara.</h2>
        <p>Productos distintos, unidos por la misma idea: quitar complejidad sin quitar capacidad.</p>
      </div>
      <div class="apluno-product-grid">${cards}</div>
    </section>

    <section class="apluno-section apluno-principle" aria-labelledby="principle-title">
      <div class="apluno-principle-index" aria-hidden="true">02</div>
      <div class="apluno-principle-copy" data-reveal>
        <p class="apluno-eyebrow">Nuestra forma de construir</p>
        <h2 id="principle-title">Lo útil no debería exigir más trabajo del que resuelve.</h2>
        <p>Apluno parte de una pregunta sencilla: ¿qué pasos sobran? Diseñamos desde ahí, con interfaces claras, promesas honestas y tecnología que se mantiene fuera del camino.</p>
        <a class="apluno-inline-link" href="/about/">Cómo pensamos <span aria-hidden="true">→</span></a>
      </div>
    </section>

    <section class="apluno-section apluno-final-cta" data-reveal>
      <p class="apluno-eyebrow">Disponible ahora</p>
      <h2>${enabledTools.length} formas de resolver algo hoy.</h2>
      <p>Toolisto reúne utilidades para PDF, imágenes, documentos, datos y archivos. Abre una herramienta y empieza.</p>
      ${renderCta({ href: '/toolisto', label: 'Usar Toolisto', tone: 'paper' })}
    </section>`;

  return renderPage(pageOptions({
    title: 'APLUNO — Menos pasos. Más hecho.',
    description: apluno.site.description,
    pathname: '/',
    active: 'products',
    bodyClass: 'apluno-home',
    content,
    schemas: [organizationSchema, websiteSchema, toolistoSchema]
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
  const content = `<section class="apluno-page-hero apluno-section" data-reveal><p class="apluno-eyebrow">Legal / Privacidad</p><h1>Privacidad, explicada sin rodeos.</h1><p>Última actualización: 14 de agosto de 2026.</p></section>
    <section class="apluno-section apluno-legal-copy">
      <article data-reveal><h2>El sitio de Apluno</h2><p>Apluno no requiere una cuenta para visitar sus páginas públicas. No usamos analítica ni cookies de seguimiento en la configuración actual.</p></article>
      <article data-reveal><h2>Archivos procesados en Toolisto</h2><p>Las herramientas de Toolisto están diseñadas para procesar los archivos en tu navegador. Apluno no recibe ni almacena el contenido que seleccionas para procesar. Algunas funciones pueden descargar librerías necesarias para operar, pero tus archivos no se envían con ese fin.</p></article>
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
  { path: '/privacidad.html', priority: '0.2', changefreq: 'yearly' },
  { path: '/condiciones.html', priority: '0.2', changefreq: 'yearly' },
  { path: '/apoyar.html', priority: '0.3', changefreq: 'monthly' },
  ...enabledCategories.map((category) => ({ path: `/${category.slug}.html`, priority: '0.7', changefreq: 'weekly' })),
  ...indexableTools.map((tool) => ({ path: `/${tool.slug}.html`, priority: '0.7', changefreq: 'monthly', lastmod: tool.lastModified }))
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((item) => `  <url>\n    <loc>${xmlEscape(absoluteUrl(item.path))}</loc>\n    <changefreq>${item.changefreq}</changefreq>\n    <priority>${item.priority}</priority>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ''}\n  </url>`).join('\n')}\n</urlset>\n`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

const robots = `User-agent: *\nAllow: /\nDisallow: /workspace/preview.html\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`;
writeFileSync(join(DIST, 'robots.txt'), robots, 'utf8');

const redirectLines = [
  '/toolisto/ /toolisto 301',
  '/toolisto /toolisto.html 200',
  ...redirects.map((redirect) => `${redirect.from} ${redirect.to} ${redirect.code}`)
];
writeFileSync(join(DIST, '_redirects'), `${redirectLines.join('\n')}\n`, 'utf8');

const headersSource = join(ROOT, '_headers');
if (existsSync(headersSource)) cpSync(headersSource, join(DIST, '_headers'));
writeFileSync(join(DIST, '.nojekyll'), '', 'utf8');

const required = [
  'index.html',
  'toolisto.html',
  join('about', 'index.html'),
  join('ordia', 'index.html'),
  join('workspace', 'index.html'),
  join('workspace', 'preview.html'),
  'sitemap.xml',
  'robots.txt',
  '_redirects',
  join('apluno-assets', 'apluno.css'),
  join('apluno-assets', 'apluno.js')
];
const missing = required.filter((relative) => !existsSync(join(DIST, relative)));
if (missing.length) {
  console.error('APLUNO build validation failed. Missing:', missing.join(', '));
  process.exit(1);
}

console.log(`APLUNO build complete: ${sitemapUrls.length} indexable URLs, ${enabledTools.length} Toolisto tools, ${apluno.products.length} products.`);
