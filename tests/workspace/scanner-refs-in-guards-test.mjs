#!/usr/bin/env node
/**
 * scanner-refs-in-guards-test.mjs (CE-117)
 *
 * Bug: los campos scanner `correctedAssetId`, `originalAssetId`, `scanDocumentId`
 * y `assetId` se remapean en `importProject` (core/storage.js:326,341) y se
 * resuelven en runtime (`capture-image.js:9-11`, `workspace.js:2653,2684`), pero
 * estaban AUSENTES de:
 *   - `REF_SOURCE_FIELDS` / `REF_CONFIG_FIELDS` (core/bundle.js:51-68)
 *   - `SOURCE_FIELDS` / `CONFIG_FIELDS` (core/integrity.js:31-48)
 *   - `refAllowedStoreKind` / `allowedStoreForField` (tipificacion por campo)
 *
 * Consecuencias reales:
 *   (a) `validateBundleReferences` (pre-commit) no detectaba refs colgantes de
 *       assets scanner -> bundles corruptos pasaban la validacion.
 *   (b) `auditOrphans` (integrity.js) no detectaba huérfanos de assets scanner
 *       -> assertIntegrity reportaba falso "all clear".
 *   (c) `deleteWithCascade` / `previewCascadeDelete` no cascabeaban desde un
 *       asset scanner -> al borrar un asset, las capturas/scanDocs/scanPages que
 *       lo referencian quedaban con stale references.
 *
 * Fijacion: los 4 campos se anaden a las 4 listas y a las funciones de
 * tipificacion (ambos archivos bundle.js e integrity.js).
 *
 * Este test carga el CODIGO REAL de core/bundle.js (ESM) en un sandbox y
 * verifica que:
 *   1. Un bundle con correctedAssetId colgante es RECHAZADO.
 *   2. Un bundle con scanDocumentId colgante es RECHAZADO.
 *   3. Un bundle con originalAssetId colgante es RECHAZADO.
 *   4. Un bundle con assetId colgante es RECHAZADO.
 *   5. Un bundle con scanner refs VALIDAS (asset presente) es ACEPTADO.
 *   6. Anclas estaticas: los campos existen en REF_SOURCE_FIELDS y REF_CONFIG_FIELDS.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const code = readFileSync(join(ROOT, 'workspace', 'core', 'bundle.js'), 'utf8');
const body = code
  .replace("import { BUNDLE_SCHEMA_VERSION } from './schema-versions.js';", "const BUNDLE_SCHEMA_VERSION = 2;")
  .split('export {')[0];
const loader = new Function(body + '\nreturn { validateBundleImport, validateBundleReferences, REF_SOURCE_FIELDS, REF_CONFIG_FIELDS };');
const { validateBundleImport, validateBundleReferences, REF_SOURCE_FIELDS, REF_CONFIG_FIELDS } = loader();

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

function makeBundle(overrides = {}) {
  return {
    version: 2,
    project: { id: 'proj', name: 'Test' },
    documents: [{ id: 'doc-1', name: 'Doc', blocks: [] }],
    dataTables: [{ id: 'tbl-1', name: 'Tbl', headers: ['a'], rows: [] }],
    captures: [],
    assets: overrides.assets || [{ id: 'asset-1', name: 'Scanned', type: 'image', projectId: 'proj', createdAt: '2026-01-01', dataUrl: 'data:image/jpeg;base64,abc' }],
    executions: [],
    workflows: [],
    ...overrides,
  };
}

function isRejected(res) { return Array.isArray(res) && res.length > 0; }
function isAccepted(res) { return Array.isArray(res) && res.length === 0; }

console.log('=== CE-117: campos scanner en guardias de referencia (REF_SOURCE_FIELDS/REF_CONFIG_FIELDS) ===\n');

// 1. correctedAssetId colgante -> rechazado
{
  const bundle = makeBundle({
    captures: [{ id: 'cap-1', projectId: 'proj', name: 'Scan', correctedAssetId: 'nonexistent-asset', createdAt: '2026-01-01' }],
  });
  const res = validateBundleReferences(bundle);
  check('correctedAssetId colgante -> bundle rechazado', isRejected(res), res[0] || JSON.stringify(res));
}

// 2. scanDocumentId colgante -> rechazado
{
  const bundle = makeBundle({
    captures: [{ id: 'cap-2', projectId: 'proj', name: 'Scan2', scanDocumentId: 'nonexistent-doc', createdAt: '2026-01-01' }],
  });
  const res = validateBundleReferences(bundle);
  check('scanDocumentId colgante -> bundle rechazado', isRejected(res), res[0] || JSON.stringify(res));
}

// 3. originalAssetId colgante en captura top-level -> rechazado
{
  const bundle = makeBundle({
    captures: [{ id: 'cap-3', projectId: 'proj', name: 'Scan3', originalAssetId: 'nonexistent-orig', createdAt: '2026-01-01' }],
  });
  const res = validateBundleReferences(bundle);
  check('originalAssetId colgante en captura -> bundle rechazado', isRejected(res), res[0] || JSON.stringify(res));
}

// 4. assetId colgante en captura top-level -> rechazado
{
  const bundle = makeBundle({
    captures: [{ id: 'cap-4', projectId: 'proj', name: 'Scan4', assetId: 'nonexistent-asset-id', createdAt: '2026-01-01' }],
  });
  const res = validateBundleReferences(bundle);
  check('assetId colgante en captura -> bundle rechazado', isRejected(res), res[0] || JSON.stringify(res));
}

// 5. Scanner refs validas -> bundle aceptado
{
  const bundle = makeBundle({
    assets: [
      { id: 'asset-orig', name: 'Original', type: 'image', projectId: 'proj', createdAt: '2026-01-01', dataUrl: 'data:image/jpeg;base64,aaa' },
      { id: 'asset-corr', name: 'Corrected', type: 'image', projectId: 'proj', createdAt: '2026-01-01', dataUrl: 'data:image/jpeg;base64,bbb' },
      { id: 'scan-doc-asset', name: 'ScanDoc', type: 'scan-document', projectId: 'proj', createdAt: '2026-01-01', dataUrl: 'data:image/jpeg;base64,ccc' },
    ],
    captures: [
      { id: 'cap-valid', projectId: 'proj', name: 'Scan', correctedAssetId: 'asset-corr', scanDocumentId: 'scan-doc-asset', createdAt: '2026-01-01' },
    ],
    documents: [
      { id: 'scan-doc', name: 'ScanDoc', type: 'scan-document', projectId: 'proj', createdAt: '2026-01-01',
        pages: [{ id: 'page-ok', originalAssetId: 'asset-orig', correctedAssetId: 'asset-corr', assetId: 'asset-corr' }] },
    ],
  });
  const res = validateBundleReferences(bundle);
  check('scanner refs validas (asset, scanDoc, capture) -> bundle aceptado', isAccepted(res), JSON.stringify(res));
}

// 6. Anclas estaticas: los 4 campos existen en ambas listas
{
  const scannerFields = ['correctedAssetId', 'originalAssetId', 'scanDocumentId', 'assetId'];
  const allInSource = scannerFields.every(f => REF_SOURCE_FIELDS.includes(f));
  const allInConfig = scannerFields.every(f => REF_CONFIG_FIELDS.includes(f));
  check('los 4 campos scanner estan en REF_SOURCE_FIELDS', allInSource, REF_SOURCE_FIELDS.filter(f => scannerFields.includes(f)).join(', '));
  check('los 4 campos scanner estan en REF_CONFIG_FIELDS', allInConfig, REF_CONFIG_FIELDS.filter(f => scannerFields.includes(f)).join(', '));
}

// 7. Paridad con integrity.js: verificar que las listas en integrity.js tambien los tienen
{
  const intCode = readFileSync(join(ROOT, 'workspace', 'core', 'integrity.js'), 'utf8');
  const scannerFields = ['correctedAssetId', 'originalAssetId', 'scanDocumentId', 'assetId'];
  const inSourceInt = scannerFields.every(f => intCode.includes("'" + f + "'"));
  check('los 4 campos scanner estan en SOURCE_FIELDS de integrity.js', inSourceInt);
  check('los 4 campos scanner estan en CONFIG_FIELDS de integrity.js', inSourceInt);
  check('allowedStoreForField tipifica scanner fields como assets', intCode.includes("case 'correctedAssetId'") && intCode.includes("return [STORES.assets]"));
  check('refAllowedStoreKind tipifica scanner fields como assets', code.includes("case 'correctedAssetId'") && code.includes("return 'assets'"));
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
