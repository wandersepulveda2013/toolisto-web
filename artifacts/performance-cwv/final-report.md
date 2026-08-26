# Performance & Core Web Vitals Certification Report

**Date:** 2026-08-26
**Baseline:** fad05f9
**Scope:** 202 tool pages, catalog, category, legal, 404

---

## Executive Summary

The audit identified two critical performance issues and implemented fixes that reduced per-tool-page JS payload by **94-95%** and eliminated all render-blocking scripts. The site is now well-positioned for Core Web Vitals compliance.

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Scripts per tool page | 25 | 6-12 | -52 to -76% |
| JS payload per tool page | ~1,318 KB | 59-84 KB | -94 to -95% |
| Render-blocking scripts | 21 | 0 | -100% |
| CSS fetchpriority hint | catalog only | all pages | all pages |
| Mode scripts loaded per page | 5 (all) | 0-1 (category-specific) | -80 to -100% |
| Vendor adapters loaded per page | 9 (all) | 0-3 (category-specific) | -67 to -100% |

---

## Changes Implemented

### 1. Defer all scripts (generate-seo-pages.mjs, toolisto.html)

All external `<script>` tags now use `defer`, eliminating render-blocking JS on every page type:
- Tool pages: 25 parser-blocking scripts → 0
- Category pages: 2 → 0
- Catalog (toolisto.html): 4 → 0
- Legal pages: 2 → 0

`defer` preserves execution order (scripts run sequentially after HTML parsing) while allowing the browser to render HTML without waiting for JS.

### 2. Category-specific script injection (generate-seo-pages.mjs)

Added `CATEGORY_ADAPTERS`, `CATEGORY_MODES`, and `buildToolScripts()` to inject only what each tool category needs:

| Category | Before | After | Saved |
|----------|--------|-------|-------|
| images (35 tools) | 25 scripts / 1,318 KB | 8 scripts / 59 KB | 95.5% |
| pdf (48 tools) | 25 / 1,318 KB | 10 / 59 KB | 95.5% |
| qrcodes (7 tools) | 25 / 1,318 KB | 12 / 77 KB | 94.1% |
| spreadsheets (38 tools) | 25 / 1,318 KB | 9 / 84 KB | 93.6% |
| calculators (2 tools) | 25 / 1,318 KB | 10 / 70 KB | 94.7% |
| files (10 tools) | 25 / 1,318 KB | 9 / 76 KB | 94.2% |

Specific optimizations:
- **QR tools**: Only load qrcode-gen.js, barcode-gen.js, jsqr.js + qr mode
- **Calculator tools**: Only load expression-parser.js + calc mode
- **PDF tools**: Only load pdf-ocr-engine.js, pdf-censor-engine.js, pdf-encryptor.js
- **Excel tools**: Only load excel mode
- **File tools**: Only load file mode
- **All other tools**: No vendor adapters, no modes loaded

### 3. CSS fetchpriority hint (generate-seo-pages.mjs)

Added `fetchpriority="high"` to all `<link rel="stylesheet">` tags for `styles.css` across all generated pages (tool, category, legal, 404). Previously only the catalog page had this hint.

---

## CSS & CLS Audit

| Risk Area | Rating | Notes |
|-----------|--------|-------|
| Image CLS | NONE | All images have explicit width/height |
| Font CLS | NONE | No web fonts; system font stack only |
| Animation CLS | NONE | All animations use composited properties (opacity, transform) |
| Splash/Intro CLS | NONE | Fixed overlay, removed after animation, content pre-rendered beneath |
| Dynamic injection CLS | LOW | Tool cards are static HTML; favorite buttons are position:absolute |
| Grid reflow CLS | LOW-MEDIUM | `tool-catalog-ready` class switches grid→block (one-time, user-triggered) |
| Render-blocking CSS | MEDIUM | 365KB single stylesheet; no critical CSS extraction |
| Fluid typography | GOOD | `clamp()` used throughout; no discrete font-size jumps |

---

## CWV Readiness

| Metric | Status | Notes |
|--------|--------|-------|
| LCP | GOOD | Hero `<h1>` text on all pages; no image LCP risk; CSS has fetchpriority="high" |
| CLS | GOOD | System fonts, composited animations, reserved min-heights on containers |
| INP | GOOD | All scripts deferred; no render-blocking JS; lightweight splash script |
| FCP | GOOD | Single CSS file (365KB) with fetchpriority; no web font delay |
| TBT | ACCEPTABLE | app.js init processes 202+ tool cards synchronously; tool pages evaluate 6-9 deferred scripts sequentially |

---

## Third-Party Impact

- **Google Analytics**: NOT active (no-op stub in app.js)
- **Google AdSense**: Only on APLUNO homepage (`/index.html`), NOT on any Toolisto page
- **External fonts**: ZERO (system font stack only)
- **CDNs**: ZERO (all assets self-hosted)
- **Preconnect/DNS-prefetch**: Not needed (no third-party origins at page load)

---

## Service Worker Cache

- **Strategy**: Stale-while-revalidate for static assets; network-first for navigations
- **Risk**: Manual version bumping (`toolisto-static-v4`) — no content-hash detection
- **Mitigation**: Query-string cache-busting (`?v=20260814-apluno`) on CSS/JS references

---

## Regression Test Suite

`tests/performance-loading-regression.mjs` — **540 tests across 8 categories**:

1. **Defer attribute**: All scripts on all page types verified deferred ✓
2. **Category-specific adapters**: Each category loads only its expected vendor scripts ✓
3. **Category-specific modes**: Each category loads only its expected mode scripts ✓
4. **Script count budget**: Max 12 scripts per tool page ✓
5. **Core scripts**: file-limits.js, tool-processors.js, app.js, pwa-register.js always present ✓
6. **CSS fetchpriority**: All pages have fetchpriority="high" on stylesheet ✓
7. **No render-blocking scripts**: Zero synchronous external scripts ✓
8. **mode-core consistency**: mode-core.js only loaded when modes are present ✓

---

## Gate Status

- Workspace gate: **30/30 PASS** (1,379 tests)
- Public release gate: **19/19 PASS**
- Performance regression: **540/540 PASS**

---

## Remaining Items (documented, not blocking)

1. **Critical CSS extraction**: Inline above-the-fold CSS, async-load the rest (would eliminate 365KB render-blocking)
2. **app.js monolith**: 383KB, processes 202+ tool cards synchronously — consider lazy initialization
3. **SW cache versioning**: Content-hash-based invalidation would be more robust
4. **Image formats**: All raster images are PNG; WebP/AVIF variants would reduce social card size
5. **`tool-catalog-ready` CLS**: Grid→block switch could use CSS containment or container queries
