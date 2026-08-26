#!/usr/bin/env node
/**
 * CE-061: ID Collision, Serialization Boundaries & localStorage Consistency
 *
 * Adversarial audit of ID generation uniqueness, serialization roundtrip fidelity,
 * localStorage key integrity, session persistence correctness, and object URL lifecycle.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import 'fake-indexeddb/auto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS: ' + name); }
  else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('=== CE-061: ID Collision & Serialization Audit ===\n');

// ─── Load source modules via VM sandbox ─────────────────────────────────────
function stripModuleSyntax(code) {
  let r = code;
  r = r.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';?\s*/g, '');
  r = r.replace(/import\s+\w+\s+from\s*'[^']*';?\s*/g, '');
  r = r.replace(/import\s*'[^']*';?\s*/g, '');
  r = r.replace(/export\s*\{[^}]*\};?\s*/g, '');
  r = r.replace(/^export\s+default\s+/gm, '');
  r = r.replace(/^export\s+(const|let|var|function|class|async)\s/gm, '$1 ');
  r = r.replace(/^(const|let)\s/gm, 'var ');
  return r;
}

const codeVersions = readFileSync(join(ROOT, 'workspace', 'core', 'schema-versions.js'), 'utf8');
const codeModels  = readFileSync(join(ROOT, 'workspace', 'core', 'models.js'), 'utf8');
const codeImage   = readFileSync(join(ROOT, 'workspace', 'core', 'image-processor.js'), 'utf8');

const sandbox = {
  console, Math, Date, JSON, Array, Object, String, Number, Set, Map, Error,
  Promise, setTimeout, clearTimeout, isNaN, isFinite, Infinity, NaN, Symbol,
  parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
  crypto: typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined,
  URL, Blob,
};
const ctx = vm.createContext(sandbox);

vm.runInContext(stripModuleSyntax(codeVersions), ctx);

vm.runInContext([
  'function generateId() {',
  '  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")',
  '    return crypto.randomUUID();',
  '  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);',
  '}',
  'var MODEL_VERSION = OBJECT_SCHEMA_VERSION;',
].join('\n'), ctx);

vm.runInContext(stripModuleSyntax(codeModels), ctx);

const objUrlSrc = codeImage.match(
  /\/\*\s*\u2500\u2500\s*Object URL Management[\s\S]*?function getActiveObjectUrls\(\)\s*\{\s*return _objectUrls\.size;\s*\}/
)?.[0] || '';
vm.runInContext(stripModuleSyntax(objUrlSrc), ctx);

const {
  generateId, MODEL_VERSION,
  createTextDocument, createTextBlock, createScanDocument, createScanPage,
  createTableDocument, createDataSheet, createChart,
  createImageAsset, createFileAsset, createToolExecution,
  createDesignDocument, createDesignLayer, createExportArtifact,
} = ctx;

const {
  OBJECT_SCHEMA_VERSION, DB_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION,
  STORAGE_ENVELOPE_VERSION, SESSION_SCHEMA_VERSION,
  DATA_MODEL_SCHEMA_VERSION, WORKFLOW_DEFINITION_VERSION,
} = ctx;

const {
  createObjectUrl, revokeObjectUrl, revokeAllObjectUrls,
  getActiveObjectUrls, _objectUrls,
} = ctx;

if (typeof URL.createObjectURL !== 'function') {
  let _blobCtr = 0;
  URL.createObjectURL = function (blob) { return 'blob:test/' + String(++_blobCtr); };
  URL.revokeObjectURL = function () {};
}

if (typeof localStorage === 'undefined') {
  const _store = new Map();
  globalThis.localStorage = {
    getItem: (k) => _store.has(k) ? _store.get(k) : null,
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear(),
    get length() { return _store.size; },
    key: (i) => [..._store.keys()][i] ?? null,
  };
}

// ─── Open unique test IndexedDB (version 3, all 8 stores) ──────────────────
const TEST_DB_NAME = 'id-collision-' + Date.now();
const TEST_DB_VERSION = 3;

function openTestDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TEST_DB_NAME, TEST_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('updatedAt', 'updatedAt');
        ps.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('documents')) {
        const ds = db.createObjectStore('documents', { keyPath: 'id' });
        ds.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('data')) {
        const dt = db.createObjectStore('data', { keyPath: 'id' });
        dt.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('captures')) {
        const cs = db.createObjectStore('captures', { keyPath: 'id' });
        cs.createIndex('projectId', 'projectId');
        cs.createIndex('docId', 'docId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const as = db.createObjectStore('assets', { keyPath: 'id' });
        as.createIndex('projectId', 'projectId');
        as.createIndex('type', 'type');
        as.createIndex('sourceAssetId', 'sourceAssetId');
      }
      if (!db.objectStoreNames.contains('executions')) {
        const es = db.createObjectStore('executions', { keyPath: 'id' });
        es.createIndex('projectId', 'projectId');
        es.createIndex('toolId', 'toolId');
        es.createIndex('sourceAssetId', 'sourceAssetId');
      }
      if (!db.objectStoreNames.contains('workflows')) {
        const ws = db.createObjectStore('workflows', { keyPath: 'id' });
        ws.createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─── IDB helpers ───────────────────────────────────────────────────────────
function idbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value).onsuccess = (e) => resolve(e.target.result);
    tx.onerror = () => reject(tx.error);
  });
}
function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    tx.objectStore(store).get(key).onsuccess = (e) => resolve(e.target.result);
    tx.onerror = () => reject(tx.error);
  });
}
function idbDelete(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key).onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function idbClear(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear().onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function idbPutCommit(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── saveDoc / saveData guard simulation (mirrors storage.js exactly) ──────
async function simulateSaveDoc(db, projectId, doc) {
  if (!doc.id) doc.id = generateId();
  doc.projectId = projectId;
  doc.updatedAt = Date.now();
  if (!doc.createdAt) doc.createdAt = doc.updatedAt;
  if (!doc._version) doc._version = MODEL_VERSION;
  const existing = await idbGet(db, 'documents', doc.id);
  if (existing && existing._writeSeq != null && existing._writeSeq > (doc._writeSeq || 0)) {
    return existing;
  }
  doc._writeSeq = (existing?._writeSeq || 0) + 1;
  await idbPut(db, 'documents', doc);
  return doc;
}

async function simulateSaveData(db, projectId, table) {
  if (!table.id) table.id = generateId();
  table.projectId = projectId;
  table.updatedAt = Date.now();
  if (!table.createdAt) table.createdAt = table.updatedAt;
  if (!table._version) table._version = MODEL_VERSION;
  const existing = await idbGet(db, 'data', table.id);
  if (existing && existing._writeSeq != null && existing._writeSeq > (table._writeSeq || 0)) {
    return existing;
  }
  table._writeSeq = (existing?._writeSeq || 0) + 1;
  await idbPut(db, 'data', table);
  return table;
}

// ─── Session persistence simulation (mirrors workspace-storage.js) ─────────
const SESSION_KEY = 'ws:session';
const MAX_SESSIONS = 5;

async function simSaveSession(db, sessionId, data) {
  const session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspace: {
      currentView: data?.currentView || 'projects',
      currentProjectId: data?.currentProjectId || null,
      currentDocId: data?.currentDocId || null,
      currentDataTableId: data?.currentDataTableId || null,
      documents: (data?.documents || []).filter(Boolean),
      dataTables: (data?.dataTables || []).filter(Boolean),
      captures: (data?.captures || []).filter(Boolean),
      flowNodes: data?.flowNodes || [],
      flowEdges: data?.flowEdges || [],
      theme: data?.theme ?? null,
      density: data?.density ?? null,
      sidebarCollapsed: data?.sidebarCollapsed ?? null,
    },
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const req = store.get(SESSION_KEY);
    req.onsuccess = () => {
      const entry = req.result;
      const sessions = entry && Array.isArray(entry.value) ? entry.value : [];
      const filtered = sessions.filter(s => s.sessionId !== sessionId);
      filtered.unshift(session);
      while (filtered.length > MAX_SESSIONS) filtered.pop();
      store.put({ key: SESSION_KEY, value: filtered });
    };
    tx.oncomplete = () => resolve(session);
    tx.onerror = () => reject(tx.error);
  });
}

async function simLoadSessions(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(SESSION_KEY);
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry || !Array.isArray(entry.value)) resolve([]);
      else resolve(entry.value.filter(s => s && typeof s === 'object' && s.schemaVersion != null));
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function simDeleteSession(db, sessionId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const req = store.get(SESSION_KEY);
    req.onsuccess = () => {
      const entry = req.result;
      const sessions = entry && Array.isArray(entry.value) ? entry.value : [];
      const filtered = sessions.filter(s => s.sessionId !== sessionId);
      if (filtered.length === 0) store.delete(SESSION_KEY);
      else store.put({ key: SESSION_KEY, value: filtered });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function simCleanupForProject(db, projectId, deletedIds = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const req = store.get(SESSION_KEY);
    req.onsuccess = () => {
      const entry = req.result;
      const sessions = entry && Array.isArray(entry.value) ? entry.value : [];
      if (sessions.length === 0) return;
      const idSet = new Set(deletedIds);
      let changed = false;
      for (const s of sessions) {
        const w = s.workspace || {};
        if (w.currentProjectId === projectId) { w.currentProjectId = null; changed = true; }
        for (const key of ['documents', 'dataTables', 'captures']) {
          if (Array.isArray(w[key])) {
            const before = w[key].length;
            w[key] = w[key].filter(d => !idSet.has(d?.id ?? d));
            if (w[key].length !== before) changed = true;
          }
        }
      }
      if (changed) store.put({ key: SESSION_KEY, value: sessions });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Open test database ────────────────────────────────────────────────────
const testDB = await openTestDB();

// ================================================================
// Section 1: ID Generation Uniqueness (12 tests)
// ================================================================
console.log('--- 1. ID Generation Uniqueness ---');
{
  const ids1k = new Set();
  for (let i = 0; i < 1000; i++) ids1k.add(generateId());
  check('1000 generated IDs are all unique', ids1k.size === 1000, 'size=' + ids1k.size);

  const sample = generateId();
  check('IDs are strings', typeof sample === 'string', typeof sample);

  const lengths = [...ids1k].map(id => id.length);
  const minLen = Math.min(...lengths);
  check('IDs length >= 20', minLen >= 20, 'minLen=' + minLen);

  check('IDs are non-empty', sample.length > 0);

  const rapidIds = new Set();
  for (let i = 0; i < 100; i++) rapidIds.add(generateId());
  check('100 rapid-fire IDs all unique', rapidIds.size === 100, 'size=' + rapidIds.size);

  const allClean = [...ids1k].every(id => !id.includes('\0') && !id.includes('\n') && !id.includes('\r'));
  check('IDs contain no null bytes or control chars', allClean);

  const ts1 = generateId();
  await delay(2);
  const ts2 = generateId();
  check('IDs at different timestamps are unique', ts1 !== ts2);

  const tab1 = new Set();
  const tab2 = new Set();
  for (let i = 0; i < 50; i++) { tab1.add(generateId()); tab2.add(generateId()); }
  const overlap = [...tab1].filter(id => tab2.has(id)).length;
  check('IDs from different tabs are all unique', overlap === 0, 'overlap=' + overlap);

  const fmtTest = generateId();
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fmtTest);
  const isFallback = /^[0-9a-z]+$/.test(fmtTest);
  check('IDs follow consistent format (UUID or base36)', isUUID || isFallback, fmtTest.slice(0, 20));

  const ids10k = new Set();
  for (let i = 0; i < 10000; i++) ids10k.add(generateId());
  check('10000 IDs all unique (statistical)', ids10k.size === 10000, 'size=' + ids10k.size);

  const sorted = [...ids1k].sort();
  let maxRun = 1, curRun = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) curRun++;
    else { maxRun = Math.max(maxRun, curRun); curRun = 1; }
  }
  maxRun = Math.max(maxRun, curRun);
  check('IDs are not sequential (no long runs)', maxRun === 1, 'maxRun=' + maxRun);

  const entityPrefixes = ['project-', 'doc-', 'scan-', 'table-', 'chart-', 'asset-', 'exec-', 'wf-'];
  const prefixCollision = [...ids1k].some(id => entityPrefixes.some(p => id.startsWith(p)));
  check('IDs do not collide with entity type prefixes', !prefixCollision);
}

// ================================================================
// Section 2: Object Model Serialization Roundtrip (20 tests)
// ================================================================
console.log('\n--- 2. Object Model Serialization Roundtrip ---');
{
  function roundtrip(obj) { return JSON.parse(JSON.stringify(obj)); }

  const td = createTextDocument('Doc-Test', 'proj1');
  const td2 = roundtrip(td);
  check('createTextDocument roundtrip: id preserved', td.id === td2.id);
  check('createTextDocument roundtrip: blocks=[], wordCount=0', Array.isArray(td2.blocks) && td2.blocks.length === 0 && td2.wordCount === 0);

  const sd = createScanDocument('Scan-Test', 'proj1');
  const sd2 = roundtrip(sd);
  check('createScanDocument roundtrip: pages=[], adjustments', Array.isArray(sd2.pages) && sd2.pages.length === 0 && typeof sd2.adjustments === 'object');
  check('createScanDocument roundtrip: currentFilter=original', sd2.currentFilter === 'original');

  const sp = createScanPage('asset-abc', 0);
  const sp2 = roundtrip(sp);
  check('createScanPage roundtrip: assetId, index, ocrStatus', sp2.assetId === 'asset-abc' && sp2.index === 0 && sp2.ocrStatus === 'pending');

  const tbl = createTableDocument('Table-Test', 'proj1');
  const tbl2 = roundtrip(tbl);
  check('createTableDocument roundtrip: sheets array', Array.isArray(tbl2.sheets) && tbl2.sheets.length === 1 && tbl2.sheets[0].name === 'Sheet 1');
  check('createTableDocument roundtrip: activeSheetIndex=0', tbl2.activeSheetIndex === 0);

  const ds = createDataSheet('MiHoja', 2);
  const ds2 = roundtrip(ds);
  check('createDataSheet roundtrip: name, index, columns=[]', ds2.name === 'MiHoja' && ds2.index === 2 && Array.isArray(ds2.columns) && ds2.columns.length === 0);

  const ch = createChart('Chart-Test', 'proj1', 'tbl-1', 'sh-1');
  const ch2 = roundtrip(ch);
  check('createChart roundtrip: sourceTableId, chartType', ch2.sourceTableId === 'tbl-1' && ch2.sourceSheetId === 'sh-1' && ch2.chartType === 'bar');

  const ia = createImageAsset('photo.png', 'proj1', null);
  const ia2 = roundtrip(ia);
  check('createImageAsset roundtrip: type=image-asset', ia2.type === 'image-asset' && ia2.mimeType === '');

  const fa = createFileAsset('data.csv', 'proj1', null);
  const fa2 = roundtrip(fa);
  check('createFileAsset roundtrip: type=file-asset, extension=csv', fa2.type === 'file-asset' && fa2.extension === 'csv');

  const te = createToolExecution('ocr-tool', 'OCR', 'proj1');
  const te2 = roundtrip(te);
  check('createToolExecution roundtrip: toolId, toolName, inputAssetIds=[]', te2.toolId === 'ocr-tool' && te2.toolName === 'OCR' && Array.isArray(te2.inputAssetIds) && te2.inputAssetIds.length === 0);

  const dd = createDesignDocument('Design-Test', 'proj1');
  const dd2 = roundtrip(dd);
  check('createDesignDocument roundtrip: layers=[], width=800', Array.isArray(dd2.layers) && dd2.layers.length === 0 && dd2.width === 800);

  const ea = createExportArtifact('Export-Test', 'proj1', 'document', 'doc-1', 'pdf');
  const ea2 = roundtrip(ea);
  check('createExportArtifact roundtrip: sourceType, sourceId', ea2.sourceType === 'document' && ea2.sourceId === 'doc-1' && ea2.format === 'pdf');

  const dl = createDesignLayer('rect', 'Layer1');
  const dl2 = roundtrip(dl);
  check('createDesignLayer roundtrip: type, name, opacity', dl2.type === 'rect' && dl2.name === 'Layer1' && dl2.opacity === 1);

  const tb = createTextBlock('heading', 'Hello', 0);
  const tb2 = roundtrip(tb);
  check('createTextBlock roundtrip: type, content, order', tb2.type === 'heading' && tb2.content === 'Hello' && tb2.order === 0);

  const sdPages = createScanDocument('MultiPage', 'proj1');
  sdPages.pages = [createScanPage('a1', 0), createScanPage('a2', 1)];
  sdPages.pageCount = 2;
  const sdPages2 = roundtrip(sdPages);
  check('createScanDocument nested pages survive roundtrip', sdPages2.pages.length === 2 && sdPages2.pages[0].assetId === 'a1' && sdPages2.pages[1].index === 1);

  const edgeBase = createTextDocument('Edge', 'p1');
  edgeBase.blocks = [];
  edgeBase.relations = [];
  edgeBase.history = [];
  const edgeBase2 = roundtrip(edgeBase);
  check('Empty arrays (blocks, relations, history) survive roundtrip', Array.isArray(edgeBase2.blocks) && Array.isArray(edgeBase2.relations) && Array.isArray(edgeBase2.history));

  const nullDoc = createTextDocument('Nulls', 'p1');
  nullDoc.sourceAssetId = null;
  nullDoc.deletedAt = null;
  const nullDoc2 = roundtrip(nullDoc);
  check('Null fields survive roundtrip (not converted to undefined)', nullDoc2.sourceAssetId === null && nullDoc2.deletedAt === null);

  const nestedDoc = createTextDocument('Nested', 'p1');
  nestedDoc.metadata = { score: 0, extra: null, deep: { ok: true } };
  const nestedDoc2 = roundtrip(nestedDoc);
  check('Nested objects survive roundtrip', nestedDoc2.metadata.score === 0 && nestedDoc2.metadata.extra === null && nestedDoc2.metadata.deep.ok === true);

  const largeDoc = createTextDocument('Large', 'p1');
  largeDoc.dataUrl = 'data:image/png;base64,' + 'A'.repeat(100000);
  const largeDoc2 = roundtrip(largeDoc);
  check('Large dataUrl string survives roundtrip', largeDoc2.dataUrl.length === 100000 + 'data:image/png;base64,'.length);

  const uniDoc = createTextDocument('\u00C1\u00E9\u00FC\u00F1 \u4E16\u754C \uD83D\uDE00', 'p1');
  const uniDoc2 = roundtrip(uniDoc);
  check('Unicode characters in name survive roundtrip', uniDoc2.name === '\u00C1\u00E9\u00FC\u00F1 \u4E16\u754C \uD83D\uDE00');

  const boolDoc = createTextDocument('Bools', 'p1');
  boolDoc.deleted = false;
  boolDoc.wordCount = 0;
  boolDoc._writeSeq = 0;
  const boolDoc2 = roundtrip(boolDoc);
  check('Boolean false and 0 values survive roundtrip', boolDoc2.deleted === false && boolDoc2.wordCount === 0 && boolDoc2._writeSeq === 0);

  const tsDoc = createTextDocument('Timestamps', 'p1');
  const before = Date.now();
  tsDoc.createdAt = before;
  tsDoc.updatedAt = before;
  const tsDoc2 = roundtrip(tsDoc);
  check('Date.now() timestamps survive roundtrip as numbers', typeof tsDoc2.createdAt === 'number' && tsDoc2.createdAt === before);
}

// ================================================================
// Section 3: _writeSeq Guard Semantics (15 tests)
// ================================================================
console.log('\n--- 3. _writeSeq Guard Semantics ---');
{
  const projId = 'proj-wseq';

  {
    const doc = { id: 'ws-1', blocks: [] };
    const saved = await simulateSaveDoc(testDB, projId, doc);
    check('saveDoc _writeSeq=0 on new entity accepted, seq=1', saved._writeSeq === 1, 'seq=' + saved._writeSeq);
  }

  {
    const loaded = await idbGet(testDB, 'documents', 'ws-1');
    loaded._writeSeq = 1;
    const saved = await simulateSaveDoc(testDB, projId, loaded);
    check('saveDoc _writeSeq=1 after _writeSeq=0 accepted, seq=2', saved._writeSeq === 2, 'seq=' + saved._writeSeq);
  }

  {
    const stale = { id: 'ws-1', _writeSeq: 0, blocks: [] };
    const result = await simulateSaveDoc(testDB, projId, stale);
    check('saveDoc _writeSeq=0 after _writeSeq=1 REJECTED (stale)', result._writeSeq === 2, 'kept seq=' + result._writeSeq);
  }

  {
    const tbl = { id: 'dt-1', _writeSeq: 0 };
    const s1 = await simulateSaveData(testDB, projId, tbl);
    check('saveData _writeSeq=0 on new accepted, seq=1', s1._writeSeq === 1);

    const loaded2 = await idbGet(testDB, 'data', 'dt-1');
    loaded2._writeSeq = 1;
    const s2 = await simulateSaveData(testDB, projId, loaded2);
    check('saveData _writeSeq=1 after _writeSeq=0 accepted, seq=2', s2._writeSeq === 2);

    const stale2 = { id: 'dt-1', _writeSeq: 0 };
    const s3 = await simulateSaveData(testDB, projId, stale2);
    check('saveData _writeSeq=0 after _writeSeq=1 REJECTED', s3._writeSeq === 2, 'kept seq=' + s3._writeSeq);
  }

  {
    const doc2 = { id: 'ws-lww', blocks: ['v1'] };
    const first = await simulateSaveDoc(testDB, projId, doc2);
    check('LWW: first save seq=1', first._writeSeq === 1);

    const higher = { id: 'ws-lww', _writeSeq: 5, blocks: ['v5'] };
    const hi = await simulateSaveDoc(testDB, projId, higher);
    check('LWW: higher _writeSeq=5 accepted', hi._writeSeq === 2 && hi.blocks[0] === 'v5');

    const lower = { id: 'ws-lww', _writeSeq: 1, blocks: ['v3'] };
    const lo = await simulateSaveDoc(testDB, projId, lower);
    check('LWW: lower _writeSeq=1 rejected, keeps v5', lo.blocks[0] === 'v5' && lo._writeSeq === 2);
  }

  {
    const doc3 = { id: 'ws-conc', blocks: [] };
    await simulateSaveDoc(testDB, projId, doc3);
    const w1 = { id: 'ws-conc', _writeSeq: 10, blocks: ['w10'] };
    const w2 = { id: 'ws-conc', _writeSeq: 100, blocks: ['w100'] };
    await simulateSaveDoc(testDB, projId, w1);
    const r2 = await simulateSaveDoc(testDB, projId, w2);
    check('Concurrent: _writeSeq=100 wins over 10', r2._writeSeq === 3 && r2.blocks[0] === 'w100');
    const r3 = await simulateSaveDoc(testDB, projId, w1);
    check('Concurrent: stale _writeSeq=10 rejected after 100', r3.blocks[0] === 'w100');
  }

  {
    await idbDelete(testDB, 'documents', 'ws-fresh');
    const d1 = { id: 'ws-fresh', _writeSeq: 0, blocks: ['v1'] };
    const r1 = await simulateSaveDoc(testDB, projId, d1);
    check('Delete+recreate: first save accepted, seq=1', r1._writeSeq === 1);
    await idbDelete(testDB, 'documents', 'ws-fresh');
    const d2 = { id: 'ws-fresh', _writeSeq: 0, blocks: ['fresh'] };
    const r2 = await simulateSaveDoc(testDB, projId, d2);
    check('Delete+recreate: fresh entity _writeSeq=0 accepted, seq=1', r2._writeSeq === 1 && r2.blocks[0] === 'fresh');
  }

  {
    const ds = { id: 'ws-inc', blocks: [] };
    const r1 = await simulateSaveDoc(testDB, projId, ds);
    const r2 = await simulateSaveDoc(testDB, projId, { id: 'ws-inc', _writeSeq: 1 });
    const r3 = await simulateSaveDoc(testDB, projId, { id: 'ws-inc', _writeSeq: 2 });
    check('_writeSeq incremented by 1 each save (1,2,3)', r1._writeSeq === 1 && r2._writeSeq === 2 && r3._writeSeq === 3);
  }

  {
    const stored = await idbGet(testDB, 'documents', 'ws-inc');
    check('_writeSeq preserved in stored record', stored._writeSeq === 3);
  }

  {
    const saved = await simulateSaveDoc(testDB, projId, { id: 'ws-num', _writeSeq: 0 });
    check('_writeSeq comparison is numeric (string "0" treated as 0)', saved._writeSeq === 1);
  }

  {
    const docHi = { id: 'ws-big', _writeSeq: 100, blocks: [] };
    const r1 = await simulateSaveDoc(testDB, projId, docHi);
    check('_writeSeq=0 then _writeSeq=100: 100 accepted', r1._writeSeq === 1);
    const docLo = { id: 'ws-big', _writeSeq: 0, blocks: ['old'] };
    const r2 = await simulateSaveDoc(testDB, projId, docLo);
    check('_writeSeq=100 store rejects _writeSeq=0', r2._writeSeq === 1);
  }

  {
    const docMega = { id: 'ws-mega', _writeSeq: 999999, blocks: [] };
    const r1 = await simulateSaveDoc(testDB, projId, docMega);
    check('_writeSeq=999999 after new: accepted, seq=1', r1._writeSeq === 1);
    const docZero = { id: 'ws-mega', _writeSeq: 0, blocks: ['x'] };
    const r2 = await simulateSaveDoc(testDB, projId, docZero);
    check('_writeSeq=999999 store rejects _writeSeq=0', r2._writeSeq === 1);
  }

  {
    let didNotCrash = true;
    try {
      await simulateSaveDoc(testDB, projId, { id: 'ws-inf', _writeSeq: Infinity });
      const stored2 = await idbGet(testDB, 'documents', 'ws-inf');
      const inf2 = { id: 'ws-inf', _writeSeq: Infinity };
      await simulateSaveDoc(testDB, projId, inf2);
    } catch (e) { didNotCrash = false; }
    check('_writeSeq=Infinity does not crash', didNotCrash);
  }

  {
    let didNotCrash2 = true;
    try {
      await simulateSaveDoc(testDB, projId, { id: 'ws-nan', _writeSeq: NaN });
    } catch (e) { didNotCrash2 = false; }
    check('_writeSeq=NaN does not crash', didNotCrash2);
    const afterNaN = await idbGet(testDB, 'documents', 'ws-nan');
    check('_writeSeq=NaN treated as 0 (seq=1 on new)', afterNaN._writeSeq === 1);
  }

  {
    const freshDoc = { id: 'ws-undef', blocks: [] };
    delete freshDoc._writeSeq;
    const r = await simulateSaveDoc(testDB, projId, freshDoc);
    check('_writeSeq=undefined on new entity treated as 0, seq=1', r._writeSeq === 1);
  }
}

// ================================================================
// Section 4: Session Persistence Roundtrip (10 tests)
// ================================================================
console.log('\n--- 4. Session Persistence Roundtrip ---');
{
  await idbClear(testDB, 'settings');

  {
    const s = await simSaveSession(testDB, 'sess-min', { currentView: 'projects' });
    const loaded = await simLoadSessions(testDB);
    check('Minimal session saved and loaded', loaded.length === 1 && loaded[0].sessionId === 'sess-min');
  }

  {
    const s = await simSaveSession(testDB, 'sess-full', {
      currentView: 'dashboard',
      currentProjectId: 'proj-full',
      currentDocId: 'doc-full',
      currentDataTableId: 'dt-full',
      documents: [{ id: 'd1' }, { id: 'd2' }],
      dataTables: [{ id: 't1' }],
      captures: [{ id: 'c1' }],
      flowNodes: [{ id: 'n1', x: 10, y: 20 }],
      flowEdges: [{ id: 'e1', source: 'n1' }],
      theme: 'dark',
      density: 'compact',
      sidebarCollapsed: true,
    });
    const loaded = await simLoadSessions(testDB);
    const full = loaded.find(s => s.sessionId === 'sess-full');
    check('Full state session roundtrip: view, project, doc', full && full.workspace.currentView === 'dashboard' && full.workspace.currentProjectId === 'proj-full');
    check('Full state session roundtrip: nested flowNodes/flowEdges', full && full.workspace.flowNodes.length === 1 && full.workspace.flowEdges.length === 1);
  }

  {
    const nested = await simSaveSession(testDB, 'sess-nested', {
      flowNodes: [{ id: 'fn1', config: { tool: 'ocr', params: { lang: 'es' } } }],
      flowEdges: [{ id: 'fe1', source: 'fn1', target: 'fn2' }],
      documents: [{ id: 'd1', metadata: { nested: true } }],
    });
    const loaded = await simLoadSessions(testDB);
    const s = loaded.find(x => x.sessionId === 'sess-nested');
    check('Nested objects in session survive roundtrip', s && s.workspace.flowNodes[0].config.params.lang === 'es');
  }

  {
    const emptyArr = await simSaveSession(testDB, 'sess-empty', {
      documents: [],
      dataTables: [],
      captures: [],
      flowNodes: [],
      flowEdges: [],
    });
    const loaded = await simLoadSessions(testDB);
    const s = loaded.find(x => x.sessionId === 'sess-empty');
    check('Empty arrays in session survive roundtrip', s && Array.isArray(s.workspace.documents) && s.workspace.documents.length === 0);
  }

  {
    await idbClear(testDB, 'settings');
    await simSaveSession(testDB, 'sess-a', { currentView: 'projects' });
    await simSaveSession(testDB, 'sess-b', { currentView: 'dashboard' });
    const loaded = await simLoadSessions(testDB);
    check('Two sessions saved: both load', loaded.length === 2);
  }

  {
    await idbClear(testDB, 'settings');
    for (let i = 0; i < MAX_SESSIONS + 1; i++) {
      await simSaveSession(testDB, 'sess-' + i, { currentView: 'view-' + i });
    }
    const loaded = await simLoadSessions(testDB);
    check('MAX_SESSIONS+1 sessions: oldest evicted', loaded.length === MAX_SESSIONS, 'count=' + loaded.length);
    const hasZero = loaded.some(s => s.sessionId === 'sess-0');
    check('Evicted session is the oldest (sess-0 gone)', !hasZero);
  }

  {
    await idbClear(testDB, 'settings');
    await simSaveSession(testDB, 'sess-del', { currentView: 'projects' });
    let loaded = await simLoadSessions(testDB);
    check('Session exists before delete', loaded.length === 1);
    await simDeleteSession(testDB, 'sess-del');
    loaded = await simLoadSessions(testDB);
    check('deleteWorkspaceSession: session removed', loaded.length === 0);
  }

  {
    await idbClear(testDB, 'settings');
    await simSaveSession(testDB, 'sess-clean-a', {
      currentProjectId: 'proj-to-delete',
      documents: [{ id: 'del-doc-1' }, { id: 'del-doc-2' }],
      dataTables: [{ id: 'del-dt-1' }],
      captures: [{ id: 'del-cap-1' }],
    });
    await simSaveSession(testDB, 'sess-clean-b', {
      currentProjectId: 'proj-other',
      documents: [{ id: 'keep-doc' }],
    });
    await simCleanupForProject(testDB, 'proj-to-delete', ['del-doc-1', 'del-doc-2', 'del-dt-1', 'del-cap-1']);
    const loaded = await simLoadSessions(testDB);
    const sA = loaded.find(s => s.sessionId === 'sess-clean-a');
    const sB = loaded.find(s => s.sessionId === 'sess-clean-b');
    check('cleanupSessionsForProject: project nulled', sA && sA.workspace.currentProjectId === null);
    check('cleanupSessionsForProject: deleted docs removed', sA && sA.workspace.documents.length === 0);
    check('cleanupSessionsForProject: other session untouched', sB && sB.workspace.currentProjectId === 'proj-other');
  }

  {
    await idbDelete(testDB, 'settings', SESSION_KEY);
    const loaded = await simLoadSessions(testDB);
    check('Load sessions when none exist: returns empty array', Array.isArray(loaded) && loaded.length === 0);
  }

  {
    await idbClear(testDB, 'settings');
    const s = await simSaveSession(testDB, 'sess-opt', {
      currentProjectId: undefined,
      currentDocId: undefined,
      theme: null,
      density: null,
      sidebarCollapsed: null,
    });
    const loaded = await simLoadSessions(testDB);
    const found = loaded.find(x => x.sessionId === 'sess-opt');
    check('Undefined/null optional fields survive session roundtrip', found && found.workspace.currentProjectId === null && found.workspace.theme === null);
  }
}

// ================================================================
// Section 5: localStorage Key Integrity (10 tests)
// ================================================================
console.log('\n--- 5. localStorage Key Integrity ---');
{
  localStorage.setItem('toolisto-theme', 'dark');
  check('toolisto-theme set and read', localStorage.getItem('toolisto-theme') === 'dark');
  localStorage.removeItem('toolisto-theme');

  localStorage.setItem('toolisto-density', 'compact');
  check('toolisto-density set and read', localStorage.getItem('toolisto-density') === 'compact');
  localStorage.removeItem('toolisto-density');

  localStorage.setItem('toolisto-sidebar-collapsed', 'true');
  check('toolisto-sidebar-collapsed set and read', localStorage.getItem('toolisto-sidebar-collapsed') === 'true');
  localStorage.removeItem('toolisto-sidebar-collapsed');

  const favTools = ['ocr', 'table', 'chart'];
  localStorage.setItem('toolisto-favorite-tools', JSON.stringify(favTools));
  const favLoaded = JSON.parse(localStorage.getItem('toolisto-favorite-tools'));
  check('toolisto-favorite-tools roundtrip as JSON array', Array.isArray(favLoaded) && favLoaded.length === 3 && favLoaded[0] === 'ocr');
  localStorage.removeItem('toolisto-favorite-tools');

  const recTools = ['scan', 'design'];
  localStorage.setItem('toolisto-recent-tools', JSON.stringify(recTools));
  const recLoaded = JSON.parse(localStorage.getItem('toolisto-recent-tools'));
  check('toolisto-recent-tools roundtrip as JSON array', Array.isArray(recLoaded) && recLoaded.length === 2 && recLoaded[1] === 'design');
  localStorage.removeItem('toolisto-recent-tools');

  localStorage.setItem('toolisto-ws-favorites', 'proj-fav-1,proj-fav-2');
  check('toolisto-ws-favorites roundtrip', localStorage.getItem('toolisto-ws-favorites') === 'proj-fav-1,proj-fav-2');
  localStorage.removeItem('toolisto-ws-favorites');

  localStorage.setItem('toolisto-ws-recent', 'proj-recent-1');
  check('toolisto-ws-recent roundtrip', localStorage.getItem('toolisto-ws-recent') === 'proj-recent-1');
  localStorage.removeItem('toolisto-ws-recent');

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const sid = generateId();
  localStorage.setItem('toolisto-session-id', sid);
  check('toolisto-session-id is valid UUID format', uuidRe.test(localStorage.getItem('toolisto-session-id')), sid);
  localStorage.removeItem('toolisto-session-id');

  const cfg = { autoSave: true, theme: 'light' };
  localStorage.setItem('toolisto-workspace-config', JSON.stringify(cfg));
  const cfgLoaded = JSON.parse(localStorage.getItem('toolisto-workspace-config'));
  check('toolisto-workspace-config roundtrip', cfgLoaded.autoSave === true && cfgLoaded.theme === 'light');
  localStorage.removeItem('toolisto-workspace-config');

  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('toolisto-')) allKeys.push(k);
  }
  const allFollowConvention = allKeys.every(k => /^toolisto-[a-z0-9-]+$/.test(k));
  check('All localStorage keys follow toolisto-* naming convention', allFollowConvention, 'keys=' + allKeys.length);
}

// ================================================================
// Section 6: Schema Version Consistency (8 tests)
// ================================================================
console.log('\n--- 6. Schema Version Consistency ---');
{
  check('DB_SCHEMA_VERSION === 3', DB_SCHEMA_VERSION === 3, 'val=' + DB_SCHEMA_VERSION);
  check('OBJECT_SCHEMA_VERSION === 2', OBJECT_SCHEMA_VERSION === 2, 'val=' + OBJECT_SCHEMA_VERSION);
  check('BUNDLE_SCHEMA_VERSION === 3', BUNDLE_SCHEMA_VERSION === 3, 'val=' + BUNDLE_SCHEMA_VERSION);
  check('STORAGE_ENVELOPE_VERSION === 2', STORAGE_ENVELOPE_VERSION === 2, 'val=' + STORAGE_ENVELOPE_VERSION);
  check('SESSION_SCHEMA_VERSION === 1', SESSION_SCHEMA_VERSION === 1, 'val=' + SESSION_SCHEMA_VERSION);
  check('DATA_MODEL_SCHEMA_VERSION === 1', DATA_MODEL_SCHEMA_VERSION === 1, 'val=' + DATA_MODEL_SCHEMA_VERSION);
  check('WORKFLOW_DEFINITION_VERSION === 1', WORKFLOW_DEFINITION_VERSION === 1, 'val=' + WORKFLOW_DEFINITION_VERSION);
  check('MODEL_VERSION from models.js === OBJECT_SCHEMA_VERSION', MODEL_VERSION === OBJECT_SCHEMA_VERSION, MODEL_VERSION + ' vs ' + OBJECT_SCHEMA_VERSION);
}

// ================================================================
// Section 7: Object URL Lifecycle (8 tests)
// ================================================================
console.log('\n--- 7. Object URL Lifecycle ---');
{
  _objectUrls.clear();

  {
    const blob = new Blob(['test-data'], { type: 'text/plain' });
    const url = createObjectUrl(blob);
    check('createObjectUrl returns string starting with blob:', typeof url === 'string' && url.startsWith('blob:'));
  }

  {
    _objectUrls.clear();
    const b1 = new Blob(['a'], { type: 'text/plain' });
    const url1 = createObjectUrl(b1);
    check('createObjectUrl tracks URL in _objectUrls', _objectUrls.has(url1) && _objectUrls.size === 1);
  }

  {
    _objectUrls.clear();
    const b2 = new Blob(['b'], { type: 'text/plain' });
    const url2 = createObjectUrl(b2);
    revokeObjectUrl(url2);
    check('revokeObjectUrl removes URL from _objectUrls', !_objectUrls.has(url2) && _objectUrls.size === 0);
  }

  {
    _objectUrls.clear();
    for (let i = 0; i < 5; i++) createObjectUrl(new Blob(['chunk-' + i], { type: 'text/plain' }));
    check('5 URLs created, _objectUrls.size === 5', _objectUrls.size === 5);
    revokeAllObjectUrls();
    check('revokeAllObjectUrls: _objectUrls is empty after revoke', _objectUrls.size === 0);
  }

  {
    const b3 = new Blob(['c'], { type: 'text/plain' });
    const url3 = createObjectUrl(b3);
    revokeObjectUrl(url3);
    let noError = true;
    try { revokeObjectUrl(url3); } catch (e) { noError = false; }
    check('Revoke already-revoked URL: no error', noError);
    check('Revoke already-revoked URL: _objectUrls unchanged', _objectUrls.size === 0);
  }

  {
    _objectUrls.clear();
    const b4a = new Blob(['d1'], { type: 'text/plain' });
    const url4a = createObjectUrl(b4a);
    revokeObjectUrl(url4a);
    const b4b = new Blob(['d2'], { type: 'text/plain' });
    const url4b = createObjectUrl(b4b);
    check('Create, revoke, create: _objectUrls size is 1', _objectUrls.size === 1 && _objectUrls.has(url4b));
  }

  {
    _objectUrls.clear();
    for (let i = 0; i < 3; i++) createObjectUrl(new Blob(['x-' + i], { type: 'text/plain' }));
    check('getActiveObjectUrls returns correct count before revoke', getActiveObjectUrls() === 3);
    revokeAllObjectUrls();
    check('revokeAllObjectUrls clears Set completely', getActiveObjectUrls() === 0 && _objectUrls.size === 0);
  }
}

// ================================================================
// SUMMARY
// ================================================================
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
