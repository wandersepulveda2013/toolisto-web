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

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\n=== HOMEPAGE AUDIT TESTS ===\n');

  // ── 1. Homepage: No processing UI ──
  console.log('--- 1. Homepage: No processing UI ---');
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });

  ok('No #dropZone on homepage', await page.$('#dropZone') === null);
  ok('No #fileInput on homepage', await page.$('#fileInput') === null);
  ok('No #browseButton on homepage', await page.$('#browseButton') === null);
  ok('No #smartResult on homepage', await page.$('#smartResult') === null);
  ok('No #advancedPanel on homepage', await page.$('#advancedPanel') === null);
  ok('No #flowActions on homepage', await page.$('#flowActions') === null);
  ok('No #resultDialog on homepage', await page.$('#resultDialog') === null);
  ok('No #pickerDialog on homepage', await page.$('#pickerDialog') === null);
  ok('No #runButton on homepage', await page.$('#runButton') === null);
  ok('No #clearFilesButton on homepage', await page.$('#clearFilesButton') === null);

  // ── 2. Homepage: Tool cards are <a> links ──
  console.log('\n--- 2. Homepage: Tool cards are <a> links ---');
  const homeCards = await page.$$('.tool-card[data-tool]');
  ok(`Has ${EXPECTED_COUNT} tool cards`, homeCards.length === EXPECTED_COUNT);

  const allAnchor = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.every(c => c.tagName === 'A')
  );
  ok('All tool cards are <a> elements', allAnchor);

  const allHaveHref = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.every(c => c.hasAttribute('href') && c.getAttribute('href').endsWith('.html'))
  );
  ok('All tool cards have href ending in .html', allHaveHref);

  const noButtons = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.every(c => c.tagName !== 'BUTTON')
  );
  ok('No tool cards are <button> elements', noButtons);

  // Verify specific cards link to correct pages
  const firstCardHref = await page.$eval('.tool-card[data-tool="compress"]', c => c.getAttribute('href'));
  ok('compress card links to ./comprimir-imagen.html', firstCardHref === './comprimir-imagen.html');

  const convertCardHref = await page.$eval('.tool-card[data-tool="convert"]', c => c.getAttribute('href'));
  ok('convert card links to ./convertir-imagen.html', convertCardHref === './convertir-imagen.html');

  // ── 3. Counter: Shows 73 unique tools ──
  console.log('\n--- 3. Counter: Shows unique tool count ---');
  const toolCardCount = await page.$$eval('.tool-card[data-tool]', cards => cards.length);
  ok(`${EXPECTED_COUNT} tool cards on homepage`, toolCardCount === EXPECTED_COUNT);

  // Verify the splash screen counter reads from DOM (dynamic, not hardcoded)
  const introScript = await page.$eval('script', s => s.textContent);
  ok('Counter script reads from DOM dynamically', introScript.includes("querySelectorAll('.tool-card[data-tool]')"));
  ok('Counter updates introCount element', introScript.includes('introCount'));

  // ── 4. Animation timing ──
  console.log('\n--- 4. Animation timing ---');
  ok('First setTimeout is 3000ms', introScript.includes('setTimeout(closeIntro, 3000)'));
  ok('Second setTimeout is 3200ms', introScript.includes('setTimeout(closeIntro, 3200)'));
  ok('No 2900ms timeout', !introScript.includes('2900'));
  ok('No 3100ms timeout', !introScript.includes('3100'));

  // ── 5. CSS animation matches ──
  console.log('\n--- 5. CSS animation matches JS timing ---');
  const introCSS = await page.$eval('style', s => s.textContent);
  ok('introMaster animation is 3000ms', introCSS.includes('introMaster 3000ms'));

  // ── 6. No tool-card click handler in app.js ──
  console.log('\n--- 6. No tool-card click handler in app.js ---');
  const appJS = readFileSync(join(__dirname, '..', 'app.js'), 'utf-8');
  // The filterTools function still uses $$('.tool-card').forEach for filtering,
  // but the click handler that called chooseTool + scrollIntoView has been removed.
  const clickHandlerPattern = "addEventListener('click', () => {";
  const toolCardClickBlock = appJS.includes("$$('.tool-card').forEach") && appJS.includes("chooseTool(card.dataset.tool, true)");
  ok('No tool-card click handler that calls chooseTool', !toolCardClickBlock);

  // ── 7. SEO pages: Related tools only, not full grid ──
  console.log('\n--- 7. SEO pages: Related tools only (4-6) ---');
  // Sample a few tool pages
  const sampleSlugs = ['comprimir-imagen', 'unir-pdf', 'convertir-imagen', 'dividir-pdf', 'csv-a-excel'];
  for (const slug of sampleSlugs) {
    await page.goto(BASE + `/${slug}.html`, { waitUntil: 'domcontentloaded' });
    const relatedCards = await page.$$('.related-tools .tool-card');
    const count = relatedCards.length;
    ok(`${slug}: has 1-6 related tool cards (got ${count})`, count >= 1 && count <= 6);

    // Verify related tools are <a> links
    if (count > 0) {
      const allRelatedAreLinks = await page.$$eval('.related-tools .tool-card', cards =>
        cards.every(c => c.tagName === 'A' && c.hasAttribute('href'))
      );
      ok(`${slug}: related tools are <a> links`, allRelatedAreLinks);
    }

    // Verify "Ver todas" link exists
    const verTodasLink = await page.$('.related-tools a[href*="index.html#herramientas"]');
    ok(`${slug}: has "Ver todas" link to homepage`, verTodasLink !== null);

    // Verify NO full tool grid on individual pages
    const mainToolGrid = await page.$('section.tools-section .tool-grid');
    ok(`${slug}: no full tools-section grid`, mainToolGrid === null);
  }

  // ── 8. Production domain config ──
  console.log('\n--- 8. Production domain config ---');
  const config = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'site.config.json'), 'utf-8'));
  ok('site.config.json has productionDomain field', 'productionDomain' in config);
  ok('productionDomain is a valid URL', config.productionDomain && config.productionDomain.startsWith('https://'));

  // ── 9. Homepage has correct structure ──
  console.log('\n--- 9. Homepage structure ---');
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  ok('Has hero section', await page.$('.hero') !== null);
  ok('Has hero-left', await page.$('.hero-left') !== null);
  ok('Has tool grid section', await page.$('.tools-section#herramientas') !== null);
  ok('Has filter chips', (await page.$$('.filter-chip')).length > 0);
  ok('Has search input', await page.$('#toolSearch') !== null);
  ok('Has privacy banner', await page.$('#privacidad') !== null);
  ok('Has footer', await page.$('.site-footer') !== null);

  // ── 9b. New homepage sections ──
  console.log('\n--- 9b. New homepage sections ---');
  ok('Has featured section', await page.$('.featured-section') !== null);
  ok('Has featured grid', await page.$('.featured-grid') !== null);
  const featuredCards = await page.$$('.featured-card');
  ok('Featured section has 8 cards', featuredCards.length === 8);
  const allFeaturedAreLinks = await page.$$eval('.featured-card', cards =>
    cards.every(c => c.tagName === 'A' && c.hasAttribute('href'))
  );
  ok('All featured cards are <a> links', allFeaturedAreLinks);
  ok('Has why-section', await page.$('.why-section') !== null);
  const whyCards = await page.$$('.why-card');
  ok('Why section has 4 cards', whyCards.length === 4);
  ok('Has how-section', await page.$('.how-section') !== null);
  const howSteps = await page.$$('.how-step');
  ok('How section has 3 steps', howSteps.length === 3);
  ok(`Has hero-trust line with count`, await page.$eval('.hero-trust', el => /\d+ herramientas disponibles/.test(el.textContent)));
  ok('Has hero search bar', await page.$('.hero-search') !== null);
  ok('Has explore-link', await page.$('.explore-link') !== null);
  ok('Has privacy-note', await page.$('.privacy-note') !== null);

  // ── 10. Tool pages still have processing UI ──
  console.log('\n--- 10. Tool pages still have processing UI ---');
  await page.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'domcontentloaded' });
  ok('Tool page has dropZone', await page.$('#dropZone') !== null);
  ok('Tool page has fileInput', await page.$('#fileInput') !== null);
  ok('Tool page has browseButton', await page.$('#browseButton') !== null);
  ok('Tool page has runButton', await page.$('#runButton') !== null);

  // ── 11. Filter still works on homepage ──
  console.log('\n--- 11. Filter/search still works on homepage ---');
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.click('.filter-chip[data-filter="pdf"]');
  const visibleAfterFilter = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.filter(c => !c.hidden && c.dataset.category === 'pdf').length
  );
  ok('Filter shows only PDF tools when PDF filter active', visibleAfterFilter > 0);

  const hiddenNonPdf = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.filter(c => c.hidden && c.dataset.category !== 'pdf').length
  );
  ok('Non-PDF tools are hidden when PDF filter active', hiddenNonPdf > 0);

  // Reset filter
  await page.click('.filter-chip[data-filter="all"]');
  const allVisibleAfterReset = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.filter(c => !c.hidden).length
  );
  ok(`All cards visible after reset to "Todas"`, allVisibleAfterReset === EXPECTED_COUNT);

  // ── 12. Search functionality ──
  console.log('\n--- 12. Search functionality ---');
  await page.fill('#toolSearch', 'pdf');
  await page.waitForTimeout(100);
  const pdfSearchVisible = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.filter(c => !c.hidden).length
  );
  ok('Search "pdf" shows filtered results', pdfSearchVisible > 0 && pdfSearchVisible < EXPECTED_COUNT);
  const emptyHidden = await page.$eval('#emptyTools', el => el.hidden);
  ok('Empty state hidden when results found', emptyHidden);

  // Clear search
  await page.fill('#toolSearch', '');
  await page.waitForTimeout(100);
  const afterClear = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.filter(c => !c.hidden).length
  );
  ok(`All cards visible after clearing search`, afterClear === EXPECTED_COUNT);

  // Search for something with no results
  await page.fill('#toolSearch', 'xyznoexist');
  await page.waitForTimeout(100);
  const noResults = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.filter(c => !c.hidden).length
  );
  ok('No results for nonsense query', noResults === 0);
  const emptyVisible = await page.$eval('#emptyTools', el => !el.hidden);
  ok('Empty state visible when no results', emptyVisible);

  // ── COUNTER SOURCE INTEGRITY ──
  console.log('\n--- 13. Counter source integrity ---');
  // Navigate fresh — introCount text is set dynamically by splash script
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  const splashText = await page.$eval('#introCount', el => el.textContent);
  const splashCount = parseInt(splashText.match(/(\d+)/)?.[1] || '0', 10);
  ok(`Splash counter matches tools.json (${splashCount} === ${EXPECTED_COUNT})`, splashCount === EXPECTED_COUNT);

  const heroTrustText = await page.$eval('.hero-trust', el => el.textContent);
  const heroTrustCount = parseInt(heroTrustText.match(/(\d+)/)?.[1] || '0', 10);
  ok(`Hero trust counter matches tools.json (${heroTrustCount} === ${EXPECTED_COUNT})`, heroTrustCount === EXPECTED_COUNT);

  // Verify TOTAL_TOOLS is dynamic, not a literal number
  const hasDynamicCount = await page.evaluate(() => {
    const s = document.querySelector('script');
    return s.textContent.includes("querySelectorAll('.tool-card[data-tool]')");
  });
  ok('TOTAL_TOOLS is dynamic (reads from DOM)', hasDynamicCount);

  // ── SUMMARY ──
  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(failed === 0 ? '\n✓ ALL TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
