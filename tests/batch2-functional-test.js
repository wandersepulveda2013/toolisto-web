const { runGroup } = require('./current-tool-schema-audit.cjs');
const ids = ['rotatePdf', 'deletePagesPdf', 'reversePagesPdf', 'duplicatePagesPdf', 'insertBlankPagesPdf', 'editMetadataPdf', 'compressPdf', 'cropPdf', 'resizePdfPages', 'nUpPdf'];
process.exit(runGroup('Batch 2', ids) ? 0 : 1);
