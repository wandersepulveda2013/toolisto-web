#!/usr/bin/env node
// content-similarity-scoped-regression.mjs
// Guarda de regresión de la capa de contenido/originalidad (AdSense, nivel 2).
// Re-usa el MISMO cómputo que `scripts/audit-content-similarity.mjs` sobre
// `src/data/tools.json` y certifica los detectores de riesgo:
//   A) No hay near-duplicates / "name-substitution" (editorial estricto): ningún
//      par de herramientas supera similitud 0.45.
//   B) Ninguna herramienta es plantilla casi total (>=80% de sus oraciones
//      editoriales compartidas con otras).
//   C) No hay defectos CJK / emoji / control en el editorial español.
//   D) Las herramientas cortas (<70 palabras estrictas) cumplen intent estructural
//      (>=2 FAQ, >=1 limitación, summary). NO se exige padding de palabras.
//   E) Categorías: >=12 habilitadas, todas cubiertas.
// La prueba NO es una meta de recuento: no pide reescribir ni engordar contenido.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText, wordCount, jaccard } from '../scripts/content-similarity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const tools = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf8')).filter((t) => t.enabled);
const categories = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'categories.json'), 'utf8'));

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed += 1; console.log(`PASS: ${message}`); }
  else { failed += 1; console.error(`FAIL: ${message}`); }
}

function toSentences(arr) {
  const out = [];
  for (const it of arr || []) {
    if (typeof it === 'string') out.push(it);
    else if (it && typeof it === 'object') {
      if (it.q) out.push(it.q);
      if (it.a) out.push(it.a);
    }
  }
  return out;
}
const rec = tools.map((t) => ({
  slug: t.slug,
  summary: (t.summary || '').trim(),
  nLim: (t.limitations || []).length,
  nFaq: (t.faq || []).length,
  text: [...toSentences(t.instructions), ...toSentences(t.limitations), ...toSentences(t.faq)].join(' '),
  sentences: [...toSentences(t.instructions), ...toSentences(t.limitations), ...toSentences(t.faq)]
    .map((s) => normalizeText(s)).filter((s) => wordCount(s) >= 5),
}));

function shingleSet(text, n) {
  const toks = normalizeText(text).split(' ').filter((t) => t.length >= 3);
  if (toks.length < n) return new Set([toks.join(' ')]);
  const s = new Set();
  for (let i = 0; i <= toks.length - n; i++) s.add(toks.slice(i, i + n).join(' '));
  return s;
}

console.log(`\n=== Content similarity / originality regression (${rec.length} tools) ===`);

// A) near-duplicates
const sets = rec.map((r) => ({ ...r, set: shingleSet(r.text, 6) }));
let maxSim = 0;
const near = [];
for (let i = 0; i < sets.length; i++) {
  for (let j = i + 1; j < sets.length; j++) {
    const sim = jaccard(sets[i].set, sets[j].set);
    if (sim > maxSim) maxSim = sim;
    if (sim >= 0.45) near.push({ a: sets[i].slug, b: sets[j].slug, sim });
  }
}
check(near.length === 0, `A) sin near-duplicates / name-substitution (max sim ${maxSim.toFixed(3)} < 0.45)`);
if (near.length) near.slice(0, 10).forEach((x) => console.error(`   /${x.a} <-> /${x.b}: ${x.sim.toFixed(3)}`));

// B) sharedness per tool
const sentCount = new Map();
for (const r of rec) for (const s of new Set(r.sentences)) sentCount.set(s, (sentCount.get(s) || 0) + 1);
const sharedSet = new Set([...sentCount.entries()].filter(([, n]) => n >= 2).map(([s]) => s));
let worstPct = 0; let worstSlug = ''; let overHard = [];
for (const r of rec) {
  const uniq = new Set(r.sentences);
  const pct = uniq.size ? [...uniq].filter((s) => sharedSet.has(s)).length / uniq.size : 0;
  if (pct > worstPct) { worstPct = pct; worstSlug = r.slug; }
  if (pct >= 0.80) overHard.push(r.slug);
}
check(overHard.length === 0, `B) ninguna herramienta es plantilla casi total (peor sharedness ${(worstPct * 100).toFixed(0)}% /${worstSlug} < 80%)`);

// C) char defects
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/u;
let charDefects = [];
for (const r of rec) {
  const text = [r.slug, r.summary, ...toSentences(tools.find((t) => t.slug === r.slug).instructions), ...toSentences(tools.find((t) => t.slug === r.slug).limitations), ...toSentences(tools.find((t) => t.slug === r.slug).faq)].join(' ');
  if (CJK.test(text)) charDefects.push(`${r.slug}:CJK`);
  if (EMOJI.test(text)) charDefects.push(`${r.slug}:emoji`);
  if (CTRL.test(text)) charDefects.push(`${r.slug}:control`);
}
check(charDefects.length === 0, `C) sin defectos CJK/emoji/control en el editorial (${charDefects.length} defectos)`);
if (charDefects.length) charDefects.slice(0, 15).forEach((d) => console.error('   ', d));

// D) short tools intent
const short = rec.filter((r) => wordCount(normalizeText(r.text)) < 70);
const missingIntent = short.filter((r) => r.nFaq < 2 || r.nLim < 1 || !r.summary);
check(missingIntent.length === 0, `D) ${short.length} herramientas <70 estrictas cumplen intent (>=2 FAQ, >=1 limitación, summary); sin padding`);
if (missingIntent.length) missingIntent.forEach((r) => console.error(`   /${r.slug} I/L/F: ${r.slug}`));

// E) categories
const enabledCats = categories.filter((c) => c.enabled);
const catIds = new Set(enabledCats.map((c) => c.id));
const assigned = new Set(rec.map((r) => tools.find((t) => t.slug === r.slug).category));
const missingCats = [...assigned].filter((c) => !catIds.has(c));
const coverage = enabledCats.map((c) => rec.filter((r) => tools.find((t) => t.slug === r.slug).category === c.id).length);
const uncovered = enabledCats.filter((_, i) => coverage[i] === 0);
check(enabledCats.length >= 12 && missingCats.length === 0 && uncovered.length === 0,
  `E) ${enabledCats.length} categorías habilitadas, todas cubiertas, sin categoría desconocida`);

console.log(`\nContent similarity / originality regression: ${passed} pass, ${failed} fail.`);
if (failed) process.exit(1);
