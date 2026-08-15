#!/usr/bin/env node
/** Certifica el manifiesto, registro, actualización online y navegación previamente visitada sin red. */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const tools = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'src', 'data', 'categories.json'), 'utf8'));
const artifact = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-pwa-offline-evidence.json');
const failures = [];
let checks = 0;
const check = (condition, message) => { checks++; if (!condition) failures.push(message); };
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function startServer() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/toolisto' || pathname === '/toolisto/'
      ? 'toolisto.html'
      : pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = normalize(join(dist, relative));
    if (!candidate.startsWith(dist) || !existsSync(candidate)) { response.writeHead(404); response.end('Not found'); return; }
    const file = statSync(candidate).isDirectory() ? join(candidate, 'index.html') : candidate;
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Toolisto-Request': request.url
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const manifestPath = join(dist, 'assets', 'manifest.webmanifest');
check(existsSync(manifestPath), 'Falta el manifest de producción');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
check(manifest.name === 'Toolisto' && manifest.short_name === 'Toolisto', 'El manifest no identifica Toolisto');
check(manifest.start_url === '/toolisto', 'El manifest no inicia en /toolisto');
check(manifest.id === '/toolisto', 'El identificador PWA no es /toolisto');
check(manifest.scope === '/', 'El scope PWA no cubre el origen APLUNO');
check(manifest.display === 'standalone', 'El manifest no solicita experiencia standalone');
check(manifest.icons?.some((icon) => icon.src === 'icon-192.png' && icon.sizes === '192x192') && manifest.icons?.some((icon) => icon.src === 'icon-512.png' && icon.sizes === '512x512'), 'El manifest no declara iconos instalables');
check(existsSync(join(dist, 'service-worker.js')), 'Falta el service worker en la raíz publicada');
check(existsSync(join(dist, 'js', 'pwa-register.js')), 'Falta el registro PWA publicado');
check(existsSync(join(dist, 'offline.html')), 'Falta la página de recuperación offline publicada');

const toolistoHtmlPages = [
  'toolisto.html', 'privacidad.html', 'condiciones.html', 'apoyar.html',
  ...categories.filter((category) => category.enabled).map((category) => `${category.slug}.html`),
  ...tools.filter((tool) => tool.indexable).map((tool) => `${tool.slug}.html`),
].filter((name, index, pages) => pages.indexOf(name) === index && existsSync(join(dist, name)));
const missingPwa = toolistoHtmlPages.filter((name) => {
  const html = readFileSync(join(dist, name), 'utf8');
  return !html.includes('manifest.webmanifest') || !html.includes('js/pwa-register.js');
});
check(missingPwa.length === 0, `Páginas Toolisto sin manifest o registro PWA: ${missingPwa.join(', ')}`);

const sw = existsSync(join(dist, 'service-worker.js')) ? readFileSync(join(dist, 'service-worker.js'), 'utf8') : '';
const pwaRegister = existsSync(join(dist, 'js', 'pwa-register.js')) ? readFileSync(join(dist, 'js', 'pwa-register.js'), 'utf8') : '';
check(!/https?:\/\//.test(sw) && /url\.origin !== self\.location\.origin/.test(sw), 'El service worker debe limitar la caché a recursos del mismo origen');
check(/await fetch\(request\)/.test(sw) && !/cache\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/.test(sw), 'El service worker revalida online y conserva variantes de URL versionadas');
check(/cache\.match\(['"]\/offline\.html['"]\)/.test(sw) && !/cache\.match\(['"](?:\.\/|\/)index\.html['"]\)/.test(sw), 'Una navegación offline no visitada debe mostrar una recuperación explícita, no la portada equivocada');
check(/serviceWorker\.register\(['"]\/service-worker\.js['"],\s*\{\s*scope:\s*['"]\/['"]\s*\}\)/.test(pwaRegister), 'El registro PWA no usa /service-worker.js con scope /');
check(sw.includes('APLUNO_PUBLIC_ROUTES') && !sw.includes('const APLUNO_PUBLIC_ROUTES = [];'), 'El service worker de dist incluye la allowlist de rutas públicas de APLUNO inyectada en build');
const swRoutesMatch = sw.match(/const APLUNO_PUBLIC_ROUTES = (\[[^\n]*\]);/);
const swRoutes = swRoutesMatch ? JSON.parse(swRoutesMatch[1]) : [];
check(swRoutes.includes('/') && swRoutes.includes('/about/') && swRoutes.includes('/contact/') && swRoutes.includes('/privacy/') && swRoutes.includes('/terms/') && swRoutes.includes('/ordia/') && swRoutes.includes('/workspace/') && swRoutes.includes('/apluno-assets/'), 'La allowlist cubre la portada, legal, contacto y productos públicos de APLUNO');
check(!swRoutes.includes('/toolisto') && !swRoutes.includes('/offline.html'), 'La allowlist no excluye rutas de Toolisto (catálogo y recuperación offline)');

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const home = await page.goto(`${base}/toolisto`, { waitUntil: 'networkidle' });
  check(home?.status() === 200, 'El catálogo /toolisto no responde antes de instalar PWA');
  await page.reload({ waitUntil: 'networkidle' });
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'El service worker no controla /toolisto tras recargar');
  const revisionProbe = await page.evaluate(async () => {
    const response = await fetch(`./?pwa-revision=${encodeURIComponent('cycle-24')}`);
    return response.headers.get('x-toolisto-request');
  });
  check(revisionProbe?.includes('pwa-revision=cycle-24'), 'La PWA consulta la versión publicada en línea en vez de servir una caché obsoleta');
  const tool = await page.goto(`${base}/comprimir-imagen.html`, { waitUntil: 'networkidle' });
  check(tool?.status() === 200, 'La herramienta visitada no responde antes de modo offline');
  await context.setOffline(true);
  const offline = await page.reload({ waitUntil: 'domcontentloaded' });
  check(offline?.status() === 200 && await page.locator('h1').count() === 1, 'Una herramienta previamente visitada no se abre offline');
  const unavailable = await page.goto(`${base}/recortar-imagen.html`, { waitUntil: 'domcontentloaded' });
  check(unavailable?.status() === 200 && await page.locator('h1').textContent() === 'Esta herramienta aún no está disponible sin conexión', 'Una herramienta no visitada muestra una recuperación offline explícita');
  check(await page.locator('a[href="/toolisto"]').count() === 1, 'La recuperación offline ofrece un regreso accesible a /toolisto');
  check(consoleErrors.length === 0, `Errores de consola PWA: ${consoleErrors.join(' | ')}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

const evidence = { gate: 'pwa-offline', result: failures.length ? 'FAIL' : 'PASS', checks, failed: failures.length, pages: toolistoHtmlPages.length, failures };
writeEvidence(artifact, evidence);
if (failures.length) { console.error(`PWA Offline: ${checks - failures.length}/${checks} PASS`); failures.forEach((failure) => console.error(`  FAIL: ${failure}`)); process.exit(1); }
console.log(`PWA Offline: ${checks}/${checks} PASS (${toolistoHtmlPages.length} páginas Toolisto)`);
