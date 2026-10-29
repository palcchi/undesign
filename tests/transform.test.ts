/**
 * Unit tests for the affine transform model (rotation-aware coordinates).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  IDENTITY,
  ancestorMatrixOf,
  applyMatrix,
  invertMatrix,
  isIdentity,
  matrixToSvg,
  multiplyMatrices,
  normalizeDegrees,
  objectCorners,
  objectLocalMatrix,
  objectLocalPoint,
  pageMatrixOf,
  parentLocalPoint,
  pointInObject,
  quadsOverlap,
  rotateMatrix,
  transformedBounds,
  translateLocalByPageDelta,
  translateMatrix,
  worldRotation,
} from '../src/transform';
import type { DesignObject } from '../src/types';

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
  assert(Math.abs(actual - expected) <= eps, `${msg} (got ${actual}, want ${expected})`);
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
    fillGradient: null,
    fillStyleId: null,
    constraints: null,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    componentId: null, sourceId: null, componentSnapshot: null,
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

test('multiply applies right matrix first (SVG nesting order)', () => {
  const m = multiplyMatrices(translateMatrix(10, 0), translateMatrix(0, 20));
  const p = applyMatrix(m, 1, 1);
  assertNear(p.x, 11, 'x');
  assertNear(p.y, 21, 'y');
});

test('rotateMatrix turns corners about a center', () => {
  const m = rotateMatrix(90, 50, 50);
  const p = applyMatrix(m, 100, 50); // right-middle -> bottom-middle (y-down)
  assertNear(p.x, 50, 'x');
  assertNear(p.y, 100, 'y');
});

test('matrixToSvg rounds float noise away', () => {
  assert(
    matrixToSvg(rotateMatrix(90)) === 'matrix(0 1 -1 0 0 0)',
    `got ${matrixToSvg(rotateMatrix(90))}`,
  );
  assert(matrixToSvg(IDENTITY) === 'matrix(1 0 0 1 0 0)', 'identity');
});

test('invertMatrix round-trips and rejects singular matrices', () => {
  const m = multiplyMatrices(translateMatrix(30, -12), rotateMatrix(33, 4, 9));
  const inv = invertMatrix(m);
  assert(inv !== null, 'invertible');
  const back = applyMatrix(multiplyMatrices(m, inv as never), 7, 11);
  assertNear(back.x, 7, 'x round-trip');
  assertNear(back.y, 11, 'y round-trip');
  assert(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }) === null, 'singular -> null');
});

test('isIdentity distinguishes transformed matrices', () => {
  assert(isIdentity(IDENTITY), 'identity');
  assert(!isIdentity(translateMatrix(1, 0)), 'translated');
  assert(!isIdentity(rotateMatrix(90)), 'rotated');
});

test('objectLocalMatrix matches translate-then-rotate renderer order', () => {
  const obj = mkObj({ id: 'o', x: 10, y: 20, w: 100, h: 50, rotation: 90 });
  const m = objectLocalMatrix(obj);
  // Local center maps to translated center regardless of rotation.
  const c = applyMatrix(m, 50, 25);
  assertNear(c.x, 60, 'center x');
  assertNear(c.y, 45, 'center y');
  // Local origin (top-left) rotates to bottom-left of the translated box.
  const o = applyMatrix(m, 0, 0);
  assertNear(o.x, 85, 'origin x');
  assertNear(o.y, -5, 'origin y');
});

test('pageMatrixOf composes nested frames root-first', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 100, y: 50, w: 400, h: 300 });
  const c = mkObj({ id: 'c', parentId: 'f', x: 10, y: 20, w: 60, h: 40 });
  const p = applyMatrix(pageMatrixOf([f, c], c), 0, 0);
  assertNear(p.x, 110, 'x');
  assertNear(p.y, 70, 'y');
});

test('pageMatrixOf includes ancestor rotation', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 100, h: 100, rotation: 90 });
  const c = mkObj({ id: 'c', parentId: 'f', x: 50, y: 0, w: 10, h: 10 });
  // Child local origin (50,0) -> rotated about (50,50) -> (100,50).
  const p = applyMatrix(pageMatrixOf([f, c], c), 0, 0);
  assertNear(p.x, 100, 'x');
  assertNear(p.y, 50, 'y');
});

test('ancestorMatrixOf is identity for roots, parent chain for children', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 100, y: 50, w: 400, h: 300 });
  const c = mkObj({ id: 'c', parentId: 'f', x: 10, y: 20 });
  assert(isIdentity(ancestorMatrixOf([f], f)), 'root identity');
  const m = ancestorMatrixOf([f, c], c);
  const p = applyMatrix(m, 10, 20);
  assertNear(p.x, 110, 'child local maps to page');
  assertNear(p.y, 70, 'child local maps to page');
});

test('transformedBounds of unrotated objects equals geometric bounds', () => {
  const line = mkObj({ id: 'l', type: 'line', x: 10, y: 70, w: 100, h: -50 });
  const b = transformedBounds([line], line);
  assertNear(b.x, 10, 'x');
  assertNear(b.y, 20, 'y');
  assertNear(b.w, 100, 'w');
  assertNear(b.h, 50, 'h');
});

test('transformedBounds of rotated objects spans rotated corners', () => {
  const rect = mkObj({ id: 'r', x: 0, y: 0, w: 100, h: 100, rotation: 45 });
  const b = transformedBounds([rect], rect);
  // Corners rotate about (50,50): extremes at 50 +/- 50*sqrt(2).
  const e = 50 * Math.SQRT2;
  assertNear(b.x, 50 - e, 'x', 1e-6);
  assertNear(b.y, 50 - e, 'y', 1e-6);
  assertNear(b.w, 2 * e, 'w', 1e-6);
  assertNear(b.h, 2 * e, 'h', 1e-6);
});

test('transformedBounds of a 90-degree rect swaps width and height', () => {
  const rect = mkObj({ id: 'r', x: 10, y: 20, w: 100, h: 40, rotation: 90 });
  const b = transformedBounds([rect], rect);
  assertNear(b.w, 40, 'w', 1e-6);
  assertNear(b.h, 100, 'h', 1e-6);
  assertNear(b.x, 40, 'x', 1e-6);
  assertNear(b.y, -10, 'y', 1e-6);
});

test('ancestor walks terminate on cyclic parent references', () => {
  const a = mkObj({ id: 'a', parentId: 'b', x: 5 });
  const b = mkObj({ id: 'b', parentId: 'a', x: 7 });
  const m = pageMatrixOf([a, b], a);
  const p = applyMatrix(m, 0, 0);
  assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'finite result despite cycle');
});

test('objectCorners returns page-space corners in local order', () => {
  const rect = mkObj({ id: 'r', x: 10, y: 20, w: 100, h: 40 });
  const corners = objectCorners([rect], rect);
  assertNear(corners[0].x, 10, 'c0 x');
  assertNear(corners[0].y, 20, 'c0 y');
  assertNear(corners[1].x, 110, 'c1 x');
  assertNear(corners[2].y, 60, 'c2 y');
  assertNear(corners[3].x, 110, 'c3 x');
  assertNear(corners[3].y, 60, 'c3 y');
});

test('objectCorners handles negative line dims', () => {
  const line = mkObj({ id: 'l', type: 'line', x: 10, y: 70, w: 100, h: -50 });
  const corners = objectCorners([line], line);
  const sorted = corners
    .map((p) => [p.x, p.y])
    .sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]));
  assert(
    JSON.stringify(sorted) === JSON.stringify([[10, 20], [10, 70], [110, 20], [110, 70]]),
    `corner set (got ${JSON.stringify(sorted)})`,
  );
});

test('objectLocalPoint inverts the page matrix', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 100, h: 100, rotation: 90 });
  const p = objectLocalPoint([f], f, 100, 50);
  assert(p !== null, 'invertible');
  assertNear(p!.x, 50, 'x');
  assertNear(p!.y, 0, 'y');
});

test('parentLocalPoint maps page points into a parent frame', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 100, h: 100, rotation: 90 });
  const p = parentLocalPoint([f], f, 100, 50);
  assert(p !== null, 'invertible');
  assertNear(p!.x, 50, 'x');
  assertNear(p!.y, 0, 'y');
  const root = parentLocalPoint([f], null, 12, 34);
  assertNear(root!.x, 12, 'null parent identity x');
  assertNear(root!.y, 34, 'null parent identity y');
});

test('translateLocalByPageDelta is exact under translation and rotation', () => {
  const plain = mkObj({ id: 'o', x: 10, y: 20, w: 50, h: 50 });
  const moved = translateLocalByPageDelta([plain], plain, 5, -7);
  assertNear(moved.x, 15, 'unrotated x');
  assertNear(moved.y, 13, 'unrotated y');
  // Rotated parent: result must land exactly at pagePos + delta.
  const f = mkObj({ id: 'f', type: 'frame', x: 100, y: 0, w: 200, h: 200, rotation: 90 });
  const c = mkObj({ id: 'c', parentId: 'f', x: 10, y: 20, w: 30, h: 30 });
  const objs = [f, c];
  const before = applyMatrix(pageMatrixOf(objs, c), 0, 0);
  const after = translateLocalByPageDelta(objs, c, 7, -3);
  const check = applyMatrix(pageMatrixOf(objs, { ...c, x: after.x, y: after.y }), 0, 0);
  assertNear(check.x, before.x + 7, 'rotated lands on target x');
  assertNear(check.y, before.y - 3, 'rotated lands on target y');
});

test('quadsOverlap handles overlap, disjoint, touching, rotation, containment', () => {
  const rect = (x: number, y: number, w: number, h: number) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  assert(quadsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), 'overlap');
  assert(!quadsOverlap(rect(0, 0, 10, 10), rect(20, 20, 10, 10)), 'disjoint');
  assert(!quadsOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10)), 'touching edges miss');
  // Diamond (rotated square) centered at (30,5) overlapping rect (20,0,20,10).
  const diamond = [
    { x: 30, y: -5 },
    { x: 40, y: 5 },
    { x: 30, y: 15 },
    { x: 20, y: 5 },
  ];
  assert(quadsOverlap(diamond, rect(20, 0, 20, 10)), 'rotated overlap');
  assert(quadsOverlap(rect(0, 0, 100, 100), rect(20, 20, 10, 10)), 'containment');
});

test('pointInObject respects rotation', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 120, h: 60, rotation: 90 });
  assert(pointInObject([f], f, 90, 10), 'inside rotated frame');
  assert(!pointInObject([f], f, 10, 10), 'outside rotated frame');
  assert(!pointInObject([f], f, 500, 500), 'far outside');
});

test('worldRotation reads nested rotation additively', () => {
  assertNear(worldRotation(IDENTITY), 0, 'identity');
  assertNear(worldRotation(rotateMatrix(90)), 90, 'single');
  const f = mkObj({ id: 'f', type: 'frame', w: 100, h: 100, rotation: 30 });
  const c = mkObj({ id: 'c', parentId: 'f', w: 50, h: 50, rotation: 45 });
  assertNear(worldRotation(pageMatrixOf([f, c], c)), 75, 'nested sum', 1e-6);
});

test('normalizeDegrees wraps to [-180, 180)', () => {
  assertNear(normalizeDegrees(370), 10, 'overflow');
  assertNear(normalizeDegrees(-190), 170, 'underflow');
  assertNear(normalizeDegrees(180), -180, 'boundary');
  assertNear(normalizeDegrees(45), 45, 'identity');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL TRANSFORM TESTS PASSED');
