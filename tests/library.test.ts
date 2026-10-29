/**
 * Regression tests for reusable components (sources, expansion,
 * override propagation, detach, clone remap).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  buildInstance,
  createComponent,
  creationBlockers,
  detachComponents,
  detachInstance,
  diffProps,
  expandChildren,
  expansionId,
  liveSource,
  regenInstances,
  remapClonedInstances,
  resetInstance,
} from '../src/library';
import { pageMatrixOf } from '../src/transform';
import type { Matrix } from '../src/transform';
import type { DesignObject, DocPage, ObjectType, UndesignDoc } from '../src/types';

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
function obj(type: ObjectType, over: Partial<DesignObject> = {}): DesignObject {
  seq += 1;
  return {
    id: `c${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null,
    constraints: null,
    stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    componentId: null, sourceId: null, componentSnapshot: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    clip: false,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  };
}

function page(id: string, objects: DesignObject[]): DocPage {
  return { id, name: id, objects };
}

function doc(pages: DocPage[]): UndesignDoc {
  return { version: 1, name: 't', pages, activePageId: pages[0].id, components: [] };
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

const PACK = {
  compId: 'c1',
  componentsPageId: 'cp',
  sourceRootId: 'sr',
  instanceId: 'i1',
  cloneId: (old: string) => `s_${old}`,
};

function twoRects(): DesignObject[] {
  return [
    obj('rectangle', { id: 'a', x: 10, y: 10, w: 50, h: 40, fill: '#111111' }),
    obj('rectangle', { id: 'b', x: 100, y: 80, w: 60, h: 30, fill: '#222222' }),
  ];
}

function created(): UndesignDoc {
  const r = createComponent(doc([page('p', twoRects())]), 'p', ['a', 'b'], 'Card', PACK);
  if ('error' in r) throw new Error(`creation failed: ${r.error}`);
  return r.doc;
}

test('createComponent wraps selection and preserves page visuals', () => {
  const before = twoRects();
  const d = created();
  assert(d.components.length === 1, 'def registered');
  assert(d.components[0].pageId === 'cp' && d.components[0].rootId === 'sr', 'def points at source');
  const main = byId(d.pages.flatMap((p) => (p.id === 'p' ? p.objects : [])), 'i1');
  assert(main.type === 'frame' && main.componentId === 'c1', 'instance root placed');
  assert(main.x === 10 && main.y === 10 && main.w === 150 && main.h === 100, 'root wraps union');
  assert(!d.pages[0].objects.some((o) => o.id === 'a' || o.id === 'b'), 'originals replaced');
  const cp = d.pages.find((p) => p.id === 'cp');
  assert(cp !== undefined && cp.objects.length === 3, 'source page holds wrapper + clones');
  assert(byId(cp!.objects, 'sr').type === 'frame', 'source wrapper is a frame');
  for (const [oldId, newId] of [['a', expansionId('i1', 's_a')], ['b', expansionId('i1', 's_b')]] as const) {
    const exp = byId(d.pages[0].objects, newId);
    assert(exp.sourceId === `s_${oldId}`, 'expansion marked');
    assert(matEq(pageMatrixOf(before, byId(before, oldId)), pageMatrixOf(d.pages[0].objects, exp)), `${oldId} visuals exact`);
  }
  assert(Object.keys(main.componentSnapshot ?? {}).length === 2, 'snapshot covers children');
});

test('createComponent nests source clones under rotated parents exactly', () => {
  const f = obj('frame', { id: 'f', x: 200, y: 200, w: 300, h: 300, rotation: 30 });
  const a = obj('rectangle', { id: 'a', parentId: 'f', x: 10, y: 10, w: 50, h: 50, fill: '#333333' });
  const r = createComponent(doc([page('p', [f, a])]), 'p', ['a'], 'Chip', PACK);
  if ('error' in r) throw new Error(`creation failed: ${r.error}`);
  const exp = byId(r.doc.pages[0].objects, expansionId('i1', 's_a'));
  assert(matEq(pageMatrixOf([f, a], a), pageMatrixOf(r.doc.pages[0].objects, exp)), 'nested visuals exact');
});

test('creation rejects empty selections and instance content', () => {
  const d0 = doc([page('p', twoRects())]);
  assert((createComponent(d0, 'p', [], 'X', PACK) as { error: string }).error === 'empty', 'empty');
  assert((createComponent(d0, 'p', ['zzz'], 'X', PACK) as { error: string }).error === 'empty', 'unknown');
  const d1 = created();
  assert(creationBlockers(d1.pages[0].objects, ['i1']) === 'nested', 'instance root blocked');
  assert(creationBlockers(d1.pages[0].objects, [expansionId('i1', 's_a')]) === 'nested', 'expansion blocked');
  assert(creationBlockers(d1.pages[0].objects, ['nope']) === 'empty', 'blocker empty');
  assert(creationBlockers(d0.pages[0].objects, ['a']) === null, 'plain selection allowed');
});

test('source edits propagate; user overrides survive', () => {
  let d = created();
  // User override: move one expanded child + recolor it.
  const ea = expansionId('i1', 's_a');
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id !== 'p' ? p : { ...p, objects: p.objects.map((o) => (o.id === ea ? { ...o, x: o.x + 5, fill: '#999999' } : o)) },
    ),
  };
  // Source edit: change the OTHER prop (stroke) on s_a and fill on s_b.
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id !== 'cp' ? p : {
        ...p,
        objects: p.objects.map((o) =>
          o.id === 's_a' ? { ...o, stroke: '#00FF00', strokeWidth: 2 } : o.id === 's_b' ? { ...o, fill: '#444444' } : o,
        ),
      },
    ),
  };
  const next = regenInstances(d);
  assert(next !== d, 'regen produced updates');
  const main = next.pages[0].objects;
  const ma = byId(main, ea);
  assert(ma.fill === '#999999', 'fill override kept');
  assert(ma.x === byId(d.pages[0].objects, ea).x, 'position override kept');
  assert(ma.stroke === '#00FF00' && ma.strokeWidth === 2, 'source stroke arrives');
  assert(byId(main, expansionId('i1', 's_b')).fill === '#444444', 'unmodified child follows source');
});

test('structural source changes add and remove expansion children', () => {
  let d = created();
  // Add a source child.
  const extra = obj('ellipse', { id: 's_n', parentId: 'sr', x: 5, y: 5, w: 20, h: 20 });
  d = { ...d, pages: d.pages.map((p) => (p.id === 'cp' ? { ...p, objects: [...p.objects, extra] } : p)) };
  let next = regenInstances(d);
  assert(next.pages[0].objects.some((o) => o.id === expansionId('i1', 's_n')), 'added child expands');
  // Remove it again.
  d = { ...next, pages: next.pages.map((p) => (p.id === 'cp' ? { ...p, objects: p.objects.filter((o) => o.id !== 's_n') } : p)) };
  next = regenInstances(d);
  assert(!next.pages[0].objects.some((o) => o.id === expansionId('i1', 's_n')), 'removed child retracts');
});

test('regen is a ref-preserving no-op when nothing changed', () => {
  const d = created();
  assert(regenInstances(d) === d, 'stable state untouched');
  const plain = doc([page('p', twoRects())]);
  assert(regenInstances(plain) === plain, 'component-free doc untouched');
});

test('missing sources freeze instances instead of breaking', () => {
  const d = created();
  const broken: UndesignDoc = { ...d, pages: d.pages.filter((p) => p.id !== 'cp') };
  assert(regenInstances(broken) === broken, 'frozen without changes');
});

test('detachInstance clears markers and keeps geometry', () => {
  const d = created();
  const main = d.pages[0].objects;
  const before = JSON.stringify(main.map((o) => [o.id, o.x, o.y, o.w, o.h, o.fill]));
  const next = detachInstance(main, 'i1');
  assert(next !== null, 'detached');
  assert(byId(next!, 'i1').componentId === null, 'root plain');
  assert(next!.every((o) => o.sourceId === null), 'children plain');
  assert(JSON.stringify(next!.map((o) => [o.id, o.x, o.y, o.w, o.h, o.fill])) === before, 'visuals kept');
  assert(detachInstance(main, 'a') === null, 'non-instance rejected');
});

test('resetInstance drops overrides back to the source', () => {
  let d = created();
  const ea = expansionId('i1', 's_a');
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id !== 'p' ? p : { ...p, objects: p.objects.map((o) => (o.id === ea ? { ...o, fill: '#999999' } : o)) },
    ),
  };
  const next = resetInstance(d, 'i1');
  assert(byId(next.pages[0].objects, ea).fill === '#111111', 'override dropped');
  assert(resetInstance(next, 'i1') === next, 'fresh reset is a no-op');
});

test('detachComponents drops defs and detaches every instance', () => {
  const d = created();
  const next = detachComponents(d, ['c1']);
  assert(next.components.length === 0, 'def dropped');
  assert(next.pages[0].objects.every((o) => o.componentId === null && o.sourceId === null), 'instances plain');
  assert(detachComponents(d, ['zzz']) === d, 'unknown def untouched');
});

test('buildInstance expands a fresh instance from a def', () => {
  const d = created();
  const b = buildInstance(d, 'c1', 'i2');
  assert(b !== null, 'built');
  assert(b!.root.componentId === 'c1' && b!.root.name === 'Card', 'root marked');
  assert(b!.children.length === 2, 'children expanded');
  assert(b!.children.every((c) => c.parentId === 'i2' && c.sourceId !== null), 'children parented');
  assert(buildInstance(d, 'zzz', 'i9') === null, 'unknown def rejected');
  const src = liveSource(d, d.components[0]);
  assert(src !== null && src.subtree.length === 3, 'source resolves');
  assert(expansionId('i', 's') === 'i__x__s', 'id scheme');
  assert(expandChildren(src!.root, src!.subtree.slice(1), 'i7').length === 2, 'expandChildren arity');
});

test('diffProps reports only real changes', () => {
  const a = obj('rectangle', { id: 'a', x: 1, fill: '#111111' });
  const b = { ...a, x: 2 };
  assert(JSON.stringify(diffProps(b, a)) === JSON.stringify({ x: 2 }), 'single prop');
  assert(JSON.stringify(diffProps(a, a)) === JSON.stringify({}), 'identical');
  assert(JSON.stringify(diffProps({ ...a, id: 'z' }, a)) === JSON.stringify({}), 'id ignored');
});

test('remapClonedInstances re-identifies copies and strips lone children', () => {
  const d = created();
  const root = byId(d.pages[0].objects, 'i1');
  const kid = byId(d.pages[0].objects, expansionId('i1', 's_a'));
  // Simulate a duplicate: same markers, fresh random ids.
  const clones: DesignObject[] = [
    { ...root, id: 'r2' },
    { ...kid, id: 'k2', parentId: 'r2' },
  ];
  const out = remapClonedInstances(clones, () => 'ni2');
  assert(byId(out, 'ni2').componentId === 'c1', 'root re-identified');
  assert(out.some((o) => o.id === expansionId('ni2', 's_a') && o.parentId === 'ni2'), 'child remapped');
  const snap = byId(out, 'ni2').componentSnapshot as Record<string, DesignObject>;
  assert(snap['s_a'].id === expansionId('ni2', 's_a'), 'snapshot remapped');
  // Lone child without its root becomes a plain object.
  const lone = remapClonedInstances([{ ...kid, id: 'k9', parentId: null }], () => 'unused');
  assert(lone[0].sourceId === null, 'lone child stripped');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL LIBRARY TESTS PASSED');
