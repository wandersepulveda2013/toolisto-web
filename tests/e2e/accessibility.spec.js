const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test.describe('Accessibility Audit', () => {
  test('homepage has no critical/serious violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    
    const critical = results.violations.filter(v => v.impact === 'critical');
    const serious = results.violations.filter(v => v.impact === 'serious');
    
    if (critical.length > 0) {
      console.error('CRITICAL violations:', critical.map(v => v.id + ': ' + v.description).join('\n'));
    }
    if (serious.length > 0) {
      console.error('SERIOUS violations:', serious.map(v => v.id + ': ' + v.description).join('\n'));
    }
    
    expect(critical.length).toBe(0);
    expect(serious.length).toBe(0);
  });

  test('toolisto page has no critical/serious violations', async ({ page }) => {
    await page.goto('/toolisto');
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    
    const critical = results.violations.filter(v => v.impact === 'critical');
    const serious = results.violations.filter(v => v.impact === 'serious');
    
    expect(critical.length).toBe(0);
    expect(serious.length).toBe(0);
  });

  const representativeTools = [
    'comprimir-pdf',
    'comprimir-imagen',
    'estadisticas-texto',
    'csv-a-excel',
    'generar-qr',
    'convertir-audio',
    'comprimir-video',
    'unir-pdf',
    'firmar-pdf',
    'crear-zip-avanzado',
  ];

  for (const slug of representativeTools) {
    test(`${slug} has no critical/serious violations`, async ({ page }) => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      
      const critical = results.violations.filter(v => v.impact === 'critical');
      const serious = results.violations.filter(v => v.impact === 'serious');
      
      if (critical.length > 0) {
        console.error(`${slug} CRITICAL:`, critical.map(v => v.id + ': ' + v.description).join('\n'));
      }
      if (serious.length > 0) {
        console.error(`${slug} SERIOUS:`, serious.map(v => v.id + ': ' + v.description).join('\n'));
      }
      
      expect(critical.length).toBe(0);
      expect(serious.length).toBe(0);
    });
  }
});
