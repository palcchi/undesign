/**
 * Regression tests for shared color styles (linked fills follow style edits).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { canHaveFillStyle, propagateStyles } from '../src/system';
import type { ColorStyle, DesignObject, DocPage, ObjectType, UndesignDoc } from '../src/types';

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
    id: `y${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, constraints: null,
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

function doc(pages: DocPage[], colorStyles: ColorStyle[] = []): UndesignDoc {
  return { version: 1, name: 't', pages, activePageId: pages[0].id, components: [], colorStyles, prototypeLinks: [] };
}

function styled(fillStyleId: string | null, fill = '#111111'): DesignObject {
  return obj('rectangle', { fillStyleId, fill });
}

test('editing a style recolors linked fills across pages', () => {
  const a = styled('s1');
  const b = styled('s1');
  const plain = styled(null, '#999999');
  const prev = doc(
    [
      { id: 'p1', name: 'p1', objects: [a, plain] },
      { id: 'p2', name: 'p2', objects: [b] },
    ],
    [{ id: 's1', name: 'Ink', color: '#111111' }],
  );
  const next: UndesignDoc = {
    ...prev,
    colorStyles: [{ id: 's1', name: 'Ink', color: '#FF0000' }],
  };
  const out = propagateStyles(prev, next);
  assert(out !== next, 'new doc produced');
  assert(out.pages[0].objects[0].fill === '#FF0000', 'page 1 linked');
  assert(out.pages[1].objects[0].fill === '#FF0000', 'page 2 linked');
  assert(out.pages[0].objects[1].fill === '#999999', 'unlinked untouched');
  assert(out.pages[0].objects[1] === prev.pages[0].objects[1], 'unlinked keeps ref');
});

test('only changed styles propagate; add/remove are no-ops', () => {
  const a = styled('s1', '#111111');
  const b = styled('s2', '#222222');
  const prev = doc([{ id: 'p', name: 'p', objects: [a, b] }], [
    { id: 's1', name: 'A', color: '#111111' },
    { id: 's2', name: 'B', color: '#222222' },
  ]);
  const edited: UndesignDoc = {
    ...prev,
    colorStyles: [
      { id: 's1', name: 'A', color: '#FF0000' },
      { id: 's2', name: 'B renamed', color: '#222222' },
    ],
  };
  const out = propagateStyles(prev, edited);
  assert(out.pages[0].objects[0].fill === '#FF0000', 'changed style applies');
  assert(out.pages[0].objects[1] === b, 'rename-only keeps ref');
  const added: UndesignDoc = { ...prev, colorStyles: [...prev.colorStyles, { id: 's3', name: 'C', color: '#333333' }] };
  assert(propagateStyles(prev, added) === added, 'added style no-op');
  const removed: UndesignDoc = { ...prev, colorStyles: [] };
  assert(propagateStyles(prev, removed) === removed, 'removed style no-op');
  assert(propagateStyles(prev, prev) === prev, 'identical states');
});

test('canHaveFillStyle matches fill-capable types', () => {
  assert(canHaveFillStyle('frame'), 'frame');
  assert(canHaveFillStyle('rectangle'), 'rectangle');
  assert(canHaveFillStyle('ellipse'), 'ellipse');
  assert(canHaveFillStyle('text'), 'text');
  assert(!canHaveFillStyle('line'), 'line excluded');
  assert(!canHaveFillStyle('image'), 'image excluded');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL SYSTEM TESTS PASSED');
