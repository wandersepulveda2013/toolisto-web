import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\(').test(l) || new RegExp('^export function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

function sliceRegion(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) return '';
  const e = endMarker ? src.indexOf(endMarker, s) : src.length;
  return e < 0 ? src.slice(s) : src.slice(s, e);
}

const wsCode = readFileSync(new URL('../../workspace/workspace.js', import.meta.url), 'utf8');
const stCode = readFileSync(new URL('../../workspace/core/storage.js', import.meta.url), 'utf8');

console.log('=== CE-120: swallowed storage errors surface via reportError ===');

// 1. renderCaptureView now has the _viewGeneration guard (was missing, race with stale loadCaptures)
{
  const region = sliceRegion(wsCode, 'const viewGeneration = _viewGeneration;\n  loadCaptures(', '\n}\n\nfunction formatCaptureDeletionWarning');
  check('capture view reads _viewGeneration before loadCaptures', region.includes('const viewGeneration = _viewGeneration;'));
  check('capture view bails out on stale generation', region.includes('if (viewGeneration !== _viewGeneration) return;'));
  check('capture view catch reports error (not empty)', region.includes("catch(error => reportError(error, 'capture-list-load', {}))"));
  check('capture view no longer has empty catch', !region.includes('.catch(() => {});'));
}

// 2. renderDocumentsView catch reports error (guard already present)
{
  const region = sliceRegion(wsCode, 'loadDocs(project.id).then(d => {', '\n}\n\nconst BLOCK_TYPES');
  check('documents catch reports error', region.includes("catch(error => reportError(error, 'document-list-load', {}))"));
  check('documents no longer has empty catch', !region.includes('.catch(() => {});'));
}

// 3. renderDataView catch reports error (guard already present)
{
  const region = sliceRegion(wsCode, 'loadData(project.id).then(t => {', '\n}\n\nasync function renderModelView');
  check('data catch reports error', region.includes("catch(error => reportError(error, 'data-list-load', {}))"));
  check('data no longer has empty catch', !region.includes('.catch(() => {});'));
}

// 4. Modal confirm onConfirm error is reported and keeps modal open
{
  const region = sliceRegion(wsCode, '      if (opts.onConfirm) {', '      closeModal();');
  check('modal confirm catch reports error', region.includes('catch (e) { reportError(e, \'modal-confirm\''));
  check('modal confirm catch still returns (modal stays open)', region.includes('} catch (e) { reportError(e, \'modal-confirm\', { action: opts.confirmText || \'confirm\' }); return; }'));
  check('modal confirm no longer silently ignores', !region.includes('try { await opts.onConfirm(); } catch (e) { return; }'));
}

// 5. saveWorkspaceConfig reports localStorage write failure (behavioral test)
{
  const src = grabFn(wsCode, 'saveWorkspaceConfig');
  let reported = null;
  const calls = { setItem: null };
  const saveWorkspaceConfig = new Function('WORKSPACE_DEFAULTS', 'appStore', 'reportError', 'localStorage',
    src + '\nreturn saveWorkspaceConfig;')(
    { maxFileSizeMB: 50, maxTableRows: 10000 },
    { set: () => {} },
    (e, ctx) => { reported = ctx; },
    {
      setItem: (k, v) => { calls.setItem = { k, v }; if (String(v).includes('FORCE_FAIL')) throw new Error('QuotaExceededError'); },
    });
  const ok = saveWorkspaceConfig({ maxFileSizeMB: 50, maxTableRows: 10000 });
  check('saveWorkspaceConfig success writes and does not report', calls.setItem !== null && reported === null);
  check('saveWorkspaceConfig success returns merged config', ok.maxTableRows === 10000);
  reported = null;
  try {
    saveWorkspaceConfig({ maxFileSizeMB: 50, maxTableRows: 10000, FORCE_FAIL: true });
  } catch (e) { /* not expected to throw */ }
  check('saveWorkspaceConfig write failure is reported', reported === 'workspace-config-save');
}

// 6. storage.js deleteCapture no longer swallows refreshProjectCounts failure
{
  check('storage.js imports reportError', stCode.includes("import { reportError } from './error-manager.js';"));
  const region = sliceRegion(stCode, 'await refreshProjectCounts(', 'emit(\'capture:deleted\'');
  check('deleteCapture reports count refresh failure', region.includes("catch(error => reportError(error, 'capture-delete-counts'"));
  check('deleteCapture no longer has empty catch', !region.includes('.catch(() => {});'));
}

// 7. Anti-regression: all other empty storage catches in the 3 original views are gone
{
  const emptyCatches = (wsCode.match(/\.catch\(\(\) => \{\}\);/g) || []).length;
  check('workspace.js has no remaining empty .catch blocks (was 13)', emptyCatches === 0, 'found ' + emptyCatches);
}

// 8. Anti-regression: reportError context uses distinct stable keys
{
  check('capture-list-load key present exactly once', (wsCode.match(/capture-list-load/g) || []).length === 1);
  check('document-list-load key present exactly once', (wsCode.match(/document-list-load/g) || []).length === 1);
  check('data-list-load key present exactly once', (wsCode.match(/data-list-load/g) || []).length === 1);
  check('modal-confirm key present exactly once', (wsCode.match(/modal-confirm/g) || []).length === 1);
  check('workspace-config-save key present exactly once', (wsCode.match(/workspace-config-save/g) || []).length === 1);
  check('capture-delete-counts key present exactly once', (stCode.match(/capture-delete-counts/g) || []).length === 1);
}

console.log(`\n=== swallowed-storage-errors: ${pass}/${pass + fail} PASS ===`);
process.exit(fail > 0 ? 1 : 0);