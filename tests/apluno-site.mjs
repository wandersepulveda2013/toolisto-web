#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
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

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function publicTarget(value, sourceFile) {
  const clean = value.split('#')[0].split('?')[0];
  if (!clean || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(clean)) return null;
  const sourceRelative = sourceFile.slice(dist.length).replace(/\\/g, '/');
  const sourceDirectory = dirname(sourceRelative).replace(/\\/g, '/');
  const webPath = clean.startsWith('/')
    ? clean
    : normalize(join('/', sourceDirectory, clean)).replace(/\\/g, '/');
  if (webPath === '/') return join(dist, 'index.html');
  if (webPath === '/toolisto') return join(dist, 'toolisto.html');
  const candidate = join(dist, webPath.replace(/^\/+/, ''));
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, 'index.html');
  if (existsSync(candidate)) return candidate;
  if (!webPath.includes('.')) return join(candidate, 'index.html');
  return candidate;
}

const requiredPages = [
  'index.html',
  'toolisto.html',
  'about/index.html',
  'ordia/index.html',
  'workspace/index.html',
  'contact/index.html',
  'privacy/index.html',
  'terms/index.html',
  '404.html'
];
requiredPages.forEach((page) => check(existsSync(join(dist, page)), `${page} existe`));
check(!existsSync(join(dist, 'workspace', 'preview.html')), 'El preview interno NO se publica en dist');

const home = read('index.html');
const toolisto = read('toolisto.html');
const about = read('about/index.html');
const ordia = read('ordia/index.html');
const workspace = read('workspace/index.html');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const redirects = read('_redirects');

check(home.includes('<title>APLUNO — Menos pasos. Más hecho.</title>'), 'La portada comunica la identidad APLUNO');
check(home.includes('<link rel="canonical" href="https://apluno.com/">'), 'Canonical de APLUNO es correcto');
check(home.includes('"@type":"Organization"') && home.includes('"@type":"WebSite"'), 'La portada incluye Organization y WebSite JSON-LD');
check(home.includes('Toolisto Herramientas') && home.includes('Toolisto Workspace') && home.includes('Ordía'), 'La portada presenta los tres productos');
check((home.match(/En desarrollo/g) || []).length >= 2, 'La portada identifica los dos productos en desarrollo');
check(home.includes('href="/toolisto"'), 'CTA principal apunta a /toolisto');

const toolCards = toolisto.match(/class="tool-card/g) || [];
check(toolCards.length === 167, `Toolisto conserva 167 tarjetas (actual: ${toolCards.length})`);
check(toolisto.includes('https://apluno.com/toolisto'), 'Toolisto usa canonical y metadatos de apluno.com/toolisto');
check(toolisto.includes('Apluno') && toolisto.includes('/ordia') && toolisto.includes('/workspace/'), 'Toolisto integra la jerarquía y promociones Apluno');

check(about.includes('No estamos construyendo una historia corporativa'), 'About evita una historia corporativa falsa');
check(ordia.includes('En desarrollo') && ordia.includes('Menos organización manual'), 'Ordía comunica estado y filosofía');
check(!/play store|app store|descargar ahora/i.test(ordia), 'Ordía no ofrece descargas falsas');
check(workspace.includes('En desarrollo') && workspace.includes('acceso público permanece cerrado'), 'Workspace es una landing honesta');
check(!workspace.includes('id="ws-app"'), 'La landing Workspace no expone el runtime interno');

check(sitemap.includes('<loc>https://apluno.com/toolisto</loc>'), 'Sitemap incluye /toolisto');
['about/', 'ordia/', 'workspace/', 'privacy/', 'terms/'].forEach((route) => check(sitemap.includes(`https://apluno.com/${route}`), `Sitemap incluye /${route}`));
check(robots.includes('Sitemap: https://apluno.com/sitemap.xml'), 'robots.txt declara el sitemap de Apluno');
check(!robots.includes('Disallow'), 'robots.txt no bloquea ninguna ruta pública');
check(redirects.includes('/toolisto /toolisto.html 200') && redirects.includes('/toolisto/ /toolisto 301'), 'Redirects resuelven la ruta limpia de Toolisto');

const toolManifest = JSON.parse(readFileSync(join(dist, 'assets', 'manifest.webmanifest'), 'utf8'));
const aplunoManifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
check(toolManifest.start_url === '/toolisto' && toolManifest.scope === '/', 'Manifest Toolisto abre /toolisto y cubre sus slugs planos');
check(aplunoManifest.start_url === '/' && aplunoManifest.name === 'Apluno', 'Manifest Apluno describe la marca madre');
check(read('service-worker.js').includes("'/toolisto'") && read('service-worker.js').includes('toolisto-static-v4'), 'Service worker cachea la entrada Toolisto actualizada');

const publicTextFiles = walk(dist).filter((file) => /\.(?:html|xml|txt|json|webmanifest|js|css)$/i.test(file));
const foreignDomainHits = publicTextFiles.filter((file) => readFileSync(file, 'utf8').includes('toolisto.com'));
check(foreignDomainHits.length === 0, `No quedan referencias públicas a toolisto.com (${foreignDomainHits.length})`);

const aplunoPages = requiredPages.map((page) => join(dist, page));
const broken = [];
for (const file of aplunoPages) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (match[1].includes("'") || match[1].includes(' + ')) continue;
    const target = publicTarget(match[1], file);
    if (target && !existsSync(target)) broken.push(`${file.slice(dist.length + 1)} -> ${match[1]}`);
  }
}
check(broken.length === 0, `Enlaces y recursos internos de Apluno existen${broken.length ? `: ${broken.slice(0, 5).join(', ')}` : ''}`);

console.log(`\nAPLUNO contract: ${passed} pass, ${failed} fail.`);
if (failed) process.exit(1);
