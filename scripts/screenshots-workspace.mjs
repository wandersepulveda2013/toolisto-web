#!/usr/bin/env node
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = join(__dirname, '..', 'screenshots', 'workspace');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

// 1. Inicio
await page.goto('http://localhost:8080/workspace/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(SCREENSHOTS, 'current-01-inicio.png') });
console.log('1. Inicio');

// 2. Create a project to unlock all views
await page.click('#ws-welcome-new');
await page.waitForTimeout(300);
await page.fill('#modal-project-name', 'Proyecto Demo');
await page.fill('#modal-project-desc', 'Proyecto de prueba para capturas');
await page.click('.ws-btn-confirm');
await page.waitForTimeout(500);
await page.screenshot({ path: join(SCREENSHOTS, 'current-02-dashboard.png') });
console.log('2. Dashboard');

// 3. Captura
await page.click('.sidebar-item[data-view="capture"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-03-captura.png') });
console.log('3. Captura');

// 4. Documento
await page.click('.sidebar-item[data-view="documents"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-04-documento.png') });
console.log('4. Documento');

// 5. Datos
await page.click('.sidebar-item[data-view="data"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-05-datos.png') });
console.log('5. Datos');

// 6. Query
await page.click('.sidebar-item[data-view="query"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-06-query.png') });
console.log('6. Query');

// 7. Dashboards
await page.click('.sidebar-item[data-view="dashboards"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-07-dashboards.png') });
console.log('7. Dashboards');

// 8. Flow
await page.click('.sidebar-item[data-view="flow"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-08-flow.png') });
console.log('8. Flow');

// 9. Tools
await page.click('.sidebar-item[data-view="tools"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-09-tools.png') });
console.log('9. Tools');

// 10. Palette Ctrl+K
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-10-palette.png') });
console.log('10. Palette');
await page.keyboard.press('Escape');

// 11. Dark mode
await page.click('.sidebar-item[data-view="projects"]');
await page.waitForTimeout(200);
await page.click('[aria-label="Cambiar tema"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-11-dark.png') });
console.log('11. Dark mode');

// 12. Compact density
await page.click('[aria-label="Cambiar densidad"]');
await page.waitForTimeout(200);
await page.click('[aria-label="Cambiar densidad"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-12-compact-dark.png') });
console.log('12. Compact + Dark');

// 13. Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(SCREENSHOTS, 'current-13-mobile.png') });
console.log('13. Mobile');

await browser.close();
console.log('\nCapturas en screenshots/workspace/current-*.png');
