#!/usr/bin/env node
// audit-sibling-differentiation.mjs
// Auditoría de diferenciación entre herramientas hermanas (misma categoría).
//
// Problema que vigila: dos herramientas de la misma categoría cuyas instrucciones,
// limitaciones o FAQ son cuasi-intercambiables ("sibling pages" duplicadas en
// sostancia editorial). No mide similitud por shingles: mide a NIVEL DE FRASE
// qué porcentaje de las frases únicas de cada herramienta aparecen también en
// >= 2 OTRAS herramientas de su misma categoría.
//
// Por qué shingle-Jaccard no sirve aquí: las herramientas tienen editorial corto
// (64-361 palabras estrictas) y, con shingles de 6 palabras y tokens >= 3 chars,
// cada texto genera poquísimos shingles; el Jaccard queda siempre ~0 aunque dos
// páginas compartan frases literales. Contar frases compartidas normalizadas
// detecta directamente el contenido reutilizado sin umbrales de "casi-igual".
//
// Salida (estilo del resto de tests):
//   - Estadísticas por categoría (n, máx, media, peor herramienta).
//   - Las 10 herramientas con mayor sharedness (--verbose imprime las 202).
//   - Gate PASS/FAIL: no herramienta > 80% de sharedness.
//   - INFO: familias (pares de la misma categoría cuyas INSTRUCCIONES comparten
//     >= 2 frases), top-10.
//
// Uso: node tests/audit-sibling-differentiation.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText, wordCount } from '../scripts/content-similarity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TOOLS_JSON = join(ROOT, 'src', 'data', 'tools.json');

const SHARED_WITH_OTHERS = 2; // frases compartidas con >= 2 OTRAS herramientas
const MIN_WORDS = 5; // frases de >= 5 palabras normalizadas
const GATE = 80; // % máximo de sharedness por herramienta
const FAMILY_MIN_SHARED_INSTR = 2; // >= 2 frases de instrucciones compartidas

let passed = 0;
let failed = 0;
const results = [];
function check(condition, message) {
  if (condition) {
    passed += 1;
    results.push({ status: 'PASS', message });
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    results.push({ status: 'FAIL', message });
    console.error(`FAIL: ${message}`);
  }
}
function info(message) {
  console.log(`INFO: ${message}`);
}

// Divide una cadena en frases tolerando items sin puntuación final.
function splitSentences(str) {
  return (str.match(/[^.!?]+(?:[.!?]+|$)/g) || []).map((s) => s.trim()).filter(Boolean);
}

// Corpus editorial estricto: instructions + limitations + faq (pregunta + respuesta).
function strictCorpus(tool) {
  const parts = [
    ...(tool.instructions || []),
    ...(tool.limitations || []),
    ...(tool.faq || []).map((f) => `${f.q || ''} ${f.a || ''}`),
  ];
  return parts.join(' ');
}

// Frases únicas normalizadas (>= MIN_WORDS) de una herramienta.
function uniqueSentences(tool) {
  const seen = new Set();
  const out = [];
  for (const raw of splitSentences(strictCorpus(tool))) {
    const norm = normalizeText(raw);
    if (wordCount(norm) < MIN_WORDS) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

// Frases de INSTRUCCIONES únicamente (para detectar "familias" de herramientas
// cuyas instrucciones son casi intercambiables).
function instructionSentences(tool) {
  const seen = new Set();
  const out = [];
  for (const item of tool.instructions || []) {
    for (const raw of splitSentences(item)) {
      const norm = normalizeText(raw);
      if (wordCount(norm) < MIN_WORDS) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

// Safer STEPS:
// 1. Lee tools.json.
// 2. Por categoría: frases únicas por herramienta y conteo de cuántas
//    herramientas DISTINTAS de esa categoría comparten cada frase.
// 3. Por herramienta: % de frases compartidas con >= 2 otras herramientas.
let tools = [];
try {
  tools = JSON.parse(readFileSync(TOOLS_JSON, 'utf8'));
} catch (e) {
  console.error(`FATAL: no se pudo leer ${TOOLS_JSON}: ${e.message}`);
  process.exit(1);
}

console.log('══════════════════════════════════════════════════════════');
console.log('  AUDITORÍA: DIFERENCIACIÓN ENTRE HERRAMIENTAS HERMANAS');
console.log('══════════════════════════════════════════════════════════\n');

check(tools.length >= 200, `tools.json tiene ${tools.length} herramientas (expectativa >= 200)`);

// Agrupar por categoría.
const byCategory = new Map();
for (const t of tools) {
  if (!byCategory.has(t.category)) byCategory.set(t.category, []);
  byCategory.get(t.category).push(t);
}

const perTool = [];
const categoryStats = [];

for (const [cat, catTools] of byCategory) {
  // frase -> Set de slugs de la categoría que la contienen
  const slugSentences = new Map(catTools.map((t) => [t.slug, uniqueSentences(t)]));
  const sharedBySentence = new Map();
  for (const [slug, sents] of slugSentences) {
    for (const s of sents) {
      if (!sharedBySentence.has(s)) sharedBySentence.set(s, new Set());
      sharedBySentence.get(s).add(slug);
    }
  }
  const catRow = [];
  for (const t of catTools) {
    const sents = slugSentences.get(t.slug);
    const shared = sents.filter((s) => {
      const owners = sharedBySentence.get(s);
      return owners.size - (owners.has(t.slug) ? 1 : 0) >= SHARED_WITH_OTHERS;
    }).length;
    const pct = sents.length ? Math.round((10000 * shared) / sents.length) / 100 : 0;
    catRow.push({ slug: t.slug, category: cat, total: sents.length, shared, pct });
    perTool.push({ slug: t.slug, category: cat, total: sents.length, shared, pct });
  }
  catRow.sort((a, b) => b.pct - a.pct || a.slug.localeCompare(b.slug));
  const max = catRow[0];
  const mean = catRow.length ? Math.round((100 * catRow.reduce((a, r) => a + r.pct, 0)) / catRow.length) / 100 : 0;
  categoryStats.push({ category: cat, n: catRow.length, max: max.pct, mean, worst: max.slug });
}

// ── Reporte por categoría ──
console.log('── Compartidas por categoría (frases en >= 2 otras herramientas, mismas categoría) ──\n');
console.log('  categoría            n   max%   media%   peor herramienta');
for (const c of categoryStats) {
  console.log(
    `  ${String(c.category).padEnd(20)} ${String(c.n).padStart(3)}  ${String(c.max).padStart(5)}  ${String(c.mean).padStart(6)}   ${c.worst}`
  );
}
console.log('');

// ── Reporte por herramienta (top 10 peores por defecto) ──
perTool.sort((a, b) => b.pct - a.pct || a.slug.localeCompare(b.slug));
console.log('── Top 10 herramientas con mayor sharedness (de ' + perTool.length + ') ──\n');
console.log('  %compartido  nfrases  compartidas  slug                    categoría');
for (const r of perTool.slice(0, 10)) {
  console.log(
    `  ${String(r.pct).padStart(6)}%  ${String(r.total).padStart(5)}    ${String(r.shared).padStart(8)}    ${String(r.slug).padEnd(22)}  ${r.category}`
  );
}
console.log('');

if (process.argv.includes('--verbose')) {
  console.log('── Sharedness por herramienta (todas las 202) ──\n');
  for (const r of perTool) {
    console.log(`  ${String(r.pct).padStart(6)}%  ${r.slug.padEnd(38)} [${r.category}] (${r.shared}/${r.total})`);
  }
  console.log('');
}

// ── Gate: ninguna herramienta por encima del 80% ──
console.log('── Gate: diferenciación entre hermanas ──');
const worstRow = perTool[0];
const over = perTool.filter((r) => r.pct > GATE);
console.log(`  peor sharedness global: ${worstRow.pct}% (${worstRow.slug}, [${worstRow.category}], ${worstRow.shared}/${worstRow.total})`);
console.log(`  herramientas por encima del umbral ${GATE}%: ${over.length}`);
for (const o of over) console.log(`    ${o.slug} [${o.category}] = ${o.pct}%`);
check(over.length === 0, `ninguna herramienta excede ${GATE}% de sharedness (máximo real ${worstRow.pct}%)`);
info(`umbral de regresión ${GATE}%: peor observado ${worstRow.pct}% en el estado actual`);

// ── INFO: familias de herramientas (instrucciones compartidas) ──
console.log('\n── INFO: familias detectadas (misma categoría, instrucciones comparten >= 2 frases) ──');
const instrSets = new Map(tools.map((t) => [t.slug, new Set(instructionSentences(t))]));
const families = [];
for (let i = 0; i < tools.length; i++) {
  for (let j = i + 1; j < tools.length; j++) {
    const a = tools[i];
    const b = tools[j];
    if (a.category !== b.category) continue;
    let shared = 0;
    const setA = instrSets.get(a.slug);
    const setB = instrSets.get(b.slug);
    for (const s of setA) if (setB.has(s)) shared++;
    if (shared >= FAMILY_MIN_SHARED_INSTR) {
      families.push({ a: a.slug, b: b.slug, category: a.category, shared });
    }
  }
}
families.sort((x, y) => y.shared - x.shared || x.a.localeCompare(y.a));
console.log(`  familias con >= ${FAMILY_MIN_SHARED_INSTR} frases de instrucciones compartidas: ${families.length}`);
for (const f of families.slice(0, 10)) {
  console.log(`    [${f.category}] ${f.a} <-> ${f.b}  (${f.shared} frases)`);
}
if (families.length === 0) info('sin familias detectadas: las instrucciones son diferenciables entre hermanas');

// ── Resumen ──
console.log('\n══════════════════════════════════════════════════════════');
console.log(`RESULTADO: ${passed} PASS, ${failed} FAIL`);
console.log('══════════════════════════════════════════════════════════');
process.exit(failed ? 1 : 0);