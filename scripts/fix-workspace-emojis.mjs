#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const file = join(ROOT, 'workspace', 'workspace.js');
let code = readFileSync(file, 'utf8');

// Find all remaining emoji and replace
// Simple replacements in string literals and template literals
const simple = [
  // Export/delete buttons in other cards
  ['>📤</button>', `>\${SVG.download}</button>`],
  ['>🗑️</button>', `>\${SVG.trash}</button>`],
  // Empty state icons
  ['<div class="ws-empty-icon">📝</div>', `<div class="ws-empty-icon">\${SVG.empty}</div>`],
  ['<div class="ws-empty-icon">📋</div>', `<div class="ws-empty-icon">\${SVG.empty}</div>`],
  ['<div class="ws-empty-icon">📷</div>', `<div class="ws-empty-icon">\${SVG.camera}</div>`],
  // Capture area 
  ['<div style="font-size:48px;margin-bottom:12px">📷</div>', `<div style="margin-bottom:12px">\${SVG.camera}</div>`],
  // Dashboard quick actions
  ['onclick="window._wsNav(\'capture\')">📷 Captura</button>', `onclick="window._wsNav('capture')">\${SVG.camera} Captura</button>`],
  ['onclick="window._wsNav(\'documents\')">📝 Nuevo Documento</button>', `onclick="window._wsNav('documents')">\${SVG.doc} Nuevo Documento</button>`],
  ['onclick="window._wsNav(\'data\')">📋 Importar Datos</button>', `onclick="window._wsNav('data')">\${SVG.table} Importar Datos</button>`],
  ['onclick="window._wsNav(\'tools\')">🧰 Herramientas</button>', `onclick="window._wsNav('tools')">\${SVG.wrench} Herramientas</button>`],
  ['onclick="window._wsNav(\'flow\')">⚡ Flow</button>', `onclick="window._wsNav('flow')">\${SVG.flow} Flow</button>`],
  // Intake zone
  ['<div class="drop-icon">📥</div>', `<div class="drop-icon">\${SVG.upload}</div>`],
  // Tool view status
  ['<span class="ws-tool-status-dot"></span>', `<span class="ws-tool-status-dot"></span>`],
  // Context menu icons
  ['{ icon: \'👁️\',', '{ icon: SVG.search,'],
  ['{ icon: \'🗑️\',', '{ icon: SVG.trash,'],
  ['{ icon: \'⬆️\',', '{ icon: SVG.upload,'],
  ['{ icon: \'⬇️\',', '{ icon: SVG.download,'],
  ['{ icon: \'✏️\',', '{ icon: SVG.doc,'],
  // Block menu icons
  ['>📁</span>', `>\${SVG.folder}</span>`],
  ['>📷</span>', `>\${SVG.camera}</span>`],
  ['>📎</span>', `>\${SVG.file}</span>`],
  // Modal buttons with emoji
  ['>📤 Exportar<', `>\${SVG.download} Exportar<`],
  ['>📤 Importar<', `>\${SVG.upload} Importar<`],
  // Flow toolbar emojis
  ['>📥 Entrada<', `>\${SVG.upload} Entrada<`],
  ['>🧰 Herramienta<', `>\${SVG.wrench} Herramienta<`],
  ['>🔀 Lógica<', `>\${SVG.flow} Lógica<`],
  ['>📤 Salida<', `>\${SVG.download} Salida<`],
  ['>🔍+<', `>+<`],
  ['>🔍−<', `>-<`],
  ['>📐<', `><`],
  // Flow node icons
  ['getFlowNodeIcon(node.type)} ${', `getFlowNodeIcon(node.type)} \${`],
];

for (const [from, to] of simple) {
  if (code.includes(from)) {
    code = code.replaceAll(from, to);
  }
}

// Replace the getFlowNodeIcon function
code = code.replace(
  "return { input: '📥', tool: '🧰', logic: '🔀', output: '📤' }[type] || '⚡';",
  "const svgMap = { input: SVG.upload, tool: SVG.wrench, logic: SVG.flow, output: SVG.download }; return svgMap[type] || SVG.flow;"
);

// Replace capture upload button emoji
code = code.replaceAll('title="Subir archivo" aria-label="Subir archivo">📎', 'title="Subir archivo" aria-label="Subir archivo">${SVG.upload}'); 

// Replace capture doc button emoji
code = code.replaceAll('title="Escanear documento" aria-label="Escanear documento">📄', 'title="Escanear documento" aria-label="Escanear documento">${SVG.doc}');

// Replace capture photo button emoji
code = code.replaceAll('title="Capturar foto" aria-label="Capturar foto">📷', 'title="Capturar foto" aria-label="Capturar foto">${SVG.camera}');

// Replace all remaining tool category icons
code = code.replace(/getCategoryIcon\(tool\.category\)/g, 'getCategoryIconSvg(tool.category)');

// Replace the old getCategoryIcon function with a new one that uses SVG
const oldFn = /function getCategoryIcon\(cat\) \{.*?\n\}/s;
const newFn = `function getCategoryIconSvg(cat) {
  const map = { pdf: SVG.pdf, images: SVG.image, text: SVG.text, documents: SVG.doc, spreadsheets: SVG.table, files: SVG.archive, qrcodes: SVG.qr, video: SVG.video, audio: SVG.audio, signatures: SVG.sign, ebooks: SVG.book, calculators: SVG.calc, image: SVG.image, document: SVG.doc, data: SVG.table, archive: SVG.archive, structured: SVG.text, other: SVG.file, ebook: SVG.book };
  return map[cat] || SVG.tool;
}`;
code = code.replace(oldFn, newFn);

// Replace remaining fav button emoji
code = code.replaceAll("'>♥</button>", "'>\${SVG.starFill}</button>");
code = code.replaceAll("'>♡</button>", "'>\${SVG.starOutline}</button>");

// Replace remaining capture area icons
code = code.replaceAll("capture-preview\">\n              <div style=\"color:var(--ws-muted);text-align:center;padding:24px\">\n                <div style=\"font-size:48px;margin-bottom:12px\">📷</div>",
  "capture-preview\">\n              <div style=\"color:var(--ws-muted);text-align:center;padding:24px\">\n                <div style=\"margin-bottom:12px\">\${SVG.camera}</div>");

// Fix block handle
code = code.replaceAll("⋮⋮</div>", "${SVG.close}</div>");

// Replace remaining 'tool-card' class references for tool cards
code = code.replaceAll("data-tool-id=\"${tool.id}\"", "data-tool-id=\"\${tool.id}\"");

writeFileSync(file, code);
console.log('Emoji replacement complete');

// Count remaining
const remaining = (code.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
console.log(`Remaining emojis: ${remaining}`);
