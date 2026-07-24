import { clamp, numberValue, valueOf, extensionForMime, baseName, formatBytes, controlNumber, controlSelect } from '../core/utils.js';
import { loadImage, canvasToBlob, fillCanvas } from '../core/canvas-utils.js';

export const meta = {
  key: 'convert',
  icon: '⇄',
  title: 'Convertir imagen',
  description: 'Convertiremos las imágenes al formato elegido.',
  accepts: 'images',
  category: 'images',
};

export function getControls() {
  return `
    ${controlSelect('convertFormat', 'Formato de salida', [['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
    ${controlNumber('convertQuality', 'Calidad (%)', 86, 25, 100)}
    ${controlNumber('convertWidth', 'Ancho máximo (0 = conservar)', 0, 0, 10000)}
  `;
}

export function validate(files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length !== files.length || images.length < 1) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
  return { ok: true, message: '' };
}

export async function run(state) {
  if (!window.JSZip && state.files.length > 1) throw new Error('No se pudo cargar el componente para crear ZIP.');
  const mime = valueOf('convertFormat', 'image/webp');
  const quality = clamp(numberValue('convertQuality',86)/100,.25,1);
  const maxWidth = clamp(numberValue('convertWidth',0),0,10000);
  const converted = [];

  for (const file of state.files) {
    const image = await loadImage(file);
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    if (maxWidth > 0 && width > maxWidth) {
      height = Math.round(height * maxWidth / width);
      width = maxWidth;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha:mime !== 'image/jpeg' });
    fillCanvas(ctx, canvas, mime);
    ctx.drawImage(image,0,0,width,height);
    const blob = await canvasToBlob(canvas,mime,quality);
    converted.push({ blob, name:`${baseName(file.name)}.${extensionForMime(mime)}` });
  }

  if (converted.length === 1) {
    const single = converted[0];
    return {
      blob:single.blob,
      name:single.name,
      title:'Imagen convertida',
      message:`El archivo se convirtió a ${extensionForMime(mime).toUpperCase()}.`,
      preview:single.blob,
      stats:[['Formato',extensionForMime(mime).toUpperCase()],['Tamaño',formatBytes(single.blob.size)],['Archivos','1']],
    };
  }

  const zip = new window.JSZip();
  converted.forEach((item) => zip.file(item.name,item.blob));
  const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } });
  return {
    blob,
    name:'toolisto-imagenes-convertidas.zip',
    title:'Lote convertido',
    message:`Se convirtieron ${converted.length} imágenes y se reunieron en un ZIP.`,
    stats:[['Archivos',String(converted.length)],['Formato',extensionForMime(mime).toUpperCase()],['ZIP',formatBytes(blob.size)]],
  };
}
