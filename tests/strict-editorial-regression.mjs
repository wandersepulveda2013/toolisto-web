#!/usr/bin/env node
// strict-editorial-regression.mjs
// Guarda de regresión de la métrica editorial ESTRICTA (anti-chrome) usada por
// `audit-content-quality.mjs` para evaluar thin-content en AdSense.
//
// Verifica sobre el `dist/` REAL que:
//   A) El chrome repetido de UI (capability strip "01 Prepara / 02 Ajusta /
//      03 Entrega", etiquetas de formato, nota de privacidad, related-tools)
//      NO entra en el recuento editorial estricto.
//   B) Ninguna herramienta indexable cae por debajo del suelo editorial
//      estricto (60 palabras), el mismo suelo del perfil TOOL_LT del auditor.
//   C) El detector encuentra el conjunto completo de herramientas (>= 202),
//      para que no se "arregle" la métrica dejando de detectar páginas.
//
// Usa scripts/strict-editorial.mjs, la MISMA implementación que el auditor,
// para evitar que ambos se desvíen.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractStrictEditorial } from '../scripts/strict-editorial.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed += 1; console.log(`PASS: ${message}`); }
  else { failed += 1; console.error(`FAIL: ${message}`); }
}

// Detecta páginas de herramienta por las mismas secciones estructurales que el
// auditor (instructions + faq-section). Las guías/categorías no las usan.
function isToolPage(html) {
  return /<section class="instructions"/i.test(html) && /<section class="faq-section"/i.test(html);
}

const dirs = readdirSync(DIST, { withFileTypes: true });

const tools = [];
for (const d of dirs) {
  if (d.isDirectory()) continue;
  if (!d.name.endsWith('.html')) continue;
  const path = join(DIST, d.name);
  let html;
  try { html = readFileSync(path, 'utf8'); } catch { continue; }
  if (isToolPage(html)) tools.push({ slug: d.name.replace(/\.html$/, ''), html });
}

console.log(`\n=== Detección de herramientas (dist real) ===`);
console.log(`  herramientas detectadas: ${tools.length}`);
check(tools.length >= 202, `se detectan >= 202 herramientas (obtenidas ${tools.length})`);

// GUARD A: el chrome de UI no debe colarse en el recuento estricto.
console.log(`\n=== A) El chrome NO infla la métrica editorial estricta ===`);
// La capability strip es la SECUENCIA "01 Prepara / 02 Ajusta / 03 Entrega" que
// se repite idéntica en todas las herramientas. Se detecta por la presencia de
// los tres rótulos numerados juntos (01..03), NO por una sola palabra suelta
// ("Ajusta" es un verbo normal del español que aparece en instrucciones reales).
const CAP_STRIP = /0?1\s*Prepara[\s\S]{0,60}?0?2\s*Ajusta[\s\S]{0,60}?0?3\s*Entrega/i;
let chromeLeakCount = 0;
for (const t of tools) {
  const strict = extractStrictEditorial(t.html);
  const body = `${strict.instructions} ${strict.limitations} ${strict.faq}`;
  if (CAP_STRIP.test(body)) {
    chromeLeakCount += 1;
    console.error(`  capability strip filtrada en ${t.slug}`);
  }
  // El contenido estricto debe ser MDESTAMENTE menor que el texto visible total
  // del main (que sí incluye strip + formatos + related), porque el chrome se
  // repite en todas las páginas. Exigimos que el estricto no sea >= 85% del total.
  const mainWords = (t.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').match(/[A-Za-zÀ-ÿ0-9]{2,}/g) || []).length;
  if (strict.words > 0 && mainWords > 0 && strict.words / mainWords >= 0.85) {
    chromeLeakCount += 1;
    console.error(`  estricto casi igual al total en ${t.slug} (${strict.words}/${mainWords})`);
  }
}
check(chromeLeakCount === 0, `ninguna herramienta filtra el capability strip / chrome en su editorial estricto (0 fugas)`);

// GUARD B: suelo editorial estricto (mismo floor del perfil TOOL_LT = 60).
console.log(`\n=== B) Suelo editorial estricto (>= 60 palabras) ===`);
const FLOOR = 60;
const below = tools
  .map((t) => ({ slug: t.slug, words: extractStrictEditorial(t.html).words }))
  .filter((r) => r.words < FLOOR)
  .sort((a, b) => a.words - b.words);
for (const r of below) console.error(`  ${r.slug}: ${r.words} palabras estrictas`);
check(below.length === 0, `ninguna herramienta está por debajo del suelo editorial estricto de ${FLOOR} palabras`);

const words = tools.map((t) => extractStrictEditorial(t.html).words).sort((a, b) => a - b);
const quantile = (p) => words[Math.min(words.length - 1, Math.floor((p / 100) * (words.length - 1)))];
console.log(`\n  n=${words.length} min=${words[0]} p25=${quantile(25)} p50=${quantile(50)} p75=${quantile(75)} max=${words[words.length - 1]}`);

console.log(`\nStrict-editorial regression: ${passed} pass, ${failed} fail.`);
if (failed) process.exit(1);
