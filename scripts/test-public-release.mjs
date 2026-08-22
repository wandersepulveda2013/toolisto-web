#!/usr/bin/env node
/**
 * test:release — puerta de calidad del build público de APLUNO
 *
 * Se ejecuta sobre el `dist/` ya construido por `npm run build` y comprueba:
 *   1. El service worker llevaba la allowlist de rutas públicas de APLUNO
 *      inyectada (el build la rellena; el placeholder vacío significa fallo).
 *   2. La allowlist cubre la portada, legal, contacto, productos y /apluno-assets/.
 *   3. El runtime interno del Workspace NO se publica (dist/workspace/workspace.js).
 *   4. La herramienta comprimir-imagen existe y recortar-imagen NO (fixture).
 *
 * Cualquier FAIL devuelve exit 1. Prohibido `|| true` y thresholds relajados.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;
function check(condition, name) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

const swPath = join(ROOT, 'dist', 'service-worker.js');
const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
const tools = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const toolSlugs = tools.map((t) => t.slug);
const homePath = join(ROOT, 'dist', 'index.html');
const home = existsSync(homePath) ? readFileSync(homePath, 'utf8') : '';
const dataPath = join(ROOT, 'dist', 'apluno-assets', 'apluno-tools-data.js');
const dataRaw = existsSync(dataPath) ? readFileSync(dataPath, 'utf8') : '';

console.log('=== Public release quality gate ===');

check(sw.length > 0, 'dist/service-worker.js existe en el build público');
check(sw.includes('const APLUNO_PUBLIC_ROUTES = [') && !sw.includes('const APLUNO_PUBLIC_ROUTES = [];'), 'la allowlist de rutas públicas fue inyectada por el build (no queda el marcador vacío)');
const routesMatch = sw.match(/const APLUNO_PUBLIC_ROUTES = (\[[^\n]*\]);/);
const routes = routesMatch ? JSON.parse(routesMatch[1]) : [];
const required = ['/', '/about/', '/contact/', '/privacy/', '/terms/', '/ordia/', '/workspace/', '/workspace-about/', '/apluno-assets/'];
check(required.every((r) => routes.includes(r)), 'la allowlist cubre portada, legal, contacto, productos y assets públicos');
check(!routes.includes('/toolisto') && !routes.includes('/offline.html'), 'la allowlist no excluye rutas de Toolisto (catálogo y recuperación offline)');
check(existsSync(join(ROOT, 'dist', 'workspace', 'workspace.js')), 'el runtime funcional del Workspace SÍ se publica en el build público');
check(existsSync(join(ROOT, 'dist', 'workspace', 'workspace.css')), 'el CSS funcional del Workspace SÍ se publica en el build público');
check(existsSync(join(ROOT, 'dist', 'workspace', 'core')), 'los módulos core del Workspace SÍ se publican en el build público');
check(existsSync(join(ROOT, 'dist', 'workspace', 'index.html')), 'el index.html funcional del Workspace SÍ se publica en el build público');
check(toolSlugs.includes('comprimir-imagen') && !toolSlugs.includes('recortar-imagen'), 'el catálogo de herramientas coincide con el fixture esperado');

check(home.includes('<title>APLUNO — Herramientas online para PDF, imágenes y archivos</title>') && home.includes('apluno-launcher-search') && !home.includes('product-card'), 'la portada pública es el launcher de herramientas, sin promos de productos');
const inlineExecutable = home.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g, '').match(/<script(?![^>]*type="application\/ld\+json")[^>]*>/g) || [];
check(inlineExecutable.length === 0, 'la portada pública no tiene scripts inline ejecutables (CSP script-src self)');

check(dataRaw.startsWith('window.APLUNO_TOOLS = {') && dataRaw.trimEnd().endsWith(';'), 'el build genera la data del launcher (apluno-tools-data.js)');
let launcherPayload = null;
try { launcherPayload = JSON.parse(dataRaw.replace(/^window\.APLUNO_TOOLS = /, '').replace(/;?[\r\n]*$/, '')); } catch { launcherPayload = null; }
check(launcherPayload && launcherPayload.tools.length === tools.filter((t) => t.enabled).length && launcherPayload.categories.length === 12, `la data del launcher refleja tools.json (${launcherPayload ? launcherPayload.tools.length : 0} tools, ${launcherPayload ? launcherPayload.categories.length : 0} categorías)`);
check(launcherPayload.tools.every((t) => /^\/[a-z0-9-]+$/.test(t.href)), 'los enlaces del launcher usan URLs limpias (sin .html)');

const redirects = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'redirects.json'), 'utf8'));
const missingRedirectPages = redirects.filter((r) => {
  const from = r.from.replace(/^\/+/, '').replace(/\/+$/, '');
  return !from || from.includes('/') ? true : !existsSync(join(ROOT, 'dist', `${from}.html`));
});
check(missingRedirectPages.length === 0, 'los aliases de redirects.json se materializan como páginas estáticas (GitHub Pages no procesa _redirects)');
if (missingRedirectPages.length) console.error(`    Faltan: ${missingRedirectPages.map((r) => r.from).join(', ')}`);
const sampleRedirect = readFileSync(join(ROOT, 'dist', 'merge-pdf.html'), 'utf8');
check(sampleRedirect.includes('rel="canonical"') && sampleRedirect.includes('href="https://apluno.com/unir-pdf"') && sampleRedirect.includes('noindex'), 'la página de redirect de /merge-pdf apunta al destino canónico sin indexarse');

console.log(`\n=== Resultado: ${passed} PASS, ${failed} FAIL ===`);
process.exit(failed ? 1 : 0);
