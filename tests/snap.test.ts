/**
 * Regression tests for move-snapping (object alignment + grid).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { GRID_PITCH, SNAP_THRESHOLD_PX, snapMoveDelta, snapSelectionMove } from '../src/utils';
import type { SnapBounds } from '../src/utils';

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

function box(x: number, y: number, w: number, h: number): SnapBounds {
  return { x, y, w, h };
}

test('snap constants match the canvas grid', () => {
  assert(GRID_PITCH === 24, `grid pitch is 24 (got ${GRID_PITCH})`);
  assert(SNAP_THRESHOLD_PX === 6, `threshold is 6px (got ${SNAP_THRESHOLD_PX})`);
});

test('no candidates and no grid leaves the delta untouched', () => {
  const r = snapMoveDelta(box(10, 10, 50, 50), [], { grid: null, threshold: 10 });
  assert(r.dx === 0 && r.dy === 0, 'zero offset');
  assert(r.guides.length === 0, 'no guides');
});

test('snaps moving right edge to candidate left edge', () => {
  const r = snapMoveDelta(box(95, 0, 50, 50), [box(150, 0, 60, 60)], { grid: null, threshold: 10 });
  assert(r.dx === 5, `dx=+5 (got ${r.dx})`);
  assert(r.dy === 0, 'dy untouched');
  // The already-aligned top edges (y=0) also report a guide, Figma-style.
  assert(r.guides.length === 2, `two guides (got ${r.guides.length})`);
  const v = r.guides.find((g) => g.x1 === g.x2);
  const h = r.guides.find((g) => g.y1 === g.y2);
  assert(v !== undefined && v.x1 === 150, 'vertical guide at x=150');
  assert(v !== undefined && v.y1 === -8 && v.y2 === 68, `vertical spans union+margin (got ${v?.y1}..${v?.y2})`);
  assert(h !== undefined && h.y1 === 0, 'horizontal guide at y=0');
});

test('snaps left edges and centers', () => {
  const left = snapMoveDelta(box(97, 0, 40, 40), [box(100, 0, 40, 40)], { grid: null, threshold: 10 });
  assert(left.dx === 3, `left-edge dx=+3 (got ${left.dx})`);
  // Moving center 100 vs candidate center 104.
  const center = snapMoveDelta(box(80, 0, 40, 40), [box(84, 0, 40, 40)], { grid: null, threshold: 10 });
  assert(center.dx === 4, `center dx=+4 (got ${center.dx})`);
});

test('threshold boundary is inclusive', () => {
  const at = snapMoveDelta(box(90, 0, 50, 50), [box(150, 0, 60, 60)], { grid: null, threshold: 10 });
  assert(at.dx === 10, `offset == threshold snaps (got ${at.dx})`);
  const past = snapMoveDelta(box(89, 0, 50, 50), [box(150, 0, 60, 60)], { grid: null, threshold: 10 });
  assert(past.dx === 0, 'offset > threshold ignored');
  assert(past.guides.every((g) => g.y1 === g.y2), 'no vertical guide past threshold');
});

test('object snap wins over grid snap', () => {
  // Object edge is 5 away; grid line (96) is 1 away. Smart guides take precedence.
  const r = snapMoveDelta(box(95, 0, 50, 50), [box(150, 0, 60, 60)], { grid: GRID_PITCH, threshold: 10 });
  assert(r.dx === 5, `object offset wins (got ${r.dx})`);
  assert(r.guides.filter((g) => g.x1 === g.x2).length === 1, 'object guide emitted');
});

test('grid snap applies when no object matches', () => {
  const r = snapMoveDelta(box(95, 192, 10, 10), [], { grid: GRID_PITCH, threshold: 10 });
  assert(r.dx === 1, `snap 95 -> 96 (got ${r.dx})`);
  assert(r.dy === 0, '192 is already on-grid');
  assert(r.guides.length === 0, 'grid matches emit no guides');
});

test('axes snap independently', () => {
  const r = snapMoveDelta(box(97, 53, 40, 40), [box(100, 200, 40, 40)], { grid: null, threshold: 10 });
  assert(r.dx === 3, `x snaps (got ${r.dx})`);
  assert(r.dy === 0, `y does not (got ${r.dy})`);
  assert(r.guides.length === 1 && r.guides[0].x1 === r.guides[0].x2, 'vertical guide only');
});

test('picks the nearest candidate among many', () => {
  const r = snapMoveDelta(
    box(95, 0, 50, 50),
    [box(300, 0, 40, 40), box(150, 0, 60, 60), box(500, 0, 40, 40)],
    { grid: null, threshold: 10 },
  );
  assert(r.dx === 5, `nearest wins (got ${r.dx})`);
});

test('zero-size moving bounds still snap', () => {
  // A horizontal line has h=0: all y points coincide, snapping still works.
  const r = snapMoveDelta(box(95, 100, 50, 0), [box(150, 100, 60, 40)], { grid: null, threshold: 10 });
  assert(r.dx === 5, `x snaps (got ${r.dx})`);
  assert(r.dy === 0, 'y already aligned');
});

test('canvas move-snapping scales the threshold by zoom', () => {
  // Moving right edge 5 page-units from the candidate left edge.
  const at1 = snapSelectionMove(box(95, 0, 50, 50), [box(150, 0, 60, 60)], 1);
  assert(at1.dx === 5 && at1.dy === 0, `snaps at zoom 1 (got ${at1.dx},${at1.dy})`);
  assert(at1.guides.some((g) => g.x1 === 150 && g.x2 === 150), 'guide at x=150');
  // At zoom 4 the same 5-unit gap is 20 screen px: outside the 6px feel.
  const at4 = snapSelectionMove(box(95, 0, 50, 50), [box(150, 0, 60, 60)], 4);
  assert(at4.dx === 0 && at4.dy === 0, `no snap at zoom 4 (got ${at4.dx},${at4.dy})`);
  // Zero-offset exact alignment still reports its guide, Figma-style.
  assert(at4.guides.every((g) => g.y1 === 0 && g.y2 === 0), 'only the exact y=0 guide');
});

test('canvas move-snapping never snaps to grid', () => {
  // x=10 is 2 units off the 24-pitch grid but far from any object.
  const r = snapSelectionMove(box(10, 10, 50, 50), [], 1);
  assert(r.dx === 0 && r.dy === 0, 'objects-or-nothing');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL SNAP TESTS PASSED');
