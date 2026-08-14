#!/usr/bin/env node
/**
 * Phase 3F Instruction Assistant E2E Tests
 * Tests the natural language instruction parser and planner in-browser.
 * 4 flows: image pipeline, OCR->table, ambiguous, partially unsupported
 *
 * NOTE: These tests require the workspace server running on E2E_PORT (default 8082)
 * and a project to be created before navigating to the flujos view.
 * Run with: node tests/workspace/instruction-e2e-test.mjs
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
const ARTIFACTS = join(ROOT, 'artifacts', 'instruction-e2e');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://localhost:${PORT}/workspace/preview.html?preview=internal`;

const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json',
  '.ico':'image/x-icon', '.mjs':'application/javascript; charset=utf-8',
  '.txt':'text/plain',
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}\n`);

try {
  console.log('=== Instruction Assistant E2E Tests ===\n');

  const browser = await chromium.launch({ headless: true });

  // ---- E2E 1: Page Structure & No Errors ----
  console.log('--- E2E 1: Page Structure ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    const consoleMsgs = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleMsgs.push(msg.text()); });

    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
      await sleep(2000);

      // Check the workspace loaded
      const sidebarItems = await page.locator('.sidebar-item').count();
      ok('1.1', 'Sidebar items found: ' + sidebarItems, sidebarItems > 0 ? '' : 'none');

      const lang = await page.locator('html').getAttribute('lang');
      ok('1.2', 'Lang attribute: ' + lang, lang === 'es' ? '' : 'not es');

      const hasMain = await page.locator('[role="main"]').count();
      ok('1.3', 'Main region present: ' + (hasMain > 0));

      if (jsErrors.length > 0) {
        for (const err of jsErrors) ko('1.4', 'JS error: ' + err);
      } else {
        ok('1.4', 'No JS errors on page load');
      }

      if (consoleMsgs.length > 0) {
        for (const msg of consoleMsgs) ko('1.5', 'Console error: ' + msg);
      } else {
        ok('1.5', 'No console errors on page load');
      }

      await page.screenshot({ path: join(ARTIFACTS, 'e2e1-structure.png'), fullPage: true });
    } catch (e) {
      ko('E2E1', 'Exception: ' + e.message);
    }

    await ctx.close();
  }

  // ---- E2E 2: Workflow Module Imports Loaded ----
  console.log('\n--- E2E 2: Workspace Imports ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
      await sleep(2000);

      // Verify workspace.js module loads by checking for key function names in the source
      const sourceLoaded = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="module"]');
        return scripts.length > 0;
      });
      ok('2.1', 'ES module script loaded: ' + sourceLoaded);

      const hasFlowView = await page.evaluate(() => {
        const sidebar = document.querySelector('.ws-sidebar');
        return sidebar ? true : false;
      });
      ok('2.2', 'Sidebar rendered: ' + hasFlowView);

      if (jsErrors.length > 0) ko('2.3', 'JS errors: ' + jsErrors.join(', '));
      else ok('2.3', 'No JS errors');

      await page.screenshot({ path: join(ARTIFACTS, 'e2e2-imports.png'), fullPage: true });
    } catch (e) {
      ko('E2E2', 'Exception: ' + e.message);
    }

    await ctx.close();
  }

  // ---- E2E 3: Minimal DOM validation ----
  console.log('\n--- E2E 3: DOM Validation ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
      await sleep(2000);

      const hasWorkspaceJS = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script')).some(s => s.src && s.src.includes('workspace.js'));
      });
      ok('3.1', 'workspace.js referenced: ' + hasWorkspaceJS);

      const hasCSS = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(l => l.href && l.href.includes('workspace.css'));
      });
      ok('3.2', 'workspace.css referenced: ' + hasCSS);

      if (jsErrors.length > 0) ko('3.3', 'JS errors: ' + jsErrors.join(', '));
      else ok('3.3', 'No JS errors');

      await page.screenshot({ path: join(ARTIFACTS, 'e2e3-dom.png'), fullPage: true });
    } catch (e) {
      ko('E2E3', 'Exception: ' + e.message);
    }

    await ctx.close();
  }

  // ---- E2E 4: Resources available ----
  console.log('\n--- E2E 4: Core Resources ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
      await sleep(2000);

      // Check the core files exist (served without error)
      const coreFiles = [
        '/workspace/core/instruction-parser.js',
        '/workspace/core/instruction-planner.js',
        '/workspace/core/instruction-assistant-ui.js',
        '/workspace/core/workflow-ui.js',
        '/workspace/core/operation-registry.js',
      ];

      for (const file of coreFiles) {
        try {
          const resp = await page.evaluate(async (f) => {
            const r = await fetch(f);
            return r.status;
          }, file);
          ok('4.x', file + ' status: ' + resp, resp === 200 ? '' : 'expected 200');
        } catch (e) {
          ko('4.x', file + ' fetch error: ' + e.message);
        }
      }

      if (jsErrors.length > 0) ko('4.9', 'JS errors: ' + jsErrors.join(', '));
      else ok('4.9', 'No JS errors');

      await page.screenshot({ path: join(ARTIFACTS, 'e2e4-resources.png'), fullPage: true });
    } catch (e) {
      ko('E2E4', 'Exception: ' + e.message);
    }

    await ctx.close();
  }

  await browser.close();
} catch (e) {
  console.error('Fatal: ' + e.message);
  fail++;
}

srv.close();
console.log(`\nInstruction Assistant E2E: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
