// gate-e2e-pdf-encrypt.mjs — Certificación E2E de pdfEncryptAdvanced
// sobre el deployment real en dist/. Genera un fixture PDF con PDFLib en el
// navegador, lo cifra con la UI real (motor PDFEncryptor estándar ISO 32000-1
// §7.6), descarga el resultado y lo reabre con pdf.js:
//   - Sin contraseña de usuario -> pdf.js rechaza la apertura (PasswordException).
//   - Con la contraseña correcta -> el texto y los metadatos se recuperan.
//   - Rama de apertura sin contraseña (userPassword vacío) -> pdf.js abre y
//     extrae el texto; /Encrypt sigue presente (permisos de propietario).
//   - El contenido sensible nunca queda en claro dentro del PDF cifrado.
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'pdfenc-dl');
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
    '.json': 'application/json', '.pdf': 'application/pdf', '.xml': 'application/xml',
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

async function waitDialog(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function runTool(page) {
  await page.click('#runButton');
  await waitDialog(page);
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(120);
}

async function downloadResult(page) {
  const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('#downloadButton');
  const dl = await dlPromise;
  if (!dl) return null;
  const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await dl.saveAs(tmp);
  return readFileSync(tmp);
}

// Abre el PDF con pdf.js en el navegador y devuelve el texto por página.
// Si password es null, se abre sin contraseña; si es una string se usa como tal.
// Devuelve { ok, error, pages } — ok=false si el documento no abrió.
async function pdfOpen(page, b64, password) {
  if (!await page.evaluate(() => !!window.pdfjsLib)) {
    await page.addScriptTag({ url: new URL('/vendor/pdfjs/pdf.min.js', page.url()).href });
  }
  return page.evaluate(async ({ b64, password }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const params = { data: u };
    if (password !== null && password !== undefined) params.password = password;
    try {
      const doc = await window.pdfjsLib.getDocument(params).promise;
      const out = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const pg = await doc.getPage(p);
        const tc = await pg.getTextContent();
        out.push({ page: p, text: tc.items.map((it) => it.str).join(' ') });
      }
      return { ok: true, numPages: doc.numPages, pages: out };
    } catch (e) {
      return { ok: false, error: { name: e && e.name, message: e && e.message } };
    }
  }, { b64, password });
}

async function pdfMeta(page, b64) {
  if (!await page.evaluate(() => !!window.PDFLib)) {
    await page.addScriptTag({ url: new URL('/vendor/pdflib/pdf-lib.min.js', page.url()).href });
  }
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const doc = await window.PDFLib.PDFDocument.load(u, { ignoreEncryption: true });
    return { pages: doc.getPageCount() };
  }, { b64 });
}

// Fixture PDF con pdf-lib: 2 páginas con texto sensible + título.
async function genPdf(page) {
  return page.evaluate(async () => {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle('Titulo Confidencial X');
    doc.setAuthor('Toolisto');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([595, 842]);
    p1.drawText('DATOS SECRETO DE PRUEBA 123', { x: 60, y: 700, size: 16, font });
    p1.drawText('Cantidad: 42.5', { x: 60, y: 660, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
    const p2 = doc.addPage([595, 842]);
    p2.drawText('Segunda pagina sin datos sensibles.', { x: 60, y: 700, size: 12, font });
    const bytes = await doc.save();
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
}

async function run() {
  console.log('=== Gate E2E pdfEncryptAdvanced (encriptar-pdf-avanzado) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    /* ── Fixture ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await page.goto(`${url}/encriptar-pdf-avanzado.html`, { waitUntil: 'networkidle' });
    await page.addScriptTag({ url: `${url}/vendor/pdflib/pdf-lib.min.js` });
    await page.addScriptTag({ url: `${url}/vendor/pdfjs/pdf.min.js` });
    const pdfFixture = Buffer.from(await genPdf(page), 'base64');
    ok(pdfFixture.length > 900, 'fixture main.pdf generado (texto SECRETO + título)', pdfFixture.length + ' bytes');
    const fixtureCheck = await pdfOpen(page, toBase64(pdfFixture), null);
    ok(fixtureCheck.ok && fixtureCheck.numPages === 2, 'fixture sin cifrar: pdf.js abre y cuenta 2 páginas (control)', JSON.stringify(fixtureCheck.error));
    if (fixtureCheck.ok) {
      const fxText = fixtureCheck.pages.map((p) => p.text).join(' ');
      ok(fxText.includes('DATOS SECRETO DE PRUEBA 123'), 'fixture sin cifrar: contiene el contenido en claro (control)');
    }

    /* ── Escenario A: contraseña de usuario + permisos ────────────────── */
    console.log('\n--- Escenario A: userPassword "clave123", copiar/modificar NO ---');
    await page.goto(`${url}/encriptar-pdf-avanzado.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const disabledNotice = await page.$('#toolDisabledNotice');
    ok(!disabledNotice || await disabledNotice.getAttribute('hidden') !== null, 'herramienta HABILITADA (sin aviso de revisión)');
    await page.locator('#fileInput').setInputFiles([{ name: 'main.pdf', mimeType: 'application/pdf', buffer: pdfFixture }]);
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 20000 });
    await page.waitForSelector('#pdfUserPassword', { timeout: 8000, state: 'attached' });
    pass('controles visibles (pdfUserPassword, pdfAllowPrint, ...)');
    await page.fill('#pdfUserPassword', 'clave123');
    await page.fill('#pdfOwnerPassword', 'owner456');
    await page.uncheck('#pdfAllowCopy');
    await page.uncheck('#pdfAllowModify');

    await runTool(page);
    const msgA = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/PDF protegido con cifrado estándar/.test(msgA), `mensaje A: "${msgA}"`);
    ok(msgA.includes('Contraseña de apertura establecida'), 'mensaje A menciona contraseña de apertura');
    ok(/Permisos: imprimir=sí, copiar=no, modificar=no/.test(msgA), 'mensaje A refleja permisos', msgA.match(/Permisos: [^.]*/)?.[0]);

    const encA = await downloadResult(page);
    ok(!!encA, 'resultado A descargado');
    if (encA) {
      const sA = encA.toString('latin1');
      ok(sA.startsWith('%PDF-'), 'A: empieza con %PDF');
      ok(/%%EOF\s*$/.test(sA), 'A: termina con %%EOF');
      ok(/\/Filter\s+\/Standard/.test(sA), 'A: /Filter /Standard presente');
      ok(/\/Encrypt\s+\d+\s+\d+\s+R/.test(sA), 'A: /Encrypt en el trailer');
      ok(!sA.includes('DATOS SECRETO DE PRUEBA 123'), 'A: texto sensible NO está en claro');
      ok(!sA.includes('Titulo Confidencial X'), 'A: metadato título NO está en claro');
      ok(!sA.includes('Cantidad: 42.5'), 'A: segundo texto NO está en claro');

      const noPw = await pdfOpen(page, toBase64(encA), null);
      ok(!noPw.ok && noPw.error && noPw.error.name === 'PasswordException', 'A: pdf.js rechaza la apertura sin contraseña', JSON.stringify(noPw.error));

      const withPw = await pdfOpen(page, toBase64(encA), 'clave123');
      ok(withPw.ok && withPw.numPages === 2, 'A: pdf.js abre con la contraseña correcta (2 páginas)', JSON.stringify(withPw.error));
      if (withPw.ok) {
        const allA = withPw.pages.map((p) => p.text).join(' ');
        ok(allA.includes('DATOS SECRETO DE PRUEBA 123'), 'A: texto secreto recuperado con contraseña');
        ok(allA.includes('Cantidad: 42.5'), 'A: segundo texto recuperado con contraseña');
      }

      const metaA = await pdfMeta(page, toBase64(encA));
      ok(metaA.pages === 2, 'A: PDFLib abre con 2 páginas', metaA.pages + ' páginas');

      const wrongPw = await pdfOpen(page, toBase64(encA), 'incorrecta');
      ok(!wrongPw.ok, 'A: pdf.js rechaza contraseña incorrecta', JSON.stringify(wrongPw.error));
    }
    await closeDialog(page);

    /* ── Escenario B: apertura sin contraseña (solo permisos) ─────────── */
    console.log('\n--- Escenario B: userPassword vacío, solo permisos ---');
    await page.fill('#pdfUserPassword', '');
    await page.uncheck('#pdfAllowPrint');
    await runTool(page);
    const msgB = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(/PDF protegido con cifrado estándar/.test(msgB), `mensaje B: "${msgB}"`);
    ok(msgB.includes('apertura sin contraseña'), 'mensaje B: apertura sin contraseña');
    const encB = await downloadResult(page);
    ok(!!encB, 'resultado B descargado');
    if (encB) {
      const sB = encB.toString('latin1');
      ok(/\/Filter\s+\/Standard/.test(sB), 'B: /Filter /Standard presente');
      ok(/\/Encrypt\s+\d+\s+\d+\s+R/.test(sB), 'B: /Encrypt presente');
      ok(!sB.includes('DATOS SECRETO DE PRUEBA 123'), 'B: texto NO está en claro');
      const openB = await pdfOpen(page, toBase64(encB), null);
      ok(openB.ok && openB.numPages === 2, 'B: pdf.js abre sin contraseña', JSON.stringify(openB.error));
      if (openB.ok) {
        const allB = openB.pages.map((p) => p.text).join(' ');
        ok(allB.includes('DATOS SECRETO DE PRUEBA 123'), 'B: texto recuperado (apertura libre)');
      }
    }
    await closeDialog(page);

    /* ── Robustez del motor ───────────────────────────────────────────── */
    console.log('\n--- Robustez ---');
    const throws = await page.evaluate(async ({ b64 }) => {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const out = { already: '', invalid: '', engine: typeof window.PDFEncryptor === 'object' && !!window.PDFEncryptor.encrypt };
      try { await window.PDFEncryptor.encrypt(u, { userPassword: 'x' }); } catch (e) { out.already = e.message; }
      try { await window.PDFEncryptor.encrypt(new TextEncoder().encode('NO PDF'), {}); } catch (e) { out.invalid = e.message; }
      return out;
    }, { b64: toBase64(encA) });
    ok(throws.engine, 'motor PDFEncryptor expuesto en window');
    ok(/ya está protegido/.test(throws.already), 're-cifrar PDF cifrado lanza error claro', throws.already);
    ok(/no es un PDF válido/.test(throws.invalid), 'PDF inválido lanza error claro', throws.invalid);

    /* ── Consola ──────────────────────────────────────────────────────── */
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
    suite: 'gate-e2e-pdf-encrypt',
    tool: 'pdfEncryptAdvanced',
    updatedAt: new Date().toISOString(),
    cipher: 'AES-128 (V=4/R=4, AESV2) — motor propio js/security/pdf-encryptor.js (ISO 32000-1 §7.6)',
    scenarios: [
      'A: userPassword "clave123" + permisos (copiar/modificar no) — pdf.js rechaza sin contraseña; abre y recupera el texto con la correcta; contenido no visible en claro',
      'B: userPassword vacío — apertura libre; texto recuperable; /Encrypt presente (permisos de propietario)',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-pdf-encrypt-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
