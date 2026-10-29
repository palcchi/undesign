/**
 * Regression tests for rotation-aware resize origins.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { resizeOrigin } from '../src/utils';
import { applyMatrix, rotateMatrix } from '../src/transform';

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

function assertNear(actual: number, expected: number, msg: string): void {
  assert(Math.abs(actual - expected) < 1e-9, `${msg} (got ${actual}, want ${expected})`);
}

/** Local anchor (fixed point) for a handle, given the rect size. */
function anchor(handle: string, w: number, h: number): { x: number; y: number } {
  return {
    x: handle.includes('e') ? 0 : handle.includes('w') ? w : w / 2,
    y: handle.includes('s') ? 0 : handle.includes('n') ? h : h / 2,
  };
}

/** Center-rotation offset of a local point (caller adds the origin). */
function rotOffset(
  rotation: number,
  w: number,
  h: number,
  lx: number,
  ly: number,
): { x: number; y: number } {
  return applyMatrix(rotateMatrix(rotation, w / 2, h / 2), lx, ly);
}

const HANDLES = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];

test('unrotated resize matches the legacy origin shift on every handle', () => {
  const orig = { x: 100, y: 80, w: 120, h: 60, rotation: 0 };
  for (const hnd of HANDLES) {
    const dx = hnd.includes('e') ? 15 : hnd.includes('w') ? 9 : 0;
    const dy = hnd.includes('s') ? 11 : hnd.includes('n') ? 7 : 0;
    const w = hnd.includes('e') ? orig.w + dx : hnd.includes('w') ? orig.w - dx : orig.w;
    const h = hnd.includes('s') ? orig.h + dy : hnd.includes('n') ? orig.h - dy : orig.h;
    const got = resizeOrigin(orig, hnd, w, h);
    const legacy = {
      x: orig.x + (hnd.includes('w') ? orig.w - w : 0),
      y: orig.y + (hnd.includes('n') ? orig.h - h : 0),
    };
    assertNear(got.x, legacy.x, `${hnd} x`);
    assertNear(got.y, legacy.y, `${hnd} y`);
  }
});

test('rotated resize keeps the opposite anchor fixed in parent space', () => {
  for (const rotation of [30, 90, 135, 180, -45]) {
    for (const hnd of HANDLES) {
      const orig = { x: 100, y: 80, w: 120, h: 60, rotation };
      const dx = hnd.includes('e') ? 15 : hnd.includes('w') ? 9 : 0;
      const dy = hnd.includes('s') ? 11 : hnd.includes('n') ? 7 : 0;
      const w = hnd.includes('e') ? orig.w + dx : hnd.includes('w') ? orig.w - dx : orig.w;
      const h = hnd.includes('s') ? orig.h + dy : hnd.includes('n') ? orig.h - dy : orig.h;
      const o = resizeOrigin(orig, hnd, w, h);
      const aOld = anchor(hnd, orig.w, orig.h);
      const aNew = anchor(hnd, w, h);
      const before = rotOffset(rotation, orig.w, orig.h, aOld.x, aOld.y);
      const after = rotOffset(rotation, w, h, aNew.x, aNew.y);
      assertNear(orig.x + before.x, o.x + after.x, `rot=${rotation} ${hnd} anchor x`);
      assertNear(orig.y + before.y, o.y + after.y, `rot=${rotation} ${hnd} anchor y`);
    }
  }
});

test('rotated east resize lands on the exact anchored origin', () => {
  // 90-degree rect at (100,100), 100x50: growing the east edge by 10 must
  // hold the west-edge center at parent (150,75).
  const o = resizeOrigin({ x: 100, y: 100, w: 100, h: 50, rotation: 90 }, 'e', 110, 50);
  assertNear(o.x, 95, 'x');
  assertNear(o.y, 105, 'y');
  const west = applyMatrix(rotateMatrix(90, 110 / 2, 50 / 2), 0, 25);
  assertNear(o.x + west.x, 150, 'west edge center x fixed');
  assertNear(o.y + west.y, 75, 'west edge center y fixed');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL RESIZE TESTS PASSED');
