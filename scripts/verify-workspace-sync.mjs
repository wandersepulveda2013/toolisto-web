#!/usr/bin/env node
/**
 * verify-workspace-sync.mjs — verifica que dist/workspace/ coincide con workspace/
 *
 * El source canónico es workspace/. dist/ se genera con `npm run build`:
 * el index interno se publica como preview.html y la landing pública reserva index.html.
 * Este script compara hashes de los archivos de runtime y reporta cualquier
 * desincronización manual.
 *
 * Salida: exit 0 si todo sincronizado; exit 1 si hay diferencias o faltan.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'workspace');
const DIST = join(ROOT, 'dist', 'workspace');

const RUNTIME_FILES = [
  'index.html', 'workspace.css', 'workspace.js', 'tools-data.js',
  'core/db.js', 'core/state.js', 'core/events.js', 'core/storage.js',
];

function distRelative(rel) {
  return rel === 'index.html' ? 'preview.html' : rel;
}

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function walk(dir, base, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = join(base, entry).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) walk(full, rel, out);
    else out.push(rel);
  }
  return out;
}

let fail = 0;
const diff = [];

console.log('=== Verificación source -> dist (workspace) ===\n');

for (const rel of RUNTIME_FILES) {
  const s = join(SRC, rel);
  const distRel = distRelative(rel);
  const d = join(DIST, distRel);
  if (!existsSync(s)) { console.log(`  SKIP (sin source): ${rel}`); continue; }
  if (!existsSync(d)) { console.log(`  FAIL: falta en dist: ${distRel}`); fail++; diff.push(distRel); continue; }
  const hs = sha256(s), hd = sha256(d);
  if (hs === hd) { console.log(`  PASS: ${rel} -> ${distRel}`); }
  else { console.log(`  FAIL: dist desincronizado: ${rel} -> ${distRel}`); fail++; diff.push(distRel); }
}

const srcFiles = walk(SRC, '');
const distFiles = walk(DIST, '');
const expectedDistFiles = srcFiles.map(distRelative);
const allowedPublicFiles = new Set(['index.html']);
const extraInDist = distFiles.filter(rel => !expectedDistFiles.includes(rel) && !allowedPublicFiles.has(rel));
const missingInDist = expectedDistFiles.filter(rel => !distFiles.includes(rel));

if (distFiles.includes('index.html')) {
  console.log('\n  PASS: index.html reservado para la landing pública de Workspace');
}

if (extraInDist.length) {
  console.log(`\n  INFO: ${extraInDist.length} archivo(s) extra en dist (remanentes): ${extraInDist.join(', ')}`);
}
if (missingInDist.length) {
  console.log(`\n  FAIL: ${missingInDist.length} archivo(s) del source faltan en dist: ${missingInDist.join(', ')}`);
  fail += missingInDist.length;
}

console.log(`\n=== Resultado: ${fail === 0 ? 'SYNC OK' : fail + ' DESINCRONIZADO(S)'} ===`);
process.exit(fail === 0 ? 0 : 1);
