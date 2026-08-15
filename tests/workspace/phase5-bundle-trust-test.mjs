#!/usr/bin/env node
/**
 * Phase 5 — Confianza export/import del bundle .toolisto (WSP-014, WDX-002,
 * WSP-013, WDX-007, WSP-015)
 *
 * Demuestra sobre IndexedDB real:
 *  1. buildManifest produce schemaVersion/appVersion/checksums SHA-256 por
 *     objeto y cadena de derivación; validateBundleImport valida el bundle.
 *  2. exportProject adjunta el manifiesto y el round-trip export -> import
 *     remapea IDs (proyecto, derivedIds, inputAssetIds, relaciones, config,
 *     metadata.captureId, ScanDocument y páginas de escáner, model) y deja un
 *     grafo sin huérfanos.
 *  3. Un bundle alterado (un byte en un documento) se RECHAZA con diagnóstico
 *     y la base de datos queda idéntica (importación atómica, WDX-007).
 *  4. Un objeto eliminado del bundle se detecta por conteo del manifiesto.
 *  5. Los bundles heredados (sin manifest) siguen importando (compatibilidad).
 *  6. Límites adversarios configurables (conteos, profundidad, tamaño)
 *     rechazan la importación sin tocar la base (WSP-015).
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { writeEvidence } from '../evidence-helper.mjs';

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

const SEED = `
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
   await __db.dbPut(__S.captures, __base('cap1', 'capture', { sourceAssetId: 'asset1', scanDocumentId: 'scan1', correctedAssetId: 'corrected1', relations: [{ targetId: 'asset1', type: 'asset' }, { targetId: 'scan1', type: 'scan-document' }, { targetId: 'corrected1', type: 'corrected-asset' }] }));
   await __db.dbPut(__S.assets, __base('asset1', 'image-asset', { metadata: { captureId: 'cap1' }, relations: [{ targetId: 'cap1', type: 'source-capture' }] }));
   await __db.dbPut(__S.assets, __base('scan1', 'scan-document', { sourceAssetId: 'asset1', captureId: 'cap1', correctedAssetId: 'corrected1', pages: [{ originalAssetId: 'asset1', correctedAssetId: 'corrected1', assetId: 'corrected1' }] }));
   await __db.dbPut(__S.assets, __base('corrected1', 'image-asset', { metadata: { captureId: 'cap1', captureType: 'scan' }, relations: [{ targetId: 'cap1', type: 'source-capture' }] }));
  await __db.dbPut(__S.documents, __base('doc1', 'text-document', { captureId: 'cap1', sourceAssetId: 'asset1', relations: [{ targetId: 'cap1', type: 'capture' }, { targetId: 'asset1', type: 'source' }] }));
  await __db.dbPut(__S.data, __base('tab1', 'table-document', { sourceAssetId: 'doc1', scanDocId: 'doc1', sourceDocId: 'doc1', relations: [{ targetId: 'doc1', type: 'source-document' }] }));
  await __db.dbPut(__S.assets, __base('chart1', 'chart', { sourceTableId: 'tab1', config: { sourceTableId: 'tab1' }, derivedIds: ['exp1'], relations: [{ targetId: 'tab1', type: 'derived-table' }] }));
  await __db.dbPut(__S.assets, __base('exp1', 'export-artifact', { sourceType: 'chart', sourceId: 'chart1', sourceAssetId: 'chart1' }));
  await __db.dbPut(__S.executions, __base('exec1', 'tool-execution', { toolId: 'ocr', inputAssetIds: ['asset1'], sourceAssetId: 'tab1', resultAssetId: 'chart1' }));
  await __db.dbPut(__S.settings, { key: 'dashboard:p1', value: { blocks: [] }, updatedAt: __now });
  await __db.dbPut(__S.settings, { key: 'query:p1', value: { sheets: [] }, updatedAt: __now });
  await __db.dbPut(__S.settings, { key: 'model:p1', value: { nodes: [{ id: 'n1', tableId: 'tab1' }], relationships: [{ fromTableId: 'tab1', toTableId: 'tab1' }] }, updatedAt: __now });
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
  console.log('\n=== Phase 5: Confianza export/import del bundle ===');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}/workspace/core/db.js`);
  const jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  // ─── 1. buildManifest / validateBundleImport unit ─────────────
  console.log('\n--- 1. Manifiesto: hashes por objeto y derivación ---');
  const unit = await page.evaluate(`(async () => {
    const bundle = await import('/workspace/core/bundle.js');
    const b = { version: 2, exportedAt: Date.now(), project: { id: 'a', type: 'project', name: 'A' }, documents: [{ id: 'd1', type: 'text-document', title: 'Hola' }], dataTables: [], captures: [], assets: [], executions: [], workflows: [] };
    const manifest = await bundle.buildManifest(b);
    b.manifest = manifest;
    const validation = await bundle.validateBundleImport(b);
    b.documents[0].title = 'Cambiado';
    const tampered = await bundle.validateManifest(b);
    return {
      schemaVersion: manifest.schemaVersion,
      appVersion: manifest.appVersion,
      projectChecksumLen: (manifest.checksums.project || '').length,
      docChecksums: Object.keys(manifest.checksums.documents || {}).length,
      countsDocuments: manifest.counts.documents,
      relationCount: manifest.relationCount,
      validationOk: validation.ok,
      validationLegacy: validation.legacy,
      tamperedOk: tampered.ok,
      tamperedErrors: tampered.errors,
    };
  })()`);
  ok('1. schemaVersion 3', unit.schemaVersion === 3, String(unit.schemaVersion));
  ok('1. appVersion presente', unit.appVersion === '1.0.0', String(unit.appVersion));
  ok('1. Hash SHA-256 (64 hex) del proyecto', unit.projectChecksumLen === 64, `len=${unit.projectChecksumLen}`);
  ok('1. Checksum por documento', unit.docChecksums === 1, String(unit.docChecksums));
  ok('1. Conteos en el manifiesto', unit.countsDocuments === 1, String(unit.countsDocuments));
  ok('1. Bundle con manifiesto válido', unit.validationOk === true);
  ok('1. No es legacy (tiene manifiesto)', unit.validationLegacy === false);
  ok('1. Un byte alterado invalida', unit.tamperedOk === false);
  ok('1. Diagnóstico identifica el documento', Array.isArray(unit.tamperedErrors) && unit.tamperedErrors.some(e => e.includes('documento')), JSON.stringify(unit.tamperedErrors));

  // ─── 2-3. Round-trip export -> import con remapeo completo ────
  console.log('\n--- 2-3. Round-trip: manifiesto + import atómico + remapeo ---');
  await resetDB(page);
  const round = await page.evaluate(`(async () => {
    ${SEED}
    const db = await import('/workspace/core/db.js');
    const storage = await import('/workspace/core/storage.js');
    const integrity = await import('/workspace/core/integrity.js');
    const bundle = await storage.exportProject('p1');
    const m = bundle.manifest;
    const manifestInfo = {
      schemaVersion: m.schemaVersion,
      counts: m.counts,
      relationCount: m.relationCount,
      hasProjectChecksum: !!m.checksums.project,
      docChecksums: Object.keys(m.checksums.documents || {}).length,
      derivation: m.derivation,
    };
    const imported = await storage.importProject(bundle);
    const audit = await integrity.auditOrphans();
    const importedDocs = (await db.dbGetAll(db.STORES.documents)).filter(d => d.projectId === imported.id);
    const importedCaps = (await db.dbGetAll(db.STORES.captures)).filter(c => c.projectId === imported.id);
    const importedAssets = (await db.dbGetAll(db.STORES.assets)).filter(a => a.projectId === imported.id);
    const importedTables = (await db.dbGetAll(db.STORES.data)).filter(t => t.projectId === imported.id);
    const importedExecs = (await db.dbGetAll(db.STORES.executions)).filter(e => e.projectId === imported.id);
    const chart = importedAssets.find(a => a.type === 'chart');
    const expArt = importedAssets.find(a => a.type === 'export-artifact');
     const exec1 = importedExecs[0];
     const asset1 = importedAssets.find(a => a.type === 'image-asset');
     const corrected = importedAssets.find(a => a.metadata?.captureType === 'scan');
     const scanDoc = importedAssets.find(a => a.type === 'scan-document');
     const capture = importedCaps[0];
    const doc1 = importedDocs[0];
    const dash = await db.dbGet(db.STORES.settings, 'dashboard:' + imported.id);
    const model = await db.dbGet(db.STORES.settings, 'model:' + imported.id);
    return {
      manifestInfo,
      importedId: imported.id,
      projChanged: imported.id !== 'p1',
      auditValid: audit.valid === true,
      orphanCount: audit.orphans.length,
      importedDocCount: importedDocs.length,
      importedCapCount: importedCaps.length,
      importedTableCount: importedTables.length,
      importedAssetCount: importedAssets.length,
      importedExecCount: importedExecs.length,
      importedWorkflowCount: (await db.dbGetAll(db.STORES.workflows)).filter(w => w.projectId === imported.id).length,
      chartDerivedIds: chart ? chart.derivedIds : null,
      expArtId: expArt ? expArt.id : null,
      expSourceId: expArt ? expArt.sourceId : null,
      execInputAssetIds: exec1 ? exec1.inputAssetIds : null,
      execResultAssetId: exec1 ? exec1.resultAssetId : null,
      docRelationTargets: doc1 ? doc1.relations.map(r => r.targetId) : null,
       assetCaptureId: asset1 ? asset1.metadata.captureId : null,
       correctedAssetId: corrected ? corrected.id : null,
       captureScanDocumentId: capture ? capture.scanDocumentId : null,
       captureCorrectedAssetId: capture ? capture.correctedAssetId : null,
       scanDocCorrectedAssetId: scanDoc ? scanDoc.correctedAssetId : null,
       scanPageOriginalAssetId: scanDoc?.pages?.[0]?.originalAssetId || null,
       scanPageCorrectedAssetId: scanDoc?.pages?.[0]?.correctedAssetId || null,
       scanPageAssetId: scanDoc?.pages?.[0]?.assetId || null,
      dashboardWritten: !!dash && !!dash.value,
      modelWritten: !!model && !!model.value,
      modelNodeTableId: model && model.value && model.value.nodes && model.value.nodes[0] ? model.value.nodes[0].tableId : null,
      projectCount: (await db.dbGetAll(db.STORES.projects)).length,
    };
  })()`);
  ok('2. Manifiesto exportado con schemaVersion 3', round.manifestInfo.schemaVersion === 3, String(round.manifestInfo.schemaVersion));
   ok('2. Conteos del manifiesto', round.manifestInfo.counts.project === 1 && round.manifestInfo.counts.assets === 5 && round.manifestInfo.counts.documents === 1, JSON.stringify(round.manifestInfo.counts));
  ok('2. Checksum del proyecto presente', round.manifestInfo.hasProjectChecksum === true);
  ok('2. Checksum por documento', round.manifestInfo.docChecksums === 1, String(round.manifestInfo.docChecksums));
  ok('2. Cadena de derivación registrada', Array.isArray(round.manifestInfo.derivation) && round.manifestInfo.relationCount >= 3, `count=${round.manifestInfo.relationCount}`);
  ok('2. Derivación doc->captura presente', round.manifestInfo.derivation.some(d => d.from === 'doc1' && d.to === 'cap1'), JSON.stringify(round.manifestInfo.derivation.slice(0, 4)));
  ok('3. Import ok, ID nuevo', round.projChanged === true, round.importedId);
  ok('3. Grafo importado sin huérfanos', round.auditValid === true, `orphans=${round.orphanCount}`);
  ok('3. Documentos importados', round.importedDocCount === 1, String(round.importedDocCount));
  ok('3. Capturas importadas', round.importedCapCount === 1, String(round.importedCapCount));
  ok('3. Tablas importadas', round.importedTableCount === 1, String(round.importedTableCount));
   ok('3. Activos importados', round.importedAssetCount === 5, String(round.importedAssetCount));
  ok('3. Ejecuciones importadas', round.importedExecCount === 1, String(round.importedExecCount));
  ok('3. Flujos importados', round.importedWorkflowCount === 0, String(round.importedWorkflowCount));
  ok('3. derivedIds remapeados al nuevo gráfico', Array.isArray(round.chartDerivedIds) && round.chartDerivedIds.length === 1 && round.chartDerivedIds[0] !== 'exp1' && round.chartDerivedIds[0] === round.expArtId, JSON.stringify(round.chartDerivedIds));
  ok('3. sourceId de export remapeado', round.expSourceId !== 'chart1' && round.expSourceId !== null, String(round.expSourceId));
  ok('3. inputAssetIds remapeados', Array.isArray(round.execInputAssetIds) && round.execInputAssetIds.length === 1 && round.execInputAssetIds[0] !== 'asset1', JSON.stringify(round.execInputAssetIds));
  ok('3. resultAssetId remapeado', round.execResultAssetId !== 'chart1', String(round.execResultAssetId));
  ok('3. relations remapeadas', Array.isArray(round.docRelationTargets) && round.docRelationTargets.length === 2 && !round.docRelationTargets.some(t => t === 'cap1' || t === 'asset1'), JSON.stringify(round.docRelationTargets));
   ok('3. metadata.captureId remapeado', round.assetCaptureId !== 'cap1', String(round.assetCaptureId));
   ok('3. captura enlaza ScanDocument remapeado', round.captureScanDocumentId !== 'scan1', String(round.captureScanDocumentId));
   ok('3. captura correctedAssetId remapeado', round.captureCorrectedAssetId === round.correctedAssetId && round.captureCorrectedAssetId !== 'corrected1', String(round.captureCorrectedAssetId));
   ok('3. ScanDocument correctedAssetId remapeado', round.scanDocCorrectedAssetId === round.correctedAssetId, String(round.scanDocCorrectedAssetId));
   ok('3. página conserva assets remapeados', round.scanPageOriginalAssetId !== 'asset1' && round.scanPageCorrectedAssetId === round.correctedAssetId && round.scanPageAssetId === round.correctedAssetId, JSON.stringify([round.scanPageOriginalAssetId, round.scanPageCorrectedAssetId, round.scanPageAssetId]));
  ok('3. dashboard persistido', round.dashboardWritten === true);
  ok('3. model persistido con tableId remapeado', round.modelWritten === true && round.modelNodeTableId !== 'tab1', String(round.modelNodeTableId));
  ok('3. Proyecto original conservado + importado', round.projectCount === 2, String(round.projectCount));

  // ─── 4. Bundle alterado: rechazo con diagnóstico + DB intacta ─
  console.log('\n--- 4. Un byte alterado se rechaza y NO toca la base ---');
  await resetDB(page);
  const tamper = await page.evaluate(`(async () => {
    ${SEED}
    const db = await import('/workspace/core/db.js');
    const storage = await import('/workspace/core/storage.js');
    const bundle = await storage.exportProject('p1');
    bundle.documents[0].name = 'alterado';
    const before = {
      projects: (await db.dbGetAll(db.STORES.projects)).length,
      docs: (await db.dbGetAll(db.STORES.documents)).length,
      assets: (await db.dbGetAll(db.STORES.assets)).length,
      settings: (await db.dbGetAll(db.STORES.settings)).length,
    };
    let error = null;
    try { await storage.importProject(bundle); } catch (e) { error = e.message; }
    const after = {
      projects: (await db.dbGetAll(db.STORES.projects)).length,
      docs: (await db.dbGetAll(db.STORES.documents)).length,
      assets: (await db.dbGetAll(db.STORES.assets)).length,
      settings: (await db.dbGetAll(db.STORES.settings)).length,
    };
    return { error, before, after };
  })()`);
  ok('4. Importación rechazada', typeof tamper.error === 'string' && tamper.error.includes('rechazada'), String(tamper.error));
  ok('4. Diagnóstico apunta al documento', tamper.error.includes('no coincide con su hash'), String(tamper.error));
  ok('4. Cero proyectos nuevos', tamper.before.projects === tamper.after.projects, `${tamper.before.projects} -> ${tamper.after.projects}`);
  ok('4. Cero documentos nuevos', tamper.before.docs === tamper.after.docs, `${tamper.before.docs} -> ${tamper.after.docs}`);
  ok('4. Cero activos nuevos', tamper.before.assets === tamper.after.assets, `${tamper.before.assets} -> ${tamper.after.assets}`);
  ok('4. Cero settings nuevos', tamper.before.settings === tamper.after.settings, `${tamper.before.settings} -> ${tamper.after.settings}`);

  // ─── 5. Objeto eliminado: conteo del manifiesto lo detecta ────
  console.log('\n--- 5. Objeto eliminado del bundle se detecta ---');
  await resetDB(page);
  const removed = await page.evaluate(`(async () => {
    ${SEED}
    const db = await import('/workspace/core/db.js');
    const storage = await import('/workspace/core/storage.js');
    const bundle = await storage.exportProject('p1');
    bundle.documents = [];
    const before = (await db.dbGetAll(db.STORES.documents)).length;
    let error = null;
    try { await storage.importProject(bundle); } catch (e) { error = e.message; }
    const after = (await db.dbGetAll(db.STORES.documents)).length;
    return { error, before, after };
  })()`);
  ok('5. Rechazado por conteo del manifiesto', typeof removed.error === 'string' && removed.error.includes('espera 1'), String(removed.error));
  ok('5. Documentos intactos', removed.before === removed.after, `${removed.before} -> ${removed.after}`);

  // ─── 6. Bundle heredado (sin manifest) sigue importando ───────
  console.log('\n--- 6. Compatibilidad con bundles heredados ---');
  await resetDB(page);
  const legacy = await page.evaluate(`(async () => {
    const db = await import('/workspace/core/db.js');
    const storage = await import('/workspace/core/storage.js');
    const integrity = await import('/workspace/core/integrity.js');
    const bundle = {
      version: 2,
      project: { id: 'lp', type: 'project', name: 'Legacy' },
      documents: [{ id: 'ld1', type: 'text-document', title: 'Legacy doc' }],
      captures: [], dataTables: [], assets: [], executions: [], workflows: [],
    };
    const imported = await storage.importProject(bundle);
    const audit = await integrity.auditOrphans();
    const doc = (await db.dbGetAll(db.STORES.documents)).find(d => d.projectId === imported.id);
    return { importedId: imported.id, changed: imported.id !== 'lp', auditValid: audit.valid === true, docProject: doc ? doc.projectId : null };
  })()`);
  ok('6. Legacy importado con ID nuevo', legacy.changed === true, legacy.importedId);
  ok('6. Grafo legacy sin huérfanos', legacy.auditValid === true);
  ok('6. Documento legacy ligado al proyecto nuevo', legacy.docProject === legacy.importedId, String(legacy.docProject));

  // ─── 7. Límites adversarios: conteos, profundidad, tamaño ─────
  console.log('\n--- 7. Límites adversarios (WSP-015) ---');
  await resetDB(page);
  const adv = await page.evaluate(`(async () => {
    ${SEED}
    const db = await import('/workspace/core/db.js');
    const storage = await import('/workspace/core/storage.js');
    const base = { maxDepth: 128, maxJsonBytes: 1024 * 1024 * 1024 };

    const b1 = await storage.exportProject('p1');
    let e1 = null;
    try { await storage.importProject(b1, { limits: Object.assign({}, base, { maxObjectsPerStore: 2 }) }); } catch (e) { e1 = e.message; }

    const deep = {};
    let node = deep;
    for (let i = 0; i < 100; i++) { node.child = {}; node = node.child; }
    let e2 = null;
    try {
      await storage.importProject({ project: { id: 'x', type: 'project', name: 'D' }, deep: deep }, { limits: Object.assign({}, base, { maxObjectsPerStore: 100, maxDepth: 64 }) });
    } catch (e) { e2 = e.message; }

    const b3 = await storage.exportProject('p1');
    let e3 = null;
    try { await storage.importProject(b3, { limits: Object.assign({}, base, { maxJsonBytes: 10 }) }); } catch (e) { e3 = e.message; }

    const counts = {
      projects: (await db.dbGetAll(db.STORES.projects)).length,
      docs: (await db.dbGetAll(db.STORES.documents)).length,
    };
    return { e1, e2, e3, counts };
  })()`);
   ok('7. Límite de conteos rechaza', adv.e1 && adv.e1.includes('assets: 5 objetos supera el límite de 2'), String(adv.e1));
  ok('7. Límite de profundidad rechaza', adv.e2 && adv.e2.includes('profundidad'), String(adv.e2));
  ok('7. Límite de tamaño rechaza', adv.e3 && adv.e3.includes('bytes y supera el límite'), String(adv.e3));
  ok('7. Base intacta tras los tres rechazos', adv.counts.projects === 1 && adv.counts.docs === 1, JSON.stringify(adv.counts));

  // ─── Resumen ──────────────────────────────────────────────────
  console.log('\n--- Errores ---');
  ok('No page errors', pageErrors.length === 0, pageErrors.join(' | '));
  ok('No console errors', jsErrors.length === 0, jsErrors.join(' | '));

  const evidence = {
    phase: '5',
    total: pass + fail,
    passed: pass,
    failed: fail,
    failures,
    round: {
      schemaVersion: round.manifestInfo.schemaVersion,
      auditValid: round.auditValid,
      derivedIdsRemapped: Array.isArray(round.chartDerivedIds) && round.chartDerivedIds.length === 1 && round.chartDerivedIds[0] === round.expArtId,
      scannerReferencesRemapped: round.captureScanDocumentId !== 'scan1'
        && round.captureCorrectedAssetId === round.correctedAssetId
        && round.scanDocCorrectedAssetId === round.correctedAssetId
        && round.scanPageCorrectedAssetId === round.correctedAssetId
        && round.scanPageAssetId === round.correctedAssetId,
    },
  };
  writeEvidence(join(ARTIFACTS, 'phase5-bundle-trust-evidence.json'), evidence);

  console.log(`\n=== Phase 5 Confianza bundle: ${pass} passed, ${fail} failed ===`);

  await browser.close();
  await stopServer();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); stopServer().then(() => process.exit(1)); });
