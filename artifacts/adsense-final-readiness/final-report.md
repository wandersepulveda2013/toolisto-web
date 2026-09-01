# APLUNO AdSense — Remediation Final Report (Low Value Content)

**Task:** GitHub Action (autonomous) — remediate "Low value content" for Google AdSense re-submission.
**Date:** 2026-09-01
**Publisher:** ca-pub-2644615452393440
**Site:** https://apluno.com
**Status (repo/certificado):** READY — repositorio listo para despliegue LIVE
**Status LIVE (Layer 4):** LIVE_DEPLOYMENT_REQUIRED — despliegue bloqueado desde el agente (`git push` denegado); lo LIVE se clasifica UNVERIFIED
**External AdSense status:** PENDIENTE_REVIEW_GOOGLE (decisión final en Google tras deploy)

---

## Executive Summary

Remediación de contenido genuino para responder al rechazo previo de **Google AdSense por "Low value content"**.
No fue una cobertura de tests ni relleno SEO: se subió el valor editorial real de las páginas públicas
(20 herramientas "flagship" a ~255-406 palabras editoriales, categorías delgadas enriquecidas), se alinearon
todos los claims de privacidad con el comportamiento real verificado contra código (incluida la única
excepción de red: el iframe de OpenStreetMap en `extraer-ubicacion-foto`), y se corrigió el conteo obsoleto
"167 herramientas" → 202.

Los audios/content, similarity, SEO y release públicos pasan (0 defectos A-F). **Se detectó y reparó además un
defecto real pre-existente de carga de modos** (`js/modes/mode-core.js`): los modos registrados después del primer
`boot()` jamás se montaban, rompiendo la UI interactiva de varias herramientas en CI. Con el fix, 6 de 8 suites
del release gate volvieron a PASS. Quedan **2 fallos pre-existentes del harness** (OCR-PDF y PDF+Misc) clasificados
como entorno/test-harness, NO causados por este trabajo y NO relacionados con el contenido de AdSense.

---

## 1. Alcance y método

- **Fuente de verdad:** `src/data/tools.json` (202 tools), `src/data/categories.json` (12 categorías).
- **Renderer verificado:** `scripts/generate-seo-pages.mjs` consome `description/summary/instructions/limitations/faq`.
  El campo `contentTier` NO se consume en el render (solo en el auditor de calidad) — seguridad del parche.
- **Privacidad verificada contra código:** ffmpeg y tesseract 100% locales (`spa.traineddata.gz` vendored);
  única dependencia remota real = iframe de OpenStreetMap en `extraer-ubicacion-foto`. Cifrado AES-GCM-256 +
  PBKDF2-SHA256 600k iteraciones, formato `.toolistoenc`.
- **rules:** permitido `node`/`npm`/git(sin push); scripts de diagnóstico solo en `_toolisto_autopilot/tmp/`.

## 2. Cambios de contenido (editores reales)

### 2.1 Flagship (20 tools, contenmc editorial ~255-406 palabras c/u)
Set flagship = 12 previos + `generar-qr`, `cifrar-descifrar-archivo`, `extraer-tabla-imagen-excel`,
`unir-videos`, `recortar-audio`, `formato-apa-7`, `estadisticas-texto`, `conversor-avanzado-de-imagenes`
(11 de 12 categorías). Cada uno con `description/summary/instructions/limitations/faq` enriquecidos (~255-406
palabras editoriales por tool) y honestos.

Correcciones de claims contra la UI (evitan mensajes/ad copy falso que un revisor detectaría):
- `dividir-paginas-dobles-pdf`: solo orientación vertical/horizontal (se eliminó "línea manual / recorte de lomo").
- `agregar-marca-de-agua-pdf`: sin mosaico (texto/tamaño/color/opacidad 15-70%/rotación/posición).
- `censurar-pdf-permanente`: reescrito (censura por término + checkbox eliminar metadatos + aplanado).
- `conversor-avanzado-de-imagenes`: sin AVIF/GIF/BMP/SVG/lote (WebP/JPG/PNG + calidad/resize/rotar/voltear/watermark).
- `csv-a-excel`: unidireccional CSV→XLSX (existe `excel-a-csv` aparte).
- `pdf-escaneado-a-pdf-buscable`: control de idioma (`ocrLanguage`) + páginas (`ocrPages`), no "calidad".
- `extraer-tabla-imagen-excel`: sin "vista previa pre-descarga" (reporta filas encontradas al procesar); OCR local.

### 2.2 Categorías delgadas (3 de 12 enriquecidas)
- `video` (5 tools): hero 36→descripción sustantiva (compresión por resolución, recorte en segundos, unión con
  re-codificación, video→GIF, FFmpeg.wasm local) y FAQ de 3→5.
- `hojas-de-calculo` (38 tools): descripción y FAQ 4→5 (CSV→XLSX con separador/codificación, limpieza,
  OCR de tabla imagen→Excel, SheetJS local).
- `qr-codigos` (7 tools): descripción y FAQ 3→5 (contenido QR, lectura, personalización de color/tamaño,
  lote desde CSV, generación local).

### 2.3 Privacidad honesta en `extraer-ubicacion-foto`
- FAQ nueva: "¿Se sube mi foto a un servidor?" → aclara que el EXIF se procesa local, PERO la vista de mapa
  incrusta OpenStreetMap y envía las coordenadas a ese servicio.
- Limitations nuevas: mapa OSM = tercero; lat/lng redondeadas a 4 decimales.

### 2.4 Conteo obsoleto
- `README.md`: "167 herramientas" → "202 herramientas".

## 3. Verificación automatizada (contenido/SEO PASS; 1 check de sitemap pre-existente + 2 suites E2E del harness, ver §5/§5-bis)

| Audito | Resultado |
|---|---|
| `npm run build` | OK — 236 indexables, 202 tools, 3 products; AdSense inyectado 15 páginas, 202 processing sin loader |
| `node scripts/audit-count.mjs` | 202/202 tools, 0 duplicados, 202 indexables, SUM(category)=202, todas con cobertura |
| `node scripts/audit-content-quality.mjs` | Grading perfecto: A=46, B=189, C=0, D=0, F=0. 14 PASS + **1 FAIL pre-existente** de coherencia sitemap (ver §5-bis): el auditor exige `/guia/`, `/about/`, `/contact/`, `/privacy/`, `/terms/` en `sitemap.xml`, pero el sitio usa rutas en español (`/privacidad`, `/condiciones`, `/apoyar`) y `buildSitemap()` no incluye editorial en el sitemap. Inmutable al contenido AdSense (no modifiqué `generate-seo-pages.mjs` ni el auditor). |
| `node scripts/audit-content-similarity.mjs` | sin near-duplicates (max sim 0.145 < 0.45); huella plantilla 3.4% — PASS |
| `node scripts/seo-audit.mjs` | 2328 passed, 0 errors (1 warn pre-existente de guia/sitemap) |
| `node scripts/test-public-release.mjs` | 22 PASS, 0 FAIL (incl. strict-editorial + content-similarity regressions) |

El grading de calidad A-F (A=46, B=189, C/D/F=0) refleja el contenido real: sin páginas delgadas ni
defectos. El check `indexability` (sitemap editorial) es el único no-verde dentro del auditor y es
pre-existente (detallado en §5-bis).

Revisión manual (evaluador externo): flagship `cifrar-descifrar-archivo`/`generar-qr`/`comprimir-imagen`
≈1000+ palabras legibles, 5-6 FAQ, JSON-LD WebApplication+FAQ, breadcrumbs, canonical, meta optimizados.
`extraer-ubicacion-foto` incluye mención OpenStreetMap.

## 4. Defecto real encontrado y reparado: carga de modos (`js/modes/mode-core.js`)

**Causa raíz (pre-existente, desde al menos `5480a97`):** `boot()` establecía `booted=true` en la primera llamada
y las llamadas posteriores retornaban sin despachar. `register()` invocaba `boot()` cuando ya `booted`, por lo que
los modos registrados después del primer boot NUNCA montaban su UI → el panel interactivo (p. ej. `#calcExpr`)
no aparecía, y las suites E2E de esas herramientas fallaban con `page.fill`/`waitForFunction` timeout.

**Fix (mínimo, sin cambio de API):** extraje `dispatch()` (idempotente por `mountedToolId`) y `register()` ahora
siempre llama `dispatch()`. `boot()` solo marca `booted` una vez y delega en `dispatch()`.

**Resultado en gates (run-all):** `calc` 24/24, `qr` 43/43, `structure` 37/37, `file-family` 35/35,
`spreadsheet` 221/221 (estructura), y `file-family-extra` 76/76, `text` 56/56 sin regresión.
Antes: esas suites fallaban 1 herramienta c/u por el mismo motivo.

## 5. Fallos de release gate restantes (PRE-EXISTENTES, no causados por este trabajo)

Según AGENTS.md no se declara una fase cerrada con pruebas fallidas, así que se documentan honestamente:

| Suite | Fallo | Atribución |
|---|---|---|
| `gate-e2e-ocr-pdf-tools.mjs` | `detectOcrNeeded` — `page.waitForFunction` (resultDialog) timeout; `window.pdfjsLib` ausente en la página de la pipeline genérica | Entorno/harness; la evidencia HEAD muestra PASS, pero aquí el OCR/pdf.js no está disponible en la página evaluada. NO toca modo-core ni contenido. |
| `gate-e2e-pdf-misc-tools.mjs` | `fixture JPEG: PhotoLocation extrae GPS` — `window.PhotoLocation` (módulo `js/metadata/photo-location.js`, adaptador de imágenes) no está cargado en `extraer-tablas-pdf-excel.html` (categoría spreadsheets) al evaluarse en línea 470 | Entorno/harness; test evalúa un módulo de imágenes en una página no-imagen. NO toca modo-core ni contenido. |

Ambos usan la pipeline genérica (`#runButton`) y módulos globales; `git diff HEAD -- js/modes/mode-core.js`
confirma que mode-core es el ÚNICO JS de runtime modificado. Estos 2 fallos ya estaban presentes en el primer
`run-all` ANTES del fix de mode-core y son independientes del contenido AdSense.

### 5-bis. Fallo pre-existente #3: coherencia sitemap del auditor de contenido (NOTA de transparencia)

`audit-content-quality.mjs` termina en 14 PASS / 1 FAIL por una única comprobación (`indexability`): el auditor
asume rutas editoriales en inglés y exige `/guia/`, `/about/`, `/contact/`, `/privacy/`, `/terms/` dentro de
`sitemap.xml`. El sitio APLUNO usa rutas en español (`/privacidad`, `/condiciones`, `/apoyar`) y `buildSitemap()`
(`scripts/generate-seo-pages.mjs:726`) nunca las incluyó. La clasificación A-F del contenido (A=46, B=189,
C=0, D=0, F=0) es correcta e independiente; el FAIL es un desajuste de convención EN-vs-ES en el sitemap que
ya ocurría con el contenido original (no lo introdujo este trabajo: `git status` no muestra cambios en
`generate-seo-pages.mjs` ni en `audit-content-quality.mjs`). Corregirlo (añadir editorial al sitemap o alinear
el auditor) es tarea de build/rutas y queda FUERA del alcance AdSense; se documenta para un ciclo de SEO técnico.

## 6. Limitaciones / no resuelto

- **Despliegue LIVE** bloqueado desde el agente (`git push` denegado). Verdict: **REPOSITORY READY —
  LIVE DEPLOYMENT REQUIRED**. Estado LIVE = `UNVERIFIED` (no verificable hasta desplegar en apluno.com).
- **OCR del fixture difícil** del pipeline sigue como TODO documentado (límite del motor, no regresión).
- `apluno-launcher` desktop-fit sigue clasificado PRE-EXISTENTE (out of scope AdSense).
- Persistence `document-editor-persistence-race-test.mjs` Escenario 11: pendiente (`api.renderView` inexistente);
  se corregirá en ciclo separado tras cerrar AdSense (NO tocar aquí por los bloques de phase 3C).
- Comandos complejos `node -e` restringidos por allowlist → scripts bajo `_toolisto_autopilot/tmp/`.

## 7. Cierre honesto

- Contenido: **REMEDIADO** (valor editorial real, claims alineados al código, sin páginas delgadas de plantilla).
- Repo: **READY para TODO** despliegue; hay 3 comprobaciones pre-existentes no verdes que impiden declarar
  "todo PASS" en esta máquina: 2 suites E2E del harness (ocr-pdf, pdf-misc) y el check `indexability`
  (sitemap editorial EN-vs-ES) del auditor de contenido. Ninguna fue causada por este trabajo ni afecta al
  contenido de AdSense.
- LIVE: **UNVERIFIED** hasta despliegue real (bloqueado).
- Evidencia: `artifacts/adsense-content-remediation/audit-content-quality.json`,
  `audit-content-similarity.json`, `url-inventory.json`, `baseline-audit.md`.