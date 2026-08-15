#!/usr/bin/env node
/**
 * Engine Idle Auto-Release — medición de la liberación de memoria de motores
 * pesados (Tesseract.js) en sesiones largas del Workspace (Tarea CE-040).
 *
 * Verifica el contrato de retención/liberación de EngineLoader:
 *   1. El worker OCR cargado queda registrado y reutilizable.
 *   2. El reaper de inactividad lo termina (libera memoria WASM) cuando supera
 *      la ventana configurada sin uso.
 *   3. releaseTesseract y destroyAll liberan manualmente y son idempotentes.
 *   4. Tras liberar, el worker se puede volver a cargar bajo demanda.
 *
 * Es una medición REAL (Tesseract local) sin mocks ni reintentos: cada
 * afirmación usa tiempos de espera honestos y la ventana de inactividad corta
 * del propio test (no toca timeouts globales).
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { writeEvidence } from '../evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'phase3c-validation');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

let _srv;
function startServer() {
  return new Promise((resolve, reject) => {
    _srv = createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/index.html';
      let fp = join(DIST, file);
      if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(DIST, file + '.html');
      const ext = extname(fp).toLowerCase();
      const data = readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}
function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS: ' + name); }
  else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://localhost:${PORT}/workspace/preview.html?preview=internal`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => typeof window.EngineLoader !== 'undefined', null, { timeout: 20000 }).catch(() => {});

  console.log('=== Engine idle auto-release (CE-040) ===\n');

  check('EngineLoader expone loadTesseract', await page.evaluate(() => typeof window.EngineLoader?.loadTesseract === 'function'));

  const api = await page.evaluate(() => ({
    setIdle: typeof window.EngineLoader?.setTesseractIdleTimeout === 'function',
    releaseIdle: typeof window.EngineLoader?.releaseIdleTesseract === 'function',
    release: typeof window.EngineLoader?.releaseTesseract === 'function',
    status: typeof window.EngineLoader?.getTesseractStatus === 'function',
  }));
  check('EngineLoader expone la API de liberación por inactividad', api.setIdle && api.releaseIdle && api.release && api.status,
    JSON.stringify(api));

  // Estado inicial sin motores cargados.
  const initial = await page.evaluate(() => window.EngineLoader.getTesseractStatus());
  check('Estado inicial: sin workers y sin reaper', initial.langs.length === 0 && initial.reaperActive === false && initial.status === 'idle',
    JSON.stringify(initial));

  // 1. Cargar un worker real (Tesseract local spa) y verificar que queda registrado.
  await page.evaluate(() => window.EngineLoader.setTesseractIdleTimeout(20000));
  const loaded = await page.evaluate(async () => {
    const worker = await window.EngineLoader.loadTesseract('spa', () => {});
    return { ok: !!worker, status: window.EngineLoader.getTesseractStatus() };
  });
  check('El worker OCR real se carga y queda registrado', loaded.ok && loaded.status.langs.includes('spa') && loaded.status.status === 'ready',
    JSON.stringify(loaded.status));

  // 2. Son dos peticiones al mismo worker = reutilización sin duplicar memoria.
  const reuse = await page.evaluate(async () => {
    const a = await window.EngineLoader.loadTesseract('spa', () => {});
    const b = await window.EngineLoader.loadTesseract('spa', () => {});
    return { same: a === b, langs: window.EngineLoader.getTesseractStatus().langs };
  });
  check('El worker en caché se reutiliza (no duplica memoria)', reuse.same === true && reuse.langs.length === 1, JSON.stringify(reuse));

  // 3. Ventana de inactividad corta: el reaper termina el worker solo.
  await page.evaluate(() => window.EngineLoader.setTesseractIdleTimeout(800));
  await page.waitForFunction(() => window.EngineLoader.getTesseractStatus().langs.length === 0, null, { timeout: 15000 });
  const afterIdle = await page.evaluate(() => window.EngineLoader.getTesseractStatus());
  check('El reaper de inactividad libera el worker solo (sin uso)', afterIdle.langs.length === 0 && afterIdle.status === 'idle' && afterIdle.reaperActive === false,
    JSON.stringify(afterIdle));

  // 4. Tras liberar, el worker vuelve a cargar bajo demanda y funciona.
  const reloaded = await page.evaluate(async () => {
    const worker = await window.EngineLoader.loadTesseract('spa', () => {});
    return { ok: !!worker, status: window.EngineLoader.getTesseractStatus() };
  });
  check('El worker se vuelve a cargar bajo demanda tras liberarse', reloaded.ok && reloaded.status.langs.includes('spa'),
    JSON.stringify(reloaded.status));

  // 5. releaseTesseract manual es idempotente.
  await page.evaluate(() => window.EngineLoader.releaseTesseract('spa'));
  await page.evaluate(() => window.EngineLoader.releaseTesseract('spa'));
  const afterManual = await page.evaluate(() => window.EngineLoader.getTesseractStatus());
  check('releaseTesseract libera y es idempotente', afterManual.langs.length === 0 && afterManual.status === 'idle',
    JSON.stringify(afterManual));

  // 6. destroyAll/huella final: sin workers residuales tras liberar todo.
  await page.evaluate(async () => {
    await window.EngineLoader.loadTesseract('spa', () => {});
    window.EngineLoader.setTesseractIdleTimeout(600000);
    window.EngineLoader.destroyAll();
  });
  const afterDestroy = await page.evaluate(() => window.EngineLoader.getTesseractStatus());
  check('destroyAll deja el estado limpio y sin reaper activo', afterDestroy.langs.length === 0 && afterDestroy.reaperActive === false && afterDestroy.status === 'idle',
    JSON.stringify(afterDestroy));

  check('Sin errores de consola no controlados', pageErrors.length === 0, pageErrors.join(' | '));

  const evidence = {
    suite: 'engine-idle-release',
    engine: 'Tesseract.js (vía EngineLoader)',
    assertions: {
      apiDisponible: api.setIdle && api.releaseIdle && api.release && api.status,
      workerCargado: loaded.ok && loaded.status.langs.includes('spa'),
      reutilizacionSinDuplicado: reuse.same === true,
      reaperLiberaSolo: afterIdle.langs.length === 0,
      recargaBajoDemanda: reloaded.ok === true,
      releaseManualIdempotente: afterManual.langs.length === 0,
      destroyLimpio: afterDestroy.langs.length === 0,
      sinErroresConsola: pageErrors.length === 0,
    },
    result: { pass, fail },
  };
  writeEvidence(join(ARTIFACTS, 'TLT-engine-idle-release-evidence.json'), evidence);

  await browser.close();
  await stopServer();

  console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
