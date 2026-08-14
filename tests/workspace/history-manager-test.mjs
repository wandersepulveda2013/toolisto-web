#!/usr/bin/env node
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'workspace', 'core', 'history-manager.js');

const code = readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name} — ${detail}`); }
}

console.log('=== History Manager Tests ===\n');

check('history-manager.js existe', code.length > 0);
check('Exporta createHistoryManager', code.includes('export function createHistoryManager'));

// Evaluate using vm with global context
const body = code
  .replace(/^import\s.*;?\s*$/gm, '')
  .replace(/^export\s+/gm, '');
const script = new vm.Script(body);
const sandbox = { setTimeout, clearTimeout, console, Date };
script.runInNewContext(sandbox);
const createHistoryManager = sandbox.createHistoryManager;

check('createHistoryManager es funcion', typeof createHistoryManager === 'function');

// Basic API surface
{
  const hm = createHistoryManager({ maxEntries: 3 });
  check('push es funcion', typeof hm.push === 'function');
  check('undo es funcion', typeof hm.undo === 'function');
  check('redo es funcion', typeof hm.redo === 'function');
  check('canUndo es funcion', typeof hm.canUndo === 'function');
  check('canRedo es funcion', typeof hm.canRedo === 'function');
  check('clear es funcion', typeof hm.clear === 'function');
  check('getStatus es funcion', typeof hm.getStatus === 'function');
  check('destroy es funcion', typeof hm.destroy === 'function');
  check('pushGrouped es funcion', typeof hm.pushGrouped === 'function');
}

// Undo/redo flow
{
  const hm = createHistoryManager({ maxEntries: 10 });
  hm.push({ x: 0 }, { action: 'init' });
  check('canUndo false con 1 entrada', !hm.canUndo());
  check('canRedo false sin futuro', !hm.canRedo());

  hm.push({ x: 1 }, { action: 'edit' });
  check('canUndo true con 2 entradas', hm.canUndo());

  const restored1 = hm.undo({ x: 2 });
  check('undo devuelve estado anterior', restored1 !== null && restored1.x === 1);
  check('canRedo true tras undo', hm.canRedo());

  const restored2 = hm.redo({ x: 2 });
  check('redo devuelve estado restaurado', restored2 !== null && restored2.x === 2);
  check('canRedo false tras redo', !hm.canRedo());
}

// Undo boundary
{
  const hm = createHistoryManager({ maxEntries: 3 });
  hm.push({ a: 1 }, {});
  const noUndo = hm.undo({ a: 2 });
  check('undo con 1 entrada devuelve null', noUndo === null);
}

// Max entries
{
  const hm = createHistoryManager({ maxEntries: 2 });
  hm.push({ a: 1 }, {});
  hm.push({ a: 2 }, {});
  hm.push({ a: 3 }, {});
  const status = hm.getStatus();
  check('maxEntries limita historial a 2 entradas', status.pastSize <= 2 && status.pastSize === 2);
  const restored = hm.undo({ a: 4 });
  check('undo funciona con limite de 2', restored !== null && restored.a === 3);
  const noMoreUndo = hm.undo({ a: 5 });
  check('maxEntries evita undo ilimitado', noMoreUndo === null);
}

// onChange callback
{
  let last = null;
  const hm = createHistoryManager({ maxEntries: 5, onChange: (s) => { last = s; } });
  hm.push({ a: 1 }, { action: 'test' });
  check('onChange llamado con canUndo false', last !== null && last.canUndo === false);
  hm.push({ a: 2 }, {});
  check('onChange llamado con canUndo true', last !== null && last.canUndo === true);
  hm.undo({ a: 3 });
  check('onChange llama con canRedo true', last !== null && last.canRedo === true);
}

// pushGrouped reemplaza ultima entrada en lugar de apilar
{
  const hm = createHistoryManager({ maxEntries: 10, writeDebounce: 9999 });
  hm.push({ a: 0 }, { action: 'init' });
  hm.pushGrouped({ a: 1 }, { action: 'edit' });
  hm.pushGrouped({ a: 2 }, { action: 'edit' });
  hm.pushGrouped({ a: 3 }, { action: 'edit' });
  check('pushGrouped mantiene 2 entradas (init + grouped)', hm.getStatus().pastSize === 2);
  const r = hm.undo({ a: 4 });
  check('undo tras grouped devuelve ultimo estado agrupado', r !== null && r.a === 3);
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
