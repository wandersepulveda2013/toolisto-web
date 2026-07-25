# Toolisto — Third-Party Dependencies

All dependencies used by Toolisto, their versions, licenses, and purpose.

## Browser Libraries (vendor/)

| Library | Version | License | File | Purpose |
|---------|---------|---------|------|---------|
| PDF.js | 3.11.174 | Apache-2.0 | vendor/pdfjs/pdf.min.js, pdf.worker.min.js | Render PDF pages to canvas |
| pdf-lib | 1.17.1 | MIT | vendor/pdflib/pdf-lib.min.js | Create and modify PDF documents |
| JSZip | 3.10.1 | MIT | vendor/jszip/jszip.min.js | Create/extract ZIP archives |
| SheetJS (xlsx) | 0.18.5 | Apache-2.0 | vendor/xlsx/xlsx.min.js | Read/write Excel, CSV, ODS files |
| Mammoth.js | 1.6.0 | BSD-2-Clause | vendor/mammoth/mammoth.browser.min.js | Convert DOCX to HTML |
| docx | 8.5.0 | MIT | vendor/docx/docx.min.js | Create DOCX documents |
| epub.js | 0.3.93 | MIT | vendor/epub/epub.min.js | Parse EPUB ebooks |
| rtf-parser | 1.2.0 | MIT | vendor/rtf-parser/rtf-parser.min.js | Parse RTF documents |

## Dev Dependencies

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| Playwright | 1.52.0 | Apache-2.0 | Browser testing |

## License Details

### Apache-2.0 (PDF.js, SheetJS)
- Permits commercial use, modification, distribution
- Requires license notice and state of changes
- No patent retaliation clause
- https://www.apache.org/licenses/LICENSE-2.0

### MIT (pdf-lib, JSZip, docx, epub.js, rtf-parser)
- Permits commercial use, modification, distribution
- Requires license notice
- No warranty
- https://opensource.org/licenses/MIT

### BSD-2-Clause (Mammoth.js)
- Permits commercial use, modification, distribution
- Requires copyright notice
- No warranty
- https://opensource.org/licenses/BSD-2-Clause

All dependencies are free, open-source, and permit commercial use.
