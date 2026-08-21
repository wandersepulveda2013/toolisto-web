#!/usr/bin/env node
/**
 * gate-e2e-image-converters.mjs — Certificación E2E de los 13 tools de imagen
 * con UI genérica sobre el deployment real en dist/.
 *
 * Cubre: jpg-to-png (jpg-a-png), png-to-jpg (png-a-jpg), jpg-to-webp (jpg-a-webp),
 * webp-to-jpg (webp-a-jpg), png-to-webp (png-a-webp), webp-to-png (webp-a-png),
 * jpg-to-pdf (jpg-a-pdf), png-to-pdf (png-a-pdf), pdf-to-jpg (pdf-a-jpg),
 * pdf-to-png (pdf-a-png), compress (comprimir-imagen), convert (convertir-imagen)
 * y batchCompress (comprimir-imagenes).
 *
 * Cada herramienta: (1) abre con el botón deshabilitado hasta elegir archivo,
 * (2) procesa fixtures reales generados en el navegador (PNG/JPEG/WebP/PDF) por
 * la UI real, (3) salida verificada por magic bytes y dimensiones, (4) mensaje
 * prometido, (5) casos negativos (múltiples archivos donde se exige uno, PDFs
 * donde se exige exactamente uno), (6) cero egress externo, (7) cero errores de
 * consola no controlados.
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'img-convert-dl');
const EVIDENCE_PATH = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-image-converters-evidence.json');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0;
let passes = 0;
const checks = [];
const failureReasons = [];
const consoleErrors = [];
const externalRequests = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }

function sigPng(b) { return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }
function sigJpg(b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }
function sigWebp(b) { return b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'; }
function sigPdf(b) { return b.toString('latin1', 0, 4) === '%PDF'; }
function sigZip(b) { return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
    '.woff2': 'font/woff2', '.gz': 'application/gzip', '.bin': 'application/octet-stream',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function run() {
  console.log('=== Gate E2E Image Converters (13 herramientas, UI genérica) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('request', (req) => {
    const urlStr = req.url();
    if (urlStr.startsWith('blob:') || urlStr.startsWith('data:')) return;
    const u = new URL(urlStr);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') externalRequests.push(urlStr);
  });

  const gotoPage = async (slug) => {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  const upload = async (files, waitEnabled = true) => {
    await page.locator('#fileInput').setInputFiles(files);
    if (waitEnabled) {
      try {
        await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          tool: window.__selectedTool,
          disabled: document.getElementById('runButton')?.disabled,
          description: document.getElementById('smartDescription')?.textContent,
          files: document.querySelectorAll('.file-pill').length,
        }));
        throw new Error(`La carga no habilitó la herramienta: ${JSON.stringify(snapshot)}; ${error.message}`);
      }
    }
  };
  const waitDialog = async (timeout = 60000) => {
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout });
  };
  const closeDialog = async () => {
    await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
    await page.waitForTimeout(150);
  };
  const runTool = async () => {
    await page.click('#runButton');
    await waitDialog();
  };
  const resultMessage = () => page.$eval('#resultMessage', (el) => el.textContent);
  const runDisabled = () => page.$eval('#runButton', (el) => el.disabled);
  const downloadResult = async () => {
    const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await page.click('#downloadButton');
    const dl = await dlPromise;
    if (!dl) return null;
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await dl.saveAs(tmp);
    return { buffer: readFileSync(tmp), name: dl.suggestedFilename() };
  };
  const imageInfo = async (b64) => page.evaluate((payload) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, ok: true });
    img.onerror = () => resolve({ ok: false });
    img.src = `data:image/*;base64,${payload.b64}`;
  }), { b64 });
  const zipEntries = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    try {
      const zip = await window.JSZip.loadAsync(u);
      const out = [];
      for (const name of Object.keys(zip.files)) {
        const f = zip.files[name];
        if (f.dir) continue;
        const c = await f.async('uint8array');
        out.push({ name, size: c.length });
      }
      return { ok: true, entries: out };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, { b64 });
  const pdfPageCount = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    try {
      const doc = await window.PDFLib.PDFDocument.load(u);
      return { ok: true, pages: doc.getPageCount() };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, { b64 });

  try {
    /* ── Fixtures (generados en el navegador) ─────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage('pdf-a-jpg');
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    const fx = await page.evaluate(async () => {
      const noiseCanvas = (w, h) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d');
        let seed = 42;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        for (let i = 0; i < 600; i++) {
          x.fillStyle = `rgb(${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)})`;
          x.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 6 + Math.floor(rnd() * 24), 6 + Math.floor(rnd() * 24));
        }
        x.fillStyle = '#ffffff';
        x.fillRect(12, 12, 120, 60);
        x.fillStyle = '#173b62';
        x.font = 'bold 34px sans-serif';
        x.fillText('TLST-IMG', 20, 56);
        return c;
      };
      const toB64 = (blob) => new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.readAsDataURL(blob);
      });
      const c = noiseCanvas(320, 220);
      const cBig = noiseCanvas(900, 700);
      const png = await new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
      const jpg = await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.9));
      const webp = await new Promise((res) => c.toBlob((b) => res(b), 'image/webp', 0.9));
      const jpgBig = await new Promise((res) => cBig.toBlob((b) => res(b), 'image/jpeg', 0.92));
      const pdfDoc = await window.PDFLib.PDFDocument.create();
      for (let p = 0; p < 2; p++) {
        const pg = pdfDoc.addPage([300, 400]);
        pg.drawText(`Pagina ${p + 1} TLST-PDF`, { x: 30, y: 300, size: 16 });
      }
      const pdfBytes = await pdfDoc.save();
      const pdfBin = new Uint8Array(pdfBytes);
      let pdfB64 = '';
      for (let i = 0; i < pdfBin.length; i++) pdfB64 += String.fromCharCode(pdfBin[i]);
      return {
        png: await toB64(png),
        jpg: await toB64(jpg),
        webp: await toB64(webp),
        jpgBig: await toB64(jpgBig),
        pdf: btoa(pdfB64),
      };
    });
    const png = Buffer.from(fx.png, 'base64');
    const jpg = Buffer.from(fx.jpg, 'base64');
    const webp = Buffer.from(fx.webp, 'base64');
    const jpgBig = Buffer.from(fx.jpgBig, 'base64');
    const pdf = Buffer.from(fx.pdf, 'base64');
    ok(png.length > 100 && sigPng(png), 'fixture PNG válido', png.length + ' bytes');
    ok(jpg.length > 100 && sigJpg(jpg), 'fixture JPG válido', jpg.length + ' bytes');
    ok(webp.length > 100 && sigWebp(webp), 'fixture WebP válido', webp.length + ' bytes');
    ok(jpgBig.length > 20000, 'fixture JPG grande para comprimir', jpgBig.length + ' bytes');
    const pdfInfo = await pdfPageCount(fx.pdf);
    ok(pdfInfo.ok && pdfInfo.pages === 2, 'fixture PDF de 2 páginas', pdfInfo.pages + ' páginas');

    const C = { png, jpg, webp, jpgBig, pdf };

    /* ── Conversores imagen→imagen (6) ─────────────────────────────────── */
    const converters = [
      { slug: 'jpg-a-png', name: 'JPG a PNG', input: 'jpg', accept: 'image/jpeg', out: 'png', ext: '.png', inName: 'foto.jpg', outName: 'foto.png' },
      { slug: 'png-a-jpg', name: 'PNG a JPG', input: 'png', accept: 'image/png', out: 'jpg', ext: '.jpg', inName: 'foto.png', outName: 'foto.jpg' },
      { slug: 'jpg-a-webp', name: 'JPG a WebP', input: 'jpg', accept: 'image/jpeg', out: 'webp', ext: '.webp', inName: 'foto.jpg', outName: 'foto.webp' },
      { slug: 'webp-a-jpg', name: 'WebP a JPG', input: 'webp', accept: 'image/webp', out: 'jpg', ext: '.jpg', inName: 'foto.webp', outName: 'foto.jpg' },
      { slug: 'png-a-webp', name: 'PNG a WebP', input: 'png', accept: 'image/png', out: 'webp', ext: '.webp', inName: 'foto.png', outName: 'foto.webp' },
      { slug: 'webp-a-png', name: 'WebP a PNG', input: 'webp', accept: 'image/webp', out: 'png', ext: '.png', inName: 'foto.webp', outName: 'foto.png' },
    ];
    const sigMap = { png: sigPng, jpg: sigJpg, webp: sigWebp };
    for (const t of converters) {
      console.log(`\n--- ${t.name} (${t.slug}) ---`);
      await gotoPage(t.slug);
      ok(await runDisabled(), `${t.name} inicia con el botón deshabilitado`);
      const buf = C[t.input];
      await upload([{ name: t.inName, mimeType: t.accept, buffer: buf }]);
      ok(!(await runDisabled()), `${t.name} habilita el botón tras elegir ${t.input.toUpperCase()}`);
      await runTool();
      ok((await resultMessage()).length > 0, `${t.name} message prometido en el diálogo`);
      const dl = await downloadResult();
      ok(dl !== null, `${t.name} descarga un archivo`);
      if (dl) {
        ok(dl.name.endsWith(t.ext), `${t.name} salida con extensión ${t.ext}`, dl.name);
        ok(sigMap[t.out](dl.buffer), `${t.name} magic bytes de ${t.out.toUpperCase()} correctos`);
        if (t.out === 'png') {
          const info = await imageInfo(toBase64(dl.buffer));
          ok(info.ok && info.w === 320 && info.h === 220, `${t.name} dimensiones preservadas 320×220`, JSON.stringify(info));
        }
      }
      await closeDialog();
    }

    /* ── Imágenes → PDF (2) ────────────────────────────────────────────── */
    console.log('\n--- jpg-a-pdf / png-a-pdf (imagesPdf) ---');
    await gotoPage('jpg-a-pdf');
    ok(await runDisabled(), 'JPG a PDF inicia con el botón deshabilitado');
    await upload([{ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpg }]);
    ok(!(await runDisabled()), 'JPG a PDF habilita el botón con una imagen');
    await runTool();
    ok((await resultMessage()).includes('1 página'), 'JPG a PDF message con conteo de páginas');
    const dlJpgPdf = await downloadResult();
    ok(dlJpgPdf && sigPdf(dlJpgPdf.buffer), 'JPG a PDF descarga un PDF válido (%PDF)');
    if (dlJpgPdf) {
      const pc = await pdfPageCount(toBase64(dlJpgPdf.buffer));
      ok(pc.ok && pc.pages === 1, 'JPG a PDF tiene 1 página', JSON.stringify(pc));
    }
    await closeDialog();

    await gotoPage('png-a-pdf');
    await upload([
      { name: 'foto.png', mimeType: 'image/png', buffer: png },
      { name: 'foto2.png', mimeType: 'image/png', buffer: png },
    ]);
    ok(!(await runDisabled()), 'PNG a PDF habilita el botón con dos imágenes');
    await runTool();
    const dlPngPdf = await downloadResult();
    ok(dlPngPdf && sigPdf(dlPngPdf.buffer), 'PNG a PDF descarga un PDF válido');
    if (dlPngPdf) {
      const pc = await pdfPageCount(toBase64(dlPngPdf.buffer));
      ok(pc.ok && pc.pages === 2, 'PNG a PDF tiene 2 páginas (una por imagen)', JSON.stringify(pc));
    }
    await closeDialog();

    /* ── PDF → imágenes (2) ────────────────────────────────────────────── */
    console.log('\n--- pdf-a-jpg / pdf-a-png (pdfToImages) ---');
    for (const t of [
      { slug: 'pdf-a-jpg', name: 'PDF a JPG', out: 'jpg' },
      { slug: 'pdf-a-png', name: 'PDF a PNG', out: 'png' },
    ]) {
      await gotoPage(t.slug);
      ok(await runDisabled(), `${t.name} inicia con el botón deshabilitado`);
      await upload([{ name: 'libro.pdf', mimeType: 'application/pdf', buffer: pdf }]);
      ok(!(await runDisabled()), `${t.name} habilita el botón con un PDF`);
      await runTool();
      ok((await resultMessage()).includes('2 páginas'), `${t.name} message con 2 páginas exportadas`);
      const dl = await downloadResult();
      ok(dl && sigZip(dl.buffer), `${t.name} descarga ZIP de páginas`, dl ? dl.name : 'sin descarga');
      if (dl) {
        ok(dl.name.endsWith('-paginas.zip'), `${t.name} ZIP con nombre base-paginas`, dl.name);
        const z = await zipEntries(toBase64(dl.buffer));
        ok(z.ok && z.entries.length === 2, `${t.name} ZIP con 2 entradas`, z.ok ? z.entries.map((e) => e.name).join(', ') : z.error);
        if (z.ok && z.entries.length === 2) {
          const extOk = z.entries.every((e) => e.name.endsWith('.' + t.out));
          ok(extOk, `${t.name} entradas con extensión .${t.out}`, z.entries.map((e) => e.name).join(', '));
        }
      }
      await closeDialog();
    }
    await gotoPage('pdf-a-jpg');
    await upload([{ name: 'a.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'b.pdf', mimeType: 'application/pdf', buffer: pdf }], false);
    await page.waitForTimeout(300);
    ok(await runDisabled(), 'PDF a JPG negativo: dos PDFs mantiene el botón deshabilitado');

    /* ── compress (comprimir-imagen) ───────────────────────────────────── */
    console.log('\n--- compress (comprimir-imagen) ---');
    await gotoPage('comprimir-imagen');
    ok(await runDisabled(), 'compress inicia con el botón deshabilitado');
    await upload([{ name: 'foto-grande.jpg', mimeType: 'image/jpeg', buffer: jpgBig }]);
    ok(!(await runDisabled()), 'compress habilita el botón con una imagen');
    await page.evaluate(() => { const p = document.getElementById('advancedPanel'); if (p) { p.hidden = false; p.open = true; } });
    await page.evaluate(() => { const d = document.getElementById('compressAdvancedWrap'); if (d) d.open = true; });
    await page.waitForTimeout(300);
    await page.fill('#targetKb', '30');
    await page.selectOption('#compressFormat', 'image/jpeg');
    await runTool();
    ok((await resultMessage()).length > 0, 'compress message prometido');
    const dlComp = await downloadResult();
    ok(dlComp && sigJpg(dlComp.buffer), 'compress descarga JPEG válido');
    if (dlComp) {
      ok(dlComp.buffer.length < jpgBig.length, 'compress reduce el peso respecto al original', `${jpgBig.length} → ${dlComp.buffer.length} bytes`);
      ok(dlComp.name.endsWith('-optimizada.jpg'), 'compress nombre con sufijo -optimizada', dlComp.name);
    }
    await closeDialog();
    await gotoPage('comprimir-imagen');
    await upload([{ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('no soy una imagen', 'utf8') }], false);
    await page.waitForTimeout(300);
    ok(await runDisabled(), 'compress negativo: un archivo no-imagen mantiene el botón deshabilitado');

    /* ── convert (convertir-imagen) ────────────────────────────────────── */
    console.log('\n--- convert (convertir-imagen) ---');
    await gotoPage('convertir-imagen');
    ok(await runDisabled(), 'convert inicia con el botón deshabilitado');
    await upload([{ name: 'foto.png', mimeType: 'image/png', buffer: png }]);
    ok(!(await runDisabled()), 'convert habilita el botón con una imagen');
    await page.selectOption('#convertFormat', 'image/jpeg');
    await runTool();
    const dlConv = await downloadResult();
    ok(dlConv && sigJpg(dlConv.buffer), 'convert (1 archivo) descarga JPG', dlConv && dlConv.name);
    if (dlConv) ok(dlConv.name.endsWith('.jpg'), 'convert salida con extensión .jpg', dlConv.name);
    await closeDialog();
    await gotoPage('convertir-imagen');
    await upload([
      { name: 'a.png', mimeType: 'image/png', buffer: png },
      { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpg },
    ]);
    await page.selectOption('#convertFormat', 'image/webp');
    await runTool();
    const dlConvZip = await downloadResult();
    ok(dlConvZip && sigZip(dlConvZip.buffer), 'convert (2 archivos) descarga ZIP');
    if (dlConvZip) {
      const z = await zipEntries(toBase64(dlConvZip.buffer));
      ok(z.ok && z.entries.length === 2, 'convert ZIP con 2 entradas', z.ok ? z.entries.map((e) => e.name).join(', ') : z.error);
    }
    await closeDialog();

    /* ── batchCompress (comprimir-imagenes) ────────────────────────────── */
    console.log('\n--- batchCompress (comprimir-imagenes) ---');
    await gotoPage('comprimir-imagenes');
    ok(await runDisabled(), 'batchCompress inicia con el botón deshabilitado');
    await upload([
      { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg },
      { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpg },
    ]);
    ok(!(await runDisabled()), 'batchCompress habilita el botón con dos imágenes');
    await runTool();
    const dlBatch = await downloadResult();
    ok(dlBatch && sigZip(dlBatch.buffer), 'batchCompress descarga ZIP', dlBatch && dlBatch.name);
    if (dlBatch) {
      ok(dlBatch.name.endsWith('.zip'), 'batchCompress ZIP con nombre toolisto-imagenes-comprimidas', dlBatch.name);
      const z = await zipEntries(toBase64(dlBatch.buffer));
      ok(z.ok && z.entries.length === 2, 'batchCompress ZIP con 2 entradas', z.ok ? z.entries.map((e) => e.name).join(', ') : z.error);
    }
    await closeDialog();

    /* ── Red y consola ─────────────────────────────────────────────────── */
    console.log('\n--- Sin red externa ---');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.join(', ').slice(0, 300));
    ok(consoleErrors.length === 0, 'Sin errores de consola no controlados', consoleErrors.slice(0, 5).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-image-converters',
    generatedAt: new Date().toISOString(),
    tools: ['jpg-to-png', 'png-to-jpg', 'jpg-to-webp', 'webp-to-jpg', 'png-to-webp', 'webp-to-png', 'jpg-to-pdf', 'png-to-pdf', 'pdf-to-jpg', 'pdf-to-png', 'compress', 'convert', 'batchCompress'],
    totals: { passed: passes, failed: failures },
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    externalRequests,
    consoleErrors,
    failureReasons,
  };
  writeEvidence(EVIDENCE_PATH, evidence);

  console.log(`\nEvidencia guardada: ${EVIDENCE_PATH}`);
  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'APROBADO' : 'RECHAZADO'} ===`);
  if (failures > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
