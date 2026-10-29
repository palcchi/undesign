import type { UndesignDoc } from './types';

export const HISTORY_LIMIT = 60;

export interface HistoryState {
  past: UndesignDoc[];
  present: UndesignDoc;
  future: UndesignDoc[];
}

/** Order-insensitive deep equality for JSON-shaped document values. */
function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => valueEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      if (!valueEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Push the current present and replace it; a new edit clears redo.
 * No-op commits (same reference, or a rebuilt but value-identical doc)
 * leave history untouched.
 */
export function commitDoc(h: HistoryState, next: UndesignDoc): HistoryState {
  if (next === h.present || valueEqual(next, h.present)) return h;
  return {
    past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present],
    present: next,
    future: [],
  };
}

/** Replace present without touching history (transient drags, page switches). */
export function setPresent(h: HistoryState, next: UndesignDoc): HistoryState {
  if (next === h.present) return h;
  return { ...h, present: next };
}

/**
 * Snapshot for a transient session (drag, draw, slider, typing). The matching
 * endTransient only flips a flag; abortTransientEntry pops this snapshot.
 */
export function beginTransientEntry(h: HistoryState): HistoryState {
  return {
    past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present],
    present: h.present,
    future: [],
  };
}

/**
 * End a transient session that ran at least one tick: nothing left to do.
 * Untouched sessions (ended without any tick, e.g. a handle click without
 * a drag) pop the begin snapshot instead of leaving a phantom undo step.
 */
export function endTransientEntry(h: HistoryState): HistoryState {
  if (h.past.length === 0) return h;
  if (h.present !== h.past[h.past.length - 1]) return h;
  return { past: h.past.slice(0, -1), present: h.present, future: h.future };
}

/** Cancel a transient session: restore the begin snapshot, leave no trace. */
export function abortTransientEntry(h: HistoryState): HistoryState {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: h.future,
  };
}

export function undoHistory(h: HistoryState): HistoryState {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redoHistory(h: HistoryState): HistoryState {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}
