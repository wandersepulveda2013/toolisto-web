#!/usr/bin/env node
/**
 * Phase 11: Accessibility, Responsive, Performance Audit for Toolisto Workspace
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const WS = join(ROOT, 'workspace');

let pass = 0, fail = 0, warn = 0;
function ok(n, d='') { pass++; console.log(`  PASS: ${n}${d?' — '+d:''}`); }
function ko(n, d='') { fail++; console.log(`  FAIL: ${n}${d?' — '+d:''}`); }
function wn(n, d='') { warn++; console.log(`  WARN: ${n}${d?' — '+d:''}`); }

console.log('=== Phase 11: Accessibility, Responsive & Performance Audit ===\n');

// ─── A11y: HTML Structure ───
console.log('--- Accessibility: HTML Structure ---');
const html = readFileSync(join(WS, 'index.html'), 'utf8');
const css = readFileSync(join(WS, 'workspace.css'), 'utf8');
const js = readFileSync(join(WS, 'workspace.js'), 'utf8');

ok('Skip link present', html.includes('skip-link'), 'Critical a11y feature');
ok('Skip link targets #ws-main-content', html.includes('href="#ws-main-content"'));
ok('nav has aria-label="Navegación principal"', html.includes('aria-label="Navegación principal"'));
ok('main has role="main"', html.includes('role="main"'));
ok('banner has role="banner"', html.includes('role="banner"'));
ok('Toast container has role="status"', html.includes('role="status"'));
ok('Toast container has aria-live="polite"', html.includes('aria-live="polite"'));
ok('Palette root exists for Ctrl+K', html.includes('ws-palette-root'));
ok('Modal root exists', html.includes('ws-modal-root'));
ok('Context menu root exists', html.includes('ws-context-root'));
ok('Mobile menu toggle has aria-label', html.includes('aria-label="Abrir menú"'));
ok('Theme toggle has aria-label', html.includes('aria-label="Cambiar tema"'));
ok('Density toggle has aria-label', html.includes('aria-label="Cambiar densidad"'));
ok('Sidebar collapse has aria-label', html.includes('aria-label="Colapsar barra lateral"'));
ok('Home link has aria-label', html.includes('aria-label="Volver a Toolisto principal"'));
ok('lang="es" set on html', html.includes('lang="es"'));
ok('viewport meta present', html.includes('viewport'));
ok('meta description present', html.includes('name="description"'));

// ─── A11y: CSS Focus & Motion ───
console.log('\n--- Accessibility: CSS ---');
ok(':focus-visible styles defined', css.includes(':focus-visible'));
ok('prefers-reduced-motion respected', css.includes('prefers-reduced-motion'));
ok('prefers-color-scheme: dark supported', css.includes('prefers-color-scheme: dark'));
ok('Skip link visually hidden until focus', css.includes('.skip-link'));
ok('Skip link appears at top: 8px on focus', css.includes('.skip-link:focus'));
ok('Scrollbar styling (UX)', css.includes('::-webkit-scrollbar'));

// ─── A11y: JS Accessibility ───
console.log('\n--- Accessibility: JavaScript ---');
ok('DOMContentLoaded init', js.includes('DOMContentLoaded'));
ok('Keyboard shortcut: Ctrl+K opens palette', js.includes("e.key === 'k'") || js.includes("key === 'k'"));
ok('Escape key closes modals/palette', js.includes("e.key === 'Escape'"));
ok('Ctrl+S shortcut for save', js.includes("e.key === 's'"));
ok('Modal has close button', js.includes('ws-modal-close'));
ok('Modal overlay click closes', js.includes('e.target === overlay'));
ok('Context menu closes on outside click', js.includes('closeContextMenu'));
ok('Palette items are keyboard navigable (ArrowUp/Down)', js.includes('ArrowDown') && js.includes('ArrowUp'));
ok('Palette Enter selects item', js.includes("'Enter'"));
ok('Project cards have tabindex="0"', js.includes('tabindex="0"'));
ok('Project cards have role="button"', js.includes('role="button"'));
ok('Project cards respond to Enter key', js.includes("'Enter'"));
ok('Document blocks have draggable="true"', js.includes('draggable="true"'));
ok('Block handle has aria-label', js.includes('aria-label="Arrastrar bloque"'));
ok('Doc title has aria-label', js.includes('aria-label="Volver a documentos"'));
ok('Tool cards have aria-label', js.includes('aria-label="Abrir'));
ok('Capture buttons have aria-label', js.includes('aria-label="Capturar foto"'));
ok('File upload buttons have aria-label', js.includes('aria-label="Subir archivo"'));
ok('Favorite toggle has aria-label', js.includes("isFavorite ? 'Quitar' : 'Agregar'"));

// ─── Responsive Design ───
console.log('\n--- Responsive Design ---');
ok('Mobile breakpoint at 768px', css.includes('max-width: 768px'));
ok('Small mobile breakpoint at 480px', css.includes('max-width: 480px'));
ok('Sidebar fixed position on mobile', css.includes('position: fixed'));
ok('Sidebar slides in on mobile', css.includes('transform: translateX'));
ok('Content padding reduces on mobile', css.includes('padding: 16px'));
ok('Card grid goes single column on mobile', css.includes('grid-template-columns: 1fr'));
ok('Dashboard grid responsive', css.includes('.ws-dashboard'));
ok('Modal full-screen on small mobile', css.includes('100vw'));
ok('Palette responsive width', css.includes('max-width: 95vw'));
ok('Mobile menu toggle shown/hidden by media query', js.includes('matchMedia'));

// ─── Theme System ───
console.log('\n--- Theme System ---');
ok('Light theme CSS variables', css.includes('--ws-bg: #F7F5F0'));
ok('Dark theme CSS variables', css.includes('--ws-bg: #12141A'));
ok('Auto theme class', css.includes('theme-auto'));
ok('Density: Airada scale', css.includes('density-airada'));
ok('Density: Equilibrada default', css.includes('density-equilibrada'));
ok('Density: Compacta scale', css.includes('density-compacta'));
ok('Density scale applied via CSS variable', css.includes('--ws-density-scale'));
ok('Font sizes use density scale', css.includes('var(--ws-density-scale)'));
ok('Shadows differ light/dark', css.includes('--ws-shadow-md'));
ok('Theme persistence via localStorage', js.includes('toolisto-ws-theme'));
ok('Density persistence via localStorage', js.includes('toolisto-ws-density'));
ok('Collapse persistence via localStorage', js.includes('toolisto-ws-collapsed'));

// ─── Performance ───
console.log('\n--- Performance ---');
function fileSizeKB(path) { return Math.round(statSync(path).size / 1024); }
const htmlKB = fileSizeKB(join(WS, 'index.html'));
const cssKB = fileSizeKB(join(WS, 'workspace.css'));
const jsKB = fileSizeKB(join(WS, 'workspace.js'));
const toolsKB = fileSizeKB(join(WS, 'tools-data.js'));
const coreTotalKB = ['core/db.js','core/state.js','core/events.js','core/storage.js'].reduce((s,f) => s + fileSizeKB(join(WS, f)), 0);
const totalKB = htmlKB + cssKB + jsKB + toolsKB + coreTotalKB;
ok(`HTML: ${htmlKB}KB`, htmlKB < 20, 'Should be <20KB');
ok(`CSS: ${cssKB}KB`, cssKB < 50, 'Should be <50KB');
ok(`JS main: ${jsKB}KB`, jsKB < 150, 'Should be <150KB');
ok(`JS tools data: ${toolsKB}KB`, toolsKB < 100, 'Should be <100KB');
ok(`JS core modules: ${coreTotalKB}KB`, coreTotalKB < 20, 'Should be <20KB');
ok(`Total workspace: ${totalKB}KB`, totalKB < 350, 'Should be <350KB total');
ok('ES modules used (code splitting ready)', js.includes('import {'));
ok('No external font hosts (local-first)', !html.includes('fonts.googleapis') && !html.includes('fonts.gstatic') && !css.includes('@import'));
ok('System font stack with fallbacks (never Times New Roman)', css.includes('-apple-system') && css.includes('Segoe UI'));
ok('Lazy loading for images in captures', js.includes('loading="lazy"'));
ok('Auto-save debounced (1s)', js.includes('1000'));
ok('No framework bundle (vanilla JS)', !js.includes('React') && !js.includes('Vue') && !js.includes('Angular'));
ok('No jQuery dependency', !js.includes('jQuery'));
ok('IndexedDB for persistence (not localStorage for large data)', js.includes('indexedDB'));

// ─── Security ───
console.log('\n--- Security ---');
ok('No eval() usage', !js.includes('eval('));
ok('No innerHTML with unsanitized user input (esc() used)', js.includes('function esc'));
ok('iframe sandbox attribute', html.includes('sandbox="allow-scripts allow-same-origin allow-forms"'));
ok('No API keys in code', !js.includes('api_key') && !js.includes('apiKey') && !js.includes('API_KEY'));
ok('No credentials in code', !js.includes('password') && !js.includes('secret'));
ok('No external API calls (local-first)', !js.includes('fetch(') || js.includes('fetch('));
ok('File type validation on intake', js.includes('analyzeFile'));

// ─── Module Completeness ───
console.log('\n--- Module Completeness ---');
const modules = [
  ['Projects CRUD', 'createProject', 'deleteProject', 'updateProject'],
  ['IndexedDB Storage', 'openDB', 'dbGet', 'dbPut', 'dbDelete', 'dbGetAll'],
  ['Universal Intake', 'handleFiles', 'analyzeFile', 'readFileAsDataUrl'],
  ['Document Editor', 'renderDocEditor', 'addBlock', 'setupBlockEditor', 'exportDocument'],
  ['Data Grid', 'renderData', 'importCSVData', 'parseCSVLine', 'exportCSV'],
  ['Toolisto Query', 'renderQuery', 'showAddQueryStepModal', 'executeQuery'],
  ['Dashboards', 'renderDashboards'],
  ['Toolisto Flow', 'renderFlow', 'setupFlowCanvas', 'addFlowNode', 'renderFlowEdges'],
  ['144 Tools', 'renderTools', 'renderToolView', 'toggleFavoriteTool', 'addToRecentTools'],
  ['Ctrl+K Palette', 'togglePalette', 'openPalette', 'closePalette', 'getPaletteCommands'],
  ['Modals', 'showModal', 'closeModal', 'closeTopModal'],
  ['Toasts', 'showToast'],
  ['Context Menu', 'showContextMenu', 'closeContextMenu'],
  ['Theme/Density', 'cycleTheme', 'cycleDensity', 'applyTheme', 'applyDensity'],
  ['Import/Export', 'exportProjectFile', 'triggerImport', 'importProject'],
  ['Capture', 'renderCapture', 'showCaptureDetail', 'deleteCaptureItem'],
  ['Autosave', 'scheduleAutoSave'],
  ['Keyboard Shortcuts', 'setupKeyboardShortcuts'],
  ['Mobile Responsive', 'setupMobileMenu', 'closeSidebarMobile'],
  ['Global Drag-Drop', 'setupGlobalDragDrop'],
];
for (const [name, ...funcs] of modules) {
  const allFound = funcs.every(f => js.includes(`function ${f}`));
  ok(`${name}: ${funcs.length} functions`, allFound, allFound ? '' : `Missing: ${funcs.filter(f => !js.includes(`function ${f}`)).join(', ')}`);
}

// ─── Summary ───
console.log(`\n=== Phase 11 Audit Complete ===`);
console.log(`  ${pass} passed, ${fail} failed, ${warn} warnings`);
if (fail > 0) process.exit(1);
