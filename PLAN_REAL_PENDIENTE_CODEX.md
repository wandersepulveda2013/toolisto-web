# PLAN REAL PENDIENTE CODEX

Plan para terminar correctamente el trabajo en Toolisto, derivado de la auditoría forense (2026-08-06, HEAD `5837d39`, rama `feature/workspace-star-flow`).

**Regla de oro:** cada lote termina con (1) pruebas reales ejecutadas, (2) evidencia guardada en `artifacts/deep-audit/`, (3) commit descriptivo, (4) roadmap/matriz actualizados. Nunca declarar un lote cerrado con tests fallidos o solo con checks de existencia.

## Estado actual — 2026-08-15 (verificado en esta sesión)

La reconciliación matriz↔tools.json corre con **0 discrepancias** (`_toolisto_autopilot/tmp/reconcile-matrix.mjs`):
167 filas, 167 toolIds únicos, 167 `enabled` en tools.json, matriz 167 `certified` / 167 `Publicar ahora=Sí`.
Gates locales verdes en esta sesión: `npm test` (auditoría PASS), `npm run test:release` (10/10),
`npm run test:apluno` (45/45); producción validada por HTTPS (cert válido, Enforce HTTPS, PWA
operativa, sitemap 190 URLs https). La matriz es hoy la fuente única de verdad y coincide con
tools.json; `pdfEncryptAdvanced` está `enabled` y certificado por su motor propio
(`js/security/pdf-encryptor.js`, ISO 32000-1 §7.6) con harness `tests/gate-e2e-pdf-encrypt.mjs`.

Estado por lote (detalle en cada sección):

- **Lote 1** (baseline + commit OCR-PDF): COMPLETO. `tests/gate-e2e-ocr-pdf-tools.mjs` y su
  evidencia `TLT-certify-ocr-pdf-evidence.json` están commiteados; HEAD verificado.
- **Lote 2** (reconciliación matriz↔tools.json↔roadmap): COMPLETO — 0 discrepancias (ver arriba);
  el roadmap declara 167 habilitadas y distingue certificación funcional (101 con harness E2E real)
  de cobertura estructural, sin la frase "167 certificadas" engañosa.
- **Lote 3** (P0 de integridad/honestidad): COMPLETO. WSP-022 cubierto por
  `tests/public-site-security-audit.mjs` (SVG/XSS) con `TLT-security-honesty-evidence.json`;
  WSP-041/WDX-004 documentado como límite OCR con mitigación en extracción; WSP-021/053 declarado
  límite documentado (no existe modelo de bloques; ver matriz/roadmap).
- **Lote 4** (certificación funcional por familias): COMPLETO — evidencia `TLT-certify-*-evidence.json`
  por familia (text 56/56, word, epub, spreadsheet, data, image-converters, image-family,
  image-interactive, qr, pdf-family, pdf-misc, pdf-encrypt 35/35, ocr-pdf, file-family,
  calc, structure, av, docs-extras, enhance-scanned-document, converters).
- **Lote 5** (extracción del monolito workspace.js): pertenece al repo de desarrollo del Workspace
  (Default Project, ciclos CE). En este repositorio publicado no se toca `workspace/workspace.js`.
- **Lote 6** (hermetismo de red): COMPLETO en el alcance publicado — `public-site-network-negative`
  (51/51) y `pwa-offline` con allowlist; cero egress externo (ver AGENTS.md, total 712 tests).
- **Lote 7** (accesibilidad/móvil): evidencia `TLT-accessibility-audit-evidence.json` y
  `TLT-responsive-matrix-evidence.json`.
- **Lote 8** (rendimiento): cubierto por `TLT-production-readiness-*.json` (lazy-load FFmpeg/
  Tesseract documentado; upscale OCR retirado por degradar fixtures ruidosos).
- **Lote 9** (SEO): COMPLETO — `TLT-seo-production-audit-evidence.json`; sitemap/canónicos en
  `https://apluno.com/`; verificado en producción (190 URLs https, robots declara sitemap).
- **Lote 10** (release): COMPLETO — release gate `npm run test:release` (10/10) y CI en cada
  publicación (run `31883117953` PASS).

**Pendientes reales restantes (no bloqueantes para el estado publicado):**

1. **Humanos / credenciales**: Google Search Console (verificar propiedad de dominio `apluno.com`
   + sitemap `https://apluno.com/sitemap.xml`); Cloudflare (`CLOUDFLARE_API_TOKEN` para evaluar
   proxy y headers CSP/HSTS — GitHub Pages ignora `_headers`).
2. **Decisiones de producto** (repo de desarrollo): PPTX (requiere librería `pptx`), modelo de
   bloques, alcance Query/Dashboards/Flow, y la extracción del monolito workspace.js (Lote 5).

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

**Progreso (verificado 2026-08-15 — todas las familias con harness E2E real y evidencia en `artifacts/deep-audit/toolisto/`):**
- [x] **Familia texto (15 herramientas)** — `tests/gate-e2e-text-tools.mjs` **56 PASS / 0 FAIL (2026-08-07)**:
  `txtToPdf`, `mergeTxt`, `splitTxt`, `sortLines`, `removeDuplicates`, `textStatistics`, `wordCount`,
  `textDiff`, `htmlToMarkdown`, `htmlToText`, `cssMinifier`, `base64Encode`, `base64Decode`, `urlEncode`,
  `urlDecode`. Validación semántica real (pdfjs/JSZip/reportes), rechazo de incompatibles, cero egress
  externo, cero errores de consola. Evidencia: `artifacts/deep-audit/toolisto/TLT-certify-text-family-evidence.json`.
- [x] Familia HTML/JSON/XML/CSV — `gate-e2e-data-tools.mjs` + `TLT-certify-data-family-evidence.json`
- [x] Familia hojas de cálculo — `gate-e2e-spreadsheet-tools.mjs` + `TLT-certify-spreadsheet-family-evidence.json`
- [x] Familia imágenes simples — `gate-e2e-image-converters.mjs` / `gate-e2e-image-tools.mjs` + `TLT-certify-image-converters-evidence.json`, `TLT-certify-image-family-evidence.json`, `TLT-certify-image-interactive-evidence.json`
- [x] Familia archivos/ZIP/hash — `gate-e2e-file-tools.mjs` / `gate-e2e-file-family-tools.mjs` + `TLT-certify-file-family-evidence.json`, `TLT-certify-file-family-extra-evidence.json`
- [x] Familia QR/códigos de barras — `gate-e2e-qr-tools.mjs` + `TLT-certify-qr-family-evidence.json`
- [x] Familia PDF restante — `gate-e2e-pdf-misc-tools.mjs`, `gate-e2e-pdf-encrypt.mjs` (35/35), `gate-e2e-ocr-pdf-tools.mjs` + evidencias `TLT-certify-pdf-*`
- [x] Familia ebooks restante — `gate-e2e-epub-tools.mjs` + `TLT-certify-epub-family-evidence.json`
- [x] Calculadoras — `gate-e2e-calc-tools.mjs` + `TLT-certify-calc-family-evidence.json`
- [x] Documentos/formato restante — `gate-e2e-word-tools.mjs`, `gate-e2e-docs-extras.mjs`, `gate-e2e-structure-tools.mjs` + evidencias `TLT-certify-word-family-evidence.json`, `TLT-certify-docs-extras-evidence.json`, `TLT-certify-structure-family-evidence.json`, `TLT-certify-av-evidence.json`

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
