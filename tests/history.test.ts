/**
 * Regression tests for undo/redo history mechanics (M2/M3).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  HISTORY_LIMIT,
  abortTransientEntry,
  beginTransientEntry,
  commitDoc,
  endTransientEntry,
  redoHistory,
  setPresent,
  undoHistory,
} from '../src/history';
import type { HistoryState } from '../src/history';
import { patchDocObjects } from '../src/store';
import type { DesignObject, UndesignDoc } from '../src/types';

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name} — ${(e as Error).message}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function doc(tag: string): UndesignDoc {
  return {
    version: 1,
    name: tag,
    pages: [{ id: 'p', name: 'p', objects: [] }],
    activePageId: 'p',
    components: [],
    colorStyles: [],
    prototypeLinks: [],
    colorStyles: [],
  };
}

function state(tag: string): HistoryState {
  return { past: [], present: doc(tag), future: [] };
}

function textObj(id: string, text: string): DesignObject {
  return {
    id, type: 'text', name: id, parentId: null, x: 0, y: 0, w: 200, h: 20,
    rotation: 0, visible: true, locked: false, opacity: 1,
    fill: '#111111', fillOpacity: 1, fillGradient: null, fillStyleId: null, constraints: null, stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    componentId: null, sourceId: null, componentSnapshot: null, clip: false, text, fontFamily: 'sans',
    fontSize: 16, fontWeight: 400, textAlign: 'left', lineHeight: 1.4,
  };
}

function docWith(objects: DesignObject[]): UndesignDoc {
  return {
    version: 1,
    name: 't',
    pages: [{ id: 'p', name: 'p', objects }],
    activePageId: 'p',
    components: [],
    colorStyles: [],
    prototypeLinks: [],
    colorStyles: [],
  };
}

/* ---------- commit / present ---------- */

test('commit appends exactly one entry and clears redo', () => {
  const h0 = state('a');
  const h1 = commitDoc(h0, doc('b'));
  assert(h1.past.length === 1, `past grew by one (got ${h1.past.length})`);
  assert(h1.past[0] === h0.present, 'snapshot is the previous present');
  assert(h1.present.name === 'b', 'present is the new doc');
  const h2 = commitDoc({ ...h1, future: [doc('x')] }, doc('c'));
  assert(h2.future.length === 0, 'future cleared by new commit');
});

test('commit with identical reference is a no-op', () => {
  const h0 = state('a');
  assert(commitDoc(h0, h0.present) === h0, 'same state object returned');
});

test('setPresent replaces without pushing history', () => {
  const h0 = state('a');
  const h1 = setPresent(h0, doc('b'));
  assert(h1.past.length === 0, 'no entry pushed');
  assert(h1.present.name === 'b', 'present replaced');
  assert(h1.future === h0.future, 'future untouched');
  assert(setPresent(h0, h0.present) === h0, 'identical ref is a no-op');
});

test('history is capped at the limit', () => {
  let h = state('v0');
  for (let i = 1; i <= HISTORY_LIMIT + 10; i++) {
    h = commitDoc(h, doc(`v${i}`));
  }
  assert(h.past.length === HISTORY_LIMIT, `past capped (got ${h.past.length})`);
  assert(h.past[0].name === 'v10', `oldest entries dropped (got ${h.past[0].name})`);
  assert(h.present.name === `v${HISTORY_LIMIT + 10}`, 'present is latest');
});

/* ---------- transient sessions: one entry per interaction ---------- */

test('draw session yields exactly one undo step (M2)', () => {
  const h0 = state('empty');
  let h = beginTransientEntry(h0); // pointerdown
  h = setPresent(h, doc('with-object-2x2')); // insert
  h = setPresent(h, doc('with-object-100x80')); // drag resizes
  h = setPresent(h, doc('with-object-160x120')); // pointerup size
  assert(h.past.length === 1, `one entry (got ${h.past.length})`);
  assert(h.past[0] === h0.present, 'entry restores pre-draw state');
  const undone = undoHistory(h);
  assert(undone.present === h0.present, 'single undo removes the object');
});

test('text session collapses keystrokes into one undo step (M3)', () => {
  const h0 = state('h');
  let h = beginTransientEntry(h0); // first keystroke auto-begins
  for (const t of ['he', 'hel', 'hell', 'hello']) {
    h = setPresent(h, doc(t));
  }
  assert(h.past.length === 1, `one entry (got ${h.past.length})`);
  assert(undoHistory(h).present === h0.present, 'single undo restores original');
  assert(redoHistory(undoHistory(h)).present.name === 'hello', 'redo restores final');
});

test('slider session collapses ticks into one undo step (M3)', () => {
  const h0 = state('opaque');
  let h = beginTransientEntry(h0);
  for (let i = 0; i < 10; i++) {
    h = setPresent(h, doc(`tick-${i}`));
  }
  assert(h.past.length === 1, `one entry (got ${h.past.length})`);
  assert(undoHistory(h).present === h0.present, 'single undo restores original');
});

test('consecutive sessions stack as separate entries', () => {
  const h0 = state('v0');
  const h1 = setPresent(beginTransientEntry(h0), doc('v1'));
  const h2 = setPresent(beginTransientEntry(h1), doc('v2'));
  assert(h2.past.length === 2, `two entries (got ${h2.past.length})`);
  assert(undoHistory(undoHistory(h2)).present === h0.present, 'two undos restore original');
});

/* ---------- abort / cancel ---------- */

test('abort restores the pre-session state with no trace', () => {
  const h0 = state('orig');
  let h = beginTransientEntry(h0);
  h = setPresent(h, doc('draft-1'));
  h = setPresent(h, doc('draft-2'));
  const aborted = abortTransientEntry(h);
  assert(aborted.present === h0.present, 'present restored by reference');
  assert(aborted.past.length === 0, 'begin snapshot popped, no phantom entry');
  assert(aborted.future.length === 0, 'future preserved');
});

test('abort keeps a pre-existing future intact', () => {
  const h0: HistoryState = { past: [], present: doc('a'), future: [doc('redo-me')] };
  const h1 = beginTransientEntry(h0);
  assert(h1.future.length === 0, 'begin clears future like a new edit');
  const h2 = { ...setPresent(h1, doc('b')), future: [doc('redo-me')] };
  const aborted = abortTransientEntry(h2);
  assert(aborted.future.length === 1, 'abort does not touch future');
});

test('abort with empty past is a no-op', () => {
  const h0 = state('a');
  assert(abortTransientEntry(h0) === h0, 'same state object returned');
});

/* ---------- undo/redo never lose confirmed changes ---------- */

test('undo/redo walk preserves every confirmed state', () => {
  const h0 = state('v0');
  const h1 = commitDoc(h0, doc('v1'));
  const h2 = commitDoc(h1, doc('v2'));
  const h3 = commitDoc(h2, doc('v3'));
  const u1 = undoHistory(h3);
  const u2 = undoHistory(u1);
  const u3 = undoHistory(u2);
  assert(u1.present.name === 'v2', 'undo 1');
  assert(u2.present.name === 'v1', 'undo 2');
  assert(u3.present === h0.present, 'undo 3 reaches initial');
  assert(undoHistory(u3) === u3, 'undo at bottom is a no-op');
  const r1 = redoHistory(u3);
  const r2 = redoHistory(r1);
  const r3 = redoHistory(r2);
  assert(r3.present === h3.present, 'redo walk reaches final');
  assert(redoHistory(r3) === r3, 'redo at top is a no-op');
});

test('new commit after undo branches without losing reachable states', () => {
  const h0 = state('v0');
  const h2 = commitDoc(commitDoc(h0, doc('v1')), doc('v2'));
  const undone = undoHistory(h2);
  assert(undone.present.name === 'v1', 'undo reaches v1');
  const branched = commitDoc(undone, doc('v3'));
  assert(branched.future.length === 0, 'stale redo cleared');
  assert(branched.present.name === 'v3', 'present is the new commit');
  assert(undoHistory(branched).present.name === 'v1', 'prior confirmed state intact');
});

/* ---------- object patch application ---------- */

test('patchDocObjects patches only targeted ids', () => {
  const a = textObj('a', 'A');
  const b = textObj('b', 'B');
  const d = docWith([a, b]);
  const next = patchDocObjects(d, ['b'], { text: 'B2' });
  assert(next !== d, 'new doc object');
  assert(next.pages[0].objects[0] === a, 'untargeted object shared');
  assert(next.pages[0].objects[1].text === 'B2', 'targeted object patched');
  assert(next.pages[0].objects[1].id === 'b', 'identity kept');
});

test('patchDocObjects auto-grows text height unless h is explicit', () => {
  const d = docWith([textObj('a', 'one')]);
  const grown = patchDocObjects(d, ['a'], { text: 'one\ntwo\nthree' });
  assert(grown.pages[0].objects[0].h === 3 * 16 * 1.4, `height grew (got ${grown.pages[0].objects[0].h})`);
  const explicit = patchDocObjects(d, ['a'], { text: 'one\ntwo\nthree', h: 99 });
  assert(explicit.pages[0].objects[0].h === 99, 'explicit h respected');
});

test('patchDocObjects leaves other pages shared', () => {
  const d: UndesignDoc = {
    version: 1,
    name: 't',
    pages: [
      { id: 'p1', name: 'p1', objects: [textObj('a', 'A')] },
      { id: 'p2', name: 'p2', objects: [textObj('b', 'B')] },
    ],
    activePageId: 'p1',
    components: [],
    colorStyles: [],
    prototypeLinks: [],
    colorStyles: [],
  };
  const next = patchDocObjects(d, ['a', 'b'], { text: 'X' });
  assert(next.pages[1] === d.pages[1], 'inactive page untouched');
  assert(next.pages[1].objects[0].text === 'B', 'inactive objects untouched');
  assert(next.pages[0].objects[0].text === 'X', 'active page patched');
});

test('undo during a transient session discards the session, then undoes', () => {
  // past=[A], present=B (confirmed); a drag session opens on B and moves to B'.
  let h = state('A');
  h = commitDoc(h, doc('B'));
  h = beginTransientEntry(h);
  h = setPresent(h, doc("B'"));
  // Store-level undo composes abort + undo: the in-progress B' must not
  // land in the redo stack, and present must return to A.
  h = undoHistory(abortTransientEntry(h));
  assert(h.present.name === 'A', `present reverted to A (got ${h.present.name})`);
  assert(h.past.length === 0, 'past consumed');
  assert(h.future.length === 1 && h.future[0].name === 'B', 'redo holds B, not the session draft');
});

test('redo during a transient session discards the session', () => {
  let h = state('A');
  h = commitDoc(h, doc('B'));
  h = undoHistory(h); // past=[], present=A, future=[B]
  h = beginTransientEntry(h); // starting a session clears redo, like any new edit
  h = setPresent(h, doc("A'"));
  h = redoHistory(abortTransientEntry(h));
  assert(h.present.name === 'A', `session draft discarded (got ${h.present.name})`);
  assert(h.future.length === 0, 'redo stays empty: the session cleared it at begin');
});

/* ---------- untouched transient sessions leave no entry ---------- */

test('endTransientEntry pops an untouched session', () => {
  const h0 = state('a');
  const begun = beginTransientEntry(h0);
  assert(begun.past.length === 1, 'begin pushes a snapshot');
  const ended = endTransientEntry(begun);
  assert(ended.past.length === 0, 'snapshot popped, no phantom entry');
  assert(ended.present === h0.present, 'present kept by reference');
});

test('endTransientEntry keeps a session that ran ticks', () => {
  const h0 = state('a');
  const begun = beginTransientEntry(h0);
  const ticked = setPresent(begun, doc('b'));
  const ended = endTransientEntry(ticked);
  assert(ended.past.length === 1, 'single entry kept');
  assert(undoHistory(ended).present === h0.present, 'undo restores pre-session state');
});

test('endTransientEntry with empty past is a no-op', () => {
  const h0 = state('a');
  assert(endTransientEntry(h0) === h0, 'same state object returned');
});

/* ---------- no-op commits leave history untouched ---------- */

test('commit with a value-identical doc is a no-op', () => {
  const h0 = state('a');
  const clone = JSON.parse(JSON.stringify(h0.present)) as UndesignDoc;
  assert(clone !== h0.present, 'clone is a distinct reference');
  const h1 = commitDoc(h0, clone);
  assert(h1 === h0, 'same state object returned');
  assert(h1.past.length === 0, 'no phantom entry');
});

test('commit with a nested change still pushes exactly one entry', () => {
  const d = docWith([textObj('a', 'A')]);
  const h0: HistoryState = { past: [], present: d, future: [] };
  const next = docWith([{ ...textObj('a', 'A'), x: 7 }]);
  const h1 = commitDoc(h0, next);
  assert(h1.past.length === 1, 'one entry pushed');
  assert(h1.past[0] === d, 'snapshot is the previous present');
  assert(undoHistory(h1).present === d, 'undo restores original');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL HISTORY TESTS PASSED');
