#!/usr/bin/env node
/**
 * CE-051 — OCR E2E Reliability Diagnostic v2
 *
 * Key discovery from v1: OCR completes in ~4s but the modal never disappears
 * because extractTextFromScan() closes the OCR modal then immediately opens
 * a NEW "extraction mode chooser" modal. The test polls .ws-modal-overlay
 * which is never absent.
 *
 * This v2 tracks both modals and DOM transitions to confirm.
 *
 * Usage: node tests/workspace/ocr-reliability-diagnostic.mjs [iterations]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import nodeFs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'star-flow');
const ARTIFACTS = join(ROOT, 'artifacts', 'ocr-diagnostic');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8081);
const ITERATIONS = Number(process.argv[2]) || 10;

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

const scanPng = readFileSync(join(FIXTURES, 'scan-clear.png'));
const scanDataUrl = 'data:image/png;base64,' + scanPng.toString('base64');
const scanSize = scanPng.length;

/* ── Instrumentation: patch EngineLoader + track DOM modal transitions ── */

const INSTRUMENT_SCRIPT = `
(function() {
  window.__ocrDiag = { events: [], currentRun: -1 };

  function ev(phase, extra) {
    window.__ocrDiag.events.push({ t: Date.now(), phase, run: window.__ocrDiag.currentRun, ...(extra || {}) });
  }

  // Patch EngineLoader.loadTesseract
  if (window.EngineLoader && window.EngineLoader.loadTesseract) {
    const _orig = window.EngineLoader.loadTesseract.bind(window.EngineLoader);
    window.EngineLoader.loadTesseract = function(lang, onProgress) {
      ev('engine_load_start', { lang });
      const wp = function(pct, msg) {
        ev('engine_progress', { pct, msg });
        if (onProgress) onProgress(pct, msg);
      };
      return _orig(lang, wp).then(function(worker) {
        ev('engine_load_end', { lang });
        // Patch worker.recognize
        if (worker && !worker.__diagPatched) {
          worker.__diagPatched = true;
          const _origRec = worker.recognize.bind(worker);
          worker.recognize = function(canvas, opts) {
            ev('recognize_start', { canvasW: canvas?.width, canvasH: canvas?.height });
            return _origRec(canvas, opts).then(function(result) {
              const data = (result && result.data) || {};
              ev('recognize_end', {
                chars: (data.text || '').length,
                words: Array.isArray(data.words) ? data.words.length : 0,
                confidence: Math.round(Number(data.confidence) || 0),
              });
              return result;
            }).catch(function(err) {
              ev('recognize_error', { error: String(err) });
              throw err;
            });
          };
        }
        return worker;
      }).catch(function(err) {
        ev('engine_load_error', { error: String(err) });
        throw err;
      });
    };
  }

  // Track modal lifecycle
  const observer = new MutationObserver(function(mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('ws-modal-overlay') || node.querySelector?.('.ws-modal-overlay')) {
          const title = node.querySelector?.('.ws-modal-title')?.textContent || '';
          ev('modal_opened', { title: title.slice(0, 80) });
        }
      }
      for (const node of m.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('ws-modal-overlay') || node.querySelector?.('.ws-modal-overlay')) {
          ev('modal_closed');
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ev('instrumentation_ready');
})();
`;

function makeSeedScript(dataUrl) {
  return `
  (async () => {
    const __db = await import('/workspace/core/db.js');
    const __S = __db.STORES;
    for (const s of Object.values(__S)) { try { await __db.dbClear(s); } catch (e) {} }
    const __now = Date.now();
    const __base = (id, type, extra = {}) => ({
      id, type, createdAt: __now, updatedAt: __now, projectId: 'p-diag', _version: 1,
      metadata: {}, history: [], relations: [], processingState: 'idle', errors: [],
      sourceAssetId: null, derivedIds: [], ...extra,
    });
    await __db.dbPut(__S.projects, __base('p-diag', 'project', { projectId: null, name: 'Diagnostico OCR' }));
    const __asset = __base('asset-diag-1', 'image-asset', {
      name: 'Escaneo claro', type: 'image-asset',
      dataUrl: ${JSON.stringify(dataUrl)},
      originalDataUrl: ${JSON.stringify(dataUrl)},
    });
    await __db.dbPut(__S.assets, __asset);
    const __cap = __base('cap-diag-1', 'capture', {
      name: 'Escaneo claro', timestamp: __now,
      correctedAssetId: 'asset-diag-1',
      metadata: { captureId: 'cap-diag-1' },
    });
    __cap.relations = [{ id: 'r1', sourceId: 'cap-diag-1', targetId: 'asset-diag-1', type: 'asset' }];
    await __db.dbPut(__S.captures, __cap);
    return true;
  })()`;
}

/* ── Modal OCR scenario ────────────────────────────────────────── */

async function runModalOcr(page, runIndex) {
  const result = {
    run: runIndex, scenario: 'modal',
    phases: {}, ocrMode: 'timeout', totalMs: 0,
    chars: 0, words: 0, confidence: 0, ocrText: '',
    modalTimeline: [], errors: [],
  };
  const t0 = Date.now();

  await page.evaluate((idx) => {
    window.__ocrDiag.events = [];
    window.__ocrDiag.currentRun = idx;
  }, runIndex);

  try {
    await page.click('.sidebar-item[data-view="capture"]');
    await page.waitForTimeout(500);

    const extractBtns = await page.$$('.ws-card .ws-btn-ghost');
    if (!extractBtns.length) { result.errors.push('no extract buttons'); result.totalMs = Date.now() - t0; return result; }

    await extractBtns[0].click();
    await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });

    // Poll — track EVERY modal transition
    const pollStart = Date.now();
    const MAX_POLL = 60000;
    let iterations = 0;
    let lastModalTitle = '';

    while (Date.now() - pollStart < MAX_POLL) {
      await page.waitForTimeout(250);
      iterations++;

      const modalState = await page.evaluate(() => {
        const overlay = document.querySelector('.ws-modal-overlay');
        if (!overlay) return { present: false, title: '', body: '' };
        const title = overlay.querySelector('.ws-modal-title')?.textContent || '';
        const body = overlay.querySelector('.ws-modal-body')?.innerText?.slice(0, 120) || '';
        return { present: true, title, body };
      });

      if (!modalState.present) {
        result.ocrMode = 'ocr_modal_gone';
        break;
      }

      // Detect transition from OCR loading to extraction mode chooser
      if (modalState.title && modalState.title !== lastModalTitle) {
        result.modalTimeline.push({ t: Date.now() - t0, title: modalState.title, body: modalState.body });
        lastModalTitle = modalState.title;

        if (modalState.title.includes('Modo de extracción') || modalState.title.includes('extraccion')) {
          result.ocrMode = 'ocr_chooser_visible';
          break;
        }
        if (modalState.title.includes('Generando documento')) {
          result.ocrMode = 'ocr_generating';
          break;
        }
      }

      // Detect textarea fallback
      if (modalState.body.includes('ingreso manual') || modalState.body.includes('Ingreso manual')) {
        result.ocrMode = 'fallback';
        break;
      }
    }

    result.pollIterations = iterations;
    result.pollMs = Date.now() - pollStart;

    // Collect all instrumentation events
    const events = await page.evaluate(() => window.__ocrDiag.events || []);

    const findE = (phase) => events.find(e => e.phase === phase);
    const findLastE = (phase) => { const m = events.filter(e => e.phase === phase); return m[m.length - 1]; };

    const loadS = findE('engine_load_start');
    const loadE = findE('engine_load_end');
    const recS = findE('recognize_start');
    const recE = findLastE('recognize_end');

    if (loadS) result.phases.loadStart_ms = loadS.t - t0;
    if (loadE) result.phases.loadEnd_ms = loadE.t - t0;
    if (recS) result.phases.recStart_ms = recS.t - t0;
    if (recE) result.phases.recEnd_ms = recE.t - t0;

    if (loadS && loadE) result.phases.workerInit_ms = loadE.t - loadS.t;
    if (recS && recE) result.phases.recognize_ms = recE.t - recS.t;
    if (loadE && recS) result.phases.loadToRecognize_ms = recS.t - loadE.t;

    if (recE) {
      result.chars = recE.chars || 0;
      result.words = recE.words || 0;
      result.confidence = recE.confidence || 0;
    }

    // Count engine_progress events (Tesseract logger callbacks)
    const progressEvents = events.filter(e => e.phase === 'engine_progress');
    result.progressCallbackCount = progressEvents.length;
    result.lastProgressMsg = progressEvents.length > 0 ? progressEvents[progressEvents.length - 1].msg : '';

  } catch (err) {
    result.errors.push(err.message.split('\n')[0]);
  }

  result.totalMs = Date.now() - t0;
  return result;
}

/* ── Workflow OCR scenario ─────────────────────────────────────── */

async function runWorkflowOcr(page, runIndex) {
  const result = {
    run: runIndex, scenario: 'workflow',
    phases: {}, ocrMode: 'timeout', totalMs: 0,
    chars: 0, words: 0, confidence: 0,
    errors: [],
  };
  const t0 = Date.now();

  await page.evaluate((idx) => {
    window.__ocrDiag.events = [];
    window.__ocrDiag.currentRun = idx;
  }, runIndex);

  try {
    await page.click('.sidebar-item[data-view="capture"]');
    await page.waitForTimeout(500);

    const chainBtn = page.getByRole('button', { name: /Encadenar/ });
    await chainBtn.first().waitFor({ state: 'visible', timeout: 15000 });
    await chainBtn.first().click();

    await page.waitForSelector('#wf-file-input', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Anadir operacion/ }).click();
    await page.locator('#wf-op-results').getByText('Extraer texto (OCR)', { exact: true }).click();
    await page.getByRole('button', { name: /Ejecutar flujo/ }).click();
    await page.waitForSelector('#wf-results-section', { state: 'visible', timeout: 130000 });

    result.ocrMode = 'ocr';

    const events = await page.evaluate(() => window.__ocrDiag.events || []);

    const findE = (phase) => events.find(e => e.phase === phase);
    const findLastE = (phase) => { const m = events.filter(e => e.phase === phase); return m[m.length - 1]; };

    const loadS = findE('engine_load_start');
    const loadE = findE('engine_load_end');
    const recS = findE('recognize_start');
    const recE = findLastE('recognize_end');

    if (loadS) result.phases.loadStart_ms = loadS.t - t0;
    if (loadE) result.phases.loadEnd_ms = loadE.t - t0;
    if (recS) result.phases.recStart_ms = recS.t - t0;
    if (recE) result.phases.recEnd_ms = recE.t - t0;

    if (loadS && loadE) result.phases.workerInit_ms = loadE.t - loadS.t;
    if (recS && recE) result.phases.recognize_ms = recE.t - recS.t;
    if (loadE && recS) result.phases.loadToRecognize_ms = recS.t - loadE.t;

    if (recE) {
      result.chars = recE.chars || 0;
      result.words = recE.words || 0;
      result.confidence = recE.confidence || 0;
    }

    const progressEvents = events.filter(e => e.phase === 'engine_progress');
    result.progressCallbackCount = progressEvents.length;

  } catch (err) {
    result.errors.push(err.message.split('\n')[0]);
  }

  result.totalMs = Date.now() - t0;
  return result;
}

/* ── Main ──────────────────────────────────────────────────────── */

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log(`\n=== CE-051 OCR Reliability Diagnostic v2 ===`);
  console.log(`Iterations: ${ITERATIONS} | Fixture: scan-clear.png (${scanSize} bytes)\n`);

  const allResults = { modal: [], workflow: [] };

  try {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    /* ── Scenario A: Modal OCR ─────────────────────────────────── */
    console.log('═══ SCENARIO A: Modal OCR (phase3c-star-flow path) ═══\n');

    for (let i = 0; i < ITERATIONS; i++) {
      console.log(`--- Run ${i + 1}/${ITERATIONS} (modal) ---`);
      const page = await ctx.newPage();

      try {
        // Fresh workspace — use unique project name to avoid IndexedDB state
        await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, {
          waitUntil: 'networkidle', timeout: 30000,
        });
        await page.waitForTimeout(500);

        // Inject instrumentation on EVERY page load (no guard)
        await page.evaluate(INSTRUMENT_SCRIPT);

        // Create project via welcome screen
        await page.click('#ws-welcome-new');
        await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
        await page.fill('#modal-project-name', `Diag-${Date.now()}`);
        await page.fill('#modal-project-desc', `Run ${i}`);
        const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
        if (createBtn) await createBtn.click();
        await page.waitForTimeout(800);

        // Navigate to intake
        await page.click('.sidebar-item[data-view="intake"]');
        await page.waitForTimeout(300);

        // Upload fixture
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }),
          page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type=file]');
            if (inputs.length) { inputs[0].click(); return; }
            const cards = document.querySelectorAll('.ws-bento-card, .ws-card');
            for (const c of cards) { c.click(); return; }
          }),
        ]);
        await fileChooser.setFiles(join(FIXTURES, 'scan-clear.png'));
        await page.waitForTimeout(2000);

        // Confirm scan
        const confirmBtn = await page.waitForSelector('.ws-btn-confirm', { timeout: 5000 }).catch(() => null);
        if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(2000); }

        await page.waitForTimeout(500);

        // Run modal OCR
        const result = await runModalOcr(page, i);
        allResults.modal.push(result);

        const p = result.phases;
        console.log(`  mode: ${result.ocrMode} | total: ${result.totalMs}ms`);
        console.log(`  workerInit: ${p.workerInit_ms || '?'}ms | recognize: ${p.recognize_ms || '?'}ms | load→rec: ${p.loadToRecognize_ms || '?'}ms`);
        console.log(`  chars: ${result.chars} | words: ${result.words} | conf: ${result.confidence}`);
        console.log(`  progressCallbacks: ${result.progressCallbackCount} | lastMsg: "${result.lastProgressMsg}"`);
        if (result.modalTimeline.length) {
          console.log(`  modalTimeline:`);
          for (const m of result.modalTimeline) console.log(`    +${m.t}ms "${m.title}" — ${m.body}`);
        }
        if (result.errors.length) console.log(`  errors: ${result.errors.join('; ')}`);
        console.log('');

      } catch (err) {
        console.log(`  EXCEPTION: ${err.message.split('\n')[0]}\n`);
        allResults.modal.push({ run: i, scenario: 'modal', ocrMode: 'exception', totalMs: 0, errors: [err.message.split('\n')[0]], phases: {} });
      } finally {
        await page.close();
      }
    }

    /* ── Scenario B: Workflow OCR ──────────────────────────────── */
    console.log('═══ SCENARIO B: Workflow OCR (capture-flow-chain path) ═══\n');

    for (let i = 0; i < ITERATIONS; i++) {
      console.log(`--- Run ${i + 1}/${ITERATIONS} (workflow) ---`);
      const page = await ctx.newPage();

      try {
        await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, {
          waitUntil: 'networkidle', timeout: 30000,
        });
        await page.waitForTimeout(500);

        // Inject instrumentation
        await page.evaluate(INSTRUMENT_SCRIPT);

        // Seed project + capture
        await page.evaluate(makeSeedScript(scanDataUrl));
        await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(500);

        // Re-inject after reload
        await page.evaluate(INSTRUMENT_SCRIPT);

        // Open the project
        const projectOpened = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.ws-card')];
          const target = cards.find(c => c.textContent.includes('Diagnostico OCR'));
          if (target) { target.click(); return true; }
          return false;
        });
        if (!projectOpened) { console.log('  SKIP: project not found\n'); continue; }
        await page.waitForTimeout(500);

        const result = await runWorkflowOcr(page, i);
        allResults.workflow.push(result);

        const p = result.phases;
        console.log(`  mode: ${result.ocrMode} | total: ${result.totalMs}ms`);
        console.log(`  workerInit: ${p.workerInit_ms || '?'}ms | recognize: ${p.recognize_ms || '?'}ms | load→rec: ${p.loadToRecognize_ms || '?'}ms`);
        console.log(`  chars: ${result.chars} | words: ${result.words} | conf: ${result.confidence}`);
        console.log(`  progressCallbacks: ${result.progressCallbackCount}`);
        if (result.errors.length) console.log(`  errors: ${result.errors.join('; ')}`);
        console.log('');

      } catch (err) {
        console.log(`  EXCEPTION: ${err.message.split('\n')[0]}\n`);
        allResults.workflow.push({ run: i, scenario: 'workflow', ocrMode: 'exception', totalMs: 0, errors: [err.message.split('\n')[0]], phases: {} });
      } finally {
        await page.close();
      }
    }

    await browser.close();
  } finally {
    await stopServer();
  }

  /* ── Summary ─────────────────────────────────────────────────── */

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SCENARIO A: Modal OCR — Results');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('Run │ Mode                     │ workerInit │ recognize  │ total    │ chars │ conf');
  console.log('─'.repeat(95));
  for (const r of allResults.modal) {
    const p = r.phases;
    console.log(
      `${String(r.run).padStart(3)} │ ${(r.ocrMode || 'err').padEnd(24)} │ ${String(p.workerInit_ms ?? '-').padStart(10)} │ ${String(p.recognize_ms ?? '-').padStart(10)} │ ${String(r.totalMs).padStart(8)} │ ${String(r.chars ?? '-').padStart(5)} │ ${String(r.confidence ?? '-').padStart(4)}`
    );
  }
  console.log('─'.repeat(95));

  const modalOcr = allResults.modal.filter(r => r.ocrMode?.startsWith('ocr'));
  const modalTimeout = allResults.modal.filter(r => r.ocrMode === 'timeout');
  const modalChooser = allResults.modal.filter(r => r.ocrMode === 'ocr_chooser_visible');
  const modalGone = allResults.modal.filter(r => r.ocrMode === 'ocr_modal_gone');
  const modalExc = allResults.modal.filter(r => r.ocrMode === 'exception');
  console.log(`OCR completed: ${modalOcr.length}/${allResults.modal.length} | Chooser visible: ${modalChooser.length} | Modal gone: ${modalGone.length} | Timeout: ${modalTimeout.length} | Exception: ${modalExc.length}`);

  if (modalChooser.length > 0) {
    console.log('\n--> PATTERN CONFIRMED: OCR completes but extraction-mode chooser modal');
    console.log('    replaces the OCR modal. The test polls .ws-modal-overlay which is');
    console.log('    never absent — the overlay persists across modal transitions.');
    const workerInits = modalChooser.map(r => r.phases.workerInit_ms).filter(Boolean);
    const recognizes = modalChooser.map(r => r.phases.recognize_ms).filter(Boolean);
    if (workerInits.length) console.log(`workerInit: avg=${Math.round(workerInits.reduce((a,b)=>a+b,0)/workerInits.length)}ms min=${Math.min(...workerInits)}ms max=${Math.max(...workerInits)}ms`);
    if (recognizes.length) console.log(`recognize:  avg=${Math.round(recognizes.reduce((a,b)=>a+b,0)/recognizes.length)}ms min=${Math.min(...recognizes)}ms max=${Math.max(...recognizes)}ms`);
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SCENARIO B: Workflow OCR — Results');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('Run │ Mode          │ workerInit │ recognize  │ total    │ chars │ conf');
  console.log('─'.repeat(85));
  for (const r of allResults.workflow) {
    const p = r.phases;
    console.log(
      `${String(r.run).padStart(3)} │ ${(r.ocrMode || 'err').padEnd(13)} │ ${String(p.workerInit_ms ?? '-').padStart(10)} │ ${String(p.recognize_ms ?? '-').padStart(10)} │ ${String(r.totalMs).padStart(8)} │ ${String(r.chars ?? '-').padStart(5)} │ ${String(r.confidence ?? '-').padStart(4)}`
    );
  }
  console.log('─'.repeat(85));

  const wfOcr = allResults.workflow.filter(r => r.ocrMode === 'ocr');
  const wfTimeout = allResults.workflow.filter(r => r.ocrMode === 'timeout');
  const wfExc = allResults.workflow.filter(r => r.ocrMode === 'exception');
  console.log(`OCR completed: ${wfOcr.length}/${allResults.workflow.length} | Timeout: ${wfTimeout.length} | Exception: ${wfExc.length}`);

  if (wfOcr.length > 0) {
    const workerInits = wfOcr.map(r => r.phases.workerInit_ms).filter(Boolean);
    const recognizes = wfOcr.map(r => r.phases.recognize_ms).filter(Boolean);
    if (workerInits.length) console.log(`workerInit: avg=${Math.round(workerInits.reduce((a,b)=>a+b,0)/workerInits.length)}ms min=${Math.min(...workerInits)}ms max=${Math.max(...workerInits)}ms`);
    if (recognizes.length) console.log(`recognize:  avg=${Math.round(recognizes.reduce((a,b)=>a+b,0)/recognizes.length)}ms min=${Math.min(...recognizes)}ms max=${Math.max(...recognizes)}ms`);
  }

  /* ── Save raw data ───────────────────────────────────────────── */
  writeFileSync(join(ARTIFACTS, 'ocr-diagnostic-report-v2.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    iterations: ITERATIONS,
    fixture: { file: 'scan-clear.png', sizeBytes: scanSize },
    results: allResults,
  }, null, 2));
  console.log(`\nRaw data: artifacts/ocr-diagnostic/ocr-diagnostic-report-v2.json`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
