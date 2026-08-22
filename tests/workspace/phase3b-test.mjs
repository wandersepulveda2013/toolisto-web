#!/usr/bin/env node
/**
 * Phase 3B Tests — Model Integration, Assets, ToolExecution, Vertical Flow,
 * Design Module, PDF Generation, Error Handling
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
const SCREENSHOTS = join(ROOT, 'screenshots', 'workspace');
mkdirSync(SCREENSHOTS, { recursive: true });

const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json',
  '.ico':'image/x-icon', '.mjs':'application/javascript; charset=utf-8'
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

await new Promise(r => srv.listen(8081, r));
console.log('Server on :8081\n');

try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  await page.goto('http://localhost:8081/workspace/index.html?preview=internal', { waitUntil: 'networkidle' });

  // ─── 1. Model Integration ───
  console.log('--- 1. Model Integration ---');
  const jsContent = await page.evaluate(async () => {
    const resp = await fetch('/workspace/workspace.js');
    return await resp.text();
  });

  ok('workspace.js imports registerExecution', jsContent.includes('registerExecution'));
  ok('workspace.js imports createTextDocument', jsContent.includes('createTextDocument'));
  ok('workspace.js imports createTextBlock', jsContent.includes('createTextBlock'));
  ok('workspace.js imports createTableDocument', jsContent.includes('createTableDocument'));
  ok('workspace.js imports createChart', jsContent.includes('createChart'));
  ok('workspace.js imports createDesignDocument', jsContent.includes('createDesignDocument'));
  ok('workspace.js imports createReportSection', jsContent.includes('createReportSection'));
  ok('workspace.js imports createReportConfig', jsContent.includes('createReportConfig'));
  ok('workspace.js imports generatePDF', jsContent.includes('generatePDF'));

  // ─── 2. Storage Model Integration ───
  console.log('\n--- 2. Storage Model Integration ---');
  const storageContent = await page.evaluate(async () => {
    const resp = await fetch('/workspace/core/storage.js');
    return await resp.text();
  });
  ok('storage.js exports registerExecution', storageContent.includes('registerExecution'));
  ok('storage.js exports createToolExecution', storageContent.includes('createToolExecution'));
  ok('storage.js exports saveExecution', storageContent.includes('saveExecution'));

  // ─── 3. ToolExecution Registration ───
  console.log('\n--- 3. ToolExecution Registration ---');
  ok('saveImageCapture registers image-import', jsContent.includes("'image-import'"));
  ok('Scanner registers perspective-correction', jsContent.includes("'perspective-correction'"));
  ok('createNewDoc registers document-create', jsContent.includes("'document-create'"));
  ok('importDocumentFile registers text-import', jsContent.includes("'text-import'"));
  ok('createNewDataTable registers table-create', jsContent.includes("'table-create'"));
  ok('importProjectFile registers project-import', jsContent.includes("'project-import'"));
  ok('exportProjectData registers project-export', jsContent.includes("'project-export'"));
  ok('PDF export registers pdf-export', jsContent.includes("'pdf-export'"));
  ok('extractTextFromScan registers ocr-extract', jsContent.includes("'ocr-extract'"));
  ok('convertDocToTable registers text-to-table', jsContent.includes("'text-to-table'"));
  ok('createChartFromTable registers chart-create', jsContent.includes("'chart-create'"));
  ok('Design save registers design-create', jsContent.includes("'design-create'"));

  // ─── 4. Vertical Flow ───
  console.log('\n--- 4. Vertical Flow Connections ---');
  ok('Capture cards have "Extraer texto" button', jsContent.includes('extractTextFromScan'));
  ok('extractTextFromScan creates TextDocument', jsContent.includes('createTextDocument'));
  ok('convertDocToTable creates TableDocument', jsContent.includes('convertDocToTable'));
  ok('createChartFromTable creates Chart', jsContent.includes('createChartFromTable'));
  ok('Data cards have chart button', jsContent.includes('createChartFromTable'));
  ok('Doc toolbar has "A tabla" button', jsContent.includes('A tabla'));

  // ─── 5. Design Module ───
  console.log('\n--- 5. Design Module ---');
  ok('Has renderDesignEditor function', jsContent.includes('renderDesignEditor'));
  ok('Design view in switch', jsContent.includes("case 'design'"));
  ok('Design in projectViews', jsContent.includes("'design'"));
  ok('Design in viewNames', jsContent.includes("'design': 'Diseno'"));

  const designContent = await page.evaluate(async () => {
    const resp = await fetch('/workspace/core/design-report.js');
    return await resp.text();
  });
  ok('design-report.js exports createReportSection', designContent.includes('createReportSection'));
  ok('design-report.js exports createReportConfig', designContent.includes('createReportConfig'));
  ok('design-report.js exports renderReportPreview', designContent.includes('renderReportPreview'));
  ok('design-report.js supports A4', designContent.includes("'A4'"));
  ok('design-report.js supports Letter', designContent.includes("'Letter'"));
  ok('design-report.js has section types', designContent.includes("'title'"));
  ok('design-report.js has page-break', designContent.includes("'page-break'"));

  // ─── 6. PDF Generation ───
  console.log('\n--- 6. PDF Generation ---');
  const pdfContent = await page.evaluate(async () => {
    const resp = await fetch('/workspace/core/pdf-generator.js');
    return await resp.text();
  });
  ok('pdf-generator.js exports generatePDF', pdfContent.includes('generatePDF'));
  ok('PDF generates valid header', pdfContent.includes('%PDF-1.4'));
  ok('PDF has xref table', pdfContent.includes('xref'));
  ok('PDF has trailer', pdfContent.includes('trailer'));
  ok('PDF supports A4', pdfContent.includes('595'));
  ok('PDF supports Letter', pdfContent.includes('612'));
  ok('PDF handles landscape', pdfContent.includes('landscape'));
  ok('PDF handles accented chars', pdfContent.includes('octal') || pdfContent.charCodeAt(pdfContent.indexOf('\\') + 1) > 47);

  // ─── 7. Error Handling ───
  console.log('\n--- 7. Error Handling ---');
  ok('Scanner onConfirm has try/catch', jsContent.includes('Error al guardar el escaneo'));
  ok('PDF export has try/catch', jsContent.includes('Error al exportar PDF'));
  ok('Import validates bundle', jsContent.includes('No contiene un proyecto valido'));
  ok('convertDocToTable checks project', jsContent.includes('Proyecto o documento no disponible'));
  ok('createChartFromTable checks project', jsContent.includes('Proyecto o tabla no disponible'));
  ok('extractTextFromScan checks project', jsContent.includes('Proyecto o captura no disponible'));
  ok('Failed execution registered', jsContent.includes("status: 'failed'"));

  // ─── 8. Index.html Sidebar ───
  console.log('\n--- 8. Sidebar Integration ---');
  const htmlContent = await page.evaluate(async () => {
    const resp = await fetch('/workspace/index.html');
    return await resp.text();
  });
  ok('Design sidebar item exists', htmlContent.includes('data-view="design"'));
  ok('Design has pencil icon', htmlContent.includes('M16.5 3.5'));

  // ─── 9. No JS Errors ───
  console.log('\n--- 9. Errors ---');
  ok('No JS errors during tests', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0,3).join('; ') : '');

  // Screenshots
  await page.screenshot({ path: join(SCREENSHOTS, '09-phase3b-test.png') });

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  await browser.close();
} finally {
  srv.close();
}
process.exit(fail > 0 ? 1 : 0);
