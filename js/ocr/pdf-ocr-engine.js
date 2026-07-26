'use strict';

window.PdfOcrEngine = (function () {

  function loadPdf(arrayBuffer) {
    return window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  }

  function ensureLanguage(language) {
    return language || 'spa';
  }

  async function detectNeedsOcr(arrayBuffer, onProgress) {
    try {
      var pdf = await loadPdf(arrayBuffer);
      var totalPages = pdf.numPages;
      var pagesWithText = 0;
      var pagesNeedingOcr = [];

      for (var i = 1; i <= totalPages; i++) {
        if (onProgress) {
          onProgress({ current: i, total: totalPages, phase: 'detection' });
        }

        var page = await pdf.getPage(i);
        var textContent = await page.getTextContent();
        var items = textContent.items || [];
        var totalChars = 0;

        for (var j = 0; j < items.length; j++) {
          totalChars += (items[j].str || '').length;
        }

        if (items.length >= 5 && totalChars >= 50) {
          pagesWithText++;
        } else {
          pagesNeedingOcr.push(i);
        }
      }

      return {
        needsOcr: pagesNeedingOcr.length > 0,
        totalPages: totalPages,
        pagesWithText: pagesWithText,
        pagesNeedingOcr: pagesNeedingOcr
      };
    } catch (err) {
      throw new Error('Error al detectar OCR: ' + (err.message || err));
    }
  }

  async function renderPageToCanvas(arrayBuffer, pageNumber, scale) {
    try {
      var s = typeof scale === 'number' && scale > 0 ? scale : 2;
      var pdf = await loadPdf(arrayBuffer);
      var page = await pdf.getPage(pageNumber);
      var viewport = page.getViewport({ scale: s });

      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      return {
        canvas: canvas,
        width: viewport.width,
        height: viewport.height,
        viewport: viewport
      };
    } catch (err) {
      throw new Error('Error al renderizar página: ' + (err.message || err));
    }
  }

  async function ocrCanvas(canvas, language, onProgress) {
    try {
      var lang = ensureLanguage(language);
      var worker = await window.EngineLoader.loadTesseract(lang, onProgress);
      var result = await worker.recognize(canvas);
      var words = [];

      if (result.data && result.data.words) {
        var rawWords = result.data.words;
        for (var i = 0; i < rawWords.length; i++) {
          var w = rawWords[i];
          words.push({
            text: w.text || '',
            bbox: {
              x0: w.bbox ? w.bbox.x0 : 0,
              y0: w.bbox ? w.bbox.y0 : 0,
              x1: w.bbox ? w.bbox.x1 : 0,
              y1: w.bbox ? w.bbox.y1 : 0
            },
            confidence: typeof w.confidence === 'number' ? w.confidence : 0
          });
        }
      }

      var text = (result.data && result.data.text) ? result.data.text : '';
      var confidence = (result.data && result.data.confidence) ? result.data.confidence : 0;

      return {
        text: text,
        confidence: confidence,
        words: words
      };
    } catch (err) {
      throw new Error('Error al ejecutar OCR: ' + (err.message || err));
    }
  }

  async function createSearchablePdf(pages, language, options, onProgress) {
    try {
      var doc = await window.PDFLib.PDFDocument.create();

      for (var i = 0; i < pages.length; i++) {
        if (onProgress) {
          onProgress({ current: i + 1, total: pages.length, phase: 'creacion' });
        }

        var p = pages[i];
        var imageBytes = new Uint8Array(await p.imageBlob.arrayBuffer());

        var image;
        if (p.imageBlob.type && p.imageBlob.type.indexOf('png') !== -1) {
          image = await doc.embedPng(imageBytes);
        } else {
          image = await doc.embedJpg(imageBytes);
        }

        var pageWidth = p.width / 2;
        var pageHeight = p.height / 2;
        var page = doc.addPage([pageWidth, pageHeight]);

        page.drawImage(image, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight
        });

        if (p.ocrText && p.ocrText.trim().length > 0) {
          var font = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);

          page.drawText(p.ocrText, {
            x: 0,
            y: pageHeight - 12,
            size: 1,
            font: font,
            color: window.PDFLib.rgb(1, 1, 1),
            width: pageWidth,
            lineHeight: 1
          });
        }
      }

      var pdfBytes = await doc.save();
      return new Blob([pdfBytes], { type: 'application/pdf' });
    } catch (err) {
      throw new Error('Error al crear PDF searchable: ' + (err.message || err));
    }
  }

  async function extractTextFromPage(arrayBuffer, pageNumber, language, onProgress) {
    try {
      var pdf = await loadPdf(arrayBuffer);
      var pageCount = pdf.numPages;
      var page = await pdf.getPage(pageNumber);
      var textContent = await page.getTextContent();
      var items = textContent.items || [];
      var totalChars = 0;

      for (var j = 0; j < items.length; j++) {
        totalChars += (items[j].str || '').length;
      }

      if (items.length >= 5 && totalChars >= 50) {
        var existingText = '';
        for (var k = 0; k < items.length; k++) {
          existingText += items[k].str || '';
        }
        return { text: existingText, confidence: 100, pageCount: pageCount };
      }

      var rendered = await renderPageToCanvas(arrayBuffer, pageNumber, 2);
      var ocrResult = await ocrCanvas(rendered.canvas, language, onProgress);

      return {
        text: ocrResult.text,
        confidence: ocrResult.confidence,
        pageCount: pageCount
      };
    } catch (err) {
      throw new Error('Error al extraer texto: ' + (err.message || err));
    }
  }

  return {
    detectNeedsOcr: detectNeedsOcr,
    renderPageToCanvas: renderPageToCanvas,
    ocrCanvas: ocrCanvas,
    createSearchablePdf: createSearchablePdf,
    extractTextFromPage: extractTextFromPage
  };

})();
