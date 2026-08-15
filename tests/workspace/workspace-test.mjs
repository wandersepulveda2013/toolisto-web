#!/usr/bin/env node
/**
 * Workspace Test Suite - Toolisto Workspace v1
 * Verifies: files exist, HTML valid, CSS variables, JS modules, IndexedDB, all tools accessible
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const WS_DIST = join(DIST, 'workspace');
const WS_SRC = join(ROOT, 'workspace');
// El build público --production ya no copia el runtime del Workspace a dist;
// esta suite usa la copia publicada cuando existe (release gate con
// --include-workspace) y, si no, verifica la fuente canónica.
const WS_BASE = existsSync(WS_DIST) ? WS_DIST : WS_SRC;

let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function dirSize(dir) {
  let total = 0;
  for (const f of readdirSync(dir)) {
    const fp = join(dir, f);
    const s = statSync(fp);
    if (s.isDirectory()) total += dirSize(fp);
    else total += s.size;
  }
  return total;
}

// Product footprint of the workspace: excludes the autonomous/operational
// markdown documents and marker files that the build copies into dist and that
// grow with each evolution cycle, so the size gate guards the shipped app.
function productSize(dir) {
  let total = 0;
  for (const f of readdirSync(dir)) {
    const fp = join(dir, f);
    const s = statSync(fp);
    if (s.isDirectory()) total += productSize(fp);
    else if (/\.[m]?js$|\.css$|\.json$|\.html$|\.png$|\.ico$|\.webmanifest$|\.svg$/.test(f)) total += s.size;
  }
  return total;
}

console.log('=== Toolisto Workspace Tests ===\n');

// Pre-read all runtime files (published copy when present, source otherwise).
// En dist/workspace el runtime vive en preview.html (index.html es la landing
// pública APLUNO); en la fuente workspace/ el runtime es index.html.
const wsIndex = existsSync(join(WS_BASE, 'preview.html')) ? 'preview.html' : 'index.html';
const wsHtml = existsSync(join(WS_BASE, wsIndex)) ? readFileSync(join(WS_BASE, wsIndex), 'utf8') : '';
const wsCss = existsSync(join(WS_BASE, 'workspace.css')) ? readFileSync(join(WS_BASE, 'workspace.css'), 'utf8') : '';
const wsJs = existsSync(join(WS_BASE, 'workspace.js')) ? readFileSync(join(WS_BASE, 'workspace.js'), 'utf8') : '';
const toolsJs = existsSync(join(WS_BASE, 'tools-data.js')) ? readFileSync(join(WS_BASE, 'tools-data.js'), 'utf8') : '';
const dbJs = existsSync(join(WS_BASE, 'core', 'db.js')) ? readFileSync(join(WS_BASE, 'core', 'db.js'), 'utf8') : '';
const stateJs = existsSync(join(WS_BASE, 'core', 'state.js')) ? readFileSync(join(WS_BASE, 'core', 'state.js'), 'utf8') : '';
const eventsJs = existsSync(join(WS_BASE, 'core', 'events.js')) ? readFileSync(join(WS_BASE, 'core', 'events.js'), 'utf8') : '';
const storageJs = existsSync(join(WS_BASE, 'core', 'storage.js')) ? readFileSync(join(WS_BASE, 'core', 'storage.js'), 'utf8') : '';

// ─── File Structure ───
console.log('--- File Structure ---');
check('workspace/ directory exists in src', existsSync(WS_SRC));
check('workspace runtime present in dist (release gate) o fuente', existsSync(WS_BASE));
check('workspace preview/index html present', wsHtml.length > 0);
check('workspace/workspace.css present', existsSync(join(WS_BASE, 'workspace.css')));
check('workspace/workspace.js present', existsSync(join(WS_BASE, 'workspace.js')));
check('workspace/tools-data.js present', existsSync(join(WS_BASE, 'tools-data.js')));
check('workspace/core/db.js present', existsSync(join(WS_BASE, 'core', 'db.js')));
check('workspace/core/state.js present', existsSync(join(WS_BASE, 'core', 'state.js')));
check('workspace/core/events.js present', existsSync(join(WS_BASE, 'core', 'events.js')));
check('workspace/core/storage.js present', existsSync(join(WS_BASE, 'core', 'storage.js')));

// ─── HTML Validation ───
check('Has <!DOCTYPE html>', wsHtml.includes('<!DOCTYPE html>'));
check('Has lang="es"', wsHtml.includes('lang="es"'));
check('Has viewport meta', wsHtml.includes('viewport'));
check('Has skip-link for a11y', wsHtml.includes('skip-link'));
check('Has role="navigation"', wsHtml.includes('role="navigation"'));
check('Has role="main"', wsHtml.includes('role="main"'));
check('Has role="banner"', wsHtml.includes('role="banner"'));
check('Has role="status" for toasts', wsHtml.includes('role="status"'));
check('Has aria-live="polite"', wsHtml.includes('aria-live="polite"'));
check('References workspace.css', wsHtml.includes('workspace.css'));
check('References workspace.js as module', wsHtml.includes('type="module"') && wsHtml.includes('workspace.js'));
check('Has sidebar with data-view attributes', wsHtml.includes('data-view="projects"'));
check('Has 144 tools nav item', wsHtml.includes('data-view="tools"'));
check('Has theme toggle', wsHtml.includes('ws-theme-toggle'));
check('Has density toggle', wsHtml.includes('ws-density-toggle'));
check('Has sidebar collapse toggle', wsHtml.includes('ws-collapse-toggle'));
check('Has palette root', wsHtml.includes('ws-palette-root'));
check('Has modal root', wsHtml.includes('ws-modal-root'));
check('Has global module navigation', wsHtml.includes('ws-global-module-nav'));
check('Has persistent local status bar', wsHtml.includes('ws-statusbar'));
check('Uses the official Toolisto mark in Workspace', wsHtml.includes('sidebar-logo-img') && wsHtml.includes('../assets/toolisto-mark.svg'));

// ─── CSS Validation ───
check('Has white light theme variables', wsCss.includes('--ws-bg: #FFFFFF') && wsCss.includes('--ws-primary: #111111') && wsCss.includes('--ws-cream: #F3EBDD'));
check('Has monochrome dark theme variables', wsCss.includes('--ws-bg: #111111') && wsCss.includes('--ws-primary: #F4F3EE'));
check('Has density-airada', wsCss.includes('density-airada'));
check('Has density-compacta', wsCss.includes('density-compacta'));
check('Has prefers-reduced-motion', wsCss.includes('prefers-reduced-motion'));
check('Has prefers-color-scheme: dark', wsCss.includes('prefers-color-scheme: dark'));
check('Has skip-link styles', wsCss.includes('.skip-link'));
check('Has :focus-visible', wsCss.includes(':focus-visible'));
check('Has responsive @media max-width: 768px', wsCss.includes('max-width: 768px'));
check('Has sidebar styles', wsCss.includes('.ws-sidebar'));
check('Has modal styles', wsCss.includes('.ws-modal'));
check('Has toast styles', wsCss.includes('.ws-toast'));
check('Has palette styles', wsCss.includes('.ws-palette'));
check('Has navigation history styles', wsCss.includes('.ws-history-controls') && wsCss.includes('.ws-history-btn'));
check('Has Word-like editor styles', wsCss.includes('.ws-doc-toolbar') && wsCss.includes('.ws-doc-tool') && wsCss.includes('.ws-doc-editable'));
check('Has capability settings styles', wsCss.includes('.ws-capabilities-list') && wsCss.includes('.ws-table-capacity'));
check('Has flow editor styles', wsCss.includes('.ws-flow'));
check('Has data grid styles', wsCss.includes('.ws-grid'));
check('Has document editor styles', wsCss.includes('.ws-doc-block'));
check('Has capture styles', wsCss.includes('.ws-capture'));
check('Has dashboard widget styles', wsCss.includes('.ws-dash-widget'));
check('Has dashboard builder styles', wsCss.includes('.ws-dashboard-shell') && wsCss.includes('.ws-dashboard-widget-card') && wsCss.includes('.ws-dashboard-chart-svg'));
check('Has card styles', wsCss.includes('.ws-card'));
check('Has button styles', wsCss.includes('.ws-btn'));
check('Has Query studio styles', wsCss.includes('.ws-query-studio') && wsCss.includes('.ws-query-ribbon') && wsCss.includes('.ws-query-preview-table'));
check('Has Query tool drawer styles', wsCss.includes('.ws-query-tools-panel') && wsCss.includes('.ws-query-tool-search') && wsCss.includes('.ws-query-tool-filter'));
check('Has Query multi-sheet styles', wsCss.includes('.ws-query-sheetbar') && wsCss.includes('.ws-query-sheet-tab') && wsCss.includes('.ws-query-new-sheet'));
check('Has minimizable Query drawers', wsCss.includes('.ws-query-panel-collapsed') && wsCss.includes('.ws-query-source-collapsed') && wsCss.includes('.ws-query-steps-collapsed'));
check('Has monochrome Query tool drawer', wsCss.includes('background: #202020') && wsCss.includes('.ws-query-tools-panel .ws-query-command'));
check('Has monochrome studio home styles', wsCss.includes('.ws-home-studio') && wsCss.includes('.ws-studio-hero'));
check('Has Toolisto artwork styles', wsCss.includes('.ws-hero-art') && wsCss.includes('ws-drawing-core'));
check('Template hover and selection keep readable contrast', wsCss.includes('.ws-template-card:focus-visible') && wsCss.includes('.ws-template-card *::selection'));
check('Has intake project gate styles', wsCss.includes('.ws-intake-gate'));
check('Has scrollbar styles', wsCss.includes('::-webkit-scrollbar'));

// ─── JS Module Validation ───
check('Has ES module imports', wsJs.includes('import {'));
check('Has IndexedDB operations', wsJs.includes('indexedDB') || toolsJs.includes('indexedDB') || dbJs.includes('indexedDB'));
check('Has DOMContentLoaded init', wsJs.includes('DOMContentLoaded'));
check('Has navigateTo function', wsJs.includes('function navigateTo'));
check('Has renderProjects', wsJs.includes('function renderProjectsView'));
check('Has renderDocuments', wsJs.includes('function renderDocumentsView'));
check('Has renderData', wsJs.includes('function renderDataView'));
check('Has renderCapture', wsJs.includes('function renderCaptureView'));
check('Has renderFlow', wsJs.includes('function renderFlowView'));
check('Has renderQuery', wsJs.includes('function renderQueryView'));
check('Has Query studio renderer', wsJs.includes('function renderQueryStudioView') && wsJs.includes('function renderQueryStudio'));
check('Has executable Query transformations', wsJs.includes('function queryRunOperation') && wsJs.includes("operation === 'filter'") && wsJs.includes("operation === 'group'"));
check('Has Query import and export', wsJs.includes('function importQueryFile') && wsJs.includes('function exportQueryResult') && wsJs.includes('queryExportCsv'));
check('Has Query tool drawer renderer', wsJs.includes('function renderQueryToolDrawer') && wsJs.includes('ws-query-tools-toggle') && wsJs.includes('Cajón de herramientas'));
check('Has Query multi-sheet renderer', wsJs.includes('function renderQuerySheetBar') && wsJs.includes('openQueryNewSheetModal') && wsJs.includes('queryRestoreSheets'));
check('Persists Query sheets', wsJs.includes('querySheetsSettingKey') && wsJs.includes('queryPersistState') && wsJs.includes("sheets: nextSheets.map(querySerializeModel)"));
check('Has workspace navigation history', wsJs.includes('function navigateHistory') && wsJs.includes('function refreshCurrentView') && wsJs.includes('recordNavigation'));
check('Has Ctrl S save shortcut', wsJs.includes('function saveCurrentWorkspaceItem') && wsJs.includes("e.key.toLowerCase() === 's'"));
check('Has workspace capabilities config', wsJs.includes('WORKSPACE_DEFAULTS') && wsJs.includes('openWorkspaceSettings') && wsJs.includes('validateWorkspaceFile'));
check('Has document rich editing', wsJs.includes('sanitizeDocHtml') && wsJs.includes('renderDocumentToolbar') && wsJs.includes('document.execCommand'));
check('Has document text import', wsJs.includes('function importDocumentFile') && wsJs.includes('Documento importado'));
check('Has table clipboard and history', wsJs.includes('applyClipboardGrid') && wsJs.includes('undoTableEdit') && wsJs.includes('copyTableSelection'));
check('Has renderTools', wsJs.includes('function renderToolsView'));
check('Has renderDashboards', wsJs.includes('function renderDashboardsView'));
check('Has dashboard builder renderer', wsJs.includes('function renderDashboardBuilder') && wsJs.includes('function openDashboardWidgetModal') && wsJs.includes('dashboardSettingKey'));
check('Has dashboard calculations and filtering', wsJs.includes('dashboardAggregate') && wsJs.includes('dashboardVisibleRows') && wsJs.includes('dashboardSvg'));
check('Has Ctrl+K palette', wsJs.includes('togglePalette'));
check('Has theme toggle', wsJs.includes('cycleTheme'));
check('Has density toggle', wsJs.includes('cycleDensity'));
check('Has sidebar collapse', wsJs.includes('setupCollapse'));
check('Has mobile menu', wsJs.includes('setupMobileMenu'));
check('Has keyboard shortcuts', wsJs.includes('setupKeyboardShortcuts'));
check('Has global drag-drop', wsJs.includes('setupGlobalDragDrop'));
check('Has showContextMenu', wsJs.includes('function showContextMenu'));
check('Has showToast', wsJs.includes('function showToast'));
check('Has showModal', wsJs.includes('function showModal'));
check('Has importProject', wsJs.includes('importProject') || storageJs.includes('importProject'));
check('Has exportProject', wsJs.includes('function exportProjectFile'));
check('Has handleFiles intake', wsJs.includes('function handleFiles'));
check('Has analyzeFile', wsJs.includes('function analyzeFile'));
check('Has branded studio home', wsJs.includes('createStudioArtwork') && wsJs.includes('TOOLISTO / WORKSPACE'));
check('Has local capture save flow', wsJs.includes('function saveImageCapture') && wsJs.includes('getDisplayMedia'));
check('Has safe spreadsheet formulas', wsJs.includes('function safeArithmetic') && wsJs.includes('evaluateDataFormula') && !/eval\s*\(/.test(wsJs));
check('Has dynamic project counters', storageJs.includes('function refreshProjectCounts') && wsJs.includes('refreshProjectCounts'));
check('Has auto-save debounce', wsJs.includes('scheduleAutoSave'));
check('Has block editor', wsJs.includes('setupBlockEditor'));
check('Has flow canvas', wsJs.includes('setupFlowCanvas'));
check('Creates functional data sheets', wsJs.includes('function createNewDataSheet') && wsJs.includes("ariaLabel: 'Crear una nueva hoja'"));
check('Flow exposes a real test action', wsJs.includes('Ejecutar prueba') && wsJs.includes('Prueba del flujo completada'));
check('Has palette commands', wsJs.includes('getPaletteCommands'));
check('Has favorites', wsJs.includes('toggleFavoriteTool'));
check('Has recent tools', wsJs.includes('addToRecentTools'));
check('No references to src/tool-processors.js', !wsJs.includes('src/tool-processors.js'));
check('Icons are real SVG nodes', wsJs.includes('document.createElementNS') && wsJs.includes('const svgIcon'));
check('No SVG source concatenation', !/svgIcon\([^\n]+\)\s*\+/.test(wsJs));
check('No runtime innerHTML assignment', !/\.innerHTML\s*=/.test(wsJs));

// ─── Tools Data ───
check('Has TOOLS_DATA export', toolsJs.includes('export const TOOLS_DATA'));
const toolsMatch = toolsJs.match(/\{[^{}]*"id"\s*:/g);
check('Contains tools data', toolsMatch && toolsMatch.length > 0, `Found ${toolsMatch?.length || 0} entries`);
check('Has "compress" tool', toolsJs.includes('"compress"'));
check('Has merge PDF tool', toolsJs.includes('"mergePdf"'));
check('Has category field', toolsJs.includes('"category"'));
check('Has name field', toolsJs.includes('"name"'));

// ─── Core Modules ───
check('db.js has openDB', dbJs.includes('function openDB'));
check('db.js has dbGet', dbJs.includes('function dbGet'));
check('db.js has dbPut', dbJs.includes('function dbPut'));
check('db.js has dbDelete', dbJs.includes('function dbDelete'));
check('db.js has dbGetAll', dbJs.includes('function dbGetAll'));
check('db.js has dbGetByIndex', dbJs.includes('function dbGetByIndex'));
check('db.js has generateId', dbJs.includes('function generateId'));
check('db.js has STORES constants', dbJs.includes('STORES'));

check('state.js has createStore', stateJs.includes('function createStore'));
check('state.js has appStore', stateJs.includes('appStore'));
check('state.js tracks Query sheets', stateJs.includes('querySheets') && stateJs.includes('activeQuerySheetId'));
check('state.js tracks Query drawer visibility', stateJs.includes('queryToolsOpen') && stateJs.includes('querySourceOpen') && stateJs.includes('queryStepsOpen'));
check('events.js has on', eventsJs.includes('function on'));
check('events.js has emit', eventsJs.includes('function emit'));
check('storage.js has createProject', storageJs.includes('function createProject'));
check('storage.js has saveDoc', storageJs.includes('function saveDoc'));
check('storage.js has saveData', storageJs.includes('function saveData'));
check('storage.js has saveCapture', storageJs.includes('function saveCapture'));
check('storage.js has exportProject', storageJs.includes('function exportProject'));
check('storage.js has importProject', storageJs.includes('function importProject'));
check('Dashboard config is persisted and portable', storageJs.includes("'dashboard:' + id") && storageJs.includes('dashboard: dashboard?.value') && storageJs.includes("key: 'dashboard:' + projectId"));
check('Query sheets are portable with projects', storageJs.includes("'query:' + id") && storageJs.includes('query: query?.value') && storageJs.includes("key: 'query:' + projectId"));

// ─── Total Workspace Size ───
console.log('\n--- Size ---');
const totalKB = Math.round(productSize(WS_DIST) / 1024);
check(`Total workspace dist size: ${totalKB}KB`, totalKB > 0 && totalKB < 1200, `Expected <1200KB`);

// ─── Main Site Not Broken ───
console.log('\n--- Main Site Integrity ---');
check('dist/index.html exists', existsSync(join(DIST, 'index.html')));
check('dist/toolisto.html exists', existsSync(join(DIST, 'toolisto.html')));
check('dist/js/app.js exists', existsSync(join(DIST, 'js', 'app.js')));
check('dist/js/tool-processors.js exists', existsSync(join(DIST, 'js', 'tool-processors.js')));
check('dist/styles.css exists', existsSync(join(DIST, 'styles.css')));
const mainHtml = readFileSync(join(DIST, 'toolisto.html'), 'utf8');
const cardCount = (mainHtml.match(/class="tool-card"/g) || []).length;
const srcToolsPath = join(ROOT, 'src', 'data', 'tools.json');
const expectedCards = existsSync(srcToolsPath) ? JSON.parse(readFileSync(srcToolsPath, 'utf8')).filter((t) => t.enabled).length : -1;
check(`Portada has ${expectedCards} tool cards (found ${cardCount})`, cardCount === expectedCards);
check('Catálogo enlaza la landing pública de Workspace', mainHtml.includes('href="/workspace/"'));

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
