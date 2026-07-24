import { clamp, numberValue, valueOf, extensionForMime, baseName, formatBytes, parseTargetKb, controlNumber, controlSelect } from '../core/utils.js';
import { loadImage, canvasToBlob, fillCanvas } from '../core/canvas-utils.js';

export const meta = {
  key: 'compress',
  icon: '↘',
  title: 'Reducir imagen',
  description: 'Reduciremos el peso conservando una calidad equilibrada.',
  accepts: 'image',
  category: 'images',
};

export function getControls(state) {
  const original = state.files[0]?.size || 0;
  const suggestedKb = Math.max(150, Math.min(1200, Math.round((original / 1024) * 0.58)));
  const targetFromIntent = parseTargetKb(state.intentValue || '');
  return `
    ${controlNumber('targetKb', 'Peso máximo objetivo (KB)', targetFromIntent || suggestedKb, 20, 10000)}
    ${controlSelect('compressFormat', 'Formato de salida', [['auto','Automático'],['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
    ${controlNumber('compressWidth', 'Ancho máximo (0 = automático)', 0, 0, 10000)}
    ${controlNumber('compressQuality', 'Calidad inicial (%)', 84, 25, 100)}
  `;
}

export function validate(files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length !== 1) return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
  return { ok: true, message: '' };
}

export async function run(state) {
  const file = state.files[0];
  const image = await loadImage(file);
  const targetBytes = clamp(numberValue('targetKb', 500), 20, 10000) * 1024;
  const requestedMime = valueOf('compressFormat', 'auto');
  const maxWidth = clamp(numberValue('compressWidth', 0), 0, 10000);
  const initialQuality = clamp(numberValue('compressQuality', 84) / 100, .25, 1);
  const mime = requestedMime === 'auto' ? (file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp') : requestedMime;

  let width = image.naturalWidth;
  let height = image.naturalHeight;
  if (maxWidth > 0 && width > maxWidth) {
    height = Math.round(height * maxWidth / width);
    width = maxWidth;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
  let blob = null;

  for (let scalePass = 0; scalePass < 7; scalePass++) {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    fillCanvas(ctx, canvas, mime);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (mime === 'image/png') {
      blob = await canvasToBlob(canvas, mime, 1);
    } else {
      let low = .22;
      let high = initialQuality;
      let best = await canvasToBlob(canvas, mime, low);
      for (let i = 0; i < 9; i++) {
        const quality = (low + high) / 2;
        const candidate = await canvasToBlob(canvas, mime, quality);
        if (candidate.size <= targetBytes) {
          best = candidate;
          low = quality;
        } else {
          high = quality;
        }
      }
      blob = best;
    }

    if (blob.size <= targetBytes || Math.min(width, height) < 320) break;
    const factor = Math.max(.62, Math.min(.92, Math.sqrt(targetBytes / blob.size) * .94));
    width *= factor;
    height *= factor;
  }

  const extension = extensionForMime(mime);
  return {
    blob,
    name: `${baseName(file.name)}-optimizada.${extension}`,
    title: 'Imagen optimizada',
    message: blob.size <= targetBytes ? 'La imagen quedó por debajo del peso máximo indicado.' : 'La imagen se redujo todo lo posible sin hacerla demasiado pequeña.',
    preview: blob,
    stats: [
      ['Antes', formatBytes(file.size)],
      ['Después', formatBytes(blob.size)],
      ['Reducción', `${Math.max(0, Math.round((1 - blob.size / file.size) * 100))}%`],
    ],
  };
}
