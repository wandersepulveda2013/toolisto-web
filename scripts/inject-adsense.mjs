#!/usr/bin/env node
/**
 * scripts/inject-adsense.mjs
 *
 * Integración centralizada y privacy-safe de Google AdSense para APLUNO.
 *
 * Se ejecuta DESPUÉS de generate-seo-pages.mjs y generate-apluno-pages.mjs
 * (invocado desde scripts/build-public-site.mjs) sobre el `dist/` ya generado.
 *
 * Responsabilidades:
 *   - Conoce ADSENSE_CLIENT (ca-pub-2644615452393440).
 *   - Inserta el loader de AdSense EXACTAMENTE UNA vez, dentro de <head>,
 *     solo en las páginas permitidas (portada, catálogo, categorías y páginas
 *     institucionales con contenido suficiente como /about/).
 *   - NUNCA inyecta el loader en las 167 páginas de procesamiento de Toolisto,
 *     ni en páginas de redirect, 404, privacidad, condiciones o contacto.
 *   - Es idempotente: si el loader ya existe, no lo duplica.
 *   - Genera dist/ads.txt con el publisher correcto.
 *   - Verifica: falla si una página permitida esperada no existe; falla si el
 *     loader aparece en una página de procesamiento; falla si aparece más de
 *     una vez en una página permitida.
 *   - Queda preparado para Auto Ads: NO inventa data-ad-slot ni IDs de bloque.
 *     Activar Auto Ads desde el panel de Google AdSense no requiere cambiar
 *     este código (el loader global es suficiente).
 *
 * El loader es `async` y `crossorigin="anonymous"`: no bloquea LCP/primer
 * render, no impide interacciones, y si Google no responde o un ad blocker lo
 * bloquea, el sitio sigue funcionando (no hay dependencias inline del script).
 *
 * CSP: el archivo `_headers` define una Content-Security-Policy restrictiva,
 * pero GitHub Pages NO aplica `_headers` y Cloudflare (proxy en producción) NO
 * inyecta una CSP real (verificado en los response headers reales de
 * apluno.com). Por tanto no se debilita la seguridad a ciegas: se deja
 * `_headers` intacto y se documenta el hecho. Si en el futuro un host aplica
 * la CSP de `_headers`, habría que migrar a una CSP basada en nonce /
 * strict-dynamic según la guía actual de Google; eso queda como paso manual
 * documentado, no como cambio automático.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(scriptDir, '..');
const DIST = join(ROOT, 'dist');

export const ADSENSE_CLIENT = 'ca-pub-2644615452393440';
export const ADSENSE_LOADER_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
export const ADSENSE_LOADER_TAG = `<script async src="${ADSENSE_LOADER_SRC}" crossorigin="anonymous"></script>`;
export const ADSENSE_LOADER_MARKER = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

const ADS_TXT_CONTENT = `google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0\n`;

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Páginas permitidas para monetización en esta primera fase.
 * - Portada (launcher APLUNO): dist/index.html
 * - Catálogo de herramientas: dist/toolisto.html
 * - Páginas de categorías: dist/<category-slug>.html (12 categorías)
 * - Institucional con contenido: dist/about/index.html
 *
 * NO se incluye:
 *   - 167 páginas de procesamiento de herramientas (dist/<tool-slug>.html)
 *   - 404.html, redirects (aliases), privacidad/privacy, condiciones/terms,
 *     contacto, ordia, workspace, apoyar.
 */
function buildAllowedFiles() {
  const categories = loadJson(join(ROOT, 'src', 'data', 'categories.json'));
  const enabledCategorySlugs = categories
    .filter((c) => c.enabled)
    .map((c) => c.slug);

  const allowed = [
    'index.html',
    'toolisto.html',
    join('about', 'index.html'),
    ...enabledCategorySlugs.map((slug) => `${slug}.html`),
  ];
  return allowed;
}

/**
 * Slugs de las 167 herramientas de procesamiento. En estas páginas el loader
 * de AdSense NO debe aparecer jamás (privacidad de archivos / cero egress).
 */
function buildToolSlugs() {
  const tools = loadJson(join(ROOT, 'src', 'data', 'tools.json'));
  return tools.filter((t) => t.enabled).map((t) => t.slug);
}

function countLoaders(html) {
  return (html.split(ADSENSE_LOADER_MARKER).length - 1);
}

function injectLoaderIntoHead(html, relativePath) {
  const count = countLoaders(html);
  if (count > 1) {
    throw new Error(`inject-adsense: ${relativePath} ya contiene ${count} loaders de AdSense (se esperaba 0 o 1).`);
  }
  if (count === 1) {
    return null;
  }
  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx === -1) {
    throw new Error(`inject-adsense: ${relativePath} no contiene </head>; no se puede insertar el loader en el head.`);
  }
  // Insertar justo antes de </head>, con salto de línea limpio.
  const before = html.slice(0, headCloseIdx);
  const after = html.slice(headCloseIdx);
  return `${before}  ${ADSENSE_LOADER_TAG}\n${after}`;
}

function ensureNoLoader(html, relativePath) {
  const count = countLoaders(html);
  if (count > 0) {
    throw new Error(`inject-adsense: PRIVACIDAD VIOLADA — ${relativePath} (página de procesamiento) contiene ${count} loader(s) de AdSense. El loader no debe aparecer en páginas donde Toolisto procesa archivos.`);
  }
}

function main() {
  if (!existsSync(DIST)) {
    throw new Error(`inject-adsense: dist/ no existe. Ejecuta generate-seo-pages.mjs y generate-apluno-pages.mjs primero.`);
  }

  const allowedFiles = buildAllowedFiles();
  const toolSlugs = buildToolSlugs();

  // 1) Verificar que todas las páginas permitidas existen.
  const missingAllowed = allowedFiles.filter((rel) => !existsSync(join(DIST, rel)));
  if (missingAllowed.length) {
    throw new Error(`inject-adsense: faltan páginas permitidas esperadas: ${missingAllowed.join(', ')}`);
  }

  // 2) Insertar el loader (idempotente) en las páginas permitidas.
  let injected = 0;
  let alreadyPresent = 0;
  for (const rel of allowedFiles) {
    const file = join(DIST, rel);
    const html = readFileSync(file, 'utf8');
    const updated = injectLoaderIntoHead(html, rel);
    if (updated === null) {
      alreadyPresent += 1;
      continue;
    }
    writeFileSync(file, updated, 'utf8');
    injected += 1;
    console.log(`  ✓ AdSense loader inyectado en ${rel.replace(/\\/g, '/')}`);
  }

  // 3) Verificar que ninguna página de procesamiento contiene el loader.
  let toolViolations = 0;
  for (const slug of toolSlugs) {
    const file = join(DIST, `${slug}.html`);
    if (!existsSync(file)) {
      // Algunas herramientas pueden no generar página propia (aliases); no falla aquí.
      continue;
    }
    const html = readFileSync(file, 'utf8');
    try {
      ensureNoLoader(html, `${slug}.html`);
    } catch (error) {
      toolViolations += 1;
      console.error(`  ${error.message}`);
    }
  }
  if (toolViolations > 0) {
    throw new Error(`inject-adsense: ${toolViolations} página(s) de procesamiento contienen el loader de AdSense. Abortando por privacidad.`);
  }

  // 4) Generar ads.txt en la raíz pública.
  writeFileSync(join(DIST, 'ads.txt'), ADS_TXT_CONTENT, 'utf8');
  console.log(`  ✓ ads.txt generado (publisher pub-2644615452393440)`);

  // 5) Resumen.
  console.log(`\nAdSense integration: ${injected} inyectados, ${alreadyPresent} ya presentes, ${allowedFiles.length} páginas permitidas, ${toolSlugs.length} páginas de procesamiento verificadas sin loader, ads.txt generado.`);
}

main();
