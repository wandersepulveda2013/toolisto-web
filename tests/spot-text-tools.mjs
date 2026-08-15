import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const tmpDir = join(root, '.spot-text-fixtures');

let failures = 0;
let passes = 0;
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf',
    '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function makeFixtures() {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'sample.txt'), 'Hola mundo. Esto es una prueba.\nSegunda línea con más palabras.', 'utf8');
  writeFileSync(join(tmpDir, 'base64.txt'), 'SG9sYSBNdW5kbw==', 'utf8');
  writeFileSync(join(tmpDir, 'url.txt'), 'Hola%20Mundo%20%26%20m%C3%A1s', 'utf8');
  writeFileSync(join(tmpDir, 'diff-a.txt'), 'Hola mundo\nEsto es una prueba.\n', 'utf8');
  writeFileSync(join(tmpDir, 'diff-b.txt'), 'Hola universo\nEsto es una prueba nueva.\n', 'utf8');
  writeFileSync(join(tmpDir, 'sample.html'), '<html><body><h1>Título</h1><p>Un <strong>párrafo</strong> con texto.</p></body></html>', 'utf8');
  writeFileSync(join(tmpDir, 'sample.css'), 'body { color: red; /* comentario */ margin: 0 auto; }', 'utf8');
}

async function runTool(page, url, slug, files, expected) {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const fileInput = await page.$('#fileInput');
  if (!fileInput) { fail(`${slug}: no #fileInput`); return; }
  await fileInput.setInputFiles(files);
  await page.waitForTimeout(400);

  const runBtn = await page.$('#runButton');
  if (!runBtn) { fail(`${slug}: no #runButton`); return; }
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 10000 });
  await runBtn.click();
  await page.waitForFunction(() => {
    const dialog = document.getElementById('resultDialog');
    return dialog && dialog.open;
  }, { timeout: 20000 });

  const title = await page.$eval('#resultTitle', (el) => el.textContent);
  const message = await page.$eval('#resultMessage', (el) => el.textContent);
  const hasStats = (await page.$$('#resultStats .stat')).length > 0;
  const hasDownload = !!(await page.$('#downloadButton'));
  const matches = new RegExp(expected, 'i').test(message);
  pass(`${slug}: dialog opened`);
  ok(matches, `${slug}: message "${message}" matches /${expected}/i`);
  ok(hasStats, `${slug}: stats rendered`);
  ok(hasDownload, `${slug}: download button present`);
  if (consoleErrors.length) fail(`${slug}: console errors → ${consoleErrors.join(' | ')}`);
  else pass(`${slug}: no console errors`);
  await page.click('#resetButton').catch(() => {});
  await page.waitForTimeout(200);
}

function ok(label, condition) {
  if (condition) pass(label); else fail(label);
}

async function run() {
  console.log('=== Spot Test: Motor de Texto (10 herramientas) ===\n');
  makeFixtures();
  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runTool(page, url, 'estadisticas-texto', [join(tmpDir, 'sample.txt')], 'Estad');
    await runTool(page, url, 'contar-palabras', [join(tmpDir, 'sample.txt')], 'Conteo');
    await runTool(page, url, 'comparar-textos', [join(tmpDir, 'diff-a.txt'), join(tmpDir, 'diff-b.txt')], 'Comparaci');
    await runTool(page, url, 'html-a-markdown', [join(tmpDir, 'sample.html')], 'Markdown');
    await runTool(page, url, 'html-a-texto', [join(tmpDir, 'sample.html')], 'Texto extra');
    await runTool(page, url, 'minificar-css', [join(tmpDir, 'sample.css')], 'minificado');
    await runTool(page, url, 'codificar-base64', [join(tmpDir, 'sample.txt')], 'codificado');
    await runTool(page, url, 'decodificar-base64', [join(tmpDir, 'base64.txt')], 'decodificado');
    await runTool(page, url, 'codificar-url', [join(tmpDir, 'sample.txt')], 'codificado');
    await runTool(page, url, 'decodificar-url', [join(tmpDir, 'url.txt')], 'decodificado');
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n=== RESULTADO: ${passes} PASS, ${failures} FAIL ===`);
  process.exit(failures ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
