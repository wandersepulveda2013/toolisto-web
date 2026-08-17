const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist');

test.describe('Regression Tests', () => {
  test('category counts sum to 167', async () => {
    const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
    const enabled = tools.filter(t => t.enabled);
    
    expect(enabled.length).toBe(167);
    
    const catCounts = {};
    for (const t of enabled) {
      catCounts[t.category] = (catCounts[t.category] || 0) + 1;
    }
    const sum = Object.values(catCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(167);
  });

  test('no old Toolisto T-mark in tool pages', async () => {
    const html = fs.readFileSync(path.join(DIST, 'comprimir-pdf.html'), 'utf8');
    expect(html).not.toMatch(/class="toolisto[^"]*T[^"]*mark/);
    expect(html).toContain('APLUNO');
  });

  test('favicon is APLUNO', async () => {
    const html = fs.readFileSync(path.join(DIST, 'comprimir-pdf.html'), 'utf8');
    expect(html).toContain('toolisto-mark.svg');
    expect(html).toContain('apple-touch-icon.png');
  });

  test('manifest is present', async () => {
    expect(fs.existsSync(path.join(DIST, 'assets', 'manifest.webmanifest'))).toBeTruthy();
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'assets', 'manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBeDefined();
    expect(manifest.icons).toBeDefined();
  });

  test('ResultInspector is in tool pages', async () => {
    const html = fs.readFileSync(path.join(DIST, 'comprimir-pdf.html'), 'utf8');
    expect(html).toContain('result-inspector');
    expect(html).toContain('inspectorInput');
    expect(html).toContain('inspectorOutput');
    expect(html).toContain('inspectorRatio');
    expect(html).toContain('inspectorTime');
  });

  test('P0 copy fixes are present', async () => {
    const html = fs.readFileSync(path.join(DIST, 'toolisto.html'), 'utf8');
    expect(html).not.toContain('Sube un archivo');
    expect(html).not.toContain('procesamiento instantáneo');
    expect(html).toContain('Selecciona');
    expect(html).toContain('Sin tiempo de subida');
  });

  test('components CSS is loaded in tool pages', async () => {
    const html = fs.readFileSync(path.join(DIST, 'comprimir-pdf.html'), 'utf8');
    expect(html).toContain('components.css');
  });

  test('components JS are loaded in tool pages', async () => {
    const html = fs.readFileSync(path.join(DIST, 'comprimir-pdf.html'), 'utf8');
    expect(html).toContain('before-after-viewer.js');
    expect(html).toContain('pdf-page-navigator.js');
    expect(html).toContain('data-grid.js');
    expect(html).toContain('live-text-editor.js');
    expect(html).toContain('generator-preview.js');
  });

  test('167 tool pages exist in dist', async () => {
    const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
    const enabled = tools.filter(t => t.enabled);
    const missing = [];
    for (const tool of enabled) {
      if (!fs.existsSync(path.join(DIST, tool.slug + '.html'))) missing.push(tool.slug);
    }
    expect(missing).toEqual([]);
  });

  test('all tool cards have data-tool attribute', async () => {
    const html = fs.readFileSync(path.join(DIST, 'toolisto.html'), 'utf8');
    const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
    const enabled = tools.filter(t => t.enabled);
    for (const tool of enabled) {
      expect(html).toContain(`data-tool="${tool.toolId}"`);
    }
  });

  test('service worker script is present', async () => {
    const swExists = fs.existsSync(path.join(DIST, 'service-worker.js')) || fs.existsSync(path.join(DIST, 'sw.js'));
    expect(swExists).toBeTruthy();
  });

  test('robots.txt exists', async () => {
    expect(fs.existsSync(path.join(DIST, 'robots.txt'))).toBeTruthy();
  });

  test('sitemap.xml exists', async () => {
    expect(fs.existsSync(path.join(DIST, 'sitemap.xml'))).toBeTruthy();
  });
});
