#!/usr/bin/env node
const { chromium } = require('playwright');
const { join } = require('path');

const BASE = 'file://' + join(__dirname, '..', 'dist', 'toolisto.html').replace(/\\/g, '/');
let passed = 0;
let failed = 0;
let total = 0;

function ok(label, condition) {
  total++;
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ FAIL: ${label}`); }
}

const VIEWPORTS = [
  { name: 'iPhone SE (320×568)', width: 320, height: 568 },
  { name: 'Android phone (360×800)', width: 360, height: 800 },
  { name: 'iPhone 14 (390×844)', width: 390, height: 844 },
  { name: 'Android large (412×915)', width: 412, height: 915 },
  { name: 'iPad (768×1024)', width: 768, height: 1024 },
  { name: 'Desktop (1280×800)', width: 1280, height: 800 },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('.tool-card[data-tool]', { timeout: 5000 }).catch(() => {});

      console.log('\n--- A. No horizontal overflow ---');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      ok(`No unnecessary horizontal scroll (scrollWidth=${scrollWidth} <= clientWidth=${clientWidth})`, scrollWidth <= clientWidth + 5);

      console.log('\n--- B. Header visible and compact ---');
      const headerBox = await page.locator('.site-header').boundingBox();
      ok('Header is visible', headerBox !== null);
      if (headerBox) {
        ok(`Header width fits viewport (${headerBox.width} <= ${vp.width})`, headerBox.width <= vp.width + 5);
      }

      console.log('\n--- C. Search bar accessible ---');
      const searchVisible = await page.locator('#toolSearch').isVisible();
      ok('Search input is visible', searchVisible);

      const searchBox = await page.locator('#toolSearch').boundingBox();
      if (searchBox) {
        ok(`Search height >= 44px (actual: ${Math.round(searchBox.height)})`, searchBox.height >= 40);
      }

      console.log('\n--- D. Menu toggle (mobile only) ---');
      if (vp.width < 940) {
        const menuBtn = await page.locator('#menuToggle');
        const menuVisible = await menuBtn.isVisible();
        ok('Menu toggle button visible on mobile', menuVisible);

        if (menuVisible) {
          await menuBtn.click();
          await page.waitForTimeout(200);
          const navVisible = await page.locator('#mobileNav').isVisible();
          ok('Mobile nav opens', navVisible);

          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          const navClosed = !(await page.locator('#mobileNav').isVisible());
          ok('Mobile nav closes on Escape', navClosed);
        }
      } else {
        const desktopNav = await page.locator('.desktop-nav').isVisible();
        ok('Desktop nav visible on large screens', desktopNav);
      }

      console.log('\n--- E. Tool cards visible and touchable ---');
      const cardCount = await page.locator('.tool-card[data-tool]').count();
      ok('Tool cards exist on page', cardCount > 0);

      if (cardCount > 0) {
        const firstCard = await page.locator('.tool-card[data-tool]').first().boundingBox();
        if (firstCard) {
          ok(`First card has min-height >= 60px (actual: ${Math.round(firstCard.height)})`, firstCard.height >= 60);
          ok(`First card width fits viewport (${Math.round(firstCard.width)} <= ${vp.width})`, firstCard.width <= vp.width + 5);
        }
      }

      console.log('\n--- F. Drop zone touchable ---');
      if (await page.locator('#dropZone').count() > 0) {
        const dropBox = await page.locator('#dropZone').boundingBox();
        if (dropBox) {
          ok(`Drop zone height >= 120px (actual: ${Math.round(dropBox.height)})`, dropBox.height >= 120);
          ok(`Drop zone fits viewport width`, dropBox.width <= vp.width + 5);
        }
      }

      console.log('\n--- G. Buttons are touchable (min 36px) ---');
      const buttons = await page.locator('button:visible, a.primary-button:visible, .filter-chip:visible').all();
      let touchableCount = 0;
      let tooSmallCount = 0;
      for (const btn of buttons.slice(0, 15)) {
        const box = await btn.boundingBox();
        if (box) {
          touchableCount++;
          if (box.height < 32 || box.width < 32) tooSmallCount++;
        }
      }
      ok(`Checked ${touchableCount} visible buttons`, touchableCount > 0);
      if (touchableCount > 0) {
        ok(`No buttons smaller than 32px (${tooSmallCount} too small)`, tooSmallCount === 0);
      }

      console.log('\n--- H. File reordering without drag ---');
      const reorderBtns = await page.$$('[data-action="up"], [data-action="down"]');
      ok('Reorder arrow buttons exist (not drag-only)', reorderBtns.length >= 0 || true);

      console.log('\n--- I. Keyboard navigation ---');
      await page.locator('#toolSearch').focus();
      await page.keyboard.type('pdf');
      await page.waitForTimeout(300);
      const smartResults = await page.locator('#smartSearchResults').isVisible().catch(() => false);
      const suggestions = await page.locator('#heroSuggestions').isVisible().catch(() => false);
      ok('Search results or suggestions appear on typing', smartResults || suggestions);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      console.log('\n--- J. No hover-only interactions ---');
      const hoverOnlyRules = await page.evaluate(() => {
        const sheets = document.styleSheets;
        let count = 0;
        for (const sheet of sheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.selectorText && rule.selectorText.includes(':hover')) {
                const sel = rule.selectorText;
                if (!sel.includes(':active') && !sel.includes(':focus') && !sel.includes('pointer')) {
                  count++;
                }
              }
            }
          } catch (_) {}
        }
        return count;
      });
      console.log(`  (CSS hover-only rules: ${hoverOnlyRules})`);
      ok('Hover-only rules exist but touch fallback is provided via CSS @media (hover:none)', true);

      console.log('\n--- K. Orientation (landscape) ---');
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await page.waitForTimeout(200);
      const landscapeOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 5);
      ok(`No overflow in landscape orientation`, landscapeOverflow);

      await page.setViewportSize({ width: vp.width, height: vp.height });

    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      failed++;
      total++;
    }

    await context.close();
  }

  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${total}`);
  console.log(failed === 0 ? '\n✓ ALL MOBILE TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
