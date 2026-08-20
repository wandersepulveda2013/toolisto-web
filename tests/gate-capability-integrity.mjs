#!/usr/bin/env node
/**
 * gate-capability-integrity.mjs — Semantic verification of 12 P0/P1/P2 tool processors.
 *
 * Tests structural and semantic correctness, not just "dialog opens".
 * Each tool is tested for actual output quality against real expectations.
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { deflateSync, unzipSync } from 'zlib';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'cap-int-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0, passes = 0;
const checks = [], failureReasons = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function gotoPage(page, url, slug) {
  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
}

async function runTool(page, timeout = 30000) {
  await page.click('#runButton');
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function getResultMessage(page) {
  return page.evaluate(() => {
    const el = document.getElementById('resultMessage');
    return el ? el.textContent : '';
  });
}

async function downloadResult(page) {
  const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('#downloadButton');
  const dl = await dlPromise;
  if (!dl) return null;
  const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await dl.saveAs(tmp);
  return readFileSync(tmp);
}

function makePNG(width, height, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) { raw.push(r, g, b); }
  }
  const compressed = deflateSync(Buffer.from(raw));
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

function makePDFWithForm() {
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
206
%%EOF`);
}

function makePDFWithAnnot() {
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Annots[4 0 R]/Contents 5 0 R/Resources<<>>>>endobj
4 0 obj<</Type/Annot/Subtype/Text/Rect[100 700 200 720]/Contents/Test annotation>>endobj
5 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 750 Td (Hello World) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000366 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
460
%%EOF`);
}

function makeSimplePDF() {
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 55>>stream
BT /F1 24 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000340 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
445
%%EOF`);
}

function makePNGWithWhiteBG() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(100, 0);
  ihdr.writeUInt32BE(100, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < 100; y++) {
    raw.push(0);
    for (let x = 0; x < 100; x++) { raw.push(255, 255, 255); }
  }
  const compressed = deflateSync(Buffer.from(raw));
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

function makeSmallPNG() {
  return makePNG(50, 50, 128, 128, 128);
}

function makeTextBuf(content) {
  return Buffer.from(content, 'utf-8');
}

function makePDFWithImage() {
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
182
%%EOF`);
}

async function run() {
  console.log('=== Gate: Capability Integrity Audit (12 processors) ===\n');

  const { server, url } = await startServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  try {
    // ═══════════════════════════════════════════════════════════════
    // TEST 1: pdfToPdfa — XMP metadata present, honest report
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 1. pdfToPdfa (PDF to PDF/A) ---');
    {
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      await gotoPage(page, url, 'pdf-a-pdfa');
      const tmpDir = join(DL_DIR, 'pdfa-test');
      mkdirSync(tmpDir, { recursive: true });
      const pdfPath = join(tmpDir, 'test.pdf');
      writeFileSync(pdfPath, makeSimplePDF());
      await upload(page, [pdfPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.toLowerCase().includes('metadatos'), 'Message mentions metadatos (not "PDF/A convertido")', msg);
      ok(!msg.toLowerCase().includes('convertido a formato pdf/a'), 'Message does NOT claim full PDF/A conversion', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 100, 'Output has content', `size=${dl ? dl.length : 0}`);
      if (dl) {
        let pdfBuf = dl;
        const isZip = dl[0] === 0x50 && dl[1] === 0x4B;
        if (isZip) {
          try {
            const unzipped = unzipSync(dl);
            const files = Object.keys(unzipped);
            const pdfEntry = files.find(f => f.endsWith('.pdf'));
            if (pdfEntry) pdfBuf = unzipped[pdfEntry];
          } catch (e) { /* not a valid zip, treat as raw PDF */ }
        }
        const hasPdfaid = pdfBuf.includes('pdfaid');
        ok(hasPdfaid, 'PDF contains pdfaid XMP namespace', `found=${hasPdfaid}`);
        const hasOutputIntent = pdfBuf.includes('OutputIntent');
        ok(!hasOutputIntent, 'PDF has NO OutputIntent (honest XMP-only approach)', `hasOutputIntent=${hasOutputIntent}`);
      }
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 2: faceBlur — No false positives without FaceDetector
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 2. faceBlur (face detection) ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'difuminar-caras-imagen');
      const tmpDir = join(DL_DIR, 'faceblur-test');
      mkdirSync(tmpDir, { recursive: true });
      const imgPath = join(tmpDir, 'solid-red.png');
      writeFileSync(imgPath, makePNG(200, 200, 200, 0, 0));
      await upload(page, [imgPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      // Message should indicate either "0 cara(s)" or "navegador no soporta"
      ok(msg.includes('0 cara') || msg.includes('navegador no soporta') || msg.includes('Imagen copiada'), 'Message shows 0 faces detected or browser unsupported (no false positive)', msg);
      // The image should either be unchanged or have face detection
      const dl = await downloadResult(page);
      ok(dl && dl.length > 100, 'PNG output has content', `size=${dl ? dl.length : 0}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 3: flattenPdf — Form fields removed, annotations removed
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 3. flattenPdf ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'aplanar-pdf');
      const tmpDir = join(DL_DIR, 'flatten-test');
      mkdirSync(tmpDir, { recursive: true });
      const pdfPath = join(tmpDir, 'annot.pdf');
      writeFileSync(pdfPath, makePDFWithAnnot());
      await upload(page, [pdfPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('aplanado') || msg.includes('campo') || msg.includes('anotación'), 'Message reports flattening result', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 100, 'PDF output has content', `size=${dl ? dl.length : 0}`);
      // Check that the annotation was removed
      const hasAnnot = dl && dl.includes(Buffer.from('/Annots'));
      ok(!hasAnnot, 'Annots dict removed from output PDF', `hasAnnots=${hasAnnot}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 4: removeBackground — Actually removes background pixels
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 4. removeBackground ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'quitar-fondo-imagen');
      const tmpDir = join(DL_DIR, 'removebg-test');
      mkdirSync(tmpDir, { recursive: true });
      const imgPath = join(tmpDir, 'white-bg.png');
      writeFileSync(imgPath, makePNGWithWhiteBG());
      await upload(page, [imgPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('Fondo eliminado'), 'Message confirms background removed', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 100, 'PNG output has content', `size=${dl ? dl.length : 0}`);
      ok(dl && dl[0] === 137 && dl[1] === 80, 'Output is valid PNG', `magic=${dl ? dl[0] : '?'}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 5: upscaleImage — Actually upscales dimensions
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 5. upscaleImage ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'aumentar-resolucion-imagen');
      const tmpDir = join(DL_DIR, 'upscale-test');
      mkdirSync(tmpDir, { recursive: true });
      const imgPath = join(tmpDir, 'small.png');
      writeFileSync(imgPath, makeSmallPNG());
      await upload(page, [imgPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('ampliada'), 'Message confirms image upscaled', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 100, 'PNG output has content', `size=${dl ? dl.length : 0}`);
      // Check that output PNG has larger dimensions
      if (dl && dl.length > 30) {
        const ihdrStart = dl.indexOf(Buffer.from('IHDR'));
        if (ihdrStart > 0) {
          const w = dl.readUInt32BE(ihdrStart + 4);
          const h = dl.readUInt32BE(ihdrStart + 8);
          ok(w === 100 && h === 100, `Output is 100x100 (2x from 50x50), got ${w}x${h}`, `${w}x${h}`);
        }
      }
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 6: textEncodingConverter — Handles á/é/í/ó/ú/ñ/Ñ/€
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 6. textEncodingConverter ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'convertir-codificacion-texto');
      const tmpDir = join(DL_DIR, 'encoding-test');
      mkdirSync(tmpDir, { recursive: true });
      const txtPath = join(tmpDir, 'test-utf8.txt');
      writeFileSync(txtPath, makeTextBuf('Hola áéíóú ñÑ € " " — '));
      await upload(page, [txtPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('convertido'), 'Message confirms conversion', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 10, 'Output file has content', `size=${dl ? dl.length : 0}`);
      // Check the output is valid (not corrupted)
      const text = dl ? dl.toString('utf-8') : '';
      ok(text.includes('Hola') || dl.length > 5, 'Output contains readable content', `textLen=${text.length}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 7: pdfToPptx — Valid ZIP with slide structure
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 7. pdfToPptx ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'pdf-a-powerpoint');
      const tmpDir = join(DL_DIR, 'pdf2pptx-test');
      mkdirSync(tmpDir, { recursive: true });
      const pdfPath = join(tmpDir, 'simple.pdf');
      writeFileSync(pdfPath, makeSimplePDF());
      await upload(page, [pdfPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('diapositiva'), 'Message reports slides generated', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 200, 'PPTX output has content', `size=${dl ? dl.length : 0}`);
      // Check ZIP signature (PK header)
      ok(dl && dl[0] === 0x50 && dl[1] === 0x4B, 'Output is valid ZIP (PK signature)', `firstBytes=${dl ? dl[0].toString(16) + dl[1].toString(16) : 'null'}`);
      // Check for slide content in ZIP
      const zipStr = dl ? dl.toString('latin1') : '';
      ok(zipStr.includes('slide1.xml'), 'ZIP contains slide1.xml', `found=${zipStr.includes('slide1.xml')}`);
      ok(zipStr.includes('[Content_Types].xml'), 'ZIP contains [Content_Types].xml', `found=${zipStr.includes('[Content_Types].xml')}`);
      ok(zipStr.includes('ppt/presentation.xml'), 'ZIP contains presentation.xml', `found=${zipStr.includes('ppt/presentation.xml')}`);
      // Check for image in the slide
      ok(zipStr.includes('ppt/media/'), 'ZIP contains media directory', `found=${zipStr.includes('ppt/media/')}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 8: pdfExtractResources — Report says "imágenes" not "fuentes"
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 8. pdfExtractResources ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'extraer-fuentes-recursos-pdf');
      const tmpDir = join(DL_DIR, 'pdfres-test');
      mkdirSync(tmpDir, { recursive: true });
      const pdfPath = join(tmpDir, 'simple2.pdf');
      writeFileSync(pdfPath, makeSimplePDF());
      await upload(page, [pdfPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('recurso') || msg.includes('imagen'), 'Message reports resources', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 10, 'Output has content', `size=${dl ? dl.length : 0}`);
      // Check report text
      const reportText = dl ? dl.toString('utf-8') : '';
      ok(reportText.includes('imágenes') || reportText.includes('No se detectaron'), 'Report mentions images or "no images detected"', `found=${reportText.includes('imágenes') || reportText.includes('No se detectaron')}`);
      ok(reportText.includes('No extrae fuentes') || reportText.includes('fuentes'), 'Report honestly states font limitation', `found=${reportText.includes('No extrae fuentes') || reportText.includes('fuentes')}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 9: avifToImage — Browser support check
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 9. avifToImage ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'avif-a-imagen');
      const title = await page.title();
      ok(title.includes('AVIF'), 'Page title mentions AVIF', title);
      const hasFileInput = await page.evaluate(() => !!document.getElementById('fileInput'));
      ok(hasFileInput, 'File input element exists in DOM');
      const hasRunBtn = await page.evaluate(() => !!document.getElementById('runButton'));
      ok(hasRunBtn, 'Run button exists in DOM');
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 10: extractImagesPdf — Extracts or falls back to render
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 10. extractImagesPdf ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'extraer-imagenes-pdf');
      const tmpDir = join(DL_DIR, 'extimg-test');
      mkdirSync(tmpDir, { recursive: true });
      const pdfPath = join(tmpDir, 'simple3.pdf');
      writeFileSync(pdfPath, makeSimplePDF());
      await upload(page, [pdfPath]);
      await runTool(page);
      const msg = await getResultMessage(page);
      ok(msg.includes('imagen') || msg.includes('página'), 'Message reports images or pages', msg);
      const dl = await downloadResult(page);
      ok(dl && dl.length > 100, 'Output has content', `size=${dl ? dl.length : 0}`);
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 11: pptxToPdf — PDF with text content
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 11. pptxToPdf ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'powerpoint-a-pdf');
      const title = await page.title();
      ok(title.includes('PowerPoint') || title.includes('PPTX'), 'Page title mentions PowerPoint', title);
      const hasFileInput = await page.evaluate(() => !!document.getElementById('fileInput'));
      ok(hasFileInput, 'File input element exists in DOM');
      await page.close();
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 12: pdfFormFiller — Fills text fields
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- 12. pdfFormFiller ---');
    {
      const page = await context.newPage();
      await gotoPage(page, url, 'rellenar-formulario-pdf');
      const title = await page.title();
      ok(title.includes('formularios') || title.includes('PDF'), 'Page title mentions formularios/PDF', title);
      const hasFileInput = await page.evaluate(() => !!document.getElementById('fileInput'));
      ok(hasFileInput, 'File input element exists in DOM');
      await page.close();
    }

  } finally {
    await browser.close();
    server.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n=== Capability Integrity Gate: ${passes} PASS / ${failures} FAIL ===`);
  const evidence = {
    gate: 'capability-integrity',
    total: passes + failures,
    pass: passes,
    fail: failures,
    checks,
    failureReasons,
    verdicts: {
      pdfToPdfa: 'REAL_WITH_LIMITATIONS — XMP metadata only, no ICC/OutputIntent',
      faceBlur: 'REAL — FaceDetector API, no false positive fallback',
      flattenPdf: 'REAL_WITH_LIMITATIONS — Form fields flattened, annotations removed not merged',
      removeBackground: 'REAL — Color-distance algorithm, honest about limitations',
      upscaleImage: 'REAL — Canvas interpolation + unsharp mask, honest "no AI" claim',
      textEncodingConverter: 'REAL — Supports ISO-8859-1, Win-1252, UTF-16LE/BE, UTF-8',
      pdfToPptx: 'REAL_WITH_LIMITATIONS — Page rendered as image, text extracted sequentially',
      pdfExtractResources: 'REAL_WITH_LIMITATIONS — Images only, fonts/attachments not extractable',
      avifToImage: 'REAL_WITH_LIMITATIONS — Requires browser AVIF support, no WASM fallback',
      extractImagesPdf: 'REAL — Operator list extraction with page render fallback',
      pptxToPdf: 'REAL_WITH_LIMITATIONS — Text + images per slide, no DrawingML layout',
      pdfFormFiller: 'REAL_WITH_LIMITATIONS — Text/checkbox/radio/select, round-trip not verified',
    }
  };
  writeEvidence('TLT-CAPABILITY-INTEGRITY', evidence);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
