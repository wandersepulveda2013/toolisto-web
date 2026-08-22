#!/usr/bin/env node
/**
 * Gate de seguridad del sitio público: protege los sinks HTML compartidos,
 * verifica una entrada real con nombre hostil y mantiene auditadas las
 * dependencias y posibles claves en código propio.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const artifactDir = join(root, 'artifacts', 'deep-audit', 'toolisto');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const evidence = { suite: 'public-site-security-audit', generatedAt: new Date().toISOString(), checks: [], failures: [] };
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

function check(condition, name, detail = '') {
  evidence.checks.push({ name, pass: Boolean(condition), detail });
  if (!condition) evidence.failures.push(detail ? `${name}: ${detail}` : name);
}

function startServer() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = normalize(join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function ownSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'vendor', 'dist', 'artifacts', '.git'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) ownSourceFiles(path, files);
    else if (/\.(?:js|mjs|html|json)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

const expectedDevDependencies = new Set(['@axe-core/playwright', '@ffmpeg/core', '@ffmpeg/ffmpeg', '@ffmpeg/util', '@playwright/test', 'playwright', 'tesseract.js']);
check(!packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0, 'dependencias de producción: ninguna dependencia de red');
check(Object.keys(packageJson.devDependencies || {}).every((name) => expectedDevDependencies.has(name)), 'dependencias de desarrollo: lista revisada', Object.keys(packageJson.devDependencies || {}).join(', '));
const suspiciousSecrets = ownSourceFiles(root).flatMap((file) => {
  const matches = readFileSync(file, 'utf8').match(/(?:AIza[\w-]{20,}|(?:sk|pk)_(?:live|test)_[\w-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g) || [];
  return matches.map((match) => `${file}: ${match.slice(0, 16)}…`);
});
check(suspiciousSecrets.length === 0, 'código propio: sin claves o secretos de proveedor', suspiciousSecrets.join(' | '));
check(appSource.includes('function sanitizeSummaryHtml') && appSource.includes('els.previewArea.innerHTML = sanitizeSummaryHtml(result.html || \'\');'), 'sink de resumen: sanitización obligatoria');

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
  await page.goto(`${base}/codificar-base64.html`, { waitUntil: 'networkidle' });
  const hostileName = '<img src=x onerror=window.__toolistoXss=1>.txt';
  await page.locator('#fileInput').setInputFiles({ name: hostileName, mimeType: 'text/plain', buffer: Buffer.from('entrada segura', 'utf8') });
  const fileStrip = await page.locator('#fileStrip').evaluate((element) => ({ html: element.innerHTML, text: element.textContent }));
  check(!fileStrip.html.includes('<img') && fileStrip.text.includes('<img'), 'nombre de archivo hostil: se muestra como texto, no HTML', fileStrip.html);

  const sanitizer = await page.evaluate(() => {
    const dirty = '<img src="javascript:alert(1)" onerror="window.__toolistoXss=1"><svg onload="window.__toolistoXss=1"></svg><strong>texto seguro</strong>';
    const clean = window.ToolistoSecurity.sanitizeSummaryHtml(dirty);
    const holder = document.createElement('div');
    holder.innerHTML = clean;
    document.body.appendChild(holder);
    return { clean, xss: window.__toolistoXss === 1, dangerousNodes: holder.querySelectorAll('svg,script,[onerror],[onload]').length, dangerousUrls: holder.querySelectorAll('[src^="javascript:"]').length, text: holder.textContent };
  });
  check(!sanitizer.xss && sanitizer.dangerousNodes === 0 && sanitizer.dangerousUrls === 0 && sanitizer.text.includes('texto seguro'), 'resumen hostil: se sanea antes de renderizar', JSON.stringify(sanitizer));
  check(consoleErrors.length === 0, 'navegador: sin errores de consola', consoleErrors.join(' | '));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  mkdirSync(artifactDir, { recursive: true });
  evidence.total = evidence.checks.length;
  evidence.passed = evidence.checks.filter((entry) => entry.pass).length;
  evidence.failed = evidence.failures.length;
  writeEvidence(join(artifactDir, 'TLT-public-site-security-audit-evidence.json'), evidence);
}

console.log(`Public security audit: ${evidence.passed}/${evidence.total} PASS.`);
if (evidence.failures.length) { console.error(evidence.failures.join('\n')); process.exit(1); }
