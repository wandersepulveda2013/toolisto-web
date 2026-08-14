const { chromium } = require('playwright');
const { mkdirSync } = require('fs');
const { join } = require('path');

const BASE = 'http://localhost:8080';
const SHOTS = join(__dirname, '..', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // Desktop homepage
  let page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500); // Wait for splash to finish
  await page.screenshot({ path: join(SHOTS, 'homepage-desktop.png'), fullPage: true });
  console.log('✓ homepage-desktop.png');

  // Desktop tool page
  await page.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, 'tool-desktop.png'), fullPage: true });
  console.log('✓ tool-desktop.png');

  // Desktop tool page - PDF
  await page.goto(BASE + '/unir-pdf.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, 'tool-pdf-desktop.png'), fullPage: true });
  console.log('✓ tool-pdf-desktop.png');

  // Mobile homepage
  await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(SHOTS, 'homepage-mobile.png'), fullPage: true });
  console.log('✓ homepage-mobile.png');

  // Mobile tool page
  await page.goto(BASE + '/comprimir-imagen.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, 'tool-mobile.png'), fullPage: true });
  console.log('✓ tool-mobile.png');

  // Tablet homepage
  await page.close();
  page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  await page.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(SHOTS, 'homepage-tablet.png'), fullPage: true });
  console.log('✓ homepage-tablet.png');

  // Dark mode
  await page.close();
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(BASE + '/toolisto', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'homepage-dark.png'), fullPage: true });
  console.log('✓ homepage-dark.png');

  await browser.close();
  console.log('\nAll screenshots saved to', SHOTS);
})();
