// evidence-determinism.mjs — Ratchet de determinismo de evidencia.
// Las evidencias generadas por los gates migrados deben estar en forma canónica
// exacta: sin timestamps absolutos, sin puertos efímeros de loopback y con claves
// ordenadas de forma estable. Si regenerar una evidencia cambiara sus bytes, este
// gate falla y la regresión deja de contaminar el árbol de trabajo.
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { normalizeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'artifacts', 'deep-audit', 'toolisto');

const MIGRATED = new Set([
  'TLT-accessibility-audit-evidence.json',
  'TLT-certify-23-tools-evidence.json',
  'TLT-certify-av-evidence.json',
  'TLT-certify-calc-family-evidence.json',
  'TLT-certify-converters-evidence.json',
  'TLT-certify-data-family-evidence.json',
  'TLT-certify-docs-extras-evidence.json',
  'TLT-certify-enhance-scanned-document-evidence.json',
  'TLT-certify-epub-family-evidence.json',
  'TLT-certify-file-family-evidence.json',
  'TLT-certify-file-family-extra-evidence.json',
  'TLT-certify-image-converters-evidence.json',
  'TLT-certify-image-family-evidence.json',
  'TLT-certify-image-interactive-evidence.json',
  'TLT-certify-ocr-pdf-evidence.json',
  'TLT-certify-pdf-encrypt-evidence.json',
  'TLT-certify-pdf-family-evidence.json',
  'TLT-certify-pdf-misc-evidence.json',
  'TLT-certify-qr-family-evidence.json',
  'TLT-certify-spreadsheet-family-evidence.json',
  'TLT-certify-structure-family-evidence.json',
  'TLT-certify-text-family-evidence.json',
  'TLT-certify-word-family-evidence.json',
  'TLT-deployment-guide-evidence.json',
  'TLT-production-tool-coverage-evidence.json',
  'TLT-public-site-network-negative-evidence.json',
  'TLT-public-site-security-audit-evidence.json',
  'TLT-pwa-offline-evidence.json',
  'TLT-responsive-matrix-evidence.json',
  'TLT-seo-production-audit-evidence.json',
  'TLT-toolisto-domain-gate-evidence.json',
]);

let failures = 0;
let checks = 0;

function check(name, pass, detail = '') {
  checks++;
  if (pass) {
    console.log(`  PASS: ${name}`);
  } else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('=== Determinismo de evidencia ===\n');

const files = readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
for (const file of files) {
  const content = readFileSync(join(dir, file), 'utf8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    check(`${file}: JSON válido`, false, error.message);
    continue;
  }
  check(`${file}: JSON válido`, true);
  if (MIGRATED.has(file)) {
    check(`${file}: forma canónica exacta`, normalizeEvidence(data) === content,
      'regenerar con el gate cambiaría el archivo');
  }
}

console.log(`\n=== Resultado: ${checks - failures} PASS, ${failures} FAIL ===`);
process.exit(failures ? 1 : 0);
