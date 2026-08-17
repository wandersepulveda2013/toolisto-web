(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    files: [],
    tool: null,
    forcedTool: null,
    outputBlob: null,
    outputName: '',
    previewUrl: '',
    processing: false,
    activeFilter: 'all',
    outputFiles: [],
    inputAccept: null,
    processError: null,
    processPhase: '',
    metadataResult: null,
    toolDisabled: false,
  };

  function trackEvent(name, params) {
    // No-op: Toolisto no envía telemetría. La promesa local-first exige cero
    // egress; este stub mantiene compatibilidad con las llamadas existentes.
    void name; void params;
  }

  const DOC_MIMES = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroenabled.12',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template'
  ];
  const ODT_MIMES = ['application/vnd.oasis.opendocument.text'];
  const RTF_MIMES = ['text/rtf', 'application/rtf'];
  const TXT_MIMES = ['text/plain'];
  const EPUB_MIMES = ['application/epub+zip'];
  const MOBI_MIMES = ['application/x-mobipocket-ebook'];

  function isDocFile(f) { return DOC_MIMES.includes(f.type) || /\.(docx?|dotx?)$/i.test(f.name); }
  function isOdtFile(f) { return ODT_MIMES.includes(f.type) || /\.odt$/i.test(f.name); }
  function isRtfFile(f) { return RTF_MIMES.includes(f.type) || /\.rtf$/i.test(f.name); }
  function isTxtFile(f) { return f.type === 'text/plain' || /\.txt$/i.test(f.name); }
  function isHtmlFile(f) { return f.type === 'text/html' || /\.(html?|xhtml)$/i.test(f.name); }
  function isCssFile(f) { return f.type === 'text/css' || /\.css$/i.test(f.name); }
  function isEpubFile(f) { return EPUB_MIMES.includes(f.type) || /\.epub$/i.test(f.name); }
  function isMobiFile(f) { return MOBI_MIMES.includes(f.type) || /\.mobi$/i.test(f.name); }

  const CSV_MIMES = ['text/csv', 'application/csv'];
  const EXCEL_MIMES = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroenabled.12'];
  const ODS_MIMES = ['application/vnd.oasis.opendocument.spreadsheet'];
  const JSON_MIMES = ['application/json', 'text/json'];
  const XML_MIMES = ['application/xml', 'text/xml'];

  function fileMatchesAccept(file, accept) {
    if (!accept) return true;
    const types = accept.split(',').map(t => t.trim().toLowerCase());
    const mime = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    return types.some(t => {
      if (t === '*/*') return true;
      if (t.endsWith('/*')) return mime.startsWith(t.slice(0, -1));
      if (t.startsWith('.')) return name.endsWith(t);
      return mime === t;
    });
  }

  function acceptToLabel(accept) {
    const map = {
      'image/jpeg': 'archivos JPG/JPEG',
      'image/png': 'archivos PNG',
      'image/webp': 'archivos WebP',
      'application/pdf': 'archivos PDF',
    };
    const types = accept.split(',').map(t => t.trim());
    return types.map(t => map[t] || t).join(' o ');
  }

  function isCsvFile(f) { return CSV_MIMES.includes(f.type) || /\.csv$/i.test(f.name); }
  function isExcelFile(f) { return EXCEL_MIMES.includes(f.type) || /\.(xlsx?|xlsm|xlsb|xlam)$/i.test(f.name); }
  function isOdsFile(f) { return ODS_MIMES.includes(f.type) || /\.ods$/i.test(f.name); }
  function isJsonFile(f) { return JSON_MIMES.includes(f.type) || /\.json$/i.test(f.name); }
  function isXmlFile(f) { return XML_MIMES.includes(f.type) || /\.xml$/i.test(f.name); }
  function isSpreadsheetFile(f) { return isCsvFile(f) || isExcelFile(f) || isOdsFile(f); }

  const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/avi', 'video/3gpp', 'video/mpeg'];
  const AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/webm', 'audio/mp4', 'audio/x-wav'];

  function isVideoFile(f) { return VIDEO_MIMES.includes(f.type) || /\.(mp4|webm|mov|avi|mkv|3gp|mpeg)$/i.test(f.name); }
  function isAudioFile(f) { return AUDIO_MIMES.includes(f.type) || /\.(mp3|wav|ogg|aac|flac|m4a|wma)$/i.test(f.name); }

  const toolMeta = {
    compress: {
      icon: '↘', title: 'Reducir imagen',
      description: 'Reduciremos el peso conservando una calidad equilibrada.',
      accepts: 'image',
    },
    signature: {
      icon: '✦', title: 'Firma transparente',
      description: 'Quitaremos el fondo claro y exportaremos un PNG transparente.',
      accepts: 'image',
    },
    imagesPdf: {
      icon: '▤', title: 'Imágenes a PDF',
      description: 'Crearemos un solo PDF respetando el orden visible.',
      accepts: 'images',
    },
    mergePdf: {
      icon: '⊕', title: 'Unir PDF',
      description: 'Combinaremos los PDF en el orden visible.',
      accepts: 'pdfs',
    },
    crop: {
      icon: '⌗', title: 'Recortar y redimensionar',
      description: 'Prepararemos la imagen con dimensiones exactas.',
      accepts: 'image',
    },
    convert: {
      icon: '⇄', title: 'Convertir imagen',
      description: 'Convertiremos las imágenes al formato elegido.',
      accepts: 'images',
    },
    removeObjects: {
      icon: '◐', title: 'Borrar objetos y texto',
      description: 'Elimina elementos de la imagen pintando la zona manualmente.',
      accepts: 'image',
    },
    batchCompress: {
      icon: '⇊', title: 'Comprimir varias imágenes',
      description: 'Reduce el peso de múltiples imágenes a la vez.',
      accepts: 'images',
    },
    stripMetadata: {
      icon: '◈', title: 'Eliminar metadatos',
      description: 'Elimina información visible en los metadatos de la imagen.',
      accepts: 'images',
    },
    socialCrop: {
      icon: '▣', title: 'Recortar para redes',
      description: 'Prepara tu imagen para TikTok, Instagram, YouTube y más.',
      accepts: 'image',
    },
    splitPdf: {
      icon: '⊟', title: 'Dividir PDF',
      description: 'Extrae páginas individuales o por rangos de un documento.',
      accepts: 'pdfs',
    },
    reorderPdf: {
      icon: '⇶', title: 'Organizar PDF',
      description: 'Reordena las páginas de un PDF arrastrándolas.',
      accepts: 'pdfs',
    },
    pdfToImages: {
      icon: '⬒', title: 'PDF a imágenes',
      description: 'Convierte cada página del PDF en una imagen.',
      accepts: 'pdfs',
    },
    signPdf: {
      icon: '✎', title: 'Firmar PDF',
      description: 'Dibuja o escribe tu firma y colócala en el documento.',
      accepts: 'pdfs',
    },
    rotatePdf: {
      icon: '↻', title: 'Girar páginas PDF',
      description: 'Gira todas las páginas del PDF 90°, 180° o 270°.',
      accepts: 'pdfs',
    },
    deletePagesPdf: {
      icon: '✕', title: 'Eliminar páginas PDF',
      description: 'Elimina páginas específicas del documento por rango.',
      accepts: 'pdfs',
    },
    reversePagesPdf: {
      icon: '⇅', title: 'Invertir orden PDF',
      description: 'Invierte el orden de todas las páginas del documento.',
      accepts: 'pdfs',
    },
    duplicatePagesPdf: {
      icon: '⧉', title: 'Duplicar páginas PDF',
      description: 'Duplica páginas específicas o todas las páginas del documento.',
      accepts: 'pdfs',
    },
    insertBlankPagesPdf: {
      icon: '＋', title: 'Insertar páginas en blanco',
      description: 'Inserta páginas vacías en posiciones específicas del documento.',
      accepts: 'pdfs',
    },
    editMetadataPdf: {
      icon: '🏷', title: 'Editar metadatos PDF',
      description: 'Modifica título, autor, asunto y palabras clave del PDF.',
      accepts: 'pdfs',
    },
    compressPdf: {
      icon: '📦', title: 'Comprimir PDF',
      description: 'Elimina metadatos innecesarios y optimiza el tamaño del PDF.',
      accepts: 'pdf',
    },
    interleavePdf: {
      icon: '🔗', title: 'Intercalar páginas PDF',
      description: 'Alterna las páginas de dos documentos PDF en un solo archivo.',
      accepts: 'pdfs',
    },
    cropPdf: {
      icon: '✂', title: 'Recortar márgenes PDF',
      description: 'Elimina márgenes innecesarios de todas las páginas del PDF.',
      accepts: 'pdf',
    },
    resizePdfPages: {
      icon: '↔', title: 'Redimensionar páginas PDF',
      description: 'Cambia el tamaño de las páginas a formato estándar (A4, Carta, etc).',
      accepts: 'pdf',
    },
    nUpPdf: {
      icon: '⊞', title: 'Varias páginas por hoja',
      description: 'Coloca 2 o 4 páginas en una sola hoja para ahorrar espacio.',
      accepts: 'pdf',
    },
    splitDoublePdf: {
      icon: '⫿', title: 'Dividir páginas dobles',
      description: 'Divide páginas dobles (escaneadas de a dos) en páginas individuales.',
      accepts: 'pdf',
    },
    bookletPdf: {
      icon: '📖', title: 'Crear cuadernillo',
      description: 'Reordena las páginas para imprimir un cuadernillo doble cara.',
      accepts: 'pdf',
    },
    watermarkPdf: {
      icon: '💧', title: 'Agregar marca de agua',
      description: 'Añade una marca de agua de texto a todas las páginas del PDF.',
      accepts: 'pdf',
    },
    addPageNumbersPdf: {
      icon: '#', title: 'Numerar páginas',
      description: 'Agrega números de página en la posición que elijas.',
      accepts: 'pdf',
    },
    addHeaderFooterPdf: {
      icon: '⊥', title: 'Encabezado y pie de página',
      description: 'Añade texto de encabezado y pie en todas las páginas.',
      accepts: 'pdf',
    },
    docPhoto: {
      icon: '⊡', title: 'Foto para documentos',
      description: 'Prepara fotos para pasaporte, visa, DNI y más.',
      accepts: 'image',
    },
    censor: {
      icon: '▓', title: 'Censurar información',
      description: 'Oculta datos sensibles con pixelado o desenfoque.',
      accepts: 'image',
    },
    fixFormat: {
      icon: '⟳', title: 'Reparar formato',
      description: 'Detecta la extensión real del archivo y la corrige.',
      accepts: 'image',
    },
    rescueDoc: {
      icon: '⊞', title: 'Rescatar documento',
      description: 'Mejora iluminación, contraste y nitidez de documentos fotografiados.',
      accepts: 'image',
    },
    fileCompliance: {
      icon: '☑', title: 'Cumplir requisitos',
      description: 'Valida tu archivo contra requisitos específicos y lo ajusta.',
      accepts: 'image',
    },
    workflow: {
      icon: '⛓', title: 'Flujo reutilizable',
      description: 'Encadena varias operaciones en una sola acción.',
      accepts: 'images',
    },
    advancedConvert: {
      icon: '⇄', title: 'Conversor avanzado',
      description: 'Convierte, redimensiona, rota, voltea y añade marca de agua.',
      accepts: 'images',
    },
    wordToPdf: { icon: '📝', title: 'Word a PDF', description: 'Convierte documentos Word a PDF conservando textos, imágenes y tablas.', accepts: 'docs' },
    wordToJpg: { icon: '🖼', title: 'Word a JPG', description: 'Convierte cada página del documento Word en una imagen JPG.', accepts: 'docs' },
    wordToPng: { icon: '🖼', title: 'Word a PNG', description: 'Convierte cada página del documento Word en una imagen PNG de alta calidad.', accepts: 'docs' },
    wordToTxt: { icon: '📝', title: 'Word a TXT', description: 'Extrae el texto plano de documentos Word.', accepts: 'docs' },
    wordToHtml: { icon: '🌐', title: 'Word a HTML', description: 'Convierte documentos Word en HTML con estilos conservados.', accepts: 'docs' },
    wordToMarkdown: { icon: '📋', title: 'Word a Markdown', description: 'Convierte documentos Word en formato Markdown.', accepts: 'docs' },
    wordToEpub: { icon: '📚', title: 'Word a EPUB', description: 'Convierte documentos Word en libros electrónicos EPUB.', accepts: 'docs' },
    wordToOdt: { icon: '📝', title: 'Word a ODT', description: 'Convierte documentos Word a formato ODT de LibreOffice.', accepts: 'docs' },
    odtToWord: { icon: '📝', title: 'ODT a Word', description: 'Convierte documentos ODT a formato Word (DOCX).', accepts: 'odts' },
    rtfToWord: { icon: '📝', title: 'RTF a Word', description: 'Convierte archivos RTF a formato Word (DOCX).', accepts: 'rtfs' },
    mergeWord: { icon: '📝', title: 'Unir documentos Word', description: 'Combina varios documentos Word en uno solo.', accepts: 'docs' },
    splitWord: { icon: '✂', title: 'Dividir documento Word', description: 'Divide un documento Word en varios archivos.', accepts: 'docs' },
    repairWord: { icon: '🔧', title: 'Reparar Word', description: 'Intenta recuperar contenido de documentos Word dañados.', accepts: 'docs' },
    compressWord: { icon: '📦', title: 'Comprimir Word', description: 'Reduce el tamaño de documentos Word optimizando imágenes.', accepts: 'docs' },
    stripMetadataWord: { icon: '🔒', title: 'Eliminar metadatos Word', description: 'Quita información personal y metadatos de documentos Word.', accepts: 'docs' },
    formatDocument: { icon: '🎨', title: 'Uniformar formato', description: 'Unifica fuentes, tamaños y espaciado en documentos Word.', accepts: 'docs' },
    tocWord: { icon: '📑', title: 'Crear tabla de contenido', description: 'Genera una tabla de contenido automáticamente desde los títulos.', accepts: 'docs' },
    extractWord: { icon: '📤', title: 'Extraer contenido', description: 'Extrae texto, tablas, imágenes y enlaces de documentos Word.', accepts: 'docs' },
    findReplaceWord: { icon: '🔍', title: 'Buscar y reemplazar', description: 'Busca y reemplaza texto en varios documentos Word a la vez.', accepts: 'docs' },
    tablesWordToExcel: { icon: '📊', title: 'Tablas Word a Excel', description: 'Extrae tablas de documentos Word y las exporta a Excel.', accepts: 'docs' },
    removeBlankPagesWord: { icon: '📄', title: 'Eliminar páginas en blanco', description: 'Elimina páginas vacías e innecesarias de documentos Word.', accepts: 'docs' },
    txtToPdf: { icon: '📄', title: 'TXT a PDF', description: 'Convierte archivos de texto plano a PDF con formato personalizable.', accepts: 'txts' },
    txtToEpub: { icon: '📚', title: 'TXT a EPUB', description: 'Convierte texto plano en libros electrónicos EPUB.', accepts: 'txts' },
    mergeTxt: { icon: '📎', title: 'Unir archivos TXT', description: 'Combina varios archivos de texto en uno solo.', accepts: 'txts' },
    splitTxt: { icon: '✂', title: 'Dividir archivo TXT', description: 'Divide un archivo de texto por líneas, palabras o caracteres.', accepts: 'txts' },
    sortLines: { icon: '🔤', title: 'Ordenar líneas', description: 'Ordena las líneas de un archivo de texto alfabéticamente.', accepts: 'txts' },
    removeDuplicates: { icon: '🗑', title: 'Eliminar duplicados', description: 'Elimina líneas duplicadas de archivos de texto.', accepts: 'txts' },
    listToTable: { icon: '📊', title: 'Listas a tablas', description: 'Convierte listas con delimitadores en tablas HTML, CSV o Markdown.', accepts: 'txts' },
    epubToTxt: { icon: '📄', title: 'EPUB a TXT', description: 'Extrae el texto completo de libros EPUB.', accepts: 'epubs' },
    epubToHtml: { icon: '🌐', title: 'EPUB a HTML', description: 'Convierte libros EPUB en archivos HTML.', accepts: 'epubs' },
    epubToMarkdown: { icon: '📋', title: 'EPUB a Markdown', description: 'Convierte libros EPUB en formato Markdown.', accepts: 'epubs' },
    mergeEpub: { icon: '📚', title: 'Unir EPUB', description: 'Combina varios libros EPUB en uno solo.', accepts: 'epubs' },
    splitEpub: { icon: '✂', title: 'Dividir EPUB', description: 'Divide un libro EPUB por capítulos.', accepts: 'epubs' },
    editMetadataEpub: { icon: '🏷', title: 'Editar metadatos EPUB', description: 'Modifica título, autor y otros metadatos de libros EPUB.', accepts: 'epubs' },
    coverEpub: { icon: '🖼', title: 'Extraer portada EPUB', description: 'Extrae la imagen de portada de libros EPUB.', accepts: 'epubs' },
    imagesEpub: { icon: '🖼', title: 'Extraer imágenes EPUB', description: 'Extrae todas las imágenes de libros EPUB.', accepts: 'epubs' },
    validateEpub: { icon: '✅', title: 'Validar EPUB', description: 'Comprueba la estructura y compatibilidad de archivos EPUB.', accepts: 'epubs' },
    repairEpub: { icon: '🔧', title: 'Reparar EPUB', description: 'Intenta corregir problemas comunes en archivos EPUB dañados.', accepts: 'epubs' },
    csvToExcel: { icon: '📊', title: 'CSV a Excel', description: 'Convierte archivos CSV a formato Excel (XLSX) detectando separador y codificación.', accepts: 'csvs' },
    excelToCsv: { icon: '📋', title: 'Excel a CSV', description: 'Exporta hojas de cálculo Excel a CSV con separador y codificación configurables.', accepts: 'excels' },
    excelToJson: { icon: '{ }', title: 'Excel a JSON', description: 'Convierte filas de Excel en objetos JSON con detección automática de tipos.', accepts: 'excels' },
    jsonToExcel: { icon: '📊', title: 'JSON a Excel', description: 'Convierte datos JSON en hojas de cálculo Excel editables.', accepts: 'jsons' },
    csvToJson: { icon: '{ }', title: 'CSV a JSON', description: 'Convierte archivos CSV en JSON con detección automática de separador.', accepts: 'csvs' },
    jsonToCsv: { icon: '📋', title: 'JSON a CSV', description: 'Convierte archivos JSON en CSV con separador configurable.', accepts: 'jsons' },
    xmlToJson: { icon: '{ }', title: 'XML a JSON', description: 'Convierte archivos XML a JSON conservando jerarquía y atributos.', accepts: 'xmls' },
    jsonToXml: { icon: '📄', title: 'JSON a XML', description: 'Convierte datos JSON en XML válido con estructura configurable.', accepts: 'jsons' },
    mergeExcel: { icon: '🔗', title: 'Unir archivos Excel', description: 'Combina múltiples archivos Excel en un solo libro.', accepts: 'excels' },
    splitExcel: { icon: '✂', title: 'Dividir archivo Excel', description: 'Divide un archivo Excel por hojas, filas o rangos.', accepts: 'excels' },
    compareExcel: { icon: '🔍', title: 'Comparar archivos Excel', description: 'Detecta diferencias entre dos archivos Excel celda por celda.', accepts: 'excels' },
    xlsToXlsx: { icon: '🔄', title: 'XLS a XLSX', description: 'Convierte archivos Excel antiguos (XLS) al formato moderno (XLSX).', accepts: 'xls' },
    xlsxToOds: { icon: '📄', title: 'XLSX a ODS', description: 'Convierte archivos Excel al formato OpenDocument Spreadsheet.', accepts: 'xlsx' },
    odsToXlsx: { icon: '📊', title: 'ODS a XLSX', description: 'Convierte archivos LibreOffice Calc al formato Excel (XLSX).', accepts: 'ods' },
    unzipFile: { icon: '📦', title: 'Descomprimir ZIP', description: 'Extrae todos los archivos de un archivo ZIP.', accepts: 'zip' },
    createZipAdvanced: { icon: '📁', title: 'Crear ZIP', description: 'Comprime varios archivos en un solo archivo ZIP.', accepts: 'any' },
    zipRepair: { icon: '🔧', title: 'Reparar ZIP', description: 'Intenta recuperar archivos de un ZIP dañado.', accepts: 'zip' },
    fileSplit: { icon: '✂', title: 'Dividir archivo', description: 'Divide un archivo grande en fragmentos más pequeños.', accepts: 'any' },
    fileJoin: { icon: '🔗', title: 'Unir fragmentos', description: 'Recompone un archivo a partir de sus fragmentos.', accepts: 'parts' },
    checksumFile: { icon: '🔐', title: 'Calcular hash', description: 'Genera hash SHA-1 y SHA-256 para verificar integridad.', accepts: 'any' },
    fileInspector: { icon: '🔍', title: 'Inspector de archivos', description: 'Detecta el tipo real del archivo mediante magic bytes.', accepts: 'any' },
    inspectFileMetadata: { icon: '🔍', title: 'Inspeccionar metadatos de archivo', description: 'Revela la información oculta de un archivo incluyendo metadatos EXIF, PDF, Office, audio y hash SHA-256.', accepts: 'any' },
    encryptDecryptFile: { icon: '🔐', title: 'Cifrar y descifrar archivo', description: 'Protege un archivo con contraseña (AES-GCM-256) y lo descifra sin que la contraseña salga del navegador.', accepts: 'any' },
    pdfEncryptAdvanced: { icon: '🔒', title: 'Proteger PDF', description: 'Añade contraseña y controla permisos del PDF.', accepts: 'pdf' },
    qrGenerate: { icon: '📱', title: 'Generar código QR', description: 'Crea un código QR a partir de texto, URL o datos.', accepts: 'none' },
    qrWifi: { icon: '📶', title: 'QR de Wi-Fi', description: 'Genera un QR para conectar a una red Wi-Fi.', accepts: 'none' },
    qrVcard: { icon: '👤', title: 'QR de contacto', description: 'Genera un QR con información de contacto (vCard).', accepts: 'none' },
    barcodeGenerate: { icon: '||||', title: 'Generar código de barras', description: 'Crea códigos de barras Code128, EAN-13, y más.', accepts: 'none' },
    qrReadFromImage: { icon: '📷', title: 'Leer código QR', description: 'Extrae el contenido de un código QR desde una imagen.', accepts: 'image' },
    barcodeReadFromImage: { icon: '📷', title: 'Leer código de barras', description: 'Analiza una imagen para detectar códigos de barras.', accepts: 'image' },
    qrBatchFromCsv: { icon: '📋', title: 'QR masivo desde CSV', description: 'Genera múltiples códigos QR desde un archivo CSV.', accepts: 'csv' },
    colorPicker: { icon: '🎨', title: 'Selector de color', description: 'Captura el color exacto de cualquier punto con valores HEX, RGB y HSL.', accepts: 'image' },
    imageCompare: { icon: '🔍', title: 'Comparar imágenes', description: 'Compara dos imágenes con deslizador, alternancia, superposición y diferencia.', accepts: 'images' },
    pdfPageCounter: { icon: '📄', title: 'Contar páginas PDF', description: 'Muestra el número de páginas y dimensiones de cada hoja.', accepts: 'pdfs' },
    enhanceScannedDocument: { icon: '⊞', title: 'Mejorar documento escaneado', description: 'Mejora iluminación, contraste y nitidez de documentos escaneados.', accepts: 'image' },
    cameraDocumentScanner: { icon: '📷', title: 'Escanear documento con cámara', description: 'Captura documentos con la cámara y corrige la perspectiva.', accepts: 'none' },
    pdfTablesToExcel: { icon: '📊', title: 'Tablas PDF a Excel', description: 'Extrae tablas de PDFs y exporta a Excel o CSV.', accepts: 'pdfs' },
    imageTableToExcel: { icon: '📊', title: 'Tabla de imagen a Excel', description: 'Reconoce tablas en imágenes con OCR y exporta a Excel.', accepts: 'image' },
    censorPdf: { icon: '▉', title: 'Censurar PDF', description: 'Oculta de forma permanente textos sensibles y elimina metadatos del PDF.', accepts: 'pdf' },
    verifyPdfCensor: { icon: '✓', title: 'Verificar censura PDF', description: 'Comprueba que un PDF censurado no contenga texto recuperable.', accepts: 'pdfs' },
    comparePdfs: { icon: '≟', title: 'Comparar dos PDF', description: 'Detecta diferencias entre dos versiones de un documento PDF.', accepts: 'pdfs' },
    photoLocationExtractor: { icon: '⌖', title: 'Extraer ubicación de foto', description: 'Obtiene coordenadas GPS y metadatos EXIF de una fotografía.', accepts: 'image' },
    formatDocumentApa7: { icon: '¶', title: 'Formato APA 7', description: 'Genera un documento Word con formato académico APA 7.', accepts: 'docs' },
    convertAudio: { icon: '🎵', title: 'Convertir audio', description: 'Convierte archivos de audio entre MP3, WAV, OGG y AAC.', accepts: 'audio' },
    trimAudio: { icon: '✂', title: 'Recortar audio', description: 'Elimina partes no deseadas de archivos de audio.', accepts: 'audio' },
    mergeAudio: { icon: '⊕', title: 'Unir audios', description: 'Combina varios archivos de audio en uno solo.', accepts: 'audios' },
    compressVideo: { icon: '↘', title: 'Comprimir video', description: 'Reduce el tamaño de archivos de video ajustando calidad y resolución.', accepts: 'video' },
    trimVideo: { icon: '✂', title: 'Recortar video', description: 'Elimina partes no deseadas de videos seleccionando inicio y fin.', accepts: 'video' },
    mergeVideos: { icon: '⊕', title: 'Unir videos', description: 'Combina varios videos en uno solo.', accepts: 'videos' },
    videoToGif: { icon: '🎞', title: 'Video a GIF', description: 'Convierte un segmento de video en un GIF animado.', accepts: 'video' },
    extractAudioFromVideo: { icon: '🎵', title: 'Extraer audio de video', description: 'Separa el audio de un video y guárdalo como archivo de audio.', accepts: 'video' },
    removeAudioFromVideo: { icon: '🔇', title: 'Quitar audio de video', description: 'Elimina la pista de audio de un video.', accepts: 'video' },
    textStatistics: { icon: '№', title: 'Estadísticas de texto', description: 'Analiza palabras, caracteres, frases y tiempo de lectura.', accepts: 'text' },
    wordCount: { icon: '≡', title: 'Contar palabras', description: 'Cuenta palabras, caracteres y palabras únicas de un texto.', accepts: 'text' },
    textDiff: { icon: '⇄', title: 'Comparar textos', description: 'Compara dos textos línea por línea y muestra las diferencias.', accepts: 'texts' },
    htmlToMarkdown: { icon: '↓', title: 'HTML a Markdown', description: 'Convierte archivos HTML a formato Markdown.', accepts: 'html' },
    htmlToText: { icon: '¶', title: 'HTML a texto plano', description: 'Extrae el texto visible de un archivo HTML.', accepts: 'html' },
    cssMinifier: { icon: '{}', title: 'Minificar CSS', description: 'Reduce el tamaño de archivos CSS eliminando espacios y comentarios.', accepts: 'css' },
    base64Encode: { icon: 'ⓑ', title: 'Codificar en Base64', description: 'Codifica el contenido de un archivo a Base64.', accepts: 'text' },
    base64Decode: { icon: 'ⓓ', title: 'Decodificar Base64', description: 'Convierte contenido Base64 de vuelta a texto o datos.', accepts: 'text' },
    urlEncode: { icon: '⇈', title: 'Codificar URL', description: 'Codifica el contenido de un archivo para usarlo en una URL.', accepts: 'text' },
    urlDecode: { icon: '⇊', title: 'Decodificar URL', description: 'Convierte contenido codificado de URL de vuelta a texto.', accepts: 'text' },
    csvToMarkdown: { icon: '▦', title: 'CSV a Markdown', description: 'Convierte archivos CSV a tablas Markdown alineadas.', accepts: 'csvs' },
    csvToHtml: { icon: '☰', title: 'CSV a HTML', description: 'Genera una tabla HTML estilizada a partir de un CSV.', accepts: 'csvs' },
    csvToYaml: { icon: '⬛', title: 'CSV a YAML', description: 'Transforma filas CSV en objetos YAML.', accepts: 'csvs' },
    excelToHtml: { icon: '⌘', title: 'Excel a HTML', description: 'Convierte hojas de Excel a tablas HTML estilizadas.', accepts: 'excels' },
    excelToMarkdown: { icon: '▤', title: 'Excel a Markdown', description: 'Exporta hojas de cálculo como tablas Markdown.', accepts: 'excels' },
    xmlToExcel: { icon: '≣', title: 'XML a Excel', description: 'Extrae datos XML y los convierte en una tabla Excel.', accepts: 'xmls' },
    csvStatistics: { icon: '∑', title: 'Estadísticas CSV', description: 'Analiza un CSV y obtiene métricas por columna.', accepts: 'csvs' },
    csvFilter: { icon: '⌖', title: 'Filtrar CSV', description: 'Filtra filas de un CSV por condición de columna.', accepts: 'csvs' },
    csvSort: { icon: '⇅', title: 'Ordenar CSV', description: 'Ordena las filas de un CSV por cualquier columna.', accepts: 'csvs' },
    csvToSql: { icon: '🗄', title: 'CSV a SQL', description: 'Genera CREATE TABLE e INSERT a partir de un CSV.', accepts: 'csvs' },
    jsonFormatter: { icon: '⛁', title: 'Formatear JSON', description: 'Embellece o compacta archivos JSON.', accepts: 'jsons' },
    excelToXml: { icon: '⛃', title: 'Excel a XML', description: 'Exporta hojas de Excel a XML estructurado.', accepts: 'excels' },
    jsonValidator: { icon: '✓', title: 'Validar JSON', description: 'Valida la sintaxis de un archivo JSON con ubicación del error.', accepts: 'jsons' },
    scannedPdfToSearchablePdf: { icon: '🔍', title: 'PDF escaneado a PDF buscable', description: 'Agregaremos una capa de texto invisible al PDF con OCR.', accepts: 'pdfs' },
    imageToSearchablePdf: { icon: '📄', title: 'Imagen a PDF buscable', description: 'Convertiremos la imagen a un PDF con texto seleccionable.', accepts: 'image' },
    extractTextFromScannedPdf: { icon: '📝', title: 'Extraer texto de PDF escaneado', description: 'Extraeremos el texto del PDF escaneado con OCR.', accepts: 'pdfs' },
    detectOcrNeeded: { icon: '🔎', title: 'Detectar si PDF necesita OCR', description: 'Analizaremos el PDF y diremos si necesita OCR.', accepts: 'pdfs' },
  };

  const els = {
    themeToggle: $('#themeToggle'),
    menuToggle: $('#menuToggle'),
    mobileNav: $('#mobileNav'),
    intentInput: $('#intentInput'),
    dropZone: $('#dropZone'),
    fileInput: $('#fileInput'),
    browseButton: $('#browseButton'),
    fileStrip: $('#fileStrip'),
    smartResult: $('#smartResult'),
    smartIcon: $('#smartIcon'),
    smartTitle: $('#smartTitle'),
    smartDescription: $('#smartDescription'),
    changeToolButton: $('#changeToolButton'),
    changeToolResultButton: $('#changeToolResultButton'),
    fileStatus: $('#fileStatus'),
    runButtonLabel: $('#runButtonLabel'),
    advancedPanel: $('#advancedPanel'),
    advancedControls: $('#advancedControls'),
    flowActions: $('#flowActions'),
    runButton: $('#runButton'),
    processFeedback: $('#processFeedback'),
    processFeedbackMessage: $('#processFeedbackMessage'),
    retryButton: $('#retryButton'),
    clearFilesButton: $('#clearFilesButton'),
    toolSearch: $('#toolSearch'),
    emptyTools: $('#emptyTools'),
    workspaceNoticeButton: $('#workspaceNoticeButton'),
    workspaceNoticeDialog: $('#workspaceNoticeDialog'),
    workspaceNoticeClose: $('#workspaceNoticeClose'),
    workspaceNoticeDismiss: $('#workspaceNoticeDismiss'),
    resultDialog: $('#resultDialog'),
    dialogClose: $('#dialogClose'),
    resultTitle: $('#resultTitle'),
    resultMessage: $('#resultMessage'),
    resultStats: $('#resultStats'),
    resultInspector: $('#resultInspector'),
    inspectorInput: $('#inspectorInput'),
    inspectorOutput: $('#inspectorOutput'),
    inspectorRatio: $('#inspectorRatio'),
    inspectorTime: $('#inspectorTime'),
    previewArea: $('#previewArea'),
    downloadButton: $('#downloadButton'),
    resetButton: $('#resetButton'),
    pickerDialog: $('#pickerDialog'),
    pickerClose: $('#pickerClose'),
    pickerGrid: $('#pickerGrid'),
    toast: $('#toast'),
    fileLimitInfo: $('#fileLimitInfo'),
    heroCommandSearch: $('#heroCommandSearch'),
  };

  init();

  function init() {
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('toolisto-theme'); } catch (_) { /* storage may be blocked */ }
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;

    els.themeToggle?.addEventListener('click', toggleTheme);
    els.menuToggle?.addEventListener('click', toggleMenu);
    $$('.mobile-nav a').forEach((a) => a.addEventListener('click', closeMenu));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.mobileNav && !els.mobileNav.hidden) closeMenu();
      const targetTag = event.target?.tagName;
      const isTyping = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable;
      const isCommandShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const isSearchShortcut = event.key === '/' && !isTyping;
      if ((isCommandShortcut || isSearchShortcut) && els.toolSearch) {
        event.preventDefault();
        els.toolSearch.focus();
        els.toolSearch.select();
      }
    });

    document.addEventListener('click', (event) => {
      if (els.mobileNav && !els.mobileNav.hidden && !els.mobileNav.contains(event.target) && els.menuToggle && !els.menuToggle.contains(event.target)) {
        closeMenu();
      }
    });

    els.browseButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      els.fileInput?.click();
    });
    els.dropZone?.addEventListener('click', () => els.fileInput?.click());
    els.dropZone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        els.fileInput?.click();
      }
    });
    els.fileInput?.addEventListener('change', () => addFiles([...els.fileInput.files]));

    ['dragenter', 'dragover'].forEach((name) => els.dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      els.dropZone.classList.add('dragging');
      els.dropZone.classList.remove('drag-rejected');
      if (event.dataTransfer?.types?.includes('Files')) {
        var files = event.dataTransfer.files;
        var currentTool = state.tool || state.forcedTool || null;
        var accepts = currentTool && toolMeta[currentTool] ? toolMeta[currentTool].accepts : null;
        if (files.length > 0 && accepts && accepts !== 'any' && accepts !== 'none') {
          var hasInvalid = false;
          for (var fi = 0; fi < files.length; fi++) {
            if (!fileMatchesAccept(files[fi], state.inputAccept || '')) { hasInvalid = true; break; }
          }
          if (hasInvalid) { els.dropZone.classList.add('drag-rejected'); els.dropZone.classList.remove('dragging'); }
        }
      }
    }));
    ['dragleave', 'drop'].forEach((name) => els.dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragging');
      els.dropZone.classList.remove('drag-rejected');
    }));
    els.dropZone?.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files]));

    window.addEventListener('paste', handlePaste);
    els.intentInput?.addEventListener('input', () => {
      if (!state.forcedTool) updateRecommendation();
    });

    els.changeToolButton?.addEventListener('click', openPicker);
    els.changeToolResultButton?.addEventListener('click', () => { els.resultDialog?.close(); openPicker(); });
    els.pickerClose?.addEventListener('click', () => els.pickerDialog?.close());
    els.dialogClose?.addEventListener('click', () => els.resultDialog?.close());

    const closeWorkspaceNotice = () => els.workspaceNoticeDialog?.close();
    els.workspaceNoticeButton?.addEventListener('click', () => {
      if (typeof els.workspaceNoticeDialog?.showModal === 'function') els.workspaceNoticeDialog.showModal();
      else showToast('Workspace está en implementación y su acceso público está cerrado.');
    });
    els.workspaceNoticeClose?.addEventListener('click', closeWorkspaceNotice);
    els.workspaceNoticeDismiss?.addEventListener('click', closeWorkspaceNotice);

    els.resetButton?.addEventListener('click', resetAll);
    els.downloadButton?.addEventListener('click', downloadResult);
    els.runButton?.addEventListener('click', runCurrentTool);
    els.retryButton?.addEventListener('click', async () => {
      await runCurrentTool();
      if (els.processFeedback && !els.processFeedback.hidden) els.runButton?.focus();
    });
    $$('.copy-tech-btn').forEach((button) => button.addEventListener('click', copyTechnicalDetails));
    els.clearFilesButton?.addEventListener('click', clearSelectedFiles);

    prepareToolCatalog();
    filterTools();

    const heroSuggestions = $('#heroSuggestions');
    let suggestIndex = -1;
    let currentSuggestions = [];

    els.toolSearch?.addEventListener('input', () => {
      filterTools();
      updateSearchClear();
      showSuggestions();
      runSmartSearch();
    });

    els.toolSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.toolSearch.value) {
          els.toolSearch.value = '';
          filterTools();
          updateSearchClear();
          hideSuggestions();
        } else {
          hideSuggestions();
        }
        return;
      }
      if (e.key === 'Enter') {
        if (suggestIndex >= 0 && currentSuggestions[suggestIndex]) {
          window.location.href = currentSuggestions[suggestIndex].href;
        } else {
          hideSuggestions();
          const section = $('#herramientas');
          if (section) section.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateSuggest(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateSuggest(-1);
        return;
      }
      if (e.key === 'Tab') {
        hideSuggestions();
      }
    });

    els.toolSearch?.addEventListener('focus', () => {
      if (els.toolSearch.value.length > 0) showSuggestions();
    });

    els.heroCommandSearch?.addEventListener('click', () => {
      if (!els.toolSearch) return;
      els.toolSearch.focus();
      els.toolSearch.select();
      els.toolSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.addEventListener('click', (e) => {
      const wrap = $('.hero-search-wrap');
      if (wrap && !wrap.contains(e.target)) hideSuggestions();
    });

    const searchClearBtn = $('#searchClear');
    searchClearBtn?.addEventListener('click', () => {
      if (els.toolSearch) els.toolSearch.value = '';
      filterTools();
      updateSearchClear();
      hideSuggestions();
      hideSmartResults();
      els.toolSearch?.focus();
    });

    function updateSearchClear() {
      const btn = $('#searchClear');
      if (btn) {
        const hasText = els.toolSearch && els.toolSearch.value.length > 0;
        btn.hidden = !hasText;
        btn.classList.toggle('visible', hasText);
      }
    }

    function hideSuggestions() {
      if (heroSuggestions) heroSuggestions.hidden = true;
      suggestIndex = -1;
      currentSuggestions = [];
    }

    function navigateSuggest(dir) {
      const items = heroSuggestions?.querySelectorAll('.suggest-item');
      if (!items || items.length === 0) return;
      items.forEach(i => i.classList.remove('active'));
      suggestIndex += dir;
      if (suggestIndex < 0) suggestIndex = items.length - 1;
      if (suggestIndex >= items.length) suggestIndex = 0;
      items[suggestIndex].classList.add('active');
      items[suggestIndex].scrollIntoView({ block: 'nearest' });
    }

    function showSuggestions() {
      if (!heroSuggestions || !els.toolSearch) return;
      const query = els.toolSearch.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (query.length < 2) { hideSuggestions(); return; }

      const categoryNames = { images: 'Imágenes', pdf: 'PDF', signatures: 'Firmas', documents: 'Documentos', text: 'Texto', ebooks: 'EPUB', spreadsheets: 'Hojas de cálculo' };
      const iconColors = { images: 'var(--t-orange)', pdf: 'var(--t-red)', signatures: 'var(--t-purple)', documents: 'var(--t-blue)', text: 'var(--t-green)', ebooks: 'var(--t-amber)', spreadsheets: 'var(--t-blue)' };

      currentSuggestions = [];
      $$('.tool-card').forEach((card) => {
        if (currentSuggestions.length >= 6) return;
        const name = (card.querySelector('strong')?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const desc = (card.querySelector('small')?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const toolId = (card.dataset.tool || '').toLowerCase();
        const href = (card.getAttribute('href') || '').toLowerCase();
        const cat = (card.dataset.category || '').toLowerCase();
        const inputFmt = (card.getAttribute('data-input-formats') || '').toLowerCase();
        const outputFmt = (card.getAttribute('data-output-formats') || '').toLowerCase();
        const keywords = (card.getAttribute('data-keywords') || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const searchable = name + ' ' + desc + ' ' + toolId + ' ' + href + ' ' + cat + ' ' + inputFmt + ' ' + outputFmt + ' ' + keywords;
        if (searchable.includes(query)) {
          currentSuggestions.push({
            name: card.querySelector('strong')?.textContent || '',
            desc: card.querySelector('small')?.textContent || '',
            href: card.getAttribute('href') || '#',
            category: categoryNames[card.dataset.category] || card.dataset.category || '',
            icon: card.querySelector('.tool-icon')?.textContent || '→',
            color: iconColors[card.dataset.category] || 'var(--t-blue)',
            toolId: card.dataset.tool || '',
          });
        }
      });

      if (currentSuggestions.length === 0) {
        heroSuggestions.innerHTML = '<div class="suggest-empty">No se encontraron sugerencias</div>';
        heroSuggestions.hidden = false;
        suggestIndex = -1;
        return;
      }

      heroSuggestions.innerHTML = currentSuggestions.map((s, i) => `
        <a class="suggest-item" href="${escapeHtml(s.href)}" role="option" aria-selected="false" data-index="${i}">
          <span class="suggest-icon" style="background:${escapeHtml(s.color)}">${escapeHtml(s.icon)}</span>
          <span class="suggest-info">
            <span class="suggest-name">${escapeHtml(s.name)}</span>
            <span class="suggest-meta">${escapeHtml(s.category)} · ${escapeHtml(s.desc)}</span>
          </span>
        </a>
      `).join('');

      heroSuggestions.querySelectorAll('.suggest-item').forEach((el) => {
        el.addEventListener('mouseenter', () => {
          heroSuggestions.querySelectorAll('.suggest-item').forEach(i => i.classList.remove('active'));
          el.classList.add('active');
          suggestIndex = parseInt(el.dataset.index, 10);
        });
      });

      heroSuggestions.hidden = false;
      suggestIndex = -1;
    }

    $$('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
      setToolFilter(chip.dataset.filter || 'all');
    }));

    $$('[data-nav-filter]').forEach((link) => link.addEventListener('click', () => {
      setToolFilter(link.dataset.navFilter || 'all');
      closeMenu();
    }));

    function runSmartSearch() {
      const query = els.toolSearch?.value?.trim() || '';
      const results = $('#smartSearchResults');
      if (!results) return;
      if (!query || query.length < 2) { hideSmartResults(); return; }
      if (!window.ToolistoSearch) return;

      if (window.ToolistoSearch._indexLength && window.ToolistoSearch._indexLength() === 0 || !window.ToolistoSearch._indexLength) {
        window.ToolistoSearch.buildIndex();
      }

      const hits = window.ToolistoSearch.search(query);
      if (hits.length === 0) {
        results.innerHTML = '<div class="smart-search-empty"><strong>No encontramos una herramienta exacta para esa búsqueda.</strong>Puedes intentar describirlo de otra manera o explorar las herramientas disponibles.</div>';
        results.hidden = false;
        trackEvent('search_no_results', {});
        return;
      }

      const isHigh = hits[0].confidence === 'high';
      const iconColors = { images: 'var(--t-orange)', pdf: 'var(--t-red)', signatures: 'var(--t-purple)', documents: 'var(--t-blue)', text: 'var(--t-green)', ebooks: 'var(--t-amber)', spreadsheets: 'var(--t-blue)' };
      const categoryNames = window.ToolistoSearch.categoryNames || {};
      const meta = window.ToolistoSearch._index && window.ToolistoSearch._index();

      results.innerHTML = hits.map((hit, i) => {
        const catLabel = categoryNames[hit.category] || hit.category;
        const color = iconColors[hit.category] || 'var(--t-blue)';
        let icon = '→';
        if (meta) {
          const m = meta.find(m => m.toolId === hit.toolId);
          if (m) icon = m.icon || icon;
        }
        const badgeClass = hit.confidence === 'high' ? '' : hit.confidence === 'medium' ? ' medium' : ' low';
        const recLabel = i === 0 && isHigh ? '<span class="smart-search-badge">Herramienta recomendada</span> ' : '';
        const formatInfo = window.ToolistoSearch.formatLabel(hit.inputFmt, hit.outputFmt);
        return `<div class="smart-search-item${i === 0 ? ' recommended' : ''}" data-href="${escapeHtml(hit.href)}" role="link" tabindex="0" aria-label="Abrir ${escapeHtml(hit.name)}">
          <span class="smart-search-icon" style="background:${escapeHtml(color)}">${escapeHtml(icon)}</span>
          <span class="smart-search-info">
            ${recLabel}<span class="smart-search-name">${escapeHtml(hit.name)}</span>
            <span class="smart-search-desc">${escapeHtml(hit.desc)}</span>
            ${formatInfo ? `<span class="smart-search-meta">${escapeHtml(catLabel)} · ${escapeHtml(formatInfo)}</span>` : `<span class="smart-search-meta">${escapeHtml(catLabel)}</span>`}
          </span>
          <span class="smart-search-btn">Usar</span>
        </div>`;
      }).join('');

      results.querySelectorAll('.smart-search-item').forEach(el => {
        const href = el.dataset.href;
        const handler = () => { if (href) window.location.href = href; };
        el.addEventListener('click', handler);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      results.hidden = false;
      trackEvent('search_smart', { confidence: hits[0].confidence, count: hits.length, match: hits[0].toolId });
    }

    function hideSmartResults() {
      const results = $('#smartSearchResults');
      if (results) { results.hidden = true; results.innerHTML = ''; }
    }

    els.toolSearch?.addEventListener('focus', () => {
      if (els.toolSearch.value.length > 0) {
        showSuggestions();
        runSmartSearch();
      }
    });

    document.addEventListener('click', (e) => {
      const wrap = $('.hero-search-wrap');
      if (wrap && !wrap.contains(e.target)) {
        hideSuggestions();
        hideSmartResults();
      }
    });

  }


  function setToolFilter(filter) {
    state.activeFilter = filter;
    $$('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === filter));
    filterTools();
  }

  function prepareToolCatalog() {
    const grid = $('#toolGrid');
    if (!grid || grid.dataset.grouped === 'true') return;
    const cards = [...grid.children].filter((child) => child.matches?.('.tool-card[data-tool]'));
    if (!cards.length) return;

    const labels = {
      images: 'Imágenes', pdf: 'PDF', signatures: 'Firmas', documents: 'Documentos',
      text: 'Texto', ebooks: 'EPUB y MOBI', spreadsheets: 'Hojas de cálculo', files: 'Archivos y seguridad',
      qrcodes: 'QR y códigos', video: 'Video', audio: 'Audio', calculators: 'Calculadoras',
    };
    const icons = {
      images: '🖼', pdf: '📄', signatures: '✍', documents: '📝', text: 'Aa', ebooks: '📚',
      spreadsheets: '▦', files: '📁', qrcodes: '▣', video: '▶', audio: '♫', calculators: '∑',
    };
    const grouped = new Map();
    cards.forEach((card) => {
      const category = card.dataset.category || 'files';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(card);
    });

    const fragment = document.createDocumentFragment();
    [...grouped.entries()].forEach(([category, categoryCards], index) => {
      const details = document.createElement('details');
      details.className = 'tool-group';
      details.dataset.category = category;
      details.open = index < 2;

      const summary = document.createElement('summary');
      summary.className = 'tool-group-summary';
      summary.innerHTML = `<span class="tool-group-icon" aria-hidden="true">${icons[category] || '•'}</span><span class="tool-group-copy"><strong>${labels[category] || category}</strong><small>${categoryCards.length} herramientas</small></span><span class="tool-group-chevron" aria-hidden="true">+</span>`;
      details.appendChild(summary);

      const inner = document.createElement('div');
      inner.className = 'tool-group-grid';
      categoryCards.forEach((card) => inner.appendChild(card));
      details.appendChild(inner);
      fragment.appendChild(details);
    });

    grid.replaceChildren(fragment);
    grid.dataset.grouped = 'true';
    grid.classList.add('tool-catalog-ready');
  }

  function updateToolCatalogGroups(query) {
    $$('#toolGrid .tool-group').forEach((group) => {
      const cards = $$('.tool-card[data-tool]', group);
      const visible = cards.some((card) => !card.hasAttribute('hidden'));
      group.className = visible ? 'tool-group' : 'tool-group is-empty';
      if (visible && (query || state.activeFilter !== 'all')) group.open = true;
    });
  }

  function filterTools() {
    const query = String(els.toolSearch?.value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let visible = 0;

    $$('.tool-card').forEach((card) => {
      const categoryMatches = state.activeFilter === 'all' || card.dataset.category === state.activeFilter;
      const name = (card.querySelector('strong')?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const desc = (card.querySelector('small')?.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const toolId = (card.dataset.tool || '').toLowerCase();
      const href = (card.getAttribute('href') || '').toLowerCase();
      const cat = (card.dataset.category || '').toLowerCase();
      const inputFmt = (card.getAttribute('data-input-formats') || '').toLowerCase();
      const outputFmt = (card.getAttribute('data-output-formats') || '').toLowerCase();
      const keywords = (card.getAttribute('data-keywords') || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const searchable = name + ' ' + desc + ' ' + toolId + ' ' + href + ' ' + cat + ' ' + inputFmt + ' ' + outputFmt + ' ' + keywords;
      const searchMatches = !query || searchable.includes(query);
      card.hidden = !(categoryMatches && searchMatches);
      if (!card.hidden) visible += 1;
    });

    if (els.emptyTools) els.emptyTools.hidden = visible > 0;
    updateToolCatalogGroups(query);
  }

  function clearSelectedFiles() {
    state.files = [];
    state.tool = state.forcedTool || null;
    els.fileInput.value = '';
    renderFiles();
    updateRecommendation();
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('toolisto-theme', next); } catch (_) { /* storage may be blocked */ }
  }

  function toggleMenu() {
    const isOpen = !els.mobileNav.hidden;
    els.mobileNav.hidden = isOpen;
    els.menuToggle.setAttribute('aria-expanded', String(!isOpen));
  }

  function closeMenu() {
    els.mobileNav.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
    els.menuToggle.focus();
  }

  function handlePaste(event) {
    const pasted = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (pasted.length) addFiles(pasted);
  }

  function addFiles(incoming) {
    if (state.toolDisabled) {
      showToast('Esta herramienta está temporalmente en revisión.');
      if (els.fileInput) els.fileInput.value = '';
      return;
    }
    const currentTool = state.tool || state.forcedTool || null;
    const accepts = currentTool && toolMeta[currentTool] ? toolMeta[currentTool].accepts : null;

    if (window.FileLimits && window.FileLimits.validateIncomingFiles) {
      const result = window.FileLimits.validateIncomingFiles({
        incomingFiles: incoming,
        existingFiles: state.files,
        toolId: currentTool,
        accepts: accepts
      });

      result.rejectedFiles.forEach(function(rej) {
        showToast(rej.message);
        if (window.FileLimits.trackRejection) {
          window.FileLimits.trackRejection(currentTool, rej.reason, rej.file.size, null);
        }
      });

      result.warnings.forEach(function(w) {
        showToast(w.message);
      });

      if (!result.acceptedFiles.length) return;
      state.files = [...state.files, ...result.acceptedFiles].slice(0, (result.limits && result.limits.maxFiles) || 20);
      verifyAcceptedSignatures(result.acceptedFiles);
    } else {
      const allowed = incoming.filter((file) => {
        const validType = file.type.startsWith('image/') || file.type === 'application/pdf' || isDocFile(file) || isOdtFile(file) || isRtfFile(file) || isTxtFile(file) || isEpubFile(file) || isMobiFile(file) || isCsvFile(file) || isExcelFile(file) || isOdsFile(file) || isJsonFile(file) || isXmlFile(file) || isVideoFile(file) || isAudioFile(file);
        const validSize = file.size <= 25 * 1024 * 1024;
        if (!validType) {
          const ext = (file.name.split('.').pop() || '').toUpperCase();
          showToast(`${file.name}: formato "${ext}" no compatible con esta herramienta`);
        }
        if (validType && !validSize) showToast(`${file.name}: supera 25 MB`);
        if (validType && state.inputAccept && !fileMatchesAccept(file, state.inputAccept)) {
          const acceptLabel = acceptToLabel(state.inputAccept);
          showToast(`${file.name}: esta herramienta solo acepta ${acceptLabel}`);
          return false;
        }
        return validType && validSize;
      });
      if (!allowed.length) return;
      state.files = [...state.files, ...allowed].slice(0, 20);
    }

    clearProcessFeedback();
    state.inputTotalSize = state.files.reduce(function(s, f) { return s + f.size; }, 0);
    renderFiles();
    updateRecommendation();
  }

  // TLT-041 — Refuerzo por firma interna (magic bytes) sobre la validación
  // MIME/extensión. Los archivos que superan los límites pero declaran una
  // extensión/MIME que no coincide con su contenido real se descartan.
  function verifyAcceptedSignatures(files) {
    if (!window.FileLimits || !window.FileLimits.verifySignature) return;
    files.forEach(function(file) {
      window.FileLimits.verifySignature(file).then(function(res) {
        if (res.ok) return;
        var idx = state.files.indexOf(file);
        if (idx === -1) return;
        state.files.splice(idx, 1);
        showToast(file.name + ': ' + res.reason);
        renderFiles();
        updateRecommendation();
      }).catch(function() {
        // Lectura de cabecera fallida: no bloquear la carga por eso.
      });
    });
  }

  function renderFiles() {
    els.fileStrip.innerHTML = '';
    els.fileStrip.hidden = !state.files.length;

    if (els.fileStatus) {
      const count = state.files.length;
      els.fileStatus.textContent = count === 0
        ? 'Sin archivos seleccionados'
        : count === 1 ? '1 archivo seleccionado' : `${count} archivos seleccionados`;
      els.fileStatus.dataset.hasFiles = count ? 'true' : 'false';
    }

    function imageLabel(f) {
      if (!f.type.startsWith('image/')) return 'IMG';
      var m = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WEBP', 'image/gif': 'GIF', 'image/bmp': 'BMP', 'image/tiff': 'TIFF', 'image/svg+xml': 'SVG', 'image/avif': 'AVIF', 'image/heic': 'HEIC', 'image/heif': 'HEIF', 'image/x-icon': 'ICO' };
      return m[f.type] || 'IMG';
    }

    state.files.forEach((file, index) => {
      const pill = document.createElement('div');
      pill.className = 'file-pill';
      const isDoc = isDocFile(file);
      const isOdt = isOdtFile(file);
      const isRtf = isRtfFile(file);
      const isTxt = isTxtFile(file);
      const isEpub = isEpubFile(file);
      const isMobi = isMobiFile(file);
      const typeLabel = file.type === 'application/pdf' ? 'PDF' : isDoc ? 'DOC' : isOdt ? 'ODT' : isRtf ? 'RTF' : isTxt ? 'TXT' : isEpub ? 'EPUB' : isMobi ? 'MOBI' : isVideoFile(file) ? 'VID' : isAudioFile(file) ? 'AUD' : imageLabel(file);
      pill.innerHTML = `
        <span>${typeLabel}</span>
        <strong title="${escapeHtml(file.name)}">${escapeHtml(shorten(file.name, 24))}</strong>
        <small>${formatBytes(file.size)}</small>
        ${index > 0 ? `<button type="button" data-action="up" aria-label="Mover ${escapeHtml(file.name)} hacia atrás">←</button>` : ''}
        ${index < state.files.length - 1 ? `<button type="button" data-action="down" aria-label="Mover ${escapeHtml(file.name)} hacia delante">→</button>` : ''}
        <button type="button" data-action="remove" aria-label="Quitar ${escapeHtml(file.name)}">×</button>
      `;
      pill.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = event.target.dataset.action;
        if (!action) return;
        if (action === 'remove') state.files.splice(index, 1);
        if (action === 'up' && index > 0) [state.files[index - 1], state.files[index]] = [state.files[index], state.files[index - 1]];
        if (action === 'down' && index < state.files.length - 1) [state.files[index + 1], state.files[index]] = [state.files[index], state.files[index + 1]];
        renderFiles();
        updateRecommendation();
      });
      els.fileStrip.appendChild(pill);
    });

    if (els.clearFilesButton) els.clearFilesButton.hidden = !state.files.length;

    if (window.FileLimits && state.tool && toolMeta[state.tool]) {
      const limits = window.FileLimits.getToolFileLimits(state.tool, toolMeta[state.tool].accepts);
      const totalSize = state.files.reduce(function(sum, f) { return sum + f.size; }, 0);
      const limitEl = document.getElementById('fileLimitInfo');
      if (limitEl) {
        const totalFormatted = window.FileLimits.formatFileSize(totalSize);
        const maxFormatted = window.FileLimits.formatFileSize(limits.maxTotalSize);
        limitEl.textContent = totalFormatted + ' / ' + maxFormatted;
        limitEl.hidden = false;
        if (totalSize > limits.maxTotalSize * 0.8) {
          limitEl.style.color = 'var(--c-error, #ef4444)';
        } else {
          limitEl.style.color = '';
        }
      }
    }
  }

  function updateRecommendation() {
    if (!state.files.length) {
      state.tool = state.forcedTool || null;
      els.smartResult.hidden = true;
      els.advancedPanel.hidden = true;
      if (els.flowActions) els.flowActions.hidden = true;
      els.runButton.disabled = true;
      els.advancedControls.innerHTML = '';
      const limitInfoEl = document.getElementById('fileLimitInfo');
      if (limitInfoEl) limitInfoEl.hidden = true;
      if (window.FileLimits && window.FileLimits.cleanupProcessingResources) {
        window.FileLimits.cleanupProcessingResources();
      }
      return;
    }

    const recommended = state.forcedTool || inferTool(els.intentInput.value, state.files);
    if (!recommended) {
      showToast('No reconocí la intención. Selecciona una herramienta del catálogo o describe la operación de otra forma.');
      return;
    }
    chooseTool(recommended, Boolean(state.forcedTool));
  }

  function inferTool(intent, files) {
    const q = intent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const images = files.filter((file) => file.type.startsWith('image/'));
    const pdfs = files.filter((file) => file.type === 'application/pdf');
    const csvs = files.filter(isCsvFile);

    if (/firma|rubrica|fondo transparente|quitar fondo/.test(q) && images.length) return 'signature';
    if (/firmar pdf|firma pdf|sign/.test(q) && pdfs.length) return 'signPdf';
    if (/pasaporte|visa|dni|carnet|documento|id photo|foto carnet|licencia/.test(q) && images.length) return 'docPhoto';
    if (/censurar|ocultar|pixelar|desenfocar|sensible|borrar dato/.test(q) && images.length) return 'censor';
    if (/reparar|corregir extension|formato incorrecto|extensión mal/.test(q) && images.length) return 'fixFormat';
    if (/rescatar|documento fotografiado|mejorar documento|escaneo|foto del doc/.test(q) && images.length) return 'rescueDoc';
    if (/cumplir|requisitos|validar|valida|requisito/.test(q) && images.length) return 'fileCompliance';
    if (/flujo|cadena|varias operaciones|pipeline|workfl/.test(q) && images.length) return 'workflow';
    if (/conversor avanzado|convertir y redimensionar|batch convert/.test(q) && images.length) return 'advancedConvert';
    if (/recort|redimension|tamano|dimension|tiktok|reel|historia|2x2|35x45|pasaporte|visa|perfil/.test(q) && images.length) return 'crop';
    if (/convert|pasar a|webp|png|jpg|jpeg|formato/.test(q) && images.length) return 'convert';
    if (/unir|combinar|juntar|fusionar|ordenar pdf/.test(q) && pdfs.length) return 'mergePdf';
    if (/girar|rotar|voltear|orientacion|rotacion/.test(q) && pdfs.length) return 'rotatePdf';
    if (/eliminar.*pagina|borrar.*pagina|quitar.*pagina|suprimir/.test(q) && pdfs.length) return 'deletePagesPdf';
    if (/invertir.*orden|revertir|al reves|orden inverso/.test(q) && pdfs.length) return 'reversePagesPdf';
    if (/duplicar|copiar.*pagina|repetir/.test(q) && pdfs.length) return 'duplicatePagesPdf';
    if (/insertar.*blanco|agregar.*blanco|pagina en blanco|añadir.*blanco/.test(q) && pdfs.length) return 'insertBlankPagesPdf';
    if (/metadatos|titulo|autor|propiedades|info|informacion.*pdf/.test(q) && pdfs.length) return 'editMetadataPdf';
    if (/comprim|optimizar|reducir.*tamaño|peso|ligero|quitar.*metadatos/.test(q) && pdfs.length) return 'compressPdf';
    if (/intercalar|alternar|juntar.*dos|mezclar.*paginas/.test(q) && pdfs.length >= 2) return 'interleavePdf';
    if (/recortar|margenes|sangria|recorte/.test(q) && pdfs.length) return 'cropPdf';
    if (/tamaño.*página|paginas.*tamaño|resize|a4|letter|legal|redimensionar.*pdf/.test(q) && pdfs.length) return 'resizePdfPages';
    if (/varias.*hoja|nup|dos.*hoja|cuatro.*hoja|hoja.*varias|2up|4up|agrupar.*paginas/.test(q) && pdfs.length) return 'nUpPdf';
    if (/dividir.*doble|páginas dobles|split double|cortar.*doble|dos.*columna|dos por hoja/.test(q) && pdfs.length) return 'splitDoublePdf';
    if (/cuadernillo|booklet|folleto|impresión.*doble|pliego/.test(q) && pdfs.length) return 'bookletPdf';
    if (/marca.*agua|watermark|borrador|sello|confidencial|draft/.test(q) && pdfs.length) return 'watermarkPdf';
    if (/numerar.*pág|número.*pág|page number|paginación|numeración/.test(q) && pdfs.length) return 'addPageNumbersPdf';
    if (/encabezado|pie.*pág|header.*footer|cabecera/.test(q) && pdfs.length) return 'addHeaderFooterPdf';
    if (/crear pdf|imagenes a pdf|fotos a pdf|escaneo/.test(q) && images.length) return 'imagesPdf';
    if (/reduc|comprim|menos de|kb|mb|peso|liger/.test(q) && images.length) return 'compress';

    if (/qr|código qr|code qr/.test(q) && !files.length) return 'qrGenerate';
    if (/wifi|wi-fi|red.*wifi/.test(q) && !files.length) return 'qrWifi';
    if (/contacto|vcard|tarjeta/.test(q) && !files.length) return 'qrVcard';
    if (/barcode|código de barras|ean|upc|code128/.test(q) && !files.length) return 'barcodeGenerate';
    if (/leer qr|escanear qr|decodificar qr|qr desde imagen/.test(q) && images.length) return 'qrReadFromImage';
    if (/leer.*barras|escanear.*barras|decodificar.*barras/.test(q) && images.length) return 'barcodeReadFromImage';
    if (/qr.*csv|qr.*lote|qr.*masivo|múltiples qr/.test(q) && csvs.length) return 'qrBatchFromCsv';
    if (/extraer.*colores|paleta|colores dominantes|color picker/.test(q) && images.length) return 'colorPicker';
    if (/comparar.*imágen|diferencias|diff/.test(q) && images.length >= 2) return 'imageCompare';
    if (/descomprimir|unzip|extraer.*zip/.test(q) && files.length) return 'unzipFile';
    if (/crear.*zip|comprimir.*zip|empaquetar/.test(q) && files.length) return 'createZipAdvanced';
    if (/reparar.*zip|zip.*dañado|zip.*corrupto/.test(q) && files.length) return 'zipRepair';
    if (/dividir.*archivo|partir.*archivo|fragmentar/.test(q) && files.length) return 'fileSplit';
    if (/unir.*fragmentos|juntar.*partes|recomponer/.test(q) && files.length) return 'fileJoin';
    if (/hash|checksum|verificar.*integridad|sha/.test(q) && files.length) return 'checksumFile';
    if (/inspeccionar.*archivo|analizar.*archivo|magic bytes|detectar.*tipo/.test(q) && files.length) return 'fileInspector';
    if (/cifrar.*archivo|descifrar.*archivo|encriptar.*archivo|desencriptar.*archivo|proteger.*archivo.*contraseña|archivo.*contraseña/.test(q) && files.length) return 'encryptDecryptFile';
    if (/proteger.*pdf|contraseña.*pdf|cifrar.*pdf|bloquear.*pdf/.test(q) && pdfs.length) return 'pdfEncryptAdvanced';
    if (/contar.*páginas|cuántas.*páginas|número.*páginas.*pdf|info.*pdf/.test(q) && pdfs.length) return 'pdfPageCounter';

    if (/mejorar.*escaneo|mejorar.*documento.*escaneo|documento.*escaneado|mejorar.*scan/.test(q) && images.length) return 'enhanceScannedDocument';
    if (/escanear.*camara|escanear.*documento|capturar.*documento|foto.*documento/.test(q) && !files.length) return 'cameraDocumentScanner';
    if (/tablas.*pdf.*excel|extraer.*tablas.*pdf|pdf.*tabla.*excel/.test(q) && pdfs.length) return 'pdfTablesToExcel';
    if (/tabla.*imagen.*excel|ocr.*imagen.*excel|imagen.*tabla.*excel/.test(q) && images.length) return 'imageTableToExcel';
    if (/convertir.*audio|audio.*mp3|audio.*wav|audio.*ogg|audio.*aac/.test(q) && files.some(isAudioFile)) return 'convertAudio';
    if (/recortar.*audio|cortar.*audio|audio.*recort/.test(q) && files.some(isAudioFile)) return 'trimAudio';
    if (/unir.*audio|combinar.*audio|audio.*unir/.test(q) && files.some(isAudioFile)) return 'mergeAudio';
    if (/comprimir.*video|video.*peso|video.*tamaño|reducir.*video/.test(q) && files.some(isVideoFile)) return 'compressVideo';
    if (/recortar.*video|cortar.*video|video.*recort/.test(q) && files.some(isVideoFile)) return 'trimVideo';
    if (/unir.*video|combinar.*video|video.*unir/.test(q) && files.some(isVideoFile)) return 'mergeVideos';
    if (/video.*gif|gif.*video|convertir.*gif/.test(q) && files.some(isVideoFile)) return 'videoToGif';
    if (/extraer.*audio.*video|separar.*audio|audio.*video.*extraer/.test(q) && files.some(isVideoFile)) return 'extractAudioFromVideo';
    if (/quitar.*audio.*video|eliminar.*audio.*video|sin.*audio|video.*mudo|silenciar/.test(q) && files.some(isVideoFile)) return 'removeAudioFromVideo';

    if (pdfs.length >= 2 && /pdf/.test(q)) return 'mergePdf';
    return '';
  }

  function chooseTool(tool, forced = false) {
    state.tool = tool;
    state.forcedTool = forced ? tool : null;
    window.__selectedTool = tool;
    const meta = toolMeta[tool] || { icon: '→', title: 'Procesar archivos', description: 'Prepararemos el resultado en tu navegador.' };
    const hasFiles = state.files.length > 0;
    // Los inicializadores PDF leen el archivo inmediatamente para preparar sus
    // controles. Resolvemos sus motores sólo tras seleccionar un archivo.
    if (hasFiles && PDF_INITIALIZER_TOOLS.has(tool) && (!window.PDFLib || (PDF_RENDERER_TOOLS.has(tool) && !window.pdfjsLib) || (ARCHIVE_PROCESSOR_TOOLS.has(tool) && !window.JSZip))) {
      ensureToolDependencies(tool).then(() => {
        if (state.tool === tool) chooseTool(tool, forced);
      }).catch((error) => {
        els.smartDescription.textContent = error?.message || 'No se pudieron cargar los componentes del PDF.';
      });
      return;
    }
    els.smartResult.hidden = !hasFiles;
    els.advancedPanel.hidden = !hasFiles;
    if (els.flowActions) els.flowActions.hidden = !hasFiles;
    els.smartIcon.textContent = meta.icon;
    els.smartTitle.textContent = meta.title;
    els.smartDescription.textContent = meta.description;
    if (els.runButtonLabel) els.runButtonLabel.textContent = meta.title;
    renderAdvancedControls(tool, hasFiles);
    applyPagePreset();
    if (window.FileLimits) {
      const limits = window.FileLimits.getToolFileLimits(tool, meta.accepts);
      const limitEl = document.getElementById('fileLimitInfo');
      if (limitEl) {
        limitEl.textContent = 'Límite: ' + window.FileLimits.formatFileSize(limits.maxFileSize) + ' por archivo · ' + window.FileLimits.formatFileSize(limits.maxTotalSize) + ' total';
        limitEl.hidden = false;
        limitEl.style.color = '';
      }
    }
    if (tool === 'cameraDocumentScanner') {
      setTimeout(() => {
        const camBtn = document.getElementById('cameraCaptureBtn');
        if (camBtn) {
          camBtn.addEventListener('click', () => {
            const camInput = document.createElement('input');
            camInput.type = 'file';
            camInput.accept = 'image/*';
            camInput.capture = 'environment';
            camInput.addEventListener('change', () => {
              if (camInput.files.length) addFiles([...camInput.files]);
            });
            camInput.click();
          });
        }
      }, 0);
    }
    const validation = validateToolFiles(tool, state.files);
    els.runButton.disabled = !validation.ok;
    if (!validation.ok) els.smartDescription.textContent = validation.message;
    if (window.FileLimits && state.files.length) {
      var totalSize = state.files.reduce(function(s,f){return s+f.size},0);
      var sizeBucket = window.FileLimits.getSizeBucket(totalSize);
      trackEvent('file_limits_resolved', { tool: tool, profile: window.FileLimits.TOOL_PROFILE[tool] || 'default', size_bucket: sizeBucket, device: window.FileLimits.getDeviceCapabilities().deviceClass });
    }
  }

  function validateToolFiles(tool, files) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    const pdfs = files.filter((file) => file.type === 'application/pdf');
    const docs = files.filter(isDocFile);
    const odtFiles = files.filter(isOdtFile);
    const rtfFiles = files.filter(isRtfFile);
    const txtFiles = files.filter(isTxtFile);
    const epubFiles = files.filter(isEpubFile);
    const csvs = files.filter(isCsvFile);
    const excelFiles = files.filter(isExcelFile);
    const odsFiles = files.filter(isOdsFile);
    const jsonFiles = files.filter(isJsonFile);
    const xmlFiles = files.filter(isXmlFile);
    if (!files.length) return { ok: false, message: 'Selecciona al menos un archivo.' };
    const docTools = ['wordToPdf','wordToJpg','wordToPng','wordToTxt','wordToHtml','wordToMarkdown','wordToEpub','wordToOdt','mergeWord','splitWord','repairWord','compressWord','stripMetadataWord','formatDocument','tocWord','extractWord','findReplaceWord','tablesWordToExcel','removeBlankPagesWord'];
    if (docTools.includes(tool)) {
      if (docs.length !== files.length || docs.length < 1) return { ok: false, message: 'Selecciona uno o varios documentos Word (DOC o DOCX).' };
    }
    if (tool === 'odtToWord') {
      if (odtFiles.length !== files.length || odtFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos ODT.' };
    }
    if (tool === 'rtfToWord') {
      if (rtfFiles.length !== files.length || rtfFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos RTF.' };
    }
    const txtTools = ['txtToPdf','txtToEpub','mergeTxt','splitTxt','sortLines','removeDuplicates','listToTable'];
    if (txtTools.includes(tool)) {
      if (txtFiles.length !== files.length || txtFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos TXT.' };
    }
    const textInputTools = ['textStatistics','wordCount','base64Encode','base64Decode','urlEncode','urlDecode'];
    if (textInputTools.includes(tool)) {
      if (files.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo.' };
      const f = files[0];
      const isTextLike = isTxtFile(f) || isDocFile(f) || f.type === 'application/pdf' || isHtmlFile(f) || isCssFile(f) || isRtfFile(f) || isOdtFile(f) || isEpubFile(f);
      if (!isTextLike) return { ok: false, message: 'Selecciona un archivo de texto, DOCX, PDF, HTML, RTF, ODT o EPUB.' };
    }
    if (tool === 'textDiff') {
      if (files.length !== 2) return { ok: false, message: 'Selecciona exactamente dos archivos de texto para comparar.' };
    }
    const htmlTools = ['htmlToMarkdown','htmlToText'];
    if (htmlTools.includes(tool)) {
      if (files.length !== 1 || !isHtmlFile(files[0])) return { ok: false, message: 'Selecciona exactamente un archivo HTML.' };
    }
    if (tool === 'cssMinifier') {
      if (files.length !== 1 || !isCssFile(files[0])) return { ok: false, message: 'Selecciona exactamente un archivo CSS.' };
    }
    const epubTools = ['epubToTxt','epubToHtml','epubToMarkdown','mergeEpub','splitEpub','editMetadataEpub','coverEpub','imagesEpub','validateEpub','repairEpub'];
    if (epubTools.includes(tool)) {
      if (epubFiles.length !== files.length || epubFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos EPUB.' };
    }
    if (['compress', 'signature', 'crop', 'removeObjects', 'socialCrop'].includes(tool) && images.length !== 1) return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
    if (tool === 'imageCompare' && images.length !== 2) return { ok: false, message: 'Selecciona exactamente dos imágenes para comparar.' };
    if (tool === 'convert' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    if (tool === 'batchCompress' && (images.length !== files.length || images.length < 1 || images.length > 30)) return { ok: false, message: 'Selecciona entre 1 y 30 imágenes.' };
    if (tool === 'stripMetadata' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    if (tool === 'imagesPdf' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    if (tool === 'mergePdf' && (pdfs.length !== files.length || pdfs.length < 1)) return { ok: false, message: 'Selecciona uno o varios archivos PDF.' };
    if (['splitPdf', 'reorderPdf', 'pdfToImages'].includes(tool) && (pdfs.length !== 1)) return { ok: false, message: 'Selecciona exactamente un archivo PDF.' };
    if (tool === 'signPdf' && (pdfs.length !== 1)) return { ok: false, message: 'Selecciona exactamente un archivo PDF.' };
    const singlePdfTools = ['rotatePdf', 'deletePagesPdf', 'reversePagesPdf', 'duplicatePagesPdf', 'insertBlankPagesPdf', 'editMetadataPdf', 'compressPdf', 'cropPdf', 'resizePdfPages', 'nUpPdf', 'splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf'];
    if (singlePdfTools.includes(tool) && (pdfs.length !== 1)) return { ok: false, message: 'Selecciona exactamente un archivo PDF.' };
    if (tool === 'interleavePdf' && (pdfs.length !== 2)) return { ok: false, message: 'Selecciona exactamente dos archivos PDF para intercalar.' };
    if (['docPhoto', 'censor', 'fixFormat', 'rescueDoc', 'fileCompliance'].includes(tool) && images.length !== 1) return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
    if (tool === 'workflow' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    if (tool === 'advancedConvert' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    const csvTools = ['csvToExcel', 'csvToJson'];
    if (csvTools.includes(tool)) {
      if (csvs.length !== files.length || csvs.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos CSV.' };
    }
    const excelTools = ['excelToCsv', 'excelToJson', 'mergeExcel', 'splitExcel', 'compareExcel'];
    if (excelTools.includes(tool)) {
      if (excelFiles.length !== files.length || excelFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos Excel (XLS o XLSX).' };
    }
    if (tool === 'xlsToXlsx') {
      if (!files.every(f => /\.xls$/i.test(f.name))) return { ok: false, message: 'Selecciona archivos XLS.' };
    }
    if (tool === 'xlsxToOds') {
      if (!files.every(f => /\.xlsx$/i.test(f.name))) return { ok: false, message: 'Selecciona archivos XLSX.' };
    }
    if (tool === 'odsToXlsx') {
      if (odsFiles.length !== files.length || odsFiles.length < 1) return { ok: false, message: 'Selecciona archivos ODS.' };
    }
    const jsonTools = ['jsonToExcel', 'jsonToCsv', 'jsonToXml'];
    if (jsonTools.includes(tool)) {
      if (jsonFiles.length !== files.length || jsonFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos JSON.' };
    }
    if (tool === 'xmlToJson') {
      if (xmlFiles.length !== files.length || xmlFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos XML.' };
    }
    if (tool === 'unzipFile') {
      if (files.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo ZIP.' };
      if (!/\.zip$/i.test(files[0].name)) return { ok: false, message: 'El archivo debe ser un ZIP.' };
    }
    if (tool === 'createZipAdvanced') {
      if (files.length < 1) return { ok: false, message: 'Selecciona al menos un archivo para comprimir.' };
    }
    if (tool === 'zipRepair') {
      if (files.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo ZIP dañado.' };
    }
    if (tool === 'fileSplit') {
      if (files.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo para dividir.' };
    }
    if (tool === 'fileJoin') {
      if (files.length < 2) return { ok: false, message: 'Selecciona al menos dos fragmentos para unir.' };
    }
    if (tool === 'checksumFile') {
      if (files.length < 1) return { ok: false, message: 'Selecciona al menos un archivo.' };
    }
    if (tool === 'fileInspector') {
      if (files.length < 1) return { ok: false, message: 'Selecciona al menos un archivo para analizar.' };
    }
    if (tool === 'pdfEncryptAdvanced') {
      if (pdfs.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo PDF.' };
    }
    if (['scannedPdfToSearchablePdf', 'extractTextFromScannedPdf', 'detectOcrNeeded'].includes(tool)) {
      if (pdfs.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo PDF.' };
    }
    if (tool === 'imageToSearchablePdf') {
      if (images.length !== files.length || images.length < 1) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    }
    if (tool === 'qrReadFromImage') {
      if (images.length !== 1) return { ok: false, message: 'Selecciona exactamente una imagen con un código QR.' };
    }
    if (tool === 'barcodeReadFromImage') {
      if (images.length !== 1) return { ok: false, message: 'Selecciona exactamente una imagen con código de barras.' };
    }
    if (tool === 'qrBatchFromCsv') {
      if (files.length !== 1 || !isCsvFile(files[0])) return { ok: false, message: 'Selecciona exactamente un archivo CSV.' };
    }
    if (tool === 'colorPicker') {
      if (images.length !== 1) return { ok: false, message: 'Selecciona exactamente una imagen para extraer colores.' };
    }
    if (tool === 'imageCompare') {
      if (files.length !== 2) return { ok: false, message: 'Selecciona exactamente dos imágenes para comparar.' };
      if (images.length !== 2) return { ok: false, message: 'Ambos archivos deben ser imágenes.' };
    }
    if (tool === 'pdfPageCounter') {
      if (pdfs.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos PDF.' };
    }
    if (tool === 'enhanceScannedDocument') {
      if (images.length !== 1) return { ok: false, message: 'Selecciona exactamente una imagen del documento.' };
    }
    if (tool === 'cameraDocumentScanner') {
      if (files.length !== 1) return { ok: false, message: 'Selecciona una imagen del documento.' };
    }
    if (tool === 'pdfTablesToExcel') {
      if (pdfs.length !== files.length || pdfs.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos PDF.' };
    }
    if (tool === 'imageTableToExcel') {
      if (images.length !== 1) return { ok: false, message: 'Selecciona exactamente una imagen con una tabla.' };
    }
    if (tool === 'censorPdf') {
      if (pdfs.length !== 1) return { ok: false, message: 'Selecciona exactamente un archivo PDF.' };
    }
    if (tool === 'verifyPdfCensor' || tool === 'comparePdfs') {
      if (pdfs.length !== 2) return { ok: false, message: 'Selecciona exactamente dos PDFs para comparar.' };
    }
    if (tool === 'photoLocationExtractor') {
      if (images.length !== 1) return { ok: false, message: 'Selecciona exactamente una imagen JPEG.' };
    }
    const audioTools = ['trimAudio', 'convertAudio'];
    if (audioTools.includes(tool)) {
      if (files.length !== 1 || !isAudioFile(files[0])) return { ok: false, message: 'Selecciona exactamente un archivo de audio.' };
    }
    if (tool === 'mergeAudio') {
      if (files.length < 2 || !files.every(isAudioFile)) return { ok: false, message: 'Selecciona al menos dos archivos de audio.' };
    }
    const videoTools = ['compressVideo', 'trimVideo', 'videoToGif', 'extractAudioFromVideo', 'removeAudioFromVideo'];
    if (videoTools.includes(tool)) {
      if (files.length !== 1 || !isVideoFile(files[0])) return { ok: false, message: 'Selecciona exactamente un archivo de video.' };
    }
    if (tool === 'mergeVideos') {
      if (files.length < 2 || !files.every(isVideoFile)) return { ok: false, message: 'Selecciona al menos dos archivos de video.' };
    }
    return { ok: true, message: '' };
  }

  function availableTools() {
    const images = state.files.filter((file) => file.type.startsWith('image/'));
    const pdfs = state.files.filter((file) => file.type === 'application/pdf');
    const docs = state.files.filter(isDocFile);
    const odtFiles = state.files.filter(isOdtFile);
    const rtfFiles = state.files.filter(isRtfFile);
    const txtFiles = state.files.filter(isTxtFile);
    const epubFiles = state.files.filter(isEpubFile);
    const csvs = state.files.filter(isCsvFile);
    const excelFiles = state.files.filter(isExcelFile);
    const odsFiles = state.files.filter(isOdsFile);
    const jsonFiles = state.files.filter(isJsonFile);
    const xmlFiles = state.files.filter(isXmlFile);
    const tools = [];
    if (images.length === 1 && pdfs.length === 0) tools.push('compress', 'signature', 'crop', 'convert', 'imagesPdf', 'removeObjects', 'socialCrop', 'docPhoto', 'censor', 'fixFormat', 'rescueDoc', 'fileCompliance');
    if (images.length > 1 && pdfs.length === 0) tools.push('imagesPdf', 'convert', 'batchCompress', 'stripMetadata', 'workflow', 'advancedConvert');
    if (pdfs.length && images.length === 0) tools.push('mergePdf', 'splitPdf', 'reorderPdf', 'pdfToImages', 'signPdf', 'rotatePdf', 'deletePagesPdf', 'reversePagesPdf', 'duplicatePagesPdf', 'insertBlankPagesPdf', 'editMetadataPdf', 'compressPdf', 'cropPdf', 'resizePdfPages', 'nUpPdf', 'splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf');
    if (pdfs.length >= 2 && images.length === 0) tools.push('interleavePdf');
    if (docs.length === 1 && images.length === 0 && pdfs.length === 0 && txtFiles.length === 0 && epubFiles.length === 0) tools.push('wordToPdf','wordToJpg','wordToPng','wordToTxt','wordToHtml','wordToMarkdown','wordToEpub','wordToOdt','splitWord','repairWord','compressWord','stripMetadataWord','formatDocument','tocWord','extractWord','findReplaceWord','tablesWordToExcel','removeBlankPagesWord');
    if (docs.length > 1 && images.length === 0 && pdfs.length === 0) tools.push('mergeWord','findReplaceWord','tablesWordToExcel');
    if (odtFiles.length >= 1) tools.push('odtToWord');
    if (rtfFiles.length >= 1) tools.push('rtfToWord');
    if (txtFiles.length === 1) tools.push('txtToPdf','txtToEpub','splitTxt','sortLines','removeDuplicates','listToTable');
    if (txtFiles.length > 1) tools.push('mergeTxt');
    if (files.length === 1 && txtFiles.length === 1) tools.push('textStatistics','wordCount','base64Encode','base64Decode','urlEncode','urlDecode');
    if (files.length === 1 && !txtFiles.length && !images.length && !pdfs.length && !docs.length && !epubFiles.length && !excelFiles.length && !csvs.length && !jsonFiles.length && !xmlFiles.length && !isSpreadsheetFile(files[0]) && !isVideoFile(files[0]) && !isAudioFile(files[0]) && (isHtmlFile(files[0]) || isCssFile(files[0]))) tools.push('textStatistics','wordCount');
    if (files.length === 1 && docs.length === 1 && images.length === 0 && pdfs.length === 0) tools.push('textStatistics','wordCount');
    if (files.length === 1 && pdfs.length === 1 && images.length === 0) tools.push('textStatistics','wordCount');
    if (files.length === 1 && rtfFiles.length === 1) tools.push('textStatistics','wordCount');
    if (files.length === 1 && isOdtFile(files[0])) tools.push('textStatistics','wordCount');
    if (files.length === 1 && epubFiles.length === 1) tools.push('textStatistics','wordCount');
    if (files.length === 2 && txtFiles.length === 2) tools.push('textDiff');
    if (files.length === 1 && isHtmlFile(files[0])) tools.push('htmlToMarkdown','htmlToText');
    if (files.length === 1 && isCssFile(files[0])) tools.push('cssMinifier');
    if (epubFiles.length === 1) tools.push('epubToTxt','epubToHtml','epubToMarkdown','mergeEpub','splitEpub','editMetadataEpub','coverEpub','imagesEpub','validateEpub','repairEpub');
    if (epubFiles.length > 1) tools.push('mergeEpub');
    if (csvs.length >= 1 && excelFiles.length === 0 && jsonFiles.length === 0 && xmlFiles.length === 0) tools.push('csvToExcel', 'csvToJson');
    if (excelFiles.length === 1 && csvs.length === 0 && jsonFiles.length === 0) tools.push('excelToCsv', 'excelToJson', 'splitExcel', 'xlsToXlsx');
    if (excelFiles.length === 1 && excelFiles[0].name.endsWith('.xlsx')) tools.push('xlsxToOds');
    if (excelFiles.length > 1) tools.push('mergeExcel', 'compareExcel');
    if (odsFiles.length >= 1 && excelFiles.length === 0) tools.push('odsToXlsx');
    if (jsonFiles.length >= 1 && csvs.length === 0 && excelFiles.length === 0) tools.push('jsonToExcel', 'jsonToCsv', 'jsonToXml');
    if (xmlFiles.length >= 1 && csvs.length === 0 && excelFiles.length === 0 && jsonFiles.length === 0) tools.push('xmlToJson');
    if (files.length >= 1) tools.push('checksumFile', 'fileInspector');
    if (files.length >= 1 && files.length <= 1) tools.push('fileSplit');
    if (files.length >= 2) tools.push('createZipAdvanced');
    if (files.length >= 2 && files.every(function(f) { return /part\d+/.test(f.name); })) tools.push('fileJoin');
    if (images.length === 1) tools.push('qrReadFromImage', 'barcodeReadFromImage', 'colorPicker');
    if (images.length === 2) tools.push('imageCompare');
    if (pdfs.length >= 1) tools.push('pdfPageCounter');
    if (images.length === 1) tools.push('enhanceScannedDocument', 'imageTableToExcel');
    if (files.length === 1) tools.push('cameraDocumentScanner');
    if (pdfs.length >= 1) tools.push('pdfTablesToExcel');
    if (files.some(isAudioFile) && files.filter(isAudioFile).length === files.length) {
      tools.push('convertAudio');
      if (files.length === 1) tools.push('trimAudio');
      if (files.length >= 2) tools.push('mergeAudio');
    }
    if (files.some(isVideoFile) && files.filter(isVideoFile).length === files.length) {
      if (files.length === 1) tools.push('compressVideo', 'trimVideo', 'videoToGif', 'extractAudioFromVideo', 'removeAudioFromVideo');
      if (files.length >= 2) tools.push('mergeVideos');
    }
    return tools;
  }

  function openPicker() {
    els.pickerGrid.innerHTML = '';
    availableTools().forEach((tool) => {
      const meta = toolMeta[tool];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker-option';
      button.innerHTML = `<strong>${meta.icon} ${meta.title}</strong><span>${meta.description}</span>`;
      button.addEventListener('click', () => {
        chooseTool(tool, true);
        els.pickerDialog.close();
      });
      els.pickerGrid.appendChild(button);
    });
    els.pickerDialog.showModal();
  }

  function renderAdvancedControls(tool, hasFiles = false) {
    const original = state.files[0]?.size || 0;
    const suggestedKb = Math.max(150, Math.min(1200, Math.round((original / 1024) * 0.58)));
    const targetFromIntent = parseTargetKb(els.intentInput.value);

    const htmlByTool = {
      compress: `
        ${controlSelect('compressPreset', 'Modo de compresión', [['auto','Automático — recomendado'],['quality','Máxima calidad'],['balanced','Equilibrado'],['max','Máxima reducción'],['custom','Personalizado']])}
        <div id="compressPurposeWrap" class="control">
          <label for="compressPurpose">¿Para qué la necesitas?</label>
          <select id="compressPurpose" data-ctrl="compressPurpose">
            <option value="auto">Automático</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Correo electrónico</option>
            <option value="web">Página web</option>
            <option value="document">Documento</option>
          </select>
        </div>
        <details id="compressAdvancedWrap" class="control" style="grid-column:1/-1">
          <summary style="cursor:pointer;font-size:.85rem;color:var(--muted)">Ajustes avanzados</summary>
          <div style="margin-top:8px;display:grid;gap:8px">
            ${controlNumber('targetKb', 'Peso máximo (KB)', targetFromIntent || suggestedKb, 20, 10000)}
            ${controlSelect('compressFormat', 'Formato de salida', [['auto','Automático'],['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
            ${controlNumber('compressWidth', 'Ancho máximo (0 = automático)', 0, 0, 10000)}
            ${controlNumber('compressQuality', 'Calidad inicial (%)', 84, 25, 100)}
          </div>
        </details>
        <div id="compressPreviewInfo" class="control" style="grid-column:1/-1;display:none;padding:10px 14px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface-soft)">
        </div>
      `,
      signature: `
        ${controlNumber('signatureThreshold', 'Blanco a eliminar', 215, 120, 250)}
        ${controlNumber('signatureSoftness', 'Suavidad del borde', 26, 1, 80)}
        ${controlColor('signatureInk', 'Color de tinta', '#173b62')}
        ${controlNumber('signaturePadding', 'Margen final (px)', 18, 0, 100)}
      `,
      imagesPdf: `
        ${controlSelect('pdfPageSize', 'Tamaño de página', [['a4','A4'],['letter','Carta'],['image','Ajustar a cada imagen']])}
        ${controlSelect('pdfOrientation', 'Orientación', [['auto','Automática'],['portrait','Vertical'],['landscape','Horizontal']])}
        ${controlNumber('pdfMargin', 'Margen (pt)', 24, 0, 100)}
        ${controlSelect('pdfBackground', 'Fondo de página', [['none','Sin fondo'],['#ffffff','Blanco']])}
      `,
      mergePdf: `
        <div class="control" style="grid-column:1/-1"><label>Orden final</label><div style="color:var(--muted);font-size:.9rem">Usaremos el orden visible en la lista. Puedes mover cada archivo con las flechas.</div></div>
      `,
      crop: `
        ${controlSelect('cropPreset', 'Formato', [['square','Cuadrada 1080 × 1080'],['tiktok','TikTok / Reels 1080 × 1920'],['twoByTwo','Foto 2 × 2 · 600 × 600'],['visa','35 × 45 mm · 413 × 531'],['custom','Personalizado']])}
        ${controlSelect('cropFormat', 'Formato de salida', [['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        ${controlNumber('cropWidth', 'Ancho personalizado (px)', 1080, 50, 8000)}
        ${controlNumber('cropHeight', 'Alto personalizado (px)', 1080, 50, 8000)}
        ${controlNumber('cropZoom', 'Zoom (%)', 100, 100, 300)}
        ${controlNumber('cropOffsetX', 'Mover horizontal (%)', 0, -100, 100)}
        ${controlNumber('cropOffsetY', 'Mover vertical (%)', 0, -100, 100)}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">
          Arrastra el marco para reposicionar. Arrastra las esquinas o bordes para redimensionar. El zoom y los valores se reflejan en tiempo real.
        </div>
        <div id="cropPreviewInfo" class="control" style="grid-column:1/-1;display:none"></div>
        <div id="cropPreviewWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      convert: `
        ${controlSelect('convertFormat', 'Formato de salida', [['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']], 'outputFormat')}
        ${controlNumber('convertQuality', 'Calidad (%)', 86, 25, 100)}
        ${controlNumber('convertWidth', 'Ancho máximo (0 = conservar)', 0, 0, 10000)}
      `,
      removeObjects: `
        <div class="control" style="grid-column:1/-1" id="removeObjectsDisclaimer">
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:.85rem;line-height:1.4">
            <input type="checkbox" id="removeObjectsConfirm" style="margin-top:3px;flex-shrink:0" />
            <span>Confirmo que soy propietario de esta imagen o que tengo autorización para modificarla. No utilizaré Toolisto para ocultar la autoría ni infringir derechos de terceros.</span>
          </label>
          <p style="margin:6px 0 0;font-size:.78rem;color:var(--muted);line-height:1.4">Algunas marcas o textos identifican al autor o las condiciones de licencia. Verifica que tengas permiso antes de eliminarlos.</p>
        </div>
        <div class="control" style="grid-column:1/-1" id="removeObjectsBrushSection" hidden>
          <label for="removeObjectsBrushSize">Tamaño del pincel</label>
          <input id="removeObjectsBrushSize" type="range" min="2" max="120" value="20" style="width:100%" />
        </div>
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap" id="removeObjectsActions" hidden>
          <button type="button" class="quiet-button" id="removeObjectsBrushBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-primary);border-radius:6px;background:var(--c-primary);color:#fff">Pincel</button>
          <button type="button" class="quiet-button" id="removeObjectsEraserBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Borrador</button>
          <button type="button" class="quiet-button" id="removeObjectsUndoBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px" disabled>Deshacer</button>
          <button type="button" class="quiet-button" id="removeObjectsRedoBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px" disabled>Rehacer</button>
          <button type="button" class="quiet-button" id="removeObjectsResetBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Restablecer</button>
        </div>
        <div class="control" style="grid-column:1/-1" id="removeObjectsPreviewToggle" hidden>
          <label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="removeObjectsShowResult" />
            <span>Ver resultado</span>
          </label>
        </div>
        <div class="control" style="grid-column:1/-1" id="removeObjectsOutputSection" hidden>
          ${controlSelect('removeObjectsFormat', 'Formato de salida', [['auto','Igual que el original'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
          ${controlNumber('removeObjectsQuality', 'Calidad (%)', 92, 25, 100)}
        </div>
        <div id="removeObjectsCanvasWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      batchCompress: `
        ${controlNumber('batchQuality', 'Calidad de salida (%)', 82, 10, 100)}
        ${controlNumber('batchMaxWidth', 'Ancho máximo (0 = sin límite)', 0, 0, 10000)}
        ${controlSelect('batchFormat', 'Formato de salida', [['auto','Mantener formato'],['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
        ${controlSelect('batchDownload', 'Descargar', [['zip','Todo en un ZIP'],['individual','Archivos individuales']])}
        <div class="control" style="grid-column:1/-1" id="batchProgressSection" hidden>
          <div id="batchProgressList" style="font-size:.82rem;color:var(--muted)"></div>
          <div style="height:4px;background:var(--c-border);border-radius:2px;overflow:hidden;margin-top:6px">
            <div id="batchProgressBar" style="height:100%;background:var(--c-primary);width:0%;transition:width .15s"></div>
          </div>
          <div id="batchProgressText" style="font-size:.8rem;color:var(--muted);margin-top:4px"></div>
        </div>
      `,
      stripMetadata: `
        <div class="control" style="grid-column:1/-1">
          <label style="display:block;margin-bottom:6px">Cómo funciona</label>
          <div style="font-size:.85rem;color:var(--muted);line-height:1.6">
            La re-codificación mediante Canvas elimina todos los metadatos EXIF, XMP e IPTC de forma inherente: GPS, fecha y hora, dispositivo, software y autor. No existe opción de conservar una categoría sin conservar las demás; al re-codificar se eliminan todas a la vez.
          </div>
        </div>
        ${controlSelect('stripOutputFormat', 'Formato de salida', [['auto','Mantener formato'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        <div class="control" style="grid-column:1/-1" id="stripDetectedInfo" hidden>
          <div id="stripDetectedList" style="font-size:.82rem;color:var(--muted);line-height:1.6"></div>
        </div>
        <div class="control" style="grid-column:1/-1" id="stripProgressSection" hidden>
          <div style="height:4px;background:var(--c-border);border-radius:2px;overflow:hidden">
            <div id="stripProgressBar" style="height:100%;background:var(--c-primary);width:0%;transition:width .15s"></div>
          </div>
          <div id="stripProgressText" style="font-size:.8rem;color:var(--muted);margin-top:4px"></div>
        </div>
      `,
      socialCrop: `
        ${controlSelect('socialPreset', 'Plataforma', [
          ['tiktok','TikTok / Reels (9:16)'],
          ['stories','Historias (9:16)'],
          ['igVertical','Instagram vertical (4:5)'],
          ['igSquare','Instagram cuadrado (1:1)'],
          ['igHorizontal','Instagram horizontal (1.91:1)'],
          ['youtube','YouTube (16:9)'],
          ['ytThumb','Miniatura YouTube (1280×720)'],
          ['profilePic','Foto de perfil (guía circular)'],
          ['custom','Personalizado'],
        ])}
        <div id="socialCustomSize" hidden>
          ${controlNumber('socialWidth', 'Ancho (px)', 1080, 100, 10000)}
          ${controlNumber('socialHeight', 'Alto (px)', 1080, 100, 10000)}
        </div>
        ${controlSelect('socialFormat', 'Formato de salida', [['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        ${controlNumber('socialQuality', 'Calidad (%)', 92, 25, 100)}
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap" id="socialActions">
          <button type="button" class="quiet-button" id="socialZoomIn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Ampliar</button>
          <button type="button" class="quiet-button" id="socialZoomOut" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Reducir</button>
          <button type="button" class="quiet-button" id="socialRotate" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Rotar 90°</button>
          <button type="button" class="quiet-button" id="socialFlipH" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Voltear H</button>
          <button type="button" class="quiet-button" id="socialFlipV" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Voltear V</button>
          <button type="button" class="quiet-button" id="socialResetView" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Restablecer</button>
        </div>
        <div id="socialCanvasWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      splitPdf: `
        <div class="control" style="grid-column:1/-1" id="splitPdfInfo">
          <div id="splitPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;max-height:260px;overflow-y:auto;padding:4px 0" id="splitPdfThumbs"></div>
        ${controlSelect('splitMode', 'Modo de extracción', [['ranges','Por rangos (ej: 1-3, 5, 8-10)'],['selected','Páginas seleccionadas']])}
        <div class="control" style="grid-column:1/-1" id="splitRangesControl">
          <label for="splitRanges">Rangos de páginas</label>
          <input id="splitRanges" type="text" placeholder="1-3, 5, 8-10" style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.9rem" />
          <div id="splitRangesError" style="color:var(--c-error);font-size:.8rem;margin-top:4px"></div>
        </div>
        ${controlSelect('splitOutput', 'Salida', [['single','Un solo PDF con las páginas seleccionadas'],['multi','Un PDF por cada página (ZIP)']])}
      `,
      reorderPdf: `
        <div class="control" style="grid-column:1/-1" id="reorderPdfInfo">
          <div id="reorderPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1" id="reorderPdfThumbs" style="display:flex;flex-wrap:wrap;gap:6px;max-height:300px;overflow-y:auto;padding:4px 0"></div>
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">
          Arrastra las páginas para cambiar el orden. La salida será un PDF con todas las páginas en el nuevo orden.
        </div>
      `,
      pdfToImages: `
        <div class="control" style="grid-column:1/-1" id="pdfToImagesInfo">
          <div id="pdfToImagesMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('pdfToImagesFormat', 'Formato de salida', [['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']], 'outputFormat')}
        ${controlNumber('pdfToImagesQuality', 'Calidad (%)', 92, 25, 100)}
        ${controlNumber('pdfToImagesScale', 'Escala (%)', 100, 50, 300)}
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap" id="pdfToImagesActions">
          <button type="button" class="quiet-button" id="pdfToImagesAllBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-primary);border-radius:6px;background:var(--c-primary);color:#fff">Descargar todas</button>
          <button type="button" class="quiet-button" id="pdfToImagesCancelBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px;color:var(--c-error)">Cancelar</button>
        </div>
        <div class="control" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;max-height:260px;overflow-y:auto;padding:4px 0" id="pdfToImagesThumbs"></div>
        <div class="control" style="grid-column:1/-1" id="pdfToImagesProgress" hidden>
          <div style="height:4px;background:var(--c-border);border-radius:2px;overflow:hidden">
            <div id="pdfToImagesBar" style="height:100%;background:var(--c-primary);width:0%;transition:width .15s"></div>
          </div>
          <div id="pdfToImagesProgressText" style="font-size:.8rem;color:var(--muted);margin-top:4px"></div>
        </div>
      `,
      csvToMarkdown: `
        ${controlSelect('separator', 'Separador', [['auto','Automático'],[';','Punto y coma'],['\\t','Tabulación'],[',','Coma']])}
      `,
      csvToHtml: `
        ${controlSelect('separator', 'Separador', [['auto','Automático'],[';','Punto y coma'],['\\t','Tabulación'],[',','Coma']])}
      `,
      csvToYaml: `
        ${controlSelect('separator', 'Separador', [['auto','Automático'],[';','Punto y coma'],['\\t','Tabulación'],[',','Coma']])}
      `,
      csvStatistics: `
        ${controlSelect('separator', 'Separador', [['auto','Automático'],[';','Punto y coma'],['\\t','Tabulación'],[',','Coma']])}
      `,
      excelToHtml: `
        ${controlText('sheet', 'Hoja (vacío = todas)', '', 'Ej.: Hoja1')}
      `,
      excelToMarkdown: `
        ${controlText('sheet', 'Hoja (vacío = primera)', '', 'Ej.: Hoja1')}
      `,
      csvToSql: `
        ${controlText('tableName', 'Nombre de la tabla', '', 'Ej.: ventas')}
        ${controlSelect('insertStyle', 'Formato de INSERT', [['one','Un INSERT por fila'],['multi','INSERT múltiple']])}
      `,
      csvFilter: `
        ${controlNumber('column', 'Índice de columna (0 = primera)', 0, 0, 1000)}
        ${controlSelect('operator', 'Operador', [['=','Igual a'],['!=','Distinto de'],['>','Mayor que'],['>=','Mayor o igual'],['<','Menor que'],['<=','Menor o igual'],['contains','Contiene'],['notContains','No contiene']])}
        ${controlText('value', 'Valor a comparar', '', 'Ej.: Madrid')}
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="caseSensitive" style="flex-shrink:0" /> Sensible a mayúsculas</label>
        </div>
      `,
      csvSort: `
        ${controlNumber('column', 'Índice de columna (0 = primera)', 0, 0, 1000)}
        ${controlSelect('direction', 'Orden', [['asc','Ascendente'],['desc','Descendente']])}
      `,
      jsonFormatter: `
        ${controlSelect('indent', 'Indentación', [['2','2 espacios'],['4','4 espacios'],['0','Compacto']])}
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="sortKeys" style="flex-shrink:0" /> Ordenar claves alfabéticamente</label>
        </div>
      `,
      signPdf: `
        <div class="control" style="grid-column:1/-1" id="signPdfInfo">
          <div id="signPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1">
          <p style="margin:0;font-size:.78rem;color:var(--muted);line-height:1.4;font-style:italic">Esta herramienta añade una firma visual. No constituye por sí sola una firma digital certificada.</p>
        </div>
        ${controlNumber('signPdfPage', 'Página a firmar', 1, 1, 999)}
        ${controlSelect('signPdfType', 'Tipo de firma', [['draw','Dibujar'],['type','Escribir texto']])}
        <div class="control" style="grid-column:1/-1" id="signPdfDrawSection">
          <div id="signPdfCanvasWrap" style="border:1px solid var(--c-border);border-radius:8px;overflow:hidden;display:flex;justify-content:center;background:#fff"></div>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            <button type="button" class="quiet-button" id="signPdfClearBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Limpiar</button>
          </div>
        </div>
        <div class="control" style="grid-column:1/-1;display:none" id="signPdfTypeSection">
          ${controlText('signPdfText', 'Texto de firma', '', 'Escribe tu nombre')}
          ${controlSelect('signPdfFont', 'Fuente', [['cursive','Cursiva'],['serif','Serif'],['sans-serif','Sans-serif'],['fantasy','Fantasía']])}
          ${controlNumber('signPdfFontSize', 'Tamaño de fuente', 48, 16, 120)}
          ${controlColor('signPdfInk', 'Color de tinta', '#1a1a1a')}
        </div>
        ${controlSelect('signPdfPosition', 'Posición en la página', [['bottomRight','Abajo derecha'],['bottomLeft','Abajo izquierda'],['topRight','Arriba derecha'],['topLeft','Arriba izquierda'],['center','Centro']])}
        ${controlNumber('signPdfWidth', 'Ancho de firma (pt)', 150, 40, 400)}
      `,
      rotatePdf: `
        <div class="control" style="grid-column:1/-1" id="rotatePdfInfo">
          <div id="rotatePdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap" id="rotatePdfActions">
          <button type="button" class="quiet-button" data-rotate="270" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">↺ Girar izquierda</button>
          <button type="button" class="quiet-button" data-rotate="90" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">↻ Girar derecha</button>
          <button type="button" class="quiet-button" data-rotate="180" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">↕ Media vuelta</button>
          <button type="button" class="quiet-button" id="rotatePdfResetBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Restablecer</button>
        </div>
        <div class="control" style="grid-column:1/-1" id="rotatePdfThumbs"></div>
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">
          Selecciona páginas y usa los botones para rotar. La miniatura cambia en tiempo real.
        </div>
      `,
      deletePagesPdf: `
        <div class="control" style="grid-column:1/-1" id="deletePagesPdfInfo">
          <div id="deletePagesPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1" id="deletePagesPdfThumbs"></div>
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem" id="deletePagesPdfSummary">
          Selecciona las páginas a eliminar haciendo clic en ellas.
        </div>
        <details class="control" style="grid-column:1/-1">
          <summary style="cursor:pointer;font-size:.82rem;color:var(--c-muted)">Selección avanzada por números</summary>
          <div style="margin-top:8px">
            <input id="deletePagesRanges" type="text" placeholder="1, 3-5, 8" style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.9rem" />
            <div id="deletePagesError" style="color:var(--c-error);font-size:.8rem;margin-top:4px"></div>
          </div>
        </details>
      `,
      reversePagesPdf: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Invertirá el orden de todas las páginas del documento. La primera pasará a ser la última y viceversa.
        </div>
      `,
      duplicatePagesPdf: `
        <div class="control" style="grid-column:1/-1" id="duplicatePagesPdfInfo">
          <div id="duplicatePagesPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('duplicatePagesTarget', 'Páginas a duplicar', [['all','Todas las páginas'],['selected','Seleccionar páginas']])}
        <div class="control" style="grid-column:1/-1" id="duplicatePagesSelectedControl" hidden>
          <label for="duplicatePagesRanges">Páginas a duplicar (rangos)</label>
          <input id="duplicatePagesRanges" type="text" placeholder="1, 3-5" style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.9rem" />
        </div>
        ${controlNumber('duplicatePagesTimes', 'Veces a duplicar', 2, 2, 20)}
      `,
      insertBlankPagesPdf: `
        <div class="control" style="grid-column:1/-1" id="insertBlankPdfInfo">
          <div id="insertBlankPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlNumber('insertBlankPosition', 'Insertar después de la página', 0, 0, 999)}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">0 = al principio del documento</div>
        ${controlNumber('insertBlankCount', 'Número de páginas en blanco', 1, 1, 50)}
        ${controlSelect('insertBlankSize', 'Tamaño de página', [['same','Igual que el documento'],['a4','A4'],['letter','Carta']])}
      `,
      editMetadataPdf: `
        <div class="control" style="grid-column:1/-1" id="editMetadataPdfInfo">
          <div id="editMetadataPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando metadatos…</div>
        </div>
        ${controlText('editMetaTitle', 'Título', '', 'Título del documento')}
        ${controlText('editMetaAuthor', 'Autor', '', 'Nombre del autor')}
        ${controlText('editMetaSubject', 'Asunto', '', 'Asunto o tema')}
        ${controlText('editMetaKeywords', 'Palabras clave', '', 'keyword1, keyword2, ...')}
      `,
      compressPdf: `
        <div class="control" style="grid-column:1/-1" id="compressPdfInfo">
          <div id="compressPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('compressPdfLevel', 'Nivel de compresión', [['strip','Eliminar metadatos'],['aggressive','Eliminación agresiva (más pequeña)']])}
      `,
      interleavePdf: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Selecciona dos archivos PDF. Las páginas se alternarán: primera del primero, primera del segundo, segunda del primero, segunda del segundo…
        </div>
        ${controlSelect('interleaveFirst', 'Archivo que va primero', [['a','Primer archivo'],['b','Segundo archivo']])}
      `,
      cropPdf: `
        <div class="control" style="grid-column:1/-1" id="cropPdfInfo">
          <div id="cropPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlNumber('cropPdfTop', 'Margen superior (pt)', 0, 0, 500)}
        ${controlNumber('cropPdfRight', 'Margen derecho (pt)', 0, 0, 500)}
        ${controlNumber('cropPdfBottom', 'Margen inferior (pt)', 0, 0, 500)}
        ${controlNumber('cropPdfLeft', 'Margen izquierdo (pt)', 0, 0, 500)}
      `,
      resizePdfPages: `
        <div class="control" style="grid-column:1/-1" id="resizePdfInfo">
          <div id="resizePdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('resizePdfTarget', 'Tamaño objetivo', [['a4','A4 (210×297 mm)'],['letter','Carta (216×279 mm)'],['legal','Oficio (216×356 mm)'],['a3','A3 (297×420 mm)'],['a5','A5 (148×210 mm)']])}
        ${controlSelect('resizePdfScale', 'Escalado', [['fit','Ajustar a la página'],['stretch','Estirar para llenar'],['center','Centrar con fondo blanco']])}
      `,
      nUpPdf: `
        <div class="control" style="grid-column:1/-1" id="nUpPdfInfo">
          <div id="nUpPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('nUpPdfLayout', 'Diseño', [['2','2 páginas por hoja'],['4','4 páginas por hoja']])}
        ${controlSelect('nUpPdfOrientation', 'Orientación salida', [['landscape','Horizontal (landscape)'],['portrait','Vertical (portrait)']])}
      `,
      splitDoublePdf: `
        <div class="control" style="grid-column:1/-1" id="splitDoublePdfInfo">
          <div id="splitDoublePdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('splitDoubleOrientation', 'Orientación del corte', [['vertical','Vertical (izq / der)'],['horizontal','Horizontal (arriba / abajo)']])}
      `,
      bookletPdf: `
        <div class="control" style="grid-column:1/-1" id="bookletPdfInfo">
          <div id="bookletPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">Reordena las páginas para impresión en cuadernillo a doble cara.</div>
      `,
      watermarkPdf: `
        <div class="control" style="grid-column:1/-1" id="watermarkPdfInfo">
          <div id="watermarkPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlText('watermarkText', 'Texto de marca de agua', 'BORRADOR', 'Escribe el texto')}
        ${controlNumber('watermarkFontSize', 'Tamaño de fuente', 60, 12, 200)}
        ${controlColor('watermarkColor', 'Color', '#cccccc')}
        ${controlSelect('watermarkOpacity', 'Opacidad', [['0.15','Muy baja (15%)'],['0.3','Baja (30%)'],['0.5','Media (50%)'],['0.7','Alta (70%)']])}
        ${controlSelect('watermarkRotation', 'Rotación', [['45','45°'],['-45','-45°'],['0','Sin rotación'],['90','90°']])}
        ${controlSelect('watermarkPosition', 'Posición', [['center','Centro'],['topLeft','Arriba izq'],['topRight','Arriba der'],['bottomLeft','Abajo izq'],['bottomRight','Abajo der']])}
      `,
      addPageNumbersPdf: `
        <div class="control" style="grid-column:1/-1" id="addPageNumInfo">
          <div id="addPageNumMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlSelect('pageNumPosition', 'Posición', [['bottomCenter','Centro inferior'],['bottomRight','Derecha inferior'],['bottomLeft','Izquierda inferior'],['topCenter','Centro superior'],['topRight','Derecha superior'],['topLeft','Izquierda superior']])}
        ${controlNumber('pageNumFontSize', 'Tamaño de fuente', 10, 6, 24)}
        ${controlColor('pageNumColor', 'Color', '#000000')}
        ${controlSelect('pageNumFormat', 'Formato', [['number','1, 2, 3…'],['parenthesis','(1), (2), (3)…'],['dash','- 1 -, - 2 -…'],['roman','I, II, III…']])}
      `,
      addHeaderFooterPdf: `
        <div class="control" style="grid-column:1/-1" id="addHeaderFooterInfo">
          <div id="addHeaderFooterMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        ${controlText('headerFooterHeader', 'Encabezado', '', 'Texto del encabezado')}
        ${controlText('headerFooterFooter', 'Pie de página', '', 'Texto del pie')}
        ${controlNumber('headerFooterFontSize', 'Tamaño de fuente', 9, 6, 18)}
        ${controlColor('headerFooterColor', 'Color', '#000000')}
      `,
      docPhoto: `
        ${controlSelect('docPhotoPreset', 'Tipo de documento', [
          ['passport','Pasaporte (35×45 mm)'],
          ['visaUS','Visa USA (51×51 mm)'],
          ['idCard','DNI / Carnet (32×26 mm)'],
          ['passportBook','Pasaporte libro (33×48 mm)'],
          ['driverLicense','Licencia de conducir (2×1½")'],
          ['twoByTwo','Foto 2×2" (51×51 mm)'],
          ['custom','Personalizado'],
        ])}
        <div id="docPhotoCustomSize" hidden>
          ${controlNumber('docPhotoWidth', 'Ancho (mm)', 35, 10, 200)}
          ${controlNumber('docPhotoHeight', 'Alto (mm)', 45, 10, 300)}
        </div>
        ${controlNumber('docPhotoDpi', 'Resolución (DPI)', 300, 72, 600)}
        ${controlSelect('docPhotoBg', 'Color de fondo', [['#ffffff','Blanco'],['#0055a5','Azul'],['#eeeeee','Gris claro'],['#d4e6f1','Azul claro']])}
        ${controlColor('docPhotoBgCustom', 'Color personalizado', '#ffffff')}
        ${controlNumber('docPhotoBorder', 'Borde blanco (mm)', 3, 0, 20)}
        ${controlSelect('docPhotoSheet', 'Tamaño de hoja', [['photo','Solo foto'],['a4','Hoja A4 (210×297 mm)'],['letter','Carta (216×279 mm)']])}
        ${controlNumber('docPhotoCopies', 'Copias por hoja', 1, 1, 16)}
        ${controlSelect('docPhotoFormat', 'Formato de salida', [['image/jpeg','JPG'],['image/png','PNG']])}
        <div class="control" style="grid-column:1/-1" id="docPhotoGuideToggle">
          <label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="docPhotoGuide" checked />
            <span>Mostrar guía de recorte</span>
          </label>
        </div>
        <div id="docPhotoCanvasWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      censor: `
        <div class="control" style="grid-column:1/-1" id="censorDisclaimer">
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:.85rem;line-height:1.4">
            <input type="checkbox" id="censorConfirm" style="margin-top:3px;flex-shrink:0" />
            <span>Confirmo que soy propietario de esta imagen o que tengo autorización para modificarla.</span>
          </label>
        </div>
        <div class="control" style="grid-column:1/-1" id="censorBrushSection" hidden>
          <label for="censorBrushSize">Tamaño del pincel</label>
          <input id="censorBrushSize" type="range" min="2" max="120" value="20" style="width:100%" />
        </div>
        ${controlSelect('censorMode', 'Método de ocultamiento', [['pixelate','Pixelado'],['blur','Desenfoque'],['solidBlack','Negro sólido'],['solidWhite','Blanco sólido']])}
        ${controlNumber('censorIntensity', 'Intensidad (pixelos/radio)', 12, 3, 40)}
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap" id="censorActions" hidden>
          <button type="button" class="quiet-button" id="censorBrushBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-primary);border-radius:6px;background:var(--c-primary);color:#fff">Pincel</button>
          <button type="button" class="quiet-button" id="censorEraserBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Borrador</button>
          <button type="button" class="quiet-button" id="censorUndoBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px" disabled>Deshacer</button>
          <button type="button" class="quiet-button" id="censorRedoBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px" disabled>Rehacer</button>
          <button type="button" class="quiet-button" id="censorResetBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Restablecer</button>
        </div>
        ${controlSelect('censorOutputFormat', 'Formato de salida', [['auto','Igual que el original'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        <div id="censorCanvasWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      fixFormat: `
        <div class="control" style="grid-column:1/-1" id="fixFormatInfo">
          <div id="fixFormatMeta" style="color:var(--muted);font-size:.85rem">Analizando archivo…</div>
        </div>
        <div class="control" style="grid-column:1/-1" id="fixFormatDetection" hidden>
          <div id="fixFormatDetails" style="font-size:.85rem;line-height:1.6"></div>
        </div>
        ${controlSelect('fixFormatTarget', 'Formato de salida', [['auto','Formato detectado'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        ${controlNumber('fixFormatQuality', 'Calidad de salida (%)', 92, 25, 100)}
      `,
      rescueDoc: `
        ${controlNumber('rescueBrightness', 'Brillo', 0, -100, 100)}
        ${controlNumber('rescueContrast', 'Contraste', 20, -100, 100)}
        ${controlNumber('rescueSharpness', 'Nitidez', 30, 0, 100)}
        ${controlNumber('rescueExposure', 'Exposición', 10, -100, 100)}
        ${controlSelect('rescueColorMode', 'Modo de color', [['color','A color'],['grayscale','Escala de grises'],['bw','Blanco y negro']])}
        ${controlNumber('rescueBwThreshold', 'Umbral B/N', 128, 0, 255)}
        ${controlSelect('rescueOutput', 'Formato de salida', [['auto','Igual que el original'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="quiet-button" id="rescuePreviewBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-primary);border-radius:6px;background:var(--c-primary);color:#fff">Vista previa</button>
        </div>
        <div id="rescueCanvasWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      fileCompliance: `
        <div class="control" style="grid-column:1/-1">
          <label style="display:block;margin-bottom:6px;font-weight:600">Requisitos del archivo</label>
        </div>
        ${controlNumber('complianceMaxKB', 'Tamaño máximo (KB)', 500, 10, 100000)}
        ${controlNumber('complianceMinW', 'Ancho mínimo (px)', 0, 0, 10000)}
        ${controlNumber('complianceMaxW', 'Ancho máximo (px)', 0, 0, 10000)}
        ${controlNumber('complianceMinH', 'Alto mínimo (px)', 0, 0, 10000)}
        ${controlNumber('complianceMaxH', 'Alto máximo (px)', 0, 0, 10000)}
        ${controlSelect('complianceFormat', 'Formato requerido', [['any','Cualquiera'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        <div class="control" style="grid-column:1/-1">
          <div id="complianceInfo" style="color:var(--muted);font-size:.85rem;margin-bottom:8px">Haz clic en "Analizar" para validar contra estos requisitos.</div>
          <div id="complianceResults" style="font-size:.85rem;line-height:1.6"></div>
        </div>
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="quiet-button" id="complianceAnalyzeBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-primary);border-radius:6px;background:var(--c-primary);color:#fff">Analizar</button>
        </div>
      `,
      workflow: `
        <div class="control" style="grid-column:1/-1">
          <label style="display:block;margin-bottom:6px">Agregar operación</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="quiet-button wf-add" data-op="compress" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Comprimir</button>
            <button type="button" class="quiet-button wf-add" data-op="resize" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Redimensionar</button>
            <button type="button" class="quiet-button wf-add" data-op="convert" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Convertir</button>
            <button type="button" class="quiet-button wf-add" data-op="rotate" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Rotar</button>
            <button type="button" class="quiet-button wf-add" data-op="flip" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Voltear</button>
            <button type="button" class="quiet-button wf-add" data-op="stripMeta" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Metadatos</button>
            <button type="button" class="quiet-button wf-add" data-op="watermark" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Marca de agua</button>
          </div>
        </div>
        <div class="control" style="grid-column:1/-1" id="wfStepsSection">
          <label>Pasos del flujo</label>
          <div id="wfSteps" style="font-size:.85rem;color:var(--muted);margin-top:4px">Agrega operaciones desde los botones de arriba.</div>
        </div>
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="quiet-button" id="wfSavePreset" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Guardar flujo</button>
          <select id="wfLoadPreset" style="padding:5px 10px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-surface);color:var(--c-text);font-size:.82rem"><option value="">Cargar flujo guardado…</option></select>
          <button type="button" class="quiet-button" id="wfDeletePreset" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-error);border-radius:6px;color:var(--c-error)">Eliminar</button>
        </div>
      `,
      advancedConvert: `
        ${controlSelect('advConvertFormat', 'Formato de salida', [['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
        ${controlNumber('advConvertQuality', 'Calidad (%)', 86, 25, 100)}
        ${controlSelect('advResizeMode', 'Redimensionar', [['none','No'],['width','Por ancho'],['percent','Por porcentaje'],['fit','Ajustar dentro de']])}
        <div class="control" style="grid-column:1/-1" id="advResizeValueControl">
          ${controlNumber('advResizeValue', 'Valor', 1080, 1, 10000)}
          <div id="advResizeLabel" style="font-size:.78rem;color:var(--muted)">Ancho en píxeles</div>
        </div>
        ${controlSelect('advRotate', 'Rotar', [['0','Sin rotar'],['90','90°'],['180','180°'],['270','270°']])}
        ${controlSelect('advFlip', 'Voltear', [['none','Sin voltear'],['h','Horizontal'],['v','Vertical'],['hv','Ambos']])}
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:.85rem;margin-bottom:4px">
            <input type="checkbox" id="advWatermarkToggle" style="flex-shrink:0" />
            <span>Agregar marca de agua</span>
          </label>
        </div>
        <div id="advWatermarkOpts" style="display:none">
          ${controlText('advWatermarkText', 'Texto', 'WATERMARK', 'Texto de marca de agua')}
          ${controlNumber('advWatermarkSize', 'Tamaño de fuente', 36, 8, 200)}
          ${controlNumber('advWatermarkOpacity', 'Opacidad (%)', 30, 5, 100)}
          ${controlSelect('advWatermarkPos', 'Posición', [['center','Centro'],['topLeft','Arriba izq.'],['topRight','Arriba der.'],['bottomLeft','Abajo izq.'],['bottomRight','Abajo der.']])}
          ${controlColor('advWatermarkColor', 'Color', '#ffffff')}
        </div>
        <div class="control" style="grid-column:1/-1">
          <div id="advConvertProgress" style="color:var(--muted);font-size:.82rem"></div>
        </div>
      `,
      unzipFile: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Se extraerán todos los archivos del ZIP. Los archivos carpetas se mantendrán en su estructura original.
        </div>
      `,
      createZipAdvanced: `
        ${controlSelect('zipCompression', 'Compresión', [['DEFLATE','DEFLATE (recomendado)'],['STORE','Sin compresión']])}
      `,
      zipRepair: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Intentará recuperar los archivos legibles del ZIP dañado. Algunos archivos pueden estar incompletos.
        </div>
      `,
      fileSplit: `
        ${controlNumber('splitChunkSize', 'Tamaño del fragmento (bytes)', 1048576, 1024, 104857600)}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">
          Valor predeterminado: 1 MB (1048576 bytes). 10 MB = 104857600.
        </div>
      `,
      fileJoin: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Selecciona todos los fragmentos. Se ordenarán automáticamente por nombre y se recompondrá el archivo original.
        </div>
      `,
      checksumFile: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Se generarán los hash SHA-1 y SHA-256 de cada archivo para verificar su integridad.
        </div>
      `,
      fileInspector: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Analizará los magic bytes del archivo para detectar su tipo real, sin importar la extensión.
        </div>
      `,
      pdfEncryptAdvanced: `
        ${controlText('pdfOwnerPassword', 'Contraseña del propietario', 'toolisto-protected', 'Contraseña para controlar permisos')}
        ${controlText('pdfUserPassword', 'Contraseña del usuario (vacío = sin abrir)', '', 'Dejar vacío para no requerir contraseña al abrir')}
        <div class="control" style="grid-column:1/-1">
          <label style="display:block;margin-bottom:6px;font-weight:600">Permisos</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="pdfAllowPrint" checked style="flex-shrink:0" /> Permitir imprimir</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="pdfAllowCopy" style="flex-shrink:0" /> Permitir copiar texto</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="pdfAllowModify" style="flex-shrink:0" /> Permitir modificar</label>
        </div>
      `,
      qrGenerate: `
          ${controlText('qrText', 'Texto o URL', 'https://apluno.com', 'Ingresa el contenido del QR')}
        ${controlSelect('qrEcLevel', 'Nivel de corrección de errores', [['L','Bajo (7%)'],['M','Medio (15%)'],['Q','Cuarto (25%)'],['H','Alto (30%)']])}
        ${controlNumber('qrSize', 'Tamaño (px)', 300, 100, 1000)}
        ${controlColor('qrFgColor', 'Color de前景', '#000000')}
        ${controlColor('qrBgColor', 'Color de fondo', '#ffffff')}
      `,
      qrWifi: `
        ${controlText('wifiSsid', 'Nombre de la red (SSID)', '', 'Nombre de tu red Wi-Fi')}
        ${controlText('wifiPassword', 'Contraseña', '', 'Contraseña de la red')}
        ${controlSelect('wifiAuth', 'Seguridad', [['WPA','WPA/WPA2'],['WEP','WEP'],['nopass','Sin contraseña']])}
        ${controlNumber('qrSize', 'Tamaño (px)', 300, 100, 1000)}
      `,
      qrVcard: `
        ${controlText('vcardName', 'Nombre completo', '', 'Nombre del contacto')}
        ${controlText('vcardPhone', 'Teléfono', '', '+56 9 1234 5678')}
        ${controlText('vcardEmail', 'Correo', '', 'correo@ejemplo.com')}
        ${controlText('vcardOrg', 'Organización', '', 'Empresa o institución')}
        ${controlNumber('qrSize', 'Tamaño (px)', 300, 100, 1000)}
      `,
      barcodeGenerate: `
        ${controlText('barcodeText', 'Contenido', '1234567890', 'Texto o número del código de barras')}
        ${controlSelect('barcodeFormat', 'Formato', [['CODE128','Code128'],['CODE39','Code39'],['EAN13','EAN-13'],['EAN8','EAN-8'],['UPCA','UPC-A'],['ITF','ITF'],['CODABAR','Codabar']])}
        ${controlNumber('barcodeWidth', 'Ancho de barra', 2, 1, 5)}
        ${controlNumber('barcodeHeight', 'Alto (px)', 80, 20, 200)}
        ${controlColor('barcodeColor', 'Color de barras', '#000000')}
        ${controlColor('barcodeBg', 'Color de fondo', '#ffffff')}
      `,
      qrReadFromImage: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Selecciona una imagen que contenga un código QR. El contenido se extraerá como texto.
        </div>
      `,
      barcodeReadFromImage: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Selecciona una imagen con un código de barras. Se analizará y detectará el tipo de código.
        </div>
      `,
      qrBatchFromCsv: `
        ${controlNumber('csvTextCol', 'Columna del texto (0-index)', 0, 0, 50)}
        ${controlNumber('qrSize', 'Tamaño de cada QR (px)', 200, 100, 500)}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem">
          El CSV debe tener encabezados. La primera columna (índice 0) se usa por defecto como contenido del QR.
        </div>
      `,
      colorPicker: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;line-height:1.6">
          Toca o haz clic en un punto de la imagen para capturar su color exacto. Se muestran HEX, RGB y HSL con botones para copiar, más una vista ampliada de la zona. Los valores se escalan a la imagen original.
        </div>
        <div id="colorPickerWrap" style="grid-column:1/-1;display:none;margin-top:8px"></div>
        <div class="control" style="grid-column:1/-1" id="colorPickerReadout" hidden>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div id="colorPickerSwatch" style="width:46px;height:46px;border-radius:8px;border:1px solid var(--c-border);flex-shrink:0;background:#fff"></div>
            <div style="font-size:.85rem;line-height:1.7;min-width:220px">
              <div>HEX: <strong id="colorPickerHex">—</strong></div>
              <div>RGB: <strong id="colorPickerRgb">—</strong></div>
              <div>HSL: <strong id="colorPickerHsl">—</strong></div>
              <div style="color:var(--muted)">Posición: <strong id="colorPickerPos">—</strong></div>
            </div>
            <button type="button" class="quiet-button" id="colorPickerCopyHex" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Copiar HEX</button>
            <button type="button" class="quiet-button" id="colorPickerCopyRgb" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Copiar RGB</button>
            <button type="button" class="quiet-button" id="colorPickerCopyHsl" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Copiar HSL</button>
          </div>
        </div>
      `,
      imageCompare: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;line-height:1.6">
          Compara dos imágenes con deslizador, alternancia, superposición y diferencia visual. La comparación es solo visual: no genera archivos de descarga.
        </div>
        ${controlSelect('compareMode', 'Modo de comparación', [['slider','Deslizador antes/después'],['toggle','Alternancia A/B'],['overlay','Superposición con opacidad'],['diff','Diferencia visual']])}
        <div class="control" style="grid-column:1/-1" id="compareThresholdWrap">
          ${controlNumber('compareThreshold', 'Umbral de diferencia', 30, 1, 128)}
        </div>
        <div class="control" style="grid-column:1/-1" id="compareOverlayWrap" hidden>
          ${controlNumber('compareOverlayAlpha', 'Opacidad de la imagen B (%)', 50, 5, 100)}
        </div>
        <div class="control" style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="quiet-button" id="compareToggleBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Mostrar B</button>
          <button type="button" class="quiet-button" id="compareResetBtn" style="font-size:.82rem;padding:5px 10px;border:1px solid var(--c-border);border-radius:6px">Deslizador al centro</button>
        </div>
        <div id="compareCanvasWrap" style="grid-column:1/-1;position:relative;display:none;margin-top:8px"></div>
      `,
      pdfPageCounter: `
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.85rem">
          Cuenta las páginas de cada PDF y muestra sus dimensiones en puntos.
        </div>
      `,
      enhanceScannedDocument: `
        ${controlNumber('enhBrightness', 'Brillo', 0, -100, 100)}
        ${controlNumber('enhContrast', 'Contraste', 0, -100, 100)}
        ${controlNumber('enhSharpness', 'Nitidez', 0, 0, 100)}
        ${controlNumber('enhDenoise', 'Reducir ruido', 0, 0, 100)}
        ${controlSelect('enhOutputFormat', 'Formato de salida', [['auto','Igual que el original'],['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        ${controlNumber('enhQuality', 'Calidad (%)', 92, 25, 100)}
        <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.85rem;margin-top:8px">
          <input type="checkbox" id="enhAutoCrop" checked style="flex-shrink:0" /> Recortar bordes automáticamente
        </label>
        <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.85rem;margin-top:4px">
          <input type="checkbox" id="enhAutoRotate" style="flex-shrink:0" /> Corregir orientación
        </label>
      `,
      censorPdf: `
        ${controlText('searchTerm', 'Censurar texto que contenga', '', 'Ej.: SECRETO, confidencial')}
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="removeMetadata" style="flex-shrink:0" /> Eliminar metadatos del PDF</label>
        </div>
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;font-style:italic">
          Las zonas manuales y patrones (email, teléfono, RUT, tarjeta) se aplican desde la API del procesador; desde la UI se censura por texto buscado.
        </div>
      `,
      verifyPdfCensor: `
        ${controlText('searchTerm', 'Término buscado al censurar', '', 'El texto que debió eliminarse')}
      `,
      formatDocumentApa7: `
        ${controlText('title', 'Título', '', 'Título del documento')}
        ${controlText('authorName', 'Nombre del autor', '', 'Autor o autores')}
        ${controlText('authorAffiliation', 'Institución', '', 'Afiliación institucional')}
        ${controlText('course', 'Curso', '', 'Curso o asignatura')}
        ${controlText('instructor', 'Profesor', '', 'Docente que recibe el trabajo')}
        ${controlText('abstract', 'Resumen', '', 'Resumen del documento (abstract)')}
        ${controlText('keywords', 'Palabras clave', '', 'Separadas por comas')}
      `,
      cameraDocumentScanner: `
        ${controlSelect('outputFormat', 'Formato de salida', [['jpeg','JPG'],['png','PNG'],['webp','WebP']])}
        ${controlNumber('quality', 'Calidad (%)', 92, 25, 100)}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;font-style:italic">
          Usa el botón de la zona de carga para tomar una foto con la cámara de tu dispositivo.
        </div>
      `,
      pdfTablesToExcel: `
        ${controlSelect('outputFormat', 'Formato de salida', [['xlsx','Excel (XLSX)'],['csv','CSV']])}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;font-style:italic">
          Nota: Esta herramienta funciona de manera óptima con tablas simples. Resultados variables con tablas complejas.
        </div>
      `,
      imageTableToExcel: `
        ${controlSelect('language', 'Idioma del texto', [['spa','Español'],['eng','Inglés'],['por','Portugués'],['fra','Francés'],['deu','Alemán']])}
        ${controlSelect('outputFormat', 'Formato de salida', [['xlsx','Excel (XLSX)'],['csv','CSV']])}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;font-style:italic">
          Nota: El modelo de idioma español (spa) se sirve localmente; la precisión del OCR depende de la calidad de la imagen. Imágenes claras producen mejores resultados.
        </div>
      `,
      convertAudio: `
        ${controlSelect('audioOutputFormat', 'Formato de salida', [['mp3','MP3'],['wav','WAV'],['ogg','OGG'],['aac','AAC']])}
        ${controlSelect('audioBitrate', 'Bitrate', [['128k','128 kbps'],['192k','192 kbps'],['256k','256 kbps'],['320k','320 kbps']])}
        <div class="control" style="grid-column:1/-1" id="audioEngineStatus" hidden>
          <div style="color:var(--muted);font-size:.82rem">Cargando motor de audio…</div>
          <div style="height:4px;background:var(--c-border);border-radius:2px;overflow:hidden;margin-top:4px">
            <div id="audioEngineBar" style="height:100%;background:var(--c-primary);width:0%;transition:width .15s"></div>
          </div>
        </div>
      `,
      trimAudio: `
        <div class="control" style="grid-column:1/-1" id="trimAudioInfo">
          <div id="trimAudioDuration" style="color:var(--muted);font-size:.85rem">Cargando audio…</div>
        </div>
        ${controlNumber('trimAudioStart', 'Inicio (segundos)', 0, 0, 9999)}
        ${controlNumber('trimAudioEnd', 'Fin (segundos)', 0, 0, 9999)}
        ${controlSelect('trimAudioFormat', 'Formato de salida', [['same','Mismo formato'],['mp3','MP3'],['wav','WAV'],['ogg','OGG'],['aac','AAC']])}
      `,
      mergeAudio: `
        <div class="control" style="grid-column:1/-1"><label>Orden final</label><div style="color:var(--muted);font-size:.9rem">Usaremos el orden visible en la lista. Puedes mover cada archivo con las flechas.</div></div>
        ${controlSelect('mergeAudioFormat', 'Formato de salida', [['mp3','MP3'],['wav','WAV'],['ogg','OGG'],['aac','AAC']])}
      `,
      compressVideo: `
        ${controlSelect('videoQuality', 'Calidad', [['low','Baja (360p)'],['medium','Media (480p)'],['high','Alta (720p)'],['original','Original']])}
        ${controlSelect('videoOutputFormat', 'Formato de salida', [['mp4','MP4 (H.264)'],['webm','WebM (VP8)']])}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;font-style:italic">
          Nota: La compresión puede tardar varios minutos según el tamaño del archivo.
        </div>
      `,
      trimVideo: `
        <div class="control" style="grid-column:1/-1" id="trimVideoInfo">
          <div id="trimVideoDuration" style="color:var(--muted);font-size:.85rem">Cargando video…</div>
        </div>
        ${controlNumber('trimVideoStart', 'Inicio (segundos)', 0, 0, 99999)}
        ${controlNumber('trimVideoEnd', 'Fin (segundos)', 0, 0, 99999)}
        ${controlSelect('trimVideoFormat', 'Formato de salida', [['same','Mismo formato'],['mp4','MP4'],['webm','WebM']])}
      `,
      mergeVideos: `
        <div class="control" style="grid-column:1/-1"><label>Orden final</label><div style="color:var(--muted);font-size:.9rem">Usaremos el orden visible en la lista. Puedes mover cada archivo con las flechas.</div></div>
        ${controlSelect('mergeVideoFormat', 'Formato de salida', [['mp4','MP4 (H.264)'],['webm','WebM (VP8)']])}
      `,
      videoToGif: `
        <div class="control" style="grid-column:1/-1" id="gifVideoInfo">
          <div id="gifVideoDuration" style="color:var(--muted);font-size:.85rem">Cargando video…</div>
        </div>
        ${controlNumber('gifStart', 'Inicio (segundos)', 0, 0, 99999)}
        ${controlNumber('gifEnd', 'Fin (segundos)', 5, 0, 99999)}
        ${controlNumber('gifFps', 'Fotogramas por segundo', 10, 1, 30)}
        ${controlNumber('gifWidth', 'Ancho (px)', 480, 100, 1200)}
      `,
      extractAudioFromVideo: `
        ${controlSelect('extractAudioFormat', 'Formato de audio', [['mp3','MP3'],['wav','WAV'],['ogg','OGG'],['aac','AAC']])}
      `,
      removeAudioFromVideo: `
        ${controlSelect('removeAudioFormat', 'Formato de salida', [['same','Mismo formato'],['mp4','MP4'],['webm','WebM']])}
        <div class="control" style="grid-column:1/-1;color:var(--muted);font-size:.82rem;font-style:italic">
          El video se procesa sin re-codificar, lo que hace el proceso rápido.
        </div>
      `,
      findReplaceWord: `
        ${controlText('search', 'Texto a buscar', '', 'Texto a buscar…')}
        ${controlText('replace', 'Texto de reemplazo', '', 'Texto de reemplazo…')}
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="caseSensitive" style="flex-shrink:0" /> Sensible a mayúsculas</label>
        </div>
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="regex" style="flex-shrink:0" /> Usar expresión regular</label>
        </div>
      `,
      epubToHtml: `
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="singleFile" checked style="flex-shrink:0" /> Combinar todos los capítulos en un solo archivo</label>
        </div>
      `,
      epubToMarkdown: `
        <div class="control" style="grid-column:1/-1">
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;cursor:pointer"><input type="checkbox" id="singleFile" checked style="flex-shrink:0" /> Combinar todos los capítulos en un solo archivo</label>
        </div>
      `,
      mergeEpub: `
        ${controlText('title', 'Título del libro unificado', '', 'Ej.: Antología de prueba')}
        ${controlText('author', 'Autor', '', 'Ej.: Toolisto')}
        ${controlText('language', 'Idioma', '', 'Ej.: es')}
      `,
      editMetadataEpub: `
        ${controlText('title', 'Título', '', 'Nuevo título')}
        ${controlText('author', 'Autor', '', 'Nuevo autor')}
        ${controlText('language', 'Idioma', '', 'Ej.: es')}
        ${controlText('description', 'Descripción', '', 'Nueva descripción')}
        ${controlText('publisher', 'Editorial', '', 'Nueva editorial')}
        ${controlText('identifier', 'Identificador', '', 'urn:uuid:...')}
        ${controlText('rights', 'Derechos', '', 'Nuevos derechos')}
      `,
      scannedPdfToSearchablePdf: `
        ${controlSelect('ocrLanguage', 'Idioma del documento', [['spa','Español'],['eng','Inglés'],['fra','Francés'],['deu','Alemán'],['por','Portugués'],['ita','Italiano']])}
        ${controlText('ocrPages', 'Páginas (opcional)', '', 'Ej.: 1,2 o 1-3')}
      `,
      imageToSearchablePdf: `
        ${controlSelect('ocrLanguage', 'Idioma del documento', [['spa','Español'],['eng','Inglés'],['fra','Francés'],['deu','Alemán'],['por','Portugués'],['ita','Italiano']])}
      `,
      extractTextFromScannedPdf: `
        ${controlSelect('ocrLanguage', 'Idioma del documento', [['spa','Español'],['eng','Inglés'],['fra','Francés'],['deu','Alemán'],['por','Portugués'],['ita','Italiano']])}
        ${controlText('ocrPages', 'Páginas (opcional)', '', 'Ej.: 1,2 o 1-3')}
      `,
      encryptDecryptFile: `
        ${controlSelect('mode', 'Operación', [['encrypt','Cifrar'],['decrypt','Descifrar']])}
        <div class="control"><label for="password">Contraseña</label><input id="password" type="password" placeholder="Mínimo 4 caracteres" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.9rem" /></div>
      `,
    };

    els.advancedControls.innerHTML = htmlByTool[tool] || '';
    els.advancedPanel.open = Boolean(htmlByTool[tool]);
    const preset = $('#cropPreset');
    if (preset) preset.addEventListener('change', syncCropPreset);
    if (tool === 'crop') initCropPreview();
    if (tool === 'colorPicker') initColorPicker();
    if (tool === 'imageCompare') initImageCompare();
    if (tool === 'removeObjects') initRemoveObjectsEditor();
    if (tool === 'stripMetadata') initStripMetadata();
    if (tool === 'socialCrop') initSocialCrop();
    if (hasFiles && tool === 'splitPdf') initSplitPdf();
    if (hasFiles && tool === 'reorderPdf') initReorderPdf();
    if (hasFiles && tool === 'pdfToImages') initPdfToImages();
    if (hasFiles && tool === 'signPdf') initSignPdf();
    if (hasFiles && tool === 'deletePagesPdf') initDeletePagesPdf();
    if (hasFiles && tool === 'rotatePdf') initRotatePdf();
    if (hasFiles && tool === 'duplicatePagesPdf') initDuplicatePagesPdf();
    if (hasFiles && tool === 'insertBlankPagesPdf') initInsertBlankPagesPdf();
    if (hasFiles && tool === 'editMetadataPdf') initEditMetadataPdf();
    if (hasFiles && tool === 'compressPdf') initCompressPdf();
    if (hasFiles && tool === 'interleavePdf') initInterleavePdf();
    if (hasFiles && tool === 'cropPdf') initCropPdf();
    if (hasFiles && tool === 'resizePdfPages') initResizePdfPages();
    if (hasFiles && tool === 'nUpPdf') initNUpPdf();
    if (hasFiles && tool === 'splitDoublePdf') initSplitDoublePdf();
    if (hasFiles && tool === 'bookletPdf') initBookletPdf();
    if (hasFiles && tool === 'watermarkPdf') initWatermarkPdf();
    if (hasFiles && tool === 'addPageNumbersPdf') initAddPageNumbersPdf();
    if (hasFiles && tool === 'addHeaderFooterPdf') initAddHeaderFooterPdf();
    if (tool === 'docPhoto') initDocPhoto();
    if (tool === 'censor') initCensor();
    if (tool === 'fixFormat') initFixFormat();
    if (tool === 'rescueDoc') initRescueDoc();
    if (tool === 'fileCompliance') initFileCompliance();
    if (tool === 'workflow') initWorkflow();
    if (tool === 'advancedConvert') initAdvancedConvert();
  }

  function controlNumber(id, label, value, min, max) {
    return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="number" value="${value}" min="${min}" max="${max}" /></div>`;
  }

  function controlSelect(id, label, options, dataPreset) {
    const presetAttr = dataPreset ? ` data-preset="${dataPreset}"` : '';
    return `<div class="control"><label for="${id}">${label}</label><select id="${id}"${presetAttr}>${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></div>`;
  }

  function controlColor(id, label, value) {
    return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="color" value="${value}" /></div>`;
  }

  function controlText(id, label, value, placeholder) {
    return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="text" value="${escapeHtml(String(value || ''))}" placeholder="${escapeHtml(String(placeholder || ''))}" style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.9rem" /></div>`;
  }

  function syncCropPreset() {
    const preset = $('#cropPreset')?.value;
    const sizes = { square:[1080,1080], tiktok:[1080,1920], twoByTwo:[600,600], visa:[413,531] };
    if (sizes[preset]) {
      $('#cropWidth').value = sizes[preset][0];
      $('#cropHeight').value = sizes[preset][1];
    }
  }

  const _cropPrev = { canvas:null, ctx:null, image:null, imgW:0, imgH:0, scale:1, cropW:0, cropH:0, rect:null, dragging:false, dragStartX:0, dragStartY:0, startOffsetX:0, startOffsetY:0 };

  function cropPreviewSize() {
    const preset = valueOf('cropPreset', 'square');
    const presetSizes = { square:[1080,1080], tiktok:[1080,1920], twoByTwo:[600,600], visa:[413,531] };
    if (presetSizes[preset]) return presetSizes[preset];
    return [clamp(numberValue('cropWidth',1080),50,8000), clamp(numberValue('cropHeight',1080),50,8000)];
  }

  function renderCropPreview() {
    const ctx = _cropPrev.ctx;
    if (!ctx || !_cropPrev.image || !_cropPrev.canvas) return;
    const iw = _cropPrev.imgW, ih = _cropPrev.imgH;
    const [tw, th] = cropPreviewSize();
    const zoom = clamp(numberValue('cropZoom',100)/100,1,3);
    const offsetX = clamp(numberValue('cropOffsetX',0)/100,-1,1);
    const offsetY = clamp(numberValue('cropOffsetY',0)/100,-1,1);

    const targetRatio = tw / th;
    const imageRatio = iw / ih;
    let cropW, cropH;
    if (imageRatio > targetRatio) { cropH = ih / zoom; cropW = cropH * targetRatio; }
    else { cropW = iw / zoom; cropH = cropW / targetRatio; }
    cropW = Math.min(cropW, iw); cropH = Math.min(cropH, ih);
    const maxX = (iw - cropW) / 2;
    const maxY = (ih - cropH) / 2;
    const sx = maxX + offsetX * maxX;
    const sy = maxY + offsetY * maxY;
    _cropPrev.cropW = cropW; _cropPrev.cropH = cropH;

    const scale = Math.min(560 / iw, (560 * 0.9) / ih);
    _cropPrev.scale = scale;
    const dw = Math.max(1, Math.round(iw * scale));
    const dh = Math.max(1, Math.round(ih * scale));
    _cropPrev.canvas.width = dw; _cropPrev.canvas.height = dh;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, dw, dh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_cropPrev.image, 0, 0, dw, dh);

    const rx = sx * scale, ry = sy * scale, rw = Math.max(1, cropW * scale), rh = Math.max(1, cropH * scale);
    _cropPrev.rect = { rx, ry, rw, rh };
    ctx.beginPath();
    ctx.rect(0, 0, dw, dh);
    ctx.rect(rx, ry, rw, rh);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 1; g < 3; g++) {
      ctx.moveTo(rx + rw * g / 3, ry); ctx.lineTo(rx + rw * g / 3, ry + rh);
      ctx.moveTo(rx, ry + rh * g / 3); ctx.lineTo(rx + rw, ry + rh * g / 3);
    }
    ctx.stroke();
    var handleSize = 8;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    var handles = [
      [rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh],
      [rx + rw / 2, ry], [rx + rw / 2, ry + rh],
      [rx, ry + rh / 2], [rx + rw, ry + rh / 2]
    ];
    handles.forEach(function(h) {
      ctx.fillRect(h[0] - handleSize / 2, h[1] - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(h[0] - handleSize / 2, h[1] - handleSize / 2, handleSize, handleSize);
    });
    _cropPrev.handles = handles;
    var cursors = ['nwse-resize','nesw-resize','nesw-resize','nwse-resize','ns-resize','ns-resize','ew-resize','ew-resize'];
    _cropPrev.handleCursors = cursors;
    var infoEl = document.getElementById('cropPreviewInfo');
    if (infoEl) {
      infoEl.style.display = '';
      infoEl.innerHTML = '<div style="display:flex;gap:16px;font-size:.78rem;color:var(--muted)">' +
        '<span>X: ' + Math.round(sx) + '</span><span>Y: ' + Math.round(sy) + '</span>' +
        '<span>Ancho: ' + Math.round(cropW) + '</span><span>Alto: ' + Math.round(cropH) + '</span>' +
        '</div>';
    }
  }

  function initCropPreview() {
    const file = state.files[0];
    if (!file) return;
    const wrap = $('#cropPreviewWrap');
    if (!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;max-width:560px;border-radius:8px;cursor:grab;display:block;touch-action:none;margin:0 auto';
    _cropPrev.canvas = canvas;
    _cropPrev.ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);
    loadImage(file).then((img) => {
      _cropPrev.image = img;
      _cropPrev.imgW = img.naturalWidth;
      _cropPrev.imgH = img.naturalHeight;
      renderCropPreview();
    }).catch(() => { /* el procesador mostrará el error */ });

    ['cropZoom', 'cropOffsetX', 'cropOffsetY', 'cropWidth', 'cropHeight'].forEach(id => {
      const el = $('#' + id);
      if (el) el.addEventListener('input', renderCropPreview);
    });
    const presetSel = $('#cropPreset');
    if (presetSel) presetSel.addEventListener('change', renderCropPreview);

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const r = _cropPrev.rect;
      if (!r) return;
      var handleIdx = -1;
      if (_cropPrev.handles) {
        for (var hi = 0; hi < _cropPrev.handles.length; hi++) {
          var hx = _cropPrev.handles[hi][0], hy = _cropPrev.handles[hi][1];
          if (Math.abs(px - hx) < 12 && Math.abs(py - hy) < 12) { handleIdx = hi; break; }
        }
      }
      if (handleIdx >= 0) {
        _cropPrev.resizeHandle = handleIdx;
        _cropPrev.resizeStartX = px; _cropPrev.resizeStartY = py;
        _cropPrev.resizeStartOffX = numberValue('cropOffsetX', 0);
        _cropPrev.resizeStartOffY = numberValue('cropOffsetY', 0);
        _cropPrev.resizeStartW = _cropPrev.cropW;
        _cropPrev.resizeStartH = _cropPrev.cropH;
        canvas.style.cursor = _cropPrev.handleCursors ? _cropPrev.handleCursors[handleIdx] : 'crosshair';
        e.preventDefault();
        return;
      }
      if (px >= r.rx && px <= r.rx + r.rw && py >= r.ry && py <= r.ry + r.rh) {
        _cropPrev.dragging = true;
        _cropPrev.dragStartX = px; _cropPrev.dragStartY = py;
        _cropPrev.startOffsetX = numberValue('cropOffsetX', 0);
        _cropPrev.startOffsetY = numberValue('cropOffsetY', 0);
        canvas.style.cursor = 'grabbing';
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      if (_cropPrev.resizeHandle !== undefined && _cropPrev.resizeHandle >= 0) {
        const sc = _cropPrev.scale || 1;
        const dxPx = px - _cropPrev.resizeStartX;
        const dyPx = py - _cropPrev.resizeStartY;
        const hi = _cropPrev.resizeHandle;
        var newOffX = _cropPrev.resizeStartOffX;
        var newOffY = _cropPrev.resizeStartOffY;
        if (hi === 0 || hi === 3 || hi === 6 || hi === 7) {
          newOffX = clamp(_cropPrev.resizeStartOffX + (dxPx / sc / ((_cropPrev.imgW - _cropPrev.resizeStartW) / 2 || 1)) * 100, -100, 100);
        }
        if (hi === 0 || hi === 1 || hi === 4 || hi === 5) {
          newOffY = clamp(_cropPrev.resizeStartOffY + (dyPx / sc / ((_cropPrev.imgH - _cropPrev.resizeStartH) / 2 || 1)) * 100, -100, 100);
        }
        var zoomCtrl = $('#cropZoom');
        if (zoomCtrl) {
          var curZoom = clamp(numberValue('cropZoom', 100), 100, 300);
          var zoomDelta = -(dxPx + dyPx) / 200 * 10;
          zoomCtrl.value = clamp(Math.round(curZoom + zoomDelta), 100, 300);
        }
        $('#cropOffsetX').value = Math.round(newOffX * 100) / 100;
        $('#cropOffsetY').value = Math.round(newOffY * 100) / 100;
        renderCropPreview();
        return;
      }
      if (!_cropPrev.dragging) {
        if (_cropPrev.handles) {
          var overHandle = false;
          for (var hi2 = 0; hi2 < _cropPrev.handles.length; hi2++) {
            var hx2 = _cropPrev.handles[hi2][0], hy2 = _cropPrev.handles[hi2][1];
            if (Math.abs(px - hx2) < 12 && Math.abs(py - hy2) < 12) { canvas.style.cursor = _cropPrev.handleCursors[hi2]; overHandle = true; break; }
          }
          if (!overHandle) {
            var r2 = _cropPrev.rect;
            canvas.style.cursor = (r2 && px >= r2.rx && px <= r2.rx + r2.rw && py >= r2.ry && py <= r2.ry + r2.rh) ? 'grab' : 'default';
          }
        }
        return;
      }
      const maxX = (_cropPrev.imgW - _cropPrev.cropW) / 2;
      const maxY = (_cropPrev.imgH - _cropPrev.cropH) / 2;
      const dxImg = (px - _cropPrev.dragStartX) / (_cropPrev.scale || 1);
      const dyImg = (py - _cropPrev.dragStartY) / (_cropPrev.scale || 1);
      const newOffX = clamp(_cropPrev.startOffsetX + (dxImg / (maxX || 1)) * 100, -100, 100);
      const newOffY = clamp(_cropPrev.startOffsetY + (dyImg / (maxY || 1)) * 100, -100, 100);
      $('#cropOffsetX').value = Math.round(newOffX * 100) / 100;
      $('#cropOffsetY').value = Math.round(newOffY * 100) / 100;
      renderCropPreview();
    });
    canvas.addEventListener('pointerup', () => { _cropPrev.dragging = false; _cropPrev.resizeHandle = undefined; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('pointerleave', () => { _cropPrev.dragging = false; _cropPrev.resizeHandle = undefined; canvas.style.cursor = 'grab'; });
  }

  const WORD_PROCESSOR_TOOLS = new Set([
    'wordToPdf', 'wordToJpg', 'wordToPng', 'wordToTxt', 'wordToHtml', 'wordToMarkdown', 'wordToEpub', 'wordToOdt',
    'mergeWord', 'splitWord', 'repairWord', 'compressWord', 'stripMetadataWord', 'formatDocument', 'tocWord',
    'extractWord', 'findReplaceWord', 'tablesWordToExcel', 'removeBlankPagesWord', 'odtToWord', 'rtfToWord',
    'formatDocumentApa7'
  ]);
  const XLSX_PROCESSOR_TOOLS = new Set([
    'csvToExcel', 'excelToCsv', 'excelToJson', 'jsonToExcel', 'csvToJson', 'jsonToCsv',
    'mergeExcel', 'splitExcel', 'compareExcel', 'xlsToXlsx', 'xlsxToOds', 'odsToXlsx',
    'tablesWordToExcel', 'pdfTablesToExcel', 'imageTableToExcel',
    'csvToMarkdown', 'csvToHtml', 'csvToYaml', 'csvStatistics', 'csvFilter', 'csvSort', 'csvToSql',
    'excelToHtml', 'excelToMarkdown', 'excelToXml', 'xmlToExcel',
    'jsonFormatter', 'jsonValidator'
  ]);
  // Estas bibliotecas representan una parte importante del peso inicial de cada
  // página. Se resuelven al ejecutar la herramienta, nunca al abrir su página.
  const PDF_RENDERER_TOOLS = new Set([
    'mergePdf', 'imagesPdf', 'splitPdf', 'reorderPdf', 'pdfToImages', 'signPdf',
    'compressPdf', 'comparePdfs', 'scannedPdfToSearchablePdf',
    'extractTextFromScannedPdf', 'detectOcrNeeded', 'pdfTablesToExcel', 'censorPdf',
    'verifyPdfCensor', 'pdfPageCounter'
  ]);
  // Estos inicializadores inspeccionan el PDF seleccionado. No deben ejecutarse
  // al abrir una página porque PDFLib se carga bajo demanda.
  const PDF_INITIALIZER_TOOLS = new Set([
    'splitPdf', 'reorderPdf', 'pdfToImages', 'signPdf', 'deletePagesPdf',
    'duplicatePagesPdf', 'insertBlankPagesPdf', 'editMetadataPdf',
    'compressPdf', 'interleavePdf', 'cropPdf', 'resizePdfPages', 'nUpPdf',
    'splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf',
    'addHeaderFooterPdf'
  ]);
  const ARCHIVE_PROCESSOR_TOOLS = new Set([
    ...WORD_PROCESSOR_TOOLS,
    'txtToEpub', 'mergeEpub', 'splitEpub', 'editMetadataEpub', 'coverEpub',
    'imagesEpub', 'validateEpub', 'repairEpub', 'epubToTxt', 'epubToHtml',
    'epubToMarkdown', 'unzipFile', 'createZipAdvanced', 'zipRepair', 'fileJoin', 'pdfToImages',
    'splitTxt', 'convert', 'batchCompress', 'advancedConvert', 'comparePdfs', 'qrBatchFromCsv'
  ]);
  const ENGINE_PROCESSOR_TOOLS = new Set([
    'imageTableToExcel', 'pdfTablesToExcel', 'scannedPdfToSearchablePdf',
    'imageToSearchablePdf', 'extractTextFromScannedPdf', 'detectOcrNeeded',
    'convertAudio', 'trimAudio', 'mergeAudio', 'compressVideo', 'trimVideo',
    'mergeVideos', 'videoToGif', 'extractAudioFromVideo', 'removeAudioFromVideo'
  ]);
  const optionalDependencyPromises = new Map();

  function loadOptionalDependency(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    const key = `${src}|${globalName}`;
    if (optionalDependencyPromises.has(key)) return optionalDependencyPromises.get(key);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => window[globalName]
        ? resolve(window[globalName])
        : reject(new Error(`El componente ${globalName} no estuvo disponible.`));
      script.onerror = () => reject(new Error(`No se pudo cargar el componente ${globalName}.`));
      document.head.appendChild(script);
    }).catch((error) => {
      optionalDependencyPromises.delete(key);
      throw error;
    });
    optionalDependencyPromises.set(key, promise);
    return promise;
  }

  async function ensureToolDependencies(tool) {
    const dependencies = [];
    // PDFLib se usa tanto en los procesadores PDF como para generar un PDF
    // desde imagen, Word o texto. pdf.js solo se incorpora para las variantes
    // que necesitan leer/renderizar páginas; su worker continúa siendo local.
    if (/pdf/i.test(tool) || tool === 'imagesPdf' || tool === 'wordToPdf' || tool === 'txtToPdf') {
      dependencies.push(loadOptionalDependency('./vendor/pdflib/pdf-lib.min.js', 'PDFLib'));
    }
    if (PDF_RENDERER_TOOLS.has(tool)) {
      dependencies.push(loadOptionalDependency('./vendor/pdfjs/pdf.min.js', 'pdfjsLib'));
    }
    if (ARCHIVE_PROCESSOR_TOOLS.has(tool)) {
      dependencies.push(loadOptionalDependency('./vendor/jszip/jszip.min.js', 'JSZip'));
    }
    if (WORD_PROCESSOR_TOOLS.has(tool)) {
      dependencies.push(loadOptionalDependency('./vendor/mammoth/mammoth.browser.min.js', 'mammoth'));
      dependencies.push(loadOptionalDependency('./vendor/docx/docx.min.js', 'docx'));
    }
    if (XLSX_PROCESSOR_TOOLS.has(tool)) {
      dependencies.push(loadOptionalDependency('./vendor/xlsx/xlsx.min.js', 'XLSX'));
    }
    if (ENGINE_PROCESSOR_TOOLS.has(tool)) {
      dependencies.push(loadOptionalDependency('./vendor/js/engine-loader.js', 'EngineLoader'));
    }
    if (dependencies.length) await Promise.all(dependencies);
  }
  window.ToolistoEnsureDependencies = ensureToolDependencies;

  async function runCurrentTool() {
    if (state.toolDisabled) {
      showToast('Esta herramienta está temporalmente en revisión.');
      return;
    }
    if (state.processing || !state.tool || !state.files.length) return;
    const validation = validateToolFiles(state.tool, state.files);
    if (!validation.ok) {
      state.processPhase = 'validation';
      showProcessFeedback(validation.message);
      return showToast(validation.message);
    }

    state.processing = true;
    state.processStartTime = Date.now();
    state.processError = null;
    state.processPhase = '';
    clearProcessFeedback();
    const originalText = els.runButton.innerHTML;
    els.runButton.innerHTML = '<span>Preparando componentes…</span><span aria-hidden="true">•••</span>';
    els.runButton.disabled = true;

    const options = {};
    document.querySelectorAll('#advancedControls input, #advancedControls select').forEach(el => {
      if (el.id) options[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    const optionAliases = {
      convertAudio: { audioOutputFormat: 'outputFormat', audioBitrate: 'bitrate' },
      trimAudio: { trimAudioStart: 'startTime', trimAudioEnd: 'endTime', trimAudioFormat: 'outputFormat' },
      mergeAudio: { mergeAudioFormat: 'outputFormat' },
      compressVideo: { videoQuality: 'quality', videoOutputFormat: 'outputFormat' },
      trimVideo: { trimVideoStart: 'startTime', trimVideoEnd: 'endTime', trimVideoFormat: 'outputFormat' },
      mergeVideos: { mergeVideoFormat: 'outputFormat' },
      videoToGif: { gifStart: 'startTime', gifEnd: 'endTime', gifFps: 'fps', gifWidth: 'width' },
      extractAudioFromVideo: { extractAudioFormat: 'outputFormat' },
      removeAudioFromVideo: { removeAudioFormat: 'outputFormat' },
      scannedPdfToSearchablePdf: { ocrLanguage: 'language', ocrPages: 'pages' },
      imageToSearchablePdf: { ocrLanguage: 'language' },
      extractTextFromScannedPdf: { ocrLanguage: 'language', ocrPages: 'pages' },
      detectOcrNeeded: {},
      pdfEncryptAdvanced: { pdfUserPassword: 'userPassword', pdfOwnerPassword: 'ownerPassword', pdfAllowPrint: 'allowPrint', pdfAllowCopy: 'allowCopy', pdfAllowModify: 'allowModify' },
    };
    const aliases = optionAliases[state.tool];
    if (aliases) {
      for (const [controlId, optionName] of Object.entries(aliases)) {
        if (controlId in options) {
          options[optionName] = options[controlId];
          delete options[controlId];
        }
      }
      if (options.outputFormat === 'same') delete options.outputFormat;
    }

    try {
      await ensureToolDependencies(state.tool);
      let result;
      if (window.ToolProcessors && window.ToolProcessors[state.tool]) {
        result = await window.ToolProcessors[state.tool](state.files, options, (cur, total, msg) => {
          els.runButton.innerHTML = `<span>${escapeHtml(msg || 'Procesando…')} ${Number(cur) || 0}/${Number(total) || 0}</span><span>•••</span>`;
        });
      } else {
        result = await runBuiltinTool(state.tool, state.files, options);
      }

      if (result && result.summary) {
        presentSummaryResult(result.summary);
        return;
      }
      if (!result || !result.files || !result.files.length) {
        state.processPhase = 'validation';
        const message = result?.message || 'No se pudo procesar el archivo.';
        showProcessFeedback(message);
        showToast(message);
        return;
      }

      state.outputFiles = result.files;
      state.processPhase = 'completed';
      if (result.metadata) {
        presentMetadataResult(result);
      } else {
        showResult({
          title: result.title || result.message || 'Procesamiento completado',
          message: result.message || `${result.files.length} archivo(s) listo(s) para descargar.`,
          stats: result.stats || result.files.map(f => [f.name, formatBytes(f.size)]),
          preview: result.preview || (result.files.length === 1 ? result.files[0].blob : null),
          files: result.files,
        });
      }
    } catch (error) {
      state.processError = error;
      state.processPhase = 'failed';
      const message = friendlyErrorMessage(error, state.tool);
      showProcessFeedback(message);
      showToast(message);
    } finally {
      state.processing = false;
      els.runButton.innerHTML = originalText;
      els.runButton.disabled = false;
    }
  }

  async function runBuiltinTool(tool, files, options) {
    state.processStartTime = Date.now();
    clearPreviousOutput();
    let result;
    switch (tool) {
      case 'compress': result = await processCompress(); break;
      case 'signature': result = await processSignature(); break;
      case 'imagesPdf': result = await processImagesToPdf(); break;
      case 'mergePdf': result = await processMergePdf(); break;
      case 'crop': result = await processCrop(); break;
      case 'convert': result = await processConvert(); break;
      case 'removeObjects': result = await processRemoveObjects(); break;
      case 'batchCompress': result = await processBatchCompress(); break;
      case 'stripMetadata': result = await processStripMetadata(); break;
      case 'socialCrop': result = await processSocialCrop(); break;
      case 'splitPdf': result = await processSplitPdf(); break;
      case 'reorderPdf': result = await processReorderPdf(); break;
      case 'pdfToImages': result = await processPdfToImages(); break;
      case 'signPdf': result = await processSignPdf(); break;
      case 'rotatePdf': result = await processRotatePdf(); break;
      case 'deletePagesPdf': result = await processDeletePagesPdf(); break;
      case 'reversePagesPdf': result = await processReversePagesPdf(); break;
      case 'duplicatePagesPdf': result = await processDuplicatePagesPdf(); break;
      case 'insertBlankPagesPdf': result = await processInsertBlankPagesPdf(); break;
      case 'editMetadataPdf': result = await processEditMetadataPdf(); break;
      case 'compressPdf': result = await processCompressPdf(); break;
      case 'interleavePdf': result = await processInterleavePdf(); break;
      case 'cropPdf': result = await processCropPdf(); break;
      case 'resizePdfPages': result = await processResizePdfPages(); break;
      case 'nUpPdf': result = await processNUpPdf(); break;
      case 'splitDoublePdf': result = await processSplitDoublePdf(); break;
      case 'bookletPdf': result = await processBookletPdf(); break;
      case 'watermarkPdf': result = await processWatermarkPdf(); break;
      case 'addPageNumbersPdf': result = await processAddPageNumbersPdf(); break;
      case 'addHeaderFooterPdf': result = await processAddHeaderFooterPdf(); break;
      case 'docPhoto': result = await processDocPhoto(); break;
      case 'censor': result = await processCensor(); break;
      case 'fixFormat': result = await processFixFormat(); break;
      case 'rescueDoc': result = await processRescueDoc(); break;
      case 'fileCompliance': result = await processFileCompliance(); break;
      case 'workflow': result = await processWorkflow(); break;
      case 'advancedConvert': result = await processAdvancedConvert(); break;
      case 'colorPicker': result = await processColorPicker(); break;
      case 'imageCompare': result = await processImageCompare(); break;
      default: throw new Error('Selecciona una herramienta.');
    }
    if (!result) return null;
    if (result.summary) return result;
    return {
      files: [{ name: result.name, size: result.blob.size, blob: result.blob }],
      message: result.message || result.title,
      title: result.title,
      stats: result.stats,
      preview: result.preview,
    };
  }

  function showResult(data) {
    if (!data.files || !data.files.length) return;
    presentResult({
      blob: data.files[0].blob,
      name: data.files[0].name,
      title: data.title || 'Procesamiento completado',
      message: data.message || `${data.files.length} archivo(s) listo(s).`,
      stats: data.stats || data.files.map(f => [f.name, formatBytes(f.size)]),
      preview: data.preview || (data.files.length === 1 ? data.files[0].blob : null),
    });
  }

  async function processCompress() {
    const file = state.files[0];
    const image = await loadImage(file);
    const preset = valueOf('compressPreset', 'auto');
    const purpose = valueOf('compressPurpose', 'auto');
    const isAdvanced = preset === 'custom';
    let targetKb, maxWidth, initialQuality, requestedMime;
    if (preset === 'auto' || preset === 'balanced') {
      targetKb = purpose === 'whatsapp' ? 300 : purpose === 'email' ? 400 : purpose === 'web' ? 250 : purpose === 'document' ? 500 : Math.max(150, Math.round(file.size / 1024 * 0.45));
      maxWidth = purpose === 'web' ? 1200 : purpose === 'whatsapp' ? 1600 : 0;
      initialQuality = purpose === 'whatsapp' ? .72 : purpose === 'web' ? .78 : .82;
      requestedMime = 'auto';
    } else if (preset === 'quality') {
      targetKb = Math.max(200, Math.round(file.size / 1024 * 0.85));
      maxWidth = 0;
      initialQuality = .92;
      requestedMime = 'auto';
    } else if (preset === 'max') {
      targetKb = Math.max(20, Math.round(file.size / 1024 * 0.2));
      maxWidth = 800;
      initialQuality = .55;
      requestedMime = 'auto';
    } else {
      targetKb = clamp(numberValue('targetKb', 500), 20, 10000);
      maxWidth = clamp(numberValue('compressWidth', 0), 0, 10000);
      initialQuality = clamp(numberValue('compressQuality', 84) / 100, .25, 1);
      requestedMime = valueOf('compressFormat', 'auto');
    }
    const targetBytes = targetKb * 1024;
    const mime = requestedMime === 'auto' ? (file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp') : requestedMime;

    let width = image.naturalWidth;
    let height = image.naturalHeight;
    if (maxWidth > 0 && width > maxWidth) {
      height = Math.round(height * maxWidth / width);
      width = maxWidth;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    let blob = null;

    for (let scalePass = 0; scalePass < 7; scalePass++) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      if (mime === 'image/png') {
        blob = await canvasToBlob(canvas, mime, 1);
      } else {
        let low = .22;
        let high = initialQuality;
        let best = await canvasToBlob(canvas, mime, low);
        for (let i = 0; i < 9; i++) {
          const quality = (low + high) / 2;
          const candidate = await canvasToBlob(canvas, mime, quality);
          if (candidate.size <= targetBytes) {
            best = candidate;
            low = quality;
          } else {
            high = quality;
          }
        }
        blob = best;
      }

      if (blob.size <= targetBytes || Math.min(width, height) < 320) break;
      const factor = Math.max(.62, Math.min(.92, Math.sqrt(targetBytes / blob.size) * .94));
      width *= factor;
      height *= factor;
    }

    const extension = extensionForMime(mime);
    const reduction = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
    const outW = canvas.width;
    const outH = canvas.height;
    const previewInfoEl = document.getElementById('compressPreviewInfo');
    if (previewInfoEl) {
      previewInfoEl.style.display = '';
      previewInfoEl.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.85rem">' +
        '<div><div style="font-weight:700;margin-bottom:4px;color:var(--muted)">ORIGINAL</div><div>' + formatBytes(file.size) + '</div><div>' + image.naturalWidth + ' × ' + image.naturalHeight + '</div></div>' +
        '<div><div style="font-weight:700;margin-bottom:4px;color:var(--c-primary)">RESULTADO</div><div>' + formatBytes(blob.size) + '</div><div>' + outW + ' × ' + outH + '</div></div>' +
        '</div><div style="margin-top:8px;font-weight:700;color:var(--c-success,#16835b)">' + reduction + '% menos peso</div>';
    }
    return {
      blob,
      name: `${baseName(file.name)}-optimizada.${extension}`,
      title: 'Imagen optimizada',
      message: blob.size <= targetBytes ? 'La imagen quedó por debajo del peso objetivo.' : 'La imagen se redujo al máximo posible.',
      preview: blob,
      stats: [
        ['Antes', formatBytes(file.size)],
        ['Después', formatBytes(blob.size)],
        ['Reducción', `${reduction}%`],
        ['Dimensiones', `${outW} × ${outH}`],
      ],
    };
  }

  async function processSignature() {
    const file = state.files[0];
    const image = await loadImage(file);
    const threshold = clamp(numberValue('signatureThreshold', 215), 120, 250);
    const softness = clamp(numberValue('signatureSoftness', 26), 1, 80);
    const ink = hexToRgb(valueOf('signatureInk', '#173b62'));
    const padding = clamp(numberValue('signaturePadding', 18), 0, 100);

    const source = document.createElement('canvas');
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(image, 0, 0);
    const imgData = sctx.getImageData(0, 0, source.width, source.height);
    const d = imgData.data;
    let minX = source.width, minY = source.height, maxX = -1, maxY = -1;

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const i = (y * source.width + x) * 4;
        const brightness = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
        const alpha = clamp((threshold + softness - brightness) / (2 * softness), 0, 1);
        d[i] = ink.r;
        d[i + 1] = ink.g;
        d[i + 2] = ink.b;
        d[i + 3] = Math.round(alpha * 255);
        if (alpha > .08) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    sctx.putImageData(imgData, 0, 0);
    if (maxX < minX || maxY < minY) throw new Error('No se detectó suficiente tinta. Baja el nivel de blanco a eliminar.');

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const output = document.createElement('canvas');
    output.width = cropW + padding * 2;
    output.height = cropH + padding * 2;
    output.getContext('2d').drawImage(source, minX, minY, cropW, cropH, padding, padding, cropW, cropH);
    const blob = await canvasToBlob(output, 'image/png', 1);

    return {
      blob,
      name: `${baseName(file.name)}-firma-transparente.png`,
      title: 'Firma transparente lista',
      message: 'Se eliminó el fondo claro y se recortó el espacio sobrante.',
      preview: blob,
      stats: [['Formato','PNG'],['Dimensiones',`${output.width} × ${output.height}`],['Fondo','Transparente']],
    };
  }

  async function processImagesToPdf() {
    ensurePdfLib();
    const { PDFDocument, rgb } = window.PDFLib;
    const pdf = await PDFDocument.create();
    const pageSetting = valueOf('pdfPageSize', 'a4');
    const orientationSetting = valueOf('pdfOrientation', 'auto');
    const margin = clamp(numberValue('pdfMargin', 24), 0, 100);
    const bgColor = valueOf('pdfBackground', 'none');

    for (const file of state.files) {
      const normalized = await normalizeImageForPdf(file);
      const bytes = await normalized.blob.arrayBuffer();
      const embedded = normalized.mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const imgW = embedded.width;
      const imgH = embedded.height;
      let pageW, pageH;

      if (pageSetting === 'image') {
        pageW = imgW;
        pageH = imgH;
      } else {
        const base = pageSetting === 'letter' ? [612, 792] : [595.28, 841.89];
        const landscape = orientationSetting === 'landscape' || (orientationSetting === 'auto' && imgW > imgH);
        [pageW, pageH] = landscape ? [base[1], base[0]] : base;
      }

      const page = pdf.addPage([pageW, pageH]);
      if (bgColor && bgColor !== 'none') {
        const hex = bgColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(r, g, b) });
      }
      const availableW = Math.max(1, pageW - margin * 2);
      const availableH = Math.max(1, pageH - margin * 2);
      const scale = Math.min(availableW / imgW, availableH / imgH, pageSetting === 'image' ? 1 : Infinity);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      page.drawImage(embedded, { x:(pageW-drawW)/2, y:(pageH-drawH)/2, width:drawW, height:drawH });
    }

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type:'application/pdf' });
    return {
      blob,
      name: 'toolisto-imagenes.pdf',
      title: 'PDF creado',
      message: `Se generó un documento con ${state.files.length} página${state.files.length === 1 ? '' : 's'}.`,
      stats: [['Archivos',String(state.files.length)],['Páginas',String(state.files.length)],['Tamaño',formatBytes(blob.size)]],
    };
  }

  async function processMergePdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();
    let pageCount = 0;

    for (const file of state.files) {
      let source;
      try {
        source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
      } catch (err) {
        if (err?.message?.includes('password') || err?.message?.includes('Encrypted') || err?.message?.includes('encrypted')) {
          throw new Error(`El archivo "${file.name}" parece estar protegido con contraseña. No se puede unir.`);
        }
        throw new Error(`No se pudo abrir "${file.name}". Puede estar corrupto.`);
      }
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
      pageCount += pages.length;
    }

    const bytes = await merged.save();
    const blob = new Blob([bytes], { type:'application/pdf' });
    return {
      blob,
      name: 'toolisto-pdf-unido.pdf',
      title: 'PDF combinado',
      message: 'Los documentos se unieron respetando el orden visible.',
      stats: [['Documentos',String(state.files.length)],['Páginas',String(pageCount)],['Tamaño',formatBytes(blob.size)]],
    };
  }

  async function processCrop() {
    const file = state.files[0];
    const image = await loadImage(file);
    const preset = valueOf('cropPreset', 'square');
    const presetSizes = { square:[1080,1080], tiktok:[1080,1920], twoByTwo:[600,600], visa:[413,531] };
    const [targetW, targetH] = presetSizes[preset] || [clamp(numberValue('cropWidth',1080),50,8000), clamp(numberValue('cropHeight',1080),50,8000)];
    const mime = valueOf('cropFormat', 'image/jpeg');
    const zoom = clamp(numberValue('cropZoom',100)/100,1,3);
    const offsetX = clamp(numberValue('cropOffsetX',0)/100,-1,1);
    const offsetY = clamp(numberValue('cropOffsetY',0)/100,-1,1);

    const targetRatio = targetW / targetH;
    const imageRatio = image.naturalWidth / image.naturalHeight;
    let cropW, cropH;
    if (imageRatio > targetRatio) {
      cropH = image.naturalHeight / zoom;
      cropW = cropH * targetRatio;
    } else {
      cropW = image.naturalWidth / zoom;
      cropH = cropW / targetRatio;
    }
    cropW = Math.min(cropW, image.naturalWidth);
    cropH = Math.min(cropH, image.naturalHeight);
    const maxX = (image.naturalWidth - cropW) / 2;
    const maxY = (image.naturalHeight - cropH) / 2;
    const sx = maxX + offsetX * maxX;
    const sy = maxY + offsetY * maxY;

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,targetW,targetH);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, targetW, targetH);
    const blob = await canvasToBlob(canvas, mime, .92);

    return {
      blob,
      name: `${baseName(file.name)}-${targetW}x${targetH}.${extensionForMime(mime)}`,
      title: 'Imagen preparada',
      message: `La imagen se recortó y exportó a ${targetW} × ${targetH} píxeles.`,
      preview: blob,
      stats: [['Dimensiones',`${targetW} × ${targetH}`],['Formato',extensionForMime(mime).toUpperCase()],['Tamaño',formatBytes(blob.size)]],
    };
  }

  async function processConvert() {
    if (!window.JSZip && state.files.length > 1) throw new Error('No se pudo cargar el componente para crear ZIP.');
    const mime = valueOf('convertFormat', 'image/webp');
    const quality = clamp(numberValue('convertQuality',86)/100,.25,1);
    const maxWidth = clamp(numberValue('convertWidth',0),0,10000);
    const converted = [];

    for (const file of state.files) {
      const image = await loadImage(file);
      let width = image.naturalWidth;
      let height = image.naturalHeight;
      if (maxWidth > 0 && width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha:mime !== 'image/jpeg' });
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,width,height);
      }
      ctx.drawImage(image,0,0,width,height);

      if (mime === 'image/jpeg' && (file.type === 'image/png' || file.type === 'image/webp')) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tctx = tempCanvas.getContext('2d');
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, width, height);
        tctx.drawImage(image, 0, 0, width, height);
        canvas.getContext('2d').drawImage(tempCanvas, 0, 0);
      }

      const blob = await canvasToBlob(canvas,mime,quality);
      converted.push({ blob, name:`${baseName(file.name)}.${extensionForMime(mime)}` });
    }

    if (converted.length === 1) {
      const single = converted[0];
      return {
        blob:single.blob,
        name:single.name,
        title:'Imagen convertida',
        message:`El archivo se convirtió a ${extensionForMime(mime).toUpperCase()}.`,
        preview:single.blob,
        stats:[['Formato',extensionForMime(mime).toUpperCase()],['Tamaño',formatBytes(single.blob.size)],['Archivos','1']],
      };
    }

    const zip = new window.JSZip();
    converted.forEach((item) => zip.file(item.name,item.blob));
    const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } });
    return {
      blob,
      name:'toolisto-imagenes-convertidas.zip',
      title:'Lote convertido',
      message:`Se convirtieron ${converted.length} imágenes y se reunieron en un ZIP.`,
      stats:[['Archivos',String(converted.length)],['Formato',extensionForMime(mime).toUpperCase()],['ZIP',formatBytes(blob.size)]],
    };
  }

  const _ro = { canvas:null, ctx:null, mask:null, original:null, history:[], redoStack:[], mode:'brush', drawing:false, lastX:0, lastY:0, brushSize:20, imageW:0, imageH:0, displayW:0, displayH:0, offX:0, offY:0, resultData:null, zoom:1 };

  function initRemoveObjectsEditor() {
    const confirm = $('#removeObjectsConfirm');
    const brushSection = $('#removeObjectsBrushSection');
    const actions = $('#removeObjectsActions');
    const previewToggle = $('#removeObjectsPreviewToggle');
    const outputSection = $('#removeObjectsOutputSection');
    const canvasWrap = $('#removeObjectsCanvasWrap');
    if (!confirm || !brushSection || !actions || !canvasWrap) return;

    confirm.addEventListener('change', () => {
      const enabled = confirm.checked;
      brushSection.hidden = !enabled;
      actions.hidden = !enabled;
      previewToggle.hidden = !enabled;
      outputSection.hidden = !enabled;
      els.runButton.disabled = !enabled;
      if (enabled && state.files.length) loadRemoveObjectsImage();
    });

    const brushBtn = $('#removeObjectsBrushBtn');
    const eraserBtn = $('#removeObjectsEraserBtn');
    const undoBtn = $('#removeObjectsUndoBtn');
    const redoBtn = $('#removeObjectsRedoBtn');
    const resetBtn = $('#removeObjectsResetBtn');
    const brushSizeInput = $('#removeObjectsBrushSize');
    const showResult = $('#removeObjectsShowResult');

    if (brushBtn) brushBtn.addEventListener('click', () => { _ro.mode = 'brush'; brushBtn.style.background = 'var(--c-primary)'; brushBtn.style.color = '#fff'; brushBtn.style.borderColor = 'var(--c-primary)'; eraserBtn.style.background = ''; eraserBtn.style.color = ''; eraserBtn.style.borderColor = ''; });
    if (eraserBtn) eraserBtn.addEventListener('click', () => { _ro.mode = 'eraser'; eraserBtn.style.background = 'var(--c-primary)'; eraserBtn.style.color = '#fff'; eraserBtn.style.borderColor = 'var(--c-primary)'; brushBtn.style.background = ''; brushBtn.style.color = ''; brushBtn.style.borderColor = ''; });
    if (brushSizeInput) brushSizeInput.addEventListener('input', () => { _ro.brushSize = Number(brushSizeInput.value) || 20; });
    if (undoBtn) undoBtn.addEventListener('click', roUndo);
    if (redoBtn) redoBtn.addEventListener('click', roRedo);
    if (resetBtn) resetBtn.addEventListener('click', roReset);
    if (showResult) showResult.addEventListener('change', () => { if (_ro.canvas) roRenderDisplay(); });
  }

  async function loadRemoveObjectsImage() {
    const file = state.files[0];
    if (!file) return;
    const image = await loadImage(file);
    _ro.imageW = image.naturalWidth;
    _ro.imageH = image.naturalHeight;
    _ro.original = image;
    _ro.history = [];
    _ro.redoStack = [];
    _ro.resultData = null;
    const showResult = $('#removeObjectsShowResult');
    if (showResult) showResult.checked = false;

    const source = document.createElement('canvas');
    source.width = _ro.imageW;
    source.height = _ro.imageH;
    source.getContext('2d').drawImage(image, 0, 0);
    _ro.sourceCanvas = source;
    _ro.sourceData = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, _ro.imageW, _ro.imageH);

    _ro.mask = new Uint8Array(_ro.imageW * _ro.imageH);

    const wrap = $('#removeObjectsCanvasWrap');
    if (!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML = '';

    const maxDisplay = Math.min(wrap.parentElement.clientWidth || 600, 800);
    _ro.zoom = Math.min(maxDisplay / _ro.imageW, maxDisplay / _ro.imageH, 1);
    _ro.displayW = Math.round(_ro.imageW * _ro.zoom);
    _ro.displayH = Math.round(_ro.imageH * _ro.zoom);

    const canvas = document.createElement('canvas');
    canvas.width = _ro.displayW;
    canvas.height = _ro.displayH;
    canvas.style.cssText = 'width:100%;max-width:' + _ro.displayW + 'px;border-radius:8px;cursor:crosshair;display:block;touch-action:none';
    _ro.canvas = canvas;
    _ro.ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);

    roRenderDisplay();

    canvas.addEventListener('pointerdown', roPointerDown);
    canvas.addEventListener('pointermove', roPointerMove);
    canvas.addEventListener('pointerup', roPointerUp);
    canvas.addEventListener('pointerleave', roPointerUp);

    roUpdateButtons();
  }

  function roGetPos(e) {
    const rect = _ro.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * _ro.displayW,
      y: (e.clientY - rect.top) / rect.height * _ro.displayH,
    };
  }

  function roPointerDown(e) {
    if (!_ro.canvas) return;
    e.preventDefault();
    _ro.canvas.setPointerCapture(e.pointerId);
    _ro.drawing = true;
    const pos = roGetPos(e);
    _ro.lastX = pos.x;
    _ro.lastY = pos.y;
    roSaveState();
    roPaint(pos.x, pos.y);
  }

  function roPointerMove(e) {
    if (!_ro.drawing || !_ro.canvas) return;
    e.preventDefault();
    const pos = roGetPos(e);
    const dx = pos.x - _ro.lastX;
    const dy = pos.y - _ro.lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, _ro.brushSize * _ro.zoom * 0.15);
    const steps = Math.ceil(dist / step);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      roPaint(_ro.lastX + dx * t, _ro.lastY + dy * t);
    }
    _ro.lastX = pos.x;
    _ro.lastY = pos.y;
  }

  function roPointerUp(e) {
    if (_ro.drawing) {
      _ro.drawing = false;
      _ro.resultData = null;
      const showResult = $('#removeObjectsShowResult');
      if (showResult) showResult.checked = false;
    }
  }

  function roPaint(cx, cy) {
    const r = Math.round(_ro.brushSize * _ro.zoom / 2);
    const mw = _ro.imageW;
    const mh = _ro.imageH;
    const imgCx = Math.round(cx / _ro.zoom);
    const imgCy = Math.round(cy / _ro.zoom);
    const isBrush = _ro.mode === 'brush';

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = imgCx + dx;
        const py = imgCy + dy;
        if (px < 0 || px >= mw || py < 0 || py >= mh) continue;
        const idx = py * mw + px;
        _ro.mask[idx] = isBrush ? 1 : 0;
      }
    }
    roRenderDisplay();
  }

  function roRenderDisplay() {
    if (!_ro.ctx || !_ro.canvas) return;
    const showResult = $('#removeObjectsShowResult')?.checked && _ro.resultData;
    const ctx = _ro.ctx;
    const dw = _ro.displayW;
    const dh = _ro.displayH;

    if (showResult) {
      const tmp = document.createElement('canvas');
      tmp.width = _ro.imageW;
      tmp.height = _ro.imageH;
      tmp.getContext('2d').putImageData(_ro.resultData, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, dw, dh);
      return;
    }

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_ro.sourceCanvas, 0, 0, dw, dh);

    const tmpMask = document.createElement('canvas');
    tmpMask.width = _ro.imageW;
    tmpMask.height = _ro.imageH;
    const mctx = tmpMask.getContext('2d');
    const mData = mctx.createImageData(_ro.imageW, _ro.imageH);
    const md = mData.data;
    for (let i = 0; i < _ro.mask.length; i++) {
      if (_ro.mask[i]) {
        const pi = i * 4;
        md[pi] = 59;
        md[pi + 1] = 130;
        md[pi + 2] = 246;
        md[pi + 3] = 90;
      }
    }
    mctx.putImageData(mData, 0, 0);
    ctx.drawImage(tmpMask, 0, 0, dw, dh);

    const brushR = _ro.brushSize * _ro.zoom / 2;
    ctx.beginPath();
    ctx.arc(dw / 2, dh / 2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(59,130,246,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function roSaveState() {
    _ro.history.push(new Uint8Array(_ro.mask));
    if (_ro.history.length > 50) _ro.history.shift();
    _ro.redoStack = [];
    roUpdateButtons();
  }

  function roUndo() {
    if (!_ro.history.length) return;
    _ro.redoStack.push(new Uint8Array(_ro.mask));
    _ro.mask = _ro.history.pop();
    _ro.resultData = null;
    const showResult = $('#removeObjectsShowResult');
    if (showResult) showResult.checked = false;
    roRenderDisplay();
    roUpdateButtons();
  }

  function roRedo() {
    if (!_ro.redoStack.length) return;
    _ro.history.push(new Uint8Array(_ro.mask));
    _ro.mask = _ro.redoStack.pop();
    _ro.resultData = null;
    const showResult = $('#removeObjectsShowResult');
    if (showResult) showResult.checked = false;
    roRenderDisplay();
    roUpdateButtons();
  }

  function roReset() {
    if (!_ro.mask) return;
    _ro.mask.fill(0);
    _ro.history = [];
    _ro.redoStack = [];
    _ro.resultData = null;
    const showResult = $('#removeObjectsShowResult');
    if (showResult) showResult.checked = false;
    roRenderDisplay();
    roUpdateButtons();
  }

  function roUpdateButtons() {
    const undoBtn = $('#removeObjectsUndoBtn');
    const redoBtn = $('#removeObjectsRedoBtn');
    if (undoBtn) undoBtn.disabled = !_ro.history.length;
    if (redoBtn) redoBtn.disabled = !_ro.redoStack.length;
  }

  function removeObjectsInpaint(srcData, mask, w, h) {
    const src = new Uint8ClampedArray(srcData.data);
    const out = new Uint8ClampedArray(src);
    const m = new Uint8Array(mask);
    const totalPixels = w * h;
    let maskedCount = 0;
    for (let i = 0; i < totalPixels; i++) { if (m[i]) maskedCount++; }
    if (maskedCount === 0) return new ImageData(out, w, h);

    const maxMaskedPercent = 0.35;
    if (maskedCount / totalPixels > maxMaskedPercent) return null;

    const maxIter = Math.min(800, Math.max(100, maskedCount * 2));
    let filled = 0;
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (!m[idx]) continue;
          let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              const nIdx = ny * w + nx;
              if (!m[nIdx]) {
                const pi = nIdx * 4;
                rSum += out[pi];
                gSum += out[pi + 1];
                bSum += out[pi + 2];
                aSum += out[pi + 3];
                count++;
              }
            }
          }
          if (count > 0) {
            const pi = idx * 4;
            out[pi] = Math.round(rSum / count);
            out[pi + 1] = Math.round(gSum / count);
            out[pi + 2] = Math.round(bSum / count);
            out[pi + 3] = Math.round(aSum / count);
            m[idx] = 0;
            changed = true;
            filled++;
          }
        }
      }
      if (!changed) break;
    }

    if (filled < maskedCount * 0.7) return null;
    return new ImageData(out, w, h);
  }

  async function processRemoveObjects() {
    const confirm = $('#removeObjectsConfirm');
    if (!confirm?.checked) throw new Error('Debes confirmar que tienes autorización para modificar la imagen.');

    const hasMask = _ro.mask && _ro.mask.some(v => v);
    if (!hasMask) throw new Error('Pinta la zona que quieres eliminar antes de procesar.');

    const formatSetting = valueOf('removeObjectsFormat', 'auto');
    const quality = clamp(numberValue('removeObjectsQuality', 92) / 100, 0.25, 1);
    const file = state.files[0];
    const origType = file.type;

    let resultData;
    try {
      resultData = removeObjectsInpaint(_ro.sourceData, _ro.mask, _ro.imageW, _ro.imageH);
    } catch (_) {
      resultData = null;
    }

    if (!resultData) throw new Error('Esta zona contiene demasiados detalles. Prueba seleccionando áreas más pequeñas para obtener un mejor resultado.');

    _ro.resultData = resultData;
    const showResult = $('#removeObjectsShowResult');
    if (showResult) showResult.checked = true;
    roRenderDisplay();

    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = _ro.imageW;
    resultCanvas.height = _ro.imageH;
    resultCanvas.getContext('2d').putImageData(resultData, 0, 0);

    let mime, ext;
    if (formatSetting === 'auto') {
      if (origType === 'image/png') { mime = 'image/png'; ext = 'png'; }
      else if (origType === 'image/webp') { mime = 'image/webp'; ext = 'webp'; }
      else { mime = 'image/jpeg'; ext = 'jpg'; }
    } else {
      mime = formatSetting;
      ext = extensionForMime(mime);
    }

    let blob;
    try {
      blob = await canvasToBlob(resultCanvas, mime, mime === 'image/png' ? 1 : quality);
    } catch (_) {
      blob = await canvasToBlob(resultCanvas, 'image/png', 1);
      ext = 'png';
    }

    if (!blob || blob.size < 100) throw new Error('El resultado puede necesitar varios intentos. Ajusta la selección y vuelve a procesar.');

    _ro.resultData = null;
    return {
      blob,
      name: `${baseName(file.name)}-editada.${ext}`,
      title: 'Objeto eliminado',
      message: 'El resultado puede necesitar varios intentos. Ajusta la selección y vuelve a procesar.',
      preview: blob,
      stats: [
        ['Dimensiones', `${_ro.imageW} × ${_ro.imageH}`],
        ['Formato', ext.toUpperCase()],
        ['Tamaño', formatBytes(blob.size)],
      ],
    };
  }

  let _batchCancelled = false;
  async function processBatchCompress() {
    const quality = clamp(numberValue('batchQuality', 82) / 100, 0.10, 1);
    const maxWidth = clamp(numberValue('batchMaxWidth', 0), 0, 10000);
    const formatSetting = valueOf('batchFormat', 'auto');
    const downloadMode = valueOf('batchDownload', 'zip');
    const files = state.files.filter(f => f.type.startsWith('image/'));
    if (!files.length) throw new Error('Selecciona al menos una imagen.');

    _batchCancelled = false;
    const progSection = $('#batchProgressSection');
    const progBar = $('#batchProgressBar');
    const progText = $('#batchProgressText');
    const progList = $('#batchProgressList');
    if (progSection) progSection.hidden = false;

    const results = [];
    let totalDone = 0;

    for (const file of files) {
      if (_batchCancelled) break;
      try {
        const image = await loadImage(file);
        let w = image.naturalWidth, h = image.naturalHeight;
        if (maxWidth > 0 && w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, w, h);
        let mime = formatSetting === 'auto' ? (file.type === 'image/png' ? 'image/png' : 'image/webp') : formatSetting;
        if (mime === 'image/png') {
          const blob = await canvasToBlob(canvas, 'image/png', 1);
          results.push({ blob, name: `${baseName(file.name)}.png`, original: file });
        } else {
          let blob = await canvasToBlob(canvas, mime, quality);
          results.push({ blob, name: `${baseName(file.name)}.${extensionForMime(mime)}`, original: file });
        }
      } catch (err) {
        if (progList) {
          const row = document.createElement('div');
          row.style.cssText = 'color:var(--c-error);margin-top:2px';
          row.textContent = `✕ ${file.name}: ${err.message || 'error'}`;
          progList.appendChild(row);
        }
      }
      totalDone++;
      if (progBar) progBar.style.width = `${Math.round(totalDone / files.length * 100)}%`;
      if (progText) progText.textContent = `${totalDone} de ${files.length} procesadas`;
    }

    if (!results.length) throw new Error('Ninguna imagen se pudo procesar.');

    if (downloadMode === 'zip' && results.length > 1) {
      if (!window.JSZip) throw new Error('No se pudo cargar el componente para crear ZIP.');
      const zip = new window.JSZip();
      results.forEach(r => zip.file(r.name, r.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      return {
        blob, name: 'toolisto-imagenes-comprimidas.zip',
        title: 'Imágenes comprimidas',
        message: `${results.length} de ${files.length} imágenes procesadas.`,
        stats: [['Procesadas', `${results.length}/${files.length}`], ['ZIP', formatBytes(blob.size)]],
      };
    }

    for (const r of results) {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a'); a.href = url; a.download = r.name;
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise(res => setTimeout(res, 200));
      URL.revokeObjectURL(url);
    }
    return {
      blob: results[0].blob, name: results[0].name,
      title: 'Imágenes comprimidas',
      message: `${results.length} archivos descargados individualmente.`,
      stats: [['Procesadas', `${results.length}/${files.length}`], ['Formato', formatSetting === 'auto' ? 'Original' : extensionForMime(formatSetting).toUpperCase()]],
    };
  }

  async function processStripMetadata() {
    const files = state.files.filter(f => f.type.startsWith('image/'));
    if (!files.length) throw new Error('Selecciona al menos una imagen.');
    const formatSetting = valueOf('stripOutputFormat', 'auto');
    _batchCancelled = false;

    const progSection = $('#stripProgressSection');
    const progBar = $('#stripProgressBar');
    const progText = $('#stripProgressText');
    if (progSection) progSection.hidden = false;

    const results = [];
    let totalDone = 0;

    for (const file of files) {
      if (_batchCancelled) break;
      try {
        const image = await loadImage(file);
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        let mime = formatSetting === 'auto'
          ? (['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ? file.type : 'image/webp')
          : formatSetting;
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image, 0, 0);
        const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? 1 : 0.92);
        const ext = extensionForMime(mime);
        results.push({ blob, name: `${baseName(file.name)}-limpia.${ext}`, original: file });
      } catch (err) {
        if (progText) progText.textContent = `Error en ${file.name}: ${err.message}`;
      }
      totalDone++;
      if (progBar) progBar.style.width = `${Math.round(totalDone / files.length * 100)}%`;
      if (progText) progText.textContent = `${totalDone} de ${files.length} procesadas`;
    }

    if (!results.length) throw new Error('Ninguna imagen se pudo procesar.');

    if (results.length > 1 && window.JSZip) {
      const zip = new window.JSZip();
      results.forEach(r => zip.file(r.name, r.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      return {
        blob, name: 'toolisto-imagenes-sin-metadata.zip',
        title: 'Metadatos eliminados',
        message: `${results.length} imágenes procesadas. Los metadatos EXIF, XMP e IPTC fueron eliminados al re-codificar.`,
        stats: [['Procesadas', `${results.length}/${files.length}`], ['ZIP', formatBytes(blob.size)]],
      };
    }

    for (const r of results) {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a'); a.href = url; a.download = r.name;
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise(res => setTimeout(res, 200));
      URL.revokeObjectURL(url);
    }
    return {
      blob: results[0].blob, name: results[0].name,
      title: 'Metadatos eliminados',
      message: `${results.length} archivos descargados. Los metadatos fueron eliminados al re-codificar la imagen.`,
      stats: [['Procesadas', `${results.length}/${files.length}`], ['Formato', 'Re-codificada']],
    };
  }

  function initStripMetadata() {
    const detectInfo = $('#stripDetectedInfo');
    const detectList = $('#stripDetectedList');
    if (detectInfo && detectList && state.files.length) {
      detectInfo.hidden = false;
      detectList.innerHTML = '<div style="margin-bottom:4px"><strong>Metadatos detectados:</strong></div>';
      const info = document.createElement('div');
      info.textContent = 'Al re-codificar la imagen, todos los metadatos EXIF, XMP e IPTC serán eliminados. Esto incluye GPS, fecha, dispositivo, software y autor.';
      detectList.appendChild(info);
    }
  }

  const _sc = { canvas:null, ctx:null, image:null, imgW:0, imgH:0, zoom:1, rot:0, flipH:false, flipV:false, offsetX:0, offsetY:0, preset:null, cropW:0, cropH:0, displayW:0, displayH:0, dragging:false, dragX:0, dragY:0 };

  const SOCIAL_PRESETS = {
    tiktok: { w:1080, h:1920, ratio:9/16 },
    stories: { w:1080, h:1920, ratio:9/16 },
    igVertical: { w:1080, h:1350, ratio:4/5 },
    igSquare: { w:1080, h:1080, ratio:1 },
    igHorizontal: { w:1080, h:566, ratio:1.91 },
    youtube: { w:1920, h:1080, ratio:16/9 },
    ytThumb: { w:1280, h:720, ratio:16/9 },
    profilePic: { w:1080, h:1080, ratio:1, circular:true },
  };

  function initSocialCrop() {
    const presetSel = $('#socialPreset');
    const customSize = $('#socialCustomSize');
    const zoomIn = $('#socialZoomIn');
    const zoomOut = $('#socialZoomOut');
    const rotateBtn = $('#socialRotate');
    const flipHBtn = $('#socialFlipH');
    const flipVBtn = $('#socialFlipV');
    const resetBtn = $('#socialResetView');

    if (presetSel) presetSel.addEventListener('change', () => {
      const v = presetSel.value;
      if (customSize) customSize.hidden = v !== 'custom';
      _sc.preset = v;
      loadSocialImage();
    });

    if (zoomIn) zoomIn.addEventListener('click', () => { _sc.zoom = Math.min(5, _sc.zoom * 1.2); renderSocialCanvas(); });
    if (zoomOut) zoomOut.addEventListener('click', () => { _sc.zoom = Math.max(0.2, _sc.zoom / 1.2); renderSocialCanvas(); });
    if (rotateBtn) rotateBtn.addEventListener('click', () => { _sc.rot = (_sc.rot + 90) % 360; renderSocialCanvas(); });
    if (flipHBtn) flipHBtn.addEventListener('click', () => { _sc.flipH = !_sc.flipH; renderSocialCanvas(); });
    if (flipVBtn) flipVBtn.addEventListener('click', () => { _sc.flipV = !_sc.flipV; renderSocialCanvas(); });
    if (resetBtn) resetBtn.addEventListener('click', () => { _sc.zoom = 1; _sc.rot = 0; _sc.flipH = false; _sc.flipV = false; _sc.offsetX = 0; _sc.offsetY = 0; renderSocialCanvas(); });

    loadSocialImage();
  }

  async function loadSocialImage() {
    const file = state.files[0];
    if (!file) return;
    const image = await loadImage(file);
    _sc.image = image;
    _sc.imgW = image.naturalWidth;
    _sc.imgH = image.naturalHeight;

    const p = _sc.preset || $('#socialPreset')?.value || 'igSquare';
    const customW = Number($('#socialWidth')?.value) || 1080;
    const customH = Number($('#socialHeight')?.value) || 1080;
    const preset = SOCIAL_PRESETS[p] || { w: customW, h: customH, ratio: customW / customH };
    _sc.cropW = preset.w; _sc.cropH = preset.h;

    const wrap = $('#socialCanvasWrap');
    if (!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML = '';

    const maxDisplay = Math.min(wrap.parentElement.clientWidth || 600, 600);
    const displayRatio = _sc.cropW / _sc.cropH;
    _sc.displayW = displayRatio >= 1 ? maxDisplay : Math.round(maxDisplay * displayRatio);
    _sc.displayH = Math.round(_sc.displayW / displayRatio);

    const canvas = document.createElement('canvas');
    canvas.width = _sc.displayW; canvas.height = _sc.displayH;
    canvas.style.cssText = `width:100%;max-width:${_sc.displayW}px;border-radius:8px;cursor:grab;display:block;touch-action:none`;
    _sc.canvas = canvas; _sc.ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);

    canvas.addEventListener('pointerdown', (e) => { _sc.dragging = true; _sc.dragX = e.clientX; _sc.dragY = e.clientY; canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', (e) => { if (!_sc.dragging) return; _sc.offsetX += (e.clientX - _sc.dragX) / _sc.zoom; _sc.offsetY += (e.clientY - _sc.dragY) / _sc.zoom; _sc.dragX = e.clientX; _sc.dragY = e.clientY; renderSocialCanvas(); });
    canvas.addEventListener('pointerup', () => { _sc.dragging = false; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('pointerleave', () => { _sc.dragging = false; canvas.style.cursor = 'grab'; });

    renderSocialCanvas();
  }

  function renderSocialCanvas() {
    if (!_sc.ctx || !_sc.canvas || !_sc.image) return;
    const ctx = _sc.ctx;
    const dw = _sc.displayW, dh = _sc.displayH;
    const p = _sc.preset || $('#socialPreset')?.value || 'igSquare';
    const isCircular = SOCIAL_PRESETS[p]?.circular;

    ctx.clearRect(0, 0, dw, dh);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, dw, dh);

    const cropRatio = _sc.cropW / _sc.cropH;
    const imgRatio = _sc.imgW / _sc.imgH;
    let drawW, drawH;
    if (imgRatio > cropRatio) {
      drawH = dh * _sc.zoom;
      drawW = drawH * imgRatio;
    } else {
      drawW = dw * _sc.zoom;
      drawH = drawW / imgRatio;
    }

    const cx = dw / 2 + _sc.offsetX * _sc.zoom;
    const cy = dh / 2 + _sc.offsetY * _sc.zoom;

    ctx.save();
    if (isCircular) {
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(dw, dh) / 2, 0, Math.PI * 2); ctx.clip();
    }
    ctx.translate(cx, cy);
    if (_sc.flipH) ctx.scale(-1, 1);
    if (_sc.flipV) ctx.scale(1, -1);
    if (_sc.rot) ctx.rotate(_sc.rot * Math.PI / 180);
    ctx.drawImage(_sc.image, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    if (isCircular) {
      ctx.beginPath(); ctx.arc(dw / 2, dh / 2, Math.min(dw, dh) / 2 - 1, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeRect(1, 1, dw - 2, dh - 2);
    }
  }

  async function processSocialCrop() {
    if (!_sc.image) throw new Error('Carga una imagen primero.');
    const p = _sc.preset || $('#socialPreset')?.value || 'igSquare';
    const customW = Number($('#socialWidth')?.value) || 1080;
    const customH = Number($('#socialHeight')?.value) || 1080;
    const preset = SOCIAL_PRESETS[p] || { w: customW, h: customH };
    const mime = valueOf('socialFormat', 'image/jpeg');
    const quality = clamp(numberValue('socialQuality', 92) / 100, 0.25, 1);

    const canvas = document.createElement('canvas');
    canvas.width = preset.w; canvas.height = preset.h;
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });

    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, preset.w, preset.h); }

    const cropRatio = preset.w / preset.h;
    const imgRatio = _sc.imgW / _sc.imgH;
    let drawW, drawH;
    if (imgRatio > cropRatio) {
      drawH = preset.h * _sc.zoom;
      drawW = drawH * imgRatio;
    } else {
      drawW = preset.w * _sc.zoom;
      drawH = drawW / imgRatio;
    }
    const scaleX = _sc.displayW > 0 ? preset.w / _sc.displayW : 1;
    const scaleY = _sc.displayH > 0 ? preset.h / _sc.displayH : 1;
    const cx = preset.w / 2 + _sc.offsetX * _sc.zoom * scaleX;
    const cy = preset.h / 2 + _sc.offsetY * _sc.zoom * scaleY;

    ctx.save();
    if (preset.circular) { ctx.beginPath(); ctx.arc(cx, cy, Math.min(preset.w, preset.h) / 2, 0, Math.PI * 2); ctx.clip(); }
    ctx.translate(cx, cy);
    if (_sc.flipH) ctx.scale(-1, 1);
    if (_sc.flipV) ctx.scale(1, -1);
    if (_sc.rot) ctx.rotate(_sc.rot * Math.PI / 180);
    ctx.drawImage(_sc.image, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? 1 : quality);
    const ext = extensionForMime(mime);
    const file = state.files[0];
    return {
      blob, name: `${baseName(file.name)}-${preset.w}x${preset.h}.${ext}`,
      title: 'Imagen lista para redes',
      message: `Recortada a ${preset.w}×${preset.h} píxeles.`,
      preview: blob,
      stats: [['Plataforma', p], ['Dimensiones', `${preset.w} × ${preset.h}`], ['Formato', ext.toUpperCase()], ['Tamaño', formatBytes(blob.size)]],
    };
  }

  const _cp = { image:null, fullCanvas:null, previewCanvas:null, magCanvas:null, magCtx:null, scale:1, displayW:0, displayH:0, lastColor:null };

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }

  function setColorPickerResult(r, g, b, x, y) {
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const rgb = `rgb(${r}, ${g}, ${b})`;
    const hsl = rgbToHsl(r, g, b);
    _cp.lastColor = { r, g, b, hex, rgb, hsl, x, y };
    const swatch = $('#colorPickerSwatch');
    if (swatch) swatch.style.background = hex;
    const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    set('#colorPickerHex', hex.toUpperCase());
    set('#colorPickerRgb', rgb);
    set('#colorPickerHsl', hsl);
    set('#colorPickerPos', `(${x}, ${y}) px`);
    const readout = $('#colorPickerReadout');
    if (readout) readout.hidden = false;
  }

  function drawColorMagnifier(srcX, srcY) {
    const mag = _cp.magCanvas, magCtx = _cp.magCtx;
    if (!mag || !magCtx || !_cp.fullCanvas) return;
    const zoom = 8, size = mag.width;
    const half = size / (2 * zoom);
    const x0 = Math.max(0, srcX - half), y0 = Math.max(0, srcY - half);
    magCtx.imageSmoothingEnabled = false;
    magCtx.clearRect(0, 0, size, size);
    magCtx.fillStyle = '#222';
    magCtx.fillRect(0, 0, size, size);
    magCtx.drawImage(_cp.fullCanvas, x0, y0, half * 2, half * 2, 0, 0, size, size);
    magCtx.strokeStyle = 'rgba(255,255,255,0.85)';
    magCtx.lineWidth = 1;
    magCtx.strokeRect(size / 2 - 0.5, 0, 1, size);
    magCtx.strokeRect(0, size / 2 - 0.5, size, 1);
    mag.style.display = 'block';
  }

  function initColorPicker() {
    const file = state.files[0];
    if (!file) return;
    const wrap = $('#colorPickerWrap');
    if (!wrap) return;
    loadImage(file).then((img) => {
      _cp.image = img;
      const w = img.naturalWidth, h = img.naturalHeight;
      const full = document.createElement('canvas');
      full.width = w; full.height = h;
      full.getContext('2d').drawImage(img, 0, 0);
      _cp.fullCanvas = full;
      wrap.style.display = 'block';
      wrap.innerHTML = '';

      const scale = Math.min(520 / w, 520 / h, 1);
      _cp.scale = scale;
      const dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = dw; canvas.height = dh;
      canvas.style.cssText = 'width:100%;max-width:520px;border-radius:8px;cursor:crosshair;display:block;touch-action:none;margin:0 auto;background:#1a1a1a';
      canvas.getContext('2d').drawImage(full, 0, 0, w, h, 0, 0, dw, dh);
      _cp.previewCanvas = canvas;
      _cp.displayW = dw; _cp.displayH = dh;
      wrap.appendChild(canvas);

      const mag = document.createElement('canvas');
      mag.width = 96; mag.height = 96;
      mag.style.cssText = 'width:96px;height:96px;border:2px solid var(--c-border);border-radius:8px;margin:8px auto 0;display:none;image-rendering:pixelated';
      _cp.magCanvas = mag; _cp.magCtx = mag.getContext('2d');
      wrap.appendChild(mag);

      const pick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = Math.min(dw - 1, Math.max(0, Math.round((e.clientX - rect.left) * (dw / rect.width))));
        const py = Math.min(dh - 1, Math.max(0, Math.round((e.clientY - rect.top) * (dh / rect.height))));
        const srcX = Math.min(w - 1, Math.round(px / scale));
        const srcY = Math.min(h - 1, Math.round(py / scale));
        const data = full.getContext('2d').getImageData(srcX, srcY, 1, 1).data;
        setColorPickerResult(data[0], data[1], data[2], srcX, srcY);
        drawColorMagnifier(srcX, srcY);
      };
      canvas.addEventListener('pointerdown', pick);
      canvas.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = Math.min(dw - 1, Math.max(0, Math.round((e.clientX - rect.left) * (dw / rect.width))));
        const py = Math.min(dh - 1, Math.max(0, Math.round((e.clientY - rect.top) * (dh / rect.height))));
        drawColorMagnifier(Math.round(px / scale), Math.round(py / scale));
      });
      canvas.addEventListener('pointerleave', () => { if (mag) mag.style.display = 'none'; });

      const copyHex = $('#colorPickerCopyHex');
      const copyRgb = $('#colorPickerCopyRgb');
      const copyHsl = $('#colorPickerCopyHsl');
      if (copyHex) copyHex.addEventListener('click', () => { if (_cp.lastColor) navigator.clipboard.writeText(_cp.lastColor.hex.toUpperCase()).then(() => showToast('HEX copiado')); });
      if (copyRgb) copyRgb.addEventListener('click', () => { if (_cp.lastColor) navigator.clipboard.writeText(_cp.lastColor.rgb).then(() => showToast('RGB copiado')); });
      if (copyHsl) copyHsl.addEventListener('click', () => { if (_cp.lastColor) navigator.clipboard.writeText(_cp.lastColor.hsl).then(() => showToast('HSL copiado')); });
    }).catch(() => { /* el procesador mostrará el error */ });
  }

  async function processColorPicker() {
    if (!_cp.image || !_cp.fullCanvas) throw new Error('Carga una imagen primero.');
    if (!_cp.lastColor) {
      const full = _cp.fullCanvas;
      const cx = Math.floor(full.width / 2), cy = Math.floor(full.height / 2);
      const data = full.getContext('2d').getImageData(cx, cy, 1, 1).data;
      setColorPickerResult(data[0], data[1], data[2], cx, cy);
    }
    const c = _cp.lastColor;
    return {
      summary: {
        title: 'Color seleccionado',
        message: `Color capturado en el punto (${c.x}, ${c.y}) de la imagen original.`,
        stats: [['HEX', c.hex.toUpperCase()], ['RGB', c.rgb], ['HSL', c.hsl], ['Posición', `(${c.x}, ${c.y}) px`]],
        html: `<div style="display:flex;align-items:center;gap:12px;margin:4px 0"><div style="width:44px;height:44px;border-radius:8px;background:${c.hex};border:1px solid var(--c-border);flex-shrink:0"></div><div style="font-size:.95rem"><strong>${c.hex.toUpperCase()}</strong><div style="color:var(--muted);font-size:.8rem">${c.rgb}</div></div></div>`,
      },
    };
  }

  const _cmp = { imgA:null, imgB:null, canvasA:null, canvasB:null, canvas:null, ctx:null, dw:0, dh:0, mode:'slider', slider:0.5, alpha:0.5, threshold:30, showB:false, dragging:false, diffCount:0, diffTotal:1 };

  function drawScaledCanvas(img, dw, dh) {
    const c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, dw, dh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dw, dh);
    return c;
  }

  function computeDiffInto(ctx, dw, dh) {
    const d1 = ctx.getImageData(0, 0, dw, dh);
    const dA = _cmp.canvasA.getContext('2d').getImageData(0, 0, dw, dh).data;
    const dB = _cmp.canvasB.getContext('2d').getImageData(0, 0, dw, dh).data;
    const out = d1.data;
    let changed = 0;
    const t = _cmp.threshold;
    for (let i = 0; i < out.length; i += 4) {
      const dist = (Math.abs(dA[i] - dB[i]) + Math.abs(dA[i + 1] - dB[i + 1]) + Math.abs(dA[i + 2] - dB[i + 2])) / 3;
      if (dist > t) {
        out[i] = 255; out[i + 1] = 30; out[i + 2] = 30; out[i + 3] = 255;
        changed++;
      } else {
        out[i] = dA[i]; out[i + 1] = dA[i + 1]; out[i + 2] = dA[i + 2]; out[i + 3] = 180;
      }
    }
    ctx.putImageData(d1, 0, 0);
    _cmp.diffCount = changed;
    _cmp.diffTotal = dw * dh;
  }

  function drawCompareLabel(text, x, y) {
    const ctx = _cmp.ctx;
    if (!ctx) return;
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 6, y + 13);
  }

  function renderCompareCanvas() {
    const ctx = _cmp.ctx;
    if (!ctx) return;
    const dw = _cmp.dw, dh = _cmp.dh;
    ctx.clearRect(0, 0, dw, dh);
    if (_cmp.mode === 'slider') {
      ctx.drawImage(_cmp.canvasA, 0, 0);
      const split = Math.round(dw * _cmp.slider);
      ctx.drawImage(_cmp.canvasB, 0, 0, split, dh, 0, 0, split, dh);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(split - 1, 0, 2, dh);
      ctx.beginPath();
      ctx.arc(split, dh / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.stroke();
      drawCompareLabel('A', 6, dh - 14);
      drawCompareLabel('B', Math.max(6, dw - 18), dh - 14);
    } else if (_cmp.mode === 'toggle') {
      ctx.drawImage(_cmp.showB ? _cmp.canvasB : _cmp.canvasA, 0, 0);
      drawCompareLabel(_cmp.showB ? 'B' : 'A', Math.max(6, dw - 18), 8);
    } else if (_cmp.mode === 'overlay') {
      ctx.drawImage(_cmp.canvasA, 0, 0);
      ctx.globalAlpha = _cmp.alpha;
      ctx.drawImage(_cmp.canvasB, 0, 0);
      ctx.globalAlpha = 1;
      drawCompareLabel('B al ' + Math.round(_cmp.alpha * 100) + '%', 6, 8);
    } else {
      computeDiffInto(ctx, dw, dh);
    }
  }

  function initImageCompare() {
    if (state.files.length < 2) return;
    const wrap = $('#compareCanvasWrap');
    if (!wrap) return;
    Promise.all([loadImage(state.files[0]), loadImage(state.files[1])]).then(([a, b]) => {
      _cmp.imgA = a; _cmp.imgB = b;
      const w = Math.max(a.naturalWidth, b.naturalWidth);
      const h = Math.max(a.naturalHeight, b.naturalHeight);
      const scale = Math.min(640 / w, (640 * 0.7) / h, 1);
      _cmp.dw = Math.max(1, Math.round(w * scale));
      _cmp.dh = Math.max(1, Math.round(h * scale));
      _cmp.canvasA = drawScaledCanvas(a, _cmp.dw, _cmp.dh);
      _cmp.canvasB = drawScaledCanvas(b, _cmp.dw, _cmp.dh);
      wrap.style.display = 'block';
      wrap.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = _cmp.dw; canvas.height = _cmp.dh;
      canvas.style.cssText = 'width:100%;max-width:640px;border-radius:8px;display:block;touch-action:none;margin:0 auto;background:#1a1a1a';
      _cmp.canvas = canvas; _cmp.ctx = canvas.getContext('2d');
      wrap.appendChild(canvas);
      _cmp.mode = valueOf('compareMode', 'slider');
      _cmp.threshold = clamp(numberValue('compareThreshold', 30), 1, 128);
      _cmp.alpha = clamp(numberValue('compareOverlayAlpha', 50), 5, 100) / 100;
      renderCompareCanvas();

      canvas.addEventListener('pointerdown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        if (_cmp.mode === 'slider') { _cmp.slider = clamp(px, 0, 1); _cmp.dragging = true; renderCompareCanvas(); }
        else if (_cmp.mode === 'toggle') { _cmp.showB = !_cmp.showB; renderCompareCanvas(); }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (_cmp.mode !== 'slider' || !_cmp.dragging) return;
        const rect = canvas.getBoundingClientRect();
        _cmp.slider = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        renderCompareCanvas();
      });
      canvas.addEventListener('pointerup', () => { _cmp.dragging = false; });
      canvas.addEventListener('pointerleave', () => { _cmp.dragging = false; });
    }).catch(() => { /* el procesador mostrará el error */ });

    const modeSel = $('#compareMode');
    if (modeSel) modeSel.addEventListener('change', () => {
      _cmp.mode = modeSel.value;
      const thWrap = $('#compareThresholdWrap');
      const ovWrap = $('#compareOverlayWrap');
      if (thWrap) thWrap.hidden = modeSel.value !== 'diff';
      if (ovWrap) ovWrap.hidden = modeSel.value !== 'overlay';
      renderCompareCanvas();
    });
    const thInput = $('#compareThreshold');
    if (thInput) thInput.addEventListener('input', () => { _cmp.threshold = clamp(numberValue('compareThreshold', 30), 1, 128); renderCompareCanvas(); });
    const ovInput = $('#compareOverlayAlpha');
    if (ovInput) ovInput.addEventListener('input', () => { _cmp.alpha = clamp(numberValue('compareOverlayAlpha', 50), 5, 100) / 100; renderCompareCanvas(); });
    const togBtn = $('#compareToggleBtn');
    if (togBtn) togBtn.addEventListener('click', () => { _cmp.showB = !_cmp.showB; togBtn.textContent = _cmp.showB ? 'Mostrar A' : 'Mostrar B'; renderCompareCanvas(); });
    const resetBtn = $('#compareResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => { _cmp.slider = 0.5; _cmp.showB = false; if (togBtn) togBtn.textContent = 'Mostrar B'; renderCompareCanvas(); });
  }

  async function processImageCompare() {
    if (!_cmp.imgA || !_cmp.imgB) throw new Error('Selecciona exactamente dos imágenes para comparar.');
    const threshold = clamp(numberValue('compareThreshold', 30), 1, 128);
    if (_cmp.mode !== 'diff') {
      computeDiffInto(_cmp.ctx, _cmp.dw, _cmp.dh);
    }
    const pct = (_cmp.diffCount / (_cmp.diffTotal || 1) * 100).toFixed(2);
    const identical = _cmp.diffCount === 0;
    const sameDims = _cmp.imgA.naturalWidth === _cmp.imgB.naturalWidth && _cmp.imgA.naturalHeight === _cmp.imgB.naturalHeight;
    return {
      summary: {
        title: 'Comparación completada',
        message: identical
          ? 'Las imágenes se ven idénticas dentro del umbral seleccionado.'
          : 'Las imágenes presentan diferencias visibles dentro del umbral seleccionado.',
        stats: [
          ['Imagen A', `${_cmp.imgA.naturalWidth} × ${_cmp.imgA.naturalHeight}`],
          ['Imagen B', `${_cmp.imgB.naturalWidth} × ${_cmp.imgB.naturalHeight}`],
          ['Dimensiones', sameDims ? 'Coinciden' : 'Difieren'],
          ['Píxeles diferentes', `${_cmp.diffCount} de ${_cmp.diffTotal} (${pct}%)`],
          ['Umbral', String(threshold)],
        ],
        html: _cmp.mode === 'diff'
          ? `<img src="${_cmp.canvas.toDataURL('image/png')}" alt="Diferencia visual" style="max-width:100%;border-radius:8px;border:1px solid var(--c-border)" />`
          : '',
      },
    };
  }

  const _sp = { pdfDoc:null, pageCount:0, selectedPages:new Set(), parsedRanges:[], cancelled:false };

  function initSplitPdf() {
    ensurePdfLib();
    const file = state.files[0];
    if (!file) return;
    const modeSel = $('#splitMode');
    const rangesControl = $('#splitRangesControl');
    const rangesInput = $('#splitRanges');
    const outputSel = $('#splitOutput');
    if (modeSel) modeSel.addEventListener('change', () => {
      if (rangesControl) rangesControl.style.display = modeSel.value === 'ranges' ? '' : 'none';
    });
    if (rangesInput) rangesInput.addEventListener('input', () => {
      const result = parseRanges(rangesInput.value, _sp.pageCount);
      const errEl = $('#splitRangesError');
      if (result.error) { if (errEl) errEl.textContent = result.error; _sp.parsedRanges = []; }
      else { if (errEl) errEl.textContent = ''; _sp.parsedRanges = result.ranges; }
      updateSplitThumbnails();
    });
    loadSplitPdf(file);
  }

  async function loadSplitPdf(file) {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const meta = $('#splitPdfMeta');
    const thumbs = $('#splitPdfThumbs');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      _sp.pdfDoc = doc; _sp.pageCount = doc.getPageCount();
      _sp.selectedPages = new Set(Array.from({ length: _sp.pageCount }, (_, i) => i));
      if (meta) meta.textContent = `${file.name} · ${_sp.pageCount} página${_sp.pageCount !== 1 ? 's' : ''}`;
      if (!thumbs) return;
      thumbs.innerHTML = '';
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        for (let i = 1; i <= _sp.pageCount; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 0.22 });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          const wrap = document.createElement('label');
          wrap.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;border:2px solid var(--c-border);border-radius:6px;padding:3px;transition:border-color .15s';
          wrap.dataset.page = i;
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = true; cb.value = i;
          cb.style.cssText = 'position:absolute;top:4px;right:4px;z-index:1';
          const num = document.createElement('span');
          num.textContent = i; num.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--muted)';
          c.style.cssText = 'width:100%;border-radius:4px;display:block';
          cb.addEventListener('change', () => {
            if (cb.checked) _sp.selectedPages.add(i - 1); else _sp.selectedPages.delete(i - 1);
            wrap.style.borderColor = cb.checked ? 'var(--c-primary)' : 'var(--c-border)';
          });
          wrap.appendChild(cb); wrap.appendChild(c); wrap.appendChild(num);
          thumbs.appendChild(wrap);
        }
      }
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') || err?.message?.includes('Encrypted') ? 'PDF protegido con contraseña.' : 'No se pudo leer el PDF.';
    }
  }

  function updateSplitThumbnails() {
    const pages = $('#splitMode')?.value === 'ranges' ? getPagesFromRanges() : [..._sp.selectedPages];
    document.querySelectorAll('#splitPdfThumbs label').forEach(el => {
      const idx = parseInt(el.dataset.page, 10);
      const active = pages.includes(idx - 1);
      el.style.borderColor = active ? 'var(--c-primary)' : 'var(--c-border)';
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = active;
    });
  }

  function getPagesFromRanges() {
    const pages = [];
    for (const r of _sp.parsedRanges) for (let i = r.start; i <= r.end; i++) pages.push(i - 1);
    return [...new Set(pages)];
  }

  function parseRanges(text, total) {
    const raw = String(text || '').trim();
    if (!raw) return { ranges: [], error: '' };
    const ranges = [], parts = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean), seen = new Set();
    for (const part of parts) {
      const dash = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const single = part.match(/^(\d+)$/);
      if (dash) {
        const s = parseInt(dash[1], 10), e = parseInt(dash[2], 10);
        if (s < 1 || e < 1) return { ranges: [], error: `Valor inválido: "${part}".` };
        if (s > total || e > total) return { ranges: [], error: `La página ${Math.max(s, e)} no existe. El PDF tiene ${total} página${total !== 1 ? 's' : ''}.` };
        if (s > e) return { ranges: [], error: `Rango inválido: "${part}".` };
        for (let i = s; i <= e; i++) { if (seen.has(i)) return { ranges: [], error: `Página ${i} duplicada.` }; seen.add(i); }
        ranges.push({ start: s, end: e });
      } else if (single) {
        const n = parseInt(single[1], 10);
        if (n < 1) return { ranges: [], error: `Valor inválido: "${part}".` };
        if (n > total) return { ranges: [], error: `La página ${n} no existe.` };
        if (seen.has(n)) return { ranges: [], error: `Página ${n} duplicada.` };
        seen.add(n); ranges.push({ start: n, end: n });
      } else return { ranges: [], error: `Formato no reconocido: "${part}".` };
    }
    return { ranges, error: '' };
  }

  async function processSplitPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const totalPages = source.getPageCount();
    const mode = $('#splitMode')?.value || 'ranges';
    const pagesToExtract = mode === 'ranges' ? getPagesFromRanges() : [..._sp.selectedPages];
    if (!pagesToExtract.length) throw new Error('No se seleccionó ninguna página.');
    const outputMode = $('#splitOutput')?.value || 'single';

    if (outputMode === 'multi' || pagesToExtract.length > 1 && outputMode === 'multi') {
      if (!window.JSZip) throw new Error('No se pudo cargar el componente para crear ZIP.');
      const zip = new window.JSZip();
      const base = file.name.replace(/\.pdf$/i, '') || 'toolisto';
      for (const idx of pagesToExtract) {
        const newPdf = await PDFDocument.create();
        const [copied] = await newPdf.copyPages(source, [idx]);
        newPdf.addPage(copied);
        const b = await newPdf.save();
        zip.file(`${base}-pagina-${String(idx + 1).padStart(3, '0')}.pdf`, b);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-dividido.zip`, title: 'PDF dividido', message: `${pagesToExtract.length} archivos PDF creados.`, stats: [['Páginas', `${pagesToExtract.length}/${totalPages}`], ['ZIP', formatBytes(blob.size)]] };
    }

    const newPdf = await PDFDocument.create();
    const copied = await newPdf.copyPages(source, pagesToExtract);
    copied.forEach(p => newPdf.addPage(p));
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-seleccion.pdf`, title: 'PDF dividido', message: `${pagesToExtract.length} página${pagesToExtract.length !== 1 ? 's' : ''} extraída${pagesToExtract.length !== 1 ? 's' : ''}.`, stats: [['Páginas', pagesToExtract.map(i => i + 1).join(', ')], ['Total', `${pagesToExtract.length} de ${totalPages}`], ['Tamaño', formatBytes(blob.size)]] };
  }

  const _rp = { pdfDoc:null, pageCount:0, pages:[], dragIdx:null };

  function initReorderPdf() {
    ensurePdfLib();
    const file = state.files[0];
    if (!file) return;
    loadReorderPdf(file);
  }

  async function loadReorderPdf(file) {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const meta = $('#reorderPdfMeta');
    const thumbs = $('#reorderPdfThumbs');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      _rp.pdfDoc = doc; _rp.pageCount = doc.getPageCount();
      _rp.pages = Array.from({ length: _rp.pageCount }, (_, i) => i);
      if (meta) meta.textContent = `${file.name} · ${_rp.pageCount} página${_rp.pageCount !== 1 ? 's' : ''} · Arrastra para reordenar`;
      if (!thumbs) return;
      thumbs.innerHTML = '';
      thumbs.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;max-height:300px;overflow-y:auto;padding:4px 0';
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        for (let i = 0; i < _rp.pageCount; i++) {
          const page = await pdf.getPage(i + 1);
          const vp = page.getViewport({ scale: 0.2 });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          const card = document.createElement('div');
          card.draggable = true; card.dataset.idx = i;
          card.style.cssText = 'position:relative;cursor:grab;border:2px solid var(--c-border);border-radius:6px;padding:3px;transition:border-color .15s;display:flex;flex-direction:column;align-items:center;gap:3px';
          const num = document.createElement('span');
          num.textContent = i + 1; num.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--muted)';
          c.style.cssText = 'width:100%;border-radius:4px;display:block';
          card.appendChild(num); card.appendChild(c);
          card.addEventListener('dragstart', (e) => { _rp.dragIdx = i; card.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; });
          card.addEventListener('dragend', () => { _rp.dragIdx = null; card.style.opacity = '1'; });
          card.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.style.borderColor = 'var(--c-primary)'; });
          card.addEventListener('dragleave', () => { card.style.borderColor = 'var(--c-border)'; });
          card.addEventListener('drop', (e) => {
            e.preventDefault(); card.style.borderColor = 'var(--c-border)';
            if (_rp.dragIdx === null || _rp.dragIdx === i) return;
            const moved = _rp.pages.splice(_rp.dragIdx, 1)[0];
            _rp.pages.splice(i, 0, moved);
            renderReorderThumbs();
          });
          thumbs.appendChild(card);
        }
      }
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
  }

  function renderReorderThumbs() {
    const thumbs = $('#reorderPdfThumbs');
    if (!thumbs || !window.pdfjsLib) return;
    const pdfData = state.files[0];
    if (!pdfData) return;
    pdfData.arrayBuffer().then(bytes => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      return window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    }).then(async pdf => {
      thumbs.innerHTML = '';
      for (let vi = 0; vi < _rp.pages.length; vi++) {
        const origIdx = _rp.pages[vi];
        const page = await pdf.getPage(origIdx + 1);
        const vp = page.getViewport({ scale: 0.2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const card = document.createElement('div');
        card.draggable = true; card.dataset.idx = vi;
        card.style.cssText = 'position:relative;cursor:grab;border:2px solid var(--c-border);border-radius:6px;padding:3px;transition:border-color .15s;display:flex;flex-direction:column;align-items:center;gap:3px';
        const num = document.createElement('span');
        num.textContent = `${vi + 1} (pág ${origIdx + 1})`; num.style.cssText = 'font-size:.65rem;font-weight:700;color:var(--muted)';
        c.style.cssText = 'width:100%;border-radius:4px;display:block';
        card.appendChild(num); card.appendChild(c);
        card.addEventListener('dragstart', (e) => { _rp.dragIdx = vi; card.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; });
        card.addEventListener('dragend', () => { _rp.dragIdx = null; card.style.opacity = '1'; });
        card.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.style.borderColor = 'var(--c-primary)'; });
        card.addEventListener('dragleave', () => { card.style.borderColor = 'var(--c-border)'; });
        card.addEventListener('drop', (e) => {
          e.preventDefault(); card.style.borderColor = 'var(--c-border)';
          if (_rp.dragIdx === null || _rp.dragIdx === vi) return;
          const moved = _rp.pages.splice(_rp.dragIdx, 1)[0];
          _rp.pages.splice(vi, 0, moved);
          renderReorderThumbs();
        });
        thumbs.appendChild(card);
      }
    }).catch(() => {});
  }

  async function processReorderPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const newPdf = await PDFDocument.create();
    const copied = await newPdf.copyPages(source, _rp.pages);
    copied.forEach(p => newPdf.addPage(p));
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-ordenado.pdf`, title: 'PDF reorganizado', message: `${_rp.pages.length} páginas reordenadas.`, stats: [['Páginas', String(_rp.pages.length)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processRotatePdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pageCount = source.getPageCount();
    const rotations = state._rotateRotations;
    const selected = state._rotateSelected;
    const newPdf = await PDFDocument.create();
    const copied = await newPdf.copyPages(source, Array.from({ length: pageCount }, (_, i) => i));
    let rotatedCount = 0;
    copied.forEach((p, i) => {
      const pageNum = i + 1;
      const rot = (rotations && rotations.has(pageNum)) ? rotations.get(pageNum) : 0;
      if (rot !== 0) {
        p.setRotation(PDFLib.degrees((p.getRotation().angle + rot) % 360));
        rotatedCount++;
      }
      newPdf.addPage(p);
    });
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-girado.pdf`, title: 'PDF girado', message: `${rotatedCount} página${rotatedCount !== 1 ? 's' : ''} girada${rotatedCount !== 1 ? 's'}.`, stats: [['Páginas rotadas', String(rotatedCount)], ['Total', String(pageCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processDeletePagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const totalPages = source.getPageCount();
    let deleteSet = new Set();
    if (state._deletePagesSet && state._deletePagesSet.size > 0) {
      state._deletePagesSet.forEach(p => deleteSet.add(p - 1));
    } else {
      const rangesText = valueOf('deletePagesRanges', '');
      const result = parseRanges(rangesText, totalPages);
      if (result.error) throw new Error(result.error);
      for (const r of result.ranges) for (let i = r.start - 1; i < r.end; i++) deleteSet.add(i);
    }
    if (deleteSet.size === 0) throw new Error('No se indicaron páginas a eliminar.');
    const keepIndices = Array.from({ length: totalPages }, (_, i) => i).filter(i => !deleteSet.has(i));
    if (keepIndices.length === 0) throw new Error('No puedes eliminar todas las páginas.');
    const newPdf = await PDFDocument.create();
    const copied = await newPdf.copyPages(source, keepIndices);
    copied.forEach(p => newPdf.addPage(p));
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-sin-paginas.pdf`, title: 'Páginas eliminadas', message: `${deleteSet.size} página${deleteSet.size !== 1 ? 's' : ''} eliminada${deleteSet.size !== 1 ? 's' : ''}. Quedan ${keepIndices.length}.`, stats: [['Eliminadas', String(deleteSet.size)], ['Restantes', String(keepIndices.length)], ['Total original', String(totalPages)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processReversePagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pageCount = source.getPageCount();
    const reversed = Array.from({ length: pageCount }, (_, i) => pageCount - 1 - i);
    const newPdf = await PDFDocument.create();
    const copied = await newPdf.copyPages(source, reversed);
    copied.forEach(p => newPdf.addPage(p));
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-invertido.pdf`, title: 'PDF invertido', message: `Orden de ${pageCount} páginas invertido.`, stats: [['Páginas', String(pageCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processDuplicatePagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pageCount = source.getPageCount();
    const target = valueOf('duplicatePagesTarget', 'all');
    const times = clamp(numberValue('duplicatePagesTimes', 2), 2, 20);
    let indicesToDupe;
    if (target === 'selected') {
      const rangesText = valueOf('duplicatePagesRanges', '');
      const result = parseRanges(rangesText, pageCount);
      if (result.error) throw new Error(result.error);
      indicesToDupe = new Set();
      for (const r of result.ranges) for (let i = r.start - 1; i < r.end; i++) indicesToDupe.add(i);
    } else {
      indicesToDupe = new Set(Array.from({ length: pageCount }, (_, i) => i));
    }
    const newPdf = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      const [page] = await newPdf.copyPages(source, [i]);
      newPdf.addPage(page);
      if (indicesToDupe.has(i)) {
        for (let t = 1; t < times; t++) {
          const [dup] = await newPdf.copyPages(source, [i]);
          newPdf.addPage(dup);
        }
      }
    }
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const finalCount = newPdf.getPageCount();
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-duplicado.pdf`, title: 'PDF duplicado', message: `${indicesToDupe.size} página${indicesToDupe.size !== 1 ? 's' : ''} duplicada${indicesToDupe.size !== 1 ? 's' : ''} ×${times}. Total: ${finalCount} páginas.`, stats: [['Original', String(pageCount)], ['Duplicadas', String(indicesToDupe.size)], ['Total final', String(finalCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processInsertBlankPagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pageCount = source.getPageCount();
    const position = clamp(numberValue('insertBlankPosition', 0), 0, pageCount);
    const count = clamp(numberValue('insertBlankCount', 1), 1, 50);
    const sizeOption = valueOf('insertBlankSize', 'same');
    const newPdf = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      const [page] = await newPdf.copyPages(source, [i]);
      if (i === position) {
        for (let b = 0; b < count; b++) {
          if (sizeOption === 'a4') newPdf.addPage([PDFLib.PageSizes.A4[0], PDFLib.PageSizes.A4[1]]);
          else if (sizeOption === 'letter') newPdf.addPage([PDFLib.PageSizes.Letter[0], PDFLib.PageSizes.Letter[1]]);
          else { const orig = source.getPage(i); newPdf.addPage([orig.getWidth(), orig.getHeight()]); }
        }
      }
      newPdf.addPage(page);
    }
    if (position >= pageCount) {
      for (let b = 0; b < count; b++) {
        if (sizeOption === 'a4') newPdf.addPage([PDFLib.PageSizes.A4[0], PDFLib.PageSizes.A4[1]]);
        else if (sizeOption === 'letter') newPdf.addPage([PDFLib.PageSizes.Letter[0], PDFLib.PageSizes.Letter[1]]);
        else { const orig = source.getPage(pageCount - 1); newPdf.addPage([orig.getWidth(), orig.getHeight()]); }
      }
    }
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const finalCount = newPdf.getPageCount();
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-con-blancas.pdf`, title: 'Páginas en blanco insertadas', message: `${count} página${count !== 1 ? 's' : ''} en blanco insertada${count !== 1 ? 's' : ''} después de la posición ${position || 'inicio'}. Total: ${finalCount}.`, stats: [['Blancas', String(count)], ['Posición', position === 0 ? 'Inicio' : String(position)], ['Total final', String(finalCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processEditMetadataPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const title = valueOf('editMetaTitle', '');
    const author = valueOf('editMetaAuthor', '');
    const subject = valueOf('editMetaSubject', '');
    const keywords = valueOf('editMetaKeywords', '');
    if (title) source.setTitle(title);
    if (author) source.setAuthor(author);
    if (subject) source.setSubject(subject);
    if (keywords) source.setKeywords(keywords.split(',').map(k => k.trim()).filter(Boolean));
    const outBytes = await source.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const fields = [title && 'Título', author && 'Autor', subject && 'Asunto', keywords && 'Palabras clave'].filter(Boolean);
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-metadatos.pdf`, title: 'Metadatos actualizados', message: `Metadatos actualizados: ${fields.join(', ') || 'sin cambios'}.`, stats: [['Campos', fields.join(', ') || 'Ninguno'], ['Páginas', String(source.getPageCount())], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function initRotatePdf() {
    ensurePdfLib();
    const file = state.files[0];
    if (!file || !window.pdfjsLib) return;
    const meta = $('#rotatePdfMeta');
    const thumbsEl = $('#rotatePdfThumbs');
    if (!thumbsEl) return;
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      const bytes = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
      const pageCount = pdf.numPages;
      if (meta) meta.textContent = `${file.name} · ${pageCount} página${pageCount !== 1 ? 's' : ''}`;
      const rotations = new Map();
      for (let i = 1; i <= pageCount; i++) rotations.set(i, 0);
      const selected = new Set();
      thumbsEl.innerHTML = '';
      thumbsEl.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;max-height:360px;overflow-y:auto;padding:4px 0';
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 0.22 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const card = document.createElement('div');
        card.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px;border:2px solid var(--c-border);border-radius:8px;cursor:pointer;transition:border-color .15s,box-shadow .15s';
        card.dataset.page = i;
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.style.cssText = 'position:absolute;top:4px;right:4px;z-index:1;width:16px;height:16px;accent-color:var(--c-primary)';
        const rotBadge = document.createElement('span');
        rotBadge.className = 'pdf-nav-rot-badge';
        rotBadge.textContent = '0°';
        rotBadge.style.display = 'none';
        c.style.cssText = 'width:100%;border-radius:4px;display:block;transition:transform .2s';
        const num = document.createElement('span');
        num.style.cssText = 'font-size:.65rem;font-weight:800;color:var(--muted)';
        num.textContent = i;
        card.appendChild(cb);
        card.appendChild(rotBadge);
        card.appendChild(c);
        card.appendChild(num);
        card.addEventListener('click', (e) => {
          if (e.target === cb) return;
          cb.checked = !cb.checked;
          if (cb.checked) selected.add(i); else selected.delete(i);
          card.style.borderColor = cb.checked ? 'var(--c-primary)' : 'var(--c-border)';
          card.style.boxShadow = cb.checked ? '0 0 0 1px var(--c-primary)' : '';
        });
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(i); else selected.delete(i);
          card.style.borderColor = cb.checked ? 'var(--c-primary)' : 'var(--c-border)';
          card.style.boxShadow = cb.checked ? '0 0 0 1px var(--c-primary)' : '';
        });
        thumbsEl.appendChild(card);
        card._rotBadge = rotBadge;
        card._canvas = c;
        card._pageIdx = i;
      }
      state._rotateRotations = rotations;
      state._rotateSelected = selected;
      state._rotateCards = Array.from(thumbsEl.children);
      const actionsEl = $('#rotatePdfActions');
      if (actionsEl) {
        actionsEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-rotate]');
          if (btn) {
            const angle = Number(btn.dataset.rotate);
            selected.forEach(idx => {
              rotations.set(idx, (rotations.get(idx) + angle) % 360);
            });
            updateRotateVisuals();
          }
        });
      }
      const resetBtn = $('#rotatePdfResetBtn');
      if (resetBtn) resetBtn.addEventListener('click', () => {
        rotations.forEach((_, k) => rotations.set(k, 0));
        updateRotateVisuals();
      });
      function updateRotateVisuals() {
        state._rotateCards.forEach(card => {
          const idx = card._pageIdx;
          const rot = rotations.get(idx);
          if (card._canvas) card._canvas.style.transform = `rotate(${rot}deg)`;
          if (card._rotBadge) {
            card._rotBadge.style.display = rot !== 0 ? '' : 'none';
            card._rotBadge.textContent = rot + '°';
          }
        });
      }
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
  }

  async function initDeletePagesPdf() {
    const file = state.files[0];
    if (!file || !window.pdfjsLib) return;
    const meta = $('#deletePagesPdfMeta');
    const thumbsEl = $('#deletePagesPdfThumbs');
    const summaryEl = $('#deletePagesPdfSummary');
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      const bytes = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
      const pageCount = pdf.numPages;
      if (meta) meta.textContent = `${file.name} · ${pageCount} página${pageCount !== 1 ? 's' : ''} —Selecciona las que deseas eliminar`;
      const toDelete = new Set();
      if (thumbsEl) {
        thumbsEl.innerHTML = '';
        thumbsEl.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;max-height:360px;overflow-y:auto;padding:4px 0';
        for (let i = 1; i <= pageCount; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 0.22 });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          const card = document.createElement('div');
          card.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px;border:2px solid var(--c-border);border-radius:8px;cursor:pointer;transition:all .15s';
          card.dataset.page = i;
          const trashIcon = document.createElement('span');
          trashIcon.style.cssText = 'position:absolute;top:4px;right:4px;z-index:1;width:20px;height:20px;display:none;align-items:center;justify-content:center;border-radius:50%;background:var(--c-error);color:#fff;font-size:.7rem;font-weight:700';
          trashIcon.textContent = '✕';
          c.style.cssText = 'width:100%;border-radius:4px;display:block;transition:opacity .15s';
          const num = document.createElement('span');
          num.style.cssText = 'font-size:.65rem;font-weight:800;color:var(--muted)';
          num.textContent = i;
          card.appendChild(trashIcon);
          card.appendChild(c);
          card.appendChild(num);
          card.addEventListener('click', () => {
            if (toDelete.has(i)) { toDelete.delete(i); card.style.borderColor = 'var(--c-border)'; card.style.opacity = '1'; trashIcon.style.display = 'none'; }
            else { toDelete.add(i); card.style.borderColor = 'var(--c-error)'; card.style.opacity = '0.6'; trashIcon.style.display = 'flex'; }
            updateDeleteSummary();
          });
          thumbsEl.appendChild(card);
        }
      }
      function updateDeleteSummary() {
        const count = toDelete.size;
        const remaining = pageCount - count;
        if (summaryEl) summaryEl.textContent = count > 0 ? `${count} página${count !== 1 ? 's' : ''} seleccionada${count !== 1 ? 's' : ''} para eliminar —El resultado tendrá ${remaining} página${remaining !== 1 ? 's' : ''}` : 'Selecciona las páginas a eliminar haciendo clic en ellas.';
        const rangesInput = $('#deletePagesRanges');
        if (rangesInput && count > 0) rangesInput.value = Array.from(toDelete).sort((a, b) => a - b).join(', ');
      }
      state._deletePagesSet = toDelete;
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
    const rangesInput = $('#deletePagesRanges');
    if (rangesInput) rangesInput.addEventListener('input', () => {
      const errEl = $('#deletePagesError');
      if (!rangesInput.value.trim()) { if (errEl) errEl.textContent = ''; return; }
      const result = parseRanges(rangesInput.value, 999);
      if (result.error) { if (errEl) errEl.textContent = result.error; } else { if (errEl) errEl.textContent = ''; }
    });
  }

  async function initDuplicatePagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#duplicatePagesPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
    const targetSel = $('#duplicatePagesTarget');
    const selectedCtrl = $('#duplicatePagesSelectedControl');
    if (targetSel) targetSel.addEventListener('change', () => {
      if (selectedCtrl) selectedCtrl.hidden = targetSel.value !== 'selected';
    });
  }

  async function initInsertBlankPagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#insertBlankPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
  }

  async function initEditMetadataPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#editMetadataPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const title = doc.getTitle() || '';
      const author = doc.getAuthor() || '';
      const subject = doc.getSubject() || '';
      const keywords = (doc.getKeywords() || []).join(', ');
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
      const titleInput = $('#editMetaTitle');
      const authorInput = $('#editMetaAuthor');
      const subjectInput = $('#editMetaSubject');
      const keywordsInput = $('#editMetaKeywords');
      if (titleInput && title) titleInput.value = title;
      if (authorInput && author) authorInput.value = author;
      if (subjectInput && subject) subjectInput.value = subject;
      if (keywordsInput && keywords) keywordsInput.value = keywords;
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
  }

  async function processCompressPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const level = valueOf('compressPdfLevel', 'strip');
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const origSize = bytes.byteLength;
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setCreator('');
    doc.setProducer('');
    if (level === 'aggressive') {
      doc.setTitle('');
      doc.setAuthor('');
      doc.setSubject('');
      doc.setKeywords([]);
      doc.setCreator('');
      doc.setProducer('');
      doc.setModificationDate(new Date(0));
      doc.setCreationDate(new Date(0));
    }
    const outBytes = await doc.save({ useObjectStreams: level === 'aggressive' });
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const saved = origSize - blob.size;
    const pct = origSize > 0 ? Math.round((saved / origSize) * 100) : 0;
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-comprimido.pdf`, title: 'PDF comprimido', message: saved > 0 ? `Se ahorraron ${formatBytes(saved)} (${pct}%).` : 'Metadatos eliminados.', stats: [['Original', formatBytes(origSize)], ['Comprimido', formatBytes(blob.size)], ['Ahorrado', `${formatBytes(saved)} (${pct}%)`], ['Páginas', String(doc.getPageCount())]] };
  }

  async function processInterleavePdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const firstIsA = valueOf('interleaveFirst', 'a') === 'a';
    const fileA = state.files[0];
    const fileB = state.files[1];
    const [bytesA, bytesB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);
    const docA = await PDFDocument.load(bytesA, { ignoreEncryption: false });
    const docB = await PDFDocument.load(bytesB, { ignoreEncryption: false });
    const pagesA = docA.getPageCount();
    const pagesB = docB.getPageCount();
    const maxLen = Math.max(pagesA, pagesB);
    const newPdf = await PDFDocument.create();
    for (let i = 0; i < maxLen; i++) {
      const first = firstIsA ? docA : docB;
      const second = firstIsA ? docB : docA;
      const firstMax = firstIsA ? pagesA : pagesB;
      const secondMax = firstIsA ? pagesB : pagesA;
      if (i < firstMax) {
        const [p] = await newPdf.copyPages(first, [i]);
        newPdf.addPage(p);
      }
      if (i < secondMax) {
        const [p] = await newPdf.copyPages(second, [i]);
        newPdf.addPage(p);
      }
    }
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${fileA.name.replace(/\.pdf$/i, '')}-intercalado.pdf`, title: 'PDFs intercalados', message: `${pagesA} + ${pagesB} páginas intercaladas en ${newPdf.getPageCount()} páginas.`, stats: [['Archivo A', String(pagesA)], ['Archivo B', String(pagesB)], ['Total', String(newPdf.getPageCount())], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processCropPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const top = clamp(numberValue('cropPdfTop', 0), 0, 500);
    const right = clamp(numberValue('cropPdfRight', 0), 0, 500);
    const bottom = clamp(numberValue('cropPdfBottom', 0), 0, 500);
    const left = clamp(numberValue('cropPdfLeft', 0), 0, 500);
    const pageCount = doc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const newX = left;
      const newY = bottom;
      const newW = Math.max(1, width - left - right);
      const newH = Math.max(1, height - top - bottom);
      page.setMediaBox(newX, newY, newW, newH);
    }
    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-recortado.pdf`, title: 'Márgenes recortados', message: `${top}+${bottom}+${left}+${right} pt recortados en ${pageCount} páginas.`, stats: [['Márgenes', `${top}+${right}+${bottom}+${left} pt`], ['Páginas', String(pageCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processResizePdfPages() {
    ensurePdfLib();
    const { PDFDocument, PageSizes } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const targetKey = valueOf('resizePdfTarget', 'a4');
    const scaleMode = valueOf('resizePdfScale', 'fit');
    const sizeMap = { a4: PageSizes.A4, letter: PageSizes.Letter, legal: PageSizes.Legal, a3: PageSizes.A3, a5: PageSizes.A5 };
    const [targetW, targetH] = sizeMap[targetKey] || PageSizes.A4;
    const pageCount = doc.getPageCount();
    const newPdf = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      const oldPage = doc.getPage(i);
      const { width: oldW, height: oldH } = oldPage.getSize();
      const newPage = newPdf.addPage([targetW, targetH]);
      if (!oldPage.node.Contents()) continue;
      const [embedded] = await newPdf.embedPdf(doc, [i]);
      if (scaleMode === 'fit') {
        const s = Math.min(targetW / oldW, targetH / oldH);
        const dx = (targetW - oldW * s) / 2;
        const dy = (targetH - oldH * s) / 2;
        newPage.drawPage(embedded, { x: dx, y: dy, xScale: s, yScale: s });
      } else if (scaleMode === 'stretch') {
        const sx = targetW / oldW;
        const sy = targetH / oldH;
        newPage.drawPage(embedded, { x: 0, y: 0, xScale: sx, yScale: sy });
      } else {
        const s = Math.min(targetW / oldW, targetH / oldH);
        const dx = (targetW - oldW * s) / 2;
        const dy = (targetH - oldH * s) / 2;
        newPage.drawPage(embedded, { x: dx, y: dy, xScale: s, yScale: s });
      }
    }
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const label = targetKey.toUpperCase();
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-redimensionado.pdf`, title: `PDF redimensionado a ${label}`, message: `${pageCount} páginas redimensionadas a ${label}.`, stats: [['Tamaño objetivo', label], ['Modo', scaleMode], ['Páginas', String(pageCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processNUpPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const layout = valueOf('nUpPdfLayout', '2');
    const orientation = valueOf('nUpPdfOrientation', 'landscape');
    const n = Number(layout);
    const pageCount = doc.getPageCount();
    const isLandscape = orientation === 'landscape';
    const sheetW = isLandscape ? 842 : 595;
    const sheetH = isLandscape ? 595 : 842;
    const newPdf = await PDFDocument.create();
    const perSheet = n;
    const cols = n === 2 ? 2 : 2;
    const rows = n === 2 ? 1 : 2;
    const margin = 10;
    const cellW = (sheetW - margin * (cols + 1)) / cols;
    const cellH = (sheetH - margin * (rows + 1)) / rows;
    for (let i = 0; i < pageCount; i += perSheet) {
      const newPage = newPdf.addPage([sheetW, sheetH]);
      for (let j = 0; j < perSheet && (i + j) < pageCount; j++) {
        const col = j % cols;
        const row = Math.floor(j / cols);
        const cellX = margin + col * (cellW + margin);
        const cellY = sheetH - margin - (row + 1) * cellH - row * margin;
        const oldPage = doc.getPage(i + j);
        if (!oldPage.node.Contents()) continue;
        const { width: oldW, height: oldH } = oldPage.getSize();
        const scaleX = cellW / oldW;
        const scaleY = cellH / oldH;
        const s = Math.min(scaleX, scaleY);
        const drawW = oldW * s;
        const drawH = oldH * s;
        const dx = cellX + (cellW - drawW) / 2;
        const dy = cellY + (cellH - drawH) / 2;
        const embedded = await newPdf.embedPdf(doc, [i + j]);
        newPage.drawPage(embedded[0], { x: dx, y: dy, xScale: s, yScale: s });
      }
    }
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const sheets = Math.ceil(pageCount / perSheet);
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-${n}up.pdf`, title: `${n} páginas por hoja`, message: `${pageCount} páginas en ${sheets} hoja${sheets !== 1 ? 's' : ''} (${n}-up).`, stats: [['Original', String(pageCount)], ['Hojas', String(sheets)], ['Layout', `${n}-up ${orientation}`], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processSplitDoublePdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const orientation = valueOf('splitDoubleOrientation', 'vertical');
    const isVertical = orientation === 'vertical';
    const newPdf = await PDFDocument.create();
    const pageCount = doc.getPageCount();
    let totalNew = 0;
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      if (isVertical) {
        const left = 0;
        const right = width / 2;
        const leftPage = newPdf.addPage([width / 2, height]);
        const rightPage = newPdf.addPage([width / 2, height]);
        if (page.node.Contents()) {
          const embedded = await newPdf.embedPdf(doc, [i]);
          leftPage.drawPage(embedded[0], { x: -left, y: 0, xScale: 1, yScale: 1 });
          rightPage.drawPage(embedded[0], { x: -right, y: 0, xScale: 1, yScale: 1 });
        }
        totalNew += 2;
      } else {
        const top = height / 2;
        const topPage = newPdf.addPage([width, height / 2]);
        const bottomPage = newPdf.addPage([width, height / 2]);
        if (page.node.Contents()) {
          const embedded = await newPdf.embedPdf(doc, [i]);
          topPage.drawPage(embedded[0], { x: 0, y: top, xScale: 1, yScale: 1 });
          bottomPage.drawPage(embedded[0], { x: 0, y: 0, xScale: 1, yScale: 1 });
        }
        totalNew += 2;
      }
    }
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const dir = isVertical ? 'vertical' : 'horizontal';
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-split.pdf`, title: 'Páginas divididas', message: `${pageCount} páginas dobles → ${totalNew} páginas individuales (corte ${dir}).`, stats: [['Original', String(pageCount)], ['Resultado', String(totalNew)], ['Corte', dir], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processBookletPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pageCount = doc.getPageCount();
    const newPdf = await PDFDocument.create();
    const order = [];
    const total = pageCount;
    const half = Math.ceil(total / 2);
    for (let i = 0; i < half; i++) {
      order.push(total - 1 - i);
      order.push(i);
    }
    for (const idx of order) {
      if (idx < total) {
        const [copied] = await newPdf.copyPages(doc, [idx]);
        newPdf.addPage(copied);
      }
    }
    const sheets = Math.ceil(order.filter(i => i < total).length / 2);
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-cuadernillo.pdf`, title: 'Cuadernillo', message: `${pageCount} páginas reordenadas para ${sheets} pliegos.`, stats: [['Original', String(pageCount)], ['Pliegos', String(sheets)], ['Hojas doble cara', String(sheets)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processWatermarkPdf() {
    ensurePdfLib();
    const { PDFDocument, rgb } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const text = valueOf('watermarkText', 'BORRADOR');
    const fontSize = numberValue('watermarkFontSize', 60);
    const hexColor = valueOf('watermarkColor', '#cccccc');
    const opacity = Number(valueOf('watermarkOpacity', '0.3'));
    const rotation = Number(valueOf('watermarkRotation', '45'));
    const position = valueOf('watermarkPosition', 'center');
    const r = parseInt(hexColor.slice(1, 3), 16) / 255;
    const g = parseInt(hexColor.slice(3, 5), 16) / 255;
    const b = parseInt(hexColor.slice(5, 7), 16) / 255;
    const color = rgb(r, g, b);
    const font = await doc.embedFont('Helvetica-Bold');
    const pageCount = doc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x, y;
      if (position === 'topLeft') { x = 40; y = height - 40; }
      else if (position === 'topRight') { x = width - textWidth - 40; y = height - 40; }
      else if (position === 'bottomLeft') { x = 40; y = 40; }
      else if (position === 'bottomRight') { x = width - textWidth - 40; y = 40; }
      else { x = (width - textWidth) / 2; y = height / 2; }
      page.drawText(text, { x, y, size: fontSize, font, color, opacity, rotate: { angle: rotation, type: 'degrees' } });
    }
    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-marca-agua.pdf`, title: 'Marca de agua', message: `Marca de agua "${text}" agregada a ${pageCount} páginas.`, stats: [['Páginas', String(pageCount)], ['Texto', text], ['Fuente', String(fontSize) + 'pt'], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processAddPageNumbersPdf() {
    ensurePdfLib();
    const { PDFDocument, rgb } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pos = valueOf('pageNumPosition', 'bottomCenter');
    const fontSize = numberValue('pageNumFontSize', 10);
    const hexColor = valueOf('pageNumColor', '#000000');
    const format = valueOf('pageNumFormat', 'number');
    const r = parseInt(hexColor.slice(1, 3), 16) / 255;
    const g = parseInt(hexColor.slice(3, 5), 16) / 255;
    const b = parseInt(hexColor.slice(5, 7), 16) / 255;
    const color = rgb(r, g, b);
    const font = await doc.embedFont('Helvetica');
    const pageCount = doc.getPageCount();
    function toRoman(num) {
      const vals = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
      let result = '';
      for (const [v, s] of vals) { while (num >= v) { result += s; num -= v; } }
      return result;
    }
    function formatNum(n) {
      if (format === 'parenthesis') return '(' + n + ')';
      if (format === 'dash') return '- ' + n + ' -';
      if (format === 'roman') return toRoman(n).toUpperCase();
      return String(n);
    }
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const numStr = formatNum(i + 1);
      const tw = font.widthOfTextAtSize(numStr, fontSize);
      let x, y;
      const pad = 30;
      const isTop = pos.startsWith('top');
      const isBottom = pos.startsWith('bottom');
      y = isBottom ? pad : height - pad - fontSize;
      if (pos.includes('Right')) x = width - tw - pad;
      else if (pos.includes('Left')) x = pad;
      else x = (width - tw) / 2;
      page.drawText(numStr, { x, y, size: fontSize, font, color });
    }
    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-numerado.pdf`, title: 'Páginas numeradas', message: `Numeración agregada a ${pageCount} páginas.`, stats: [['Páginas', String(pageCount)], ['Formato', format], ['Posición', pos], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processAddHeaderFooterPdf() {
    ensurePdfLib();
    const { PDFDocument, rgb } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const header = valueOf('headerFooterHeader', '');
    const footer = valueOf('headerFooterFooter', '');
    const fontSize = numberValue('headerFooterFontSize', 9);
    const hexColor = valueOf('headerFooterColor', '#000000');
    const r = parseInt(hexColor.slice(1, 3), 16) / 255;
    const g = parseInt(hexColor.slice(3, 5), 16) / 255;
    const b = parseInt(hexColor.slice(5, 7), 16) / 255;
    const color = rgb(r, g, b);
    const font = await doc.embedFont('Helvetica');
    const pageCount = doc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      if (header) {
        const hw = font.widthOfTextAtSize(header, fontSize);
        page.drawText(header, { x: (width - hw) / 2, y: height - 30, size: fontSize, font, color });
      }
      if (footer) {
        const fw = font.widthOfTextAtSize(footer, fontSize);
        page.drawText(footer, { x: (width - fw) / 2, y: 20, size: fontSize, font, color });
      }
    }
    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-encabezado-pie.pdf`, title: 'Encabezado y pie', message: `Texto agregado a ${pageCount} páginas.`, stats: [['Páginas', String(pageCount)], ['Encabezado', header || '—'], ['Pie', footer || '—'], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function initCompressPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#compressPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  function initInterleavePdf() {
    ensurePdfLib();
  }

  async function initCropPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#cropPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const p = doc.getPage(0);
      const { width, height } = p.getSize();
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} págs · ${Math.round(width)}×${Math.round(height)} pt`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initResizePdfPages() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#resizePdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const p = doc.getPage(0);
      const { width, height } = p.getSize();
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} págs · ${Math.round(width)}×${Math.round(height)} pt`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initNUpPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#nUpPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initSplitDoublePdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#splitDoublePdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const p = doc.getPage(0);
      const { width, height } = p.getSize();
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} págs · ${Math.round(width)}×${Math.round(height)} pt`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initBookletPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#bookletPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const sheets = Math.ceil(doc.getPageCount() / 2);
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} págs → ${sheets} pliegos`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initWatermarkPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#watermarkPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initAddPageNumbersPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#addPageNumMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  async function initAddHeaderFooterPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#addHeaderFooterMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
    } catch (err) {
      if (meta) meta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    }
  }

  const _pt = { cancelled:false };

  function initPdfToImages() {
    ensurePdfLib();
    const file = state.files[0];
    if (!file) return;
    const allBtn = $('#pdfToImagesAllBtn');
    const cancelBtn = $('#pdfToImagesCancelBtn');
    if (allBtn) allBtn.addEventListener('click', () => { downloadAllPdfPages(); });
    if (cancelBtn) cancelBtn.addEventListener('click', () => { _pt.cancelled = true; });
    loadPdfToImagesThumbs(file);
  }

  async function loadPdfToImagesThumbs(file) {
    const meta = $('#pdfToImagesMeta');
    const thumbs = $('#pdfToImagesThumbs');
    try {
      ensurePdfLib();
      const { PDFDocument } = window.PDFLib;
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''}`;
      if (!thumbs || !window.pdfjsLib) return;
      thumbs.innerHTML = '';
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
      for (let i = 1; i <= doc.getPageCount(); i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 0.2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;border:2px solid var(--c-border);border-radius:6px;padding:3px;cursor:pointer;transition:border-color .15s';
        const num = document.createElement('span');
        num.textContent = i; num.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--muted)';
        c.style.cssText = 'width:100%;border-radius:4px;display:block';
        wrap.appendChild(num); wrap.appendChild(c);
        wrap.addEventListener('click', async () => {
          try {
            const scale = clamp(numberValue('pdfToImagesScale', 100) / 100, 0.5, 3);
            const mime = valueOf('pdfToImagesFormat', 'image/jpeg');
            const quality = clamp(numberValue('pdfToImagesQuality', 92) / 100, 0.25, 1);
            const pageData = await pdf.getPage(i);
            const fullVp = pageData.getViewport({ scale: scale * 1.5 });
            const pc = document.createElement('canvas');
            pc.width = fullVp.width; pc.height = fullVp.height;
            await pageData.render({ canvasContext: pc.getContext('2d'), viewport: fullVp }).promise;
            const blob = await canvasToBlob(pc, mime, mime === 'image/png' ? 1 : quality);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${file.name.replace(/\.pdf$/i, '')}-pagina-${i}.${extensionForMime(mime)}`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
          } catch (_) { showToast('No se pudo renderizar esta página.'); }
        });
        thumbs.appendChild(wrap);
      }
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
  }

  async function downloadAllPdfPages() {
    ensurePdfLib();
    const file = state.files[0];
    if (!file) return;
    if (!window.JSZip) throw new Error('No se pudo cargar el componente para crear ZIP.');
    _pt.cancelled = false;
    const mime = valueOf('pdfToImagesFormat', 'image/jpeg');
    const quality = clamp(numberValue('pdfToImagesQuality', 92) / 100, 0.25, 1);
    const scale = clamp(numberValue('pdfToImagesScale', 100) / 100, 0.5, 3);
    const bytes = await file.arrayBuffer();
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const totalPages = doc.getPageCount();
    const zip = new window.JSZip();
    const base = file.name.replace(/\.pdf$/i, '') || 'toolisto';
    const progSection = $('#pdfToImagesProgress');
    const progBar = $('#pdfToImagesBar');
    const progText = $('#pdfToImagesProgressText');
    if (progSection) progSection.hidden = false;

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;

    for (let i = 1; i <= totalPages; i++) {
      if (_pt.cancelled) break;
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: scale * 1.5 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await canvasToBlob(c, mime, mime === 'image/png' ? 1 : quality);
      zip.file(`${base}-pagina-${String(i).padStart(3, '0')}.${extensionForMime(mime)}`, blob);
      if (progBar) progBar.style.width = `${Math.round(i / totalPages * 100)}%`;
      if (progText) progText.textContent = `${i} de ${totalPages} páginas`;
    }

    if (_pt.cancelled) throw new Error('Proceso cancelado.');
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    if (progSection) progSection.hidden = true;
    return { blob: zipBlob, name: `${base}-paginas.zip`, title: 'PDF convertido', message: `${totalPages} páginas exportadas como ${mime === 'image/jpeg' ? 'JPG' : mime === 'image/png' ? 'PNG' : 'WebP'}.`, stats: [['Páginas', String(totalPages)], ['Formato', extensionForMime(mime).toUpperCase()], ['ZIP', formatBytes(zipBlob.size)]] };
  }

  async function processPdfToImages() {
    return downloadAllPdfPages();
  }

  /* ── censor ── */
  const _cen = { canvas:null, ctx:null, mask:null, original:null, sourceCanvas:null, sourceData:null, history:[], redoStack:[], mode:'brush', drawing:false, lastX:0, lastY:0, brushSize:20, imageW:0, imageH:0, displayW:0, displayH:0, zoom:1 };

  function initCensor() {
    const confirmEl = $('#censorConfirm');
    const brushSection = $('#censorBrushSection');
    const actions = $('#censorActions');
    if (!confirmEl) return;
    confirmEl.addEventListener('change', () => {
      const enabled = confirmEl.checked;
      if (brushSection) brushSection.hidden = !enabled;
      if (actions) actions.hidden = !enabled;
      els.runButton.disabled = !enabled;
      if (enabled && state.files.length) loadCensorImage();
    });
    const brushBtn = $('#censorBrushBtn');
    const eraserBtn = $('#censorEraserBtn');
    const undoBtn = $('#censorUndoBtn');
    const redoBtn = $('#censorRedoBtn');
    const resetBtn = $('#censorResetBtn');
    const brushSizeInput = $('#censorBrushSize');
    if (brushBtn) brushBtn.addEventListener('click', () => { _cen.mode = 'brush'; brushBtn.style.background='var(--c-primary)'; brushBtn.style.color='#fff'; brushBtn.style.borderColor='var(--c-primary)'; eraserBtn.style.background=''; eraserBtn.style.color=''; eraserBtn.style.borderColor=''; });
    if (eraserBtn) eraserBtn.addEventListener('click', () => { _cen.mode = 'eraser'; eraserBtn.style.background='var(--c-primary)'; eraserBtn.style.color='#fff'; eraserBtn.style.borderColor='var(--c-primary)'; brushBtn.style.background=''; brushBtn.style.color=''; brushBtn.style.borderColor=''; });
    if (brushSizeInput) brushSizeInput.addEventListener('input', () => { _cen.brushSize = Number(brushSizeInput.value) || 20; });
    if (undoBtn) undoBtn.addEventListener('click', cenUndo);
    if (redoBtn) redoBtn.addEventListener('click', cenRedo);
    if (resetBtn) resetBtn.addEventListener('click', cenReset);
  }

  async function loadCensorImage() {
    const file = state.files[0]; if (!file) return;
    const image = await loadImage(file);
    _cen.imageW = image.naturalWidth; _cen.imageH = image.naturalHeight;
    _cen.original = image;
    _cen.history = []; _cen.redoStack = [];
    const source = document.createElement('canvas');
    source.width = _cen.imageW; source.height = _cen.imageH;
    source.getContext('2d').drawImage(image, 0, 0);
    _cen.sourceCanvas = source;
    _cen.sourceData = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, _cen.imageW, _cen.imageH);
    _cen.mask = new Uint8Array(_cen.imageW * _cen.imageH);
    const wrap = $('#censorCanvasWrap');
    if (!wrap) return;
    wrap.style.display = 'block'; wrap.innerHTML = '';
    const maxDisplay = Math.min(wrap.parentElement.clientWidth || 600, 800);
    _cen.zoom = Math.min(maxDisplay / _cen.imageW, maxDisplay / _cen.imageH, 1);
    _cen.displayW = Math.round(_cen.imageW * _cen.zoom);
    _cen.displayH = Math.round(_cen.imageH * _cen.zoom);
    const canvas = document.createElement('canvas');
    canvas.width = _cen.displayW; canvas.height = _cen.displayH;
    canvas.style.cssText = 'width:100%;max-width:' + _cen.displayW + 'px;border-radius:8px;cursor:crosshair;display:block;touch-action:none';
    _cen.canvas = canvas; _cen.ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);
    cenRenderDisplay();
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); _cen.drawing = true; const p = cenGetPos(e); _cen.lastX = p.x; _cen.lastY = p.y; cenSaveState(); cenPaint(p.x, p.y); });
    canvas.addEventListener('pointermove', (e) => { if (!_cen.drawing) return; e.preventDefault(); const p = cenGetPos(e); const dx = p.x - _cen.lastX; const dy = p.y - _cen.lastY; const dist = Math.sqrt(dx * dx + dy * dy); const step = Math.max(1, _cen.brushSize * _cen.zoom * 0.15); const steps = Math.ceil(dist / step); for (let i = 1; i <= steps; i++) { const t = i / steps; cenPaint(_cen.lastX + dx * t, _cen.lastY + dy * t); } _cen.lastX = p.x; _cen.lastY = p.y; });
    canvas.addEventListener('pointerup', () => { _cen.drawing = false; });
    canvas.addEventListener('pointerleave', () => { _cen.drawing = false; });
    cenUpdateButtons();
  }

  function cenGetPos(e) { const r = _cen.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * _cen.displayW, y: (e.clientY - r.top) / r.height * _cen.displayH }; }
  function cenPaint(cx, cy) {
    const r = Math.round(_cen.brushSize * _cen.zoom / 2);
    const imgCx = Math.round(cx / _cen.zoom); const imgCy = Math.round(cy / _cen.zoom);
    const isBrush = _cen.mode === 'brush';
    for (let dy = -r; dy <= r; dy++) { for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const px = imgCx + dx; const py = imgCy + dy; if (px < 0 || px >= _cen.imageW || py < 0 || py >= _cen.imageH) continue; _cen.mask[py * _cen.imageW + px] = isBrush ? 1 : 0; } }
    cenRenderDisplay();
  }
  function cenRenderDisplay() {
    if (!_cen.ctx || !_cen.canvas) return;
    const ctx = _cen.ctx;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_cen.sourceCanvas, 0, 0, _cen.displayW, _cen.displayH);
    const tmpMask = document.createElement('canvas');
    tmpMask.width = _cen.imageW; tmpMask.height = _cen.imageH;
    const mctx = tmpMask.getContext('2d');
    const mData = mctx.createImageData(_cen.imageW, _cen.imageH);
    const md = mData.data;
    for (let i = 0; i < _cen.mask.length; i++) { if (_cen.mask[i]) { const pi = i * 4; md[pi] = 200; md[pi + 1] = 50; md[pi + 2] = 50; md[pi + 3] = 100; } }
    mctx.putImageData(mData, 0, 0);
    ctx.drawImage(tmpMask, 0, 0, _cen.displayW, _cen.displayH);
  }
  function cenSaveState() { _cen.history.push(new Uint8Array(_cen.mask)); if (_cen.history.length > 50) _cen.history.shift(); _cen.redoStack = []; cenUpdateButtons(); }
  function cenUndo() { if (!_cen.history.length) return; _cen.redoStack.push(new Uint8Array(_cen.mask)); _cen.mask = _cen.history.pop(); cenRenderDisplay(); cenUpdateButtons(); }
  function cenRedo() { if (!_cen.redoStack.length) return; _cen.history.push(new Uint8Array(_cen.mask)); _cen.mask = _cen.redoStack.pop(); cenRenderDisplay(); cenUpdateButtons(); }
  function cenReset() { if (!_cen.mask) return; _cen.mask.fill(0); _cen.history = []; _cen.redoStack = []; cenRenderDisplay(); cenUpdateButtons(); }
  function cenUpdateButtons() { const u = $('#censorUndoBtn'); const r = $('#censorRedoBtn'); if (u) u.disabled = !_cen.history.length; if (r) r.disabled = !_cen.redoStack.length; }

  function censorApplyEffect(srcData, mask, w, h, mode, intensity) {
    const src = new Uint8ClampedArray(srcData.data);
    const out = new Uint8ClampedArray(src);
    const m = new Uint8Array(mask);
    if (mode === 'pixelate') {
      const pixSize = clamp(Math.round(intensity), 3, 40);
      for (let by = 0; by < h; by += pixSize) {
        for (let bx = 0; bx < w; bx += pixSize) {
          let hasMask = false;
          for (let dy = 0; dy < pixSize && by + dy < h; dy++) { for (let dx = 0; dx < pixSize && bx + dx < w; dx++) { if (m[(by + dy) * w + (bx + dx)]) { hasMask = true; break; } } if (hasMask) break; }
          if (!hasMask) continue;
          let rS = 0, gS = 0, bS = 0, cnt = 0;
          for (let dy = 0; dy < pixSize && by + dy < h; dy++) { for (let dx = 0; dx < pixSize && bx + dx < w; dx++) { const pi = ((by + dy) * w + (bx + dx)) * 4; rS += src[pi]; gS += src[pi + 1]; bS += src[pi + 2]; cnt++; } }
          if (!cnt) continue;
          const rr = Math.round(rS / cnt), gg = Math.round(gS / cnt), bb = Math.round(bS / cnt);
          for (let dy = 0; dy < pixSize && by + dy < h; dy++) { for (let dx = 0; dx < pixSize && bx + dx < w; dx++) { const idx = (by + dy) * w + (bx + dx); if (m[idx]) { const pi = idx * 4; out[pi] = rr; out[pi + 1] = gg; out[pi + 2] = bb; } } }
        }
      }
    } else if (mode === 'blur') {
      const radius = clamp(Math.round(intensity / 4), 1, 10);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (!m[idx]) continue;
          let rS = 0, gS = 0, bS = 0, cnt = 0;
          for (let dy = -radius; dy <= radius; dy++) { for (let dx = -radius; dx <= radius; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const pi = (ny * w + nx) * 4; rS += src[pi]; gS += src[pi + 1]; bS += src[pi + 2]; cnt++; } }
          if (cnt) { const pi = idx * 4; out[pi] = Math.round(rS / cnt); out[pi + 1] = Math.round(gS / cnt); out[pi + 2] = Math.round(bS / cnt); }
        }
      }
    } else if (mode === 'solidBlack') {
      for (let i = 0; i < m.length; i++) { if (m[i]) { const pi = i * 4; out[pi] = 0; out[pi + 1] = 0; out[pi + 2] = 0; } }
    } else if (mode === 'solidWhite') {
      for (let i = 0; i < m.length; i++) { if (m[i]) { const pi = i * 4; out[pi] = 255; out[pi + 1] = 255; out[pi + 2] = 255; } }
    }
    return new ImageData(out, w, h);
  }

  async function processCensor() {
    const confirmEl = $('#censorConfirm');
    if (!confirmEl?.checked) throw new Error('Debes confirmar que tienes autorización para modificar la imagen.');
    const hasMask = _cen.mask && _cen.mask.some(v => v);
    if (!hasMask) throw new Error('Pinta la zona que quieres ocultar antes de procesar.');
    const mode = valueOf('censorMode', 'pixelate');
    const intensity = clamp(numberValue('censorIntensity', 12), 3, 40);
    const formatSetting = valueOf('censorOutputFormat', 'auto');
    const file = state.files[0];
    const resultData = censorApplyEffect(_cen.sourceData, _cen.mask, _cen.imageW, _cen.imageH, mode, intensity);
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = _cen.imageW; resultCanvas.height = _cen.imageH;
    resultCanvas.getContext('2d').putImageData(resultData, 0, 0);
    let mime, ext;
    if (formatSetting === 'auto') {
      if (file.type === 'image/png') { mime = 'image/png'; ext = 'png'; }
      else if (file.type === 'image/webp') { mime = 'image/webp'; ext = 'webp'; }
      else { mime = 'image/jpeg'; ext = 'jpg'; }
    } else { mime = formatSetting; ext = extensionForMime(mime); }
    const blob = await canvasToBlob(resultCanvas, mime, mime === 'image/png' ? 1 : 0.92);
    return {
      blob, name: `${baseName(file.name)}-censurada.${ext}`, title: 'Información ocultada',
      message: 'Las zonas pintadas fueron ocultadas.',
      preview: blob,
      stats: [['Dimensiones', `${_cen.imageW}×${_cen.imageH}`], ['Método', mode], ['Formato', ext.toUpperCase()], ['Tamaño', formatBytes(blob.size)]],
    };
  }

  /* ── fixFormat ── */
  const MAGIC_SIGNATURES = [
    { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg', name: 'JPEG' },
    { bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png', name: 'PNG' },
    { bytes: [0x47, 0x49, 0x46], mime: 'image/gif', name: 'GIF' },
    { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp', name: 'WebP' },
    { bytes: [0x42, 0x4D], mime: 'image/bmp', name: 'BMP' },
    { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf', name: 'PDF' },
  ];

  function initFixFormat() {
    const file = state.files[0]; if (!file) return;
    file.arrayBuffer().then(bytes => {
      const header = new Uint8Array(bytes.slice(0, 8));
      let detected = null;
      for (const sig of MAGIC_SIGNATURES) { if (sig.bytes.every((b, i) => header[i] === b)) { detected = sig; break; } }
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const extToMime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', pdf:'application/pdf' };
      const fileMime = extToMime[ext] || file.type;
      const meta = $('#fixFormatMeta');
      const detection = $('#fixFormatDetection');
      const details = $('#fixFormatDetails');
      if (meta) meta.textContent = file.name;
      if (detection && details) {
        detection.hidden = false;
        let html = '';
        html += `<div><strong>Extensión:</strong> .${escapeHtml(ext)}</div>`;
        html += `<div><strong>Tipo reportado:</strong> ${escapeHtml(file.type || 'desconocido')}</div>`;
        html += `<div><strong>Formato detectado:</strong> ${detected ? detected.name : 'No reconocido'}</div>`;
        if (detected && fileMime !== detected.mime) {
          html += `<div style="color:var(--c-error);margin-top:6px"><strong>⚠ Incompatibilidad:</strong> El archivo tiene extensión .${escapeHtml(ext)} pero contiene datos ${escapeHtml(detected.name)}.</div>`;
        } else if (detected) {
          html += `<div style="color:var(--c-success);margin-top:6px">✓ La extensión coincide con el contenido.</div>`;
        }
        html += `<div style="margin-top:6px;color:var(--muted);font-size:.82rem">Tamaño: ${formatBytes(file.size)}</div>`;
        details.innerHTML = html;
      }
    }).catch(() => {
      const meta = $('#fixFormatMeta');
      if (meta) meta.textContent = 'No se pudo analizar el archivo.';
    });
  }

  async function processFixFormat() {
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const header = new Uint8Array(bytes.slice(0, 8));
    let detected = null;
    for (const sig of MAGIC_SIGNATURES) { if (sig.bytes.every((b, i) => header[i] === b)) { detected = sig; break; } }
    if (!detected) throw new Error('No se pudo detectar el formato del archivo. Puede estar corrupto.');
    const targetSetting = valueOf('fixFormatTarget', 'auto');
    const quality = clamp(numberValue('fixFormatQuality', 92) / 100, 0.25, 1);
    const targetMime = targetSetting === 'auto' ? detected.mime : targetSetting;
    if (targetMime === 'application/pdf') throw new Error('Este archivo ya es un PDF. Usa la herramienta de conversión para cambiar a imagen.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(targetMime)) throw new Error(`Formato de salida no soportado: ${targetMime}`);
    const image = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: targetMime !== 'image/jpeg' });
    if (targetMime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(image, 0, 0);
    const blob = await canvasToBlob(canvas, targetMime, targetMime === 'image/png' ? 1 : quality);
    const ext = extensionForMime(targetMime);
    return {
      blob, name: `${baseName(file.name)}.${ext}`, title: 'Formato reparado',
      message: `El archivo fue re-codificado como ${detected.name} (${ext}).`,
      preview: blob,
      stats: [['Detectado', detected.name], ['Original', formatBytes(file.size)], ['Resultado', formatBytes(blob.size)], ['Formato', ext.toUpperCase()]],
    };
  }

  /* ── signPdf ── */
  const _sigPdf = { canvas:null, ctx:null, drawing:false, points:[], allPoints:[], pageCount:0 };

  function initSignPdf() {
    const file = state.files[0];
    if (!file) return;
    const typeSel = $('#signPdfType');
    const drawSec = $('#signPdfDrawSection');
    const typeSec = $('#signPdfTypeSection');
    const clearBtn = $('#signPdfClearBtn');

    if (typeSel) typeSel.addEventListener('change', () => {
      if (drawSec) drawSec.style.display = typeSel.value === 'draw' ? '' : 'none';
      if (typeSec) typeSec.style.display = typeSel.value === 'type' ? '' : 'none';
    });
    if (clearBtn) clearBtn.addEventListener('click', () => { _sigPdf.allPoints = []; _sigPdf.points = []; renderSigPdfCanvas(); });
    loadSignPdf(file);
  }

  async function loadSignPdf(file) {
    const meta = $('#signPdfMeta');
    try {
      ensurePdfLib();
      const { PDFDocument } = window.PDFLib;
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      _sigPdf.pageCount = doc.getPageCount();
      if (meta) meta.textContent = file.name + ' \u00b7 ' + _sigPdf.pageCount + ' p\u00e1gin' + (_sigPdf.pageCount !== 1 ? 'as' : 'a');
      const pageInput = $('#signPdfPage');
      if (pageInput) { pageInput.max = _sigPdf.pageCount; pageInput.value = Math.min(Number(pageInput.value) || 1, _sigPdf.pageCount); }

      const wrap = $('#signPdfCanvasWrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 140;
      canvas.style.cssText = 'width:100%;max-width:400px;height:auto;cursor:crosshair;display:block;touch-action:none;background:#fff';
      _sigPdf.canvas = canvas; _sigPdf.ctx = canvas.getContext('2d');
      wrap.appendChild(canvas);
      renderSigPdfCanvas();

      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault(); canvas.setPointerCapture(e.pointerId);
        _sigPdf.drawing = true; _sigPdf.points = [];
        _sigPdf.points.push(getSigPdfPos(e));
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!_sigPdf.drawing) return; e.preventDefault();
        _sigPdf.points.push(getSigPdfPos(e)); renderSigPdfCanvas();
      });
      canvas.addEventListener('pointerup', () => {
        if (_sigPdf.drawing) { _sigPdf.drawing = false; _sigPdf.allPoints.push([..._sigPdf.points]); _sigPdf.points = []; }
      });
      canvas.addEventListener('pointerleave', () => {
        if (_sigPdf.drawing) { _sigPdf.drawing = false; _sigPdf.allPoints.push([..._sigPdf.points]); _sigPdf.points = []; }
      });
    } catch (err) {
      if (meta) meta.textContent = err?.message?.includes('password') ? 'PDF protegido.' : 'No se pudo leer el PDF.';
    }
  }

  function getSigPdfPos(e) {
    const rect = _sigPdf.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * 400, y: (e.clientY - rect.top) / rect.height * 140 };
  }

  function renderSigPdfCanvas() {
    if (!_sigPdf.ctx) return;
    const ctx = _sigPdf.ctx;
    ctx.clearRect(0, 0, 400, 140);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 140);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const drawPath = (pts, color) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };
    _sigPdf.allPoints.forEach(pts => drawPath(pts, '#1a1a1a'));
    drawPath(_sigPdf.points, '#1a1a1a');
  }

  async function processSignPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const type = valueOf('signPdfType', 'draw');
    const position = valueOf('signPdfPosition', 'bottomRight');
    const sigWidth = clamp(numberValue('signPdfWidth', 150), 40, 400);

    let sigCanvas;
    if (type === 'draw') {
      if (!_sigPdf.allPoints.length) throw new Error('Dibuja tu firma antes de procesar.');
      sigCanvas = document.createElement('canvas');
      sigCanvas.width = 400; sigCanvas.height = 140;
      const sctx = sigCanvas.getContext('2d');
      sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, 400, 140);
      sctx.lineCap = 'round'; sctx.lineJoin = 'round';
      _sigPdf.allPoints.forEach(pts => {
        if (pts.length < 2) return;
        sctx.strokeStyle = '#1a1a1a'; sctx.lineWidth = 3; sctx.beginPath();
        sctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) sctx.lineTo(pts[i].x, pts[i].y);
        sctx.stroke();
      });
    } else {
      const text = ($('#signPdfText')?.value || '').trim();
      if (!text) throw new Error('Escribe el texto de la firma.');
      const font = valueOf('signPdfFont', 'cursive');
      const fontSize = clamp(numberValue('signPdfFontSize', 48), 16, 120);
      const ink = valueOf('signPdfInk', '#1a1a1a');
      sigCanvas = document.createElement('canvas');
      sigCanvas.width = 600; sigCanvas.height = 200;
      const sctx = sigCanvas.getContext('2d');
      sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, 600, 200);
      sctx.fillStyle = ink; sctx.font = fontSize + 'px "' + font + '"'; sctx.textBaseline = 'middle';
      sctx.fillText(text, 20, 100);
    }

    const sigBlob = await canvasToBlob(sigCanvas, 'image/png', 1);
    const sigBytes = await sigBlob.arrayBuffer();
    const sigImg = await doc.embedPng(sigBytes);
    const sigH = sigImg.height * (sigWidth / sigImg.width);

    const pageNum = clamp(numberValue('signPdfPage', 1), 1, doc.getPageCount());
    const page = doc.getPage(pageNum - 1);
    const { width: pw, height: ph } = page.getSize();
    let x, y;
    const margin = 40;
    if (position === 'bottomRight') { x = pw - sigWidth - margin; y = margin; }
    else if (position === 'bottomLeft') { x = margin; y = margin; }
    else if (position === 'topRight') { x = pw - sigWidth - margin; y = ph - sigH - margin; }
    else if (position === 'topLeft') { x = margin; y = ph - sigH - margin; }
    else { x = (pw - sigWidth) / 2; y = (ph - sigH) / 2; }

    page.drawImage(sigImg, { x, y, width: sigWidth, height: sigH });
    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    return {
      blob, name: file.name.replace(/\.pdf$/i, '') + '-firmado.pdf', title: 'PDF firmado',
      message: 'La firma fue colocada en la p\u00e1gina ' + pageNum + '.',
      stats: [['P\u00e1ginas', String(doc.getPageCount())], ['Firma en', 'P\u00e1gina ' + pageNum], ['Posici\u00f3n', position], ['Tama\u00f1o', formatBytes(blob.size)]],
    };
  }

  /* ── docPhoto ── */
  const DOC_PHOTO_PRESETS = {
    passport: { wMm: 35, hMm: 45 },
    visaUS: { wMm: 51, hMm: 51 },
    idCard: { wMm: 32, hMm: 26 },
    passportBook: { wMm: 33, hMm: 48 },
    driverLicense: { wMm: 51, hMm: 38 },
    twoByTwo: { wMm: 51, hMm: 51 },
  };

  function initDocPhoto() {
    const presetSel = $('#docPhotoPreset');
    const customSize = $('#docPhotoCustomSize');
    if (presetSel) presetSel.addEventListener('change', () => {
      if (customSize) customSize.hidden = presetSel.value !== 'custom';
      loadDocPhotoPreview();
    });
    loadDocPhotoPreview();
  }

  async function loadDocPhotoPreview() {
    const file = state.files[0]; if (!file) return;
    const image = await loadImage(file);
    const wrap = $('#docPhotoCanvasWrap');
    if (!wrap) return;
    wrap.style.display = 'block'; wrap.innerHTML = '';

    const preset = ($('#docPhotoPreset')?.value) || 'passport';
    const dpi = clamp(numberValue('docPhotoDpi', 300), 72, 600);
    const borderMm = clamp(numberValue('docPhotoBorder', 3), 0, 20);
    const p = DOC_PHOTO_PRESETS[preset] || { wMm: Number($('#docPhotoWidth')?.value) || 35, hMm: Number($('#docPhotoHeight')?.value) || 45 };
    const photoWPx = Math.round(p.wMm / 25.4 * dpi);
    const photoHPx = Math.round(p.hMm / 25.4 * dpi);
    const totalWPx = Math.round((p.wMm + borderMm * 2) / 25.4 * dpi);
    const totalHPx = Math.round((p.hMm + borderMm * 2) / 25.4 * dpi);

    const maxDisplay = Math.min(wrap.parentElement.clientWidth || 400, 400);
    const scale = Math.min(maxDisplay / totalWPx, maxDisplay / totalHPx, 1);
    const dW = Math.round(totalWPx * scale);
    const dH = Math.round(totalHPx * scale);

    const canvas = document.createElement('canvas');
    canvas.width = dW; canvas.height = dH;
    canvas.style.cssText = 'width:100%;max-width:' + dW + 'px;border-radius:8px;display:block';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dW, dH);

    const imgRatio = image.naturalWidth / image.naturalHeight;
    const photoRatio = photoWPx / photoHPx;
    let sx, sy, sw, sh;
    if (imgRatio > photoRatio) { sh = image.naturalHeight; sw = sh * photoRatio; sx = (image.naturalWidth - sw) / 2; sy = 0; }
    else { sw = image.naturalWidth; sh = sw / photoRatio; sx = 0; sy = (image.naturalHeight - sh) / 2; }

    const drawX = borderMm / 25.4 * dpi * scale;
    const drawY = borderMm / 25.4 * dpi * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, sw, sh, drawX, drawY, photoWPx * scale, photoHPx * scale);

    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeRect(drawX, drawY, photoWPx * scale, photoHPx * scale);
    ctx.setLineDash([]);

    const sheet = ($('#docPhotoSheet')?.value) || 'photo';
    const copies = clamp(numberValue('docPhotoCopies', 1), 1, 16);
    const info = document.createElement('div');
    info.style.cssText = 'margin-top:6px;font-size:.8rem;color:var(--muted)';
    info.textContent = p.wMm + '\u00d7' + p.hMm + ' mm \u00b7 ' + photoWPx + '\u00d7' + photoHPx + ' px \u00b7 ' + borderMm + 'mm borde \u00b7 ' + dpi + ' DPI' + (sheet !== 'photo' ? ' \u00b7 Hoja ' + (sheet === 'a4' ? 'A4' : 'Carta') + ' \u00b7 ' + copies + ' copia' + (copies !== 1 ? 's' : '') : '');
    wrap.appendChild(canvas);
    wrap.appendChild(info);
  }

  async function processDocPhoto() {
    const file = state.files[0];
    const image = await loadImage(file);
    const preset = ($('#docPhotoPreset')?.value) || 'passport';
    const dpi = clamp(numberValue('docPhotoDpi', 300), 72, 600);
    const borderMm = clamp(numberValue('docPhotoBorder', 3), 0, 20);
    const bgSetting = valueOf('docPhotoBg', '#ffffff');
    const bgColor = bgSetting === '#ffffff' ? '#ffffff' : bgSetting === '#0055a5' ? '#0055a5' : bgSetting === '#eeeeee' ? '#eeeeee' : bgSetting === '#d4e6f1' ? '#d4e6f1' : valueOf('docPhotoBgCustom', '#ffffff');
    const mime = valueOf('docPhotoFormat', 'image/jpeg');
    const sheet = valueOf('docPhotoSheet', 'photo');
    const copies = clamp(numberValue('docPhotoCopies', 1), 1, 16);

    const p = DOC_PHOTO_PRESETS[preset] || { wMm: Number($('#docPhotoWidth')?.value) || 35, hMm: Number($('#docPhotoHeight')?.value) || 45 };
    const photoWPx = Math.round(p.wMm / 25.4 * dpi);
    const photoHPx = Math.round(p.hMm / 25.4 * dpi);

    if (sheet === 'photo') {
      const totalWPx = Math.round((p.wMm + borderMm * 2) / 25.4 * dpi);
      const totalHPx = Math.round((p.hMm + borderMm * 2) / 25.4 * dpi);

      const canvas = document.createElement('canvas');
      canvas.width = totalWPx; canvas.height = totalHPx;
      const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, totalWPx, totalHPx);

      const imgRatio = image.naturalWidth / image.naturalHeight;
      const photoRatio = photoWPx / photoHPx;
      let sx, sy, sw, sh;
      if (imgRatio > photoRatio) { sh = image.naturalHeight; sw = sh * photoRatio; sx = (image.naturalWidth - sw) / 2; sy = 0; }
      else { sw = image.naturalWidth; sh = sw / photoRatio; sx = 0; sy = (image.naturalHeight - sh) / 2; }

      const drawX = Math.round(borderMm / 25.4 * dpi);
      const drawY = Math.round(borderMm / 25.4 * dpi);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, sx, sy, sw, sh, drawX, drawY, photoWPx, photoHPx);

      const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? 1 : 0.95);
      const ext = extensionForMime(mime);
      return {
        blob, name: baseName(file.name) + '-' + p.wMm + 'x' + p.hMm + 'mm.' + ext, title: 'Foto para documento',
        message: 'Foto generada a ' + p.wMm + '\u00d7' + p.hMm + ' mm con ' + dpi + ' DPI.',
        preview: blob,
        stats: [['Dimensiones', totalWPx + '\u00d7' + totalHPx + ' px'], ['DPI', String(dpi)], ['Fondo', bgColor], ['Tama\u00f1o', formatBytes(blob.size)]],
      };
    }

    const sheetSizes = { a4: { wMm: 210, hMm: 297 }, letter: { wMm: 216, hMm: 279 } };
    const sheetPx = sheetSizes[sheet] || sheetSizes.a4;
    const sheetWPx = Math.round(sheetPx.wMm / 25.4 * dpi);
    const sheetHPx = Math.round(sheetPx.hMm / 25.4 * dpi);

    const canvas = document.createElement('canvas');
    canvas.width = sheetWPx; canvas.height = sheetHPx;
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, sheetWPx, sheetHPx);

    const photoWPxTotal = Math.round((p.wMm + borderMm * 2) / 25.4 * dpi);
    const photoHPxTotal = Math.round((p.hMm + borderMm * 2) / 25.4 * dpi);

    const cols = Math.max(1, Math.floor((sheetWPx - photoWPxTotal) / (photoWPxTotal + Math.round(5 / 25.4 * dpi))) + 1);
    const rows = Math.max(1, Math.floor((sheetHPx - photoHPxTotal) / (photoHPxTotal + Math.round(5 / 25.4 * dpi))) + 1);
    const placedCount = Math.min(copies, cols * rows);

    const gapX = cols > 1 ? Math.floor((sheetWPx - cols * photoWPxTotal) / (cols + 1)) : Math.floor((sheetWPx - photoWPxTotal) / 2);
    const gapY = rows > 1 ? Math.floor((sheetHPx - rows * photoHPxTotal) / (rows + 1)) : Math.floor((sheetHPx - photoHPxTotal) / 2);

    const imgRatio = image.naturalWidth / image.naturalHeight;
    const photoRatio = photoWPx / photoHPx;
    let sx, sy, sw, sh;
    if (imgRatio > photoRatio) { sh = image.naturalHeight; sw = sh * photoRatio; sx = (image.naturalWidth - sw) / 2; sy = 0; }
    else { sw = image.naturalWidth; sh = sw / photoRatio; sx = 0; sy = (image.naturalHeight - sh) / 2; }

    ctx.imageSmoothingQuality = 'high';
    let count = 0;
    for (let r = 0; r < rows && count < placedCount; r++) {
      for (let c = 0; c < cols && count < placedCount; c++) {
        const ox = gapX + c * (photoWPxTotal + gapX);
        const oy = gapY + r * (photoHPxTotal + gapY);
        ctx.fillStyle = bgColor;
        ctx.fillRect(ox, oy, photoWPxTotal, photoHPxTotal);
        const drawX = ox + Math.round(borderMm / 25.4 * dpi);
        const drawY = oy + Math.round(borderMm / 25.4 * dpi);
        ctx.drawImage(image, sx, sy, sw, sh, drawX, drawY, photoWPx, photoHPx);
        count++;
      }
    }

    const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? 1 : 0.95);
    const ext = extensionForMime(mime);
    return {
      blob, name: baseName(file.name) + '-' + p.wMm + 'x' + p.hMm + 'mm-hoja.' + ext, title: 'Foto para documento',
      message: placedCount + ' foto' + (placedCount !== 1 ? 's' : '') + ' en hoja ' + (sheet === 'a4' ? 'A4' : 'Carta') + ' a ' + dpi + ' DPI.',
      preview: blob,
      stats: [['Fotos', String(placedCount)], ['Hoja', sheet === 'a4' ? 'A4' : 'Carta'], ['DPI', String(dpi)], ['Tama\u00f1o', formatBytes(blob.size)]],
    };
  }

  /* ── rescueDoc ── */
  let _rescueImage = null;

  function initRescueDoc() {
    const previewBtn = $('#rescuePreviewBtn');
    if (previewBtn) previewBtn.addEventListener('click', renderRescuePreview);
    loadRescueImage();
  }

  async function loadRescueImage() {
    const file = state.files[0]; if (!file) return;
    _rescueImage = await loadImage(file);
    renderRescuePreview();
  }

  function renderRescuePreview() {
    if (!_rescueImage) return;
    const wrap = $('#rescueCanvasWrap');
    if (!wrap) return;
    wrap.style.display = 'block'; wrap.innerHTML = '';

    const brightness = clamp(numberValue('rescueBrightness', 0) / 100, -1, 1);
    const contrast = clamp(numberValue('rescueContrast', 20) / 100 + 1, 0, 3);
    const exposure = clamp(numberValue('rescueExposure', 10) / 100 + 1, 0, 3);
    const sharpness = clamp(numberValue('rescueSharpness', 30), 0, 100);
    const colorMode = valueOf('rescueColorMode', 'color');
    const bwThreshold = clamp(numberValue('rescueBwThreshold', 128), 0, 255);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = _rescueImage.naturalWidth; srcCanvas.height = _rescueImage.naturalHeight;
    const sctx = srcCanvas.getContext('2d');
    sctx.drawImage(_rescueImage, 0, 0);
    const imageData = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      r = clamp((r / 255 + brightness) * exposure * 255, 0, 255);
      g = clamp((g / 255 + brightness) * exposure * 255, 0, 255);
      b = clamp((b / 255 + brightness) * exposure * 255, 0, 255);
      r = clamp(((r / 255 - 0.5) * contrast + 0.5) * 255, 0, 255);
      g = clamp(((g / 255 - 0.5) * contrast + 0.5) * 255, 0, 255);
      b = clamp(((b / 255 - 0.5) * contrast + 0.5) * 255, 0, 255);
      if (colorMode === 'grayscale') { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = g = b = gray; }
      else if (colorMode === 'bw') { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = g = b = gray > bwThreshold ? 255 : 0; }
      d[i] = Math.round(r); d[i + 1] = Math.round(g); d[i + 2] = Math.round(b);
    }
    sctx.putImageData(imageData, 0, 0);

    if (sharpness > 0) {
      const factor = sharpness / 100;
      const origData = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
      const od = origData.data;
      const w = srcCanvas.width, h = srcCanvas.height;
      const tmp = new Uint8ClampedArray(od);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const center = tmp[idx + c] * 5;
            const neighbors = tmp[((y - 1) * w + x) * 4 + c] + tmp[((y + 1) * w + x) * 4 + c] + tmp[(y * w + x - 1) * 4 + c] + tmp[(y * w + x + 1) * 4 + c];
            od[idx + c] = clamp(Math.round(tmp[idx + c] + (center - neighbors) * factor), 0, 255);
          }
        }
      }
      sctx.putImageData(origData, 0, 0);
    }

    const maxDisplay = Math.min(wrap.parentElement.clientWidth || 400, 600);
    const scale = Math.min(maxDisplay / srcCanvas.width, maxDisplay / srcCanvas.height, 1);
    const dW = Math.round(srcCanvas.width * scale);
    const dH = Math.round(srcCanvas.height * scale);

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = dW; displayCanvas.height = dH;
    displayCanvas.style.cssText = 'width:100%;border-radius:8px;display:block';
    displayCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, dW, dH);
    wrap.appendChild(displayCanvas);

    const info = document.createElement('div');
    info.style.cssText = 'margin-top:6px;font-size:.8rem;color:var(--muted)';
    info.textContent = 'Vista previa \u00b7 ' + srcCanvas.width + '\u00d7' + srcCanvas.height + ' px';
    wrap.appendChild(info);
  }

  async function processRescueDoc() {
    const file = state.files[0];
    const image = await loadImage(file);
    const brightness = clamp(numberValue('rescueBrightness', 0) / 100, -1, 1);
    const contrast = clamp(numberValue('rescueContrast', 20) / 100 + 1, 0, 3);
    const exposure = clamp(numberValue('rescueExposure', 10) / 100 + 1, 0, 3);
    const sharpness = clamp(numberValue('rescueSharpness', 30), 0, 100);
    const colorMode = valueOf('rescueColorMode', 'color');
    const bwThreshold = clamp(numberValue('rescueBwThreshold', 128), 0, 255);
    const formatSetting = valueOf('rescueOutput', 'auto');

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      r = clamp((r / 255 + brightness) * exposure * 255, 0, 255);
      g = clamp((g / 255 + brightness) * exposure * 255, 0, 255);
      b = clamp((b / 255 + brightness) * exposure * 255, 0, 255);
      r = clamp(((r / 255 - 0.5) * contrast + 0.5) * 255, 0, 255);
      g = clamp(((g / 255 - 0.5) * contrast + 0.5) * 255, 0, 255);
      b = clamp(((b / 255 - 0.5) * contrast + 0.5) * 255, 0, 255);
      if (colorMode === 'grayscale') { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = g = b = gray; }
      else if (colorMode === 'bw') { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = g = b = gray > bwThreshold ? 255 : 0; }
      d[i] = Math.round(r); d[i + 1] = Math.round(g); d[i + 2] = Math.round(b);
    }
    ctx.putImageData(imageData, 0, 0);

    if (sharpness > 0) {
      const factor = sharpness / 100;
      const origData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const od = origData.data;
      const w = canvas.width, h = canvas.height;
      const tmp = new Uint8ClampedArray(od);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const center = tmp[idx + c] * 5;
            const neighbors = tmp[((y - 1) * w + x) * 4 + c] + tmp[((y + 1) * w + x) * 4 + c] + tmp[(y * w + x - 1) * 4 + c] + tmp[(y * w + x + 1) * 4 + c];
            od[idx + c] = clamp(Math.round(tmp[idx + c] + (center - neighbors) * factor), 0, 255);
          }
        }
      }
      ctx.putImageData(origData, 0, 0);
    }

    let mime, ext;
    if (formatSetting === 'auto') {
      if (file.type === 'image/png') { mime = 'image/png'; ext = 'png'; }
      else if (file.type === 'image/webp') { mime = 'image/webp'; ext = 'webp'; }
      else { mime = 'image/jpeg'; ext = 'jpg'; }
    } else { mime = formatSetting; ext = extensionForMime(mime); }

    const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? 1 : 0.92);
    return {
      blob, name: baseName(file.name) + '-rescatado.' + ext, title: 'Documento rescatado',
      message: 'Se aplicaron mejoras de brillo, contraste y nitidez.',
      preview: blob,
      stats: [['Dimensiones', canvas.width + '\u00d7' + canvas.height], ['Formato', ext.toUpperCase()], ['Tama\u00f1o', formatBytes(blob.size)]],
    };
  }

  /* ── fileCompliance ── */
  function initFileCompliance() {
    const analyzeBtn = $('#complianceAnalyzeBtn');
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeCompliance);
    if (state.files.length) analyzeCompliance();
  }

  let _complianceState = null;

  function complianceBadge(pass) {
    const bg = pass ? '#1e9e6e' : '#d64541';
    const label = pass ? 'Cumple' : 'No cumple';
    return `<span style="display:inline-block;background:${bg};color:#fff;border-radius:999px;padding:1px 9px;font-size:.72rem;font-weight:600">${label}</span>`;
  }

  async function analyzeCompliance() {
    const file = state.files[0]; if (!file) return;
    const results = $('#complianceResults');
    const infoEl = $('#complianceInfo');
    if (!results) return;
    if (infoEl) infoEl.textContent = '';

    const maxKB = clamp(numberValue('complianceMaxKB', 500), 10, 100000);
    const minW = clamp(numberValue('complianceMinW', 0), 0, 10000);
    const maxW = clamp(numberValue('complianceMaxW', 0), 0, 10000);
    const minH = clamp(numberValue('complianceMinH', 0), 0, 10000);
    const maxH = clamp(numberValue('complianceMaxH', 0), 0, 10000);
    const format = valueOf('complianceFormat', 'any');

    const checks = [];
    const fileKB = file.size / 1024;
    checks.push({ label: 'Tamaño: ' + formatBytes(file.size), pass: fileKB <= maxKB, detail: 'Máximo: ' + maxKB + ' KB' });

    if (file.type.startsWith('image/')) {
      const image = await loadImage(file);
      const w = image.naturalWidth, h = image.naturalHeight;
      if (minW > 0) checks.push({ label: 'Ancho: ' + w + ' px', pass: w >= minW, detail: 'Mínimo: ' + minW + ' px' });
      if (maxW > 0) checks.push({ label: 'Ancho: ' + w + ' px', pass: w <= maxW, detail: 'Máximo: ' + maxW + ' px' });
      if (minH > 0) checks.push({ label: 'Alto: ' + h + ' px', pass: h >= minH, detail: 'Mínimo: ' + minH + ' px' });
      if (maxH > 0) checks.push({ label: 'Alto: ' + h + ' px', pass: h <= maxH, detail: 'Máximo: ' + maxH + ' px' });
    }

    if (format !== 'any') {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const extMap = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
      const validExts = extMap[format] || [];
      checks.push({ label: 'Formato: .' + ext, pass: validExts.includes(ext) || file.type === format, detail: 'Requerido: ' + format.split('/')[1].toUpperCase() });
    }

    const allPass = checks.every(c => c.pass);
    _complianceState = { allPass, checks, file };
    results.innerHTML = checks.map(c =>
      '<div style="margin-bottom:4px">' + complianceBadge(c.pass) + ' ' + c.label + ' <span style="color:var(--muted);font-size:.8rem">(' + c.detail + ')</span></div>'
    ).join('');
    results.innerHTML += '<div style="margin-top:8px;font-weight:600;color:' + (allPass ? 'var(--c-success)' : 'var(--c-error)') + '">' + (allPass ? 'Archivo cumple todos los requisitos' : 'Archivo no cumple algunos requisitos. Usa el botón principal para ajustarlo automáticamente.') + '</div>';
  }

  async function processFileCompliance() {
    const file = state.files[0];
    if (!_complianceState || _complianceState.file !== file) await analyzeCompliance();
    if (!_complianceState) return null;
    if (_complianceState.allPass) {
      return {
        blob: file, name: file.name, title: 'Archivo válido',
        message: 'El archivo cumple todos los requisitos. No se necesitan cambios.',
        stats: [['Archivo', file.name], ['Tamaño', formatBytes(file.size)]],
      };
    }

    const unmet = _complianceState.checks.filter(c => !c.pass).map(c => c.label);
    const maxKB = clamp(numberValue('complianceMaxKB', 500), 10, 100000) * 1024;
    const maxW = clamp(numberValue('complianceMaxW', 0), 0, 10000);
    const maxH = clamp(numberValue('complianceMaxH', 0), 0, 10000);
    const format = valueOf('complianceFormat', 'any');
    const image = await loadImage(file);

    let w = image.naturalWidth, h = image.naturalHeight;
    if (maxW > 0 && w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    if (maxH > 0 && h > maxH) { w = Math.round(w * maxH / h); h = maxH; }

    const mime = format === 'any' ? (file.type === 'image/png' ? 'image/png' : 'image/webp') : format;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);

    let blob;
    for (let q = 0.9; q >= 0.15; q -= 0.08) {
      blob = await canvasToBlob(canvas, mime, q);
      if (blob.size <= maxKB) break;
    }
    if (!blob) blob = await canvasToBlob(canvas, mime, 0.15);

    const ext = extensionForMime(mime);
    const passFinal = blob.size <= maxKB && unmet.every(u => !/Tamaño/.test(u));
    return {
      blob, name: baseName(file.name) + '-cumple.' + ext, title: passFinal ? 'Archivo ajustado' : 'Archivo parcialmente ajustado',
      message: passFinal ? 'Se ajustaron dimensiones y peso para cumplir los requisitos.' : 'Se redujo el peso, pero no fue posible cumplir todos los requisitos exactos. Requisitos pendientes: ' + unmet.join(', ') + '.',
      preview: blob,
      stats: [['Dimensiones', w + '×' + h], ['Peso', formatBytes(blob.size)], ['Formato', ext.toUpperCase()], ['Resultado', passFinal ? 'Cumple' : 'Parcial']],
    };
  }

  /* ── workflow ── */
  let _wfSteps = [];

  const WF_OPS = {
    compress: { label: 'Comprimir', defaults: { quality: 82, maxWidth: 0 } },
    resize: { label: 'Redimensionar', defaults: { width: 1080, height: 0 } },
    convert: { label: 'Convertir', defaults: { format: 'image/webp' } },
    rotate: { label: 'Rotar', defaults: { degrees: 90 } },
    flip: { label: 'Voltear', defaults: { direction: 'h' } },
    stripMeta: { label: 'Metadatos', defaults: {} },
    watermark: { label: 'Marca de agua', defaults: { text: 'WATERMARK', size: 36, opacity: 30, position: 'center', color: '#ffffff' } },
  };

  function initWorkflow() {
    $$('.wf-add').forEach(btn => btn.addEventListener('click', () => {
      const op = btn.dataset.op;
      if (!WF_OPS[op]) return;
      _wfSteps.push({ op, config: Object.assign({}, WF_OPS[op].defaults) });
      renderWfSteps();
    }));
    const saveBtn = $('#wfSavePreset');
    const loadSel = $('#wfLoadPreset');
    const deleteBtn = $('#wfDeletePreset');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const name = prompt('Nombre del flujo:');
      if (!name?.trim()) return;
      const presets = JSON.parse(localStorage.getItem('toolisto-workflows') || '{}');
      presets[name.trim()] = _wfSteps;
      localStorage.setItem('toolisto-workflows', JSON.stringify(presets));
      loadWfPresets();
      showToast('Flujo guardado.');
    });
    if (loadSel) loadSel.addEventListener('change', () => {
      const presets = JSON.parse(localStorage.getItem('toolisto-workflows') || '{}');
      if (presets[loadSel.value]) { _wfSteps = JSON.parse(JSON.stringify(presets[loadSel.value])); renderWfSteps(); }
    });
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      const name = loadSel?.value;
      if (!name) return;
      const presets = JSON.parse(localStorage.getItem('toolisto-workflows') || '{}');
      delete presets[name];
      localStorage.setItem('toolisto-workflows', JSON.stringify(presets));
      loadWfPresets();
      showToast('Flujo eliminado.');
    });
    loadWfPresets();
  }

  function loadWfPresets() {
    const sel = $('#wfLoadPreset');
    if (!sel) return;
    const presets = JSON.parse(localStorage.getItem('toolisto-workflows') || '{}');
    sel.innerHTML = '<option value="">Cargar flujo guardado\u2026</option>';
    Object.keys(presets).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  function renderWfSteps() {
    const container = $('#wfSteps');
    if (!container) return;
    if (!_wfSteps.length) { container.innerHTML = '<span style="color:var(--muted)">Agrega operaciones desde los botones de arriba.</span>'; return; }

    container.innerHTML = '';
    _wfSteps.forEach((step, i) => {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px;flex-wrap:wrap';
      let configHtml = '';
      const c = step.config;
      if (step.op === 'compress') {
        configHtml = '<input type="number" value="' + c.quality + '" min="10" max="100" style="width:60px;padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem" data-cf="quality" /> % cal \u00b7 m\u00e1x <input type="number" value="' + c.maxWidth + '" min="0" max="10000" style="width:60px;padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem" data-cf="maxWidth" /> px';
      } else if (step.op === 'resize') {
        configHtml = '<input type="number" value="' + c.width + '" min="1" max="10000" style="width:70px;padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem" data-cf="width" /> \u00d7 <input type="number" value="' + c.height + '" min="0" max="10000" style="width:70px;padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem" data-cf="height" /> px';
      } else if (step.op === 'convert') {
        configHtml = '<select data-cf="format" style="padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem"><option value="image/webp"' + (c.format === 'image/webp' ? ' selected' : '') + '>WebP</option><option value="image/jpeg"' + (c.format === 'image/jpeg' ? ' selected' : '') + '>JPG</option><option value="image/png"' + (c.format === 'image/png' ? ' selected' : '') + '>PNG</option></select>';
      } else if (step.op === 'rotate') {
        configHtml = '<select data-cf="degrees" style="padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem"><option value="90"' + (c.degrees == 90 ? ' selected' : '') + '>90\u00b0</option><option value="180"' + (c.degrees == 180 ? ' selected' : '') + '>180\u00b0</option><option value="270"' + (c.degrees == 270 ? ' selected' : '') + '>270\u00b0</option></select>';
      } else if (step.op === 'flip') {
        configHtml = '<select data-cf="direction" style="padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem"><option value="h"' + (c.direction === 'h' ? ' selected' : '') + '>Horizontal</option><option value="v"' + (c.direction === 'v' ? ' selected' : '') + '>Vertical</option><option value="hv"' + (c.direction === 'hv' ? ' selected' : '') + '>Ambos</option></select>';
      } else if (step.op === 'watermark') {
        configHtml = '<input type="text" value="' + escapeHtml(c.text) + '" style="width:80px;padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem" data-cf="text" /> <input type="number" value="' + c.size + '" min="8" max="200" style="width:50px;padding:4px;border:1px solid var(--c-border);border-radius:4px;font-size:.82rem" data-cf="size" />px';
      } else if (step.op === 'stripMeta') {
        configHtml = '<span style="font-size:.82rem;color:var(--muted)">Sin opciones</span>';
      }

      div.innerHTML = '<span style="font-size:.75rem;color:var(--muted);min-width:20px">' + (i + 1) + '.</span>' +
        '<strong style="font-size:.85rem;min-width:90px">' + (WF_OPS[step.op]?.label || step.op) + '</strong>' +
        configHtml +
        '<button type="button" data-act="up" style="font-size:.75rem;padding:2px 6px;border:1px solid var(--c-border);border-radius:4px;background:var(--c-surface);color:var(--c-text);cursor:pointer">\u2191</button>' +
        '<button type="button" data-act="down" style="font-size:.75rem;padding:2px 6px;border:1px solid var(--c-border);border-radius:4px;background:var(--c-surface);color:var(--c-text);cursor:pointer">\u2193</button>' +
        '<button type="button" data-act="remove" style="font-size:.75rem;padding:2px 6px;border:1px solid var(--c-error);border-radius:4px;background:var(--c-surface);color:var(--c-error);cursor:pointer">\u2715</button>';

      div.querySelectorAll('[data-cf]').forEach(el => {
        el.addEventListener('change', () => { step.config[el.dataset.cf] = el.type === 'number' ? Number(el.value) : el.value; });
      });
      div.querySelector('[data-act="up"]')?.addEventListener('click', () => { if (i > 0) { const tmp = _wfSteps[i - 1]; _wfSteps[i - 1] = _wfSteps[i]; _wfSteps[i] = tmp; renderWfSteps(); } });
      div.querySelector('[data-act="down"]')?.addEventListener('click', () => { if (i < _wfSteps.length - 1) { const tmp = _wfSteps[i + 1]; _wfSteps[i + 1] = _wfSteps[i]; _wfSteps[i] = tmp; renderWfSteps(); } });
      div.querySelector('[data-act="remove"]')?.addEventListener('click', () => { _wfSteps.splice(i, 1); renderWfSteps(); });
      container.appendChild(div);
    });
  }

  async function processWorkflow() {
    if (!_wfSteps.length) throw new Error('Agrega al menos una operaci\u00f3n al flujo.');
    let results = [];

    for (const file of state.files) {
      let currentBlob = file;
      let currentImage = await loadImage(currentBlob);

      for (const step of _wfSteps) {
        const c = step.config;
        if (step.op === 'compress') {
          const quality = clamp(c.quality / 100, 0.1, 1);
          let w = currentImage.naturalWidth, h = currentImage.naturalHeight;
          if (c.maxWidth > 0 && w > c.maxWidth) { h = Math.round(h * c.maxWidth / w); w = c.maxWidth; }
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(currentImage, 0, 0, w, h);
          currentBlob = await canvasToBlob(cv, 'image/webp', quality);
          currentImage = await loadImage(currentBlob);
        } else if (step.op === 'resize') {
          let w = c.width || currentImage.naturalWidth;
          let h = c.height || currentImage.naturalHeight;
          if (c.height > 0 && c.width > 0) { /* use both */ }
          else if (c.width > 0) { h = Math.round(currentImage.naturalHeight * w / currentImage.naturalWidth); }
          else { w = Math.round(currentImage.naturalWidth * h / currentImage.naturalHeight); }
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(currentImage, 0, 0, w, h);
          currentBlob = await canvasToBlob(cv, 'image/webp', 0.92);
          currentImage = await loadImage(currentBlob);
        } else if (step.op === 'convert') {
          const mime = c.format || 'image/webp';
          const cv = document.createElement('canvas'); cv.width = currentImage.naturalWidth; cv.height = currentImage.naturalHeight;
          const cx = cv.getContext('2d', { alpha: mime !== 'image/jpeg' });
          if (mime === 'image/jpeg') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); }
          cx.drawImage(currentImage, 0, 0);
          currentBlob = await canvasToBlob(cv, mime, 0.92);
          currentImage = await loadImage(currentBlob);
        } else if (step.op === 'rotate') {
          const deg = Number(c.degrees) || 90;
          const rad = deg * Math.PI / 180;
          const ow = currentImage.naturalWidth, oh = currentImage.naturalHeight;
          const swap = deg === 90 || deg === 270;
          const cw = swap ? oh : ow, ch = swap ? ow : oh;
          const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          const cx = cv.getContext('2d');
          cx.translate(cw / 2, ch / 2);
          cx.rotate(rad);
          cx.drawImage(currentImage, -ow / 2, -oh / 2);
          currentBlob = await canvasToBlob(cv, 'image/webp', 0.92);
          currentImage = await loadImage(currentBlob);
        } else if (step.op === 'flip') {
          const dir = c.direction || 'h';
          const ow = currentImage.naturalWidth, oh = currentImage.naturalHeight;
          const cv = document.createElement('canvas'); cv.width = ow; cv.height = oh;
          const cx = cv.getContext('2d');
          if (dir === 'h' || dir === 'hv') { cx.translate(ow, 0); cx.scale(-1, 1); }
          if (dir === 'v' || dir === 'hv') { cx.translate(0, oh); cx.scale(1, -1); }
          cx.drawImage(currentImage, 0, 0);
          currentBlob = await canvasToBlob(cv, 'image/webp', 0.92);
          currentImage = await loadImage(currentBlob);
        } else if (step.op === 'stripMeta') {
          const cv = document.createElement('canvas'); cv.width = currentImage.naturalWidth; cv.height = currentImage.naturalHeight;
          cv.getContext('2d').drawImage(currentImage, 0, 0);
          currentBlob = await canvasToBlob(cv, 'image/webp', 0.92);
          currentImage = await loadImage(currentBlob);
        } else if (step.op === 'watermark') {
          const cv = document.createElement('canvas'); cv.width = currentImage.naturalWidth; cv.height = currentImage.naturalHeight;
          const cx = cv.getContext('2d');
          cx.drawImage(currentImage, 0, 0);
          const text = c.text || 'WATERMARK';
          const size = c.size || 36;
          const opacity = clamp((c.opacity || 30) / 100, 0.05, 1);
          const color = c.color || '#ffffff';
          const pos = c.position || 'center';
          cx.globalAlpha = opacity;
          cx.fillStyle = color;
          cx.font = 'bold ' + size + 'px sans-serif';
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          const tw = cx.measureText(text).width;
          let tx, ty;
          if (pos === 'topLeft') { tx = tw / 2 + 20; ty = size / 2 + 20; }
          else if (pos === 'topRight') { tx = cv.width - tw / 2 - 20; ty = size / 2 + 20; }
          else if (pos === 'bottomLeft') { tx = tw / 2 + 20; ty = cv.height - size / 2 - 20; }
          else if (pos === 'bottomRight') { tx = cv.width - tw / 2 - 20; ty = cv.height - size / 2 - 20; }
          else { tx = cv.width / 2; ty = cv.height / 2; }
          cx.fillText(text, tx, ty);
          cx.globalAlpha = 1;
          currentBlob = await canvasToBlob(cv, 'image/webp', 0.92);
          currentImage = await loadImage(currentBlob);
        }
      }
      results.push({ blob: currentBlob, name: baseName(file.name) + '-procesado.webp', original: file });
    }

    if (results.length === 1) {
      return {
        blob: results[0].blob, name: results[0].name, title: 'Flujo completado',
        message: _wfSteps.length === 1 ? '1 operación aplicada.' : _wfSteps.length + ' operaciones aplicadas.',
        preview: results[0].blob,
        stats: [['Pasos', String(_wfSteps.length)], ['Tama\u00f1o', formatBytes(results[0].blob.size)]],
      };
    }

    if (window.JSZip) {
      const zip = new window.JSZip();
      results.forEach(r => zip.file(r.name, r.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      return {
        blob, name: 'toolisto-flujo.zip', title: 'Flujo completado',
        message: _wfSteps.length + ' operaciones aplicadas a ' + results.length + ' archivos.',
        stats: [['Archivos', String(results.length)], ['Pasos', String(_wfSteps.length)], ['ZIP', formatBytes(blob.size)]],
      };
    }

    for (const r of results) {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a'); a.href = url; a.download = r.name;
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise(res => setTimeout(res, 200));
      URL.revokeObjectURL(url);
    }
    return {
      blob: results[0].blob, name: results[0].name, title: 'Flujo completado',
      message: results.length + ' archivos procesados.',
      stats: [['Archivos', String(results.length)], ['Pasos', String(_wfSteps.length)]],
    };
  }

  /* ── advancedConvert ── */
  function initAdvancedConvert() {
    const resizeSel = $('#advResizeMode');
    const watermarkToggle = $('#advWatermarkToggle');
    const watermarkOpts = $('#advWatermarkOpts');
    if (resizeSel) resizeSel.addEventListener('change', updateAdvResizeLabel);
    if (watermarkToggle) watermarkToggle.addEventListener('change', () => { if (watermarkOpts) watermarkOpts.style.display = watermarkToggle.checked ? '' : 'none'; });
    updateAdvResizeLabel();
  }

  function updateAdvResizeLabel() {
    const mode = valueOf('advResizeMode', 'none');
    const label = $('#advResizeLabel');
    const valCtrl = $('#advResizeValueControl');
    if (valCtrl) valCtrl.style.display = mode === 'none' ? 'none' : '';
    if (label) {
      if (mode === 'width') label.textContent = 'Ancho en p\u00edxeles';
      else if (mode === 'percent') label.textContent = 'Porcentaje del original';
      else if (mode === 'fit') label.textContent = 'Tama\u00f1o m\u00e1ximo (px)';
      else label.textContent = 'Valor';
    }
  }

  async function processAdvancedConvert() {
    if (!window.JSZip && state.files.length > 1) throw new Error('No se pudo cargar el componente para crear ZIP.');
    const mime = valueOf('advConvertFormat', 'image/webp');
    const quality = clamp(numberValue('advConvertQuality', 86) / 100, 0.25, 1);
    const resizeMode = valueOf('advResizeMode', 'none');
    const resizeValue = clamp(numberValue('advResizeValue', 1080), 1, 10000);
    const rotateDeg = Number(valueOf('advRotate', '0')) || 0;
    const flipMode = valueOf('advFlip', 'none');
    const useWatermark = $('#advWatermarkToggle')?.checked || false;
    const wmText = valueOf('advWatermarkText', 'WATERMARK');
    const wmSize = clamp(numberValue('advWatermarkSize', 36), 8, 200);
    const wmOpacity = clamp(numberValue('advWatermarkOpacity', 30), 5, 100) / 100;
    const wmPos = valueOf('advWatermarkPos', 'center');
    const wmColor = valueOf('advWatermarkColor', '#ffffff');

    const results = [];
    for (const file of state.files) {
      let image = await loadImage(file);
      let w = image.naturalWidth, h = image.naturalHeight;

      if (resizeMode === 'width' && resizeValue > 0) { h = Math.round(h * resizeValue / w); w = resizeValue; }
      else if (resizeMode === 'percent' && resizeValue > 0) { w = Math.round(w * resizeValue / 100); h = Math.round(h * resizeValue / 100); }
      else if (resizeMode === 'fit' && resizeValue > 0) {
        if (w > resizeValue || h > resizeValue) {
          const scale = Math.min(resizeValue / w, resizeValue / h);
          w = Math.round(w * scale); h = Math.round(h * scale);
        }
      }

      const rad = rotateDeg * Math.PI / 180;
      const swap = rotateDeg === 90 || rotateDeg === 270;
      const cw = swap ? h : w, ch = swap ? w : h;

      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d', { alpha: mime !== 'image/jpeg' });
      if (mime === 'image/jpeg') { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cw, ch); }
      cx.translate(cw / 2, ch / 2);
      if (rotateDeg) cx.rotate(rad);
      if (flipMode === 'h' || flipMode === 'hv') cx.scale(-1, 1);
      if (flipMode === 'v' || flipMode === 'hv') cx.scale(1, -1);
      cx.drawImage(image, -w / 2, -h / 2, w, h);

      if (useWatermark && wmText.trim()) {
        cx.globalAlpha = wmOpacity;
        cx.fillStyle = wmColor;
        cx.font = 'bold ' + wmSize + 'px sans-serif';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        const tw = cx.measureText(wmText).width;
        let tx, ty;
        if (wmPos === 'topLeft') { tx = tw / 2 + 20; ty = wmSize / 2 + 20; }
        else if (wmPos === 'topRight') { tx = cw - tw / 2 - 20; ty = wmSize / 2 + 20; }
        else if (wmPos === 'bottomLeft') { tx = tw / 2 + 20; ty = ch - wmSize / 2 - 20; }
        else if (wmPos === 'bottomRight') { tx = cw - tw / 2 - 20; ty = ch - wmSize / 2 - 20; }
        else { tx = cw / 2; ty = ch / 2; }
        cx.fillText(wmText, tx, ty);
        cx.globalAlpha = 1;
      }

      const blob = await canvasToBlob(cv, mime, mime === 'image/png' ? 1 : quality);
      results.push({ blob, name: baseName(file.name) + '.' + extensionForMime(mime), original: file });
    }

    if (results.length === 1) {
      const single = results[0];
      return {
        blob: single.blob, name: single.name, title: 'Imagen convertida',
        message: 'Archivo procesado con ' + (resizeMode !== 'none' ? 'redimensionamiento' + (rotateDeg ? ', rotaci\u00f3n' : '') : rotateDeg ? 'rotaci\u00f3n' : 'formato') + '.',
        preview: single.blob,
        stats: [['Formato', extensionForMime(mime).toUpperCase()], ['Tama\u00f1o', formatBytes(single.blob.size)], ['Archivos', '1']],
      };
    }

    const zip = new window.JSZip();
    results.forEach(r => zip.file(r.name, r.blob));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob, name: 'toolisto-convertidas.zip', title: 'Lote convertido',
      message: results.length + ' archivos procesados.',
      stats: [['Archivos', String(results.length)], ['Formato', extensionForMime(mime).toUpperCase()], ['ZIP', formatBytes(blob.size)]],
    };
  }

  function presentResult(result) {
    state.outputBlob = result.blob;
    state.outputName = result.name;
    if (els.downloadButton) els.downloadButton.style.display = '';
    els.resultTitle.textContent = result.title;
    els.resultMessage.textContent = result.message;
    els.resultStats.innerHTML = (result.stats || []).map(([label,value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    els.previewArea.innerHTML = '';
    if (result.preview && state.files.length && state.files[0] && state.files[0].type && state.files[0].type.startsWith('image/') && window.ToolistoBAV) {
      var bavWrap = document.createElement('div');
      bavWrap.className = 'result-bav-wrap';
      els.previewArea.appendChild(bavWrap);
      els.previewArea.hidden = false;
      window.ToolistoBAV.create(bavWrap, {
        before: state.files[0],
        after: result.preview,
        labelBefore: 'Original',
        labelAfter: 'Resultado'
      });
    } else if (result.preview) {
      var mime = result.preview.type || '';
      var name = (result.name || '').toLowerCase();
      state.previewUrl = URL.createObjectURL(result.preview);
      if (mime === 'application/pdf' || name.endsWith('.pdf')) {
        if (window.ToolistoPDFViewer) {
          var viewerWrap = document.createElement('div');
          viewerWrap.style.cssText = 'height:380px';
          els.previewArea.appendChild(viewerWrap);
          window.ToolistoPDFViewer.create(viewerWrap, { blob: result.preview });
        } else {
          var embed = document.createElement('iframe');
          embed.src = state.previewUrl;
          embed.style.cssText = 'width:100%;height:360px;border:none;border-radius:6px';
          embed.title = 'Vista previa del PDF';
          els.previewArea.appendChild(embed);
        }
        els.previewArea.hidden = false;
      } else if (mime === 'text/plain' || name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.json') || name.endsWith('.xml') || name.endsWith('.html') || name.endsWith('.md')) {
        result.preview.text().then(function(txt) {
          var pre = document.createElement('pre');
          pre.style.cssText = 'max-height:320px;overflow:auto;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:.85rem;line-height:1.5;font-family:monospace;white-space:pre-wrap;word-break:break-word';
          pre.textContent = txt.length > 8000 ? txt.slice(0, 8000) + '\n\n[Truncado — ' + formatBytes(result.preview.size) + ']' : txt;
          els.previewArea.appendChild(pre);
          els.previewArea.hidden = false;
        });
        els.previewArea.hidden = false;
      } else if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || name.endsWith('.zip')) {
        var listWrap = document.createElement('div');
        listWrap.style.cssText = 'padding:12px;background:var(--card);border:1px solid var(--border);border-radius:6px';
        listWrap.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><strong>Archivo ZIP</strong><span style="color:var(--muted);font-size:.85rem">' + escapeHtml(result.name || 'resultado.zip') + '</span></div>';
        if (state.outputFiles && state.outputFiles.length > 1) {
          var ul = document.createElement('ul');
          ul.style.cssText = 'list-style:none;padding:0;margin:0;max-height:200px;overflow-y:auto';
          state.outputFiles.forEach(function(f) {
            var li = document.createElement('li');
            li.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--border);font-size:.85rem;display:flex;justify-content:space-between;align-items:center';
            li.innerHTML = '<span>' + escapeHtml(f.name) + '</span><span style="color:var(--muted)">' + formatBytes(f.size) + '</span>';
            ul.appendChild(li);
          });
          listWrap.appendChild(ul);
        }
        els.previewArea.appendChild(listWrap);
        els.previewArea.hidden = false;
      } else {
        var img = document.createElement('img');
        img.src = state.previewUrl;
        img.alt = 'Vista previa del resultado';
        els.previewArea.appendChild(img);
        els.previewArea.hidden = false;
      }
    } else {
      els.previewArea.hidden = true;
    }
    populateInspector(result);
    trackEvent('result_shown', { tool: state.tool || '', files: (state.outputFiles || []).length });
    els.resultDialog.showModal();
  }

  function populateInspector(result) {
    if (!els.resultInspector) return;
    var inputSize = state.inputTotalSize || 0;
    var outputSize = 0;
    if (result.blob) outputSize = result.blob.size;
    else if (state.outputFiles && state.outputFiles.length > 0) {
      outputSize = state.outputFiles.reduce(function(s, f) { return s + (f.blob ? f.blob.size : 0); }, 0);
    }
    var elapsed = state.processStartTime ? Date.now() - state.processStartTime : 0;
    els.inspectorInput.textContent = inputSize > 0 ? formatBytes(inputSize) : '—';
    els.inspectorOutput.textContent = outputSize > 0 ? formatBytes(outputSize) : '—';
    if (inputSize > 0 && outputSize > 0) {
      var ratio = ((1 - outputSize / inputSize) * 100).toFixed(1);
      els.inspectorRatio.textContent = (outputSize <= inputSize ? '-' + ratio + '%' : '+' + ((outputSize / inputSize - 1) * 100).toFixed(1) + '%');
    } else {
      els.inspectorRatio.textContent = '—';
    }
    els.inspectorTime.textContent = elapsed > 0 ? (elapsed < 1000 ? elapsed + ' ms' : (elapsed / 1000).toFixed(1) + ' s') : '—';
    // Enhanced metrics per tool type
    if (result.stats && result.stats.length > 0) {
      var extraMetrics = document.getElementById('inspectorExtra');
      if (!extraMetrics) {
        extraMetrics = document.createElement('div');
        extraMetrics.id = 'inspectorExtra';
        extraMetrics.className = 'inspector-extra';
        els.resultInspector.appendChild(extraMetrics);
      }
      var toolType = state.tool || '';
      var filteredStats = result.stats.filter(function(s) {
        var label = (s[0] || '').toLowerCase();
        if (label === 'tamaño' || label === 'size') return false;
        return true;
      }).slice(0, 4);
      if (filteredStats.length > 0) {
        extraMetrics.innerHTML = filteredStats.map(function(s) {
          return '<div class="inspector-row"><span class="inspector-label">' + escapeHtml(s[0]) + '</span><span>' + escapeHtml(String(s[1])) + '</span></div>';
        }).join('');
        extraMetrics.hidden = false;
      } else {
        extraMetrics.hidden = true;
      }
    }
    els.resultInspector.hidden = false;
  }

  function presentSummaryResult(result) {
    state.outputFiles = [];
    state.outputBlob = null;
    if (els.downloadButton) els.downloadButton.style.display = 'none';
    els.resultTitle.textContent = result.title;
    els.resultMessage.textContent = result.message;
    els.resultStats.innerHTML = (result.stats || []).map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    els.previewArea.innerHTML = sanitizeSummaryHtml(result.html || '');
    els.previewArea.hidden = false;
    trackEvent('result_shown', { tool: state.tool || '', files: 0 });
    els.resultDialog.showModal();
  }

  function presentMetadataResult(result) {
    state.metadataResult = result;
    els.resultTitle.textContent = result.title;
    els.resultMessage.textContent = result.message;
    els.resultStats.innerHTML = '';
    els.previewArea.innerHTML = '';
    els.previewArea.hidden = false;

    const r = result.metadata;
    const sections = [];

    sections.push(`<div class="metadata-section"><h3 style="margin:0 0 .5rem;color:var(--accent)">A. Información general</h3>`);
    sections.push(`<table class="metadata-table"><tbody>`);
    r.general.forEach(([k, v]) => {
      sections.push(`<tr><td class="meta-label">${escapeHtml(k)}</td><td>${escapeHtml(String(v ?? 'No encontrado'))}</td></tr>`);
    });
    sections.push(`</tbody></table></div>`);

    if (r.metadataEntries.length) {
      sections.push(`<div class="metadata-section"><h3 style="margin:1rem 0 .5rem;color:var(--accent)">B. Metadatos encontrados</h3>`);
      sections.push(`<table class="metadata-table"><thead><tr><th>Campo</th><th>Valor</th><th>Categoría</th></tr></thead><tbody>`);
      r.metadataEntries.forEach(([field, value, category]) => {
        sections.push(`<tr><td class="meta-label">${escapeHtml(field)}</td><td>${escapeHtml(String(value ?? 'No encontrado'))}</td><td><span class="meta-badge">${escapeHtml(category)}</span></td></tr>`);
      });
      sections.push(`</tbody></table></div>`);
    }

    if (r.sensitive.length) {
      sections.push(`<div class="metadata-section metadata-warn"><h3 style="margin:1rem 0 .5rem;color:#e74c3c">C. Información sensible</h3>`);
      r.sensitive.forEach(([field, value, risk]) => {
        const color = risk === 'alto' ? '#e74c3c' : risk === 'medio' ? '#f39c12' : '#3498db';
        sections.push(`<div class="sensitive-item" style="border-left:3px solid ${color};padding:.4rem .8rem;margin:.3rem 0;background:var(--card);border-radius:4px"><strong>${escapeHtml(field)}</strong>: ${escapeHtml(String(value))} <span class="meta-badge" style="background:${color};color:#fff">${escapeHtml(risk)}</span></div>`);
      });
      sections.push(`</div>`);
    } else {
      sections.push(`<div class="metadata-section"><h3 style="margin:1rem 0 .5rem;color:var(--accent)">C. Información sensible</h3><p style="color:var(--muted)">No se detectaron metadatos sensibles conocidos.</p></div>`);
    }

    if (r.technical.length) {
      sections.push(`<div class="metadata-section"><h3 style="margin:1rem 0 .5rem;color:var(--accent)">D. Vista técnica</h3>`);
      sections.push(`<div class="metadata-table-wrap"><table class="metadata-table"><thead><tr><th>Campo</th><th>Valor</th><th>Categoría</th><th>Riesgo</th></tr></thead><tbody>`);
      r.technical.forEach(([field, value, category, risk]) => {
        const rColor = risk === 'alto' ? '#e74c3c' : risk === 'medio' ? '#f39c12' : '#27ae60';
        sections.push(`<tr><td class="meta-label">${escapeHtml(field)}</td><td>${escapeHtml(String(value ?? ''))}</td><td><span class="meta-badge">${escapeHtml(category)}</span></td><td><span class="meta-badge" style="background:${rColor};color:#fff">${escapeHtml(risk)}</span></td></tr>`);
      });
      sections.push(`</tbody></table></div></div>`);
    }

    sections.push(`<div class="metadata-actions" style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:.5rem">`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaCopy()">Copiar resultados</button>`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaDownloadJSON()">Descargar JSON</button>`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaDownloadTXT()">Descargar TXT</button>`);
    if (r.canClean) sections.push(`<button type="button" class="btn-secondary" onclick="window._metaClean()" style="border-color:#e74c3c;color:#e74c3c">Limpiar metadatos</button>`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaReset()">Analizar otro archivo</button>`);
    sections.push(`</div>`);

    els.previewArea.innerHTML = `<div class="metadata-result" style="width:100%;max-height:60vh;overflow-y:auto;padding:.5rem">${sections.join('')}</div>`;
    els.resultDialog.showModal();
  }

  window._metaCopy = function() {
    const r = state.metadataResult;
    if (!r) return;
    const lines = [r.title, r.message, ''];
    r.metadata.general.forEach(([k, v]) => lines.push(`${k}: ${v ?? 'No encontrado'}`));
    lines.push('', '--- Metadatos ---');
    r.metadata.metadataEntries.forEach(([f, v, c]) => lines.push(`[${c}] ${f}: ${v ?? ''}`));
    if (r.metadata.sensitive.length) { lines.push('', '--- Sensible ---'); r.metadata.sensitive.forEach(([f, v, risk]) => lines.push(`[${risk.toUpperCase()}] ${f}: ${v}`)); }
    navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('Copiado al portapapeles'));
  };

  window._metaDownloadJSON = function() {
    const r = state.metadataResult;
    if (!r) return;
    const obj = { title: r.title, general: Object.fromEntries(r.metadata.general), metadata: Object.fromEntries(r.metadata.metadataEntries.map(([f,v,c]) => [f, { value: v, category: c }])), sensitive: r.metadata.sensitive.map(([f,v,r]) => ({ field: f, value: v, risk: r })), technical: Object.fromEntries(r.metadata.technical.map(([f,v,c,r]) => [f, { value: v, category: c, risk: r }])) };
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${r.metadata.fileName || 'metadatos'}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  window._metaDownloadTXT = function() {
    const r = state.metadataResult;
    if (!r) return;
    const lines = [r.title, '='.repeat(r.title.length), '', r.message, '', 'INFORMACIÓN GENERAL', '-'.repeat(20)];
    r.metadata.general.forEach(([k, v]) => lines.push(`  ${k}: ${v ?? 'No encontrado'}`));
    lines.push('', 'METADATOS ENCONTRADOS', '-'.repeat(20));
    r.metadata.metadataEntries.forEach(([f, v, c]) => lines.push(`  [${c}] ${f}: ${v ?? ''}`));
    if (r.metadata.sensitive.length) { lines.push('', 'INFORMACIÓN SENSIBLE', '-'.repeat(20)); r.metadata.sensitive.forEach(([f, v, risk]) => lines.push(`  [${risk.toUpperCase()}] ${f}: ${v}`)); }
    lines.push('', 'VISTA TÉCNICA', '-'.repeat(20));
    r.metadata.technical.forEach(([f, v, c, risk]) => lines.push(`  [${c}] ${f}: ${v ?? ''} (${risk})`));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${r.metadata.fileName || 'metadatos'}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  window._metaClean = async function() {
    const r = state.metadataResult;
    if (!r || !state.files.length) return;
    const file = state.files[0];
    try {
      if (file.type === 'image/jpeg') {
        var buf = new Uint8Array(await file.arrayBuffer());
        var view = new DataView(buf.buffer);
        if (buf[0] === 0xFF && buf[1] === 0xD8) {
          var out = [0xFF, 0xD8];
          var i = 2;
          while (i < buf.length - 1) {
            if (buf[i] !== 0xFF) break;
            var marker = buf[i + 1];
            if (marker === 0xDA) { out.push.apply(out, buf.slice(i)); break; }
            if (marker === 0xE1 || marker === 0xED || marker === 0xFE) { i += 2 + (buf[i+2] << 8 | buf[i+3]); continue; }
            out.push(buf[i], buf[i + 1]);
            i += 2;
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
              var len = buf[i] << 8 | buf[i + 1];
              out.push.apply(out, buf.slice(i, i + len));
              i += len;
            } else if (marker === 0xC4 || marker === 0xC8 || marker === 0xCC) {
              i += (buf[i] << 8 | buf[i + 1]);
            } else if (marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD8)) {
            } else {
              i += (buf[i] << 8 | buf[i + 1]);
            }
          }
          var cleaned = new Uint8Array(out);
          var blob = new Blob([cleaned], { type: 'image/jpeg' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a'); a.href = url; a.download = file.name.replace(/\.[^.]+$/, '') + '-sin-metadatos.jpg'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          showToast('Metadatos eliminados. Descargando copia limpia.');
        } else { showToast('No se pueden limpiar metadatos de este formato.'); }
      } else { showToast('Limpieza disponible solo para JPEG por ahora.'); }
    } catch (e) { showToast('Error al limpiar: ' + e.message); }
  };

  window._metaReset = function() {
    els.resultDialog.close();
    clearPreviousOutput();
    state.files = [];
    state.metadataResult = null;
    els.fileInput.value = '';
    els.intentInput.value = '';
    els.advancedPanel.open = false;
    var stripEl = document.getElementById('fileStrip');
    if (stripEl) stripEl.hidden = true;
    var dropZone = document.getElementById('dropZone');
    if (dropZone) dropZone.hidden = false;
    var flowActions = document.getElementById('flowActions');
    if (flowActions) flowActions.hidden = true;
    showToast('Listo para analizar otro archivo.');
  };

  function copyTechnicalDetails() {
    var toolId = state.tool || 'unknown';
    var slug = window.location.pathname.replace(/.*\//, '').replace(/\.html$/, '') || 'index';
    var phase = state.processPhase || 'unknown';
    var browser = (navigator.userAgent || '').substring(0, 80);
    var datetime = new Date().toISOString();
    var error = state.processError ? String(state.processError.message || state.processError).substring(0, 120) : '';
    var lines = [
      'Herramienta: ' + toolId,
      'Slug: ' + slug,
      'Fase: ' + phase,
      'Error: ' + (error || 'ninguno'),
      'Navegador: ' + browser,
      'Fecha: ' + datetime
    ];
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('Detalles copiados al portapapeles');
      }, function() {
        showToast('No se pudo copiar');
      });
    } else {
      showToast('Copiar no disponible');
    }
    trackEvent('copy_tech_details', { tool: toolId });
  }

  function friendlyErrorMessage(error, tool) {
    var msg = error?.message || String(error) || '';
    if (msg.includes('password') || msg.includes('contraseña') || msg.includes('encrypted') || msg.includes('Encrypted')) return 'El archivo está protegido con contraseña. No se puede procesar sin desbloquearlo.';
    if (msg.includes('out of memory') || msg.includes('OOM') || msg.includes('allocation')) return 'El archivo es demasiado grande para procesarlo en el navegador. Intenta con uno más pequeño.';
    if (msg.includes('not a valid') || msg.includes('corrupt') || msg.includes('Invalid')) return 'El archivo parece estar dañado o no tiene el formato esperado. Verifica que no esté corrupto.';
    if (msg.includes('decode') || msg.includes('Decode')) return 'No se pudo leer el contenido del archivo. Puede que el formato no sea compatible.';
    if (msg.includes('timeout') || msg.includes('Timeout')) return 'El procesamiento tardó demasiado. Intenta con un archivo más pequeño.';
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) return 'Error de conexión. Algunos componentes necesarios no pudieron cargarse.';
    if (msg.includes('Worker') || msg.includes('worker')) return 'El motor de procesamiento no pudo iniciarse. Recarga la página e intenta de nuevo.';
    if (msg.includes('Cannot read') || msg.includes('is null') || msg.includes('undefined')) return 'No se pudo acceder al archivo. Intenta seleccionarlo de nuevo.';
    if (tool === 'compressPdf' || tool === 'scannedPdfToSearchablePdf') return 'No se pudo procesar el PDF. Verifica que no esté protegido y que sea un PDF válido.';
    if (tool === 'convertAudio' || tool === 'trimAudio') return 'No se pudo procesar el audio. Verifica que el formato sea compatible (MP3, WAV, OGG, AAC, FLAC).';
    if (tool === 'compressVideo' || tool === 'trimVideo') return 'No se pudo procesar el video. Verifica que el formato sea compatible (MP4, WebM, MOV, AVI).';
    if (msg) return 'Ocurrió un problema: ' + msg.substring(0, 150);
    return 'No pudimos procesar el archivo. Verifica el formato e inténtalo de nuevo.';
  }

  function showProcessFeedback(message) {
    if (!els.processFeedback || !els.processFeedbackMessage) return;
    els.processFeedbackMessage.textContent = message;
    els.processFeedback.hidden = false;
  }

  function clearProcessFeedback() {
    if (!els.processFeedback) return;
    els.processFeedback.hidden = true;
    if (els.processFeedbackMessage) els.processFeedbackMessage.textContent = '';
  }

  async function downloadResult() {
    if (state.outputFiles && state.outputFiles.length > 1) {
      if (!window.JSZip) {
        state.outputFiles.forEach(f => downloadBlob(f.blob, f.name));
        return;
      }
      const zip = new window.JSZip();
      state.outputFiles.forEach(f => zip.file(f.name, f.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      downloadBlob(blob, 'resultados.zip');
      return;
    }
    if (state.outputFiles && state.outputFiles.length === 1) {
      downloadBlob(state.outputFiles[0].blob, state.outputFiles[0].name);
      return;
    }
    if (state.outputBlob) {
      downloadBlob(state.outputBlob, state.outputName || 'toolisto-resultado');
    }
  }

  function downloadBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS || isSafari) {
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { link.remove(); }, 100);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (isIOS) {
        setTimeout(() => showToast('Si no ves la descarga, revisa el botón de compartir.'), 1200);
      }
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function resetAll() {
    els.resultDialog.close();
    clearPreviousOutput();
    state.files = [];
    state.tool = null;
    state.forcedTool = null;
    state.outputFiles = [];
    state.metadataResult = null;
    els.fileInput.value = '';
    els.intentInput.value = '';
    els.advancedPanel.open = false;
    renderFiles();
    updateRecommendation();
    document.querySelector('#inicio').scrollIntoView({ behavior:'smooth' });
  }

  function clearPreviousOutput() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = '';
    state.outputBlob = null;
    state.outputName = '';
    state.outputFiles = [];
  }

  async function normalizeImageForPdf(file) {
    if (file.type === 'image/jpeg' || file.type === 'image/png') return { blob:file, mime:file.type };
    const image = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);
    return { blob:await canvasToBlob(canvas,'image/png',1), mime:'image/png' };
  }

  function ensurePdfLib() {
    if (!window.PDFLib) throw new Error('No se pudo cargar el componente PDF. Revisa tu conexión e inténtalo de nuevo.');
  }

  function loadImage(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('El navegador no pudo generar el archivo.')), mime, quality));
  }

  function parseTargetKb(text) {
    const q = String(text || '').toLowerCase().replace(/,/g,'.');
    const kb = q.match(/(\d+(?:\.\d+)?)\s*kb/);
    if (kb) return Math.round(Number(kb[1]));
    const mb = q.match(/(\d+(?:\.\d+)?)\s*mb/);
    if (mb) return Math.round(Number(mb[1]) * 1024);
    return 0;
  }

  function valueOf(id, fallback) {
    return document.getElementById(id)?.value ?? fallback;
  }

  function numberValue(id, fallback) {
    const value = Number(valueOf(id, fallback));
    return Number.isFinite(value) ? value : fallback;
  }

  function extensionForMime(mime) {
    return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9áéíóúüñ _-]/gi,'').trim() || 'toolisto';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const units = ['B','KB','MB','GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** i);
    return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  function shorten(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#','');
    const value = parseInt(clean,16);
    return { r:(value >> 16) & 255, g:(value >> 8) & 255, b:value & 255 };
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  // Las vistas de resumen pueden contener una miniatura generada localmente,
  // pero nunca deben convertirse en una vía para interpretar HTML de un archivo.
  function sanitizeSummaryHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html);
    const allowedTags = new Set(['DIV', 'SPAN', 'STRONG', 'B', 'P', 'BR', 'IMG']);
    const allowedAttributes = new Set(['class', 'alt', 'title', 'role']);
    const allowedStyleProperties = new Set(['display', 'align-items', 'gap', 'margin', 'width', 'height', 'border-radius', 'background', 'border', 'flex-shrink', 'font-size', 'color', 'max-width']);

    [...template.content.querySelectorAll('*')].forEach((node) => {
      if (!allowedTags.has(node.tagName)) {
        if (['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(node.tagName)) node.remove();
        else node.replaceWith(...node.childNodes);
        return;
      }
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (node.tagName === 'IMG' && name === 'src' && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(attribute.value)) return;
        if (name === 'style') {
          const safeDeclarations = attribute.value.split(';').map((declaration) => declaration.trim()).filter((declaration) => {
            const separator = declaration.indexOf(':');
            if (separator < 1) return false;
            const property = declaration.slice(0, separator).trim().toLowerCase();
            const value = declaration.slice(separator + 1).trim();
            return allowedStyleProperties.has(property) && value && !/url\s*\(|expression\s*\(|@import/i.test(value);
          });
          if (safeDeclarations.length) node.setAttribute('style', safeDeclarations.join(';'));
          else node.removeAttribute('style');
          return;
        }
        if (!allowedAttributes.has(name)) node.removeAttribute(attribute.name);
      });
    });
    return template.innerHTML;
  }

  // Superficie mínima para el gate de seguridad; no procesa ni persiste datos.
  window.ToolistoSecurity = Object.freeze({ sanitizeSummaryHtml });

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  let pageConfig = null;

  function applyPagePreset() {
    if (!pageConfig || !pageConfig.preset) return;
    const cfg = pageConfig;
    const lockedFields = Object.keys(cfg.preset);
    Object.keys(cfg.preset).forEach((key) => {
      const input = document.getElementById(key);
      if (input) {
        input.value = cfg.preset[key];
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const select = document.querySelector(`select[id="${key}"], select[data-preset="${key}"]`);
      if (select) {
        select.value = cfg.preset[key];
        select.disabled = lockedFields.includes(key);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function activateToolFromPageConfig() {
    const el = document.getElementById('tool-page-config');
    if (!el) return;
    try {
      const cfg = JSON.parse(el.textContent);
      pageConfig = cfg;
      if (cfg.enabled === false) {
        state.toolDisabled = true;
        const notice = document.getElementById('toolDisabledNotice');
        if (notice) notice.hidden = false;
        if (els.runButton) els.runButton.disabled = true;
        if (els.dropZone) els.dropZone.classList.add('is-disabled');
        if (els.browseButton) els.browseButton.disabled = true;
        return;
      }
      if (cfg.toolId && toolMeta[cfg.toolId]) {
        chooseTool(cfg.toolId, true);
        if (cfg.inputAccept) {
          state.inputAccept = cfg.inputAccept;
          if (els.fileInput) els.fileInput.accept = cfg.inputAccept;
        }
        applyPagePreset();
      }
    } catch (_) { /* invalid JSON, ignore */ }
  }
  setTimeout(activateToolFromPageConfig, 50);
})();
