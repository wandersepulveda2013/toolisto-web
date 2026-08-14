/**
 * core/models.js — Modelo comun versionado de objetos del workspace.
 *
 * Cada objeto tiene:
 *   id, type, name, createdAt, updatedAt, projectId, metadata,
 *   history[], relations[], processingState, errors[], sourceAssetId, derivedIds[]
 *
 * Version: 1
 */
const MODEL_VERSION = 1;

function createBaseObject(type, name, projectId, extra = {}) {
  const now = Date.now();
  return {
    id: extra.id || generateId(),
    type,
    name: name || '',
    createdAt: extra.createdAt || now,
    updatedAt: now,
    projectId: projectId || null,
    _version: MODEL_VERSION,
    metadata: extra.metadata || {},
    history: extra.history || [],
    relations: extra.relations || [],
    processingState: extra.processingState || 'idle',
    errors: extra.errors || [],
    sourceAssetId: extra.sourceAssetId || null,
    derivedIds: extra.derivedIds || [],
    deleted: false,
    deletedAt: null,
  };
}

/* ── Project ─────────────────────────────────────────────────── */

function createProjectModel(name, description) {
  return {
    ...createBaseObject('project', name, null),
    description: description || '',
    captureCount: 0,
    docCount: 0,
    dataCount: 0,
    designCount: 0,
    toolExecCount: 0,
  };
}

/* ── Assets (archivos crudos) ────────────────────────────────── */

function createFileAsset(name, projectId, file) {
  return {
    ...createBaseObject('file-asset', name, projectId),
    mimeType: file ? file.type : '',
    size: file ? file.size : 0,
    extension: name ? name.split('.').pop().toLowerCase() : '',
    dataUrl: null,
    blobRef: null,
    tags: [],
  };
}

function createImageAsset(name, projectId, file) {
  const base = createFileAsset(name, projectId, file);
  return {
    ...base,
    type: 'image-asset',
    width: 0,
    height: 0,
    orientation: null,
    exif: null,
    thumbnailUrl: null,
    originalDataUrl: null,
    adjustedDataUrl: null,
  };
}

function createAudioAsset(name, projectId, file) {
  const base = createFileAsset(name, projectId, file);
  return {
    ...base,
    type: 'audio-asset',
    duration: 0,
    sampleRate: 0,
    channels: 0,
  };
}

function createVideoAsset(name, projectId, file) {
  const base = createFileAsset(name, projectId, file);
  return {
    ...base,
    type: 'video-asset',
    width: 0,
    height: 0,
    duration: 0,
    fps: 0,
  };
}

/* ── ScanDocument (resultado de escaneo/captura) ─────────────── */

function createScanDocument(name, projectId) {
  return {
    ...createBaseObject('scan-document', name, projectId),
    pages: [],
    pageCount: 0,
    currentFilter: 'original',
    adjustments: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpness: 0,
    },
  };
}

function createScanPage(assetId, index) {
  return {
    id: generateId(),
    assetId: assetId,
    index: index,
    corners: null,
    perspectiveCorrected: false,
    rotated: false,
    rotationDeg: 0,
    filter: 'original',
    adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 },
    ocrText: null,
    ocrConfidence: 0,
    ocrStatus: 'pending',
    annotations: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ── TextDocument (documento de bloques) ─────────────────────── */

function createTextDocument(name, projectId) {
  return {
    ...createBaseObject('text-document', name, projectId),
    blocks: [],
    wordCount: 0,
    template: null,
    tableOfContents: false,
    trashBlocks: [],
  };
}

function createTextBlock(type, content, order) {
  return {
    id: generateId(),
    type: type || 'paragraph',
    content: content || '',
    order: order || 0,
    metadata: {},
    children: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ── TableDocument (hoja de calculo) ─────────────────────────── */

function createTableDocument(name, projectId) {
  return {
    ...createBaseObject('table-document', name, projectId),
    sheets: [createDataSheet('Sheet 1', 0)],
    activeSheetIndex: 0,
    model: null,
  };
}

function createDataSheet(name, index) {
  return {
    id: generateId(),
    name: name || 'Sheet ' + (index + 1),
    index: index || 0,
    columns: [],
    rows: [],
    columnFormats: {},
    cellFormats: {},
    conditionalFormats: [],
    validations: {},
    frozenColumns: 0,
    frozenRows: 0,
    sortState: null,
    filterState: null,
  };
}

/* ── Chart ───────────────────────────────────────────────────── */

function createChart(name, projectId, sourceTableId, sourceSheetId) {
  return {
    ...createBaseObject('chart', name, projectId),
    chartType: 'bar',
    sourceTableId: sourceTableId || null,
    sourceSheetId: sourceSheetId || null,
    config: {
      title: name || '',
      xAxis: null,
      yAxis: null,
      series: [],
      colors: [],
      width: 600,
      height: 400,
    },
    svgData: null,
  };
}

/* ── DesignDocument (canvas de diseno) ───────────────────────── */

function createDesignDocument(name, projectId) {
  return {
    ...createBaseObject('design-document', name, projectId),
    width: 800,
    height: 600,
    background: '#ffffff',
    layers: [],
    templates: [],
    brandColors: [],
    brandFonts: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    gridSize: 10,
    snapToGrid: true,
    showGuides: true,
  };
}

function createDesignLayer(type, name) {
  return {
    id: generateId(),
    type: type || 'text',
    name: name || '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    content: null,
    style: {},
    groupId: null,
    lockedByUser: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ── ToolExecution ───────────────────────────────────────────── */

function createToolExecution(toolId, toolName, projectId) {
  return {
    ...createBaseObject('tool-execution', toolName, projectId),
    toolId: toolId || '',
    toolName: toolName || '',
    inputs: [],
    inputAssetIds: [],
    progress: 0,
    status: 'pending',
    resultType: null,
    resultData: null,
    resultAssetId: null,
    parameters: {},
    startedAt: null,
    completedAt: null,
    duration: 0,
  };
}

/* ── Workflow ────────────────────────────────────────────────── */

function createWorkflow(name, projectId) {
  return {
    ...createBaseObject('workflow', name, projectId),
    nodes: [],
    edges: [],
    status: 'draft',
    lastRunAt: null,
  };
}

function createWorkflowNode(type, name, x, y) {
  return {
    id: generateId(),
    type: type || 'tool',
    name: name || '',
    x: x || 0,
    y: y || 0,
    width: 180,
    height: 60,
    config: {},
    status: 'idle',
  };
}

function createWorkflowEdge(sourceId, targetId, sourcePort, targetPort) {
  return {
    id: generateId(),
    sourceId: sourceId || '',
    targetId: targetId || '',
    sourcePort: sourcePort || 'output',
    targetPort: targetPort || 'input',
  };
}

/* ── ExportArtifact ──────────────────────────────────────────── */

function createExportArtifact(name, projectId, sourceType, sourceId, format) {
  return {
    ...createBaseObject('export-artifact', name, projectId),
    sourceType: sourceType || '',
    sourceId: sourceId || '',
    format: format || 'pdf',
    mimeType: '',
    size: 0,
    dataUrl: null,
    blobRef: null,
    exportedAt: Date.now(),
  };
}

/* ── Relaciones ──────────────────────────────────────────────── */

function addRelation(obj, targetId, relationType) {
  if (!obj.relations) obj.relations = [];
  const exists = obj.relations.some(r => r.targetId === targetId && r.type === relationType);
  if (!exists) {
    obj.relations.push({ targetId, type: relationType, createdAt: Date.now() });
    obj.updatedAt = Date.now();
  }
  return obj;
}

function removeRelation(obj, targetId, relationType) {
  if (!obj.relations) return obj;
  obj.relations = obj.relations.filter(r => !(r.targetId === targetId && r.type === relationType));
  obj.updatedAt = Date.now();
  return obj;
}

function getRelatedIds(obj, relationType) {
  if (!obj.relations) return [];
  return obj.relations.filter(r => !relationType || r.type === relationType).map(r => r.targetId);
}

/* ── Historial ───────────────────────────────────────────────── */

function pushHistory(obj, action, details) {
  if (!obj.history) obj.history = [];
  obj.history.push({
    action: action || 'modify',
    details: details || '',
    timestamp: Date.now(),
  });
  if (obj.history.length > 100) obj.history = obj.history.slice(-100);
  obj.updatedAt = Date.now();
  return obj;
}

/* ── Migraciones ─────────────────────────────────────────────── */

const migrations = {
  1: (obj) => {
    if (!obj._version) obj._version = 1;
    if (!obj.deleted) obj.deleted = false;
    if (!obj.deletedAt) obj.deletedAt = null;
    if (!obj.history) obj.history = [];
    if (!obj.relations) obj.relations = [];
    if (!obj.processingState) obj.processingState = 'idle';
    if (!obj.errors) obj.errors = [];
    if (!obj.sourceAssetId) obj.sourceAssetId = null;
    if (!obj.derivedIds) obj.derivedIds = [];
    return obj;
  },
};

function migrateObject(obj) {
  if (!obj || !obj.type) return obj;
  let current = obj._version || 0;
  while (current < MODEL_VERSION) {
    const migration = migrations[current + 1];
    if (migration) {
      obj = migration(obj);
      current++;
      obj._version = current;
    } else {
      break;
    }
  }
  return obj;
}

function migrateProjectBundle(bundle) {
  if (!bundle) return bundle;
  if (bundle.project) bundle.project = migrateObject(bundle.project);
  if (Array.isArray(bundle.documents)) bundle.documents = bundle.documents.map(migrateObject);
  if (Array.isArray(bundle.dataTables)) bundle.dataTables = bundle.dataTables.map(migrateObject);
  if (Array.isArray(bundle.captures)) bundle.captures = bundle.captures.map(migrateObject);
  return bundle;
}

/* ── Export ──────────────────────────────────────────────────── */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export {
  MODEL_VERSION,
  createProjectModel,
  createFileAsset,
  createImageAsset,
  createAudioAsset,
  createVideoAsset,
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
  createWorkflow,
  createWorkflowNode,
  createWorkflowEdge,
  createExportArtifact,
  addRelation,
  removeRelation,
  getRelatedIds,
  pushHistory,
  migrateObject,
  migrateProjectBundle,
  generateId,
};
