#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

console.log('\n=== Auditoría de código muerto ===\n');

const removedModules = [
  'js/security/local-encryption.js',
  'js/documents/apa7-formatter.js',
];
const generator = source('scripts/generate-seo-pages.mjs');

for (const path of removedModules) {
  check(`${path} no se conserva sin consumidor`, !existsSync(join(root, path)));
  check(`el generador no inyecta ${path}`, !generator.includes(path));
}

const processors = source('tool-processors.js');
for (const helper of [
  'createZipBlob',
  'downloadBlob',
  'extensionForMime',
  'safeFileName',
  'streamToString',
  '_metaStripJpegExif',
]) {
  check(`tool-processors no define helper huérfano ${helper}`, !processors.includes(`function ${helper}(`));
}

check('braille no define isLetter sin consumidor', !source('js/accessibility/braille-es.js').includes('function isLetter('));
check('parser no redefine isNaN sin consumidor', !source('js/math/expression-parser.js').includes('function isNaN('));
check('modo QR no define canvasToPng sin consumidor', !source('js/modes/qr.js').includes('function canvasToPng('));
check('generador no define breadcrumb JSON-LD sin consumidor', !generator.includes('function buildBreadcrumbLD('));
check('auditor SEO no define extractTag sin consumidor', !source('scripts/seo-audit.mjs').includes('function extractTag('));

console.log(`\nRESULTADO: ${passed}/${passed + failed} comprobaciones PASS`);
if (failed) process.exit(1);
