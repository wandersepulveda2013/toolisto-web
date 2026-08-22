#!/usr/bin/env node
/**
 * invoice-fields-e2e.mjs — CE-042: el flujo real de factura en navegador.
 * Valida la instruccion "extrae el texto de la factura" sobre un canvas de
 * captura con contenido de factura: el parser marca _extractFields, el planner
 * encadena image.ocr -> text.invoice-fields y el flujo ejecutado devuelve una
 * tabla Campo/Valor/Confianza/Pagina con campos reales del OCR. Sin mocks:
 * OCR real con Tesseract local, operaciones reales de dist y cero errores de
 * consola.
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
const ARTIFACTS = join(ROOT, 'artifacts', 'invoice-fields-e2e');
mkdirSync(ARTIFACTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8082);
const BASE = `http://localhost:${PORT}/workspace/index.html`;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
  '.wasm': 'application/wasm', '.gz': 'application/gzip',
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

async function runInvoiceChain() {
  const INVOICE_LINES = [
    'FACTURA ELECTRONICA',
    'N.00123',
    'Proveedor: Comercial Ltda.',
    'RNC: 101-23456-7',
    'Cliente: Juan Perez',
    'Fecha de emision: 2026-08-01',
    'Fecha de vencimiento: 2026-08-31',
    'Moneda: DOP',
    'Metodo de pago: Transferencia',
    'Descripcion  Cantidad  Precio  Importe',
    'Servicio de diseno  1  2500.00  2500.00',
    'Subtotal: 2500.00',
    'ITBIS: 450.00',
    'Total: 2950.00',
  ];

  // Captura real: canvas con el texto de la factura.
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 820;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 34px Arial';
  ctx.fillText('FACTURA ELECTRONICA', 40, 80);
  ctx.fillText('N.00123', 40, 130);
  ctx.font = '28px Arial';
  INVOICE_LINES.slice(4).forEach((line, i) => {
    ctx.fillText(line, 40, 190 + i * 44);
  });

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'factura-captura.png', { type: 'image/png' });

  const { createOperationRegistry } = await import('/workspace/core/operation-registry.js');
  const { registerWorkflowOperations } = await import('/workspace/core/workflow-operations.js');
  const { createInstructionParser } = await import('/workspace/core/instruction-parser.js');
  const { createInstructionPlanner } = await import('/workspace/core/instruction-planner.js');
  const { createWorkflowEngine } = await import('/workspace/core/workflow-engine.js');

  const registry = createOperationRegistry();
  registerWorkflowOperations(registry);

  const parser = createInstructionParser();
  const parsed = parser.parse('extrae el texto de la factura');
  const ocrIntent = (parsed.intents || []).find(i => i.action === 'ocr');

  const planner = createInstructionPlanner(registry);
  const plan = planner.plan(parsed, [{ id: 'cap1', name: 'factura-captura.png', type: 'image/png', kind: 'image' }]);
  const steps = plan.workflow ? plan.workflow.getActiveSteps() : [];
  const assumptionExtract = (plan.assumptions || []).some(a => a.option === '_extractFields');

  const engine = createWorkflowEngine(registry);
  const runResult = await engine.run(plan.workflow, {
    cap1: { data: file, kind: 'image', name: 'factura-captura.png' },
  });
  const jobResult = runResult.results ? runResult.results['cap1'] : null;
  const output = jobResult && jobResult.data ? jobResult.data.data : null;
  const headers = output && Array.isArray(output.headers) ? output.headers : [];
  const rows = output && Array.isArray(output.rows) ? output.rows : [];
  const extracted = rows.filter(r => r && r[1]).length;
  const invoiceNumber = (rows.find(r => r && r[0] === 'Número de factura') || [])[1] || '';
  const total = (rows.find(r => r && r[0] === 'Total') || [])[1] || '';
  engine.destroy();

  return {
    hasOcrIntent: !!ocrIntent,
    extractFieldsOption: !!(ocrIntent && ocrIntent.options._extractFields),
    stepCount: steps.length,
    firstStep: steps[0] ? steps[0].operationId : '',
    secondStep: steps[1] ? steps[1].operationId : '',
    assumptionExtract,
    runSuccess: runResult.success,
    engineState: runResult.state,
    headers,
    rowCount: rows.length,
    extracted,
    invoiceNumber,
    total,
    confidence: output && typeof output.confidence === 'number' ? output.confidence : -1,
  };
}

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}\n`);

try {
  console.log('=== Invoice fields flow (browser, real OCR) ===\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push('console: ' + msg.text()); });

  await page.goto(BASE + '?preview=internal', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const result = await page.evaluate(runInvoiceChain);

  console.log('--- Intencion y plan ---');
  if (result.hasOcrIntent && result.extractFieldsOption) ok('La instruccion real detecta OCR con _extractFields (factura)');
  else ko('La instruccion real detecta OCR con _extractFields (factura)');
  if (result.stepCount === 2) ok('El planner encadena los dos pasos esperados');
  else ko('El planner encadena los dos pasos esperados', `${result.stepCount} pasos`);
  if (result.firstStep === 'image.ocr') ok('Paso 1 del plan es image.ocr');
  else ko('Paso 1 del plan es image.ocr', result.firstStep);
  if (result.secondStep === 'text.invoice-fields') ok('Paso 2 del plan es text.invoice-fields');
  else ko('Paso 2 del plan es text.invoice-fields', result.secondStep);
  if (result.assumptionExtract) ok('El plan publica la suposicion de extraccion de campos');
  else ko('El plan publica la suposicion de extraccion de campos');

  console.log('--- Ejecucion real (OCR -> campos -> tabla) ---');
  if (result.runSuccess) ok('El flujo ejecutado completó sin errores', result.engineState);
  else ko('El flujo ejecutado completó sin errores', result.engineState);
  if (result.headers.join('|') === 'Campo|Valor|Confianza|Página') ok('La salida es una tabla con encabezados Campo/Valor/Confianza/Pagina');
  else ko('La salida es una tabla con encabezados Campo/Valor/Confianza/Pagina', result.headers.join('|'));
  if (result.rowCount >= 10) ok('La tabla mantiene las filas de campos de factura', `${result.rowCount} filas`);
  else ko('La tabla mantiene las filas de campos de factura', `${result.rowCount} filas`);
  if (result.extracted >= 6) ok('El OCR extrajo al menos 6 campos reales', `${result.extracted} campos`);
  else ko('El OCR extrajo al menos 6 campos reales', `${result.extracted} campos`);
  if (result.invoiceNumber) ok('El numero de factura llega desde el OCR', result.invoiceNumber);
  else ko('El numero de factura llega desde el OCR');
  if (result.total) ok('El Total de la factura llega desde el OCR', result.total);
  else ko('El Total de la factura llega desde el OCR');
  if (typeof result.confidence === 'number' && result.confidence > 0) ok('La extraccion expone confianza global', `${result.confidence}%`);
  else ko('La extraccion expone confianza global', String(result.confidence));

  console.log('--- Errores ---');
  if (jsErrors.length === 0) ok('Cero errores de consola durante el flujo real');
  else ko('Cero errores de consola durante el flujo real', jsErrors.slice(0, 5).join('; '));

  console.log(`\nResultado resumido: steps=${result.stepCount} extr=${result.extracted} invoice=${result.invoiceNumber} total=${result.total} state=${result.engineState}`);
  await page.screenshot({ path: join(ARTIFACTS, 'invoice-fields-e2e.png'), fullPage: false });
  await browser.close();
  ok('E2E', 'flujo de factura completado en navegador');
} catch (e) {
  console.error('  ERROR: ' + e.message);
  fail++;
} finally {
  srv.close();
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
