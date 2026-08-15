#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const dist = resolve(root, 'dist');

if (dirname(dist) !== root || basename(dist) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build target: ${dist}`);
}

rmSync(dist, { recursive: true, force: true });

function run(script, args = []) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run('scripts/generate-seo-pages.mjs', ['--production']);
run('scripts/generate-apluno-pages.mjs');
