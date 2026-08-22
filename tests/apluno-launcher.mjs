#!/usr/bin/env node
/** Certifica el launcher de la portada APLUNO: buscador local, chips reales, resultados de un clic y ajuste a viewport desktop sin scroll. */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const tools = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'src', 'data', 'categories.json'), 'utf8'));
const enabledCategories = categories.filter((category) => category.enabled);
const enabledTools = tools.filter((tool) => tool.enabled);
const failures = [];
let checks = 0;
const check = (condition, message) => { checks++; if (!condition) failures.push(message); };
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function startServer() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html'
      : pathname === '/toolisto' || pathname === '/toolisto/' ? 'toolisto.html'
      : pathname.replace(/^\/+/, '');
    let candidate = normalize(join(dist, relative));
    if (!candidate.startsWith(dist) || !existsSync(candidate)) {
      if (candidate.startsWith(dist) && !extname(relative) && existsSync(candidate + '.html')) {
        candidate += '.html';
      } else {
        response.writeHead(404); response.end('Not found'); return;
      }
    }
    const file = statSync(candidate).isDirectory() ? join(candidate, 'index.html') : candidate;
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- Static checks sobre el build ----
const homePath = join(dist, 'index.html');
check(existsSync(homePath), 'dist/index.html existe (ejecuta npm run build)');
const home = existsSync(homePath) ? readFileSync(homePath, 'utf8') : '';
check(home.includes('apluno-launcher-search') && home.includes('apluno-search-input'), 'La portada tiene un buscador único visible');
check(home.includes('data-launcher-chips'), 'La portada tiene chips de categorías');
check(home.includes('apluno-header--launcher') && home.includes('apluno-footer--minimal'), 'La portada usa header y footer discretos');
const inlineExecutable = home.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g, '').match(/<script(?![^>]*type="application\/ld\+json")[^>]*>/g) || [];
check(inlineExecutable.length === 0, 'La portada no tiene scripts inline ejecutables (CSP script-src self)');

const dataFile = join(dist, 'apluno-assets', 'apluno-tools-data.js');
check(existsSync(dataFile), 'El build genera apluno-tools-data.js');
let payload = null;
if (existsSync(dataFile)) {
  const raw = readFileSync(dataFile, 'utf8').replace(/^window\.APLUNO_TOOLS = /, '').replace(/;?[\r\n]*$/, '');
  payload = JSON.parse(raw);
  check(payload.tools.length === enabledTools.length, `La data del launcher refleja tools.json (${payload.tools.length} = ${enabledTools.length})`);
  check(payload.categories.length === enabledCategories.length, `La data del launcher refleja categories.json (${payload.categories.length} = ${enabledCategories.length})`);
  const labelByCat = Object.fromEntries(payload.categories.map((c) => [c.id, c.label]));
  const missingLabels = enabledCategories.filter((c) => !labelByCat[c.id]);
  check(missingLabels.length === 0, 'Todas las categorías habilitadas tienen etiqueta en el launcher');
  const hrefs = payload.tools.map((t) => t.href);
  const missingPages = hrefs.filter((href) => {
    const rel = href.replace(/^\//, '');
    return !existsSync(join(dist, rel)) && !existsSync(join(dist, rel + '.html'));
  });
  check(missingPages.length === 0, `Cada herramienta del launcher apunta a una página existente${missingPages.length ? `: ${missingPages.slice(0, 3).join(', ')}` : ''}`);
  const badSlugs = payload.tools.filter((t) => !enabledTools.some((tool) => tool.slug === t.slug));
  check(badSlugs.length === 0, 'La data del launcher usa slugs válidos de tools.json');
  const catIds = new Set(payload.categories.map((c) => c.id));
  const unknownCat = payload.tools.filter((t) => !catIds.has(t.category));
  check(unknownCat.length === 0, 'Ninguna herramienta del launcher referencia una categoría inexistente');
}

// ---- Browser E2E ----
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  // Desktop: la portada cabe en 100dvh sin scroll vertical
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktopContext.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  let requestsSinceStart = 0;
  page.on('request', (request) => { if (request.url().startsWith(base)) requestsSinceStart += 1; });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  check(requestsSinceStart >= 5, 'La portada carga sus recursos (HTML, CSS, JS y data)');
  check(await page.evaluate(() => !!window.ToolistoSearch), 'El motor de búsqueda reutilizado (ToolistoSearch) está disponible');
  check(await page.evaluate(() => !!window.APLUNO_TOOLS), 'La data generada en build está disponible');
  check(await page.evaluate(() => document.getElementById('apluno-search-input') !== null), 'El input de búsqueda existe en el DOM');

  const fitsViewport = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
  check(fitsViewport, 'En desktop la portada cabe en 100dvh sin scroll vertical de página');

  const defaultResults = await page.locator('#apluno-launcher-list > li').count();
  check(defaultResults > 0 && defaultResults <= 12, `La vista inicial muestra herramientas populares (${defaultResults}, máx 12)`);

  // Búsqueda local sin red: escribir NO debe generar requests nuevos
  const requestsBeforeTyping = requestsSinceStart;
  await page.fill('#apluno-search-input', 'unir pdf');
  await page.waitForTimeout(150);
  const searchResults = await page.locator('#apluno-launcher-list > li').count();
  check(searchResults > 0, 'Escribir «unir pdf» muestra coincidencias al instante');
  check(requestsSinceStart === requestsBeforeTyping, 'La búsqueda no realiza llamadas de red (datos locales de build)');
  const firstHref = await page.locator('#apluno-launcher-list a').first().getAttribute('href');
  check(firstHref === '/unir-pdf', `El primer resultado enlaza directo a /unir-pdf (actual: ${firstHref})`);

  // Un clic abre la herramienta
  const [navigation] = await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.locator('#apluno-launcher-list a').first().click()]);
  check(navigation.url().endsWith('/unir-pdf'), `Un clic navega a la herramienta (${navigation.url()})`);
  check(navigation.status() === 200, 'La herramienta abre con status 200');
  check((await page.locator('h1').textContent() || '').trim().length > 0, 'La herramienta muestra su título');

  // Enter abre el primer resultado sin pasar por el catálogo
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.fill('#apluno-search-input', 'unir pdf');
  await page.press('#apluno-search-input', 'Enter');
  await page.waitForURL('**/unir-pdf', { timeout: 10000 });
  check(new URL(page.url()).pathname === '/unir-pdf', 'Enter abre la herramienta recomendada sin pasar por el catálogo');

  // Chips de categorías reales filtran en la misma pantalla
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.click('[data-launcher-category="signatures"]');
  const sigCount = await page.locator('#apluno-launcher-list > li').count();
  const sigCategories = await page.$$eval('#apluno-launcher-list a', (links) => links.map((a) => a.href));
  check(sigCount > 0 && sigCount <= 12, `Filtro «Firmas» muestra sus herramientas (${sigCount})`);
  check(sigCategories.every((href) => /limpiar-firma|firmar-pdf/.test(href)), 'El filtro de categoría solo muestra herramientas de esa categoría');
  await page.click('[data-launcher-category="all"]');
  const allAfterFilter = await page.locator('#apluno-launcher-list > li').count();
  check(allAfterFilter > 0, 'Volver a «Todas» restaura la vista');

  // «Más» revela las categorías secundarias
  const moreBtn = page.locator('[data-launcher-more]');
  check(await moreBtn.isVisible(), 'El botón «Más» de categorías está visible');
  await moreBtn.click();
  const secondaryVisible = await page.locator('[data-launcher-category="video"]').isVisible()
    && await page.locator('[data-launcher-category="audio"]').isVisible()
    && await page.locator('[data-launcher-category="calculators"]').isVisible()
    && await page.locator('[data-launcher-category="ebooks"]').isVisible()
    && await page.locator('[data-launcher-category="files"]').isVisible();
  check(secondaryVisible, '«Más» revela EPUB, Archivos, Video, Audio y Calculadoras');

  // Sin errores de consola en la interacción
  check(consoleErrors.length === 0, `Sin errores de consola en la portada${consoleErrors.length ? `: ${consoleErrors[0]}` : ''}`);

  await desktopContext.close();

  // Mobile: contenido esencial visible
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${base}/`, { waitUntil: 'networkidle' });
  const inputVisible = await mobilePage.locator('#apluno-search-input').isVisible();
  const chipsVisible = await mobilePage.locator('[data-launcher-chips]').isVisible();
  check(inputVisible && chipsVisible, 'En móvil el buscador y las categorías son visibles');
  await mobilePage.fill('#apluno-search-input', 'comprimir imagen');
  const mobileResults = await mobilePage.locator('#apluno-launcher-list > li').count();
  check(mobileResults > 0, 'En móvil la búsqueda responde al instante');
  const mobileHref = await mobilePage.locator('#apluno-launcher-list a').first().getAttribute('href');
  check(mobileHref === '/comprimir-imagen', `En móvil el resultado directo es correcto (${mobileHref})`);
  await mobileContext.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nAPLUNO Launcher: ${checks} checks, ${failures.length} fail(s).`);
if (failures.length) { failures.forEach((f) => console.error(`  FAIL: ${f}`)); process.exit(1); }
console.log('Launcher validado: búsqueda local, categorías reales, un clic, sin scroll desktop.');
