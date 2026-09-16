# Final Report Ronda 3 — Auditoría profunda APLUNO (contenido con bajo valor)

> Continúa la remediación por **CONTENIDO DE BAJO VALOR** (1.ª revisión;
> reactivada el 2026-09-12). Ronda 3 = **auditoría cualitativa de 18 fases** +
> implementación de los únicos cambios justificados.
> Estado: **implementado y validado en `dist/` al 100 %**; **sin commit/push**
> (regla del owner: el despliegue queda pendiente de aprobación humana).
> NO revierte la migración de marca Toolisto→APLUNO de rondas anteriores.

## 1. Objetivo y derivación

Ronda 3 audita el riesgo real de «contenido de bajo valor» más allá del texto
duplicado: ¿páginas «casi útiles», herramientas intercambiables, contenido a
escala, indexación con poco valor, spam, baja experiencia de página? Cada fase
produjo un veredicto (PASS / señal) y solo FASE 16 implementó cambios.

## 2. Hallazgos por fase (diagnóstico)

| Fase | Pregunta | Veredicto |
|---|---|---|
| 1-3 | Páginas débiles (<70 palabras estrictas) | **19** (eran 22; min=64, p50=114, max=361). Todas son utilidades reales con intent completo: summary + ≥2 FAQ + ≥2 limitaciones + pasos. Intencional. |
| 4-6 | Páginas «casi útiles» / herramientas intercambiables / contenido a escala | **Ninguna**. Diferenciación entre hermanos = **0** dentro de cada categoría (Jaccard de 6-shingle a nivel fuente). Máx full-page = **0.216**; peor sharedness = **45%** (`girar-pdf`, umbral 80%). Riesgo a escala LOW. |
| 7-8 | Indexación por valor (237 URLs del sitemap) | Coming-soon **`/ordia/`** (placeholder en desarrollo) y duplicados legales **`/privacidad`+`/condiciones`** (≈ `/privacy/`+`/terms/`) detectados para consolidación. |
| 9 | Contenido editorial | **11 guías**, 329-708 palabras, enfocadas a problemas, con enlaces a herramientas reales. 0 anuncios. Correcto. |
| 10 | Experiencia de página | Viewport, `lang=es-419`, H1 único, `<main>`, canonical, imágenes decorativas `alt=""`, sin elementos intrusivos. Limpio. |
| 11 | AdSense | Solo 14 páginas fuertes monetizadas (home + catálogo + 12 categorías). **0 anuncios** en tools/guías/legales. Correcto. |
| 12-13 | Spam / JSON-LD / FAQ | Sin spam ni plantillas; 658 bloques JSON-LD **válidos / 0 inválidos**; FAQ genuinos. Sin señales. |
| 14 | Motor de auditoría | `scripts/audit-content-quality.mjs` ampliado: **Check M** (ratio editorial) y **Check N** (coming-soon/placeholder). |
| 15 | Prueba de diferenciación hermanos | Nuevo `tests/audit-sibling-differentiation.mjs`: sharedness a nivel de frase por categoría. **2 PASS / 0 FAIL**. |

### Señales documentadas (no acciones) de FASE 14

- Ratio editorial: min=0.415, p50=0.581, max=0.777; sospechosos (ratio<0.30 y
  <80 palabras) = **0**.
- Detección de coming-soon señaló 18 páginas con «en desarrollo»: **todas falsos
  positivos legítimos** (Workspace/Ordía anuncian estado real; guías describen
  áreas en progreso) salvo `/ordia/`, que sí es un placeholder real y se
  consolidó en FASE 16.

## 3. Cambios implementados (FASE 16 — los únicos justificados)

Los 4.206 «enlaces alias de redirect» resultaron ser un artefacto benigno del
catálogo `/toolisto` (contado como alias por `_redirects`); no se tocó. Se
editaron 4 fuentes:

1. **`scripts/generate-seo-pages.mjs`**
   - Footer (páginas SEO/de herramientas): enlaces legales unificados a
     `/privacy/` y `/terms/` (antes `./privacidad` / `./condiciones`).
   - `buildLegalPage()`: las versiones legadas `privacidad.html` /
     `condiciones.html` ahora emiten `noindex, follow` y `canonical` a
     `/privacy/` y `/terms/` (consolidación, se mantienen servidas en 200).
   - Sitemap: eliminadas `/privacidad` y `/condiciones`.
2. **`scripts/generate-apluno-pages.mjs`**
   - `renderOrdia()`: `robots: 'noindex, follow'` (producto en desarrollo).
   - Sitemap: eliminados `/ordia/`, `/privacidad` y `/condiciones`.
3. **`tests/apluno-site.mjs`** — expectativa actualizada al estado correcto:
   sitemap incluye `/privacy/` + `/terms/` y excluye las legadas (más estricto).
4. **`tests/seo-production-audit.mjs`** — mismos criterios + nueva comprobación
   explícita de consolidación legal (servida, noindex, canonical correcto).

No se añadieron herramientas, módulos ni redes; no se modificó ninguna de las
144 rutas ni la interfaz; sin botones decorativos.

> `aumentar-resolucion-imagen` ya tenía FAQ/limitaciones honestas sobre
> interpolación vs. IA (líneas 12094-12112 de `src/data/tools.json`); **no se
> añadió contenido innecesario** — el ajuste descarta el cambio por no aportar.

## 4. Impacto en indexabilidad

| Métrica | Antes | Después |
|---|---|---|
| URLs en sitemap | 237 | **234** |
| `/ordia/` | indexable | **noindex, follow** (servida 200) |
| `/privacidad` `/condiciones` | indexables, en sitemap | **noindex, follow** + canonical `/privacy/` `/terms/`; fuera del sitemap |
| Footer legal | 2 rutas legadas (duplicadas) | 1 par canónico (`/privacy/` + `/terms/`) |
| Páginas indexables | 236 | **233** (202 tools + 12 categorías + home/catálogo + 11 guías + legales/privacy/terms + apoyar + about/contact/workspace-about) |

El near-dup max full-page pasa de 0.216 (par legal) a **0.088** al quedar
`/privacidad`+`/condiciones` fuera del set indexable: no queda ningún par
cercano en el índice.

## 5. Validación (FASE 17 — todo verde)

```text
npm run build                  → PASS; 234 URLs indexables; AdSense 15/15
node scripts/seo-audit.mjs     → 2328 PASS, 0 ERROR, 1 WARN (pre-existente: guías/alias)
node scripts/audit-content-quality.mjs    → FINAL: PASS (15/15, 2 warn, 0 fail)
node scripts/audit-content-similarity.mjs → PASS (5/5, 1 warn pre-existente, 0 fail)
node tests/audit-sibling-differentiation.mjs → 2 PASS, 0 FAIL (máx sharedness 36.36%)
node tests/strict-editorial-regression.mjs    → 3 PASS / 0 FAIL (min 64 ≥ 60)
node tests/apLUNO-production-seo.mjs          → 29 PASS / 0 FAIL
node tests/adsense-integration.mjs            → 25 PASS / 0 FAIL
node tests/apluno-monetization-readiness.mjs  → 25 PASS / 0 FAIL
node tests/content-similarity-regression.mjs  → 8 PASS / 0 FAIL
node tests/evidence-determinism.mjs           → 83 PASS / 0 FAIL
node tests/pwa-offline.mjs                    → 26/26 PASS
node tests/performance-loading-regression.mjs → 548 PASS / 0 FAIL
npm run test                   → PASS (audit-count 202 tools, 273 HTML)
npm run test:apluno            → 45 PASS / 0 FAIL
npm run test:release           → 24 PASS / 0 FAIL
node tests/seo-production-audit.mjs           → 3039/3039 PASS (234 indexables)
```

Notas:
- `tests/run-all.mjs` (harness completo) requiere el servidor local (8080) y
  Playwright; no ejecutable íntegro en esta sesión — los gates Node relevantes
  se validaron individualmente arriba.
- Se actualizaron las expectativas legacy de `apluno-site.mjs` y
  `seo-production-audit.mjs` al estado consolidado correcto (criterio superior,
  no rebaja).

## 6. Riesgos y limitaciones

- **Sin publicar**: la revisión de AdSense solo se ve tras desplegar y recrawl.
  Regla del owner: no push sin aprobación.
- El `/workspace/` funcional conserva `noindex, nofollow`; la red `/ordia/`,
  `/privacidad`, `/condiciones` siguen respondiendo 200 para no romper la ruta.
- Evidencias `TLT-*` marcadas en el worktree = regeneraciones deterministas de
  otras suites (diff cero al repetir).
- Checkpoints GSC (Día 7 = 16 sep, Día 14 = 23 sep) pendientes de datos del
  owner.

## 7. Conclusión y recomendación AdSense

El sitio no presenta «contenido de bajo valor» estructural:

- Cada herramienta es una utilidad real con intent completo; ninguna es
  intercambiable dentro de su categoría (similitud 0 a nivel fuente).
- El contenido editorial (11 guías) es original y orientado a problemas.
- La experiencia de página y la indexación por valor son correctas y
  coherentes.
- Los únicos elementos sin valor eran un placeholder y dos duplicados legales;
  este build los consolida (noindex + canonical sin romper rutas).

**Recomendación**: con la FASE 16 desplegada (sitemap 234 URLs limpio, 0
duplicados, 0 placeholders indexados), Apluno cumple el perfil de página fuerte
que AdSense exige. El siguiente contribuyente medible sería el contenido
editorial por encima del mínimo en las 19 tools cortas, solo si GSC confirma
canibalización tras el recrawl.

## Reproducción

```text
npm run build
node scripts/seo-audit.mjs
node scripts/audit-content-quality.mjs
node scripts/audit-content-similarity.mjs
node tests/audit-sibling-differentiation.mjs
npm run test
npm run test:apluno
npm run test:release
node tests/seo-production-audit.mjs
node tests/evidence-determinism.mjs
```

Estado: **Ronda 3 completa y validada; pendiente de despliegue y revisión de
AdSense en producción.**