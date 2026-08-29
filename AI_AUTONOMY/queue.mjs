// AI_AUTONOMY/queue.js — Machine-readable queue mirror + value scoring for the
// autonomous runner.
//
// The authoritative backlog is the Markdown QUEUE (CONTINUOUS-EVOLUTION-QUEUE.md).
// This module gives the runner a structured, decisive view of it:
//   - A JSON mirror (queue.json) that the launcher can parse without regex over
//     Markdown tables.
//   - `pickNextTask` (from guard.js) returns the single best candidate by
//     priority + fit, breaking ties deterministically.
//   - `reconcile` merges the JSON mirror with the MD-derived table so the two
//     can't silently drift: any MD row missing from JSON is added; JSON entries
//     whose MD row disappeared are marked DONE_MISSING (warning, not error).
//
// Pure Node; testable.

export const VALID_STATES = Object.freeze([
  'TODO',
  'ACTIVE',
  'BLOCKED',
  'BLOCKED_FLAKY',
  'DONE',
  'DISCOVERED',
  'DEFERRED',
  'DONE_MISSING',
]);

export const VALID_PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

export function normalizeTask(t) {
  const id = String(t.id || '').trim();
  const priority = String(t.priority || 'P3').toUpperCase();
  const state = String(t.state || 'TODO').toUpperCase();
  return {
    id,
    priority: VALID_PRIORITIES.includes(priority) ? priority : 'P3',
    state: VALID_STATES.includes(state) ? state : 'TODO',
    area: String(t.area || ''),
    task: String(t.task || ''),
    note: String(t.note || ''),
  };
}

// Parse a Markdown QUEUE table (~the format used in CONTINUOUS-EVOLUTION-QUEUE.md)
// into task objects. Row: "| ID | Prioridad | Estado | Area | Tarea | Evidencia |"
// Returns tasks keyed by id plus any rows that failed to parse.
export function parseMarkdownQueue(md) {
  const tasks = {};
  const errors = [];
  for (const line of String(md || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const id = cells[0];
    if (!/^CE-\d+$/.test(id)) continue; // header/separator rows skip
    const priority = cells[1];
    const state = cells[2];
    const area = cells[3];
    const task = cells.slice(4).join(' | ');
    if (!VALID_PRIORITIES.includes(priority)) { errors.push(id); continue; }
    tasks[id] = normalizeTask({ id, priority, state, area, task });
  }
  return { tasks, errors };
}

// Reconcile a JSON mirror with MD-parsed tasks.
export function reconcile(jsonTasks, mdTasks) {
  const out = {};
  const added = [];
  const removedFlags = [];
  const mdIds = new Set(Object.keys(mdTasks));
  const jsonIds = new Set(Object.keys(jsonTasks));

  for (const id of mdIds) {
    out[id] = normalizeTask(mdTasks[id]);
  }
  for (const id of jsonIds) {
    if (mdIds.has(id)) continue; // already taken from MD (authority)
    // Present in JSON but not in MD: mark as DONE_MISSING warning.
    const st = normalizeTask({ ...jsonTasks[id], state: 'DONE_MISSING' });
    out[id] = st;
    removedFlags.push(id);
  }
  return { tasks: out, added, removedFlags };
}

export default {
  VALID_STATES,
  VALID_PRIORITIES,
  normalizeTask,
  parseMarkdownQueue,
  reconcile,
};
