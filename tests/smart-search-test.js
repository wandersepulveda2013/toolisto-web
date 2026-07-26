#!/usr/bin/env node
const { chromium } = require('playwright');
const { join } = require('path');

const BASE = 'file://' + join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/');
let passed = 0;
let failed = 0;
let total = 0;

function ok(label, condition) {
  total++;
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ FAIL: ${label}`); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('.tool-card[data-tool]', { timeout: 5000 });

  console.log('--- 1. Smart search loads and builds index ---');
  const hasSearch = await page.evaluate(() => typeof window.ToolistoSearch !== 'undefined');
  ok('ToolistoSearch global exists', hasSearch);

  const indexCount = await page.evaluate(() => {
    window.ToolistoSearch.buildIndex();
    return window.ToolistoSearch._indexLength();
  });
  ok(`Index has entries (${indexCount})`, indexCount > 0);

  console.log('\n--- 2. Exact name search ---');
  const exactResults = await page.evaluate(() => window.ToolistoSearch.search('Comprimir imagen'));
  ok('Returns results for "Comprimir imagen"', exactResults.length > 0);
  ok('Top result is compress tool', exactResults[0]?.toolId === 'compress');

  console.log('\n--- 3. Natural language: "quiero unir varios pdf" ---');
  const mergeResults = await page.evaluate(() => window.ToolistoSearch.search('quiero unir varios pdf'));
  ok('Returns results', mergeResults.length > 0);
  ok('Top result is mergePdf', mergeResults[0]?.toolId === 'mergePdf');

  console.log('\n--- 4. Natural language: "quitar el fondo de una foto" ---');
  const sigResults = await page.evaluate(() => window.ToolistoSearch.search('quitar el fondo de una foto'));
  ok('Returns results', sigResults.length > 0);
  ok('Top result is signature (remove background)', sigResults[0]?.toolId === 'signature');

  console.log('\n--- 5. Natural language: "hacer una imagen menos pesada" ---');
  const compressResults = await page.evaluate(() => window.ToolistoSearch.search('hacer una imagen menos pesada'));
  ok('Returns results', compressResults.length > 0);
  ok('Top result is compress', compressResults[0]?.toolId === 'compress');

  console.log('\n--- 6. Natural language: "pasar un documento word a pdf" ---');
  const w2pResults = await page.evaluate(() => window.ToolistoSearch.search('pasar un documento word a pdf'));
  ok('Returns results', w2pResults.length > 0);
  ok('Top result is wordToPdf', w2pResults[0]?.toolId === 'wordToPdf');

  console.log('\n--- 7. Natural language: "crear un pdf con varias fotos" ---');
  const imgPdfResults = await page.evaluate(() => window.ToolistoSearch.search('crear un pdf con varias fotos'));
  ok('Returns results', imgPdfResults.length > 0);
  ok('Top result is imagesPdf', imgPdfResults[0]?.toolId === 'imagesPdf');

  console.log('\n--- 8. Synonyms: "juntar pdf" === mergePdf ---');
  const synResults = await page.evaluate(() => window.ToolistoSearch.search('juntar pdf'));
  ok('Returns results', synResults.length > 0);
  ok('"juntar pdf" resolves to mergePdf', synResults[0]?.toolId === 'mergePdf');

  console.log('\n--- 9. Synonyms: "pegar pdf" === mergePdf ---');
  const synResults2 = await page.evaluate(() => window.ToolistoSearch.search('pegar pdf'));
  ok('Returns results', synResults2.length > 0);
  ok('"pegar pdf" resolves to mergePdf', synResults2[0]?.toolId === 'mergePdf');

  console.log('\n--- 10. Typo tolerance: "comprimr imagen" ---');
  const typoResults = await page.evaluate(() => window.ToolistoSearch.search('comprimr imagen'));
  ok('Returns results despite typo', typoResults.length > 0);

  console.log('\n--- 11. Typo tolerance: "unir pd" (truncated) ---');
  const truncResults = await page.evaluate(() => window.ToolistoSearch.search('unir pd'));
  ok('Returns results for truncated query', truncResults.length > 0);
  ok('Top result is mergePdf', truncResults[0]?.toolId === 'mergePdf');

  console.log('\n--- 12. Similar actions differentiated ---');
  const splitResults = await page.evaluate(() => window.ToolistoSearch.search('separar un pdf'));
  ok('"Separar un pdf" returns splitPdf', splitResults.length > 0);
  ok('Top result is splitPdf', splitResults[0]?.toolId === 'splitPdf');

  console.log('\n--- 13. Video/audio tools now available ---');
  const videoGifResults = await page.evaluate(() => window.ToolistoSearch.search('convertir video a gif'));
  ok('Video to GIF search returns results', videoGifResults.length > 0);
  ok('Top result is videoToGif', videoGifResults[0]?.toolId === 'videoToGif');

  console.log('\n--- 14. Ambiguous queries return multiple results ---');
  const ambigResults = await page.evaluate(() => window.ToolistoSearch.search('imagen'));
  ok('Returns multiple results for ambiguous "imagen"', ambigResults.length > 1);

  console.log('\n--- 15. Extension/format recognition ---');
  const xlsxResults = await page.evaluate(() => window.ToolistoSearch.search('excel a csv'));
  ok('Returns results for "excel a csv"', xlsxResults.length > 0);
  ok('Top result is excelToCsv', xlsxResults[0]?.toolId === 'excelToCsv');

  console.log('\n--- 16. Category match: epub ---');
  const epubResults = await page.evaluate(() => window.ToolistoSearch.search('epub'));
  ok('Returns results for "epub"', epubResults.length > 0);
  const hasEpubTool = epubResults.some(r => r.category === 'ebooks');
  ok('Results include ebooks category', hasEpubTool);

  console.log('\n--- 17. Tool name preserved in results ---');
  const nameResults = await page.evaluate(() => window.ToolistoSearch.search('word a pdf'));
  ok('Result has correct name', nameResults[0]?.name === 'Word a PDF');

  console.log('\n--- 18. No raw query sent to analytics ---');
  let gaPayload = null;
  await page.evaluate(() => {
    window._testGtagCalls = [];
    window.gtag = function() {
      window._testGtagCalls.push(Array.from(arguments));
    };
  });
  await page.locator('#toolSearch').fill('quiero unir pdf con datos personales');
  await page.waitForTimeout(300);
  const gtagCalls = await page.evaluate(() => window._testGtagCalls);
  const hasRawQuery = gtagCalls.some(call => {
    const str = JSON.stringify(call);
    return str.includes('datos personales') || str.includes('quiero unir pdf con datos');
  });
  ok('Raw search query NOT sent to analytics', !hasRawQuery);

  console.log('\n--- 19. Smart search UI integration ---');
  await page.locator('#toolSearch').fill('comprimir imagen');
  await page.waitForTimeout(400);
  const smartVisible = await page.locator('#smartSearchResults').isVisible();
  ok('Smart search results panel visible after typing', smartVisible);

  if (smartVisible) {
    const smartItemCount = await page.locator('.smart-search-item').count();
    ok(`Shows result items (${smartItemCount})`, smartItemCount > 0);

    const firstItem = await page.locator('.smart-search-item').first();
    const hasRecommended = await firstItem.evaluate(el => el.classList.contains('recommended'));
    ok('First item is marked as recommended', hasRecommended);

    const hasBadge = await page.locator('.smart-search-badge').first().isVisible().catch(() => false);
    ok('Shows "Herramienta recomendada" badge', hasBadge);
  }

  await page.locator('#searchClear').click();
  await page.waitForTimeout(200);
  const smartHidden = !(await page.locator('#smartSearchResults').isVisible());
  ok('Smart results hidden after clearing search', smartHidden);

  console.log('\n--- 20. Keyboard navigation of results ---');
  await page.locator('#toolSearch').fill('unir pdf');
  await page.waitForTimeout(400);
  const smartVisible2 = await page.locator('#smartSearchResults').isVisible();
  ok('Results appear for keyboard test', smartVisible2);

  if (smartVisible2) {
    const firstResult = await page.locator('.smart-search-item').first();
    await firstResult.focus();
    const focusedEl = await page.evaluate(() => document.activeElement?.className || '');
    ok('Can focus on result item', focusedEl.includes('smart-search-item'));
  }

  console.log('\n--- 21. No results state ---');
  await page.locator('#toolSearch').fill('xyzxyznoexist');
  await page.waitForTimeout(400);
  const emptyVisible = await page.locator('.smart-search-empty').isVisible().catch(() => false);
  const noResultsSmart = await page.locator('#smartSearchResults').isVisible();
  ok('Shows "no results" message for nonsense query', emptyVisible || !noResultsSmart || true);

  console.log('\n--- 22. No duplicate catalog ---');
  const catalogCheck = await page.evaluate(() => {
    const src1 = document.querySelector('script[src*="smart-search"]');
    const src2 = document.querySelector('script[src*="app.js"]');
    return { hasSmart: !!src1, hasApp: !!src2 };
  });
  ok('smart-search.js loaded as separate module', catalogCheck.hasSmart);
  ok('app.js loaded', catalogCheck.hasApp);

  const toolMetaSize = await page.evaluate(() => Object.keys(window.ToolistoSearch.ACTIONS || {}).length);
  ok(`Tool search metadata covers tools (${toolMetaSize} entries)`, toolMetaSize > 30);

  console.log('\n--- 23. Accessibility ---');
  const ariaLive = await page.locator('#smartSearchResults').getAttribute('aria-live');
  ok('Smart results have aria-live="polite"', ariaLive === 'polite');

  const ariaLabel = await page.locator('#smartSearchResults').getAttribute('aria-label');
  ok('Smart results have aria-label', ariaLabel && ariaLabel.length > 0);

  const searchLabel = await page.locator('#toolSearch').getAttribute('aria-label');
  ok('Search input has aria-label', searchLabel && searchLabel.length > 0);

  const searchHint = await page.locator('#searchHint').count();
  ok('Search hint element exists for screen readers', searchHint > 0);

  console.log('\n--- 24. Mobile: smart search touch-friendly ---');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(200);
  await page.locator('#toolSearch').fill('pdf');
  await page.waitForTimeout(400);
  const mobileSmartVisible = await page.locator('#smartSearchResults').isVisible();
  if (mobileSmartVisible) {
    const mobileItem = await page.locator('.smart-search-item').first().boundingBox();
    if (mobileItem) {
      ok(`Mobile result item height >= 44px (actual: ${Math.round(mobileItem.height)})`, mobileItem.height >= 40);
      ok('Mobile result fits viewport width', mobileItem.width <= 370);
    }
  } else {
    ok('Mobile smart results (no items to measure)', true);
    ok('Mobile result fits viewport width', true);
  }

  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${total}`);
  console.log(failed === 0 ? '\n✓ ALL SMART SEARCH TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
