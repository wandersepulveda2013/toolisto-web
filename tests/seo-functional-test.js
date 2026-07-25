const { chromium } = require('playwright');
const BASE = 'http://localhost:8080';

const EXPECTED_TOOL_SLUGS = [
  'borrar-objetos-de-imagen', 'buscar-reemplazar-documentos', 'censurar-imagen', 'comparar-excel',
  'comprimir-imagen', 'comprimir-imagenes', 'comprimir-word', 'conversor-avanzado-de-imagenes',
  'convertir-imagen', 'convertir-listas-en-tablas', 'crear-tabla-de-contenido', 'csv-a-excel',
  'csv-a-json', 'cumplir-requisitos-de-archivo', 'dividir-archivo-txt', 'dividir-documento-word',
  'dividir-epub-por-capitulos', 'dividir-excel', 'dividir-pdf',
  'editar-metadatos-epub', 'eliminar-filas-duplicadas', 'eliminar-metadatos-de-imagen', 'eliminar-metadatos-word',
  'eliminar-paginas-en-blanco-word', 'epub-a-html', 'epub-a-markdown', 'epub-a-txt',
  'excel-a-csv', 'excel-a-json', 'extraer-contenido-word',
  'extraer-imagenes-epub', 'extraer-portada-epub', 'firmar-pdf',
  'flujo-de-imagenes', 'foto-para-documentos',
  'imagenes-a-pdf', 'jpg-a-pdf', 'jpg-a-png', 'jpg-a-webp',
  'json-a-csv', 'json-a-excel', 'json-a-xml', 'limpiar-firma',
  'mejorar-documento-fotografiado', 'ods-a-xlsx', 'odt-a-word', 'ordenar-lineas-texto',
  'organizar-pdf', 'pdf-a-imagenes', 'pdf-a-jpg',
  'pdf-a-png', 'png-a-jpg', 'png-a-pdf', 'png-a-webp',
  'recortar-imagen-para-redes-sociales', 'redimensionar-imagen', 'reparar-epub', 'reparar-formato-de-imagen',
  'reparar-word', 'rtf-a-word', 'tablas-word-a-excel',
  'txt-a-epub', 'txt-a-pdf', 'uniformar-formato-documento', 'unir-archivos-txt',
  'unir-documentos-word', 'unir-epub', 'unir-excel', 'unir-pdf',
  'validar-epub', 'webp-a-jpg', 'webp-a-png', 'word-a-epub',
  'word-a-html', 'word-a-jpg', 'word-a-markdown', 'word-a-odt',
  'word-a-pdf', 'word-a-png', 'word-a-txt', 'xls-a-xlsx',
  'xlsx-a-ods', 'xml-a-json'
];

const EXPECTED_CATEGORIES = ['pdf', 'imagenes', 'firmas', 'documentos-word', 'texto', 'epub-mobi', 'hojas-de-calculo'];

const TOOL_ACCEPTS = {
  'borrar-objetos-de-imagen': 'image',
  'buscar-reemplazar-documentos': 'docs',
  'censurar-imagen': 'image',
  'comparar-excel': 'excels',
  'comprimir-imagen': 'image',
  'comprimir-imagenes': 'images',
  'comprimir-word': 'docs',
  'conversor-avanzado-de-imagenes': 'images',
  'convertir-imagen': 'images',
  'convertir-listas-en-tablas': 'txts',
  'crear-tabla-de-contenido': 'docs',
  'csv-a-excel': 'csvs',
  'csv-a-json': 'csvs',
  'cumplir-requisitos-de-archivo': 'image',
  'dividir-archivo-txt': 'txts',
  'dividir-documento-word': 'docs',
  'dividir-epub-por-capitulos': 'epubs',
  'dividir-excel': 'excels',
  'dividir-pdf': 'pdfs',
  'editar-metadatos-epub': 'epubs',
  'eliminar-filas-duplicadas': 'txts',
  'eliminar-metadatos-de-imagen': 'images',
  'eliminar-metadatos-word': 'docs',
  'eliminar-paginas-en-blanco-word': 'docs',
  'epub-a-html': 'epubs',
  'epub-a-markdown': 'epubs',
  'epub-a-txt': 'epubs',
  'excel-a-csv': 'excels',
  'excel-a-json': 'excels',
  'extraer-contenido-word': 'docs',
  'extraer-imagenes-epub': 'epubs',
  'extraer-portada-epub': 'epubs',
  'firmar-pdf': 'pdfs',
  'flujo-de-imagenes': 'images',
  'foto-para-documentos': 'image',
  'imagenes-a-pdf': 'images',
  'jpg-a-pdf': 'images',
  'jpg-a-png': 'images',
  'jpg-a-webp': 'images',
  'json-a-csv': 'jsons',
  'json-a-excel': 'jsons',
  'json-a-xml': 'jsons',
  'limpiar-firma': 'image',
  'mejorar-documento-fotografiado': 'image',
  'ods-a-xlsx': 'ods',
  'odt-a-word': 'odts',
  'ordenar-lineas-texto': 'txts',
  'organizar-pdf': 'pdfs',
  'pdf-a-imagenes': 'pdfs',
  'pdf-a-jpg': 'pdfs',
  'pdf-a-png': 'pdfs',
  'png-a-jpg': 'images',
  'png-a-pdf': 'images',
  'png-a-webp': 'images',
  'recortar-imagen-para-redes-sociales': 'image',
  'redimensionar-imagen': 'image',
  'reparar-epub': 'epubs',
  'reparar-formato-de-imagen': 'image',
  'reparar-word': 'docs',
  'rtf-a-word': 'rtfs',
  'tablas-word-a-excel': 'docs',
  'txt-a-epub': 'txts',
  'txt-a-pdf': 'txts',
  'uniformar-formato-documento': 'docs',
  'unir-archivos-txt': 'txts',
  'unir-documentos-word': 'docs',
  'unir-epub': 'epubs',
  'unir-excel': 'excels',
  'unir-pdf': 'pdfs',
  'validar-epub': 'epubs',
  'webp-a-jpg': 'images',
  'webp-a-png': 'images',
  'word-a-epub': 'docs',
  'word-a-html': 'docs',
  'word-a-jpg': 'docs',
  'word-a-markdown': 'docs',
  'word-a-odt': 'docs',
  'word-a-pdf': 'docs',
  'word-a-png': 'docs',
  'word-a-txt': 'docs',
  'xls-a-xlsx': 'xls',
  'xlsx-a-ods': 'xlsx',
  'xml-a-json': 'xmls'
};

const ACCEPT_MAP = {
  'image': 'image/', 'images': 'image/', 'pdfs': 'application/pdf',
  'docs': 'application/msword', 'odts': 'opendocument.text', 'rtfs': 'rtf',
  'txts': 'text/plain', 'epubs': 'epub+zip', 'csvs': 'csv',
  'excels': 'spreadsheet', 'jsons': 'json', 'xmls': 'xml',
  'xls': 'xls', 'xlsx': 'xlsx', 'ods': 'ods'
};

let total = 0, passed = 0, failed = 0;
function ok(label) { total++; passed++; console.log(`  ✓ ${label}`); }
function fail(label, reason) { total++; failed++; console.log(`  ✗ ${label}: ${reason}`); }

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\n=== SEO PAGES: FUNCTIONAL TESTS ===\n');

  // --- SPLASH SCREEN ON TOOL PAGES ---
  console.log('--- Splash Screen (sample pages) ---');
  for (const slug of ['unir-pdf', 'comprimir-imagen', 'jpg-a-png', 'csv-a-excel', 'word-a-pdf']) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'domcontentloaded' });
    const introPending = await page.evaluate(() => document.documentElement.classList.contains('intro-pending'));
    if (introPending) ok(`${slug}: intro-pending on load`);
    else fail(`${slug}: intro-pending`, 'Not present on load');

    const hasApp = await page.$('#toolisto-app');
    if (hasApp) ok(`${slug}: #toolisto-app exists`);
    else fail(`${slug}: #toolisto-app`, 'Missing');

    const introScript = await page.$('script[src*="app.js"]');
    if (introScript) ok(`${slug}: app.js loaded`);
    else fail(`${slug}: app.js`, 'Not loaded');
  }

  // --- TOOL PAGES: BASIC STRUCTURE ---
  console.log('\n--- Tool Pages: Structure & SEO ---');
  for (const slug of EXPECTED_TOOL_SLUGS) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'domcontentloaded' });

    const title = await page.evaluate(() => document.title);
    if (title && title.length > 5) ok(`${slug}: title present (${title.substring(0, 40)}…)`);
    else fail(`${slug}: title`, `Missing or too short: "${title}"`);

    const h1 = await page.evaluate(() => {
      const h1s = document.querySelectorAll('h1');
      return h1s.length === 1 ? h1s[0].textContent.trim() : null;
    });
    if (h1) ok(`${slug}: exactly 1 H1: "${h1.substring(0, 40)}…"`);
    else fail(`${slug}: H1`, 'Not exactly 1');

    const canonical = await page.evaluate(() => {
      const link = document.querySelector('link[rel="canonical"]');
      return link ? link.href : null;
    });
    if (canonical && (canonical.endsWith('/' + slug) || canonical.endsWith('/' + slug + '.html'))) ok(`${slug}: canonical correct`);
    else fail(`${slug}: canonical`, `Got: ${canonical}`);

    const ogTitle = await page.$('meta[property="og:title"]');
    if (ogTitle) ok(`${slug}: og:title present`);
    else fail(`${slug}: og:title`, 'Missing');

    const breadcrumbs = await page.$('[aria-label="Ruta de navegación"]');
    if (breadcrumbs) ok(`${slug}: breadcrumbs present`);
    else fail(`${slug}: breadcrumbs`, 'Missing');

    const dropZone = await page.$('#dropZone');
    if (dropZone) ok(`${slug}: drop zone present`);
    else fail(`${slug}: drop zone`, 'Missing');

    const toolConfig = await page.$('#tool-page-config');
    if (toolConfig) ok(`${slug}: tool-page-config present`);
    else fail(`${slug}: tool-page-config`, 'Missing');
  }

  // --- TOOL PAGES: ACCEPT ATTRIBUTE ---
  console.log('\n--- Tool Pages: File Input Accept ---');
  for (const slug of EXPECTED_TOOL_SLUGS) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'domcontentloaded' });
    const accept = await page.evaluate(() => {
      const input = document.getElementById('fileInput');
      return input ? input.accept : null;
    });
    const acceptsType = TOOL_ACCEPTS[slug];
    const expected = ACCEPT_MAP[acceptsType];
    if (!expected) { fail(`${slug}: accept`, `No ACCEPT_MAP entry for type "${acceptsType}"`); continue; }
    if (accept && accept.includes(expected)) ok(`${slug}: accept="${accept.substring(0, 50)}…"`);
    else fail(`${slug}: accept`, `Expected "${expected}" in "${accept}"`);
  }

  // --- TOOL PAGES: TOOL AUTOMATICALLY ACTIVATED ---
  console.log('\n--- Tool Pages: Auto-Activation ---');
  for (const slug of ['unir-pdf', 'comprimir-imagen', 'jpg-a-png', 'firmar-pdf', 'word-a-pdf', 'csv-a-excel']) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const smartTitle = await page.evaluate(() => {
      const el = document.getElementById('smartTitle');
      return el ? el.textContent.trim() : null;
    });
    if (smartTitle && smartTitle.length > 3) ok(`${slug}: tool activated (${smartTitle})`);
    else fail(`${slug}: tool activation`, `smartTitle empty: "${smartTitle}"`);
  }

  // --- CATEGORY PAGES ---
  console.log('\n--- Category Pages ---');
  for (const slug of EXPECTED_CATEGORIES) {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'domcontentloaded' });
    const title = await page.evaluate(() => document.title);
    if (title && title.includes('Toolisto')) ok(`${slug}: title present`);
    else fail(`${slug}: title`, `Missing or no Toolisto: "${title}"`);

    const h1 = await page.evaluate(() => {
      const h1s = document.querySelectorAll('h1');
      return h1s.length === 1 ? h1s[0].textContent.trim() : null;
    });
    if (h1) ok(`${slug}: H1 present: "${h1.substring(0, 40)}…"`);
    else fail(`${slug}: H1`, 'Not exactly 1');

    const toolLinks = await page.$$eval('.category-tool-list a', links => links.length);
    if (toolLinks >= 2) ok(`${slug}: ${toolLinks} tool links`);
    else fail(`${slug}: tool links`, `Only ${toolLinks}`);
  }

  // --- 404 PAGE ---
  console.log('\n--- 404 Page ---');
  await page.goto(`${BASE}/nonexistent-page`, { waitUntil: 'domcontentloaded' });
  const is404title = await page.evaluate(() => document.title.includes('no encontrada'));
  if (is404title) ok('404: title indicates not found');
  else fail('404: title', 'Does not indicate not found');
  const has404h1 = await page.evaluate(() => {
    const h1s = document.querySelectorAll('h1');
    return h1s.length === 1 && h1s[0].textContent.includes('404');
  });
  if (has404h1) ok('404: H1 shows 404');
  else fail('404: H1', 'Does not show 404');

  // --- SITEMAP ---
  console.log('\n--- Sitemap ---');
  const sitemapRes = await page.goto(`${BASE}/sitemap.xml`);
  if (sitemapRes.status() === 200) ok('sitemap.xml accessible');
  else fail('sitemap.xml', `Status ${sitemapRes.status()}`);
  const sitemapText = await page.evaluate(() => document.body.textContent);
  const urlCount = (sitemapText.match(/<loc>/g) || []).length;
  if (urlCount >= 70) ok(`sitemap.xml: ${urlCount} URLs`);
  else fail(`sitemap.xml: URLs`, `Only ${urlCount}`);
  for (const slug of ['unir-pdf', 'comprimir-imagen', 'pdf', 'imagenes', 'csv-a-excel', 'word-a-pdf', 'hojas-de-calculo']) {
    if (sitemapText.includes(`/${slug}`)) ok(`sitemap.xml: /${slug} present`);
    else fail(`sitemap.xml: /${slug}`, 'Missing');
  }

  // --- ROBOTS.TXT ---
  console.log('\n--- Robots.txt ---');
  const robotsRes = await page.goto(`${BASE}/robots.txt`);
  if (robotsRes.status() === 200) ok('robots.txt accessible');
  else fail('robots.txt', `Status ${robotsRes.status()}`);
  const robotsText = await page.evaluate(() => document.body.textContent);
  if (robotsText.includes('Allow: /')) ok('robots.txt allows all');
  else fail('robots.txt', 'Missing Allow');
  if (robotsText.includes('sitemap.xml')) ok('robots.txt references sitemap');
  else fail('robots.txt', 'Missing sitemap reference');

  // --- REDIRECTS ---
  console.log('\n--- Redirects ---');
  try {
    const redRes = await page.evaluate(async () => {
      const r = await fetch('/_redirects');
      return { ok: r.ok, status: r.status };
    });
    if (redRes.ok) ok('_redirects accessible');
    else fail('_redirects', `Status ${redRes.status}`);
  } catch (e) { fail('_redirects', e.message); }

  // --- RESPONSIVE ON TOOL PAGE ---
  console.log('\n--- Responsive (tool pages) ---');
  await page.goto(`${BASE}/comprimir-imagen`, { waitUntil: 'domcontentloaded' });
  for (const vp of [{ w: 360, h: 800, n: 'mobile-small' }, { w: 768, h: 1024, n: 'tablet' }, { w: 1920, h: 1080, n: 'desktop' }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(100);
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (!hScroll) ok(`comprimir-imagen at ${vp.n} (${vp.w}×${vp.h}): no h-scroll`);
    else fail(`comprimir-imagen at ${vp.n}`, 'Has horizontal scroll');
  }

  // --- NO CDN ---
  console.log('\n--- Local Dependencies ---');
  let cdnRequests = 0;
  page.on('request', req => { if (req.url().includes('cdn.') || req.url().includes('jsdelivr')) cdnRequests++; });
  await page.goto(`${BASE}/unir-pdf`, { waitUntil: 'networkidle' });
  if (cdnRequests === 0) ok('No CDN requests on tool page');
  else fail('CDN requests', `${cdnRequests} detected`);

  // --- NO CONSOLE ERRORS ---
  console.log('\n--- Console Errors ---');
  for (const slug of ['unir-pdf', 'comprimir-imagen', 'jpg-a-png', 'pdf', 'firmas', 'word-a-pdf', 'csv-a-excel', 'epub-a-txt']) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    if (errors.length === 0) ok(`${slug}: no console errors`);
    else fail(`${slug}: console errors`, errors.join('; '));
    page.removeAllListeners('pageerror');
  }

  // --- LEGAL PAGES ---
  console.log('\n--- Legal Pages ---');
  for (const slug of ['privacidad', 'condiciones', 'apoyar']) {
    await page.goto(`${BASE}/${slug}.html`, { waitUntil: 'domcontentloaded' });
    const title = await page.evaluate(() => document.title);
    if (title && title.length > 5) ok(`${slug}.html: title present (${title.substring(0, 40)}…)`);
    else fail(`${slug}.html: title`, `Missing or too short: "${title}"`);

    const h1 = await page.evaluate(() => {
      const h1s = document.querySelectorAll('h1');
      return h1s.length === 1 ? h1s[0].textContent.trim() : null;
    });
    if (h1) ok(`${slug}.html: exactly 1 H1: "${h1.substring(0, 40)}…"`);
    else fail(`${slug}.html: H1`, 'Not exactly 1');

    const canonical = await page.evaluate(() => {
      const link = document.querySelector('link[rel="canonical"]');
      return link ? link.href : null;
    });
    if (canonical && canonical.includes(slug)) ok(`${slug}.html: canonical correct`);
    else fail(`${slug}.html: canonical`, `Got: ${canonical}`);

    const footerPriv = await page.$(`.site-footer a[href="./privacidad.html"]`);
    if (footerPriv) ok(`${slug}.html: footer has privacidad link`);
    else fail(`${slug}.html: footer`, 'Missing privacidad link');

    const footerCond = await page.$(`.site-footer a[href="./condiciones.html"]`);
    if (footerCond) ok(`${slug}.html: footer has condiciones link`);
    else fail(`${slug}.html: footer`, 'Missing condiciones link');
  }

  // apoyar has PayPal link
  await page.goto(`${BASE}/apoyar.html`, { waitUntil: 'domcontentloaded' });
  const paypalLink = await page.$('a[href*="paypal.com"]');
  if (paypalLink) ok('apoyar.html: has PayPal donate link');
  else fail('apoyar.html: PayPal link', 'Missing');

  // --- RESULT DIALOG SUPPORT BLOCK ---
  console.log('\n--- Result Dialog Support Block ---');
  await page.goto(`${BASE}/comprimir-imagen.html`, { waitUntil: 'domcontentloaded' });
  const hasSupport = await page.$('#resultSupport');
  if (hasSupport) ok('comprimir-imagen: resultSupport element present');
  else fail('comprimir-imagen: resultSupport', 'Missing');

  const hasReport = await page.$('#reportProblemLink');
  if (hasReport) ok('comprimir-imagen: reportProblemLink present');
  else fail('comprimir-imagen: reportProblemLink', 'Missing');

  await browser.close();

  console.log(`\n=== RESULTS ===`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${total}`);

  if (failed > 0) {
    console.error(`\n✗ TESTS FAILED`);
    process.exit(1);
  } else {
    console.log(`\n✓ ALL TESTS PASSED`);
  }
})();
