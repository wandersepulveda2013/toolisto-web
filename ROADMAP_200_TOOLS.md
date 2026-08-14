# Roadmap: Expansión de Toolisto a 200 Herramientas

## Integración APLUNO — 2026-08-14

- [x] Convertir APLUNO en la portada y marca madre del sitio.
- [x] Integrar Toolisto en `https://apluno.com/toolisto` sin depender de `toolisto.com`.
- [x] Conservar las 167 páginas funcionales de herramientas en sus rutas planas.
- [x] Añadir las páginas públicas de Ordía, Workspace, Sobre APLUNO, Contacto, Privacidad y Términos.
- [x] Separar la landing pública de Workspace de su preview interno no indexable.
- [x] Actualizar build, PWA, sitemap, robots, canónicos, pruebas y documentación al dominio único.
- [ ] Publicar `dist/`, conectar DNS/TLS de `apluno.com` y completar validación real en producción (trabajo externo a este repositorio).

**Objetivo:** Expandir de 83 a 200 herramientas funcionales con procesamiento real en el navegador.

> **Estado de ejecución (2026-08-01):** La expansión se ejecuta por lotes definidos en
> `scripts/batch6-spec.mjs` (catalog + `--write --category`). Las fases de ejecución no coinciden
> con la numeración de este documento; este archivo refleja el estado por herramienta (Hecho/Pendiente).
> **Estado de certificación (2026-08-10):** 167 herramientas implementadas con procesador;
> **167 habilitadas** (`enabled: true`, con tarjeta en la portada, sitemap y SEO index).
> **De las 167 habilitadas, 101 están certificadas funcionalmente** con harness E2E real (fixture real +
> descarga + reapertura + validación semántica, ver lista abajo); las otras **66 están publicadas con
> cobertura estructural** (existencia de página/procesador) y tienen su harness dedicado pendiente
> (marcadas "SIN harness E2E dedicado" en la matriz). Fuente única de verdad: `src/data/tools.json`
> y `artifacts/deep-audit/toolisto/MATRIZ_CERTIFICACION_HERRAMIENTAS_TOOLISTO.csv` (reconciliada contra
> tools.json el 2026-08-10: 167 Sí / 0 No, 0 discrepancias).
> `pdfEncryptAdvanced` se reactivó al certificarse con su motor propio `js/security/pdf-encryptor.js`
> (security handler estándar ISO 32000-1 §7.6: RC4-128 y AES-128/AESV2), validado con pdf.js en el
> harness `tests/gate-e2e-pdf-encrypt.mjs` (35/35): sin contraseña rechaza, con la contraseña recupera
> texto y metadatos, y el contenido sensible nunca queda en claro. Evidencia:
> `artifacts/deep-audit/toolisto/TLT-certify-pdf-encrypt-evidence.json`.
> La columna "Estado" de las tablas refleja la implementación (Hecho/Pendiente), no la certificación.
> Harness de modos: `tests/verify-115-tools.mjs` cubre 29 herramientas rebuild con UIs form-first
> (calc 2, estructura 3, archivos 3, QR 7, Excel/CSV/JSON/XML 14) — **222 PASS / 0 FAIL**. Las
> 15 de calc/estructura/archivos/QR y las 14 de Excel/CSV/JSON/XML están marcadas `certified` en la matriz.
> Harness de imágenes: `tests/verify-image-family.mjs` cubre la familia visual certificada
> (crop, stripMetadata, socialCrop, fileCompliance, colorPicker, imageCompare, docPhoto, censor,
> fixFormat, rescueDoc, enhanceScannedDocument, advancedConvert) con fixtures PNG reales y validación
> de píxeles/dimensiones/EXIF/JPEG/WebP — **93 PASS / 0 FAIL (2026-08-04)**.
> Harness de PDF: `tests/verify-pdf-family.mjs` cubre 22 herramientas PDFLib deterministas
> (rotatePdf, deletePagesPdf, reversePagesPdf, duplicatePagesPdf, insertBlankPagesPdf,
> editMetadataPdf, compressPdf, cropPdf, resizePdfPages, nUpPdf, mergePdf, interleavePdf,
> splitDoublePdf, bookletPdf, watermarkPdf, addPageNumbersPdf, addHeaderFooterPdf, imagesPdf,
> splitPdf, reorderPdf, pdfToImages, signPdf) con inspección en navegador (PDFLib: rotación,
> conteo, tamaños, metadatos), render/texto de pdf.js (orden de páginas, marcas de agua,
> numeración, encabezado/pie), JSZip (ZIP de páginas), drag&drop real y firma dibujada a puntero
> sobre lienzo — **95 PASS / 0 FAIL (2026-08-05)**.
> El lote PDF de 2026-08-05 incluyó: `imagesPdf` (imágenes→PDF A4), `splitPdf` (rangos + salida
> single/ZIP), `reorderPdf` (drag&drop verificado por hashes de render), `pdfToImages` (PDF→PNG ZIP
> con dimensiones verificadas 918×1188), `signPdf` (firma dibujada con puntero, verificada por píxeles
> oscuros en la zona de firma y ausencia en las demás páginas).
> Harness de imagen interactiva: `tests/gate-e2e-image-tools.mjs` certifica **21 PASS / 0 FAIL
> (2026-08-05)** las herramientas con editor visual recién habilitadas: `signature` (limpiar-firma:
> umbral, recorte y tinta verificados por píxeles sobre PNG generado en navegador), `removeObjects`
> (borrar-objetos-de-imagen: pincel real sobre zona roja → inpainting por difusión reemplaza el objeto
> por el color del fondo, verificado por píxeles antes/después) y `workflow` (flujo-de-imagenes:
> rotar 90°→redimensionar 1080→voltear, orden probado por dimensiones 200×100 → 1080×2160 en WebP).
> Fix durante la certificación: el mensaje del workflow decía "3 operaciónes aplicadas" (singular +
> "es"); ahora "1 operación aplicada" / "N operaciones aplicadas".
> Fix en `app.js` durante la certificación PDF: `processResizePdfPages` y `processNUpPdf` fallaban
> con `Can't embed page with missing Contents` al procesar PDF con páginas en blanco (sin stream de
> contenido): `embedPdf`/`drawPage` es diferido y reventaba en `save()`. Ahora ambas saltan el embed
> cuando `page.node.Contents()` es `undefined`, dejando la hoja/página en blanco del tamaño correcto.
> En el lote siguiente (2026-08-05) `processSplitDoublePdf` recibió el mismo guard `Contents()`:
> las páginas dobles en blanco ya no revientan el `save()` (quedan dos mitades en blanco del tamaño
> correcto en lugar de un error).
> Lote de imágenes canvas certificado: docPhoto, censor, fixFormat, rescueDoc,
> enhanceScannedDocument, advancedConvert. Bugs corregidos durante la certificación:
> (1) `enhanceScannedDocument` leía claves `brightness/contrast/...` pero el UI envía `enhBrightness/...`
> → ahora mapea ambas (con fallback) y normaliza el formato de salida `image/png|jpeg|webp|auto`;
> (2) `loadImageFromFile` no existía en el contexto del sitio (era helper del workspace) → definido
> localmente en `tool-processors.js`. Sin estos fixes el contraste/recorte/rotación/formatos del
> procesador eran ignorados.
> Fix en `app.js` (`runBuiltinTool`): `if (result.summary) return result;` — los builtins
> `colorPicker` y `imageCompare` ya devuelven `{ summary }`, y la envoltura previa `{ summary: result }`
> duplicaba el objeto, dejando el diálogo de resultado vacío (sin título, mensaje ni estadísticas).
> Harness de Word: `tests/gate-e2e-word-tools.mjs` certifica **67 PASS / 0 FAIL (2026-08-05)** las 20
> herramientas de la familia Word: `wordToPdf`, `wordToJpg`, `wordToPng`, `wordToHtml`,
> `wordToMarkdown`, `wordToEpub`, `wordToOdt`, `odtToWord`, `rtfToWord`, `mergeWord`, `splitWord`,
> `repairWord`, `compressWord`, `stripMetadataWord`, `formatDocument`, `tocWord`, `extractWord`,
> `findReplaceWord`, `tablesWordToExcel`, `removeBlankPagesWord`. Fixtures DOCX (docx.js con
> encabezados/tabla/texto), ODT (JSZip) y RTF generados en el navegador; validación real con mammoth,
> JSZip, pdfjs (texto extraíble del PDF), XLSX y createImageBitmap; evidencia en
> `artifacts/deep-audit/toolisto/TLT-certify-word-family-evidence.json`.
> Harness de EPUB: `tests/gate-e2e-epub-tools.mjs` certifica **70 PASS / 0 FAIL (2026-08-06)** las 7
> herramientas de la familia EPUB que faltaban: `epubToHtml`, `epubToMarkdown`, `mergeEpub`,
> `splitEpub`, `editMetadataEpub`, `validateEpub`, `repairEpub` (se suman a `txtToEpub`, `epubToTxt`,
> `coverEpub`, `imagesEpub` ya certificadas). Fixtures EPUB reales generados en el navegador con JSZip
> (`main.epub` con 2 capítulos XHTML + imagen + CSS + toc.ncx, `book2.epub` con 1 capítulo, `broken.epub`
> sin mimetype ni container.xml y referencias rotas a `styles/default.css` y `missing.xhtml`); validación
> estructural (mimetype, container.xml, OPF, spine) y revalidación del EPUB reparado con `validateEpub`.
> Bugs corregidos durante la certificación: (1) `epubToMarkdown` tenía la opción `singleFile` muerta
> (multi capítulos devolvía un solo `.md` con los tres archivos) → ahora genera un `.md` por capítulo en
> ZIP y `singleFile` combina en uno; (2) `repairEpub` solo reportaba las referencias rotas sin eliminarlas
> → ahora poda del manifest los `item` sin archivo y los `itemref` del spine cuyo idref ya no exista;
> (3) `validateEpub` explotaba con `parser` indefinido en EPUBs rotos sin container.xml → localiza el OPF
> por path-scan y declara el parser fuera del bloque; (4) `app.js`: faltaban los controles de la UI para
> `singleFile` (html/markdown), título/autor/idioma (`mergeEpub`) y los 7 metadatos (`editMetadataEpub`).
> Evidencia en `artifacts/deep-audit/toolisto/TLT-certify-epub-family-evidence.json`.
> Harness PDF + miscelánea: `tests/gate-e2e-pdf-misc-tools.mjs` certifica **62 PASS / 0 FAIL (2026-08-06)** 8
> herramientas: `pdfTablesToExcel`, `censorPdf`, `verifyPdfCensor`, `comparePdfs`, `cameraDocumentScanner`,
> `photoLocationExtractor`, `formatDocumentApa7`, `imageTableToExcel`. Fixtures reales en el navegador
> (PDFs con tabla + SECRETO, JPEG con EXIF GPS completo: IFD0→Exif IFD→GPS IFD, PNG de cámara, PNG de
> tabla con OCR); validación con pdfjs (texto extraíble/no recuperable), JSZip (reporte comparación +
> diff-pagina.png), docx (APA 7), XLSX y PhotoLocation.
> Bugs corregidos durante la certificación: (1) `app.js` no tenía entradas en `toolMeta`/`validateToolFiles`
> para 5 herramientas (`censorPdf`, `verifyPdfCensor`, `comparePdfs`, `photoLocationExtractor`,
> `formatDocumentApa7`) → el botón Ejecutar quedaba deshabilitado tras subir archivos; (2) pdfjs detacha el
> ArrayBuffer en `getDocument` → `loadDocument` de `js/security/pdf-censor-engine.js` ahora pasa
> `arrayBuffer.slice(0)` (página 2 explotaba con "Cannot perform Construct on a detached ArrayBuffer" y el
> censor fallaba con "No se pudo censurar ninguna página"); (3) `readIfdEntries` de
> `js/metadata/photo-location.js` tenía un bug de hoisting de `var count` que reasignaba el límite del bucle
> → se truncaban las entradas GPS tras la 3ª (longitud/altitud quedaban `null`); (4) `formatDocumentApa7`
> usaba Times New Roman (prohibido) → Arial; (5) `tools.json` usaba `accepts: "pdf"` singular para
> `verifyPdfCensor`/`comparePdfs` → el input `#fileInput` no era `multiple` (no admitía 2 PDFs) → `"pdfs"`.
> Evidencia en `artifacts/deep-audit/toolisto/TLT-certify-pdf-misc-evidence.json`.
> Harness de cifrado PDF: `tests/gate-e2e-pdf-encrypt.mjs` certifica **35 PASS / 0 FAIL (2026-08-10)**
> `pdfEncryptAdvanced` con motor propio `js/security/pdf-encryptor.js` (security handler estándar
> ISO 32000-1 §7.6: RC4-128 y AES-128/AESV2). pdf-lib no implementa el handler (su `save({userPassword})`
> no cifra), así que el motor re-parsea el PDF re-serializado (xref clásico), calcula O/U/K/P y reescribe
> el archivo cifrando strings y streams. Escenario A (userPassword + permisos): pdf.js rechaza la apertura
> sin contraseña y con la incorrecta, y con la correcta recupera texto y 2 páginas; el contenido sensible
> y los metadatos nunca quedan en claro. Escenario B (userPassword vacío): apertura libre con `/Encrypt`
> presente (permisos de propietario). Bugs corregidos durante la certificación: Algo 2/5 usaban la clave
> K donde correspondía el ID del archivo y viceversa, la clave por objeto AES no incluía "sAlT", los
> streams se recortaban por EOL en vez de `/Length`, `/Length` no se actualizaba tras el cifrado AES y
> el hash de U usaba la contraseña padded en vez de la cadena de padding fija (Algo 5/6 como pdf.js y
> PyPDF2). Evidencia en `artifacts/deep-audit/toolisto/TLT-certify-pdf-encrypt-evidence.json`.
> Harness de Audio/Vídeo: `tests/gate-e2e-av-tools.mjs` certifica **47 PASS / 0 FAIL (2026-08-06)** las 9
> herramientas FFmpeg.wasm: `convertAudio`, `trimAudio`, `mergeAudio`, `compressVideo`, `trimVideo`,
> `mergeVideos`, `videoToGif`, `extractAudioFromVideo`, `removeAudioFromVideo`. Fixtures WAV y WebM (con
> pista de audio) generados con FFmpeg real (lavfi) en el navegador; validación de los resultados
> descargados por magic bytes + streams/duration leídos por FFmpeg. Bugs corregidos durante la
> certificación: (1) `app.js` recogía las opciones con el id del control (`audioOutputFormat`,
> `trimAudioStart`, …) pero los procesadores leen `outputFormat`/`startTime`/… → los selects eran
> decorativos; ahora `runCurrentTool` mapea los alias por herramienta; (2) el `import()` dinámico de
> `vendor/js/engine-loader.js` (script clásico) resolvía rutas relativas contra `vendor/js/` → 404
> `vendor/js/vendor/ffmpeg/ffmpeg.js`; ahora se absolutizan con `new URL(..., document.baseURI)` (las 9
> herramientas fallaban al cargar FFmpeg); (3) `getExt` no estaba definido en `tool-processors.js`
> (ReferenceError al abrir cualquier herramienta AV) → añadido junto a `getBaseName`; (4)
> `trimAudio`/`mergeAudio`/`trimVideo`/`mergeVideos`/`removeAudioFromVideo` usaban `-c copy` siempre:
> al cambiar de contenedor (WAV→MP3, WebM→MP4) FFmpeg escribía un archivo vacío → ahora re-codifican
> (libmp3lame/libvorbis/libx264/libvpx) cuando el formato de salida no coincide con el de entrada.
> Evidencia en `artifacts/deep-audit/toolisto/TLT-certify-av-evidence.json`.
> Harness de texto: `tests/gate-e2e-text-tools.mjs` certifica **56 PASS / 0 FAIL (2026-08-07)** las 15
> herramientas de texto con UI genérica: `txtToPdf`, `mergeTxt`, `splitTxt`, `sortLines`,
> `removeDuplicates`, `textStatistics`, `wordCount`, `textDiff`, `htmlToMarkdown`, `htmlToText`,
> `cssMinifier`, `base64Encode`, `base64Decode`, `urlEncode`, `urlDecode`. Fixtures reales (TXT con
> duplicados/desorden, TXT grande de 150 líneas, HTML con script/style, CSS con comentarios, Base64 y
> URL autoconsistentes); validación semántica de cada salida descargada (PDF reabierto con pdfjs,
> ZIP reabierto con JSZip, estadísticas con conteos exactos, diff añadidas/eliminadas, CSS minificado
> sin comentarios, round-trips Base64/URL) + rechazo de tipos incompatibles (run deshabilitado) +
> cero egress externo con red bloqueada + cero errores de consola.
> Evidencia en `artifacts/deep-audit/toolisto/TLT-certify-text-family-evidence.json`.
> Fixes reales durante la certificación de Word:
> (1) `wrapPdfText` (compartido por `wordToPdf` y `txtToPdf`) referenciaba `StandardFonts` y `rgb`
> declarados solo en el scope del llamador → ReferenceError silenciado por el try/catch del dibujo,
> produciendo un PDF en blanco; ahora resuelve ambos del global `PDFLib`.
> (2) `doc.embedFont(...)` devuelve una Promise en el bundle pdf-lib del sitio → sin `await` el
> `drawText` fallaba (`options.font` NaN) y se tragaba el error; `wrapPdfText` ahora es async y sus
> llamadores (`wordToPdf`, `txtToPdf`) esperan el `await`.
> (3) `findReplaceWord` no tenía controles de búsqueda/reemplazo en la UI → añadido su bloque en
> `htmlByTool` (`app.js`): `search`, `replace`, `caseSensitive` y `regex`, conectados por id al
> procesador existente.

## Fase 1 — PDF Avanzado (25 herramientas)
Librerías: PDFLib + pdf.js (ya existentes en vendor/)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 1 | rotatePdf | Girar páginas PDF | girar-pdf | Baja | PDFLib | Hecho |
| 2 | deletePagesPdf | Eliminar páginas PDF | eliminar-paginas-pdf | Baja | PDFLib | Hecho |
| 3 | reversePagesPdf | Invertir orden de páginas | invertir-orden-pdf | Baja | PDFLib | Hecho |
| 4 | duplicatePagesPdf | Duplicar páginas PDF | duplicar-paginas-pdf | Baja | PDFLib | Hecho |
| 5 | insertBlankPagesPdf | Insertar páginas en blanco | insertar-paginas-en-blanco-pdf | Baja | PDFLib | Hecho |
| 6 | editMetadataPdf | Editar metadatos PDF | editar-metadatos-pdf | Baja | PDFLib | Hecho |
| 7 | compressPdf | Comprimir PDF | comprimir-pdf | Media | PDFLib | Hecho |
| 8 | interleavePdf | Intercalar páginas PDF | intercalar-pdf | Media | PDFLib | Hecho |
| 9 | cropPdf | Recortar márgenes PDF | recortar-pdf | Media | PDFLib | Hecho |
| 10 | resizePdfPages | Redimensionar páginas PDF | cambiar-tamano-paginas-pdf | Media | PDFLib | Hecho |
| 11 | nUpPdf | Varias páginas por hoja | varias-paginas-por-hoja-pdf | Alta | PDFLib | Hecho |
| 12 | splitDoublePdf | Dividir páginas dobles | dividir-paginas-dobles-pdf | Media | PDFLib | Hecho |
| 13 | bookletPdf | Crear cuadernillo | crear-cuadernillo-pdf | Alta | PDFLib | Hecho |
| 14 | watermarkPdf | Agregar marca de agua | agregar-marca-de-agua-pdf | Media | PDFLib | Hecho |
| 15 | addPageNumbersPdf | Numerar páginas | numerar-paginas-pdf | Media | PDFLib | Hecho |
| 16 | addHeaderFooterPdf | Encabezado y pie de página | encabezado-pie-pdf | Media | PDFLib | Hecho |
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
| 64 | csvToMarkdown | CSV a Markdown | csv-a-markdown | Baja | JS nativo | Hecho |
| 65 | csvToHtml | CSV a HTML | csv-a-html | Baja | JS nativo | Hecho |
| 66 | csvToYaml | CSV a YAML | csv-a-yaml | Baja | JS nativo | Hecho |
| 67 | excelToHtml | Excel a HTML | excel-a-html | Media | xlsx | Hecho |
| 68 | excelToMarkdown | Excel a Markdown | excel-a-markdown | Media | xlsx | Hecho |
| 69 | excelToXml | Excel a XML | excel-a-xml | Media | xlsx | Hecho |
| 70 | xmlToExcel | XML a Excel | xml-a-excel | Media | xlsx | Hecho |
| 71 | csvStatistics | Estadísticas CSV | estadisticas-csv | Media | JS nativo | Hecho |
| 72 | csvFilter | Filtrar CSV | filtrar-csv | Media | JS nativo | Hecho |
| 73 | csvSort | Ordenar CSV | ordenar-csv | Media | JS nativo | Hecho |
| 74 | csvMergeColumns | Fusionar columnas CSV | fusionar-columnas-csv | Media | JS nativo | Pendiente |
| 75 | csvSplitColumns | Dividir columnas | dividir-columnas-csv | Media | JS nativo | Pendiente |
| 76 | csvToSql | CSV a SQL | csv-a-sql | Media | JS nativo | Hecho |
| 77 | jsonToYaml | JSON a YAML | json-a-yaml | Media | JS nativo | Pendiente |
| 78 | yamlToJson | YAML a JSON | yaml-a-json | Media | JS nativo | Pendiente |
| 79 | jsonFormatter | Formatear JSON | formatear-json | Baja | JS nativo | Hecho |
| 80 | xmlFormatter | Formatear XML | formatear-xml | Baja | JS nativo | Pendiente |
| 81 | jsonValidator | Validar JSON | validar-json | Baja | JS nativo | Hecho |
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
| 110 | pdfEncryptAdvanced | Encriptación avanzada PDF | encriptar-pdf-avanzado | Alta | Motor propio (ISO 32000-1 §7.6: RC4-128 + AES-128) | Hecho |

## Fase 8 — QR, Códigos y Escaneo (6 herramientas)
Librerías: JS nativo (generadores de código propios)

| # | ID | Nombre | Slug | Complejidad | Biblioteca | Estado |
|---|-----|--------|------|-------------|------------|--------|
| 111 | qrGenerate | Generar código QR | generar-qr | Media | JS nativo | Pendiente |
| 112 | barcodeGenerate | Generar código de barras | generar-codigo-barras | Media | JS nativo | Pendiente |
| 113 | qrReadFromImage | Leer QR de imagen | leer-qr-imagen | Alta | Canvas+JS | Pendiente |
| 114 | colorPicker | Selector de color de imagen | selector-color | Baja | Canvas | Hecho |
| 115 | imageCompare | Comparar dos imágenes | comparar-imagenes | Media | Canvas | Hecho |
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
