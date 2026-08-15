import { recognizeText } from './ocr-engine.js';
import { parseTabularText } from './tabular-text-parser.js';
import { parseInvoiceText, invoiceRows } from './invoice.js';
import { generatePDF } from './pdf-generator.js';
import { normalizePdfImageSections } from './pdf-images.js';

export function registerWorkflowOperations(registry) {
  const ops = [
    // ── Image operations ──
    {
      id: 'image.rotate',
      name: 'Rotar imagen',
      description: 'Rota una imagen 90, 180 o 270 grados.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'image',
      supportsBatch: true,
      supportsProgress: false,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        angle: { type: 'select', label: 'Angulo', options: [{ value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }], default: 90, required: true },
      },
      async execute(ctx) {
        const angle = ctx.options.angle || 90;
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            img = await canvasToBlob(rotateCanvas(image, angle));
            return img;
          } finally { URL.revokeObjectURL(url); }
        }
        if (img instanceof HTMLCanvasElement) {
          return await canvasToBlob(rotateCanvas(img, angle));
        }
        if (typeof img === 'string' && img.startsWith('data:')) {
          const image = await loadImage(img);
          return await canvasToBlob(rotateCanvas(image, angle));
        }
        throw new Error('Unsupported input type for image.rotate');
      },
    },
    {
      id: 'image.resize',
      name: 'Redimensionar imagen',
      description: 'Cambia el tamaño de una imagen al ancho y alto especificados.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'image',
      supportsBatch: true,
      supportsProgress: false,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        width: { type: 'number', label: 'Ancho (px)', default: 800, required: true, min: 1, max: 10000 },
        height: { type: 'number', label: 'Alto (px)', default: 600, required: true, min: 1, max: 10000 },
        maintainAspect: { type: 'checkbox', label: 'Mantener proporcion', default: true },
      },
      async execute(ctx) {
        let width = parseInt(ctx.options.width) || 800;
        let height = parseInt(ctx.options.height) || 600;
        const maintain = ctx.options.maintainAspect !== false;
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            if (maintain) { const r = Math.min(width / image.naturalWidth, height / image.naturalHeight); width = Math.round(image.naturalWidth * r); height = Math.round(image.naturalHeight * r); }
            return await canvasToBlob(resizeCanvas(image, width, height));
          } finally { URL.revokeObjectURL(url); }
        }
        if (typeof img === 'string' && img.startsWith('data:')) {
          const image = await loadImage(img);
          if (maintain) { const r = Math.min(width / image.naturalWidth, height / image.naturalHeight); width = Math.round(image.naturalWidth * r); height = Math.round(image.naturalHeight * r); }
          return await canvasToBlob(resizeCanvas(image, width, height));
        }
        throw new Error('Unsupported input type for image.resize');
      },
    },
    {
      id: 'image.convert',
      name: 'Convertir formato de imagen',
      description: 'Convierte la imagen a PNG, JPEG o WebP.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'image',
      supportsBatch: true,
      supportsProgress: false,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        format: { type: 'select', label: 'Formato de salida', options: [{ value: 'image/png', label: 'PNG' }, { value: 'image/jpeg', label: 'JPEG' }, { value: 'image/webp', label: 'WebP' }], default: 'image/png', required: true },
        quality: { type: 'range', label: 'Calidad', default: 90, min: 10, max: 100 },
      },
      async execute(ctx) {
        const format = ctx.options.format || 'image/png';
        const quality = (parseInt(ctx.options.quality) || 90) / 100;
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            return await canvasToBlob(image, format, quality);
          } finally { URL.revokeObjectURL(url); }
        }
        if (typeof img === 'string' && img.startsWith('data:')) {
          const image = await loadImage(img);
          return await canvasToBlob(image, format, quality);
        }
        if (img instanceof HTMLCanvasElement) {
          return await canvasToBlob(img, format, quality);
        }
        throw new Error('Unsupported input type for image.convert');
      },
    },
    {
      id: 'image.strip-metadata',
      name: 'Eliminar metadatos de imagen',
      description: 'Re-codifica la imagen sin metadatos EXIF.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'image',
      supportsBatch: true,
      supportsProgress: false,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        format: { type: 'select', label: 'Formato de salida', options: [{ value: 'image/jpeg', label: 'JPEG' }, { value: 'image/png', label: 'PNG' }], default: 'image/jpeg' },
      },
      async execute(ctx) {
        const format = ctx.options.format || 'image/jpeg';
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try { return await canvasToBlob(await loadImage(url), format, 92); } finally { URL.revokeObjectURL(url); }
        }
        if (typeof img === 'string' && img.startsWith('data:')) {
          return await canvasToBlob(await loadImage(img), format, 92);
        }
        throw new Error('Unsupported input type');
      },
    },
    {
      id: 'image.enhance',
      name: 'Mejorar imagen',
      description: 'Aplica mejora de contraste y nitidez a la imagen.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'image',
      supportsBatch: true,
      supportsProgress: false,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        contrast: { type: 'range', label: 'Contraste', default: 1.2, min: 0.5, max: 2.5, step: 0.1 },
        brightness: { type: 'range', label: 'Brillo', default: 1.1, min: 0.5, max: 2.0, step: 0.1 },
      },
      async execute(ctx) {
        const contrast = parseFloat(ctx.options.contrast) || 1.2;
        const brightness = parseFloat(ctx.options.brightness) || 1.1;
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            return await canvasToBlob(enhanceCanvas(image, contrast, brightness));
          } finally { URL.revokeObjectURL(url); }
        }
        if (typeof img === 'string' && img.startsWith('data:')) {
          return await canvasToBlob(enhanceCanvas(await loadImage(img), contrast, brightness));
        }
        throw new Error('Unsupported input type');
      },
    },

    {
      id: 'image.compress',
      name: 'Comprimir imagen',
      description: 'Reduce el peso de la imagen re-codificándola con menor calidad.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'image',
      supportsBatch: true,
      supportsProgress: false,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        quality: { type: 'range', label: 'Calidad', default: 60, min: 10, max: 100 },
        format: { type: 'select', label: 'Formato de salida', options: [{ value: 'image/jpeg', label: 'JPEG' }, { value: 'image/webp', label: 'WebP' }], default: 'image/jpeg' },
      },
      async execute(ctx) {
        const quality = (parseInt(ctx.options.quality) || 60) / 100;
        const format = ctx.options.format || 'image/jpeg';
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            return await canvasToBlob(image, format, quality);
          } finally { URL.revokeObjectURL(url); }
        }
        if (typeof img === 'string' && img.startsWith('data:')) {
          return await canvasToBlob(await loadImage(img), format, quality);
        }
        if (img instanceof HTMLCanvasElement) {
          return await canvasToBlob(img, format, quality);
        }
        throw new Error('Unsupported input type for image.compress');
      },
    },
    {
      id: 'output.zip',
      name: 'Empaquetar resultados en ZIP',
      description: 'Reúne todas las salidas del flujo en un único archivo ZIP descargable.',
      category: 'output',
      inputKinds: ['image', 'blob', 'file', 'multiple'],
      outputKind: 'file',
      supportsBatch: true,
      batchTerminal: true,
      supportsProgress: true,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        name: { type: 'text', label: 'Nombre del ZIP', default: 'resultados.zip' },
      },
      async execute(ctx) {
        if (typeof JSZip === 'undefined') throw new Error('El empaquetador ZIP no está disponible');
        const items = ctx.input?.items || [];
        if (items.length === 0) throw new Error('No hay resultados para empaquetar');
        const zip = new JSZip();
        for (let index = 0; index < items.length; index++) {
          if (ctx.signal?.cancelled) throw new Error('Empaquetado cancelado');
          const item = items[index];
          const data = item.data instanceof Blob ? item.data : item.data?.data;
          if (!(data instanceof Blob)) throw new Error('Una salida no se pudo empaquetar');
          zip.file(outputFilename(item.name, data.type, index), data);
          if (ctx.reportProgress) ctx.reportProgress((index + 1) / items.length, 'Empaquetando ' + (index + 1) + ' de ' + items.length);
        }
        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      },
    },
    {
      id: 'image.ocr',
      name: 'Extraer texto (OCR)',
      description: 'Reconoce texto en imágenes usando Tesseract.js.',
      category: 'text',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'text',
      supportsBatch: true,
      supportsProgress: true,
      supportsCancellation: true,
      destructive: false,
      optionSchema: {
        language: { type: 'select', label: 'Idioma', options: [{ value: 'spa', label: 'Español' }, { value: 'eng', label: 'Inglés' }], default: 'spa' },
      },
      async execute(ctx) {
        const lang = ctx.options.language || 'spa';
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const cctx = canvas.getContext('2d');
            cctx.drawImage(image, 0, 0);
            if (ctx.reportProgress) ctx.reportProgress(0.1, 'Cargando motor OCR...');
            const result = await recognizeText(canvas, {
              lang,
              onProgress: (pct, msg) => { if (ctx.reportProgress) ctx.reportProgress(0.1 + pct * 0.6, msg); },
              onPhase: (phase) => { if (phase === 'recognizing' && ctx.reportProgress) ctx.reportProgress(0.8, 'Reconociendo texto...'); },
            });
            if (ctx.reportProgress) ctx.reportProgress(1, 'OCR completado');
            return result.text;
          } finally { URL.revokeObjectURL(url); }
        }
        throw new Error('Unsupported input type for image.ocr');
      },
    },
    {
      id: 'image.to-pdf',
      name: 'Convertir a PDF',
      description: 'Convierte una imagen a un documento PDF.',
      category: 'image',
      inputKinds: ['image', 'blob', 'file'],
      outputKind: 'file',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {},
      async execute(ctx) {
        let img = ctx.input.data || ctx.input;
        if (img instanceof Blob || img instanceof File) {
          const url = URL.createObjectURL(img);
          try {
            const image = await loadImage(url);
            const w = image.naturalWidth;
            const h = image.naturalHeight;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const cctx = canvas.getContext('2d');
            cctx.drawImage(image, 0, 0);
            const jpegBlob = await new Promise((resolve, reject) => {
              canvas.toBlob(b => { if (b) resolve(b); else reject(new Error('toBlob failed')); }, 'image/jpeg', 0.92);
            });
            const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
            return createPdfBlob(w, h, jpegBytes);
          } finally { URL.revokeObjectURL(url); }
        }
        throw new Error('Unsupported input type for image.to-pdf');
      },
    },

    // ── Text / Document operations ──
    {
      id: 'text.export',
      name: 'Exportar texto',
      description: 'Exporta el contenido de un documento como archivo de texto.',
      category: 'text',
      inputKinds: ['text', 'document'],
      outputKind: 'text',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {
        format: { type: 'select', label: 'Formato', options: [{ value: 'txt', label: 'Texto plano (.txt)' }, { value: 'md', label: 'Markdown (.md)' }], default: 'txt' },
      },
      async execute(ctx) {
        const format = ctx.options.format || 'txt';
        const input = ctx.input.data || ctx.input;
        let text;
        if (typeof input === 'string') {
          text = input;
        } else if (input.blocks && Array.isArray(input.blocks)) {
          text = format === 'md' ? blocksToMarkdown(input.blocks) : blocksToPlainText(input.blocks);
        } else {
          text = JSON.stringify(input || null);
        }
        const ext = format === 'md' ? '.md' : '.txt';
        const mime = format === 'md' ? 'text/markdown' : 'text/plain';
        return new Blob([text], { type: mime });
      },
    },
    {
      id: 'text.to-table',
      name: 'Convertir texto en tabla',
      description: 'Convierte texto con formato tabular en una tabla de datos.',
      category: 'text',
      inputKinds: ['text', 'document'],
      outputKind: 'data',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {},
      async execute(ctx) {
        const input = ctx.input.data || ctx.input;
        const text = typeof input === 'string'
          ? input
          : (input.blocks ? input.blocks.map(block => block.content || '').filter(Boolean).join('\n') : '');
        return { ...parseTabularText(text), name: 'Tabla convertida' };
      },
    },
    {
      id: 'text.invoice-fields',
      name: 'Extraer campos de factura',
      description: 'Extrae los campos estructurados de una factura o recibo a partir del texto OCR.',
      category: 'text',
      inputKinds: ['text', 'document'],
      outputKind: 'data',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {},
      async execute(ctx) {
        const input = ctx.input.data || ctx.input;
        const text = typeof input === 'string'
          ? input
          : (input.blocks ? input.blocks.map(block => block.content || '').filter(Boolean).join('\n') : '');
        const parsed = parseInvoiceText(text);
        return {
          headers: ['Campo', 'Valor', 'Confianza', 'Página'],
          rows: invoiceRows(parsed, 1),
          name: 'Campos de la factura',
          confidence: parsed.confidence,
        };
      },
    },
    {
      id: 'text.to-document',
      name: 'Crear documento desde texto',
      description: 'Crea un documento Toolisto a partir de texto sin formato.',
      category: 'text',
      inputKinds: ['text'],
      outputKind: 'document',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {
        title: { type: 'text', label: 'Titulo del documento', default: 'Documento' },
      },
      async execute(ctx) {
        const input = ctx.input.data || ctx.input;
        const text = typeof input === 'string' ? input : (input.text || '');
        const title = ctx.options.title || 'Documento';
        const blocks = text.split('\n').map((line, i) => {
          const v = line.trim();
          if (/^###\s+/.test(v)) return { type: 'heading3', content: v.replace(/^###\s+/, ''), id: 'b-' + i };
          if (/^##\s+/.test(v)) return { type: 'heading2', content: v.replace(/^##\s+/, ''), id: 'b-' + i };
          if (/^#\s+/.test(v)) return { type: 'heading1', content: v.replace(/^#\s+/, ''), id: 'b-' + i };
          if (/^[-*]\s+/.test(v)) return { type: 'bullet-list', content: v.replace(/^[-*]\s+/, ''), id: 'b-' + i };
          return { type: 'paragraph', content: line, id: 'b-' + i };
        });
        return { blocks, name: title, title, type: 'document' };
      },
    },
    {
      id: 'document.to-pdf',
      name: 'Convertir documento a PDF',
      description: 'Convierte un documento o informe Toolisto en un archivo PDF local.',
      category: 'pdf',
      inputKinds: ['document', 'text'],
      outputKind: 'file',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {
        title: { type: 'text', label: 'Titulo del PDF', default: '' },
        format: { type: 'select', label: 'Formato', options: [{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Carta' }], default: 'A4' },
        orientation: { type: 'select', label: 'Orientacion', options: [{ value: 'portrait', label: 'Vertical' }, { value: 'landscape', label: 'Horizontal' }], default: 'portrait' },
        includeTitle: { type: 'checkbox', label: 'Incluir titulo como encabezado', default: true },
      },
      async execute(ctx) {
        const input = ctx.input.data || ctx.input;
        const blocks = Array.isArray(input?.blocks) ? input.blocks : [];
        const sections = await normalizePdfImageSections(
          documentBlocksToSections(blocks, ctx.options),
          { updateSize: true },
        );
        const config = {
          format: ctx.options.format || 'A4',
          orientation: ctx.options.orientation || 'portrait',
          title: ctx.options.title || input?.title || 'Documento',
          author: '',
          sections,
        };
        return new Blob([generatePDF(config)], { type: 'application/pdf' });
      },
    },
    {
      id: 'data.to-chart',
      name: 'Crear grafico',
      description: 'Convierte los datos de una tabla en un grafico de barras.',
      category: 'chart',
      inputKinds: ['data', 'document'],
      outputKind: 'document',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {
        title: { type: 'text', label: 'Titulo del grafico', default: 'Grafico de datos' },
      },
      async execute(ctx) {
        const input = ctx.input.data || ctx.input;
        const headers = Array.isArray(input?.headers) ? input.headers : [];
        const rows = Array.isArray(input?.rows) ? input.rows : [];
        if (!headers.length || !rows.length) throw new Error('Se necesita una tabla con encabezados y filas para crear un grafico');
        const { series, numericIndex } = tableChartSeries(headers, rows);
        if (!series.length) throw new Error('No se encontro una columna numerica para graficar');
        const title = ctx.options.title || 'Grafico de ' + (headers[numericIndex] || 'datos');
        return {
          blocks: [{ id: 'chart-block', type: 'chart', content: title, series }],
          name: title,
          title,
          type: 'document',
        };
      },
    },
    {
      id: 'report.create',
      name: 'Crear informe',
      description: 'Genera un informe con resumen de datos.',
      category: 'report',
      inputKinds: ['data', 'document'],
      outputKind: 'document',
      supportsBatch: false,
      supportsProgress: false,
      supportsCancellation: false,
      destructive: false,
      optionSchema: {
        title: { type: 'text', label: 'Titulo del informe', default: 'Informe' },
        includeDate: { type: 'checkbox', label: 'Incluir fecha', default: true },
      },
      async execute(ctx) {
        const input = ctx.input.data || ctx.input;
        const title = ctx.options.title || 'Informe';
        const lines = [{ type: 'heading1', content: title }];
        if (ctx.options.includeDate !== false) {
          lines.push({ type: 'paragraph', content: 'Generado: ' + new Date().toLocaleDateString('es-ES') });
        }
        lines.push({ type: 'paragraph', content: '' });
        if (input.rows && input.headers) {
          lines.push({ type: 'heading2', content: 'Datos incluidos' });
          lines.push({ type: 'paragraph', content: input.rows.length + ' filas, ' + input.headers.length + ' columnas' });
          lines.push({ type: 'paragraph', content: 'Columnas: ' + input.headers.join(', ') });
          lines.push({ type: 'table', content: '', headers: input.headers, rows: input.rows });
          const chart = tableChartSeries(input.headers, input.rows);
          if (chart.series.length) {
            lines.push({ type: 'chart', content: 'Grafico de ' + (input.headers[chart.numericIndex] || 'datos'), series: chart.series });
          }
        } else {
          lines.push({ type: 'paragraph', content: 'Basado en los datos proporcionados.' });
        }
        return { blocks: lines, name: title, title, type: 'report' };
      },
    },
  ];

  let registered = 0;
  for (const op of ops) {
    if (registry.register(op)) registered++;
  }
  return registered;
}

// ── Pure helpers (no DOM) ──

function parseLocaleChartNumber(value) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  if (/[A-Za-zÀ-ÿ]/.test(text)) return null;
  text = text.replace(/\s+/g, '').replace(/[^\d,.+\-()]/g, '').replace(/[()]/g, '');
  if (!text || !/[\d]/.test(text)) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (comma >= 0) {
    const groups = text.split(',');
    text = groups.length > 2 && groups.at(-1).length === 3 ? groups.join('') : text.replace(',', '.');
  } else if (dot >= 0) {
    const groups = text.split('.');
    text = groups.length > 2 && groups.at(-1).length === 3 ? groups.join('') : text;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function tableChartSeries(headers, rows, maxSeries = 30) {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const candidateIndexes = safeHeaders.slice(1).map((_, index) => index + 1);
  const numericIndex = candidateIndexes.sort((left, right) => {
    const leftScore = safeRows.filter(row => parseLocaleChartNumber(row?.[left]) !== null).length;
    const rightScore = safeRows.filter(row => parseLocaleChartNumber(row?.[right]) !== null).length;
    return rightScore - leftScore || left - right;
  })[0] ?? 1;
  const series = safeRows.slice(0, maxSeries).map(row => {
    const label = (row || []).slice(0, numericIndex).map(value => String(value ?? '').trim()).filter(Boolean).join(' ');
    return { label: label || String(row?.[0] ?? ''), value: parseLocaleChartNumber(row?.[numericIndex]) };
  }).filter(item => item.value !== null);
  return { series, numericIndex };
}

function documentBlocksToSections(blocks, options = {}) {
  const sections = [];
  const includeTitle = options.includeTitle !== false;
  let titleSent = !includeTitle;
  const blocksList = Array.isArray(blocks) ? blocks : [];
  for (const block of blocksList) {
    if (!block) continue;
    const content = String(block.content || '').trim();
    if (block.type === 'heading1') {
      if (!titleSent) {
        sections.push({ type: 'title', content });
        titleSent = true;
      } else {
        sections.push({ type: 'subtitle', content });
      }
      continue;
    }
    if (block.type === 'heading2') { sections.push({ type: 'subtitle', content }); continue; }
    if (block.type === 'heading3') { sections.push({ type: 'text', content }); continue; }
    if (block.type === 'divider') { sections.push({ type: 'divider', content: '' }); continue; }
    if (block.type === 'page-break' || (block.html && /data-page-break="true"/.test(block.html))) { sections.push({ type: 'page-break', content: '' }); continue; }
    if (block.type === 'bullet-list') { sections.push({ type: 'text', content: '• ' + content }); continue; }
    if (block.type === 'quote') { sections.push({ type: 'text', content: '> ' + content }); continue; }
    if (block.type === 'table' && Array.isArray(block.headers) && Array.isArray(block.rows)) {
      sections.push({ type: 'table', data: { headers: block.headers, rows: block.rows } });
      continue;
    }
    if (block.type === 'chart' && Array.isArray(block.series)) {
      sections.push({ type: 'chart', content: content, data: { series: block.series, title: content } });
      continue;
    }
    if (block.type === 'image-block') {
      const dataUrl = String(block.content || block.dataUrl || '').trim();
      sections.push({
        type: 'image',
        dataUrl: /^data:image\//i.test(dataUrl) ? dataUrl : '',
        width: block.width,
        height: block.height,
      });
      continue;
    }
    if (content) sections.push({ type: 'text', content });
  }
  if (sections.length === 0) sections.push({ type: 'text', content: '' });
  return sections;
}

// Convierte los bloques de un documento Toolisto a Markdown para `text.export`.
function blocksToMarkdown(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const lines = [];
  for (const block of list) {
    if (!block) continue;
    const content = String(block.content || '').trim();
    switch (block.type) {
      case 'heading1': lines.push('# ' + content); break;
      case 'heading2': lines.push('## ' + content); break;
      case 'heading3': lines.push('### ' + content); break;
      case 'bullet-list': lines.push('- ' + content); break;
      case 'quote': lines.push('> ' + content); break;
      case 'divider': lines.push('---'); break;
      case 'page-break': lines.push(''); break;
      case 'table': {
        if (Array.isArray(block.headers) && Array.isArray(block.rows)) {
          const header = '| ' + block.headers.map(String).join(' | ') + ' |';
          const sep = '| ' + block.headers.map(() => '---').join(' | ') + ' |';
          lines.push(header, sep);
          for (const row of block.rows) {
            lines.push('| ' + row.map(value => String(value ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |');
          }
        } else if (content) {
          lines.push(content);
        }
        break;
      }
      case 'chart': {
        lines.push(fence('charts', content || 'Grafico'));
        if (Array.isArray(block.series)) {
          lines.push('| Etiqueta | Valor |');
          lines.push('| --- | --- |');
          for (const item of block.series) {
            lines.push('| ' + String(item?.label ?? '').replace(/\|/g, '\\|') + ' | ' + String(item?.value ?? '') + ' |');
          }
        }
        lines.push(fenceEnd('charts'));
        break;
      }
      case 'image-block': {
        const dataUrl = String(block.content || block.dataUrl || '').trim();
        if (/^data:image\//i.test(dataUrl)) {
          lines.push('![imagen](' + dataUrl + ')');
        } else if (content) {
          lines.push('![imagen](' + content + ')');
        }
        break;
      }
      default:
        if (content) lines.push(content);
    }
  }
  return lines.join('\n').trim() + '\n';
}

// Versión en texto plano: preserva la estructura de forma legible para .txt.
function blocksToPlainText(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const lines = [];
  for (const block of list) {
    if (!block) continue;
    const content = String(block.content || '').trim();
    switch (block.type) {
      case 'heading1': lines.push(content); lines.push(''); break;
      case 'heading2': lines.push(content); break;
      case 'heading3': lines.push(content); break;
      case 'bullet-list': lines.push('• ' + content); break;
      case 'quote': lines.push('> ' + content); break;
      case 'divider': lines.push('————————————————'); break;
      case 'table':
        if (Array.isArray(block.headers) && Array.isArray(block.rows)) {
          lines.push(block.headers.join(' | '));
          lines.push(block.headers.map(() => '—').join(' | '));
          for (const row of block.rows) lines.push(String(row.map(v => v ?? '').join(' | ')));
        } else if (content) lines.push(content);
        break;
      case 'chart':
        lines.push(content || 'Grafico');
        if (Array.isArray(block.series)) {
          for (const item of block.series) lines.push(String(item?.label ?? '') + ': ' + String(item?.value ?? ''));
        }
        break;
      case 'image-block':
        if (content) lines.push('[imagen] ' + content);
        break;
      default:
        if (content) lines.push(content);
    }
  }
  return lines.join('\n').trim() + '\n';
}

function fence(lang, title) {
  return '```' + (lang || '') + '\n' + title;
}
function fenceEnd(lang) {
  return '```';
}

// El generador PDF solo embebe JPEG (DCTDecode); `normalizePdfImageSections`
// (core/pdf-images.js) re-encoda PNG/WebP/SVG a JPEG en canvas en navegador.
// En un entorno sin canvas las secciones se conservan tal cual y el generador
// dibuja su placeholder.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function rotateCanvas(imgOrCanvas, angle) {
  const c = imgOrCanvas instanceof HTMLCanvasElement ? imgOrCanvas : document.createElement('canvas');
  const ctx = c.getContext('2d');
  let w, h;
  if (imgOrCanvas instanceof HTMLCanvasElement) {
    w = imgOrCanvas.width; h = imgOrCanvas.height;
  } else {
    w = imgOrCanvas.naturalWidth; h = imgOrCanvas.naturalHeight;
  }
  const swap = angle === 90 || angle === 270;
  const cw = swap ? h : w;
  const ch = swap ? w : h;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const rctx = canvas.getContext('2d');
  rctx.translate(cw / 2, ch / 2);
  rctx.rotate(angle * Math.PI / 180);
  rctx.drawImage(imgOrCanvas instanceof HTMLCanvasElement ? imgOrCanvas : imgOrCanvas, -w / 2, -h / 2);
  return canvas;
}

function resizeCanvas(imgOrCanvas, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgOrCanvas, 0, 0, width, height);
  return canvas;
}

function enhanceCanvas(imgOrCanvas, contrast, brightness) {
  const w = imgOrCanvas instanceof HTMLCanvasElement ? imgOrCanvas.width : imgOrCanvas.naturalWidth;
  const h = imgOrCanvas instanceof HTMLCanvasElement ? imgOrCanvas.height : imgOrCanvas.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgOrCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, Math.max(0, ((d[i] / 255 - 0.5) * contrast + 0.5) * 255 * brightness));
    d[i + 1] = Math.min(255, Math.max(0, ((d[i + 1] / 255 - 0.5) * contrast + 0.5) * 255 * brightness));
    d[i + 2] = Math.min(255, Math.max(0, ((d[i + 2] / 255 - 0.5) * contrast + 0.5) * 255 * brightness));
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToBlob(source, format, quality) {
  return new Promise((resolve, reject) => {
    let canvas = source;
    // Convertir y comprimir parten de una HTMLImageElement; normalizarla a
    // canvas evita que el flujo falle antes de codificar la salida.
    if (typeof canvas?.toBlob !== 'function') {
      const width = source?.naturalWidth || source?.width;
      const height = source?.naturalHeight || source?.height;
      if (!width || !height) { reject(new Error('No se pudo preparar la imagen para codificar')); return; }
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(source, 0, 0, width, height);
    }
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob failed'));
    }, format || 'image/png', quality || 0.9);
  });
}

function outputFilename(name, mimeType, index) {
  const base = String(name || 'imagen-' + (index + 1)).replace(/\.[^.]+$/, '') || 'imagen-' + (index + 1);
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/png' ? 'png' : 'bin';
  return base + '.' + extension;
}

function createPdfBlob(imageW, imageH, jpegBytes) {
  const w = Math.round(imageW);
  const h = Math.round(imageH);
  const ptsW = (w * 72 / 96).toFixed(2);
  const ptsH = (h * 72 / 96).toFixed(2);
  const stream = 'q\n' + ptsW + ' 0 0 ' + ptsH + ' 0 0 cm\n/Im0 Do\nQ\n';
  const streamLen = stream.length;
  const imgLen = jpegBytes.length;

  const parts = [];
  function obj(n, content) { parts.push(n + ' 0 obj\n' + content + '\nendobj'); }

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptsW + ' ' + ptsH + '] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>');

  const contentStream = stream;
  const streamEsc = contentStream.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  obj(4, '<< /Length ' + streamLen + ' >>\nstream\n' + streamEsc + '\nendstream');

  const imgRef = '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + imgLen + ' >>';
  obj(5, imgRef + '\nstream\n' + new TextDecoder('latin1').decode(jpegBytes) + '\nendstream');

  const header = '%PDF-1.4\n';
  const body = parts.join('\n') + '\n';
  const offsets = [0];

  // Calculate byte offsets for each object
  let pos = header.length;
  const off1 = pos; pos += parts[0].length + 1; // \n
  const off2 = pos; pos += parts[1].length + 1;
  const off3 = pos; pos += parts[2].length + 1;
  const off4 = pos; pos += parts[3].length + 1;
  const off5 = pos; pos += parts[4].length + 1;

  // Actually let me build it properly
  const lines = [];
  lines.push('%PDF-1.4');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptsW + ' ' + ptsH + '] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj',
    '4 0 obj\n<< /Length ' + streamLen + ' >>\nstream\n' + stream + 'endstream\nendobj',
  ];
  const imgObj = '5 0 obj\n' + imgRef + '\nstream\n';
  const imgEnd = '\nendstream\nendobj';

  const head = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptsW + ' ' + ptsH + '] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n';
  const obj4 = '4 0 obj\n<< /Length ' + streamLen + ' >>\nstream\n' + stream + 'endstream\nendobj\n';
  const obj5start = '5 0 obj\n' + imgRef + '\nstream\n';
  const obj5end = '\nendstream\nendobj\n';

  // Calculate offsets
  let offset = head.length;
  const o1 = offset; offset += obj1.length;
  const o2 = offset; offset += obj2.length;
  const o3 = offset; offset += obj3.length;
  const o4 = offset; offset += obj4.length;
  const o5 = offset; offset += obj5start.length;
  const imgOff = offset; offset += imgLen;
  const o5end = offset; offset += obj5end.length;

  const xrefOff = offset;
  const xref = 'xref\n0 6\n0000000000 65535 f \n' +
    pad10(o1) + ' 00000 n \n' +
    pad10(o2) + ' 00000 n \n' +
    pad10(o3) + ' 00000 n \n' +
    pad10(o4) + ' 00000 n \n' +
    pad10(o5) + ' 00000 n \n';
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefOff + '\n%%EOF\n';

  // Build the final binary PDF
  const encoder = new TextEncoder();
  const headB = encoder.encode(head);
  const obj1B = encoder.encode(obj1);
  const obj2B = encoder.encode(obj2);
  const obj3B = encoder.encode(obj3);
  const obj4B = encoder.encode(obj4);
  const obj5StartB = encoder.encode(obj5start);
  const obj5EndB = encoder.encode(obj5end);
  const xrefB = encoder.encode(xref);
  const trailerB = encoder.encode(trailer);

  const totalLen = headB.length + obj1B.length + obj2B.length + obj3B.length + obj4B.length + obj5StartB.length + imgLen + obj5EndB.length + xrefB.length + trailerB.length;
  const result = new Uint8Array(totalLen);
  let ptr = 0;
  result.set(headB, ptr); ptr += headB.length;
  result.set(obj1B, ptr); ptr += obj1B.length;
  result.set(obj2B, ptr); ptr += obj2B.length;
  result.set(obj3B, ptr); ptr += obj3B.length;
  result.set(obj4B, ptr); ptr += obj4B.length;
  result.set(obj5StartB, ptr); ptr += obj5StartB.length;
  result.set(jpegBytes, ptr); ptr += imgLen;
  result.set(obj5EndB, ptr); ptr += obj5EndB.length;
  result.set(xrefB, ptr); ptr += xrefB.length;
  result.set(trailerB, ptr);

  return new Blob([result], { type: 'application/pdf' });
}

function pad10(n) {
  return String(n).padStart(10, '0');
}
