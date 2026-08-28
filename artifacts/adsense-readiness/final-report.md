# APLUNO AdSense Readiness Audit — Final Report

**Date:** 2026-08-28  
**Publisher:** ca-pub-2644615452393440  
**Site:** https://apluno.com  
**Status:** READY (under Google review)  
**External AdSense status:** PENDIENTE_REVIEW_GOOGLE (aprobación y configuración de consentimiento quedan en Google/host)


---

## Executive Summary

APLUNO is **AdSense-ready**. The site passes all quality gates: 22/22 public release (incl. the strict-editorial and the content-similarity/originality regressions), 30/30 workspace release, 28/28 dist-workspace-smoke, 0 regressions. **Layer 3 (this report append)** certified the **real production pipeline**: build → generators → AdSense injection → `dist/`, verified the monetizable-surface inventory, ads.txt/publisher identity/policy pages/crawlability end-to-end, and fixed one genuine production defect (internal Workspace docs leaking into the public deployment). The `apluno-launcher` desktop-fit failure remains classified **PRE-EXISTING** (out of AdSense scope) — see [Launcher attribution](#launcher-attribution).

---

# Layer 3 — Production Monetization & Policy Delivery Certification

This layer certifies that the **actual deployed `dist/` build** is ready for Google AdSense to crawl,
display ads, and evaluate — verifying the real production pipeline, not just source.

### Certified pipeline (FASE 1)

`npm run build` → `node scripts/build-public-site.mjs` = `rmSync(dist)` (clean) →
`generate-seo-pages.mjs --production` → `generate-apluno-pages.mjs` → `inject-adsense.mjs`.
`scripts/test-public-release.mjs` executes this exact pipeline before asserting on `dist/`.

### Ad-surface inventory (FASE 2/3) — 291 HTML

| Type | n | AdSense | Detail |
|------|---|---------|--------|
| TOOL (processing) | 202 | 0 | privacy-compliant: no ads on file processing |
| REDIRECT | 52 | 0 | noindex + canonical |
| CATEGORY | 12 | 12 (1 each) | exactly 1 loader per page |
| GUIDE | 10 | 0 | indexable, no ads |
| WORKSPACE | 2 | 0 | runtime + landing |
| APLUNO_HOME / TOOLISTO_CATALOG / ABOUT | 3 | 1 each | exactly 1 loader |
| PRIVACY/TERMS/CONTACT/404/ORDIA/APOYAR/legacy | 8 | 0 | no ads |
| OTHER (guia/index, offline) | 3 | 1 | home has 1 |

**Anomalies: 0** — no page >1 loader, no ads on non-monetized surfaces, no monetized surface missing ads.
No manual ad slots (`data-ad-slot`/`googletag`/inline `adsbygoogle` absent) → **Auto Ads** architecture
(density/CLS controlled externally by Google).

### Publisher consistency (FASE 6)
Single `ca-pub-2644615452393440` through SOURCE/DOCS/TEST/DIST; no placeholder publisher anywhere
(`pub-0000000000000000` / `pub-1234567890123456` absent from production).

### ads.txt / robots / _headers (FASE 11)
- `ads.txt` = `google.com, pub-2644615452393440, DIRECT, f08c47fec0942fa0` — valid, root, single line.
- `robots.txt` allows all + declares `Sitemap: https://apluno.com/sitemap.xml`; does **not** block monetized pages.
- `_headers` CSP permits `pagead2.googlesyndication.com` / `googleads.g.doubleclick.net`.

### Policy & consent delivery (FASE 7/8)
- **Privacy** discloses AdSense, Google cookies/identifiers, IndexedDB and localStorage; states AdSense is
  **not** on processing pages and file content is **not** sent to Google; addresses consent
  ("conforme a las opciones de consentimiento aplicables"). No contradictions with real behavior.
- **Terms** consistent (products labeled "En desarrollo", no false promises).
- **Contact** real (`toolistoweb@gmail.com`), reachable from footer. **About** brand-consistent.
- No stale "167 herramientas" / old-domain references in `dist/`.

### Ad safety & density (FASE 15/16/17)
No manual slots → no density/CLS risk from code; layout shift from Auto Ads is external. Loader is single
global `async crossorigin="anonymous"`; no inline `adsbygoogle`; site has **no functional dependency** on AdSense.

### Service worker (FASE 18)
`dist/service-worker.js` has **zero** ad-domain references (does not precache/intercept AdSense);
monetized routes pass through `APLUNO_PUBLIC_ROUTES` to network (never stale). `/ads.txt` added to the route allowlist.

### Workspace public leak — DEFECT FOUND & FIXED (FASE 10/14)
`dist/workspace/` was publishing **19 internal `.md`** (AUTONOMOUS-*.md, CONTINUOUS-EVOLUTION-*.md,
PRODUCTION-READINESS-*.md, AUDIT*.md, OPENCODE-*.md, PHASE-3C-REALITY-CHECK.md, README.md) + 2 agent markers
(`AUTONOMOUS_MODE`, `PRODUCTION_READINESS_DONE`) to the public deployment. Root cause:
`generate-seo-pages.mjs:131` `cpSync(WS_SRC, WS_DIST, {recursive:true})`. Fixed with `copyWorkspaceFiltered`
(excludes `*.md` + markers). Post-fix: `dist/workspace/` = runtime only (`core/`, `index.html`,
`lazy-loader.js`, `tools-data.js`, `workspace.css`, `workspace.js`). Guarded by a new 22nd check in
`scripts/test-public-release.mjs`. `dist-workspace-smoke` still **28/28** (workspace runs in browser).

### Crawlability & broken nav (FASE 9/13)
All navigation links on home + catalog resolve (local audit: 0 broken); 202/202 tool pages materialized;
236 indexable URLs; sitemap 236 URLs.

### Tests measure DIST (FASE 19)
`tests/adsense-integration.mjs` (21), `tests/apluno-production-seo.mjs` (29),
`tests/apluno-monetization-readiness.mjs` (25), `tests/strict-editorial-regression.mjs` (3),
`tests/content-similarity-scoped-regression.mjs` (5) all read `dist/` and are invoked by the release gate.
**Public release gate: 22 PASS / 0 FAIL.** dist-workspace-smoke 28/28. Evidence deterministic (diff-zero).

### External / config requirements (FASE 20)
- GitHub Pages does **not** apply `_headers`; Cloudflare does **not** inject a real CSP — so the CSP in
  `dist/_headers` is documented-but-not-enforced in production (external host behavior; config note, not a defect).
- AdSense **approval** and **consent/CMP configuration** are external (Google/host) and remain open actions.
  `EXTERNAL ADSENSE STATUS: PENDIENTE_REVIEW_GOOGLE`.

### Remaining risks (Layer 3)
- CSP not enforced on GitHub Pages / Cloudflare (host-dependent) — LOW/MEDIUM, external.
- `apluno-launcher` desktop-fit CSS overflow — PRE-EXISTING, out of scope.
- Google review outcome and TCF/CMP consent setup — external, cannot be certified from the repo.

**Evidence:** `artifacts/adsense-readiness/production-monetization-audit.json`,
`ad-surface-inventory.json`, `evidencia-layer3.md`.

**Layer 3 classification: READY** (with documented external requirements).

---


---

## Fixes Applied

| Priority | File | Issue | Fix |
|----------|------|-------|-----|
| P0 | `toolisto.html` | Stale "167 herramientas" count (5 occurrences) | Updated to "202 herramientas" |
| P0 | `scripts/inject-adsense.mjs` | Stale "167 herramientas" comment (2 occurrences) | Updated to "202 herramientas" |
| P0 | `scripts/audit-content-quality.mjs` | Thin-content metric was inflated by UI chrome (capability strip, format labels, privacy note, related-tools all counted as editorial) | Recalibrated to **strict editorial** (instructions + limitations + faq only); shared extractor in `scripts/strict-editorial.mjs`; recalibrated tool tiers |
| P1 | `scripts/apluno-components.mjs` | 404.html got self-referencing canonical (harmful for error pages) | Added `noCanonical` option to `renderSeoMetadata()` and `renderPage()` |
| P1 | `scripts/generate-apluno-pages.mjs` | Privacy page missing IndexedDB/localStorage disclosure | Added "Almacenamiento local" section |
| P1 | `scripts/generate-apluno-pages.mjs` | 404 page missing `noCanonical: true` | Applied flag |
| P1 | `offline.html` | Wrong lang="es" (should be es-419), missing viewport-fit=cover | Fixed both |
| Layer 3 | `scripts/generate-seo-pages.mjs` | `dist/workspace/` published 19 internal `.md` + 2 agent markers to the public deployment | Replaced `cpSync(WS_SRC, WS_DIST, {recursive:true})` with `copyWorkspaceFiltered` (excludes `*.md` + `AUTONOMOUS_MODE`/`PRODUCTION_READINESS_DONE`); added `/ads.txt` to `APLUNO_PUBLIC_ROUTES` |
| Layer 3 | `scripts/test-public-release.mjs` | No guard for the workspace internal-doc leak | Added 22nd check (recursive scan of `dist/workspace` for `.md`/markers) |

---

## Audit Findings

### Site Quality (PASS)

| Criterion | Status | Detail |
|-----------|--------|--------|
| Content depth | PASS | 202 real tools, 12 categories, each with unique description and working implementation |
| Duplicate content | PASS | Each tool page has distinct functional content; no spinning or aggregation |
| Low-value content | PASS | No doorway pages, auto-generated spam, or thin affiliate content |
| Navigation | PASS | Breadcrumbs, category pages, clean URLs |
| Mobile responsive | PASS | CSS media queries, responsive grid |

### Content Quality — Strict Editorial Metric (this audit)

AdSense's "low-value content" review can be misled by an inflated word-count metric. The prior
metric counted the whole `tool-content` section, which includes a **verbatim capability strip**
(`01 Prepara / 02 Ajusta / 03 Entrega`, identical on all 202 pages), format labels, the privacy
note and the related-tools list. Those are UI chrome, not editorial substance.

This audit corrected the metric to count **only genuine per-tool editorial**: `instructions` +
`limitations` + `faq`. The extractor lives in `scripts/strict-editorial.mjs` (shared with the new
regression test `tests/strict-editorial-regression.mjs` so the two cannot drift).

| Measure | Before (chrome-inflated) | After (strict editorial) |
|---------|--------------------------|--------------------------|
| Thin pages (< floor) flagged | 0 (hidden) | **4 revealed** → then **0** after content improvement |
| Strict p50 (words) | 99 | 103 |
| Strict min (words) | 59 | 63 |
| Tools ≥ 140 strict words | 0 | 11 |
| Tools 100–139 | — | 95 |
| Tools 70–99 | — | 69 |
| Tools < 70 | — | 27 |

The honest metric surfaced **4 genuinely thin pages** (`/excel-a-markdown`, `/calculadora-simple`,
`/extraer-audio-video`, `/quitar-audio-video`, all < 60 strict words). Rather than lowering the
threshold or laundering content, those tools (plus 3 more generic conversion-cluster tools:
`/unir-audios`, `/pdf-a-markdown`, `/csv-a-markdown`) were improved in `src/data/tools.json` with
**tool-specific, genuine FAQ/limitations** — not filler. Pairwise strict-editorial similarity across
tools remains low, confirming the content is differentiated, not templated.

Audit now returns **PASS** (`final: PASS`, 15 checks, 0 warn/fail) with the strict metric, and the
regression gate guards the floor (`≥ 60` strict words/tool), the chrome exclusion (capability strip
must not leak into editorial), and full tool detection (`≥ 202`). Evidence with the honest
distribution is in `artifacts/adsense-content-remediation/audit-content-quality.json`.

### Content Similarity / Originality — AdSense Layer 2 (this audit)

A second AdSense layer measured **content originality and differentiation** over the strict editorial
of all ~202 tools (data-level, deterministic; also re-verified on the real `dist/` build by the
existing page-level audit). Detectors are *risk detectors*, not word-count targets — nothing was
padding-rewritten.

| Detector | Result | Verdict |
|----------|--------|---------|
| **A) Near-duplicates / name-substitution** | Max pairwise strict-editorial similarity **0.145**; only 5 pairs ≥ 0.10 (all legitimate conversion siblings: jpg-a-pdf↔png-a-pdf, recortar-audio↔recortar-video, pdf-a-jpg↔pdf-a-png, excel-a-csv↔json-a-csv, xlsx-a-ods↔ods-a-xlsx) | PASS — no doorway/spinned "change-the-name" pattern |
| **B) Shared-sentence boilerplate** | 80 shared editorial sentences across 2+ tools; only 3 are site-wide privacy/trust trust statements (whitelisted, benign). No tool ≥ 80% templated (worst: jpg-a-pdf 64%) | PASS |
| **C) Stray characters (CJK/emoji/control)** | **3 genuine CJK defects found & fixed** (below); post-fix sweep: **0** CJK, 0 emoji, 0 control | PASS after fix |
| **D) Short tools (< 70 strict words)** | 33 tools < 70 strict words (data-level count; the committed audit's page-level count is 27 — same 33 pages, methodology difference). All 33 have full structural intent (≥ 2 FAQ + ≥ 1 limitation + summary) and are GOOD/ACCEPTABLE for their simple single-purpose tasks — no filler, no WEAK/VERY WEAK | PASS — no padding applied |
| **E) Categories** | 12/12 enabled, every category has ≥ 1 tool (enriched editorial intro + FAQ), no unknown category ids | PASS |
| **F) Originality / template footprint** | Median **91%** of each tool's editorial is unique; global boilerplate ratio only **4.6%**; page-level audit confirms **0** concerning reused editorial prose | PASS (strong originality) |

**Genuine content fixes (CJK leaks into Spanish editorial), all in `src/data/tools.json`, committed:**
- `/girar-pdf` FAQ: "necesitarás提供arla" → "necesitarás **proporcionarla**"
- `/calculadora-cientifica` FAQ: "factoriales,常数 (π, e)" → "factoriales, **constantes** (π, e)"
- `/comparar-dos-pdf` FAQ: "resalta diferencias像素 a píxel" → "resalta diferencias **píxel a píxel**"

The new scoped audit is `scripts/audit-content-similarity.mjs` (writes deterministic evidence to
`artifacts/adsense-content-remediation/audit-content-similarity.json`) and is guarded by the new
regression `tests/content-similarity-scoped-regression.mjs` (5 checks: A near-dup, B templating,
C stray chars, D short-tool intent, E categories), registered in the public release gate.

### Launcher Attribution

A `apluno-launcher` home-page check (`scrollHeight ≤ innerHeight + 1`) fails on desktop 1440×900
(deterministic, 34 checks / 1 fail). Forensics **classified it PRE-EXISTING**: introduced by the
committed FASE 7 editorial-home `6dced6d` (parent of all AdSense commits), before this audit's work.
The 5 home-page source files are byte-identical between `6dced6d` and HEAD; the failing home layout is
`renderHome()`-static (only dynamic value is a number, no layout impact), with `overflow-y:auto` on
the launcher's results box capping its height. Per mission scope this is **documented, not fixed**
(homepage/CSS is out of AdSense scope). See `tests/apluno-launcher.mjs`.

### AdSense Integration (PASS)

| Criterion | Status | Detail |
|-----------|--------|--------|
| Loader placement | PASS | `<head>` on all 15 eligible pages (homepage, catalog, 12 categories, about) |
| No ads on processing | PASS | 202 tool pages have zero AdSense loaders (privacy-compliant) |
| No duplicates | PASS | Exactly 1 loader per eligible page |
| ads.txt | PASS | Contains correct publisher line, nothing extra |

### Legal Pages (PASS)

| Page | Status |
|------|--------|
| Privacy | PASS — mentions AdSense, Google cookies, data collection, opt-out |
| Terms | PASS — Disclaimer, Limitation of Liability, Governing Law, IP |
| About | PASS — Mission, tools (202), contact email |

### SEO (PASS)

| Criterion | Status | Detail |
|-----------|--------|--------|
| Title tags | PASS | Unique per page |
| Meta descriptions | PASS | Unique, accurate (now 202 tools) |
| Canonical tags | PASS | Correct on all pages, absent on 404 |
| H1 tags | PASS | Single H1 per page |
| Sitemap | PASS | 225 URLs |
| Structured data | PASS | JSON-LD Organization + WebSite |
| Open Graph | PASS | og:title, og:description, og:type |
| Twitter cards | PASS | summary |

### Security (PASS)

| Criterion | Status | Detail |
|-----------|--------|--------|
| HTTPS | PASS | Enforced |
| Mixed content | PASS | None |
| External scripts | PASS | Only Google AdSense (vendor) |
| No eval() | PASS | CSP script-src 'self' |

### Performance (PASS)

| Criterion | Status | Detail |
|-----------|--------|--------|
| Build size | PASS | Static HTML, minimal JS |
| Images | PASS | SVG, WebP, optimized |
| Lazy loading | PASS | `loading="lazy"` on images |
| Service worker | PASS | Cache-first for static assets |

### Accessibility (PASS)

| Criterion | Status | Detail |
|-----------|--------|--------|
| Lang attribute | PASS | es-419 (now fixed on offline.html) |
| Viewport | PASS | Proper meta viewport (now fixed on offline.html) |
| Alt text | PASS | Present on images |
| Heading hierarchy | PASS | Proper nesting |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google rejects due to low original content | LOW | HIGH | Strict-editorial metric confirms all 202 tools have ≥ 60 genuine words; 4 thin pages improved; pairwise editorial similarity low (differentiated, not templated); layer-2 audit: max pair sim 0.145, 3 CJK defects fixed, no tool templated, median 91% unique editorial, 4.6% boilerplate, all 33 short tools have full intent |
| Rejected due to ad placement on processing pages | NONE | HIGH | Already excluded — zero ads on tool pages |
| Rejected due to thin privacy policy | NONE | MEDIUM | Privacy page now covers AdSense + IndexedDB + localStorage |
| Rejected due to duplicate canonical on 404 | LOW | MEDIUM | Fixed — 404 now has no canonical |
| Home-page `apluno-launcher` CSS overflow flagged on desktop review | LOW | LOW | Documented PRE-EXISTING (FASE 7, pre-AdSense); out of AdSense mission scope; not an ad/content-quality defect |
| Layer 3: CSP in `dist/_headers` not enforced by GitHub Pages / Cloudflare | MEDIUM | LOW | Documented external host behavior (config note, not a code defect); Cloudflare page rules can add headers if desired |
| Layer 3: Internal Workspace docs leaking to public deployment | NONE | HIGH | Fixed (workspace filter) + guarded by 22nd release-gate check |
| Layer 3: Google review outcome / consent-CMP setup | EXTERNAL | MEDIUM | `EXTERNAL ADSENSE STATUS: PENDIENTE_REVIEW_GOOGLE`; consent configuration is a host/Google action, not certifiable from repo |

---

## Conclusion

The site is ready for AdSense review. All P0/P1 fixes applied, the content-quality metric was
corrected to measure genuine editorial (not chrome), the 4 thin pages it revealed were honestly
improved, and a regression gate now protects the metric. The second AdSense layer (content similarity
**/ originality**) found zero gaps post-fix and is itself protected by a new regression gate in the
public release. **Layer 3** certified the real production pipeline: 22/22 public release (was 21),
dist-workspace-smoke 28/28, ad-surface inventory with zero anomalies, publisher consistency, valid
ads.txt/robots/sitemap, policy/consent delivery, service-worker isolation, no broken navigation, and
fixed one genuine production defect (internal Workspace docs leaking into `dist/workspace/`, now guarded).
**Classification: READY** (with a documented pre-existing launcher CSS overflow out of AdSense scope, and
external requirements — Google review approval and consent/CMP configuration — remaining). No regressions
(public release 22/22).
