#!/usr/bin/env node
/**
 * gate-e2e-file-tools.mjs — Certificación E2E de las 3 herramientas de archivos
 * (modo `file`) sobre el deployment real en dist/.
 *
 * Cubre: fileSplit (dividir-archivo), fileJoin (unir-archivos-divididos), zipRepair (reparar-zip).
 *
 * UI del modo: #modeFileInput (input), #modeRun (botón), #structurePreview (manifiesto/verificación),
 * #toast (mensajes) y descargas vía blob: + a.click().
 *
 * Cada herramienta: (1) abre con botón deshabilitado hasta elegir archivo, (2) acepta el tipo correcto,
 * (3) muestra manifiesto/checksum coherente con los bytes reales, (4) procesa y descarga,
 * (5) reconstrucción exacta verificada por SHA-256, (6) rechaza con error informativo sin romper la página,
 * (7) MIME/firma de los fixtures, (8) mensaje prometido, (9) sin red externa, (10) cero errores de consola.
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'file-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0;
let passes = 0;
const checks = [];
const failureReasons = [];
const consoleErrors = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }
function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex'); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function run() {
  console.log('=== Gate E2E File Tools (3 herramientas, modo archivos) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const downloads = [];
  page.on('download', (d) => { downloads.push(d); });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const gotoPage = async (slug) => {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  const uploadFiles = async (files) => {
    await page.locator('#modeFileInput').setInputFiles(files);
    await page.waitForFunction(() => !document.getElementById('modeRun').disabled, { timeout: 15000 });
  };
  const waitPreview = async (sub) => {
    await page.waitForFunction((needle) => {
      const el = document.getElementById('structurePreview');
      return el && el.textContent.indexOf(needle) !== -1;
    }, sub, { timeout: 20000 });
  };
  const toastText = () => page.$eval('#toast', (el) => el.textContent);
  const runBtnDisabled = () => page.$eval('#modeRun', (el) => el.disabled);
  const collectDownloads = async (n) => {
    const t0 = Date.now();
    while (downloads.length < n && Date.now() - t0 < 20000) await page.waitForTimeout(50);
    return downloads.slice(0, n);
  };
  const downloadBuffer = async (dl) => {
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await dl.saveAs(tmp);
    return readFileSync(tmp);
  };
  const readText = async (b64) => page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    const payload = Buffer.alloc(153600);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const payloadHash = sha256Hex(payload);
    const part1 = payload.subarray(0, 65536);
    const part2 = payload.subarray(65536, 131072);
    const part3 = payload.subarray(131072);
    ok(part1.length === 65536 && part2.length === 65536 && part3.length === 22528, 'fixture de 153600 bytes dividido en 3 partes deterministas', `${part1.length}/${part2.length}/${part3.length}`);
    ok(payloadHash.length === 64, 'sha256 del fixture calculado', payloadHash.slice(0, 12) + '…');
    const MIXTO = { name: 'mixto.txt', mimeType: 'text/plain', buffer: payload };
    const PARTS = [
      { name: 'mixto.part001', mimeType: 'application/octet-stream', buffer: part1 },
      { name: 'mixto.part002', mimeType: 'application/octet-stream', buffer: part2 },
      { name: 'mixto.part003', mimeType: 'application/octet-stream', buffer: part3 },
    ];

    /* ── 1. fileSplit (dividir-archivo) ───────────────────────────────── */
    console.log('\n--- fileSplit (dividir-archivo) ---');
    await gotoPage('dividir-archivo');
    ok(await runBtnDisabled(), 'fileSplit inicia con el botón deshabilitado');
    await uploadFiles([MIXTO]);
    await waitPreview('Manifiesto de división');
    let preview = await page.$eval('#structurePreview', (el) => el.textContent);
    ok(preview.includes('3 fragmentos') && preview.includes('SHA-256 original'), 'fileSplit muestra el manifiesto con 3 fragmentos y checksum');
    ok(preview.includes(payloadHash), 'fileSplit manifiesto SHA-256 coincide con los bytes reales');
    ok(!(await runBtnDisabled()), 'fileSplit habilita el botón tras elegir archivo');
    downloads.length = 0;
    await page.click('#modeRun');
    await waitPreview('Reconstrucción exacta verificada');
    const splitDl = await collectDownloads(3);
    ok(splitDl.length === 3, 'fileSplit descarga 3 fragmentos', splitDl.length + ' descargas');
    const splitNames = splitDl.map((d) => d.suggestedFilename()).sort();
    ok(splitNames.join(',') === 'mixto.part001,mixto.part002,mixto.part003', 'fileSplit nombra los fragmentos partNNN (sin extensión falsa)', splitNames.join(','));
    const sizes = [];
    const parts = [];
    for (const d of splitDl) {
      const b = await downloadBuffer(d);
      sizes.push(b.length);
      parts.push(b);
    }
    ok(sizes.join(',') === '65536,65536,22528', 'fileSplit respeta el tamaño de fragmento (64 KB)', sizes.join(','));
    const merged = Buffer.concat(parts);
    ok(merged.equals(payload), 'fileSplit: concatenación de fragmentos == original');
    ok((await toastText()).includes('Archivo dividido en 3 fragmentos de ~64 KB.'), 'fileSplit message prometido en el toast', await toastText());

    /* fileSplit — rechazo: demasiados fragmentos */
    console.log('--- fileSplit negativo (demasiados fragmentos) ---');
    await gotoPage('dividir-archivo');
    await uploadFiles([MIXTO]);
    await page.fill('#fsChunk', '1');
    downloads.length = 0;
    await page.click('#modeRun');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('Demasiados fragmentos') !== -1, { timeout: 15000 });
    const splitToast = await toastText();
    ok(splitToast.includes('Demasiados fragmentos (150). Aumenta el tamaño del fragmento.'), `fileSplit rechaza >50 fragmentos con toast: "${splitToast}"`);
    ok(!(await runBtnDisabled()), 'fileSplit rehabilita el botón tras el rechazo');
    await page.waitForTimeout(400);
    ok(downloads.length === 0, 'fileSplit no descarga nada en el rechazo');

    /* ── 2. fileJoin (unir-archivos-divididos) ─────────────────────────── */
    console.log('\n--- fileJoin (unir-archivos-divididos) ---');
    await gotoPage('unir-archivos-divididos');
    ok(await runBtnDisabled(), 'fileJoin inicia con el botón deshabilitado');
    await uploadFiles(PARTS);
    await waitPreview('Manifiesto de unión');
    preview = await page.$eval('#structurePreview', (el) => el.textContent);
    ok(preview.includes('SHA-256 del resultado') && preview.includes(payloadHash), 'fileJoin manifiesto SHA-256 del resultado coincide con el original');
    downloads.length = 0;
    await page.click('#modeRun');
    await waitPreview('Archivo reconstruido:');
    const joinDl = await collectDownloads(1);
    ok(joinDl.length === 1, 'fileJoin descarga 1 archivo', joinDl.length + ' descargas');
    const joinName = joinDl[0].suggestedFilename();
    ok(joinName === 'mixto' || joinName === 'mixto.txt', `fileJoin recompone nombre razonable ("${joinName}")`, joinName);
    const joinedBuf = await downloadBuffer(joinDl[0]);
    ok(Buffer.from(joinedBuf).equals(payload), 'fileJoin reconstruye los bytes exactos del original');
    ok((await toastText()).includes('3 fragmentos unidos en un solo archivo (150.0 KB).'), 'fileJoin message prometido en el toast', await toastText());

    /* ── 3. zipRepair (reparar-zip) ────────────────────────────────────── */
    console.log('\n--- zipRepair (reparar-zip) ---');
    await gotoPage('reparar-zip');
    await page.addScriptTag({ url: `${url}/vendor/jszip/jszip.min.js` });
    ok(await runBtnDisabled(), 'zipRepair inicia con el botón deshabilitado');
    const zips = await page.evaluate(async () => {
      const zip = new JSZip();
      zip.file('hola.txt', 'Hola Toolisto');
      const payload = new Uint8Array(100);
      for (let i = 0; i < 100; i++) payload[i] = i;
      zip.file('datos.bin', payload);
      const buf = await zip.generateAsync({ type: 'array', compression: 'STORE' });
      const arr = new Uint8Array(buf);
      return {
        valid: Array.from(arr),
        truncated: Array.from(arr.slice(0, arr.length - 25)),
        pk: Array.from(arr.slice(0, 4)),
      };
    });
    ok(zips.pk.join(',') === '80,75,3,4', 'fixture ZIP con firma PK\\x03\\x04', zips.pk.join(','));
    ok(zips.valid.length > zips.truncated.length, 'fixture truncado es menor que el válido', `${zips.truncated.length}/${zips.valid.length} bytes`);
    const ZIP_FILE = { name: 'ok.zip', mimeType: 'application/zip', buffer: Buffer.from(zips.valid) };
    const ZIP_TRUNC = { name: 'truncado.zip', mimeType: 'application/zip', buffer: Buffer.from(zips.truncated) };

    await uploadFiles([ZIP_FILE]);
    await waitPreview('2 entradas analizadas');
    preview = await page.$eval('#structurePreview', (el) => el.textContent);
    ok(preview.includes('hola.txt') && preview.includes('datos.bin'), 'zipRepair lista las entradas del ZIP en el manifiesto');
    downloads.length = 0;
    await page.click('#modeRun');
    await waitPreview('2 archivo(s) recuperado(s)');
    const zipDl = await collectDownloads(2);
    ok(zipDl.length === 2, 'zipRepair recupera los 2 archivos legibles', zipDl.length + ' descargas');
    const zipNames = zipDl.map((d) => d.suggestedFilename()).sort();
    ok(zipNames.join(',') === 'datos.bin,hola.txt', 'zipRepair conserva los nombres de entrada', zipNames.join(','));
    const zipContents = {};
    for (const d of zipDl) {
      const b = await downloadBuffer(d);
      zipContents[d.suggestedFilename()] = d.suggestedFilename().endsWith('.txt') ? await readText(toBase64(b)) : b;
    }
    ok(zipContents['hola.txt'] === 'Hola Toolisto', 'zipRepair recupera el contenido de hola.txt');
    ok(Buffer.from(zipContents['datos.bin']).length === 100 && Buffer.from(zipContents['datos.bin'])[5] === 5 && Buffer.from(zipContents['datos.bin'])[99] === 99, 'zipRepair recupera datos.bin íntegro (100 bytes)');
    ok((await toastText()).includes('2 archivos recuperados del ZIP dañado.'), 'zipRepair message prometido en el toast', await toastText());

    /* zipRepair — rechazo: ZIP ilegible */
    console.log('--- zipRepair negativo (ZIP ilegible) ---');
    await gotoPage('reparar-zip');
    await uploadFiles([ZIP_TRUNC]);
    await waitPreview('ZIP corrupto');
    downloads.length = 0;
    await page.click('#modeRun');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('No se pudo recuperar') !== -1, { timeout: 15000 });
    const zipToast = await toastText();
    ok(zipToast.includes('No se pudo recuperar ningún archivo del ZIP dañado.'), `zipRepair rechaza ZIP ilegible con toast: "${zipToast}"`);
    ok(!(await runBtnDisabled()), 'zipRepair rehabilita el botón tras el rechazo');
    await page.waitForTimeout(400);
    ok(downloads.length === 0, 'zipRepair no descarga nada con ZIP ilegible');

    /* ── 4. Sin red externa ────────────────────────────────────────────── */
    console.log('\n--- Sin red externa ---');
    const externalRequests = [];
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(url)) await route.continue();
      else {
        externalRequests.push(reqUrl);
        await route.abort();
      }
    });
    await gotoPage('dividir-archivo');
    await uploadFiles([MIXTO]);
    await page.click('#modeRun');
    await waitPreview('Reconstrucción exacta verificada');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await page.unroute('**/*');

    /* ── 5. Consola ────────────────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola en toda la suite');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-file-tools',
    updatedAt: new Date().toISOString(),
    tools: ['fileSplit', 'fileJoin', 'zipRepair'],
    bugsFixed: [
      'fileJoin devolvía el nombre "mixto.part001.txt" en vez de "mixto.txt" (regex de extensión capturaba todo "partNNN.ext"); corregido en tool-processors.js.',
      'runProc del modo file lanzaba "Cannot read properties of undefined (reading \'then\')" al usar onResult sin promesa (zipRepair); corregido con Promise.resolve(handled).',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-file-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
