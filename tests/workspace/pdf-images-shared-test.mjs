#!/usr/bin/env node
/**
 * tests/workspace/pdf-images-shared-test.mjs — CE-037.
 *
 * Verifica que la normalización de imágenes de PDF vive en un único módulo
 * compartido (`core/pdf-images.js`) y que ambas rutas la usan, evitando el
 * re-encode JPEG duplicado:
 *   - document.to-pdf  -> core/workflow-operations.js (updateSize: true)
 *   - ruta de diseños  -> workspace.js (preparePdfImages)
 *
 * En Node (sin Image/document definidos) el helper debe pasar las secciones
 * tal cual, como hace el generador con su placeholder. El re-encode real en
 * canvas se valida en navegador por `pdf-image-embed-e2e.mjs`.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const imagesCode = readFileSync(join(ROOT, 'workspace', 'core', 'pdf-images.js'), 'utf8');
const opsCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-operations.js'), 'utf8');
const wsCode = readFileSync(join(ROOT, 'workspace', 'workspace.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const sandbox = { Promise, Object, Array, Error, String };
const script = new vm.Script(stripImports(imagesCode) + '\nglobalThis.normalizePdfImageSections = normalizePdfImageSections;');
script.runInNewContext(sandbox);

const normalizePdfImageSections = sandbox.normalizePdfImageSections;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Compartido de normalización de imágenes PDF (CE-037) ===\n');

// 1. El módulo exporta el helper compartido y, sin DOM, no muta la entrada.
check('pdf-images.js exporta normalizePdfImageSections', typeof normalizePdfImageSections === 'function');

// 2. Sin Image/document definidos, las secciones pasan tal cual (placeholder).
{
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const sections = [
    { type: 'title', content: 'Titulo' },
    { type: 'image', dataUrl: jpeg },
    { type: 'image', dataUrl: png },
    { type: 'text', content: 'Cuerpo' },
  ];
  const out = await normalizePdfImageSections(sections, { updateSize: true });
  check('Sin DOM: mismas secciones en el mismo orden', out.length === 4 && out.every((s, i) => s === sections[i]));
  check('Sin DOM: el JPEG no se re-encoda', out[1] && out[1].dataUrl === jpeg);
  check('Sin DOM: el PNG se conserva para placeholder', out[2] && out[2].dataUrl === png);
  check('Sin DOM: text y title intactos', out[0].type === 'title' && out[3].type === 'text');
}

// 3. Dedup por ruta: workflow-operations ya no define preparePdfImageSections.
check('workflow-operations usa normalizePdfImageSections', /normalizePdfImageSections/.test(opsCode) && !/function preparePdfImageSections\s*\(/.test(opsCode));
check('document.to-pdf pasa updateSize (semántica previa)', /normalizePdfImageSections\s*\(\s*[\s\S]{0,80}updateSize:\s*true/.test(opsCode));
check('workflow-operations conserva loadImage para operaciones de imagen', /function loadImage\s*\(src\)/.test(opsCode));

// 4. Dedup por ruta: workspace.js delega en el helper compartido.
check('workspace.js importa normalizePdfImageSections', /import\s*\{[^}]*normalizePdfImageSections/.test(wsCode));
check('preparePdfImages ya no duplica el re-encode inline', !/function preparePdfImages\(config\)[\s\S]*?new Image\(\)[\s\S]*?canvas\.toDataURL/.test(wsCode));
check('preparePdfImages invoca el helper compartido', /async function preparePdfImages\(config\)[\s\S]*?normalizePdfImageSections\s*\(/.test(wsCode));
check('preparePdfImages conserva reportError en el fallo', /normalizePdfImageSections\s*\([\s\S]*?reportError\(error, 'report-image-prepare'/.test(wsCode));

console.log('\nResultados: ' + pass + ' pass, ' + fail + ' fail, ' + (pass + fail) + ' tests\n');
process.exit(fail > 0 ? 1 : 0);