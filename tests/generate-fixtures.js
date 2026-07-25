const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'fixtures');
fs.mkdirSync(out, { recursive: true });

// Minimal valid 1x1 red JPEG
function makeTinyJpeg(r, g, b) {
  return Buffer.from([
    0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
    0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
    0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
    0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,
    0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,
    0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
    0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x1F,0x00,0x00,0x01,0x05,0x01,0x01,
    0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,
    0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0xFF,0xC4,0x00,0xB5,0x10,0x00,0x02,0x01,0x03,
    0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,0x01,0x02,0x03,0x00,
    0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,
    0x81,0x91,0xA1,0x08,0x23,0x42,0xB1,0xC1,0x15,0x52,0xD1,0xF0,0x24,0x33,0x62,0x72,
    0x82,0x09,0x0A,0x16,0x17,0x18,0x19,0x1A,0x25,0x26,0x27,0x28,0x29,0x2A,0x34,0x35,
    0x36,0x37,0x38,0x39,0x3A,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x53,0x54,0x55,
    0x56,0x57,0x58,0x59,0x5A,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6A,0x73,0x74,0x75,
    0x76,0x77,0x78,0x79,0x7A,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x92,0x93,0x94,
    0x95,0x96,0x97,0x98,0x99,0x9A,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xB2,
    0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,
    0xCA,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,
    0xE7,0xE8,0xE9,0xEA,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFF,0xDA,
    0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0x7B,0x94,0x11,0x00,0x00,0x00,0x00,0xFF,
    0xD9
  ]);
}

// Minimal valid 2x2 PNG (red)
function makeTinyPng() {
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let cc = n;
      for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xEDB88320 ^ (cc >>> 1) : cc >>> 1;
      table[n] = cc;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcB = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcB));
    return Buffer.concat([len, typeB, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type (RGB)

  const raw = Buffer.alloc((2 * 3 + 1) * 2); // filter byte + RGB per row
  for (let y = 0; y < 2; y++) {
    raw[y * 7] = 0; // filter none
    for (let x = 0; x < 2; x++) {
      const i = y * 7 + 1 + x * 3;
      raw[i] = 255; raw[i + 1] = 0; raw[i + 2] = 0;
    }
  }
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// Minimal valid WebP (lossy, tiny)
function makeTinyWebP() {
  return Buffer.from([
    0x52,0x49,0x46,0x46,0x24,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x20,
    0x18,0x00,0x00,0x00,0x30,0x01,0x00,0x9D,0x01,0x2A,0x01,0x00,0x01,0x00,0x01,0x40,
    0x25,0xA4,0x00,0x03,0x70,0x00,0xFE,0xFB,0x94,0x00,0x00
  ]);
}

// Minimal valid BMP (2x2 red)
function makeTinyBmp() {
  return Buffer.from([
    0x42,0x4D,0x36,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x36,0x00,0x00,0x00,0x28,0x00,
    0x00,0x00,0x02,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x01,0x00,0x18,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF,0x00,0x00,0x00,0xFF,0x00,0x00,
    0x00,0xFF,0x00,0x00,0x00,0xFF
  ]);
}

// Text file renamed as .jpg (fake extension)
function makeFakeJpg() {
  return Buffer.from('This is a text file pretending to be a JPEG image.\nIt has no valid image data.\n', 'utf-8');
}

// Empty file
function makeEmptyFile() {
  return Buffer.alloc(0);
}

// Damaged JPEG (truncated)
function makeDamagedJpeg() {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
}

// Minimal valid PDF with content stream
function makeTinyPdf(pageCount) {
  const objects = [];
  let offset = 0;

  const header = '%PDF-1.4\n';
  offset = header.length;

  // Object 1: Catalog
  const obj1 = `${++objects.length} 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj1Start = offset; offset += obj1.length;

  // Object 2: Pages
  const kidRefs = [];
  for (let i = 0; i < pageCount; i++) {
    kidRefs.push(`${3 + i * 2} 0 R`);
  }
  const obj2 = `${++objects.length} 0 obj\n<< /Type /Pages /Kids [${kidRefs.join(' ')}] /Count ${pageCount} >>\nendobj\n`;
  const obj2Start = offset; offset += obj2.length;

  const pageObjs = [];
  const streamObjs = [];
  for (let i = 0; i < pageCount; i++) {
    const pageNum = i + 1;
    const contentRef = 3 + i * 2;
    const pageRef = 3 + i * 2 + 1;
    const streamContent = `BT /F1 12 Tf 100 700 Td (${pageNum}) Tj ET`;
    const streamObj = `${contentRef} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
    streamObjs.push({ obj: streamObj, start: offset });
    offset += streamObj.length;
    const pageObj = `${pageRef} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n`;
    pageObjs.push({ obj: pageObj, start: offset });
    offset += pageObj.length;
  }

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + pageCount * 2 + 1}\n0000000000 65535 f \n`;
  xref += String(obj1Start).padStart(10, '0') + ' 00000 n \n';
  xref += String(obj2Start).padStart(10, '0') + ' 00000 n \n';
  for (let i = 0; i < pageCount; i++) {
    xref += String(streamObjs[i].start).padStart(10, '0') + ' 00000 n \n';
    xref += String(pageObjs[i].start).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${objects.length + pageCount * 2 + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.concat([
    Buffer.from(header),
    Buffer.from(obj1),
    Buffer.from(obj2),
    ...streamObjs.map(po => Buffer.from(po.obj)),
    ...pageObjs.map(po => Buffer.from(po.obj)),
    Buffer.from(xref),
    Buffer.from(trailer),
  ]);
}

// Protected PDF (minimal, with Encrypt)
function makeProtectedPdf() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Encrypt 3 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (test) /U (test) /P -4 >>\nendobj\n4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000226 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n320\n%%EOF', 'ascii');
}

// 5-page PDF
function makeFivePagePdf() {
  return makeTinyPdf(5);
}

// 1-page PDF  
function makeOnePagePdf() {
  return makeTinyPdf(1);
}

// Two PDFs for merging
function makePdfA() {
  return makeTinyPdf(2);
}

function makePdfB() {
  return makeTinyPdf(3);
}

// PDF with rotated pages (horizontal + vertical)
function makeMixedOrientationPdf() {
  // Simple 2-page PDF with different MediaBox
  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n'; // portrait
  const obj4 = '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] >>\nendobj\n'; // landscape

  const sizes = [header, obj1, obj2, obj3, obj4];
  const offsets = [];
  let off = 0;
  for (const s of sizes) { offsets.push(off); off += s.length; }
  const xrefStart = off;

  let xref = 'xref\n0 5\n0000000000 65535 f \n';
  for (let i = 1; i <= 4; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.concat(sizes.map(s => Buffer.from(s)).concat([Buffer.from(xref), Buffer.from(trailer)]));
}

console.log('Generating test fixtures...');

// Images
fs.writeFileSync(path.join(out, 'horizontal.jpg'), makeTinyJpeg());
fs.writeFileSync(path.join(out, 'tiny.png'), makeTinyPng());
fs.writeFileSync(path.join(out, 'tiny.webp'), makeTinyWebP());
fs.writeFileSync(path.join(out, 'tiny.bmp'), makeTinyBmp());
fs.writeFileSync(path.join(out, 'fake.jpg'), makeFakeJpg());
fs.writeFileSync(path.join(out, 'empty.jpg'), makeEmptyFile());
fs.writeFileSync(path.join(out, 'damaged.jpg'), makeDamagedJpeg());

// PDFs
fs.writeFileSync(path.join(out, 'one-page.pdf'), makeOnePagePdf());
fs.writeFileSync(path.join(out, 'five-pages.pdf'), makeFivePagePdf());
fs.writeFileSync(path.join(out, 'merge-a.pdf'), makePdfA());
fs.writeFileSync(path.join(out, 'merge-b.pdf'), makePdfB());
fs.writeFileSync(path.join(out, 'mixed-orientation.pdf'), makeMixedOrientationPdf());
fs.writeFileSync(path.join(out, 'protected.pdf'), makeProtectedPdf());

console.log('Test fixtures generated in tests/fixtures/:');
console.log('');
console.log('IMAGES:');
console.log('  horizontal.jpg - 1x1 JPEG');
console.log('  tiny.png - 2x2 red PNG');
console.log('  tiny.webp - WebP');
console.log('  tiny.bmp - BMP');
console.log('  fake.jpg - text file renamed as JPG');
console.log('  empty.jpg - empty file');
console.log('  damaged.jpg - truncated JPEG');
console.log('');
console.log('PDFs:');
console.log('  one-page.pdf - 1-page PDF');
console.log('  five-pages.pdf - 5-page PDF');
console.log('  merge-a.pdf - 2-page PDF');
console.log('  merge-b.pdf - 3-page PDF');
console.log('  mixed-orientation.pdf - portrait + landscape');
console.log('  protected.pdf - password-protected PDF');
