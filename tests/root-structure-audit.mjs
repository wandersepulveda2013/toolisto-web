#!/usr/bin/env node
// Mantiene la raíz de producción limitada a los directorios publicados y de mantenimiento.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const trackedRoots = new Set(tracked.map((path) => path.split('/')[0]));
const allowedDirectories = new Set([
  '.opencode', 'artifacts', 'assets', 'js', 'screenshots', 'scripts', 'src', 'tests', 'vendor', 'workspace',
]);
const trackedDirectories = [...trackedRoots].filter((entry) => tracked.some((path) => path.startsWith(`${entry}/`)));
const unexpectedDirectories = trackedDirectories.filter((directory) => !allowedDirectories.has(directory));

console.log('\n=== Auditoría de estructura de raíz ===\n');
check('no existe el directorio temporal work/', !existsSync(join(root, 'work')));
check('ningún archivo versionado usa el prefijo work/', !tracked.some((path) => path.startsWith('work/')));
check('los directorios versionados pertenecen a la arquitectura aprobada', unexpectedDirectories.length === 0);
check('la raíz conserva código fuente público', ['js', 'scripts', 'src', 'workspace'].every((directory) => trackedRoots.has(directory)));
check('la raíz conserva tests y artefactos versionados', ['tests', 'artifacts'].every((directory) => trackedRoots.has(directory)));
check('node_modules no está versionado', !tracked.some((path) => path.startsWith('node_modules/')));
check('dist no está versionado', !tracked.some((path) => path.startsWith('dist/')));
check('los archivos pnpm accidentales no están versionados', !tracked.some((path) => /(^|\/)pnpm-(lock\.yaml|workspace\.yaml)$/.test(path)));
check('no hay fixtures temporales versionados en la raíz', !tracked.some((path) => /^(\.audit|\.spot|_toolisto)/.test(path)));

console.log(`\nRESULTADO: ${passed}/${passed + failed} comprobaciones PASS`);
process.exit(failed ? 1 : 0);
