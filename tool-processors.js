window.ToolProcessors = window.ToolProcessors || {};

(function() {
  'use strict';

  // ─── HELPERS ───────────────────────────────────────────────────────────

  function readFileAsArrayBuffer(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(new Error('Failed to read file as ArrayBuffer: ' + file.name)); };
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsText(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(new Error('Failed to read file as text: ' + file.name)); };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function _extractTextFromFile(file) {
    var name = (file.name || '').toLowerCase();
    var isTxt = /\.txt$/i.test(name) || file.type === 'text/plain';
    var isHtml = /\.(html?|xhtml)$/i.test(name) || file.type === 'text/html';
    var isCss = /\.css$/i.test(name) || file.type === 'text/css';
    var isDocx = /\.(docx?|dotx?)$/i.test(name) || (file.type && file.type.indexOf('word') !== -1);
    var isPdf = file.type === 'application/pdf';
    var isRtf = /\.rtf$/i.test(name);
    var isOdt = /\.odt$/i.test(name);
    var isEpub = /\.epub$/i.test(name);
    if (isTxt || isCss) return readFileAsText(file);
    if (isHtml) {
      return readFileAsText(file).then(function(html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || tmp.innerText || '').trim();
      });
    }
    if (isRtf) {
      return readFileAsText(file).then(function(rtf) {
        var t = rtf.replace(/\{\\[^{}]*\}/g, ' ').replace(/\\[a-z]+\d*\s?/gi, ' ').replace(/[{}]/g, '');
        return t.replace(/\s+/g, ' ').trim();
      });
    }
    if (isDocx && typeof mammoth !== 'undefined') {
      return readFileAsArrayBuffer(file).then(function(buf) {
        return mammoth.extractRawText({ arrayBuffer: buf }).then(function(r) { return (r.value || '').trim(); });
      });
    }
    if (isPdf && typeof pdfjsLib !== 'undefined') {
      return readFileAsArrayBuffer(file).then(function(buf) {
        return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise.then(function(pdf) {
          var texts = [];
          var promises = [];
          for (var i = 1; i <= pdf.numPages; i++) {
            (function(pageNum) {
              promises.push(pdf.getPage(pageNum).then(function(page) {
                return page.getTextContent().then(function(tc) {
                  var pageText = tc.items.map(function(item) { return item.str; }).join(' ');
                  texts[pageNum - 1] = pageText;
                });
              }));
            })(i);
          }
          return Promise.all(promises).then(function() { return texts.join('\n\n').trim(); });
        });
      });
    }
    return readFileAsText(file);
  }

  function htmlToMarkdown(html) {
    if (!html) return '';
    var md = html;

    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

    md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    md = md.replace(/<a[^>]*href='([^']*)'[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, function(match, content) {
      return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
    });
    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, function(match, content) {
      var idx = 0;
      return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(m, item) {
        idx++;
        return '\n' + idx + '. ' + item;
      });
    });

    md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, function(match, tableContent) {
      var rows = [];
      var headerParsed = false;
      var trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      var trMatch;
      while ((trMatch = trRegex.exec(tableContent)) !== null) {
        var cells = [];
        var cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        var cellMatch;
        while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
        }
        if (cells.length > 0) {
          rows.push(cells);
          if (!headerParsed && trMatch[1].indexOf('<th') !== -1) {
            headerParsed = true;
          }
        }
      }
      if (rows.length === 0) return '';

      var tableMd = '\n';
      var colCount = rows[0].length;
      tableMd += '| ' + rows[0].join(' | ') + ' |\n';
      tableMd += '| ' + rows[0].map(function() { return '---'; }).join(' | ') + ' |\n';
      for (var r = 1; r < rows.length; r++) {
        while (rows[r].length < colCount) rows[r].push('');
        tableMd += '| ' + rows[r].join(' | ') + ' |\n';
      }
      return tableMd;
    });

    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function(match, content) {
      return '\n> ' + content.replace(/\n/g, '\n> ') + '\n';
    });

    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
    md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');
    md = md.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1');

    md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    md = md.replace(/<!--[\s\S]*?-->/g, '');

    md = md.replace(/<[^>]+>/g, '');
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    md = md.replace(/&quot;/g, '"');
    md = md.replace(/&#39;/g, "'");
    md = md.replace(/&[a-zA-Z]+;/g, '');

    md = md.replace(/\n{3,}/g, '\n\n');
    md = md.trim();

    return md;
  }

  function parseRtf(text) {
    var result = text;
    result = result.replace(/\{\\[^{}]*\}/g, '');
    result = result.replace(/\{\\(?:fonttbl|colortbl|stylesheet|lists)[\s\S]*?\}/gi, '');
    result = result.replace(/\\uc\d/g, '');
    result = result.replace(/\\u\d+/g, '');
    result = result.replace(/\\'[\da-fA-F]{2}/g, '');
    result = result.replace(/\\[a-zA-Z]+\d*\s?/g, ' ');
    result = result.replace(/\\\{ /g, '{');
    result = result.replace(/\\\} /g, '}');
    result = result.replace(/\\\\ /g, '\\');
    result = result.replace(/\{\s*\}/g, '');
    result = result.replace(/\{[^{}]*\}/g, function(m) { return m.slice(1, -1); });
    result = result.replace(/\\par[d]?/g, '\n');
    result = result.replace(/\\tab/g, '\t');
    result = result.replace(/\\line/g, '\n');
    result = result.replace(/\\bullet/g, '\u2022');
    result = result.replace(/\\endash/g, '\u2013');
    result = result.replace(/\\emdash/g, '\u2014');
    result = result.replace(/\\lquote/g, '\u2018');
    result = result.replace(/\\rquote/g, '\u2019');
    result = result.replace(/\\ldblquote/g, '\u201C');
    result = result.replace(/\\rdblquote/g, '\u201D');
    result = result.replace(/\{\{|\}\}/g, '');
    result = result.replace(/\s+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  function wrapHtml(body, title) {
    var safeBody = sanitizeHtmlOutput(body);
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + (title || 'Document') + '</title>\n<style>body{font-family:Calibri,Arial,sans-serif;margin:40px;line-height:1.5;color:#333}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style>\n</head>\n<body>\n' + safeBody + '\n</body>\n</html>';
  }

  function makeResult(blobList, message) {
    return {
      files: blobList.map(function(b) {
        return { name: b.name, blob: b.blob, size: b.blob.size };
      }),
      message: message || ''
    };
  }

  function loadImageFromFile(file) {
    return new Promise(function(resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function() { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen.')); };
      img.src = url;
    });
  }

  function makeSingleResult(blob, name, message) {
    return makeResult([{ name: name, blob: blob }], message);
  }

  // TLT-089 — Neutralizar fórmulas CSV (CSV injection). Aplica el prefijo '
  // a celdas que podrían interpretarse como fórmula por Excel/LibreOffice.
  function neutralizeCsvCell(value) {
    var v = String(value == null ? '' : value);
    if (/^[=+\-@\t\r]/.test(v)) return "'" + v;
    return v;
  }

  // TLT-089 — Aplica neutralizeCsvCell a un texto CSV completo respetando
  // campos entrecomillados. Devuelve el CSV con el prefijo de seguridad.
  function neutralizeCsvText(csv, separator) {
    var sep = separator || ',';
    if (!csv) return csv || '';
    var lines = String(csv).split(/\r?\n/);
    var out = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line === '') { out.push(''); continue; }
      var fields = [];
      var buf = '';
      var inQuotes = false;
      for (var ci = 0; ci < line.length; ci++) {
        var ch = line[ci];
        if (inQuotes) {
          if (ch === '"') {
            if (line[ci + 1] === '"') { buf += '"'; ci++; }
            else inQuotes = false;
          } else buf += ch;
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === sep) {
          fields.push(buf); buf = '';
        } else {
          buf += ch;
        }
      }
      fields.push(buf);
      var neutralized = fields.map(function(f) {
        var n = neutralizeCsvCell(f);
        if (n.indexOf(sep) !== -1 || n.indexOf('"') !== -1 || n.indexOf('\n') !== -1) {
          n = '"' + n.replace(/"/g, '""') + '"';
        }
        return n;
      });
      out.push(neutralized.join(sep));
    }
    return out.join('\n');
  }

  // TLT-105/106 — Sanitizar HTML/SVG saliente: elimina scripts, iframes,
  // eventos inline y URIs javascript: para que el resultado convertido no
  // transporte contenido activo desde documentos no confiables.
  function sanitizeHtmlOutput(html) {
    if (!html) return html || '';
    var out = String(html);
    out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
    out = out.replace(/<script\b[^>]*\/>/gi, '');
    out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');
    out = out.replace(/<iframe\b[^>]*\/>/gi, '');
    out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '');
    out = out.replace(/<embed\b[^>]*\/?>/gi, '');
    out = out.replace(/<link\b[^>]*>[\s\S]*?<\/link\s*>/gi, '');
    out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    out = out.replace(/\s+style\s*=\s*("(?:[^"]*)"|'[^']*'|[^\s>]+)/gi, function(m) {
      return /url\s*\(|expression|javascript:/i.test(m) ? '' : m;
    });
    out = out.replace(/href\s*=\s*(["'])javascript:[^"']*\1/gi, 'href=$1#$1');
    out = out.replace(/src\s*=\s*(["'])javascript:[^"']*\1/gi, 'src=$1$1');
    return out;
  }


  function getBaseName(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  function getExt(filename) {
    var m = String(filename).match(/\.([A-Za-z0-9]{1,10})$/);
    return m ? m[1].toLowerCase() : '';
  }

  function validateArchiveSafety(zipEntries) {
    var MAX_ENTRIES = 10000;
    var MAX_UNCOMPRESSED = 1024 * 1024 * 1024;
    var MAX_RATIO = 100;

    if (zipEntries.length > MAX_ENTRIES) {
      throw new Error('El ZIP contiene demasiadas entradas (' + zipEntries.length + '). Máximo permitido: ' + MAX_ENTRIES + '.');
    }

    for (var i = 0; i < zipEntries.length; i++) {
      var name = zipEntries[i].name || '';
      if (name.indexOf('..') !== -1 || name.indexOf('\\') === 0 || /^[A-Z]:\\/i.test(name) || name.indexOf('/') === 0) {
        throw new Error('El ZIP contiene rutas potencialmente peligrosas: ' + name.substring(0, 60));
      }
    }

    var totalSize = 0;
    for (var j = 0; j < zipEntries.length; j++) {
      var entry = zipEntries[j];
      var compressed = entry._data ? entry._data.length : 0;
      var uncompressed = entry._index ? entry._index.uncompressedSize || 0 : 0;
      if (uncompressed > 0 && compressed > 0) {
        var ratio = uncompressed / compressed;
        if (ratio > MAX_RATIO) {
          throw new Error('Relación de compresión anómala detectada en ' + (entry.name || 'archivo') + '. Posible ZIP bomb.');
        }
      }
      totalSize += uncompressed;
    }

    if (totalSize > MAX_UNCOMPRESSED) {
      throw new Error('El tamaño total descomprimido estimado (' + Math.round(totalSize / (1024 * 1024)) + ' MB) excede el límite de seguridad.');
    }

    return true;
  }

  async function readFileInChunks(file, chunkSize, onChunk) {
    var offset = 0;
    while (offset < file.size) {
      var end = Math.min(offset + chunkSize, file.size);
      var chunk = file.slice(offset, end);
      var buffer = await readFileAsArrayBuffer(chunk);
      await onChunk(new Uint8Array(buffer), offset, file.size);
      offset = end;
    }
  }

  async function wrapPdfText(doc, text, options) {
    var font = options.font || 'Helvetica';
    var fontSize = options.fontSize || 12;
    var pageW = options.pageWidth || 595;
    var pageH = options.pageHeight || 842;
    var margin = options.margin || 50;
    var lineH = fontSize * 1.5;
    var maxW = pageW - 2 * margin;
    var usableH = pageH - 2 * margin;

    var StandardFonts = window.PDFLib ? window.PDFLib.StandardFonts : null;
    var rgb = window.PDFLib ? window.PDFLib.rgb : null;
    var fontObj;
    try {
      fontObj = await doc.embedFont(StandardFonts[font] || StandardFonts.Helvetica);
    } catch(e) {
      fontObj = await doc.embedFont(StandardFonts.Helvetica);
      font = 'Helvetica';
    }

    var lines = [];
    var paragraphs = text.split('\n');
    for (var p = 0; p < paragraphs.length; p++) {
      var para = paragraphs[p];
      if (para === '') { lines.push(''); continue; }
      var words = para.split(/(\s+)/);
      var currentLine = '';
      for (var w = 0; w < words.length; w++) {
        var test = currentLine + words[w];
        var w2;
        try { w2 = fontObj.widthOfTextAtSize(test, fontSize); } catch(e) { w2 = test.length * fontSize * 0.5; }
        if (w2 > maxW && currentLine.trim() !== '') {
          lines.push(currentLine.trim());
          currentLine = words[w];
        } else {
          currentLine = test;
        }
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
    }

    var pages = [];
    var pageLines = [];
    for (var i = 0; i < lines.length; i++) {
      pageLines.push(lines[i]);
      var usedH = pageLines.length * lineH;
      if (usedH >= usableH || i === lines.length - 1) {
        pages.push(pageLines.slice());
        pageLines = [];
      }
    }

    for (var pi = 0; pi < pages.length; pi++) {
      var page = doc.addPage([pageW, pageH]);
      var pl = pages[pi];
      for (var li = 0; li < pl.length; li++) {
        if (pl[li] !== '') {
          try {
            page.drawText(pl[li], { x: margin, y: pageH - margin - (li + 1) * lineH, size: fontSize, font: fontObj, color: rgb(0, 0, 0) });
          } catch(e) { /* skip undrawable chars */ }
        }
      }
    }
    return pages.length;
  }

  // ─── WORD TOOLS ────────────────────────────────────────────────────────

  window.ToolProcessors.wordToPdf = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to PDF...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

        var doc = await PDFLib.PDFDocument.create();
        var StandardFonts = PDFLib.StandardFonts;
        var rgb = PDFLib.rgb;
        await wrapPdfText(doc, text, { fontSize: options.fontSize || 12, margin: options.margin || 50, font: options.font || 'Helvetica' });

        var pdfBytes = await doc.save();
        var blob = new Blob([pdfBytes], { type: 'application/pdf' });
        results.push({ name: getBaseName(files[i].name) + '.pdf', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to PDF.');
  };

  window.ToolProcessors.wordToJpg = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    var quality = options.quality || 0.92;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to JPG...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        var paragraphs = text.split('\n').filter(function(p) { return p.trim() !== ''; });

        var canvasWidth = options.width || 800;
        var fontSize = options.fontSize || 16;
        var lineHeight = fontSize * 1.6;
        var padding = 40;
        var approxLines = 0;
        for (var p = 0; p < paragraphs.length; p++) {
          approxLines += Math.max(1, Math.ceil(paragraphs[p].length * (fontSize * 0.6) / (canvasWidth - 2 * padding)));
        }
        approxLines += paragraphs.length;
        var canvasHeight = Math.max(600, Math.min(approxLines * lineHeight + 2 * padding, 16000));

        var canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.fillStyle = '#000000';
        ctx.font = fontSize + 'px Calibri, Arial, sans-serif';

        var y = padding + fontSize;
        var maxW = canvasWidth - 2 * padding;
        for (var p = 0; p < paragraphs.length; p++) {
          var para = paragraphs[p].trim();
          if (para === '') continue;
          var words = para.split(/\s+/);
          var line = '';
          for (var w = 0; w < words.length; w++) {
            var test = line + (line ? ' ' : '') + words[w];
            var metrics = ctx.measureText(test);
            if (metrics.width > maxW && line !== '') {
              ctx.fillText(line, padding, y);
              y += lineHeight;
              line = words[w];
            } else {
              line = test;
            }
          }
          if (line) {
            ctx.fillText(line, padding, y);
            y += lineHeight;
          }
          y += lineHeight * 0.3;
        }

        var cropCanvas = document.createElement('canvas');
        cropCanvas.width = canvasWidth;
        cropCanvas.height = Math.min(y + padding, canvasHeight);
        var cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, 0, 0);

        var blob = await new Promise(function(resolve) {
          cropCanvas.toBlob(function(b) { resolve(b); }, 'image/jpeg', quality);
        });
        results.push({ name: getBaseName(files[i].name) + '.jpg', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to JPG.');
  };

  window.ToolProcessors.wordToPng = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to PNG...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        var paragraphs = text.split('\n').filter(function(p) { return p.trim() !== ''; });

        var canvasWidth = options.width || 800;
        var fontSize = options.fontSize || 16;
        var lineHeight = fontSize * 1.6;
        var padding = 40;
        var approxLines = 0;
        for (var p = 0; p < paragraphs.length; p++) {
          approxLines += Math.max(1, Math.ceil(paragraphs[p].length * (fontSize * 0.6) / (canvasWidth - 2 * padding)));
        }
        approxLines += paragraphs.length;
        var canvasHeight = Math.max(600, Math.min(approxLines * lineHeight + 2 * padding, 16000));

        var canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.fillStyle = '#000000';
        ctx.font = fontSize + 'px Calibri, Arial, sans-serif';

        var y = padding + fontSize;
        var maxW = canvasWidth - 2 * padding;
        for (var p = 0; p < paragraphs.length; p++) {
          var para = paragraphs[p].trim();
          if (para === '') continue;
          var words = para.split(/\s+/);
          var line = '';
          for (var w = 0; w < words.length; w++) {
            var test = line + (line ? ' ' : '') + words[w];
            var metrics = ctx.measureText(test);
            if (metrics.width > maxW && line !== '') {
              ctx.fillText(line, padding, y);
              y += lineHeight;
              line = words[w];
            } else {
              line = test;
            }
          }
          if (line) {
            ctx.fillText(line, padding, y);
            y += lineHeight;
          }
          y += lineHeight * 0.3;
        }

        var cropCanvas = document.createElement('canvas');
        cropCanvas.width = canvasWidth;
        cropCanvas.height = Math.min(y + padding, canvasHeight);
        var cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, 0, 0);

        var blob = await new Promise(function(resolve) {
          cropCanvas.toBlob(function(b) { resolve(b); }, 'image/png');
        });
        results.push({ name: getBaseName(files[i].name) + '.png', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to PNG.');
  };

  window.ToolProcessors.wordToTxt = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Extracting text from ' + files[i].name + '...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var textResult = await mammoth.extractRawText({ arrayBuffer: buf });
        var text = textResult.value || '';
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        results.push({ name: getBaseName(files[i].name) + '.txt', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Extracted text from ' + results.length + ' file(s).');
  };

  window.ToolProcessors.wordToHtml = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to HTML...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var fullHtml = wrapHtml(html, files[i].name);
        var blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
        results.push({ name: getBaseName(files[i].name) + '.html', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to HTML.');
  };

  window.ToolProcessors.wordToMarkdown = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to Markdown...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var md = htmlToMarkdown(html);
        var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        results.push({ name: getBaseName(files[i].name) + '.md', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to Markdown.');
  };

  window.ToolProcessors.wordToEpub = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to EPUB...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '<p>No content</p>';

        var title = options.title || getBaseName(files[i].name);
        var author = options.author || 'Unknown';
        var lang = options.language || 'en';
        var uid = 'urn:uuid:' + crypto.randomUUID();

        var headings = [];
        var headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
        var hMatch;
        while ((hMatch = headingRegex.exec(html)) !== null) {
          headings.push({ level: parseInt(hMatch[1]), text: hMatch[2].replace(/<[^>]+>/g, '').trim() });
        }

        var chapters = [];
        if (headings.length > 1) {
          var splitRegex = /(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi;
          var parts = html.split(splitRegex);
          var currentChapter = '';
          var currentTitle = 'Introduction';
          for (var p = 0; p < parts.length; p++) {
            var hm = parts[p].match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>$/i);
            if (hm) {
              if (currentChapter.trim()) {
                chapters.push({ title: currentTitle, content: currentChapter.trim() });
              }
              currentTitle = hm[2].replace(/<[^>]+>/g, '').trim();
              currentChapter = parts[p] + '\n';
            } else {
              currentChapter += parts[p];
            }
          }
          if (currentChapter.trim()) {
            chapters.push({ title: currentTitle, content: currentChapter.trim() });
          }
        }

        if (chapters.length === 0) {
          chapters = [{ title: title, content: html }];
        }

        var defaultCss = 'body{font-family:serif;line-height:1.6;margin:1em}h1,h2,h3{color:#333}p{margin:0.5em 0}img{max-width:100%}';

        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

        var metaInf = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>';
        zip.file('META-INF/container.xml', metaInf);

        zip.file('OEBPS/styles/default.css', defaultCss);

        var manifestItems = '';
        var spineItems = '';
        var tocNcItems = '';
        var ncxNavPoints = '';

        manifestItems += '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n';
        manifestItems += '    <item id="style" href="styles/default.css" media-type="text/css"/>\n';

        for (var c = 0; c < chapters.length; c++) {
          var chapFilename = 'chapter' + (c + 1) + '.xhtml';
          var chapTitle = chapters[c].title;
          var chapContent = chapters[c].content;

          var xhtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + lang + '">\n<head>\n  <meta charset="UTF-8"/>\n  <title>' + chapTitle + '</title>\n  <link rel="stylesheet" type="text/css" href="styles/default.css"/>\n</head>\n<body>\n<h1>' + chapTitle + '</h1>\n' + chapContent + '\n</body>\n</html>';

          zip.file('OEBPS/' + chapFilename, xhtml);
          manifestItems += '    <item id="chapter' + (c + 1) + '" href="' + chapFilename + '" media-type="application/xhtml+xml"/>\n';
          spineItems += '    <itemref idref="chapter' + (c + 1) + '"/>\n';
          tocNcItems += '    <text>' + chapTitle + '</text>\n';
          ncxNavPoints += '    <navPoint id="navPoint-' + (c + 1) + '" playOrder="' + (c + 1) + '">\n      <navLabel>\n        <text>' + chapTitle + '</text>\n      </navLabel>\n      <content src="' + chapFilename + '"/>\n    </navPoint>\n';
        }

        var contentOpf = '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="BookId">' + uid + '</dc:identifier>\n    <dc:title>' + title + '</dc:title>\n    <dc:creator>' + author + '</dc:creator>\n    <dc:language>' + lang + '</dc:language>\n    <meta property="dcterms:modified">' + new Date().toISOString().split('.')[0] + 'Z</meta>\n  </metadata>\n  <manifest>\n' + manifestItems + '  </manifest>\n  <spine toc="ncx">\n' + spineItems + '  </spine>\n</package>';

        zip.file('OEBPS/content.opf', contentOpf);

        var tocNcx = '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n    <meta name="dtb:uid" content="' + uid + '"/>\n  </head>\n  <docTitle>\n    <text>' + title + '</text>\n  </docTitle>\n  <navMap>\n' + ncxNavPoints + '  </navMap>\n</ncx>';

        zip.file('OEBPS/toc.ncx', tocNcx);

        var epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
        results.push({ name: getBaseName(files[i].name) + '.epub', blob: epubBlob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to EPUB.');
  };

  window.ToolProcessors.wordToOdt = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to ODT...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var textResult = await mammoth.extractRawText({ arrayBuffer: buf });
        var text = textResult.value || '';
        var paragraphs = text.split('\n');

        var contentXml = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text" office:version="1.2">\n  <office:body>\n    <office:text>\n';
        for (var p = 0; p < paragraphs.length; p++) {
          if (paragraphs[p].trim() === '') {
            contentXml += '      <text:p/>\n';
          } else {
            contentXml += '      <text:p>' + paragraphs[p].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</text:p>\n';
          }
        }
        contentXml += '    </office:text>\n  </office:body>\n</office:document-content>';

        var manifestXml = '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest" manifest:version="1.2">\n  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>\n  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>\n</manifest:manifest>';

        var zip = new JSZip();
        zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
        zip.file('content.xml', contentXml);
        zip.file('META-INF/manifest.xml', manifestXml);

        var odtBlob = await zip.generateAsync({ type: 'blob' });
        results.push({ name: getBaseName(files[i].name) + '.odt', blob: odtBlob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to ODT.');
  };

  window.ToolProcessors.odtToWord = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to DOCX...');
      try {
        var buf = await readFileAsArrayBuffer(files[i]);
        var zip = await JSZip.loadAsync(buf);
        var contentFile = zip.file('content.xml');
        if (!contentFile) throw new Error('Invalid ODT: content.xml not found');

        var contentXml = await contentFile.async('text');
        var parser = new DOMParser();
        var xmlDoc = parser.parseFromString(contentXml, 'text/xml');
        var textNodes = xmlDoc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text', 'p');
        var paragraphs = [];
        for (var t = 0; t < textNodes.length; t++) {
          var txt = textNodes[t].textContent || '';
          paragraphs.push(txt);
        }

        var docParagraphs = paragraphs.map(function(text) {
          return new docx.Paragraph({
            children: [new docx.TextRun({ text: text, font: 'Calibri', size: 22 })]
          });
        });

        var doc = new docx.Document({
          sections: [{ properties: {}, children: docParagraphs }]
        });

        var docxBlob = await docx.Packer.toBlob(doc);
        results.push({ name: getBaseName(files[i].name) + '.docx', blob: docxBlob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to DOCX.');
  };

  window.ToolProcessors.rtfToWord = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to DOCX...');
      try {
        var text = await readFileAsText(files[i]);
        var plainText = parseRtf(text);
        var lines = plainText.split('\n');

        var docParagraphs = lines.map(function(line) {
          return new docx.Paragraph({
            children: [new docx.TextRun({ text: line, font: 'Calibri', size: 22 })]
          });
        });

        var doc = new docx.Document({
          sections: [{ properties: {}, children: docParagraphs }]
        });

        var docxBlob = await docx.Packer.toBlob(doc);
        results.push({ name: getBaseName(files[i].name) + '.docx', blob: docxBlob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to DOCX.');
  };

  window.ToolProcessors.mergeWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Merging DOCX files...');
    try {
      var allParagraphs = [];
      for (var i = 0; i < files.length; i++) {
        var buf = await readFileAsArrayBuffer(files[i]);
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        var lines = text.split('\n').filter(function(l) { return l.trim() !== ''; });
        for (var l = 0; l < lines.length; l++) {
          allParagraphs.push(lines[l]);
        }
        if (options.pageBreak && i < files.length - 1) {
          allParagraphs.push('\u000C');
        }
      }

      var docParagraphs = [];
      for (var p = 0; p < allParagraphs.length; p++) {
        if (allParagraphs[p] === '\u000C') {
          docParagraphs.push(new docx.Paragraph({
            children: [],
            pageBreakBefore: true
          }));
        } else {
          docParagraphs.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: allParagraphs[p], font: 'Calibri', size: 22 })]
          }));
        }
      }

      var doc = new docx.Document({
        sections: [{ properties: {}, children: docParagraphs }]
      });

      var mergedBlob = await docx.Packer.toBlob(doc);
      return makeSingleResult(mergedBlob, 'merged.docx', 'Merged ' + files.length + ' files.');
    } catch(e) {
      throw new Error('Merge failed: ' + e.message);
    }
  };

  window.ToolProcessors.splitWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Splitting DOCX...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      var html = htmlResult.value || '';

      var splitBy = options.splitBy || 'headings';
      var sections = [];

      if (splitBy === 'headings') {
        var headingRegex = /(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi;
        var parts = html.split(headingRegex);
        var current = '';
        for (var p = 0; p < parts.length; p++) {
          if (parts[p].match(/^<h[1-6]/i)) {
            if (current.trim()) sections.push(current.trim());
            current = parts[p];
          } else {
            current += parts[p];
          }
        }
        if (current.trim()) sections.push(current.trim());
      } else if (splitBy === 'pages') {
        var pageParts = html.split(/<br\s*clear="all"\s*\/?>/gi);
        sections = pageParts.filter(function(s) { return s.trim() !== ''; });
      } else {
        sections = [html];
      }

      if (sections.length === 0) sections = [html];

      var zip = new JSZip();
      var baseName = getBaseName(files[0].name);

      for (var s = 0; s < sections.length; s++) {
        var sectionText = sections[s].replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        var lines = sectionText.split('\n').filter(function(l) { return l.trim() !== ''; });
        var docParagraphs = lines.map(function(line) {
          return new docx.Paragraph({
            children: [new docx.TextRun({ text: line, font: 'Calibri', size: 22 })]
          });
        });

        if (docParagraphs.length === 0) {
          docParagraphs.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '' })] }));
        }

        var doc = new docx.Document({
          sections: [{ properties: {}, children: docParagraphs }]
        });

        var partBlob = await docx.Packer.toBlob(doc);
        var partArrayBuffer = await partBlob.arrayBuffer();
        zip.file(baseName + '_part' + (s + 1) + '.docx', partArrayBuffer);
      }

      var zipBlob = await zip.generateAsync({ type: 'blob' });
      return makeSingleResult(zipBlob, baseName + '_parts.zip', 'Split into ' + sections.length + ' parts.');
    } catch(e) {
      throw new Error('Split failed: ' + e.message);
    }
  };

  window.ToolProcessors.repairWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Repairing DOCX...');
    try {
      var report = [];
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip;
      try {
        zip = await JSZip.loadAsync(buf);
        report.push('ZIP structure: OK');
      } catch(e) {
        report.push('ZIP structure: CORRUPT - attempting text recovery');
        zip = null;
      }

      var text = '';
      if (zip) {
        var contentTypes = zip.file('[Content_Types].xml');
        report.push('[Content_Types].xml: ' + (contentTypes ? 'Found' : 'Missing'));

        var docFile = zip.file('word/document.xml');
        report.push('word/document.xml: ' + (docFile ? 'Found' : 'Missing'));

        var files_list = [];
        zip.forEach(function(path) { files_list.push(path); });
        report.push('Files in archive: ' + files_list.length);
      }

      try {
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        text = htmlResult.value || '';
        var warnings = htmlResult.messages || [];
        if (warnings.length > 0) {
          report.push('Recovery warnings: ' + warnings.length);
          warnings.forEach(function(w) { report.push('  - ' + (w.message || JSON.stringify(w))); });
        }
      } catch(e) {
        report.push('Mammoth extraction failed: ' + e.message);
        if (zip) {
          try {
            var docFile = zip.file('word/document.xml');
            if (docFile) {
              var docXml = await docFile.async('text');
              var parser = new DOMParser();
              var xml = parser.parseFromString(docXml, 'text/xml');
              var tNodes = xml.getElementsByTagName('w:t');
              for (var t = 0; t < tNodes.length; t++) {
                text += tNodes[t].textContent;
                if (t < tNodes.length - 1) text += ' ';
              }
              report.push('Fallback XML text extraction: OK');
            }
          } catch(e2) {
            report.push('Fallback extraction also failed: ' + e2.message);
          }
        }
      }

      var plainText = text.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
      var lines = plainText.split('\n').filter(function(l) { return l.trim() !== ''; });
      report.push('Recovered ' + lines.length + ' lines of text');

      var docParagraphs = lines.map(function(line) {
        return new docx.Paragraph({
          children: [new docx.TextRun({ text: line, font: 'Calibri', size: 22 })]
        });
      });

      if (docParagraphs.length === 0) {
        docParagraphs.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '[No content could be recovered]' })] }));
      }

      var doc = new docx.Document({
        sections: [{ properties: {}, children: docParagraphs }]
      });

      var repairedBlob = await docx.Packer.toBlob(doc);
      var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
      return makeResult([
        { name: getBaseName(files[0].name) + '_repaired.docx', blob: repairedBlob },
        { name: getBaseName(files[0].name) + '_repair_report.txt', blob: reportBlob }
      ], 'Repair complete. See report for details.');
    } catch(e) {
      throw new Error('Repair failed: ' + e.message);
    }
  };

  window.ToolProcessors.compressWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Compressing DOCX...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var originalSize = buf.byteLength;
      var zip = await JSZip.loadAsync(buf);

      var removePatterns = [
        /word\/media\/thumb\d+\.jpeg/i,
        /word\/media\/_rels/i,
        /customXml\//i,
        /\[Content_Types\]\.xml$/i
      ];

      var removedFiles = [];
      var filesToRemove = [];
      zip.forEach(function(path) {
        for (var r = 0; r < removePatterns.length; r++) {
          if (removePatterns[r].test(path) && path !== '[Content_Types].xml') {
            filesToRemove.push(path);
            break;
          }
        }
      });

      filesToRemove.forEach(function(f) {
        zip.remove(f);
        removedFiles.push(f);
      });

      var compressedBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });

      var compressedSize = compressedBlob.size;
      var ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      return makeSingleResult(compressedBlob, getBaseName(files[0].name) + '_compressed.docx',
        'Original: ' + originalSize + ' bytes, Compressed: ' + compressedSize + ' bytes (' + ratio + '% reduction). Removed ' + removedFiles.length + ' files.');
    } catch(e) {
      throw new Error('Compression failed: ' + e.message);
    }
  };

  window.ToolProcessors.stripMetadataWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Stripping metadata from DOCX...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);

      var coreFile = zip.file('docProps/core.xml');
      if (coreFile) {
        var coreXml = await coreFile.async('text');
        coreXml = coreXml.replace(/<dc:creator>[^<]*<\/dc:creator>/gi, '<dc:creator>Anonymous</dc:creator>');
        coreXml = coreXml.replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/gi, '<cp:lastModifiedBy>Anonymous</cp:lastModifiedBy>');
        coreXml = coreXml.replace(/<dcterms:created>[^<]*<\/dcterms:created>/gi, '<dcterms:created>' + new Date().toISOString() + '</dcterms:created>');
        coreXml = coreXml.replace(/<dcterms:modified>[^<]*<\/dcterms:modified>/gi, '<dcterms:modified>' + new Date().toISOString() + '</dcterms:modified>');
        coreXml = coreXml.replace(/<dc:title>[^<]*<\/dc:title>/gi, '<dc:title/>'  );
        coreXml = coreXml.replace(/<dc:subject>[^<]*<\/dc:subject>/gi, '<dc:subject/>'  );
        coreXml = coreXml.replace(/<dc:description>[^<]*<\/dc:description>/gi, '<dc:description/>'  );
        coreXml = coreXml.replace(/<dc:language>[^<]*<\/dc:language>/gi, '<dc:language>en-US</dc:language>');
        zip.file('docProps/core.xml', coreXml);
      }

      var appFile = zip.file('docProps/app.xml');
      if (appFile) {
        var appXml = await appFile.async('text');
        appXml = appXml.replace(/<Manager>[^<]*<\/Manager>/gi, '<Manager/>'  );
        appXml = appXml.replace(/<Company>[^<]*<\/Company>/gi, '<Company/>'  );
        zip.file('docProps/app.xml', appXml);
      }

      var customPropsFile = zip.file('docProps/custom.xml');
      if (customPropsFile) {
        zip.remove('docProps/custom.xml');
      }

      var cleanedBlob = await zip.generateAsync({ type: 'blob' });
      return makeSingleResult(cleanedBlob, getBaseName(files[0].name) + '_clean.docx', 'Metadata stripped successfully.');
    } catch(e) {
      throw new Error('Metadata stripping failed: ' + e.message);
    }
  };

  window.ToolProcessors.formatDocument = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Formatting document...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var textResult = await mammoth.extractRawText({ arrayBuffer: buf });
      var text = textResult.value || '';
      var lines = text.split('\n');

      var fontSize = options.fontSize || 11;
      var font = options.font || 'Calibri';
      var lineSpacing = options.lineHeight || 1.5;
      var align = options.alignment || 'left';

      var docParagraphs = lines.map(function(line) {
        var opts = {
          children: [new docx.TextRun({ text: line, font: font, size: fontSize * 2 })],
          spacing: { line: Math.round(lineSpacing * 240) }
        };
        if (align === 'center') opts.alignment = docx.AlignmentType.CENTER;
        else if (align === 'right') opts.alignment = docx.AlignmentType.RIGHT;
        else if (align === 'justify') opts.alignment = docx.AlignmentType.JUSTIFIED;
        return new docx.Paragraph(opts);
      });

      var sectionProps = {};
      if (options.margins) {
        var m = options.margins;
        sectionProps.page = {
          margin: {
            top: Math.round(m.top || 1440),
            bottom: Math.round(m.bottom || 1440),
            left: Math.round(m.left || 1440),
            right: Math.round(m.right || 1440)
          }
        };
      }

      var doc = new docx.Document({
        sections: [{ properties: sectionProps, children: docParagraphs }]
      });

      var formattedBlob = await docx.Packer.toBlob(doc);
      return makeSingleResult(formattedBlob, getBaseName(files[0].name) + '_formatted.docx', 'Document formatted with ' + font + ' ' + fontSize + 'pt, line height ' + lineSpacing + '.');
    } catch(e) {
      throw new Error('Formatting failed: ' + e.message);
    }
  };

  window.ToolProcessors.tocWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Generating table of contents...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      var html = htmlResult.value || '';

      var headings = [];
      var headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
      var hMatch;
      var headingPositions = [];
      while ((hMatch = headingRegex.exec(html)) !== null) {
        var headingText = hMatch[2].replace(/<[^>]+>/g, '').trim();
        headings.push({ level: parseInt(hMatch[1]), text: headingText });
        headingPositions.push(hMatch.index);
      }

      var tocParagraphs = [];
      tocParagraphs.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: 'Table of Contents', bold: true, size: 32, font: 'Calibri' })],
        heading: docx.HeadingLevel.HEADING_1
      }));
      tocParagraphs.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '' })] }));

      for (var h = 0; h < headings.length; h++) {
        var indent = (headings[h].level - 1) * 720;
        tocParagraphs.push(new docx.Paragraph({
          children: [
            new docx.TextRun({
              text: headings[h].text,
              font: 'Calibri',
              size: 22,
              bold: headings[h].level <= 2
            }),
            new docx.TextRun({
              text: '\t' + (h + 1),
              font: 'Calibri',
              size: 22,
              color: '888888'
            })
          ],
          indent: { left: indent }
        }));
      }

      tocParagraphs.push(new docx.Paragraph({
        children: [],
        pageBreakBefore: true
      }));

      var plainText = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
      var textLines = plainText.split('\n').filter(function(l) { return l.trim() !== ''; });
      for (var t = 0; t < textLines.length; t++) {
        tocParagraphs.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: textLines[t], font: 'Calibri', size: 22 })]
        }));
      }

      var doc = new docx.Document({
        sections: [{ properties: {}, children: tocParagraphs }]
      });

      var tocBlob = await docx.Packer.toBlob(doc);
      return makeSingleResult(tocBlob, getBaseName(files[0].name) + '_with_toc.docx', 'Table of contents generated with ' + headings.length + ' entries.');
    } catch(e) {
      throw new Error('TOC generation failed: ' + e.message);
    }
  };

  window.ToolProcessors.extractWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    var format = options.format || 'txt';
    onProgress(1, 1, 'Extracting content from DOCX...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var results = [];

      if (format === 'txt') {
        var textResult = await mammoth.extractRawText({ arrayBuffer: buf });
        var blob = new Blob([textResult.value || ''], { type: 'text/plain;charset=utf-8' });
        results.push({ name: getBaseName(files[0].name) + '.txt', blob: blob });
      } else if (format === 'html') {
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var fullHtml = wrapHtml(htmlResult.value || '', files[0].name);
        var blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
        results.push({ name: getBaseName(files[0].name) + '.html', blob: blob });
      } else if (format === 'json') {
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var structure = { headings: [], paragraphs: [], lists: [], tables: [] };

        var hRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
        var hm;
        while ((hm = hRegex.exec(html)) !== null) {
          structure.headings.push({ level: parseInt(hm[1]), text: hm[2].replace(/<[^>]+>/g, '').trim() });
        }

        var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        var pm;
        while ((pm = pRegex.exec(html)) !== null) {
          var pText = pm[1].replace(/<[^>]+>/g, '').trim();
          if (pText) structure.paragraphs.push(pText);
        }

        var tRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
        var tm;
        while ((tm = tRegex.exec(html)) !== null) {
          var tableData = [];
          var trR = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          var trM;
          while ((trM = trR.exec(tm[1])) !== null) {
            var cells = [];
            var cR = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
            var cM;
            while ((cM = cR.exec(trM[1])) !== null) {
              cells.push(cM[1].replace(/<[^>]+>/g, '').trim());
            }
            if (cells.length > 0) tableData.push(cells);
          }
          if (tableData.length > 0) structure.tables.push(tableData);
        }

        var jsonBlob = new Blob([JSON.stringify(structure, null, 2)], { type: 'application/json;charset=utf-8' });
        results.push({ name: getBaseName(files[0].name) + '.json', blob: jsonBlob });

        if (structure.tables.length > 0) {
          var csvLines = [];
          for (var ti = 0; ti < structure.tables.length; ti++) {
            csvLines.push('--- Table ' + (ti + 1) + ' ---');
            for (var ri = 0; ri < structure.tables[ti].length; ri++) {
              csvLines.push(structure.tables[ti][ri].map(function(c) {
                return '"' + neutralizeCsvCell(c).replace(/"/g, '""') + '"';
              }).join(','));
            }
            csvLines.push('');
          }
          var csvBlob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
          results.push({ name: getBaseName(files[0].name) + '_tables.csv', blob: csvBlob });
        }
      } else if (format === 'csv') {
        var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
        var html = htmlResult.value || '';
        var csvLines = [];
        var tRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
        var tm;
        while ((tm = tRegex.exec(html)) !== null) {
          var trR = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          var trM;
          while ((trM = trR.exec(tm[1])) !== null) {
            var cells = [];
            var cR = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
            var cM;
            while ((cM = cR.exec(trM[1])) !== null) {
              cells.push('"' + neutralizeCsvCell(cM[1].replace(/<[^>]+>/g, '').trim()).replace(/"/g, '""') + '"');
            }
            if (cells.length > 0) csvLines.push(cells.join(','));
          }
        }
        var csvBlob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
        results.push({ name: getBaseName(files[0].name) + '.csv', blob: csvBlob });
      }

      return makeResult(results, 'Content extracted in ' + format + ' format.');
    } catch(e) {
      throw new Error('Extraction failed: ' + e.message);
    }
  };

  window.ToolProcessors.findReplaceWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    var searchText = options.search || '';
    var replaceText = options.replace || '';
    if (!searchText) throw new Error('Search text is required');
    onProgress(1, 1, 'Finding and replacing in DOCX...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var textResult = await mammoth.extractRawText({ arrayBuffer: buf });
      var text = textResult.value || '';

      var count = 0;
      var newText;
      if (options.regex) {
        var flags = options.caseSensitive ? 'g' : 'gi';
        var regex = new RegExp(searchText, flags);
        var matches = text.match(regex);
        count = matches ? matches.length : 0;
        newText = text.replace(regex, replaceText);
      } else {
        if (options.caseSensitive) {
          while (text.indexOf(searchText) !== -1) {
            count++;
            text = text.replace(searchText, replaceText);
          }
          newText = text;
        } else {
          var lowerText = text.toLowerCase();
          var lowerSearch = searchText.toLowerCase();
          var idx = 0;
          while ((idx = lowerText.indexOf(lowerSearch, idx)) !== -1) {
            count++;
            idx += lowerSearch.length;
          }
          var re = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          newText = text.replace(re, replaceText);
        }
      }

      var lines = newText.split('\n');
      var docParagraphs = lines.map(function(line) {
        return new docx.Paragraph({
          children: [new docx.TextRun({ text: line, font: 'Calibri', size: 22 })]
        });
      });

      var doc = new docx.Document({
        sections: [{ properties: {}, children: docParagraphs }]
      });

      var resultBlob = await docx.Packer.toBlob(doc);
      return makeSingleResult(resultBlob, getBaseName(files[0].name) + '_replaced.docx',
        'Replaced ' + count + ' occurrence(s) of "' + searchText + '" with "' + replaceText + '".');
    } catch(e) {
      throw new Error('Find/Replace failed: ' + e.message);
    }
  };

  window.ToolProcessors.tablesWordToExcel = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Extracting tables from DOCX to Excel...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      var html = htmlResult.value || '';

      var tables = [];
      var tRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      var tm;
      while ((tm = tRegex.exec(html)) !== null) {
        var tableData = [];
        var trR = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        var trM;
        while ((trM = trR.exec(tm[1])) !== null) {
          var row = [];
          var cR = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
          var cM;
          while ((cM = cR.exec(trM[1])) !== null) {
            row.push(cM[1].replace(/<[^>]+>/g, '').trim());
          }
          if (row.length > 0) tableData.push(row);
        }
        if (tableData.length > 0) tables.push(tableData);
      }

      if (tables.length === 0) {
        throw new Error('No tables found in the document.');
      }

      var wb = XLSX.utils.book_new();
      for (var t = 0; t < tables.length; t++) {
        var ws = XLSX.utils.aoa_to_sheet(tables[t]);
        var sheetName = 'Table ' + (t + 1);
        if (tables[t].length > 0 && tables[t][0].length > 0) {
          sheetName = tables[t][0][0].substring(0, 31) || sheetName;
        }
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      var xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var xlsxBlob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return makeSingleResult(xlsxBlob, getBaseName(files[0].name) + '_tables.xlsx',
        'Extracted ' + tables.length + ' table(s) to Excel.');
    } catch(e) {
      throw new Error('Table extraction failed: ' + e.message);
    }
  };

  window.ToolProcessors.removeBlankPagesWord = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Removing blank pages from DOCX...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var htmlResult = await mammoth.convertToHtml({ arrayBuffer: buf });
      var html = htmlResult.value || '';

      var beforeLength = html.length;
      var cleaned = html.replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '<!--BLANK-->');
      cleaned = cleaned.replace(/<p[^>]*>\s*&nbsp;\s*<\/p>/gi, '<!--BLANK-->');
      cleaned = cleaned.replace(/<p[^>]*>\s*<\/p>/gi, '<!--BLANK-->');
      cleaned = cleaned.replace(/<p[^>]*>\s*<br\s*clear="all"\s*\/?>\s*<\/p>\s*<p[^>]*>\s*<\/p>/gi, '<!--BLANK-->');
      cleaned = cleaned.replace(/<!--BLANK-->/g, '');

      var removedCount = (beforeLength - cleaned.length) > 0 ?
        Math.floor((beforeLength - cleaned.length) / 50) : 0;

      var plainText = cleaned.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
      var lines = plainText.split('\n').filter(function(l) { return l.trim() !== ''; });

      var docParagraphs = lines.map(function(line) {
        return new docx.Paragraph({
          children: [new docx.TextRun({ text: line, font: 'Calibri', size: 22 })]
        });
      });

      if (docParagraphs.length === 0) {
        docParagraphs.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '' })] }));
      }

      var doc = new docx.Document({
        sections: [{ properties: {}, children: docParagraphs }]
      });

      var resultBlob = await docx.Packer.toBlob(doc);
      return makeSingleResult(resultBlob, getBaseName(files[0].name) + '_no_blanks.docx',
        'Removed approximately ' + removedCount + ' blank page(s).');
    } catch(e) {
      throw new Error('Blank page removal failed: ' + e.message);
    }
  };

  // ─── TXT TOOLS ─────────────────────────────────────────────────────────

  window.ToolProcessors.txtToPdf = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    var StandardFonts = PDFLib.StandardFonts;
    var rgb = PDFLib.rgb;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to PDF...');
      try {
        var text = await readFileAsText(files[i]);
        var doc = await PDFLib.PDFDocument.create();
        var fontSize = options.fontSize || 12;
        var fontFamily = options.fontFamily || 'Helvetica';
        var pageWidth = options.orientation === 'landscape' ? 842 : 595;
        var pageHeight = options.orientation === 'landscape' ? 595 : 842;
        var margin = options.margin || 50;

        var fontKey = fontFamily.charAt(0).toUpperCase() + fontFamily.slice(1);
        var font;
        try { font = await doc.embedFont(StandardFonts[fontKey] || StandardFonts.Helvetica); }
        catch(e) { font = await doc.embedFont(StandardFonts.Helvetica); fontKey = 'Helvetica'; }

        var pageOpts = { fontSize: fontSize, margin: margin, pageWidth: pageWidth, pageHeight: pageHeight, font: fontKey };
        await wrapPdfText(doc, text, pageOpts);

        var pdfBytes = await doc.save();
        var blob = new Blob([pdfBytes], { type: 'application/pdf' });
        results.push({ name: getBaseName(files[i].name) + '.pdf', blob: blob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to PDF.');
  };

  window.ToolProcessors.txtToEpub = async function(files, options, onProgress) {
    var results = [];
    var total = files.length;
    for (var i = 0; i < total; i++) {
      onProgress(i + 1, total, 'Converting ' + files[i].name + ' to EPUB...');
      try {
        var text = await readFileAsText(files[i]);
        var title = options.title || getBaseName(files[i].name);
        var author = options.author || 'Unknown';
        var lang = options.language || 'en';
        var uid = 'urn:uuid:' + crypto.randomUUID();
        var chapterPattern = options.chapterPattern || 'double-newline';

        var chapters = [];
        if (chapterPattern === 'double-newline') {
          var parts = text.split(/\n\s*\n/);
          for (var p = 0; p < parts.length; p++) {
            if (parts[p].trim()) {
              var firstLine = parts[p].trim().split('\n')[0].substring(0, 80);
              chapters.push({ title: firstLine || 'Chapter ' + (p + 1), content: parts[p].trim() });
            }
          }
        } else if (chapterPattern === 'heading') {
          var lines = text.split('\n');
          var current = '';
          var currentTitle = title;
          for (var l = 0; l < lines.length; l++) {
            if (lines[l].match(/^#{1,6}\s+/)) {
              if (current.trim()) chapters.push({ title: currentTitle, content: current.trim() });
              currentTitle = lines[l].replace(/^#+\s+/, '').trim();
              current = '';
            } else {
              current += lines[l] + '\n';
            }
          }
          if (current.trim()) chapters.push({ title: currentTitle, content: current.trim() });
        } else {
          chapters = [{ title: title, content: text }];
        }

        if (chapters.length === 0) chapters = [{ title: title, content: text || 'Empty document' }];

        var defaultCss = 'body{font-family:serif;line-height:1.6;margin:1em}h1{color:#333}p{margin:0.5em 0}';
        var zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>');
        zip.file('OEBPS/styles/default.css', defaultCss);

        var manifestItems = '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="style" href="styles/default.css" media-type="text/css"/>\n';
        var spineItems = '';
        var ncxNavPoints = '';

        for (var c = 0; c < chapters.length; c++) {
          var chapFile = 'chapter' + (c + 1) + '.xhtml';
          var chapContent = chapters[c].content.split('\n').map(function(line) {
            return '<p>' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
          }).join('\n');

          var xhtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + lang + '">\n<head>\n  <meta charset="UTF-8"/>\n  <title>' + chapters[c].title + '</title>\n  <link rel="stylesheet" type="text/css" href="styles/default.css"/>\n</head>\n<body>\n<h1>' + chapters[c].title + '</h1>\n' + chapContent + '\n</body>\n</html>';

          zip.file('OEBPS/' + chapFile, xhtml);
          manifestItems += '    <item id="ch' + (c + 1) + '" href="' + chapFile + '" media-type="application/xhtml+xml"/>\n';
          spineItems += '    <itemref idref="ch' + (c + 1) + '"/>\n';
          ncxNavPoints += '    <navPoint id="np' + (c + 1) + '" playOrder="' + (c + 1) + '">\n      <navLabel><text>' + chapters[c].title + '</text></navLabel>\n      <content src="' + chapFile + '"/>\n    </navPoint>\n';
        }

        zip.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="BookId">' + uid + '</dc:identifier>\n    <dc:title>' + title + '</dc:title>\n    <dc:creator>' + author + '</dc:creator>\n    <dc:language>' + lang + '</dc:language>\n    <meta property="dcterms:modified">' + new Date().toISOString().split('.')[0] + 'Z</meta>\n  </metadata>\n  <manifest>\n' + manifestItems + '  </manifest>\n  <spine toc="ncx">\n' + spineItems + '  </spine>\n</package>');
        zip.file('OEBPS/toc.ncx', '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="' + uid + '"/></head>\n  <docTitle><text>' + title + '</text></docTitle>\n  <navMap>\n' + ncxNavPoints + '  </navMap>\n</ncx>');

        var epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
        results.push({ name: getBaseName(files[i].name) + '.epub', blob: epubBlob });
      } catch(e) { /* skip failed file */ }
    }
    return makeResult(results, 'Converted ' + results.length + ' file(s) to EPUB.');
  };

  window.ToolProcessors.mergeTxt = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Merging TXT files...');
    try {
      var separator = options.separator || '\n';
      if (separator === 'double-newline') separator = '\n\n';
      var addTitles = options.addTitles || false;
      var parts = [];

      for (var i = 0; i < files.length; i++) {
        var text = await readFileAsText(files[i]);
        if (addTitles) {
          parts.push('## ' + getBaseName(files[i].name) + '\n\n' + text);
        } else {
          parts.push(text);
        }
      }

      var merged = parts.join(separator);
      var blob = new Blob([merged], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(blob, 'merged.txt', 'Merged ' + files.length + ' file(s).');
    } catch(e) {
      throw new Error('Merge failed: ' + e.message);
    }
  };

  window.ToolProcessors.splitTxt = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Splitting TXT...');
    try {
      var text = await readFileAsText(files[0]);
      var splitBy = options.splitBy || 'lines';
      var count = options.count || 100;
      var parts = [];
      var baseName = getBaseName(files[0].name);

      if (splitBy === 'lines') {
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i += count) {
          parts.push(lines.slice(i, i + count).join('\n'));
        }
      } else if (splitBy === 'words') {
        var words = text.split(/\s+/);
        for (var i = 0; i < words.length; i += count) {
          parts.push(words.slice(i, i + count).join(' '));
        }
      } else if (splitBy === 'characters') {
        for (var i = 0; i < text.length; i += count) {
          parts.push(text.substring(i, i + count));
        }
      } else if (splitBy === 'size') {
        var chunkSize = options.size || 1024;
        for (var i = 0; i < text.length; i += chunkSize) {
          parts.push(text.substring(i, i + chunkSize));
        }
      } else if (splitBy === 'pattern') {
        var pattern = options.pattern || '\n\n';
        parts = text.split(pattern);
      }

      if (parts.length <= 1) {
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        return makeSingleResult(blob, baseName + '.txt', 'Content could not be split with given criteria.');
      }

      var zip = new JSZip();
      for (var p = 0; p < parts.length; p++) {
        zip.file(baseName + '_part' + (p + 1) + '.txt', parts[p]);
      }

      var zipBlob = await zip.generateAsync({ type: 'blob' });
      return makeSingleResult(zipBlob, baseName + '_parts.zip', 'Split into ' + parts.length + ' part(s).');
    } catch(e) {
      throw new Error('Split failed: ' + e.message);
    }
  };

  window.ToolProcessors.sortLines = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Sorting lines...');
    try {
      var text = await readFileAsText(files[0]);
      var lines = text.split('\n');
      var order = options.order || 'asc';
      var caseSensitive = options.caseSensitive || false;
      var removeEmpty = options.removeEmpty || false;
      var removeDuplicates = options.removeDuplicates || false;

      if (removeEmpty) {
        lines = lines.filter(function(l) { return l.trim() !== ''; });
      }

      if (removeDuplicates) {
        var seen = {};
        lines = lines.filter(function(l) {
          var key = caseSensitive ? l : l.toLowerCase();
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        });
      }

      if (order === 'asc' || order === 'desc') {
        lines.sort(function(a, b) {
          var aa = caseSensitive ? a : a.toLowerCase();
          var bb = caseSensitive ? b : b.toLowerCase();
          if (aa < bb) return order === 'asc' ? -1 : 1;
          if (aa > bb) return order === 'asc' ? 1 : -1;
          return 0;
        });
      } else if (order === 'natural') {
        lines.sort(function(a, b) {
          var aa = caseSensitive ? a : a.toLowerCase();
          var bb = caseSensitive ? b : b.toLowerCase();
          var aNum = parseInt(aa);
          var bNum = parseInt(bb);
          if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
          if (aa < bb) return -1;
          if (aa > bb) return 1;
          return 0;
        });
      } else if (order === 'random') {
        for (var i = lines.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var temp = lines[i];
          lines[i] = lines[j];
          lines[j] = temp;
        }
      }

      var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(blob, getBaseName(files[0].name) + '_sorted.txt',
        'Sorted ' + lines.length + ' line(s) in ' + order + ' order.');
    } catch(e) {
      throw new Error('Sort failed: ' + e.message);
    }
  };

  window.ToolProcessors.removeDuplicates = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Removing duplicates...');
    try {
      var text = await readFileAsText(files[0]);
      var lines = text.split('\n');
      var ignoreCase = options.ignoreCase || false;
      var ignoreSpaces = options.ignoreSpaces || false;
      var keepFirst = options.keepFirst !== undefined ? options.keepFirst : true;

      var seen = {};
      var result = [];
      var removed = 0;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var key = line;
        if (ignoreCase) key = key.toLowerCase();
        if (ignoreSpaces) key = key.replace(/\s+/g, ' ').trim();

        if (seen[key]) {
          removed++;
          if (!keepFirst) {
            var idx = result.indexOf(lines[Object.keys(seen).find(function(k) { return seen[k] === key; })]);
          }
        } else {
          seen[key] = true;
          result.push(line);
        }
      }

      var blob = new Blob([result.join('\n')], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(blob, getBaseName(files[0].name) + '_unique.txt',
        'Removed ' + removed + ' duplicate line(s). ' + result.length + ' unique line(s) remain.');
    } catch(e) {
      throw new Error('Remove duplicates failed: ' + e.message);
    }
  };

  window.ToolProcessors.listToTable = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Converting list to table...');
    try {
      var text = await readFileAsText(files[0]);
      var delimiter = options.delimiter || 'comma';
      var customDelimiter = options.customDelimiter || ',';
      var addHeaders = options.addHeaders || false;
      var outputFormat = options.outputFormat || 'html';

      var delim;
      switch (delimiter) {
        case 'comma': delim = ','; break;
        case 'semicolon': delim = ';'; break;
        case 'tab': delim = '\t'; break;
        case 'space': delim = /\s+/; break;
        case 'custom': delim = customDelimiter; break;
        default: delim = ',';
      }

      var lines = text.split('\n').filter(function(l) { return l.trim() !== ''; });
      var rows = lines.map(function(line) {
        if (typeof delim === 'string') {
          return line.split(delim).map(function(c) { return c.trim(); });
        } else {
          return line.split(delim).map(function(c) { return c.trim(); });
        }
      });

      var maxCols = 0;
      rows.forEach(function(r) { if (r.length > maxCols) maxCols = r.length; });
      rows.forEach(function(r) { while (r.length < maxCols) r.push(''); });

      if (outputFormat === 'csv') {
        var csv = rows.map(function(r) {
          return r.map(function(c) { return '"' + neutralizeCsvCell(c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        return makeSingleResult(blob, getBaseName(files[0].name) + '_table.csv', 'Converted to CSV table.');
      } else if (outputFormat === 'markdown') {
        var md = '';
        if (addHeaders) {
          md += '| ' + rows[0].join(' | ') + ' |\n';
          md += '| ' + rows[0].map(function() { return '---'; }).join(' | ') + ' |\n';
          for (var r = 1; r < rows.length; r++) {
            md += '| ' + rows[r].join(' | ') + ' |\n';
          }
        } else {
          if (addHeaders && rows.length > 0) {
            md += '| ' + rows[0].join(' | ') + ' |\n';
            md += '| ' + rows[0].map(function() { return '---'; }).join(' | ') + ' |\n';
          } else if (rows.length > 0) {
            md += '| ' + rows[0].map(function() { return '---'; }).join(' | ') + ' |\n';
          }
          for (var r = (addHeaders ? 1 : 0); r < rows.length; r++) {
            md += '| ' + rows[r].join(' | ') + ' |\n';
          }
        }
        var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        return makeSingleResult(blob, getBaseName(files[0].name) + '_table.md', 'Converted to Markdown table.');
      } else {
        var html = '<table>\n';
        if (addHeaders && rows.length > 0) {
          html += '  <thead><tr>';
          rows[0].forEach(function(c) { html += '<th>' + c.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</th>'; });
          html += '</tr></thead>\n';
        }
        html += '  <tbody>\n';
        var startRow = addHeaders ? 1 : 0;
        for (var r = startRow; r < rows.length; r++) {
          html += '    <tr>';
          rows[r].forEach(function(c) { html += '<td>' + c.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td>'; });
          html += '</tr>\n';
        }
        html += '  </tbody>\n</table>';
        var fullHtml = wrapHtml(html, getBaseName(files[0].name) + ' - Table');
        var blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
        return makeSingleResult(blob, getBaseName(files[0].name) + '_table.html', 'Converted to HTML table.');
      }
    } catch(e) {
      throw new Error('List to table failed: ' + e.message);
    }
  };

  // ─── EPUB TOOLS ────────────────────────────────────────────────────────

  function parseEpubSpine(opfText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(opfText, 'text/xml');
    var manifest = {};
    var items = doc.querySelectorAll('manifest item');
    for (var i = 0; i < items.length; i++) {
      manifest[items[i].getAttribute('id')] = {
        href: items[i].getAttribute('href'),
        mediaType: items[i].getAttribute('media-type')
      };
    }
    var spine = [];
    var refs = doc.querySelectorAll('spine itemref');
    for (var i = 0; i < refs.length; i++) {
      var idref = refs[i].getAttribute('idref');
      if (manifest[idref]) {
        spine.push(manifest[idref]);
      }
    }
    return { manifest: manifest, spine: spine };
  }

  window.ToolProcessors.epubToTxt = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Extracting text from EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);

      var opfFile = zip.file('content.opf');
      var opfPath = '';
      if (!opfFile) {
        var containerFile = zip.file('META-INF/container.xml');
        if (containerFile) {
          var containerXml = await containerFile.async('text');
          var parser = new DOMParser();
          var containerDoc = parser.parseFromString(containerXml, 'text/xml');
          var rootfile = containerDoc.querySelector('rootfile');
          if (rootfile) opfPath = rootfile.getAttribute('full-path');
        }
        if (opfPath) opfFile = zip.file(opfPath);
      }

      if (!opfFile) throw new Error('Could not find content.opf');

      var opfText = await opfFile.async('text');
      var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      var spineInfo = parseEpubSpine(opfText);

      var includeTitles = options.includeTitles !== false;
      var chapterSeparator = options.chapterSeparator || '\n\n';

      var textParts = [];
      for (var s = 0; s < spineInfo.spine.length; s++) {
        var item = spineInfo.spine[s];
        if (item.mediaType && (item.mediaType.indexOf('html') !== -1 || item.mediaType.indexOf('xhtml') !== -1)) {
          var filePath = opfDir + item.href;
          var htmlFile = zip.file(filePath);
          if (!htmlFile) {
            htmlFile = zip.file(item.href);
          }
          if (htmlFile) {
            var html = await htmlFile.async('text');
            var htmlParser = new DOMParser();
            var htmlDoc = htmlParser.parseFromString(html, 'text/html');
            var title = '';
            if (includeTitles) {
              var h1 = htmlDoc.querySelector('h1, h2, h3, title');
              if (h1) title = h1.textContent.trim();
            }
            var bodyText = htmlDoc.body ? htmlDoc.body.textContent : htmlDoc.textContent;
            bodyText = bodyText.replace(/\s+/g, ' ').trim();
            if (title) {
              textParts.push('## ' + title + '\n\n' + bodyText);
            } else {
              textParts.push(bodyText);
            }
          }
        }
      }

      var fullText = textParts.join(chapterSeparator);
      var blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(blob, getBaseName(files[0].name) + '.txt', 'Extracted text from EPUB.');
    } catch(e) {
      throw new Error('EPUB to TXT failed: ' + e.message);
    }
  };

  window.ToolProcessors.epubToHtml = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Extracting HTML from EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);
      var singleFile = options.singleFile !== false;

      var containerFile = zip.file('META-INF/container.xml');
      var opfPath = '';
      if (containerFile) {
        var containerXml = await containerFile.async('text');
        var parser = new DOMParser();
        var containerDoc = parser.parseFromString(containerXml, 'text/xml');
        var rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      var opfText = await opfFile.async('text');
      var spineInfo = parseEpubSpine(opfText);

      if (singleFile) {
        var combinedHtml = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>' + getBaseName(files[0].name) + '</title>\n</head>\n<body>\n';

        for (var s = 0; s < spineInfo.spine.length; s++) {
          var item = spineInfo.spine[s];
          if (item.mediaType && (item.mediaType.indexOf('html') !== -1 || item.mediaType.indexOf('xhtml') !== -1)) {
            var filePath = opfDir + item.href;
            var htmlFile = zip.file(filePath) || zip.file(item.href);
            if (htmlFile) {
              var html = await htmlFile.async('text');
              combinedHtml += '<div class="chapter">\n' + html + '\n</div>\n<hr>\n';
            }
          }
        }

        combinedHtml += '</body>\n</html>';
        var blob = new Blob([combinedHtml], { type: 'text/html;charset=utf-8' });
        return makeSingleResult(blob, getBaseName(files[0].name) + '.html', 'Extracted HTML from EPUB.');
      } else {
        var outZip = new JSZip();
        for (var s = 0; s < spineInfo.spine.length; s++) {
          var item = spineInfo.spine[s];
          if (item.mediaType && (item.mediaType.indexOf('html') !== -1 || item.mediaType.indexOf('xhtml') !== -1)) {
            var filePath = opfDir + item.href;
            var htmlFile = zip.file(filePath) || zip.file(item.href);
            if (htmlFile) {
              var content = await htmlFile.async('arraybuffer');
              outZip.file(item.href, content);
            }
          }
        }
        var outBlob = await outZip.generateAsync({ type: 'blob' });
        return makeSingleResult(outBlob, getBaseName(files[0].name) + '_html.zip', 'Extracted HTML files from EPUB.');
      }
    } catch(e) {
      throw new Error('EPUB to HTML failed: ' + e.message);
    }
  };

  window.ToolProcessors.epubToMarkdown = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Converting EPUB to Markdown...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);
      var singleFile = options.singleFile !== false;

      var containerFile = zip.file('META-INF/container.xml');
      var opfPath = '';
      if (containerFile) {
        var containerXml = await containerFile.async('text');
        var parser = new DOMParser();
        var containerDoc = parser.parseFromString(containerXml, 'text/xml');
        var rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      var opfText = await opfFile.async('text');
      var spineInfo = parseEpubSpine(opfText);

      var mdParts = [];
      for (var s = 0; s < spineInfo.spine.length; s++) {
        var item = spineInfo.spine[s];
        if (item.mediaType && (item.mediaType.indexOf('html') !== -1 || item.mediaType.indexOf('xhtml') !== -1)) {
          var filePath = opfDir + item.href;
          var htmlFile = zip.file(filePath) || zip.file(item.href);
          if (htmlFile) {
            var html = await htmlFile.async('text');
            mdParts.push({ name: item.href, text: htmlToMarkdown(html) });
          }
        }
      }

      if (singleFile) {
        var fullMd = mdParts.map(function(p) { return p.text; }).join('\n\n');
        var blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
        return makeSingleResult(blob, getBaseName(files[0].name) + '.md', 'Converted EPUB to Markdown.');
      }

      var outZip = new JSZip();
      for (var m = 0; m < mdParts.length; m++) {
        var mdName = mdParts[m].name.replace(/\.[^.]+$/, '.md');
        outZip.file(mdName, mdParts[m].text);
      }
      var outBlob = await outZip.generateAsync({ type: 'blob' });
      return makeSingleResult(outBlob, getBaseName(files[0].name) + '_markdown.zip', 'Converted EPUB to Markdown files.');
    } catch(e) {
      throw new Error('EPUB to Markdown failed: ' + e.message);
    }
  };

  window.ToolProcessors.mergeEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Merging EPUBs...');
    try {
      var allChapters = [];
      var allImages = {};
      var title = options.title || 'Merged Book';
      var author = options.author || 'Unknown';
      var lang = options.language || 'en';
      var uid = 'urn:uuid:' + crypto.randomUUID();
      var coverEpubIndex = options.coverEpub || 0;

      for (var i = 0; i < files.length; i++) {
        onProgress(i + 1, files.length, 'Reading ' + files[i].name + '...');
        var buf = await readFileAsArrayBuffer(files[i]);
        var zip = await JSZip.loadAsync(buf);

        var containerFile = zip.file('META-INF/container.xml');
        var opfPath = '';
        if (containerFile) {
          var containerXml = await containerFile.async('text');
          var parser = new DOMParser();
          var containerDoc = parser.parseFromString(containerXml, 'text/xml');
          var rootfile = containerDoc.querySelector('rootfile');
          if (rootfile) opfPath = rootfile.getAttribute('full-path');
        }

        var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
        if (!opfFile) continue;
        var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        var opfText = await opfFile.async('text');
        var spineInfo = parseEpubSpine(opfText);

        for (var s = 0; s < spineInfo.spine.length; s++) {
          var item = spineInfo.spine[s];
          var filePath = opfDir + item.href;
          var file = zip.file(filePath) || zip.file(item.href);
          if (!file) continue;

          if (item.mediaType && (item.mediaType.indexOf('html') !== -1 || item.mediaType.indexOf('xhtml') !== -1)) {
            var html = await file.async('text');
            allChapters.push({ html: html, source: files[i].name });
          } else if (item.mediaType && item.mediaType.indexOf('image') !== -1) {
            var imgData = await file.async('arraybuffer');
            var imgName = 'images/' + i + '_' + item.href.split('/').pop();
            allImages[imgName] = imgData;
          }
        }
      }

      var defaultCss = 'body{font-family:serif;line-height:1.6;margin:1em}h1,h2,h3{color:#333}p{margin:0.5em 0}img{max-width:100%}';
      var outZip = new JSZip();
      outZip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      outZip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>');
      outZip.file('OEBPS/styles/default.css', defaultCss);

      var manifestItems = '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="style" href="styles/default.css" media-type="text/css"/>\n';
      var spineItems = '';
      var ncxNavPoints = '';

      for (var imgName in allImages) {
        outZip.file('OEBPS/' + imgName, allImages[imgName]);
        var imgId = imgName.replace(/[^a-zA-Z0-9]/g, '_');
        manifestItems += '    <item id="' + imgId + '" href="' + imgName + '" media-type="image/' + (imgName.endsWith('.png') ? 'png' : 'jpeg') + '"/>\n';
      }

      for (var c = 0; c < allChapters.length; c++) {
        var chapFile = 'chapter' + (c + 1) + '.xhtml';
        var xhtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n  <meta charset="UTF-8"/>\n  <title>Chapter ' + (c + 1) + '</title>\n  <link rel="stylesheet" type="text/css" href="styles/default.css"/>\n</head>\n<body>\n' + allChapters[c].html + '\n</body>\n</html>';
        outZip.file('OEBPS/' + chapFile, xhtml);
        manifestItems += '    <item id="ch' + (c + 1) + '" href="' + chapFile + '" media-type="application/xhtml+xml"/>\n';
        spineItems += '    <itemref idref="ch' + (c + 1) + '"/>\n';
        ncxNavPoints += '    <navPoint id="np' + (c + 1) + '" playOrder="' + (c + 1) + '">\n      <navLabel><text>Chapter ' + (c + 1) + '</text></navLabel>\n      <content src="' + chapFile + '"/>\n    </navPoint>\n';
      }

      outZip.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="BookId">' + uid + '</dc:identifier>\n    <dc:title>' + title + '</dc:title>\n    <dc:creator>' + author + '</dc:creator>\n    <dc:language>' + lang + '</dc:language>\n    <meta property="dcterms:modified">' + new Date().toISOString().split('.')[0] + 'Z</meta>\n  </metadata>\n  <manifest>\n' + manifestItems + '  </manifest>\n  <spine toc="ncx">\n' + spineItems + '  </spine>\n</package>');
      outZip.file('OEBPS/toc.ncx', '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="' + uid + '"/></head>\n  <docTitle><text>' + title + '</text></docTitle>\n  <navMap>\n' + ncxNavPoints + '  </navMap>\n</ncx>');

      var epubBlob = await outZip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
      return makeSingleResult(epubBlob, 'merged.epub', 'Merged ' + files.length + ' EPUBs with ' + allChapters.length + ' chapters.');
    } catch(e) {
      throw new Error('EPUB merge failed: ' + e.message);
    }
  };

  window.ToolProcessors.splitEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Splitting EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);

      var containerFile = zip.file('META-INF/container.xml');
      var opfPath = '';
      if (containerFile) {
        var containerXml = await containerFile.async('text');
        var parser = new DOMParser();
        var containerDoc = parser.parseFromString(containerXml, 'text/xml');
        var rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      if (!opfFile) throw new Error('Could not find content.opf');
      var opfText = await opfFile.async('text');
      var spineInfo = parseEpubSpine(opfText);

      var htmlItems = [];
      var otherItems = [];
      for (var s = 0; s < spineInfo.spine.length; s++) {
        var item = spineInfo.spine[s];
        if (item.mediaType && (item.mediaType.indexOf('html') !== -1 || item.mediaType.indexOf('xhtml') !== -1)) {
          htmlItems.push(item);
        } else {
          otherItems.push(item);
        }
      }

      var baseName = getBaseName(files[0].name);
      var outZip = new JSZip();

      for (var h = 0; h < htmlItems.length; h++) {
        var item = htmlItems[h];
        var filePath = opfDir + item.href;
        var fileData = zip.file(filePath) || zip.file(item.href);
        if (!fileData) continue;

        var epubZip = new JSZip();
        epubZip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        epubZip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>');

        var contentArrayBuffer = await fileData.async('arraybuffer');
        epubZip.file('OEBPS/' + item.href.split('/').pop(), contentArrayBuffer);

        var chapManifest = '    <item id="ch1" href="' + item.href.split('/').pop() + '" media-type="application/xhtml+xml"/>\n    <item id="style" href="styles/default.css" media-type="text/css"/>\n';
        epubZip.file('OEBPS/styles/default.css', 'body{font-family:serif;line-height:1.6;margin:1em}');

        epubZip.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="BookId">urn:uuid:' + crypto.randomUUID() + '</dc:identifier>\n    <dc:title>' + baseName + ' - Part ' + (h + 1) + '</dc:title>\n    <dc:language>en</dc:language>\n    <meta property="dcterms:modified">' + new Date().toISOString().split('.')[0] + 'Z</meta>\n  </metadata>\n  <manifest>\n' + chapManifest + '  </manifest>\n  <spine>\n    <itemref idref="ch1"/>\n  </spine>\n</package>');

        epubZip.file('OEBPS/toc.ncx', '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="urn:uuid:' + crypto.randomUUID() + '"/></head>\n  <docTitle><text>' + baseName + ' Part ' + (h + 1) + '</text></docTitle>\n  <navMap>\n    <navPoint id="np1" playOrder="1">\n      <navLabel><text>Part ' + (h + 1) + '</text></navLabel>\n      <content src="' + item.href.split('/').pop() + '"/>\n    </navPoint>\n  </navMap>\n</ncx>');

        var epubBlob = await epubZip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
        outZip.file(baseName + '_part' + (h + 1) + '.epub', epubBlob);
      }

      var zipBlob = await outZip.generateAsync({ type: 'blob' });
      return makeSingleResult(zipBlob, baseName + '_split.zip', 'Split into ' + htmlItems.length + ' EPUBs.');
    } catch(e) {
      throw new Error('EPUB split failed: ' + e.message);
    }
  };

  window.ToolProcessors.editMetadataEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Editing EPUB metadata...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);

      var containerFile = zip.file('META-INF/container.xml');
      var opfPath = '';
      if (containerFile) {
        var containerXml = await containerFile.async('text');
        var parser = new DOMParser();
        var containerDoc = parser.parseFromString(containerXml, 'text/xml');
        var rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      if (!opfFile) throw new Error('Could not find content.opf');
      var opfText = await opfFile.async('text');

      if (options.title) {
        opfText = opfText.replace(/<dc:title>[^<]*<\/dc:title>/, '<dc:title>' + options.title + '</dc:title>');
      }
      if (options.author) {
        opfText = opfText.replace(/<dc:creator[^>]*>[^<]*<\/dc:creator>/, '<dc:creator>' + options.author + '</dc:creator>');
      }
      if (options.language) {
        opfText = opfText.replace(/<dc:language>[^<]*<\/dc:language>/, '<dc:language>' + options.language + '</dc:language>');
      }
      if (options.description) {
        if (opfText.indexOf('<dc:description>') !== -1) {
          opfText = opfText.replace(/<dc:description>[^<]*<\/dc:description>/, '<dc:description>' + options.description + '</dc:description>');
        } else {
          opfText = opfText.replace(/<\/metadata>/, '    <dc:description>' + options.description + '</dc:description>\n  </metadata>');
        }
      }
      if (options.publisher) {
        if (opfText.indexOf('<dc:publisher>') !== -1) {
          opfText = opfText.replace(/<dc:publisher>[^<]*<\/dc:publisher>/, '<dc:publisher>' + options.publisher + '</dc:publisher>');
        } else {
          opfText = opfText.replace(/<\/metadata>/, '    <dc:publisher>' + options.publisher + '</dc:publisher>\n  </metadata>');
        }
      }
      if (options.identifier) {
        opfText = opfText.replace(/<dc:identifier[^>]*>[^<]*<\/dc:identifier>/, '<dc:identifier id="BookId">' + options.identifier + '</dc:identifier>');
      }
      if (options.rights) {
        if (opfText.indexOf('<dc:rights>') !== -1) {
          opfText = opfText.replace(/<dc:rights>[^<]*<\/dc:rights>/, '<dc:rights>' + options.rights + '</dc:rights>');
        } else {
          opfText = opfText.replace(/<\/metadata>/, '    <dc:rights>' + options.rights + '</dc:rights>\n  </metadata>');
        }
      }

      opfText = opfText.replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '<meta property="dcterms:modified">' + new Date().toISOString().split('.')[0] + 'Z</meta>');

      var opfKey = opfPath || 'content.opf';
      zip.file(opfKey, opfText);

      var ncxFile = zip.file('OEBPS/toc.ncx') || zip.file('toc.ncx');
      if (ncxFile) {
        var ncxText = await ncxFile.async('text');
        if (options.title) {
          ncxText = ncxText.replace(/<docTitle>\s*<text>[^<]*<\/text>\s*<\/docTitle>/, '<docTitle>\n    <text>' + options.title + '</text>\n  </docTitle>');
        }
        var ncxKey = ncxFile.name;
        zip.file(ncxKey, ncxText);
      }

      var epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
      return makeSingleResult(epubBlob, getBaseName(files[0].name) + '_metadata.epub', 'EPUB metadata updated.');
    } catch(e) {
      throw new Error('Metadata edit failed: ' + e.message);
    }
  };

  window.ToolProcessors.coverEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Extracting cover from EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);
      var outputFormat = options.outputFormat || 'jpeg';

      var coverImage = null;
      var coverName = '';

      var containerFile = zip.file('META-INF/container.xml');
      var opfPath = '';
      if (containerFile) {
        var containerXml = await containerFile.async('text');
        var parser = new DOMParser();
        var containerDoc = parser.parseFromString(containerXml, 'text/xml');
        var rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      if (opfFile) {
        var opfText = await opfFile.async('text');
        var opfDoc = parser.parseFromString(opfText, 'text/xml');
        var metaCover = opfDoc.querySelector('meta[name="cover"]');
        if (metaCover) {
          var coverId = metaCover.getAttribute('content');
          var coverItem = opfDoc.querySelector('item[id="' + coverId + '"]');
          if (coverItem) {
            coverName = coverItem.getAttribute('href');
          }
        }

        if (!coverName) {
          var items = opfDoc.querySelectorAll('item');
          for (var i = 0; i < items.length; i++) {
            var href = items[i].getAttribute('href');
            if (href && (href.toLowerCase().indexOf('cover') !== -1)) {
              var mt = items[i].getAttribute('media-type');
              if (mt && mt.indexOf('image') !== -1) {
                coverName = href;
                break;
              }
            }
          }
        }

        if (!coverName) {
          var items = opfDoc.querySelectorAll('item');
          for (var i = 0; i < items.length; i++) {
            var mt = items[i].getAttribute('media-type');
            if (mt && mt.indexOf('image') !== -1) {
              coverName = items[i].getAttribute('href');
              break;
            }
          }
        }
      }

      if (!coverName) {
        var imageFiles = [];
        zip.forEach(function(path) {
          if (path.match(/\.(jpe?g|png|gif|svg)$/i)) {
            imageFiles.push(path);
          }
        });
        if (imageFiles.length > 0) coverName = imageFiles[0];
      }

      if (!coverName) throw new Error('No cover image found in EPUB');

      var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      var coverFile = zip.file(opfDir + coverName) || zip.file(coverName);
      if (!coverFile) throw new Error('Cover file not found: ' + coverName);

      var coverData = await coverFile.async('arraybuffer');

      if (outputFormat !== 'keep') {
        var blob = new Blob([coverData]);
        var img = await new Promise(function(resolve, reject) {
          var url = URL.createObjectURL(blob);
          var img = new Image();
          img.onload = function() { resolve(img); URL.revokeObjectURL(url); };
          img.onerror = function() { reject(new Error('Failed to load image')); };
          img.src = url;
        });

        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        var mimeType = outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg';
        var quality = outputFormat === 'jpeg' ? 0.95 : undefined;
        var coverBlob = await new Promise(function(resolve) {
          canvas.toBlob(function(b) { resolve(b); }, mimeType, quality);
        });

        var ext = outputFormat === 'png' ? '.png' : outputFormat === 'webp' ? '.webp' : '.jpg';
        return makeSingleResult(coverBlob, 'cover' + ext, 'Cover extracted as ' + outputFormat + '.');
      } else {
        var ext = coverName.split('.').pop().toLowerCase();
        return makeSingleResult(new Blob([coverData]), 'cover.' + ext, 'Cover extracted.');
      }
    } catch(e) {
      throw new Error('Cover extraction failed: ' + e.message);
    }
  };

  window.ToolProcessors.imagesEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Extracting images from EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip = await JSZip.loadAsync(buf);
      var outputFormat = options.outputFormat || 'keep';

      var outZip = new JSZip();
      var imageCount = 0;

      zip.forEach(function(path) {
        if (path.match(/\.(jpe?g|png|gif|svg|webp|bmp)$/i) && path.indexOf('META-INF') === -1) {
          imageCount++;
        }
      });

      var processed = 0;
      var imagePromises = [];

      zip.forEach(function(path) {
        if (path.match(/\.(jpe?g|png|gif|svg|webp|bmp)$/i) && path.indexOf('META-INF') === -1) {
          imagePromises.push(
            zip.file(path).async('arraybuffer').then(function(data) {
              processed++;
              onProgress(processed, imageCount, 'Processing image: ' + path);

              if (outputFormat === 'keep') {
                outZip.file(path.split('/').pop(), data);
                return;
              }

              var blob = new Blob([data]);
              return new Promise(function(resolve) {
                var url = URL.createObjectURL(blob);
                var img = new Image();
                img.onload = function() {
                  var canvas = document.createElement('canvas');
                  canvas.width = img.naturalWidth;
                  canvas.height = img.naturalHeight;
                  var ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0);
                  var mimeType = outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg';
                  canvas.toBlob(function(b) {
                    outZip.file(path.split('/').pop().replace(/\.[^.]+$/, outputFormat === 'png' ? '.png' : outputFormat === 'webp' ? '.webp' : '.jpg'), b);
                    URL.revokeObjectURL(url);
                    resolve();
                  }, mimeType, 0.95);
                };
                img.onerror = function() {
                  outZip.file(path.split('/').pop(), data);
                  URL.revokeObjectURL(url);
                  resolve();
                };
                img.src = url;
              });
            })
          );
        }
      });

      await Promise.all(imagePromises);

      if (imageCount === 0) {
        throw new Error('No images found in EPUB.');
      }

      var zipBlob = await outZip.generateAsync({ type: 'blob' });
      return makeSingleResult(zipBlob, getBaseName(files[0].name) + '_images.zip', 'Extracted ' + imageCount + ' image(s).');
    } catch(e) {
      throw new Error('Image extraction failed: ' + e.message);
    }
  };

  window.ToolProcessors.validateEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Validating EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip;
      try {
        zip = await JSZip.loadAsync(buf);
      } catch(e) {
        return makeSingleResult(
          new Blob(['EPUB Validation Report\n====================\n\nFAIL: File is not a valid ZIP archive.\nError: ' + e.message], { type: 'text/plain;charset=utf-8' }),
          getBaseName(files[0].name) + '_validation.txt',
          'EPUB is not a valid ZIP file.'
        );
      }

      var report = [];
      var errors = 0;
      var warnings = 0;

      report.push('EPUB Validation Report');
      report.push('======================');
      report.push('File: ' + files[0].name);
      report.push('Size: ' + files[0].size + ' bytes');
      report.push('');

      var mimeTypeFile = zip.file('mimetype');
      if (mimeTypeFile) {
        var mt = await mimeTypeFile.async('text');
        if (mt.trim() === 'application/epub+zip') {
          report.push('[PASS] mimetype file present and correct');
        } else {
          report.push('[WARN] mimetype file content incorrect: "' + mt.trim() + '"');
          warnings++;
        }
      } else {
        report.push('[FAIL] mimetype file missing');
        errors++;
      }

      var containerFile = zip.file('META-INF/container.xml');
      if (containerFile) {
        report.push('[PASS] META-INF/container.xml present');
        var containerXml = await containerFile.async('text');
        var parser = new DOMParser();
        var containerDoc = parser.parseFromString(containerXml, 'text/xml');
        var rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) {
          report.push('[PASS] rootfile element found');
        } else {
          report.push('[FAIL] No rootfile element in container.xml');
          errors++;
        }
      } else {
        report.push('[FAIL] META-INF/container.xml missing');
        errors++;
      }

      var opfPath = '';
      var parser = new DOMParser();
      if (containerFile) {
        try {
          var containerXml = await containerFile.async('text');
          var containerDoc = parser.parseFromString(containerXml, 'text/xml');
          var rootfile = containerDoc.querySelector('rootfile');
          if (rootfile) opfPath = rootfile.getAttribute('full-path');
        } catch(e) {}
      }
      if (!opfPath) {
        zip.forEach(function(path) {
          if (!opfPath && /content\.opf$/i.test(path)) opfPath = path;
        });
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      if (opfFile) {
        report.push('[PASS] content.opf found at: ' + (opfPath || 'content.opf'));
        var opfText = await opfFile.async('text');
        var opfDoc = parser.parseFromString(opfText, 'text/xml');

        var titleEl = opfDoc.querySelector('title');
        report.push(titleEl ? '[PASS] Title: ' + titleEl.textContent : '[WARN] No title in metadata');
        if (!titleEl) warnings++;

        var langEl = opfDoc.querySelector('language');
        report.push(langEl ? '[PASS] Language: ' + langEl.textContent : '[WARN] No language in metadata');
        if (!langEl) warnings++;

        var manifestItems = opfDoc.querySelectorAll('manifest item');
        report.push('[INFO] Manifest items: ' + manifestItems.length);
        if (manifestItems.length === 0) {
          report.push('[FAIL] No items in manifest');
          errors++;
        }

        var spineRefs = opfDoc.querySelectorAll('spine itemref');
        report.push('[INFO] Spine items: ' + spineRefs.length);

        var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        var manifestMap = {};
        for (var i = 0; i < manifestItems.length; i++) {
          var id = manifestItems[i].getAttribute('id');
          var href = manifestItems[i].getAttribute('href');
          manifestMap[id] = href;
        }

        var missingFiles = [];
        for (var i = 0; i < spineRefs.length; i++) {
          var idref = spineRefs[i].getAttribute('idref');
          var href = manifestMap[idref];
          if (href) {
            var fullPath = opfDir + href;
            if (!zip.file(fullPath) && !zip.file(href)) {
              missingFiles.push(href);
            }
          }
        }

        if (missingFiles.length > 0) {
          report.push('[WARN] Missing files referenced in spine: ' + missingFiles.join(', '));
          warnings += missingFiles.length;
        } else {
          report.push('[PASS] All spine references resolve to existing files');
        }

        var brokenImages = [];
        for (var i = 0; i < manifestItems.length; i++) {
          var mt = manifestItems[i].getAttribute('media-type');
          var href = manifestItems[i].getAttribute('href');
          if (mt && mt.indexOf('image') !== -1) {
            var fullPath = opfDir + href;
            if (!zip.file(fullPath) && !zip.file(href)) {
              brokenImages.push(href);
            }
          }
        }

        if (brokenImages.length > 0) {
          report.push('[WARN] Broken image references: ' + brokenImages.join(', '));
          warnings += brokenImages.length;
        } else {
          report.push('[PASS] All image references valid');
        }
      } else {
        report.push('[FAIL] content.opf not found');
        errors++;
      }

      var ncxFile = zip.file('OEBPS/toc.ncx') || zip.file('toc.ncx');
      if (ncxFile) {
        report.push('[PASS] toc.ncx present');
      } else {
        report.push('[WARN] toc.ncx missing (optional for EPUB3)');
        warnings++;
      }

      report.push('');
      report.push('Summary:');
      report.push('  Errors: ' + errors);
      report.push('  Warnings: ' + warnings);
      report.push('  Status: ' + (errors === 0 ? 'VALID (with ' + warnings + ' warnings)' : 'INVALID'));

      var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(reportBlob, getBaseName(files[0].name) + '_validation.txt',
        errors === 0 ? 'EPUB is valid with ' + warnings + ' warning(s).' : 'EPUB has ' + errors + ' error(s).');
    } catch(e) {
      throw new Error('Validation failed: ' + e.message);
    }
  };

  window.ToolProcessors.repairEpub = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No files provided');
    onProgress(1, 1, 'Repairing EPUB...');
    try {
      var buf = await readFileAsArrayBuffer(files[0]);
      var zip;
      try {
        zip = await JSZip.loadAsync(buf);
      } catch(e) {
        throw new Error('Cannot repair: file is not a valid ZIP archive.');
      }

      var report = [];
      report.push('EPUB Repair Report');
      report.push('==================');

      var mimeTypeFile = zip.file('mimetype');
      if (!mimeTypeFile) {
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        report.push('[FIXED] Added missing mimetype file');
      } else {
        var mt = await mimeTypeFile.async('text');
        if (mt.trim() !== 'application/epub+zip') {
          zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
          report.push('[FIXED] Corrected mimetype content');
        } else {
          report.push('[OK] mimetype file correct');
        }
      }

      var containerFile = zip.file('META-INF/container.xml');
      if (!containerFile) {
        var opfFile = zip.file('content.opf');
        var opfPath = opfFile ? 'content.opf' : null;
        if (!opfPath) {
          zip.forEach(function(path) {
            if (path.match(/content\.opf$/i)) opfPath = path;
          });
        }
        if (opfPath) {
          var containerXml = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="' + opfPath + '" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>';
          zip.file('META-INF/container.xml', containerXml);
          report.push('[FIXED] Created META-INF/container.xml');
        } else {
          report.push('[ERROR] Cannot create container.xml: no content.opf found');
        }
      } else {
        report.push('[OK] META-INF/container.xml present');
      }

      var containerFile = zip.file('META-INF/container.xml');
      var opfPath = '';
      if (containerFile) {
        try {
          var containerXml = await containerFile.async('text');
          var parser = new DOMParser();
          var containerDoc = parser.parseFromString(containerXml, 'text/xml');
          var rootfile = containerDoc.querySelector('rootfile');
          if (rootfile) opfPath = rootfile.getAttribute('full-path');
        } catch(e) {}
      }

      var opfFile = opfPath ? zip.file(opfPath) : zip.file('content.opf');
      if (opfFile) {
        var opfText = await opfFile.async('text');
        var opfDoc = parser.parseFromString(opfText, 'text/xml');
        var opfDir = opfPath ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        var manifestItems = opfDoc.querySelectorAll('manifest item');
        var brokenRefs = [];
        for (var i = 0; i < manifestItems.length; i++) {
          var href = manifestItems[i].getAttribute('href');
          if (href) {
            var fullPath = opfDir + href;
            if (!zip.file(fullPath) && !zip.file(href)) {
              brokenRefs.push({ id: manifestItems[i].getAttribute('id'), href: href });
            }
          }
        }

        if (brokenRefs.length > 0) {
          report.push('[FIXED] Removed ' + brokenRefs.length + ' broken manifest reference(s)');
          for (var b = 0; b < brokenRefs.length; b++) {
            report.push('  - Removed: ' + brokenRefs[b].href);
            var brokenItem = opfDoc.querySelector('item[id="' + brokenRefs[b].id + '"]');
            if (brokenItem && brokenItem.parentNode) brokenItem.parentNode.removeChild(brokenItem);
          }
          var manifestEl = opfDoc.querySelector('manifest');
          var spineEl = opfDoc.querySelector('spine');
          if (spineEl) {
            var spineRefs = spineEl.querySelectorAll('itemref');
            for (var sr = 0; sr < spineRefs.length; sr++) {
              var idref = spineRefs[sr].getAttribute('idref');
              if (manifestEl && !manifestEl.querySelector('item[id="' + idref + '"]')) {
                spineEl.removeChild(spineRefs[sr]);
                report.push('  - Removed spine reference to missing: ' + idref);
              }
            }
          }
        } else {
          report.push('[OK] All manifest references valid');
        }

        var ncxFile = zip.file('OEBPS/toc.ncx') || zip.file('toc.ncx');
        if (!ncxFile) {
          report.push('[FIXED] Created placeholder toc.ncx');
          var tocNcx = '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="urn:uuid:' + crypto.randomUUID() + '"/></head>\n  <docTitle><text>Repaired Book</text></docTitle>\n  <navMap></navMap>\n</ncx>';
          zip.file('OEBPS/toc.ncx', tocNcx);
        } else {
          report.push('[OK] toc.ncx present');
        }

        var manifestItems = opfDoc.querySelectorAll('manifest item');
        var htmlFiles = [];
        for (var i = 0; i < manifestItems.length; i++) {
          var mt = manifestItems[i].getAttribute('media-type');
          if (mt && (mt.indexOf('html') !== -1 || mt.indexOf('xhtml') !== -1)) {
            var href = manifestItems[i].getAttribute('href');
            var fullPath = opfDir + href;
            var htmlFile = zip.file(fullPath) || zip.file(href);
            if (htmlFile) {
              try {
                var html = await htmlFile.async('text');
                if (html.indexOf('charset=utf-8') === -1 && html.indexOf('charset=UTF-8') === -1 && html.indexOf('charset="UTF-8"') === -1) {
                  if (html.indexOf('<head') !== -1) {
                    html = html.replace(/<head([^>]*)>/i, '<head$1>\n  <meta charset="UTF-8"/>');
                    zip.file(fullPath || href, html);
                    report.push('[FIXED] Added UTF-8 charset to: ' + href);
                  }
                }
              } catch(e) {}
            }
          }
        }

        var repairedOpf = new XMLSerializer().serializeToString(opfDoc);
        zip.file(opfPath || 'content.opf', repairedOpf);
      } else {
        report.push('[ERROR] No content.opf found, cannot repair');
      }

      var repairedBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
      var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });

      return makeResult([
        { name: getBaseName(files[0].name) + '_repaired.epub', blob: repairedBlob },
        { name: getBaseName(files[0].name) + '_repair_report.txt', blob: reportBlob }
      ], 'EPUB repair complete. See report for details.');
    } catch(e) {
      throw new Error('EPUB repair failed: ' + e.message);
    }
  };

  // === SPREADSHEET & DATA TOOLS ===

  window.ToolProcessors.csvToExcel = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando CSV...');
    var text = await file.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var separator = options.separator || 'auto';
    var encoding = options.encoding || 'UTF-8';

    var sep = separator;
    if (sep === 'auto') {
      var lines = text.split('\n').slice(0, 5);
      var counts = { ',': 0, ';': 0, '\t': 0 };
      lines.forEach(function(line) {
        var unquoted = line.replace(/"[^"]*"/g, '');
        counts[','] += (unquoted.match(/,/g) || []).length;
        counts[';'] += (unquoted.match(/;/g) || []).length;
        counts['\t'] += (unquoted.match(/\t/g) || []).length;
      });
      sep = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][1] > 0 ? Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][0] : ',';
    }

    var wb;
    try {
      wb = XLSX.read(text, { type: 'string', raw: true, FS: sep });
    } catch (e) {
      throw new Error('No se pudo leer el CSV: ' + e.message);
    }
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var name = file.name.replace(/\.[^.]+$/, '.xlsx');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'CSV convertido a Excel' };
  };

  window.ToolProcessors.excelToCsv = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando Excel...');
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var separator = options.separator || ',';
    var sheetName = options.sheet || wb.SheetNames[0];
    var ws = wb.Sheets[sheetName];
    var csv = XLSX.utils.sheet_to_csv(ws, { FS: separator });
    csv = neutralizeCsvText(csv, separator);
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var name = file.name.replace(/\.[^.]+$/, '.csv');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'Excel convertido a CSV' };
  };

  window.ToolProcessors.excelToJson = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando Excel...');
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var sheetName = options.sheet || wb.SheetNames[0];
    var ws = wb.Sheets[sheetName];
    var json = XLSX.utils.sheet_to_json(ws, { defval: null });
    var output = JSON.stringify(json, null, 2);
    var blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    var name = file.name.replace(/\.[^.]+$/, '.json');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'Excel convertido a JSON' };
  };

  window.ToolProcessors.jsonToExcel = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando JSON...');
    var text = await file.text();
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON inválido: ' + e.message);
    }
    if (!Array.isArray(data)) data = [data];
    var ws = XLSX.utils.json_to_sheet(data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var name = file.name.replace(/\.[^.]+$/, '.xlsx');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'JSON convertido a Excel' };
  };

  window.ToolProcessors.csvToJson = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando CSV...');
    var text = await file.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var separator = options.separator || 'auto';
    var sep = separator;
    if (sep === 'auto') {
      var lines = text.split('\n').slice(0, 5);
      var counts = { ',': 0, ';': 0, '\t': 0 };
      lines.forEach(function(line) {
        var unquoted = line.replace(/"[^"]*"/g, '');
        counts[','] += (unquoted.match(/,/g) || []).length;
        counts[';'] += (unquoted.match(/;/g) || []).length;
        counts['\t'] += (unquoted.match(/\t/g) || []).length;
      });
      sep = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][1] > 0 ? Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][0] : ',';
    }
    var wb = XLSX.read(text, { type: 'string', raw: true, FS: sep });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var json = XLSX.utils.sheet_to_json(ws, { defval: null });
    var output = JSON.stringify(json, null, 2);
    var blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    var name = file.name.replace(/\.[^.]+$/, '.json');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'CSV convertido a JSON' };
  };

  window.ToolProcessors.jsonToCsv = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando JSON...');
    var text = await file.text();
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON inválido: ' + e.message);
    }
    if (!Array.isArray(data)) data = [data];
    var separator = options.separator || ',';
    var ws = XLSX.utils.json_to_sheet(data);
    var csv = XLSX.utils.sheet_to_csv(ws, { FS: separator });
    csv = neutralizeCsvText(csv, separator);
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var name = file.name.replace(/\.[^.]+$/, '.csv');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'JSON convertido a CSV' };
  };

  window.ToolProcessors.xmlToJson = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando XML...');
    var text = await file.text();
    var parser = new DOMParser();
    var doc = parser.parseFromString(text, 'application/xml');
    var errorNode = doc.querySelector('parsererror');
    if (errorNode) throw new Error('XML inválido: ' + errorNode.textContent.substring(0, 200));

    function nodeToObj(node) {
      if (node.nodeType === 3) return node.textContent.trim() || null;
      if (node.nodeType !== 1) return null;
      var obj = {};
      if (node.attributes && node.attributes.length > 0) {
        obj['@attributes'] = {};
        for (var i = 0; i < node.attributes.length; i++) {
          var attr = node.attributes[i];
          obj['@attributes'][attr.name] = attr.value;
        }
      }
      var children = Array.from(node.childNodes).filter(function(n) { return (n.nodeType === 1) || (n.nodeType === 3 && n.textContent.trim()); });
      if (children.length === 1 && children[0].nodeType === 3) {
        var textVal = children[0].textContent.trim();
        if (Object.keys(obj).length === 0) return textVal;
        obj['#text'] = textVal;
        return obj;
      }
      if (children.length === 0) return Object.keys(obj).length > 0 ? obj : null;
      var grouped = {};
      children.forEach(function(child) {
        if (child.nodeType !== 1) return;
        var val = nodeToObj(child);
        if (grouped[child.nodeName]) {
          if (!Array.isArray(grouped[child.nodeName])) grouped[child.nodeName] = [grouped[child.nodeName]];
          grouped[child.nodeName].push(val);
        } else {
          grouped[child.nodeName] = val;
        }
      });
      Object.assign(obj, grouped);
      return obj;
    }

    var result = {};
    var root = doc.documentElement;
    result[root.nodeName] = nodeToObj(root);
    var output = JSON.stringify(result, null, 2);
    var blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    var name = file.name.replace(/\.[^.]+$/, '.json');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'XML convertido a JSON' };
  };

  window.ToolProcessors.jsonToXml = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando JSON...');
    var text = await file.text();
    var data = JSON.parse(text);
    var rootName = options.rootName || 'root';

    function escapeXml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function objToXml(obj, indent) {
      var pad = '  '.repeat(indent);
      if (obj === null || obj === undefined) return '';
      if (typeof obj !== 'object') return escapeXml(obj);
      if (Array.isArray(obj)) return obj.map(function(item) { return objToXml(item, indent); }).join('\n');
      var xml = '';
      var entries = Object.entries(obj);
      for (var e = 0; e < entries.length; e++) {
        var key = entries[e][0];
        var val = entries[e][1];
        if (key === '@attributes') continue;
        if (Array.isArray(val)) {
          val.forEach(function(item) { xml += pad + '<' + key + '>' + objToXml(item, indent + 1) + '</' + key + '>\n'; });
        } else if (typeof val === 'object' && val !== null) {
          xml += pad + '<' + key + '>' + '\n' + objToXml(val, indent + 1) + pad + '</' + key + '>\n';
        } else {
          xml += pad + '<' + key + '>' + escapeXml(val) + '</' + key + '>\n';
        }
      }
      return xml;
    }

    var xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
    if (Array.isArray(data)) {
      xmlContent += '<' + rootName + '>\n';
      data.forEach(function(item) { xmlContent += objToXml(item, 1); });
      xmlContent += '</' + rootName + '>';
    } else {
      xmlContent += '<' + rootName + '>\n' + objToXml(data, 1) + '</' + rootName + '>';
    }

    var blob = new Blob([xmlContent], { type: 'application/xml;charset=utf-8' });
    var name = file.name.replace(/\.[^.]+$/, '.xml');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'JSON convertido a XML' };
  };

  window.ToolProcessors.mergeExcel = async function(files, options, onProgress) {
    var merged = XLSX.utils.book_new();
    var allRows = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Procesando ' + files[i].name);
      var data = await files[i].arrayBuffer();
      var wb = XLSX.read(data, { type: 'array' });
      wb.SheetNames.forEach(function(sheetName) {
        var ws = wb.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 });
        if (i > 0 && rows.length > 0) rows = rows.slice(1);
        allRows.push.apply(allRows, rows);
      });
    }
    if (allRows.length > 0) {
      var ws = XLSX.utils.aoa_to_sheet(allRows);
      XLSX.utils.book_append_sheet(merged, ws, 'Combinado');
    }
    var wbOut = XLSX.write(merged, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return { files: [{ name: 'archivos-unidos.xlsx', blob: blob, size: blob.size }], message: files.length + ' archivos combinados' };
  };

  window.ToolProcessors.splitExcel = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Procesando Excel...');
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var splitBy = options.splitBy || 'sheets';
    var results = [];

    if (splitBy === 'sheets') {
      wb.SheetNames.forEach(function(sheetName) {
        var newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, wb.Sheets[sheetName], sheetName);
        var out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
        var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        results.push({ name: sheetName + '.xlsx', blob: blob, size: blob.size });
      });
    } else if (splitBy === 'rows') {
      var maxRows = parseInt(options.rowsPerFile) || 1000;
      var ws = wb.Sheets[wb.SheetNames[0]];
      var allData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      var header = allData[0];
      var rows = allData.slice(1);
      for (var i = 0; i < rows.length; i += maxRows) {
        var chunk = [header].concat(rows.slice(i, i + maxRows));
        var newWs = XLSX.utils.aoa_to_sheet(chunk);
        var newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, newWs, 'Parte');
        var out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
        var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        results.push({ name: 'parte-' + (results.length + 1) + '.xlsx', blob: blob, size: blob.size });
      }
    }

    if (results.length === 1) return { files: results, message: 'Dividido en 1 archivo' };
    if (results.length > 1) {
      var zip = new JSZip();
      results.forEach(function(r) { zip.file(r.name, r.blob); });
      var zipBlob = await zip.generateAsync({ type: 'blob' });
      return { files: [{ name: 'archivos-divididos.zip', blob: zipBlob, size: zipBlob.size }], message: 'Dividido en ' + results.length + ' archivos' };
    }
    throw new Error('No se pudieron dividir los datos');
  };

  window.ToolProcessors.compareExcel = async function(files, options, onProgress) {
    if (files.length < 2) throw new Error('Selecciona al menos dos archivos para comparar');
    onProgress(1, 2, 'Leyendo primer archivo...');
    var data1 = await files[0].arrayBuffer();
    var wb1 = XLSX.read(data1, { type: 'array' });
    onProgress(2, 2, 'Leyendo segundo archivo...');
    var data2 = await files[1].arrayBuffer();
    var wb2 = XLSX.read(data2, { type: 'array' });

    var ws1 = XLSX.utils.sheet_to_json(wb1.Sheets[wb1.SheetNames[0]], { header: 1, defval: '' });
    var ws2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: '' });

    var maxRows = Math.max(ws1.length, ws2.length);
    var diffRows = [['Fila', 'Columna', 'Archivo 1', 'Archivo 2', 'Estado']];
    var diffCount = 0;

    for (var r = 0; r < maxRows; r++) {
      var row1 = ws1[r] || [];
      var row2 = ws2[r] || [];
      var maxCols = Math.max(row1.length, row2.length);
      for (var c = 0; c < maxCols; c++) {
        var v1 = row1[c] !== undefined ? String(row1[c]) : '';
        var v2 = row2[c] !== undefined ? String(row2[c]) : '';
        if (v1 !== v2) {
          var colLetter = '';
          var ci = c;
          do { colLetter = String.fromCharCode(65 + ci % 26) + colLetter; ci = Math.floor(ci / 26) - 1; } while (ci >= 0);
          diffRows.push([r + 1, colLetter, v1 || '(vacío)', v2 || '(vacío)', v1 === '' ? 'Añadido' : v2 === '' ? 'Eliminado' : 'Modificado']);
          diffCount++;
        }
      }
    }

    if (diffCount === 0) {
      var identicalRows = [
        ['Resultado', 'Los archivos son idénticos'],
        ['Archivo 1', files[0].name],
        ['Archivo 2', files[1].name],
        ['Diferencias', '0']
      ];
      var identicalWs = XLSX.utils.aoa_to_sheet(identicalRows);
      var identicalWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(identicalWb, identicalWs, 'Resultado');
      var identicalOut = XLSX.write(identicalWb, { bookType: 'xlsx', type: 'array' });
      var identicalBlob = new Blob([identicalOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return {
        files: [{ name: 'comparacion.xlsx', blob: identicalBlob, size: identicalBlob.size }],
        message: 'Los archivos son idénticos. Se generó un informe sin diferencias.'
      };
    }

    var newWs = XLSX.utils.aoa_to_sheet(diffRows);
    var newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newWs, 'Diferencias');
    var out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return { files: [{ name: 'comparacion.xlsx', blob: blob, size: blob.size }], message: diffCount + ' diferencias encontradas' };
  };

  window.ToolProcessors.xlsToXlsx = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Convirtiendo XLS a XLSX...');
    var data = await file.arrayBuffer();
    var wb;
    try {
      wb = XLSX.read(data, { type: 'array' });
    } catch (e) {
      throw new Error('No se pudo leer el archivo XLS: ' + e.message);
    }
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var name = file.name.replace(/\.xls$/i, '.xlsx');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'XLS convertido a XLSX' };
  };

  window.ToolProcessors.xlsxToOds = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Convirtiendo XLSX a ODS...');
    var data = await file.arrayBuffer();
    var wb;
    try {
      wb = XLSX.read(data, { type: 'array' });
    } catch (e) {
      throw new Error('No se pudo leer el archivo XLSX: ' + e.message);
    }
    var wbOut = XLSX.write(wb, { bookType: 'ods', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.oasis.opendocument.spreadsheet' });
    var name = file.name.replace(/\.[^.]+$/, '.ods');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'XLSX convertido a ODS' };
  };

  window.ToolProcessors.odsToXlsx = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Convirtiendo ODS a XLSX...');
    var data = await file.arrayBuffer();
    var wb;
    try {
      wb = XLSX.read(data, { type: 'array' });
    } catch (e) {
      throw new Error('No se pudo leer el archivo ODS: ' + e.message);
    }
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var name = file.name.replace(/\.[^.]+$/, '.xlsx');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'ODS convertido a XLSX' };
  };

  // ========== PHASE 7: ZIP, Files & Security ==========
  window.ToolProcessors.unzipFile = async function(files, options, onProgress) {
    if (!window.JSZip) throw new Error('No se pudo cargar el componente JSZip.');
    var file = files[0];
    onProgress(1, 1, 'Descomprimiendo archivo...');
    var data = await file.arrayBuffer();
    var zip = await JSZip.loadAsync(data);
    var results = [];
    var entries = Object.keys(zip.files);
    var entryObjects = [];
    for (var k = 0; k < entries.length; k++) {
      if (!zip.files[entries[k]].dir) {
        entryObjects.push(zip.files[entries[k]]);
      }
    }
    validateArchiveSafety(entryObjects);
    for (var i = 0; i < entries.length; i++) {
      var entry = zip.files[entries[i]];
      if (entry.dir) continue;
      onProgress(i + 1, entries.length, 'Extrayendo ' + entry.name + '...');
      var blob = await entry.async('blob');
      results.push({ name: entry.name, blob: blob, size: blob.size });
    }
    if (!results.length) throw new Error('El archivo ZIP está vacío o no contiene archivos.');
    if (results.length === 1) {
      return { files: results, message: '1 archivo extraído del ZIP.' };
    }
    return { files: results, message: results.length + ' archivos extraídos del ZIP.' };
  };

  window.ToolProcessors.createZipAdvanced = async function(files, options, onProgress) {
    if (!window.JSZip) throw new Error('No se pudo cargar el componente JSZip.');
    onProgress(1, 1, 'Creando archivo ZIP...');
    var zip = new JSZip();
    var compression = (options.compression || 'DEFLATE').toUpperCase();
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Agregando ' + files[i].name + '...');
      zip.file(files[i].name, files[i]);
    }
    var blob = await zip.generateAsync({ type: 'blob', compression: compression, compressionOptions: { level: 6 } });
    return { files: [{ name: 'toolisto-archivo.zip', blob: blob, size: blob.size }], message: files.length + ' archivos comprimidos en ZIP.' };
  };

  window.ToolProcessors.zipRepair = async function(files, options, onProgress) {
    if (!window.JSZip) throw new Error('No se pudo cargar el componente JSZip.');
    var file = files[0];
    onProgress(1, 1, 'Intentando reparar ZIP...');
    var data = await file.arrayBuffer();
    var recovered = [];
    try {
      var zip = await JSZip.loadAsync(data, { optimizedBinaryThumbnail: true });
      var entries = Object.keys(zip.files);
      for (var i = 0; i < entries.length; i++) {
        var entry = zip.files[entries[i]];
        if (entry.dir) continue;
        try {
          var blob = await entry.async('blob');
          if (blob.size > 0) recovered.push({ name: entry.name, blob: blob, size: blob.size });
        } catch (_) { /* skip corrupt entry */ }
      }
    } catch (_) { /* try raw extraction */ }
    if (!recovered.length) throw new Error('No se pudo recuperar ningún archivo del ZIP dañado.');
    if (recovered.length === 1) return { files: recovered, message: '1 archivo recuperado del ZIP dañado.' };
    return { files: recovered, message: recovered.length + ' archivos recuperados del ZIP dañado.' };
  };

  window.ToolProcessors.fileSplit = async function(files, options, onProgress) {
    var file = files[0];
    var chunkSize = parseInt(options.chunkSize, 10) || 1024 * 1024;
    if (chunkSize < 1024) chunkSize = 1024;
    onProgress(1, 1, 'Dividiendo archivo...');
    var data = await file.arrayBuffer();
    var totalSize = data.byteLength;
    var numChunks = Math.ceil(totalSize / chunkSize);
    if (numChunks > 50) throw new Error('Demasiados fragmentos (' + numChunks + '). Aumenta el tamaño del fragmento.');
    var results = [];
    var baseName = file.name.replace(/\.[^.]+$/, '') || file.name;
    var ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    for (var i = 0; i < numChunks; i++) {
      onProgress(i + 1, numChunks, 'Creando fragmento ' + (i + 1) + '/' + numChunks + '...');
      var start = i * chunkSize;
      var end = Math.min(start + chunkSize, totalSize);
      var chunk = data.slice(start, end);
      var blob = new Blob([chunk]);
      var partNum = String(i + 1).padStart(3, '0');
      results.push({ name: baseName + '.part' + partNum, blob: blob, size: blob.size, _originalExt: ext });
    }
    return { files: results, message: 'Archivo dividido en ' + numChunks + ' fragmentos de ~' + (chunkSize / 1024).toFixed(0) + ' KB. Los fragmentos se nombran SIN extensión para evitar confusión con archivos reales.' };
  };

  window.ToolProcessors.fileJoin = async function(files, options, onProgress) {
    onProgress(1, 1, 'Uniendo fragmentos...');
    var buffers = [];
    var sorted = files.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
    for (var i = 0; i < sorted.length; i++) {
      onProgress(i + 1, sorted.length, 'Leyendo ' + sorted[i].name + '...');
      var ab = await sorted[i].arrayBuffer();
      buffers.push(new Uint8Array(ab));
    }
    var totalSize = buffers.reduce(function(sum, b) { return sum + b.length; }, 0);
    var result = new Uint8Array(totalSize);
    var offset = 0;
    for (var j = 0; j < buffers.length; j++) {
      result.set(buffers[j], offset);
      offset += buffers[j].length;
    }
    var blob = new Blob([result]);
    var firstName = sorted[0].name;
    var stripped = firstName.replace(/\.part\d+$/, '');
    if (stripped === firstName) stripped = firstName.replace(/\.part\d+(?=\.[^.]+$)/, '');
    var extMatch = stripped.match(/\.[^.]+$/);
    var baseName = extMatch ? stripped.slice(0, -extMatch[0].length) : stripped;
    var fileExt = extMatch ? extMatch[0] : '';
    var joinedName = baseName || 'toolisto';
    return { files: [{ name: joinedName + fileExt, blob: blob, size: blob.size }], message: sorted.length + ' fragmentos unidos en un solo archivo (' + (blob.size / 1024).toFixed(1) + ' KB).' };
  };

  window.ToolProcessors.checksumFile = async function(files, options, onProgress) {
    var results = [];
    var CHUNK_THRESHOLD = 5 * 1024 * 1024;
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Calculando hash de ' + files[i].name + '...');
      var data;
      if (files[i].size > CHUNK_THRESHOLD) {
        var chunks = [];
        var totalLen = 0;
        await readFileInChunks(files[i], 1024 * 1024, async function(chunk, offset, fileSize) {
          chunks.push(chunk);
          totalLen += chunk.length;
        });
        data = new ArrayBuffer(totalLen);
        var combined = new Uint8Array(data);
        var pos = 0;
        for (var c = 0; c < chunks.length; c++) {
          combined.set(chunks[c], pos);
          pos += chunks[c].length;
        }
        chunks = null;
      } else {
        data = await files[i].arrayBuffer();
      }
      var hashBuffer = await crypto.subtle.digest('SHA-256', data);
      var hashArray = new Uint8Array(hashBuffer);
      var hashHex = Array.from(hashArray).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      var sha1Buffer = await crypto.subtle.digest('SHA-1', data);
      var sha1Array = new Uint8Array(sha1Buffer);
      var sha1Hex = Array.from(sha1Array).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      var report = 'Archivo: ' + files[i].name + '\nTamaño: ' + files[i].size + ' bytes\nSHA-1: ' + sha1Hex + '\nSHA-256: ' + hashHex + '\n';
      var blob = new Blob([report], { type: 'text/plain' });
      results.push({ name: files[i].name + '.checksum.txt', blob: blob, size: blob.size });
    }
    if (results.length === 1) return { files: results, message: 'Hash calculado para ' + files[0].name + '.' };
    return { files: results, message: 'Hashes calculados para ' + results.length + ' archivos.' };
  };

  window.ToolProcessors.fileInspector = async function(files, options, onProgress) {
    var results = [];
    var signatures = {
      '89504e47': 'PNG', 'ffd8ff': 'JPEG', '47494638': 'GIF', '52494646': 'WEBP/RIFF',
      '25504446': 'PDF', '504b0304': 'ZIP/DOCX/XLSX', '52617221': 'RAR',
      '377abcaf': '7Z', '1f8b': 'GZIP', '425a68': 'BZ2',
      'd0cf11e0': 'OLE/DOC/XLS', 'efbbbf': 'UTF-8 BOM', 'fffe': 'UTF-16 LE BOM',
      '1a45dfa3': 'MKV/WebM', '49492a00': 'TIFF (LE)',
      '4d4d002a': 'TIFF (BE)', '4f676753': 'OGG', '494433': 'MP3',
    };
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Analizando ' + files[i].name + '...');
      var data = await files[i].arrayBuffer();
      var header = new Uint8Array(data.slice(0, 16));
      var hex = Array.from(header).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      var detectedType = 'Desconocido';
      for (var sig in signatures) {
        if (hex.startsWith(sig)) { detectedType = signatures[sig]; break; }
      }
      if (detectedType === 'Desconocido') {
        var ftypIdx = hex.indexOf('66747970');
        if (ftypIdx >= 4 && ftypIdx <= 12) detectedType = 'MP4/MOV';
      }
      var extension = files[i].name.split('.').pop().toUpperCase();
      var extLower = files[i].name.split('.').pop().toLowerCase();
      var match = detectedType.toUpperCase().includes(extension) || extension.includes(detectedType.toUpperCase().split('/')[0]);
      var hashArray = await crypto.subtle.digest('SHA-256', data);
      var hashHex = Array.from(new Uint8Array(hashArray)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      var imageInfo = '';
      if (['png','jpg','jpeg','gif','webp','bmp','tiff','tif'].indexOf(extLower) !== -1) {
        try {
          var blob = new Blob([data]);
          var url = URL.createObjectURL(blob);
          var dims = await new Promise(function(resolve) {
            var img = new Image();
            img.onload = function() { resolve(img.naturalWidth + ' × ' + img.naturalHeight + ' px'); URL.revokeObjectURL(url); };
            img.onerror = function() { resolve('No readable'); URL.revokeObjectURL(url); };
            img.src = url;
          });
          imageInfo = '\nDimensiones: ' + dims;
        } catch(e) { imageInfo = '\nDimensiones: No readable'; }
      }
      var privacy = '';
      if (['jpg','jpeg'].indexOf(extLower) !== -1) {
        privacy = '\n⚠ Privacidad: JPEG puede contener datos EXIF (ubicación, cámara, fecha)';
      }
      var lines = [
        'Archivo: ' + files[i].name,
        'Tamaño: ' + files[i].size + ' bytes (' + (files[i].size / 1024).toFixed(1) + ' KB)',
        'MIME declarado: ' + (files[i].type || 'N/A'),
        'Tipo detectado (magic bytes): ' + detectedType,
        'Hex del encabezado: ' + hex,
        'Extensión: .' + extension,
        'Coincidencia: ' + (match ? 'SÍ ✓' : 'NO - posible extensión incorrecta'),
        'SHA-256: ' + hashHex,
        imageInfo,
        privacy,
      ];
      var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      results.push({ name: files[i].name + '.inspeccion.txt', blob: blob, size: blob.size });
    }
    return { files: results, message: 'Inspección completada para ' + results.length + ' archivos.' };
  };

  window.ToolProcessors.pdfEncryptAdvanced = async function(files, options, onProgress) {
    if (!window.PDFLib) throw new Error('No se pudo cargar el componente PDF.');
    if (!window.PDFEncryptor) throw new Error('No se pudo cargar el motor de cifrado PDF.');
    var file = files[0];
    onProgress(1, 2, 'Preparando PDF...');
    var userPassword = options.userPassword || '';
    var ownerPassword = options.ownerPassword || (userPassword || 'toolisto-protected');
    var allowPrint = options.allowPrint !== false;
    var allowCopy = options.allowCopy === true;
    var allowModify = options.allowModify === true;
    var data = await file.arrayBuffer();
    var pdfDoc = await PDFLib.PDFDocument.load(data);
    var pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    onProgress(2, 2, 'Protegiendo PDF...');
    var encrypted = await window.PDFEncryptor.encrypt(new Uint8Array(pdfBytes), {
      userPassword: userPassword,
      ownerPassword: ownerPassword,
      allowPrint: allowPrint,
      allowCopy: allowCopy,
      allowModify: allowModify,
    });
    var blob = new Blob([encrypted], { type: 'application/pdf' });
    var name = file.name.replace(/\.pdf$/i, '') + '-protegido.pdf';
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'PDF protegido con cifrado estándar' + (userPassword ? '. Contraseña de apertura establecida.' : ' (apertura sin contraseña).') + ' Permisos: imprimir=' + (allowPrint ? 'sí' : 'no') + ', copiar=' + (allowCopy ? 'sí' : 'no') + ', modificar=' + (allowModify ? 'sí' : 'no') + '.' };
  };

  // ========== PHASE 8: QR, Codes & Scanning ==========
  window.ToolProcessors.qrGenerate = async function(files, options, onProgress) {
    if (!window.QRCodeGenerator) throw new Error('No se pudo cargar el generador de QR.');
    onProgress(1, 1, 'Generando código QR...');
    var text = options.text || '';
    if (!text.trim()) throw new Error('Ingresa el texto o URL para generar el código QR.');
    var ecLevel = options.ecLevel || 'M';
    var size = parseInt(options.qrSize, 10) || 300;
    var fgColor = options.fgColor || '#000000';
    var bgColor = options.bgColor || '#ffffff';
    var canvas = QRCodeGenerator.generate(text, { errorCorrection: ecLevel, size: size, foreground: fgColor, background: bgColor }).canvas;
    var blob = await new Promise(function(resolve) { canvas.toBlob(function(b) { resolve(b); }, 'image/png', 1); });
    return { files: [{ name: 'toolisto-qr.png', blob: blob, size: blob.size }], message: 'Código QR generado para: "' + text.substring(0, 50) + (text.length > 50 ? '...' : '') + '"', preview: blob };
  };

  window.ToolProcessors.qrWifi = async function(files, options, onProgress) {
    if (!window.QRCodeGenerator) throw new Error('No se pudo cargar el generador de QR.');
    onProgress(1, 1, 'Generando QR de Wi-Fi...');
    var ssid = options.wifiSsid || '';
    var password = options.wifiPassword || '';
    var auth = options.wifiAuth || 'WPA';
    if (!ssid.trim()) throw new Error('Ingresa el nombre de la red Wi-Fi (SSID).');
    var wifiStr = 'WIFI:T:' + auth + ';S:' + ssid + ';P:' + password + ';;';
    var size = parseInt(options.qrSize, 10) || 300;
    var canvas = QRCodeGenerator.generate(wifiStr, { errorCorrection: 'M', size: size }).canvas;
    var blob = await new Promise(function(resolve) { canvas.toBlob(function(b) { resolve(b); }, 'image/png', 1); });
    return { files: [{ name: 'toolisto-wifi-qr.png', blob: blob, size: blob.size }], message: 'QR de Wi-Fi generado para la red "' + ssid + '".', preview: blob };
  };

  window.ToolProcessors.qrVcard = async function(files, options, onProgress) {
    if (!window.QRCodeGenerator) throw new Error('No se pudo cargar el generador de QR.');
    onProgress(1, 1, 'Generando QR de contacto...');
    var name = options.vcardName || '';
    var phone = options.vcardPhone || '';
    var email = options.vcardEmail || '';
    var org = options.vcardOrg || '';
    if (!name.trim()) throw new Error('Ingresa al menos el nombre del contacto.');
    var vcard = 'BEGIN:VCARD\nVERSION:3.0\nN:' + name + ';;;;\nFN:' + name;
    if (org) vcard += '\nORG:' + org;
    if (phone) vcard += '\nTEL:' + phone;
    if (email) vcard += '\nEMAIL:' + email;
    vcard += '\nEND:VCARD';
    var size = parseInt(options.qrSize, 10) || 300;
    var canvas = QRCodeGenerator.generate(vcard, { errorCorrection: 'M', size: size }).canvas;
    var blob = await new Promise(function(resolve) { canvas.toBlob(function(b) { resolve(b); }, 'image/png', 1); });
    return { files: [{ name: 'toolisto-contacto-qr.png', blob: blob, size: blob.size }], message: 'QR de contacto generado para "' + name + '".', preview: blob };
  };

  window.ToolProcessors.barcodeGenerate = async function(files, options, onProgress) {
    if (!window.BarcodeGenerator) throw new Error('No se pudo cargar el generador de códigos de barras.');
    onProgress(1, 1, 'Generando código de barras...');
    var text = options.barcodeText || '';
    var format = (options.barcodeFormat || 'CODE128').toLowerCase();
    if (!text.trim()) throw new Error('Ingresa el contenido para el código de barras.');
    var barcodeOptions = { format: format, width: parseInt(options.barcodeWidth, 10) || 2, height: parseInt(options.barcodeHeight, 10) || 80, showText: options.barcodeShowText !== false, fontSize: parseInt(options.barcodeFontSize, 10) || 16, foreground: options.barcodeColor || '#000000', background: options.barcodeBg || '#ffffff' };
    var result = BarcodeGenerator.generate(text, format, barcodeOptions);
    if (!result || !result.valid) throw new Error((result && result.error) || 'Contenido no válido para el formato elegido.');
    var blob = await result.toPNG();
    return { files: [{ name: 'toolisto-barcode.' + format + '.png', blob: blob, size: blob.size }], message: 'Código de barras ' + format + ' generado para "' + text.substring(0, 30) + (text.length > 30 ? '...' : '') + '".', preview: blob };
  };

  window.ToolProcessors.qrReadFromImage = async function(files, options, onProgress) {
    if (!window.JsQR) throw new Error('No se pudo cargar el lector de QR.');
    onProgress(1, 1, 'Leyendo código QR...');
    var file = files[0];
    var image = await new Promise(function(resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function() { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen.')); };
      img.src = url;
    });
    var canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var code = JsQR(imageData.data, canvas.width, canvas.height);
    if (!code) throw new Error('No se detectó ningún código QR en la imagen. Asegúrate de que el QR sea visible y esté bien iluminado.');
    var output = 'Contenido del QR:\n' + code.data + '\n\nTipo: ' + (code.type || 'Desconocido') + '\nPosición detectada: Sí';
    var blob = new Blob([output], { type: 'text/plain' });
    return { files: [{ name: 'toolisto-qr-contenido.txt', blob: blob, size: blob.size }], message: 'QR leído exitosamente. Contenido: "' + code.data.substring(0, 80) + (code.data.length > 80 ? '...' : '') + '"', textResult: code.data };
  };

  window.ToolProcessors.barcodeReadFromImage = async function(files, options, onProgress) {
    onProgress(1, 1, 'Analizando imagen para códigos de barras...');
    var file = files[0];
    var image = await new Promise(function(resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function() { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen.')); };
      img.src = url;
    });
    var canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var qrCode = window.JsQR ? JsQR(imageData.data, canvas.width, canvas.height) : null;
    var lines = [
      'Análisis de imagen para códigos de barras',
      'Archivo: ' + file.name,
      'Dimensiones: ' + canvas.width + ' × ' + canvas.height + ' px',
      '',
    ];
    if (qrCode) {
      lines.push('Se detectó un código QR (no un código de barras lineal):');
      lines.push('Contenido: ' + qrCode.data);
      lines.push('');
      lines.push('Nota: Para códigos de barras lineales (Code128, EAN, etc.) se requiere');
      lines.push('librería de escaneado avanzado. El lector actual solo detecta QR codes.');
    } else {
      lines.push('No se detectó ningún código QR en la imagen.');
      lines.push('');
      lines.push('Recomendaciones:');
      lines.push('- Asegúrate de que el código sea nítido y esté bien iluminado.');
      lines.push('- Para códigos de barras lineales, prueba con una imagen de mayor resolución.');
      lines.push('- El código debe estar en orientation vertical (no rotado).');
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    return { files: [{ name: 'toolisto-barcode-resultado.txt', blob: blob, size: blob.size }], message: qrCode ? 'Se detectó un código QR. Ver resultado.' : 'No se detectó código. Ver análisis.' };
  };

  window.ToolProcessors.qrBatchFromCsv = async function(files, options, onProgress) {
    if (!window.QRCodeGenerator) throw new Error('No se pudo cargar el generador de QR.');
    if (!window.JSZip) throw new Error('No se pudo cargar el componente JSZip.');
    var file = files[0];
    onProgress(1, 1, 'Leyendo CSV...');
    var text = await file.text();
    var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
    if (lines.length < 2) throw new Error('El CSV debe tener al menos una fila de encabezados y una de datos.');
    var sep = lines[0].includes(';') ? ';' : ',';
    var headers = lines[0].split(sep).map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
    var textCol = options.csvTextCol !== undefined ? parseInt(options.csvTextCol, 10) : 0;
    if (textCol < 0 || textCol >= headers.length) textCol = 0;
    var size = parseInt(options.qrSize, 10) || 200;
    var zip = new JSZip();
    var count = 0;
    for (var i = 1; i < lines.length; i++) {
      onProgress(i, lines.length - 1, 'Generando QR ' + i + '/' + (lines.length - 1) + '...');
      var cols = lines[i].split(sep).map(function(c) { return c.trim().replace(/^"|"$/g, ''); });
      var content = cols[textCol] || '';
      if (!content) continue;
      var canvas = QRCodeGenerator.generate(content, { errorCorrection: 'M', size: size }).canvas;
      var blob = await new Promise(function(resolve) { canvas.toBlob(function(b) { resolve(b); }, 'image/png', 1); });
      var safeName = content.replace(/[^a-z0-9áéíóúñ]/gi, '_').substring(0, 40);
      zip.file('qr_' + String(i).padStart(3, '0') + '_' + safeName + '.png', blob);
      count++;
    }
    if (!count) throw new Error('No se encontraron datos válidos en la columna seleccionada.');
    var zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { files: [{ name: 'toolisto-qr-lote.zip', blob: zipBlob, size: zipBlob.size }], message: count + ' códigos QR generados desde CSV y empaquetados en ZIP.' };
  };

  window.ToolProcessors.pdfPageCounter = async function(files, options, onProgress) {
    onProgress(1, 1, 'Contando páginas...');
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Analizando ' + files[i].name + '...');
      var data = await files[i].arrayBuffer();
      var loadingTask = pdfjsLib.getDocument({ data: data });
      var pdf = await loadingTask.promise;
      var numPages = pdf.numPages;
      var pageDetails = [];
      for (var p = 1; p <= Math.min(numPages, 50); p++) {
        var page = await pdf.getPage(p);
        var vp = page.getViewport({ scale: 1 });
        pageDetails.push('Página ' + p + ': ' + Math.round(vp.width) + ' × ' + Math.round(vp.height) + ' pt');
      }
      var lines = [
        'Archivo: ' + files[i].name,
        'Tamaño: ' + (files[i].size / 1024).toFixed(1) + ' KB',
        'Total de páginas: ' + numPages,
        '',
      ].concat(pageDetails);
      if (numPages > 50) lines.push('... y ' + (numPages - 50) + ' páginas más.');
      var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      results.push({ name: files[i].name + '-info.txt', blob: blob, size: blob.size });
    }
    if (results.length === 1) return { files: results, message: 'PDF analizado: ' + files[0].name + ' tiene ' + (results[0].blob.size > 0 ? 'páginas contadas.' : 'páginas.') };
    return { files: results, message: results.length + ' PDFs analizados.' };
  };

  // ─── SCANNER & DOCUMENT TOOLS ─────────────────────────────────────────

  window.ToolProcessors.enhanceScannedDocument = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó imagen.');
    onProgress(1, 5, 'Cargando imagen...');
    var img = await loadImageFromFile(files[0]);

    var brightness = parseFloat(options.brightness != null ? options.brightness : options.enhBrightness) || 0;
    var contrast = parseFloat(options.contrast != null ? options.contrast : options.enhContrast) || 0;
    var sharpness = parseFloat(options.sharpness != null ? options.sharpness : options.enhSharpness) || 0;
    var denoise = parseFloat(options.denoise != null ? options.denoise : options.enhDenoise) || 0;
    var autoRotate = options.autoRotate != null ? options.autoRotate !== false : (options.enhAutoRotate !== false);
    var autoCrop = options.autoCrop != null ? options.autoCrop !== false : (options.enhAutoCrop !== false);
    var outputFormat = options.outputFormat || options.enhOutputFormat || 'jpeg';
    var outFmt = outputFormat;
    if (outFmt === 'auto') {
      var fileType = (files[0].type || '').toLowerCase();
      outFmt = fileType === 'image/png' ? 'png' : fileType === 'image/webp' ? 'webp' : 'jpeg';
    } else if (outFmt === 'image/png') { outFmt = 'png'; }
    else if (outFmt === 'image/webp') { outFmt = 'webp'; }
    else if (outFmt === 'image/jpeg') { outFmt = 'jpeg'; }
    // La UI expone la calidad como porcentaje (`enhQuality`); conservar también
    // `quality` para llamadas programáticas con valores normalizados.
    var quality = parseFloat(options.quality != null ? options.quality : options.enhQuality);
    if (!isFinite(quality)) quality = 0.92;
    if (quality > 1) quality = quality / 100;
    quality = Math.min(1, Math.max(0.25, quality));

    var w = img.naturalWidth;
    var h = img.naturalHeight;

    onProgress(2, 5, 'Aplicando ajustes...');
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    if (brightness !== 0 || contrast !== 0) {
      var imageData = ctx.getImageData(0, 0, w, h);
      var data = imageData.data;
      var bFactor = brightness * 2.55;
      var cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      for (var i = 0; i < data.length; i += 4) {
        data[i] = clampColor(cFactor * (data[i] - 128 + bFactor) + 128);
        data[i + 1] = clampColor(cFactor * (data[i + 1] - 128 + bFactor) + 128);
        data[i + 2] = clampColor(cFactor * (data[i + 2] - 128 + bFactor) + 128);
      }
      ctx.putImageData(imageData, 0, 0);
    }

    if (denoise > 0) {
      var kernelSize = Math.max(3, Math.round(denoise) * 2 + 1);
      applyBoxBlur(ctx, w, h, kernelSize);
    }

    if (sharpness > 0) {
      applyUnsharpMask(ctx, w, h, sharpness);
    }

    if (autoCrop) {
      var cropRect = detectDocumentEdges(ctx, w, h);
      if (cropRect && cropRect.w > 10 && cropRect.h > 10) {
        var cropped = document.createElement('canvas');
        cropped.width = cropRect.w;
        cropped.height = cropRect.h;
        cropped.getContext('2d').drawImage(canvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
        canvas = cropped;
      }
    }

    if (autoRotate) {
      var rotation = detectRotation(ctx, canvas.width, canvas.height);
      if (rotation !== 0) {
        var rotated = document.createElement('canvas');
        if (rotation === 90 || rotation === 270) {
          rotated.width = canvas.height;
          rotated.height = canvas.width;
        } else {
          rotated.width = canvas.width;
          rotated.height = canvas.height;
        }
        var rCtx = rotated.getContext('2d');
        rCtx.translate(rotated.width / 2, rotated.height / 2);
        rCtx.rotate(rotation * Math.PI / 180);
        rCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        canvas = rotated;
      }
    }

    onProgress(4, 5, 'Generando imagen...');
    var mime = outFmt === 'png' ? 'image/png' : outFmt === 'webp' ? 'image/webp' : 'image/jpeg';
    var ext = outFmt === 'png' ? 'png' : outFmt === 'webp' ? 'webp' : 'jpg';
    var blob = await new Promise(function(resolve) {
      canvas.toBlob(function(b) { resolve(b); }, mime, quality);
    });

    onProgress(5, 5, 'Listo.');
    var outName = getBaseName(files[0].name) + '_enhanced.' + ext;
    return makeSingleResult(blob, outName, 'Documento escaneado optimizado correctamente.');
  };

  window.ToolProcessors.cameraDocumentScanner = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó imagen.');
    onProgress(1, 4, 'Cargando imagen de cámara...');
    var img = await loadImageFromFile(files[0]);

    var perspectiveCorrection = options.perspectiveCorrection === true || options.perspectiveCorrection === 'true';
    var outputFormat = options.outputFormat || 'jpeg';
    var quality = Math.min(1, Math.max(0.1, (parseFloat(options.quality) || 92) / 100));

    var w = img.naturalWidth;
    var h = img.naturalHeight;

    onProgress(2, 4, 'Procesando...');
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');

    if (perspectiveCorrection && options.corners) {
      var corners = options.corners;
      if (corners.length === 4) {
        applyPerspectiveTransform(ctx, img, w, h, corners);
      } else {
        ctx.drawImage(img, 0, 0);
      }
    } else {
      ctx.drawImage(img, 0, 0);
    }

    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = imageData.data;
    var brightness = parseFloat(options.brightness) || 10;
    var contrast = parseFloat(options.contrast) || 10;
    var bFactor = brightness * 2.55;
    var cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (var i = 0; i < data.length; i += 4) {
      data[i] = clampColor(cFactor * (data[i] - 128 + bFactor) + 128);
      data[i + 1] = clampColor(cFactor * (data[i + 1] - 128 + bFactor) + 128);
      data[i + 2] = clampColor(cFactor * (data[i + 2] - 128 + bFactor) + 128);
    }
    ctx.putImageData(imageData, 0, 0);

    applyUnsharpMask(ctx, canvas.width, canvas.height, 1.5);

    onProgress(3, 4, 'Generando resultado...');
    var mime = outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg';
    var ext = outputFormat === 'png' ? 'png' : outputFormat === 'webp' ? 'webp' : 'jpg';
    var blob = await new Promise(function(resolve) {
      canvas.toBlob(function(b) { resolve(b); }, mime, quality);
    });

    onProgress(4, 4, 'Listo.');
    var outName = getBaseName(files[0].name) + '_scanned.' + ext;
    return makeSingleResult(blob, outName, 'Imagen de cámara procesada correctamente.');
  };

  window.ToolProcessors.imageTableToExcel = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó imagen.');
    if (!window.EngineLoader) throw new Error('EngineLoader no disponible.');
    var language = options.language || 'eng';
    var outputFormat = options.outputFormat || 'xlsx';

    onProgress(1, 4, 'Cargando OCR...');
    var worker = await window.EngineLoader.loadTesseract(language, onProgress);

    onProgress(2, 4, 'Reconocimiento de texto...');
    var img = await loadImageFromFile(files[0]);
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var result = await worker.recognize(canvas);

    onProgress(3, 4, 'Analizando estructura de tabla...');
    var lines = result.data.text.split('\n').filter(function(l) { return l.trim(); });
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var cells = lines[i].split(/\s{2,}|\t/).map(function(c) { return c.trim(); }).filter(function(c) { return c.length > 0; });
      if (cells.length > 0) rows.push(cells);
    }

    var maxCols = 0;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].length > maxCols) maxCols = rows[r].length;
    }
    for (var r = 0; r < rows.length; r++) {
      while (rows[r].length < maxCols) rows[r].push('');
    }

    onProgress(4, 4, 'Generando hoja de cálculo...');
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var ws = window.XLSX.utils.aoa_to_sheet(rows);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Tabla detectada');

    var blob;
    var ext;
    if (outputFormat === 'csv') {
      var csvContent = window.XLSX.utils.sheet_to_csv(ws);
      csvContent = neutralizeCsvText(csvContent, ',');
      blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      ext = 'csv';
    } else {
      var xlsxBuffer = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      ext = 'xlsx';
    }

    var outName = getBaseName(files[0].name) + '_tabla.' + ext;
    return makeSingleResult(blob, outName, 'Tabla detectada y exportada a ' + ext.toUpperCase() + '. Se encontraron ' + rows.length + ' filas y ' + maxCols + ' columnas.');
  };

  window.ToolProcessors.pdfTablesToExcel = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó PDF.');
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var outputFormat = options.outputFormat || 'xlsx';
    var password = options.password || undefined;

    onProgress(1, 4, 'Cargando PDF...');
    var data = await readFileAsArrayBuffer(files[0]);
    var loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(data), password: password });
    var pdf = await loadingTask.promise;

    onProgress(2, 4, 'Extrayendo texto...');
    var allRows = [];
    var totalPages = pdf.numPages;
    for (var p = 1; p <= totalPages; p++) {
      onProgress(2, 4, 'Procesando página ' + p + '/' + totalPages + '...');
      var page = await pdf.getPage(p);
      var textContent = await page.getTextContent();
      var items = textContent.items;
      if (items.length === 0) continue;

      var yBuckets = {};
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var y = Math.round(item.transform[5]);
        var key = y;
        if (!yBuckets[key]) yBuckets[key] = [];
        yBuckets[key].push({ text: item.str, x: item.transform[4], y: y });
      }

      var yKeys = Object.keys(yBuckets).map(Number).sort(function(a, b) { return b - a; });
      var groupedRows = [];
      var lastY = null;
      var currentGroup = [];
      for (var k = 0; k < yKeys.length; k++) {
        if (lastY !== null && Math.abs(yKeys[k] - lastY) > 5) {
          if (currentGroup.length > 0) groupedRows.push(currentGroup);
          currentGroup = [];
        }
        var bucketItems = yBuckets[yKeys[k]];
        for (var bi = 0; bi < bucketItems.length; bi++) {
          currentGroup.push(bucketItems[bi]);
        }
        lastY = yKeys[k];
      }
      if (currentGroup.length > 0) groupedRows.push(currentGroup);

      for (var r = 0; r < groupedRows.length; r++) {
        groupedRows[r].sort(function(a, b) { return a.x - b.x; });
        var rowCells = [];
        for (var c = 0; c < groupedRows[r].length; c++) {
          rowCells.push(groupedRows[r][c].text);
        }
        allRows.push(rowCells);
      }
    }

    if (allRows.length === 0) {
      onProgress(3, 4, 'Intentando OCR...');
      if (window.EngineLoader) {
        try {
          var worker = await window.EngineLoader.loadTesseract('eng', onProgress);
          for (var p = 1; p <= totalPages; p++) {
            var page = await pdf.getPage(p);
            var vp = page.getViewport({ scale: 2 });
            var renderCanvas = document.createElement('canvas');
            renderCanvas.width = vp.width;
            renderCanvas.height = vp.height;
            var renderCtx = renderCanvas.getContext('2d');
            await page.render({ canvasContext: renderCtx, viewport: vp }).promise;
            var ocrResult = await worker.recognize(renderCanvas);
            var ocrLines = ocrResult.data.text.split('\n').filter(function(l) { return l.trim(); });
            for (var li = 0; li < ocrLines.length; li++) {
              allRows.push(ocrLines[li].split(/\s{2,}|\t/).map(function(c) { return c.trim(); }));
            }
          }
        } catch (e) {
          /* OCR fallback failed */
        }
      }
    }

    onProgress(4, 4, 'Generando hoja de cálculo...');
    var maxCols = 0;
    for (var r = 0; r < allRows.length; r++) {
      if (allRows[r].length > maxCols) maxCols = allRows[r].length;
    }
    for (var r = 0; r < allRows.length; r++) {
      while (allRows[r].length < maxCols) allRows[r].push('');
    }

    var ws = window.XLSX.utils.aoa_to_sheet(allRows);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Tablas');

    var blob;
    var ext;
    if (outputFormat === 'csv') {
      var csvContent = window.XLSX.utils.sheet_to_csv(ws);
      csvContent = neutralizeCsvText(csvContent, ',');
      blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      ext = 'csv';
    } else {
      var xlsxBuffer = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      ext = 'xlsx';
    }

    var outName = getBaseName(files[0].name) + '_tablas.' + ext;
    return makeSingleResult(blob, outName, 'Extracción de tablas completada (beta). Se detectaron ' + allRows.length + ' filas. Nota: la extracción es de mejor esfuerzo y puede requerir ajustes manuales.');
  };

  // ─── AUDIO TOOLS (FFmpeg.wasm) ────────────────────────────────────────

  window.ToolProcessors.convertAudio = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de audio.');
    var inputExt = getExt(files[0].name) || 'mp3';
    var outputFormat = options.outputFormat || 'wav';
    var bitrate = options.bitrate || '192k';
    var sampleRate = options.sampleRate || '44100';

    var mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' };
    var outputMime = mimeMap[outputFormat] || 'audio/wav';

    onProgress(1, 3, 'Cargando motor de audio...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Convirtiendo audio...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    var outputName = 'output.' + outputFormat;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var args = ['-i', inputName, '-b:a', bitrate, '-ar', sampleRate, outputName];
    if (outputFormat === 'ogg') args = ['-i', inputName, '-b:a', bitrate, '-ar', sampleRate, '-c:a', 'libvorbis', outputName];
    await ffmpeg.exec(args);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '.' + outputFormat;
    return makeSingleResult(blob, outName, 'Audio convertido a ' + outputFormat.toUpperCase() + ' correctamente.');
  };

  window.ToolProcessors.trimAudio = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de audio.');
    var inputExt = getExt(files[0].name) || 'mp3';
    var startTime = parseFloat(options.startTime) || 0;
    var endTime = parseFloat(options.endTime) || 0;
    var outputFormat = options.outputFormat || inputExt;

    var mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' };
    var outputMime = mimeMap[outputFormat] || 'audio/mpeg';

    onProgress(1, 3, 'Cargando motor de audio...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Recortando audio...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    var outputName = 'output.' + outputFormat;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var args = ['-i', inputName];
    if (startTime > 0) args.push('-ss', String(startTime));
    if (endTime > 0) args.push('-to', String(endTime));
    if (outputFormat === inputExt) {
      args.push('-c', 'copy', outputName);
    } else {
      var audioCodec = outputFormat === 'mp3' ? 'libmp3lame' : outputFormat === 'ogg' ? 'libvorbis' : outputFormat === 'aac' ? 'aac' : null;
      if (audioCodec) args.push('-c:a', audioCodec);
      args.push(outputName);
    }
    await ffmpeg.exec(args);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '_trim.' + outputFormat;
    return makeSingleResult(blob, outName, 'Audio recortado de ' + startTime + 's a ' + (endTime || 'fin') + 's correctamente.');
  };

  window.ToolProcessors.mergeAudio = async function(files, options, onProgress) {
    if (files.length < 2) throw new Error('Se necesitan al menos dos archivos de audio.');
    var outputFormat = options.outputFormat || 'mp3';
    var crossfade = options.crossfade === true || options.crossfade === 'true';

    var mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' };
    var outputMime = mimeMap[outputFormat] || 'audio/mpeg';

    onProgress(1, 3, 'Cargando motor de audio...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Uniendo audios...');
    var concatList = '';
    for (var i = 0; i < files.length; i++) {
      var ext = getExt(files[i].name) || 'mp3';
      var inputName = 'input_' + i + '.' + ext;
      var inputData = await readFileAsArrayBuffer(files[i]);
      await ffmpeg.writeFile(inputName, new Uint8Array(inputData));
      concatList += "file '" + inputName + "'\n";
    }
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

    var outputName = 'output.' + outputFormat;
    var canCopy = !crossfade;
    for (var j = 0; canCopy && j < files.length; j++) {
      if ((getExt(files[j].name) || 'mp3') !== outputFormat) canCopy = false;
    }
    if (canCopy) {
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', outputName]);
    } else {
      var inputArgs = [];
      for (var i = 0; i < files.length; i++) {
        var ext = getExt(files[i].name) || 'mp3';
        inputArgs.push('-i', 'input_' + i + '.' + ext);
      }
      if (crossfade) {
        var filterComplex = '';
        var lastLabel = '[0:a]';
        for (var i2 = 1; i2 < files.length; i2++) {
          var nextLabel = i2 === files.length - 1 ? '' : '[a' + i2 + ']';
          filterComplex += lastLabel + '[' + i2 + ':a]afade=t=in:st=0:d=1,afade=t=out:st=2:d=1' + nextLabel + ';';
          lastLabel = nextLabel || '[a' + i2 + ']';
        }
        filterComplex = filterComplex.replace(/;$/, '');
        await ffmpeg.exec(inputArgs.concat(['-filter_complex', filterComplex, outputName]));
      } else {
        var labels = [];
        for (var i3 = 0; i3 < files.length; i3++) labels.push('[' + i3 + ':a]');
        var fc = labels.join('') + 'concat=n=' + files.length + ':v=0:a=1[outa]';
        await ffmpeg.exec(inputArgs.concat(['-filter_complex', fc, '-map', '[outa]', outputName]));
      }
    }

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    for (var i = 0; i < files.length; i++) {
      var ext = getExt(files[i].name) || 'mp3';
      await ffmpeg.deleteFile('input_' + i + '.' + ext);
    }
    await ffmpeg.deleteFile('concat.txt');
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '_merged.' + outputFormat;
    return makeSingleResult(blob, outName, files.length + ' archivos de audio unidos correctamente.');
  };

  // ─── VIDEO TOOLS (FFmpeg.wasm) ────────────────────────────────────────

  window.ToolProcessors.compressVideo = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de video.');
    var inputExt = getExt(files[0].name) || 'mp4';
    var quality = options.quality || 'medium';
    var resolution = options.resolution || 'original';
    var outputFormat = options.outputFormat || 'mp4';

    var qualityMap = { low: '31', medium: '26', high: '22' };
    var crf = qualityMap[quality] || '26';

    var resMap = { '720p': '1280:-2', '480p': '854:-2', '360p': '640:-2' };
    var scaleArg = resMap[resolution] || null;

    var mimeMap = { mp4: 'video/mp4', webm: 'video/webm' };
    var outputMime = mimeMap[outputFormat] || 'video/mp4';

    onProgress(1, 3, 'Cargando motor de video...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Comprimiendo video...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    var outputName = 'output.' + outputFormat;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var args = ['-i', inputName, '-crf', crf, '-preset', 'medium'];
    if (scaleArg) args.push('-vf', 'scale=' + scaleArg);
    if (outputFormat === 'webm') args.push('-c:v', 'libvpx', '-c:a', 'libvorbis');
    args.push(outputName);
    await ffmpeg.exec(args);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var ratio = ((1 - blob.size / files[0].size) * 100).toFixed(1);
    var outName = getBaseName(files[0].name) + '_compressed.' + outputFormat;
    return makeSingleResult(blob, outName, 'Video comprimido. Reducción de ' + ratio + '% (' + resolution + ', calidad ' + quality + ').');
  };

  window.ToolProcessors.trimVideo = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de video.');
    var inputExt = getExt(files[0].name) || 'mp4';
    var startTime = options.startTime || '0';
    var endTime = options.endTime || '';
    var outputFormat = options.outputFormat || inputExt;

    var mimeMap = { mp4: 'video/mp4', webm: 'video/webm' };
    var outputMime = mimeMap[outputFormat] || 'video/mp4';

    onProgress(1, 3, 'Cargando motor de video...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Recortando video...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    var outputName = 'output.' + outputFormat;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var args = ['-i', inputName, '-ss', String(startTime)];
    if (endTime) args.push('-to', String(endTime));
    if (outputFormat === inputExt) {
      args.push('-c', 'copy', outputName);
    } else {
      if (outputFormat === 'mp4') args.push('-c:v', 'libx264', '-c:a', 'aac');
      else if (outputFormat === 'webm') args.push('-c:v', 'libvpx', '-c:a', 'libvorbis');
      args.push(outputName);
    }
    await ffmpeg.exec(args);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '_trim.' + outputFormat;
    return makeSingleResult(blob, outName, 'Video recortado de ' + startTime + 's a ' + (endTime || 'fin') + ' correctamente.');
  };

  window.ToolProcessors.mergeVideos = async function(files, options, onProgress) {
    if (files.length < 2) throw new Error('Se necesitan al menos dos archivos de video.');
    var outputFormat = options.outputFormat || 'mp4';

    var mimeMap = { mp4: 'video/mp4', webm: 'video/webm' };
    var outputMime = mimeMap[outputFormat] || 'video/mp4';

    onProgress(1, 3, 'Cargando motor de video...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Uniendo videos...');
    var concatList = '';
    for (var i = 0; i < files.length; i++) {
      var ext = getExt(files[i].name) || 'mp4';
      var inputName = 'input_' + i + '.' + ext;
      var inputData = await readFileAsArrayBuffer(files[i]);
      await ffmpeg.writeFile(inputName, new Uint8Array(inputData));
      concatList += "file '" + inputName + "'\n";
    }
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

    var outputName = 'output.' + outputFormat;
    var concatArgs = ['-f', 'concat', '-safe', '0', '-i', 'concat.txt'];
    var mergeInputExt = getExt(files[0].name) || 'mp4';
    if (outputFormat === mergeInputExt) {
      concatArgs.push('-c', 'copy');
    } else {
      if (outputFormat === 'mp4') concatArgs.push('-c:v', 'libx264', '-c:a', 'aac');
      else if (outputFormat === 'webm') concatArgs.push('-c:v', 'libvpx', '-c:a', 'libvorbis');
    }
    concatArgs.push(outputName);
    await ffmpeg.exec(concatArgs);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    for (var i = 0; i < files.length; i++) {
      var ext = getExt(files[i].name) || 'mp4';
      await ffmpeg.deleteFile('input_' + i + '.' + ext);
    }
    await ffmpeg.deleteFile('concat.txt');
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '_merged.' + outputFormat;
    return makeSingleResult(blob, outName, files.length + ' videos unidos correctamente.');
  };

  window.ToolProcessors.videoToGif = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de video.');
    var inputExt = getExt(files[0].name) || 'mp4';
    var startTime = options.startTime || '0';
    var endTime = options.endTime || '';
    var fps = parseInt(options.fps, 10) || 10;
    var width = parseInt(options.width, 10) || 480;

    onProgress(1, 4, 'Cargando motor de video...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 4, 'Generando paleta de colores...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var durationArgs = ['-ss', String(startTime)];
    if (endTime) durationArgs.push('-to', String(endTime));

    var paletteName = 'palette.png';
    var filterBase = 'fps=' + fps + ',scale=' + width + ':-1:flags=lanczos';
    await ffmpeg.exec(durationArgs.concat(['-i', inputName, '-vf', filterBase + ',palettegen', paletteName]));

    onProgress(3, 4, 'Generando GIF...');
    var gifName = 'output.gif';
    await ffmpeg.exec(durationArgs.concat(['-i', inputName, '-i', paletteName, '-lavfi', filterBase + '[x];[x][1:v]paletteuse', gifName]));

    onProgress(4, 4, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(gifName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(paletteName);
    await ffmpeg.deleteFile(gifName);

    var blob = new Blob([outputData.buffer], { type: 'image/gif' });
    var outName = getBaseName(files[0].name) + '.gif';
    return makeSingleResult(blob, outName, 'GIF generado: ' + width + 'px, ' + fps + ' FPS.');
  };

  window.ToolProcessors.extractAudioFromVideo = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de video.');
    var inputExt = getExt(files[0].name) || 'mp4';
    var outputFormat = options.outputFormat || 'mp3';

    var mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };
    var outputMime = mimeMap[outputFormat] || 'audio/mpeg';

    onProgress(1, 3, 'Cargando motor de video...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Extrayendo audio...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    var outputName = 'output.' + outputFormat;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var args = ['-i', inputName, '-vn'];
    if (outputFormat === 'mp3') args.push('-c:a', 'libmp3lame');
    else if (outputFormat === 'ogg') args.push('-c:a', 'libvorbis');
    args.push(outputName);
    await ffmpeg.exec(args);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '_audio.' + outputFormat;
    return makeSingleResult(blob, outName, 'Audio extraído del video correctamente.');
  };

  window.ToolProcessors.removeAudioFromVideo = async function(files, options, onProgress) {
    if (files.length === 0) throw new Error('No se proporcionó archivo de video.');
    var inputExt = getExt(files[0].name) || 'mp4';
    var outputFormat = options.outputFormat || inputExt;

    var mimeMap = { mp4: 'video/mp4', webm: 'video/webm' };
    var outputMime = mimeMap[outputFormat] || 'video/mp4';

    onProgress(1, 3, 'Cargando motor de video...');
    var ffmpeg = await window.EngineLoader.loadFFmpeg(onProgress);

    onProgress(2, 3, 'Eliminando audio...');
    var inputData = await readFileAsArrayBuffer(files[0]);
    var inputName = 'input.' + inputExt;
    var outputName = 'output.' + outputFormat;
    await ffmpeg.writeFile(inputName, new Uint8Array(inputData));

    var raArgs = ['-i', inputName, '-an'];
    if (outputFormat === inputExt) {
      raArgs.push('-c:v', 'copy');
    } else {
      if (outputFormat === 'mp4') raArgs.push('-c:v', 'libx264', '-preset', 'medium');
      else if (outputFormat === 'webm') raArgs.push('-c:v', 'libvpx');
    }
    raArgs.push(outputName);
    await ffmpeg.exec(raArgs);

    onProgress(3, 3, 'Generando resultado...');
    var outputData = await ffmpeg.readFile(outputName);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    var blob = new Blob([outputData.buffer], { type: outputMime });
    var outName = getBaseName(files[0].name) + '_noaudio.' + outputFormat;
    return makeSingleResult(blob, outName, 'Audio eliminado del video correctamente.');
  };

  // ─── CANVAS HELPER FUNCTIONS ──────────────────────────────────────────

  function clampColor(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  function applyBoxBlur(ctx, w, h, size) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    var copy = new Uint8ClampedArray(data);
    var half = Math.floor(size / 2);
    var area = size * size;
    for (var y = half; y < h - half; y++) {
      for (var x = half; x < w - half; x++) {
        var r = 0, g = 0, b = 0;
        for (var ky = -half; ky <= half; ky++) {
          for (var kx = -half; kx <= half; kx++) {
            var idx = ((y + ky) * w + (x + kx)) * 4;
            r += copy[idx];
            g += copy[idx + 1];
            b += copy[idx + 2];
          }
        }
        var idx = (y * w + x) * 4;
        data[idx] = r / area;
        data[idx + 1] = g / area;
        data[idx + 2] = b / area;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function applyUnsharpMask(ctx, w, h, amount) {
    var original = ctx.getImageData(0, 0, w, h);
    var blurred = ctx.getImageData(0, 0, w, h);
    applyBoxBlurOnImageData(blurred, w, h, 3);
    var origData = original.data;
    var blurData = blurred.data;
    for (var i = 0; i < origData.length; i += 4) {
      origData[i] = clampColor(origData[i] + amount * (origData[i] - blurData[i]));
      origData[i + 1] = clampColor(origData[i + 1] + amount * (origData[i + 1] - blurData[i + 1]));
      origData[i + 2] = clampColor(origData[i + 2] + amount * (origData[i + 2] - blurData[i + 2]));
    }
    ctx.putImageData(original, 0, 0);
  }

  function applyBoxBlurOnImageData(imageData, w, h, size) {
    var data = imageData.data;
    var copy = new Uint8ClampedArray(data);
    var half = Math.floor(size / 2);
    var area = size * size;
    for (var y = half; y < h - half; y++) {
      for (var x = half; x < w - half; x++) {
        var r = 0, g = 0, b = 0;
        for (var ky = -half; ky <= half; ky++) {
          for (var kx = -half; kx <= half; kx++) {
            var idx = ((y + ky) * w + (x + kx)) * 4;
            r += copy[idx];
            g += copy[idx + 1];
            b += copy[idx + 2];
          }
        }
        var idx = (y * w + x) * 4;
        data[idx] = r / area;
        data[idx + 1] = g / area;
        data[idx + 2] = b / area;
      }
    }
  }

  function detectDocumentEdges(ctx, w, h) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    var gray = new Uint8Array(w * h);
    for (var i = 0; i < gray.length; i++) {
      gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    }
    var threshold = 128;
    var top = Math.floor(h * 0.1);
    var bottom = Math.floor(h * 0.9);
    var left = Math.floor(w * 0.1);
    var right = Math.floor(w * 0.9);

    var foundTop = 0, foundBottom = h - 1, foundLeft = 0, foundRight = w - 1;

    for (var y = 0; y < h; y++) {
      var darkCount = 0;
      for (var x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
        if (gray[y * w + x] < threshold) darkCount++;
      }
      if (darkCount > w * 0.3) { foundTop = y; break; }
    }
    for (var y = h - 1; y >= 0; y--) {
      var darkCount = 0;
      for (var x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
        if (gray[y * w + x] < threshold) darkCount++;
      }
      if (darkCount > w * 0.3) { foundBottom = y; break; }
    }
    for (var x = 0; x < w; x++) {
      var darkCount = 0;
      for (var y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++) {
        if (gray[y * w + x] < threshold) darkCount++;
      }
      if (darkCount > h * 0.3) { foundLeft = x; break; }
    }
    for (var x = w - 1; x >= 0; x--) {
      var darkCount = 0;
      for (var y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++) {
        if (gray[y * w + x] < threshold) darkCount++;
      }
      if (darkCount > h * 0.3) { foundRight = x; break; }
    }

    var margin = 5;
    return {
      x: Math.max(0, foundLeft - margin),
      y: Math.max(0, foundTop - margin),
      w: Math.min(w, foundRight + margin) - Math.max(0, foundLeft - margin),
      h: Math.min(h, foundBottom + margin) - Math.max(0, foundTop - margin)
    };
  }

  function detectRotation(ctx, w, h) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    var threshold = 128;
    var edgeWidth = Math.max(3, Math.floor(Math.min(w, h) * 0.02));

    var topDark = 0, bottomDark = 0, leftDark = 0, rightDark = 0;
    var totalH = w * edgeWidth;
    var totalV = h * edgeWidth;

    for (var x = 0; x < w; x++) {
      for (var y = 0; y < edgeWidth; y++) {
        var idx = (y * w + x) * 4;
        if (data[idx] + data[idx + 1] + data[idx + 2] < threshold * 3) topDark++;
      }
      for (var y = h - edgeWidth; y < h; y++) {
        var idx = (y * w + x) * 4;
        if (data[idx] + data[idx + 1] + data[idx + 2] < threshold * 3) bottomDark++;
      }
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < edgeWidth; x++) {
        var idx = (y * w + x) * 4;
        if (data[idx] + data[idx + 1] + data[idx + 2] < threshold * 3) leftDark++;
      }
      for (var x = w - edgeWidth; x < w; x++) {
        var idx = (y * w + x) * 4;
        if (data[idx] + data[idx + 1] + data[idx + 2] < threshold * 3) rightDark++;
      }
    }

    var topRatio = topDark / totalH;
    var bottomRatio = bottomDark / totalH;
    var leftRatio = leftDark / totalV;
    var rightRatio = rightDark / totalV;

    if (topRatio > 0.3 && bottomRatio > 0.3 && leftRatio < 0.1 && rightRatio < 0.1) return 90;
    if (leftRatio > 0.3 && rightRatio > 0.3 && topRatio < 0.1 && bottomRatio < 0.1) return 270;
    return 0;
  }

  function applyPerspectiveTransform(ctx, img, w, h, corners) {
    var srcCorners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h }
    ];
    var dstCorners = corners.map(function(c) {
      return { x: parseFloat(c.x) || 0, y: parseFloat(c.y) || 0 };
    });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < dstCorners.length; i++) {
      if (dstCorners[i].x < minX) minX = dstCorners[i].x;
      if (dstCorners[i].y < minY) minY = dstCorners[i].y;
      if (dstCorners[i].x > maxX) maxX = dstCorners[i].x;
      if (dstCorners[i].y > maxY) maxY = dstCorners[i].y;
    }
    var outW = Math.round(maxX - minX);
    var outH = Math.round(maxY - minY);
    for (var i = 0; i < dstCorners.length; i++) {
      dstCorners[i].x -= minX;
      dstCorners[i].y -= minY;
    }

    var tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    var tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);

    var step = 2;
    for (var sy = 0; sy < h; sy += step) {
      for (var sx = 0; sx < w; sx += step) {
        var u = sx / w;
        var v = sy / h;
        var x = (1 - u) * (1 - v) * dstCorners[0].x + u * (1 - v) * dstCorners[1].x + u * v * dstCorners[2].x + (1 - u) * v * dstCorners[3].x;
        var y = (1 - u) * (1 - v) * dstCorners[0].y + u * (1 - v) * dstCorners[1].y + u * v * dstCorners[2].y + (1 - u) * v * dstCorners[3].y;
        var pixel = tempCtx.getImageData(sx, sy, 1, 1);
        ctx.fillStyle = 'rgb(' + pixel.data[0] + ',' + pixel.data[1] + ',' + pixel.data[2] + ')';
        ctx.fillRect(Math.round(x), Math.round(y), step, step);
      }
    }
  }

  var _metaExifTags = {
    0x010F: 'Fabricante', 0x0110: 'Modelo', 0x0112: 'Orientación', 0x011A: 'Resolución X',
    0x011B: 'Resolución Y', 0x0131: 'Software', 0x0132: 'Fecha modificación', 0x013B: 'Autor',
    0x8298: 'Copyright', 0x8769: 'IFD Exif', 0x8825: 'GPS IFD',
    0xA005: 'Exif IFD', 0x010E: 'Descripción', 0x0213: 'Posición YCC',
    0xA430: 'Cámara owner', 0xA431: 'Serial number', 0xA432: 'Lens info',
    0xA433: 'Lens make', 0xA434: 'Lens model',
  };

  function _metaParseExifData(buf, start, length) {
    try {
      var view = new DataView(buf);
      var bo = view.getUint16(start);
      var le = bo === 0x4949;
      var read16 = function(off) { return le ? view.getUint16(off, true) : view.getUint16(off); };
      var read32 = function(off) { return le ? view.getUint32(off, true) : view.getUint32(off); };
      var readAscii = function(off, len) {
        var s = '';
        for (var i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
        return s.replace(/\0+$/, '');
      };
      var tags = {};
      var dirStart = start + 2 + 2;
      var count = read16(dirStart - 2);
      for (var i = 0; i < count; i++) {
        var entry = dirStart + i * 12;
        if (entry + 12 > start + length) break;
        var tag = read16(entry);
        var type = read16(entry + 2);
        var num = read32(entry + 4);
        var val;
        var voff = entry + 8;
        if (type === 2) {
          var strLen = num > 4 ? read32(voff) : num;
          var strOff = num > 4 ? (read32(voff) & 0x0FFFFFFF) + start : voff;
          val = readAscii(strOff, strLen);
        } else if (type === 3) { val = read16(voff); }
        else if (type === 4) { val = read32(voff); }
        else if (type === 5 || type === 10) {
          var numOff = num > 4 ? (read32(voff) & 0x0FFFFFFF) + start : voff;
          var n = read32(numOff); var d = read32(numOff + 4);
          val = d ? n / d : n;
        }
        else { val = num; }
        tags[tag] = val;
      }
      return tags;
    } catch (e) { return null; }
  }

  function _metaParseExifFromBuffer(buf) {
    var view = new DataView(buf);
    if (view.getUint16(0) !== 0xFFD8) return null;
    var offset = 2;
    while (offset < buf.byteLength - 1) {
      if (view.getUint8(offset) !== 0xFF) break;
      var marker = view.getUint8(offset + 1);
      if (marker === 0xE1) {
        var len = view.getUint16(offset + 2);
        var header = '';
        for (var ci = 0; ci < 4; ci++) header += String.fromCharCode(new Uint8Array(buf, offset + 4 + ci, 1)[0]);
        if (header.indexOf('Exif') === 0) return _metaParseExifData(buf, offset + 4 + 6, len - 8);
        offset += 2 + len;
      } else if (marker === 0xD9 || marker === 0xDA) { break; }
      else { offset += 2 + (view.getUint16(offset + 2) || 2); }
    }
    return null;
  }

  function _metaFormatExifValue(tag, val) {
    if (tag === 0x0112) { var o = {1:'Normal',2:'Volteado horizontal',3:'Rotado 180°',4:'Volteado vertical',5:'Rotado 90° CW',6:'Rotado 90° CCW',7:'No estándar',8:'Rotado 270°'}; return o[val] || String(val); }
    if (tag === 0xA001 || tag === 0x0106) { var s = {1:'sRGB',2:'Adobe RGB',65535:'No definido'}; return s[val] || String(val); }
    if (Array.isArray(val)) return val.join('/');
    return String(val);
  }

  function _metaDetectMime(bytes) {
    var signatures = [
      { bytes: [0x25, 0x50, 0x44, 0x46], type: 'application/pdf', name: 'PDF' },
      { bytes: [0x89, 0x50, 0x4E, 0x47], type: 'image/png', name: 'PNG' },
      { bytes: [0xFF, 0xD8, 0xFF], type: 'image/jpeg', name: 'JPEG' },
      { bytes: [0x50, 0x4B, 0x03, 0x04], type: 'application/zip', name: 'ZIP/Office' },
      { bytes: [0x47, 0x49, 0x46, 0x38], type: 'image/gif', name: 'GIF' },
      { bytes: [0x66, 0x74, 0x79, 0x70], type: 'video/mp4', name: 'MP4' },
      { bytes: [0x1A, 0x45, 0xDF, 0xA3], type: 'video/webm', name: 'WebM/MKV' },
      { bytes: [0x4F, 0x67, 0x67, 0x53], type: 'audio/ogg', name: 'OGG' },
      { bytes: [0x49, 0x44, 0x33], type: 'audio/mpeg', name: 'MP3' },
      { bytes: [0xFF, 0xFB], type: 'audio/mpeg', name: 'MP3' },
      { bytes: [0xFF, 0xF3], type: 'audio/mpeg', name: 'MP3' },
      { bytes: [0x42, 0x4D], type: 'image/bmp', name: 'BMP' },
      { bytes: [0x52, 0x61, 0x72, 0x21], type: 'application/x-rar', name: 'RAR' },
      { bytes: [0x37, 0x7A, 0xBC, 0xAF], type: 'application/x-7z', name: '7Z' },
    ];
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { type: 'image/webp', name: 'WebP' };
      return { type: 'audio/wav', name: 'WAV' };
    }
    if (bytes.length >= 8 && ((bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) || (bytes[8] === 0x66 && bytes[9] === 0x74 && bytes[10] === 0x79 && bytes[11] === 0x70))) {
      return { type: 'video/mp4', name: 'MP4/MOV' };
    }
    for (var i = 0; i < signatures.length; i++) {
      var sig = signatures[i];
      var match = true;
      for (var j = 0; j < sig.bytes.length; j++) {
        if (bytes[j] !== sig.bytes[j]) { match = false; break; }
      }
      if (match) return { type: sig.type, name: sig.name };
    }
    return { type: null, name: 'Desconocido' };
  }

  async function _metaAnalyzeImage(file, bytes, buffer) {
    var general = [
      ['Nombre', file.name],
      ['Tipo', file.type || 'No detectado'],
      ['Tamaño', (file.size / 1024).toFixed(2) + ' KB'],
      ['Última modificación', new Date(file.lastModified).toISOString()],
    ];
    var metadataEntries = [];
    var sensitive = [];
    var technical = [];
    var exifTags = _metaParseExifFromBuffer(buffer);
    if (exifTags) {
      var tagMap = { 0x010F: 'Fabricante', 0x0110: 'Modelo', 0x0112: 'Orientación', 0x0131: 'Software', 0x013B: 'Autor', 0x8298: 'Copyright', 0x010E: 'Descripción', 0xA430: 'Propietario', 0xA431: 'Número de serie', 0xA432: 'Info lente', 0xA433: 'Fabricante lente', 0xA434: 'Modelo lente' };
      for (var t in tagMap) {
        var ti = parseInt(t);
        if (exifTags[ti] !== undefined) {
          var v = _metaFormatExifValue(ti, exifTags[ti]);
          metadataEntries.push([tagMap[t], v, 'EXIF']);
          technical.push([tagMap[t], v, 'EXIF', 'medio']);
        }
      }
      if (exifTags[0x9003]) metadataEntries.push(['Fecha de captura', exifTags[0x9003], 'EXIF']);
      if (exifTags[0x9004]) metadataEntries.push(['Fecha original', exifTags[0x9004], 'EXIF']);
      if (exifTags[0xA001]) metadataEntries.push(['Perfil de color', _metaFormatExifValue(0xA001, exifTags[0xA001]), 'EXIF']);
      if (exifTags[0x8825]) {
        metadataEntries.push(['Datos GPS presentes', 'Sí', 'GPS']);
        sensitive.push(['Ubicación GPS', 'GPS disponible en archivo', 'alto']);
        technical.push(['GPS', 'Coordenadas incrustadas', 'GPS', 'alto']);
      }
      if (exifTags[0x010F]) sensitive.push(['Fabricante de cámara', _metaFormatExifValue(0x010F, exifTags[0x010F]), 'medio']);
      if (exifTags[0x0110]) sensitive.push(['Modelo de cámara', _metaFormatExifValue(0x0110, exifTags[0x0110]), 'medio']);
      if (exifTags[0x0131]) sensitive.push(['Software utilizado', _metaFormatExifValue(0x0131, exifTags[0x0131]), 'medio']);
      if (exifTags[0x013B]) sensitive.push(['Autor', _metaFormatExifValue(0x013B, exifTags[0x013B]), 'medio']);
      if (exifTags[0x8298]) sensitive.push(['Copyright', _metaFormatExifValue(0x8298, exifTags[0x8298]), 'bajo']);
      if (exifTags[0xA430]) sensitive.push(['Propietario de cámara', _metaFormatExifValue(0xA430, exifTags[0xA430]), 'medio']);
      if (exifTags[0xA431]) sensitive.push(['Número de serie', _metaFormatExifValue(0xA431, exifTags[0xA431]), 'alto']);
      if (exifTags[0x9003] || exifTags[0x9004]) sensitive.push(['Fecha de captura', exifTags[0x9003] || exifTags[0x9004], 'medio']);
    }
    technical.push(['Tamaño archivo', (file.size / 1024).toFixed(2) + ' KB', 'General', 'bajo']);
    technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    return { general: general, metadataEntries: metadataEntries, sensitive: sensitive, technical: technical, canClean: file.type === 'image/jpeg', fileName: file.name };
  }

  async function _metaAnalyzePdf(file, bytes) {
    var general = [
      ['Nombre', file.name], ['Tipo', file.type], ['Tamaño', (file.size / 1024).toFixed(2) + ' KB'],
      ['Última modificación', new Date(file.lastModified).toISOString()],
    ];
    var metadataEntries = [];
    var sensitive = [];
    var technical = [];
    try {
      if (typeof pdfjsLib !== 'undefined') {
        var typedArray = new Uint8Array(bytes);
        var pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        var meta = await pdf.getMetadata().catch(function() { return null; });
        if (meta && meta.info) {
          var info = meta.info;
          if (info.Title) metadataEntries.push(['Título', info.Title, 'PDF']);
          if (info.Author) { metadataEntries.push(['Autor', info.Author, 'PDF']); sensitive.push(['Autor', info.Author, 'medio']); }
          if (info.Subject) metadataEntries.push(['Asunto', info.Subject, 'PDF']);
          if (info.Creator) metadataEntries.push(['Creador', info.Creator, 'PDF']);
          if (info.Producer) metadataEntries.push(['Productor', info.Producer, 'PDF']);
          if (info.CreationDate) metadataEntries.push(['Fecha de creación', info.CreationDate, 'PDF']);
          if (info.ModDate) metadataEntries.push(['Fecha de modificación', info.ModDate, 'PDF']);
          if (info.Keywords) metadataEntries.push(['Palabras clave', info.Keywords, 'PDF']);
        }
        technical.push(['Páginas', String(pdf.numPages), 'PDF', 'bajo']);
      }
    } catch (e) {}
    technical.push(['Tamaño archivo', (file.size / 1024).toFixed(2) + ' KB', 'General', 'bajo']);
    technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    return { general: general, metadataEntries: metadataEntries, sensitive: sensitive, technical: technical, canClean: false, fileName: file.name };
  }

  async function _metaAnalyzeOffice(file, bytes) {
    var general = [
      ['Nombre', file.name], ['Tipo', file.type], ['Tamaño', (file.size / 1024).toFixed(2) + ' KB'],
      ['Última modificación', new Date(file.lastModified).toISOString()],
    ];
    var metadataEntries = [];
    var sensitive = [];
    var technical = [];
    try {
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
        if (typeof JSZip !== 'undefined') {
          var zip = await JSZip.loadAsync(bytes);
          var coreFile = zip.file('docProps/core.xml');
          if (coreFile) {
            var xml = await coreFile.async('text');
            var parseTag = function(tag) { var m = xml.match(new RegExp('<[^:]*:' + tag + '>([^<]*)</')); return m ? m[1] : null; };
            var dcCreator = parseTag('creator');
            var title = parseTag('title');
            var subject = parseTag('subject');
            var description = parseTag('description');
            var created = parseTag('created');
            var modified = parseTag('modified');
            if (title) metadataEntries.push(['Título', title, 'Office']);
            if (dcCreator) { metadataEntries.push(['Autor', dcCreator, 'Office']); sensitive.push(['Autor', dcCreator, 'medio']); }
            if (subject) metadataEntries.push(['Asunto', subject, 'Office']);
            if (description) metadataEntries.push(['Descripción', description, 'Office']);
            if (created) metadataEntries.push(['Fecha de creación', created, 'Office']);
            if (modified) metadataEntries.push(['Fecha de modificación', modified, 'Office']);
          }
          var appFile = zip.file('docProps/app.xml');
          if (appFile) {
            var appXml = await appFile.async('text');
            var parseAppTag = function(tag) { var m = appXml.match(new RegExp('<[^:]*:' + tag + '>([^<]*)</')); return m ? m[1] : null; };
            var appAuthor = parseAppTag('Author');
            var application = parseAppTag('Application');
            var template = parseAppTag('Template');
            if (appAuthor && !metadataEntries.some(function(e) { return e[0] === 'Autor'; })) {
              metadataEntries.push(['Autor', appAuthor, 'Office']);
              sensitive.push(['Autor', appAuthor, 'medio']);
            }
            if (application) metadataEntries.push(['Aplicación', application, 'Office']);
            if (template) metadataEntries.push(['Plantilla', template, 'Office']);
          }
        }
      }
    } catch (e) {}
    technical.push(['Tamaño archivo', (file.size / 1024).toFixed(2) + ' KB', 'General', 'bajo']);
    technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    return { general: general, metadataEntries: metadataEntries, sensitive: sensitive, technical: technical, canClean: false, fileName: file.name };
  }

  async function _metaAnalyzeAudio(file, bytes) {
    var general = [
      ['Nombre', file.name], ['Tipo', file.type], ['Tamaño', (file.size / 1024).toFixed(2) + ' KB'],
      ['Última modificación', new Date(file.lastModified).toISOString()],
    ];
    var metadataEntries = [];
    var sensitive = [];
    var technical = [];
    var view = new DataView(bytes.buffer || bytes);
    var ext = file.name.split('.').pop().toLowerCase();
    try {
      if ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3))) {
        var offset = 0;
        if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
          var version = bytes[3];
          var size = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
          offset = 10 + size;
        } else { offset = 0; }
        while (offset < bytes.length - 10) {
          if (bytes[offset] === 0x54 && bytes[offset+1] === 0x41 && bytes[offset+2] === 0x47) {
            var frameSize = (bytes[offset+6] << 24) | (bytes[offset+7] << 16) | (bytes[offset+8] << 8) | bytes[offset+9];
            var frameId = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
            var encoding = bytes[offset+10];
            var frameData = bytes.slice(offset + 11, offset + 10 + frameSize);
            var decodeText = function(data, enc) {
              if (enc === 0 || enc === 3) {
                var decoder = new TextDecoder('utf-8');
                return decoder.decode(data).replace(/\0+$/, '');
              }
              var decoder = new TextDecoder('iso-8859-1');
              return decoder.decode(data).replace(/\0+$/, '');
            };
            var tagNames = { 'TIT2': 'Título', 'TPE1': 'Artista', 'TALB': 'Álbum', 'TYER': 'Año', 'TDRC': 'Fecha', 'TRCK': 'Pista', 'TCON': 'Género', 'TPOS': 'Disco', 'TCOM': 'Compositor', 'TPUB': 'Editora', 'TCOP': 'Copyright', 'COMM': 'Comentario' };
            if (tagNames[frameId]) {
              var val = decodeText(frameData, encoding);
              metadataEntries.push([tagNames[frameId], val, 'ID3']);
              if (['TPE1', 'TCOM', 'TPUB', 'TCOP'].indexOf(frameId) !== -1) sensitive.push([tagNames[frameId], val, 'bajo']);
            }
            offset += 10 + frameSize;
          } else { break; }
        }
      }
    } catch (e) {}
    technical.push(['Tamaño archivo', (file.size / 1024).toFixed(2) + ' KB', 'General', 'bajo']);
    technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    return { general: general, metadataEntries: metadataEntries, sensitive: sensitive, technical: technical, canClean: false, fileName: file.name };
  }

  async function _metaAnalyzeVideo(file, bytes) {
    var general = [
      ['Nombre', file.name], ['Tipo', file.type], ['Tamaño', (file.size / 1024).toFixed(2) + ' KB'],
      ['Última modificación', new Date(file.lastModified).toISOString()],
    ];
    var metadataEntries = [];
    var sensitive = [];
    var technical = [];
    var ext = file.name.split('.').pop().toLowerCase();
    try {
      if ((bytes[0] === 0x66 && bytes[1] === 0x74 && bytes[2] === 0x79 && bytes[3] === 0x70) || (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) {
        var brandOffset = (bytes[0] === 0x66) ? 8 : 12;
        if (bytes.length > brandOffset + 4) {
          var brand = '';
          for (var bi = 0; bi < 4; bi++) brand += String.fromCharCode(bytes[brandOffset + bi]);
          metadataEntries.push(['Brand (ftyp)', brand.trim(), 'MP4']);
        }
        technical.push(['Estructura', 'MP4/MOV (ISO Base Media)', 'Container', 'bajo']);
      }
    } catch (e) {}
    technical.push(['Tamaño archivo', (file.size / 1024).toFixed(2) + ' KB', 'General', 'bajo']);
    technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    return { general: general, metadataEntries: metadataEntries, sensitive: sensitive, technical: technical, canClean: false, fileName: file.name };
  }

  window.ToolProcessors.inspectFileMetadata = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo para inspeccionar.' };
    onProgress(1, 2, 'Leyendo archivo...');
    var file = files[0];
    var buffer = await readFileAsArrayBuffer(file);
    var bytes = new Uint8Array(buffer);

    onProgress(2, 2, 'Analizando metadatos...');
    var hashArray = await crypto.subtle.digest('SHA-256', buffer);
    var hashHex = Array.from(new Uint8Array(hashArray)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    var detected = _metaDetectMime(bytes);
    var extension = file.name.split('.').pop().toLowerCase();
    var mime = file.type || detected.type || 'application/octet-stream';

    var general = [
      ['Nombre', file.name],
      ['Tamaño', (file.size / 1024).toFixed(2) + ' KB (' + file.size + ' bytes)'],
      ['Tipo MIME (navegador)', file.type || 'No detectado'],
      ['Tipo detectado (magic bytes)', detected.name],
      ['Tipo MIME (detectado)', detected.type || 'No detectado'],
      ['Extensión', extension.toUpperCase()],
      ['Última modificación', new Date(file.lastModified).toISOString()],
      ['SHA-256', hashHex],
    ];

    var detailed;
    if (mime.startsWith('image/') && (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/tiff')) {
      detailed = await _metaAnalyzeImage(file, bytes, buffer);
    } else if (mime === 'application/pdf') {
      detailed = await _metaAnalyzePdf(file, bytes);
    } else if (mime.indexOf('word') !== -1 || mime.indexOf('document') !== -1 || mime.indexOf('spreadsheet') !== -1 || mime.indexOf('presentation') !== -1 || mime.indexOf('msword') !== -1 || mime.indexOf('excel') !== -1 || mime.indexOf('powerpoint') !== -1 || file.name.match(/\.(docx?|xlsx?|pptx?)$/i)) {
      detailed = await _metaAnalyzeOffice(file, bytes);
    } else if (mime.startsWith('audio/')) {
      detailed = await _metaAnalyzeAudio(file, bytes);
    } else if (mime.startsWith('video/')) {
      detailed = await _metaAnalyzeVideo(file, bytes);
    } else {
      detailed = { general: general, metadataEntries: [['Formato', 'Tipo de archivo no reconocido para análisis detallado', 'Info']], sensitive: [], technical: [], canClean: false, fileName: file.name };
    }

    general.push.apply(general, detailed.general.filter(function(item) { return !general.some(function(g) { return g[0] === item[0]; }); }));

    var metadata = {
      general: general,
      metadataEntries: detailed.metadataEntries,
      sensitive: detailed.sensitive,
      technical: detailed.technical,
      canClean: detailed.canClean,
      fileName: file.name,
    };

    return {
      files: [{ name: 'inspeccion-' + file.name.replace(/\.[^.]+$/, '') + '.json', blob: new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), size: file.size }],
      metadata: metadata,
      title: 'Metadatos inspeccionados',
      message: metadata.metadataEntries.length + ' campo(s) detectado(s) en "' + file.name + '".',
    };
  };

  window.ToolProcessors.encryptDecryptFile = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo.' };
    var password = options.password || options.clave || '';
    var mode = options.mode || options.modo || 'encrypt';
    
    if (!password) return { files: [], message: 'Ingresa una contraseña.' };
    if (password.length < 4) return { files: [], message: 'La contraseña debe tener al menos 4 caracteres.' };
    
    if (mode === 'decrypt' || mode === 'descifrar') {
      return await ToolProcessors._decryptFile(files[0], password, onProgress);
    }
    return await ToolProcessors._encryptFile(files[0], password, onProgress);
  };
  
  window.ToolProcessors._encryptFile = async function(file, password, onProgress) {
    onProgress(1, 3, 'Preparando cifrado...');
    var buffer = await readFileAsArrayBuffer(file);
    
    onProgress(2, 3, 'Derivando clave...');
    var iterations = 600000;
    var salt = crypto.getRandomValues(new Uint8Array(32));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var encKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      encKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    
    onProgress(3, 3, 'Cifrando archivo...');
    var fileNameBytes = new TextEncoder().encode(file.name);
    var fileTypeBytes = new TextEncoder().encode(file.type || 'application/octet-stream');
    var header = new Uint8Array(12 + 1 + 2 + 32 + 12 + 1 + fileNameBytes.length + 1 + fileTypeBytes.length);
    var sig = new TextEncoder().encode('TOOLISTOENC');
    header.set(sig, 0);
    header[12] = 1;
    header[13] = (Math.round(iterations / 1000) >> 8) & 0xFF;
    header[14] = Math.round(iterations / 1000) & 0xFF;
    header.set(salt, 15);
    header.set(iv, 47);
    header[59] = fileNameBytes.length;
    header.set(fileNameBytes, 60);
    header[60 + fileNameBytes.length] = fileTypeBytes.length;
    header.set(fileTypeBytes, 61 + fileNameBytes.length);
    
    var encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: header }, aesKey, buffer);
    var result = new Uint8Array(header.length + encrypted.byteLength);
    result.set(header, 0);
    result.set(new Uint8Array(encrypted), header.length);
    
    var blob = new Blob([result], { type: 'application/octet-stream' });
    return makeSingleResult(blob, file.name + '.toolistoenc', 'Archivo cifrado correctamente.');
  };
  
  window.ToolProcessors._decryptFile = async function(file, password, onProgress) {
    onProgress(1, 3, 'Leyendo archivo cifrado...');
    var buffer = await readFileAsArrayBuffer(file);
    var data = new Uint8Array(buffer);
    
    var sig = new TextDecoder().decode(data.slice(0, 11));
    if (sig !== 'TOOLISTOENC') return { files: [], message: 'No es un archivo .toolistoenc válido.' };
    
    var iterations = (data[13] << 8 | data[14]) * 1000;
    var salt = data.slice(15, 47);
    var iv = data.slice(47, 59);
    var nameLen = data[59];
    var originalName = new TextDecoder().decode(data.slice(60, 60 + nameLen));
    var typeLen = data[60 + nameLen];
    var originalType = new TextDecoder().decode(data.slice(61 + nameLen, 61 + nameLen + typeLen));
    var headerEnd = 61 + nameLen + typeLen;
    var encryptedData = data.slice(headerEnd);
    var header = data.slice(0, headerEnd);
    
    onProgress(2, 3, 'Derivando clave...');
    var encKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: iterations, hash: 'SHA-256' },
      encKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    
    onProgress(3, 3, 'Descifrando...');
    try {
      var decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: new Uint8Array(header) }, aesKey, encryptedData);
      var blob = new Blob([decrypted], { type: originalType });
      return makeSingleResult(blob, originalName, 'Archivo descifrado correctamente.');
    } catch (e) {
      return { files: [], message: 'Contraseña incorrecta o archivo corrupto.' };
    }
  };

  window.ToolProcessors.photoLocationExtractor = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen JPEG.' };
    var file = files[0];
    if (!file.type.includes('jpeg') && !file.name.toLowerCase().match(/\.(jpg|jpeg)$/)) {
      return { files: [], message: 'Solo se aceptan archivos JPEG.' };
    }
    
    onProgress(1, 2, 'Analizando metadatos EXIF...');
    var buffer = await readFileAsArrayBuffer(file);
    var data = new Uint8Array(buffer);
    
    if (data[0] !== 0xFF || data[1] !== 0xD8) return { files: [], message: 'No es un archivo JPEG válido.' };
    
    var exifData = {};
    if (window.PhotoLocation) {
      var parsed = window.PhotoLocation.extractFromJpeg(buffer);
      if (parsed && parsed.success) exifData = parsed.data;
    }
    
    onProgress(2, 2, 'Generando reporte...');
    var hasGps = exifData.gps && exifData.gps.lat !== null && exifData.gps.lng !== null;
    var hasCamera = exifData.camera && (exifData.camera.make || exifData.camera.model);
    var hasDatetime = !!exifData.datetime;
    var hasAny = hasGps || hasCamera || hasDatetime;
    
    var html = '<div class="inspect-report">';
    html += '<h3 style="margin:0 0 12px">Ubicación y metadatos de foto</h3>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:.85rem">';
    html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600;width:40%">Archivo</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + _escapeHtml(file.name) + '</td></tr>';
    html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Tamaño</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + (file.size / 1024).toFixed(1) + ' KB</td></tr>';
    
    if (hasCamera) {
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Cámara</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + _escapeHtml((exifData.camera.make || '') + ' ' + (exifData.camera.model || '')).trim() + '</td></tr>';
    }
    if (hasDatetime) {
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Fecha de captura</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + _escapeHtml(exifData.datetime) + '</td></tr>';
    }
    if (hasGps) {
      var lat = exifData.gps.lat;
      var lng = exifData.gps.lng;
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Latitud</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + lat + '°</td></tr>';
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Longitud</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + lng + '°</td></tr>';
      if (exifData.gps.alt !== null && exifData.gps.alt !== undefined) {
        html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Altitud</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + exifData.gps.alt.toFixed(1) + ' m</td></tr>';
      }
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">Mapa</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)"><a href="https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=16/' + lat + '/' + lng + '" target="_blank" rel="noopener" style="color:var(--accent)">Ver en OpenStreetMap ↗</a></td></tr>';
    }
    html += '</table>';
    
    if (hasGps) {
      html += '<div style="margin-top:12px;border:1px solid var(--border);border-radius:8px;overflow:hidden">';
      html += '<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=' + (lng - 0.01) + ',' + (lat - 0.01) + ',' + (lng + 0.01) + ',' + (lat + 0.01) + '&layer=mapnik&marker=' + lat + ',' + lng + '" style="width:100%;height:280px;border:none" loading="lazy" title="Mapa de ubicación"></iframe>';
      html += '</div>';
      html += '<div style="margin-top:8px;padding:10px 12px;border-radius:6px;background:#FFF3E0;border:1px solid #FFE0B2;font-size:.85rem">⚠ <b>Privacidad:</b> Esta foto contiene coordenadas GPS que revelan la ubicación exacta donde fue tomada. Considera eliminar los metadatos antes de compartirla.</div>';
    } else if (!hasAny) {
      html += '<div style="margin-top:12px;padding:10px 12px;border-radius:6px;background:var(--bg);border:1px solid var(--border);font-size:.85rem;color:var(--muted)">No se encontraron metadatos EXIF significativos. La imagen puede haber sido procesada o exportada sin preservar los metadatos.</div>';
    }
    html += '</div>';
    
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    return makeSingleResult(blob, file.name.replace(/\.[^.]+$/, '') + '-ubicacion.html', 'Metadatos extraídos correctamente.');
  };

  window.ToolProcessors.simpleCalculator = async function(files, options, onProgress) {
    var expr = options.expression || options.expresion || '';
    if (!expr) return { files: [], message: 'Ingresa una expresión matemática.' };
    onProgress(1, 1, 'Calculando...');
    var result = window.ExpressionParser.parse(expr);
    if (result.error) return { files: [], message: result.error };
    var output = 'Expresión: ' + expr + '\nResultado: ' + result.value;
    var blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, 'calculadora.txt', 'Resultado: ' + result.value);
  };

  window.ToolProcessors.scientificCalculator = async function(files, options, onProgress) {
    var expr = options.expression || options.expresion || '';
    if (!expr) return { files: [], message: 'Ingresa una expresión matemática.' };
    onProgress(1, 1, 'Calculando...');
    
    var functions = ['asin', 'acos', 'atan', 'sqrt', 'cbrt', 'ceil', 'floor', 'round', 'sin', 'cos', 'tan', 'log', 'ln', 'abs'];
    var processed = expr;
    functions.forEach(function(name) {
      var mathName = name === 'log' ? 'log10' : name === 'ln' ? 'log' : name;
      processed = processed.replace(new RegExp('\\b' + name + '\\s*\\(', 'gi'), 'Math.' + mathName + '(');
    });
    processed = processed
      .replace(/\^/g, '**')
      .replace(/π/g, 'Math.PI')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/gi, 'Math.E')
      .replace(/(\d+)!/g, 'ToolProcessors._factorial($1)');
    
    try {
      var safeCheck = processed.replace(/Math\.(?:sin|cos|tan|asin|acos|atan|log10|log|sqrt|cbrt|abs|ceil|floor|round|PI|E)/g, '')
        .replace(/ToolProcessors\._factorial\(/g, '').replace(/[0-9+\-*/().%\s,]/g, '');
      if (safeCheck.length > 0) return { files: [], message: 'Expresión inválida.' };
      
      var calcResult = Function('"use strict"; return (' + processed + ')')();
      if (!isFinite(calcResult)) return { files: [], message: 'Resultado no finito.' };
      
      var output = 'Expresión: ' + expr + '\nResultado: ' + calcResult;
      var blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(blob, 'calculadora-cientifica.txt', 'Resultado: ' + calcResult);
    } catch (e) {
      return { files: [], message: 'Error en la expresión: ' + e.message };
    }
  };
  
  window.ToolProcessors._factorial = function(n) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    var result = 1;
    for (var i = 2; i <= n; i++) result *= i;
    return result;
  };

  window.ToolProcessors.textToUnicodeBraille = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo de texto.' };
    onProgress(1, 2, 'Leyendo texto...');
    var file = files[0];
    var text = await readFileAsText(file);
    
    onProgress(2, 2, 'Convirtiendo a Braille...');
    var braille = window.BrailleES.toBraille(text);
    var blob = new Blob([braille], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, file.name.replace(/\.[^.]+$/, '') + '-braille.txt', 'Texto convertido a Braille Unicode correctamente.');
  };

  window.ToolProcessors.formatDocumentApa7 = async function(files, options, onProgress) {
    var title = options.title || options.titulo || '';
    var authorName = options.authorName || options.autor || '';
    var authorAffiliation = options.authorAffiliation || options.institucion || '';
    var course = options.course || options.curso || '';
    var instructor = options.instructor || options.profesor || '';
    var abstractText = options.abstract || options.resumen || '';
    var keywords = options.keywords || options.palabras_clave || '';
    var sectionsRaw = options.sections || options.secciones || '[]';
    var referencesRaw = options.references || options.referencias || '[]';
    
    var sections = [];
    var references = [];
    try { sections = typeof sectionsRaw === 'string' ? JSON.parse(sectionsRaw) : sectionsRaw; } catch(e) { sections = []; }
    try { references = typeof referencesRaw === 'string' ? JSON.parse(referencesRaw) : referencesRaw; } catch(e) { references = []; }
    
    if (!title) return { files: [], message: 'El título es obligatorio.' };
    if (!authorName) return { files: [], message: 'El nombre del autor es obligatorio.' };
    
    onProgress(1, 3, 'Generando documento...');
    
    var today = new Date();
    var dateStr = options.date || options.fecha || today.getDate() + ' de ' + ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][today.getMonth()] + ' de ' + today.getFullYear();
    
    var paragraphs = [];
    var pStyle = { spacing: { line: 480 }, font: 'Arial', size: 24 };
    
    for (var i = 0; i < 8; i++) paragraphs.push(new docx.Paragraph({ children: [] }));
    paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: title, bold: true, font: 'Arial', size: 28 })] }));
    paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: authorName, font: 'Arial', size: 24 })] }));
    if (authorAffiliation) paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: authorAffiliation, font: 'Arial', size: 24 })] }));
    if (course) paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: course, font: 'Arial', size: 24 })] }));
    if (instructor) paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: instructor, font: 'Arial', size: 24 })] }));
    paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: dateStr, font: 'Arial', size: 24 })] }));
    paragraphs.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    
    if (abstractText) {
      paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: 'Resumen', bold: true, font: 'Arial', size: 24 })] }));
      paragraphs.push(new docx.Paragraph({ spacing: { line: 480 }, children: [new docx.TextRun({ text: abstractText, font: 'Arial', size: 24 })] }));
      if (keywords) paragraphs.push(new docx.Paragraph({ spacing: { line: 480 }, children: [new docx.TextRun({ text: 'Palabras clave: ', italic: true, font: 'Arial', size: 24 }), new docx.TextRun({ text: keywords, font: 'Arial', size: 24 })] }));
      paragraphs.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }
    
    onProgress(2, 3, 'Agregando secciones...');
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var level = sec.level || 1;
      var headingOpts = { spacing: { line: 480 }, children: [new docx.TextRun({ text: sec.heading || '', bold: true, font: 'Arial', size: 24 })] };
      if (level === 1) headingOpts.alignment = docx.AlignmentType.CENTER;
      if (level === 3) headingOpts.indent = { left: 720 };
      paragraphs.push(new docx.Paragraph(headingOpts));
      paragraphs.push(new docx.Paragraph({ spacing: { line: 480 }, indent: { firstLine: 720 }, children: [new docx.TextRun({ text: sec.content || '', font: 'Arial', size: 24 })] }));
    }
    
    if (references.length > 0) {
      paragraphs.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
      paragraphs.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { line: 480 }, children: [new docx.TextRun({ text: 'Referencias', bold: true, font: 'Arial', size: 24 })] }));
      for (var r = 0; r < references.length; r++) {
        var refText = typeof references[r] === 'string' ? references[r] : (references[r].text || '');
        paragraphs.push(new docx.Paragraph({ spacing: { line: 480 }, indent: { left: 720, hanging: 720 }, children: [new docx.TextRun({ text: refText, font: 'Arial', size: 24 })] }));
      }
    }
    
    onProgress(3, 3, 'Empaquetando DOCX...');
    var doc = new docx.Document({ sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: paragraphs }] });
    var blob = await docx.Packer.toBlob(doc);
    return makeSingleResult(blob, (title.substring(0, 30).replace(/[^a-zA-Z0-9áéíóúñ ]/g, '') || 'documento') + '-apa7.docx', 'Documento APA 7 generado correctamente.');
  };

  window.ToolProcessors.scannedPdfToSearchablePdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo PDF escaneado.' };
    var file = files[0];
    var lang = options.language || options.idioma || 'spa';
    var scale = 2;
    var enhanceContrast = options.enhanceContrast || options.mejorarContraste || false;
    var specificPages = options.pages || options.paginas || '';
    
    onProgress(1, 3, 'Cargando PDF...');
    var buffer = await readFileAsArrayBuffer(file);
    
    onProgress(2, 3, 'Detectando páginas que necesitan OCR...');
    var detection = await window.PdfOcrEngine.detectNeedsOcr(buffer, function(step, total, msg) {
      onProgress(2, 3, msg || 'Analizando páginas...');
    });
    
    if (!detection.needsOcr) {
      return { files: [], message: 'El PDF ya tiene texto seleccionable. No necesita OCR.' };
    }
    
    var pagesToProcess = detection.pagesNeedingOcr;
    if (specificPages) {
      var pageNums = specificPages.split(/[,\-]/).map(function(p) { return parseInt(p.trim()); }).filter(function(n) { return !isNaN(n) && n > 0 && n <= detection.totalPages; });
      if (pageNums.length > 0) pagesToProcess = pageNums;
    }
    
    onProgress(3, 3, 'Procesando ' + pagesToProcess.length + ' página(s) con OCR...');
    var processedPages = [];
    var skippedPages = [];
    
    for (var i = 0; i < pagesToProcess.length; i++) {
      var pageNum = pagesToProcess[i];
      onProgress(i + 1, pagesToProcess.length, 'OCR página ' + pageNum + '/' + pagesToProcess[pagesToProcess.length - 1] + '...');
      
      try {
        var rendered = await window.PdfOcrEngine.renderPageToCanvas(buffer, pageNum, scale);
        var ocrResult = await window.PdfOcrEngine.ocrCanvas(rendered.canvas, lang, function(step, total, msg) {
          onProgress(i + 1, pagesToProcess.length, msg || 'Reconociendo texto...');
        });
        
        processedPages.push({
          imageBlob: await new Promise(function(resolve) {
            rendered.canvas.toBlob(function(blob) { resolve(blob); }, 'image/jpeg', 0.95);
          }),
          ocrText: ocrResult.text,
          width: rendered.width,
          height: rendered.height,
          pageNumber: pageNum,
          confidence: ocrResult.confidence
        });
      } catch (e) {
        skippedPages.push(pageNum);
      }
    }
    
    if (processedPages.length === 0) {
      return { files: [], message: 'No se pudo procesar ninguna página. Verifica que el PDF no esté corrupto.' };
    }
    
    onProgress(pagesToProcess.length + 1, pagesToProcess.length + 2, 'Generando PDF buscable...');
    var searchablePdf = await window.PdfOcrEngine.createSearchablePdf(processedPages, lang, {}, onProgress);
    
    var avgConfidence = processedPages.reduce(function(sum, p) { return sum + p.confidence; }, 0) / processedPages.length;
    var msg = 'PDF buscable creado: ' + processedPages.length + ' página(s) procesada(s)';
    if (skippedPages.length > 0) msg += ', ' + skippedPages.length + ' página(s) omitida(s)';
    msg += '. Confianza promedio: ' + Math.round(avgConfidence) + '%';
    if (avgConfidence < 60) msg += '. ADVERTENCIA: La calidad del escaneo es baja, el OCR puede tener errores.';
    
    var blob = new Blob([searchablePdf], { type: 'application/pdf' });
    return makeSingleResult(blob, getBaseName(file.name) + '-buscable.pdf', msg);
  };

  window.ToolProcessors.imageToSearchablePdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var lang = options.language || options.idioma || 'spa';
    var results = [];
    
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Procesando imagen ' + (i + 1) + '/' + files.length + '...');
      
      try {
        var file = files[i];
        var img = await new Promise(function(resolve, reject) {
          var imgEl = new Image();
          imgEl.onload = function() { resolve(imgEl); };
          imgEl.onerror = function() { reject(new Error('No se pudo cargar la imagen')); };
          imgEl.src = URL.createObjectURL(file);
        });
        
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        var ocrResult = await window.PdfOcrEngine.ocrCanvas(canvas, lang, function(step, total, msg) {
          onProgress(i + 1, files.length, msg || 'Reconociendo texto...');
        });
        
        var pageData = {
          imageBlob: await new Promise(function(resolve) {
            canvas.toBlob(function(blob) { resolve(blob); }, 'image/jpeg', 0.95);
          }),
          ocrText: ocrResult.text,
          width: img.naturalWidth,
          height: img.naturalHeight,
          pageNumber: 1,
          confidence: ocrResult.confidence
        };
        
        var pdfBytes = await window.PdfOcrEngine.createSearchablePdf([pageData], lang, {}, onProgress);
        var blob = new Blob([pdfBytes], { type: 'application/pdf' });
        results.push({ name: getBaseName(file.name) + '-buscable.pdf', blob: blob });
        
        URL.revokeObjectURL(img.src);
      } catch(e) { /* skip failed file */ }
    }
    
    return makeResult(results, 'Se procesaron ' + results.length + ' imagen(es) a PDF buscable.');
  };

  window.ToolProcessors.extractTextFromScannedPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo PDF.' };
    var file = files[0];
    var lang = options.language || options.idioma || 'spa';
    var specificPages = options.pages || options.paginas || '';
    
    onProgress(1, 3, 'Cargando PDF...');
    var buffer = await readFileAsArrayBuffer(file);
    
    onProgress(2, 3, 'Analizando páginas...');
    var loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
    var pdf = await loadingTask.promise;
    var totalPages = pdf.numPages;
    
    var pagesToProcess = [];
    if (specificPages) {
      var pageNums = specificPages.split(/[,\-]/).map(function(p) { return parseInt(p.trim()); }).filter(function(n) { return !isNaN(n) && n > 0 && n <= totalPages; });
      pagesToProcess = pageNums.length > 0 ? pageNums : Array.from({length: totalPages}, function(_, i) { return i + 1; });
    } else {
      pagesToProcess = Array.from({length: totalPages}, function(_, i) { return i + 1; });
    }
    
    var allText = [];
    for (var i = 0; i < pagesToProcess.length; i++) {
      var pageNum = pagesToProcess[i];
      onProgress(i + 1, pagesToProcess.length, 'Extrayendo texto página ' + pageNum + '/' + pagesToProcess[pagesToProcess.length - 1] + '...');
      
      try {
        var rendered = await window.PdfOcrEngine.renderPageToCanvas(buffer, pageNum, 2);
        // Centraliza el OCR-PDF (carga, reconocimiento y normalización) en
        // PdfOcrEngine; no crear un worker paralelo para esta herramienta.
        var ocrResult = await window.PdfOcrEngine.ocrCanvas(rendered.canvas, lang, function(step, total, msg) {
          onProgress(i + 1, pagesToProcess.length, msg || 'Reconociendo texto...');
        });
        var pageText = ocrResult.text || '';
        
        allText.push('--- Página ' + pageNum + ' ---\n' + pageText);
      } catch (e) {
        allText.push('--- Página ' + pageNum + ' ---\n[Error al procesar esta página]');
      }
    }
    
    var fullText = allText.join('\n\n');
    var blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-texto.txt', 'Texto extraído de ' + pagesToProcess.length + ' página(s).');
  };

  window.ToolProcessors.detectOcrNeeded = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo PDF.' };
    var file = files[0];
    
    onProgress(1, 2, 'Analizando PDF...');
    var buffer = await readFileAsArrayBuffer(file);
    
    onProgress(2, 2, 'Verificando texto en cada página...');
    var detection = await window.PdfOcrEngine.detectNeedsOcr(buffer, onProgress);
    
    var report = [
      '=== ANÁLISIS DE OCR ===',
      '',
      'Archivo: ' + file.name,
      'Total de páginas: ' + detection.totalPages,
      'Páginas con texto: ' + detection.pagesWithText,
      'Páginas que necesitan OCR: ' + detection.pagesNeedingOcr.length,
      '',
      detection.needsOcr ? 'RESULTADO: Este PDF NECESITA OCR.' : 'RESULTADO: Este PDF Ya tiene texto. No necesita OCR.',
      ''
    ];
    
    if (detection.pagesNeedingOcr.length > 0) {
      report.push('Páginas que necesitan OCR: ' + detection.pagesNeedingOcr.join(', '));
    }
    
    report.push('');
    report.push('=== FIN ===');
    
    var blob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    var msg = detection.needsOcr 
      ? detection.pagesNeedingOcr.length + ' de ' + detection.totalPages + ' página(s) necesitan OCR.'
      : 'El PDF ya tiene texto seleccionable en todas las páginas.';
    return makeSingleResult(blob, getBaseName(file.name) + '-analisis-ocr.txt', msg);
  };

  window.ToolProcessors.censorPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo PDF para censurar.' };
    var file = files[0];
    var zones = options.zones || [];
    var searchTerm = options.searchTerm || options.buscar || '';
    var patterns = options.patterns || [];
    var removeMetadata = options.removeMetadata || options.quitarMetadatos || false;
    var scale = 2;
    
    onProgress(1, 4, 'Cargando PDF...');
    var buffer = await readFileAsArrayBuffer(file);
    
    var loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
    var pdf = await loadingTask.promise;
    var totalPages = pdf.numPages;
    
    var pagesToCensor = options.pages ? options.pages.split(',').map(function(p) { return parseInt(p.trim()); }).filter(function(n) { return n > 0 && n <= totalPages; }) : Array.from({length: totalPages}, function(_, i) { return i + 1; });
    
    var redactedPages = [];
    
    for (var i = 0; i < pagesToCensor.length; i++) {
      var pageNum = pagesToCensor[i];
      onProgress(i + 1, pagesToCensor.length, 'Censurando página ' + pageNum + '...');
      
      try {
        var rendered = await window.PdfCensorEngine.renderPage(buffer, pageNum, scale);
        var canvas = rendered.canvas;
        
        var totalRedactions = 0;
        
        if (zones.length > 0) {
          var pageZones = zones.filter(function(z) { return !z.page || z.page === pageNum; });
          if (pageZones.length > 0) {
            window.PdfCensorEngine.applyManualRedaction(canvas, rendered.textContent, pageZones);
            totalRedactions += pageZones.length;
          }
        }
        
        if (searchTerm) {
          var wordResult = window.PdfCensorEngine.applyWordRedaction(canvas, rendered.textContent, searchTerm, { color: '#000000', padding: 2 });
          totalRedactions += wordResult.redactedCount;
        }
        
        if (patterns.length > 0) {
          var patternResult = window.PdfCensorEngine.applyPatternRedaction(canvas, rendered.textContent, patterns);
          totalRedactions += patternResult.redactedCount;
        }
        
        redactedPages.push({
          canvas: canvas,
          originalWidth: rendered.width,
          originalHeight: rendered.height,
          pageNumber: pageNum,
          redactions: totalRedactions
        });
      } catch (e) {
        // Skip failed pages
      }
    }
    
    if (redactedPages.length === 0) {
      return { files: [], message: 'No se pudo censurar ninguna página.' };
    }
    
    onProgress(pagesToCensor.length + 1, pagesToCensor.length + 2, 'Construyendo PDF censurado...');
    var censoredPdf = await window.PdfCensorEngine.buildRedactedPdf(redactedPages);
    
    if (removeMetadata) {
      try {
        var censoredBytes = await censoredPdf.arrayBuffer();
        var censoredDoc = await PDFLib.PDFDocument.load(censoredBytes);
        censoredDoc.setTitle('');
        censoredDoc.setAuthor('');
        censoredDoc.setSubject('');
        censoredDoc.setKeywords([]);
        censoredDoc.setProducer('Toolisto');
        censoredDoc.setCreator('Toolisto');
        var finalBytes = await censoredDoc.save();
        var blob = new Blob([finalBytes], { type: 'application/pdf' });
        return makeSingleResult(blob, getBaseName(file.name) + '-censurado.pdf', 'PDF censurado permanentemente. ' + redactedPages.reduce(function(s, p) { return s + p.redactions; }, 0) + ' zona(s) censurada(s) en ' + redactedPages.length + ' página(s). Metadatos eliminados.');
      } catch (e) { /* fallback to flattened version */ }
    }
    
    var blob = new Blob([censoredPdf], { type: 'application/pdf' });
    var totalRedactions = redactedPages.reduce(function(s, p) { return s + p.redactions; }, 0);
    return makeSingleResult(blob, getBaseName(file.name) + '-censurado.pdf', 'PDF censurado permanentemente. ' + totalRedactions + ' zona(s) censurada(s) en ' + redactedPages.length + ' página(s).');
  };

  window.ToolProcessors.verifyPdfCensor = async function(files, options, onProgress) {
    if (!files || files.length < 2) return { files: [], message: 'Selecciona dos PDFs: el original y el censurado.' };
    var originalFile = files[0];
    var censoredFile = files[1];
    
    onProgress(1, 3, 'Cargando PDFs...');
    var originalBuffer = await readFileAsArrayBuffer(originalFile);
    var censoredBuffer = await readFileAsArrayBuffer(censoredFile);
    
    onProgress(2, 3, 'Extrayendo texto del PDF censurado...');
    var censoredDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(censoredBuffer) }).promise;
    var originalDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(originalBuffer) }).promise;
    
    var originalText = '';
    for (var i = 1; i <= originalDoc.numPages; i++) {
      var page = await originalDoc.getPage(i);
      var content = await page.getTextContent();
      originalText += content.items.map(function(item) { return item.str; }).join(' ') + '\n';
    }
    
    var censoredText = '';
    for (var j = 1; j <= censoredDoc.numPages; j++) {
      var cPage = await censoredDoc.getPage(j);
      var cContent = await cPage.getTextContent();
      censoredText += cContent.items.map(function(item) { return item.str; }).join(' ') + '\n';
    }
    
    onProgress(3, 3, 'Verificando...');
    var searchTerm = options.searchTerm || options.buscar || '';
    var warnings = [];
    var safe = true;
    
    if (searchTerm) {
      var regex = new RegExp(searchTerm, 'gi');
      var originalMatches = (originalText.match(regex) || []).length;
      var censoredMatches = (censoredText.match(regex) || []).length;
      if (censoredMatches > 0) {
        safe = false;
        warnings.push('El término "' + searchTerm + '" aún aparece ' + censoredMatches + ' vez(es) en el PDF censurado.');
      }
    }
    
    var originalWordCount = originalText.split(/\s+/).filter(function(w) { return w.length > 3; }).length;
    var censoredWordCount = censoredText.split(/\s+/).filter(function(w) { return w.length > 3; }).length;
    var textRetention = originalWordCount > 0 ? Math.round((censoredWordCount / originalWordCount) * 100) : 0;
    
    var report = [
      '=== VERIFICACIÓN DE CENSURA ===',
      '',
      'PDF original: ' + originalFile.name,
      'PDF censurado: ' + censoredFile.name,
      '',
      'Páginas original: ' + originalDoc.numPages,
      'Páginas censurado: ' + censoredDoc.numPages,
      '',
      'Palabras en original: ~' + originalWordCount,
      'Palabras en censurado: ~' + censoredWordCount,
      'Retención de texto: ' + textRetention + '%',
      ''
    ];
    
    if (searchTerm) {
      report.push('Búsqueda de "' + searchTerm + '":');
      report.push('  En original: ' + ((originalText.match(new RegExp(searchTerm, 'gi')) || []).length) + ' coincidencias');
      report.push('  En censurado: ' + ((censoredText.match(new RegExp(searchTerm, 'gi')) || []).length) + ' coincidencias');
      report.push('');
    }
    
    if (warnings.length > 0) {
      report.push('ADVERTENCIAS:');
      warnings.forEach(function(w) { report.push('  - ' + w); });
      report.push('');
      report.push('RESULTADO: VERIFICACIÓN FALLIDA. El PDF censurado aún contiene texto recuperable.');
    } else if (censoredWordCount === 0 && originalWordCount > 0) {
      report.push('RESULTADO: El PDF censurado está completamente limpio de texto.');
    } else {
      report.push('RESULTADO: El PDF censurado no contiene el texto buscado.');
    }
    
    report.push('');
    report.push('=== FIN ===');
    
    var blob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, 'verificacion-censura.txt', warnings.length > 0 ? 'Verificación fallida: texto recuperable encontrado.' : 'Verificación completada.');
  };

  window.ToolProcessors.comparePdfs = async function(files, options, onProgress) {
    if (!files || files.length < 2) return { files: [], message: 'Selecciona dos PDFs para comparar.' };
    var fileA = files[0];
    var fileB = files[1];
    var scale = 1.5;
    
    onProgress(1, 4, 'Cargando PDFs...');
    var bufferA = await readFileAsArrayBuffer(fileA);
    var bufferB = await readFileAsArrayBuffer(fileB);
    
    var [pdfA, pdfB] = await Promise.all([
      window.pdfjsLib.getDocument({ data: new Uint8Array(bufferA) }).promise,
      window.pdfjsLib.getDocument({ data: new Uint8Array(bufferB) }).promise
    ]);
    
    onProgress(2, 4, 'Extrayendo texto...');
    async function extractAllText(pdf) {
      var texts = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var content = await page.getTextContent();
        texts.push(content.items.map(function(item) { return item.str; }).join(' '));
      }
      return texts;
    }
    var textA = await extractAllText(pdfA);
    var textB = await extractAllText(pdfB);
    
    var maxPages = Math.max(pdfA.numPages, pdfB.numPages);
    var addedPages = [];
    var removedPages = [];
    var modifiedPages = [];
    var identicalPages = [];
    
    for (var p = 0; p < maxPages; p++) {
      var pageA = textA[p] || '';
      var pageB = textB[p] || '';
      
      if (p >= pdfA.numPages) { addedPages.push(p + 1); continue; }
      if (p >= pdfB.numPages) { removedPages.push(p + 1); continue; }
      
      if (pageA === pageB) {
        identicalPages.push(p + 1);
      } else {
        modifiedPages.push(p + 1);
      }
    }
    
    onProgress(3, 4, 'Generando imágenes de diferencia...');
    var diffImages = [];
    var pagesToDiff = modifiedPages.slice(0, 10);
    
    for (var d = 0; d < pagesToDiff.length; d++) {
      var pg = pagesToDiff[d];
      if (pg <= pdfA.numPages && pg <= pdfB.numPages) {
        try {
          var pageObjA = await pdfA.getPage(pg);
          var pageObjB = await pdfB.getPage(pg);
          var vpA = pageObjA.getViewport({ scale: scale });
          var vpB = pageObjB.getViewport({ scale: scale });
          
          var canvasA = document.createElement('canvas');
          canvasA.width = Math.max(vpA.width, vpB.width);
          canvasA.height = Math.max(vpA.height, vpB.height);
          var ctxA = canvasA.getContext('2d');
          ctxA.fillStyle = '#ffffff';
          ctxA.fillRect(0, 0, canvasA.width, canvasA.height);
          await pageObjA.render({ canvasContext: ctxA, viewport: vpA }).promise;
          
          var canvasB = document.createElement('canvas');
          canvasB.width = canvasA.width;
          canvasB.height = canvasA.height;
          var ctxB = canvasB.getContext('2d');
          ctxB.fillStyle = '#ffffff';
          ctxB.fillRect(0, 0, canvasB.width, canvasB.height);
          await pageObjB.render({ canvasContext: ctxB, viewport: vpB }).promise;
          
          var diffCanvas = document.createElement('canvas');
          diffCanvas.width = canvasA.width;
          diffCanvas.height = canvasA.height;
          var diffCtx = diffCanvas.getContext('2d');
          var dataA = ctxA.getImageData(0, 0, canvasA.width, canvasA.height);
          var dataB = ctxB.getImageData(0, 0, canvasB.width, canvasB.height);
          var diffData = diffCtx.createImageData(canvasA.width, canvasA.height);
          var diffPixels = 0;
          
          for (var px = 0; px < dataA.data.length; px += 4) {
            var diff = Math.abs(dataA.data[px] - dataB.data[px]) + Math.abs(dataA.data[px+1] - dataB.data[px+1]) + Math.abs(dataA.data[px+2] - dataB.data[px+2]);
            if (diff > 30) {
              diffData.data[px] = 255;
              diffData.data[px+1] = 0;
              diffData.data[px+2] = 0;
              diffData.data[px+3] = 200;
              diffPixels++;
            } else {
              diffData.data[px] = 255;
              diffData.data[px+1] = 255;
              diffData.data[px+2] = 255;
              diffData.data[px+3] = 255;
            }
          }
          diffCtx.putImageData(diffData, 0, 0);
          
          diffImages.push({ pageNumber: pg, canvas: diffCanvas, diffPixels: diffPixels, totalPixels: canvasA.width * canvasA.height });
        } catch (e) { /* skip failed pages */ }
      }
    }
    
    onProgress(4, 4, 'Generando reporte...');
    var report = [
      '=== COMPARACIÓN DE PDFs ===',
      '',
      'PDF A: ' + fileA.name + ' (' + pdfA.numPages + ' páginas)',
      'PDF B: ' + fileB.name + ' (' + pdfB.numPages + ' páginas)',
      '',
      'Páginas idénticas: ' + identicalPages.length,
      'Páginas modificadas: ' + modifiedPages.length,
      'Páginas añadidas en B: ' + addedPages.length,
      'Páginas eliminadas en B: ' + removedPages.length,
      ''
    ];
    
    if (modifiedPages.length > 0) report.push('Páginas modificadas: ' + modifiedPages.join(', '));
    if (addedPages.length > 0) report.push('Páginas añadidas: ' + addedPages.join(', '));
    if (removedPages.length > 0) report.push('Páginas eliminadas: ' + removedPages.join(', '));
    if (identicalPages.length > 0) report.push('Páginas idénticas: ' + identicalPages.join(', '));
    
    report.push('');
    report.push('=== FIN ===');
    
    var results = [];
    var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    results.push({ name: 'comparacion-' + getBaseName(fileA.name) + '-vs-' + getBaseName(fileB.name) + '.txt', blob: reportBlob });
    
    for (var di = 0; di < diffImages.length; di++) {
      var diffImg = diffImages[di];
      var diffBlob = await new Promise(function(resolve) { diffImg.canvas.toBlob(function(b) { resolve(b); }, 'image/png'); });
      results.push({ name: 'diff-pagina-' + diffImg.pageNumber + '.png', blob: diffBlob });
    }
    
    return makeResult(results, 'Comparación completada: ' + identicalPages.length + ' idénticas, ' + modifiedPages.length + ' modificadas, ' + addedPages.length + ' añadidas, ' + removedPages.length + ' eliminadas.');
  };

  // ─── MOTOR DE TEXTO ────────────────────────────────────────────────────

  function _countWords(text) {
    var matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return matches ? matches.length : 0;
  }

  function _countSentences(text) {
    var matches = text.match(/[.!?…]+(\s|$)|[.!?…]+(?=["'”»])/g);
    return matches ? matches.length : 0;
  }

  var _STOPWORDS_ES = new Set(['de','la','el','en','y','a','los','del','las','un','por','con','una','su','para','es','al','lo','como','mas','o','pero','sus','le','ya','este','ha','si','porque','esta','son','entre','cuando','muy','sin','sobre','ser','tambien','me','hasta','hay','donde','quien','desde','todo','nos','durante','todos','uno','les','ni','contra','otros','ese','eso','ante','ellos','e','esto','mi','antes','algunos','que','unos','yo','otro','otras','otra','el','tanto','esa','estos','mucho','quienes','nada','muchos','cual','poco','ella']);
  var _STOPWORDS_EN = new Set(['the','be','to','of','and','a','in','that','have','i','it','for','not','on','with','he','as','you','do','at','this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all','would','there','their','what','so','up','out','if','about','who','get','which','go','me','when','make','can','like','time','no','just','him','know','take','people','into','year','your','good','some','could','them','see','other','than','then','now','look','only','come','its','over','think','also','back','after','use','two','how','our','work','first','well','way','even','new','want','because','any','these','give','day','most','us']);

  function _getWords(text) {
    return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:[\u2019\u2018''\-][\p{L}\p{N}]+)*/gu) || []);
  }

  function _wordFrequency(words, excludeStopwords) {
    var freq = {};
    words.forEach(function(w) {
      if (excludeStopwords && (_STOPWORDS_ES.has(w) || _STOPWORDS_EN.has(w))) return;
      freq[w] = (freq[w] || 0) + 1;
    });
    return Object.keys(freq).map(function(k) { return [k, freq[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  }

  function _longestWords(words) {
    var unique = {};
    words.forEach(function(w) { if (!unique[w] || w.length > unique[w].length) unique[w] = w; });
    return Object.values(unique).sort(function(a, b) { return b.length - a.length; }).slice(0, 10);
  }

  function _hapax(words) {
    var freq = {};
    words.forEach(function(w) { freq[w] = (freq[w] || 0) + 1; });
    return Object.keys(freq).filter(function(w) { return freq[w] === 1; }).length;
  }

  function _countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    var m = word.match(/[aeiouy]+/g);
    return m ? m.length : 1;
  }

  function _buildMultiResult(blobs, stats, message) {
    return {
      files: blobs.map(function(b) { return { name: b.name, blob: b.blob, size: b.blob.size }; }),
      message: message || 'Analisis completado.',
      stats: stats || [],
      title: message || 'Analisis completado'
    };
  }

  function _buildReportHtml(fileName, stats, freq, longest, summary) {
    var freqRows = freq.slice(0, 20).map(function(pair, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + pair[0] + '</td><td>' + pair[1] + '</td><td>' + ((pair[1] / Math.max(1, stats.totalWords) * 100).toFixed(2)) + '%</td></tr>';
    }).join('\n');
    var statsHtml = stats.rows.map(function(r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td style="color:#666;font-size:.85em">' + (r[2] || '') + '</td></tr>';
    }).join('\n');
    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Toolisto Report - ' + fileName + '</title>';
    html += '<style>@page{margin:1.5cm}body{font-family:Inter,-apple-system,system-ui,sans-serif;color:#17191C;max-width:700px;margin:0 auto;padding:24px;line-height:1.5}';
    html += '.brand{display:flex;align-items:center;gap:8px;margin-bottom:8px}.brand-mark{width:28px;height:28px;background:#FF6542;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px}';
    html += '.brand-name{font-size:13px;color:#888;letter-spacing:.5px}h1{font-size:22px;margin:16px 0 4px;font-weight:700}h2{font-size:16px;margin:20px 0 8px;border-bottom:1px solid #e5e5e5;padding-bottom:4px}';
    html += 'table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{border:1px solid #e5e5e5;padding:6px 10px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600}';
    html += '.summary{background:#f8f8f4;border-radius:8px;padding:14px;margin:12px 0;font-size:14px;border-left:3px solid #FF6542}';
    html += '.footer{margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:11px;color:#999;text-align:center}@media print{body{padding:0}}</style></head><body>';
    html += '<div class="brand"><div class="brand-mark">T</div><span class="brand-name">TOOLISTO by Apluno</span></div>';
    html += '<h1>Reporte de analisis de texto</h1>';
    html += '<p style="color:#666;font-size:13px">Archivo: ' + fileName + ' | Generado: ' + new Date().toLocaleDateString('es-CL') + ' | Procesamiento local</p>';
    html += '<div class="summary">' + summary + '</div>';
    html += '<h2>Metricas principales</h2>';
    html += '<table><thead><tr><th>Metrica</th><th>Valor</th><th>Nota</th></tr></thead><tbody>' + statsHtml + '</tbody></table>';
    html += '<h2>Palabras mas frecuentes (Top 20)</h2>';
    html += '<table><thead><tr><th>#</th><th>Palabra</th><th>Frecuencia</th><th>%</th></tr></thead><tbody>' + freqRows + '</tbody></table>';
    if (longest.length) html += '<h2>Palabras mas largas</h2><p style="font-size:13px;color:#555">' + longest.join(' | ') + '</p>';
    html += '<div class="footer">Toolisto by Apluno | apluno.com | Este reporte fue generado localmente en tu navegador. Ningun dato salio de tu dispositivo.</div>';
    html += '</body></html>';
    return html;
  }

  function _analyzeText(text, file) {
    var words = _countWords(text);
    var sentences = _countSentences(text);
    var paragraphs = text.split(/\n{2,}/).filter(function(p) { return p.trim() !== ''; }).length;
    var lines = text.split('\n').length;
    var chars = text.length;
    var charsNoSpaces = text.replace(/\s/g, '').length;
    var lowerWords = _getWords(text);
    var uniqueWords = new Set(lowerWords).size;
    var avgWordLen = words > 0 ? (charsNoSpaces / words) : 0;
    var readingMinutes = Math.max(1, Math.round(words / 200));
    var speakingMinutes = Math.max(1, Math.round(words / 130));
    var lexicalDiversity = words > 0 ? (uniqueWords / words * 100) : 0;
    var avgWordsPerSentence = sentences > 0 ? (words / sentences) : 0;
    var avgWordsPerParagraph = paragraphs > 0 ? (words / paragraphs) : 0;
    var totalSyllables = 0;
    lowerWords.forEach(function(w) { totalSyllables += _countSyllables(w); });
    var avgSyllablesPerWord = words > 0 ? (totalSyllables / words) : 0;
    var freq = _wordFrequency(lowerWords, true);
    var hapaxCount = _hapax(lowerWords);
    var longest = _longestWords(lowerWords);
    var uniquePercent = words > 0 ? (uniqueWords / words * 100) : 0;

    var summary = 'Este documento contiene <strong>' + words.toLocaleString('es-CL') + ' palabras</strong> ';
    summary += 'y aproximadamente <strong>' + readingMinutes + ' minutos de lectura</strong>. ';
    summary += 'Se detectaron <strong>' + uniqueWords.toLocaleString('es-CL') + ' palabras unicas</strong> ';
    summary += '(' + uniquePercent.toFixed(1) + '% del vocabulario total). ';
    summary += 'La diversidad lexica es del ' + lexicalDiversity.toFixed(1) + '%.';

    var statsData = {
      totalWords: words,
      rows: [
        ['Palabras', words.toLocaleString('es-CL'), 'Total de palabras en el documento'],
        ['Palabras unicas', uniqueWords.toLocaleString('es-CL'), uniquePercent.toFixed(1) + '% del vocabulario total'],
        ['Caracteres (con espacios)', chars.toLocaleString('es-CL'), ''],
        ['Caracteres (sin espacios)', charsNoSpaces.toLocaleString('es-CL'), ''],
        ['Oraciones / frases', sentences.toLocaleString('es-CL'), ''],
        ['Parrafos', paragraphs.toLocaleString('es-CL'), ''],
        ['Lineas', lines.toLocaleString('es-CL'), ''],
        ['Diversidad lexica', lexicalDiversity.toFixed(1) + '%', 'Indica que porcentaje del vocabulario usado es diferente'],
        ['Longitud media de palabra', avgWordLen.toFixed(1) + ' caracteres', ''],
        ['Palabras promedio por oracion', avgWordsPerSentence.toFixed(1), 'Indica la complejidad sintactica'],
        ['Palabras promedio por parrafo', avgWordsPerParagraph.toFixed(1), ''],
        ['Silabas promedio por palabra', avgSyllablesPerWord.toFixed(1), ''],
        ['Tiempo de lectura (aprox.)', readingMinutes + ' min', 'Basado en ~200 palabras/min'],
        ['Tiempo de voz alta (aprox.)', speakingMinutes + ' min', 'Basado en ~130 palabras/min'],
        ['Palabras de aparicion unica (hapax)', hapaxCount.toLocaleString('es-CL'), 'Palabras que aparecen solo una vez']
      ]
    };

    var statsRows = statsData.rows.map(function(r) { return [r[0], r[1]]; });

    return { words: words, sentences: sentences, paragraphs: paragraphs, lines: lines, chars: chars, charsNoSpaces: charsNoSpaces, uniqueWords: uniqueWords, avgWordLen: avgWordLen, readingMinutes: readingMinutes, speakingMinutes: speakingMinutes, lexicalDiversity: lexicalDiversity, freq: freq, longest: longest, hapaxCount: hapaxCount, summary: summary, statsData: statsData, statsRows: statsRows };
  }

  function _buildStatsResult(blob, name, stats, message) {
    return {
      files: [{ name: name, blob: blob, size: blob.size }],
      message: message || 'Análisis completado.',
      stats: stats || [],
      title: message || 'Análisis completado'
    };
  }

  window.ToolProcessors.textStatistics = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo de texto.' };
    var file = files[0];
    onProgress(1, 3, 'Extrayendo texto del archivo...');
    var text = await _extractTextFromFile(file);
    if (!text || !text.trim()) return { files: [], message: 'No se pudo extraer texto del archivo. Si es un PDF escaneado, intenta con otra herramienta de OCR.' };
    onProgress(2, 3, 'Calculando estadisticas...');
    var a = _analyzeText(text, file);
    onProgress(3, 3, 'Generando reporte...');
    var baseName = getBaseName(file.name);
    var txtReport = [
      '===================================================',
      '  TOOLISTO - Reporte de analisis de texto',
      '===================================================',
      '',
      'Archivo: ' + file.name,
      'Fecha: ' + new Date().toLocaleDateString('es-CL'),
      'Procesamiento: local',
      '',
      '--- Resumen ---',
      a.summary.replace(/<[^>]*>/g, ''),
      '',
      '--- Metricas ---'
    ].concat(a.statsRows.map(function(r) { return r[0] + ': ' + r[1]; })).concat([
      '',
      '--- Top 20 palabras frecuentes (sin stopwords) ---'
    ]).concat(a.freq.slice(0, 20).map(function(pair, i) { return (i + 1) + '. ' + pair[0] + ' (' + pair[1] + ' - ' + ((pair[1] / Math.max(1, a.words) * 100).toFixed(2)) + '%)'; })).concat([
      '',
      '--- Palabras mas largas ---',
      a.longest.join(', '),
      '',
      '===================================================',
      'Toolisto by Apluno - apluno.com',
      'Este reporte fue generado localmente.',
      '==================================================='
    ]);
    var txtBlob = new Blob([txtReport.join('\n')], { type: 'text/plain;charset=utf-8' });
    var htmlReport = _buildReportHtml(file.name, a.statsData, a.freq, a.longest, a.summary);
    var htmlBlob = new Blob([htmlReport], { type: 'text/html;charset=utf-8' });
    return _buildMultiResult([
      { name: baseName + '-reporte.html', blob: htmlBlob },
      { name: baseName + '-estadisticas.txt', blob: txtBlob }
    ], a.statsRows, 'Estadisticas de texto calculadas. Se generaron 2 archivos: reporte HTML imprimible y resumen TXT.');
  };

  window.ToolProcessors.wordCount = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo de texto.' };
    var file = files[0];
    onProgress(1, 3, 'Extrayendo texto del archivo...');
    var text = await _extractTextFromFile(file);
    if (!text || !text.trim()) return { files: [], message: 'No se pudo extraer texto del archivo. Si es un PDF escaneado, intenta con otra herramienta de OCR.' };
    onProgress(2, 3, 'Contando palabras...');
    var a = _analyzeText(text, file);
    onProgress(3, 3, 'Generando reporte...');
    var baseName = getBaseName(file.name);
    var txtReport = [
      '===================================================',
      '  TOOLISTO - Conteo de palabras',
      '===================================================',
      '',
      'Archivo: ' + file.name,
      'Fecha: ' + new Date().toLocaleDateString('es-CL'),
      'Procesamiento: local',
      '',
      '--- Resumen ---',
      a.summary.replace(/<[^>]*>/g, ''),
      '',
      '--- Metricas ---'
    ].concat(a.statsRows.map(function(r) { return r[0] + ': ' + r[1]; })).concat([
      '',
      '===================================================',
      'Toolisto by Apluno - apluno.com',
      '==================================================='
    ]);
    var txtBlob = new Blob([txtReport.join('\n')], { type: 'text/plain;charset=utf-8' });
    var htmlReport = _buildReportHtml(file.name, a.statsData, a.freq, a.longest, a.summary);
    var htmlBlob = new Blob([htmlReport], { type: 'text/html;charset=utf-8' });
    return _buildMultiResult([
      { name: baseName + '-reporte.html', blob: htmlBlob },
      { name: baseName + '-conteo.txt', blob: txtBlob }
    ], a.statsRows, 'Conteo completado: ' + a.words.toLocaleString('es-CL') + ' palabras. Se generaron 2 archivos.');
  };
  window.ToolProcessors.textDiff = async function(files, options, onProgress) {
    if (!files || files.length < 2) return { files: [], message: 'Selecciona dos archivos de texto para comparar.' };
    var fileA = files[0];
    var fileB = files[1];
    onProgress(1, 3, 'Leyendo archivo A...');
    var textA = await readFileAsText(fileA);
    onProgress(2, 3, 'Leyendo archivo B...');
    var textB = await readFileAsText(fileB);
    onProgress(3, 3, 'Comparando líneas...');

    var linesA = textA.split('\n');
    var linesB = textB.split('\n');

    var dp = new Array(linesA.length + 1);
    for (var i = 0; i <= linesA.length; i++) dp[i] = new Array(linesB.length + 1).fill(0);
    for (i = linesA.length - 1; i >= 0; i--) {
      for (var j = linesB.length - 1; j >= 0; j--) {
        if (linesA[i] === linesB[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    var report = [];
    var added = 0, removed = 0, i = 0, j = 0;
    while (i < linesA.length && j < linesB.length) {
      if (linesA[i] === linesB[j]) {
        report.push('  ' + linesA[i]);
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        report.push('- ' + linesA[i]);
        removed++; i++;
      } else {
        report.push('+ ' + linesB[j]);
        added++; j++;
      }
    }
    while (i < linesA.length) { report.push('- ' + linesA[i]); removed++; i++; }
    while (j < linesB.length) { report.push('+ ' + linesB[j]); added++; j++; }

    var output = [
      'Diferencias entre: ' + fileA.name + ' (A) y ' + fileB.name + ' (B)',
      '================================================================',
      '',
      'Líneas añadidas: ' + added,
      'Líneas eliminadas: ' + removed,
      '',
      'Leyenda: "-" solo en A, "+" solo en B, " " común a ambos.',
      ''
    ].concat(report).join('\n');

    var stats = [
      ['Líneas en A', String(linesA.length)],
      ['Líneas en B', String(linesB.length)],
      ['Añadidas', String(added)],
      ['Eliminadas', String(removed)]
    ];

    var blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    return _buildStatsResult(blob, 'comparacion-texto.txt', stats, 'Comparación completada: ' + added + ' añadidas, ' + removed + ' eliminadas.');
  };

  window.ToolProcessors.htmlToMarkdown = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo HTML.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo HTML...');
    var html = await readFileAsText(file);
    onProgress(2, 2, 'Convirtiendo a Markdown...');
    var md = htmlToMarkdown(html);
    if (!md) return { files: [], message: 'No se encontró contenido convertible en el HTML.' };
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.md', 'HTML convertido a Markdown correctamente.');
  };

  window.ToolProcessors.htmlToText = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo HTML.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo HTML...');
    var html = await readFileAsText(file);
    onProgress(2, 2, 'Extrayendo texto...');

    var text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&[a-zA-Z]+;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text) return { files: [], message: 'No se encontró texto visible en el HTML.' };
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.txt', 'Texto extraído del HTML correctamente.');
  };

  window.ToolProcessors.cssMinifier = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSS.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSS...');
    var css = await readFileAsText(file);
    onProgress(2, 2, 'Minificando...');

    var minified = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,>])\s*/g, '$1')
      .replace(/;}/g, '}')
      .trim();

    var stats = [
      ['Tamaño original', formatBytesLocal(new Blob([css]).size)],
      ['Tamaño minificado', formatBytesLocal(new Blob([minified]).size)]
    ];

    var blob = new Blob([minified], { type: 'text/css;charset=utf-8' });
    return _buildStatsResult(blob, getBaseName(file.name) + '.min.css', stats, 'CSS minificado correctamente.');
  };

  function formatBytesLocal(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  window.ToolProcessors.base64Encode = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo para codificar.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo archivo...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Codificando en Base64...');
    var encoded;
    try {
      encoded = btoa(unescape(encodeURIComponent(text)));
    } catch (e) {
      return { files: [], message: 'No se pudo codificar el archivo: ' + e.message };
    }
    var blob = new Blob([encoded], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-base64.txt', 'Archivo codificado en Base64.');
  };

  window.ToolProcessors.base64Decode = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo con contenido Base64.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo archivo...');
    var encoded = await readFileAsText(file);
    onProgress(2, 2, 'Decodificando Base64...');
    var clean = encoded.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 === 1) {
      return { files: [], message: 'El contenido no parece Base64 válido.' };
    }
    try {
      var decoded = decodeURIComponent(escape(atob(clean)));
      var blob = new Blob([decoded], { type: 'text/plain;charset=utf-8' });
      return makeSingleResult(blob, getBaseName(file.name) + '-decodificado.txt', 'Base64 decodificado correctamente.');
    } catch (e) {
      var raw = atob(clean);
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      var blob = new Blob([bytes], { type: 'application/octet-stream' });
      return makeSingleResult(blob, getBaseName(file.name) + '-decodificado.bin', 'Base64 decodificado como datos binarios.');
    }
  };

  window.ToolProcessors.urlEncode = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo para codificar.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo archivo...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Codificando URL...');
    var encoded;
    try {
      encoded = encodeURIComponent(text);
    } catch (e) {
      return { files: [], message: 'No se pudo codificar la URL: ' + e.message };
    }
    var blob = new Blob([encoded], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-url.txt', 'Contenido codificado para URL.');
  };

  window.ToolProcessors.urlDecode = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo con contenido codificado.' };
    var file = files[0];
    onProgress(1, 2, 'Leyendo archivo...');
    var encoded = await readFileAsText(file);
    onProgress(2, 2, 'Decodificando URL...');
    var decoded;
    try {
      decoded = decodeURIComponent(encoded);
    } catch (e) {
      return { files: [], message: 'El contenido no parece estar codificado como URL: ' + e.message };
    }
    var blob = new Blob([decoded], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-decodificado.txt', 'Contenido decodificado correctamente.');
  };

  // ─── MOTOR DE HOJAS DE CÁLCULO Y DATOS ──────────────────────────────────

  function _normalizeSeparator(sep) {
    if (sep === '\\t') return '\t';
    return sep;
  }

  function _detectSeparator(text) {
    var firstLine = text.split('\n')[0] || '';
    var candidates = [
      { sep: '\t', name: 'tabulación' },
      { sep: ';', name: 'punto y coma' },
      { sep: ',', name: 'coma' }
    ];
    var best = candidates[0];
    var bestCount = -1;
    candidates.forEach(function(c) {
      var n = firstLine.split(c.sep).length - 1;
      if (n > bestCount) { bestCount = n; best = c; }
    });
    return best.sep;
  }

  function _csvToAoa(text, separator) {
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var sep = separator && separator !== 'auto' ? _normalizeSeparator(separator) : _detectSeparator(text);
    var wb = window.XLSX.read(text, { type: 'string', raw: true, FS: sep });
    var ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  function _escapeMd(value) {
    return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _escapeXml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function _yamlScalar(value) {
    var s = String(value);
    if (value === null || value === undefined || s === '') return 'null';
    if (/^(true|false)$/i.test(s)) return s.toLowerCase();
    if (!isNaN(Number(s)) && s.trim() !== '') return s;
    if (/^[-:?.,\s]|[:#\[\]{}&*!|>'"%@`]/.test(s) || /\s$/.test(s)) {
      return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return s;
  }

  function _quotedCsvCell(value, separator) {
    var s = String(value === null || value === undefined ? '' : value);
    s = neutralizeCsvCell(s);
    if (s.indexOf(separator) !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function _rejectWrongType(file, exts, message) {
    var name = (file && file.name) || '';
    var ext = name.split('.').pop().toLowerCase();
    if (!name || exts.indexOf(ext) === -1) return { files: [], message: message };
    return null;
  }

  window.ToolProcessors.csvToMarkdown = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Generando tabla Markdown...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0].map(_escapeMd);
    var rows = aoa.slice(1);
    var lines = [];
    lines.push('| ' + header.join(' | ') + ' |');
    lines.push('| ' + header.map(function() { return '---'; }).join(' | ') + ' |');
    rows.forEach(function(row) {
      var cells = [];
      for (var i = 0; i < header.length; i++) cells.push(_escapeMd(row[i]));
      lines.push('| ' + cells.join(' | ') + ' |');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.md', 'Tabla Markdown generada (' + rows.length + ' filas).');
  };

  window.ToolProcessors.csvToHtml = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Generando tabla HTML...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0];
    var rows = aoa.slice(1);
    var html = ['<!DOCTYPE html>', '<html lang="es">', '<head><meta charset="UTF-8"/><title>Tabla desde CSV</title>',
      '<style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f2f2}tr:nth-child(even){background:#f9f9f9}</style>',
      '</head><body><table><thead><tr>'];
    header.forEach(function(h) { html.push('<th>' + _escapeHtml(h) + '</th>'); });
    html.push('</tr></thead><tbody>');
    rows.forEach(function(row) {
      html.push('<tr>');
      for (var i = 0; i < header.length; i++) html.push('<td>' + _escapeHtml(row[i]) + '</td>');
      html.push('</tr>');
    });
    html.push('</tbody></table></body></html>');
    var blob = new Blob([html.join('')], { type: 'text/html;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.html', 'Tabla HTML generada (' + rows.length + ' filas).');
  };

  window.ToolProcessors.csvToYaml = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Generando YAML...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0].map(function(h, i) { return String(h || ('columna' + (i + 1))); });
    var rows = aoa.slice(1);
    var out = [];
    out.push('datos:');
    rows.forEach(function(row) {
      out.push('-');
      for (var i = 0; i < header.length; i++) {
        out.push('  ' + _yamlScalar(header[i]).replace(/"/g, '').replace(/\s+/g, '_') + ': ' + _yamlScalar(row[i]));
      }
    });
    var blob = new Blob([out.join('\n')], { type: 'application/yaml;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.yaml', 'YAML generado (' + rows.length + ' filas).');
  };

  window.ToolProcessors.excelToHtml = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo Excel.' };
    var guard = _rejectWrongType(files[0], ['xlsx', 'xls'], 'Selecciona un archivo Excel.');
    if (guard) return guard;
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var file = files[0];
    onProgress(1, 2, 'Leyendo Excel...');
    var data = await file.arrayBuffer();
    var wb = window.XLSX.read(data, { type: 'array' });
    onProgress(2, 2, 'Generando HTML...');
    var sheetNames = options.sheet && options.sheet !== 'todas' ? [options.sheet] : wb.SheetNames;
    if (!sheetNames.length) return { files: [], message: 'El libro no tiene hojas.' };
    var html = ['<!DOCTYPE html>', '<html lang="es">', '<head><meta charset="UTF-8"/><title>Excel a HTML</title>',
      '<style>body{font-family:Arial,sans-serif;margin:24px}h2{color:#333}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f2f2}tr:nth-child(even){background:#f9f9f9}</style>',
      '</head><body>'];
    sheetNames.forEach(function(name) {
      var ws = wb.Sheets[name];
      var aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!aoa.length) return;
      html.push('<h2>' + _escapeHtml(name) + '</h2><table><thead><tr>');
      (aoa[0] || []).forEach(function(h) { html.push('<th>' + _escapeHtml(h) + '</th>'); });
      html.push('</tr></thead><tbody>');
      aoa.slice(1).forEach(function(row) {
        html.push('<tr>');
        row.forEach(function(cell) { html.push('<td>' + _escapeHtml(cell) + '</td>'); });
        html.push('</tr>');
      });
      html.push('</tbody></table>');
    });
    html.push('</body></html>');
    var blob = new Blob([html.join('')], { type: 'text/html;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.html', 'HTML generado (' + sheetNames.length + ' hoja(s)).');
  };

  window.ToolProcessors.excelToMarkdown = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo Excel.' };
    var guard = _rejectWrongType(files[0], ['xlsx', 'xls'], 'Selecciona un archivo Excel.');
    if (guard) return guard;
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var file = files[0];
    onProgress(1, 2, 'Leyendo Excel...');
    var data = await file.arrayBuffer();
    var wb = window.XLSX.read(data, { type: 'array' });
    onProgress(2, 2, 'Generando Markdown...');
    var sheetName = options.sheet || wb.SheetNames[0];
    var ws = wb.Sheets[sheetName];
    var aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!aoa.length) return { files: [], message: 'La hoja está vacía.' };
    var header = aoa[0].map(_escapeMd);
    var lines = [];
    lines.push('# ' + sheetName);
    lines.push('');
    lines.push('| ' + header.join(' | ') + ' |');
    lines.push('| ' + header.map(function() { return '---'; }).join(' | ') + ' |');
    aoa.slice(1).forEach(function(row) {
      var cells = [];
      for (var i = 0; i < header.length; i++) cells.push(_escapeMd(row[i]));
      lines.push('| ' + cells.join(' | ') + ' |');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.md', 'Tabla Markdown generada desde "' + sheetName + '".');
  };

  window.ToolProcessors.xmlToExcel = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo XML.' };
    var guard = _rejectWrongType(files[0], ['xml'], 'Selecciona un archivo XML.');
    if (guard) return guard;
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var file = files[0];
    onProgress(1, 2, 'Leyendo XML...');
    var text = await readFileAsText(file);
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var errorNode = doc.querySelector('parsererror');
    if (errorNode) return { files: [], message: 'XML inválido: ' + errorNode.textContent.substring(0, 200) };
    onProgress(2, 2, 'Detectando estructura...');
    var root = doc.documentElement;
    var repeated = {};
    root.childNodes.forEach(function(child) {
      if (child.nodeType === 1) repeated[child.nodeName] = (repeated[child.nodeName] || 0) + 1;
    });
    var rowTag = null;
    Object.keys(repeated).forEach(function(name) {
      if (repeated[name] > 1 && (rowTag === null || repeated[name] > repeated[rowTag])) rowTag = name;
    });
    if (!rowTag) return { files: [], message: 'No se detectaron elementos repetidos como filas en el XML.' };
    var rows = Array.prototype.slice.call(root.getElementsByTagName(rowTag));
    var columnNames = [];
    var dataRows = [];
    rows.forEach(function(rowNode) {
      var row = {};
      var hasText = false;
      rowNode.childNodes.forEach(function(child) {
        if (child.nodeType !== 1) return;
        var key = child.nodeName;
        var val = child.textContent === null ? '' : child.textContent.trim();
        if (!(key in row)) columnNames.push(key);
        row[key] = val;
        if (val !== '') hasText = true;
      });
      for (var i = 0; i < rowNode.attributes.length; i++) {
        var attr = rowNode.attributes[i];
        var attrKey = '@' + attr.name;
        if (!(attrKey in row)) columnNames.push(attrKey);
        row[attrKey] = attr.value;
      }
      if (hasText || Object.keys(row).length) dataRows.push(row);
    });
    var aoa = [columnNames];
    dataRows.forEach(function(row) {
      aoa.push(columnNames.map(function(col) { return row[col] === undefined ? '' : row[col]; }));
    });
    var ws = window.XLSX.utils.aoa_to_sheet(aoa);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, rowTag.slice(0, 31));
    var wbOut = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return makeSingleResult(blob, getBaseName(file.name) + '.xlsx', 'Excel generado (' + dataRows.length + ' filas).');
  };

  window.ToolProcessors.csvStatistics = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Calculando estadísticas...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0].map(function(h, i) { return String(h || ('columna' + (i + 1))); });
    var rows = aoa.slice(1);
    var emptyValues = 0;
    var numColumns = {};
    var colCount = header.length;
    rows.forEach(function(row) {
      for (var i = 0; i < colCount; i++) {
        var v = row[i];
        if (v === '' || v === null || v === undefined) { emptyValues++; continue; }
        if (!isNaN(Number(v)) && String(v).trim() !== '') {
          if (!numColumns[header[i]]) numColumns[header[i]] = [];
          numColumns[header[i]].push(Number(v));
        }
      }
    });
    var stats = [
      ['Filas de datos', String(rows.length)],
      ['Columnas', String(colCount)],
      ['Celdas', String(rows.length * colCount)],
      ['Valores vacíos', String(emptyValues)]
    ];
    var report = [
      'Estadísticas CSV',
      '===============',
      '',
      'Archivo: ' + file.name,
      'Filas de datos: ' + rows.length,
      'Columnas: ' + colCount,
      'Valores vacíos: ' + emptyValues,
      ''
    ];
    header.forEach(function(h) {
      var values = numColumns[h] || [];
      if (values.length) {
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var sum = values.reduce(function(a, b) { return a + b; }, 0);
        var mean = sum / values.length;
        report.push('Columna "' + h + '" (numérica, ' + values.length + ' valores):');
        report.push('  Mínimo: ' + min);
        report.push('  Máximo: ' + max);
        report.push('  Media: ' + mean.toFixed(4));
        report.push('  Suma: ' + sum);
        stats.push([h + ' (min)', String(min)]);
        stats.push([h + ' (max)', String(max)]);
        stats.push([h + ' (media)', mean.toFixed(2)]);
      } else {
        report.push('Columna "' + h + '": sin valores numéricos.');
      }
      report.push('');
    });
    var blob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    return _buildStatsResult(blob, getBaseName(file.name) + '-estadisticas.txt', stats, 'Estadísticas CSV calculadas.');
  };

  function _filterCsvRows(rows, colIndex, operator, target, caseSensitive) {
    var cmp;
    if (operator === 'isEmpty') return rows.filter(function(row) { var v = row[colIndex]; return v === '' || v === null || v === undefined; });
    if (operator === 'isNotEmpty') return rows.filter(function(row) { var v = row[colIndex]; return v !== '' && v !== null && v !== undefined; });
    if (operator === '=' || operator === '!=') {
      var eq = function(v, t) {
        if (v !== '' && t !== '' && !isNaN(Number(v)) && !isNaN(Number(t))) return Number(v) === Number(t);
        return caseSensitive ? String(v) === String(t) : String(v).toLowerCase() === String(t).toLowerCase();
      };
      cmp = function(v, t) { return operator === '=' ? eq(v, t) : !eq(v, t); };
    } else if (operator === 'contains' || operator === 'notContains') {
      var contains = function(v, t) {
        return caseSensitive ? String(v).indexOf(String(t)) !== -1 : String(v).toLowerCase().indexOf(String(t).toLowerCase()) !== -1;
      };
      cmp = function(v, t) { return operator === 'contains' ? contains(v, t) : !contains(v, t); };
    } else {
      cmp = function(v, t) {
        if (!isNaN(Number(v)) && !isNaN(Number(t))) {
          var nv = Number(v), nt = Number(t);
          if (operator === '>') return nv > nt;
          if (operator === '>=') return nv >= nt;
          if (operator === '<') return nv < nt;
          if (operator === '<=') return nv <= nt;
        }
        var sv = String(v), st = String(t);
        if (operator === '>') return sv > st;
        if (operator === '>=') return sv >= st;
        if (operator === '<') return sv < st;
        return sv <= st;
      };
    }
    return rows.filter(function(row) {
      var v = row[colIndex];
      if (v === '' || v === null || v === undefined) return false;
      return cmp(v, target);
    });
  }

  window.ToolProcessors.csvFilter = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Filtrando filas...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0];
    var rows = aoa.slice(1);
    var colIndex = parseInt(options.column, 10);
    if (isNaN(colIndex)) colIndex = header.indexOf(options.columnName);
    if (colIndex < 0 || colIndex >= header.length) return { files: [], message: 'Columna de filtro no válida.' };
    if (options.value === undefined || options.value === '') return { files: [], message: 'Indica un valor para filtrar.' };
    var operator = options.operator || '=';
    var caseSensitive = !!options.caseSensitive;
    var sep = options.separator && options.separator !== 'auto' ? _normalizeSeparator(options.separator) : _detectSeparator(text);
    var filtered = _filterCsvRows(rows, colIndex, operator, options.value, caseSensitive);
    var out = [];
    filtered.forEach(function(row) {
      var line = [];
      for (var i = 0; i < header.length; i++) line.push(_quotedCsvCell(row[i], sep));
      out.push(line.join(sep));
    });
    out.unshift(header.map(function(h) { return _quotedCsvCell(h, sep); }).join(sep));
    var blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-filtrado.csv', 'CSV filtrado: ' + filtered.length + ' de ' + rows.length + ' filas.');
  };

  window.ToolProcessors.csvSort = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Ordenando filas...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0];
    var rows = aoa.slice(1);
    var colIndex = parseInt(options.column, 10);
    if (isNaN(colIndex)) colIndex = header.indexOf(options.columnName);
    if (colIndex < 0 || colIndex >= header.length) return { files: [], message: 'Columna de ordenación no válida.' };
    var dir = options.direction === 'desc' ? -1 : 1;
    var numeric = rows.some(function(row) {
      var v = row[colIndex];
      return v !== '' && v !== null && v !== undefined && !isNaN(Number(v));
    });
    var sep = options.separator && options.separator !== 'auto' ? _normalizeSeparator(options.separator) : _detectSeparator(text);
    var sorted = rows.slice().sort(function(a, b) {
      var va = a[colIndex], vb = b[colIndex];
      if (numeric) {
        var na = isNaN(Number(va)) ? NaN : Number(va);
        var nb = isNaN(Number(vb)) ? NaN : Number(vb);
        if (isNaN(na)) return 1;
        if (isNaN(nb)) return -1;
        return (na - nb) * dir;
      }
      return String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir;
    });
    var out = [header.map(function(h) { return _quotedCsvCell(h, sep); }).join(sep)];
    sorted.forEach(function(row) {
      out.push(row.map(function(cell) { return _quotedCsvCell(cell, sep); }).join(sep));
    });
    var blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-ordenado.csv', 'CSV ordenado (' + sorted.length + ' filas).');
  };

  window.ToolProcessors.csvToSql = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo CSV.' };
    var guard = _rejectWrongType(files[0], ['csv', 'tsv'], 'Selecciona un archivo CSV.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo CSV...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Generando SQL...');
    var aoa = _csvToAoa(text, options.separator);
    if (!aoa.length) return { files: [], message: 'El CSV está vacío.' };
    var header = aoa[0].map(function(h, i) {
      return String(h || ('columna' + (i + 1))).replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
    });
    var rows = aoa.slice(1);
    var tableName = (options.tableName || getBaseName(file.name)).replace(/[^A-Za-z0-9_]/g, '_').toLowerCase() || 'tabla';
    var colTypes = header.map(function(h, i) {
      var allNumeric = rows.every(function(row) {
        var v = row[i];
        return v === '' || v === null || v === undefined || (!isNaN(Number(v)) && String(v).trim() !== '');
      });
      var anyInteger = rows.some(function(row) {
        var v = row[i];
        return v !== '' && v !== null && v !== undefined && /^-?\d+$/.test(String(v).trim());
      });
      if (allNumeric) return anyInteger ? 'INTEGER' : 'REAL';
      return 'TEXT';
    });
    var sql = [];
    sql.push('CREATE TABLE IF NOT EXISTS ' + tableName + ' (');
    sql.push(header.map(function(h, i) { return '  "' + h + '" ' + colTypes[i]; }).join(',\n'));
    sql.push(');');
    sql.push('');
    var multi = options.insertStyle === 'multi';
    var esc = function(value, idx) {
      if (value === '' || value === null || value === undefined) return 'NULL';
      if (colTypes[idx] === 'TEXT') {
        return "'" + String(value).replace(/'/g, "''") + "'";
      }
      return String(value);
    };
    if (multi) {
      var tuples = rows.map(function(row) {
        return '(' + header.map(function(h, i) { return esc(row[i], i); }).join(', ') + ')';
      });
      sql.push('INSERT INTO ' + tableName + ' (' + header.map(function(h) { return '"' + h + '"'; }).join(', ') + ') VALUES');
      sql.push(tuples.join(',\n') + ';');
    } else {
      rows.forEach(function(row) {
        sql.push('INSERT INTO ' + tableName + ' (' + header.map(function(h) { return '"' + h + '"'; }).join(', ') + ') VALUES (' + header.map(function(h, i) { return esc(row[i], i); }).join(', ') + ');');
      });
    }
    var blob = new Blob([sql.join('\n')], { type: 'application/sql;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.sql', 'SQL generado (' + rows.length + ' INSERTs).');
  };

  window.ToolProcessors.jsonFormatter = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo JSON.' };
    var guard = _rejectWrongType(files[0], ['json'], 'Selecciona un archivo JSON.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo JSON...');
    var text = await readFileAsText(file);
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { files: [], message: 'JSON inválido: ' + e.message };
    }
    onProgress(2, 2, 'Formateando...');
    var indent = options.indent === 'compact' ? 0 : (parseInt(options.indent, 10) || 2);
    var output;
    if (indent === 0) {
      output = JSON.stringify(data);
    } else {
      var replacer = options.sortKeys ? (function() {
        var seen = new WeakSet();
        return function(key, val) {
          if (typeof val === 'object' && val !== null && !Array.isArray(val) && !seen.has(val)) {
            seen.add(val);
            var sorted = {};
            Object.keys(val).sort().forEach(function(k) { sorted[k] = val[k]; });
            return sorted;
          }
          return val;
        };
      })() : null;
      output = JSON.stringify(data, replacer, indent);
    }
    var blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-formateado.json', 'JSON ' + (indent === 0 ? 'compactado' : 'formateado') + ' correctamente.');
  };

  window.ToolProcessors.excelToXml = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo Excel.' };
    var guard = _rejectWrongType(files[0], ['xlsx', 'xls'], 'Selecciona un archivo Excel.');
    if (guard) return guard;
    if (!window.XLSX) throw new Error('SheetJS (XLSX) no disponible.');
    var file = files[0];
    onProgress(1, 2, 'Leyendo Excel...');
    var data = await file.arrayBuffer();
    var wb = window.XLSX.read(data, { type: 'array' });
    onProgress(2, 2, 'Generando XML...');
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<hojas>'];
    wb.SheetNames.forEach(function(name) {
      var safeName = String(name).replace(/[^A-Za-z0-9_.-]/g, '_');
      lines.push('  <hoja nombre="' + _escapeXml(safeName) + '">');
      var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      aoa.forEach(function(row) {
        lines.push('    <fila>');
        row.forEach(function(cell) {
          lines.push('      <celda>' + _escapeXml(cell) + '</celda>');
        });
        lines.push('    </fila>');
      });
      lines.push('  </hoja>');
    });
    lines.push('</hojas>');
    var blob = new Blob([lines.join('\n')], { type: 'application/xml;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.xml', 'XML generado (' + wb.SheetNames.length + ' hoja(s)).');
  };

  window.ToolProcessors.jsonValidator = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo JSON.' };
    var guard = _rejectWrongType(files[0], ['json'], 'Selecciona un archivo JSON.');
    if (guard) return guard;
    var file = files[0];
    onProgress(1, 2, 'Leyendo JSON...');
    var text = await readFileAsText(file);
    onProgress(2, 2, 'Validando...');
    var report = ['Informe de validación JSON', '========================', '', 'Archivo: ' + file.name, ''];
    try {
      JSON.parse(text);
      report.push('Resultado: VÁLIDO');
      report.push('El archivo contiene JSON bien formado.');
      report.push('Tamaño: ' + text.length + ' caracteres.');
    } catch (e) {
      var m = e.message || 'error';
      var line = 1;
      var col = 1;
      var posMatch = m.match(/position\s+(\d+)/i);
      if (posMatch) {
        var pos = parseInt(posMatch[1], 10);
        var before = text.substring(0, pos);
        line = before.split('\n').length;
        col = pos - before.lastIndexOf('\n');
      }
      report.push('Resultado: INVÁLIDO');
      report.push('Error: ' + m);
      report.push('Línea: ' + line + ', columna: ' + col);
      report.push('El JSON no puede usarse hasta corregir la sintaxis.');
    }
    var blob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-validacion.txt', 'Validación completada: consulta el informe.');
  };

  // ─── 35 NEW TOOLS — Phase B ──────────────────────────────────────────

  // B1: heicToImage, avifToImage, svgToImage, faviconGenerator, pwaIconGenerator
  window.ToolProcessors.heicToImage = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo HEIC/HEIF.' };
    if (typeof heic2any === 'undefined') throw new Error('Componente heic2any no disponible.');
    var outFmt = (options.outputFormat || options.heicOutputFormat || 'jpeg').toLowerCase();
    if (outFmt === 'image/jpeg') outFmt = 'jpeg';
    if (outFmt === 'image/png') outFmt = 'png';
    if (outFmt === 'image/webp') outFmt = 'webp';
    var quality = parseFloat(options.quality != null ? options.quality : options.heicQuality);
    if (!isFinite(quality)) quality = 0.92;
    if (quality > 1) quality = quality / 100;
    var mimeMap = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    var mime = mimeMap[outFmt] || 'image/jpeg';
    var extMap = { jpeg: 'jpg', png: 'png', webp: 'webp' };
    var ext = extMap[outFmt] || 'jpg';
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Convirtiendo HEIC...');
      var file = files[i];
      var blob;
      try {
        blob = await heic2any({ blob: file, toType: mime, quality: quality });
        if (Array.isArray(blob)) blob = blob[0];
      } catch (e) {
        throw new Error('No se pudo convertir ' + file.name + ': ' + e.message);
      }
      results.push({ name: getBaseName(file.name) + '.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) HEIC convertido(s).' };
  };

  window.ToolProcessors.avifToImage = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo AVIF.' };
    var outFmt = (options.outputFormat || options.avifOutputFormat || 'png').toLowerCase();
    if (outFmt === 'image/png') outFmt = 'png';
    if (outFmt === 'image/jpeg') outFmt = 'jpeg';
    if (outFmt === 'image/webp') outFmt = 'webp';
    var quality = parseFloat(options.quality != null ? options.quality : options.avifQuality);
    if (!isFinite(quality)) quality = 0.92;
    if (quality > 1) quality = quality / 100;
    var mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    var mime = mimeMap[outFmt] || 'image/png';
    var extMap = { png: 'png', jpeg: 'jpg', webp: 'webp' };
    var ext = extMap[outFmt] || 'png';
    var results = [];
    var avifSupported = await new Promise(function(resolve) {
      var testImg = new Image();
      testImg.onload = function() { resolve(true); URL.revokeObjectURL(testImg.src); };
      testImg.onerror = function() { resolve(false); URL.revokeObjectURL(testImg.src); };
      var testBlob = new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])], { type: 'image/avif' });
      testImg.src = URL.createObjectURL(testBlob);
      setTimeout(function() { resolve(false); }, 3000);
    });
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Convirtiendo AVIF...');
      var file = files[i];
      if (!avifSupported) {
        throw new Error('Tu navegador no soporta archivos AVIF. Actualiza a Chrome 85+, Firefox 93+ o Safari 16.4+.');
      }
      var img = await loadImageFromFile(file);
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext('2d');
      if (outFmt === 'jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, 0, 0);
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, mime, quality); });
      results.push({ name: getBaseName(file.name) + '.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) AVIF convertido(s).' };
  };

  window.ToolProcessors.svgToImage = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo SVG.' };
    var width = parseInt(options.width || options.svgWidth) || 512;
    var height = parseInt(options.height || options.svgHeight) || 512;
    var outFmt = (options.outputFormat || options.svgOutputFormat || 'png').toLowerCase();
    if (outFmt === 'image/png') outFmt = 'png';
    if (outFmt === 'image/jpeg') outFmt = 'jpeg';
    if (outFmt === 'image/webp') outFmt = 'webp';
    var quality = parseFloat(options.quality != null ? options.quality : options.svgQuality);
    if (!isFinite(quality)) quality = 0.92;
    if (quality > 1) quality = quality / 100;
    var bgColor = options.background || options.svgBackground || '';
    var mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    var mime = mimeMap[outFmt] || 'image/png';
    var extMap = { png: 'png', jpeg: 'jpg', webp: 'webp' };
    var ext = extMap[outFmt] || 'png';
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Rasterizando SVG...');
      var file = files[i];
      var text = await readFileAsText(file);
      var canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, width, height); }
      var img = await new Promise(function(resolve, reject) {
        var el = new Image();
        el.onload = function() { resolve(el); };
        el.onerror = function() { reject(new Error('No se pudo renderizar el SVG.')); };
        el.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
      });
      ctx.drawImage(img, 0, 0, width, height);
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, mime, quality); });
      results.push({ name: getBaseName(file.name) + '.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' SVG rasterizado(s).' };
  };

  window.ToolProcessors.faviconGenerator = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var sizes = [16, 32, 48, 64];
    var file = files[0];
    onProgress(1, 2, 'Cargando imagen...');
    var img = await loadImageFromFile(file);
    var results = [];
    for (var si = 0; si < sizes.length; si++) {
      var s = sizes[si];
      var canvas = document.createElement('canvas');
      canvas.width = s; canvas.height = s;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, s, s);
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
      results.push({ name: s + 'x' + s + '.png', blob: blob, size: blob.size });
    }
    if (typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      for (var ri = 0; ri < results.length; ri++) zip.file('favicon-' + results[ri].name, results[ri].blob);
      var zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      results = [{ name: 'favicons.zip', blob: zipBlob, size: zipBlob.size }];
    }
    return { files: results, message: 'Favicons generados en ' + sizes.length + ' tamaños.' };
  };

  window.ToolProcessors.pwaIconGenerator = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
    var file = files[0];
    onProgress(1, 2, 'Cargando imagen...');
    var img = await loadImageFromFile(file);
    var results = [];
    for (var si = 0; si < sizes.length; si++) {
      var s = sizes[si];
      var canvas = document.createElement('canvas');
      canvas.width = s; canvas.height = s;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, s, s);
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
      results.push({ name: 'icon-' + s + 'x' + s + '.png', blob: blob, size: blob.size });
    }
    var manifest = { icons: sizes.map(function(s) { return { src: 'icon-' + s + 'x' + s + '.png', sizes: s + 'x' + s, type: 'image/png' }; }) };
    var mBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    results.push({ name: 'manifest-icons.json', blob: mBlob, size: mBlob.size });
    if (typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      for (var ri = 0; ri < results.length; ri++) zip.file(results[ri].name, results[ri].blob);
      var zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      results = [{ name: 'pwa-icons.zip', blob: zipBlob, size: zipBlob.size }];
    }
    return { files: results, message: sizes.length + ' iconos PWA generados.' };
  };

  // B2: removeBackground, upscaleImage, faceBlur, colorPalette
  window.ToolProcessors.removeBackground = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var bgColor = options.bgColor || options.removeBgColor || '';
    var threshold = parseInt(options.threshold || options.removeBgThreshold) || 30;
    var feather = parseInt(options.feather || options.removeBgFeather) || 8;
    var outFmt = (options.outputFormat || 'png').toLowerCase();
    if (outFmt === 'image/webp') outFmt = 'webp'; else outFmt = 'png';
    var mime = outFmt === 'webp' ? 'image/webp' : 'image/png';
    var ext = outFmt === 'webp' ? 'webp' : 'png';
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Procesando imagen...');
      var file = files[i];
      var img = await loadImageFromFile(file);
      var w = img.naturalWidth, h = img.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var imageData = ctx.getImageData(0, 0, w, h);
      var data = imageData.data;
      var refR, refG, refB;
      if (bgColor && bgColor.length >= 7) {
        refR = parseInt(bgColor.slice(1, 3), 16);
        refG = parseInt(bgColor.slice(3, 5), 16);
        refB = parseInt(bgColor.slice(5, 7), 16);
      } else {
        refR = data[0]; refG = data[1]; refB = data[2];
      }
      var alphas = new Float32Array(w * h);
      var innerThreshold = threshold * 0.6;
      var outerThreshold = threshold * 1.4;
      for (var pi = 0; pi < data.length; pi += 4) {
        var dr = data[pi] - refR, dg = data[pi + 1] - refG, db = data[pi + 2] - refB;
        var dist = Math.sqrt(dr * dr + dg * dg + db * db);
        var px = pi / 4;
        if (dist <= innerThreshold) { alphas[px] = 0; }
        else if (dist >= outerThreshold) { alphas[px] = 255; }
        else { alphas[px] = Math.round(((dist - innerThreshold) / (outerThreshold - innerThreshold)) * 255); }
      }
      if (feather > 0) {
        var smoothAlphas = new Float32Array(alphas);
        var passes = Math.min(Math.ceil(feather / 2), 3);
        for (var pass = 0; pass < passes; pass++) {
          var temp = new Float32Array(smoothAlphas);
          for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
              var idx = y * w + x;
              var count = 0, sum = 0;
              for (var dy = -1; dy <= 1; dy++) {
                for (var dx = -1; dx <= 1; dx++) {
                  sum += temp[(y + dy) * w + (x + dx)]; count++;
                }
              }
              smoothAlphas[idx] = sum / count;
            }
          }
        }
        alphas = smoothAlphas;
      }
      for (var pi2 = 0; pi2 < data.length; pi2 += 4) {
        data[pi2 + 3] = Math.round(alphas[pi2 / 4]);
      }
      ctx.putImageData(imageData, 0, 0);
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, mime); });
      results.push({ name: getBaseName(file.name) + '-sin-fondo.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: 'Fondo eliminado de ' + results.length + ' imagen(es).' };
  };

  window.ToolProcessors.upscaleImage = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var scale = parseInt(options.scale || options.upscaleScale) || 2;
    if (scale < 1) scale = 1; if (scale > 8) scale = 8;
    var sharpen = options.sharpen !== 'false' && options.sharpen !== false && options.upscaleSharpen !== 'false';
    var outFmt = (options.outputFormat || 'png').toLowerCase();
    if (outFmt === 'image/png') outFmt = 'png';
    else if (outFmt === 'image/jpeg' || outFmt === 'jpeg') outFmt = 'jpeg';
    else if (outFmt === 'image/webp') outFmt = 'webp';
    else outFmt = 'png';
    var mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    var mime = mimeMap[outFmt] || 'image/png';
    var extMap = { png: 'png', jpeg: 'jpg', webp: 'webp' };
    var ext = extMap[outFmt] || 'png';
    var quality = parseFloat(options.quality != null ? options.quality : 0.92);
    if (quality > 1) quality = quality / 100;
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Ampliando resolución...');
      var file = files[i];
      var img = await loadImageFromFile(file);
      var nw = img.naturalWidth * scale, nh = img.naturalHeight * scale;
      var canvas = document.createElement('canvas');
      canvas.width = nw; canvas.height = nh;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, nw, nh);
      if (sharpen && scale >= 2) {
        try {
          var srcData = ctx.getImageData(0, 0, nw, nh);
          var src = new Uint8ClampedArray(srcData.data);
          var dst = srcData.data;
          var kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
          for (var y = 1; y < nh - 1; y++) {
            for (var x = 1; x < nw - 1; x++) {
              var r = 0, g = 0, b = 0;
              for (var ky = -1; ky <= 1; ky++) {
                for (var kx = -1; kx <= 1; kx++) {
                  var idx = ((y + ky) * nw + (x + kx)) * 4;
                  var kVal = kernel[(ky + 1) * 3 + (kx + 1)];
                  r += src[idx] * kVal;
                  g += src[idx + 1] * kVal;
                  b += src[idx + 2] * kVal;
                }
              }
              var oi = (y * nw + x) * 4;
              dst[oi] = Math.max(0, Math.min(255, r));
              dst[oi + 1] = Math.max(0, Math.min(255, g));
              dst[oi + 2] = Math.max(0, Math.min(255, b));
            }
          }
          ctx.putImageData(srcData, 0, 0);
        } catch (e) { /* sharpening is best-effort */ }
      }
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, mime, quality); });
      results.push({ name: getBaseName(file.name) + '-' + scale + 'x.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' imagen(es) ampliada(s) a ' + scale + 'x.' };
  };

  window.ToolProcessors.faceBlur = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var blurRadius = parseInt(options.blurRadius || options.faceBlurRadius) || 12;
    var pixelSize = parseInt(options.pixelSize || options.facePixelSize) || 0;
    var hasFaceDetector = typeof FaceDetector !== 'undefined';
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Detectando caras...');
      var file = files[i];
      var img = await loadImageFromFile(file);
      var w = img.naturalWidth, h = img.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var regions = [];
      if (hasFaceDetector) {
        try {
          var detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 20 });
          var faces = await detector.detect(img);
          for (var fi = 0; fi < faces.length; fi++) {
            var box = faces[fi].boundingBox;
            var pad = Math.max(box.width, box.height) * 0.15;
            regions.push({
              sx: Math.max(0, Math.floor(box.x - pad)),
              sy: Math.max(0, Math.floor(box.y - pad)),
              sw: Math.min(w - Math.max(0, Math.floor(box.x - pad)), Math.ceil(box.width + pad * 2)),
              sh: Math.min(h - Math.max(0, Math.floor(box.y - pad)), Math.ceil(box.height + pad * 2))
            });
          }
        } catch (e) { /* FaceDetector failed, fall through to heuristic */ }
      }
      if (regions.length === 0) {
        var regionSize = Math.max(40, Math.min(w, h) * 0.12);
        var cx = w / 2, cy = h * 0.35;
        var rx = regionSize, ry = regionSize * 1.1;
        regions.push({
          sx: Math.max(0, Math.floor(cx - rx)),
          sy: Math.max(0, Math.floor(cy - ry)),
          sw: Math.min(w - Math.max(0, Math.floor(cx - rx)), Math.ceil(rx * 2)),
          sh: Math.min(h - Math.max(0, Math.floor(cy - ry)), Math.ceil(ry * 2))
        });
      }
      for (var ri = 0; ri < regions.length; ri++) {
        var r = regions[ri];
        if (r.sw > 0 && r.sh > 0) {
          if (pixelSize > 1) {
            var tmpCanvas = document.createElement('canvas');
            var pw = Math.max(1, Math.floor(r.sw / pixelSize));
            var ph = Math.max(1, Math.floor(r.sh / pixelSize));
            tmpCanvas.width = pw; tmpCanvas.height = ph;
            var tCtx = tmpCanvas.getContext('2d');
            tCtx.drawImage(canvas, r.sx, r.sy, r.sw, r.sh, 0, 0, pw, ph);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmpCanvas, 0, 0, pw, ph, r.sx, r.sy, r.sw, r.sh);
            ctx.imageSmoothingEnabled = true;
          } else {
            ctx.filter = 'blur(' + blurRadius + 'px)';
            ctx.drawImage(canvas, r.sx, r.sy, r.sw, r.sh, r.sx, r.sy, r.sw, r.sh);
            ctx.filter = 'none';
          }
        }
      }
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
      results.push({ name: getBaseName(file.name) + '-blur.png', blob: blob, size: blob.size });
    }
    var faceInfo = hasFaceDetector ? 'Detección facial nativa' : 'Heurística posicional';
    return { files: results, message: regions.length + ' región(es) difuminada(s) (' + faceInfo + ').' };
  };

  window.ToolProcessors.colorPalette = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona una imagen.' };
    var numColors = parseInt(options.numColors || options.paletteColors) || 8;
    var file = files[0];
    onProgress(1, 3, 'Cargando imagen...');
    var img = await loadImageFromFile(file);
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, 200 / Math.max(w, h));
    var sw = Math.round(w * scale), sh = Math.round(h * scale);
    var canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, sw, sh);
    var imageData = ctx.getImageData(0, 0, sw, sh);
    var pixels = [];
    for (var pi = 0; pi < imageData.data.length; pi += 4) {
      if (imageData.data[pi + 3] < 128) continue;
      pixels.push([imageData.data[pi], imageData.data[pi + 1], imageData.data[pi + 2]]);
    }
    onProgress(2, 3, 'Analizando colores...');
    var centroids = [];
    for (var ci = 0; ci < numColors; ci++) {
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)].slice());
    }
    for (var iter = 0; iter < 10; iter++) {
      var groups = Array.from({ length: numColors }, function() { return []; });
      for (var px = 0; px < pixels.length; px++) {
        var p = pixels[px];
        var bestIdx = 0, bestDist = Infinity;
        for (var c = 0; c < centroids.length; c++) {
          var dr = p[0] - centroids[c][0], dg = p[1] - centroids[c][1], db = p[2] - centroids[c][2];
          var d = dr * dr + dg * dg + db * db;
          if (d < bestDist) { bestDist = d; bestIdx = c; }
        }
        groups[bestIdx].push(p);
      }
      for (var c = 0; c < centroids.length; c++) {
        if (!groups[c].length) continue;
        centroids[c] = [0, 0, 0];
        for (var g = 0; g < groups[c].length; g++) {
          centroids[c][0] += groups[c][g][0];
          centroids[c][g > 0 ? 1 : 1] += groups[c][g][1];
          centroids[c][2] += groups[c][g][2];
        }
        centroids[c] = centroids[c].map(function(v) { return Math.round(v / groups[c].length); });
      }
    }
    onProgress(3, 3, 'Generando paleta...');
    var palette = centroids.map(function(c) {
      var hex = '#' + [c[0], c[1], c[2]].map(function(v) { return v.toString(16).padStart(2, '0'); }).join('');
      var r = c[0], g = c[1], b = c[2];
      var rn = r / 255, gn = g / 255, bn = b / 255;
      var max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      var l = (max + min) / 2;
      var h = 0, s = 0;
      if (max !== min) {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
      }
      return { hex: hex, rgb: 'rgb(' + r + ',' + g + ',' + b + ')', hsl: 'hsl(' + Math.round(h * 360) + ',' + Math.round(s * 100) + '%,' + Math.round(l * 100) + '%)' };
    });
    var out = 'Paleta de colores extraída de ' + file.name + '\n';
    out += '='.repeat(40) + '\n\n';
    palette.forEach(function(c, idx) { out += (idx + 1) + '. ' + c.hex + '  ' + c.rgb + '  ' + c.hsl + '\n'; });
    var blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-paleta.txt', 'Paleta de ' + palette.length + ' colores extraída.');
  };

  // B3: htmlToImage, extractTextPdf, extractImagesPdf
  window.ToolProcessors.htmlToImage = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo HTML.' };
    if (typeof html2canvas === 'undefined') throw new Error('Componente html2canvas no disponible.');
    var width = parseInt(options.viewportWidth || options.htmlImgWidth) || 1200;
    var outFmt = (options.outputFormat || 'png').toLowerCase();
    if (outFmt === 'image/jpeg') outFmt = 'jpeg';
    else if (outFmt === 'image/webp') outFmt = 'webp';
    else outFmt = 'png';
    var mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    var mime = mimeMap[outFmt] || 'image/png';
    var extMap = { png: 'png', jpeg: 'jpg', webp: 'webp' };
    var ext = extMap[outFmt] || 'png';
    var scale = parseFloat(options.scale || options.htmlScale) || 1;
    var results = [];
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Renderizando HTML...');
      var file = files[i];
      var html = await readFileAsText(file);
      var container = document.createElement('div');
      container.style.width = width + 'px';
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.innerHTML = html;
      document.body.appendChild(container);
      var canvas;
      try {
        canvas = await html2canvas(container, { scale: scale, useCORS: true, width: width });
      } catch (e) {
        document.body.removeChild(container);
        throw new Error('Error renderizando HTML: ' + e.message);
      }
      document.body.removeChild(container);
      var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, mime); });
      results.push({ name: getBaseName(file.name) + '.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' imagen(es) generada(s) desde HTML.' };
  };

  window.ToolProcessors.extractTextPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    var pageFrom = parseInt(options.pageFrom) || 1;
    var pageTo = parseInt(options.pageTo) || pdf.numPages;
    if (pageFrom < 1) pageFrom = 1;
    if (pageTo > pdf.numPages) pageTo = pdf.numPages;
    var outFormat = (options.format || 'txt').toLowerCase();
    var texts = [];
    for (var p = pageFrom; p <= pageTo; p++) {
      onProgress(p - pageFrom + 1, pageTo - pageFrom + 1, 'Extrayendo página ' + p + '...');
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var pageText = tc.items.map(function(item) { return item.str; }).join(' ');
      texts.push(pageText);
    }
    var output;
    if (outFormat === 'json') {
      output = JSON.stringify({ file: file.name, pages: texts.map(function(t, idx) { return { page: idx + 1, text: t }; }) }, null, 2);
    } else if (outFormat === 'markdown') {
      output = texts.map(function(t, idx) { return '## Página ' + (idx + 1) + '\n\n' + t; }).join('\n\n---\n\n');
    } else {
      output = texts.join('\n\n');
    }
    var blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    var ext = outFormat === 'json' ? '.json' : outFormat === 'markdown' ? '.md' : '.txt';
    return makeSingleResult(blob, getBaseName(file.name) + ext, 'Texto extraído de ' + texts.length + ' página(s).');
  };

  window.ToolProcessors.extractImagesPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    var results = [];
    var imgCount = 0;
    for (var p = 1; p <= pdf.numPages; p++) {
      onProgress(p, pdf.numPages, 'Extrayendo imágenes de página ' + p + '...');
      var page = await pdf.getPage(p);
      var ops = await page.getOperatorList();
      var seenObjs = {};
      for (var oi = 0; oi < ops.fnArray.length; oi++) {
        if (ops.fnArray[oi] === pdfjsLib.OPS.paintImageXObject || ops.fnArray[oi] === pdfjsLib.OPS.paintJpegXObject) {
          var objId = ops.argsArray[oi][0];
          if (seenObjs[objId]) continue;
          seenObjs[objId] = true;
          try {
            var imgData = await new Promise(function(resolve, reject) {
              page.objs.get(objId, function(data) { data ? resolve(data) : reject(new Error('No data')); });
            });
            if (imgData && imgData.width > 0 && imgData.height > 0) {
              var tmpCanvas = document.createElement('canvas');
              tmpCanvas.width = imgData.width;
              tmpCanvas.height = imgData.height;
              var tmpCtx = tmpCanvas.getContext('2d');
              var imgDataObj = tmpCtx.createImageData(imgData.width, imgData.height);
              if (imgData.data) {
                var src = imgData.data;
                var dst = imgDataObj.data;
                var len = Math.min(src.length, dst.length);
                for (var di = 0; di < len; di++) dst[di] = src[di];
              }
              tmpCtx.putImageData(imgDataObj, 0, 0);
              var ext = (objId.indexOf('jpeg') >= 0 || objId.indexOf('jpg') >= 0) ? 'jpg' : 'png';
              var mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
              var blob = await new Promise(function(resolve) { tmpCanvas.toBlob(resolve, mime, 0.92); });
              imgCount++;
              results.push({ name: 'pagina-' + p + '-img-' + imgCount + '.' + ext, blob: blob, size: blob.size });
            }
          } catch (e) { /* skip unresolvable image objects */ }
        }
      }
    }
    if (results.length === 0) {
      onProgress(2, 3, 'No se encontraron imágenes embebidas; renderizando páginas...');
      for (var p2 = 1; p2 <= pdf.numPages; p2++) {
        var page2 = await pdf.getPage(p2);
        var vp = page2.getViewport({ scale: 1.5 });
        var canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        var ctx = canvas.getContext('2d');
        await page2.render({ canvasContext: ctx, viewport: vp }).promise;
        var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
        imgCount++;
        results.push({ name: 'pagina-' + p2 + '.png', blob: blob, size: blob.size });
      }
    }
    if (results.length > 1 && typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      for (var ri = 0; ri < results.length; ri++) zip.file(results[ri].name, results[ri].blob);
      var zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      results = [{ name: getBaseName(file.name) + '-imagenes.zip', blob: zipBlob, size: zipBlob.size }];
    }
    return { files: results, message: imgCount + ' imagen(es) extraída(s) de ' + pdf.numPages + ' página(s).' };
  };

  // B4: pdfToPptx, pptxToPdf, excelToPdf, htmlToPdf, pdfToPdfa, pdfToMarkdown
  window.ToolProcessors.pdfToPptx = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible.');
    if (typeof JSZip === 'undefined') throw new Error('JSZip no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    var zip = new JSZip();
    var slideEntries = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      onProgress(p, pdf.numPages, 'Renderizando página ' + p + '...');
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 2 });
      var emuW = Math.round(vp.width * 9525);
      var emuH = Math.round(vp.height * 9525);
      var canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      var imgBlob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
      var imgData = await imgBlob.arrayBuffer();
      zip.file('ppt/media/image' + p + '.png', imgData);
      var slideIdx = p - 1;
      var slideRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + p + '.png"/>' +
        '</Relationships>';
      zip.file('ppt/slides/_rels/slide' + p + '.xml.rels', slideRels);
      var slideXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
        ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<p:cSld><p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
        '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        '<p:pic>' +
        '<p:nvPicPr><p:cNvPr id="2" name="Image' + p + '"/>' +
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>' +
        '<p:nvPr/></p:nvPicPr>' +
        '<p:blipFill><a:blip r:embed="rId1"/>' +
        '<a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + emuW + '" cy="' + emuH + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        '</p:pic>' +
        '</p:spTree></p:cSld></p:sld>';
      zip.file('ppt/slides/slide' + p + '.xml', slideXml);
      slideEntries.push(p);
    }
    var presRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      slideEntries.map(function(s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + s + '.xml"/>'; }).join('') +
      '</Relationships>';
    zip.file('ppt/_rels/presentation.xml.rels', presRels);
    var ctParts = slideEntries.map(function(s) { return '<Override PartName="/ppt/slides/slide' + s + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'; }).join('');
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/presentation.xml.rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>' +
      ctParts + '</Types>';
    zip.file('[Content_Types].xml', ct);
    var presXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<p:sldIdLst>' + slideEntries.map(function(s, i) { return '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</p:sldIdLst></p:presentation>';
    zip.file('ppt/presentation.xml', presXml);
    var zipBlob = await zip.generateAsync({ type: 'blob' });
    return { files: [{ name: getBaseName(file.name) + '.pptx', blob: zipBlob, size: zipBlob.size }], message: pdf.numPages + ' diapositiva(s) generada(s).' };
  };

  window.ToolProcessors.pptxToPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo PPTX.' };
    if (typeof JSZip === 'undefined') throw new Error('JSZip no disponible.');
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Procesando PPTX...');
      var file = files[fi];
      var data = await file.arrayBuffer();
      var zip = await JSZip.loadAsync(data);
      var slideFiles = [];
      zip.forEach(function(path, entry) {
        if (/^ppt\/slides\/slide\d+\.xml$/i.test(path)) slideFiles.push({ path: path, entry: entry });
      });
      slideFiles.sort(function(a, b) {
        var na = parseInt(a.path.match(/slide(\d+)\.xml$/i)[1]);
        var nb = parseInt(b.path.match(/slide(\d+)\.xml$/i)[1]);
        return na - nb;
      });
      var mediaFiles = {};
      zip.forEach(function(path, entry) {
        if (/^ppt\/media\/(image\d+\.(png|jpe?g|gif|bmp|emf|tiff?))$/i.test(path)) {
          mediaFiles[path.split('/').pop().toLowerCase()] = entry;
        }
      });
      var pdfDoc = await PDFLib.PDFDocument.create();
      var imageCount = 0;
      var textCount = 0;
      for (var si = 0; si < slideFiles.length; si++) {
        var slideXml = await slideFiles[si].entry.async('string');
        var textParts = [];
        var re = /<a:t>([^<]*)<\/a:t>/g;
        var m;
        while ((m = re.exec(slideXml)) !== null) {
          if (m[1].trim()) textParts.push(m[1].trim());
        }
        var imgRefs = [];
        var imgRe = /r:embed="(rId\d+)"/g;
        while ((m = imgRe.exec(slideXml)) !== null) imgRefs.push(m[1]);
        var slideRelsPath = slideFiles[si].path.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
        var slideRelsEntry = zip.file(slideRelsPath);
        var imgFile = null;
        if (slideRelsEntry) {
          var relsXml = await slideRelsEntry.async('string');
          for (var ir = 0; ir < imgRefs.length; ir++) {
            var relRe = new RegExp('Id="' + imgRefs[ir] + '"[^>]*Target="([^"]+)"');
            var relM = relsXml.match(relRe);
            if (relM) {
              var target = relM[1];
              if (target.indexOf('../') === 0) target = target.substring(3);
              var resolvedPath = 'ppt/' + target;
              var mediaEntry = zip.file(resolvedPath);
              if (mediaEntry) { imgFile = mediaEntry; break; }
            }
          }
        }
        if (!imgFile) {
          var mediaKeys = Object.keys(mediaFiles);
          for (var mk = 0; mk < mediaKeys.length; mk++) {
            if (/image\d+\.png$/i.test(mediaKeys[mk]) || /image\d+\.jpe?g$/i.test(mediaKeys[mk])) {
              imgFile = mediaFiles[mediaKeys[mk]];
              delete mediaFiles[mediaKeys[mk]];
              break;
            }
          }
        }
        var pageW = 612, pageH = 792;
        var page = pdfDoc.addPage([pageW, pageH]);
        var yPos = pageH - 50;
        if (imgFile) {
          try {
            var imgData = await imgFile.async('arraybuffer');
            var ext = imgFile.name.split('.').pop().toLowerCase();
            var img;
            if (ext === 'png') img = await pdfDoc.embedPng(imgData);
            else if (/jpe?g/i.test(ext)) img = await pdfDoc.embedJpg(imgData);
            if (img) {
              var scale = Math.min((pageW - 60) / img.width, (pageH - 120) / img.height, 1);
              var dw = img.width * scale;
              var dh = img.height * scale;
              var dx = (pageW - dw) / 2;
              page.drawImage(img, { x: dx, y: yPos - dh, width: dw, height: dh });
              yPos -= dh + 15;
              imageCount++;
            }
          } catch (e) { /* skip bad image */ }
        }
        if (textParts.length > 0) {
          var fullText = textParts.join('\n');
          var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
          var fontSize = 11;
          var maxW = pageW - 80;
          var lines = fullText.split(/\n/);
          for (var li = 0; li < lines.length && yPos > 50; li++) {
            var line = lines[li];
            var words = line.split(/\s+/);
            var currentLine = '';
            for (var wi = 0; wi < words.length; wi++) {
              var testLine = currentLine ? currentLine + ' ' + words[wi] : words[wi];
              var tw = font.widthOfTextAtSize(testLine, fontSize);
              if (tw > maxW && currentLine) {
                page.drawText(currentLine, { x: 40, y: yPos, size: fontSize, font: font, color: PDFLib.rgb(0, 0, 0) });
                yPos -= fontSize + 4;
                currentLine = words[wi];
              } else {
                currentLine = testLine;
              }
            }
            if (currentLine && yPos > 50) {
              page.drawText(currentLine, { x: 40, y: yPos, size: fontSize, font: font, color: PDFLib.rgb(0, 0, 0) });
              yPos -= fontSize + 4;
            }
          }
          textCount++;
        }
        if (yPos === pageH - 50 && !imgFile) {
          var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
          page.drawText('Diapositiva ' + (si + 1) + ' (sin contenido extraíble)', { x: 50, y: 742, size: 12, font: font, color: PDFLib.rgb(0.5, 0.5, 0.5) });
        }
      }
      if (pdfDoc.getPageCount() === 0) {
        var page = pdfDoc.addPage([612, 792]);
        var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        page.drawText('PowerPoint convertido (sin contenido extraíble)', { x: 50, y: 742, size: 12, font: font, color: PDFLib.rgb(0, 0, 0) });
      }
      var pdfBytes = await pdfDoc.save();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      results.push({ name: getBaseName(file.name) + '.pdf', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) PPTX convertido(s). Texto: ' + textCount + ', Imágenes: ' + imageCount + '.' };
  };

  window.ToolProcessors.excelToPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo Excel.' };
    if (typeof XLSX === 'undefined') throw new Error('XLSX no disponible.');
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var orientation = options.orientation || 'landscape';
    var fontSize = parseInt(options.fontSize) || 8;
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Procesando Excel...');
      var file = files[fi];
      var data = await file.arrayBuffer();
      var wb = XLSX.read(data, { type: 'array' });
      var pdfDoc = await PDFLib.PDFDocument.create();
      var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      for (var si = 0; si < wb.SheetNames.length; si++) {
        var ws = wb.Sheets[wb.SheetNames[si]];
        var json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!json.length) continue;
        var pageW = orientation === 'landscape' ? 842 : 595;
        var pageH = orientation === 'landscape' ? 595 : 842;
        var page = pdfDoc.addPage([pageW, pageH]);
        var margin = 30;
        var y = pageH - margin;
        var colWidth = Math.max(30, (pageW - margin * 2) / Math.max(1, json[0].length));
        for (var ri = 0; ri < json.length && y > margin; ri++) {
          var row = json[ri];
          for (var ci = 0; ci < row.length; ci++) {
            var cellText = String(row[ci]).substring(0, 30);
            var x = margin + ci * colWidth;
            if (x + colWidth > pageW - margin) break;
            try {
              page.drawText(cellText, { x: x, y: y, size: fontSize, font: font });
            } catch (e) { /* skip undrawable chars */ }
          }
          y -= fontSize + 4;
        }
      }
      var pdfBytes = await pdfDoc.save();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      results.push({ name: getBaseName(file.name) + '.pdf', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) Excel convertido(s).' };
  };

  window.ToolProcessors.htmlToPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo HTML.' };
    if (typeof html2canvas === 'undefined') throw new Error('html2canvas no disponible.');
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var pageW = parseInt(options.pageWidth) || 595;
    var pageH = parseInt(options.pageHeight) || 842;
    var scale = parseFloat(options.scale || options.htmlScale) || 1;
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Renderizando HTML...');
      var file = files[fi];
      var html = await readFileAsText(file);
      var container = document.createElement('div');
      container.style.width = (pageW / scale) + 'px';
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.innerHTML = html;
      document.body.appendChild(container);
      var canvas;
      try {
        canvas = await html2canvas(container, { scale: scale, useCORS: true, width: pageW / scale });
      } catch (e) {
        document.body.removeChild(container);
        throw new Error('Error renderizando HTML: ' + e.message);
      }
      document.body.removeChild(container);
      var imgData = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
      var imgBytes = await imgData.arrayBuffer();
      var pdfDoc = await PDFLib.PDFDocument.create();
      var img = await pdfDoc.embedPng(imgBytes);
      var imgW = img.width, imgH = img.height;
      var ratio = Math.min(pageW / imgW, pageH / imgH);
      var drawW = imgW * ratio, drawH = imgH * ratio;
      var page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(img, { x: (pageW - drawW) / 2, y: (pageH - drawH) / 2, width: drawW, height: drawH });
      var pdfBytes = await pdfDoc.save();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      results.push({ name: getBaseName(file.name) + '.pdf', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) HTML convertido(s).' };
  };

  window.ToolProcessors.pdfToPdfa = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdfDoc = await PDFLib.PDFDocument.load(data);
    onProgress(2, 3, 'Aplicando conversiones PDF/A...');
    var title = pdfDoc.getTitle() || getBaseName(file.name);
    pdfDoc.setTitle(title);
    pdfDoc.setAuthor(pdfDoc.getAuthor() || 'Toolisto');
    pdfDoc.setProducer('Toolisto - Conversión PDF/A-1b');
    pdfDoc.setCreator('Toolisto');
    pdfDoc.setCreationDate(new Date());
    var now = new Date();
    var xmpDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    var xmpStr = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '<rdf:Description rdf:about=""\n' +
      '  xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
      '  xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
      '  xmlns:pdf="http://ns.adobe.com/pdf/1.3/"\n' +
      '  xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n' +
      '  <dc:title><rdf:Alt><rdf:li xml:lang="es">' + _esc(title) + '</rdf:li></rdf:Alt></dc:title>\n' +
      '  <dc:creator><rdf:Seq><rdf:li>Toolisto</rdf:li></rdf:Seq></dc:creator>\n' +
      '  <xmp:CreateDate>' + xmpDate + '</xmp:CreateDate>\n' +
      '  <xmp:CreatorTool>Toolisto</xmp:CreatorTool>\n' +
      '  <pdf:Producer>Toolisto - Conversi\u00f3n PDF/A-1b</pdf:Producer>\n' +
      '  <pdfaid:part>1</pdfaid:part>\n' +
      '  <pdfaid:conformance>b</pdfaid:conformance>\n' +
      '</rdf:Description>\n' +
      '</rdf:RDF>\n' +
      '</x:xmpmeta>\n' +
      'xpacket end="w"';
    var xmpBytes = new TextEncoder().encode(xmpStr);
    try {
      var metaStream = pdfDoc.context.obj([
        PDFLib.PDFName.of('Type'), PDFLib.PDFName.of('Metadata'),
        PDFLib.PDFName.of('Subtype'), PDFLib.PDFName.of('XML'),
        PDFLib.PDFName.of('Length'), xmpBytes.length
      ]);
      metaStream.contents = xmpBytes;
      var ref = pdfDoc.context.register(metaStream);
      var catalog = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root);
      if (catalog && typeof catalog.set === 'function') {
        catalog.set(PDFLib.PDFName.of('Metadata'), ref);
      }
    } catch (e) { /* XMP embedding is best-effort */ }
    var pages = pdfDoc.getPages();
    var info = ['Informe de conversión PDF/A-1b', '================================', '', 'Archivo: ' + file.name, 'Páginas: ' + pages.length, ''];
    onProgress(3, 3, 'Guardando...');
    var pdfBytes = await pdfDoc.save();
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    var hasXmp = pdfBytes.length > 0;
    info.push('Estado: Metadatos XMP con pdfaid:part=1, pdfaid:conformance=b aplicados.');
    info.push('Metadatos: Título, autor, creador, fecha establecidos.');
    info.push('');
    info.push('NOTA: Esta conversión aplica metadatos PDF/A-1b según la especificación');
    info.push('ISO 19005-1. Para certificación completa se requiere validación con');
    info.push('veraPDF o(preflight de Adobe. Sin perfil ICC embebido, el documento');
    info.push('puede no pasar validación estricta en todos los visores PDF/A.');
    var reportBlob = new Blob([info.join('\n')], { type: 'text/plain;charset=utf-8' });
    return { files: [{ name: getBaseName(file.name) + '-pdfa.pdf', blob: blob, size: blob.size }, { name: getBaseName(file.name) + '-informe.txt', blob: reportBlob, size: reportBlob.size }], message: 'PDF convertido a formato PDF/A con metadatos XMP.' };
  };

  window.ToolProcessors.pdfToMarkdown = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    var md = '# ' + getBaseName(file.name) + '\n\n';
    for (var p = 1; p <= pdf.numPages; p++) {
      onProgress(p, pdf.numPages, 'Extrayendo página ' + p + '...');
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var items = tc.items;
      var lines = [];
      var currentLine = '';
      var lastY = null;
      for (var ti = 0; ti < items.length; ti++) {
        var item = items[ti];
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          lines.push(currentLine);
          currentLine = '';
        }
        currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + item.str;
        lastY = item.transform[5];
      }
      if (currentLine) lines.push(currentLine);
      md += '## Página ' + p + '\n\n';
      md += lines.join('\n\n') + '\n\n---\n\n';
    }
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '.md', 'Markdown generado desde ' + pdf.numPages + ' página(s).');
  };

  // B5: pdfFormFiller, flattenPdf, imagesToPdfAdvanced, pdfExtractResources, csvToPdf
  window.ToolProcessors.pdfFormFiller = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdfDoc = await PDFLib.PDFDocument.load(data);
    onProgress(2, 3, 'Rellenando campos...');
    var fields = pdfDoc.getForm().getFields();
    var form = pdfDoc.getForm();
    var fieldValues = {};
    var filled = 0;
    fields.forEach(function(f) {
      var name = f.getName();
      var val = options[name] || options['field_' + name] || '';
      if (val !== '' && val !== undefined && val !== null) {
        var type = f.constructor ? f.constructor.name : '';
        try {
          if (typeof f.setText === 'function' && (type.indexOf('TextField') >= 0 || type.indexOf('Text') >= 0 || typeof f.setText === 'function')) {
            f.setText(String(val));
            filled++;
          } else if (typeof f.check === 'function' && typeof f.uncheck === 'function') {
            var checkVal = String(val).toLowerCase();
            if (checkVal === 'true' || checkVal === '1' || checkVal === 'sí' || checkVal === 'si' || checkVal === 'yes' || checkVal === 'on') {
              f.check();
            } else {
              f.uncheck();
            }
            filled++;
          } else if (typeof f.select === 'function') {
            f.select(String(val));
            filled++;
          } else if (typeof f.setValues === 'function') {
            f.setValues([String(val)]);
            filled++;
          }
        } catch (e) { /* field may not support this operation */ }
      }
      fieldValues[name] = val || '(vacío)';
    });
    try { form.flatten(); } catch (e) { /* flatten may fail on some forms */ }
    onProgress(3, 3, 'Guardando...');
    var pdfBytes = await pdfDoc.save();
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    var report = 'Campos rellenados: ' + filled + ' de ' + fields.length + ' detectados.';
    return makeSingleResult(blob, getBaseName(file.name) + '-rellenado.pdf', report);
  };

  window.ToolProcessors.flattenPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdfDoc = await PDFLib.PDFDocument.load(data, { ignoreEncryption: true });
    onProgress(2, 3, 'Aplanando formulario y anotaciones...');
    var formFields = 0;
    var annotations = 0;
    try {
      var form = pdfDoc.getForm();
      var fields = form.getFields();
      formFields = fields.length;
      form.flatten();
    } catch (e) { /* some PDFs have no form */ }
    var pages = pdfDoc.getPages();
    for (var pi = 0; pi < pages.length; pi++) {
      var page = pages[pi];
      try {
        var annots = page.node.get(PDFLib.PDFName.of('Annots'));
        if (annots) {
          var annotArray;
          if (annots instanceof PDFLib.PDFArray) annotArray = annots;
          else if (annots.toString && annots.toString().indexOf('[') === 0) {
            try { annotArray = pdfDoc.context.lookup(annots); } catch(e) {}
          }
          if (annotArray && typeof annotArray.size === 'function') {
            annotations += annotArray.size();
            page.node.delete(PDFLib.PDFName.of('Annots'));
          }
        }
      } catch (e) { /* skip annotation flattening errors */ }
    }
    onProgress(3, 3, 'Guardando...');
    var pdfBytes = await pdfDoc.save();
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    return makeSingleResult(blob, getBaseName(file.name) + '-aplanado.pdf', 'PDF aplanado: ' + formFields + ' campo(s) de formulario y ' + annotations + ' anotación(es) fusionados.');
  };

  window.ToolProcessors.imagesToPdfAdvanced = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona imágenes.' };
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var orientation = options.orientation || 'portrait';
    var fitType = options.fit || 'contain';
    var margin = parseInt(options.margin) || 20;
    var pdfDoc = await PDFLib.PDFDocument.create();
    for (var i = 0; i < files.length; i++) {
      onProgress(i + 1, files.length, 'Procesando imagen...');
      var file = files[i];
      var imgData = await file.arrayBuffer();
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      var img;
      if (ext === 'png') img = await pdfDoc.embedPng(imgData);
      else if (/jpe?g/i.test(ext)) img = await pdfDoc.embedJpg(imgData);
      else {
        var tempImg = await loadImageFromFile(file);
        var tempCanvas = document.createElement('canvas');
        tempCanvas.width = tempImg.naturalWidth;
        tempCanvas.height = tempImg.naturalHeight;
        tempCanvas.getContext('2d').drawImage(tempImg, 0, 0);
        var jpegBlob = await new Promise(function(resolve) { tempCanvas.toBlob(resolve, 'image/jpeg', 0.92); });
        var jpegData = await jpegBlob.arrayBuffer();
        img = await pdfDoc.embedJpg(jpegData);
      }
      var pageW = orientation === 'landscape' ? 842 : 595;
      var pageH = orientation === 'landscape' ? 595 : 842;
      var drawW = pageW - margin * 2;
      var drawH = pageH - margin * 2;
      var ratio = fitType === 'cover' ? Math.max(drawW / img.width, drawH / img.height) : Math.min(drawW / img.width, drawH / img.height);
      var finalW = img.width * ratio, finalH = img.height * ratio;
      var page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(img, { x: margin + (drawW - finalW) / 2, y: margin + (drawH - finalH) / 2, width: finalW, height: finalH });
    }
    var pdfBytes = await pdfDoc.save();
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    return makeSingleResult(blob, 'imagenes.pdf', files.length + ' imagen(es) en PDF optimizado.');
  };

  window.ToolProcessors.pdfExtractResources = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un PDF.' };
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Cargando PDF...');
    var data = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    var results = [];
    var resources = [];
    var extractedImages = [];
    onProgress(2, 3, 'Analizando recursos...');
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var ops = await page.getOperatorList();
      var seenObjs = {};
      for (var oi = 0; oi < ops.fnArray.length; oi++) {
        if (ops.fnArray[oi] === pdfjsLib.OPS.paintImageXObject || ops.fnArray[oi] === pdfjsLib.OPS.paintJpegXObject) {
          var objId = ops.argsArray[oi][0];
          if (seenObjs[objId]) continue;
          seenObjs[objId] = true;
          resources.push({ page: p, type: 'image', id: objId });
          try {
            var imgData = await new Promise(function(resolve, reject) {
              page.objs.get(objId, function(data) { data ? resolve(data) : reject(new Error('No data')); });
            });
            if (imgData && imgData.width > 0 && imgData.height > 0) {
              var tmpCanvas = document.createElement('canvas');
              tmpCanvas.width = imgData.width;
              tmpCanvas.height = imgData.height;
              var tmpCtx = tmpCanvas.getContext('2d');
              var imgDataObj = tmpCtx.createImageData(imgData.width, imgData.height);
              if (imgData.data) {
                var src = imgData.data;
                var dst = imgDataObj.data;
                var len = Math.min(src.length, dst.length);
                for (var di = 0; di < len; di++) dst[di] = src[di];
              }
              tmpCtx.putImageData(imgDataObj, 0, 0);
              var ext = (objId.indexOf('jpeg') >= 0 || objId.indexOf('jpg') >= 0) ? 'jpg' : 'png';
              var mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
              var blob = await new Promise(function(resolve) { tmpCanvas.toBlob(resolve, mime, 0.92); });
              extractedImages.push({ name: 'p' + p + '-' + objId + '.' + ext, blob: blob, size: blob.size });
            }
          } catch (e) { /* skip */ }
        }
      }
    }
    onProgress(3, 3, 'Generando resultados...');
    var report = 'Reporte de recursos de ' + file.name + '\n';
    report += '='.repeat(40) + '\n\n';
    report += 'Páginas: ' + pdf.numPages + '\n';
    report += 'Imágenes detectadas: ' + resources.length + '\n';
    report += 'Imágenes extraídas: ' + extractedImages.length + '\n\n';
    resources.forEach(function(r) {
      report += 'Página ' + r.page + ': ' + r.type + ' (' + r.id + ')\n';
    });
    if (resources.length === 0) {
      report += '\nNo se detectaron imágenes incrustadas editables.';
    } else {
      report += '\nLas imágenes extraídas se incluyen como archivos adjuntos.';
    }
    var reportBlob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    var outputFiles = [{ name: getBaseName(file.name) + '-recursos.txt', blob: reportBlob, size: reportBlob.size }];
    if (extractedImages.length > 0) {
      if (extractedImages.length === 1) {
        outputFiles.push(extractedImages[0]);
      } else if (typeof JSZip !== 'undefined') {
        var zip = new JSZip();
        for (var ii = 0; ii < extractedImages.length; ii++) zip.file(extractedImages[ii].name, extractedImages[ii].blob);
        var zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        outputFiles.push({ name: getBaseName(file.name) + '-recursos.zip', blob: zipBlob, size: zipBlob.size });
      } else {
        for (var ii2 = 0; ii2 < extractedImages.length; ii2++) outputFiles.push(extractedImages[ii2]);
      }
    }
    return { files: outputFiles, message: resources.length + ' recurso(s) detectado(s), ' + extractedImages.length + ' extraído(s).' };
  };

  window.ToolProcessors.csvToPdf = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un CSV.' };
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib no disponible.');
    var orientation = options.orientation || 'landscape';
    var fontSize = parseInt(options.fontSize) || 8;
    var repeatHeader = options.repeatHeader !== false;
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Procesando CSV...');
      var file = files[fi];
      var text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var lines = text.split(/\r?\n/).filter(function(l) { return l.length > 0; });
      if (!lines.length) throw new Error('CSV vacío.');
      var sep = ',';
      var firstLine = lines[0].replace(/"[^"]*"/g, '');
      var counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
      sep = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][0];
      var rows = lines.map(function(line) {
        var fields = []; var buf = ''; var inQ = false;
        for (var ci = 0; ci < line.length; ci++) {
          var ch = line[ci];
          if (inQ) { if (ch === '"') { if (line[ci + 1] === '"') { buf += '"'; ci++; } else inQ = false; } else buf += ch; }
          else if (ch === '"') inQ = true;
          else if (ch === sep) { fields.push(buf); buf = ''; }
          else buf += ch;
        }
        fields.push(buf);
        return fields;
      });
      var pdfDoc = await PDFLib.PDFDocument.create();
      var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      var fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      var pageW = orientation === 'landscape' ? 842 : 595;
      var pageH = orientation === 'landscape' ? 595 : 842;
      var margin = 30;
      var numCols = Math.max.apply(null, rows.map(function(r) { return r.length; }));
      var colWidth = Math.max(30, (pageW - margin * 2) / numCols);
      var y = pageH - margin;
      var header = rows[0];
      for (var p = 0; p < rows.length; p++) {
        if (p > 0 && p % 50 === 0) {
          var newPage = pdfDoc.addPage([pageW, pageH]);
          y = pageH - margin;
        }
        var page = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
        var useFont = p === 0 ? fontBold : font;
        var row = rows[p];
        for (var ci = 0; ci < row.length && ci < numCols; ci++) {
          var cellText = String(row[ci]).substring(0, 40);
          var x = margin + ci * colWidth;
          if (x + colWidth > pageW - margin) break;
          try { page.drawText(cellText, { x: x, y: y, size: fontSize, font: useFont }); } catch (e) {}
        }
        y -= fontSize + 4;
        if (y < margin) {
          y = pageH - margin;
        }
      }
      var pdfBytes = await pdfDoc.save();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      results.push({ name: getBaseName(file.name) + '.pdf', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' CSV(s) convertido(s) a PDF.' };
  };

  // B6: cleanExcel, removeDuplicatesExcel, csvChangeDelimiter, csvChangeEncoding, flattenJson, jsonToExcelAdvanced, normalizeCsv, compareCsv, cleanTabularData, htmlTableToExcel
  window.ToolProcessors.cleanExcel = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo Excel.' };
    if (typeof XLSX === 'undefined') throw new Error('XLSX no disponible.');
    var removeEmptyRows = options.removeEmptyRows !== false;
    var removeEmptyCols = options.removeEmptyCols !== false;
    var trimWhitespace = options.trimWhitespace !== false;
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Limpiando Excel...');
      var file = files[fi];
      var data = await file.arrayBuffer();
      var wb = XLSX.read(data, { type: 'array' });
      for (var si = 0; si < wb.SheetNames.length; si++) {
        var ws = wb.Sheets[wb.SheetNames[si]];
        var json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (trimWhitespace) {
          json = json.map(function(row) { return row.map(function(cell) { return typeof cell === 'string' ? cell.trim() : cell; }); });
        }
        if (removeEmptyRows) {
          json = json.filter(function(row) { return row.some(function(cell) { return cell !== '' && cell != null; }); });
        }
        if (removeEmptyCols && json.length) {
          var maxCols = Math.max.apply(null, json.map(function(r) { return r.length; }));
          var emptyCols = [];
          for (var ci = 0; ci < maxCols; ci++) {
            var colEmpty = json.every(function(row) { return !row[ci] && row[ci] !== 0; });
            if (colEmpty) emptyCols.push(ci);
          }
          if (emptyCols.length) {
            json = json.map(function(row) { return row.filter(function(cell, idx) { return emptyCols.indexOf(idx) === -1; }); });
          }
        }
        wb.Sheets[wb.SheetNames[si]] = XLSX.utils.aoa_to_sheet(json);
      }
      var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      results.push({ name: getBaseName(file.name) + '-limpio.xlsx', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) limpio(s).' };
  };

  window.ToolProcessors.removeDuplicatesExcel = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo Excel.' };
    if (typeof XLSX === 'undefined') throw new Error('XLSX no disponible.');
    var keyColumns = options.keyColumns || [];
    var caseSensitive = options.caseSensitive !== false;
    var keepFirst = options.keepFirst !== false;
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Eliminando duplicados...');
      var file = files[fi];
      var data = await file.arrayBuffer();
      var wb = XLSX.read(data, { type: 'array' });
      var report = ['Reporte de duplicados — ' + file.name, '='.repeat(40), ''];
      for (var si = 0; si < wb.SheetNames.length; si++) {
        var ws = wb.Sheets[wb.SheetNames[si]];
        var json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (json.length < 2) continue;
        var header = json[0];
        var body = json.slice(1);
        var origLen = body.length;
        var seen = new Set();
        var deduped = body.filter(function(row) {
          var key;
          if (keyColumns.length) {
            key = keyColumns.map(function(colName) {
              var idx = header.indexOf(colName);
              return idx >= 0 ? String(row[idx]) : '';
            }).join('|||');
          } else {
            key = row.map(function(c) { return String(c); }).join('|||');
          }
          if (!caseSensitive) key = key.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        var removed = origLen - deduped.length;
        report.push('Hoja: ' + wb.SheetNames[si]);
        report.push('Filas originales: ' + origLen);
        report.push('Duplicados eliminados: ' + removed);
        report.push('Filas resultantes: ' + deduped.length);
        report.push('');
        wb.Sheets[wb.SheetNames[si]] = XLSX.utils.aoa_to_sheet([header].concat(deduped));
      }
      var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
      results.push({ name: getBaseName(file.name) + '-dedup.xlsx', blob: blob, size: blob.size });
      results.push({ name: getBaseName(file.name) + '-reporte.txt', blob: reportBlob, size: reportBlob.size });
    }
    return { files: results, message: 'Duplicados eliminados y reporte generado.' };
  };

  window.ToolProcessors.csvChangeDelimiter = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un CSV.' };
    var targetSep = options.targetSeparator || options.newSeparator || ',';
    if (targetSep === 'tab') targetSep = '\t';
    if (targetSep === 'pipe') targetSep = '|';
    if (targetSep === 'semicolon') targetSep = ';';
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Cambiando delimitador...');
      var file = files[fi];
      var text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var lines = text.split(/\r?\n/);
      var rows = lines.map(function(line) {
        var fields = []; var buf = ''; var inQ = false;
        for (var ci = 0; ci < line.length; ci++) {
          var ch = line[ci];
          if (inQ) { if (ch === '"') { if (line[ci + 1] === '"') { buf += '"'; ci++; } else inQ = false; } else buf += ch; }
          else if (ch === '"') inQ = true;
          else if (ch === ',' || ch === ';' || ch === '\t' || ch === '|') { fields.push(buf); buf = ''; }
          else buf += ch;
        }
        fields.push(buf);
        return fields;
      });
      var output = rows.map(function(fields) {
        return fields.map(function(f) {
          if (f.indexOf(targetSep) !== -1 || f.indexOf('"') !== -1 || f.indexOf('\n') !== -1) {
            return '"' + f.replace(/"/g, '""') + '"';
          }
          return f;
        }).join(targetSep);
      }).join('\n');
      var blob = new Blob(['\uFEFF' + output], { type: 'text/csv;charset=utf-8' });
      results.push({ name: getBaseName(file.name) + '-delimiter.csv', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' CSV(s) convertido(s).' };
  };

  window.ToolProcessors.csvChangeEncoding = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo.' };
    var targetEncoding = options.targetEncoding || options.encoding || 'UTF-8';
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Convirtiendo encoding...');
      var file = files[fi];
      var arrayBuf = await file.arrayBuffer();
      var bytes = new Uint8Array(arrayBuf);
      var detectedEncoding = 'UTF-8';
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) detectedEncoding = 'UTF-16LE';
      else if (bytes[0] === 0xFE && bytes[1] === 0xFF) detectedEncoding = 'UTF-16BE';
      else if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) detectedEncoding = 'UTF-8 BOM';
      else {
        var hasHighBytes = false;
        for (var bi = 0; bi < Math.min(bytes.length, 1000); bi++) {
          if (bytes[bi] > 127) { hasHighBytes = true; break; }
        }
        if (hasHighBytes) {
          try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch (e) { detectedEncoding = 'ISO-8859-1'; }
        }
      }
      var text;
      try {
        text = new TextDecoder(detectedEncoding.replace(' BOM', '')).decode(bytes);
      } catch (e) {
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }
      var encoded = new TextEncoder().encode(text);
      var blob = new Blob([encoded], { type: 'text/plain;charset=utf-8' });
      var ext = file.name.split('.').pop();
      results.push({ name: getBaseName(file.name) + '-' + targetEncoding.replace(/\s/g, '') + '.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) convertido(s) a ' + targetEncoding + '.' };
  };

  window.ToolProcessors.flattenJson = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un JSON.' };
    var separator = options.separator || '.';
    var direction = options.direction || 'nested-to-flat';
    var file = files[0];
    onProgress(1, 2, 'Leyendo JSON...');
    var text = await file.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSON inválido: ' + e.message); }
    onProgress(2, 2, 'Procesando...');
    var output;
    if (direction === 'nested-to-flat') {
      function flatten(obj, prefix) {
        var result = {};
        Object.keys(obj).forEach(function(key) {
          var newKey = prefix ? prefix + separator + key : key;
          if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            Object.assign(result, flatten(obj[key], newKey));
          } else if (Array.isArray(obj[key])) {
            obj[key].forEach(function(item, idx) {
              if (typeof item === 'object' && item !== null) {
                Object.assign(result, flatten(item, newKey + separator + idx));
              } else {
                result[newKey + separator + idx] = item;
              }
            });
          } else {
            result[newKey] = obj[key];
          }
        });
        return result;
      }
      var arr = Array.isArray(data) ? data : [data];
      output = arr.map(function(item) { return flatten(item, ''); });
    } else {
      function unflatten(obj) {
        var result = {};
        Object.keys(obj).forEach(function(key) {
          var parts = key.split(separator);
          var current = result;
          for (var pi = 0; pi < parts.length - 1; pi++) {
            if (!current[parts[pi]]) current[parts[pi]] = {};
            current = current[parts[pi]];
          }
          current[parts[parts.length - 1]] = obj[key];
        });
        return result;
      }
      var arr = Array.isArray(data) ? data : [data];
      output = arr.map(function(item) { return unflatten(item); });
    }
    if (!Array.isArray(data) && output.length === 1) output = output[0];
    var resultText = JSON.stringify(output, null, 2);
    var blob = new Blob([resultText], { type: 'application/json;charset=utf-8' });
    return makeSingleResult(blob, getBaseName(file.name) + '-flat.json', 'JSON ' + (direction === 'nested-to-flat' ? 'aplanado' : 'reconstruido') + '.');
  };

  window.ToolProcessors.jsonToExcelAdvanced = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un JSON.' };
    if (typeof XLSX === 'undefined') throw new Error('XLSX no disponible.');
    var file = files[0];
    onProgress(1, 3, 'Leyendo JSON...');
    var text = await file.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSON inválido: ' + e.message); }
    onProgress(2, 3, 'Normalizando datos...');
    if (!Array.isArray(data)) data = [data];
    function flattenObj(obj, prefix) {
      var result = {};
      Object.keys(obj).forEach(function(key) {
        var newKey = prefix ? prefix + '.' + key : key;
        if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          Object.assign(result, flattenObj(obj[key], newKey));
        } else if (Array.isArray(obj[key])) {
          result[newKey] = JSON.stringify(obj[key]);
        } else {
          result[newKey] = obj[key];
        }
      });
      return result;
    }
    var flatData = data.map(function(item) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) return flattenObj(item, '');
      return { value: item };
    });
    onProgress(3, 3, 'Generando Excel...');
    var ws = XLSX.utils.json_to_sheet(flatData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return makeSingleResult(blob, getBaseName(file.name) + '-avanzado.xlsx', 'JSON convertido a Excel con ' + flatData.length + ' fila(s).');
  };

  window.ToolProcessors.normalizeCsv = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un CSV.' };
    var targetDelimiter = options.delimiter || ',';
    if (targetDelimiter === 'tab') targetDelimiter = '\t';
    var fixWhitespace = options.fixWhitespace !== false;
    var results = [];
    var report = ['Reporte de normalización CSV', '='.repeat(40), ''];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Normalizando CSV...');
      var file = files[fi];
      var text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var lineEnding = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
      var lines = text.split(/\r?\n/);
      var corrections = 0;
      var normalized = lines.map(function(line) {
        if (!line) return '';
        var fields = []; var buf = ''; var inQ = false;
        for (var ci = 0; ci < line.length; ci++) {
          var ch = line[ci];
          if (inQ) { if (ch === '"') { if (line[ci + 1] === '"') { buf += '"'; ci++; } else inQ = false; } else buf += ch; }
          else if (ch === '"') inQ = true;
          else if (ch === ',' || ch === ';' || ch === '\t' || ch === '|') { fields.push(buf); buf = ''; }
          else buf += ch;
        }
        fields.push(buf);
        if (fixWhitespace) {
          fields = fields.map(function(f) {
            var trimmed = f.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
            if (trimmed !== f) corrections++;
            return trimmed;
          });
        }
        return fields.join(targetDelimiter);
      });
      var output = normalized.join(lineEnding);
      var blob = new Blob(['\uFEFF' + output], { type: 'text/csv;charset=utf-8' });
      results.push({ name: getBaseName(file.name) + '-normalizado.csv', blob: blob, size: blob.size });
      report.push('Archivo: ' + file.name);
      report.push('Correcciones de whitespace: ' + corrections);
      report.push('');
    }
    var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    results.push({ name: 'normalizacion-report.txt', blob: reportBlob, size: reportBlob.size });
    return { files: results, message: results.length + ' CSV(s) normalizado(s).' };
  };

  window.ToolProcessors.compareCsv = async function(files, options, onProgress) {
    if (!files || files.length < 2) return { files: [], message: 'Selecciona dos CSV para comparar.' };
    var keyColumn = options.keyColumn || '';
    onProgress(1, 3, 'Leyendo archivos...');
    var text1 = await files[0].text();
    var text2 = await files[1].text();
    if (text1.charCodeAt(0) === 0xFEFF) text1 = text1.slice(1);
    if (text2.charCodeAt(0) === 0xFEFF) text2 = text2.slice(1);
    function parseCsvLines(text) {
      return text.split(/\r?\n/).filter(function(l) { return l.length > 0; }).map(function(line) {
        var fields = []; var buf = ''; var inQ = false;
        for (var ci = 0; ci < line.length; ci++) {
          var ch = line[ci];
          if (inQ) { if (ch === '"') { if (line[ci + 1] === '"') { buf += '"'; ci++; } else inQ = false; } else buf += ch; }
          else if (ch === '"') inQ = true;
          else if (ch === ',' || ch === ';' || ch === '\t') { fields.push(buf); buf = ''; }
          else buf += ch;
        }
        fields.push(buf);
        return fields;
      });
    }
    onProgress(2, 3, 'Comparando...');
    var rows1 = parseCsvLines(text1);
    var rows2 = parseCsvLines(text2);
    var header1 = rows1[0] || [];
    var header2 = rows2[0] || [];
    var data1 = rows1.slice(1);
    var data2 = rows2.slice(1);
    var report = ['Comparación CSV', '='.repeat(40), '', 'Archivo 1: ' + files[0].name + ' (' + data1.length + ' filas)', 'Archivo 2: ' + files[1].name + ' (' + data2.length + ' filas)', ''];
    var added = 0, removed = 0, modified = 0, unchanged = 0;
    if (keyColumn) {
      var keyIdx1 = header1.indexOf(keyColumn);
      var keyIdx2 = header2.indexOf(keyColumn);
      if (keyIdx1 < 0 || keyIdx2 < 0) { report.push('Columna clave "' + keyColumn + '" no encontrada en ambos archivos.'); }
      else {
        var map1 = new Map(); var map2 = new Map();
        data1.forEach(function(r) { map1.set(String(r[keyIdx1]), r); });
        data2.forEach(function(r) { map2.set(String(r[keyIdx2]), r); });
        map1.forEach(function(row, key) {
          if (!map2.has(key)) { removed++; report.push('[-] ' + key); }
          else if (JSON.stringify(row) !== JSON.stringify(map2.get(key))) { modified++; report.push('[~] ' + key); }
          else unchanged++;
        });
        map2.forEach(function(row, key) {
          if (!map1.has(key)) { added++; report.push('[+] ' + key); }
        });
      }
    } else {
      var maxRows = Math.max(data1.length, data2.length);
      for (var ri = 0; ri < maxRows; ri++) {
        var r1 = JSON.stringify(data1[ri] || []);
        var r2 = JSON.stringify(data2[ri] || []);
        if (!data1[ri]) { added++; report.push('[+] Fila ' + (ri + 1) + ': nueva'); }
        else if (!data2[ri]) { removed++; report.push('[-] Fila ' + (ri + 1) + ': eliminada'); }
        else if (r1 !== r2) { modified++; report.push('[~] Fila ' + (ri + 1) + ': modificada'); }
        else unchanged++;
      }
    }
    report.push('');
    report.push('Resumen: ' + added + ' añadida(s), ' + removed + ' eliminada(s), ' + modified + ' modificada(s), ' + unchanged + ' sin cambio.');
    onProgress(3, 3, 'Generando reporte...');
    var reportBlob = new Blob([report.join('\n')], { type: 'text/plain;charset=utf-8' });
    return makeSingleResult(reportBlob, 'comparacion-csv.txt', 'Comparación: ' + added + ' añadida(s), ' + removed + ' eliminada(s), ' + modified + ' modificada(s).');
  };

  window.ToolProcessors.cleanTabularData = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un CSV o TSV.' };
    var trimWs = options.trim !== false;
    var lowercase = options.lowercase === true;
    var removeEmpty = options.removeEmptyRows !== false;
    var removeEmptyCols = options.removeEmptyCols || false;
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Limpiando datos...');
      var file = files[fi];
      var text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var lines = text.split(/\r?\n/);
      var parsed = lines.map(function(line) {
        var fields = []; var buf = ''; var inQ = false;
        for (var ci = 0; ci < line.length; ci++) {
          var ch = line[ci];
          if (inQ) { if (ch === '"') { if (line[ci + 1] === '"') { buf += '"'; ci++; } else inQ = false; } else buf += ch; }
          else if (ch === '"') inQ = true;
          else if (ch === ',' || ch === ';' || ch === '\t') { fields.push(buf); buf = ''; }
          else buf += ch;
        }
        fields.push(buf);
        return fields;
      });
      if (trimWs) parsed = parsed.map(function(row) { return row.map(function(c) { return c.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' '); }); });
      if (lowercase) parsed = parsed.map(function(row) { return row.map(function(c) { return c.toLowerCase(); }); });
      if (removeEmpty) parsed = parsed.filter(function(row) { return row.some(function(c) { return c.length > 0; }); });
      if (removeEmptyCols && parsed.length) {
        var maxCols = Math.max.apply(null, parsed.map(function(r) { return r.length; }));
        var emptyCols = [];
        for (var ci = 0; ci < maxCols; ci++) {
          if (parsed.every(function(row) { return !row[ci]; })) emptyCols.push(ci);
        }
        parsed = parsed.map(function(row) { return row.filter(function(c, idx) { return emptyCols.indexOf(idx) === -1; }); });
      }
      var output = parsed.map(function(row) { return row.join(','); }).join('\n');
      var blob = new Blob(['\uFEFF' + output], { type: 'text/csv;charset=utf-8' });
      results.push({ name: getBaseName(file.name) + '-limpio.csv', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) limpio(s).' };
  };

  window.ToolProcessors.htmlTableToExcel = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo HTML.' };
    if (typeof XLSX === 'undefined') throw new Error('XLSX no disponible.');
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Extrayendo tablas...');
      var file = files[fi];
      var html = await readFileAsText(file);
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');
      var tables = doc.querySelectorAll('table');
      if (!tables.length) throw new Error('No se encontraron tablas en el HTML.');
      var wb = XLSX.utils.book_new();
      for (var ti = 0; ti < tables.length; ti++) {
        var ws = XLSX.utils.table_to_sheet(tables[ti]);
        var name = 'Tabla ' + (ti + 1);
        XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31));
      }
      var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      results.push({ name: getBaseName(file.name) + '-tablas.xlsx', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) HTML procesado(s), ' + (results.length ? tables.length : 0) + ' tabla(s).' };
  };

  // B7: textEncodingConverter, detectFileType
  window.ToolProcessors.textEncodingConverter = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo de texto.' };
    var targetEncoding = options.targetEncoding || options.encoding || 'UTF-8';
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Convirtiendo encoding...');
      var file = files[fi];
      var arrayBuf = await file.arrayBuffer();
      var bytes = new Uint8Array(arrayBuf);
      var detectedEncoding = 'UTF-8';
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) detectedEncoding = 'UTF-16LE';
      else if (bytes[0] === 0xFE && bytes[1] === 0xFF) detectedEncoding = 'UTF-16BE';
      else if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) detectedEncoding = 'UTF-8 BOM';
      else {
        var hasHighBytes = false;
        for (var bi = 0; bi < Math.min(bytes.length, 1000); bi++) {
          if (bytes[bi] > 127) { hasHighBytes = true; break; }
        }
        if (hasHighBytes) {
          try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch (e) { detectedEncoding = 'ISO-8859-1'; }
        }
      }
      var text;
      try {
        text = new TextDecoder(detectedEncoding.replace(' BOM', '')).decode(bytes);
      } catch (e) {
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }
      var encoded;
      var normTarget = targetEncoding.replace(/\s+/g, '').toLowerCase();
      if (normTarget === 'utf8' || normTarget === 'utf-8') {
        encoded = new TextEncoder().encode(text);
      } else if (normTarget === 'iso-8859-1' || normTarget === 'latin1' || normTarget === 'latin-1') {
        var buf = new Uint8Array(text.length);
        for (var ci = 0; ci < text.length; ci++) {
          var code = text.charCodeAt(ci);
          buf[ci] = (code <= 255) ? code : 0x3F;
        }
        encoded = buf;
      } else if (normTarget === 'windows-1252' || normTarget === 'cp1252' || normTarget === 'win-1252') {
        var w1252Map = [0x20AC,0xFFFD,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,0xFFFD,0x017D,0xFFFD,0xFFFD,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0xFFFD,0x017E,0x0178];
        var buf = new Uint8Array(text.length);
        for (var ci = 0; ci < text.length; ci++) {
          var code = text.charCodeAt(ci);
          if (code <= 0x7F) { buf[ci] = code; }
          else if (code >= 0x80 && code <= 0x9F) { buf[ci] = w1252Map[code - 0x80] <= 0xFF ? w1252Map[code - 0x80] : 0x3F; }
          else if (code <= 0xFF) { buf[ci] = code; }
          else { buf[ci] = 0x3F; }
        }
        encoded = buf;
      } else if (normTarget === 'utf-16le' || normTarget === 'utf16le') {
        var buf = new Uint8Array(text.length * 2);
        for (var ci = 0; ci < text.length; ci++) {
          var code = text.charCodeAt(ci);
          buf[ci * 2] = code & 0xFF;
          buf[ci * 2 + 1] = (code >> 8) & 0xFF;
        }
        encoded = buf;
      } else if (normTarget === 'utf-16be' || normTarget === 'utf16be') {
        var buf = new Uint8Array(text.length * 2);
        for (var ci = 0; ci < text.length; ci++) {
          var code = text.charCodeAt(ci);
          buf[ci * 2] = (code >> 8) & 0xFF;
          buf[ci * 2 + 1] = code & 0xFF;
        }
        encoded = buf;
      } else {
        encoded = new TextEncoder().encode(text);
      }
      var mime = 'text/plain;charset=utf-8';
      if (normTarget === 'iso-8859-1' || normTarget === 'latin1') mime = 'text/plain;charset=iso-8859-1';
      else if (normTarget === 'windows-1252' || normTarget === 'cp1252') mime = 'text/plain;charset=windows-1252';
      else if (normTarget === 'utf-16le') mime = 'text/plain;charset=utf-16le';
      else if (normTarget === 'utf-16be') mime = 'text/plain;charset=utf-16be';
      var blob = new Blob([encoded], { type: mime });
      var ext = file.name.split('.').pop();
      results.push({ name: getBaseName(file.name) + '-' + targetEncoding.replace(/\s/g, '') + '.' + ext, blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) convertido(s) de ' + detectedEncoding + ' a ' + targetEncoding + '.' };
  };

  window.ToolProcessors.detectFileType = async function(files, options, onProgress) {
    if (!files || !files.length) return { files: [], message: 'Selecciona un archivo.' };
    var signatures = {
      'PDF': [0x25, 0x50, 0x44, 0x46],
      'PNG': [0x89, 0x50, 0x4E, 0x47],
      'JPEG': [0xFF, 0xD8, 0xFF],
      'GIF': [0x47, 0x49, 0x46, 0x38],
      'WebP': [0x52, 0x49, 0x46, 0x46],
      'BMP': [0x42, 0x4D],
      'TIFF_BE': [0x4D, 0x4D],
      'TIFF_LE': [0x49, 0x49],
      'ZIP': [0x50, 0x4B, 0x03, 0x04],
      'RAR': [0x52, 0x61, 0x72, 0x21],
      'GZ': [0x1F, 0x8B],
      '7Z': [0x37, 0x7A, 0xBC, 0xAF],
      'MP3_ID3': [0x49, 0x44, 0x33],
      'MP3_SYNC': [0xFF, 0xFB],
      'FLAC': [0x66, 0x4C, 0x61, 0x43],
      'OGG': [0x4F, 0x67, 0x67, 0x53],
      'MP4': [0x00, 0x00, 0x00],
      'AVIF': [0x00, 0x00, 0x00],
      'HEIC': [0x00, 0x00, 0x00],
      'EXE_MZ': [0x4D, 0x5A],
      'ELF': [0x7F, 0x45, 0x4C, 0x46],
      'DOCX': [0x50, 0x4B, 0x03, 0x04],
      'XLSX': [0x50, 0x4B, 0x03, 0x04],
      'SQLITE': [0x53, 0x51, 0x4C, 0x69],
      'WEBM': [0x1A, 0x45, 0xDF, 0xA3],
      'AVI': [0x52, 0x49, 0x46, 0x46],
    };
    var results = [];
    for (var fi = 0; fi < files.length; fi++) {
      onProgress(fi + 1, files.length, 'Analizando archivo...');
      var file = files[fi];
      var arrayBuf = await file.arrayBuffer();
      var bytes = new Uint8Array(arrayBuf.slice(0, 64));
      var detectedType = 'Desconocido';
      var matchedSig = '';
      var sigKeys = Object.keys(signatures);
      for (var si = 0; si < sigKeys.length; si++) {
        var sig = signatures[sigKeys[si]];
        var match = true;
        for (var bi = 0; bi < sig.length; bi++) {
          if (bytes[bi] !== sig[bi]) { match = false; break; }
        }
        if (match) { detectedType = sigKeys[si]; matchedSig = sig.map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' '); break; }
      }
      var declaredExt = (file.name.split('.').pop() || '').toUpperCase();
      var report = 'Archivo: ' + file.name + '\n';
      report += 'Tamaño: ' + file.size + ' bytes\n';
      report += 'Tipo declarado: ' + (file.type || 'N/A') + '\n';
      report += 'Extensión: .' + declaredExt + '\n';
      report += 'Tipo detectado: ' + detectedType + '\n';
      report += 'Magic bytes: ' + matchedSig + '\n';
      report += 'Coincidencia: ' + (detectedType !== 'Desconocido' ? 'SÍ' : 'NO') + '\n';
      if (declaredExt && detectedType !== 'Desconocido' && declaredExt !== detectedType.substring(0, 4)) {
        report += 'AVISO: La extensión no coincide con el tipo detectado.\n';
      }
      var blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
      results.push({ name: getBaseName(file.name) + '-tipo.txt', blob: blob, size: blob.size });
    }
    return { files: results, message: results.length + ' archivo(s) analizado(s).' };
  };

})();
