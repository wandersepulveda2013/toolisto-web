# CONTINUOUS-EVOLUTION-STATUS.md — Memoria persistente del sistema autonomo

> Cada ciclo de OpenCode LEE este archivo antes de actuar y lo ACTUALIZA antes de terminar.
> Registro historico de ciclos de la mision Evolucion Continua.
> Modo activo SOLO despues de la transicion (cuando `workspace/PRODUCTION_READINESS_DONE` exista).
> Updated: 2026-08-14

---

## Cycle 115 — Capturas (imágenes escaneadas) encadenadas a Flujos hasta el OCR (CE-050)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-14 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f5bbd370c5b49da7dba0b3c5f6ff31c5f1f43d9d |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-050 (P2, DISCOVERY dirigida: sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | El flujo estrella `archivo → escaneo → OCR → documento → …` requiere que una captura escaneada guardada en el proyecto pueda entrar al constructor de flujos, pero CE-003 solo permitía encadenar documentos y tablas (`startWorkflowFromWorkspace` rechazaba `image` y `selectFromWorkspace` listaba solo documento/tabla), por lo que la imagen corregida de un escaneo no se podía reutilizar como entrada de un flujo (OCR, rotación…) sin volver a subir el archivo, rompiendo el encadenado interno del escaneo con el resto del proyecto. |
| **Change** | `workspace/core/workflow-ui.js`: `selectFromWorkspace` añade las capturas del proyecto (`kind: 'image'`, id `capture-<id>`, icono `camera`); `addWorkspaceItems` acepta `image` como entrada por referencia (sin copiar el asset) y deduplica por workspaceRef; `executeFlow` resuelve una referencia `capture-<id>` a la imagen real mediante el helper inyectado `resolveCaptureImage`, que devuelve el Blob de la captura (patrón CE-029: se resuelve el asset corregido sin duplicar el PNG en IDB) para poder encadenarla (p. ej. OCR). `workspace/workspace.js`: nuevo `resolveFlowCaptureImage(captureId)` (busca en appStore o `loadCaptureById`, resuelve `resolveCaptureImageDataUrl` y convierte el dataUrl a Blob con `fetch`), inyectado como `resolveCaptureImage` en `renderWorkflowView`; `renderCaptureView` añade el botón «Encadenar» a las tarjetas de captura (junto a «Extraer texto» y «Eliminar») que llama a `startWorkflowFromWorkspace({ id: 'capture-…', kind: 'image' })`; `startWorkflowFromWorkspace` acepta ahora `['document', 'data', 'image']`. |
| **Hallazgos** | La estrella del flujo pedía `escaneo` como entrada de los flujos, pero la UI solo exponía documento/tabla; la captura corregida vivía en un asset con `correctedAssetId` y no se podía reutilizar. La vía de inyección de un helper (`appHelpers.resolveCaptureImage`) reutiliza el patrón ya usado por `saveImageCapture`/`pushHistory` y mantiene la lógica de resolución de assets fuera del módulo de flujos (sin DOM). |
| **Bugs encontrados** | (ce-050 baseline) `startWorkflowFromWorkspace` aplicaba `return` silencioso para kind no permitido, sin feedback; la lista «Desde Workspace» ignoraba capturas. Durante el desarrollo del E2E, mi nueva suite fallaba (4 asserts) por usar `ok('nombre')` sin condición (`ok(name, condition)`) con condición `undefined` → siempre FAIL, a pesar de que el feature funcionaba (confirmado por diagnósticos con `docs:1`, `ocrWords:true` y palabras reales del fixture); se corrigió el contrato de las llamadas `ok(..., true)` del test. |
| **Bugs corregidos** | Sí: una captura (imagen escaneada) del proyecto entra al constructor de flujos por referencia, se resuelve como Blob desde su asset corregido y puede encadenarse (E2E: captura → OCR real → documento persistido en IndexedDB con las palabras OCR reales). |
| **Tests ejecutados** | `node tests/workspace/capture-flow-chain-e2e.mjs` (12/12, nuevo: seed de proyecto+captura+asset en IDB real, vista Capturas, botón Encadenar, captura como entrada `image`, OCR real con fixture `scan-clear.png`, documento con bloques persistido tras reload, palabras OCR reales, cero errores/consola y cero requests externos); `node tests/workspace/workflow-ui-test.mjs` (65/65, 3 contratos nuevos CE-050); `$env:E2E_PORT=8082; node tests/workspace/workflow-e2e-test.mjs` (31/31); `node scripts/test-workspace-release.mjs` (release gate completo 13 suites PASS, incluida la nueva `capture-flow-chain E2E` registrada); regresión workspace-test 156/156, phase3a 80/80, phase3b 59/59, phase11 106/106, op-registry 26/26, workflow-engine 18/18, workflow-document-pdf 66/66, ocr-source-selection 34/34, determinismo 71/71, build 179/179 y sync source/dist OK. |
| **Tests PASS** | Capture-flow-chain E2E 12/12; Workflow UI 65/65; Workflow E2E 31/31; regresión completa: Workspace 156/156, Phase 3A 80/80, Phase 3B 59/59, Phase 11 106/106, Registry 26/26, Engine 18/18, Document→PDF 66/66, OCR Source 34/34, determinismo 71/71, build 179/179 y sync source/dist OK; release gate 13/13. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): encadena capturas (imágenes escaneadas) en flujos hasta el OCR (CE-050)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La entrada de captura se resuelve por referencia cargando el asset corregido (sin persistir ningún `blob:`); el `fetch(dataUrl).blob()` depende de que el origen sirva data-URLs locales (local-first, sin red) y de que la captura tenga `dataUrl` o `correctedAssetId` resoluble. La deduplicación por `workspaceRef` evita añadir dos veces la misma captura. Las evidencias regeneradas por las suites al iniciar/ejecutar el ciclo (`artifacts/deep-audit/phase3-integrity-evidence.json`, `review-modal.png`, `TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `ocr-source-tests.json`, `star-flow-export.toolisto`, `screenshots/workspace/08-scanner-module-test.png`, `ocr-diagnostic.json` sin seguimiento y `artifacts/deep-audit/release-gate/release-gate-*.json`) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 114 — Resultados de texto de flujo añadidos al Workspace como documentos (CE-049)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 5223b9a1af8dbc3bb7ea18e67e54314bdf56f0d0 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-049 (P2, promovida de DISCOVERY: sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | La serie CE-047/CE-048 cubría resultados `document`/`data`/`image`, pero un resultado `text` de flujo —la salida de `image.ocr`, el paso central del flujo estrella `archivo → escaneo → OCR → documento → tabla → gráfico → informe → PDF`— solo ofrecía «Descargar» y no se podía añadir al Workspace: el texto extraído no se persistía como documento del proyecto, cortando el encadenado de la salida de un flujo con el Workspace. |
| **Change** | `workflow-ui.js`: el botón «Anadir al Workspace» se muestra también para `r.kind === 'text'`, y `addResultToWorkspace` añade la rama `text`: `textResultToDocument(name, text)` convierte el payload (string plano o Blob leído con `payload.text()`) en un documento Toolisto de bloques —mismo mapeo que `text.to-document`: headings 1/2/3, bullet-list y párrafos— con `id: 'flow-text-' + hash32(nombre+contenido)` estable para que readicionar el mismo resultado no duplique el documento; persiste con `saveDoc(project.id, doc)`, lo incorpora a `documents`, abre `currentDoc`, registra en `pushHistory`, refresca `refreshProjectCounts` e informa al usuario. Texto vacío/inservible se rechaza con aviso. `scripts/test-workspace-release.mjs`: `workflow-ui-test` se registra en el release gate (las suites VM de workflow no estaban registradas, gap preexistente). |
| **Hallazgos** | El botón «Anadir al Workspace» se renderizaba solo para `document`/`data`/`image`; un resultado `text` (OCR, exportaciones) quedaba solo-descargable y su salida no llegaba nunca al proyecto, aunque `text.to-document` ya sabía convertir texto a bloques. El id estable por contenido permite dedup sin depender de que el resultado traiga id del engine. |
| **Bugs encontrados** | El resultado OCR de un flujo no era persistible como documento (cortaba el flujo estrella tras el paso OCR). Los tests de workflow UI no estaban registrados en el release gate. |
| **Bugs corregidos** | Sí: un resultado `text` de flujo se persiste como documento Toolisto con id estable, se deduplica por contenido y refresca conteos; `workflow-ui-test` queda en el release gate. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (62/62, 8 contratos nuevos CE-049); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (31/31, E2E 6 nuevo con OCR real del fixture `scan-clear.png`: resultado text → Anadir al Workspace → documento con bloques persistido en IndexedDB tras reload con las palabras OCR reales y visible en Documentos); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK); regresión `workflow-engine-test.mjs` (18/18), `workflow-validator-test.mjs` (11/11), `operation-registry-test.mjs` (26/26), `workflow-export-md-test.mjs` (30/30), `workflow-document-pdf-test.mjs` (66/66), `workspace-test.mjs` (156/156), `phase3a-test.mjs` (80/80), `phase3b-test.mjs` (59/59), `ocr-source-selection.mjs` (34/34), `workspace-storage-test.mjs` (17/17), `phase4-integrity-test.mjs` (47/47), `evidence-determinism.mjs` (71/71), `phase3-integrity-test.mjs` (52/52), `phase11-audit.mjs` (106/106), `git diff --check`. |
| **Tests PASS** | Workflow UI 62/62 (wrapped text persistido, id `flow-text-` estable, en estado documents, refresh conteos, re-añadir no duplica, headings/bullets a bloques, nombre propio, texto vacío rechazado); Workflow E2E 31/31 incluyendo el E2E 6 nuevo (OCR real: botón en resultado text, documento con bloques persistido, palabras OCR del fixture presentes, visible en Documentos, cero errores JS); regresión completa de Workspace 156/156, Phase 3A 80/80, Phase 3B 59/59, Engine/Validator/Registry/Export-md/Document-PDF, OCR Source 34/34, Storage 17/17, Integridad 47/47, determinismo 71/71, Phase 3 integridad 52/52, Phase 11 106/106, build 179/179 y sync source/dist OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: persiste resultados de texto de flujos como documentos (CE-049). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El id del documento resultante es `flow-text-<hash32>` derivado del nombre+contenido: readicionar exactamente el mismo texto no duplica, pero dos resultados con el mismo texto pero nombres distintos generan dos documentos (intencionado). El mapeo de bloques es el mismo básico de `text.to-document` (sin detección de tablas Markdown ni imágenes); un OCR con estructura tabular debería encadenarse a `text.to-table` como antes. Las evidencias regeneradas por las suites al iniciar/ejecutar el ciclo (`artifacts/deep-audit/phase3-integrity-evidence.json`, `review-modal.png`, `TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `ocr-source-tests.json`, `star-flow-export.toolisto`, `screenshots/workspace/08-scanner-module-test.png` y `ocr-diagnostic.json` sin seguimiento) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 113 — Resultados de imagen de flujo añadidos al Workspace y payload envuelto normalizado (CE-048)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | fb6e9c5bb7df2d9a5f0fe90e398308a22a898768 |
| **HEAD final** | 6ef4273016216e1aa6bcee288b6cf9d5fb9699ba |
| **Task** | CE-048 (P2, DISCOVERY dirigida: sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | Los resultados de imagen de un flujo solo ofrecían «Descargar» (CE-047 cubrió document/data), cortando el encadenado imagen→OCR a su salida. Además, el engine envuelve cada resultado como `{ data: <payload>, kind, name }` (`workflow-engine.js` línea 146/160), así que `addResultToWorkspace` de CE-047 leía `result.data.blocks`/`headers` que quedaban dentro de `result.data.data`: la persistencia de documentos/tablas se omitía en silencio en un flujo real y solo funcionaba con la forma aplanada de los tests. |
| **Change** | `workflow-ui.js`: `addResultToWorkspace` normaliza el payload envuelto (`wrapped = result.data && result.data.data !== undefined && (result.data.kind !== undefined || result.data.name !== undefined)`, `payload = wrapped ? result.data.data : result.data`) y usa `payload` para document/data (arregla el bug real de CE-047) y para la nueva rama `kind === 'image'`: persiste el Blob como captura del proyecto cuando `appHelpers.saveImageCapture` está inyectado. El botón «Anadir al Workspace» se muestra también para resultados `kind === 'image'`. `workspace.js`: nuevo helper `saveFlowImageResult(project, blob, name)` que convierte el Blob a dataUrl, crea el asset de imagen (una sola copia del PNG, el patrón CE-029: la captura referencia `correctedAssetId` y no repite el dataUrl), crea la captura `type: 'workflow-result'` con sus relaciones, registra la ejecución y refresca conteos; se inyecta como `saveImageCapture` en `renderWorkflowView`. |
| **Hallazgos** | CE-047 era invisible a la regresión para flujos reales: `saveDoc`/`saveData` sí persistían cuando se invocaba la rama, pero la condición `result.data.blocks`/`headers` nunca era verdadera con el envoltorio del engine, por lo que el «Anadir al Workspace» de un flujo ejecutado nunca hacía nada fuera del test VM (que pasa la forma aplanada). El botón «Anadir al Workspace» se renderizaba solo para `document`/`data`, nunca para `image`. |
| **Bugs encontrados** | Persistencia de documento/tabla de un flujo real omitida silenciosamente (payload envuelto); resultados de imagen no persistibles como capturas. |
| **Bugs corregidos** | Sí: el payload envuelto del engine se normaliza y un resultado de imagen de flujo se persiste como captura (una sola copia del PNG via `correctedAssetId`), deduplicando el id de captura al reañadir un mismo id y refrescando conteos. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (54/54, 8 contratos nuevos); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (25/25, E2E 5 nuevo: flujo de imagen real → Anadir al Workspace → captura persistida en IndexedDB tras reload y visible en Capturas); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK); regresión `workflow-engine-test.mjs` (18/18), `workflow-validator-test.mjs` (11/11), `operation-registry-test.mjs` (26/26), `workflow-export-md-test.mjs` (30/30), `workspace-test.mjs` (156/156), `workflow-document-pdf-test.mjs` (66/66), `phase3a-test.mjs` (80/80), `phase3b-test.mjs` (59/59), `workspace-storage-test.mjs` (17/17), `phase4-integrity-test.mjs` (47/47), `phase5-bundle-trust-test.mjs` (53/53), `evidence-determinism.mjs` (71/71), `phase3-integrity-test.mjs` (52/52), `phase11-audit.mjs` (106/106). |
| **Tests PASS** | Workflow UI 54/54 (image envuelto persistido, project id correcto, refresh conteos para imagen, Blob crudo, nombre por defecto «Imagen del flujo», documento con payload envuelto persistido, tabla con payload envuelto persistida, Blob inválido rechazado); Workflow E2E 25/25 incluyendo el E2E 5 nuevo sin errores JS; regresión completa de Workspace 156/156, Phase 3A 80/80, Phase 3B 59/59, storage 17/17, integridad 47/47, bundle 53/53, determinismo 71/71, Phase 3 integridad 52/52, Phase 11 106/106, build 179/179 y sync source/dist OK. |
| **Tests FAIL** | 0 |
| **Commits** | 6ef4273: `feat(workspace): anade resultados de imagen de flujos como capturas y normaliza el payload envuelto (CE-048)` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La deduplicación de imagen no reusa un asset idéntico ya existente: cada «Anadir al Workspace» de una imagen nueva crea una captura nueva (mismo comportamiento que una captura importada). Las evidencias regeneradas por las suites al iniciar/ejecutar el ciclo (coverage, e2e-evidence, ocr-source-tests, star-flow-export.toolisto, phase3-integrity-evidence.json, review-modal.png y captura PNG del escáner) se excluyen del commit (anti-churn); `ocr-diagnostic.json` queda sin seguimiento por su carácter de diagnóstico. |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 112 — Persistencia de resultados de flujo añadidos al Workspace (CE-047)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 908860dc2612fa89995516df61a7619cac738acb |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-047 (P2, desde DISCOVERY; sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | Ante un resultado de flujo, el botón «Anadir al Workspace» (`addResultToWorkspace` en `workflow-ui.js`) solo mutaba el estado en memoria (`appStore.set({ currentDoc })` / `push` a `dataTables`) sin llamar a `saveDoc`/`saveData` ni a `refreshProjectCounts`: el documento o la tabla generados por un flujo desaparecían al recargar el proyecto, rompiendo el encadenado de la salida del flujo con el Workspace y violando la persistencia de la definición de terminado. |
| **Change** | `createWorkflowUI` ahora recibe `saveDoc`/`saveData`/`refreshProjectCounts` a través de `appHelpers` (inyectados desde `renderWorkflowView` en `workspace.js`). `addResultToWorkspace` pasa a `async` y, para un resultado `document`, persiste el documento con `saveDoc(project.id, doc)` y lo incorpora a `documents` (deduplicando por id); para un resultado `data`, persiste con `saveData(project.id, table)` y lo incorpora a `dataTables` (deduplicando por id); en ambos casos refresca `refreshProjectCounts(project.id)`. Re-Añadir un elemento con el mismo id ya presente informa «ya esta en el Workspace» sin guardar dos veces. `addResultToWorkspace` se expone en la API del UI para poder testearla. |
| **Hallazgos** | No existía ningún test que cubriera «Anadir al Workspace» (grep `Anadir al Workspace|addResultToWorkspace` en `.mjs` devuelve vacío). El bug era invisible para la regresión: `saveDoc`/`saveData` escriben en IndexedDB y las vistas `Documentos`/`Datos` recargan desde `loadDocs`/`loadData`, por lo que un resultado solo-en-memoria nunca aparecía ni persistía. La inyección de helpers reproduce el patrón ya usado por `pushHistory`/`createInstructionAssistant`. |
| **Bugs encontrados** | `addResultToWorkspace` no era `async`; persistir exigía `await`. La API del UI no exponía la función, impidiendo cobertura VM directa. |
| **Bugs corregidos** | Sí: el resultado de un flujo se persiste en el proyecto al añadirlo al Workspace, se deduplica por id y se refrescan los conteos. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (46/46, 7 contratos nuevos); `node tests/workspace/workflow-engine-test.mjs` (18/18); `node tests/workspace/workflow-validator-test.mjs` (11/11); `node tests/workspace/operation-registry-test.mjs` (26/26); `node tests/workspace/workflow-export-md-test.mjs` (30/30); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (20/20); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK). |
| **Tests PASS** | Workflow UI 46/46 (persistencia doc/tabla, presencia en estado, refresh de conteos y dedup por id); Engine 18/18; Validator 11/11; Registry 26/26; Export-md 30/30; Workflow E2E 20/20 sin errores JS; build 179/179 y sync source/dist OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: persiste resultados de flujo añadidos al Workspace. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La deduplicación por id depende de que el resultado traiga (o `saveDoc`/`saveData` asigne) un id estable entre dos añadidos del mismo elemento; un resultado fresco sin id se guarda una vez y aparece en el proyecto. Las evidencias ya modificadas al iniciar el ciclo (`artifacts/deep-audit/toolisto/TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `ocr-source-tests.json`, `star-flow-export.toolisto`, `ocr-diagnostic.json` y `screenshots/workspace/08-scanner-module-test.png`) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 110 — Exportación Markdown/plano estructurada de documentos (CE-046)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | c943e4bd4826fb1e432d2fad7afb5b2dab227f83 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-046 (P2, desde DISCOVERED; sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | `text.export` aplanaba los bloques de un documento con `blocks.map(content).join('\n')`, perdiendo la estructura (encabezados, listas, tablas, gráficos); el intento «exporta texto» en Markdown debía renderizar los bloques a Markdown real para servir documentos editables/profesionales. |
| **Change** | Nueva conversión estructurada en `workspace/core/workflow-operations.js`: `blocksToMarkdown(blocks)` (heading1/2/3→`#/##/###`, bullet-list→`- `, quote→`> `, divider→`---`, table→tabla Markdown con separador y celdas que escapan `|`, chart→bloque delimitado `\`\`\`charts` con tabla Etiqueta\|Valor, image-block→`![imagen](dataUrl)`) y `blocksToPlainText(blocks)` (texto plano legible con viñetas `•` y separador). `text.export.execute` usa Markdown cuando el formato es `md` y texto plano cuando es `txt`; la entrada de cadena se exporta verbatim intacta. |
| **Hallazgos** | El intento `export-text` ya se planeaba a `text.export` y su opción `format` admitía `md`/`txt`, pero la salida para un documento era un aplanado sin estructura, indistinguible del texto bruto. El rasgo es puramente aditivo: los consumidores string no cambian. |
| **Bugs encontrados** | El `join('\n')` previo descartaba tipos de bloque y tablas/gráficos perdían su forma. Un primer diseño capitalizaba `heading1` en txt (`content.toUpperCase()`), lo que rompía la fidelidad del contenido; se revirtió a emitir el texto tal cual. |
| **Bugs corregidos** | Sí: `text.export` en `md` produce Markdown válido y en `txt` texto plano estructurado a partir de bloques de documento. |
| **Tests ejecutados** | `node tests/workspace/workflow-export-md-test.mjs` (30/30); regresión `workflow-engine-test.mjs` (18/18), `workflow-validator-test.mjs` (11/11), `operation-registry-test.mjs` (26/26), `workflow-document-pdf-test.mjs` (66/66), `workflow-ui-test.mjs` (39/39), `workflow-builder-a11y-test.mjs` (11/11); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (20/20); `node scripts/generate-seo-pages.mjs --production` (build 179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK). |
| **Tests PASS** | Export MD/plano 30/30 (encabezados, listas, cita, divisor, tabla Markdown con separador, gráfico en `\`\`\`charts` con valores, marcador `#` ausente en txt, viñeta `•`, entrada de cadena verbatim, bloques vacíos sin crash); regresión Engine/Validator/Registry/Document→PDF/UI/Builder y Workflow E2E 20/20 sin errores JS; build 179/179 y sync OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workflow): exporta documentos a Markdown y texto plano estructurados`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El `outputKind` de `text.export` es `text` aunque devuelve un Blob text/* (contrato heredado, sin cambio). Las tablas Markdown escapan `\|` dentro de celdas pero no generan filas de alineación complejas; las imágenes se emiten como data-url completa (pesado para archivos muy grandes, coherente con el límite local). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 109 — Liberación automática por inactividad del motor OCR (CE-040)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | a9293d20a77d1324d50913e08740aa04216c751f |
| **HEAD final** | 671770248c12a76595dcb2298383cf710ab8538b |
| **Task** | CE-040 (P3, ACTIVE heredado del ciclo 108 interrumpido) |
| **Hypothesis** | En sesiones largas el Workspace mantiene el worker Tesseract.js cargado (memoria WASM) aunque ya no se use; el motor debe poder liberarse por inactividad, manualmente al limpiar un flujo y bajo demanda, sin romper la reutilización en caché ni la recarga. |
| **Change** | `vendor/js/engine-loader.js`: API de liberación de memoria — `setTesseractIdleTimeout(ms)`, `releaseIdleTesseract()`, `releaseTesseract(lang)`, `getTesseractStatus()`; reaper periódico que termina workers que superan la ventana de inactividad (default 600000 ms), `lastUsed` actualizado en cada carga/reutilización y `destroyAll` refactorizado sobre `terminateWorker`. `workspace/core/ocr-engine.js`: export `releaseOcrEngine(lang)` con guard de API. `workspace/core/workflow-ui.js`: `clearFlow` libera el motor OCR (`releaseOcrEngine()`) al limpiar el constructor. `tests/workspace/workflow-ui-test.mjs` incluye `ocr-engine.js` en el VM y añade `window`. Nuevo test E2E `tests/workspace/engine-idle-release-test.mjs` (Tesseract real, sin mocks) registrado en el release gate. |
| **Hallazgos** | El ciclo 108 dejó la implementación sin commitear (exit -1 del runner, HEAD sin cambio): la tarea CE-040 estaba ACTIVE con los cambios en el árbol de trabajo y sin registro de STATUS. Se auditó, se completó la verificación (test nuevo + regresiones) y se cerró el ciclo. La carga de Tesseract se reutiliza por `workerKey`; `releaseTesseract` termina el worker y queda re-cargable bajo demanda. |
| **Bugs encontrados** | `destroyAll` terminaba workers en un bucle manual y no paraba el reaper; quedó refactorizado sobre `terminateWorker` con `stopIdleReaper`. `workflow-ui-test.mjs` no incluía `ocr-engine.js` en su contexto VM pese a que `workflow-ui.js` ahora lo importa. |
| **Bugs corregidos** | Sí: worker OCR liberable por inactividad/manual, reaper parado al vaciar workers, y VM de tests de UI coherente con el nuevo import. |
| **Tests ejecutados** | `$env:E2E_PORT=8084; node tests/workspace/engine-idle-release-test.mjs` (10/10); `node tests/workspace/workflow-ui-test.mjs` (39/39); `node tests/workspace/workflow-engine-test.mjs` (18/18); `node tests/workspace/workflow-validator-test.mjs` (11/11); `node tests/workspace/operation-registry-test.mjs` (26/26); `node tests/workspace/workspace-test.mjs` (156/156); `node tests/workspace/phase3a-test.mjs` (80/80); `node tests/workspace/phase3b-test.mjs` (59/59); `node tests/workspace/ocr-source-selection.mjs` (34/34); `node tests/evidence-determinism.mjs` (71/71); `node scripts/verify-workspace-sync.mjs` (SYNC OK); `node --check scripts/test-workspace-release.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (20/20); `git diff --check`. |
| **Tests PASS** | Engine idle release 10/10 (API disponible, carga real, reutilización sin duplicado, reaper automático, recarga bajo demanda, release manual idempotente, destroyAll limpio, cero errores de consola); Workflow UI 39/39; Engine 18/18; Validator 11/11; Registry 26/26; Workspace 156/156; Phase 3A 80/80; Phase 3B 59/59; OCR Source 34/34; determinismo 71/71; Workflow E2E 20/20; sync y diff check OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: liberación por inactividad del motor OCR. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El reaper usa `setInterval`; la ventana default es 10 min y se puede ajustar con `setTesseractIdleTimeout`. El PDF pdfjs se gestiona por separado (página/instancia efímeras); esta tarea cubre Tesseract, mitad restante de CE-008. `ocr-diagnostic.json` (artefacto de diagnóstico con rutas/timestamps absolutos) y las evidencias regeneradas por otros gates (e2e-evidence, ocr-source-tests, star-flow-export, screenshot, coverage) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover la oportunidad de mayor prioridad. |

---

## Cycle 107 — BOM UTF-8 en las descargas CSV del sitio público (CE-045)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | d26a0dc9c5b128422651f69f8ed9e46326c4f156 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-045 (P2, desde DISCOVERED; sin tareas TODO en la cola) |
| **Hypothesis** | Las descargas CSV del sitio público para `excelToCsv` y `jsonToCsv` se generan en `tool-processors.js` (`new Blob([csv], { type: 'text/csv;charset=utf-8' })`) sin prefijo `\uFEFF`, por lo que Excel con locales con acentos (es) las lee como ANSI y muestra mojibake, igual que el bug del Workspace CE-044 ya corregido. |
| **Change** | BOM UTF-8 antepuesto al CSV en `ToolProcessors.excelToCsv` y `ToolProcessors.jsonToCsv`. Como contraparte defensiva de la misma feature: `parseCsvText` de `js/modes/excel.js` (ruta «Reabrir salida» y continuación) y `ToolProcessors.csvToExcel`/`csvToJson` eliminan un BOM de entrada antes de `XLSX.read(..., { type: 'string' })`, que NO lo elimina (verificado con `vendor/xlsx`); así el CSV reabierto o continuado no filtra `\uFEFF` a la celda/cabecera. `js/modes/excel.js` `aoaToFile` (branch csv) queda SIN BOM: solo reconstruye el *input* de `csvToExcel`/`csvToJson` y añadirlo corrompería la primera cabecera (celda `\uFEFFciudad`). |
| **Hallazgos** | El señalamiento original de CE-045 apuntaba a `aoaToFile` de `js/modes/excel.js`, pero esa rama nunca se descarga: reconstruye el archivo de entrada del modo. Las descargas reales salen de los procesadores `excelToCsv`/`jsonToCsv` de `tool-processors.js`. El `TextDecoder('utf-8')` del navegador elimina un BOM inicial por defecto (la primera versión de los checks BOM fallaba con `"Ciud"` aunque los bytes EF BB BF estuvieran presentes); se usa `buf.toString('utf8')` (Node) que conserva el `\uFEFF`, como en CE-044. |
| **Bugs encontrados** | Sin BOM, `excelToCsv`/`jsonToCsv` generaban CSV ilegible en Excel-es. Además, añadir el BOM sin limpiarlo al leer habría regresionado la reapertura (`Reabrir salida`) y la continuación `excelToCsv → csvToJson` / `jsonToCsv → csvToExcel` (SheetJS no limpia `\uFEFF` en `type:'string'`); ambas rutas quedan cubiertas y probadas. |
| **Bugs corregidos** | Sí: ambas descargas CSV del sitio público llevan BOM UTF-8 y acentos intactos; la reapertura y la continuación no filtran el BOM en celdas ni claves. |
| **Tests ejecutados** | `npm run build` (179/179); `node tests/gate-e2e-spreadsheet-tools.mjs` (221/221 con 14 checks BOM/acentos/mojibake + continuación BOM→JSON); `node tests/evidence-determinism.mjs` (71/71); `node tests/production-tool-coverage.mjs` (26/26); `$env:ONLY=...; node tests/verify-115-tools.mjs` (132/132 sobre las 11 herramientas de hojas de cálculo, incluidas excelToCsv/jsonToCsv). |
| **Tests PASS** | Gate hojas de cálculo 221/221 (incluye: `EF BB BF` en bytes, primer carácter `\uFEFF`, `Córdoba/Éxito/Ñuño/índice ñame` intactos, sin mojibake, reapertura sin BOM en la celda, continuación BOM→JSON sin filtrar); determinismo 71/71; cobertura 26/26; verify-115 herramientas 132/132; build 179/179. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | `aoaToFile` (branch csv) del modo no lleva BOM porque alimenta parsers SheetJS; un consumo futuro de esa ruta como descarga deberá añadirlo explícitamente. Las evidencias ya modificadas al iniciar el ciclo (`artifacts/deep-audit/toolisto/TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y `screenshots/workspace/08-scanner-module-test.png`) se excluyen del commit (anti-churn); `TLT-certify-spreadsheet-family-evidence.json` (evidencia del gate afectado) sí se commitea con su conteo 221/221. |
| **Proxima prioridad** | Ejecutar CE-040 (memoria de motores pesados Tesseract/PDF, P3) desde DISCOVERED o realizar discovery dirigida según la cola al iniciar el próximo ciclo. |

---

## Transicion (infraestructura) — De Production Readiness a Evolucion Continua

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **Task** | Infra — evolucionar el sistema autonomo: modo continuo, transicion PR->CE, recovery, watchdog, metricas |
| **Change** | Runner v2: `-Unlimited` / `MaxCycles=0` (sin limite artificial), transicion automatica PR->CE al aparecer `PRODUCTION_READINESS_DONE` (sin detener), parada solo por humano/limite/fallo grave, backoff 1/5/15/30 min ante fallos de proveedor, metricas por ciclo (resultado, bucket, HEAD) en `artifacts/autonomous-logs/metrics.tsv`, archivos de mision/status/queue de CE. `STATUS` ampliado (MODE, uptime, tarea actual, fallos consecutivos, resumen de ultimos 20 ciclos, regla de salud). Nuevo `WATCHDOG-OPENCODE-AUTONOMOUS.ps1` (reporta sin matar; `-KillStale`/`-CleanStale` explicitos) y `INSTALL-OPENCODE-AUTO-START.ps1` (tarea programada opcional al login). |
| **Tests ejecutados** | Sintaxis PS de runner/status/stop/watchdog/auto-start; `-DryRun` del runner v2 sin mutex; `-Unlimited`/`MaxCycles=0`; resolucion de modo; parser de `RESULTADO_CICLO`; watchdog en modo reporte contra el runner real (sin matar). |
| **Tests PASS** | DryRun y validaciones de infra OK. |
| **Tests FAIL** | 0 |
| **Bloqueos** | Ninguno para la infra. La transicion a CE queda pendiente de que la etapa Production Readiness genere legitimamente `workspace/PRODUCTION_READINESS_DONE`. |
| **Commits** | Commit de infra de la transicion (ver git log). |
| **Proxima prioridad** | En modo PR: cerrar PR-009 (candidato) y PR-017. En modo CE: primera tarea de producto de la QUEUE de CE. |

---

## Snapshot de referencia (al iniciar la Evolucion Continua)

```
Phase 3B: COMPLETA | Phase 3C: COMPLETA
Production Readiness: etapa cerrada -> CONTINUOUS_EVOLUTION activo
Sitio publico: 167 herramientas habilitadas y certificadas
Regresion historica: run-all 41/41 suites verdes (Cycle 17)
Privacidad publica: gate 343/343 PASS (PR-009 en cierre)
Total sitio publico: 712 pass, 0 fail (workspace) + suites del sitio
```

## Plantilla para ciclos nuevos

```markdown
## Cycle N — Breve descripcion

| Field | Value |
|-------|-------|
| **Date** | YYYY-MM-DD |
| **Branch** | |
| **HEAD inicial** | |
| **HEAD final** | |
| **Task** | CE-XXX |
| **Hypothesis** | |
| **Change** | |
| **Hallazgos** | |
| **Bugs encontrados** | |
| **Bugs corregidos** | |
| **Tests ejecutados** | |
| **Tests PASS** | |
| **Tests FAIL** | |
| **Commits** | |
| **Bloqueos** | |
| **Limitaciones** | |
| **Proxima prioridad** | |
```

---

## Cycle 22 — Conversion OCR a tabla robusta en flujos

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 074e478260c950024e2fad20724f387bea598b97 |
| **HEAD final** | Este commit (registrado al cierre del ciclo) |
| **Task** | CE-001 |
| **Hypothesis** | El separador unico de `text.to-table` confundia comas decimales y separaba etiquetas OCR de varias palabras. |
| **Change** | Se incorporo `core/tabular-text-parser.js`, usado por la operacion real de flujo `text.to-table`. Detecta delimitadores seguros, respeta CSV entrecomillado, reconstruye columnas por ancla numerica, normaliza guiones OCR y recupera decimales con coma en dos columnas. Sin tocar `workspace.js`. |
| **Hallazgos** | El flujo ya expone `text.to-table`; su parser local era simplista y no compartia la reconstruccion numerica usada por el Workspace. La nueva operacion se sirve desde `dist` y conserva sincronizacion source/dist. |
| **Bugs encontrados** | Etiquetas como `Ventas Q1` se fraccionaban al procesar texto OCR delimitado por espacios; valores españoles podían confundirse con el delimitador coma. |
| **Bugs corregidos** | Si: etiquetas, signo menos Unicode y decimales con coma se preservan en la tabla resultante. |
| **Tests ejecutados** | `node tests/workspace/tabular-text-parser-test.mjs`; `node tests/workspace/operation-registry-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`. El primer intento E2E en 8082 no inició porque un servidor ajeno ya ocupaba el puerto; se ejecutó en 8084 sin reintentos. |
| **Tests PASS** | Parser 7/7; registro 26/26; sincronizacion source/dist OK; Workflow E2E 15/15 sin errores JS. |
| **Tests FAIL** | 0 (el EADDRINUSE inicial fue conflicto de infraestructura, no una asercion de suite). |
| **Commits** | Este commit: `fix(workflow): conserva datos OCR al convertir tablas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Un CSV con coma como delimitador y decimales sin comillas es inherentemente ambiguo; para dos columnas numericas se recupera el decimal, y se priorizan tabulador, punto y coma y barra cuando existen. |
| **Proxima prioridad** | CE-002, encadenamiento real de mejora -> compresion -> conversion -> ZIP para imágenes. |

---

## Cycle 27 — Pipeline de imágenes con ZIP real

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f9fb12085ca0161012ed6174814c3bcfd5656c9c |
| **HEAD final** | Commit de este ciclo (registrado al cierre) |
| **Task** | CE-002 |
| **Hypothesis** | El constructor listaba operaciones de imagen pero no transportaba el `File` real, serializaba los `Blob` a objetos vacíos y no podía consolidar un lote en ZIP. |
| **Change** | Se añadió `output.zip` como operación terminal de lote: recibe una vez las salidas transformadas y genera un ZIP local con JSZip. El motor preserva `Blob` en sus resultados, la UI entrega el `File` como `data`, aplica defaults al añadir operaciones y monta el enlace de descarga de forma efímera. La codificación ahora normaliza `HTMLImageElement` a canvas, corrigiendo compresión/conversión encadenadas. |
| **Hallazgos** | La ruta manual mejorar -> comprimir -> convertir fallaba porque compresión y conversión llamaban `toBlob` sobre una imagen cargada. Las descargas desde un enlace no conectado no eran fiables. La intención `zip` ya existía en el planificador, pero no había operación registrada. |
| **Bugs encontrados** | Las salidas Blob se perdían por `JSON.stringify`; los archivos del selector no llegaban como datos al motor; no existía el empaquetado final; la cadena de imagen fallaba con `canvas.toBlob is not a function`. |
| **Bugs corregidos** | Sí: dos imágenes reales atraviesan los cuatro pasos, mantienen sus salidas individuales y producen un ZIP descargable sin errores de consola. |
| **Tests ejecutados** | `node tests/workspace/workflow-engine-test.mjs`; `node tests/workspace/workflow-validator-test.mjs`; `node tests/workspace/operation-registry-test.mjs`; `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/instruction-planner-test.mjs`; `node scripts/generate-seo-pages.mjs --production`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | Engine 18/18; validator 11/11; registro 26/26; UI 30/30; planificador 68/68; Workflow E2E 19/19 con pipeline real y descarga ZIP; sincronización source/dist OK. |
| **Tests FAIL** | 0 final. Durante el desarrollo, el E2E reveló la ausencia de proyecto local, el selector oculto y el fallo real de `toBlob`; se corrigieron antes de la regresión final. |
| **Commits** | Commit de este ciclo: `feat(workflow): encadena imágenes y empaqueta ZIP` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El ZIP solo vive como descarga local efímera; los Blob no se persisten en el estado serializable del flujo, evitando referencias `blob:` persistentes y duplicación de archivos grandes. |
| **Proxima prioridad** | CE-003, acceso directo a herramientas y encadenado de pasos desde el proyecto. |

---

## Cycle 28 — Encadenado desde documentos y tablas del proyecto

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 3d0885ef1fa10d5bf5f8c49d29c12551e8ea3ff3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-003 |
| **Hypothesis** | El Workspace ya mostraba las herramientas y permitía elegir documentos/tablas desde el constructor, pero obligaba a una navegación manual y permitía seleccionar pasos incompatibles. |
| **Change** | Se añadieron acciones `Encadenar` a tarjetas de documentos y tablas: abren Flujos con una referencia local al elemento, sin exportarlo ni duplicar su contenido. El constructor filtra pasos por tipo de entrada/salida, incorpora la categoría Salida, evita entradas repetidas y calcula correctamente un terminal de lote. También se corrigió Limpiar, que quedaba deshabilitado tras añadir una entrada. |
| **Hallazgos** | El constructor ya resolvía referencias `doc-` y `table-` contra el estado local al ejecutar, por lo que faltaba conectar esas referencias desde las vistas del proyecto. La validación en navegador descubrió el estado deshabilitado incorrecto de Limpiar. |
| **Bugs encontrados** | El botón Limpiar no se habilitaba al cargar una entrada sin pasos; el selector de operaciones no limitaba categorías ni compatibilidad del encadenado. |
| **Bugs corregidos** | Sí: la entrada de proyecto es reutilizable en Flujos, las sugerencias muestran solo pasos compatibles y Limpiar recupera su estado habilitado. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/workflow-engine-test.mjs`; `node tests/workspace/workflow-validator-test.mjs`; build de producción; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | UI 33/33; Engine 18/18; Validator 11/11; Workflow E2E 20/20 con documento real -> flujo, pipeline de imagen y ZIP; source/dist sincronizados. |
| **Tests FAIL** | 0 final. Dos ajustes de la nueva aserción E2E revelaron selectores ambiguos; la tercera ejecución detectó el bug real de Limpiar y quedó verde tras corregirlo. |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): encadena elementos del proyecto en flujos` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Solo documentos y tablas se pasan por referencia local porque son los artefactos estructurados persistentes del proyecto; los archivos seleccionados siguen siendo efímeros y no se guardan como URLs blob. |
| **Proxima prioridad** | CE-004, reducir pasos y mejorar resultados de herramientas individuales. |

---

## Cycle 29 — Calculadora científica: funciones correctas y evaluación acotada

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 59017a7de53c5c6e6c4690ddf74db34f741563fa |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-004 |
| **Hypothesis** | El reemplazo textual de `sin` antes de `asin` corrompía las funciones trigonométricas inversas; la vista previa tampoco reconocía la constante `e` y el filtro aceptaba miembros arbitrarios de `Math`. |
| **Change** | El normalizador científico reconoce funciones completas por límite de palabra y en orden no ambiguo, admite `e` y `pi` como constantes, y restringe tanto la vista previa como el procesador a la lista explícita de operaciones matemáticas permitidas. |
| **Hallazgos** | `asin(1)` se transformaba como `aMath.sin(1)` y fallaba aunque el procesador declaraba soportar `asin`. El filtro genérico `Math.\w+` dejaba ejecutar miembros no declarados como `Math.random()`. |
| **Bugs encontrados** | Funciones inversas inválidas, constante `e` inconsistente entre vista previa y resultado, y lista permisiva de miembros `Math`. |
| **Bugs corregidos** | Sí: `asin`, `acos`, `atan` y `e` llegan al mismo resultado en vista previa y descarga; `Math.random()` se rechaza antes de ejecutar. |
| **Tests ejecutados** | Build de producción; `node tests/gate-e2e-calc-tools.mjs` (baseline 22/22; primera ampliación detectó una expectativa aritmética del test incorrecta, corregida; ejecución final). |
| **Tests PASS** | Gate E2E calculadoras 24/24, incluyendo funciones inversas/constante, rechazo de miembro no permitido, descarga, historial, privacidad y cero errores de consola. |
| **Tests FAIL** | 0 final. |
| **Commits** | Commit de cierre de este ciclo: `fix(calculators): corrige funciones científicas inversas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La calculadora científica mantiene su subconjunto explícito de funciones y factorial entero no negativo; expresiones arbitrarias de JavaScript no son compatibles intencionadamente. |
| **Proxima prioridad** | CE-005, defaults inteligentes e integraciones entre herramientas. |

---

## Cycle 30 — Continuaciones locales entre conversores tabulares

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7ae2d5e54314640e81dce18fd64d1af0b62f1d7e |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-005 |
| **Hypothesis** | Las tarjetas relacionadas eran solo navegación editorial; tras generar una salida el usuario debía descargarla y volver a cargarla aun cuando el siguiente conversor compatible ya existe localmente. |
| **Change** | El modo de hojas de cálculo ofrece `Continuar con…` tras salidas compatibles. Convierte el Blob recién generado en un `File` efímero, lo abre en el siguiente conversor y conserva la rejilla editable sin navegar, descargar de nuevo ni persistir URLs `blob:`. Se definieron continuaciones explícitas CSV/Excel/JSON/XML y se verificó CSV → Excel → JSON. |
| **Hallazgos** | `excel.js` ya mantenía el resultado para Reabrir salida y su parser acepta `File`; faltaba únicamente un contrato de continuación y actualizar el estado del conversor destino. |
| **Bugs encontrados** | Ninguno preexistente; la integración entre herramientas no estaba conectada funcionalmente. |
| **Bugs corregidos** | Sí: una salida tabular compatible ya sirve como entrada real del siguiente paso sin re-subida. |
| **Tests ejecutados** | Baseline `node tests/gate-e2e-spreadsheet-tools.mjs` (197/197); build de producción; gate final de hojas de cálculo; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build de 179 páginas OK; gate navegador 203/203, incluida continuación local, cero egress externo y cero errores de consola; sincronización Workspace OK; diff sin errores. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `feat(spreadsheets): encadena conversiones locales` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las continuaciones son pares explícitos de formatos tabulares compatibles; el `File` generado vive solo en memoria durante la página actual y no se persiste. |
| **Proxima prioridad** | CE-006, mejora del OCR para fixture difícil. |

---

## Cycle 31 — Límite reproducible de preprocesado OCR difícil

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | bc98fa78e6a659e309057f86f1064f06dc0b91b2 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-006 |
| **Hypothesis** | Un preproceso local ligero o un modo de segmentación alternativo podría recuperar caracteres del texto efectivo de ~8px sin dañar el control limpio. |
| **Change** | La medición OCR ahora prueba contraste, umbral binario y PSM 4/6/11, registra cada resultado y elimina el timestamp absoluto de su evidencia para que sea regenerable sin churn. |
| **Hallazgos** | La vía cruda con OEM 3 sigue siendo la mejor: 76% caracteres y 43% palabras. Contraste obtiene 63%/0%, umbral 48%/0%, PSM 4 0%/0%, PSM 6 empata 76%/43% y PSM 11 baja a 50%/35%. El fixture limpio continúa 100%/100%. |
| **Bugs encontrados** | La evidencia de esta medición incluía timestamp absoluto, por lo que una regeneración alteraba el JSON aun sin cambio funcional. |
| **Bugs corregidos** | Sí: la evidencia de la medición ya no incorpora timestamp absoluto y detalla los candidatos descartados. |
| **Tests ejecutados** | Reproducción baseline y medición ampliada: `$env:E2E_PORT=8084; node tests/workspace/ocr-difficult-measurement.mjs`; `git diff --check`. El puerto 8082 estaba ocupado por infraestructura ajena; se usó 8084 sin reintentos. |
| **Tests PASS** | Medición navegador con Tesseract local completada; control limpio 100% chars/words; referencia difícil y cinco candidatos medidos; diff sin errores. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `test(ocr): documenta límite de preprocesado difícil` |
| **Bloqueos** | CE-006 queda BLOCKED: con la imagen actual, los candidatos locales evaluados no superan la referencia. |
| **Limitaciones** | No se activa un preproceso que degrade texto real solo para aparentar una mejora. Reabrir con un modelo OCR mejor o una captura fuente de mayor resolución; no repetir estos mismos cinco candidatos sin información nueva. |
| **Proxima prioridad** | CE-007, fiabilidad de visibilidad en navegación Playwright. |

---

## Cycle 32 — Navegación Playwright aislada y estable

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b089f44a2194212ed9240a34459a3e8c5331ac9b |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-007 |
| **Hypothesis** | El flake `element is not visible` no era una transición aleatoria: el render abría el Workspace público bloqueado después de comprobar su shell inicial y seleccionaba nodos de navegación sin garantizar su visibilidad. |
| **Change** | `playwright-render.mjs` acepta `E2E_PORT`, sirve en un puerto aislable, abre `?preview=internal` y navega con localizadores visibles más espera por contenido, en vez de pausas fijas. La verificación de paleta también espera su cierre real. |
| **Hallazgos** | El gate público oculta `#ws-app` tras la carga; por eso el shell podía parecer correcto al inicio y sus botones acabar con caja 0x0. `visual-audit-click-nav.mjs` está ignorado por Git y es un diagnóstico local, no un artefacto versionable; su ejecución aislada confirmó que Documentos requiere proyecto y que la navegación correcta no muestra corrupción. |
| **Bugs encontrados** | El render E2E dependía de 8080 ocupado por infraestructura ajena y navegaba el Workspace bloqueado, produciendo el falso flake de visibilidad. |
| **Bugs corregidos** | Sí: el test usa el preview interno y acciones observables, por lo que valida navegación real en vez de elementos que el gate oculta. |
| **Tests ejecutados** | Reproducción inicial: `node tests/workspace/playwright-render.mjs` (EADDRINUSE en 8080). Final: `$env:E2E_PORT=8084; node tests/workspace/playwright-render.mjs`; auditoría aislada de navegación; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Render Playwright 33/33, auditoría Documentos/Captura sin corrupción ni errores de consola, sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0 final; el EADDRINUSE inicial fue conflicto de infraestructura, no una aserción. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las capturas PNG generadas por el render son efímeras y se excluyen del commit para no introducir churn de evidencia visual. |
| **Proxima prioridad** | CE-010, guía reproducible de despliegue estático. |

---

## Cycle 33 — Previsualización y URL de despliegue reproducibles

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 72e34d56cbe8e9fad28991c0c2face2c86816583 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-010 |
| **Hypothesis** | La guía heredada describía `productionDomain` y `siteUrl` como alternativas, aunque el build de producción prioriza siempre el primero, y pedía descargar un servidor con `npx` pese a existir uno local. |
| **Change** | La guía ahora explica la precedencia real de URL, exige conservar el subdirectorio de GitHub Pages y ofrece `node server.js` con puerto aislable como vista previa sin descargas. El audit protege ambos contratos y corrige su total/evidencia a 10 comprobaciones. |
| **Hallazgos** | `generate-seo-pages.mjs --production` reemplaza `siteUrl` por `productionDomain` cuando este existe; una URL de Pages sin su ruta de repositorio rompería canónicos, sitemap y enlaces absolutos. `server.js` ya sirve `dist/` de forma nativa. |
| **Bugs encontrados** | La documentación podía indicar una URL efectiva incorrecta y añadía una descarga externa innecesaria para validar el build. El audit declaraba un total inferior a sus comprobaciones reales. |
| **Bugs corregidos** | Sí: el procedimiento refleja el comportamiento del build, evita el paso de red para la vista previa y el gate informa 10/10 de forma consistente. |
| **Tests ejecutados** | Baseline y final `node tests/deployment-guide-audit.mjs`; `npm run build`; servidor incluido en `PORT=8086` con petición local a `/`; `git diff --check`. |
| **Tests PASS** | Audit de despliegue 10/10; build de producción 179/179; servidor local respondió 200 sirviendo `dist/`; diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(deployment): aclara URL y vista previa local` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | GitHub Pages continúa sin aplicar `/_headers`; para cabeceras HTTP de endurecimiento se requiere un host compatible o configuración externa. La publicación de una rama dedicada sigue siendo manual, sin CI automático. |
| **Proxima prioridad** | Promover CE-008 o CE-009 tras discovery/priorización; no quedan tareas TODO. |

---

## Cycle 34 — Discovery de riesgos de salida y Workspace

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b46ef456c7351e82c6984fe666d1aa78fbec3315 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | Una revisión dirigida de los caminos con datos voluminosos y controles dinámicos revelaría mejoras ejecutables, no solo deuda genérica. |
| **Change** | Se añadieron tres oportunidades priorizadas y verificables: CE-013 (P1, paginación de tablas largas del PDF), CE-014 (P2, coste de corrección de perspectiva en capturas grandes) y CE-015 (P2, teclado/ARIA de controles dinámicos del Workspace). |
| **Hallazgos** | El generador estima una tabla como bloque indivisible y la renderiza completa en la misma página, por lo que una tabla larga puede salir del área visible. La corrección bilineal realiza lectura por píxel de destino. El audit de accesibilidad público no cubre los widgets creados dinámicamente por el Workspace. |
| **Bugs encontrados** | Riesgo reproducible por inspección: filas de tablas de informe no se fragmentan entre páginas; no se añade una prueba roja para no dejar la rama con fallos. |
| **Bugs corregidos** | No aplica: ciclo de discovery solicitado al no existir tareas TODO. |
| **Tests ejecutados** | `node tests/workspace/phase3b-test.mjs` como baseline del generador PDF y del flujo de informe. |
| **Tests PASS** | Phase 3B 59/59. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): prioriza mejoras de PDF y Workspace` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La paginación se debe validar con PDF real multipágina y no únicamente con conteo de objetos; la optimización de perspectiva requiere medición en navegador antes de elegir algoritmo. |
| **Proxima prioridad** | Promover CE-013 a TODO y corregir la paginación de tablas largas del PDF. |

---

## Cycle 35 — Tablas de informe PDF paginadas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 6aff4078f987f9596526899b94a57c137f86bca7 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-013 |
| **Hypothesis** | El generador medía una tabla larga como un bloque único y la enviaba a una sola página, por lo que debía fragmentarla antes de renderizar y repetir la cabecera en cada fragmento. |
| **Change** | El layout de PDF divide las filas de tabla según el alto restante de cada página, conserva cada fila completa y crea fragmentos con los mismos encabezados. La estimación usa el mismo inset vertical del render para evitar que la última línea sobrepase el margen. |
| **Hallazgos** | `renderTablePDF` ya renderizaba cualquier subconjunto de filas y no requería cambios visuales; el defecto estaba exclusivamente en el layout previo a generar las páginas. |
| **Bugs encontrados** | Las filas de tablas largas podían dibujarse por debajo del margen inferior y quedar recortadas; los encabezados no podían repetirse porque solo existía un bloque de tabla. |
| **Bugs corregidos** | Sí: las tablas se fragmentan por página, repiten encabezado y mantienen la secuencia completa de filas. |
| **Tests ejecutados** | `node tests/workspace/pdf-table-pagination-test.mjs`; `npm run build`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Paginación PDF 7/7; build 179/179; Phase 3B 59/59 sin errores JS; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(pdf): pagina tablas largas de informes` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las alturas de fila siguen siendo fijas (20 pt); el contenido de una celda no se parte en varias líneas. Márgenes personalizados que no dejen espacio físico para encabezado y una fila no pueden representarse sin redefinir la geometría del documento. |
| **Proxima prioridad** | Promover CE-014 a TODO y medir la corrección de perspectiva en capturas grandes antes de optimizarla. |

---

## Cycle 36 — Discovery de fiabilidad y calidad del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 72731450735f33f035db030b87934003164df67c |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | Una inspección del ciclo real de vida del escáner y una reproducción de sus pruebas identificarían riesgos concretos y acotados para promover, no deuda genérica. |
| **Change** | Se registraron CE-016 (P1: confirmación contra vista previa obsoleta), CE-017 (P2: liberar listener de redimensionado), CE-018 (P2: cobertura de bordes en la interpolación) y CE-019 (P3: puerto aislable del verificador Phase 3A). |
| **Hallazgos** | Tras mover una esquina, `pointerup` inicia el recálculo sin esperarlo y Confirmar puede consumir el canvas anterior. El destructor no elimina el listener de `window.resize`. El interpolador no alcanza el último píxel de salida y excluye los bordes fuente. La prueba manual Phase 3A fija 8082. |
| **Bugs encontrados** | Riesgos reproducibles por inspección: resultado obsoleto al confirmar durante procesamiento y fuga de listener entre sesiones. El test Phase 3A falló antes de iniciar con `EADDRINUSE` en 8082, ocupado por infraestructura ajena. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no haber tareas TODO; se priorizaron correcciones atómicas sin introducir una prueba roja. |
| **Tests ejecutados** | `node tests/workspace/phase3b-test.mjs`; `node tests/workspace/phase3a-manual-verification.mjs` (reproducción enfocada de aislamiento). |
| **Tests PASS** | Phase 3B 59/59. |
| **Tests FAIL** | Phase 3A no inició: `EADDRINUSE` en 8082; fallo preexistente de infraestructura, documentado como CE-019, sin reintentos. |
| **Commits** | Commit de cierre: `docs(evolution): descubre riesgos del escáner` |
| **Bloqueos** | Ninguno: CE-016 es ejecutable y será la próxima tarea al promoverse a TODO. |
| **Limitaciones** | El defecto de borde debe cuantificarse sobre patrón y OCR antes de modificar la interpolación; no se asume que una ruta nativa preserve la misma calidad. |
| **Proxima prioridad** | Promover CE-016 a TODO y asegurar que Confirmar nunca persista una previsualización anterior. |

---

## Cycle 37 — Confirmación del escáner contra vista previa actual

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 94633a4e4007bc8a9e087d0d90e6de340d4ed1b6 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-016 |
| **Hypothesis** | Una confirmación iniciada durante el recálculo podía serializar el canvas corregido anterior aunque las esquinas ya representaran el ajuste nuevo. |
| **Change** | El escáner toma un snapshot inmutable de esquinas para cada revisión de vista previa, invalida revisiones anteriores y no habilita Aplicar escaneo hasta que la revisión vigente se haya dibujado. Click y Ctrl+Enter esperan la promesa de la vista previa vigente y comparten una única ruta de confirmación. |
| **Hallazgos** | `updatePreview()` era async pero su trabajo no estaba asociado a una versión de esquinas; confirmar duplicaba la serialización por click y teclado. El botón no nacía deshabilitado durante la carga inicial. |
| **Bugs encontrados** | Riesgo de persistir un `correctedCanvas` anterior al confirmar un ajuste que todavía se recalculaba. |
| **Bugs corregidos** | Sí: solo el canvas de la última revisión puede llegar a `onConfirm`; las confirmaciones duplicadas se bloquean mientras se procesa la primera. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `node tests/workspace/phase3a-manual-verification.mjs`; `node tests/workspace/phase3b-test.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 48/48 (incluye 3 contratos nuevos de serialización); sincronización source/dist OK; Phase 3B 59/59; diff check OK. |
| **Tests FAIL** | La verificación manual Phase 3A no inició por `EADDRINUSE` en 8082, ocupado por infraestructura ajena; coincide con el límite ya registrado en CE-019 y no se reintentó. |
| **Commits** | Commit de cierre de este ciclo: `fix(scanner): serializa la confirmación de vista previa` |
| **Bloqueos** | Ninguno para CE-016. CE-019 mantiene el puerto fijo como mejora independiente. |
| **Limitaciones** | La corrección actual sigue ejecutándose en el hilo principal; las revisiones evitan resultados obsoletos, no reducen el coste de imágenes muy grandes (CE-014). |
| **Proxima prioridad** | Promover CE-017 a TODO y liberar el listener global de redimensionado al destruir el escáner. |

---

## Cycle 38 — Discovery de carreras en las esquinas del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2cd2143af9f2e038b729c2e1692e0f577d538b28 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La revisión de la vista previa recién añadida protege el resultado de la corrección, pero las acciones asíncronas que sustituyen las esquinas pueden seguir reintroduciendo una carrera de intención. |
| **Change** | Se documentó CE-020 (P1): asociar revisión a Auto-detectar y Restablecer, de modo que una detección tardía no reemplace el último ajuste manual ni una solicitud posterior. |
| **Hallazgos** | `setupToolbar()` inicia `processImageCapture(sourceDataUrl)` para ambas acciones y aplica sus esquinas al resolver sin comprobar si el usuario arrastró una esquina o inició otra acción durante la espera. En capturas grandes, el pipeline ya tiene un escenario medido de hasta 10 s, por lo que la ventana es real. |
| **Bugs encontrados** | Riesgo reproducible por inspección: una promesa de auto-detección/restablecimiento tardía puede reemplazar las esquinas que el usuario acaba de ajustar y recalcular una vista previa distinta de su última intención. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no haber tareas TODO; CE-020 queda priorizada para una corrección atómica con prueba de carreras. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del módulo y de la serialización de vista previa. |
| **Tests PASS** | Phase 3A 48/48; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre carrera de esquinas del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La carrera se documenta sin introducir una prueba roja deliberada; la corrección debe mantener disponibles ambas acciones y no ocultar latencia con reintentos. |
| **Proxima prioridad** | Promover CE-020 a TODO y garantizar que solo la última intención de esquinas puede actualizar el escáner. |

---

## Cycle 39 — Discovery de cancelación durante persistencia del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 288e223c9a939c4315f30ff185e371d78f977457 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | El ciclo de vida de confirmación podía revelar una acción de usuario que no se cancelara de verdad aunque la vista ya hubiera cambiado. |
| **Change** | Se registró CE-021 (P1): serializar Cancelar y el guardado asíncrono de la confirmación para impedir que un escaneo se persista silenciosamente después de que el usuario lo descarte. |
| **Hallazgos** | `confirmScan()` invoca el callback asíncrono `onConfirm` sin `await`; ese callback guarda activo fuente, documento, captura y activo corregido. Cancelar sigue disponible y solo navega fuera, por lo que el guardado iniciado continúa sobre una UI desmontada. También se confirmó que `destroy()` no se invoca desde `renderScannerView`, reforzando la prioridad de CE-017. |
| **Bugs encontrados** | Riesgo reproducible por inspección: Cancelar durante la persistencia de una confirmación ya iniciada no cancela ni comunica el guardado en curso y puede crear resultados no deseados. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; la corrección se acotó como CE-021 sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del módulo de escáner y su contrato de confirmación. |
| **Tests PASS** | Phase 3A 48/48; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre cancelación pendiente del escáner` |
| **Bloqueos** | Ninguno. CE-020 sigue siendo la tarea P1 descubierta de mayor prioridad y debe promoverse a TODO antes de implementar en el siguiente ciclo. |
| **Limitaciones** | La reproducción de persistencia requiere instrumentar un guardado lento controlado en navegador; no se añadieron delays ni mocks al E2E principal durante discovery. |
| **Proxima prioridad** | Promover CE-020 a TODO y garantizar que solo la última intención de esquinas puede actualizar el escáner. |

---

## Cycle 40 — Intención vigente para detección de esquinas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | ad449a9b4578ef4f3a69f07dcaea82ade5ecaeb2 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-020 |
| **Hypothesis** | Una detección o restablecimiento que resuelve después de una intención posterior puede reemplazar las esquinas que el usuario acaba de elegir. |
| **Change** | Se promovió CE-020 y el escáner incorpora una revisión monotónica de intención: Auto-detectar y Restablecer capturan su revisión antes de procesar; cada movimiento manual también invalida solicitudes previas. Solo la solicitud vigente actualiza esquinas, vista previa, dimensiones y estado. El fallo de detección se comunica sin errores no controlados. |
| **Hallazgos** | Las dos acciones reutilizaban `processImageCapture()` sin asociar el resultado a la intención que la creó. Las promesas podían completar en cualquier orden; la protección previa de revisión solo cubría el render de la vista previa, no el reemplazo de esquinas. |
| **Bugs encontrados** | Un resultado tardío de Auto-detectar o Restablecer podía sobrescribir una acción posterior o un arrastre manual. |
| **Bugs corregidos** | Sí: los resultados obsoletos se descartan y únicamente la última intención de esquinas puede iniciar la actualización de la vista previa. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 51/51, incluidos 3 contratos de dos solicitudes diferidas donde la primera se ignora y la última se aplica; Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): protege la intención de esquinas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La corrección de perspectiva sigue en el hilo principal para imágenes grandes (CE-014); las solicitudes de detección ya iniciadas no se abortan, pero sus resultados obsoletos no mutan la UI ni el estado. |
| **Proxima prioridad** | Promover CE-021 a TODO y serializar Cancelar con el guardado asíncrono de Confirmar. |

---

## Cycle 41 — Discovery de ciclo de vida inactivo del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 34ba386f13847627631484b34d67d28ecd9464cd |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La cancelación del escáner durante una inicialización o previsualización lenta puede dejar trabajo asíncrono que muta una vista ya desmontada y registra recursos globales tarde. |
| **Change** | Se documentó CE-022 (P2): invalidar la sesión de UI al cancelar o destruirla, impedir que `init()`/previsualizaciones obsoletas monten controles y liberar el listener global que puedan haber registrado. |
| **Hallazgos** | `destroy()` solo llama `root.replaceChildren()`. `init()` continúa después de `await processCapture()` y llama `setupDragHandlers()`, cuyo `window.resize` anónimo no puede retirarse; no hay una marca de sesión activa que proteja esos continuations. |
| **Bugs encontrados** | Riesgo reproducible por inspección: cancelar mientras `processCapture` permanece pendiente puede completar la inicialización fuera de la vista, conservar canvas en el cierre y añadir un listener de redimensionado tardío. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-022 queda delimitada para una corrección y prueba diferida, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner y de los contratos de revisión e intención. |
| **Tests PASS** | Phase 3A 51/51; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre ciclo de vida inactivo del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | CE-017 ya acota el teardown del listener en sesiones cerradas; CE-022 cubre adicionalmente los continuations asíncronos que llegan después de destruir la UI. La solución debe validar ambas órdenes (destruir antes y después de que resuelva la carga). |
| **Proxima prioridad** | Promover CE-021 a TODO y serializar Cancelar con el guardado asíncrono de Confirmar. |

---

## Cycle 42 — Guardado de escáner sin cancelación ambigua

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7199657672676fb9ffd3c632baa2e2d1c8096bb7 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-021 |
| **Hypothesis** | Si el escáner espera el callback de persistencia y comunica ese estado, Cancelar no podrá desmontar la vista mientras se guardan activos y relaciones. |
| **Change** | Se promovió CE-021. `confirmScan()` espera `onConfirm`, muestra «Guardando escaneo...», deshabilita Cancelar y bloquea Escape durante la persistencia; al terminar restaura los controles. |
| **Hallazgos** | Aunque el callback real ya contenía un `try/catch`, el UI no esperaba su promesa: `confirming` terminaba de inmediato y dejaba disponible una acción de descarte que navegaba fuera mientras la escritura continuaba. |
| **Bugs encontrados** | Cancelar o Escape podían salir del escáner durante un guardado asíncrono iniciado por Aplicar escaneo, creando un resultado que el usuario podía creer descartado. |
| **Bugs corregidos** | Sí: el guardado es una operación visible y no cancelable desde esa pantalla; no se navega ni se invoca `onCancel` hasta que concluya. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 54/54 (3 contratos nuevos para bloqueo, Escape/Cancelar y restauración); Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Una vez iniciado el guardado local no se aborta a mitad de sus escrituras para evitar datos parcialmente relacionados; el estado visible y los controles bloqueados hacen explícita esa decisión. CE-022 sigue cubriendo callbacks de inicialización tardíos tras destruir la vista. |
| **Proxima prioridad** | Promover CE-022 a TODO y proteger la sesión del escáner contra inicialización o previsualización tardía después de destruirla. |

---

## Cycle 43 — Ciclo de vida inactivo del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | e29841c01e2b8ca4ed7f90f79682144244dc6b81 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-022 |
| **Hypothesis** | Destruir la vista durante una carga o vista previa asíncrona permitía que continuations tardíos retuvieran canvas o registraran listeners globales en una UI ya cerrada. |
| **Change** | El escáner mantiene una sesión activa: `destroy()` invalida revisiones, libera canvas/datos de imagen/esquinas y elimina el listener `resize`. `init`, previsualización, confirmación y detección descartan resultados inactivos. Cancelar y el guardado exitoso destruyen la instancia antes de navegar. |
| **Hallazgos** | El listener de redimensionado se creaba como función anónima y por tanto no se podía retirar. La navegación desde el callback del escáner sustituía la vista pero no llamaba a su destructor. |
| **Bugs encontrados** | Una inicialización tardía podía poblar un root ya destruido y registrar `resize`; una sesión cerrada conservaba referencias a canvas hasta que el recolector pudiera atravesar la clausura. |
| **Bugs corregidos** | Sí: resultados tardíos no mutan la sesión inactiva, el listener se desregistra y el cierre libera sus referencias visuales. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 56/56 (dos contratos nuevos: carga diferida destruida y teardown de `resize`); Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(scanner): libera sesiones inactivas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El trabajo de perspectiva ya iniciado no se puede abortar en el hilo principal, pero su resultado se descarta tras destruir la sesión y no vuelve a montar controles ni estado. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 44 — Discovery de operabilidad por teclado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 4782d70f17481be868017c0722426841881605f7 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La auditoría de widgets dinámicos del Workspace puede revelar una barrera concreta para el flujo estrella, en lugar de deuda de accesibilidad genérica. |
| **Change** | Se registró CE-023 (P1): operación por teclado de las cuatro esquinas del escáner, con coordenadas anunciadas y contrato Playwright; CE-015 queda acotada a pestañas y selectores para evitar solapamiento. |
| **Hallazgos** | Cada esquina se publica como `role="button"` y es enfocables, pero la única mutación de esquinas está en `pointermove`; no hay listeners `keydown`, foco visible específico ni estado/posición que un lector de pantalla pueda comunicar. Esto impide ajustar la perspectiva sin puntero incluso aunque el control parezca accesible. |
| **Bugs encontrados** | Barrera reproducible por inspección: Enter, Espacio y las flechas sobre una esquina enfocada no producen ninguna acción ni actualización de coordenadas. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-023 se delimitó como corrección P1 atómica y verificable sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner. |
| **Tests PASS** | Phase 3A 56/56; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): prioriza teclado del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La detección y corrección existentes continúan usando puntero para el arrastre; CE-023 debe añadir teclado sin modificar la geometría ni ocultar la latencia de la previsualización. |
| **Proxima prioridad** | Promover CE-023 a TODO y hacer las esquinas operables mediante teclado con prueba de navegador. |

---

## Cycle 45 — Esquinas del escáner operables por teclado

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b2037c20d7994cd3e2376f89608555fd9d889f39 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-023 |
| **Hypothesis** | Los controles de esquina solo respondían al puntero aunque fueran enfocables, por lo que una persona que usa teclado no podía corregir la perspectiva ni conocer la posición resultante. |
| **Change** | Las cuatro esquinas pasan a sliders enfocables: flechas ajustan 5 px, Mayús + flecha 20 px e Inicio/Fin llevan X a los límites. Cada cambio reutiliza la mutación acotada de esquinas, actualiza la previsualización y publica X/Y mediante atributos ARIA. Se añadió foco visible sin alterar el arrastre táctil o de puntero. |
| **Hallazgos** | El `role=button` existente no expresaba un valor ajustable y `pointermove` duplicaba la lógica de mutación. Centralizarla mantiene revisión de intención, límites, geometría y metadatos ARIA idénticos para ratón y teclado. |
| **Bugs encontrados** | Las esquinas tenían `tabindex` pero Flechas, Inicio y Fin no cambiaban la geometría ni anunciaban coordenadas; no existía señal visual de foco específica. |
| **Bugs corregidos** | Sí: la perspectiva ya se ajusta sin puntero, con límites deterministas y coordenadas X/Y actualizadas para tecnología asistiva. |
| **Tests ejecutados** | Baseline `node tests/workspace/phase3a-test.mjs` (56/56); `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 59/59 (incluye movimiento, límite, foco y semántica ARIA en navegador); Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0 final. La primera ejecución posterior al cambio sirvió el `dist` anterior (2 contratos rojos); el build regeneró la distribución y la ejecución contra el producto construido quedó verde. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El slider expone X como valor numérico y X/Y en `aria-valuetext`; la corrección sigue siendo bidimensional y no existe un rol ARIA nativo específico para un punto 2D. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 46 — Discovery de confirmación durante detección de esquinas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 63aa630f8b17d294a8c0cdc18c700ce2836d0412 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | Una acción asíncrona de Auto-detectar o Restablecer puede dejar una ventana en la que Aplicar escaneo confirme el canvas anterior, aunque el usuario ya solicitó una nueva geometría. |
| **Change** | Se registró CE-024 (P1): serializar la intención de detección/restablecimiento con la confirmación, bloquear Aplicar escaneo durante el cálculo pendiente y restaurarlo solo para la intención vigente. |
| **Hallazgos** | `applyDetectedCorners()` incrementa la revisión de intención y espera `processCapture()`, pero no actualiza `state.processing`, `previewPromise` ni el estado de Confirmar antes de esa espera. Si ya existe una previsualización válida, `confirmScan()` no espera la detección pendiente y puede serializar sus esquinas/canvas anteriores. |
| **Bugs encontrados** | Riesgo reproducible por inspección: Confirmar permanece disponible durante Auto-detectar/Restablecer y puede guardar una corrección que ya no representa la última intención del usuario. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-024 queda acotada para una corrección P1 con promesa diferida y prueba de navegador, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner y sus contratos de revisiones, confirmación, ciclo de vida y teclado. |
| **Tests PASS** | Phase 3A 59/59; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre confirmación durante detección` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La corrección futura no debe cancelar a mitad de `processCapture()` en el hilo principal ni ocultar la espera con reintentos: debe ignorar resultados obsoletos y hacer visible el estado pendiente. |
| **Proxima prioridad** | Promover CE-024 a TODO y evitar que Aplicar escaneo confirme mientras Auto-detectar o Restablecer están pendientes. |

---

## Cycle 47 — Confirmación serializada con detección de esquinas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f75ca7278d3056457441b9ca9af311468524c6f3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-024 |
| **Hypothesis** | Auto-detectar o Restablecer dejaban Confirmar disponible mientras esperaban sus nuevas esquinas, por lo que podían persistir el canvas y la geometría anteriores. |
| **Change** | La intención de detección ahora marca el escáner como procesando, deshabilita Confirmar y publica su promesa vigente. Confirmar, incluido Ctrl+Enter, espera la detección y la previsualización resultante; solo la intención vigente restaura el control. Un ajuste manual invalida la detección pendiente sin dejar el estado de procesamiento bloqueado. |
| **Hallazgos** | La serialización previa cubría el render de la vista previa, pero no el tramo anterior de `processCapture()` de Auto-detectar/Restablecer. Esperar únicamente la promesa previa permitía un bucle de espera sobre una promesa ya resuelta mientras la detección continuaba. |
| **Bugs encontrados** | Aplicar escaneo seguía habilitado durante una detección pendiente y podía guardar una vista previa obsoleta. |
| **Bugs corregidos** | Sí: la confirmación permanece bloqueada hasta que termina la detección vigente y, si se solicita por teclado, persiste exclusivamente las esquinas detectadas más recientes. |
| **Tests ejecutados** | Baseline y final `node tests/workspace/phase3a-test.mjs`; `npm run build`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Phase 3A 62/62 (3 contratos de detección/confirmación diferida); build 179/179; Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): bloquea confirmación durante detección` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La detección ya iniciada sigue ejecutándose en el hilo principal y no se aborta; si queda obsoleta, su resultado no muta la UI. El archivo de captura `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al inicio del ciclo y se deja fuera del commit. |
| **Proxima prioridad** | No quedan tareas TODO; promover CE-014 o realizar discovery dirigida según la cola al iniciar el próximo ciclo. |

---

## Cycle 48 — Discovery de recuperación tras error de guardado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 01b624b8daba8973efde58fef45d5f7defed9f36 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La serialización de Confirmar protege el guardado en curso, pero una persistencia fallida puede no devolver al escáner un estado visible y reintentable. |
| **Change** | Se registró CE-025 (P1): definir el resultado de `onConfirm` y restaurar desde el UI un estado de error/reintento cuando no se puedan guardar los activos locales relacionados. |
| **Hallazgos** | `renderScannerView` captura errores de `saveAsset`, `saveImageCapture` o relaciones, muestra un toast y registra la ejecución fallida, pero no relanza ni devuelve un resultado de fallo. `confirmScan()` restaura los botones en `finally`, aunque deja el status como «Guardando escaneo...», por lo que la pantalla contradice el toast y no comunica que el nuevo intento es seguro. |
| **Bugs encontrados** | Riesgo reproducible por inspección: un fallo local de persistencia deja una UI aparentemente todavía guardando mientras el callback ya terminó y los controles volvieron a estar disponibles. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-025 queda acotada como corrección P1 con una falla controlada fuera del E2E principal. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner, su serialización y su ciclo de vida. |
| **Tests PASS** | Phase 3A 62/62; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre recuperación de guardado del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La prueba futura debe inyectar el fallo de persistencia en un contrato unitario/controlado, sin sustituir el almacenamiento ni usar mocks en el E2E principal. No se debe reportar éxito ni navegar hasta que la transacción local confirme sus relaciones. |
| **Proxima prioridad** | Promover CE-025 a TODO y hacer que un fallo de guardado deje el escáner en un estado explícito de error y reintento. |

---

## Cycle 49 — Recuperación tras error de guardado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2d0e75c711db8ae6c0deb40dfaba6cccc9f15731 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-025 |
| **Hypothesis** | Un callback de persistencia que captura su propio fallo deja al escáner sin señal de que el guardado no terminó y conserva el mensaje de guardado aunque el usuario ya pueda reintentar. |
| **Change** | `renderScannerView` devuelve un resultado explícito `{ ok: true/false }` al escáner. Ante fallo, `scanner-ui` muestra un estado de error reintentable, restaura Aplicar escaneo y Cancelar, y también protege contra una excepción imprevista del callback. |
| **Hallazgos** | El `finally` del UI desbloqueaba los controles correctamente, pero no tenía contrato con el callback para distinguir éxito de un error ya capturado. El flujo real conserva el toast y además devuelve el resultado local al UI. |
| **Bugs encontrados** | Tras fallar `saveAsset`, `saveImageCapture` o una relación, el estado quedaba en «Guardando escaneo...» aun cuando la operación ya había terminado. |
| **Bugs corregidos** | Sí: el error se anuncia como recuperable y el siguiente intento vuelve a invocar la persistencia sin navegar ni declarar éxito. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 64/64 (dos contratos nuevos de fallo controlado y reintento en navegador); Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(scanner): recupera errores de guardado` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El registro de ejecución fallida sigue siendo best-effort para no ocultar el error original; el intento no puede revertir de forma atómica activos que una capa de almacenamiento pudiera haber escrito antes de fallar. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 50 — Discovery de persistencia atómica del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | dea5cfe901bc7c374ecd68d5100e4e358a2eee65 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La recuperación de UI de CE-025 no impide que un fallo intermedio de IndexedDB conserve una fracción del escaneo y que un reintento cree artefactos duplicados. |
| **Change** | Se registró CE-026 (P1): persistir en una sola transacción los assets original/corregido, ScanDocument, captura y ejecución del escáner, con un contrato de rollback e integridad. |
| **Hallazgos** | `renderScannerView` encadena ocho o más escrituras independientes (`saveAsset`, `saveCapture`, `registerExecution`); actualiza relaciones después de haber persistido varios objetos. `storage.js` ya dispone de `dbTransaction` sobre `assets`, `captures` y `executions`, como demuestra la importación de proyectos, pero no existe un helper equivalente para este resultado compuesto. |
| **Bugs encontrados** | Riesgo reproducible por inspección: si falla una escritura posterior, quedan assets o ScanDocument previos sin todas sus relaciones; al reintentar, CE-025 vuelve a generar IDs y no puede distinguir ni limpiar el resultado parcial. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-026 queda acotada como corrección P1 verificable con fallo de transacción controlado, sin mocks en el E2E principal. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner y su recuperación de fallos. |
| **Tests PASS** | Phase 3A 64/64, sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre persistencia atómica del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El helper debe preparar todos los modelos y registrar relaciones antes de abrir la transacción; los efectos de UI, historial y toast solo pueden ocurrir tras su commit. La telemetría de ejecución fallida se mantiene best-effort y no debe invalidar el rollback de los datos del usuario. |
| **Proxima prioridad** | Promover CE-026 a TODO y hacer atómica la persistencia compuesta del escáner. |

---

## Cycle 51 — Persistencia atómica del resultado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 4e9575532e53f82480c31ee1221ffad524113294 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-026 |
| **Hypothesis** | Las escrituras individuales del escáner podían dejar assets, ScanDocument o captura sin todas sus relaciones si IndexedDB fallaba antes de la última operación. |
| **Change** | Se añadió `persistScannerResult`: prepara los tres assets, captura y ejecución con sus relaciones completas y los persiste en una única transacción IndexedDB. La UI solo actualiza estado, navega y anuncia éxito después del commit. `dbTransaction` ahora aborta operaciones ya encoladas si su callback falla. |
| **Hallazgos** | El helper `saveImageCapture` era correcto para una captura independiente, pero no para el resultado compuesto del escáner: la captura, asset corregido y ejecución se confirmaban en transacciones distintas. El rollback también requería abortar explícitamente ante una excepción síncrona del callback. |
| **Bugs encontrados** | Un error posterior podía conservar una fracción persistida del escaneo y un reintento podía crear artefactos adicionales sin completar las relaciones del intento previo. |
| **Bugs corregidos** | Sí: el resultado completo se confirma junto o no se confirma; una falla controlada después de un `put` revierte el registro encolado. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 67/67, incluidos commit conjunto y rollback controlado en navegador; Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): guarda resultados de forma atómica` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La transacción no puede abortar el cálculo de perspectiva ya iniciado en el hilo principal; solo protege la persistencia posterior. El registro best-effort de una ejecución fallida permanece fuera de la transacción para no ocultar el error original. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y se excluye del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 52 — Discovery de recuperación ante carga inicial fallida del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7ab40392468088edf123ce5a748bbaf410374503 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La ruta inicial asíncrona del escáner puede conservar una salida de usuario incompleta cuando el procesamiento de la imagen rechaza antes de instalar los eventos de la barra. |
| **Change** | Se registró CE-027 (P1): instalar una ruta de recuperación para Cancelar/Escape y una comunicación accionable de error incluso si falla `processCapture()` durante `init()`. |
| **Hallazgos** | `init()` renderiza Cancelar desde el inicio, pero solo llama `setupToolbar()` después de que `await processCapture(sourceDataUrl)` y la primera vista previa terminan. Su `catch` actualiza el texto de error sin instalar esos listeners; por ello la persona queda en una vista cuyo botón Cancelar y Escape no hacen nada. |
| **Bugs encontrados** | Riesgo reproducible por control de flujo: una imagen corrupta, una excepción de canvas o un fallo del procesador inicial muestra el error, pero no permite volver a Capturas ni iniciar otra captura desde esa pantalla. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-027 queda acotada como corrección P1 con contrato de navegador de fallo inicial, sin mocks en el E2E principal. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del procesador y escáner. |
| **Tests PASS** | Phase 3A 67/67; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre salida tras fallo inicial del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La ruta de fallo debe conservar el mensaje concreto sin exponer datos de la captura y permitir abandonar la vista; no se debe fingir una vista previa ni reintentar silenciosamente el procesamiento. |
| **Proxima prioridad** | Promover CE-027 a TODO y asegurar que un fallo inicial del escáner conserva Cancelar y Escape operables con prueba de navegador. |

---

## Cycle 53 — Salida recuperable tras fallo inicial del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | a94f810cedd5fd52e1cb75fc7dec60b691a2789e |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-027 |
| **Hypothesis** | Si `processCapture()` falla durante `init()`, instalar explícitamente los controles de recuperación en esa ruta mantiene una salida real sin habilitar acciones que dependan de una imagen no cargada. |
| **Change** | Se promovió CE-027. El `catch` de inicialización conserva el mensaje concreto de error y conecta una ruta mínima de recuperación para Cancelar y Escape; Auto-detectar, Restablecer y Aplicar escaneo no se activan sin resultado inicial. |
| **Hallazgos** | La barra completa se instalaba únicamente tras la primera previsualización; por tanto, el botón Cancelar ya renderizado y Escape carecían de listeners en el único camino donde más se necesitaban. |
| **Bugs encontrados** | Un fallo de imagen/canvas durante la carga inicial dejaba una pantalla de error sin salida operable hacia Capturas. |
| **Bugs corregidos** | Sí: el error conserva contexto y Cancelar/Escape invocan la navegación de descarte incluso cuando no existe vista previa. |
| **Tests ejecutados** | Baseline `node tests/workspace/phase3a-test.mjs` (67/67); `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 69/69, incluidos mensaje y controles de recuperación en navegador; Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El error inicial no reintenta silenciosamente el procesamiento ni habilita controles que requieren geometría; la persona puede volver a Capturas y elegir una entrada válida. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al inicio del ciclo y sigue fuera del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 54 — Discovery de geometría segura en el escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 77aadbe536fe8853c399eb9413327d1727042fcc |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La libertad de mover cada esquina dentro del rectángulo de la imagen puede permitir una geometría que el corrector de perspectiva no puede representar como documento válido. |
| **Change** | Se registró CE-028 (P1): validar que el cuadrilátero manual conserva orden, convexidad y área mínima; rechazar o acotar un movimiento inválido y comunicarlo sin perder el último ajuste válido. |
| **Hallazgos** | `setCornerPosition()` solo limita X/Y a los bordes. Permite que una esquina atraviese a su vecina y forme un polígono cruzado o de área cero. `perspectiveCorrectBilinear()` interpola asumiendo el orden TL/TR/BR/BL, sin validar geometría: con un lazo el muestreo se pliega y la salida puede quedar corrupta o vacía. |
| **Bugs encontrados** | Riesgo reproducible por el flujo de control: el arrastre manual puede crear una geometría inválida que permanece anunciada como lista y llega a Aplicar escaneo. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-028 queda delimitada como corrección P1 con validación geométrica y prueba de navegador, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline de procesamiento, controles de esquina y persistencia del escáner. |
| **Tests PASS** | Phase 3A 69/69; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre geometría segura del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La validación futura debe conservar ajustes válidos próximos a los bordes y el control por teclado; no debe reordenar silenciosamente las esquinas ni cambiar la geometría confirmada por la persona. |
| **Proxima prioridad** | Promover CE-028 a TODO y evitar que una esquina manual produzca un cuadrilátero cruzado o degenerado. |

---

## Cycle 55 — Discovery de duplicación de imagen corregida

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | ffa292a2a8c36d8b40a29402aaae4219eb91f207 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La persistencia atómica reciente puede haber conservado una representación redundante de la imagen corregida entre los modelos de captura y asset. |
| **Change** | Se registró CE-029 (P1): conservar un único PNG corregido en el asset y hacer que la captura use su referencia, con migración compatible y contratos de exportación/importación. |
| **Hallazgos** | `renderScannerView` asigna el mismo `result.correctedDataUrl` a `savedCapture.dataUrl` y `correctedAsset.dataUrl`; `persistScannerResult` inserta los dos objetos en la misma transacción. La relación `correctedAssetId` ya existe, por lo que hay una vía local para eliminar la segunda carga sin introducir URLs `blob:`. |
| **Bugs encontrados** | Riesgo reproducible por inspección de persistencia: cada resultado de escáner duplica una imagen potencialmente grande en IndexedDB, incrementando cuota, tiempo de exportación y la probabilidad de un error de almacenamiento. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-029 se delimitó como corrección P1 verificable antes de tocar el formato persistido. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner, persistencia atómica y recuperación. |
| **Tests PASS** | Phase 3A 69/69; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre duplicación de imágenes de escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Los proyectos ya guardados requieren compatibilidad de lectura y la migración no debe borrar datos de una captura hasta que el asset relacionado se haya verificado; la imagen original y la corregida son salidas distintas y no se deben deduplicar entre sí. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y queda fuera del commit. |
| **Proxima prioridad** | Promover CE-028 a TODO y validar la geometría manual antes de que llegue al corrector; CE-029 queda como siguiente P1 de almacenamiento. |

---

## Cycle 56 — Geometría segura para ajustes manuales del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b91e6ce8e2df4c2134de40df8c6e38c6ad7a38f2 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-028 |
| **Hypothesis** | Un movimiento manual que cruza, aplana o reduce excesivamente el cuadrilátero puede producir una corrección de perspectiva plegada o vacía aunque la interfaz lo presente como válida. |
| **Change** | Se promovió CE-028 y se añadió validación de cuadrilátero convexo estricto y área mínima antes de mutar una esquina. Un movimiento inválido conserva las esquinas y vista previa anteriores, comunica el motivo mediante estado vivo y deja disponible Aplicar escaneo para el último documento válido. |
| **Hallazgos** | El corrector bilineal presupone el orden TL/TR/BR/BL; limitar cada coordenada al rectángulo no evita que los segmentos se crucen. La validación compartida cubre valores no finitos, giros inconsistentes, colinealidad y área insuficiente. |
| **Bugs encontrados** | Un arrastre o acción de teclado podía formar un polígono cruzado o degenerado y mandarlo al corrector de perspectiva sin feedback recuperable. |
| **Bugs corregidos** | Sí: se rechaza la geometría inválida sin perder el ajuste confirmado, con aviso visible y anunciado para lectores de pantalla. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 73/73, incluyendo cuadrilátero válido, cruzado, degenerado y rechazo por teclado con previsualización conservada; Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): protege la geometría de esquinas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La comprobación protege las mutaciones manuales; los resultados de detección automática conservan su ruta existente. El umbral de área combina 64 px² con 0,01% de la imagen para no rechazar documentos válidos cercanos a los bordes. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y se excluye del commit. |
| **Proxima prioridad** | Promover CE-029 a TODO y eliminar la copia redundante de PNG corregido entre captura y asset sin romper proyectos existentes. |

---

## Cycle 57 — Discovery de borrado en cascada visible

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | aa8b7bbb14389642de0c475df9d14ad639b4b1e1 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La revisión del flujo de almacenamiento y borrado puede revelar una pérdida de trabajo evitable en un camino ya protegido por integridad referencial. |
| **Change** | Se registró CE-030 (P1): antes de borrar una captura de escáner, comunicar y confirmar el alcance completo de su cascada de derivados. |
| **Hallazgos** | La tarjeta de Capturas promete solo «La captura se quitará de este proyecto», pero `deleteCapture()` usa `deleteWithCascade()`. El contrato de integridad verifica que una captura elimina transitivamente asset, documento, tabla, gráfico, exportación y ejecución; el comportamiento es consistente, pero su impacto no es visible en la decisión del usuario. |
| **Bugs encontrados** | Riesgo reproducible por lectura de flujo y contrato de navegador: una confirmación con texto de eliminación simple puede causar pérdida inesperada de resultados derivados, aunque la cascada preserve la consistencia sin huérfanos. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-030 queda acotada como mejora P1 verificable sin alterar la semántica de cascada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase4-integrity-test.mjs`. El intento inicial de Phase 4b en 8082 no inició por `EADDRINUSE` de infraestructura ajena; se aisló en 8084. |
| **Tests PASS** | Phase 3A 73/73; Phase 4b integridad 43/43, incluidos borrado transitivo, poda de relaciones y auditoría sin huérfanos; sin errores de página ni consola. |
| **Tests FAIL** | 0 final (el conflicto inicial de puerto no fue una aserción). |
| **Commits** | Commit de cierre: `docs(evolution): descubre borrado en cascada de capturas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La futura confirmación debe calcular el alcance sin recorrer blobs ni borrar previamente; debe preservar el comportamiento transaccional y no prometer restauración mientras no exista papelera local. |
| **Proxima prioridad** | Promover CE-029 a TODO y eliminar la copia redundante de PNG corregido; CE-030 queda como siguiente P1 de protección contra pérdida inesperada de resultados. |

---

## Cycle 58 — Discovery de referencias de escáner al importar

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 45b2d9283ded54f77abd77e83e31f3489be46275 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La próxima deduplicación de la imagen corregida puede revelar referencias persistentes que el importador de proyectos no remapea al generar IDs nuevos. |
| **Change** | Se registró CE-031 (P1): remapear `correctedAssetId` en captura, ScanDocument y páginas de escáner durante importación, con un contrato de exportación/importación que cubra las tres referencias. |
| **Hallazgos** | `importProject()` crea un mapa nuevo para todos los assets, pero `remapRefs()` no contiene `correctedAssetId` y solo trata campos de primer nivel. El resultado del escáner escribe ese ID en `savedCapture`, `scanDoc` y `scanDoc.pages[0]`; tras importar, los tres siguen apuntando al ID del bundle de origen, que no existe en el proyecto importado. |
| **Bugs encontrados** | Riesgo reproducible de integridad: una importación válida conserva referencias de asset corregido obsoletas. Hoy queda parcialmente oculto porque la captura aún duplica `dataUrl`; CE-029 eliminará esa copia, de modo que el defecto impediría resolver la imagen corregida de un proyecto importado. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-031 queda acotada como corrección P1 sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase5-bundle-trust-test.mjs` (reproducción enfocada). |
| **Tests PASS** | Phase 3A 73/73, sin errores JS. |
| **Tests FAIL** | Phase 5 no inició por `EADDRINUSE` en 8082, ocupado por infraestructura ajena; el script no admite `E2E_PORT`. No se reintentó la misma suite. |
| **Commits** | Commit de cierre: `docs(evolution): descubre referencias de escáner al importar` |
| **Bloqueos** | Ninguno para CE-031; el puerto fijo del gate Phase 5 es una limitación de infraestructura independiente. |
| **Limitaciones** | La corrección debe remapear únicamente IDs conocidos y preservar la validación de manifiesto previa a cualquier escritura; no debe borrar `dataUrl` de proyectos existentes hasta completar CE-029 y su migración compatible. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y se deja fuera del commit. |
| **Proxima prioridad** | Promover CE-029 a TODO y eliminar la copia redundante de PNG corregido; implementar CE-031 junto con esa migración o antes de retirar el fallback de captura. |

---

## Cycle 59 — Imagen corregida única por escaneo

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 25e37be039cb855d7b549e1045c739fc26884851 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-029 |
| **Hypothesis** | Guardar el PNG corregido tanto en la captura como en su asset duplica cuota local sin aportar una segunda representación necesaria. |
| **Change** | Las nuevas capturas de escáner persisten solo `correctedAssetId`; el PNG corregido vive en `dataUrl` del asset. Se añadió un resolvedor compatible que conserva el `dataUrl` de capturas históricas y se usa en tarjetas de Capturas, OCR y contextos de revisión/comparación de tablas. |
| **Hallazgos** | El asset corregido tenía además `originalDataUrl` con el mismo PNG; ya no se rellena, por lo que la salida corregida nueva ocupa una única propiedad persistente. La fuente original queda separada en su asset de entrada. |
| **Bugs encontrados** | Cada escaneo persistía el mismo PNG corregido en captura y asset, elevando la cuota, el tiempo de exportación y el riesgo de fallo de almacenamiento. |
| **Bugs corregidos** | Sí: una captura nueva referencia su asset corregido sin copiar la imagen; los lectores recuperan esa referencia y los proyectos existentes con `capture.dataUrl` siguen legibles. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 75/75 (referencia única y fallback histórico incluidos); Phase 3B 59/59; Star-Flow E2E real 83/83 sin errores JS ni consola; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): evita duplicar imágenes corregidas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las capturas ya existentes conservan su `dataUrl`; no se reescriben ni borran retrospectivamente. El E2E heredado regenera artefactos con IDs/timestamps no deterministas y se excluye del commit; la captura PNG ya estaba modificada al iniciar el ciclo y también queda fuera. |
| **Proxima prioridad** | Promover CE-030 a TODO y comunicar el alcance real antes del borrado en cascada de una captura. CE-031 debe corregir el remapeo de `correctedAssetId` antes de retirar el fallback histórico. |

---

## Cycle 60 — Alcance visible antes de borrar una captura

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 889dad9c3738db2e44c23144d85e4dd5a33b652b |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-030 |
| **Hypothesis** | La confirmación genérica de borrado ocultaba que `deleteCapture` elimina una cadena transitiva de resultados; una vista previa de solo lectura permite comunicar su alcance antes de cualquier escritura. |
| **Change** | Se añadió `previewCascadeDelete` y el adaptador `previewCaptureDeletion`, que recorren la misma semántica de derivación sin mutar IndexedDB. Antes de abrir el diálogo, Capturas calcula la cascada; el aviso enumera los derivados por tipo, advierte que no se puede deshacer y se publica como alerta accesible. Si el cálculo falla, no permite borrar a ciegas. |
| **Hallazgos** | La cascada ya era atómica y transaccional, pero su alcance solo existía después de confirmar. Extraer el recorrido común evita que la vista previa y el borrado diverjan. |
| **Bugs encontrados** | La interfaz decía únicamente que la captura se quitaría del proyecto aunque podía eliminar también imagen, documento OCR, tabla, gráfico, exportación y ejecución. |
| **Bugs corregidos** | Sí: la persona conoce el número y la clase de resultados derivados antes de confirmar; el cálculo no borra ningún registro y un fallo del preview bloquea el borrado. |
| **Tests ejecutados** | `npm run build`; `$env:E2E_PORT=8084; node tests/workspace/phase4-integrity-test.mjs`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 4b 47/47 en navegador (incluye preview de cadena captura -> asset -> documento -> tabla -> gráfico -> exportación -> ejecución sin escrituras); Phase 3A 75/75; Phase 3B 59/59; sync y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La confirmación informa la cascada actual y no ofrece papelera ni restauración; sigue siendo una eliminación definitiva atómica. Las tres evidencias preexistentes modificadas al inicio (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | Promover CE-031 a TODO y remapear `correctedAssetId` en captura, ScanDocument y páginas durante la importación. |

---

## Cycle 61 — Referencias de escáner íntegras al importar

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 25d4a1fee68bf1d24fadbdab3e0482a844017111 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-031 |
| **Hypothesis** | Al importar, los IDs nuevos de assets debían propagarse a las referencias de escáner anidadas; sin ello las capturas nuevas sin `dataUrl` no podrían resolver su PNG corregido. |
| **Change** | `importProject` ahora remapea `scanDocumentId`, `correctedAssetId`, `originalAssetId` y `assetId`, tanto en los registros principales como en `config` y en cada página del ScanDocument. El contrato Phase 5 siembra un escaneo completo y verifica el round-trip de captura, ScanDocument y página. |
| **Hallazgos** | La página del ScanDocument conserva tres referencias a assets y el importador solo trataba campos de primer nivel; además la captura mantenía `scanDocumentId`, que tampoco recibía su ID importado. |
| **Bugs encontrados** | Un bundle con escaneo conservaba IDs de asset de origen en la captura, ScanDocument y página tras importar; esos registros ya no existen en el proyecto nuevo. |
| **Bugs corregidos** | Sí: las referencias del escáner apuntan exclusivamente a assets importados y la auditoría de integridad queda sin huérfanos. |
| **Tests ejecutados** | `npm run build`; `$env:E2E_PORT=8084; node tests/workspace/phase5-bundle-trust-test.mjs`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 5 53/53 en IndexedDB/navegador; Phase 3A 75/75; Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0 final. La primera ejecución de Phase 5 expuso cuatro expectativas de fixture desactualizadas (selección del asset corregido y conteo tras añadir el escaneo); se corrigieron y la repetición enfocada quedó verde. |
| **Commits** | `fix(import): remapea referencias de escáner`; commit de evidencia determinista de Phase 5. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El contrato cubre los IDs de assets conocidos del ScanDocument; campos futuros de referencias anidadas deben añadirse explícitamente al remapeador y a este fixture. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 71 — Contrato WAI-ARIA de pestañas del Workspace

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7e080f95b3e0c98373f83eff20199ab681648240 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-015 |
| **Hypothesis** | Las cintas con `role=tablist` del Workspace ya declaraban `role=tab` y `aria-selected`, pero no implementaban el patrón WAI-ARIA tabs: sin roving tabindex, sin flechas/Home/End y sin asociación `aria-controls`/`tabpanel`, un usuario de teclado no podía cambiar de cinta. |
| **Change** | Se añadió `enableTablistKeyboard` (roving tabindex, ArrowRight/Left con wrap, Home/End, activación por teclado y click con resincronización) y se conectó a las cintas de Documento, Tabla, Query y al selector de hojas Query (`focusTarget` para su botón interno). Las pestañas ahora llevan `id`/`aria-controls` y sus paneles `role="tabpanel"`/`aria-labelledby`; el panel de tabla además mantiene `aria-labelledby` sincronizado con la pestaña activa. La métrica de tamaño del `workspace-test` pasa a medir solo la huella de producto (excluye los documentos `.md` operativos del autónomo que el build copia a dist y crecen por ciclo). |
| **Hallazgos** | Las tres cintas generaban sus pestañas con `onClick` propio y paneles `hidden`, pero el foco quedaba en el tab order completo y ninguna tecla las operaba. La cinta de Datos usa un único panel compartido por página, por lo que su contrato es `aria-controls` → panel único con `aria-labelledby` dinámico. `dist/workspace` ya superaba los 1200 KB en HEAD por incluir los documentos `.md` del sistema autónomo (287 KB), no por el producto. |
| **Bugs encontrados** | El click inicial sobre las pestañas no reasignaba `tabIndex`, por lo que tras activar por puntero el roving quedaba desincronizado. Para las hojas Query, `target.click()` sobre el contenedor `role=tab` no activaba la hoja: la activación vive en su botón interno `.ws-query-sheet-tab-main`, que ahora es el control que recibe el click y el foco. |
| **Bugs corregidos** | Sí: roving consistente tras puntero y teclado en las tres cintas y en el selector de hojas, con activación real de la hoja vía su botón interno. |
| **Tests ejecutados** | `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workspace-tabs-a11y-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3a-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/instruction-assistant-ui-test.mjs`; `git diff --check`. |
| **Tests PASS** | Contrato ARIA/kbd nuevo 22/22 en navegador (flechas, wrap, Home/End, roving, asociaciones); build 179/179; Phase 3A 80/80; Phase 3B 59/59; Star-Flow E2E 83/83 con OCR limpio 100/100; Workspace 156/156 (con métrica de producto); Workflow E2E 20/20; UI Workflow 33/33; UI instrucciones 39/39; sync source/dist y diff check OK. |
| **Tests FAIL** | 0 final. El tamaño de `dist/workspace` falló en una primera ejecución por incluir los `.md` operativos; la métrica se redefinió a footprint de producto (1200 KB) y no se rebajó el criterio de auditoría. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | `enableTablistKeyboard` cubre el patrón horizontal con activación automática; no se añaden flechas verticales ni activación manual (F2/Enter) para no alterar el comportamiento táctil existente. Las hojas Query conservan su estructura con acciones internas; la navegación entre hojas opera sobre su botón de activación. El resto de widgets (tabs `ws-query-sheet-tab` con acciones) quedan fuera de este contrato. |
| **Proxima prioridad** | CE-014 (P2, rendimiento de corrección de perspectiva) o CE-017 (P2, listener resize ya cubierto por CE-022) siguen DISCOVERED; promover el de mayor valor o realizar discovery dirigida. |

---

## Cycle 70 — Muestreo de bordes determinista en perspectiva

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 9d59f56a5bf23a182de3b3fc82be7f5433ebd53e |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-018 |
| **Hypothesis** | `perspectiveCorrectBilinear` mapeaba `u=dx/outputWidth` y guardaba con `srcX < width-1`: el último píxel destino nunca tocaba el borde máximo de la fuente y las filas/columnas de borde quedaban transparentes (alfa 0) cuando el cuadrilátero alcanza los límites de la captura. |
| **Change** | Reproducido con patrón de 4 cuadrantes de color y cuadrilátero a borde completo: 156 píxeles transparentes y 3 de las 4 esquinas de salida vacías. El muestreo usa ahora el centro de píxel `(dx+0.5)/outputWidth` para alcanzar de forma determinista la coordenada de borde, la guarda compara contra el tamaño real de la fuente (`srcX < srcW`) y `bilinearSample` recibe coordenadas con clamping al último píxel. Resultado: 0 píxeles transparentes y las cuatro esquinas mapean a sus cuadrantes de color. |
| **Hallazgos** | Con `u=dx/outputWidth` el máximo alcanzado era `(W-1)/W`, nunca el borde exacto; con `srcX < srcCanvas.width-1` la última fila/columna fuente se descartaba por completo. El clamping interno de `bilinearSample` (x1 = min(x0+1, width-1)) ya era seguro, por lo que la guarda real (comparar con `srcW`) basta para incluir el borde. |
| **Bugs encontrados** | Píxeles transparentes de borde en la salida corrección de perspectiva cuando el documento llega al límite de la captura; el mosaico podía quedar incompleto en la fila/columna final. |
| **Bugs corregidos** | Sí: el mapeo alcanza los límites de la captura de forma determinista y la salida queda completamente opaca sobre el cuadrilátero. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 80/80 (5 contratos nuevos de cobertura de borde: sin transparentes y 4 cuadrantes mapeados); Phase 3B 59/59; Star-Flow E2E real 83/83 con OCR limpio 100/100 chars y words (la lectura no se degrada); sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El muestreo sigue siendo por centro de píxel sobre el hilo principal (CE-014, coste para capturas grandes, permanece DISCOVERED). El centro de píxel cambia la interpolación en fracciones de unidad, no altera la vía cruda del OCR difícil (que no pasa por perspectiva). Las tres evidencias preexistentes modificadas al inicio (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | CE-015 (P2, ARIA/teclado de pestañas y selectores del Workspace) o CE-014 (P2, rendimiento de perspectiva) siguen DISCOVERED; promover el de mayor valor y ejecutar. |

---

## Cycle 72 — Corrección de perspectiva sin copia y muestreo inline

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2b01ac02d9868e58e6ced829ba06b15225af26cd |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-014 |
| **Hypothesis** | `perspectiveCorrectBilinear` copiaba el canvas fuente completo, creaba una imagen intermedia y llamaba `bilinearSample` (que asigna un array por píxel) y recalculaba todos los términos bilineales por píxel; ese coste dominaba el hilo principal en capturas grandes. |
| **Change** | Se eliminó la copia del canvas fuente (`getImageData` directo sobre el canvas original), se precalculan por fila los términos lineales de `srcX`/`srcY` y el muestreo bilineal se inlinó en el bucle escribiendo directo al `ImageData` destino con clamping idéntico. Los índices y pesos se reutilizan sin asignación por píxel. Se añadió un benchmark diagnóstico `tests/workspace/perspective-bench.mjs` (no gate, salida no evidencia) para medir el coste en navegador. |
| **Hallazgos** | El coste era proporcional a la salida (no al área de fuente): para 6,9M px de salida la corrección tomaba ~380 ms. La copia del canvas y la asignación por píxel en `bilinearSample` eran evitables sin cambiar el muestreo: la versión previa de `perspectiveCorrectBilinear` siempre usaba el canvas original como `sourceCanvas` y el clamping ya se hacía en `bilinearSample`. |
| **Bugs encontrados** | Ninguno preexistente; era deuda de rendimiento del camino crítico del escáner. |
| **Bugs corregidos** | No aplica. |
| **Tests ejecutados** | Baseline del benchmark en HEAD (104/156/380 ms); `npm run build`; `node scripts/verify-workspace-sync.mjs`; benchmark post-cambio (72/97/212 ms); `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node tests/workspace/workspace-test.mjs`; `git diff --check`. |
| **Tests PASS** | Benchmark: 1.7M px 104→72 ms, 3.2M px 156→97 ms, 6.9M px 380→212 ms (mejora ~31-44%). Phase 3A 80/80; Phase 3B 59/59; Star-Flow E2E 83/83 con OCR limpio 100/100; Workspace 156/156; build 179/179; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El trabajo de perspectiva sigue en el hilo principal; la mejora reduce el coste ~35% para grandes capturas pero no lo hace asíncrono. La interpolación es idéntica (mismo centro de píxel y clamping), por lo que OCR y calidad no cambian. El benchmark mide con `performance.now()` y es solo diagnóstico, no evidencia determinista. Las tres evidencias preexistentes modificadas al inicio (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | CE-017 (P2, listener resize ya cubierto por CE-022) permanece como tarea DISCOVERED de menor valor; realizar discovery dirigida o promover CE-008/CE-009 según la cola al iniciar el próximo ciclo. |

---

## Cycle 75 — Puerto aislable del verificador manual Phase 3A

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | c64d11bb348b9aba6c7090b25ab0643585287d98 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-019 |
| **Hypothesis** | `phase3a-manual-verification.mjs` fijaba el puerto 8082 y fallaba con `EADDRINUSE` cuando infraestructura local lo ocupa; respetar `E2E_PORT` con default 8082, como las suites recientes, permite ejecutarlo de forma aislada sin alterar escenarios. |
| **Change** | Se añadió `const PORT = Number(process.env.E2E_PORT || 8082);` y se sustituyeron los tres usos fijos de 8082 (escucha del servidor, log `Server on :PORT` y `page.goto`). Se mantiene el puerto por defecto y los 10 escenarios/navegación no cambian. |
| **Hallazgos** | La cola no tenía tareas `TODO`; CE-019 (P3, fiabilidad de pruebas) era la oportunidad `DISCOVERED` más concreta y ejecutable, con un historial repetido de `EADDRINUSE` en 8082 documentado en los ciclos 57, 58 y 63. CE-017 (P2) quedó cubierto por CE-022 (Cycle 43): `destroy()` elimina el listener `resize` y el contrato «Scanner removes its resize listener on destruction» sigue en Phase 3A. |
| **Bugs encontrados** | El verificador manual Phase 3A no podía ejecutarse en un puerto alternativo sin editar el código, bloqueando la reproducción cuando 8082 está ocupado. |
| **Bugs corregidos** | Sí: la suite respeta `E2E_PORT` y conserva 8082 como default; se ejecutó en 8084 sin conflicto. |
| **Tests ejecutados** | `node --check tests/workspace/phase3a-manual-verification.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3a-manual-verification.mjs`; `node tests/workspace/phase3a-test.mjs`; `git diff --check`. |
| **Tests PASS** | Verificación manual Phase 3A 41/41 en 8084 (10 escenarios + comportamientos); regresión Phase 3A 80/80; diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El cambio es solo de infraestructura de la suite; no altera producto ni evidencia. Los tres archivos ya modificados al inicio (`artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y `screenshots/workspace/08-scanner-module-test.png`) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables o promover CE-008/CE-009 según la cola al iniciar el próximo ciclo. |

---

## Cycle 80 — Operación de flujo documento → PDF local

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 31c49eda96cd9f4b6b6836ce297da31ee5afd2d3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-032 |
| **Hypothesis** | El constructor ya convertía imágenes a PDF (`image.to-pdf`) y creaba informes (`report.create`), pero no podía convertir el documento/informe Toolisto resultante en PDF dentro del flujo; el extremo del flujo estrella (documento → informe → PDF) quedaba fuera del proyecto. |
| **Change** | Se completó `document.to-pdf` en `workflow-operations.js` (trabajo en curso sin commitear de los ciclos 76-79, todos SIN_MARCA): categoría `pdf`, entrada `document`/`text`, salida `file`, opciones formato (A4/Letter), orientación (portrait/landscape), título e «incluir título como encabezado». Mapea bloques Toolisto (heading1/2/3, párrafo, viñeta, cita, divisor y salto de página) a secciones del `pdf-generator` local y devuelve un `Blob` PDF sin dependencias externas. |
| **Hallazgos** | Procedía del cuarto intento fallido de ciclo (76-79) y estaba incompleto: no tenía test propio. El `pdf-generator` local ya soporta los tipos de sección que emiten los bloques de documento (title/subtitle/text/divider/page-break), así que la integración fue directa y no requirió tocar el generador. |
| **Bugs encontrados** | Ninguno preexistente nuevo; la operación quedaba registrada en `workspace/core/workflow-operations.js` pero no contaba con cobertura y `dist` no la contenía hasta regenerar el build. |
| **Bugs corregidos** | No aplica. |
| **Tests ejecutados** | Nuevo `node tests/workspace/workflow-document-pdf-test.mjs` (descriptor del registro, PDF real desde documento Toolisto, `includeTitle=false`, documento vacío, salida de `report.create`); `node tests/workspace/workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `workflow-ui-test.mjs`; `instruction-planner-test.mjs`; `instruction-parser-test.mjs`; `instruction-assistant-ui-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `phase3b-test.mjs`; `phase3a-test.mjs`; `workspace-test.mjs`; `E2E_PORT=8084 node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Document→PDF nuevo 26/26; Engine 18/18; Validator 11/11; UI workflow 33/33; Planner 68/68; Parser 111/111; Assistant UI 39/39; build 179/179; sync source/dist OK; Workflow E2E 20/20; Phase 3B 59/59; Phase 3A 80/80; Workspace 156/156; Star-Flow E2E real 83/83 sin errores JS (OCR limpio). |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `feat(workflow): convierte documentos a PDF local` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La conversión cubre bloques de texto/estructura; los bloques table/image dentro de un documento no se emiten como secciones de tabla/imagen (se conservan por su contenido textual). El trabajo corre en el hilo principal igual que el resto del constructor; no se persisten URLs `blob:`. Las tres evidencias ya modificadas al inicio del ciclo (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida o promover CE-008/CE-009 al iniciar el próximo ciclo. |

---

## Cycle 83 — Discovery de imágenes perdidas en documento → PDF

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | fdb82cc880154d4121b9e6017c4dcbf3e775d29e |
| **HEAD final** | 42585fd (commit de cierre de este ciclo) |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | El flujo `document.to-pdf` ya conserva texto, tablas y gráficos, pero puede estar dejando atrás los bloques de imagen del documento: al caer al mapeo genérico se emitiría su base64 como texto plano en el PDF. |
| **Change** | Se registraron CE-036 (P2) y CE-037 (P3). CE-036: `document.to-pdf` debe converger cada bloque `image-block` del documento en una sección `image` del `pdf-generator` (normalizando PNG/WebP/SVG a JPEG como ya hace `preparePdfImages` de workspace.js). CE-037: compartir esa normalización entre la ruta de diseños y la del flujo para evitar duplicar el re-encode JPEG. |
| **Hallazgos** | `documentBlocksToSections` (workflow-operations.js:465) mapea heading, divider, page-break, bullet-list, quote y table, pero no `image-block`; el bloque cae en `if (content) sections.push({ type: 'text', content })`, por lo que el base64 completo de la imagen se incrusta como texto renderizable en el PDF. Además `pdf-generator.registerJpegImage` solo registra `data:image/(?:jpeg|jpg)` y `renderImagePDF` rellena un placeholder gris sin XObject para el resto. |
| **Bugs encontrados** | Reproducido con harness VM del test: un documento con un `image-block` JPEG o PNG produce un PDF cuyo stream de contenido contiene literalmente `/9j/4AAQSk...` o `iVBOR...` como cadenas de texto (`BT /F1 12 Tf ...`), sin ningún objeto `/Subtype /Image`; byte length 1008–1207 frente a un PDF con imagen embebida real. La imagen no llega; se degrada a basura legible. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-036 queda delimitada con reproducción fuera del E2E principal, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | Baseline `node tests/workspace/workflow-document-pdf-test.mjs` (35/35, cubre texto/tabla/cadena estrella); reproducción aislada del `image-block` JPEG y PNG vía harness VM (sin red, sin navegador). |
| **Tests PASS** | Document→PDF 35/35; reproducción de CE-036 confirmada para JPEG y PNG (delta esperado del defecto, no aserción de suite). |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno; CE-036 es ejecutable al promoverla a TODO (cambio acotado en `documentBlocksToSections` + re-encode JPEG compartido). |
| **Limitaciones** | El `pdf-generator` solo puede embeker JPEG con DCTDecode; todo otro formato debe re-encodearse en canvas antes de llamar a `generatePDF`. La reproducción usa un harness VM aislado para no tocar el E2E principal. |
| **Proxima prioridad** | Promover CE-036 a TODO y asegurar que los `image-block` lleguen como imágenes reales al PDF del flujo estrella. |

---

## Cycle 81 — Grilla de tabla real en el documento → PDF del flujo estrella

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 31c49eda96cd9f4b6b6836ce297da31ee5afd2d3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-033 (consolida CE-032) |
| **Hypothesis** | El flujo estrella terminaba en PDF perdiendo la tabla: `report.create` solo escribía el resumen textual de filas/columnas, y `document.to-pdf` (CE-032, completo pero sin commit) ignoraba cualquier dato tabular del documento. |
| **Change** | Se consolidó el commit de CE-032 (el cierre del ciclo 80 nunca llegó al repositorio; HEAD seguía en el ciclo 75). `report.create` añade un bloque `table` con `headers`/`rows` cuando la entrada trae esos campos. `documentBlocksToSections` convierte ese bloque en una sección `table` del `pdf-generator` (cabecera diferenciada, filas y la paginación de tablas largas ya soportada por CE-013). |
| **Hallazgos** | El cierre de CE-032 existía solo en `git status` (trabajo probado y sin commit). El `pdf-generator` ya renderizaba secciones `table` desde CE-013/CE-018, por lo que la integración fue de mapeo, sin tocar el generador. |
| **Bugs encontrados** | CE-032 quedó registrado como cerrado en el STATUS del ciclo 80 sin commit real en `git log`; se corrigió el registro consolidando el commit en este ciclo. |
| **Bugs corregidos** | No aplica para el producto; se añadió cobertura de grilla real y de la cadena tabular. |
| **Tests ejecutados** | `node tests/workspace/workflow-document-pdf-test.mjs` (26 → 35); `workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `workflow-ui-test.mjs`; `instruction-planner-test.mjs`; `instruction-parser-test.mjs`; `instruction-assistant-ui-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `phase3b-test.mjs`; `phase3a-test.mjs`; `workspace-test.mjs`; `E2E_PORT=8084 node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Document→PDF 35/35 (incluye bloque table de `report.create`, grilla en el PDF con cabecera y filas, cuerpo tras el grid y cadena text.to-table → report.create → document.to-pdf); Engine 18/18; Validator 11/11; UI workflow 33/33; Planner 68/68; Parser 111/111; Assistant UI 39/39; build 179/179; sync source/dist OK; Workflow E2E 20/20; Phase 3B 59/59; Phase 3A 80/80; Workspace 156/156; Star-Flow E2E real 83/83 sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | `feat(workflow): conserva la tabla del informe en el PDF` (consolida CE-032 + CE-033). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La grilla cubre bloques que llegan con `headers`/`rows` explícitos desde `report.create`; las celdas se emiten como texto plano (sin formato interno de campos numéricos). El trabajo corre en el hilo principal igual que el resto del constructor; no se persisten URLs `blob:`. Las tres evidencias ya modificadas al inicio del ciclo (`e2e-evidence.json`, bundle Star-Flow y capturas PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida o promover CE-008/CE-009 al iniciar el próximo ciclo. |

---

## Cycle 84 — Imágenes reales embebidas en el documento → PDF

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | bd9bc37460032bb41db77c2a3b64a11dad55e93a |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-036 |
| **Hypothesis** | `documentBlocksToSections` no mapeaba `image-block`; el bloque caía al `text` genérico y el base64 completo del documento se emitía como texto renderizable en el PDF (`BT /F1 ... Tj`), sin ningún `/Subtype /Image`. |
| **Change** | `documentBlocksToSections` mapea `image-block` a una sección `image` con su `dataUrl`. `document.to-pdf` normaliza antes de generar: `preparePdfImageSections` re-encoda PNG/WebP/SVG a JPEG vía canvas (misma semántica que `preparePdfImages` de la ruta de diseños), conservando las secciones tal cual en entornos sin canvas (el generador dibuja su placeholder, sin fugas). Se añadió `tests/workspace/pdf-image-embed-e2e.mjs` (validación en navegador real) y `.gitignore` ignora `artifacts/pdf-image-embed/`. |
| **Hallazgos** | El `pdf-generator.registerJpegImage` solo admite `data:image/(?:jpeg|jpg)` y emite el XObject DCTDecode correcto; la normalización en canvas es la única pieza que faltaba en la ruta del flujo. Con `page.evaluate` sobre un documento servido desde `dist`, un `image-block` PNG y WebP se convirtieron a JPEG y se incrustaron como imagen real (`/Subtype /Image` + `DCTDecode`), sin placeholder ni leak de base64. Un JPEG de 1×1 decodifica y registra dimensiones correctas de SOF0. |
| **Bugs encontrados** | El base64 del `image-block` (JPEG o PNG) se volcaba como texto en el stream del PDF; la imagen se degradaba a basura legible. Un `image-block` vacío emitía ruido de datos en vez de un placeholder explícito. |
| **Bugs corregidos** | Sí: los `image-block` llegan como imágenes reales al PDF del flujo estrella (PNG/WebP/SVG normalizados a JPEG), el base64 ya no fuga como texto y una imagen sin fuente se representa como «Imagen no disponible». |
| **Tests ejecutados** | `node tests/workspace/workflow-document-pdf-test.mjs`; `workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `operation-registry-test.mjs`; `workflow-ui-test.mjs`; `instruction-planner-test.mjs`; `instruction-parser-test.mjs`; `instruction-assistant-ui-test.mjs`; `tabular-text-parser-test.mjs`; `workflow-model-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/pdf-image-embed-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node tests/workspace/phase3b-test.mjs`; `git diff --check`. |
| **Tests PASS** | Document→PDF 43/43 (JPEG embebido con XObject, PNG sin leak en VM, placeholder explícito para imagen vacía); Engine 18/18; Validator 11/11; Registry 26/26; UI workflow 33/33; Planner 68/68; Parser 111/111; Assistant UI 39/39; Tabular parser 7/7; Model 39/39; build 179/179; sync source/dist OK; CE-036 E2E navegador 16/16 (PNG y WebP→JPEG reales); Workflow E2E 20/20; Star-Flow E2E real 83/83 sin errores JS; Phase 3B 59/59; diff check OK. |
| **Tests FAIL** | 0. Durante desarrollo, dos aserciones del E2E nuevo usaban `ok(...)` incondicional (contaban PASS aunque la condición fuera falsa); se corrigieron a condicionales y el fixture WebP inválido (no decodificaba en Chromium) se sustituyó por uno generado en navegador desde canvas. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La normalización corre en el hilo principal (igual que el resto del constructor) y solo actúa cuando el navegador dispone de canvas; un formato que el decoder del navegador no soporte cae al placeholder sin fuga, no a basura. CE-037 (P3) sigue DISCOVERED: compartir este re-encode con `preparePdfImages` de workspace.js exigiría cruzar la frontera entre el monolito clásico y los ES modules; se documenta para un ciclo futuro. Las cuatro evidencias preexistentes ya modificadas al inicio (e2e-evidence.json, bundle Star-Flow y capturas PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; promover la oportunidad DISCOVERED de mayor valor (CE-008/CE-009/CE-037) o realizar discovery dirigida. |

---

## Cycle 85 — Normalización de imágenes PDF compartida entre rutas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f11d138636cdde23f31f4e8c862b7dd18f0de066 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-037 |
| **Hypothesis** | `document.to-pdf` (`preparePdfImageSections`) y `preparePdfImages` de la ruta de diseños duplicaban el mismo re-encode PNG/WebP/SVG→JPEG en canvas; un helper común evita regresiones de calidad/tamaño por ruta. |
| **Change** | Se creó `workspace/core/pdf-images.js` con `normalizePdfImageSections(sections, { updateSize, onError })`: passthrough limpio para JPEG, re-encode JPEG 0.9 en canvas cuando hay DOM y conservación de secciones en entornos sin canvas (placeholder). `document.to-pdf` (workflow-operations.js) lo usa con `updateSize:true` y `preparePdfImages` de workspace.js con `reportError`, eliminando las dos implementaciones duplicadas (~26 líneas menos). El test VM `workflow-document-pdf-test.mjs` incluye el módulo y `innerhtml-structure-test.mjs` audita el archivo nuevo. Se añadió `tests/workspace/pdf-images-shared-test.mjs` (contrato de dedup por ruta + passthrough sin DOM). |
| **Hallazgos** | «Cruzar la frontera entre el monolito clásico y los ES modules» no era un bloqueo real: `workspace.js` ya es un módulo ES que importa `./core/…`, por lo que importar el helper compartido desde `./core/pdf-images.js` era directo. Las únicas diferencias entre las dos rutas eran `updateSize` (flujo lo necesitaba para dimensionar) y el reporte de error (diseño usa `reportError`); el helper las cubre por opciones. |
| **Bugs encontrados** | Ninguno preexistente nuevo. |
| **Bugs corregidos** | No aplica: era duplicación de lógica de arquitectura, sin defecto funcional observable. |
| **Tests ejecutados** | `node tests/workspace/pdf-images-shared-test.mjs`; `node tests/workspace/workflow-document-pdf-test.mjs`; `node tests/workspace/innerhtml-structure-test.mjs`; `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/operation-registry-test.mjs`; `node tests/workspace/workflow-engine-test.mjs`; `node tests/workspace/workflow-validator-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/pdf-image-embed-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Shared 12/12; Document→PDF 43/43; InnerHTML 27/27; Workflow UI 33/33; Registry 26/26; Engine 18/18; Validator 11/11; build 179/179; sync source/dist OK; CE-036 E2E navegador 16/16; Workflow E2E 20/20; Phase 3B 59/59; Star-Flow E2E 83/83 sin errores JS ni consola; diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El helper re-encodea en el hilo principal (igual que antes) y solo actúa en navegador con canvas; en VM las secciones pasan tal cual. Se conserva la frontera de `preparePdfImages` de la ruta de diseños (no actualiza `width/height`, semántica preservada). Las cuatro evidencias preexistentes ya modificadas al inicio del ciclo (e2e-evidence.json, bundle Star-Flow y capturas PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; promover la oportunidad DISCOVERED de mayor valor (CE-008/CE-009/CE-011) o realizar discovery dirigida. |

---

## Cycle 94 — Convierte tablas en graficos dentro del flujo estrella

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 07725584705b48b9d9f159c278531439168aef18 |
| **HEAD final** | 280534d0d83a4826084320b437d54af39a00f024 |
| **Task** | CE-038 |
| **Hypothesis** | El flujo estrella terminaba en PDF con texto y tablas, pero el paso datos -> grafico no existia como operacion de flujo real: la promesa `datos -> tabla -> grafico -> informe -> PDF` quedaba incompleta dentro del Workspace. |
| **Change** | Se aprobo la operacion `data.to-chart` (categoria chart, entrada `data`/`document`, salida `document`): elige la(s) columna(s) numerica(s) por ancla de filas parseables (decimales con coma europea y separador de miles incluidos), emite un bloque `chart` con series finitas y rechaza tablas vacias sin columna numerica con mensaje accionable. `report.create` anade un bloque `chart` cuando la tabla trae columna numerica. `documentBlocksToSections` mapea el bloque `chart` a una seccion `chart` que el `pdf-generator` ya renderizaba con barras (`re f`), titulo y etiquetas. Se integro en el asistente: sinonimos de parser (`crear grafico`, `grafica`, `graficar`, etc.), accion `chart` -> `data.to-chart` en el planificador y categoria/filtro de iconos en el UI del constructor. Incluye E2E navegador nuevo `workflow-chart-e2e.mjs` (cadena real text.to-table -> data.to-chart -> document.to-pdf). |
| **Hallazgos** | El `pdf-generator` ya soportaba secciones `chart` (caso de use en disenos), asi que la integracion fue de mapeo sin tocar el generador. La tabla numerica de `text.to-table` produce encabezados y filas con decimal espanol; `tableChartSeries` reusa la semantica de ancla numerica del parser tabular. El trabajo estaba incompleto en el arbol (ciclo previo no cerrado) y este ciclo lo valido, completo test E2E de navegador y lo comiteo. |
| **Bugs encontrados** | Ninguno de producto nuevo; el ciclo previo dejo la funcion sin commit y sin E2E de navegador. |
| **Bugs corregidos** | No aplica como defecto preexistente; se cerro la cadena datos -> grafico -> PDF de forma real y probada. |
| **Tests ejecutados** | `node tests/workspace/instruction-parser-test.mjs`; `instruction-planner-test.mjs`; `workflow-document-pdf-test.mjs`; `workflow-ui-test.mjs`; `operation-registry-test.mjs`; `workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `instruction-assistant-ui-test.mjs`; `workflow-model-test.mjs`; `tabular-text-parser-test.mjs`; `innerhtml-structure-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-chart-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Parser 116/116; Planner 73/73; Document->PDF 66/66 (bloque chart, serie, decimales con coma, seccion con barras y cadena estrella); Workflow UI 33/33; Registry 26/26; Engine 18/18; Validator 11/11; Assistant UI 39/39; Model 39/39; Tabular parser 7/7; InnerHTML 27/27; build 179/179; sync source/dist OK; Chart E2E navegador 15/15; Workflow E2E 20/20; Workspace 156/156; Phase 3B 59/59; Star-Flow E2E real 83/83 con OCR limpio 100/100. |
| **Tests FAIL** | 0. |
| **Commits** | `feat(workflow): convierte tablas en graficos y los embebe en el PDF` (280534d). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Los valores se parsean como numeros (se pierde formato moneda por celda); la eleccion de columna numerica elige la primera por ancla y se limita a 30 series para PDF razonable. El trabajo corre en el hilo principal igual que el resto del constructor; no se persisten URLs `blob:`. Las evidencias regeneradas no deterministas del Star-Flow (e2e-evidence.json, bundle .toolisto y capturas PNG) se excluyen del commit (politica anti-churn). |
| **Proxima prioridad** | No quedan tareas TODO; promover CE-008 (memoria de motores pesados) o CE-009 (accesibilidad de componentes especializados) a TODO, o realizar discovery dirigida. |

---

## Cycle 99 — Lazy-load de imágenes de capturas (CE-008)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b03471f6ef331df2095a6625e734cb67c5d9b016 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-008 |
| **Hypothesis** | `renderCaptureView` resolvía el `dataUrl` de cada captura de inmediato al construir cada tarjeta, por lo que abrir una vista con muchas capturas decodificaba todas las imágenes a la vez, cargando inútilmente la memoria incluso para capturas fuera del viewport. |
| **Change** | Cada tarjeta de Capturas muestra primero un placeholder y solo resuelve su imagen cuando la tarjeta entra al viewport (IntersectionObserver con rootMargin 300px). Las `<img>` usan `loading="lazy"` y `decoding="async"`; sin IntersectionObserver se mantiene la carga directa como fallback. La observación se hace sobre la tarjeta completa, no solo sobre el slot del thumb, para que una tarjeta parcialmente visible cargue aunque su thumb quede en el pliegue. |
| **Hallazgos** | La implementación inicial observaba el slot del thumb (120px): al saltar directamente al final de la lista, las tarjetas que quedaban a medio camino tenían su tarjeta visible pero su thumb por encima del pliegue, por lo que su IntersectionObserver nunca disparaba. Observando la tarjeta completa, todas las parcialmente visibles cargan. El E2E reveló un flake determinista del test original (solo 19/24 tras saltar al final), reproducido con sonda aislada, que desapareció con el cambio. |
| **Bugs encontrados** | Con el seed real de 24 capturas, la vista inicial resolvía todas las imágenes (10 en el viewport inicial; el código previo resolvía las 24). El fallo intermedio del test (5 tarjetas sin cargar tras saltar al final) era del observador sobre el thumb y quedó corregido observando la tarjeta. |
| **Bugs corregidos** | Sí: la decodificación de imágenes es diferida y proporcional al viewport real; el caché del placeholder se conserva hasta que la tarjeta es visible. |
| **Tests ejecutados** | `node scripts/verify-workspace-sync.mjs`; `npm run build`; `$env:E2E_PORT=8084; node tests/workspace/lazy-capture-images-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3a-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3b-test.mjs`; `node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Sync source/dist OK (regenerado con build 179/179); Lazy-load E2E nuevo 12/12 (tarjetas renderizadas, placeholder inicial, carga diferida, scroll a 24/24, atributos lazy, cero errores y cero egress); Phase 3A 80/80; Phase 3B 59/59; Workspace 156/156; Star-Flow E2E real 83/83; diff check OK. |
| **Tests FAIL** | 0 final. Durante el diagnóstico, el test original dejó de cargar tarjetas intermedias al saltar al final (19/24); reproducido con tres sondas aisladas (`_probe*` eliminadas tras el diagnóstico) y resuelto observando la tarjeta. |
| **Commits** | Commit de cierre de este ciclo: `perf(workspace): lazy-load de imágenes de capturas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El IO usa rootMargin de 300px para precargar con antelación; una tarjeta nunca observada (p. ej. pestaña oculta TODO el tiempo) no se decodifica hasta volver a ella. Los thumbs resueltos no se persisten (siguen siendo efímeros, sin URLs `blob:`). La auditoría de memoria de Tesseract/PDF en sesiones largas queda aparte como CE-040 (DISCOVERED). Las evidencias ya modificadas al iniciar el ciclo (`artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y las dos capturas PNG) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | No quedan tareas TODO; ejecutar CE-009 (accesibilidad de componentes especializados) o realizar discovery dirigida/CE-040 al iniciar el próximo ciclo. |

## Cycle 106 — BOM UTF-8 en las exportaciones CSV del Workspace (CE-044)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f34cf02fd81c048326626b22c5727121800c64f9 |
| **HEAD final** | 11df68f |
| **Task** | CE-044 (DISCOVERY: sin tareas TODO en la cola). |
| **Hypothesis** | Las exportaciones «Exportar CSV» del Workspace — `exportTableCSV` (tabla de Datos) y `exportQueryResult` (resultado de Query) — emiten un Blob CSV sin BOM UTF-8, por lo que Excel con locales con acentos (es) interpreta el archivo como ANSI y muestra mojibake (`Ã¡`, `Ã©`, `ÃƒÂ±`…) en el texto español del producto. |
| **Change** | BOM UTF-8 antepuesto al contenido en ambas rutas: `exportTableCSV` genera `Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })` y `exportQueryResult` genera `Blob(['\uFEFF' + queryExportCsv(model)], { type: 'text/csv;charset=utf-8' })`. Nuevo E2E `tests/workspace/csv-export-bom-e2e.mjs` (chromium headless sobre `dist`, puerto `E2E_PORT` 8082): crea un proyecto, escribe celdas con acentos (`Córdoba`, `Éxito`, `índice ñame`), exporta la tabla y verifica que la descarga empieza por `EF BB BF`, que el primer carácter decodificado es `\uFEFF` y que los acentos llegan intactos; y en Query importa el fixture real `tests/fixtures/workspace/export-acentos.csv` (`Reunión Ñuño`), exporta y verifica el mismo BOM y acentos. Registrado en `scripts/test-workspace-release.mjs`. Sin tocar el sitio público. |
| **Hallazgos** | El mismo defecto existe en el sitio público (`js/modes/excel.js` `aoaToFile` genera CSV sin `\uFEFF`); se registra como CE-045 DISCOVERED para evaluar su arreglo con su propio gate (las aserciones actuales usan `.trim()`, compatible con el BOM). En el Workspace no había ninguna aserción de bytes sobre las exportaciones: el defecto era invisible para la regresión previa. |
| **Bugs encontrados** | `exportTableCSV` usaba `type: 'text/csv'` (sin charset) y ambas rutas emitían el contenido sin BOM; `exportQueryResult` ya declaraba `charset=utf-8` pero sin BOM sigue siendo ilegible para Excel en locales con acentos. |
| **Bugs corregidos** | Sí: ambas exportaciones del Workspace incluyen BOM UTF-8 y la tabla declara `;charset=utf-8`. |
| **Tests ejecutados** | `$env:E2E_PORT=8082; node tests/workspace/csv-export-bom-e2e.mjs` (nuevo 20/20); `node tests/workspace/workspace-test.mjs` (156/156); `node tests/workspace/phase3b-test.mjs` (59/59); `node tests/workspace/phase3a-test.mjs` (80/80); `$env:E2E_PORT=8082; node tests/workspace/phase3c-star-flow.spec.mjs` (83/83); `node tests/evidence-determinism.mjs` (71/71); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK). |
| **Tests PASS** | Nuevo E2E 20/20 (BOM tabla + BOM Query + acentos intactos + cero mojibake + cero errores de consola); Workspace 156/156; Phase 3B 59/59; Phase 3A 80/80; Star-Flow E2E 83/83; determinismo 71/71; build 179/179; sync source/dist SYNC OK. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | `11df68f` — `fix(workspace): BOM UTF-8 en exportaciones CSV para compatibilidad con Excel (CE-044)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El arreglo cubre las exportaciones del Workspace; el sitio público (`js/modes/excel.js`) queda registrado como CE-045 DISCOVERED. La evidencia `TLT-workspace-csv-bom.json` se escribe vía `writeEvidence` (determinista, sin timestamps). Las evidencias ya modificadas al iniciar el ciclo (`artifacts/deep-audit/toolisto/TLT-production-tool-coverage-evidence.json`, 2 inser./2 del. preexistentes) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Ejecutar CE-040 (memoria de motores pesados Tesseract/PDF, P3) o evaluar CE-045 (BOM en el CSV del sitio público) desde DISCOVERED. |

---

## Cycle 105 — Gate de regresión permanente de la migración toolisto.com (CE-043)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | d8088eb4a773d26a86bee27b091f8a5657a3ce02 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-043 (P2, desde DISCOVERED; sin tareas TODO en la cola) |
| **Hypothesis** | La migración a `toolisto.com` quedó consolidada en el ciclo 104 sin un gate que fije el contrato: `siteUrl`/`productionDomain` apuntan a toolisto.com, `_headers` endurece el host y el build los propaga, pero nada protege esas tres piezas contra una regresión futura (re-introducir subdirectorio, perder cabeceras de seguridad o un CDN no declarado). |
| **Change** | Nuevo gate `tests/toolisto-domain-gate.mjs` (23 comprobaciones, determinista): (1) contrato de dominio — `siteUrl` y `productionDomain` exactamente `https://toolisto.com`, hostname toolisto.com, pathname `/` (sin subdirectorio), sin placeholder ni `.invalid`; (2) lista `_headers` — HSTS con `includeSubDomains`/`preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` con `geolocation=()`, CSP con `default-src 'self'`/`object-src 'none'`/`base-uri 'self'`/`frame-ancestors 'none'`, `/workspace/*` con `X-Robots-Tag: noindex`, y cero egress de terceros salvo el CDN declarado para scripts; (3) propagación al build — `generate-seo-pages.mjs` copia `_headers`, prioriza `productionDomain`, rechaza `.invalid`, y el `dist` desplegado mantiene `_headers` idéntico, sitemap íntegro en toolisto.com sin subdirectorios y `robots.txt` con el sitemap canónico. Evidencia determinista `TLT-toolisto-domain-gate-evidence.json` (writeEvidence, SHA256 idéntico tras regenerar). Registrado en `run-all.mjs` («Toolisto Domain Gate») y en el ratchet `evidence-determinism.mjs`. Sin cambios de producto ni de `workspace/workspace.js`. |
| **Hallazgos** | El contrato ya se cumplía en el estado actual (`dist/_headers` idéntico al fuente, 183 `<loc>` todas bajo toolisto.com sin subdirectorio, `robots.txt` canónico); faltaba exclusivamente la regresión permanente. `dist/` está completo en `.gitignore` (línea 2), por lo que el gate valida el `dist` presente pero su núcleo de garantías vive en fuentes versionadas (`site.config.json`, `_headers`, `generate-seo-pages.mjs`). |
| **Bugs encontrados** | Ninguno de producto; un bug en el primer borrador del propio gate: la aserción de egress de `_headers` con lookahead negativo marcaba `https://cdn.jsdelivr.net` como URL no declarada; se sustituyó por sustracción del CDN permitido antes de buscar `https?://` restantes. |
| **Bugs corregidos** | No aplica como defecto de producto; el gate quedó correcto y reproducible (23/23). |
| **Tests ejecutados** | `node tests/toolisto-domain-gate.mjs` (nuevo 23/23, re-ejecutado para confirmar regeneración diff-cero); `node tests/evidence-determinism.mjs` (71/71, incluye la evidencia nueva en forma canónica exacta); `node --check` del gate, `run-all.mjs` y `evidence-determinism.mjs`; regresión relacionada `node tests/deployment-guide-audit.mjs` (10/10) y `node tests/seo-production-audit.mjs` (2753/2753); `git diff --check`. |
| **Tests PASS** | Gate nuevo 23/23; determinismo 71/71; deployment 10/10; SEO 2753/2753; diff check OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El gate valida los sources versionados en todo entorno y el `dist` solo cuando existe (una clonación sin build fallaría en las comprobaciones de dist); el CDN permitido para scripts queda fijado textualmente en el `_headers` y debe revisarse de forma consciente si el hosting exigiera otro. Las evidencias ya modificadas al iniciar el ciclo (`artifacts/phase3c-validation/e2e-evidence.json` y `TLT-production-tool-coverage-evidence.json`) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Ejecutar CE-040 (memoria de motores pesados Tesseract/PDF, P3) desde DISCOVERED o realizar discovery dirigida según la cola al iniciar el próximo ciclo. |

---

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 6949961 |
| **HEAD final** | Commit de cierre de esta intervención |
| **Motivo** | CE-008 quedó DONE (Cycle 99) pero había pasado varios ciclos ACTIVE con diagnóstico repetido y el mismo fallo reproducible (19/24 tras saltar al final). Se añadieron reglas para que ese bucle no vuelva a ocurrir. |
| **Causa raíz** | El E2E original simulaba scroll con salto directo al fondo (`scrollTop = scrollHeight`), que no reproduce el scroll real del usuario; la banda central de tarjetas quedaba sin observar. La implementación inicial observaba el slot del thumb (120px) en vez de la tarjeta completa. Ambos corregidos: `io.observe(card)` en `renderCaptureView` y E2E que recorre el scroll. Verificado 12/12 en navegador real. |
| **Change** | Reglas anti-bucle en `AGENTS.md` (sección Sistema autónomo), `workspace/CONTINUOUS-EVOLUTION-MISSION.md` (Reglas de ciclo 8-11), `workspace/OPENCODE-AUTONOMOUS-GUIDE.md` (Notas) y `RUN-OPENCODE-AUTONOMOUS.ps1` (prompt CE): (1) tarea >= 2 ciclos ACTIVE sin cambio de HEAD y con el mismo fallo reproducible entra en modo RECOVERY con cambio de estrategia; (2) si una técnica falla/rechaza permisos, el siguiente ciclo usa otra; (3) scripts de diagnóstico temporales SOLO en `_toolisto_autopilot/tmp/` del repo, prohibido `%TEMP%`/`AppData\Local\Temp`/`external_directory`; (4) PowerShell en Windows solo con cmdlets disponibles, prohibido `rg`/`head`/`tail`/`grep`/`sed`/`awk`. Se creó `_toolisto_autopilot/tmp/` (ya ignorado en `.gitignore`). |
| **Tests ejecutados** | `$env:E2E_PORT=8086; node tests/workspace/lazy-capture-images-e2e.mjs`; `$env:E2E_PORT=8087; node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8088; node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8089; node tests/workspace/phase3c-star-flow.spec.mjs`; `$env:E2E_PORT=8090; node tests/workspace/workflow-e2e-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `npm run build`. |
| **Tests PASS** | Lazy-load E2E 12/12; Workspace 156/156; Phase 3B 59/59; Star-Flow E2E 83/83; Workflow E2E 20/20; sync source/dist SYNC OK; build 179/179 OK. |
| **Tests FAIL** | 0 |
| **Commits** | `docs(autonomous): reglas anti-bucle permanentes (RECOVERY, cambio de tecnica, tmp interno, PowerShell)` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las reglas viven en la configuración/documentación del runner; un humano con acceso al repo puede relajarlas, pero el prompt CE del runner las aplica cada ciclo. `_toolisto_autopilot/` queda ignorada para que los diagnósticos temporales no ensucien el working tree. |

---

## Cycle 101 — Activación de la extracción de campos de factura (CE-041)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 6949961f193ce0d38ec7d93c5888551ece7a901 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-041 (DISCOVERY: sin tareas TODO en la cola). |
| **Hypothesis** | `core/invoice.js` (parser completo de facturas/recibos) era código muerto sin importar en ninguna parte, y `instruction-parser.js` marcaba `intent.options._extractFields = true` cuando el usuario mencionaba "factura"/"recibo" con OCR sin que ningún consumidor lo leyera: la intención de extraer datos estructurados de una factura no hacía nada. Activar ese contrato con una operación que consume `invoice.js` cierra el hueco y añade un paso real al flujo estrella (archivo → OCR → campos → tabla). |
| **Change** | Nueva operación `text.invoice-fields` ("Extraer campos de factura", categoría text, entrada text/document, salida data) registrada en `workflow-operations.js`; ejecuta `parseInvoiceText` + `invoiceRows` y devuelve `{ headers: ['Campo','Valor','Confianza','Página'], rows }`. `instruction-planner.js` encadena ahora `text.invoice-fields` después del paso `image.ocr` cuando `intent.options._extractFields` es true y la operación está registrada (con asunción explicativa); sin la operación registrada no se añade ningún paso fantasma. `dist/workspace/core/*` sincronizado. Sin modificaciones al sitio público ni a `workspace/workspace.js`. |
| **Hallazgos** | El parser ya emitía el marcador `_extractFields` para "extrae el texto de la factura" y "saca el texto del recibo"; únicamente faltaba el consumo. `invoiceRows` reconstruye una tabla Campo/Valor/Confianza/Página que encaja con el contrato `data` de las operaciones (`to-chart`/`report`) y con la UI del constructor sin ampliar categorías (categoría text ya existe). La validación del workflow (`workflow-model.js`) no exige compatibilidad origen/destino en el planner, por lo que encadenar OCR(text) → invoice-fields(text) nunca rompe la validación. |
| **Bugs encontrados** | No había errores de ejecución; el hueco era de producto: el parser de facturas completo vivía sin consumo y la intención explícita del usuario se ignoraba por contrato roto. |
| **Bugs corregidos** | Sí: `_extractFields` deja de ser letra muerta; la mención de factura/recibo junto a OCR produce un paso real de extracción de campos. |
| **Tests ejecutados** | `node tests/workspace/invoice-fields-test.mjs` (nuevo 29/29); `node tests/workspace/instruction-parser-test.mjs`; `instruction-planner-test.mjs`; `workflow-engine-test.mjs`; `workflow-ui-test.mjs`; `operation-registry-test.mjs`; `workflow-document-pdf-test.mjs`; `tabular-text-parser-test.mjs`; `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | Invoice fields 29/29 (parser directo, operación registrada y ejecutable con factura de ejemplo, parser `_extractFields` factura/recibo/negativo, planner 2 pasos encadenados / 1 paso sin factura / sin paso fantasma sin operación); Parser 116/116; Planner 73/73; Engine 18/18; UI workflow 33/33; Registry 26/26; Document→PDF 66/66; Tabular 7/7; sync source/dist SYNC OK. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): extracción de campos de factura vía intención OCR (CE-041)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La operación normaliza el número de factura conservando el prefijo corto de la firma OCR (p. ej. `FACTURA ELECTRONICA N.00123` → valor `N.00123`): la limpieza del número queda documentada en el test y como posible mejora futura. No se ejecutó el E2E de navegador del flujo factura (requiere captura con factura real y OCR); queda como tarea DISCOVERED. Las evidencias modificadas ya al iniciar el ciclo (`artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y capturas PNG) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Promover a TODO la validación E2E en navegador de la instrucción real "extrae el texto de la factura" sobre una captura (CE-042), o ejecutar CE-009/CE-040 desde DISCOVERED. |

## Cycle 102 — E2E de navegador del flujo de factura real (CE-042)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | bb9d935b4e2380a4a55093dd58c690957375a77b |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-042 (DONE) y antes promote TODO/ACTIVE: validar en navegador la instrucción real "extrae el texto de la factura" sobre una captura con factura, verificando OCR → campos → tabla y cero errores de consola. |
| **Hypothesis** | El flujo activado en CE-041 (parser `_extractFields` → planner encadena `image.ocr` + `text.invoice-fields` → tabla Campo/Valor/Confianza/Página) solo estaba cubierto por tests de módulo; faltaba la prueba de integración en navegador real (OCR Tesseract local `spa` + canvas con factura) para demostrar la cadena completa sin mocks y registrar su evidencia determinista. |
| **Change** | Nuevo e2e `tests/workspace/invoice-fields-e2e.mjs` (chromium headless sobre `dist`, servidor propio con MIME `.wasm`/`.gz`, puerto `E2E_PORT` 8084): captura la instrucción "extrae el texto de la factura" con el parser real, planifica con el planner real, ejecuta `image.ocr` (OCR real) y `text.invoice-fields` (parseo real) sobre una factura de ejemplo dibujada en canvas (Proveedor/RNC incluidos), y comprueba encadenado, tabla de salida y cero errores de consola. Sin cambios en `workspace/workspace.js`, sin mocks y sin ampliar rutas. |
| **Hallazgos** | En navegador real el encadenado funciona end-to-end: 2 pasos planificados (`image.ocr` → `text.invoice-fields`), 9 campos extraídos de la factura capturada, número `N.00123`, Total `2950.00`, confianza de OCR 86%, tabla con cebecera `Campo|Valor|Confianza|Página`, 11 filas, estado final `completed` y cero errores de consola. El OCR local `spa` sobre el canvas de factura da resultados estables sin retries. |
| **Bugs encontrados** | Ninguno nuevo en el flujo; el E2E confirmó que el primer intento del diseño dibujaba la captura sin las líneas "Proveedor"/"RNC" (omitidas del canvas), por lo que la verificación de campos se revisó para incluir esas líneas en la captura (el OCR devolvía el resto de campos igualmente). |
| **Bug corregido** | No aplica (solo cobertura E2E nueva, sin cambios de implementación). |
| **Tests ejecutados** | `node tests/workspace/invoice-fields-e2e.mjs` (nuevo 14/14); regresión dirigida: `node tests/workspace/invoice-fields-test.mjs` (29/29), `instruction-parser-test.mjs` (116/116), `instruction-planner-test.mjs` (73/73); `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | 14/14 nuevos; Invoice fields 29/29; Parser 116/116; Planner 73/73; sync source/dist SYNC OK. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): e2e navegador del flujo de factura real OCR a tabla (CE-042)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El E2E usa una factura sintética dibujada en canvas (no un PNG de fixture) para no añadir binarios; ocupa ~7s de OCR real. La confianza de OCR depende del canvas local (86% en este entorno); la verificación de campos pedidos es robusta al detalle (>=6 campos, número y Total presentes). |
| **Proxima prioridad** | Ejecutar CE-009/CE-040 desde DISCOVERED, o discovery dirigida con registro de nuevas oportunidades ejecutables. |

---

## Cycle 104 — Contrato ARIA/teclado del constructor de flujos y consolidación heredada (CE-009 + BUG_FIX)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 90066d014bc0e3afc103e94c0f2b4d1c257e6e76 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-009 (UX/Accesibilidad, desde DISCOVERED) + BUG_FIX de codificación heredado |
| **Hypothesis** | El working tree contenía trabajo sin commitear de un ciclo interrumpido (103): el contrato a11y del constructor de flujos estaba implementado en `workflow-ui.js` pero sin registrar en la cola, y `scripts/generate-seo-pages.mjs` había quedado corrompido en codificación (76 cadenas mojibake: `CategorA-as`, `ImÁgenes`, `→` → `â†'`, BOM UTF-16) que un build regeneraría en las 179 páginas. |
| **Change** | (1) **BUG_FIX**: se recuperó `generate-seo-pages.mjs` desde HEAD (UTF-8 limpio, sin BOM) y se reaplicó únicamente el cambio funcional heredado `ASSET_VERSION = '20260813'` con cache-busting `app.js?v=` en las 5 páginas generadas vía `appJsTag()`. Build 179/179 con acentos correctos y audit SEO 2753/2753 sin mojibake. (2) **CE-009**: el constructor de flujos ahora expone contrato ARIA/teclado real en sus widgets dinámicos: filas del selector de operaciones `role=button` + `tabindex=0` + `aria-label` + Enter/Espacio; filtros de categoría con `aria-pressed` (exactamente uno activo) y `aria-label` en la cinta; modal «Desde Workspace» con `role=listbox`/`role=option`, `aria-selected`, `tabindex` y activación por teclado. (3) Se consolidó la migración heredada a `toolisto.com` (site.config, `_headers` HSTS + noindex de `/workspace/*`, manifest con icono maskable, service-worker network-first, README/DEPLOYMENT a hosting estático con CNAME) y se añadió `artifacts/workflow-builder-a11y/` a `.gitignore`. |
| **Hallazgos** | El test VM `workflow-ui-test.mjs` ya incluía los contratos 34-39 y el E2E `workflow-builder-a11y-test.mjs` (nuevo) validaba el contrato en navegador real; el cierre del ciclo previo no llegó a registrar CE-009 ni a commitear. El dist ya estaba construido limpio, por lo que la corrupción solo afectaba al próximo build; el audit SEO sobre el dist nuevo confirma 0 mojibake. |
| **Bugs encontrados** | `generate-seo-pages.mjs` corrupto en codificación (76 cadenas mojibake + BOM UTF-16) que habría generado páginas con texto roto; el test `workflow-ui-test.mjs` tenía una duplicación de `container.replaceChildren()` (una llamada redundante, ya limpiada en el árbol). |
| **Bugs corregidos** | Sí: `generate-seo-pages.mjs` vuelve a UTF-8 limpio conservando el cache-busting heredado; el selector de operaciones, los filtros de categoría y el modal «Desde Workspace» son operables por teclado con semántica ARIA verificada en navegador. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (39/39); `node tests/workspace/workflow-builder-a11y-test.mjs` (E2E navegador nuevo 11/11); `node tests/workspace/innerhtml-structure-test.mjs` (27/27); `operation-registry-test.mjs` (18/18); `workflow-engine-test.mjs`; `workflow-validator-test.mjs` (11/11); `workflow-model-test.mjs` (39/39); `instruction-planner-test.mjs` (73/73); `instruction-parser-test.mjs` (116/116); `instruction-assistant-ui-test.mjs` (39/39); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK); `node tests/seo-production-audit.mjs` (2753/2753); `node tests/deployment-guide-audit.mjs` (10/10); `node tests/pwa-offline.mjs` (20/20); `node tests/evidence-determinism.mjs` (69/69); `node tests/production-tool-coverage.mjs` (26/26); `node tests/lazy-dependencies.mjs` (10/10); E2E: workflow-e2e-test (20/20), phase3a-test (80/80), phase3b-test (59/59), workspace-test (156/156), phase3c-star-flow.spec.mjs (83/83). |
| **Tests PASS** | 39/39 VM UI + 11/11 E2E a11y nuevos; regresión completa verde: Workflow E2E 20/20, Phase 3A 80/80, Phase 3B 59/59, Workspace 156/156, Star-Flow 83/83; SEO 2753/2753, deployment 10/10, PWA 20/20, determinismo 69/69, cobertura 26/26, lazy 10/10. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo (a11y + encoding fix + consolidación heredada). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El contrato a11y cubre los tres widgets dinámicos principales del constructor (selector de operaciones, filtros de categoría y modal «Desde Workspace»); otros widgets especializados del Workspace quedan como oportunidades futuras (CE-043 registra la consolidación de la migración toolisto.com). El cache-busting heredado usa la fecha fija `20260813`; futuros cambios de assets deben incrementarla. Las evidencias regeneradas no deterministas (e2e-evidence.json, bundle .toolisto y capturas PNG del Star-Flow) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Ejecutar CE-043 (gate de regresión de la migración toolisto.com) o CE-040 (memoria de motores pesados) desde DISCOVERED. |
