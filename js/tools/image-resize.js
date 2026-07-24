import { clamp, numberValue, valueOf, extensionForMime, baseName, formatBytes, controlNumber, controlSelect } from '../core/utils.js';
import { loadImage, canvasToBlob, fillCanvas } from '../core/canvas-utils.js';

export const meta = {
  key: 'crop',
  icon: '⌗',
  title: 'Recortar y redimensionar',
  description: 'Prepararemos la imagen con dimensiones exactas.',
  accepts: 'image',
  category: 'images',
};

const PRESET_SIZES = {
  square: [1080, 1080],
  tiktok: [1080, 1920],
  twoByTwo: [600, 600],
  visa: [413, 531],
};

export function getControls() {
  return `
    ${controlSelect('cropPreset', 'Formato', [['square','Cuadrada 1080 × 1080'],['tiktok','TikTok / Reels 1080 × 1920'],['twoByTwo','Foto 2 × 2 · 600 × 600'],['visa','35 × 45 mm · 413 × 531'],['custom','Personalizado']])}
    ${controlSelect('cropFormat', 'Formato de salida', [['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
    ${controlNumber('cropWidth', 'Ancho personalizado (px)', 1080, 50, 8000)}
    ${controlNumber('cropHeight', 'Alto personalizado (px)', 1080, 50, 8000)}
    ${controlNumber('cropZoom', 'Zoom (%)', 100, 100, 300)}
    ${controlNumber('cropOffsetX', 'Mover horizontal (%)', 0, -100, 100)}
    ${controlNumber('cropOffsetY', 'Mover vertical (%)', 0, -100, 100)}
  `;
}

export function attachListeners() {
  const preset = document.getElementById('cropPreset');
  if (preset) preset.addEventListener('change', syncCropPreset);
}

function syncCropPreset() {
  const preset = document.getElementById('cropPreset')?.value;
  if (PRESET_SIZES[preset]) {
    document.getElementById('cropWidth').value = PRESET_SIZES[preset][0];
    document.getElementById('cropHeight').value = PRESET_SIZES[preset][1];
  }
}

export function validate(files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length !== 1) return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
  return { ok: true, message: '' };
}

export async function run(state) {
  const file = state.files[0];
  const image = await loadImage(file);
  const preset = valueOf('cropPreset', 'square');
  const [targetW, targetH] = PRESET_SIZES[preset] || [clamp(numberValue('cropWidth',1080),50,8000), clamp(numberValue('cropHeight',1080),50,8000)];
  const mime = valueOf('cropFormat', 'image/jpeg');
  const zoom = clamp(numberValue('cropZoom',100)/100,1,3);
  const offsetX = clamp(numberValue('cropOffsetX',0)/100,-1,1);
  const offsetY = clamp(numberValue('cropOffsetY',0)/100,-1,1);

  const targetRatio = targetW / targetH;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  let cropW, cropH;
  if (imageRatio > targetRatio) {
    cropH = image.naturalHeight / zoom;
    cropW = cropH * targetRatio;
  } else {
    cropW = image.naturalWidth / zoom;
    cropH = cropW / targetRatio;
  }
  cropW = Math.min(cropW, image.naturalWidth);
  cropH = Math.min(cropH, image.naturalHeight);
  const maxX = (image.naturalWidth - cropW) / 2;
  const maxY = (image.naturalHeight - cropH) / 2;
  const sx = maxX + offsetX * maxX;
  const sy = maxY + offsetY * maxY;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,targetW,targetH);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, targetW, targetH);
  const blob = await canvasToBlob(canvas, mime, .92);

  return {
    blob,
    name: `${baseName(file.name)}-${targetW}x${targetH}.${extensionForMime(mime)}`,
    title: 'Imagen preparada',
    message: `La imagen se recortó y exportó a ${targetW} × ${targetH} píxeles.`,
    preview: blob,
    stats: [['Dimensiones',`${targetW} × ${targetH}`],['Formato',extensionForMime(mime).toUpperCase()],['Tamaño',formatBytes(blob.size)]],
  };
}
