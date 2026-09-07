# WORKSPACE-AUTONOMOUS-QUEUE.md — Backlog de la mision Workspace

Priorites: P0 (roto/bloqueante) > P1 (debiera) > P2 (podria) > P3 (cosmetico).
Estado: TODO / ACTIVE / BLOCKED / DONE / DISCOVERED / DEFERRED.

## ACTIVE
(ninguna tarea ACTIVE en este ciclo; seleccion declarada en STATUS ciclo D-14: D-11 (CE-145, P2/M) o D-13 (CE-141, P3/design), o cerrar CE-143 con su suite dedicada)

## DONE
| ID | Estado | Prioridad | Tarea | Notas |
| --- | --- | --- | --- | --- |
| W1 | DONE | P0 | Public OCR-PDF family rota: `__ensurePdfJs` indefinido en paginas publicas desde c4e53c7 | Fix autocontenido en js/ocr/pdf-ocr-engine.js; commits 86018aa+0257354; gate 129+ OK |
| W1.1 | DONE | P2 | Reconciliar 4 suites obsoletas (root-structure, security-devDeps, pdf-misc EXIF ordering, pdf-ocr-architecture) | tests commit 0257354 |
| W2 | DONE | P1 | Site publico: SEO category metas fuera de rango 50-160 (3 paginas: hojas-de-calculo 257, qr-codigos 237, video 224) | Descriptions acortadas a 120/144/115 en `src/data/categories.json`; `tests/seo-production-audit.mjs` 3059/3059; commit 6b725d8 |
| W3 | DONE | P2 | CE-138: bloques chart invisibles en editor (`BLOCK_TYPES` 3391, `renderBlock` 3967) | Rama chart en renderBlock con DOMParser+importNode (sin innerHTML); suite editor-chart-block 20/20; commit b8e151e |
| W4 | DONE | P3 | CE-144: `columnTypes` clonada como objeto en `cloneDataTableEntity` (1481) y `duplicateDataSheet` (4508) | Patron `Array.isArray(...) ? [...]`; suite duplicate-entities 55/55; commit 7b6d9f1 |
| W5 | DONE | P1 | CE-140: dedup del historial de tabla sin JSON.stringify total (snapshotsEqual estructural; Sets por contenido) | `snapshotKey` eliminado; suite table-history-cap 8->22/22; commit ca1fb03 |
| W6 | DONE | P1 | CE-139: `rerenderTable` reinstala solo thead+tbody via renderGrid + recuperacion del presupuesto de dist (1202->1191KB) | data-table-rerender-scope 35/35; gate completo 157 suites PASS en 5a3629f; CE-137 (dead code) resuelto de paso |

## DISCOVERED (verificados vivos o pendientes de clasificar)
| ID | Estado | Prioridad | Tarea | Notas |
| --- | --- | --- | --- | --- |
| D-03 | DONE | P2 | CE-137: dead code `faithfulOcrText` (+ `actionIcon`, `visibleRowIndex`) | Eliminado como parte de la recuperacion de presupuesto de W6 (0 referencias en repo/tests) |
| D-07 | DONE | P1 | CE-139: `rerenderTable` recrea el grid completo (~250k `<td>`) | Cerrado en W6; suite data-table-rerender-scope 35/35 |
| D-08 | DONE | P1 | CE-140: 2 deep-clones + 4 stringify por edicion en commit/checkpoint | Cerrado en W5; snapshotsEqual estructural; 9.9x en el ganglio |
| D-14 | DONE | P2 | Bug latente pre-existente: `document.addEventListener('keydown', ...)` a nivel de modulo (~L575/591/1091/1103) llama `rerenderTable()` pero es closure dentro de `renderDataTableView` (L5306) | Fix en ciclos CE: holder de modulo `_activeTableRerender` + `rerenderActiveTable()`; los 4 call sites fuera de scope (topbar undo/redo + keydown Ctrl+Z/Y) usan el helper; suite data-table-undo-scope 10/10; gate 132 suites PASS |
| D-13 | TODO | P3 | CE-141: `exportTableCSV` vierte formulas en bruto mientras la vista muestra el valor evaluado | design; P3 |
| D-05 | TODO | P3 | CE-142 (etiqueta corregida): undo de documento no persiste en storage (`_applyState` solo restaura appStore) | P3/S |
| D-10 | TODO | P3 | CE-143: numbered-list/code/callout degradados en el informe (bullet/quote si se marcan) | P3 |
| D-11 | TODO | P2 | CE-145: barrido triple + `markTableSelection` O(N) en la vista de tabla | P2/M |

## DEFERRED (solo con plan concreto)
| ID | Estado | Prioridad | Tarea | Motivo |
| --- | --- | --- | --- | --- |
| F-01 | DEFERRED | P1 | Despliegue a produccion (main) | Requiere canal del owner (`WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`) |
| F-02 | DEFERRED | P2 | OCR fixture dificil: mejora de preprocesado | Limite documentado; ningun metodo probado supera la via cruda con OEM 3 |
| F-03 | DEFERRED | P1 | D-01 APLUNO Launcher: portada desktop no cabe en 100dvh | Cosmetico del launcher, sin impacto en runtime Workspace; revisar solo si se retoma la landing |
| F-04 | DEFERRED_EXTERNAL | P2 | D-02 AdSense: categorias sin loader (pdf.html, imagenes.html, etc.) | Mision distinta (remediacion AdSense), fuera del backlog Workspace; remediation en `artifacts/adsense-content-remediation/` |

## BLOCKED
| ID | Estado | Prioridad | Tarea | Motivo |
| --- | --- | --- | --- | --- |
| D-12 | BLOCKED | P3 | AW-003 parcial: `renderDataView` (4549) solo re-renderiza si cambia el largo | Sin definicion formal ni criterios de aceptacion en el repo (solo nota de la QUEUE continua); no se re-descubre ni se inventa |

## Metricas de progreso
W1: +6 suites verdes sobre baseline run-all (48/57 -> 54/57). W2: SEO category metas
cerrado (3059/3059). W3: CE-138 cerrado. W4: CE-144 cerrado. W5: CE-140 cerrado.
W6: CE-139 cerrado + presupuesto dist recuperado (1202KB -> 1191KB; gate 157 suites
PASS en 5a3629f; CE-137 dead code resuelto de paso; D-14 nuevo candidato latente).
D-14: cerrado en ciclo CE (8e8c79c; suite data-table-undo-scope 10/10; gate 132 suites
PASS). CE-143: progreso parcial commiteado (fca56a4) sin suite dedicada — tarea abierta.
Restantes run-all: D-01 (DEFERRED, launcher) y D-02 (DEFERRED_EXTERNAL, AdSense).
Producto Workspace: CE-137/138/139/140/144 cerrados; CE-141/142/143/145 pendientes;
AW-003 BLOCKED. Proxima seleccion declarada en STATUS (ciclo D-14): D-11 (CE-145, P2/M)
o D-13 (CE-141, P3/design), o cerrar CE-143 con su suite dedicada.