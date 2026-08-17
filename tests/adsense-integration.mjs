#!/usr/bin/env node
/**
 * tests/adsense-integration.mjs
 *
 * Gate de integración de Google AdSense para APLUNO.
 * Se ejecuta sobre el `dist/` ya construido (incluye scripts/inject-adsense.mjs).
 *
 * Valida:
 *   - ADSENSE_CLIENT = ca-pub-2644615452393440
 *   - Portada: exactamente 1 loader.
 *   - Toolisto catálogo: exactamente 1 loader.
 *   - Categorías monetizadas: exactamente 1 loader.
 *   - Herramientas de procesamiento: 0 loaders.
 *   - No duplicados en ninguna página permitida.
 *   - ads.txt existe.
 *   - ads.txt con publisher correcto.
 *   - Privacy menciona Google AdSense.
 *   - Privacy ya no afirma falsamente que el sitio carece de publicidad/cookies de terceros.
 *
 * Cero egress en páginas de procesamiento se valida por separado en
 * tests/public-site-network-negative.mjs (este gate es estático sobre el HTML).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const DATA = join(root, 'src', 'data');

const ADSENSE_CLIENT = 'ca-pub-2644615452393440';
const LOADER_MARKER = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const CLIENT_MARKER = `client=${ADSENSE_CLIENT}`;

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message}`);
  }
}

function read(relative) {
  return readFileSync(join(dist, relative), 'utf8');
}

function countLoaders(html) {
  return (html.split(LOADER_MARKER).length - 1);
}

function loadJson(name) {
  return JSON.parse(readFileSync(join(DATA, name), 'utf8'));
}

if (!existsSync(dist)) {
  console.error('FAIL: dist/ no existe. Ejecuta `npm run build` primero.');
  process.exit(1);
}

// Publisher ID correcto.
check(ADSENSE_CLIENT === 'ca-pub-2644615452393440', 'ADSENSE_CLIENT = ca-pub-2644615452393440');

const home = read('index.html');
const toolisto = read('toolisto.html');
const categories = loadJson('categories.json').filter((c) => c.enabled);
const tools = loadJson('tools.json').filter((t) => t.enabled);

// Portada: exactamente 1 loader, con el client correcto, dentro del head.
check(countLoaders(home) === 1, 'Portada: exactamente 1 loader de AdSense');
check(home.includes(CLIENT_MARKER), 'Portada: loader usa el publisher ca-pub-2644615452393440');
check(home.indexOf(LOADER_MARKER) < home.indexOf('</head>'), 'Portada: loader dentro de <head>');

// Toolisto catálogo: exactamente 1 loader.
check(countLoaders(toolisto) === 1, 'Toolisto catálogo: exactamente 1 loader de AdSense');
check(toolisto.includes(CLIENT_MARKER), 'Toolisto catálogo: loader usa el publisher correcto');
check(toolisto.indexOf(LOADER_MARKER) < toolisto.indexOf('</head>'), 'Toolisto catálogo: loader dentro de <head>');

// Categorías monetizadas: exactamente 1 loader cada una.
let categoryLoaderFailures = 0;
for (const cat of categories) {
  const rel = `${cat.slug}.html`;
  if (!existsSync(join(dist, rel))) {
    console.error(`FAIL: categoría esperada no existe: ${rel}`);
    categoryLoaderFailures += 1;
    continue;
  }
  const html = read(rel);
  if (countLoaders(html) !== 1) {
    console.error(`FAIL: ${rel} tiene ${countLoaders(html)} loaders (esperado 1)`);
    categoryLoaderFailures += 1;
  }
}
check(categoryLoaderFailures === 0, `Categorías monetizadas: exactamente 1 loader en cada una (${categories.length} categorías)`);

// Herramientas de procesamiento: 0 loaders.
let toolLoaderLeaks = 0;
for (const tool of tools) {
  const rel = `${tool.slug}.html`;
  if (!existsSync(join(dist, rel))) continue;
  const html = read(rel);
  const count = countLoaders(html);
  if (count !== 0) {
    console.error(`FAIL: ${rel} (página de procesamiento) contiene ${count} loader(s) de AdSense — violación de privacidad`);
    toolLoaderLeaks += 1;
  }
}
check(toolLoaderLeaks === 0, `Herramientas de procesamiento: 0 loaders de AdSense (${tools.length} herramientas verificadas)`);

// No duplicados: recorrer TODO dist y asegurarse de que ninguna página tiene >1 loader.
let duplicatePages = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) { walk(target); continue; }
    if (!target.endsWith('.html')) continue;
    const html = readFileSync(target, 'utf8');
    if (countLoaders(html) > 1) {
      console.error(`FAIL: ${target.slice(dist.length + 1)} contiene ${countLoaders(html)} loaders (duplicado)`);
      duplicatePages += 1;
    }
  }
}
walk(dist);
check(duplicatePages === 0, 'No hay loaders duplicados en ninguna página del build');

// ads.txt existe y con publisher correcto.
check(existsSync(join(dist, 'ads.txt')), 'ads.txt existe en la raíz pública (dist/ads.txt)');
if (existsSync(join(dist, 'ads.txt'))) {
  const adsTxt = read('ads.txt');
  check(adsTxt.includes('google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0'), 'ads.txt contiene el publisher correcto');
  check(adsTxt.trim() === 'google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0', 'ads.txt tiene exactamente la línea del publisher (sin contenido extra)');
}

// Privacy (Apluno /privacy/) menciona Google AdSense y no afirma falsamente ausencia de publicidad/cookies de terceros.
const privacy = read(join('privacy', 'index.html'));
check(/Google AdSense/.test(privacy), 'Privacy (/privacy/) menciona Google AdSense');
check(/no se incluye en las páginas donde Toolisto procesa archivos/.test(privacy), 'Privacy aclara que AdSense no se incluye en las páginas de procesamiento de archivos');
check(/no envía a Google el contenido de los archivos/.test(privacy), 'Privacy aclara que no se envía a Google el contenido de los archivos');
check(/Google Analytics no está activo/.test(privacy), 'Privacy no afirma Google Analytics activo (no lo está)');
// No debe quedar la afirmación falsa de que el sitio no usa cookies de seguimiento en la configuración actual.
check(!/No usamos analítica ni cookies de seguimiento en la configuración actual/.test(privacy), 'Privacy ya no afirma falsamente que el sitio carece de cookies de seguimiento en la configuración actual');
check(/17 de agosto de 2026/.test(privacy), 'Privacy actualiza la fecha de última actualización (17 de agosto de 2026)');

// Legacy privacidad.html (Toolisto) coherente.
const privacidadLegacy = read('privacidad.html');
check(/Google AdSense/.test(privacidadLegacy), 'Privacidad legacy (privacidad.html) menciona Google AdSense');
check(!/Toolisto no utiliza cookies propias\. Si se habilita Google Analytics en el futuro, se utilizarán cookies de terceros para fines estadísticos\.<\/p>/.test(privacidadLegacy), 'Privacidad legacy ya no afirma solo la possibility futura como único uso de cookies de terceros');

console.log(`\nAdSense integration: ${passed} pass, ${failed} fail.`);
process.exit(failed ? 1 : 0);
