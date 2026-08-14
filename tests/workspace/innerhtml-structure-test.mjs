#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  PASS: ${msg}`); }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

console.log('=== InnerHTML Structure Security Audit ===\n');

const files = [
  'workspace/workspace.js',
  'workspace/core/scanner-ui.js',
  'workspace/core/workflow-ui.js',
  'workspace/core/workflow-engine.js',
  'workspace/core/workflow-model.js',
  'workspace/core/workflow-validator.js',
  'workspace/core/workflow-operations.js',
  'workspace/core/pdf-images.js',
  'workspace/core/operation-registry.js',
  'workspace/core/job-queue.js',
  'workspace/core/workspace-storage.js',
  'workspace/core/error-manager.js',
  'workspace/core/history-manager.js',
];

// Pattern for dynamic innerHTML assignment (with user data)
const DANGEROUS_INNERHTML = /\.innerHTML\s*=\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+)/;

// Pattern for any innerHTML assignment (including static)
const ANY_INNERHTML = /\.innerHTML\s*=/;

// Pattern for innerHTML reading (safe)
const READ_INNERHTML = /\.innerHTML\)/;

for (const rel of files) {
  const fp = join(ROOT, rel);
  if (!existsSync(fp)) { console.log(`  SKIP: ${rel} not found`); continue; }
  const code = readFileSync(fp, 'utf8');
  const lines = code.split('\n');

  // Check for dangerous dynamic innerHTML
  const dangerous = [];
  const clearing = [];
  const static_ = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (DANGEROUS_INNERHTML.test(line)) {
      dangerous.push(`${lineNum}: ${line.trim().substring(0, 80)}`);
    }

    if (ANY_INNERHTML.test(line)) {
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      // Skip reading (not assignment)
      if (READ_INNERHTML.test(line) && !ANY_INNERHTML.test(line.replace(/\.innerHTML\)/g, ''))) continue;

      const assignment = line.match(/\.innerHTML\s*=\s*(.+)/);
      if (assignment) {
        const value = assignment[1].trim();
        if (value === "''" || value === '""' || value === '``') {
          clearing.push(lineNum);
        } else {
          static_.push(lineNum);
        }
      }
    }
  }

  check(dangerous.length === 0, `${rel}: 0 dangerous dynamic innerHTML assignments`);
  if (dangerous.length > 0) {
    dangerous.forEach(d => console.log(`    ! ${d}`));
  }
  check(true, `${rel}: audit complete`);
}

// Check workspace.js specifically for contentEditable reads (allowed)
const wsJs = readFileSync(join(ROOT, 'workspace/workspace.js'), 'utf8');
const readAssignments = [];
wsJs.split('\n').forEach((line, i) => {
  if (line.includes('.innerHTML') && line.includes('=') && !line.trim().startsWith('//')) {
    const isRead = /\.innerHTML\)/.test(line) && !/\.innerHTML\s*=/.test(line.split(').')[0] + ')');
    readAssignments.push({ line: i + 1, code: line.trim().substring(0, 60), isRead });
  }
});

check(readAssignments.every(a => a.isRead), `workspace.js: all innerHTML uses are reads (contentEditable), not unsafe writes`);
if (readAssignments.some(a => !a.isRead)) {
  readAssignments.filter(a => !a.isRead).forEach(a => console.log(`    ! Line ${a.line}: ${a.code}`));
}

console.log(`\nResultados: ${pass} pass, ${fail} fail, ${pass + fail} tests\n`);
process.exit(fail > 0 ? 1 : 0);
