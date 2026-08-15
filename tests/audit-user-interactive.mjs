import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const tmpDir = join(root, '.audit2-fixtures');
const toolsJson = JSON.parse(readFileSync(join(root, 'src', 'data', 'tools.json'), 'utf8'));

mkdirSync(tmpDir, { recursive: true });
writeFileSync(join(tmpDir, 'sample.txt'), 'Hola mundo. Esto es una prueba.\nSegunda línea con más palabras.', 'utf8');

let failures = 0, passes = 0, warnings = 0;
function fail(msg) { console.error(`  ✗ FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  ✓ ${msg}`); passes++; }
function warn(msg) { console.warn(`  ⚠ WARN: ${msg}`); warnings++; }
function ok(label, condition) { if (condition) pass(label); else fail(label); }

function startServer() {
  const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml' };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/toolisto' || urlPath === '/toolisto/' ? '/toolisto.html' : urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function checkOverflow(page, label) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth;
    const offenders = [];
    if (scrollWidth > clientWidth + 1) {
      document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > clientWidth + 1 && r.width > 0) {
          const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
          offenders.push(`${el.tagName.toLowerCase()}.${String(cls).trim().split(/\s+/)[0] || ''}(right=${Math.round(r.right)})`);
        }
      });
    }
    return { overflow: scrollWidth > clientWidth + 1, scrollWidth, clientWidth, offenders: offenders.slice(0, 8) };
  });
  if (result.overflow) {
    fail(`${label}: horizontal overflow (${result.scrollWidth}px > ${result.clientWidth}px) → ${result.offenders.join(', ')}`);
  } else {
    pass(`${label}: no horizontal overflow`);
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  AUDITORÍA INTERACTIVA — USUARIO REAL               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.fulfill({ status: 204, contentType: 'text/plain', body: '' }));
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); if (m.type() === 'warning') consoleWarnings.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // ═══════ HOMEPAGE: navigation & interaction as a user ═══════
  console.log('\n═══════ HOMEPAGE — INTERACCIÓN ═══════');
  await page.goto(url + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Grouped grid
  const groups = await page.$$eval('.tool-group', (els) => els.map((g) => ({ cat: g.dataset.category, count: g.querySelectorAll('.tool-card[data-tool]').length, summary: g.querySelector('summary')?.textContent.trim().slice(0, 60) })));
  ok(`Grouped grid rendered (${groups.length} groups)`, groups.length > 0);
  const textGroup = groups.find((g) => g.cat === 'text');
  const expectedTextGroup = toolsJson.filter(t => t.enabled && t.category === 'text').length;
  ok('Text group present', !!textGroup);
  if (textGroup) ok(`Text group has ${expectedTextGroup} tools habilitadas (${textGroup.count})`, textGroup.count === expectedTextGroup);

  await checkOverflow(page, 'homepage desktop');

  // Search "palabras"
  await page.fill('#toolSearch', 'palabras');
  await page.waitForTimeout(600);
  const searchVisible = await page.$$eval('.tool-card[data-tool]:not([hidden])', (els) => els.map((e) => e.dataset.tool));
  ok(`Search "palabras" → shows wordCount + textStatistics (found: ${searchVisible.join(', ') || 'none'})`, searchVisible.includes('wordCount') && searchVisible.includes('textStatistics'));
  await page.fill('#toolSearch', '');
  await page.waitForTimeout(400);

  // Category filter chip
  const chip = await page.$('.filter-chip[data-filter="text"], [data-nav-filter="text"]');
  ok('Text filter chip present', !!chip);
  if (chip) {
    await chip.click();
    await page.waitForTimeout(600);
    const filteredCards = await page.$$eval('.tool-card[data-tool]:not([hidden])', (els) => els.length);
    ok(`Text filter active → ${filteredCards} visible`, filteredCards > 0 && filteredCards <= 20);
    const catSet = new Set(await page.$$eval('.tool-card[data-tool]:not([hidden])', (els) => els.map((e) => e.dataset.category)));
    ok(`All filtered cards are category text (${[...catSet].join(',')})`, catSet.size === 1 && catSet.has('text'));
  }

  // Click a text tool card → navigate
  await page.click('.tool-card[data-tool="wordCount"]');
  await page.waitForTimeout(800);
  const urlNow = page.url();
  ok(`Card click navigates to /contar-palabras.html (${urlNow.split('/').pop()})`, urlNow.endsWith('/contar-palabras.html'));
  const h1 = await page.$eval('h1', (el) => el.textContent);
  ok(`Tool page h1 = "${h1}"`, h1.includes('Contar palabras'));
  await checkOverflow(page, 'tool page desktop');

  // Tool page: check title/description of the tool
  const docTitle = await page.title();
  ok(`Tool page title: "${docTitle}"`, docTitle.includes('Contar palabras'));

  // ═══════ TOOL PAGE — SMART RESULT CARD ═══════
  console.log('\n═══════ SMART RESULT CARD ═══════');
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'sample.txt')]);
  await page.waitForTimeout(600);

  const smartVisible = await page.$eval('#smartResult', (el) => !el.hidden).catch(() => false);
  ok('Smart result card becomes visible after upload', smartVisible);
  if (smartVisible) {
    const smartTitle = await page.$eval('#smartTitle', (el) => el.textContent);
    const smartIcon = await page.$eval('#smartIcon', (el) => el.textContent);
    ok(`Smart card title = "${smartTitle}"`, smartTitle.includes('Contar palabras'));
    ok(`Smart card icon rendered ("${smartIcon.trim()}")`, smartIcon.trim().length > 0);
  }

  const advancedVisible = await page.$eval('#advancedPanel', (el) => !el.hidden).catch(() => false);
  ok('Advanced panel visible', advancedVisible);

  const flowVisible = await page.$eval('#flowActions', (el) => !el.hidden).catch(() => false);
  ok('Flow actions (run button) visible', flowVisible);

  // Run and inspect stats table in dialog
  await page.click('#runButton');
  await page.waitForFunction(() => { const d = document.getElementById('resultDialog'); return d && d.open; }, { timeout: 15000 });
  const statLabels = await page.$$eval('#resultStats .stat', (els) => els.map((s) => s.querySelector('span')?.textContent));
  ok(`Stats table shows ${statLabels.length} rows`, statLabels.length >= 3);
  pass(`Stat labels: ${statLabels.join(' | ')}`);

  // Check the download filename
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('#downloadButton')]);
  if (dl) pass(`Download: ${dl.suggestedFilename()}`); else warn('Download not captured');

  // ═══════ COMPARAR TEXTOS — TWO FILES UX ═══════
  console.log('\n═══════ COMPARAR TEXTOS (2 archivos) ═══════');
  await page.goto(`${url}/comparar-textos.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await (await page.$('#fileInput')).setInputFiles([
    join(tmpDir, 'sample.txt'),
    join(tmpDir, 'sample.txt'),
  ]);
  await page.waitForTimeout(600);
  const pillCount = (await page.$$('.file-pill')).length;
  ok(`2 file pills shown (${pillCount})`, pillCount === 2);
  await page.click('#runButton');
  await page.waitForFunction(() => { const d = document.getElementById('resultDialog'); return d && d.open; }, { timeout: 15000 });
  const diffMsg = await page.$eval('#resultMessage', (el) => el.textContent);
  pass(`textDiff result: "${diffMsg}"`);

  // ═══════ MOBILE — HOMEPAGE & TOOL ═══════
  console.log('\n═══════ MOBILE 390px ═══════');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await checkOverflow(page, 'homepage mobile');

  const navBtn = await page.$('#menuToggle, .menu-button');
  ok('Mobile menu button present', !!navBtn);
  if (navBtn) {
    await navBtn.click();
    await page.waitForTimeout(400);
    const mobileNavVisible = await page.$eval('#mobileNav', (el) => !el.hidden).catch(() => false);
    ok('Mobile nav opens', mobileNavVisible);
  }

  await page.goto(`${url}/contar-palabras.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await checkOverflow(page, 'tool page mobile');
  await (await page.$('#fileInput')).setInputFiles([join(tmpDir, 'sample.txt')]);
  await page.waitForTimeout(600);
  const runBtnMobile = await page.$eval('#runButton', (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok(`Run button tap target on mobile (${runBtnMobile.w}×${runBtnMobile.h})`, runBtnMobile.h >= 40 && runBtnMobile.w >= 100);

  // ═══════ CATEGORY PAGE ═══════
  console.log('\n═══════ CATEGORY PAGE (texto) ═══════');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${url}/texto.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const catCards = await page.$$eval('.category-tool-item', (els) => els.length);
  const expectedText = toolsJson.filter(t => t.enabled && t.category === 'text').length;
  ok(`Category page "texto" has ${catCards} tools`, catCards === expectedText);
  const catTitle = await page.title();
  ok(`Category page title: "${catTitle}"`, /Texto/i.test(catTitle));

  // ═══════ CONSOLE ERRORS ═══════
  console.log('\n═══════ CONSOLA ═══════');
  const critical = consoleErrors.filter((e) => !/favicon|404|Analytics|third-party/i.test(e));
  if (critical.length) fail(`JS errors: ${critical.join(' | ')}`);
  else pass('No JS errors across all pages');
  if (consoleWarnings.length) {
    warn(`Console warnings (${consoleWarnings.length}): ${consoleWarnings.slice(0, 5).join(' | ')}`);
  } else {
    pass('No console warnings');
  }

  await browser.close();
  server.close();

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passes} PASS, ${failures} FAIL, ${warnings} WARN`);
  process.exit(failures ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
