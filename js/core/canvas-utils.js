export function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    image.src = url;
  });
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('El navegador no pudo generar el archivo.')), mime, quality));
}

export function fillCanvas(ctx, canvas, mime) {
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export async function normalizeImageForPdf(file) {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return { blob:file, mime:file.type };
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image,0,0);
  return { blob:await canvasToBlob(canvas,'image/png',1), mime:'image/png' };
}

export function ensurePdfLib() {
  if (!window.PDFLib) throw new Error('No se pudo cargar el componente PDF. Revisa tu conexión e inténtalo de nuevo.');
}
