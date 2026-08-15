// gate-e2e-av-tools.mjs — Certificación E2E de 9 herramientas de audio/vídeo (FFmpeg.wasm)
// sobre el deployment real en dist/. Genera fixtures de audio WAV y vídeo WebM (con pista de
// audio) con FFmpeg real en el navegador, procesa con la UI real y valida los resultados
// descargados (magic bytes + streams/duration leídos por FFmpeg).
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright-core';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'avtools-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0;
let passes = 0;
const checks = [];
const failureReasons = [];
const consoleErrors = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }

function magic(buf) {
  if (buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.length > 8 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length > 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3';
  if (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return 'unknown';
}

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.xml': 'application/xml',
    '.wasm': 'application/wasm', '.traineddata.gz': 'application/octet-stream',
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
  await page.waitForTimeout(200);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 30000 });
}

async function waitDialog(page, timeout = 90000) {
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function runTool(page) {
  await page.click('#runButton');
  await waitDialog(page);
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(100);
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

async function resultMessage(page) {
  return page.$eval('#resultMessage', (el) => el.textContent).catch(() => null);
}

/* ── Fixtures AV generados con FFmpeg real (lavfi) en el navegador ─────── */

async function genAvFixtures(page) {
  return page.evaluate(async () => {
    const ffmpeg = await window.EngineLoader.loadFFmpeg();
    const mk = async (args, out) => {
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(out);
      const u = data instanceof Uint8Array ? data : new Uint8Array(data);
      let bin = '';
      for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
      return btoa(bin);
    };
    const audio1 = await mk(
      ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=1.4', '-c:a', 'pcm_s16le', 'a1.wav'],
      'a1.wav',
    );
    const audio2 = await mk(
      ['-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=44100:duration=1.4', '-c:a', 'pcm_s16le', 'a2.wav'],
      'a2.wav',
    );
    const video1 = await mk(
      ['-f', 'lavfi', '-i', 'testsrc=duration=1.4:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.4', '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', 'v1.webm'],
      'v1.webm',
    );
    const video2 = await mk(
      ['-f', 'lavfi', '-i', 'testsrc=duration=1.4:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=1.4', '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', 'v2.webm'],
      'v2.webm',
    );
    return { audio1, audio2, video1, video2 };
  });
}

/* ── Prospección de medios con FFmpeg real (streams + duration) ────────── */

async function probeMedia(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const ffmpeg = await window.EngineLoader.loadFFmpeg();
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await ffmpeg.writeFile('probe.bin', u);
    const logs = [];
    const cb = (d) => logs.push(typeof d === 'string' ? d : (d && d.message) || String(d));
    ffmpeg.on('log', cb);
    let ret = -1;
    try { ret = await ffmpeg.exec(['-i', 'probe.bin']); } catch (e) { ret = -1; }
    ffmpeg.off('log', cb);
    try { await ffmpeg.deleteFile('probe.bin'); } catch (e) {}
    const text = logs.join('\n');
    const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + (+dur[3]) : null;
    return {
      ret,
      duration,
      hasVideo: /Stream #0:\d[^\n]*Video:/i.test(text),
      hasAudio: /Stream #0:\d[^\n]*Audio:/i.test(text),
      videoCodec: (text.match(/Video:\s*(\w+)/i) || [])[1] || null,
      audioCodec: (text.match(/Audio:\s*(\w+)/i) || [])[1] || null,
    };
  }, { b64 });
}

function within(actual, expected, tol) {
  return actual !== null && Math.abs(actual - expected) <= tol;
}

async function run() {
  console.log('=== Gate E2E Audio/Vídeo Tools (9 herramientas) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage(page, url, 'convertir-audio');
    // El motor se carga bajo demanda en producción; el generador de fixtures
    // lo incorpora explícitamente en su página de preparación.
    await page.addScriptTag({ url: `${url}/vendor/js/engine-loader.js` });
    const fx = await genAvFixtures(page);
    const audio1 = Buffer.from(fx.audio1, 'base64');
    const audio2 = Buffer.from(fx.audio2, 'base64');
    const video1 = Buffer.from(fx.video1, 'base64');
    const video2 = Buffer.from(fx.video2, 'base64');
    ok(audio1.length > 300 && magic(audio1) === 'wav', 'fixture audio1.wav (sine 330Hz) generado', `${audio1.length} bytes`);
    ok(audio2.length > 300 && magic(audio2) === 'wav', 'fixture audio2.wav (sine 550Hz) generado', `${audio2.length} bytes`);
    ok(video1.length > 1000 && magic(video1) === 'webm', 'fixture video1.webm (vp8+opus) generado', `${video1.length} bytes`);
    ok(video2.length > 1000 && magic(video2) === 'webm', 'fixture video2.webm (vp8+opus) generado', `${video2.length} bytes`);
    const v1probe = await probeMedia(page, toBase64(video1));
    ok(v1probe.hasVideo && v1probe.hasAudio, 'fixture video1.webm tiene video + audio (probe FFmpeg)', JSON.stringify(v1probe));
    const a1probe = await probeMedia(page, toBase64(audio1));
    ok(a1probe.hasAudio && !a1probe.hasVideo, 'fixture audio1.wav es audio puro', JSON.stringify(a1probe));

    /* ── 1. convertAudio (MP3) ─────────────────────────────────────────── */
    console.log('\n--- convertAudio (convertir-audio) ---');
    await gotoPage(page, url, 'convertir-audio');
    await upload(page, [{ name: 'audio1.wav', mimeType: 'audio/wav', buffer: audio1 }]);
    await page.waitForSelector('#audioOutputFormat', { timeout: 8000, state: 'attached' });
    pass('convertAudio: control audioOutputFormat visible (fix id)');
    await page.selectOption('#audioOutputFormat', 'mp3');
    await page.selectOption('#audioBitrate', '128k');
    await runTool(page);
    const caMsg = await resultMessage(page);
    ok(/Audio convertido a MP3 correctamente\./.test(caMsg), `convertAudio message: "${caMsg}"`);
    const caBuf = await downloadResult(page);
    if (caBuf) {
      const p = await probeMedia(page, toBase64(caBuf));
      ok(magic(caBuf) === 'mp3', 'convertAudio: salida MP3 real (magic)', magic(caBuf));
      ok(p.hasAudio && !p.hasVideo, 'convertAudio: contiene audio, sin video', JSON.stringify(p));
      ok(within(p.duration, 1.4, 0.3, 'duración'), 'convertAudio: duración ~1.4s', `real ${p.duration}`);
    } else fail('convertAudio sin archivo');
    await closeDialog(page);

    // Rama OGG (branch libvorbis).
    await page.selectOption('#audioOutputFormat', 'ogg');
    await runTool(page);
    const caOgg = await downloadResult(page);
    if (caOgg) {
      const p = await probeMedia(page, toBase64(caOgg));
      ok(magic(caOgg) === 'ogg', 'convertAudio OGG: salida OGG real (magic)', magic(caOgg));
      ok(p.hasAudio && !p.hasVideo, 'convertAudio OGG: audio puro', JSON.stringify(p));
    } else fail('convertAudio OGG sin archivo');
    await closeDialog(page);

    /* ── 2. trimAudio (wav→mp3, branch encode) ────────────────────────── */
    console.log('\n--- trimAudio (recortar-audio) ---');
    await gotoPage(page, url, 'recortar-audio');
    await upload(page, [{ name: 'audio1.wav', mimeType: 'audio/wav', buffer: audio1 }]);
    await page.waitForSelector('#trimAudioStart', { timeout: 8000, state: 'attached' });
    await page.fill('#trimAudioStart', '0.3');
    await page.fill('#trimAudioEnd', '0.9');
    await page.selectOption('#trimAudioFormat', 'mp3');
    await runTool(page);
    const taMsg = await resultMessage(page);
    ok(/Audio recortado de 0\.3s a 0\.9s correctamente\./.test(taMsg), `trimAudio message: "${taMsg}"`);
    const taBuf = await downloadResult(page);
    if (taBuf) {
      const p = await probeMedia(page, toBase64(taBuf));
      ok(magic(taBuf) === 'mp3', 'trimAudio: salida MP3 real (fix encode)', magic(taBuf));
      ok(within(p.duration, 0.6, 0.25, 'duración'), 'trimAudio: duración ~0.6s (0.3→0.9)', `real ${p.duration}`);
    } else fail('trimAudio sin archivo');
    await closeDialog(page);

    /* ── 3. mergeAudio (wav+wav→mp3, branch encode) ───────────────────── */
    console.log('\n--- mergeAudio (unir-audios) ---');
    await gotoPage(page, url, 'unir-audios');
    await upload(page, [
      { name: 'audio1.wav', mimeType: 'audio/wav', buffer: audio1 },
      { name: 'audio2.wav', mimeType: 'audio/wav', buffer: audio2 },
    ]);
    await page.waitForSelector('#mergeAudioFormat', { timeout: 8000, state: 'attached' });
    await page.selectOption('#mergeAudioFormat', 'mp3');
    await runTool(page);
    const maMsg = await resultMessage(page);
    ok(/2 archivos de audio unidos correctamente\./.test(maMsg), `mergeAudio message: "${maMsg}"`);
    const maBuf = await downloadResult(page);
    if (maBuf) {
      const p = await probeMedia(page, toBase64(maBuf));
      ok(magic(maBuf) === 'mp3', 'mergeAudio: salida MP3 real (fix encode)', magic(maBuf));
      ok(within(p.duration, 2.8, 0.5, 'duración'), 'mergeAudio: duración ~2.8s (1.4+1.4)', `real ${p.duration}`);
    } else fail('mergeAudio sin archivo');
    await closeDialog(page);

    /* ── 4. compressVideo (webm→mp4) ──────────────────────────────────── */
    console.log('\n--- compressVideo (comprimir-video) ---');
    await gotoPage(page, url, 'comprimir-video');
    await upload(page, [{ name: 'video1.webm', mimeType: 'video/webm', buffer: video1 }]);
    await page.waitForSelector('#videoOutputFormat', { timeout: 8000, state: 'attached' });
    pass('compressVideo: control videoOutputFormat visible (fix id)');
    await page.selectOption('#videoQuality', 'low');
    await page.selectOption('#videoOutputFormat', 'mp4');
    await runTool(page);
    const cvMsg = await resultMessage(page);
    ok(/Video comprimido\./.test(cvMsg), `compressVideo message: "${cvMsg}"`);
    const cvBuf = await downloadResult(page);
    if (cvBuf) {
      const p = await probeMedia(page, toBase64(cvBuf));
      ok(magic(cvBuf) === 'mp4', 'compressVideo: salida MP4 real (magic)', magic(cvBuf));
      ok(p.hasVideo && p.hasAudio, 'compressVideo: video + audio en MP4', JSON.stringify(p));
      ok(within(p.duration, 1.4, 0.4, 'duración'), 'compressVideo: duración ~1.4s', `real ${p.duration}`);
    } else fail('compressVideo sin archivo');
    await closeDialog(page);

    /* ── 5. trimVideo (webm→mp4, branch encode) ───────────────────────── */
    console.log('\n--- trimVideo (recortar-video) ---');
    await gotoPage(page, url, 'recortar-video');
    await upload(page, [{ name: 'video1.webm', mimeType: 'video/webm', buffer: video1 }]);
    await page.waitForSelector('#trimVideoStart', { timeout: 8000, state: 'attached' });
    await page.fill('#trimVideoStart', '0.3');
    await page.fill('#trimVideoEnd', '1.0');
    await page.selectOption('#trimVideoFormat', 'mp4');
    await runTool(page);
    const tvMsg = await resultMessage(page);
    ok(/Video recortado de 0\.3s a 1\.0 correctamente\./.test(tvMsg), `trimVideo message: "${tvMsg}"`);
    const tvBuf = await downloadResult(page);
    if (tvBuf) {
      const p = await probeMedia(page, toBase64(tvBuf));
      ok(magic(tvBuf) === 'mp4', 'trimVideo: salida MP4 real (fix encode)', magic(tvBuf));
      ok(p.hasVideo, 'trimVideo: contiene video', JSON.stringify(p));
      ok(within(p.duration, 0.7, 0.35, 'duración'), 'trimVideo: duración ~0.7s (0.3→1.0)', `real ${p.duration}`);
    } else fail('trimVideo sin archivo');
    await closeDialog(page);

    /* ── 6. mergeVideos (webm+webm→mp4, branch encode) ────────────────── */
    console.log('\n--- mergeVideos (unir-videos) ---');
    await gotoPage(page, url, 'unir-videos');
    await upload(page, [
      { name: 'video1.webm', mimeType: 'video/webm', buffer: video1 },
      { name: 'video2.webm', mimeType: 'video/webm', buffer: video2 },
    ]);
    await page.waitForSelector('#mergeVideoFormat', { timeout: 8000, state: 'attached' });
    await page.selectOption('#mergeVideoFormat', 'mp4');
    await runTool(page);
    const mvMsg = await resultMessage(page);
    ok(/2 videos unidos correctamente\./.test(mvMsg), `mergeVideos message: "${mvMsg}"`);
    const mvBuf = await downloadResult(page);
    if (mvBuf) {
      const p = await probeMedia(page, toBase64(mvBuf));
      ok(magic(mvBuf) === 'mp4', 'mergeVideos: salida MP4 real (fix encode)', magic(mvBuf));
      ok(p.hasVideo, 'mergeVideos: contiene video', JSON.stringify(p));
      ok(within(p.duration, 2.8, 0.6, 'duración'), 'mergeVideos: duración ~2.8s (1.4+1.4)', `real ${p.duration}`);
    } else fail('mergeVideos sin archivo');
    await closeDialog(page);

    /* ── 7. videoToGif ────────────────────────────────────────────────── */
    console.log('\n--- videoToGif (video-a-gif) ---');
    await gotoPage(page, url, 'video-a-gif');
    await upload(page, [{ name: 'video1.webm', mimeType: 'video/webm', buffer: video1 }]);
    await page.waitForSelector('#gifStart', { timeout: 8000, state: 'attached' });
    await page.fill('#gifStart', '0.2');
    await page.fill('#gifEnd', '1.0');
    await page.fill('#gifFps', '10');
    await page.fill('#gifWidth', '160');
    await runTool(page);
    const gMsg = await resultMessage(page);
    ok(/GIF generado: 160px, 10 FPS\./.test(gMsg), `videoToGif message: "${gMsg}"`);
    const gBuf = await downloadResult(page);
    if (gBuf) {
      const p = await probeMedia(page, toBase64(gBuf));
      ok(magic(gBuf) === 'gif', 'videoToGif: salida GIF real (magic)', magic(gBuf));
      ok(p.hasVideo && !p.hasAudio, 'videoToGif: GIF es video sin audio', JSON.stringify(p));
      ok(within(p.duration, 0.8, 0.4, 'duración'), 'videoToGif: duración ~0.8s (0.2→1.0)', `real ${p.duration}`);
    } else fail('videoToGif sin archivo');
    await closeDialog(page);

    /* ── 8. extractAudioFromVideo (webm→mp3) ──────────────────────────── */
    console.log('\n--- extractAudioFromVideo (extraer-audio-video) ---');
    await gotoPage(page, url, 'extraer-audio-video');
    await upload(page, [{ name: 'video1.webm', mimeType: 'video/webm', buffer: video1 }]);
    await page.waitForSelector('#extractAudioFormat', { timeout: 8000, state: 'attached' });
    await page.selectOption('#extractAudioFormat', 'mp3');
    await runTool(page);
    const eaMsg = await resultMessage(page);
    ok(/Audio extraído del video correctamente\./.test(eaMsg), `extractAudioFromVideo message: "${eaMsg}"`);
    const eaBuf = await downloadResult(page);
    if (eaBuf) {
      const p = await probeMedia(page, toBase64(eaBuf));
      ok(magic(eaBuf) === 'mp3', 'extractAudioFromVideo: salida MP3 real (magic)', magic(eaBuf));
      ok(p.hasAudio && !p.hasVideo, 'extractAudioFromVideo: audio puro sin video', JSON.stringify(p));
      ok(within(p.duration, 1.4, 0.3, 'duración'), 'extractAudioFromVideo: duración ~1.4s', `real ${p.duration}`);
    } else fail('extractAudioFromVideo sin archivo');
    await closeDialog(page);

    /* ── 9. removeAudioFromVideo (webm→webm copy y webm→mp4 encode) ───── */
    console.log('\n--- removeAudioFromVideo (quitar-audio-video) ---');
    await gotoPage(page, url, 'quitar-audio-video');
    await upload(page, [{ name: 'video1.webm', mimeType: 'video/webm', buffer: video1 }]);
    await page.waitForSelector('#removeAudioFormat', { timeout: 8000, state: 'attached' });
    await page.selectOption('#removeAudioFormat', 'same');
    await runTool(page);
    const raMsg = await resultMessage(page);
    ok(/Audio eliminado del video correctamente\./.test(raMsg), `removeAudioFromVideo message: "${raMsg}"`);
    const raBuf = await downloadResult(page);
    if (raBuf) {
      const p = await probeMedia(page, toBase64(raBuf));
      ok(magic(raBuf) === 'webm', 'removeAudioFromVideo same: salida WebM', magic(raBuf));
      ok(p.hasVideo && !p.hasAudio, 'removeAudioFromVideo same: video sin audio', JSON.stringify(p));
    } else fail('removeAudioFromVideo same sin archivo');
    await closeDialog(page);

    // Rama mp4 (branch encode, fix contenedor).
    await page.selectOption('#removeAudioFormat', 'mp4');
    await runTool(page);
    const raMp4 = await downloadResult(page);
    if (raMp4) {
      const p = await probeMedia(page, toBase64(raMp4));
      ok(magic(raMp4) === 'mp4', 'removeAudioFromVideo mp4: salida MP4 real (fix encode)', magic(raMp4));
      ok(p.hasVideo && !p.hasAudio, 'removeAudioFromVideo mp4: video sin audio', JSON.stringify(p));
    } else fail('removeAudioFromVideo mp4 sin archivo');
    await closeDialog(page);

    /* ── Consola ───────────────────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola en toda la suite');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-av-tools',
    updatedAt: new Date().toISOString(),
    tools: ['convertAudio', 'trimAudio', 'mergeAudio', 'compressVideo', 'trimVideo', 'mergeVideos', 'videoToGif', 'extractAudioFromVideo', 'removeAudioFromVideo'],
    fixes: [
      'app.js runCurrentTool: mapeo de ids de control (audioOutputFormat/trimAudioStart/…) a las opciones reales de los procesadores (outputFormat/startTime/…); los selects de formato dejaron de ser decorativos.',
      'tool-processors: trimAudio/mergeAudio/trimVideo/mergeVideos/removeAudioFromVideo usan -c copy solo cuando el contenedor de salida coincide con el de entrada; con cambio de formato re-codifican (libmp3lame/libvorbis/libx264/libvpx) en vez de fallar.',
    ],
    excluded: {},
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-av-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
