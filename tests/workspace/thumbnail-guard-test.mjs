import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const m = src.match(new RegExp('function ' + name + '[\\s\\S]*?\\n\\}'));
  if (!m) throw new Error('no se encontro ' + name);
  return m[0];
}

const code = readFileSync(new URL('../../workspace/core/image-processor.js', import.meta.url), 'utf8');
const src = grabFn(code, 'createThumbnail');

let lastCreated = null;
const fakeCtx = {
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'low',
  drawImage() {},
};
const fakeDocument = {
  createElement(tag) {
    lastCreated = { tag, width: 0, height: 0, getContext: () => fakeCtx };
    return lastCreated;
  },
};

const createThumbnail = new Function('document', src + '\nreturn createThumbnail;')(fakeDocument);

console.log('=== CE-104: createThumbnail guarda contra dimensiones degradadas (0x0) ===');
console.log('(createThumbnail REAL; document stub)');

// 1. Imagen valida: produce una miniatura con dimensiones en proporcion ale la maxSize
{
  const thumb = createThumbnail({ width: 800, height: 600 }, 400);
  check('imagen valida produce un canvas no-nulo', thumb !== null);
  check('width <= maxSize', thumb.width <= 400, 'w=' + thumb.width);
  check('height <= maxSize', thumb.height <= 400, 'h=' + thumb.height);
  check('preserva proporcion 4:3', thumb.width / thumb.height === 400 / 300, String(thumb.width) + 'x' + String(thumb.height));
}

// 2. Dimension cero en un eje: retorna null (antes producia canvas 0xN o 0x0)
check('w=0 retorna null', createThumbnail({ width: 0, height: 100 }) === null);
check('h=0 retorna null', createThumbnail({ width: 100, height: 0 }) === null);
check('w=0 y h=0 retorna null', createThumbnail({ width: 0, height: 0 }) === null);

// 3. Dimension no finita: retorna null
check('w=NaN retorna null', createThumbnail({ width: NaN, height: 100 }) === null);
check('h=Infinity retorna null', createThumbnail({ width: 100, height: Infinity }) === null);

// 4. Miniatura pequena no se queda en 0 (clamp a >=1 en origen valido)
{
  const thumb = createThumbnail({ width: 2, height: 3 }, 400);
  check('2x3 valido da canvas con width>=1', thumb !== null && thumb.width === 2, thumb ? 'w=' + thumb.width : 'null');
  check('2x3 valido da canvas con height>=1', thumb !== null && thumb.height === 3, thumb ? 'h=' + thumb.height : 'null');
}

// 5. processImageCapture ya no crashea sobre una imagen que produce thumbnail null
{
  const captureSrc = grabFn(code, 'processImageCapture');
  const guarded = /thumbnailDataUrl:\s*thumbnail \? thumbnail\.toDataURL\([^)]*\) : ''/.test(captureSrc);
  check('processImageCapture guarda el thumbnail null (ternario, sin crashear)', guarded, captureSrc.split('\n')[10]?.trim() || '');
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);