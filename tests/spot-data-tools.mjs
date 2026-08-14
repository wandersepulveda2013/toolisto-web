import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const tmpDir = join(root, '.spot-data-fixtures');

let failures = 0;
let passes = 0;
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; }
function ok(label, condition) { if (condition) pass(label); else fail(label); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf',
    '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
  writeFileSync(join(tmpDir, 'datos.csv'),
    'Nombre,Edad,Ciudad\nAna,30,Madrid\nLuis,25,Sevilla\n,40,Bilbao\n', 'utf8');
  writeFileSync(join(tmpDir, 'datos.json'),
    '{"ventas":[{"mes":"ene","total":120},{"mes":"feb","total":95}],"cliente":"Acme"}', 'utf8');
  writeFileSync(join(tmpDir, 'datos.xml'),
    '<libro><fila><nombre>Ana</nombre><edad>30</edad></fila><fila><nombre>Luis</nombre><edad>25</edad></fila><fila><nombre>Eva</nombre><edad>40</edad></fila></libro>', 'utf8');
  writeFileSync(join(tmpDir, 'datos-invalidos.json'),
    '{"nombre": "Ana", "edad": 30,,}', 'utf8');
  const XLSX = require(join(distDir, 'vendor', 'xlsx', 'xlsx.min.js'));
  const ws = XLSX.utils.aoa_to_sheet([['Nombre', 'Edad', 'Ciudad'], ['Ana', 30, 'Madrid'], ['Luis', 25, 'Sevilla'], ['', 40, 'Bilbao']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  writeFileSync(join(tmpDir, 'datos.xlsx'), out);
}

async function runTool(page, url, slug, files, expected, opts = {}) {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const fileInput = await page.$('#fileInput');
  if (!fileInput) { fail(`${slug}: no #fileInput`); return; }
  await fileInput.setInputFiles(files);
  await page.waitForTimeout(400);

  for (const [id, value] of Object.entries(opts)) {
    const el = await page.$(`#advancedControls #${id}`);
    if (!el) { fail(`${slug}: no control #${id}`); return; }
    await el.fill(String(value)).catch(async () => { await el.selectOption(String(value)); });
  }
  if (Object.keys(opts).length) await page.waitForTimeout(200);

  const runBtn = await page.$('#runButton');
  if (!runBtn) { fail(`${slug}: no #runButton`); return; }
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 10000 });
  await runBtn.click();
  await page.waitForFunction(() => {
    const dialog = document.getElementById('resultDialog');
    return dialog && dialog.open;
  }, { timeout: 20000 });

  const message = await page.$eval('#resultMessage', (el) => el.textContent);
  const hasDownload = !!(await page.$('#downloadButton'));
  const matches = new RegExp(expected, 'i').test(message);
  ok(matches, `${slug}: message "${message}" matches /${expected}/i`);
  ok(hasDownload, `${slug}: download button present`);
  if (consoleErrors.length) fail(`${slug}: console errors → ${consoleErrors.join(' | ')}`);
  else pass(`${slug}: no console errors`);
  await page.click('#resetButton').catch(() => {});
  await page.waitForTimeout(200);
}

async function run() {
  console.log('=== Spot Test: Motor de Hojas de Cálculo y Datos (13 herramientas) ===\n');
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
    await runTool(page, url, 'csv-a-markdown', [join(tmpDir, 'datos.csv')], 'Tabla Markdown generada');
    await runTool(page, url, 'csv-a-html', [join(tmpDir, 'datos.csv')], 'Tabla HTML generada');
    await runTool(page, url, 'csv-a-yaml', [join(tmpDir, 'datos.csv')], 'YAML generado');
    await runTool(page, url, 'excel-a-html', [join(tmpDir, 'datos.xlsx')], 'HTML generado');
    await runTool(page, url, 'excel-a-markdown', [join(tmpDir, 'datos.xlsx')], 'Markdown generado');
    await runTool(page, url, 'xml-a-excel', [join(tmpDir, 'datos.xml')], 'Excel generado');
    await runTool(page, url, 'estadisticas-csv', [join(tmpDir, 'datos.csv')], 'Estad');
    await runTool(page, url, 'filtrar-csv', [join(tmpDir, 'datos.csv')], 'filtrado', { column: '1', operator: '=', value: '30' });
    await runTool(page, url, 'ordenar-csv', [join(tmpDir, 'datos.csv')], 'ordenado', { column: '1', direction: 'asc' });
    await runTool(page, url, 'csv-a-sql', [join(tmpDir, 'datos.csv')], 'SQL generado');
    await runTool(page, url, 'formatear-json', [join(tmpDir, 'datos.json')], 'formateado');
    await runTool(page, url, 'excel-a-xml', [join(tmpDir, 'datos.xlsx')], 'XML generado');
    await runTool(page, url, 'validar-json', [join(tmpDir, 'datos-invalidos.json')], 'Validaci');
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n=== RESULTADO: ${passes} PASS, ${failures} FAIL ===`);
  process.exit(failures ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
