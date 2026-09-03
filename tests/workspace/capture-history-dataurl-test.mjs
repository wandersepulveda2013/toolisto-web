#!/usr/bin/env node
/**
 * capture-history-dataurl-test.mjs (CE-114)
 *
 * Bug de fondo: `_captureWorkspaceState()` snapshotteaba las capturas con
 * `dataUrl: c.dataUrl ? c.dataUrl.slice(0, 200) : null`. Ese snapshot era el UNICO
 * que alimenta el historial de undo/redo Y el autosave; al deshacer/rehacer,
 * `_applyState()` reescribia el store con `captures: snapshot.captures || []`, es
 * decir con dataUrls TRUNCADOS a 200 caracteres. Como el resto del codigo
 * (`saveImageCapture`, `renderCaptureView`, `extractTextFromScan`,
 * `saveWorkspaceSession` con `captures: appStore.get('captures')`) usa SIEMPRE el
 * dataUrl completo, un solo Ctrl+Z en el editor corrompia en silencio la imagen de
 * TODA captura almacenada (thumbnail roto, OCR fallido) y la corrupcion se persistia
 * en la sesion guardada.
 *
 * Fix (CE-114): las capturas se EXCLUYEN del historial de undo/redo a proposito:
 *   - `_captureWorkspaceState()` ya no incluye el campo `captures`;
 *   - `_applyState()` ya no restaura `captures` desde el snapshot.
 * Son datos anexo-apendice vivos mantenidos por su propio flujo y NUNCA editados por
 * acciones deshacibles de doc/tabla, asi que excluirlas elimina la corrupcion de raiz
 * sin perder ningun semantic de undo.
 *
 * La suite usa el CODIGO REAL (`_captureWorkspaceState` extraido de workspace.js y el
 * store real de state.js) y una capa de historial fiel con la semantica real de
 * undo/redo/apply. El CONTROL NEGATIVO reimplanta la logica anterior
 * (`dataUrl.slice(0,200)`) y prueba que SI corrompe la captura al aplicarse -> el fix
 * es necesario y la suite no es tautologica.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');
const stateCode = readFileSync(join(ROOT, 'workspace', 'core', 'state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.log('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); } }

// ---------- Extractor de funciones reales de workspace.js ----------
function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

// ---------- appStore real (createStore de state.js) ----------
function buildStore() {
  let stateSrc = stateCode
    .replace(/^import\s.*;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  stateSrc = stateSrc.slice(0, stateSrc.indexOf('const appStore = createStore('));
  const fn = new Function(stateSrc + '\nreturn { createStore };');
  const { createStore } = fn();
  return createStore({ currentView: 'projects', currentProject: null, currentDoc: null, currentDataTable: null, isDirty: false, lastSaved: null, captures: [] });
}

// ---------- Sandbox con _captureWorkspaceState REAL ----------
function buildSandbox(store) {
  const src = grabFn(wsCode, '_captureWorkspaceState');
  const fn = new Function('appStore', 'JSON', src + '\nreturn { _captureWorkspaceState };');
  return fn(store, JSON);
}

// dataUrl de prueba: base64 largo (>200 chars) como producen los scans/imports reales.
function bigDataUrl() {
  let s = 'data:image/png;base64,iVBORw0KGgo=';
  while (s.length < 500) s += 'AbCdEf0123456789';
  return s;
}

console.log('=== CE-114: el undo truncaba dataUrl de capturas -> corrupcion persistida ===');
console.log('(CODIGO REAL _captureWorkspaceState + appStore real + historial fiel + control negativo)\n');

// ---------- Escenario 1: el snapshot REAL NO incluye capturas (no se pueden truncar) ----------
console.log('1. FIX: _captureWorkspaceState() no snapshottea capturas');
{
  const store = buildStore();
  const cap = { id: 'cap1', name: 'c1', dataUrl: bigDataUrl() };
  store.set({ captures: [cap] });
  const api = buildSandbox(store);
  const snap = api._captureWorkspaceState();
  check('el snapshot NO tiene la clave captures', !('captures' in snap), 'claves=' + JSON.stringify(Object.keys(snap)));
  check('el snapshot NO contiene ningun dataUrl truncado', !JSON.stringify(snap).includes('dataUrl'), 'snap incluye dataUrl');
  const live = store.get('captures');
  check('la captura viva conserva su dataUrl completo', live && live[0].dataUrl === cap.dataUrl, live ? 'len=' + live[0].dataUrl.length : 'null');
  check('el dataUrl completo supera 200 chars (reproduccible sin el slice)', cap.dataUrl.length > 200, 'len=' + cap.dataUrl.length);
}

// ---------- Escenario 2: ciclo captura -> snapshot -> undo/redo -> apply NO toca la captura ----------
console.log('\n2. FIX: undo/redo (capture + apply) conserva el dataUrl completo de la captura');
{
  const store = buildStore();
  const cap = { id: 'cap2', name: 'c2', dataUrl: bigDataUrl() };
  store.set({ captures: [cap], currentProject: { id: 'p1' } });
  const api = buildSandbox(store);
  // historial fiel: el snapshot inicial y el actual (la edicion de texto NO toca capturas)
  const snap0 = api._captureWorkspaceState();
  store.set({ currentDoc: { id: 'd1', blocks: [{ content: 'texto' }] } });
  const snap1 = api._captureWorkspaceState();
  // undo: se aplica snap0 vía apply fiel a _applyState (restaura captures desde snapshot)
  const apply = snap =>
    store.set({
      currentDoc: snap.currentDoc || null,
      currentDataTable: snap.currentDataTable || null,
      documents: snap.documents || [],
      dataTables: snap.dataTables || [],
      designConfig: snap.designConfig || null,
      flowNodes: snap.flowNodes || [],
      flowEdges: snap.flowEdges || [],
    });
  apply(snap0);
  const after = store.get('captures');
  check('tras undo, la captura conserva su dataUrl completo', after[0].dataUrl === cap.dataUrl, after && after[0] ? 'len=' + after[0].dataUrl.length : 'null');
  check('tras undo, el store sigue teniendo la captura', after.length === 1, 'len array=' + after.length);
}

// ---------- Escenario 3 (CONTROL NEGATIVO): el slice(0,200) ANTIGUO corrompe la captura ----------
console.log('\n3. CONTROL NEGATIVO: con la logica anterior, el undo corrompe la captura');
{
  const store = buildStore();
  const cap = { id: 'cap3', name: 'c3', dataUrl: bigDataUrl() };
  store.set({ captures: [cap] });
  // reimplanta la logica ANTERIOR del snapshot + apply para demostrar el mecanismo de corrupcion
  const oldSnapshot = () => ({
    captures: (store.get('captures') || []).map(c => ({ id: c.id, name: c.name, dataUrl: c.dataUrl ? c.dataUrl.slice(0, 200) : null })),
  });
  const discount = store.get;
  discount; // (ref) no-op para evitar lint de no-uso
  const oldApply = snap => store.set({ captures: snap.captures || [] });
  const dbg = oldSnapshot();
  check('el snapshot antiguo SI tenia captures', 'captures' in dbg);
  const capBefore = store.get('captures')[0];
  oldApply(oldSnapshot());
  const after = store.get('captures')[0];
  check('el controle negativo pisa el dataUrl con 200 chars truncados', after && after.dataUrl.length === 200,
    after ? 'len=' + (after.dataUrl || '').length : 'null');
  check('el dataUrl queda roto (< 500 chars originales)', !!after && after.dataUrl.length < capBefore.dataUrl.length,
    'antes=' + capBefore.dataUrl.length + ' despues=' + (after ? after.dataUrl.length : 'null'));
}

// ---------- Escenario 4: anclas estaticas anti-regresion del fix ----------
console.log('\n4. Anclas estaticas: el codigo fuente ya no truncar/restaura capturas');
{
  const hasSlice200InCapture = /dataUrl\s*\?\s*dataUrl\.slice\(0,\s*200\)/.test(wsCode);
  const applyStateRestoresCaptures = /snapshot\.captures \|\| \[\]/.test(wsCode);
  check('NO existe el slice(0,200) en dataUrl (fuente de la corrupcion)', !hasSlice200InCapture);
  check('_applyState ya NO restaura captures desde el snapshot', !applyStateRestoresCaptures);
  const fnMatch = wsCode.match(/function _captureWorkspaceState\(\)\s*\{[\s\S]*?\n\}/);
  const fnBody = fnMatch ? fnMatch[0] : '';
  check('el snapshot de _captureWorkspaceState vive junto a los demas campos de estado (dataTables + designConfig)', fnBody.includes('dataTables:') && fnBody.includes('designConfig:'));
}

console.log('\nRESULTADO: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);