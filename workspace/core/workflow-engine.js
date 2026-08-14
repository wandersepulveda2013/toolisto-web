import { createJobQueue } from './job-queue.js';
import { createWorkflowValidator } from './workflow-validator.js';

export function createWorkflowEngine(registry, options = {}) {
  const validator = createWorkflowValidator(registry);
  const queue = createJobQueue({ maxConcurrency: options.maxConcurrency || 2 });
  const listeners = new Set();
  let state = 'idle';
  let workflowRef = null;
  let inputsRef = {};
  let results = {};
  let executionId = null;
  let cancelled = false;
  const tempUrls = [];

  function _notify(event) {
    for (const fn of listeners) {
      try { fn(event); } catch (e) { console.warn('[workflow-engine] listener error:', e); }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getState() { return state; }

  // Los resultados pueden contener Blob. JSON los convierte en objetos vacíos y
  // hacía imposible descargar una salida real desde la interfaz del flujo.
  function copyResults() {
    return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { ...result }]));
  }

  function getResults() { return copyResults(); }

  function _makeTempUrl(blob) {
    const url = URL.createObjectURL(blob);
    tempUrls.push(url);
    return url;
  }

  function _cleanupUrls() {
    for (const url of tempUrls) {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }
    tempUrls.length = 0;
  }

  async function run(workflow, inputs, runOptions = {}) {
    if (state === 'running' || state === 'queued') {
      throw new Error('Engine is already running');
    }
    cancelled = false;
    executionId = 'exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    workflowRef = workflow;
    inputsRef = inputs || {};
    results = {};
    state = 'validating';
    _notify({ type: 'state', state });

    const validation = validator.validateWorkflow(workflow, inputs);
    if (!validation.valid) {
      state = 'failed';
      _notify({ type: 'state', state, validation });
      return { success: false, validation, results: {} };
    }

    state = 'queued';
    _notify({ type: 'state', state, validation });

    const inputIds = workflow.getInputIds ? workflow.getInputIds() : (workflow.inputIds || []);
    const steps = workflow.getActiveSteps ? workflow.getActiveSteps() : (workflow.steps || []).filter(s => s.enabled !== false);
    const finalOperation = steps.length ? registry.get(steps[steps.length - 1].operationId) : null;
    // Las operaciones terminales de lote reciben todas las salidas transformadas
    // una sola vez (por ejemplo, empaquetar imágenes en un ZIP).
    const batchTerminalStep = finalOperation?.batchTerminal ? steps[steps.length - 1] : null;
    const processingSteps = batchTerminalStep ? steps.slice(0, -1) : steps;

    const totalJobs = inputIds.length;
    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;

    state = 'running';
    _notify({ type: 'state', state, total: totalJobs });

    for (let i = 0; i < inputIds.length; i++) {
      if (cancelled) break;
      const inputId = inputIds[i];
      const inputData = inputsRef[inputId];
      if (!inputData) {
        results[inputId] = { error: 'Input not found: ' + inputId, status: 'failed' };
        failedCount++;
        _notify({ type: 'job-status', inputId, status: 'failed', error: 'Input not found' });
        continue;
      }

      let currentData = inputData;
      let currentKind = currentData.kind || 'file';
      let stepIndex = 0;

      for (const step of processingSteps) {
        if (cancelled) break;
        const op = registry.get(step.operationId);
        if (!op) {
          results[inputId] = { error: 'Operation not registered: ' + step.operationId, status: 'failed' };
          failedCount++;
          break;
        }

        _notify({
          type: 'step-start', inputId, stepIndex,
          operationName: op.name,
          jobId: inputId + '-' + stepIndex,
          total: totalJobs,
        });

        try {
          const context = {
            input: currentData,
            options: step.options || {},
            signal: { get cancelled() { return cancelled; } },
            reportProgress: (pct, msg) => {
              _notify({ type: 'progress', inputId, stepIndex, percent: pct, message: msg, jobId: inputId + '-' + stepIndex });
            },
            reportMessage: (msg) => {
              _notify({ type: 'message', inputId, stepIndex, message: msg, jobId: inputId + '-' + stepIndex });
            },
            makeTempUrl: _makeTempUrl,
            metadata: { inputId, stepIndex, executionId },
          };

          const stepResult = await op.execute(context);

          if (cancelled) {
            results[inputId] = { status: 'cancelled' };
            cancelledCount++;
            break;
          }

          if (stepResult && stepResult._multiple) {
            currentData = stepResult;
            currentKind = 'multiple';
          } else {
            currentData = { data: stepResult, kind: op.outputKind || currentKind, name: outputName(inputData.name || 'output', stepResult) };
            currentKind = op.outputKind || currentKind;
          }
          stepIndex++;
        } catch (err) {
          results[inputId] = { error: err.message || String(err), status: 'failed', step: stepIndex };
          failedCount++;
          _notify({ type: 'job-status', inputId, status: 'failed', error: err.message, step: stepIndex });
          break;
        }
      }

      if (!results[inputId] || results[inputId].status !== 'failed') {
        if (!cancelled) {
          results[inputId] = { data: currentData, status: 'completed', kind: currentKind, name: currentData.name || inputData.name || ('output-' + i), inputId };
          completedCount++;
          _notify({ type: 'job-status', inputId, status: 'completed' });
        } else {
          results[inputId] = { status: 'cancelled' };
          cancelledCount++;
        }
      }
    }

    if (!cancelled && batchTerminalStep) {
      const completedItems = Object.values(results)
        .filter(result => result.status === 'completed')
        .map(result => ({ data: result.data, kind: result.kind, name: result.name, inputId: result.inputId }));
      try {
        const batchData = await finalOperation.execute({
          input: { kind: 'multiple', items: completedItems },
          options: batchTerminalStep.options || {},
          signal: { get cancelled() { return cancelled; } },
          reportProgress: (pct, msg) => _notify({ type: 'progress', inputId: '__batch__', stepIndex: steps.length - 1, percent: pct, message: msg, jobId: 'batch' }),
          reportMessage: (msg) => _notify({ type: 'message', inputId: '__batch__', stepIndex: steps.length - 1, message: msg, jobId: 'batch' }),
          makeTempUrl: _makeTempUrl,
          metadata: { inputId: '__batch__', stepIndex: steps.length - 1, executionId },
        });
        if (!cancelled) {
          results.__batch__ = { data: batchData, status: 'completed', kind: finalOperation.outputKind, name: batchTerminalStep.options?.name || 'resultados.zip', inputId: '__batch__', isBatchOutput: true };
          _notify({ type: 'job-status', inputId: '__batch__', status: 'completed' });
        }
      } catch (err) {
        results.__batch__ = { error: err.message || String(err), status: 'failed', step: steps.length - 1, inputId: '__batch__', isBatchOutput: true };
        failedCount++;
        _notify({ type: 'job-status', inputId: '__batch__', status: 'failed', error: err.message, step: steps.length - 1 });
      }
    }

    if (cancelled) {
      state = 'cancelled';
      _notify({ type: 'state', state, completed: completedCount, failed: failedCount, cancelled: cancelledCount });
    } else if (failedCount > 0 && completedCount > 0) {
      state = 'completed_with_errors';
      _notify({ type: 'state', state, completed: completedCount, failed: failedCount, cancelled: cancelledCount });
    } else if (failedCount > 0) {
      state = 'failed';
      _notify({ type: 'state', state, completed: completedCount, failed: failedCount, cancelled: cancelledCount });
    } else {
      state = 'completed';
      _notify({ type: 'state', state, completed: completedCount, failed: failedCount, cancelled: cancelledCount });
    }

    return { success: state === 'completed' || state === 'completed_with_errors', state, results: copyResults(), validation };
  }

  function cancel() {
    cancelled = true;
    queue.cancelAll();
    _cleanupUrls();
    if (state === 'running' || state === 'queued') {
      state = 'cancelling';
      _notify({ type: 'state', state: 'cancelling' });
    }
  }

  function cancelJob(inputId) {
    const jobId = Object.keys(results).find(k => k === inputId);
    if (jobId) {
      results[jobId] = { status: 'cancelled' };
      _notify({ type: 'job-status', inputId, status: 'cancelled' });
    }
  }

  function retryFailed() {
    const failedIds = Object.entries(results).filter(([, r]) => r.status === 'failed').map(([id]) => id);
    if (failedIds.length === 0) return;
    const workflow = workflowRef;
    const inputs = inputsRef;
    state = 'idle';
    _notify({ type: 'state', state: 'idle' });
    const filteredInputs = {};
    for (const id of failedIds) {
      if (inputs[id]) filteredInputs[id] = inputs[id];
    }
    const filteredWorkflow = workflow;
    if (filteredWorkflow && typeof filteredWorkflow.setInputs === 'function') {
      filteredWorkflow.setInputs(failedIds);
    }
    return run(filteredWorkflow, filteredInputs);
  }

  function getSnapshot() {
    const completed = Object.values(results).filter(r => r.status === 'completed').length;
    const failed = Object.values(results).filter(r => r.status === 'failed').length;
    const cancelledCount = Object.values(results).filter(r => r.status === 'cancelled').length;
    return { state, completed, failed, cancelled: cancelledCount, total: completed + failed + cancelledCount, results: copyResults(), executionId };
  }

  function destroy() {
    cancel();
    queue.destroy();
    _cleanupUrls();
    listeners.clear();
  }

  function outputName(name, data) {
    if (typeof Blob === 'undefined' || !(data instanceof Blob) || !data.type.startsWith('image/')) return name;
    const extension = data.type === 'image/jpeg' ? 'jpg' : data.type === 'image/webp' ? 'webp' : data.type === 'image/png' ? 'png' : null;
    return extension ? String(name).replace(/\.[^.]+$/, '') + '.' + extension : name;
  }

  return { run, cancel, cancelJob, retryFailed, subscribe, getState, getResults, getSnapshot, destroy };
}
