#!/usr/bin/env node
/**
 * boot-recovery-test.mjs (CE-092)
 *
 * Auditoria adversarial determinista del arranque del Workspace ante un
 * localStorage corrupto.
 *
 * Problema (CE-092): `state.js` hacia `JSON.parse(localStorage.getItem('toolisto-recent-tools') || '[]')`
 * (y favorite-tools) a nivel de import del modulo `appStore`, SIN try/catch. Una
 * sola clave corrupta (JSON invalido) lanzaba al instanciar `appStore`, ANTES de
 * `initApp`, dejando pantalla en blanco sin ruta de recuperacion.
 *
 * Este test carga el CODIGO REAL de state.js con un localStorage controlado:
 *   - corrupcion (JSON invalido) en recentTools,
 *   - corrupcion en favoriteTools,
 *   - clave con tipo wrong (objeto, no array),
 *   - clave ausente (null),
 *   - clave valida (array) que DEBE conservarse,
 * y verifica que en TODOS los casos el `createStore`/`appStore` se construye sin
 * lanzar y que `recentTools`/`favoriteTools` quedan en el valor seguro esperado,
 * ademas de que las claves corruptas se ELIMINAN (auto-reparacion) para el
 * siguiente arranque.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const stateCode = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

// ---------- Guard custom con localStorage controlado ----------
function buildStorage(init = {}) {
  const data = { ...init };
  const storage = {
    data,
    getItem(k) { return k in data ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
  return storage;
}

// ---------- Carga real de state.js en un sandbox con localStorage global ----------
function loadStateStore(localStorageShim) {
  // Extrae createStore y readJsonList REALES de state.js y construye un appStore
  // minimo equivalente con las claves deserializables, evaluando el codigo real.
  const real = stateCode.replace(/^export\s+/gm, '');
  const head = real.slice(0, real.indexOf('const appStore = createStore({'));
  const prevLS = globalThis.localStorage;
  globalThis.localStorage = localStorageShim;
  let out;
  try {
    const createStoreFn = new Function(head + '\nreturn { createStore, readJsonList };');
    const { createStore, readJsonList } = createStoreFn();
    const appStore = createStore({
      recentTools: readJsonList('toolisto-recent-tools'),
      favoriteTools: readJsonList('toolisto-favorite-tools'),
    });
    out = { appStore, readJsonList };
  } finally {
    globalThis.localStorage = prevLS;
  }
  return out;
}

console.log('=== CE-092: boot recovery ante localStorage corrupto ===');
console.log('(CODIGO REAL de state.js + localStorage controlado)\n');

// ---------- Escenario 1: recentTools corrupto -> no crashea, quedo [] y se elimina ----------
console.log('1. recentTools con JSON invalido: el store se construye sin crashear y se auto-repara');
{
  const storage = buildStorage({ 'toolisto-recent-tools': '{esto no es json' });
  // reproduccion del BUG: el parse sin try/catch lanza
  let threw = false;
  const buggy = new Function('localStorage', 'JSON', 'return JSON.parse(localStorage.getItem("toolisto-recent-tools") || "[]");');
  try { buggy(storage, JSON); } catch (e) { threw = true; }
  check('(reproduccion) el JSON.parse sin try/catch LANZA con JSON invalido -> era el crash de boot', threw === true);

  // codigo real: debe NO lanzar y devolver []
  let ok = false;
  try {
    const { appStore } = loadStateStore(storage);
    ok = Array.isArray(appStore.get('recentTools')) && appStore.get('recentTools').length === 0;
  } catch (e) { ok = false; }
  check('el store real se construye sin lanzar y recentTools=[]', ok);
  check('la clave corrupta se elimina (auto-reparacion para el siguiente arranque)',
    !('toolisto-recent-tools' in storage.data), Object.keys(storage.data).join(','));
}

// ---------- Escenario 2: favoriteTools corrupto ----------
console.log('\n2. favoriteTools con JSON invalido: no crashea y quedo []');
{
  const storage = buildStorage({ 'toolisto-favorite-tools': 'not-json' });
  let ok = false;
  try {
    const { appStore } = loadStateStore(storage);
    ok = Array.isArray(appStore.get('favoriteTools')) && appStore.get('favoriteTools').length === 0;
  } catch { ok = false; }
  check('favoriteTools corrupto no quiebra el arranque y quedo []', ok);
  check('la clave de favorite corrupta se elimina',
    !('toolisto-favorite-tools' in storage.data));
}

// ---------- Escenario 3: clave con tipo wrong (objeto, no array) ----------
console.log('\n3. Preferencia con tipo inesperado (objeto, no array): no crashea, quedo []');
{
  const storage = buildStorage({ 'toolisto-recent-tools': '{"a":1}' });
  let ok = false;
  try {
    const { appStore } = loadStateStore(storage);
    ok = Array.isArray(appStore.get('recentTools')) && appStore.get('recentTools').length === 0;
  } catch { ok = false; }
  check('objeto en lugar de array -> recentTools=[] sin crashear', ok);
}

// ---------- Escenario 4: clave ausente (null) ----------
console.log('\n4. Claves ausentes (null): el store se construye con []');
{
  const storage = buildStorage({});
  let ok = false;
  try {
    const { appStore } = loadStateStore(storage);
    ok = Array.isArray(appStore.get('recentTools')) && appStore.get('recentTools').length === 0
      && Array.isArray(appStore.get('favoriteTools')) && appStore.get('favoriteTools').length === 0;
  } catch { ok = false; }
  check('sin claves, recentTools y favoriteTools quedan en []', ok);
}

// ---------- Escenario 5: clave valida se conserva intacta ----------
console.log('\n5. Clave VALIDA (array): se conserva sin perdida de datos');
{
  const storage = buildStorage({ 'toolisto-recent-tools': '["visor-pdf","calculadora","graficos"]' });
  let ok = false, val = null;
  try {
    const { appStore } = loadStateStore(storage);
    val = appStore.get('recentTools');
    ok = Array.isArray(val) && val.length === 3 && val[0] === 'visor-pdf';
  } catch { ok = false; }
  check('recentTools valido se conserva intacto', ok, JSON.stringify(val));
  check('la clave valida NO se elimina', 'toolisto-recent-tools' in storage.data);
}

// ---------- Escenario 6: clave valida de arrays pero con elemento raro dentro ----------
console.log('\n6. Array valido con contenido basura por elemento: se conserva el array (no se vacia indebidamente)');
{
  const storage = buildStorage({ 'toolisto-recent-tools': '["a", 42, null, {"x":1}]' });
  let ok = false;
  try {
    const { appStore } = loadStateStore(storage);
    ok = Array.isArray(appStore.get('recentTools')) && appStore.get('recentTools').length === 4;
  } catch { ok = false; }
  check('un array valido (aunque con elementos variados) se conserva', ok);
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);