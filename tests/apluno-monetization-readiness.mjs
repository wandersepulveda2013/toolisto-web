import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const SRC = join(import.meta.dirname, '..', 'src');

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function read(p) { return readFileSync(p, 'utf-8'); }

function htmlFiles(dir, depth = 0) {
  if (depth > 3) return [];
  const results = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const fp = join(dir, f.name);
    if (f.isDirectory()) results.push(...htmlFiles(fp, depth + 1));
    else if (f.name.endsWith('.html')) results.push(fp);
  }
  return results;
}

const files = htmlFiles(DIST);

console.log('\n=== APLUNO Monetization Readiness Tests ===\n');

console.log('--- 1. Publisher ID ---');
const siteConfig = JSON.parse(read(join(SRC, 'data', 'site.config.json')));
const publisherId = 'ca-pub-2644615452393440';
check('publisher ID is real (not placeholder)', publisherId !== 'ca-pub-0000000000000000');
check('publisher ID format valid', /^ca-pub-\d{16}$/.test(publisherId));

console.log('\n--- 2. AdSense Injection ---');
const allowedPages = ['index.html', 'toolisto.html', join('about', 'index.html')];
const categories = JSON.parse(read(join(SRC, 'data', 'categories.json')));
for (const cat of categories) {
  if (cat.enabled !== false) allowedPages.push(`${cat.slug}.html`);
}

let adsenseCount = 0;
let duplicateAdsense = 0;
let toolPageWithAdsense = 0;

const toolsJson = JSON.parse(read(join(SRC, 'data', 'tools.json')));
const toolSlugs = toolsJson.filter(t => t.enabled !== false).map(t => t.slug);

for (const f of files) {
  const content = read(f);
  const name = f.replace(DIST + '/', '').replace(/\\/g, '/');
  const hasAdsense = content.includes('pagead2.googlesyndication.com');
  const matches = (content.match(/pagead2\.googlesyndication\.com/g) || []).length;

  if (hasAdsense) adsenseCount++;
  if (matches > 1) duplicateAdsense++;

  const slug = basename(f, '.html');
  if (toolSlugs.includes(slug) && hasAdsense) toolPageWithAdsense++;
}

check('AdSense on 15 pages', adsenseCount === 15, `found ${adsenseCount}`);
check('no duplicate AdSense scripts', duplicateAdsense === 0, `${duplicateAdsense} pages with duplicates`);
check('zero AdSense on tool pages', toolPageWithAdsense === 0, `${toolPageWithAdsense} tool pages with AdSense`);

console.log('\n--- 3. ads.txt ---');
const adsTxt = read(join(DIST, 'ads.txt'));
check('ads.txt exists', adsTxt.length > 0);
check('ads.txt contains correct publisher', adsTxt.includes('pub-2644615452393440'));
check('ads.txt is not HTML fallback', !adsTxt.includes('<html') && !adsTxt.includes('<!DOCTYPE'));
check('ads.txt has single line', adsTxt.trim().split('\n').length === 1);
check('ads.txt format valid', /google\.com,\s*pub-\d+,\s*DIRECT/.test(adsTxt.trim()));

console.log('\n--- 4. Privacy Disclosure ---');
const privacy = read(join(DIST, 'privacy', 'index.html'));
check('privacy mentions AdSense', privacy.includes('Google AdSense'));
check('privacy mentions Google privacy policy', privacy.includes('policies.google.com/privacy'));
check('privacy mentions IndexedDB', privacy.includes('IndexedDB'));
check('privacy mentions localStorage', privacy.includes('localStorage'));
check('privacy mentions cookies', privacy.includes('cookies'));

const privacidad = read(join(DIST, 'privacidad.html'));
check('legacy privacy mentions AdSense', privacidad.includes('Google AdSense'));
check('legacy privacy mentions Google privacy policy', privacidad.includes('policies.google.com/privacy'));
check('legacy privacy mentions IndexedDB', privacidad.includes('IndexedDB'));
check('legacy privacy mentions localStorage', privacidad.includes('localStorage'));

console.log('\n--- 5. Tool Count ---');
const toolsCount = toolSlugs.length;
check('tools.json has 202 enabled tools', toolsCount === 202, `found ${toolsCount}`);

const homeContent = read(join(DIST, 'index.html'));
check('homepage claims 202 tools', homeContent.includes('202 herramientas'));

const toolistoContent = read(join(DIST, 'toolisto.html'));
check('toolisto heroTrustCount is 202', toolistoContent.includes('id="heroTrustCount">202'));
check('toolisto toolCountVisible is 202', toolistoContent.includes('id="toolCountVisible">202'));

console.log('\n--- 6. No Placeholder Publisher ID ---');
let placeholderFound = false;
for (const f of files) {
  const content = read(f);
  if (content.includes('pub-0000000000000000') || content.includes('pub-1234567890123456')) {
    placeholderFound = true;
    break;
  }
}
check('no placeholder publisher IDs in dist', !placeholderFound);

console.log('\n--- 7. Idempotency Check ---');
let adsenseInToolPages = 0;
for (const f of files) {
  const slug = basename(f, '.html');
  if (toolSlugs.includes(slug)) {
    const content = read(f);
    if (content.includes('pagead2.googlesyndication.com')) adsenseInToolPages++;
  }
}
check('idempotent: zero AdSense in tool pages', adsenseInToolPages === 0);

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
