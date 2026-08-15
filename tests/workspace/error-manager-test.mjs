#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'workspace', 'core', 'error-manager.js');

const code = readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name} — ${detail}`); }
}

console.log('=== Error Manager Tests ===\n');

check('error-manager.js existe', code.length > 0);
check('Exporta reportError', code.includes('export function reportError'));
check('Exporta showUserError', code.includes('export function showUserError'));
check('Exporta showWarning', code.includes('export function showWarning'));
check('Exporta showSuccess', code.includes('export function showSuccess'));
check('Exporta showInfo', code.includes('export function showInfo'));
check('Exporta classifyError', code.includes('export function classifyError'));
check('Exporta withErrorHandling', code.includes('export function withErrorHandling'));
check('Exporta setupGlobalErrorHandling', code.includes('export function setupGlobalErrorHandling'));
check('Exporta setToastHandler', code.includes('export function setToastHandler'));

// Verify error categories defined
check('Define categorias de error', code.includes('ERROR_CATEGORIES') || code.includes('errorCategories'));
check('Error UI handler window.onerror', code.includes('window.onerror') || code.includes('addEventListener(\'error\''));
check('Unhandled rejection handler', code.includes('unhandledrejection'));

// Test that the module can be loaded (without executing browser-specific code)
const fn = new Function('exports', code.replace(/^(export\s+|import\s.*$)/gm, ''));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
