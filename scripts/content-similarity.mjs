// content-similarity.mjs
// Núcleo de normalización y de similitud de contenido compartido por la auditoría
// de calidad y por los tests de regresión (mismo algoritmo, sin reimplementación).
import { readFileSync } from 'node:fs';

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function normalizeText(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

// Conjuntos de shingles (n-gramas de palabras) de un texto normalizado.
export function shingleTokens(text, n) {
  const toks = normalizeText(text).split(' ').filter((t) => t.length >= 3);
  if (toks.length < n) return new Set([toks.join(' ')]);
  const s = new Set();
  for (let i = 0; i <= toks.length - n; i++) s.add(toks.slice(i, i + n).join(' '));
  return s;
}

// Similitud de Jaccard entre dos conjuntos de shingles.
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

// Similitud de contenido entre dos textos visibles (0..1).
export function contentSimilarity(textA, textB, shingleSize = 6) {
  return jaccard(shingleTokens(textA, shingleSize), shingleTokens(textB, shingleSize));
}

// Similitud entre dos documentos HTML (extrae texto visible).
export function htmlSimilarity(htmlA, htmlB, shingleSize = 6) {
  return contentSimilarity(stripTags(htmlA), stripTags(htmlB), shingleSize);
}

// Leer un snippet html desde disco (para fixtures opcionales).
export function readHtml(path) {
  return readFileSync(path, 'utf8');
}
