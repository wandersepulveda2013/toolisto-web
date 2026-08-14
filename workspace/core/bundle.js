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

const BUNDLE_SCHEMA_VERSION = 3;
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

  let total = bundle.project ? canonicalJson(bundle.project).length : 0;
  for (const key of OBJECT_KEYS) {
    for (const obj of (bundle[key] || [])) {
      total += canonicalJson(obj).length;
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
  return validateManifest(bundle);
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
};
