# PLAN REAL PENDIENTE CODEX

Plan para terminar correctamente el trabajo en Toolisto, derivado de la auditoría forense (2026-08-06, HEAD `5837d39`, rama `feature/workspace-star-flow`).

**Regla de oro:** cada lote termina con (1) pruebas reales ejecutadas, (2) evidencia guardada en `artifacts/deep-audit/`, (3) commit descriptivo, (4) roadmap/matriz actualizados. Nunca declarar un lote cerrado con tests fallidos o solo con checks de existencia.

---

## Lote 1 — Preservación y baseline (sin riesgo)

**Objetivo:** fijar el estado verificado y protegerlo.
**Archivos:** ninguno (o solo documentación).
**Acciones:**
- Registrar baseline ejecutable: `npm run build`, `npm test`, `node tests/run-all.mjs` (anotar flakes), `node scripts/test-workspace-release.mjs`, cada `gate-e2e-*.mjs` standalone.
- Commit del trabajo en curso sin commitear (OCR-PDF: `app.js`, `tool-processors.js`, `js/ocr/pdf-ocr-engine.js`, `src/data/tools.json`, `index.html`, `tests/gate-e2e-ocr-pdf-tools.mjs`, `tests/run-all.mjs`, matriz, evidencia, roadmap).
- Crear rama de respaldo del HEAD actual (permitido: `git branch backup/forensic-2026-08-06`).
**Criterio de cierre:** baseline 100% verde y commit del OCR-PDF.
**Riesgo:** bajo. **No tocar:** código funcional hasta el lote 3.

## Lote 2 — Reconciliación de fuentes de verdad

**Objetivo:** eliminar la contradicción matriz↔tools.json↔roadmap.
**Archivos:** `artifacts/deep-audit/toolisto/MATRIZ_CERTIFICACION_HERRAMIENTAS_TOOLISTO.csv`, `ROADMAP_200_TOOLS.md`.
**Acciones:**
- Regenerar la matriz desde `src/data/tools.json` (source de verdad): las 166 habilitadas con su estado real y su harness de soporte; 1 deshabilitada.
- Corregir ROADMAP: "166 habilitadas" (exacto) y "**85 certificadas funcionalmente** (con harness E2E real) / 81 publicadas con cobertura estructural" (exacto). Eliminar la frase "166 certificadas".
- Documentar que `MATRIZ_HALLAZGOS_TOOLISTO.csv` no existe y que el inventario real es `artifacts/deep-audit/paso3-p0-hallazgos.csv`.
**Criterio de cierre:** script de reconciliación que compare matriz vs tools.json = 0 discrepancias y roadcheck sobre las cifras.
**Riesgo:** bajo. **No tocar:** código de producción.

## Lote 3 — Cierre de P0 de integridad y honestidad

**Objetivo:** cerrar los P0 que son correcciones puntuales, no refactors.
**Archivos:** según hallazgo.
**Acciones:**
- WSP-022: añadir prueba de seguridad para SVG importado / atributos complejos en gráficos.
- WSP-041/WDX-004: documentar formalmente como **límite de OCR con mitigación en extracción** (no como resuelto) o mejorar preprocesado si hay vía nueva probada.
- WSP-021/053: decidir el modelo de bloques (producto) o declararlo límite documentado.
**Criterio de cierre:** cada hallazgo queda en `RESUELTO Y VERIFICADO` o `PARCIAL` con motivo exacto en el CSV; cero etiquetas engañosas.
**Riesgo:** medio.

## Lote 4 — Certificación funcional de las 81 herramientas sin harness

**Objetivo:** que "166 habilitadas" deje de sostenerse solo en checks estructurales.
**Archivos:** `tests/` (nuevos `gate-e2e-*.mjs` por familia), `tool-processors.js`, `app.js`, `js/*`.
**Acciones:**
- Agrupar las 81 en familias (texto/HTML/JSON/XML/CSV/zip/hash/QR/calculadoras/imágenes simples).
- Para cada herramienta: (1) abre, (2) acepta tipo correcto, (3) rechaza incompatibles, (4) procesa archivo real, (5) salida no vacía, (6) MIME/firma/extensión, (7) reapertura, (8) operación prometida, (9) móvil, (10) sin red, (11) errores sin archivos falsos, (12) cancelación.
- El fixture se genera en el navegador (patrón de `gate-e2e-word-tools`); la reapertura se valida con las librerías del sitio (pdfjs/JSZip/xlsx/mammoth/FFmpeg).
**Criterio de cierre:** cada lote de familia verde con evidencia `TLT-certify-*.json` y matriz actualizada.
**Riesgo:** alto en tiempo; medio en técnica. **No tocar:** el pipeline OCR del workspace.

**Progreso:**
- [x] **Familia texto (15 herramientas)** — `tests/gate-e2e-text-tools.mjs` **56 PASS / 0 FAIL (2026-08-07)**:
  `txtToPdf`, `mergeTxt`, `splitTxt`, `sortLines`, `removeDuplicates`, `textStatistics`, `wordCount`,
  `textDiff`, `htmlToMarkdown`, `htmlToText`, `cssMinifier`, `base64Encode`, `base64Decode`, `urlEncode`,
  `urlDecode`. Validación semántica real (pdfjs/JSZip/reportes), rechazo de incompatibles, cero egress
  externo, cero errores de consola. Evidencia: `artifacts/deep-audit/toolisto/TLT-certify-text-family-evidence.json`.
- [ ] Familia HTML/JSON/XML/CSV (pendiente)
- [ ] Familia hojas de cálculo (pendiente)
- [ ] Familia imágenes simples (pendiente)
- [ ] Familia archivos/ZIP/hash (pendiente)
- [ ] Familia QR/códigos de barras (pendiente)
- [ ] Familia PDF restante (pendiente)
- [ ] Familia ebooks restante (pendiente)
- [ ] Calculadoras (pendiente)
- [ ] Documentos/formato restante (pendiente)

## Lote 5 — Corrección del Workspace (estructura)

**Objetivo:** atacar WSP-001 sin romper las 144 rutas.
**Archivos:** `workspace/workspace.js`, `workspace/core/*`, `dist/workspace/*`.
**Acciones:**
- Extraer por dominios en pasos: (a) navegación/estado, (b) renderizado de documentos/tablas, (c) OCR, (d) diseño/PDF. Cada extracción con `verify-workspace-sync` + release gate.
- No regenerar `workspace.js` con `scripts/build-workspace-js.mjs` (es guard que aborta).
**Criterio de cierre:** workspace.js < 4.000 líneas (o meta definida), release gate OK, 0 errores de consola.
**Riesgo:** alto; requiere paciencia. **No tocar:** nombres de rutas/IDs usados por tests.

## Lote 6 — Seguridad y privacidad

**Objetivo:** sostener el hermetismo local-first.
**Archivos:** `tests/workspace/phase6-network-negative-test.mjs` (extender a todas las herramientas), `index.html`.
**Acciones:**
- Ampliar la prueba negativa de red para que recorra las 166 herramientas (no solo el Star-Flow).
- Reconfirmar cero egress externo, cero Google Fonts, cero API keys.
**Criterio de cierre:** suite hermética 100% verde sobre todas las herramientas activas.
**Riesgo:** medio.

## Lote 7 — Accesibilidad y móvil

**Archivos:** `workspace.css`, `index.html`, `app.js`, `tests/mobile-responsive-test.js`.
**Acciones:** auditar foco/teclado/contraste en las UIs form-first de las 29 rebuild + editor visual; correr viewports 360/768/1024/1366/1920.
**Criterio:** 0 errores axe-core (o checklist documentada), 0 overflow.
**Riesgo:** medio.

## Lote 8 — Rendimiento

**Archivos:** `workspace/core/*`, `vendor/`.
**Acciones:** medir tiempos de OCR/PDF/FFmpeg por herramienta; evitar upscales que degradan (ya documentado); lazy-load FFmpeg/Tesseract.
**Criterio:** presupuestos por herramienta definidos y medidos.
**Riesgo:** bajo.

## Lote 9 — SEO y publicación

**Archivos:** `src/data/tools.json`, `scripts/generate-seo-pages.mjs`, `tests/seo-*`.
**Acciones:** asegurar que las 166 habilitadas indexan, la 1 deshabilitada noindex, sitemap coherente; reconciliar el contador "166/167" en UI y docs.
**Criterio:** `npm test` + `seo-audit` 0 errores.
**Riesgo:** bajo.

## Lote 10 — Pruebas finales y release

**Acciones:**
- Hacer `production-validation.mjs` hermético (arrancar su propio server) y estabilizar `run-all` (aislar harnesses o aceptar ejecución standalone documentada).
- Release gate + run-all completo (con 3 corridas standalone para descartar flakes) + commit final + roadmap actualizado.
**Criterio de cierre:** release gate OK, run-all estable, total de pruebas reales documentado sin inflación.
**Riesgo:** bajo.

---

## Qué NO debe tocar Codex
- Las 144 rutas existentes y sus IDs (restricción Phase 3C).
- `scripts/build-workspace-js.mjs` (guard).
- El texto esperado de fixtures para ajustar el OCR.
- Los timeouts globales ni reintentos para ocultar flakes.
- La interfaz en español (mantener).
- No añadir herramientas nuevas durante Phase 3C.
