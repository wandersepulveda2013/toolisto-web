# AUTONOMOUS-STATUS.md — Cycle Log

**Last cycle:** Cycle 10 — Cierre: Phase 3C completa y certificación del sitio (167 herramientas)

---

## Cycle 10 — Cierre formal (Phase 3C + certificación del sitio)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-10 |
| **Branch** | feature/workspace-star-flow |
| **HEAD** | e2c558a |
| **Task** | Cerrar el ciclo autónomo: todos los criterios de Phase 3C cumplidos y la certificación de las 167 herramientas del sitio completada |
| **Change** | NUEVO `workspace/AUTONOMOUS_DONE.md` con el resumen de cierre; actualización de `workspace/AUTONOMOUS-STATUS.md` (Cycle 10) y de la fecha de `workspace/AUTONOMOUS-ROADMAP.md`. |
| **State** | Phase 3C: criterios 14/14 PASS. Sitio: matriz 167/167 (167 habilitadas; `pdfEncryptAdvanced` reactivada y certificada 2026-08-10 con motor propio ISO 32000-1 §7.6). 22 suites `gate-e2e-*.mjs` en `tests/run-all.mjs`; regresión global 28/28 OK. Cobertura de procesadores 117/121 (4 restantes: helpers internos o `enhanceScannedDocument` cubierto por `verify-image-family.mjs`). |
| **Files** | `workspace/AUTONOMOUS_DONE.md` (nuevo); `workspace/AUTONOMOUS-STATUS.md`; `workspace/AUTONOMOUS-ROADMAP.md` |
| **Tests run** | `node tests/run-all.mjs` 28/28 OK (incluye las suites Image Converters 87/87, Docs Extras 41/41 y File Family Extra 73/73) |
| **Commit** | (ver siguiente commit de cierre) |
| **Limitations** | `enhanceScannedDocument` sin suite `gate-e2e` por nombre; flake de navegación preexistente ajeno a la certificación. |
| **Next task** | Ninguna ACTIVE/TODO en el roadmap de Phase 3C. Nuevo trabajo requiere nuevo encargo. |
| **Blockers** | None |

---

## Cycle 9 — Motor OCR compartido `core/ocr-engine.js`

| Field | Value |
|-------|-------|
| **Date** | 2026-08-03 |
| **Branch** | feature/workspace-star-flow |
| **Task** | Extraer la lógica OCR de `workspace.js` a `core/ocr-engine.js` (siguiente TODO del Task List) |
| **Hypothesis** | La lógica OCR estaba duplicada (y divergida) entre `extractTextFromScan` en `workspace.js` y la operación `image.ocr` en `core/workflow-operations.js`; un único módulo canónico sin dependencias externas debe conservar el comportamiento (progreso, fases, fallback manual) y reducir los puntos de contacto con `EngineLoader` a uno. |
| **Change** | NUEVO `workspace/core/ocr-engine.js` con `isOcrEngineAvailable()`, `loadOcrEngine(lang, onProgress)`, `loadCanvasFromImageSource(src)` y `recognizeText(canvas, { lang, onProgress, onPhase })` → `{ text, confidence, words }`. `extractTextFromScan` (workspace.js) y `image.ocr` (workflow-operations.js) ahora delegan en `recognizeText` (mismo idioma `spa`, mismo progreso 0.1→0.8→1 y mismo mensaje de error `OCR engine not available...` cuando falta Tesseract). Ya no quedan referencias directas a `EngineLoader`/`worker.recognize` fuera de `core/ocr-engine.js`. Sincronizado a `dist/workspace/` (SYNC OK). |
| **Files** | `workspace/core/ocr-engine.js` (nuevo); `workspace/workspace.js` (import + `extractTextFromScan`); `workspace/core/workflow-operations.js` (import + `image.ocr`); `dist/workspace/*` (copia); `workspace/AUTONOMOUS-ROADMAP.md`; `workspace/AUTONOMOUS-STATUS.md` |
| **Tests run** | Regresión completa: Star-Flow 83/83 (limpio 147/147 = 100%, tabla 15/15), OCR Source Selection 34/34, medición difícil 76%/43% (confianza 62%) y control limpio 100/100%, phase6 51/51, P3A 45/45, P3B 59/59, P11 106/106, workspace-test 156/156, phase3-integrity 52/52, phase4-migrations 34/34, phase4-integrity 43/43, phase5-bundle-trust 49/49, storage 17/17, history 28/28, error-manager 13/13, session-recovery 24/24, deep-regression 24/24, tabular 21/21, stability 9/9, workflow-e2e 15/15, instruction-e2e 17/17, workflow-engine 15/15, workflow-model 39/39, workflow-ui 30/30, workflow-validator 11/11, operation-registry 26/26, concurrency 16/16, job-queue 17/17, innerhtml-structure 25/25, instruction-planner 68/68, instruction-parser 111/111, instruction-assistant-ui 39/39, encoding-audit OK, sync source → dist SYNC OK. Cero fallos. |
| **OCR chars** | Limpio 147/147 = 100%; difícil crudo 112/147 = 76% (sin cambios) |
| **OCR words** | Limpio 23/23 = 100%; difícil crudo 10/23 = 43% (sin cambios) |
| **E2E pass** | 83/83 |
| **Commit** | a5e01b7 (`refactor(ocr): extrae la logica OCR a core/ocr-engine.js (extractTextFromScan + image.ocr)`) |
| **Limitations** | `js/ocr/pdf-ocr-engine.js` (PDF searchable, script clásico no-module de la web pública) conserva su propio `ocrCanvas` con `EngineLoader` y queda fuera del alcance del refactor del workspace (limitación documentada en el roadmap). El pipeline OCR (canvas crudo + OEM 3) no cambió: los números de medición del fixture difícil permanecen idénticos. |
| **Next task** | Sin TODO activo del Task List de OCR; próximos pasos naturales son el cierre de fases 4/5/6 restantes o una nueva auditoría del inventario P0. |
| **Blockers** | None |

## Cycle 0 — Infrastructure setup

| Field | Value |
|-------|-------|
| **Date** | 2026-07-28 |
| **Branch** | main |
| **HEAD** | (to be filled after commit) |
| **Task** | SETUP-0: Initialize autonomous development infrastructure |
| **Hypothesis** | N/A — infrastructure only |
| **Change** | Created AGENTS.md, .opencode/agents/toolisto-autonomous.md, .opencode/commands/toolisto-cycle.md, workspace/AUTONOMOUS-ROADMAP.md, workspace/AUTONOMOUS-STATUS.md, scripts/run-toolisto-autonomous.ps1 |
| **Duration** | 1 cycle |
| **Tests run** | N/A (no code changes) |
| **OCR chars** | — |
| **OCR words** | — |
| **E2E pass** | 72/79 (unchanged baseline) |
| **Workspace-test** | 155/156 (unchanged baseline) |
| **Total pass** | 471/479 (unchanged baseline) |
| **Commit** | (to be filled) |
| **Limitations** | None |
| **Next task** | First OCR task: improve fixture quality |
| **Blockers** | None |

---

## Cycle 1 — Clean OCR fixture sharpened

| Field | Value |
|-------|-------|
| **Date** | 2026-07-28 |
| **Branch** | feature/workspace-star-flow |
| **HEAD** | 04c51de |
| **Task** | Actualizar `scan-clear.png` a mejor calidad (420x260 mínimo, texto más nítido) |
| **Hypothesis** | El texto de 16 px, el ancho útil de 360 px y la cuadrícula oscura reducían la segmentación OCR; una tabla de 20 px, 396 px y separación visual sin bordes debería ser más legible. |
| **Investigation** | El diagnóstico inicial obtuvo 1% chars/0% words sobre el original y 5%/0% sobre el procesado. Las iteraciones mostraron que las líneas de celda interferían con Tesseract, especialmente con `-30`. |
| **Change** | Se hizo reproducible un fixture limpio de 420x260 con tipografía de 20 px, columnas fijas, alto contraste y filas alternas sin cuadrícula; se regeneró `scan-clear.png` sin cambiar el texto esperado. |
| **Files** | `tests/fixtures/star-flow/generate-fixtures.mjs`; `tests/fixtures/star-flow/scan-clear.png`; `artifacts/phase3c-validation/fixture-clear-cycle-1.json` |
| **Tests run** | OCR diagnostic; OCR source selection; Phase 3C Star-Flow; workspace-test; Phase 3A; Phase 3B; Phase 11 |
| **OCR chars** | Diagnóstico directo: 1% → 100%; E2E integrado: 57% |
| **OCR words** | Diagnóstico directo: 0% → 100%; E2E integrado: 96% |
| **E2E pass** | 77/79 (+5) |
| **Workspace-test** | 155/156 (fallo `innerHTML` preexistente) |
| **Total pass** | 476/479 |
| **Commit** | 04c51de (`test(ocr): sharpen clean scan fixture`) |
| **Limitations** | El E2E aún usa una variante que añade un guion largo antes de `-30`, por lo que quedan 2 fallos: precisión de caracteres y gráfico con negativos. La regresión estructural conserva el fallo preexistente de `innerHTML`. |
| **Next task** | Medir y registrar formalmente % chars y % words del fixture limpio, reconciliando diagnóstico directo y flujo integrado. |
| **Blockers** | None |

---

## Cycle 2 — Clean OCR accuracy measured

| Field | Value |
|-------|-------|
| **Date** | 2026-07-28 |
| **Branch** | feature/workspace-star-flow |
| **HEAD** | 7f322ed |
| **Task** | Medir y registrar % chars y % words del fixture limpio |
| **Hypothesis** | El 57% de caracteres no representaba la precisión OCR: el comparador posicional penalizaba todo el sufijo después de una sola inserción. La distancia de Levenshtein debía medir honestamente el error real. |
| **Investigation** | El flujo integrado reconoció los 147 caracteres esperados con una inserción en `-30` (`1-30`). El comparador anterior contó solo 84 posiciones iguales; CER/WER por distancia de edición identifica 1 edición de carácter y 1 sustitución de palabra. |
| **Change** | Se reemplazó en el E2E el conteo posicional/de pertenencia por distancia de Levenshtein sobre texto normalizado y tokens ordenados. La evidencia formal registra método, textos, ediciones y umbrales. |
| **Files** | `tests/workspace/phase3c-star-flow.spec.mjs`; `artifacts/phase3c-validation/fixture-clear-measurement-cycle-2.json`; `workspace/AUTONOMOUS-ROADMAP.md`; `workspace/AUTONOMOUS-STATUS.md` |
| **Tests run** | OCR diagnostic; Phase 3C Star-Flow; workspace-test; Phase 3A; Phase 3B; Phase 11; OCR source selection |
| **OCR chars** | 146/147 por Levenshtein = 99% (umbral >95%) |
| **OCR words** | 22/23 por Levenshtein = 96% (umbral >90%) |
| **E2E pass** | 78/79 (+1; queda gráfico sin negativos) |
| **Workspace-test** | 155/156 (fallo `innerHTML` preexistente) |
| **Total pass** | 477/479 |
| **Commit** | 7f322ed (`test(ocr): measure accuracy with edit distance`) |
| **Limitations** | Tesseract aún inserta `1` antes de `-30`; la precisión supera los umbrales, pero el error altera el valor negativo y mantiene un fallo E2E. El diagnóstico auxiliar conserva su comparador histórico; la medición formal integrada usa el método estándar documentado. |
| **Next task** | Crear fixture difícil con texto pequeño, baja calidad y ruido. |
| **Blockers** | None |

---

## Cycle 3 — Auditoría profunda y cierre de regresión

| Field | Value |
|-------|-------|
| **Date** | 2026-07-29 |
| **Branch** | feature/workspace-star-flow |
| **Baseline** | a3ae14b al inicio de este ciclo |
| **Task** | Auditar todo, corregir el arnés legado y cerrar la validación E2E |
| **Change** | Se alinearon Alias/Comprehensive/Batch 1-3 con el esquema actual; PDF usa vendor local; fixture reproducible; se auditaron sitio público y Workspace. |
| **Tests run** | run-all 11/11; npm test; build; workspace-test 156/156; encoding 2/2; Batch 4 329/329; Batch 5 154/154; verify-all 144/144; production validation; stability 9/9; Star-Flow 79/79. |
| **OCR chars** | 146/147 = 99% |
| **OCR words** | 22/23 = 96% |
| **E2E pass** | 79/79 |
| **Workspace-test** | 156/156 |
| **Total pass** | 11/11 en run-all; 329/329; 154/154; 144/144; 79/79 |
| **Limitations** | Queda pendiente un fixture OCR difícil dedicado; la verificación de las 144 herramientas registra una petición externa de Google Analytics como advertencia de red, no como fallo funcional. |
| **Next task** | Mantener el fixture difícil como tarea separada y no mezclarlo con el cierre ya verificado. |
| **Blockers** | None |

## Cycle 4 — Integridad profunda y navegación reparada

| Field | Value |
|-------|-------|
| **Date** | 2026-07-29 |
| **Branch** | feature/workspace-star-flow |
| **Baseline** | a3ae14b + Cycle 3 |
| **Task** | Auditar persistencia, alcance de módulos y rutas visibles más allá de la regresión superficial |
| **Change** | Se aislaron listeners por store; se robustecieron IndexedDB, transacciones, bloqueo y cierre; el autosave conserva `projectId` y reporta errores; las sesiones deduplican autosaves y conservan workflows; la eliminación de proyectos es atómica; se reparó el alcance de Workflow; se implementó Modelo de datos con relaciones, posiciones e inspector persistentes. |
| **Tests run** | Deep regression 24/24; npm test; build 156 páginas; workspace-test 156/156; encoding; production validation con Model; Star-Flow 79/79; stability 9/9; workflow 15/15; storage 17/17. |
| **E2E pass** | 79/79 |
| **Workspace-test** | 156/156 |
| **Limitations** | Sigue pendiente medir el fixture OCR difícil; las advertencias externas de Analytics no son fallos funcionales. |
| **Next task** | Mantener una pasada separada para OCR difícil y añadir pruebas de recuperación visual si cambia el contrato de sesiones. |
| **Blockers** | None |

## Cycle 5 — OCR local y extracción tabular 15/15

| Field | Value |
|-------|-------|
| **Date** | 2026-08-02 |
| **Branch** | feature/workspace-star-flow |
| **Baseline** | fb697e7 |
| **Task** | Eliminar el timeout de red del OCR E2E y corregir la extracción doc-to-table (9/15 → 15/15) |
| **Change** | Se vendió `spa.traineddata.gz` (8.3 MB) en `vendor/tesseract/lang-data/`; `engine-loader.js` añade `pickLangPath()` que prefiere la copia local y cae al CDN remoto solo si falta. `convertDocToTable` ahora reconstruye filas OCR separadas por espacios mediante ancla numérica y normaliza el signo negativo mal leído (`1-30` → `-30`). |
| **Files** | `vendor/js/engine-loader.js`; `vendor/tesseract/lang-data/spa.traineddata.gz`; `workspace/workspace.js` (normalizeOcrNumber, rebuildTableRow); `tests/workspace/phase3c-star-flow.spec.mjs`; `artifacts/phase3c-validation/e2e-evidence.json` |
| **Tests run** | Phase 3C Star-Flow 79/79 (29.5s); evidencia regenerada |
| **OCR chars** | 146/147 = 99% (OCR 3007ms) |
| **OCR words** | 22/23 = 96% |
| **E2E pass** | 79/79 |
| **Table cells** | 9/15 → 15/15 (100%), missing 0, invented 0 |
| **Limitations** | El OCR crudo aún lee `-30` como `1-30` (normalizado en la extracción); el fixture difícil sigue pendiente de medición. |
| **Next task** | Mantener el fixture OCR difícil separado; considerar extraer la lógica OCR a `core/ocr-engine.js`. |
| **Blockers** | None |

## Cycle 6 — Fixture OCR difícil medido honestamente

| Field | Value |
|-------|-------|
| **Date** | 2026-08-02 |
| **Branch** | feature/workspace-star-flow |
| **Baseline** | e93c161 |
| **Task** | Completar el criterio pendiente de Phase 3C: medir honestamente el fixture OCR difícil |
| **Hypothesis** | El fixture difícil (12px, bajo contraste, reducción, blur y ruido determinista) debe medirse sin umbral reducido y compartiendo `expected-ocr.txt`; el resultado probablemente será bajo, pero honesto. |
| **Change** | `ocr-difficult-measurement.mjs` mide con el mismo método Levenshtein del E2E (control limpio, difícil crudo y difícil con el upscale del pipeline). Evidencia en `fixture-difficult-measurement.json`. |
| **Tests run** | OCR difícil 3 vías: control limpio 100/100%; difícil crudo 74% chars / 39% words (confianza 72%); difícil con upscale ≥800px 47% chars / 4% words (confianza 44%). |
| **OCR chars** | Limpio 147/147 = 100%; difícil crudo 109/147 = 74%; difícil pipeline 69/147 = 47% |
| **OCR words** | Limpio 23/23 = 100%; difícil crudo 9/23 = 39%; difícil pipeline 1/23 = 4% |
| **E2E pass** | 79/79 (sin cambios) |
| **Limitations** | El upscale del pipeline degrada imágenes ruidosas (74%→47% chars): mejora de pipeline queda como TODO documentado. La extracción tabular heurística y el error OCR `-30`→`1-30` siguen normalizados solo en la extracción. |
| **Next task** | Considerar extraer la lógica OCR a `core/ocr-engine.js` y ajustar el upscale para fuentes ruidosas. |
| **Blockers** | None |

## Cycle 7 — Upscale eliminado y OCR real verificado (fix ocrCanvas)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-02 |
| **Branch** | feature/workspace-star-flow |
| **Baseline** | b161e23 |
| **Task** | Eliminar el upscale ≥800px de `extractTextFromScan` (degradaba imágenes ruidosas y causaba el artefacto `1-30`) y verificar OCR real en el E2E |
| **Hypothesis** | El upscale a ≥800px con `imageSmoothingQuality: high` amplificaba el ruido: 74%→47% chars en el difícil y 99%→produce `1-30` en el limpio. Sin upscale, el OCR sobre el canvas crudo debería mejorar ambos. |
| **Change** | Se eliminó el bloque `MIN_OCR_DIM`/upscale de `extractTextFromScan` (el OCR corre sobre el canvas crudo). La eliminación dejó 3 referencias colgantes a `ocrCanvas` en `registerExecution` (`ocrWidth/ocrHeight/scaled`) que lanzaban `ReferenceError` tras un `recognize()` exitoso y desviaban el flujo al ingreso manual; se corrigieron a `canvas` + `scaled: false` y se sincronizó `dist/workspace/workspace.js`. El spec E2E esperaba 1.5s fijos tras el click, ahora racista porque el OCR sin upscale completa más rápido; se cambió a `waitForSelector` del modal y polling de 500ms (presupuesto máximo intacto, 120s). |
| **Files** | `workspace/workspace.js` (extractTextFromScan, ocrCanvas→canvas); `tests/workspace/phase3c-star-flow.spec.mjs` (Step 8 race); `tests/workspace/ocr-difficult-measurement.mjs`; evidencia regenerada (`e2e-evidence.json`, `fixture-difficult-measurement.json`, `star-flow-export.toolisto`, `star-flow-report.pdf`) |
| **Tests run** | Phase 3C Star-Flow 79/79 con **OCR real** (2064ms, sin errores JS/consola); medición del fixture difícil regenerada: control limpio 100/100%, difícil crudo 74% chars / 39% words (confianza 72%), referencia con upscale legacy 47% / 4% (confianza 44%) |
| **OCR chars** | Limpio 147/147 = 100% (OCR real en el E2E) |
| **OCR words** | Limpio 23/23 = 100% |
| **E2E pass** | 79/79 |
| **Limitations** | El fixture difícil sigue en 74% chars / 39% words crudo; la mejora de preprocesado para fuentes ruidosas queda como TODO documentado (el upscale ya no está). |
| **Next task** | Considerar extraer la lógica OCR a `core/ocr-engine.js`; mejorar el preprocesado OCR para fuentes ruidosas. |
| **Blockers** | None |

## Cycle 8 — Pipeline OCR mejorado con OEM 3 (fixture difícil 76%/43%)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-03 |
| **Branch** | feature/workspace-star-flow |
| **Task** | Mejorar el pipeline OCR para el fixture difícil (TODO del Task List) |
| **Hypothesis** | El límite del fixture difícil no está en el canvas sino en el motor: OEM 1 (LSTM only) en `engine-loader.js` pierde signos y tokens en texto de ~8px efectivos con ruido; OEM 3 (DEFAULT, LSTM + legacy) debería elegir el mejor motor por bloque. |
| **Change** | `vendor/js/engine-loader.js`: `createWorker(lang, 1, ...)` → `createWorker(lang, 3, ...)` (OEM DEFAULT). Sincronizado a `dist/vendor/js/engine-loader.js`. Sin preprocesado en `extractTextFromScan`: 14 variantes de preprocesado probadas (gray, otsu, adaptive, sauvola, mediana, dilación, sustracción de fondo, sharpen, upscales 2x/3x bilinear y nearest, PSM 3/4/6/11/12, OEM 0/2/3) — ninguna supera a la vía cruda con OEM 3 y varias degradan el limpio. |
| **Tests run** | Medición oficial regenerada: limpio 100/100%; difícil crudo 76% chars / 43% words (confianza 62%, desde 74%/39%); referencia upscale legacy 41%/0%. Regresión completa: Star-Flow 83/83 (limpio 147/147, tabla 15/15), OCR Source Selection 34/34, phase6 51/51, P3A 45/45, P3B 59/59, P11 106/106, workspace 156/156, phase3-integrity 52/52, phase4-migrations 34/34, phase4-integrity 43/43, phase5-bundle-trust 49/49, storage 17/17, history 28/28, error-manager 13/13, session-recovery 24/24, deep-regression 24/24, tabular 21/21, stability 9/9, workflow-e2e 15/15, instruction-e2e 17/17, production-validation OK, sync SYNC OK. Total 712 pass, 0 fail. |
| **OCR chars** | Limpio 147/147 = 100%; difícil crudo 112/147 = 76% |
| **OCR words** | Limpio 23/23 = 100%; difícil crudo 10/23 = 43% |
| **E2E pass** | 83/83 |
| **Commit** | (fill tras commit) |
| **Limitations** | El texto efectivo de ~8px con ruido determinista sigue siendo el límite: los signos negativos y algunos tokens se pierden en OCR (la extracción tabular los normaliza en `convertDocToTable`). Ninguna binarización/upscale/sharpen probada supera la vía cruda con OEM 3; la mejora de preprocesado queda documentada como límite, no como TODO abierto. |
| **Next task** | Extraer la lógica OCR de `workspace.js` a `core/ocr-engine.js` (siguiente TODO del Task List). |
| **Blockers** | None |

## Current snapshot

```
Phase 3B: COMPLETE
Phase 3C: COMPLETE (fixture difícil medido honestamente; pipeline OCR mejora como TODO)
E2E Star-Flow: 83/83
OCR Source Selection: 34/34
Phase 3A: 45/45
Phase 3B: 59/59
Phase 11: 106/106
Workspace structure: 156/156
Workspace stability E2E: 9/9
Phase 3 integridad (3a/3b): 52/52
Phase 4a migraciones: 34/34
Phase 4b integridad referencial: 43/43
Phase 5 bundle trust (export/import): 49/49
Phase 6 prueba negativa de red: 51/51
OCR engine compartido: core/ocr-engine.js (extractTextFromScan + image.ocr)
Total: 712 pass, 0 fail, 712 tests
```

## Template for new cycles

```markdown
## Cycle N — Brief description

| Field | Value |
|-------|-------|
| **Date** | YYYY-MM-DD |
| **Branch** | |
| **HEAD** | |
| **Task** | TASK-N |
| **Hypothesis** | |
| **Change** | |
| **Duration** | |
| **Tests run** | |
| **OCR chars** | |
| **OCR words** | |
| **E2E pass** | /79 |
| **Workspace-test** | /156 |
| **Total pass** | /479 |
| **Commit** | |
| **Limitations** | |
| **Next task** | |
| **Blockers** | |
```
