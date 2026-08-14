const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const sections = [
    { name: 'hero', selector: '.hero' },
    { name: 'quick-actions', selector: '.quick-actions' },
    { name: 'featured', selector: '.featured-section' },
    { name: 'categories', selector: '.categories-section' },
    { name: 'tools-filters', selector: '.tools-section .tools-header' },
    { name: 'why', selector: '.why-section' },
    { name: 'how', selector: '.how-section' },
    { name: 'privacy', selector: '.privacy-section' },
    { name: 'workspace', selector: '.workspace-section' },
    { name: 'support', selector: '.support-section' },
    { name: 'footer', selector: '.site-footer' },
  ];

  for (const s of sections) {
    const el = await page.$(s.selector);
    if (el) {
      await el.screenshot({ path: path.join(SCREENSHOTS_DIR, `redesign-${s.name}.png`) });
      console.log(`✓ redesign-${s.name}.png`);
    } else {
      console.log(`✗ ${s.name} not found`);
    }
  }

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'redesign-full-desktop.png'), fullPage: true });
  console.log('✓ redesign-full-desktop.png');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(4000);
  await mobile.screenshot({ path: path.join(SCREENSHOTS_DIR, 'redesign-full-mobile.png'), fullPage: true });
  console.log('✓ redesign-full-mobile.png');

  const dark = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await dark.goto('http://localhost:8080', { waitUntil: 'networkidle' });
  await dark.waitForTimeout(4000);
  await dark.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await dark.waitForTimeout(500);
  await dark.screenshot({ path: path.join(SCREENSHOTS_DIR, 'redesign-full-dark.png'), fullPage: true });
  console.log('✓ redesign-full-dark.png');

  await browser.close();
  console.log('\nAll redesign screenshots saved.');
})();
