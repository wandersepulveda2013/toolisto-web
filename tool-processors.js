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

  function createZipBlob(fileEntries) {
    var zip = new JSZip();
    for (var i = 0; i < fileEntries.length; i++) {
      var entry = fileEntries[i];
      if (entry.compressed === false) {
        zip.file(entry.name, entry.data, { compression: 'STORE' });
      } else {
        zip.file(entry.name, entry.data);
      }
    }
    return zip.generateAsync({ type: 'blob' });
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
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + (title || 'Document') + '</title>\n<style>body{font-family:Calibri,Arial,sans-serif;margin:40px;line-height:1.5;color:#333}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function makeResult(blobList, message) {
    return {
      files: blobList.map(function(b) {
        return { name: b.name, blob: b.blob, size: b.blob.size };
      }),
      message: message || ''
    };
  }

  function makeSingleResult(blob, name, message) {
    return makeResult([{ name: name, blob: blob }], message);
  }

  function extensionForMime(mime) {
    var map = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'text/plain': '.txt', 'text/html': '.html', 'text/markdown': '.md', 'application/epub+zip': '.epub',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.oasis.opendocument.text': '.odt' };
    return map[mime] || '';
  }

  function safeFileName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_');
  }

  function getBaseName(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  function streamToString(uint8) {
    var decoder = new TextDecoder('utf-8');
    return decoder.decode(uint8);
  }

  function wrapPdfText(doc, text, options) {
    var font = options.font || 'Helvetica';
    var fontSize = options.fontSize || 12;
    var pageW = options.pageWidth || 595;
    var pageH = options.pageHeight || 842;
    var margin = options.margin || 50;
    var lineH = fontSize * 1.5;
    var maxW = pageW - 2 * margin;
    var usableH = pageH - 2 * margin;

    var fontObj;
    try {
      fontObj = doc.embedFont(StandardFonts[font] || StandardFonts.Helvetica);
    } catch(e) {
      fontObj = doc.embedFont(StandardFonts.Helvetica);
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
        wrapPdfText(doc, text, { fontSize: options.fontSize || 12, margin: options.margin || 50, font: options.font || 'Helvetica' });

        var pdfBytes = await doc.save();
        var blob = new Blob([pdfBytes], { type: 'application/pdf' });
        results.push({ name: getBaseName(files[i].name) + '.pdf', blob: blob });
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.pdf', blob: new Blob(['Error: ' + e.message], { type: 'application/pdf' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.jpg', blob: new Blob(['Error'], { type: 'image/jpeg' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.png', blob: new Blob(['Error'], { type: 'image/png' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.txt', blob: new Blob(['Error: ' + e.message], { type: 'text/plain' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.html', blob: new Blob(['Error: ' + e.message], { type: 'text/html' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.md', blob: new Blob(['Error: ' + e.message], { type: 'text/plain' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.epub', blob: new Blob(['Error'], { type: 'application/epub+zip' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.odt', blob: new Blob(['Error'], { type: 'application/vnd.oasis.opendocument.text' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.docx', blob: new Blob(['Error: ' + e.message], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.docx', blob: new Blob(['Error: ' + e.message], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) });
      }
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
                return '"' + c.replace(/"/g, '""') + '"';
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
              cells.push('"' + cM[1].replace(/<[^>]+>/g, '').trim().replace(/"/g, '""') + '"');
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
        try { font = doc.embedFont(StandardFonts[fontKey] || StandardFonts.Helvetica); }
        catch(e) { font = doc.embedFont(StandardFonts.Helvetica); fontKey = 'Helvetica'; }

        var pageOpts = { fontSize: fontSize, margin: margin, pageWidth: pageWidth, pageHeight: pageHeight, font: fontKey };
        wrapPdfText(doc, text, pageOpts);

        var pdfBytes = await doc.save();
        var blob = new Blob([pdfBytes], { type: 'application/pdf' });
        results.push({ name: getBaseName(files[i].name) + '.pdf', blob: blob });
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.pdf', blob: new Blob(['Error: ' + e.message], { type: 'application/pdf' }) });
      }
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
      } catch(e) {
        results.push({ name: getBaseName(files[i].name) + '.epub', blob: new Blob(['Error'], { type: 'application/epub+zip' }) });
      }
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
          return r.map(function(c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(',');
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
          if (rows.length > 0) {
            md += '| ' + rows[0].join(' | ') + ' |\n';
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
            mdParts.push(htmlToMarkdown(html));
          }
        }
      }

      var fullMd = mdParts.join('\n\n');
      var blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
      return makeSingleResult(blob, getBaseName(files[0].name) + '.md', 'Converted EPUB to Markdown.');
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
          }
          var newManifestItems = [];
          for (var i = 0; i < manifestItems.length; i++) {
            var isBroken = false;
            for (var br = 0; br < brokenRefs.length; br++) {
              if (manifestItems[i].getAttribute('id') === brokenRefs[br].id) {
                isBroken = true;
                break;
              }
            }
            if (!isBroken) newManifestItems.push(manifestItems[i]);
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
    var separator = options.separator || 'auto';
    var encoding = options.encoding || 'UTF-8';

    var sep = separator;
    if (sep === 'auto') {
      var firstLine = text.split('\n')[0];
      var counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
      sep = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][1] > 0 ? Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][0] : ',';
    }

    var wb = XLSX.read(text, { type: 'string', raw: true, FS: sep });
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
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
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
    var data = JSON.parse(text);
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
    var separator = options.separator || 'auto';
    var sep = separator;
    if (sep === 'auto') {
      var firstLine = text.split('\n')[0];
      var counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
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
    var data = JSON.parse(text);
    if (!Array.isArray(data)) data = [data];
    var separator = options.separator || ',';
    var ws = XLSX.utils.json_to_sheet(data);
    var csv = XLSX.utils.sheet_to_csv(ws, { FS: separator });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
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
          var colLetter = String.fromCharCode(65 + c % 26);
          diffRows.push([r + 1, colLetter, v1 || '(vacío)', v2 || '(vacío)', v1 === '' ? 'Añadido' : v2 === '' ? 'Eliminado' : 'Modificado']);
          diffCount++;
        }
      }
    }

    if (diffCount === 0) {
      return { files: [], message: 'Los archivos son idénticos' };
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
    var wb = XLSX.read(data, { type: 'array' });
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var name = file.name.replace(/\.xls$/i, '.xlsx');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'XLS convertido a XLSX' };
  };

  window.ToolProcessors.xlsxToOds = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Convirtiendo XLSX a ODS...');
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var wbOut = XLSX.write(wb, { bookType: 'ods', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.oasis.opendocument.spreadsheet' });
    var name = file.name.replace(/\.[^.]+$/, '.ods');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'XLSX convertido a ODS' };
  };

  window.ToolProcessors.odsToXlsx = async function(files, options, onProgress) {
    var file = files[0];
    onProgress(1, 1, 'Convirtiendo ODS a XLSX...');
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var name = file.name.replace(/\.[^.]+$/, '.xlsx');
    return { files: [{ name: name, blob: blob, size: blob.size }], message: 'ODS convertido a XLSX' };
  };

})();