export function createHistoryManager(options = {}) {
  const maxEntries = options.maxEntries || 50;
  const cloneState = options.cloneState || (s => JSON.parse(JSON.stringify(s)));
  const onChange = options.onChange || (() => {});
  const writeDebounce = options.writeDebounce || 600;

  let past = [];
  let future = [];
  let groupTimer = null;
  let grouped = false;

  function push(state, metadata) {
    const snapshot = cloneState(state);
    past.push({ state: snapshot, metadata: metadata || {}, timestamp: Date.now() });
    if (past.length > maxEntries) past.shift();
    future = [];
    grouped = false;
    clearTimeout(groupTimer);
    onChange({ canUndo: past.length > 1, canRedo: false, action: metadata?.action || 'push' });
  }

  function pushGrouped(state, metadata) {
    const snapshot = cloneState(state);
    if (grouped && past.length > 0) {
      past[past.length - 1] = { state: snapshot, metadata: metadata || past[past.length - 1].metadata, timestamp: Date.now() };
    } else {
      past.push({ state: snapshot, metadata: metadata || {}, timestamp: Date.now() });
      if (past.length > maxEntries) past.shift();
    }
    future = [];
    grouped = true;
    clearTimeout(groupTimer);
    groupTimer = setTimeout(() => { grouped = false; }, writeDebounce);
    onChange({ canUndo: past.length > 1, canRedo: false, action: metadata?.action || 'edit' });
  }

  function undo(currentState) {
    if (past.length < 2) return null;
    const current = cloneState(currentState);
    future.push({ state: current, metadata: past[past.length - 1].metadata, timestamp: Date.now() });
    const entry = past.pop();
    grouped = false;
    clearTimeout(groupTimer);
    onChange({ canUndo: past.length > 1, canRedo: future.length > 0, action: 'undo' });
    return entry.state;
  }

  function redo(currentState) {
    if (future.length === 0) return null;
    const current = cloneState(currentState);
    const entry = future.pop();
    past.push({ state: cloneState(entry.state), metadata: entry.metadata, timestamp: Date.now() });
    grouped = false;
    clearTimeout(groupTimer);
    onChange({ canUndo: past.length > 1, canRedo: future.length > 0, action: 'redo' });
    return entry.state;
  }

  function canUndo() { return past.length > 1; }
  function canRedo() { return future.length > 0; }

  function clear() {
    const last = past.length > 0 ? past[past.length - 1] : null;
    past = last ? [last] : [];
    future = [];
    grouped = false;
    clearTimeout(groupTimer);
    onChange({ canUndo: false, canRedo: false, action: 'clear' });
  }

  function getStatus() {
    return {
      pastSize: past.length,
      futureSize: future.length,
      canUndo: past.length > 1,
      canRedo: future.length > 0,
      grouped,
    };
  }

  function destroy() {
    clearTimeout(groupTimer);
    past = [];
    future = [];
    grouped = false;
  }

  return { push, pushGrouped, undo, redo, canUndo, canRedo, clear, getStatus, destroy };
}
