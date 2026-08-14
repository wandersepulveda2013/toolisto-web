// Certifica la frontera OCR: Workspace ES module y sitio público clásico.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
let passed = 0;
let failed = 0;
function check(condition, name) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

const publicEngine = readFileSync(join(root, 'js/ocr/pdf-ocr-engine.js'), 'utf8');
const processors = readFileSync(join(root, 'tool-processors.js'), 'utf8');
const workspaceEngine = readFileSync(join(root, 'workspace/core/ocr-engine.js'), 'utf8');
const publicExtract = processors.slice(
  processors.indexOf('window.ToolProcessors.extractTextFromScannedPdf'),
  processors.indexOf('window.ToolProcessors.detectOcrNeeded')
);

console.log('=== Arquitectura OCR PDF ===');
check(publicEngine.includes('Adaptador OCR del sitio público') && publicEngine.includes('ocrCanvas'), 'adaptador público OCR-PDF documentado y expuesto');
check(workspaceEngine.includes('script clásico') && workspaceEngine.includes('no puede importar este módulo'), 'límite del módulo Workspace documentado');
check(!/EngineLoader\.loadTesseract|worker\.recognize/.test(publicExtract), 'extractTextFromScannedPdf no crea un worker OCR paralelo');
check(publicExtract.includes('window.PdfOcrEngine.ocrCanvas'), 'extractTextFromScannedPdf usa el adaptador OCR-PDF canónico');
check(existsSync(join(root, 'dist/js/ocr/pdf-ocr-engine.js')), 'build publica el adaptador OCR-PDF');
check(existsSync(join(root, 'dist/workspace/core/ocr-engine.js')), 'build conserva el motor aislado del Workspace');

console.log(`=== Resultado: ${passed} PASS, ${failed} FAIL ===`);
process.exit(failed ? 1 : 0);
