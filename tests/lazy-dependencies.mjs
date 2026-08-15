// lazy-dependencies.mjs — evita que las 167 páginas descarguen motores ajenos
// a la herramienta elegida antes de que el usuario inicie un procesamiento.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const heavyAssets = ['vendor/pdflib/pdf-lib.min.js', 'vendor/pdfjs/pdf.min.js', 'vendor/jszip/jszip.min.js', 'vendor/xlsx/xlsx.min.js', 'vendor/js/engine-loader.js'];
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  PASS: ${name}${detail ? ` (${detail})` : ''}`); }
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` (${detail})` : ''}`); }
};

function startServer() {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(req.url.split('?')[0]);
    const file = join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200); res.end(readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

async function run() {
  console.log('=== Lazy-load de dependencias pesadas ===\n');
  const pages = readdirSync(dist).filter(name => name.endsWith('.html') && name !== '404.html');
  check('se generaron las 167 páginas de herramientas', pages.length >= 167, String(pages.length));
  const eager = pages.filter(name => {
    const html = readFileSync(join(dist, name), 'utf8');
    return heavyAssets.some(asset => html.includes(`src="./${asset}"`));
  });
  check('ninguna página carga bibliotecas pesadas al inicio', eager.length === 0, eager.join(', '));

  const { server, url } = await startServer();
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    const requested = [];
    const startupErrors = [];
    page.on('request', request => requested.push(new URL(request.url()).pathname.replace(/^\//, '')));
    page.on('pageerror', error => startupErrors.push(error.message));
    await page.goto(`${url}/comprimir-imagen.html`, { waitUntil: 'networkidle' });
    check('una herramienta de imagen no descarga motores PDF/OCR/hojas de cálculo', !requested.some(path => heavyAssets.includes(path)), requested.filter(path => heavyAssets.includes(path)).join(', '));
    check('los cargadores siguen declarados para uso diferido', await page.evaluate(() => typeof window.ToolProcessors === 'object' && !window.PDFLib && !window.pdfjsLib && !window.EngineLoader));

    const pdfInitializerPages = ['dividir-pdf', 'insertar-paginas-en-blanco-pdf', 'editar-metadatos-pdf', 'comprimir-pdf', 'intercalar-pdf', 'numerar-paginas-pdf'];
    for (const slug of pdfInitializerPages) {
      const beforeRequests = requested.length;
      const beforeErrors = startupErrors.length;
      await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
      const loadedHeavyAsset = requested.slice(beforeRequests).some(path => heavyAssets.includes(path));
      check(`${slug} no inicializa motores PDF sin archivo`, !loadedHeavyAsset && startupErrors.length === beforeErrors,
        startupErrors.slice(beforeErrors).join(' | ') || requested.slice(beforeRequests).filter(path => heavyAssets.includes(path)).join(', '));
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(`\nRESUMEN: ${passed} PASS, ${failed} FAIL`);
  if (failed) process.exit(1);
}
run().catch(error => { console.error(error); process.exit(1); });
