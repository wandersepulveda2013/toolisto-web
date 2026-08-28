# Layer 3 — Producción Monetización y Entrega de Política (evidencia)

**Auditoría:** Capa 3 de AdSense — Certificación de Monetización en Producción y Entrega de Políticas.
**Publisher:** `ca-pub-2644615452393440` — único, consistente en SOURCE/DOCS/TEST/DIST, sin placeholders.
**URL raíz:** https://apluno.com — **Clasificación: READY** (revisión de Google pendiente, externa).

## Pipeline de producción certificado

`npm run build` → `node scripts/build-public-site.mjs`:
limpieza `rmSync(dist)` → `generate-seo-pages.mjs --production` → `generate-apluno-pages.mjs` → `inject-adsense.mjs`.
El gate `scripts/test-public-release.mjs` ejecuta exactamente este pipeline y **22/22 PASS**.

## Inventario de superficies monetizables (291 HTML en dist)

| Tipo | n | Con AdSense | Multi-loader | Verificación |
|------|---|-------------|--------------|--------------|
| TOOL (procesamiento) | 202 | 0 | 0 | 0 ads (privacidad) |
| REDIRECT | 52 | 0 | 0 | noindex + canonical |
| CATEGORY | 12 | 12 (1 c/u) | 0 | 1 loader cada una |
| GUIDE | 10 | 0 | 0 | indexable |
| WORKSPACE | 2 | 0 | 0 | runtime / landing |
| APLUNO_HOME | 1 | 1 | 0 | 1 loader |
| TOOLISTO_CATALOG | 1 | 1 | 0 | 1 loader |
| ABOUT | 1 | 1 | 0 | 1 loader |
| PRIVACY/TERMS/CONTACT/404/ORDIA/APOYAR/legacy | 8 | 0 | 0 | 0 ads |
| OTHER (guia/index, offline) | 3 | 1 | 0 | home tiene 1 |

**Anomalías: 0** (ninguna página con >1 loader; ninguna superficie no monetizada con ads;
ninguna página monetizada sin loader; sin slots manuales — arquitectura Auto Ads).

## ads.txt / robots / _headers

- `ads.txt` = `google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0` (válido, raíz, línea única).
- `robots.txt` permite todo y declara `Sitemap: https://apluno.com/sitemap.xml`; no bloquea páginas monetizadas.
- `_headers` CSP permite `pagead2.googlesyndication.com` / `googleads.g.doubleclick.net`.
  **Nota externa:** GitHub Pages no aplica `_headers`; Cloudflare no inyecta CSP real — config del host, no defecto de código.

## Entrega de políticas / consentimiento

- **Privacidad**: divulga AdSense + cookies/identificadores de Google; aclara que AdSense **no** está en páginas de
  procesamiento y que **no** se envía a Google el contenido de archivos; divulga IndexedDB/localStorage;
  aborda el **consentimiento** ("conforme a las opciones de consentimiento aplicables").
- **Términos**: consistente, productos "En desarrollo" sin promesas falsas.
- **Contacto**: real (`toolistoweb@gmail.com`), alcanzable desde footer.
- **Acerca de**: marca consistente (APLUNO / Toolisto / Workspace).

## Aislamiento de fallos y Service Worker

- Loader único global `async crossorigin="anonymous"`; sin `adsbygoogle` inline; el sitio no depende de AdSense.
- `service-worker.js`: **0** referencias a dominios de anuncios; rutas monetizadas siempre en red (`network-first`).

## Defecto corregido: fuga del Workspace

`dist/workspace/` publicaba 19 `.md` internos + 2 marcadores del agente. Corregido con
`copyWorkspaceFiltered` en `generate-seo-pages.mjs`; **guardado** en `test-public-release.mjs`
(22º check). Post-fix: **0** `.md` y **0** marcadores en dist/workspace. `dist-workspace-smoke`: **28/28**.

## Rastreabilidad / navegación

- Enlaces de navegación en portada + catálogo: **261 resueltos OK, 0 rotos** (audit local).
- 202/202 herramientas con página materializada; 236 URLs indexables; sitemap 236 URLs.

## Verificación (gates)

- Public release gate: **22 PASS / 0 FAIL**.
- dist-workspace-smoke: **28/28**.
- Evidencia determinista (regeneración = diff cero).
- `apluno-launcher`: 34 checks / **1 fail pre-existente** (overflow CSS desktop, clasificado PRE-EXISTING,
  fuera del alcance AdSense, documentado, no corregido).

**Clasificación final: READY.** `EXTERNAL ADSENSE STATUS: PENDIENTE_REVIEW_GOOGLE` (aprobación de Google
y configuración de consentimiento/CMP quedan como requisitos externos).
