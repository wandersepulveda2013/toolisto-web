// update-index-grid.mjs — Regenerate the toolGrid in index.html from tools.json
import { readFileSync, writeFileSync } from 'fs';

const tools = JSON.parse(readFileSync('src/data/tools.json', 'utf8'));
const enabledTools = tools.filter(t => t.enabled);

const toolCardsHTML = enabledTools.map(t => {
  const cat = t.category;
  const inputFormats = (t.inputFormats || []).join(' ');
  const outputFormats = (t.outputFormats || []).join(' ');
  const keywords = (t.keywords || []).join(' ');
  return `        <a class="tool-card" data-tool="${t.toolId}" data-category="${cat}" data-input-formats="${inputFormats}" data-output-formats="${outputFormats}" data-keywords="${keywords}" href="./${t.slug}.html">
          <span class="tool-icon">${t.icon}</span>
          <span class="tool-body"><strong>${t.name}</strong><small>${t.summary}</small></span>
          <span class="tool-arrow" aria-hidden="true">→</span>
        </a>`;
}).join('\n\n');

let html = readFileSync('index.html', 'utf8');

const gridStart = '<div class="tool-grid" id="toolGrid">';
const gridEnd = '      </div>\n\n      <div class="empty-tools"';

const startIdx = html.indexOf(gridStart);
const endIdx = html.indexOf(gridEnd, startIdx);
if (startIdx === -1 || endIdx === -1) {
  console.error('ERROR: markers not found');
  console.log('startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

const before = html.substring(0, startIdx + gridStart.length);
const after = html.substring(endIdx);

html = before + '\n' + toolCardsHTML + '\n' + after;

const count = enabledTools.length;
const countLabel = count + ' herramientas disponibles';

// Update splash HTML counter (SEO fallback shown during loading)
html = html.replace(
  /(<span class="intro-count"[^>]*>)[^<]*(<\/span>)/,
  `$1${countLabel}$2`
);

// Update hero trust line
html = html.replace(
  /<p class="hero-trust">[^<]*herramientas disponibles/,
  `<p class="hero-trust">${countLabel}`
);

writeFileSync('index.html', html);
console.log(`Updated index.html with ${count} tool cards and counter "${countLabel}"`);
