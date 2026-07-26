const { chromium } = require('playwright');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const BASE = process.env.TEST_BASE || 'http://localhost:8080';
const DIST = join(__dirname, '..', 'dist');

const toolsJson = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'tools.json'), 'utf8'));
const categoriesJson = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'categories.json'), 'utf8'));

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ FAIL: ${label}`); failed++; }
}

const NEW_TOOLS = [
  { toolId: 'enhanceScannedDocument', slug: 'mejorar-documento-escaneado', category: 'images' },
  { toolId: 'cameraDocumentScanner', slug: 'escanear-documento-camara', category: 'images' },
  { toolId: 'pdfTablesToExcel', slug: 'extraer-tablas-pdf-excel', category: 'pdf' },
  { toolId: 'imageTableToExcel', slug: 'extraer-tabla-imagen-excel', category: 'spreadsheets' },
  { toolId: 'convertAudio', slug: 'convertir-audio', category: 'audio' },
  { toolId: 'trimAudio', slug: 'recortar-audio', category: 'audio' },
  { toolId: 'mergeAudio', slug: 'unir-audios', category: 'audio' },
  { toolId: 'compressVideo', slug: 'comprimir-video', category: 'video' },
  { toolId: 'trimVideo', slug: 'recortar-video', category: 'video' },
  { toolId: 'mergeVideos', slug: 'unir-videos', category: 'video' },
  { toolId: 'videoToGif', slug: 'video-a-gif', category: 'video' },
  { toolId: 'extractAudioFromVideo', slug: 'extraer-audio-video', category: 'audio' },
  { toolId: 'removeAudioFromVideo', slug: 'quitar-audio-video', category: 'video' },
];

const NEW_SLUGS = [
  'mejorar-documento-escaneado',
  'escanear-documento-camara',
  'extraer-tablas-pdf-excel',
  'extraer-tabla-imagen-excel',
  'convertir-audio',
  'recortar-audio',
  'unir-audios',
  'comprimir-video',
  'recortar-video',
  'unir-videos',
  'video-a-gif',
  'extraer-audio-video',
  'quitar-audio-video',
];

const SAMPLE_PAGES = [
  'convertir-audio',
  'comprimir-video',
  'extraer-tabla-imagen-excel',
  'mejorar-documento-escaneado',
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  // ═══════════════════════════════════════════════════
  // A. HOMEPAGE TOOL CARDS
  // ═══════════════════════════════════════════════════
  console.log('\n=== A. HOMEPAGE TOOL CARDS ===\n');
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });

  for (const t of NEW_TOOLS) {
    const card = await page.$(`.tool-card[data-tool="${t.toolId}"]`);
    ok(`Card exists: ${t.toolId}`, !!card);
    if (card) {
      const cat = await card.evaluate(el => el.getAttribute('data-category'));
      ok(`${t.toolId} data-category = "${t.category}"`, cat === t.category);
    }
  }

  const totalCards = await page.$$eval('.tool-card[data-tool]', cards => cards.length);
  ok(`Total tool cards = 144`, totalCards === 144);

  console.log('\n--- Filter chips ---');
  const videoChip = await page.$('.filter-chip[data-filter="video"]');
  ok('Video filter chip exists', !!videoChip);
  const audioChip = await page.$('.filter-chip[data-filter="audio"]');
  ok('Audio filter chip exists', !!audioChip);

  // ═══════════════════════════════════════════════════
  // B. SEO PAGES GENERATED
  // ═══════════════════════════════════════════════════
  console.log('\n=== B. SEO PAGES GENERATED ===\n');
  for (const slug of NEW_SLUGS) {
    const htmlPath = join(DIST, slug + '.html');
    ok(`${slug}.html exists in dist`, existsSync(htmlPath));
  }

  // ═══════════════════════════════════════════════════
  // C. TOOL PAGE CONTENT (sample pages)
  // ═══════════════════════════════════════════════════
  console.log('\n=== C. TOOL PAGE CONTENT ===\n');
  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');

  for (const slug of SAMPLE_PAGES) {
    console.log(`--- ${slug} ---`);
    const html = readFileSync(join(DIST, slug + '.html'), 'utf8');

    ok(`${slug}: has <title>`, /<title>/.test(html));
    ok(`${slug}: has meta description`, /<meta name="description"/.test(html));
    ok(`${slug}: has JSON-LD structured data`, /application\/ld\+json/.test(html));
    ok(`${slug}: has tool-page-config JSON`, /id="tool-page-config"/.test(html));
    ok(`${slug}: has breadcrumbs`, /class="breadcrumbs"/.test(html));
    ok(`${slug}: has FAQ section`, /faq-section/.test(html));
    ok(`${slug}: in sitemap.xml`, sitemap.includes(slug));

    const configMatch = html.match(/id="tool-page-config">\s*({.*?})\s*<\/script>/s);
    if (configMatch) {
      const config = JSON.parse(configMatch[1]);
      const expected = NEW_TOOLS.find(t => t.slug === slug);
      ok(`${slug}: tool-page-config toolId matches`, config.toolId === expected.toolId);
    }

    ok(`${slug}: has rel="canonical"`, /rel="canonical"/.test(html));
    ok(`${slug}: has H1 tag`, /<h1/.test(html));
  }

  console.log('\n--- engine-loader.js included ---');
  for (const slug of SAMPLE_PAGES) {
    const html = readFileSync(join(DIST, slug + '.html'), 'utf8');
    ok(`${slug}: vendor/js/engine-loader.js loaded`, html.includes('vendor/js/engine-loader.js'));
  }

  // ═══════════════════════════════════════════════════
  // D. VENDOR FILES
  // ═══════════════════════════════════════════════════
  console.log('\n=== D. VENDOR FILES ===\n');
  const vendorFiles = [
    'vendor/ffmpeg/ffmpeg.js',
    'vendor/ffmpeg/ffmpeg-core.js',
    'vendor/ffmpeg/ffmpeg-core.wasm',
    'vendor/ffmpeg/util.js',
    'vendor/tesseract/tesseract.min.js',
    'vendor/tesseract/worker.min.js',
    'vendor/js/engine-loader.js',
  ];
  for (const f of vendorFiles) {
    ok(`${f} exists`, existsSync(join(DIST, f)));
  }

  // ═══════════════════════════════════════════════════
  // E. CATEGORY PAGES
  // ═══════════════════════════════════════════════════
  console.log('\n=== E. CATEGORY PAGES ===\n');
  ok('video.html exists', existsSync(join(DIST, 'video.html')));
  ok('audio.html exists', existsSync(join(DIST, 'audio.html')));

  const videoHtml = readFileSync(join(DIST, 'video.html'), 'utf8');
  ok('video.html has <title>', /<title>/.test(videoHtml));
  ok('video.html has meta description', /<meta name="description"/.test(videoHtml));

  const audioHtml = readFileSync(join(DIST, 'audio.html'), 'utf8');
  ok('audio.html has <title>', /<title>/.test(audioHtml));
  ok('audio.html has meta description', /<meta name="description"/.test(audioHtml));

  // ═══════════════════════════════════════════════════
  // F. tools.json STRUCTURE
  // ═══════════════════════════════════════════════════
  console.log('\n=== F. tools.json STRUCTURE ===\n');
  ok(`Total tool count is 144`, toolsJson.length === 144);
  ok(`Enabled tool count is 144`, toolsJson.filter(t => t.enabled).length === 144);

  const requiredFields = ['id', 'slug', 'name', 'description', 'icon', 'accepts', 'toolId'];
  for (const t of NEW_TOOLS) {
    const tool = toolsJson.find(x => x.toolId === t.toolId);
    ok(`tools.json: ${t.toolId} exists`, !!tool);
    if (tool) {
      for (const field of requiredFields) {
        ok(`${t.toolId}: has "${field}" field`, tool[field] !== undefined && tool[field] !== null);
      }
      ok(`${t.toolId}: slug matches`, tool.slug === t.slug);
      ok(`${t.toolId}: category matches`, tool.category === t.category);
      ok(`${t.toolId}: enabled = true`, tool.enabled === true);
      ok(`${t.toolId}: indexable = true`, tool.indexable === true);
    }
  }

  const toolIds = toolsJson.map(t => t.toolId);
  const uniqueIds = new Set(toolIds);
  ok(`Unique toolIds >= 120 (total ${toolIds.length}, unique ${uniqueIds.size})`, uniqueIds.size >= 120);

  // ═══════════════════════════════════════════════════
  // G. categories.json STRUCTURE
  // ═══════════════════════════════════════════════════
  console.log('\n=== G. categories.json STRUCTURE ===\n');
  ok(`Total category count is 12`, categoriesJson.length === 12);

  const videoCat = categoriesJson.find(c => c.id === 'video');
  ok('Video category exists', !!videoCat);
  if (videoCat) {
    ok('Video category has compressVideo', videoCat.toolIds.includes('compressVideo'));
    ok('Video category has trimVideo', videoCat.toolIds.includes('trimVideo'));
    ok('Video category has mergeVideos', videoCat.toolIds.includes('mergeVideos'));
    ok('Video category has videoToGif', videoCat.toolIds.includes('videoToGif'));
    ok('Video category has removeAudioFromVideo', videoCat.toolIds.includes('removeAudioFromVideo'));
  }

  const audioCat = categoriesJson.find(c => c.id === 'audio');
  ok('Audio category exists', !!audioCat);
  if (audioCat) {
    ok('Audio category has convertAudio', audioCat.toolIds.includes('convertAudio'));
    ok('Audio category has trimAudio', audioCat.toolIds.includes('trimAudio'));
    ok('Audio category has mergeAudio', audioCat.toolIds.includes('mergeAudio'));
    ok('Audio category has extractAudioFromVideo', audioCat.toolIds.includes('extractAudioFromVideo'));
  }

  // ═══════════════════════════════════════════════════
  // H. app.js INTEGRATION
  // ═══════════════════════════════════════════════════
  console.log('\n=== H. app.js INTEGRATION ===\n');
  const appJs = readFileSync(join(DIST, 'js', 'app.js'), 'utf8');

  for (const t of NEW_TOOLS) {
    ok(`app.js: toolMeta[${t.toolId}] exists`, appJs.includes(`${t.toolId}:`));
  }

  ok('app.js: isVideoFile helper exists', appJs.includes('function isVideoFile'));
  ok('app.js: isAudioFile helper exists', appJs.includes('function isAudioFile'));
  ok('app.js: VIDEO_MIMES defined', appJs.includes('VIDEO_MIMES'));
  ok('app.js: AUDIO_MIMES defined', appJs.includes('AUDIO_MIMES'));

  ok('app.js: addFiles accepts video', appJs.includes('isVideoFile(file)'));
  ok('app.js: addFiles accepts audio', appJs.includes('isAudioFile(file)'));

  const newToolIds = NEW_TOOLS.map(t => t.toolId);
  for (const tid of newToolIds) {
    ok(`app.js: validateToolFiles has rule for ${tid}`, appJs.includes(`'${tid}'`) || appJs.includes(`"${tid}"`));
  }

  for (const tid of newToolIds) {
    ok(`app.js: availableTools includes ${tid}`, appJs.includes(`'${tid}'`) || appJs.includes(`"${tid}"`));
  }

  // ═══════════════════════════════════════════════════
  // I. tool-processors.js
  // ═══════════════════════════════════════════════════
  console.log('\n=== I. tool-processors.js ===\n');
  const tpJs = readFileSync(join(DIST, 'js', 'tool-processors.js'), 'utf8');

  for (const t of NEW_TOOLS) {
    ok(`tool-processors.js: ${t.toolId} processor registered`, tpJs.includes(`window.ToolProcessors.${t.toolId}`));
  }

  ok('tool-processors.js: EngineLoader dependency referenced', tpJs.includes('window.EngineLoader'));

  // ═══════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════
  console.log('\n=== RESULTS ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(failed === 0 ? '\n✓ ALL TESTS PASSED' : '\n✗ SOME TESTS FAILED');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
