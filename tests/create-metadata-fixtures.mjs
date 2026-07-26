import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, 'fixtures');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

// Minimal JPEG 1x1 pixel with EXIF (camera + author)
function createExifJpeg() {
  const e = new TextEncoder();

  // Build EXIF IFD0 as raw bytes (little-endian)
  function buildIfd(tags) {
    const entries = [];
    const extraData = [];
    let extraOffset = 0;

    for (const [tagId, type, value] of tags) {
      const entry = new Uint8Array(12);
      const dv = new DataView(entry.buffer);
      dv.setUint16(0, tagId, true);
      dv.setUint16(2, type, true);

      if (type === 2) {
        const bytes = e.encode(value + '\0');
        dv.setUint32(4, bytes.length, true);
        if (bytes.length <= 4) {
          entry.set(bytes, 8);
        } else {
          dv.setUint32(8, extraOffset, true);
          extraData.push(bytes);
          extraOffset += bytes.length;
        }
      } else if (type === 3) {
        dv.setUint32(4, 1, true);
        dv.setUint16(8, value, true);
      }
      entries.push(entry);
    }

    const countBuf = new Uint8Array(2);
    new DataView(countBuf.buffer).setUint16(0, tags.length, true);

    const ifd = new Uint8Array(2 + entries.length * 12 + 4);
    let p = 0;
    ifd.set(countBuf, p); p += 2;
    for (const ent of entries) { ifd.set(ent, p); p += 12; }
    // next IFD offset = 0
    new DataView(ifd.buffer).setUint32(p, 0, true);

    const dataSection = new Uint8Array(extraData.reduce((s, a) => s + a.length, 0));
    let dp = 0;
    for (const d of extraData) { dataSection.set(d, dp); dp += d.length; }

    const full = new Uint8Array(ifd.length + dataSection.length);
    full.set(ifd, 0);
    full.set(dataSection, ifd.length);
    return full;
  }

  const ifd = buildIfd([
    [0x010F, 2, 'Canon Test'],        // Make
    [0x0110, 2, 'EOS R50'],            // Model
    [0x0131, 2, 'Toolisto Test'],      // Software
    [0x013B, 2, 'Test Author'],        // Artist
    [0x8298, 2, 'Copyright 2024'],     // Copyright
    [0x0112, 3, 1],                    // Orientation
  ]);

  const exifStr = e.encode('Exif\0\0');
  const bo = new Uint8Array([0x49, 0x49]); // little-endian
  const exifPayload = new Uint8Array(exifStr.length + bo.length + ifd.length);
  exifPayload.set(exifStr, 0);
  exifPayload.set(bo, exifStr.length);
  exifPayload.set(ifd, exifStr.length + bo.length);

  const segLen = exifPayload.length + 2;
  const app1 = new Uint8Array(4 + segLen);
  app1[0] = 0xFF; app1[1] = 0xE1;
  new DataView(app1.buffer).setUint16(2, segLen, true);
  app1.set(exifPayload, 4);

  // Minimal JPEG: 1x1 pixel, grayscale
  const rest = new Uint8Array([
    0xFF, 0xD8,                         // SOI (inserted before APP1)
    // After APP1:
    0xFF, 0xC0, 0x00, 0x0B,            // SOF0, length=11
    0x08,                               // 8-bit
    0x00, 0x01,                         // height=1
    0x00, 0x01,                         // width=1
    0x01,                               // 1 component
    0x01, 0x11, 0x00,                   // comp1: h=1 v=1 qt=0
    0xFF, 0xDB, 0x00, 0x43,            // DQT, length=67
    0x00,                               // table 0
    ...Array(64).fill(1),              // quantization values
    0xFF, 0xC4, 0x00, 0x1F,            // DHT, length=31
    0x00,                               // DC table 0
    ...Array(16).fill(0).map((_, i) => i === 0 ? 1 : 0), // bit lengths
    0x00,                               // values
    0xFF, 0xDA, 0x00, 0x08,            // SOS, length=8
    0x01,                               // 1 component
    0x01,                               // comp1, dc=0 ac=0
    0x00, 0x00, 0x3F, 0x00,            // spectral selection
    0x7B, 0x40,                         // approx bit position
    0xFF, 0xD9,                         // EOI
  ]);

  const soi = new Uint8Array([0xFF, 0xD8]);
  const jpeg = new Uint8Array(soi.length + app1.length + rest.length - 2); // -2 because rest starts with SOI
  let p = 0;
  jpeg.set(soi, p); p += soi.length;
  jpeg.set(app1, p); p += app1.length;
  jpeg.set(rest.slice(2), p); // skip SOI from rest

  writeFileSync(join(dir, 'test-exif.jpg'), jpeg);
  console.log(`Created test-exif.jpg (${jpeg.length} bytes)`);
}

// Minimal MP3 with ID3v2.4 tag
function createMp3WithId3() {
  const e = new TextEncoder();

  function frame(id, text) {
    const bytes = e.encode(text);
    const f = new Uint8Array(10 + 1 + bytes.length);
    e.encode(id).forEach((b, i) => f[i] = b);
    const size = 1 + bytes.length;
    f[4] = (size >> 24) & 0xFF;
    f[5] = (size >> 16) & 0xFF;
    f[6] = (size >> 8) & 0xFF;
    f[7] = size & 0xFF;
    f[10] = 0x03; // UTF-8
    f.set(bytes, 11);
    return f;
  }

  const frames = new Uint8Array([
    ...frame('TIT2', 'Canción de Prueba'),
    ...frame('TPE1', 'Artista Test'),
    ...frame('TALB', 'Álbum Test'),
    ...frame('TCON', 'Rock'),
    ...frame('TDRC', '2024'),
    ...frame('COMM', 'Comentario interno de prueba'),
  ]);

  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33;
  header[3] = 4; // v2.4.0
  header[5] = (frames.length >> 21) & 0x7F;
  header[6] = (frames.length >> 14) & 0x7F;
  header[7] = (frames.length >> 7) & 0x7F;
  header[8] = frames.length & 0x7F;

  const mp3 = new Uint8Array(header.length + frames.length);
  mp3.set(header, 0);
  mp3.set(frames, header.length);

  writeFileSync(join(dir, 'test-id3.mp3'), mp3);
  console.log(`Created test-id3.mp3 (${mp3.length} bytes)`);
}

createExifJpeg();
createMp3WithId3();
console.log('Metadata fixtures created.');
