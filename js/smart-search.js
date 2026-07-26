;(function () {
  'use strict';

  var ACTIONS = {
    compress: ['comprimir', 'reducir', 'peso', 'ligero', 'ligera', 'menos pesada', 'menos pesado', 'optimizar', 'achicar', 'encoger', 'rebajar'],
    crop: ['recortar', 'redimensionar', 'cambiar tamaño', 'dimensiones', 'escalar', 'resize', 'ajustar tamaño', 'cortar'],
    convert: ['convertir', 'pasar a', 'transformar', 'cambiar formato', 'transformar a'],
    batchCompress: ['comprimir varias', 'comprimir varias imágenes', 'reducir varias', 'lote', 'múltiples imágenes'],
    stripMetadata: ['quitar metadatos', 'eliminar metadatos', 'limpiar metadatos', 'borrar metadatos', 'información oculta'],
    socialCrop: ['recortar para redes', 'redes sociales', 'tiktok', 'instagram', 'youtube', 'reel', 'historia', 'stories', 'perfil'],
    removeObjects: ['borrar objetos', 'quitar objetos', 'eliminar objetos', 'borrar texto', 'quitar texto', 'pincel', 'limpiar imagen'],
    signature: ['firma', 'fondo transparente', 'quitar fondo', 'extraer firma', 'limpiar firma', 'rubrica'],
    mergePdf: ['unir pdf', 'juntar pdf', 'combinar pdf', 'fusionar pdf', 'pegar pdf', 'mezclar pdf', 'unir documentos pdf', 'juntar documentos'],
    imagesPdf: ['imagenes a pdf', 'imágenes a pdf', 'fotos a pdf', 'crear pdf con fotos', 'poner imágenes en pdf', 'fotos a pdf', 'escanear a pdf', 'varias imágenes en pdf', 'muchas fotos juntas en pdf'],
    splitPdf: ['dividir pdf', 'separar pdf', 'extraer páginas', 'cortar pdf', 'partir pdf', 'sacar páginas', 'separar páginas'],
    reorderPdf: ['organizar pdf', 'reordenar pdf', 'ordenar páginas', 'cambiar orden', 'mover páginas'],
    pdfToImages: ['pdf a imágenes', 'pdf a imagenes', 'pdf a jpg', 'pdf a png', 'sacar imágenes del pdf', 'convertir pdf a imagen', 'capturar páginas'],
    signPdf: ['firmar pdf', 'firma en pdf', 'firma digital', 'e-sign', 'firmar documento', 'colocar firma'],
    rotatePdf: ['girar pdf', 'rotar pdf', 'voltear pdf', 'orientación', 'rotación', 'girar páginas'],
    deletePagesPdf: ['eliminar páginas pdf', 'quitar páginas', 'borrar páginas', 'suprimir páginas', 'remover páginas', 'quitar páginas de un pdf'],
    reversePagesPdf: ['invertir orden pdf', 'revertir pdf', 'al revés', 'orden inverso', 'dar la vuelta'],
    duplicatePagesPdf: ['duplicar páginas', 'copiar páginas', 'repetir páginas', 'clonar páginas'],
    insertBlankPagesPdf: ['insertar páginas en blanco', 'agregar páginas vacías', 'añadir hojas en blanco'],
    editMetadataPdf: ['editar metadatos pdf', 'modificar metadatos', 'cambiar autor', 'cambiar título pdf', 'propiedades pdf'],
    compressPdf: ['comprimir pdf', 'reducir peso pdf', 'optimizar pdf', 'pdf ligero', 'pdf más liviano'],
    interleavePdf: ['intercalar pdf', 'alternar páginas', 'mezclar pdf', 'juntar dos pdf'],
    cropPdf: ['recortar márgenes pdf', 'recortar pdf', 'quitar márgenes', 'sangría pdf'],
    resizePdfPages: ['redimensionar pdf', 'tamaño de página', 'cambiar a a4', 'a4', 'letter', 'legal', 'tamaño carta'],
    nUpPdf: ['varias páginas por hoja', 'dos en una', 'cuatro en una', '2up', '4up', 'ahorrar papel'],
    splitDoublePdf: ['dividir páginas dobles', 'páginas dobles', 'escaneado de a dos', 'dos por hoja'],
    bookletPdf: ['cuadernillo', 'booklet', 'folleto', 'impresión doble cara', 'plegar'],
    watermarkPdf: ['marca de agua', 'watermark', 'borrador', 'confidencial', 'sello', 'draft'],
    addPageNumbersPdf: ['numerar páginas', 'números de página', 'page numbers', 'paginación', 'numeración'],
    addHeaderFooterPdf: ['encabezado', 'pie de página', 'header', 'footer', 'cabecera pdf'],
    docPhoto: ['pasaporte', 'visa', 'dni', 'carnet', 'foto carnet', 'documento', 'licencia', 'id photo', 'foto para documento'],
    censor: ['censurar', 'ocultar', 'pixelar', 'desenfocar', 'sensible', 'borrar dato', 'información confidencial'],
    fixFormat: ['reparar formato', 'corregir extensión', 'formato incorrecto', 'extensión mal', 'formato corrupto'],
    rescueDoc: ['rescatar documento', 'documento fotografiado', 'mejorar documento', 'escaneo', 'mejorar foto de documento'],
    fileCompliance: ['cumplir requisitos', 'validar archivo', 'requisitos', 'valida', 'requisito'],
    workflow: ['flujo', 'cadena', 'varias operaciones', 'pipeline', 'workfl'],
    advancedConvert: ['conversor avanzado', 'convertir y redimensionar', 'batch convert', 'conversión avanzada'],
    wordToPdf: ['word a pdf', 'docx a pdf', 'documento word a pdf', 'pasar word a pdf', 'convertir word a pdf', 'word a pdf'],
    wordToJpg: ['word a jpg', 'word a imagen', 'docx a jpg', 'documento a imagen'],
    wordToPng: ['word a png', 'docx a png', 'documento a png'],
    wordToTxt: ['word a texto', 'word a txt', 'docx a txt', 'extraer texto de word', 'texto de word'],
    wordToHtml: ['word a html', 'docx a html', 'documento a html', 'word a web'],
    wordToMarkdown: ['word a markdown', 'word a md', 'docx a markdown'],
    wordToEpub: ['word a epub', 'docx a epub', 'documento a ebook', 'word a ebook'],
    wordToOdt: ['word a odt', 'docx a odt', 'word a libreoffice'],
    odtToWord: ['odt a word', 'odt a docx', 'libreoffice a word'],
    rtfToWord: ['rtf a word', 'rtf a docx'],
    mergeWord: ['unir documentos word', 'combinar word', 'juntar word', 'unir docx'],
    splitWord: ['dividir word', 'dividir documento word', 'partir word', 'separar word'],
    repairWord: ['reparar word', 'reparar docx', 'word corrupto', 'word dañado', 'arreglar word'],
    compressWord: ['comprimir word', 'reducir peso word', 'word ligero', 'docx ligero', 'reducir tamaño word'],
    stripMetadataWord: ['eliminar metadatos word', 'quitar metadatos word', 'limpiar word', 'metadatos docx'],
    formatDocument: ['uniformar formato', 'normalizar word', 'formato uniforme', 'normalizar formato'],
    tocWord: ['tabla de contenido', 'crear índice', 'generar tabla de contenido', 'índice word'],
    extractWord: ['extraer contenido', 'extraer texto de word', 'extraer tablas', 'extraer imágenes de word'],
    findReplaceWord: ['buscar y reemplazar', 'reemplazar texto', 'buscar texto en word'],
    tablesWordToExcel: ['tablas word a excel', 'extraer tablas', 'tablas a excel'],
    removeBlankPagesWord: ['eliminar páginas en blanco', 'quitar páginas vacías', 'páginas en blanco word'],
    txtToPdf: ['txt a pdf', 'texto a pdf', 'texto plano a pdf', 'notas a pdf'],
    txtToEpub: ['txt a epub', 'texto a epub', 'texto a ebook'],
    mergeTxt: ['unir archivos txt', 'combinar txt', 'juntar txt', 'unir textos'],
    splitTxt: ['dividir txt', 'separar txt', 'partir texto', 'dividir archivo de texto'],
    sortLines: ['ordenar líneas', 'ordenar texto', 'ordenar líneas de texto'],
    removeDuplicates: ['eliminar duplicados', 'quitar duplicados', 'líneas duplicadas', 'filas repetidas', 'borrar repetidas'],
    listToTable: ['listas a tablas', 'convertir lista en tabla', 'tabla desde texto'],
    epubToTxt: ['epub a texto', 'epub a txt', 'libro a texto', 'extraer texto de epub'],
    epubToHtml: ['epub a html', 'epub a web', 'libro a html'],
    epubToMarkdown: ['epub a markdown', 'epub a md', 'libro a markdown'],
    mergeEpub: ['unir epub', 'combinar epub', 'juntar libros', 'unir libros electrónicos'],
    splitEpub: ['dividir epub', 'separar epub', 'partir por capítulos', 'separar capítulos'],
    editMetadataEpub: ['editar metadatos epub', 'modificar epub', 'cambiar título epub', 'metadatos ebook'],
    coverEpub: ['extraer portada epub', 'portada epub', 'sacar portada'],
    imagesEpub: ['extraer imágenes epub', 'imágenes de epub', 'sacar imágenes del libro'],
    validateEpub: ['validar epub', 'comprobar epub', 'verificar epub'],
    repairEpub: ['reparar epub', 'arreglar epub', 'epub dañado', 'epub corrupto'],
    csvToExcel: ['csv a excel', 'csv a xlsx', 'convertir csv a excel'],
    excelToCsv: ['excel a csv', 'xlsx a csv', 'exportar a csv'],
    excelToJson: ['excel a json', 'xlsx a json', 'hoja de cálculo a json'],
    jsonToExcel: ['json a excel', 'json a xlsx', 'json a hoja de cálculo'],
    csvToJson: ['csv a json', 'convertir csv a json'],
    jsonToCsv: ['json a csv', 'convertir json a csv'],
    xmlToJson: ['xml a json', 'convertir xml a json'],
    jsonToXml: ['json a xml', 'convertir json a xml'],
    mergeExcel: ['unir excel', 'combinar excel', 'juntar archivos excel', 'unir hojas de cálculo'],
    splitExcel: ['dividir excel', 'separar excel', 'dividir por hojas', 'partir excel'],
    compareExcel: ['comparar excel', 'diferencias excel', 'comparar hojas de cálculo'],
    xlsToXlsx: ['xls a xlsx', 'excel antiguo a moderno', 'convertir xls'],
    xlsxToOds: ['xlsx a ods', 'excel a libreoffice', 'excel a openoffice'],
    odsToXlsx: ['ods a xlsx', 'libreoffice a excel', 'openoffice a excel'],
    unzipFile: ['descomprimir', 'descomprimir zip', 'extraer zip', 'abrir zip', 'unzip', 'sacar archivos del zip'],
    createZipAdvanced: ['crear zip', 'comprimir en zip', 'empaquetar', 'hacer zip', 'comprimir archivos'],
    zipRepair: ['reparar zip', 'arreglar zip', 'zip dañado', 'zip corrupto', 'recuperar zip'],
    fileSplit: ['dividir archivo', 'partir archivo', 'cortar archivo', 'fragmentar', 'dividir en partes'],
    fileJoin: ['unir fragmentos', 'juntar partes', 'recomponer archivo', 'unir partes', 'reunir fragmentos'],
    checksumFile: ['hash', 'checksum', 'verificar integridad', 'calcular hash', 'sha256', 'sha-256', 'sha1', 'sha-1'],
    fileInspector: ['inspeccionar archivo', 'analizar archivo', 'detectar tipo', 'magic bytes', 'verificar extensión'],
    pdfEncryptAdvanced: ['proteger pdf', 'poner contraseña pdf', 'bloquear pdf', 'cifrar pdf', 'password pdf', 'permisos pdf'],
    qrGenerate: ['generar qr', 'crear código qr', 'qr', 'código qr', 'hacer qr', 'code qr'],
    qrWifi: ['qr wifi', 'wifi qr', 'código qr wifi', 'conexion wifi qr', 'conectar wifi qr'],
    qrVcard: ['qr contacto', 'qr vcard', 'tarjeta qr', 'contacto qr', 'código qr contacto'],
    barcodeGenerate: ['código de barras', 'generar código de barras', 'barcode', 'crear barcode', 'code128', 'ean13'],
    qrReadFromImage: ['leer qr', 'escanear qr', 'decodificar qr', 'qr desde imagen', 'extraer qr'],
    barcodeReadFromImage: ['leer código de barras', 'escanear barcode', 'decodificar código de barras', 'leer barcode'],
    qrBatchFromCsv: ['qr masivo', 'múltiples qr', 'qr desde csv', 'lote de qr', 'varios qr'],
    colorPicker: ['extraer colores', 'paleta de colores', 'colores dominantes', 'color picker', 'capturar color'],
    imageCompare: ['comparar imágenes', 'diferencias imágenes', 'ver diferencias', '对比图像', '对比图片', 'diff imágenes'],
    pdfPageCounter: ['contar páginas pdf', 'número de páginas', 'cuántas páginas', 'páginas pdf', 'info pdf'],
    enhanceScannedDocument: ['mejorar escaneo', 'documento escaneado', 'mejorar documento', 'calidad documento', 'nitidez documento', 'contraste documento', 'scan documento'],
    cameraDocumentScanner: ['escanear cámara', 'capturar documento', 'foto documento', 'escanear con cámara'],
    pdfTablesToExcel: ['tablas pdf', 'pdf a excel', 'extraer tablas pdf', 'tablas excel'],
    imageTableToExcel: ['tabla imagen', 'ocr tabla', 'imagen a excel', 'ocr excel', 'tabla imagen excel'],
    convertAudio: ['convertir audio', 'audio a mp3', 'audio a wav', 'audio a ogg', 'cambiar formato audio'],
    trimAudio: ['recortar audio', 'cortar audio', 'segmento audio', 'trozo audio'],
    mergeAudio: ['unir audio', 'combinar audio', 'juntar audio', 'concatenar audio'],
    compressVideo: ['comprimir video', 'reducir video', 'peso video', 'video ligero'],
    trimVideo: ['recortar video', 'cortar video', 'segmento video', 'trozo video'],
    mergeVideos: ['unir video', 'combinar video', 'juntar video', 'concatenar video'],
    videoToGif: ['video a gif', 'convertir gif', 'gif animado', 'video gif'],
    extractAudioFromVideo: ['extraer audio video', 'separar audio', 'audio del video', 'sacar audio video'],
    removeAudioFromVideo: ['quitar audio video', 'video mudo', 'sin audio', 'eliminar audio video', 'silenciar video'],
    inspectFileMetadata: ['inspeccionar metadatos', 'analizar archivo', 'ver propiedades', 'verificar archivo', 'saber tipo de archivo', 'hash sha256'],
    encryptDecryptFile: ['cifrar', 'descifrar', 'encriptar', 'desencriptar', 'contraseña', 'proteger archivo', 'seguridad'],
    photoLocationExtractor: ['ubicación foto', 'gps foto', 'coordenadas foto', 'donde se tomó', 'exif gps', 'latitud longitud'],
    simpleCalculator: ['calculadora', 'calcular', 'suma', 'resta', 'multiplicar', 'dividir', 'operaciones básicas', 'matemáticas'],
    scientificCalculator: ['calculadora científica', 'seno', 'coseno', 'tangente', 'logaritmo', 'raíz cuadrada', 'factorial', 'funciones matemáticas'],
    textToUnicodeBraille: ['braille', 'puntos', 'discapacidad visual', 'accesibilidad', 'leer braille', 'texto braille'],
    formatDocumentApa7: ['formato apa', 'apa 7', 'normas apa', 'trabajo académico', 'ensayo apa', 'referencias apa'],
    scannedPdfToSearchablePdf: ['pdf escaneado buscable', 'ocr pdf', 'texto buscable', 'pdf con texto', 'hacer pdf buscable', 'agregar texto pdf'],
    imageToSearchablePdf: ['imagen a pdf buscable', 'foto a pdf buscable', 'ocr imagen', 'imagen con texto', 'escaneo a pdf'],
    extractTextFromScannedPdf: ['extraer texto pdf escaneado', 'copiar texto pdf', 'ocr extraer texto', 'sacar texto pdf'],
    detectOcrNeeded: ['detectar ocr', 'analizar pdf', 'verificar texto pdf', 'necesita ocr'],
    censorPdf: ['censurar pdf', 'redact pdf', 'ocultar texto pdf', 'proteger datos pdf', 'sensible pdf'],
    verifyPdfCensor: ['verificar censura', 'comprobar censura', 'validar censura pdf', 'chequear censura'],
    comparePdfs: ['comparar pdf', 'diferencias pdf', 'comparar documentos', 'diff pdf', 'ver cambios pdf'],
  };

  var SYNONYMS = {
    'juntar': 'unir',
    'combinar': 'unir',
    'pegar': 'unir',
    'fusionar': 'unir',
    'mezclar': 'unir',
    'pesado': 'peso',
    'liviano': 'ligero',
    'chiquito': 'pequeño',
    'cambiar': 'convertir',
    'transformar': 'convertir',
    'pasar': 'convertir',
    'sacar': 'extraer',
    'quitar': 'eliminar',
    'borrar': 'eliminar',
    'suprimir': 'eliminar',
    'remover': 'eliminar',
    'limpiar': 'eliminar',
    'arreglar': 'reparar',
    'corregir': 'reparar',
    'reducir': 'comprimir',
    'achicar': 'comprimir',
    'encoger': 'comprimir',
    'crear': 'generar',
    'hacer': 'generar',
    'duplicar': 'copiar',
    'repetir': 'copiar',
    'clonar': 'copiar',
    'ordenar': 'organizar',
    'clasificar': 'organizar',
    'doblar': 'rotar',
    'girar': 'rotar',
    'voltear': 'rotar',
    'fotografía': 'imagen',
    'foto': 'imagen',
    'archivo': 'documento',
    'libro': 'epub',
    'ebook': 'epub',
    'hoja de calculo': 'excel',
    'cuaderno': 'cuadernillo',
    'folio': 'cuadernillo',
    'capturar': 'escanear',
    'silenciar': 'quitar',
    'encriptar': 'cifrar',
    'desencriptar': 'descifrar',
    'proteger': 'cifrar',
    'calcular': 'calcular',
    'matemáticas': 'calcular',
    'geolocalización': 'ubicación',
    'exif': 'metadatos',
    'buscable': 'texto',
    'ocr': 'reconocimiento',
    'escaneado': 'imagen',
    'redact': 'censurar',
    'proteger': 'censurar',
    'ocultar': 'censurar',
    'diff': 'comparar',
    'cambios': 'modificaciones',
  };

  var FORMAT_KEYWORDS = {
    'pdf': ['pdf'],
    'imagen': ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'imagen', 'foto', 'fotografía', 'picture'],
    'word': ['word', 'doc', 'docx', 'documento'],
    'texto': ['txt', 'texto', 'texto plano', 'notas'],
    'epub': ['epub', 'ebook', 'libro'],
    'excel': ['excel', 'xlsx', 'xls', 'hoja de cálculo', 'hoja de calculo', 'spreadsheet'],
    'csv': ['csv'],
    'json': ['json'],
    'xml': ['xml'],
    'odt': ['odt', 'libreoffice', 'openoffice'],
    'ods': ['ods'],
    'video': ['video', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'clip', 'película'],
    'audio': ['audio', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'música', 'sonido'],
  };

  var INTENT_PATTERNS = [
    { pattern: /fondo.*transparente|quitar.*fondo|fondo.*foto/i, action: 'signature' },
    { pattern: /pasaporte|visa|dni|carnet|foto.*carnet|documento.*foto/i, action: 'docPhoto' },
    { pattern: /censurar|pixelar|desenfocar|ocultar.*dato/i, action: 'censor' },
    { pattern: /unir|juntar|combinar|fusionar|pegar|mezclar/i, action: 'merge' },
    { pattern: /dividir|separar|partir|cortar|extraer.*págin/i, action: 'split' },
    { pattern: /comprimir|reducir.*peso|reducir.*tamaño|achicar|encoger|rebajar|menos.*pes/i, action: 'compress' },
    { pattern: /convertir|pasar.*a|transformar|cambiar.*formato/i, action: 'convert' },
    { pattern: /eliminar|quitar|borrar|suprimir|remover/i, action: 'delete' },
    { pattern: /editar|modificar|cambiar.*metadato|propiedades/i, action: 'edit' },
    { pattern: /rotar|girar|voltear|orientación/i, action: 'rotate' },
    { pattern: /recortar|margen|recorte|sangría/i, action: 'crop' },
    { pattern: /redimensionar|tamaño|dimension|escalar|resize/i, action: 'resize' },
    { pattern: /ordenar|reordenar|organizar|mover.*págin/i, action: 'reorder' },
    { pattern: /invertir|revertir|al.*revés|orden.*inverso/i, action: 'reverse' },
    { pattern: /duplicar|copiar.*págin|repetir|clonar/i, action: 'duplicate' },
    { pattern: /insertar|añadir|agregar|poner.*págin/i, action: 'insert' },
    { pattern: /numerar|número.*págin|paginación/i, action: 'number' },
    { pattern: /marca.*agua|watermark|borrador|confidencial/i, action: 'watermark' },
    { pattern: /firmar|firma(?!\s+transparente)/i, action: 'sign' },
    { pattern: /cuadernillo|booklet|folleto|plegar/i, action: 'booklet' },
    { pattern: /intercalar|alternar|mezclar.*págin/i, action: 'interleave' },
    { pattern: /reparar|arreglar|corregir|dañado|corrupto/i, action: 'repair' },
    { pattern: /validar|comprobar|verificar/i, action: 'validate' },
    { pattern: /rescatar|mejorar.*documento|escaneo/i, action: 'rescue' },
    { pattern: /buscar.*reemplazar|reemplazar.*texto/i, action: 'findReplace' },
    { pattern: /tabla.*contenido|índice/i, action: 'toc' },
    { pattern: /extraer.*contenido|sacar.*contenido/i, action: 'extract' },
    { pattern: /metadatos.*word|quitar.*metadatos.*word/i, action: 'stripMetadataWord' },
    { pattern: /uniformar|normalizar.*formato/i, action: 'format' },
    { pattern: /páginas.*en.*blanco|páginas.*vacías/i, action: 'blankPages' },
    { pattern: /cumplir.*requisitos|validar.*requisitos/i, action: 'compliance' },
    { pattern: /flujo|cadena.*operaciones|pipeline/i, action: 'workflow' },
    { pattern: /conversor.*avanzado|conversión.*avanzada/i, action: 'advancedConvert' },
    { pattern: /redes.*sociales|tiktok|instagram|youtube|reel|historia|stories/i, action: 'socialCrop' },
    { pattern: /borrar.*objeto|quitar.*objeto|eliminar.*objeto|pincel/i, action: 'removeObjects' },
    { pattern: /escanear.*documento|documento.*escaneo|mejorar.*escaneo/i, action: 'enhanceScanned' },
    { pattern: /convertir.*audio|audio.*mp3|audio.*wav/i, action: 'convertAudio' },
    { pattern: /recortar.*audio|cortar.*audio/i, action: 'trimAudio' },
    { pattern: /unir.*audio|combinar.*audio/i, action: 'mergeAudio' },
    { pattern: /comprimir.*video|video.*peso/i, action: 'compressVideo' },
    { pattern: /recortar.*video|cortar.*video/i, action: 'trimVideo' },
    { pattern: /unir.*video|combinar.*video/i, action: 'mergeVideo' },
    { pattern: /video.*gif|gif.*animado/i, action: 'videoToGif' },
    { pattern: /extraer.*audio.*video|audio.*del.*video/i, action: 'extractAudio' },
    { pattern: /quitar.*audio.*video|video.*sin.*audio|video.*mudo/i, action: 'removeAudio' },
    { pattern: /inspeccionar.*metadatos|analizar.*archivo|verificar.*tipo.*archivo/i, action: 'inspectFileMetadata' },
    { pattern: /cifrar|descifrar|encriptar|desencriptar|proteger.*contraseña/i, action: 'encryptDecryptFile' },
    { pattern: /ubicación.*foto|gps.*foto|donde.*se.*tomó|coordenadas.*foto|exif.*gps/i, action: 'photoLocationExtractor' },
    { pattern: /calculadora.*simple|operaciones.*básicas|suma.*resta/i, action: 'simpleCalculator' },
    { pattern: /calculadora.*científica|seno|coseno|logaritmo|factorial|funciones.*matemáticas/i, action: 'scientificCalculator' },
    { pattern: /braille|puntos.*ceguera|accesibilidad.*visual/i, action: 'textToUnicodeBraille' },
    { pattern: /formato.*apa|normas.*apa|trabajo.*académico|ensayo.*apa/i, action: 'formatDocumentApa7' },
    { pattern: /ocr|reconocimiento.*texto|texto.*buscable|pdf.*escaneado.*buscable/i, action: 'ocr' },
    { pattern: /detectar.*ocr|analizar.*pdf.*texto|verificar.*texto.*pdf/i, action: 'detectOcr' },
    { pattern: /censurar.*pdf|redact.*pdf|ocultar.*texto.*pdf|proteger.*datos.*pdf/i, action: 'censorPdf' },
    { pattern: /comparar.*pdf|diferencias.*pdf|diff.*pdf|ver.*cambios.*pdf/i, action: 'comparePdfs' },
  ];

  var CATEGORY_MAP = {
    images: 'imagen',
    pdf: 'pdf',
    signatures: 'firma',
    documents: 'documento',
    text: 'texto',
    ebooks: 'epub',
    spreadsheets: 'hoja de cálculo',
  };

  var CATEGORY_FORMAT_MAP = {
    images: ['jpg', 'jpeg', 'png', 'webp', 'imagen', 'foto', 'fotografía'],
    pdf: ['pdf'],
    documents: ['word', 'doc', 'docx', 'documento'],
    text: ['txt', 'texto'],
    ebooks: ['epub', 'ebook', 'libro'],
    spreadsheets: ['excel', 'xlsx', 'csv', 'hoja de cálculo', 'json', 'xml'],
  };

  var FORMAT_TO_CATEGORY = {};
  Object.keys(CATEGORY_FORMAT_MAP).forEach(function (cat) {
    CATEGORY_FORMAT_MAP[cat].forEach(function (fmt) {
      FORMAT_TO_CATEGORY[fmt] = cat;
    });
  });

  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function levenshtein(a, b) {
    var la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    var matrix = [];
    for (var i = 0; i <= lb; i++) matrix[i] = [i];
    for (var j = 0; j <= la; j++) matrix[0][j] = j;
    for (var i = 1; i <= lb; i++) {
      for (var j = 1; j <= la; j++) {
        var cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[lb][la];
  }

  function fuzzyMatch(query, target) {
    if (target.indexOf(query) !== -1) return true;
    if (query.length < 3) return false;
    var maxDist = query.length <= 4 ? 1 : Math.floor(query.length / 3);
    return levenshtein(query, target) <= maxDist;
  }

  function synonymExpand(token) {
    var expanded = SYNONYMS[token];
    return expanded || token;
  }

  function extractFormatHint(query) {
    var nq = normalize(query);
    var formats = [];
    Object.keys(FORMAT_KEYWORDS).forEach(function (key) {
      FORMAT_KEYWORDS[key].forEach(function (kw) {
        if (nq.indexOf(normalize(kw)) !== -1) {
          formats.push(key);
        }
      });
    });
    return formats;
  }

  function detectIntent(query) {
    var results = [];
    INTENT_PATTERNS.forEach(function (ip) {
      if (ip.pattern.test(query)) {
        results.push(ip.action);
      }
    });
    return results;
  }

  function detectCategory(query) {
    var nq = normalize(query);
    var cats = [];
    Object.keys(FORMAT_TO_CATEGORY).forEach(function (fmt) {
      if (nq.indexOf(normalize(fmt)) !== -1) {
        var cat = FORMAT_TO_CATEGORY[fmt];
        if (cats.indexOf(cat) === -1) cats.push(cat);
      }
    });
    return cats;
  }

  var index = [];

  function buildIndex() {
    index = [];
    var cards = document.querySelectorAll('.tool-card[data-tool]');
    cards.forEach(function (card) {
      var toolId = card.dataset.tool || '';
      var category = card.dataset.category || '';
      var name = (card.querySelector('strong') || {}).textContent || '';
      var desc = (card.querySelector('small') || {}).textContent || '';
      var href = card.getAttribute('href') || '';
      var inputFmt = card.getAttribute('data-input-formats') || '';
      var outputFmt = card.getAttribute('data-output-formats') || '';
      var keywords = card.getAttribute('data-keywords') || '';
      var actions = ACTIONS[toolId] || [];

      var searchableText = normalize(name + ' ' + desc + ' ' + toolId + ' ' + href + ' ' + category + ' ' + inputFmt + ' ' + outputFmt + ' ' + keywords + ' ' + actions.join(' '));

      index.push({
        toolId: toolId,
        category: category,
        name: name.trim(),
        desc: desc.trim(),
        href: href,
        inputFmt: inputFmt.toLowerCase(),
        outputFmt: outputFmt.toLowerCase(),
        keywords: normalize(keywords),
        actions: actions.map(normalize),
        searchable: searchableText,
        card: card,
      });
    });
  }

  function scoreItem(item, query, tokens, intents, formatHints, categoryHints) {
    var score = 0;
    var nq = normalize(query);
    var nName = normalize(item.name);
    var nDesc = normalize(item.desc);

    if (nName === nq) return 1000;
    if (nName.indexOf(nq) !== -1) score += 200;

    var allTokensMatch = tokens.every(function (t) {
      return nName.indexOf(t) !== -1 || item.searchable.indexOf(t) !== -1;
    });
    if (allTokensMatch && tokens.length > 1) score += 150;

    tokens.forEach(function (t) {
      var syn = synonymExpand(t);
      if (nName.indexOf(t) !== -1 || nName.indexOf(syn) !== -1) score += 80;
      else if (item.actions.some(function (a) { return a.indexOf(t) !== -1 || a.indexOf(syn) !== -1; })) score += 60;
      else if (item.searchable.indexOf(t) !== -1 || item.searchable.indexOf(syn) !== -1) score += 30;
      else if (fuzzyMatch(t, nName)) score += 20;
    });

    if (intents.length > 0) {
      intents.forEach(function (intent) {
        if (item.actions.some(function (a) {
          return a.indexOf(intent) !== -1;
        })) score += 70;
        var nameNorm = nName;
        if ((intent === 'merge' && /unir|combinar|juntar|fusionar/.test(nameNorm)) ||
            (intent === 'split' && /dividir|separar|extraer/.test(nameNorm)) ||
            (intent === 'compress' && /comprimir|reducir/.test(nameNorm)) ||
            (intent === 'convert' && /convertir/.test(nameNorm)) ||
            (intent === 'delete' && /eliminar|borrar|quitar/.test(nameNorm)) ||
            (intent === 'rotate' && /girar|rotar|voltear/.test(nameNorm)) ||
            (intent === 'crop' && /recortar/.test(nameNorm)) ||
            (intent === 'sign' && /firmar|firma/.test(nameNorm))) {
          score += 40;
        }
      });
    }

    if (formatHints.length > 0) {
      var formatsInItem = (item.inputFmt + ' ' + item.outputFmt + ' ' + item.keywords + ' ' + item.searchable);
      formatHints.forEach(function (fh) {
        var nfh = normalize(fh);
        var catFormats = FORMAT_KEYWORDS[fh] || [nfh];
        var matchFound = catFormats.some(function (cf) {
          return formatsInItem.indexOf(cf) !== -1;
        });
        if (matchFound) score += 50;
      });

      if (categoryHints.length > 0) {
        var matchesCategory = categoryHints.some(function (c) { return c === item.category; });
        if (matchesCategory) score += 30;
      }
    }

    if (/^(unir|combinar|juntar) (pdf|word|epub|excel|txt)/.test(nq) && item.category === 'pdf' && intents.indexOf('merge') !== -1) score += 60;
    if (/^(unir|combinar|juntar) (word|documento)/.test(nq) && item.category === 'documents' && intents.indexOf('merge') !== -1) score += 60;

    if (/pasar word a pdf|word a pdf|convertir word a pdf/.test(nq) && item.toolId === 'wordToPdf') score += 100;
    if (/imagenes a pdf|imágenes a pdf|fotos a pdf|poner.*imágenes.*pdf/.test(nq) && item.toolId === 'imagesPdf') score += 80;
    if (/fondo.*transparente|quitar.*fondo|fondo.*foto/.test(nq)) {
      if (item.toolId === 'signature') score += 250;
      else if (item.toolId === 'censor' || item.toolId === 'docPhoto') score += 10;
      else score -= 50;
    }
    if (/borrar.*objeto|quitar.*objeto|eliminar.*objeto|pincel/.test(nq) && item.toolId === 'removeObjects') score += 100;

    var unsupportedFormats = [];
    var mentionsUnsupported = unsupportedFormats.some(function(f) { return nq.indexOf(normalize(f)) !== -1; });
    if (mentionsUnsupported && intents.indexOf('convert') !== -1 && formatHints.length === 0) {
      score = Math.floor(score * 0.1);
    }

    if (nName.indexOf(nq) === -1 && item.searchable.indexOf(nq) === -1 && score < 20) {
      score = 0;
    }

    return score;
  }

  function search(query) {
    if (!index.length) buildIndex();
    if (!query || !query.trim()) return [];

    var nq = normalize(query);
    var tokens = nq.split(/\s+/).filter(function (t) { return t.length >= 2; });
    var expandedTokens = tokens.map(synonymExpand);
    var allTokens = tokens.concat(expandedTokens).filter(function (v, i, a) { return a.indexOf(v) === i; });

    var intents = detectIntent(query);
    var formatHints = extractFormatHint(query);
    var categoryHints = detectCategory(query);

    var unsupportedFormats = [];
    var mentionsUnsupported = unsupportedFormats.some(function(f) { return nq.indexOf(normalize(f)) !== -1; });
    if (mentionsUnsupported) {
      var hasSupportedTool = index.some(function(item) {
        return item.searchable.indexOf('video') !== -1 || item.searchable.indexOf('audio') !== -1;
      });
      if (!hasSupportedTool) return [];
    }

    var scored = [];
    index.forEach(function (item) {
      var s = scoreItem(item, query, allTokens, intents, formatHints, categoryHints);
      if (s > 0) {
        scored.push({ item: item, score: s });
      }
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    var maxResults = 5;
    var results = [];
    var seen = {};
    for (var i = 0; i < scored.length && results.length < maxResults; i++) {
      var id = scored[i].item.toolId;
      if (seen[id]) continue;
      seen[id] = true;
      var item = scored[i].item;
      results.push({
        toolId: item.toolId,
        name: item.name,
        desc: item.desc,
        href: item.href,
        category: item.category,
        score: scored[i].score,
        inputFmt: item.inputFmt,
        outputFmt: item.outputFmt,
        confidence: scored[i].score >= 100 ? 'high' : scored[i].score >= 50 ? 'medium' : 'low',
      });
    }

    return results;
  }

  function hasLowConfidence(results) {
    if (!results || results.length === 0) return true;
    return results[0].score < 50;
  }

  function formatLabel(inputFmt, outputFmt) {
    var parts = [];
    if (inputFmt) parts.push('Accepta: ' + inputFmt.toUpperCase());
    if (outputFmt && outputFmt !== inputFmt) parts.push('Genera: ' + outputFmt.toUpperCase());
    return parts.join(' · ');
  }

  var categoryNames = {
    images: 'Imágenes',
    pdf: 'PDF',
    signatures: 'Firmas',
    documents: 'Documentos',
    text: 'Texto',
    ebooks: 'EPUB',
    spreadsheets: 'Hojas de cálculo',
    video: 'Video',
    audio: 'Audio',
    calculators: 'Calculadoras',
  };

  window.ToolistoSearch = {
    buildIndex: buildIndex,
    search: search,
    hasLowConfidence: hasLowConfidence,
    formatLabel: formatLabel,
    categoryNames: categoryNames,
    normalize: normalize,
    levenshtein: levenshtein,
    ACTIONS: ACTIONS,
    SYNONYMS: SYNONYMS,
    _index: function() { return index; },
    _indexLength: function() { return index.length; },
  };
})();
