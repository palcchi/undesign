/**
 * Regression tests for canvas viewport math (zoom anchoring + fit).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  ZOOM_MAX,
  ZOOM_MIN,
  fitViewport,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
  zoomCentered,
} from '../src/utils';
import type { Viewport } from '../src/types';

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

function assertNear(actual: number, expected: number, msg: string, eps = 1e-9): void {
  assert(
    Math.abs(actual - expected) <= eps,
    `${msg} (got ${actual}, want ${expected})`,
  );
}

/* ---------- anchored zoom ---------- */

test('zoomAtPoint keeps the world point under the cursor fixed', () => {
  const before: Viewport = { zoom: 1, x: 0, y: 0 };
  const after = zoomAtPoint(before, 100, 50, 2);
  assertNear(after.zoom, 2, 'zoom');
  assertNear(after.x, -100, 'pan x');
  assertNear(after.y, -50, 'pan y');
  // The same world point must still project to the same screen point.
  const world = screenToWorld(100, 50, before);
  const screen = worldToScreen(world.x, world.y, after);
  assertNear(screen.x, 100, 'anchor x stable');
  assertNear(screen.y, 50, 'anchor y stable');
});

test('zoomAtPoint clamps to the supported range', () => {
  const v: Viewport = { zoom: 1, x: 0, y: 0 };
  assertNear(zoomAtPoint(v, 100, 50, 100).zoom, ZOOM_MAX, 'upper clamp');
  assertNear(zoomAtPoint(v, 100, 50, 0.0001).zoom, ZOOM_MIN, 'lower clamp');
  // Pan is computed from the clamped zoom, not the requested one.
  assertNear(zoomAtPoint(v, 100, 50, 100).x, 100 - 100 * ZOOM_MAX, 'pan uses clamped zoom');
});

test('zoomCentered anchors at the container center', () => {
  const v: Viewport = { zoom: 1, x: 0, y: 0 };
  const after = zoomCentered(v, 1000, 800, 2);
  assertNear(after.zoom, 2, 'zoom');
  assertNear(after.x, -500, 'pan x');
  assertNear(after.y, -400, 'pan y');
  const world = screenToWorld(500, 400, v);
  const screen = worldToScreen(world.x, world.y, after);
  assertNear(screen.x, 500, 'center x stable');
  assertNear(screen.y, 400, 'center y stable');
});

test('zoom level contract', () => {
  assert(ZOOM_MIN === 0.05 && ZOOM_MAX === 8, `bounds drifted: ${ZOOM_MIN}..${ZOOM_MAX}`);
});

/* ---------- fit ---------- */

test('fitViewport centers bounds with padding', () => {
  const v = fitViewport({ x: 0, y: 0, w: 800, h: 600 }, 1000, 800);
  // z = min((1000-96)/800, (800-96)/600) = min(1.13, 1.1733) = 1.13
  assertNear(v.zoom, 1.13, 'zoom');
  assertNear(v.x, (1000 - 800 * 1.13) / 2, 'pan x');
  assertNear(v.y, (800 - 600 * 1.13) / 2, 'pan y');
});

test('fitViewport respects offset bounds', () => {
  const v = fitViewport({ x: 200, y: 100, w: 400, h: 300 }, 1000, 800);
  // Raw zoom min(2.26, 2.3467) is capped at 2.
  assertNear(v.zoom, 2, 'zoom capped');
  assertNear(v.x, (1000 - 400 * 2) / 2 - 200 * 2, 'pan x');
  assertNear(v.y, (800 - 300 * 2) / 2 - 100 * 2, 'pan y');
});

test('fitViewport caps zoom for tiny content', () => {
  const v = fitViewport({ x: 0, y: 0, w: 10, h: 10 }, 1000, 800);
  assertNear(v.zoom, 2, 'zoom capped');
  assertNear(v.x, (1000 - 20) / 2, 'pan x');
  assertNear(v.y, (800 - 20) / 2, 'pan y');
});

test('fitViewport clamps zoom for huge content', () => {
  const v = fitViewport({ x: 0, y: 0, w: 100000, h: 100000 }, 1000, 800);
  assertNear(v.zoom, ZOOM_MIN, 'zoom clamped to min');
});

test('fitViewport falls back gracefully when empty', () => {
  const v = fitViewport(null, 1000, 800);
  assertNear(v.zoom, 1, 'zoom');
  assertNear(v.x, 1000 / 2 - 200, 'pan x');
  assertNear(v.y, 800 / 3, 'pan y');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL VIEWPORT TESTS PASSED');
