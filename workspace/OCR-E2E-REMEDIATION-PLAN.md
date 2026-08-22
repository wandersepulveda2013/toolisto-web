# OCR E2E Reliability — Plan de investigacion y remediacion

**Objetivo:** Resolver el timeout de OCR en `phase3c-star-flow.spec.mjs` paso 8 sin aumentar el timeout arbitrariamente, sin reducir assertions, sin mocks, sin skips.

**Estado:** TODO (CE-051, prioridad P1)
**Bloqueador:** Ninguno — este plan es el paso siguiente despues de documentar el blocker.

---

## Fase 1: Diagnostico instrumental (1 ciclo)

### 1.1 Instrumentar `recognizeText()` con telemetria

Agregar logging condicional a `workspace/core/ocr-engine.js` que capture:

| Metrica | Descripcion |
|---------|-------------|
| `t_load_start` | Timestamp al iniciar `loadOcrEngine()` |
| `t_load_end` | Timestamp cuando el worker esta listo |
| `t_recognize_start` | Timestamp al iniciar `worker.recognize()` |
| `t_recognize_end` | Timestamp cuando `recognize()` resuelve |
| `lang_data_bytes` | Tamano del modelo cargado |
| `canvas_size` | Dimensiones del canvas de entrada |
| `ocr_output_chars` | Numero de caracteres reconocidos |
| `ocr_output_words` | Numero de palabras reconocidas |

**No committear este logging.** Es temporal para diagnostico. Guardar la evidencia en `artifacts/ocr-diagnostic/`.

### 1.2 Ejecutar el fixture limpio en el entorno real

1. Build de produccion (`node scripts/build-public-site.mjs`)
2. Ejecutar `phase3c-star-flow.spec.mjs` con el logging habilitado
3. Capturar la consola completa del navegador
4. Medir tiempos de cada fase de Tesseract

### 1.3 Ejecutar `capture-flow-chain` (CE-050) con el mismo instrumento

Comparar las metricas de OCR entre el flujo modal (phase3c) y el flujo workflow (capture-flow-chain). Si capture-flow-chain pasa con el mismo fixture, el problema NO es el engine sino la ruta de invocacion.

### 1.4 Verificar la ruta de carga del modelo

Confirmar si el modelo `spa.traineddata.gz` se carga desde:
- `vendor/tesseract/lang-data/spa.traineddata.gz` (local, rapido)
- `tessdata.projectnaptha.com` (remoto, puede fallar)

El `pickLangPath()` intenta primero local con `fetch(method:'HEAD')`. Si falla, usa el remoto. Verificar si el HEAD local funciona en el contexto de Playwright.

---

## Fase 2: Identificar la causa raiz (1 ciclo)

Basado en la evidencia de Fase 1, clasificar en una de estas causas:

| Causa | Evidencia esperada | Remediacion |
|-------|-------------------|-------------|
| **WASM lento en headless Chromium** | `t_load_end - t_load_start` > 30s | Investigar alternativas a WASM (native bindings) o aumentar timeout justificado con datos |
| **Worker stuck sin resolucion** | `t_recognize_start` existe pero `t_recognize_end` nunca ocurre | Agregar timeout interno en `recognizeText()` con rechazo de promise y retry |
| **Carrera de condiciones con el modal** | El test pierde el estado del modal | Corregir el selector de polling del test para sincronizar con el estado real del worker |
| **Modelo no se carga** | `lang_data_bytes` = 0 o error de fetch | Corregir la ruta del modelo o bundlearlo en dist/ de forma fiable |
| **Canvas corrupto o vacio** | `canvas_size` = 0 o dimensiones inesperadas | Corregir la preparacion del canvas antes de recognize |

---

## Fase 3: Implementar la correccion (1 ciclo)

La remediacion dependera de la causa identificada:

### Opcion A: Timeout interno en recognizeText()

Si el worker se queda stuck, agregar un `Promise.race()` con timeout de 60s que:
1. Rechace la promise con un error descriptivo
2. Libere el worker via `worker.terminate()`
3. Permita al caller (el modal) reintentar o mostrar error al usuario

```javascript
// En workspace/core/ocr-engine.js
const OCR_TIMEOUT_MS = 60000;
const result = await Promise.race([
  worker.recognize(canvas),
  new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS))
]);
```

### Opcion B: Corregir la ruta de carga del modelo

Si el modelo no se carga, asegurar que `vendor/tesseract/lang-data/spa.traineddata.gz` es accesible desde la pagina en el contexto de Playwright (mismo origen, sin CORS).

### Opcion C: Corregir el polling del test

Si el test pierde sincronia con el estado real del worker, refactorear el polling para que:
1. Escuche eventos del worker (no solo el DOM)
2. Use un `data-ocr-state` attribute actualizado por el motor
3. Implemente un fallback a 180s con diagnostico (no silencioso)

---

## Fase 4: Validar la correccion (1 ciclo)

1. Ejecutar `phase3c-star-flow.spec.mjs` completo
2. Verificar 0 FAIL en el paso 8
3. Verificar que los pasos 9–18 (cascada) ahora pasan con el texto OCR real
4. Ejecutar `capture-flow-chain` para confirmar que no se degrada
5. Ejecutar la suite completa de liberacion para confirmar 0 regresiones

---

## Criterios de exito

| Criterio | Minimo |
|----------|--------|
| phase3c-star-flow paso 8 PASS | 1/1 |
| phase3c-star-flow total FAIL | 0 |
| capture-flow-chain PASS | 12/12 |
| Total PASS en suite de liberacion | >= 4095 (de 4095) |
| Timeout de OCR en el test | <= 120s (no se aumenta arbitrariamente) |
| Timeout interno en recognizeText() | Si la causa es worker stuck |
| Evidencia de tiempos | Guardada en artifacts/ocr-diagnostic/ |
| Regresiones en otros tests | 0 |

---

## Dependencias

- **CE-006 (BLOCKED):** Mejora del OCR para fixture dificil (calidad, no fiabilidad). Independiente.
- **CE-050 (DONE):** capture-flow-chain demuestra que OCR funciona en workflow. No depende.
- **build-public-site.mjs:** Requerido para generar dist/ de prueba.

## Riesgos

1. **Si la causa es WASM lento en headless:** Puede requerir aumentar el timeout a 180s o 240s con justificacion documentada. Esto es aceptable si se demuestra con datos que el OCR si completa, solo mas lento.
2. **Si la causa es un bug en el engine-loader:** Puede requerir cambios en `vendor/js/engine-loader.js`, que es codigo de terceros adaptado. Cuidado con no romper la compatibilidad.
3. **Si la causa es un bug en Playwright:** Puede requerir cambiar la estrategia de polling (ej. usar `page.waitForFunction()` en vez de un loop manual).
