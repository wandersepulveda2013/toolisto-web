const { chromium } = require('playwright');
const path = require('path');
const BASE = 'http://localhost:8080';
const FIXTURES = path.resolve(__dirname, 'fixtures');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('ERR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGEERR:', err.message));

  await page.goto(BASE + '/comprimir-pdf.html', { waitUntil: 'networkidle' });
  const fi = await page.$('#fileInput');
  await fi.setInputFiles(path.join(FIXTURES, 'five-pages.pdf'));
  await page.waitForTimeout(500);
  await page.evaluate(() => { const el = document.getElementById('advancedPanel'); if (el) el.open = true; });
  await page.waitForTimeout(200);

  // Test embedPdf directly
  const result = await page.evaluate(async () => {
    try {
      const resp = await fetch('tests/fixtures/five-pages.pdf');
      const buf = await resp.arrayBuffer();
      const { PDFDocument } = window.PDFLib;
      const doc = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: false });
      console.log('Loaded doc, pages:', doc.getPageCount());
      const newPdf = await PDFDocument.create();
      console.log('embedPdf method exists:', typeof newPdf.embedPdf);
      const [embedded] = await newPdf.embedPdf(doc, [0]);
      console.log('Embedded OK, width:', embedded.width, 'height:', embedded.height);
      const pg = newPdf.addPage([595, 842]);
      pg.drawPage(embedded, { x: 0, y: 0, xScale: 0.5, yScale: 0.5 });
      const bytes = await newPdf.save();
      return { ok: true, size: bytes.byteLength };
    } catch(e) { return { ok: false, error: e.message, stack: e.stack?.substring(0, 500) }; }
  });
  console.log('embedPdf test:', JSON.stringify(result, null, 2));

  await browser.close();
})();
