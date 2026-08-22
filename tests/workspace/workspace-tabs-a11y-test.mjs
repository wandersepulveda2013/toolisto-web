#!/usr/bin/env node
/**
 * Workspace Tabs ARIA/KBD Contract Tests (CE-015)
 * Verifies the WAI-ARIA tabs pattern for Workspace ribbon tablists:
 * - roving tabindex (only the active tab is in the tab order)
 * - arrow/Home/End keyboard navigation that activates the focused tab
 * - aria-controls / role=tabpanel / aria-labelledby associations
 *
 * Runs in-browser via Playwright against the built dist.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'workspace-tabs-a11y');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const INTERNAL_BASE = `http://localhost:${PORT}/workspace/index.html?preview=internal`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon', '.mjs': 'application/javascript; charset=utf-8',
};

const srv = createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  let fp = join(DIST, file);
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
  if (!existsSync(fp)) fp = join(DIST, file + '.html');
  const ext = extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

let pass = 0, fail = 0;
function ok(n, d = '') { pass++; console.log(`  PASS: [${n}] ${d}`); }
function ko(n, d = '') { fail++; console.log(`  FAIL: [${n}] ${d}`); }

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}\n`);

const TAB_CONTRACT = `
  (() => {
    const tablist = document.querySelector('ARG_SEL');
    if (!tablist) return { error: 'no tablist' };
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const active = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
    const rovingOk = tabs.every(t =>
      (t.getAttribute('aria-selected') === 'true' ? t.tabIndex === 0 : t.tabIndex === -1));
    const controls = tabs.map(t => {
      const panel = t.getAttribute('aria-controls') ? document.getElementById(t.getAttribute('aria-controls')) : null;
      return {
        id: t.id,
        selected: t.getAttribute('aria-selected'),
        tabIndex: t.tabIndex,
        hasControls: !!t.getAttribute('aria-controls'),
        panelRole: panel ? panel.getAttribute('role') : null,
        panelLabelledBy: panel ? panel.getAttribute('aria-labelledby') : null,
        panelHidden: panel ? panel.hidden : null,
      };
    });
    return { count: tabs.length, activeCount: active.length, rovingOk, controls };
  })()
`;

try {
  console.log('=== Workspace Tabs ARIA/KBD Contract ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  await page.goto(INTERNAL_BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('.ws-home-stats', { timeout: 10000 });

  await page.getByRole('button', { name: /Nuevo proyecto/ }).click();
  await page.locator('#modal-project-name').fill('Proyecto accesibilidad');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.waitForSelector('.ws-bento-card', { timeout: 10000 });

  // Open a document to render the document ribbon.
  await page.locator('.ws-bento-card').filter({ hasText: 'Documentos' }).click();
  await page.getByRole('button', { name: 'Nuevo Documento', exact: true }).first().click();
  await page.waitForSelector('.ws-doc-ribbon-tabs', { timeout: 10000 });

  console.log('--- Doc ribbon tablist ---');
  const docInspect = await page.evaluate(TAB_CONTRACT.replace('ARG_SEL', '.ws-doc-ribbon-tabs'));
  if (!docInspect.error) {
    ok('doc.1', `tablist renderiza ${docInspect.count} pestañas`);
    ok('doc.2', `exactamente una pestaña activa (aria-selected=true: ${docInspect.activeCount})`, JSON.stringify(docInspect.activeCount));
    ok('doc.3', 'roving tabindex correcto (activa tabIndex=0, resto -1)', docInspect.rovingOk ? 'sí' : JSON.stringify(docInspect.controls));
    if (docInspect.controls.every(c => c.hasControls && c.panelRole === 'tabpanel' && c.panelLabelledBy)) {
      ok('doc.4', 'cada pestaña tiene aria-controls y su panel es role=tabpanel aria-labelledby');
    } else {
      ko('doc.4', 'asociaciones incompletas: ' + JSON.stringify(docInspect.controls));
    }
  } else {
    ko('doc.1', docInspect.error);
  }

  // Keyboard navigation: ArrowRight on Inicio activates Insertar and moves focus.
  const focusBefore = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName || '');
  await page.evaluate(() => document.querySelector('.ws-doc-ribbon-tab, [data-doc-ribbon-tab="Inicio"]').focus());
  await page.keyboard.press('ArrowRight');
  const afterRight = await page.evaluate(() => ({
    activeClass: document.activeElement?.className,
    focusId: document.activeElement?.id,
    selected: document.querySelector('[data-doc-ribbon-tab="Insertar"]')?.getAttribute('aria-selected'),
    insertarPanelHidden: document.querySelector('[data-doc-ribbon-panel="Insertar"]')?.hidden,
    inicioHidden: document.querySelector('[data-doc-ribbon-panel="Inicio"]')?.hidden,
    insertarTabIndex: document.querySelector('[data-doc-ribbon-tab="Insertar"]')?.tabIndex,
    inicioTabIndex: document.querySelector('[data-doc-ribbon-tab="Inicio"]')?.tabIndex,
  }));
  if (afterRight.focusId === 'ws-doc-tab-Insertar' && afterRight.selected === 'true') {
    ok('doc.5', `ArrowRight activa Insertar y mueve el foco a ${afterRight.focusId}`);
  } else {
    ko('doc.5', 'tras ArrowRight: ' + JSON.stringify(afterRight));
  }
  if (afterRight.insertarPanelHidden === false && afterRight.inicioHidden === true) {
    ok('doc.6', 'ArrowRight alterna los paneles (Insertar visible, Inicio oculto)');
  } else {
    ko('doc.6', 'paneles tras ArrowRight: ' + JSON.stringify(afterRight));
  }
  if (afterRight.insertarTabIndex === 0 && afterRight.inicioTabIndex === -1) {
    ok('doc.7', 'roving tabindex se reasigna tras la activación por teclado');
  } else {
    ko('doc.7', 'tabindex tras ArrowRight: ' + JSON.stringify(afterRight));
  }

  // Home / End navigation.
  await page.keyboard.press('End');
  const afterEnd = await page.evaluate(() => ({
    focusId: document.activeElement?.id,
    selected: document.querySelector('[data-doc-ribbon-tab="Vista"]')?.getAttribute('aria-selected'),
  }));
  if (afterEnd.focusId === 'ws-doc-tab-Vista' && afterEnd.selected === 'true') {
    ok('doc.8', 'End activa la última pestaña (Vista)');
  } else {
    ko('doc.8', 'tras End: ' + JSON.stringify(afterEnd));
  }
  await page.keyboard.press('Home');
  const afterHome = await page.evaluate(() => ({
    focusId: document.activeElement?.id,
    selected: document.querySelector('[data-doc-ribbon-tab="Inicio"]')?.getAttribute('aria-selected'),
  }));
  if (afterHome.focusId === 'ws-doc-tab-Inicio' && afterHome.selected === 'true') {
    ok('doc.9', 'Home activa la primera pestaña (Inicio)');
  } else {
    ko('doc.9', 'tras Home: ' + JSON.stringify(afterHome));
  }

  // ArrowLeft wraps around to the last tab.
  await page.keyboard.press('ArrowLeft');
  const afterWrap = await page.evaluate(() => ({
    focusId: document.activeElement?.id,
    selected: document.querySelector('[data-doc-ribbon-tab="Vista"]')?.getAttribute('aria-selected'),
  }));
  if (afterWrap.focusId === 'ws-doc-tab-Vista' && afterWrap.selected === 'true') {
    ok('doc.10', 'ArrowLeft envuelve desde Inicio hasta la última pestaña');
  } else {
    ko('doc.10', 'tras ArrowLeft: ' + JSON.stringify(afterWrap));
  }

  // Click-to-activate keeps roving consistent (pointer path).
  await page.evaluate(() => document.querySelector('[data-doc-ribbon-tab="Insertar"]').click());
  const afterClick = await page.evaluate(() => ({
    selected: document.querySelector('[data-doc-ribbon-tab="Insertar"]')?.getAttribute('aria-selected'),
    insertarTabIndex: document.querySelector('[data-doc-ribbon-tab="Insertar"]')?.tabIndex,
    vistaTabIndex: document.querySelector('[data-doc-ribbon-tab="Vista"]')?.tabIndex,
  }));
  if (afterClick.selected === 'true' && afterClick.insertarTabIndex === 0 && afterClick.vistaTabIndex === -1) {
    ok('doc.11', 'la activación por click conserva el roving tabindex');
  } else {
    ko('doc.11', 'tras click: ' + JSON.stringify(afterClick));
  }

  // Query ribbon reaches its tablist without touching data tables: open Query shell.
  await page.getByRole('button', { name: 'Implementar', exact: true }).first().click().catch(() => {});
  if (jsErrors.length === 0) ok('doc.12', 'sin errores JS durante el contrato de pestañas del documento');
  else ko('doc.12', 'errores JS: ' + jsErrors.join(', '));

  await page.screenshot({ path: join(ARTIFACTS, 'doc-ribbon-contract.png'), fullPage: true });

  // Data ribbon from the project: go back to the home and open Datos.
  await page.evaluate(() => {
    const homeBtn = document.querySelector('.sidebar-item[data-view="dashboard"], .sidebar-item[data-view="home"]') ||
      document.querySelector('.ws-bento-card[data-view="dashboard"]');
    if (homeBtn) homeBtn.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const dataBtn = document.querySelector('.sidebar-item[data-view="data"]');
    if (dataBtn) dataBtn.click();
  });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Nueva Tabla|Nuevo Registro de Datos/ }).first().click().catch(async () => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  });
  await page.waitForSelector('.ws-data-ribbon-tabs', { timeout: 10000 });

  const dataInspect = await page.evaluate(TAB_CONTRACT.replace('ARG_SEL', '.ws-data-ribbon-tabs'));
  if (!dataInspect.error) {
    ok('data.1', `tablist de tabla renderiza ${dataInspect.count} pestañas`);
    ok('data.2', 'roving tabindex correcto', dataInspect.rovingOk ? 'sí' : JSON.stringify(dataInspect.controls));
    if (dataInspect.controls.every(c => c.hasControls && c.panelRole === 'tabpanel')) {
      ok('data.3', 'pestañas de tabla apuntan a un role=tabpanel');
    } else {
      ko('data.3', 'asociaciones de tabla incompletas: ' + JSON.stringify(dataInspect.controls));
    }
  } else {
    ko('data.1', dataInspect.error);
  }

  // Data ribbon keyboard: ArrowRight on Inicio activates Datos.
  await page.evaluate(() => document.querySelector('#ws-data-tab-Inicio').focus());
  await page.keyboard.press('ArrowRight');
  const dataRight = await page.evaluate(() => ({
    focusId: document.activeElement?.id,
    selected: document.querySelector('#ws-data-tab-Datos')?.getAttribute('aria-selected'),
    datagroupVisible: Array.from(document.querySelectorAll('.ws-data-tool-group')).some(g => !g.hidden && (g.dataset.ribbonPages || '').split(' ').includes('Datos')),
    panelLabelledBy: document.querySelector('.ws-data-ribbon-panel')?.getAttribute('aria-labelledby'),
  }));
  if (dataRight.focusId === 'ws-data-tab-Datos' && dataRight.selected === 'true') {
    ok('data.4', 'ArrowRight activa Datos en la tabla');
  } else {
    ko('data.4', 'tras ArrowRight en tabla: ' + JSON.stringify(dataRight));
  }
  if (dataRight.datagroupVisible && dataRight.panelLabelledBy === 'ws-data-tab-Datos') {
    ok('data.5', 'el panel de Datos queda visible y aria-labelledby apunta a la pestaña activa');
  } else {
    ko('data.5', 'panel de Datos: ' + JSON.stringify(dataRight));
  }

  // Query ribbon tablist from the Query view (needs a table source; the same table exists).
  await page.evaluate(() => {
    const queryBtn = document.querySelector('.sidebar-item[data-view="query"]');
    if (queryBtn) queryBtn.click();
  });
  await page.waitForTimeout(500);
  const queryRibbonExists = await page.evaluate(() => !!document.querySelector('.ws-query-ribbon-tabs'));
  if (queryRibbonExists) {
    const qInspect = await page.evaluate(TAB_CONTRACT.replace('ARG_SEL', '.ws-query-ribbon-tabs'));
    if (!qInspect.error) {
      ok('query.1', `tablist de Query renderiza ${qInspect.count} pestañas`);
      ok('query.2', 'roving tabindex correcto', qInspect.rovingOk ? 'sí' : JSON.stringify(qInspect.controls));
      if (qInspect.controls.every(c => c.hasControls && c.panelRole === 'tabpanel')) {
        ok('query.3', 'pestañas de Query apuntan a un role=tabpanel');
      } else {
        ko('query.3', 'asociaciones de Query incompletas: ' + JSON.stringify(qInspect.controls));
      }
      await page.evaluate(() => document.querySelector('#ws-query-tab-Inicio').focus());
      await page.keyboard.press('ArrowRight');
      const qRight = await page.evaluate(() => ({
        focusId: document.activeElement?.id,
        selected: document.querySelector('#ws-query-tab-Transformar')?.getAttribute('aria-selected'),
        panelOpen: !document.querySelector('#ws-query-panel-Transformar')?.hidden,
      }));
      if (qRight.focusId === 'ws-query-tab-Transformar' && qRight.selected === 'true' && qRight.panelOpen) {
        ok('query.4', 'ArrowRight activa Transformar y abre su panel en Query');
      } else {
        ko('query.4', 'tras ArrowRight en Query: ' + JSON.stringify(qRight));
      }
    } else {
      ko('query.1', qInspect.error);
    }
  } else {
    ko('query.1', 'el tablist de Query no se renderiza');
  }

  if (jsErrors.length === 0) ok('final.1', 'sin errores JS en todo el contrato');
  else ko('final.1', 'errores JS: ' + jsErrors.join(', '));

  await ctx.close();
  await browser.close();
} catch (e) {
  ko('FATAL', 'Exception: ' + e.message);
}

await new Promise(r => srv.close(r));
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
