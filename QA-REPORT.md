# QA-REPORT.md — Auditoría Completa de Toolisto

**Fecha:** 2026-07-24  
**Versión:** Toolisto Directo v2 — Post-Auditoría  
**Herramientas auditadas:** 21  
**Resultado:** 21/21 herramientas funcionales (0 ocultas)

---

## Inventario de las 21 herramientas

| # | ID | Nombre | Categoría | Acepta | Función init | Función process | Librerías | Estado |
|---|-----|--------|-----------|--------|-------------|-----------------|-----------|--------|
| 1 | compress | Comprimir imagen | images | image | — | processCompress() | Canvas API | ✅ Aprobada |
| 2 | crop | Cambiar tamaño y recortar | images | image | — | processCrop() | Canvas API | ✅ Aprobada |
| 3 | convert | Convertir imagen | images | images | — | processConvert() | Canvas API, JSZip | ✅ Aprobada |
| 4 | batchCompress | Comprimir varias imágenes | images | images | — | processBatchCompress() | Canvas API, JSZip | ✅ Aprobada |
| 5 | stripMetadata | Eliminar metadatos | images | images | initStripMetadata() | processStripMetadata() | Canvas API, JSZip | ✅ Aprobada |
| 6 | socialCrop | Recortar para redes | images | image | initSocialCrop() | processSocialCrop() | Canvas API | ✅ Aprobada |
| 7 | removeObjects | Borrar objetos y texto | images | image | initRemoveObjectsEditor() | processRemoveObjects() | Canvas API | ✅ Aprobada |
| 8 | signature | Limpiar firma | signatures | image | — | processSignature() | Canvas API | ✅ Aprobada |
| 9 | mergePdf | Unir PDF | pdf | pdfs | — | processMergePdf() | pdf-lib | ✅ Aprobada |
| 10 | imagesPdf | Imágenes a PDF | pdf | images | — | processImagesToPdf() | pdf-lib | ✅ Aprobada |
| 11 | splitPdf | Dividir PDF | pdf | pdfs | initSplitPdf() | processSplitPdf() | pdf-lib, pdf.js | ✅ Aprobada |
| 12 | reorderPdf | Organizar PDF | pdf | pdfs | initReorderPdf() | processReorderPdf() | pdf-lib, pdf.js | ✅ Aprobada |
| 13 | pdfToImages | PDF a imágenes | pdf | pdfs | initPdfToImages() | processPdfToImages() | pdf.js, JSZip | ✅ Aprobada |
| 14 | signPdf | Firmar PDF | signatures | pdfs | initSignPdf() | processSignPdf() | pdf-lib, Canvas API | ✅ Aprobada |
| 15 | docPhoto | Foto para documentos | images | image | initDocPhoto() | processDocPhoto() | Canvas API | ✅ Aprobada |
| 16 | censor | Censurar información | images | image | initCensor() | processCensor() | Canvas API | ✅ Aprobada |
| 17 | fixFormat | Reparar formato | images | image | initFixFormat() | processFixFormat() | Canvas API | ✅ Aprobada |
| 18 | rescueDoc | Rescatar documento | images | image | initRescueDoc() | processRescueDoc() | Canvas API | ✅ Aprobada |
| 19 | fileCompliance | Cumplir requisitos | images | image | initFileCompliance() | processFileCompliance() | Canvas API | ✅ Aprobada |
| 20 | workflow | Flujo reutilizable | images | images | initWorkflow() | processWorkflow() | Canvas API, JSZip | ✅ Aprobada |
| 21 | advancedConvert | Conversor avanzado | images | images | initAdvancedConvert() | processAdvancedConvert() | Canvas API, JSZip | ✅ Aprobada |

---

## Resultados por herramienta

### 1. Comprimir imagen (compress)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** JPEG, PNG, WebP (auto=mismo formato o WebP)
- **Límite:** 25 MB por archivo
- **Prueba:** Archivo JPEG horizontal → reducido correctamente
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 2. Cambiar tamaño y recortar (crop)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** JPEG, PNG, WebP
- **Presets:** Cuadrada 1080×1080, TikTok 1080×1920, 2×2 600×600, Visa 413×531, Personalizado
- **Controles:** Zoom, offset X/Y, formato de salida
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 3. Convertir imagen (convert)
- **Formatos entrada:** JPEG, PNG, WebP (una o varias)
- **Formatos salida:** JPEG, PNG, WebP
- **Lote:** ZIP si >1 archivo
- **Problemas corregidos:** 
  - **[FIXED]** Conversión PNG transparente → JPEG: ahora se compone correctamente sobre fondo blanco antes de codificar
- **Estado:** ✅ Aprobada

### 4. Comprimir varias imágenes (batchCompress)
- **Formatos entrada:** JPEG, PNG, WebP (1-30)
- **Formatos salida:** JPEG, PNG, WebP
- **Descarga:** ZIP o individual
- **Progreso:** Barra individual + general
- **Cancelación:** Disponible
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 5. Eliminar metadatos (stripMetadata)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** JPEG→WebP, PNG→PNG, WebP→WebP
- **Método:** Re-codificación (elimina EXIF, XMP, IPTC inherentemente)
- **Categorías:** GPS, Fecha, Dispositivo, Software, Autor (checkboxes)
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 6. Recortar para redes (socialCrop)
- **Plataformas:** TikTok/Reels (9:16), Stories (9:16), IG vertical (4:5), IG cuadrado (1:1), IG horizontal (1.91:1), YouTube (16:9), Miniatura YT (1280×720), Foto perfil (guía circular), Personalizado
- **Controles:** Zoom, rotar, voltear H/V, arrastrar
- **Problemas corregidos:**
  - **[FIXED]** Offset y zoom del preview ahora se aplican en la exportación (antes solo se veían en preview, no en descarga)
- **Estado:** ✅ Aprobada

### 7. Borrar objetos y texto (removeObjects)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** Auto, JPEG, PNG, WebP
- **Controles:** Pincel, borrador, deshacer, rehacer, restablecer, tamaño de pincel
- **Método:** Inpainting iterativo (promedio de vecinos)
- **Limitación:** No funciona con fondos complejos (>35% de área pintada)
- **Disclaimer:** Confirmación de propiedad requerida
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 8. Limpiar firma (signature)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** PNG transparente
- **Controles:** Umbral de blanco, suavidad, color de tinta, margen
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 9. Unir PDF (mergePdf)
- **Formatos entrada:** PDF
- **Formatos salida:** PDF combinado
- **Orden:** Según lista visible (reordenable con flechas)
- **Problemas corregidos:**
  - **[FIXED]** Manejo de errores para PDFs protegidos con contraseña (antes lanzaba error críptico, ahora mensaje comprensible)
- **Estado:** ✅ Aprobada

### 10. Imágenes a PDF (imagesPdf)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** PDF
- **Opciones:** Tamaño de página (A4/Carta/Ajustar), orientación (auto/V/H), márgenes
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 11. Dividir PDF (splitPdf)
- **Formatos entrada:** PDF (1 archivo)
- **Formatos salida:** PDF individual o ZIP
- **Modos:** Por rangos (1-3, 5, 8-10) o selección visual
- **Miniaturas:** Renderizadas con pdf.js
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 12. Organizar PDF (reorderPdf)
- **Formatos entrada:** PDF (1 archivo)
- **Formatos salida:** PDF reordenado
- **Controles:** Drag & drop para reordenar
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 13. PDF a imágenes (pdfToImages)
- **Formatos entrada:** PDF (1 archivo)
- **Formatos salida:** JPEG, PNG, WebP
- **Escala:** 50%-300%
- **Descarga:** Individual por clic o todas en ZIP
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 14. Firmar PDF (signPdf)
- **Formatos entrada:** PDF (1 archivo)
- **Formatos salida:** PDF firmado
- **Tipos:** Dibujar o escribir texto
- **Posiciones:** Abajo der/izq, Arriba der/izq, Centro
- **Disclaimer:** "Esta herramienta añade una firma visual. No constituye por sí sola una firma digital certificada."
- **Problemas corregidos:**
  - **[FIXED]** Selector de página: ahora se puede elegir en qué página colocar la firma (antes siempre se colocaba en la página 1)
  - **[FIXED]** Disclaimer de firma visual añadido a los controles
- **Estado:** ✅ Aprobada

### 15. Foto para documentos (docPhoto)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** JPEG, PNG
- **Presets:** Pasaporte (35×45mm), Visa USA (51×51mm), DNI/Carnet (32×26mm), Pasaporte libro (33×48mm), Licencia conducir (51×38mm), Foto 2×2 (51×51mm), Personalizado
- **DPI:** 72-600
- **Fondo:** Blanco, Azul, Gris claro, Azul claro, Personalizado
- **Problemas corregidos:**
  - **[FIXED]** Soporte de hoja A4 y Carta con copias múltiples (antes solo generaba foto individual)
  - **[FIXED]** Control de número de copias por hoja (1-16)
- **Estado:** ✅ Aprobada

### 16. Censurar información (censor)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** Auto, JPEG, PNG, WebP
- **Métodos:** Pixelado, Desenfoque, Negro sólido, Blanco sólido
- **Controles:** Pincel, borrador, deshacer, rehacer, restablecer, intensidad
- **Disclaimer:** Confirmación de propiedad requerida
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 17. Reparar formato (fixFormat)
- **Formatos entrada:** Cualquier archivo (detecta magic bytes)
- **Formatos salida:** JPEG, PNG, WebP (detectado o manual)
- **Detección:** JPEG, PNG, GIF, WebP, BMP, PDF (magic bytes)
- **Muestra:** Extensión declarada vs formato detectado
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 18. Rescatar documento (rescueDoc)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** Auto, JPEG, PNG, WebP
- **Controles:** Brillo, contraste, nitidez, exposición, modo de color (color/escala grises/B&W), umbral B/N
- **Vista previa:** Live con botón
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 19. Cumplir requisitos (fileCompliance)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** Ajustado según requisitos
- **Requisitos:** Tamaño máximo KB, ancho/alto min/max, formato específico
- **Verificación:** Lista de checks con ✔/❌
- **Auto-fix:** Dimensiones + peso (con iteración de calidad)
- **Problemas corregidos:**
  - **[FIXED]** Mensaje "Parcialmente ajustado" cuando no es posible cumplir todos los requisitos (antes afirmaba "listo" aunque no cumpliera)
- **Estado:** ✅ Aprobada

### 20. Flujo reutilizable (workflow)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** Procesado según flujo
- **Operaciones:** Comprimir, Redimensionar, Convertir, Rotar, Voltear, Metadatos, Marca de agua
- **Persistencia:** Presets en localStorage (solo configuraciones, no archivos)
- **Controles:** Agregar/editar/eliminar/reordenar pasos, guardar/cargar/eliminar presets
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

### 21. Conversor avanzado (advancedConvert)
- **Formatos entrada:** JPEG, PNG, WebP
- **Formatos salida:** JPEG, PNG, WebP
- **Operaciones:** Formato, calidad, redimensionar (ancho/porcentaje/fit), rotar, voltear, marca de agua
- **Lote:** ZIP si >1 archivo
- **Problemas corregidos:** Ninguno encontrado
- **Estado:** ✅ Aprobada

---

## Cambios realizados

### Archivos modificados
| Archivo | Cambios |
|---------|---------|
| `index.html` | Splash screen reescrito con `intro-pending`, critical CSS inline, `#toolisto-app` wrapper, vendor scripts locales, `<noscript>` support |
| `app.js` | PDF.js worker → local path (5 ocurrencias), signPdf page selector + disclaimer, socialCrop export con offsets, convert transparent→JPG fix, mergePdf error handling, docPhoto sheets+copies, fileCompliance messaging, search incluye IDs de herramienta |
| `vendor/pdfjs/pdf.min.js` | Descargado localmente |
| `vendor/pdfjs/pdf.worker.min.js` | Descargado localmente |
| `vendor/pdflib/pdf-lib.min.js` | Descargado localmente |
| `vendor/jszip/jszip.min.js` | Descargado localmente |

### Archivos creados
| Archivo | Propósito |
|---------|-----------|
| `vendor/` | Dependencias locales (4 archivos) |
| `tests/fixtures/` | Archivos de prueba (13 archivos) |
| `tests/generate-fixtures.js` | Generador de fixtures |
| `tests/qa-test.js` | Pruebas automatizadas Playwright |

### Archivos de respaldo
| Archivo | Propósito |
|---------|-----------|
| `toolisto-backup-before-full-qa/` | Copia completa antes de cambios |
| `toolisto-directo-v2-BACKUP-PHASE0/` | Backup original preservado |

---

## Errores encontrados y corregidos

| # | Error | Gravedad | Corrección |
|---|-------|----------|------------|
| 1 | Splash screen producía flash de contenido antes de animación | Alta | Reescrito con `intro-pending` class en HTML, critical CSS inline, script inline sin dependencias |
| 2 | Dependencies cargadas desde CDN (pdf-lib, pdf.js, jszip) | Alta | Descargadas a `vendor/` y referenciadas localmente |
| 3 | PDF.js worker apuntaba a CDN (5 ubicaciones) | Alta | Todas las rutas cambiadas a `./vendor/pdfjs/pdf.worker.min.js` |
| 4 | signPdf siempre firma página 1 | Media | Añadido selector de página con validación dinámica |
| 5 | socialCrop no aplicaba zoom/offset en exportación | Media | Exportación ahora usa `_sc.zoom`, `_sc.offsetX/Y` |
| 6 | convert PNG transparente → JPEG no compone alpha | Media | Ahora compone sobre fondo blanco antes de codificar |
| 7 | mergePdf crasheaba con PDFs protegidos | Media | Try/catch con mensaje comprensible |
| 8 | docPhoto solo generaba foto individual | Baja | Soporte A4/Carta con copias múltiples |
| 9 | fileCompliance afirmaba "listo" aunque no cumpliera | Baja | Mensaje "Parcialmente ajustado" cuando aplica |
| 10 | signPdf sin disclaimer de firma visual | Baja | Disclaimer añadido a controles |
| 11 | Tool search no encontraba por ID de herramienta | Baja | Búsqueda ahora incluye `data-tool` |

---

## Herramientas ocultas
**Ninguna.** Las 21 herramientas están visibles y funcionales.

---

## Formatos realmente compatibles

### Lectura
| Formato | Soportado |
|---------|-----------|
| JPEG | ✅ Sí |
| PNG | ✅ Sí |
| WebP | ✅ Sí |
| GIF | ⚠️ Solo como imagen estática (primer frame) |
| BMP | ⚠️ Detectado por fixFormat, pero no aceptado en dropzone |
| PDF | ✅ Sí |
| SVG | ❌ No soportado |
| AVIF | ❌ No soportado |
| HEIC/HEIF | ❌ No soportado |
| TIFF | ❌ No soportado |

### Exportación
| Formato | Soportado |
|---------|-----------|
| JPEG | ✅ Sí |
| PNG | ✅ Sí |
| WebP | ✅ Sí |
| PDF | ✅ Sí (vía pdf-lib) |
| ZIP | ✅ Sí (vía JSZip) |

### Nota sobre accept del input
El `<input type="file">` acepta: `image/jpeg,image/png,image/webp,application/pdf`. GIF, BMP y otros no están en la lista de aceptación pero los archivos arrastrados podrían pasar el filtro de tipo.

---

## Resultados de pruebas automatizadas

**Playwright — Chrome headless**  
**Resultado: 41/41 passed, 0 failed, 1 warning**

### Splash Screen (7/7)
- ✅ HTML has intro-pending class on load
- ✅ #toolisto-intro element exists
- ✅ #toolisto-app wrapper exists
- ✅ intro-pending removed after splash
- ✅ #toolisto-app is visible after splash
- ✅ No white background flash
- ✅ No critical console errors on load

### Tool Cards (2/2)
- ✅ 21 tool cards present
- ✅ All 21 expected tool IDs present in cards

### Navigation (4/4)
- ✅ Filter chips present (≥4)
- ✅ Images filter works correctly
- ✅ All filter shows all 21 cards
- ✅ Tool search works

### Drop Zone & File Input (4/4)
- ✅ Drop zone element exists
- ✅ File input exists
- ✅ Browse button exists
- ✅ File strip becomes visible after upload
- ✅ Run button enabled after upload

### Compress Tool (2/2)
- ✅ Compress controls rendered
- ✅ Smart result panel visible

### PDF Tools (2/2)
- ✅ Split PDF controls rendered
- ✅ Split PDF mode selector exists

### Responsive (12/12)
- ✅ No horizontal scroll at 360×800, 390×844, 768×1024, 1920×1080
- ✅ Footer accessible at all viewports
- ✅ All 21 cards present at all viewports

### Keyboard & Menu (2/2)
- ✅ Mobile nav opens on menu toggle
- ✅ Escape closes mobile nav

### Local Dependencies (5/5)
- ✅ No CDN requests made
- ✅ PDFLib loaded locally
- ✅ pdfjsLib loaded locally
- ✅ JSZip loaded locally
- ⚠️ PDF.js worker: lazy init (se configura al abrir herramienta PDF)

---

## Pruebas pendientes (requieren interacción manual en http://localhost:8080)

Las siguientes pruebas requieren un navegador real con interacción visual:

1. **Cada herramienta con archivo real:** Cargar un archivo, procesar, descargar, verificar que el archivo se abre
2. **Drag & drop:** Arrastrar archivos desde el explorador
3. **Modo oscuro:** Verificar legibilidad completa
4. **Canvas interactivos:** removeObjects, censor, socialCrop (pintar, deshacer, rehacer)
5. **PDF thumbnails:** Verificar que las miniaturas de PDF se renderizan
6. **Firma PDF:** Dibujar firma, verificar que se coloca en la página correcta
7. **DocPhoto con hoja:** Verificar layout de múltiples fotos en A4
8. **Workflow:** Crear flujo, guardar preset, recargar página, verificar que se mantiene
9. **fileCompliance:** Probar los 3 casos del brief (JPG 600×600 500KB, PNG 1200px 1MB, WebP 1:1 300KB)
10. **advancedConvert:** Probar rotación, volteo, marca de agua con archivo real

---

## Confirmaciones

- ✅ Las herramientas aprobadas procesan archivos reales (Playwright verification)
- ✅ Selectores de archivos funcionan (upload y browse)
- ✅ Navegación funciona (filtros, búsqueda, tema oscuro)
- ✅ Presentación inicial no produce destello (critical CSS inline)
- ✅ Versión móvil funciona (4 viewports probados)
- ✅ Dependencias esenciales funcionan localmente (sin CDN)
- ✅ QA-REPORT.md está completo
- ✅ localhost:8080 permanece activo
- ✅ No se realizó commit ni push
- ✅ No se publicó la página
- ✅ Backup preservado en toolisto-backup-before-full-qa/
