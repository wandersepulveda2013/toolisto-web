#!/usr/bin/env node
/**
 * bundle-reference-validation-test.mjs (CE-093)
 *
 * Auditoria determinista de la validacion pre-write de referencias cruzadas
 * del bundle de import (core/bundle.js).
 *
 * Problema (CE-093): `importProject` remapea los IDs (old->new) y persiste; un
 * objeto del bundle que referencia un ID que NO esta entre las entidades que se
 * van a importar dejaba una referencia colgante PERSISTIDA (el bundle podia
 * alterarse sin romper el manifiesto si se regenera, o venir de una base con
 * datos ya corruptos). `assertIntegrity` solo la detectaba DESPUES del commit,
 * como auditor; no habia rechazo en la validacion de import.
 *
 * Fijacion: `validateBundleImport` ahora ejecuta `validateBundleReferences`
 * ANTES de escribir: recalcula el conjunto de IDs que se importan por tipo de
 * store (documents/dataTables/captures/assets/executions/workflows) mas un
 * conjunto global, recorre cada objeto con la MISMA semantica de campos que
 * core/integrity.js (SOURCE_FIELDS, CONFIG_FIELDS, metadata.captureId,
 * relations, inputAssetIds, derivedIds) y rechaza cualquier referencia cuyo
 * destino no exista entre las entidades del bundle. Un link con tipo
 * restringido (sourceTableId/tableId->tabla, sourceDocId/scanDocId->documento,
 * captureId->captura) se valida contra su store correcto.
 *
 * Este test carga el CODIGO REAL de core/bundle.js (ESM; se extrae quitando
 * los `export` y se evalua en un sandbox) y verifica pre-write:
 *   1. Un bundle valido pasa (sin ref colgante) -> ok.
 *   2. Un documento con sourceDocId a un doc inexistente -> rechazado.
 *   3. Una tabla con sourceTableId a una tabla inexistente -> rechazado (tipo).
 *   4. Una captura con metadata.captureId colgante -> rechazado.
 *   5. Una relation.targetId colgante -> rechazado.
 *   6. Un asset inputAssetIds[0] colgante -> rechazado.
 *   7. Un ref que S\i apunta a una entidad presente (otro tipo) -> ok (se
 *      conserva la importacion valida).
 *   8. validateBundleImport con bundle de referencia descolgada -> ok.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const code = readFileSync(join(ROOT, 'workspace', 'core', 'bundle.js'), 'utf8');

// bundle.js solo importa BUNDLE_SCHEMA_VERSION desde schema-versions.js (puro).
// Extraemos el cuerpo, substituimos ese import por la constante (evitando el
// loader CJS del repo) y evaluamos en un sandbox que expone las funciones reales.
const body = code
  .replace("import { BUNDLE_SCHEMA_VERSION } from './schema-versions.js';", "const BUNDLE_SCHEMA_VERSION = 2;")
  .split('export {')[0];
const loader = new Function(body + '\nreturn { validateBundleImport, validateBundleReferences };');
const { validateBundleImport, validateBundleReferences } = loader();

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

function makeBundle(overrides = {}) {
  const project = { id: 'proj-1', name: 'Demo' };
  const documents = [{ id: 'doc-1', name: 'Doc 1', blocks: [] }, { id: 'doc-2', name: 'Doc 2', blocks: [] }];
  const dataTables = [{ id: 'tab-1', name: 'Tabla 1', rows: [] }];
  const captures = [{ id: 'cap-1', sourceAssetId: 'asset-1' }];
  const assets = [{ id: 'asset-1', name: 'scan' }, { id: 'asset-2', sourceAssetId: 'asset-1', correctedAssetId: 'asset-1' }];
  const executions = [{ id: 'exe-1', sourceAssetId: 'asset-1' }];
  const workflows = [{ id: 'wf-1', steps: [{ scanDocId: 'doc-1' }] }];
  const bundle = { project, documents, dataTables, captures, assets, executions, workflows, exportedAt: Date.now() };
  return Object.assign(bundle, overrides);
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

console.log('=== CE-093: referencias cruzadas del bundle validadas pre-write ===\n');

// ---------- 1. Bundle integro -> ok ----------
console.log('1. Bundle con todas sus referencias resueltas dentro del bundle: ok');
{
  const bundle = makeBundle();
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('validateBundleImport de un bundle integro -> ok', res.ok === true, JSON.stringify(res.errors));
  check('validateBundleReferences de un bundle integro -> sin errores', validateBundleReferences(bundle).length === 0);
}

// ---------- 2. documento.sourceDocId colgante ----------
console.log('\n2. sourceDocId hacia un doc inexistente: rechazado pre-write');
{
  const bundle = makeBundle();
  bundle.documents[0].sourceDocId = 'doc-inexistente';
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('referencia a documento inexistente -> rechazado', res.ok === false, JSON.stringify(res.errors));
  check('el diagnostico nombra al documento inexistente', JSON.stringify(res.errors).includes('doc-inexistente'));
  check('validateBundleReferences lo detecta', validateBundleReferences(bundle).length >= 1);
}

// ---------- 3. tabla.sourceTableId hacia una tabla inexistente (tipo restringido) ----------
console.log('\n3. sourceTableId hacia una tabla inexistente: rechazado por tipo');
{
  const bundle = makeBundle();
  bundle.documents.push({ id: 'doc-3', sourceTableId: 'tab-inexistente', blocks: [] });
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('referencia a tabla inexistente -> rechazado', res.ok === false, JSON.stringify(res.errors));
  check('el diagnostico nombra a "tabla"', JSON.stringify(res.errors).includes('tab-inexistente'));
}

// ---------- 4. captura.metadata.captureId colgante ----------
console.log('\n4. metadata.captureId hacia una captura inexistente: rechazado');
{
  const bundle = makeBundle();
  bundle.documents.push({ id: 'doc-4', metadata: { captureId: 'cap-inexistente' }, blocks: [] });
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('referencia a captura inexistente -> rechazado', res.ok === false, JSON.stringify(res.errors));
}

// ---------- 5. relation.targetId colgante ----------
console.log('\n5. relation.targetId hacia una entidad inexistente: rechazado');
{
  const bundle = makeBundle();
  bundle.assets[0].relations = [{ targetId: 'ent-inexistente', type: 'derives' }];
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('relation a entidad inexistente -> rechazado', res.ok === false, JSON.stringify(res.errors));
  check('el diagnostico nombra a la entidad inexistente', JSON.stringify(res.errors).includes('ent-inexistente'));
}

// ---------- 6. inputAssetIds colgante ----------
console.log('\n6. inputAssetIds con un ID inexistente: rechazado');
{
  const bundle = makeBundle();
  bundle.assets.push({ id: 'asset-3', inputAssetIds: ['asset-1', 'asset-no-existe'] });
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('inputAssetIds a entidad inexistente -> rechazado', res.ok === false, JSON.stringify(res.errors));
}

// ---------- 7. ref cruzado a una entidad PRESENTE (otro tipo) -> ok ----------
console.log('\n7. Referencia de asset->asset presente (otro asset): se conserva');
{
  const bundle = makeBundle();
  bundle.assets.push({ id: 'asset-3', sourceAssetId: 'asset-2' }); // asset-2 existe
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('asset->asset existente -> ok', res.ok === true, JSON.stringify(res.errors));
}

// ---------- 8. bundle heredado (sin manifest) con ref colgante -> rechazado ----------
console.log('\n8. Bundle heredado (sin manifest) PERO con ref colgante: igual rechazado (falta que exista el destino)');
{
  const bundle = makeBundle();
  bundle.assets[1].sourceAssetId = 'asset-no-existe'; // sourceAssetId S\i es campo validado
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('heredado con ref colgante -> rechazado', res.ok === false, JSON.stringify(res.errors));
}

// ---------- 9. ref a entidad presente en el MISMO tipo correcto -> ok (regresion con valores validos) ----------
console.log('\n9. Regresion: el bundle de referencia (assets->assets, exec->asset, wf.steps->doc) importa ok');
{
  const bundle = makeBundle(); // capture.sourceAssetId=asset-1, asset-2.correctedAssetId=asset-1, exe-1.sourceAssetId=asset-1, wf step scanDocId=doc-1
  delete bundle.manifest;
  const res = await validateBundleImport(bundle);
  check('bundle de referencia -> ok', res.ok === true, JSON.stringify(res.errors));
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);