# Phase 3C — Reality Check

Date: 2026-08-02 (updated)
Branch: feature/workspace-star-flow
HEAD: b161e23

Status: **PHASE 3C: VALIDADA — 79/79 E2E (100%)**

---

## Classification Matrix

| Capability | Status | Evidence |
|---|---|---|
| **OCR engine (Tesseract.js)** | REAL | vendor/tesseract/ has WASM core + worker. EngineLoader works. |
| **Workspace OCR ("Extraer texto")** | REAL (with limitation) | Tesseract runs on the raw image (the ≥800px upscale was REMOVED: it degraded noisy images 74%→47% chars and produced the `1-30` artifact). 100% chars / 100% words on the clean fixture; 76% chars / 43% words raw on the difficult fixture (47%/4% only if upscaled). OEM 3 (DEFAULT) en `vendor/js/engine-loader.js`. Model served locally (`vendor/tesseract/lang-data`). |
| **scanPage.ocrText** | SIMULADA | Defined in models.js:128, never written by any code path |
| **scanPage.ocrConfidence** | SIMULADA | Defined in models.js:129, never populated |
| **scanPage.ocrStatus** | SIMULADA | Always 'pending', never changes. models.js:130 |
| **Scanner perspective correction** | REAL | scanner-ui.js + image-processor.js fully working |
| **Scanner identity path** | REAL | Identity corners now route OCR to the original image when no manual geometry, filter or rotation was applied. |
| **Table editing** | REAL | Full spreadsheet: edit, formulas, undo/redo, clipboard |
| **Table creation (new)** | REAL | createNewDataTable creates 3x3 with model |
| **Doc-to-table parsing** | REAL (improved) | Space-separated OCR rows are rebuilt by numeric anchor (multi-word name before value, status after) and OCR misread negatives are normalized (`1-30` → `-30`). Semicolon, tab, pipe, comma paths unchanged. Star-Flow cells: 15/15 (100%). |
| **Chart creation (bar)** | REAL | createChartFromTable generates SVG |
| **Chart negative values** | REAL | Bars render correctly and negatives now reach the table (`-30`, `-200`): E2E verifies both table and chart negatives. |
| **Chart comma decimals** | REAL | `parseLocaleNumber()` accepts comma decimals, thousands separators and negative values. |
| **Chart auto-update** | REAL | Charts linked to a table are regenerated after the table is saved. |
| **Chart SVG labels** | REAL | Titles, labels and values are escaped before entering the SVG. |
| **Design section editor** | REAL | Full CRUD, reorder, preview |
| **Design save (actionsBar)** | REAL (fixed) | actionsBar moved inside renderSidebar(). Buttons survive re-render. |
| **PDF structure** | REAL (fixed) | /Info + /Title now present. dist/pdf-generator.js synced. |
| **PDF accented chars** | REAL | pdfString() uses octal, Helvetica WinAnsiEncoding |
| **PDF ñ** | REAL | U+00F1 → \361 → correct glyph |
| **PDF multi-page** | REAL | Auto-break + explicit page-break sections |
| **PDF tables in PDF** | REAL | renderTablePDF renders grid with cells |
| **PDF charts in PDF** | REAL | renderChartPDF renders bars |
| **PDF images** | REAL (with limitation) | Local PNG/WebP/GIF images are converted to JPEG in the browser and embedded in the generated PDF. |
| **PDF text selection** | REAL | Standard BT/ET text operators |
| **showModal API** | REAL (fixed) | Object API used consistently at 3 sites. |
| **IndexedDB persistence** | REAL | 8 stores, lazy load on navigation |
| **Data survives reload** | REAL | Full IndexedDB round-trip |
| **Export (.toolisto)** | REAL | All entities included |
| **Import (.toolisto)** | REAL | All entities restored with new IDs |
| **Relation remapping on import** | REAL (fixed) | Full remapping of documents, data, assets, captures, executions. Verified by E2E. |
| **Blob URLs stored** | NO | Data URLs (base64) stored, not blob URLs. Correct. |
| **Error handling** | PARCIAL | try/catch on key ops, but some paths silent |
| **E2E sidebar navigation** | REAL | Sidebar clicks used instead of non-existent window.appStore |

---

## Fixed Issues (this session)

1. **showModal API** — 3 broken positional-arg calls → object API
2. **Design view actionsBar** — buttons removed on re-render → moved inside renderSidebar()
3. **dist/pdf-generator.js** — out of sync, missing /Info + /Title → synced from source
4. **dist/core/storage.js** — out of sync, missing import remapping → synced from source
5. **PDF /Info metadata** — missing title/author → now present
6. **Relation remapping on import** — cross-object refs → full remapping verified
7. **OCR model download** — `spa.traineddata.gz` fetched from a remote CDN caused >120s timeouts → model vendored in `vendor/tesseract/lang-data/` and `engine-loader.js` now prefers the local copy (`pickLangPath`). OCR completes in ~2s.
8. **Doc-to-table negative loss** — Tesseract reads `-30` as `1-30` and space-separated OCR rows fragmented multi-word names → `normalizeOcrNumber()` + `rebuildTableRow()` in `convertDocToTable`. Table cells 9/15 → 15/15 (100%).
9. **Dangling `ocrCanvas` after upscale removal** — removing the ≥800px upscale from `extractTextFromScan` left 3 references to the deleted `ocrCanvas` variable in `registerExecution` (`ocrWidth/ocrHeight/scaled`); a `ReferenceError` after a successful `recognize()` crashed the success path into the manual-entry fallback. Replaced with `canvas` + `scaled: false` and synced to `dist`. Real OCR now verified in the E2E (147/147 chars).

---

## Remaining Limitations

1. **OCR accuracy still depends on the source image** — low resolution, blur and heavy noise can still require manual review. The "difficult" fixture (`scan-difficult.png`, 12px + noise) measures 76% chars / 43% words raw with OEM 3 (DEFAULT, LSTM + legacy, desde 74%/39% con OEM 1). The ≥800px upscale was REMOVED because it amplified noise (74%→47% chars) and produced the `1-30` artifact on the clean fixture. Ninguna binarización/upscale/sharpen probado supera la vía cruda con OEM 3; el texto efectivo de ~8px con ruido determinista es el límite documentado.
2. **PDF image conversion uses a browser canvas** — extremely large or externally sourced images may fall back to a placeholder if the browser cannot decode them safely.
3. **Import relation remapping** — fixed and covered by the current E2E path, but future model types should add dedicated fixtures.
4. **Doc-to-table reconstruction is heuristic** — the numeric-anchor rebuild assumes a `[label, value, status]` layout; tables with two numeric columns or no numeric cell in a row fall back to plain splitting.
