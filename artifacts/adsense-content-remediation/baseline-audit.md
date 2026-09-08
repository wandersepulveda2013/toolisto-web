# Baseline Audit — APLUNO Content Remediation

> Motivo de AdSense: **CONTENIDO DE BAJO VALOR**.
> Propósito: registrar el estado inicial del sitio ANTES de la remediación para
> poder medir el cambio y tener un punto de referencia reproducible.

## Estado del repositorio

- Rama: `main`
- HEAD: `c4e53c7` (`perf(server,workspace): cache headers + vendor lazy-load (407KB saved)`)
- 14 commits por delante de `origin/main`
- Worktree: 8 archivos entre modificados y sin seguimiento (evidencia de gates previos,
  sin impacto en el build de producción)

## Arquitectura del sitio

APLUNO es un sitio estático generado desde datos JSON y servido vía GitHub Pages.

### Generadores (escriben en `dist/`)

| Script | Rol |
|---|---|
| `scripts/generate-seo-pages.mjs` | Build de Toolisto: 214 páginas (202 herramientas + 12 categorías + 404 + privacidad + condiciones + apoyar) + sitemap/robots/redirects |
| `scripts/generate-apluno-pages.mjs` | Build del sitio de marca APLUNO: `/` (launcher), `/about/`, `/ordia/`, `/workspace-about/`, `/contact/`, `/privacy/`, `/terms/`, 404. Sobrescribe index/sitemap/robots/_redirects |
| `scripts/inject-adsense.mjs` | Inyecta el loader de AdSense en 15 páginas de navegación/catálogo |

### Fuentes de datos (`src/data/`)

| Archivo | Contenido |
|---|---|
| `tools.json` | 202 herramientas, cada una con slug, title, description, h1, summary, inputFormats, outputFormats, faq[], instructions[], limitations[], relatedSlugs[], keywords[], indexable, enabledInSitemap |
| `categories.json` | 12 categorías con name, slug, description, toolIds, slugs |
| `site.config.json` | Dominio, nombres, analytics, feedback, apoyo |
| `apluno.products.json` | Productos (Toolisto, Workspace, Ordía), email, tagline |
| `redirects.json` | Aliases/redirecciones |

### Resultado de indexación generado

- Herramientas indexables: **202** (todas: `enabled=true`, `indexable=true`, `enabledInSitemap=true`)
- Categorías: **12** en sitemap
- URLs indexables en sitemap: **225** (APLUNO build)

## Medición de calidad de contenido (baseline)

Medido con `_toolisto_autopilot/tmp/analyze-tools.mjs` (202 herramientas habilitadas).

### Campos obligatorios presentes
- FAQ: 202/202 ✓
- Instrucciones: 202/202 ✓
- Limitaciones: 202/202 ✓
- Herramientas relacionadas: 202/202 ✓
- **keywords vacíos: 45/202 ✗**

### Problemas detectados (causas probables del "contenido de bajo valor")

1. **Cero contenido editorial.** No hay guías, recursos ni sección tipo "Aprender".
   El único contenido es la ficha de cada herramienta + un launcher de búsqueda en `/`.
2. **Páginas de herramienta templadas.** La estructura de generación es idéntica para las
   202 herramientas (misma plantilla), y muchas herramientas de conversión comparten
   instrucciones casi literales ("Selecciona… / Haz clic en Convertir / Descarga…").
3. **45 herramientas sin `keywords`** (campo de búsqueda/internal-linking vacío).
4. **Páginas de categoría = rejilla de enlaces.** Solo `<description>` de una línea y la
   lista de herramientas. Sin explicación de criterios de elección ni agrupación útil.
5. **Home = launcher desnudo.** Solo buscador + chips + lista. Sin propuesta de valor,
   sin categorías enlazadas ni contexto.
6. **HTML por herramienta visible es escaso/texto repetitivo** para cientos de URLs:
   el "valor independiente" de cada página indexable es bajo.
7. **~55 herramientas de conversión** con intención muy parecida (jpg→png, png→jpg,
   csv→x, x→csv…) que compiten entre sí y se leen como variaciones de plantilla.

### No indexables actualmente
- 404, redirects estáticos: `noindex`.
- Páginas de procesamiento de archivos en Toolisto: 0 AdSense (no son problema de indexación).

## Puertas de calidad (baseline)

| Gate | Resultado |
|---|---|
| `node scripts/test-public-release.mjs` (19 checks + adsense + seo + monetization) | **19 PASS, 0 FAIL** |
| Gracias al build: 214 páginas Toolisto + APLUNO + sitemap/robots/redirects | OK |

## Criterio final de calidad

> "Si un usuario llegara desde Google a esta página y jamás usara el resto de APLUNO,
> ¿esta página le daría información y funcionalidad suficientes para justificar su
> existencia independiente?"

Con el estado actual la respuesta es **NO** para la mayoría de las páginas: hay
funcionalidad, pero muy poco valor informativo/editorial independiente. Esto es lo que
esta misión debe corregir aumentando el valor real (guías, contexto de categorías,
diferenciación de herramientas, confianza) — no inflando palabras.

## Estado de la remediación en curso

Fases pendientes según `CONTINUOUS-EVOLUTION` / misión AdSense. Ver informe final
(`final-report.md`) al concluir.
