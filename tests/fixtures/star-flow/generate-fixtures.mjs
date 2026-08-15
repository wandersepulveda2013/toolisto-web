import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
mkdirSync(__dirname, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

// scan-clear.png — documento tabular nítido para validar OCR real
await page.setContent(`<!DOCTYPE html>
<html><head><style>
  body { margin:0; padding:12px; background:#fff; font-family:Arial,Helvetica,sans-serif; color:#111; }
  table { border:0; border-collapse:separate; border-spacing:0; table-layout:fixed; width:396px; }
  th, td { border:0; padding:7px 8px; text-align:left; font-size:20px; line-height:1.15; }
  th { background:#e8e8e8; font-weight:700; }
  tr:nth-child(odd) td { background:#f7f7f7; }
  th:nth-child(1) { width:38%; }
  th:nth-child(2) { width:16%; }
  th:nth-child(3) { width:46%; }
</style></head><body>
<table>
  <tr><th>Nombre</th><th>Valor</th><th>Estado</th></tr>
  <tr><td>Ventas Q1</td><td>150</td><td>Completado</td></tr>
  <tr><td>Ventas Q2</td><td>80</td><td>En progreso</td></tr>
  <tr><td>Devoluciones</td><td>-30</td><td>Pendiente</td></tr>
  <tr><td>Costos fijos</td><td>-200</td><td>Pagado</td></tr>
  <tr><td>Ganancia neta</td><td>0</td><td>Calculado</td></tr>
</table>
</body></html>`, { waitUntil: 'networkidle' });
await page.setViewportSize({ width: 420, height: 260 });
await page.screenshot({ path: join(__dirname, 'scan-clear.png'), clip: { x: 0, y: 0, width: 420, height: 260 } });
console.log('Created scan-clear.png');

// scan-difficult.png — mismo contenido con texto pequeño y degradación reproducible
await page.setContent(`<!DOCTYPE html>
<html><head><style>
  body { margin:0; padding:24px; background:#e5e3de; font-family:Arial,Helvetica,sans-serif; color:#505050; }
  table { border-collapse:collapse; table-layout:fixed; width:340px; background:#f5f3ee; }
  th, td { border:1px solid #aaa; padding:4px 5px; text-align:left; font-size:12px; line-height:1.1; font-weight:400; }
  th { background:#d8d6d1; font-weight:600; }
  th:nth-child(1) { width:38%; }
  th:nth-child(2) { width:16%; }
  th:nth-child(3) { width:46%; }
</style></head><body>
<table>
  <tr><th>Nombre</th><th>Valor</th><th>Estado</th></tr>
  <tr><td>Ventas Q1</td><td>150</td><td>Completado</td></tr>
  <tr><td>Ventas Q2</td><td>80</td><td>En progreso</td></tr>
  <tr><td>Devoluciones</td><td>-30</td><td>Pendiente</td></tr>
  <tr><td>Costos fijos</td><td>-200</td><td>Pagado</td></tr>
  <tr><td>Ganancia neta</td><td>0</td><td>Calculado</td></tr>
</table>
</body></html>`, { waitUntil: 'networkidle' });
await page.setViewportSize({ width: 420, height: 260 });
const difficultSource = await page.screenshot({ clip: { x: 0, y: 0, width: 420, height: 260 } });
const difficultDataUrl = await page.evaluate(async (source) => {
  const image = new Image();
  image.src = source;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });

  const reduced = document.createElement('canvas');
  reduced.width = 294;
  reduced.height = 182;
  const reducedContext = reduced.getContext('2d');
  reducedContext.imageSmoothingEnabled = true;
  reducedContext.imageSmoothingQuality = 'low';
  reducedContext.drawImage(image, 0, 0, reduced.width, reduced.height);

  const output = document.createElement('canvas');
  output.width = 420;
  output.height = 260;
  const context = output.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'low';
  context.filter = 'blur(0.35px) contrast(82%)';
  context.drawImage(reduced, 0, 0, output.width, output.height);
  context.filter = 'none';

  const pixels = context.getImageData(0, 0, output.width, output.height);
  let seed = 0x3c2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < pixels.data.length; index += 4) {
    const noise = Math.round((random() - 0.5) * 18);
    for (let channel = 0; channel < 3; channel++) {
      pixels.data[index + channel] = Math.max(0, Math.min(255, pixels.data[index + channel] + noise));
    }
    if (random() < 0.0025) {
      const dust = random() < 0.65 ? 70 : 220;
      pixels.data[index] = dust;
      pixels.data[index + 1] = dust;
      pixels.data[index + 2] = dust;
    }
  }
  context.putImageData(pixels, 0, 0);
  return output.toDataURL('image/png');
}, `data:image/png;base64,${difficultSource.toString('base64')}`);
writeFileSync(join(__dirname, 'scan-difficult.png'), Buffer.from(difficultDataUrl.split(',')[1], 'base64'));
console.log('Created scan-difficult.png');

// scan-table.png — tabla similar pero con formato ligeramente distinto
await page.setContent(`<!DOCTYPE html>
<html><head><style>
  body { margin:0; padding:16px; background:white; font-family:Georgia,serif; }
  table { border-collapse:collapse; width:340px; }
  th, td { border:1px solid #555; padding:5px 10px; text-align:left; font-size:14px; }
  th { background:#d0d0d0; }
</style></head><body>
<table>
  <tr><th>Producto</th><th>Cantidad</th><th>Precio</th></tr>
  <tr><td>Lapiz</td><td>120</td><td>1.500</td></tr>
  <tr><td>Cuaderno</td><td>85</td><td>3.250</td></tr>
  <tr><td>Borrador</td><td>200</td><td>800</td></tr>
</table>
</body></html>`, { waitUntil: 'networkidle' });
await page.setViewportSize({ width: 400, height: 200 });
await page.screenshot({ path: join(__dirname, 'scan-table.png'), clip: { x: 0, y: 0, width: 400, height: 200 } });
console.log('Created scan-table.png');

await browser.close();
console.log('All star-flow fixtures generated.');
