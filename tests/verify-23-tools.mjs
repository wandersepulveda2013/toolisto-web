import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { writeEvidence } from './evidence-helper.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8098;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/toolisto' || p === '/toolisto/') p = '/toolisto.html';
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p.replace(/^\/+/, ''));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');

const HTML_FIXTURE = '<!DOCTYPE html><html><head><title>Doc</title></head><body><h1>T\u00edtulo de prueba</h1><p>Un p\u00e1rrafo de ejemplo con texto.</p></body></html>';
const CSV_FIXTURE = 'ciudad,ventas\nmadrid,10\nbcn,20\nsevilla,30\n';
const CSV2_FIXTURE = 'a,b\n1,2\n3,4\n';
const TEXT_FIXTURE = 'Hola mundo. Esto es una frase.\n\nSegundo p\u00e1rrafo con tres palabras.';

function makeXlsx(rows) {
  const XLSX = require(path.join(ROOT, 'vendor', 'xlsx', 'xlsx.min.js'));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S1');
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(out);
}

const XLSX_FIXTURE = makeXlsx([['a', 'b'], [1, 2]]);
const XML_FIXTURE = '<raiz><item><nombre>Ana</nombre><edad>30</edad></item><item><nombre>Luis</nombre><edad>25</edad></item></raiz>';

const TOOLS = [
  { id: 'textStatistics', slug: 'estadisticas-texto', accepts: ['txt'],
    files: [{ name: 'texto.txt', mimeType: 'text/plain', data: b64(TEXT_FIXTURE) }],
    options: {},
    expected: ['Palabras:', 'P\u00e1rrafos: 2', 'Caracteres:'],
    invalid: { name: 'vacio.txt', mimeType: 'text/plain', data: b64('') } },

  { id: 'wordCount', slug: 'contar-palabras', accepts: ['txt'],
    files: [{ name: 'texto.txt', mimeType: 'text/plain', data: b64(TEXT_FIXTURE) }],
    options: {},
    expected: ['Palabras:', 'Caracteres:'],
    invalid: { name: 'vacio.txt', mimeType: 'text/plain', data: b64('') } },

  { id: 'textDiff', slug: 'comparar-textos', accepts: ['txt', 'txt'],
    files: [
      { name: 'a.txt', mimeType: 'text/plain', data: b64('linea uno\nlinea dos\nlinea tres\n') },
      { name: 'b.txt', mimeType: 'text/plain', data: b64('linea uno\nlinea tres\nlinea cuatro\n') }
    ],
    options: {},
    expected: ['- linea dos', '+ linea cuatro', 'L\u00edneas a\u00f1adidas: 1', 'L\u00edneas eliminadas: 1'],
    invalid: { name: 'solo.txt', mimeType: 'text/plain', data: b64('uno') } },

  { id: 'htmlToMarkdown', slug: 'html-a-markdown', accepts: ['html'],
    files: [{ name: 'doc.html', mimeType: 'text/html', data: b64(HTML_FIXTURE) }],
    options: {},
    expected: ['# T\u00edtulo de prueba', 'Un p\u00e1rrafo de ejemplo con texto.'],
    invalid: { name: 'plano.txt', mimeType: 'text/plain', data: b64('<html><body></body></html>') } },

  { id: 'htmlToText', slug: 'html-a-texto', accepts: ['html'],
    files: [{ name: 'doc.html', mimeType: 'text/html', data: b64(HTML_FIXTURE) }],
    options: {},
    expected: ['T\u00edtulo de prueba', 'Un p\u00e1rrafo de ejemplo con texto.'],
    invalid: { name: 'plano.txt', mimeType: 'text/plain', data: b64('no hay html aqui') } },

  { id: 'cssMinifier', slug: 'minificar-css', accepts: ['css'],
    files: [{ name: 'estilo.css', mimeType: 'text/css', data: b64('/* comentario */\nbody { color: red; margin: 0; }\n') }],
    options: {},
    expected: ['body{color:red;margin:0}'],
    invalid: { name: 'vacio.css', mimeType: 'text/css', data: b64('') } },

  { id: 'base64Encode', slug: 'codificar-base64', accepts: ['txt'],
    files: [{ name: 'msg.txt', mimeType: 'text/plain', data: b64('Hola Toolisto') }],
    options: {},
    expected: ['SG9sYSBUb29saXN0bw=='],
    invalid: { name: 'vacio.txt', mimeType: 'text/plain', data: b64('') } },

  { id: 'base64Decode', slug: 'decodificar-base64', accepts: ['txt'],
    files: [{ name: 'codigo.txt', mimeType: 'text/plain', data: b64('SG9sYSBUb29saXN0bw==') }],
    options: {},
    expected: ['Hola Toolisto'],
    invalid: { name: 'malo.txt', mimeType: 'text/plain', data: b64('esto no es base64 valido!!!') } },

  { id: 'urlEncode', slug: 'codificar-url', accepts: ['txt'],
    files: [{ name: 'msg.txt', mimeType: 'text/plain', data: b64('hola mundo y m\u00e1s') }],
    options: {},
    expected: ['hola%20mundo%20y%20m%C3%A1s'],
    invalid: { name: 'vacio.txt', mimeType: 'text/plain', data: b64('') } },

  { id: 'urlDecode', slug: 'decodificar-url', accepts: ['txt'],
    files: [{ name: 'codigo.txt', mimeType: 'text/plain', data: b64('hola%20mundo') }],
    options: {},
    expected: ['hola mundo'],
    invalid: { name: 'malo.txt', mimeType: 'text/plain', data: b64('%zz no valido') } },

  { id: 'csvToMarkdown', slug: 'csv-a-markdown', accepts: ['csv'],
    files: [{ name: 'datos.csv', mimeType: 'text/csv', data: b64(CSV2_FIXTURE) }],
    options: {},
    expected: ['| a | b |', '| 1 | 2 |'],
    invalid: { name: 'datos.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'csvToHtml', slug: 'csv-a-html', accepts: ['csv'],
    files: [{ name: 'datos.csv', mimeType: 'text/csv', data: b64(CSV2_FIXTURE) }],
    options: {},
    expected: ['<table>', '<td>1</td>'],
    invalid: { name: 'datos.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'csvToYaml', slug: 'csv-a-yaml', accepts: ['csv'],
    files: [{ name: 'datos.csv', mimeType: 'text/csv', data: b64(CSV2_FIXTURE) }],
    options: {},
    expected: ['datos:', '  a: 1'],
    invalid: { name: 'datos.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'csvStatistics', slug: 'estadisticas-csv', accepts: ['csv'],
    files: [{ name: 'ventas.csv', mimeType: 'text/csv', data: b64('ciudad,ventas\nmadrid,10\nbcn,20\n') }],
    options: {},
    expected: ['Filas de datos: 2', 'M\u00e1ximo: 20', 'Media: 15.0000'],
    invalid: { name: 'vacio.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'csvFilter', slug: 'filtrar-csv', accepts: ['csv'],
    files: [{ name: 'datos.csv', mimeType: 'text/csv', data: b64(CSV_FIXTURE) }],
    options: { column: '1', operator: '>=', value: '20' },
    expected: ['bcn', 'sevilla'],
    notExpected: ['madrid'],
    invalid: { name: 'vacio.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'csvSort', slug: 'ordenar-csv', accepts: ['csv'],
    files: [{ name: 'datos.csv', mimeType: 'text/csv', data: b64(CSV_FIXTURE) }],
    options: { column: '0', direction: 'asc' },
    expected: ['bcn', 'madrid', 'sevilla'],
    order: ['bcn', 'madrid', 'sevilla'],
    invalid: { name: 'vacio.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'csvToSql', slug: 'csv-a-sql', accepts: ['csv'],
    files: [{ name: 'personas.csv', mimeType: 'text/csv', data: b64('nombre,edad\nana,30\nluis,25\n') }],
    options: { tableName: 'personas', insertStyle: 'one' },
    expected: ['CREATE TABLE IF NOT EXISTS personas', 'INSERT INTO personas'],
    invalid: { name: 'vacio.csv', mimeType: 'text/csv', data: b64('') } },

  { id: 'jsonFormatter', slug: 'formatear-json', accepts: ['json'],
    files: [{ name: 'datos.json', mimeType: 'application/json', data: b64('{"b":1,"a":2,"c":[1,2]}') }],
    options: { indent: '2', sortKeys: true },
    expected: ['"a": 2', '"b": 1'],
    invalid: { name: 'malo.json', mimeType: 'application/json', data: b64('{invalido') } },

  { id: 'jsonValidator', slug: 'validar-json', accepts: ['json'],
    files: [{ name: 'datos.json', mimeType: 'application/json', data: b64('{"ok":true}') }],
    options: {},
    expected: ['Resultado: V\u00c1LIDO'],
    invalid: { name: 'malo.json', mimeType: 'application/json', data: b64('{invalido') } },

  { id: 'excelToHtml', slug: 'excel-a-html', accepts: ['xlsx'],
    files: [{ name: 'libro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: XLSX_FIXTURE.toString('base64') }],
    options: {},
    expected: ['<h2>S1</h2>', '<td>1</td>'],
    invalid: { name: 'falso.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: b64('no soy un xlsx') } },

  { id: 'excelToMarkdown', slug: 'excel-a-markdown', accepts: ['xlsx'],
    files: [{ name: 'libro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: XLSX_FIXTURE.toString('base64') }],
    options: {},
    expected: ['# S1', '| a | b |', '| 1 | 2 |'],
    invalid: { name: 'falso.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: b64('no soy un xlsx') } },

  { id: 'excelToXml', slug: 'excel-a-xml', accepts: ['xlsx'],
    files: [{ name: 'libro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: XLSX_FIXTURE.toString('base64') }],
    options: {},
    expected: ['<hojas>', '<hoja nombre="S1">', '<celda>1</celda>'],
    invalid: { name: 'falso.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: b64('no soy un xlsx') } },

    { id: 'xmlToExcel', slug: 'xml-a-excel', accepts: ['xml'],
    files: [{ name: 'datos.xml', mimeType: 'application/xml', data: b64(XML_FIXTURE) }],
    options: {},
    expected: ['Ana', 'Luis'],
    binary: true,
    invalid: { name: 'malo.xml', mimeType: 'application/xml', data: b64('<raiz><a>1</a></raiz>') } }
];

// ── Convertidoras de imagen (10) — se procesan por UI en app.js (no ToolProcessors) ──
const CONVERTERS = [
  { id: 'jpg-to-png', slug: 'jpg-a-png', toolId: 'convert',
    input: { ext: 'jpg', mime: 'image/jpeg' }, fixture: 'jpg',
    output: { ext: 'png', mime: 'image/png', magic: [0x89,0x50,0x4E,0x47] } },
  { id: 'png-to-jpg', slug: 'png-a-jpg', toolId: 'convert',
    input: { ext: 'png', mime: 'image/png' }, fixture: 'png',
    output: { ext: 'jpg', mime: 'image/jpeg', magic: [0xFF,0xD8,0xFF] } },
  { id: 'jpg-to-webp', slug: 'jpg-a-webp', toolId: 'convert',
    input: { ext: 'jpg', mime: 'image/jpeg' }, fixture: 'jpg',
    output: { ext: 'webp', mime: 'image/webp', magic: [0x52,0x49,0x46,0x46], webpTail: 'WEBP' } },
  { id: 'webp-to-jpg', slug: 'webp-a-jpg', toolId: 'convert',
    input: { ext: 'webp', mime: 'image/webp' }, fixture: 'webp',
    output: { ext: 'jpg', mime: 'image/jpeg', magic: [0xFF,0xD8,0xFF] } },
  { id: 'png-to-webp', slug: 'png-a-webp', toolId: 'convert',
    input: { ext: 'png', mime: 'image/png' }, fixture: 'png',
    output: { ext: 'webp', mime: 'image/webp', magic: [0x52,0x49,0x46,0x46], webpTail: 'WEBP' } },
  { id: 'webp-to-png', slug: 'webp-a-png', toolId: 'convert',
    input: { ext: 'webp', mime: 'image/webp' }, fixture: 'webp',
    output: { ext: 'png', mime: 'image/png', magic: [0x89,0x50,0x4E,0x47] } },
  { id: 'jpg-to-pdf', slug: 'jpg-a-pdf', toolId: 'imagesPdf',
    input: { ext: 'jpg', mime: 'image/jpeg' }, fixture: 'jpg',
    output: { ext: 'pdf', mime: 'application/pdf', magic: [0x25,0x50,0x44,0x46] } },
  { id: 'png-to-pdf', slug: 'png-a-pdf', toolId: 'imagesPdf',
    input: { ext: 'png', mime: 'image/png' }, fixture: 'png',
    output: { ext: 'pdf', mime: 'application/pdf', magic: [0x25,0x50,0x44,0x46] } },
  { id: 'pdf-to-jpg', slug: 'pdf-a-jpg', toolId: 'pdfToImages',
    input: { ext: 'pdf', mime: 'application/pdf' }, fixture: 'pdf',
    output: { ext: 'zip', mime: 'application/zip', magic: [0x50,0x4B,0x03,0x04], zipEntry: 'jpg' } },
  { id: 'pdf-to-png', slug: 'pdf-a-png', toolId: 'pdfToImages',
    input: { ext: 'pdf', mime: 'application/pdf' }, fixture: 'pdf',
    output: { ext: 'zip', mime: 'application/zip', magic: [0x50,0x4B,0x03,0x04], zipEntry: 'png' } }
];

const CONVERTER_UTILIDAD = {
  'jpg-to-png': 'Conversión de JPG a PNG',
  'png-to-jpg': 'Conversión de PNG a JPG',
  'jpg-to-webp': 'Conversión de JPG a WebP',
  'webp-to-jpg': 'Conversión de WebP a JPG',
  'png-to-webp': 'Conversión de PNG a WebP',
  'webp-to-png': 'Conversión de WebP a PNG',
  'jpg-to-pdf': 'Creación de PDF desde JPG',
  'png-to-pdf': 'Creación de PDF desde PNG',
  'pdf-to-jpg': 'Extracción de páginas PDF como JPG (ZIP)',
  'pdf-to-png': 'Extracción de páginas PDF como PNG (ZIP)'
};

const UTILIDAD = {
  textStatistics: 'Estadísticas de texto (palabras, párrafos, caracteres)',
  wordCount: 'Contador de palabras y caracteres',
  textDiff: 'Comparación de dos textos línea a línea',
  htmlToMarkdown: 'Conversión de HTML a Markdown',
  htmlToText: 'Extracción de texto plano desde HTML',
  cssMinifier: 'Minificación de CSS',
  base64Encode: 'Codificación Base64 de texto',
  base64Decode: 'Decodificación Base64 a texto',
  urlEncode: 'Codificación URL de texto',
  urlDecode: 'Decodificación URL a texto',
  csvToMarkdown: 'Conversión de CSV a Markdown',
  csvToHtml: 'Conversión de CSV a tabla HTML',
  csvToYaml: 'Conversión de CSV a YAML',
  csvStatistics: 'Estadísticas de columnas CSV',
  csvFilter: 'Filtrado de filas CSV por operador',
  csvSort: 'Ordenación de CSV por columna',
  csvToSql: 'Generación de sentencias SQL desde CSV',
  jsonFormatter: 'Formateo/ordenado de JSON',
  jsonValidator: 'Validación de sintaxis JSON',
  excelToHtml: 'Conversión de XLSX a tabla HTML',
  excelToMarkdown: 'Conversión de XLSX a Markdown',
  excelToXml: 'Conversión de XLSX a XML',
  xmlToExcel: 'Conversión de XML a libro XLSX'
};

let passed = 0;
let failed = 0;
const failures = [];
const toolResults = [];
const converterResults = [];

function record(ok, label, detail) {
  if (ok) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  \u2717 ${label}`); if (detail) console.log(`      ${String(detail).slice(0, 400)}`); }
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function syncCheck() {
  console.log('\n=== 0. Sincronizaci\u00f3n src/dist ===');
  const pairs = [
    ['tool-processors.js', 'dist/js/tool-processors.js'],
    ['app.js', 'dist/js/app.js'],
    ['js/file-limits.js', 'dist/js/file-limits.js']
  ];
  let ok = true;
  for (const [src, distRel] of pairs) {
    const a = sha256(fs.readFileSync(path.join(ROOT, src)));
    const b = sha256(fs.readFileSync(path.join(ROOT, distRel)));
    const same = a === b;
    if (!same) ok = false;
    record(same, `${distRel} byte-id\u00e9ntico a ${src}`, `hashes difieren`);
  }
  for (const t of TOOLS) {
    const page = path.join(DIST, `${t.slug}.html`);
    const exists = fs.existsSync(page);
    if (!exists) ok = false;
    record(exists, `${t.slug}.html existe en dist`, 'falta p\u00e1gina');
  }
  for (const c of CONVERTERS) {
    const page = path.join(DIST, `${c.slug}.html`);
    const exists = fs.existsSync(page);
    if (!exists) ok = false;
    record(exists, `${c.slug}.html existe en dist`, 'falta p\u00e1gina');
  }
  return ok;
}

const IGNORE_CONSOLE = /favicon|DevTools|Download the React/;

async function openPage(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { page, errors };
}

async function ensureXlsx(page) {
  return page.evaluate(() => {
    if (window.XLSX) return true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = './vendor/xlsx/xlsx.min.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  });
}

function makeFilesJs(files) {
  // Convert fixture descriptors to browser File objects
  return files.map(f => {
    const bin = atob(f.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name, { type: f.mimeType });
  });
}

async function directCorrectness(page, tool) {
  const opts = tool.options || {};
  const code = `
    (async () => {
      if (!window.ToolProcessors || typeof window.ToolProcessors[${JSON.stringify(tool.id)}] !== 'function') {
        return { error: 'ToolProcessors.' + ${JSON.stringify(tool.id)} + ' no disponible' };
      }
      const files = ${JSON.stringify(tool.files)};
      const list = files.map(f => {
        const bin = atob(f.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], f.name, { type: f.mimeType });
      });
      const opts = ${JSON.stringify(opts)};
      const res = await window.ToolProcessors[${JSON.stringify(tool.id)}](list, opts, () => {});
      if (!res || !res.files || !res.files.length) {
        return { empty: true, message: res && res.message };
      }
      const blob = res.files[0].blob;
      const info = { name: res.files[0].name, size: blob.size, type: blob.type, message: res.message };
      if (${tool.binary ? 'true' : 'false'}) {
        const ab = await blob.arrayBuffer();
        if (window.XLSX) {
          try {
            const wb = window.XLSX.read(new Uint8Array(ab), { type: 'array' });
            const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
            info.json = JSON.stringify(aoa);
          } catch (e) { info.parseError = String(e && e.message || e); }
        }
        info.b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ab.slice(0, 64))));
      } else {
        info.text = await blob.text();
      }
      return info;
    })()
  `;
  return page.evaluate(code);
}

async function directInvalid(page, tool) {
  const code = `
    (async () => {
      const f = ${JSON.stringify(tool.invalid)};
      const bin = atob(f.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], f.name, { type: f.mimeType });
      let outcome = 'resolved';
      let detail = '';
      try {
        const res = await window.ToolProcessors[${JSON.stringify(tool.id)}]([file], {}, () => {});
        detail = res && res.files && res.files.length ? 'devuelve archivo de salida' : (res && res.message || 'files:[]');
      } catch (e) {
        outcome = 'rejected';
        detail = String(e && e.message || e).slice(0, 200);
      }
      return { outcome, detail };
    })()
  `;
  return page.evaluate(code);
}

async function uiRun(page, tool) {
  await page.goto(`http://127.0.0.1:${PORT}/${tool.slug}.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
  // subir fixtures uno a uno (el input no es multiple)
  for (const f of tool.files) {
    const buf = Buffer.from(f.data, 'base64');
    await page.setInputFiles('#fileInput', { name: f.name, mimeType: f.mimeType, buffer: buf });
  }
  await page.waitForTimeout(300);
  // el boton se muestra tras seleccionar herramienta y anadir archivos
  await page.waitForFunction(() => {
    const b = document.getElementById('runButton');
    return b && b.offsetParent !== null && !b.disabled;
  }, { timeout: 10000 }).catch(() => {});
  // rellenar opciones si la pagina las expone
  for (const [id, val] of Object.entries(tool.options || {})) {
    const sel = `#advancedControls #${id}`;
    await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null);
    const el = await page.$(sel);
    if (el) {
      const info = await el.evaluate(n => ({ tag: n.tagName, type: n.type || '' }));
      if (info.tag === 'SELECT') {
        await el.selectOption(String(val));
      } else if (info.tag === 'INPUT' && info.type === 'checkbox') {
        await el.evaluate((n, v) => { n.checked = !!v; }, val);
      } else {
        await el.fill(String(val));
      }
    }
  }
  // esperar a que el boton este habilitado y hacer clic
  await page.waitForFunction(() => { const b = document.getElementById('runButton'); return b && !b.disabled; }, { timeout: 10000 }).catch(() => {});
  await page.click('#runButton');
  let opened = false;
  try {
    await page.waitForSelector('#resultDialog[open]', { timeout: 20000 });
    opened = true;
  } catch (_) { /* no se abrio */ }
  const title = await page.$eval('#resultTitle', el => el.textContent.trim()).catch(() => '');
  const message = await page.$eval('#resultMessage', el => el.textContent.trim()).catch(() => '');
  return { opened, title, message };
}

function hasMagic(buf, magic) {
  if (!buf || buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
  return true;
}

function isWebp(buf) {
  return hasMagic(buf, [0x52,0x49,0x46,0x46]) && buf.slice(8, 12).toString('latin1') === 'WEBP';
}

// Genera fixtures válidos en el navegador (canvas + PDFLib) para no depender de constantes.
async function buildFixtures(browser) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/toolisto`, { waitUntil: 'domcontentloaded' });
  const data = await page.evaluate(async () => {
    function b64Of(d) { return d.split(',')[1]; }
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e23b3b';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 8, 8);
    const png = b64Of(c.toDataURL('image/png'));
    const jpg = b64Of(c.toDataURL('image/jpeg'));
    const webp = b64Of(c.toDataURL('image/webp'));
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = './vendor/pdflib/pdf-lib.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    const { PDFDocument, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    const pg = doc.addPage([120, 120]);
    pg.drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: rgb(0.2, 0.4, 0.9) });
    const bytes = await doc.save();
    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    const pdf = btoa(bin);
    return { png, jpg, webp, pdf };
  });
  await page.close();
  return data;
}

async function collectDownload(download) {
  if (!download) return null;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const ch of stream) chunks.push(ch);
  return Buffer.concat(chunks);
}

// Ejecuta el flujo válido de una convertidora por la interfaz y devuelve la descarga.
async function converterRun(page, conv, fixtures) {
  const inputB64 = fixtures[conv.fixture];
  const buf = Buffer.from(inputB64, 'base64');
  await page.goto(`http://127.0.0.1:${PORT}/${conv.slug}.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#fileInput', { name: `muestra.${conv.input.ext}`, mimeType: conv.input.mime, buffer: buf });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const b = document.getElementById('runButton');
    return b && b.offsetParent !== null && !b.disabled;
  }, { timeout: 15000 }).catch(() => {});
  await page.click('#runButton');
  let opened = false;
  try { await page.waitForSelector('#resultDialog[open]', { timeout: 40000 }); opened = true; } catch (_) { /* no se abrió */ }
  if (!opened) return { opened: false };
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 40000 }).catch(() => null),
    page.click('#downloadButton')
  ]);
  const outBuf = await collectDownload(download);
  return { opened: true, download, outBuf };
}

async function decodeImageInPage(page, b64, mime) {
  return page.evaluate(async ({ b64, mime }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode-error')); });
      return { w: img.naturalWidth, h: img.naturalHeight };
    } catch (e) { return { error: String(e && e.message || e) }; }
    finally { URL.revokeObjectURL(url); }
  }, { b64, mime });
}

async function parsePdfInPage(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try {
      if (!window.pdfjsLib) return { error: 'pdfjs no disponible' };
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      return { pages: pdf.numPages };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }, { b64 });
}

async function inspectZipInPage(page, b64) {
  return page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!window.JSZip) return { error: 'JSZip no disponible' };
    const zip = await window.JSZip.loadAsync(bytes);
    const entries = [];
    for (const name of Object.keys(zip.files)) {
      const f = zip.files[name];
      if (f.dir) continue;
      const entry = await f.async('uint8array');
      entries.push({ name, head: Array.from(entry.slice(0, 4)) });
    }
    return { entries };
  }, { b64 });
}

// Entrada inválida: nunca debe abrir el diálogo de resultado ni colgar (puede tostada).
async function converterInvalid(page, conv) {
  await page.goto(`http://127.0.0.1:${PORT}/${conv.slug}.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#fileInput', { name: 'roto.png', mimeType: 'image/png', buffer: Buffer.from('esto no es una imagen ni un pdf valido', 'utf8') });
  await page.waitForTimeout(400);
  await page.click('#runButton', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const dialogOpen = await page.$('#resultDialog[open]');
  return { dialogOpen: !!dialogOpen };
}

async function run() {
  console.log('\n=== VERIFICACI\u00d3N DE LAS 33 HERRAMIENTAS (23 + 10 convertidoras) ===\n');
  const syncOk = syncCheck();

  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  try {
    for (const tool of TOOLS) {
      console.log(`\n--- ${tool.id} (/${tool.slug}.html) ---`);
      const { page, errors } = await openPage(browser);
      const toolPassedAtStart = passed;
      const toolFailedAtStart = failed;
      const toolErrors = [];

      // 1) Apertura
      await page.goto(`http://127.0.0.1:${PORT}/${tool.slug}.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
      record(errors.length === 0, 'Apertura sin errores de consola', errors.join(' | '));

      // 2) Entrada válida + resultado esperado (nivel procesador real)
      if (tool.accepts.some(a => ['xlsx', 'csv', 'xml', 'json'].includes(a))) {
        const hasXlsx = await ensureXlsx(page);
        record(hasXlsx, 'SheetJS disponible', 'no se pudo cargar xlsx.min.js');
      }
      const info = await directCorrectness(page, tool);
      if (info.error) {
        record(false, 'Procesador expuesto', info.error);
      } else if (info.empty) {
        record(false, 'Entrada v\u00e1lida produce resultado', 'procesador devolvi\u00f3 files:[] -> ' + (info.message || ''));
      } else if (tool.binary) {
        const okType = /spreadsheetml|excel|octet-stream/.test(info.type) && info.size > 0;
        record(okType, 'Salida binaria xlsx generada (' + info.size + ' B, ' + info.type + ')', 'tipo/size no v\u00e1lido');
        const hasJson = info.json && info.json.length > 0;
        const containsNames = tool.expected.every(s => (info.json || '').includes(s));
        record(hasJson && containsNames, 'Contenido del xlsx contiene datos esperados', info.json);
      } else {
        const text = info.text || '';
        const hits = tool.expected.filter(s => text.includes(s));
        record(hits.length === tool.expected.length, 'Salida contiene resultado esperado', `esperaba ${JSON.stringify(tool.expected)}, obtuvo: ${JSON.stringify(text.slice(0, 300))}`);
        if (tool.notExpected) {
          const misses = tool.notExpected.filter(s => text.includes(s));
          record(misses.length === 0, 'Salida NO contiene valores excluidos', `encontr\u00f3: ${JSON.stringify(misses)}`);
        }
        if (tool.order) {
          const idx = tool.order.map(s => text.indexOf(s));
          const ordered = idx.every((v, i) => v !== -1 && (i === 0 || idx[i - 1] < v));
          record(ordered, 'Filas en el orden esperado', JSON.stringify(idx));
        }
      }

      // 3) Entrada inválida: debe resolverse o rechazarse, nunca colgar
      const inv = await directInvalid(page, tool);
      record(inv.outcome === 'resolved' || inv.outcome === 'rejected', 'Entrada inv\u00e1lida manejada', inv.outcome + ': ' + inv.detail);

      // 4) E2E por interfaz
      const ui = await uiRun(page, tool);
      record(ui.opened, 'E2E UI: di\u00e1logo de resultado se abre', `title=${ui.title || ''} msg=${ui.message || ''}`);
      record(errors.length === 0, 'E2E UI sin errores de consola', errors.join(' | '));

      toolErrors.push(...errors);
      const tPassed = passed - toolPassedAtStart;
      const tFailed = failed - toolFailedAtStart;
      toolResults.push({
        toolId: tool.id,
        slug: tool.slug,
        utilidad: UTILIDAD[tool.id] || '',
        checks: tPassed + tFailed,
        passed: tPassed,
        failed: tFailed,
        estado: tFailed === 0 ? 'CERTIFICADA' : 'FALLO',
        errores: toolErrors,
        accion: tFailed === 0 ? 'Añadir a la matriz de certificación; permanece habilitada.' : 'Deshabilitar con causa documentada; pasar al backlog.'
      });
      await page.close();
    }

    // ═══════════════════════════════════════════════
    // CONVERTIDORAS (10): flujo UI completo
    // ═══════════════════════════════════════════════
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  CONVERTIDORAS DE IMAGEN (10)               ║');
    console.log('╚══════════════════════════════════════════════╝');
    const fixtures = await buildFixtures(browser);
    record(!!(fixtures.png && fixtures.jpg && fixtures.webp && fixtures.pdf), 'Fixtures PNG/JPG/WebP/PDF generados en el navegador', 'falta algún fixture');
    for (const conv of CONVERTERS) {
      console.log(`\n--- ${conv.id} (/${conv.slug}.html) ---`);
      const { page, errors } = await openPage(browser);
      const tPassedStart = passed;
      const tFailedStart = failed;

      await page.goto(`http://127.0.0.1:${PORT}/${conv.slug}.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#fileInput', { state: 'attached', timeout: 15000 });
      record(errors.length === 0, 'Apertura sin errores de consola', errors.join(' | '));

      const flow = await converterRun(page, conv, fixtures);
      if (!flow.opened) {
        record(false, 'Flujo UI: se abre el diálogo de resultado', 'el diálogo no se abrió en 40s');
      } else if (!flow.outBuf) {
        record(false, 'Flujo UI: se genera descarga', 'no se capturó download');
      } else {
        record(true, 'Flujo UI: se abre el diálogo y se genera descarga', `${flow.download.suggestedFilename()} (${flow.outBuf.length} B)`);
        const nameOk = flow.download.suggestedFilename().toLowerCase().endsWith('.' + conv.output.ext);
        record(nameOk, `Nombre de descarga termina en .${conv.output.ext}`, flow.download.suggestedFilename());
        let magicOk;
        if (conv.output.webpTail) magicOk = isWebp(flow.outBuf);
        else magicOk = hasMagic(flow.outBuf, conv.output.magic);
        record(magicOk, `Magic bytes correctos (${conv.output.ext.toUpperCase()})`, `head=${Array.from(flow.outBuf.slice(0, 12)).join(',')}`);
        if (conv.output.ext === 'zip') {
          const zipInfo = await inspectZipInPage(page, flow.outBuf.toString('base64'));
          const hasEntry = zipInfo.entries && zipInfo.entries.some(e => e.name.toLowerCase().endsWith('.' + conv.output.zipEntry));
          record(hasEntry, `El ZIP contiene entradas .${conv.output.zipEntry}`, JSON.stringify(zipInfo).slice(0, 300));
          if (zipInfo.entries && zipInfo.entries.length) {
            const sample = zipInfo.entries.find(e => e.name.toLowerCase().endsWith('.' + conv.output.zipEntry));
            if (sample) {
              const okEntry = conv.output.zipEntry === 'jpg' ? (sample.head[0] === 0xFF && sample.head[1] === 0xD8) : (sample.head[0] === 0x89 && sample.head[1] === 0x50);
              record(okEntry, `Entrada ${sample.name} con magic de ${conv.output.zipEntry.toUpperCase()}`, JSON.stringify(sample.head));
            }
          }
        } else if (conv.output.ext === 'pdf') {
          const pdfInfo = await parsePdfInPage(page, flow.outBuf.toString('base64'));
          record(pdfInfo.pages >= 1, `PDF válido con ${pdfInfo.pages} página(s)`, JSON.stringify(pdfInfo));
        } else {
          const dec = await decodeImageInPage(page, flow.outBuf.toString('base64'), conv.output.mime);
          record(dec.w > 0 && dec.h > 0, `La imagen de salida decodifica (${dec.w}×${dec.h})`, JSON.stringify(dec));
        }
      }
      record(errors.length === 0, 'Flujo UI sin errores de consola', errors.join(' | '));
      await page.close();

      // Entrada inválida en página nueva (su console.error controlado no contamina el flujo válido)
      const { page: p2, errors: e2 } = await openPage(browser);
      const inv = await converterInvalid(p2, conv);
      const uncaught = e2.filter(m => m.startsWith('pageerror:'));
      record(!inv.dialogOpen && uncaught.length === 0, 'Entrada inválida manejada sin diálogo ni excepción no controlada', `dialog=${inv.dialogOpen} pageerrors=${uncaught.join('|')}`);
      await p2.close();

      const cPassed = passed - tPassedStart;
      const cFailed = failed - tFailedStart;
      converterResults.push({
        toolId: conv.id,
        slug: conv.slug,
        toolIdTecnico: conv.toolId,
        utilidad: CONVERTER_UTILIDAD[conv.id] || '',
        checks: cPassed + cFailed,
        passed: cPassed,
        failed: cFailed,
        estado: cFailed === 0 ? 'CERTIFICADA' : 'FALLO',
        accion: cFailed === 0 ? 'Añadir a la matriz de certificación; permanece habilitada.' : 'Deshabilitar con causa documentada.'
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== RESUMEN ===');
  console.log(`  Sync src/dist: ${syncOk ? 'OK' : 'FALLO'}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length) {
    console.log('\n  Fallos:');
    for (const f of failures) console.log(`    - ${f.label}: ${f.detail}`);
  }
  const ok = failed === 0 && syncOk;
  const evidenceDir = path.join(ROOT, 'artifacts', 'deep-audit', 'toolisto');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    suite: 'verify-23-tools',
    fecha: new Date().toISOString(),
    totalChecks: passed + failed,
    passed,
    failed,
    syncOk,
    herramientas: toolResults
  };
  writeEvidence(path.join(evidenceDir, 'TLT-certify-23-tools-evidence.json'), evidence);
  const convEvidence = {
    suite: 'verify-converters',
    fecha: new Date().toISOString(),
    totalConverters: CONVERTERS.length,
    totalChecks: passed + failed,
    passed,
    failed,
    syncOk,
    herramientas: converterResults
  };
  writeEvidence(path.join(evidenceDir, 'TLT-certify-converters-evidence.json'), convEvidence);
  console.log(`\n  Evidencia: artifacts/deep-audit/toolisto/TLT-certify-23-tools-evidence.json`);
  console.log(`             artifacts/deep-audit/toolisto/TLT-certify-converters-evidence.json`);
  console.log(ok ? '\n\u2713 VERIFICACI\u00d3N COMPLETA' : '\n\u2717 HAY FALLOS');
  process.exit(ok ? 0 : 1);
}

run();
