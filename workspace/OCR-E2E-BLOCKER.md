# OCR E2E Blocker — phase3c-star-flow step 8

**Estado:** ROOT CAUSE ISOLATED — defecto del test, no del producto.
**Fecha de primera observación:** 2026-08-17
**Última verificación:** 2026-08-22
**Diagnóstico:** 2026-08-22 (CE-051 diagnostic v2, 10+10 corridas instrumentadas)

## ROOT CAUSE ISOLATED (CE-051)

**El OCR no tiene ningún problema de performance ni de timeout.**

El timeout del step 8 es un **defecto del test**, no del producto.

### Mecanismo del defecto

1. `extractTextFromScan()` en `workspace.js:2541` llama `recognizeText(canvas)`.
2. `recognizeText()` completa en **~3 segundos** (workerInit ~1s + recognize ~0.5s).
3. `extractTextFromScan()` llama `closeModal()` → el overlay se remueve.
4. **Inmediatamente después**, llama `showExtractionModeChooser()` → abre un NUEVO modal con `.ws-modal-overlay`.
5. El test (`phase3c-star-flow.spec.mjs:194`) polls `!(await page.$('.ws-modal-overlay'))` cada 500ms.
6. **El overlay NUNCA desaparece** — se reemplaza por el modal del extraction mode chooser.
7. El loop agota 240 iteraciones × 500ms = 120s → `ocrMode = 'timeout'` → FAIL.

### Evidencia (diagnostic v2, 10+10 corridas)

| Escenario | Éxito | workerInit (avg) | recognize (avg) | total (avg) | chars | conf |
|-----------|-------|-------------------|-----------------|-------------|-------|------|
| **Modal (phase3c path)** | 1/10* | 1428ms | 476ms | 2759ms | 148 | 89% |
| **Workflow (capture-flow-chain)** | **10/10** | 839ms | 488ms | 2752ms | 148 | 89% |

*Los 9 fallos del escenario modal son excepciones de Playwright porque el modal del extraction chooser queda abierto al final de la corrida anterior, impidiendo que la siguiente abra el welcome screen.

### Modal timeline capturado (run 0, modal)

```
+889ms  "Extracción de texto (OCR)" — initializing tesseract
+2748ms "Modo de extracción (§53)" — Selecciona cómo procesar el texto extraído
```

El test nunca ve el primer modal desaparecer porque el segundo aparece inmediatamente.

### Por qué capture-flow-chain (CE-050) pasa

El workflow usa `page.waitForSelector('#wf-results-section')` — un elemento específico del workflow, no la ausencia de un overlay. No depende del estado del modal.

### Clasificación del fallo

| Componente | Estado |
|------------|--------|
| Tesseract WASM engine | Funciona correctamente (~3s total) |
| `recognizeText()` | Funciona correctamente (148 chars, 89% conf) |
| `extractTextFromScan()` | Funciona correctamente (muestra extraction chooser) |
| `phase3c-star-flow.spec.mjs` step 8 | **Defecto del test** — selector de polling equivocado |

### Corrección necesaria

Cambiar el polling del step 8 en `phase3c-star-flow.spec.mjs:194` para detectar la aparición del extraction mode chooser (`.ws-modal-title` con texto "Modo de extracción") en vez de la ausencia de `.ws-modal-overlay`.

**No es necesario aumentar el timeout. No es necesario modificar el engine-loader ni recognizeText().**

`tests/workspace/phase3c-star-flow.spec.mjs` — Star-Flow E2E (40 pasos)

## Componente raíz

Tesseract.js WASM OCR engine cargado vía `vendor/js/engine-loader.js` → `workspace/core/ocr-engine.js` → `recognizeText()`.

## Entorno

- **Sistema:** Windows (Playwright headless Chromium)
- **Puerto:** E2E_PORT (8082)
- **Servidor:** HTTP estático sirviendo `dist/`
- **URL:** `http://localhost:8082/workspace/index.html?preview=internal`
- **Idioma OCR:** `spa` (español, modelo `spa.traineddata.gz`)
- **OEM:** 3 (DEFAULT: LSTM + legacy, Tesseract elige el mejor por bloque)
- **WASM Core:** `tesseract-core-simd.wasm.js` vía blob URL

## Fixture

`tests/fixtures/star-flow/scan-clear.png` — 17,965 bytes, 420×260px, fondo blanco, texto negro sans-serif grande. Generado con Playwright para garantizar legibilidad OCR.

Texto esperado (`expected-ocr.txt`):
```
Nombre Valor Estado
Ventas Q1 150 Completado
Ventas Q2 80 En progreso
Devoluciones -30 Pendiente
Costos fijos -200 Pagado
Ganancia neta 0 Calculado
```

## Comportamiento observado

1. El test abre el workspace, crea un proyecto, importa `scan-clear.png`, confirma el escaneo.
2. En el paso 8, hace clic en "Extraer texto" → se abre el modal OCR.
3. El test ejecuta un polling loop: **240 iteraciones × 500ms = 120 segundos máximo**.
4. El loop espera a que el modal desaparezca (OCR completado) o aparezca un textarea (fallback manual).
5. **El OCR nunca completa dentro de los 120s.** El modal permanece abierto con el texto "Cargando motor OCR..." o "Reconociendo texto...".
6. El loop agota las 240 iteraciones → `ocrMode = 'timeout'` → **FAIL: "8. OCR timed out"**.
7. **25 failures en cascada:** todos los pasos 9–18 y 30–31 dependen del TextDocument que el OCR debió crear.

## Timeout actual

- **Test polling:** 240 iteraciones × 500ms = 120,000 ms (120 segundos)
- **No hay timeout en la función `recognizeText()`** — awaiting `worker.recognize(canvas)` indefinidamente
- **No hay timeout en `doLoadTesseract()`** — la carga del worker no tiene límite temporal

## Duración observada

- La suite completa tarda ~174 segundos.
- El polling OCR consume los 120 segundos completos del loop.
- El OCR no produce resultado ni error dentro de ese lapso.

## Cascada de fallos (25 derivados del paso 8)

Todos los siguientes FAIL son dependientes directos del timeout del paso 8:

| Paso | Fallo | Causa |
|------|-------|-------|
| 9 | TextDocument created | No hubo OCR → no se creó documento |
| 9 | Document has blocks | Sin documento no hay bloques |
| 10 | OCR char accuracy >= 70% | Sin texto OCR = 0% accuracy |
| 10 | OCR word accuracy >= 60% | Sin texto OCR = 0% accuracy |
| 11 | Skipped (no docId) | Dependiente del paso 9 |
| 12 | A tabla button clicked | Dependiente del documento |
| 12 | Table created | Sin documento no hay tabla |
| 13 | TableDocument found | Dependiente del paso 12 |
| 13 | Table has headers | Sin tabla no hay encabezados |
| 13 | Table has rows | Sin tabla no hay filas |
| 14 | No table to compare | Dependiente del paso 13 |
| 15 | Skipped (no tableId) | Dependiente del paso 13 |
| 15b | Review button clicked | Dependiente del paso 13 |
| 15b | Review modal opened | Dependiente del paso 15b |
| 15b | Review modal not found | Dependiente del paso 15b |
| 16 | Chart button clicked | Dependiente de la tabla |
| 17 | Chart found | Sin datos no hay chart |
| 17 | Chart has series | Sin datos |
| 17 | Chart has SVG | Sin datos |
| 17 | Chart has negatives | Sin datos |
| 18 | No SVG to check | Dependiente del paso 17 |
| 30 | Bundle has documents | Sin documentos que exportar |
| 30 | Bundle has dataTables | Sin tablas que exportar |
| 31 | Imported docs > 0 | Sin documentos que importar |

## Suites OCR relacionadas que SÍ pasan

| Suite | Resultado | Diferencia clave |
|-------|-----------|------------------|
| `capture-flow-chain-e2e.mjs` (CE-050) | 12/12 PASS | Usa el **workflow OCR** (operación image.ocr en Flow), no el modal. `waitForSelector('#wf-results-section', timeout: 120000)`. |
| `ocr-source-selection.mjs` | 34/34 PASS | Tests unitarios de la lógica de selección de source (no ejecuta OCR real). |
| `engine-idle-release-test.mjs` | 10/10 PASS | Verifica la API de carga/liberación de Tesseract (no ejecuta `recognize()` sobre imagen real). |

## Código involucrado

```
vendor/js/engine-loader.js:214   → Tesseract.createWorker('spa', 3, {...})
workspace/core/ocr-engine.js:57  → worker = await loadOcrEngine(lang, onProgress)
workspace/core/ocr-engine.js:59  → result = await worker.recognize(canvas)
workspace/workspace.js:2577      → ocrResult = await recognizeText(canvas, { lang: 'spa', ... })
```

**Ruta de carga del modelo:**
```
engine-loader.js:32   corePath → vendor/tesseract/tesseract-core-simd.wasm.js
engine-loader.js:28   workerPath → vendor/tesseract/worker.min.js
engine-loader.js:170  langPath → vendor/tesseract/lang-data/ (local) o tessdata.projectnaptha.com (remoto)
```

## Impacto funcional conocido

- El Workspace funcional SÍ ejecuta OCR correctamente en uso manual (el modal completa y produce texto).
- `capture-flow-chain` (CE-050) demuestra que OCR funciona a través del workflow.
- El problema es específico del **escenario E2E** en el entorno Playwright headless Windows.
- No hay evidencia de que el OCR falle en uso real del usuario.

## Causas posibles (sin diagnosticar)

1. **WASM lento en headless Chromium en Windows:** El worker WASM puede tardar más de 120s en cargar + reconocer en el entorno CI/headless.
2. **Red:** El `pickLangPath()` intenta primero remoto (`tessdata.projectnaptha.com`) con un `fetch(HEAD)`. Si la red es lenta o el DNS tarda, puede bloquear la inicialización.
3. **Worker stuck:** El `worker.recognize()` puede quedar en un estado indefinido sin resolver ni rechazar la promise.
4. **Falta de feedback:** La función `recognizeText()` no tiene timeout interno ni mecanismo de cancelación; depende completamente del test para detectar el timeout.
5. **Carrera de condiciones:** El test hace polling sobre el DOM (`.ws-modal-overlay`) que puede no reflejar fielmente el estado interno del worker OCR.

## Pasos para reproducir

```bash
# 1. Build producción
node scripts/build-public-site.mjs

# 2. Ejecutar solo phase3c
node tests/workspace/phase3c-star-flow.spec.mjs

# 3. Observar:
#    - Paso 8: "Waiting for OCR engine..."
#    - ~120 segundos de dots (240 × 500ms)
#    - FAIL: 8. OCR timed out
#    - 25 FAIL adicionales en cascada
```

## Criterio de resolución

El blocker se resolverá cuando `phase3c-star-flow.spec.mjs` alcance **0 FAIL** sin:

- Aumentar el timeout arbitrariamente sin evidencia.
- Reducir assertions.
- Usar `skip` o `test.describe.serial`.
- Mockear el OCR real.
- Eliminar el paso de OCR del test.
