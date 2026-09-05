import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('sin final para ' + name);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');

const helperSrc = grabFn(wsCode, 'captureDownloadFileName');
const helper = new Function('return (' + helperSrc + ');')();

console.log('=== CE-135: descarga individual de captura como imagen ===');
console.log('(captureDownloadFileName REAL de workspace.js + anclas estaticas del boton Descargar)');
console.log('');

console.log('--- 1. Nombre de archivo seguro (helper puro) ---');

check('nombre: captura con nombre + dataUrl png -> nombre.png', helper({ name: 'recibo', id: 'c1' }, 'data:image/png;base64,AAA') === 'recibo.png');
check('nombre: jpeg se conviere a .jpg', helper({ name: 'escaneo', id: 'c1' }, 'data:image/jpeg;base64,AAA') === 'escaneo.jpg');
check('nombre: dataUrl con imagen/jpg tambien .jpg', helper({ name: 'x', id: 'c1' }, 'data:image/jpg;base64,AAA') === 'x.jpg');
check('nombre: webp conserva .webp', helper({ name: 'gif', id: 'c1' }, 'data:image/webp;base64,AAA') === 'gif.webp');
check('nombre: gif conserva .gif', helper({ name: 'gif', id: 'c1' }, 'data:image/gif;base64,AAA') === 'gif.gif');
check('nombre: avif conserva .avif', helper({ name: 'x', id: 'c1' }, 'data:image/avif;base64,AAA') === 'x.avif');
check('nombre: MIME desconocido -> fallback .png', helper({ name: 'x', id: 'c1' }, 'data:application/octet-stream;base64,AAA') === 'x.png');
check('nombre: sin dataUrl -> fallback .png', helper({ name: 'x', id: 'c1' }, '') === 'x.png');
check('nombre: caracteres invalidos se sanitizan y los guiones finales se recortan', helper({ name: 'a/b:c*?"<>|', id: 'c1' }, 'data:image/png;base64,AAA') === 'a-b-c.png');
check('nombre: nombre vacio con id usa captura-<id>', helper({ name: '', id: 'c1' }, 'data:image/png;base64,AAA') === 'captura-c1.png');
check('nombre: sin nombre usa captura-<id>', helper({ id: 'c42' }, 'data:image/png;base64,AAA') === 'captura-c42.png');
check('nombre: captura null -> captura.png', helper(null, 'data:image/png;base64,AAA') === 'captura.png');
check('nombre: id vacio sin nombre -> captura.png', helper({ id: '' }, 'data:image/png;base64,AAA') === 'captura.png');

console.log('');
console.log('--- 2. Boton Descargar en la tarjeta de captura (anclas estaticas) ---');

const cardSrc = wsCode.slice(wsCode.indexOf('function renderCaptureView'), wsCode.indexOf('function captureDownloadFileName') > -1 ? wsCode.indexOf('function formatCaptureDeletionWarning') : wsCode.length);
check('boton: existe un boton "Descargar" con icono download', /svgIcon\('download'\)\s*,\s*' Descargar'/.test(cardSrc));
check('boton: el manejador es async y detiene la propagacion', /onClick: async \(e\) => \{[\s\S]*?e\.stopPropagation\(\)/.test(cardSrc));
check('boton: resuelve el dataUrl via resolveCaptureImageDataUrl(cap, loadAsset)', /resolveCaptureImageDataUrl\(cap, loadAsset\)/.test(cardSrc));
check('boton: sin imagen avisa sin descargar', /if \(!imageUrl\) \{[\s\S]*?toast\('Esta captura no tiene imagen que descargar', 'warning'\); return; \}/.test(cardSrc));
check('boton: convierte a Blob y crea objeto URL', /fetch\(imageUrl\)\)\.blob\(\)/.test(cardSrc) && /URL\.createObjectURL\(blob\)/.test(cardSrc));
check('boton: usa captureDownloadFileName para el name del archivo', /download: captureDownloadFileName\(cap, imageUrl\)/.test(cardSrc));
check('boton: dispara el click del ancla y revoca el URL', /a\.click\(\);[\s\S]*?URL\.revokeObjectURL\(url\)/.test(cardSrc));
check('boton: toast de exito', /toast\('Captura descargada', 'success'\)/.test(cardSrc));
check('boton: falla reporta capture-download y toast de error', /reportError\(error, 'capture-download'[\s\S]*?toast\('No se pudo descargar la captura', 'error'\)/.test(cardSrc));
check('boton: la fila conserva las demas acciones', /extractBtn, dupBtn, flowBtn, downloadBtn, renameBtn, delBtn/.test(cardSrc));
check('boton: el helper de nombre este definido en workspace.js', /function captureDownloadFileName\(/.test(wsCode));
check('boton: el icono download existe en el mapa svgIcon', /download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"\/>/.test(wsCode));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);