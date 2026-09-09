# GSC Observation — Baseline y checklist (apluno.com)

> Etapa: `WAIT FOR GSC DATA`. Fecha de inicio: 2026-09-09 (auditoría POST-Fase-4).
> Código desplegado y verde; NO hay cambio de código pendiente.
> Este documento registra el baseline REAL conocido, el checklist de 14 días y
> la deuda técnica detectada. NO inventa datos: todo número proviene de la
> cobertura GSC del 2026-08-28 (SEO-01), de la remediación (SEO-01..SEO-05) o
> del audit local/producción (SEO-06) según se indica.

## 1. Baseline GSC (línea de partida del período de observación)

Números aceptados como baseline:

| Métrica | Valor | Fuente |
|---|---|---|
| URLs en sitemap | **237** | build local + produccion byte-identico (SEO-06) |
| Páginas indexadas | **54** | cobertura GSC 2026-08-28 (SEO-01) |
| Páginas rastreadas sin indexar | **169** | cobertura GSC 2026-08-28 (SEO-01) |
| Páginas sin indexar (remediacion afectada) | **~178** | cobertura GSC 2026-08-28 (SEO-01) |
| Categoria dominante (problema raiz) | «Descubierta — aún no rastreada» | las categorias no tenian enlaces reales desde la portada (SEO-03/04) |
| Prioridad | Reducir «Descubierta — aún no rastreada» y aumentar «Indexadas» | plan SEO-05 |

Estado del código en este momento: home con 12 `<a class="apluno-home-cat"
href="/{slug}">`, editorial diferenciado de 16 tools (Fase 2), guias 11/11,
sitemap 237 limpias, aliases noindex 56. Todo en HEAD `cfc9a9e` (publicado) +
commit local `0fd23da` (solo docs, SIN push).

REGLA: estos números se actualizarán ÚNICAMENTE con datos reales de GSC
exportados/leidos por un humano; NO se simula cobertura.

## 2. Checklist GSC (14 días)

### Día 0 — preparación e inspección inicial
- [ ] **Reenviar** `https://apluno.com/sitemap.xml` (237 URLs) en Sitemaps.
- [ ] **Inspección por URL + «Solicitar indexación»**:
  - `https://apluno.com/` (home con 12 categorias crawlables)
  - `https://apluno.com/toolisto`
  - `https://apluno.com/guia/` y `https://apluno.com/convertir-escaneado-imagen-en-texto-excel`
  - Las 12 categorias: `/pdf`, `/imagenes`, `/texto`, `/firmas`,
    `/qr-codigos`, `/calculadoras`, `/hojas-de-calculo`, `/documentos-word`,
    `/archivos`, `/audio`, `/video`, `/ebooks`
  - 5 herramientas representativas de los clusters prioritarios:
    `/jpg-a-pdf`, `/xls-a-xlsx`, `/ods-a-xlsx`, `/filtrar-csv`, `/comprimir-video`
- [ ] Anotar la fecha de la inspeccion (para comparar en el dia 14).
- [ ] NO solicitar las ~178 URLs en lote.

### Día 7 — primera lectura
- [ ] Revisar cambios de cobertura (Pages / Cobertura).
- [ ] ¿«Descubierta — aún no rastreada» disminuye? (debe bajar desde 178).
- [ ] ¿«Indexadas» aumenta? (debe subir desde 54).
- [ ] Re-inspeccionar UNA URL representativa que siga estancada (1 sola vez; no
      en bucle). Ejemplo: `/pdf` o `/xls-a-xlsx` si sigue sin indexar.

### Día 14 — comparacion y decision
- [ ] Comparar contra el baseline de la seccion 1.
- [ ] Determinar si existe evidencia suficiente (impresiones/clicks/cobertura/
      canibalizacion) para abrir la segunda ronda de diferenciacion (QUEUE P1).
- [ ] Si una clave concreta queda «rastreada sin indexar» de forma estable,
      decidir caso a caso (no por lote).
- [ ] Si aparece «Crawl anomaly» o caida en Rendimiento, comprobar si el proxy
      Cloudflare (`.webmcp/bridge.js`) altero algo — no se espera.

## 3. Segunda ronda — solo PREPARADA, no ejecutada

Se conserva la QUEUE de la auditoria POST-Fase-4 (`post-fase4-audit.md` §7);
NO se modifica ninguna de estas paginas todavia.

- **P1 (alta)** — diferenciar cuando GSC lo justifique:
  - `/avif-a-imagen` ↔ `/heic-a-imagen` (sim 0.250)
  - `/html-a-imagen` ↔ `/html-a-pdf` (sim 0.236)
  - `/formatear-json` ↔ `/validar-json` (sim 0.224; 67/63w)
  - `/codificar-url` ↔ `/decodificar-url` (sim 0.219; 63w)
  - `/unir-excel` ↔ `/dividir-excel` (sim 0.219)
  - Cluster webp/jpg: `/jpg-a-webp`, `/png-a-webp`, `/webp-a-jpg`,
    `/webp-a-png` (sharedness 45%..33%)
- **P2 (observar)**:
  - 23 tools con <70 palabras estrictas (de `/decodificar-url` 63w a
    `/texto-a-braille-unicode` 69w) — intervenir solo si GSC marca thin/canibalizacion.
  - Frases compartidas local-first «mis archivos se suben a un servidor» (n=19)
    — solo si GSC lo senala.
- **P3 (no tocar)**:
  - 52 aliases noindex (redirects estaticos) — correctos y enlazados.
  - 202 paginas de procesamiento sin AdSense loader — requisito de politica.
  - Boilerplate — 13 bloques, ninguno «concerning».
  - Keywords — 202/202 con >=4 (min 4).

## 4. Deuda técnica SEO/security (registro, sin correccion por ahora)

Hallazgos de la auditoria POST-Fase-4 (SEO-06), conservados como deuda:

| # | Deuda | Detalle | Efecto actual | Accion futura cuando se decida |
|---|---|---|---|---|
| D1 | `_headers` ignorado por GitHub Pages | `dist/_headers` (CSP, HSTS+preload, Referrer-Policy, Permissions-Policy, immutable) NO se aplica; produccion solo tiene HSTS `max-age=15552000` (6m, sin includeSubDomains/preload) y `x-content-type-options: nosniff` del origen | Headers de seguridad parciales; sin CSP/Referrer/Permissions/XFO | Servir headers desde Cloudflare (regla de transformacion) con validacion previa |
| D2 | CSP ingenuo romperia scripts inline | Paginas con config inline `{"toolId":...}`, IIFE en `/toolisto`, JSON-LD inline; `script-src 'self'` sin 'unsafe-inline' los bloquearia | Ninguno hoy (nunca se ha aplicado CSP en produccion) | Antes de habilitar CSP: extraer config inline a datos (`data-*`/JSON externo) o aplicar CSP report-only y medir |
| D3 | Assets con nombre estable | `apluno.css`, `apluno.js`, `apluno-tools-data.js`, `smart-search.js` sin hash de contenido | Cache actual `max-age=14400` (GitHub Pages) | NO usar `immutable` con estos nombres tras futuros deploys |
| D4 | HSTS sin includeSubDomains/preload | Actual `max-age=15552000` solo | Proteccion parcial | Revisar subdominios antes de `includeSubDomains`; no preload sin compromiso |
| D5 | Cloudflare inyecta `/.webmcp/bridge.js` | Proxy activo (`server: cloudflare` + `via: 1.1 varnish`); bridge ~46.5KB first-party inyectado en TODO HTML (incl. noindex y cuerpo de 301) | Sin impacto SEO (links `<a>` estaticos rastreables; tests corren sobre dist); primera party; HIT-cached | No tocar. Monitorizar si Googlebot reporta algo (no esperado) |

CONTROL: ninguna de estas deudas se corrige durante `WAIT FOR GSC DATA`.

## 5. Reglas del período

- No push de `0fd23da` ni de futuros commits de docs hasta decision del owner.
- No cambios de codigo, contenido, sitemap, robots, canonical ni Cloudflare.
- No solicitar indexacion en lote de las ~178 URLs.
- Los unicos datos validos para re-priorizar son los de GSC (humano) + los
  audits del repo (deterministas, en HEAD).