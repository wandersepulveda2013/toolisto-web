#!/usr/bin/env node
// audit-content-similarity.mjs
// Capa de contenido/similitud (AdSense, nível 2): mide sobre `src/data/tools.json` los
// detectores de riesgo de contenido original/originalidad:
//   A) Near-duplicates / "name-substitution": similitud Jaccard por pares del editorial
//      ESTRICTO (instructions + limitations + faq). Umbral alto = riesgo de plantilla
//      con solo el nombre cambiado (patrón doorway/spinned).
//   B) Frases editoriales compartidas entre 2+ herramientas (boilerplate ratio y
//      unicidad léxica por herramienta). Señal, no meta de recuento de palabras.
//   C) Defectos de caracteres extraños (CJK/emoji/control) en el editorial español.
//   D) Herramientas cortas (<70 palabras estrictas): se listan y se valida intent
//      (>=2 FAQ + >=1 limitación + summary) SIN exigir padding de palabras.
//   E) Utilidad de categorías: etiquetas habilitadas y cobertura de herramientas.
//   F) Huella de plantilla (template footprint / originalidad): % de oraciones
//      editoriales únicas de cada herramienta.
//
// Las tolerancias son DETECTORES de riesgo, no números a optimizar: no se pide
// reescribir contenido ni añadir relleno. Solo se falla ante patrones reales de
// templating/near-duplicado, que el contenido actual no presenta.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText, wordCount, jaccard } from './content-similarity.mjs';
import { writeEvidence } from '../tests/evidence-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const tools = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf8')).filter((t) => t.enabled);
const categories = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'categories.json'), 'utf8'));
const enabledCats = categories.filter((c) => c.enabled);

let pass = 0, warn = 0, fail = 0;
const p = (m) => { pass++; console.log('  PASS:', m); };
const w = (m) => { warn++; console.warn('  WARN:', m); };
const f = (m) => { fail++; console.error('  FAIL:', m); };

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
function strictText(t) {
  return [...toSentences(t.instructions), ...toSentences(t.limitations), ...toSentences(t.faq)].join(' ');
}

const rec = tools.map((t) => {
  const text = strictText(t);
  const normSent = [...toSentences(t.instructions), ...toSentences(t.limitations), ...toSentences(t.faq)]
    .map((s) => normalizeText(s))
    .filter((s) => wordCount(s) >= 5);
  return {
    slug: t.slug,
    cat: t.category,
    name: t.name,
    summary: (t.summary || '').trim(),
    words: wordCount(normalizeText(text)),
    nInstr: (t.instructions || []).length,
    nLim: (t.limitations || []).length,
    nFaq: (t.faq || []).length,
    text,
    sentences: normSent,
    raw: t,
  };
});

function shingleSet(text, n) {
  const toks = normalizeText(text).split(' ').filter((t) => t.length >= 3);
  if (toks.length < n) return new Set([toks.join(' ')]);
  const s = new Set();
  for (let i = 0; i <= toks.length - n; i++) s.add(toks.slice(i, i + n).join(' '));
  return s;
}

// ---------- A) Near-duplicate / name-substitution ----------
console.log('\n--- A) Near-duplicates / name-substitution (editorial estricto) ---');
const sets = rec.map((r) => ({ ...r, set: shingleSet(r.text, 6) }));
const pairs = [];
for (let i = 0; i < sets.length; i++) {
  for (let j = i + 1; j < sets.length; j++) {
    const sim = jaccard(sets[i].set, sets[j].set);
    if (sim >= 0.10) pairs.push({ a: sets[i].slug, b: sets[j].slug, sim });
  }
}
pairs.sort((x, y) => y.sim - x.sim);
const maxSim = pairs.length ? pairs[0].sim : 0;
const NEAR_DUP = 0.45; // detector de riesgo: por debajo queda todo el contenido real
const nearDupPairs = pairs.filter((p) => p.sim >= NEAR_DUP);
console.log(`  pares con sim >= 0.10: ${pairs.length}; sim maxima: ${maxSim.toFixed(3)}`);
for (const p of pairs.slice(0, 8)) console.log(`    ${p.sim.toFixed(3)}  /${p.a} <-> /${p.b}`);
if (nearDupPairs.length === 0) p(`ningun par de herramientas es near-duplicate (max sim ${maxSim.toFixed(3)} < ${NEAR_DUP})`);
else f(`${nearDupPairs.length} pares con sim >= ${NEAR_DUP}: ${nearDupPairs.map((x) => `/${x.a}~/${x.b}(${x.sim.toFixed(2)})`).join(', ')}`);

// ---------- B) Frases compartidas + unicidad ----------
console.log('\n--- B) Frases editoriales compartidas entre herramientas ---');
const sentCount = new Map();
for (const r of rec) {
  for (const s of new Set(r.sentences)) {
    if (!sentCount.has(s)) sentCount.set(s, { n: 0, pages: [] });
    const e = sentCount.get(s);
    e.n++;
    if (!e.pages.includes(r.slug) && e.pages.length < 8) e.pages.push(r.slug);
  }
}
const sharedSent = [...sentCount.entries()].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n);
const sharedSet = new Set(sharedSent.map(([s]) => s));
const WHITELIST = [
  /mis archivos se suben a un servidor/i,
  /no todo el procesamiento ocurre en tu navegador/,
  /los archivos nunca salen de tu dispositivo/,
];
const concerningShared = sharedSent.filter(([s]) => !WHITELIST.some((re) => re.test(s)));
console.log(`  oraciones editoriale compartidas en 2+ herramientas: ${sharedSent.length}`);
console.log(`  de las cuales "confianza/privacidad" (whitelist): ${sharedSent.length - concerningShared.length}`);
console.log('  Top 10 compartidas:');
for (const [s, v] of sharedSent.slice(0, 10)) console.log(`    [${v.n}] ${s} (${v.pages.slice(0, 4).join(', ')})`);
const SHARED_HARD = 0.80; // detector: herramienta casi-totalmente plantilla
const rowPct = rec.map((r) => {
  const uniq = new Set(r.sentences);
  const sharedN = [...uniq].filter((s) => sharedSet.has(s)).length;
  return { slug: r.slug, cat: r.cat, sharedN, total: uniq.size, pct: uniq.size ? sharedN / uniq.size : 0 };
}).sort((a, b) => b.pct - a.pct);
const overHard = rowPct.filter((r) => r.pct >= SHARED_HARD);
console.log(`  unicidad por herramienta: peor sharedness ${(rowPct[0]?.pct * 100 || 0).toFixed(0)}% (/${rowPct[0]?.slug}); herramientas con >=${(SHARED_HARD * 100).toFixed(0)}% compartida: ${overHard.length}`);
if (overHard.length === 0) p(`ninguna herramienta es plantilla casi total (sharedness max ${(rowPct[0]?.pct * 100 || 0).toFixed(0)}% < ${(SHARED_HARD * 100).toFixed(0)}%)`);
else w(`${overHard.length} herramientas con sharedness >= ${SHARED_HARD} (revisar): ${overHard.map((r) => `/${r.slug}(${(r.pct * 100).toFixed(0)}%)`).join(', ')}`);

// ---------- C) Caracteres extraños ----------
console.log('\n--- C) Caracteres extraños (CJK / emoji / control) ---');
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/u;
const defects = [];
for (const r of rec) {
  const fields = [r.name, r.summary, ...toSentences(r.raw.instructions), ...toSentences(r.raw.limitations), ...toSentences(r.raw.faq)];
  const text = fields.join(' ');
  if (CJK.test(text)) defects.push(`/${r.slug}: CJK`);
  if (EMOJI.test(text)) defects.push(`/${r.slug}: emoji`);
  if (CTRL.test(text)) defects.push(`/${r.slug}: control/zero-width`);
}
const uniqDefects = [...new Set(defects)];
console.log(`  defectos de caracteres: ${uniqDefects.length}`);
for (const d of uniqDefects) console.log('   ', d);
if (uniqDefects.length === 0) p('ningún defecto CJK/emoji/control en el editorial');
else f(`defectos de caracteres: ${uniqDefects.join(', ')}`);

// ---------- D) Herramientas cortas (<70 estrictas) ----------
console.log('\n--- D) Herramientas cortas (<70 palabras estrictas): intent, no padding ---');
const SHORT = 70;
const shortTools = rec.filter((r) => r.words < SHORT).sort((a, b) => a.words - b.words);
const missingIntent = shortTools.filter((r) => r.nFaq < 2 || r.nLim < 1 || !r.summary);
console.log(`  herramientas < ${SHORT} estrictas: ${shortTools.length}`);
for (const r of shortTools) console.log(`    ${r.words}w /${r.slug} (${r.cat}) I${r.nInstr}/L${r.nLim}/F${r.nFaq}`);
if (missingIntent.length === 0) p(`las ${shortTools.length} herramientas cortas cumplen intent (>=2 FAQ, >=1 limitación, summary); no se pide padding`);
else w(`${missingIntent.length} herramientas cortas sin intent completo: ${missingIntent.map((r) => `/${r.slug}`).join(', ')}`);

// ---------- E) Categorías ----------
console.log('\n--- E) Categorías habilitadas y cobertura ---');
const catIds = new Set(enabledCats.map((c) => c.id));
const assigned = new Set(rec.map((r) => r.cat));
const missingCats = [...assigned].filter((c) => !catIds.has(c));
const catCoverage = {};
for (const c of enabledCats) catCoverage[c.id] = rec.filter((r) => r.cat === c.id).length;
console.log(`  categorías habilitadas: ${enabledCats.length}; herramientas: ${rec.length}`);
for (const [cid, n] of Object.entries(catCoverage).sort((a, b) => b[1] - a[1])) console.log(`    ${cid}: ${n}`);
if (enabledCats.length >= 12 && missingCats.length === 0 && Object.values(catCoverage).every((n) => n > 0))
  p(`${enabledCats.length} categorías habilitadas, todas cubiertas por herramientas`);
else f(`problema de categorías: habilitadas=${enabledCats.length}, missing=${missingCats.join(',') || 'none'}, sin cobertura=${Object.entries(catCoverage).filter(([, n]) => n === 0).map(([c]) => c).join(',') || 'none'}`);

// ---------- F) Originalidad / huella de plantilla ----------
console.log('\n--- F) Originalidad: % de oraciones editoriales únicas por herramienta ---');
const uniqRows = [...rowPct].map((r) => ({ ...r, uniqPct: 1 - r.pct })).sort((a, b) => a.uniqPct - b.uniqPct);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * (arr.length - 1)))];
const uniqArr = uniqRows.map((r) => r.uniqPct);
const minU = uniqArr[0];
const medianU = q(uniqArr, 50);
console.log(`  originalidad (oraciones únicas) por herramienta: min=${(minU * 100).toFixed(0)}% median=${(medianU * 100).toFixed(0)}%`);
console.log('  menos originales (más compartidas):');
for (const r of uniqRows.slice(0, 8)) console.log(`    ${(r.uniqPct * 100).toFixed(0)}% única /${r.slug} (${r.cat})`);
console.log(`  huella total de plantilla (oraciones compartidas / total distintas): ${(sharedSet.size / new Set(rec.flatMap((r) => r.sentences)).size * 100).toFixed(1)}%`);
w('originalidad reportada como señal (no gate): los conversores hermanos comparten pasos de forma natural; no se reescribe');

// ---------- Evidencia determinista ----------
const evidence = {
  audit: 'APLUNO Content Similarity / Originality (AdSense layer 2)',
  scope: 'src/data/tools.json strict editorial (instructions + limitations + faq)',
  tools: rec.length,
  categories: enabledCats.length,
  pairwise: {
    pairsAbove010: pairs.length,
    maxSimilarity: Number(maxSim.toFixed(3)),
    nearDuplicateThreshold: NEAR_DUP,
    nearDuplicatePairs: nearDupPairs.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim.toFixed(3)) })),
  },
  sharedSentences: {
    distinctSharedOn2Plus: sharedSent.length,
    trustWhitelisted: sharedSent.length - concerningShared.length,
    byFrequency: sharedSent.slice(0, 20).map(([s, v]) => ({ n: v.n, sentence: s.slice(0, 120), pages: v.pages.slice(0, 5) })),
  },
  sharednessPerTool: {
    hardThreshold: SHARED_HARD,
    overHard: overHard.map((r) => ({ slug: r.slug, shared: Number(r.pct.toFixed(3)) })),
    worst: rowPct.slice(0, 10).map((r) => ({ slug: r.slug, cat: r.cat, shared: Number(r.pct.toFixed(3)), n: r.sharedN, total: r.total })),
  },
  charDefects: uniqDefects,
  shortTools: {
    threshold: SHORT,
    count: shortTools.length,
    missingIntent: missingIntent.map((r) => r.slug),
    list: shortTools.map((r) => ({ slug: r.slug, words: r.words, instr: r.nInstr, lim: r.nLim, faq: r.nFaq })),
  },
  categories: { enabled: enabledCats.length, coverage: catCoverage, unassigned: missingCats },
  originality: {
    minUniquePct: Number(minU.toFixed(3)),
    medianUniquePct: Number(medianU.toFixed(3)),
    globalBoilerplateRatio: Number((sharedSet.size / new Set(rec.flatMap((r) => r.sentences)).size).toFixed(3)),
    leastOriginal: uniqRows.slice(0, 10).map((r) => ({ slug: r.slug, cat: r.cat, uniquePct: Number(r.uniqPct.toFixed(3)) })),
  },
};
const evPath = join(ROOT, 'artifacts', 'adsense-content-remediation', 'audit-content-similarity.json');
writeEvidence(evPath, evidence);
console.log('\nEvidence written:', evPath.replace(ROOT + '\\', ''));

console.log(`\n=====================`);
const status = fail === 0 ? 'PASS' : 'FAIL';
console.log(`FINAL: ${status} (pass=${pass}, warn=${warn}, fail=${fail})`);
process.exit(status === 'PASS' ? 0 : 1);
