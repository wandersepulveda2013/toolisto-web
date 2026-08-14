# APLUNO

APLUNO es la marca madre de una familia de productos digitales en español. Este repositorio genera un único sitio estático para `https://apluno.com`.

## Rutas públicas

- `/` — portada institucional de APLUNO.
- `/toolisto` — catálogo de Toolisto con 167 herramientas.
- `/{slug}.html` — páginas funcionales de las herramientas de Toolisto.
- `/ordia/` — presentación de Ordía.
- `/workspace/` — presentación pública de Workspace.
- `/about/`, `/contact/`, `/privacy/` y `/terms/` — páginas institucionales y legales.

La aplicación interna de Workspace se genera aparte como `dist/workspace/preview.html`; no sustituye la landing pública.

## Estructura principal

- `index.html` — se genera como portada APLUNO.
- `toolisto.html` — fuente de la portada del catálogo Toolisto.
- `src/apluno/` — estilos, comportamiento, manifest e imágenes de APLUNO.
- `src/data/apluno.products.json` — contenido estructurado de productos.
- `scripts/generate-seo-pages.mjs` — genera Toolisto y sus páginas SEO.
- `scripts/generate-apluno-pages.mjs` — genera las rutas institucionales.
- `scripts/build-public-site.mjs` — orquesta el build público completo en `dist/`.
- `tests/apluno-site.mjs` — contrato de rutas, contenido, dominio y accesibilidad básica.
- `DEPLOYMENT.md` — guía de publicación estática y validación del dominio.

## Desarrollo y validación

```powershell
npm ci
npm run build
npm run test:apluno
npm test
node tests/run-all.mjs
```

Para comprobar `dist/` localmente:

```powershell
node server.js
```

Abre `http://localhost:8080`. Si el puerto está ocupado, define otro con `$env:PORT`.

## Compromisos

- Dominio único: `apluno.com`; este proyecto no depende de `toolisto.com`.
- Toolisto mantiene procesamiento local en el navegador para los archivos del usuario.
- Sin registro, anuncios ni rastreo de terceros.
- Interfaz responsive, accesible y en español.
