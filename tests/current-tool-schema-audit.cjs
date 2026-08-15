const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TOOLS_PATH = path.join(ROOT, 'src', 'data', 'tools.json');
const REQUIRED_FIELDS = ['id', 'toolId', 'slug', 'category', 'name', 'title', 'description', 'icon', 'accepts'];

function loadTools() {
  return JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf8'));
}

function unique(values) {
  return new Set(values).size === values.length;
}

function pageFor(tool) {
  return path.join(DIST, `${tool.slug}.html`);
}

function checkTool(tool, fail, pass, context = '') {
  const prefix = context ? `${context}: ` : '';
  for (const field of REQUIRED_FIELDS) {
    if (tool[field] === undefined || tool[field] === null || tool[field] === '') {
      fail(`${prefix}${tool.id || tool.toolId || 'herramienta'}: falta "${field}"`);
    }
  }
  if (typeof tool.enabled !== 'boolean') fail(`${prefix}${tool.id}: enabled debe ser booleano`);
  if (typeof tool.indexable !== 'boolean') fail(`${prefix}${tool.id}: indexable debe ser booleano`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.slug || '')) fail(`${prefix}${tool.id}: slug no es URL-safe`);
  if (!fs.existsSync(pageFor(tool))) fail(`${prefix}${tool.id}: falta dist/${tool.slug}.html`);

  const htmlPath = pageFor(tool);
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const match = html.match(/<script type="application\/json" id="tool-page-config">([\s\S]*?)<\/script>/);
    if (!match) {
      fail(`${prefix}${tool.id}: falta tool-page-config`);
    } else {
      try {
        const config = JSON.parse(match[1]);
        if (config.toolId !== tool.toolId) fail(`${prefix}${tool.id}: tool-page-config no coincide`);
      } catch (error) {
        fail(`${prefix}${tool.id}: tool-page-config no es JSON válido (${error.message})`);
      }
    }
  }
  pass(`${prefix}${tool.id}: esquema y página actuales válidos`);
}

function runGroup(label, ids) {
  let failures = 0;
  const fail = message => { console.error(`  FAIL: ${message}`); failures++; };
  const pass = message => console.log(`  PASS: ${message}`);
  const tools = loadTools();
  const selected = ids.map(id => tools.find(tool => tool.id === id));

  console.log(`=== ${label} (esquema actual) ===\n`);
  ids.forEach((id, index) => {
    if (!selected[index]) fail(`${id}: no existe en tools.json`);
  });
  selected.filter(Boolean).forEach(tool => checkTool(tool, fail, pass, label));
  console.log(`\n=== Resultado ${label}: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
  return failures === 0;
}

function runAll() {
  let failures = 0;
  const fail = message => { console.error(`  FAIL: ${message}`); failures++; };
  const pass = message => console.log(`  PASS: ${message}`);
  const tools = loadTools();
  const enabled = tools.filter(tool => tool.enabled === true);
  const ids = tools.map(tool => tool.id);
  const slugs = tools.map(tool => tool.slug);

  console.log('=== Auditoría del esquema actual de Toolisto ===\n');
  pass(`tools.json cargado: ${tools.length} herramientas`);
  const nonBool = tools.filter(tool => typeof tool.enabled !== 'boolean');
  if (nonBool.length) fail(`${nonBool.length} herramientas sin enabled booleano`);
  else pass(`Todas las ${tools.length} herramientas tienen enabled booleano`);
  pass(`Habilitadas ${enabled.length} / en revisión ${tools.length - enabled.length}`);
  if (!unique(ids)) fail('Hay IDs duplicados');
  else pass('IDs únicos');
  if (!unique(slugs)) fail('Hay slugs duplicados');
  else pass('Slugs únicos');

  tools.forEach(tool => checkTool(tool, fail, pass));

  const indexPath = path.join(DIST, 'toolisto.html');
  if (!fs.existsSync(indexPath)) {
    fail('Falta dist/toolisto.html');
  } else {
    const html = fs.readFileSync(indexPath, 'utf8');
    const cards = (html.match(/class="tool-card/g) || []).length;
    if (cards !== enabled.length) fail(`El catálogo Toolisto tiene ${cards} tarjetas, esperadas ${enabled.length}`);
    else pass(`El catálogo Toolisto tiene ${cards} tarjetas`);
  }

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const processors = fs.readFileSync(path.join(ROOT, 'tool-processors.js'), 'utf8');
  const covered = new Set();
  for (const match of processors.matchAll(/ToolProcessors\.(\w+)\s*=/g)) covered.add(match[1]);
  for (const match of app.matchAll(/case\s+'(\w+)'\s*:/g)) covered.add(match[1]);
  const missingCoverage = tools.filter(tool => !covered.has(tool.toolId));
  if (missingCoverage.length) fail(`Faltan ${missingCoverage.length} toolIds sin procesador ni handler: ${missingCoverage.map(tool => tool.toolId).join(', ')}`);
  else pass(`Los ${tools.length} toolIds tienen procesador o handler`);

  console.log(`\n=== Resultado general: ${failures === 0 ? 'APROBADO' : `${failures} FALLO(S)`} ===`);
  return failures === 0;
}

module.exports = { runAll, runGroup };
