const { runGroup } = require('./current-tool-schema-audit.cjs');
const ids = ['splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf'];
process.exit(runGroup('Batch 3', ids) ? 0 : 1);
