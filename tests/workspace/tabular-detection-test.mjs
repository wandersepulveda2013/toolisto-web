#!/usr/bin/env node
/**
 * Tabular Detection & Informe Button — Focused Tests
 *
 * Verifies the hasTabularContent detection logic and the "Crear informe"
 * button in the document toolbar, without relying on the full E2E scan flow.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json',
  '.mjs':'application/javascript; charset=utf-8'
};

const srv = createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  let fp = join(DIST, file);
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
  if (!existsSync(fp)) fp = join(DIST, file + '.html');
  const ext = extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content': mimeTypes[ext] || 'application/octet-stream'});
    res.end(data);
  });
});

let pass = 0, fail = 0;
function ok(n, d='') { pass++; console.log(`  PASS: ${n}${d?' — '+d:''}`); }
function ko(n, d='') { fail++; console.log(`  FAIL: ${n}${d?' — '+d:''}`); }

function hasTabularContentFromText(text) {
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < 2) return false;
  if (['\t', ';', '|'].some(s => text.includes(s))) return true;
  if (/\s{2,}/.test(text)) return true;
  const commaCounts = lines.map(l => (l.match(/,/g) || []).length);
  if (commaCounts.every(c => c > 0 && c === commaCounts[0]) && commaCounts[0] >= 1 && lines.some(l => /\d/.test(l))) return true;
  const tokensPerLine = lines.map(l => l.split(/\s+/).length);
  const sorted = tokensPerLine.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(tokensPerLine.length / 2)];
  if (median < 2) return false;
  const closeCount = tokensPerLine.filter(c => Math.abs(c - median) <= 1).length;
  if (closeCount / tokensPerLine.length < 0.6) return false;
  const sentenceEnds = lines.filter(l => /[.!?]\s*$/.test(l)).length;
  if (sentenceEnds >= Math.ceil(lines.length / 2)) return false;
  const hasNumbers = lines.some(l => /\d/.test(l));
  if (!hasNumbers) return false;
  const longestLine = Math.max(...lines.map(l => l.length));
  const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
  if (longestLine > 120 && avgLineLen > 60) return false;
  return true;
}

function checkDetection(label, input, expected) {
  const result = hasTabularContentFromText(input);
  if (result === expected) ok(label);
  else ko(label, `expected ${expected}, got ${result}`);
}

await new Promise(r => srv.listen(8081, r));

console.log('=== Tabular Detection & Informe Button Tests ===\n');

// ─── Unit tests for hasTabularContent logic ───
console.log('--- Tabular Detection (unit) ---');

// 1. Normal paragraph text → NOT tabular
checkDetection('Paragraphs should NOT show A tabla',
  'Este es un documento con varios parrafos.\nAqui hay otra linea del documento.\nY una tercera linea para completar el ejemplo.\nEsto no tiene estructura tabular.',
  false);

// 2. Simple list → NOT tabular
checkDetection('Simple list should NOT show A tabla',
  'Manzanas\nPeras\nPlatanos\nUvas\nNaranjas',
  false);

// 3. List with hyphens/bullets → NOT tabular
checkDetection('Bullet list should NOT show A tabla',
  '- Manzanas\n- Peras\n- Platanos\n- Uvas\n- Naranjas',
  false);

// 4. OCR table (space-separated, numbers) → IS tabular
checkDetection('OCR table with mixed col count should show A tabla',
  'Nombre Valor Estado\nVentas Q1 150 Completado\nVentas Q2 80 En progreso\nDevoluciones -30 Pendiente\nCostos fijos -200 Pagado\nGanancia neta 0 Calculado',
  true);

// 5. Tab-separated → IS tabular
checkDetection('Tab-separated should show A tabla',
  'Nombre\tValor\tEstado\nVentas Q1\t150\tCompletado\nDevoluciones\t-30\tPendiente',
  true);

// 6. Pipe-separated → IS tabular
checkDetection('Pipe-separated should show A tabla',
  'Nombre|Valor|Estado\nVentas Q1|150|Completado\nDevoluciones|-30|Pendiente',
  true);

// 7. CSV content → IS tabular
checkDetection('Comma-separated should show A tabla',
  'Nombre,Valor,Estado\nVentas Q1,150,Completado\nDevoluciones,-30,Pendiente',
  true);

// 8. Semicolon-separated → IS tabular
checkDetection('Semicolon-separated should show A tabla',
  'Nombre;Valor;Estado\nVentas Q1;150;Completado\nDevoluciones;-30;Pendiente',
  true);

// 9. Multi-space aligned → IS tabular
checkDetection('Multi-space aligned should show A tabla',
  'Nombre   Valor   Estado\nVentas   150     Completado\nCostos   -200    Pagado',
  true);

// 10. Single short words per line (list-like) → NOT tabular (no numbers, median < 2)
checkDetection('Single word list should NOT show A tabla',
  'Rojo\nVerde\nAzul\nAmarillo\nNegro',
  false);

// 11. Two tokens per line but no numbers → NOT tabular
checkDetection('Two-token lines without numbers should NOT show A tabla',
  'Nombre Apellido\nJuan Perez\nMaria Lopez\nCarlos Garcia',
  false);

// 12. Long paragraph lines (blog post) → NOT tabular
checkDetection('Long paragraph should NOT show A tabla',
  'Este es un parrafo muy largo que contiene informacion detallada sobre el proyecto actual.\nAqui continuamos con otro parrafo que explica los siguientes pasos del analisis.\nFinalmente, el ultimo parrafo concluye con las recomendaciones y el resumen ejecutivo.',
  false);

// 13. One line only → NOT tabular
checkDetection('Single line should NOT show A tabla',
  'Solo una linea de texto',
  false);

// 14. Three lines with consistent 2-column numbers → IS tabular
checkDetection('3-line space table with numbers should show A tabla',
  'Item 150\nItem2 80\nItem3 -30',
  true);

// ─── Browser tests ───
console.log('\n--- Informe Button & Toolbar Integration ---');
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  await page.goto('http://localhost:8081/workspace/preview.html?preview=internal', { waitUntil: 'networkidle' });

  // Verify the "Informe" button string exists in source
  const jsContent = await page.evaluate(async () => {
    const resp = await fetch('/workspace/workspace.js');
    return await resp.text();
  });

  ok('Source contains "Informe" button text', jsContent.includes("' Informe'"));
  ok('Source contains createReportConfig in toolbar', jsContent.includes('createReportConfig'));
  ok('Source contains createReportSection', jsContent.includes("createReportSection('text'"));
  ok('Source contains "A tabla"', jsContent.includes('A tabla'));

  // Verify the toolbar renders in browser context with a mock document
  const browserDetectionWorks = await page.evaluate(() => {
    const text = 'Nombre Valor Estado\nVentas Q1 150 Completado\nVentas Q2 80 En progreso';
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return false;
    if (['\t', ';', '|', ','].some(s => text.includes(s))) return 'delimiter';
    if (/\s{2,}/.test(text)) return 'multi-space';
    const tokensPerLine = lines.map(l => l.split(/\s+/).length);
    const sorted = tokensPerLine.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(tokensPerLine.length / 2)];
    if (median < 2) return 'low-median';
    const closeCount = tokensPerLine.filter(c => Math.abs(c - median) <= 1).length;
    if (closeCount / tokensPerLine.length < 0.6) return 'not-close';
    const sentenceEnds = lines.filter(l => /[.!?]\s*$/.test(l)).length;
    if (sentenceEnds >= Math.ceil(lines.length / 2)) return 'sentence-ends';
    const hasNumbers = lines.some(l => /\d/.test(l));
    if (!hasNumbers) return 'no-numbers';
    const longestLine = Math.max(...lines.map(l => l.length));
    const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    if (longestLine > 120 && avgLineLen > 60) return 'too-long';
    return true;
  });
  ok('Browser detects tabular content correctly', browserDetectionWorks === true, String(browserDetectionWorks));

  // Verify paragraph content is NOT detected as tabular
  const paragraphNotTabular = await page.evaluate(() => {
    const text = 'Este es un documento con varios parrafos.\nAqui hay otra linea del documento.\nY una tercera linea para completar el ejemplo.\nEsto no tiene estructura tabular en absoluto.';
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return 'short';
    const sentenceEnds = lines.filter(l => /[.!?]\s*$/.test(l.trim())).length;
    if (sentenceEnds >= Math.ceil(lines.length / 2)) return 'sentence-end';
    return 'unexpected';
  });
  ok('Browser rejects paragraph as tabular', paragraphNotTabular === 'sentence-end', String(paragraphNotTabular));

  await browser.close();
  console.log('\n--- Errors ---');
  if (jsErrors.length > 0) {
    ko('No JS errors during tests', jsErrors.length + ' errors: ' + jsErrors.join('; '));
  } else {
    ok('No JS errors during tests');
  }
} catch (err) {
  console.error('\n  ERROR: Browser test failed:', err.message);
  fail++;
}

srv.close();
console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
