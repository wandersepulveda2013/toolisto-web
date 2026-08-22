#!/usr/bin/env node
/**
 * workflow-chart-e2e.mjs — data.to-chart: cadena real en navegador
 * text.to-table -> data.to-chart -> document.to-pdf. Se valida que la tabla
 * numerica produce una serie, el bloque 'chart' llega al PDF como seccion de
 * grafico (barras `re f`) y que un error de datos vacios se comunica sin
 * generar un PDF roto. Sin mocks: ejecuta las operaciones reales de dist.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts', 'workflow-chart-e2e');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://localhost:${PORT}/workspace/index.html`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
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
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

let pass = 0, fail = 0;
function ok(n, d = '') { pass++; console.log(`  PASS: [${n}] ${d}`); }
function ko(n, d = '') { fail++; console.log(`  FAIL: [${n}] ${d}`); }

async function runChartChain() {
  const { createOperationRegistry } = await import('/workspace/core/operation-registry.js');
  const { registerWorkflowOperations } = await import('/workspace/core/workflow-operations.js');
  const registry = createOperationRegistry();
  registerWorkflowOperations(registry);
  const toTable = registry.get('text.to-table');
  const toChart = registry.get('data.to-chart');
  const toPdf = registry.get('document.to-pdf');
  const report = registry.get('report.create');

  const table = await toTable.execute({ input: { data: { blocks: [{
    id: 't', type: 'paragraph', content: 'Trimestre|Ventas\nT1|1200\nT2|980\nT3|1450',
  }] } }, options: {} });
  const chartDoc = await toChart.execute({ input: { data: table }, options: { title: 'Ventas por trimestre' } });
  const pdf = await toPdf.execute({ input: { data: chartDoc }, options: {} });
  const text = await pdf.text();

  const reportDoc = await report.execute({ input: { data: table }, options: { includeDate: false } });
  const reportChart = (reportDoc.blocks || []).find(b => b.type === 'chart');
  const reportPdf = await toPdf.execute({ input: { data: reportDoc }, options: {} });
  const reportText = await reportPdf.text();

  let emptyError = '';
  try {
    await toChart.execute({ input: { data: { headers: ['A'], rows: [] } }, options: {} });
  } catch (err) {
    emptyError = String(err.message || err);
  }

  return {
    hasHeaders: Array.isArray(table.headers) && table.headers.length >= 2,
    chartBlock: (chartDoc.blocks || []).find(b => b.type === 'chart'),
    chartSeries: (chartDoc.blocks || []).find(b => b.type === 'chart')?.series || [],
    pdfStarts: text.startsWith('%PDF-1'),
    pdfHasTitle: text.includes('Ventas por trimestre'),
    pdfHasLabel: text.includes('T1') && text.includes('T3'),
    pdfHasBars: /re\s+f/.test(text),
    pdfHasValue: text.includes('1200') || text.includes('1450'),
    reportHasChart: !!reportChart,
    reportPdfHasTitle: reportText.includes('Grafico de Ventas'),
    reportPdfHasBars: /re\s+f/.test(reportText),
    emptyError,
  };
}

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}\n`);

try {
  console.log('=== Workflow data.to-chart chain (browser) ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  await page.goto(BASE + '?preview=internal', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const result = await page.evaluate(runChartChain);

  if (result.hasHeaders) ok('text.to-table produces headers from raw text'); else ko('text.to-table produces headers from raw text');
  if (result.chartBlock) ok('data.to-chart emits a chart block'); else ko('data.to-chart emits a chart block');
  if (result.chartSeries.length === 3) ok('chart block carries 3 numeric series');
  else ko('chart block carries 3 numeric series', String(result.chartSeries.length));
  if (result.chartSeries.every(s => Number.isFinite(s.value))) ok('series values are finite numbers'); else ko('series values are finite numbers');

  if (result.pdfStarts) ok('document.to-pdf produces a valid PDF header'); else ko('document.to-pdf produces a valid PDF header');
  if (result.pdfHasTitle) ok('PDF renders the chart title'); else ko('PDF renders the chart title');
  if (result.pdfHasLabel) ok('PDF renders series labels from the table'); else ko('PDF renders series labels from the table');
  if (result.pdfHasBars) ok('PDF draws real bar rectangles (re f)'); else ko('PDF draws real bar rectangles (re f)');
  if (result.pdfHasValue) ok('PDF renders a numeric series value'); else ko('PDF renders a numeric series value');

  if (result.reportHasChart) ok('report.create embeds a chart block for numeric data'); else ko('report.create embeds a chart block for numeric data');
  if (result.reportPdfHasTitle) ok('report chart title reaches the PDF'); else ko('report chart title reaches the PDF');
  if (result.reportPdfHasBars) ok('report chart draws bars in the PDF'); else ko('report chart draws bars in the PDF');

  if (result.emptyError && /tabla|numerica|graficar/i.test(result.emptyError)) ok('empty data is rejected with an actionable message');
  else ko('empty data is rejected with an actionable message', result.emptyError || 'no error');

  if (jsErrors.length === 0) ok('No uncaught JS errors during real browser execution');
  else ko('No uncaught JS errors during real browser execution', jsErrors.join(', '));

  await page.screenshot({ path: join(ARTIFACTS, 'workflow-chart.png'), fullPage: false });
  await browser.close();
  ok('E2E', 'chart chain browser run completed');
} catch (e) {
  console.error('  ERROR: ' + e.message);
  fail++;
} finally {
  srv.close();
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
