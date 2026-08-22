#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:8080';
const ROOT = process.cwd();
const ARTIFACTS = join(ROOT, 'artifacts', 'workspace-review');
mkdirSync(ARTIFACTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

async function shellState() {
  return page.evaluate(() => {
    const main = document.querySelector('#ws-main-content');
    const text = main?.innerText || '';
    return {
      svgCount: main?.querySelectorAll('svg').length || 0,
      visibleSvgText: text.includes('<svg') || text.includes('&lt;svg'),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      status: document.querySelector('#ws-statusbar-text')?.textContent || ''
    };
  });
}

const mainResponse = await page.goto(`${BASE}/toolisto`, { waitUntil: 'networkidle' });
assert(mainResponse?.status() === 200, 'El catalogo Toolisto responde HTTP 200 en /toolisto');
assert(await page.locator('a[href="/workspace/"]').count() >= 1, 'El catalogo enlaza el Workspace funcional');

const landingResponse = await page.goto(`${BASE}/workspace-about/`, { waitUntil: 'networkidle' });
assert(landingResponse?.status() === 200, 'La landing informativa de Workspace responde HTTP 200 en /workspace-about/');
assert(await page.locator('main').count() === 1 && await page.locator('h1').count() === 1, 'La landing informativa conserva estructura semantica');
assert(await page.locator('#ws-app').count() === 0, 'La landing informativa no monta la aplicacion interna');

const homeResponse = await page.goto(`${BASE}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle' });
assert(homeResponse?.status() === 200, 'Workspace responde HTTP 200');
await page.waitForTimeout(300);
await page.screenshot({ path: join(ARTIFACTS, 'home-1366.png'), fullPage: true });
let state = await shellState();
assert(state.svgCount > 0, 'La portada monta iconos SVG reales');
assert(!state.visibleSvgText, 'La portada no muestra codigo SVG como texto');
assert(!state.horizontalOverflow, 'La portada no tiene overflow horizontal a 1366px');
assert(state.status.includes('LOCAL / LISTO'), 'La barra de estado comunica el estado local');
assert(await page.locator('.ws-studio-hero').count() === 1, 'La portada usa la composicion del estudio Toolisto');
assert(await page.locator('.ws-hero-drawing').count() === 1, 'La portada monta la ilustracion animada de Toolisto');
assert(await page.locator('.ws-home-stats > div').count() === 4, 'La portada muestra cuatro indicadores de valor');
const templateCard = page.locator('.ws-studio-templates .ws-template-card').filter({ hasText: 'Informe' });
assert(await templateCard.count() === 1, 'La plantilla de informe es visible');
const templateBox = await templateCard.boundingBox();
if (templateBox) await page.mouse.move(templateBox.x + templateBox.width / 2, templateBox.y + templateBox.height / 2);
const templateContrast = await page.evaluate(() => {
  const card = document.querySelector('.ws-studio-templates .ws-template-card');
  const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = value => {
    const [r, g, b] = parse(value).map(channel => {
      const normalized = channel / 255;
      return normalized <= .03928 ? normalized / 12.92 : Math.pow((normalized + .055) / 1.055, 2.4);
    });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const background = getComputedStyle(card).backgroundColor;
  const color = getComputedStyle(card).color;
  const light = Math.max(luminance(background), luminance(color));
  const dark = Math.min(luminance(background), luminance(color));
  return { background, color, ratio: (light + .05) / (dark + .05) };
});
assert(templateContrast.ratio >= 4.5, `El estado hover de plantillas mantiene contraste legible (${templateContrast.ratio.toFixed(2)}:1)`);

await page.locator('[data-view="intake"]:visible').click();
await page.waitForTimeout(120);
assert(await page.locator('.ws-intake-gate').count() === 1, 'Captura Universal explica cómo guardar sin proyecto');
await page.locator('[data-view="projects"]:visible').click();
await page.waitForTimeout(120);

const newProject = page.locator('#ws-welcome-new');
assert(await newProject.count() === 1, 'La accion de crear proyecto es unica');
await newProject.click();
await page.locator('#modal-project-name').fill('Proyecto QA Workspace');
await page.locator('#modal-project-desc').fill('Proyecto creado durante la validacion local');
await page.locator('.ws-btn-confirm').click();
await page.waitForTimeout(300);
assert(await page.locator('#ws-project-nav').count() === 1, 'Crear proyecto abre la navegacion contextual');
assert((await page.locator('#ws-statusbar-text').textContent()).includes('LOCAL / LISTO'), 'La barra de estado sigue activa dentro del proyecto');
assert(await page.locator('#ws-history-back').count() === 1, 'La barra superior ofrece volver atras');
assert(await page.locator('#ws-history-forward').count() === 1, 'La barra superior ofrece avanzar');
assert(await page.locator('[aria-label="Actualizar vista, Ctrl R"]').count() === 1, 'La barra superior ofrece actualizar la vista');
await page.locator('#ws-history-back').click();
await page.waitForTimeout(120);
assert(await page.locator('#ws-project-nav').isHidden(), 'Atras vuelve al espacio de proyectos');
await page.locator('#ws-history-forward').click();
await page.waitForTimeout(120);
assert(await page.locator('#ws-project-nav').isVisible(), 'Adelante recupera el proyecto activo');
await page.locator('[aria-label="Abrir ajustes y capacidades"]').click();
await page.waitForTimeout(80);
assert(await page.locator('.ws-capability-card').count() === 5, 'Ajustes muestra los formatos de archivo disponibles');
assert(await page.locator('.ws-capability-input').count() === 5, 'Ajustes permite configurar los limites de trabajo');
await page.locator('.ws-modal .ws-btn-ghost').click();
await page.screenshot({ path: join(ARTIFACTS, 'project-1366.png'), fullPage: true });

for (const view of ['capture', 'documents', 'data', 'model', 'query', 'dashboards', 'flow', 'tools']) {
  const button = page.locator(`[data-view="${view}"]:visible`);
  assert(await button.count() === 1, `La navegacion tiene una entrada visible para ${view}`);
  await button.click();
  await page.waitForTimeout(120);
  state = await shellState();
  assert(!state.visibleSvgText, `${view} no muestra codigo SVG como texto`);
  assert(!state.horizontalOverflow, `${view} no tiene overflow horizontal`);
  if (view === 'model') {
    assert(await page.locator('.ws-model-shell').count() === 1, 'Modelo de datos monta el lienzo local');
    assert(await page.locator('.ws-model-table-node').count() >= 1, 'Modelo de datos muestra tablas reales');
    assert(await page.locator('.ws-model-summary').count() === 1, 'Modelo de datos muestra el resumen de relaciones');
  }

  if (view === 'documents') {
    await page.locator('.ws-topbar-actions button').filter({ hasText: 'Nuevo Documento' }).click();
    await page.waitForTimeout(120);
    assert(await page.locator('.ws-doc-editor').count() === 1, 'Nuevo Documento abre el editor por bloques');
    assert(await page.locator('.ws-doc-toolbar').count() === 1, 'El editor ofrece una barra de herramientas tipo Word');
    assert(await page.locator('.ws-doc-tool').count() >= 15, 'El editor ofrece muchas herramientas de formato');
    const editable = page.locator('.ws-doc-editable').first();
    await editable.fill('Texto con formato');
    await editable.selectText();
    await page.locator('.ws-doc-tool[title^="Negrita"]').click();
    await page.waitForTimeout(80);
    assert(await editable.locator('b, strong').count() >= 1, 'El editor aplica formato enriquecido real');
    assert(await page.locator('.ws-doc-tool[title^="Exportar HTML"]').count() === 1, 'El editor ofrece exportacion HTML');
    assert(await page.locator('.ws-topbar-actions button').filter({ hasText: 'Exportar' }).count() === 1, 'El editor ofrece exportacion Markdown');
    assert((await page.locator('#ws-badge-docs').textContent()).trim() === '1', 'El contador de documentos se actualiza');
    await page.screenshot({ path: join(ARTIFACTS, 'document-editor-1366.png'), fullPage: true });
  }

  if (view === 'data') {
    await page.locator('.ws-topbar-actions button').filter({ hasText: 'Nueva Tabla' }).click();
    await page.waitForTimeout(120);
    assert(await page.locator('.ws-grid-table').count() === 1, 'Nueva Tabla abre la cuadricula');
    const rows = page.locator('.ws-grid-table tbody tr');
    for (let row = 0; row < 3; row++) {
      await rows.nth(row).locator('td').nth(1).dblclick();
      await page.locator('.ws-grid-table input').fill(String(row + 1));
      await page.locator('.ws-grid-table input').press('Enter');
    }
    await rows.nth(0).locator('td').nth(3).click();
    await page.locator('input[placeholder*="SUM"]').fill('=SUM(A1:A3)');
    await page.locator('input[placeholder*="SUM"]').press('Enter');
    await page.waitForTimeout(120);
    assert((await rows.nth(0).locator('td').nth(3).textContent()).trim() === '6', 'La tabla calcula SUM sin eval');
    await rows.nth(1).locator('td').nth(3).click();
    await page.locator('input[placeholder*="SUM"]').fill('=AVERAGE(A1:A3)');
    await page.locator('input[placeholder*="SUM"]').press('Enter');
    await page.waitForTimeout(80);
    assert((await rows.nth(1).locator('td').nth(3).textContent()).trim() === '2', 'La tabla calcula AVERAGE');
    await rows.nth(2).locator('td').nth(3).click();
    await page.locator('input[placeholder*="SUM"]').fill('=COUNTA(A1:A3)');
    await page.locator('input[placeholder*="SUM"]').press('Enter');
    await page.waitForTimeout(80);
    assert((await rows.nth(2).locator('td').nth(3).textContent()).trim() === '3', 'La tabla calcula COUNTA');
    assert(await page.locator('.ws-data-toolbar button').filter({ hasText: 'Copiar' }).count() === 1, 'La tabla ofrece copiar celdas');
    assert(await page.locator('.ws-data-toolbar button').filter({ hasText: 'Pegar' }).count() === 1, 'La tabla ofrece pegar rangos');
    await rows.nth(0).locator('td').nth(1).click();
    await page.locator('.ws-grid-table').evaluate(table => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'pegado-1\tB\npegado-2\tC' } });
      table.dispatchEvent(event);
    });
    await page.waitForTimeout(120);
    assert((await page.locator('.ws-grid-table tbody tr').nth(0).locator('td').nth(1).textContent()).trim() === 'pegado-1', 'La tabla pega un rango tabular con Ctrl V');
    await page.locator('.ws-data-toolbar button').filter({ hasText: 'Deshacer' }).click();
    await page.waitForTimeout(80);
    assert((await page.locator('.ws-grid-table tbody tr').nth(0).locator('td').nth(1).textContent()).trim() === '1', 'La tabla deshace el pegado');
    assert((await page.locator('#ws-badge-data').textContent()).trim() === '1', 'El contador de tablas se actualiza');
    await page.screenshot({ path: join(ARTIFACTS, 'data-table-1366.png'), fullPage: true });
    const newSheet = page.locator('[aria-label="Crear una nueva hoja"]');
    assert(await newSheet.count() === 1, 'La tabla ofrece crear una nueva hoja');
    await newSheet.click();
    await page.locator('.ws-sheet-tab.active').filter({ hasText: 'Hoja 2' }).waitFor({ state: 'visible' });
    const dataSheetDebug = await page.locator('.ws-sheet-tab.active').allTextContents();
    assert(dataSheetDebug.length === 1 && dataSheetDebug[0].trim() === 'Hoja 2', `Crear hoja abre una hoja nueva real (actual: ${dataSheetDebug.join(' | ')})`);
    assert(await page.locator('.ws-sheet-tab').count() >= 3, 'La tabla conserva las pestañas del libro');
    await page.waitForTimeout(1200);
  }

  if (view === 'query') {
    assert(await page.locator('.ws-query-studio').count() === 1, 'Query monta el estudio de preparacion');
    assert(await page.locator('.ws-query-tools-panel').count() === 1, 'Query monta el cajon lateral de herramientas');
    assert(await page.locator('.ws-query-tool-search').count() === 1, 'Query permite buscar herramientas');
    assert(await page.locator('.ws-query-tool-filter').count() >= 6, 'Query ofrece filtros por categoria');
    assert(await page.locator('.ws-query-tools-panel').isHidden(), 'Query prioriza el espacio de datos con herramientas minimizadas');
    const queryToolsToggle = page.locator('.ws-query-tools-toggle');
    assert(await queryToolsToggle.count() === 1, 'Query ofrece abrir y cerrar el cajon');
    await queryToolsToggle.click();
    assert(await page.locator('.ws-query-tools-panel').isVisible(), 'El cajon de Query se puede abrir');
    await queryToolsToggle.click();
    assert(await page.locator('.ws-query-tools-panel').isHidden(), 'El cajon de Query se puede minimizar');
    await queryToolsToggle.click();
    assert(await page.locator('.ws-query-tools-panel').isVisible(), 'El cajon de Query se puede volver a abrir');
    const sourceDrawerToggle = page.locator('[aria-label="Minimizar cajón de fuentes"]');
    await sourceDrawerToggle.click();
    assert(await page.locator('.ws-query-source-panel.ws-query-panel-collapsed').count() === 1, 'El cajon de fuentes se puede minimizar');
    await page.locator('[aria-label="Abrir cajón de fuentes"]').click();
    assert(await page.locator('.ws-query-source-panel.ws-query-panel-collapsed').count() === 0, 'El cajon de fuentes se puede restaurar');
    const stepsDrawerToggle = page.locator('[aria-label="Minimizar cajón de pasos"]');
    await stepsDrawerToggle.click();
    assert(await page.locator('.ws-query-steps-panel.ws-query-panel-collapsed').count() === 1, 'El cajon de pasos se puede minimizar');
    await page.locator('[aria-label="Abrir cajón de pasos"]').click();
    assert(await page.locator('.ws-query-steps-panel.ws-query-panel-collapsed').count() === 0, 'El cajon de pasos se puede restaurar');
    const sheetBarToggle = page.locator('[aria-label="Minimizar barra de hojas"]');
    await sheetBarToggle.click();
    assert(await page.locator('.ws-query-sheetbar.ws-query-sheetbar-collapsed').count() === 1, 'La barra de hojas se puede minimizar');
    await page.locator('[aria-label="Mostrar barra de hojas"]').click();
    assert(await page.locator('.ws-query-sheetbar.ws-query-sheetbar-collapsed').count() === 0, 'La barra de hojas se puede restaurar');
    assert(await page.locator('.ws-query-command').count() >= 20, 'Query ofrece un catalogo amplio de herramientas');
    assert(await page.locator('.ws-query-preview-table').count() === 1, 'Query muestra la vista previa de datos');
    assert(await page.locator('.ws-query-steps-panel').count() === 1, 'Query muestra el panel de pasos aplicados');
    assert(await page.locator('.ws-query-source').count() >= 1, 'Query muestra al menos una fuente local');
    assert(await page.locator('.ws-query-sheetbar').count() === 1, 'Query muestra el libro de hojas');
    assert(await page.locator('.ws-query-sheet-tab').count() === 1, 'Query empieza con una hoja activa');

    const removeEmpty = page.locator('.ws-query-command[title^="Elimina filas completamente"]');
    assert(await removeEmpty.count() === 1, 'Query ofrece la transformacion de quitar filas vacias');
    await removeEmpty.click();
    await page.waitForTimeout(100);
    assert(await page.locator('.ws-query-applied-step').count() === 1, 'Query aplica una transformacion y registra el paso');
    await page.locator('.ws-query-preview-actions button').first().click();
    await page.waitForTimeout(100);
    assert(await page.locator('.ws-query-applied-step').count() === 0, 'Query permite deshacer el ultimo paso');

    await page.locator('[aria-label="Nueva hoja de consulta"]').click();
    await page.waitForTimeout(80);
    assert(await page.locator('.ws-modal').count() === 1, 'Query abre la configuracion de una nueva hoja');
    await page.locator('[aria-label="Nombre de la hoja"]').fill('Resumen QA');
    await page.locator('.ws-modal .ws-btn-confirm').click();
    await page.waitForTimeout(150);
    assert(await page.locator('.ws-query-sheet-tab').count() === 2, 'Query crea una segunda hoja real');
    const sheetTabs = page.locator('.ws-query-sheet-tab-main');
    await sheetTabs.nth(1).click();
    await page.waitForTimeout(120);
    await page.locator('.ws-query-command[title^="Elimina filas completamente"]').click();
    await page.waitForTimeout(100);
    assert(await page.locator('.ws-query-applied-step').count() === 1, 'La segunda hoja conserva sus propios pasos');
    await sheetTabs.nth(0).click();
    await page.waitForTimeout(120);
    assert(await page.locator('.ws-query-applied-step').count() === 0, 'La primera hoja mantiene su historial separado');
    await sheetTabs.nth(1).click();
    await page.waitForTimeout(120);
    assert(await page.locator('.ws-query-applied-step').count() === 1, 'Cambiar de hoja recupera su historial');
    await page.locator('[aria-label^="Renombrar hoja"]').last().click();
    await page.waitForTimeout(70);
    await page.locator('[aria-label="Nombre de la hoja"]').fill('Resumen final');
    await page.locator('.ws-modal .ws-btn-confirm').click();
    await page.waitForTimeout(120);
    assert(await page.locator('.ws-query-sheet-tab-main').filter({ hasText: 'Resumen final' }).count() === 1, 'Query permite renombrar una hoja');
    await page.screenshot({ path: join(ARTIFACTS, 'query-sheets-1366.png'), fullPage: true });
    await page.locator('[aria-label^="Eliminar hoja"]').last().click();
    await page.waitForTimeout(70);
    await page.locator('.ws-modal .ws-btn-confirm').click();
    await page.waitForTimeout(120);
    assert(await page.locator('.ws-query-sheet-tab').count() === 1, 'Query permite eliminar una hoja sin afectar la fuente');
    await page.screenshot({ path: join(ARTIFACTS, 'query-1366.png'), fullPage: true });
  }

  if (view === 'dashboards') {
    assert(await page.locator('.ws-dashboard-shell').count() === 1, 'Dashboards monta el constructor local');
    assert(await page.locator('.ws-dashboard-controls').count() === 1, 'Dashboards ofrece controles de fuente y filtro');
    assert(await page.locator('.ws-dashboard-summary').count() === 1, 'Dashboards muestra resumen de filas y visuales');
    assert(await page.locator('.ws-dashboard-widget-card').count() >= 4, 'Dashboards crea visuales iniciales');
    assert(await page.locator('.ws-dashboard-chart-svg').count() >= 1, 'Dashboards renderiza un grafico real');
    assert(await page.locator('.ws-dashboard-data-table').count() >= 1, 'Dashboards renderiza una tabla de detalle');
    const addVisual = page.locator('[aria-label="Añadir visual al dashboard"]');
    assert(await addVisual.count() === 1, 'Dashboards permite añadir visuales');
    const widgetCountBefore = await page.locator('.ws-dashboard-widget-card').count();
    await addVisual.click();
    await page.waitForTimeout(80);
    assert(await page.locator('.ws-modal').count() === 1, 'Añadir visual abre la configuracion');
    assert(await page.locator('.ws-modal select').count() >= 4, 'La configuracion permite elegir tipo, campos y agregacion');
    await page.locator('.ws-modal .ws-btn-confirm').click();
    await page.waitForTimeout(140);
    assert(await page.locator('.ws-dashboard-widget-card').count() === widgetCountBefore + 1, 'Dashboards guarda el nuevo visual');
    const dashboardFilter = page.locator('.ws-dashboard-filter-input');
    await dashboardFilter.fill('1');
    const filterGroup = page.locator('.ws-dashboard-control-group').filter({ hasText: 'Filtro rápido' });
    assert(await filterGroup.count() === 1, 'Dashboards muestra el filtro rapido');
    await filterGroup.locator('select').selectOption('0');
    await filterGroup.locator('.ws-btn-primary').click();
    await page.waitForTimeout(100);
    const filteredDashboardRows = (await page.locator('.ws-dashboard-summary > div').first().locator('strong').textContent()).trim();
    assert(filteredDashboardRows === '1', `El filtro del dashboard actualiza las filas visibles (actual: ${filteredDashboardRows})`);
    await filterGroup.locator('.ws-btn-ghost').filter({ hasText: 'Limpiar' }).click();
    await page.waitForTimeout(100);
    assert((await page.locator('.ws-dashboard-summary > div').first().locator('strong').textContent()).trim() === '3', 'El dashboard puede limpiar el filtro');
    await page.screenshot({ path: join(ARTIFACTS, 'dashboard-1366.png'), fullPage: true });
  }

  if (view === 'flow') {
    assert(await page.locator('.ws-flow-toolbar').count() === 1, 'Flow monta la barra de herramientas del lienzo');
    const addFlowNode = page.locator('.ws-flow-toolbar button').filter({ hasText: 'Nodo' });
    assert(await addFlowNode.count() === 1, 'Flow ofrece añadir nodos');
    await addFlowNode.click();
    await page.waitForTimeout(80);
    assert(await page.locator('.ws-flow-node').count() === 1, 'Flow añade un nodo editable');
    const runFlow = page.locator('.ws-flow-toolbar button').filter({ hasText: 'Ejecutar prueba' });
    assert(await runFlow.count() === 1, 'Flow ofrece ejecutar una prueba');
    await runFlow.click();
    await page.waitForTimeout(80);
    assert((await page.locator('.ws-flow-status').textContent()).includes('Última prueba completada'), 'Flow confirma la ejecucion del lienzo');
  }
}

const search = page.getByRole('button', { name: 'Abrir búsqueda universal, Ctrl K' });
assert(await search.count() === 1, 'La busqueda universal tiene un control unico');
await search.click();
assert(await page.locator('.ws-palette-input').count() === 1, 'Ctrl+K abre la paleta universal');
await page.locator('.ws-palette-input').press('Escape');
assert(await page.locator('.ws-palette-overlay').count() === 0, 'Escape cierra la paleta universal');

await page.locator('#ws-theme-toggle').click();
assert(await page.evaluate(() => document.documentElement.classList.contains('theme-dark')), 'El tema oscuro se puede activar');
await page.screenshot({ path: join(ARTIFACTS, 'project-dark-1366.png'), fullPage: true });

for (const width of [390, 768, 1024, 1366, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(180);
  state = await shellState();
  assert(!state.horizontalOverflow, `Responsive sin overflow a ${width}px`);
  if (width === 390 || width === 768) {
    await page.screenshot({ path: join(ARTIFACTS, `responsive-${width}.png`), fullPage: true });
  }
  if (width === 390) {
    assert(await page.locator('#ws-menu-toggle').isVisible(), 'El menu movil queda accesible a 390px');
    await page.locator('#ws-menu-toggle').click();
    assert(await page.locator('#ws-sidebar.mobile-open').count() === 1, 'El menu movil abre la barra lateral');
    await page.keyboard.press('Escape');
    assert(await page.locator('#ws-sidebar.mobile-open').count() === 0, 'Escape cierra la barra lateral movil');
  }
}

const missing = await page.request.get(`${BASE}/workspace/ruta-que-no-existe.html`);
assert(missing.status() === 404, 'Una ruta inexistente responde 404');
assert(errors.length === 0, `Navegador sin errores de consola (${errors.length})`);

await browser.close();
console.log(`Artefactos: ${ARTIFACTS}`);
