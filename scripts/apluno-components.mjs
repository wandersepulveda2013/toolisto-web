const SITE_URL = 'https://apluno.com';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function absoluteUrl(pathname = '/') {
  if (/^https?:\/\//.test(pathname)) return pathname;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${SITE_URL}${path}`;
}

export function renderSeoMetadata({
  title,
  description,
  pathname = '/',
  type = 'website',
  robots = 'index, follow',
  schemas = [],
  socialImage = true
}) {
  const canonical = absoluteUrl(pathname);
  const image = `${SITE_URL}/apluno-assets/og.png`;
  const imageTags = socialImage
    ? `\n  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1731">
  <meta property="og:image:height" content="909">
  <meta property="og:image:alt" content="APLUNO — Menos pasos. Más hecho.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${image}">`
    : '\n  <meta name="twitter:card" content="summary">';
  const schemaTags = schemas
    .map((schema) => `  <script type="application/ld+json">${safeJson(schema)}</script>`)
    .join('\n');

  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="theme-color" content="#f5f4ef">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/png" sizes="32x32" href="/apluno-assets/favicon-32.png">
  <link rel="apple-touch-icon" href="/apluno-assets/icon-192.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/apluno-assets/apluno.css">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:site_name" content="APLUNO">
  <meta property="og:locale" content="es_DO">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">${imageTags}
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
${schemaTags}`;
}

export function renderAplunoWordmark({ compact = false } = {}) {
  return `<span class="apluno-wordmark${compact ? ' apluno-wordmark--compact' : ''}" aria-label="Apluno"><span>APLUN</span><span class="apluno-wordmark-o" aria-hidden="true">O</span></span>`;
}

export function renderAplunoHeader({ active = '', variant = '' } = {}) {
  const current = (name) => (active === name ? ' aria-current="page"' : '');
  if (variant === 'launcher') {
    return `<a class="apluno-skip-link" href="#contenido">Saltar al contenido principal</a>
  <header class="apluno-header apluno-header--launcher" data-apluno-header>
    <div class="apluno-header-inner">
      <a class="apluno-brand-link" href="/" aria-label="Ir al inicio de Apluno">${renderAplunoWordmark({ compact: true })}</a>
      <div class="apluno-header-actions">
        <button class="apluno-menu-button" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="apluno-launcher-nav" data-menu-toggle>
          <span aria-hidden="true"></span><span aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <nav class="apluno-mobile-nav apluno-launcher-nav" id="apluno-launcher-nav" aria-label="Menú de Apluno" hidden data-mobile-nav>
      <p class="apluno-launcher-nav-label">Sitio</p>
      <a href="/about/">Acerca de</a>
      <a href="/contact/">Contacto</a>
      <a href="/privacy/">Privacidad</a>
      <a href="/terms/">Condiciones</a>
      <p class="apluno-launcher-nav-label">Productos de Apluno</p>
      <a href="/toolisto">Toolisto <span>Disponible</span></a>
      <a href="/workspace/">Workspace <span>En desarrollo</span></a>
      <a href="/ordia/">Ordía <span>En desarrollo</span></a>
    </nav>
  </header>`;
  }
  return `<a class="apluno-skip-link" href="#contenido">Saltar al contenido principal</a>
  <header class="apluno-header" data-apluno-header>
    <div class="apluno-header-inner">
      <a class="apluno-brand-link" href="/" aria-label="Ir al inicio de Apluno">${renderAplunoWordmark({ compact: true })}</a>
      <nav class="apluno-desktop-nav" aria-label="Navegación principal">
        <a href="/toolisto"${current('toolisto')}>Herramientas</a>
        <a href="/about/"${current('about')}>Acerca de</a>
      </nav>
      <div class="apluno-header-actions">
        <a class="apluno-button apluno-button--small apluno-button--dark" href="/toolisto">Usar herramientas</a>
        <button class="apluno-menu-button" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="apluno-mobile-nav" data-menu-toggle>
          <span aria-hidden="true"></span><span aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <nav class="apluno-mobile-nav" id="apluno-mobile-nav" aria-label="Navegación móvil" hidden data-mobile-nav>
      <a href="/toolisto">Herramientas</a>
      <a href="/about/">Acerca de</a>
      <a href="/contact/">Contacto</a>
      <a href="/privacy/">Privacidad</a>
      <a href="/terms/">Condiciones</a>
      <a href="/workspace/">Workspace <span>En desarrollo</span></a>
      <a href="/ordia/">Ordía <span>En desarrollo</span></a>
    </nav>
  </header>`;
}

export function renderAplunoFooter({ minimal = false } = {}) {
  if (minimal) {
    return `<footer class="apluno-footer apluno-footer--minimal">
    <div class="apluno-footer-inner apluno-footer-minimal-inner">
      <a class="apluno-brand-link" href="/" aria-label="Ir al inicio de Apluno">${renderAplunoWordmark({ compact: true })}</a>
      <nav class="apluno-footer-minimal-links" aria-label="Navegación del pie de página">
        <a href="/about/">Acerca de</a>
        <a href="/contact/">Contacto</a>
        <a href="/privacy/">Privacidad</a>
        <a href="/terms/">Condiciones</a>
      </nav>
      <nav class="apluno-footer-minimal-products" aria-label="Productos de Apluno">
        <a href="/toolisto">Toolisto</a>
        <a href="/workspace/">Workspace</a>
        <a href="/ordia/">Ordía</a>
      </nav>
      <small>© 2026 Apluno · Herramientas online gratuitas.</small>
    </div>
  </footer>`;
  }
  return `<footer class="apluno-footer">
    <div class="apluno-footer-inner">
      <div class="apluno-footer-lead">
        <a class="apluno-brand-link" href="/" aria-label="Ir al inicio de Apluno">${renderAplunoWordmark()}</a>
        <p>Productos digitales útiles, hechos para reducir fricción.</p>
      </div>
      <div class="apluno-footer-grid">
        <div>
          <h2>Productos</h2>
          <a href="/toolisto">Toolisto</a>
          <a href="/workspace/">Workspace</a>
          <a href="/ordia/">Ordía</a>
        </div>
        <div>
          <h2>Empresa</h2>
          <a href="/about/">Acerca de</a>
          <a href="/contact/">Contacto</a>
        </div>
        <div>
          <h2>Legal</h2>
          <a href="/privacy/">Privacidad</a>
          <a href="/terms/">Condiciones</a>
        </div>
      </div>
      <div class="apluno-footer-bottom">
        <small>© 2026 Apluno</small>
        <small>Hecho para ser claro desde el primer paso.</small>
      </div>
    </div>
  </footer>`;
}

export function renderProductStatus(product) {
  return `<span class="product-status product-status--${escapeHtml(product.statusTone)}"><span aria-hidden="true"></span>${escapeHtml(product.status)}</span>`;
}

export function renderCta({ href, label, tone = 'light', arrow = true, small = false }) {
  const classes = ['apluno-button', `apluno-button--${tone}`];
  if (small) classes.push('apluno-button--small');
  return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}"><span>${escapeHtml(label)}</span>${arrow ? '<span class="apluno-button-arrow" aria-hidden="true">↗</span>' : ''}</a>`;
}

export function renderProductCard(product, { index, featured = false, toolCount = 0 } = {}) {
  const detail = product.id === 'toolisto' && toolCount
    ? `${toolCount} herramientas disponibles para PDF, imágenes, documentos, datos y más.`
    : product.detail;
  return `<article class="product-card product-card--${escapeHtml(product.id)}${featured ? ' product-card--featured' : ''}" data-reveal>
    <div class="product-card-topline">
      <span class="product-index">0${index}</span>
      ${renderProductStatus(product)}
    </div>
    <div class="product-card-body">
      <p class="product-parent">Un producto de Apluno</p>
      <h3>${escapeHtml(product.name)}</h3>
      <p class="product-description">${escapeHtml(product.description)}</p>
      <p class="product-detail">${escapeHtml(detail)}</p>
    </div>
    <div class="product-card-footer">
      ${renderCta({ href: product.href, label: product.cta, tone: featured ? 'paper' : 'outline', small: true })}
      <span class="product-code" aria-hidden="true">APL/${String(index).padStart(3, '0')}</span>
    </div>
  </article>`;
}

export function renderProductHero({ product, eyebrow, title, description, note = '' }) {
  return `<section class="product-hero apluno-section" data-reveal>
    <div class="product-hero-grid">
      <div class="product-hero-meta">
        <p class="apluno-eyebrow">${escapeHtml(eyebrow)}</p>
        ${renderProductStatus(product)}
      </div>
      <div class="product-hero-copy">
        <p class="product-parent">Un producto de Apluno</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="product-hero-description">${escapeHtml(description)}</p>
        ${note ? `<p class="product-hero-note">${escapeHtml(note)}</p>` : ''}
      </div>
    </div>
  </section>`;
}

export function renderPage({
  title,
  description,
  pathname,
  active = '',
  bodyClass = '',
  content,
  schemas = [],
  robots = 'index, follow',
  socialImage = true,
  header = 'standard',
  footer = 'full',
  headScripts = []
}) {
  const headerHtml = header === 'launcher' ? renderAplunoHeader({ active, variant: 'launcher' }) : renderAplunoHeader({ active });
  const footerHtml = footer === 'minimal' ? renderAplunoFooter({ minimal: true }) : renderAplunoFooter();
  const extraScripts = headScripts.map((src) => `  <script src="${escapeHtml(src)}" defer></script>`).join('\n');
  return `<!doctype html>
<html lang="es-419">
<head>
  ${renderSeoMetadata({ title, description, pathname, schemas, robots, socialImage })}
  ${extraScripts ? `${extraScripts}\n  ` : ''}<script src="/apluno-assets/apluno.js" defer></script>
</head>
<body class="apluno-page ${escapeHtml(bodyClass)}">
  ${headerHtml}
  <main id="contenido" tabindex="-1">
    ${content}
  </main>
  ${footerHtml}
</body>
</html>`;
}

export { absoluteUrl, escapeHtml, safeJson };
