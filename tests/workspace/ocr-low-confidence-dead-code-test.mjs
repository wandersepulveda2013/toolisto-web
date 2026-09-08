#!/usr/bin/env node
/**
 * CE-137 — cierre DEAD_CODE: la funcion muerta `faithfulOcrText` (promesa de
 * "resaltar palabras dudosas del OCR" que nunca renderizaba) y la clase CSS
 * huerfana `.ws-ocr-low-confidence` se eliminaron en 5a3629f (recuperacion de
 * presupuesto W6) pero CE-137 quedo DISCOVERED sin cerrar. Este ciclo:
 *   1) certifica que la funcion muerta y la clase CSS YA NO existen en el bundle
 *      fuente (escaneo de workspace.js + workspace.css, cero ocurrencias);
 *   2) limpia la condicion redundante que escribia `doc.ocrWords` dos veces
 *      (`if (mode === 'faithful' && words ...)` subsumida por la linea general);
 *   3) certifica que la cadena VIVA `doc.ocrWords -> ocrWordConfidenceMap ->
 *      buildCellConfidenceMatrix -> table.cellConfidence` sigue cableada: la
 *      confianza por palabra alimenta la matriz de revision de la tabla.
 * Comportamiento probado con funciones REALES de workspace.js via grabFn.
 */
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
const cssCode = readFileSync(new URL('../../workspace/workspace.css', import.meta.url), 'utf8');
const parserCode = readFileSync(new URL('../../workspace/core/locale-parser.js', import.meta.url), 'utf8');
// locale-parser.js es ESM sin "type":"module": se compila el bloque completo con los
// helpers (stripNoise y constantes) quitando los "export" para que valide en new Function.
const parserHead = parserCode.slice(parserCode.indexOf('const CURRENCY_RE'), parserCode.indexOf('export function classifyDate')).replace(/^export function/gm, 'function');
const parseLocaleNumber = new Function(parserHead + '\nreturn parseLocaleNumber;')();
const deps =
  grabFn(wsCode, 'normalizeOcrNumber') + '\n' +
  grabFn(wsCode, 'ocrWordConfidenceMap') + '\n' +
  grabFn(wsCode, 'cellConfidence') + '\n';
const buildMatrix = new Function('parseLocaleNumber', deps + grabFn(wsCode, 'buildCellConfidenceMatrix') + '\nreturn buildCellConfidenceMatrix;')(parseLocaleNumber);
const wordMap = new Function('parseLocaleNumber', grabFn(wsCode, 'normalizeOcrNumber') + '\n' + grabFn(wsCode, 'ocrWordConfidenceMap') + '\nreturn ocrWordConfidenceMap;')(parseLocaleNumber);
const normalize = new Function('parseLocaleNumber', grabFn(wsCode, 'normalizeOcrNumber') + '\nreturn normalizeOcrNumber;')(parseLocaleNumber);

console.log('=== CE-137: el resaltado muerto de palabras dudosas quedo eliminado y la cadena viva de confianza sigue cableada ===\n');

// --- 1. CERO codigo muerto en el bundle fuente ---
{
  check('dead: 0 ocurrencias de faithfulOcrText en workspace.js', !wsCode.includes('faithfulOcrText'), '');
  check('dead: 0 ocurrencias de .ws-ocr-low-confidence en workspace.js', !wsCode.includes('ws-ocr-low-confidence'), '');
  check('dead: 0 ocurrencias de .ws-ocr-low-confidence en workspace.css', !cssCode.includes('ws-ocr-low-confidence'), '');
}

// --- 2. Cadena VIVA cableada (confianza por palabra -> matriz de celda) ---
{
  check('live: ocrWordConfidenceMap definido en workspace.js', wsCode.includes('function ocrWordConfidenceMap('), '');
  check('live: buildCellConfidenceMatrix definido en workspace.js', wsCode.includes('function buildCellConfidenceMatrix('), '');
  check('live: convertDocToTable construye table.cellConfidence con la matriz',
    wsCode.includes('table.cellConfidence = buildCellConfidenceMatrix(table, doc);'), '');
  check('live: finalizeExtraction persiste doc.ocrWords', wsCode.includes('doc.ocrWords = words'), '');
  check('live: escribe doc.ocrWords UNA sola vez (dedup de la condicion redundante)',
    (wsCode.match(/doc\.ocrWords = words/g) || []).length === 1, '');
  check('live: OCR_LOW_CONFIDENCE definido y usado en la revision/UI (>3 usos)', (wsCode.match(/OCR_LOW_CONFIDENCE/g) || []).length >= 3, '');
}

// --- 3. Comportamiento REAL de las funciones que consumen doc.ocrWords ---
{
  check('normalize: "1-30" -> "-30" (signo del OCR)', normalize('1-30') === '-30', JSON.stringify(normalize('1-30')));
  check('normalize: "1500,25" se conserva (numero valido)', normalize('1500,25') === '1500,25', '');
  check('normalize: vacio -> ""', normalize('   ') === '', '');

  const m1 = wordMap([{ text: '1-30', confidence: 80 }, { text: '-30', confidence: 75 }]);
  check('wordMap: "1-30" y "-30" se fusionan en una sola clave', m1.size === 1, `size=${m1.size}`);
  check('wordMap: la clave fusionada conserva la MIN confianza', m1.get('-30') === 75, JSON.stringify([...m1]));
  const m2 = wordMap([{ text: '', confidence: 90 }, { text: 'Ventas', confidence: 87.6 }]);
  check('wordMap: texto en blanco se salta', m2.size === 1, `size=${m2.size}`);
  check('wordMap: confianza se redondea', m2.get('Ventas') === 88, JSON.stringify([...m2]));
  const m3 = wordMap([{ text: 'Total', confidence: 90 }, { text: 'Total', confidence: 50 }]);
  check('wordMap: token duplicado -> min confianza', m3.get('Total') === 50, JSON.stringify([...m3]));

  const doc = { ocrWords: [{ text: '-30', confidence: 80 }], ocrConfidence: 60 };
  const mat1 = buildMatrix({ rows: [['-30', 'C']] }, doc);
  check('matrix: palabra con confianza -> 80', mat1[0][0] === 80, JSON.stringify(mat1));
  check('matrix: celda sin palabra ni vacia -> fallback ocrConfidence 60', mat1[0][1] === 60, JSON.stringify(mat1));
  const mat2 = buildMatrix({ rows: [['C', '']] }, doc);
  check('matrix: celda vacia -> null (sin fictar confianza)', mat2[0][1] === null, JSON.stringify(mat2));
  const mat3 = buildMatrix({ rows: [['x']] }, { ocrConfidence: 0 });
  check('matrix: sin ocrWords y fallback 0 -> null', mat3[0][0] === null, JSON.stringify(mat3));
  const doc4 = { ocrWords: [{ text: '1500,25', confidence: 70 }], ocrConfidence: 20 };
  const mat4 = buildMatrix({ rows: [['1.500,25']] }, doc4);
  check('matrix: equivalente numerico europeo (1.500,25 vs 1500,25) -> 70', mat4[0][0] === 70, JSON.stringify(mat4));
  const doc5 = { ocrWords: [{ text: 'Enero', confidence: 90 }, { text: '2026', confidence: 55 }], ocrConfidence: 40 };
  const mat5 = buildMatrix({ rows: [['Enero 2026']] }, doc5);
  check('matrix: celda multi-token -> min de confidencias', mat5[0][0] === 55, JSON.stringify(mat5));
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);