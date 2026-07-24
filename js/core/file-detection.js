import { getFormatInfo, isFormatProcessable } from './format-registry.js';

const MAGIC_BYTES = {
  jpeg:     { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
  png:      { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] },
  gif:      { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  bmp:      { offset: 0, bytes: [0x42, 0x4D] },
  pdf:      { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  tiff_le:  { offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] },
  tiff_be:  { offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] },
  webp:     { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  zip:      { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },
};

const EXT_MAP = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif',
  bmp: 'bmp', svg: 'svg', avif: 'avif', heic: 'heic', heif: 'heif',
  tiff: 'tiff', tif: 'tiff', pdf: 'pdf',
  docx: 'docx', docm: 'docx', dotx: 'docx',
  xlsx: 'xlsx', xlsm: 'xlsx', xlsb: 'xlsx', xls: 'xls',
  pptx: 'pptx', ppt: 'ppt',
  txt: 'txt', md: 'md', csv: 'csv', json: 'json',
  xml: 'xml', html: 'html', htm: 'html',
  zip: 'zip',
};

const MIME_MAP = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/tiff': 'tiff', 'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html',
  'text/markdown': 'md', 'application/json': 'json', 'application/xml': 'xml',
};

const CATEGORIES = {
  jpeg: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image',
  svg: 'image', avif: 'image', heic: 'image', heif: 'image', tiff: 'image',
  pdf: 'pdf',
  docx: 'document', txt: 'text', md: 'text', html: 'text',
  csv: 'spreadsheet', xlsx: 'spreadsheet', xls: 'spreadsheet', json: 'text', xml: 'text',
};

function getExtension(name) {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function matchesMagic(buffer, signature) {
  const view = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  for (let i = 0; i < signature.bytes.length; i++) {
    if (view[signature.offset + i] !== signature.bytes[i]) return false;
  }
  return true;
}

async function readHeader(file, bytes) {
  const header = file.slice(0, bytes);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsArrayBuffer(header);
  });
}

function detectByMagic(buffer) {
  const view = new Uint8Array(buffer);

  if (matchesMagic(buffer, MAGIC_BYTES.jpeg)) return 'jpeg';
  if (matchesMagic(buffer, MAGIC_BYTES.png)) return 'png';
  if (matchesMagic(buffer, MAGIC_BYTES.gif)) return 'gif';
  if (matchesMagic(buffer, MAGIC_BYTES.bmp)) return 'bmp';
  if (matchesMagic(buffer, MAGIC_BYTES.pdf)) return 'pdf';
  if (matchesMagic(buffer, MAGIC_BYTES.tiff_le) || matchesMagic(buffer, MAGIC_BYTES.tiff_be)) return 'tiff';

  if (matchesMagic(buffer, MAGIC_BYTES.webp)) {
    if (view.length >= 12 && view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) return 'webp';
    return null;
  }

  if (matchesMagic(buffer, MAGIC_BYTES.zip)) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, Math.min(buffer.byteLength, 4096)));
    if (text.includes('word/')) return 'docx';
    if (text.includes('xl/')) return 'xlsx';
    if (text.includes('ppt/')) return 'pptx';
    if (text.includes('[Content_Types].xml')) return null;
    return 'zip';
  }

  const textHead = new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, Math.min(buffer.byteLength, 512))).toLowerCase();
  if (textHead.match(/<svg[\s>]/)) return 'svg';
  if (textHead.match(/<\?xml|<html|<!doctype/)) return null;

  if (view.length >= 12 && view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) {
    const brand = new TextDecoder('ascii').decode(buffer.slice(8, 12)).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix') return 'heic';
    if (brand === 'heif' || brand === 'mif1') return 'heif';
    if (brand === 'mif1') return 'heif';
  }

  return null;
}

function isTextFile(format) {
  return ['txt', 'md', 'csv', 'json', 'xml', 'html'].includes(format);
}

function isImage(format) {
  return CATEGORIES[format] === 'image';
}

function isPdf(format) {
  return format === 'pdf';
}

function isDocument(format) {
  return CATEGORIES[format] === 'document' || CATEGORIES[format] === 'spreadsheet' || CATEGORIES[format] === 'text';
}

export async function detectFile(file) {
  const ext = getExtension(file.name);
  const extFormat = EXT_MAP[ext] || null;
  const mimeFormat = MIME_MAP[file.type] || null;

  let magicFormat = null;
  let headerBuffer = null;

  try {
    headerBuffer = await readHeader(file, 4096);
    magicFormat = detectByMagic(headerBuffer);
  } catch (_) {}

  const format = magicFormat || mimeFormat || extFormat || 'unknown';
  const category = CATEGORIES[format] || 'unknown';
  const processable = isFormatProcessable(format);

  return {
    file,
    format,
    category,
    ext,
    mime: file.type,
    isImage: isImage(format),
    isPdf: isPdf(format),
    isText: isTextFile(format),
    isDocument: isDocument(format),
    canProcessWithTools: processable,
    displayName: format === 'unknown' ? ext || file.type || 'desconocido' : format.toUpperCase(),
  };
}

export function detectFiles(files) {
  return Promise.all([...files].map(f => detectFile(f)));
}
