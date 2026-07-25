import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcTools = join(root, 'src', 'data', 'tools.json');
const templateHtml = join(root, 'index.html');
const distDir = join(root, 'dist');
const tools = JSON.parse(readFileSync(srcTools, 'utf8'));

function generateToolCard(tool) {
  const iconClass = 'icon-' + (tool.color || 'orange');
  return `        <button class="tool-card" data-tool="${tool.toolId}" data-category="${tool.category}" data-batch="${tool.batch}" type="button">
          <span class="tool-icon ${iconClass}">${tool.icon}</span>
          <span class="tool-body"><strong>${tool.shortTitle}</strong><small>${tool.description}</small></span>
          <span class="tool-arrow" aria-hidden="true">→</span>
        </button>`;
}

function generateToolPage(template, tool) {
  const toolConfig = `<div id="tool-page-config" data-tool-id="${tool.toolId}" data-tool-slug="${tool.slug}" style="display:none"></div>`;
  let html = template.replace(/<title>.*?<\/title>/, `<title>${tool.title} · Toolisto</title>`);
  html = html.replace(
    /<meta name="description" content=".*?"/,
    `<meta name="description" content="${tool.description} Toolisto."`
  );
  html = html.replace('</main>', `${toolConfig}\n  </main>`);
  const counter = html.match(/<span class="tool-count">[\s\S]*?<\/span>/);
  return html;
}

function generateSitemap(baseUrl) {
  const urls = tools.filter((t) => t.status === 'active').map((t) => `  <url>
    <loc>${baseUrl}/tools/${t.slug}/</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
${urls.join('\n')}
</urlset>`;
}

mkdirSync(distDir, { recursive: true });
mkdirSync(join(distDir, 'tools'), { recursive: true });

const template = readFileSync(templateHtml, 'utf8');
const activeTools = tools.filter((t) => t.status === 'active');
const toolCardsHtml = activeTools.map(generateToolCard).join('\n\n');

const toolGridRegex = /(<div class="tool-grid"[^>]*>)([\s\S]*?)(<\/div>\s*\n\s*<p class="empty-tools")/;
let mainHtml = template;
if (toolGridRegex.test(mainHtml)) {
  mainHtml = mainHtml.replace(toolGridRegex, `$1\n${toolCardsHtml}\n      $3`);
}

const counterSpan = '<span class="tool-count"></span>';
if (mainHtml.includes('tool-count')) {
  mainHtml = mainHtml.replace(/<span class="tool-count"><\/span>/, `<span class="tool-count">${activeTools.length}</span>`);
}

mkdirSync(join(distDir, 'src'), { recursive: true });
writeFileSync(join(distDir, 'index.html'), mainHtml, 'utf8');
copyFileSync(join(root, 'app.js'), join(distDir, 'app.js'));
copyFileSync(join(root, 'styles.css'), join(distDir, 'styles.css'));
copyFileSync(join(root, 'src', 'tool-processors.js'), join(distDir, 'src', 'tool-processors.js'));
if (existsSync(join(root, '_headers'))) copyFileSync(join(root, '_headers'), join(distDir, '_headers'));
if (existsSync(join(root, '404.html'))) copyFileSync(join(root, '404.html'), join(distDir, '404.html'));

for (const tool of activeTools) {
  const toolDir = join(distDir, 'tools', tool.slug);
  mkdirSync(toolDir, { recursive: true });
  const toolHtml = generateToolPage(mainHtml, tool);
  writeFileSync(join(toolDir, 'index.html'), toolHtml, 'utf8');
}

const sitemap = generateSitemap('https://toolisto.com');
writeFileSync(join(distDir, 'sitemap.xml'), sitemap, 'utf8');

console.log(`Build completado:`);
console.log(`  - ${activeTools.length} herramientas activas`);
console.log(`  - dist/index.html generado`);
console.log(`  - ${activeTools.length} páginas de herramientas generadas`);
console.log(`  - dist/sitemap.xml generado`);
