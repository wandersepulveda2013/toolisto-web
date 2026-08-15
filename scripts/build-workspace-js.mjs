#!/usr/bin/env node
/**
 * GUARD — build-workspace-js.mjs (auditado, Paso 2)
 *
 * Este script solía REGENERAR workspace/workspace.js desde chunks inline,
 * sobrescribiendo el archivo con una versión obsoleta (1646 líneas) que NO
 * contenía los fixes de Phase 3C/3D/3E (OCR real, registerExecution,
 * convertDocToTable, history, workspace-storage, error-manager, etc.).
 *
 * El source canónico es `workspace/workspace.js` (6834 líneas, rastreado en
 * git, mantenido a mano y sincronizado a dist/ por `generate-seo-pages.mjs`).
 *
 * Por eso este script ahora se NIEGA a regenerar. Es un guard: no destruye
 * el canónico. Ejecutar `npm run build` copia workspace/ → dist/workspace/
 * y verifica hashes; este archivo queda como fósil seguro de advertencia.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const canonical = join(__dirname, '..', 'workspace', 'workspace.js');

const CANONICAL_MARKERS = ['registerExecution', 'extractTextFromScan', 'convertDocToTable', 'normalizeOcrNumber'];

console.error('EACCES: no se regenera workspace/workspace.js.');
console.error('');
console.error('Este generador quedó obsoleto en Phase 3C. workspace/workspace.js es el');
console.error('source canónico mantenido a mano (6834 líneas con fixes 3C/3D/3E).');
console.error('Regenerarlo con este script produce una versión antigua de 1646 líneas');
console.error('que destruye: registerExecution, extractTextFromScan, convertDocToTable,');
console.error('history, workspace-storage, error-manager, chart/data/PDF y más.');
console.error('');
console.error('Uso correcto:');
console.error('  npm run build            # copia workspace/ -> dist/workspace/ + paginas');
console.error('  npm run test:workspace:release  # build + verificacion source->dist + suites');
console.error('');

let ok = true;
if (!existsSync(canonical)) {
  console.error(`FATAL: no existe el canónico ${canonical}. Nada que proteger.`);
  ok = false;
} else {
  const content = readFileSync(canonical, 'utf-8');
  const missing = CANONICAL_MARKERS.filter(m => !content.includes(m));
  if (missing.length > 0) {
    console.error(`ALERTA: el canónico NO contiene ${missing.join(', ')}.`);
    console.error('No regeneres manualmente; investiga antes.');
    ok = false;
  } else {
    console.error('Canónico protegido (marcadores 3C/3D/3E presentes). Abortando sin tocar nada.');
  }
}

process.exit(ok ? 1 : 1);
