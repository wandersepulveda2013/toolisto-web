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
  };

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
    return types.some(t => file.type.toLowerCase() === t);
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
    advancedPanel: $('#advancedPanel'),
    advancedControls: $('#advancedControls'),
    flowActions: $('#flowActions'),
    runButton: $('#runButton'),
    clearFilesButton: $('#clearFilesButton'),
    toolSearch: $('#toolSearch'),
    emptyTools: $('#emptyTools'),
    resultDialog: $('#resultDialog'),
    dialogClose: $('#dialogClose'),
    resultTitle: $('#resultTitle'),
    resultMessage: $('#resultMessage'),
    resultStats: $('#resultStats'),
    resultSupport: $('#resultSupport'),
    previewArea: $('#previewArea'),
    downloadButton: $('#downloadButton'),
    resetButton: $('#resetButton'),
    pickerDialog: $('#pickerDialog'),
    pickerClose: $('#pickerClose'),
    pickerGrid: $('#pickerGrid'),
    toast: $('#toast'),
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
      els.dropZone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => els.dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragging');
    }));
    els.dropZone?.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files]));

    window.addEventListener('paste', handlePaste);
    els.intentInput?.addEventListener('input', () => {
      if (!state.forcedTool) updateRecommendation();
    });

    els.changeToolButton?.addEventListener('click', openPicker);
    els.pickerClose?.addEventListener('click', () => els.pickerDialog?.close());
    els.dialogClose?.addEventListener('click', () => els.resultDialog?.close());

    els.resetButton?.addEventListener('click', resetAll);
    els.downloadButton?.addEventListener('click', downloadResult);
    els.runButton?.addEventListener('click', runCurrentTool);
    els.clearFilesButton?.addEventListener('click', clearSelectedFiles);

    const heroSuggestions = $('#heroSuggestions');
    let suggestIndex = -1;
    let currentSuggestions = [];

    els.toolSearch?.addEventListener('input', () => {
      filterTools();
      updateSearchClear();
      showSuggestions();
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
        <a class="suggest-item" href="${s.href}" role="option" aria-selected="false" data-index="${i}">
          <span class="suggest-icon" style="background:${s.color}">${s.icon}</span>
          <span class="suggest-info">
            <span class="suggest-name">${s.name}</span>
            <span class="suggest-meta">${s.category} · ${s.desc}</span>
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


  }


  function setToolFilter(filter) {
    state.activeFilter = filter;
    $$('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === filter));
    filterTools();
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
    const allowed = incoming.filter((file) => {
      const validType = file.type.startsWith('image/') || file.type === 'application/pdf' || isDocFile(file) || isOdtFile(file) || isRtfFile(file) || isTxtFile(file) || isEpubFile(file) || isMobiFile(file) || isCsvFile(file) || isExcelFile(file) || isOdsFile(file) || isJsonFile(file) || isXmlFile(file);
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
    renderFiles();
    updateRecommendation();
  }

  function renderFiles() {
    els.fileStrip.innerHTML = '';
    els.fileStrip.hidden = !state.files.length;

    state.files.forEach((file, index) => {
      const pill = document.createElement('div');
      pill.className = 'file-pill';
      const isDoc = isDocFile(file);
      const isOdt = isOdtFile(file);
      const isRtf = isRtfFile(file);
      const isTxt = isTxtFile(file);
      const isEpub = isEpubFile(file);
      const isMobi = isMobiFile(file);
      const typeLabel = file.type === 'application/pdf' ? 'PDF' : isDoc ? 'DOC' : isOdt ? 'ODT' : isRtf ? 'RTF' : isTxt ? 'TXT' : isEpub ? 'EPUB' : isMobi ? 'MOBI' : 'IMG';
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
  }

  function updateRecommendation() {
    if (!state.files.length) {
      state.tool = state.forcedTool || null;
      els.smartResult.hidden = true;
      els.advancedPanel.hidden = true;
      if (els.flowActions) els.flowActions.hidden = true;
      els.runButton.disabled = true;
      els.advancedControls.innerHTML = '';
      return;
    }

    const recommended = state.forcedTool || inferTool(els.intentInput.value, state.files);
    chooseTool(recommended, Boolean(state.forcedTool));
  }

  function inferTool(intent, files) {
    const q = intent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const images = files.filter((file) => file.type.startsWith('image/'));
    const pdfs = files.filter((file) => file.type === 'application/pdf');

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

    if (pdfs.length >= 2) return 'mergePdf';
    if (images.length >= 2) return 'imagesPdf';
    if (images.length === 1) return 'compress';
    return pdfs.length ? 'mergePdf' : 'compress';
  }

  function chooseTool(tool, forced = false) {
    state.tool = tool;
    state.forcedTool = forced ? tool : null;
    window.__selectedTool = tool;
    const meta = toolMeta[tool];
    els.smartResult.hidden = false;
    els.advancedPanel.hidden = false;
    if (els.flowActions) els.flowActions.hidden = false;
    els.smartIcon.textContent = meta.icon;
    els.smartTitle.textContent = meta.title;
    els.smartDescription.textContent = meta.description;
    renderAdvancedControls(tool);
    const validation = validateToolFiles(tool, state.files);
    els.runButton.disabled = !validation.ok;
    if (!validation.ok) els.smartDescription.textContent = validation.message;
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
    const epubTools = ['epubToTxt','epubToHtml','epubToMarkdown','mergeEpub','splitEpub','editMetadataEpub','coverEpub','imagesEpub','validateEpub','repairEpub'];
    if (epubTools.includes(tool)) {
      if (epubFiles.length !== files.length || epubFiles.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos EPUB.' };
    }
    if (['compress', 'signature', 'crop', 'removeObjects', 'socialCrop'].includes(tool) && images.length !== 1) return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
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
    if (epubFiles.length === 1) tools.push('epubToTxt','epubToHtml','epubToMarkdown','mergeEpub','splitEpub','editMetadataEpub','coverEpub','imagesEpub','validateEpub','repairEpub');
    if (epubFiles.length > 1) tools.push('mergeEpub');
    if (csvs.length >= 1 && excelFiles.length === 0 && jsonFiles.length === 0 && xmlFiles.length === 0) tools.push('csvToExcel', 'csvToJson');
    if (excelFiles.length === 1 && csvs.length === 0 && jsonFiles.length === 0) tools.push('excelToCsv', 'excelToJson', 'splitExcel', 'xlsToXlsx');
    if (excelFiles.length === 1 && excelFiles[0].name.endsWith('.xlsx')) tools.push('xlsxToOds');
    if (excelFiles.length > 1) tools.push('mergeExcel', 'compareExcel');
    if (odsFiles.length >= 1 && excelFiles.length === 0) tools.push('odsToXlsx');
    if (jsonFiles.length >= 1 && csvs.length === 0 && excelFiles.length === 0) tools.push('jsonToExcel', 'jsonToCsv', 'jsonToXml');
    if (xmlFiles.length >= 1 && csvs.length === 0 && excelFiles.length === 0 && jsonFiles.length === 0) tools.push('xmlToJson');
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

  function renderAdvancedControls(tool) {
    const original = state.files[0]?.size || 0;
    const suggestedKb = Math.max(150, Math.min(1200, Math.round((original / 1024) * 0.58)));
    const targetFromIntent = parseTargetKb(els.intentInput.value);

    const htmlByTool = {
      compress: `
        ${controlNumber('targetKb', 'Peso máximo objetivo (KB)', targetFromIntent || suggestedKb, 20, 10000)}
        ${controlSelect('compressFormat', 'Formato de salida', [['auto','Automático'],['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
        ${controlNumber('compressWidth', 'Ancho máximo (0 = automático)', 0, 0, 10000)}
        ${controlNumber('compressQuality', 'Calidad inicial (%)', 84, 25, 100)}
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
          <label style="display:block;margin-bottom:6px">Categorías a eliminar</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="stripAll" checked style="flex-shrink:0" /> Eliminar todos los metadatos</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="stripGps" checked style="flex-shrink:0" /> GPS / ubicación</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="stripDate" checked style="flex-shrink:0" /> Fecha y hora</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="stripDevice" checked style="flex-shrink:0" /> Dispositivo / cámara</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="stripSoftware" checked style="flex-shrink:0" /> Software</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer"><input type="checkbox" id="stripAuthor" checked style="flex-shrink:0" /> Autor</label>
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
        ${controlSelect('rotatePdfAngle', 'Ángulo de giro', [['90','90° derecha'],['270','90° izquierda'],['180','180°']])}
        ${controlSelect('rotatePdfPages', 'Aplicar a', [['all','Todas las páginas'],['first','Solo primera página'],['last','Solo última página']])}
      `,
      deletePagesPdf: `
        <div class="control" style="grid-column:1/-1" id="deletePagesPdfInfo">
          <div id="deletePagesPdfMeta" style="color:var(--muted);font-size:.85rem">Cargando PDF…</div>
        </div>
        <div class="control" style="grid-column:1/-1">
          <label for="deletePagesRanges">Páginas a eliminar (rangos separados por coma)</label>
          <input id="deletePagesRanges" type="text" placeholder="1, 3-5, 8" style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);color:var(--c-text);font-size:.9rem" />
          <div id="deletePagesError" style="color:var(--c-error);font-size:.8rem;margin-top:4px"></div>
        </div>
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
    };

    els.advancedControls.innerHTML = htmlByTool[tool] || '';
    const preset = $('#cropPreset');
    if (preset) preset.addEventListener('change', syncCropPreset);
    if (tool === 'removeObjects') initRemoveObjectsEditor();
    if (tool === 'stripMetadata') initStripMetadata();
    if (tool === 'socialCrop') initSocialCrop();
    if (tool === 'splitPdf') initSplitPdf();
    if (tool === 'reorderPdf') initReorderPdf();
    if (tool === 'pdfToImages') initPdfToImages();
    if (tool === 'signPdf') initSignPdf();
    if (tool === 'deletePagesPdf') initDeletePagesPdf();
    if (tool === 'duplicatePagesPdf') initDuplicatePagesPdf();
    if (tool === 'insertBlankPagesPdf') initInsertBlankPagesPdf();
    if (tool === 'editMetadataPdf') initEditMetadataPdf();
    if (tool === 'compressPdf') initCompressPdf();
    if (tool === 'interleavePdf') initInterleavePdf();
    if (tool === 'cropPdf') initCropPdf();
    if (tool === 'resizePdfPages') initResizePdfPages();
    if (tool === 'nUpPdf') initNUpPdf();
    if (tool === 'splitDoublePdf') initSplitDoublePdf();
    if (tool === 'bookletPdf') initBookletPdf();
    if (tool === 'watermarkPdf') initWatermarkPdf();
    if (tool === 'addPageNumbersPdf') initAddPageNumbersPdf();
    if (tool === 'addHeaderFooterPdf') initAddHeaderFooterPdf();
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

  async function runCurrentTool() {
    if (state.processing || !state.tool || !state.files.length) return;
    const validation = validateToolFiles(state.tool, state.files);
    if (!validation.ok) return showToast(validation.message);

    state.processing = true;
    const originalText = els.runButton.innerHTML;
    els.runButton.innerHTML = '<span>Procesando…</span><span>•••</span>';
    els.runButton.disabled = true;

    const options = {};
    document.querySelectorAll('#advancedControls input, #advancedControls select').forEach(el => {
      if (el.id) options[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });

    try {
      let result;
      if (window.ToolProcessors && window.ToolProcessors[state.tool]) {
        result = await window.ToolProcessors[state.tool](state.files, options, (cur, total, msg) => {
          els.runButton.innerHTML = `<span>${msg || 'Procesando…'} ${cur}/${total}</span><span>•••</span>`;
        });
      } else {
        result = await runBuiltinTool(state.tool, state.files, options);
      }

      if (!result || !result.files || !result.files.length) {
        showToast(result?.message || 'No se pudo procesar el archivo.');
        return;
      }

      state.outputFiles = result.files;
      showResult({
        title: result.title || result.message || 'Procesamiento completado',
        message: result.message || `${result.files.length} archivo(s) listo(s) para descargar.`,
        stats: result.stats || result.files.map(f => [f.name, formatBytes(f.size)]),
        preview: result.preview || (result.files.length === 1 ? result.files[0].blob : null),
        files: result.files,
      });
    } catch (error) {
      console.error(error);
      showToast(error?.message || 'No pudimos procesar el archivo.');
    } finally {
      state.processing = false;
      els.runButton.innerHTML = originalText;
      els.runButton.disabled = false;
    }
  }

  async function runBuiltinTool(tool, files, options) {
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
      default: throw new Error('Selecciona una herramienta.');
    }
    if (!result) return null;
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
    const targetBytes = clamp(numberValue('targetKb', 500), 20, 10000) * 1024;
    const requestedMime = valueOf('compressFormat', 'auto');
    const maxWidth = clamp(numberValue('compressWidth', 0), 0, 10000);
    const initialQuality = clamp(numberValue('compressQuality', 84) / 100, .25, 1);
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
    return {
      blob,
      name: `${baseName(file.name)}-optimizada.${extension}`,
      title: 'Imagen optimizada',
      message: blob.size <= targetBytes ? 'La imagen quedó por debajo del peso máximo indicado.' : 'La imagen se redujo todo lo posible sin hacerla demasiado pequeña.',
      preview: blob,
      stats: [
        ['Antes', formatBytes(file.size)],
        ['Después', formatBytes(blob.size)],
        ['Reducción', `${Math.max(0, Math.round((1 - blob.size / file.size) * 100))}%`],
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
        ctx.drawImage(image, 0, 0);
        let mime = formatSetting === 'auto' ? (file.type === 'image/png' ? 'image/png' : 'image/webp') : formatSetting;
        if (mime === 'image/jpeg') mime = 'image/webp';
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
    const stripAll = $('#stripAll');
    const cats = ['stripGps', 'stripDate', 'stripDevice', 'stripSoftware', 'stripAuthor'];
    if (stripAll) {
      stripAll.addEventListener('change', () => {
        cats.forEach(id => { const el = $(`#${id}`); if (el) el.checked = stripAll.checked; });
      });
    }
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
    let sx, sy, sw, sh;
    if (imgRatio > cropRatio) {
      sh = _sc.imgH; sw = sh * cropRatio; sx = (_sc.imgW - sw) / 2; sy = 0;
    } else {
      sw = _sc.imgW; sh = sw / cropRatio; sx = 0; sy = (_sc.imgH - sh) / 2;
    }

    ctx.save();
    if (preset.circular) { ctx.beginPath(); ctx.arc(preset.w / 2, preset.h / 2, preset.w / 2, 0, Math.PI * 2); ctx.clip(); }
    ctx.translate(preset.w / 2, preset.h / 2);
    if (_sc.flipH) ctx.scale(-1, 1);
    if (_sc.flipV) ctx.scale(1, -1);
    if (_sc.rot) ctx.rotate(_sc.rot * Math.PI / 180);

    const drawRatio = imgRatio > cropRatio ? preset.h / _sc.imgH : preset.w / _sc.imgW;
    let drawW, drawH;
    if (imgRatio > cropRatio) {
      drawH = preset.h * _sc.zoom;
      drawW = drawH * imgRatio;
    } else {
      drawW = preset.w * _sc.zoom;
      drawH = drawW / imgRatio;
    }
    const offPxX = _sc.offsetX * _sc.zoom * drawRatio;
    const offPxY = _sc.offsetY * _sc.zoom * drawRatio;
    ctx.drawImage(_sc.image, sx, sy, sw, sh, -sw / 2 + offPxX, -sh / 2 + offPxY, sw, sh);
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
    const angle = Number(valueOf('rotatePdfAngle', 90));
    const target = valueOf('rotatePdfPages', 'all');
    const pageCount = source.getPageCount();
    const indices = target === 'first' ? [0] : target === 'last' ? [pageCount - 1] : Array.from({ length: pageCount }, (_, i) => i);
    const newPdf = await PDFDocument.create();
    const copied = await newPdf.copyPages(source, Array.from({ length: pageCount }, (_, i) => i));
    copied.forEach((p, i) => {
      if (indices.includes(i)) p.setRotation(PDFLib.degrees((p.getRotation().angle + angle) % 360));
      newPdf.addPage(p);
    });
    const outBytes = await newPdf.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const label = angle === 180 ? '180°' : angle === 270 ? '90° izquierda' : '90° derecha';
    return { blob, name: `${file.name.replace(/\.pdf$/i, '')}-girado.pdf`, title: 'PDF girado', message: `${indices.length} página${indices.length !== 1 ? 's' : ''} girada${indices.length !== 1 ? 's' : ''} ${label}.`, stats: [['Ángulo', label], ['Páginas', String(pageCount)], ['Tamaño', formatBytes(blob.size)]] };
  }

  async function processDeletePagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    const bytes = await file.arrayBuffer();
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const totalPages = source.getPageCount();
    const rangesText = valueOf('deletePagesRanges', '');
    const result = parseRanges(rangesText, totalPages);
    if (result.error) throw new Error(result.error);
    const deleteSet = new Set();
    for (const r of result.ranges) for (let i = r.start - 1; i < r.end; i++) deleteSet.add(i);
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

  async function initDeletePagesPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const file = state.files[0];
    if (!file) return;
    const meta = $('#deletePagesPdfMeta');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (meta) meta.textContent = `${file.name} · ${doc.getPageCount()} página${doc.getPageCount() !== 1 ? 's' : ''} · Indica las páginas a eliminar`;
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
        const embedded = await newPdf.embedPdf(doc, [i]);
        leftPage.drawPage(embedded[0], { x: -left, y: 0, xScale: 1, yScale: 1 });
        rightPage.drawPage(embedded[0], { x: -right, y: 0, xScale: 1, yScale: 1 });
        totalNew += 2;
      } else {
        const top = height / 2;
        const topPage = newPdf.addPage([width, height / 2]);
        const bottomPage = newPdf.addPage([width, height / 2]);
        const embedded = await newPdf.embedPdf(doc, [i]);
        topPage.drawPage(embedded[0], { x: 0, y: top, xScale: 1, yScale: 1 });
        bottomPage.drawPage(embedded[0], { x: 0, y: 0, xScale: 1, yScale: 1 });
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
        html += `<div><strong>Extensión:</strong> .${ext}</div>`;
        html += `<div><strong>Tipo reportado:</strong> ${file.type || 'desconocido'}</div>`;
        html += `<div><strong>Formato detectado:</strong> ${detected ? detected.name : 'No reconocido'}</div>`;
        if (detected && fileMime !== detected.mime) {
          html += `<div style="color:var(--c-error);margin-top:6px"><strong>⚠ Incompatibilidad:</strong> El archivo tiene extensión .${ext} pero contiene datos ${detected.name}.</div>`;
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
    checks.push({ label: 'Tama\u00f1o: ' + formatBytes(file.size), pass: fileKB <= maxKB, detail: 'M\u00e1ximo: ' + maxKB + ' KB' });

    if (file.type.startsWith('image/')) {
      const image = await loadImage(file);
      const w = image.naturalWidth, h = image.naturalHeight;
      if (minW > 0) checks.push({ label: 'Ancho: ' + w + ' px', pass: w >= minW, detail: 'M\u00ednimo: ' + minW + ' px' });
      if (maxW > 0) checks.push({ label: 'Ancho: ' + w + ' px', pass: w <= maxW, detail: 'M\u00e1ximo: ' + maxW + ' px' });
      if (minH > 0) checks.push({ label: 'Alto: ' + h + ' px', pass: h >= minH, detail: 'M\u00ednimo: ' + minH + ' px' });
      if (maxH > 0) checks.push({ label: 'Alto: ' + h + ' px', pass: h <= maxH, detail: 'M\u00e1ximo: ' + maxH + ' px' });
    }

    if (format !== 'any') {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const extMap = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
      const validExts = extMap[format] || [];
      checks.push({ label: 'Formato: .' + ext, pass: validExts.includes(ext) || file.type === format, detail: 'Requerido: ' + format.split('/')[1].toUpperCase() });
    }

    const allPass = checks.every(c => c.pass);
    results.innerHTML = checks.map(c =>
      '<div style="margin-bottom:4px"><span style="display:inline-block;width:20px">' + (c.pass ? '\u2705' : '\u274c') + '</span> ' + c.label + ' <span style="color:var(--muted);font-size:.8rem">(' + c.detail + ')</span></div>'
    ).join('');
    results.innerHTML += '<div style="margin-top:8px;font-weight:600;color:' + (allPass ? 'var(--c-success)' : 'var(--c-error)') + '">' + (allPass ? '\u2705 Archivo cumple todos los requisitos' : '\u274c Archivo no cumple algunos requisitos') + '</div>';
  }

  async function processFileCompliance() {
    const file = state.files[0];
    const results = $('#complianceResults');
    const allPass = results?.textContent?.includes('\u2705 Archivo cumple');
    if (allPass) {
      return {
        blob: file, name: file.name, title: 'Archivo v\u00e1lido',
        message: 'El archivo cumple todos los requisitos. No se necesitan cambios.',
        stats: [['Archivo', file.name], ['Tama\u00f1o', formatBytes(file.size)]],
      };
    }

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
    const passFinal = blob.size <= maxKB;
    return {
      blob, name: baseName(file.name) + '-cumple.' + ext, title: passFinal ? 'Archivo ajustado' : 'Archivo parcialmente ajustado',
      message: passFinal ? 'Se ajustaron dimensiones y peso para cumplir los requisitos.' : 'Se redujo el peso, pero no fue posible cumplir todos los requisitos exactos.',
      preview: blob,
      stats: [['Dimensiones', w + '\u00d7' + h], ['Peso', formatBytes(blob.size)], ['Formato', ext.toUpperCase()], ['Resultado', passFinal ? 'Cumple' : 'Parcial']],
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
        message: _wfSteps.length + ' operaci\u00f3n' + (_wfSteps.length !== 1 ? 'es' : '') + ' aplicada' + (_wfSteps.length !== 1 ? 's' : '') + '.',
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
    els.resultTitle.textContent = result.title;
    els.resultMessage.textContent = result.message;
    els.resultStats.innerHTML = (result.stats || []).map(([label,value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    els.previewArea.innerHTML = '';
    if (els.resultSupport) els.resultSupport.hidden = true;
    if (result.preview) {
      state.previewUrl = URL.createObjectURL(result.preview);
      const img = document.createElement('img');
      img.src = state.previewUrl;
      img.alt = 'Vista previa del resultado';
      els.previewArea.appendChild(img);
      els.previewArea.hidden = false;
    } else {
      els.previewArea.hidden = true;
    }
    els.resultDialog.showModal();
  }

  async function downloadResult() {
    if (state.outputFiles && state.outputFiles.length > 1) {
      if (!window.JSZip) {
        state.outputFiles.forEach(f => downloadBlob(f.blob, f.name));
        showSupportBlock();
        return;
      }
      const zip = new window.JSZip();
      state.outputFiles.forEach(f => zip.file(f.name, f.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      downloadBlob(blob, 'resultados.zip');
      showSupportBlock();
      return;
    }
    if (state.outputFiles && state.outputFiles.length === 1) {
      downloadBlob(state.outputFiles[0].blob, state.outputFiles[0].name);
      showSupportBlock();
      return;
    }
    if (state.outputBlob) {
      downloadBlob(state.outputBlob, state.outputName || 'toolisto-resultado');
      showSupportBlock();
    }
  }

  function showSupportBlock() {
    if (els.resultSupport) els.resultSupport.hidden = false;
  }

  function downloadBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function resetAll() {
    els.resultDialog.close();
    clearPreviousOutput();
    state.files = [];
    state.tool = null;
    state.forcedTool = null;
    state.outputFiles = [];
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

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  function activateToolFromPageConfig() {
    const el = document.getElementById('tool-page-config');
    if (!el) return;
    try {
      const cfg = JSON.parse(el.textContent);
      if (cfg.toolId && toolMeta[cfg.toolId]) {
        chooseTool(cfg.toolId, true);
        if (cfg.inputAccept) {
          state.inputAccept = cfg.inputAccept;
          if (els.fileInput) els.fileInput.accept = cfg.inputAccept;
        }
        if (cfg.preset) {
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
      }
    } catch (_) { /* invalid JSON, ignore */ }
  }
  setTimeout(activateToolFromPageConfig, 50);
})();
