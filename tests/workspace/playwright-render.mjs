import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const SCREENSHOTS = join(ROOT, 'screenshots', 'workspace');
const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(SCREENSHOTS, { recursive: true });

const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json',
  '.ico':'image/x-icon', '.mjs':'application/javascript; charset=utf-8'
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
    res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream'});
    res.end(data);
  });
});

let pass = 0, fail = 0;
const jsErrors = [];
const consoleErrors = [];
function ok(n, d='') { pass++; console.log(`  PASS: ${n}${d?' — '+d:''}`); }
function ko(n, d='') { fail++; console.log(`  FAIL: ${n}${d?' — '+d:''}`); }

await new Promise((resolve, reject) => {
  srv.once('error', reject);
  srv.listen(PORT, resolve);
});
console.log(`Server on :${PORT}\n`);

try {
  console.log('=== Playwright Workspace Rendering Test ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => jsErrors.push(err.message));

  // 1. Load
  console.log('--- 1. Page Load ---');
  const resp = await page.goto(`${BASE}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 15000 });
  ok('Page loads', resp.status() === 200, `Status: ${resp.status()}`);

  // 2. CSS
  console.log('\n--- 2. CSS Rendering ---');
  const cssLoaded = await page.evaluate(() => [...document.styleSheets].some(s => s.href && s.href.includes('workspace.css')));
  ok('workspace.css loaded', cssLoaded);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('Body bg is NOT default white', bg !== 'rgb(255, 255, 255)', `Got: ${bg}`);
  const ff = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  ok('Font is NOT Times New Roman', !ff.includes('Times'), `Got: ${ff.substring(0,60)}`);

  // 3. Sidebar
  console.log('\n--- 3. Sidebar ---');
  const sb = await page.$('.ws-sidebar');
  ok('Sidebar exists', !!sb);
  const sbBox = sb ? await sb.boundingBox() : null;
  ok('Sidebar visible width > 50', sbBox && sbBox.width > 50, `W: ${sbBox?.width}`);
  const navItems = await page.$$('.sidebar-item[data-view]');
  ok('Nav items >= 3', navItems.length >= 3, `Found: ${navItems.length}`);
  const logo = await page.$eval('.sidebar-logo-text', e => e.textContent).catch(() => '');
  ok('Logo shows TOOLISTO', logo === 'TOOLISTO', `Got: "${logo}"`);
  const sub = await page.$eval('.sidebar-logo-sub', e => e.textContent).catch(() => '');
  ok('Subtitle in Spanish', sub.includes('TRABAJO'), `Got: "${sub}"`);

  // 4. Topbar
  console.log('\n--- 4. Topbar ---');
  ok('Topbar exists', !!(await page.$('.ws-topbar')));
  const bc = await page.$eval('#ws-breadcrumb', e => e.textContent.trim()).catch(() => '');
  ok('Breadcrumb shows Proyectos', bc.includes('Proyectos'), `Got: "${bc}"`);

  // 5. Welcome
  console.log('\n--- 5. Welcome Screen ---');
  ok('Welcome title', !!(await page.$('.ws-empty-title')));
  ok('New project btn', !!(await page.$('#ws-welcome-new')));

  // 6. Theme/Density
  console.log('\n--- 6. Theme & Density ---');
  ok('Theme toggle', !!(await page.$('#ws-theme-toggle')));
  ok('Density toggle', !!(await page.$('#ws-density-toggle')));

  // 7. Navigation
  console.log('\n--- 7. Navigation ---');
  const navigateSidebar = async (view, expectedContent) => {
    const item = page.locator(`#ws-sidebar-nav .sidebar-item[data-view="${view}"]:visible`).first();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await page.waitForFunction((expected) => document.querySelector('#ws-main-content')?.textContent.includes(expected), expectedContent);
  };
  await navigateSidebar('intake', 'Captura Universal');
  const ic = await page.$eval('#ws-main-content', e => e.innerHTML);
  ok('Intake view', ic.includes('Captura Universal'));
  await navigateSidebar('tools', '144');
  const tc = await page.$eval('#ws-main-content', e => e.innerHTML);
  ok('Tools view', tc.includes('144'));
  const tCards = await page.$$('[data-tool-id]');
  ok('Tool cards > 100', tCards.length > 100, `Found: ${tCards.length}`);
  await navigateSidebar('projects', 'Proyecto');

  // 8. Create project
  console.log('\n--- 8. Project Creation ---');
  await page.click('#ws-welcome-new');
  await page.waitForTimeout(300);
  ok('Modal opens', !!(await page.$('.ws-modal-overlay')));
  await page.fill('#modal-project-name', 'Proyecto Test');
  await page.fill('#modal-project-desc', 'Descripcion de prueba');
  const createBtn = await page.$('.ws-modal-footer .ws-btn-primary');
  if (createBtn) await createBtn.click();
  await page.waitForTimeout(500);
  const pnv = await page.$eval('#ws-project-nav', e => getComputedStyle(e).display).catch(() => 'none');
  ok('Project nav visible after creation', pnv !== 'none');

  // 9. Dashboard
  console.log('\n--- 9. Dashboard ---');
  const dc = await page.$eval('#ws-main-content', e => e.innerHTML);
  ok('Dashboard shows project name', dc.includes('Proyecto Test'));

  // 10. Screenshots
  console.log('\n--- 10. Screenshots ---');
  await page.screenshot({ path: join(SCREENSHOTS, '01-workspace-1920.png') });
  ok('Screenshot: workspace 1920px');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SCREENSHOTS, '02-workspace-1366.png') });
  ok('Screenshot: workspace 1366px');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SCREENSHOTS, '03-workspace-768.png') });
  ok('Screenshot: workspace 768px');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SCREENSHOTS, '04-workspace-390.png') });
  ok('Screenshot: workspace 390px');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(200);

  // Tools screenshot
  await navigateSidebar('tools', '144');
  await page.screenshot({ path: join(SCREENSHOTS, '05-tools-1920.png') });
  ok('Screenshot: tools 1920px');

  // Palette screenshot
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SCREENSHOTS, '06-palette.png') });
  ok('Screenshot: palette');
  await page.keyboard.press('Escape');

  // Dark mode
  await page.click('#ws-theme-toggle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SCREENSHOTS, '07-dark-mode.png') });
  ok('Screenshot: dark mode');
  await page.click('#ws-theme-toggle');

  // 11. Ctrl+K
  console.log('\n--- 11. Ctrl+K Palette ---');
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  ok('Palette opens', !!(await page.$('.ws-palette-overlay')));
  ok('Palette input', !!(await page.$('.ws-palette-input')));
  const pi = await page.$$('.ws-palette-item');
  ok('Palette items > 5', pi.length > 5, `Found: ${pi.length}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ws-palette-overlay'));

  // 12. Errors
  console.log('\n--- 12. Errors ---');
  ok('No JS errors', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0,3).join('; ') : '');
  ok('No console errors', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0,3).join('; ') : '');

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  await browser.close();
} finally {
  srv.close();
}
process.exit(fail > 0 ? 1 : 0);
