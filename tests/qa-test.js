const { readFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
let failures = 0;

function fail(msg) { console.error(`  FAIL: ${msg}`); failures++; }
function pass(msg) { console.log(`  PASS: ${msg}`); }

console.log('=== QA Test ===\n');

// Check index.html
const indexPath = join(root, 'index.html');
if (!existsSync(indexPath)) { fail('index.html no existe'); } else {
  const html = readFileSync(indexPath, 'utf8');
  pass('index.html existe');

  // HTML structure
  if (!html.includes('<!doctype html>') && !html.includes('<!DOCTYPE html>')) fail('DOCTYPE no encontrado');
  else pass('DOCTYPE presente');

  if (!html.includes('lang="es"')) fail('Attribute lang no encontrado');
  else pass('Attribute lang="es" presente');

  if (!html.includes('charset="utf-8"') && !html.includes('charset=utf-8')) fail('Charset no encontrado');
  else pass('Charset presente');

  if (!html.includes('viewport')) fail('Viewport no encontrado');
  else pass('Viewport presente');

  // No broken references
  const scriptRefs = html.match(/src="([^"]+)"/g) || [];
  for (const ref of scriptRefs) {
    const path = ref.replace(/src="|"/g, '');
    if (!path.startsWith('http') && !existsSync(join(root, path))) {
      fail(`Referencia rota: ${path}`);
    }
  }
  pass(`${scriptRefs.length} referencias verificadas`);

  // No inline scripts that could cause errors
  const inlineScripts = (html.match(/<script(?![^>]*src=)[^>]*>/g) || []).length;
  if (inlineScripts > 0) {
    pass(`${inlineScripts} scripts inline presentes`);
  }
}

// Check app.js syntax
const appPath = join(root, 'app.js');
if (!existsSync(appPath)) { fail('app.js no existe'); } else {
  const appContent = readFileSync(appPath, 'utf8');
  pass('app.js existe');

  try {
    new Function(appContent);
    pass('app.js: sintaxis válida');
  } catch (e) {
    fail(`app.js: error de sintaxis: ${e.message}`);
  }

  // Check essential functions
  const essentialFns = ['chooseTool', 'runCurrentTool', 'updateRecommendation', 'filterTools', 'addFiles'];
  for (const fn of essentialFns) {
    if (!appContent.includes(`function ${fn}`)) {
      fail(`Función "${fn}" no encontrada`);
    } else {
      pass(`Función "${fn}" encontrada`);
    }
  }

  // Check state object
  if (!appContent.includes('const state')) {
    fail('Objeto state no encontrado');
  } else {
    pass('Objeto state encontrado');
  }

  // Check tool-page-config handling
  if (!appContent.includes('tool-page-config')) {
    fail('Lectura de tool-page-config no encontrada');
  } else {
    pass('tool-page-config manejado en app.js');
  }
}

// Check styles.css
const cssPath = join(root, 'styles.css');
if (!existsSync(cssPath)) { fail('styles.css no existe'); } else {
  const css = readFileSync(cssPath, 'utf8');
  pass('styles.css existe');

  const essentialClasses = ['.tool-card', '.tool-grid', '.filter-chip', '.drop-zone', '.smart-result'];
  for (const cls of essentialClasses) {
    if (!css.includes(cls)) {
      fail(`Clase CSS "${cls}" no encontrada`);
    } else {
      pass(`Clase CSS "${cls}" encontrada`);
    }
  }
}

// Check tool-processors.js
const procPath = join(root, 'src', 'tool-processors.js');
if (!existsSync(procPath)) { fail('src/tool-processors.js no existe'); } else {
  const procContent = readFileSync(procPath, 'utf8');
  pass('src/tool-processors.js existe');

  try {
    const m = {};
    const fn = new Function('module', 'exports', 'require', 'window', 'globalThis', 'self', procContent);
    fn(m, m.exports || {}, () => ({ PDFDocument: {} }), {}, {}, {});
    pass('tool-processors.js: sintaxis válida');
  } catch (e) {
    fail(`tool-processors.js: error de sintaxis: ${e.message}`);
  }
}

// Check tools.json
const toolsPath = join(root, 'src', 'data', 'tools.json');
if (!existsSync(toolsPath)) { fail('src/data/tools.json no existe'); } else {
  try {
    const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));
    pass(`tools.json: ${tools.length} herramientas`);
    if (!Array.isArray(tools)) fail('tools.json no es un array');
    else pass('tools.json es un array válido');
  } catch (e) {
    fail(`tools.json: error de JSON: ${e.message}`);
  }
}

console.log(`\n=== Resultado: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
process.exit(failures > 0 ? 1 : 0);
