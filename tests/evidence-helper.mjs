// evidence-helper.mjs — Escritura determinista de evidencia TLT.
// Garantiza que regenerar una evidencia produce bytes idénticos (diff = cero):
// elimina timestamps absolutos, normaliza puertos efímeros de loopback y ordena
// las claves de forma estable. Todos los gates que certifican herramientas
// escriben su evidencia a través de writeEvidence.
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const VOLATILE_KEYS = new Set(['generatedAt', 'updatedAt', 'fecha']);
const LOOPBACK_PORT_RE = /(https?|wss?):\/\/(?:127\.0\.0\.1|localhost):\d+/g;

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.replace(LOOPBACK_PORT_RE, '$1://127.0.0.1:<port>');
  }
  return value;
}

export function normalizeEvidence(data) {
  return JSON.stringify(canonicalize(data), null, 2) + '\n';
}

export function writeEvidence(filePath, data) {
  const content = normalizeEvidence(data);
  mkdirSync(dirname(filePath), { recursive: true });
  let previous = null;
  try {
    previous = readFileSync(filePath, 'utf8');
  } catch {
    previous = null;
  }
  if (previous === content) {
    return { written: false, changed: false };
  }
  writeFileSync(filePath, content);
  return { written: true, changed: previous !== null };
}
