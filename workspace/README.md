# Toolisto Workspace

## Modelo gratuito

Esta superficie está pensada para ser gratuita desde el primer uso: no requiere cuenta, tarjeta, claves API, anuncios ni un servicio de pago. El contenido se procesa y se guarda localmente en el navegador mediante IndexedDB. La exportación `.toolisto`, Markdown y CSV permite sacar una copia cuando quieras.

La experiencia visual usa una estructura limpia tipo Notion: barra lateral, proyectos, plantillas, acciones rápidas, estados de guardado y modo claro/oscuro. La captura admite archivo/cámara, pantalla y portapapeles cuando el navegador concede esos permisos.

Toolisto Workspace es una superficie local-first para organizar proyectos, capturas, documentos, datos y herramientas. La interfaz se sirve desde `dist/workspace` y no necesita una API del producto para crear o editar proyectos básicos.

## Arquitectura

- `index.html`: shell accesible, navegación global y navegación contextual del proyecto.
- `workspace.js`: estado de interfaz y renderizado vanilla. Los iconos pasan por un registro SVG controlado y se montan como nodos DOM.
- `core/db.js`: IndexedDB para proyectos y contenido.
- `core/storage.js`: creación, guardado, exportación e importación del formato `.toolisto`.
- `tools-data.js`: catálogo completo de 144 herramientas y sus 12 categorías.
- `workspace.css`: tokens visuales, modo oscuro, densidades y breakpoints responsive.

## Estado funcional

La creación de proyectos, el guardado local, la importación/exportación y la navegación del catálogo son funcionales. Captura, documentos y datos funcionan con el alcance disponible en el navegador. Query ejecuta transformaciones locales en múltiples hojas, permite revisar, deshacer, crear hojas con distintas fuentes, renombrarlas y exportar los pasos. Flow ofrece un lienzo editable con nodos, limpieza y prueba local. Dashboards permite construir paneles locales con KPI, gráficos, tablas, filtros, visuales configurables y guardado dentro del proyecto.

## Datos y privacidad

Los proyectos se guardan en IndexedDB del navegador actual. El repositorio no añade claves, telemetría, subidas ni contenido remoto para esta superficie. El procesamiento concreto puede variar según el navegador y la herramienta, por lo que la interfaz evita prometer privacidad absoluta.

## Validación local

```powershell
node scripts/generate-seo-pages.mjs --production
node scripts/audit-count.mjs
node tests/workspace/workspace-test.mjs
node tests/workspace/production-validation.mjs
node server.js
```

La última prueba necesita que el servidor local esté disponible en `http://localhost:8080`.
