# Roadmap: Expansión de Toolisto a 200 Herramientas

**Objetivo:** Expandir de 83 a 200 herramientas funcionales con procesamiento real en el navegador.

## Fase 1 — PDF Avanzado (25 herramientas)
Librerías: PDFLib + pdf.js (ya existentes en vendor/)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 1 | rotatePdf | Girar páginas PDF | girar-pdf | Baja | PDFLib | Pendiente |
| 2 | deletePagesPdf | Eliminar páginas PDF | eliminar-paginas-pdf | Baja | PDFLib | Pendiente |
| 3 | reversePagesPdf | Invertir orden de páginas | invertir-orden-pdf | Baja | PDFLib | Pendiente |
| 4 | duplicatePagesPdf | Duplicar páginas PDF | duplicar-paginas-pdf | Baja | PDFLib | Pendiente |
| 5 | insertBlankPagesPdf | Insertar páginas en blanco | insertar-paginas-en-blanco-pdf | Baja | PDFLib | Pendiente |
| 6 | editMetadataPdf | Editar metadatos PDF | editar-metadatos-pdf | Baja | PDFLib | Pendiente |
| 7 | compressPdf | Comprimir PDF | comprimir-pdf | Media | PDFLib | Hecho |
| 8 | interleavePdf | Intercalar páginas PDF | intercalar-pdf | Media | PDFLib | Hecho |
| 9 | cropPdf | Recortar márgenes PDF | recortar-pdf | Media | PDFLib | Hecho |
| 10 | resizePdfPages | Redimensionar páginas PDF | cambiar-tamano-paginas-pdf | Media | PDFLib | Hecho |
| 11 | nUpPdf | Varias páginas por hoja | varias-paginas-por-hoja-pdf | Alta | PDFLib | Hecho |
| 12 | splitDoublePdf | Dividir páginas dobles | dividir-paginas-dobles-pdf | Media | PDFLib | Pendiente |
| 13 | bookletPdf | Crear cuadernillo | crear-cuadernillo-pdf | Alta | PDFLib | Pendiente |
| 14 | watermarkPdf | Agregar marca de agua | agregar-marca-de-agua-pdf | Media | PDFLib | Pendiente |
| 15 | addPageNumbersPdf | Numerar páginas | numerar-paginas-pdf | Media | PDFLib | Pendiente |
| 16 | addHeaderFooterPdf | Encabezado y pie de página | encabezado-pie-pdf | Media | PDFLib | Pendiente |
| 17 | protectPdf | Proteger con contraseña | proteger-pdf | Media | PDFLib | Pendiente |
| 18 | unlockPdf | Quitar contraseña | quitar-contrasena-pdf | Media | PDFLib | Pendiente |
| 19 | flattenPdf | Aplanar formularios | aplanar-pdf | Media | PDFLib | Pendiente |
| 20 | extractTextPdf | Extraer texto PDF | extraer-texto-pdf | Media | pdf.js | Pendiente |
| 21 | extractImagesPdf | Extraer imágenes PDF | extraer-imagenes-pdf | Alta | pdf.js | Pendiente |
| 22 | fillFormPdf | Rellenar formulario PDF | rellenar-formulario-pdf | Alta | PDFLib | Pendiente |
| 23 | annotatePdf | Anotar PDF | anotar-pdf | Alta | PDFLib | Pendiente |
| 24 | redactPdf | Redactar PDF | redactar-pdf | Alta | PDFLib | Pendiente |
| 25 | bookmarkPdf | Crear marcadores PDF | crear-marcadores-pdf | Media | PDFLib | Pendiente |

## Fase 2 — Imágenes y GIF (20 herramientas)
Librerías: Canvas API (nativa del navegador)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 26 | resizeImage | Redimensionar imagen | redimensionar-imagen-v2 | Baja | Canvas | Pendiente |
| 27 | rotateImage | Girar y voltar imagen | girar-imagen | Baja | Canvas | Pendiente |
| 28 | watermarkImage | Marca de agua en imagen | marca-de-agua-imagen | Media | Canvas | Pendiente |
| 29 | borderImage | Agregar borde a imagen | agregar-borde-imagen | Baja | Canvas | Pendiente |
| 30 | brightnessContrastImage | Brillo y contraste | brillo-contraste-imagen | Media | Canvas | Pendiente |
| 31 | saturationImage | Saturación y tono | saturacion-tono-imagen | Media | Canvas | Pendiente |
| 32 | grayscaleImage | Escala de grises | escala-de-grises | Baja | Canvas | Pendiente |
| 33 | sepiaImage | Filtro sepia | filtro-sepia | Baja | Canvas | Pendiente |
| 34 | invertColorsImage | Invertir colores | invertir-colores | Baja | Canvas | Pendiente |
| 35 | blurImage | Desenfocar imagen | desenfocar-imagen | Media | Canvas | Pendiente |
| 36 | sharpenImage | Enfocar imagen | enfocar-imagen | Media | Canvas | Pendiente |
| 37 | detectEdgesImage | Detectar bordes | detectar-bordes-imagen | Media | Canvas | Pendiente |
| 38 | thresholdImage | Umbral binario | umbral-binario | Media | Canvas | Pendiente |
| 39 | combineImagesImage | Combinar imágenes lado a lado | combinar-imagenes | Media | Canvas | Pendiente |
| 40 | annotateImage | Anotar imagen con texto | anotar-imagen | Media | Canvas | Pendiente |
| 41 | trimImage | Recortar bordes vacíos | recortar-bordes-vacios | Media | Canvas | Pendiente |
| 42 | circleCropImage | Recorte circular | recorte-circular | Baja | Canvas | Pendiente |
| 43 | pixelateImage | Pixelar zona | pixelar-imagen | Media | Canvas | Pendiente |
| 44 | duotoneImage | Efecto duotono | efecto-duotono | Media | Canvas | Pendiente |
| 45 | histogramImage | Histograma de imagen | histograma-imagen | Alta | Canvas | Pendiente |

## Fase 3 — Word, PowerPoint y Office (18 herramientas)
Librerías: mammoth, docx, jszip (existentes) + Nueva: pptx (requiere autorización)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 46 | wordStatistics | Estadísticas Word | estadisticas-word | Baja | mammoth | Pendiente |
| 47 | compareWord | Comparar Word | comparar-word | Alta | mammoth | Pendiente |
| 48 | wordTemplate | Plantilla Word | plantilla-word | Media | docx | Pendiente |
| 49 | wordToRtf | Word a RTF | word-a-rtf | Media | mammoth | Pendiente |
| 50 | wordToEpubAdvanced | Word a EPUB avanzado | word-a-epub-avanzado | Alta | mammoth+epub | Pendiente |
| 51 | pdfToWord | PDF a Word | pdf-a-word | Alta | pdf.js+mammoth | Pendiente |
| 52 | pptxToPdf | PowerPoint a PDF | pptx-a-pdf | Alta | pptx (nueva) | Pendiente |
| 53 | pptxToImages | PowerPoint a imágenes | pptx-a-imagenes | Alta | pptx (nueva) | Pendiente |
| 54 | pptxToText | Extraer texto PowerPoint | extraer-texto-pptx | Media | pptx (nueva) | Pendiente |
| 55 | pptxToHtml | PowerPoint a HTML | pptx-a-html | Alta | pptx (nueva) | Pendiente |
| 56 | mergePdfAdvanced | Unir PDF con opciones | unir-pdf-avanzado | Media | PDFLib | Pendiente |
| 57 | odtToPdf | ODT a PDF | odt-a-pdf | Media | jszip | Pendiente |
| 58 | csvToWord | CSV a Word | csv-a-word | Media | docx | Pendiente |
| 59 | excelToWord | Excel a Word | excel-a-word | Media | xlsx+docx | Pendiente |
| 60 | markdownToWord | Markdown a Word | markdown-a-word | Media | docx | Pendiente |
| 61 | markdownToHtml | Markdown a HTML | markdown-a-html | Baja | JS nativo | Pendiente |
| 62 | htmlToWord | HTML a Word | html-a-word | Media | mammoth invert | Pendiente |
| 63 | yamlToJson | YAML a JSON | yaml-a-json | Media | JS nativo | Pendiente |

## Fase 4 — Excel, CSV y Datos (20 herramientas)
Librerías: xlsx (existente)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 64 | csvToMarkdown | CSV a Markdown | csv-a-markdown | Baja | JS nativo | Pendiente |
| 65 | csvToHtml | CSV a HTML | csv-a-html | Baja | JS nativo | Pendiente |
| 66 | csvToYaml | CSV a YAML | csv-a-yaml | Baja | JS nativo | Pendiente |
| 67 | excelToHtml | Excel a HTML | excel-a-html | Media | xlsx | Pendiente |
| 68 | excelToMarkdown | Excel a Markdown | excel-a-markdown | Media | xlsx | Pendiente |
| 69 | excelToXml | Excel a XML | excel-a-xml | Media | xlsx | Pendiente |
| 70 | xmlToExcel | XML a Excel | xml-a-excel | Media | xlsx | Pendiente |
| 71 | csvStatistics | Estadísticas CSV | estadisticas-csv | Media | JS nativo | Pendiente |
| 72 | csvFilter | Filtrar CSV | filtrar-csv | Media | JS nativo | Pendiente |
| 73 | csvSort | Ordenar CSV | ordenar-csv | Media | JS nativo | Pendiente |
| 74 | csvMergeColumns | Fusionar columnas CSV | fusionar-columnas-csv | Media | JS nativo | Pendiente |
| 75 | csvSplitColumns | Dividir columnas | dividir-columnas-csv | Media | JS nativo | Pendiente |
| 76 | csvToSql | CSV a SQL | csv-a-sql | Media | JS nativo | Pendiente |
| 77 | jsonToYaml | JSON a YAML | json-a-yaml | Media | JS nativo | Pendiente |
| 78 | yamlToJson | YAML a JSON | yaml-a-json | Media | JS nativo | Pendiente |
| 79 | jsonFormatter | Formatear JSON | formatear-json | Baja | JS nativo | Pendiente |
| 80 | xmlFormatter | Formatear XML | formatear-xml | Baja | JS nativo | Pendiente |
| 81 | jsonValidator | Validar JSON | validar-json | Baja | JS nativo | Pendiente |
| 82 | xmlValidator | Validar XML | validar-xml | Baja | JS nativo | Pendiente |

## Fase 5 — Texto, HTML y Formatos Técnicos (12 herramientas)
Librerías: JS nativo

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 83 | textStatistics | Estadísticas de texto | estadisticas-texto | Baja | JS nativo | Pendiente |
| 84 | wordCount | Contar palabras | contar-palabras | Baja | JS nativo | Pendiente |
| 85 | textDiff | Comparar textos | comparar-textos | Media | JS nativo | Pendiente |
| 86 | htmlToMarkdown | HTML a Markdown | html-a-markdown | Media | JS nativo | Pendiente |
| 87 | markdownToHtmlAdvanced | Markdown a HTML avanzado | markdown-a-html-avanzado | Media | JS nativo | Pendiente |
| 88 | htmlToText | HTML a texto plano | html-a-texto | Baja | JS nativo | Pendiente |
| 89 | cssMinifier | Minificar CSS | minificar-css | Media | JS nativo | Pendiente |
| 90 | jsMinifier | Minificar JavaScript | minificar-js | Media | JS nativo | Pendiente |
| 91 | jsonToCsv | JSON a CSV | json-a-csv-v2 | Media | JS nativo | Pendiente |
| 92 | base64Encode | Base64 codificar | codificar-base64 | Baja | JS nativo | Pendiente |
| 93 | base64Decode | Base64 decodificar | decodificar-base64 | Baja | JS nativo | Pendiente |
| 94 | urlEncode | URL codificar | codificar-url | Baja | JS nativo | Pendiente |

## Fase 6 — EPUB y E-books (8 herramientas)
Librerías: epub.js, jszip (existentes)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 95 | epubToPdf | EPUB a PDF | epub-a-pdf | Alta | epub.js+PDFLib | Pendiente |
| 96 | txtToEpubAdvanced | TXT a EPUB avanzado | txt-a-epub-avanzado | Media | jszip | Pendiente |
| 97 | htmlToEpub | HTML a EPUB | html-a-epub | Alta | jszip | Pendiente |
| 98 | markdownToEpub | Markdown a EPUB | markdown-a-epub | Alta | jszip | Pendiente |
| 99 | epubToPdfAdvanced | EPUB a PDF con formato | epub-a-pdf-avanzado | Alta | epub.js+PDFLib | Pendiente |
| 100 | splitEpubByChapters | Dividir EPUB por capítulos | dividir-epub-capitulos | Media | epub.js+jszip | Pendiente |
| 101 | epubStatistics | Estadísticas EPUB | estadisticas-epub | Media | epub.js | Pendiente |
| 102 | epubRepairAdvanced | Reparar EPUB avanzado | reparar-epub-avanzado | Alta | epub.js+jszip | Pendiente |

## Fase 7 — ZIP, Archivos y Seguridad (8 herramientas)
Librerías: jszip (existente)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 103 | unzipFile | Extraer archivo ZIP | extraer-zip | Baja | jszip | Pendiente |
| 104 | createZipAdvanced | Crear ZIP avanzado | crear-zip-avanzado | Media | jszip | Pendiente |
| 105 | zipRepair | Reparar ZIP | reparar-zip | Media | jszip | Pendiente |
| 106 | fileSplit | Dividir archivo grande | dividir-archivo | Media | JS nativo | Pendiente |
| 107 | fileJoin | Unir archivos divididos | unir-archivos-divididos | Media | JS nativo | Pendiente |
| 108 | checksumFile | Calcular hash/checksum | calcular-hash | Media | Web Crypto API | Pendiente |
| 109 | fileInspector | Inspeccionar archivo | inspeccionar-archivo | Media | JS nativo | Pendiente |
| 110 | pdfEncryptAdvanced | Encriptación avanzada PDF | encriptar-pdf-avanzado | Alta | PDFLib | Pendiente |

## Fase 8 — QR, Códigos y Escaneo (6 herramientas)
Librerías: JS nativo (generadores de código propios)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 111 | qrGenerate | Generar código QR | generar-qr | Media | JS nativo | Pendiente |
| 112 | barcodeGenerate | Generar código de barras | generar-codigo-barras | Media | JS nativo | Pendiente |
| 113 | qrReadFromImage | Leer QR de imagen | leer-qr-imagen | Alta | Canvas+JS | Pendiente |
| 114 | colorPicker | Selector de color de imagen | selector-color | Baja | Canvas | Pendiente |
| 115 | imageCompare | Comparar dos imágenes | comparar-imagenes | Media | Canvas | Pendiente |
| 116 | pdfPageCounter | Contar páginas PDF | contar-paginas-pdf | Baja | pdf.js | Pendiente |

## Resumen por Fase

| Fase | Categoría | Herramientas | Acumulado |
|------|-----------|-------------|-----------|
| 1 | PDF Avanzado | 25 | 108 |
| 2 | Imágenes y GIF | 20 | 128 |
| 3 | Word/PowerPoint/Office | 18 | 146 |
| 4 | Excel/CSV/Datos | 20 | 166 |
| 5 | Texto/HTML/Técnicos | 12 | 178 |
| 6 | EPUB/E-books | 8 | 186 |
| 7 | ZIP/Archivos/Seguridad | 8 | 194 |
| 8 | QR/Códigos/Escaneo | 6 | 200 |

## Reglas de Activación

Una herramienta se considera **activa** solo cuando TODOS estos elementos existen:
1. ✅ Entrada en `tools.json` con status `enabled: true`
2. ✅ Entrada en `toolMeta` en `app.js`
3. ✅ Función procesadora en `app.js` o `tool-processors.js`
4. ✅ Case en `runBuiltinTool` switch
5. ✅ Validación en `validateToolFiles`
6. ✅ Aparece en `availableTools` (picker)
7. ✅ Controles avanzados (si tiene opciones)
8. ✅ SEO page generada en `dist/`
9. ✅ Entrada en `categories.json`
10. ✅ Tests de procesamiento
11. ✅ Fixtures de prueba reales
12. ✅ Status = `active` (no `placeholder`)

## Dependencias Nuevas Requeridas

| Biblioteca | Para | Licencia | Estado |
|-----------|------|----------|--------|
| pptx | Fase 3: PowerPoint | MIT | Requiere autorización |
| (todas las demás usan bibliotecas existentes) | | | |

## Notas de Implementación

- **Counter dinámico**: El contador en index.html debe calcularse automáticamente desde `tools.json` (no hardcoded)
- **Filtros**: Los filtros de categoría en la homepage deben funcionar con las nuevas herramientas
- **Búsqueda**: La búsqueda en el hero debe encontrar las nuevas herramientas
- **Relacionados**: Cada herramienta nueva debe tener 4-6 herramientas relacionadas
- **FAQ**: Cada herramienta nueva debe tener al menos 4 preguntas frecuentes
- **Instrucciones**: Cada herramienta debe tener instrucciones paso a paso
- **Limitaciones**: Cada herramienta debe listar sus limitaciones
- **Iconos**: Cada herramienta necesita un iconKey para el futuro sprite SVG
