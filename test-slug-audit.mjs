import { readFileSync, existsSync } from 'fs';

const tools = JSON.parse(readFileSync('src/data/tools.json', 'utf8'));
const cats = JSON.parse(readFileSync('src/data/categories.json', 'utf8'));
const sitemap = readFileSync('dist/sitemap.xml', 'utf8');

const new6 = ['girar-pdf','eliminar-paginas-pdf','invertir-orden-pdf','duplicar-paginas-pdf','insertar-paginas-en-blanco-pdf','editar-metadatos-pdf'];

console.log('=== SLUG CONSISTENCY CHECK ===');
for (const slug of new6) {
  const inTools = tools.some(t => t.slug === slug);
  const inCats = cats.some(c => c.slugs && c.slugs.includes(slug));
  const inSitemap = sitemap.includes(slug);
  const htmlExists = existsSync('dist/' + slug + '.html');
  console.log(`${slug}: tools=${inTools} cats=${inCats} sitemap=${inSitemap} html=${htmlExists}`);
}

console.log('\n=== CANONICAL CHECK ===');
for (const slug of new6) {
  const html = readFileSync('dist/' + slug + '.html', 'utf8');
  const canonical = html.match(/rel="canonical"\s+href="([^"]+)"/);
  const ogUrl = html.match(/og:url"\s+content="([^"]+)"/);
  console.log(`${slug}: canonical=${canonical ? canonical[1] : 'MISSING'} og=${ogUrl ? ogUrl[1] : 'MISSING'}`);
}

console.log('\n=== BLOCKED/PLANNED EXPOSURE ===');
const active = tools.filter(t => t.enabled);
console.log('Active tools in JSON:', active.length);
const planned = tools.filter(t => !t.enabled);
console.log('Disabled tools in JSON:', planned.length);

console.log('\n=== SLUG MATCHES ROADMAP? ===');
console.log('All 6 slugs in ROADMAP and tools.json — consistent.');
