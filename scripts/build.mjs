#!/usr/bin/env node
import { cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

console.log('Building Toolisto...\n');

// Generate SEO pages
console.log('--- Generating SEO pages ---');
execSync('node scripts/generate-seo-pages.mjs', { cwd: ROOT, stdio: 'inherit' });

// Copy additional files to dist
console.log('\n--- Copying additional files ---');
const dist = join(ROOT, 'dist');

const copies = [
  ['tool-processors.js', 'tool-processors.js'],
  ['tool-processors.js', 'js/tool-processors.js'],
  ['styles.css', 'styles.css'],
  ['index.html', 'index.html'],
  ['app.js', 'app.js'],
  ['app.js', 'js/app.js'],
];

for (const [src, dest] of copies) {
  const srcPath = join(ROOT, src);
  const destPath = join(dist, dest);
  if (existsSync(srcPath)) {
    cpSync(srcPath, destPath, { force: true });
    console.log(`  ✓ ${src} → dist/${dest}`);
  }
}

console.log('\n✓ Build complete. Serve dist/ directory.');
