# Auditoría de entrega — Toolisto y Toolisto Workspace

Fecha: 29 de julio de 2026  
Alcance: portada pública, páginas individuales de herramientas, catálogo generado, acceso de Workspace, módulos de captura, documentos, datos, Query, dashboards, Flow e informes.

## Decisiones de producto aplicadas

- La portada pública queda centrada en una tarea: describir lo que se necesita, elegir la herramienta y descargar el resultado.
- El catálogo se organiza en 12 secciones plegables. Las tarjetas mantienen una altura y una densidad visual coherentes; las descripciones largas se recortan a dos líneas.
- La portada conserva un único botón de Workspace. El botón informa que está en implementación, abre una explicación y no proporciona acceso público.
- Workspace se sirve con `noindex,nofollow`, muestra una pantalla de acceso cerrado y solo permite una vista interna local con `?preview=internal`. En un futuro alojamiento público, la confidencialidad real deberá reforzarse con autenticación en servidor.

## Hallazgos corregidos

### Toolisto público

- Se eliminó la navegación pública duplicada hacia Workspace.
- Se reemplazó la portada saturada por una composición de tarea, pasos, acciones rápidas, intenciones y categorías plegables.
- Se uniformaron las tarjetas de herramientas y se redujo la altura inicial de la portada.
- Se rediseñó la plantilla de herramienta individual para mostrar recorrido, entrada de archivos, estado, acción principal, formatos y resultado en un orden claro.
- Se retiraron librerías pesadas que no se utilizan en la portada ni en las páginas de categoría; las dependencias de Word y hojas de cálculo se cargan bajo demanda.
- Se corrigió la carga de `app.js` y `tool-processors.js` tanto desde el paquete raíz como desde `dist`.

### Workspace

- Query quedó organizado como un estudio de preparación de datos con hojas, fuentes, herramientas, vista previa y pasos minimizables.
- Datos incluye fórmula, historial, portapapeles, hojas, análisis, Query, gráficos, informes y exportación.
- Documentos dispone de una barra tipo Word, bloques editables, formato enriquecido, inserción de imágenes, exportación HTML/Markdown y estadísticas.
- Las confirmaciones destructivas usan un modal consistente en lugar de `confirm()` nativo.
- El acceso visual, la densidad, el tema, la paleta, el historial de navegación, el autoguardado y la recuperación de sesión quedan integrados.
- La captura conserva el original, el resultado corregido y sus relaciones; el OCR registra estado, texto y confianza en la página escaneada.
- Los números de tablas, fórmulas, Query, informes y gráficos aceptan decimales con coma, miles y valores negativos.
- Los gráficos derivados se vuelven a generar cuando se guarda la tabla de origen.
- Los informes permiten seleccionar imágenes locales. PNG, WebP y GIF se convierten en JPEG en el navegador para incrustarse en el PDF; el PDF conserva texto, tablas, gráficos, acentos, metadatos y saltos de página.

## Evidencia de validación

- Catálogo: 144 herramientas, 12 categorías, 100 procesadores y 37 handlers auditados.
- Workspace estructural: 156/156.
- Regresión profunda: 24/24.
- Fase funcional de Workspace: 59/59.
- Batch 4: 329/329.
- Batch 5: 154/154.
- Workflow E2E: 15/15.
- Stability E2E: 9/9.
- Instruction E2E: 17/17.
- Validación de producción: navegación, captura, editor, datos, modelo, Query, dashboards, Flow, herramientas, tema, paleta, 404 y cinco tamaños responsive; 0 errores de consola.
- No se detectó overflow horizontal en 390, 768, 1024, 1366 ni 1920 píxeles.
- La conversión real CSV → Excel y la comparación de Excel idéntica fueron verificadas.

## Limitaciones deliberadas

1. El bloqueo de Workspace es de interfaz y de ejecución en el paquete estático. La autenticación y autorización reales requieren una capa de servidor.
2. OCR continúa dependiendo de resolución, nitidez, contraste y ruido del archivo de entrada; se conserva una vía manual cuando la confianza es baja o el motor no está disponible.
3. Un PDF con una imagen externa o demasiado grande puede dejar la imagen como marcador si el navegador no puede decodificarla con seguridad.
4. `pnpm run build` puede detenerse en la instalación por `tesseract.js` cuando pnpm bloquea scripts de dependencias (`ERR_PNPM_IGNORED_BUILDS`). La generación directa de `dist` y las pruebas de la aplicación sí quedan validadas.

El documento `AUDIT.md` conserva el diagnóstico histórico de una fase anterior; este informe refleja el estado verificado en esta entrega.
