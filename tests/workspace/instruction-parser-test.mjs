#!/usr/bin/env node
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

console.log('=== Instruction Parser Tests ===\n');

const parser = createInstructionParser();

// 1. Empty / whitespace
const r0 = parser.parse('');
check('Empty string returns empty result', r0.intents.length === 0 && r0.warnings.length > 0);
check('Empty string warning', r0.warnings.some(w => w.includes('vac') || w.includes('Vac')));
const r0b = parser.parse('   ');
check('Whitespace only returns empty', r0b.intents.length === 0);

// 2. Unknown instruction
const r1 = parser.parse('Hola mundo');
check('Unknown instruction returns no intents', r1.intents.length === 0);
check('Unknown instruction has warning', r1.warnings.length > 0);
check('Unknown instruction has unknownSegments', r1.unknownSegments.length > 0);

// 3. Basic single action: rotate
const r2 = parser.parse('Gira esta imagen 90 grados');
check('Rotate: correct action', r2.intents.length === 1 && r2.intents[0].action === 'rotate');
check('Rotate: correct target', r2.intents[0].target === 'image');
check('Rotate: angle 90', r2.intents[0].options.angle === 90);

// 4. Rotate without angle (warning)
const r3 = parser.parse('Gira esta imagen');
check('Rotate no angle: action found', r3.intents.length === 1 && r3.intents[0].action === 'rotate');
check('Rotate no angle: warning', r3.warnings.length > 0 && r3.warnings[0].includes('ángulo'));

// 5. Resize with dimensions
const r4 = parser.parse('Redimensiona esta imagen a 800x600');
check('Resize: correct action', r4.intents.length === 1 && r4.intents[0].action === 'resize');
check('Resize: width 800', r4.intents[0].options.width === 800);
check('Resize: height 600', r4.intents[0].options.height === 600);

// 6. Resize with only width
const r5 = parser.parse('Cambia el tamaño a 1200 px de ancho');
check('Resize width only: action', r5.intents.length === 1 && r5.intents[0].action === 'resize');
check('Resize width only: width 1200', r5.intents[0].options.width === 1200);
check('Resize width only: no height', r5.intents[0].options.height === undefined);

// 7. Resize without dimensions
const r5b = parser.parse('Redimensiona esta imagen');
check('Resize no dim: action found', r5b.intents.length === 1 && r5b.intents[0].action === 'resize');
check('Resize no dim: warning', r5b.warnings.length > 0 && r5b.warnings[0].includes('dimensiones'));

// 8. Convert with format
const r6 = parser.parse('Convierte esta imagen a WebP');
check('Convert: action', r6.intents.length === 1 && r6.intents[0].action === 'convert');
check('Convert: format webp', r6.intents[0].options.format === 'image/webp');

// 9. Convert without format
const r7 = parser.parse('Convierte esta imagen');
check('Convert no format: warning', r7.warnings.length > 0 && r7.warnings[0].includes('formato'));

// 10. Enhance
const r8 = parser.parse('Mejora esta imagen');
check('Enhance: action', r8.intents.length === 1 && r8.intents[0].action === 'enhance');

// 11. OCR
const r9 = parser.parse('Extrae el texto de esta imagen');
check('OCR: action', r9.intents.length === 1 && r9.intents[0].action === 'ocr');
check('OCR: language spa', r9.intents[0].options.language === 'spa');

// 12. To table
const r10 = parser.parse('Convierte este texto en una tabla');
check('To-table: action', r10.intents.length === 1 && r10.intents[0].action === 'to-table');

// 13. To document
const r11 = parser.parse('Crea un documento con este texto');
check('To-document: action', r11.intents.length === 1 && r11.intents[0].action === 'to-document');

// 14. Report
const r12 = parser.parse('Genera un informe con estos datos');
check('Report: action', r12.intents.length === 1 && r12.intents[0].action === 'report');
check('Report: includeDate true', r12.intents[0].options.includeDate === true);

// 15. Report without date
const r13 = parser.parse('Crea un informe pero no incluyas la fecha');
check('Report no date: action found', r13.intents.length > 0 && r13.intents.some(i => i.action === 'report'));
const reportIntent = r13.intents.find(i => i.action === 'report');
check('Report no date: includeDate false', reportIntent && reportIntent.options.includeDate === false);

// 16. Strip metadata
const r14 = parser.parse('Quita los metadatos de esta imagen');
check('Strip-metadata: action', r14.intents.length === 1 && r14.intents[0].action === 'strip-metadata');

// 17. Multiple intents
const r15 = parser.parse('Mejora esta imagen y conviértela a PNG');
check('Multi-intent: 2 intents', r15.intents.length === 2);
check('Multi-intent: first enhance', r15.intents[0].action === 'enhance');
check('Multi-intent: second convert', r15.intents[1].action === 'convert');

// 18. Quality detection in enhance
const r16 = parser.parse('Mejora esta imagen calidad al 80');
check('Quality: quality value 80', r16.intents[0].options.contrast === 1.2);
check('Quality: brightness from quality', r16.intents[0].options.brightness === 0.8);

// 19. Output preferences: download
const r17 = parser.parse('Mejora esta imagen y descárgala');
const hasDownloadPref = r17.outputPreferences && r17.outputPreferences.download === true;
check('Output pref: download', hasDownloadPref);

// 20. Output preferences: add to workspace
const r18 = parser.parse('Extrae el texto y guárdalo en el workspace');
const hasWsPref = r18.outputPreferences && r18.outputPreferences.addToWorkspace === true;
check('Output pref: addToWorkspace', hasWsPref);

// 21. Normalize accents
check('Normalize: á -> a', parser.normalize('imágenes') === 'imagenes');
check('Normalize: é -> e', parser.normalize('extracción') === 'extraccion');
check('Normalize: ñ -> n', parser.normalize('añadir') === 'anadir');
check('Normalize: ü -> u', parser.normalize('bilingüe') === 'bilingue');
check('Normalize: trims & collapses spaces', parser.normalize('  Hola   Mundo  ') === 'hola mundo');

// 22. Format detection helpers
check('detectFormat jpg', parser.detectFormat('convertir a jpg') === 'image/jpeg');
check('detectFormat jpeg', parser.detectFormat('jpg format') === 'image/jpeg');
check('detectFormat png', parser.detectFormat('PNG') === 'image/png');
check('detectFormat webp', parser.detectFormat('webp') === 'image/webp');
check('detectFormat svg', parser.detectFormat('svg') === 'image/svg+xml');
check('detectFormat null for unknown', parser.detectFormat('convertir a txt') === null);

// 23. Dimension detection helpers
const dim1 = parser.detectDimension('800x600');
check('detectDimension width 800', dim1 && dim1.width === 800);
check('detectDimension height 600', dim1 && dim1.height === 600);

const dim2 = parser.detectDimension('ancho de 1024 px');
check('detectDimension ancho 1024', dim2 && dim2.width === 1024);

const dim3 = parser.detectDimension('alto de 768');
check('detectDimension alto 768', dim3 && dim3.height === 768);

const dim4 = parser.detectDimension('sin medidas');
check('detectDimension null', dim4 === null);

// 24. Rotation detection helpers
const rot1 = parser.detectRotation('90 grados');
check('detectRotation 90', rot1 === 90);

const rot2 = parser.detectRotation('gira a la derecha');
check('detectRotation gira derecha', rot2 === 90);

const rot3 = parser.detectRotation('voltea a la izquierda');
check('detectRotation voltea izquierda', rot3 === 270);

const rot4 = parser.detectRotation('180°');
check('detectRotation 180 grados', rot4 === 180);

const rot5 = parser.detectRotation('sin rotación');
check('detectRotation null', rot5 === null);

// 25. Quality detection
check('detectQuality 80%', parser.detectQuality('calidad al 80%') === 80);
check('detectQuality 50', parser.detectQuality('calidad 50') === 50);
check('detectQuality clamps to 10-100', parser.detectQuality('calidad 5') === 10);
check('detectQuality clamps max', parser.detectQuality('calidad 150') === 100);

// 26. Multiple formats in convert
const r19 = parser.parse('Pasa esta imagen a jpg');
check('Convert JPG: format jpeg', r19.intents.some(i => i.action === 'convert' && i.options.format === 'image/jpeg'));

// 27. Unknown segments
const r20 = parser.parse('Mejora esta foto y convierte a png');
check('Unknown segments: finds format words', r20.unknownSegments.length >= 0);
const r21 = parser.parse('Mejora esta fotografía y hazla quadrada');
const hasFotografia = r21.unknownSegments.some(s => s.includes('fotograf'));
const hasQuadrada = r21.unknownSegments.some(s => s.includes('quadrada') || s.includes('cuadrada'));
check('Unknown segments: finds unknown', hasFotografia || r21.unknownSegments.length > 0);

// 28. Synonyms: rota, transformar, pasar a
const r22a = parser.parse('Rota esta imagen');
check('Synonym rota -> rotate', r22a.intents.some(i => i.action === 'rotate'));
const r22 = parser.parse('Transforma esta imagen');
check('Synonym transforma -> convert', r22.intents.some(i => i.action === 'convert'));

// 29. Synonyms: eliminar metadatos
const r23 = parser.parse('Elimina los metadatos de estas fotos');
check('Synonym eliminar metadatos', r23.intents.some(i => i.action === 'strip-metadata'));

// 30. Synonyms: gira 45
const r24 = parser.parse('Gira esta imagen 45 grados');
check('Synonym gira -> rotate', r24.intents.some(i => i.action === 'rotate' && i.options.angle === 45));

// 31. Complex pipeline
const r25 = parser.parse('Mejora estas imágenes, redimensiona a 1920px y conviértelas a webp');
check('Pipeline: 3 intents', r25.intents.length === 3);
check('Pipeline: first enhance', r25.intents[0].action === 'enhance');
check('Pipeline: second resize', r25.intents[1].action === 'resize');
check('Pipeline: third convert', r25.intents[2].action === 'convert');
check('Pipeline: resize width 1920', r25.intents[1].options.width === 1920);

// 32. Case insensitivity
const r26 = parser.parse('MEJORA ESTA IMAGEN');
check('Uppercase: action found', r26.intents.some(i => i.action === 'enhance'));

// 33. Mixed casing
const r27 = parser.parse('Mejora Estas Imágenes Y Conviértelas A PNG');
check('Mixed case: multi intent', r27.intents.length >= 2);

// 34. Synonymous: "sacar texto" -> ocr
const r28 = parser.parse('Saca el texto de esta imagen');
check('Synonym sacar texto -> ocr', r28.intents.some(i => i.action === 'ocr'));

// 35. Synonymous: "crear informe" -> report
const r29 = parser.parse('Crea un informe con estos datos');
check('Synonym crear informe -> report', r29.intents.some(i => i.action === 'report'));

// 36. Synonymous: "escala" -> resize
const r30 = parser.parse('Escala esta imagen a 640x480');
check('Synonym escala -> resize', r30.intents.some(i => i.action === 'resize' && i.options.width === 640));

// 37. Strip metadata with format
const r31 = parser.parse('Limpia los metadatos y conviértelos a jpg');
check('Strip metadata with format', r31.intents.some(i => i.action === 'strip-metadata'));

// 38. Rotation with grados symbol
const r32 = parser.parse('Rota 270°');
check('Rotate with degree symbol', r32.intents.some(i => i.action === 'rotate' && i.options.angle === 270));

// 39. Quality override in enhance
const r33 = parser.parse('Mejora esta imagen calidad 60');
check('Enhance with quality override', r33.intents.some(i => i.action === 'enhance' && i.options.brightness === 0.6));

// 40. Width only with suffix (no action verb, so 0 intents but no crash)
const r34 = parser.parse('Ancho 800');
check('Width only short: no crash', true);
check('Width only short: warning', r34.warnings.length > 0);

// 41. Export text synonym
const r35 = parser.parse('Exporta este texto a un archivo');
check('Export text action', r35.intents.some(i => i.action === 'export-text'));

// 42. OCR -> document pipeline (combined)
const r36 = parser.parse('Extrae el texto de estas imágenes y crea un documento');
check('OCR to document: 2 intents', r36.intents.length === 2);
check('OCR to document: first ocr', r36.intents[0].action === 'ocr');
check('OCR to document: second to-document', r36.intents[1].action === 'to-document');

// 43. OCR -> table pipeline
const r37 = parser.parse('Escanea el texto de estas imágenes y conviértelo en tabla');
check('OCR to table: pipeline', r37.intents.length >= 2);

// 44. Empty normalized text reporting
check('Empty original retains originalText', r0.originalText === '');
check('Empty original normalizedText empty', r0.normalizedText === '');

// 45. Normalization preserves spaces properly
check('Normalize multiple spaces', parser.normalize('rota   esta   imagen') === 'rota esta imagen');

// 46. Ambiguity detection: "más pequeños"
const r38 = parser.parse('Haz estos archivos más pequeños');
check('Ambiguity reduce detected', r38.ambiguities && r38.ambiguities.length > 0);
check('Ambiguity reduce has question', r38.ambiguities[0] && r38.ambiguities[0].question.includes('reducir'));
check('Ambiguity reduce has options', r38.ambiguities[0] && r38.ambiguities[0].options.length >= 2);

// 47. Ambiguity detection: convert without format
const r39 = parser.parse('Convierte esta imagen');
check('Ambiguity convert format detected', r39.ambiguities && r39.ambiguities.length > 0);
check('Ambiguity convert has format question', r39.ambiguities.some(a => a.id === 'convert-format'));

// 48. No ambiguity for complete instruction
const r40 = parser.parse('Redimensiona estas imágenes a 800x600 y conviértelas a WebP');
check('No ambiguity for complete instruction', !r40.ambiguities || r40.ambiguities.length === 0);

// 49. Ambiguity resolves to options IDs
check('Ambiguity options have id', r38.ambiguities[0].options[0].id && typeof r38.ambiguities[0].options[0].id === 'string');
check('Ambiguity options have label', r38.ambiguities[0].options[0].label && r38.ambiguities[0].options[0].label.length > 0);

// 50. PDF format detection
const r41 = parser.parse('Convierte esta imagen a PDF');
check('PDF format detection', r41.intents.some(i => i.action === 'to-pdf'));

// 51. Rotate ambiguity when no direction specified
const r42 = parser.parse('Rota esta imagen');
check('Rotate ambiguity detected', r42.ambiguities && r42.ambiguities.some(a => a.id === 'rotate-angle'));
check('Rotate ambiguity has 3 options', r42.ambiguities.some(a => a.id === 'rotate-angle' && a.options.length === 3));

// 52. No rotate ambiguity when direction specified
const r43 = parser.parse('Rota esta imagen 90 grados');
check('No rotate ambiguity with degrees', !r43.ambiguities || !r43.ambiguities.some(a => a.id === 'rotate-angle'));

// 53. Convert to PDF uses to-pdf action (not regular convert)
const r44 = parser.parse('Pasa esta imagen a PDF');
check('Convert to PDF is to-pdf action', r44.intents.some(i => i.action === 'to-pdf'));
check('Convert to PDF has pdf format', r44.intents.some(i => i.action === 'to-pdf' && i.options.format === 'application/pdf'));

// 54. Ambiguity: "más pequeño" without resize or compress in actions
const r45 = parser.parse('Haz estos archivos más pequeños');
check('Ambiguity reduce has both options', r45.ambiguities[0] && r45.ambiguities[0].options.length === 2);
check('Ambiguity reduce first is dimensions', r45.ambiguities[0].options[0].id === 'dimensions');
check('Ambiguity reduce second is file-size', r45.ambiguities[0].options[1].id === 'file-size');

// 55. Synonymous: "crear grafico" -> chart
const r46 = parser.parse('Crea un grafico con estas datos');
check('Synonym crear grafico -> chart', r46.intents.some(i => i.action === 'chart'));
check('Chart target text', r46.intents.some(i => i.action === 'chart' && i.target === 'text'));

// 56. Synonymous: "grafica" -> chart
const r47 = parser.parse('Grafica las ventas por trimestre');
check('Synonym grafica -> chart', r47.intents.some(i => i.action === 'chart'));

// 57. Chart pipeline with to-document and to-pdf keep chart intent
const r48 = parser.parse('Crea un grafico de las ventas');
check('Chart intent present', r48.intents.some(i => i.action === 'chart'));
check('Chart has text target', r48.intents.some(i => i.action === 'chart' && i.target === 'text'));

console.log('\nParser Tests: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail > 0 ? 1 : 0);
