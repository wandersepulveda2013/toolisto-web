/**
 * core/design-report.js — Generador de reportes por secciones.
 *
 * Secciones: title, subtitle, date, text, image, table, chart, divider, footer, page-break
 * Formatos: A4, Letter. Orientación: portrait/landscape. Márgenes configurables.
 */
const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
};

function createReportSection(type, content = '') {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    type: type || 'text',
    content: content,
    style: {},
    data: null,
    dataUrl: null,
    assetId: null,
    width: null,
    height: null,
  };
}

function createReportConfig(opts = {}) {
  return {
    format: opts.format || 'A4',
    orientation: opts.orientation || 'portrait',
    margins: { top: opts.marginTop || 20, right: opts.marginRight || 20, bottom: opts.marginBottom || 20, left: opts.marginLeft || 20 },
    sections: opts.sections || [],
    title: opts.title || 'Reporte sin titulo',
    author: opts.author || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getReportPageSize(config) {
  const size = PAGE_SIZES[config.format] || PAGE_SIZES.A4;
  if (config.orientation === 'landscape') return { width: size.height, height: size.width };
  return { width: size.width, height: size.height };
}

function renderReportPreview(config, projectData = {}) {
  const pageSize = getReportPageSize(config);
  const scale = 2;
  const pageW = pageSize.width * scale;
  const pageH = pageSize.height * scale;
  const m = config.margins;
  const contentW = pageW - (m.left + m.right) * scale;
  const contentH = pageH - (m.top + m.bottom) * scale;

  let pages = [[]];
  let currentY = 0;

  function addSection(section, pageIdx) {
    if (section.type === 'page-break') {
      pages.push([]);
      return pages.length - 1;
    }
    const sectionH = estimateSectionHeight(section, contentW);
    if (currentY + sectionH > contentH && pages[pageIdx].length > 0) {
      pages.push([]);
      pageIdx = pages.length - 1;
      currentY = 0;
    }
    pages[pageIdx].push({ section, y: currentY });
    currentY += sectionH + 8;
    return pageIdx;
  }

  (config.sections || []).forEach((section, idx) => {
    addSection(section, pages.length - 1);
  });

  return { pages, pageSize, pageW, pageH, contentW, contentH, scale, margins: m };
}

function estimateSectionHeight(section, contentW) {
  switch (section.type) {
    case 'title': return 36;
    case 'subtitle': return 24;
    case 'date': return 20;
    case 'text': return Math.max(20, Math.ceil(((section.content || '').length / (contentW / 8))) * 16 + 16);
    case 'image': return section.height || 150;
    case 'table': return (section.data ? (section.data.rows || []).length * 24 + 30 : 60);
    case 'chart': return section.height || 200;
    case 'divider': return 20;
    case 'footer': return 20;
    default: return 40;
  }
}

export { PAGE_SIZES, createReportSection, createReportConfig, getReportPageSize, renderReportPreview, estimateSectionHeight };
