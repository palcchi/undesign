/**
 * Regression tests for responsive constraints (children follow frame resizes).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { propagateConstraints } from '../src/layout';
import type { Constraints, DesignObject, DocPage, ObjectType, UndesignDoc } from '../src/types';

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
    id: `l${seq}`,
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

function doc(objects: DesignObject[]): UndesignDoc {
  const p: DocPage = { id: 'p', name: 'p', objects };
  return { version: 1, name: 't', pages: [p], activePageId: 'p', components: [], colorStyles: [], prototypeLinks: [] };
}

function frame(w: number, h: number): DesignObject {
  return obj('frame', { id: 'f', w, h });
}

function kid(over: Partial<DesignObject> = {}): DesignObject {
  return obj('rectangle', { id: 'k', parentId: 'f', x: 150, y: 140, w: 30, h: 20, ...over });
}

function resized(next: UndesignDoc, w: number, h: number): UndesignDoc {
  return {
    ...next,
    pages: next.pages.map((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === 'f' ? { ...o, w, h } : o)),
    })),
  };
}

function cx(c: Partial<Constraints>): Constraints {
  return { horizontal: 'left', vertical: 'top', ...c };
}

test('right and bottom pins keep the far offset', () => {
  const prev = doc([frame(200, 200), kid({ constraints: cx({ horizontal: 'right', vertical: 'bottom' }) })]);
  const out = propagateConstraints(prev, resized(prev, 300, 300)).pages[0].objects[1];
  assert(out.x === 250 && out.y === 240, `far corner follows (got ${out.x},${out.y})`);
  assert(out.w === 30 && out.h === 20, 'size untouched');
});

test('center and middle keep the center offset', () => {
  const prev = doc([frame(200, 200), kid({ x: 10, y: 10, w: 20, h: 20, constraints: cx({ horizontal: 'center', vertical: 'middle' }) })]);
  const out = propagateConstraints(prev, resized(prev, 300, 300)).pages[0].objects[1];
  assert(out.x === 60 && out.y === 60, `centered (got ${out.x},${out.y})`);
});

test('stretch grows with the parent, clamped at 1', () => {
  const prev = doc([frame(200, 200), kid({ x: 10, y: 10, w: 170, h: 20, constraints: cx({ horizontal: 'stretch' }) })]);
  const grown = propagateConstraints(prev, resized(prev, 300, 200)).pages[0].objects[1];
  assert(grown.x === 10 && grown.w === 270, `grows (got w=${grown.w})`);
  const shrunk = propagateConstraints(prev, resized(prev, 100, 200)).pages[0].objects[1];
  assert(shrunk.w === 70, `shrinks (got w=${shrunk.w})`);
  const crushed = propagateConstraints(prev, resized(prev, 5, 200)).pages[0].objects[1];
  assert(crushed.w === 1, `clamped (got w=${crushed.w})`);
});

test('scale multiplies position and size', () => {
  const prev = doc([frame(200, 200), kid({ x: 10, y: 10, w: 20, h: 20, constraints: cx({ horizontal: 'scale', vertical: 'scale' }) })]);
  const out = propagateConstraints(prev, resized(prev, 300, 100)).pages[0].objects[1];
  assert(out.x === 15 && out.w === 30, `x scales (got ${out.x},${out.w})`);
  assert(out.y === 5 && out.h === 10, `y scales (got ${out.y},${out.h})`);
});

test('defaults, non-frames, and missing parents are untouched', () => {
  const prev = doc([
    frame(200, 200),
    kid({ id: 'plain' }),
    obj('rectangle', { id: 'r', x: 0, y: 0, w: 200, h: 200 }),
    kid({ id: 'nfp', parentId: 'r', constraints: cx({ horizontal: 'right' }) }),
  ]);
  const out = propagateConstraints(prev, resized(prev, 300, 300));
  assert(out.pages[0].objects[1] === prev.pages[0].objects[1], 'unconstrained child keeps ref');
  assert(out.pages[0].objects[3].x === 150, 'non-frame parent ignored');
});

test('direct child edits in the same commit are preserved', () => {
  const prev = doc([frame(200, 200), kid({ constraints: cx({ horizontal: 'right' }) })]);
  const next = resized(prev, 300, 200);
  const edited: UndesignDoc = {
    ...next,
    pages: next.pages.map((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === 'k' ? { ...o, x: o.x + 7 } : o)),
    })),
  };
  const out = propagateConstraints(prev, edited).pages[0].objects[1];
  assert(out.x === 257, `delta applies onto the edit (got ${out.x})`);
});

test('no-op passes preserve references', () => {
  const d = doc([frame(200, 200), kid({ constraints: cx({ horizontal: 'right' }) })]);
  assert(propagateConstraints(d, d) === d, 'identical states');
  const sameSize = resized(d, 200, 200);
  assert(propagateConstraints(d, sameSize) === sameSize, 'unchanged size returns next untouched');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL LAYOUT TESTS PASSED');
