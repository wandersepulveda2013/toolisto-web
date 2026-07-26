(function (root) {
  'use strict';

  function getPDFLib() {
    if (typeof window !== 'undefined' && window.PDFLib) return window.PDFLib;
    if (typeof require !== 'undefined') return require('pdf-lib');
    throw new Error('PDFLib no disponible');
  }

  async function getInputBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return new Uint8Array(input);
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return new Uint8Array(await input.arrayBuffer());
    }
    if (input && typeof input.arrayBuffer === 'function') {
      return new Uint8Array(await input.arrayBuffer());
    }
    throw new Error('Entrada no válida: se esperaba File, Blob, ArrayBuffer o Uint8Array');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** i);
    return (value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
  }

  const processors = {};

  // ─── Batch 1 ────────────────────────────────────────────────────────

  processors.mergePdf = async function (inputs) {
    const { PDFDocument } = getPDFLib();
    const merged = await PDFDocument.create();
    let pageCount = 0;
    const items = Array.isArray(inputs) ? inputs : [inputs];
    for (const input of items) {
      const bytes = await getInputBytes(input);
      const src = await PDFDocument.load(bytes);
      const copied = await merged.copyPages(src, src.getPageIndices());
      copied.forEach((p) => merged.addPage(p));
      pageCount += copied.length;
    }
    const out = await merged.save();
    return {
      data: out,
      name: 'toolisto-pdf-unido.pdf',
      title: 'PDF combinado',
      message: 'Los documentos se unieron respetando el orden visible.',
      stats: [['Documentos', String(items.length)], ['Páginas', String(pageCount)], ['Tamaño', formatBytes(out.length)]],
      pageCount,
    };
  };

  processors.imagesPdf = async function (inputs) {
    const { PDFDocument } = getPDFLib();
    const pdf = await PDFDocument.create();
    const items = Array.isArray(inputs) ? inputs : [inputs];
    let pageCount = 0;
    for (const input of items) {
      const bytes = await getInputBytes(input);
      let embedded;
      try { embedded = await pdf.embedPng(bytes); } catch (_) {
        try { embedded = await pdf.embedJpg(bytes); } catch (_) {
          const img = await pdf.embedPng(bytes);
          embedded = img;
        }
      }
      const page = pdf.addPage([595.28, 841.89]);
      const scale = Math.min(547.28 / embedded.width, 793.89 / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      page.drawImage(embedded, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
      pageCount++;
    }
    const out = await pdf.save();
    return {
      data: out,
      name: 'toolisto-imagenes.pdf',
      title: 'PDF creado',
      message: `Se generó un documento con ${pageCount} página${pageCount === 1 ? '' : 's'}.`,
      stats: [['Archivos', String(items.length)], ['Páginas', String(pageCount)], ['Tamaño', formatBytes(out.length)]],
      pageCount,
    };
  };

  // ─── Batch 2 ────────────────────────────────────────────────────────

  processors.rotatePdf = async function (input, options) {
    const { PDFDocument, degrees: pdfDegrees } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const rotationDegrees = (options && options.degrees) || 90;
    if (typeof rotationDegrees !== 'number' || ![90, 180, 270].includes(rotationDegrees % 360)) {
      throw new Error('Rotación no válida: se aceptan 90, 180 o 270 grados.');
    }
    const dst = await PDFDocument.create();
    const copied = await dst.copyPages(src, src.getPageIndices());
    copied.forEach((p) => { p.setRotation(pdfDegrees(rotationDegrees)); dst.addPage(p); });
    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-rotado.pdf',
      title: 'PDF rotado',
      message: `Se rotaron ${copied.length} páginas ${rotationDegrees} grados.`,
      stats: [['Páginas', String(copied.length)], ['Rotación', rotationDegrees + '°'], ['Tamaño', formatBytes(out.length)]],
      pageCount: copied.length,
    };
  };

  processors.splitPdf = async function (input) {
    const { PDFDocument } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const results = [];
    for (let i = 0; i < src.getPageCount(); i++) {
      const dst = await PDFDocument.create();
      const [page] = await dst.copyPages(src, [i]);
      dst.addPage(page);
      const out = await dst.save();
      results.push({
        data: out,
        name: `toolisto-pagina-${i + 1}.pdf`,
        title: `Página ${i + 1} extraída`,
        message: `Página ${i + 1} de ${src.getPageCount()}.`,
        stats: [['Página', String(i + 1)], ['Tamaño', formatBytes(out.length)]],
        pageCount: 1,
      });
    }
    return results.length === 1 ? results[0] : {
      data: results[0].data,
      name: results[0].name,
      title: `${results.length} páginas separadas`,
      message: `Se separaron ${results.length} páginas individuales.`,
      stats: [['Páginas', String(results.length)], ['Tamaño', formatBytes(results.reduce((s, r) => s + r.data.length, 0))]],
      pageCount: results.length,
      parts: results,
    };
  };

  processors.extractPdf = async function (input, options) {
    const { PDFDocument } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const range = (options && options.pages) || '1-' + src.getPageCount();
    const indices = [];
    const parts = range.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map((n) => parseInt(n, 10) - 1);
        for (let i = a; i <= Math.min(b, src.getPageCount() - 1); i++) indices.push(i);
      } else {
        const idx = parseInt(part, 10) - 1;
        if (idx >= 0 && idx < src.getPageCount()) indices.push(idx);
      }
    }
    const dst = await PDFDocument.create();
    const copied = await dst.copyPages(src, indices);
    copied.forEach((p) => dst.addPage(p));
    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-extraido.pdf',
      title: 'Páginas extraídas',
      message: `Se extrajeron ${copied.length} páginas del documento.`,
      stats: [['Extraídas', String(copied.length)], ['Original', String(src.getPageCount())], ['Tamaño', formatBytes(out.length)]],
      pageCount: copied.length,
    };
  };

  processors.resizeImage = async function (input, options) {
    throw new Error('Resize de imagen requiere Canvas (solo navegador).');
  };

  processors.watermarkImage = async function (input, options) {
    throw new Error('Marca de agua en imagen requiere Canvas (solo navegador).');
  };

  processors.enhanceImage = async function (input, options) {
    throw new Error('Mejora de imagen requiere Canvas (solo navegador).');
  };

  processors.removeBackground = async function (input, options) {
    throw new Error('Eliminación de fondo requiere Canvas (solo navegador).');
  };

  processors.batchConvert = async function (input, options) {
    throw new Error('Conversión por lotes requiere Canvas (solo navegador).');
  };

  processors.pdfToImages = async function (input) {
    throw new Error('Conversión de PDF a imágenes requiere Canvas (solo navegador).');
  };

  // ─── Batch 3 ────────────────────────────────────────────────────────

  processors.splitDoublePdf = async function (input, options) {
    const { PDFDocument } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const direction = (options && options.direction) || 'vertical';
    const dst = await PDFDocument.create();
    let outputCount = 0;

    for (let i = 0; i < src.getPageCount(); i++) {
      const origPage = src.getPage(i);
      const { width: origW, height: origH } = origPage.getSize();

      const [copy1] = await dst.copyPages(src, [i]);
      const [copy2] = await dst.copyPages(src, [i]);

      if (direction === 'vertical') {
        copy1.node.MediaBox = [0, origH / 2, origW, origH];
        copy1.node.CropBox = [0, origH / 2, origW, origH];
        copy2.node.MediaBox = [0, 0, origW, origH / 2];
        copy2.node.CropBox = [0, 0, origW, origH / 2];
      } else {
        copy1.node.MediaBox = [0, 0, origW / 2, origH];
        copy1.node.CropBox = [0, 0, origW / 2, origH];
        copy2.node.MediaBox = [origW / 2, 0, origW, origH];
        copy2.node.CropBox = [origW / 2, 0, origW, origH];
      }

      dst.addPage(copy1);
      dst.addPage(copy2);
      outputCount += 2;
    }

    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-dividido.pdf',
      title: 'Páginas divididas',
      message: `${src.getPageCount()} páginas dobles → ${outputCount} páginas individuales.`,
      stats: [['Original', String(src.getPageCount())], ['Resultado', String(outputCount)], ['Dirección', direction === 'vertical' ? 'Vertical' : 'Horizontal'], ['Tamaño', formatBytes(out.length)]],
      pageCount: outputCount,
    };
  };

  processors.bookletPdf = async function (input) {
    const { PDFDocument } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const total = src.getPageCount();
    const sheetsNeeded = Math.ceil(total / 4);
    const paddedTotal = sheetsNeeded * 4;
    const blankCount = paddedTotal - total;

    const order = [];
    for (let sheet = 0; sheet < sheetsNeeded; sheet++) {
      const frontRight = sheet * 2;
      const frontLeft = paddedTotal - 1 - sheet * 2;
      const backLeft = sheet * 2 + 1;
      const backRight = paddedTotal - 2 - sheet * 2;
      order.push(frontRight, frontLeft, backLeft, backRight);
    }

    const dst = await PDFDocument.create();
    const originalPages = await dst.copyPages(src, src.getPageIndices());
    while (originalPages.length < paddedTotal) {
      const blankPage = src.getPage(0);
      const [blankCopied] = await dst.copyPages(src, [0]);
      originalPages.push(blankCopied);
    }

    const reordered = order.map((idx) => originalPages[idx]);
    reordered.forEach((p) => dst.addPage(p));

    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-cuadernillo.pdf',
      title: 'Cuadernillo listo',
      message: `${total} páginas reordenadas para ${sheetsNeeded} pliegos${blankCount > 0 ? ` (${blankCount} páginas en blanco añadidas)` : ''}.`,
      stats: [['Original', String(total)], ['Pliegos', String(sheetsNeeded)], ['Páginas finales', String(paddedTotal)], ['Blancos', String(blankCount)], ['Tamaño', formatBytes(out.length)]],
      pageCount: paddedTotal,
    };
  };

  processors.watermarkPdf = async function (input, options) {
    const { PDFDocument, rgb, StandardFonts, degrees } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const text = (options && options.text) || 'BORRADOR';
    const fontSize = (options && options.fontSize) || 60;
    const opacity = (options && options.opacity) || 0.3;
    const font = await src.embedFont(StandardFonts.HelveticaBold);
    const dst = await PDFDocument.create();
    const copied = await dst.copyPages(src, src.getPageIndices());

    for (const page of copied) {
      dst.addPage(page);
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2,
        size: fontSize,
        font,
        color: rgb(0.8, 0.8, 0.8),
        opacity,
        rotate: degrees(-45),
      });
    }

    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-marca-agua.pdf',
      title: 'Marca de agua añadida',
      message: `Marca de agua "${text}" añadida a ${copied.length} páginas.`,
      stats: [['Texto', text], ['Páginas', String(copied.length)], ['Opacidad', String(Math.round(opacity * 100)) + '%'], ['Tamaño', formatBytes(out.length)]],
      pageCount: copied.length,
    };
  };

  processors.addPageNumbersPdf = async function (input, options) {
    const { PDFDocument, StandardFonts, rgb } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const style = (options && options.style) || 'normal';
    const font = await src.embedFont(StandardFonts.Helvetica);
    const dst = await PDFDocument.create();
    const copied = await dst.copyPages(src, src.getPageIndices());

    function toRoman(num) {
      if (num <= 0 || num > 3999) return String(num);
      const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
      const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
      let result = '';
      for (let i = 0; i < vals.length; i++) {
        while (num >= vals[i]) { result += syms[i]; num -= vals[i]; }
      }
      return result;
    }

    for (let idx = 0; idx < copied.length; idx++) {
      const page = copied[idx];
      dst.addPage(page);
      const { width } = page.getSize();
      const num = style === 'roman' ? toRoman(idx + 1) : String(idx + 1);
      const textWidth = font.widthOfTextAtSize(num, 10);
      page.drawText(num, {
        x: (width - textWidth) / 2,
        y: 24,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }

    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-numerado.pdf',
      title: 'Páginas numeradas',
      message: `Numeración ${style === 'roman' ? 'romana' : 'normal'} agregada a ${copied.length} páginas.`,
      stats: [['Estilo', style === 'roman' ? 'Romano' : 'Normal'], ['Páginas', String(copied.length)], ['Tamaño', formatBytes(out.length)]],
      pageCount: copied.length,
    };
  };

  processors.addHeaderFooterPdf = async function (input, options) {
    const { PDFDocument, StandardFonts, rgb } = getPDFLib();
    const bytes = await getInputBytes(input);
    const src = await PDFDocument.load(bytes);
    const headerText = (options && options.header) || '';
    const footerText = (options && options.footer) || '';
    const showHeader = (options && options.showHeader !== undefined) ? options.showHeader : true;
    const showFooter = (options && options.showFooter !== undefined) ? options.showFooter : true;
    const font = await src.embedFont(StandardFonts.Helvetica);
    const dst = await PDFDocument.create();
    const copied = await dst.copyPages(src, src.getPageIndices());

    const activeElements = [];
    if (showHeader && headerText) activeElements.push('encabezado');
    if (showFooter && footerText) activeElements.push('pie');

    for (let idx = 0; idx < copied.length; idx++) {
      const page = copied[idx];
      dst.addPage(page);
      const { width, height } = page.getSize();

      if (showHeader && headerText) {
        const tw = font.widthOfTextAtSize(headerText, 9);
        page.drawText(headerText, {
          x: (width - tw) / 2,
          y: height - 24,
          size: 9,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
      if (showFooter && footerText) {
        const fw = font.widthOfTextAtSize(footerText, 9);
        page.drawText(footerText, {
          x: (width - fw) / 2,
          y: 20,
          size: 9,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
        const pageNum = String(idx + 1);
        const nw = font.widthOfTextAtSize(pageNum, 9);
        page.drawText(pageNum, {
          x: width - 40,
          y: 20,
          size: 9,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
    }

    const out = await dst.save();
    return {
      data: out,
      name: 'toolisto-encabezado-pie.pdf',
      title: 'Encabezado y pie añadidos',
      message: activeElements.length > 0
        ? `${activeElements.join(' y ')} añadidos a ${copied.length} páginas.`
        : `No se añadieron elementos a ${copied.length} páginas.`,
      stats: [['Elementos', activeElements.length > 0 ? activeElements.join(', ') : 'Ninguno'], ['Páginas', String(copied.length)], ['Tamaño', formatBytes(out.length)]],
      pageCount: copied.length,
    };
  };

  // ─── Image processors (browser only) ────────────────────────────────

  processors.compress = async function () { throw new Error('Compresión requiere Canvas (solo navegador).'); };
  processors.crop = async function () { throw new Error('Recorte requiere Canvas (solo navegador).'); };
  processors.convert = async function () { throw new Error('Conversión requiere Canvas (solo navegador).'); };
  processors.signature = async function () { throw new Error('Firma requiere Canvas (solo navegador).'); };
  processors.inspectMetadata = async function () { throw new Error('Inspección de metadatos requiere APIs del navegador.'); };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = processors;
  } else {
    root.ToolProcessors = processors;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
