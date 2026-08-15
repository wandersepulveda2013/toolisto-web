/**
 * core/pdf-generator.js — Generador PDF sin dependencias externas.
 *
 * Genera PDFs validos con header, pages, text, images, tables, charts.
 * Soporta A4/Letter, portrait/landscape, acentos, saltos de pagina.
 * Tablas renderizadas como grilla, graficos como barras, imagenes embebidas.
 */
function pdfString(str) {
  const parts = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 92) parts.push('\\\\');
    else if (c === 40) parts.push('\\(');
    else if (c === 41) parts.push('\\)');
    else if (c < 128) parts.push(str[i]);
    else parts.push('\\' + c.toString(8).padStart(3, '0'));
  }
  return '(' + parts.join('') + ')';
}

function generatePDF(config) {
  const PAGE_SIZES = { A4: [595, 842], Letter: [612, 792] };
  const base = PAGE_SIZES[config.format] || PAGE_SIZES.A4;
  const isLandscape = config.orientation === 'landscape';
  const pageW = isLandscape ? base[1] : base[0];
  const pageH = isLandscape ? base[0] : base[1];
  const m = config.margins || { top: 20, right: 20, bottom: 20, left: 20 };
  const mTopPt = m.top * 2.835;
  const mBottomPt = m.bottom * 2.835;
  const mLeftPt = m.left * 2.835;
  const mRightPt = m.right * 2.835;
  const contentW = pageW - mLeftPt - mRightPt;
  const usableH = pageH - mTopPt - mBottomPt;
  const lineHeight = 14;
  const tableRowH = 20;
  const tableTopInset = 14;

  const objects = [];
  let objCount = 0;
  const imageCache = new Map();
  let imageSequence = 0;

  function addObj(content) {
    objCount++;
    objects.push({ id: objCount, content });
    return objCount;
  }

  function registerJpegImage(dataUrl) {
    const source = String(dataUrl || '');
    if (!/^data:image\/(?:jpeg|jpg);base64,/i.test(source)) return null;
    if (imageCache.has(source)) return imageCache.get(source);
    const base64 = source.slice(source.indexOf(',') + 1);
    const bytes = base64ToBytes(base64);
    const dimensions = readJpegDimensions(bytes);
    if (!dimensions) return null;
    const hex = bytesToHex(bytes);
    const imageId = addObj(`<< /Type /XObject /Subtype /Image /Width ${dimensions.width} /Height ${dimensions.height} /ColorSpace /${dimensions.colorSpace} /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`);
    const image = { name: 'Im' + (++imageSequence), id: imageId, width: dimensions.width, height: dimensions.height };
    imageCache.set(source, image);
    return image;
  }

  const pages = [];
  let currentPage = [];
  let currentY = 0;

  function newPage() {
    if (currentPage.length > 0) pages.push(currentPage);
    currentPage = [];
    currentY = 0;
  }

  function estimateSectionH(section) {
    if (section.type === 'page-break') return 0;
    if (section.type === 'title') return 36;
    if (section.type === 'subtitle') return 26;
    if (section.type === 'date') return 20;
    if (section.type === 'divider') return 20;
    if (section.type === 'footer') return 24;
    if (section.type === 'image') return section.height || 150;
    if (section.type === 'table') {
      const d = section.data || {};
      const rc = (d.headers ? 1 : 0) + (d.rows || []).length;
      return Math.max(30, rc * tableRowH + tableTopInset);
    }
    if (section.type === 'chart') {
      const s = (section.data && section.data.series) || [];
      return Math.max(100, 30 + s.length * 18 + 40);
    }
    const lines = wrapText(section.content || '', contentW, section.type);
    return lines.length * lineHeight + 10;
  }

  function addTableSections(section) {
    const data = section.data || {};
    const rows = data.rows || [];
    const hasHeader = (data.headers || []).length > 0;
    if (rows.length === 0) {
      currentPage.push({ section, y: currentY });
      currentY += estimateSectionH(section);
      return;
    }

    let rowIndex = 0;
    while (rowIndex < rows.length) {
      const availableRows = Math.floor((usableH - currentY - tableTopInset) / tableRowH) - (hasHeader ? 1 : 0);
      if (availableRows < 1 && currentPage.length > 0) {
        newPage();
        continue;
      }
      // A page with the configured margins always fits at least one row in normal formats.
      // Keep the row intact even with an unusually restrictive custom margin.
      const rowCount = Math.max(1, availableRows);
      const pageRows = rows.slice(rowIndex, rowIndex + rowCount);
      const fragment = { ...section, data: { ...data, rows: pageRows } };
      currentPage.push({ section: fragment, y: currentY });
      currentY += estimateSectionH(fragment);
      rowIndex += pageRows.length;
      if (rowIndex < rows.length) newPage();
    }
  }

  (config.sections || []).forEach(section => {
    if (section.type === 'page-break') {
      newPage();
      return;
    }
    if (section.type === 'table') {
      addTableSections(section);
      return;
    }
    const neededH = estimateSectionH(section);
    if (currentY + neededH > usableH && currentPage.length > 0) newPage();
    currentPage.push({ section, y: currentY });
    currentY += neededH;
  });
  if (currentPage.length > 0) pages.push(currentPage);
  if (pages.length === 0) pages.push([]);

  const fontsObj = addObj('<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>');

  const pageObjIds = [];
  pages.forEach(page => {
    const contentParts = [];
    const pageImages = new Map();
    contentParts.push('q');
    page.forEach(item => {
      const x0 = mLeftPt;
      const y0 = pageH - mTopPt - item.y;
      renderSectionPDF(contentParts, item.section, x0, y0, contentW, {
        registerImage: (dataUrl) => {
          const image = registerJpegImage(dataUrl);
          if (image) pageImages.set(image.name, image.id);
          return image;
        },
      });
    });
    contentParts.push('Q');
    const streamStr = contentParts.join('\n');
    const contentId = addObj(`<< /Length ${streamStr.length} >>\nstream\n${streamStr}\nendstream`);
    const imageResource = pageImages.size
      ? ` /XObject << ${[...pageImages].map(([name, id]) => `/${name} ${id} 0 R`).join(' ')} >>`
      : '';
    const pageId = addObj(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentId} 0 R /Resources << /Font ${fontsObj} 0 R${imageResource} >> >>`);
    pageObjIds.push(pageId);
  });

  const pageKids = pageObjIds.map(id => `${id} 0 R`).join(' ');
  const infoId = addObj(`<< /Title ${pdfString(config.title || 'Reporte')} /Author ${pdfString(config.author || '')} /Creator ${pdfString('Toolisto Workspace')} /Producer ${pdfString('Toolisto PDF Engine')} >>`);
  const catalogId = addObj(`<< /Type /Catalog /Pages 0 0 R /Info ${infoId} 0 R >>`);
  const pagesId = addObj(`<< /Type /Pages /Kids [${pageKids}] /Count ${pages.length} >>`);

  objects.forEach(obj => {
    if (obj.id === catalogId) obj.content = obj.content.replace('0 0 R', `${catalogId} 0 R`);
    if (obj.id === pagesId) obj.content = obj.content.replace('0 0 R', `${pagesId} 0 R`);
  });

  pageObjIds.forEach(id => {
    const obj = objects.find(o => o.id === id);
    if (obj) obj.content = obj.content.replace('/Parent 0 0 R', `/Parent ${pagesId} 0 R`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach(obj => {
    offsets.push(pdf.length);
    pdf += `${obj.id} 0 obj\n${obj.content}\nendobj\n\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(off => {
    pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function renderSectionPDF(parts, section, x0, y0, contentW, context = {}) {
  switch (section.type) {
    case 'title': renderTextLines(parts, section.content || '', x0, y0, contentW, 24, '/F2'); break;
    case 'subtitle': renderTextLines(parts, section.content || '', x0, y0, contentW, 16, '/F2'); break;
    case 'date': renderTextLines(parts, section.content || '', x0, y0, contentW, 10, '/F1'); break;
    case 'text': renderTextLines(parts, section.content || '', x0, y0, contentW, 12, '/F1'); break;
    case 'footer': renderTextLines(parts, section.content || '', x0, y0, contentW, 10, '/F1', 'center'); break;
    case 'divider': {
      const lineY = y0 - 8;
      parts.push(`0.8 0.8 0.8 RG ${x0} ${lineY} m ${x0 + contentW} ${lineY} l S`);
      break;
    }
    case 'image': renderImagePDF(parts, section, x0, y0, contentW, context); break;
    case 'table': renderTablePDF(parts, section, x0, y0, contentW); break;
    case 'chart': renderChartPDF(parts, section, x0, y0, contentW); break;
    case 'page-break': break;
  }
}

function renderTextLines(parts, text, x0, y0, contentW, fontSize, fontRef, align) {
  const lines = wrapText(text, contentW, null, fontSize);
  const lineH = fontSize * 1.4;
  lines.forEach((line, li) => {
    const ly = y0 - fontSize - li * lineH;
    let tx = x0;
    if (align === 'center') {
      const approxW = line.length * fontSize * 0.5;
      tx = x0 + (contentW - approxW) / 2;
    }
    parts.push(`BT ${fontRef} ${fontSize} Tf ${tx} ${ly} Td ${pdfString(line)} Tj ET`);
  });
}

function renderTablePDF(parts, section, x0, y0, contentW) {
  const data = section.data || {};
  const headers = data.headers || [];
  const rows = data.rows || [];
  if (headers.length === 0 && rows.length === 0) {
    renderTextLines(parts, '[Tabla vacia]', x0, y0, contentW, 11, '/F1');
    return;
  }
  const allRows = [];
  if (headers.length > 0) allRows.push(headers);
  rows.forEach(r => allRows.push(r));
  const colCount = Math.max(1, headers.length || (rows[0] ? rows[0].length : 1));
  const colW = contentW / colCount;
  const rowH = 20;
  const startY = y0 - 14;

  parts.push('0.2 0.2 0.2 RG');
  allRows.forEach((row, ri) => {
    const ry = startY - ri * rowH;
    const isHeader = ri === 0 && headers.length > 0;
    if (isHeader) {
      parts.push(`0 0 0 0.3 0.8 0.6 rg ${x0} ${ry - rowH} ${contentW} ${rowH} re f`);
      parts.push('0 0 0 rg');
    }
    (row || []).forEach((cell, ci) => {
      const cx = x0 + ci * colW;
      parts.push(`BT /F1 ${isHeader ? 10 : 9} Tf ${cx + 3} ${ry - 13} Td ${pdfString(String(cell != null ? cell : ''))} Tj ET`);
    });
    parts.push(`${x0} ${ry - rowH} m ${x0 + contentW} ${ry - rowH} l S`);
  });
  parts.push(`${x0} ${startY} m ${x0 + contentW} ${startY} l S`);
  for (let ci = 0; ci <= colCount; ci++) {
    const vx = x0 + ci * colW;
    parts.push(`${vx} ${startY} m ${vx} ${startY - allRows.length * rowH} l S`);
  }
  parts.push('0 0 0 rg');
}

function renderChartPDF(parts, section, x0, y0, contentW) {
  const data = section.data || {};
  const series = data.series || [];
  const title = data.title || section.content || 'Grafico';
  if (series.length === 0) {
    renderTextLines(parts, '[Sin datos para graficar]', x0, y0, contentW, 11, '/F1');
    return;
  }
  renderTextLines(parts, title, x0, y0, contentW, 12, '/F2');
  const chartTop = y0 - 30;
  const chartH = 100;
  const barW = Math.max(10, Math.min(28, (contentW - 10) / series.length));
  const allVals = series.map(s => s.value || 0);
  const maxVal = Math.max(1, ...allVals.map(v => Math.abs(v)));
  const hasNeg = allVals.some(v => v < 0);
  const baseline = hasNeg ? chartTop - chartH / 2 : chartTop;

  parts.push('0.8 0.8 0.8 RG');
  parts.push(`${x0} ${baseline} m ${x0 + contentW} ${baseline} l S`);

  series.forEach((s, i) => {
    const val = s.value || 0;
    const bx = x0 + i * (barW + 4) + 4;
    const barH = Math.round((Math.abs(val) / maxVal) * (hasNeg ? chartH / 2 : chartH));
    if (val >= 0) {
      parts.push('0.318 0.404 0.910 rg');
      parts.push(`${bx} ${baseline - barH} ${barW - 2} ${barH} re f`);
    } else {
      parts.push('0.851 0.537 0.231 rg');
      parts.push(`${bx} ${baseline} ${barW - 2} ${barH} re f`);
    }
    const label = String(s.label || '').slice(0, 8);
    parts.push('0 0 0 rg');
    parts.push(`BT /F1 7 Tf ${bx} ${baseline + 10} Td ${pdfString(label)} Tj ET`);
    parts.push(`BT /F1 7 Tf ${bx} ${val >= 0 ? baseline - barH - 8 : baseline + barH + 10} Td ${pdfString(String(val))} Tj ET`);
  });
  parts.push('0 0 0 rg');
}

function renderImagePDF(parts, section, x0, y0, contentW, context = {}) {
  const dataUrl = section.dataUrl || section.content;
  const image = context.registerImage?.(dataUrl);
  const displayW = Math.min(contentW, Number(section.width) || (image ? contentW : 300));
  const displayH = Number(section.height) || (image ? Math.max(80, displayW * image.height / image.width) : 120);
  const boxY = y0 - displayH;
  if (image) {
    parts.push(`q ${displayW} 0 0 ${displayH} ${x0} ${boxY} cm /${image.name} Do Q`);
    return;
  }
  parts.push('0.93 0.93 0.93 rg');
  parts.push(`${x0} ${boxY} ${displayW} ${displayH} re f`);
  parts.push('0.8 0.8 0.8 RG');
  parts.push(`${x0} ${boxY} ${displayW} ${displayH} re S`);
  parts.push('0 0 0 rg');
  const label = dataUrl ? '[Imagen embebida]' : '[Imagen no disponible]';
  renderTextLines(parts, label, x0 + 10, boxY + displayH / 2 + 6, displayW - 20, 11, '/F1', 'center');
}

function base64ToBytes(value) {
  const binary = typeof atob === 'function' ? atob(value) : Buffer.from(value, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes) {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result.toUpperCase();
}

function readJpegDimensions(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (sofMarkers.has(marker) && offset + 7 < bytes.length) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (width > 0 && height > 0) return { width, height, colorSpace: components === 1 ? 'DeviceGray' : 'DeviceRGB' };
    }
    if (!segmentLength) break;
    offset += segmentLength;
  }
  return null;
}

function wrapText(text, maxWidth, type, fontSizeOverride) {
  if (!text) return [''];
  const fontSize = fontSizeOverride || (type === 'title' ? 24 : type === 'subtitle' ? 16 : type === 'date' || type === 'footer' ? 10 : 12);
  const charsPerLine = Math.max(20, Math.floor(maxWidth / (fontSize * 0.5)));
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach(word => {
    if ((current + ' ' + word).trim().length > charsPerLine) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export { generatePDF };
