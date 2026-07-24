import { formatBytes } from '../core/utils.js';
import { ensurePdfLib } from '../core/canvas-utils.js';

export const meta = {
  key: 'mergePdf',
  icon: '⊕',
  title: 'Unir PDF',
  description: 'Combinaremos los PDF en el orden visible.',
  accepts: 'pdfs',
  category: 'pdf',
};

export function getControls() {
  return `
    <div class="control" style="grid-column:1/-1"><label>Orden final</label><div style="color:var(--muted);font-size:.9rem">Usaremos el orden visible en la lista. Puedes mover cada archivo con las flechas.</div></div>
  `;
}

export function validate(files) {
  const pdfs = files.filter((f) => f.type === 'application/pdf');
  if (pdfs.length !== files.length || pdfs.length < 1) return { ok: false, message: 'Selecciona uno o varios archivos PDF.' };
  return { ok: true, message: '' };
}

export async function run(state) {
  ensurePdfLib();
  const { PDFDocument } = window.PDFLib;
  const merged = await PDFDocument.create();
  let pageCount = 0;

  for (const file of state.files) {
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
    pageCount += pages.length;
  }

  const bytes = await merged.save();
  const blob = new Blob([bytes], { type:'application/pdf' });
  return {
    blob,
    name: 'toolisto-pdf-unido.pdf',
    title: 'PDF combinado',
    message: 'Los documentos se unieron respetando el orden visible.',
    stats: [['Documentos',String(state.files.length)],['Páginas',String(pageCount)],['Tamaño',formatBytes(blob.size)]],
  };
}
