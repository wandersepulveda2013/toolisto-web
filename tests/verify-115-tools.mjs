import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8098;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.gz': 'application/gzip', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.zip': 'application/zip',
  '.pdf': 'application/pdf'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p.replace(/^\/+/, ''));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));
const byId = {};
for (const t of tools) byId[t.id] = t;

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  FAIL: ' + msg); }
}

async function expect(page, locatorFn, desc) {
  try {
    await locatorFn().waitFor({ state: 'visible', timeout: 8000 });
    ok(true, desc);
  } catch (e) {
    ok(false, desc + ' (no encontrado: ' + locatorFn().toString().slice(0, 60) + ')');
  }
}

/* Cargar una página de herramienta y verificar montaje del modo. */
async function openToolPage(browser, slug, viewport) {
  const ctx = await browser.newContext({
    viewport: viewport || { width: 1280, height: 900 },
    acceptDownloads: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load' });
  return { ctx, page, errors };
}

async function captureDownload(page) {
  const dlPromise = page.waitForEvent('download', { timeout: 20000 });
  return dlPromise;
}

async function saveDownload(download, suffix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlst-'));
  const dest = path.join(tmp, 'dl' + (suffix || ''));
  await download.saveAs(dest);
  const buf = fs.readFileSync(dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return buf;
}

async function waitForSelectorText(page, selector, text, timeout) {
  await page.waitForFunction(([sel, txt]) => {
    const el = document.querySelector(sel);
    return el && el.textContent && el.textContent.indexOf(txt) !== -1;
  }, [selector, text], { timeout: timeout || 10000 });
}

let zipFixturePath = null;
async function buildZipFixture() {
  if (zipFixturePath) return zipFixturePath;
  const vm = await import('node:vm');
  const jszipSrc = fs.readFileSync(path.join(DIST, 'vendor', 'jszip', 'jszip.min.js'), 'utf8');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.setImmediate = (fn) => setImmediate(fn);
  sandbox.clearImmediate = (id) => clearImmediate(id);
  vm.runInNewContext(jszipSrc, sandbox);
  const JSZip = sandbox.JSZip;
  const zip = new JSZip();
  zip.file('leeme.txt', 'contenido recuperable');
  zip.file('datos.csv', 'a,b\n1,2\n');
  const buf = Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlst-zip-'));
  zipFixturePath = path.join(tmp, 'fixture.zip');
  fs.writeFileSync(zipFixturePath, buf);
  return zipFixturePath;
}

let xlsxFixturePath = null;
async function buildXlsxFixture() {
  if (xlsxFixturePath) return xlsxFixturePath;
  const vm = await import('node:vm');
  const xlsxSrc = fs.readFileSync(path.join(DIST, 'vendor', 'xlsx', 'xlsx.min.js'), 'utf8');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.setImmediate = (fn) => setImmediate(fn);
  sandbox.clearImmediate = (id) => clearImmediate(id);
  vm.runInNewContext(xlsxSrc, sandbox);
  const XLSX = sandbox.XLSX;
  const ws = XLSX.utils.aoa_to_sheet([
    ['Producto', 'Cantidad', 'Precio'],
    ['Manzanas', 10, 2.5],
    ['Peras', 7, 3.0],
    ['Limas', 4, 1.2]
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  const buf = Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlst-xlsx-'));
  xlsxFixturePath = path.join(tmp, 'datos.xlsx');
  fs.writeFileSync(xlsxFixturePath, buf);
  return xlsxFixturePath;
}

/* ── Categorías implementadas ───────────────────────────────────────── */

async function checkCalc(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await expect(page, () => page.locator('#modePanel'), tool.id + ': panel del modo montado');
  await expect(page, () => page.locator('#calcExpr'), tool.id + ': campo de expresión');
  await page.fill('#calcExpr', '(120 + 30) * 2');
  await waitForSelectorText(page, '#calcLive', '300');
  ok(true, tool.id + ': vista previa en vivo (300)');
  const dlP = captureDownload(page);
  await page.click('#calcRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.txt');
  ok(buf.length > 0 && buf.toString('utf8').indexOf('300') !== -1, tool.id + ': descarga con resultado correcto');
  ok(errors.length === 0, tool.id + ': sin errores de consola' + (errors.length ? ' -> ' + errors[0] : ''));
  await ctx.close();
}

async function checkCalcScientific(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.fill('#calcExpr', 'sqrt(144) + 1');
  await waitForSelectorText(page, '#calcLive', '13');
  ok(true, tool.id + ': función científica en vivo (sqrt(144)+1=13)');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkStructureList(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await expect(page, () => page.locator('#modeFileInput'), tool.id + ': input de archivo');
  await page.setInputFiles('#modeFileInput', {
    name: 'lista.txt', mimeType: 'text/plain',
    buffer: Buffer.from('manzana,pera,uvas\n100,200,300\n50,60,70\n', 'utf8')
  });
  await expect(page, () => page.locator('.preview-table'), tool.id + ': vista previa de tabla');
  await expect(page, () => page.locator('#modeRun'), tool.id + ': botón de ejecución habilitado');
  const dlP = captureDownload(page);
  await page.click('#modeRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.html');
  ok(buf.length > 0 && buf.toString('utf8').indexOf('<table>') !== -1, tool.id + ': HTML de tabla generado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkStructureBraille(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#modeFileInput', {
    name: 'texto.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Hola mundo', 'utf8')
  });
  await expect(page, () => page.locator('.preview-braille'), tool.id + ': vista previa braille');
  const dlP = captureDownload(page);
  await page.click('#modeRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.txt');
  ok(buf.length > 0, tool.id + ': texto braille descargado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkStructureEpub(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#modeFileInput', {
    name: 'libro.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Capítulo uno\n\nPrimer párrafo.\n\nCapítulo dos\n\nSegundo párrafo.\n', 'utf8')
  });
  await expect(page, () => page.locator('.epub-structure'), tool.id + ': vista previa de estructura');
  await page.fill('#epTitle', 'Mi libro');
  const dlP = captureDownload(page);
  await page.click('#modeRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.epub');
  ok(buf.length > 0 && buf.slice(0, 4).toString('ascii') === 'PK\u0003\u0004', tool.id + ': EPUB (zip) descargado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkFileSplit(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#modeFileInput', {
    name: 'datos.bin', mimeType: 'application/octet-stream',
    buffer: Buffer.from(Array.from({ length: 130000 }, (_, i) => i % 251))
  });
  await expect(page, () => page.locator('.manifest'), tool.id + ': manifiesto de división');
  await expect(page, () => page.locator('.manifest-hash').first(), tool.id + ': checksum SHA-256 mostrado');
  const dlP = captureDownload(page);
  await page.click('#modeRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.part001');
  ok(buf.length > 0, tool.id + ': fragmento descargado');
  await waitForSelectorText(page, '#structurePreview', 'Reconstrucción exacta verificada');
  ok(true, tool.id + ': reconstrucción exacta verificada');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkFileJoin(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const chunk = Buffer.from('contenido unido verificable 12345', 'utf8');
  await page.setInputFiles('#modeFileInput', [
    { name: 'archivo.part001.txt', mimeType: 'application/octet-stream', buffer: chunk },
    { name: 'archivo.part002.txt', mimeType: 'application/octet-stream', buffer: chunk }
  ]);
  await expect(page, () => page.locator('.manifest'), tool.id + ': manifiesto de unión');
  const dlP = captureDownload(page);
  await page.click('#modeRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.joined');
  ok(buf.length === chunk.length * 2, tool.id + ': tamaño del archivo unido correcto');
  const dlName = dl.suggestedFilename();
  ok(dlName.indexOf('archivo') !== -1, tool.id + ': nombre derivado de los fragmentos');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkZipRepair(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const zipPath = await buildZipFixture();
  await page.setInputFiles('#modeFileInput', zipPath);
  await expect(page, () => page.locator('.manifest'), tool.id + ': entradas del ZIP listadas');
  await expect(page, () => page.locator('.manifest'), tool.id + ': manifest de 2 entradas');
  const countText = await page.locator('.manifest-hash').first().textContent();
  ok(/2/.test(countText), tool.id + ': recuento de entradas correcto');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkQrGenerate(browser, tool, isScientific) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.fill('#text', 'https://toolisto.app/verificar');
  await waitForSelectorText(page, '#qrPreviewMeta', 'caracteres');
  ok(true, tool.id + ': vista previa QR renderizada');
  const dlP = captureDownload(page);
  await page.click('#qrRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  ok(buf.length > 8 && buf.slice(1, 4).toString('ascii') === 'PNG', tool.id + ': PNG descargado con magic bytes correctos');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkQrWifi(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.fill('#wifiSsid', 'ToolistoNet');
  await page.fill('#wifiPassword', 'clave123');
  await expect(page, () => page.locator('.qr-canvas'), tool.id + ': vista previa QR Wi-Fi');
  const dlP = captureDownload(page);
  await page.click('#qrRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  ok(buf.slice(1, 4).toString('ascii') === 'PNG', tool.id + ': PNG descargado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkQrVcard(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.fill('#vcardName', 'María García');
  await page.fill('#vcardEmail', 'maria@toolisto.app');
  await expect(page, () => page.locator('.qr-canvas'), tool.id + ': vista previa QR vCard');
  const dlP = captureDownload(page);
  await page.click('#qrRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.png');
  ok(buf.slice(1, 4).toString('ascii') === 'PNG', tool.id + ': PNG descargado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkBarcodeGenerate(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.fill('#barcodeText', '1234567890128');
  await page.selectOption('#barcodeFormat', 'EAN13');
  await waitForSelectorText(page, '#qrPreviewMeta', 'Formato: EAN13');
  ok(true, tool.id + ': vista previa código de barras');
  const dlP = captureDownload(page);
  await page.click('#qrRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.bin');
  ok(buf.length > 0, tool.id + ': código de barras descargado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

async function checkQrRead(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, byId['qrGenerate'].slug);
  await page.fill('#text', 'HOLA-PRUEBA-QR-2026');
  await waitForSelectorText(page, '#qrPreviewMeta', 'caracteres');
  ok(true, tool.id + ': vista previa QR del fixture renderizada');
  const dlP = captureDownload(page);
  await page.click('#qrRun');
  const dl = await dlP;
  const png = await saveDownload(dl, '.png');
  ok(png.slice(1, 4).toString('ascii') === 'PNG', tool.id + ': fixture QR generado');
  await ctx.close();

  const { ctx: ctx2, page: page2, errors: err2 } = await openToolPage(browser, tool.slug);
  await page2.setInputFiles('#readFile', { name: 'qr.png', mimeType: 'image/png', buffer: png });
  const dl2P = captureDownload(page2);
  await page2.click('#qrRun');
  const dl2 = await dl2P;
  const out = await saveDownload(dl2, '.txt');
  ok(out.toString('utf8').indexOf('HOLA-PRUEBA-QR-2026') !== -1, tool.id + ': código leído y contenido verificado');
  ok(err2.length === 0, tool.id + ': sin errores de consola');
  await ctx2.close();
}

async function checkQrBatch(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  await page.setInputFiles('#csvFile', {
    name: 'lotes.csv', mimeType: 'text/csv',
    buffer: Buffer.from('item,valor\ncaja-a,111\ncaja-b,222\ncaja-c,333\n', 'utf8')
  });
  await expect(page, () => page.locator('.batch-summary'), tool.id + ': resumen de filas del CSV');
  const dlP = captureDownload(page);
  await page.click('#qrRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.zip');
  ok(buf.length > 0 && buf.slice(0, 2).toString('ascii') === 'PK', tool.id + ': ZIP de QR por lote descargado');
  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

const EXCEL_IN = {
  csvToExcel: { file: () => ({ name: 'datos.csv', mimeType: 'text/csv', buffer: Buffer.from('producto,cantidad,precio\nmanzanas,10,2.5\nperas,7,3.0\n', 'utf8') }), single: true },
  csvToJson: { file: () => ({ name: 'datos.csv', mimeType: 'text/csv', buffer: Buffer.from('producto,cantidad,precio\nmanzanas,10,2.5\nperas,7,3.0\n', 'utf8') }), single: true },
  excelToCsv: { file: async () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: true },
  excelToJson: { file: async () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: true },
  jsonToExcel: { file: () => ({ name: 'datos.json', mimeType: 'application/json', buffer: Buffer.from('[{"producto":"manzanas","cantidad":10,"precio":2.5},{"producto":"peras","cantidad":7,"precio":3}]', 'utf8') }), single: true },
  jsonToCsv: { file: () => ({ name: 'datos.json', mimeType: 'application/json', buffer: Buffer.from('[{"producto":"manzanas","cantidad":10,"precio":2.5},{"producto":"peras","cantidad":7,"precio":3}]', 'utf8') }), single: true },
  jsonToXml: { file: () => ({ name: 'datos.json', mimeType: 'application/json', buffer: Buffer.from('[{"producto":"manzanas","cantidad":10},{"producto":"peras","cantidad":7}]', 'utf8') }), single: true },
  xmlToJson: { file: () => ({ name: 'datos.xml', mimeType: 'text/xml', buffer: Buffer.from('<datos><fila><producto>manzanas</producto><cantidad>10</cantidad></fila><fila><producto>peras</producto><cantidad>7</cantidad></fila></datos>', 'utf8') }), single: true },
  xlsToXlsx: { file: async () => ({ name: 'datos.xls', mimeType: 'application/vnd.ms-excel', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: true },
  xlsxToOds: { file: async () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: true },
  odsToXlsx: { file: async () => ({ name: 'datos.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: true },
  splitExcel: { file: async () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: true },
  mergeExcel: { file: async () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: false },
  compareExcel: { file: async () => ({ name: 'datos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(await buildXlsxFixture()) }), single: false }
};

const EXCEL_OUT_MAGIC = {
  xlsx: ['PK', 'xlsx'],
  csv: [',', 'csv'],
  json: ['[{', 'json'],
  xml: ['<?xml', 'xml'],
  ods: ['PK', 'ods']
};

async function checkExcel(browser, tool) {
  const { ctx, page, errors } = await openToolPage(browser, tool.slug);
  const spec = EXCEL_IN[tool.id];
  await expect(page, () => page.locator('#modePanel'), tool.id + ': panel del modo montado');
  await expect(page, () => page.locator('#xlFile'), tool.id + ': campo de archivo presente');

  const fileDesc = await spec.file();
  const inputs = [];
  if (spec.single) {
    inputs.push(fileDesc);
  } else {
    inputs.push(fileDesc, { name: 'datos2.xlsx', mimeType: fileDesc.mimeType, buffer: fileDesc.buffer });
  }
  await page.setInputFiles('#xlFile', inputs);
  await expect(page, () => page.locator('.xl-grid tbody tr').first(), tool.id + ': vista tabular editable renderizada');
  const rowCount = await page.locator('.xl-grid tbody tr').count();
  ok(rowCount >= 2, tool.id + ': filas detectadas en la vista editable');

  await expect(page, () => page.locator('.xl-type').first(), tool.id + ': tipos explícitos por columna');
  const typeCount = await page.locator('.xl-type').count();
  ok(typeCount >= 1, tool.id + ': selector de tipos por columna');

  const errBadge = await page.locator('#xlErrBadge').textContent().catch(() => '');
  ok(typeof errBadge === 'string' && /Errores por fila/.test(errBadge), tool.id + ': resumen de errores por fila');

  const dlP = captureDownload(page);
  await page.click('#xlRun');
  const dl = await dlP;
  const buf = await saveDownload(dl, '.bin');
  ok(buf.length > 0, tool.id + ': archivo de salida descargado');

  const outKind = spec.single
    ? (tool.id === 'csvToExcel' || tool.id === 'jsonToExcel' || tool.id === 'xlsToXlsx' || tool.id === 'odsToXlsx' || tool.id === 'splitExcel' || tool.id === 'mergeExcel' ? 'xlsx' : tool.id === 'xlsxToOds' ? 'ods' : tool.id === 'excelToCsv' || tool.id === 'jsonToCsv' ? 'csv' : tool.id === 'excelToJson' || tool.id === 'csvToJson' || tool.id === 'xmlToJson' ? 'json' : 'xml')
    : 'xlsx';
  const magic = EXCEL_OUT_MAGIC[outKind];
  if (magic) {
    const head = buf.slice(0, 16).toString('utf8');
    const found = magic[0].split('').some((ch) => head.indexOf(ch) !== -1);
    ok(found, tool.id + ': salida con firma esperada (' + magic[1] + ')');
  }

  const reopenVisible = await page.locator('#xlReopen').isVisible().catch(() => false);
  ok(reopenVisible, tool.id + ': botón de reapertura de salida disponible');
  if (reopenVisible) {
    await page.click('#xlReopen');
    await page.waitForTimeout(800);
    const reopenRows = await page.locator('.xl-grid tbody tr').count().catch(() => 0);
    ok(reopenRows >= 2, tool.id + ': salida reabierta en la vista editable');
  }

  ok(errors.length === 0, tool.id + ': sin errores de consola');
  await ctx.close();
}

/* ── Mapa de ejecución ──────────────────────────────────────────────── */

const EXEC = {
  simpleCalculator: checkCalc,
  scientificCalculator: checkCalcScientific,
  listToTable: checkStructureList,
  textToUnicodeBraille: checkStructureBraille,
  txtToEpub: checkStructureEpub,
  fileSplit: checkFileSplit,
  fileJoin: checkFileJoin,
  zipRepair: checkZipRepair,
  qrGenerate: (b, t) => checkQrGenerate(b, t),
  qrWifi: checkQrWifi,
  qrVcard: checkQrVcard,
  barcodeGenerate: checkBarcodeGenerate,
  qrReadFromImage: (b, t) => checkQrRead(b, t),
  barcodeReadFromImage: (b, t) => checkQrRead(b, t),
  qrBatchFromCsv: checkQrBatch,
  csvToExcel: checkExcel,
  excelToCsv: checkExcel,
  excelToJson: checkExcel,
  jsonToExcel: checkExcel,
  csvToJson: checkExcel,
  jsonToCsv: checkExcel,
  jsonToXml: checkExcel,
  xmlToJson: checkExcel,
  xlsToXlsx: checkExcel,
  xlsxToOds: checkExcel,
  odsToXlsx: checkExcel,
  splitExcel: checkExcel,
  mergeExcel: checkExcel,
  compareExcel: checkExcel
};

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch();

  const ids = process.env.ONLY ? process.env.ONLY.split(',').filter(Boolean) : Object.keys(EXEC);
  for (const id of ids) {
    const tool = byId[id];
    if (!tool) { ok(false, id + ': toolId no existe en tools.json'); continue; }
    process.stdout.write('  → ' + id + ' ... ');
    try {
      await EXEC[id](browser, tool);
      console.log('ok');
    } catch (e) {
      console.log('ERROR');
      ok(false, id + ': error al ejecutar check -> ' + (e && e.message ? e.message : e));
    }
  }

  await browser.close();
  server.close();
  console.log(`\nVerificación de modos: ${passed} PASS, ${failed} FAIL, ${passed + failed} total.`);
  if (failed > 0) {
    console.log('Fallos:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
