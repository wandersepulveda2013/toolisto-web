#!/usr/bin/env node
/**
 * Phase 4b — Integridad referencial del workspace (WSP-012, WDX-003)
 *
 * Demuestra sobre IndexedDB real:
 *  1. Auditor de huérfanos (auditOrphans/assertIntegrity): un grafo consistente
 *     es `valid`, y cada referencia rota (projectId, sourceDocId,
 *     config.sourceTableId, metadata.captureId, relations.targetId,
 *     inputAssetIds, derivedIds) se reporta con owner y campo.
 *  2. Borrado en cascada transitivo y unidireccional (deleteWithCascade):
 *     borrar una captura elimina cadena captura -> asset -> documento -> tabla
 *     -> gráfico -> export -> ejecución, pero NUNCA el proyecto ni la fuente
 *     vía back-references de linaje (relaciones bidireccionales se podan).
 *  3. Poda de relaciones colgantes en objetos supervivientes y
 *     pruneDanglingReferences.
 *  4. deleteProject deja CERO registros en los 8 stores (WDX-003) y emite
 *     `integrity:audited` válido.
 *  5. importProject remapea targetId/from/to y deja un grafo sin huérfanos.
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'deep-audit');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

let _srv;
function startServer() {
  return new Promise((resolve, reject) => {
    _srv = createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/index.html';
      let fp = join(DIST, file);
      if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(DIST, file + '.html');
      const ext = extname(fp).toLowerCase();
      const data = readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}
function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

let pass = 0, fail = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}
function ko(name, detail = '') { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }

const SEED_SNIPPET = `
  const __db = await import('/workspace/core/db.js');
  const __S = __db.STORES;
  for (const s of Object.values(__S)) { try { await __db.dbClear(s); } catch (e) {} }
  const __now = Date.now();
  const __base = (id, type, extra = {}) => ({
    id, type, createdAt: __now, updatedAt: __now, projectId: 'p1', _version: 1,
    metadata: {}, history: [], relations: [], processingState: 'idle', errors: [],
    sourceAssetId: null, derivedIds: [],
    ...extra,
  });
  await __db.dbPut(__S.projects, __base('p1', 'project', { projectId: null, name: 'P1' }));
  await __db.dbPut(__S.captures, __base('cap1', 'capture', { sourceAssetId: 'asset1', relations: [{ targetId: 'asset1', type: 'asset' }] }));
  await __db.dbPut(__S.assets, __base('asset1', 'image-asset', { metadata: { captureId: 'cap1' }, relations: [{ targetId: 'cap1', type: 'source-capture' }] }));
  await __db.dbPut(__S.documents, __base('doc1', 'text-document', { captureId: 'cap1', sourceAssetId: 'asset1', relations: [{ targetId: 'cap1', type: 'capture' }, { targetId: 'asset1', type: 'source' }] }));
  await __db.dbPut(__S.data, __base('tab1', 'table-document', { sourceAssetId: 'doc1', scanDocId: 'doc1', sourceDocId: 'doc1', relations: [{ targetId: 'doc1', type: 'source-document' }] }));
  await __db.dbPut(__S.assets, __base('chart1', 'chart', { sourceTableId: 'tab1', config: { sourceTableId: 'tab1' }, relations: [{ targetId: 'tab1', type: 'derived-table' }] }));
  await __db.dbPut(__S.assets, __base('exp1', 'export-artifact', { sourceType: 'chart', sourceId: 'chart1', sourceAssetId: 'chart1' }));
  await __db.dbPut(__S.executions, __base('exec1', 'tool-execution', { toolId: 'ocr', inputAssetIds: ['asset1'], sourceAssetId: 'tab1', resultAssetId: 'chart1' }));
`;

async function resetDB(page) {
  return page.evaluate(async () => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
  });
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log('\n=== Phase 4b: Integridad referencial ===');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}/workspace/core/db.js`);

  const jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  // ─── 1. Auditor de huérfanos: grafo consistente ───────────────
  console.log('\n--- 1. Auditor: grafo consistente es valido ---');
  await resetDB(page);
  const clean = await page.evaluate(`(async () => {
    ${SEED_SNIPPET}
    const integrity = await import('/workspace/core/integrity.js');
    return integrity.auditOrphans();
  })()`);
  ok('1. Grafo completo es valido', clean.valid === true, `orphans=${clean.orphans.length}`);
  ok('1. Sin huérfanos', Array.isArray(clean.orphans) && clean.orphans.length === 0);

  // ─── 2. Auditor: referencias rotas se detectan ────────────────
  console.log('\n--- 2. Auditor: cada tipo de huérfano se reporta ---');
  const orphans = await page.evaluate(`(async () => {
    ${SEED_SNIPPET}
    const db = await import('/workspace/core/db.js');
    const S = db.STORES;
    const now = Date.now();
    const dirty = (id, type, extra = {}) => ({ id, type, projectId: 'p1', createdAt: now, updatedAt: now, _version: 1, metadata: {}, history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], ...extra });
    await db.dbPut(S.documents, dirty('orph-proj', 'text-document', { projectId: 'ghost-project' }));
    await db.dbPut(S.documents, dirty('orph-doc', 'text-document', { sourceDocId: 'ghost-doc' }));
    await db.dbPut(S.assets, dirty('orph-chart', 'chart', { config: { sourceTableId: 'ghost-table' } }));
    await db.dbPut(S.assets, dirty('orph-meta', 'image-asset', { metadata: { captureId: 'ghost-capture' } }));
    await db.dbPut(S.captures, dirty('orph-rel', 'capture', { relations: [{ targetId: 'ghost-target', type: 'x' }] }));
    await db.dbPut(S.executions, dirty('orph-in', 'tool-execution', { inputAssetIds: ['ghost-input'], derivedIds: ['ghost-derived'] }));
    const integrity = await import('/workspace/core/integrity.js');
    return integrity.auditOrphans();
  })()`);
  ok('2. Auditor reporta no válido', orphans.valid === false, `orphans=${orphans.orphans.length}`);
  ok('2. projectId roto detectado', orphans.orphans.some(o => o.field === 'projectId' && o.value === 'ghost-project'), JSON.stringify(orphans.orphans));
  ok('2. sourceDocId roto detectado', orphans.orphans.some(o => o.field === 'sourceDocId' && o.value === 'ghost-doc'));
  ok('2. config.sourceTableId roto detectado', orphans.orphans.some(o => o.field === 'config.sourceTableId' && o.value === 'ghost-table'));
  ok('2. metadata.captureId roto detectado', orphans.orphans.some(o => o.field === 'metadata.captureId' && o.value === 'ghost-capture'));
  ok('2. relations rota detectada', orphans.orphans.some(o => o.field === 'relations' && o.value === 'ghost-target'));
  ok('2. inputAssetIds roto detectado', orphans.orphans.some(o => o.field === 'inputAssetIds' && o.value === 'ghost-input'));
  ok('2. derivedIds roto detectado', orphans.orphans.some(o => o.field === 'derivedIds' && o.value === 'ghost-derived'));

  // ─── 3. Cascada transitiva unidireccional ─────────────────────
  console.log('\n--- 3. deleteWithCascade: cadena completa ---');
  const cascade = await page.evaluate(`(async () => {
    ${SEED_SNIPPET}
    const integrity = await import('/workspace/core/integrity.js');
    const result = await integrity.deleteWithCascade('captures', 'cap1');
    const db = await import('/workspace/core/db.js');
    const S = db.STORES;
    const state = {
      capture: await db.dbGet(S.captures, 'cap1'),
      asset: await db.dbGet(S.assets, 'asset1'),
      doc: await db.dbGet(S.documents, 'doc1'),
      table: await db.dbGet(S.data, 'tab1'),
      chart: await db.dbGet(S.assets, 'chart1'),
      export: await db.dbGet(S.assets, 'exp1'),
      execution: await db.dbGet(S.executions, 'exec1'),
      project: await db.dbGet(S.projects, 'p1'),
    };
    const audit = await integrity.auditOrphans();
    return { result, state, audit };
  })()`);
  ok('3. Captura eliminada', !cascade.state.capture, cascade.state.capture?.id);
  ok('3. Asset derivado eliminado', !cascade.state.asset, cascade.state.asset?.id);
  ok('3. Documento eliminado', !cascade.state.doc, cascade.state.doc?.id);
  ok('3. Tabla eliminada', !cascade.state.table, cascade.state.table?.id);
  ok('3. Gráfico eliminado', !cascade.state.chart, cascade.state.chart?.id);
  ok('3. Export eliminado', !cascade.state.export, cascade.state.export?.id);
  ok('3. Ejecución eliminada', !cascade.state.execution, cascade.state.execution?.id);
  ok('3. Proyecto conservado', !!cascade.state.project, cascade.state.project?.name);
  ok('3. Cascada transitiva (7 IDs)', Array.isArray(cascade.result.deletedIds) && cascade.result.deletedIds.length === 7, `${cascade.result.deletedIds.length} IDs`);
  ok('3. Grafo sigue válido tras cascada', cascade.audit.valid === true, `orphans=${cascade.audit.orphans.length}`);

  // ─── 3b. Vista previa de cascada: informa sin borrar ──────────
  console.log('\n--- 3b. previewCaptureDeletion: alcance visible sin escritura ---');
  await resetDB(page);
  const preview = await page.evaluate(`(async () => {
    ${SEED_SNIPPET}
    const storage = await import('/workspace/core/storage.js');
    const db = await import('/workspace/core/db.js');
    const result = await storage.previewCaptureDeletion('cap1');
    const capture = await db.dbGet(db.STORES.captures, 'cap1');
    const execution = await db.dbGet(db.STORES.executions, 'exec1');
    return { result, capture, execution };
  })()`);
  ok('3b. Vista previa incluye la captura y sus derivados', preview.result.deletedIds.length === 7, `${preview.result.deletedIds.length} IDs`);
  ok('3b. Vista previa identifica documento, tabla y gráfico', ['text-document', 'table-document', 'chart'].every(type => preview.result.records.some(record => record.type === type)));
  ok('3b. Vista previa no borra la captura', preview.capture?.id === 'cap1');
  ok('3b. Vista previa no borra la ejecución', preview.execution?.id === 'exec1');

  // ─── 4. Back-references de linaje NO sobre-borran ─────────────
  console.log('\n--- 4. Relaciones bidireccionales se podan, no cascadan ---');
  const backref = await page.evaluate(async () => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const S = db.STORES;
    const now = Date.now();
    const base = (id, type, extra = {}) => ({ id, type, projectId: 'p2', createdAt: now, updatedAt: now, _version: 1, metadata: {}, history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], ...extra });
    await db.dbPut(S.projects, base('p2', 'project', { projectId: null, name: 'P2' }));
    await db.dbPut(S.documents, base('docx', 'text-document', { relations: [{ targetId: 'taby', type: 'derived-table' }] }));
    await db.dbPut(S.data, base('taby', 'table-document', { sourceAssetId: 'docx', relations: [{ targetId: 'docx', type: 'source-document' }] }));
    const integrity = await import('/workspace/core/integrity.js');
    const result = await integrity.deleteWithCascade('data', 'taby');
    const docAfter = await db.dbGet(S.documents, 'docx');
    const audit = await integrity.auditOrphans();
    return { result, docAfter, audit };
  });
  ok('4. Tabla borrada', backref.result.deletedIds.includes('taby'));
  ok('4. Solo la tabla borrada (1 ID)', backref.result.deletedIds.length === 1, `${backref.result.deletedIds.length} IDs`);
  ok('4. Documento fuente NO se borra (back-reference)', backref.docAfter !== null);
  ok('4. Relación colgante podada en el documento', Array.isArray(backref.docAfter.relations) && backref.docAfter.relations.length === 0, JSON.stringify(backref.docAfter.relations));
  ok('4. Grafo válido tras podar', backref.audit.valid === true, `orphans=${backref.audit.orphans.length}`);

  // ─── 5. pruneDanglingReferences ───────────────────────────────
  console.log('\n--- 5. pruneDanglingReferences limpia referencias colgantes ---');
  const prune = await page.evaluate(async () => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const S = db.STORES;
    const now = Date.now();
    const base = (id, type, extra = {}) => ({ id, type, projectId: 'p3', createdAt: now, updatedAt: now, _version: 1, metadata: {}, history: [], relations: [], processingState: 'idle', errors: [], sourceAssetId: null, derivedIds: [], ...extra });
    await db.dbPut(S.projects, base('p3', 'project', { projectId: null, name: 'P3' }));
    await db.dbPut(S.documents, base('doce', 'text-document', { relations: [{ targetId: 'gone', type: 'rel' }, { targetId: 'kept', type: 'rel' }], derivedIds: ['gone', 'kept'] }));
    await db.dbPut(S.documents, base('kept', 'text-document'));
    const integrity = await import('/workspace/core/integrity.js');
    await db.dbDelete(S.documents, 'gone');
    const result = await integrity.pruneDanglingReferences(['gone']);
    const docAfter = await db.dbGet(S.documents, 'doce');
    const audit = await integrity.auditOrphans();
    return { result, docAfter, audit };
  });
  ok('5. Podó la relación colgante', prune.result.removedRelations === 1, `removed=${prune.result.removedRelations}`);
  ok('5. Relación superviviente conservada', prune.docAfter.relations.length === 1 && prune.docAfter.relations[0].targetId === 'kept', JSON.stringify(prune.docAfter.relations));
  ok('5. derivedIds colgantes eliminados', Array.isArray(prune.docAfter.derivedIds) && prune.docAfter.derivedIds.length === 1 && prune.docAfter.derivedIds[0] === 'kept', JSON.stringify(prune.docAfter.derivedIds));
  ok('5. Grafo válido tras poda', prune.audit.valid === true, `orphans=${prune.audit.orphans.length}`);

  // ─── 6. deleteProject deja 0 registros en los 8 stores (WDX-003) ──
  console.log('\n--- 6. deleteProject: cero IDs/blobs en los 8 stores ---');
  const wdx = await page.evaluate(async () => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const storage = await import('/workspace/core/storage.js');
    const events = await import('/workspace/core/events.js');
    const S = db.STORES;
    const project = await storage.createProject('Proyecto WDX-003', 'para borrado total');
    const pid = project.id;
    await storage.saveDoc(pid, { type: 'text-document', title: 'Doc', blocks: [] });
    await storage.saveData(pid, { type: 'table-document', name: 'Tabla', headers: ['A'], rows: [['1']] });
    await storage.saveCapture(pid, { type: 'capture', filename: 'scan.png' });
    await storage.saveAsset(pid, { type: 'image-asset', name: 'asset.png' });
    await storage.saveExecution(pid, { type: 'tool-execution', toolId: 'ocr', toolName: 'OCR' });
    await storage.saveWorkflow(pid, { type: 'workflow', name: 'Flujo', nodes: [], edges: [] });
    await storage.saveSetting('dashboard:' + pid, { blocks: [] });
    await storage.saveSetting('query:' + pid, { sheets: [] });
    await storage.saveSetting('model:' + pid, { nodes: [], relationships: [] });

    const audited = new Promise((resolve) => {
      events.once('integrity:audited', (audit) => resolve(audit));
    });
    await storage.deleteProject(pid);
    const auditEvent = await audited;

    const counts = {};
    for (const s of Object.values(S)) {
      counts[s] = (await db.dbGetAll(s)).length;
    }
    const integrity = await import('/workspace/core/integrity.js');
    const audit = await integrity.auditOrphans();
    return { counts, audit, auditEvent };
  });
  ok('6. Evento integrity:audited emitido y válido', wdx.auditEvent && wdx.auditEvent.valid === true, JSON.stringify(wdx.auditEvent));
  ok('6. Cero proyectos', wdx.counts.projects === 0, `projects=${wdx.counts.projects}`);
  ok('6. Cero documentos', wdx.counts.documents === 0);
  ok('6. Cero datos', wdx.counts.data === 0);
  ok('6. Cero capturas', wdx.counts.captures === 0);
  ok('6. Cero settings', wdx.counts.settings === 0, `settings=${wdx.counts.settings}`);
  ok('6. Cero assets', wdx.counts.assets === 0);
  ok('6. Cero ejecuciones', wdx.counts.executions === 0);
  ok('6. Cero workflows', wdx.counts.workflows === 0);
  ok('6. Auditor post-borrado válido', wdx.audit.valid === true, `orphans=${wdx.audit.orphans.length}`);

  // ─── 7. importProject remapea y deja grafo válido ─────────────
  console.log('\n--- 7. importProject: sin huérfanos tras importar ---');
  const imp = await page.evaluate(async () => {
    await new Promise((r, j) => {
      const q = indexedDB.deleteDatabase('toolisto-workspace');
      q.onsuccess = () => r(); q.onerror = () => j(q.error); q.onblocked = () => j(new Error('bloqueado'));
    });
    const db = await import('/workspace/core/db.js');
    db.closeDB();
    await db.openDB();
    const storage = await import('/workspace/core/storage.js');
    const bundle = {
      version: 2,
      project: { id: 'srcp', type: 'project', name: 'Importado' },
      documents: [{ id: 'sd1', type: 'text-document', sourceAssetId: 'sa1', relations: [{ targetId: 'sc1', type: 'capture' }, { from: 'sc1', to: 'sa1', type: 'legacy' }] }],
      captures: [{ id: 'sc1', type: 'capture', sourceAssetId: 'sa1' }],
      dataTables: [{ id: 'st1', type: 'table-document', sourceAssetId: 'sd1', scanDocId: 'sd1' }],
      assets: [
        { id: 'sa1', type: 'image-asset', metadata: { captureId: 'sc1' } },
        { id: 'sch1', type: 'chart', config: { sourceTableId: 'st1' } },
      ],
      executions: [{ id: 'se1', type: 'tool-execution', inputAssetIds: ['sa1'], sourceAssetId: 'st1', resultAssetId: 'sch1' }],
      workflows: [{ id: 'sw1', type: 'workflow', nodes: [], edges: [] }],
    };
    const imported = await storage.importProject(bundle);
    const integrity = await import('/workspace/core/integrity.js');
    const audit = await integrity.auditOrphans();
    const project = await db.dbGet(db.STORES.projects, imported.id);
    return { audit, project, importedId: imported.id };
  });
  ok('7. Proyecto importado existe', imp.project !== null, imp.project?.name);
  ok('7. Grafo importado sin huérfanos', imp.audit.valid === true, `${imp.audit.orphans.length} huérfanos: ${JSON.stringify(imp.audit.orphans.slice(0, 3))}`);

  // ─── Resumen ──────────────────────────────────────────────────
  console.log('\n--- Errores ---');
  ok('No page errors', pageErrors.length === 0, pageErrors.join(' | '));
  ok('No console errors', jsErrors.length === 0, jsErrors.join(' | '));

  console.log(`\n=== Phase 4b Integridad: ${pass} passed, ${fail} failed ===`);

  await browser.close();
  await stopServer();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
