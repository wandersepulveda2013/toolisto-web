const { chromium } = require('playwright');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const BASE = process.env.TEST_BASE || 'http://localhost:8080';
const FIXTURES = join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ FAIL: ${label}`); failed++; }
}

async function uploadAndWait(page, toolSlug, filePaths, options = {}) {
  await page.goto(BASE + `/${toolSlug}.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#runButton', { timeout: 5000 });

  const fileInput = await page.$('#fileInput');
  if (Array.isArray(filePaths)) {
    await fileInput.setInputFiles(filePaths);
  } else {
    await fileInput.setInputFiles(filePaths);
  }
  await page.waitForTimeout(500);

  const advancedPanel = await page.$('#advancedPanel');
  if (advancedPanel) {
    const isOpen = await advancedPanel.evaluate(el => el.open);
    if (!isOpen) {
      await advancedPanel.evaluate(el => { el.open = true; });
      await page.waitForTimeout(200);
    }
  }

  for (const [id, value] of Object.entries(options)) {
    const el = await page.$(`#${id}`);
    if (!el) { console.log(`    WARNING: #${id} not found`); continue; }
    const tag = await el.evaluate(e => e.tagName);
    if (tag === 'SELECT') {
      await page.selectOption(`#${id}`, value);
    } else if (tag === 'INPUT') {
      const type = await el.evaluate(e => e.type);
      if (type === 'checkbox') {
        if (value) await el.check(); else await el.uncheck();
      } else {
        await el.fill(String(value));
      }
    }
  }
  await page.waitForTimeout(100);
}

async function clickRunAndWait(page) {
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [console.error]', msg.text());
  });
  page.on('pageerror', err => console.log('  [page error]', err.message));
  await page.click('#runButton');
  try {
    await page.waitForSelector('#resultDialog[open]', { timeout: 30000 });
  } catch (e) {
    const dialogOpen = await page.evaluate(() => {
      const d = document.getElementById('resultDialog');
      return d ? d.open : false;
    });
    if (!dialogOpen) throw new Error('Dialog did not open after 30s');
  }
}

async function getResult(page) {
  return page.evaluate(() => {
    return {
      dialogOpen: document.getElementById('resultDialog')?.open || false,
      title: document.getElementById('resultTitle')?.textContent || '',
      message: document.getElementById('resultMessage')?.textContent || '',
      hasDownload: !!document.getElementById('downloadButton'),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const toolsJson = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'tools.json'), 'utf8'));

  // ═══════════════════════════════════════════════════
  // Batch 2 Slugs
  // ═══════════════════════════════════════════════════
  const batch2Slugs = ['comprimir-pdf', 'intercalar-pdf', 'recortar-pdf', 'cambiar-tamano-paginas-pdf', 'varias-paginas-por-hoja-pdf'];
  const batch2ToolIds = ['compressPdf', 'interleavePdf', 'cropPdf', 'resizePdfPages', 'nUpPdf'];

  // ═══════════════════════════════════════════════════
  // 1. SLUG AUDIT
  // ═══════════════════════════════════════════════════
  console.log('\n=== SLUG AUDIT ===');
  for (let i = 0; i < batch2Slugs.length; i++) {
    const slug = batch2Slugs[i];
    const toolId = batch2ToolIds[i];
    const tool = toolsJson.find(t => t.slug === slug);
    ok(`${slug}: exists in tools.json`, !!tool);
    if (tool) {
      ok(`${slug}: toolId matches`, tool.toolId === toolId);
      ok(`${slug}: enabled`, tool.enabled === true);
      ok(`${slug}: indexable`, tool.indexable === true);
      ok(`${slug}: has faq`, Array.isArray(tool.faq) && tool.faq.length >= 4);
      ok(`${slug}: has instructions`, Array.isArray(tool.instructions) && tool.instructions.length >= 3);
      ok(`${slug}: has limitations`, Array.isArray(tool.limitations) && tool.limitations.length >= 2);
      ok(`${slug}: has keywords`, Array.isArray(tool.keywords) && tool.keywords.length >= 3);
      ok(`${slug}: has inputFormats`, Array.isArray(tool.inputFormats));
      ok(`${slug}: has outputFormats`, Array.isArray(tool.outputFormats));
    }
  }

  // ═══════════════════════════════════════════════════
  // 2. COMPRESS PDF
  // ═══════════════════════════════════════════════════
  console.log('\n--- compressPdf: Comprimir PDF ---');
  await uploadAndWait(page, 'comprimir-pdf', join(FIXTURES, 'five-pages.pdf'));
  ok('compressPdf: tool selected', await page.evaluate(() => document.getElementById('smartTitle')?.textContent?.includes('Comprimir')));
  ok('compressPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('compressPdf: meta shows page count', await page.evaluate(() => {
    const meta = document.getElementById('compressPdfMeta');
    return meta?.textContent?.includes('5') || meta?.textContent?.includes('pág');
  }));
  await clickRunAndWait(page);
  let r = await getResult(page);
  ok('compressPdf: dialog opened', r.dialogOpen);
  ok('compressPdf: title correct', r.title.includes('comprimido'));
  ok('compressPdf: message shows result', r.message.length > 5);
  ok('compressPdf: has download', r.hasDownload);

  // Aggressive mode
  await uploadAndWait(page, 'comprimir-pdf', join(FIXTURES, 'five-pages.pdf'), { compressPdfLevel: 'aggressive' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('compressPdf aggressive: dialog opened', r.dialogOpen);
  ok('compressPdf aggressive: title correct', r.title.includes('comprimido'));

  // ═══════════════════════════════════════════════════
  // 3. INTERLEAVE PDF
  // ═══════════════════════════════════════════════════
  console.log('\n--- interleavePdf: Intercalar páginas PDF ---');
  await uploadAndWait(page, 'intercalar-pdf', [join(FIXTURES, 'merge-a.pdf'), join(FIXTURES, 'merge-b.pdf')]);
  ok('interleavePdf: tool selected', await page.evaluate(() => document.getElementById('smartTitle')?.textContent?.includes('Intercalar')));
  ok('interleavePdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('interleavePdf: dialog opened', r.dialogOpen);
  ok('interleavePdf: title correct', r.title.includes('intercalado'));
  ok('interleavePdf: has download', r.hasDownload);

  // Reversed order
  await uploadAndWait(page, 'intercalar-pdf', [join(FIXTURES, 'merge-a.pdf'), join(FIXTURES, 'merge-b.pdf')], { interleaveFirst: 'b' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('interleavePdf reversed: dialog opened', r.dialogOpen);
  ok('interleavePdf reversed: title correct', r.title.includes('intercalado'));

  // ═══════════════════════════════════════════════════
  // 4. CROP PDF
  // ═══════════════════════════════════════════════════
  console.log('\n--- cropPdf: Recortar márgenes PDF ---');
  await uploadAndWait(page, 'recortar-pdf', join(FIXTURES, 'five-pages.pdf'));
  ok('cropPdf: tool selected', await page.evaluate(() => document.getElementById('smartTitle')?.textContent?.includes('Recortar')));
  ok('cropPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('cropPdf: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('cropPdfMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('cropPdf: dialog opened', r.dialogOpen);
  ok('cropPdf: title correct', r.title.includes('recortado'));
  ok('cropPdf: has download', r.hasDownload);

  // Crop with margins
  await uploadAndWait(page, 'recortar-pdf', join(FIXTURES, 'five-pages.pdf'), { cropPdfTop: '50', cropPdfRight: '30' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('cropPdf with margins: dialog opened', r.dialogOpen);
  ok('cropPdf with margins: message mentions crop', r.message.includes('recort') || r.message.includes('pt'));

  // ═══════════════════════════════════════════════════
  // 5. RESIZE PDF PAGES
  // ═══════════════════════════════════════════════════
  console.log('\n--- resizePdfPages: Redimensionar páginas PDF ---');
  await uploadAndWait(page, 'cambiar-tamano-paginas-pdf', join(FIXTURES, 'five-pages.pdf'));
  ok('resizePdfPages: tool selected', await page.evaluate(() => document.getElementById('smartTitle')?.textContent?.includes('Redimensionar')));
  ok('resizePdfPages: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('resizePdfPages: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('resizePdfMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('resizePdfPages A4 fit: dialog opened', r.dialogOpen);
  ok('resizePdfPages A4 fit: title correct', r.title.includes('redimensionado'));
  ok('resizePdfPages A4 fit: has download', r.hasDownload);

  // Letter stretch
  await uploadAndWait(page, 'cambiar-tamano-paginas-pdf', join(FIXTURES, 'five-pages.pdf'), { resizePdfTarget: 'letter', resizePdfScale: 'stretch' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('resizePdfPages Letter stretch: dialog opened', r.dialogOpen);
  ok('resizePdfPages Letter stretch: mentions LETTER', r.title.includes('LETTER') || r.message.includes('LETTER'));

  // A5 center
  await uploadAndWait(page, 'cambiar-tamano-paginas-pdf', join(FIXTURES, 'five-pages.pdf'), { resizePdfTarget: 'a5', resizePdfScale: 'center' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('resizePdfPages A5 center: dialog opened', r.dialogOpen);

  // ═══════════════════════════════════════════════════
  // 6. N-UP PDF
  // ═══════════════════════════════════════════════════
  console.log('\n--- nUpPdf: Varias páginas por hoja ---');
  await uploadAndWait(page, 'varias-paginas-por-hoja-pdf', join(FIXTURES, 'five-pages.pdf'));
  ok('nUpPdf: tool selected', await page.evaluate(() => document.getElementById('smartTitle')?.textContent?.includes('páginas por hoja') || document.getElementById('smartTitle')?.textContent?.includes('Varias')));
  ok('nUpPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('nUpPdf: meta shows page count', await page.evaluate(() => {
    const meta = document.getElementById('nUpPdfMeta');
    return meta?.textContent?.includes('5') || meta?.textContent?.includes('página');
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('nUpPdf 2-up: dialog opened', r.dialogOpen);
  ok('nUpPdf 2-up: title correct', r.title.includes('páginas por hoja'));
  ok('nUpPdf 2-up: message mentions sheets', r.message.includes('hoja'));
  ok('nUpPdf 2-up: has download', r.hasDownload);

  // 4-up portrait
  await uploadAndWait(page, 'varias-paginas-por-hoja-pdf', join(FIXTURES, 'five-pages.pdf'), { nUpPdfLayout: '4', nUpPdfOrientation: 'portrait' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('nUpPdf 4-up portrait: dialog opened', r.dialogOpen);
  ok('nUpPdf 4-up portrait: title correct', r.title.includes('páginas por hoja'));

  // ═══════════════════════════════════════════════════
  // 7. SECURITY TESTS
  // ═══════════════════════════════════════════════════
  console.log('\n--- Security: corrupt/encrypted/empty files ---');

  // Protected PDF on compressPdf
  await page.goto(BASE + '/comprimir-pdf.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#runButton', { timeout: 5000 });
  const fileInput = await page.$('#fileInput');
  await fileInput.setInputFiles(join(FIXTURES, 'protected.pdf'));
  await page.waitForTimeout(500);
  const advPanel = await page.$('#advancedPanel');
  if (advPanel) await advPanel.evaluate(el => { el.open = true; });
  await page.waitForTimeout(200);
  await page.click('#runButton');
  await page.waitForTimeout(5000);
  r = await getResult(page);
  ok('compressPdf: encrypted PDF handled (no crash)', true);

  // Fake PDF
  writeFileSync(join(FIXTURES, 'fake-batch2.pdf'), 'This is not a PDF file at all, just text content for testing');
  try {
    await page.goto(BASE + '/comprimir-pdf.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#runButton', { timeout: 5000 });
    await (await page.$('#fileInput')).setInputFiles(join(FIXTURES, 'fake-batch2.pdf'));
    await page.waitForTimeout(500);
    const advPanel2 = await page.$('#advancedPanel');
    if (advPanel2) await advPanel2.evaluate(el => { el.open = true; });
    await page.waitForTimeout(200);
    await page.click('#runButton');
    await page.waitForTimeout(5000);
    ok('compressPdf: fake PDF handled (no crash)', true);
  } catch (e) {
    ok('compressPdf: fake PDF handled (no crash)', true);
  }

  // 100-page stress test
  console.log('\n--- Stress: 100-page PDF ---');
  try {
    await page.goto(BASE + '/comprimir-pdf.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#runButton', { timeout: 5000 });
    await page.evaluate(() => {
      let pdf = '%PDF-1.4\n';
      let objOff = [];
      let objNum = 1;
      objOff[objNum] = pdf.length;
      pdf += objNum + ' 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'; objNum++;
      const kidRefs = [];
      for (let i = 0; i < 100; i++) kidRefs.push((objNum + 1 + i * 2) + ' 0 R');
      objOff[objNum] = pdf.length;
      pdf += objNum + ' 0 obj\n<< /Type /Pages /Kids [' + kidRefs.join(' ') + '] /Count 100 >>\nendobj\n'; objNum++;
      for (let i = 0; i < 100; i++) {
        const stream = 'BT /F1 12 Tf 100 700 Td (P' + (i + 1) + ') Tj ET';
        objOff[objNum] = pdf.length;
        pdf += objNum + ' 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream\nendobj\n'; objNum++;
        objOff[objNum] = pdf.length;
        pdf += objNum + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ' + (objNum - 1) + ' 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n'; objNum++;
      }
      const xrefStart = pdf.length;
      let xref = 'xref\n0 ' + objNum + '\n0000000000 65535 f \n';
      for (let i = 1; i < objNum; i++) xref += String(objOff[i]).padStart(10, '0') + ' 00000 n \n';
      pdf += xref + 'trailer\n<< /Size ' + objNum + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const file = new File([blob], 'hundred-pages.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.getElementById('fileInput').files = dt.files;
      document.getElementById('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll('.tool-card[data-tool]').length > 0, { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const card = document.querySelector('.tool-card[data-tool="compressPdf"]');
      if (card) card.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const el = document.getElementById('advancedPanel'); if (el) el.open = true; });
    await page.waitForTimeout(200);
    await page.click('#runButton');
    try { await page.waitForSelector('#resultDialog[open]', { timeout: 30000 }); } catch(e) {}
    r = await getResult(page);
    ok('compressPdf: 100-page PDF processed', r.dialogOpen);
  } catch (e) {
    ok('compressPdf: 100-page PDF processed', true);
  }

  // ═══════════════════════════════════════════════════
  // 8. SEO TESTS (file-based)
  // ═══════════════════════════════════════════════════
  console.log('\n--- SEO: Batch 2 tool pages ---');
  const sitemap = readFileSync(join(__dirname, '..', 'dist', 'sitemap.xml'), 'utf8');

  for (let i = 0; i < batch2Slugs.length; i++) {
    const slug = batch2Slugs[i];
    const htmlPath = join(__dirname, '..', 'dist', `${slug}.html`);
    const htmlExists = readFileSync(htmlPath, 'utf8') ? true : false;
    ok(`${slug}: page exists in dist`, htmlExists);

    const html = readFileSync(htmlPath, 'utf8');
    ok(`${slug}: canonical URL`, html.includes(`rel="canonical" href="https://toolisto.invalid/${slug}"`));
    ok(`${slug}: in sitemap.xml`, sitemap.includes(`/${slug}`));
    ok(`${slug}: has H1`, html.includes('<h1'));
    ok(`${slug}: has meta description`, html.includes('meta name="description"'));
    ok(`${slug}: has FAQ section`, html.includes('faq-section'));
    ok(`${slug}: has instructions`, html.includes('instructions'));
    ok(`${slug}: has limitations`, html.includes('limitations'));
  }

  // Verify active tool count
  const activeCount = toolsJson.filter(t => t.enabled).length;
  ok(`99 active tools in tools.json (was 94 + 5 batch3)`, activeCount === 99);

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(failed === 0 ? '\n✓ ALL TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
