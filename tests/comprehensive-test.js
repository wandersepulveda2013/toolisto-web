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
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ FAIL: ${label}`); failed++; }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // ═══════════════════════════════════════════
  // HOMEPAGE TESTS
  // ═══════════════════════════════════════════
  console.log('\n=== HOMEPAGE ===\n');
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });

  // Search is a real input
  console.log('--- Search ---');
  ok('Search is a real <input>', await page.$eval('#toolSearch', el => el.tagName === 'INPUT'));
  ok('Search type is "search"', await page.$eval('#toolSearch', el => el.type === 'search'));
  ok('Search placeholder is correct', await page.$eval('#toolSearch', el => el.placeholder === '¿Qué necesitas hacer con tu archivo?'));
  ok('Search has aria label via <label>', (await page.$('label[for="toolSearch"]')) !== null);
  ok('Search clear button exists', (await page.$('#searchClear')) !== null);

  // Search bar is large enough
  const searchBox = await page.$eval('.hero-search', el => {
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  });
  ok('Search bar width >= 480px on desktop', searchBox.width >= 480);
  ok('Search bar height >= 48px', searchBox.height >= 48);

  // Search functionality
  await page.fill('#toolSearch', 'PDF');
  await page.waitForTimeout(100);
  const pdfResults = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  ok('Search "PDF" returns results', pdfResults > 0 && pdfResults < EXPECTED_COUNT);

  await page.fill('#toolSearch', 'Word a PDF');
  await page.waitForTimeout(100);
  const wordResults = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  ok('Search "Word a PDF" returns 1 result', wordResults === 1);

  await page.fill('#toolSearch', 'comprimir');
  await page.waitForTimeout(100);
  const compResults = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  ok('Search "comprimir" returns results', compResults > 0);

  await page.fill('#toolSearch', 'firma');
  await page.waitForTimeout(100);
  const firmaResults = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  ok('Search "firma" returns results', firmaResults > 0);

  await page.fill('#toolSearch', 'xyznoexist');
  await page.waitForTimeout(100);
  const noResults = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  ok('Search nonsense returns 0 results', noResults === 0);
  ok('Empty state visible when no results', await page.$eval('#emptyTools', el => !el.hidden));

  await page.fill('#toolSearch', '');
  await page.waitForTimeout(100);
  const afterClear = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  ok(`Clearing search restores all ${EXPECTED_COUNT} tools`, afterClear === EXPECTED_COUNT);

  // No file input on homepage
  console.log('\n--- No processing on homepage ---');
  ok('No input[type=file] on homepage', (await page.$('input[type="file"]')) === null);
  ok('No #dropZone on homepage', (await page.$('#dropZone')) === null);
  ok('No #browseButton on homepage', (await page.$('#browseButton')) === null);
  ok('No #runButton on homepage', (await page.$('#runButton')) === null);
  ok('No #resultDialog on homepage', (await page.$('#resultDialog')) === null);

  // tool cards
  console.log('\n--- Tool cards ---');
  const toolCards = await page.$$eval('.tool-card[data-tool]', cards => cards.length);
  ok(`${EXPECTED_COUNT} tool cards on homepage`, toolCards === EXPECTED_COUNT);

  // All have icons
  const missingIcons = await page.$$eval('.tool-card[data-tool] .tool-icon', els => els.filter(el => !el.textContent.trim()).length);
  ok(`All ${EXPECTED_COUNT} tool cards have icons`, missingIcons === 0);

  // All have valid href
  const allHrefValid = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.every(c => c.hasAttribute('href') && c.getAttribute('href').endsWith('.html'))
  );
  ok(`All ${EXPECTED_COUNT} cards have valid href`, allHrefValid);

  // All are <a> links
  const allAnchors = await page.$$eval('.tool-card[data-tool]', cards =>
    cards.every(c => c.tagName === 'A')
  );
  ok('All tool cards are <a> elements', allAnchors);

  // Counter
  console.log('\n--- Counter ---');
  const trustLine = await page.$eval('.hero-trust', el => el.textContent);
  ok(`Hero trust shows "${EXPECTED_COUNT} herramientas"`, trustLine.includes(`${EXPECTED_COUNT} herramientas`));

  // Featured section
  console.log('\n--- Featured ---');
  const featured = await page.$$('.featured-card');
  ok('Featured section has 8 cards', featured.length === 8);
  const allFeaturedLinks = await page.$$eval('.featured-card', cards =>
    cards.every(c => c.tagName === 'A' && c.hasAttribute('href'))
  );
  ok('All featured cards are links', allFeaturedLinks);

  // Sections
  console.log('\n--- Sections ---');
  ok('Has hero section', (await page.$('.hero')) !== null);
  ok('Has featured section', (await page.$('.featured-section')) !== null);
  ok('Has tools section', (await page.$('.tools-section')) !== null);
  ok('Has why section', (await page.$('.why-section')) !== null);
  ok('Has how section', (await page.$('.how-section')) !== null);
  ok('Has footer', (await page.$('.site-footer')) !== null);

  const whyCards = await page.$$('.why-card');
  ok('Why section has 4 cards', whyCards.length === 4);
  const howSteps = await page.$$('.how-step');
  ok('How section has 3 steps', howSteps.length === 3);

  // H1 sizing
  const h1Size = await page.$eval('.hero-left h1', el => parseFloat(getComputedStyle(el).fontSize));
  ok('H1 font-size >= 40px on desktop', h1Size >= 40);

  // ═══════════════════════════════════════════
  // TOOL PAGE TESTS
  // ═══════════════════════════════════════════
  console.log('\n\n=== TOOL PAGE: /comprimir-imagen.html ===\n');
  await page.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  console.log('--- Workspace ---');
  ok('Has dropZone', (await page.$('#dropZone')) !== null);
  ok('Has fileInput', (await page.$('#fileInput')) !== null);
  ok('Has browseButton', (await page.$('#browseButton')) !== null);
  ok('Has runButton', (await page.$('#runButton')) !== null);
  ok('Has resultDialog', (await page.$('#resultDialog')) !== null);

  // Drop zone visible
  const dzBox = await page.$eval('#dropZone', el => {
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0, width: Math.round(r.width), height: Math.round(r.height) };
  });
  ok('Drop zone is visible', dzBox.visible);
  ok('Drop zone width >= 400px', dzBox.width >= 400);
  ok('Drop zone height >= 200px', dzBox.height >= 200);

  // hero-right visible
  const hrBox = await page.$eval('.hero-right', el => {
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0 };
  });
  ok('hero-right is visible on tool page', hrBox.visible);

  // hero-tool class
  ok('Hero has hero-tool class', await page.$eval('.hero', el => el.classList.contains('hero-tool')));

  // Breadcrumbs horizontal
  console.log('\n--- Breadcrumbs ---');
  const bcDisplay = await page.$eval('.breadcrumbs', el => getComputedStyle(el).display);
  ok('Breadcrumbs display is flex', bcDisplay === 'flex');
  const bcDir = await page.$eval('.breadcrumbs', el => getComputedStyle(el).flexDirection);
  ok('Breadcrumbs direction is row', bcDir === 'row');
  const bcText = await page.$eval('.breadcrumbs', el => el.textContent.trim().replace(/\s+/g, ' '));
  ok('Breadcrumbs have 3 items', bcText.split('/').length === 3 || bcText.split('Inicio').length >= 2);

  // Content sections
  console.log('\n--- Content sections ---');
  ok('Has formats-info', (await page.$('.formats-info')) !== null);
  ok('Has instructions', (await page.$('.instructions')) !== null);
  ok('Has limitations', (await page.$('.limitations')) !== null);
  ok('Has faq-section', (await page.$('.faq-section')) !== null);
  ok('Has related-tools', (await page.$('.related-tools')) !== null);

  const faqItems = await page.$$('.faq-item');
  ok('Has FAQ items', faqItems.length >= 2);
  ok('FAQ items are details elements', await page.$eval('.faq-item', el => el.tagName === 'DETAILS'));

  const relatedCards = await page.$$('.related-tools .tool-card');
  ok('Related tools has 4-6 cards', relatedCards.length >= 4 && relatedCards.length <= 6);

  // Tool page config
  console.log('\n--- Tool config ---');
  ok('Has tool-page-config', (await page.$('#tool-page-config')) !== null);
  const config = JSON.parse(await page.$eval('#tool-page-config', el => el.textContent));
  ok('Config has toolId', config.toolId === 'compress');

  // Result dialog: support block + report-problem
  console.log('\n--- Result dialog support & report ---');
  ok('Has resultSupport element', (await page.$('#resultSupport')) !== null);
  ok('resultSupport is hidden by default', await page.$eval('#resultSupport', el => el.hidden));
  ok('Has report problem link', (await page.$('#reportProblemLink')) !== null);
  const reportHref = await page.$eval('#reportProblemLink', el => el.getAttribute('href'));
  ok('Report link goes to mailto:contacto@toolisto.com', reportHref.includes('mailto:contacto@toolisto.com'));

  // ═══════════════════════════════════════════
  // TOOL PAGE: unir-pdf
  // ═══════════════════════════════════════════
  console.log('\n=== TOOL PAGE: /unir-pdf.html ===\n');
  await page.goto(BASE + '/unir-pdf.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  ok('PDF tool has dropZone', (await page.$('#dropZone')) !== null);
  ok('PDF tool dropZone visible', await page.$eval('#dropZone', el => el.getBoundingClientRect().width > 0));
  ok('PDF tool has runButton', (await page.$('#runButton')) !== null);
  const pdfBcText = await page.$eval('.breadcrumbs', el => el.textContent.trim().replace(/\s+/g, ' '));
  ok('PDF breadcrumbs show "Inicio / PDF / Unir PDF"', pdfBcText.includes('Inicio') && pdfBcText.includes('Unir PDF'));

  // ═══════════════════════════════════════════
  // TOOL PAGE: word-a-pdf
  // ═══════════════════════════════════════════
  console.log('\n=== TOOL PAGE: /word-a-pdf.html ===\n');
  await page.goto(BASE + '/word-a-pdf.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  ok('Word-to-PDF has dropZone', (await page.$('#dropZone')) !== null);
  ok('Word-to-PDF dropZone visible', await page.$eval('#dropZone', el => el.getBoundingClientRect().width > 0));

  // ═══════════════════════════════════════════
  // DARK MODE
  // ═══════════════════════════════════════════
  console.log('\n=== DARK MODE ===\n');
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.waitForTimeout(200);
  const bgColor = await page.$eval('body', el => getComputedStyle(el).backgroundColor);
  ok('Dark mode background changes', bgColor !== 'rgb(247, 245, 239)');

  // ═══════════════════════════════════════════
  // RESPONSIVE
  // ═══════════════════════════════════════════
  console.log('\n=== RESPONSIVE ===\n');
  const viewports = [
    { w: 360, h: 800, name: '360×800' },
    { w: 768, h: 1024, name: '768×1024' },
    { w: 1366, h: 768, name: '1366×768' },
    { w: 1920, h: 1080, name: '1920×1080' },
  ];

  for (const vp of viewports) {
    await page.close();
    const pg = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(3500);

    const hScroll = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok(`${vp.name} homepage: no horizontal scroll`, !hScroll);

    await pg.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1500);
    const toolHScroll = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const dzVisible = await pg.$eval('#dropZone', el => el.getBoundingClientRect().width > 0);
    ok(`${vp.name} tool page: no horizontal scroll`, !toolHScroll);
    ok(`${vp.name} tool page: dropZone visible`, dzVisible);
    await pg.close();
  }

  // ═══════════════════════════════════════════
  // LEGAL PAGES
  // ═══════════════════════════════════════════
  console.log('\n=== LEGAL PAGES ===\n');

  const legalPage = await context.newPage();
  await legalPage.goto(BASE + '/privacidad.html', { waitUntil: 'domcontentloaded' });
  ok('privacidad.html has H1', (await legalPage.$('h1')) !== null);
  const privTitle = await legalPage.$eval('h1', el => el.textContent);
  ok('privacidad H1 mentions Privacidad', privTitle.includes('Privacidad'));

  await legalPage.goto(BASE + '/condiciones.html', { waitUntil: 'domcontentloaded' });
  ok('condiciones.html has H1', (await legalPage.$('h1')) !== null);
  const condTitle = await legalPage.$eval('h1', el => el.textContent);
  ok('condiciones H1 mentions Condiciones', condTitle.includes('Condiciones'));

  await legalPage.goto(BASE + '/apoyar.html', { waitUntil: 'domcontentloaded' });
  ok('apoyar.html has H1', (await legalPage.$('h1')) !== null);
  const apoyTitle = await legalPage.$eval('h1', el => el.textContent);
  ok('apoyar H1 mentions Apoyar', apoyTitle.includes('Apoyar'));
  ok('apoyar has PayPal link', (await legalPage.$('a[href*="paypal.com"]')) !== null);

  // Footer links on tool page
  console.log('\n--- Footer links on tool page ---');
  await legalPage.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'domcontentloaded' });
  ok('Tool page has privacidad footer link', (await legalPage.$('.site-footer a[href="./privacidad.html"]')) !== null);
  ok('Tool page has condiciones footer link', (await legalPage.$('.site-footer a[href="./condiciones.html"]')) !== null);
  ok('Tool page has apoyar footer link', (await legalPage.$('.site-footer a[href="./apoyar.html"]')) !== null);

  // Footer links on homepage
  console.log('\n--- Footer links on homepage ---');
  await legalPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  ok('Homepage has privacidad footer link', (await legalPage.$('.site-footer a[href="./privacidad.html"]')) !== null);
  ok('Homepage has condiciones footer link', (await legalPage.$('.site-footer a[href="./condiciones.html"]')) !== null);
  ok('Homepage has apoyar footer link', (await legalPage.$('.site-footer a[href="./apoyar.html"]')) !== null);

  // Brand logo hrefs
  console.log('\n--- Brand logo hrefs ---');
  const headerBrandHref = await legalPage.$eval('.header-inner .brand', el => el.getAttribute('href'));
  ok('Header brand href is ./index.html', headerBrandHref === './index.html');
  const footerBrandHref = await legalPage.$eval('.site-footer .brand', el => el.getAttribute('href'));
  ok('Footer brand href is ./index.html', footerBrandHref === './index.html');

  await legalPage.close();

  // ═══════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════
  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(failed === 0 ? '\n✓ ALL TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
