/**
 * Regression tests for insertion placement (H3).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  centeredOrigin,
  placeRootsAtCenter,
  rootsOf,
  viewportCenterWorld,
} from '../src/utils';
import { commitDoc, redoHistory, undoHistory } from '../src/history';
import type { HistoryState } from '../src/history';
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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${msg} (got ${a}, want ${b})`);
}

function mkObj(partial: Partial<DesignObject> & { id: string }): DesignObject {
  return {
    type: 'rectangle',
    name: partial.id,
    parentId: null,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    fill: '#FFFFFF',
    fillOpacity: 1,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0,
    clip: false,
    text: '',
    fontFamily: 'sans',
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.4,
    ...partial,
  };
}

/* ---------- viewport center conversion ---------- */

test('viewportCenterWorld resolves the visible center', () => {
  assertEq(
    viewportCenterWorld({ zoom: 1, x: 0, y: 0 }, 1000, 800),
    { x: 500, y: 400 },
    'identity viewport',
  );
});

test('viewportCenterWorld honors pan and zoom', () => {
  // screen center (500,400) at zoom 2 with pan (-100,-50)
  assertEq(
    viewportCenterWorld({ zoom: 2, x: -100, y: -50 }, 1000, 800),
    { x: 300, y: 225 },
    'panned + zoomed',
  );
});

test('centeredOrigin centers a box on a target point', () => {
  assertEq(centeredOrigin(168, 48, { x: 500, y: 400 }), { x: 416, y: 376 }, 'even sizes');
  assertEq(centeredOrigin(160, 120, { x: 500, y: 400 }), { x: 420, y: 340 }, 'rect defaults');
});

/* ---------- root detection ---------- */

test('rootsOf returns only top-level members of a set', () => {
  const f = mkObj({ id: 'f', type: 'frame', w: 168, h: 48 });
  const a = mkObj({ id: 'a', type: 'text', parentId: 'f' });
  const g = mkObj({ id: 'g', parentId: 'a' });
  const r2 = mkObj({ id: 'r2', x: 300 });
  assertEq(
    rootsOf([f, a, g, r2]).map((o) => o.id),
    ['f', 'r2'],
    'nested descendants excluded',
  );
});

test('rootsOf treats parents outside the set as roots', () => {
  const orphan = mkObj({ id: 'orphan', parentId: 'ghost' });
  assertEq(rootsOf([orphan]).map((o) => o.id), ['orphan'], 'dangling parent');
  assertEq(rootsOf([]), [], 'empty set');
});

/* ---------- group placement ---------- */

test('placeRootsAtCenter centers a single object', () => {
  const rect = mkObj({ id: 'r', w: 168, h: 48 });
  const [placed] = placeRootsAtCenter([rect], { x: 500, y: 400 });
  assertEq({ x: placed.x, y: placed.y }, { x: 416, y: 376 }, 'origin');
  assertEq({ w: placed.w, h: placed.h }, { w: 168, h: 48 }, 'size kept');
});

test('placeRootsAtCenter moves the group root, children keep relative pose', () => {
  const frame = mkObj({ id: 'f', type: 'frame', w: 168, h: 48 });
  const label = mkObj({ id: 't', type: 'text', parentId: 'f', x: 0, y: 13, w: 168, h: 22 });
  const [pf, pl] = placeRootsAtCenter([frame, label], { x: 500, y: 400 });
  assertEq({ x: pf.x, y: pf.y }, { x: 416, y: 376 }, 'root centered');
  assertEq(pl, label, 'child untouched (relative pose + structure)');
});

test('placeRootsAtCenter centers multi-root sets with one shared delta', () => {
  const r1 = mkObj({ id: 'r1', w: 100, h: 100 });
  const r2 = mkObj({ id: 'r2', x: 200, w: 100, h: 100 });
  const [p1, p2] = placeRootsAtCenter([r1, r2], { x: 500, y: 400 });
  // Group bounds (0,0,300,100), center (150,50) -> delta (350,350).
  assertEq({ x: p1.x, y: p1.y }, { x: 350, y: 350 }, 'first root');
  assertEq({ x: p2.x, y: p2.y }, { x: 550, y: 350 }, 'second root');
});

test('placeRootsAtCenter uses geometric bounds for negative line dims', () => {
  const line = mkObj({ id: 'l', type: 'line', w: 100, h: -50 });
  const [placed] = placeRootsAtCenter([line], { x: 500, y: 400 });
  // Bounds (0,-50,100,50), center (50,-25) -> delta (450,425).
  assertEq({ x: placed.x, y: placed.y }, { x: 450, y: 425 }, 'origin');
  const cx = placed.x + placed.w / 2;
  const cy = placed.y + placed.h / 2;
  assertEq({ cx, cy }, { cx: 500, cy: 400 }, 'segment midpoint on target');
});

test('placeRootsAtCenter rounds to integer pixels and tolerates empty sets', () => {
  const rect = mkObj({ id: 'r', w: 101, h: 101 });
  const [placed] = placeRootsAtCenter([rect], { x: 500, y: 400 });
  assert(
    Number.isInteger(placed.x) && Number.isInteger(placed.y),
    `integer origin (got ${placed.x},${placed.y})`,
  );
  assertEq({ x: placed.x, y: placed.y }, { x: 450, y: 350 }, 'rounded half-up');
  const empty: DesignObject[] = [];
  assert(placeRootsAtCenter(empty, { x: 0, y: 0 }) === empty, 'empty set untouched');
});

/* ---------- insert undo/redo round-trip ---------- */

test('inserted placement survives an undo/redo round-trip identically', () => {
  const frame = mkObj({ id: 'f', type: 'frame', w: 168, h: 48 });
  const label = mkObj({ id: 't', type: 'text', parentId: 'f', x: 0, y: 13, w: 168, h: 22 });
  const placed = placeRootsAtCenter([frame, label], { x: 500, y: 400 });
  const empty: UndesignDoc = {
    version: 1,
    name: 't',
    pages: [{ id: 'p', name: 'p', objects: [] }],
    activePageId: 'p',
  };
  const inserted: UndesignDoc = {
    ...empty,
    pages: [{ id: 'p', name: 'p', objects: placed }],
  };
  let h: HistoryState = { past: [], present: empty, future: [] };
  h = commitDoc(h, inserted); // single insert step
  assert(h.past.length === 1, 'insert is one undo step');
  const undone = undoHistory(h);
  assertEq(undone.present.pages[0].objects, [], 'undo removes the group');
  const redone = redoHistory(undone);
  assertEq(redone.present.pages[0].objects, placed, 'redo restores position + structure');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL PLACEMENT TESTS PASSED');
