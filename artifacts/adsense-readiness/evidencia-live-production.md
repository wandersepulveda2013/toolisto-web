# Evidencia — Layer 4: Verificación LIVE de Producción (https://apluno.com)

**Fecha:** 2026-08-28 · **Capa:** 4 (LIVE PRODUCTION) · **Publicador:** ca-pub-2644615452393440

> Misión: determinar si el sitio realmente accesible en `https://apluno.com` coincide con el
> artefacto certificado del repositorio (HEAD `95aac07`, Layer 1/2/3) y si está listo para
> revisión/envío de Google AdSense. Autoridad: **LIVE PRODUCTION** (no SOURCE ni DIST).

---

## 1 — Despliegue (FASE 1) — CLASIFICACIÓN: NOT DEPLOYED

| Ítem | Valor |
|------|-------|
| HEAD local (certificado Layer 1/2/3) | `95aac07` |
| `origin/main` (desplegado; dispara GitHub Pages) | `0e2e14a` |
| Commits locales no empujados | **25** (`0e2e14a..95aac07`) |
| ¿`95aac07` en `origin/main`? | **NO** |
| ¿`0e2e14a` es ancestro de `95aac07`? | **SÍ** (lo desplegado es más antiguo) |
| Mecanismo de deploy | Workflow GitHub Pages en push a `main` |

**Evidencia del desfase (en LIVE):**
- `/guia/` → **404** (las 11 guías `/guia/*` son commits locales NO desplegados; sitemap live 225 vs dist 236).
- Fuga de workspace vigente: `/workspace/README.md`, `/workspace/AUTONOMOUS-CONTEXT.md`,
  `/workspace/CONTINUOUS-EVOLUTION-MISSION.md`, `/workspace/PRODUCTION-READINESS-MISSION.md`,
  `/workspace/AUTONOMOUS_MODE`, `/workspace/PRODUCTION_READINESS_DONE` → **HTTP 200** (commit `0e2e14a`
  conserva `cpSync(WS_SRC, WS_DIST, {recursive:true})` sin filtro).
- `last-modified` de páginas live: `Mon, 24 Aug 2026` (anterior a los fixes de capa 3 del 28 ago).
- Portada live sin `fetchpriority="high"` (presente en el dist local → el build live difiere).

## 2 — URLs y canonicalización (FASE 2/3)

- `http://apluno.com/` → **301** → `https://apluno.com/`
- `http://www.apluno.com/` → **301** → `https://www.apluno.com/` → **301** → `https://apluno.com/`
- `https://www.apluno.com/` → **301** → `https://apluno.com/`
- `https://apluno.com/` → **200** con `rel="canonical" href="https://apluno.com/"` (canonical coherente).
- 202 herramientas, 12 categorías (igual que dist).

## 3 — ads.txt vivo (FASE 4)

`google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0` — **coincide byte a byte** con el dist certificado.

## 4 — Consistencia del ID de AdSense en vivo (FASE 5)

`ca-pub-2644615452393440` presente en home, `/toolisto` y `/about/`; un solo loader por página; SIN
placeholder (`pub-000…`/`pub-123…`) en páginas muestreadas; las páginas de herramientas NO llevan ads.

## 5 — Páginas de políticas en vivo (FASE 6)

- **Privacy:** divulga AdSense, cookies/identificadores de Google y consentimiento; declara que AdSense NO está
  en las páginas de procesamiento y que el contenido de archivos no se envía a Google.
  ⚠️ **Falta la sección "Almacenamiento local" (IndexedDB/localStorage)** — el fix `79c54db` (Layer 1 P1) NO está
  desplegado. (Gap de desplegamiento, no defecto de código: la corrección existe en el repo.)
- **Terms:** coherente; productos etiquetados "En desarrollo"; sin referencias obsoletas "167 herramientas".
- **About:** coherente con la marca; sin placeholders; canonical correcto.
- **Contact:** email real `toolistoweb@gmail.com` (protegido por Cloudflare Email-Protection; NO placeholder).

## 6 — Superficie de crawler de Google (FASE 7)

- `robots.txt`: permite todo + declara `Sitemap: https://apluno.com/sitemap.xml`.
- `sitemap.xml` live: **225 URLs** (faltan 11 = todas `guia/*`), dominio `https://apluno.com` (sin localhost).
- Muestra de 5 URLs del sitemap live: **5/5 → HTTP 200 + canonical coherente**.

## 7 — Enlaces internos en vivo (FASE 8)

- 230 enlaces internos desde home + `/toolisto`; **0 rotos reales de cara al usuario**.
- El único "404" detectado (`/cdn-cgi/l/email-protection`) es el artefacto benigno de Cloudflare Email-Protection
  (no un enlace de navegación roto).

## 8 — Interferencia de Cloudflare (FASE 9) — ⚠️ HALLAZGO DE INTEGRIDAD

- **Inyección de HTML en el borde:** todas las páginas live llevan
  `<script type="module" src="https://apluno.com/.webmcp/bridge.js">` al **inicio de `<head>`** (antes de
  canonical/robots).
- `/.webmcp/bridge.js` → **200**, `text/javascript`, **47 KB**, cacheado en Cloudflare (`Cf-Cache-Status: HIT`),
  `Access-Control-Allow-Origin: *`.
- Es un **puente WebMCP (Model Context Protocol)** de cliente (referencia packs/herramientas y `/mcp`).
- Su backend `https://apluno.com/mcp` → **404** (el puente no conecta a nada live).
- **NO existe en el build/`dist/` del repo ni en el código fuente del repo** (las únicas menciones `webmcp` en el
  repo son nombres de categoría de auditorías Lighthouse). => Inyección desde el **borde Cloudflare** (worker/regla)
  post-deploy, ajena al build certificado.
- **Riesgo:** script ajeno al repo ejecutándose en cada página; preocupación de integridad/supply-chain.
  Acción del dueño: confirmar si es una integración autorizada o **eliminarla**.
- Email-Protection de Cloudflare en `/contact/`: benigno (artefacto CF, no defecto).

## 9 — Triángulo Source/Dist/Live (FASE 10)

Divergencias live vs build certificado: falta de guías `/guia/*`, fuga de `.md` de workspace,
sin `fetchpriority="high"` en css de portada, inyección WebMCP solo-live. **Causa raíz:** commits
certificados de Layer 1/2/3 no empujados a `origin/main` (despliegue bloqueado como `BLOCKED_EXTERNAL`).

## 10 — Aislamiento de fallo de AdSense en vivo (FASE 11)

- `ads.txt` coincide, loader en las páginas esperadas, un solo loader por página, cero ads en páginas de
  procesamiento. Aislamiento estático **OK**.
- Render dinámico de anuncios: **fuera de alcance** de este entorno (sin navegador headless); el dueño debe
  confirmarlo vía Google AdSense / Preview / Search Console.

## 11 — Indexabilidad spot-check (FASE 12)

Muestra representativa (home, `/toolisto`, categoría `/pdf`, herramientas `/unir-pdf`, `/girar-pdf`):
**todas HTTP 200, `robots: index, follow`, `lang: es-419`, canonical coherente**. ✓

## 12 — Requisitos externos de Google y consentimiento (FASE 13/14)

- `ads.txt` ⚠️ **en la raíz** del apex (correcto para AdSense).
- **Indispensable:** resolver el despliegue (publicar `95aac07`) para que Google vea la versión certificada.
- **Indispensable:** definir/eliminar el `/.webmcp` del borde antes del envío.
- **Consentimiento/CMP:** configurar conforme a las regiones aplicables (GDPR/TCF, etc.) en Google/host — externo.

## 13 — Clasificaciones finales (FASE 15/19/20)

| Clasificación | Resultado |
|---------------|-----------|
| **Estado técnico del sitio live** | **NOT_READY_LIVE** (artefacto certificado NO desplegado; fuga de `.md` vigente; falta IndexedDB en privacidad; guías ausentes; inyección `.webmcp` ajena al repo) |
| **Estado de la cuenta Google AdSense** | **UNKNOWN** (sin visibilidad del estado de revisión; no inferir APPROVED) |
| **Estado de preparación para envío** | **ACTION_REQUIRED** (despliegue + limpieza `.webmcp` + verificación live post-deploy) |

## Acciones (delegadas al dueño, BLOCKED_EXTERNAL)

1. **Desplegar la versión certificada:** ver comandos manuales abajo (prohibido `git push` desde este entorno).
2. **Eliminar/confirmar** la inyección `/.webmcp/bridge.js` del borde Cloudflare.
3. **Re-correr** esta verificación LIVE tras el despliegue.
4. **Enviar a Google AdSense** y configurar consentimiento/CMP.

### Comandos manuales para publicar la versión certificada (ejecutar en el repo)

```bash
# 1) Revisar estado (en rama main, HEAD=95aac07, 25 por delante de origin/main)
git status
git log --oneline origin/main..HEAD

# 2) Publicar la versión certificada a origin/main (dispara el workflow de GitHub Pages)
git push origin main

# 3) Confirmar que el deployment refleja 95aac07 y que production se actualizó
git ls-remote origin main          # -> debería mostrar 95aac07
# Luego verificar en vivo: /guia/ 200, /workspace/README.md 404, portada con fetchpriority=high
```

> Regla de agotamiento: tras el push, verificar en vivo que `/guia/*` devuelve 200, que
> `/workspace/*.md` devuelve 404 y que la inyección `/.webmcp` fue resuelta; solo entonces el
> estado técnico live puede pasar a **READY**.
