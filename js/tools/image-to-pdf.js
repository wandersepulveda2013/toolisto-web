import { clamp, numberValue, valueOf, formatBytes, controlNumber, controlSelect } from '../core/utils.js';
import { ensurePdfLib, normalizeImageForPdf } from '../core/canvas-utils.js';

export const meta = {
  key: 'imagesPdf',
  icon: '▤',
  title: 'Imágenes a PDF',
  description: 'Crearemos un solo PDF respetando el orden visible.',
  accepts: 'images',
  category: 'pdf',
};

export function getControls() {
  return `
    ${controlSelect('pdfPageSize', 'Tamaño de página', [['a4','A4'],['letter','Carta'],['image','Ajustar a cada imagen']])}
    ${controlSelect('pdfOrientation', 'Orientación', [['auto','Automática'],['portrait','Vertical'],['landscape','Horizontal']])}
    ${controlNumber('pdfMargin', 'Margen (pt)', 24, 0, 100)}
  `;
}

export function validate(files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length !== files.length || images.length < 1) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
  return { ok: true, message: '' };
}

export async function run(state) {
  ensurePdfLib();
  const { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const pageSetting = valueOf('pdfPageSize', 'a4');
  const orientationSetting = valueOf('pdfOrientation', 'auto');
  const margin = clamp(numberValue('pdfMargin', 24), 0, 100);

  for (const file of state.files) {
    const normalized = await normalizeImageForPdf(file);
    const bytes = await normalized.blob.arrayBuffer();
    const embedded = normalized.mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const imgW = embedded.width;
    const imgH = embedded.height;
    let pageW, pageH;

    if (pageSetting === 'image') {
      pageW = imgW;
      pageH = imgH;
    } else {
      const base = pageSetting === 'letter' ? [612, 792] : [595.28, 841.89];
      const landscape = orientationSetting === 'landscape' || (orientationSetting === 'auto' && imgW > imgH);
      [pageW, pageH] = landscape ? [base[1], base[0]] : base;
    }

    const page = pdf.addPage([pageW, pageH]);
    const availableW = Math.max(1, pageW - margin * 2);
    const availableH = Math.max(1, pageH - margin * 2);
    const scale = Math.min(availableW / imgW, availableH / imgH, pageSetting === 'image' ? 1 : Infinity);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    page.drawImage(embedded, { x:(pageW-drawW)/2, y:(pageH-drawH)/2, width:drawW, height:drawH });
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type:'application/pdf' });
  return {
    blob,
    name: 'toolisto-imagenes.pdf',
    title: 'PDF creado',
    message: `Se generó un documento con ${state.files.length} página${state.files.length === 1 ? '' : 's'}.`,
    stats: [['Archivos',String(state.files.length)],['Páginas',String(state.files.length)],['Tamaño',formatBytes(blob.size)]],
  };
}
