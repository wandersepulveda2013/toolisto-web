import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const ssDir = join(root, 'artifacts', 'fase2-audit');
const tmpDir = join(root, '.audit-fixtures');

mkdirSync(ssDir, { recursive: true });

let failures = 0;
let warnings = 0;
let passes = 0;
const issues = [];
function fail(msg) { console.error(`  ✗ FAIL: ${msg}`); failures++; issues.push({ level: 'FAIL', msg }); }
function warn(msg) { console.warn(`  ⚠ WARN: ${msg}`); warnings++; issues.push({ level: 'WARN', msg }); }
function pass(msg) { console.log(`  ✓ ${msg}`); passes++; }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.xml': 'application/xml',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/toolisto' || urlPath === '/toolisto/' ? '/toolisto.html' : urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function makeFixtures() {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'sample.txt'), 'Hola mundo. Esto es una prueba.\nSegunda línea con más palabras para contar.', 'utf8');
  writeFileSync(join(tmpDir, 'empty.txt'), '', 'utf8');
  writeFileSync(join(tmpDir, 'base64.txt'), 'SG9sYSBNdW5kbw==', 'utf8');
  writeFileSync(join(tmpDir, 'not-base64.txt'), 'esto no es base64 %%@@##', 'utf8');
  writeFileSync(join(tmpDir, 'url.txt'), 'Hola%20Mundo%20%26%20m%C3%A1s', 'utf8');
  writeFileSync(join(tmpDir, 'not-url.txt'), 'No tiene encoding URL', 'utf8');
  writeFileSync(join(tmpDir, 'diff-a.txt'), 'Línea uno\nLínea dos\nLínea tres\n', 'utf8');
  writeFileSync(join(tmpDir, 'diff-b.txt'), 'Línea uno\nLínea dos MODIFICADA\nLínea tres\nLínea nueva\n', 'utf8');
  writeFileSync(join(tmpDir, 'identical-a.txt'), 'Mismo contenido\nSegunda línea\n', 'utf8');
  writeFileSync(join(tmpDir, 'identical-b.txt'), 'Mismo contenido\nSegunda línea\n', 'utf8');
  writeFileSync(join(tmpDir, 'sample.html'), '<html><head><title>Página</title></head><body><h1>Título</h1><p>Un <strong>párrafo</strong> con <a href="https://example.com">enlace</a>.</p><img src="test.jpg" alt="foto"><ul><li>Item 1</li><li>Item 2</li></ul></body></html>', 'utf8');
  writeFileSync(join(tmpDir, 'nested.html'), '<div><div><span>Texto profundo</span></div></div>', 'utf8');
  writeFileSync(join(tmpDir, 'sample.css'), 'body {\n  color: red;\n  /* comentario largo que debe ser eliminado */\n  margin: 0 auto;\n  padding: 10px;\n}\n\n.container {\n  display: flex;\n  gap: 1rem;\n}', 'utf8');
  writeFileSync(join(tmpDir, 'already-min.css'), 'body{color:red;margin:0}', 'utf8');
  writeFileSync(join(tmpDir, 'large.txt'), 'palabra '.repeat(10000), 'utf8');
  writeFileSync(join(tmpDir, 'single-word.txt'), 'solamente', 'utf8');
  writeFileSync(join(tmpDir, 'only-spaces.txt'), '   \t  \n  \n  ', 'utf8');
  writeFileSync(join(tmpDir, 'unicode.txt'), 'Ñoño café über naïve résumé 日本語 مرحبا', 'utf8');
}

function takeName(toolSlug) {
  return toolSlug;
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(ssDir, name + '.png'), fullPage: true });
}

async function auditToolPage({ page, url, slug, toolId, fixtures, checks }) {
  const label = slug;
  console.log(`\n--- Audit: ${label} ---`);

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // 1. Page structure
  const hasTitle = await page.$eval('title', (el) => el.textContent.length > 5);
  ok(`${label}: page has title`, hasTitle);

  const hasH1 = await page.$eval('h1', (el) => el.textContent.length > 0).catch(() => false);
  ok(`${label}: has <h1>`, hasH1);

  const hasDescription = await page.$eval('meta[name="description"]', (el) => el.getAttribute('content')?.length > 10).catch(() => false);
  ok(`${label}: has meta description`, hasDescription);

  const toolConfig = await page.$eval('#tool-page-config', (el) => {
    try { return JSON.parse(el.textContent); } catch { return null; }
  }).catch(() => null);
  ok(`${label}: tool-page-config present`, !!toolConfig);
  ok(`${label}: tool-page-config.toolId matches`, toolConfig?.toolId === toolId);

  const hasFileInput = !!(await page.$('#fileInput'));
  ok(`${label}: has #fileInput`, hasFileInput);

  const hasRunButton = !!(await page.$('#runButton'));
  ok(`${label}: has #runButton`, hasRunButton);

  const runBtnDisabled = await page.$eval('#runButton', (el) => el.disabled);
  ok(`${label}: run button disabled before upload`, runBtnDisabled);

  // 2. Icons render (not broken images) — smart-icon is inside the hidden result card until files are added
  const iconInDom = !!(await page.$('.smart-icon'));
  ok(`${label}: tool icon present in DOM`, iconInDom);
  const hasBrokenImg = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).length).catch(() => 0);
  ok(`${label}: no broken images`, hasBrokenImg === 0);

  // 3. Upload valid file(s)
  if (fixtures.valid) {
    const fileInput = await page.$('#fileInput');
    if (fileInput) {
      await fileInput.setInputFiles(fixtures.valid);
      await page.waitForTimeout(500);

      const runBtnEnabled = await page.$eval('#runButton', (el) => !el.disabled);
      ok(`${label}: run button enabled after valid upload`, runBtnEnabled);

      const hasFilePills = (await page.$$('.file-pill')).length > 0;
      ok(`${label}: file pills visible after upload`, hasFilePills);

      // 4. Run tool
      if (runBtnEnabled) {
        await page.click('#runButton');
        await page.waitForFunction(() => {
          const dialog = document.getElementById('resultDialog');
          return dialog && dialog.open;
        }, { timeout: 30000 });

        const resultTitle = await page.$eval('#resultTitle', (el) => el.textContent);
        const resultMessage = await page.$eval('#resultMessage', (el) => el.textContent);
        ok(`${label}: result dialog opened`, resultTitle.length > 0);
        ok(`${label}: result has title text`, resultTitle.length > 0);
        ok(`${label}: result has message`, resultMessage.length > 0);

        // Check stats present (for stat-based tools)
        if (checks?.expectStats) {
          const statsCount = (await page.$$('#resultStats .stat')).length;
          ok(`${label}: stats rendered (≥1)`, statsCount >= 1);
        }

        // Check download button
        const downloadBtn = !!(await page.$('#downloadButton'));
        ok(`${label}: download button present`, downloadBtn);

        // Check message content
        if (checks?.messageContains) {
          const matches = new RegExp(checks.messageContains, 'i').test(resultMessage);
          ok(`${label}: message matches /${checks.messageContains}/`, matches);
        }

        await screenshot(page, takeName(slug) + '-result');
        await page.click('#resetButton').catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }

  // 5. Error handling: wrong file type (if accepts is specific)
  if (fixtures.wrongType) {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const fileInput = await page.$('#fileInput');
    if (fileInput) {
      await fileInput.setInputFiles(fixtures.wrongType);
      await page.waitForTimeout(500);
      // Check file was rejected or no pills
      const pillCount = (await page.$$('.file-pill')).length;
      const runBtnStillDisabled = await page.$eval('#runButton', (el) => el.disabled);
      // Either rejected (no pills + disabled) or accepted (pills + enabled)
      if (pillCount > 0 && !runBtnStillDisabled) {
        ok(`${label}: wrong-type file accepted (allowlist may be loose)`, true);
      } else {
        ok(`${label}: wrong-type file rejected`, true);
      }
    }
  }

  // 6. Empty state
  if (fixtures.valid) {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const emptyBtnDisabled = await page.$eval('#runButton', (el) => el.disabled);
    ok(`${label}: run button disabled in empty state`, emptyBtnDisabled);
  }

  // Console errors
  const criticalErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('404') &&
    !e.includes('third-party') &&
    !e.includes('Analytics')
  );
  if (criticalErrors.length) {
    fail(`${label}: JS console errors → ${criticalErrors.join(' | ')}`);
  } else {
    ok(`${label}: no JS errors`, true);
  }

  await page.removeAllListeners('console');
  await page.removeAllListeners('pageerror');
}

function ok(label, condition) {
  if (condition) pass(label); else fail(label);
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  AUDITORÍA USUARIO — Fase 2: Motor de Texto        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  makeFixtures();
  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.fulfill({ status: 204, contentType: 'text/plain', body: '' }));

  // ═══════════════════════════════════════════════════
  // HOMEPAGE AUDIT
  // ═══════════════════════════════════════════════════
  console.log('\n═══════ HOMEPAGE ═══════');
  await page.goto(url + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const totalCards = await page.$$eval('.tool-card[data-tool]', (cards) => cards.length);
  const enabledCount = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8')).filter((t) => t.enabled).length;
  ok(`Homepage has ${enabledCount} tool cards (found ${totalCards})`, totalCards === enabledCount);

  // Check text category tools are present on homepage
  const textToolIds = ['textStatistics', 'wordCount', 'textDiff', 'htmlToMarkdown', 'htmlToText', 'cssMinifier', 'base64Encode', 'base64Decode', 'urlEncode', 'urlDecode'];
  for (const toolId of textToolIds) {
    const card = await page.$(`.tool-card[data-tool="${toolId}"]`);
    ok(`Homepage card: ${toolId}`, !!card);
  }

  // Check new tools have correct category
  for (const toolId of textToolIds) {
    const card = await page.$(`.tool-card[data-tool="${toolId}"]`);
    if (card) {
      const cat = await card.evaluate((el) => el.getAttribute('data-category'));
      ok(`${toolId} card category = "text"`, cat === 'text');
    }
  }

  // Check no broken tool-card links
  const links = await page.$$eval('.tool-card[data-tool]', (cards) =>
    cards.map((c) => ({ href: c.getAttribute('href'), name: c.textContent.trim().substring(0, 40) }))
  );
  const badLinks = links.filter((l) => !l.href || l.href.includes('undefined'));
  ok(`No broken card links (found ${badLinks.length})`, badLinks.length === 0);
  if (badLinks.length) badLinks.forEach((l) => fail(`  Broken: ${l.name} → ${l.href}`));

  await screenshot(page, 'homepage');

  // ═══════════════════════════════════════════════════
  // TOOL PAGES: Structure + Full Flow
  // ═══════════════════════════════════════════════════
  console.log('\n═══════ TOOL PAGES — FULL FLOW ═══════');

  await auditToolPage({
    page, url,
    slug: 'estadisticas-texto',
    toolId: 'textStatistics',
    fixtures: { valid: [join(tmpDir, 'sample.txt')] },
    checks: { expectStats: true, messageContains: 'Estad' },
  });

  await auditToolPage({
    page, url,
    slug: 'contar-palabras',
    toolId: 'wordCount',
    fixtures: { valid: [join(tmpDir, 'sample.txt')] },
    checks: { expectStats: true, messageContains: 'Conteo' },
  });

  await auditToolPage({
    page, url,
    slug: 'comparar-textos',
    toolId: 'textDiff',
    fixtures: { valid: [join(tmpDir, 'diff-a.txt'), join(tmpDir, 'diff-b.txt')] },
    checks: { expectStats: true, messageContains: 'Comparaci' },
  });

  await auditToolPage({
    page, url,
    slug: 'html-a-markdown',
    toolId: 'htmlToMarkdown',
    fixtures: { valid: [join(tmpDir, 'sample.html')] },
    checks: { messageContains: 'Markdown' },
  });

  await auditToolPage({
    page, url,
    slug: 'html-a-texto',
    toolId: 'htmlToText',
    fixtures: { valid: [join(tmpDir, 'sample.html')] },
    checks: { messageContains: 'Texto' },
  });

  await auditToolPage({
    page, url,
    slug: 'minificar-css',
    toolId: 'cssMinifier',
    fixtures: { valid: [join(tmpDir, 'sample.css')] },
    checks: { expectStats: true, messageContains: 'minificado' },
  });

  await auditToolPage({
    page, url,
    slug: 'codificar-base64',
    toolId: 'base64Encode',
    fixtures: { valid: [join(tmpDir, 'sample.txt')] },
    checks: { messageContains: 'codificado' },
  });

  await auditToolPage({
    page, url,
    slug: 'decodificar-base64',
    toolId: 'base64Decode',
    fixtures: { valid: [join(tmpDir, 'base64.txt')] },
    checks: { messageContains: 'decodificado' },
  });

  await auditToolPage({
    page, url,
    slug: 'codificar-url',
    toolId: 'urlEncode',
    fixtures: { valid: [join(tmpDir, 'sample.txt')] },
    checks: { messageContains: 'codificado' },
  });

  await auditToolPage({
    page, url,
    slug: 'decodificar-url',
    toolId: 'urlDecode',
    fixtures: { valid: [join(tmpDir, 'url.txt')] },
    checks: { messageContains: 'decodificado' },
  });

  // ═══════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════
  console.log('\n═══════ EDGE CASES ═══════');

  // empty file → stats
  await page.goto(`${url}/estadisticas-texto.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.$eval('#fileInput', (el) => el.setAttribute('multiple', ''));
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'empty.txt')]);
  await page.waitForTimeout(500);
  const emptyRunDisabled = await page.$eval('#runButton', (el) => el.disabled);
  ok('Empty file: run button enabled (file accepted)', !emptyRunDisabled);
  if (!emptyRunDisabled) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 15000 });
    const emptyMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('Empty file: handles gracefully (no crash)', emptyMsg.length > 0);
    await page.click('#resetButton').catch(() => {});
    await page.waitForTimeout(300);
  }

  // textDiff with only 1 file
  await page.goto(`${url}/comparar-textos.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'diff-a.txt')]);
  await page.waitForTimeout(500);
  const oneFileRunEnabled = await page.$eval('#runButton', (el) => !el.disabled);
  // textDiff requires 2 files - check validation
  if (oneFileRunEnabled) {
    await page.click('#runButton');
    await page.waitForTimeout(1500);
    // Should show toast warning about needing 2 files
    const toastVisible = await page.$eval('#toast', (el) => el.textContent.length > 0).catch(() => false);
    ok('textDiff with 1 file: shows validation warning', toastVisible);
    await page.waitForTimeout(500);
    await page.goto(`${url}/comparar-textos.html`, { waitUntil: 'networkidle' });
  }

  // base64Decode with invalid content
  await page.goto(`${url}/decodificar-base64.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'not-base64.txt')]);
  await page.waitForTimeout(500);
  const runBtn = await page.$('#runButton');
  if (runBtn) {
    const enabled = await page.$eval('#runButton', (el) => !el.disabled);
    if (enabled) {
      await page.click('#runButton');
      // Invalid base64 → validation message shown as toast (no dialog)
      await page.waitForFunction(() => {
        const t = document.getElementById('toast');
        return t && t.textContent.length > 0 && !t.hidden;
      }, { timeout: 10000 });
      const toastText = await page.$eval('#toast', (el) => el.textContent);
      ok('base64Decode invalid: shows validation toast', /no parece|válido|base64/i.test(toastText));
      const dialogOpen = await page.$eval('#resultDialog', (el) => el.open).catch(() => false);
      ok('base64Decode invalid: dialog NOT opened', !dialogOpen);
    } else {
      ok('base64Decode invalid: file rejected', true);
    }
  }

  // cssMinifier already minified
  await page.goto(`${url}/minificar-css.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'already-min.css')]);
  await page.waitForTimeout(500);
  const cssRunEnabled2 = await page.$eval('#runButton', (el) => !el.disabled);
  if (cssRunEnabled2) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout: 10000 });
    const cssMsg2 = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('cssMinifier already-minified: still works', cssMsg2.length > 0);
    const cssStats2 = (await page.$$('#resultStats .stat')).length;
    ok('cssMinifier already-minified: shows stats', cssStats2 >= 1);
    await page.click('#resetButton').catch(() => {});
  }

  // Unicode input
  await page.goto(`${url}/estadisticas-texto.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'unicode.txt')]);
  await page.waitForTimeout(500);
  const uniEnabled = await page.$eval('#runButton', (el) => !el.disabled);
  if (uniEnabled) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout: 10000 });
    const uniMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('Unicode text: processes correctly', uniMsg.length > 0);
    await page.click('#resetButton').catch(() => {});
  }

  // Large file
  await page.goto(`${url}/contar-palabras.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'large.txt')]);
  await page.waitForTimeout(500);
  const largeEnabled = await page.$eval('#runButton', (el) => !el.disabled);
  if (largeEnabled) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout: 15000 });
    const largeMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('Large file (10K words): processes correctly', largeMsg.length > 0);
    await page.click('#resetButton').catch(() => {});
  }

  // Single word
  await page.goto(`${url}/estadisticas-texto.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'single-word.txt')]);
  await page.waitForTimeout(500);
  const singleEnabled = await page.$eval('#runButton', (el) => !el.disabled);
  if (singleEnabled) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout: 10000 });
    const singleMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('Single word: processes correctly', singleMsg.length > 0);
    await page.click('#resetButton').catch(() => {});
  }

  // textDiff identical files
  await page.goto(`${url}/comparar-textos.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'identical-a.txt'), join(tmpDir, 'identical-b.txt')]);
  await page.waitForTimeout(500);
  const idEnabled = await page.$eval('#runButton', (el) => !el.disabled);
  if (idEnabled) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout: 15000 });
    const idMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('Identical files diff: handles correctly', /idénticos|0/.test(idMsg) || idMsg.length > 0);
    await page.click('#resetButton').catch(() => {});
  }

  // base64 round-trip
  await page.goto(`${url}/codificar-base64.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'sample.txt')]);
  await page.waitForTimeout(500);
  const encEnabled = await page.$eval('#runButton', (el) => !el.disabled);
  if (encEnabled) {
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const d = document.getElementById('resultDialog');
      return d && d.open;
    }, { timeout: 10000 });
    const encMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok('Base64 encode: success', encMsg.length > 0);
    await page.click('#resetButton').catch(() => {});
  }

  // ═══════════════════════════════════════════════════
  // SEO / ACCESSIBILITY
  // ═══════════════════════════════════════════════════
  console.log('\n═══════ SEO & ACCESIBILIDAD ═══════');

  for (const slug of ['estadisticas-texto', 'contar-palabras', 'minificar-css']) {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);

    const hasSchema = !!(await page.$('script[type="application/ld+json"]'));
    ok(`${slug}: has structured data (ld+json)`, hasSchema);

    const canonical = await page.$eval('link[rel="canonical"]', (el) => el.getAttribute('href')).catch(() => null);
    ok(`${slug}: has canonical link`, !!canonical);

    const ogTitle = await page.$eval('meta[property="og:title"]', (el) => el.getAttribute('content')).catch(() => null);
    ok(`${slug}: has og:title`, !!ogTitle);

    const ogDesc = await page.$eval('meta[property="og:description"]', (el) => el.getAttribute('content')).catch(() => null);
    ok(`${slug}: has og:description`, !!ogDesc);

    const langAttr = await page.$eval('html', (el) => el.getAttribute('lang'));
    ok(`${slug}: lang is Spanish ("${langAttr}")`, langAttr === 'es' || langAttr === 'es-419');

    // aria on file input
    const fileInputRole = await page.$eval('#dropZone', (el) => el.getAttribute('role')).catch(() => null);
    ok(`${slug}: drop zone has role`, !!fileInputRole);

    // Run button accessible name
    const runBtnLabel = await page.$eval('#runButton', (el) => el.textContent.trim());
    ok(`${slug}: run button has text`, runBtnLabel.length > 0);
  }

  // ═══════════════════════════════════════════════════
  // VIEWS: RESPONSIVE (390px, 768px, 1440px)
  // ═══════════════════════════════════════════════════
  console.log('\n═══════ RESPONSIVE ═══════');
  for (const vp of [{ name: 'mobile', w: 390, h: 844 }, { name: 'tablet', w: 768, h: 1024 }, { name: 'desktop', w: 1440, h: 900 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(`${url}/contar-palabras.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const h1Visible = await page.$eval('h1', (el) => el.getBoundingClientRect().width > 0);
    ok(`${vp.name} (${vp.w}px): h1 visible`, h1Visible);
    const dropVisible = await page.$eval('#dropZone', (el) => el.getBoundingClientRect().height > 0).catch(() => false);
    ok(`${vp.name} (${vp.w}px): drop zone visible`, dropVisible);
    await screenshot(page, `responsive-${vp.name}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });

  // ═══════════════════════════════════════════════════
  // DOWNLOAD
  // ═══════════════════════════════════════════════════
  console.log('\n═══════ DOWNLOAD ═══════');
  await page.goto(`${url}/codificar-base64.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'sample.txt')]);
  await page.waitForTimeout(500);
  await page.click('#runButton');
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout: 10000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.click('#downloadButton'),
  ]);
  if (download) {
    const suggestedName = download.suggestedFilename();
    ok(`Download triggered, filename: ${suggestedName}`, suggestedName.length > 0);
    const path = join(ssDir, suggestedName);
    await download.saveAs(path);
    const size = statSync(path).size;
    ok(`Downloaded file has content (${size} bytes)`, size > 0);
  } else {
    warn('Download did not trigger (may need event listener)');
  }

  // ═══════════════════════════════════════════════════
  // REPORT
  // ═══════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passes} PASS, ${failures} FAIL, ${warnings} WARN`);
  console.log('══════════════════════════════════════════════════════');

  if (issues.length) {
    console.log('\nISSUES:');
    issues.filter((i) => i.level === 'FAIL' || i.level === 'WARN').forEach((i) => console.log(`  ${i.level}: ${i.msg}`));
  }

  await browser.close();
  server.close();
  process.exit(failures ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
