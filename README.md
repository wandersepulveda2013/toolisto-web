# Toolisto · versión directa

Rediseño de Toolisto enfocado en utilidad inmediata. La portada deja de parecer una presentación promocional y funciona como una aplicación web desde el primer vistazo.

## Cambios principales

- Selector real de archivos como elemento principal de la portada.
- Detección automática del formato y recomendación de una herramienta compatible.
- Herramientas visibles inmediatamente debajo del selector.
- Tarjetas compactas, completas y pulsables.
- Filtros por Imágenes, PDF y Firmas.
- Buscador de herramientas.
- Diseño claro, cálido y reconocible, con tema oscuro opcional.
- Eliminación de demostraciones ficticias, insignias repetidas y bloques de marketing innecesarios.
- Interfaz responsive optimizada para móvil y escritorio.
- Procesamiento local en el navegador.

## Herramientas incluidas

1. Comprimir imagen con objetivo de KB.
2. Cambiar tamaño y recortar imágenes.
3. Convertir entre JPG, PNG y WebP.
4. Limpiar una firma y exportarla como PNG transparente.
5. Unir archivos PDF.
6. Convertir imágenes en PDF.

## Archivos importantes

- `index.html`: estructura de la página.
- `styles.css`: identidad visual y responsive.
- `app.js`: procesamiento, detección, filtros y descargas.
- `_headers`: encabezados de seguridad para Cloudflare Pages.
- `404.html`: página de error.
- `PREVIEW-DESKTOP.png`: vista previa de escritorio.
- `PREVIEW-MOBILE.png`: vista previa móvil.

## Publicar en Cloudflare Pages

1. Descomprime el ZIP.
2. En Cloudflare abre **Workers & Pages**.
3. Crea un proyecto mediante carga directa.
4. Sube el contenido con `index.html` en la raíz.
5. Publica y prueba las seis herramientas.

## Pruebas realizadas

- Validación sintáctica de `app.js`.
- Carga completa sin errores JavaScript.
- Filtros por categoría.
- Buscador de herramientas.
- Vista de escritorio.
- Vista móvil.
- Carga de una imagen real.
- Compresión y generación de descarga.

## Dependencias

`pdf-lib` y `JSZip` se cargan desde jsDelivr para las funciones de PDF y descargas múltiples. Los archivos seleccionados permanecen en el navegador y no se envían a Toolisto.
