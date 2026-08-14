#!/usr/bin/env node
/**
 * WSP-022 — Seguridad de gráficos SVG generados desde datos de usuario.
 *
 * Cierra el hallazgo WSP-022 ("validación SVG de gráficos: cubrir SVG importado
 * o atributos complejos"): prueba que el SVG producido por buildTableChartSvg
 * (flujo real tabla -> grafico) convierte payloads adversarios en TEXTO escapado
 * y nunca en elementos/atributos ejecutables, y que es XML bien formado.
 *
 * Canal de ataque cubierto: etiquetas y titulo de tabla -> chart.svgData.
 * (El render en la app usa <img> con blob:/data: o el helper h() con DOM API;
 * chart.svgData se persiste y exporta sin inyeccion por innerHTML.)
 *
 * Port: 8081 (suites Node). DB: toolisto-workspace v3.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import nodeFs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = 8081;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

let _srv;
function startServer() {
  return new Promise((resolve, reject) => {
    _srv = createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/index.html';
      let fp = join(DIST, file);
      if (existsSync(fp) && nodeFs.statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(DIST, file + '.html');
      const mimeExt = fp.split('.').pop().toLowerCase();
      nodeFs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.' + mimeExt] || 'application/octet-stream' });
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

const PAYLOADS = [
  '"><script>alert(1)</script>',
  '<svg onload=alert(1)>',
  '<foreignObject><img src=x onerror=alert(1)></foreignObject>',
  '<use xlink:href="javascript:alert(1)">',
  'javascript:alert(1)',
  'onload=alert(1)',
  '"><img src=x onerror=alert(1)>',
];

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);
  const t0 = Date.now();
  try {
    console.log('=== WSP-022: SVG chart security E2E ===\n');
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => jsErrors.push(err.message));

    // ─── Step 1: Open Workspace ─────────────────────────────────
    console.log('--- Step 1: Open Workspace ---');
    const resp = await page.goto(`http://localhost:${PORT}/workspace/preview.html?preview=internal`, { waitUntil: 'load', timeout: 20000 });
    ok('1. Workspace loads', resp.status() === 200);

    // ─── Step 2: Create Project ─────────────────────────────────
    console.log('\n--- Step 2: Create Project ---');
    await page.click('#ws-welcome-new');
    await page.waitForSelector('.ws-modal-overlay', { timeout: 5000 });
    await page.fill('#modal-project-name', 'WSP-022 SVG Security');
    await page.fill('#modal-project-desc', 'Validacion de seguridad de SVG generado');
    const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
    if (createBtn) await createBtn.click();
    await page.waitForTimeout(800);
    const navVisible = await page.evaluate(() => {
      const nav = document.getElementById('ws-project-nav');
      return nav && getComputedStyle(nav).display !== 'none';
    });
    ok('2. Project created', navVisible);

    // ─── Step 3: Inject adversarial table ───────────────────────
    console.log('\n--- Step 3: Inject adversarial table ---');
    const injected = await page.evaluate((payloads) => {
      return new Promise((resolve) => {
        const req = indexedDB.open('toolisto-workspace', 3);
        req.onsuccess = () => {
          const db = req.result;
          const projectsTx = db.transaction('projects', 'readonly');
          const projectReq = projectsTx.objectStore('projects').getAll();
          projectReq.onsuccess = () => {
            const project = projectReq.result[0];
            if (!project) { db.close(); resolve({ error: 'no project' }); return; }
            const table = {
              id: 'tbl-wsp022-adversarial',
              projectId: project.id,
              type: 'table-document',
              name: 'Tabla <svg onload=alert(2)>',
              headers: ['Etiqueta', 'Ventas', 'Nota'],
              rows: [
                [payloads[0], '150', payloads[5]],
                [payloads[1], '80', payloads[4]],
                [payloads[2], '-30', payloads[6]],
                [payloads[3], '40', 'Linea normal'],
              ],
              reviewStatus: 'reviewed',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            const tx = db.transaction('data', 'readwrite');
            tx.objectStore('data').put(table);
            tx.oncomplete = () => { db.close(); resolve({ ok: true, projectId: project.id }); };
            tx.onerror = () => { db.close(); resolve({ error: 'put failed' }); };
          };
          projectReq.onerror = () => { db.close(); resolve({ error: 'projects read failed' }); };
        };
        req.onerror = () => resolve({ error: 'idb open failed' });
      });
    }, PAYLOADS);
    ok('3. Adversarial table injected', injected.ok, injected.error || '');
    evidence.injected = injected;

    // ─── Step 4: Navigate to Data, create chart ─────────────────
    console.log('\n--- Step 4: Create chart from table ---');
    await page.evaluate(() => {
      const items = document.querySelectorAll('.sidebar-item[data-view="data"]');
      for (const item of items) { if (item.offsetParent !== null) { item.click(); break; } }
    });
    await page.waitForTimeout(1500);
    let clicked = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      clicked = await page.evaluate(() => {
        const cards = document.querySelectorAll('.ws-card');
        for (const card of cards) {
          const text = card.textContent || '';
          if (text.includes('Tabla') && text.includes('filas')) {
            const btns = card.querySelectorAll('button');
            for (const b of btns) { if (b.textContent.includes('fico')) { b.click(); return true; } }
          }
        }
        return false;
      });
      if (clicked) break;
      await page.waitForTimeout(1000);
    }
    ok('4. Chart button clicked', clicked);

    // ─── Step 5: Read chart from IDB ────────────────────────────
    console.log('\n--- Step 5: Read chart.svgData ---');
    let chart = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(700);
      chart = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('toolisto-workspace', 3);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('assets', 'readonly');
          const r = tx.objectStore('assets').getAll();
          r.onsuccess = () => {
            const found = r.result.find(a => a.type === 'chart');
            db.close(); resolve(found || null);
          };
          r.onerror = () => { db.close(); resolve(null); };
        };
        req.onerror = () => resolve(null);
      }));
      if (chart?.svgData) break;
    }
    ok('5. Chart with SVG found', !!chart?.svgData, chart?.svgData ? `${chart.svgData.length} bytes` : 'not found');
    if (!chart?.svgData) { ko('5. Abort: no SVG to validate'); await browser.close(); await stopServer(); writeEvidence(); return; }
    const svg = chart.svgData;
    evidence.svgData = svg;
    evidence.chart = { id: chart.id, title: chart.config?.title, series: chart.config?.series };

    // ─── Step 6: Structural safety of generated SVG ─────────────
    console.log('\n--- Step 6: SVG structural safety ---');
    const hasScriptTag = /<script/i.test(svg);
    const hasEventHandler = /<[a-z][^>]*\son\w+\s*=/i.test(svg);
    const hasJavascriptUrl = /javascript:/i.test(svg);
    const hasForeignObject = /<foreignObject/i.test(svg);
    const hasUseElement = /<use\b/i.test(svg);
    const svgTagCount = (svg.match(/<svg[\s>]/gi) || []).length;
    ok('6. No <script> in SVG', !hasScriptTag);
    ok('6. No event handlers in SVG', !hasEventHandler);
    ok('6. No javascript: in SVG', !hasJavascriptUrl);
    ok('6. No <foreignObject> in SVG', !hasForeignObject);
    ok('6. No <use xlink> in SVG', !hasUseElement);
    ok('6. Exactly one <svg> element', svgTagCount === 1, `${svgTagCount} found`);
    evidence.structural = { hasScriptTag, hasEventHandler, hasJavascriptUrl, hasForeignObject, hasUseElement, svgTagCount };

    // ─── Step 7: Payloads must be escaped as text ───────────────
    console.log('\n--- Step 7: Payloads escaped as text ---');
    const escRe = /&(lt|gt|quot|amp);/;
    ok('7. SVG contains HTML-escaped entities', escRe.test(svg), (svg.match(/&lt;|&gt;|&quot;/g) || []).length + ' entities');
    ok('7. <script> payload escaped as &lt;script&gt;', /&lt;script&gt;/.test(svg));
    ok('7. <svg payload escaped as &lt;svg', /&lt;svg/.test(svg));
    ok('7. Angle brackets of foreignObject escaped', /&lt;foreign/.test(svg));
    const rawScript = svg.includes('<script');
    ok('7. No raw <script> anywhere', !rawScript);
    evidence.escapeCheck = {
      hasEntities: escRe.test(svg),
      scriptEscaped: /&lt;script&gt;/.test(svg),
      svgEscaped: /&lt;svg/.test(svg),
      foreignObjectEscaped: /&lt;foreign/.test(svg),
      rawScriptPresent: rawScript,
    };

    // ─── Step 8: SVG must parse as well-formed XML ──────────────
    console.log('\n--- Step 8: SVG well-formed XML ---');
    const xmlParse = await page.evaluate((svgText) => {
      try {
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const parseErr = doc.querySelector('parsererror');
        const scriptCount = doc.querySelectorAll('script').length;
        const allAttrs = [];
        doc.documentElement.querySelectorAll('*').forEach(node => {
          for (const a of node.attributes) allAttrs.push(a.name.toLowerCase());
        });
        const onAttrs = allAttrs.filter(a => /^on/.test(a));
        const nodes = Array.from(doc.documentElement.querySelectorAll('*')).map(n => n.tagName.toLowerCase());
        return {
          root: doc.documentElement ? doc.documentElement.tagName : null,
          parserError: parseErr ? parseErr.textContent : null,
          scriptCount,
          eventAttrs: onAttrs,
          tags: nodes,
        };
      } catch (e) {
        return { exception: String(e) };
      }
    }, svg);
    ok('8. SVG parses as XML', xmlParse.root === 'svg', xmlParse.parserError || xmlParse.exception || `root=${xmlParse.root}`);
    ok('8. No <script> nodes after parse', xmlParse.scriptCount === 0, `${xmlParse.scriptCount}`);
    ok('8. No event-handler attributes after parse', (xmlParse.eventAttrs || []).length === 0, JSON.stringify(xmlParse.eventAttrs || []));
    ok('8. Only safe element types', ((xmlParse.tags || []).filter(t => ['rect', 'text', 'line', 'g'].includes(t)).length) === (xmlParse.tags || []).length, JSON.stringify([...new Set(xmlParse.tags || [])]));
    evidence.xmlParse = xmlParse;

    // ─── Step 9: Rendered DOM preview is safe ───────────────────
    console.log('\n--- Step 9: DOM preview safety ---');
    const domCheck = await page.evaluate(() => {
      const main = document.getElementById('ws-main-content');
      if (!main) return { found: false };
      const svgs = main.querySelectorAll('svg');
      let inlineSvgs = 0, imgSvgs = 0;
      svgs.forEach(svg => {
        const fromDom = svg.closest('img');
        if (fromDom) imgSvgs++; else inlineSvgs++;
      });
      const scriptCount = main.querySelectorAll('script').length;
      return { found: true, inlineSvgs, imgSvgs, scriptCount, hasIframe: !!main.querySelector('iframe') };
    });
    ok('9. No <script> injected in main DOM', domCheck.scriptCount === 0, `${domCheck.scriptCount}`);
    ok('9. No iframes injected', !domCheck.hasIframe);
    evidence.domCheck = domCheck;

    // ─── Step 10: Zero console errors ───────────────────────────
    console.log('\n--- Step 10: Console errors ---');
    ok('10. No unhandled JS errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
    ok('10. No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    writeEvidence();
    console.log(`\n=== WSP-022: ${pass} PASS / ${fail} FAIL (${Date.now() - t0}ms) ===`);
    await browser.close();
    await stopServer();
    if (fail > 0) { console.error('\nFallos:', failures.join(', ')); process.exit(1); }
    process.exit(0);
  } catch (e) {
    console.error('\nEXCEPCION:', e);
    writeEvidence();
    await stopServer();
    process.exit(1);
  }
}

function writeEvidence() {
  try {
    writeFileSync(join(ARTIFACTS, 'wsp022-svg-security-evidence.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      pass, fail,
      payloads: PAYLOADS,
      failures,
      jsErrors, consoleErrors,
      evidence,
    }, null, 2), 'utf8');
    console.log(`Evidencia: ${join(ARTIFACTS, 'wsp022-svg-security-evidence.json')}`);
  } catch (e) { console.error('Evidencia no escrita:', e.message); }
}

main();
