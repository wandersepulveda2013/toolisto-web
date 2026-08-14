/**
 * Resuelve la imagen de una captura sin exigir que la captura copie el PNG
 * corregido. Las capturas antiguas conservan `dataUrl`; las nuevas apuntan al
 * asset corregido persistido en el mismo proyecto.
 */
async function resolveCaptureImageDataUrl(capture, loadAsset) {
  if (!capture) return null;
  if (capture.dataUrl) return capture.dataUrl;
  if (!capture.correctedAssetId || typeof loadAsset !== 'function') return null;

  const correctedAsset = await loadAsset(capture.correctedAssetId);
  return correctedAsset?.dataUrl || correctedAsset?.originalDataUrl || null;
}

export { resolveCaptureImageDataUrl };
