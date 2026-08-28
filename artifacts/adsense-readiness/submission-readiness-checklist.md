# APLUNO — Check-list de preparación para el envío a Google AdSense

**Site:** https://apluno.com · **Publisher:** ca-pub-2644615452393440 · **Fecha:** 2026-08-28 · **Capa 4 (LIVE)**

> Estado global: **ACTION_REQUIRED**. La versión certificada (Layer 1/2/3, HEAD `95aac07`) NO está
> desplegada; la corrección del `.webmcp` y el envío a Google son acciones de dueño/humano.

## A — Código (repo, certificado — COMPLETO)

- [x] Generadores con filtro de workspace (sin `.md` internos en `dist/workspace/`).
- [x] `ads.txt` en la raíz con `google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0`.
- [x] `robots.txt` permite todo + declara sitemap.
- [x] Loader único `ca-pub-2644615452393440` en home / catalog / categorías / about; CERO ads en procesamiento.
- [x] Privacidad con AdSense, cookies y sección IndexedDB/localStorage (en el dist certificado).
- [x] Guías `/guia/*` generadas (en el dist certificado).
- [x] Public release gate 22/22 · dist-workspace-smoke 28/28 · evidence determinism 81/81.

## B — Producción (LIVE — REQUIERE ACCIÓN)

- [ ] **Desplegar `95aac07`** a `origin/main` (dispara GitHub Pages). Comandos en `evidencia-live-production.md` §Acciones.
- [ ] Tras el deploy, **verificar en vivo**: `/guia/*` → 200; `/workspace/README.md` → 404; portada con
      `fetchpriority="high"`; privacidad con sección IndexedDB.
- [ ] **Resolver la inyección `/.webmcp/bridge.js`** del borde Cloudflare: confirmar si es una integración
      autorizada o **eliminarla** (script ajeno al repo en `<head>` de todas las páginas; backend `/mcp` 404).
- [ ] Confirmar render dinámico de anuncios (Preview de AdSense / navegador) — fuera de alcance de este entorno.
- [ ] (Nota) `/guia/` y `/workspace/` con `lang=es` en vez de `es-419` en algunos casos — menor; opcional.

## C — Google (externo — REQUIERE ACCIÓN)

- [ ] Enviar el sitio a **Google AdSense** (o confirmar revisión en curso) una vez desplegado y limpio.
- [ ] **Consentimiento / CMP**: configurar conforme a regiones (GDPR/TCF, CalOPPA, etc.) en Google/host.
- [ ] Añadir el sitio y dominio en **Search Console** y presentar **sitemap** tras el deploy.
- [ ] Confirmar el **estado de la cuenta** (APPROVED / UNDER REVIEW) — no inferirlo de pruebas; aquí = **UNKNOWN**.

## Criterio de cierre de Layer 4

Solo cuando: (1) `git ls-remote origin main` muestre `95aac07`, (2) verificación live confirme guías 200 /
workspace `.md` 404 / privacidad completa, (3) `/.webmcp` resuelto, el estado técnico podrá ser **READY** y
proceder el envío a Google.
