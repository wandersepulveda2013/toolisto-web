/**
 * core/bundle.js — Contrato del bundle .toolisto (Paso 5: confianza export/import)
 *
 * WSP-014 / WDX-002: manifiesto con schemaVersion, appVersion, conteos,
 * checksums SHA-256 por objeto y cadena de derivación. Alterar un byte invalida
 * la verificación y el importador recibe un diagnóstico.
 * WSP-013 / WDX-007: importación atómica (toda la validación ocurre antes de
 * cualquier escritura; el importador escribe en una única transacción).
 * WSP-015: límites adversarios (profundidad, conteos y tamaño configurables).
 *
 * Los bundles heredados (sin manifest) se aceptan: `validateBundleImport`
 * devuelve `{ ok: true, legacy: true }`.
 */

import { BUNDLE_SCHEMA_VERSION } from './schema-versions.js';

const APP_VERSION = '1.0.0';

const IMPORT_LIMITS = Object.freeze({
  maxObjectsPerStore: 20000,
  maxDepth: 64,
  maxJsonBytes: 200 * 1024 * 1024,
});

const OBJECT_KEYS = ['documents', 'dataTables', 'captures', 'assets', 'executions', 'workflows'];

const LABELS = {
  documents: 'documento',
  dataTables: 'tabla',
  captures: 'captura',
  assets: 'activo',
  executions: 'ejecución',
  workflows: 'flujo',
};

/*
 * CE-093: validación de referencias cruzadas ANTES de escribir.
 *
 * `importProject` remapea los IDs (old->new) y persiste. Un bundle cuyo objeto
 * referencia un ID que NO está entre las entidades importadas (ref colgante:
 * escritura parcial, edición manual, export de una base ya corrupta) dejaba una
 * referencia huérfana persistida; `assertIntegrity` solo la detecta DESPUÉS del
 * commit, como auditor.
 *
 * Estas dos listas replican la semántica exacta de core/integrity.js
 * (SOURCE_FIELDS, CONFIG_FIELDS y la tipificación por campo) para auditar el
 * MISMO conjunto de referencias que produce el auditor de huérfanos, pero sobre
 * el bundle pre-commit: un ID referenciado que no existe entre los objetos que
 * se van a importar rechaza el bundle con diagnóstico y no se escribe nada.
 */
const REF_SOURCE_FIELDS = [
  'sourceAssetId',
  'captureId',
  'sourceDocId',
  'scanDocId',
  'sourceTableId',
  'tableId',
  'sourceId',
  'resultAssetId',
];

const REF_CONFIG_FIELDS = [
  'sourceAssetId',
  'sourceTableId',
  'scanDocId',
  'captureId',
  'sourceId',
];

/* Tipificación por campo: en qué tipo de store DEBE existir la referencia. */
function refAllowedStoreKind(field) {
  switch (field) {
    case 'sourceTableId':
    case 'tableId':
      return 'dataTables';
    case 'sourceDocId':
    case 'scanDocId':
    case 'docId':
      return 'documents';
    case 'captureId':
      return 'captures';
    default:
      return null; /* cualquier store válido como destino */
  }
}

/*
 * Devuelve { ids: [{id, kind|null}] } de todas las referencias de un objeto.
 * `kind`: tipo de store restringido para el campo, o null si admite cualquiera.
 */
function collectRefIds(obj) {
  const refs = [];
  for (const field of REF_SOURCE_FIELDS) {
    if (obj[field] !== undefined && obj[field] !== null && obj[field] !== '') {
      refs.push({ id: obj[field], kind: refAllowedStoreKind(field) });
    }
  }
  if (Array.isArray(obj.inputAssetIds)) {
    for (const id of obj.inputAssetIds) refs.push({ id, kind: null });
  }
  if (Array.isArray(obj.derivedIds)) {
    for (const id of obj.derivedIds) refs.push({ id, kind: null });
  }
  if (obj.config && typeof obj.config === 'object') {
    for (const field of REF_CONFIG_FIELDS) {
      if (obj.config[field] !== undefined && obj.config[field] !== null && obj.config[field] !== '') {
        refs.push({ id: obj.config[field], kind: refAllowedStoreKind(field) });
      }
    }
  }
  if (obj.metadata && typeof obj.metadata === 'object' && obj.metadata.captureId) {
    refs.push({ id: obj.metadata.captureId, kind: 'captures' });
  }
  if (Array.isArray(obj.relations)) {
    for (const rel of obj.relations) {
      if (!rel) continue;
      if (rel.targetId && rel.targetId !== undefined && rel.targetId !== null) refs.push({ id: rel.targetId, kind: null });
      if (rel.from && rel.from !== undefined && rel.from !== null) refs.push({ id: rel.from, kind: null });
      if (rel.to && rel.to !== undefined && rel.to !== null) refs.push({ id: rel.to, kind: null });
    }
  }
  return refs;
}

/**
 * Audita las referencias cruzadas del bundle pre-commit (CE-093). Devuelve
 * errores que describen cada referencia colgante (owner, campo y destino).
 * Ignora `projectId` porque `importProject` lo REASIGNA, no lo remapea, por lo
 * que el `projectId` del bundle no tiene por qué existir entre las entidades.
 */
function validateBundleReferences(bundle) {
  const byKind = { documents: new Set(), dataTables: new Set(), captures: new Set(), assets: new Set(), executions: new Set(), workflows: new Set() };
  const all = new Set();
  for (const key of OBJECT_KEYS) {
    for (const obj of (bundle[key] || [])) {
      if (obj && obj.id) { byKind[key].add(obj.id); all.add(obj.id); }
    }
  }
  const errors = [];
  const idLabel = id => typeof id === 'string' ? id : String(id);
  for (const key of OBJECT_KEYS) {
    for (const obj of (bundle[key] || [])) {
      if (!obj || !obj.id) continue;
      for (const ref of collectRefIds(obj)) {
        if (ref.id === undefined || ref.id === null || ref.id === '') continue;
        if (ref.kind) {
          if (!byKind[ref.kind].has(ref.id)) {
            errors.push(`${LABELS[key]} ${idLabel(obj.id)} referencia a un ${LABELS[ref.kind]} inexistente: ${idLabel(ref.id)}`);
          }
        } else if (!all.has(ref.id)) {
          errors.push(`${LABELS[key]} ${idLabel(obj.id)} referencia a una entidad inexistente: ${idLabel(ref.id)}`);
        }
      }
    }
  }
  return errors;
}

/**
 * Serialización canónica (claves ordenadas) para hashing estable e
 * independiente del orden de inserción.
 */
function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/**
 * Profundidad máxima de anidamiento (objetos/arrays). Corta temprano en
 * `limit` para no desbordar la pila con input adversario.
 */
function jsonDepth(value, limit = 128) {
  let max = 0;
  const walk = (v, depth) => {
    if (depth > max) max = depth;
    if (max > limit) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], depth + 1);
    }
  };
  walk(value, 0);
  return max;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function collectRelations(bundle) {
  const relations = [];
  for (const key of OBJECT_KEYS) {
    for (const obj of (bundle[key] || [])) {
      for (const r of (obj.relations || [])) {
        const to = r.targetId || r.to;
        if (to) relations.push({ from: obj.id, to, type: r.type || 'relation' });
      }
    }
  }
  return relations;
}

async function buildManifest(bundle) {
  const counts = { project: bundle.project ? 1 : 0 };
  const checksums = { project: null };
  for (const key of OBJECT_KEYS) {
    const items = bundle[key] || [];
    counts[key] = items.length;
    checksums[key] = {};
    for (const obj of items) {
      if (obj && obj.id) checksums[key][obj.id] = await sha256Hex(canonicalJson(obj));
    }
  }
  if (bundle.project) checksums.project = await sha256Hex(canonicalJson(bundle.project));
  const derivation = collectRelations(bundle);
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: bundle.exportedAt || Date.now(),
    counts,
    relationCount: derivation.length,
    derivation,
    checksums,
  };
}

/**
 * Límites adversarios (WSP-015): se ejecutan SIEMPRE, haya o no manifiesto.
 */
function validateImportLimits(bundle, limits = IMPORT_LIMITS) {
  const errors = [];

  const depth = jsonDepth(bundle, limits.maxDepth);
  if (depth > limits.maxDepth) {
    errors.push(`El bundle tiene una profundidad de ${depth} niveles (límite ${limits.maxDepth})`);
  }
  if (errors.length) return errors;

  for (const key of OBJECT_KEYS) {
    const n = (bundle[key] || []).length;
    if (n > limits.maxObjectsPerStore) {
      errors.push(`${key}: ${n} objetos supera el límite de ${limits.maxObjectsPerStore}`);
    }
  }
  if (errors.length) return errors;

  const enc = new TextEncoder();
  let total = bundle.project ? enc.encode(canonicalJson(bundle.project)).length : 0;
  for (const key of OBJECT_KEYS) {
    for (const obj of (bundle[key] || [])) {
      total += enc.encode(canonicalJson(obj)).length;
    }
  }
  if (total > limits.maxJsonBytes) {
    errors.push(`El bundle ocupa ${total} bytes y supera el límite de ${limits.maxJsonBytes} bytes`);
  }
  return errors;
}

/**
 * Verifica el manifiesto del bundle (si existe). Un byte alterado produce un
 * diagnóstico que identifica el objeto afectado.
 */
async function validateManifest(bundle) {
  if (!bundle.manifest) return { ok: true, legacy: true, errors: [] };
  const m = bundle.manifest;
  const errors = [];

  if (!m.schemaVersion) errors.push('El manifiesto no declara schemaVersion');
  if (m.schemaVersion > BUNDLE_SCHEMA_VERSION) {
    errors.push(`Manifiesto de una versión futura (schema ${m.schemaVersion} > ${BUNDLE_SCHEMA_VERSION})`);
  }
  if (!m.checksums || typeof m.checksums !== 'object') {
    errors.push('El manifiesto no incluye checksums');
    return { ok: false, legacy: false, errors };
  }

  if (bundle.project) {
    const expected = m.checksums.project;
    if (!expected) errors.push('El manifiesto no cubre el proyecto');
    else if ((await sha256Hex(canonicalJson(bundle.project))) !== expected) {
      errors.push('El proyecto no coincide con su hash de integridad');
    }
  }

  for (const key of OBJECT_KEYS) {
    const items = bundle[key] || [];
    const expectedMap = (m.checksums[key]) || {};
    if (m.counts && typeof m.counts[key] === 'number' && m.counts[key] !== items.length) {
      errors.push(`El manifiesto espera ${m.counts[key]} objeto(s) de ${key} y el bundle trae ${items.length}`);
    }
    for (const obj of items) {
      if (!obj || !obj.id) continue;
      const expected = expectedMap[obj.id];
      if (!expected) {
        errors.push(`El ${LABELS[key]} ${obj.id} no está cubierto por el manifiesto`);
        continue;
      }
      const actual = await sha256Hex(canonicalJson(obj));
      if (actual !== expected) {
        errors.push(`El ${LABELS[key]} ${obj.id} no coincide con su hash de integridad`);
      }
    }
  }

  return { ok: errors.length === 0, legacy: false, errors };
}

async function validateBundleImport(bundle, limits = IMPORT_LIMITS) {
  const limitErrors = validateImportLimits(bundle, limits);
  if (limitErrors.length) return { ok: false, legacy: false, errors: limitErrors };
  const manifest = await validateManifest(bundle);
  if (!manifest.ok) return manifest;

  // CE-093: un bundle íntegro en bytes pero con referencias colgantes (apuntan a
  // entidades que no se importan) se rechaza aquí, ANTES de escribir nada, en vez
  // de persistir huérfanos que el auditor solo detectaría post-commit.
  const refErrors = validateBundleReferences(bundle);
  if (refErrors.length) return { ok: false, legacy: manifest.ok, errors: refErrors };

  return manifest;
}

export {
  BUNDLE_SCHEMA_VERSION,
  APP_VERSION,
  IMPORT_LIMITS,
  canonicalJson,
  jsonDepth,
  sha256Hex,
  buildManifest,
  validateManifest,
  validateImportLimits,
  validateBundleImport,
  validateBundleReferences,
};
