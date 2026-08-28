#!/usr/bin/env node
// content-similarity-regression.mjs
// Prueba controlada del detector de similitud de contenido (FASE 19C).
// Valida el ALGORITMO con fixtures sintéticos (no depende del corpus real), para
// demostrar que el normalizador no borra accidentalmente TODO el contenido y que
// distingue duplicados reales de chrome/privacidad compartidos legítimos.
import { contentSimilarity, normalizeText, stripTags, shingleTokens, jaccard, wordCount } from '../scripts/content-similarity.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed += 1; console.log(`PASS: ${message}`); }
  else { failed += 1; console.error(`FAIL: ${message}`); }
}
function within(actual, expected, tol) { return Math.abs(actual - expected) <= tol; }

// ---------- Fixtures sintéticos ----------
const wrap = (title, body) => `<!doctype html><html><head><title>${title}</title></head>
<body>
<header>APLUNO · Herramientas online gratuitas · Herramientas · Guías · Acerca de · Legal · Privacidad · Condiciones</header>
${body}
<footer>© 2026 APLUNO · Toolisto es un producto de APLUNO · Todos los derechos reservados. Todos los archivos se procesan en tu navegador.</footer>
</body></html>`;

const chrome = '<header>APLUNO · Herramientas online gratuitas · Herramientas · Guías · Acerca de · Legal · Privacidad · Condiciones</header><footer>© 2026 APLUNO · Toolisto es un producto de APLUNO · Todos los derechos reservados. Todos los archivos se procesan en tu navegador.</footer>';

// CASO A — páginas exactamente iguales
const bodyA = '<main><h1>Convertir JPG a PNG</h1><p>Convierte imágenes JPG al formato PNG conservando la transparencia de forma local, sin subir archivos a ningún servidor.</p><ol><li>Elige el archivo JPG.</li><li>Haz clic en convertir.</li><li>Descarga el PNG.</li></ol></main>';
const pageA1 = wrap('Convertir JPG a PNG', bodyA);
const pageA2 = wrap('Convertir JPG a PNG', bodyA);

// CASO B — únicamente cambia el nombre de herramienta; 90% del cuerpo idéntico
function caseB(toolNameA, toolNameB, formatsA, formatsB) {
  const head = `<main><h1>Convertir ${toolNameA} a ${toolNameB}</h1>`;
  const shared = `<p>Esta herramienta convierte tus imágenes de un formato a otro de forma rápida y privada. El procesado ocurre por completo en tu navegador y los archivos nunca se suben a un servidor. Es ideal cuando necesitas un formato específico para la web, el correo o una aplicación concreta.</p>
<p>El convertidor funciona con cualquier archivo compatible y mantiene la mejor calidad posible durante la conversión. No necesitas instalar ningún programa ni crear una cuenta para usar el servicio.</p>
<p>El resultado se entrega listo para descargar y puedes repetir el proceso con más archivos todas las veces que necesites. Esta herramienta está pensada como una alternativa gratuita a los servicios que requieren registro.</p>
<ol><li>Selecciona el archivo de origen.</li><li>Haz clic en el botón de conversión.</li><li>Descarga el archivo resultante.</li></ol>`;
  const formats = `<ul><li>Formato de entrada soportado: ${formatsA}.</li><li>Formato de salida: ${formatsB}.</li><li>Tamaño máximo de archivo: 25 MB.</li></ul>`;
  const tail = `<section><h2>Preguntas frecuentes</h2><p>¿Es gratis? Sí, la herramienta es 100% gratuita.</p><p>¿Se suben mis archivos? No, todo se procesa en tu dispositivo.</p><p>¿Cuánto tarda? Normalmente unos segundos.</p></section></main>`;
  return { html: wrap(`Convertir ${toolNameA} a ${toolNameB}`, head + shared + formats + tail), shared };
}
const caseBPng = caseB('JPG', 'PNG', 'JPG y JPEG', 'PNG');
const caseBJpg = caseB('PNG', 'JPG', 'PNG', 'JPG y JPEG');

// CASO C — mismo chrome (nav/footer) pero contenido editorial completamente distinto
const bodyC1 = '<main><h1>Comprimir PDF</h1><p>Reduce el peso de un documento PDF comprimiendo las imágenes y optimizando su estructura.</p><ol><li>Elige el PDF.</li><li>Ajusta la calidad.</li><li>Descarga.</li></ol></main>';
const bodyC2 = '<main><h1>Unir imágenes</h1><p>Combina varias fotos en una sola imagen horizontal o vertical.</p><ol><li>Añade las fotos.</li><li>Elige la dirección.</li><li>Descarga.</li></ol></main>';
const pageC1 = wrap('Comprimir PDF', bodyC1);
const pageC2 = wrap('Unir imágenes', bodyC2);

// CASO D — mismo bloque de privacidad legítimo, cuerpos distintos
const priv = '<p>Aviso de privacidad: todos los archivos se procesan en tu navegador y no se suben a ningún servidor. Ningún dato personal sale de tu dispositivo.</p>';
const bodyD1 = priv + '<main><h1>QR de contacto</h1><p>Genera un código QR con tus datos de contacto.</p></main>';
const bodyD2 = priv + '<main><h1>Extraer audio</h1><p>Extrae el audio de un archivo de vídeo.</p></main>';
const pageD1 = wrap('QR de contacto', bodyD1);
const pageD2 = wrap('Extraer audio', bodyD2);

// CASO E — FAQ clonada entre dos tools, intros distintas
const faqCloned = `<section><h2>Preguntas frecuentes</h2><p>¿Mis archivos se suben a un servidor? No, todo se procesa en tu navegador.</p><p>¿Es gratuito? Sí, la herramienta es gratuita.</p><p>¿Qué formatos soporta? Todos los formatos habituales del catálogo.</p></section>`;
const bodyE1 = '<main><h1>Dividir PDF</h1><p>Divide un documento PDF en varias partes independientes.</p><ol><li>Elige el PDF.</li><li>Marca los puntos de corte.</li><li>Descarga las partes.</li></ol>' + faqCloned + '</main>';
const bodyE2 = '<main><h1>Comprimir imagen</h1><p>Reduce el peso de una imagen sin perder calidad visible.</p><ol><li>Elige la imagen.</li><li>Ajusta el objetivo.</li><li>Descarga.</li></ol>' + faqCloned + '</main>';
const pageE1 = wrap('Dividir PDF', bodyE1);
const pageE2 = wrap('Comprimir imagen', bodyE2);

// ---------- Ejecutar casos ----------
console.log('=== CASO A: páginas exactamente iguales ===');
const simA = contentSimilarity(stripTags(pageA1), stripTags(pageA2));
console.log(`  similarity = ${simA.toFixed(3)}`);
check(simA >= 0.95, `A: identical pages -> sim ${simA.toFixed(3)} >= 0.95 (duplicate detected)`);

console.log('\n=== CASO B: solo cambia el nombre de herramienta (90% del cuerpo idéntico) ===');
const simB = contentSimilarity(stripTags(caseBPng.html), stripTags(caseBJpg.html));
console.log(`  similarity = ${simB.toFixed(3)}`);
// 90% del cuerpo idéntico => similitud claramente de near-duplicate. El umbral real
// de near-duplicate de la auditoría es 0.70; esta fixture debe quedar por encima.
check(simB >= 0.7, `B: name-swap near-dup -> sim ${simB.toFixed(3)} >= 0.70 (near-duplicate detected)`);

console.log('\n=== CASO C: mismo chrome, contenido editorial distinto ===');
const simC = contentSimilarity(stripTags(pageC1), stripTags(pageC2));
console.log(`  similarity = ${simC.toFixed(3)}`);
check(simC <= 0.4, `C: same chrome, different body -> sim ${simC.toFixed(3)} <= 0.4 (NOT duplicate)`);

console.log('\n=== CASO D: bloque de privacidad compartido, cuerpos distintos ===');
const simD = contentSimilarity(stripTags(pageD1), stripTags(pageD2));
console.log(`  similarity = ${simD.toFixed(3)}`);
// El bloque de privacidad compartido infla la similitud en páginas cortas, pero no
// debe tratarse como near-duplicate. Este rango (<0.7) indica contenido distinto.
check(simD < 0.7, `D: shared privacy, different body -> sim ${simD.toFixed(3)} < 0.70 (NOT near-duplicate)`);

console.log('\n=== CASO E: FAQ clonada entre dos tools ===');
const simE = contentSimilarity(stripTags(pageE1), stripTags(pageE2));
console.log(`  similarity = ${simE.toFixed(3)}`);
// La FAQ compartida debe elevar la similitud por encima de lo que tendrían dos tools
// sin nada compartido (C). Queremos detectarla como señal de contenido reutilizado.
check(simE >= 0.3, `E: cloned FAQ -> sim ${simE.toFixed(3)} >= 0.3 but < 0.8 (reused editorial detected, not false duplicate)`);
check(simE < 0.8, `E: cloned FAQ alone must NOT be full near-duplicate (sim ${simE.toFixed(3)} < 0.8)`);

console.log('\n=== El normalizador no borra todo el contenido significativo ===');
const toksC1 = shingleTokens(stripTags(pageC1), 6);
const toksC2 = shingleTokens(stripTags(pageC2), 6);
console.log(`  shingles C1=${toksC1.size}, C2=${toksC2.size}`);
check(toksC1.size > 3 && toksC2.size > 3, 'C: cada página conserva shingles significativos (no se vacía el contenido)');
check(wordCount(normalizeText(stripTags(pageC1))) >= 15, 'A/C: el texto normalizado conserva palabras (>=15)');

console.log(`\nContent-similarity regression: ${passed} pass, ${failed} fail.`);
if (failed) process.exit(1);
