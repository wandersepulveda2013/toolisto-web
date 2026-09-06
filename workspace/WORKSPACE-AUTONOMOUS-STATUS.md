# WORKSPACE-AUTONOMOUS-STATUS.md — Estado de la mision Workspace

- **Modo**: CONTINUOUS_EVOLUTION (aplica a la app `/workspace/` del repo
  `wandersepulveda2013/toolisto-web`, paquete `toolisto-directo-v2`).
- **Branch**: main (local). **HEAD**: 0257354 (tras cycle W1).
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

## Pendientes para el owner
- Despliegue a produccion (main) autorizado via GitHub API `gh`; actualmente
  `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`.

## Metricas acumuladas
- Ciclos completos: 1 (W1). Suites run-all 48/57 → 54/57. Gate Workspace:
  129+ PASS. Documentacion: QUEUE/STATUS actualizados; reporte final pendiente
  (se escribira con WORKSPACE-AUTONOMOUS-FINAL-REPORT.md al cerrar el stack).