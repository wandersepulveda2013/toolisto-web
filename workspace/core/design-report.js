/**
 * core/design-report.js — Generador de reportes por secciones.
 *
 * Secciones: title, subtitle, date, text, image, table, chart, divider, footer, page-break
 * Formatos: A4, Letter. Orientación: portrait/landscape. Márgenes configurables.
 *
 * CE-087: la vista previa (WYSIWYG) y el PDF exportado comparten LA MISMA
 * logica de encaje/altura variable (`estimateSectionH` de pdf-generator.js),
 * de modo que la paginacion del builder coincide con el documento final.
 */
import { estimateSectionH } from './pdf-generator.js';

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
    margins: { top: opts.marginTop ?? 20, right: opts.marginRight ?? 20, bottom: opts.marginBottom ?? 20, left: opts.marginLeft ?? 20 },
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

const PT_PER_MM = 2.835;

// Convierte una altura en "unidades de preview" (px, donde 1px = 1mm*scale)
// a puntos del PDF (1mm = PT_PER_MM pt). Ambas representaciones son
// proporcionales a mm, por eso la conversion solo depende del scale de la preview.
function previewToPt(valuePx, scale) {
  return (valuePx / scale) * PT_PER_MM;
}

function ptToPreview(valuePt, scale) {
  return (valuePt / PT_PER_MM) * scale;
}

function renderReportPreview(config, projectData = {}) {
  const pageSize = getReportPageSize(config);
  const scale = 2;
  const pageW = pageSize.width * scale;
  const pageH = pageSize.height * scale;
  const m = config.margins;
  // Area de contenido en unidades de preview (px).
  const contentW = pageW - (m.left + m.right) * scale;
  const contentH = pageH - (m.top + m.bottom) * scale;

  // CE-087: la paginacion se decide en puntos con la MISMA funcion que el PDF
  // exportado (`estimateSectionH` de pdf-generator.js). La altura de cada
  // seccion es variable (tablas con celdas envueltas, imagenes re-escaladas,
  // texto multi-linea) y por eso la preview no refluye distinto del PDF.
  const contentWpt = previewToPt(contentW, scale);
  const contentHpt = previewToPt(contentH, scale);

  let pages = [[]];
  let currentYpt = 0;

  function addSection(section, pageIdx) {
    if (section.type === 'page-break') {
      pages.push([]);
      currentYpt = 0;
      return pages.length - 1;
    }
    const sectionHpt = estimateSectionH(section, contentWpt, contentHpt);
    if (currentYpt + sectionHpt > contentHpt && pages[pageIdx].length > 0) {
      pages.push([]);
      pageIdx = pages.length - 1;
      currentYpt = 0;
    }
    // y se guarda en unidades de preview (px) para el render del DOM.
    pages[pageIdx].push({ section, y: ptToPreview(currentYpt, scale) });
    currentYpt += sectionHpt;
    return pageIdx;
  }

  (config.sections || []).forEach((section, idx) => {
    addSection(section, pages.length - 1);
  });

  return { pages, pageSize, pageW, pageH, contentW, contentH, scale, margins: m };
}

function estimateSectionHeight(section, contentW) {
  // Atajo de coherencia (CE-087): delega en la MISMA funcion que usa el PDF
  // (`estimateSectionH` de pdf-generator.js). Recibe contentW en px y devuelve
  // la altura en px (escala 2). El usableH se estima a partir del ancho con
  // una proporcion de pagina A4 para que las imagenes no se subestimen.
  const scale = 2;
  const contentWpt = previewToPt(contentW, scale);
  const usableHpt = previewToPt(contentW / 1.4, scale);
  return ptToPreview(estimateSectionH(section, contentWpt, usableHpt), scale);
}

export { PAGE_SIZES, createReportSection, createReportConfig, getReportPageSize, renderReportPreview, estimateSectionHeight };
