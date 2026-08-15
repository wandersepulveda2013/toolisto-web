#!/usr/bin/env node
/**
 * Gate de accesibilidad del sitio generado. Recorre las herramientas reales en
 * Chromium y protege la semántica compartida que usan las 167 páginas.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const artifactDir = join(root, 'artifacts', 'deep-audit', 'toolisto');
const tools = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8')).filter((tool) => tool.enabled);
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
const failures = [];
const evidence = { generatedAt: new Date().toISOString(), tools: tools.length, checks: 0, failures };

function check(condition, label) {
  evidence.checks++;
  if (!condition) failures.push(label);
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function startServer() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/toolisto' || pathname === '/toolisto/'
      ? 'toolisto.html'
      : pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = normalize(join(dist, relative));
    if (!candidate.startsWith(dist) || !existsSync(candidate)) { response.writeHead(404); response.end('Not found'); return; }
    const file = statSync(candidate).isDirectory() ? join(candidate, 'index.html') : candidate;
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function auditSnapshot(page) {
  return page.evaluate(() => {
    const nameOf = (element) => (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim();
    const unnamed = [...document.querySelectorAll('button, a[href]')]
      .filter((element) => !element.hasAttribute('hidden') && !nameOf(element))
      .map((element) => element.outerHTML.slice(0, 100));
    const imagesWithoutAlt = [...document.images].filter((image) => !image.hasAttribute('alt')).map((image) => image.src);
    const skip = document.querySelector('.skip-link[href="#contenido"]');
    const main = document.querySelector('main#contenido');
    const menu = document.querySelector('#menuToggle');
    return {
      language: document.documentElement.lang,
      h1Count: document.querySelectorAll('main h1').length,
      skipTarget: Boolean(skip && main && main.getAttribute('tabindex') === '-1'),
      menuNamed: Boolean(menu?.getAttribute('aria-label')),
      menuControlsExisting: Boolean(menu && document.getElementById(menu.getAttribute('aria-controls'))),
      imagesWithoutAlt,
      unnamed,
    };
  });
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
  for (const tool of tools) {
    const beforeErrors = consoleErrors.length;
    const response = await page.goto(`${base}/${tool.slug}.html`, { waitUntil: 'domcontentloaded' });
    const snapshot = await auditSnapshot(page);
    const prefix = tool.slug;
    check(response?.status() === 200, `${prefix}: HTTP ${response?.status()}`);
    check(snapshot.language.startsWith('es'), `${prefix}: idioma de documento ausente`);
    check(snapshot.h1Count === 1, `${prefix}: se esperó un H1 principal, recibido ${snapshot.h1Count}`);
    check(snapshot.skipTarget, `${prefix}: enlace para saltar al contenido no enfocable`);
    check(snapshot.menuNamed && snapshot.menuControlsExisting, `${prefix}: menú móvil sin nombre o control válido`);
    check(snapshot.imagesWithoutAlt.length === 0, `${prefix}: imágenes sin alt (${snapshot.imagesWithoutAlt.join(', ')})`);
    check(snapshot.unnamed.length === 0, `${prefix}: controles sin nombre accesible (${snapshot.unnamed.join(' | ')})`);
    check(consoleErrors.length === beforeErrors, `${prefix}: error de consola ${consoleErrors.slice(beforeErrors).join(' | ')}`);
  }

  await page.goto(`${base}/toolisto`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement?.classList.contains('skip-link')), 'portada: el primer foco no es el enlace para saltar');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement?.id === 'contenido'), 'portada: saltar al contenido no mueve el foco al principal');

  await page.goto(`${base}/${tools[0].slug}.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#menuToggle').click();
  check(await page.evaluate(() => document.querySelector('#menuToggle')?.getAttribute('aria-expanded') === 'true' && !document.querySelector('#mobileNav')?.hidden), 'menú móvil: no comunica su estado expandido');
  check(readFileSync(join(root, 'styles.css'), 'utf8').includes('button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible'), 'CSS: falta indicador de foco visible compartido');
  for (const theme of ['', 'dark']) {
    const palette = await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme;
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(['--c-text', '--c-muted', '--c-primary', '--c-error', '--c-bg', '--c-surface'].map((token) => [token, style.getPropertyValue(token).trim()]));
    }, theme);
    for (const token of ['--c-text', '--c-muted', '--c-primary', '--c-error']) {
      check(contrastRatio(palette[token], token === '--c-primary' ? palette['--c-surface'] : palette['--c-bg']) >= 4.5, `${theme || 'claro'}: contraste insuficiente para ${token}`);
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  mkdirSync(artifactDir, { recursive: true });
  writeEvidence(join(artifactDir, 'TLT-accessibility-audit-evidence.json'), evidence);
}

console.log(`Accessibility audit: ${evidence.checks - failures.length}/${evidence.checks} PASS; ${tools.length} herramientas.`);
if (failures.length) {
  console.error(failures.slice(0, 25).join('\n'));
  process.exit(1);
}
