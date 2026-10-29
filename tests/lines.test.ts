/**
 * Regression tests for line geometry (H1).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  absoluteBounds,
  canonicalLine,
  marqueeHits,
  moveLineEnd,
  pageBounds,
  pageToSvg,
  vectorBounds,
} from '../src/utils';
import type { DesignObject, DocPage } from '../src/types';

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${msg} (got ${a}, want ${b})`);
}

/** Endpoints of a line object as a sorted pair, for segment-equality checks. */
function endpoints(o: { x: number; y: number; w: number; h: number }): string {
  const pts = [
    [o.x, o.y],
    [o.x + o.w, o.y + o.h],
  ].sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]));
  return JSON.stringify(pts);
}

function mkLine(id: string, x: number, y: number, w: number, h: number): DesignObject {
  return {
    id, type: 'line', name: id, parentId: null, x, y, w, h,
    rotation: 0, visible: true, locked: false, opacity: 1,
    fill: '', fillOpacity: 1, stroke: '#111111', strokeWidth: 2,
    cornerRadius: 0, clip: false, text: '', fontFamily: 'sans',
    fontSize: 16, fontWeight: 400, textAlign: 'left', lineHeight: 1.4,
  };
}

function mkFrame(id: string, x: number, y: number, w: number, h: number): DesignObject {
  return { ...mkLine(id, x, y, w, h), type: 'frame', name: id, fill: '#FFFFFF' };
}

/* ---------- drawing: all four drag directions ---------- */

test('draw diagonal right-down keeps vector', () => {
  assertEq(canonicalLine(10, 20, 110, 70), { x: 10, y: 20, w: 100, h: 50 }, 'geometry');
});

test('draw diagonal right-up preserves / direction (negative h)', () => {
  assertEq(canonicalLine(10, 70, 110, 20), { x: 10, y: 70, w: 100, h: -50 }, 'geometry');
});

test('draw diagonal left-down swaps to the same canonical segment', () => {
  const g = canonicalLine(110, 20, 10, 70);
  assertEq(g, { x: 10, y: 70, w: 100, h: -50 }, 'geometry');
  assertEq(endpoints(g), endpoints({ x: 110, y: 20, w: -100, h: 50 }), 'segment preserved');
});

test('draw diagonal left-up swaps to the same canonical segment', () => {
  const g = canonicalLine(110, 70, 10, 20);
  assertEq(g, { x: 10, y: 20, w: 100, h: 50 }, 'geometry');
  assertEq(endpoints(g), endpoints({ x: 110, y: 70, w: -100, h: -50 }), 'segment preserved');
});

test('horizontal lines identical in both drag directions', () => {
  assertEq(canonicalLine(0, 5, 100, 5), { x: 0, y: 5, w: 100, h: 0 }, 'left-to-right');
  assertEq(canonicalLine(100, 5, 0, 5), { x: 0, y: 5, w: 100, h: 0 }, 'right-to-left');
});

test('vertical lines identical in both drag directions', () => {
  assertEq(canonicalLine(5, 0, 5, 100), { x: 5, y: 0, w: 0, h: 100 }, 'top-to-bottom');
  assertEq(canonicalLine(5, 100, 5, 0), { x: 5, y: 0, w: 0, h: 100 }, 'bottom-to-top');
});

/* ---------- line-end drags, including crossing the other end ---------- */

test('line-end drag without crossing extends the line', () => {
  assertEq(
    moveLineEnd({ x: 0, y: 0, w: 100, h: 50 }, 1, 10, 10),
    { x: 0, y: 0, w: 110, h: 60 },
    'geometry',
  );
});

test('line-end drag past the other end follows the dragged point (horizontal)', () => {
  const g = moveLineEnd({ x: 0, y: 0, w: 100, h: 0 }, 0, 150, 0);
  assertEq(g, { x: 100, y: 0, w: 50, h: 0 }, 'geometry');
  assertEq(endpoints(g), '[[100,0],[150,0]]', 'segment follows dragged endpoint');
});

test('line-end drag past the other end keeps the true segment (diagonal)', () => {
  // Line (10,70)-(110,20); drag end 1 by (-150,+80) to (-40,100).
  const g = moveLineEnd({ x: 10, y: 70, w: 100, h: -50 }, 1, -150, 80);
  assertEq(g, { x: -40, y: 100, w: 50, h: -30 }, 'geometry');
  assertEq(endpoints(g), '[[-40,100],[10,70]]', 'segment follows dragged endpoint');
});

test('line-end drag onto the other end collapses to a valid point', () => {
  assertEq(
    moveLineEnd({ x: 0, y: 0, w: 100, h: 0 }, 1, -100, 0),
    { x: 0, y: 0, w: 0, h: 0 },
    'geometry',
  );
});

/* ---------- geometric bounds consumers ---------- */

test('vectorBounds handles negative dims (incl. legacy negative w)', () => {
  assertEq(vectorBounds(100, -50), { x: 0, y: -50, w: 100, h: 50 }, 'negative h');
  assertEq(vectorBounds(-30, 20), { x: -30, y: 0, w: 30, h: 20 }, 'negative w');
  assertEq(vectorBounds(100, 50), { x: 0, y: 0, w: 100, h: 50 }, 'positive');
});

test('absoluteBounds of upward diagonal covers the true box', () => {
  const line = mkLine('l', 10, 70, 100, -50);
  assertEq(absoluteBounds([line], line), { x: 10, y: 20, w: 100, h: 50 }, 'bounds');
});

test('absoluteBounds works for lines nested in frames', () => {
  const frame = mkFrame('f', 100, 100, 400, 400);
  const line = { ...mkLine('l', 10, 70, 100, -50), parentId: 'f' };
  assertEq(absoluteBounds([frame, line], line), { x: 110, y: 120, w: 100, h: 50 }, 'bounds');
});

test('pageBounds includes upward diagonals', () => {
  const line = mkLine('l', 10, 70, 100, -50);
  assertEq(pageBounds([line]), { x: 10, y: 20, w: 100, h: 50 }, 'bounds');
});

test('marqueeHits finds negative-h lines and skips hidden/locked', () => {
  const line = mkLine('hit', 10, 70, 100, -50);
  const hidden = { ...mkLine('hidden', 10, 70, 100, -50), visible: false };
  const locked = { ...mkLine('locked', 10, 70, 100, -50), locked: true };
  const objects = [line, hidden, locked];
  assertEq(marqueeHits(objects, { x: 0, y: 0 }, { x: 120, y: 80 }), ['hit'], 'overlapping rect hits');
  assertEq(marqueeHits(objects, { x: 0, y: 0 }, { x: 5, y: 200 }), [], 'disjoint rect misses');
});

/* ---------- SVG export preserves diagonal direction ---------- */

function svgPage(lines: DesignObject[]): DocPage {
  return { id: 'p', name: 't', objects: lines };
}

test('SVG export preserves all four diagonal directions', () => {
  const svg = pageToSvg(
    svgPage([
      mkLine('a', 10, 20, 100, 50),
      mkLine('b', 10, 70, 100, -50),
      mkLine('c', 0, 5, 100, 0),
      mkLine('d', 5, 0, 0, 100),
    ]),
  );
  assert(svg.includes('x1="10" y1="20" x2="110" y2="70"'), 'down-right diagonal kept');
  assert(svg.includes('x1="10" y1="70" x2="110" y2="20"'), 'up-right diagonal kept');
  assert(svg.includes('x1="0" y1="5" x2="100" y2="5"'), 'horizontal kept');
  assert(svg.includes('x1="5" y1="0" x2="5" y2="100"'), 'vertical kept');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL LINE TESTS PASSED');
