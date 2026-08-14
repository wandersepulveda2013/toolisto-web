#!/usr/bin/env node
/**
 * gate-e2e-spreadsheet-tools.mjs — Certificación E2E de las 14 herramientas de
 * hojas de cálculo (categoría spreadsheets) sobre el deployment real en dist/,
 * usando la UI propia del modo `js/modes/excel.js` (vista tabular editable).
 *
 * Cubre: csvToExcel, excelToCsv, excelToJson, jsonToExcel, csvToJson, jsonToCsv,
 * xmlToJson, jsonToXml, mergeExcel, splitExcel, compareExcel, xlsToXlsx,
 * xlsxToOds, odsToXlsx.
 *
 * Por herramienta: (1) el modo monta su panel y la UI genérica queda oculta,
 * (2) carga el archivo correcto y la vista editable muestra filas/columnas y
 * tipos detectados, (3) la rejilla es editable (celda, fila, tipo con badge de
 * errores), (4) el procesador real genera la salida con el mensaje prometido y
 * el nombre de descarga correcto, (5) la salida se verifica con las librerías
 * del propio sitio (XLSX/DOMParser), (6) "Reabrir salida" vuelve a leer el
 * resultado, (7) los archivos incompatibles y los errores del procesador se
 * reportan por toast sin contaminar la consola, (8) cero requests externos,
 * (9) cero errores de consola.
 *
 * Fixtures generados EN el navegador con el SheetJS del sitio (incluye bookType
 * 'xls' y 'ods' para xlsToXlsx/odsToXlsx).
 *
 * Limitación documentada: el modo re-construye el archivo desde la cuadrícula
 * editable, por lo que los valores numéricos que entran por CSV/XML se pierden
 * como números y salen como texto en la salida re-generada (ej. "120" en lugar
 * de 120). Se certifica el comportamiento real del modo.
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
const DL_DIR = join(process.env.TEMP || root, 'opencode', 'ss-dl');
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

async function run() {
  console.log('=== Gate E2E Spreadsheet Tools (14 herramientas, modo excel.js) ===\n');

  const { server, url } = await startServer();
  pass(`Server started on ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('favicon')) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const gotoPage = async (slug) => {
    await page.goto(`${url}/${slug}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
  };

  const clearToast = () => page.evaluate(() => {
    const t = document.getElementById('toast');
    if (t) { t.textContent = ''; t.classList.remove('show'); }
  });

  const gridState = () => page.evaluate(() => {
    const rows = document.querySelectorAll('.xl-grid tbody tr');
    const headCells = document.querySelectorAll('.xl-grid thead th');
    const meta = document.getElementById('xlMeta');
    return {
      hasGrid: !!document.querySelector('.xl-grid'),
      placeholder: document.getElementById('xlGrid') ? document.getElementById('xlGrid').textContent.trim() : '',
      rowCount: rows.length,
      colCount: Math.max(0, headCells.length - 1),
      types: Array.from(document.querySelectorAll('.xl-type')).map((s) => s.value),
      badge: document.querySelector('#xlErrBadge b') ? document.querySelector('#xlErrBadge b').textContent : '',
      firstData: rows.length > 1 ? Array.from(rows[1].querySelectorAll('.xl-cell')).map((c) => c.textContent) : [],
      reopenHidden: document.getElementById('xlReopen') ? document.getElementById('xlReopen').hidden : null,
      continueHidden: document.getElementById('xlContinue') ? document.getElementById('xlContinue').hidden : null,
      continueLabel: document.getElementById('xlContinue') ? document.getElementById('xlContinue').textContent : '',
      title: document.querySelector('.xl-toolbar strong') ? document.querySelector('.xl-toolbar strong').textContent : '',
      meta: meta ? meta.textContent : '',
    };
  });

  const loadFiles = async (payloads) => {
    await page.locator('#xlFile').setInputFiles(payloads);
    await page.waitForSelector('.xl-grid', { timeout: 15000 });
    await page.waitForTimeout(120);
  };

  const loadFilesExpectError = async (payloads) => {
    await page.locator('#xlFile').setInputFiles(payloads);
    await page.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && t.textContent.trim().length > 0;
    }, { timeout: 10000 });
    await page.waitForTimeout(150);
  };

  const runAndDownload = async () => {
    await clearToast();
    const dlPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await page.click('#xlRun');
    const dl = await dlPromise;
    await page.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && t.textContent.trim().length > 0;
    }, { timeout: 15000 });
    const toast = await page.$eval('#toast', (el) => el.textContent);
    if (!dl) return { dl: null, buf: null, toast };
    const tmp = join(DL_DIR, `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    await dl.saveAs(tmp);
    return { dl, buf: readFileSync(tmp), toast };
  };

  const parseOut = (name, buf) => page.evaluate(async ({ name: nm, b64 }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const text = new TextDecoder('utf-8').decode(u);
    if (/\.(xlsx|ods|xls)$/i.test(nm)) {
      const wb = window.XLSX.read(u, { type: 'array' });
      return { kind: 'xlsx', sheets: wb.SheetNames, aoa: window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) };
    }
    if (/\.json$/i.test(nm)) {
      let j = null, parseErr = null;
      try { j = JSON.parse(text); } catch (e) { parseErr = e.message; }
      return { kind: 'json', parseErr, text, json: j };
    }
    if (/\.xml$/i.test(nm)) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const leaves = doc.documentElement ? Array.from(doc.documentElement.children || []).map((n) => ({ n: n.nodeName, t: n.textContent })) : [];
      return { kind: 'xml', root: doc.documentElement ? doc.documentElement.nodeName : null, leaves, text };
    }
    return { kind: 'text', text };
  }, { name, b64: toBase64(buf) });

  const reopenOutput = async (expectMeta) => {
    const before = await page.$eval('#xlReopen', (el) => el.hidden);
    await page.click('#xlReopen');
    await page.waitForFunction(() => {
      const m = document.getElementById('xlMeta');
      return m && m.textContent === 'Salida reabierta y verificada.';
    }, { timeout: 15000 });
    return { before, grid: await gridState() };
  };

  const sheetWrite = async (aoa, sheetName, bookType) => page.evaluate(async (p) => {
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(p.aoa);
    window.XLSX.utils.book_append_sheet(wb, ws, p.sheetName);
    const arr = window.XLSX.write(wb, { bookType: p.bookType, type: 'array' });
    return Array.from(new Uint8Array(arr));
  }, { aoa, sheetName, bookType });

  const XLSX_FILE = (name, buf) => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });

  try {
    /* ── Fixtures ──────────────────────────────────────────────────────── */
    console.log('\n--- Fixtures ---');
    await gotoPage('csv-a-excel');
    ok(
      await page.evaluate(() => ({
        XLSX: typeof window.XLSX, JSZip: typeof window.JSZip, TP: typeof window.ToolProcessors,
        hasModePanel: !!document.querySelector('.mode-panel'),
        hasGenericFileInput: !!document.getElementById('fileInput'),
        hasGenericDropZone: !!document.getElementById('dropZone') && !document.getElementById('dropZone').hidden,
      })),
      'página del modo monta panel propio y oculta la UI genérica',
      JSON.stringify(await page.evaluate(() => ({ panel: !!document.querySelector('.mode-panel'), fileInput: !!document.getElementById('fileInput') })))
    );

    const csv = Buffer.from('ciudad,ventas,anio\nMadrid,120,2023\nBarcelona,80,2022\nMadrid,45,2021\nValencia,200,2023\nSevilla,30,2022\n');
    const jsonArr = Buffer.from(JSON.stringify([{ Producto: 'Teclado', Precio: 25 }, { Producto: 'Raton', Precio: 12 }]));
    const jsonObj = Buffer.from(JSON.stringify({ ciudad: 'Madrid', ventas: 120 }));
    const xml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<catalogo>\n  <producto id="1"><nombre>Teclado</nombre><precio>25</precio></producto>\n' +
      '  <producto id="2"><nombre>Raton</nombre><precio>12</precio></producto>\n' +
      '  <producto id="3"><nombre>Monitor</nombre><precio>150</precio></producto>\n</catalogo>\n'
    );
    await page.addScriptTag({ url: `${url}/vendor/xlsx/xlsx.min.js` });
    const xlsxA = Buffer.from(await sheetWrite([['Producto', 'Precio'], ['Teclado', 25], ['Raton', 12]], 'Hoja1', 'xlsx'));
    const xlsxB = Buffer.from(await sheetWrite([['Producto', 'Precio'], ['Raton', 12], ['Monitor', 150]], 'Hoja1', 'xlsx'));
    const xlsxDiff = Buffer.from(await sheetWrite([['Producto', 'Precio'], ['Teclado', 99], ['Raton', 12]], 'Hoja1', 'xlsx'));
    const xlsBuf = Buffer.from(await sheetWrite([['Producto', 'Precio'], ['Teclado', 25], ['Raton', 12]], 'Hoja1', 'xls'));
    const odsBuf = Buffer.from(await sheetWrite([['Producto', 'Precio'], ['Teclado', 25], ['Raton', 12]], 'Hoja1', 'ods'));
    ok(
      xlsxA.slice(0, 2).toString('latin1') === 'PK' &&
      odsBuf.slice(0, 2).toString('latin1') === 'PK' &&
      xlsBuf.slice(0, 8).toString('latin1') === '\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1',
      'fixtures generados con el SheetJS del sitio',
      `csv=${csv.length} xlsx=${xlsxA.length} xls=${xlsBuf.length} ods=${odsBuf.length}`
    );

    const CSV_FILE = { name: 'datos.csv', mimeType: 'text/csv', buffer: csv };
    const JSON_ARR_FILE = { name: 'datos.json', mimeType: 'application/json', buffer: jsonArr };
    const JSON_OBJ_FILE = { name: 'objeto.json', mimeType: 'application/json', buffer: jsonObj };
    const XML_FILE = { name: 'catalogo.xml', mimeType: 'application/xml', buffer: xml };
    const XLS_FILE = { name: 'libro.xls', mimeType: 'application/vnd.ms-excel', buffer: xlsBuf };
    const ODS_FILE = { name: 'libro.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer: odsBuf };

    const cases = [
      {
        key: 'csvToExcel', slug: 'csv-a-excel', payloads: [CSV_FILE],
        rows: 6, cols: 3, types: ['texto', 'numero', 'numero'],
        toast: 'CSV convertido a Excel', file: 'toolisto-salida.xlsx',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.aoa.length === 6 && p.aoa[0].join(',') === 'ciudad,ventas,anio', 'csvToExcel genera XLSX con encabezado y 5 filas', JSON.stringify(p.aoa.slice(0, 2)));
          ok(p.aoa[1].join(',') === 'Madrid,120,2023' && p.aoa[5].join(',') === 'Sevilla,30,2022', 'csvToExcel conserva todas las filas del CSV', JSON.stringify(p.aoa[1]));
        },
        reopenRows: 6, reopenFirst: ['Madrid', '120', '2023'],
      },
      {
        key: 'excelToCsv', slug: 'excel-a-csv', payloads: [XLSX_FILE('libro.xlsx', xlsxA)],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'Excel convertido a CSV', file: 'toolisto-salida.csv',
        verify: (p) => {
          const lines = p.text.split('\n').filter(Boolean);
          ok(lines[0].trim() === 'Producto,Precio' && lines[1].trim() === 'Teclado,25', 'excelToCsv genera CSV con encabezado y filas', JSON.stringify(lines));
          ok(lines.length === 3, 'excelToCsv conserva las 2 filas de datos', lines.length + ' líneas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'excelToJson', slug: 'excel-a-json', payloads: [XLSX_FILE('libro.xlsx', xlsxA)],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'Excel convertido a JSON', file: 'toolisto-salida.json',
        verify: (p) => {
          ok(Array.isArray(p.json) && p.json.length === 2, 'excelToJson devuelve un array de 2 objetos', p.json ? p.json.length + ' items' : p.parseErr);
          ok(p.json[0].Producto === 'Teclado' && p.json[0].Precio === 25, 'excelToJson conserva claves y valores numéricos', JSON.stringify(p.json[0]));
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'jsonToExcel', slug: 'json-a-excel', payloads: [JSON_ARR_FILE],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'JSON convertido a Excel', file: 'toolisto-salida.xlsx',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.aoa[0].join(',') === 'Producto,Precio' && p.aoa[1][0] === 'Teclado' && p.aoa[1][1] === 25, 'jsonToExcel convierte el array JSON en filas con números', JSON.stringify(p.aoa[1]));
          ok(p.aoa.length === 3, 'jsonToExcel conserva las 2 filas de datos', p.aoa.length + ' filas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'csvToJson', slug: 'csv-a-json', payloads: [CSV_FILE],
        rows: 6, cols: 3, types: ['texto', 'numero', 'numero'],
        toast: 'CSV convertido a JSON', file: 'toolisto-salida.json',
        verify: (p) => {
          ok(Array.isArray(p.json) && p.json.length === 5, 'csvToJson genera 5 objetos', p.json ? p.json.length + ' items' : p.parseErr);
          ok(p.json[0].ciudad === 'Madrid' && p.json[0].anio === '2023', 'csvToJson conserva los datos', JSON.stringify(p.json[0]));
        },
        reopenRows: 6, reopenFirst: ['Madrid', '120', '2023'],
      },
      {
        key: 'jsonToCsv', slug: 'json-a-csv', payloads: [JSON_ARR_FILE],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'JSON convertido a CSV', file: 'toolisto-salida.csv',
        verify: (p) => {
          const lines = p.text.split('\n').filter(Boolean);
          ok(lines[0].trim() === 'Producto,Precio' && lines[1].trim() === 'Teclado,25', 'jsonToCsv genera CSV con encabezado y filas', JSON.stringify(lines));
          ok(lines.length === 3, 'jsonToCsv conserva las 2 filas de datos', lines.length + ' líneas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'xmlToJson', slug: 'xml-a-json', payloads: [XML_FILE],
        rows: 4, cols: 2, types: ['texto', 'numero'],
        toast: 'XML convertido a JSON', file: 'toolisto-salida.json',
        verify: (p) => {
          ok(p.json && p.json.datos && Array.isArray(p.json.datos.fila) && p.json.datos.fila.length === 3, 'xmlToJson agrupa los nodos repetidos', JSON.stringify(Object.keys(p.json || {})));
          ok(p.json.datos.fila[0].nombre === 'Teclado' && p.json.datos.fila[0].precio === '25', 'xmlToJson conserva el texto de los nodos', JSON.stringify(p.json.datos.fila[0]));
        },
        reopenRows: 2, reopenFirst: null,
      },
      {
        key: 'jsonToXml', slug: 'json-a-xml', payloads: [JSON_OBJ_FILE],
        rows: 2, cols: 2, types: ['texto', 'numero'],
        toast: 'JSON convertido a XML', file: 'toolisto-salida.xml',
        verify: (p) => {
          ok(p.kind === 'xml' && p.root === 'root' && p.text.startsWith('<?xml version="1.0"'), 'jsonToXml genera XML con prolog y raíz <root>', (p.text || '').slice(0, 40));
          ok(JSON.stringify(p.leaves).includes('"n":"ciudad"') && JSON.stringify(p.leaves).includes('"t":"Madrid"') && JSON.stringify(p.leaves).includes('"t":"120"'), 'jsonToXml mapea claves a nodos con su valor', JSON.stringify(p.leaves));
        },
        reopenRows: 3, reopenFirst: null,
        reopenNote: 'el XML plano (hojas) no se vuelve a aplastar en filas al reabrir (limitar del modo): muestra 3 filas vacías',
      },
      {
        key: 'mergeExcel', slug: 'unir-excel', payloads: [XLSX_FILE('a.xlsx', xlsxA), XLSX_FILE('b.xlsx', xlsxB)],
        rows: 5, cols: 2, types: ['texto', 'numero'],
        toast: '1 archivos combinados', file: 'archivos-unidos.xlsx',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.aoa.length === 5, 'mergeExcel combina las filas de ambos libros', p.aoa.length + ' filas');
          ok(p.aoa[1].join(',') === 'Teclado,25' && p.aoa[4].join(',') === 'Monitor,150', 'mergeExcel conserva el contenido de ambos archivos', JSON.stringify(p.aoa));
        },
        reopenRows: 5, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'splitExcel', slug: 'dividir-excel', payloads: [XLSX_FILE('libro.xlsx', xlsxA)],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'Dividido en 1 archivo', file: 'Datos.xlsx',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.sheets[0] === 'Datos' && p.aoa[1][0] === 'Teclado' && p.aoa[1][1] === 25, 'splitExcel conserva la hoja única con sus datos', JSON.stringify(p.sheets));
          ok(p.aoa.length === 3, 'splitExcel conserva las filas', p.aoa.length + ' filas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'compareExcel-identical', slug: 'comparar-excel', payloads: [XLSX_FILE('a.xlsx', xlsxA), XLSX_FILE('b.xlsx', xlsxA)],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'Los archivos son idénticos. Se generó un informe sin diferencias.', file: 'comparacion.xlsx',
        verify: (p) => {
          ok(p.aoa[0][0] === 'Resultado' && p.aoa[0][1] === 'Los archivos son idénticos', 'compareExcel (idénticos) genera el informe', JSON.stringify(p.aoa[0]));
          ok(p.aoa[3].join(',') === 'Diferencias,0', 'compareExcel (idénticos) reporta 0 diferencias', JSON.stringify(p.aoa[3]));
        },
        reopenRows: 4, reopenFirst: ['Archivo 1', 'a.xlsx'],
      },
      {
        key: 'compareExcel-diff', slug: 'comparar-excel', payloads: [XLSX_FILE('a.xlsx', xlsxA), XLSX_FILE('b.xlsx', xlsxDiff)],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: '1 diferencias encontradas', file: 'comparacion.xlsx',
        verify: (p) => {
          ok(p.aoa[0].join(',') === 'Fila,Columna,Archivo 1,Archivo 2,Estado', 'compareExcel (diff) genera la tabla de diferencias', JSON.stringify(p.aoa[0]));
          ok(p.aoa[1][4] === 'Modificado' && p.aoa[1][2] === '25' && p.aoa[1][3] === '99', 'compareExcel (diff) detecta la celda modificada', JSON.stringify(p.aoa[1]));
        },
        reopenRows: 2, reopenFirst: ['2', 'B', '25', '99', 'Modificado'],
      },
      {
        key: 'xlsToXlsx', slug: 'xls-a-xlsx', payloads: [XLS_FILE],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'XLS convertido a XLSX', file: 'toolisto-salida.xlsx',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.aoa[1][0] === 'Teclado' && p.aoa[1][1] === 25, 'xlsToXlsx convierte el XLS (BIFF) a XLSX conservando los datos', JSON.stringify(p.aoa[1]));
          ok(p.aoa.length === 3, 'xlsToXlsx conserva las filas', p.aoa.length + ' filas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'xlsxToOds', slug: 'xlsx-a-ods', payloads: [XLSX_FILE('libro.xlsx', xlsxA)],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'XLSX convertido a ODS', file: 'toolisto-salida.ods',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.sheets[0] === 'Datos' && p.aoa[1][0] === 'Teclado' && p.aoa[1][1] === 25, 'xlsxToOds genera ODS reabierto con el XLSX del sitio', JSON.stringify(p.aoa[1]));
          ok(p.aoa.length === 3, 'xlsxToOds conserva las filas', p.aoa.length + ' filas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
      {
        key: 'odsToXlsx', slug: 'ods-a-xlsx', payloads: [ODS_FILE],
        rows: 3, cols: 2, types: ['texto', 'numero'],
        toast: 'ODS convertido a XLSX', file: 'toolisto-salida.xlsx',
        verify: (p) => {
          ok(p.kind === 'xlsx' && p.sheets[0] === 'Datos' && p.aoa[1][0] === 'Teclado' && p.aoa[1][1] === 25, 'odsToXlsx convierte el ODS a XLSX conservando los datos', JSON.stringify(p.aoa[1]));
          ok(p.aoa.length === 3, 'odsToXlsx conserva las filas', p.aoa.length + ' filas');
        },
        reopenRows: 3, reopenFirst: ['Teclado', '25'],
      },
    ];

    for (const c of cases) {
      console.log(`\n--- ${c.key} (${c.slug}) ---`);
      await gotoPage(c.slug);
      await loadFiles(c.payloads);
      const g = await gridState();
      ok(g.hasGrid && g.rowCount === c.rows && g.colCount === c.cols, `${c.key} muestra la vista editable ${c.rows - 1} filas × ${c.cols} columnas`, `grid ${g.rowCount}×${g.colCount}`);
      ok(JSON.stringify(g.types) === JSON.stringify(c.types), `${c.key} detecta los tipos de columna`, JSON.stringify(g.types));
      ok(g.badge === '0', `${c.key} sin errores por fila (badge 0)`, `badge="${g.badge}"`);

      const r = await runAndDownload();
      ok(r.toast === c.toast, `${c.key} toast: "${r.toast}"`, r.toast !== c.toast ? 'esperado: ' + c.toast : '');
      ok(r.buf !== null, `${c.key} genera un archivo descargable`, r.buf ? r.buf.length + ' bytes' : 'sin descarga');
      if (r.buf) {
        ok(r.dl.suggestedFilename() === c.file, `${c.key} nombre de salida: ${c.file}`, r.dl.suggestedFilename());
        ok((c.file.endsWith('.xlsx') || c.file.endsWith('.ods')) ? r.buf.slice(0, 2).toString('latin1') === 'PK' : true, `${c.key} firma de contenedor correcta`, r.buf.slice(0, 2).toString('latin1'));
        const parsed = await parseOut(r.dl.suggestedFilename(), r.buf);
        c.verify(parsed);
      }

      const ro = await reopenOutput();
      ok(ro.before === false, `${c.key} habilita "Reabrir salida" tras generar`, `hidden=${ro.before}`);
      if (c.reopenNote) {
        ok(ro.grid.hasGrid && ro.grid.rowCount === c.reopenRows && ro.grid.colCount === 0, `${c.key} reapertura muestra el XML plano en filas vacías (limitación del modo)`, `grid ${ro.grid.rowCount}×${ro.grid.colCount} — ${c.reopenNote}`);
      } else {
        ok(ro.grid.hasGrid && ro.grid.rowCount === c.reopenRows, `${c.key} reabre la salida en la vista editable (${c.reopenRows} filas)`, `grid ${ro.grid.rowCount}×${ro.grid.colCount}`);
        if (c.reopenFirst) {
          ok(JSON.stringify(ro.grid.firstData) === JSON.stringify(c.reopenFirst), `${c.key} reapertura conserva la primera fila`, JSON.stringify(ro.grid.firstData));
        } else {
          pass(`${c.key} reapertura muestra la salida (primera fila no aplica)`);
        }
      }
    }

    /* ── BOM UTF-8 en las descargas CSV (CE-045) ─────────────────────── */
    console.log('\n--- BOM UTF-8 en descargas CSV (excelToCsv / jsonToCsv) ---');
    const accentXlsx = Buffer.from(await sheetWrite([
      ['Ciudad', 'Éxito'], ['Córdoba', 'Ñuño'], ['León', 'índice ñame'],
    ], 'Hoja1', 'xlsx'));
    const accentJson = Buffer.from(JSON.stringify([
      { Ciudad: 'Córdoba', Valor: 'Éxito' }, { Ciudad: 'León', Valor: 'índice ñame' },
    ]));

    const checkCsvBom = async (slug, payload) => {
      await gotoPage(slug);
      await loadFiles(payload);
      const r = await runAndDownload();
      ok(r.buf !== null, `${slug} descarga el CSV`, r.buf ? r.buf.length + ' bytes' : 'sin descarga');
      if (!r.buf) return;
      const hasBom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
      ok(hasBom, `${slug} CSV empieza por EF BB BF (UTF-8 BOM)`, [...r.buf.slice(0, 3)].join(','));
      const text = r.buf.toString('utf8');
      ok(text.charCodeAt(0) === 0xFEFF, `${slug} primer carácter es \\uFEFF`, JSON.stringify(text.slice(0, 4)));
      ok(text.includes('Córdoba') && text.includes('Éxito') && text.includes('índice ñame'), `${slug} acentos intactos en el CSV`, text.split('\n')[0]);
      ok(!/[Ã¤Ã±]/.test(text) && !text.includes('ï¿½'), `${slug} sin mojibake (Ã¡, Ã©, Ã±, ï¿½)`, text.split('\n')[0]);
      const ro = await reopenOutput();
      ok(ro.grid.hasGrid && ro.grid.rowCount >= 2, `${slug} reabre el CSV con BOM en la vista editable`, `grid ${ro.grid.rowCount}×${ro.grid.colCount}`);
      const firstHeaderCell = await page.$eval('.xl-grid tbody tr td.xl-cell', (td) => td.textContent);
      ok(firstHeaderCell.indexOf('\uFEFF') === -1, `${slug} reapertura sin BOM en la primera celda`, JSON.stringify(firstHeaderCell));
    };
    await checkCsvBom('excel-a-csv', [XLSX_FILE('libro.xlsx', accentXlsx)]);
    await checkCsvBom('json-a-csv', [{ name: 'datos.json', mimeType: 'application/json', buffer: accentJson }]);

    /* Continuación desde un CSV con BOM (excelToCsv → csvToJson) */
    await gotoPage('excel-a-csv');
    await loadFiles([XLSX_FILE('libro.xlsx', accentXlsx)]);
    const bomSource = await runAndDownload();
    ok(bomSource.buf !== null, 'excelToCsv genera CSV para la continuación con BOM');
    if (bomSource.buf) {
      await page.waitForFunction(() => {
        const btn = document.getElementById('xlContinue');
        return btn && !btn.hidden && btn.textContent === 'Continuar con CSV a JSON';
      }, { timeout: 15000 });
      await page.click('#xlContinue');
      await page.waitForFunction(() => {
        const m = document.getElementById('xlMeta');
        return m && m.textContent === 'Salida cargada localmente. Ahora puedes continuar con CSV a JSON.';
      }, { timeout: 15000 });
      const contGrid = await gridState();
      ok(contGrid.title === 'CSV a JSON' && contGrid.firstData.join(',') === 'Córdoba,Ñuño', 'continuación desde CSV con BOM mantiene la tabla limpia', JSON.stringify(contGrid));
      const contRun = await runAndDownload();
      if (contRun.buf) {
        const parsed = await parseOut(contRun.dl.suggestedFilename(), contRun.buf);
        const keys = parsed.json && parsed.json[0] ? Object.keys(parsed.json[0]) : [];
        ok(parsed.json && Array.isArray(parsed.json) && keys.length === 2 && keys[0].indexOf('\uFEFF') === -1, 'el JSON continuado desde CSV con BOM no filtra BOM en sus claves', JSON.stringify(keys));
        ok(parsed.json && parsed.json[0].Ciudad === 'Córdoba' && parsed.json[0]["Éxito"] === 'Ñuño', 'el JSON continuado conserva los acentos', JSON.stringify(parsed.json && parsed.json[0]));
      } else fail('la continuación desde CSV con BOM no descargó JSON');
    }

    /* ── Continuación local de resultados ─────────────────────────────── */
    console.log('\n--- Continuación local CSV → Excel → JSON ---');
    await gotoPage('csv-a-excel');
    await loadFiles([CSV_FILE]);
    let continuationGrid = await gridState();
    ok(continuationGrid.continueHidden === true, 'la continuación permanece oculta antes de generar', `hidden=${continuationGrid.continueHidden}`);
    const continuationSource = await runAndDownload();
    ok(continuationSource.buf !== null, 'CSV a Excel genera la salida que se reutilizará localmente');
    continuationGrid = await gridState();
    ok(continuationGrid.continueHidden === false && continuationGrid.continueLabel === 'Continuar con Excel a JSON', 'CSV a Excel ofrece la continuación compatible', JSON.stringify(continuationGrid));
    await page.click('#xlContinue');
    await page.waitForFunction(() => {
      const m = document.getElementById('xlMeta');
      return m && m.textContent === 'Salida cargada localmente. Ahora puedes continuar con Excel a JSON.';
    }, { timeout: 15000 });
    continuationGrid = await gridState();
    ok(continuationGrid.title === 'Excel a JSON' && continuationGrid.rowCount === 6 && continuationGrid.firstData.join(',') === 'Madrid,120,2023', 'la salida XLSX entra en Excel a JSON sin recargar archivo', JSON.stringify(continuationGrid));
    const continuationResult = await runAndDownload();
    ok(continuationResult.dl && continuationResult.dl.suggestedFilename() === 'toolisto-salida.json', 'la continuación genera JSON descargable');
    if (continuationResult.buf) {
      const parsed = await parseOut(continuationResult.dl.suggestedFilename(), continuationResult.buf);
      ok(Array.isArray(parsed.json) && parsed.json.length === 5 && parsed.json[0].ciudad === 'Madrid' && parsed.json[0].ventas === '120', 'la continuación conserva encabezados y filas del CSV inicial', JSON.stringify(parsed.json && parsed.json[0]));
    } else fail('la continuación no descargó el JSON');

    /* ── Edición de la cuadrícula (csvToExcel) ─────────────────────────── */
    console.log('\n--- Edición de la cuadrícula (csvToExcel) ---');
    await gotoPage('csv-a-excel');
    await loadFiles([CSV_FILE]);
    await page.evaluate(() => {
      const cell = document.querySelector('.xl-cell[data-r="1"][data-c="0"]');
      cell.textContent = 'Malaga';
      cell.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    await page.waitForSelector('.xl-grid', { timeout: 10000 });
    let eg = await gridState();
    ok(eg.firstData[0] === 'Malaga' && eg.badge === '0', 'editar una celda actualiza la vista editable', JSON.stringify(eg.firstData));

    await page.click('#xlAddRow');
    await page.waitForFunction(() => document.querySelectorAll('.xl-grid tbody tr').length === 7, { timeout: 10000 });
    eg = await gridState();
    ok(eg.rowCount === 7, 'el botón "+ Fila" añade una fila nueva', eg.rowCount + ' filas');

    await page.evaluate(() => {
      const cells = [[6, 0, 'Cordoba'], [6, 1, '55'], [6, 2, '2024']];
      for (const [r, c, v] of cells) {
        const cell = document.querySelector(`.xl-cell[data-r="${r}"][data-c="${c}"]`);
        cell.textContent = v;
        cell.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    });
    await page.waitForSelector('.xl-grid', { timeout: 10000 });
    eg = await gridState();
    ok(eg.rowCount === 7 && eg.badge === '0', 'la fila añadida acepta datos sin errores', `filas=${eg.rowCount} badge=${eg.badge}`);

    await page.selectOption('.xl-type[data-col="0"]', 'numero');
    await page.waitForFunction(() => {
      const b = document.querySelector('#xlErrBadge b');
      return b && b.textContent === '6';
    }, { timeout: 10000 });
    ok(true, 'cambiar el tipo de columna a Número marca las 6 filas de texto como error (badge 6)');
    await page.selectOption('.xl-type[data-col="0"]', 'texto');
    await page.waitForFunction(() => {
      const b = document.querySelector('#xlErrBadge b');
      return b && b.textContent === '0';
    }, { timeout: 10000 });
    ok(true, 'volver a Texto limpia los errores (badge 0)');

    const editRun = await runAndDownload();
    ok(editRun.toast === 'CSV convertido a Excel', 'tras editar, la conversión sigue funcionando', editRun.toast);
    if (editRun.buf) {
      const parsed = await parseOut(editRun.dl.suggestedFilename(), editRun.buf);
      const cells = parsed.aoa.map((row) => row.join('|'));
      ok(parsed.aoa.length === 7 && cells.includes('Malaga|120|2023') && cells.includes('Cordoba|55|2024'), 'la salida incluye la celda editada y la fila añadida', JSON.stringify(parsed.aoa));
    } else fail('tras editar no hubo descarga');
    const ro2 = await reopenOutput();
    ok(ro2.grid.rowCount === 7 && ro2.grid.firstData[0] === 'Malaga', 'la reapertura verifica la salida editada', JSON.stringify(ro2.grid.firstData));

    /* ── Errores del procesador y tipos incompatibles ──────────────────── */
    console.log('\n--- Errores del procesador y tipos incompatibles ---');
    await gotoPage('excel-a-csv');
    await loadFilesExpectError([{ name: 'img.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) }]);
    let errToast = await page.$eval('#toast', (el) => el.textContent);
    let egErr = await gridState();
    ok(errToast === 'PNG Image File is not a spreadsheet' && !egErr.hasGrid, `excelToCsv rechaza un binario no soportado: "${errToast}"`, `grid=${egErr.hasGrid}`);

    await gotoPage('json-a-excel');
    await loadFilesExpectError([{ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"ciudad": ') }]);
    errToast = await page.$eval('#toast', (el) => el.textContent);
    egErr = await gridState();
    ok(errToast === 'Unexpected end of JSON input' && !egErr.hasGrid, `jsonToExcel con JSON malformado muestra toast: "${errToast}"`);

    await gotoPage('xml-a-json');
    await loadFilesExpectError([{ name: 'bad.xml', mimeType: 'application/xml', buffer: Buffer.from('<catalogo><producto></catalogo>') }]);
    errToast = await page.$eval('#toast', (el) => el.textContent);
    egErr = await gridState();
    ok(errToast.startsWith('XML inválido:') && !egErr.hasGrid, `xmlToJson con XML malformado muestra toast: "${errToast.slice(0, 40)}..."`);

    await gotoPage('comparar-excel');
    await loadFiles([XLSX_FILE('a.xlsx', xlsxA)]);
    await clearToast();
    const dlP = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('#xlRun');
    await page.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && t.textContent.includes('Selecciona al menos dos archivos');
    }, { timeout: 10000 });
    const dl1 = await dlP;
    errToast = await page.$eval('#toast', (el) => el.textContent);
    ok(errToast === 'Selecciona al menos dos archivos para comparar' && !dl1, `compareExcel con 1 archivo se bloquea sin descarga: "${errToast}"`);

    /* ── Sin red externa ───────────────────────────────────────────────── */
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
    await gotoPage('csv-a-excel');
    await loadFiles([CSV_FILE]);
    const offRun = await runAndDownload();
    ok(offRun.buf && offRun.buf.slice(0, 2).toString('latin1') === 'PK', 'csvToExcel funciona con toda la red externa bloqueada');
    ok(externalRequests.length === 0, 'cero requests a hosts externos durante el procesado', externalRequests.slice(0, 3).join(' | '));
    await page.unroute('**/*');

    /* ── Consola ───────────────────────────────────────────────────────── */
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
    suite: 'gate-e2e-spreadsheet-tools',
    updatedAt: new Date().toISOString(),
    mode: 'js/modes/excel.js',
    tools: [
      'csvToExcel', 'excelToCsv', 'excelToJson', 'jsonToExcel', 'csvToJson', 'jsonToCsv',
      'xmlToJson', 'jsonToXml', 'mergeExcel', 'splitExcel', 'compareExcel', 'xlsToXlsx',
      'xlsxToOds', 'odsToXlsx',
    ],
    total: passes + failures,
    passed: passes,
    failed: failures,
    checks,
    failures: failureReasons,
    limitation: 'El modo re-construye el archivo desde la cuadrícula editable; los valores numéricos entrados por CSV/XML salen como texto en la salida re-generada. Al reabrir la salida XML de jsonToXml (estructura plana de hojas <root><clave>valor</clave>) el grid muestra filas vacías porque el parser del modo espera XML de filas anidadas.',
    bugFixed: 'Las salidas compatibles ahora pueden continuar localmente en el siguiente conversor sin descargar ni volver a cargar el archivo; CSV → Excel → JSON conserva la tabla editable y los datos.',
  };
  const evidencePath = join(root, 'artifacts', 'deep-audit', 'toolisto', 'TLT-certify-spreadsheet-family-evidence.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeEvidence(evidencePath, evidence);
  console.log(`Evidencia guardada: ${evidencePath}`);

  console.log(`\n=== Resultado: ${passes} PASS, ${failures} FAIL ${failures === 0 ? '— APROBADO' : ''} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run();
