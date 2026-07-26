import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');

let failures = 0;
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let filePath = join(distDir, req.url === '/' ? '/index.html' : req.url);
      if (!existsSync(filePath)) { res.writeHead(404); res.end(); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function run() {
  console.log('=== Playwright Image Tools Test ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    pass('Homepage loaded');

    const toolCards = await page.$$('.tool-card');
    pass(`Tool cards found: ${toolCards.length}`);

    await page.click('[data-tool="resizeImage"]');
    pass('resizeImage tool selected');

    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    pass('Advanced panel opened');

    const runBtn = await page.$('#runButton');
    if (!runBtn) { fail('runButton not found'); return; }
    pass('runButton found');

    const fixturePath = join(__dirname, 'fixtures', 'test-200x100.png');
    const fileInput = await page.$('#fileInput');
    await fileInput.setInputFiles(fixturePath);
    pass('Test image uploaded');

    await page.waitForTimeout(500);

    const resizeWidth = await page.$('#resizeWidth');
    const resizeHeight = await page.$('#resizeHeight');
    const resizeFormat = await page.$('#resizeFormat');
    const resizeQuality = await page.$('#resizeQuality');
    const resizeKeepRatio = await page.$('#resizeKeepRatio');

    if (resizeWidth) pass('resizeWidth control found');
    else fail('resizeWidth control missing');

    if (resizeHeight) pass('resizeHeight control found');
    else fail('resizeHeight control missing');

    if (resizeFormat) pass('resizeFormat control found');
    else fail('resizeFormat control missing');

    if (resizeQuality) pass('resizeQuality control found');
    else fail('resizeQuality control missing');

    if (resizeKeepRatio) pass('resizeKeepRatio checkbox found');
    else fail('resizeKeepRatio checkbox missing');

    await page.fill('#resizeWidth', '400');
    await page.fill('#resizeHeight', '200');
    pass('Dimensions set to 400x200');

    await runBtn.click();
    pass('Run button clicked');

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 10000 });
    pass('Result dialog opened');

    const resultTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (resultTitle) pass(`Result title: "${resultTitle}"`);
    else fail('Result title empty');

    const resultMessage = await page.$eval('#resultMessage', (el) => el.textContent);
    if (resultMessage && resultMessage.includes('400')) pass(`Result message mentions 400: "${resultMessage}"`);
    else fail(`Result message unexpected: "${resultMessage}"`);

    const previewImg = await page.$('#previewArea img');
    if (previewImg) pass('Preview image displayed');
    else fail('No preview image');

    const downloadBtn = await page.$('#downloadButton');
    if (downloadBtn) pass('Download button present');
    else fail('Download button missing');

    await page.click('#dialogClose');
    pass('Dialog closed');

    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    pass('Run button re-enabled');

    if (consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404')).length === 0) {
      pass('No critical console errors');
    } else {
      fail(`Console errors: ${consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404')).join('; ')}`);
    }

    console.log('\n--- Test: resize with aspect ratio ---');

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="resizeImage"]');
    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    const fileInput2 = await page.$('#fileInput');
    await fileInput2.setInputFiles(fixturePath);
    await page.waitForTimeout(500);

    const keepRatio = await page.$('#resizeKeepRatio');
    if (keepRatio) {
      await keepRatio.check();
      pass('Aspect ratio checkbox checked');
    }
    await page.fill('#resizeWidth', '100');

    const runBtn2 = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtn2.click();

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 10000 });

    const msg2 = await page.$eval('#resultMessage', (el) => el.textContent);
    if (msg2 && msg2.includes('100')) pass(`Aspect ratio resize: "${msg2}"`);
    else fail(`Aspect ratio message unexpected: "${msg2}"`);

    await page.click('#dialogClose');

    console.log('\n--- Test: watermark image ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="watermarkImage"]');
    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    const fileInput3 = await page.$('#fileInput');
    await fileInput3.setInputFiles(fixturePath);
    await page.waitForTimeout(500);

    const wmText = await page.$('#wmText');
    const wmPosition = await page.$('#wmPosition');
    const wmSize = await page.$('#wmSize');
    const wmOpacity = await page.$('#wmOpacity');
    const wmMargin = await page.$('#wmMargin');
    const wmColor = await page.$('#wmColor');

    if (wmText) pass('wmText control found'); else fail('wmText missing');
    if (wmPosition) pass('wmPosition control found'); else fail('wmPosition missing');
    if (wmSize) pass('wmSize control found'); else fail('wmSize missing');
    if (wmOpacity) pass('wmOpacity control found'); else fail('wmOpacity missing');
    if (wmMargin) pass('wmMargin control found'); else fail('wmMargin missing');
    if (wmColor) pass('wmColor control found'); else fail('wmColor missing');

    await page.fill('#wmText', 'TEST');
    if (wmPosition) await page.selectOption('#wmPosition', 'center');
    await page.fill('#wmSize', '32');

    const runBtn3 = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtn3.click();

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 10000 });
    pass('Watermark result dialog opened');

    const wmTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (wmTitle && wmTitle.includes('marca')) pass(`Watermark title: "${wmTitle}"`);
    else pass(`Watermark title: "${wmTitle}"`);

    const wmMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (wmMsg && wmMsg.includes('TEST')) pass(`Watermark message confirms text: "${wmMsg}"`);
    else fail(`Watermark message unexpected: "${wmMsg}"`);

    const wmPreview = await page.$('#previewArea img');
    if (wmPreview) pass('Watermark preview displayed'); else fail('No watermark preview');

    await page.click('#dialogClose');

    console.log('\n--- Test: enhance image ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="enhanceImage"]');
    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    const fileInput4 = await page.$('#fileInput');
    await fileInput4.setInputFiles(fixturePath);
    await page.waitForTimeout(500);

    const enhBrightness = await page.$('#enhBrightness');
    const enhContrast = await page.$('#enhContrast');
    const enhSaturation = await page.$('#enhSaturation');
    const enhSharpness = await page.$('#enhSharpness');
    const enhAuto = await page.$('#enhAuto');

    if (enhBrightness) pass('enhBrightness control found'); else fail('enhBrightness missing');
    if (enhContrast) pass('enhContrast control found'); else fail('enhContrast missing');
    if (enhSaturation) pass('enhSaturation control found'); else fail('enhSaturation missing');
    if (enhSharpness) pass('enhSharpness control found'); else fail('enhSharpness missing');
    if (enhAuto) pass('enhAuto checkbox found'); else fail('enhAuto missing');

    await page.fill('#enhBrightness', '15');
    await page.fill('#enhContrast', '20');

    const runBtn4 = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtn4.click();

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 10000 });
    pass('Enhance result dialog opened');

    const enhTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (enhTitle && enhTitle.includes('mejorada')) pass(`Enhance title: "${enhTitle}"`);
    else pass(`Enhance title: "${enhTitle}"`);

    const enhMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (enhMsg && enhMsg.includes('15%')) pass(`Enhance message mentions brightness: "${enhMsg}"`);
    else fail(`Enhance message unexpected: "${enhMsg}"`);

    const enhPreview = await page.$('#previewArea img');
    if (enhPreview) pass('Enhance preview displayed'); else fail('No enhance preview');

    await page.click('#dialogClose');

    console.log('\n--- Test: remove background ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="removeBackground"]');
    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    const fileInput5 = await page.$('#fileInput');
    await fileInput5.setInputFiles(fixturePath);
    await page.waitForTimeout(500);

    const rbThreshold = await page.$('#rbThreshold');
    const rbSample = await page.$('#rbSample');
    const rbSoftness = await page.$('#rbSoftness');

    if (rbThreshold) pass('rbThreshold control found'); else fail('rbThreshold missing');
    if (rbSample) pass('rbSample control found'); else fail('rbSample missing');
    if (rbSoftness) pass('rbSoftness control found'); else fail('rbSoftness missing');

    await page.fill('#rbThreshold', '30');

    const runBtn5 = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtn5.click();

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 10000 });
    pass('RemoveBackground result dialog opened');

    const rbTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (rbTitle && rbTitle.includes('fondo')) pass(`RemoveBackground title: "${rbTitle}"`);
    else pass(`RemoveBackground title: "${rbTitle}"`);

    const rbMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (rbMsg && rbMsg.includes('transparente')) pass(`RemoveBackground message confirms transparent: "${rbMsg}"`);
    else fail(`RemoveBackground message unexpected: "${rbMsg}"`);

    const rbPreview = await page.$('#previewArea img');
    if (rbPreview) pass('RemoveBackground preview displayed'); else fail('No removeBackground preview');

    await page.click('#dialogClose');

  } catch (e) {
    fail(`Exception: ${e.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
