const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8099;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  let file = path.join(ROOT, 'dist', p.replace(/^\/+/, ''));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function waitFor(fn, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      try { if (fn()) { clearInterval(iv); resolve(); } } catch (e) {}
      if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout')); }
    }, 100);
  });
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/contar-paginas-pdf.html`, { waitUntil: 'networkidle' });

  // Falso PDF: un archivo de texto plano con extensión .pdf (sin firma %PDF)
  const fakePdf = {
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('Hola esto es texto plano disfrazado de pdf 1234567890', 'utf-8')
  };
  // PNG real mínimo
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex');
  await page.setInputFiles('input[type="file"]', fakePdf);
  await page.setInputFiles('input[type="file"]', { name: 'real.png', mimeType: 'image/png', buffer: png });

  await waitFor(() => page.evaluate(() => true), 200).catch(() => {});
  // Esperamos a que la verificación asíncrona de firmas actúe
  await new Promise(r => setTimeout(r, 800));

  const pills = await page.$$eval('.file-pill', els => els.map(e => e.textContent || ''));
  const toasts = await page.$$eval('.toast, [class*="toast"]', els => els.map(e => e.textContent || ''));
  const result = await page.evaluate(() => ({
    hasFileLimits: !!window.FileLimits,
    hasVerify: !!window.FileLimits && typeof window.FileLimits.verifySignature === 'function'
  }));

  console.log('hasFileLimits:', result.hasFileLimits, 'hasVerify:', result.hasVerify);
  console.log('pills:', JSON.stringify(pills));
  console.log('toasts:', JSON.stringify(toasts.filter(Boolean)));
  console.log('consoleErrors:', JSON.stringify(consoleErrors));

  const rejectedFake = !pills.some(p => p.includes('fake.pdf'));
  const keptReal = pills.some(p => p.includes('real.png'));
  console.log('RESULT:', rejectedFake && keptReal && consoleErrors.length === 0 ? 'PASS' : 'FAIL');

  await browser.close();
  server.close();
  process.exit(rejectedFake && keptReal && consoleErrors.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
