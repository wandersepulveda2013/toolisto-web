// AI_AUTONOMY/guard.js — Pure, VM-testable engine that decides whether a cycle
// is making VERIFIED progress or is narrating-in-a-loop. It is the structural
// (non-prompt) answer to "the model said 'Let me read the QUEUE' forever".
//
// Key idea: narration is not progress; execution is. The runner feeds this
// engine with two distinct signals per step:
//   - intent markers  : what the model SAYS it will do (e.g. a line of text).
//   - verified markers: an actual tool/side-effect that ran and changed state.
//
// The engine accumulates evidence and, when the ratio of intents to verified
// events is high across many steps with no real change, flags a NARRATION_LOOP
// so the runner can interrupt, change technique, and finally FAIL the cycle
// instead of letting it spin forever. It also exposes a repetition fingerprint
// (identical consecutive narration) and ordering checks (verified events must be
// interleaved with declared intents, not all intents then all verifications).

export const LOOP_LIMITS = Object.freeze({
  // Flag a loop when there are at least this many intents.
  minIntents: 6,
  // ... of which this many consecutive intents have no interleaved verified event.
  consecutiveIntentsWithoutVerified: 5,
  // Same (verbatim-normalized) narration repeated this many times in a row => stall.
  repetitionThreshold: 5,
  // If intents outnumber verified by at least this factor over the window => stall.
  ratioThreshold: 4,
  // Verified events required before we consider a cycle to have any real work at all.
  minVerifiedForMeaningful: 1,
});

// Normalize narration for repetition fingerprinting (case + whitespace + filler).
export function normalizeNarration(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,;:!?¿¡'"()\[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Classify a line of model output as an "intent" (declares action) vs noise.
// This is intentionally conservative: it only counts explicit action verbs in a
// declarative/committal phrasing that a real "I will implement X" produces.
const INTENT_VERBS = [
  'implemento', 'implementare', 'implementar', 'voy a',
  'creo', 'creare', 'creando', 'añado', 'anado', 'agrego', 'agregare',
  'refactorizo', 'refactorizare', 'corrijo', 'corrigo', 'arreglo', 'arreglare',
  'escribo', 'escribire', 'modifico', 'modificare', 'actualizo', 'actualizare',
  'hago', 'hare', 'voy a hacer', 'let me', 'i will', 'voy a leer', 'leere',
];

export function classifyIntent(text) {
  const n = normalizeNarration(text);
  if (!n) return false;
  return INTENT_VERBS.some((v) => n.includes(v));
}

// A verified marker is a short machine token (module/op) that a real tool call
// emitted after executing. The runner passes the actual tool name.
export function isVerifiedMarker(marker) {
  return typeof marker === 'string' && marker.length > 0 && marker.length <= 64;
}

export function createLoopDetector(opts = {}) {
  const limits = { ...LOOP_LIMITS, ...opts };
  const events = []; // ordered stream of {type:'intent'|'verified', token}
  let lastNarration = '';
  let repeatCount = 0;
  let loopTriggered = false;
  let loopReason = null;

  // Feed one narration line (model output).
  function onNarration(text) {
    if (loopTriggered) return;
    const n = normalizeNarration(text);
    const isIntent = classifyIntent(text);
    // Repetition is tracked per intent DECLARATION, even when other analysis
    // lines interleave: a recurring identical declared intent IS "I will do X"
    // forever. Separators (non-intent analysis) do not move lastNarration.
    if (isIntent) {
      if (n === lastNarration) {
        repeatCount += 1;
      } else {
        lastNarration = n;
        repeatCount = 1;
      }
    }
    // Push the stream: intent declarations and analysis lines. Non-intent lines
    // act as SEPARATORS for CONSECUTIVE_INTENTS (deliberation is not a machine
    // gun of adjacent unverified plans), but never as intents themselves.
    events.push({ type: isIntent ? 'intent' : 'narration', token: n });
    evaluate();
  }

  // Feed one verified marker (a real tool ran).
  function onVerified(marker) {
    events.push({ type: 'verified', token: marker });
    evaluate();
  }

  function evaluate() {
    // 1) Verbatim repetition: identical narration 5+ times => narration loop.
    if (repeatCount >= limits.repetitionThreshold) {
      loopTriggered = true;
      loopReason = 'REPETITION';
      return;
    }
    // 2) Consecutive intents with no interleaved verified event AND no analysis
    //    line between them. A run of adjacent "I will do X / I will do Y"
    //    declarations with no tool is a machine-gun of unverified plans; a
    //    deliberation that PAUSES to analyze between intents is NOT (the
    //    separator breaks the run). Repetition of the same intent is caught
    //    independently by arm 1 even across separators.
    let consec = 0;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type !== 'intent') break;
      consec += 1;
    }
    if (consec >= limits.consecutiveIntentsWithoutVerified) {
      loopTriggered = true;
      loopReason = 'CONSECUTIVE_INTENTS';
      return;
    }
    // 3) Ratio: intents >> verified over the whole window.
    const intents = events.filter((e) => e.type === 'intent').length;
    const verified = events.filter((e) => e.type === 'verified').length;
    if (
      intents >= limits.minIntents &&
      verified === 0 &&
      intents / 1 >= limits.ratioThreshold
    ) {
      loopTriggered = true;
      loopReason = 'RATIO_ZERO_VERIFIED';
      return;
    }
    // 4) Ordering anomaly: all intents come before any verified (a bug where the
    //    agent plans forever then executes at the very end). We only warn here;
    //    the runner handles the "plan but never act" branch.
  }

  function summary() {
    const intents = events.filter((e) => e.type === 'intent').length;
    const verified = events.filter((e) => e.type === 'verified').length;
    return {
      loopTriggered,
      loopReason,
      intents,
      verified,
      consecutiveIntentsWithoutVerified: (() => {
        let c = 0;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type !== 'intent') break;
          c += 1;
        }
        return c;
      })(),
      repeatCount,
    };
  }

  return { onNarration, onVerified, summary };
}

// Task value scoring (P0>P1>P2>P3 with tie-breaks for fit). Pure and testable.
// Higher = better candidate for the next cycle. Mirrors the mission's selection
// guidance while making it machine-decisive.
const PRIORITY_WEIGHT = { P0: 4, P1: 3, P2: 2, P3: 1 };
const STATE_PENALTY = { TODO: 0, DISCOVERED: -2, ACTIVE: -2, BLOCKED: -100, DEFERRED: -100, DONE: -1000 };

export function scoreTask(task) {
  const prio = PRIORITY_WEIGHT[task.priority] || 0;
  const state = STATE_PENALTY[task.state] ?? -50;
  // Product/goal fit: areas that feed the star-flow or harden reliability rank
  // higher; audit/discovery rank lower.
  const area = String(task.area || '').toLowerCase();
  let fit = 0;
  if (task.area === 'Flujo estrella') fit += 3;
  if (/fiabilidad|reliab|integridad|storage|persist/.test(area)) fit += 2;
  if (/rendimiento|performance/.test(area)) fit += 1;
  if (/audit|discovery|document/.test(area)) fit -= 1;
  return prio * 10 + state + fit;
}

// Pick the best next task from a list of {priority,state,area,id}.
export function pickNextTask(tasks) {
  const eligible = tasks.filter((t) => t.state === 'TODO');
  if (eligible.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const t of eligible) {
    const s = scoreTask(t);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best
    ? { ...best, score: bestScore }
    : null;
}

export default {
  LOOP_LIMITS,
  normalizeNarration,
  classifyIntent,
  isVerifiedMarker,
  createLoopDetector,
  scoreTask,
  pickNextTask,
};
