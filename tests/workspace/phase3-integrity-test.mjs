#!/usr/bin/env node
/**
 * Phase 3 Integrity E2E — integridad de datos OCR→tabla→derivados.
 *
 * Verifica:
 *  1. convertDocToTable construye matriz de confianza por celda.
 *  2. La tabla con celdas de baja confianza queda en estado draft.
 *  3. La vista tabla muestra badge de estado y celdas resaltadas.
 *  4. Crear un grafico/informe con datos inciertos queda BLOQUEADO.
 *  5. Tras marcar como revisada, el derivado se permite.
 *  6. El linaje muestra el origen captura → escaneo → documento → tabla.
 *
 * Port: E2E_PORT env var or 8082
 * DB: toolisto-workspace v3
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { idbGetAll, idbGetById, waitForCount, idbGetExecutions, DB_NAME, DB_VERSION } from './idb-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'star-flow');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
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
const failures = [];
const jsErrors = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}
function ko(name, detail = '') { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }

async function waitForStatus(page, tableId, expected, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await idbGetById(page, 'data', tableId);
    if (t?.reviewStatus === expected) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForModalTitle(page, needle, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((n) => {
      const titles = [...document.querySelectorAll('.ws-modal-title')];
      return titles.some(t => (t.textContent || '').includes(n));
    }, needle);
    if (found) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function clickButtonContaining(page, selector, text, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked = await page.evaluate(({ sel, txt }) => {
      const btns = [...document.querySelectorAll(sel)];
      const b = btns.find(x => x.textContent.includes(txt));
      if (b) { b.click(); return true; }
      return false;
    }, { sel: selector, txt: text });
    if (clicked) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function clickSidebarView(page, view) {
  return page.evaluate((v) => {
    const items = document.querySelectorAll(`.sidebar-item[data-view="${v}"]`);
    for (const item of items) { if (item.offsetParent !== null) { item.click(); return true; } }
    return false;
  }, view);
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);
  console.log('=== Phase 3 Integrity E2E ===\n');
  const evidence = { timestamp: new Date().toISOString() };
  const t0 = Date.now();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });
  page.on('pageerror', err => jsErrors.push(err.message));

  // ─── Setup: project + scan + OCR + tabla ─────────────────────
  console.log('--- Setup: project, scan, OCR, tabla ---');
  const resp = await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 25000 });
  ok('Workspace loads', resp.status() === 200);

  await page.click('#ws-welcome-new');
  await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
  await page.fill('#modal-project-name', 'Integrity E2E');
  await page.fill('#modal-project-desc', 'Validacion de integridad de datos');
  const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
  if (createBtn) await createBtn.click();
  await page.waitForTimeout(600);

  await clickSidebarView(page, 'intake');
  await page.waitForTimeout(300);
  const scanPath = join(FIXTURES, 'scan-clear.png');
  ok('Fixture exists', existsSync(scanPath));
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type=file]');
      if (inputs.length) { inputs[0].click(); return; }
      const cards = document.querySelectorAll('.ws-bento-card, .ws-card');
      for (const c of cards) { c.click(); return; }
    }),
  ]);
  if (fileChooser) await fileChooser.setFiles(scanPath);
  await page.waitForTimeout(2000);
  const confirmBtn = await page.$('.ws-btn-confirm');
  if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(2000); }

  const capCount = await waitForCount(page, 'captures', 1, 10000);
  ok('Capture saved', capCount >= 1);

  await clickSidebarView(page, 'capture');
  await page.waitForTimeout(500);
  const extractBtns = await page.$$('.ws-card .ws-btn-ghost');
  ok('OCR buttons found', extractBtns.length > 0);
  if (extractBtns.length > 0) {
    await extractBtns[0].click();
    const modalOpened = await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 }).then(() => true, () => false);
    ok('OCR modal opened', modalOpened);
    let ocrMode = 'timeout';
    for (let i = 0; i < 240; i++) {
      await page.waitForTimeout(500);
      process.stdout.write('.');
      if (!(await page.$('.ws-modal-overlay'))) { ocrMode = 'ocr'; break; }
      if (await page.$('.ws-modal textarea')) { ocrMode = 'fallback'; break; }
    }
    console.log('');
    evidence.ocrMode = ocrMode;
    if (ocrMode === 'ocr') {
      ok('OCR completed', true);
    } else if (ocrMode === 'fallback') {
      const expectedText = readFileSync(join(FIXTURES, 'expected-ocr.txt'), 'utf8');
      await page.fill('.ws-modal textarea', expectedText);
      const crearBtn = await page.$('.ws-modal .ws-btn-primary');
      if (crearBtn) await crearBtn.click();
      await page.waitForTimeout(1000);
      ok('Fallback text entry completed', true);
    } else {
      ko('OCR timed out');
    }
  }

  // Convertir a tabla
  await page.waitForTimeout(500);
  const aTablaBtn = await clickButtonContaining(page, 'button', 'A tabla');
  ok('A tabla clicked', aTablaBtn);
  const tblCount = await waitForCount(page, 'data', 1, 10000);
  ok('Table created', tblCount >= 1, `Tables: ${tblCount}`);

  const dataItems = await idbGetAll(page, 'data');
  const tbl = dataItems.find(t => t.type === 'table-document');
  ok('TableDocument found', !!tbl);
  const tableId = tbl?.id;

  // ─── 1. Matriz de confianza por celda ─────────────────────────
  console.log('\n--- 1. Confianza por celda ---');
  const matrix = tbl?.cellConfidence || [];
  const rows = tbl?.rows || [];
  ok('1. cellConfidence matrix present', Array.isArray(matrix) && matrix.length === rows.length,
    `${matrix.length}x${matrix[0]?.length || 0}`);
  ok('1. Matrix width matches row width', matrix.every((r, i) => Array.isArray(r) && r.length === (rows[i] || []).length));
  ok('1. ocrConfidence recorded', Number(tbl?.ocrConfidence) > 0, `${tbl?.ocrConfidence}%`);
  const sourceDocs = await idbGetAll(page, 'documents');
  const textDoc = sourceDocs.find(d => d.type === 'text-document');
  ok('1. ocrWords recorded in source doc', Array.isArray(textDoc?.ocrWords) && textDoc.ocrWords.length > 0, `${textDoc?.ocrWords?.length} words`);

  const flatConf = matrix.flat().filter(v => v !== null && v !== undefined);
  const lowCells = [];
  rows.forEach((row, ri) => (row || []).forEach((_, ci) => {
    const conf = matrix?.[ri]?.[ci];
    if (conf !== null && conf !== undefined && conf < 85) lowCells.push({ row: ri, col: ci, confidence: conf });
  }));
  evidence.lowCells = lowCells;
  evidence.matrix = matrix;
  ok('1. Confidence values numeric', flatConf.every(v => typeof v === 'number'));
  console.log(`  Low-confidence cells (<85): ${lowCells.length}`);
  lowCells.slice(0, 10).forEach(c => console.log(`    row=${c.row} col=${c.col} conf=${c.confidence}`));

  // ─── 2. Estado draft por defecto ──────────────────────────────
  console.log('\n--- 2. Estado de revision ---');
  ok('2. Table starts as draft', tbl?.reviewStatus === 'draft', `status=${tbl?.reviewStatus}`);
  ok('2. Low-confidence cells present', lowCells.length > 0, `${lowCells.length} cells`);
  evidence.initialStatus = tbl?.reviewStatus;

  // ─── 3. Vista tabla: badge + resaltado ────────────────────────
  console.log('\n--- 3. Vista tabla: badge y resaltado ---');
  const badgeSeen = await page.evaluate(() => {
    const el = document.querySelector('.ws-status-chip.ws-review-draft');
    return el ? el.textContent : null;
  });
  ok('3. Badge shows Borrador', badgeSeen !== null && badgeSeen.includes('Borrador'), badgeSeen || 'no badge');
  const lowCount = await page.evaluate(() => document.querySelectorAll('td.ws-cell-low-confidence').length);
  ok('3. Low-confidence cells highlighted', lowCount === lowCells.length, `${lowCount} td.ws-cell-low-confidence`);
  const hasReviewBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.some(b => b.textContent.includes('Revisar'));
  });
  ok('3. Review button present', hasReviewBtn);

  // ─── 4. Bloqueo de grafico con datos inciertos ────────────────
  console.log('\n--- 4. Bloqueo de derivados (grafico) ---');
  await clickSidebarView(page, 'data');
  await page.waitForTimeout(800);
  const chartClicked = await clickButtonContaining(page, '.ws-card-grid button', 'fico');
  ok('4. Chart button clicked (draft)', chartClicked);
  const blockModal = await waitForModalTitle(page, 'Revision de tabla');
  ok('4. Blocking review modal shown', blockModal);
  const chartsAfterBlock = (await idbGetAll(page, 'assets')).filter(a => a.type === 'chart');
  ok('4. No chart created while draft', chartsAfterBlock.length === 0, `${chartsAfterBlock.length} charts`);
  evidence.chartsBeforeReview = chartsAfterBlock.length;

  // ─── 4b. Bloqueo de informe con datos inciertos ───────────────
  console.log('\n--- 4b. Bloqueo de derivados (informe) ---');
  const closed = await page.evaluate(() => {
    const close = document.querySelector('.ws-modal-close');
    if (close) { close.click(); return true; }
    return false;
  });
  ok('4b. Blocking modal closed', closed);
  await page.waitForTimeout(400);
  const cardOpened = await page.evaluate(() => {
    const card = document.querySelector('.ws-card-grid .ws-card');
    if (card) { card.click(); return true; }
    return false;
  });
  ok('4b. Table view opened', cardOpened);
  await page.waitForTimeout(600);
  const reportClicked = await clickButtonContaining(page, 'button', 'Informe');
  ok('4b. Informe button clicked (draft)', reportClicked);
  const reportBlocked = await waitForModalTitle(page, 'Revision de tabla');
  ok('4b. Informe blocked while draft', reportBlocked);
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.ws-review-modal-panel')];
    return panels.some(p => (p.textContent || '').includes('Nombre'));
  }, null, { timeout: 8000 }).then(() => {}, () => {});
  await page.screenshot({ path: join(ARTIFACTS, 'review-modal.png'), fullPage: false });

  // ─── 5. Marcar como revisada → derivado permitido ─────────────
  console.log('\n--- 5. Revision habilita derivados ---');
  const marked = await clickButtonContaining(page, '.ws-modal-footer button', 'Marcar como revisada');
  ok('5. Mark as reviewed clicked', marked);
  const persisted = await waitForStatus(page, tableId, 'reviewed');
  ok('5. Review status persisted', persisted, `status=${(await idbGetById(page, 'data', tableId))?.reviewStatus}`);
  const reviewedTbl = await idbGetById(page, 'data', tableId);
  ok('5. reviewedAt set', typeof reviewedTbl?.reviewedAt === 'number');
  evidence.reviewedStatus = reviewedTbl?.reviewStatus;

  await clickSidebarView(page, 'data');
  await page.waitForTimeout(800);
  const chartClicked2 = await clickButtonContaining(page, '.ws-card-grid button', 'fico');
  ok('5. Chart button clicked (reviewed)', chartClicked2);
  await page.waitForTimeout(1500);
  const chartsAfter = (await idbGetAll(page, 'assets')).filter(a => a.type === 'chart');
  ok('5. Chart created after review', chartsAfter.length === 1, `${chartsAfter.length} charts`);
  ok('5. Chart has series', chartsAfter[0]?.config?.series?.length > 0);
  evidence.chartsAfterReview = chartsAfter.length;

  // ─── 6. Linaje ────────────────────────────────────────────────
  console.log('\n--- 6. Linaje (origen de la tabla) ---');
  const cardOpened2 = await page.evaluate(() => {
    const card = document.querySelector('.ws-card-grid .ws-card');
    if (card) { card.click(); return true; }
    return false;
  });
  ok('6. Table view opened', cardOpened2);
  await page.waitForTimeout(600);
  const lineageShown = await clickButtonContaining(page, 'button', 'Revisar');
  ok('6. Review button clicked (for lineage)', lineageShown);
  const ocrTextShown = await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.ws-review-modal-panel')];
    return panels.some(p => (p.textContent || '').includes('Nombre'));
  }, null, { timeout: 8000 }).then(() => true, () => false);
  ok('6. Review modal loads OCR text panel', ocrTextShown);
  await waitForModalTitle(page, 'Revision de tabla');
  const verOrigen = await clickButtonContaining(page, '.ws-modal-footer button', 'Ver origen');
  ok('6. Ver origen clicked', verOrigen);
  const lineageOpened = await waitForModalTitle(page, 'Linea');
  ok('6. Lineage modal opened', lineageOpened);
  const lineageInfo = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.ws-modal-title')];
    const t = titles.find(x => (x.textContent || '').includes('Linea'));
    if (!t) return null;
    const root = t.closest('.ws-modal');
    return {
      nodeCount: root ? root.querySelectorAll('.ws-lineage-node').length : 0,
      hasDerived: root ? !!root.querySelector('.ws-lineage-node.derived') : false,
      hasArrow: root ? !!root.querySelector('.ws-lineage-arrow') : false,
      text: root ? root.textContent : t.textContent,
    };
  });
  ok('6. Lineage has multiple nodes', (lineageInfo?.nodeCount || 0) >= 3, `${lineageInfo?.nodeCount} nodes`);
  ok('6. Lineage marks derived table', !!lineageInfo?.hasDerived);
  ok('6. Lineage connects nodes with arrows', !!lineageInfo?.hasArrow);

  // ─── 7. Bloqueo de PDF manual con seccion de tabla incierta (Punto 8b) ──
  console.log('\n--- 7. Bloqueo de exportacion PDF con fuente incierta (8b) ---');
  const closedLineage = await page.evaluate(() => {
    const close = document.querySelector('.ws-modal-close');
    if (close) { close.click(); return true; }
    return false;
  });
  ok('7. Lineage modal closed', closedLineage);
  await page.waitForTimeout(400);
  await clickSidebarView(page, 'data');
  await page.waitForTimeout(800);
  const cardForPdf = await page.evaluate(() => {
    const card = document.querySelector('.ws-card-grid .ws-card');
    if (card) { card.click(); return true; }
    return false;
  });
  ok('7. Table view opened', cardForPdf);
  await page.waitForTimeout(600);
  const infoClicked = await clickButtonContaining(page, 'button', 'Informe');
  ok('7. Informe created from reviewed table', infoClicked);
  const inDesign = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) { if (b.textContent.includes('PDF')) return true; }
    return false;
  });
  ok('7. Design editor opened with sections', inDesign);
  await page.waitForTimeout(400);
  const pdfAllowed = await clickButtonContaining(page, 'button', 'PDF');
  ok('7. Export PDF clicked (reviewed source)', pdfAllowed);
  await page.waitForTimeout(2500);
  const blockedWhileReviewed = await waitForModalTitle(page, 'Revision de tabla', 1500);
  ok('7. PDF export NOT blocked when source reviewed', !blockedWhileReviewed);
  await page.waitForTimeout(500);
  let pdfAudit = null;
  for (let i = 0; i < 20; i++) {
    pdfAudit = (await idbGetExecutions(page)).find(e => e.toolId === 'pdf-validation');
    if (pdfAudit) break;
    await page.waitForTimeout(500);
  }
  ok('9. PDF validation audit recorded', !!pdfAudit, pdfAudit ? `status=${pdfAudit.status}` : '');
  ok('9. PDF validation audit passed', pdfAudit?.status === 'completed');
  const downgraded = await page.evaluate(async ({ dbName, dbVersion, id }) => {
    try {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      const tx = db.transaction('data', 'readwrite');
      const table = await new Promise(r => {
        const req = tx.objectStore('data').get(id);
        req.onsuccess = () => r(req.result);
        req.onerror = () => r(null);
      });
      if (!table) { db.close(); return false; }
      table.reviewStatus = 'draft';
      table.reviewedAt = null;
      await new Promise(r => {
        const req = tx.objectStore('data').put(table);
        req.onsuccess = () => r();
        req.onerror = () => r();
      });
      await new Promise(r => { tx.oncomplete = () => r(); tx.onerror = () => r(); });
      db.close();
      return true;
    } catch { return false; }
  }, { dbName: DB_NAME, dbVersion: DB_VERSION, id: tableId });
  ok('7. Source table downgraded to draft in IDB', downgraded);
  const pdfBlocked = await clickButtonContaining(page, 'button', 'PDF');
  ok('7. Export PDF clicked again (draft source)', pdfBlocked);
  const blockedModal = await waitForModalTitle(page, 'Revision de tabla');
  ok('7. PDF export BLOCKED when source uncertain', blockedModal);

  // ─── Resumen ──────────────────────────────────────────────────
  const dur = Date.now() - t0;
  const noJsErrors = jsErrors.length === 0;
  ok('No JS errors', noJsErrors, noJsErrors ? '' : jsErrors.join(' | '));
  evidence.durationMs = dur;
  evidence.jsErrors = jsErrors;

  const out = join(ARTIFACTS, 'phase3-integrity-evidence.json');
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence saved to: ${out}`);
  console.log(`\n=== Phase 3 Integrity E2E: ${pass} passed, ${fail} failed (${Math.round(dur / 1000)}s) ===`);

  await browser.close();
  await stopServer();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
