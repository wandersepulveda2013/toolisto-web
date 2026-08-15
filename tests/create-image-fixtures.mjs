import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

function createPNG(width, height, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (1 + width * 3) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }

  const compressed = deflateSync(raw);
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

const fixtures = [
  ['test-10x10.png', 10, 10, 255, 128, 0],
  ['test-200x100.png', 200, 100, 0, 100, 200],
  ['test-alpha.png', 50, 50, 200, 50, 50],
];

for (const [name, w, h, r, g, b] of fixtures) {
  const buf = createPNG(w, h, r, g, b);
  writeFileSync(join(fixturesDir, name), buf);
  console.log(`Created ${name}: ${buf.length} bytes (${w}x${h})`);
}

console.log('All image fixtures created.');
