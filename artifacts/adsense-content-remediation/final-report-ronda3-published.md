# RONDA 3 — INFORME FINAL (prepubicación + verificación de producción)

Fecha: 2026-09-16
Rama: `main`  ·  Commit: `41032c1`  (`fix: complete AdSense content remediation round 3`)
Estado: **PUBLICADO** en `https://apluno.com` y verificado contra producción real.

---

## 1. Estado del repositorio

| Item | Estado |
|---|---|
| Rama publicada | `main` → `origin/main` = `41032c1` |
| Commit anterior | `8563376` (ronda 2) |
| Working tree | Limpio tras el commit |
| Lo que incluye el commit | Ronda 3 (remediación SEO) + migración de marca Toolisto→APLUNO pendiente + evidencias deterministas regeneradas (46 archivos, +1783/−1036) |

### Hallazgo crítico resuelto en la auditoría (FASE 18)
- La producción **pre-push no coincidía con el repositorio**: servía el commit `8563376` con marca
  "Toolisto", `/ordia/` indexable, y `/privacidad` + `/condiciones` en el sitemap.
- El worktree contenía la Ronda 3 **mezclada** con la migración de marca Toolisto→APLUNO que nunca se
  había commiteado (31 archivos fuente + tests + evidencias).
- Decisión (aprobada por el usuario): commit único con TODO, para que producción coincida con repo.

## 2. Validaciones locales — FASE 19 (re-ejecutadas post-push-state, contra el commit)

| Gate | Resultado | vs. baseline Ronda 3 |
|---|---|---|
| Build (234 indexable, 202 tools) | PASS | igual |
| `tests/apluno-site.mjs` | 45 PASS / 0 FAIL | igual |
| `scripts/test-public-release.mjs` | 24 PASS / 0 FAIL | igual |
| — adsense-integration | 25 PASS | igual |
| — apluno-production-seo | 29 PASS | igual |
| — apluno-monetization-readiness | 25 PASS | igual |
| — strict-editorial-regression | 3 PASS (min 64 ≥ 60) | igual |
| — content-similarity-scoped | 5 PASS (max sim 0.088) | igual |
| — adsense-remediation-dod | 11 PASS | igual |
| — public network-negative | 413/413 PASS | igual |
| `node scripts/seo-audit.mjs` | 2328 PASS / 0 ERR / 1 WARN (pre-existente) | igual |
| `node tests/seo-production-audit.mjs` | 3039/3039 PASS (234 indexables) | igual |
| `scripts/audit-content-quality.mjs` | PASS (15 pass, 2 warn, 0 fail) | igual |
| `tests/audit-sibling-differentiation.mjs` | 2 PASS / 0 FAIL (max 36.36%) | igual |
| `tests/performance-loading-regression.mjs` | 548 PASS / 0 FAIL | igual |
| `tests/evidence-determinism.mjs` | 83 PASS / 0 FAIL | igual |
| `tests/pwa-offline.mjs` | 26/26 PASS | igual |
| `tests/content-similarity-regression.mjs` | 8 PASS / 0 FAIL | igual |

**NINGUNA REGRESIÓN DETECTADA.** No se bajó ningún umbral ni se modificó texto de test para pasar.

## 3. Verificación de producción — FASE 22 (URL pública real `https://apluno.com`)

| Ruta | Estado | Robots | Canonical | Sitemap |
|---|---|---|---|---|
| `/ordia/` | 200 | `noindex, follow` | `https://apluno.com/ordia/` | ausente |
| `/privacidad` | 200 | `noindex, follow` | `https://apluno.com/privacy/` | ausente |
| `/condiciones` | 200 | `noindex, follow` | `https://apluno.com/terms/` | ausente |
| `/privacy/` | 200 | `index, follow` | `https://apluno.com/privacy/` | presente |
| `/terms/` | 200 | `index, follow` | `https://apluno.com/terms/` | presente |

- Sitemap: **234 URLs**, 0 coincidencias de `ordia|privacidad|condiciones`.
- `robots.txt`: `User-agent: * / Allow: /` + `Sitemap: https://apluno.com/sitemap.xml`.
- Canonicals sin vacíos/cruzados en las 5 rutas verificadas.
- AdSense: meta `google-adsense-account` (ca-pub-2644615452393440) y loader `adsbygoogle` en home,
  catálogo y categorías monetizadas; **0 loaders** en páginas de procesamiento (verificado en `/unir-pdf`).
- Marca: home y catálogo sirven **"APLUNO"** (título `APLUNO · 202 herramientas online para PDF, imágenes y archivos`).
- Deploy detectado por `last-modified: Wed, 16 Sep 2026 12:22:37 GMT` (antes: 14 Sep).

## 4. Sanity check del sitio — FASE 23

| Comprobación | Resultado |
|---|---|
| Crawl de las 234 URLs del sitemap | 200 OK todas; 0 rotas; 0 redirects; 0 páginas vacías |
| Home | 698 palabras visibles, canonical, AdSense |
| Página de herramienta (`/unir-pdf`) | 651 palabras, 1 H1, canonical, sin loader AdSense |
| Categorías (muestras) | 200, canonical, loader AdSense |
| Guías (`/guia/`) | 493 palabras, indexable |
| About / Contact / Workspace / Workspace-about | 200, títulos correctos |
| 404 (`/404`) | `noindex, nofollow`, "Página no encontrada" |
| Alias de redirect (`/merge-pdf`) | 200, canonical → `/unir-pdf` |
| Assets del catálogo (12) | 11 repo-assets 200 OK |

### Observaciones (sin defecto del repo)
1. **Cloudflare edge** inyecta `<script type="module" src="/.webmcp/bridge.js">` (98 KB, MCP/agente,
   código de análisis de imagen/C2PA sin fetch/XHR/beacon/cookies/ads). No está en `dist/`, no es de la Ronda 3.
2. **Cloudflare email-protection** reescribe `mailto:` y añade `cdn-cgi/scripts/.../email-decode.min.js`
   que devuelve 404 en el borde. No está en `dist/`; sin impacto funcional constatado.
3. **Footer del catálogo** (`toolisto.html`, copiado verbatim del README de origen) sigue enlazando
   `/privacidad` y `/condiciones` (ratones legadas). Ambas responden 200 + noindex + canonical correcto,
   por lo que **no impide la corrección técnica aprobada** y NO se modificó (regla: no cambios sin error real).

## 5. Veredicto

- Repositorio: limpio, commit único descriptivo en `main`.
- Producción: coincide con el repositorio en los puntos verificados (marca, indexabilidad, legal, sitemap, AdSense).
- Regresiones: **NINGUNA.**
- Remediación aprobada (Ronda 3): implementada, validada localmente, publicada y verificada en producción.

**VEREDICTO: APLUNO — READY FOR ADSENSE REVIEW**