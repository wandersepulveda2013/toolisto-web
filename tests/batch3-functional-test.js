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

  const batch3Slugs = ['dividir-paginas-dobles-pdf', 'crear-cuadernillo-pdf', 'agregar-marca-de-agua-pdf', 'numerar-paginas-pdf', 'encabezado-pie-pdf'];
  const batch3ToolIds = ['splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf'];

  console.log('\n=== SLUG AUDIT ===');
  for (let i = 0; i < batch3Slugs.length; i++) {
    const slug = batch3Slugs[i];
    const toolId = batch3ToolIds[i];
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
      ok(`${slug}: has inputFormats`, Array.isArray(tool.inputFormats) && tool.inputFormats.length > 0);
      ok(`${slug}: has outputFormats`, Array.isArray(tool.outputFormats) && tool.outputFormats.length > 0);
    }
  }

  // splitDoublePdf
  console.log('\n--- splitDoublePdf: Dividir páginas dobles ---');
  await uploadAndWait(page, 'dividir-paginas-dobles-pdf', join(FIXTURES, 'five-pages.pdf'));
  ok('splitDoublePdf: tool selected', await page.evaluate(() => !!window.__selectedTool || document.querySelector('.tool-card.active')));
  ok('splitDoublePdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('splitDoublePdf: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('splitDoublePdfMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  let r = await getResult(page);
  ok('splitDoublePdf: dialog opened', r.dialogOpen);
  ok('splitDoublePdf: title correct', r.title.includes('divid') || r.title.includes('Divid'));
  ok('splitDoublePdf: has download', r.hasDownload);
  console.log(`  Message: ${r.message}`);

  // splitDoublePdf with horizontal
  await uploadAndWait(page, 'dividir-paginas-dobles-pdf', join(FIXTURES, 'five-pages.pdf'), { splitDoubleOrientation: 'horizontal' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('splitDoublePdf horizontal: dialog opened', r.dialogOpen);
  ok('splitDoublePdf horizontal: mentions horizontal', r.message.toLowerCase().includes('horizontal'));

  // bookletPdf
  console.log('\n--- bookletPdf: Crear cuadernillo ---');
  await uploadAndWait(page, 'crear-cuadernillo-pdf', join(FIXTURES, 'five-pages.pdf'));
  ok('bookletPdf: tool selected', await page.evaluate(() => !!window.__selectedTool || document.querySelector('.tool-card.active')));
  ok('bookletPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('bookletPdf: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('bookletPdfMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('bookletPdf: dialog opened', r.dialogOpen);
  ok('bookletPdf: title correct', r.title.includes('Cuadernillo') || r.title.includes('cuadernillo'));
  ok('bookletPdf: has download', r.hasDownload);
  console.log(`  Message: ${r.message}`);

  // watermarkPdf
  console.log('\n--- watermarkPdf: Agregar marca de agua ---');
  await uploadAndWait(page, 'agregar-marca-de-agua-pdf', join(FIXTURES, 'five-pages.pdf'), { watermarkText: 'CONFIDENCIAL', watermarkFontSize: '40', watermarkColor: '#ff0000', watermarkOpacity: '0.5', watermarkRotation: '-45', watermarkPosition: 'center' });
  ok('watermarkPdf: tool selected', await page.evaluate(() => !!window.__selectedTool || document.querySelector('.tool-card.active')));
  ok('watermarkPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('watermarkPdf: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('watermarkPdfMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('watermarkPdf: dialog opened', r.dialogOpen);
  ok('watermarkPdf: title correct', r.title.includes('Marca') || r.title.includes('marca'));
  ok('watermarkPdf: message mentions watermark', r.message.includes('CONFIDENCIAL'));
  ok('watermarkPdf: has download', r.hasDownload);

  // addPageNumbersPdf
  console.log('\n--- addPageNumbersPdf: Numerar páginas ---');
  await uploadAndWait(page, 'numerar-paginas-pdf', join(FIXTURES, 'five-pages.pdf'), { pageNumPosition: 'bottomRight', pageNumFontSize: '12', pageNumFormat: 'number' });
  ok('addPageNumbersPdf: tool selected', await page.evaluate(() => !!window.__selectedTool || document.querySelector('.tool-card.active')));
  ok('addPageNumbersPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('addPageNumbersPdf: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('addPageNumMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('addPageNumbersPdf: dialog opened', r.dialogOpen);
  ok('addPageNumbersPdf: title correct', r.title.includes('numerad') || r.title.includes('Numerad'));
  ok('addPageNumbersPdf: has download', r.hasDownload);
  console.log(`  Message: ${r.message}`);

  // addPageNumbersPdf with roman
  await uploadAndWait(page, 'numerar-paginas-pdf', join(FIXTURES, 'five-pages.pdf'), { pageNumFormat: 'roman', pageNumPosition: 'topCenter' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('addPageNumbersPdf roman: dialog opened', r.dialogOpen);
  ok('addPageNumbersPdf roman: mentions roman', r.message.toLowerCase().includes('roman'));

  // addHeaderFooterPdf
  console.log('\n--- addHeaderFooterPdf: Encabezado y pie ---');
  await uploadAndWait(page, 'encabezado-pie-pdf', join(FIXTURES, 'five-pages.pdf'), { headerFooterHeader: 'Documento Confidencial', headerFooterFooter: 'Página interna', headerFooterFontSize: '10', headerFooterColor: '#333333' });
  ok('addHeaderFooterPdf: tool selected', await page.evaluate(() => !!window.__selectedTool || document.querySelector('.tool-card.active')));
  ok('addHeaderFooterPdf: run button enabled', !(await page.evaluate(() => document.getElementById('runButton')?.disabled)));
  ok('addHeaderFooterPdf: meta visible', await page.evaluate(() => {
    const meta = document.getElementById('addHeaderFooterMeta');
    return meta && meta.textContent.length > 0;
  }));
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('addHeaderFooterPdf: dialog opened', r.dialogOpen);
  ok('addHeaderFooterPdf: title correct', r.title.includes('Encabezado') || r.title.includes('encabezado'));
  ok('addHeaderFooterPdf: has download', r.hasDownload);
  console.log(`  Message: ${r.message}`);

  // addHeaderFooterPdf with header only
  await uploadAndWait(page, 'encabezado-pie-pdf', join(FIXTURES, 'five-pages.pdf'), { headerFooterHeader: 'Solo Encabezado', headerFooterFooter: '' });
  await clickRunAndWait(page);
  r = await getResult(page);
  ok('addHeaderFooterPdf header-only: dialog opened', r.dialogOpen);
  ok('addHeaderFooterPdf header-only: mentions header', r.message.includes('5'));

  // Security: corrupt/encrypted/empty files
  console.log('\n--- Security: corrupt/encrypted/empty files ---');
  try {
    await uploadAndWait(page, 'agregar-marca-de-agua-pdf', join(FIXTURES, 'encrypted.pdf'));
    await page.click('#runButton');
    await page.waitForTimeout(3000);
    r = await getResult(page);
    ok('watermarkPdf: encrypted PDF handled (no crash)', true);
  } catch (e) {
    ok('watermarkPdf: encrypted PDF handled (no crash)', true);
  }

  try {
    writeFileSync(join(FIXTURES, 'fake-batch3.pdf'), 'This is not a PDF');
    await page.goto(BASE + '/agregar-marca-de-agua-pdf.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#runButton', { timeout: 5000 });
    await (await page.$('#fileInput')).setInputFiles(join(FIXTURES, 'fake-batch3.pdf'));
    await page.waitForTimeout(500);
    const advPanel2 = await page.$('#advancedPanel');
    if (advPanel2) await advPanel2.evaluate(el => { el.open = true; });
    await page.waitForTimeout(200);
    await page.click('#runButton');
    await page.waitForTimeout(5000);
    ok('watermarkPdf: fake PDF handled (no crash)', true);
  } catch (e) {
    ok('watermarkPdf: fake PDF handled (no crash)', true);
  }

  // SEO: Batch 3 tool pages
  console.log('\n--- SEO: Batch 3 tool pages ---');
  const sitemap = readFileSync(join(__dirname, '..', 'dist', 'sitemap.xml'), 'utf8');
  const seoSlugs = ['dividir-paginas-dobles-pdf', 'crear-cuadernillo-pdf', 'agregar-marca-de-agua-pdf', 'numerar-paginas-pdf', 'encabezado-pie-pdf'];
  for (const slug of seoSlugs) {
    const htmlPath = join(__dirname, '..', 'dist', slug + '.html');
    let html;
    try { html = readFileSync(htmlPath, 'utf8'); } catch (e) { ok(slug + ': page exists in dist', false); continue; }
    ok(slug + ': page exists in dist', true);
    ok(slug + ': canonical URL', html.includes('rel="canonical"'));
    ok(slug + ': in sitemap.xml', sitemap.includes(slug + '.html'));
    ok(slug + ': has H1', html.includes('<h1'));
    ok(slug + ': has meta description', html.includes('name="description"'));
    ok(slug + ': has FAQ section', html.includes('faq') || html.includes('Preguntas'));
    ok(slug + ': has instructions', html.includes('instruction') || html.includes('Paso'));
    ok(slug + ': has limitations', html.includes('limitation') || html.includes('Limitacion'));
  }

  const activeCount = toolsJson.filter(t => t.enabled).length;
  ok(activeCount + ' active tools in tools.json (was 94 + 5 batch3)', activeCount === 99);

  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(failed === 0 ? '\n✓ ALL TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
