/**
 * Regression tests for deletion planning and cycle-safe traversal.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { planObjectDeletion } from '../src/docpatch';
import { descendantIds } from '../src/utils';
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

/* ---------- deletion planning ---------- */

test('plain ids are allowed with their whole subtree doomed', () => {
  const frame = mkObj({ id: 'f', type: 'frame', w: 200, h: 200 });
  const kid = mkObj({ id: 'k', parentId: 'f' });
  const grand = mkObj({ id: 'g', parentId: 'k' });
  const other = mkObj({ id: 'o' });
  const plan = planObjectDeletion([frame, kid, grand, other], ['f']);
  assert(JSON.stringify(plan.allowed) === '["f"]', 'frame allowed');
  assert(plan.locked.length === 0, 'nothing locked');
  assert(
    plan.doomed.has('f') && plan.doomed.has('k') && plan.doomed.has('g') && !plan.doomed.has('o'),
    `subtree doomed, outsider spared (got ${[...plan.doomed]})`,
  );
});

test('expansion children locked in an instance are never doomed', () => {
  const root = mkObj({ id: 'inst', type: 'frame', componentId: 'c1', w: 200, h: 200 });
  const child = mkObj({ id: 'inst__x__s1', parentId: 'inst', sourceId: 's1' });
  const plain = mkObj({ id: 'p' });
  const objects = [root, child, plain];
  const onlyLocked = planObjectDeletion(objects, ['inst__x__s1']);
  assert(onlyLocked.allowed.length === 0, 'locked child not allowed');
  assert(JSON.stringify(onlyLocked.locked) === '["inst__x__s1"]', 'locked child reported');
  assert(onlyLocked.doomed.size === 0, 'nothing doomed');
  const mixed = planObjectDeletion(objects, ['inst__x__s1', 'p']);
  assert(JSON.stringify(mixed.allowed) === '["p"]', 'plain object still allowed');
  assert(mixed.doomed.has('p') && !mixed.doomed.has('inst__x__s1'), 'locked child spared');
});

test('deleting an instance root still removes its expansion with it', () => {
  const root = mkObj({ id: 'inst', type: 'frame', componentId: 'c1', w: 200, h: 200 });
  const child = mkObj({ id: 'inst__x__s1', parentId: 'inst', sourceId: 's1' });
  const plan = planObjectDeletion([root, child], ['inst']);
  assert(plan.locked.length === 0, 'root itself is deletable');
  assert(plan.doomed.has('inst') && plan.doomed.has('inst__x__s1'), 'root + expansion doomed');
});

test('unknown ids are harmless', () => {
  const plan = planObjectDeletion([mkObj({ id: 'a' })], ['ghost']);
  assert(JSON.stringify(plan.allowed) === '["ghost"]', 'passed through');
  assert(plan.locked.length === 0, 'nothing locked');
});

/* ---------- cycle-safe traversal ---------- */

test('descendantIds terminates on cyclic parents', () => {
  const a = mkObj({ id: 'a', type: 'frame', parentId: 'b' });
  const b = mkObj({ id: 'b', type: 'frame', parentId: 'a' });
  const self = mkObj({ id: 's', type: 'frame', parentId: 's' });
  const kids = descendantIds([a, b, self], 'a');
  assert(kids.includes('b'), `reaches the child (got ${kids})`);
  assert(kids.length === new Set(kids).size, 'no duplicates');
  assert(JSON.stringify(descendantIds([a, b, self], 's')) === '[]', 'self-parent has no descendants');
});

test('descendantIds keeps depth-first order on healthy trees', () => {
  const f = mkObj({ id: 'f', type: 'frame' });
  const k1 = mkObj({ id: 'k1', parentId: 'f' });
  const g1 = mkObj({ id: 'g1', parentId: 'k1' });
  const k2 = mkObj({ id: 'k2', parentId: 'f' });
  assert(
    JSON.stringify(descendantIds([f, k1, g1, k2], 'f')) === '["k1","g1","k2"]',
    'pre-order preserved',
  );
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL DELETE TESTS PASSED');
