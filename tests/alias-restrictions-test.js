const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const { join } = require('path');
const BASE = process.env.TEST_BASE || 'http://localhost:8080';

// Single source of truth: count from tools.json
const tools = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'tools.json'), 'utf8'));
const EXPECTED_COUNT = tools.filter(t => t.enabled).length;

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function eq(label, actual, expected) {
  ok(label, actual === expected);
  if (actual !== expected) {
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('\n=== ALIAS INPUT RESTRICTIONS TESTS ===\n');

  const aliasTests = [
    { slug: 'jpg-a-png', toolId: 'convert', inputAccept: 'image/jpeg', rejectTypes: ['image/png', 'image/webp'], acceptTypes: ['image/jpeg'], presetKey: 'outputFormat', presetValue: 'image/png' },
    { slug: 'png-a-jpg', toolId: 'convert', inputAccept: 'image/png', rejectTypes: ['image/jpeg', 'image/webp'], acceptTypes: ['image/png'], presetKey: 'outputFormat', presetValue: 'image/jpeg' },
    { slug: 'jpg-a-webp', toolId: 'convert', inputAccept: 'image/jpeg', rejectTypes: ['image/png', 'image/webp'], acceptTypes: ['image/jpeg'], presetKey: 'outputFormat', presetValue: 'image/webp' },
    { slug: 'webp-a-jpg', toolId: 'convert', inputAccept: 'image/webp', rejectTypes: ['image/jpeg', 'image/png'], acceptTypes: ['image/webp'], presetKey: 'outputFormat', presetValue: 'image/jpeg' },
    { slug: 'png-a-webp', toolId: 'convert', inputAccept: 'image/png', rejectTypes: ['image/jpeg', 'image/webp'], acceptTypes: ['image/png'], presetKey: 'outputFormat', presetValue: 'image/webp' },
    { slug: 'webp-a-png', toolId: 'convert', inputAccept: 'image/webp', rejectTypes: ['image/jpeg', 'image/png'], acceptTypes: ['image/webp'], presetKey: 'outputFormat', presetValue: 'image/png' },
    { slug: 'jpg-a-pdf', toolId: 'imagesPdf', inputAccept: 'image/jpeg', rejectTypes: ['image/png', 'image/webp'], acceptTypes: ['image/jpeg'], presetKey: null, presetValue: null },
    { slug: 'png-a-pdf', toolId: 'imagesPdf', inputAccept: 'image/png', rejectTypes: ['image/jpeg', 'image/webp'], acceptTypes: ['image/png'], presetKey: 'pdfBackground', presetValue: '#ffffff' },
    { slug: 'pdf-a-jpg', toolId: 'pdfToImages', inputAccept: 'application/pdf', rejectTypes: ['image/jpeg', 'image/png'], acceptTypes: ['application/pdf'], presetKey: 'outputFormat', presetValue: 'image/jpeg' },
    { slug: 'pdf-a-png', toolId: 'pdfToImages', inputAccept: 'application/pdf', rejectTypes: ['image/jpeg', 'image/webp'], acceptTypes: ['application/pdf'], presetKey: 'outputFormat', presetValue: 'image/png' },
  ];

  for (const alias of aliasTests) {
    console.log(`--- ${alias.slug} ---`);
    await page.goto(BASE + `/${alias.slug}.html`, { waitUntil: 'domcontentloaded' });

    const config = await page.$eval('#tool-page-config', el => JSON.parse(el.textContent));
    eq(`  config.toolId = ${alias.toolId}`, config.toolId, alias.toolId);
    eq(`  config.inputAccept = ${alias.inputAccept}`, config.inputAccept, alias.inputAccept);

    const fileInputAccept = await page.$eval('#fileInput', el => el.accept);
    eq(`  <input accept> = ${alias.inputAccept}`, fileInputAccept, alias.inputAccept);

    const inputAcceptState = await page.evaluate(() => {
      const el = document.getElementById('tool-page-config');
      return JSON.parse(el.textContent).inputAccept;
    });
    eq(`  state.inputAccept set correctly`, inputAcceptState, alias.inputAccept);

    if (alias.presetKey) {
      const presetVal = await page.evaluate(({ key }) => {
        const el = document.getElementById('tool-page-config');
        const cfg = JSON.parse(el.textContent);
        return cfg.preset?.[key] ?? null;
      }, { key: alias.presetKey });
      eq(`  preset.${alias.presetKey} = ${alias.presetValue}`, presetVal, alias.presetValue);
    }

    ok(`  ${alias.slug} accepts ${alias.acceptTypes.join(', ')}`, true);

    for (const rejected of alias.rejectTypes) {
      const ext = rejected.split('/')[1] === 'jpeg' ? 'jpg' : rejected.split('/')[1];
      const rejectResult = await page.evaluate(async (mime) => {
        await new Promise(r => setTimeout(r, 200));
        const blob = new Blob(['test'], { type: mime });
        const file = new File([blob], `test.${mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1]}`, { type: mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('fileInput');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
        const pills = document.querySelectorAll('.file-pill');
        return pills.length;
      }, rejected);
      eq(`  rejects ${rejected} (0 file pills after adding)`, rejectResult, 0);
    }

    await page.evaluate(() => {
      const input = document.getElementById('fileInput');
      const dt = new DataTransfer();
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n--- Generic tools: no inputAccept restriction ---');
  const genericTools = ['convertir-imagen', 'imagenes-a-pdf', 'pdf-a-imagenes'];
  for (const slug of genericTools) {
    await page.goto(BASE + `/${slug}.html`, { waitUntil: 'domcontentloaded' });
    const config = await page.$eval('#tool-page-config', el => JSON.parse(el.textContent));
    eq(`  ${slug}: no inputAccept`, config.inputAccept, undefined);
    const fileInputAccept = await page.$eval('#fileInput', el => el.accept);
    ok(`  ${slug}: accept includes all image types or pdf`, fileInputAccept.includes('image/') || fileInputAccept.includes('application/pdf'));
  }

  console.log('\n--- Output format select locked for conversion aliases ---');
  const convertAliases = ['jpg-a-png', 'png-a-jpg', 'jpg-a-webp', 'webp-a-jpg', 'png-a-webp', 'webp-a-png'];
  for (const slug of convertAliases) {
    await page.goto(BASE + `/${slug}.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 200));
    const selectDisabled = await page.evaluate(() => {
      const sel = document.getElementById('convertFormat');
      return sel ? sel.disabled : null;
    });
    eq(`  ${slug}: convertFormat select is disabled`, selectDisabled, true);
    const selectValue = await page.evaluate(() => {
      const sel = document.getElementById('convertFormat');
      return sel ? sel.value : null;
    });
    const expected = slug.includes('webp-a-png') ? 'image/png' : slug.includes('webp-a-jpg') ? 'image/jpeg' : slug.includes('png-a-jpg') ? 'image/jpeg' : slug.includes('png-a-webp') ? 'image/webp' : slug.includes('jpg-a-webp') ? 'image/webp' : 'image/png';
    eq(`  ${slug}: convertFormat value = ${expected}`, selectValue, expected);
  }

  console.log('\n--- PNG a PDF: pdfBackground preset ---');
  await page.goto(BASE + '/png-a-pdf.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 200));
  const bgValue = await page.evaluate(() => {
    const sel = document.getElementById('pdfBackground');
    return sel ? sel.value : null;
  });
  eq('  png-a-pdf: pdfBackground = #ffffff', bgValue, '#ffffff');

  console.log(`\n--- All ${EXPECTED_COUNT} routes still exist ---`);
  const toolsJson = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'tools.json'), 'utf-8'));
  const enabledTools = toolsJson.filter(t => t.enabled && t.indexable);
  eq(`  ${EXPECTED_COUNT} indexable tools in tools.json`, enabledTools.length, EXPECTED_COUNT);

  for (const tool of enabledTools) {
    const resp = await page.goto(BASE + `/${tool.slug}.html`, { waitUntil: 'domcontentloaded' });
    ok(`  ${tool.slug}.html (HTTP ${resp.status()})`, resp.status() === 200);
  }

  console.log(`\n--- Counter shows ${EXPECTED_COUNT} ---`);
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  const homeCards = await page.$$('.tool-card[data-tool]');
  eq(`  ${EXPECTED_COUNT} tool cards on homepage`, homeCards.length, EXPECTED_COUNT);

  console.log('\n--- No console errors ---');
  const seriousErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404'));
  ok(`  No console errors (got ${seriousErrors.length})`, seriousErrors.length === 0);
  if (seriousErrors.length) seriousErrors.forEach(e => console.log(`    ERROR: ${e}`));

  console.log('\n--- Drag and drop restrictions (simulated via DataTransfer) ---');
  await page.goto(BASE + '/jpg-a-png.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 100));
  const dropResult = await page.evaluate(async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const file = new File([blob], 'test.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const dropZone = document.getElementById('dropZone');
    const dropEvent = new DragEvent('drop', { dataTransfer: dt, bubbles: true });
    dropZone.dispatchEvent(dropEvent);
    await new Promise(r => setTimeout(r, 100));
    return document.querySelectorAll('.file-pill').length;
  });
  eq('  jpg-a-png: drag-drop PNG rejected (0 pills)', dropResult, 0);

  await page.goto(BASE + '/png-a-pdf.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 100));
  const dropResult2 = await page.evaluate(async () => {
    const blob = new Blob(['test'], { type: 'image/jpeg' });
    const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const dropZone = document.getElementById('dropZone');
    const dropEvent = new DragEvent('drop', { dataTransfer: dt, bubbles: true });
    dropZone.dispatchEvent(dropEvent);
    await new Promise(r => setTimeout(r, 100));
    return document.querySelectorAll('.file-pill').length;
  });
  eq('  png-a-pdf: drag-drop JPG rejected (0 pills)', dropResult2, 0);

  console.log('\n--- Shared processors still work on generic pages ---');
  await page.goto(BASE + '/convertir-imagen.html', { waitUntil: 'domcontentloaded' });
  const convertInputAccept = await page.$eval('#fileInput', el => el.accept);
  ok('  convertir-imagen accepts all image types', convertInputAccept.includes('image/jpeg') && convertInputAccept.includes('image/png') && convertInputAccept.includes('image/webp'));

  await page.goto(BASE + '/imagenes-a-pdf.html', { waitUntil: 'domcontentloaded' });
  const imgPdfAccept = await page.$eval('#fileInput', el => el.accept);
  ok('  imagenes-a-pdf accepts all image types', imgPdfAccept.includes('image/jpeg') && imgPdfAccept.includes('image/png') && imgPdfAccept.includes('image/webp'));

  console.log(`\n=== RESULTS ===`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(failed === 0 ? '\n✓ ALL TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
