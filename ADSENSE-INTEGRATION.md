# Google AdSense — Integración privacy-safe en APLUNO

Implementación verificada de Google AdSense para `https://apluno.com`.

- **Publisher:** `ca-pub-2644615452393440`
- **Loader (exactamente el proporcionado por Google):**
  ```html
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2644615452393440"
      crossorigin="anonymous"></script>
  ```
- **Integración centralizada:** `scripts/inject-adsense.mjs`, invocado desde
  `scripts/build-public-site.mjs` DESPUÉS de `generate-seo-pages.mjs` y
  `generate-apluno-pages.mjs`.
- **Test automatizado:** `tests/adsense-integration.mjs` (también en
  `tests/run-all.mjs`).

## Páginas donde se activa el loader (fase 1)

- `/` (portada launcher de APLUNO) → `dist/index.html`
- `/toolisto` (catálogo) → `dist/toolisto.html`
- Páginas de categorías (12) → `dist/<category-slug>.html`
- `/about/` (institucional con contenido) → `dist/about/index.html`

En cada una, el loader aparece **exactamente una vez**, dentro de `<head>`.

## Páginas donde NO se activa (privacidad de archivos)

- Las **167 páginas de procesamiento** de herramientas (`dist/<tool-slug>.html`,
  p. ej. `/unir-pdf`, `/comprimir-pdf`, `/convertir-imagen`).
- Páginas de redirect (aliases), `404.html`, `/privacy/`, `/privacidad`,
  `/terms/`, `/condiciones`, `/contact/`, `/ordia/`, `/workspace/`, `/apoyar`.

El inyector **falla el build** si el loader aparece en una página de
procesamiento o si falta una página permitida esperada. Es idempotente: volver a
ejecutarlo no duplica el loader.

## ads.txt

`dist/ads.txt` (raíz pública) con:

```
google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0
```

## Privacidad

`/privacy/` (y la legacy `/privacidad`) actualizadas para:

- Mencionar Google AdSense en páginas públicas de navegación y catálogo.
- Aclarar que Google puede usar cookies/identificadores para publicación y
  medición de anuncios según las opciones de consentimiento aplicables.
- Aclarar que el código publicitario **no se incluye** en las páginas donde
  Toolisto procesa archivos y que Apluno **no envía a Google el contenido** de
  los archivos seleccionados para procesar.
- No afirmar Google Analytics como activo (no lo está).
- Fecha de última actualización: 17 de agosto de 2026.

## CSP / `_headers`

Verificado en producción (response headers reales de `apluno.com`):

- GitHub Pages **no aplica** `_headers`.
- Cloudflare (proxy en producción) **no inyecta** una `Content-Security-Policy`.

Por tanto la CSP restrictiva de `_headers` **no está en efecto** y el loader de
AdSense carga sin problema. **No se debilitó la seguridad a ciegas:** `_headers`
se deja intacto. Si en el futuro un host aplica la CSP de `_headers`, habría que
migrar a una CSP basada en nonce / `strict-dynamic` según la guía actual de
Google; eso queda como **paso manual documentado**, no como cambio automático.

## CMP / Consentimiento

Google exige una **CMP certificada** para EEE, Reino Unido y Suiza en ciertos
usos publicitarios. La activación final del consentimiento se realiza desde el
panel de Google AdSense → **Privacy & messaging** (o equivalentes) con una CMP
certificada por Google. **No se implementó un banner casero.**

Ver **MANUAL ACTIONS REMAINING** más abajo.

## Rendimiento y resiliencia

- El loader es `async` y `crossorigin="anonymous"`: no bloquea LCP, primer
  render, el buscador ni las interacciones.
- No hay dependencias inline del script de AdSense: si Google no responde, si
  un ad blocker lo bloquea o si no hay conexión hacia Google, **APLUNO sigue
  funcionando** (herramientas prioritarias; publicidad secundaria).
- No se inventaron `data-ad-slot` ni IDs de bloque: el código queda preparado
  para que el propietario active **Auto Ads** desde el panel de Google AdSense
  sin modificar este código (el loader global es suficiente).

## Validación

```
npm run build               # build completo (incluye inject-adsense.mjs)
npm test                    # audit-count: 167 herramientas
npm run test:apluno         # contrato APLUNO: 45/45
npm run test:release        # public release gate: 13/13
node tests/adsense-integration.mjs   # 21/21
node tests/public-site-network-negative.mjs  # 343/343 — cero egress en herramientas
```

## MANUAL ACTIONS REMAINING (requieren la cuenta de Google AdSense)

1. **Confirmar/activar el sitio** `apluno.com` en AdSense (asociado al
   publisher `ca-pub-2644615452393440`) y verificar que `ads.txt` se reconoce
   (estado "Listo" en AdSense → Sites).
2. **CMP certificada** para EEE/Reino Unido/Suiza: configurar el consentimiento
   desde AdSense → Privacy & messaging (o una CMP certificada por Google). No
   saltarse este requisito.
3. **Activar Auto Ads** desde el panel de Google AdSense (Auto ads → Activar).
   No requiere cambiar este código: el loader global ya está en las páginas
   permitidas. Opcionalmente, crear bloques de anuncios manuales y, solo entonces,
   añadir sus `data-ad-slot` con IDs reales (no inventar IDs).
4. (Condicional) Si en el futuro se sirve `_headers` desde un host que aplica la
   CSP, migrar la política a nonce/`strict-dynamic` para AdSense según la
   documentación oficial actual de Google.
