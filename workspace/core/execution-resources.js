/**
 * core/execution-resources.js — Lightweight lifecycle tracker for workflow execution resources.
 *
 * Tracks object URLs, AbortControllers, and arbitrary dispose callbacks.
 * One instance per execution; dispose() is called on every terminal path
 * (success, failure, cancel, destroy, rerun, navigation, clearFlow).
 */
export function createExecutionResources(executionId) {
  const urls = [];
  const abortControllers = [];
  const disposers = [];
  let disposed = false;

  function trackUrl(url) {
    if (!disposed) urls.push(url);
    return url;
  }

  function trackAbortController(controller) {
    if (!disposed) abortControllers.push(controller);
    return controller;
  }

  function trackDispose(fn) {
    if (!disposed) disposers.push(fn);
    return fn;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    for (const url of urls) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }
    urls.length = 0;

    for (const ac of abortControllers) {
      try { if (!ac.signal.aborted) ac.abort(); } catch (_) { /* ignore */ }
    }
    abortControllers.length = 0;

    for (const fn of disposers) {
      try { fn(); } catch (_) { /* ignore */ }
    }
    disposers.length = 0;
  }

  return { executionId, trackUrl, trackAbortController, trackDispose, dispose, isDisposed: () => disposed };
}
