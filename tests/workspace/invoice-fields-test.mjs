#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const invoiceCode = readFileSync(join(ROOT, 'workspace', 'core', 'invoice.js'), 'utf8');
const opsCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-operations.js'), 'utf8');
const parserCode = readFileSync(join(ROOT, 'workspace', 'core', 'instruction-parser.js'), 'utf8');
const modelCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-model.js'), 'utf8');
const plannerCode = readFileSync(join(ROOT, 'workspace', 'core', 'instruction-planner.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const sandbox = { console, Map, Array, Object, Error, RegExp, parseInt, Math, Set, Number, Date, JSON };
const sandboxArgs = ['console', 'Map', 'Array', 'Object', 'Error', 'RegExp', 'parseInt', 'Math', 'Set', 'Number', 'Date', 'JSON'];

const invoiceFn = new Function(...sandboxArgs,
  stripImports(invoiceCode) + '\nreturn { parseInvoiceText, invoiceRows };'
);
const { parseInvoiceText, invoiceRows } = invoiceFn(...Object.values(sandbox));

const opsFn = new Function(...sandboxArgs,
  stripImports(invoiceCode) + '\n' + stripImports(opsCode) + '\nreturn { registerWorkflowOperations, parseInvoiceText };'
);
const opsModule = opsFn(...Object.values(sandbox));

const parserFn = new Function(...sandboxArgs,
  stripImports(parserCode) + '\nreturn { createInstructionParser };'
);
const { createInstructionParser } = parserFn(...Object.values(sandbox));

const plannerFn = new Function(...sandboxArgs,
  stripImports(modelCode) + '\n' + stripImports(plannerCode) + '\nreturn { createWorkflowModel, createInstructionPlanner };'
);
const { createWorkflowModel, createInstructionPlanner } = plannerFn(...Object.values(sandbox));

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Invoice Fields Extraction Tests ===\n');

const SAMPLE_INVOICE = [
  'FACTURA ELECTRONICA N.00123',
  'Proveedor: Comercial Ltda.',
  'RNC: 101-23456-7',
  'Cliente: Juan Perez',
  'Fecha de emision: 2026-08-01',
  'Fecha de vencimiento: 2026-08-31',
  'Moneda: DOP',
  'Metodo de pago: Transferencia',
  'Descripcion    Cantidad   Precio   Importe',
  'Servicio de diseno        1      2500.00   2500.00',
  'Subtotal: 2500.00',
  'ITBIS: 450.00',
  'Total: 2950.00',
].join('\n');

// 1. core/invoice.js — direct parser
const parsed = parseInvoiceText(SAMPLE_INVOICE);
check('Invoice parser: numero de factura', parsed.fields.invoiceNumber.value === 'N.00123', parsed.fields.invoiceNumber.value);
check('Invoice parser: proveedor', parsed.fields.supplier.value === 'Comercial Ltda.', parsed.fields.supplier.value);
check('Invoice parser: total extraido', parsed.fields.total.value.includes('2950'), parsed.fields.total.value);
check('Invoice parser: confianza mayor 0', parsed.confidence > 0, String(parsed.confidence));
check('Invoice parser: line items detectados', parsed.lineItems.length > 0, String(parsed.lineItems.length));

const rows = invoiceRows(parsed, 1);
check('Invoice rows: 11 campos', rows.length === 11, String(rows.length));
check('Invoice rows: etiqueta numero de factura', rows[0][0] === 'Número de factura', rows[0][0]);
check('Invoice rows: valor extraido', rows[0][1] === 'N.00123', rows[0][1]);
check('Invoice rows: confianza etiquetada', /^86%$/.test(rows[0][2]), rows[0][2]);
check('Invoice rows: linea de pagina', rows[0][3] === '1', rows[0][3]);

const sparse = parseInvoiceText('Total: 100.00');
check('Invoice rows: campos vacios marcados pendiente', invoiceRows(sparse, 1).some(r => r[2] === 'Pendiente'));

// 2. operation text.invoice-fields — registered and executable
const reg = {
  _ops: {},
  register(op) { if (this._ops[op.id]) return false; this._ops[op.id] = op; return true; },
  get(id) { return this._ops[id] || null; },
  has(id) { return id in this._ops; },
  list() { return Object.values(this._ops); },
  listCompatible(kind) { return Object.values(this._ops).filter(op => op.inputKinds.includes(kind)); },
  listByCategory(cat) { return Object.values(this._ops).filter(op => op.category === cat); },
};
opsModule.registerWorkflowOperations(reg);

check('Operation text.invoice-fields registrada', reg.has('text.invoice-fields'));
const invoiceOp = reg.get('text.invoice-fields');
check('Operation nombre en espanol', invoiceOp.name === 'Extraer campos de factura');
check('Operation categoria text', invoiceOp.category === 'text');
check('Operation acepta text', invoiceOp.inputKinds.includes('text'));
check('Operation produce data', invoiceOp.outputKind === 'data');

const opResult = await invoiceOp.execute({ input: { data: SAMPLE_INVOICE }, options: {} });
check('Operation headers Campo/Valor/Confianza/Pagina', opResult.headers.join('|') === 'Campo|Valor|Confianza|Página', opResult.headers.join('|'));
check('Operation fila numero de factura', opResult.rows[0][0] === 'Número de factura' && opResult.rows[0][1] === 'N.00123');
check('Operation expone confianza global', typeof opResult.confidence === 'number' && opResult.confidence > 0, String(opResult.confidence));

// 3. instruction-parser — _extractFields intent
const parser = createInstructionParser();
const parsedIntent = parser.parse('extrae el texto de la factura');
const ocrIntent = (parsedIntent.intents || []).find(i => i.action === 'ocr');
check('Parser detecta accion ocr', !!ocrIntent);
check('Parser marca _extractFields para factura', ocrIntent && ocrIntent.options._extractFields === true);

const parsedReceipt = parser.parse('saca el texto del recibo');
const ocrReceipt = (parsedReceipt.intents || []).find(i => i.action === 'ocr');
check('Parser marca _extractFields para recibo', ocrReceipt && ocrReceipt.options._extractFields === true);

const parsedPlain = parser.parse('extrae el texto del documento');
const ocrPlain = (parsedPlain.intents || []).find(i => i.action === 'ocr');
check('Parser NO marca _extractFields sin factura/recibo', ocrPlain && ocrPlain.options._extractFields === undefined);

// 4. instruction-planner — chains invoice-fields after ocr
const mockRegistry = {
  _ops: {},
  register(op) { if (this._ops[op.id]) return false; this._ops[op.id] = op; return true; },
  get(id) { return this._ops[id] || null; },
  has(id) { return id in this._ops; },
  list() { return Object.values(this._ops); },
  listCompatible(kind) { return Object.values(this._ops).filter(op => op.inputKinds.includes(kind)); },
  listByCategory(cat) { return Object.values(this._ops).filter(op => op.category === cat); },
};
const mockOps = [
  { id: 'image.ocr', name: 'Extraer texto (OCR)', category: 'text', inputKinds: ['image'], outputKind: 'text', optionSchema: {} },
  { id: 'text.invoice-fields', name: 'Extraer campos de factura', category: 'text', inputKinds: ['text'], outputKind: 'data', optionSchema: {} },
];
for (const op of mockOps) mockRegistry.register(op);

const planner = createInstructionPlanner(mockRegistry);
const planInvoice = planner.plan(
  { intents: [{ action: 'ocr', target: 'text', options: { language: 'spa', _extractFields: true } }], outputPreferences: {}, warnings: [], unknownSegments: [] },
  [{ id: 'f1', name: 'factura.jpg', type: 'image/jpeg', kind: 'image' }]
);
check('Plan factura: 2 pasos encadenados', planInvoice.workflow.getActiveSteps().length === 2, String(planInvoice.workflow.getActiveSteps().length));
check('Plan factura: paso 1 es image.ocr', planInvoice.workflow.getActiveSteps()[0].operationId === 'image.ocr');
check('Plan factura: paso 2 es text.invoice-fields', planInvoice.workflow.getActiveSteps()[1].operationId === 'text.invoice-fields');
check('Plan factura: asuncion de extraccion', planInvoice.assumptions.some(a => a.option === '_extractFields'));

const planPlain = planner.plan(
  { intents: [{ action: 'ocr', target: 'text', options: { language: 'spa' } }], outputPreferences: {}, warnings: [], unknownSegments: [] },
  [{ id: 'f1', name: 'doc.jpg', type: 'image/jpeg', kind: 'image' }]
);
check('Plan sin factura: 1 solo paso', planPlain.workflow.getActiveSteps().length === 1, String(planPlain.workflow.getActiveSteps().length));

// without the operation registered, no chaining occurs
const noFieldsRegistry = {
  _ops: {},
  register(op) { if (this._ops[op.id]) return false; this._ops[op.id] = op; return true; },
  get(id) { return this._ops[id] || null; },
  has(id) { return id in this._ops; },
  list() { return Object.values(this._ops); },
  listCompatible(kind) { return Object.values(this._ops).filter(op => op.inputKinds.includes(kind)); },
  listByCategory(cat) { return Object.values(this._ops).filter(op => op.category === cat); },
};
noFieldsRegistry.register({ id: 'image.ocr', name: 'Extraer texto (OCR)', category: 'text', inputKinds: ['image'], outputKind: 'text', optionSchema: {} });
const plannerNoFields = createInstructionPlanner(noFieldsRegistry);
const planWithoutOp = plannerNoFields.plan(
  { intents: [{ action: 'ocr', target: 'text', options: { language: 'spa', _extractFields: true } }], outputPreferences: {}, warnings: [], unknownSegments: [] },
  []
);
check('Sin operacion registrada: no enlaza paso fantasma', planWithoutOp.workflow.getActiveSteps().length === 1);

console.log('\n=== Resultado ===');
console.log('PASS: ' + pass + ', FAIL: ' + fail);
process.exit(fail > 0 ? 1 : 0);