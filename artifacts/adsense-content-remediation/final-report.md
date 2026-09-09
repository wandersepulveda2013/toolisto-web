# Final Report — APLUNO Content Remediation (AdSense layer 2)

> Motivo de AdSense: **CONTENIDO DE BAJO VALOR**.
> Este informe cierra la remediación en 4 fases y entrega el plan de indexación
> para que los cambios lleguen a Google Search Console tras el despliegue.

## 1. Estado inicial (baseline)

Registrado en `baseline-audit.md` (HEAD `c4e53c7`):

- Sitio 100% templado: launcher desnudo (sin enlaces de categoría) + 202 fichas
  de herramienta casi idénticas entre sí; sin sección editorial.
- 45 tools sin `keywords`; ~55 tools de conversión con intención casi idéntica.
- Gate de publicación: 19 PASS / 0 FAIL.
- Cobertura GSC (2026-08-28): 54 indexadas, 178 sin indexar, 169 rastreadas sin
  indexar; categoría dominante «Descubierta — aún no rastreada» (causa: las
  categorías no tenían ningún enlace real desde la portada).

## 2. Fases de la remediación

### SEO-01 — Cobertura GSC + hotfix de indexación (Cycle D-19)

- `offline.html` raíz con `noindex, nofollow` + description (los motivos de
  «Descubierta» apuntaban a rutas del service worker).
- 5 editoriales en el sitemap (`/guia/`, `/about/`, `/contact/`, `/privacy/`, `/terms/`).
- `audit-content-quality` 15/15 PASS; sitemap 224 URLs.

### SEO-02 — Fase 1: guía editorial OCR

- Nueva guía `convertir-escaneado-imagen-en-texto-excel` (flujo estrella
  escaneo → OCR → texto/Excel/PDF buscable) con enlaces reales a 6 herramientas.
- Guías 11/11 válidas; sitemap 237 URLs; gate público 24 PASS / 0 FAIL.

### SEO-03 — Fase 2: diferenciar herramientas similares

- 16 tools reescritas en `src/data/tools.json` (cluster de hojas de cálculo +
  pares de conversión): summary/instructions/limitations/faq específicos;
  cada una con ≥60 palabras estrictas, ≥2 instrucciones, ≥1 limitación, ≥1 FAQ.

Medición antes/después (dist generado):

| Métrica | Antes | Después |
|---|---|---|
| maxSimilarity full-page | 0.296 | **0.250** |
| Pares en banda 0.20–0.35 | 78 | **24** |
| Pares en banda 0.35–0.50 | varios | **0** |
| Strict editorial max sim | 0.145 | **0.000** |

Pares top restantes (siguiente ronda, no bloqueantes): avif↔heic 0.250,
html-a-imagen↔html-a-pdf 0.236, formatear↔validar-json 0.224,
codificar↔decodificar-url 0.219, dividir↔unir-excel 0.219.

### SEO-04 — Fase 3: home con enlaces crawlables a categorías

- `renderHome()` ahora emite 12 `<a class="apluno-home-cat" href="/{slug}">`
  (antes eran chips JS sin `href` → categorías no rastreables desde la portada,
  el hueco real del «Descubierta — aún no rastreada»).
- CSS en `src/apluno/styles.css`; validado en navegador (Playwright): 12 links
  visibles, `/pdf` navegable, home sin errores de consola.

## 3. Medición final (2026-09-08, dist HEAD SEO-04)

Evidencia determinista: `audit-content-quality.json` + `audit-content-similarity.json`.

`node scripts/audit-content-quality.mjs` → **FINAL: PASS (pass=15, warn=0, fail=0)**:

- Páginas descubiertas 292; indexables **236**; noindex 56 (52 aliases de
  redirect + 404 + internas); sitemap **237 URLs** (0 .html, 0 rotas).
- Enlaces internos **10.520** / 0 rotos / 4.206 a targets de redirect.
- Categorías enriquecidas **12/12**; guías válidas **11/11**.
- Metadata: 0 empty/dup title, 0 empty/dup desc, 0 multiH1; orphan 0; placeholder 0.
- boilerplate global: 13 bloques >6 reúsos, ninguno «concerning».
- editorial estricto: min 63 palabras, p50 112, máx 361; ninguna <60.

`node scripts/audit-content-similarity.mjs` → **PASS**:

- near-dup / name-substitution estricto: **max sim 0.000**.
- peor sharedness por tool: 45% (`/jpg-a-webp`) — por debajo del umbral 80%.
- globalBoilerplateRatio 0.029; 0 defectos CJK/emoji/control; 27 tools <70
  palabras cumplen el intent (summary + ≥1 limitación + ≥2 FAQ), sin padding.

Gate de publicación `node scripts/test-public-release.mjs` → **24 PASS / 0 FAIL**
(seo 29, adsense 25, monetization 25, strict-editorial 3, content-similarity 5,
remediation DoD 11, network-negative 413/413 — cero egress externo en las 202
herramientas).

## 4. Despliegue

Método: push no-destructivo de `main` (fast-forward) al repositorio
`wandersepulveda2013/toolisto-web`; el workflow
`.github/workflows/deploy-pages.yml` (`on: push → main`) ejecuta
`npm ci` + `npm run build` + `npm test` + `npm run test:apluno` +
`npm run test:release` y publica `dist/` en GitHub Pages (apluno.com).

State tras publicar (ver APLUNO-PUBLICATION-STATUS.md):

- Commit publicado y run ID del GitHub Actions.
- Validación en producción: `/` con 12 categorías crawlables, `/toolisto`,
  una herramienta editada y el sitemap/robots.

## 5. Plan de indexación (Google Search Console, humano)

1. **Tras el despliegue**, confirmar en producción que `/` enlaza las 12
   categorías (`href="/{slug}"`), verificado con `curl https://apluno.com/`.
2. **GSC**: volver a enviar `https://apluno.com/sitemap.xml` (237 URLs).
3. **Inspección por URL + «Solicitar indexación»** en las claves:
   - `/` (home con categorías), `/toolisto`, `/guia/` y la guía OCR.
   - Las 12 categorías (`/pdf`, `/imagenes`, …) — objetivo directo del hueco
     «Descubierta — aún no rastreada».
   - Ejemplos por cluster editado: `/jpg-a-pdf`, `/xls-a-xlsx`, `/ods-a-xlsx`,
     `/filtrar-csv`, `/comprimir-video`.
4. **Monitorizar Cobertura durante ~2 semanas**: la cifra de «Descubierta — aún
   no rastreada» debe caer (el home ahora entrega rutas de descubrimiento); la de
   «Indexadas» debe subir. Re-inspeccionar si una clave se queda rastreada-sin-indexar.
5. **Siguientes rondas (prioridad P2/P3, autores de evolución continua)**:
   - Diferenciar los pares restantes: avif↔heic, html-a-imagen↔html-a-pdf,
     formatear↔validar-json, codificar↔decodificar-url, dividir↔unir-excel.
   - Revisar herramientas de 1 sola keyword para diversificar cobertura.
   - Frases compartidas tipo «mis archivos se suben a un servidor» (19 tools):
     confiar en el énfasis local-first; solo si GSC marca canibalización.

## 6. Limitaciones pendientes

- GitHub Pages **ignora `_headers`** (CSP/HSTS/nosniff): el artifact los
  incluye pero la plataforma no los aplica. Para headers reales se necesitaría
  proxy Cloudflare (el entorno tiene `CLOUDFLARE_API_TOKEN`, pero NO se modificó
  ningún registro; sin cambios de DNS).
- AdSense: únicamente en las 15 páginas de navegación; las **202 páginas de
  procesamiento de archivos van sin loader** (requisito de política).
- El despliegue y la indexación dependen de validación humana final en GSC.

## 7. Reproducción

```text
node scripts/build-public-site.mjs
node scripts/audit-content-quality.mjs
node scripts/audit-content-similarity.mjs
node scripts/test-public-release.mjs
```

Estado: **remediación completa (Fase 1 a Fase 4); despliegue ejecutado el
2026-09-08; indexación en curso pendiente de GSC.**