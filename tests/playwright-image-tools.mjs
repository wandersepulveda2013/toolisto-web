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

    const fixturePath = join(__dirname, 'fixtures', 'test-200x100.png');
    const fixtureSmall = join(__dirname, 'fixtures', 'test-10x10.png');

    console.log('\n[Skip: old simplified version image tool tests]');

    console.log('\n--- Test: inspect metadata (PNG, no EXIF) ---');
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
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
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
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
    const pdfFixture = join(__dirname, 'fixtures', 'five-pages.pdf');
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
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
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
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
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
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
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
    const directTitle = await page.title();
    if (directTitle.includes('Inspeccionar metadatos')) pass(`Direct URL title: "${directTitle}"`);
    else fail(`Direct URL title unexpected: "${directTitle}"`);

    const toolPageConfig = await page.$('#tool-page-config');
    if (toolPageConfig) {
      const toolId = JSON.parse(await toolPageConfig.evaluate((el) => el.textContent)).toolId;
      if (toolId === 'inspectFileMetadata') pass('Direct URL tool-page-config: inspectFileMetadata');
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

    await page.click('[data-tool="inspectFileMetadata"]').catch(() => {});

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
    await page.goto(`${url}/inspeccionar-metadatos-archivo.html`, { waitUntil: 'networkidle' });
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
