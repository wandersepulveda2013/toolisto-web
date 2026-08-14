/**
 * core/integrity.js — Integridad referencial del workspace (Paso 4b).
 *
 * Cubre WSP-012 (cascadas explícitas y auditor de huérfanos) y WDX-003
 * (borrado sin IDs/blobs relacionados).
 *
 * Semántica de cascada:
 *   La relación de derivación es UNIDIRECCIONAL: source -> derivado.
 *   `deleteWithCascade` borra un objeto y TODO lo derivado de él de forma
 *   transitiva (captura -> escaneo -> documento -> tabla -> gráfico -> export).
 *   Las `relations` son linaje bidireccional, NO propiedad: se podan (se
 *   eliminan las entradas que apuntan a objetos borrados) pero nunca se usan
 *   para decidir qué borrar.
 */

import { dbTransaction, dbGetAll, dbGet, STORES } from './db.js';

const OBJECT_STORES = [
  STORES.projects,
  STORES.documents,
  STORES.data,
  STORES.captures,
  STORES.assets,
  STORES.executions,
  STORES.workflows,
];

const OBJECT_STORE_SET = new Set(OBJECT_STORES);

/* Campos que apuntan de un objeto derivado a su fuente. */
const SOURCE_FIELDS = [
  'sourceAssetId',
  'captureId',
  'sourceDocId',
  'scanDocId',
  'sourceTableId',
  'tableId',
  'sourceId',
  'resultAssetId',
];

const CONFIG_FIELDS = [
  'sourceAssetId',
  'sourceTableId',
  'scanDocId',
  'captureId',
  'sourceId',
];

function collectIdSet(all) {
  const ids = new Set();
  for (const storeName of OBJECT_STORES) {
    for (const obj of (all[storeName] || [])) {
      if (obj && obj.id) ids.add(obj.id);
    }
  }
  return ids;
}

function pushOrphan(orphans, ownerStore, ownerId, field, value) {
  orphans.push({ ownerStore, ownerId, field, value });
}

function checkReference(all, orphans, ownerStore, ownerId, field, value, allowedStores) {
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const exists = allowedStores.some(storeName => (all[storeName] || []).some(obj => obj.id === value));
  if (!exists) pushOrphan(orphans, ownerStore, ownerId, field, value);
}

function allowedStoreForField(field) {
  switch (field) {
    case 'projectId':
      return [STORES.projects];
    case 'sourceTableId':
    case 'tableId':
    case 'config.sourceTableId':
      return [STORES.data];
    case 'sourceDocId':
    case 'scanDocId':
    case 'docId':
    case 'config.scanDocId':
      return [STORES.documents];
    case 'captureId':
    case 'config.captureId':
    case 'metadata.captureId':
      return [STORES.captures];
    default:
      return null;
  }
}

function relationTargetIds(relations) {
  const ids = [];
  for (const rel of (relations || [])) {
    if (!rel) continue;
    if (rel.targetId) ids.push(rel.targetId);
    if (rel.from) ids.push(rel.from);
    if (rel.to) ids.push(rel.to);
  }
  return ids;
}

/* IDs que apuntan a la fuente del objeto (derivado -> source). */
function sourceRefIds(obj) {
  const ids = [];
  for (const field of SOURCE_FIELDS) {
    const value = obj[field];
    if (value !== undefined && value !== null && value !== '') ids.push(value);
  }
  if (Array.isArray(obj.inputAssetIds)) ids.push(...obj.inputAssetIds);
  if (Array.isArray(obj.derivedIds)) ids.push(...obj.derivedIds);
  if (obj.config && typeof obj.config === 'object') {
    for (const field of CONFIG_FIELDS) {
      const value = obj.config[field];
      if (value !== undefined && value !== null && value !== '') ids.push(value);
    }
  }
  if (obj.metadata && typeof obj.metadata === 'object' && obj.metadata.captureId !== undefined && obj.metadata.captureId !== null && obj.metadata.captureId !== '') {
    ids.push(obj.metadata.captureId);
  }
  return ids;
}

/* true si el objeto deriva DIRECTAMENTE del id dado (vía campos de fuente). */
function objectReferencesSource(obj, targetId) {
  if (!obj || !obj.id) return false;
  return sourceRefIds(obj).includes(targetId);
}

function findCascadeRecords(all, storeName, id) {
  const primary = (all[storeName] || []).find(obj => obj?.id === id);
  if (!primary) return [];

  const records = [{ storeName, id: primary.id, type: primary.type || '' }];
  const deletedSet = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    for (const candidateStore of OBJECT_STORES) {
      for (const obj of (all[candidateStore] || [])) {
        if (!obj || !obj.id || deletedSet.has(obj.id)) continue;
        if (objectReferencesSource(obj, current)) {
          deletedSet.add(obj.id);
          queue.push(obj.id);
          records.push({ storeName: candidateStore, id: obj.id, type: obj.type || '' });
        }
      }
    }
  }
  return records;
}

/**
 * Describe una cascada sin escribir nada. La UI usa esta vista previa para
 * comunicar pérdida de trabajo antes de que la persona confirme el borrado.
 */
async function previewCascadeDelete(storeName, id) {
  if (!OBJECT_STORE_SET.has(storeName)) return { deletedIds: [], records: [] };
  const all = {};
  for (const candidateStore of OBJECT_STORES) all[candidateStore] = await dbGetAll(candidateStore);
  const records = findCascadeRecords(all, storeName, id);
  return { deletedIds: records.map(record => record.id), records };
}

async function auditOrphans() {
  const all = {};
  for (const storeName of OBJECT_STORES) {
    all[storeName] = await dbGetAll(storeName);
  }
  const anyStore = OBJECT_STORES;
  const orphans = [];

  for (const storeName of OBJECT_STORES) {
    for (const obj of (all[storeName] || [])) {
      if (!obj || !obj.id) continue;
      const ownerStore = storeName;
      const ownerId = obj.id;

      if (storeName !== STORES.projects) {
        checkReference(all, orphans, ownerStore, ownerId, 'projectId', obj.projectId, [STORES.projects]);
      }

      for (const field of SOURCE_FIELDS) {
        if (obj[field] === undefined) continue;
        const allowed = allowedStoreForField(field) || anyStore;
        checkReference(all, orphans, ownerStore, ownerId, field, obj[field], allowed);
      }

      if (Array.isArray(obj.inputAssetIds)) {
        obj.inputAssetIds.forEach(id => checkReference(all, orphans, ownerStore, ownerId, 'inputAssetIds', id, anyStore));
      }
      if (Array.isArray(obj.derivedIds)) {
        obj.derivedIds.forEach(id => checkReference(all, orphans, ownerStore, ownerId, 'derivedIds', id, anyStore));
      }

      if (obj.config && typeof obj.config === 'object') {
        for (const field of CONFIG_FIELDS) {
          if (obj.config[field] === undefined) continue;
          const allowed = allowedStoreForField('config.' + field) || anyStore;
          checkReference(all, orphans, ownerStore, ownerId, 'config.' + field, obj.config[field], allowed);
        }
      }

      if (obj.metadata && typeof obj.metadata === 'object' && obj.metadata.captureId !== undefined) {
        checkReference(all, orphans, ownerStore, ownerId, 'metadata.captureId', obj.metadata.captureId, [STORES.captures]);
      }

      for (const relId of relationTargetIds(obj.relations)) {
        checkReference(all, orphans, ownerStore, ownerId, 'relations', relId, anyStore);
      }
    }
  }

  return { valid: orphans.length === 0, orphans };
}

async function assertIntegrity() {
  return auditOrphans();
}

async function getAllFromTx(ctx, storeName) {
  return new Promise((resolve, reject) => {
    const req = ctx[storeName].getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pruneObjectRefs(obj, targetSet) {
  let removedRelations = 0;
  let removedDerived = 0;
  if (Array.isArray(obj.relations)) {
    const before = obj.relations.length;
    obj.relations = obj.relations.filter(r => {
      if (!r) return false;
      return !targetSet.has(r.targetId) && !targetSet.has(r.from) && !targetSet.has(r.to);
    });
    removedRelations = before - obj.relations.length;
  }
  if (Array.isArray(obj.derivedIds)) {
    const before = obj.derivedIds.length;
    obj.derivedIds = obj.derivedIds.filter(id => !targetSet.has(id));
    removedDerived = before - obj.derivedIds.length;
  }
  return { removedRelations, removedDerived };
}

/**
 * Borra un objeto y, de forma transitiva, todo lo derivado de él.
 * Devuelve { deletedIds, removedRelations }.
 */
async function deleteWithCascade(storeName, id) {
  const primary = await dbGet(storeName, id);
  if (!primary) return { deletedIds: [], removedRelations: 0 };

  let removedRelations = 0;
  const deletedSet = new Set([id]);

  await dbTransaction(OBJECT_STORES, 'readwrite', async (ctx) => {
    const all = {};
    for (const s of OBJECT_STORES) all[s] = await getAllFromTx(ctx, s);
    const records = findCascadeRecords(all, storeName, id);
    for (const record of records) {
      deletedSet.add(record.id);
      ctx[record.storeName].delete(record.id);
    }

    for (const s of OBJECT_STORES) {
      for (const obj of (all[s] || [])) {
        if (!obj || !obj.id) continue;
        if (deletedSet.has(obj.id)) continue;
        const pruned = pruneObjectRefs(obj, deletedSet);
        if (pruned.removedRelations || pruned.removedDerived) {
          removedRelations += pruned.removedRelations;
          ctx[s].put(obj);
        }
      }
    }
  });

  return { deletedIds: Array.from(deletedSet), removedRelations };
}

/**
 * Poda en todos los stores las relaciones/derivedIds que apuntan a IDs borrados.
 * Devuelve { removedRelations }.
 */
async function pruneDanglingReferences(deletedIds) {
  const ids = Array.isArray(deletedIds) ? deletedIds : [deletedIds];
  const targetSet = new Set(ids.filter(id => id !== undefined && id !== null));
  let removedRelations = 0;

  if (targetSet.size === 0) return { removedRelations };

  await dbTransaction(OBJECT_STORES, 'readwrite', async (ctx) => {
    const all = {};
    for (const s of OBJECT_STORES) all[s] = await getAllFromTx(ctx, s);
    for (const s of OBJECT_STORES) {
      for (const obj of (all[s] || [])) {
        if (!obj || !obj.id) continue;
        if (targetSet.has(obj.id)) continue;
        const pruned = pruneObjectRefs(obj, targetSet);
        if (pruned.removedRelations || pruned.removedDerived) {
          removedRelations += pruned.removedRelations;
          ctx[s].put(obj);
        }
      }
    }
  });

  return { removedRelations };
}

export {
  auditOrphans,
  assertIntegrity,
  previewCascadeDelete,
  deleteWithCascade,
  pruneDanglingReferences,
  OBJECT_STORE_SET,
};
