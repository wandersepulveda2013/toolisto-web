#!/usr/bin/env node
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const browser = await chromium.launch();
const errors = [];
const warnings = [];
const consoleMessages = [];

async function testViewport(name, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    consoleMessages.push({ viewport: name, type, text });
    if (type === 'error') errors.push({ viewport: name, text });
    if (type === 'warning') warnings.push({ viewport: name, text });
  });
  
  page.on('pageerror', err => {
    errors.push({ viewport: name, text: 'PAGE ERROR: ' + err.message });
  });

  try {
    await page.goto('http://localhost:8080/workspace/?preview=internal', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(500);
    console.log(`${name} (${width}x${height}): Loaded OK`);

    // Test: Create project
    const welcomeBtn = await page.$('#ws-welcome-new');
    if (welcomeBtn) {
      await welcomeBtn.click();
      await page.waitForTimeout(300);
      await page.fill('#modal-project-name', 'Test Audit');
      await page.fill('#modal-project-desc', 'Auditoria');
      await page.click('.ws-btn-confirm');
      await page.waitForTimeout(500);
      console.log(`  - Project created`);
    }

    // Test: Navigate all views
    const views = ['intake', 'capture', 'documents', 'data', 'query', 'dashboards', 'flow', 'tools'];
    for (const v of views) {
      try {
        await page.click(`.sidebar-item[data-view="${v}"]`, { timeout: 3000 });
        await page.waitForTimeout(200);
        console.log(`  - View "${v}" rendered`);
      } catch (e) {
        errors.push({ viewport: name, text: `View "${v}" navigation failed: ${e.message.split('\n')[0]}` });
        console.log(`  - View "${v}" FAILED`);
      }
    }

    // Test: Theme toggle
    try {
      await page.click('[aria-label="Cambiar tema"]', { timeout: 2000 });
      await page.waitForTimeout(200);
      console.log(`  - Theme toggle OK`);
    } catch (e) {
      errors.push({ viewport: name, text: 'Theme toggle failed' });
    }

    // Test: Density toggle
    try {
      await page.click('[aria-label="Cambiar densidad"]', { timeout: 2000 });
      await page.waitForTimeout(200);
      console.log(`  - Density toggle OK`);
    } catch (e) {
      errors.push({ viewport: name, text: 'Density toggle failed' });
    }

    // Test: Ctrl+K
    try {
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(200);
      const pal = await page.$('.ws-palette-overlay');
      if (pal) console.log(`  - Palette OK`);
      else errors.push({ viewport: name, text: 'Palette did not open' });
      await page.keyboard.press('Escape');
    } catch (e) {
      errors.push({ viewport: name, text: 'Palette failed' });
    }

    // Check for invisible/clickable issues at this viewport
    const sidebarVisible = await page.$eval('.ws-sidebar', el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).catch(() => false);
    
    const contentVisible = await page.$eval('#ws-main-content', el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).catch(() => false);
    
    console.log(`  - Sidebar visible: ${sidebarVisible}, Content visible: ${contentVisible}`);

    // Check for overflow
    const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (hasHScroll) {
      errors.push({ viewport: name, text: 'Horizontal scroll detected (overflow)' });
      console.log(`  - WARNING: Horizontal scroll!`);
    }

  } catch (e) {
    errors.push({ viewport: name, text: 'Page load failed: ' + e.message.split('\n')[0] });
    console.log(`${name}: FAILED to load`);
  }
  
  await page.close();
}

console.log('=== Browser Audit ===\n');
console.log('Testing viewports...\n');
await testViewport('390px', 390, 844);
await testViewport('768px', 768, 1024);
await testViewport('1024px', 1024, 768);
await testViewport('1366px', 1366, 768);
await testViewport('1920px', 1920, 1080);

console.log('\n=== Console Errors ===');
if (errors.length === 0) {
  console.log('No errors found!');
} else {
  errors.forEach(e => console.log(`  [${e.viewport}] ${e.text}`));
}

console.log(`\n=== Console Warnings: ${warnings.length} ===`);
warnings.forEach(w => console.log(`  [${w.viewport}] ${w.text}`));

console.log(`\n=== Summary ===`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);

await browser.close();
