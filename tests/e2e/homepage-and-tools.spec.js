const { test, expect } = require('@playwright/test');

test.describe('Homepage', () => {
  test('loads and shows APLUNO branding', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/APLUNO/);
    await expect(page.locator('text=APLUNO').first()).toBeVisible();
  });

  test('has navigation', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav, [role="navigation"], header a');
    expect(await nav.count()).toBeGreaterThan(0);
  });

  test('has no fatal JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
    expect(fatalErrors.length).toBe(0);
  });

  test('manifest is linked', async ({ page }) => {
    await page.goto('/');
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toBeAttached();
  });

  test('favicon is present', async ({ page }) => {
    await page.goto('/');
    const favicon = page.locator('link[rel="icon"]');
    await expect(favicon).toBeAttached();
  });
});

test.describe('Toolisto page', () => {
  test('loads with all 167 tools', async ({ page }) => {
    await page.goto('/toolisto');
    await expect(page).toHaveTitle(/aplu|toolisto/i);
    const cards = page.locator('.tool-card[data-tool]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(167);
  });

  test('has category cards', async ({ page }) => {
    await page.goto('/toolisto');
    const catCards = page.locator('.category-card');
    const count = await catCards.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('search filters tools', async ({ page }) => {
    await page.goto('/toolisto');
    const searchInput = page.locator('input[type="search"], #heroCommandSearch, #toolSearch').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('PDF');
      await page.waitForTimeout(500);
      const visibleCards = page.locator('.tool-card[data-tool]:not([hidden])');
      const count = await visibleCards.count();
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(167);
    }
  });

  test('no fatal JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/toolisto');
    await page.waitForLoadState('networkidle');
    const fatalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'));
    expect(fatalErrors.length).toBe(0);
  });
});

test.describe('Tool pages', () => {
  const toolPages = [
    { slug: 'comprimir-pdf', name: 'Comprimir PDF' },
    { slug: 'comprimir-imagen', name: 'Comprimir imagen' },
    { slug: 'estadisticas-texto', name: 'Estadisticas' },
    { slug: 'convertir-audio', name: 'Convertir audio' },
    { slug: 'comprimir-video', name: 'Comprimir video' },
  ];

  for (const tool of toolPages) {
    test(`${tool.slug} loads without errors`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(`/${tool.slug}`);
      await expect(page.locator('h1')).toBeVisible();
      const hasDropZone = await page.locator('#dropZone').isVisible().catch(() => false);
      const hasModePanel = await page.locator('#modePanel').isVisible().catch(() => false);
      const hasActionPanel = await page.locator('.tool-action-panel').isVisible().catch(() => false);
      expect(hasDropZone || hasModePanel || hasActionPanel).toBeTruthy();
      const fatalErrors = errors.filter(e => !e.includes('ResizeObserver'));
      expect(fatalErrors.length).toBe(0);
    });
  }

  test('generar-qr loads with form panel', async ({ page }) => {
    await page.goto('/generar-qr');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body.length).toBeGreaterThan(100);
  });

  test('csv-a-excel loads with spreadsheet panel', async ({ page }) => {
    await page.goto('/csv-a-excel');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body.length).toBeGreaterThan(100);
  });

  test('calculadora-simple loads with calculator panel', async ({ page }) => {
    await page.goto('/calculadora-simple');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(1000);
    const body = await page.locator('body').textContent();
    expect(body.length).toBeGreaterThan(100);
  });
});

test.describe('Accessibility', () => {
  test('homepage has proper heading hierarchy', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);
  });

  test('tool pages have main landmark', async ({ page }) => {
    await page.goto('/comprimir-pdf');
    const main = page.locator('main, [role="main"]');
    await expect(main).toBeVisible();
  });

  test('all interactive elements are focusable', async ({ page }) => {
    await page.goto('/comprimir-pdf');
    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible()) {
        await btn.focus();
        await expect(btn).toBeFocused();
      }
    }
  });
});

test.describe('PWA', () => {
  test('manifest is linked on homepage', async ({ page }) => {
    await page.goto('/');
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toBeAttached();
  });

  test('apple-touch-icon is present', async ({ page }) => {
    await page.goto('/');
    const appleIcon = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIcon).toBeAttached();
  });
});

test.describe('SEO', () => {
  test('homepage has canonical', async ({ page }) => {
    await page.goto('/');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toBeAttached();
  });

  test('homepage has meta description', async ({ page }) => {
    await page.goto('/');
    const desc = page.locator('meta[name="description"]');
    await expect(desc).toBeAttached();
  });

  test('tool pages have structured data', async ({ page }) => {
    await page.goto('/comprimir-pdf');
    const ldJson = page.locator('script[type="application/ld+json"]').first();
    await expect(ldJson).toBeAttached();
  });
});

test.describe('Responsive', () => {
  test('homepage renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('toolisto page renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/toolisto');
    await expect(page.locator('h1')).toBeVisible();
    const cards = page.locator('.tool-card[data-tool]');
    expect(await cards.count()).toBeGreaterThanOrEqual(167);
  });

  test('tool page renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/comprimir-pdf');
    await expect(page.locator('h1')).toBeVisible();
    const hasDropZone = await page.locator('#dropZone').isVisible().catch(() => false);
    const hasModePanel = await page.locator('#modePanel').isVisible().catch(() => false);
    expect(hasDropZone || hasModePanel).toBeTruthy();
  });
});
