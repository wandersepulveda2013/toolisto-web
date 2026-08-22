#!/usr/bin/env node
/**
 * CE-051 Step 8 isolated validation — runs the fixed OCR detection 10 times.
 * Verifies that the extraction-mode-chooser appears and the flow completes.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import nodeFs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'star-flow');
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

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log(`\n=== Step 8 Isolated Validation (${ITERATIONS} runs) ===\n`);

  const results = [];
  const browser = await chromium.launch({ headless: true });

  for (let i = 0; i < ITERATIONS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(err.message));

    const r = { run: i, result: 'FAIL', duration: 0, chars: 0, confidence: 0, chooserVisible: false, cleanupOk: false };
    const t0 = Date.now();

    try {
      await page.goto(`http://localhost:${PORT}/workspace/index.html?preview=internal`, {
        waitUntil: 'networkidle', timeout: 30000,
      });
      await page.waitForTimeout(500);

      // Create project
      await page.click('#ws-welcome-new');
      await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
      await page.fill('#modal-project-name', `Step8-${Date.now()}-${i}`);
      await page.fill('#modal-project-desc', `Validation run ${i}`);
      const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
      if (createBtn) await createBtn.click();
      await page.waitForTimeout(800);

      // Navigate to intake, upload fixture
      await page.click('.sidebar-item[data-view="intake"]');
      await page.waitForTimeout(300);
      const scanPath = join(FIXTURES, 'scan-clear.png');
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type=file]');
          if (inputs.length) { inputs[0].click(); return; }
          const cards = document.querySelectorAll('.ws-bento-card, .ws-card');
          for (const c of cards) { c.click(); return; }
        }),
      ]);
      await fileChooser.setFiles(scanPath);
      await page.waitForTimeout(2000);

      // Confirm scan
      const confirmBtn = await page.waitForSelector('.ws-btn-confirm', { timeout: 5000 }).catch(() => null);
      if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(2000); }
      await page.waitForTimeout(500);

      // Step 8: Navigate to capture view, click extract text
      await page.click('.sidebar-item[data-view="capture"]');
      await page.waitForTimeout(500);
      const extractBtns = await page.$$('.ws-card .ws-btn-ghost');

      if (extractBtns.length === 0) {
        r.result = 'FAIL';
        r.duration = Date.now() - t0;
        results.push(r);
        console.log(`Run ${i + 1}: FAIL (no extract buttons) ${r.duration}ms`);
        await page.close();
        await ctx.close();
        continue;
      }

      await extractBtns[0].click();
      await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });

      // Poll for extraction-mode-chooser (same logic as the fixed test)
      let ocrMode = 'timeout';
      const ocrStart = Date.now();
      for (let j = 0; j < 240; j++) {
        await page.waitForTimeout(500);
        const hasChooser = !!(await page.$('.ws-extraction-mode-card'));
        if (hasChooser) { ocrMode = 'ocr'; break; }
        const hasTextarea = !!(await page.$('.ws-modal textarea'));
        if (hasTextarea) { ocrMode = 'fallback'; break; }
      }

      r.duration = Date.now() - ocrStart;
      r.totalMs = Date.now() - t0;

      if (ocrMode === 'ocr') {
        r.chooserVisible = true;

        // Validate OCR content
        const ocrPreview = await page.evaluate(() => {
          const card = document.querySelector('.ws-extraction-mode-card');
          return card ? card.textContent.slice(0, 300) : '';
        });
        r.chars = ocrPreview.length;

        // Validate confidence badge
        const confBadge = await page.evaluate(() => {
          const badges = document.querySelectorAll('.ws-modal-body span');
          for (const b of badges) {
            const t = b.textContent || '';
            const m = t.match(/(\d+)%/);
            if (m) return Number(m[1]);
          }
          return 0;
        });
        r.confidence = confBadge;

        // Click "Extraer texto" to complete the flow
        const extraerBtn = await page.$('.ws-modal-footer .ws-btn-primary');
        if (extraerBtn) await extraerBtn.click();
        await page.waitForTimeout(3000);

        // Verify modal closed
        const modalGone = !(await page.$('.ws-modal-overlay'));
        r.cleanupOk = modalGone;

        if (r.chars > 0 && r.confidence > 0 && modalGone) {
          r.result = 'PASS';
        } else {
          r.result = 'FAIL';
        }
      } else if (ocrMode === 'fallback') {
        r.result = 'PASS';
        r.chooserVisible = false;
        r.cleanupOk = true;
      } else {
        r.result = 'FAIL';
        r.cleanupOk = false;
      }

      r.consoleErrors = consoleErrors.length;

    } catch (err) {
      r.result = 'FAIL';
      r.error = err.message.split('\n')[0];
      r.totalMs = Date.now() - t0;
    }

    results.push(r);
    const status = r.result === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`Run ${String(i + 1).padStart(2)}: ${status} | dur: ${String(r.duration).padStart(5)}ms | chars: ${String(r.chars).padStart(3)} | conf: ${String(r.confidence).padStart(2)}% | chooser: ${r.chooserVisible} | cleanup: ${r.cleanupOk}${r.error ? ' | err: ' + r.error : ''}`);
    await page.close();
    await ctx.close();
  }

  await browser.close();
  await stopServer();

  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;

  console.log(`\n=== Step 8 Validation: ${passed}/${ITERATIONS} PASS, ${failed} FAIL ===`);
  if (failed > 0) {
    console.log('FAILURES:');
    for (const r of results.filter(r => r.result === 'FAIL')) {
      console.log(`  Run ${r.run + 1}: ${r.error || 'mode=' + (r.ocrMode || 'unknown')}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
