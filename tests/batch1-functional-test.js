const { runGroup } = require('./current-tool-schema-audit.cjs');
const ids = ['compress', 'crop', 'convert', 'signature', 'mergePdf', 'imagesPdf'];
process.exit(runGroup('Batch 1', ids) ? 0 : 1);
