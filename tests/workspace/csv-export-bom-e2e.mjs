#!/usr/bin/env node
/**
 * CE-044 — UTF-8 BOM en las exportaciones CSV del Workspace
 *
 * Regresión que protege: las exportaciones "Exportar CSV" (tabla de Datos y
 * resultado de Query) emiten un CSV con BOM UTF-8 (bytes EF BB BF) para que
 * Excel con locales con acentos (es) abra el archivo sin mojibake.
 *
 * Método (sin mocks, sitio en dist/):
 *  1. Abre `/workspace/index.html?preview=internal` y crea un proyecto.
 *  2. En Datos crea una tabla y escribe celdas con acentos españoles.
 *  3. Pulsa "Exportar CSV" de la tabla y verifica los bytes de la descarga:
 *     (a) empieza por EF BB BF, (b) el primer carácter al decodificar es \uFEFF,
 *     (c) el CSV decodificado contiene los acentos intactos.
 *  4. En Query importa un CSV real con acentos (fixture) y exporta el resultado;
 *     verifica el mismo BOM y los acentos.
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import nodeFs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { writeEvidence } from '../evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'workspace');
const ARTIFACTS = join(ROOT, 'artifacts', 'workspace-csv-bom');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const ORIGIN = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
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
      nodeFs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}

function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

let pass = 0, fail = 0;
const failures = [];
const jsErrors = [];
const consoleErrors = [];
const evidence = {};

function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}
function ko(name, detail = '') { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);
  const t0 = Date.now();
  try {
    console.log('=== CE-044: UTF-8 BOM en CSV exports ===\n');
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => jsErrors.push(err.message));

    // ─── 1. Open Workspace ──────────────────────────────────────
    console.log('--- 1. Abrir workspace ---');
    const resp = await page.goto(`${ORIGIN}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 20000 });
    ok('1.1 Workspace carga', resp.status() === 200);

    // ─── 2. Create project ──────────────────────────────────────
    console.log('\n--- 2. Crear proyecto ---');
    await page.click('#ws-welcome-new');
    await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
    await page.fill('#modal-project-name', 'CSV BOM E2E');
    await page.fill('#modal-project-desc', 'Regresión de BOM UTF-8 en exportaciones CSV');
    const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
    if (createBtn) await createBtn.click();
    await page.waitForTimeout(500);
    const navVisible = await page.evaluate(() => {
      const nav = document.getElementById('ws-project-nav');
      return nav && getComputedStyle(nav).display !== 'none';
    });
    ok('2.1 Proyecto creado', navVisible);

    // ─── 3. Data: create table and write accented cells ─────────
    console.log('\n--- 3. Tabla con acentos ---');
    await page.click('.sidebar-item[data-view="data"]:visible');
    await page.waitForTimeout(300);
    await page.locator('#ws-topbar-actions button').filter({ hasText: 'Nueva Tabla' }).click();
    await page.waitForSelector('.ws-grid-table', { timeout: 10000 });
    const rows = page.locator('.ws-grid-table tbody tr');
    const accented = { r0c1: 'Córdoba', r1c1: 'Murcia', r2c1: 'León', r0c2: 'Éxito', r2c2: 'índice ñame' };
    const cellEdit = async (row, col, value) => {
      await rows.nth(row).locator('td').nth(col).dblclick();
      await page.locator('.ws-grid-table input').fill(value);
      await page.locator('.ws-grid-table input').press('Enter');
      await page.waitForTimeout(120);
    };
    await cellEdit(0, 1, accented.r0c1);
    await cellEdit(1, 1, accented.r1c1);
    await cellEdit(2, 1, accented.r2c1);
    await cellEdit(0, 2, accented.r0c2);
    await cellEdit(2, 2, accented.r2c2);
    const cellText = await rows.nth(0).locator('td').nth(1).textContent();
    ok('3.1 Celdas acentuadas guardadas', (cellText || '').trim() === 'Córdoba', (cellText || '').trim());

    // ─── 4. Export table CSV ────────────────────────────────────
    console.log('\n--- 4. Exportar CSV de la tabla ---');
    const dlPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.locator('#ws-topbar-actions button').filter({ hasText: 'Exportar CSV' }).click();
    const dl = await dlPromise;
    let tableBuf = null;
    if (dl) {
      const path = join(ARTIFACTS, `tabla-${Date.now()}.csv`);
      await dl.saveAs(path);
      tableBuf = readFileSync(path);
    }
    ok('4.1 CSV de tabla descargado', tableBuf !== null, dl ? dl.suggestedFilename() : 'sin descarga');
    if (tableBuf) {
      const hasBom = tableBuf.length >= 3 && tableBuf[0] === 0xEF && tableBuf[1] === 0xBB && tableBuf[2] === 0xBF;
      ok('4.2 Primeros bytes son EF BB BF (UTF-8 BOM)', hasBom, [...tableBuf.slice(0, 3)].join(','));
      const text = tableBuf.toString('utf8');
      ok('4.3 Primer carácter es BOM (\\uFEFF)', text.charCodeAt(0) === 0xFEFF, JSON.stringify(text.slice(0, 4)));
      const accentLine = text.split('\n').find(line => line.includes('Córdoba'));
      ok('4.4 Córdoba intacto en el CSV', !!accentLine, accentLine || 'no encontrado');
      ok('4.5 Éxito intacto en el CSV', text.includes('Éxito'));
      ok('4.6 índice ñame intacto en el CSV', text.includes('índice ñame'));
      ok('4.7 Sin mojibake (Ã©, Ã, ï¿½)', !/[Ã¤]/.test(text) && !text.includes('ï¿½'), '');
      evidence.table = { bytes: tableBuf.length, bom: hasBom, hasCordoba: !!accentLine };
    }

    // ─── 5. Query: import fixture and export ────────────────────
    console.log('\n--- 5. Query import + export ---');
    const fixturePath = join(FIXTURES, 'export-acentos.csv');
    ok('5.0 Fixture accented CSV existe', existsSync(fixturePath));
    await page.click('.sidebar-item[data-view="query"]:visible');
    await page.waitForTimeout(400);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => (b.textContent || '').includes('Importar fuente') || (b.textContent || '').includes('Nueva fuente'));
        if (btn) btn.click();
      }),
    ]);
    ok('5.1 File chooser de Query abierto', !!chooser);
    if (chooser) {
      await chooser.setFiles(fixturePath);
      await page.waitForTimeout(1500);
    }
    const queryTarget = page.locator('.ws-query-preview-table, .ws-query-workbench');
    ok('5.2 Query monta la fuente', (await queryTarget.count()) > 0);

    const qDlPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn = btns.find(b => (b.textContent || '').includes('Exportar CSV'));
      if (btn) btn.click();
    });
    const qDl = await qDlPromise;
    let queryBuf = null;
    if (qDl) {
      const path = join(ARTIFACTS, `query-${Date.now()}.csv`);
      await qDl.saveAs(path);
      queryBuf = readFileSync(path);
    }
    ok('5.3 CSV de Query descargado', queryBuf !== null, qDl ? qDl.suggestedFilename() : 'sin descarga');
    if (queryBuf) {
      const hasBom = queryBuf.length >= 3 && queryBuf[0] === 0xEF && queryBuf[1] === 0xBB && queryBuf[2] === 0xBF;
      ok('5.4 Query CSV empieza con EF BB BF (UTF-8 BOM)', hasBom, [...queryBuf.slice(0, 3)].join(','));
      const text = queryBuf.toString('utf8');
      ok('5.5 Query CSV primer carácter es BOM', text.charCodeAt(0) === 0xFEFF);
      ok('5.6 Query CSV incluye Córdoba', text.includes('Córdoba'), text.split('\n').find(l => l.includes('Córdoba')) || 'no');
      ok('5.7 Query CSV conserva Reunión Ñuño', text.includes('Reunión Ñuño'));
      evidence.query = { bytes: queryBuf.length, bom: hasBom, hasCordoba: text.includes('Córdoba') };
    }

    // ─── 6. Console issues ──────────────────────────────────────
    console.log('\n--- 6. Consola ---');
    ok('6.1 Sin errores de consola', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    ok('6.2 Sin page errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

    await browser.close();
  } finally {
    await stopServer();
  }

  const totalMs = Date.now() - t0;
  console.log(`\n=== Resumen ===`);
  console.log(`${failures.length === 0 ? 'OK' : 'FALLO'}: ${pass} pass, ${fail} fail (${totalMs}ms).`);
  if (failures.length) console.log(`Fallos: ${failures.join(' | ')}`);
  const evidenceFile = join(ARTIFACTS, 'TLT-workspace-csv-bom.json');
  writeEvidence(evidenceFile, {
    suite: 'workspace-csv-bom',
    total: pass + fail,
    pass,
    fail,
    failures,
    consoleErrors: consoleErrors.slice(0, 5),
  });
  process.exit(fail === 0 ? 0 : 1);
}

main();
