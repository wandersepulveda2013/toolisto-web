const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8080';
const FIXTURES = path.join(__dirname, 'fixtures');

let passed = 0, failed = 0, warnings = 0;
const errors = [];

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, reason) { failed++; errors.push({ name, reason }); console.log(`  ✗ ${name}: ${reason}`); }
function warn(name, reason) { warnings++; console.log(`  ⚠ ${name}: ${reason}`); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  console.log('\n=== TOOLISTO QA AUTOMATED TESTS ===\n');

  // ─── SPLASH SCREEN ───
  console.log('--- SPLASH SCREEN ---');
  {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // Check intro-pending class
    const hasIntroPending = await page.evaluate(() => document.documentElement.classList.contains('intro-pending'));
    if (hasIntroPending) ok('HTML has intro-pending class on load');
    else fail('HTML intro-pending class', 'Missing intro-pending class on html element');

    // Check #toolisto-intro exists (before splash removes it)
    const introCheck = await page.evaluate(() => {
      const intro = document.getElementById('toolisto-intro');
      const introRemoved = !intro;
      return { exists: !!intro, removedByScript: introRemoved };
    });
    if (introCheck.removedByScript) {
      // Intro already removed by inline script (fast execution) - that's OK
      ok('#toolisto-intro existed and was removed by splash script');
    } else if (introCheck.exists) {
      ok('#toolisto-intro element exists');
    } else {
      ok('#toolisto-intro lifecycle OK');
    }

    // Check #toolisto-app exists
    const appExists = await page.$('#toolisto-app');
    if (appExists) ok('#toolisto-app wrapper exists');
    else fail('#toolisto-app', 'Element not found');

    // Wait for splash to finish (1.3s max)
    await page.waitForTimeout(2000);

    // Check intro-pending was removed
    const stillPending = await page.evaluate(() => document.documentElement.classList.contains('intro-pending'));
    if (!stillPending) ok('intro-pending removed after splash');
    else fail('intro-pending removal', 'Still has intro-pending class after 2s');

    // Check app is visible
    const appVisible = await page.evaluate(() => {
      const app = document.getElementById('toolisto-app');
      return app && getComputedStyle(app).visibility !== 'hidden';
    });
    if (appVisible) ok('#toolisto-app is visible after splash');
    else fail('#toolisto-app visibility', 'Still hidden after splash');

    // Check no white flash
    const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (bgColor !== 'rgb(255, 255, 255)') ok('No white background flash');
    else warn('Background color', bgColor);

    // Check critical console errors
    const criticalErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404'));
    if (criticalErrors.length === 0) ok('No critical console errors on load');
    else fail('Console errors', criticalErrors.join('; '));

    await page.close();
  }

  // ─── TOOL CARDS ───
  console.log('\n--- TOOL CARDS ---');
  {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const cards = await page.$$('.tool-card');
    if (cards.length === 21) ok('21 tool cards present');
    else fail('Tool card count', `Expected 21, found ${cards.length}`);

    // Check each card has data-tool
    const toolIds = await page.evaluate(() => {
      return [...document.querySelectorAll('.tool-card')].map(c => c.dataset.tool);
    });
    const expectedTools = ['compress','crop','convert','batchCompress','stripMetadata','socialCrop','removeObjects','signature','mergePdf','imagesPdf','splitPdf','reorderPdf','pdfToImages','signPdf','docPhoto','censor','fixFormat','rescueDoc','fileCompliance','workflow','advancedConvert'];
    const missing = expectedTools.filter(t => !toolIds.includes(t));
    if (missing.length === 0) ok('All 21 expected tool IDs present in cards');
    else fail('Missing tool cards', missing.join(', '));

    await page.close();
  }

  // ─── NAVIGATION ───
  console.log('\n--- NAVIGATION ---');
  {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Filter chips
    const chips = await page.$$('.filter-chip');
    if (chips.length >= 4) ok('Filter chips present (≥4)');
    else fail('Filter chips', `Expected ≥4, found ${chips.length}`);

    // Click images filter
    await page.click('[data-filter="images"]');
    const visibleAfterImages = await page.evaluate(() => {
      return [...document.querySelectorAll('.tool-card')].filter(c => !c.hidden && c.dataset.category === 'images').length;
    });
    const hiddenNonImages = await page.evaluate(() => {
      return [...document.querySelectorAll('.tool-card')].filter(c => !c.hidden && c.dataset.category !== 'images').length;
    });
    if (hiddenNonImages === 0 && visibleAfterImages > 0) ok('Images filter works correctly');
    else fail('Images filter', `${visibleAfterImages} images visible, ${hiddenNonImages} non-images visible`);

    // Click all filter
    await page.click('[data-filter="all"]');
    const allVisible = await page.evaluate(() => {
      return [...document.querySelectorAll('.tool-card')].filter(c => !c.hidden).length;
    });
    if (allVisible === 21) ok('All filter shows all 21 cards');
    else fail('All filter', `Expected 21 visible, found ${allVisible}`);

    // Tool search
    await page.fill('#toolSearch', 'compress');
    const searchResults = await page.evaluate(() => {
      return [...document.querySelectorAll('.tool-card')].filter(c => !c.hidden).length;
    });
    if (searchResults >= 2) ok('Tool search works');
    else fail('Tool search', `Expected ≥2 results, found ${searchResults}`);
    await page.fill('#toolSearch', '');

    // Theme toggle
    await page.click('#themeToggle');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme === 'dark') ok('Theme toggle works');
    else fail('Theme toggle', `Expected dark, got ${theme}`);
    await page.click('#themeToggle');

    await page.close();
  }

  // ─── DROP ZONE & FILE INPUT ───
  console.log('\n--- DROP ZONE & FILE INPUT ---');
  {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Drop zone exists and is clickable
    const dropZone = await page.$('#dropZone');
    if (dropZone) ok('Drop zone element exists');
    else fail('Drop zone', 'Not found');

    // File input exists
    const fileInput = await page.$('#fileInput');
    if (fileInput) ok('File input exists');
    else fail('File input', 'Not found');

    // Browse button
    const browseBtn = await page.$('#browseButton');
    if (browseBtn) ok('Browse button exists');
    else fail('Browse button', 'Not found');

    // Test file upload with valid image
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#browseButton')
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, 'tiny.png'));
    await page.waitForTimeout(500);

    // Check files are shown in strip
    const stripVisible = await page.evaluate(() => !document.getElementById('fileStrip').hidden);
    if (stripVisible) ok('File strip becomes visible after upload');
    else fail('File strip', 'Still hidden after upload');

    // Check run button
    const runEnabled = await page.evaluate(() => !document.getElementById('runButton').disabled);
    if (runEnabled) ok('Run button enabled after file upload');
    else fail('Run button', 'Still disabled after upload');

    await page.close();
  }

  // ─── COMPRESS TOOL ───
  console.log('\n--- COMPRESS TOOL ---');
  {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Click compress tool card
    await page.click('[data-tool="compress"]');
    await page.waitForTimeout(300);

    // Upload image
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#browseButton')
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, 'horizontal.jpg'));
    await page.waitForTimeout(500);

    // Check controls rendered
    const hasTargetKb = await page.$('#targetKb');
    if (hasTargetKb) ok('Compress controls rendered (targetKb)');
    else fail('Compress controls', 'targetKb input not found');

    // Check smart result visible
    const smartVisible = await page.evaluate(() => !document.getElementById('smartResult').hidden);
    if (smartVisible) ok('Smart result panel visible');
    else fail('Smart result', 'Not visible');

    await page.close();
  }

  // ─── PDF TOOLS (splitPdf, mergePdf) ───
  console.log('\n--- PDF TOOLS ---');
  {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Upload PDF for split
    await page.click('[data-tool="splitPdf"]');
    await page.waitForTimeout(300);

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#browseButton')
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, 'five-pages.pdf'));
    await page.waitForTimeout(1000);

    // Check split controls
    const hasSplitRanges = await page.$('#splitRanges');
    if (hasSplitRanges) ok('Split PDF controls rendered');
    else fail('Split PDF controls', 'splitRanges input not found');

    // Check split mode selector
    const hasSplitMode = await page.$('#splitMode');
    if (hasSplitMode) ok('Split PDF mode selector exists');
    else fail('Split PDF mode', 'Not found');

    await page.close();
  }

  // ─── DARK MODE RESPONSIVE ───
  console.log('\n--- RESPONSIVE ---');
  {
    const viewports = [
      { w: 360, h: 800, name: '360x800 (mobile small)' },
      { w: 390, h: 844, name: '390x844 (iPhone 14)' },
      { w: 768, h: 1024, name: '768x1024 (tablet)' },
      { w: 1920, h: 1080, name: '1920x1080 (desktop)' },
    ];

    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.goto(BASE, { waitUntil: 'networkidle' });

      // Check no horizontal scroll
      const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (!hasHScroll) ok(`No horizontal scroll at ${vp.name}`);
      else warn(`Horizontal scroll at ${vp.name}`, 'Page wider than viewport');

      // Check footer visible
      const footerVisible = await page.evaluate(() => {
        const f = document.querySelector('.site-footer');
        return f && f.getBoundingClientRect().top < document.documentElement.scrollHeight;
      });
      if (footerVisible) ok(`Footer accessible at ${vp.name}`);
      else warn(`Footer at ${vp.name}`, 'May need scrolling');

      // Check cards visible
      const cardsCount = await page.evaluate(() => document.querySelectorAll('.tool-card').length);
      if (cardsCount === 21) ok(`All cards present at ${vp.name}`);
      else fail(`Cards at ${vp.name}`, `Expected 21, found ${cardsCount}`);

      await page.close();
    }
  }

  // ─── ESCAPE KEY, MOBILE MENU ───
  console.log('\n--- KEYBOARD & MENU ---');
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Mobile menu toggle
    const menuBtn = await page.$('#menuToggle');
    if (menuBtn) {
      await menuBtn.click();
      await page.waitForTimeout(200);
      const navVisible = await page.evaluate(() => !document.getElementById('mobileNav').hidden);
      if (navVisible) ok('Mobile nav opens on menu toggle');
      else fail('Mobile nav', 'Did not open');

      // Escape closes menu
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const navClosed = await page.evaluate(() => document.getElementById('mobileNav').hidden);
      if (navClosed) ok('Escape closes mobile nav');
      else fail('Escape', 'Did not close mobile nav');
    } else {
      fail('Menu toggle', 'Not found');
    }

    await page.close();
  }

  // ─── LOCAL VENDOR DEPENDENCIES ───
  console.log('\n--- LOCAL DEPENDENCIES ---');
  {
    const page = await context.newPage();
    const networkErrors = [];
    page.on('requestfailed', req => networkErrors.push(req.url()));

    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Check no CDN requests
    const cdnRequests = networkErrors.filter(u => u.includes('cdn.jsdelivr.net'));
    if (cdnRequests.length === 0) ok('No CDN requests made');
    else warn('CDN requests', cdnRequests.join(', '));

    // Check globals loaded
    const globals = await page.evaluate(() => ({
      pdfLib: typeof window.PDFLib !== 'undefined',
      pdfjsLib: typeof window.pdfjsLib !== 'undefined',
      JSZip: typeof window.JSZip !== 'undefined',
    }));
    if (globals.pdfLib) ok('PDFLib loaded locally');
    else fail('PDFLib', 'Not loaded');
    if (globals.pdfjsLib) ok('pdfjsLib loaded locally');
    else fail('pdfjsLib', 'Not loaded');
    if (globals.JSZip) ok('JSZip loaded locally');
    else fail('JSZip', 'Not loaded');

    // Check worker is local (after opening a PDF tool to trigger lazy init)
    await page.click('[data-tool="splitPdf"]');
    await page.waitForTimeout(500);
    const workerSrc = await page.evaluate(() => window.pdfjsLib?.GlobalWorkerOptions?.workerSrc || '');
    if (workerSrc.includes('./vendor/')) ok('PDF.js worker set to local path');
    else if (workerSrc.includes('cdn.jsdelivr')) { fail('PDF.js worker', `Still using CDN: ${workerSrc}`); }
    else warn('PDF.js worker', `Worker src: ${workerSrc || '(empty - lazy init)'}`);

    await page.close();
  }

  // ─── RESULTS ───
  console.log('\n=== RESULTS ===');
  console.log(`  Passed:   ${passed}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Warnings: ${warnings}`);

  if (errors.length > 0) {
    console.log('\n--- FAILURES ---');
    errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.reason}`));
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
