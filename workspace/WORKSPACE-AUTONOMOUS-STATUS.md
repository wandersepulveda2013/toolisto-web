# WORKSPACE-AUTONOMOUS-STATUS.md — Estado de la mision Workspace

- **Modo**: CONTINUOUS_EVOLUTION (aplica a la app `/workspace/` del repo
  `wandersepulveda2013/toolisto-web`, paquete `toolisto-directo-v2`).
- **Branch**: main (local). **HEAD**: 7b6d9f1 (tras cycles W1..W4).
- **Uptime**: iniciado como actividad guiada 2026-09-05.
- **Backlog**: ver `WORKSPACE-AUTONOMOUS-QUEUE.md`.

## Baseline registrado (antes del ciclo W1)
- Run-all completo `node tests/run-all.mjs`: **57 suites → 48 PASS / 9 FAIL**.
- Gate de Workspace `scripts/test-workspace-release.mjs`: **129 suites OK**
  en 72d1015 (sin cambios de la app desde entonces).
- Los 9 fallos de run-all eran de SITIO publico, no del app Workspace:
  SEO Production Audit, Public Security Audit, Root Structure Audit,
  PDF+misc, OCR PDF Architecture, OCR-PDF E2E, Production Tool Coverage,
  APLUNO Launcher, AdSense Integration.

## Ciclo W1 — "Public OCR-PDF family rota: __ensurePdfJs indefinido"
(Categoria: BUG_FIX de sitio publico con impacto directo en UX del producto y
en la malla de validacion de APLUNO.)

- **Audit / Finding**: OCR-PDF E2E (`gate-e2e-ocr-pdf-tools.mjs`) fallaba con
  timeout 30000ms en `waitDialog` para `detectOcrNeeded`. Root cause real (no
  flaky): desde `c4e53c7` (perf: vendor lazy-load) `loadPdf` en
  `js/ocr/pdf-ocr-engine.js` llama a `window.__ensurePdfJs`, pero ese loader
  solo se definia en `workspace/lazy-loader.js`; las paginas publicas no lo
  cargan → TypeError → el processor nunca resuelve → el dialog nunca aparece.
  Afectaba a detectOcrNeeded, extractTextFromScannedPdf,
  scannedPdfToSearchablePdf e imageToSearchablePdf (toda la familia OCR-PDF
  publica).
- **Evidence**: suite sola: 8 PASS / 1 FAIL (timeout) ANTES; **34 PASS / 0 FAIL**
  DESPUES. Evidence determinista regenerada:
  `artifacts/deep-audit/toolisto/TLT-certify-ocr-pdf-evidence.json`.
- **Root cause**: dependencia no declarada del adaptador publico hacia un
  loader privado del Workspace.
- **Implementation**: en `js/ocr/pdf-ocr-engine.js` se autodefine
  `__lazyScriptCache`/`__lazyLoadScript`/`__ensurePdfJs` (script tag
  `./vendor/pdfjs/pdf.min.js`, guard `if (!window.__ensurePdfJs)`) sin pisar la
  definicion del Workspace. Confirmado `ENGINE_PROCESSOR_TOOLS` ya provee
  `EngineLoader` de `vendor/js/engine-loader.js` para estos tools; el unico
  eslabon roto era pdfjs.
  - Ademas se reconciliaron 4 suites obsoletas con la arquitectura intencional
    actual (el runtime del Workspace SE publica en `/workspace/` y la landing
    promocional esta en `/workspace-about/`):
    - `root-structure-audit.mjs`: `AI_AUTONOMY` en la allowlist (subsistema
      intencional versionado de supervision ESM).
    - `public-site-security-audit.mjs`: `fake-indexeddb` y `lighthouse` en
      devDeps revisadas.
    - `gate-e2e-pdf-misc-tools.mjs`: el `exifCheck` de PhotoLocation se movio
      DESPUES de `gotoPage('extraer-ubicacion-foto')` (antes se evaluaba en la
      pagina generica del servidor y daba TypeError).
    - `pdf-ocr-architecture.mjs`: la frontera real a auditar es que el adaptador
      publicado no CARGUE `core/ocr-engine.js` (isolacion), no su existencia en
      dist (el publish completo es el diseno actual, cubierto por
      `verify-workspace-sync`).
- **Files**: `js/ocr/pdf-ocr-engine.js`; `tests/{root-structure-audit,
  public-site-security-audit,gate-e2e-pdf-misc-tools,pdf-ocr-architecture}.mjs`.
- **Validation**: Security 7/7 · Root Structure 9/9 · PDF+misc 62/0 ·
  OCR PDF Architecture 7/0 · OCR-PDF 34/0 · Production Tool Coverage 31/0 ·
  `verify-workspace-sync` SYNC OK (42 publicos, 21 privados excluidos).
- **Regression check**: gate de Workspace `test-workspace-release.mjs` completo:
  **Build limpio + Sync + 129+ suites todas PASS** y manifest
  `release-gate-0257354….json`. Sin regresiones en la app.
- **Commits**: `86018aa` (fix OCR-PDF) y `0257354` (reconciliacion de tests).
- **Next step**: resolver los 3 restantes de run-all (D-01 APLUNO Launcher
  100dvh, D-02 AdSense categorias, W2 metas SEO) y despues entrar al backlog
  del producto Workspace (CE-137..145 / AW-003 parcial), priorizando
  fiabilidad P0/P1 del flujo principal captura→extraccion→documento→tabla→informe.

## Ciclo W2 -- "SEO category metas fuera de rango" (Categoria: BUG_FIX de sitio publico, pequeno y basado en evidencia)
- **Selected**: W2 (primer objetivo del prompt de continuacion, por ser pequeno/seguro/basado en evidencia; no pertenece a la remediacion AdSense, que se difiere).
- **Severity**: P1 (SEO on-page produccion; 3 paginas de categoria con description fuera del rango recomendado 50-160 chars).
- **Evidence**: `tests/seo-production-audit.mjs` (audita `dist/` local): 3 FAIL (hojas-de-calculo 257, qr-codigos 237, video 224 chars) entre 3059 checks; titulos OK; 219 sitemapUrls. Origin: `src/data/categories.json` consumido por `generate-seo-pages.mjs:486`.
- **Root cause**: descripciones de 3 categorias redactadas demasiado largas; el template las inserta directas en `<meta description>`.
- **Fix**: acortadas a 120/144/115 chars preservando el contenido editorial (local-first + funciones concretas; sin keyword-stuffing). Rebuild `generate-seo-pages.mjs --production`.
- **Tests**: `tests/seo-production-audit.mjs` 3059/3059 PASS; evidence determinista regenerada (`TLT-seo-production-audit-evidence.json`, sitemapUrls 225->219 consistente con el build actual) y comiteada (cambio de estado legitimo).
- **Regression**: gate `test-workspace-release.mjs` completo PASS pre-commit; `evidence-determinism` sin conflicto (normaliza, no regenera gates).
- **Deferred**: nada nuevo. El resto del universo SEO mas amplio (ademas de las 3 metas) queda fuera de alcance: sin reescritura masiva SEO (orden del prompt); la remediacion AdSense se difiere explicita.
- **Commit**: `6b725d8` (categories.json + evidencia).
- **Next**: entrar al backlog del producto Workspace CE-137..145 con prioridad P0->P1->P2->P3.

## Ciclo W3 -- "CE-138 bloques chart invisibles en el editor de documentos" (Categoria: BUG_FIX Workspace, UX)
- **Selected**: primer CE del backlog producto por impacto de usuario (asimetria editor vs export/PDF en un bloque creado por el flujo estrella).
- **Severity**: P2 (UX; el chart se degradaba a texto plano en el editor aunque export/PDF lo manejan).
- **Evidence**: `renderBlock` (workspace.js:3967) sin rama para `block.type === 'chart'`; `BLOCK_TYPES` (3391) sin chart; `buildTableChartSvg` (2606) canonico; forma del bloque `{type:'chart', content, series}` (series top-level) en `data.to-chart` / `documentBlocksToSections` / `blocksToMarkdown` / `exportDocumentMarkdown` (CE-128).
- **Root cause**: rama `chart` inexistente en renderBlock; el bloque caia al fallback de texto plano.
- **Fix**: rama `} else if (block.type === 'chart') {` entre image-block y table: monta `buildTableChartSvg` via `DOMParser('image/svg+xml')` + `document.importNode` (SIN `.innerHTML =`, contrato CE-123 intacto), filtra series no finitas (`Number.isFinite`), `role="img"` + `aria-label` del titulo, no editable. `BLOCK_TYPES` sigue sin chart (insercion solo via data.to-chart/report.create; sin boton decorativo).
- **Tests**: suite nueva `tests/workspace/editor-chart-block-test.mjs` 20/20 (anchors estructurales + SVG canonico: titulo, barras, valores, viewBox 600x200, negativos 240/#D9893B, escape, determinismo, paridad con export/PDF). Registrada en el gate tras la entrada CE-136.
- **Regression**: `innerhtml-structure` 27/27, `export-md-chart` 26/26, `report-info-from-doc` 26/26, `document-editor-data-loss` 19/19; gate completo 130 suites PASS (manifest `release-gate-b8e151e...`).
- **Deferred**: CE-141/CE-142/CE-143 intactos (ver QUEUE); AW-003 indeterminado sin definicion formal (no se inventa).
- **Commit**: `b8e151e` (workspace.js + suite + registro en gate).
- **Next**: rig recurra a CE-144 (D-04) quick-win o CE-139/CE-140 (P1/L) con ciclo dedicado.

## Ciclo W4 -- "CE-144 columnTypes clonada como objeto en cloneDataTableEntity" (Categoria: BUG_FIX Workspace, Datos/clonado)
- **Selected**: quick-win P3/S para mantener el ritmo del backlog tras W3.
- **Severity**: P3 (shape incorrecto que se auto-corrige en carga, pero clona mal desde la primera existencia del helper).
- **Evidence**: `cloneDataTableEntity` (workspace.js:1481) y `duplicateDataSheet` (4508) usaban `columnTypes: x ? { ...x } : undefined`; con `columnTypes` como ARRAY real (shape canonico usado por snapshotDataTable 5024 / restore 5064 / removeTableColumn 5815 / badges 5512) el spread produce un OBJETO `{0:..,1:..}`.
- **Root cause**: patron de clonado por columna incorrecto importado junto al helper CE-131; el patron correcto `Array.isArray(...) ? [...]` ya existia en 5019/5059.
- **Fix**: ambas lineas a `Array.isArray(table/sheet.columnTypes) ? [...table/sheet.columnTypes] : undefined`.
- **Tests**: suite `tests/workspace/duplicate-entities-test.mjs` ampliada 51->55/55 (assert `Array.isArray` del clon + 3 anclas anti-regresion que prohuben el spread `{}` sobre columnTypes).
- **Regression**: table-remove-column-row 51/51, col-filters-roundtrip 38/38, table-sort-confidence 27/27, table-history-cap 8/8, undo-corruption 15/15; gate completo 130 suites PASS (manifest `release-gate-7b6d9f1...`).
- **Deferred**: CE-141 (fórmulas crudas en exportTableCSV), CE-142 (undo no persiste), CE-143 (listas/code/callout en informe) y CE-145 permanecen en backlog.
- **Commit**: `7b6d9f1` (workspace.js + suite).
- **Next**: seleccionar el siguiente CE de impacto; candidatos P1/L: CE-139 (rerenderTable grid) y CE-140 (deep-clones + stringify); P2: CE-137 (dead code faithfulOcrText) y CE-145; P3: CE-142/CE-143. Tras varios CE cerrados (ya 2 + el mini W2), ejecutar la product review completa del flujo (launcher->creacion->extraccion->documento->edicion->guardado->cierre->reapertura; loader/errores/modales/doble clic/reload/responsive).

## Pendientes para el owner
- Despliegue a produccion (main) autorizado via GitHub API `gh`; actualmente
  `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`.

## Metricas acumuladas
- Ciclos completos: 4 (W1..W4: W1 OCR-PDF, W1.1 tests, W2 SEO, W3 CE-138, W4 CE-144).
- Gate Workspace: 130 suites PASS en cada ciclo (manifests 0257354/b8e151e/7b6d9f1).
- Suites run-all: 48/57 -> 54/57 (W1). Restantes: D-01 (DEFERRED, launcher), D-02 (DEFERRED_EXTERNAL, AdSense).
- Producto Workspace: CE-138 y CE-144 cerrados; CE-137/139/140/141/142/143/145 en backlog; AW-003 BLOCKED (sin definicion formal).
- Documentacion: QUEUE/STATUS actualizados; reporte final pendiente (se escribira con WORKSPACE-AUTONOMOUS-FINAL-REPORT.md al cerrar el stack).