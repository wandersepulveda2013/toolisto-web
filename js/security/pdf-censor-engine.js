(function () {
  'use strict';

  function ensureLibs() {
    if (!window.pdfjsLib) {
      throw new Error('pdf.js no está cargado (window.pdfjsLib)');
    }
    if (!window.PDFLib) {
      throw new Error('PDF-Lib no está cargado (window.PDFLib)');
    }
  }

  async function loadDocument(arrayBuffer) {
    ensureLibs();
    var loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    return await loadingTask.promise;
  }

  function itemBbox(item) {
    var tx = window.pdfjsLib.Util.transform(
      window.pdfjsLib.Util.transform(
        item.transform,
        [1, 0, 0, 1, 0, 0]
      ),
      [1, 0, 0, 1, 0, 0]
    );
    var fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
    return {
      x: tx[4],
      y: tx[5] - fontHeight,
      width: item.width,
      height: fontHeight
    };
  }

  async function renderPage(arrayBuffer, pageNumber, scale) {
    ensureLibs();
    var doc = await loadDocument(arrayBuffer);
    var totalPages = doc.numPages;
    if (pageNumber < 1 || pageNumber > totalPages) {
      throw new Error('Número de página inválido: ' + pageNumber + ' (total: ' + totalPages + ')');
    }
    var page = await doc.getPage(pageNumber);
    var viewport = page.getViewport({ scale: scale || 2 });

    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    var textContent = await page.getTextContent();

    return {
      canvas: canvas,
      textContent: textContent,
      width: viewport.width,
      height: viewport.height
    };
  }

  async function searchText(arrayBuffer, searchTerm, options) {
    ensureLibs();
    if (!searchTerm || typeof searchTerm !== 'string') {
      throw new Error('El término de búsqueda debe ser una cadena no vacía');
    }

    var opts = options || {};
    var caseSensitive = opts.caseSensitive === true;
    var useRegex = opts.useRegex === true;
    var wholeWord = opts.wholeWord === true;

    var doc = await loadDocument(arrayBuffer);
    var matches = [];
    var totalCount = 0;

    var pattern = null;
    if (useRegex) {
      var flags = caseSensitive ? 'g' : 'gi';
      try {
        pattern = new RegExp(searchTerm, flags);
      } catch (e) {
        throw new Error('Expresión regular inválida: ' + e.message);
      }
    }

    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var textContent = await page.getTextContent();

      var pageText = '';
      var items = textContent.items;
      for (var i = 0; i < items.length; i++) {
        pageText += items[i].str + ' ';
      }

      var searchText = caseSensitive ? pageText : pageText.toLowerCase();
      var target = caseSensitive ? searchTerm : searchTerm.toLowerCase();

      if (useRegex) {
        var re = new RegExp(searchTerm, caseSensitive ? 'g' : 'gi');
        var match;
        while ((match = re.exec(pageText)) !== null) {
          var matchStr = match[0];
          var matchStart = match.index;
          var matchEnd = matchStart + matchStr.length;

          var bbox = findBBoxForRange(items, matchStart, matchEnd);
          if (bbox) {
            matches.push({
              pageNumber: p,
              text: matchStr,
              bbox: bbox
            });
            totalCount++;
          }
        }
      } else if (wholeWord) {
        var wordRe = new RegExp('\\b' + escapeRegex(target) + '\\b', caseSensitive ? 'g' : 'gi');
        var wordMatch;
        while ((wordMatch = wordRe.exec(pageText)) !== null) {
          var wStr = wordMatch[0];
          var wStart = wordMatch.index;
          var wEnd = wStart + wStr.length;
          var wBbox = findBBoxForRange(items, wStart, wEnd);
          if (wBbox) {
            matches.push({
              pageNumber: p,
              text: wStr,
              bbox: wBbox
            });
            totalCount++;
          }
        }
      } else {
        var idx = searchText.indexOf(target);
        while (idx !== -1) {
          var mText = pageText.substring(idx, idx + target.length);
          var mBbox = findBBoxForRange(items, idx, idx + target.length);
          if (mBbox) {
            matches.push({
              pageNumber: p,
              text: mText,
              bbox: mBbox
            });
            totalCount++;
          }
          idx = searchText.indexOf(target, idx + 1);
        }
      }
    }

    return { matches: matches, totalCount: totalCount };
  }

  function findBBoxForRange(items, startOffset, endOffset) {
    var chars = [];
    var offset = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var str = item.str || '';
      for (var c = 0; c < str.length; c++) {
        var charOffset = offset + c;
        if (charOffset >= startOffset && charOffset < endOffset) {
          var bbox = itemBbox(item);
          chars.push({
            x: bbox.x + (c / str.length) * bbox.width,
            y: bbox.y,
            width: bbox.width / str.length,
            height: bbox.height
          });
        }
      }
      offset += str.length;
    }

    if (chars.length === 0) {
      return null;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var j = 0; j < chars.length; j++) {
      if (chars[j].x < minX) minX = chars[j].x;
      if (chars[j].y < minY) minY = chars[j].y;
      if (chars[j].x + chars[j].width > maxX) maxX = chars[j].x + chars[j].width;
      if (chars[j].y + chars[j].height > maxY) maxY = chars[j].y + chars[j].height;
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyManualRedaction(canvas, textContent, zones) {
    if (!canvas || !canvas.getContext) {
      throw new Error('Se requiere un canvas válido');
    }
    if (!zones || !zones.length) {
      throw new Error('Se requiere al menos una zona de redacción');
    }

    var ctx = canvas.getContext('2d');
    var defaultColor = '#000000';

    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var pad = z.padding || 0;
      ctx.fillStyle = z.color || defaultColor;
      ctx.fillRect(z.x - pad, z.y - pad, z.width + pad * 2, z.height + pad * 2);
    }

    return canvas;
  }

  function applyWordRedaction(canvas, textContent, searchTerm, options) {
    if (!canvas || !canvas.getContext) {
      throw new Error('Se requiere un canvas válido');
    }
    if (!searchTerm || typeof searchTerm !== 'string') {
      throw new Error('El término de búsqueda debe ser una cadena no vacía');
    }

    var opts = options || {};
    var color = opts.color || '#000000';
    var padding = typeof opts.padding === 'number' ? opts.padding : 2;
    var caseSensitive = opts.caseSensitive === true;

    var ctx = canvas.getContext('2d');
    var items = textContent.items;
    var redactedCount = 0;

    var target = caseSensitive ? searchTerm : searchTerm.toLowerCase();

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var str = item.str || '';
      var searchStr = caseSensitive ? str : str.toLowerCase();

      if (searchStr.indexOf(target) !== -1) {
        var bbox = itemBbox(item);
        ctx.fillStyle = color;
        ctx.fillRect(
          bbox.x - padding,
          bbox.y - padding,
          bbox.width + padding * 2,
          bbox.height + padding * 2
        );
        redactedCount++;
      }
    }

    return { canvas: canvas, redactedCount: redactedCount };
  }

  var BUILTIN_PATTERNS = {
    email: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    phone: '(?:\\+?\\d{1,3}[\\s\\-]?)?(?:\\(?\\d{2,4}\\)?[\\s\\-]?)?\\d{3,4}[\\s\\-]?\\d{3,4}',
    id: '\\b\\d{1,3}[\\.\\-]?\\d{3}[\\.\\-]?\\d{3}[\\-]?\\d{1,2}\\b',
    creditcard: '\\b\\d{4}[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}\\b'
  };

  function applyPatternRedaction(canvas, textContent, patterns) {
    if (!canvas || !canvas.getContext) {
      throw new Error('Se requiere un canvas válido');
    }
    if (!patterns || !patterns.length) {
      throw new Error('Se requiere al menos un patrón de redacción');
    }

    var ctx = canvas.getContext('2d');
    var items = textContent.items;
    var redactedCount = 0;

    for (var p = 0; p < patterns.length; p++) {
      var pat = patterns[p];
      var regexStr;

      if (pat.regex) {
        regexStr = pat.regex;
      } else if (pat.type && BUILTIN_PATTERNS[pat.type]) {
        regexStr = BUILTIN_PATTERNS[pat.type];
      } else {
        continue;
      }

      var color = pat.color || '#000000';
      var pad = typeof pat.padding === 'number' ? pat.padding : 2;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var str = item.str || '';
        var re = new RegExp(regexStr, 'gi');
        var match;

        while ((match = re.exec(str)) !== null) {
          var bbox = itemBbox(item);
          var charWidth = bbox.width / str.length;
          var matchX = bbox.x + match.index * charWidth;
          var matchW = match[0].length * charWidth;

          ctx.fillStyle = color;
          ctx.fillRect(
            matchX - pad,
            bbox.y - pad,
            matchW + pad * 2,
            bbox.height + pad * 2
          );
          redactedCount++;
        }
      }
    }

    return { canvas: canvas, redactedCount: redactedCount };
  }

  async function buildRedactedPdf(pages) {
    ensureLibs();
    if (!pages || !pages.length) {
      throw new Error('Se requiere al menos una página para construir el PDF');
    }

    var PDFLib = window.PDFLib;
    var pdfDoc = await PDFLib.PDFDocument.create();

    for (var i = 0; i < pages.length; i++) {
      var pageData = pages[i];
      var canvas = pageData.canvas;

      if (!canvas || !canvas.getContext) {
        throw new Error('Página ' + (i + 1) + ': se requiere un canvas válido');
      }

      var imageBlob = await new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          resolve(blob);
        }, 'image/png');
      });

      if (!imageBlob) {
        throw new Error('Página ' + (i + 1) + ': error al convertir canvas a imagen');
      }

      var imageArrayBuffer = await imageBlob.arrayBuffer();
      var image = await pdfDoc.embedPng(imageArrayBuffer);

      var origW = pageData.originalWidth || canvas.width;
      var origH = pageData.originalHeight || canvas.height;

      var page = pdfDoc.addPage([origW, origH]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: origW,
        height: origH
      });
    }

    var pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  async function verifyRedaction(originalBuffer, redactedBuffer) {
    ensureLibs();
    if (!originalBuffer || !redactedBuffer) {
      throw new Error('Se requieren ambos buffers para la verificación');
    }

    var warnings = [];
    var safe = true;
    var details = '';

    try {
      var origDoc = await loadDocument(originalBuffer);
      var redDoc = await loadDocument(redactedBuffer);

      var originalTexts = [];

      for (var i = 1; i <= origDoc.numPages; i++) {
        var origPage = await origDoc.getPage(i);
        var origText = await origPage.getTextContent();
        var pageFullText = '';
        for (var j = 0; j < origText.items.length; j++) {
          pageFullText += origText.items[j].str + ' ';
        }
        originalTexts.push({
          pageNumber: i,
          text: pageFullText.trim()
        });
      }

      var redactedTexts = [];

      for (var k = 1; k <= redDoc.numPages; k++) {
        var redPage = await redDoc.getPage(k);
        var redText = await redPage.getTextContent();
        var redFullText = '';
        for (var l = 0; l < redText.items.length; l++) {
          redFullText += redText.items[l].str + ' ';
        }
        redactedTexts.push({
          pageNumber: k,
          text: redFullText.trim()
        });
      }

      if (redDoc.numPages < origDoc.numPages) {
        warnings.push('El PDF redactado tiene menos páginas (' + redDoc.numPages + ') que el original (' + origDoc.numPages + ')');
      }

      for (var m = 0; m < redactedTexts.length; m++) {
        var redContent = redactedTexts[m].text;
        if (redContent && redContent.length > 0) {
          var origEntry = originalTexts[m];
          if (origEntry && origEntry.text && origEntry.text.length > 0) {
            var origWords = origEntry.text.split(/\s+/);
            for (var w = 0; w < origWords.length; w++) {
              var word = origWords[w];
              if (word.length > 3 && redContent.indexOf(word) !== -1) {
                warnings.push('Posible fuga en página ' + redactedTexts[m].pageNumber + ': texto "' + word + '" aún presente');
                safe = false;
              }
            }
          }
        }
      }

      if (safe) {
        details = 'Verificación completada. El PDF redactado no contiene texto del original que deba ser eliminado (' + redactedTexts.length + ' páginas verificadas)';
      } else {
        details = 'Se encontraron posibles fugas de información en el PDF redactado. Revise las advertencias.';
      }
    } catch (e) {
      safe = false;
      details = 'Error durante la verificación: ' + e.message;
      warnings.push('No se pudo completar la verificación completa: ' + e.message);
    }

    return {
      safe: safe,
      details: details,
      warnings: warnings
    };
  }

  window.PdfCensorEngine = {
    renderPage: renderPage,
    searchText: searchText,
    applyManualRedaction: applyManualRedaction,
    applyWordRedaction: applyWordRedaction,
    applyPatternRedaction: applyPatternRedaction,
    buildRedactedPdf: buildRedactedPdf,
    verifyRedaction: verifyRedaction
  };
})();