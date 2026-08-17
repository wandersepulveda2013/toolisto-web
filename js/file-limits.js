;(function() {
  'use strict';

  var KB = 1024;
  var MB = 1024 * KB;
  var GB = 1024 * MB;

  var FILE_LIMIT_PROFILES = {
    default: { maxFileSize: 100*MB, mobileMaxFileSize: 60*MB, maxTotalSize: 500*MB, mobileMaxTotalSize: 250*MB, maxFiles: 20, warningThreshold: 50*MB, memoryIntensity: 'medium' },
    imageLight: { maxFileSize: 100*MB, mobileMaxFileSize: 60*MB, maxTotalSize: 500*MB, mobileMaxTotalSize: 250*MB, maxFiles: 50, warningThreshold: 40*MB, memoryIntensity: 'medium' },
    imageHeavy: { maxFileSize: 100*MB, mobileMaxFileSize: 35*MB, maxTotalSize: 300*MB, mobileMaxTotalSize: 100*MB, maxFiles: 15, warningThreshold: 25*MB, memoryIntensity: 'high' },
    pdfLight: { maxFileSize: 150*MB, mobileMaxFileSize: 80*MB, maxTotalSize: 600*MB, mobileMaxTotalSize: 250*MB, maxFiles: 30, warningThreshold: 75*MB, memoryIntensity: 'medium' },
    pdfHeavy: { maxFileSize: 120*MB, mobileMaxFileSize: 50*MB, maxTotalSize: 300*MB, mobileMaxTotalSize: 120*MB, maxFiles: 10, warningThreshold: 40*MB, memoryIntensity: 'high' },
    office: { maxFileSize: 100*MB, mobileMaxFileSize: 50*MB, maxTotalSize: 300*MB, mobileMaxTotalSize: 150*MB, maxFiles: 20, warningThreshold: 40*MB, memoryIntensity: 'medium' },
    spreadsheet: { maxFileSize: 75*MB, mobileMaxFileSize: 30*MB, maxTotalSize: 250*MB, mobileMaxTotalSize: 80*MB, maxFiles: 15, warningThreshold: 25*MB, memoryIntensity: 'high' },
    textData: { maxFileSize: 200*MB, mobileMaxFileSize: 100*MB, maxTotalSize: 600*MB, mobileMaxTotalSize: 250*MB, maxFiles: 30, warningThreshold: 100*MB, memoryIntensity: 'low' },
    structuredDataHeavy: { maxFileSize: 75*MB, mobileMaxFileSize: 30*MB, maxTotalSize: 200*MB, mobileMaxTotalSize: 75*MB, maxFiles: 10, warningThreshold: 25*MB, memoryIntensity: 'high' },
    ebook: { maxFileSize: 150*MB, mobileMaxFileSize: 75*MB, maxTotalSize: 400*MB, mobileMaxTotalSize: 180*MB, maxFiles: 15, warningThreshold: 60*MB, memoryIntensity: 'medium' },
    archive: { maxFileSize: 300*MB, mobileMaxFileSize: 120*MB, maxTotalSize: 750*MB, mobileMaxTotalSize: 300*MB, maxFiles: 20, warningThreshold: 150*MB, memoryIntensity: 'high' },
    audio: { maxFileSize: 300*MB, mobileMaxFileSize: 120*MB, maxTotalSize: 750*MB, mobileMaxTotalSize: 300*MB, maxFiles: 20, warningThreshold: 150*MB, memoryIntensity: 'high' },
    video: { maxFileSize: 750*MB, mobileMaxFileSize: 250*MB, maxTotalSize: 1.5*GB, mobileMaxTotalSize: 500*MB, maxFiles: 10, warningThreshold: 300*MB, memoryIntensity: 'very-high' },
    mergeVideo: { maxFileSize: 500*MB, mobileMaxFileSize: 180*MB, maxTotalSize: 1.5*GB, mobileMaxTotalSize: 450*MB, maxFiles: 10, warningThreshold: 250*MB, memoryIntensity: 'very-high' },
    trimVideo: { maxFileSize: 1*GB, mobileMaxFileSize: 300*MB, maxTotalSize: 1*GB, mobileMaxTotalSize: 300*MB, maxFiles: 1, warningThreshold: 400*MB, memoryIntensity: 'very-high' },
    streamingLarge: { maxFileSize: 1*GB, mobileMaxFileSize: 350*MB, maxTotalSize: 2*GB, mobileMaxTotalSize: 700*MB, maxFiles: 20, warningThreshold: 500*MB, memoryIntensity: 'low' }
  };

  var TOOL_LIMIT_PROFILE = {
    compress: 'imageHeavy', signature: 'imageHeavy', crop: 'imageHeavy', convert: 'imageHeavy',
    removeObjects: 'imageHeavy', batchCompress: 'imageHeavy', socialCrop: 'imageHeavy',
    docPhoto: 'imageHeavy', censor: 'imageHeavy', rescueDoc: 'imageHeavy',
    fileCompliance: 'imageHeavy', workflow: 'imageHeavy', advancedConvert: 'imageHeavy',
    imagesPdf: 'imageHeavy', enhanceScannedDocument: 'imageHeavy', imageTableToExcel: 'imageHeavy',
    stripMetadata: 'imageLight', fixFormat: 'imageLight',
    cameraDocumentScanner: 'imageHeavy',
    mergePdf: 'pdfLight', splitPdf: 'pdfLight', reorderPdf: 'pdfLight', rotatePdf: 'pdfLight',
    deletePagesPdf: 'pdfLight', reversePagesPdf: 'pdfLight', duplicatePagesPdf: 'pdfLight',
    insertBlankPagesPdf: 'pdfLight', editMetadataPdf: 'pdfLight', interleavePdf: 'pdfLight',
    bookletPdf: 'pdfLight', watermarkPdf: 'pdfLight', addPageNumbersPdf: 'pdfLight',
    addHeaderFooterPdf: 'pdfLight', pdfPageCounter: 'pdfLight', pdfEncryptAdvanced: 'pdfLight',
    pdfToImages: 'pdfHeavy', signPdf: 'pdfHeavy', compressPdf: 'pdfHeavy',
    cropPdf: 'pdfHeavy', resizePdfPages: 'pdfHeavy', nUpPdf: 'pdfHeavy',
    splitDoublePdf: 'pdfHeavy', pdfTablesToExcel: 'pdfHeavy',
    wordToPdf: 'office', wordToJpg: 'office', wordToPng: 'office', wordToTxt: 'office',
    wordToHtml: 'office', wordToMarkdown: 'office', wordToEpub: 'office', wordToOdt: 'office',
    odtToWord: 'office', rtfToWord: 'office', mergeWord: 'office', splitWord: 'office',
    repairWord: 'office', compressWord: 'office', stripMetadataWord: 'office',
    formatDocument: 'office', tocWord: 'office', extractWord: 'office',
    findReplaceWord: 'office', tablesWordToExcel: 'office', removeBlankPagesWord: 'office',
    txtToPdf: 'textData', txtToEpub: 'textData', mergeTxt: 'textData', splitTxt: 'textData',
    sortLines: 'textData', removeDuplicates: 'textData', listToTable: 'textData',
    epubToTxt: 'ebook', epubToHtml: 'ebook', epubToMarkdown: 'ebook', mergeEpub: 'ebook',
    splitEpub: 'ebook', editMetadataEpub: 'ebook', coverEpub: 'ebook', imagesEpub: 'ebook',
    validateEpub: 'ebook', repairEpub: 'ebook',
    csvToExcel: 'spreadsheet', excelToCsv: 'spreadsheet', excelToJson: 'spreadsheet',
    csvToJson: 'spreadsheet', mergeExcel: 'spreadsheet', splitExcel: 'spreadsheet',
    compareExcel: 'spreadsheet', xlsToXlsx: 'spreadsheet', xlsxToOds: 'spreadsheet',
    odsToXlsx: 'spreadsheet',
    csvToMarkdown: 'spreadsheet', csvToHtml: 'spreadsheet', csvToYaml: 'spreadsheet',
    excelToHtml: 'spreadsheet', excelToMarkdown: 'spreadsheet', excelToXml: 'spreadsheet',
    xmlToExcel: 'spreadsheet', csvStatistics: 'spreadsheet', csvFilter: 'spreadsheet',
    csvSort: 'spreadsheet', csvToSql: 'spreadsheet', jsonFormatter: 'spreadsheet',
    jsonValidator: 'spreadsheet',
    jsonToExcel: 'structuredDataHeavy', jsonToCsv: 'structuredDataHeavy',
    xmlToJson: 'structuredDataHeavy', jsonToXml: 'structuredDataHeavy',
    unzipFile: 'archive', createZipAdvanced: 'archive', zipRepair: 'archive',
    checksumFile: 'streamingLarge', fileSplit: 'streamingLarge',
    fileJoin: 'streamingLarge', fileInspector: 'streamingLarge',
    qrGenerate: 'default', qrWifi: 'default', qrVcard: 'default', barcodeGenerate: 'default',
    qrReadFromImage: 'imageHeavy', barcodeReadFromImage: 'imageHeavy',
    qrBatchFromCsv: 'spreadsheet', colorPicker: 'imageHeavy', imageCompare: 'imageHeavy',
    compressVideo: 'video', trimVideo: 'trimVideo', mergeVideos: 'mergeVideo',
    videoToGif: 'video', extractAudioFromVideo: 'video', removeAudioFromVideo: 'video',
    convertAudio: 'audio', trimAudio: 'audio', mergeAudio: 'audio',
    inspectFileMetadata: 'streamingLarge', encryptDecryptFile: 'streamingLarge',
    photoLocationExtractor: 'imageHeavy',
    simpleCalculator: 'textData', scientificCalculator: 'textData',
    textToUnicodeBraille: 'textData', formatDocumentApa7: 'textData',
    textStatistics: 'textData', wordCount: 'textData', textDiff: 'textData',
    htmlToMarkdown: 'textData', htmlToText: 'textData', cssMinifier: 'textData',
    base64Encode: 'textData', base64Decode: 'textData', urlEncode: 'textData', urlDecode: 'textData',
    scannedPdfToSearchablePdf: 'pdfHeavy', imageToSearchablePdf: 'pdfHeavy',
    extractTextFromScannedPdf: 'pdfHeavy', detectOcrNeeded: 'pdfLight',
    censorPdf: 'pdfHeavy', verifyPdfCensor: 'pdfHeavy', comparePdfs: 'pdfHeavy',
  };

  var TOOL_LIMIT_OVERRIDES = {
    signature: { maxFiles: 1, maxFileSize: 40*MB, mobileMaxFileSize: 20*MB },
    crop: { maxFiles: 1 },
    removeObjects: { maxFiles: 1, maxFileSize: 50*MB, mobileMaxFileSize: 20*MB },
    docPhoto: { maxFiles: 1 },
    censor: { maxFiles: 1 },
    signPdf: { maxFiles: 1 },
    cropPdf: { maxFiles: 1 },
    resizePdfPages: { maxFiles: 1 },
    trimVideo: { maxFiles: 1 },
    extractAudioFromVideo: { maxFiles: 1 },
    removeAudioFromVideo: { maxFiles: 1 },
    trimAudio: { maxFiles: 1 },
    cameraDocumentScanner: { maxFiles: 1 },
    enhanceScannedDocument: { maxFiles: 1 },
    imageTableToExcel: { maxFiles: 1 },
    qrReadFromImage: { maxFiles: 1 },
    barcodeReadFromImage: { maxFiles: 1 },
    colorPicker: { maxFiles: 1 },
    imageCompare: { maxFiles: 2, mobileMaxFileSize: 30*MB },
    textDiff: { maxFiles: 2 },
    pdfTablesToExcel: { maxFiles: 5 },
    batchCompress: { maxFiles: 30, maxTotalSize: 500*MB, mobileMaxTotalSize: 200*MB }
  };

  var ACCEPTS_PROFILE_FALLBACK = {
    image: 'imageHeavy', images: 'imageHeavy', pdf: 'pdfLight', pdfs: 'pdfLight',
    doc: 'office', docs: 'office', odt: 'office', odts: 'office', rtf: 'office', rtfs: 'office',
    txt: 'textData', txts: 'textData', epub: 'ebook', epubs: 'ebook',
    csv: 'spreadsheet', csvs: 'spreadsheet', excel: 'spreadsheet', excels: 'spreadsheet',
    xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
    json: 'structuredDataHeavy', jsons: 'structuredDataHeavy',
    xml: 'structuredDataHeavy', xmls: 'structuredDataHeavy',
    zip: 'archive', any: 'default', none: 'default', parts: 'streamingLarge',
    text: 'textData', texts: 'textData', html: 'textData', css: 'textData',
    audio: 'audio', audios: 'audio', video: 'video', videos: 'video'
  };

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < KB) return bytes + ' B';
    if (bytes < MB) return (bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0) + ' KB';
    if (bytes < GB) {
      var mb = bytes / MB;
      return (mb < 10 ? mb.toFixed(1) : mb.toFixed(0)) + ' MB';
    }
    var gb = bytes / GB;
    return (gb < 10 ? gb.toFixed(2) : gb.toFixed(1)) + ' GB';
  }

  function getDeviceCapabilities() {
    var ua = navigator.userAgent || '';
    var isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    if (!isMobile && navigator.maxTouchPoints > 0 && window.innerWidth < 1024) isMobile = true;
    var deviceMemory = navigator.deviceMemory || null;
    var hardwareConcurrency = navigator.hardwareConcurrency || null;
    var deviceClass = 'unknown';
    if (isMobile) {
      if (deviceMemory && deviceMemory <= 2) deviceClass = 'low-end-mobile';
      else if (deviceMemory && deviceMemory <= 4) deviceClass = 'mid-mobile';
      else if (deviceMemory && deviceMemory >= 8) deviceClass = 'high-end-mobile';
      else deviceClass = 'mobile';
    } else {
      if (deviceMemory && deviceMemory <= 2) deviceClass = 'low-end-desktop';
      else if (deviceMemory && deviceMemory <= 4) deviceClass = 'mid-desktop';
      else if (deviceMemory && deviceMemory >= 8) deviceClass = 'desktop';
      else deviceClass = 'unknown-desktop';
    }
    return { isMobile: isMobile, deviceMemory: deviceMemory, hardwareConcurrency: hardwareConcurrency, deviceClass: deviceClass };
  }

  function getToolFileLimits(toolId, accepts) {
    var profileName = TOOL_LIMIT_PROFILE[toolId] || ACCEPTS_PROFILE_FALLBACK[accepts] || 'default';
    var base = FILE_LIMIT_PROFILES[profileName];
    var limits = {};
    var key;
    for (key in base) {
      if (base.hasOwnProperty(key)) limits[key] = base[key];
    }
    var overrides = TOOL_LIMIT_OVERRIDES[toolId];
    if (overrides) {
      for (key in overrides) {
        if (overrides.hasOwnProperty(key)) limits[key] = overrides[key];
      }
    }
    var caps = getDeviceCapabilities();
    if (caps.isMobile) {
      limits.maxFileSize = limits.mobileMaxFileSize;
      limits.maxTotalSize = limits.mobileMaxTotalSize;
    }
    if (caps.deviceMemory && caps.deviceMemory <= 2) {
      limits.maxFileSize = Math.floor(limits.maxFileSize * 0.5);
      limits.maxTotalSize = Math.floor(limits.maxTotalSize * 0.5);
    }
    limits._profile = profileName;
    return limits;
  }

  function validateIncomingFiles(options) {
    var incomingFiles = options.incomingFiles || [];
    var existingFiles = options.existingFiles || [];
    var toolId = options.toolId || '';
    var accepts = options.accepts || '';
    var limits = getToolFileLimits(toolId, accepts);
    var acceptedFiles = [];
    var rejectedFiles = [];
    var warnings = [];
    var existingTotalSize = 0;
    var i;
    for (i = 0; i < existingFiles.length; i++) {
      existingTotalSize += existingFiles[i].size || 0;
    }
    var runningCount = existingFiles.length;
    var runningTotalSize = existingTotalSize;
    for (i = 0; i < incomingFiles.length; i++) {
      var file = incomingFiles[i];
      if (file.size > limits.maxFileSize) {
        rejectedFiles.push({ file: file, reason: 'FILE_TOO_LARGE', message: 'El archivo excede el l\u00edmite de ' + formatFileSize(limits.maxFileSize) + ' para esta herramienta.' });
        continue;
      }
      if (runningCount >= limits.maxFiles) {
        rejectedFiles.push({ file: file, reason: 'MAX_FILES_EXCEEDED', message: 'Solo se permiten ' + limits.maxFiles + ' archivos para esta herramienta.' });
        continue;
      }
      if (runningTotalSize + file.size > limits.maxTotalSize) {
        rejectedFiles.push({ file: file, reason: 'TOTAL_SIZE_EXCEEDED', message: 'El total de archivos excede el l\u00edmite de ' + formatFileSize(limits.maxTotalSize) + '.' });
        continue;
      }
      if (file.size > limits.warningThreshold) {
        warnings.push({ file: file, message: 'El archivo ' + formatFileSize(file.size) + ' es pesado. El procesamiento puede ser lento.' });
      }
      acceptedFiles.push(file);
      runningCount++;
      runningTotalSize += file.size;
    }
    return { acceptedFiles: acceptedFiles, rejectedFiles: rejectedFiles, warnings: warnings, limits: limits };
  }

  function getSizeBucket(bytes) {
    if (bytes <= 10 * MB) return '0-10mb';
    if (bytes <= 25 * MB) return '10-25mb';
    if (bytes <= 50 * MB) return '25-50mb';
    if (bytes <= 100 * MB) return '50-100mb';
    if (bytes <= 250 * MB) return '100-250mb';
    if (bytes <= 500 * MB) return '250-500mb';
    if (bytes <= GB) return '500mb-1gb';
    return '1gb-plus';
  }

  // TLT-041 — Validación por firma interna (magic bytes), no solo MIME/extensión.
  // MP4/MOV se detecta por 'ftyp' a offset 4 o 8 (no por hex fijo que depende del box size).
  var SIGNATURES = [
    { hex: '89504e47', label: 'PNG' },
    { hex: 'ffd8ff', label: 'JPEG' },
    { hex: '47494638', label: 'GIF' },
    { hex: '52494646', label: 'WEBP' },
    { hex: '25504446', label: 'PDF' },
    { hex: '504b0304', label: 'ZIP/DOCX/XLSX/EPUB' },
    { hex: '504b0506', label: 'ZIP (vacío)' },
    { hex: '52617221', label: 'RAR' },
    { hex: '377abcaf', label: '7Z' },
    { hex: '1f8b', label: 'GZIP' },
    { hex: '425a68', label: 'BZ2' },
    { hex: 'd0cf11e0', label: 'OLE/DOC/XLS' },
    { hex: 'efbbbf', label: 'TXT-UTF8' },
    { hex: '1a45dfa3', label: 'MKV/WebM' },
    { hex: '49492a00', label: 'TIFF-LE' },
    { hex: '4d4d002a', label: 'TIFF-BE' },
    { hex: '4f676753', label: 'OGG' },
    { hex: '494433', label: 'MP3' }
  ];

  function detectMp4Mov(hex) {
    var ftyp = '66747970';
    return hex.length >= 16 && (hex.indexOf(ftyp, 8) === 4 || hex.indexOf(ftyp, 8) === 8 || hex.indexOf(ftyp, 8) === 12);
  }

  function readHeaderHex(file, maxBytes) {
    var n = maxBytes || 16;
    return file.slice(0, n).arrayBuffer().then(function(buffer) {
      var arr = new Uint8Array(buffer);
      var hex = '';
      for (var i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, '0');
      }
      return hex;
    });
  }

  function detectSignature(hex) {
    for (var i = 0; i < SIGNATURES.length; i++) {
      if (hex.indexOf(SIGNATURES[i].hex) === 0) return SIGNATURES[i].label;
    }
    if (detectMp4Mov(hex)) return 'MP4/MOV';
    return '';
  }

  function expectedSignaturesFor(file) {
    var name = String(file.name || '').toLowerCase();
    if (file.type === 'image/png' || name.endsWith('.png')) return ['PNG'];
    if (file.type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return ['JPEG'];
    if (file.type === 'image/gif' || name.endsWith('.gif')) return ['GIF'];
    if (file.type === 'image/webp' || name.endsWith('.webp')) return ['WEBP'];
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return ['PDF'];
    if (file.type === 'application/epub+zip' || name.endsWith('.epub')) return ['ZIP/DOCX/XLSX/EPUB'];
    if (name.endsWith('.zip')) return ['ZIP/DOCX/XLSX/EPUB', 'ZIP (vacío)'];
    if (name.endsWith('.docx') || name.endsWith('.xlsx')) return ['ZIP/DOCX/XLSX/EPUB'];
    if (name.endsWith('.doc') || name.endsWith('.xls')) return ['OLE/DOC/XLS'];
    if (file.type === 'text/plain' || /\.(txt|log|md|csv)$/.test(name)) return ['TXT-UTF8', ''];
    if (file.type === 'video/mp4' || name.endsWith('.mp4')) return ['MP4/MOV'];
    if (file.type === 'video/quicktime' || name.endsWith('.mov')) return ['MP4/MOV'];
    if (file.type === 'video/webm' || name.endsWith('.webm') || name.endsWith('.mkv')) return ['MKV/WebM'];
    if (file.type === 'audio/mpeg' || name.endsWith('.mp3')) return ['MP3'];
    if (file.type === 'audio/wav' || name.endsWith('.wav')) return ['WAV'];
    return [];
  }

  function verifySignature(file) {
    // Returns a Promise<{ ok, detected, expected, reason }>. Sin firma
    // esperada conocida => ok (no se puede falsificar lo que no esperamos).
    return readHeaderHex(file).then(function(hex) {
      var detected = detectSignature(hex);
      var expected = expectedSignaturesFor(file);
      if (!expected.length) return { ok: true, detected: detected, expected: expected, reason: '' };
      var matches = expected.indexOf(detected) !== -1;
      return {
        ok: matches,
        detected: detected,
        expected: expected,
        reason: matches ? '' : 'La firma interna (' + (detected || 'desconocida') + ') no coincide con la extensi\u00f3n/MIME declarado (' + expected.join(', ') + ').'
      };
    });
  }

  window.FileLimits = {
    KB: KB,
    MB: MB,
    GB: GB,
    PROFILES: FILE_LIMIT_PROFILES,
    TOOL_PROFILE: TOOL_LIMIT_PROFILE,
    TOOL_OVERRIDES: TOOL_LIMIT_OVERRIDES,
    formatFileSize: formatFileSize,
    getDeviceCapabilities: getDeviceCapabilities,
    getToolFileLimits: getToolFileLimits,
    validateIncomingFiles: validateIncomingFiles,
    getSizeBucket: getSizeBucket,
    detectSignature: detectSignature,
    verifySignature: verifySignature
  };
})();
