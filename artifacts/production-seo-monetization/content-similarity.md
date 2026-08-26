# APLUNO Content Similarity Analysis

**Date:** 2026-08-26

## Methodology

All 202 tool pages were analyzed for structural and content similarity. Pages share an identical template (header → journey steps → hero → drop zone → capability strip → how-it-works → limitations → FAQ → related tools → footer). Differentiation exists in tool-specific content sections.

## Template Structure (shared by all 202 pages)

```
<head> (SEO meta, canonical, OG, JSON-LD)
├── intro animation
├── header (brand, nav)
├── breadcrumbs
├── journey steps (01-Prepara, 02-Ajusta, 03-Entrega)
├── hero (H1 + subtitle + privacy note)
├── file drop zone
├── capability strip (01-Prepara, 02-Ajusta, 03-Entrega) ← VERBATIM IDENTICAL
├── "How it works" section ← TOOL-SPECIFIC
├── "Limitations" section ← TOOL-SPECIFIC
├── FAQ (4 questions) ← TOOL-SPECIFIC
├── related tools ← TOOL-SPECIFIC
└── footer
```

## Cluster Analysis

| Cluster | Pages | Similarity | Risk | Assessment |
|---------|------:|-----------:|------|------------|
| PDF converters | 52 | HIGH | MEDIUM | Each tool has distinct function (merge, split, compress, rotate, etc.). Template repetition is structural but content is genuinely different. |
| Image converters | 29 | HIGH | MEDIUM | Distinct operations (compress, resize, convert, crop, etc.). Different input/output formats. |
| Word converters | 22 | VERY HIGH | MEDIUM | Most template-heavy cluster. "How it works" for all four word-a-* tools is essentially "Upload DOCX → Click convert → Download output." But each produces a genuinely different output format. |
| Excel/CSV tools | 38 | HIGH | MEDIUM | Distinct operations (convert, merge, split, filter, sort, etc.). |
| QR/code tools | 7 | MEDIUM | LOW | Better differentiation — each QR tool has genuinely different input fields (text, WiFi, contact, image). |
| Audio/video | 9 | MEDIUM | LOW | Distinct operations (convert, trim, merge, compress, etc.). |
| Text tools | 19 | MEDIUM-HIGH | MEDIUM | Some overlap in text processing tools but each has distinct function. |
| Document utilities | 10 | MEDIUM | LOW | Archive, encryption, hash — distinct operations. |

## Key Structural Issues

1. **Capability strip is 100% identical** across all 202 pages: "01 Prepara — Arrastra uno o varios archivos... 02 Ajusta — Las opciones avanzadas aparecen solo cuando hacen falta. 03 Entrega — Descarga el resultado..."
2. **Privacy note is verbatim**: "🔒 Tus archivos se quedan contigo. Se procesan en tu navegador."
3. **JS bundle loads ALL scripts** (~60 JS files) regardless of tool type.

## Risk Assessment

The template repetition creates a **structural similarity risk** for Google's thin-content detection. However:

- Each tool performs a **genuinely different function**
- Each page has **unique tool-specific content** (~120 words)
- The tools are **real functional implementations**, not doorway pages
- The capability strip, while identical, is **accurate for all tools**

**Overall risk: MEDIUM** — Not a blocking issue, but worth monitoring. If Google flags thin content, the capability strip could be made more tool-specific.

## Recommendation

Do NOT add filler text to inflate word count. If needed, make the capability strip more tool-specific (e.g., "Prepara tu archivo PDF" instead of "Arrastra uno o varios archivos"). This is a P2 improvement, not a P0 fix.
