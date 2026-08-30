#!/usr/bin/env node
// CE-079: el parser de instrucciones (instruction-parser.js) detectaba el
// formato de destino de una conversion con detectFormat, que recorria los
// aliases en orden de definicion y devolvia el PRIMERO presente en el texto.
// Cuando la instruccion nombraba el formato FUENTE y el DESTINO, la iteracion
// podia devolver la fuente: "convierte este jpg a webp" (jpg se define antes
// que webp) resolvio a image/jpeg -> la imagen se "convertia" a jpeg (sin
// cambio) en vez de a webp. Igualmente "pasa este png a gif" podia no ser
// fiable segun el orden de definicion (jpg -> jpeg -> png -> webp -> svg ->
// gif -> bmp -> pdf).
//
// El fix anade detectDestinationFormat: el formato que aparece DESPUES de una
// preposicion de destino (" a ", " en ", " a formato ") tiene prioridad sobre
// detectFormat (respaldo). Verifica el destino correcto en conversiones con
// fuente explícita, y conserva el comportamiento de frases de destino unico.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'workspace', 'core', 'instruction-parser.js');
const code = readFileSync(SRC, 'utf8');
const body = code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
const sandbox = { console, Map, Array, Object, Error, RegExp, parseInt, Math, Set, Number };
const fn = new Function('console', 'Map', 'Array', 'Object', 'Error', 'RegExp', 'parseInt', 'Math', 'Set', 'Number',
  body + '\nreturn createInstructionParser;'
);
const createInstructionParser = fn(console, Map, Array, Object, Error, RegExp, parseInt, Math, Set, Number);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Instruction Parser: formato de destino prioritario (CE-079) ===\n');

const parser = createInstructionParser();
const fmtOf = (r, action) => (r.intents.find(i => i.action === action) || {}).options && (r.intents.find(i => i.action === action) || {}).options.format;

// ─── 1. Fuente + destino: se elige el DESTINO ───
console.log('--- 1. Conversion con fuente y destino explicitos: gana el destino ---');
check('jpg -> webp produce webp', fmtOf(parser.parse('convierte este jpg a webp'), 'convert') === 'image/webp');
check('png -> jpg produce jpeg (destino)', fmtOf(parser.parse('convierte este png a jpg'), 'convert') === 'image/jpeg');
check('jpg -> png produce png', fmtOf(parser.parse('pasa esta imagen jpg a png'), 'convert') === 'image/png');
check('png -> gif produce gif', fmtOf(parser.parse('convierte este png a gif'), 'convert') === 'image/gif');
check('webp -> jpg produce jpeg', fmtOf(parser.parse('convierte esta webp a jpg'), 'convert') === 'image/jpeg');

// ─── 2. Destino unico (comportamiento heredado, sin fuente) ───
console.log('--- 2. Frases de destino unico se conservan ---');
check('convertir a jpg -> jpeg', fmtOf(parser.parse('convertir a jpg'), 'convert') === 'image/jpeg');
check('Pasa esta imagen a jpg -> jpeg', fmtOf(parser.parse('Pasa esta imagen a jpg'), 'convert') === 'image/jpeg');
check('conviertelas a webp -> webp', fmtOf(parser.parse('Mejora estas imagenes y conviertelas a webp'), 'convert'));
check('convertir a pdf -> application/pdf', fmtOf(parser.parse('convertir a pdf'), 'to-pdf') === 'application/pdf');
check('a formato png (preposicion completa)', fmtOf(parser.parse('convierte la imagen a formato png'), 'convert') === 'image/png');
check('Limpia metadatos y conviertelos a jpg -> jpeg (strip-metadata)', fmtOf(parser.parse('Limpia los metadatos y conviertelos a jpg'), 'strip-metadata') === 'image/jpeg');

// ─── 3. Formato inexistente cae al respaldo + warning ───
console.log('--- 3. Sin formato de destino: warning y PNG por defecto ---');
const rNoFmt = parser.parse('convierte a txt');
check('formato no detectado (undefined)', fmtOf(rNoFmt, 'convert') === undefined);
check('warning de formato', rNoFmt.warnings.some(w => w.includes('formato')));

// ─── 4. Anti-regresion estatica ───
console.log('--- 4. instruction-parser.js prioriza el formato de destino ---');
check('detectDestinationFormat definido', body.includes('function detectDestinationFormat'));
check('convert/compress/to-pdf usan detectDestinationFormat', body.includes('detectDestinationFormat(normalized)'));
check('ambiguity de convert usa destino (no fuente)', body.includes('!detectDestinationFormat(normalized)'));
check('patron inline "pasa esta imagen <formato> a <formato>" reconocido', body.includes('convertInline'));

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests`);
process.exit(fail ? 1 : 0);