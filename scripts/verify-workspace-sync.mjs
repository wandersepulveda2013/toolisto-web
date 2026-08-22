#!/usr/bin/env node
/**
 * verify-workspace-sync.mjs — verifica que dist/workspace/ es copia fiel de workspace/
 *
 * El source canónico es workspace/. El build (--production) copia workspace/ completo
 * a dist/workspace/ como parte del artefacto desplegable. La landing promocional
 * APLUNO se escribe en dist/workspace-about/, sin colisionar.
 *
 * Este script:
 *   1. Verifica que dist/workspace/ exista.
 *   2. Compara los archivos RUNTIME_FILES por SHA-256.
 *   3. Verifica que no queden restos de la landing APLUNO (apluno.css).
 *   4. Verifica que no falten archivos del source en dist.
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

console.log('=== Verificación source -> dist (workspace) ===\n');

if (!existsSync(DIST)) {
  console.log('  FAIL: dist/workspace/ no existe tras build --production');
  process.exit(1);
}

for (const rel of RUNTIME_FILES) {
  const s = join(SRC, rel);
  const d = join(DIST, rel);
  if (!existsSync(s)) { console.log(`  SKIP (sin source): ${rel}`); continue; }
  if (!existsSync(d)) { console.log(`  FAIL: falta en dist: ${rel}`); fail++; continue; }
  const hs = sha256(s), hd = sha256(d);
  if (hs === hd) { console.log(`  PASS: ${rel} — hash idéntico`); }
  else { console.log(`  FAIL: ${rel} — dist desincronizado (hash diferente)`); fail++; }
}

const distIndex = join(DIST, 'index.html');
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8');
  const hasApluno = html.includes('apluno.css');
  if (hasApluno) {
    console.log('  FAIL: dist/workspace/index.html referencia apluno.css (landing promocional escrita por error)');
    fail++;
  } else {
    console.log('  PASS: index.html — sin restos de landing APLUNO');
  }
}

const srcFiles = walk(SRC, '');
const distFiles = walk(DIST, '');
const missingInDist = srcFiles.filter(rel => !distFiles.includes(rel));

if (missingInDist.length) {
  console.log(`\n  FAIL: ${missingInDist.length} archivo(s) del source faltan en dist:`);
  for (const f of missingInDist) console.log(`    - ${f}`);
  fail += missingInDist.length;
} else {
  console.log(`  PASS: todos los ${srcFiles.length} archivos del source están en dist`);
}

console.log(`\n=== Resultado: ${fail === 0 ? 'SYNC OK' : fail + ' DESINCRONIZADO(S)'} ===`);
process.exit(fail === 0 ? 0 : 1);
