/**
 * core/pdf-generator.js — Generador PDF sin dependencias externas.
 *
 * Genera PDFs validos con header, pages, text, images, tables, charts.
 * Soporta A4/Letter, portrait/landscape, acentos, saltos de pagina.
 * Tablas renderizadas como grilla, graficos como barras, imagenes embebidas.
 */
const TABLE_ROW_H = 20;
const TABLE_TOP_INSET = 14;
const CELL_LINE_HEIGHT = 9 * 1.4;

// Lineas de una celda de tabla: envuelve por espacios y ademas corta tokens
// mas largos que la columna (una URL/cadena sin espacios no desborda la pagina).
function cellLines(text, cellW, fontSize) {
  if (!text) return [''];
  const charsPerLine = Math.max(1, Math.floor(cellW / (fontSize * 0.5)));
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  const hardBreak = (rest) => {
    while (rest.length > charsPerLine) {
      lines.push(rest.slice(0, charsPerLine));
      rest = rest.slice(charsPerLine);
    }
    lines.push(rest);
  };
  words.forEach(word => {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > charsPerLine) {
      if (current) { lines.push(current); current = ''; }
      if (word.length > charsPerLine) hardBreak(word);
      else current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// Altura en pt de una fila de tabla segun el contenido real (no solo 20pt):
// mantiene coherencia entre estimacion de paginacion, reserva y render.
function tableRowHeight(cells, colW, fontSize) {
  let maxLines = 1;
  (cells || []).forEach(cell => {
    const n = cellLines(String(cell != null ? cell : ''), Math.max(10, colW - 6), fontSize).length;
    if (n > maxLines) maxLines = n;
  });
  return Math.max(TABLE_ROW_H, maxLines * CELL_LINE_HEIGHT + 4);
}

function tableColWidth(data, contentW) {
  const headers = (data && data.headers) || [];
  const rows = (data && data.rows) || [];
  const colCount = Math.max(1, headers.length || (rows[0] ? rows[0].length : 1));
  return contentW / colCount;
}

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

  function estimateTextSectionH(section) {
    const type = section.type;
    const size = type === 'title' ? 24 : type === 'subtitle' ? 16 : type === 'date' || type === 'footer' ? 10 : 12;
    const lines = wrapText(section.content || '', contentW, type);
    return size + Math.max(0, lines.length - 1) * (size * 1.4) + 8;
  }

  function estimateSectionH(section) {
    if (section.type === 'page-break') return 0;
    if (section.type === 'title') return Math.max(36, estimateTextSectionH(section));
    if (section.type === 'subtitle') return Math.max(26, estimateTextSectionH(section));
    if (section.type === 'date') return Math.max(20, estimateTextSectionH(section));
    if (section.type === 'divider') return 20;
    if (section.type === 'footer') return Math.max(24, estimateTextSectionH(section));
    if (section.type === 'image') {
      const sectionW = Number(section.width);
      const sectionH = Number(section.height);
      const fit = fitImageDisplay(sectionW, sectionH, contentW, usableH);
      if (fit) return fit.h;
      return sectionH || 150;
    }
    if (section.type === 'table') {
      const d = section.data && typeof section.data === 'object' ? section.data : {};
      const rows = d.rows || [];
      const colW = tableColWidth(d, contentW);
      let h = TABLE_TOP_INSET + ((d.headers || []).length > 0 ? tableRowHeight(d.headers, colW, 10) : 0);
      if (rows.length === 0) return Math.max(30, h);
      rows.forEach(r => { h += tableRowHeight(r, colW, 9); });
      return Math.max(30, h);
    }
    if (section.type === 'chart') {
      // El render del grafico tiene altura fija (titulo ~12 pt + chartH 100 +
      // etiquetas), NO crece con el numero de series. La estimacion anterior
      // (30 + n*18 + 40) infra-reservaba para <= 5 series (la barra se dibujaba
      // sobre la seccion siguiente) y sobre-reservaba 430-1510 pt para muchas
      // series (hueco vacio / pagina casi vacia tras el recorte de CE-075).
      const chartData = section.data && typeof section.data === 'object' ? section.data : {};
      const chartTitle = String(chartData.title || section.content || 'Grafico');
      const titleLines = wrapText(chartTitle, contentW, 'text');
      return Math.max(150, 30 + (titleLines.length - 1) * 16.8 + 120);
    }
    const lines = wrapText(section.content || '', contentW, section.type);
    return Math.max(24, estimateTextSectionH(section));
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

    const colW = tableColWidth(data, contentW);
    // Las filas pueden tener altura variable (celdas envueltas): se encajan por
    // su alto real, no por un multiplo fijo de tableRowH.
    let rowIndex = 0;
    while (rowIndex < rows.length) {
      let used = currentY + TABLE_TOP_INSET + (hasHeader ? tableRowHeight(data.headers, colW, 10) : 0);
      const pageRows = [];
      let idx = rowIndex;
      while (idx < rows.length && used + tableRowHeight(rows[idx], colW, 9) <= usableH + 0.01) {
        pageRows.push(rows[idx]);
        used += tableRowHeight(rows[idx], colW, 9);
        idx++;
      }
      // Una fila unica mas alta que la pagina usable se fuerza igual (mismo
      // criterio que el comportamiento previo de Math.max(1, availableRows)).
      if (pageRows.length === 0) {
        pageRows.push(rows[idx]);
        idx++;
      }
      const fragment = { ...section, data: { ...data, rows: pageRows } };
      currentPage.push({ section: fragment, y: currentY });
      currentY += estimateSectionH(fragment);
      rowIndex = idx;
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
        usableH,
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
  const infoId = addObj(`<< /Title ${pdfString(config.title || 'Reporte')} /Author ${pdfString(config.author || '')} /Creator ${pdfString('APLUNO Workspace')} /Producer ${pdfString('APLUNO PDF Engine')} >>`);
  const catalogId = addObj(`<< /Type /Catalog /Pages 0 0 R /Info ${infoId} 0 R >>`);
  const pagesId = addObj(`<< /Type /Pages /Kids [${pageKids}] /Count ${pages.length} >>`);

  objects.forEach(obj => {
    if (obj.id === catalogId) obj.content = obj.content.replace('/Pages 0 0 R', `/Pages ${pagesId} 0 R`);
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
  const startY = y0 - TABLE_TOP_INSET;
  const rowHeights = allRows.map((r, ri) => tableRowHeight(r, colW, ri === 0 && headers.length > 0 ? 10 : 9));
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  parts.push('0.2 0.2 0.2 RG');
  let rowTop = startY;
  allRows.forEach((row, ri) => {
    const rh = rowHeights[ri];
    const rowBottom = rowTop - rh;
    const fontSize = ri === 0 && headers.length > 0 ? 10 : 9;
    const isHeader = ri === 0 && headers.length > 0;
    if (isHeader) {
      parts.push(`0 0 0 0.3 0.8 0.6 rg ${x0} ${rowBottom} ${contentW} ${rh} re f`);
      parts.push('0 0 0 rg');
    }
    const cellLinesPerCell = (row || []).map(cell => cellLines(String(cell != null ? cell : ''), Math.max(10, colW - 6), fontSize));
    (row || []).forEach((cell, ci) => {
      const cx = x0 + ci * colW;
      const lines = cellLinesPerCell[ci];
      lines.forEach((ln, li) => {
        const ly = rowTop - 14 - li * (fontSize * 1.4);
        parts.push(`BT /F1 ${fontSize} Tf ${cx + 3} ${ly} Td ${pdfString(ln)} Tj ET`);
      });
    });
    parts.push(`${x0} ${rowBottom} m ${x0 + contentW} ${rowBottom} l S`);
    rowTop = rowBottom;
  });
  parts.push(`${x0} ${startY} m ${x0 + contentW} ${startY} l S`);
  for (let ci = 0; ci <= colCount; ci++) {
    const vx = x0 + ci * colW;
    parts.push(`${vx} ${startY} m ${vx} ${startY - totalH} l S`);
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
  const minBar = 10;
  // Con muchas series (tabla con muchas filas) el pitch fijo (barW + 4) empuja
  // las barras fuera del area de contenido e incluso de la pagina. Dos niveles:
  // 1) se re-escala barW para que la ultima barra quede dentro de contentW;
  // 2) si ni con el ancho minimo caben, se recortan a lo que quepa y se muestra
  //    un marcador "+N" (las series restantes se indican, no se silencian).
  const maxFitBars = Math.max(1, Math.floor(contentW / (minBar + 4)));
  const tooMany = series.length > maxFitBars;
  const drawn = tooMany ? series.slice(0, Math.max(1, maxFitBars - 2)) : series;
  const hiddenCount = series.length - drawn.length;
  let barW = Math.max(minBar, Math.min(28, (contentW - 10) / drawn.length));
  let pitch = barW + 4;
  if (tooMany) {
    barW = minBar;
    pitch = minBar + 4;
  } else if (x0 + (drawn.length - 1) * pitch + 4 + (barW - 2) > x0 + contentW) {
    barW = Math.max(minBar, (contentW - 4 * drawn.length + 2) / drawn.length);
    pitch = barW + 4;
  }
  const allVals = drawn.map(s => s.value || 0);
  const maxVal = Math.max(1, ...allVals.map(v => Math.abs(v)));
  const hasNeg = allVals.some(v => v < 0);
  const baseline = hasNeg ? chartTop - chartH / 2 : chartTop;

  parts.push('0.8 0.8 0.8 RG');
  parts.push(`${x0} ${baseline} m ${x0 + contentW} ${baseline} l S`);

  drawn.forEach((s, i) => {
    const val = s.value || 0;
    const bx = x0 + i * pitch + 4;
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
  if (hiddenCount > 0) {
    const markerX = x0 + drawn.length * pitch + 2;
    parts.push('0 0 0 rg');
    parts.push(`BT /F1 7 Tf ${markerX} ${baseline - 4} Td ${pdfString('+' + hiddenCount)} Tj ET`);
  }
  parts.push('0 0 0 rg');
}

// Encaje de imagenes dentro del area usable (ancho del contenido y alto usable):
// conserva la proporcion y devuelve null si faltan dimensiones para que el
// llamador use su fallback. Coherente entre estimacion (estimateSectionH) y
// render (renderImagePDF) para no paginar a la estimacion y dibujar a otra.
function fitImageDisplay(sectionW, sectionH, contentW, usableH) {
  if (!sectionW || !sectionH || !contentW || !usableH) return null;
  let w = Math.min(contentW, sectionW);
  let h = sectionH * (w / sectionW);
  if (h > usableH) {
    h = usableH;
    w = h * (sectionW / sectionH);
  }
  return { w, h };
}

function renderImagePDF(parts, section, x0, y0, contentW, context = {}) {
  const dataUrl = section.dataUrl || section.content;
  const image = context.registerImage?.(dataUrl);
  const sectionW = Number(section.width);
  const sectionH = Number(section.height);
  const usableH = context.usableH || 0;
  // Una imagen mas alta que la pagina usable se re-escala para caber en alto
  // (antes solo se acotaba el ancho: una captura estrecha y larga se dibujaba
  // fuera del margen inferior y empujaba lo siguiente a paginas vacias).
  const scaled = fitImageDisplay(sectionW, sectionH, contentW, usableH);
  let displayW = contentW;
  let displayH = sectionH || 120;
  if (scaled) {
    displayW = scaled.w;
    displayH = scaled.h;
  } else if (image) {
    displayW = Math.min(contentW, sectionW || contentW);
    displayH = Math.max(80, displayW * (image.height / image.width));
    const capped = fitImageDisplay(displayW, displayH, contentW, usableH);
    if (capped) {
      displayW = capped.w;
      displayH = capped.h;
    }
  }
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
    // Un token mas largo que la linea (URL, nombre largo) se corta por
    // charsPerLine: si no, la linea se dibuja fuera del borde derecho.
    if (word.length > charsPerLine) {
      if (current) { lines.push(current); current = ''; }
      let rest = word;
      while (rest.length >= charsPerLine) {
        lines.push(rest.slice(0, charsPerLine));
        rest = rest.slice(charsPerLine);
      }
      if (rest) current = rest;
      return;
    }
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
