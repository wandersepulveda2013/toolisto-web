#!/usr/bin/env node
/**
 * pdf-image-embed-e2e.mjs — CE-036: image-block embebido como imagen real en document.to-pdf.
 * Validación en navegador REAL: canvas convierte PNG/WebP a JPEG y el pdf-generator
 * incrusta /Subtype /Image con DCTDecode (sin vía cruda de VM, sin mocks de almacenamiento).
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'pdf-image-embed');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://localhost:${PORT}/workspace/index.html`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const srv = createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  let fp = join(DIST, file);
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
  if (!existsSync(fp)) fp = join(DIST, file + '.html');
  const ext = extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

let pass = 0, fail = 0;
function ok(n, d = '') { pass++; console.log(`  PASS: [${n}] ${d}`); }
function ko(n, d = '') { fail++; console.log(`  FAIL: [${n}] ${d}`); }

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}\n`);

function sample(source) {
  return source.slice(0, 32) + '...';
}

async function runEmbed({ png, jpeg }) {
  const { createOperationRegistry } = await import('/workspace/core/operation-registry.js');
  const { registerWorkflowOperations } = await import('/workspace/core/workflow-operations.js');
  const registry = createOperationRegistry();
  registerWorkflowOperations(registry);
  const op = registry.get('document.to-pdf');
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const webp = probe.toDataURL('image/webp');
  const leakMarker = dataUrl => dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 17);
  function decode(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ ok: false, w: 0, h: 0 });
      img.src = src;
    });
  }
  async function embed(kind, dataUrl) {
    const decoded = await decode(dataUrl);
    const marker = leakMarker(dataUrl);
    const blob = await op.execute({ input: { data: { title: 'Doc con ' + kind, blocks: [
      { id: 'h', type: 'heading1', content: 'Informe superficie' },
      { id: 'i', type: 'image-block', content: dataUrl },
      { id: 'p', type: 'paragraph', content: 'Cierre del informe.' },
    ] } }, options: {} });
    const text = await blob.text();
    return {
      subtype: text.includes('/Subtype /Image'),
      dct: text.includes('/DCTDecode'),
      leak: marker ? text.includes(marker) : false,
      placeholder: text.includes('[Imagen embebida]'),
      syntheticBase64: !/data:image\/(?:png|jpeg|webp|jpg);base64,[A-Za-z0-9+/=]+/.test(text),
      len: text.length,
      decoded,
      webpPrefix: kind === 'webp' ? marker : null,
    };
  }
  return { jpeg: await embed('jpeg', jpeg), png: await embed('png', png), webp: await embed('webp', webp) };
}

try {
  console.log('=== Workflow document.to-pdf image embedding (CE-036) ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ9wAAAABJRU5ErkJggg==';
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

  await page.goto(BASE + '?preview=internal', { waitUntil: 'domcontentloaded', timeout: 15000 });
  const result = await page.evaluate(runEmbed, { png, jpeg });
  console.log('  [diag] decode: jpeg=' + JSON.stringify(result.jpeg.decoded) + ' png=' + JSON.stringify(result.png.decoded) + ' webp=' + JSON.stringify(result.webp.decoded) + ' webp(prefix)=' + result.webp.webpPrefix);
  console.log('  [diag] placeholder: jpeg=' + result.jpeg.placeholder + ' png=' + result.png.placeholder + ' webp=' + result.webp.placeholder);

  if (result.jpeg.subtype) ok('JPEG passthrough embeds /Subtype /Image'); else ko('JPEG passthrough embeds /Subtype /Image');
  if (result.jpeg.dct) ok('JPEG passthrough uses DCTDecode'); else ko('JPEG passthrough uses DCTDecode');
  if (!result.jpeg.leak) ok('JPEG does not leak base64 as text'); else ko('JPEG does not leak base64 as text');
  if (result.jpeg.len > 500) ok('JPEG sample has reasonable size'); else ko('JPEG sample has reasonable size', sample(String(result.jpeg.len)));

  if (result.png.subtype) ok('PNG is re-encoded to a real embedded image'); else ko('PNG is re-encoded to a real embedded image');
  if (result.png.dct) ok('PNG embed uses DCTDecode (via canvas JPEG)'); else ko('PNG embed uses DCTDecode (via canvas JPEG)');
  if (!result.png.leak) ok('PNG base64 does not leak as renderable text'); else ko('PNG base64 does not leak as renderable text');
  if (!result.png.placeholder) ok('PNG no longer renders the placeholder box'); else ko('PNG no longer renders the placeholder box');
  if (result.png.len > 500) ok('PNG sample has reasonable size'); else ko('PNG sample has reasonable size', sample(String(result.png.len)));

  if (result.webp.subtype) ok('WebP is re-encoded to a real embedded image'); else ko('WebP is re-encoded to a real embedded image');
  if (result.webp.dct) ok('WebP embed uses DCTDecode (via canvas JPEG)'); else ko('WebP embed uses DCTDecode (via canvas JPEG)');
  if (!result.webp.leak) ok('WebP base64 does not leak as renderable text'); else ko('WebP base64 does not leak as renderable text');
  if (result.webp.len > 500) ok('WebP sample has reasonable size'); else ko('WebP sample has reasonable size', sample(String(result.webp.len)));

  const allSynthetic = result.jpeg.syntheticBase64 && result.png.syntheticBase64 && result.webp.syntheticBase64;
  if (allSynthetic) ok('No raw data:image/base64 text remains in the PDFs'); else ko('No raw data:image/base64 text remains in the PDFs');
  if (jsErrors.length === 0) ok('No uncaught JS errors during real browser execution');
  else ko('No uncaught JS errors during real browser execution', jsErrors.join(', '));

  await page.screenshot({ path: join(ARTIFACTS, 'pdf-image-embed.png'), fullPage: false });
  await browser.close();
  ok('E2E', 'CE-036 browser run completed');
} catch (e) {
  console.error('  ERROR: ' + e.message);
  fail++;
} finally {
  srv.close();
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
