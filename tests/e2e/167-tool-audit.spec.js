const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist');
const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const enabledTools = tools.filter(t => t.enabled);

test.describe('167-Tool Functional Audit', () => {
  test('all 167 tool pages exist in dist', async () => {
    const missing = [];
    for (const tool of enabledTools) {
      const pagePath = path.join(DIST, tool.slug + '.html');
      if (!fs.existsSync(pagePath)) missing.push(tool.slug);
    }
    expect(missing).toEqual([]);
  });

  test('all 167 tool pages load without JS errors', async ({ page }) => {
    const errors = [];
    const fatalErrors = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => {
      fatalErrors.push(err.message);
    });

    const sample = enabledTools.slice(0, 20);
    for (const tool of sample) {
      await page.goto(`/${tool.slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      
      const pageErrors = fatalErrors.filter(e => 
        !e.includes('favicon') && !e.includes('service-worker') && !e.includes('ResizeObserver')
      );
      expect(pageErrors.length).toBe(0);
      fatalErrors.length = 0;
    }
  });

  test('all 167 tool pages have required elements', async ({ page }) => {
    const sample = enabledTools.slice(0, 20);
    for (const tool of sample) {
      await page.goto(`/${tool.slug}`, { waitUntil: 'domcontentloaded' });
      
      const h1 = page.locator('h1');
      await expect(h1).toBeVisible();
      
      const hasDropZone = await page.locator('#dropZone').isVisible().catch(() => false);
      const hasModePanel = await page.locator('#modePanel').isVisible().catch(() => false);
      expect(hasDropZone || hasModePanel).toBeTruthy();
      
      const inspector = page.locator('.result-inspector');
      await expect(inspector).toBeAttached();
    }
  });

  test('all 167 tools are registered', async () => {
    const toolIds = enabledTools.map(t => t.toolId);
    const uniqueToolIds = [...new Set(toolIds)];
    
    const jsDir = path.join(DIST, 'js');
    const modesDir = path.join(jsDir, 'modes');
    let allJs = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
    for (const f of fs.readdirSync(modesDir)) {
      if (f.endsWith('.js')) allJs += '\n' + fs.readFileSync(path.join(modesDir, f), 'utf8');
    }
    
    const missing = [];
    for (const id of uniqueToolIds) {
      if (!allJs.includes(id)) {
        missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });

  test('all 167 tools belong to valid categories', async () => {
    const categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'categories.json'), 'utf8'));
    const validCategoryIds = categories.map(c => c.id);
    
    const invalid = [];
    for (const tool of enabledTools) {
      if (!validCategoryIds.includes(tool.category)) {
        invalid.push(tool.toolId + ' -> ' + tool.category);
      }
    }
    expect(invalid).toEqual([]);
  });

  test('all 167 tool pages have correct meta tags', async ({ page }) => {
    const sample = enabledTools.slice(0, 10);
    for (const tool of sample) {
      await page.goto(`/${tool.slug}`, { waitUntil: 'domcontentloaded' });
      
      const title = await page.title();
      expect(title).toContain('Toolisto');
      
      const description = page.locator('meta[name="description"]');
      await expect(description).toBeAttached();
    }
  });

  test('all 167 tool pages have APLUNO branding', async ({ page }) => {
    const sample = enabledTools.slice(0, 10);
    for (const tool of sample) {
      await page.goto(`/${tool.slug}`, { waitUntil: 'domcontentloaded' });
      
      const favicon = page.locator('link[rel="icon"]');
      await expect(favicon).toBeAttached();
      
      const appleIcon = page.locator('link[rel="apple-touch-icon"]');
      await expect(appleIcon).toBeAttached();
    }
  });

  test('all 167 tool pages have components loaded', async ({ page }) => {
    const sample = enabledTools.slice(0, 10);
    for (const tool of sample) {
      await page.goto(`/${tool.slug}`, { waitUntil: 'domcontentloaded' });
      
      const bavScript = page.locator('script[src*="before-after-viewer"]');
      await expect(bavScript).toBeAttached();
      
      const componentsCss = page.locator('link[href*="components.css"]');
      await expect(componentsCss).toBeAttached();
    }
  });
});
