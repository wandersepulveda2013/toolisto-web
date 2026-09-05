import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l) || new RegExp('^export function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');

const augSrc =
  grabFn(wsCode, 'cloneDocEntity') + '\n' +
  grabFn(wsCode, 'cloneDataTableEntity') + '\n' +
  grabFn(wsCode, 'cloneCaptureEntity');

let nextId = 1000;
const genId = () => 'gen-' + (nextId++);
const relCalls = [];
const stubAddRelation = (obj, targetId, type) => {
  relCalls.push({ targetId, type });
  if (!obj.relations) obj.relations = [];
  obj.relations.push({ targetId, type });
  return obj;
};
const api = new Function('generateId', 'addRelation', augSrc + '\nreturn { cloneDocEntity, cloneDataTableEntity, cloneCaptureEntity };')(genId, stubAddRelation);

console.log('=== CE-131: duplicar entidades en sitio (documento, tabla y captura) ===');
console.log('(cloneDocEntity / cloneDataTableEntity / cloneCaptureEntity REALES de workspace.js)');

// DOCUMENTO
{
  const doc = {
    id: 'doc-1',
    title: 'Informe de ventas',
    type: 'text-document',
    blocks: [
      { id: 'b1', type: 'paragraph', content: 'hola' },
      { id: 'b2', type: 'heading1', content: 'Título A' },
      { id: 'b3', type: 'image-block', content: '', src: 'blob:x' },
    ],
  };
  const copy = api.cloneDocEntity(doc, 'p99');
  check('documento: id nuevo y distinto del original', copy.id && copy.id !== doc.id);
  check('documento: projectId nuevo', copy.projectId === 'p99');
  check('documento: nombre con sufijo (copia)', copy.name === 'Informe de ventas (copia)');
  check('documento: title sincronizado con el nombre', copy.title === copy.name);
  check('documento: type preservado', copy.type === 'text-document');
  check('documento: bloques en la misma cantidad', Array.isArray(copy.blocks) && copy.blocks.length === doc.blocks.length);
  check('documento: cada bloque recibe un id nuevo', copy.blocks.every(b => b.id && !doc.blocks.some(o => o.id === b.id)));
  check('documento: contenido de bloques copiado', copy.blocks[0].content === 'hola' && copy.blocks[1].content === 'Título A');
  const deepCopy = copy.blocks[0].content === 'hola';
  copy.blocks[0].content = 'MUTADO';
  check('documento: bloques son copia (no aliasing del array original)', deepCopy && doc.blocks[0].content === 'hola');
  check('documento: timestamps nuevos', typeof copy.createdAt === 'number' && typeof copy.updatedAt === 'number');
}

// DOCUMENTO sin titulo/bloques
{
  const copy = api.cloneDocEntity({ id: 'doc-2', type: 'notes' }, 'p99');
  check('documento vacio: nombre por defecto', copy.name === 'Documento (copia)');
  check('documento vacio: blocks vacio []', Array.isArray(copy.blocks) && copy.blocks.length === 0);
}

// TABLA
{
  const table = {
    id: 't1',
    workbookId: 'wb-1',
    name: 'Ventas Q3',
    headers: ['Producto', 'Importe'],
    rows: [['A', '10'], ['B', '20']],
    columnTypes: ['text', 'number'],
    cellConfidence: [[90, 85], [95, 88]],
    _colFilters: { '0': new Set(['A']) },
  };
  const copy = api.cloneDataTableEntity(table, 'p99');
  check('tabla: id nuevo y distinto', copy.id !== table.id);
  check('tabla: projectId nuevo', copy.projectId === 'p99');
  check('tabla: nombre con sufijo (copia)', copy.name === 'Ventas Q3 (copia)');
  check('tabla: headers copiados', JSON.stringify(copy.headers) === JSON.stringify(['Producto', 'Importe']));
  check('tabla: filas copiadas', JSON.stringify(copy.rows) === JSON.stringify([['A', '10'], ['B', '20']]));
  copy.rows[0][0] = 'Z';
  check('tabla: filas son copia profunda (sin aliasing)', table.rows[0][0] === 'A');
  copy.cellConfidence[1][1] = 0;
  check('tabla: cellConfidence copia profunda (sin aliasing)', table.cellConfidence[1][1] === 88);
  copy.columnTypes[1] = 'date';
  check('tabla: columnTypes copia (sin aliasing)', table.columnTypes[1] === 'number');
  check('tabla: workbookId preservado', copy.workbookId === 'wb-1');
  check('tabla: no hereda _colFilters (limite documentado: el clon nace sin filtros)', copy._colFilters === undefined);
  check('tabla: cellConfidence presente en el clon', Array.isArray(copy.cellConfidence) && copy.cellConfidence.length === 2);
  check('tabla: columnTypes presente en el clon', copy.columnTypes !== undefined);
}

// TABLA sin filas ni metadatos opcionales
{
  const copy = api.cloneDataTableEntity({ id: 't2', name: 'Vacía', headers: ['A'] }, 'p11');
  check('tabla vacia: rows por defecto []', Array.isArray(copy.rows) && copy.rows.length === 0);
  check('tabla vacia: columnTypes undefined (sin inventar)', copy.columnTypes === undefined);
  check('tabla vacia: cellConfidence undefined (sin inventar)', copy.cellConfidence === undefined);
}

// CAPTURA scan: la imagen se REUSA (NO se duplica)
{
  const cap = {
    id: 'cap-1',
    type: 'scan',
    name: 'Factura escaneada',
    timestamp: 10,
    sourceAssetId: 'asset-src',
    correctedAssetId: 'asset-corr',
    scanDocumentId: 'scan-9',
    ocrSource: 'tesseract',
    scannerMetadata: { rotation: 90, cornersModified: true, ocrSource: 'tesseract' },
  };
  relCalls.length = 0;
  const copy = api.cloneCaptureEntity(cap, 'p99');
  check('captura: id nuevo y distinto', copy.id !== cap.id);
  check('captura: projectId nuevo', copy.projectId === 'p99');
  check('captura: nombre con sufijo (copia)', copy.name === 'Factura escaneada (copia)');
  check('captura: type preservado', copy.type === 'scan');
  check('captura: timestamp nuevo', typeof copy.timestamp === 'number' && copy.timestamp >= cap.timestamp);
  check('captura: correctedAssetId REUSADO (imagen compartida, no duplicada)', copy.correctedAssetId === 'asset-corr');
  check('captura: sourceAssetId conservado', copy.sourceAssetId === 'asset-src');
  check('captura: scanDocumentId conservado', copy.scanDocumentId === 'scan-9');
  check('captura: ocrSource conservado', copy.ocrSource === 'tesseract');
  check('captura: scannerMetadata copiado (objeto distinto)', copy.scannerMetadata !== cap.scannerMetadata && copy.scannerMetadata.rotation === 90 && cap.scannerMetadata.rotation === 90);
  copy.scannerMetadata.rotation = 0;
  check('captura: scannerMetadata sin aliasing', cap.scannerMetadata.rotation === 90);
  check('captura: relacion asset declarada con el asset reusado', relCalls.some(r => r.targetId === 'asset-corr' && r.type === 'asset'));
  check('captura: relations embebidas en la copia', Array.isArray(copy.relations) && copy.relations[0].targetId === 'asset-corr' && copy.relations[0].type === 'asset');
}

// CAPTURA sin correctedAssetId / sin nombre / sin type
{
  relCalls.length = 0;
  const bare = api.cloneCaptureEntity({ id: 'cap-2', name: '' }, 'p99');
  check('captura basica: nombre por defecto', bare.name === 'Captura (copia)');
  check('captura basica: type por defecto scan', bare.type === 'scan');
  check('captura basica: sin correctedAssetId no declara relaciones', bare.relations === undefined && relCalls.length === 0);
  const flow = api.cloneCaptureEntity({ id: 'cap-3', type: 'workflow-result', name: 'Flujo X', correctedAssetId: 'asset-f' }, 'p99');
  check('captura workflow-result: type preservado', flow.type === 'workflow-result');
  check('captura workflow-result: imagen reusada', flow.correctedAssetId === 'asset-f');
}

// ANTI-REGRESION ESTATICA
check('anti-regresion: los 3 helpers clone* estan en workspace.js', wsCode.includes('function cloneDocEntity(doc, projectId)') && wsCode.includes('function cloneDataTableEntity(table, projectId)') && wsCode.includes('function cloneCaptureEntity(capture, projectId)'));
check('anti-regresion: las 3 tarjetas llaman a duplicate*Card', wsCode.includes('duplicateDocCard(doc)') && wsCode.includes('duplicateDataTableCard(table)') && wsCode.includes('duplicateCaptureCard(cap)'));
check('anti-regresion: las 3 tarjetas exponen un boton "Duplicar" con icono copy', (wsCode.match(/svgIcon\('copy'\), ' Duplicar'/g) || []).length === 3);
check('anti-regresion: los 3 duplicate*Card usan clon + save* + refreshProjectCounts', (wsCode.match(/cloneDocEntity\(doc, project.id\);\n  await saveDoc/g) || []).length === 1 && (wsCode.match(/cloneDataTableEntity\(table, project.id\);\n  await saveData/g) || []).length === 1 && (wsCode.match(/cloneCaptureEntity\(capture, project.id\);\n  await saveCapture/g) || []).length === 1);
const cloneCapStart = wsCode.indexOf('function cloneCaptureEntity(');
const cloneCapBody = wsCode.slice(cloneCapStart, wsCode.indexOf('\n}', cloneCapStart));
check('anti-regresion: duplicar captura NO crea un asset nuevo', (wsCode.match(/duplicateCaptureCard/g) || []).length === 2 && !/createImageAsset|saveAsset|dataUrl|blob:/.test(cloneCapBody));
check('anti-regresion: la copia de captura reusa correctedAssetId de la fuente', /correctedAssetId: capture\.correctedAssetId/s.test(wsCode));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);