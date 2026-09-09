# Post-Fase-4 Audit — APLUNO.com (obsolución/post-despliegue)

> Fecha: 2026-09-09. HEAD auditado: `cfc9a9e` (= origin/main). Determinístico,
> sin tocar producción. Resultado: NO CODE CHANGES REQUIRED → esperar datos GSC.

## 1. ESTADO

### Código
- HEAD local = origin/main = `cfc9a9e`. Working tree limpio salvo churn de
  evidencia regenada por los gates (PNGs/JSON de `artifacts/` y
  `screenshots/`) que **no** se commitea (anti-churn).
- Últimos commits de la remediación: `c862635` (informe), `ed019a5` (fix CI
  Playwright), `cfc9a9e` (registro de publicación).

### Producción
- Verificado por HTTPS en esta auditoría (2026-09-09): `/`, `/toolisto`,
  `/pdf`, `/jpg-a-pdf`, `/xls-a-xlsx`, `/filtrar-csv` → **200**; `/merge-pdf`
  (alias) 200 con canonical `/unir-pdf` + `noindex`; `/unir-pdf.html` 200 con
  canonical limpio; `http://apluno.com/` y `https://www.apluno.com/` → **301**
  a `https://apluno.com/`.
- **Sitemap y robots byte-idénticos** al build local: sitemap 39251 bytes
  (237 URLs), robots 64 bytes (`Allow: /` + sitemap). Confirmado igualdad `===`.
- Home: `<meta name="robots" content="index, follow">`, canonical
  `https://apluno.com/`, **12 `<a class="apluno-home-cat" href="/{slug}">`**
  + links a `/toolisto` y `/guia/` (verificado con UA de Googlebot).
- JSON-LD inline válido en home/toolisto/tools (445 bloquees válidos en dist).

### CI
- Local (esta auditoría, sobre HEAD): build OK (AdSense 15 páginas / 202 de
  procesamiento sin loader), `audit-content-quality` **15/15**, `audit-content-
  similarity` **PASS (warn=1 no bloqueante)**, `test:apluno` 44/44, release
  gate `npm run test:release` → **24 PASS / 0 FAIL** (network-negative
  413/413).
- GitHub Actions: runs `34352644263` (ed019a5) y `34353533660` (cfc9a9e)
  SUCCESS.

### SEO técnico
- Sitemap 237 URLs (0 `.html`), 0 rotas; noindex en sitemap: 0.
- Indexable 236; noindex intencional 56 (52 aliases + 404 + internas);
  orphan indexable: **0**.
- Enlaces internos 10.520 / **0 rotos** (4.206 apuntan a targets de redirect
  — esperado, canonical/refresher).
- Metadata: 0 empty/dup title, 0 empty/dup desc, 0 multiH1; placeholders 0.
- Structured data: 445 válidos / 0 inválidos. Categories 12/12; guías 11/11.
- Redirects limpios (301, sin loops); aliases noindex correctos.

### Contenido
- Quality A=47 / B=189 / C=0 / D=0 / E=56 / F=0. `thinContent.flagged=[]`.
- maxSimilarity full-page **0.250** (pareja avif↔heic; bajo umbral 0.7 HIGH_DUP).
- Strict editorial: min 63 palabras, p50 112, máx 361; **23 tools <70** (todas
  cumplen intent: ≥2 FAQ, ≥1 limitación).
- Originalidad: min 55% únicas (`/jpg-a-webp`), mediana 100%; huella global de
  plantilla 2.9%; 0 defectos CJK/emoji/control.
- **Keywords: 0 tools con ≤1 keyword** (distribución 4..9 por tool; min 4;
  202/202). El punto «herramientas de 1 sola keyword» del final-report ya no
  aplica en HEAD.

### GSC
- **Sin acceso real desde este entorno** (no hay credenciales/export). No se
  simula cobertura: no se afirma que ninguna URL esté indexada. Las cifras
  conocidas siguen siendo las de la cobertura 2026-08-28 (54 indexadas / 178 sin
  indexar / 169 rastreadas sin indexar) — pendiente de actualización humana.

### Cloudflare
- Proxy **activo** (`server: cloudflare` delante del origen GitHub Pages/Fastly,
  que responde `via: 1.1 varnish`, `x-served-by: cache-mia-*`). Inyecta
  `/.webmcp/bridge.js` (200, HIT, ~46.5 KB) en **todo** HTML servido por el
  edge: home, toolisto, tools, páginas noindex y hasta el cuerpo de los 301.
  First-party, versión HTTPS coherente con el esquema de la petición.

## 2. PROBLEMAS ENCONTRADOS (solo demostrables)

1. **`_headers` ignorado por GitHub Pages (confirmado en producción).** CSP,
   Referrer-Policy, Permissions-Policy e `immutable` del `dist/_headers` NO se
   sirven. Lo que se observa en producción: `strict-transport-security:
   max-age=15552000` (6 meses) y `x-content-type-options: nosniff` (defaults del
   origen en dominio personalizado); **ausentes**: CSP, Referrer-Policy,
   Permissions-Policy, X-Frame-Options; HSTS sin `includeSubDomains`/`preload`.
   Cache: HTML `max-age=600`, assets `max-age=14400` (GitHub Pages).
2. **CSP estricto del `_headers` rompería el sitio hoy (hallazgo nuevo).** Las
   páginas tienen **scripts inline ejecutables**: config del tool
   (`{"toolId":"imagesPdf",...}`) y un IIFE en `/toolisto`; además JSON-LD
   inline (bloqueado en algunos navegadores por CSP sin 'unsafe-inline'). El
   `script-src 'self'` de `_headers` (sin 'unsafe-inline') haría que las
   herramientas no se inicialicen. El hecho de que GitHub Pages ignore
   `_headers` ha evitado una rotura de producción desde el 2026-08-15.
3. **La frase «mis archivos se suben a un servidor» (n=19) / «no todo el
   procesamiento ocurre en tu navegador» (n=12)** siguen en herramientas del
   clúster de hojas de cálculo y PDF: no es un defecto de AdSense hoy (es
   UI_INSTRUCTION/PRIVACY_TRUST, boilerplate 13 bloques, ninguno «concerning»),
   pero es angular de la narrativa local-first que conviene vigilar.
4. **Bridge inyectado también en páginas `noindex` y cuerpos de 301**: coste
   pequeño e irrelevante, se documenta como observación, no como defecto.
5. **Assets con nombre estable, no hasheado** (`/apluno-assets/apluno.css`,
   `apluno.js`, `apluno-tools-data.js`, `/js/smart-search.js`): si se aplicara
   `Cache-Control: immutable` agresivo se servirían versiones viejas tras nuevo
   despliegue (los nombres no cambian por contenido).

## 3. CAMBIOS REALIZADOS

- **Ninguno sobre código, contenido, sitemap, robots, canonical ni Cloudflare.**
- Único archivo nuevo: este informe (docs, en `artifacts/`).
- Scripts temporales de diagnóstico en `_toolisto_autopilot/tmp/` (no
  commitados); evidencia regenada por los gates = determinista (no difiere).

## 4. CAMBIOS NO REALIZADOS

- **No se tocan las 178 URLs** ni se fuerza indexación: el código ya está
  correcto y desplegado; la prioridad es observar a Google.
- **No se implementa CSP/HSTS/vía Cloudflare**: requiere decisión y, para CSP,
  primero mover el config inline de las tools a datos/fuera de `<script>`
  (cambio de código) o habilitar en **report-only** y medir. Es una intervención
  con riesgo demostrado de romper las herramientas hoy.
- **No se lanza la segunda ronda de diferenciación**: sin datos GSC post-
  despliegue no hay evidencia de qué pares pagan en buscadores.
- **No se modifica Cloudflare (WebMCP)**: el bridge es first-party, HIT-cached
  y no afecta crawlability (los links son `<a>` estáticos) ni a los tests
  (que corren sobre `dist`).

## 5. ACCIONES MANUALES (Google Search Console)

Prioridad estricta (no solicitar las 178 una a una):

1. **Reenviar** `https://apluno.com/sitemap.xml` (237 URLs) en Sitemaps.
2. **Inspección por URL + «Solicitar indexación»** en estas claves:
   - `https://apluno.com/` (home con 12 categorías crawlables — objetivo del
     hueco «Descubierta — aún no rastreada»)
   - `https://apluno.com/toolisto`
   - `https://apluno.com/guia/` y `https://apluno.com/convertir-escaneado-imagen-en-texto-excel`
   - Las 12 categorías: `/pdf`, `/imagenes`, `/texto`, `/firmas`,
     `/qr-codigos`, `/calculadoras`, `/hojas-de-calculo`, `/documentos-word`,
     `/archivos`, `/audio`, `/video`, `/ebooks`
   - Ejemplos por cluster editado (ronda 1): `/jpg-a-pdf`, `/xls-a-xlsx`,
     `/ods-a-xlsx`, `/filtrar-csv`, `/comprimir-video`
3. **No** re-enviar en lote las 178: el sitemap + las inspecciones anteriores
   dan el camino de descubrimiento.

## 6. MONITORIZACIÓN (próximos 14 días)

En GSC Cobertura/Pages, anotar la fecha de la inspección y comparar:

- **«Descubierta — aún no rastreada» debe caer** (el home ahora entrega rutas
  crawlables). Antes: 169 rastreadas sin indexar / 178 sin indexar.
- **«Indexadas» debe subir** desde 54.
- Si una clave concreta se queda «rastreada sin indexar», re-inspeccionarla 1
  vez a los 7 días (no en bucle).
- Si aparece «Crawl anomaly» o una caída súbita en Rendimiento, revisar si el
  proxy Cloudflare cambió algo (bridge) — no se espera.
- Fuera de GSC: comprobar que el home siga sirviendo los 12 `<a href>` tras
  cualquier futuro despliegue (los gates SEO ya lo cubren en build).

## 7. QUEUE — Segunda ronda de diferenciación (condicionada a datos GSC)

> Regla: no ejecutar esta ronda hasta tener ≥2 semanas de datos post-inspección.
> Cada fila: URL · motivo de riesgo · evidencia (HEAD actual).

### P0 — urgente
- (vacío) Ninguna URL tiene urgencia demostrable hoy sin datos GSC.

### P1 — alta prioridad (pares con mayor similitud restante)
| URL (pareja) | Motivo | Evidencia | Acción recomendada |
|---|---|---|---|
| `/avif-a-imagen` ↔ `/heic-a-imagen` | Par full-page más similar del sitio | maxSimilarity 0.250 (audit-content-quality; antes 0.296) | Editorial específico de codec: AVIF (adopción, pérdida) vs HEIC (ecosistema Apple) |
| `/html-a-imagen` ↔ `/html-a-pdf` | Misma fuente, salida distinta; /html-a-imagen en 27 cortas | sim 0.236; words estrictas 68 / 62 | Dejar claro cuándo pasar a imagen vs PDF imprimible |
| `/formatear-json` ↔ `/validar-json` | Ambos <70 palabras estrictas, intención solapada | sim 0.224; 67 y 63w | «Embellecer/organizar» vs «comprobar errores» con ejemplos |
| `/codificar-url` ↔ `/decodificar-url` | Inversos casi especulares; decodificar la más corta del sitio | sim 0.219; 63w (min) | FAQ direccional (cuándo cada una) + ejemplo real |
| `/unir-excel` ↔ `/dividir-excel` | Inversos en clúster de hojas; contribuyen a frase n=19 | sim 0.219; frases compartidas local-first | Caso de uso combinado (misma hoja/otras hojas, por filas/columnas) |
| Cluster `/jpg-a-webp` `/png-a-webp` `/webp-a-jpg` `/webp-a-png` (/png-a-jpg, /word-a-jpg) | Menor originalidad del sitio | sharedness 45%..33%; únicas 55%..67% | Reescribir limitaciones/pasos por codec (alpha, pérdida, peso) |

### P2 — observar (el más corto/vigilar, sin tocar todavía)
- Las 23 tools con <70 palabras estrictas: `/decodificar-url` (63),
  `/comparar-csv`, `/csv-a-html` (64), `/calculadora-cientifica`,
  `/cambiar-codificacion-csv`, `/html-a-pdf`, `/limpiar-excel`, `/validar-json`
  (65), `/powerpoint-a-pdf` (66), `/aplanar-json`, `/aumentar-resolucion-imagen`,
  `/excel-a-xml`, `/limpiar-datos-tabulares`, `/normalizar-csv`,
  `/rellenar-formulario-pdf` (67), `/convertir-codificacion-texto`,
  `/escanear-documento-camara`, `/excel-a-html`, `/html-a-imagen`,
  `/tablas-html-a-excel` (68), `/cambiar-delimitador-csv`, `/estadisticas-csv`,
  `/texto-a-braille-unicode` (69). Evidencia: `strictEditorial.lt70=23`
  (audit-content-quality). Acción: **si** GSC marca thin o canibalización en
  estos slugs, enriquecer summary+FAQ con casos de uso reales.
- Frases compartidas de confianza («mis archivos se suben a un servidor»,
  n=19): solo intervenir si GSC/Penalización manual lo señala (son
  UI/PRIVACY_TRUST genuinos, no keyword-stuffing).

### P3 — no tocar
- 52 aliases noindex (redirects estáticos) — correctos y enlazados.
- 202 páginas de procesamiento sin AdSense loader — requisito de política,
  no defecto.
- Keywords: **202/202 con ≥4 keywords** — punto «1 sola keyword» resuelto.
- Boilerplate: 13 bloques >6 reúsos, ninguno «concerning».

## 8. VERIFICACIÓN (tests en HEAD cfc9a9e, 2026-09-09)

| Chequeo | Resultado |
|---|---|
| `npm run build` | OK (214+APLUNO; AdSense 15, procesamiento 202 sin loader) |
| `npm test` (audit-count) | PASS (202 tools) |
| `node scripts/audit-content-quality.mjs` | **FINAL: PASS (pass=15, warn=0, fail=0)** |
| `node scripts/audit-content-similarity.mjs` | **PASS (pass=5, warn=1 no bloqueante)** |
| `npm run test:apluno` | **44/44** |
| `npm run test:release` | **24 PASS / 0 FAIL** (SEO 29 · AdSense 25 · monetization 25 · strict-editorial 3 · content-similarity 5 · DoD 11 · network-negative 413/413) |
| Producción (HTTPS) | 7/7 rutas 200/301 correctos; sitemap+robots byte-idénticos |
| Headers producción | br/H2/H3 OK; HSTS+nosniff (origin); CSP/Referrer/Permissions ausentes (ver §2) |

Sin regresiones: objetivos mínimos cumplidos (44/44, 24/0, 413/413).

## 9. RECOMENDACIÓN

**WAIT FOR GSC DATA.**

- No hay problema demostrable que exija tocar código ahora; los gates y la
  producción están verdes.
- La siguiente intervención de código (segunda ronda, §7-P1) solo debe
  ejecutarse con datos reales de Google (impresiones/clicks/canibalización)
  que hoy **no existen en el repositorio**.
- La única acción con efecto real esta semana es **manual y tuya en GSC** (§5),
  seguida de **14 días de monitorización** (§6).
- Cloudflare: no tocar aún. Cuando se decida endurecer cabeceras, primero mover
  el config inline de las tools fuera de `<script>` (o CSP report-only) y luego
  aplicar vía Transform Rule (CSP incluida); nunca activar `immutable` con
  nombres de asset estables (§2-5).