# Despliegue estático de APLUNO

El build genera `dist/`, el único que se debe publicar en la raíz de `https://apluno.com`. No publiques la raíz del repositorio ni `node_modules`.

`src/data/site.config.json` fija `productionDomain`. Debe ser una URL final real, nunca un marcador `.invalid`, y coincidir con el host publicado sin subdirectorio.

## Validación previa

```powershell
npm ci
npm run build
npm run test:apluno
npm test
node tests/run-all.mjs
```

Una prueba local puede ejecutarse con `node server.js`. El servidor incluido sirve primero `dist/`.

## Contrato de rutas

- `/` sirve `dist/index.html`.
- `/toolisto` debe reescribirse con respuesta `200` a `dist/toolisto.html`.
- Las 167 herramientas se conservan como rutas planas `/{slug}.html`.
- `/ordia/`, `/workspace/`, `/about/`, `/contact/`, `/privacy/` y `/terms/` se sirven desde sus directorios generados.
- `dist/workspace/preview.html` es una vista interna y debe conservar `noindex`.

El build produce `_redirects`, `sitemap.xml`, `robots.txt`, canónicos y metadatos para `https://apluno.com`. El archivo `_headers` aplica las cabeceras de seguridad y caché; si el proveedor no las reconoce, configura equivalentes.

## Publicación

1. Publica el contenido recién validado de `dist/` en el hosting estático conectado a `apluno.com`.
2. Configura la reescritura de `/toolisto` indicada arriba y el dominio personalizado.
3. Espera el certificado TLS y valida en vivo la portada, `/toolisto`, una herramienta con descarga y las rutas institucionales.
4. Comprueba que canónicos, sitemap y Open Graph continúan apuntando exclusivamente a `https://apluno.com`.

Este repositorio no configura por sí solo DNS, TLS ni credenciales del proveedor. No debe afirmarse que la web está publicada hasta completar esas comprobaciones en el dominio real.

## Reversión

Para volver atrás, vuelve a publicar el último `dist/` validado de un commit conocido. No mezcles archivos generados por commits diferentes.
