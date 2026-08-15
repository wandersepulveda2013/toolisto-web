#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'workspace', 'workspace.js');
let code = readFileSync(file, 'utf8');

// All emoji -> SVG replacements in template literals and objects
const replacements = [
  // AnalyzeFile icons
  ["icon: '📄'", "icon: SVG.pdf"],
  ["icon: '🖼️'", "icon: SVG.image"],
  ["icon: '🎬'", "icon: SVG.video"],
  ["icon: '🎵'", "icon: SVG.audio"],
  ["icon: '📝'", "icon: SVG.doc"],
  ["icon: '📊'", "icon: SVG.table"],
  ["icon: '📦'", "icon: SVG.archive"],
  ["icon: '{ }'", "icon: SVG.text"],
  ["icon: '📃'", "icon: SVG.text"],
  ["icon: '📚'", "icon: SVG.book"],
  ["icon: '📎'", "icon: SVG.file"],
  // Palette command icons
  ["icon: '📁'", "icon: SVG.folder"],
  ["icon: '📥'", "icon: SVG.upload"],
  ["icon: '📊'", "icon: SVG.chart"],
  ["icon: '📷'", "icon: SVG.camera"],
  ["icon: '📝'", "icon: SVG.doc"],
  ["icon: '📋'", "icon: SVG.table"],
  ["icon: '🔍'", "icon: SVG.search"],
  ["icon: '⚡'", "icon: SVG.flow"],
  ["icon: '🧰'", "icon: SVG.wrench"],
  ["icon: '➕'", "icon: SVG.plus"],
  ["icon: '📎'", "icon: SVG.file"],
  ["icon: '🌙'", "icon: SVG.moon"],
  ["icon: '🏠'", "icon: SVG.folder"],
  // Context menu icons
  ["icon: '👁️'", "icon: SVG.search"],
  ["icon: '🗑️'", "icon: SVG.trash"],
  ["icon: '⬆️'", "icon: SVG.upload"],
  ["icon: '⬇️'", "icon: SVG.download"],
  ["icon: '✏️'", "icon: SVG.doc"],
  // Block menu icons
  ["icon: '🖼️'", "icon: SVG.image"],
  // Topbar
  ['"🔍"', '"search"'],
  // Button text with emoji
  ['>📎 Importar<', '>\' + SVG.upload + \' Importar<'],
  ['>💾 Guardar<', '>\' + SVG.save + \' Guardar<'],
  ['>📎 Seleccionar Archivos<', '>\' + SVG.upload + \' Seleccionar Archivos<'],
  ['>📥 Importar CSV<', '>\' + SVG.upload + \' Importar CSV<'],
  // File block
  ['<div class="file-block-icon">📎</div>', '<div class="file-block-icon">\${SVG.file}</div>'],
  // Doc view toggle
  ['>📄</button>', '>\' + SVG.doc + \'</button>'],
  ['>📤</button>', '>\' + SVG.download + \'</button>'],
  // Theme icon setup
  ["const icon = theme === 'auto' ? '🌙' : theme === 'light' ? '🌙' : '☀️';", "const svgIcon = theme === 'dark' ? SVG.sun : SVG.moon;"],
];

for (const [from, to] of replacements) {
  code = code.split(from).join(to);
}

// Replace remaining capture area emoji in template
code = code.replace(/<div style="font-size:48px;margin-bottom:12px">📷<\/div>/g, '<div style="margin-bottom:12px">${SVG.camera}</div>');

// Replace search button emoji in topbar
code = code.replace("ws-topbar-btn\" id=\"ws-search-btn\" title=\"Buscar (Ctrl+K)\" aria-label=\"Búsqueda rápida\">🔍</button>",
  "ws-topbar-btn\" id=\"ws-search-btn\" title=\"Buscar (Ctrl+K)\" aria-label=\"Búsqueda rápida\">${SVG.search}</button>");

// Replace old getCategoryIcon function completely
const oldFnRegex = /function getCategoryIcon\(cat\) \{[\s\S]*?\}/;
if (oldFnRegex.test(code)) {
  code = code.replace(oldFnRegex, '');
}

writeFileSync(file, code);
console.log('Done. Checking remaining...');

// Count
const remaining = (code.match(/[\u{1F300}-\u{1F9FF}]/gu) || []);
console.log(`Remaining emojis: ${remaining.length}`);
if (remaining.length > 0) {
  const lines = code.split('\n');
  const emojiLine = /[\u{1F300}-\u{1F9FF}]/u;
  lines.forEach((l, i) => { if (emojiLine.test(l)) console.log(`  L${i+1}: ${l.trim().substring(0,80)}`); });
}
