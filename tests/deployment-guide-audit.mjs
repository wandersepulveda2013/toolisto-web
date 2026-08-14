import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEvidence } from './evidence-helper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const guidePath = join(root, 'DEPLOYMENT.md');
const readmePath = join(root, 'README.md');
const siteConfigPath = join(root, 'src', 'data', 'site.config.json');
let failures = 0;

function check(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else { console.error(`FAIL: ${message}`); failures++; }
}

check(existsSync(guidePath), 'Existe la guía de despliegue');
const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '';
const readme = readFileSync(readmePath, 'utf8');
const siteConfig = JSON.parse(readFileSync(siteConfigPath, 'utf8'));

check(guide.includes('npm ci'), 'La guía usa instalación reproducible');
check(guide.includes('npm run build') && guide.includes('npm test') && guide.includes('node tests/run-all.mjs'), 'La guía exige build y regresión antes de publicar');
check(guide.includes('apluno.com') && guide.includes('/toolisto'), 'La guía documenta APLUNO y el catálogo /toolisto');
check(guide.includes('dist/') && guide.includes('único que se debe publicar'), 'La guía limita la publicación al build estático');
check(guide.includes('productionDomain') && guide.includes('.invalid'), 'La guía documenta el requisito de dominio de producción');
check(guide.includes('node server.js') && !guide.includes('npx --yes serve'), 'La vista previa usa el servidor local incluido sin descargar paquetes');
check(guide.includes('URL final') && guide.includes('sin subdirectorio'), 'La guía exige alinear la URL efectiva con el host publicado');
check(readme.includes('DEPLOYMENT.md'), 'El README enlaza la guía');
check(typeof siteConfig.siteUrl === 'string' && siteConfig.siteUrl.length > 0, 'La configuración de sitio contiene una URL');

console.log(`Deployment guide audit: ${10 - failures}/10 PASS`);
if (!failures) {
  writeEvidence(join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-deployment-guide-evidence.json'), {
    schemaVersion: 1,
    suite: 'deployment-guide-audit',
    scope: 'static-hosting-apluno-com',
    total: 10,
    passed: 10,
    failed: 0,
    approved: true
  });
}
process.exit(failures ? 1 : 0);
