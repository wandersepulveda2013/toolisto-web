# ACTIVE-MISSION.md — Mission Tracker

## Status: ACTIVE

Misión vigente: **ADSENSE LIVE PRODUCTION VERIFICATION** (verificación del sitio realmente
accesible en https://apluno.com respecto del artefacto certificado en el repositorio).

> Regla del sistema: solo un humano detiene el ciclo (`AUTONOMOUS_STOP`). El runner continúa
> automáticamente hasta `PENDING = 0` e `IN_PROGRESS = 0`, o hasta que lo restante sea
> `BLOCKED_EXTERNAL` (depende de acciones del dueño/humano o de Google).

---

## Capa anteriores (cerradas)

- **Layer 1 — Editorial/Content Quality: COMPLETE** (commit base de capa 1/2).
- **Layer 2 — Originality/Similarity: COMPLETE** (`021c342`).
- **Layer 3 — Production Monetization & Policy Delivery: COMPLETE** (`95aac07`).
  - Public release gate 22/22 · dist-workspace-smoke 28/28 · evidence determinism 81/81.
  - Clasificación de repositorio: `READY`.
  - `EXTERNAL ADSENSE STATUS: PENDIENTE_REVIEW_GOOGLE`.

---

## Layer 4 — LIVE PRODUCTION VERIFICATION (misión actual)

**Hallazgo crítico (FASE 1):** el artefacto certificado NO está desplegado.

| Ítem | Valor |
|------|-------|
| Branch local | `main` |
| HEAD local (certificado) | `95aac07` |
| origin/main (desplegado / dispara GitHub Pages) | `0e2e14a` |
| Commits locales NO empujados | **25** (`0e2e14a..95aac07`) |
| ¿`95aac07` está en origin/main? | **NO** |
| ¿`0e2e14a` es ancestro de `95aac07`? | **SÍ** (el desplegado es más antiguo) |
| Mecanismo de deploy | GitHub Pages workflow `.github/workflows/deploy-pages.yml` (push a `main`) |
| Clasificación FASE 1 | **NOT DEPLOYED** |

Evidencia en vivo del desfase:
- `/guia/` → **404** (las guías están en commits locales NO desplegados).
- `/workspace/README.md`, `/workspace/AUTONOMOUS-CONTEXT.md`, `/workspace/AUTONOMOUS_MODE`,
  `/workspace/PRODUCTION_READINESS_DONE` → **HTTP 200** (la fuga de capa 3 sigue en producción).
- Sitemap LIVE 225 URLs vs DIST 236 (faltan las 11 `/guia/*`).
- `last-modified` de páginas LIVE: `Mon, 24 Aug 2026` (build anterior a capa 3 del 28 ago).

**Decisión tomada (instrucción humana):** NO hacer `git push`/merge/rebase/reset ni cambios
destructivos. Completar TODAS las fases de verificación LIVE que no requieran deployment.
Clasificar estado como `NOT DEPLOYED` y el deployment como `BLOCKED_EXTERNAL / ACTION REQUIRED`.
Dejar al final los comandos exactos manuales para publicar la versión certificada.

---

## Fases Layer 4

| Fase | Estado |
|------|--------|
| FASE 1 — Deployment status | DONE (NOT DEPLOYED) |
| FASE 2 — Live URL inventory | DONE |
| FASE 3 — HTTPS/redirect canonicalization | DONE (todo → https://apluno.com/) |
| FASE 4 — ads.txt live | DONE (coincide byte a byte) |
| FASE 5 — AdSense ID live consistency | DONE (ca-pub-2644615452393440) |
| FASE 6 — Policy pages live | DONE (privacidad sin IndexedDB live = gap deploy) |
| FASE 7 — Google crawler surface | DONE (robots ok; sitemap 225 live; muestra 5/5) |
| FASE 8 — Live internal links | DONE (230 links, 0 rotos reales) |
| FASE 9 — Cloudflare interference | DONE (⚠️ .webmcp/bridge.js inyectado en borde, ajeno al repo) |
| FASE 10 — Source/dist/live triangle | DONE |
| FASE 11 — AdSense failure isolation live | DONE (estático OK; render dinámico fuera de alcance) |
| FASE 12 — Indexability spot check | DONE (5/5 200 index/follow es-419) |
| FASE 13 — External requirements | DONE (ACTION REQUIRED) |
| FASE 14 — Consent/CMP handoff | DONE (externo Google/host) |
| FASE 15 — Two classifications | DONE (LIVE=NOT_READY_LIVE; ACCOUNT=UNKNOWN) |
| FASE 16 — Evidence | DONE (live-production-audit.json determinista; evidencia-live-production.md) |
| FASE 17 — Update final report (Layer 4) | DONE (sección Layer 4 + estado LIVE en cabecera) |
| FASE 18 — Submission readiness checklist | DONE (submission-readiness-checklist.md) |
| FASE 19/20 — Close mission | DONE (BLOCKED_EXTERNAL: deploy + .webmcp) |

## Cierre de misión (FASE 19/20)

- **Clasificaciones finales:**
  - REPOSITORY (certificado): **READY**
  - LIVE SITE: **NOT DEPLOYED** (el certificado `95aac07` NO está en origin/main; live refleja `0e2e14a`)
  - ADSENSE ACCOUNT: **UNKNOWN / ACTION REQUIRED**
- **Bloqueos restantes (BLOCKED_EXTERNAL, acción del dueño/humano):**
  1. `git push origin main` para desplegar `95aac07` (prohibido desde este entorno por ACENTS.md).
  2. Resolver la inyección `/.webmcp/bridge.js` del borde Cloudflare (confirmar o eliminar).
  3. Re-correr esta verificación LIVE tras el deploy.
  4. Enviar a Google AdSense y configurar consentimiento/CMP.
- **No se cambió la clasificación a LIVE READY** porque el commit certificado no está realmente desplegado.
- **Determinismo:** `live-production-audit.json` verificado determinista (hash SHA256 idéntico al regenerar).
  `ad-surface-inventory.json` es evidencia estática versionada (sin generador reproducible); se conserva sin cambios.
- **Commits:** se registra la evidencia/cambios de reporte de Layer 4 (sin push).
