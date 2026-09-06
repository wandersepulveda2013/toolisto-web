# WORKSPACE-AUTONOMOUS-QUEUE.md — Backlog de la mision Workspace

Priorites: P0 (roto/bloqueante) > P1 (debiera) > P2 (podria) > P3 (cosmetico).
Estado: TODO / ACTIVE / BLOCKED / DONE / DISCOVERED / DEFERRED.

## ACTIVE
| ID | Estado | Prioridad | Tarea | Notas |
| --- | --- | --- | --- | --- |
| W2 | TODO→ACTIVE | P1 | Site publico: SEO category metas fuera de rango 50-160 (hojas-de-calculo, qr-codigos, video, etc.) | `tests/apluno-production-seo.mjs`; generar metas en el template de categorias |

## DONE
| ID | Estado | Prioridad | Tarea | Notas |
| --- | --- | --- | --- | --- |
| W1 | DONE | P0 | Public OCR-PDF family rota: `__ensurePdfJs` indefinido en paginas publicas desde c4e53c7 | Fix autocontenido en js/ocr/pdf-ocr-engine.js; commits 86018aa+0257354; gate 129+ OK |
| W1.1 | DONE | P2 | Reconciliar 4 suites obsoletas (root-structure, security-devDeps, pdf-misc EXIF ordering, pdf-ocr-architecture) | tests commit 0257354 |

## DISCOVERED (verificados vivos o pendientes de clasificar)
| ID | Estado | Prioridad | Tarea | Notas |
| --- | --- | --- | --- | --- |
| D-01 | TODO | P1 | APLUNO Launcher: portada desktop no cabe en 100dvh | `tests/apluno-site.mjs`; revisar CSS de la home |
| D-02 | DISCOVERED | P2 | AdSense: categorias sin loader (pdf.html, imagenes.html, etc.) | remediation en curso en `artifacts/adsense-content-remediation/`; requiere build inyectado |
| D-03 | TODO | P3 | CE-137: codigo muerto `faithfulOcrText` en workspace.js:3051 | verificado vivo |
| D-04 | TODO | P3 | CE-144: `columnTypes` clonada como objeto en `cloneDataTableEntity` (workspace.js:1481); el patron correcto `Array.isArray` esta en 5019/5059 | verificado vivo; P3/S |
| D-05 | TODO | P3 | CE-141: undo de documento no persiste en storage | P3/S |
| D-06 | TODO | P2 | CE-138: bloques chart invisibles en editor (`BLOCK_TYPES` 3391, `renderBlock` ~3967) | investigacion iniciada |
| D-07 | TODO | P1 | CE-139: `rerenderTable` recrea el grid completo (~250k `<td>`) | P1/L |
| D-08 | TODO | P1 | CE-140: 2 deep-clones + 4 stringify por edicion en commit/checkpoint | P1/L |
| D-09 | TODO | P3 | CE-142: espacios de storage del undo | P3 |
| D-10 | TODO | P3 | CE-143: numbered-list/code/callout degradados en el informe | P3 |
| D-11 | TODO | P2 | CE-145: barrido triple + `markTableSelection` O(N) en la vista de tabla | P2/M |
| D-12 | TODO | P3 | AW-003 parcial: `renderDataView` (4549) solo re-renderiza si cambia el largo | verificado parcial |

## DEFERRED (solo con plan concreto)
| ID | Estado | Prioridad | Tarea | Motivo |
| --- | --- | --- | --- | --- |
| F-01 | DEFERRED | P1 | Despliegue a produccion (main) | Requiere canal del owner (`WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`) |
| F-02 | DEFERRED | P2 | OCR fixture dificil: mejora de preprocesado | Limite documentado; ningun metodo probado supera la via cruda con OEM 3 |

## BLOCKED
(ninguno actualmente)

## Metricas de progreso
W1: +6 suites verdes sobre baseline run-all (48/57 → 54/57). Restantes 3: D-01,
D-02 y SEO category metas (W2).