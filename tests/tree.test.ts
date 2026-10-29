/**
 * Layer-tree helper tests: flatten order, parent maps, subtree guards, and
 * the drop-index math behind drag reorder. Run with `npm test`.
 */
import { adjustedReorderIndex, dropIndex, flattenTree, parentMap, subtreeIds } from '../src/engine/tree';
import type { EngineNode } from '../src/engine/adapter';

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

function node(id: number, children: EngineNode[] = []): EngineNode {
  return {
    id, name: `n${id}`, type: 'FRAME', x: 0, y: 0, width: 10, height: 10,
    rotation: 0, absoluteBounds: null, visible: true, locked: false, opacity: 1,
    fills: [], strokes: [], strokeWeight: 0, cornerRadius: null, clip: false,
    characters: null, fontFamily: null, fontStyle: null, fontSize: null,
    textAlign: null, lineHeight: null, children, childCount: null,
  };
}

test('flattenTree lists top-most first and honors expansion', () => {
  const kid = node(4);
  const frame = node(2, [kid]);
  const root = node(1, [node(3), frame]); // 3 bottom, frame top
  const flat = flattenTree(root, new Set());
  assert(flat.map((r) => r.node.id).join(',') === '2,3', 'top-most first');
  assert(flat[0].index === 1 && flat[1].index === 0, 'engine indices kept');
  assert(flat.every((r) => r.parentId === 1), 'parent ids');
  const open = flattenTree(root, new Set([2]));
  assert(open.map((r) => r.node.id).join(',') === '2,4,3', 'expanded child inline');
  assert(open[1].depth === 1, 'child depth');
});

test('parentMap and subtreeIds guard drops', () => {
  const root = node(1, [node(2, [node(4)]), node(3)]);
  const pm = parentMap(root);
  assert(pm.get(4) === 2 && pm.get(2) === 1 && pm.get(1) === 1, 'parents');
  const sub = subtreeIds(root, 2);
  assert(sub.has(2) && sub.has(4) && !sub.has(3), 'subtree membership');
  assert(subtreeIds(root, 99).size === 0, 'missing id is empty');
});

test('dropIndex maps display rows to engine indices', () => {
  // 3 children [c0,c1,c2] displayed top-first as rows 0:c2 1:c1 2:c0.
  assert(dropIndex(3, 0, 'before') === 3, 'above the top lands on top');
  assert(dropIndex(3, 0, 'after') === 2, 'below row 0');
  assert(dropIndex(3, 1, 'before') === 2, 'above row 1');
  assert(dropIndex(3, 1, 'after') === 1, 'below row 1');
  assert(dropIndex(3, 2, 'after') === 0, 'below the bottom lands at bottom');
  assert(dropIndex(0, 0, 'before') === 0, 'empty parent takes 0');
});

test('adjustedReorderIndex compensates the lift-out shift', () => {
  assert(adjustedReorderIndex(1, 3) === 2, 'downward drop shifts');
  assert(adjustedReorderIndex(3, 1) === 1, 'upward drop keeps');
  assert(adjustedReorderIndex(1, 1) === 1, 'same slot keeps');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL TREE TESTS PASSED');
