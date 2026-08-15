const { chromium } = require('playwright');

const BASE = 'http://localhost:8080';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  // ═══ HOMEPAGE CHECKS ═══
  console.log('=== HOMEPAGE (1366×768) ===\n');
  await page.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  // Hero
  const heroBox = await page.$eval('.hero', el => {
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  });
  console.log(`Hero: ${heroBox.width}×${heroBox.height}px`);

  const h1 = await page.$eval('.hero-left h1', el => {
    const s = getComputedStyle(el);
    return { text: el.textContent.trim().slice(0, 50), fontSize: s.fontSize, width: Math.round(el.getBoundingClientRect().width) };
  });
  console.log(`H1: "${h1.text}" | font-size: ${h1.fontSize} | width: ${h1.width}px`);

  const desc = await page.$eval('.hero-desc', el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, width: Math.round(el.getBoundingClientRect().width) };
  });
  console.log(`Description: font-size: ${desc.fontSize} | width: ${desc.width}px`);

  // Search bar
  const search = await page.$eval('.hero-search', el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { width: Math.round(r.width), height: Math.round(r.height), maxWidth: s.maxWidth };
  });
  console.log(`\nSearch bar: ${search.width}×${search.height}px (max-width: ${search.maxWidth})`);

  const inputPH = await page.$eval('#toolSearch', el => el.placeholder);
  console.log(`Placeholder: "${inputPH}"`);

  // Featured section
  const featured = await page.$$eval('.featured-card', cards => cards.length);
  console.log(`\nFeatured cards: ${featured}`);

  // Tool grid
  const toolCards = await page.$$eval('.tool-card[data-tool]', cards => cards.length);
  console.log(`Tool cards: ${toolCards}`);

  const cardBox = await page.$eval('.tool-card[data-tool]', el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { width: Math.round(r.width), height: Math.round(r.height), display: s.display, fontSize: getComputedStyle(el.querySelector('strong')).fontSize };
  });
  console.log(`Card size: ${cardBox.width}×${cardBox.height}px | display: ${cardBox.display} | name-font: ${cardBox.fontSize}`);

  // Tool icons
  const icons = await page.$$eval('.tool-card[data-tool] .tool-icon', els => {
    const missing = els.filter(el => !el.textContent.trim()).length;
    const total = els.length;
    return { total, missing };
  });
  console.log(`Icons: ${icons.total} total, ${icons.missing} missing`);

  // Sections
  const sections = ['featured-section', 'tools-section', 'why-section', 'how-section', 'local-banner', 'site-footer'];
  for (const cls of sections) {
    const exists = await page.$(`.${cls}`);
    const box = exists ? await page.$eval(`.${cls}`, el => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}×${Math.round(r.height)}`;
    }) : 'MISSING';
    console.log(`Section .${cls}: ${box}`);
  }

  // Breadcrumbs (should NOT be on homepage)
  const bcHome = await page.$('.breadcrumbs');
  console.log(`\nBreadcrumbs on homepage: ${bcHome ? 'YES (wrong)' : 'NO (correct)'}`);

  // No file input on homepage
  const fiHome = await page.$('#fileInput');
  console.log(`File input on homepage: ${fiHome ? 'YES (wrong)' : 'NO (correct)'}`);

  // No drop zone on homepage
  const dzHome = await page.$('#dropZone');
  console.log(`Drop zone on homepage: ${dzHome ? 'YES (wrong)' : 'NO (correct)'}`);

  // Counter - check in intro element or in hero-trust
  const heroTrust = await page.$eval('.hero-trust', el => el.textContent.trim());
  console.log(`Hero trust line: "${heroTrust}"`);

  // ═══ TOOL PAGE CHECKS ═══
  console.log('\n\n=== TOOL PAGE: /comprimir-imagen.html ===\n');
  await page.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Hero layout
  const heroTool = await page.$eval('.hero', el => {
    const s = getComputedStyle(el);
    return { classes: el.className, display: s.display };
  });
  console.log(`Hero classes: "${heroTool.classes}" | display: ${heroTool.display}`);

  // hero-right visibility
  const heroRight = await page.$eval('.hero-right', el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: s.display, visible: r.width > 0 && r.height > 0, width: Math.round(r.width), height: Math.round(r.height) };
  });
  console.log(`hero-right: display=${heroRight.display} visible=${heroRight.visible} ${heroRight.width}×${heroRight.height}px`);

  // Drop zone
  const dropZone = await page.$eval('#dropZone', el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { visible: r.width > 0 && r.height > 0, width: Math.round(r.width), height: Math.round(r.height), display: s.display };
  });
  console.log(`Drop zone: visible=${dropZone.visible} ${dropZone.width}×${dropZone.height}px`);

  // Browse button
  const browseBtn = await page.$eval('#browseButton', el => {
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0, text: el.textContent.trim() };
  });
  console.log(`Browse button: visible=${browseBtn.visible} "${browseBtn.text}"`);

  // Run button
  const runBtn = await page.$eval('#runButton', el => {
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0, text: el.textContent.trim(), disabled: el.disabled };
  });
  console.log(`Run button: visible=${runBtn.visible} "${runBtn.text}" disabled=${runBtn.disabled}`);

  // Breadcrumbs
  const breadcrumbs = await page.$eval('.breadcrumbs', el => {
    const s = getComputedStyle(el);
    return { display: s.display, flexDirection: s.flexDirection, text: el.textContent.trim().replace(/\s+/g, ' ') };
  });
  console.log(`Breadcrumbs: display=${breadcrumbs.display} direction=${breadcrumbs.flexDirection} "${breadcrumbs.text}"`);

  // Tool content sections
  const tcSections = ['formats-info', 'instructions', 'limitations', 'faq-section', 'related-tools'];
  for (const cls of tcSections) {
    const el = await page.$(`.${cls}`);
    if (el) {
      const box = await el.boundingBox();
      console.log(`.${cls}: ${box ? `${Math.round(box.width)}×${Math.round(box.height)}px` : 'no box'}`);
    } else {
      console.log(`.${cls}: MISSING`);
    }
  }

  // FAQ items
  const faqItems = await page.$$('.faq-item');
  console.log(`FAQ items: ${faqItems.length}`);

  // Related tools
  const relatedCards = await page.$$('.related-tools .tool-card');
  console.log(`Related tool cards: ${relatedCards.length}`);

  // ═══ ANOTHER TOOL PAGE ═══
  console.log('\n=== TOOL PAGE: /unir-pdf.html ===\n');
  await page.goto(BASE + '/unir-pdf.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const pdfDz = await page.$eval('#dropZone', el => {
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0, width: Math.round(r.width), height: Math.round(r.height) };
  });
  console.log(`Drop zone: visible=${pdfDz.visible} ${pdfDz.width}×${pdfDz.height}px`);

  const pdfBc = await page.$eval('.breadcrumbs', el => el.textContent.trim().replace(/\s+/g, ' '));
  console.log(`Breadcrumbs: "${pdfBc}"`);

  // ═══ SEARCH FUNCTIONALITY ═══
  console.log('\n\n=== SEARCH FUNCTIONALITY ===\n');
  await page.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  const searches = ['PDF', 'comprimir', 'Word a PDF', 'JPG a PNG', 'firma', 'csv', 'epub', 'xyznoexist'];
  for (const q of searches) {
    await page.fill('#toolSearch', q);
    await page.waitForTimeout(100);
    const visible = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
    const emptyHidden = await page.$eval('#emptyTools', el => el.hidden);
    console.log(`"${q}": ${visible} results, empty=${!emptyHidden ? 'hidden' : 'visible'}`);
  }

  // Clear
  await page.fill('#toolSearch', '');
  await page.waitForTimeout(100);
  const afterClear = await page.$$eval('.tool-card[data-tool]', cards => cards.filter(c => !c.hidden).length);
  console.log(`After clear: ${afterClear} results`);

  // ═══ RESPONSIVE CHECKS ═══
  console.log('\n\n=== RESPONSIVE CHECKS ===\n');
  const viewports = [
    { w: 360, h: 800, name: '360×800' },
    { w: 768, h: 1024, name: '768×1024' },
    { w: 1366, h: 768, name: '1366×768' },
    { w: 1920, h: 1080, name: '1920×1080' },
  ];
  let page2;
  for (const vp of viewports) {
    await page.close();
    page2 = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page2.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
    await page2.waitForTimeout(3500);

    const hScroll = await page2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const cards = await page2.$$eval('.tool-card[data-tool]', cs => cs.filter(c => !c.hidden).length);
    console.log(`${vp.name}: h-scroll=${hScroll} cards=${cards}`);

    await page2.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'networkidle' });
    await page2.waitForTimeout(1500);
    const toolHScroll = await page2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const dzVis = await page2.$eval('#dropZone', el => el.getBoundingClientRect().width > 0);
    console.log(`  Tool page: h-scroll=${toolHScroll} dropZone=${dzVis}`);
    await page2.close();
  }

  await browser.close();
  console.log('\n✓ All checks complete');
})();
