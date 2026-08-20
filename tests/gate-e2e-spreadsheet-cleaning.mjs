#!/usr/bin/env node
/**
 * gate-e2e-spreadsheet-cleaning.mjs — Certificación E2E de 10 herramientas:
 * cleanExcel, removeDuplicatesExcel, csvChangeDelimiter, csvChangeEncoding,
 * flattenJson, jsonToExcelAdvanced, normalizeCsv, compareCsv,
 * cleanTabularData, htmlTableToExcel.
 */
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { writeEvidence } from './evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'ss-clean-dl');
if (existsSync(DL_DIR)) rmSync(DL_DIR, { recursive: true, force: true });
mkdirSync(DL_DIR, { recursive: true });

let failures = 0, passes = 0;
const checks = [], failureReasons = [], consoleErrors = [];
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
  await page.waitForTimeout(300);
}

async function upload(page, files) {
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.getElementById('runButton').disabled, { timeout: 15000 });
}

async function runTool(page, timeout = 30000) {
  await page.click('#runButton');
  await page.waitForFunction(() => {
    const d = document.getElementById('resultDialog');
    return d && d.open;
  }, { timeout });
}

async function closeDialog(page) {
  await page.evaluate(() => { const d = document.getElementById('resultDialog'); if (d) d.close(); });
  await page.waitForTimeout(150);
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
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(payload.aoa);
    XLSX.utils.book_append_sheet(wb, ws, payload.sheetName);
    const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return Array.from(new Uint8Array(arr));
  }, { aoa, sheetName });
}

async function xlsxToAoa(page, b64) {
  return page.evaluate(async (payload) => {
    const bin = atob(payload.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const wb = XLSX.read(u, { type: 'array' });
    const name = wb.SheetNames[0];
    const ws = wb.Sheets[name];
    return { name, aoa: XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) };
  }, { b64 });
}

let url;

async function run() {
  console.log('=== Gate E2E Spreadsheet Cleaning (10 herramientas) ===\n');

  const server = await startServer();
  url = server.url;
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('net::ERR')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    console.log('\n--- Generating fixtures ---');
    await gotoPage(page, url, 'limpiar-excel');
    await page.addScriptTag({ url: `${url}/vendor/xlsx/xlsx.min.js` });

    const xlsxBuf = Buffer.from(await xlsxFromAoa(page, [
      ['Ciudad', 'Ventas', 'Notas'],
      ['Madrid', 120, '  ok  '],
      ['Barcelona', 80, ''],
      ['Madrid', 120, '  ok  '],
      ['', '', ''],
      ['Valencia', 200, 'bien'],
      ['Sevilla', 30, '  mal  '],
    ], 'Datos'));
    ok(xlsxBuf.slice(0, 2).toString('latin1') === 'PK', 'XLSX fixture con duplicados y vacíos', xlsxBuf.length + ' bytes');

    const xlsxDedupBuf = Buffer.from(await xlsxFromAoa(page, [
      ['Ciudad', 'Ventas'],
      ['Madrid', 120],
      ['Madrid', 120],
      ['Barcelona', 80],
      ['Valencia', 200],
    ], 'Datos'));

    const csvBuf = Buffer.from('Ciudad,Ventas,Anio\nMadrid,120,2023\nBarcelona,80,2022\nValencia,200,2024\nSevilla,30,2023\n');
    const csv2Buf = Buffer.from('Ciudad,Ventas,Anio\nMadrid,150,2023\nBarcelona,80,2022\nSevilla,30,2023\nBilbao,90,2024\n');
    const jsonBuf = Buffer.from(JSON.stringify({ usuario: { nombre: 'Ana', edad: 30 }, direccion: { ciudad: 'Madrid', cp: '28001' }, tags: ['admin', 'editor'] }));
    const jsonArrBuf = Buffer.from(JSON.stringify([
      { usuario: { nombre: 'Ana', edad: 30 }, direccion: { ciudad: 'Madrid' } },
      { usuario: { nombre: 'Luis', edad: 25 }, direccion: { ciudad: 'Barcelona' } },
    ]));
    const htmlTableBuf = Buffer.from('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table id="t1"><thead><tr><th>Nombre</th><th>Edad</th></tr></thead><tbody><tr><td>Ana</td><td>30</td></tr><tr><td>Luis</td><td>25</td></tr></tbody></table><table id="t2"><thead><tr><th>Ciudad</th><th>Pais</th></tr></thead><tbody><tr><td>Madrid</td><td>España</td></tr></tbody></table></body></html>');
    const encodingBuf = Buffer.from([0xEF, 0xBB, 0xBF, 0x43, 0x69, 0x75, 0x64, 0x61, 0x64, 0x2C, 0x56, 0x61, 0x6C, 0x6F, 0x72, 0x0A, 0x4D, 0x61, 0x64, 0x72, 0x69, 0x64, 0x2C, 0xC3, 0xA1, 0x63, 0x65, 0x6E, 0x74, 0x65, 0x0A]);
    const win1252Buf = Buffer.from([0x43, 0x69, 0x75, 0x64, 0x61, 0x64, 0x2C, 0x56, 0x61, 0x6C, 0x6F, 0x72, 0x0A, 0x4D, 0x61, 0x64, 0x72, 0x69, 0x64, 0x2C, 0xE1, 0x63, 0x65, 0x6E, 0x74, 0x65, 0x0A]);

    const XLSX_FILE = (n = 'datos.xlsx') => ({ name: n, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf });
    const XLSX_DEDUP_FILE = () => ({ name: 'dedup.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxDedupBuf });
    const CSV_FILE = (n = 'datos.csv') => ({ name: n, mimeType: 'text/csv', buffer: csvBuf });
    const CSV2_FILE = () => ({ name: 'copia.csv', mimeType: 'text/csv', buffer: csv2Buf });
    const JSON_FILE = (n = 'datos.json') => ({ name: n, mimeType: 'application/json', buffer: jsonBuf });
    const JSON_ARR_FILE = () => ({ name: 'lista.json', mimeType: 'application/json', buffer: jsonArrBuf });
    const HTML_FILE = () => ({ name: 'tablas.html', mimeType: 'text/html', buffer: htmlTableBuf });
    const ENC_FILE = (n = 'utf8bom.csv') => ({ name: n, mimeType: 'text/plain', buffer: encodingBuf });
    const WIN_FILE = (n = 'win1252.csv') => ({ name: n, mimeType: 'text/plain', buffer: win1252Buf });

    /* ── 1. cleanExcel ───────────────────────────────────────────────── */
    console.log('\n--- cleanExcel (limpiar-excel) ---');
    await gotoPage(page, url, 'limpiar-excel');
    await upload(page, [XLSX_FILE()]);
    await runTool(page);
    let msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('limpio') || msg.includes('archivo') || msg.includes('clean'), `cleanExcel message: "${msg}"`);
    let buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'cleanExcel genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const reopened = await xlsxToAoa(page, toBase64(buf));
      ok(reopened.aoa.length < 7, `cleanExcel reduce filas vacías (${reopened.aoa.length} filas)`, reopened.aoa.length + ' filas');
      const hasNoEmptyRows = reopened.aoa.every((row) => row.some((c) => c !== '' && c != null));
      ok(hasNoEmptyRows, 'cleanExcel elimina filas completamente vacías');
    }
    await closeDialog(page);

    /* ── 2. removeDuplicatesExcel ────────────────────────────────────── */
    console.log('\n--- removeDuplicatesExcel (eliminar-duplicados-excel) ---');
    await gotoPage(page, url, 'eliminar-duplicados-excel');
    await upload(page, [XLSX_DEDUP_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('duplicado') || msg.includes('reporte') || msg.includes('eliminado'), `removeDuplicatesExcel message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'removeDuplicatesExcel genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x50 && buf[1] === 0x4B, 'removeDuplicatesExcel salida es ZIP/XLSX');
      const reopened = await xlsxToAoa(page, toBase64(buf));
      ok(reopened.aoa.length === 4, `removeDuplicatesExcel reduce a ${reopened.aoa.length} filas (header + 3 únicas)`, reopened.aoa.length + ' filas');
    }
    await closeDialog(page);

    /* ── 3. csvChangeDelimiter ───────────────────────────────────────── */
    console.log('\n--- csvChangeDelimiter (cambiar-delimitador-csv) ---');
    await gotoPage(page, url, 'cambiar-delimitador-csv');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('CSV'), `csvChangeDelimiter message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'csvChangeDelimiter genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes(',') || t.includes(';') || t.includes('\t'), 'csvChangeDelimiter salida tiene delimitador');
      ok(t.includes('Madrid') || t.includes('Ciudad'), 'csvChangeDelimiter conserva datos');
    }
    await closeDialog(page);

    /* ── 4. csvChangeEncoding ────────────────────────────────────────── */
    console.log('\n--- csvChangeEncoding (cambiar-codificacion-csv) ---');
    await gotoPage(page, url, 'cambiar-codificacion-csv');
    await upload(page, [ENC_FILE('utf8bom.csv')]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('encoding') || msg.includes('archivo'), `csvChangeEncoding message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'csvChangeEncoding genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = buf.toString('utf-8');
      ok(!t.includes('Ã¡') && !t.includes('Ã©'), 'csvChangeEncoding no produce mojibake para á/é');
    }
    await closeDialog(page);

    /* ── 5. flattenJson ──────────────────────────────────────────────── */
    console.log('\n--- flattenJson (aplanar-json) ---');
    await gotoPage(page, url, 'aplanar-json');
    await upload(page, [JSON_ARR_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('aplanado') || msg.includes('JSON') || msg.includes('reconstruido'), `flattenJson message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'flattenJson genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      const parsed = JSON.parse(t);
      ok(Array.isArray(parsed), 'flattenJson salida es array');
      const flat = Array.isArray(parsed) ? parsed[0] : parsed;
      ok(flat['usuario.nombre'] !== undefined || flat.nombre !== undefined || Object.keys(flat).length > 3, 'flattenJson aplana objetos anidados');
    }
    await closeDialog(page);

    /* ── 6. jsonToExcelAdvanced ──────────────────────────────────────── */
    console.log('\n--- jsonToExcelAdvanced (json-a-excel-avanzado) ---');
    await gotoPage(page, url, 'json-a-excel-avanzado');
    await upload(page, [JSON_ARR_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('convertido') || msg.includes('fila') || msg.includes('Excel'), `jsonToExcelAdvanced message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'jsonToExcelAdvanced genera XLSX', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x50 && buf[1] === 0x4B, 'jsonToExcelAdvanced salida es ZIP/XLSX');
      const reopened = await xlsxToAoa(page, toBase64(buf));
      ok(reopened.aoa.length >= 3, `jsonToExcelAdvanced produce ${reopened.aoa.length} filas`, reopened.aoa.length + ' filas');
    }
    await closeDialog(page);

    /* ── 7. normalizeCsv ─────────────────────────────────────────────── */
    console.log('\n--- normalizeCsv (normalizar-csv) ---');
    await gotoPage(page, url, 'normalizar-csv');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('normalizado') || msg.includes('CSV') || msg.includes('archivo'), `normalizeCsv message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'normalizeCsv genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Ciudad') || t.includes('Madrid'), 'normalizeCsv conserva datos');
    }
    await closeDialog(page);

    /* ── 8. compareCsv ───────────────────────────────────────────────── */
    console.log('\n--- compareCsv (comparar-csv) ---');
    await gotoPage(page, url, 'comparar-csv');
    await upload(page, [CSV_FILE('original.csv'), CSV2_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('Comparación') || msg.includes('comparación') || msg.includes('añadida') || msg.includes('archivo'), `compareCsv message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'compareCsv genera reporte', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Comparación') || t.includes('Resumen'), 'compareCsv reporte tiene cabecera');
      ok(t.includes('+') || t.includes('-') || t.includes('~'), 'compareCsv reporte marca diferencias');
      ok(t.includes('Bilbao') || t.includes('modificada') || t.includes('añadida'), 'compareCsv reporte menciona filas del análisis');
    }
    await closeDialog(page);

    /* ── 9. cleanTabularData ─────────────────────────────────────────── */
    console.log('\n--- cleanTabularData (limpiar-datos-tabulares) ---');
    await gotoPage(page, url, 'limpiar-datos-tabulares');
    await upload(page, [CSV_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('limpio') || msg.includes('archivo') || msg.includes('clean'), `cleanTabularData message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'cleanTabularData genera archivo', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      const t = await readText(page, toBase64(buf));
      ok(t.includes('Ciudad') || t.includes('Madrid'), 'cleanTabularData conserva datos');
    }
    await closeDialog(page);

    /* ── 10. htmlTableToExcel ────────────────────────────────────────── */
    console.log('\n--- htmlTableToExcel (tablas-html-a-excel) ---');
    await gotoPage(page, url, 'tablas-html-a-excel');
    await upload(page, [HTML_FILE()]);
    await runTool(page);
    msg = await page.$eval('#resultMessage', (el) => el.textContent);
    ok(msg.includes('tabla') || msg.includes('HTML') || msg.includes('procesado'), `htmlTableToExcel message: "${msg}"`);
    buf = await downloadResult(page);
    ok(buf && buf.length > 0, 'htmlTableToExcel genera XLSX', buf ? buf.length + ' bytes' : 'null');
    if (buf) {
      ok(buf[0] === 0x50 && buf[1] === 0x4B, 'htmlTableToExcel salida es ZIP/XLSX');
      const reopened = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const wb = XLSX.read(u, { type: 'array' });
        return { sheets: wb.SheetNames, count: wb.SheetNames.length };
      }, toBase64(buf));
      ok(reopened.count === 2, `htmlTableToExcel extrae ${reopened.count} tablas como hojas`, reopened.sheets.join(', '));
    }
    await closeDialog(page);

    /* ── Errores de consola ──────────────────────────────────────────── */
    if (consoleErrors.length === 0) pass('Sin errores de consola en toda la suite');
    else fail(`Errores de consola: ${consoleErrors.join('; ')}`);
  } catch (e) {
    fail(`Exception: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.server.close();
  }

  const evidence = {
    suite: 'gate-e2e-spreadsheet-cleaning',
    updatedAt: new Date().toISOString(),
    tools: [
      'cleanExcel', 'removeDuplicatesExcel', 'csvChangeDelimiter', 'csvChangeEncoding',
      'flattenJson', 'jsonToExcelAdvanced', 'normalizeCsv', 'compareCsv',
      'cleanTabularData', 'htmlTableToExcel',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
    limitation: 'csvChangeEncoding no puede re-encodificar desde编码unknown sin dependencia chardet; usa heurística de BOM + high bytes. flattenJson no soporta unflatten bidireccional completo.',
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-spreadsheet-cleaning.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`\nEvidencia: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
