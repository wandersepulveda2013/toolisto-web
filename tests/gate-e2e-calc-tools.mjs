#!/usr/bin/env node
/**
 * gate-e2e-calc-tools.mjs — Certificación E2E de las 2 calculadoras (modo `calculadoras`)
 * sobre el deployment real en dist/.
 *
 * Cubre: simpleCalculator (calculadora-simple), scientificCalculator (calculadora-cientifica).
 *
 * UI del modo: #calcExpr (textarea), #calcLive (vista previa en vivo), #calcRun (botón),
 * #calcClear, #calcHistory y descargas vía blob: + a.click().
 *
 * Cada herramienta: (1) vista previa en vivo correcta, (2) cálculo y descarga con
 * Expresión/Resultado, (3) historial, (4) rechazo de expresiones inválidas y vacías,
 * (5) precisión (científica), (6) sin red externa, (7) cero errores de consola.
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
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'calc-dl');
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
  console.log('=== Gate E2E Calculadoras (2 herramientas, modo calculadoras) ===\n');

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
  const waitLive = async (sub) => {
    await page.waitForFunction((needle) => {
      const el = document.getElementById('calcLive');
      return el && el.textContent.indexOf(needle) !== -1;
    }, sub, { timeout: 20000 });
  };
  const toastText = () => page.$eval('#toast', (el) => el.textContent);
  const clickRun = async () => {
    await page.evaluate(() => {
      const b = document.getElementById('calcRun');
      if (b) b.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(150);
    await page.click('#calcRun');
    await page.waitForFunction(() => !document.getElementById('calcRun').disabled, { timeout: 30000 });
  };
  const collectDownloads = async (n) => {
    const t0 = Date.now();
    while (downloads.length < n && Date.now() - t0 < 25000) await page.waitForTimeout(50);
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
    /* ── 1. simpleCalculator (calculadora-simple) ─────────────────────── */
    console.log('\n--- simpleCalculator (calculadora-simple) ---');
    await gotoPage('calculadora-simple');
    await page.fill('#calcExpr', '(120 + 30) * 2 / 5');
    await waitLive('Resultado en vivo');
    let live = await page.$eval('#calcLive', (el) => el.textContent);
    ok(live.includes('60'), 'simpleCalculator vista previa en vivo: (120+30)*2/5 = 60', live.replace(/\s+/g, ' ').trim());

    downloads.length = 0;
    await clickRun();
    let dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'calculadora.txt', `simpleCalculator descarga "${dls[0].suggestedFilename()}"`);
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      ok(t.includes('Expresión: (120 + 30) * 2 / 5'), 'simpleCalculator conserva la expresión en el archivo', t.split('\n')[0]);
      ok(t.includes('Resultado: 60'), 'simpleCalculator escribe el resultado correcto', t.split('\n')[1]);
    } else fail('simpleCalculator sin descarga');
    ok((await toastText()).includes('Resultado calculado.'), 'simpleCalculator toast de confirmación', JSON.stringify(await toastText()));
    let hist = await page.$eval('#calcHistory', (el) => el.textContent);
    ok(hist.includes('(120 + 30) * 2 / 5') && hist.includes('= 60'), 'simpleCalculator registra el cálculo en el historial', hist.replace(/\s+/g, ' ').trim());

    /* ── 2. simpleCalculator decimales ────────────────────────────────── */
    console.log('\n--- simpleCalculator decimales ---');
    await page.fill('#calcExpr', '7 / 8');
    await waitLive('Resultado en vivo');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      ok(t.includes('Resultado: 0.875'), 'simpleCalculator resuelve decimales exactos (7/8 = 0.875)', t.split('\n')[1]);
    } else fail('simpleCalculator (decimales) sin descarga');

    /* ── 3. simpleCalculator rechazos ─────────────────────────────────── */
    console.log('\n--- simpleCalculator rechazos ---');
    await page.fill('#calcExpr', '2 + * 3');
    await waitLive('Expresión no válida');
    downloads.length = 0;
    await clickRun();
    ok(downloads.length === 0, 'simpleCalculator no descarga con expresión inválida');
    ok((await toastText()).includes('Expresión no válida.'), 'simpleCalculator toast de error', JSON.stringify(await toastText()));
    await page.fill('#calcExpr', '   ');
    downloads.length = 0;
    await clickRun();
    ok(downloads.length === 0, 'simpleCalculator no descarga con expresión vacía');
    ok((await toastText()).includes('Ingresa una expresión matemática.'), 'simpleCalculator toast de vacío', JSON.stringify(await toastText()));

    /* ── 4. scientificCalculator (calculadora-cientifica) ─────────────── */
    console.log('\n--- scientificCalculator (calculadora-cientifica) ---');
    await gotoPage('calculadora-cientifica');
    await page.fill('#calcExpr', 'sqrt(144) + 2^4');
    await waitLive('Resultado en vivo');
    live = await page.$eval('#calcLive', (el) => el.textContent);
    ok(live.includes('28'), 'scientificCalculator vista previa en vivo: sqrt(144)+2^4 = 28', live.replace(/\s+/g, ' ').trim());

    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      ok(dls[0].suggestedFilename() === 'calculadora-cientifica.txt', `scientificCalculator descarga "${dls[0].suggestedFilename()}"`);
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      ok(t.includes('Resultado: 28'), 'scientificCalculator calcula sqrt(144)+2^4 = 28', t.split('\n')[1]);
    } else fail('scientificCalculator sin descarga');
    ok((await toastText()).includes('Resultado calculado.'), 'scientificCalculator toast de confirmación', JSON.stringify(await toastText()));
    hist = await page.$eval('#calcHistory', (el) => el.textContent);
    ok(hist.includes('sqrt(144) + 2^4') && hist.includes('= 28'), 'scientificCalculator registra el cálculo en el historial', hist.replace(/\s+/g, ' ').trim());

    /* ── 5. scientificCalculator trigonometría + factorial ────────────── */
    console.log('\n--- scientificCalculator trigonometría + factorial ---');
    await page.fill('#calcExpr', 'sin(30 * pi / 180) + 5!');
    await waitLive('Resultado en vivo');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      const m = t.match(/Resultado: ([0-9.]+)/);
      const v = m ? parseFloat(m[1]) : NaN;
      ok(Math.abs(v - 120.5) < 1e-9, `scientificCalculator resuelve trigonometría + factorial (≈120.5, got ${v})`, t.split('\n')[1]);
    } else fail('scientificCalculator (trig) sin descarga');

    /* ── 6. scientificCalculator funciones inversas y constantes ──────── */
    console.log('\n--- scientificCalculator funciones inversas y constantes ---');
    await page.fill('#calcExpr', 'asin(1) + acos(1) + atan(1) + e');
    await waitLive('Resultado en vivo');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    if (dls[0]) {
      const t = await readText(toBase64(await downloadBuffer(dls[0])));
      const m = t.match(/Resultado: ([0-9.]+)/);
      const v = m ? parseFloat(m[1]) : NaN;
      const expected = (Math.PI * 0.75) + Math.E;
      ok(Math.abs(v - expected) < 1e-9, `scientificCalculator conserva asin/acos/atan y e (≈${expected}, got ${v})`, t.split('\n')[1]);
    } else fail('scientificCalculator (funciones inversas) sin descarga');

    await page.fill('#calcExpr', 'Math.random()');
    await waitLive('Expresión no válida');
    downloads.length = 0;
    await clickRun();
    ok(downloads.length === 0, 'scientificCalculator rechaza miembros Math no permitidos');

    /* ── 7. scientificCalculator limpiar ──────────────────────────────── */
    console.log('\n--- scientificCalculator limpiar ---');
    await page.click('#calcClear');
    const cleared = await page.inputValue('#calcExpr');
    ok(cleared === '', 'scientificCalculator limpia la expresión con el botón Limpiar', JSON.stringify(cleared));

    /* ── 8. Sin red externa ───────────────────────────────────────────── */
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
    await gotoPage('calculadora-simple');
    await page.fill('#calcExpr', '6 * 7');
    await waitLive('Resultado en vivo');
    downloads.length = 0;
    await clickRun();
    dls = await collectDownloads(1);
    const offBuf = dls[0] ? await downloadBuffer(dls[0]) : null;
    ok(offBuf && (await readText(toBase64(offBuf))).includes('Resultado: 42'), 'simpleCalculator funciona con toda la red externa bloqueada');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await page.unroute('**/*');

    /* ── 9. Consola ───────────────────────────────────────────────────── */
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
    suite: 'gate-e2e-calc-tools',
    updatedAt: new Date().toISOString(),
    tools: ['simpleCalculator', 'scientificCalculator'],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-calc-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
