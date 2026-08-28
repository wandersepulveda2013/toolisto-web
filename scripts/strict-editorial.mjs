// strict-editorial.mjs
// Extracción de contenido editorial "estricto" de una página de herramienta de
// Toolisto: SOLO instructions + limitations + faq, SIN el chrome repetido
// (capability strip "01 Prepara / 02 Ajusta / 03 Entrega", etiquetas de formato,
// nota de privacidad, lista de herramientas relacionadas). Compartido entre el
// auditor de calidad editorial (audit-content-quality.mjs) y la prueba de
// regresión (tests/strict-editorial-regression.mjs) para evitar desviación.
import { stripTags, wordCount } from './content-similarity.mjs';

// Texto visible de un fragmento HTML ('' si null).
export function textOfSection(html) {
  if (!html) return '';
  return stripTags(html).replace(/\s+/g, ' ').trim();
}

// Encuentra el contenido interno del primer contenedor <tag>...</tag> balanceado
// (soporta anidamiento del mismo tag). Devuelve null si no hay apertura.
export function balancedRegion(html, tag) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const startContent = m.index + m[0].length;
  return consumeBalanced(html, startContent, tag, m.index);
}

// Encuentra el contenido interno del primer contenedor <tag class="...cls..."> balanceado.
export function balancedRegionClass(html, tag, cls) {
  const openRe = new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const startContent = m.index + m[0].length;
  return consumeBalanced(html, startContent, tag, m.index);
}

// Devuelve el texto entre el contenido inicial y el cierre balanceado de `tag`.
export function consumeBalanced(html, startContent, tag, startIdx) {
  let depth = 1;
  const openRe = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  openRe.lastIndex = startIdx + 1;
  closeRe.lastIndex = startIdx + 1;
  const events = [];
  let o, c;
  while ((o = openRe.exec(html))) events.push({ pos: o.index, open: true });
  while ((c = closeRe.exec(html))) events.push({ pos: c.index, open: false, tagEnd: html.indexOf('>', c.index) + 1 });
  events.sort((a, b) => a.pos - b.pos);
  for (const ev of events) {
    if (ev.open) depth++;
    else {
      depth--;
      if (depth === 0) {
        return html.slice(startContent, ev.tagEnd - 2); // excluye el cierre
      }
    }
  }
  return null;
}

// Palabras estrictamente editoriales (instructions + limitations + faq), sin chrome.
export function extractStrictEditorial(html) {
  const stripLabels = (sectionHtml, labels) => {
    let s = sectionHtml || '';
    for (const l of labels) s = s.replace(l, ' ');
    // Quitar frases de wrapper del build ("Ver todas las herramientas", etc.)
    s = s
      .replace(/ver todas las herramientas/gi, ' ')
      .replace(/ver todas/gi, ' ')
      .replace(/ver mas/gi, ' ')
      .replace(/ver más/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return s;
  };
  const instrHtml = balancedRegionClass(html, 'section', 'instructions');
  const limHtml = balancedRegionClass(html, 'section', 'limitations');
  const faqHtml = balancedRegionClass(html, 'section', 'faq-section');
  const instructions = textOfSection(instrHtml);
  const limitations = textOfSection(limHtml);
  const faq = textOfSection(faqHtml);
  const instrBody = stripLabels(instructions, [/(Cómo funciona)/gi]);
  const limBody = stripLabels(limitations, [/(Limitaciones)/gi, /(Limitación)/gi]);
  const faqBody = stripLabels(faq, [/(Preguntas frecuentes)/gi]);
  const corpus = [instrBody, limBody, faqBody].join(' ').replace(/\s+/g, ' ').trim();
  return { words: wordCount(corpus), instructions, limitations, faq };
}
