#!/usr/bin/env node
/**
 * Diagnostic benchmark for perspective correction cost (CE-014).
 * Measures wall-clock ms for a large capture correction in the browser.
 * Output is diagnostic only; not a gate and not deterministic evidence.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.E2E_PORT || 8084);
const BASE = `http://localhost:${PORT}/workspace/index.html?preview=internal`;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
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

await new Promise(r => srv.listen(PORT, r));
console.log(`Server on :${PORT}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForSelector('.ws-home-stats', { timeout: 10000 });

const sizes = [[1200, 1600], [1600, 2200], [2400, 3200]];
for (const [w, h] of sizes) {
  const result = await page.evaluate(async ({ w, h }) => {
    const { perspectiveCorrectBilinear } = await import('./core/image-processor.js');
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const ctx = src.getContext('2d');
    ctx.fillStyle = '#e8e4da';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    for (let y = 0; y < h; y += 40) ctx.fillRect(20, y, 200, 12);
    // Full-page quadrilateral slightly inset and skewed.
    const corners = [[w * 0.02, h * 0.03], [w * 0.97, h * 0.02], [w * 0.98, h * 0.97], [w * 0.03, h * 0.98]];
    const outW = Math.round(Math.max(
      Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]),
      Math.hypot(corners[3][0] - corners[2][0], corners[3][1] - corners[2][1])));
    const outH = Math.round(Math.max(
      Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1]),
      Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1])));
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const out = perspectiveCorrectBilinear(src, corners, outW, outH);
      const t1 = performance.now();
      times.push(t1 - t0);
      if (out.width !== outW || out.height !== outH) return { error: 'bad dims' };
    }
    return { src: `${w}x${h}`, out: `${outW}x${outH}`, times: times.map(t => +t.toFixed(1)), ms: +(times[1]).toFixed(1) };
  }, { w, h });
  console.log(JSON.stringify(result));
}

await browser.close();
await new Promise(r => srv.close(r));
