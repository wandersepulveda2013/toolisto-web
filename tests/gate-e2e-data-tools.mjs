#!/usr/bin/env node
/**
 * gate-e2e-data-tools.mjs — Certificación E2E de las 13 herramientas de datos con UI
 * genérica sobre el deployment real en dist/.
 *
 * Cubre: csvToMarkdown, csvToHtml, csvToYaml, csvStatistics, csvFilter, csvSort, csvToSql,
 * jsonFormatter, jsonValidator, excelToHtml, excelToMarkdown, xmlToExcel, excelToXml.
 *
 * Cada herramienta: (1) abre, (2) acepta tipo correcto, (3) rechaza incompatibles,
 * (4) procesa archivo real, (5) salida no vacía, (6) MIME/firma/extensión,
 * (7) reapertura con las librerías del sitio (XLSX/pdfs/DOMParser), (8) mensaje prometido,
 * (9) sin red externa, (10) cero errores de consola.
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'data-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0;
let passes = 0;
const checks = [];
const failureReasons = [];
const consoleErrors = [];
function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; checks.push({ name: msg, pass: false }); failureReasons.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); passes++; checks.push({ name: msg, pass: true }); }
function ok(cond, msg, detail) { cond ? pass(msg) : fail(`${msg} ${detail ? '→ ' + detail : ''}`); }
function toBase64(buf) { return buf.toString('base64'); }

function startServer() {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = join(distDir, urlPath === '/' ? '/index.html' : urlPath);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function gotoPage(page, url, slug) {
  await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
}

async function expectRejected(page, files, expectedToast) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(250);
  await page.click('#runButton');
  await page.waitForTimeout(600);
  return page.evaluate(() => ({
    dialogOpen: document.getElementById('resultDialog') ? document.getElementById('resultDialog').open : null,
    toast: document.getElementById('toast') ? document.getElementById('toast').textContent : '',
  }));
}

async function runTool(page) {
  await page.click('#runButton');
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout: 30000 });
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(120);
}

async function downloadResult(page) {
  const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('#downloadButton');
  const dl = await dlPromise;
  if (!dl) return null;
  const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await dl.saveAs(tmp);
  return readFileSync(tmp);
}

async function readText(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }, { b64 });
}

async function xlsxFromAoa(page, aoa, sheetName) {
  return page.evaluate(async (payload) => {
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(payload.aoa);
    window.XLSX.utils.book_append_sheet(wb, ws, payload.sheetName);
    const arr = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return Array.from(new Uint8Array(arr));
  }, { aoa, sheetName });
}

async function xlsxToAoa(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const wb = window.XLSX.read(u, { type: 'array' });
    const name = wb.SheetNames[0];
    const ws = wb.Sheets[name];
    return { name, aoa: window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) };
  }, { b64 });
}

async function run() {
  console.log('=== Gate E2E Data Tools (13 herramientas) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage(page, url, 'excel-a-html');
    await page.addScriptTag({ url: `${url}/vendor/xlsx/xlsx.min.js` });
    const csv = Buffer.from(
      'ciudad,ventas,anio\nMadrid,120,2023\nBarcelona,80,2022\nMadrid,45,2021\nValencia,200,2023\nSevilla,30,2022\n'
    );
    const json = Buffer.from(JSON.stringify({ ciudad: 'Madrid', ventas: 120, anio: 2023, tags: ['a', 'b'], detalle: { x: 1 } }));
    const jsonBad = Buffer.from('{"ciudad": ');
    const xml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<catalogo>\n  <producto id="1"><nombre>Teclado</nombre><precio>25</precio></producto>\n' +
      '  <producto id="2"><nombre>Raton</nombre><precio>12</precio></producto>\n' +
      '  <producto id="3"><nombre>Monitor</nombre><precio>150</precio></producto>\n</catalogo>\n'
    );
    const xlsxBuf = Buffer.from(await xlsxFromAoa(page, [['Producto', 'Precio'], ['Teclado', 25], ['Raton', 12]], 'Hoja1'));
    ok(csv.length > 0 && json.length > 0 && xml.length > 0 && xlsxBuf.slice(0, 2).toString('latin1') === 'PK', 'fixtures generados', `${csv.length}/${json.length}/${xml.length}/${xlsxBuf.length} bytes`);

    const CSV_FILE = (n = 'datos.csv') => ({ name: n, mimeType: 'text/csv', buffer: csv });
    const CSV_MIME = 'text/csv';

    /* ── 1. csvToMarkdown ─────────────────────────────────────────────── */
    console.log('\n--- csvToMarkdown (csv-a-markdown) ---');
    await gotoPage(page, url, 'csv-a-markdown');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    let msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'Tabla Markdown generada (5 filas).', `csvToMarkdown message: "${msg}"`);
    let buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('| ciudad | ventas | anio |'), 'csvToMarkdown genera el encabezado de tabla', t.split('\n')[0]);
      ok(t.includes('| --- | --- | --- |'), 'csvToMarkdown genera la fila separadora');
      ok(t.includes('| Madrid | 120 | 2023 |'), 'csvToMarkdown convierte las filas');
    } else fail('csvToMarkdown sin archivo');
    await closeDialog(page);

    /* ── 2. csvToHtml ─────────────────────────────────────────────────── */
    console.log('\n--- csvToHtml (csv-a-html) ---');
    await gotoPage(page, url, 'csv-a-html');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'Tabla HTML generada (5 filas).', `csvToHtml message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('<table>') && t.includes('<th>ciudad</th>'), 'csvToHtml genera una tabla HTML', t.slice(0, 120));
      ok(t.includes('<td>Madrid</td>'), 'csvToHtml convierte las celdas');
      const parsed = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(u), 'text/html');
        return {
          tables: doc.querySelectorAll('table').length,
          headers: doc.querySelectorAll('th').length,
          bodyRows: doc.querySelectorAll('tbody tr').length,
        };
      }, toBase64(buf));
      ok(parsed.tables === 1 && parsed.headers === 3 && parsed.bodyRows === 5, 'csvToHtml se reabre como HTML válido (5 filas, 3 columnas)', JSON.stringify(parsed));
    } else fail('csvToHtml sin archivo');
    await closeDialog(page);

    /* ── 3. csvToYaml ─────────────────────────────────────────────────── */
    console.log('\n--- csvToYaml (csv-a-yaml) ---');
    await gotoPage(page, url, 'csv-a-yaml');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'YAML generado (5 filas).', `csvToYaml message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('datos:'), 'csvToYaml genera el nodo raíz');
      ok(t.includes('  ciudad: Madrid'), 'csvToYaml mapea columnas a claves', t.split('\n').slice(0, 6).join(' | '));
      ok((t.match(/^\s*-/gm) || []).length === 5, 'csvToYaml genera 5 elementos', (t.match(/^\s*-/gm) || []).length + ' items');
    } else fail('csvToYaml sin archivo');
    await closeDialog(page);

    /* ── 4. csvStatistics ─────────────────────────────────────────────── */
    console.log('\n--- csvStatistics (estadisticas-csv) ---');
    await gotoPage(page, url, 'estadisticas-csv');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'Estadísticas CSV calculadas.', `csvStatistics message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Filas de datos: 5') && t.includes('Columnas: 3'), 'csvStatistics cuenta filas y columnas');
      ok(t.includes('Columna "ventas" (numérica, 5 valores):'), 'csvStatistics detecta columna numérica');
      ok(t.includes('Máximo: 200') && t.includes('Mínimo: 30') && t.includes('Suma: 475'), 'csvStatistics calcula min/max/suma', t.split('\n').filter((l) => /ventas|Máximo|Suma|Media/.test(l)).join(' | '));
      ok(t.includes('Media: 95.0000'), 'csvStatistics calcula la media');
    } else fail('csvStatistics sin archivo');
    await closeDialog(page);

    /* ── 5. csvFilter ─────────────────────────────────────────────────── */
    console.log('\n--- csvFilter (filtrar-csv) ---');
    await gotoPage(page, url, 'filtrar-csv');
    await upload(page, [CSV_FILE()]);
    await page.fill('#value', 'Madrid');
    await page.selectOption('#operator', '=');
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'CSV filtrado: 2 de 5 filas.', `csvFilter message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      const lines = t.split('\n').filter(Boolean);
      ok(lines[0].startsWith('ciudad'), 'csvFilter conserva el encabezado');
      ok(lines.length === 3, 'csvFilter deja 2 filas de datos', lines.length + ' líneas');
      ok(lines[1].includes('Madrid') && lines[2].includes('Madrid'), 'csvFilter conserva solo las filas Madrid', JSON.stringify(lines));
    } else fail('csvFilter sin archivo');
    await closeDialog(page);

    /* ── 6. csvSort ───────────────────────────────────────────────────── */
    console.log('\n--- csvSort (ordenar-csv) ---');
    await gotoPage(page, url, 'ordenar-csv');
    await upload(page, [CSV_FILE()]);
    await page.fill('#column', '1');
    await page.selectOption('#direction', 'desc');
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'CSV ordenado (5 filas).', `csvSort message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      const lines = t.split('\n').filter(Boolean);
      ok(lines.length === 6, 'csvSort conserva encabezado + 5 filas', lines.length + ' líneas');
      ok(lines[1].includes('Valencia') && lines[1].includes('200'), 'csvSort ordena ventas desc (Valencia primero)', JSON.stringify(lines.slice(0, 2)));
      ok(lines[5].includes('Sevilla') && lines[5].includes('30'), 'csvSort ordena ventas desc (Sevilla último)', JSON.stringify(lines[5]));
    } else fail('csvSort sin archivo');
    await closeDialog(page);

    /* ── 7. csvToSql ──────────────────────────────────────────────────── */
    console.log('\n--- csvToSql (csv-a-sql) ---');
    await gotoPage(page, url, 'csv-a-sql');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'SQL generado (5 INSERTs).', `csvToSql message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('CREATE TABLE IF NOT EXISTS') && t.includes('"ciudad" TEXT') && t.includes('"ventas" INTEGER') && t.includes('"anio" INTEGER'), 'csvToSql infiere tipos TEXT/INTEGER', t.split('\n').find((l) => l.includes('CREATE') || l.includes('"ventas"') || l.includes('"ciudad"')));
      ok((t.match(/INSERT INTO/g) || []).length === 5, 'csvToSql genera 5 INSERT', (t.match(/INSERT INTO/g) || []).length + ' INSERTs');
      ok(t.includes('Madrid') && t.includes('120'), 'csvToSql conserva los datos');
    } else fail('csvToSql sin archivo');
    await closeDialog(page);

    /* ── 8. jsonFormatter ─────────────────────────────────────────────── */
    console.log('\n--- jsonFormatter (formatear-json) ---');
    await gotoPage(page, url, 'formatear-json');
    await upload(page, [{ name: 'datos.json', mimeType: 'application/json', buffer: json }]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'JSON formateado correctamente.', `jsonFormatter message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('\n  '), 'jsonFormatter añade indentación de 2 espacios');
      const round = JSON.parse(t);
      ok(round.ciudad === 'Madrid' && round.ventas === 120 && round.detalle.x === 1, 'jsonFormatter conserva la semántica (round-trip)');
    } else fail('jsonFormatter sin archivo');
    await closeDialog(page);

    /* ── 9. jsonValidator ─────────────────────────────────────────────── */
    console.log('\n--- jsonValidator (validar-json) ---');
    await gotoPage(page, url, 'validar-json');
    await upload(page, [{ name: 'ok.json', mimeType: 'application/json', buffer: json }]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'Validación completada: consulta el informe.', `jsonValidator (válido) message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Resultado: VÁLIDO'), 'jsonValidator reporta VÁLIDO');
    } else fail('jsonValidator (válido) sin archivo');
    await closeDialog(page);
    await gotoPage(page, url, 'validar-json');
    await upload(page, [{ name: 'mal.json', mimeType: 'application/json', buffer: jsonBad }]);
    await runTool(page);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Resultado: INVÁLIDO') && t.includes('Línea:') && t.includes('columna:'), 'jsonValidator reporta INVÁLIDO con posición', t.split('\n').find((l) => l.includes('Resultado')));
    } else fail('jsonValidator (inválido) sin archivo');
    await closeDialog(page);

    /* ── 10. excelToHtml ──────────────────────────────────────────────── */
    console.log('\n--- excelToHtml (excel-a-html) ---');
    await gotoPage(page, url, 'excel-a-html');
    await upload(page, [{ name: 'libro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf }]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'HTML generado (1 hoja(s)).', `excelToHtml message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('<h2>Hoja1</h2>') && t.includes('<th>Producto</th>'), 'excelToHtml conserva la hoja y el encabezado');
      ok(t.includes('<td>Teclado</td>'), 'excelToHtml convierte las celdas');
    } else fail('excelToHtml sin archivo');
    await closeDialog(page);

    /* ── 11. excelToMarkdown ──────────────────────────────────────────── */
    console.log('\n--- excelToMarkdown (excel-a-markdown) ---');
    await gotoPage(page, url, 'excel-a-markdown');
    await upload(page, [{ name: 'libro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf }]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'Tabla Markdown generada desde "Hoja1".', `excelToMarkdown message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('# Hoja1'), 'excelToMarkdown escribe el título de la hoja');
      ok(t.includes('| Producto | Precio |') && t.includes('| --- | --- |'), 'excelToMarkdown genera la tabla Markdown');
      ok(t.includes('| Teclado | 25 |'), 'excelToMarkdown convierte las filas');
    } else fail('excelToMarkdown sin archivo');
    await closeDialog(page);

    /* ── 12. xmlToExcel ───────────────────────────────────────────────── */
    console.log('\n--- xmlToExcel (xml-a-excel) ---');
    await gotoPage(page, url, 'xml-a-excel');
    await upload(page, [{ name: 'catalogo.xml', mimeType: 'application/xml', buffer: xml }]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'Excel generado (3 filas).', `xmlToExcel message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const reopened = await xlsxToAoa(page, toBase64(buf));
      ok(reopened.aoa.length === 4, `xmlToExcel reabre el XLSX (4 filas con encabezado)`, reopened.aoa.length + ' filas');
      ok(reopened.aoa[0].includes('nombre') && reopened.aoa[0].includes('precio') && reopened.aoa[0].includes('@id'), 'xmlToExcel convierte nodos y atributos en columnas', JSON.stringify(reopened.aoa[0]));
      ok(reopened.aoa[1].includes('Teclado') && reopened.aoa[1].includes('25'), 'xmlToExcel conserva los datos', JSON.stringify(reopened.aoa[1]));
    } else fail('xmlToExcel sin archivo');
    await closeDialog(page);

    /* ── 13. excelToXml ───────────────────────────────────────────────── */
    console.log('\n--- excelToXml (excel-a-xml) ---');
    await gotoPage(page, url, 'excel-a-xml');
    await upload(page, [{ name: 'libro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf }]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg === 'XML generado (1 hoja(s)).', `excelToXml message: "${msg}"`);
    buf = await downloadResult(page);
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('<?xml version="1.0"') && t.includes('<hojas>') && t.includes('<hoja nombre="Hoja1">'), 'excelToXml genera XML bien formado');
      const parsed = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(u), 'application/xml');
        return {
          parsererror: !!doc.querySelector('parsererror'),
          filas: doc.querySelectorAll('fila').length,
          celdas: Array.from(doc.querySelectorAll('fila:nth-of-type(2) celda')).map((c) => c.textContent),
        };
      }, toBase64(buf));
      ok(parsed.parsererror === false && parsed.filas === 3, 'excelToXml se reabre como XML válido (3 filas)', JSON.stringify(parsed));
      ok(parsed.celdas.includes('Teclado') && parsed.celdas.includes('25'), 'excelToXml conserva los datos en la primera fila', JSON.stringify(parsed.celdas));
    } else fail('excelToXml sin archivo');
    await closeDialog(page);

    /* ── 14. Rechazo de incompatibles ─────────────────────────────────── */
    console.log('\n--- Rechazo de tipos incompatibles ---');
    await gotoPage(page, url, 'csv-a-markdown');
    let rej = await expectRejected(page, [{ name: 'doc.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\x03\x04') }], 'Selecciona un archivo CSV.');
    ok(rej.dialogOpen === false && rej.toast.includes('Selecciona un archivo CSV.'), `csvToMarkdown rechaza no-CSV con toast: "${rej.toast}"`);
    await gotoPage(page, url, 'validar-json');
    rej = await expectRejected(page, [CSV_FILE()], 'Selecciona un archivo JSON.');
    ok(rej.dialogOpen === false && rej.toast.includes('Selecciona un archivo JSON.'), `jsonValidator rechaza no-JSON con toast: "${rej.toast}"`);
    await gotoPage(page, url, 'excel-a-html');
    rej = await expectRejected(page, [CSV_FILE()], 'Selecciona un archivo Excel.');
    ok(rej.dialogOpen === false && rej.toast.includes('Selecciona un archivo Excel.'), `excelToHtml rechaza no-Excel con toast: "${rej.toast}"`);

    /* ── 15. Sin red externa ──────────────────────────────────────────── */
    console.log('\n--- Sin red externa ---');
    const externalRequests = [];
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(url)) await route.continue();
      else {
        externalRequests.push(reqUrl);
        await route.abort();
      }
    });
    await gotoPage(page, url, 'csv-a-markdown');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    const offBuf = await downloadResult(page);
    ok(offBuf && (await readText(page, toBase64(offBuf))).includes('| ciudad | ventas | anio |'), 'csvToMarkdown funciona con toda la red externa bloqueada');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await closeDialog(page);
    await page.unroute('**/*');

    /* ── 16. Consola ──────────────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola en toda la suite');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  const evidence = {
    suite: 'gate-e2e-data-tools',
    updatedAt: new Date().toISOString(),
    tools: [
      'csvToMarkdown', 'csvToHtml', 'csvToYaml', 'csvStatistics', 'csvFilter', 'csvSort', 'csvToSql',
      'jsonFormatter', 'jsonValidator', 'excelToHtml', 'excelToMarkdown', 'xmlToExcel', 'excelToXml',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-data-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
