import type { UndesignDoc } from './types';

export const HISTORY_LIMIT = 60;

export interface HistoryState {
  past: UndesignDoc[];
  present: UndesignDoc;
  future: UndesignDoc[];
}

/** Push the current present and replace it; a new edit clears redo. */
export function commitDoc(h: HistoryState, next: UndesignDoc): HistoryState {
  if (next === h.present) return h;
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
