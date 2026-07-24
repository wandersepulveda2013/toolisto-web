import { clamp, numberValue, valueOf, hexToRgb, baseName, controlNumber, controlColor } from '../core/utils.js';
import { loadImage, canvasToBlob } from '../core/canvas-utils.js';

export const meta = {
  key: 'signature',
  icon: '✦',
  title: 'Firma transparente',
  description: 'Quitaremos el fondo claro y exportaremos un PNG transparente.',
  accepts: 'image',
  category: 'signatures',
};

export function getControls() {
  return `
    ${controlNumber('signatureThreshold', 'Blanco a eliminar', 215, 120, 250)}
    ${controlNumber('signatureSoftness', 'Suavidad del borde', 26, 1, 80)}
    ${controlColor('signatureInk', 'Color de tinta', '#173b62')}
    ${controlNumber('signaturePadding', 'Margen final (px)', 18, 0, 100)}
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
  const threshold = clamp(numberValue('signatureThreshold', 215), 120, 250);
  const softness = clamp(numberValue('signatureSoftness', 26), 1, 80);
  const ink = hexToRgb(valueOf('signatureInk', '#173b62'));
  const padding = clamp(numberValue('signaturePadding', 18), 0, 100);

  const source = document.createElement('canvas');
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(image, 0, 0);
  const imgData = sctx.getImageData(0, 0, source.width, source.height);
  const d = imgData.data;
  let minX = source.width, minY = source.height, maxX = -1, maxY = -1;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4;
      const brightness = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
      const alpha = clamp((threshold + softness - brightness) / (2 * softness), 0, 1);
      d[i] = ink.r;
      d[i + 1] = ink.g;
      d[i + 2] = ink.b;
      d[i + 3] = Math.round(alpha * 255);
      if (alpha > .08) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  sctx.putImageData(imgData, 0, 0);
  if (maxX < minX || maxY < minY) throw new Error('No se detectó suficiente tinta. Baja el nivel de blanco a eliminar.');

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const output = document.createElement('canvas');
  output.width = cropW + padding * 2;
  output.height = cropH + padding * 2;
  output.getContext('2d').drawImage(source, minX, minY, cropW, cropH, padding, padding, cropW, cropH);
  const blob = await canvasToBlob(output, 'image/png', 1);

  return {
    blob,
    name: `${baseName(file.name)}-firma-transparente.png`,
    title: 'Firma transparente lista',
    message: 'Se eliminó el fondo claro y se recortó el espacio sobrante.',
    preview: blob,
    stats: [['Formato','PNG'],['Dimensiones',`${output.width} × ${output.height}`],['Fondo','Transparente']],
  };
}
