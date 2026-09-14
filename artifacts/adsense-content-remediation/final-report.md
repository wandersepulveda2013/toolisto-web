# Final Report — Remediación de contenido APLUNO (AdSense, capa 2)

> Motivo de AdSense: **CONTENIDO DE BAJO VALOR** (1.ª revisión);
> reactivado el 2026-09-12 para una ronda 2 de diferenciación.
> Estado: **implementado localmente y validado al 100 % en el build de `dist/`**;
> **sin commit/push** (regla 23 del owner): el despliegue queda pendiente de
> aprobación humana. Este informe cierra la remediación y entrega el plan de
> indexación para aplicar tras el despliegue.

## 1. Diagnóstico

Baseline: `baseline-audit.md` (HEAD `c4e53c7`) + registros SEO-01…SEO-04
(`container` HEAD `0107451`). La causa raíz del rechazo es el **render global
100 % templado**, no texto duplicado literal:

- **0** h1/summary/description duplicados entre las 202 herramientas y **0**
  oraciones editoriales «concerning» reutilizadas (clasificador de boilerplate).
- Pero la **capability-strip era idéntica en las 202 páginas** (3 pasos de UI
  genéricos: «Prepara/Ajusta/Entrega») y los pares hermanos de conversión
  compartían intención casi idéntica (55 herramientas conversoras).
- El motor del reclamo AdSense «contenido de bajo valor» (12 sep) exige
  originalidad percibida por el revisor humano: pasos reales por herramienta,
  contexto editorial enlazado (guías), jerarquía de migas de pan y respuestas
  direccionales que distingan herramientas hermanas.
- GSC (2026-08-28): 54 indexadas / 178 sin indexar; el hueco
  «Descubierta — aún no rastreada» se debía a categorías sin enlaces desde la
  portada (resuelto en SEO-03).
- Ventana de observación en curso: **9 → 23 sep**; checkpoints Día 7 (16 sep) y
  Día 14 (23 sep) pendientes de datos del owner.

## 2. Cambios aplicados (ronda 2, 12-16 sep)

Solo 4 archivos fuente (+ evidencias deterministas regeneradas):

1. **`scripts/generate-seo-pages.mjs`**
   - Capability strip **por herramienta**: `instructions[0..2]` reales con
     etiqueta «Paso N» (antes: strip idéntico en 202 páginas).
   - Nueva sección **`related-guides`** en las páginas de herramienta: hasta 3
     guías (las que referencian la herramienta; fallback a las de su categoría),
     enlazadas a `/guia/{slug}/`.
   - Nueva sección **`category-guides`** en las 12 páginas de categoría con las
     guías de su categoría.
   - **BreadcrumbList JSON-LD** nuevo en las 202 páginas de herramienta y en las
     12 de categoría.
2. **`scripts/generate-apluno-pages.mjs`**
   - Home: sección **«Tareas frecuentes»** con 12 herramientas populares
     (nombre + `summary` reales) enlazadas de forma crawlable (`href="/{slug}"`),
     reutilizando las clases `.apluno-home-cat-grid` / `.apluno-home-cat`.
3. **`scripts/audit-content-quality.mjs`** (clasificador, no se bajan umbrales)
   - `classifyPhrase` reconoce el formato de pasos («Paso N», prefijo `0[1-3]`)
     como chrome de UI: la nueva strip por tool no infla el boilerplate;
     restaura 15/15 PASS **warn=0**.
4. **`src/data/tools.json`** — 10 FAQs direccionales (1 por herramienta) en los
   5 pares hermanos más similares; hechos reales, sin estadísticas inventadas:
   - `unir-excel` ↔ `dividir-excel` (cuándo cada una; hojas/filas/rangos).
   - `codificar-url` ↔ `decodificar-url` (dirección: texto→%XX y %XX→texto).
   - `formatear-json` ↔ `validar-json` (embellecer vs. comprobar sintaxis).
   - `heic-a-imagen` ↔ `avif-a-imagen` (por qué convertir cada formato).
   - `html-a-imagen` ↔ `html-a-pdf` (cuándo imagen vs. documento imprimible).

No se añadieron herramientas, módulos, rutas del workspace ni se rediseñó la
interfaz; sin botones decorativos; sin cambios de CSS ni en las 144 rutas del
Workspace.

## 3. Páginas afectadas

- **202 páginas de herramienta**: strip real, sección de guías relacionadas,
  BreadcrumbList JSON-LD y (en los 10 pares) FAQ direccional.
- **12 páginas de categoría**: sección de guías + BreadcrumbList JSON-LD.
- **Home**: sección «Tareas frecuentes» (12 populares crawlables).
- `dist/` regenerado: 214 páginas públicas; APLUNO **237 URLs indexables**.

## 4. Indexabilidad (tras la ronda 2)

| Check | Resultado |
|---|---|
| Páginas descubiertas | 292 |
| **Indexables** | **236** (202 tools + 12 categorías + home + guías 11 + legales) |
| Noindex intencional | 56 (52 aliases de redirect + 404 + internas del Workspace) |
| Sitemap | **237 URLs**, 0 `.html`, 0 rotas, todas HTTPS y canónicas |
| Enlaces internos | **10.826**, 0 rotos; 4.206 a targets de redirect (correcto) |
| Orphan pages | **0** |
| Herramientas indexables + en sitemap | 202/202 |

## 5. Métricas de contenido (antes SEO-04 → después ronda 2)

Evidencia determinista: `audit-content-quality.json` y
`audit-content-similarity.json` (regeneradas en este build).

| Métrica | Antes (SEO-04) | Después (ronda 2) |
|---|---|---|
| maxSimilarity full-page (todas indexables) | 0.296 | **0.215** (par legal `/privacidad`↔`/privacy/`, pre-existente) |
| Pares en banda 0.20–0.35 | 78 | **1** (el mismo par legal; **0 pares tool-tool**) |
| Pares en banda 0.35–0.50 | varios | **0** |
| Strict editorial max sim (near-dup) | 0.145 | **0.000** |
| Peor sharedness por tool | 45% (`/jpg-a-webp`) | 45% (umbral 80%, estable) |
| Tools <70 palabras estrictas | 27 | **22** (intención cubierta: summary + ≥1 limitación + ≥2 FAQ) |
| Editorial estricto, min / p50 | 63 / 112 | **64 / 114** (p90 164, máx 361) |
| Tier estricto (T1/T2/LT) | 20/103/79 | **20/109/73** |
| Estrictas ≥140 palabras | 34 | **37** |
| JSON-LD válidos | 445 | **659** (+214 = BreadcrumbList en 202 tools + 12 categorías) |
| Boilerplate «concerning» | strip idéntica en 202 páginas | **0** (pasos reales por tool) |
| Huella total de plantilla | 2.9% | **2.8%** |

Distribución de calidad (A–F): A=47, B=189, C=0, D=0, E=56 (noindex
intencional), F=0 → A+B+C+D = 236 indexables.

## 6. SEO técnico

- **Structured data**: 659 bloques JSON-LD **válidos / 0 inválidos**; nuevo
  `BreadcrumbList` en 202 tools + 12 categorías (jerarquía Home → Categoría → Tool).
- Canonical HTTPS único por página, OG tags, robots.txt con sitemap: sin cambios
  (29/29 del gate SEO de producción).
- Categorías enriquecidas 12/12; guías editoriales **11/11** válidas con enlaces
  a herramientas reales; cross-linking editorial ahora desde 202 tools + 12
  categorías hacia `/guia/`.
- AdSense intacto: 15 páginas de navegación con loader, **0 loaders en las 202
  páginas de procesamiento**; `ads.txt` correcto; privacy actualizada.

## 7. Validación (todo verde, dist regenerado)

```text
npm run build                  → 214 páginas + APLUNO 237 URLs; AdSense 15/15
node scripts/audit-content-quality.mjs    → FINAL: PASS (15/15, warn=0)
node scripts/audit-content-similarity.mjs → PASS (5 pass, 1 warn pre-existente, 0 fail)
node tests/strict-editorial-regression.mjs→ 3 PASS / 0 FAIL (min 64 ≥ 60)
npm run test:release           → 24 PASS / 0 FAIL
                                 (seo 29, adsense 25, monetization 25,
                                  strict-editorial 3, similarity 5,
                                  DoD remediación 11, network-negative 413/413)
npm test                       → PASS (audit-count 202 tools, 273 HTML,
                                  156 procesadores + 39 handlers)
npm run test:apluno            → 44 PASS / 0 FAIL
```

Network-negative: **413/413** (cero egress externo en las 202 herramientas y el
flujo real); las páginas públicas no exfiltran datos.

## 8. Riesgos y limitaciones

- **Sin publicar todavía**: la revisión de Google AdSense solo se ve tras
  desplegar y recrawl; no se pueden fabricar métricas ni acelerar la cola de
  re-crawling. Regla 23 del owner: **no push** sin aprobación.
- Git: `main` local = `0107451` (2 commits por delante de `origin/main`
  `cfc9a9e`); push sería fast-forward no destructivo. **No se creó ningún
  commit** con esta ronda; el worktree solo contiene los 4 fuentes + evidencias
  regeneradas (regeneración determinista, diff cero al repetir).
- 19–22 tools siguen <70 palabras estrictas (según el auditor): **intencionado**,
  cumplen intent mínimo; el refuerzo se decide solo si GSC marca canibalización.
- Par `/privacidad`↔`/privacy/` (0.215) y `jpg-a-webp` 45 % sharedness son
  preexistentes y ajenos al reclamo; quedan documentados.
- GitHub Pages **ignora `_headers`** (CSP/HSTS): para headers reales haría falta
  proxy Cloudflare (el entorno tiene token, pero **no se modifica ningún
  registro DNS** sin orden).
- Evidencias `TLT-*` de otras suites aparecen «modificadas» en el worktree por
  regeneración (diseño determinista), no por esta ronda.
- Checkpoints GSC Día 7 (16 sep) y Día 14 (23 sep): pendientes de datos del
  owner.

## 9. Próximos pasos (requieren aprobación del owner)

1. **Aprobar commit** descriptivo de la ronda 2 (p. ej.
   `feat(seo): remediación AdSense low-value ronda 2 — strip por-tool, guías
   relacionadas, BreadcrumbList, home tareas frecuentes y FAQ direccionales`)
   y **push fast-forward** de `main` → repositorio
   `wandersepulveda2013/toolisto-web`; el workflow `deploy-pages.yml`
   (`on: push → main`) ejecuta `npm ci` + `build` + `test` + `test:apluno` +
   `test:release` y publica `dist/` en GitHub Pages (apluno.com).
2. **Tras el deploy**: reenviar `sitemap.xml` (237 URLs) en GSC y solicitar
   indexación de `/`, `/toolisto`, las 12 categorías, `/guia/` y 2-3 ejemplos
   editados (`/unir-excel`, `/html-a-pdf`, `/formatear-json`).
3. **Monitorizar Cobertura ~2 semanas** y cerrar los checkpoints Día 7 (16 sep)
   y Día 14 (23 sep) con datos reales de GSC.
4. **Siguientes rondas (P2/P3)** solo si GSC confirma canibalización: las 19–22
   tools cortas, las frases compartidas tipo «mis archivos se suben a un
   servidor» (19 tools, énfasis local-first) y diversificación de keywords.

## Reproducción

```text
npm run build
node scripts/audit-content-quality.mjs
node scripts/audit-content-similarity.mjs
node tests/strict-editorial-regression.mjs
npm run test:release
npm test
npm run test:apluno
```

Estado: **remediación implementada y validada (ronda 2 completa); pendiente de
despliegue y de la revisión de AdSense en producción.**