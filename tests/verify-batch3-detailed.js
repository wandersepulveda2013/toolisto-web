const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const { join } = require('path');
const BASE = 'http://localhost:8080';
const FIXTURES = join(__dirname, 'fixtures');
const PDF_PATH = join(FIXTURES, 'five-pages.pdf');

const tools = [
  { slug: 'dividir-paginas-dobles-pdf', toolId: 'splitDoublePdf', name: 'splitDoublePdf' },
  { slug: 'crear-cuadernillo-pdf',     toolId: 'bookletPdf',      name: 'bookletPdf' },
  { slug: 'agregar-marca-de-agua-pdf', toolId: 'watermarkPdf',    name: 'watermarkPdf' },
  { slug: 'numerar-paginas-pdf',       toolId: 'addPageNumbersPdf', name: 'addPageNumbersPdf' },
  { slug: 'encabezado-pie-pdf',        toolId: 'addHeaderFooterPdf', name: 'addHeaderFooterPdf' },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext();

  for (const t of tools) {
    console.log('\n=== ' + t.name + ' (' + t.slug + ') ===');
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);

    await page.goto(BASE + '/' + t.slug + '.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#runButton', { timeout: 5000 });

    const pageToolId = await page.evaluate(() => {
      const cfg = document.querySelector('.tool-page-config');
      return cfg ? cfg.dataset.toolId : 'none';
    });
    console.log('  toolId in page config: ' + pageToolId);

    const fileInput = await page.$('#fileInput');
    await fileInput.setInputFiles(PDF_PATH);
    await page.waitForTimeout(500);

    const runEnabled = await page.evaluate(() => !document.getElementById('runButton').disabled);
    console.log('  run button enabled: ' + runEnabled);

    const selectedTool = await page.evaluate(() => window.__selectedTool || 'N/A');
    console.log('  window.__selectedTool: ' + selectedTool);

    // Intercept downloadResult to capture the blob
    await page.evaluate(() => {
      window.__capturedBlobs = [];
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function(blob) {
        window.__capturedBlobs.push(blob);
        return origCreateObjectURL.call(URL, blob);
      };
    });

    await page.click('#runButton');
    try {
      await page.waitForSelector('#resultDialog[open]', { timeout: 30000 });
    } catch (e) {
      console.log('  DIALOG DID NOT OPEN in 30s');
      await page.close();
      continue;
    }

    const result = await page.evaluate(() => {
      return {
        title: document.getElementById('resultTitle') ? document.getElementById('resultTitle').textContent : '',
        message: document.getElementById('resultMessage') ? document.getElementById('resultMessage').textContent : '',
        hasDownload: !!document.getElementById('downloadButton'),
      };
    });
    console.log('  dialog.title: ' + result.title);
    console.log('  dialog.message: ' + result.message);
    console.log('  dialog.hasDownload: ' + result.hasDownload);

    // Verify the captured output blob
    const blobInfo = await page.evaluate(async () => {
      const blobs = window.__capturedBlobs;
      if (!blobs || blobs.length === 0) return { found: false };
      const blob = blobs[blobs.length - 1];
      const arrBuf = await blob.arrayBuffer();
      const arr = new Uint8Array(arrBuf);
      const { PDFDocument } = window.PDFLib;
      try {
        const doc = await PDFDocument.load(arr);
        return {
          found: true,
          blobType: blob.type,
          byteLength: arr.length,
          pageCount: doc.getPageCount(),
          reOpenOk: true
        };
      } catch (e) {
        return {
          found: true,
          blobType: blob.type,
          byteLength: arr.length,
          reOpenOk: false,
          error: e.message
        };
      }
    });
    if (blobInfo.found) {
      console.log('  output blob.type: ' + blobInfo.blobType);
      console.log('  output byteLength: ' + blobInfo.byteLength);
      console.log('  PDFDocument.load() re-open: ' + (blobInfo.reOpenOk ? 'OK' : 'FAIL - ' + blobInfo.error));
      if (blobInfo.reOpenOk) {
        console.log('  getPageCount() AFTER: ' + blobInfo.pageCount);
      }
    } else {
      console.log('  NO BLOB CAPTURED');
    }

    await page.close();
  }

  await browser.close();
  console.log('\n=== DONE ===');
})();
