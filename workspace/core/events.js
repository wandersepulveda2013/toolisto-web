const eventBus = new Map();

function on(event, fn) {
  if (!eventBus.has(event)) eventBus.set(event, new Set());
  eventBus.get(event).add(fn);
  return () => eventBus.get(event).delete(fn);
}

function emit(event, data) {
  if (!eventBus.has(event)) return;
  for (const fn of eventBus.get(event)) {
    try { fn(data); } catch (e) { console.error(`Event ${event} error:`, e); }
  }
}

function once(event, fn) {
  const unsub = on(event, (data) => { unsub(); fn(data); });
  return unsub;
}

export { on, emit, once };
