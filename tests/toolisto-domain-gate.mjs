// toolisto-domain-gate.mjs — Gate de regresión del ecosistema APLUNO en apluno.com.
// Protege el origen canónico, el catálogo /toolisto, los slugs planos y la lista
// `_headers` de endurecimiento del host estático, para que una migración/refactor futura
// no vuelva a apuntar canónicos, sitemap o cabeceras a un dominio/subdirectorio distinto.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const siteConfigPath = join(root, 'src', 'data', 'site.config.json');
const headersPath = join(root, '_headers');
const buildScriptPath = join(root, 'scripts', 'generate-seo-pages.mjs');
const dist = join(root, 'dist');

let failures = 0;
let checks = 0;

function check(condition, message) {
  checks++;
  if (condition) console.log(`PASS: ${message}`);
  else { console.error(`FAIL: ${message}`); failures++; }
}

const site = JSON.parse(readFileSync(siteConfigPath, 'utf8'));

const EXPECTED_ORIGIN = 'https://apluno.com';
const siteUrl = site.siteUrl;
const productionDomain = site.productionDomain;
const siteUrlParsed = siteUrl ? new URL(siteUrl) : null;

check(siteUrl === EXPECTED_ORIGIN, `siteUrl es exactamente ${EXPECTED_ORIGIN}`);
check(productionDomain === EXPECTED_ORIGIN, `productionDomain es exactamente ${EXPECTED_ORIGIN}`);
check(siteUrlParsed !== null && siteUrlParsed.hostname === 'apluno.com', 'El host canónico es apluno.com');
check(siteUrlParsed !== null && siteUrlParsed.pathname === '/', 'La URL canónica no usa subdirectorio (pathname es "/")');
check(siteUrl && !siteUrl.includes('toolisto.com'), 'No persiste el dominio ajeno toolisto.com');
check(siteUrl && !siteUrl.includes('.invalid'), 'No persiste un dominio .invalid');

const headers = readFileSync(headersPath, 'utf8');
check(headers.includes('Strict-Transport-Security: max-age=31536000') && headers.includes('includeSubDomains') && headers.includes('preload'), '_headers: HSTS con includeSubDomains y preload');
check(headers.includes('X-Content-Type-Options: nosniff'), '_headers: X-Content-Type-Options nosniff');
check(headers.includes('Referrer-Policy: strict-origin-when-cross-origin'), '_headers: Referrer-Policy estricta');
check(headers.includes('Permissions-Policy') && headers.includes('geolocation=()'), '_headers: Permissions-Policy acotada');
check(headers.includes("default-src 'self'") && headers.includes("object-src 'none'") && headers.includes("frame-ancestors 'none'") && headers.includes("base-uri 'self'"), '_headers: CSP con default-src self y object/frame/base acotados');
check(!headers.includes('/workspace/*'), '_headers: la landing pública /workspace/ no hereda noindex');
check(!headers.includes('/workspace/preview.html'), '_headers: no se publica el preview interno de Workspace');
const withoutAllowedCdn = headers.replace(/https:\/\/cdn\.jsdelivr\.net\b/g, '');
check(!/https?:\/\/[^\s'"]+/.test(withoutAllowedCdn), '_headers: sin egress de terceros salvo el CDN declarado de scripts');

const buildScript = readFileSync(buildScriptPath, 'utf8');
check(buildScript.includes('cpSync(headersSrc'), 'El build copia _headers a dist (generate-seo-pages.mjs)');
check(buildScript.includes("site.siteUrl = site.productionDomain"), 'El build prioriza productionDomain sobre siteUrl');
check(buildScript.includes('.invalid'), 'El build rechaza dominios .invalid en modo producción');

const sitemapPath = join(dist, 'sitemap.xml');
const robotsPath = join(dist, 'robots.txt');
const distHeadersPath = join(dist, '_headers');
const aplunoHomePath = join(dist, 'index.html');
const toolistoHomePath = join(dist, 'toolisto.html');
check(existsSync(aplunoHomePath), 'dist/index.html existe como portada APLUNO');
check(existsSync(toolistoHomePath), 'dist/toolisto.html existe como catálogo Toolisto');
if (existsSync(aplunoHomePath)) {
  check(readFileSync(aplunoHomePath, 'utf8').includes(`rel="canonical" href="${EXPECTED_ORIGIN}/"`), 'La portada APLUNO tiene canonical raíz');
}
if (existsSync(toolistoHomePath)) {
  const toolistoHome = readFileSync(toolistoHomePath, 'utf8');
  check(toolistoHome.includes(`rel="canonical" href="${EXPECTED_ORIGIN}/toolisto"`), 'El catálogo Toolisto tiene canonical /toolisto');
  check(toolistoHome.includes(`property="og:url" content="${EXPECTED_ORIGIN}/toolisto"`), 'El catálogo Toolisto tiene og:url /toolisto');
}
check(existsSync(distHeadersPath), 'dist/_headers existe (regresión del host desplegado)');
if (existsSync(distHeadersPath)) {
  check(readFileSync(distHeadersPath, 'utf8') === headers, 'dist/_headers es idéntico al _headers fuente');
}
check(existsSync(sitemapPath), 'dist/sitemap.xml existe');
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const wrongHost = locs.filter(loc => loc !== EXPECTED_ORIGIN && !loc.startsWith(`${EXPECTED_ORIGIN}/`));
  check(wrongHost.length === 0, `Todas las <loc> del sitemap apuntan a ${EXPECTED_ORIGIN} (${locs.length} URLs)`);
  check(locs.includes(`${EXPECTED_ORIGIN}/toolisto`), 'El sitemap publica el catálogo /toolisto');
  check(!locs.some(loc => loc.includes('toolisto.com')), 'El sitemap no referencia toolisto.com');
}
check(existsSync(robotsPath), 'dist/robots.txt existe');
if (existsSync(robotsPath)) {
  check(readFileSync(robotsPath, 'utf8').includes(`Sitemap: ${EXPECTED_ORIGIN}/sitemap.xml`), 'robots.txt referencia el sitemap canónico en apluno.com');
}

console.log(`\nToolisto domain gate: ${checks - failures}/${checks} PASS`);
writeEvidence(join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-toolisto-domain-gate-evidence.json'), {
  schemaVersion: 1,
  suite: 'toolisto-domain-gate',
  scope: 'static-hosting-apluno-com',
  total: checks,
  passed: checks - failures,
  failed: failures,
  approved: failures === 0
});
process.exit(failures ? 1 : 0);
