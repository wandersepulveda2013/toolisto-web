import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

// Grab pad10 + createPdfBlob from workflow-operations.js source
const src = readFileSync(new URL('../../workspace/core/workflow-operations.js', import.meta.url), 'utf8');

function grabFn(source, name) {
  const lines = source.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

const pad10Src = grabFn(src, 'pad10');
const createPdfBlobSrc = grabFn(src, 'createPdfBlob');

// Verify dead code was removed
check('createPdfBlob has no "const header = " (dead)', !createPdfBlobSrc.includes("const header = '%PDF-1.4\\n'"));
check('createPdfBlob has no "const body = parts.join" (dead)', !createPdfBlobSrc.includes('const body = parts.join'));
check('createPdfBlob has no "const offsets = [0]" (dead)', !createPdfBlobSrc.includes('const offsets = [0]'));
check('createPdfBlob has no "let pos = header.length" (dead)', !createPdfBlobSrc.includes('let pos = header.length'));
check('createPdfBlob has no "const off1 = pos" (dead)', !createPdfBlobSrc.includes('const off1 = pos'));
check('createPdfBlob has no "const lines = []" (dead)', !createPdfBlobSrc.includes('const lines = []'));
check('createPdfBlob has no "const objects = [" (dead)', !createPdfBlobSrc.includes('const objects = ['));
check('createPdfBlob has no "const imgObj = " (dead)', !createPdfBlobSrc.includes('const imgObj = '));
check('createPdfBlob has no "const imgEnd = " (dead)', !createPdfBlobSrc.includes('const imgEnd = '));

// Verify live code still present
check('createPdfBlob has "const head = " (live)', createPdfBlobSrc.includes("const head = '%PDF-1.4\\n'"));
check('createPdfBlob has "const obj1 = " (live)', createPdfBlobSrc.includes("const obj1 = '1 0 obj"));
check('createPdfBlob has "const obj5start = " (live)', createPdfBlobSrc.includes('const obj5start ='));
check('createPdfBlob has "const xref = " (live)', createPdfBlobSrc.includes("const xref = 'xref"));
check('createPdfBlob has "return new Blob" (live)', createPdfBlobSrc.includes('return new Blob'));

// Build and execute the function
const fnBody = pad10Src + '\n' + createPdfBlobSrc + '\nreturn createPdfBlob;';
const createPdfBlob = new Function(fnBody)();

console.log('=== CE-122: createPdfBlob dead code removed (same output) ===');

// Functional test: build a PDF with a fake JPEG (small fake DCT marker)
const fakeJpeg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9]);
const blob = createPdfBlob(200, 100, fakeJpeg);

// Blob should be a Blob with pdf type
check('blob is Blob-like (has .type)', blob?.constructor?.name === 'Blob');
check('blob type is application/pdf', blob?.type === 'application/pdf');

// Extract bytes and validate PDF structure
const buf = await blob.arrayBuffer();
const bytes = new Uint8Array(buf);
const pdfStr = new TextDecoder('latin1').decode(bytes);

check('PDF starts with %PDF-1.4', pdfStr.startsWith('%PDF-1.4'));
check('PDF contains xref', pdfStr.includes('xref'));
check('PDF contains trailer', pdfStr.includes('trailer'));
check('PDF ends with %%EOF', pdfStr.trimEnd().endsWith('%%EOF'));
check('PDF contains /Type /Catalog', pdfStr.includes('/Type /Catalog'));
check('PDF contains /Type /Page', pdfStr.includes('/Type /Page'));
check('PDF contains /Filter /DCTDecode', pdfStr.includes('/Filter /DCTDecode'));
check('PDF embeds the JPEG data (0xFF 0xD8 present)', bytes[bytes.length - 30] === 0xFF || pdfStr.includes(String.fromCharCode(0xFF, 0xD8)));

// Byte size sanity: > 200 bytes for a minimal PDF with 5 objects
check('PDF size > 200 bytes', bytes.length > 200, 'got ' + bytes.length);

// No dead code remnants: check that there are no orphaned variables
check('no orphaned "header" const in fn', !createPdfBlobSrc.includes('header.length'));
check('no orphaned "lines" array in fn', !createPdfBlobSrc.includes('lines.push'));

console.log(`\n=== createPdfBlob-dead-code: ${pass}/${pass + fail} PASS ===`);
process.exit(fail > 0 ? 1 : 0);