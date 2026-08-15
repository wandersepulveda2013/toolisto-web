#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const WS = join(ROOT, 'workspace', 'workspace.js');
const code = readFileSync(WS, 'utf8');

let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name} — ${detail}`); }
}

function includesR(str, pattern) {
  return new RegExp(pattern).test(str);
}

console.log('=== Session Recovery Tests ===\n');

check('workspace.js importa workspace-storage', includesR(code, 'import.*workspace-storage'));
check('workspace.js importa error-manager', includesR(code, 'import.*error-manager'));
check('workspace.js importa history-manager', includesR(code, 'import.*history-manager'));

check('Tiene beforeunload handler', code.includes('beforeunload'));
check('Tiene visibilitychange handler', code.includes('visibilitychange'));
check('Tiene autosave setup', code.includes('_setupAutosave'));
check('Tiene flush and save session', code.includes('_flushAndSaveSession'));
check('Tiene save indicator', code.includes('_saveIndicator'));

check('Tiene Ctrl+Z shortcut', code.includes('key.toLowerCase()') && code.includes("'z'"));
check('Tiene Ctrl+Y shortcut', code.includes('key.toLowerCase()') && code.includes("'y'"));
check('Tiene undo button en topbar', code.includes('ws-undo-btn'));
check('Tiene redo button en topbar', code.includes('ws-redo-btn'));
check('Tiene input awareness en shortcuts', code.includes('isInput'));
check('Tiene input filter en shortcuts', code.includes('isContentEditable'));

check('Tiene recuperacion de sesion con modal', code.includes('Recuperar sesion'));
check('Tiene hasRecoverableSession', code.includes('hasRecoverableSession'));
check('Tiene loadWorkspaceSession', code.includes('loadWorkspaceSession'));
check('Tiene deleteWorkspaceSession', code.includes('deleteWorkspaceSession'));

check('Tiene undoStackSize en appStore', code.includes('undoStackSize'));
check('Tiene redoStackSize en appStore', code.includes('redoStackSize'));

check('Tiene toast queue', code.includes('toastQueue'));
check('Tiene max visible toasts', code.includes('MAX_VISIBLE_TOASTS'));
check('Tiene flush toast queue', code.includes('_flushToastQueue'));

check('Tiene isDirty subscription', code.includes("subscribe('isDirty'"));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
