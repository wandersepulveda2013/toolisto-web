import { createJobQueue } from './job-queue.js';
import { createWorkflowValidator } from './workflow-validator.js';
import { createExecutionResources } from './execution-resources.js';

export function createWorkflowEngine(registry, options = {}) {
  const validator = createWorkflowValidator(registry);
  const maxConcurrency = options.maxConcurrency || 2;
  const queue = createJobQueue({ maxConcurrency });
  const listeners = new Set();
  let state = 'idle';
  let workflowRef = null;
  let inputsRef = {};
  let results = {};
  let executionId = null;
  let generation = 0;
  let cancelled = false;
  let currentResources = null;
  const cancelledInputs = new Set();

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

  function copyResults() {
    return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { ...result }]));
  }

  function getResults() { return copyResults(); }

  async function run(workflow, inputs) {
    if (state === 'running' || state === 'queued') {
      throw new Error('Engine is already running');
    }

    if (currentResources) {
      try { currentResources.dispose(); } catch (_) { /* ignore */ }
    }
    generation++;
    const runGeneration = generation;
    cancelled = false;
    cancelledInputs.clear();
    executionId = 'exec-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    currentResources = createExecutionResources(executionId);
    workflowRef = workflow;
    inputsRef = inputs || {};
    results = {};
    state = 'validating';
    _notify({ type: 'state', state });

    const validation = validator.validateWorkflow(workflow, inputs);
    if (!validation.valid) {
      state = 'failed';
      _notify({ type: 'state', state, validation });
      currentResources.dispose();
      return { success: false, validation, results: {} };
    }

    state = 'queued';
    _notify({ type: 'state', state, validation });

    const inputIds = workflow.getInputIds ? workflow.getInputIds() : (workflow.inputIds || []);
    const steps = workflow.getActiveSteps ? workflow.getActiveSteps() : (workflow.steps || []).filter(s => s.enabled !== false);
    const finalOperation = steps.length ? registry.get(steps[steps.length - 1].operationId) : null;
    const batchTerminalStep = finalOperation?.batchTerminal ? steps[steps.length - 1] : null;
    const processingSteps = batchTerminalStep ? steps.slice(0, -1) : steps;

    const totalJobs = inputIds.length;
    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;

    state = 'running';
    _notify({ type: 'state', state, total: totalJobs });

    const jobPromises = inputIds.map((inputId, i) => {
      return new Promise((resolve) => {
        const addedId = queue.add({
          id: inputId,
          _onTerminated: (termStatus) => {
            if (termStatus === 'cancelled') {
              results[inputId] = results[inputId] || { status: 'cancelled' };
              cancelledCount++;
              _notify({ type: 'job-status', inputId, status: 'cancelled' });
              resolve();
            }
          },
          execute: async (jobCtx) => {
            if (runGeneration !== generation) { resolve(); return; }
            const inputData = inputsRef[inputId];
            if (!inputData) {
              results[inputId] = { error: 'Input not found: ' + inputId, status: 'failed' };
              failedCount++;
              _notify({ type: 'job-status', inputId, status: 'failed', error: 'Input not found' });
              resolve();
              return;
            }

            let currentData = inputData;
            let currentKind = currentData.kind || 'file';
            let stepIndex = 0;

            for (const step of processingSteps) {
              if (cancelled || cancelledInputs.has(inputId) || runGeneration !== generation) {
                results[inputId] = results[inputId] || { status: 'cancelled' };
                cancelledCount++;
                _notify({ type: 'job-status', inputId, status: 'cancelled' });
                resolve();
                return;
              }
              const op = registry.get(step.operationId);
              if (!op) {
                results[inputId] = { error: 'Operation not registered: ' + step.operationId, status: 'failed' };
                failedCount++;
                _notify({ type: 'job-status', inputId, status: 'failed', error: 'Operation not registered: ' + step.operationId });
                resolve();
                return;
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
                  signal: {
                    get cancelled() { return cancelled || cancelledInputs.has(inputId) || runGeneration !== generation; },
                  },
                  reportProgress: (pct, msg) => {
                    if (runGeneration !== generation) return;
                    _notify({ type: 'progress', inputId, stepIndex, percent: pct, message: msg, jobId: inputId + '-' + stepIndex });
                  },
                  reportMessage: (msg) => {
                    if (runGeneration !== generation) return;
                    _notify({ type: 'message', inputId, stepIndex, message: msg, jobId: inputId + '-' + stepIndex });
                  },
                  metadata: { inputId, stepIndex, executionId, generation: runGeneration },
                };

                const stepResult = await op.execute(context);

                if (cancelled || cancelledInputs.has(inputId) || runGeneration !== generation) {
                  results[inputId] = results[inputId] || { status: 'cancelled' };
                  cancelledCount++;
                  _notify({ type: 'job-status', inputId, status: 'cancelled' });
                  resolve();
                  return;
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
                if (runGeneration !== generation) { resolve(); return; }
                results[inputId] = { error: err.message || String(err), status: 'failed', step: stepIndex };
                failedCount++;
                _notify({ type: 'job-status', inputId, status: 'failed', error: err.message, step: stepIndex });
                resolve();
                return;
              }
            }

            results[inputId] = { data: currentData, status: 'completed', kind: currentKind, name: currentData.name || inputData.name || ('output-' + i), inputId };
            completedCount++;
            _notify({ type: 'job-status', inputId, status: 'completed' });
            resolve();
          },
        });
        if (addedId === false) {
          results[inputId] = { error: 'Queue destroyed', status: 'failed' };
          failedCount++;
          resolve();
        }
      });
    });

    await Promise.all(jobPromises);

    if (runGeneration !== generation) return { success: false, state: 'cancelled', results: copyResults(), validation };

    if (!cancelled && batchTerminalStep) {
      const completedItems = Object.values(results)
        .filter(result => result.status === 'completed')
        .map(result => ({ data: result.data, kind: result.kind, name: result.name, inputId: result.inputId }));
      try {
        const batchData = await finalOperation.execute({
          input: { kind: 'multiple', items: completedItems },
          options: batchTerminalStep.options || {},
          signal: { get cancelled() { return cancelled || runGeneration !== generation; } },
          reportProgress: (pct, msg) => _notify({ type: 'progress', inputId: '__batch__', stepIndex: steps.length - 1, percent: pct, message: msg, jobId: 'batch' }),
          reportMessage: (msg) => _notify({ type: 'message', inputId: '__batch__', stepIndex: steps.length - 1, message: msg, jobId: 'batch' }),
          metadata: { inputId: '__batch__', stepIndex: steps.length - 1, executionId, generation: runGeneration },
        });
        if (!cancelled && runGeneration === generation) {
          results.__batch__ = { data: batchData, status: 'completed', kind: finalOperation.outputKind, name: batchTerminalStep.options?.name || 'resultados.zip', inputId: '__batch__', isBatchOutput: true };
          _notify({ type: 'job-status', inputId: '__batch__', status: 'completed' });
        }
      } catch (err) {
        if (runGeneration !== generation) return { success: false, state: 'cancelled', results: copyResults(), validation };
        results.__batch__ = { error: err.message || String(err), status: 'failed', step: steps.length - 1, inputId: '__batch__', isBatchOutput: true };
        failedCount++;
        _notify({ type: 'job-status', inputId: '__batch__', status: 'failed', error: err.message, step: steps.length - 1 });
      }
    }

    if (runGeneration !== generation) {
      state = 'cancelled';
      return { success: false, state: 'cancelled', results: copyResults(), validation };
    }

    if (cancelled) {
      state = 'cancelled';
    } else if (failedCount > 0 && completedCount > 0) {
      state = 'completed_with_errors';
    } else if (failedCount > 0) {
      state = 'failed';
    } else {
      state = 'completed';
    }

    _notify({ type: 'state', state, completed: completedCount, failed: failedCount, cancelled: cancelledCount });

    if (state !== 'running' && state !== 'queued' && state !== 'cancelling') {
      currentResources.dispose();
    }

    return { success: state === 'completed' || state === 'completed_with_errors', state, results: copyResults(), validation };
  }

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    generation++;
    queue.cancelAll();
    if (currentResources) currentResources.dispose();
    if (state === 'running' || state === 'queued') {
      state = 'cancelling';
      _notify({ type: 'state', state: 'cancelling' });
    }
  }

  function cancelJob(inputId) {
    if (cancelledInputs.has(inputId)) return true;
    cancelledInputs.add(inputId);
    const entry = Object.keys(results).find(k => k === inputId);
    if (entry) {
      results[entry] = { status: 'cancelled' };
    }
    _notify({ type: 'job-status', inputId, status: 'cancelled' });
    queue.cancel(inputId);
    return true;
  }

  function retryFailed() {
    const failedIds = Object.entries(results)
      .filter(([, r]) => r.status === 'failed')
      .map(([id]) => id);
    if (failedIds.length === 0) return Promise.resolve({ success: true, state: 'completed', results: copyResults() });

    const retryWorkflow = workflowRef?.cloneWorkflow ? workflowRef.cloneWorkflow() : workflowRef;
    if (retryWorkflow && typeof retryWorkflow.setInputs === 'function') {
      retryWorkflow.setInputs(failedIds);
    }
    const retryInputs = {};
    for (const id of failedIds) {
      if (inputsRef[id]) retryInputs[id] = inputsRef[id];
    }
    generation++;
    const runGeneration = generation;
    cancelled = false;
    cancelledInputs.clear();
    executionId = 'exec-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    currentResources = createExecutionResources(executionId);
    state = 'queued';

    const inputIds = failedIds;
    const steps = retryWorkflow.getActiveSteps ? retryWorkflow.getActiveSteps() : (retryWorkflow.steps || []).filter(s => s.enabled !== false);
    const finalOp = steps.length ? registry.get(steps[steps.length - 1].operationId) : null;
    const batchStep = finalOp?.batchTerminal ? steps[steps.length - 1] : null;
    const procSteps = batchStep ? steps.slice(0, -1) : steps;

    const totalJobs = inputIds.length;
    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;

    state = 'running';
    _notify({ type: 'state', state, total: totalJobs });

    const jobPromises = inputIds.map((inputId, i) => {
      return new Promise((resolve) => {
        queue.add({
          id: inputId,
          _onTerminated: (termStatus) => {
            if (termStatus === 'cancelled') {
              cancelledCount++;
              _notify({ type: 'job-status', inputId, status: 'cancelled' });
              resolve();
            }
          },
          execute: async () => {
            if (runGeneration !== generation) { resolve(); return; }
            const inputData = retryInputs[inputId];
            if (!inputData) {
              results[inputId] = { error: 'Input not found: ' + inputId, status: 'failed' };
              failedCount++;
              _notify({ type: 'job-status', inputId, status: 'failed', error: 'Input not found' });
              resolve();
              return;
            }
            let currentData = inputData;
            let currentKind = currentData.kind || 'file';
            let stepIndex = 0;
            for (const step of procSteps) {
              if (cancelled || cancelledInputs.has(inputId) || runGeneration !== generation) {
                results[inputId] = results[inputId] || { status: 'cancelled' };
                cancelledCount++;
                _notify({ type: 'job-status', inputId, status: 'cancelled' });
                resolve();
                return;
              }
              const op = registry.get(step.operationId);
              if (!op) {
                results[inputId] = { error: 'Operation not registered: ' + step.operationId, status: 'failed' };
                failedCount++;
                _notify({ type: 'job-status', inputId, status: 'failed', error: 'Operation not registered: ' + step.operationId });
                resolve();
                return;
              }
              _notify({ type: 'step-start', inputId, stepIndex, operationName: op.name, jobId: inputId + '-' + stepIndex, total: totalJobs });
              try {
                const context = {
                  input: currentData,
                  options: step.options || {},
                  signal: { get cancelled() { return cancelled || cancelledInputs.has(inputId) || runGeneration !== generation; } },
                  reportProgress: (pct, msg) => {
                    if (runGeneration !== generation) return;
                    _notify({ type: 'progress', inputId, stepIndex, percent: pct, message: msg, jobId: inputId + '-' + stepIndex });
                  },
                  reportMessage: (msg) => {
                    if (runGeneration !== generation) return;
                    _notify({ type: 'message', inputId, stepIndex, message: msg, jobId: inputId + '-' + stepIndex });
                  },
                  metadata: { inputId, stepIndex, executionId, generation: runGeneration },
                };
                const stepResult = await op.execute(context);
                if (cancelled || cancelledInputs.has(inputId) || runGeneration !== generation) {
                  results[inputId] = results[inputId] || { status: 'cancelled' };
                  cancelledCount++;
                  _notify({ type: 'job-status', inputId, status: 'cancelled' });
                  resolve();
                  return;
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
                if (runGeneration !== generation) { resolve(); return; }
                results[inputId] = { error: err.message || String(err), status: 'failed', step: stepIndex };
                failedCount++;
                _notify({ type: 'job-status', inputId, status: 'failed', error: err.message, step: stepIndex });
                resolve();
                return;
              }
            }
            results[inputId] = { data: currentData, status: 'completed', kind: currentKind, name: currentData.name || inputData.name || ('output-' + i), inputId };
            completedCount++;
            _notify({ type: 'job-status', inputId, status: 'completed' });
            resolve();
          },
        });
      });
    });

    await Promise.all(jobPromises);

    if (runGeneration !== generation) return { success: false, state: 'cancelled', results: copyResults() };

    if (!cancelled && batchStep) {
      const completedItems = Object.values(results)
        .filter(r => r.status === 'completed')
        .map(r => ({ data: r.data, kind: r.kind, name: r.name, inputId: r.inputId }));
      try {
        const batchData = await finalOp.execute({
          input: { kind: 'multiple', items: completedItems },
          options: batchStep.options || {},
          signal: { get cancelled() { return cancelled || runGeneration !== generation; } },
          reportProgress: (pct, msg) => _notify({ type: 'progress', inputId: '__batch__', stepIndex: steps.length - 1, percent: pct, message: msg, jobId: 'batch' }),
          reportMessage: (msg) => _notify({ type: 'message', inputId: '__batch__', stepIndex: steps.length - 1, message: msg, jobId: 'batch' }),
          metadata: { inputId: '__batch__', stepIndex: steps.length - 1, executionId, generation: runGeneration },
        });
        if (!cancelled && runGeneration === generation) {
          results.__batch__ = { data: batchData, status: 'completed', kind: finalOp.outputKind, name: batchStep.options?.name || 'resultados.zip', inputId: '__batch__', isBatchOutput: true };
          _notify({ type: 'job-status', inputId: '__batch__', status: 'completed' });
        }
      } catch (err) {
        if (runGeneration !== generation) return { success: false, state: 'cancelled', results: copyResults() };
        results.__batch__ = { error: err.message || String(err), status: 'failed', step: steps.length - 1, inputId: '__batch__', isBatchOutput: true };
        failedCount++;
      }
    }

    if (runGeneration !== generation) {
      state = 'cancelled';
      return { success: false, state: 'cancelled', results: copyResults() };
    }

    if (cancelled) state = 'cancelled';
    else if (failedCount > 0 && completedCount > 0) state = 'completed_with_errors';
    else if (failedCount > 0) state = 'failed';
    else state = 'completed';

    _notify({ type: 'state', state, completed: completedCount, failed: failedCount, cancelled: cancelledCount });

    if (state !== 'running' && state !== 'queued' && state !== 'cancelling') {
      currentResources.dispose();
    }

    return { success: state === 'completed' || state === 'completed_with_errors', state, results: copyResults() };
  }

  function getSnapshot() {
    const completed = Object.values(results).filter(r => r.status === 'completed').length;
    const failed = Object.values(results).filter(r => r.status === 'failed').length;
    const cancelledCount = Object.values(results).filter(r => r.status === 'cancelled').length;
    return { state, completed, failed, cancelled: cancelledCount, total: completed + failed + cancelledCount, results: copyResults(), executionId, generation };
  }

  function destroy() {
    cancel();
    queue.destroy();
    if (currentResources) { currentResources.dispose(); currentResources = null; }
    listeners.clear();
  }

  function outputName(name, data) {
    if (typeof Blob === 'undefined' || !(data instanceof Blob) || !data.type.startsWith('image/')) return name;
    const extension = data.type === 'image/jpeg' ? 'jpg' : data.type === 'image/webp' ? 'webp' : data.type === 'image/png' ? 'png' : null;
    return extension ? String(name).replace(/\.[^.]+$/, '') + '.' + extension : name;
  }

  function getGeneration() { return generation; }

  return { run, cancel, cancelJob, retryFailed, subscribe, getState, getResults, getSnapshot, destroy, getGeneration };
}
