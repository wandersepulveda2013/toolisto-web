#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'workspace', 'core', 'workspace-storage.js');

const code = readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name} — ${detail}`); }
}

console.log('=== Workspace Storage Tests ===\n');

check('workspace-storage.js existe', code.length > 0);
check('Exporta saveWorkspaceSession', code.includes('saveWorkspaceSession'));
check('Exporta loadWorkspaceSession', code.includes('loadWorkspaceSession'));
check('Exporta hasRecoverableSession', code.includes('hasRecoverableSession'));
check('Exporta deleteWorkspaceSession', code.includes('deleteWorkspaceSession'));
check('Exporta getWorkspaceSessionInfo', code.includes('getWorkspaceSessionInfo'));
check('Exporta cleanupOldSessions', code.includes('cleanupOldSessions'));

// Verify function arities from source
const fnPatterns = [
  ['saveWorkspaceSession', /export\s+async\s+function\s+saveWorkspaceSession\s*\(/],
  ['loadWorkspaceSession', /export\s+async\s+function\s+loadWorkspaceSession\s*\(/],
  ['hasRecoverableSession', /export\s+async\s+function\s+hasRecoverableSession\s*\(/],
  ['deleteWorkspaceSession', /export\s+async\s+function\s+deleteWorkspaceSession\s*\(/],
  ['getWorkspaceSessionInfo', /export\s+async\s+function\s+getWorkspaceSessionInfo\s*\(/],
  ['cleanupOldSessions', /export\s+async\s+function\s+cleanupOldSessions\s*\(/],
];

for (const [name, pattern] of fnPatterns) {
  check(`Funcion ${name} declarada como async`, pattern.test(code));
}

// Verify localStorage usage for session ID
check('Usa localStorage para session ID', code.includes('localStorage'));
check('Usa dbPut/dbGet de storage.js', code.includes('dbPut'));

// Verify session records carry the centralized schema version (value 1)
const schemaSrc = readFileSync(join(ROOT, 'workspace', 'core', 'schema-versions.js'), 'utf8');
check('Importa SESSION_SCHEMA_VERSION desde schema-versions.js', /import\s*\{[^}]*SESSION_SCHEMA_VERSION[^}]*\}\s*from\s*['"]\.\/schema-versions\.js['"]/.test(code));
check('SESSION_SCHEMA_VERSION es 1', /SESSION_SCHEMA_VERSION\s*=\s*1\b/.test(schemaSrc));
check('Usa schemaVersion: SESSION_SCHEMA_VERSION en el registro', code.includes('schemaVersion: SESSION_SCHEMA_VERSION'));
check('Max 5 sesiones', code.includes('5') && (code.includes('MAX_SESSIONS') || code.includes('maxSessions')));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
