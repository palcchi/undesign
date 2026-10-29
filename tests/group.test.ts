/**
 * Regression tests for group/ungroup (transform-preserving reparenting).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { groupObjects, reparentLocal, ungroupObjects } from '../src/utils';
import { pageMatrixOf, transformedBounds } from '../src/transform';
import type { Matrix } from '../src/transform';
import type { DesignObject, ObjectType } from '../src/types';

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

let seq = 0;
function obj(
  type: ObjectType,
  over: Partial<DesignObject> = {},
): DesignObject {
  seq += 1;
  return {
    id: `o${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#FF0000', fillOpacity: 1, fillGradient: null, fillStyleId: null, constraints: null, stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    componentId: null, sourceId: null, componentSnapshot: null, clip: false,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  };
}

function matEq(a: Matrix, b: Matrix, eps = 1e-6): boolean {
  return (
    Math.abs(a.a - b.a) < eps && Math.abs(a.b - b.b) < eps &&
    Math.abs(a.c - b.c) < eps && Math.abs(a.d - b.d) < eps &&
    Math.abs(a.e - b.e) < eps && Math.abs(a.f - b.f) < eps
  );
}

function byId(objects: DesignObject[], id: string): DesignObject {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`missing object ${id}`);
  return o;
}

test('group wraps siblings and preserves page transforms', () => {
  const a = obj('rectangle', { id: 'a', x: 10, y: 10, w: 50, h: 40 });
  const b = obj('rectangle', { id: 'b', x: 100, y: 80, w: 60, h: 30, rotation: 25 });
  const before = [a, b];
  const after = groupObjects(before, ['a', 'b'], 'g');
  assert(after !== null, 'group produced');
  const g = byId(after!, 'g');
  assert(g.type === 'frame', 'group is a frame');
  assert(g.parentId === null, 'root group for root siblings');
  assert(g.fill === '' && g.clip === false, 'group is transparent and unclipped');
  // b is rotated: the expected union comes from transformed bounds, not raw x/y.
  const ba = transformedBounds(before, a);
  const bb = transformedBounds(before, b);
  const ux = Math.min(ba.x, bb.x);
  const uy = Math.min(ba.y, bb.y);
  const uw = Math.max(ba.x + ba.w, bb.x + bb.w) - ux;
  const uh = Math.max(ba.y + ba.h, bb.y + bb.h) - uy;
  assert(g.x === ux && g.y === uy, `frame at union min (got ${g.x},${g.y})`);
  assert(g.w === uw && g.h === uh, `frame spans union (got ${g.w}x${g.h})`);
  assert(after!.findIndex((o) => o.id === 'g') === 0, 'group takes first child index');
  for (const id of ['a', 'b']) {
    assert(byId(after!, id).parentId === 'g', `${id} reparented`);
    assert(
      matEq(pageMatrixOf(before, byId(before, id)), pageMatrixOf(after!, byId(after!, id))),
      `${id} keeps exact page matrix`,
    );
  }
  assert(byId(after!, 'b').rotation === 25, 'child rotation untouched in common parent');
});

test('group uses the common parent and nests at root for mixed parents', () => {
  const f = obj('frame', { id: 'f', x: 50, y: 50, w: 400, h: 400 });
  const a = obj('rectangle', { id: 'a', parentId: 'f', x: 10, y: 10, w: 50, h: 50 });
  const b = obj('rectangle', { id: 'b', parentId: 'f', x: 90, y: 90, w: 50, h: 50 });
  const same = groupObjects([f, a, b], ['a', 'b'], 'g');
  assert(same !== null && byId(same, 'g').parentId === 'f', 'common parent kept');
  assert(byId(same!, 'g').x === 10 && byId(same!, 'g').y === 10, 'frame local to common parent');
  const c = obj('rectangle', { id: 'c', x: 500, y: 500, w: 40, h: 40 });
  const mixed = groupObjects([f, a, b, c], ['a', 'c'], 'g2');
  assert(mixed !== null && byId(mixed, 'g2').parentId === null, 'mixed parents group at root');
  for (const [arr, id, src] of [[mixed!, 'a', [f, a, b, c]], [mixed!, 'c', [f, a, b, c]]] as const) {
    assert(
      matEq(pageMatrixOf(src, byId(src, id)), pageMatrixOf(arr, byId(arr, id))),
      `${id} keeps page matrix across parents`,
    );
  }
});

test('group selects tops only when parent and child are both selected', () => {
  const f = obj('frame', { id: 'f', x: 0, y: 0, w: 300, h: 300 });
  const a = obj('rectangle', { id: 'a', parentId: 'f', x: 20, y: 20, w: 40, h: 40 });
  const after = groupObjects([f, a], ['f', 'a'], 'g');
  assert(after !== null, 'group produced');
  assert(byId(after!, 'f').parentId === 'g', 'frame reparented');
  assert(byId(after!, 'a').parentId === 'f', 'child follows its parent untouched');
  assert(
    matEq(pageMatrixOf([f, a], a), pageMatrixOf(after!, byId(after!, 'a'))),
    'grandchild keeps page matrix',
  );
});

test('group under a rotated parent preserves child page matrices', () => {
  const f = obj('frame', { id: 'f', x: 200, y: 200, w: 300, h: 300, rotation: 30 });
  const a = obj('rectangle', { id: 'a', parentId: 'f', x: 10, y: 10, w: 50, h: 50 });
  const b = obj('rectangle', { id: 'b', parentId: 'f', x: 90, y: 40, w: 50, h: 50, rotation: -15 });
  const before = [f, a, b];
  const after = groupObjects(before, ['a', 'b'], 'g');
  assert(after !== null, 'group produced');
  for (const id of ['a', 'b']) {
    assert(
      matEq(pageMatrixOf(before, byId(before, id)), pageMatrixOf(after!, byId(after!, id))),
      `${id} exact under rotated parent`,
    );
  }
});

test('group rejects empty and unknown selections', () => {
  const a = obj('rectangle', { id: 'a' });
  assert(groupObjects([a], [], 'g') === null, 'empty selection');
  assert(groupObjects([a], ['zzz'], 'g') === null, 'unknown ids');
});

test('reparentLocal matches moveObject semantics with optional rounding', () => {
  const f = obj('frame', { id: 'f', x: 100, y: 100, w: 400, h: 400, rotation: 90 });
  const a = obj('rectangle', { id: 'a', x: 10.4, y: 20.6, w: 40, h: 40 });
  const rounded = reparentLocal([f, a], a, 'f');
  assert(rounded.parentId === 'f', 'parent set');
  assert(Number.isInteger(rounded.x) && Number.isInteger(rounded.y), 'rounded by default');
  const exact = reparentLocal([f, a], a, 'f', { round: false });
  assert(!Number.isInteger(exact.x) || !Number.isInteger(exact.y), 'exact keeps fractions');
  // Both land on the same page transform (rounding aside).
  const placed = { ...a, parentId: 'f' as const, x: exact.x, y: exact.y, rotation: exact.rotation };
  assert(matEq(pageMatrixOf([f, a], a), pageMatrixOf([f, placed], placed)), 'exact reparent is lossless');
});

test('ungroup dissolves the frame and preserves page transforms', () => {
  const a = obj('rectangle', { id: 'a', x: 10, y: 10, w: 50, h: 40 });
  const b = obj('rectangle', { id: 'b', x: 100, y: 80, w: 60, h: 30, rotation: 25 });
  const grouped = groupObjects([a, b], ['a', 'b'], 'g')!;
  const res = ungroupObjects(grouped, ['g']);
  assert(res !== null, 'ungroup produced');
  assert(!res!.objects.some((o) => o.id === 'g'), 'frame removed');
  assert(res!.objects.length === 2, 'children survive');
  assert(JSON.stringify(res!.selectedIds) === JSON.stringify(['a', 'b']), 'children selected');
  for (const id of ['a', 'b']) {
    assert(byId(res!.objects, id).parentId === null, `${id} back at root`);
    assert(
      matEq(pageMatrixOf([a, b], byId([a, b], id)), pageMatrixOf(res!.objects, byId(res!.objects, id))),
      `${id} round-trips exactly`,
    );
  }
});

test('ungroup dissolves nested groups outer-first', () => {
  const a = obj('rectangle', { id: 'a', x: 10, y: 10, w: 50, h: 50 });
  const inner = groupObjects([a], ['a'], 'inner')!;
  const outer = groupObjects(inner, ['inner'], 'outer')!;
  const res = ungroupObjects(outer, ['outer', 'inner']);
  assert(res !== null, 'ungroup produced');
  assert(res!.objects.length === 1 && res!.objects[0].id === 'a', 'both levels dissolved');
  assert(byId(res!.objects, 'a').parentId === null, 'child at root');
  assert(
    matEq(pageMatrixOf([a], a), pageMatrixOf(res!.objects, byId(res!.objects, 'a'))),
    'deep round-trip exact',
  );
});

test('ungroup removes empty groups and ignores non-frames', () => {
  const g = obj('frame', { id: 'g', x: 0, y: 0, w: 100, h: 100 });
  const r = obj('rectangle', { id: 'r', x: 200, y: 200, w: 40, h: 40 });
  const empty = ungroupObjects([g, r], ['g']);
  assert(empty !== null && empty.objects.length === 1, 'empty group removed');
  assert(empty!.selectedIds.length === 0, 'nothing selected');
  assert(ungroupObjects([g, r], ['r']) === null, 'non-frame ignored');
  assert(ungroupObjects([g, r], []) === null, 'empty selection');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL GROUP TESTS PASSED');
