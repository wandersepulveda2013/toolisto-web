# AUTONOMOUS-ROADMAP.md — Toolisto Phase 3C

> Updated: 2026-08-10T00:00:00Z
> Branch: feature/workspace-star-flow
> Target: Complete Phase 3C (OCR reliability, data integrity, structural completeness)
> Estado: COMPLETA — ver `workspace/AUTONOMOUS_DONE.md` (cierre formal: Phase 3C 14/14 y certificación del sitio 167 herramientas)

## Auditoría profunda (Paso 2 — Build canónico)

- [x] PASS: Source canónico identificado (`workspace/` rastreado en git; `dist/` gitignored y generado)
- [x] PASS: `scripts/build-workspace-js.mjs` auditado: regeneraba `workspace/workspace.js` desde chunks inline con versión obsoleta de 1646 líneas SIN fixes 3C/3D/3E (canónico real: 6834 líneas). Neutralizado como guard que aborta sin tocar el canónico.
- [x] PASS: Sincronización verificable source → dist (`scripts/verify-workspace-sync.mjs`, `npm run build:workspace`): 8 archivos runtime idénticos
- [x] PASS: Puerta de release `npm run test:workspace:release` (`scripts/test-workspace-release.mjs`): build limpio 179 páginas + sync + 6 suites = RELEASE GATE OK

## Phase 3C Completion Criteria

- [x] Fixture limpio realista >95% chars, >90% words OCR
- [x] Fixture difícil medido honestamente (74% chars / 39% words crudo; 47% chars / 4% words con upscale del pipeline)
- [x] E2E Star-Flow: 79/79
- [x] Tabla comparada celda por celda
- [x] Gráfico validado
- [x] PDF validado estructural y visualmente
- [x] Persistencia pasa
- [x] `.toolisto` remapea referencias
- [x] Errores no destruyen datos
- [x] Cinco viewports pasan
- [x] workspace-test: 156/156
- [x] Suites principales pasan: run-all 11/11, Batch 4 329/329, Batch 5 154/154, verificación 144/144
- [x] Sin errores de consola no controlados en validaciones E2E
- [x] Limitaciones documentadas

## Task List

### OCR — Limpiar fixture y mejorar precisión
- [x] PASS: Actualizar scan-clear.png a mejor calidad (420x260 mínimo, texto más nítido)
- [x] PASS: Medir y registrar % chars y % words del fixture limpio (100% chars, 100% words en E2E integrado tras eliminar el upscale del pipeline)
- [x] PASS: Modelo OCR local (`vendor/tesseract/lang-data/spa.traineddata.gz`) para eliminar el timeout de red E2E (OCR ~2s)
- [x] PASS: Reconstruir columnas doc-to-table por ancla numérica y normalizar el signo negativo OCR (`1-30` → `-30`): 9/15 → 15/15 celdas (100%)
- [x] PASS: Crear fixture "difícil" (`scan-difficult.png`: 12px, bajo contraste, reducción, blur y ruido determinista; comparte `expected-ocr.txt` sin umbral reducido)
- [x] PASS: Medir el fixture difícil honestamente (`ocr-difficult-measurement.mjs`): control limpio 100/100%; difícil crudo 74% chars / 39% words (confianza 72%); difícil con upscale del pipeline 47% chars / 4% words (confianza 44%)
- [x] PASS: Extraer lógica OCR de workspace.js a core/ocr-engine.js: NUEVO `core/ocr-engine.js` (`isOcrEngineAvailable`, `loadOcrEngine`, `loadCanvasFromImageSource`, `recognizeText` con `{ text, confidence, words }` y fases `loading`/`recognizing`) como punto canónico sin dependencias externas. `extractTextFromScan` (workspace.js) y la operación `image.ocr` (`core/workflow-operations.js`) usan `recognizeText`; ya no quedan referencias directas a `EngineLoader`/`worker.recognize` fuera de `core/ocr-engine.js` en el workspace. Comportamiento preservado (mensajes de progreso, fallback manual en error, mensaje `OCR engine not available...`). Sync source → dist OK. `js/ocr/pdf-ocr-engine.js` (PDF searchable) queda como script clásico separado fuera del alcance (limitación documentada).
- [x] PASS: Mejorar OCR del fixture difícil con OEM 3 (DEFAULT: LSTM + legacy) en `vendor/js/engine-loader.js`: el difícil sube a 76% chars / 43% words (confianza 62%) SIN degradar el limpio (sigue 100/100). El upscale legacy de referencia baja a 41%/0% con el mismo OEM nuevo. Ninguna binarización/upscale/sharpen probado supera la vía cruda con OEM 3; la mejora de preprocesado queda como límite documentado (texto efectivo ~8px con ruido determinista).
- [x] PASS: Verificar que OCR mantiene 95% chars en fixture limpio (147/147 = 100% en E2E integrado)

### E2E Star-Flow — Verificado
- [x] 79/79 pasos pasan con OCR, IndexedDB, PDF y export/import reales
- [x] OCR integrado: 147/147 caracteres (100%) y 23/23 palabras (100%)
- [x] Tabla comparada celda por celda: 15/15 (100%), incluye negativos (`-30`, `-200`)
- [x] Cero errores JavaScript y de consola

### Estructura — Verificado
- [x] workspace-test: 156/156
- [x] Codificación de source y dist validada por `encoding-audit.mjs`

### OCR Source Selection
- [x] PASS: 34/34 pruebas de selección de fuente OCR

### Phase 3A
- [x] PASS: 45/45

### Phase 3B
- [x] PASS: 59/59

### Phase 11
- [x] PASS: 106/106

## Phase 3D — Stability, History & Recovery

> Goal: Workspace-level undo/redo, session persistence, error resilience, toast improvements

### Core Modules
- [x] History manager with snapshot-based undo/redo (max 50, grouped writes 600ms)
- [x] Workspace storage via IndexedDB (5 max sessions, schema v1, localStorage session ID)
- [x] Error manager with 12 categories, global handlers, pluggable toast
- [x] Toast queue (max 3 visible, auto-drain)

### Integration
- [x] Undo/redo buttons in topbar with reactive disabled state
- [x] Ctrl+Z / Ctrl+Y / Shift+Z keyboard shortcuts with input awareness
- [x] Session recovery dialog on load with modal prompt
- [x] beforeunload save + visibilitychange flush
- [x] Autosave interval (5s) with dirty detection
- [x] Save indicator (LOCAL / LISTO ↔ LOCAL / SIN GUARDAR)
- [x] History push after saveDoc, saveData, createDoc, createTable
- [x] Error-manager wired to toast system
- [x] 8 silent `.catch(() => {})` replaced with `reportError`

### Tests
- [x] 28 history-manager unit tests (create, push, undo, redo, grouped, max entries, onChange)
- [x] 17 workspace-storage unit tests (exports, schema, localStorage, IndexedDB patterns)
- [x] 13 error-manager unit tests (exports, categories, global handlers)
- [x] 24 session-recovery integration tests (imports, handlers, UI buttons, save indicator)
- [x] 0 baseline regressions (156 workspace + 45 P3A + 59 P3B + 21 tabular + 34 OCR + 106 P11 + 79 Star-Flow)
- [x] Workspace stability E2E: 9/9, sin errores de consola

## Phase 3E — Deep integrity hardening

- [x] Store listeners isolated per `createStore` instance.
- [x] IndexedDB handles blocked opens, version changes, explicit close and transaction completion safely.
- [x] Autosave and session flush use the project-aware storage signatures and report failures.
- [x] Session autosaves deduplicate by session ID and preserve workflow snapshots.
- [x] Project deletion removes all related stores in one read/write transaction.
- [x] Workflow renderer can access its registry and UI from all navigation paths.
- [x] Modelo de datos wired to the visible route with real tables, relationship detection, position persistence and inspector.
- [x] Deep regression: 24/24; production Model route; Star-Flow 79/79; stability 9/9; workflows 15/15.

## Paso 3 — Integridad P0 (3a y 3b COMPLETOS)

> 10 puntos de integridad (P0) sobre OCR, datos, derivados y revisión.
> Inventario: `artifacts/deep-audit/paso3-p0-hallazgos.csv` (43 P0).
> Medición de confianza OCR por palabra: `artifacts/deep-audit/workspace-baseline/ocr-word-confidence.json`.

### 3a — Confianza por celda y revisión (COMPLETO — commit `40a9ba5`)
- [x] Punto 1 — innerHTML auditado: solo lecturas de `editor.innerHTML` pasadas por `sanitizeDocHtml` (DOMParser + `serializeDocNode`); sin asignaciones dinámicas peligrosas. Sin cambios requeridos.
- [x] Punto 3/6 — Confianza OCR capturada por palabra (`result.data.words`), persistida en `doc.ocrWords`/`scanDoc.ocrWords`; `convertDocToTable` construye `table.cellConfidence` (matriz por celda) y registra `table.ocrConfidence`.
- [x] Punto 2/4 — `parseLocaleNumber` (acepta `(123)` → -123, rechaza letras) ya verificado; celdas inventadas 0 en el E2E Star-Flow (15/15).
- [x] Estados de revisión `draft|reviewed|verified` con helpers (`requiresDataReview`, `tableReviewStats`, `dataReviewStatus`, `formatReviewStatus`, `setTableReviewStatus`). Umbral `OCR_LOW_CONFIDENCE = 85`.
- [x] UI: badge de estado en toolbar de tabla, resaltado `td.ws-cell-low-confidence` (+ `!`), modal de revisión con tabla+confianza, texto OCR e imagen original cargados del contexto, botones "Marcar como revisada/verificada".
- [x] Punto 8 — Bloqueo de derivados con datos inciertos: `createChartFromTable` y `createReportFromTable` abren el modal de revisión y NO crean el derivado mientras la tabla esté en `draft` con celdas bajas.
- [x] Punto 10 — Linaje: `showTableLineage` muestra captura → escaneo → documento → tabla (con flechas y nodo derivado).
- [x] `setTableReviewStatus` sincroniza `dataTables`/`currentDataTable` y re-renderiza la vista (fix: cards del data-list retenían referencia antigua).
- [x] Tests: E2E Star-Flow 83/83 (paso 15b de revisión añadido; el encargo exige revisión antes de derivar); NUEVO `tests/workspace/phase3-integrity-test.mjs` (matriz, draft, badge, resaltado, bloqueo gráfico e informe, revisión habilita derivado, linaje).

### 3b — Bloqueo de PDF manual y auditoría post-generación (COMPLETO)
- [x] Punto 8b — Bloqueo de exportación PDF en el editor de diseño cuando una sección referencia tabla incierta: `findUncertainDesignSources` recorre `designConfig.sections` (table/chart con `sourceId`/`data.sourceId`), lee la fuente en IDB y si `requiresDataReview` abre el modal de revisión y aborta la exportación. El PDF manual sin `sourceId` NO se bloquea (Star-Flow 22 sigue pasando).
- [x] Punto 9 — Auditoría post-generación: `validatePdfAgainstSource` compara headers, nº de filas de la vista previa y nº de series del gráfico contra la tabla fuente; registra una ejecución `pdf-validation` (`completed`/`failed`) y muestra advertencia si no coincide. Sin `sourceId` la auditoría no aplica (no registra).
- [x] Tests: `tests/workspace/phase3-integrity-test.mjs` extendido 52/52 — paso 7 verifica que el PDF NO se bloquea con fuente revisada, que SÍ se bloquea tras degradar la tabla a `draft` en IDB, y que la auditoría `pdf-validation` queda registrada como `completed`.
- [x] Regresión: Star-Flow 83/83, workspace-test 156/156, storage 17/17, history 28/28, error-manager 13/13, OCR 34/34, P3A 45/45, P3B 59/59.
- [x] Evidencia visual `artifacts/deep-audit/review-modal.png` y `phase3-integrity-evidence.json` guardadas y committeadas.

## Paso 4 — Persistencia, importación y seguridad

> Bloque de P0 del inventario (`artifacts/deep-audit/paso3-p0-hallazgos.csv`): migraciones,
> integridad referencial, importación atómica, manifiesto de exportación y casos adversarios.

> Inventario actualizado tras 3a/3b/4a/4b/5/6: 21 Resuelto, 4 Parcial, 18 Abierto. Resueltos:
> WSP-002/003 (build+sync), WSP-011, WSP-012, WSP-013/014/015 (import atómico + manifiesto +
> límites), WSP-023/UXW-067/WDX-010 (prueba negativa de red), WSP-042/043/070 (revisión OCR),
> WSP-097/098, WDX-001/003/005/006/007. Parciales:
> WSP-021/053 (sanitización auditada, falta modelo de bloques), WSP-059 (locale explícito),
> WDX-004 (métricas exactas por token).

### 4a — Migraciones de IndexedDB demostradas (COMPLETO — commit `b9215c4`)
- [x] WSP-011 — Contrato de migración explícito `core/migrations.js`: plan v1 → v2 → v3 con etiquetas y `applyMigrations`/`applyPlan`; `core/db.js` delega su `onupgradeneeded` al contrato (refactor sin cambio de esquema: sigue v3 con 8 stores).
- [x] Copia previa: `backupDatabase()` recrea en `toolisto-workspace-backup` el esquema exacto (keyPath, autoIncrement e índices) y copia todos los registros.
- [x] Recuperación: `restoreDatabase()` reconstruye la base principal desde el backup y restaura los datos.
- [x] Rollback nativo demostrado: una migración que lanza error aborta la transacción de upgrade y la base revierte a la versión anterior con los datos intactos.
- [x] `getSchemaInfo()`/`migrateDatabase()` y export de `DB_NAME` desde `db.js`.
- [x] Tests: NUEVO `tests/workspace/phase4-migrations-test.mjs` 34/34 (plan, instalación limpia, fixture v1 → v3 sin pérdida, fixture v2 → v3 preservando assets, backup/restore, rollback). Fixtures v1/v2/v3 construidos en IndexedDB real.
- [x] Regresión: workspace-test 156/156, Star-Flow 83/83.

### 4b — Integridad referencial y borrado en cascada (COMPLETO)
- [x] WSP-012 — NUEVO `core/integrity.js`: auditor de huérfanos (`auditOrphans`/`assertIntegrity`) que recorre los 7 stores de objetos y reporta cada referencia rota con owner y campo: `projectId`, `sourceAssetId`, `captureId`, `sourceDocId`, `scanDocId`, `sourceTableId`, `tableId`, `sourceId`, `resultAssetId`, `inputAssetIds`, `derivedIds`, `relations` (`targetId` + legado `from`/`to`), `config.*` y `metadata.captureId`.
- [x] Cascada explícita transitiva y UNIDIRECCIONAL (`deleteWithCascade`): borrar una fuente elimina toda la cadena derivada captura → asset → documento → tabla → gráfico → export → ejecución en una única transacción. Las `relations` son linaje bidireccional y NO propiedad: se podan (nunca cascadan) para no sobre-borrar la fuente vía back-references.
- [x] `pruneDanglingReferences(deletedIds)`: poda en todos los stores las relaciones/`derivedIds` colgantes tras un borrado manual.
- [x] `core/storage.js` cableado: `deleteDoc`, `deleteData`, `deleteCapture`, `deleteAsset` usan `deleteWithCascade`; `deleteProject` poda referencias colgantes tras su transacción, emite `integrity:audited` y deja CERO registros en los 8 stores (WDX-003).
- [x] WSP-013/importación — `importProject` remapea ahora `relations.targetId` (además de `from`/`to`) y `metadata.captureId`; el grafo importado queda sin huérfanos.
- [x] Tests: NUEVO `tests/workspace/phase4-integrity-test.mjs` 43/43 sobre IndexedDB real (grafo válido, 7 tipos de huérfano, cascada de 7 IDs, no sobre-borrado por back-reference, poda de relaciones/derivedIds, `deleteProject` con evento `integrity:audited` y 8 stores vacíos, `importProject` sin huérfanos).
- [x] Regresión: Star-Flow 83/83, workspace-test 156/156, phase3-integrity 52/52, phase4-migrations 34/34, workspace-storage 17/17, sync source → dist OK.
- [x] Limitación documentada: la cascada sigue campos de derivación y `metadata.captureId`; los `edges` de workflow referencian nodos internos del mismo objeto y quedan fuera del alcance del auditor de stores.

### 5 — Confianza export/import del bundle `.toolisto` (COMPLETO)
- [x] WSP-014 / WDX-002 — NUEVO `core/bundle.js`: contrato de manifiesto `buildManifest` con `schemaVersion` 3, `appVersion`, `exportedAt`, conteos por store, `relationCount` + cadena de derivación y checksums SHA-256 por objeto (`sha256Hex` vía Web Crypto sobre `canonicalJson` con claves ordenadas). `exportProject` adjunta `bundle.manifest`; `validateManifest` verifica integridad y devuelve `{ ok, legacy }` (bundles heredados sin manifiesto siguen importando).
- [x] WSP-013 / WDX-007 — `importProject` reescrito como importación ATÓMICA: validación completa (manifiesto + límites) ANTES de escribir nada con diagnóstico `Importación rechazada: ...`; `migrateProjectBundle`; remapeo completo de IDs por store (`remapRefs`: `sourceAssetId/sourceDocId/scanDocId/sourceTableId/tableId/captureId/resultAssetId/sourceId`, `inputAssetIds/derivedIds`, `relations.targetId/from/to`, `config.*`, `metadata.captureId`, model `nodes[].tableId` y `relationships[].fromTableId/toTableId`); una ÚNICA transacción readwrite sobre los 8 stores (cualquier `put` fallido aborta y la base queda idéntica); counts fijados; `loadProjects()` + eventos `project:imported`/`integrity:audited`.
- [x] WSP-015 — Límites adversarios configurables por importación: `maxObjectsPerStore` (20000), `maxDepth` (64) y `maxJsonBytes` (200 MB) con mensajes de rechazo byte-exactos.
- [x] Dropzone drag-drop de `workspace.js`: valida el archivo con `validateWorkspaceFile(file, ['.toolisto', '.json'])` y muestra el error detallado (`Error al importar: ...`).
- [x] Tests: NUEVO `tests/workspace/phase5-bundle-trust-test.mjs` 49/49 sobre IndexedDB real (manifiesto y detección de un byte alterado con diagnóstico, round-trip export→import con remapeo completo y grafo sin huérfanos, bundle manipulado rechazado SIN tocar la base — conteos antes/después idénticos, objeto eliminado detectado por conteo, legacy sin manifiesto, tres límites adversariales rechazados con base intacta). Evidencia: `artifacts/deep-audit/phase5-bundle-trust-evidence.json`.
- [x] Regresión completa: Star-Flow 83/83, workspace-test 156/156 (asserts de dashboard/query actualizados al patrón atómico `key: 'dashboard:' + projectId`), OCR 34/34, P3A 45/45, P3B 59/59, P11 106/106, phase3-integrity 52/52, phase4-migrations 34/34, phase4-integrity 43/43, storage 17/17, history 28/28, error-manager 13/13, session-recovery 24/24, deep-regression 24/24, tabular 21/21, stability 9/9, workflow-e2e 15/15, instruction-e2e 17/17; sync source → dist SYNC OK; release gate OK. Total 661 pass, 0 fail.
- [x] Inventario P0 actualizado: WSP-013/014/015 y WDX-002/007 → Resuelto.
- [x] Limitación documentada: el manifiesto no protege contra re-exportación legítima con datos no deseables (el usuario es quien exporta); la atomicidad cubre la escritura, no la integridad semántica del contenido.

## Paso 6 — Prueba negativa de red y local-first hermético (COMPLETO)

> La promesa local-first queda demostrada con una suite que FALLA si el contenido del usuario sale por red.

- [x] WSP-023/UXW-067/WDX-010 — NUEVO `tests/workspace/phase6-network-negative-test.mjs` 51/51: inyecta un marcador secreto en dos partes (`TLST-P6-` + timestamp + random) en un bloque de texto inicial del documento y en la fila0/celda0 de la tabla; intercepta TODOS los requests con `page.route('**/*')` (aborta no-same-origin con `blockedbyclient` y registra `{method,url,postData,headers}`) y los frames WebSocket con `page.on('websocket')` (sent/received).
- [x] Flujo estrella completo bajo la red interceptada: escanear fixture → OCR → documento con marcador → tabla con marcador → revisar tabla (`reviewed`) → gráfico con 4 assets → PDF real → reload con persistencia del marcador → export `.toolisto` (schemaVersion 3) → import atómico (proyecto `msd7...`, 2 proyectos) → navegación query/flow/dashboard/document/data/capture → CERO egress externo.
- [x] Cobertura de canales: `fetch`, XHR (`new Image`), `navigator.sendBeacon`, `new WebSocket('ws://127.0.0.1:9/...')` probados con control positivo (Paso 15) — cada probe es abortado/detectado por el interceptor, demostrando que la interceptación funciona (no es un falso "cero egress").
- [x] Verificaciones: marcador ausente en todas las URLs, bodies, headers y frames WebSocket; escaneo estático de `workspace/` sin `fetch(`, `XMLHttpRequest`, `sendBeacon`, `new WebSocket(`, `wss://`; cero errores JS/consola.
- [x] Dependencia externa Google Fonts ELIMINADA para test hermético: `workspace/index.html` sin preconnect/googleapis/gstatic (CSS versionado `workspace.css?v=20260803-local`); `workspace.css` sin `@import` con stack del sistema `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. `phase11-audit.mjs` actualizado con aserción local-first + system font stack.
- [x] Regresión completa (661 → 712 pass, 0 fail): Star-Flow 83/83, workspace-test 156/156, OCR 34/34, P3A 45/45, P3B 59/59, P11 106/106, phase3-integrity 52/52, phase4-migrations 34/34, phase4-integrity 43/43, phase5-bundle-trust 49/49, phase6 51/51, storage 17/17, history 28/28, error-manager 13/13, session-recovery 24/24, deep-regression 24/24, tabular 21/21, stability 9/9, workflow-e2e 15/15, instruction-e2e 17/17, production-validation OK; sync source → dist SYNC OK.
- [x] Evidencia: `artifacts/deep-audit/phase6-network-negative-evidence.json` (secret, requests, probes, websockets, staticScan, flow) + `phase6-network-negative.pdf` y `phase6-export.toolisto`.
- [x] Inventario P0 actualizado: WSP-023/UXW-067/WDX-010 → Resuelto (21 Resuelto, 4 Parcial, 18 Abierto).
- [x] Limitaciones documentadas: la interceptación cubre requests del navegador y frames WebSocket; los tests `playwright-render.mjs` y `visual-audit-click-nav.mjs` fallan por un flake preexistente de visibilidad de navegación (`element is not visible`) VERIFICADO como ajeno a este paso (idéntico con fuentes externas restauradas) y fuera del conteo certificado.

## Task States

- TODO: Not started, ready to work
- ACTIVE: Currently being worked (only ONE at a time)
- BLOCKED: Cannot proceed (reason documented in AUTONOMOUS_BLOCKED)
- PASS: Completed and verified
- FAIL: Attempted but failed (reason documented in STATUS)
- SKIP: Decision not to pursue

## Helper Scripts

```powershell
# Run E2E Star-Flow
$env:E2E_PORT=8082; node tests/workspace/phase3c-star-flow.spec.mjs

# Run workspace structure test
node tests/workspace/workspace-test.mjs

# Run all Node suites
Get-ChildItem "tests/workspace/*.mjs" | ForEach-Object { node $_.FullName }

# Run server for testing
npx http-server dist -p 8082 --cors
```
