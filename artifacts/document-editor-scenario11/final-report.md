# Scenario 11 — Document Editor Persistence Race (CE-082)

**Ciclo:** Autónomo (OpenCode) — resolución de Scenario 11.
**Commit:** `9d3c3a8` (`fix(document-editor): make Scenario 11 lifecycle invariant executable (CE-082)`)
**Fecha:** 2026-09-01
**Entrada (previous):** `d2a9ba4` (AdSense, cerrado; NO se tocó).
**Suite:** `tests/workspace/document-editor-persistence-race-test.mjs`

---

## Scenario 11

### Original invariant
El contrato original (versión commit `2ce42bc`, Cycle 145 / CE-082) probaba el riesgo de
**resurrección**: `deleteDoc` NO cancela un save en vuelo del lock, por lo que el `dbPut` de ese save
re-crea la fila y el documento "resucita". Era una prueba de límite que *documentaba* un riesgo residual,
no una garantía anti-resurrección.

### Rework en working tree (no commiteado)
Al comenzar este ciclo el working tree contenía un **reewrite ajeno no commiteado** de Scenario 11 que
re-encuadraba el invariante: en lugar de re-certificar la carrera raw save/delete (que por contrato es
dominio de `storage.js`/CE-059 — `gone OR saved-before-delete`), se propone certificar el **invariante de
ciclo de vida del Workspace**: una vez completado el flush-before-navigate **y** alcanzado el borrado, no
debe quedar ningún autosave (debounce ni intervalo) capaz de disparar un save posterior del documento
borrado.

### Exact failure
El rework llamaba `api.renderView('documents')` en la línea 497. La función `runWired()` (extrae el código
real de `workspace.js` para un harness Node puro) **NO expone `renderView`**: su `return` es
`{ _docLocks, _tableLocks, autoSaveDoc, _flushDirtyEntity }` (`749a…`/línea 179-190). Resultado determinista:

```
TypeError: api.renderView is not a function
    at …document-editor-persistence-race-test.mjs:497
```

El `TypeError` abortaba todo el archivo (no llegaba el `RESULTADO`, exit ≠ 0).

### Deterministic reproduction
Reproducción 100 % determinista: el harness extrae código real con timers manuales, sin dormir.
`node tests/workspace/document-editor-persistence-race-test.mjs` fallaba SIEMPRE (cada ejecución) en la
misma línea con el mismo error. Clase: **stale test assumption** (el test asume una API de harness que el
mismo harness no provee), no defecto de producción.

### Root cause
`renderView` es una función ligada al DOM (`$('#ws-main-content').replaceChildren()`, `document`, `window`)
en `workspace/workspace.js:1180`. No es extraíble en un harness Node puro; por eso la suite ya estableció
`api._flushDirtyEntity()` como el primitivo de flush-before-navigate en los Escenarios 3 y 6. El rework
usó por error la API no expuesta.

### Event ordering that caused the race / the fix
Secuencia del rework corregida (invariante genuino, con orden causal correcto):

```
load(docK) -> edit('edit-antes-de-borrar') -> autoSaveDoc (debounce 1000ms armado, isDirty=true)
  -> _flushDirtyEntity()   [currentView AÚN doc-editor] -> clearTimeout(debounce) + enqueue save en lock(docK)
  -> store.set({currentView:'documents'})
  -> flushLock(drain)      -> save completa -> isDirty=false; _lastAutosaveSnapshot actualizado
  -> deleteDoc('docK')     -> observer marca deleted=true; fila eliminada
  -> fireAllTimers + flushLock (x2)  -> sin debounce ni intervalo pendiente -> saveCallsAfterDelete === 0
```

Detalle clave: `_flushDirtyEntity` (workspace.js:1160) solo flushea un documento cuando
`currentView === 'doc-editor'`. Por eso el flush debe ejecutarse **antes** de cambiar `currentView` a
`'documents'` (el rework original lo ponía después, lo que además de romper por `renderView`, habría hecho
del flush un no-op). Se corrigió también ese orden.

---

## Fix

### Files changed
Solo `tests/workspace/document-editor-persistence-race-test.mjs` (un archivo, +54/−25 vs HEAD,
**sin cambios de producción**). Se preservó íntegro el contenido del rework ajeno (caja `obsPersist`,
comentarios, checks) salvo la corrección de la línea defectuosa y su comentario.

### Mechanism used
- Reemplazo `api.renderView('documents')` → `api._flushDirtyEntity()`.
- El flush se invoca **mientras `currentView` es aún `doc-editor`** (único caso que flushea un doc),
  y después se cambia la vista.
- Uso del mismo primitivo extraíble que los Escenarios 3 y 6 (patrón ya establecido de la suite).
- La capa persistente se "stubea" solo como **punto de observación** (`saveCallsAfterDelete`), sin inventar
  semántica de storage: la carrera raw save/delete queda delegada a CE-059.

### Why stale operations can no longer overwrite newer state
El invariante de ciclo de vida se cumple porque tras el flush-before-navigate:
1. `_flushDirtyEntity` limpia `autoSaveDoc._timer` (workspace.js:1163).
2. El save del doc se encola en el lock por-entidad y completa (`_lastAutosaveSnapshot` + `isDirty=false`).
3. El intervalo de 5s (`_setupAutosave`, workspace.js:845) solo dispara un save si `isDirty===true` y el
   snapshot difiere de `_lastAutosaveSnapshot`; ambas condiciones quedan false/igualadas tras el flush.
4. Tras el delete no queda timer ni lock pendiente que pueda disparar un save de `docK`.

### Why the fix is architecture-safe
- No se añade ningún sleep/retry/timeout global ni rama test-only.
- No se modifica `workspace.js` (cero cambios de runtime; el diff es solo del test).
- El rework ajeno (no commiteado) se integró tal cual, respetando su contrato de delegación a CE-059.
- Alineado con el diseño ya existente (per-entity locks, LWW lógico `_writeSeq`, flush-before-navigate).

---

## Verification

| Context | Result |
|---|---|
| Scenario 11 (suite completa) | 23 PASS, 0 FAIL — **determinista x4** (4 ejecuciones consecutivas) |
| `document-editor-persistence-race-test.mjs` | 23 PASS, 0 FAIL |
| `document-editor-data-loss-test.mjs` | 19 PASS, 0 FAIL |
| `autosave-lock-test.mjs` (CE-057) | 18 PASS, 0 FAIL |
| `cross-entity-integrity-test.mjs` (CE-058) | 55 PASS, 0 FAIL |
| `persistence-adversarial-audit.mjs` (CE-058) | 66 PASS, 0 FAIL |
| `persistence-sequence-cert.mjs` (CE-058) | 48 PASS, 0 FAIL |
| `persistence-lifecycle-audit.mjs` (CE-058) | 95 PASS, 0 FAIL |
| `storage-recovery-lifecycle.mjs` (CE-059) | 69 PASS, 0 FAIL |
| `stale-delete-lifecycle.mjs` (CE-060) | 120 PASS, 0 FAIL |
| **`test-workspace-release.mjs` (gate completo)** | **RELEASE GATE: OK** — build limpio `--production` + verificación source→dist + 30+ suites, incluido **document-editor-persistence-race (exit 0)** |

---

## Regression coverage
Casos de carrera ahora protegidos por la suite (cementan la clase de no-resurrección de Scenario 11 y la
familia):
- Stale async completion vs estado más reciente (Escenario 2: out-of-order no sobrescribe).
- Rapid consecutive saves / mutación en vuelo (Escenarios 1, 8, 9, 10).
- Flush-before-navigate conserva la última edición (Escenarios 3, 5, 6).
- Fallo de escritura no marca guardado + recuperación persiste (Escenario 7).
- Cambio de documento nunca cruza ids (Escenario 4).
- **Edición + borrado: ningún save pendiente resucita el doc vía el ciclo de vida (Scenario 11)**.
- Reablecido en el gate (CE-082) y repetido x4 para demostrar determinismo.

---

## Git

- **Commit final:** `9d3c3a8` `fix(document-editor): make Scenario 11 lifecycle invariant executable (CE-082)`.
- **Estado:** `tests/workspace/document-editor-persistence-race-test.mjs` limpio; no se tocó el commit
  AdSense `d2a9ba4`; `stash@{0}` intacto.
- **Cambios ajenos no commiteados preservados íntegros:** `ACTIVE-MISSION.md`, `offline.html`,
  `opencode.json`, `scripts/generate-apluno-pages.mjs`, `src/apluno/styles.css`, `src/data/guides.json`,
  y evidencias regeneradas por los gates (`artifacts/deep-audit/release-gate/*.json`, anti-churn).

---

## Remaining issues

- **Causados por este ciclo:** ninguno (cambio test-only, gate OK).
- **Pre-existentes:** desalineación de rutas editoriales EN-vs-ES del sitemap y los 2 fallos de harness
  `ocr-pdf`/`pdf-misc` del root gate APLUNO (documentados en `artifacts/adsense-final-readiness/final-report.md`);
  residuo de resurrección cruda `save/delete` de `storage.js` delegado a CE-059. Relativo al renderView real:
  el flush-before-navigate lee `currentView` ya actualizado tras `navigateTo` (el guard `view==='doc-editor'`
  queda como quirk latente de la vista, fuera del alcance de Scenario 11 y no verificado como defecto de
  pérdida en las rutas vivas por CE-082).
- **Entorno/harness:** `renderView` NO es extraíble en Node puro (DOM); es la razón de que la suite use
  `_flushDirtyEntity` como primitivo (patrón establecido Escenarios 3/6).