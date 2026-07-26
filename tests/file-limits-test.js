#!/usr/bin/env node
const fs = require('fs');
const { join } = require('path');
const vm = require('vm');

const ROOT = join(__dirname, '..');
const FILE_LIMITS_SRC = fs.readFileSync(join(ROOT, 'js', 'file-limits.js'), 'utf-8');

function createSandbox(overrides) {
  const sandbox = {
    window: {},
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', deviceMemory: 8, hardwareConcurrency: 8 },
    console,
    Math,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  };
  sandbox.window.innerWidth = 1920;
  Object.assign(sandbox, overrides || {});
  sandbox.window.innerWidth = (overrides && overrides.innerWidth) || 1920;
  return sandbox;
}

function loadFileLimits(sandbox) {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(FILE_LIMITS_SRC, ctx);
  return sandbox.window.FileLimits;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

function assertApprox(a, b, tolerance, msg) {
  if (Math.abs(a - b) > tolerance) throw new Error(msg || `Expected ~${b}, got ${a}`);
}

console.log('\n=== FILE LIMITS TESTS ===\n');

// --- Module A: Constants & Profiles ---
console.log('--- 1. Constants & Profiles ---');

test('FileLimits exposes KB, MB, GB constants', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.KB, 1024);
  assertEqual(FL.MB, 1024 * 1024);
  assertEqual(FL.GB, 1024 * 1024 * 1024);
});

test('All 16 profiles exist', () => {
  const FL = loadFileLimits(createSandbox());
  const expected = ['default','imageLight','imageHeavy','pdfLight','pdfHeavy','office','spreadsheet','textData','structuredDataHeavy','ebook','archive','audio','video','mergeVideo','trimVideo','streamingLarge'];
  expected.forEach(p => assert(FL.PROFILES[p], `Missing profile: ${p}`));
  assertEqual(Object.keys(FL.PROFILES).length, 16);
});

test('Every profile has required fields', () => {
  const FL = loadFileLimits(createSandbox());
  const required = ['maxFileSize','mobileMaxFileSize','maxTotalSize','mobileMaxTotalSize','maxFiles','warningThreshold','memoryIntensity'];
  Object.keys(FL.PROFILES).forEach(p => {
    required.forEach(f => {
      assert(FL.PROFILES[p][f] !== undefined, `${p}.${f} is undefined`);
    });
  });
});

test('Profiles have reasonable values', () => {
  const FL = loadFileLimits(createSandbox());
  assert(FL.PROFILES.imageHeavy.maxFileSize > 0, 'imageHeavy.maxFileSize > 0');
  assert(FL.PROFILES.imageHeavy.mobileMaxFileSize <= FL.PROFILES.imageHeavy.maxFileSize, 'mobile <= desktop');
  assert(FL.PROFILES.video.maxFileSize >= FL.PROFILES.imageHeavy.maxFileSize, 'video >= image');
  assert(FL.PROFILES.trimVideo.maxFiles === 1, 'trimVideo maxFiles = 1');
  assert(FL.PROFILES.trimVideo.maxFileSize >= FL.PROFILES.video.maxFileSize, 'trimVideo >= video per-file');
});

// --- Module B: Tool Profile Mapping ---
console.log('\n--- 2. Tool Profile Mapping ---');

test('All tools from tools.json have profiles', () => {
  const FL = loadFileLimits(createSandbox());
  const toolsJson = JSON.parse(fs.readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf-8'));
  const missing = [];
  toolsJson.forEach(t => {
    if (!t.enabled) return;
    if (!FL.TOOL_PROFILE[t.toolId]) missing.push(t.toolId);
  });
  assertEqual(missing.length, 0, `Missing profiles for: ${missing.join(', ')}`);
});

test('Tool overrides do not conflict with profiles', () => {
  const FL = loadFileLimits(createSandbox());
  Object.keys(FL.TOOL_OVERRIDES).forEach(toolId => {
    assert(FL.TOOL_PROFILE[toolId], `Override for ${toolId} has no profile mapping`);
  });
});

test('Overrides override profile values correctly', () => {
  const FL = loadFileLimits(createSandbox());
  const sig = FL.getToolFileLimits('signature', 'image');
  assertEqual(sig.maxFiles, 1, 'signature maxFiles = 1');
  assert(sig.maxFileSize <= 50 * FL.MB, `signature maxFileSize <= 50MB (got ${sig.maxFileSize})`);
});

// --- Module C: formatFileSize ---
console.log('\n--- 3. formatFileSize ---');

test('formatFileSize(0) = "0 B"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(0), '0 B');
});

test('formatFileSize(500) = "500 B"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(500), '500 B');
});

test('formatFileSize(1024) = "1.0 KB"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(1024), '1.0 KB');
});

test('formatFileSize(1536) = "1.5 KB"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(1536), '1.5 KB');
});

test('formatFileSize(1048576) = "1.0 MB"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(1048576), '1.0 MB');
});

test('formatFileSize(26214400) = "25 MB"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(26214400), '25 MB');
});

test('formatFileSize(1073741824) = "1.00 GB"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.formatFileSize(1073741824), '1.00 GB');
});

// --- Module D: getDeviceCapabilities ---
console.log('\n--- 4. getDeviceCapabilities ---');

test('Desktop UA detected as non-mobile', () => {
  const FL = loadFileLimits(createSandbox());
  const caps = FL.getDeviceCapabilities();
  assertEqual(caps.isMobile, false);
});

test('Mobile UA detected as mobile', () => {
  const FL = loadFileLimits(createSandbox({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15', deviceMemory: 4, hardwareConcurrency: 6 } }));
  const caps = FL.getDeviceCapabilities();
  assertEqual(caps.isMobile, true);
});

test('Android UA detected as mobile', () => {
  const FL = loadFileLimits(createSandbox({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36', deviceMemory: 3, hardwareConcurrency: 4 } }));
  const caps = FL.getDeviceCapabilities();
  assertEqual(caps.isMobile, true);
});

test('Device memory reported', () => {
  const FL = loadFileLimits(createSandbox({ navigator: { userAgent: 'Chrome', deviceMemory: 4, hardwareConcurrency: 8 } }));
  const caps = FL.getDeviceCapabilities();
  assertEqual(caps.deviceMemory, 4);
});

// --- Module E: getToolFileLimits ---
console.log('\n--- 5. getToolFileLimits ---');

test('Known tool returns correct profile', () => {
  const FL = loadFileLimits(createSandbox());
  const limits = FL.getToolFileLimits('compress', 'image');
  assertEqual(limits._profile, 'imageHeavy');
  assert(limits.maxFileSize > 0, 'maxFileSize > 0');
});

test('Unknown tool falls back to accepts parameter', () => {
  const FL = loadFileLimits(createSandbox());
  const limits = FL.getToolFileLimits('unknownTool', 'pdf');
  assertEqual(limits._profile, 'pdfLight');
});

test('Unknown tool with no accepts falls back to default', () => {
  const FL = loadFileLimits(createSandbox());
  const limits = FL.getToolFileLimits('unknownTool', '');
  assertEqual(limits._profile, 'default');
});

test('Overrides are applied', () => {
  const FL = loadFileLimits(createSandbox());
  const sigLimits = FL.getToolFileLimits('signature', 'image');
  assertEqual(sigLimits.maxFiles, 1, 'signature: maxFiles overridden to 1');
  assert(sigLimits.maxFileSize <= 50 * FL.MB, `signature: maxFileSize overridden (got ${sigLimits.maxFileSize})`);
});

test('Mobile limits are lower', () => {
  const FL = loadFileLimits(createSandbox({
    navigator: { userAgent: 'iPhone', deviceMemory: 4, hardwareConcurrency: 4 }
  }));
  const desktopLimits = loadFileLimits(createSandbox()).getToolFileLimits('compress', 'image');
  const mobileLimits = FL.getToolFileLimits('compress', 'image');
  assert(mobileLimits.maxFileSize <= desktopLimits.maxFileSize, 'mobile maxFileSize <= desktop');
});

test('All tool profiles resolve without errors', () => {
  const FL = loadFileLimits(createSandbox());
  Object.keys(FL.TOOL_PROFILE).forEach(toolId => {
    const limits = FL.getToolFileLimits(toolId);
    assert(limits.maxFileSize > 0, `${toolId}: maxFileSize > 0`);
    assert(limits.maxTotalSize > 0, `${toolId}: maxTotalSize > 0`);
    assert(limits.maxFiles > 0, `${toolId}: maxFiles > 0`);
  });
});

// --- Module F: validateIncomingFiles ---
console.log('\n--- 6. validateIncomingFiles ---');

function makeFile(name, size, type) {
  return { name, size, type: type || 'image/jpeg' };
}

test('Small files are accepted', () => {
  const FL = loadFileLimits(createSandbox());
  const result = FL.validateIncomingFiles({
    incomingFiles: [makeFile('a.jpg', 1 * FL.MB)],
    existingFiles: [],
    toolId: 'compress',
    accepts: 'image'
  });
  assertEqual(result.acceptedFiles.length, 1);
  assertEqual(result.rejectedFiles.length, 0);
});

test('File exceeding maxFileSize is rejected', () => {
  const FL = loadFileLimits(createSandbox());
  const result = FL.validateIncomingFiles({
    incomingFiles: [makeFile('big.jpg', 200 * FL.MB)],
    existingFiles: [],
    toolId: 'compress',
    accepts: 'image'
  });
  assertEqual(result.acceptedFiles.length, 0);
  assertEqual(result.rejectedFiles.length, 1);
  assertEqual(result.rejectedFiles[0].reason, 'FILE_TOO_LARGE');
});

test('File exceeding maxTotalSize is rejected', () => {
  const FL = loadFileLimits(createSandbox());
  const files = [];
  for (let i = 0; i < 8; i++) {
    files.push(makeFile(`a${i}.pdf`, 100 * FL.MB));
  }
  const result = FL.validateIncomingFiles({
    incomingFiles: files,
    existingFiles: [],
    toolId: 'mergePdf',
    accepts: 'pdf'
  });
  assert(result.rejectedFiles.length >= 1, 'At least one file rejected');
  const reasons = result.rejectedFiles.map(r => r.reason);
  assert(reasons.includes('TOTAL_SIZE_EXCEEDED') || reasons.includes('MAX_FILES_EXCEEDED'),
    `Expected TOTAL_SIZE_EXCEEDED or MAX_FILES_EXCEEDED, got: ${reasons.join(', ')}`);
});

test('Files exceeding maxFiles are rejected', () => {
  const FL = loadFileLimits(createSandbox());
  const files = [];
  for (let i = 0; i < 5; i++) {
    files.push(makeFile(`f${i}.jpg`, 1 * FL.MB));
  }
  const result = FL.validateIncomingFiles({
    incomingFiles: files,
    existingFiles: [],
    toolId: 'signature',
    accepts: 'image'
  });
  assertEqual(result.acceptedFiles.length, 1, 'signature accepts only 1 file');
  assert(result.rejectedFiles.length >= 1, 'At least 1 rejected');
  assertEqual(result.rejectedFiles[0].reason, 'MAX_FILES_EXCEEDED');
});

test('Existing files count toward limits', () => {
  const FL = loadFileLimits(createSandbox());
  const result = FL.validateIncomingFiles({
    incomingFiles: [makeFile('b.jpg', 1 * FL.MB)],
    existingFiles: [makeFile('a.jpg', 1 * FL.MB)],
    toolId: 'signature',
    accepts: 'image'
  });
  assertEqual(result.acceptedFiles.length, 0, 'Already at maxFiles for signature');
  assertEqual(result.rejectedFiles.length, 1);
});

test('Large file generates warning', () => {
  const FL = loadFileLimits(createSandbox());
  const limits = FL.getToolFileLimits('compress', 'image');
  const bigFile = makeFile('heavy.jpg', limits.warningThreshold + 1 * FL.MB);
  const result = FL.validateIncomingFiles({
    incomingFiles: [bigFile],
    existingFiles: [],
    toolId: 'compress',
    accepts: 'image'
  });
  assertEqual(result.acceptedFiles.length, 1);
  assert(result.warnings.length >= 1, 'Warning generated for heavy file');
});

test('Rejected files have Spanish messages', () => {
  const FL = loadFileLimits(createSandbox());
  const result = FL.validateIncomingFiles({
    incomingFiles: [makeFile('huge.jpg', 200 * FL.MB)],
    existingFiles: [],
    toolId: 'compress',
    accepts: 'image'
  });
  assert(result.rejectedFiles[0].message.includes('límite') || result.rejectedFiles[0].message.includes('excede'), 'Message is in Spanish');
});

test('validateIncomingFiles returns limits object', () => {
  const FL = loadFileLimits(createSandbox());
  const result = FL.validateIncomingFiles({
    incomingFiles: [makeFile('a.jpg', 1 * FL.MB)],
    existingFiles: [],
    toolId: 'compress',
    accepts: 'image'
  });
  assert(result.limits, 'limits object exists');
  assert(result.limits.maxFileSize > 0, 'limits.maxFileSize > 0');
  assert(result.limits._profile, 'limits._profile set');
});

// --- Module G: getSizeBucket ---
console.log('\n--- 7. getSizeBucket ---');

test('getSizeBucket(0) = "0-10mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(0), '0-10mb');
});

test('getSizeBucket(5MB) = "0-10mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(5 * FL.MB), '0-10mb');
});

test('getSizeBucket(15MB) = "10-25mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(15 * FL.MB), '10-25mb');
});

test('getSizeBucket(30MB) = "25-50mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(30 * FL.MB), '25-50mb');
});

test('getSizeBucket(75MB) = "50-100mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(75 * FL.MB), '50-100mb');
});

test('getSizeBucket(150MB) = "100-250mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(150 * FL.MB), '100-250mb');
});

test('getSizeBucket(350MB) = "250-500mb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(350 * FL.MB), '250-500mb');
});

test('getSizeBucket(750MB) = "500mb-1gb"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(750 * FL.MB), '500mb-1gb');
});

test('getSizeBucket(2GB) = "1gb-plus"', () => {
  const FL = loadFileLimits(createSandbox());
  assertEqual(FL.getSizeBucket(2 * FL.GB), '1gb-plus');
});

// --- Module H: Integration with dist ---
console.log('\n--- 8. Dist Integration ---');

test('file-limits.js copied to dist/js/', () => {
  const exists = fs.existsSync(join(ROOT, 'dist', 'js', 'file-limits.js'));
  assert(exists, 'dist/js/file-limits.js does not exist');
});

test('file-limits.js loaded in tool page template', () => {
  const toolPage = fs.readFileSync(join(ROOT, 'dist', 'comprimir-imagen.html'), 'utf-8');
  assert(toolPage.includes('file-limits.js'), 'file-limits.js not found in tool page');
});

test('file-limits.js loaded in homepage', () => {
  const homepage = fs.readFileSync(join(ROOT, 'dist', 'index.html'), 'utf-8');
  assert(homepage.includes('file-limits.js'), 'file-limits.js not found in homepage');
});

test('fileLimitInfo element exists in tool pages', () => {
  const toolPage = fs.readFileSync(join(ROOT, 'dist', 'comprimir-imagen.html'), 'utf-8');
  assert(toolPage.includes('id="fileLimitInfo"'), 'fileLimitInfo element missing in tool page');
});

test('file-limits.js loads before app.js in tool pages', () => {
  const toolPage = fs.readFileSync(join(ROOT, 'dist', 'comprimir-imagen.html'), 'utf-8');
  const flIdx = toolPage.indexOf('file-limits.js');
  const appIdx = toolPage.indexOf('app.js');
  assert(flIdx < appIdx, `file-limits.js (${flIdx}) should load before app.js (${appIdx})`);
});

// --- Module I: app.js integration ---
console.log('\n--- 9. app.js Integration ---');

test('app.js references FileLimits in addFiles', () => {
  const appSrc = fs.readFileSync(join(ROOT, 'app.js'), 'utf-8');
  assert(appSrc.includes('window.FileLimits'), 'app.js references window.FileLimits');
  assert(appSrc.includes('validateIncomingFiles'), 'app.js calls validateIncomingFiles');
});

test('app.js has fileLimitInfo in els', () => {
  const appSrc = fs.readFileSync(join(ROOT, 'app.js'), 'utf-8');
  assert(appSrc.includes('fileLimitInfo'), 'app.js references fileLimitInfo');
});

test('app.js tracks file_limits_resolved analytics event', () => {
  const appSrc = fs.readFileSync(join(ROOT, 'app.js'), 'utf-8');
  assert(appSrc.includes('file_limits_resolved'), 'app.js fires file_limits_resolved event');
});

// --- Summary ---
console.log('\n=== RESULTS ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log(failed === 0 ? '\n✓ ALL FILE LIMITS TESTS PASSED' : '\n✗ SOME TESTS FAILED');
process.exit(failed > 0 ? 1 : 0);
