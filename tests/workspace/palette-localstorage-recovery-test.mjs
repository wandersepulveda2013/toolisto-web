#!/usr/bin/env node
/**
 * palette-localstorage-recovery-test.mjs (CE-095)
 *
 * Auditoria de la lectura de preferencias de la paleta de comandos en
 * workspace.js a nivel de import.
 *
 * Problema (CE-095): la paleta leia a nivel de import
 *   const favoriteTools = new Set(JSON.parse(localStorage.getItem('ws-favorites') || '[]'));
 *   const recentTools = JSON.parse(localStorage.getItem('ws-recent') || '[]');
 * SIN try/catch. Una clave `ws-favorites` o `ws-recent` corrupta (JSON invalido,
 * escritura parcial, otro tab) lanzaba al cargar workspace.js -> rompia el
 * arranque completo del Workspace, misma clase de crash de boot que CE-092 pero
 * en una ruta distinta.
 *
 * Fijacion: reutilizar el helper seguro readJsonList de core/state.js (default
 * [] ante JSON invalido o no-array + limpieza de la clave corrupta) para las dos
 * listas, y envolver las escrituras (toggleFavoriteTool/addToRecentTools) en
 * try/catch.
 *
 * Este test carga:
 *   - readJsonList REAL de core/state.js,
 *   - las sentencias REALES de inicializacion de favoriteTools/recentTools y las
 *     funciones REALES toggleFavoriteTool/addToRecentTools de workspace.js,
 * dentro de un sandbox con un localStorage controlado (corrupto y valido).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const stateCode = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

// ---------- readJsonList real (core/state.js) ----------
function loadReadJsonList() {
  let src = stateCode
    .replace(/^import\s.*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  src = src.slice(0, src.indexOf('const appStore = createStore('));
  const fn = new Function(src + '\nreturn readJsonList;');
  return fn();
}
const readJsonList = loadReadJsonList();

// ---------- Extractor de funciones reales de workspace.js ----------
function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^(async )?function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

function buildStorage(init = {}, { throwOnWrite = false } = {}) {
  const data = { ...init };
  return {
    data,
    getItem(k) { return k in data ? data[k] : null; },
    setItem(k, v) { if (throwOnWrite) throw new Error('quota-exceeded'); data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
}

// Ejecuta las sentencias reales de inicializacion + las dos funciones reales.
function loadPalette(localStorageShim) {
  const initLines = wsCode
    .split('\n')
    .filter(l => l.includes("readJsonList('ws-favorites')") || l.includes("readJsonList('ws-recent')"))
    .join('\n');
  const body = initLines + '\n' +
    grabFn(wsCode, 'toggleFavoriteTool') + '\n' +
    grabFn(wsCode, 'addToRecentTools');
  const prevLS = globalThis.localStorage;
  globalThis.localStorage = localStorageShim;
  let out;
  try {
    const fn = new Function('readJsonList', body + '\nreturn { favoriteTools, recentTools, toggleFavoriteTool, addToRecentTools };');
    out = fn(readJsonList);
  } finally {
    globalThis.localStorage = prevLS;
  }
  return out;
}

console.log('=== CE-095: preferencias de la paleta a prueba de localStorage corrupto ===\n');

// ---------- 1. ws-favorites corrupto: no crashea, Set vacio, clave eliminada ----------
console.log('1. ws-favorites con JSON invalido: la paleta arranca con favoritos vacios y se auto-repara');
{
  const localStorageShim = buildStorage({ 'ws-favorites': '{roto' });
  let ok = false, fTools = null, rTools = null;
  try {
    const api = loadPalette(localStorageShim);
    fTools = api.favoriteTools; rTools = api.recentTools;
    ok = fTools instanceof Set && fTools.size === 0 && Array.isArray(rTools);
  } catch (e) { ok = false; }
  check('la paleta se construye sin lanzar y favoriteTools/recentTools quedan vacios', ok === true);
  check('la clave corrupta ws-favorites se elimina (auto-reparacion)',
    !('ws-favorites' in localStorageShim.data), Object.keys(localStorageShim.data).join(','));
}

// ---------- 2. ws-recent corrupto: [] y clave eliminada ----------
console.log('\n2. ws-recent con JSON invalido: recentTools=[] y clave eliminada');
{
  const localStorageShim = buildStorage({ 'ws-recent': 'no-es-json' });
  let rTools = null;
  try { rTools = loadPalette(localStorageShim).recentTools; } catch {}
  check('recentTools queda en [] sin romper el arranque', Array.isArray(rTools) && rTools.length === 0);
  check('la clave corrupta ws-recent se elimina', !('ws-recent' in localStorageShim.data));
}

// ---------- 3. Valores validos se conservan intactos ----------
console.log('\n3. Valores VALIDOS: favoritos y recientes se conservan');
{
  const localStorageShim = buildStorage({ 'ws-favorites': '["ocr","graficos"]', 'ws-recent': '["visor-pdf","calculadora"]' });
  let fTools = null, rTools = null;
  try { const api = loadPalette(localStorageShim); fTools = api.favoriteTools; rTools = api.recentTools; } catch {}
  check('favoritos validos conservados (Set con 2)', fTools instanceof Set && fTools.size === 2 && fTools.has('ocr'));
  check('recientes validos conservados (array con 2)', Array.isArray(rTools) && rTools.length === 2 && rTools[0] === 'visor-pdf');
  check('las claves validas NO se eliminan', 'ws-favorites' in localStorageShim.data && 'ws-recent' in localStorageShim.data);
}

// ---------- 4. Reciente duplicado: addToRecentTools lo mueve al frente ----------
console.log('\n4. addToRecentTools con reciente existente lo mueve al frente (regresion)');
{
  const localStorageShim = buildStorage({ 'ws-recent': '["a","b","c"]' });
  const api = loadPalette(localStorageShim);
  api.addToRecentTools('b');
  const r = api.recentTools;
  check('b recientemente usado se mueve al frente y el resto se conserva', r[0] === 'b' && r.length === 3 && r[1] === 'a' && r[2] === 'c', JSON.stringify(r));
}

// ---------- 5. toggleFavoriteTool agrega/quita y persiste ----------
console.log('\n5. toggleFavoriteTool agrega y quita del Set y persiste');
{
  const localStorageShim = buildStorage({ 'ws-favorites': '["ocr"]' });
  const api = loadPalette(localStorageShim);
  // las funciones reales escriben via el global localStorage; lo instalamos
  // para la duracion del ejercicio y lo restauramos tras assert
  const prevLS = globalThis.localStorage;
  globalThis.localStorage = localStorageShim;
  try {
    api.toggleFavoriteTool('pdf');          // agregar
    check('toggle anade pdf al Set', api.favoriteTools.has('pdf') && api.favoriteTools.size === 2);
    check('la escritura persiste en localStorage', JSON.parse(localStorageShim.data['ws-favorites']).includes('pdf'));
    api.toggleFavoriteTool('ocr');          // quitar
    check('toggle quita ocr del Set', !api.favoriteTools.has('ocr'));
  } finally { globalThis.localStorage = prevLS; }
}

// ---------- 6. Escritura que lanza (quota) no rompe el arranque ----------
console.log('\n6. Escritura que lanza (quota excedida): las funciones no propagan el error');
{
  const localStorageShim = buildStorage({ 'ws-recent': '[]' }, { throwOnWrite: true });
  const api = loadPalette(localStorageShim);
  let ok = true;
  const prevLS = globalThis.localStorage;
  globalThis.localStorage = localStorageShim;
  try {
    api.toggleFavoriteTool('x');   // setItem lanza internamente; debe capturarse
    api.addToRecentTools('y');
  } catch (e) { ok = false; }
  finally { globalThis.localStorage = prevLS; }
  check('toggle/addToRecent no propagan el error de localStorage.setItem', ok === true);
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);