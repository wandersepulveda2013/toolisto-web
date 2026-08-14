import { dbPut, dbGet, dbGetAll, dbDelete, dbGetByIndex, dbBulkPut, dbBulkDelete, dbTransaction, generateId, STORES } from './db.js';
import { appStore } from './state.js';
import { emit } from './events.js';
import { deleteWithCascade, previewCascadeDelete, pruneDanglingReferences, assertIntegrity } from './integrity.js';
import { buildManifest, validateBundleImport } from './bundle.js';
import {
  createProjectModel,
  createFileAsset,
  createImageAsset,
  createScanDocument,
  createScanPage,
  createTextDocument,
  createTextBlock,
  createTableDocument,
  createDataSheet,
  createChart,
  createDesignDocument,
  createDesignLayer,
  createToolExecution,
  createExportArtifact,
  addRelation,
  removeRelation,
  getRelatedIds,
  pushHistory,
  migrateObject,
  migrateProjectBundle,
  MODEL_VERSION,
} from './models.js';

async function createProject(name, description = '') {
  const project = createProjectModel(name, description);
  await dbPut(STORES.projects, project);
  const projects = await dbGetAll(STORES.projects);
  appStore.set({ projects, currentProject: project });
  emit('project:created', project);
  return project;
}

async function updateProject(id, updates) {
  const project = await dbGet(STORES.projects, id);
  if (!project) return null;
  const updated = { ...project, ...updates, updatedAt: Date.now() };
  await dbPut(STORES.projects, updated);
  const projects = await dbGetAll(STORES.projects);
  appStore.set({ projects, currentProject: updated });
  emit('project:updated', updated);
  return updated;
}

async function deleteProject(id) {
  const docs = await dbGetByIndex(STORES.documents, 'projectId', id);
  const data = await dbGetByIndex(STORES.data, 'projectId', id);
  const caps = await dbGetByIndex(STORES.captures, 'projectId', id);
  const assets = await dbGetByIndex(STORES.assets, 'projectId', id);
  const execs = await dbGetByIndex(STORES.executions, 'projectId', id);
  const wfs = await dbGetByIndex(STORES.workflows, 'projectId', id);
  await dbTransaction([
    STORES.projects, STORES.documents, STORES.data, STORES.captures,
    STORES.assets, STORES.executions, STORES.workflows, STORES.settings,
  ], 'readwrite', stores => {
    stores[STORES.projects].delete(id);
    docs.forEach(doc => stores[STORES.documents].delete(doc.id));
    data.forEach(table => stores[STORES.data].delete(table.id));
    caps.forEach(capture => stores[STORES.captures].delete(capture.id));
    assets.forEach(asset => stores[STORES.assets].delete(asset.id));
    execs.forEach(execution => stores[STORES.executions].delete(execution.id));
    wfs.forEach(workflow => stores[STORES.workflows].delete(workflow.id));
    stores[STORES.settings].delete('dashboard:' + id);
    stores[STORES.settings].delete('query:' + id);
    stores[STORES.settings].delete('model:' + id);
  });
  await pruneDanglingReferences([
    id,
    ...docs.map(doc => doc.id),
    ...data.map(table => table.id),
    ...caps.map(capture => capture.id),
    ...assets.map(asset => asset.id),
    ...execs.map(execution => execution.id),
    ...wfs.map(workflow => workflow.id),
  ]);
  const projects = await dbGetAll(STORES.projects);
  appStore.set({ projects, currentProject: null, currentView: 'projects' });
  emit('project:deleted', id);
  assertIntegrity().then(audit => emit('integrity:audited', audit)).catch(error => emit('integrity:audited', { valid: false, orphans: [], error: error.message }));
  return projects;
}

async function loadProjects() {
  const projects = await dbGetAll(STORES.projects);
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  appStore.set({ projects });
  return projects;
}

async function selectProject(id) {
  const project = await dbGet(STORES.projects, id);
  if (!project) return null;
  appStore.set({ currentProject: project, currentView: 'dashboard' });
  emit('project:selected', project);
  return project;
}

async function saveDoc(projectId, doc) {
  if (!doc.id) doc.id = generateId();
  doc.projectId = projectId;
  doc.updatedAt = Date.now();
  if (!doc.createdAt) doc.createdAt = doc.updatedAt;
  if (!doc._version) doc._version = MODEL_VERSION;
  doc = migrateObject(doc);
  await dbPut(STORES.documents, doc);
  appStore.set({ isDirty: false, lastSaved: Date.now() });
  emit('doc:saved', doc);
  return doc;
}

async function refreshProjectCounts(projectId) {
  const project = await dbGet(STORES.projects, projectId);
  if (!project) return null;
  const [docs, data, captures, assets, execs] = await Promise.all([
    dbGetByIndex(STORES.documents, 'projectId', projectId),
    dbGetByIndex(STORES.data, 'projectId', projectId),
    dbGetByIndex(STORES.captures, 'projectId', projectId),
    dbGetByIndex(STORES.assets, 'projectId', projectId),
    dbGetByIndex(STORES.executions, 'projectId', projectId),
  ]);
  const updated = {
    ...project,
    captureCount: captures.length,
    docCount: docs.length,
    dataCount: data.length,
    assetCount: assets.length,
    toolExecCount: execs.length,
    designCount: assets.filter(a => a.type === 'design-document').length,
    updatedAt: Date.now(),
  };
  await dbPut(STORES.projects, updated);
  const projects = await dbGetAll(STORES.projects);
  const currentProject = appStore.get('currentProject');
  appStore.set({
    projects,
    ...(currentProject?.id === projectId ? { currentProject: updated } : {}),
  });
  return updated;
}

async function loadDocs(projectId) {
  const docs = await dbGetByIndex(STORES.documents, 'projectId', projectId);
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  appStore.set({ documents: docs });
  return docs;
}

async function loadDocumentById(id) {
  if (!id) return null;
  return dbGet(STORES.documents, id);
}

async function deleteDoc(id) {
  const doc = await dbGet(STORES.documents, id);
  const result = await deleteWithCascade(STORES.documents, id);
  if (doc?.projectId) await refreshProjectCounts(doc.projectId);
  emit('doc:deleted', id);
  return result;
}

async function saveData(projectId, table) {
  if (!table.id) table.id = generateId();
  table.projectId = projectId;
  table.updatedAt = Date.now();
  if (!table.createdAt) table.createdAt = table.updatedAt;
  if (!table._version) table._version = MODEL_VERSION;
  table = migrateObject(table);
  await dbPut(STORES.data, table);
  emit('data:saved', table);
  return table;
}

async function loadData(projectId) {
  const tables = await dbGetByIndex(STORES.data, 'projectId', projectId);
  tables.sort((a, b) => b.updatedAt - a.updatedAt);
  appStore.set({ dataTables: tables });
  return tables;
}

async function deleteData(id) {
  const table = await dbGet(STORES.data, id);
  const result = await deleteWithCascade(STORES.data, id);
  if (table?.projectId) await refreshProjectCounts(table.projectId);
  emit('data:deleted', id);
  return result;
}

async function saveCapture(projectId, capture) {
  if (!capture.id) capture.id = generateId();
  capture.projectId = projectId;
  capture.timestamp = Date.now();
  if (!capture._version) capture._version = MODEL_VERSION;
  capture = migrateObject(capture);
  await dbPut(STORES.captures, capture);
  emit('capture:saved', capture);
  return capture;
}

async function loadCaptures(projectId) {
  const caps = await dbGetByIndex(STORES.captures, 'projectId', projectId);
  caps.sort((a, b) => b.timestamp - a.timestamp);
  appStore.set({ captures: caps });
  return caps;
}

async function loadCaptureById(id) {
  if (!id) return null;
  return dbGet(STORES.captures, id);
}

async function loadCapturesByDoc(docId) {
  return dbGetByIndex(STORES.captures, 'docId', docId);
}

async function deleteCapture(id) {
  const result = await deleteWithCascade(STORES.captures, id);
  emit('capture:deleted', id);
  return result;
}

async function previewCaptureDeletion(id) {
  return previewCascadeDelete(STORES.captures, id);
}

async function saveSetting(key, value) {
  await dbPut(STORES.settings, { key, value, updatedAt: Date.now() });
}

async function loadSetting(key) {
  const result = await dbGet(STORES.settings, key);
  return result ? result.value : null;
}

async function saveDataModel(projectId, model) {
  await saveSetting('model:' + projectId, model);
  appStore.set({ dataModel: model, isDirty: false, lastSaved: Date.now() });
  emit('model:saved', model);
  return model;
}

async function loadDataModel(projectId) {
  return loadSetting('model:' + projectId);
}

async function exportProject(projectId) {
  const project = await dbGet(STORES.projects, projectId);
  const docs = await dbGetByIndex(STORES.documents, 'projectId', projectId);
  const data = await dbGetByIndex(STORES.data, 'projectId', projectId);
  const caps = await dbGetByIndex(STORES.captures, 'projectId', projectId);
  const assets = await dbGetByIndex(STORES.assets, 'projectId', projectId);
  const execs = await dbGetByIndex(STORES.executions, 'projectId', projectId);
  const wfs = await dbGetByIndex(STORES.workflows, 'projectId', projectId);
  const dashboard = await dbGet(STORES.settings, 'dashboard:' + projectId);
  const query = await dbGet(STORES.settings, 'query:' + projectId);
  const dataModel = await dbGet(STORES.settings, 'model:' + projectId);
  const bundle = {
    version: 2, project, documents: docs, dataTables: data, captures: caps,
    assets, executions: execs, workflows: wfs,
    dashboard: dashboard?.value || null, query: query?.value || null,
    dataModel: dataModel?.value || null, exportedAt: Date.now(),
  };
  bundle.manifest = await buildManifest(bundle);
  return bundle;
}

async function importProject(bundle, options = {}) {
  if (!bundle || !bundle.project) throw new Error('Invalid project bundle');

  // Validación completa ANTES de escribir nada: manifiesto (WSP-014, WDX-002)
  // y límites adversarios (WSP-015). Un bundle alterado se rechaza con
  // diagnóstico y la base de datos queda idéntica al estado previo.
  const validation = await validateBundleImport(bundle, options.limits);
  if (!validation.ok) {
    throw new Error('Importación rechazada: ' + validation.errors.join('; '));
  }

  migrateProjectBundle(bundle);

  const projectId = generateId();
  const now = Date.now();

  const makeIdMap = (items) => {
    const map = new Map();
    for (const item of items || []) if (item && item.id) map.set(item.id, generateId());
    return map;
  };
  const docIdMap = makeIdMap(bundle.documents);
  const capIdMap = makeIdMap(bundle.captures);
  const tableIdMap = makeIdMap(bundle.dataTables);
  const assetIdMap = makeIdMap(bundle.assets);
  const execIdMap = makeIdMap(bundle.executions);
  const wfIdMap = makeIdMap(bundle.workflows);
  const allIdMap = new Map([...docIdMap, ...capIdMap, ...tableIdMap, ...assetIdMap, ...execIdMap, ...wfIdMap]);

  const remapId = id => (id && allIdMap.has(id)) ? allIdMap.get(id) : id;
  const remapIdArray = arr => Array.isArray(arr) ? arr.map(remapId) : arr;

  function remapRefs(obj) {
    for (const field of ['sourceAssetId', 'sourceDocId', 'scanDocId', 'scanDocumentId', 'sourceTableId', 'tableId', 'captureId', 'resultAssetId', 'sourceId', 'correctedAssetId', 'originalAssetId', 'assetId']) {
      if (obj[field]) obj[field] = remapId(obj[field]);
    }
    for (const field of ['inputAssetIds', 'derivedIds']) {
      if (Array.isArray(obj[field])) obj[field] = remapIdArray(obj[field]);
    }
    if (Array.isArray(obj.relations)) {
      obj.relations = obj.relations.map(r => ({ ...r, targetId: remapId(r.targetId), from: remapId(r.from), to: remapId(r.to) }));
    }
    if (obj.config && typeof obj.config === 'object') {
      for (const field of ['sourceAssetId', 'scanDocId', 'scanDocumentId', 'sourceTableId', 'captureId', 'sourceId', 'tableId', 'sourceDocId', 'correctedAssetId', 'originalAssetId', 'assetId']) {
        if (obj.config[field]) obj.config[field] = remapId(obj.config[field]);
      }
    }
    if (obj.metadata && typeof obj.metadata === 'object' && obj.metadata.captureId) {
      obj.metadata.captureId = remapId(obj.metadata.captureId);
    }
    // ScanDocument guarda sus páginas como subdocumentos. Sus referencias no
    // aparecen en el nivel superior y deben recibir los IDs nuevos igual que
    // la captura y el propio ScanDocument.
    if (Array.isArray(obj.pages)) {
      obj.pages = obj.pages.map(page => page && typeof page === 'object' ? remapRefs({ ...page }) : page);
    }
    return obj;
  }

  const documents = (bundle.documents || []).map(d => remapRefs(migrateObject({ ...d, id: docIdMap.get(d.id), projectId })));
  const captures = (bundle.captures || []).map(c => remapRefs(migrateObject({ ...c, id: capIdMap.get(c.id), projectId })));
  const dataTables = (bundle.dataTables || []).map(t => remapRefs(migrateObject({ ...t, id: tableIdMap.get(t.id), projectId })));
  const assets = (bundle.assets || []).map(a => remapRefs(migrateObject({ ...a, id: assetIdMap.get(a.id), projectId })));
  const executions = (bundle.executions || []).map(e => remapRefs(migrateObject({ ...e, id: execIdMap.get(e.id), projectId })));
  const workflows = (bundle.workflows || []).map(w => migrateObject({ ...w, id: wfIdMap.get(w.id), projectId }));

  const project = {
    ...migrateObject({ ...bundle.project, id: projectId, updatedAt: now }),
    captureCount: captures.length,
    docCount: documents.length,
    dataCount: dataTables.length,
    assetCount: assets.length,
    toolExecCount: executions.length,
    designCount: assets.filter(a => a.type === 'design-document').length,
  };

  const dashboard = bundle.dashboard && typeof bundle.dashboard === 'object' ? { ...bundle.dashboard } : null;
  const query = bundle.query && typeof bundle.query === 'object' ? { ...bundle.query } : null;
  let dataModel = null;
  if (bundle.dataModel) {
    const sourceModel = bundle.dataModel?.model && typeof bundle.dataModel.model === 'object' ? bundle.dataModel.model : bundle.dataModel;
    if (sourceModel && typeof sourceModel === 'object') {
      dataModel = {
        ...sourceModel,
        projectId,
        nodes: (sourceModel.nodes || []).map(node => ({ ...node, tableId: remapId(node.tableId) })),
        relationships: (sourceModel.relationships || []).map(rel => ({ ...rel, fromTableId: remapId(rel.fromTableId), toTableId: remapId(rel.toTableId) })),
      };
    }
  }

  // Una única transacción readwrite: si cualquier put falla, IndexedDB aborta
  // la transacción completa y la base queda idéntica al estado previo (WDX-007).
  await dbTransaction([
    STORES.projects, STORES.documents, STORES.data, STORES.captures,
    STORES.assets, STORES.executions, STORES.workflows, STORES.settings,
  ], 'readwrite', ctx => {
    ctx[STORES.projects].put(project);
    documents.forEach(d => ctx[STORES.documents].put(d));
    dataTables.forEach(t => ctx[STORES.data].put(t));
    captures.forEach(c => ctx[STORES.captures].put(c));
    assets.forEach(a => ctx[STORES.assets].put(a));
    executions.forEach(e => ctx[STORES.executions].put(e));
    workflows.forEach(w => ctx[STORES.workflows].put(w));
    if (dashboard) ctx[STORES.settings].put({ key: 'dashboard:' + projectId, value: dashboard, updatedAt: now });
    if (query) ctx[STORES.settings].put({ key: 'query:' + projectId, value: query, updatedAt: now });
    if (dataModel) ctx[STORES.settings].put({ key: 'model:' + projectId, value: dataModel, updatedAt: now });
  });

  await loadProjects();
  emit('project:imported', project);
  assertIntegrity().then(audit => emit('integrity:audited', audit)).catch(error => emit('integrity:audited', { valid: false, orphans: [], error: error.message }));
  return project;
}

async function saveAsset(projectId, asset) {
  if (!asset.id) asset.id = generateId();
  asset.projectId = projectId;
  asset.updatedAt = Date.now();
  if (!asset.createdAt) asset.createdAt = asset.updatedAt;
  if (!asset._version) asset._version = MODEL_VERSION;
  asset = migrateObject(asset);
  await dbPut(STORES.assets, asset);
  emit('asset:saved', asset);
  return asset;
}

function prepareAssetForSave(projectId, asset, now) {
  const prepared = { ...asset };
  if (!prepared.id) prepared.id = generateId();
  prepared.projectId = projectId;
  prepared.updatedAt = now;
  if (!prepared.createdAt) prepared.createdAt = now;
  if (!prepared._version) prepared._version = MODEL_VERSION;
  return migrateObject(prepared);
}

function prepareCaptureForSave(projectId, capture, now) {
  const prepared = { ...capture };
  if (!prepared.id) prepared.id = generateId();
  prepared.projectId = projectId;
  prepared.timestamp = now;
  if (!prepared._version) prepared._version = MODEL_VERSION;
  return migrateObject(prepared);
}

function prepareExecutionForSave(projectId, execution, now) {
  const prepared = { ...execution };
  if (!prepared.id) prepared.id = generateId();
  prepared.projectId = projectId;
  prepared.updatedAt = now;
  if (!prepared.createdAt) prepared.createdAt = now;
  if (!prepared._version) prepared._version = MODEL_VERSION;
  return migrateObject(prepared);
}

// El resultado del escáner es una unidad: los dos assets, su ScanDocument,
// captura y ejecución no deben aparecer parcialmente si IndexedDB rechaza una
// escritura posterior. Todos los modelos y sus relaciones se preparan antes
// de abrir la transacción; los eventos solo se emiten tras su commit.
async function persistScannerResult(projectId, { sourceAsset, scanDoc, correctedAsset, capture, execution }) {
  const now = Date.now();
  const preparedSource = prepareAssetForSave(projectId, sourceAsset, now);
  const preparedScan = prepareAssetForSave(projectId, scanDoc, now);
  const preparedCorrected = prepareAssetForSave(projectId, correctedAsset, now);
  const preparedCapture = prepareCaptureForSave(projectId, capture, now);
  const preparedExecution = prepareExecutionForSave(projectId, execution, now);

  await dbTransaction([STORES.assets, STORES.captures, STORES.executions], 'readwrite', stores => {
    stores[STORES.assets].put(preparedSource);
    stores[STORES.assets].put(preparedScan);
    stores[STORES.assets].put(preparedCorrected);
    stores[STORES.captures].put(preparedCapture);
    stores[STORES.executions].put(preparedExecution);
  });

  emit('asset:saved', preparedSource);
  emit('asset:saved', preparedScan);
  emit('asset:saved', preparedCorrected);
  emit('capture:saved', preparedCapture);
  emit('execution:saved', preparedExecution);
  return {
    sourceAsset: preparedSource,
    scanDoc: preparedScan,
    correctedAsset: preparedCorrected,
    capture: preparedCapture,
    execution: preparedExecution,
  };
}

async function loadAsset(id) {
  return dbGet(STORES.assets, id);
}

async function loadAssetsByProject(projectId) {
  return dbGetByIndex(STORES.assets, 'projectId', projectId);
}

async function loadAssetsByType(projectId, type) {
  const all = await dbGetByIndex(STORES.assets, 'projectId', projectId);
  return all.filter(a => a.type === type);
}

async function deleteAsset(id) {
  const result = await deleteWithCascade(STORES.assets, id);
  emit('asset:deleted', id);
  return result;
}

async function saveExecution(projectId, execution) {
  if (!execution.id) execution.id = generateId();
  execution.projectId = projectId;
  execution.updatedAt = Date.now();
  if (!execution.createdAt) execution.createdAt = execution.updatedAt;
  if (!execution._version) execution._version = MODEL_VERSION;
  execution = migrateObject(execution);
  await dbPut(STORES.executions, execution);
  emit('execution:saved', execution);
  return execution;
}

async function loadExecution(id) {
  return dbGet(STORES.executions, id);
}

async function loadExecutionsByProject(projectId) {
  return dbGetByIndex(STORES.executions, 'projectId', projectId);
}

async function loadExecutionsBySource(sourceAssetId) {
  return dbGetByIndex(STORES.executions, 'sourceAssetId', sourceAssetId);
}

async function deleteExecution(id) {
  await dbDelete(STORES.executions, id);
  emit('execution:deleted', id);
}

async function registerExecution(projectId, toolId, toolName, opts = {}) {
  const exec = createToolExecution(toolId, toolName, projectId);
  exec.inputAssetIds = opts.inputAssetIds || [];
  exec.parameters = opts.parameters || {};
  exec.status = opts.status || 'completed';
  exec.progress = opts.status === 'completed' ? 1 : 0;
  exec.resultType = opts.resultType || null;
  exec.resultData = opts.resultData || null;
  exec.resultAssetId = opts.resultAssetId || null;
  exec.startedAt = opts.startedAt || Date.now();
  exec.completedAt = opts.status === 'completed' ? Date.now() : null;
  exec.duration = exec.completedAt && exec.startedAt ? exec.completedAt - exec.startedAt : 0;
  exec.errors = opts.errors || [];
  if (opts.sourceAssetId) exec.sourceAssetId = opts.sourceAssetId;
  pushHistory(exec, 'registered', `Operación ${toolName} registrada`);
  await saveExecution(projectId, exec);
  return exec;
}

async function saveWorkflow(projectId, workflow) {
  if (!workflow.id) workflow.id = generateId();
  workflow.projectId = projectId;
  workflow.updatedAt = Date.now();
  if (!workflow.createdAt) workflow.createdAt = workflow.updatedAt;
  if (!workflow._version) workflow._version = MODEL_VERSION;
  workflow = migrateObject(workflow);
  await dbPut(STORES.workflows, workflow);
  emit('workflow:saved', workflow);
  return workflow;
}

async function loadWorkflow(id) {
  return dbGet(STORES.workflows, id);
}

async function loadWorkflowsByProject(projectId) {
  return dbGetByIndex(STORES.workflows, 'projectId', projectId);
}

async function deleteWorkflow(id) {
  await dbDelete(STORES.workflows, id);
  emit('workflow:deleted', id);
}

export {
  createProject, updateProject, deleteProject, loadProjects, selectProject,
  saveDoc, loadDocs, deleteDoc, saveData, loadData, deleteData, saveCapture, loadCaptures,
  loadDocumentById, loadCaptureById, loadCapturesByDoc, deleteCapture, previewCaptureDeletion, saveSetting, loadSetting,
  saveDataModel, loadDataModel,
  exportProject, importProject, refreshProjectCounts,
  saveAsset, loadAsset, loadAssetsByProject, loadAssetsByType, deleteAsset,
  persistScannerResult,
  saveExecution, loadExecution, loadExecutionsByProject, loadExecutionsBySource, deleteExecution,
  saveWorkflow, loadWorkflow, loadWorkflowsByProject, deleteWorkflow,
  registerExecution,
  createImageAsset, createFileAsset, createScanDocument, createScanPage,
  createTextDocument, createTextBlock, createTableDocument, createDataSheet,
  createChart, createDesignDocument, createDesignLayer,
  createToolExecution, createExportArtifact,
  addRelation, removeRelation, getRelatedIds, pushHistory, migrateObject, MODEL_VERSION,
};
