#!/usr/bin/env node
/**
 * CE-050 — Capturas (imágenes escaneadas) encadenadas a Flujos
 *
 * El flujo estrella `archivo → escaneo → OCR → documento → …` requiere que una
 * captura guardada en el proyecto pueda entrar al constructor de flujos. CE-003
 * solo permitía encadenar documentos y tablas; esta prueba verifica el camino
 * completo de una captura real hasta el OCR:
 *
 *  1. Seed directo en IndexedDB real (sin mocks): proyecto + captura + asset
 *     corregido apuntando a una imagen real (fixture scan-clear.png).
 *  2. Abrir el proyecto → vista Capturas → botón «Encadenar» de la captura.
 *  3. El constructor de flujos se abre con la captura como entrada (kind image).
 *  4. Se añade la operación real «Extraer texto (OCR)» y se ejecuta.
 *  5. El resultado text llega al Workspace como documento con las palabras OCR
 *     reales del fixture y persiste tras reload (IndexedDB directo).
 *  6. Sin errores de consola y sin requests externos (local-first hermético).
 *
 * Port: E2E_PORT env var or 8082
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');

const PORT = Number(process.env.E2E_PORT || 8082);
const ORIGIN = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

let _srv;
function startServer() {
  return new Promise((resolve, reject) => {
    _srv = createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/index.html';
      let fp = join(DIST, file);
      if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, 'index.html');
      if (!existsSync(fp)) fp = join(DIST, file + '.html');
      const ext = extname(fp).toLowerCase();
      const data = readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    _srv.on('error', reject);
    _srv.listen(PORT, () => resolve());
  });
}
function stopServer() { return new Promise(resolve => { if (_srv) _srv.close(() => resolve()); else resolve(); }); }

let pass = 0, fail = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS: ${name}${detail ? ' -- ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }
}
function ko(name, detail = '') { fail++; failures.push(name); console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`); }

const scanPng = readFileSync(join(ROOT, 'tests', 'fixtures', 'star-flow', 'scan-clear.png'));
const scanDataUrl = 'data:image/png;base64,' + scanPng.toString('base64');

// Seed: 1 proyecto + 1 captura que referencia su asset corregido (patrón CE-029:
// la captura NO copia el PNG; apunta a correctedAssetId).
const SEED = (dataUrl) => `
  (async () => {
  const __db = await import('/workspace/core/db.js');
  const __S = __db.STORES;
  for (const s of Object.values(__S)) { try { await __db.dbClear(s); } catch (e) {} }
  const __now = Date.now();
  const __base = (id, type, extra = {}) => ({
    id, type, createdAt: __now, updatedAt: __now, projectId: 'p-chain', _version: 1,
    metadata: {}, history: [], relations: [], processingState: 'idle', errors: [],
    sourceAssetId: null, derivedIds: [],
    ...extra,
  });
  await __db.dbPut(__S.projects, __base('p-chain', 'project', { projectId: null, name: 'Proyecto Cadena' }));
  const __asset = __base('asset-corregido-1', 'image-asset', {
    name: 'Escaneo claro', type: 'image-asset',
    dataUrl: ${JSON.stringify(dataUrl)},
    originalDataUrl: ${JSON.stringify(dataUrl)},
  });
  await __db.dbPut(__S.assets, __asset);
  const __cap = __base('cap-chain-1', 'capture', {
    name: 'Escaneo claro',
    timestamp: __now,
    correctedAssetId: 'asset-corregido-1',
    metadata: { captureId: 'cap-chain-1' },
  });
  __cap.relations = [{ id: 'r1', sourceId: 'cap-chain-1', targetId: 'asset-corregido-1', type: 'asset' }];
  await __db.dbPut(__S.captures, __cap);
  return true;
})()`;

async function main() {
  await startServer();
  console.log(`Server on :${PORT}`);
  console.log('\n=== CE-050: Capturas encadenadas a Flujos (escaneo → OCR) ===');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  const externalRequests = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  ctx.on('request', r => {
    const u = new URL(r.url());
    const sameOrigin = u.protocol === 'http:' && u.host === `localhost:${PORT}`;
    const nonNetwork = u.protocol === 'blob:' || u.protocol === 'data:' || u.protocol === 'file:';
    if (!sameOrigin && !nonNetwork) externalRequests.push(r.url());
  });

  try {
    // ─── 1. Abrir workspace ─────────────────────────────────────
    console.log('\n--- 1. Abrir workspace ---');
    await page.goto(`${ORIGIN}/workspace/index.html?preview=internal`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(300);

    // ─── 2. Seed proyecto + captura ─────────────────────────────
    console.log('\n--- 2. Seed en IndexedDB (sin mocks) ---');
    const seeded = await page.evaluate(SEED(scanDataUrl));
    ok('2. Seed de proyecto con captura completado', seeded === true);
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(300);

    // ─── 3. Abrir el proyecto ───────────────────────────────────
    console.log('\n--- 3. Abrir proyecto ---');
    const projectOpened = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.ws-card')];
      const target = cards.find(c => c.textContent.includes('Proyecto Cadena'));
      if (target) { target.click(); return true; }
      return false;
    });
    ok('3. Proyecto seed seleccionado', projectOpened);

    // ─── 4. Vista Capturas muestra la captura y su botón Encadenar ──
    console.log('\n--- 4. Vista Capturas ---');
    await page.waitForTimeout(500);
    await page.click('.sidebar-item[data-view="capture"]');
    const chainBtn = page.getByRole('button', { name: /Encadenar/ });
    await chainBtn.first().waitFor({ state: 'visible', timeout: 15000 }).catch(e => console.log('  [diag] espera Encadenar fallida: ' + e.message.split('\n')[0]));
    await page.waitForTimeout(300);
    const captureBody = await page.locator('body').innerText();
    ok('4. Captura visible en la vista Capturas', /Escaneo claro/i.test(captureBody), captureBody.slice(0, 200).replace(/\n/g, ' '));
    try {
      await chainBtn.first().waitFor({ state: 'visible', timeout: 15000 });
      ok('4. Boton Encadenar presente en la tarjeta de captura', true);
    } catch (e) {
      ko('4. Boton Encadenar no encontrado en capturas: ' + captureBody.slice(0, 400).replace(/\n/g, ' '));
    }

    // ─── 5. Encadenar abre el constructor con la captura como entrada ──
    console.log('\n--- 5. Encadenar captura al constructor ---');
    await chainBtn.first().click();
    await page.waitForSelector('#wf-file-input', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(500);
    const flowBody = await page.locator('body').innerText();
    ok('5. Constructor de flujos abierto', flowBody.includes('Constructor de flujos'));
    ok('5. Captura reconocida como entrada de imagen', /Escaneo claro \(image\)/i.test(flowBody), flowBody.split('\n').filter(l => /Escaneo|image/i.test(l)).join(' | '));

    // ─── 6. Añadir OCR real y ejecutar ──────────────────────────
    console.log('\n--- 6. OCR real sobre la captura ---');
    await page.getByRole('button', { name: /Anadir operacion/ }).click();
    await page.locator('#wf-op-results').getByText('Extraer texto (OCR)', { exact: true }).click();
    await page.getByRole('button', { name: /Ejecutar flujo/ }).click();
    await page.waitForSelector('#wf-results-section', { state: 'visible', timeout: 120000 });

    const resultText = await page.locator('#wf-results-section').innerText();
    const addBtn = page.locator('#wf-results-section button', { hasText: 'Anadir al Workspace' });
    try {
      await addBtn.first().waitFor({ state: 'visible', timeout: 15000 });
      ok('6. Resultado OCR ofrece Anadir al Workspace', true);
    } catch (e) {
      ko('6. Sin Anadir al Workspace en el resultado OCR: ' + resultText.slice(0, 300).replace(/\n/g, ' '));
    }

    // ─── 7. Añadir el texto OCR al Workspace y persistir ────────
    console.log('\n--- 7. Persistencia del documento OCR ---');
    if (await addBtn.count() >= 1) {
      await addBtn.first().click();
      await page.waitForTimeout(800);
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800);
    }
    const docState = await page.evaluate(() => new Promise(resolve => {
      try {
        const req = indexedDB.open('toolisto-workspace', 3);
        req.onerror = () => resolve({ docs: -1, ocrWords: false, snippets: [] });
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('documents');
          const store = tx.objectStore('documents');
          const all = store.getAll();
          all.onsuccess = () => {
            const docs = all.result || [];
            const withBlocks = docs.filter(d => Array.isArray(d.blocks) && d.blocks.length > 0);
            const ocrLike = docs.some(d => Array.isArray(d.blocks) && d.blocks.some(b => /ventas|completado|progreso|pendiente|calc/i.test(String(b.content || ''))));
            const snippets = withBlocks.slice(0, 2).map(d => String(d.blocks.map(b => b.content).join(' | ')).slice(0, 200));
            resolve({ docs: withBlocks.length, ocrWords: ocrLike, snippets });
          };
          all.onerror = () => resolve({ docs: -1, ocrWords: false, snippets: [] });
        };
      } catch (e) { resolve({ docs: -2, ocrWords: false, snippets: [] }); }
    }));
    if (docState.docs >= 1) ok('7. Documento OCR persistido en IndexedDB tras reload (' + docState.docs + ' con bloques)', true);
    else ko('7. No se persistió documento OCR: ' + JSON.stringify(docState));
    if (docState.ocrWords) ok('7. El documento persistido contiene palabras OCR reales del fixture', true);
    else ko('7. Documento sin palabras OCR del fixture. Snippets: ' + JSON.stringify(docState.snippets));

    // ─── 8. Salud: sin errores ni egress externo ────────────────
    console.log('\n--- 8. Salud ---');
    ok('8. Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
    ok('8. Sin errores de consola', consoleErrors.length === 0, consoleErrors.join(' | '));
    ok('8. Cero requests externos', externalRequests.length === 0, externalRequests.join(' | '));
  } finally {
    await browser.close();
    await stopServer();
  }

  console.log(`\n=== Resultado: ${pass} PASS, ${fail} FAIL ===`);
  if (failures.length > 0) {
    console.log('Fallos: ' + failures.join(', '));
    process.exit(1);
  }
  console.log('CE-050 capture-flow-chain: OK');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
