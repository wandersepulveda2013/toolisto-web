// Part 1: Imports, SVG, Helpers
import { appStore } from './core/state.js';
import { on, emit } from './core/events.js';
import { generateId } from './core/db.js';
import {
  createProject, updateProject, deleteProject, loadProjects as _loadProjects,
  selectProject, saveDoc, loadDocs, deleteDoc, saveData, loadData, deleteData, saveCapture,
  loadCaptures, loadDocumentById, loadCaptureById, deleteCapture, previewCaptureDeletion, exportProject, importProject, refreshProjectCounts,
  saveSetting, loadSetting, saveDataModel, loadDataModel,
  saveAsset, loadAsset, loadAssetsByProject, loadAssetsByType, deleteAsset, persistScannerResult,
  saveExecution, loadExecution, loadExecutionsByProject,
  registerExecution,
  createImageAsset, createFileAsset, createScanDocument, createScanPage,
  createTextDocument, createTextBlock, createTableDocument, createDataSheet,
  createChart, createDesignDocument, createDesignLayer,
  createToolExecution, createExportArtifact,
  addRelation, removeRelation, getRelatedIds, pushHistory,
} from './core/storage.js';
import { TOOLS_DATA } from './tools-data.js';
import { createScannerUI } from './core/scanner-ui.js';
import { createReportSection, createReportConfig, getReportPageSize, renderReportPreview } from './core/design-report.js';
import { generatePDF } from './core/pdf-generator.js';
import { createHistoryManager } from './core/history-manager.js';
import { saveWorkspaceSession, hasRecoverableSession, loadWorkspaceSession, deleteWorkspaceSession, getWorkspaceSessionInfo } from './core/workspace-storage.js';
import { setToastHandler, showUserError, showWarning, showSuccess, setupGlobalErrorHandling, withErrorHandling, reportError, classifyError } from './core/error-manager.js';
import { createOperationRegistry } from './core/operation-registry.js';
import { registerWorkflowOperations } from './core/workflow-operations.js';
import { createWorkflowUI } from './core/workflow-ui.js';
import { createInstructionAssistant } from './core/instruction-assistant-ui.js';
import { isOcrEngineAvailable, loadCanvasFromImageSource, recognizeText } from './core/ocr-engine.js';
import { normalizeDataModel, detectDataModelRelationships, modelFieldMeta, modelRelationshipTitle } from './core/model.js';
import { resolveCaptureImageDataUrl } from './core/capture-image.js';
import { normalizePdfImageSections } from './core/pdf-images.js';

const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];
const h = (tag, attrs, ...children) => {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'className') el.className = v;
    else if (k === 'ariaLabel') el.setAttribute('aria-label', v);
    else if (k === 'html') {
      // ``html`` is intentionally restricted to already-created DOM nodes.
      // This prevents icon markup or user-provided content from becoming text
      // accidentally (or executable HTML) at render time.
      if (v && typeof v === 'object' && v.nodeType) el.appendChild(v);
      else if (v != null) el.textContent = String(v);
    }
    else el.setAttribute(k, v);
  });
  children.flat().forEach(c => {
    if (c == null || c === false) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
};

let _operationRegistry = null;
let workflowUI = null;
let workflowUIContainer = null;
const sv = (tag, attrs, ...children) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  children.flat().forEach(c => { if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return el;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const formatBytes = (b) => {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  const unit = Math.min(i, u.length - 1);
  return (b / Math.pow(1024, unit)).toFixed(unit ? 1 : 0) + ' ' + u[unit];
};
function parseLocaleNumber(value) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  if (/[A-Za-zÀ-ÿ]/.test(text)) return null;
  const negativeByParentheses = /^\(.*\)$/.test(text);
  text = text.replace(/\s+/g, '').replace(/[^\d,.+\-()]/g, '').replace(/[()]/g, '');
  if (!text || !/[\d]/.test(text)) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (comma >= 0) {
    const groups = text.split(',');
    text = groups.length > 2 && groups.at(-1).length === 3 ? groups.join('') : text.replace(',', '.');
  } else if (dot >= 0) {
    const groups = text.split('.');
    text = groups.length > 2 && groups.at(-1).length === 3 ? groups.join('') : text;
  }
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return negativeByParentheses ? -Math.abs(number) : number;
}
/**
 * WAI-ARIA tabs contract for ribbon tablists of the Workspace.
 * Establishes roving tabindex (only the active tab is in the tab order),
 * arrow/Home/End navigation that activates the focused tab, and keeps the
 * roving state consistent after pointer activation.
 *
 * When `focusTarget` is provided (a selector for the element inside each
 * `role="tab"` that carries focus, e.g. a nested activation button), roving
 * tabindex and focus follow that control instead of the tab container.
 */
function enableTablistKeyboard(tablist, { focusTarget } = {}) {
  if (!tablist) return null;
  const tabs = () => Array.from(tablist.querySelectorAll('[role="tab"]'));
  const focusableOf = (t) => (focusTarget && t.querySelector(focusTarget)) || t;
  const syncRoving = () => {
    tabs().forEach(t => {
      const active = t.getAttribute('aria-selected') === 'true';
      focusableOf(t).tabIndex = active ? 0 : -1;
    });
  };
  syncRoving();
  tablist.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) syncRoving(tab);
  });
  tablist.addEventListener('keydown', (e) => {
    const tabOf = (el) => el && el.closest ? el.closest('[role="tab"]') : null;
    const currentEl = tabOf(document.activeElement);
    const list = tabs();
    const current = currentEl ? list.indexOf(currentEl) : -1;
    if (current < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    const target = list[next];
    const activationControl = focusableOf(target);
    activationControl.click();
    activationControl.focus();
    syncRoving();
  });
  return { syncRoving };
}

const formatTimeAgo = (ts) => {
  const d = Date.now() - ts;
  if (d < 60000) return 'ahora';
  if (d < 3600000) return Math.floor(d / 60000) + ' min';
  if (d < 86400000) return Math.floor(d / 3600000) + ' h';
  if (d < 2592000000) return Math.floor(d / 86400000) + ' d';
  return new Date(ts).toLocaleDateString('es');
};
const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

const WORKSPACE_DEFAULTS = Object.freeze({
  maxFileSizeMB: 50,
  maxTableRows: 5000,
  maxTableColumns: 50,
  maxClipboardCells: 10000,
  maxDocumentBlocks: 1000,
});

const WORKSPACE_FILE_TYPES = [
  { label: 'Imágenes', extensions: 'JPG, JPEG, PNG, WebP, GIF, SVG, AVIF, BMP, TIFF, ICO, HEIC', note: 'Capturas, portadas e imágenes dentro de documentos.' },
  { label: 'Datos', extensions: 'CSV, TSV, TXT, JSON, JSONL, XML, YAML, YML, TOML, INI, LOG, SQL', note: 'Tablas, pegado tabular y preparación en Query.' },
  { label: 'Documentos y hojas', extensions: 'MD, Markdown, HTML, CSS, JS, TS, RTF, TEX, DOC, DOCX, ODT, PDF, EPUB, XLS, XLSX, XLSM, ODS, OTS', note: 'Ingesta, edición local y extracción según el tipo de archivo.' },
  { label: 'Audio, vídeo y paquetes', extensions: 'MP3, WAV, OGG, OPUS, FLAC, M4A, AAC, WMA, MP4, WebM, MOV, AVI, MKV, MPEG, 3GP, ZIP, 7Z, TAR, GZ, BZ2, XZ, RAR', note: 'Material de origen y archivos agrupados para inspeccionar o procesar.' },
  { label: 'Archivos de proyecto', extensions: 'TOOLISTO, JSON', note: 'Respaldo completo de proyectos y contenido local.' },
];

const WORKSPACE_KNOWN_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.tif', '.tiff', '.ico', '.heic',
  '.csv', '.tsv', '.txt', '.json', '.jsonl', '.ndjson', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log', '.sql',
  '.md', '.markdown', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.rtf', '.tex', '.doc', '.docx', '.docm', '.dot', '.dotx', '.odt', '.pdf', '.epub',
  '.xls', '.xlsx', '.xlsm', '.xlt', '.xltx', '.ods', '.ots',
  '.mp3', '.wav', '.ogg', '.opus', '.flac', '.m4a', '.aac', '.wma', '.aiff', '.aif',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.mpeg', '.mpg', '.3gp', '.m4v',
  '.zip', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.rar', '.toolisto',
]);

function getWorkspaceConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('toolisto-workspace-config') || '{}');
    return Object.fromEntries(Object.entries(WORKSPACE_DEFAULTS).map(([key, fallback]) => {
      const value = Number(saved[key]);
      return [key, Number.isFinite(value) && value > 0 ? value : fallback];
    }));
  } catch (error) {
    return { ...WORKSPACE_DEFAULTS };
  }
}

function saveWorkspaceConfig(config) {
  const next = { ...WORKSPACE_DEFAULTS, ...config };
  try { localStorage.setItem('toolisto-workspace-config', JSON.stringify(next)); } catch (error) {}
  appStore.set({ workspaceConfig: next });
  return next;
}

function workspaceFileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function validateWorkspaceFile(file, allowedExtensions = []) {
  const config = getWorkspaceConfig();
  if (!file) return { ok: false, message: 'No se seleccionó ningún archivo.' };
  if (file.size > config.maxFileSizeMB * 1024 * 1024) {
    return { ok: false, message: `El archivo supera el límite configurado de ${config.maxFileSizeMB} MB.` };
  }
  const extension = workspaceFileExtension(file.name);
  const accepted = allowedExtensions.length ? allowedExtensions.includes(extension) : WORKSPACE_KNOWN_EXTENSIONS.has(extension);
  if (!accepted) {
    const hint = allowedExtensions.length ? allowedExtensions.join(', ') : [...WORKSPACE_KNOWN_EXTENSIONS].join(', ');
    return { ok: false, message: `Formato no admitido aquí. Usa: ${hint}.` };
  }
  return { ok: true };
}

function getBrowserStorageEstimate() {
  if (!navigator.storage?.estimate) return Promise.resolve(null);
  return navigator.storage.estimate().then(estimate => ({
    usage: estimate.usage || 0,
    quota: estimate.quota || 0,
  })).catch(() => null);
}

const workspaceNavigation = { entries: [], index: -1, restoring: false };

function navigationEntry(view, project) {
  return { view, projectId: project?.id || null };
}

function sameNavigationEntry(left, right) {
  return Boolean(left && right && left.view === right.view && left.projectId === right.projectId);
}

function syncNavigationControls() {
  const back = $('#ws-history-back');
  const forward = $('#ws-history-forward');
  if (back) back.disabled = workspaceNavigation.index <= 0;
  if (forward) forward.disabled = workspaceNavigation.index < 0 || workspaceNavigation.index >= workspaceNavigation.entries.length - 1;
}

function recordNavigation(view, project) {
  if (workspaceNavigation.restoring) {
    syncNavigationControls();
    return;
  }
  const entry = navigationEntry(view, project);
  const current = workspaceNavigation.entries[workspaceNavigation.index];
  if (sameNavigationEntry(current, entry)) {
    syncNavigationControls();
    return;
  }
  workspaceNavigation.entries = workspaceNavigation.entries.slice(0, workspaceNavigation.index + 1);
  workspaceNavigation.entries.push(entry);
  workspaceNavigation.index = workspaceNavigation.entries.length - 1;
  syncNavigationControls();
}

function restoreNavigationEntry(entry) {
  if (!entry) return;
  const project = entry.projectId
    ? appStore.get('projects').find(item => item.id === entry.projectId) || null
    : null;
  workspaceNavigation.restoring = true;
  appStore.set({ currentProject: project });
  appStore.set({ currentView: entry.view });
  workspaceNavigation.restoring = false;
  syncNavigationControls();
}

function navigateHistory(direction) {
  const nextIndex = workspaceNavigation.index + direction;
  if (nextIndex < 0 || nextIndex >= workspaceNavigation.entries.length) {
    toast(direction < 0 ? 'No hay una vista anterior' : 'No hay una vista siguiente', 'info');
    return;
  }
  workspaceNavigation.index = nextIndex;
  restoreNavigationEntry(workspaceNavigation.entries[nextIndex]);
}

function refreshCurrentView() {
  const view = appStore.get('currentView');
  renderView(view);
  updateTopbar(view, appStore.get('currentProject'));
  toast('Vista actualizada', 'success');
}

async function saveCurrentWorkspaceItem() {
  const project = appStore.get('currentProject');
  const view = appStore.get('currentView');
  if (!project) return;
  if (view === 'doc-editor' && appStore.get('currentDoc')) {
    clearTimeout(autoSaveDoc._timer);
    await saveDoc(project.id, appStore.get('currentDoc'));
    appStore.set({ isDirty: false, lastSaved: Date.now() });
    toast('Documento guardado', 'success');
  } else if (view === 'data-table' && appStore.get('currentDataTable')) {
    clearTimeout(autoSaveTable._timer);
    const table = appStore.get('currentDataTable');
    await saveData(project.id, table);
    await syncDerivedCharts(project, table);
    appStore.set({ isDirty: false, lastSaved: Date.now() });
    toast('Tabla guardada', 'success');
  } else {
    toast('Esta vista se guarda automáticamente', 'info');
  }
}

const SVG = {
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  flow: '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><line x1="8" y1="11" x2="16" y2="7"/><line x1="8" y1="13" x2="16" y2="17"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starFill: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="18" x2="16" y2="18"/>',
  qr: '<rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4"/>',
  sign: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  sparkle: '<path d="m12 3-1.6 5.4L5 10l5.4 1.6L12 17l1.6-5.4L19 10l-5.4-1.6L12 3z"/><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  sort: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  crop: '<path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>',
  rotate: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  ocr: '<text x="4" y="18" font-size="10" font-weight="bold" fill="currentColor" font-family="sans-serif">OCR</text>',
  enhance: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>',
  italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  underline: '<path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  formula: '<text x="3" y="17" font-size="14" font-weight="bold" fill="currentColor" font-family="serif" font-style="italic">fx</text>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronRightDouble: '<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>',
  chevronLeftDouble: '<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  divider: '<line x1="2" y1="12" x2="22" y2="12"/>',
  callout: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  grip: '<circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/><circle cx="5" cy="19" r="1"/>',
  duplicate: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.41 1.41-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-2v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.41-1.41.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.03H7v-2h.84A1.7 1.7 0 0 0 9.4 10a1.7 1.7 0 0 0-.34-1.88L9 8.06l1.41-1.41.06.06A1.7 1.7 0 0 0 12.35 7a1.7 1.7 0 0 0 1.03-1.56V5h2v.44A1.7 1.7 0 0 0 16.4 7a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.41 1.41-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.56 1.03H21v2h-.04A1.7 1.7 0 0 0 19.4 15z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  cut: '<path d="m6 6 12 12M18 6 6 18"/><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/>',
  paste: '<path d="M9 5h6"/><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 11h6M9 15h6"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  alignLeft: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  alignCenter: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  alignRight: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  strike: '<path d="M6 4h7a4 4 0 0 1 3.6 2.2M18 15.5A4 4 0 0 1 14 20H6"/><path d="M4 12h16"/>',
  highlight: '<path d="m5 15 7-7 4 4-7 7H5z"/><path d="m14 7 2-2 4 4-2 2"/><path d="M3 21h18"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  imageBlock: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  indent: '<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/><polyline points="17 15 21 12 17 9"/>',
  outdent: '<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/><polyline points="7 15 3 12 7 9"/>',
  empty: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  emptyFolder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
};

const svgIcon = (name, size = 18) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.icon = name;

  // The registry is local, fixed code. DOMParser keeps the result as SVG
  // nodes without using innerHTML or accepting content from users.
  const parsed = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg">' + (SVG[name] || SVG.empty) + '</svg>',
    'image/svg+xml'
  );
  [...parsed.documentElement.childNodes].forEach(node => {
    svg.appendChild(document.importNode(node, true));
  });
  return svg;
};

const replaceSvgIcon = (target, name, size = 18) => {
  if (!target) return;
  target.replaceChildren(svgIcon(name, size));
};

const makeSvgNode = (tag, attrs, parent) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (parent) parent.appendChild(node);
  return node;
};

function createStudioArtwork() {
  const svg = makeSvgNode('svg', {
    class: 'ws-hero-drawing',
    viewBox: '0 0 520 430',
    role: 'img',
    'aria-label': 'Ilustración abstracta de Toolisto',
  });
  const paper = '#F3EBDD';
  const ink = '#111111';
  const soft = '#D8D6CE';
  makeSvgNode('rect', { x: 8, y: 8, width: 504, height: 414, rx: 26, fill: paper }, svg);
  const wave = makeSvgNode('g', { class: 'ws-drawing-wave' }, svg);
  makeSvgNode('path', { d: 'M8 318C73 278 119 292 164 326S258 384 318 346s125-33 194 17v59H8z', fill: ink }, wave);
  makeSvgNode('path', { d: 'M8 315C73 276 120 291 165 324s95 58 154 20 125-33 193 17', fill: 'none', stroke: paper, 'stroke-width': 2, opacity: .85 }, wave);
  makeSvgNode('path', { d: 'M8 345c72-38 118-19 163 11s101 47 151 16 114-28 190 13', fill: 'none', stroke: soft, 'stroke-width': 1, 'stroke-dasharray': '4 5', opacity: .7 }, wave);
  makeSvgNode('path', { class: 'ws-drawing-stroke', d: 'M28 326C82 294 93 354 139 328S206 285 239 313', fill: 'none', stroke: ink, 'stroke-width': 2 }, svg);
  makeSvgNode('path', { class: 'ws-drawing-stroke ws-drawing-stroke-delay', d: 'M338 44C390 20 449 42 486 81', fill: 'none', stroke: ink, 'stroke-width': 2 }, svg);
  const core = makeSvgNode('g', { class: 'ws-drawing-core' }, svg);
  makeSvgNode('circle', { cx: 273, cy: 218, r: 132, fill: ink }, core);
  makeSvgNode('ellipse', { class: 'ws-drawing-orbit', cx: 273, cy: 218, rx: 190, ry: 78, transform: 'rotate(-18 273 218)', fill: 'none', stroke: paper, 'stroke-width': 2, opacity: .72 }, core);
  makeSvgNode('ellipse', { class: 'ws-drawing-orbit ws-drawing-orbit-second', cx: 273, cy: 218, rx: 154, ry: 116, transform: 'rotate(28 273 218)', fill: 'none', stroke: paper, 'stroke-width': 1.5, opacity: .44 }, core);
  makeSvgNode('circle', { class: 'ws-drawing-dot', cx: 430, cy: 144, r: 8, fill: paper }, core);
  makeSvgNode('circle', { class: 'ws-drawing-dot ws-drawing-dot-small', cx: 141, cy: 256, r: 5, fill: paper }, core);
  makeSvgNode('path', { d: 'M231 170h84M273 128v180M231 266h84', fill: 'none', stroke: paper, 'stroke-width': 1.4, opacity: .65 }, core);
  const note = makeSvgNode('g', { class: 'ws-drawing-note' }, svg);
  makeSvgNode('rect', { x: 40, y: 62, width: 138, height: 150, rx: 14, fill: paper, stroke: ink, 'stroke-width': 2 }, note);
  makeSvgNode('path', { d: 'M61 91h55M61 106h82M61 121h61M61 155h73M61 170h52', fill: 'none', stroke: ink, 'stroke-width': 3, 'stroke-linecap': 'round' }, note);
  makeSvgNode('rect', { x: 61, y: 185, width: 36, height: 5, rx: 2, fill: ink }, note);
  makeSvgNode('path', { d: 'M63 76h15', fill: 'none', stroke: ink, 'stroke-width': 5, 'stroke-linecap': 'round' }, note);
  const floating = makeSvgNode('g', { class: 'ws-drawing-floating' }, svg);
  makeSvgNode('rect', { x: 352, y: 286, width: 128, height: 82, rx: 16, fill: ink }, floating);
  makeSvgNode('path', { d: 'M373 312h58M373 328h42M373 344h25', fill: 'none', stroke: paper, 'stroke-width': 3, 'stroke-linecap': 'round' }, floating);
  makeSvgNode('circle', { cx: 449, cy: 312, r: 8, fill: paper }, floating);
  makeSvgNode('path', { class: 'ws-drawing-arrow', d: 'M412 238c19 17 29 28 35 48', fill: 'none', stroke: ink, 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
  makeSvgNode('path', { class: 'ws-drawing-arrow', d: 'M447 277l2 12-11-5', fill: 'none', stroke: ink, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  makeSvgNode('path', { d: 'M387 106l8-17 9 17-9 17z', fill: soft, stroke: ink, 'stroke-width': 2 }, svg);
  return svg;
}

const CATEGORY_META = {
  images: { label: 'Imagenes', icon: 'image', color: 'blue' },
  pdf: { label: 'PDF', icon: 'pdf', color: 'orange' },
  documents: { label: 'Documentos', icon: 'doc', color: 'green' },
  text: { label: 'Texto', icon: 'text', color: 'violet' },
  spreadsheets: { label: 'Hojas de calculo', icon: 'table', color: 'green' },
  video: { label: 'Video', icon: 'video', color: 'orange' },
  audio: { label: 'Audio', icon: 'audio', color: 'violet' },
  files: { label: 'Archivos', icon: 'archive', color: 'blue' },
  qrcodes: { label: 'Codigos QR', icon: 'qr', color: 'green' },
  signatures: { label: 'Firmas', icon: 'sign', color: 'orange' },
  ebooks: { label: 'eBooks', icon: 'book', color: 'violet' },
  calculators: { label: 'Calculadoras', icon: 'calc', color: 'blue' },
};

function getCategoryIconSvg(cat) {
  const m = CATEGORY_META[cat];
  return m ? svgIcon(m.icon) : svgIcon('tool');
}

// Part 2: Navigation, Theme, Init
function setActiveSidebar(view) {
  $$('.sidebar-item').forEach(b => {
    const isActive = b.dataset.view === view;
    b.classList.toggle('active', isActive);
    if (isActive) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function updateBreadcrumb(parts) {
  const bc = $('#ws-breadcrumb');
  bc.replaceChildren();
  parts.forEach((p, i) => {
    if (i > 0) {
      const sep = h('span', null, ' / ');
      sep.style.color = 'var(--ws-text-tertiary)';
      bc.appendChild(sep);
    }
    if (i < parts.length - 1 && p.onClick) {
      bc.appendChild(h('a', { onClick: p.onClick }, p.label));
    } else {
      const span = h('span', { className: 'current' }, typeof p === 'string' ? p : p.label);
      bc.appendChild(span);
    }
  });
}

function updateTopbar(view, project) {
  const projNav = $('#ws-project-nav');
  if (project) {
    projNav.style.display = '';
    $('#ws-project-name').textContent = project.name;
    const totalItems = (project.captureCount || 0) + (project.docCount || 0) + (project.dataCount || 0);
    $('#ws-badge-overview').textContent = totalItems;
    $('#ws-badge-captures').textContent = project.captureCount || 0;
    $('#ws-badge-docs').textContent = project.docCount || 0;
    $('#ws-badge-data').textContent = project.dataCount || 0;
  } else {
    projNav.style.display = 'none';
  }
  const globalNav = $('#ws-global-module-nav');
  if (globalNav) globalNav.style.display = project ? 'none' : '';
  const statusText = $('#ws-statusbar-text');
  if (statusText) {
    const counts = project ? `${project.captureCount || 0} capturas · ${project.docCount || 0} documentos · ${project.dataCount || 0} tablas` : 'Espacio personal';
    statusText.textContent = `LOCAL / LISTO · ${counts}`;
  }
  const actions = $('#ws-topbar-actions');
  actions.replaceChildren();
  const historyControls = h('div', { className: 'ws-history-controls', role: 'group', ariaLabel: 'Navegación de vistas' });
  historyControls.appendChild(h('button', {
    className: 'ws-topbar-icon ws-history-btn',
    id: 'ws-history-back',
    ariaLabel: 'Vista anterior, Alt Flecha izquierda',
    title: 'Atrás · Alt + ←',
    onClick: () => navigateHistory(-1),
  }, svgIcon('back', 16)));
  historyControls.appendChild(h('button', {
    className: 'ws-topbar-icon ws-history-btn',
    id: 'ws-history-forward',
    ariaLabel: 'Vista siguiente, Alt Flecha derecha',
    title: 'Adelante · Alt + →',
    onClick: () => navigateHistory(1),
  }, svgIcon('redo', 16)));
  historyControls.appendChild(h('button', {
    className: 'ws-topbar-icon ws-history-btn',
    ariaLabel: 'Actualizar vista, Ctrl R',
    title: 'Actualizar vista · Ctrl + R',
    onClick: refreshCurrentView,
  }, svgIcon('rotate', 16)));
  historyControls.appendChild(h('button', {
    className: 'ws-topbar-icon ws-history-btn',
    id: 'ws-undo-btn',
    ariaLabel: 'Deshacer, Ctrl Z',
    title: 'Deshacer · Ctrl + Z',
    disabled: !appStore.get('undoStackSize'),
    onClick: () => {
      const restored = _appHistory.undo(_captureWorkspaceState());
      if (restored) { _applyState(restored); toast('Deshecho', 'success'); }
    },
  }, svgIcon('undo', 15)));
  historyControls.appendChild(h('button', {
    className: 'ws-topbar-icon ws-history-btn',
    id: 'ws-redo-btn',
    ariaLabel: 'Rehacer, Ctrl Y',
    title: 'Rehacer · Ctrl + Y',
    disabled: !appStore.get('redoStackSize'),
    onClick: () => {
      const restored = _appHistory.redo(_captureWorkspaceState());
      if (restored) { _applyState(restored); toast('Rehecho', 'success'); }
    },
  }, svgIcon('redo', 15)));
  actions.appendChild(historyControls);
  actions.appendChild(h('span', { className: 'ws-save-state', id: 'ws-save-indicator' }, svgIcon('check', 14), ' LOCAL / LISTO'));
  actions.appendChild(h('button', {
    className: 'ws-topbar-btn ws-topbar-search',
    ariaLabel: 'Abrir búsqueda universal, Ctrl K',
    onClick: () => appStore.set({ paletteOpen: true })
  }, svgIcon('search', 16), 'Buscar', h('kbd', null, 'Ctrl K')));
  actions.appendChild(h('button', {
    className: 'ws-topbar-icon', ariaLabel: 'Cambiar tema', onClick: toggleTheme
  }, svgIcon(document.documentElement.classList.contains('theme-dark') ? 'sun' : 'moon', 17)));
  actions.appendChild(h('button', {
    className: 'ws-topbar-icon', ariaLabel: 'Cambiar densidad', onClick: toggleDensity
  }, svgIcon('filter', 17)));
  actions.appendChild(h('button', {
    className: 'ws-topbar-btn ws-topbar-settings',
    ariaLabel: 'Abrir ajustes y capacidades',
    title: 'Ajustes y capacidades',
    onClick: openWorkspaceSettings,
  }, svgIcon('settings', 16), 'Ajustes'));
  const viewNames = {
    projects: 'Proyectos', intake: 'Captura Universal', dashboard: 'Panel',
    capture: 'Captura', documents: 'Documentos', data: 'Datos',
    query: 'Toolisto Query', dashboards: 'Dashboards', flujos: 'Flujos', flow: 'Toolisto Flow', tools: 'Herramientas',
    'doc-editor': 'Editor', 'data-table': 'Tabla de Datos', 'design': 'Diseño'
  };
  if (project) {
    updateBreadcrumb([
      { label: 'Proyectos', onClick: () => navigateTo('projects') },
      { label: project.name },
      viewNames[view] || view
    ]);
  } else {
    updateBreadcrumb([viewNames[view] || view]);
  }
  const viewBtns = {
    projects: [h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: createNewProject }, svgIcon('plus'), ' Nuevo Proyecto')],
    dashboard: [h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => exportProjectData() }, svgIcon('download'), ' Exportar')],
    documents: [
      h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: createNewDoc }, svgIcon('plus'), ' Nuevo Documento'),
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: importDocumentFile }, svgIcon('upload'), ' Importar')
    ],
    data: [h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: createNewDataTable }, svgIcon('plus'), ' Nueva Tabla')],
    tools: [h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => appStore.set({ paletteOpen: true }) }, svgIcon('search'), ' Buscar')],
    'doc-editor': [
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => navigateTo('documents') }, svgIcon('back'), ' Documentos'),
      h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: exportDocument }, svgIcon('download'), ' Exportar')
    ],
    'data-table': [
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => navigateTo('data') }, svgIcon('back'), ' Datos'),
      h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: () => exportTableCSV(appStore.get('currentDataTable')) }, svgIcon('download'), ' Exportar CSV')
    ],
    query: [
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: importQueryFile }, svgIcon('upload'), ' Nueva fuente'),
      h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: exportQueryResult }, svgIcon('download'), ' Exportar CSV')
    ],
  };
  (viewBtns[view] || []).forEach(b => actions.appendChild(b));
  syncNavigationControls();
}

function openWorkspaceSettings() {
  const config = getWorkspaceConfig();
  const input = (value, min, max, step = 1) => h('input', {
    className: 'ws-input ws-capability-input',
    type: 'number',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });
  const maxFileSize = input(config.maxFileSizeMB, 1, 500);
  const maxRows = input(config.maxTableRows, 100, 100000);
  const maxColumns = input(config.maxTableColumns, 5, 200);
  const maxClipboard = input(config.maxClipboardCells, 100, 100000);
  const maxBlocks = input(config.maxDocumentBlocks, 10, 10000);
  const storageValue = h('strong', null, 'Calculando…');
  const typeCards = h('div', { className: 'ws-capabilities-list' }, ...WORKSPACE_FILE_TYPES.map(type => h('div', { className: 'ws-capability-card' },
    h('strong', null, type.label),
    h('span', { className: 'ws-capability-format' }, type.extensions),
    h('small', null, type.note)
  )));
  const body = [
    h('p', { className: 'ws-settings-lead' }, 'Configura hasta dónde puede crecer tu espacio local. Estos límites protegen el rendimiento del navegador y se pueden ampliar cuando lo necesites.'),
    h('div', { className: 'ws-settings-section-title' }, 'Formatos y almacenamiento'),
    typeCards,
    h('div', { className: 'ws-capability-storage' }, svgIcon('archive', 18), h('span', null, 'Almacenamiento estimado del navegador'), storageValue),
    h('div', { className: 'ws-settings-section-title' }, 'Límites de trabajo'),
    h('div', { className: 'ws-capability-form' },
      queryFormField('Archivo máximo (MB)', maxFileSize, 'Aplica a importaciones y archivos insertados.'),
      queryFormField('Filas máximas por tabla', maxRows, 'Puedes crear y pegar filas hasta este límite.'),
      queryFormField('Columnas máximas por tabla', maxColumns, 'Controla el ancho de nuevas tablas y pegados.'),
      queryFormField('Celdas máximas por pegado', maxClipboard, 'Protege el navegador al pegar bloques grandes desde Excel.'),
      queryFormField('Bloques máximos por documento', maxBlocks, 'Incluye texto, títulos, listas, imágenes y tablas.')
    ),
    h('p', { className: 'ws-settings-footnote' }, 'Toolisto funciona localmente en este navegador. El límite real depende del espacio disponible del dispositivo y del navegador.')
  ];
  showModal({
    title: 'Ajustes y capacidades',
    body,
    confirmText: 'Guardar configuración',
    size: 'wide',
    onConfirm: async () => {
      const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
      const next = saveWorkspaceConfig({
        maxFileSizeMB: clamp(maxFileSize.value, 1, 500),
        maxTableRows: clamp(maxRows.value, 100, 100000),
        maxTableColumns: clamp(maxColumns.value, 5, 200),
        maxClipboardCells: clamp(maxClipboard.value, 100, 100000),
        maxDocumentBlocks: clamp(maxBlocks.value, 10, 10000),
      });
      updateTopbar(appStore.get('currentView'), appStore.get('currentProject'));
      toast(`Configuración guardada · ${next.maxTableRows.toLocaleString('es')} filas por tabla`, 'success');
    },
  });
  getBrowserStorageEstimate().then(estimate => {
    storageValue.textContent = estimate?.quota ? `${formatBytes(estimate.usage)} usados de ${formatBytes(estimate.quota)}` : 'No disponible';
  });
}

function navigateTo(view, opts) {
  const project = appStore.get('currentProject');
  const projectViews = ['dashboard', 'capture', 'documents', 'data', 'data-table', 'model', 'query', 'dashboards', 'flow', 'flujos', 'doc-editor', 'scanner', 'design'];
  if (!project && projectViews.includes(view)) {
    toast('Crea o abre un proyecto para usar este módulo.', 'info');
    appStore.set({ currentView: 'projects' });
    return;
  }
  if (opts && opts.project) appStore.set({ currentProject: opts.project });
  if (opts && opts.doc) appStore.set({ currentDoc: opts.doc });
  if (opts && opts.dataTable) appStore.set({ currentDataTable: opts.dataTable });
  appStore.set({ currentView: view });
  emit('view:changed', { view, ...opts });
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.classList.contains('theme-dark') ? 'dark' : html.classList.contains('theme-light') ? 'light' : 'auto';
  const next = current === 'light' ? 'dark' : current === 'dark' ? 'auto' : 'light';
  html.classList.remove('theme-auto', 'theme-light', 'theme-dark');
  if (next === 'light') html.classList.add('theme-light');
  else if (next === 'dark') html.classList.add('theme-dark');
  else html.classList.add('theme-auto');
  $$('[data-theme-icon]').forEach(icon => replaceSvgIcon(icon, next === 'dark' ? 'sun' : 'moon', 18));
  const topTheme = $('.ws-topbar-icon[aria-label="Cambiar tema"]');
  if (topTheme) replaceSvgIcon(topTheme, next === 'dark' ? 'sun' : 'moon', 17);
  appStore.set({ theme: next });
  try { localStorage.setItem('toolisto-theme', next); } catch(e) {}
}

function toggleDensity() {
  const html = document.documentElement;
  const current = html.classList.contains('density-airada') ? 'airada' : html.classList.contains('density-compacta') ? 'compacta' : 'equilibrada';
  const next = current === 'equilibrada' ? 'compacta' : current === 'compacta' ? 'airada' : 'equilibrada';
  html.classList.remove('density-airada', 'density-equilibrada', 'density-compacta');
  html.classList.add('density-' + next);
  appStore.set({ density: next });
  try { localStorage.setItem('toolisto-density', next); } catch(e) {}
}

function toggleSidebar() {
  const collapsed = !appStore.get('sidebarCollapsed');
  appStore.set({ sidebarCollapsed: collapsed });
  $('#ws-sidebar').classList.toggle('collapsed', collapsed);
  const btn = $('#ws-collapse-toggle');
  replaceSvgIcon(btn, collapsed ? 'chevronRightDouble' : 'chevronLeftDouble', 18);
  try { localStorage.setItem('toolisto-sidebar-collapsed', collapsed); } catch(e) {}
}

let _appHistory = null;
let _autosaveTimer = null;
let _lastAutosaveSnapshot = '';
let _lastAutosaveTableSnapshot = '';

function _captureWorkspaceState() {
  const s = appStore.get();
  return {
    currentView: s.currentView,
    currentDoc: s.currentDoc ? JSON.parse(JSON.stringify(s.currentDoc)) : null,
    currentDataTable: s.currentDataTable ? JSON.parse(JSON.stringify(s.currentDataTable)) : null,
    documents: (s.documents || []).map(d => ({ id: d.id, name: d.name, title: d.title, blocks: d.blocks ? d.blocks.map(b => ({ id: b.id, content: b.content })) : [] })),
    dataTables: (s.dataTables || []).map(t => ({ id: t.id, name: t.name, headers: t.headers, rows: t.rows })),
    captures: (s.captures || []).map(c => ({ id: c.id, name: c.name, dataUrl: c.dataUrl ? c.dataUrl.slice(0, 200) : null })),
    designConfig: s.designConfig ? JSON.parse(JSON.stringify(s.designConfig)) : null,
    flowNodes: s.flowNodes || [],
    flowEdges: s.flowEdges || [],
  };
}

function _historyChanged(status) {
  appStore.set({ undoStackSize: status.canUndo ? (status.canUndo ? 1 : 0) : 0, redoStackSize: status.canRedo ? 1 : 0 });
}

function _setupAutosave() {
  clearInterval(_autosaveTimer);
  _autosaveTimer = setInterval(async () => {
    try {
      const project = appStore.get('currentProject');
      const doc = appStore.get('currentDoc');
      const table = appStore.get('currentDataTable');
      if (!project) return;
      let saved = false;
      if (doc && appStore.get('isDirty')) {
        const snapshot = JSON.stringify(doc.blocks);
        if (snapshot !== _lastAutosaveSnapshot) {
          await saveDoc(project.id, doc);
          _lastAutosaveSnapshot = snapshot;
          _appHistory.push(_captureWorkspaceState(), { action: 'doc-edit' });
          saved = true;
        }
      }
      if (table && appStore.get('isDirty')) {
        const snapshot = JSON.stringify({ headers: table.headers, rows: table.rows, sheets: table.sheets });
        if (snapshot !== _lastAutosaveTableSnapshot) {
          await saveData(project.id, table);
          await syncDerivedCharts(project, table);
          _lastAutosaveTableSnapshot = snapshot;
          _appHistory.push(_captureWorkspaceState(), { action: 'table-edit' });
          saved = true;
        }
      }
      if (saved) appStore.set({ isDirty: false, lastSaved: Date.now() });
    } catch (error) {
      reportError(error, 'autosave', {});
    }
  }, 5000);
}

function _saveIndicator(text) {
  const el = $('#ws-save-indicator');
  if (el) el.textContent = text;
}

async function _flushAndSaveSession() {
  try {
    const doc = appStore.get('currentDoc');
    const table = appStore.get('currentDataTable');
    const project = appStore.get('currentProject');
    if (project && doc && appStore.get('isDirty')) { await saveDoc(project.id, doc); _appHistory.push(_captureWorkspaceState(), { action: 'doc-edit' }); }
    if (project && table && appStore.get('isDirty')) { await saveData(project.id, table); await syncDerivedCharts(project, table); _appHistory.push(_captureWorkspaceState(), { action: 'table-edit' }); }
    if (project) {
      const workflowData = workflowUI ? workflowUI.getWorkflowSnapshot() : null;
      await saveWorkspaceSession({
        documents: appStore.get('documents'),
        dataTables: appStore.get('dataTables'),
        captures: appStore.get('captures'),
        workflowDefinition: workflowData,
      });
    }
  } catch (error) {
    reportError(error, 'session-save', {});
  }
}

async function initApp() {
  try { localStorage.getItem('toolisto-theme') || localStorage.setItem('toolisto-theme', 'light'); } catch(e) {}
  try {
    const savedTheme = localStorage.getItem('toolisto-theme') || 'light';
    document.documentElement.classList.remove('theme-auto', 'theme-light', 'theme-dark');
    document.documentElement.classList.add(savedTheme === 'dark' ? 'theme-dark' : savedTheme === 'light' ? 'theme-light' : 'theme-auto');
  } catch(e) {}
  try {
    const savedDensity = localStorage.getItem('toolisto-density') || 'equilibrada';
    document.documentElement.classList.add('density-' + savedDensity);
    appStore.set({ density: savedDensity });
  } catch(e) {}
  try {
    if (localStorage.getItem('toolisto-sidebar-collapsed') === 'true') {
      appStore.set({ sidebarCollapsed: true });
      $('#ws-sidebar').classList.add('collapsed');
    }
  } catch(e) {}
  var toolsCountEl = document.getElementById('ws-sidebar-tools-count');
  if (toolsCountEl) toolsCountEl.textContent = TOOLS_DATA.length + ' Herramientas';

  $$('.sidebar-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });
  $('#ws-collapse-toggle').addEventListener('click', toggleSidebar);
  $('#ws-theme-toggle').addEventListener('click', toggleTheme);
  $('#ws-density-toggle').addEventListener('click', toggleDensity);
  $('#ws-menu-toggle').addEventListener('click', () => {
    const menu = $('#ws-menu-toggle');
    const open = $('#ws-sidebar').classList.toggle('mobile-open');
    menu.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateHistory(-1);
      return;
    }
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      navigateHistory(1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrentWorkspaceItem();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      refreshCurrentView();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      appStore.set({ paletteOpen: true });
    }
    if (e.key === 'Escape') {
      appStore.set({ paletteOpen: false });
      closeModal();
      hideContextMenu();
      $('#ws-sidebar').classList.remove('mobile-open');
      $('#ws-menu-toggle')?.setAttribute('aria-expanded', 'false');
      const focusEditor = document.querySelector('.ws-doc-editor.ws-doc-focus-mode');
      if (focusEditor) { focusEditor.classList.remove('ws-doc-focus-mode'); }
    }
  });

  appStore.subscribe('currentView', (view) => {
    recordNavigation(view, appStore.get('currentProject'));
    setActiveSidebar(view);
    const project = appStore.get('currentProject');
    updateTopbar(view, project);
    renderView(view);
  });

  appStore.subscribe('currentProject', (project) => {
    const view = appStore.get('currentView');
    updateTopbar(view, project);
  });

  appStore.subscribe('paletteOpen', (open) => {
    const root = $('#ws-palette-root');
    if (!root) return;
    root.replaceChildren();
    if (open) renderPalette(root);
  });

  setToastHandler((msg, level, duration) => { toast(msg, level || 'info', duration); });
  setupGlobalErrorHandling();

  _operationRegistry = createOperationRegistry();
  const opsRegistered = registerWorkflowOperations(_operationRegistry);
  if (opsRegistered > 0) console.log('[workflow] ' + opsRegistered + ' operations registered');

  _appHistory = createHistoryManager({
    maxEntries: 50,
    cloneState: (s) => JSON.parse(JSON.stringify(s)),
    onChange: _historyChanged,
  });

  _appHistory.push(_captureWorkspaceState(), { action: 'init' });
  appStore.set({ undoStackSize: 0, redoStackSize: 0 });
  appStore.subscribe('undoStackSize', (val) => {
    const btn = $('#ws-undo-btn');
    if (btn) btn.disabled = !val;
  });
  appStore.subscribe('redoStackSize', (val) => {
    const btn = $('#ws-redo-btn');
    if (btn) btn.disabled = !val;
  });
  appStore.subscribe('isDirty', (val) => {
    _saveIndicator(val ? 'LOCAL / SIN GUARDAR' : 'LOCAL / LISTO');
  });

  function _applyState(snapshot) {
    if (!snapshot) return;
    appStore.set({
      currentDoc: snapshot.currentDoc || null,
      currentDataTable: snapshot.currentDataTable || null,
      documents: snapshot.documents || [],
      dataTables: snapshot.dataTables || [],
      captures: snapshot.captures || [],
      designConfig: snapshot.designConfig || null,
      flowNodes: snapshot.flowNodes || [],
      flowEdges: snapshot.flowEdges || [],
    });
    _saveIndicator('LOCAL / LISTO');
    renderView(snapshot.currentView || 'projects');
  }

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName || '';
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement?.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (isInput) return;
      e.preventDefault();
      const restored = _appHistory.undo(_captureWorkspaceState());
      if (restored) { _applyState(restored); toast('Deshecho', 'success'); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      if (isInput) return;
      e.preventDefault();
      const restored = _appHistory.redo(_captureWorkspaceState());
      if (restored) { _applyState(restored); toast('Rehecho', 'success'); }
      return;
    }
  });

  _setupAutosave();

  window.addEventListener('beforeunload', (e) => {
    if (appStore.get('isDirty')) {
      _flushAndSaveSession();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _flushAndSaveSession();
    }
  });

  const projects = await _loadProjects();
  appStore.set({ projects });

  const recoverySessionKey = 'toolisto-workspace-recovery-checked';
  let shouldOfferRecovery = true;
  try {
    shouldOfferRecovery = !sessionStorage.getItem(recoverySessionKey);
    sessionStorage.setItem(recoverySessionKey, '1');
  } catch (error) {}
  const hasSession = await hasRecoverableSession();
  if (hasSession && shouldOfferRecovery) {
    const info = await getWorkspaceSessionInfo();
    if (info && info.currentView && info.currentView !== 'projects') {
      showModal({
        title: 'Recuperar sesion anterior',
        body: [
          h('p', null, 'Se encontro una sesion de trabajo anterior.'),
          info.updatedAt ? h('p', { style: 'font-size:12px;color:var(--ws-text-secondary)' }, 'Ultimo guardado: ' + new Date(info.updatedAt).toLocaleString()) : null,
          h('p', { style: 'font-size:12px;color:var(--ws-text-secondary)' }, (info.docCount || 0) + ' documentos, ' + (info.tableCount || 0) + ' tablas'),
        ],
        confirmText: 'Recuperar sesion',
        confirmClass: 'ws-btn-primary',
        cancelText: 'Descartar',
        onConfirm: async () => {
          const session = await loadWorkspaceSession();
          if (session && session.workspace) {
            const w = session.workspace;
            if (w.documents && w.documents.length > 0) appStore.set({ documents: w.documents });
            if (w.dataTables && w.dataTables.length > 0) appStore.set({ dataTables: w.dataTables });
            if (w.captures && w.captures.length > 0) appStore.set({ captures: w.captures });
            if (w.currentProjectId && projects.some(p => p.id === w.currentProjectId)) {
              await selectProject(projects.find(p => p.id === w.currentProjectId));
            }
            if (w.currentView && w.currentView !== 'projects') {
              const targetView = w.currentView || 'projects';
              navigateTo(targetView);
            }
            if (w.currentDocId && w.documents) {
              const found = w.documents.find(d => d.id === w.currentDocId);
              if (found) appStore.set({ currentDoc: found });
            }
            if (w.currentDataTableId && w.dataTables) {
              const dtFound = w.dataTables.find(d => d.id === w.currentDataTableId);
              if (dtFound) appStore.set({ currentDataTable: dtFound });
            }
            if (w.workflowDefinition && workflowUI) {
              workflowUI.setWorkflowFromSnapshot(w.workflowDefinition);
            }
            toast('Sesion recuperada', 'success');
          }
        },
        onCancel: async () => {
          await deleteWorkspaceSession(info?.sessionId);
        },
        onClose: () => {},
      });
    }
  }

  appStore.set({ workspaceConfig: getWorkspaceConfig() });
  recordNavigation('projects', appStore.get('currentProject'));
  setActiveSidebar('projects');
  updateTopbar('projects', appStore.get('currentProject'));
  renderView('projects');
}

function renderView(view) {
  const main = $('#ws-main-content');
  main.replaceChildren();
  const project = appStore.get('currentProject');
  switch (view) {
    case 'projects': renderProjectsView(main); break;
    case 'intake': renderIntakeView(main); break;
    case 'dashboard': if (project) renderDashboardView(main, project); break;
    case 'capture': if (project) renderCaptureView(main, project); break;
    case 'scanner': if (project) renderScannerView(main, project); break;
    case 'documents': if (project) renderDocumentsView(main, project); break;
    case 'data': if (project) renderDataView(main, project); break;
    case 'model': if (project) renderModelView(main, project); break;
    case 'data-table': renderDataTableView(main); break;
    case 'query': if (project) renderQueryStudioView(main, project); break;
    case 'dashboards': if (project) renderDashboardsView(main, project); break;
    case 'flow': if (project) renderFlowView(main, project); break;
    case 'flujos': renderWorkflowView(main); break;
    case 'tools': renderToolsView(main); break;
    case 'doc-editor': renderDocEditor(main); break;
    case 'design': renderDesignEditor(main); break;
    default: renderProjectsView(main);
  }
}

// Part 3: Projects View, Dashboard, Intake
async function createNewProject() {
  showModal({
    title: 'Nuevo Proyecto',
    body: [
      h('div', { className: 'ws-form-group' },
        h('label', null, 'Nombre'),
        h('input', { id: 'modal-project-name', type: 'text', className: 'ws-input', placeholder: 'Mi proyecto' })
      ),
      h('div', { className: 'ws-form-group' },
        h('label', null, 'Descripción (opcional)'),
        h('input', { id: 'modal-project-desc', type: 'text', className: 'ws-input', placeholder: 'Descripción del proyecto' })
      ),
    ],
    confirmText: 'Crear',
    onConfirm: async () => {
      const name = document.getElementById('modal-project-name')?.value;
      if (!name || !name.trim()) return;
      const project = await createProject(name.trim());
      appStore.set({ currentProject: project, currentView: 'dashboard' });
      toast('Proyecto creado', 'success');
    }
  });
}

async function createTemplateProject(name, description) {
  const project = await createProject(name, description);
  if (name === 'Informe') {
    await saveDoc(project.id, {
      id: generateId(),
      projectId: project.id,
      title: 'Informe sin título',
      blocks: [
        { id: generateId(), type: 'heading1', content: 'Informe sin título' },
        { id: generateId(), type: 'paragraph', content: 'Escribe aquí el contexto y el objetivo.' },
        { id: generateId(), type: 'heading2', content: 'Hallazgos' },
        { id: generateId(), type: 'bullet-list', content: 'Añade el primer hallazgo.' },
        { id: generateId(), type: 'heading2', content: 'Próximos pasos' },
        { id: generateId(), type: 'numbered-list', content: 'Define el primer paso.' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } else if (name === 'Escaneo organizado') {
    await saveDoc(project.id, {
      id: generateId(),
      projectId: project.id,
      title: 'Checklist de escaneo',
      blocks: [
        { id: generateId(), type: 'heading1', content: 'Checklist de escaneo' },
        { id: generateId(), type: 'paragraph', content: 'Usa Captura Universal para añadir páginas y conserva aquí las notas del documento.' },
        { id: generateId(), type: 'bullet-list', content: 'Revisar orientación y legibilidad.' },
        { id: generateId(), type: 'bullet-list', content: 'Ordenar las páginas antes de exportar.' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } else if (name === 'Control de gastos') {
    await saveData(project.id, {
      id: generateId(),
      projectId: project.id,
      name: 'Control de gastos',
      headers: ['Fecha', 'Descripción', 'Categoría', 'Importe'],
      rows: [['', '', '', ''], ['', '', '', ''], ['', '', '', '']],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } else if (name === 'Dashboard') {
    await saveData(project.id, {
      id: generateId(),
      projectId: project.id,
      name: 'Indicadores',
      headers: ['Indicador', 'Valor', 'Meta', 'Estado'],
      rows: [['Proyectos activos', '', '', ''], ['Tareas abiertas', '', '', ''], ['Cumplimiento', '', '', '']],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  const readyProject = await refreshProjectCounts(project.id) || project;
  appStore.set({ currentProject: readyProject, currentView: 'dashboard' });
  toast(`Proyecto «${name}» creado`, 'success');
}

function deleteProjectConfirm(project) {
  showConfirm({
    title: 'Eliminar proyecto',
    message: 'Se eliminará «' + project.name + '» y todo su contenido local. Esta acción no se puede deshacer.',
    confirmText: 'Eliminar proyecto',
    onConfirm: async () => {
      await deleteProject(project.id);
      appStore.set({ currentProject: null, currentView: 'projects' });
      toast('Proyecto eliminado', 'success');
    },
  });
}

async function exportProjectData() {
  const project = appStore.get('currentProject');
  if (!project) return;
  try {
    const start = Date.now();
    const bundle = await exportProject(project.id);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: project.name.replace(/[\\/:*?"<>|]/g, '-') + '.toolisto' });
    a.click();
    URL.revokeObjectURL(url);
    await registerExecution(project.id, 'project-export', 'Exportar proyecto', {
      parameters: { docCount: (bundle.documents || []).length, tableCount: (bundle.dataTables || []).length },
      resultType: 'export-artifact',
      startedAt: start,
      status: 'completed',
    });
    toast('Proyecto exportado', 'success');
  } catch (e) {
    toast('Error al exportar', 'error');
  }
}

async function importProjectFile() {
  const input = h('input', { type: 'file', accept: '.toolisto,.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const validation = validateWorkspaceFile(file, ['.toolisto', '.json']);
    if (!validation.ok) { toast(validation.message, 'warning'); return; }
    try {
      const text = await file.text();
      let bundle;
      try {
        bundle = JSON.parse(text);
      } catch (parseErr) {
        toast('Archivo corrupto o formato invalido: ' + parseErr.message, 'error');
        return;
      }
      if (!bundle || !bundle.project) {
        toast('El archivo no contiene un proyecto valido', 'warning');
        return;
      }
      const start = Date.now();
      const project = await importProject(bundle);
      await registerExecution(project.id, 'project-import', 'Importar proyecto', {
        parameters: { fileName: file.name, docCount: (bundle.documents || []).length, tableCount: (bundle.dataTables || []).length },
        resultType: 'project',
        resultAssetId: project.id,
        startedAt: start,
        status: 'completed',
      });
      appStore.set({ currentProject: project, currentView: 'dashboard' });
      toast('Proyecto importado', 'success');
    } catch (e) {
      toast('Error al importar: ' + e.message, 'error');
    }
  });
  input.click();
}

function renderProjectsView(container) {
  const projects = appStore.get('projects');
  const el = h('div', { className: 'ws-start ws-home-studio' });
  const hero = h('section', { className: 'ws-studio-hero' },
    h('div', { className: 'ws-studio-copy' },
      h('div', { className: 'ws-studio-overline' },
        h('span', { className: 'ws-studio-mark' }, svgIcon('sparkle', 13)),
        h('span', null, 'TOOLISTO / WORKSPACE')
      ),
      h('h1', null, 'Haz espacio para ', h('span', { className: 'ws-stroke-word' }, 'lo importante.')),
      h('p', null, 'Una mesa de trabajo para convertir archivos, ideas y datos en algo que puedas usar.'),
      h('div', { className: 'ws-quick-actions ws-studio-actions' },
        h('button', { className: 'ws-btn ws-btn-primary ws-studio-btn', onClick: () => navigateTo('intake') }, svgIcon('camera', 16), ' Empezar captura'),
        h('button', { className: 'ws-btn ws-btn-secondary ws-studio-btn', onClick: createNewProject }, svgIcon('plus', 16), ' Nuevo proyecto'),
        h('button', { className: 'ws-btn ws-btn-ghost ws-studio-btn', onClick: () => navigateTo('tools') }, svgIcon('wrench', 16), ' Explorar herramientas')
      ),
      h('button', { className: 'ws-studio-command', onClick: () => appStore.set({ paletteOpen: true }) },
        svgIcon('search', 15), h('span', null, 'Busca una acción o herramienta'), h('kbd', null, 'Ctrl K')
      ),
      h('div', { className: 'ws-studio-meta' },
        h('span', null, 'Espacio personal'),
        h('span', null, 'Ideas → herramientas → resultados')
      )
    ),
    h('div', { className: 'ws-hero-art' },
      createStudioArtwork(),
      h('div', { className: 'ws-art-index' }, 'INDEX / 01'),
      h('div', { className: 'ws-art-caption' }, 'Una superficie para empezar')
    )
  );
  el.appendChild(hero);
  const categories = new Set(TOOLS_DATA.map(tool => tool.category)).size;
  el.appendChild(h('div', { className: 'ws-home-stats ws-studio-index' },
    h('div', null, h('strong', null, String(TOOLS_DATA.length)), h('span', null, ' herramientas')),
    h('div', null, h('strong', null, String(categories)), h('span', null, ' categorías')),
    h('div', null, h('strong', null, String(projects.length)), h('span', null, ' espacios')),
    h('div', null, h('strong', null, 'LOCAL'), h('span', null, ' listo ahora'))
  ));
  const launchCards = [
    { number: '01', icon: 'camera', title: 'Capturar', desc: 'Trae una imagen, una pantalla o una idea al espacio.', onClick: () => navigateTo('intake') },
    { number: '02', icon: 'doc', title: 'Escribir', desc: 'Dale forma a tus notas con documentos por bloques.', onClick: () => navigateTo('documents') },
    { number: '03', icon: 'table', title: 'Ordenar', desc: 'Convierte datos sueltos en una tabla que responde.', onClick: () => navigateTo('data') },
    { number: '04', icon: 'flow', title: 'Automatizar', desc: 'Encadena pasos repetitivos en un flujo reutilizable.', onClick: () => navigateTo('flujos') },
    { number: '05', icon: 'chart', title: 'Medir', desc: 'Convierte tus tablas en una vista que ayuda a decidir.', onClick: () => navigateTo('dashboards') },
  ];
  el.appendChild(h('section', { className: 'ws-studio-launch' },
    h('div', { className: 'ws-section-heading ws-studio-section-heading' },
      h('div', null,
        h('span', { className: 'ws-studio-section-kicker' }, '01 / EMPIEZA AQUÍ'),
        h('h2', null, 'Elige un punto de partida'),
         h('p', null, 'Cinco caminos para poner tus ideas en movimiento.')
      )
    ),
    h('div', { className: 'ws-studio-launch-grid' },
      ...launchCards.map(card => h('button', { className: 'ws-studio-launch-card', onClick: card.onClick },
        h('span', { className: 'ws-launch-number' }, card.number),
        h('span', { className: 'ws-launch-icon' }, svgIcon(card.icon, 22)),
        h('span', { className: 'ws-launch-copy' }, h('strong', null, card.title), h('small', null, card.desc)),
        h('span', { className: 'ws-launch-arrow', 'aria-hidden': 'true' }, '↗')
      ))
    )
  ));
  const templates = h('section', { className: 'ws-template-section' },
    h('div', { className: 'ws-section-heading ws-studio-section-heading' },
      h('div', null,
        h('span', { className: 'ws-studio-section-kicker' }, '02 / RITUALES ÚTILES'),
        h('h2', null, 'Plantillas de trabajo'),
        h('p', null, 'Empieza con una estructura que ya sabe hacia dónde va.')
      )
    ),
    h('div', { className: 'ws-template-grid' },
      ...[
        ['Informe', 'Documento con portada, hallazgos y próximos pasos.', 'doc'],
        ['Escaneo organizado', 'Captura, ordena y prepara páginas para exportar.', 'camera'],
        ['Control de gastos', 'Tabla inicial para importar y revisar movimientos.', 'table'],
        ['Dashboard', 'Proyecto preparado para convertir datos en indicadores.', 'chart']
      ].map(([name, desc, icon]) => h('button', {
        className: 'ws-template-card',
        onClick: () => createTemplateProject(name, desc)
      }, h('span', { className: 'ws-template-icon' }, svgIcon(icon, 18)), h('span', { className: 'ws-template-copy' }, h('strong', null, name), h('small', null, desc))))
    )
  );
  templates.classList.add('ws-studio-templates');
  el.appendChild(templates);
  const dragZone = h('div', {
    className: 'ws-drag-zone ws-studio-dropzone',
    onClick: () => importProjectFile(),
    onDragover: (e) => { e.preventDefault(); dragZone.classList.add('drag-over'); },
    onDragleave: () => dragZone.classList.remove('drag-over'),
    onDrop: async (e) => {
      e.preventDefault();
      dragZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      const validation = validateWorkspaceFile(file, ['.toolisto', '.json']);
      if (!validation.ok) { toast(validation.message, 'warning'); return; }
      if (file) {
        try {
          const text = await file.text();
          const bundle = JSON.parse(text);
          const project = await importProject(bundle);
          appStore.set({ currentProject: project, currentView: 'dashboard' });
          toast('Proyecto importado', 'success');
        } catch (err) {
          toast('Error al importar: ' + err.message, 'error');
        }
      }
    }
  }, svgIcon('upload'), ' Suelta un proyecto .toolisto aquí o haz clic para abrirlo');
  el.appendChild(dragZone);
  if (projects.length > 0) {
    const section = h('section', { className: 'ws-recent-section ws-studio-recent' });
    section.appendChild(h('div', { className: 'ws-recent-heading' },
      h('span', { className: 'ws-studio-section-kicker' }, '03 / CONTINÚA'),
      h('h2', null, 'Tus espacios recientes')
    ));
    const grid = h('div', { className: 'ws-card-grid' });
    projects.forEach(p => {
      const card = h('div', { className: 'ws-card', style: 'cursor:pointer', onClick: () => selectProjectAndNavigate(p) },
        h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:8px' },
          h('div', { className: 'card-icon studio-card-icon' }, svgIcon('folder', 20)),
          h('div', null,
            h('div', { style: 'font-weight:600;font-size:14px' }, p.name),
            h('div', { style: 'font-size:12px;color:var(--ws-text-secondary)' }, formatTimeAgo(p.updatedAt))
          )
        ),
        h('div', { style: 'font-size:12px;color:var(--ws-text-tertiary)' },
          (p.captureCount || 0) + ' capturas, ' + (p.docCount || 0) + ' documentos, ' + (p.dataCount || 0) + ' tablas'
        ),
        h('div', { style: 'display:flex;gap:6px;margin-top:10px' },
          h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: (e) => { e.stopPropagation(); deleteProjectConfirm(p); } }, svgIcon('trash'), ' Eliminar')
        )
      );
      grid.appendChild(card);
    });
    section.appendChild(grid);
    el.appendChild(section);
  } else {
    el.appendChild(h('div', { className: 'ws-ready-card ws-studio-ready' },
      h('div', { className: 'ws-ready-icon' }, svgIcon('folder', 22)),
      h('div', { className: 'ws-ready-copy' },
        h('strong', null, 'Tu mesa está lista'),
        h('span', null, 'Crea un proyecto para reunir documentos, capturas y datos en un solo lugar.')
      ),
      h('button', { id: 'ws-welcome-new', className: 'ws-btn ws-btn-primary', onClick: createNewProject }, svgIcon('plus'), ' Nuevo Proyecto')
    ));
  }
  container.appendChild(el);
}

async function selectProjectAndNavigate(project) {
  const p = await selectProject(project.id);
  if (p) appStore.set({ currentProject: p, currentView: 'dashboard' });
}

function renderDashboardView(container, project) {
  const captures = project.captureCount || 0;
  const documents = project.docCount || 0;
  const tables = project.dataCount || 0;
  const totalAssets = captures + documents + tables;
  const el = h('div', { className: 'ws-dashboard-home', style: 'animation:fadeIn 0.3s ease' });
  const hero = h('section', { className: 'ws-project-hero' },
    h('div', { className: 'ws-project-hero-copy' },
      h('span', { className: 'ws-dashboard-kicker' }, 'PROYECTO / ESPACIO LOCAL'),
      h('h1', null, project.name),
      h('p', null, project.description || 'Un centro de trabajo para capturar, ordenar y convertir tus archivos en resultados.'),
      h('div', { className: 'ws-project-actions' },
        h('button', { className: 'ws-btn ws-btn-primary', onClick: () => navigateTo('intake') }, svgIcon('camera', 16), ' Capturar algo'),
        h('button', { className: 'ws-btn ws-btn-secondary', onClick: () => navigateTo('documents') }, svgIcon('doc', 16), ' Abrir documentos'),
        h('button', { className: 'ws-btn ws-btn-ghost', onClick: () => appStore.set({ paletteOpen: true }) }, svgIcon('search', 16), ' Buscar')
      )
    ),
    h('div', { className: 'ws-project-context' },
      h('div', { className: 'ws-context-orbit' }, svgIcon('sparkle', 23)),
      h('span', { className: 'ws-context-label' }, 'Todo listo'),
      h('strong', null, totalAssets ? totalAssets + ' elementos en movimiento' : 'Tu espacio está listo'),
      h('small', null, 'Procesamiento local · sin subir tus archivos')
    )
  );
  el.appendChild(hero);
  const metrics = h('section', { className: 'ws-dashboard-metrics', 'aria-label': 'Resumen del proyecto' });
  [
    ['capturas', captures, 'Capturas', 'camera', 'blue', 'intake'],
    ['documentos', documents, 'Documentos', 'doc', 'green', 'documents'],
    ['tablas', tables, 'Tablas de datos', 'table', 'violet', 'data'],
    ['herramientas', TOOLS_DATA.length, 'Herramientas', 'wrench', 'orange', 'tools']
  ].forEach(([, value, label, icon, color, view]) => {
    metrics.appendChild(h('button', { className: 'ws-metric-card', onClick: () => navigateTo(view) },
      h('span', { className: 'ws-metric-icon ' + color }, svgIcon(icon, 18)),
      h('span', { className: 'ws-metric-copy' }, h('strong', null, String(value)), h('small', null, label)),
      h('span', { className: 'ws-metric-arrow', 'aria-hidden': 'true' }, '↗')
    ));
  });
  el.appendChild(metrics);

  const lower = h('div', { className: 'ws-dashboard-lower' });
  const next = h('section', { className: 'ws-dashboard-panel ws-next-panel' },
    h('div', { className: 'ws-dashboard-panel-heading' }, h('div', null, h('span', { className: 'ws-dashboard-kicker' }, 'SIGUIENTE MOVIMIENTO'), h('h2', null, 'Avanza sin fricción')), h('span', { className: 'ws-panel-status' }, 'LOCAL')),
    h('p', { className: 'ws-panel-intro' }, totalAssets ? 'Elige el paso que mejor encaja con lo que ya tienes en este espacio.' : 'Empieza con una captura y deja que el proyecto se organice alrededor de tu trabajo.'),
    h('div', { className: 'ws-next-actions' },
      h('button', { onClick: () => navigateTo('intake') }, svgIcon('camera', 16), h('span', null, 'Traer un archivo', h('small', null, 'Captura, pega o arrastra'))),
      h('button', { onClick: () => navigateTo('data') }, svgIcon('table', 16), h('span', null, 'Ordenar datos', h('small', null, 'Crea una tabla útil'))),
      h('button', { onClick: () => navigateTo('flow') }, svgIcon('flow', 16), h('span', null, 'Automatizar', h('small', null, 'Repite lo que funciona')))
    )
  );
  const signalList = h('div', { className: 'ws-signal-list' },
    h('button', { onClick: () => navigateTo('capture') },
      h('span', { className: 'ws-signal-index' }, '01'),
      h('span', null, h('strong', null, captures ? captures + ' capturas preparadas' : 'Sin capturas todavía'), h('small', null, 'La entrada más rápida al proyecto'))
    ),
    h('button', { onClick: () => navigateTo('documents') },
      h('span', { className: 'ws-signal-index' }, '02'),
      h('span', null, h('strong', null, documents ? documents + ' documentos en tu espacio' : 'Tu primera página está esperando'), h('small', null, 'Escribe, resume y exporta'))
    ),
    h('button', { onClick: () => navigateTo('data') },
      h('span', { className: 'ws-signal-index' }, '03'),
      h('span', null, h('strong', null, tables ? tables + ' tablas conectables' : 'Conecta tus datos cuando quieras'), h('small', null, 'Query, modelos y dashboards'))
    )
  );
  const signal = h('section', { className: 'ws-dashboard-panel ws-signal-panel' },
    h('div', { className: 'ws-dashboard-panel-heading' },
      h('div', null, h('span', { className: 'ws-dashboard-kicker' }, 'SEÑAL DEL ESPACIO'), h('h2', null, 'Tu mapa de trabajo')),
      h('span', { className: 'ws-signal-dot' }, '● Activo')
    ),
    signalList
  );
  lower.append(next, signal);
  el.appendChild(lower);

  const bento = h('div', { className: 'ws-bento' });
  const items = [
    { icon: 'camera', color: 'blue', title: 'Capturas', desc: captures + ' capturas', span: false, onClick: () => navigateTo('capture') },
    { icon: 'doc', color: 'green', title: 'Documentos', desc: documents + ' documentos', span: false, onClick: () => navigateTo('documents') },
    { icon: 'table', color: 'violet', title: 'Datos', desc: tables + ' tablas', span: false, onClick: () => navigateTo('data') },
    { icon: 'chart', color: 'orange', title: 'Dashboards', desc: 'Visualiza metricas', span: false, onClick: () => navigateTo('dashboards') },
    { icon: 'flow', color: 'blue', title: 'Toolisto Flow', desc: 'Automatiza procesos', span: false, onClick: () => navigateTo('flow') },
    { icon: 'tool', color: 'blue', title: 'Flujos por lotes', desc: 'Operaciones encadenadas', span: false, onClick: () => navigateTo('flujos') },
    { icon: 'wrench', color: 'green', title: TOOLS_DATA.length + ' Herramientas', desc: 'Herramientas de productividad', span: false, onClick: () => navigateTo('tools') },
  ];
  items.forEach(item => {
    const cls = 'ws-bento-card' + (item.span ? ' span-2' : '');
    bento.appendChild(h('button', { className: cls, onClick: item.onClick },
      h('div', { className: 'card-icon ' + item.color }, svgIcon(item.icon, 22)),
      h('div', { className: 'card-title' }, item.title),
      h('div', { className: 'card-desc' }, item.desc)
    ));
  });
  el.appendChild(h('section', { className: 'ws-dashboard-tools' },
    h('div', { className: 'ws-dashboard-panel-heading' }, h('div', null, h('span', { className: 'ws-dashboard-kicker' }, 'SUPERFICIES TOOLISTO'), h('h2', null, 'Todo lo que puedes hacer aquí')), h('button', { className: 'ws-text-link', onClick: () => navigateTo('tools') }, 'Ver las ' + TOOLS_DATA.length + ' herramientas ↗')),
    bento
  ));
  container.appendChild(el);
}

function renderIntakeView(container) {
  const project = appStore.get('currentProject');
  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease' });
  el.appendChild(h('div', { className: 'hero' },
    h('h1', null, 'Captura Universal'),
    h('p', null, 'Captura desde camara, pantalla o portapapeles')
  ));
  if (!project) {
    el.appendChild(h('div', { className: 'ws-intake-gate' },
      h('div', { className: 'ws-intake-gate-icon' }, svgIcon('folder', 20)),
      h('div', { className: 'ws-intake-gate-copy' },
        h('strong', null, 'Elige dónde guardar tu captura'),
        h('span', null, 'Crea o abre un proyecto para que tus imágenes permanezcan organizadas en este navegador.')
      ),
      h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: createNewProject }, svgIcon('plus', 15), ' Crear proyecto'),
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => navigateTo('projects') }, ' Abrir proyectos')
    ));
  }
  const modes = [
    { icon: 'camera', color: 'blue', title: 'Camara', desc: 'Captura desde la camara del dispositivo', onClick: () => startCapture('camera') },
    { icon: 'image', color: 'green', title: 'Pantalla', desc: 'Captura una ventana o area de pantalla', onClick: () => startCapture('screen') },
    { icon: 'doc', color: 'violet', title: 'Portapapeles', desc: 'Pega una imagen del portapapeles', onClick: () => startCapture('clipboard') },
  ];
  const bento = h('div', { className: 'ws-bento' });
  modes.forEach(m => {
    bento.appendChild(h('div', { className: 'ws-bento-card', onClick: m.onClick },
      h('div', { className: 'card-icon ' + m.color }, svgIcon(m.icon, 22)),
      h('div', { className: 'card-title' }, m.title),
      h('div', { className: 'card-desc' }, m.desc)
    ));
  });
  el.appendChild(bento);
  container.appendChild(el);
}

async function saveImageCapture(project, dataUrl, type, name) {
  const start = Date.now();
  const capture = {
    id: generateId(),
    projectId: project.id,
    type,
    dataUrl,
    timestamp: Date.now(),
    name,
  };
  await saveCapture(project.id, capture);
  const asset = createImageAsset(name || 'Captura', project.id, null);
  asset.originalDataUrl = dataUrl;
  asset.dataUrl = dataUrl;
  asset.type = 'image-asset';
  asset.metadata = { captureType: type, captureId: capture.id };
  addRelation(capture, asset.id, 'asset');
  addRelation(asset, capture.id, 'source-capture');
  await saveAsset(project.id, asset);
  pushHistory(asset, 'imported', `Imagen importada desde ${type}`);
  await saveAsset(project.id, asset);
  await registerExecution(project.id, 'image-import', 'Importar imagen', {
    inputAssetIds: [asset.id],
    parameters: { type, name },
    resultType: 'image-asset',
    resultAssetId: asset.id,
    startedAt: start,
    status: 'completed',
  });
  await refreshProjectCounts(project.id);
  appStore.set({ captures: [capture, ...appStore.get('captures')], lastSaved: Date.now() });
  toast('Captura guardada en el proyecto', 'success');
  return { capture, asset };
}

async function captureFromFile(project, mode) {
  const input = h('input', { type: 'file', accept: 'image/*' });
  if (mode === 'camera') input.setAttribute('capture', 'environment');
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const validation = validateWorkspaceFile(file, ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
    if (!validation.ok) { toast(validation.message, 'warning'); return; }
    await launchScanner(await readFileAsDataUrl(file), project);
  });
  input.click();
}

async function captureScreen(project) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast('La captura de pantalla no está disponible en este navegador', 'warning');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 180));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    await launchScanner(canvas.toDataURL('image/png'), project);
  } catch (error) {
    toast('La captura de pantalla fue cancelada', 'info');
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
}

async function startCapture(mode) {
  const project = appStore.get('currentProject');
  if (!project) {
    toast('Selecciona un proyecto primero', 'warning');
    navigateTo('projects');
    return;
  }
  if (mode === 'camera') {
    await captureFromFile(project, 'camera');
  } else if (mode === 'screen') {
    await captureScreen(project);
  } else if (mode === 'clipboard') {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const reader = new FileReader();
            reader.onload = async () => launchScanner(reader.result, project);
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
      toast('No se encontro imagen en el portapapeles', 'warning');
    } catch (e) {
      toast('No se pudo acceder al portapapeles', 'error');
    }
  }
}

function launchScanner(dataUrl, project) {
  appStore.set({ scannerDataUrl: dataUrl, currentView: 'scanner' });
  renderView('scanner');
}

function renderScannerView(container, project) {
  const dataUrl = appStore.get('scannerDataUrl');
  if (!dataUrl) {
    navigateTo('capture');
    return;
  }
  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease;height:100%' });
  el.appendChild(h('div', { className: 'hero', style: 'padding:8px 16px' },
    h('h1', null, 'Escaneo de documento'),
    h('p', null, 'Ajusta las esquinas del documento para obtener una imagen corregida.')
  ));
  const scannerContainer = h('div', { style: 'flex:1;min-height:0;height:calc(100% - 80px)' });
  el.appendChild(scannerContainer);
  container.appendChild(el);

  const scanner = createScannerUI(dataUrl, project, {
    onConfirm: async (result) => {
      const start = Date.now();
      try {
        const { isIdentityPath } = await import('./core/image-processor.js');
        const identity = isIdentityPath(result.corners, result.originalWidth, result.originalHeight);
        const autoDetectionFallback = result.autoDetectionFallback === true;
        const cornersModified = result.cornersModified === true;
        const filterMode = result.filterMode || 'original';
        const rotation = result.rotation || 0;
        const geometryTransformApplied = !identity || cornersModified;
        const ocrSource = (identity && !cornersModified && filterMode === 'original' && rotation === 0) ? 'original' : 'corrected';

        const sourceAsset = createImageAsset('Imagen original', project.id, null);
        sourceAsset.originalDataUrl = result.sourceDataUrl;
        sourceAsset.dataUrl = result.sourceDataUrl;
        sourceAsset.type = 'image-asset';
        sourceAsset.metadata = { captureType: 'scanner-input' };
        pushHistory(sourceAsset, 'imported', 'Imagen original cargada en escáner');

        const scanDoc = createScanDocument('Documento escaneado', project.id);
        const scanPage = createScanPage(sourceAsset.id, 0);
        scanPage.corners = result.corners;
        scanPage.perspectiveCorrected = geometryTransformApplied;
        scanDoc.pages = [scanPage];
        scanDoc.pageCount = 1;
        scanDoc.processingState = 'completed';
        scanDoc.scannerMetadata = {
          autoDetectionFallback,
          cornersModified,
          filterMode,
          rotation,
          geometryTransformApplied,
          ocrSource,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          outputWidth: result.outputWidth,
          outputHeight: result.outputHeight,
        };
        addRelation(scanDoc, sourceAsset.id, 'source');
        addRelation(sourceAsset, scanDoc.id, 'derived-scan');
        scanDoc.sourceAssetId = sourceAsset.id;
        sourceAsset.derivedIds = [scanDoc.id];
        pushHistory(scanDoc, 'created', 'Documento escaneado con corrección de perspectiva');

        // La captura referencia el asset corregido: guardar además su dataUrl
        // duplicaría un PNG potencialmente grande en IndexedDB.
        const savedCapture = {
          id: generateId(), projectId: project.id, type: 'scan',
          timestamp: Date.now(), name: 'Documento escaneado', sourceAssetId: sourceAsset.id,
          scanDocumentId: scanDoc.id, ocrSource,
          scannerMetadata: {
          autoDetectionFallback,
          cornersModified,
          filterMode,
          rotation,
          geometryTransformApplied,
          ocrSource,
          },
        };
        const correctedAsset = createImageAsset('Documento escaneado', project.id, null);
        correctedAsset.dataUrl = result.correctedDataUrl;
        correctedAsset.type = 'image-asset';
        correctedAsset.metadata = { captureType: 'scan', captureId: savedCapture.id };
        savedCapture.correctedAssetId = correctedAsset.id;
        addRelation(savedCapture, correctedAsset.id, 'asset');
        addRelation(correctedAsset, savedCapture.id, 'source-capture');
        pushHistory(correctedAsset, 'imported', 'Imagen importada desde scan');
        scanDoc.captureId = savedCapture.id;
        scanDoc.correctedAssetId = correctedAsset.id;
        scanPage.originalAssetId = sourceAsset.id;
        scanPage.correctedAssetId = correctedAsset.id;
        scanPage.assetId = correctedAsset.id;
        addRelation(scanDoc, savedCapture.id, 'capture');
        addRelation(savedCapture, scanDoc.id, 'scan-document');
        const execution = createToolExecution('perspective-correction', 'Corrección de perspectiva', project.id);
        execution.inputAssetIds = [sourceAsset.id];
        execution.sourceAssetId = sourceAsset.id;
        execution.parameters = { corners: result.corners, autoDetectionFallback, cornersModified, filterMode, rotation, geometryTransformApplied, ocrSource };
        execution.resultType = 'scan-document';
        execution.resultAssetId = scanDoc.id;
        execution.status = 'completed';
        execution.progress = 1;
        execution.startedAt = start;
        execution.completedAt = Date.now();
        execution.duration = execution.completedAt - start;
        pushHistory(execution, 'registered', 'Operación Corrección de perspectiva registrada');
        const persisted = await persistScannerResult(project.id, { sourceAsset, scanDoc, correctedAsset, capture: savedCapture, execution });
        await refreshProjectCounts(project.id);
        const persistedCapture = persisted.capture;
        appStore.set({ captures: [persistedCapture, ...appStore.get('captures').filter(c => c.id !== persistedCapture.id)], lastSaved: Date.now() });
        appStore.set({ scannerDataUrl: null });
        scanner.destroy();
        navigateTo('capture');
        toast('ScanDocument creado y guardado', 'success');
        return { ok: true };
      } catch (e) {
        toast('Error al guardar el escaneo: ' + e.message, 'error');
        await registerExecution(project.id, 'perspective-correction', 'Corrección de perspectiva', {
          startedAt: start,
          status: 'failed',
          errors: [e.message],
        }).catch(e => reportError(e, 'register-execution', { action: 'perspective-fail-log' }));
        return { ok: false, message: 'No se pudo guardar el escaneo. Inténtalo de nuevo.' };
      }
    },
    onCancel: () => {
      appStore.set({ scannerDataUrl: null });
      scanner.destroy();
      navigateTo('capture');
    },
  });
  scannerContainer.appendChild(scanner.root);
}

// Part 4: Capture View, Documents, Doc Editor
function renderCaptureView(container, project) {
  const captures = appStore.get('captures');
  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease' });
  el.appendChild(h('div', { className: 'hero' },
    h('h1', null, 'Capturas'),
    h('p', null, 'Gestiona las capturas de ' + project.name)
  ));
  const latestCapture = captures[0];
  el.appendChild(h('section', { className: 'ws-capture-workflow', 'aria-label': 'Flujo de captura a resultado' },
    h('div', { className: 'ws-capture-workflow-heading' },
      h('div', null, h('span', { className: 'ws-dashboard-kicker' }, 'CAPTURA → RESULTADO'), h('h2', null, 'Convierte una imagen en trabajo útil')),
      h('span', { className: 'ws-capture-workflow-note' }, latestCapture ? 'Última captura lista' : 'Empieza con una captura')
    ),
    h('div', { className: 'ws-capture-workflow-steps' },
      h('button', { onClick: () => navigateTo('intake') }, h('span', { className: 'ws-capture-step-number' }, '01'), svgIcon('camera', 17), h('span', null, h('strong', null, 'Captura'), h('small', null, 'Cámara, pantalla o portapapeles'))),
      h('button', { onClick: () => latestCapture ? extractTextFromScan(project, latestCapture) : navigateTo('intake') }, h('span', { className: 'ws-capture-step-number' }, '02'), svgIcon('ocr', 17), h('span', null, h('strong', null, 'Extrae texto'), h('small', null, latestCapture ? 'OCR en español con revisión' : 'Guarda una captura primero'))),
      h('button', { onClick: () => navigateTo('documents') }, h('span', { className: 'ws-capture-step-number' }, '03'), svgIcon('doc', 17), h('span', null, h('strong', null, 'Edita y entrega'), h('small', null, 'Tabla, documento o informe')))
    )
  ));
  if (captures.length === 0) {
    el.appendChild(h('div', { className: 'ws-empty' },
      h('div', { className: 'ws-empty-icon' }, svgIcon('camera', 28)),
      h('div', { className: 'ws-empty-title' }, 'Sin capturas'),
      h('div', { className: 'ws-empty-text' }, 'Usa la Captura Universal para agregar capturas a este proyecto.'),
      h('button', { className: 'ws-btn ws-btn-primary', onClick: () => navigateTo('intake') }, svgIcon('camera'), ' Ir a Captura')
    ));
  } else {
    const grid = h('div', { className: 'ws-card-grid' });
    captures.forEach(cap => {
      const card = h('div', { className: 'ws-card', style: 'cursor:pointer' });
      const thumbSlot = h('div', { className: 'ws-card-thumb', style: 'width:100%;height:120px;border-radius:var(--ws-radius-sm);margin-bottom:8px;background:var(--ws-surface-hover);display:flex;align-items:center;justify-content:center' });
      card.appendChild(thumbSlot);
      let loaded = false;
      const loadThumb = () => {
        if (loaded) return;
        loaded = true;
        resolveCaptureImageDataUrl(cap, loadAsset).then(imageUrl => {
          if (!imageUrl) return;
          thumbSlot.replaceChildren(h('img', { src: imageUrl, loading: 'lazy', decoding: 'async', alt: cap.name || 'Captura', style: 'width:100%;height:120px;object-fit:cover;border-radius:var(--ws-radius-sm);display:block' }));
        }).catch(error => reportError(error, 'capture-preview', { captureId: cap.id }));
      };
      if (typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((entries, observer) => {
          if (entries.some(entry => entry.isIntersecting)) {
            observer.disconnect();
            loadThumb();
          }
        }, { rootMargin: '300px 0px' });
        io.observe(card);
      } else {
        loadThumb();
      }
      card.appendChild(h('div', { style: 'font-weight:500;font-size:13px' }, cap.name || 'Captura'));
      card.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-tertiary)' }, formatTimeAgo(cap.timestamp)));
      const delBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: async (e) => {
        e.stopPropagation();
        let preview;
        try {
          preview = await previewCaptureDeletion(cap.id);
        } catch (error) {
          reportError(error, 'capture-delete-preview', { captureId: cap.id });
          toast('No se pudo calcular qué resultados se eliminarían. La captura no se borró.', 'error');
          return;
        }
        showConfirm({
          title: 'Eliminar captura',
          message: formatCaptureDeletionWarning(preview),
          confirmText: 'Eliminar captura',
          announce: true,
          onConfirm: async () => {
          await deleteCapture(cap.id);
          await refreshProjectCounts(project.id);
          const caps = captures.filter(c => c.id !== cap.id);
          appStore.set({ captures: caps });
          renderView('capture');
          toast('Captura eliminada', 'success');
          },
        });
      } }, svgIcon('trash'), ' Eliminar');
      const extractBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: async (e) => {
        e.stopPropagation();
        extractTextFromScan(project, cap);
      } }, svgIcon('doc'), ' Extraer texto');
      const flowBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: (e) => {
        e.stopPropagation();
        startWorkflowFromWorkspace({ id: 'capture-' + cap.id, name: cap.name || 'Captura', kind: 'image' });
      } }, svgIcon('flow'), ' Encadenar');
      card.appendChild(h('div', { style: 'margin-top:6px;display:flex;gap:4px;flex-wrap:wrap' }, extractBtn, flowBtn, delBtn));
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }
  container.appendChild(el);
  loadCaptures(project.id).then(caps => {
    appStore.set({ captures: caps });
    if (captures.length !== caps.length) {
      container.replaceChildren();
      renderCaptureView(container, project);
    }
  });
}

function formatCaptureDeletionWarning(preview) {
  const records = Array.isArray(preview?.records) ? preview.records : [];
  const derived = records.slice(1);
  if (derived.length === 0) return 'Se eliminará esta captura de este proyecto. Esta acción no se puede deshacer.';

  const labels = new Map([
    ['image-asset', ['imagen', 'imágenes']], ['file-asset', ['archivo', 'archivos']], ['scan-document', ['escaneo', 'escaneos']],
    ['text-document', ['documento OCR', 'documentos OCR']], ['table-document', ['tabla', 'tablas']], ['chart', ['gráfico', 'gráficos']],
    ['export-artifact', ['exportación', 'exportaciones']], ['tool-execution', ['ejecución', 'ejecuciones']],
  ]);
  const counts = new Map();
  for (const record of derived) {
    const label = labels.get(record.type) || ['resultado derivado', 'resultados derivados'];
    const key = label[0];
    counts.set(key, { label, count: (counts.get(key)?.count || 0) + 1 });
  }
  const summary = Array.from(counts.values(), ({ label, count }) => count + ' ' + label[count === 1 ? 0 : 1]).join(', ');
  return 'Se eliminarán esta captura y ' + derived.length + ' resultado' + (derived.length === 1 ? '' : 's') + ' derivado' + (derived.length === 1 ? '' : 's') + ': ' + summary + '. Esta acción no se puede deshacer.';
}

function normalizeOcrNumber(value) {
  const token = String(value ?? '').trim();
  if (parseLocaleNumber(token) !== null) return token;
  const m = token.match(/^[1lI]\-([\d.,]+)$/);
  if (m && parseLocaleNumber('-' + m[1]) !== null) return '-' + m[1];
  return token;
}

const OCR_LOW_CONFIDENCE = 85;
const REVIEW_STATUS = ['draft', 'reviewed', 'verified'];

function ocrWordConfidenceMap(words) {
  const map = new Map();
  for (const word of (words || [])) {
    const key = String(word.text ?? '').trim();
    if (!key) continue;
    const normalized = normalizeOcrNumber(key);
    const conf = Math.round(Number(word.confidence) || 0);
    if (!map.has(normalized) || conf < map.get(normalized)) map.set(normalized, conf);
  }
  return map;
}

function cellConfidence(cellValue, wordConfidence) {
  const token = normalizeOcrNumber(String(cellValue ?? '').trim());
  if (!token) return null;
  if (wordConfidence.has(token)) return wordConfidence.get(token);
  const numeric = parseLocaleNumber(token);
  if (numeric !== null) {
    for (const [candidate, conf] of wordConfidence) {
      if (parseLocaleNumber(candidate) === numeric) return conf;
    }
  }
  const tokens = token.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(t => wordConfidence.has(t))) {
    return Math.min(...tokens.map(t => wordConfidence.get(t)));
  }
  return null;
}

function buildCellConfidenceMatrix(table, doc) {
  const wordConfidence = ocrWordConfidenceMap(doc?.ocrWords || []);
  const fallback = Number(doc?.ocrConfidence || table?.ocrConfidence || 0);
  return (table.rows || []).map(row => (row || []).map(cellValue => {
    const conf = cellConfidence(cellValue, wordConfidence);
    if (conf !== null) return conf;
    const isBlank = String(cellValue ?? '').trim() === '';
    return isBlank ? null : (fallback > 0 ? fallback : null);
  }));
}

function tableReviewStats(table) {
  const matrix = table?.cellConfidence || [];
  const cells = matrix.flat().filter(value => value !== null && value !== undefined);
  if (!cells.length) return { min: null, max: null, avg: null, lowCount: 0, totalCells: 0, lowCells: [], matrix };
  const min = Math.min(...cells);
  const max = Math.max(...cells);
  const avg = Math.round(cells.reduce((sum, value) => sum + value, 0) / cells.length);
  const low = [];
  (table.rows || []).forEach((row, ri) => (row || []).forEach((_, ci) => {
    const conf = matrix?.[ri]?.[ci];
    if (conf !== null && conf !== undefined && conf < OCR_LOW_CONFIDENCE) low.push({ row: ri, col: ci, confidence: conf });
  }));
  return { min, max, avg, lowCount: low.length, totalCells: cells.length, lowCells: low, matrix };
}

function dataReviewStatus(table) {
  return REVIEW_STATUS.includes(table?.reviewStatus) ? table.reviewStatus : 'draft';
}

function requiresDataReview(table) {
  const status = dataReviewStatus(table);
  if (status === 'reviewed' || status === 'verified') return false;
  const stats = tableReviewStats(table);
  return stats.lowCount > 0;
}

function blockDerivedFromUncertain(table, actionLabel) {
  const stats = tableReviewStats(table);
  toast('La tabla tiene celdas con confianza baja. Revisala antes de crear un ' + (actionLabel || 'derivado') + '.', 'warning');
  showTableReviewModal(table, stats);
  return true;
}

async function findUncertainDesignSources(config) {
  const project = appStore.get('currentProject');
  if (!project || !config?.sections) return null;
  const sourceIds = new Set();
  (config.sections || []).forEach(section => {
    if (section.type !== 'table' && section.type !== 'chart') return;
    const sid = section.sourceId || section.data?.sourceId;
    if (sid) sourceIds.add(sid);
  });
  if (sourceIds.size === 0) return null;
  const tables = await loadData(project.id);
  for (const id of sourceIds) {
    const table = tables.find(t => t.id === id);
    if (table && requiresDataReview(table)) return { table };
  }
  return null;
}

async function validatePdfAgainstSource(config) {
  const project = appStore.get('currentProject');
  if (!project || !config?.sections) return null;
  const sourceIds = new Set();
  (config.sections || []).forEach(section => {
    const sid = section.sourceId || section.data?.sourceId;
    if (sid) sourceIds.add(sid);
  });
  if (sourceIds.size === 0) return null;
  const tables = await loadData(project.id);
  const checks = [];
  for (const id of sourceIds) {
    const table = tables.find(t => t.id === id);
    if (!table) {
      checks.push({ sourceId: id, type: 'missing-source', ok: false, detail: 'Tabla fuente no encontrada' });
      continue;
    }
    (config.sections || []).forEach(section => {
      const sid = section.sourceId || section.data?.sourceId;
      if (sid !== id) return;
      if (section.type === 'table') {
        const headersOk = JSON.stringify(section.data?.headers || []) === JSON.stringify(table.headers || []);
        const expectedRows = Math.min((table.rows || []).length, 40);
        const rowsOk = (section.data?.rows || []).length === expectedRows;
        checks.push({ sourceId: id, type: 'table', ok: headersOk && rowsOk, detail: 'headers=' + headersOk + ' rows=' + rowsOk });
      } else if (section.type === 'chart') {
        const numericIndex = (table.headers || []).findIndex((_, index) => queryColumnType(table.rows || [], index) === '123');
        const expectedSeries = (table.rows || []).slice(0, 24).map(row => reportNumberValue(row[numericIndex])).filter(v => v !== null).length;
        const seriesOk = (section.data?.series || []).length === expectedSeries;
        checks.push({ sourceId: id, type: 'chart', ok: seriesOk, detail: 'series=' + (section.data?.series || []).length + ' expected=' + expectedSeries });
      }
    });
  }
  if (checks.length === 0) return null;
  return { valid: checks.every(c => c.ok), checks };
}

function formatReviewStatus(status) {
  const labels = { draft: 'Borrador', reviewed: 'Revisada', verified: 'Verificada' };
  return labels[status] || status || 'Borrador';
}

function setTableReviewStatus(table, status) {
  if (!table || !REVIEW_STATUS.includes(status)) return false;
  table.reviewStatus = status;
  table.reviewedAt = Date.now();
  if (table.sheets?.[0]) table.sheets[0].reviewStatus = status;
  const current = appStore.get('currentDataTable');
  if (current?.id === table.id) appStore.set({ currentDataTable: table });
  appStore.set({ dataTables: (appStore.get('dataTables') || []).map(t => t.id === table.id ? table : t) });
  autoSaveTable(table);
  toast('Tabla marcada como ' + formatReviewStatus(status), 'success');
  const view = appStore.get('currentView');
  if (view === 'data' || view === 'data-table') renderView(view);
  return true;
}

function rebuildTableRow(tokens, headerCount) {
  const cells = tokens.map(normalizeOcrNumber);
  if (cells.length === headerCount) return cells;
  if (cells.length > headerCount && headerCount >= 3) {
    let numericIndex = -1;
    for (let i = 0; i < cells.length; i++) {
      if (parseLocaleNumber(cells[i]) !== null) { numericIndex = i; break; }
    }
    if (numericIndex !== -1) {
      const rebuilt = new Array(headerCount).fill('');
      rebuilt[0] = cells.slice(0, numericIndex).join(' ');
      rebuilt[1] = cells[numericIndex];
      rebuilt[headerCount - 1] = cells.slice(numericIndex + 1).join(' ');
      return rebuilt;
    }
  }
  return cells;
}

function convertDocToTable(doc) {
  const project = appStore.get('currentProject');
  if (!project || !doc) { toast('Proyecto o documento no disponible', 'warning'); return; }
  const lines = (doc.blocks || []).map(b => b.content || '').filter(Boolean);
  if (lines.length === 0) { toast('El documento no tiene texto para convertir', 'warning'); return; }
  const start = Date.now();
  const table = createTableDocument(doc.name || 'Tabla extraida', project.id);
  const sheet = table.sheets[0];
  const first = lines[0] || '';
  const separator = first.includes('\t') ? '\t' : first.includes(';') ? ';' : first.includes('|') ? '|' : first.includes(',') ? ',' : ' ';
  const parsedRows = lines.map(line => line.split(separator).map(cell => cell.trim()));
  const headerCount = parsedRows.length > 0 ? parsedRows[0].length : 1;
  const normalizedRows = parsedRows.map((row, index) => {
    if (index === 0) return row.map((cell, i) => cell || 'Columna ' + (i + 1));
    if (separator === ' ') return rebuildTableRow(row, headerCount);
    return row.map(normalizeOcrNumber);
  });
  if (normalizedRows.length > 0) {
    sheet.columns = normalizedRows[0];
    sheet.rows = normalizedRows.slice(1).length > 0 ? normalizedRows.slice(1) : [normalizedRows[0].map(() => '')];
  } else {
    sheet.columns = ['Texto'];
    sheet.rows = [lines];
  }
  table.headers = sheet.columns;
  table.rows = sheet.rows;
  table.sourceAssetId = doc.id;
  table.ocrConfidence = Number(doc.ocrConfidence || 0);
  table.cellConfidence = buildCellConfidenceMatrix(table, doc);
  table.reviewStatus = requiresDataReview(table) ? 'draft' : 'reviewed';
  table.reviewedAt = requiresDataReview(table) ? null : Date.now();
  addRelation(table, doc.id, 'source-document');
  addRelation(doc, table.id, 'derived-table');
  saveData(project.id, table).then(() => {
    registerExecution(project.id, 'text-to-table', 'Texto a tabla', {
      inputAssetIds: [doc.id],
      sourceAssetId: doc.id,
      parameters: { lineCount: lines.length, separator },
      resultType: 'table-document',
      resultAssetId: table.id,
      startedAt: start,
      status: 'completed',
    });
    refreshProjectCounts(project.id);
    appStore.set({ currentDataTable: table, currentView: 'data-table' });
    toast('Documento convertido a tabla', 'success');
  });
}

function tableChartData(table, maxSeries = 30) {
  const headers = table?.headers || [];
  const rows = table?.rows || [];
  const candidateIndexes = headers.slice(1).map((_, index) => index + 1);
  const numericIndex = candidateIndexes.sort((left, right) => {
    const leftScore = rows.filter(row => parseLocaleNumber(row?.[left]) !== null).length;
    const rightScore = rows.filter(row => parseLocaleNumber(row?.[right]) !== null).length;
    return rightScore - leftScore || left - right;
  })[0] ?? 1;
  const series = rows.slice(0, maxSeries).map(row => {
    const label = (row || []).slice(0, numericIndex).map(value => String(value ?? '').trim()).filter(Boolean).join(' ');
    return { label: label || String(row?.[0] ?? ''), value: parseLocaleNumber(row?.[numericIndex]) };
  }).filter(item => item.value !== null);
  return { series, numericIndex };
}

function tableChartSeries(table, maxSeries = 30) {
  return tableChartData(table, maxSeries).series;
}

function buildTableChartSvg(chart, seriesData) {
  const allVals = seriesData.map(s => s.value);
  const posMax = Math.max(1, ...allVals.filter(v => v > 0));
  const negMin = Math.min(0, ...allVals.filter(v => v < 0));
  const hasNeg = negMin < 0;
  const svgH = hasNeg ? 240 : 200;
  const barHPos = hasNeg ? 100 : svgH - 30;
  const barHNeg = hasNeg ? 60 : 0;
  const slot = Math.max(20, Math.floor(600 / Math.max(1, seriesData.length)));
  const baselineY = hasNeg ? svgH - barHNeg - 10 : svgH - 10;
  let bars = '';
  seriesData.forEach((s, i) => {
    const x = i * slot + 4;
    const bw = Math.max(12, slot - 8);
    const label = esc(String(s.label).slice(0, 12));
    if (s.value >= 0) {
      const barH = Math.round((s.value / posMax) * barHPos);
      bars += `<rect x="${x}" y="${baselineY - barH}" width="${bw}" height="${Math.max(1, barH)}" fill="#5167E8" rx="2"/>`;
      bars += `<text x="${x + bw / 2}" y="${baselineY - barH - 4}" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">${esc(s.value)}</text>`;
    } else {
      const barH = Math.round((Math.abs(s.value) / Math.abs(negMin || 1)) * barHNeg);
      bars += `<rect x="${x}" y="${baselineY}" width="${bw}" height="${Math.max(1, barH)}" fill="#D9893B" rx="2"/>`;
      bars += `<text x="${x + bw / 2}" y="${baselineY + barH + 12}" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">${esc(s.value)}</text>`;
    }
    bars += `<text x="${x + bw / 2}" y="${svgH - 2}" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">${label}</text>`;
  });
  if (hasNeg) bars += `<line x1="0" y1="${baselineY}" x2="700" y2="${baselineY}" stroke="#999" stroke-width="0.5"/>`;
  const totalW = Math.max(600, seriesData.length * slot);
  return `<svg viewBox="0 0 ${totalW} ${svgH}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="14" font-size="12" font-weight="bold" fill="currentColor">${esc(chart.config.title)}</text>${bars}</svg>`;
}

async function syncDerivedCharts(project, table) {
  if (!project?.id || !table?.id) return;
  try {
    const charts = await loadAssetsByType(project.id, 'chart');
    const derived = charts.filter(chart => chart.sourceTableId === table.id);
    if (!derived.length) return;
    const chartData = tableChartData(table);
    const series = chartData.series;
    await Promise.all(derived.map(async chart => {
      chart.config = { ...(chart.config || {}), series, xAxis: table.headers?.[0] || chart.config?.xAxis, yAxis: table.headers?.[chartData.numericIndex] || chart.config?.yAxis };
      chart.svgData = buildTableChartSvg(chart, series);
      await saveAsset(project.id, chart);
    }));
    appStore.set({ charts: charts.map(chart => derived.find(item => item.id === chart.id) || chart) });
  } catch (error) {
    reportError(error, 'chart-sync', { tableId: table.id });
  }
}

function createChartFromTable(project, table) {
  if (!project || !table) { toast('Proyecto o tabla no disponible', 'warning'); return; }
  const headers = table.headers || [];
  const rows = table.rows || [];
  if (headers.length < 2 || rows.length === 0) {
    toast('La tabla necesita al menos 2 columnas y datos para generar un grafico', 'warning');
    return;
  }
  if (requiresDataReview(table)) {
    blockDerivedFromUncertain(table, 'grafico');
    return;
  }
  const start = Date.now();
  const chart = createChart('Gráfico de ' + (table.name || 'tabla'), project.id, table.id);
  chart.chartType = 'bar';
  chart.config.title = 'Gráfico de ' + (table.name || 'tabla');
  chart.config.xAxis = headers[0];
  const maxSeries = 30;
  const chartData = tableChartData(table, maxSeries);
  chart.config.yAxis = headers[chartData.numericIndex] || headers[1];
  const seriesData = chartData.series;
  if (!seriesData.length) {
    toast('No se encontró una columna numérica reconocible para graficar', 'warning');
    return;
  }
  if (rows.length > maxSeries) toast('Mostrando primeros ' + maxSeries + ' de ' + rows.length + ' registros', 'info');
  chart.config.series = seriesData;
  chart.svgData = buildTableChartSvg(chart, seriesData);
  saveAsset(project.id, chart).then(() => {
    registerExecution(project.id, 'chart-create', 'Crear grafico', {
      inputAssetIds: [table.id],
      sourceAssetId: table.id,
      parameters: { chartType: 'bar', seriesCount: seriesData.length },
      resultType: 'chart',
      resultAssetId: chart.id,
      startedAt: start,
      status: 'completed',
    });
    addRelation(table, chart.id, 'derived-chart');
    saveData(project.id, table);
    refreshProjectCounts(project.id);
    appStore.set({ charts: [...(appStore.get('charts') || []), chart] });
    toast('Gráfico creado y vinculado a la tabla', 'success');
  }).catch(error => reportError(error, 'chart-create', { tableId: table.id }));
}

function reportNumberValue(value) {
  return parseLocaleNumber(value);
}

function createReportFromDataset({ title = 'Datos', headers = [], rows = [], sourceId = null } = {}) {
  const safeHeaders = (headers || []).map((header, index) => String(header || '').trim() || 'Columna ' + (index + 1));
  const safeRows = (rows || []).map(row => safeHeaders.map((_, index) => String(row?.[index] ?? '').trim()));
  if (!safeHeaders.length || !safeRows.length) {
    toast('Necesitas una tabla con encabezados y datos para crear un informe', 'warning');
    return false;
  }
  const config = createReportConfig({
    title: 'Informe: ' + (title || 'Datos'),
    orientation: safeHeaders.length > 6 ? 'landscape' : 'portrait',
  });
  const numericIndex = safeHeaders.findIndex((_, index) => queryColumnType(safeRows, index) === '123');
  const emptyCells = safeRows.reduce((total, row) => total + row.filter(value => !value).length, 0);
  const sampleRows = safeRows.slice(0, 40);
  const subtitle = `${safeRows.length.toLocaleString('es')} filas · ${safeHeaders.length.toLocaleString('es')} columnas · ${emptyCells.toLocaleString('es')} celdas vacías`;
  const titleSection = createReportSection('title', config.title);
  titleSection.sourceId = sourceId;
  const tableSection = createReportSection('table');
  tableSection.data = { headers: safeHeaders, rows: sampleRows, sourceId, truncated: safeRows.length > sampleRows.length };
  const sections = [
    titleSection,
    createReportSection('subtitle', subtitle),
    createReportSection('date', new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(new Date())),
    tableSection,
  ];
  if (safeRows.length > sampleRows.length) {
    sections.push(createReportSection('text', `La vista previa muestra las primeras ${sampleRows.length} filas. Exporta la tabla completa desde Datos o Query.`));
  }
  if (numericIndex >= 0) {
    const series = safeRows.slice(0, 24).map(row => ({
      label: String(row[0] || 'Sin etiqueta').slice(0, 18),
      value: reportNumberValue(row[numericIndex]),
    })).filter(item => item.value !== null);
    if (series.length) {
      const chartSection = createReportSection('chart');
      chartSection.content = safeHeaders[numericIndex];
      chartSection.data = { series, sourceId, valueColumn: safeHeaders[numericIndex] };
      sections.push(chartSection);
    }
  }
  config.sections = sections;
  appStore.set({ designConfig: config, currentView: 'design' });
  renderView('design');
  toast('Informe preparado: revisa el diseño y guárdalo cuando quieras', 'success');
  return true;
}

function createReportFromTable(project, table) {
  if (!project || !table) {
    toast('Proyecto o tabla no disponible', 'warning');
    return false;
  }
  if (requiresDataReview(table)) {
    blockDerivedFromUncertain(table, 'informe');
    return false;
  }
  return createReportFromDataset({ title: table.name || 'Tabla', headers: table.headers, rows: table.rows, sourceId: table.id });
}

async function preparePdfImages(config) {
  const sections = await normalizePdfImageSections(config.sections || [], {
    onError: (error) => reportError(error, 'report-image-prepare', {}),
  });
  return { ...config, sections };
}

async function updateScanOcrState(capture, state) {
  if (!capture?.scanDocumentId) return;
  try {
    const scanDoc = await loadAsset(capture.scanDocumentId);
    if (!scanDoc) return;
    const page = (scanDoc.pages || [])[0];
    if (page) {
      page.ocrText = state.text ?? page.ocrText ?? null;
      page.ocrConfidence = Number(state.confidence || 0);
      page.ocrStatus = state.status || 'pending';
      if (state.words) page.ocrWords = state.words;
      page.updatedAt = Date.now();
    }
    scanDoc.ocrStatus = state.status || 'pending';
    scanDoc.ocrConfidence = Number(state.confidence || 0);
    scanDoc.ocrText = state.text ?? scanDoc.ocrText ?? null;
    if (state.words) scanDoc.ocrWords = state.words;
    scanDoc.updatedAt = Date.now();
    await saveAsset(scanDoc.projectId || capture.projectId, scanDoc);
  } catch (error) {
    reportError(error, 'scan-ocr-state', { captureId: capture.id });
  }
}

async function loadTableSourceContext(table) {
  const project = appStore.get('currentProject');
  if (!project || !table?.sourceAssetId) return { table };
  const sourceDoc = await loadDocumentById(table.sourceAssetId);
  let capture = null;
  let scanDoc = null;
  let imageUrl = null;
  if (sourceDoc?.sourceAssetId) {
    capture = await loadCaptureById(sourceDoc.sourceAssetId);
    if (capture?.scanDocumentId) {
      scanDoc = await loadAsset(capture.scanDocumentId);
      imageUrl = await resolveCaptureImageDataUrl(capture, loadAsset) || sourceDoc.originalDataUrl || null;
    } else {
      imageUrl = await resolveCaptureImageDataUrl(capture, loadAsset);
    }
  }
  return { table, sourceDoc, capture, scanDoc, imageUrl };
}

async function showTableReviewModal(table, stats) {
  const project = appStore.get('currentProject');
  const statsData = stats || tableReviewStats(table);
  const header = h('div', { className: 'ws-review-modal-panel-header' }, 'Tabla y confianza por celda');
  const tableEl = h('table', { className: 'ws-review-table' });
  const thead = h('thead');
  const hr = h('tr');
  (table.headers || []).forEach(headerName => hr.appendChild(h('th', null, headerName)));
  thead.appendChild(hr);
  tableEl.appendChild(thead);
  const tbody = h('tbody');
  (table.rows || []).forEach((row, ri) => {
    const tr = h('tr');
    row.forEach((cell, ci) => {
      const conf = statsData.matrix?.[ri]?.[ci];
      const td = h('td', null, cell);
      if (conf !== null && conf !== undefined) {
        td.appendChild(h('span', { className: 'conf ' + (conf < OCR_LOW_CONFIDENCE ? 'conf-low' : 'conf-high'), title: 'Confianza OCR ' + conf + '%' }, conf + '%'));
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);

  const textBody = h('div', { className: 'ws-review-modal-panel-body', style: 'white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px' }, 'Cargando texto OCR...');
  const imageBody = h('div', { className: 'ws-review-modal-panel-body' }, 'Cargando imagen...');
  const textPanel = h('div', { className: 'ws-review-modal-panel' },
    h('div', { className: 'ws-review-modal-panel-header' }, 'Texto OCR'),
    textBody);
  const imagePanel = h('div', { className: 'ws-review-modal-panel' },
    h('div', { className: 'ws-review-modal-panel-header' }, 'Imagen original'),
    imageBody);

  const statsRow = h('div', { className: 'ws-review-stats' },
    h('span', { className: 'ws-review-stat' }, 'Estado: ' + formatReviewStatus(table.reviewStatus)),
    h('span', { className: 'ws-review-stat' }, 'Confianza minima: ' + (statsData.min ?? 'n/a') + '%'),
    h('span', { className: 'ws-review-stat' }, 'Media: ' + (statsData.avg ?? 'n/a') + '%'),
    h('span', { className: 'ws-review-stat' }, 'Celdas con confianza baja: ' + statsData.lowCount));

  const body = h('div', { className: 'ws-review-modal-grid' },
    h('div', { className: 'ws-review-modal-panel' },
      header,
      h('div', { className: 'ws-review-modal-panel-body' }, tableEl)),
    textPanel,
    imagePanel);

  const footer = h('div', { className: 'ws-modal-footer' },
    h('button', { className: 'ws-btn ws-btn-ghost', onClick: () => { closeModal(); showTableLineage(table); } }, 'Ver origen'),
    h('button', { className: 'ws-btn ws-btn-secondary', onClick: () => { closeModal(); openTableImageCompare(table); } }, 'Comparar con imagen'),
    h('button', { className: 'ws-btn ws-btn-primary', onClick: () => { closeModal(); setTableReviewStatus(table, 'reviewed'); } }, 'Marcar como revisada'),
    h('button', { className: 'ws-btn ws-btn-primary', onClick: () => { closeModal(); setTableReviewStatus(table, 'verified'); } }, 'Marcar como verificada'));

  showModal({ title: 'Revision de tabla', size: 'large', body: [statsRow, body], footer });

  try {
    const ctx = await loadTableSourceContext(table);
    const text = ctx.sourceDoc?.blocks?.map(b => b.content || '').filter(Boolean).join('\n');
    if (text) textBody.textContent = text;
    else textBody.textContent = 'Sin texto de origen disponible.';
    if (ctx.imageUrl) imageBody.replaceChildren(h('img', { src: ctx.imageUrl, alt: 'Imagen original escaneada' }));
    else imageBody.textContent = 'Imagen no disponible.';
  } catch (error) {
    textBody.textContent = 'No se pudo cargar el contexto de origen.';
    imageBody.textContent = 'No se pudo cargar la imagen.';
    reportError(error, 'review-context', { tableId: table.id });
  }
}

async function openTableImageCompare(table) {
  const project = appStore.get('currentProject');
  if (!project || !table?.sourceAssetId) { toast('La tabla no tiene documento de origen', 'warning'); return; }
  const sourceDoc = await loadDocumentById(table.sourceAssetId);
  let imageUrl = null;
  if (sourceDoc?.sourceAssetId) {
    const capture = await loadCaptureById(sourceDoc.sourceAssetId);
    imageUrl = capture?.dataUrl || null;
  }
  const text = sourceDoc?.blocks?.map(b => b.content || '').filter(Boolean).join('\n') || 'Sin texto';
  const textPanel = h('div', { className: 'ws-review-modal-panel' },
    h('div', { className: 'ws-review-modal-panel-header' }, 'Texto OCR'),
    h('div', { className: 'ws-review-modal-panel-body', style: 'white-space:pre-wrap;font-family:ui-monospace,monospace' }, text));
  const imagePanel = h('div', { className: 'ws-review-modal-panel' },
    h('div', { className: 'ws-review-modal-panel-header' }, 'Imagen original'),
    h('div', { className: 'ws-review-modal-panel-body' },
      imageUrl ? h('img', { src: imageUrl, alt: 'Imagen original escaneada' }) : 'Imagen no disponible'));
  showModal({
    title: 'Comparar imagen con texto',
    size: 'large',
    body: [h('div', { className: 'ws-review-modal-grid' }, textPanel, imagePanel)],
    footer: h('div', { className: 'ws-modal-footer' }, h('button', { className: 'ws-btn ws-btn-primary', onClick: () => { closeModal(); } }, 'Cerrar')),
  });
}

async function showTableLineage(table) {
  const project = appStore.get('currentProject');
  if (!project || !table) { toast('Tabla no disponible', 'warning'); return; }
  const ctx = await loadTableSourceContext(table);
  const nodes = [];
  nodes.push({ label: ctx.capture?.name || 'Captura', className: 'root', type: 'capture' });
  if (ctx.scanDoc) nodes.push({ label: ctx.scanDoc.name || 'Escaneo', className: '', type: 'scan' });
  if (ctx.sourceDoc) nodes.push({ label: ctx.sourceDoc.name || 'Documento OCR', className: '', type: 'doc' });
  nodes.push({ label: table.name || 'Tabla', className: 'derived', type: 'table' });
  const lineRow = h('div', { className: 'ws-lineage' });
  nodes.forEach((node, index) => {
    if (index > 0) lineRow.appendChild(h('span', { className: 'ws-lineage-arrow' }, '\u2192'));
    lineRow.appendChild(h('span', { className: 'ws-lineage-node ' + node.className, title: 'Tipo: ' + node.type }, node.label));
  });
  const info = h('div', { style: 'padding:0 12px 12px;font-size:12px;color:var(--ws-text-secondary)' },
    'Origen: ' + (ctx.capture?.id || 'no disponible'));
  showModal({
    title: 'Linea de origen (linaje)',
    size: 'large',
    body: [lineRow, info],
    footer: h('div', { className: 'ws-modal-footer' }, h('button', { className: 'ws-btn ws-btn-primary', onClick: () => { closeModal(); } }, 'Cerrar')),
  });
}

async function extractTextFromScan(project, capture) {
  if (!project || !capture) { toast('Proyecto o captura no disponible', 'warning'); return; }
  const start = Date.now();
  const statusEl = h('div', { style: 'padding:12px;text-align:center;color:var(--ws-text-secondary)' }, 'Iniciando OCR...');
  const footer = h('div', { className: 'ws-modal-footer' },
    h('button', { className: 'ws-btn', id: 'ocr-cancel-btn', onClick: () => { closeModal(); } }, 'Cancelar')
  );
  showModal({ title: 'Extracción de texto (OCR)', body: [statusEl], footer });
  try {
    const scannerMeta = capture.scannerMetadata || {};
    const ocrSource = scannerMeta.ocrSource || 'corrected';
    const sourceAssetId = capture.sourceAssetId;
    let dataUrl = await resolveCaptureImageDataUrl(capture, loadAsset);
    let ocrSourceLabel = 'corrected';
    if (ocrSource === 'original' && sourceAssetId) {
      const sourceAsset = await loadAsset(sourceAssetId);
      if (sourceAsset && (sourceAsset.originalDataUrl || sourceAsset.dataUrl)) {
        dataUrl = sourceAsset.originalDataUrl || sourceAsset.dataUrl;
        ocrSourceLabel = 'original';
      }
    }
    if (!dataUrl) {
      closeModal();
      toast('La captura no tiene imagen asociada', 'warning');
      return;
    }
    const { canvas } = await loadCanvasFromImageSource(dataUrl);
    if (!isOcrEngineAvailable()) {
      await updateScanOcrState(capture, { status: 'unavailable', confidence: 0 });
      closeModal();
      showManualTextEntry(project, capture, start);
      return;
    }
    statusEl.textContent = 'Cargando motor OCR (Tesseract.js)...';
    let ocrResult;
    try {
      ocrResult = await recognizeText(canvas, {
        lang: 'spa',
        onProgress: (pct, msg) => {
          statusEl.textContent = msg || ('Cargando OCR... ' + pct + '%');
        },
        onPhase: (phase) => {
          if (phase === 'recognizing') statusEl.textContent = 'Reconociendo texto...';
        },
      });
    } catch (loadErr) {
      await updateScanOcrState(capture, { status: 'error', confidence: 0 });
      closeModal();
      showManualTextEntry(project, capture, start);
      return;
    }
    const text = ocrResult.text;
    const confidence = ocrResult.confidence;
    const words = ocrResult.words;
    closeModal();
    if (!text) {
      await updateScanOcrState(capture, { status: 'empty', confidence: 0, text: '' });
      toast('No se detecto texto en la imagen. Puedes ingresarlo manualmente.', 'info');
      showManualTextEntry(project, capture, start);
      return;
    }
    const doc = createTextDocument(capture.name || 'Texto extraido', project.id);
    const lines = text.split(/\r?\n/);
    doc.blocks = lines.map((line, idx) => createTextBlock('paragraph', line, idx));
    if (doc.blocks.length === 0) doc.blocks = [createTextBlock('paragraph', '', 0)];
    doc.sourceAssetId = capture.id;
    doc.ocrConfidence = Number(confidence || 0);
    if (words.length) doc.ocrWords = words;
    addRelation(doc, capture.id, 'source-capture');
    await saveDoc(project.id, doc);
    await updateScanOcrState(capture, { status: 'completed', confidence, text, words });
    await registerExecution(project.id, 'ocr-extract', 'Extracción de texto (OCR)', {
      inputAssetIds: [capture.id],
      sourceAssetId: capture.id,
      parameters: {
        engine: 'tesseract.js',
        language: 'spa',
        confidence: Math.round(confidence),
        charCount: text.length,
        lineCount: lines.length,
        ocrSource: ocrSourceLabel,
        ocrWidth: canvas.width,
        ocrHeight: canvas.height,
        originalWidth: canvas.width,
        originalHeight: canvas.height,
        scaled: false,
        autoDetectionFallback: scannerMeta.autoDetectionFallback || false,
        cornersModified: scannerMeta.cornersModified || false,
        filterMode: scannerMeta.filterMode || 'original',
        rotation: scannerMeta.rotation || 0,
        geometryTransformApplied: scannerMeta.geometryTransformApplied || false,
      },
      resultType: 'text-document',
      resultAssetId: doc.id,
      startedAt: start,
      status: 'completed',
    });
    await refreshProjectCounts(project.id);
    appStore.set({ currentDoc: doc, currentView: 'doc-editor' });
    toast('Texto extraido (' + Math.round(confidence) + '% confianza) y documento creado', 'success');
  } catch (e) {
    await updateScanOcrState(capture, { status: 'error', confidence: 0 });
    closeModal();
    toast('Error en OCR: ' + e.message + '. Intenta ingreso manual.', 'error');
    await registerExecution(project.id, 'ocr-extract', 'Extracción de texto (OCR)', {
      inputAssetIds: [capture.id],
      sourceAssetId: capture.id,
      parameters: { engine: 'tesseract.js', error: e.message },
      status: 'failed',
      errors: [e.message],
      startedAt: start,
    }).catch(e => reportError(e, 'register-execution', { action: 'ocr-fail-log' }));
    showManualTextEntry(project, capture, start);
  }
}

function showManualTextEntry(project, capture, ocrStart) {
  const textarea = h('textarea', {
    className: 'ws-form-input',
    rows: '10',
    placeholder: 'Pega o escribe el texto extraido del documento...',
    style: 'width:100%;min-height:200px;font-family:inherit',
  });
  const footer = h('div', { className: 'ws-modal-footer' },
    h('button', { className: 'ws-btn', onClick: () => { closeModal(); } }, 'Cancelar'),
    h('button', { className: 'ws-btn ws-btn-primary', onClick: async () => {
      const text = textarea.value.trim();
      if (!text) { toast('Escribe o pega el texto primero', 'warning'); return; }
      closeModal();
      const start = ocrStart || Date.now();
      const doc = createTextDocument(capture.name || 'Texto extraido', project.id);
      const lines = text.split(/\r?\n/);
      doc.blocks = lines.map((line, idx) => createTextBlock('paragraph', line, idx));
      if (doc.blocks.length === 0) doc.blocks = [createTextBlock('paragraph', '', 0)];
      doc.sourceAssetId = capture.id;
      addRelation(doc, capture.id, 'source-capture');
      await saveDoc(project.id, doc);
      await updateScanOcrState(capture, { status: 'manual', confidence: 100, text });
    await registerExecution(project.id, 'ocr-extract', 'Extracción manual', {
        inputAssetIds: [capture.id],
        sourceAssetId: capture.id,
        parameters: { mode: 'manual', lineCount: lines.length, charCount: text.length },
        resultType: 'text-document',
        resultAssetId: doc.id,
        startedAt: start,
        status: 'completed',
      });
      await refreshProjectCounts(project.id);
      appStore.set({ currentDoc: doc, currentView: 'doc-editor' });
      toast('Texto extraido y documento creado', 'success');
    } }, 'Crear documento')
  );
  showModal({ title: 'Ingreso manual de texto', body: [textarea], footer });
}

async function createNewDoc() {
  const project = appStore.get('currentProject');
  if (!project) return;
  const start = Date.now();
  const doc = createTextDocument('Documento sin titulo', project.id);
  doc.blocks = [createTextBlock('paragraph', '', 0)];
  await saveDoc(project.id, doc);
  _appHistory.push(_captureWorkspaceState(), { action: 'doc-create' });
  await registerExecution(project.id, 'document-create', 'Crear documento', {
    parameters: { title: doc.name },
    resultType: 'text-document',
    resultAssetId: doc.id,
    startedAt: start,
    status: 'completed',
  });
  await refreshProjectCounts(project.id);
  appStore.set({ currentDoc: doc, currentView: 'doc-editor' });
  toast('Documento creado', 'success');
}

function importDocumentFile() {
  const project = appStore.get('currentProject');
  if (!project) return;
  const textExtensions = ['.txt', '.md', '.markdown', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.jsonl', '.ndjson', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log', '.sql', '.rtf', '.tex'];
  const input = h('input', { type: 'file', accept: textExtensions.join(',') + ',text/plain,text/markdown,text/html,application/json,application/xml,text/xml' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const validation = validateWorkspaceFile(file, textExtensions);
    if (!validation.ok) { toast(validation.message, 'warning'); return; }
    try {
      const source = await file.text();
      const text = /\.html?$/i.test(file.name)
        ? (new DOMParser().parseFromString(source, 'text/html').body?.textContent || '')
        : source;
      const config = getWorkspaceConfig();
      const blocks = text.split(/\r?\n/).slice(0, config.maxDocumentBlocks).map((line, idx) => {
        const value = line.trim();
        if (/^###\s+/.test(value)) return createTextBlock('heading3', value.replace(/^###\s+/, ''), idx);
        if (/^##\s+/.test(value)) return createTextBlock('heading2', value.replace(/^##\s+/, ''), idx);
        if (/^#\s+/.test(value)) return createTextBlock('heading1', value.replace(/^#\s+/, ''), idx);
        if (/^[-*]\s+/.test(value)) return createTextBlock('bullet-list', value.replace(/^[-*]\s+/, ''), idx);
        if (/^>\s+/.test(value)) return createTextBlock('quote', value.replace(/^>\s+/, ''), idx);
        return createTextBlock('paragraph', line, idx);
      });
      const doc = createTextDocument(
        file.name.replace(/\.(txt|md|markdown|html?|css|m?js|cjs|tsx?|jsx|jsonl?|ndjson|xml|ya?ml|toml|ini|log|sql|rtf|tex)$/i, '') || 'Documento importado',
        project.id
      );
      doc.blocks = blocks.length ? blocks : [createTextBlock('paragraph', '', 0)];
      await saveDoc(project.id, doc);
      await registerExecution(project.id, 'text-import', 'Importar texto', {
        parameters: { fileName: file.name, blockCount: blocks.length },
        resultType: 'text-document',
        resultAssetId: doc.id,
        status: 'completed',
      });
      await refreshProjectCounts(project.id);
      appStore.set({ currentDoc: doc, currentView: 'doc-editor' });
      toast('Documento importado: ' + file.name, 'success');
    } catch (error) {
      toast('No se pudo importar el documento: ' + error.message, 'error');
    }
  });
  input.click();
}

function renderDocumentsView(container, project) {
  const docs = appStore.get('documents');
  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease' });
  el.appendChild(h('div', { className: 'hero' },
    h('h1', null, 'Documentos'),
    h('p', null, 'Gestiona los documentos de ' + project.name)
  ));
  if (docs.length === 0) {
    el.appendChild(h('div', { className: 'ws-empty' },
      h('div', { className: 'ws-empty-icon' }, svgIcon('doc', 28)),
      h('div', { className: 'ws-empty-title' }, 'Sin documentos'),
      h('div', { className: 'ws-empty-text' }, 'Crea un documento nuevo para comenzar a escribir.'),
      h('button', { className: 'ws-btn ws-btn-primary', onClick: createNewDoc }, svgIcon('plus'), ' Nuevo Documento')
    ));
  } else {
    const grid = h('div', { className: 'ws-card-grid' });
    docs.forEach(doc => {
      const card = h('div', { className: 'ws-card', style: 'cursor:pointer', onClick: () => {
        appStore.set({ currentDoc: doc, currentView: 'doc-editor' });
      }});
      card.appendChild(h('div', { style: 'font-weight:500;font-size:14px;margin-bottom:4px' }, doc.title || 'Documento sin título'));
      card.appendChild(h('div', { style: 'font-size:12px;color:var(--ws-text-secondary);margin-bottom:2px' }, (doc.blocks ? doc.blocks.length : 0) + ' bloques'));
      card.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-tertiary)' }, formatTimeAgo(doc.updatedAt)));
      const delBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: async (e) => {
        e.stopPropagation();
        showConfirm({
          title: 'Eliminar documento',
          message: 'El documento se quitará de este proyecto.',
          confirmText: 'Eliminar documento',
          onConfirm: async () => {
          await deleteDoc(doc.id);
          const remaining = docs.filter(d => d.id !== doc.id);
          appStore.set({ documents: remaining });
          renderView('documents');
          toast('Documento eliminado', 'success');
          },
        });
      } }, svgIcon('trash'));
      const flowBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: (e) => {
        e.stopPropagation();
        startWorkflowFromWorkspace({ id: 'doc-' + doc.id, name: doc.title || doc.name || 'Documento', kind: 'document' });
      } }, svgIcon('flow'), ' Encadenar');
      card.appendChild(h('div', { style: 'margin-top:6px;display:flex;gap:4px' }, flowBtn, delBtn));
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }
  container.appendChild(el);
  loadDocs(project.id).then(d => {
    appStore.set({ documents: d });
    if (docs.length !== d.length) {
      container.replaceChildren();
      renderDocumentsView(container, project);
    }
  });
}

const BLOCK_TYPES = [
  { type: 'paragraph', label: 'Texto', icon: 'text', desc: 'Bloque de texto normal' },
  { type: 'heading1', label: 'Título 1', icon: 'text', desc: 'Título grande' },
  { type: 'heading2', label: 'Título 2', icon: 'text', desc: 'Título mediano' },
  { type: 'heading3', label: 'Título 3', icon: 'text', desc: 'Título pequeño' },
  { type: 'bullet-list', label: 'Lista', icon: 'list', desc: 'Lista con viñetas' },
  { type: 'numbered-list', label: 'Lista numerada', icon: 'list', desc: 'Lista numerada' },
  { type: 'quote', label: 'Cita', icon: 'quote', desc: 'Bloque de cita' },
  { type: 'code', label: 'Codigo', icon: 'code', desc: 'Bloque de codigo' },
  { type: 'divider', label: 'Divisor', icon: 'divider', desc: 'Línea horizontal' },
  { type: 'callout', label: 'Nota', icon: 'callout', desc: 'Bloque de nota destacada' },
  { type: 'image-block', label: 'Imagen', icon: 'imageBlock', desc: 'Insertar imagen' },
];

let activeDocEditor = null;
let activeDocSelection = null;

const DOC_ALLOWED_TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'HR',
  'I', 'LI', 'MARK', 'OL', 'P', 'PRE', 'S', 'STRONG', 'TABLE', 'TBODY', 'TD',
  'TH', 'THEAD', 'TR', 'U', 'UL', 'IMG',
]);

function safeDocUrl(value) {
  const url = String(value || '').trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^data:image\//i.test(url) || /^blob:/i.test(url)) return url;
  return '';
}

function serializeDocNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return esc(node.nodeValue || '');
  if (node.nodeType !== Node.ELEMENT_NODE || !DOC_ALLOWED_TAGS.has(node.tagName)) {
    return [...(node.childNodes || [])].map(serializeDocNode).join('');
  }
  const tag = node.tagName.toLowerCase();
  if (tag === 'hr') return '<hr>';
  if (tag === 'br') return '<br>';
  const attrs = [];
  if (tag === 'a') {
    const href = safeDocUrl(node.getAttribute('href'));
    if (href) attrs.push(` href="${esc(href)}" target="_blank" rel="noreferrer"`);
  }
  if (tag === 'img') {
    const src = safeDocUrl(node.getAttribute('src'));
    if (!src) return '';
    attrs.push(` src="${esc(src)}" alt="${esc(node.getAttribute('alt') || '')}"`);
  }
  if (tag === 'div' && node.getAttribute('data-page-break') === 'true') attrs.push(' data-page-break="true"');
  if (['td', 'th'].includes(tag)) {
    const colspan = Number(node.getAttribute('colspan'));
    const rowspan = Number(node.getAttribute('rowspan'));
    if (Number.isInteger(colspan) && colspan > 1 && colspan < 20) attrs.push(` colspan="${colspan}"`);
    if (Number.isInteger(rowspan) && rowspan > 1 && rowspan < 20) attrs.push(` rowspan="${rowspan}"`);
  }
  const children = [...(node.childNodes || [])].map(serializeDocNode).join('');
  return `<${tag}${attrs.join('')}>${children}</${tag}>`;
}

function sanitizeDocHtml(html) {
  const source = String(html || '');
  if (!source) return '';
  const parsed = new DOMParser().parseFromString(`<div>${source}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  return root ? [...root.childNodes].map(serializeDocNode).join('') : '';
}

function mountDocHtml(element, html) {
  const safeHtml = sanitizeDocHtml(html);
  if (!safeHtml) return;
  const parsed = new DOMParser().parseFromString(`<div>${safeHtml}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return;
  [...root.childNodes].forEach(node => element.appendChild(document.importNode(node, true)));
}

function rememberDocSelection(editor = activeDocEditor) {
  if (!editor) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  if (anchor && editor.contains(anchor)) {
    activeDocEditor = editor;
    activeDocSelection = selection.getRangeAt(0).cloneRange();
  }
}

function restoreDocSelection() {
  if (!activeDocEditor?.isConnected || !activeDocSelection) return;
  activeDocEditor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(activeDocSelection);
}

function activeDocBlock(doc) {
  const id = activeDocEditor?.dataset.blockId;
  return doc?.blocks?.find(block => block.id === id) || null;
}

function syncDocEditorBlock(editor = activeDocEditor) {
  const doc = appStore.get('currentDoc');
  const block = activeDocBlock(doc);
  if (!editor || !doc || !block) return;
  block.html = sanitizeDocHtml(editor.innerHTML);
  block.content = editor.textContent || '';
  autoSaveDoc(doc);
}

function runDocCommand(command, value = null) {
  if (!activeDocEditor) {
    toast('Selecciona un bloque de texto primero', 'info');
    return;
  }
  restoreDocSelection();
  if (typeof document.execCommand !== 'function') {
    toast('Este navegador no permite editar con esta herramienta', 'warning');
    return;
  }
  document.execCommand(command, false, value);
  rememberDocSelection(activeDocEditor);
  syncDocEditorBlock();
}

function insertDocHtml(html) {
  if (!activeDocEditor) {
    toast('Selecciona un bloque de texto primero', 'info');
    return;
  }
  restoreDocSelection();
  document.execCommand('insertHTML', false, sanitizeDocHtml(html));
  rememberDocSelection(activeDocEditor);
  syncDocEditorBlock();
}

function documentSelectionText() {
  const selection = window.getSelection();
  return selection?.toString() || '';
}

async function copyDocumentSelection(cut = false) {
  restoreDocSelection();
  const selected = documentSelectionText();
  if (!selected) {
    toast('Selecciona texto antes de copiar', 'info');
    return;
  }
  let copied = false;
  try {
    copied = Boolean(document.execCommand(cut ? 'cut' : 'copy'));
  } catch (error) {}
  if (!copied && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(selected); copied = true; } catch (error) {}
  }
  if (copied && cut) syncDocEditorBlock();
  toast(copied ? (cut ? 'Texto cortado' : 'Texto copiado') : 'El navegador bloqueó el portapapeles', copied ? 'success' : 'warning');
}

async function pasteDocumentText() {
  if (!activeDocEditor || !navigator.clipboard?.readText) {
    toast('Usa Ctrl + V dentro del documento', 'info');
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      restoreDocSelection();
      document.execCommand('insertText', false, text);
      syncDocEditorBlock();
      toast('Texto pegado', 'success');
    }
  } catch (error) {
    toast('El navegador no permitió leer el portapapeles', 'warning');
  }
}

function insertDocLink() {
  const label = h('input', { className: 'ws-input', type: 'text', placeholder: 'Texto del enlace' });
  const url = h('input', { className: 'ws-input', type: 'url', placeholder: 'https://ejemplo.com' });
  showModal({
    title: 'Insertar enlace',
    body: [queryFormField('Texto', label), queryFormField('Dirección', url)],
    confirmText: 'Insertar enlace',
    onConfirm: async () => {
      const safeUrl = safeDocUrl(url.value);
      if (!safeUrl) {
        toast('Escribe una dirección web válida', 'warning');
        return;
      }
      restoreDocSelection();
      document.execCommand('createLink', false, safeUrl);
      if (label.value.trim() && !documentSelectionText()) insertDocHtml(`<a href="${esc(safeUrl)}">${esc(label.value.trim())}</a>`);
      syncDocEditorBlock();
    },
    size: 'small',
  });
}

function insertDocTable() {
  const rows = h('input', { className: 'ws-input', type: 'number', min: '1', max: '20', value: '3' });
  const columns = h('input', { className: 'ws-input', type: 'number', min: '1', max: '12', value: '3' });
  showModal({
    title: 'Insertar tabla',
    body: [queryFormField('Filas', rows), queryFormField('Columnas', columns)],
    confirmText: 'Insertar tabla',
    onConfirm: async () => {
      const rowCount = Math.max(1, Math.min(20, Number(rows.value) || 3));
      const columnCount = Math.max(1, Math.min(12, Number(columns.value) || 3));
      const head = '<tr>' + Array.from({ length: columnCount }, (_, index) => `<th>Columna ${index + 1}</th>`).join('') + '</tr>';
      const body = Array.from({ length: rowCount }, () => '<tr>' + Array.from({ length: columnCount }, () => '<td> </td>').join('') + '</tr>').join('');
      insertDocHtml(`<table><thead>${head}</thead><tbody>${body}</tbody></table><p></p>`);
    },
    size: 'small',
  });
}

function openDocumentFind() {
  const search = h('input', { className: 'ws-input', type: 'search', placeholder: 'Palabra o frase' });
  showModal({
    title: 'Buscar en el documento',
    body: [queryFormField('Buscar', search, 'También puedes usar Ctrl + F en el navegador.')],
    confirmText: 'Buscar siguiente',
    onConfirm: async () => {
      const value = search.value.trim();
      if (!value) return;
      if (window.find && window.find(value)) toast(`Encontrado: ${value}`, 'success');
      else toast('No se encontró ese texto', 'info');
    },
    size: 'small',
  });
}

function exportDocumentHtml() {
  const doc = appStore.get('currentDoc');
  if (!doc) return;
  const blocks = (doc.blocks || []).map(block => {
    if (block.type === 'divider') return '<hr>';
    if (block.type === 'image-block') return block.content ? `<img src="${esc(safeDocUrl(block.content))}" alt="Imagen del documento">` : '';
    const tag = block.type.startsWith('heading') ? block.type.replace('heading', 'h') : block.type === 'quote' ? 'blockquote' : block.type === 'code' ? 'pre' : 'p';
    return `<${tag}>${sanitizeDocHtml(block.html || esc(block.content || ''))}</${tag}>`;
  }).join('\n');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(doc.title || 'Documento')}</title><style>body{font:16px/1.7 Arial,sans-serif;max-width:820px;margin:48px auto;padding:0 24px;color:#202020}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;text-align:left}blockquote{border-left:4px solid #111;padding-left:16px;color:#555}pre{background:#f4f1ea;padding:16px;overflow:auto}[data-page-break]{break-before:page;page-break-before:always;height:1px;margin:24px 0;border-top:1px dashed #aaa}</style></head><body><h1>${esc(doc.title || 'Documento')}</h1>${blocks}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = h('a', { href: url, download: (doc.title || 'documento') + '.html' });
  anchor.click();
  URL.revokeObjectURL(url);
  toast('Documento exportado como HTML', 'success');
}

function printDocument() {
  document.body.classList.add('ws-printing-document');
  window.print();
  setTimeout(() => document.body.classList.remove('ws-printing-document'), 500);
}

function insertDocDate() {
  const date = new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(new Date());
  insertDocHtml(`<span>${esc(date)}</span>`);
}

function insertDocPageBreak() {
  insertDocHtml('<div data-page-break="true"></div><p></p>');
}

function toggleDocSpellcheck() {
  if (!activeDocEditor) {
    toast('Selecciona un bloque de texto primero', 'info');
    return;
  }
  const enabled = activeDocEditor.getAttribute('spellcheck') !== 'false';
  activeDocEditor.setAttribute('spellcheck', String(!enabled));
  toast(!enabled ? 'Corrector activado' : 'Corrector desactivado', 'info');
}

function clearDocFormatting() {
  runDocCommand('removeFormat');
  toast('Formato directo eliminado', 'success');
}

function openDocumentStats(doc) {
  const words = documentWordCount(doc);
  const chars = (doc.blocks || []).map(block => block.content || '').join('').length;
  const headings = (doc.blocks || []).filter(block => String(block.type || '').startsWith('heading')).length;
  showModal({
    title: 'Estadísticas del documento',
    content: h('div', { className: 'ws-doc-stats-grid' },
      h('div', null, h('strong', null, words.toLocaleString('es')), h('span', null, 'palabras')),
      h('div', null, h('strong', null, chars.toLocaleString('es')), h('span', null, 'caracteres')),
      h('div', null, h('strong', null, String((doc.blocks || []).length)), h('span', null, 'bloques')),
      h('div', null, h('strong', null, String(headings)), h('span', null, 'títulos'))
    ),
    confirmText: 'Cerrar',
    size: 'small',
  });
}

function documentWordCount(doc) {
  const text = (doc.blocks || []).map(block => block.content || '').join(' ').trim();
  return text ? text.split(/\s+/).length : 0;
}

function makeDocToolbarButton(label, icon, action, title) {
  return h('button', {
    className: 'ws-doc-tool',
    type: 'button',
    title: title || label,
    ariaLabel: title || label,
    onMouseDown: (event) => {
      const focusedEditor = document.activeElement?.closest?.('.ws-doc-editable');
      if (focusedEditor) activeDocEditor = focusedEditor;
      rememberDocSelection(activeDocEditor);
      event.preventDefault();
    },
    onClick: action,
  }, svgIcon(icon, 15), h('span', { className: 'ws-doc-tool-label' }, label));
}

function renderDocumentToolbar(doc, metrics) {
  const toolbar = h('div', { className: 'ws-doc-toolbar', role: 'toolbar', ariaLabel: 'Herramientas de edición' });
  const ribbonPanels = {};
  const ribbonBody = h('div', { className: 'ws-doc-ribbon-panel active', 'data-doc-ribbon-panel': 'Inicio', role: 'tabpanel', id: 'ws-doc-panel-Inicio', 'aria-labelledby': 'ws-doc-tab-Inicio' });
  ribbonPanels.Inicio = ribbonBody;
  const insertPanel = h('div', { className: 'ws-doc-ribbon-panel', 'data-doc-ribbon-panel': 'Insertar', hidden: true, role: 'tabpanel', id: 'ws-doc-panel-Insertar', 'aria-labelledby': 'ws-doc-tab-Insertar' });
  const reviewPanel = h('div', { className: 'ws-doc-ribbon-panel', 'data-doc-ribbon-panel': 'Revisar', hidden: true, role: 'tabpanel', id: 'ws-doc-panel-Revisar', 'aria-labelledby': 'ws-doc-tab-Revisar' });
  const viewPanel = h('div', { className: 'ws-doc-ribbon-panel', 'data-doc-ribbon-panel': 'Vista', hidden: true, role: 'tabpanel', id: 'ws-doc-panel-Vista', 'aria-labelledby': 'ws-doc-tab-Vista' });
  ribbonPanels.Insertar = insertPanel;
  ribbonPanels.Revisar = reviewPanel;
  ribbonPanels.Vista = viewPanel;
  const activateRibbon = name => Object.entries(ribbonPanels).forEach(([key, panel]) => {
    const active = key === name;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
    toolbar.querySelector(`[data-doc-ribbon-tab="${key}"]`)?.classList.toggle('active', active);
  });
  const tabs = h('div', { className: 'ws-doc-ribbon-tabs', role: 'tablist', ariaLabel: 'Pestañas de herramientas del documento' });
  Object.keys(ribbonPanels).forEach(name => tabs.appendChild(h('button', {
    className: 'ws-doc-ribbon-tab' + (name === 'Inicio' ? ' active' : ''),
    type: 'button',
    role: 'tab',
    id: 'ws-doc-tab-' + name,
    'aria-controls': 'ws-doc-panel-' + name,
    'data-doc-ribbon-tab': name,
    'aria-selected': name === 'Inicio' ? 'true' : 'false',
    onClick: () => {
      activateRibbon(name);
      tabs.querySelectorAll('[data-doc-ribbon-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.getAttribute('data-doc-ribbon-tab') === name)));
    },
  }, name)));
  enableTablistKeyboard(tabs);
  const group = (...items) => ribbonBody.appendChild(h('div', { className: 'ws-doc-tool-group' }, ...items));
  group(
    makeDocToolbarButton('Deshacer', 'undo', () => runDocCommand('undo'), 'Deshacer · Ctrl Z'),
    makeDocToolbarButton('Rehacer', 'redo', () => runDocCommand('redo'), 'Rehacer · Ctrl Y'),
    makeDocToolbarButton('Copiar', 'copy', () => copyDocumentSelection(), 'Copiar · Ctrl C'),
    makeDocToolbarButton('Cortar', 'cut', () => copyDocumentSelection(true), 'Cortar · Ctrl X'),
    makeDocToolbarButton('Pegar', 'paste', pasteDocumentText, 'Pegar · Ctrl V')
  );
  const format = h('select', { className: 'ws-doc-format', title: 'Estilo de párrafo', ariaLabel: 'Estilo de párrafo', onMouseDown: event => { rememberDocSelection(activeDocEditor); event.preventDefault(); }, onChange: event => runDocCommand('formatBlock', event.target.value) });
  [['P', 'Texto'], ['H1', 'Título 1'], ['H2', 'Título 2'], ['H3', 'Título 3'], ['BLOCKQUOTE', 'Cita'], ['PRE', 'Código']].forEach(([value, label]) => format.appendChild(h('option', { value }, label)));
  const fontFamily = h('select', { className: 'ws-doc-format ws-doc-font-family', title: 'Familia tipográfica', ariaLabel: 'Familia tipográfica', onMouseDown: event => { rememberDocSelection(activeDocEditor); event.preventDefault(); }, onChange: event => runDocCommand('fontName', event.target.value) });
  [['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Verdana', 'Verdana'], ['Courier New', 'Monoespaciada']].forEach(([value, label]) => fontFamily.appendChild(h('option', { value }, label)));
  const fontSize = h('select', { className: 'ws-doc-format ws-doc-font-size', title: 'Tamaño de texto', ariaLabel: 'Tamaño de texto', onMouseDown: event => { rememberDocSelection(activeDocEditor); event.preventDefault(); }, onChange: event => runDocCommand('fontSize', event.target.value) });
  [['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '32']].forEach(([value, label]) => fontSize.appendChild(h('option', { value }, label + ' pt')));
  const textColor = h('input', { className: 'ws-doc-color', type: 'color', value: '#20242b', title: 'Color del texto', ariaLabel: 'Color del texto', onMouseDown: event => { rememberDocSelection(activeDocEditor); event.stopPropagation(); }, onInput: event => runDocCommand('foreColor', event.target.value) });
  const highlightColor = h('input', { className: 'ws-doc-color', type: 'color', value: '#F3EBDD', title: 'Color de resaltado', ariaLabel: 'Color de resaltado', onMouseDown: event => { rememberDocSelection(activeDocEditor); event.stopPropagation(); }, onInput: event => runDocCommand('hiliteColor', event.target.value) });
  group(format, fontFamily, fontSize, textColor, highlightColor);
  group(
    makeDocToolbarButton('Negrita', 'bold', () => runDocCommand('bold'), 'Negrita · Ctrl B'),
    makeDocToolbarButton('Cursiva', 'italic', () => runDocCommand('italic'), 'Cursiva · Ctrl I'),
    makeDocToolbarButton('Subrayado', 'underline', () => runDocCommand('underline'), 'Subrayado · Ctrl U'),
    makeDocToolbarButton('Tachado', 'strike', () => runDocCommand('strikeThrough'), 'Tachado'),
    makeDocToolbarButton('Resaltado', 'highlight', () => runDocCommand('hiliteColor', '#F3EBDD'), 'Resaltar')
  );
  group(
    makeDocToolbarButton('Alinear izquierda', 'alignLeft', () => runDocCommand('justifyLeft'), 'Alinear izquierda'),
    makeDocToolbarButton('Centrar', 'alignCenter', () => runDocCommand('justifyCenter'), 'Centrar'),
    makeDocToolbarButton('Alinear derecha', 'alignRight', () => runDocCommand('justifyRight'), 'Alinear derecha'),
    makeDocToolbarButton('Justificar', 'alignLeft', () => runDocCommand('justifyFull'), 'Justificar texto'),
    makeDocToolbarButton('Lista con viñetas', 'list', () => runDocCommand('insertUnorderedList'), 'Lista con viñetas'),
    makeDocToolbarButton('Lista numerada', 'list', () => runDocCommand('insertOrderedList'), 'Lista numerada')
  );
  group(
    makeDocToolbarButton('Aumentar sangría', 'indent', () => runDocCommand('indent'), 'Aumentar sangría'),
    makeDocToolbarButton('Reducir sangría', 'outdent', () => runDocCommand('outdent'), 'Reducir sangría')
  );
  const lineSpacing = h('select', { className: 'ws-doc-format', title: 'Interlineado', ariaLabel: 'Interlineado', onMouseDown: event => { rememberDocSelection(activeDocEditor); event.preventDefault(); }, onChange: event => {
    const val = parseFloat(event.target.value);
    if (activeDocEditor) { activeDocEditor.style.lineHeight = val; }
  } });
  [['1', '1.0'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', '2.0'], ['2.5', '2.5'], ['3', '3.0']].forEach(([value, label]) => lineSpacing.appendChild(h('option', { value }, label)));
  group(lineSpacing);
  const hasTabularContent = doc && doc.blocks && doc.blocks.length > 0 && (() => {
    const text = doc.blocks.map(b => b.content || '').join('\n');
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return false;
    if (['\t', ';', '|'].some(s => text.includes(s))) return true;
    if (/\s{2,}/.test(text)) return true;
    const commaCounts = lines.map(l => (l.match(/,/g) || []).length);
    if (commaCounts.every(c => c > 0 && c === commaCounts[0]) && commaCounts[0] >= 1 && lines.some(l => /\d/.test(l))) return true;
    const tokensPerLine = lines.map(l => l.split(/\s+/).length);
    const median = tokensPerLine.slice().sort((a, b) => a - b)[Math.floor(tokensPerLine.length / 2)];
    if (median < 2) return false;
    const closeCount = tokensPerLine.filter(c => Math.abs(c - median) <= 1).length;
    if (closeCount / tokensPerLine.length < 0.6) return false;
    const sentenceEnds = lines.filter(l => /[.!?]\s*$/.test(l.trim())).length;
    if (sentenceEnds >= Math.ceil(lines.length / 2)) return false;
    const hasNumbers = lines.some(l => /\d/.test(l));
    if (!hasNumbers) return false;
    const longestLine = Math.max(...lines.map(l => l.length));
    const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    if (longestLine > 120 && avgLineLen > 60) return false;
    return true;
  })();
  const ribbonGroup = (panel, label, ...items) => panel.appendChild(h('div', { className: 'ws-doc-tool-group', 'data-ribbon-group': label }, ...items));
  ribbonGroup(insertPanel, 'Insertar',
    makeDocToolbarButton('Insertar tabla', 'table', insertDocTable, 'Insertar tabla'),
    makeDocToolbarButton('Insertar imagen', 'imageBlock', () => document.querySelector('.ws-doc-add-block')?.click(), 'Insertar imagen o bloque'),
    makeDocToolbarButton('Insertar fecha', 'file', insertDocDate, 'Insertar fecha'),
    makeDocToolbarButton('Salto de página', 'divider', insertDocPageBreak, 'Insertar separador de página'),
    makeDocToolbarButton('Enlace', 'link', insertDocLink, 'Insertar enlace')
  );
  ribbonGroup(insertPanel, 'Acciones',
    makeDocToolbarButton('Añadir bloque', 'plus', () => document.querySelector('.ws-doc-add-block')?.click(), 'Añadir bloque'),
    makeDocToolbarButton('Buscar', 'search', openDocumentFind, 'Buscar en documento · Ctrl F'),
    makeDocToolbarButton('Imprimir', 'print', printDocument, 'Imprimir documento')
  );
  if (hasTabularContent) {
    ribbonGroup(insertPanel, 'Datos',
      h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', title: 'Convertir a tabla de datos', onClick: () => convertDocToTable(doc) }, svgIcon('table'), ' A tabla')
    );
  }
  ribbonGroup(insertPanel, 'Salida',
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', title: 'Crear informe desde este documento', onClick: () => {
      const docText = (doc.blocks || []).map(b => b.content || '').join('\n');
      const config = createReportConfig({ title: 'Informe: ' + (doc.title || 'Documento') });
      config.sections = [createReportSection('text', docText || '')];
      appStore.set({ designConfig: config, currentView: 'design' });
      renderView('design');
      toast('Informe creado desde el documento', 'success');
    } }, svgIcon('file'), ' Informe')
  );
  ribbonGroup(reviewPanel, 'Revisar',
    makeDocToolbarButton('Buscar', 'search', openDocumentFind, 'Buscar en documento · Ctrl F'),
    makeDocToolbarButton('Estadísticas', 'chart', () => openDocumentStats(doc), 'Ver estadísticas'),
    makeDocToolbarButton('Limpiar formato', 'close', clearDocFormatting, 'Limpiar formato directo'),
    makeDocToolbarButton('Corrector', 'check', toggleDocSpellcheck, 'Activar o desactivar corrector'),
    makeDocToolbarButton('Convertir a tabla', 'table', () => convertDocToTable(doc), 'Convertir a tabla de datos')
  );
  ribbonGroup(viewPanel, 'Vista',
    makeDocToolbarButton('Imprimir', 'print', printDocument, 'Imprimir documento'),
    makeDocToolbarButton('Exportar HTML', 'download', exportDocumentHtml, 'Exportar HTML'),
    makeDocToolbarButton('Exportar Markdown', 'download', exportDocument, 'Exportar Markdown'),
    makeDocToolbarButton('Crear informe', 'file', () => {
      const docText = (doc.blocks || []).map(b => b.content || '').join('\n');
      const config = createReportConfig({ title: 'Informe: ' + (doc.title || 'Documento') });
      config.sections = [createReportSection('text', docText || '')];
      appStore.set({ designConfig: config, currentView: 'design' });
      renderView('design');
      toast('Informe creado desde el documento', 'success');
    }, 'Crear informe desde este documento')
  );
  ribbonGroup(viewPanel, 'Enfoque',
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', title: 'Modo enfoque — oculta toolbar y distracciones', onClick: () => {
      const editorEl = document.querySelector('.ws-doc-editor');
      if (editorEl) {
        editorEl.classList.toggle('ws-doc-focus-mode');
        toast(editorEl.classList.contains('ws-doc-focus-mode') ? 'Modo enfoque activado — presiona Esc para salir' : 'Modo enfoque desactivado', 'success');
      }
    } }, svgIcon('eye'), ' Modo enfoque')
  );
  toolbar.appendChild(tabs);
  toolbar.appendChild(ribbonBody);
  toolbar.appendChild(insertPanel);
  toolbar.appendChild(reviewPanel);
  toolbar.appendChild(viewPanel);
  toolbar.appendChild(metrics);
  return toolbar;
}

function renderDocEditor(container) {
  const doc = appStore.get('currentDoc');
  if (!doc) return;
  const el = h('div', { className: 'ws-doc-editor' });
  const titleInput = h('input', {
    type: 'text',
    value: doc.title || '',
    placeholder: 'Título del documento...',
    style: 'width:100%;border:none;font-size:28px;font-weight:700;background:transparent;color:var(--ws-text);outline:none;margin-bottom:20px;font-family:var(--ws-font)',
    onInput: (e) => { doc.title = e.target.value; autoSaveDoc(doc); }
  });
  el.appendChild(titleInput);
  const metrics = h('div', { className: 'ws-doc-metrics' }, `0 palabras · ${(doc.blocks || []).length} bloques`);
  const toolbar = renderDocumentToolbar(doc, metrics);
  el.appendChild(toolbar);
  const blocksContainer = h('div', { className: 'ws-doc-blocks' });
  el.appendChild(blocksContainer);

  function renderBlocks() {
    blocksContainer.replaceChildren();
    (doc.blocks || []).forEach((block, idx) => {
      const blockEl = renderBlock(block, idx, doc, renderBlocks, () => {
        metrics.textContent = `${documentWordCount(doc)} palabras · ${(doc.blocks || []).length} bloques`;
      });
      blocksContainer.appendChild(blockEl);
    });
    const addBlockBtn = h('button', {
      className: 'ws-btn ws-btn-ghost ws-btn-sm ws-doc-add-block',
      id: 'ws-doc-add-block',
      'data-action': 'add-block',
      style: 'margin-top:8px;width:100%;justify-content:center',
      onClick: () => showBlockMenu(addBlockBtn, doc, renderBlocks)
    }, svgIcon('plus'), ' Agregar bloque');
    blocksContainer.appendChild(addBlockBtn);
    metrics.textContent = `${documentWordCount(doc)} palabras · ${(doc.blocks || []).length} bloques`;
  }
  renderBlocks();
  container.appendChild(el);
}

function renderBlock(block, index, doc, renderBlocks, updateMetrics = () => {}) {
  const wrapper = h('div', { className: 'ws-doc-block', draggable: 'true', 'data-block-id': block.id });
  const handle = h('div', { className: 'block-handle' }, svgIcon('grip', 14));
  wrapper.appendChild(handle);
  let contentEl;
  if (block.type === 'divider') {
    contentEl = h('div', { style: 'flex:1;height:1px;background:var(--ws-border);margin:8px 0' });
  } else if (block.type === 'image-block') {
    contentEl = h('div', { style: 'flex:1' });
    if (block.content) {
      contentEl.appendChild(h('img', { src: block.content, style: 'max-width:100%;border-radius:var(--ws-radius-md)' }));
    } else {
      const imgBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: () => {
        const input = h('input', { type: 'file', accept: 'image/*' });
        input.addEventListener('change', async () => {
          const file = input.files[0];
          if (file) {
            const validation = validateWorkspaceFile(file, ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
            if (!validation.ok) { toast(validation.message, 'warning'); return; }
            block.content = await readFileAsDataUrl(file);
            renderBlocks();
            autoSaveDoc(doc);
          }
        });
        input.click();
      } }, svgIcon('imageBlock'), ' Seleccionar imagen');
      contentEl.appendChild(imgBtn);
    }
  } else {
    const placeholder = {
      paragraph: 'Escribe algo...',
      heading1: 'Título 1',
      heading2: 'Título 2',
      heading3: 'Título 3',
      'bullet-list': 'Elemento de lista',
      'numbered-list': 'Elemento de lista',
      quote: 'Escribe una cita...',
      code: 'Escribe codigo...',
      callout: 'Escribe una nota...',
    };
    const tag = block.type.startsWith('heading') ? block.type.replace('heading', 'h') : 'div';
    contentEl = h(tag, {
      className: 'ws-doc-editable',
      contentEditable: 'true',
      spellcheck: 'true',
      'data-block-id': block.id,
      'data-placeholder': placeholder[block.type] || 'Escribe...',
      style: 'flex:1;outline:none;font-size:15px;line-height:1.6;min-height:24px;padding:2px 0',
      onFocus: () => { activeDocEditor = contentEl; rememberDocSelection(contentEl); },
      onMouseup: () => rememberDocSelection(contentEl),
      onKeyup: () => rememberDocSelection(contentEl),
      onInput: (e) => {
        activeDocEditor = contentEl;
        block.html = sanitizeDocHtml(e.target.innerHTML);
        block.content = e.target.textContent || '';
        autoSaveDoc(doc);
        updateMetrics();
      },
      onPaste: (e) => {
        const html = e.clipboardData?.getData('text/html');
        if (!html) return;
        e.preventDefault();
        activeDocEditor = contentEl;
        rememberDocSelection(contentEl);
        insertDocHtml(html);
      },
      onKeydown: (e) => {
        if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          const url = prompt('URL del enlace:');
          if (url) document.execCommand('createLink', false, url);
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          const term = prompt('Buscar en este documento:');
          if (term) { const found = window.find(term); if (!found) toast('No se encontro: ' + term, 'info'); }
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
          e.preventDefault();
          const findTerm = prompt('Buscar:');
          if (!findTerm) return;
          const replaceTerm = prompt('Reemplazar por:');
          if (replaceTerm === null) return;
          let count = 0;
          const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const idx = node.textContent.indexOf(findTerm);
            if (idx !== -1) {
              node.textContent = node.textContent.split(findTerm).join(replaceTerm);
              count++;
            }
          }
          block.content = contentEl.textContent || '';
          block.html = sanitizeDocHtml(contentEl.innerHTML);
          autoSaveDoc(doc);
          toast(count ? count + ' reemplazos realizados' : 'Sin coincidencias', count ? 'success' : 'info');
          return;
        }
        if (e.key === '/' && block.content === '') {
          const slashItems = [
            { label: 'Titulo', type: 'heading1', desc: 'Encabezado grande' },
            { label: 'Subtitulo', type: 'heading2', desc: 'Encabezado mediano' },
            { label: 'Parrafo', type: 'paragraph', desc: 'Texto normal' },
            { label: 'Lista', type: 'list', desc: 'Lista con viñetas' },
            { label: 'Cita', type: 'callout', desc: 'Bloque destacado' },
            { label: 'Separador', type: 'divider', desc: 'Linea horizontal' },
          ];
          let menuEl = null;
          const showSlashMenu = () => {
            hideSlashMenu();
            const rect = contentEl.getBoundingClientRect();
            menuEl = h('div', { className: 'ws-slash-menu', style: 'position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 4) + 'px' });
            const filter = h('input', { type: 'text', className: 'ws-slash-menu-filter', placeholder: 'Filtrar...', autofocus: true });
            menuEl.appendChild(filter);
            const list = h('div', { className: 'ws-slash-menu-list' });
            const renderItems = (query) => {
              list.replaceChildren();
              const q = (query || '').toLowerCase();
              slashItems.filter(item => !q || item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)).forEach(item => {
                const btn = h('button', { className: 'ws-slash-menu-item', type: 'button' },
                  h('span', { className: 'ws-slash-menu-item-label' }, item.label),
                  h('span', { className: 'ws-slash-menu-item-desc' }, item.desc)
                );
                btn.addEventListener('click', () => {
                  block.type = item.type;
                  if (['heading1', 'heading2'].includes(item.type)) block.content = '';
                  hideSlashMenu();
                  renderBlocks();
                });
                list.appendChild(btn);
              });
            };
            renderItems('');
            filter.addEventListener('input', () => renderItems(filter.value));
            filter.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') { hideSlashMenu(); return; }
              const items = list.querySelectorAll('.ws-slash-menu-item');
              if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); }
            });
            menuEl.appendChild(list);
            document.body.appendChild(menuEl);
            filter.focus();
          };
          const hideSlashMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
          showSlashMenu();
          document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target)) hideSlashMenu(); }, { once: true });
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (doc.blocks.length >= getWorkspaceConfig().maxDocumentBlocks) {
            toast(`Límite alcanzado: ${getWorkspaceConfig().maxDocumentBlocks.toLocaleString('es')} bloques`, 'warning');
            return;
          }
          const newBlock = { id: generateId(), type: block.type, content: '' };
          doc.blocks.splice(index + 1, 0, newBlock);
          renderBlocks();
          const newEls = $$('.ws-doc-block [contenteditable]', wrapper.parentNode);
          if (newEls[index + 1]) newEls[index + 1].focus();
        }
        if (e.key === 'Backspace' && block.content === '' && doc.blocks.length > 1) {
          e.preventDefault();
          doc.blocks.splice(index, 1);
          renderBlocks();
        }
      }
    });
    if (block.html) mountDocHtml(contentEl, block.html);
    else if (block.content) contentEl.textContent = block.content;
  }
  wrapper.appendChild(contentEl);
  wrapper.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', index);
    wrapper.classList.add('dragging');
  });
  wrapper.addEventListener('dragend', () => wrapper.classList.remove('dragging'));
  wrapper.addEventListener('dragover', (e) => e.preventDefault());
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'));
    const to = index;
    if (from !== to) {
      const [moved] = doc.blocks.splice(from, 1);
      doc.blocks.splice(to, 0, moved);
      renderBlocks();
      autoSaveDoc(doc);
    }
  });
  return wrapper;
}

function showBlockMenu(anchor, doc, renderBlocks) {
  hideContextMenu();
  const existing = $('.ws-block-menu');
  if (existing) existing.remove();
  const rect = anchor.getBoundingClientRect();
  const menu = h('div', { className: 'ws-block-menu', style: 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px' });
  BLOCK_TYPES.forEach(bt => {
    menu.appendChild(h('div', {
      className: 'ws-block-menu-item',
      onClick: () => {
        if (doc.blocks.length >= getWorkspaceConfig().maxDocumentBlocks) {
          toast(`Límite alcanzado: ${getWorkspaceConfig().maxDocumentBlocks.toLocaleString('es')} bloques`, 'warning');
          menu.remove();
          return;
        }
        const newBlock = { id: generateId(), type: bt.type, content: '' };
        doc.blocks.push(newBlock);
        renderBlocks();
        autoSaveDoc(doc);
        menu.remove();
      }
    },
      h('div', { className: 'item-icon' }, svgIcon(bt.icon, 16)),
      h('div', null,
        h('div', { className: 'item-label' }, bt.label),
        h('div', { className: 'item-desc' }, bt.desc)
      )
    ));
  });
  document.body.appendChild(menu);
  const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function autoSaveDoc(doc) {
  const project = appStore.get('currentProject');
  if (!project) return;
  appStore.set({ isDirty: true });
  clearTimeout(autoSaveDoc._timer);
  autoSaveDoc._timer = setTimeout(() => {
    saveDoc(project.id, doc)
      .then(() => appStore.set({ isDirty: false, lastSaved: Date.now() }))
      .catch(error => reportError(error, 'document-save', {}));
  }, 1000);
}

async function exportDocument() {
  const doc = appStore.get('currentDoc');
  if (!doc) return;
  var bt = '\x60';
  var md = '# ' + (doc.title || 'Documento') + '\n\n';
  (doc.blocks || []).forEach(block => {
    if (block.html && /data-page-break="true"/.test(block.html)) { md += '<div style="page-break-after:always"></div>\n\n'; return; }
    if (block.type === 'divider') { md += '---\n\n'; return; }
    if (block.type === 'heading1') { md += '# ' + (block.content || '') + '\n\n'; return; }
    if (block.type === 'heading2') { md += '## ' + (block.content || '') + '\n\n'; return; }
    if (block.type === 'heading3') { md += '### ' + (block.content || '') + '\n\n'; return; }
    if (block.type === 'quote') { md += '> ' + (block.content || '') + '\n\n'; return; }
    if (block.type === 'code') { md += bt + bt + bt + '\n' + (block.content || '') + '\n' + bt + bt + bt + '\n\n'; return; }
    if (block.type === 'callout') { md += '> **Nota:** ' + (block.content || '') + '\n\n'; return; }
    md += (block.content || '') + '\n\n';
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: (doc.title || 'documento') + '.md' });
  a.click();
  URL.revokeObjectURL(url);
  toast('Documento exportado como Markdown', 'success');
}

// Part 5: Data View, Data Table, Query, Dashboards, Flow
async function createNewDataTable() {
  const project = appStore.get('currentProject');
  if (!project) return;
  const start = Date.now();
  const table = createTableDocument('Tabla sin nombre', project.id);
  const sheet = table.sheets[0];
  sheet.columns = ['Columna 1', 'Columna 2', 'Columna 3'];
  sheet.rows = [['', '', ''], ['', '', ''], ['', '', '']];
  table.headers = sheet.columns;
  table.rows = sheet.rows;
  await saveData(project.id, table);
  _appHistory.push(_captureWorkspaceState(), { action: 'table-create' });
  await registerExecution(project.id, 'table-create', 'Crear tabla', {
    parameters: { title: table.name },
    resultType: 'table-document',
    resultAssetId: table.id,
    startedAt: start,
    status: 'completed',
  });
  await refreshProjectCounts(project.id);
  appStore.set({ currentDataTable: table, currentView: 'data-table' });
  toast('Tabla creada', 'success');
}

function sortDataTable(table, container) {
  if (!table.headers?.length) {
    toast('La tabla no tiene columnas para ordenar', 'warning');
    return;
  }
  const column = h('select', { className: 'ws-input', ariaLabel: 'Columna para ordenar' });
  table.headers.forEach((header, index) => column.appendChild(h('option', { value: String(index), ...(index === 0 ? { selected: true } : {}) }, String(header || 'Columna ' + (index + 1)))));
  const direction = h('select', { className: 'ws-input', ariaLabel: 'Dirección del orden' },
    h('option', { value: 'asc', selected: true }, 'Ascendente · A → Z / menor a mayor'),
    h('option', { value: 'desc' }, 'Descendente · Z → A / mayor a menor')
  );
  showModal({
    title: 'Ordenar tabla',
    body: [
      queryFormField('Columna', column, 'Los números se ordenan como valores; el texto respeta el idioma español.'),
      queryFormField('Dirección', direction),
    ],
    confirmText: 'Ordenar',
    onConfirm: async () => {
      const index = Number(column.value);
      const descending = direction.value === 'desc';
      checkpointTableEdit(table);
      table.rows.sort((left, right) => {
        const a = String(left[index] ?? '');
        const b = String(right[index] ?? '');
        const na = Number(a.replace(',', '.'));
        const nb = Number(b.replace(',', '.'));
        const result = Number.isFinite(na) && Number.isFinite(nb)
          ? na - nb
          : a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
        return descending ? -result : result;
      });
      commitTableEdit(table);
      autoSaveTable(table);
      container.replaceChildren();
      renderDataTableView(container);
      toast('Tabla ordenada', 'success');
    },
    size: 'small',
  });
}

function normalizeDataTable(table, container) {
  checkpointTableEdit(table);
  const taken = new Set();
  table.headers = (table.headers || []).map((header, index) => {
    const base = String(header || '').trim() || 'Columna ' + (index + 1);
    let value = base;
    let suffix = 2;
    while (taken.has(value.toLocaleLowerCase('es'))) value = base + ' ' + suffix++;
    taken.add(value.toLocaleLowerCase('es'));
    return value;
  });
  table.rows = (table.rows || []).map(row => table.headers.map((_, index) => String(row?.[index] ?? '').trim()));
  table.columnTypes = table.headers.map((_, index) => queryColumnType(table.rows, index));
  commitTableEdit(table);
  autoSaveTable(table);
  container.replaceChildren();
  renderDataTableView(container);
  toast('Datos normalizados y tipos detectados', 'success');
}

function openDataTableInsights(table) {
  const rows = table.rows || [];
  const cells = rows.length * (table.headers || []).length;
  const empty = rows.reduce((total, row) => total + row.filter(value => String(value ?? '').trim() === '').length, 0);
  const duplicates = rows.length - new Set(rows.map(row => JSON.stringify(row))).size;
  const numeric = (table.headers || []).filter((_, index) => queryColumnType(rows, index) === '123').length;
  showModal({
    title: 'Perfil de la tabla',
    content: h('div', { className: 'ws-table-insights-grid' },
      h('div', null, h('strong', null, rows.length.toLocaleString('es')), h('span', null, 'filas')),
      h('div', null, h('strong', null, (table.headers || []).length.toLocaleString('es')), h('span', null, 'columnas')),
      h('div', null, h('strong', null, cells.toLocaleString('es')), h('span', null, 'celdas')),
      h('div', null, h('strong', null, empty.toLocaleString('es')), h('span', null, 'vacías')),
      h('div', null, h('strong', null, duplicates.toLocaleString('es')), h('span', null, 'duplicadas')),
      h('div', null, h('strong', null, numeric.toLocaleString('es')), h('span', null, 'numéricas'))
    ),
    confirmText: 'Cerrar',
    size: 'small',
  });
}

function sendDataTableToQuery() {
  navigateTo('query');
  toast('Tabla abierta en Toolisto Query', 'info');
}

function dataWorkbookId(table) {
  return table?.workbookId || table?.id;
}

async function createNewDataSheet(table, container) {
  const project = appStore.get('currentProject');
  if (!project || !table) return;
  const workbookId = dataWorkbookId(table);
  const allTables = appStore.get('dataTables') || [];
  const sheets = [table, ...allTables].filter((item, index, list) => {
    return dataWorkbookId(item) === workbookId && list.findIndex(candidate => candidate.id === item.id) === index;
  });
  const nextNumber = sheets.length + 1;
  if (!table.workbookId) {
    table.workbookId = workbookId;
    await saveData(project.id, table);
  }
  const sheet = {
    id: generateId(),
    projectId: project.id,
    workbookId,
    name: 'Hoja ' + nextNumber,
    headers: [...(table.headers || [])],
    rows: [new Array((table.headers || []).length).fill('')],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveData(project.id, sheet);
  await refreshProjectCounts(project.id);
  const tables = await loadData(project.id);
  appStore.set({ dataTables: tables, currentDataTable: sheet });
  container.replaceChildren();
  renderDataTableView(container);
  toast('Hoja creada: ' + sheet.name, 'success');
}

async function duplicateDataSheet(sheet, container) {
  const project = appStore.get('currentProject');
  if (!project || !sheet) return;
  const newSheet = {
    id: generateId(),
    projectId: project.id,
    workbookId: sheet.workbookId,
    name: (sheet.name || 'Hoja') + ' (copia)',
    headers: [...(sheet.headers || [])],
    rows: (sheet.rows || []).map(row => [...row]),
    columnTypes: sheet.columnTypes ? { ...sheet.columnTypes } : undefined,
    cellConfidence: sheet.cellConfidence ? sheet.cellConfidence.map(r => [...r]) : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveData(project.id, newSheet);
  await refreshProjectCounts(project.id);
  const tables = await loadData(project.id);
  appStore.set({ dataTables: tables, currentDataTable: newSheet });
  container.replaceChildren();
  renderDataTableView(container);
  toast('Hoja duplicada: ' + newSheet.name, 'success');
}

async function deleteDataSheet(sheet, container) {
  const project = appStore.get('currentProject');
  if (!project || !sheet) return;
  const allTables = appStore.get('dataTables') || [];
  const workbookId = dataWorkbookId(sheet);
  const siblings = [sheet, ...allTables].filter((item, index, list) => {
    return dataWorkbookId(item) === workbookId && list.findIndex(c => c.id === item.id) === index;
  });
  if (siblings.length <= 1) {
    toast('No puedes eliminar la ultima hoja del libro', 'warning');
    return;
  }
  showConfirm({
    title: 'Eliminar hoja "' + (sheet.name || 'Hoja') + '"',
    body: 'Esta accion es permanente. Se perderan todos los datos de esta hoja.',
    confirmText: 'Eliminar',
    onConfirm: async () => {
      await deleteData(project.id, sheet.id);
      await refreshProjectCounts(project.id);
      const tables = await loadData(project.id);
      const next = [sheet, ...tables].filter((item, index, list) => {
        return dataWorkbookId(item) === workbookId && list.findIndex(c => c.id === item.id) === index;
      }).find(t => t.id !== sheet.id) || null;
      appStore.set({ dataTables: tables, currentDataTable: next });
      container.replaceChildren();
      if (next) renderDataTableView(container);
      else navigateTo('data');
      toast('Hoja eliminada', 'success');
    }
  });
}

function renderDataView(container, project) {
  const tables = appStore.get('dataTables');
  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease' });
  el.appendChild(h('div', { className: 'hero' },
    h('h1', null, 'Datos'),
    h('p', null, 'Gestiona las tablas de datos de ' + project.name)
  ));
  if (tables.length === 0) {
    el.appendChild(h('div', { className: 'ws-empty' },
      h('div', { className: 'ws-empty-icon' }, svgIcon('table', 28)),
      h('div', { className: 'ws-empty-title' }, 'Sin tablas'),
      h('div', { className: 'ws-empty-text' }, 'Crea una tabla nueva o importa un archivo CSV.'),
      h('button', { className: 'ws-btn ws-btn-primary', onClick: createNewDataTable }, svgIcon('plus'), ' Nueva Tabla'),
      h('button', { className: 'ws-btn ws-btn-secondary', style: 'margin-left:8px', onClick: importCSV }, svgIcon('upload'), ' Importar CSV')
    ));
  } else {
    const grid = h('div', { className: 'ws-card-grid' });
    tables.forEach(table => {
      const card = h('div', { className: 'ws-card', style: 'cursor:pointer', onClick: () => {
        appStore.set({ currentDataTable: table, currentView: 'data-table' });
      }});
      card.appendChild(h('div', { style: 'font-weight:500;font-size:14px;margin-bottom:4px' }, table.name || 'Tabla sin nombre'));
      card.appendChild(h('div', { style: 'font-size:12px;color:var(--ws-text-secondary);margin-bottom:2px' }, (table.rows ? table.rows.length : 0) + ' filas, ' + (table.headers ? table.headers.length : 0) + ' columnas'));
      card.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-tertiary)' }, formatTimeAgo(table.updatedAt)));
      const delBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: async (e) => {
        e.stopPropagation();
        showConfirm({
          title: 'Eliminar tabla',
          message: 'La tabla y sus datos se quitarán de este proyecto.',
          confirmText: 'Eliminar tabla',
          onConfirm: async () => {
          await deleteData(table.id);
          const remaining = tables.filter(t => t.id !== table.id);
          appStore.set({ dataTables: remaining });
          renderView('data');
          toast('Tabla eliminada', 'success');
          },
        });
      } }, svgIcon('trash'));
      const chartBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: (e) => {
        e.stopPropagation();
        createChartFromTable(project, table);
      } }, svgIcon('chart'), ' Gráfico');
      const flowBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: (e) => {
        e.stopPropagation();
        startWorkflowFromWorkspace({ id: 'table-' + table.id, name: table.name || 'Tabla', kind: 'data' });
      } }, svgIcon('flow'), ' Encadenar');
      card.appendChild(h('div', { style: 'margin-top:8px;display:flex;gap:4px' }, chartBtn, flowBtn, delBtn));
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }
  container.appendChild(el);
  loadData(project.id).then(t => {
    appStore.set({ dataTables: t });
    if (tables.length !== t.length) {
      container.replaceChildren();
      renderDataView(container, project);
    }
  });
}

async function renderModelView(container, project) {
  container.replaceChildren(h('div', { className: 'ws-model-loading' }, 'Cargando modelo de datos...'));
  try {
    const tables = await loadData(project.id);
    const saved = await loadDataModel(project.id);
    const model = normalizeDataModel(project, tables, saved);
    const before = JSON.stringify(model.relationships);
    model.relationships = detectDataModelRelationships(tables, model.relationships);
    if (!saved || before !== JSON.stringify(model.relationships)) await saveDataModel(project.id, model);
    renderModelEditor(container, project, tables, model);
  } catch (error) {
    reportError(error, 'model-load', {});
    container.replaceChildren(h('div', { className: 'ws-model-empty' },
      h('div', { className: 'ws-empty-icon' }, svgIcon('warning', 24)),
      h('h2', null, 'No se pudo cargar el modelo'),
      h('p', null, 'El modelo no se pudo leer desde el almacenamiento local. Puedes volver a intentarlo.'),
      h('button', { className: 'ws-btn ws-btn-secondary', onClick: () => renderModelView(container, project) }, svgIcon('rotate', 14), ' Reintentar')
    ));
  }
}

function renderModelEditor(container, project, tables, model) {
  let selectedTableId = model.nodes[0]?.tableId || tables[0]?.id || null;
  let saveStatus = model.updatedAt ? 'Modelo cargado desde este navegador' : 'Modelo nuevo';
  const persist = async (message = 'Modelo guardado') => {
    model.updatedAt = Date.now();
    await saveDataModel(project.id, model);
    saveStatus = message;
    toast(message, 'success');
  };
  const render = () => {
    container.replaceChildren();
    const selectedTable = tables.find(table => table.id === selectedTableId) || null;
    const selectedNode = model.nodes.find(node => node.tableId === selectedTableId);
    const shell = h('div', { className: 'ws-model-shell' });
    shell.appendChild(h('div', { className: 'ws-model-header' },
      h('div', { className: 'ws-model-title-block' }, h('h1', null, 'Modelo de datos'), h('p', null, 'Visualiza las tablas del proyecto, revisa sus campos y conserva las relaciones detectadas en este navegador.')),
      h('div', { className: 'ws-model-header-actions' },
        h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: async () => { model.relationships = detectDataModelRelationships(tables, model.relationships); await persist('Relaciones actualizadas'); render(); } }, svgIcon('rotate', 14), ' Detectar relaciones'),
        h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: () => persist() }, svgIcon('save', 14), ' Guardar modelo')
      )
    ));
    const detected = model.relationships.filter(relation => relation.detected).length;
    shell.appendChild(h('div', { className: 'ws-model-summary' },
      h('div', null, h('strong', null, String(tables.length)), h('span', null, 'Tablas')),
      h('div', null, h('strong', null, String(tables.reduce((total, table) => total + (table.headers || []).length, 0))), h('span', null, 'Campos')),
      h('div', null, h('strong', null, String(model.relationships.length)), h('span', null, 'Relaciones')),
      h('div', { className: 'ws-model-summary-note' }, svgIcon(detected ? 'check' : 'info', 15), h('span', null, detected ? `${detected} relaciones sugeridas por nombres de campos` : 'No hay relaciones detectadas todavía'))
    ));
    const workspace = h('div', { className: 'ws-model-workspace' });
    workspace.appendChild(h('aside', { className: 'ws-model-sidebar' },
      h('div', { className: 'ws-model-panel-heading' }, h('strong', null, 'Tablas'), h('span', null, String(tables.length))),
      h('p', { className: 'ws-model-panel-help' }, 'Selecciona una tabla para inspeccionarla. Arrastra sus tarjetas en el lienzo.'),
      h('div', { className: 'ws-model-table-list' }, ...tables.map(table => h('button', { className: 'ws-model-table-item' + (table.id === selectedTableId ? ' active' : ''), onClick: () => { selectedTableId = table.id; render(); } },
        h('span', { className: 'ws-model-table-item-icon' }, svgIcon('table', 13)),
        h('span', { className: 'ws-model-table-item-copy' }, h('strong', null, table.name || 'Tabla sin nombre'), h('small', null, modelFieldMeta(table).length + ' campos')),
        h('span', { className: 'ws-model-table-item-count' }, String((table.rows || []).length))
      ))),
      tables.length ? null : h('div', { className: 'ws-model-panel-empty' }, 'Crea una tabla desde Datos para comenzar.'),
      h('button', { className: 'ws-model-panel-link', onClick: () => navigateTo('data') }, svgIcon('table', 13), ' Ir a Datos')
    ));

    const canvas = h('section', { className: 'ws-model-canvas', ariaLabel: 'Lienzo del modelo de datos' });
    const inner = h('div', { className: 'ws-model-canvas-inner' });
    const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    links.setAttribute('class', 'ws-model-links'); links.setAttribute('viewBox', '0 0 980 640'); links.setAttribute('width', '980'); links.setAttribute('height', '640');
    inner.appendChild(links);
    const drawLinks = () => {
      links.replaceChildren();
      model.relationships.forEach(relation => {
        const from = model.nodes.find(node => node.tableId === relation.fromTableId);
        const to = model.nodes.find(node => node.tableId === relation.toTableId);
        if (!from || !to) return;
        const startX = from.x + 232; const startY = from.y + 42; const endX = to.x; const endY = to.y + 42;
        const bend = Math.max(34, Math.abs(endX - startX) * .35);
        makeSvgNode('path', { class: 'ws-model-link' + (relation.active === false ? ' is-inactive' : ''), d: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}` }, links);
      });
    };
    tables.forEach(table => {
      const nodeState = model.nodes.find(node => node.tableId === table.id);
      if (!nodeState) return;
      const fields = modelFieldMeta(table);
      const node = h('article', { className: 'ws-model-table-node' + (table.id === selectedTableId ? ' is-selected' : ''), style: `left:${nodeState.x}px;top:${nodeState.y}px` });
      const toggle = h('button', { className: 'ws-model-node-toggle', type: 'button', ariaLabel: nodeState.collapsed ? 'Mostrar campos' : 'Ocultar campos', onClick: event => { event.stopPropagation(); nodeState.collapsed = !nodeState.collapsed; render(); } }, svgIcon(nodeState.collapsed ? 'chevronDown' : 'chevronUp', 13));
      node.appendChild(h('div', { className: 'ws-model-node-header', onClick: () => { selectedTableId = table.id; render(); } }, h('span', { className: 'ws-model-node-icon' }, svgIcon('table', 13)), h('span', { className: 'ws-model-node-title' }, h('strong', null, table.name || 'Tabla sin nombre'), h('small', null, (table.rows || []).length + ' filas')), toggle));
      const fieldList = h('div', { className: 'ws-model-node-fields' });
      const visible = nodeState.collapsed ? [] : fields.slice(0, 12);
      visible.forEach(field => fieldList.appendChild(h('div', { className: 'ws-model-field' }, h('span', { className: 'ws-model-field-key' }, field.isKey ? '◆' : '·'), h('span', { className: 'ws-model-field-name' }, field.name), h('span', { className: 'ws-model-field-type' }, field.type))));
      if (nodeState.collapsed) fieldList.appendChild(h('span', { className: 'ws-model-node-collapsed' }, 'Campos ocultos'));
      else if (fields.length > visible.length) fieldList.appendChild(h('span', { className: 'ws-model-more-fields' }, `+ ${fields.length - visible.length} campos`));
      node.appendChild(fieldList);
      node.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        event.preventDefault(); selectedTableId = table.id; node.classList.add('is-dragging');
        const originX = event.clientX; const originY = event.clientY; const startX = nodeState.x; const startY = nodeState.y;
        const move = moveEvent => { nodeState.x = Math.max(0, Math.round(startX + moveEvent.clientX - originX)); nodeState.y = Math.max(0, Math.round(startY + moveEvent.clientY - originY)); node.style.left = nodeState.x + 'px'; node.style.top = nodeState.y + 'px'; drawLinks(); };
        const up = () => { node.classList.remove('is-dragging'); window.removeEventListener('pointermove', move); persist('Posición guardada').catch(error => reportError(error, 'model-save', {})); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
      });
      inner.appendChild(node);
    });
    drawLinks();
    if (!tables.length) inner.appendChild(h('div', { className: 'ws-model-canvas-empty' }, h('div', { className: 'ws-model-empty-icon' }, svgIcon('table', 24)), h('h2', null, 'Tu lienzo está vacío'), h('p', null, 'Crea o importa una tabla para empezar a construir el modelo del proyecto.'), h('button', { className: 'ws-btn ws-btn-primary', onClick: () => navigateTo('data') }, svgIcon('plus', 14), ' Crear tabla')));
    canvas.appendChild(inner); workspace.appendChild(canvas);

    const inspector = h('aside', { className: 'ws-model-inspector' }, h('div', { className: 'ws-model-panel-heading' }, h('strong', null, 'Inspector'), h('span', null, selectedTable ? 'Tabla' : 'Modelo')));
    if (selectedTable && selectedNode) {
      const fields = modelFieldMeta(selectedTable);
      inspector.appendChild(h('div', { className: 'ws-model-inspector-table' },
        h('div', { className: 'ws-model-inspector-title' },
          svgIcon('table', 13),
          h('strong', null, selectedTable.name || 'Tabla sin nombre')
        ),
        h('p', null, `${(selectedTable.rows || []).length} filas · ${fields.length} campos`),
        h('div', { className: 'ws-model-inspector-fields' }, ...fields.map(field => h('div', { className: 'ws-model-inspector-field' }, h('span', null, (field.isKey ? '◆ ' : '') + field.name), h('small', null, field.type))))
      ));
    }
    const related = model.relationships.filter(relation => relation.fromTableId === selectedTableId || relation.toTableId === selectedTableId);
    inspector.appendChild(h('div', { className: 'ws-model-inspector-divider' }), h('div', { className: 'ws-model-panel-heading' }, h('strong', null, 'Relaciones'), h('span', null, String(related.length))));
    const relationList = h('div', { className: 'ws-model-relations-list' });
    related.forEach(relation => {
      const relationItem = h('div', { className: 'ws-model-relation-item' },
        h('div', { className: 'ws-model-relation-copy' },
          h('strong', null, modelRelationshipTitle(relation, tables)),
          h('small', null, relation.cardinality + (relation.detected ? ' · sugerida' : ''))
        ),
        h('button', {
          className: 'ws-model-relation-delete',
          type: 'button',
          ariaLabel: 'Eliminar relación',
          onClick: async () => {
            model.relationships = model.relationships.filter(item => item.id !== relation.id);
            await persist('Relación eliminada');
            render();
          },
        }, svgIcon('trash', 12))
      );
      relationList.appendChild(relationItem);
    });
    if (!related.length) relationList.appendChild(h('div', { className: 'ws-model-panel-empty' }, 'Pulsa Detectar relaciones para buscar vínculos por nombres de campos.'));
    inspector.appendChild(relationList); workspace.appendChild(inspector);
    shell.appendChild(workspace); shell.appendChild(h('div', { className: 'ws-model-footer' }, h('span', null, svgIcon('database', 12), saveStatus), h('span', null, model.relationships.length + ' relaciones guardadas'))); container.appendChild(shell);
  };
  render();
}

function importCSV() {
  const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const validation = validateWorkspaceFile(file, ['.csv', '.tsv', '.txt']);
    if (!validation.ok) { toast(validation.message, 'warning'); return; }
    const text = await file.text();
    const sep = detectCSVSeparator(text);
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 1) { toast('Archivo vacio', 'warning'); return; }
    const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    const config = getWorkspaceConfig();
    if (headers.length > config.maxTableColumns || rows.length > config.maxTableRows) {
      toast(`El archivo supera el límite de ${config.maxTableRows.toLocaleString('es')} filas o ${config.maxTableColumns} columnas`, 'warning');
      return;
    }
    const project = appStore.get('currentProject');
    if (!project) { toast('Selecciona un proyecto primero', 'warning'); return; }
    const table = {
      id: generateId(),
      projectId: project.id,
      name: file.name.replace(/\.csv$|\.tsv$|\.txt$/i, ''),
      headers,
      rows,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveData(project.id, table);
    await refreshProjectCounts(project.id);
    appStore.set({ currentDataTable: table, currentView: 'data-table' });
    toast('CSV importado: ' + rows.length + ' filas', 'success');
  });
  input.click();
}

function detectCSVSeparator(text) {
  var firstLine = text.split('\n')[0];
  var counts = { ',': 0, '\t': 0, ';': 0 };
  for (var i = 0; i < firstLine.length; i++) {
    var ch = firstLine[i];
    if (ch === ',') counts[',']++;
    else if (ch === '\t') counts['\t']++;
    else if (ch === ';') counts[';']++;
  }
  var max = 0, sep = ',';
  for (var k in counts) {
    if (counts[k] > max) { max = counts[k]; sep = k; }
  }
  return sep;
}

function columnNameToIndex(name) {
  let index = 0;
  for (const char of name.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function indexToColumnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellReferenceToPosition(reference) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference.trim());
  if (!match) return null;
  return { row: Number(match[2]) - 1, col: columnNameToIndex(match[1]) };
}

function numericValue(value) {
  return parseLocaleNumber(value) ?? 0;
}

function safeArithmetic(expression) {
  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/()]|\s+/g) || [];
  const compact = tokens.join('');
  if (compact.replace(/[\d+\-*/().\s]/g, '')) return '';
  let position = 0;
  const skip = () => { while (/\s/.test(tokens[position] || '')) position++; };
  const parsePrimary = () => {
    skip();
    if (tokens[position] === '(') {
      position++;
      const result = parseExpression();
      skip();
      if (tokens[position] === ')') position++;
      return result;
    }
    const value = Number(tokens[position]);
    position++;
    return Number.isFinite(value) ? value : 0;
  };
  const parseTerm = () => {
    let value = parsePrimary();
    while (true) {
      skip();
      const operator = tokens[position];
      if (operator !== '*' && operator !== '/') break;
      position++;
      const right = parsePrimary();
      value = operator === '*' ? value * right : (right === 0 ? 0 : value / right);
    }
    return value;
  };
  function parseExpression() {
    let value = parseTerm();
    while (true) {
      skip();
      const operator = tokens[position];
      if (operator !== '+' && operator !== '-') break;
      position++;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = parseExpression();
  skip();
  return position >= tokens.length && Number.isFinite(result) ? result : '';
}

function evaluateDataFormula(table, formula, stack = []) {
  const rawFormula = String(formula || '').trim();
  if (!rawFormula.startsWith('=')) return rawFormula;
  const body = rawFormula.slice(1).trim();
  const rawCellValue = (reference) => {
    const position = cellReferenceToPosition(reference);
    if (!position || position.row < 0 || position.col < 0) return '';
    return table.rows?.[position.row]?.[position.col] ?? '';
  };
  const resolveCell = (reference) => {
    const position = cellReferenceToPosition(reference);
    if (!position || position.row < 0 || position.col < 0) return 0;
    const key = `${position.row}:${position.col}`;
    if (stack.includes(key)) return 0;
    const raw = rawCellValue(reference);
    return String(raw).trim().startsWith('=') ? numericValue(evaluateDataFormula(table, raw, [...stack, key])) : numericValue(raw);
  };
  const valuesFromArgument = (argument) => {
    const range = argument.trim().split(':').map(cellReferenceToPosition);
    if (range.length === 2 && range[0] && range[1]) {
      const values = [];
      for (let row = Math.min(range[0].row, range[1].row); row <= Math.max(range[0].row, range[1].row); row++) {
        for (let col = Math.min(range[0].col, range[1].col); col <= Math.max(range[0].col, range[1].col); col++) {
          values.push(resolveCell(indexToColumnName(col) + (row + 1)));
        }
      }
      return values;
    }
    return argument.split(',').map(item => resolveCell(item));
  };
  const rawValuesFromArgument = (argument) => {
    const range = argument.trim().split(':').map(cellReferenceToPosition);
    if (range.length === 2 && range[0] && range[1]) {
      const values = [];
      for (let row = Math.min(range[0].row, range[1].row); row <= Math.max(range[0].row, range[1].row); row++) {
        for (let col = Math.min(range[0].col, range[1].col); col <= Math.max(range[0].col, range[1].col); col++) {
          values.push(rawCellValue(indexToColumnName(col) + (row + 1)));
        }
      }
      return values;
    }
    return argument.split(',').map(item => rawCellValue(item));
  };
  let expression = body.replace(/\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT|COUNTA)\s*\(([^()]*)\)/gi, (_match, functionName, argument) => {
    const values = valuesFromArgument(argument);
    const numbers = values.map(value => {
      const parsed = Number(String(value).replace(',', '.'));
      return String(value).trim() !== '' && Number.isFinite(parsed) ? parsed : null;
    }).filter(value => value !== null);
    const name = functionName.toUpperCase();
    if (name === 'COUNT') return String(numbers.length);
    if (name === 'COUNTA') return String(rawValuesFromArgument(argument).filter(value => String(value).trim() !== '').length);
    if (name === 'MIN') return String(numbers.length ? Math.min(...numbers) : 0);
    if (name === 'MAX') return String(numbers.length ? Math.max(...numbers) : 0);
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return String(name === 'AVERAGE' || name === 'AVG' ? (numbers.length ? total / numbers.length : 0) : total);
  });
  expression = expression.replace(/\b([A-Z]+\d+)\b/gi, reference => String(resolveCell(reference)));
  const result = safeArithmetic(expression);
  return result === '' ? '#FORMULA' : String(Number(result.toFixed(8)));
}

const tableHistories = new WeakMap();

function snapshotDataTable(table) {
  return {
    headers: [...(table.headers || [])],
    rows: (table.rows || []).map(row => [...row]),
  };
}

function snapshotKey(snapshot) {
  return JSON.stringify(snapshot);
}

function ensureTableHistory(table) {
  let history = tableHistories.get(table);
  if (!history) {
    history = { past: [snapshotDataTable(table)], future: [] };
    tableHistories.set(table, history);
  }
  return history;
}

function commitTableEdit(table) {
  const history = ensureTableHistory(table);
  const next = snapshotDataTable(table);
  const current = history.past[history.past.length - 1];
  if (snapshotKey(current) !== snapshotKey(next)) history.past.push(next);
  history.future = [];
}

function restoreTableSnapshot(table, snapshot) {
  table.headers = [...snapshot.headers];
  table.rows = snapshot.rows.map(row => [...row]);
  autoSaveTable(table);
}

function undoTableEdit(table) {
  const history = ensureTableHistory(table);
  if (history.past.length <= 1) {
    toast('No hay cambios para deshacer', 'info');
    return false;
  }
  const current = history.past.pop();
  history.future.push(current);
  restoreTableSnapshot(table, history.past[history.past.length - 1]);
  return true;
}

function redoTableEdit(table) {
  const history = ensureTableHistory(table);
  const next = history.future.pop();
  if (!next) {
    toast('No hay cambios para rehacer', 'info');
    return false;
  }
  history.past.push(next);
  restoreTableSnapshot(table, next);
  return true;
}

function tableSelectionBounds(selection) {
  return {
    top: Math.min(selection.anchorRow, selection.focusRow),
    bottom: Math.max(selection.anchorRow, selection.focusRow),
    left: Math.min(selection.anchorCol, selection.focusCol),
    right: Math.max(selection.anchorCol, selection.focusCol),
  };
}

function markTableSelection(tableEl, selection) {
  const bounds = tableSelectionBounds(selection);
  $$('td[data-row][data-col]', tableEl).forEach(cell => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const active = row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right;
    cell.classList.toggle('selected', active);
    cell.classList.toggle('selected-focus', row === selection.focusRow && col === selection.focusCol);
  });
}

function selectedTableTsv(table, selection) {
  const bounds = tableSelectionBounds(selection);
  return Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, rowOffset) =>
    Array.from({ length: bounds.right - bounds.left + 1 }, (_, colOffset) => String(table.rows[bounds.top + rowOffset]?.[bounds.left + colOffset] ?? '')).join('\t')
  ).join('\n');
}

async function copyTableSelection(table, selection, cut = false) {
  const text = selectedTableTsv(table, selection);
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (error) {}
  if (copied && cut) {
    const bounds = tableSelectionBounds(selection);
    checkpointTableEdit(table);
    for (let row = bounds.top; row <= bounds.bottom; row++) {
      for (let col = bounds.left; col <= bounds.right; col++) table.rows[row][col] = '';
    }
    commitTableEdit(table);
    autoSaveTable(table);
  }
  toast(copied ? (cut ? 'Celdas cortadas' : 'Celdas copiadas') : 'El navegador bloqueó el portapapeles', copied ? 'success' : 'warning');
  return copied;
}

function checkpointTableEdit(table) {
  const history = ensureTableHistory(table);
  const current = snapshotDataTable(table);
  if (snapshotKey(history.past[history.past.length - 1]) !== snapshotKey(current)) history.past.push(current);
  history.future = [];
}

function parseClipboardGrid(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const lines = normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
  return lines.map(line => line.split('\t').map(cell => cell));
}

function applyClipboardGrid(table, selection, text, container) {
  const grid = parseClipboardGrid(text);
  if (!grid.length || !grid[0]?.length) return false;
  const config = getWorkspaceConfig();
  const cellCount = grid.length * Math.max(...grid.map(row => row.length));
  if (cellCount > config.maxClipboardCells) {
    toast(`El pegado supera el límite de ${config.maxClipboardCells.toLocaleString('es')} celdas`, 'warning');
    return false;
  }
  const startRow = selection.focusRow;
  const startCol = selection.focusCol;
  const width = Math.max(...grid.map(row => row.length));
  const requiredRows = Math.max(table.rows.length, startRow + grid.length);
  const requiredColumns = Math.max(table.headers.length, startCol + width);
  if (requiredRows > config.maxTableRows || requiredColumns > config.maxTableColumns) {
    toast(`El pegado supera el límite configurado de ${config.maxTableRows.toLocaleString('es')} filas o ${config.maxTableColumns} columnas`, 'warning');
    return false;
  }
  checkpointTableEdit(table);
  while (table.headers.length < requiredColumns) table.headers.push('Columna ' + (table.headers.length + 1));
  while (table.rows.length < requiredRows) table.rows.push(new Array(table.headers.length).fill(''));
  table.rows.forEach(row => { while (row.length < table.headers.length) row.push(''); });
  grid.forEach((row, rowOffset) => row.forEach((value, colOffset) => {
    table.rows[startRow + rowOffset][startCol + colOffset] = value;
  }));
  commitTableEdit(table);
  autoSaveTable(table);
  container.replaceChildren();
  renderDataTableView(container);
  toast(`${cellCount.toLocaleString('es')} celdas pegadas`, 'success');
  return true;
}

function startCellEdit(table, ri, ci, tableEl, selection, container, rerenderFn, initialKey) {
  const td = tableEl.querySelector(`td[data-row="${ri}"][data-col="${ci}"]`);
  if (!td) return;
  const rawCell = String(table.rows[ri]?.[ci] ?? '');
  checkpointTableEdit(table);
  td.classList.add('editing');
  let draftValue = initialKey != null ? initialKey : rawCell;
  let finished = false;
  const finishEdit = (save) => {
    if (finished) return;
    finished = true;
    const value = save ? draftValue : rawCell;
    table.rows[ri][ci] = value;
    td.classList.remove('editing');
    td.textContent = String(value).trim().startsWith('=') ? evaluateDataFormula(table, value) : value;
    if (save) { commitTableEdit(table); autoSaveTable(table); }
  };
  const input = h('input', {
    type: 'text',
    value: initialKey != null ? initialKey : rawCell,
    style: 'width:100%;height:100%;border:2px solid var(--ws-primary);border-radius:0;padding:5px 10px;font-family:var(--ws-font);font-size:13px;background:var(--ws-surface);color:var(--ws-text);outline:none',
    onInput: (e) => { draftValue = e.target.value; },
    onKeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); const nextRow = e.shiftKey ? Math.max(0, ri - 1) : Math.min(table.rows.length - 1, ri + 1); selection.hasValue = false; selection.anchorRow = nextRow; selection.anchorCol = ci; selection.focusRow = nextRow; selection.focusCol = ci; selection.hasValue = true; markTableSelection(tableEl, selection); tableEl.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
      if (e.key === 'Tab') { e.preventDefault(); finishEdit(true); const nextCol = e.shiftKey ? Math.max(0, ci - 1) : Math.min(table.headers.length - 1, ci + 1); selection.hasValue = false; selection.anchorRow = ri; selection.anchorCol = nextCol; selection.focusRow = ri; selection.focusCol = nextCol; selection.hasValue = true; markTableSelection(tableEl, selection); tableEl.focus(); }
    },
    onblur: () => finishEdit(true)
  });
  td.textContent = '';
  td.appendChild(input);
  if (initialKey != null) { input.value = initialKey; input.setSelectionRange(1, 1); }
  else { input.select(); }
  input.focus();
}

function renderDataTableView(container) {
  const table = appStore.get('currentDataTable');
  if (!table) return;
  ensureTableHistory(table);
  const config = getWorkspaceConfig();
  const selectedCell = { row: -1, col: -1 };
  const selection = { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0, hasValue: false };
  const el = h('div', { className: 'ws-data-layout', style: 'animation:fadeIn 0.3s ease' });
  const toolbar = h('div', { className: 'ws-data-toolbar', role: 'toolbar', ariaLabel: 'Herramientas de la tabla' });
  const toolbarTop = h('div', { className: 'ws-data-toolbar-top' });
  toolbarTop.appendChild(h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => navigateTo('data') }, svgIcon('back'), ' Volver'));
  const nameInput = h('input', {
    type: 'text',
    value: table.name || '',
    className: 'ws-data-name-input',
    placeholder: 'Nombre de la tabla',
    onInput: (e) => { table.name = e.target.value; autoSaveTable(table); }
  });
  toolbarTop.appendChild(nameInput);
  const reviewStatus = dataReviewStatus(table);
  toolbarTop.appendChild(h('span', {
    className: 'ws-status-chip ws-review-' + reviewStatus,
    title: 'Estado de revision de la tabla. Las celdas con confianza baja deben revisarse antes de crear graficos o informes.'
  }, 'Estado: ' + formatReviewStatus(reviewStatus)));
  toolbarTop.appendChild(h('button', {
    className: 'ws-btn ws-btn-ghost ws-btn-sm',
    title: 'Revisar tabla, celdas con confianza baja y ver el origen',
    onClick: () => { const stats = tableReviewStats(table); if (stats.lowCount > 0) showTableReviewModal(table, stats); else openTableImageCompare(table); }
  }, svgIcon('eye'), ' Revisar'));
  toolbarTop.appendChild(h('span', { className: 'ws-data-toolbar-context' }, `${(table.rows || []).length.toLocaleString('es')} filas · ${(table.headers || []).length} columnas`));
  toolbar.appendChild(toolbarTop);
  const ribbonTabs = h('div', { className: 'ws-data-ribbon-tabs', role: 'tablist', ariaLabel: 'Pestañas de tabla' },
    h('span', { className: 'ws-data-ribbon-kicker' }, 'TABLA / LOCAL'),
    h('button', { className: 'ws-data-ribbon-tab active', type: 'button', role: 'tab', id: 'ws-data-tab-Inicio', 'aria-controls': 'ws-data-ribbon-panel', 'aria-selected': 'true' }, 'Inicio'),
    h('button', { className: 'ws-data-ribbon-tab', type: 'button', role: 'tab', id: 'ws-data-tab-Datos', 'aria-controls': 'ws-data-ribbon-panel', 'aria-selected': 'false', title: 'Acciones de datos y columnas' }, 'Datos'),
    h('button', { className: 'ws-data-ribbon-tab', type: 'button', role: 'tab', id: 'ws-data-tab-Formulas', 'aria-controls': 'ws-data-ribbon-panel', 'aria-selected': 'false', title: 'Funciones de calculo' }, 'Formulas'),
    h('button', { className: 'ws-data-ribbon-tab', type: 'button', role: 'tab', id: 'ws-data-tab-Vista', 'aria-controls': 'ws-data-ribbon-panel', 'aria-selected': 'false', title: 'Opciones de visualizacion' }, 'Vista'),
    h('button', { className: 'ws-data-ribbon-tab', type: 'button', role: 'tab', id: 'ws-data-tab-Insertar', 'aria-controls': 'ws-data-ribbon-panel', 'aria-selected': 'false', title: 'Crear salidas a partir de esta tabla' }, 'Insertar'),
  );
  toolbar.appendChild(ribbonTabs);
  const ribbonPanel = h('div', { className: 'ws-data-ribbon-panel', role: 'tabpanel', id: 'ws-data-ribbon-panel', 'aria-labelledby': 'ws-data-tab-Inicio' });
  const toolbarGroup = (label, pages, ...items) => ribbonPanel.appendChild(h('div', {
    className: 'ws-data-tool-group',
    'data-ribbon-group': label,
    'data-ribbon-pages': pages.join(' ')
  }, h('span', { className: 'ws-data-tool-group-label' }, label), h('div', { className: 'ws-data-tool-group-items' }, ...items)));
  const rerenderTable = () => { container.replaceChildren(); renderDataTableView(container); };
  toolbarGroup('Portapapeles', ['Inicio'],
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Deshacer · Ctrl Z', onClick: () => { if (undoTableEdit(table)) { rerenderTable(); toast('Cambio deshecho', 'success'); } } }, svgIcon('undo'), ' Deshacer'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Rehacer · Ctrl Y', onClick: () => { if (redoTableEdit(table)) { rerenderTable(); toast('Cambio rehecho', 'success'); } } }, svgIcon('redo'), ' Rehacer'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Copiar la selección · Ctrl C', onClick: () => copyTableSelection(table, selection) }, svgIcon('copy'), ' Copiar'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Pegar una cuadrícula · Ctrl V', onClick: async () => {
    if (!selection.hasValue || !navigator.clipboard?.readText) { toast('Selecciona una celda y usa Ctrl + V', 'info'); return; }
    try { applyClipboardGrid(table, selection, await navigator.clipboard.readText(), container); } catch (error) { toast('El navegador no permitió leer el portapapeles', 'warning'); }
  } }, svgIcon('paste'), ' Pegar')
  );
  toolbarGroup('Preparar', ['Inicio', 'Datos'],
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Ordenar por una columna', onClick: () => sortDataTable(table, container) }, svgIcon('sort'), ' Ordenar'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Normalizar texto y detectar tipos', onClick: () => normalizeDataTable(table, container) }, svgIcon('sparkle'), ' Preparar'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Ver perfil estadístico de la tabla', onClick: () => openDataTableInsights(table) }, svgIcon('chart'), ' Analizar'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Borrar el contenido de la selección', onClick: () => {
      if (!selection.hasValue) { toast('Selecciona una o varias celdas primero', 'info'); return; }
      const bounds = tableSelectionBounds(selection); checkpointTableEdit(table);
      for (let row = bounds.top; row <= bounds.bottom; row++) for (let col = bounds.left; col <= bounds.right; col++) table.rows[row][col] = '';
      commitTableEdit(table); autoSaveTable(table); rerenderTable(); toast('Selección vaciada', 'success');
    } }, svgIcon('trash'), ' Vaciar')
  );
  toolbarGroup('Añadir', ['Datos', 'Insertar'],
    h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm ws-data-command', onClick: () => addColumn(table, renderDataTableView, container) }, svgIcon('plus'), ' Columna'),
    h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm ws-data-command', onClick: () => addRow(table, renderDataTableView, container) }, svgIcon('plus'), ' Fila')
  );
  toolbarGroup('Salida', ['Insertar'],
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Abrir esta tabla en Query', onClick: sendDataTableToQuery }, svgIcon('flow'), ' Query'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Crear un gráfico desde esta tabla', onClick: () => createChartFromTable(appStore.get('currentProject'), table) }, svgIcon('chart'), ' Gráfico'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Preparar un informe con resumen, tabla y gráfico', onClick: () => createReportFromTable(appStore.get('currentProject'), table) }, svgIcon('file'), ' Informe'),
    h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm ws-data-command', onClick: () => exportTableCSV(table) }, svgIcon('download'), ' CSV')
  );
  toolbarGroup('Funciones', ['Formulas'],
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Insertar =SUMA(rango)', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda primero', 'info'); return; } formulaInput.value = '=SUM()'; formulaInput.focus(); } }, svgIcon('formula'), ' SUMA'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Insertar =PROMEDIO(rango)', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda primero', 'info'); return; } formulaInput.value = '=AVERAGE()'; formulaInput.focus(); } }, svgIcon('formula'), ' PROMEDIO'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Insertar =MIN(rango)', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda primero', 'info'); return; } formulaInput.value = '=MIN()'; formulaInput.focus(); } }, svgIcon('formula'), ' MIN'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Insertar =MAX(rango)', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda primero', 'info'); return; } formulaInput.value = '=MAX()'; formulaInput.focus(); } }, svgIcon('formula'), ' MAX'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Insertar =CONTAR(rango)', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda primero', 'info'); return; } formulaInput.value = '=COUNT()'; formulaInput.focus(); } }, svgIcon('formula'), ' CONTAR'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Insertar =CONTARA(rango)', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda primero', 'info'); return; } formulaInput.value = '=COUNTA()'; formulaInput.focus(); } }, svgIcon('formula'), ' CONTARA')
  );
  toolbarGroup('Formato', ['Inicio', 'Vista'],
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Formato numero', onClick: () => toast('Selecciona celdas y escribe una formula con = para calcular', 'info') }, svgIcon('calc'), ' Numero'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Formato porcentaje', onClick: () => { if (selectedCell.row < 0) { toast('Selecciona una celda', 'info'); return; } checkpointTableEdit(table); const v = table.rows[selectedCell.row]?.[selectedCell.col] ?? ''; const n = numericValue(v); table.rows[selectedCell.row][selectedCell.col] = v ? String((n * 100).toFixed(2)) + '%' : ''; commitTableEdit(table); autoSaveTable(table); rerenderTable(); } }, svgIcon('text'), ' %')
  );
  toolbarGroup('Vista', ['Vista'],
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Ir a la primera fila', onClick: () => { if (table.rows.length > 0) setSelection(0, 0); } }, svgIcon('chevronUp'), ' Primera fila'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Ir a la ultima fila', onClick: () => { if (table.rows.length > 0) setSelection(table.rows.length - 1, 0); } }, svgIcon('chevronDown'), ' Ultima fila'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Ir a la primera columna', onClick: () => { if (table.rows.length > 0) setSelection(selection.focusRow, 0); } }, svgIcon('chevronLeftDouble'), ' Primera col.'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Ir a la ultima columna', onClick: () => { if (table.rows.length > 0) setSelection(selection.focusRow, table.headers.length - 1); } }, svgIcon('chevronRightDouble'), ' Ultima col.'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm ws-data-command', title: 'Seleccionar toda la tabla', onClick: () => { selection.anchorRow = 0; selection.anchorCol = 0; selection.focusRow = table.rows.length - 1; selection.focusCol = table.headers.length - 1; selection.hasValue = true; markTableSelection(tableEl, selection); } }, svgIcon('grid'), ' Seleccionar todo')
  );
  ribbonPanel.appendChild(h('span', { className: 'ws-table-capacity' }, `${(table.rows || []).length.toLocaleString('es')} / ${config.maxTableRows.toLocaleString('es')} filas · ${(table.headers || []).length} / ${config.maxTableColumns} columnas`));
  const setRibbonPage = (page) => {
    ribbonPanel.querySelectorAll('.ws-data-tool-group').forEach((group) => {
      const pages = String(group.dataset.ribbonPages || '').split(' ');
      group.hidden = !pages.includes(page);
    });
    ribbonPanel.dataset.activePage = page;
  };
  setRibbonPage('Inicio');
  const activateRibbonTab = (tab) => {
    const page = tab.textContent.trim();
    ribbonTabs.querySelectorAll('.ws-data-ribbon-tab').forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    setRibbonPage(page);
    if (ribbonPanel) ribbonPanel.setAttribute('aria-labelledby', 'ws-data-tab-' + page);
    const target = ribbonPanel.querySelector('.ws-data-tool-group:not([hidden])');
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };
  ribbonTabs.querySelectorAll('.ws-data-ribbon-tab').forEach(tab => tab.addEventListener('click', () => activateRibbonTab(tab)));
  enableTablistKeyboard(ribbonTabs);
  toolbar.appendChild(ribbonPanel);
  el.appendChild(toolbar);
  const formulaBar = h('div', { className: 'ws-formula-bar' });
  formulaBar.appendChild(h('span', { className: 'fx-label' }, 'fx'));
  const formulaInput = h('input', {
    type: 'text',
    placeholder: 'Selecciona una celda o escribe =SUM(A1:A3)',
    style: 'flex:1',
    onKeydown: (e) => {
      if (e.key !== 'Enter' || selectedCell.row < 0) return;
      checkpointTableEdit(table);
      table.rows[selectedCell.row][selectedCell.col] = formulaInput.value;
      commitTableEdit(table);
      autoSaveTable(table);
      rerenderTable();
    }
  });
  formulaBar.appendChild(formulaInput);
  formulaBar.appendChild(h('span', { className: 'ws-formula-hint' }, 'Enter para guardar'));
  el.appendChild(formulaBar);
  const gridContainer = h('div', { className: 'ws-grid-container' });
  const tableEl = h('table', { className: 'ws-grid-table', tabIndex: '0', ariaLabel: 'Tabla editable. Usa Ctrl C y Ctrl V para copiar y pegar.' });
  const setSelection = (row, col, extend = false) => {
    if (!extend || !selection.hasValue) {
      selection.anchorRow = row;
      selection.anchorCol = col;
    }
    selection.focusRow = row;
    selection.focusCol = col;
    selection.hasValue = true;
    selectedCell.row = row;
    selectedCell.col = col;
    formulaInput.value = String(table.rows[row]?.[col] ?? '');
    markTableSelection(tableEl, selection);
    tableEl.focus();
  };
  tableEl.addEventListener('copy', event => {
    if (!selection.hasValue) return;
    event.clipboardData.setData('text/plain', selectedTableTsv(table, selection));
    event.preventDefault();
    toast('Celdas copiadas', 'success');
  });
  tableEl.addEventListener('cut', async event => {
    if (!selection.hasValue) return;
    event.clipboardData.setData('text/plain', selectedTableTsv(table, selection));
    event.preventDefault();
    await copyTableSelection(table, selection, true);
    rerenderTable();
  });
  tableEl.addEventListener('paste', event => {
    if (!selection.hasValue) return;
    event.preventDefault();
    applyClipboardGrid(table, selection, event.clipboardData.getData('text/plain'), container);
  });
  tableEl.addEventListener('keydown', event => {
    if (!selection.hasValue) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey ? redoTableEdit(table) : undoTableEdit(table)) rerenderTable();
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (redoTableEdit(table)) rerenderTable();
      return;
    }
    if (meta && ['c', 'x', 'v'].includes(event.key.toLowerCase())) return;
    if (event.key === 'F2') {
      event.preventDefault();
      startCellEdit(table, selection.focusRow, selection.focusCol, tableEl, selection, container, rerenderTable);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const nextRow = event.shiftKey ? Math.max(0, selection.focusRow - 1) : Math.min(table.rows.length - 1, selection.focusRow + 1);
      setSelection(nextRow, selection.focusCol);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const nextCol = event.shiftKey ? Math.max(0, selection.focusCol - 1) : Math.min(table.headers.length - 1, selection.focusCol + 1);
      if (event.shiftKey && nextCol === 0 && selection.focusCol > 0) {
        setSelection(Math.max(0, selection.focusRow - 1), table.headers.length - 1);
      } else if (!event.shiftKey && nextCol === selection.focusCol) {
        setSelection(Math.min(table.rows.length - 1, selection.focusRow + 1), 0);
      } else {
        setSelection(selection.focusRow, nextCol);
      }
      return;
    }
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      const [rowMove, colMove] = moves[event.key];
      setSelection(Math.max(0, Math.min(table.rows.length - 1, selection.focusRow + rowMove)), Math.max(0, Math.min(table.headers.length - 1, selection.focusCol + colMove)), event.shiftKey);
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection(0, 0, false);
      selection.endRow = table.rows.length - 1;
      selection.endCol = table.headers.length - 1;
      markTableSelection(tableEl, selection, table);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (meta) { setSelection(0, 0); } else { setSelection(selection.focusRow, 0); }
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (meta) { setSelection(table.rows.length - 1, table.headers.length - 1); } else { setSelection(selection.focusRow, table.headers.length - 1); }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const bounds = tableSelectionBounds(selection);
      checkpointTableEdit(table);
      for (let row = bounds.top; row <= bounds.bottom; row++) for (let col = bounds.left; col <= bounds.right; col++) table.rows[row][col] = '';
      commitTableEdit(table);
      autoSaveTable(table);
      rerenderTable();
    }
    if (event.key.length === 1 && !meta && !event.altKey) {
      startCellEdit(table, selection.focusRow, selection.focusCol, tableEl, selection, container, rerenderTable, event.key);
    }
  });
  const thead = h('thead');
  const headerRow = h('tr');
  headerRow.appendChild(h('th', { className: 'row-number' }, '#'));
  (table.headers || []).forEach((hdr, ci) => {
    const filterIcon = h('span', { className: 'ws-col-filter-btn', title: 'Filtrar columna' }, '\u25BD');
    const th = h('th', null,
      h('span', { className: 'ws-data-type-badge' }, table.columnTypes?.[ci] || queryColumnType(table.rows || [], ci)),
      h('span', { className: 'ws-col-header-text' }, hdr),
      h('span', { className: 'sort-indicator' }),
      filterIcon
    );
    th.addEventListener('dblclick', () => {
      const newName = prompt('Nombre de columna:', hdr);
      if (newName !== null && newName.trim()) {
        checkpointTableEdit(table);
        table.headers[ci] = newName.trim();
        commitTableEdit(table);
        autoSaveTable(table);
        rerenderTable();
      }
    });
    th.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.classList.contains('ws-col-filter-btn')) return;
      const descending = e.shiftKey;
      checkpointTableEdit(table);
      table.rows.sort((left, right) => {
        const a = String(left[ci] ?? '');
        const b = String(right[ci] ?? '');
        const na = Number(a.replace(',', '.'));
        const nb = Number(b.replace(',', '.'));
        const result = Number.isFinite(na) && Number.isFinite(nb)
          ? na - nb
          : a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
        return descending ? -result : result;
      });
      commitTableEdit(table);
      autoSaveTable(table);
      rerenderTable();
    });
    filterIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      const existingDrop = tableEl.querySelector('.ws-col-filter-dropdown');
      if (existingDrop) { existingDrop.remove(); return; }
      const uniqueValues = new Map();
      (table.rows || []).forEach(row => {
        const val = String(row[ci] ?? '').trim();
        uniqueValues.set(val, (uniqueValues.get(val) || 0) + 1);
      });
      const activeFilters = table._colFilters?.[ci] || null;
      const drop = document.createElement('div');
      drop.className = 'ws-col-filter-dropdown';
      drop.style.cssText = 'position:fixed;z-index:9999;background:var(--ws-card,#fff);border:1px solid var(--ws-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:8px;min-width:200px;max-height:280px;overflow:auto;font-size:12px';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Buscar...';
      searchInput.style.cssText = 'width:100%;padding:6px 8px;border:1px solid var(--ws-border);border-radius:4px;font-size:12px;margin-bottom:6px;box-sizing:border-box';
      drop.appendChild(searchInput);
      const selectAll = document.createElement('label');
      selectAll.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;font-weight:600;cursor:pointer;border-bottom:1px solid var(--ws-border-light);margin-bottom:4px';
      const selectAllCb = document.createElement('input');
      selectAllCb.type = 'checkbox';
      selectAllCb.checked = !activeFilters;
      selectAll.appendChild(selectAllCb);
      selectAll.appendChild(document.createTextNode('Seleccionar todo'));
      drop.appendChild(selectAll);
      const listDiv = document.createElement('div');
      listDiv.style.cssText = 'display:flex;flex-direction:column;gap:1px';
      const sorted = Array.from(uniqueValues.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true, sensitivity: 'base' }));
      sorted.forEach(([val, count]) => {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:3px;cursor:pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !activeFilters || activeFilters.has(val);
        cb.dataset.filterVal = val;
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode((val || '(vacío)') + ' (' + count + ')'));
        listDiv.appendChild(lbl);
      });
      drop.appendChild(listDiv);
      const thRect = th.getBoundingClientRect();
      drop.style.left = thRect.left + 'px';
      drop.style.top = thRect.bottom + 'px';
      document.body.appendChild(drop);
      searchInput.focus();
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        listDiv.querySelectorAll('label').forEach(l => {
          l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
      const applyFilter = () => {
        const checked = new Set();
        let allChecked = true;
        listDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          if (cb.dataset.filterVal !== undefined) {
            if (cb.checked) checked.add(cb.dataset.filterVal);
            else allChecked = false;
          }
        });
        if (!table._colFilters) table._colFilters = {};
        if (allChecked || checked.size === sorted.length) {
          delete table._colFilters[ci];
        } else {
          table._colFilters[ci] = checked;
        }
        drop.remove();
        rerenderTable();
      };
      selectAllCb.addEventListener('change', () => {
        listDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = selectAllCb.checked; });
      });
      const closeHandler = (ev) => {
        if (!drop.contains(ev.target) && ev.target !== filterIcon) {
          drop.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Aplicar';
      applyBtn.style.cssText = 'margin-top:6px;width:100%;padding:6px;border:none;border-radius:4px;background:var(--ws-primary,#17191C);color:#fff;cursor:pointer;font-size:12px;font-weight:600';
      applyBtn.addEventListener('click', applyFilter);
      drop.appendChild(applyBtn);
    });
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  tableEl.appendChild(thead);
  const tbody = h('tbody');
  const colFilters = table._colFilters || {};
  const hasFilters = Object.keys(colFilters).length > 0;
  let visibleRowIndex = 0;
  (table.rows || []).forEach((row, ri) => {
    if (hasFilters) {
      for (const fci in colFilters) {
        const fVal = String(row[fci] ?? '').trim();
        if (!colFilters[fci].has(fVal)) return;
      }
    }
    const tr = h('tr');
    tr.appendChild(h('td', { className: 'row-number' }, String(ri + 1)));
    visibleRowIndex++;
    row.forEach((cell, ci) => {
      const rawCell = cell == null ? '' : String(cell);
      const displayCell = rawCell.trim().startsWith('=') ? evaluateDataFormula(table, rawCell) : rawCell;
      const cellConf = table.cellConfidence?.[ri]?.[ci];
      const lowConf = cellConf !== null && cellConf !== undefined && cellConf < OCR_LOW_CONFIDENCE;
      const td = h('td', {
        title: (lowConf ? 'Confianza OCR ' + cellConf + '% - revisar. ' : '') + (rawCell !== displayCell ? rawCell : ''),
        'data-row': String(ri), 'data-col': String(ci),
      }, displayCell);
      if (lowConf) td.classList.add('ws-cell-low-confidence');
      td.addEventListener('click', event => setSelection(ri, ci, event.shiftKey));
      td.addEventListener('dblclick', () => {
        startCellEdit(table, ri, ci, tableEl, selection, container, rerenderTable);
      });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
  gridContainer.appendChild(tableEl);
  el.appendChild(gridContainer);
  const sheetTabs = h('div', { className: 'ws-sheet-tabs' });
  const workbookId = dataWorkbookId(table);
  const allTables = appStore.get('dataTables') || [];
  const sheetTables = [table, ...allTables].filter((item, index, list) => {
    return dataWorkbookId(item) === workbookId && list.findIndex(candidate => candidate.id === item.id) === index;
  });
  sheetTables.forEach(sheet => {
    const isActive = sheet.id === table.id;
    const tabWrap = h('div', { className: 'ws-sheet-tab' + (isActive ? ' active' : ''), role: 'tab', 'aria-selected': isActive ? 'true' : 'false' });
    const tabLabel = h('span', { className: 'ws-sheet-tab-label', title: 'Doble clic para renombrar' }, sheet.name || 'Hoja');
    tabLabel.addEventListener('dblclick', () => {
      const input = h('input', { type: 'text', value: sheet.name || 'Hoja', className: 'ws-sheet-tab-rename-input' });
      tabLabel.replaceWith(input);
      input.focus();
      input.select();
      const finish = (save) => {
        const val = input.value.trim();
        if (save && val && val !== sheet.name) { checkpointTableEdit(table); sheet.name = val; commitTableEdit(table); autoSaveTable(table); }
        input.replaceWith(tabLabel);
        tabLabel.textContent = sheet.name || 'Hoja';
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    });
    tabLabel.addEventListener('click', () => {
      appStore.set({ currentDataTable: sheet });
      container.replaceChildren();
      renderDataTableView(container);
    });
    tabWrap.appendChild(tabLabel);
    if (isActive && sheetTables.length > 1) {
      const closeBtn = h('button', {
        className: 'ws-sheet-tab-close',
        type: 'button',
        title: 'Cerrar hoja',
        onClick: (e) => {
          e.stopPropagation();
          showConfirm({
            title: 'Cerrar hoja "' + (sheet.name || 'Hoja') + '"',
            body: 'La hoja se mantendra en el libro. Puedes volver a abrirla desde el navegador de datos.',
            confirmText: 'Cerrar',
            onConfirm: () => {
              const project = appStore.get('currentProject');
              const tables = appStore.get('dataTables') || [];
              const sameWorkbook = [table, ...tables].filter(t => dataWorkbookId(t) === workbookId && t.id !== sheet.id);
              if (sameWorkbook.length > 0) {
                appStore.set({ currentDataTable: sameWorkbook[0] });
              } else {
                appStore.set({ currentDataTable: null });
              }
              container.replaceChildren();
              renderDataTableView(container);
            }
          });
        }
      }, '\u00d7');
      tabWrap.appendChild(closeBtn);
    }
    tabWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Abrir', icon: 'doc', action: () => { appStore.set({ currentDataTable: sheet }); container.replaceChildren(); renderDataTableView(container); } },
        { label: 'Renombrar', icon: 'edit', action: () => { const val = prompt('Nombre de la hoja:', sheet.name || 'Hoja'); if (val !== null && val.trim()) { checkpointTableEdit(table); sheet.name = val.trim(); commitTableEdit(table); autoSaveTable(table); rerenderTable(); } } },
        { divider: true },
        { label: 'Duplicar', icon: 'copy', action: () => duplicateDataSheet(sheet, container) },
        { divider: true },
        { label: 'Eliminar', icon: 'trash', danger: true, action: () => deleteDataSheet(sheet, container) },
      ]);
    });
    sheetTabs.appendChild(tabWrap);
  });
  sheetTabs.appendChild(h('button', {
    className: 'ws-sheet-tab add-tab',
    type: 'button',
    onClick: () => createNewDataSheet(table, container),
    ariaLabel: 'Crear una nueva hoja',
  }, '+ Nueva hoja'));
  el.appendChild(sheetTabs);
  if ((table.rows || []).length > 0) {
    const nextStep = h('div', { className: 'ws-next-step-banner' },
      h('span', { className: 'ws-next-step-icon' }, '\u2713'),
      h('div', { className: 'ws-next-step-copy' },
        h('strong', null, 'Datos listos \u2713'),
        h('span', null, 'Siguiente paso recomendado: Analizar datos o crear un grafico')
      ),
      h('div', { className: 'ws-next-step-actions' },
        h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: () => createChartFromTable(appStore.get('currentProject'), table) }, svgIcon('chart', 14), ' Grafico'),
        h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: sendDataTableToQuery }, svgIcon('flow', 14), ' Query'),
        h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: () => createReportFromTable(appStore.get('currentProject'), table) }, svgIcon('file', 14), ' Informe')
      )
    );
    el.appendChild(nextStep);
  }
  container.appendChild(el);
}

function addColumn(table, renderFn, container) {
  const config = getWorkspaceConfig();
  if (table.headers.length >= config.maxTableColumns) {
    toast(`Límite alcanzado: ${config.maxTableColumns} columnas`, 'warning');
    return;
  }
  const name = h('input', { className: 'ws-input', type: 'text', placeholder: 'Ej. Fecha de entrega', autofocus: true });
  showModal({
    title: 'Añadir columna',
    body: [queryFormField('Nombre', name, 'Usa un nombre corto y reconocible para facilitar Query e informes.')],
    confirmText: 'Añadir columna',
    onConfirm: async () => {
      if (!name.value.trim()) {
        toast('Escribe un nombre para la columna', 'warning');
        return;
      }
      checkpointTableEdit(table);
      table.headers.push(name.value.trim());
      (table.rows || []).forEach(row => row.push(''));
      commitTableEdit(table);
      autoSaveTable(table);
      container.replaceChildren();
      renderFn(container);
      toast('Columna añadida', 'success');
    },
    size: 'small',
  });
}

function addRow(table, renderFn, container) {
  const config = getWorkspaceConfig();
  if ((table.rows || []).length >= config.maxTableRows) {
    toast(`Límite alcanzado: ${config.maxTableRows.toLocaleString('es')} filas`, 'warning');
    return;
  }
  checkpointTableEdit(table);
  const newRow = new Array(table.headers.length).fill('');
  table.rows = table.rows || [];
  table.rows.push(newRow);
  commitTableEdit(table);
  autoSaveTable(table);
  container.replaceChildren();
  renderFn(container);
}

function autoSaveTable(table) {
  const project = appStore.get('currentProject');
  if (!project) return;
  clearTimeout(autoSaveTable._timer);
  autoSaveTable._timer = setTimeout(() => {
    saveData(project.id, table)
      .then(() => syncDerivedCharts(project, table))
      .then(() => appStore.set({ isDirty: false, lastSaved: Date.now() }))
      .catch(error => reportError(error, 'table-save', {}));
  }, 1000);
}

function exportTableCSV(table) {
  const sep = ',';
  let csv = table.headers.join(sep) + '\n';
  (table.rows || []).forEach(row => {
    csv += row.map(c => {
      if (c.includes(sep) || c.includes('"') || c.includes('\n')) {
        return '"' + c.replace(/"/g, '""') + '"';
      }
      return c;
    }).join(sep) + '\n';
  });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: (table.name || 'datos') + '.csv' });
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado', 'success');
}

function renderQueryView(container, project) {
  const steps = appStore.get('querySteps');
  const el = h('div', { className: 'ws-query-layout', style: 'animation:fadeIn 0.3s ease' });
  const editor = h('div', { className: 'ws-query-editor' });
  const headingRow = h('div', { className: 'ws-query-heading-row' });
  headingRow.appendChild(h('div', { className: 'ws-module-title ws-query-title' }, 'Toolisto Query'));
  headingRow.appendChild(h('span', { className: 'ws-status-chip ws-status-limited' }, 'FUNCIONAL CON LIMITACIONES'));
  editor.appendChild(headingRow);
  editor.appendChild(h('div', { className: 'ws-query-desc' }, 'Crea pasos de consulta para transformar y analizar tus datos.'));
  if (steps.length === 0) {
    editor.appendChild(h('div', { className: 'ws-empty' },
      h('div', { className: 'ws-empty-icon' }, svgIcon('chart', 28)),
      h('div', { className: 'ws-empty-title' }, 'Sin pasos de consulta'),
      h('div', { className: 'ws-empty-text' }, 'Agrega pasos para filtrar, ordenar y transformar datos.')
    ));
  } else {
    steps.forEach((step, idx) => {
      const stepEl = h('div', { className: 'ws-query-step' },
        h('div', { className: 'ws-query-step-num' }, String(idx + 1)),
        h('div', { style: 'flex:1' },
          h('div', { style: 'font-weight:500;font-size:13px' }, step.type + ': ' + (step.description || '')),
          h('div', { style: 'font-size:11px;color:var(--ws-text-tertiary)' }, step.config || '')
        ),
        h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: () => {
          steps.splice(idx, 1);
          appStore.set({ querySteps: steps });
        container.replaceChildren();
          renderQueryView(container, project);
        } }, svgIcon('trash'))
      );
      editor.appendChild(stepEl);
    });
  }
  const addBtn = h('button', { className: 'ws-btn ws-btn-primary', onClick: () => {
    const type = prompt('Tipo de paso (filter, sort, transform, aggregate):');
    if (!type) return;
    const desc = prompt('Descripción del paso:');
    steps.push({ type: type.trim(), description: desc || '', config: '' });
    appStore.set({ querySteps: steps });
    container.replaceChildren();
    renderQueryView(container, project);
  } }, svgIcon('plus'), ' Agregar paso');
  editor.appendChild(addBtn);
  el.appendChild(editor);
  container.appendChild(el);
}

const QUERY_ACTIONS = [
  { key: 'filter', group: 'Filas', label: 'Filtrar filas', icon: 'filter', help: 'Conserva solo las filas que cumplen una condición.' },
  { key: 'sort', group: 'Filas', label: 'Ordenar', icon: 'sort', help: 'Ordena ascendente o descendentemente.' },
  { key: 'remove-rows', group: 'Filas', label: 'Quitar filas', icon: 'minus', help: 'Quita filas del inicio o del final.' },
  { key: 'keep-rows', group: 'Filas', label: 'Conservar filas', icon: 'check', help: 'Conserva un número de filas.' },
  { key: 'remove-empty', group: 'Filas', label: 'Quitar vacías', icon: 'trash', help: 'Elimina filas completamente vacías.' },
  { key: 'remove-duplicates', group: 'Filas', label: 'Quitar duplicados', icon: 'duplicate', help: 'Elimina registros repetidos.' },
  { key: 'remove-columns', group: 'Columnas', label: 'Quitar columnas', icon: 'trash', help: 'Elimina una o varias columnas.' },
  { key: 'choose-columns', group: 'Columnas', label: 'Elegir columnas', icon: 'grid', help: 'Conserva únicamente las columnas elegidas.' },
  { key: 'rename-column', group: 'Columnas', label: 'Renombrar', icon: 'edit', help: 'Cambia el nombre de una columna.' },
  { key: 'duplicate-column', group: 'Columnas', label: 'Duplicar columna', icon: 'duplicate', help: 'Crea una copia editable de una columna.' },
  { key: 'split-column', group: 'Columnas', label: 'Dividir columna', icon: 'crop', help: 'Divide el texto usando un separador.' },
  { key: 'merge-columns', group: 'Columnas', label: 'Combinar columnas', icon: 'link', help: 'Une varias columnas en una nueva.' },
  { key: 'reorder-columns', group: 'Columnas', label: 'Reordenar', icon: 'sort', help: 'Cambia el orden de las columnas.' },
  { key: 'replace-values', group: 'Texto', label: 'Reemplazar', icon: 'edit', help: 'Busca y reemplaza valores.' },
  { key: 'trim', group: 'Texto', label: 'Recortar espacios', icon: 'text', help: 'Quita espacios al inicio y al final.' },
  { key: 'clean', group: 'Texto', label: 'Limpiar texto', icon: 'sparkle', help: 'Normaliza espacios y caracteres invisibles.' },
  { key: 'uppercase', group: 'Texto', label: 'MAYÚSCULAS', icon: 'bold', help: 'Convierte el texto a mayúsculas.' },
  { key: 'lowercase', group: 'Texto', label: 'minúsculas', icon: 'italic', help: 'Convierte el texto a minúsculas.' },
  { key: 'fill-down', group: 'Texto', label: 'Rellenar abajo', icon: 'download', help: 'Repite el último valor no vacío.' },
  { key: 'fill-up', group: 'Texto', label: 'Rellenar arriba', icon: 'upload', help: 'Repite el siguiente valor no vacío.' },
  { key: 'detect-type', group: 'Tipos', label: 'Detectar tipo', icon: 'callout', help: 'Normaliza números y fechas reconocibles.' },
  { key: 'add-index', group: 'Estructura', label: 'Agregar índice', icon: 'plus', help: 'Añade una columna índice.' },
  { key: 'promote-headers', group: 'Estructura', label: 'Usar primera fila', icon: 'table', help: 'Convierte la primera fila en encabezados.' },
  { key: 'transpose', group: 'Estructura', label: 'Transponer', icon: 'rotate', help: 'Intercambia filas y columnas.' },
  { key: 'group', group: 'Análisis', label: 'Agrupar por', icon: 'chart', help: 'Agrupa y calcula conteo, suma o promedio.' },
  { key: 'custom-column', group: 'Análisis', label: 'Columna personalizada', icon: 'formula', help: 'Crea una columna con texto o combinación de campos.' },
];

const QUERY_ACTION_MAP = Object.fromEntries(QUERY_ACTIONS.map(action => [action.key, action]));

function queryCloneRows(rows, width) {
  return (rows || []).map(row => Array.from({ length: width }, (_, index) => {
    const value = row && row[index];
    return value == null ? '' : String(value);
  }));
}

function queryCloneShape(shape) {
  const headers = [...(shape.headers || [])];
  return { headers, rows: queryCloneRows(shape.rows || [], headers.length) };
}

function queryCreateModel(project, table, options = {}) {
  const source = table || { id: 'query-source-' + generateId(), name: 'Fuente sin nombre', headers: [], rows: [] };
  const headers = (source.headers || []).map((header, index) => String(header || 'Columna ' + (index + 1)));
  const rows = queryCloneRows(source.rows || [], headers.length);
  return {
    projectId: project.id,
    sheetId: options.sheetId || generateId(),
    sheetName: options.sheetName || 'Hoja 1',
    sourceId: source.id || 'query-source-' + generateId(),
    sourceName: source.name || 'Fuente sin nombre',
    baseHeaders: [...headers],
    baseRows: queryCloneRows(rows, headers.length),
    headers: [...headers],
    rows: queryCloneRows(rows, headers.length),
    steps: [],
  };
}

function querySheetsSettingKey(projectId) {
  return 'query:' + projectId;
}

function queryCloneSteps(steps) {
  return (steps || []).map(step => ({
    ...step,
    config: { ...(step.config || {}) },
  }));
}

function querySerializeModel(model) {
  return {
    projectId: model.projectId,
    sheetId: model.sheetId,
    sheetName: model.sheetName,
    sourceId: model.sourceId,
    sourceName: model.sourceName,
    baseHeaders: [...(model.baseHeaders || [])],
    baseRows: queryCloneRows(model.baseRows || [], (model.baseHeaders || []).length),
    steps: queryCloneSteps(model.steps),
  };
}

function queryModelFromSaved(project, tables, raw, index = 0) {
  const saved = raw?.model || raw || {};
  const currentSource = tables.find(table => table.id === saved.sourceId);
  const fallbackSource = currentSource || (saved.baseHeaders ? querySourceTableFromModel(saved) : tables[0]) || {
    id: saved.sourceId || 'query-source-' + generateId(),
    name: saved.sourceName || 'Fuente sin nombre',
    headers: saved.baseHeaders || [],
    rows: saved.baseRows || [],
  };
  const model = queryCreateModel(project, fallbackSource, {
    sheetId: saved.sheetId || saved.id || generateId(),
    sheetName: saved.sheetName || saved.name || 'Hoja ' + (index + 1),
  });
  model.sourceId = saved.sourceId || fallbackSource.id;
  model.sourceName = saved.sourceName || fallbackSource.name || 'Fuente sin nombre';
  const baseHeaders = currentSource ? currentSource.headers : (saved.baseHeaders || fallbackSource.headers || []);
  const baseRows = currentSource ? currentSource.rows : (saved.baseRows || fallbackSource.rows || []);
  model.baseHeaders = baseHeaders.map((header, column) => String(header || 'Columna ' + (column + 1)));
  model.baseRows = queryCloneRows(baseRows, model.baseHeaders.length);
  model.steps = queryCloneSteps(saved.steps);
  queryRebuildModel(model);
  return model;
}

function queryReplaceModelInSheets(sheets, model) {
  const next = [...(sheets || [])];
  const index = next.findIndex(sheet => sheet.sheetId === model.sheetId);
  if (index >= 0) next[index] = model;
  else next.push(model);
  return next;
}

function querySetState(sheets, activeModel) {
  const nextSheets = [...(sheets || [])].filter(Boolean);
  const model = activeModel || nextSheets[0] || null;
  if (model) {
    if (!model.sheetId) model.sheetId = generateId();
    if (!model.sheetName) model.sheetName = 'Hoja 1';
    const activeIndex = nextSheets.findIndex(sheet => sheet.sheetId === model.sheetId);
    if (activeIndex >= 0) nextSheets[activeIndex] = model;
    else nextSheets.unshift(model);
  }
  appStore.set({
    querySheets: nextSheets,
    activeQuerySheetId: model?.sheetId || null,
    queryModel: model,
    querySteps: model?.steps || [],
    queryResult: model ? { headers: [...model.headers], rows: queryCloneRows(model.rows, model.headers.length) } : null,
  });
  return nextSheets;
}

async function queryPersistState(projectId, sheets, activeModel) {
  const nextSheets = querySetState(sheets, activeModel);
  const model = activeModel || nextSheets[0];
  if (projectId && model) {
    await saveSetting(querySheetsSettingKey(projectId), {
      version: 1,
      activeSheetId: model.sheetId,
      sheets: nextSheets.map(querySerializeModel),
    });
  }
  return nextSheets;
}

function queryRestoreSheets(project, tables, saved) {
  const inMemory = appStore.get('querySheets');
  if (!saved && Array.isArray(inMemory) && inMemory.length && inMemory.every(sheet => sheet.projectId === project.id)) {
    const activeId = appStore.get('activeQuerySheetId') || inMemory[0].sheetId;
    return { sheets: inMemory, activeModel: inMemory.find(sheet => sheet.sheetId === activeId) || inMemory[0] };
  }
  const rawSheets = Array.isArray(saved?.sheets) ? saved.sheets : [];
  const sheets = rawSheets.map((sheet, index) => queryModelFromSaved(project, tables, sheet, index));
  if (!sheets.length) {
    const previous = appStore.get('queryModel');
    const model = previous?.projectId === project.id
      ? queryModelFromSaved(project, tables, previous, 0)
      : tables[0] ? queryCreateModel(project, tables[0], { sheetName: 'Hoja 1' }) : null;
    if (model) sheets.push(model);
  }
  const activeId = saved?.activeSheetId || sheets[0]?.sheetId;
  return { sheets, activeModel: sheets.find(sheet => sheet.sheetId === activeId) || sheets[0] || null };
}

function queryUniqueSheetName(sheets, proposed, excludedId = '') {
  const taken = new Set((sheets || []).filter(sheet => sheet.sheetId !== excludedId).map(sheet => String(sheet.sheetName || '').trim().toLocaleLowerCase('es')));
  const base = String(proposed || 'Hoja').trim() || 'Hoja';
  let name = base;
  let suffix = 2;
  while (taken.has(name.toLocaleLowerCase('es'))) name = base + ' ' + suffix++;
  return name;
}

function queryNumber(value) {
  return parseLocaleNumber(value);
}

function queryIsDate(value) {
  const text = String(value == null ? '' : value).trim();
  return text.length > 5 && /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(text) && !Number.isNaN(Date.parse(text));
}

function queryColumnType(rows, index) {
  const values = rows.map(row => String(row[index] == null ? '' : row[index]).trim()).filter(Boolean);
  if (!values.length) return 'ABC';
  if (values.every(value => queryNumber(value) !== null)) return '123';
  if (values.every(queryIsDate)) return 'DATE';
  return 'ABC';
}

function queryUniqueHeader(value, taken, fallback) {
  const base = String(value || fallback || 'Columna').trim() || fallback || 'Columna';
  let result = base;
  let suffix = 2;
  while (taken.has(result.toLowerCase())) {
    result = base + ' ' + suffix++;
  }
  taken.add(result.toLowerCase());
  return result;
}

function queryRunOperation(shape, operation, config = {}) {
  let result = queryCloneShape(shape);
  const headers = result.headers;
  const rows = result.rows;
  const index = Number(config.index);
  const indexes = (config.indexes || []).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const normalize = value => String(value == null ? '' : value);

  if (operation === 'filter') {
    const target = String(config.value == null ? '' : config.value).toLowerCase();
    result.rows = rows.filter(row => {
      const value = normalize(row[index]);
      const lower = value.toLowerCase();
      const number = queryNumber(value);
      const targetNumber = queryNumber(target);
      if (config.operator === 'is-empty') return value.trim() === '';
      if (config.operator === 'not-empty') return value.trim() !== '';
      if (config.operator === 'contains') return lower.includes(target);
      if (config.operator === 'starts-with') return lower.startsWith(target);
      if (config.operator === 'ends-with') return lower.endsWith(target);
      if (config.operator === 'greater') return number !== null && targetNumber !== null && number > targetNumber;
      if (config.operator === 'less') return number !== null && targetNumber !== null && number < targetNumber;
      if (config.operator === 'greater-equal') return number !== null && targetNumber !== null && number >= targetNumber;
      if (config.operator === 'less-equal') return number !== null && targetNumber !== null && number <= targetNumber;
      if (config.operator === 'not-equals') return lower !== target;
      return lower === target;
    });
    return result;
  }

  if (operation === 'sort') {
    result.rows.sort((a, b) => {
      const left = normalize(a[index]);
      const right = normalize(b[index]);
      const leftNumber = queryNumber(left);
      const rightNumber = queryNumber(right);
      let comparison = leftNumber !== null && rightNumber !== null
        ? leftNumber - rightNumber
        : left.localeCompare(right, 'es', { numeric: true, sensitivity: 'base' });
      if (config.direction === 'desc') comparison *= -1;
      return comparison;
    });
    return result;
  }

  if (operation === 'remove-rows' || operation === 'keep-rows') {
    const count = Math.max(0, Number(config.count) || 0);
    const fromBottom = config.position === 'bottom';
    const keep = operation === 'keep-rows';
    if (fromBottom) {
      result.rows = keep ? rows.slice(Math.max(0, rows.length - count)) : rows.slice(0, Math.max(0, rows.length - count));
    } else {
      result.rows = keep ? rows.slice(0, count) : rows.slice(count);
    }
    return result;
  }

  if (operation === 'remove-empty') {
    result.rows = rows.filter(row => row.some(value => normalize(value).trim() !== ''));
    return result;
  }

  if (operation === 'remove-duplicates') {
    const seen = new Set();
    result.rows = rows.filter(row => {
      const key = JSON.stringify(indexes.length ? indexes.map(column => normalize(row[column])) : row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return result;
  }

  if (operation === 'remove-columns' || operation === 'choose-columns') {
    const chosen = operation === 'choose-columns'
      ? indexes
      : headers.map((_, column) => column).filter(column => !indexes.includes(column));
    if (!chosen.length) return result;
    result.headers = chosen.map(column => headers[column]);
    result.rows = rows.map(row => chosen.map(column => normalize(row[column])));
    return result;
  }

  if (operation === 'reorder-columns') {
    const order = indexes.length === headers.length ? indexes : [...indexes, ...headers.map((_, i) => i).filter(i => !indexes.includes(i))];
    result.headers = order.map(column => headers[column]);
    result.rows = rows.map(row => order.map(column => normalize(row[column])));
    return result;
  }

  if (operation === 'rename-column') {
    if (Number.isInteger(index) && headers[index] != null && String(config.name || '').trim()) {
      result.headers[index] = String(config.name).trim();
    }
    return result;
  }

  if (operation === 'duplicate-column') {
    if (Number.isInteger(index) && headers[index] != null) {
      const taken = new Set(headers.map(header => String(header).toLowerCase()));
      const name = queryUniqueHeader(config.name, taken, headers[index] + ' copia');
      result.headers.splice(index + 1, 0, name);
      result.rows = rows.map(row => {
        const next = [...row];
        next.splice(index + 1, 0, normalize(row[index]));
        return next;
      });
    }
    return result;
  }

  if (operation === 'split-column') {
    if (Number.isInteger(index) && headers[index] != null) {
      const delimiter = String(config.delimiter == null ? ',' : config.delimiter);
      const taken = new Set(headers.map(header => String(header).toLowerCase()));
      const name = queryUniqueHeader(config.name, taken, headers[index] + ' 2');
      result.headers.splice(index + 1, 0, name);
      result.rows = rows.map(row => {
        const parts = normalize(row[index]).split(delimiter);
        const left = parts.shift() || '';
        const right = parts.join(delimiter);
        const next = [...row];
        next[index] = left.trim();
        next.splice(index + 1, 0, right.trim());
        return next;
      });
    }
    return result;
  }

  if (operation === 'merge-columns') {
    if (indexes.length >= 2) {
      const first = indexes[0];
      const selected = new Set(indexes);
      result.headers = headers.filter((_, column) => !selected.has(column));
      const taken = new Set(result.headers.map(header => String(header).toLowerCase()));
      result.headers.splice(first, 0, queryUniqueHeader(config.name, taken, 'Columna combinada'));
      result.rows = rows.map(row => {
        const merged = indexes.map(column => normalize(row[column])).join(String(config.separator == null ? ' ' : config.separator));
        const next = row.filter((_, column) => !selected.has(column));
        next.splice(first, 0, merged);
        return next;
      });
    }
    return result;
  }

  if (['trim', 'clean', 'uppercase', 'lowercase', 'fill-down', 'fill-up', 'detect-type'].includes(operation)) {
    const selected = indexes.length ? indexes : [index];
    result.rows = rows.map(row => [...row]);
    selected.forEach(column => {
      if (operation === 'fill-down') {
        let previous = '';
        result.rows.forEach(row => {
          if (normalize(row[column]).trim() === '') row[column] = previous;
          else previous = normalize(row[column]);
        });
        return;
      }
      if (operation === 'fill-up') {
        let nextValue = '';
        [...result.rows].reverse().forEach(row => {
          if (normalize(row[column]).trim() === '') row[column] = nextValue;
          else nextValue = normalize(row[column]);
        });
        return;
      }
      result.rows.forEach(row => {
        let value = normalize(row[column]);
        if (operation === 'trim') value = value.trim();
        if (operation === 'clean') value = value.replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (operation === 'uppercase') value = value.toLocaleUpperCase('es');
        if (operation === 'lowercase') value = value.toLocaleLowerCase('es');
        if (operation === 'detect-type') {
          const number = queryNumber(value);
          if (number !== null && /^[-+]?\d+(?:[.,]\d+)?$/.test(value.trim())) value = String(number);
          else if (queryIsDate(value)) value = new Date(value).toISOString().slice(0, 10);
        }
        row[column] = value;
      });
    });
    return result;
  }

  if (operation === 'replace-values') {
    result.rows = rows.map(row => row.map((value, column) => {
      if (column !== index) return value;
      const current = normalize(value);
      return config.mode === 'contains'
        ? current.split(String(config.find)).join(String(config.replace))
        : current === String(config.find) ? String(config.replace) : current;
    }));
    return result;
  }

  if (operation === 'add-index') {
    const taken = new Set(headers.map(header => String(header).toLowerCase()));
    const name = queryUniqueHeader(config.name, taken, 'Índice');
    result.headers.push(name);
    result.rows = rows.map((row, rowIndex) => [...row, String((Number(config.start) || 0) + rowIndex)]);
    return result;
  }

  if (operation === 'promote-headers' && rows.length) {
    const taken = new Set();
    result.headers = rows[0].map((value, column) => queryUniqueHeader(normalize(value), taken, 'Columna ' + (column + 1)));
    result.rows = rows.slice(1).map(row => [...row]);
    return result;
  }

  if (operation === 'transpose') {
    result.headers = ['Campo', ...rows.map((_, rowIndex) => 'Fila ' + (rowIndex + 1))];
    result.rows = headers.map((header, column) => [header, ...rows.map(row => normalize(row[column]))]);
    return result;
  }

  if (operation === 'group') {
    const groups = new Map();
    rows.forEach(row => {
      const key = normalize(row[index]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const aggregateName = config.aggregate === 'count' ? 'Conteo' : (headers[Number(config.valueIndex)] || 'Valor') + ' · ' + config.aggregate;
    result.headers = [headers[index], aggregateName];
    result.rows = [...groups.entries()].map(([key, groupRows]) => {
      if (config.aggregate === 'count') return [key, String(groupRows.length)];
      const numbers = groupRows.map(row => queryNumber(row[Number(config.valueIndex)])).filter(value => value !== null);
      if (!numbers.length) return [key, '0'];
      if (config.aggregate === 'sum') return [key, String(numbers.reduce((sum, value) => sum + value, 0))];
      if (config.aggregate === 'min') return [key, String(Math.min(...numbers))];
      if (config.aggregate === 'max') return [key, String(Math.max(...numbers))];
      return [key, String(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)];
    });
    return result;
  }

  if (operation === 'custom-column') {
    const taken = new Set(headers.map(header => String(header).toLowerCase()));
    const name = queryUniqueHeader(config.name, taken, 'Columna personalizada');
    result.headers.push(name);
    result.rows = rows.map((row, rowIndex) => {
      let value = String(config.value == null ? '' : config.value);
      if (config.mode === 'concat') {
        value = indexes.map(column => normalize(row[column])).join(String(config.separator == null ? ' ' : config.separator));
      }
      if (config.mode === 'row-number') value = String(rowIndex + 1);
      return [...row, value];
    });
    return result;
  }

  return result;
}

function queryRebuildModel(model) {
  let result = { headers: [...model.baseHeaders], rows: queryCloneRows(model.baseRows, model.baseHeaders.length) };
  (model.steps || []).forEach(step => {
    result = queryRunOperation(result, step.operation, step.config || {});
  });
  model.headers = result.headers;
  model.rows = result.rows;
  return model;
}

function queryApplyStep(model, operation, config, summary) {
  const action = QUERY_ACTION_MAP[operation] || { label: operation };
  model.steps = [...(model.steps || []), {
    id: generateId(),
    operation,
    label: action.label,
    summary: summary || '',
    config: { ...config },
  }];
  queryRebuildModel(model);
  queryPersistState(model.projectId, queryReplaceModelInSheets(appStore.get('querySheets'), model), model).catch(e => reportError(e, 'persist', {}));
  toast('Paso aplicado: ' + action.label, 'success');
}

function queryFormField(label, control, help) {
  return h('div', { className: 'ws-query-form-field' },
    h('label', null, label),
    control,
    help ? h('small', null, help) : null
  );
}

function queryColumnSelect(model, multiple = false) {
  const select = h('select', { className: 'ws-input ws-query-input', ...(multiple ? { multiple: true, size: Math.min(6, Math.max(3, model.headers.length)) } : {}) });
  model.headers.forEach((header, index) => select.appendChild(h('option', { value: String(index) }, header)));
  if (multiple) [...select.options].forEach(option => { option.selected = false; });
  else if (model.headers.length) select.value = '0';
  return select;
}

function queryOptionSelect(options) {
  const select = h('select', { className: 'ws-input ws-query-input' });
  options.forEach(option => select.appendChild(h('option', { value: option.value }, option.label)));
  return select;
}

function querySelectedIndexes(select) {
  return [...select.options].filter(option => option.selected).map(option => Number(option.value)).filter(Number.isInteger);
}

function querySourceTableFromModel(model) {
  return {
    id: model.sourceId,
    name: model.sourceName,
    headers: model.baseHeaders,
    rows: model.baseRows,
  };
}

function queryCsvTextToTable(text, name) {
  const separator = detectCSVSeparator(text);
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === separator) {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index++;
      row.push(cell);
      if (row.some(value => value.trim() !== '')) records.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(value => value.trim() !== '')) records.push(row);
  }
  const headers = (records.shift() || []).map((header, index) => String(header).trim() || 'Columna ' + (index + 1));
  const rows = records.map(values => Array.from({ length: headers.length }, (_, index) => String(values[index] == null ? '' : values[index]).trim()));
  return { id: 'file-' + generateId(), name: name.replace(/\.[^.]+$/, ''), headers, rows };
}

function queryExportCsv(model) {
  const escape = value => {
    const text = String(value == null ? '' : value);
    return /[,"\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [model.headers.map(escape).join(','), ...model.rows.map(row => row.map(escape).join(','))].join('\n') + '\n';
}

function exportQueryResult() {
  const model = appStore.get('queryModel');
  if (!model || !model.headers.length) {
    toast('Carga una fuente antes de exportar', 'warning');
    return;
  }
  const blob = new Blob(['\uFEFF' + queryExportCsv(model)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: (model.sourceName || 'consulta') + '-transformado.csv' });
  anchor.click();
  URL.revokeObjectURL(url);
  toast('Consulta exportada como CSV', 'success');
}

function saveQueryResultAsTable() {
  const model = appStore.get('queryModel');
  const project = appStore.get('currentProject');
  if (!model || !project) {
    toast('Carga una fuente antes de guardar', 'warning');
    return;
  }
  const nameInput = h('input', { className: 'ws-input', type: 'text', value: (model.sourceName || 'Consulta') + ' transformada' });
  showModal({
    title: 'Guardar resultado como tabla',
    body: [queryFormField('Nombre de la tabla', nameInput, 'Se guardará dentro del proyecto actual.')],
    confirmText: 'Guardar tabla',
    onConfirm: async () => {
      const table = {
        id: generateId(),
        projectId: project.id,
        name: nameInput.value.trim() || 'Consulta transformada',
        headers: [...model.headers],
        rows: queryCloneRows(model.rows, model.headers.length),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveData(project.id, table);
      await refreshProjectCounts(project.id);
      await loadData(project.id);
      renderView('query');
      toast('Resultado guardado como tabla', 'success');
    },
  });
}

function importQueryFile() {
  const project = appStore.get('currentProject');
  if (!project) {
    toast('Selecciona un proyecto primero', 'warning');
    return;
  }
  const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,.jsonl,.ndjson,text/csv,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const validation = validateWorkspaceFile(file, ['.csv', '.tsv', '.txt', '.json', '.jsonl', '.ndjson']);
    if (!validation.ok) { toast(validation.message, 'warning'); return; }
    try {
      const text = await file.text();
      let table;
      if (/\.(jsonl|ndjson)$/i.test(file.name)) {
        const records = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
        const headers = [...new Set(records.flatMap(record => Object.keys(record || {})))];
        table = { id: 'file-' + generateId(), name: file.name.replace(/\.(jsonl|ndjson)$/i, ''), headers, rows: records.map(record => headers.map(header => record?.[header] == null ? '' : String(record[header]))) };
      } else if (/\.json$/i.test(file.name)) {
        const parsed = JSON.parse(text);
        const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : []);
        const headers = [...new Set(records.flatMap(record => Object.keys(record || {})))];
        table = { id: 'file-' + generateId(), name: file.name.replace(/\.json$/i, ''), headers, rows: records.map(record => headers.map(header => record?.[header] == null ? '' : String(record[header]))) };
      } else {
        table = queryCsvTextToTable(text, file.name);
      }
      const config = getWorkspaceConfig();
      if (table.headers.length > config.maxTableColumns || table.rows.length > config.maxTableRows) {
        toast(`La fuente supera el límite de ${config.maxTableRows.toLocaleString('es')} filas o ${config.maxTableColumns} columnas`, 'warning');
        return;
      }
      const currentSheets = appStore.get('querySheets') || [];
      const model = queryCreateModel(project, table, { sheetName: queryUniqueSheetName(currentSheets, table.name || 'Hoja nueva') });
      await queryPersistState(project.id, [...currentSheets, model], model);
      renderView('query');
      toast('Fuente cargada: ' + file.name, 'success');
    } catch (error) {
      toast('No se pudo leer la fuente: ' + error.message, 'error');
    }
  });
  input.click();
}

function queryRefresh(container, project, tables) {
  container.replaceChildren();
  renderQueryStudio(container, project, tables, appStore.get('queryModel'), appStore.get('querySheets'));
}

function openQueryOperation(operation, model, refresh) {
  const action = QUERY_ACTION_MAP[operation];
  if (!action) return;
  const body = [];
  const refs = {};
  const field = (label, control, help) => body.push(queryFormField(label, control, help));
  const input = (value, type = 'text') => h('input', { className: 'ws-input ws-query-input', type, value: value == null ? '' : String(value) });
  const columns = () => queryColumnSelect(model);
  const multipleColumns = () => queryColumnSelect(model, true);
  const immediate = ['remove-empty', 'remove-duplicates', 'add-index', 'promote-headers', 'transpose'];

  if (immediate.includes(operation)) {
    const config = operation === 'add-index' ? { name: 'Índice', start: 1 } : {};
    if (operation === 'remove-duplicates') {
      refs.indexes = multipleColumns();
      field('Comparar por columnas (opcional)', refs.indexes, 'Si no eliges ninguna, se compara toda la fila.');
    }
    if (operation === 'add-index') {
      refs.name = input('Índice');
      refs.start = input(1, 'number');
      field('Nombre', refs.name);
      field('Comenzar en', refs.start);
    }
    if (operation === 'promote-headers') {
      body.push(h('p', { className: 'ws-query-modal-note' }, 'La primera fila reemplazará los nombres actuales de las columnas.'));
    }
    if (body.length) {
      showModal({
        title: action.label,
        body,
        confirmText: 'Aplicar paso',
        onConfirm: async () => {
          if (operation === 'remove-duplicates') config.indexes = querySelectedIndexes(refs.indexes);
          if (operation === 'add-index') {
            config.name = refs.name.value.trim() || 'Índice';
            config.start = Number(refs.start.value) || 1;
          }
          queryApplyStep(model, operation, config, action.label);
          refresh();
        },
        size: 'small',
      });
    } else {
      queryApplyStep(model, operation, config, action.label);
      refresh();
    }
    return;
  }

  if (operation === 'filter') {
    refs.column = columns();
    refs.operator = queryOptionSelect([
      { value: 'equals', label: 'es igual a' },
      { value: 'not-equals', label: 'no es igual a' },
      { value: 'contains', label: 'contiene' },
      { value: 'starts-with', label: 'comienza con' },
      { value: 'ends-with', label: 'termina con' },
      { value: 'greater', label: 'es mayor que' },
      { value: 'less', label: 'es menor que' },
      { value: 'greater-equal', label: 'es mayor o igual que' },
      { value: 'less-equal', label: 'es menor o igual que' },
      { value: 'is-empty', label: 'está vacío' },
      { value: 'not-empty', label: 'no está vacío' },
    ]);
    refs.value = input('');
    field('Columna', refs.column);
    field('Condición', refs.operator);
    field('Valor', refs.value, 'No es necesario para “está vacío” y “no está vacío”.');
  } else if (operation === 'sort') {
    refs.column = columns();
    refs.direction = queryOptionSelect([{ value: 'asc', label: 'Ascendente' }, { value: 'desc', label: 'Descendente' }]);
    field('Ordenar por', refs.column);
    field('Dirección', refs.direction);
  } else if (operation === 'remove-rows' || operation === 'keep-rows') {
    refs.count = input(1, 'number');
    refs.position = queryOptionSelect([{ value: 'top', label: 'Desde el inicio' }, { value: 'bottom', label: 'Desde el final' }]);
    field('Número de filas', refs.count);
    field('Posición', refs.position);
  } else if (operation === 'remove-columns' || operation === 'choose-columns' || operation === 'reorder-columns') {
    refs.indexes = multipleColumns();
    field(operation === 'choose-columns' ? 'Columnas a conservar' : operation === 'remove-columns' ? 'Columnas a quitar' : 'Nuevo orden', refs.indexes, 'Usa Ctrl/Cmd para seleccionar varias.');
  } else if (operation === 'rename-column') {
    refs.column = columns();
    refs.name = input('');
    field('Columna', refs.column);
    field('Nuevo nombre', refs.name);
  } else if (operation === 'duplicate-column') {
    refs.column = columns();
    refs.name = input('');
    field('Columna', refs.column);
    field('Nombre de la copia', refs.name);
  } else if (operation === 'split-column') {
    refs.column = columns();
    refs.delimiter = input(',');
    refs.name = input('');
    field('Columna', refs.column);
    field('Separador', refs.delimiter, 'Ejemplos: coma, punto, guion o espacio.');
    field('Nombre de la segunda parte', refs.name);
  } else if (operation === 'merge-columns') {
    refs.indexes = multipleColumns();
    refs.separator = input(' ');
    refs.name = input('Columna combinada');
    field('Columnas', refs.indexes, 'Se combinarán siguiendo el orden visible.');
    field('Separador', refs.separator);
    field('Nombre del resultado', refs.name);
  } else if (operation === 'replace-values') {
    refs.column = columns();
    refs.find = input('');
    refs.replace = input('');
    refs.mode = queryOptionSelect([{ value: 'equals', label: 'Coincidencia exacta' }, { value: 'contains', label: 'Reemplazar dentro del texto' }]);
    field('Columna', refs.column);
    field('Buscar', refs.find);
    field('Reemplazar por', refs.replace);
    field('Modo', refs.mode);
  } else if (['trim', 'clean', 'uppercase', 'lowercase', 'fill-down', 'fill-up', 'detect-type'].includes(operation)) {
    refs.column = columns();
    field('Columna', refs.column, action.help);
  } else if (operation === 'group') {
    refs.group = columns();
    refs.aggregate = queryOptionSelect([
      { value: 'count', label: 'Contar filas' },
      { value: 'sum', label: 'Sumar valores' },
      { value: 'average', label: 'Promedio' },
      { value: 'min', label: 'Mínimo' },
      { value: 'max', label: 'Máximo' },
    ]);
    refs.value = columns();
    field('Agrupar por', refs.group);
    field('Operación', refs.aggregate);
    field('Columna de valores', refs.value, 'Se usa para suma, promedio, mínimo y máximo.');
  } else if (operation === 'custom-column') {
    refs.name = input('Columna personalizada');
    refs.mode = queryOptionSelect([{ value: 'constant', label: 'Texto fijo' }, { value: 'concat', label: 'Combinar columnas' }, { value: 'row-number', label: 'Número de fila' }]);
    refs.value = input('');
    refs.indexes = multipleColumns();
    refs.separator = input(' ');
    field('Nombre', refs.name);
    field('Tipo', refs.mode);
    field('Texto fijo', refs.value, 'Se usa cuando eliges “Texto fijo”.');
    field('Columnas a combinar', refs.indexes);
    field('Separador', refs.separator);
  }

  showModal({
    title: action.label,
    body,
    confirmText: 'Aplicar paso',
    onConfirm: async () => {
      const config = {};
      let summary = action.label;
      if (operation === 'filter') {
        config.index = Number(refs.column.value);
        config.operator = refs.operator.value;
        config.value = refs.value.value;
        summary = model.headers[config.index] + ' ' + refs.operator.options[refs.operator.selectedIndex].text + (config.value ? ' “' + config.value + '”' : '');
      } else if (operation === 'sort') {
        config.index = Number(refs.column.value);
        config.direction = refs.direction.value;
        summary = model.headers[config.index] + ' · ' + (config.direction === 'asc' ? 'ascendente' : 'descendente');
      } else if (operation === 'remove-rows' || operation === 'keep-rows') {
        config.count = Number(refs.count.value) || 0;
        config.position = refs.position.value;
        summary = config.count + ' filas · ' + (config.position === 'top' ? 'inicio' : 'final');
      } else if (operation === 'remove-columns' || operation === 'choose-columns' || operation === 'reorder-columns' || operation === 'merge-columns' || operation === 'remove-duplicates') {
        config.indexes = querySelectedIndexes(refs.indexes);
        if (!config.indexes.length) {
          toast('Selecciona al menos una columna', 'warning');
          return;
        }
        summary = config.indexes.map(index => model.headers[index]).join(', ');
        if (operation === 'merge-columns') {
          if (config.indexes.length < 2) {
            toast('Selecciona al menos dos columnas', 'warning');
            return;
          }
          config.separator = refs.separator.value;
          config.name = refs.name.value.trim() || 'Columna combinada';
        }
      } else if (operation === 'rename-column' || operation === 'duplicate-column') {
        config.index = Number(refs.column.value);
        config.name = refs.name.value.trim();
        if (!config.name) {
          toast('Escribe un nombre válido', 'warning');
          return;
        }
        summary = model.headers[config.index] + ' → ' + config.name;
      } else if (operation === 'split-column') {
        config.index = Number(refs.column.value);
        config.delimiter = refs.delimiter.value;
        config.name = refs.name.value.trim() || model.headers[config.index] + ' 2';
        summary = model.headers[config.index] + ' por “' + config.delimiter + '”';
      } else if (operation === 'replace-values') {
        config.index = Number(refs.column.value);
        config.find = refs.find.value;
        config.replace = refs.replace.value;
        config.mode = refs.mode.value;
        summary = model.headers[config.index] + ' · “' + config.find + '” → “' + config.replace + '”';
      } else if (['trim', 'clean', 'uppercase', 'lowercase', 'fill-down', 'fill-up', 'detect-type'].includes(operation)) {
        config.index = Number(refs.column.value);
        summary = model.headers[config.index];
      } else if (operation === 'group') {
        config.index = Number(refs.group.value);
        config.aggregate = refs.aggregate.value;
        config.valueIndex = Number(refs.value.value);
        summary = model.headers[config.index] + ' · ' + refs.aggregate.options[refs.aggregate.selectedIndex].text;
      } else if (operation === 'custom-column') {
        config.name = refs.name.value.trim() || 'Columna personalizada';
        config.mode = refs.mode.value;
        config.value = refs.value.value;
        config.indexes = querySelectedIndexes(refs.indexes);
        config.separator = refs.separator.value;
        summary = config.name;
      }
      queryApplyStep(model, operation, config, summary);
      refresh();
    },
    size: 'wide',
  });
}

function renderQueryPreview(model, filter = '') {
  const table = h('table', { className: 'ws-query-preview-table' });
  const thead = h('thead');
  const headerRow = h('tr');
  headerRow.appendChild(h('th', { className: 'ws-query-row-number' }, '#'));
  model.headers.forEach((header, index) => {
    headerRow.appendChild(h('th', null,
      h('span', { className: 'ws-query-type' }, queryColumnType(model.rows, index)),
      h('span', null, header)
    ));
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const query = String(filter || '').trim().toLocaleLowerCase('es');
  const visibleRows = model.rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    if (!query) return true;
    return row.some(value => String(value ?? '').toLocaleLowerCase('es').includes(query));
  });
  const tbody = h('tbody');
  visibleRows.slice(0, 150).forEach(({ row, index: rowIndex }) => {
    const tr = h('tr');
    tr.appendChild(h('td', { className: 'ws-query-row-number' }, String(rowIndex + 1)));
    model.headers.forEach((_, column) => tr.appendChild(h('td', { title: String(row[column] == null ? '' : row[column]) }, String(row[column] == null ? '' : row[column]))));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderQueryToolDrawer(model, refresh) {
  let selectedGroup = 'Todas';
  const groups = ['Todas', ...new Set(QUERY_ACTIONS.map(action => action.group))];
  const panel = h('aside', {
    className: 'ws-query-tools-panel',
    id: 'ws-query-tools-panel',
    ariaLabel: 'Cajón de herramientas de Query',
  });
  const search = h('input', {
    className: 'ws-input ws-query-tool-search',
    type: 'search',
    placeholder: 'Buscar transformaciones',
    ariaLabel: 'Buscar herramientas de Query',
    onInput: () => renderTools(),
  });
  const filters = h('div', {
    className: 'ws-query-tool-filters',
    role: 'tablist',
    'aria-label': 'Categorías de herramientas',
  });
  const list = h('div', { className: 'ws-query-tool-list' });
  const meta = h('div', { className: 'ws-query-tools-meta' });

  function renderTools() {
    const query = search.value.trim().toLocaleLowerCase('es');
    filters.replaceChildren(...groups.map(group => h('button', {
      className: 'ws-query-tool-filter' + (group === selectedGroup ? ' active' : ''),
      type: 'button',
      role: 'tab',
      'aria-selected': group === selectedGroup ? 'true' : 'false',
      onClick: () => {
        selectedGroup = group;
        renderTools();
      },
    }, group)));

    const filtered = QUERY_ACTIONS.filter(action => {
      const matchesGroup = selectedGroup === 'Todas' || action.group === selectedGroup;
      const haystack = (action.label + ' ' + action.help + ' ' + action.group).toLocaleLowerCase('es');
      return matchesGroup && (!query || haystack.includes(query));
    });
    meta.textContent = filtered.length + ' de ' + QUERY_ACTIONS.length + ' herramientas · Haz clic para configurar';
    list.replaceChildren();
    if (!filtered.length) {
      list.appendChild(h('div', { className: 'ws-query-tools-empty' }, svgIcon('search', 19), h('span', null, 'No hay herramientas que coincidan.')));
      return;
    }

    groups.filter(group => group !== 'Todas' && filtered.some(action => action.group === group)).forEach(group => {
      const groupActions = filtered.filter(action => action.group === group);
      const section = h('section', { className: 'ws-query-tool-section' },
        h('div', { className: 'ws-query-tool-group-head' },
          h('strong', null, group),
          h('span', null, String(groupActions.length).padStart(2, '0'))
        ),
        h('div', { className: 'ws-query-tool-buttons' }, ...groupActions.map(action => h('button', {
          className: 'ws-query-command',
          type: 'button',
          title: action.help,
          ariaLabel: action.label + '. ' + action.help,
          onClick: () => openQueryOperation(action.key, model, refresh),
        },
          h('span', { className: 'ws-query-command-icon' }, svgIcon(action.icon, 15)),
          h('span', { className: 'ws-query-command-copy' },
            h('strong', null, action.label),
            h('small', null, action.help)
          )
        )))
      );
      list.appendChild(section);
    });
  }

  panel.appendChild(h('div', { className: 'ws-query-tools-heading' },
    h('div', null,
      h('span', { className: 'ws-query-tools-kicker' }, 'TRANSFORMACIONES'),
      h('strong', null, 'Cajón de herramientas')
    ),
    h('span', { className: 'ws-query-panel-count' }, String(QUERY_ACTIONS.length))
  ));
  panel.appendChild(search);
  panel.appendChild(filters);
  panel.appendChild(meta);
  panel.appendChild(list);
  renderTools();
  return panel;
}

function queryRenderState(container, project, tables) {
  container.replaceChildren();
  renderQueryStudio(container, project, tables, appStore.get('queryModel'), appStore.get('querySheets'));
}

function querySheetSources(tables, currentModel) {
  const sources = [...tables];
  if (currentModel && !sources.some(source => source.id === currentModel.sourceId)) {
    sources.unshift({ ...querySourceTableFromModel(currentModel), queryOnly: true });
  }
  return sources;
}

function openQueryNewSheetModal(container, project, tables, currentModel) {
  const sheets = appStore.get('querySheets') || [];
  const sources = querySheetSources(tables, currentModel);
  if (!sources.length) {
    toast('Añade una fuente antes de crear una hoja', 'warning');
    return;
  }
  const name = h('input', {
    className: 'ws-input ws-query-input',
    type: 'text',
    value: queryUniqueSheetName(sheets, 'Hoja ' + (sheets.length + 1)),
    ariaLabel: 'Nombre de la hoja',
  });
  const source = h('select', { className: 'ws-input ws-query-input', ariaLabel: 'Fuente de la hoja' },
    ...sources.map(item => h('option', { value: item.id }, item.name || 'Fuente sin nombre'))
  );
  if (currentModel?.sourceId) source.value = currentModel.sourceId;
  showModal({
    title: 'Nueva hoja de consulta',
    body: [
      queryFormField('Nombre de la hoja', name, 'Cada hoja conserva sus propios pasos y resultado.'),
      queryFormField('Fuente inicial', source),
    ],
    confirmText: 'Crear hoja',
    onConfirm: async () => {
      const sourceTable = sources.find(item => item.id === source.value) || sources[0];
      const model = queryCreateModel(project, sourceTable, {
        sheetName: queryUniqueSheetName(sheets, name.value || 'Hoja ' + (sheets.length + 1)),
      });
      await queryPersistState(project.id, [...sheets, model], model);
      queryRenderState(container, project, tables);
      toast('Hoja creada: ' + model.sheetName, 'success');
    },
  });
}

function openQueryRenameSheetModal(container, project, tables, sheet, sheets, activeModel) {
  const name = h('input', {
    className: 'ws-input ws-query-input',
    type: 'text',
    value: sheet.sheetName,
    ariaLabel: 'Nombre de la hoja',
  });
  showModal({
    title: 'Renombrar hoja',
    body: [queryFormField('Nuevo nombre', name, 'Usa un nombre corto para encontrarla rápidamente.')],
    confirmText: 'Guardar nombre',
    onConfirm: async () => {
      sheet.sheetName = queryUniqueSheetName(sheets, name.value, sheet.sheetId);
      await queryPersistState(project.id, sheets, activeModel);
      queryRenderState(container, project, tables);
      toast('Hoja renombrada', 'success');
    },
  });
}

function deleteQuerySheet(container, project, tables, sheet, sheets, activeModel) {
  if (sheets.length <= 1) {
    toast('Query necesita al menos una hoja', 'info');
    return;
  }
  showModal({
    title: 'Eliminar ' + sheet.sheetName,
    content: h('p', { className: 'ws-query-modal-note' }, 'Se eliminarán sus pasos y su resultado guardado. Esta acción no afecta la fuente original.'),
    confirmText: 'Eliminar hoja',
    onConfirm: async () => {
      const index = sheets.findIndex(item => item.sheetId === sheet.sheetId);
      const nextSheets = sheets.filter(item => item.sheetId !== sheet.sheetId);
      const nextActive = activeModel?.sheetId === sheet.sheetId
        ? nextSheets[Math.max(0, index - 1)] || nextSheets[0]
        : activeModel;
      await queryPersistState(project.id, nextSheets, nextActive);
      queryRenderState(container, project, tables);
      toast('Hoja eliminada', 'success');
    },
  });
}

function renderQuerySheetBar(container, project, tables, sheets, activeModel) {
  const bar = h('section', { className: 'ws-query-sheetbar', ariaLabel: 'Hojas de consulta' });
  let tabsOpen = appStore.get('querySheetbarOpen') !== false;
  const setTabsOpen = open => {
    tabsOpen = open;
    appStore.set({ querySheetbarOpen: tabsOpen });
    bar.classList.toggle('ws-query-sheetbar-collapsed', !tabsOpen);
    tabsToggle.replaceChildren(svgIcon(tabsOpen ? 'chevronUp' : 'chevronDown', 14));
    tabsToggle.setAttribute('aria-expanded', String(tabsOpen));
    tabsToggle.setAttribute('aria-label', tabsOpen ? 'Minimizar barra de hojas' : 'Mostrar barra de hojas');
    tabsToggle.title = tabsOpen ? 'Minimizar barra de hojas' : 'Mostrar barra de hojas';
  };
  const tabsToggle = h('button', {
    className: 'ws-btn ws-btn-ghost ws-btn-sm ws-query-sheetbar-toggle',
    type: 'button',
    ariaLabel: 'Minimizar barra de hojas',
    title: 'Minimizar barra de hojas',
    'aria-expanded': 'true',
    onClick: () => setTabsOpen(!tabsOpen),
  }, svgIcon('chevronUp', 14));
  setTabsOpen(tabsOpen);
  const heading = h('div', { className: 'ws-query-sheetbar-heading' },
    h('div', null,
      h('span', { className: 'ws-query-sheetbar-kicker' }, 'LIBRO DE CONSULTAS'),
      h('strong', null, sheets.length + (sheets.length === 1 ? ' hoja' : ' hojas'))
    ),
    h('div', { className: 'ws-query-sheetbar-actions' },
      h('button', {
        className: 'ws-btn ws-btn-primary ws-btn-sm ws-query-new-sheet',
        type: 'button',
        ariaLabel: 'Nueva hoja de consulta',
        onClick: () => openQueryNewSheetModal(container, project, tables, activeModel),
      }, svgIcon('plus', 14), ' Nueva hoja'),
      tabsToggle
    )
  );
  const tabs = h('div', { className: 'ws-query-sheet-tabs', role: 'tablist', ariaLabel: 'Pestañas de hojas de consulta' });
  sheets.forEach(sheet => {
    const active = sheet.sheetId === activeModel?.sheetId;
    const tab = h('div', { className: 'ws-query-sheet-tab' + (active ? ' active' : ''), role: 'tab', 'aria-selected': active ? 'true' : 'false' });
    tab.appendChild(h('button', {
      className: 'ws-query-sheet-tab-main',
      type: 'button',
      ariaLabel: 'Activar hoja ' + sheet.sheetName,
      onClick: async () => {
        await queryPersistState(project.id, sheets, sheet);
        queryRenderState(container, project, tables);
      },
    }, svgIcon('table', 14), h('span', null, sheet.sheetName), h('small', null, sheet.rows.length + ' filas')));
    tab.appendChild(h('button', {
      className: 'ws-query-sheet-tab-action',
      type: 'button',
      ariaLabel: 'Renombrar hoja ' + sheet.sheetName,
      title: 'Renombrar hoja',
      onClick: () => openQueryRenameSheetModal(container, project, tables, sheet, sheets, activeModel),
    }, svgIcon('edit', 13)));
    tab.appendChild(h('button', {
      className: 'ws-query-sheet-tab-action ws-query-sheet-tab-delete',
      type: 'button',
      ariaLabel: 'Eliminar hoja ' + sheet.sheetName,
      title: 'Eliminar hoja',
      ...(sheets.length <= 1 ? { disabled: 'true' } : {}),
      onClick: () => deleteQuerySheet(container, project, tables, sheet, sheets, activeModel),
    }, svgIcon('trash', 13)));
    tabs.appendChild(tab);
  });
  tabs.tabIndex = -1;
  enableTablistKeyboard(tabs, { focusTarget: '.ws-query-sheet-tab-main' });
  bar.appendChild(heading);
  bar.appendChild(tabs);
  return bar;
}

function renderQueryRibbon(model, refresh, persist = () => Promise.resolve()) {
  const ribbon = h('section', { className: 'ws-query-ribbon', ariaLabel: 'Cinta de herramientas de Query' });
  const panels = {};
  const home = h('div', { className: 'ws-query-ribbon-panel active', 'data-query-ribbon-panel': 'Inicio', role: 'tabpanel', id: 'ws-query-panel-Inicio', 'aria-labelledby': 'ws-query-tab-Inicio' });
  const transform = h('div', { className: 'ws-query-ribbon-panel', 'data-query-ribbon-panel': 'Transformar', hidden: true, role: 'tabpanel', id: 'ws-query-panel-Transformar', 'aria-labelledby': 'ws-query-tab-Transformar' });
  const view = h('div', { className: 'ws-query-ribbon-panel', 'data-query-ribbon-panel': 'Vista', hidden: true, role: 'tabpanel', id: 'ws-query-panel-Vista', 'aria-labelledby': 'ws-query-tab-Vista' });
  panels.Inicio = home;
  panels.Transformar = transform;
  panels.Vista = view;
  const tabs = h('div', { className: 'ws-query-ribbon-tabs', role: 'tablist', ariaLabel: 'Pestañas de Query' });
  const activate = name => Object.entries(panels).forEach(([key, panel]) => {
    const active = key === name;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
    const tab = tabs.querySelector(`[data-query-ribbon-tab="${key}"]`);
    tab?.classList.toggle('active', active);
    tab?.setAttribute('aria-selected', String(active));
  });
  Object.keys(panels).forEach(name => tabs.appendChild(h('button', {
    className: 'ws-query-ribbon-tab' + (name === 'Inicio' ? ' active' : ''),
    type: 'button',
    role: 'tab',
    id: 'ws-query-tab-' + name,
    'aria-controls': 'ws-query-panel-' + name,
    'data-query-ribbon-tab': name,
    'aria-selected': name === 'Inicio' ? 'true' : 'false',
    onClick: () => activate(name),
  }, name)));
  enableTablistKeyboard(tabs);
  const actionButton = (key, label, icon, hint = '') => h('button', {
    className: 'ws-query-ribbon-command',
    type: 'button',
    title: hint || QUERY_ACTION_MAP[key]?.help || label,
    ariaLabel: hint || QUERY_ACTION_MAP[key]?.help || label,
    onClick: () => openQueryOperation(key, model, () => {
      persist().catch(error => reportError(error, 'query-ribbon-persist', { operation: key }));
      refresh();
    }),
  }, svgIcon(icon || QUERY_ACTION_MAP[key]?.icon || 'tool', 16), h('span', null, label));
  const group = (panel, label, ...items) => panel.appendChild(h('div', { className: 'ws-query-ribbon-group' }, h('span', { className: 'ws-query-ribbon-group-label' }, label), h('div', { className: 'ws-query-ribbon-group-items' }, ...items)));
  group(home, 'Consulta',
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Deshacer el último paso', onClick: () => { if (!model.steps.length) { toast('No hay pasos para deshacer', 'info'); return; } model.steps = model.steps.slice(0, -1); queryRebuildModel(model); persist().catch(error => reportError(error, 'query-ribbon-undo', {})); refresh(); toast('Último paso deshecho', 'success'); } }, svgIcon('undo', 16), h('span', null, 'Deshacer')),
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Rehacer la consulta desde la fuente', onClick: () => { if (!model.steps.length) { toast('La consulta ya está en la fuente original', 'info'); return; } model.steps = []; queryRebuildModel(model); persist().catch(error => reportError(error, 'query-ribbon-reset', {})); refresh(); toast('Consulta restablecida', 'success'); } }, svgIcon('rotate', 16), h('span', null, 'Restablecer')),
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Actualizar fuentes locales', onClick: refresh }, svgIcon('redo', 16), h('span', null, 'Actualizar'))
  );
  group(home, 'Filas', actionButton('filter', 'Filtrar', 'filter'), actionButton('sort', 'Ordenar', 'sort'), actionButton('remove-empty', 'Quitar vacías', 'trash'), actionButton('remove-duplicates', 'Duplicados', 'duplicate'));
  group(home, 'Columnas', actionButton('choose-columns', 'Elegir', 'grid'), actionButton('rename-column', 'Renombrar', 'edit'), actionButton('reorder-columns', 'Reordenar', 'sort'));
  group(home, 'Salida',
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Guardar el resultado como tabla del proyecto', onClick: saveQueryResultAsTable }, svgIcon('save', 16), h('span', null, 'Guardar tabla')),
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Preparar un informe con el resultado actual', onClick: () => createReportFromDataset({ title: model.sourceName || 'Consulta', headers: model.headers, rows: model.rows, sourceId: model.sourceId }) }, svgIcon('file', 16), h('span', null, 'Informe')),
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Exportar resultado', onClick: exportQueryResult }, svgIcon('download', 16), h('span', null, 'Exportar'))
  );
  const transformGroups = [...new Set(QUERY_ACTIONS.map(action => action.group))];
  transformGroups.forEach(groupName => group(transform, groupName, ...QUERY_ACTIONS.filter(action => action.group === groupName).map(action => actionButton(action.key, action.label, action.icon, action.help))));
  group(view, 'Lectura',
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Mostrar una lectura rápida de calidad de datos', onClick: () => {
      const empty = model.rows.reduce((total, row) => total + row.filter(value => String(value ?? '').trim() === '').length, 0);
      const numeric = model.headers.filter((_, index) => queryColumnType(model.rows, index) === '123').length;
      showModal({ title: 'Perfil de la consulta', content: h('div', { className: 'ws-table-insights-grid' }, h('div', null, h('strong', null, model.rows.length.toLocaleString('es')), h('span', null, 'filas')), h('div', null, h('strong', null, model.headers.length.toLocaleString('es')), h('span', null, 'columnas')), h('div', null, h('strong', null, empty.toLocaleString('es')), h('span', null, 'celdas vacías')), h('div', null, h('strong', null, numeric.toLocaleString('es')), h('span', null, 'columnas numéricas'))), confirmText: 'Cerrar', size: 'small' });
    } }, svgIcon('chart', 16), h('span', null, 'Perfil de datos')),
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Cambiar la densidad visual', onClick: toggleDensity }, svgIcon('grid', 16), h('span', null, 'Densidad')),
    h('button', { className: 'ws-query-ribbon-command', type: 'button', title: 'Abrir o cerrar el cajón de herramientas', onClick: () => document.querySelector('.ws-query-tools-toggle')?.click() }, svgIcon('wrench', 16), h('span', null, 'Cajones'))
  );
  const formula = h('div', { className: 'ws-query-formula-bar' },
    h('span', { className: 'ws-query-formula-label' }, 'fx'),
    h('span', { className: 'ws-query-formula-value' }, model.steps.length ? (model.steps[model.steps.length - 1].summary || model.steps[model.steps.length - 1].label || 'Último paso aplicado') : 'Fuente local · sin transformaciones'),
    h('span', { className: 'ws-query-formula-meta' }, model.steps.length + ' pasos')
  );
  ribbon.append(tabs, home, transform, view, formula);
  return ribbon;
}

function renderQueryStudio(container, project, tables, model, inputSheets) {
  const shell = h('div', { className: 'ws-query-studio' });
  const refresh = () => queryRefresh(container, project, tables);
  const sheets = Array.isArray(inputSheets) ? inputSheets : (model ? [model] : []);
  const sources = tables.map(table => ({ ...table, queryOnly: false }));
  if (model && !sources.some(source => source.id === model.sourceId)) sources.unshift({ ...querySourceTableFromModel(model), queryOnly: true });
  let workbench = null;
  let toolsToggle = null;
  let toolsOpen = appStore.get('queryToolsOpen') === true;
  const setToolsOpen = open => {
    toolsOpen = open;
    appStore.set({ queryToolsOpen: toolsOpen });
    workbench?.classList.toggle('ws-query-tools-closed', !toolsOpen);
    if (toolsToggle) {
      toolsToggle.setAttribute('aria-expanded', String(toolsOpen));
      toolsToggle.setAttribute('aria-label', toolsOpen ? 'Ocultar cajón de herramientas' : 'Abrir cajón de herramientas');
    }
  };
  toolsToggle = h('button', {
    className: 'ws-btn ws-btn-secondary ws-btn-sm ws-query-tools-toggle',
    type: 'button',
    ariaLabel: 'Abrir cajón de herramientas',
    'aria-expanded': 'false',
    'aria-controls': 'ws-query-tools-panel',
    onClick: () => setToolsOpen(!toolsOpen),
  }, svgIcon('wrench', 15), h('span', null, 'Herramientas'), h('span', { className: 'ws-query-tools-toggle-count' }, String(QUERY_ACTIONS.length)));

  const header = h('header', { className: 'ws-query-studio-header' },
    h('div', { className: 'ws-query-title-block' },
      h('span', { className: 'ws-query-kicker' }, 'DATA PREPARATION / 01'),
      h('h1', null, 'Toolisto Query'),
      h('p', null, 'Limpia, transforma y prepara datos con un cajón de herramientas al alcance.')
    ),
    h('div', { className: 'ws-query-header-actions' },
      model ? toolsToggle : null,
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: importQueryFile }, svgIcon('upload', 15), ' Nueva fuente'),
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', onClick: saveQueryResultAsTable }, svgIcon('save', 15), ' Guardar tabla'),
      h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', onClick: exportQueryResult }, svgIcon('download', 15), ' Exportar')
    )
  );
  shell.appendChild(header);
  if (model && sheets.length) shell.appendChild(renderQuerySheetBar(container, project, tables, sheets, model));
  if (model && sheets.length) shell.appendChild(renderQueryRibbon(model, refresh, () => queryPersistState(project.id, queryReplaceModelInSheets(sheets, model), model)));

  if (!model) {
    shell.appendChild(h('div', { className: 'ws-query-empty-state' },
      h('div', { className: 'ws-query-empty-art' }, svgIcon('table', 34)),
      h('div', { className: 'ws-query-empty-kicker' }, 'POWER QUERY / LOCAL'),
      h('h2', null, 'Empieza con una fuente de datos'),
      h('p', null, 'Importa un CSV, TSV o JSON, o crea primero una tabla desde el módulo Datos. Después podrás aplicar transformaciones y exportar el resultado.'),
      h('div', { className: 'ws-query-empty-actions' },
        h('button', { className: 'ws-btn ws-btn-primary', onClick: importQueryFile }, svgIcon('upload'), ' Importar fuente'),
        h('button', { className: 'ws-btn ws-btn-secondary', onClick: () => navigateTo('data') }, svgIcon('table'), ' Ir a Datos')
      )
    ));
    container.appendChild(shell);
    return;
  }

  workbench = h('div', { className: 'ws-query-workbench ws-query-tools-closed' });
  setToolsOpen(toolsOpen);
  let sourcePanel;
  let sourceOpen = appStore.get('querySourceOpen') !== false;
  const setSourceOpen = open => {
    sourceOpen = open;
    appStore.set({ querySourceOpen: sourceOpen });
    sourcePanel.classList.toggle('ws-query-panel-collapsed', !sourceOpen);
    workbench.classList.toggle('ws-query-source-collapsed', !sourceOpen);
    sourceToggle.replaceChildren(svgIcon(sourceOpen ? 'chevronLeftDouble' : 'chevronRightDouble', 14));
    sourceToggle.setAttribute('aria-expanded', String(sourceOpen));
    sourceToggle.setAttribute('aria-label', sourceOpen ? 'Minimizar cajón de fuentes' : 'Abrir cajón de fuentes');
    sourceToggle.title = sourceOpen ? 'Minimizar cajón de fuentes' : 'Abrir cajón de fuentes';
  };
  const sourceToggle = h('button', {
    className: 'ws-query-panel-toggle',
    type: 'button',
    ariaLabel: 'Minimizar cajón de fuentes',
    title: 'Minimizar cajón de fuentes',
    'aria-expanded': 'true',
    onClick: () => setSourceOpen(!sourceOpen),
  }, svgIcon('chevronLeftDouble', 14));
  sourcePanel = h('aside', { className: 'ws-query-source-panel' },
    h('div', { className: 'ws-query-panel-heading ws-query-collapsible-heading' },
      h('span', { className: 'ws-query-panel-label' }, 'Fuentes'),
      h('span', { className: 'ws-query-panel-count' }, String(sources.length)),
      sourceToggle
    )
  );
  setSourceOpen(sourceOpen);
  const sourcePanelBody = h('div', { className: 'ws-query-panel-body' });
  const sourceList = h('div', { className: 'ws-query-source-list' });
  sourcePanelBody.appendChild(sourceList);
  sources.forEach(source => {
    const active = source.id === model.sourceId;
    const sourceButton = h('button', { className: 'ws-query-source' + (active ? ' active' : ''), onClick: () => {
      if (active) return;
      const nextModel = queryCreateModel(project, source, { sheetId: model.sheetId, sheetName: model.sheetName });
      queryPersistState(project.id, queryReplaceModelInSheets(sheets, nextModel), nextModel).catch(e => reportError(e, 'persist', {}));
      renderQueryStudio(container, project, tables, nextModel, queryReplaceModelInSheets(sheets, nextModel));
    }},
      h('span', { className: 'ws-query-source-icon' }, svgIcon(source.queryOnly ? 'upload' : 'table', 15)),
      h('span', { className: 'ws-query-source-copy' }, h('strong', null, source.name || 'Fuente'), h('small', null, (source.rows || []).length + ' filas · ' + (source.headers || []).length + ' columnas')),
      active ? h('span', { className: 'ws-query-source-active' }, '♅') : null
    );
    sourceList.appendChild(sourceButton);
  });
  sourcePanelBody.appendChild(h('button', { className: 'ws-query-add-source', onClick: importQueryFile }, svgIcon('plus', 14), ' Añadir fuente'));
  sourcePanelBody.appendChild(h('div', { className: 'ws-query-field-section' },
    h('div', { className: 'ws-query-panel-heading' }, h('span', null, 'Campos'), h('span', { className: 'ws-query-panel-count' }, String(model.headers.length))),
    h('div', { className: 'ws-query-field-list' }, ...model.headers.map((header, index) => h('span', { className: 'ws-query-field' }, h('span', { className: 'ws-query-type' }, queryColumnType(model.rows, index)), header)))
  ));
  sourcePanel.appendChild(sourcePanelBody);
  workbench.appendChild(sourcePanel);
  workbench.appendChild(renderQueryToolDrawer(model, refresh));

  const main = h('section', { className: 'ws-query-main' });
  let previewFilter = '';
  const previewMeta = h('strong', null, model.rows.length + ' filas · ' + model.headers.length + ' columnas');
  let preview;
  const previewSearch = h('input', { className: 'ws-query-preview-search', type: 'search', placeholder: 'Buscar en la vista…', ariaLabel: 'Buscar en la vista previa', onInput: event => {
    previewFilter = event.target.value;
    const visible = model.rows.filter(row => !previewFilter || row.some(value => String(value ?? '').toLocaleLowerCase('es').includes(previewFilter.toLocaleLowerCase('es')))).length;
    previewMeta.textContent = visible + ' de ' + model.rows.length + ' filas · ' + model.headers.length + ' columnas';
    preview?.replaceChildren(renderQueryPreview(model, previewFilter));
  } });
  const previewHeader = h('div', { className: 'ws-query-preview-header' },
    h('div', null, h('span', { className: 'ws-query-preview-kicker' }, 'VISTA PREVIA'), previewMeta),
    h('div', { className: 'ws-query-preview-actions' },
      previewSearch,
      h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: () => {
        if (!model.steps.length) {
          toast('No hay pasos para deshacer', 'info');
          return;
        }
        model.steps = model.steps.slice(0, -1);
        queryRebuildModel(model);
        queryPersistState(project.id, queryReplaceModelInSheets(sheets, model), model).catch(e => reportError(e, 'persist', {}));
        refresh();
        toast('Último paso deshecho', 'success');
      }}, svgIcon('undo', 14), ' Deshacer'),
      h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', onClick: () => {
        model.steps = [];
        queryRebuildModel(model);
        queryPersistState(project.id, queryReplaceModelInSheets(sheets, model), model).catch(e => reportError(e, 'persist', {}));
        refresh();
        toast('Consulta restablecida', 'success');
      }}, svgIcon('rotate', 14), ' Restablecer')
    )
  );
  main.appendChild(previewHeader);
  preview = h('div', { className: 'ws-query-preview-scroll' }, renderQueryPreview(model));
  main.appendChild(preview);
  main.appendChild(h('div', { className: 'ws-query-preview-foot' }, model.rows.length > 150 ? 'Mostrando las primeras 150 filas de la vista previa.' : 'Vista previa completa · Los datos permanecen en este navegador.'));
  workbench.appendChild(main);

  let stepsPanel;
  let stepsOpen = appStore.get('queryStepsOpen') !== false;
  const setStepsOpen = open => {
    stepsOpen = open;
    appStore.set({ queryStepsOpen: stepsOpen });
    stepsPanel.classList.toggle('ws-query-panel-collapsed', !stepsOpen);
    workbench.classList.toggle('ws-query-steps-collapsed', !stepsOpen);
    stepsToggle.replaceChildren(svgIcon(stepsOpen ? 'chevronRightDouble' : 'chevronLeftDouble', 14));
    stepsToggle.setAttribute('aria-expanded', String(stepsOpen));
    stepsToggle.setAttribute('aria-label', stepsOpen ? 'Minimizar cajón de pasos' : 'Abrir cajón de pasos');
    stepsToggle.title = stepsOpen ? 'Minimizar cajón de pasos' : 'Abrir cajón de pasos';
  };
  const stepsToggle = h('button', {
    className: 'ws-query-panel-toggle',
    type: 'button',
    ariaLabel: 'Minimizar cajón de pasos',
    title: 'Minimizar cajón de pasos',
    'aria-expanded': 'true',
    onClick: () => setStepsOpen(!stepsOpen),
  }, svgIcon('chevronRightDouble', 14));
  stepsPanel = h('aside', { className: 'ws-query-steps-panel' },
    h('div', { className: 'ws-query-panel-heading ws-query-collapsible-heading' },
      h('span', { className: 'ws-query-panel-label' }, 'Pasos aplicados'),
      h('span', { className: 'ws-query-panel-count' }, String(model.steps.length)),
      stepsToggle
    )
  );
  setStepsOpen(stepsOpen);
  const stepsPanelBody = h('div', { className: 'ws-query-panel-body' });
  const stepsList = h('div', { className: 'ws-query-steps-list' });
  stepsPanelBody.appendChild(stepsList);
  if (!model.steps.length) {
    stepsList.appendChild(h('div', { className: 'ws-query-no-steps' }, svgIcon('flow', 22), h('span', null, 'Tus transformaciones aparecerán aquí.')));
  } else {
    model.steps.forEach((step, index) => {
      stepsList.appendChild(h('div', { className: 'ws-query-applied-step' },
        h('span', { className: 'ws-query-applied-num' }, String(index + 1).padStart(2, '0')),
        h('div', { className: 'ws-query-applied-copy' }, h('strong', null, step.label || step.operation), h('small', null, step.summary || 'Paso de transformación')),
        h('button', { className: 'ws-query-step-remove', ariaLabel: 'Eliminar paso ' + (index + 1), onClick: () => {
          model.steps = model.steps.filter((_, stepIndex) => stepIndex !== index);
          queryRebuildModel(model);
          queryPersistState(project.id, queryReplaceModelInSheets(sheets, model), model).catch(e => reportError(e, 'persist', {}));
          refresh();
        }}, svgIcon('close', 13))
      ));
    });
  }
  stepsPanelBody.appendChild(h('div', { className: 'ws-query-steps-tip' }, svgIcon('info', 13), 'Cada paso se puede revisar, quitar y volver a exportar.'));
  stepsPanel.appendChild(stepsPanelBody);
  workbench.appendChild(stepsPanel);
  shell.appendChild(workbench);
  shell.appendChild(h('footer', { className: 'ws-query-statusline' },
    h('span', null, svgIcon('check', 13), ' Fuente: ' + model.sourceName),
    h('span', null, 'Transformaciones: ' + model.steps.length),
    h('span', null, 'Salida: ' + model.rows.length + ' filas')
  ));
  container.appendChild(shell);
}

function renderQueryStudioView(container, project) {
  const loading = h('div', { className: 'ws-query-loading' }, svgIcon('table', 20), ' Cargando fuentes de datos…');
  container.appendChild(loading);
  Promise.all([loadData(project.id), loadSetting(querySheetsSettingKey(project.id))]).then(([tables, saved]) => {
    if (!container.isConnected || appStore.get('currentView') !== 'query') return;
    const restored = queryRestoreSheets(project, tables, saved);
    const model = restored.activeModel;
    querySetState(restored.sheets, model);
    if (!saved && model) queryPersistState(project.id, restored.sheets, model).catch(e => reportError(e, 'persist', {}));
    container.replaceChildren();
    renderQueryStudio(container, project, tables, model, restored.sheets);
  });
}

const DASHBOARD_WIDGET_TYPES = [
  { value: 'kpi', label: 'Indicador KPI' },
  { value: 'bar', label: 'Gráfico de barras' },
  { value: 'line', label: 'Gráfico de línea' },
  { value: 'pie', label: 'Gráfico de torta' },
  { value: 'donut', label: 'Gráfico de dona' },
  { value: 'table', label: 'Tabla de detalle' },
  { value: 'insights', label: 'Resumen inteligente' },
];

const DASHBOARD_AGGREGATES = [
  { value: 'count', label: 'Contar filas' },
  { value: 'sum', label: 'Sumar valores' },
  { value: 'average', label: 'Promedio' },
  { value: 'min', label: 'Mínimo' },
  { value: 'max', label: 'Máximo' },
];

function dashboardSettingKey(projectId) {
  return 'dashboard:' + projectId;
}

function dashboardDefaultConfig(project, tables) {
  const source = [...tables].sort((left, right) => (right.rows || []).length - (left.rows || []).length)[0] || { id: '', headers: [], rows: [] };
  const numericField = (source.headers || []).findIndex((_, index) => (source.rows || []).some(row => queryNumber(row[index]) !== null));
  const field = numericField >= 0 ? numericField : '';
  return {
    title: 'Panel ejecutivo',
    sourceId: source.id || '',
    filterColumn: '',
    filterValue: '',
    widgets: [
      { id: generateId(), type: 'kpi', title: 'Filas visibles', field: '', aggregate: 'count' },
      { id: generateId(), type: 'kpi', title: numericField >= 0 ? 'Total ' + source.headers[numericField] : 'Columnas', field, aggregate: numericField >= 0 ? 'sum' : 'count' },
      { id: generateId(), type: 'bar', title: 'Distribución por categoría', category: 0, field, aggregate: numericField >= 0 ? 'sum' : 'count' },
      { id: generateId(), type: 'table', title: 'Detalle reciente', columns: (source.headers || []).map((_, index) => index).slice(0, 5) },
    ],
  };
}

function dashboardNormalizeConfig(project, tables, saved) {
  const defaults = dashboardDefaultConfig(project, tables);
  if (!saved || typeof saved !== 'object') return defaults;
  const source = tables.find(table => table.id === saved.sourceId) || tables[0];
  const headers = source?.headers || [];
  const validWidgets = Array.isArray(saved.widgets) && saved.widgets.length ? saved.widgets : defaults.widgets;
  const widgets = validWidgets.map((widget, index) => ({
    ...widget,
    id: widget.id || generateId(),
    type: DASHBOARD_WIDGET_TYPES.some(item => item.value === widget.type) ? widget.type : 'kpi',
    title: String(widget.title || DASHBOARD_WIDGET_TYPES.find(item => item.value === widget.type)?.label || 'Visual ' + (index + 1)),
    field: widget.field === '' || widget.field == null ? '' : Number(widget.field),
    category: Number.isInteger(Number(widget.category)) ? Number(widget.category) : 0,
    aggregate: DASHBOARD_AGGREGATES.some(item => item.value === widget.aggregate) ? widget.aggregate : 'count',
    columns: Array.isArray(widget.columns)
      ? widget.columns.map(Number).filter(column => Number.isInteger(column) && column >= 0 && column < headers.length)
      : headers.map((_, column) => column).slice(0, 5),
  }));
  return {
    title: String(saved.title || defaults.title),
    sourceId: source?.id || '',
    filterColumn: saved.filterColumn === '' || saved.filterColumn == null ? '' : Number(saved.filterColumn),
    filterValue: String(saved.filterValue || ''),
    widgets,
  };
}

function dashboardVisibleRows(table, config) {
  const width = (table?.headers || []).length;
  const rows = (table?.rows || []).map(row => Array.from({ length: width }, (_, index) => String(row?.[index] == null ? '' : row[index])));
  const value = String(config.filterValue || '').trim().toLocaleLowerCase('es');
  if (!value) return rows;
  if (config.filterColumn === '') return rows.filter(row => row.some(cell => cell.toLocaleLowerCase('es').includes(value)));
  const column = Number(config.filterColumn);
  return rows.filter(row => String(row[column] || '').toLocaleLowerCase('es').includes(value));
}

function dashboardAggregate(rows, field, aggregate) {
  if (aggregate === 'count' || field === '') return rows.length;
  const numbers = rows.map(row => queryNumber(row[Number(field)])).filter(value => value !== null);
  if (!numbers.length) return 0;
  if (aggregate === 'sum') return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregate === 'average') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (aggregate === 'min') return Math.min(...numbers);
  return Math.max(...numbers);
}

function dashboardFormatNumber(value) {
  return Number(value || 0).toLocaleString('es', { maximumFractionDigits: 2 });
}

function dashboardChartItems(rows, widget) {
  const categoryIndex = Number(widget.category) || 0;
  const valueIndex = widget.field === '' ? '' : Number(widget.field);
  const groups = new Map();
  rows.forEach(row => {
    const category = String(row[categoryIndex] || 'Sin categoría').trim() || 'Sin categoría';
    const numeric = widget.aggregate === 'count' ? 1 : queryNumber(row[valueIndex]);
    if (widget.aggregate !== 'count' && numeric === null) return;
    const bucket = groups.get(category) || { sum: 0, count: 0, min: Infinity, max: -Infinity };
    const amount = widget.aggregate === 'count' ? 1 : numeric;
    bucket.sum += amount;
    bucket.count += 1;
    bucket.min = Math.min(bucket.min, amount);
    bucket.max = Math.max(bucket.max, amount);
    groups.set(category, bucket);
  });
  return [...groups.entries()].map(([label, bucket]) => ({
    label,
    value: widget.aggregate === 'count' ? bucket.count : widget.aggregate === 'average' ? bucket.sum / bucket.count : widget.aggregate === 'min' ? bucket.min : widget.aggregate === 'max' ? bucket.max : bucket.sum,
  })).sort((a, b) => b.value - a.value).slice(0, 8);
}

function dashboardSvg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key === 'className' ? 'class' : key === 'ariaLabel' ? 'aria-label' : key, String(value)));
  return node;
}

function renderDashboardChart(items, type) {
  if (!items.length) return h('div', { className: 'ws-dashboard-no-data' }, svgIcon('chart', 20), 'Sin datos para visualizar');
  if (type === 'pie' || type === 'donut') {
    const total = items.reduce((s, item) => s + item.value, 0) || 1;
    const cx = 140, cy = 125, r = 90, innerR = type === 'donut' ? 50 : 0;
    const svg = dashboardSvg('svg', { className: 'ws-dashboard-chart-svg', viewBox: '0 0 560 250', role: 'img', ariaLabel: type === 'pie' ? 'Gráfico de torta' : 'Gráfico de dona' });
    const colors = ['#FF6542','#5167E8','#4CAF50','#FFC107','#9C27B0','#00BCD4','#FF9800','#E91E63'];
    let startAngle = -Math.PI / 2;
    items.forEach((item, index) => {
      const slice = (item.value / total) * Math.PI * 2;
      const endAngle = startAngle + slice;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const large = slice > Math.PI ? 1 : 0;
      let d;
      if (type === 'donut') {
        const ix1 = cx + innerR * Math.cos(startAngle);
        const iy1 = cy + innerR * Math.sin(startAngle);
        const ix2 = cx + innerR * Math.cos(endAngle);
        const iy2 = cy + innerR * Math.sin(endAngle);
        d = `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${ix2} ${iy2} A${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
      } else {
        d = `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      }
      svg.appendChild(dashboardSvg('path', { d, fill: colors[index % colors.length], 'data-label': item.label, 'data-value': item.value }));
      startAngle = endAngle;
    });
    if (type === 'donut') {
      const ct = dashboardSvg('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', className: 'ws-dashboard-chart-tick' });
      ct.appendChild(document.createTextNode(dashboardFormatNumber(total)));
      svg.appendChild(ct);
    }
    const legend = h('div', { className: 'ws-dashboard-legend', style: 'display:flex;flex-wrap:wrap;gap:8px 16px;padding:12px 0 0;font-size:12px' });
    items.forEach((item, index) => {
      const pct = ((item.value / total) * 100).toFixed(1);
      const dot = h('span', { style: 'display:flex;align-items:center;gap:4px' },
        h('span', { style: 'width:10px;height:10px;border-radius:2px;background:' + colors[index % colors.length] + ';display:inline-block;flex-shrink:0' }),
        document.createTextNode(item.label.slice(0, 14) + ' (' + pct + '%)')
      );
      legend.appendChild(dot);
    });
    const wrapper = h('div', { className: 'ws-dashboard-chart' });
    wrapper.appendChild(svg);
    wrapper.appendChild(legend);
    return wrapper;
  }
  const svg = dashboardSvg('svg', { className: 'ws-dashboard-chart-svg', viewBox: '0 0 560 250', role: 'img', ariaLabel: type === 'line' ? 'Gráfico de línea' : 'Gráfico de barras' });
  const left = 38;
  const top = 16;
  const bottom = 48;
  const width = 560 - left - 14;
  const height = 250 - top - bottom;
  const max = Math.max(...items.map(item => item.value), 1);
  const points = items.map((item, index) => ({
    x: left + (items.length === 1 ? width / 2 : index * (width / (items.length - 1))),
    y: top + height - (item.value / max) * height,
  }));
  [0, .5, 1].forEach(step => {
    const y = top + height - step * height;
    svg.appendChild(dashboardSvg('line', { x1: left, y1: y, x2: 546, y2: y, className: 'ws-dashboard-chart-gridline' }));
    const tick = dashboardSvg('text', { x: 2, y: y + 4, className: 'ws-dashboard-chart-tick' });
    tick.appendChild(document.createTextNode(dashboardFormatNumber(max * step)));
    svg.appendChild(tick);
  });
  if (type === 'line') {
    const path = dashboardSvg('path', { d: points.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join(' '), className: 'ws-dashboard-chart-line' });
    svg.appendChild(path);
    points.forEach((point, index) => svg.appendChild(dashboardSvg('circle', { cx: point.x, cy: point.y, r: 4, className: 'ws-dashboard-chart-dot', 'data-label': items[index].label })));
  } else {
    const gap = 10;
    const barWidth = Math.max(18, (width - gap * (items.length - 1)) / items.length);
    items.forEach((item, index) => {
      const barHeight = Math.max(4, (item.value / max) * height);
      svg.appendChild(dashboardSvg('rect', { x: left + index * (barWidth + gap), y: top + height - barHeight, width: barWidth, height: barHeight, rx: 4, className: 'ws-dashboard-chart-bar' }));
    });
  }
  items.forEach((item, index) => {
    const label = dashboardSvg('text', { x: points[index].x, y: 230, className: 'ws-dashboard-chart-label', 'text-anchor': 'middle' });
    label.appendChild(document.createTextNode(item.label.slice(0, 12)));
    svg.appendChild(label);
  });
  const wrapper = h('div', { className: 'ws-dashboard-chart' });
  wrapper.appendChild(svg);
  return wrapper;
}

function renderDashboardWidget(widget, source, rows, config, index, commitConfig) {
  const headers = source.headers || [];
  const card = h('article', { className: 'ws-dashboard-widget-card ws-dashboard-widget-' + widget.type });
  const actions = h('div', { className: 'ws-dashboard-widget-actions' });
  const actionButton = (label, icon, action, disabled = false) => h('button', {
    className: 'ws-dashboard-widget-action',
    type: 'button',
    ariaLabel: label,
    title: label,
    ...(disabled ? { disabled: 'true' } : {}),
    onClick: action,
  }, svgIcon(icon, 13));
  actions.appendChild(actionButton('Subir visual', 'chevronUp', () => commitConfig(next => {
    if (index > 0) [next.widgets[index - 1], next.widgets[index]] = [next.widgets[index], next.widgets[index - 1]];
  }, 'Visual reordenado'), index === 0));
  actions.appendChild(actionButton('Bajar visual', 'chevronDown', () => commitConfig(next => {
    if (index < next.widgets.length - 1) [next.widgets[index], next.widgets[index + 1]] = [next.widgets[index + 1], next.widgets[index]];
  }, 'Visual reordenado'), index === config.widgets.length - 1));
  actions.appendChild(actionButton('Duplicar visual', 'duplicate', () => commitConfig(next => {
    next.widgets.splice(index + 1, 0, { ...next.widgets[index], id: generateId(), title: next.widgets[index].title + ' · copia' });
  }, 'Visual duplicado')));
  actions.appendChild(actionButton('Eliminar visual', 'trash', () => commitConfig(next => {
    next.widgets.splice(index, 1);
  }, 'Visual eliminado')));
  card.appendChild(h('div', { className: 'ws-dashboard-widget-header' },
    h('div', { className: 'ws-dashboard-widget-heading' },
      h('span', { className: 'ws-dashboard-widget-type' }, DASHBOARD_WIDGET_TYPES.find(item => item.value === widget.type)?.label || 'Visual'),
      h('h3', null, widget.title)
    ),
    actions
  ));

  if (widget.type === 'kpi') {
    const label = widget.field === '' ? 'filas visibles' : (headers[Number(widget.field)] || 'campo');
    const aggregateLabel = DASHBOARD_AGGREGATES.find(item => item.value === widget.aggregate)?.label || 'Conteo';
    card.appendChild(h('div', { className: 'ws-dashboard-kpi' },
      h('strong', null, dashboardFormatNumber(dashboardAggregate(rows, widget.field, widget.aggregate))),
      h('span', null, aggregateLabel + ' · ' + label)
    ));
    card.appendChild(h('div', { className: 'ws-dashboard-widget-foot' }, rows.length + ' filas visibles de ' + (source.rows || []).length));
  } else if (widget.type === 'bar' || widget.type === 'line' || widget.type === 'pie' || widget.type === 'donut') {
    card.appendChild(renderDashboardChart(dashboardChartItems(rows, widget), widget.type));
    card.appendChild(h('div', { className: 'ws-dashboard-widget-foot' }, (headers[Number(widget.category)] || 'Categoría') + ' · ' + (DASHBOARD_AGGREGATES.find(item => item.value === widget.aggregate)?.label || 'Conteo')));
  } else if (widget.type === 'table') {
    const columns = (widget.columns || headers.map((_, column) => column)).filter(column => headers[column] != null).slice(0, 6);
    const table = h('table', { className: 'ws-dashboard-data-table' });
    table.appendChild(h('thead', null, h('tr', null, ...columns.map(column => h('th', null, headers[column])))));
    table.appendChild(h('tbody', null, ...rows.slice(0, 8).map(row => h('tr', null, ...columns.map(column => h('td', { title: row[column] }, row[column]))))));
    card.appendChild(h('div', { className: 'ws-dashboard-table-scroll' }, table));
    card.appendChild(h('div', { className: 'ws-dashboard-widget-foot' }, 'Primeras ' + Math.min(rows.length, 8) + ' filas · ' + columns.length + ' columnas'));
  } else {
    const numericColumns = headers.map((_, column) => column).filter(column => rows.some(row => queryNumber(row[column]) !== null)).slice(0, 3);
    const insightItems = numericColumns.map(column => h('div', { className: 'ws-dashboard-insight' },
      h('span', null, headers[column]),
      h('strong', null, dashboardFormatNumber(dashboardAggregate(rows, column, 'sum')))
    ));
    if (!insightItems.length) insightItems.push(h('div', { className: 'ws-dashboard-no-data' }, svgIcon('info', 18), 'Añade datos numéricos para generar indicadores.'));
    card.appendChild(h('div', { className: 'ws-dashboard-insights' }, ...insightItems));
  }
  return card;
}

async function saveDashboardConfig(project, config) {
  await saveSetting(dashboardSettingKey(project.id), config);
  appStore.set({ dashboardConfig: config, isDirty: false, lastSaved: Date.now() });
}

function openDashboardWidgetModal(source, commitConfig) {
  const headers = source.headers || [];
  const title = h('input', { className: 'ws-input', type: 'text', value: 'Nuevo visual' });
  const type = h('select', { className: 'ws-input' }, ...DASHBOARD_WIDGET_TYPES.map(item => h('option', { value: item.value }, item.label)));
  const category = h('select', { className: 'ws-input' }, ...headers.map((header, index) => h('option', { value: index }, header)));
  const field = h('select', { className: 'ws-input' },
    h('option', { value: '' }, 'Conteo de filas'),
    ...headers.map((header, index) => h('option', { value: index }, header))
  );
  const aggregate = h('select', { className: 'ws-input' }, ...DASHBOARD_AGGREGATES.map(item => h('option', { value: item.value }, item.label)));
  showModal({
    title: 'Añadir visual al dashboard',
    body: [
      queryFormField('Nombre del visual', title, 'Usa un nombre que explique qué estás midiendo.'),
      queryFormField('Tipo de visual', type),
      queryFormField('Categoría o eje', category),
      queryFormField('Campo de valores', field),
      queryFormField('Agregación', aggregate),
    ],
    confirmText: 'Añadir visual',
    size: 'wide',
    onConfirm: async () => {
      const widgetType = type.value;
      await commitConfig(next => {
        next.widgets.push({
          id: generateId(),
          type: widgetType,
          title: title.value.trim() || 'Nuevo visual',
          category: Number(category.value) || 0,
          field: field.value === '' ? '' : Number(field.value),
          aggregate: aggregate.value,
          columns: headers.map((_, index) => index).slice(0, 5),
        });
      }, 'Visual añadido');
    },
  });
}

function renderDashboardBuilder(container, project, tables, initialConfig) {
  const config = dashboardNormalizeConfig(project, tables, initialConfig);
  const source = tables.find(table => table.id === config.sourceId) || tables[0];
  const rows = dashboardVisibleRows(source, config);
  const shell = h('div', { className: 'ws-dashboard-shell', style: 'animation:fadeIn 0.3s ease' });
  const commitConfig = async (mutate, message) => {
    const next = {
      ...config,
      widgets: config.widgets.map(widget => ({ ...widget, columns: [...(widget.columns || [])] })),
    };
    mutate(next);
    try {
      await saveDashboardConfig(project, next);
      container.replaceChildren();
      renderDashboardBuilder(container, project, tables, next);
      if (message) toast(message, 'success');
    } catch (error) {
      toast('No se pudo guardar el dashboard local', 'error');
    }
  };
  const header = h('header', { className: 'ws-dashboard-header' },
    h('div', { className: 'ws-dashboard-title-block' },
      h('span', { className: 'ws-query-kicker' }, 'ANALYTICS / LOCAL'),
      h('h1', null, config.title),
      h('p', null, 'Construye indicadores, gráficos y tablas a partir de tus datos, sin salir del navegador.')
    ),
    h('div', { className: 'ws-dashboard-header-actions' },
      h('span', { className: 'ws-status-chip ws-status-limited' }, 'EDITABLE'),
      h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', type: 'button', onClick: () => openDashboardWidgetModal(source, commitConfig), ariaLabel: 'Añadir visual al dashboard' }, svgIcon('plus', 15), ' Añadir visual'),
      h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', type: 'button', onClick: () => {
        const fresh = dashboardDefaultConfig(project, tables);
        saveDashboardConfig(project, fresh).then(() => {
          container.replaceChildren();
          renderDashboardBuilder(container, project, tables, fresh);
          toast('Dashboard restablecido', 'success');
        });
      } }, svgIcon('rotate', 15), ' Restablecer')
    )
  );
  shell.appendChild(header);

  if (!source) {
    shell.appendChild(h('div', { className: 'ws-dashboard-empty' },
      h('div', { className: 'ws-dashboard-empty-icon' }, svgIcon('chart', 30)),
      h('h2', null, 'Conecta tu primer conjunto de datos'),
      h('p', null, 'Crea una tabla o importa un archivo desde Datos para empezar a construir visualizaciones.'),
      h('div', { className: 'ws-dashboard-empty-actions' },
        h('button', { className: 'ws-btn ws-btn-primary', onClick: () => navigateTo('data') }, svgIcon('table', 16), ' Ir a Datos'),
        h('button', { className: 'ws-btn ws-btn-secondary', onClick: createNewDataTable }, svgIcon('plus', 16), ' Nueva tabla')
      )
    ));
    container.appendChild(shell);
    return;
  }

  const sourceSelect = h('select', { className: 'ws-dashboard-select', value: source.id, ariaLabel: 'Fuente de datos del dashboard', onChange: event => commitConfig(next => {
    next.sourceId = event.target.value;
    next.filterColumn = '';
    next.filterValue = '';
  }, 'Fuente actualizada') }, ...tables.map(table => h('option', { value: table.id }, table.name || 'Tabla sin nombre')));
  const filterColumn = h('select', { className: 'ws-dashboard-select', value: String(config.filterColumn), ariaLabel: 'Columna del filtro' },
    h('option', { value: '' }, 'Todas las columnas'),
    ...source.headers.map((header, index) => h('option', { value: index }, header))
  );
  const filterValue = h('input', { className: 'ws-dashboard-filter-input', type: 'search', value: config.filterValue, placeholder: 'Filtrar valores...' });
  const controls = h('section', { className: 'ws-dashboard-controls' },
    h('div', { className: 'ws-dashboard-control-group ws-dashboard-source-control' },
      h('label', null, 'Fuente'), sourceSelect,
      h('button', { className: 'ws-dashboard-view-data', type: 'button', onClick: () => navigateTo('data-table', { dataTable: source }), ariaLabel: 'Abrir fuente de datos' }, svgIcon('table', 14), ' Ver datos')
    ),
    h('div', { className: 'ws-dashboard-control-group' },
      h('label', null, 'Filtro rápido'),
      h('div', { className: 'ws-dashboard-filter-row' }, filterColumn, filterValue,
        h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', type: 'button', onClick: () => commitConfig(next => {
          next.filterColumn = filterColumn.value === '' ? '' : Number(filterColumn.value);
          next.filterValue = filterValue.value;
        }, 'Filtro aplicado') }, svgIcon('filter', 14), ' Aplicar'),
        h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', type: 'button', onClick: () => commitConfig(next => {
          next.filterColumn = '';
          next.filterValue = '';
        }, 'Filtro limpiado') }, 'Limpiar')
      )
    )
  );
  shell.appendChild(controls);
  shell.appendChild(h('div', { className: 'ws-dashboard-summary' },
    h('div', null, h('strong', null, dashboardFormatNumber(rows.length)), h('span', null, 'filas visibles')),
    h('div', null, h('strong', null, dashboardFormatNumber(source.headers.length)), h('span', null, 'campos')),
    h('div', null, h('strong', null, dashboardFormatNumber(config.widgets.length)), h('span', null, 'visuales')),
    h('div', { className: 'ws-dashboard-summary-source' }, svgIcon('check', 14), h('span', null, 'Guardado local'))
  ));
  const grid = h('section', { className: 'ws-dashboard-grid', ariaLabel: 'Visuales del dashboard' });
  if (!config.widgets.length) {
    grid.appendChild(h('div', { className: 'ws-dashboard-no-widgets' }, svgIcon('plus', 22), h('strong', null, 'Añade tu primer visual'), h('span', null, 'Crea un KPI, gráfico o tabla de detalle.')));
  } else {
    config.widgets.forEach((widget, index) => grid.appendChild(renderDashboardWidget(widget, source, rows, config, index, commitConfig)));
  }
  shell.appendChild(grid);
  shell.appendChild(h('footer', { className: 'ws-dashboard-footer' }, svgIcon('info', 13), 'Los cálculos se actualizan en este navegador y se guardan dentro del proyecto actual.'));
  container.appendChild(shell);
}

function renderDashboardsView(container, project) {
  const loading = h('div', { className: 'ws-dashboard-loading' }, svgIcon('chart', 22), ' Cargando dashboard local…');
  container.appendChild(loading);
  Promise.all([loadData(project.id), loadSetting(dashboardSettingKey(project.id))]).then(([tables, saved]) => {
    if (!container.isConnected || appStore.get('currentView') !== 'dashboards') return;
    const config = dashboardNormalizeConfig(project, tables, saved);
    appStore.set({ dataTables: tables, dashboardConfig: config });
    container.replaceChildren();
    renderDashboardBuilder(container, project, tables, config);
  }).catch(() => {
    container.replaceChildren(h('div', { className: 'ws-dashboard-empty' },
      h('div', { className: 'ws-dashboard-empty-icon' }, svgIcon('close', 28)),
      h('h2', null, 'No se pudo cargar el dashboard'),
      h('p', null, 'Actualiza la vista e inténtalo de nuevo.')
    ));
  });
}

async function saveFlowImageResult(project, blob, name) {
  const dataUrl = await readFileAsDataUrl(blob);
  const start = Date.now();
  const asset = createImageAsset(name || 'Imagen del flujo', project.id, null);
  asset.dataUrl = dataUrl;
  asset.originalDataUrl = dataUrl;
  asset.type = 'image-asset';
  asset.metadata = { captureType: 'workflow-result' };
  const capture = {
    id: generateId(),
    projectId: project.id,
    type: 'workflow-result',
    timestamp: Date.now(),
    name: name || 'Imagen del flujo',
    correctedAssetId: asset.id,
  };
  asset.metadata = { captureType: 'workflow-result', captureId: capture.id };
  addRelation(capture, asset.id, 'asset');
  addRelation(asset, capture.id, 'source-capture');
  await saveAsset(project.id, asset);
  await saveCapture(project.id, capture);
  pushHistory(asset, 'imported', `Imagen del flujo guardada como captura`);
  await registerExecution(project.id, 'workflow-image-import', 'Guardar imagen de flujo', {
    inputAssetIds: [asset.id],
    parameters: { name },
    resultType: 'image-asset',
    resultAssetId: asset.id,
    startedAt: start,
    status: 'completed',
  });
  appStore.set({ captures: [capture, ...appStore.get('captures').filter(c => c.id !== capture.id)], lastSaved: Date.now() });
  return { capture, asset };
}

async function resolveFlowCaptureImage(captureId) {
  if (!captureId) return null;
  const capture = (appStore.get('captures') || []).find(c => c.id === captureId) || await loadCaptureById(captureId).catch(() => null);
  if (!capture) return null;
  const dataUrl = await resolveCaptureImageDataUrl(capture, loadAsset);
  if (!dataUrl) return null;
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, name: capture.name || 'Captura' };
}

function renderWorkflowView(container) {
  container.replaceChildren();
  if (!_operationRegistry) {
    container.appendChild(h('div', { style: 'padding:32px;text-align:center;color:var(--ws-text-tertiary)' }, 'Motor de flujos no disponible'));
    return;
  }
  if (!workflowUI) {
    workflowUI = createWorkflowUI(_operationRegistry, {
      h, svgIcon, appStore, toast, showModal, closeModal, reportError, showWarning,
      saveDoc, saveData, refreshProjectCounts,
      saveImageCapture: saveFlowImageResult,
      resolveCaptureImage: resolveFlowCaptureImage,
      pushHistory: (data) => { if (_appHistory) _appHistory.push(_captureWorkspaceState(), data); },
      createInstructionAssistant,
    });
  }
  workflowUIContainer = container;
  workflowUI.render(container);
  const pendingInputs = appStore.get('pendingWorkflowInputs');
  if (Array.isArray(pendingInputs) && pendingInputs.length > 0) {
    const added = workflowUI.addWorkspaceItems(pendingInputs);
    appStore.set({ pendingWorkflowInputs: null });
    if (added) toast('Entrada del proyecto preparada para encadenar operaciones', 'success');
  }
}

function startWorkflowFromWorkspace(item) {
  if (!item || !item.id || !['document', 'data', 'image'].includes(item.kind)) return;
  appStore.set({ pendingWorkflowInputs: [item] });
  navigateTo('flujos');
}

function renderFlowView(container, project, initialSelectedId = null) {
  container.replaceChildren();
  const nodes = Array.isArray(appStore.get('flowNodes')) ? appStore.get('flowNodes') : [];
  const edges = Array.isArray(appStore.get('flowEdges')) ? appStore.get('flowEdges') : [];
  const operations = _operationRegistry ? _operationRegistry.list() : [];
  let selectedNodeId = initialSelectedId && nodes.some(node => node.id === initialSelectedId) ? initialSelectedId : (nodes[0]?.id || null);
  let pendingPort = null;
  const nodeEls = new Map();
  const edgeLayer = sv('svg', { class: 'ws-flow-edges', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const flowStatusText = h('span', null, nodes.length ? 'Selecciona un nodo para editarlo.' : 'Añade un nodo y configúralo en el panel lateral.');
  const statusChip = h('span', { className: 'ws-status-chip ws-status-limited' }, nodes.length ? 'EDITABLE' : 'LISTO');
  const canvas = h('div', { className: 'ws-flow-canvas', role: 'application', ariaLabel: 'Lienzo visual de Toolisto Flow' });
  const inspector = h('aside', { className: 'ws-flow-inspector', 'aria-label': 'Inspector de nodo' });
  const el = h('div', { className: 'ws-flow', style: 'height:100%;position:relative' });
  const scheduleFlowSave = () => {
    appStore.set({ flowNodes: nodes, flowEdges: edges, isDirty: true });
    clearTimeout(scheduleFlowSave.timer);
    scheduleFlowSave.timer = setTimeout(async () => {
      await _flushAndSaveSession();
      appStore.set({ isDirty: false });
    }, 650);
  };
  const commitFlowEdit = (action) => {
    scheduleFlowSave();
    _appHistory.push(_captureWorkspaceState(), { action });
  };
  const operationDefaults = (op) => Object.fromEntries(Object.entries(op?.optionSchema || {}).map(([key, schema]) => [key, schema.default ?? (schema.type === 'checkbox' ? false : '')]));
  const getEdgeFrom = edge => edge.from || edge.source || edge.sourceId || edge.sourceNodeId;
  const getEdgeTo = edge => edge.to || edge.target || edge.targetId || edge.targetNodeId;
  const findNode = id => nodes.find(node => node.id === id);

  function redrawEdges() {
    edgeLayer.replaceChildren();
    edges.forEach(edge => {
      const from = findNode(getEdgeFrom(edge));
      const to = findNode(getEdgeTo(edge));
      if (!from || !to) return;
      const sourceEl = nodeEls.get(from.id);
      const targetEl = nodeEls.get(to.id);
      if (!sourceEl || !targetEl) return;
      const x1 = Number(from.x || 0) + sourceEl.offsetWidth;
      const y1 = Number(from.y || 0) + sourceEl.offsetHeight / 2;
      const x2 = Number(to.x || 0);
      const y2 = Number(to.y || 0) + targetEl.offsetHeight / 2;
      const bend = Math.max(35, Math.abs(x2 - x1) * .45);
      edgeLayer.appendChild(sv('path', { class: 'ws-flow-edge', d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` }));
    });
  }

  function selectNode(node) {
    selectedNodeId = node.id;
    nodeEls.forEach((nodeEl, id) => nodeEl.classList.toggle('selected', id === selectedNodeId));
    renderInspector(node);
    flowStatusText.textContent = `Editando «${node.title || 'Nodo'}» · arrastra para moverlo`;
  }

  function connectNodes(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      toast('El origen y el destino deben ser nodos distintos', 'warning');
      return;
    }
    if (edges.some(edge => getEdgeFrom(edge) === sourceId && getEdgeTo(edge) === targetId)) {
      toast('Esa conexión ya existe', 'info');
      return;
    }
    edges.push({ id: generateId(), from: sourceId, to: targetId, source: sourceId, target: targetId });
    pendingPort = null;
    commitFlowEdit('flow-connect');
    renderFlowView(container, project, selectedNodeId);
  }

  function handlePort(node, side) {
    if (!pendingPort) {
      pendingPort = { nodeId: node.id, side };
      flowStatusText.textContent = `Conexión iniciada desde ${side === 'right' ? 'la salida' : 'la entrada'} de «${node.title || 'Nodo'}». Elige otro puerto.`;
      return;
    }
    const first = pendingPort;
    const from = first.side === 'right' ? first.nodeId : node.id;
    const to = first.side === 'right' ? node.id : first.nodeId;
    connectNodes(from, to);
  }

  function renderInspector(node) {
    inspector.replaceChildren();
    if (!node) {
      inspector.appendChild(h('div', { className: 'ws-flow-inspector-empty' },
        h('div', { className: 'ws-flow-inspector-icon' }, svgIcon('flow', 22)),
        h('strong', null, 'Construye tu flujo'),
        h('p', null, 'Cada nodo representa una operación. Selecciónalo para cambiar su nombre, descripción, operación y parámetros.'),
        h('ol', null, h('li', null, 'Añade un nodo'), h('li', null, 'Configúralo aquí'), h('li', null, 'Conecta salida con entrada'), h('li', null, 'Valida el flujo'))
      ));
      return;
    }
    const op = node.operationId ? _operationRegistry?.get(node.operationId) : null;
    const titleInput = h('input', { className: 'ws-input', type: 'text', value: node.title || '', placeholder: 'Nombre del nodo', ariaLabel: 'Nombre del nodo' });
    const descriptionInput = h('textarea', { className: 'ws-input ws-flow-description', placeholder: 'Explica qué hace este paso', ariaLabel: 'Descripción del nodo' });
    descriptionInput.value = node.description || '';
    titleInput.addEventListener('input', () => { node.title = titleInput.value; scheduleFlowSave(); });
    descriptionInput.addEventListener('input', () => { node.description = descriptionInput.value; scheduleFlowSave(); });
    const typeSelect = h('select', { className: 'ws-input', ariaLabel: 'Tipo de nodo' }, ...[
      ['tool', 'Operación'], ['input', 'Entrada'], ['output', 'Salida'], ['logic', 'Lógica']
    ].map(([value, label]) => h('option', { value }, label)));
    typeSelect.value = node.type || 'tool';
    typeSelect.addEventListener('change', () => { node.type = typeSelect.value; commitFlowEdit('flow-node-type'); renderFlowView(container, project, node.id); });
    const operationSelect = h('select', { className: 'ws-input', ariaLabel: 'Operación del nodo' });
    operationSelect.appendChild(h('option', { value: '' }, 'Elegir operación…'));
    operations.forEach(candidate => operationSelect.appendChild(h('option', { value: candidate.id }, `${candidate.name} · ${candidate.category}`)));
    operationSelect.value = node.operationId || '';
    operationSelect.addEventListener('change', () => {
      const next = _operationRegistry?.get(operationSelect.value);
      node.operationId = next?.id || '';
      if (next) { node.title = next.name; node.description = next.description; node.options = operationDefaults(next); }
      commitFlowEdit('flow-node-operation');
      renderFlowView(container, project, node.id);
    });
    const field = (label, control, hint = '') => h('label', { className: 'ws-flow-field' }, h('span', null, label), control, hint ? h('small', null, hint) : null);
    const settings = h('div', { className: 'ws-flow-node-settings' });
    Object.entries(op?.optionSchema || {}).forEach(([key, schema]) => {
      const current = node.options?.[key] ?? schema.default ?? '';
      let control;
      if (schema.type === 'select') {
        control = h('select', { className: 'ws-input', 'data-flow-option': key }, ...(schema.options || []).map(item => h('option', { value: String(item.value) }, item.label)));
        control.value = String(current);
      } else if (schema.type === 'checkbox') {
        control = h('input', { type: 'checkbox', 'data-flow-option': key });
        control.checked = current === true || current === 'true';
      } else {
        control = h('input', { className: 'ws-input', type: schema.type === 'number' || schema.type === 'range' ? schema.type : 'text', value: current, min: schema.min, max: schema.max, step: schema.step, 'data-flow-option': key });
      }
      const updateOption = () => { node.options = node.options || {}; node.options[key] = control.type === 'checkbox' ? control.checked : control.value; scheduleFlowSave(); };
      control.addEventListener('input', updateOption); control.addEventListener('change', updateOption);
      settings.appendChild(field(schema.label || key, control, schema.required ? 'Necesario para ejecutar esta operación.' : ''));
    });
    const targetSelect = h('select', { className: 'ws-input', ariaLabel: 'Nodo de destino' }, h('option', { value: '' }, 'Selecciona un destino…'), ...nodes.filter(candidate => candidate.id !== node.id).map(candidate => h('option', { value: candidate.id }, candidate.title || 'Nodo')));
    const connectButton = h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', type: 'button', onClick: () => connectNodes(node.id, targetSelect.value) }, svgIcon('flow', 14), ' Conectar salida');
    const connected = edges.filter(edge => getEdgeFrom(edge) === node.id || getEdgeTo(edge) === node.id);
    const connections = h('div', { className: 'ws-flow-connections' }, h('span', { className: 'ws-flow-section-label' }, `Conexiones · ${connected.length}`));
    connected.forEach(edge => {
      const otherId = getEdgeFrom(edge) === node.id ? getEdgeTo(edge) : getEdgeFrom(edge);
      const other = findNode(otherId);
      connections.appendChild(h('button', { className: 'ws-flow-connection', type: 'button', title: 'Seleccionar conexión', onClick: () => { const target = findNode(otherId); if (target) selectNode(target); } }, h('span', null, getEdgeFrom(edge) === node.id ? '→' : '←'), h('span', null, other?.title || 'Nodo')));
    });
    inspector.append(
      h('div', { className: 'ws-flow-inspector-heading' }, h('div', null, h('span', { className: 'ws-flow-inspector-kicker' }, 'INSPECTOR / NODO'), h('strong', null, 'Configura este paso')), h('span', { className: 'ws-flow-inspector-id' }, String(nodes.indexOf(node) + 1).padStart(2, '0'))),
      field('Nombre', titleInput),
      field('Tipo', typeSelect),
      field('Operación', operationSelect, op ? `${op.inputKinds.join(', ')} → ${op.outputKind}` : 'Elige una operación para activar sus parámetros.'),
      field('Descripción', descriptionInput),
      settings,
      h('div', { className: 'ws-flow-connect-box' }, h('span', { className: 'ws-flow-section-label' }, 'Conectar'), targetSelect, connectButton),
      connections,
      h('button', { className: 'ws-btn ws-btn-danger ws-btn-sm ws-flow-delete-node', type: 'button', onClick: () => {
        showConfirm({ title: 'Eliminar nodo', message: `Se quitará «${node.title || 'Nodo'}» y sus conexiones.`, confirmText: 'Eliminar', onConfirm: () => {
          const index = nodes.findIndex(candidate => candidate.id === node.id);
          if (index >= 0) nodes.splice(index, 1);
          for (let index = edges.length - 1; index >= 0; index--) if (getEdgeFrom(edges[index]) === node.id || getEdgeTo(edges[index]) === node.id) edges.splice(index, 1);
          commitFlowEdit('flow-node-delete'); renderFlowView(container, project, nodes[0]?.id || null);
        }});
      } }, svgIcon('trash', 14), ' Eliminar nodo')
    );
  }

  canvas.appendChild(h('div', { className: 'ws-flow-status' }, statusChip, flowStatusText));
  canvas.appendChild(edgeLayer);
  if (!nodes.length) {
    canvas.appendChild(h('div', { className: 'ws-flow-empty-guide' }, h('div', { className: 'ws-empty-icon' }, svgIcon('flow', 28)), h('strong', null, 'Tu lienzo está vacío'), h('p', null, 'Añade un nodo para empezar. Después selecciónalo: aquí podrás escribir y configurar todo.'), h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', type: 'button', onClick: () => addNode() }, svgIcon('plus', 14), ' Añadir primer nodo')));
  }

  function addNode() {
    const op = operations[0] || null;
    const newNode = { id: generateId(), type: 'tool', operationId: op?.id || '', options: operationDefaults(op), title: op?.name || 'Nuevo nodo', description: op?.description || 'Configura este paso en el panel lateral.', x: 74 + (nodes.length % 3) * 230, y: 110 + Math.floor(nodes.length / 3) * 150 };
    nodes.push(newNode);
    selectedNodeId = newNode.id;
    commitFlowEdit('flow-node-add');
    renderFlowView(container, project, selectedNodeId);
  }

  nodes.forEach(node => {
    node.x = Number.isFinite(Number(node.x)) ? Number(node.x) : 90;
    node.y = Number.isFinite(Number(node.y)) ? Number(node.y) : 120;
    const op = node.operationId ? _operationRegistry?.get(node.operationId) : null;
    const nodeEl = h('div', { className: 'ws-flow-node' + (node.id === selectedNodeId ? ' selected' : ''), style: `left:${node.x}px;top:${node.y}px`, tabIndex: '0', role: 'button', ariaLabel: `${node.title || 'Nodo'}. Pulsa Enter para editar.` });
    nodeEls.set(node.id, nodeEl);
    const header = h('div', { className: 'ws-flow-node-header type-' + (node.type || 'tool') }, svgIcon(node.type === 'input' ? 'upload' : node.type === 'output' ? 'download' : node.type === 'logic' ? 'settings' : 'tool', 14), h('span', null, node.title || 'Nodo'), h('button', { className: 'ws-flow-node-edit', type: 'button', ariaLabel: 'Editar nodo', title: 'Editar nodo', onClick: event => { event.stopPropagation(); selectNode(node); } }, svgIcon('edit', 12)));
    const body = h('div', { className: 'ws-flow-node-body' }, h('span', { className: 'ws-flow-node-operation' }, op?.name || 'Sin operación'), h('p', null, node.description || 'Haz clic para describir este paso.'));
    const portLeft = h('button', { className: 'ws-flow-port left', type: 'button', ariaLabel: 'Entrada de ' + (node.title || 'nodo'), title: 'Entrada · pulsa para conectar', onClick: event => { event.stopPropagation(); handlePort(node, 'left'); } });
    const portRight = h('button', { className: 'ws-flow-port right', type: 'button', ariaLabel: 'Salida de ' + (node.title || 'nodo'), title: 'Salida · pulsa para conectar', onClick: event => { event.stopPropagation(); handlePort(node, 'right'); } });
    nodeEl.append(header, body, portLeft, portRight);
    nodeEl.addEventListener('click', () => selectNode(node));
    nodeEl.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node); } });
    nodeEl.addEventListener('pointerdown', event => {
      if (event.target.closest('.ws-flow-port,.ws-flow-node-edit')) return;
      selectNode(node);
      const startX = event.clientX; const startY = event.clientY; const originX = node.x; const originY = node.y;
      nodeEl.setPointerCapture?.(event.pointerId);
      const move = moveEvent => { node.x = Math.max(12, originX + moveEvent.clientX - startX); node.y = Math.max(50, originY + moveEvent.clientY - startY); nodeEl.style.left = node.x + 'px'; nodeEl.style.top = node.y + 'px'; redrawEdges(); scheduleFlowSave(); };
      const up = () => { nodeEl.removeEventListener('pointermove', move); nodeEl.removeEventListener('pointerup', up); commitFlowEdit('flow-node-move'); };
      nodeEl.addEventListener('pointermove', move); nodeEl.addEventListener('pointerup', up, { once: true });
    });
    canvas.appendChild(nodeEl);
  });
  setTimeout(redrawEdges, 0);

  const validateFlow = () => {
    if (!nodes.length) { toast('Añade al menos un nodo para probar el flujo', 'info'); return; }
    const missing = nodes.filter(node => !node.operationId || !_operationRegistry?.get(node.operationId));
    const disconnected = nodes.length > 1 && edges.length === 0;
    if (missing.length) { flowStatusText.textContent = `${missing.length} nodo(s) necesitan una operación`; toast('Configura la operación de cada nodo en el inspector', 'warning'); return; }
    if (disconnected) { flowStatusText.textContent = 'Hay nodos sin conectar'; toast('Conecta la salida de un nodo con la entrada del siguiente', 'warning'); return; }
    const warnings = nodes.flatMap(node => _operationRegistry.validate(node.operationId, null, node.options).warnings || []);
    flowStatusText.textContent = `Última prueba completada · Prueba del flujo completada · ${nodes.length} nodo${nodes.length === 1 ? '' : 's'} · ${edges.length} ${edges.length === 1 ? 'conexión' : 'conexiones'}`;
    toast(warnings.length ? 'Flujo válido con avisos: revisa los parámetros.' : 'Flujo válido y listo para ejecutarse.', warnings.length ? 'info' : 'success');
  };
  const toolbar = h('div', { className: 'ws-flow-toolbar' },
    h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', type: 'button', onClick: addNode, title: 'Añadir un nodo editable' }, svgIcon('plus'), ' Nodo'),
    h('button', { className: 'ws-btn ws-btn-secondary ws-btn-sm', type: 'button', onClick: () => navigateTo('flujos'), title: 'Abrir el constructor de flujos ejecutable' }, svgIcon('flow'), ' Constructor'),
    h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', type: 'button', onClick: () => { if (!nodes.length) return; showConfirm({ title: 'Limpiar flujo', message: 'Se eliminarán los nodos y conexiones del lienzo.', confirmText: 'Limpiar', onConfirm: () => { nodes.splice(0); edges.splice(0); commitFlowEdit('flow-clear'); renderFlowView(container, project); } }); } }, svgIcon('trash'), ' Limpiar'),
    h('button', { className: 'ws-btn ws-btn-primary ws-btn-sm', type: 'button', onClick: validateFlow, title: 'Ejecutar prueba: validar la estructura y los parámetros del flujo' }, svgIcon('play'), ' Ejecutar prueba')
  );
  el.append(h('div', { className: 'ws-flow-layout' }, canvas, inspector), toolbar);
  renderInspector(findNode(selectedNodeId));
  container.appendChild(el);
  container.style.overflow = 'hidden';
  container.style.height = '100%';
}

// Part 6: Tools View, Palette, Modals, Toast, Context Menu, Init
function renderToolsView(container) {
  const favoriteTools = appStore.get('favoriteTools');
  const recentTools = appStore.get('recentTools');
  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease' });
  el.appendChild(h('div', { className: 'hero' },
    h('h1', null, TOOLS_DATA.length + ' Herramientas'),
    h('p', null, 'Todas las herramientas de Toolisto en un solo lugar')
  ));
  const search = h('input', {
    className: 'ws-tools-search',
    type: 'text',
    placeholder: 'Buscar herramientas...',
    onInput: (e) => {
      const q = e.target.value.toLowerCase();
      $$('.ws-tool-card', el).forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const cat = (card.dataset.cat || '').toLowerCase();
        card.style.display = (name.includes(q) || cat.includes(q)) ? '' : 'none';
      });
    }
  });
  el.appendChild(search);
  if (favoriteTools.length > 0) {
    const favSection = h('div', { style: 'margin-bottom:24px' });
    favSection.appendChild(h('h3', { style: 'font-size:14px;font-weight:600;margin-bottom:12px' }, 'Favoritas'));
    const favGrid = h('div', { className: 'ws-card-grid' });
    favoriteTools.forEach(toolId => {
      const tool = TOOLS_DATA.find(t => t.id === toolId);
      if (tool) favGrid.appendChild(createToolCard(tool, favoriteTools, recentTools));
    });
    favSection.appendChild(favGrid);
    el.appendChild(favSection);
  }
  if (recentTools.length > 0) {
    const recSection = h('div', { style: 'margin-bottom:24px' });
    recSection.appendChild(h('h3', { style: 'font-size:14px;font-weight:600;margin-bottom:12px' }, 'Recientes'));
    const recGrid = h('div', { className: 'ws-card-grid' });
    recentTools.slice(0, 6).forEach(toolId => {
      const tool = TOOLS_DATA.find(t => t.id === toolId);
      if (tool) recGrid.appendChild(createToolCard(tool, favoriteTools, recentTools));
    });
    recSection.appendChild(recGrid);
    el.appendChild(recSection);
  }
  const categories = {};
  TOOLS_DATA.forEach(tool => {
    if (!categories[tool.category]) categories[tool.category] = [];
    categories[tool.category].push(tool);
  });
  Object.keys(categories).sort().forEach(cat => {
    const meta = CATEGORY_META[cat] || { label: cat, icon: 'tool', color: 'blue' };
    const section = h('div', { style: 'margin-bottom:24px' });
    section.appendChild(h('h3', { style: 'font-size:14px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px' },
      h('span', null, getCategoryIconSvg(cat)),
      meta.label + ' (' + categories[cat].length + ')'
    ));
    const grid = h('div', { className: 'ws-card-grid' });
    categories[cat].forEach(tool => {
      grid.appendChild(createToolCard(tool, favoriteTools, recentTools));
    });
    section.appendChild(grid);
    el.appendChild(section);
  });
  container.appendChild(el);
}

function createToolCard(tool, favoriteTools, recentTools) {
  const isFav = favoriteTools.includes(tool.id);
  const catMeta = CATEGORY_META[tool.category] || { color: 'blue' };
  const card = h('div', {
    className: 'ws-tool-card',
    'data-name': tool.name,
    'data-cat': tool.category,
    onClick: () => openTool(tool)
  });
  card.appendChild(h('div', { className: 'tool-icon' }, svgIcon('tool', 18)));
  const info = h('div', { className: 'tool-info' });
  info.appendChild(h('div', { className: 'tool-name' }, tool.name));
  info.appendChild(h('div', { className: 'tool-summary' }, tool.summary));
  card.appendChild(info);
  const favBtn = h('button', {
    className: 'ws-tool-card tool-fav' + (isFav ? ' active' : ''),
    onClick: (e) => {
      e.stopPropagation();
      const favs = appStore.get('favoriteTools');
      if (favs.includes(tool.id)) {
        appStore.set({ favoriteTools: favs.filter(id => id !== tool.id) });
      } else {
        appStore.set({ favoriteTools: [...favs, tool.id] });
      }
      try { localStorage.setItem('toolisto-favorite-tools', JSON.stringify(appStore.get('favoriteTools'))); } catch(e) {}
      renderView('tools');
    },
    ariaLabel: isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'
  }, svgIcon(isFav ? 'starFill' : 'star', 16));
  card.appendChild(favBtn);
  return card;
}

function openTool(tool) {
  const recents = appStore.get('recentTools').filter(id => id !== tool.id);
  recents.unshift(tool.id);
  appStore.set({ recentTools: recents.slice(0, 20) });
  try { localStorage.setItem('toolisto-recent-tools', JSON.stringify(appStore.get('recentTools'))); } catch(e) {}
  window.open('/' + tool.slug, '_blank');
  toast('Abriendo ' + tool.name + '...', 'info');
}

function renderPalette(container) {
  const overlay = h('div', { className: 'ws-palette-overlay', onClick: (e) => {
    if (e.target === overlay) appStore.set({ paletteOpen: false });
  }});
  const palette = h('div', { className: 'ws-palette' });
  const input = h('input', {
    className: 'ws-palette-input',
    type: 'text',
    placeholder: 'Buscar herramientas, vistas, acciones...',
    onInput: (e) => filterPalette(e.target.value, resultsEl)
  });
  palette.appendChild(input);
  const resultsEl = h('div', { className: 'ws-palette-results' });
  palette.appendChild(resultsEl);
  overlay.appendChild(palette);
  container.appendChild(overlay);
  setTimeout(() => input.focus(), 0);
  filterPalette('', resultsEl);
}

function filterPalette(query, container) {
  container.replaceChildren();
  const q = query.toLowerCase();
  const navItems = [
    { label: 'Ir a Proyectos', icon: 'folder', action: () => navigateTo('projects') },
    { label: 'Ir a Captura Universal', icon: 'camera', action: () => navigateTo('intake') },
    { label: 'Ir a Herramientas', icon: 'wrench', action: () => navigateTo('tools') },
  ];
  const project = appStore.get('currentProject');
  if (project) {
    navItems.push(
      { label: 'Ir a Panel', icon: 'grid', action: () => navigateTo('dashboard') },
      { label: 'Ir a Capturas', icon: 'camera', action: () => navigateTo('capture') },
      { label: 'Ir a Documentos', icon: 'doc', action: () => navigateTo('documents') },
      { label: 'Ir a Datos', icon: 'table', action: () => navigateTo('data') },
      { label: 'Ir a Query', icon: 'chart', action: () => navigateTo('query') },
      { label: 'Ir a Dashboards', icon: 'chart', action: () => navigateTo('dashboards') },
      { label: 'Ir a Flow', icon: 'flow', action: () => navigateTo('flow') }
    );
  }
  const allItems = [
    ...navItems.map(i => ({ ...i, type: 'nav' })),
    ...TOOLS_DATA.map(t => ({ label: t.name, icon: 'tool', type: 'tool', tool: t, action: () => openTool(t) })),
  ];
  const filtered = q ? allItems.filter(i => i.label.toLowerCase().includes(q)) : allItems.slice(0, 12);
  filtered.forEach(item => {
    container.appendChild(h('div', {
      className: 'ws-palette-item',
      onClick: () => { item.action(); appStore.set({ paletteOpen: false }); }
    },
      h('div', { className: 'item-icon' }, svgIcon(item.icon, 16)),
      h('div', { className: 'item-label' }, item.label),
      item.type === 'tool' ? h('span', { className: 'item-shortcut' }, 'Herramienta') : null
    ));
  });
  if (filtered.length === 0) {
    container.appendChild(h('div', { style: 'padding:16px;text-align:center;color:var(--ws-text-tertiary);font-size:13px' }, 'Sin resultados'));
  }
}

const toastQueue = [];
let toastVisible = 0;
const MAX_VISIBLE_TOASTS = 3;
function toast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;
  toastQueue.push({ message, type, duration });
  _flushToastQueue();
}
function _flushToastQueue() {
  if (toastVisible >= MAX_VISIBLE_TOASTS || toastQueue.length === 0) return;
  const container = $('#ws-toast-container');
  if (!container) return;
  toastVisible++;
  const entry = toastQueue.shift();
  const toastEl = h('div', { className: 'ws-toast ' + entry.type });
  const iconMap = { success: 'check', error: 'close', warning: 'callout', info: 'info' };
  toastEl.appendChild(h('span', null, svgIcon(iconMap[entry.type] || 'info', 16)));
  toastEl.appendChild(h('span', null, entry.message));
  container.appendChild(toastEl);
  setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(20px)';
    toastEl.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => {
      toastVisible--;
      toastEl.remove();
      _flushToastQueue();
    }, 300);
  }, entry.duration);
}

function showModal(opts) {
  const root = $('#ws-modal-root');
  root.replaceChildren();
  const overlay = h('div', { className: 'ws-modal-overlay', onClick: (e) => {
    if (e.target === overlay) closeModal();
  }});
  const modal = h('div', { className: 'ws-modal' + (opts.size ? ' size-' + opts.size : '') });
  const header = h('div', { className: 'ws-modal-header' },
    h('div', { className: 'ws-modal-title' }, opts.title || ''),
    h('button', { className: 'ws-modal-close', onClick: async () => { if (opts.onClose) await opts.onClose(); closeModal(); }, ariaLabel: 'Cerrar diálogo' }, svgIcon('close', 18))
  );
  modal.appendChild(header);
  const body = h('div', { className: 'ws-modal-body' });
  if (opts.content) {
    if (typeof opts.content === 'string') body.textContent = opts.content;
    else body.appendChild(opts.content);
  }
  if (opts.body && Array.isArray(opts.body)) opts.body.forEach(b => body.appendChild(b));
  modal.appendChild(body);
  const footer = h('div', { className: 'ws-modal-footer' });
  if (opts.footer) {
    if (typeof opts.footer === 'string') footer.textContent = opts.footer;
    else if (Array.isArray(opts.footer)) opts.footer.forEach(b => footer.appendChild(b));
    else footer.appendChild(opts.footer);
    modal.appendChild(footer);
  } else if (opts.confirmText) {
    const cancelBtn = h('button', { className: 'ws-btn ws-btn-ghost', onClick: async () => { if (opts.onCancel) await opts.onCancel(); closeModal(); } }, opts.cancelText || 'Cancelar');
    const confirmBtn = h('button', { className: 'ws-btn ' + (opts.confirmClass || 'ws-btn-primary') + ' ws-btn-confirm', onClick: async () => {
      if (opts.onConfirm) await opts.onConfirm();
      closeModal();
    }}, opts.confirmText);
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    modal.appendChild(footer);
  }
  overlay.appendChild(modal);
  root.appendChild(overlay);
}

function showConfirm({ title, message, confirmText = 'Confirmar', onConfirm, announce = false }) {
  showModal({
    title,
    content: h('p', { className: 'ws-confirm-copy', ...(announce ? { role: 'alert', 'aria-live': 'assertive' } : {}) }, message),
    confirmText,
    onConfirm,
    size: 'small',
  });
}

function closeModal() {
  const root = $('#ws-modal-root');
  root.replaceChildren();
}

function showContextMenu(x, y, items) {
  hideContextMenu();
  const root = $('#ws-context-root');
  const menu = h('div', { className: 'ws-context-menu', style: 'left:' + x + 'px;top:' + y + 'px' });
  items.forEach(item => {
    if (item.divider) {
      menu.appendChild(h('div', { className: 'ws-context-menu-divider' }));
      return;
    }
    menu.appendChild(h('div', {
      className: 'ws-context-menu-item' + (item.danger ? ' danger' : ''),
      onClick: () => { item.action(); hideContextMenu(); }
    }, item.icon ? h('span', null, svgIcon(item.icon, 14)) : null, item.label));
  });
  root.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

function hideContextMenu() {
  const root = $('#ws-context-root');
  if (root) root.replaceChildren();
}

const cycleTheme = toggleTheme;
const cycleDensity = toggleDensity;
function setupCollapse() { toggleSidebar(); }

function showToast(msg, type) { toast(msg, type); }

function exportProjectFile(project) { return exportProjectData(project); }
const scheduleAutoSave = autoSaveDoc;

function setupMobileMenu() {
  const btn = $('#ws-mobile-menu');
  if (btn) btn.addEventListener('click', toggleSidebar);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); togglePalette(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); cycleTheme(); }
  });
}

function setupGlobalDragDrop() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}

function togglePalette() {
  appStore.set({ paletteOpen: !appStore.get('paletteOpen') });
}

function handleFiles(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  const accepted = list.filter(file => validateWorkspaceFile(file).ok);
  if (accepted.length) toast(`${accepted.length} archivo${accepted.length === 1 ? '' : 's'} listo${accepted.length === 1 ? '' : 's'} para importar`, 'success');
  list.filter(file => !accepted.includes(file)).forEach(file => toast(`${file.name}: supera la capacidad configurada`, 'warning'));
}

function analyzeFile(file) {
  const validation = validateWorkspaceFile(file);
  return { name: file.name, size: file.size, type: file.type, extension: workspaceFileExtension(file.name), accepted: validation.ok, message: validation.message || 'Archivo compatible' };
}

function setupBlockEditor(container) {}
function setupFlowCanvas(container) {}

function renderDesignEditor(container) {
  const project = appStore.get('currentProject');
  if (!project) return;
  let designConfig = appStore.get('designConfig') || createReportConfig({ title: 'Reporte de ' + project.name });

  const el = h('div', { className: 'ws-start', style: 'animation:fadeIn 0.3s ease;display:flex;gap:16px;height:100%;overflow:hidden' });

  const sidebar = h('div', { style: 'width:280px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--ws-border);padding:16px' });
  const previewArea = h('div', { style: 'flex:1;overflow:auto;padding:16px;background:var(--ws-bg-secondary);display:flex;justify-content:center' });

  function renderSidebar() {
    sidebar.replaceChildren();
    actionsBar.replaceChildren();
    actionsBar.appendChild(saveBtn);
    actionsBar.appendChild(pdfBtn);
    sidebar.appendChild(actionsBar);
    sidebar.appendChild(h('h3', { style: 'margin:0 0 12px;font-size:14px' }, 'Secciones del reporte'));

    const settingsGroup = h('div', { style: 'margin-bottom:16px;padding:12px;background:var(--ws-bg);border-radius:var(--ws-radius-md);border:1px solid var(--ws-border)' });
    settingsGroup.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:8px;color:var(--ws-text-secondary)' }, 'CONFIGURACIÓN'));

    const titleInput = h('input', { type: 'text', className: 'ws-form-input', value: designConfig.title, placeholder: 'Título del reporte', style: 'width:100%;margin-bottom:8px', onInput: (e) => { designConfig.title = e.target.value; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderPreview(); } });
    settingsGroup.appendChild(h('div', { className: 'ws-form-group' }, h('label', { style: 'font-size:11px' }, 'Título'), titleInput));

    const formatSelect = h('select', { className: 'ws-form-input', style: 'width:100%;margin-bottom:8px', onChange: (e) => { designConfig.format = e.target.value; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderPreview(); } });
    ['A4', 'Letter'].forEach(f => formatSelect.appendChild(h('option', { value: f, ...(designConfig.format === f ? { selected: true } : {}) }, f)));
    settingsGroup.appendChild(h('div', { className: 'ws-form-group' }, h('label', { style: 'font-size:11px' }, 'Formato'), formatSelect));

    const orientSelect = h('select', { className: 'ws-form-input', style: 'width:100%;margin-bottom:8px', onChange: (e) => { designConfig.orientation = e.target.value; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderPreview(); } });
    [['portrait', 'Vertical'], ['landscape', 'Horizontal']].forEach(([v, l]) => orientSelect.appendChild(h('option', { value: v, ...(designConfig.orientation === v ? { selected: true } : {}) }, l)));
    settingsGroup.appendChild(h('div', { className: 'ws-form-group' }, h('label', { style: 'font-size:11px' }, 'Orientación'), orientSelect));

    const marginGroup = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px' });
    ['top', 'right', 'bottom', 'left'].forEach(side => {
      const inp = h('input', { type: 'number', className: 'ws-form-input', value: designConfig.margins[side], min: '5', max: '50', style: 'width:100%;font-size:11px', onInput: (e) => { designConfig.margins[side] = parseInt(e.target.value) || 20; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderPreview(); } });
      marginGroup.appendChild(h('div', { className: 'ws-form-group' }, h('label', { style: 'font-size:10px' }, side.charAt(0).toUpperCase() + side.slice(1)), inp));
    });
    settingsGroup.appendChild(marginGroup);
    sidebar.appendChild(settingsGroup);

    const sectionTypes = [
      ['title', 'Título', 'Type'],
      ['subtitle', 'Subtítulo', 'list'],
      ['date', 'Fecha', 'calendar'],
      ['text', 'Texto', 'doc'],
      ['image', 'Imagen', 'imageBlock'],
      ['table', 'Tabla', 'table'],
      ['chart', 'Gráfico', 'chart'],
      ['divider', 'Línea', 'grip'],
      ['footer', 'Pie de página', 'doc'],
      ['page-break', 'Salto de página', 'plus'],
    ];

    const addBar = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px' });
    sectionTypes.forEach(([type, label, icon]) => {
      const btn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', style: 'font-size:11px', onClick: () => {
        const section = createReportSection(type);
        if (type === 'date') section.content = new Date().toLocaleDateString('es-CL');
        if (type === 'title') section.content = designConfig.title || 'Título';
        if (type === 'subtitle') section.content = 'Subtítulo del reporte';
        if (type === 'text') section.content = 'Escribe el contenido aquí...';
        if (type === 'footer') section.content = 'Pie de página';
        designConfig.sections.push(section);
        designConfig.updatedAt = Date.now();
        appStore.set({ designConfig });
        renderSidebar();
        renderPreview();
      } }, svgIcon(icon, 14), ' ' + label);
      addBar.appendChild(btn);
    });
    sidebar.appendChild(addBar);

    const sectionsList = h('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    (designConfig.sections || []).forEach((section, idx) => {
      const item = h('div', { className: 'ws-card', style: 'padding:8px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px' });
      const typeLabel = sectionTypes.find(t => t[0] === section.type);
      item.appendChild(h('span', { style: 'color:var(--ws-text-tertiary);font-size:10px;width:20px;text-align:center' }, String(idx + 1)));
      item.appendChild(h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, (typeLabel ? typeLabel[1] : section.type) + ': ' + (section.content || '').slice(0, 30)));

      const editBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', style: 'padding:2px 4px', onClick: (e) => { e.stopPropagation(); editSection(idx); } }, svgIcon('edit', 12));
      const upBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', style: 'padding:2px 4px', onClick: (e) => { e.stopPropagation(); if (idx > 0) { [designConfig.sections[idx - 1], designConfig.sections[idx]] = [designConfig.sections[idx], designConfig.sections[idx - 1]]; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderSidebar(); renderPreview(); } } }, svgIcon('grip', 12));
      const downBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', style: 'padding:2px 4px', onClick: (e) => { e.stopPropagation(); if (idx < designConfig.sections.length - 1) { [designConfig.sections[idx], designConfig.sections[idx + 1]] = [designConfig.sections[idx + 1], designConfig.sections[idx]]; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderSidebar(); renderPreview(); } } }, svgIcon('grip', 12));
      const delBtn = h('button', { className: 'ws-btn ws-btn-ghost ws-btn-sm', style: 'padding:2px 4px;color:var(--ws-error)', onClick: (e) => { e.stopPropagation(); designConfig.sections.splice(idx, 1); designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderSidebar(); renderPreview(); } }, svgIcon('trash', 12));
      item.appendChild(h('div', { style: 'display:flex;gap:2px' }, upBtn, downBtn, editBtn, delBtn));
      sectionsList.appendChild(item);
    });
    sidebar.appendChild(sectionsList);

    if (designConfig.sections.length === 0) {
      sidebar.appendChild(h('div', { style: 'text-align:center;padding:20px;color:var(--ws-text-tertiary);font-size:12px' }, 'Agrega secciones al reporte usando los botones de arriba'));
    }
  }

  function editSection(idx) {
    const section = designConfig.sections[idx];
    if (!section) return;
    const contentInput = h('textarea', { className: 'ws-form-input', rows: '4', value: section.content || '', style: 'width:100%;min-height:100px', onInput: (e) => { section.content = e.target.value; designConfig.updatedAt = Date.now(); appStore.set({ designConfig }); renderPreview(); } });
    const body = [];
    if (section.type === 'image') {
      const preview = h('div', { className: 'ws-report-image-picker-preview' });
      if (section.dataUrl) preview.appendChild(h('img', { src: section.dataUrl, alt: section.content || 'Vista previa de imagen' }));
      else preview.appendChild(h('span', null, 'Todavía no has seleccionado una imagen'));
      const imageInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', className: 'ws-form-input' });
      imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        if (!file) return;
        const validation = validateWorkspaceFile(file, ['.jpg', '.jpeg', '.png', '.webp', '.gif']);
        if (!validation.ok) { toast(validation.message, 'warning'); return; }
        try {
          section.dataUrl = await readFileAsDataUrl(file);
          section.content = section.content || file.name.replace(/\.[^.]+$/, '');
          designConfig.updatedAt = Date.now();
          appStore.set({ designConfig });
          preview.replaceChildren(h('img', { src: section.dataUrl, alt: section.content || 'Vista previa de imagen' }));
          renderPreview();
          toast('Imagen añadida al informe', 'success');
        } catch (error) {
          reportError(error, 'report-image-read', {});
        }
      });
      body.push(
        h('p', { className: 'ws-settings-footnote' }, 'La imagen se guarda localmente dentro del proyecto y se incrusta también al exportar el PDF.'),
        preview,
        imageInput,
        h('label', { className: 'ws-form-label', style: 'display:block;margin-top:12px' }, 'Texto alternativo'),
        contentInput,
      );
    } else {
      body.push(contentInput);
    }
    const footer = h('div', { className: 'ws-modal-footer' },
      h('button', { className: 'ws-btn', onClick: closeModal }, 'Cerrar'),
      h('button', { className: 'ws-btn ws-btn-primary', onClick: () => { closeModal(); renderSidebar(); } }, 'Listo')
    );
    showModal({ title: 'Editar seccion: ' + section.type, body, footer });
  }

  function renderPreview() {
    previewArea.replaceChildren();
    const preview = renderReportPreview(designConfig);
    preview.pages.forEach((page, pageIdx) => {
      const pageEl = h('div', { style: `width:${preview.pageW}px;height:${preview.pageH}px;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.1);margin-bottom:16px;position:relative;overflow:hidden;border-radius:2px` });
      const contentEl = h('div', { style: `position:absolute;top:${preview.margins.top * preview.scale}px;left:${preview.margins.left * preview.scale}px;width:${preview.contentW}px` });
      page.forEach(({ section, y }) => {
        const sectionEl = h('div', { style: `position:absolute;top:${y}px;width:100%;min-height:16px` });
        if (section.type === 'title') sectionEl.appendChild(h('div', { style: 'font-size:24px;font-weight:700;color:#1a1a1a;font-family:Inter,sans-serif' }, section.content || ''));
        else if (section.type === 'subtitle') sectionEl.appendChild(h('div', { style: 'font-size:16px;color:#666;font-family:Inter,sans-serif' }, section.content || ''));
        else if (section.type === 'date') sectionEl.appendChild(h('div', { style: 'font-size:12px;color:#999;font-family:Inter,sans-serif' }, section.content || new Date().toLocaleDateString('es-CL')));
        else if (section.type === 'text') sectionEl.appendChild(h('div', { style: 'font-size:12px;color:#333;line-height:1.6;font-family:Inter,sans-serif;white-space:pre-wrap' }, section.content || ''));
        else if (section.type === 'divider') sectionEl.appendChild(h('div', { style: 'width:100%;height:1px;background:#ddd;margin:8px 0' }));
        else if (section.type === 'footer') sectionEl.appendChild(h('div', { style: 'font-size:10px;color:#999;text-align:center;font-family:Inter,sans-serif;border-top:1px solid #eee;padding-top:8px' }, section.content || ''));
        else if (section.type === 'page-break') sectionEl.appendChild(h('div', { style: 'font-size:10px;color:#ccc;text-align:center;border:1px dashed #ddd;padding:4px;margin:4px 0' }, '--- Salto de página ---'));
        else if (section.type === 'image') {
          if (section.dataUrl) {
            sectionEl.appendChild(h('div', { style: 'text-align:center' }, h('img', { src: section.dataUrl, style: 'max-width:100%;max-height:200px;border-radius:4px;border:1px solid #ddd' })));
          } else {
            sectionEl.appendChild(h('div', { style: 'background:#f0f0f0;border:1px solid #ddd;padding:12px;text-align:center;color:#999;font-size:11px;border-radius:4px' }, '[Sin imagen]'));
          }
        }
        else if (section.type === 'table') {
          const tblData = section.data || {};
          const tblHeaders = tblData.headers || [];
          const tblRows = tblData.rows || [];
          if (tblHeaders.length > 0 || tblRows.length > 0) {
            const tbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:11px;font-family:Inter,sans-serif' });
            if (tblHeaders.length > 0) {
              const thead = h('thead', null);
              const tr = h('tr', null);
              tblHeaders.forEach(hdr => tr.appendChild(h('th', { style: 'padding:4px 8px;background:#f0f0f0;border:1px solid #ddd;text-align:left;font-weight:600' }, String(hdr))));
              thead.appendChild(tr);
              tbl.appendChild(thead);
            }
            const tbody = h('tbody', null);
            tblRows.forEach(row => {
              const tr = h('tr', null);
              (row || []).forEach(cell => tr.appendChild(h('td', { style: 'padding:4px 8px;border:1px solid #ddd' }, String(cell != null ? cell : ''))));
              tbody.appendChild(tr);
            });
            tbl.appendChild(tbody);
            sectionEl.appendChild(tbl);
          } else {
            sectionEl.appendChild(h('div', { style: 'background:#f8f8f8;border:1px solid #ddd;padding:12px;text-align:center;color:#999;font-size:11px;border-radius:4px' }, '[Sin datos]'));
          }
        }
        else if (section.type === 'chart') {
          const chartData = section.data || {};
          const chartSeries = chartData.series || [];
          if (chartSeries.length > 0) {
            const maxV = Math.max(1, ...chartSeries.map(s => Math.abs(s.value || 0)));
            const hasNeg = chartSeries.some(s => (s.value || 0) < 0);
            const barW = Math.max(16, Math.min(40, 400 / chartSeries.length));
            const svgH = hasNeg ? 140 : 100;
            const baseline = hasNeg ? svgH / 2 : svgH - 4;
            const totalW = Math.max(300, chartSeries.length * (barW + 4) + 8);
            const svgEl = sv('svg', { viewBox: '0 0 ' + totalW + ' ' + svgH, style: 'width:100%;max-width:' + totalW + 'px;height:auto' });
            chartSeries.forEach((s, i) => {
              const val = s.value || 0;
              const bx = i * (barW + 4) + 4;
              const bh = Math.round((Math.abs(val) / maxV) * (hasNeg ? svgH / 2 - 10 : svgH - 20));
              const fill = val >= 0 ? '#5167E8' : '#D9893B';
              const ry = val >= 0 ? baseline - bh : baseline;
              svgEl.appendChild(sv('rect', { x: bx, y: ry, width: barW - 2, height: Math.max(1, bh), fill, rx: 2 }));
              svgEl.appendChild(sv('text', { x: bx + barW / 2 - 1, y: val >= 0 ? ry - 4 : ry + bh + 12, 'font-size': 9, fill: '#333', 'font-family': 'sans-serif', 'text-anchor': 'middle' }, String(val)));
              svgEl.appendChild(sv('text', { x: bx + barW / 2 - 1, y: svgH - 1, 'font-size': 8, fill: '#666', 'font-family': 'sans-serif', 'text-anchor': 'middle' }, String(s.label || '').slice(0, 8)));
            });
            if (hasNeg) svgEl.appendChild(sv('line', { x1: 0, y1: baseline, x2: 500, y2: baseline, stroke: '#999', 'stroke-width': 0.5 }));
            sectionEl.replaceChildren(svgEl);
          } else {
            sectionEl.appendChild(h('div', { style: 'background:#f5f5ff;border:1px solid #ddd;padding:12px;text-align:center;color:#999;font-size:11px;border-radius:4px' }, '[Sin datos]'));
          }
        }
        contentEl.appendChild(sectionEl);
      });
      pageEl.appendChild(contentEl);
      previewArea.appendChild(pageEl);
    });
  }

  const actionsBar = h('div', { style: 'display:flex;gap:8px;margin-bottom:12px;justify-content:flex-end' });
  const saveBtn = h('button', { className: 'ws-btn ws-btn-primary', onClick: async () => {
    if (!project) return;
    const asset = createDesignDocument(designConfig.title, project.id);
    asset.width = getReportPageSize(designConfig).width;
    asset.height = getReportPageSize(designConfig).height;
    asset.background = '#ffffff';
    asset.layers = designConfig.sections.map(s => ({ type: s.type, content: s.content, data: s.data, dataUrl: s.dataUrl, assetId: s.assetId }));
    await saveAsset(project.id, asset);
    await registerExecution(project.id, 'design-create', 'Crear diseno', {
      parameters: { title: designConfig.title, format: designConfig.format, sectionCount: designConfig.sections.length },
      resultType: 'design-document',
      resultAssetId: asset.id,
      status: 'completed',
    });
    await refreshProjectCounts(project.id);
    toast('Diseño guardado', 'success');
  } }, svgIcon('download'), ' Guardar diseno');

  const pdfBtn = h('button', { className: 'ws-btn ws-btn-secondary', onClick: async () => {
    if (!project) return;
    try {
      const uncertain = await findUncertainDesignSources(designConfig);
      if (uncertain) {
        blockDerivedFromUncertain(uncertain.table, 'informe PDF');
        return;
      }
      const start = Date.now();
      let pdfContent;
      try {
        pdfContent = generatePDF(await preparePdfImages(designConfig));
      } catch (genErr) {
        toast('Error al generar el contenido del PDF: ' + genErr.message, 'error');
        await registerExecution(project.id, 'pdf-export', 'Exportar PDF', {
          parameters: { title: designConfig.title, format: designConfig.format },
          resultType: 'export-artifact',
          startedAt: start,
          status: 'failed',
          errors: [genErr.message],
        });
        return;
      }
      const blob = new Blob([pdfContent], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: (designConfig.title || 'reporte').replace(/[\\/:*?"<>|]/g, '-') + '.pdf' });
      a.click();
      URL.revokeObjectURL(url);
      await registerExecution(project.id, 'pdf-export', 'Exportar PDF', {
        parameters: { title: designConfig.title, format: designConfig.format, pages: 'auto' },
        resultType: 'export-artifact',
        startedAt: start,
        status: 'completed',
      });
      try {
        const audit = await validatePdfAgainstSource(designConfig);
        if (audit) {
          await registerExecution(project.id, 'pdf-validation', 'Validar PDF contra tabla fuente', {
            parameters: { title: designConfig.title, format: designConfig.format },
            resultType: 'audit',
            startedAt: Date.now(),
            status: audit.valid ? 'completed' : 'failed',
            errors: audit.valid ? [] : audit.checks.filter(c => !c.ok).map(c => c.type + ': ' + c.detail),
          });
          if (!audit.valid) toast('Advertencia: el PDF no coincide con la tabla fuente. Revisa la auditoria.', 'warning');
        }
      } catch (auditErr) {
        reportError(auditErr, 'pdf-validation', { title: designConfig.title });
      }
      await refreshProjectCounts(project.id);
      toast('PDF generado y descargado', 'success');
    } catch (e) {
      toast('Error al exportar PDF: ' + e.message, 'error');
    }
  } }, svgIcon('download'), ' Exportar PDF');

  el.appendChild(sidebar);
  el.appendChild(previewArea);
  container.appendChild(el);

  renderSidebar();
  renderPreview();
}

function getPaletteCommands() {
  return TOOLS_DATA.map(t => ({ label: t.name, action: () => openTool(t) }));
}

const favoriteTools = new Set(JSON.parse(localStorage.getItem('ws-favorites') || '[]'));
const recentTools = JSON.parse(localStorage.getItem('ws-recent') || '[]');

function toggleFavoriteTool(toolId) {
  if (favoriteTools.has(toolId)) favoriteTools.delete(toolId);
  else favoriteTools.add(toolId);
  localStorage.setItem('ws-favorites', JSON.stringify([...favoriteTools]));
}

function addToRecentTools(toolId) {
  const idx = recentTools.indexOf(toolId);
  if (idx > -1) recentTools.splice(idx, 1);
  recentTools.unshift(toolId);
  if (recentTools.length > 20) recentTools.pop();
  localStorage.setItem('ws-recent', JSON.stringify(recentTools));
}

const WORKSPACE_INTERNAL_PREVIEW = window.__TOOLISTO_WORKSPACE_INTERNAL_PREVIEW__ === true;
if (WORKSPACE_INTERNAL_PREVIEW) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
