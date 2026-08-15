export function createJobQueue(options = {}) {
  const maxConcurrency = options.maxConcurrency || 2;
  const queue = [];
  let running = 0;
  let paused = false;
  let destroyed = false;
  const listeners = new Set();

  function _notify(event) {
    for (const fn of listeners) {
      try { fn(event); } catch (e) { console.warn('[job-queue] listener error:', e); }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function add(job) {
    if (destroyed) return false;
    if (typeof job === 'function') job = { execute: job };
    const entry = {
      id: job.id || 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      priority: job.priority || 0,
      exclusive: job.exclusive || false,
      execute: job.execute,
      context: job.context || {},
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      progress: null,
      cancelRequested: false,
    };
    queue.push(entry);
    _notify({ type: 'added', job: entry });
    _process();
    return entry.id;
  }

  function _process() {
    if (destroyed || paused || running >= maxConcurrency) return;
    if (queue.length === 0) return;

    let exclusiveRunning = false;
    for (const j of queue) {
      if (j.status === 'running' && j.exclusive) { exclusiveRunning = true; break; }
    }

    const idx = queue.findIndex(j => {
      if (j.status !== 'pending') return false;
      if (j.cancelRequested) return false;
      if (exclusiveRunning) return false;
      if (j.exclusive && running > 0) return false;
      return true;
    });
    if (idx === -1) return;

    const entry = queue[idx];
    entry.status = 'running';
    entry.startedAt = Date.now();
    running++;
    _notify({ type: 'started', job: entry });

    const cancelObj = { cancelled: false };
    entry._cancelFn = () => { cancelObj.cancelled = true; entry.cancelRequested = true; };

    Promise.resolve().then(async () => {
      try {
        const result = await entry.execute({
          signal: cancelObj,
          reportProgress: (pct, msg) => {
            entry.progress = { percent: pct, message: msg };
            _notify({ type: 'progress', job: entry });
          },
          context: entry.context,
        });
        if (cancelObj.cancelled) {
          entry.status = 'cancelled';
          entry.completedAt = Date.now();
          _notify({ type: 'cancelled', job: entry });
        } else {
          entry.result = result;
          entry.status = 'completed';
          entry.completedAt = Date.now();
          _notify({ type: 'completed', job: entry });
        }
      } catch (err) {
        if (cancelObj.cancelled || entry.cancelRequested) {
          entry.status = 'cancelled';
          _notify({ type: 'cancelled', job: entry });
        } else {
          entry.error = err.message || String(err);
          entry.status = 'failed';
          entry.completedAt = Date.now();
          _notify({ type: 'failed', job: entry, error: err });
        }
      }
    }).finally(() => {
      running--;
      entry.startedAt = null;
      // Remove from queue if completed/failed/cancelled (but keep for retry if failed)
      // We keep failed jobs for potential retry; completed/cancelled are cleaned up
      if (entry.status === 'completed' || entry.status === 'cancelled') {
        const rmIdx = queue.indexOf(entry);
        if (rmIdx !== -1) queue.splice(rmIdx, 1);
      }
      _process();
    });
  }

  function cancel(jobId) {
    const entry = queue.find(j => j.id === jobId);
    if (!entry) return false;
    if (entry.status === 'pending') {
      entry.status = 'cancelled';
      entry.completedAt = Date.now();
      _notify({ type: 'cancelled', job: entry });
      const rmIdx = queue.indexOf(entry);
      if (rmIdx !== -1) queue.splice(rmIdx, 1);
    } else if (entry.status === 'running') {
      entry.cancelRequested = true;
      if (entry._cancelFn) entry._cancelFn();
    }
    return true;
  }

  function cancelAll() {
    for (const entry of queue) {
      if (entry.status === 'pending') {
        entry.status = 'cancelled';
        entry.completedAt = Date.now();
        _notify({ type: 'cancelled', job: entry });
      } else if (entry.status === 'running') {
        entry.cancelRequested = true;
        if (entry._cancelFn) entry._cancelFn();
      }
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].status === 'cancelled') queue.splice(i, 1);
    }
    _process();
  }

  function pause() {
    paused = true;
    _notify({ type: 'paused' });
  }

  function resume() {
    paused = false;
    _notify({ type: 'resumed' });
    _process();
  }

  function retry(jobId) {
    const entry = queue.find(j => j.id === jobId);
    if (!entry) return false;
    if (entry.status !== 'failed') return false;
    entry.status = 'pending';
    entry.error = null;
    entry.result = null;
    entry.progress = null;
    entry.startedAt = null;
    entry.completedAt = null;
    entry.cancelRequested = false;
    _notify({ type: 'retry', job: entry });
    _process();
    return true;
  }

  function prioritize(jobId) {
    const entry = queue.find(j => j.id === jobId);
    if (!entry) return false;
    entry.priority = (entry.priority || 0) + 1;
    queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return true;
  }

  function getSnapshot() {
    const pending = queue.filter(j => j.status === 'pending');
    const runningJobs = queue.filter(j => j.status === 'running');
    const completed = queue.filter(j => j.status === 'completed');
    const failed = queue.filter(j => j.status === 'failed');
    const cancelled = queue.filter(j => j.status === 'cancelled');
    return {
      pending, running: runningJobs, completed, failed, cancelled,
      total: queue.length + completed.length + failed.length + cancelled.length,
      runningCount: runningJobs.length,
      pendingCount: pending.length,
      completedCount: completed.length,
      failedCount: failed.length,
      cancelledCount: cancelled.length,
      isPaused: paused,
    };
  }

  function destroy() {
    destroyed = true;
    cancelAll();
    listeners.clear();
  }

  function reset() {
    queue.length = 0;
    running = 0;
    paused = false;
    _notify({ type: 'reset' });
  }

  return {
    add, cancel, cancelAll, pause, resume, retry, prioritize,
    subscribe, getSnapshot, destroy, reset,
  };
}
