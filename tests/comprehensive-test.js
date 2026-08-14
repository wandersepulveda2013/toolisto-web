const { runAll } = require('./current-tool-schema-audit.cjs');
process.exit(runAll() ? 0 : 1);
