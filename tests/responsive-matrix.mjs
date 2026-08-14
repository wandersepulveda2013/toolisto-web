#!/usr/bin/env node
/**
 * Certifica el deployment estático real en la matriz responsive de producción.
 * Recorre las 167 herramientas habilitadas y el preview local del Workspace,
 * sin mocks: cada URL se sirve desde dist/ y se evalúa en Chromium.
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
const tools = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8'))
  .filter((tool) => tool.enabled);
const viewports = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.xml': 'application/xml' };
const failures = [];
const evidence = { generatedAt: new Date().toISOString(), tools: tools.length, viewports, checks: 0, failures };

function check(condition, label) {
  evidence.checks++;
  if (!condition) failures.push(label);
}

function startServer() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = normalize(join(dist, relative));
    if (!candidate.startsWith(dist) || !existsSync(candidate)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const file = statSync(candidate).isDirectory() ? join(candidate, 'index.html') : candidate;
    if (!existsSync(file)) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function pageMetrics(page) {
  return page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    clientWidth: document.documentElement.clientWidth,
    header: document.querySelector('.site-header')?.getBoundingClientRect().width || 0,
    runButtonMinHeight: Number.parseFloat(getComputedStyle(document.querySelector('#runButton')).minHeight) || 0,
  }));
}

const server = await startServer();
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: viewports[0] });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}\n${error.stack || ''}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const location = message.location();
  const source = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
  consoleErrors.push(`console: ${message.text()}${source}`);
});

try {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const tool of tools) {
      const beforeErrors = consoleErrors.length;
      const response = await page.goto(`${base}/${tool.slug}.html`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await pageMetrics(page);
      const prefix = `${tool.slug} @ ${viewport.name}`;
      check(response?.status() === 200, `${prefix}: HTTP ${response?.status()}`);
      check(metrics.scrollWidth <= metrics.clientWidth + 1, `${prefix}: overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
      check(metrics.header > 0 && metrics.header <= viewport.width + 1, `${prefix}: encabezado fuera de viewport (${metrics.header})`);
      check(metrics.runButtonMinHeight >= 40, `${prefix}: botón Ejecutar configurado bajo 40px (${metrics.runButtonMinHeight})`);
      check(consoleErrors.length === beforeErrors, `${prefix}: error de consola ${consoleErrors.slice(beforeErrors).join(' | ')}`);
    }
  }

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const beforeErrors = consoleErrors.length;
    const response = await page.goto(`${base}/workspace/preview.html?preview=internal`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      menuVisible: Boolean(document.querySelector('#ws-menu-toggle')?.offsetParent),
      appVisible: Boolean(document.querySelector('#ws-app')?.offsetParent),
    }));
    const prefix = `workspace @ ${viewport.name}`;
    check(response?.status() === 200, `${prefix}: HTTP ${response?.status()}`);
    check(metrics.appVisible, `${prefix}: preview interno no montó la aplicación`);
    check(metrics.scrollWidth <= metrics.clientWidth + 1, `${prefix}: overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
    if (viewport.width <= 768) check(metrics.menuVisible, `${prefix}: menú móvil no accesible`);
    check(consoleErrors.length === beforeErrors, `${prefix}: error de consola ${consoleErrors.slice(beforeErrors).join(' | ')}`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  mkdirSync(artifactDir, { recursive: true });
  writeEvidence(join(artifactDir, 'TLT-responsive-matrix-evidence.json'), evidence);
}

console.log(`Responsive matrix: ${evidence.checks - failures.length}/${evidence.checks} PASS; ${tools.length} herramientas × ${viewports.length} viewports + Workspace.`);
if (failures.length) {
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}
