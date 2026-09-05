import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');

function extractSlashItems() {
  const start = wsCode.indexOf('const slashItems = [');
  if (start < 0) throw new Error('slashItems no encontrado');
  let blockStart = -1;
  for (let j = start; j < wsCode.length; j++) {
    if (wsCode[j] === '[') { blockStart = j; break; }
  }
  if (blockStart < 0) throw new Error('sin bloque para slashItems');
  let d = 0;
  for (let j = blockStart; j < wsCode.length; j++) {
    const c = wsCode[j];
    if (c === '[') d++;
    else if (c === ']') d--;
    if (d === 0 && j > blockStart) return wsCode.slice(start, j + 1);
  }
  throw new Error('final no encontrado para slashItems');
}

const itemsExpr = extractSlashItems();
const items = new Function('return ' + itemsExpr.replace(/^const slashItems = /, ''))();

const VALID_SLASH_TYPES = ['heading1', 'heading2', 'paragraph', 'bullet-list', 'callout', 'divider'];

console.log('=== CE-132: el slash-menu "/" crea blocos bullet-list validos (no "list") ===');
console.log('');

check('lista: el array slashItems se extrae con los 6 items', Array.isArray(items) && items.length === 6);

const listaItem = items.find(item => item.label === 'Lista');
check('lista: el item "Lista" usa type bullet-list', listaItem && listaItem.type === 'bullet-list');
check('lista: el item "Lista" NO usa type "list"', listaItem && listaItem.type !== 'list');
check('lista: desc del item sigue siendo "Lista con viñetas"', listaItem && listaItem.desc === 'Lista con viñetas');

check('lista: ningun item del slash-menu usa el tipo invalido "list"', items.every(item => item.type !== 'list'));
check('lista: todos los tipos del slash-menu son validos', items.every(item => item.label && VALID_SLASH_TYPES.includes(item.type)));
check('lista: los 6 tipos esperados estan presentes', ['heading1', 'heading2', 'paragraph', 'bullet-list', 'callout', 'divider'].every(t => items.some(i => i.type === t)));
check('lista: el slash-menu de "Lista" es unico (sin duplicados bullet-list)', items.filter(i => i.type === 'bullet-list').length === 1);

console.log('');
console.log('--- Anti-regresion: el tipo "list" no puede reintroducirse ---');

const btnMedia = (wsCode.match(/type: 'list'/g) || []).length;
check('anti-regresion: 0 ocurrencias de type: \'list\' en workspace.js', btnMedia === 0);

const blockTypesExpr = wsCode.slice(wsCode.indexOf('const BLOCK_TYPES = ['), wsCode.indexOf('];', wsCode.indexOf('const BLOCK_TYPES = [')) + 2);
const blockTypes = new Function('return ' + blockTypesExpr.replace(/^const BLOCK_TYPES = /, ''))();
const blockTypeValues = blockTypes.map(b => b.type);
check('anti-regresion: BLOCK_TYPES define bullet-list', blockTypeValues.includes('bullet-list'));
check('anti-regresion: BLOCK_TYPES define numbered-list (la lista ordenada de la toolbar sigue intacta)', blockTypeValues.includes('numbered-list'));
check('anti-regresion: BLOCK_TYPES no define el tipo invalido "list"', !blockTypeValues.includes('list'));

const slashMenuBlock = wsCode.slice(wsCode.indexOf('const slashItems = ['), wsCode.indexOf('\n          const hideSlashMenu'));
check('anti-regresion: el click del slash-menu sigue asignando block.type = item.type', /block\.type = item\.type;/.test(slashMenuBlock));
check('anti-regresion: al elegir el item se conserva hideSlashMenu + renderBlocks + autoSaveDoc', /hideSlashMenu\(\);/.test(slashMenuBlock) && /renderBlocks\(\);/.test(slashMenuBlock) && /autoSaveDoc\(doc\);/.test(slashMenuBlock));

console.log('--- Paridad con el resto de rutas de import/export de listas ---');

const grabFn = (name) => {
  const lines = wsCode.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('sin final para ' + name);
};
const exportMd = grabFn('exportDocumentMarkdown');
check('paridad: exportDocumentMarkdown maneja bullet-list como "- content"', exportMd.includes("'bullet-list'") && exportMd.includes("'- ' + (block.content || '')") && exportMd.includes("'\\n\\n';"));
check('paridad: createTextBlock del import de Markdown mapea "- item" a bullet-list', /createTextBlock\('bullet-list'/.test(wsCode));

console.log(`\n=== TOTALS: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);