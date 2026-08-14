#!/usr/bin/env node
/* Coverage: procesadores de tool-processors.js mencionados en las suites tests/*.mjs */
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const proc = readFileSync(join(root, 'tool-processors.js'), 'utf8');
const names = [...proc.matchAll(/window\.ToolProcessors\.([A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]);
const unique = [...new Set(names)].sort();

const suiteFiles = readdirSync(join(root, 'tests')).filter((f) => f.startsWith('gate-e2e') && f.endsWith('.mjs'));
const fileText = suiteFiles.map((f) => readFileSync(join(root, 'tests', f), 'utf8')).join('\n');

const covered = [];
const uncovered = [];
for (const n of unique) {
  if (new RegExp(`\\b${n}\\b`).test(fileText)) covered.push(n);
  else uncovered.push(n);
}

console.log(`TOTAL procesadores: ${unique.length}`);
console.log(`Cubiertos: ${covered.length}`);
console.log(`SIN cubrir (${uncovered.length}):`);
for (const u of uncovered) console.log(`  - ${u}`);
