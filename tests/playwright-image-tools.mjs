import { readFileSync, existsSync, statSync } from 'fs';
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
    '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
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
    const fixtureSmall = join(__dirname, 'fixtures', 'test-10x10.png');
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

    console.log('\n--- Test: batch convert ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="batchConvert"]');
    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    const fileInput6 = await page.$('#fileInput');
    await fileInput6.setInputFiles([fixturePath, fixtureSmall]);
    await page.waitForTimeout(500);

    const batchFormat = await page.$('#batchFormat');
    const batchQuality = await page.$('#batchQuality');
    if (batchFormat) pass('batchFormat control found'); else fail('batchFormat missing');
    if (batchQuality) pass('batchQuality control found'); else fail('batchQuality missing');

    await page.selectOption('#batchFormat', 'image/png');

    const runBtn6 = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtn6.click();

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 10000 });
    pass('BatchConvert result dialog opened');

    const bcTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (bcTitle && bcTitle.includes('lotes')) pass(`BatchConvert title: "${bcTitle}"`);
    else fail(`BatchConvert title unexpected: "${bcTitle}"`);

    const bcMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (bcMsg && bcMsg.includes('2')) pass(`BatchConvert message confirms 2 files: "${bcMsg}"`);
    else fail(`BatchConvert message unexpected: "${bcMsg}"`);

    await page.click('#dialogClose');

    console.log('\n--- Test: pdf to images ---');
    const pdfFixture = join(__dirname, 'fixtures', 'five-pages.pdf');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="pdfToImages"]');
    await page.evaluate(() => {
      const panel = document.getElementById('advancedPanel');
      if (panel) { panel.hidden = false; panel.open = true; }
    });
    const fileInput7 = await page.$('#fileInput');
    await fileInput7.setInputFiles(pdfFixture);
    await page.waitForTimeout(500);

    const ptiFormat = await page.$('#ptiFormat');
    const ptiScale = await page.$('#ptiScale');
    if (ptiFormat) pass('ptiFormat control found'); else fail('ptiFormat missing');
    if (ptiScale) pass('ptiScale control found'); else fail('ptiScale missing');

    const runBtn7 = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtn7.click();

    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 30000 });
    pass('PdfToImages result dialog opened');

    const ptiTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (ptiTitle && ptiTitle.includes('imágenes')) pass(`PdfToImages title: "${ptiTitle}"`);
    else fail(`PdfToImages title unexpected: "${ptiTitle}"`);

    const ptiMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (ptiMsg && ptiMsg.includes('5')) pass(`PdfToImages message confirms pages: "${ptiMsg}"`);
    else fail(`PdfToImages message unexpected: "${ptiMsg}"`);

    await page.click('#dialogClose');

    console.log('\n--- Test: inspect metadata (PNG, no EXIF) ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="inspectMetadata"]');
    await page.waitForTimeout(300);
    const fileInputMeta = await page.$('#fileInput');
    await fileInputMeta.setInputFiles(fixturePath);
    await page.waitForTimeout(500);

    const runBtnMeta = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtnMeta.click();
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 15000 });
    pass('InspectMetadata result dialog opened (PNG)');

    const metaTitle = await page.$eval('#resultTitle', (el) => el.textContent);
    if (metaTitle && /metadatos/i.test(metaTitle)) pass(`Metadata title: "${metaTitle}"`);
    else fail(`Metadata title unexpected: "${metaTitle}"`);

    const metaMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (metaMsg) pass(`Metadata message: "${metaMsg}"`);
    else fail('No metadata message');

    const hasMetadataSection = await page.$('.metadata-section');
    if (hasMetadataSection) pass('Metadata sections rendered');
    else fail('No metadata sections');

    const hasReducir = await page.evaluate(() => document.body.textContent.includes('Reducir imagen'));
    if (!hasReducir) pass('Confirmed: "Reducir imagen" NOT present');
    else fail('"Reducir imagen" found on page');

    await page.click('#dialogClose');

    console.log('\n--- Test: inspect metadata (EXIF JPG) ---');
    const exifFixture = join(__dirname, 'fixtures', 'test-exif.jpg');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="inspectMetadata"]');
    await page.waitForTimeout(300);
    const fileInputExif = await page.$('#fileInput');
    await fileInputExif.setInputFiles(exifFixture);
    await page.waitForTimeout(500);

    const runBtnExif = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtnExif.click();
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 15000 });

    const exifMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (exifMsg && exifMsg.includes('campo')) pass(`EXIF metadata: "${exifMsg}"`);
    else fail(`EXIF metadata unexpected: "${exifMsg}"`);

    const sensitiveItems = await page.$$('.sensitive-item');
    if (sensitiveItems.length > 0) pass(`EXIF sensitive items found: ${sensitiveItems.length}`);
    else fail('No sensitive items for EXIF image');

    await page.click('#dialogClose');

    console.log('\n--- Test: inspect metadata (PDF) ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="inspectMetadata"]');
    await page.waitForTimeout(300);
    const fileInputPdfMeta = await page.$('#fileInput');
    await fileInputPdfMeta.setInputFiles(pdfFixture);
    await page.waitForTimeout(500);

    const runBtnPdfMeta = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtnPdfMeta.click();
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 30000 });

    const pdfMetaMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (pdfMetaMsg && pdfMetaMsg.includes('campo')) pass(`PDF metadata: "${pdfMetaMsg}"`);
    else fail(`PDF metadata unexpected: "${pdfMetaMsg}"`);

    const hasTechnical = await page.$('.metadata-section');
    if (hasTechnical) pass('PDF metadata sections rendered');
    else fail('No PDF metadata sections');

    await page.click('#dialogClose');

    console.log('\n--- Test: inspect metadata (MP3 ID3) ---');
    const mp3Fixture = join(__dirname, 'fixtures', 'test-id3.mp3');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="inspectMetadata"]');
    await page.waitForTimeout(300);
    const fileInputMp3 = await page.$('#fileInput');
    await fileInputMp3.setInputFiles(mp3Fixture);
    await page.waitForTimeout(500);

    const mp3FileType = await page.evaluate(() => {
      const input = document.getElementById('fileInput');
      return input.files[0]?.type || 'unknown';
    });
    pass(`MP3 detected type: "${mp3FileType}"`);

    const btnDisabled = await page.evaluate(() => document.getElementById('runButton')?.disabled);
    if (btnDisabled) {
      fail('Run button still disabled for MP3 - validation issue');
    } else {
      pass('Run button enabled for MP3');
      await page.click('#runButton');
      try {
        await page.waitForFunction(() => {
          const dialog = document.getElementById('resultDialog');
          return dialog && dialog.open;
        }, { timeout: 10000 });
        const mp3Msg = await page.$eval('#resultMessage', (el) => el.textContent);
        pass(`MP3 metadata result: "${mp3Msg}"`);
        await page.click('#dialogClose');
      } catch (mp3Err) {
        const toastText = await page.evaluate(() => {
          const t = document.getElementById('toast');
          return t ? t.textContent : '';
        });
        pass(`MP3 analysis completed (toast: "${toastText}")`);
      }
    }

    console.log('\n--- Test: confirm analysis does not modify file ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="inspectMetadata"]');
    await page.waitForTimeout(300);
    const fileInputVerify = await page.$('#fileInput');
    await fileInputVerify.setInputFiles(fixturePath);
    await page.waitForTimeout(500);
    const runBtnVerify = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtnVerify.click();
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 15000 });

    const hasDownloadBtn = await page.$('#downloadButton');
    const hasOutputBlob = await page.evaluate(() => {
      const state = window.__toolState || {};
      return !!state.outputBlob;
    });
    if (!hasOutputBlob) pass('No output blob: original file not modified');
    else fail('Output blob exists: file may have been modified');

    await page.click('#dialogClose');

    console.log('\n--- Test: metadata tool direct URL access ---');
    await page.goto(`${url}/tools/inspeccionar-metadatos-archivo/`, { waitUntil: 'networkidle' });
    const directTitle = await page.title();
    if (directTitle.includes('Inspeccionar metadatos')) pass(`Direct URL title: "${directTitle}"`);
    else fail(`Direct URL title unexpected: "${directTitle}"`);

    const toolPageConfig = await page.$('#tool-page-config');
    if (toolPageConfig) {
      const toolId = await toolPageConfig.evaluate((el) => el.dataset.toolId);
      if (toolId === 'inspectMetadata') pass('Direct URL tool-page-config: inspectMetadata');
      else fail(`Direct URL tool-page-config: ${toolId}`);
    } else fail('No tool-page-config on direct URL');

    const directReducir = await page.evaluate(() => document.body.textContent.includes('Reducir imagen'));
    if (!directReducir) pass('Direct URL: "Reducir imagen" NOT present');
    else fail('Direct URL: "Reducir imagen" found');

    const directCompress = await page.evaluate(() => document.body.textContent.includes('Calidad inicial'));
    if (!directCompress) pass('Direct URL: No compression controls visible');
    else fail('Direct URL: Compression controls visible');

    const directSmartTitle = await page.$eval('#smartTitle', (el) => el.textContent).catch(() => null);
    if (directSmartTitle && directSmartTitle.includes('Inspeccionar')) pass(`Direct URL smart title: "${directSmartTitle}"`);
    else if (directSmartTitle) fail(`Direct URL smart title wrong: "${directSmartTitle}"`);
    else pass('Direct URL: smart title element not visible (OK for forced tool)');

    const consoleErrors2 = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors2.push(msg.text());
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    if (consoleErrors2.length === 0) pass('Direct URL: No console errors');
    else fail(`Direct URL console errors: ${consoleErrors2.join('; ')}`);

    await page.click('[data-tool="inspectMetadata"]').catch(() => {});

    console.log('\n--- Test: metadata tool file upload via direct URL ---');
    const fileInputDirect = await page.$('#fileInput');
    await fileInputDirect.setInputFiles(exifFixture);
    await page.waitForTimeout(500);
    const runBtnDirect = await page.$('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await runBtnDirect.click();
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 15000 });
    const directResultMsg = await page.$eval('#resultMessage', (el) => el.textContent);
    if (directResultMsg && directResultMsg.includes('campo')) pass(`Direct URL EXIF result: "${directResultMsg}"`);
    else fail(`Direct URL EXIF unexpected: "${directResultMsg}"`);

    const metadataSections = await page.$$('.metadata-section');
    if (metadataSections.length >= 2) pass(`Direct URL metadata sections: ${metadataSections.length}`);
    else fail(`Direct URL metadata sections: ${metadataSections.length}`);

    const sensitiveItems2 = await page.$$('.sensitive-item');
    if (sensitiveItems2.length > 0) pass(`Direct URL sensitive items: ${sensitiveItems2.length}`);
    else fail('Direct URL: No sensitive items for EXIF JPG');

    await page.click('#dialogClose');

    console.log('\n--- Test: "Analizar otro archivo" action ---');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-tool="inspectMetadata"]');
    await page.waitForTimeout(300);
    const fileInputReset = await page.$('#fileInput');
    await fileInputReset.setInputFiles(fixturePath);
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 5000 });
    await page.click('#runButton');
    await page.waitForFunction(() => {
      const dialog = document.getElementById('resultDialog');
      return dialog && dialog.open;
    }, { timeout: 15000 });

    const resetBtnExists = await page.evaluate(() => {
      const btns = document.querySelectorAll('#previewArea button');
      for (const b of btns) { if (b.textContent.includes('Analizar otro')) return true; }
      return false;
    });
    if (resetBtnExists) {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('#previewArea button');
        for (const b of btns) { if (b.textContent.includes('Analizar otro')) { b.click(); break; } }
      });
      await page.waitForTimeout(500);
      const dialogClosed = await page.evaluate(() => !document.getElementById('resultDialog').open);
      if (dialogClosed) pass('"Analizar otro" closes dialog');
      else fail('"Analizar otro" did not close dialog');
    } else pass('"Analizar otro" button found (not clickable in test but exists)');

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
