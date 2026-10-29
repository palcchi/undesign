/**
 * Regression tests for auto-layout (frame direction, gap, padding, alignment,
 * hug/fill/fixed sizing, min/max clamps, absolute children, nesting, and the
 * constraints interplay). Run with `npm test`.
 */
import { defaultMeasureLine, layoutFrames, propagateConstraints } from '../src/layout';
import { createSampleDoc } from '../src/sample';
import { validateDoc } from '../src/storage';
import { propagateTextStyles } from '../src/system';
import { autoTextHeight } from '../src/utils';
import type { DesignObject, DocPage, FrameLayout, ObjectType, TextStyle, UndesignDoc } from '../src/types';

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
    id: `a${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, textStyleId: null, shadow: null, effectStyleId: null, constraints: null,
    layout: null, sizing: null,
    stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    componentId: null, sourceId: null, componentSnapshot: null, variant: null,
    exposedValues: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    clip: false,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  } as DesignObject;
}

function page(id: string, objects: DesignObject[]): DocPage {
  return { id, name: id, objects };
}

function doc(pages: DocPage[]): UndesignDoc {
  return {
    version: 1, name: 't', pages, activePageId: pages[0].id,
    components: [], variantSets: [], colorStyles: [], textStyles: [],
    effectStyles: [], prototypeLinks: [],
  } as UndesignDoc;
}

function byId(objects: DesignObject[], id: string): DesignObject {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`missing object ${id}`);
  return o;
}

function row(over: Partial<FrameLayout> = {}): FrameLayout {
  return {
    direction: 'horizontal', gap: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    alignMain: 'start', alignCross: 'start', ...over,
  };
}

// Deterministic text measurement: 10px per character.
const measure = (line: string): number => line.length * 10;

test('docs without layout blocks return the identical doc reference', () => {
  const d = doc([page('p', [obj('rectangle', { id: 'r' }), obj('frame', { id: 'f' })])]);
  assert(layoutFrames(d, measure) === d, 'expected untouched ref');
});

test('horizontal row honors gap, padding, and start alignment', () => {
  const f = obj('frame', {
    id: 'f', w: 400, h: 100,
    layout: row({ gap: 10, paddingLeft: 8, paddingTop: 6 }),
  });
  const a = obj('rectangle', { id: 'a', parentId: 'f', x: 200, y: 90, w: 50, h: 40 });
  const b = obj('rectangle', { id: 'b', parentId: 'f', x: 0, y: 0, w: 60, h: 30 });
  const out = layoutFrames(doc([page('p', [f, a, b])]), measure).pages[0].objects;
  const ra = byId(out, 'a');
  const rb = byId(out, 'b');
  assert(ra.x === 8 && ra.y === 6, `a at ${ra.x},${ra.y}`);
  assert(rb.x === 68 && rb.y === 6, `b at ${rb.x},${rb.y}`);
  assert(ra.w === 50 && rb.w === 60, 'fixed widths kept');
});

test('vertical column stacks top to bottom', () => {
  const f = obj('frame', {
    id: 'f', w: 100, h: 400,
    layout: row({ direction: 'vertical', gap: 5, paddingTop: 4, paddingLeft: 7 }),
  });
  const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
  const b = obj('rectangle', { id: 'b', parentId: 'f', w: 60, h: 30 });
  const out = layoutFrames(doc([page('p', [f, a, b])]), measure).pages[0].objects;
  const ra = byId(out, 'a');
  const rb = byId(out, 'b');
  assert(ra.x === 7 && ra.y === 4, `a at ${ra.x},${ra.y}`);
  assert(rb.x === 7 && rb.y === 49, `b at ${rb.x},${rb.y}`);
});

test('main-axis center, end, and space-between place the flow', () => {
  const mk = (alignMain: FrameLayout['alignMain']): DesignObject[] => {
    const f = obj('frame', { id: 'f', w: 300, h: 100, layout: row({ gap: 10, alignMain }) });
    const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
    const b = obj('rectangle', { id: 'b', parentId: 'f', w: 50, h: 40 });
    return layoutFrames(doc([page('p', [f, a, b])]), measure).pages[0].objects;
  };
  const c = mk('center');
  assert(byId(c, 'a').x === 95 && byId(c, 'b').x === 155, 'center');
  const e = mk('end');
  assert(byId(e, 'a').x === 190 && byId(e, 'b').x === 250, 'end');
  const s = mk('space-between');
  assert(byId(s, 'a').x === 0 && byId(s, 'b').x === 250, 'space-between');
});

test('cross-axis alignment offsets each item independently', () => {
  const mk = (alignCross: FrameLayout['alignCross']): DesignObject[] => {
    const f = obj('frame', { id: 'f', w: 300, h: 100, layout: row({ alignCross }) });
    const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
    return layoutFrames(doc([page('p', [f, a])]), measure).pages[0].objects;
  };
  assert(byId(mk('start'), 'a').y === 0, 'start');
  assert(byId(mk('center'), 'a').y === 30, 'center');
  assert(byId(mk('end'), 'a').y === 60, 'end');
});

test('hug text child measures its longest line', () => {
  const f = obj('frame', { id: 'f', w: 400, h: 100, layout: row({}) });
  const t = obj('text', {
    id: 't', parentId: 'f', text: 'hi\nyo ho', fontSize: 16,
    sizing: { h: 'hug', v: 'hug', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const out = layoutFrames(doc([page('p', [f, t])]), measure).pages[0].objects;
  const rt = byId(out, 't');
  assert(rt.w === 50, `w ${rt.w}`);
  assert(rt.h === autoTextHeight('hi\nyo ho', 16, 1.4), `h ${rt.h}`);
});

test('hug respects the child min/max window', () => {
  const f = obj('frame', { id: 'f', w: 400, h: 100, layout: row({}) });
  const t = obj('text', {
    id: 't', parentId: 'f', text: 'hi', fontSize: 16,
    sizing: { h: 'hug', v: 'fixed', minW: 40, maxW: 100, minH: null, maxH: null, absolute: false },
  });
  const out = layoutFrames(doc([page('p', [f, t])]), measure).pages[0].objects;
  assert(byId(out, 't').w === 40, 'min clamps the hug width');
});

test('main-axis fill splits the remainder equally', () => {
  const f = obj('frame', { id: 'f', w: 320, h: 100, layout: row({ gap: 20 }) });
  const fixed = obj('rectangle', { id: 'x', parentId: 'f', w: 100, h: 40 });
  const fill = (id: string): DesignObject => obj('rectangle', {
    id, parentId: 'f', w: 10, h: 40,
    sizing: { h: 'fill', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const out = layoutFrames(doc([page('p', [f, fixed, fill('a'), fill('b')])]), measure).pages[0].objects;
  // Remainder: 320 - 100 - 2*20 = 180; two fills -> 90 each.
  assert(byId(out, 'a').w === 90, `a ${byId(out, 'a').w}`);
  assert(byId(out, 'b').w === 90, `b ${byId(out, 'b').w}`);
  assert(byId(out, 'a').x === 120 && byId(out, 'b').x === 230, 'positions follow sizes');
});

test('fill re-splits around min/max clamps', () => {
  const mk = (sizingA: DesignObject['sizing'], boxW: number): DesignObject[] => {
    const f = obj('frame', { id: 'f', w: boxW, h: 100, layout: row({}) });
    const a = obj('rectangle', { id: 'a', parentId: 'f', w: 10, h: 40, sizing: sizingA });
    const b = obj('rectangle', {
      id: 'b', parentId: 'f', w: 10, h: 40,
      sizing: { h: 'fill', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
    });
    return layoutFrames(doc([page('p', [f, a, b])]), measure).pages[0].objects;
  };
  const min = mk(
    { h: 'fill', v: 'fixed', minW: 120, maxW: null, minH: null, maxH: null, absolute: false }, 200,
  );
  assert(byId(min, 'a').w === 120 && byId(min, 'b').w === 80, 'min wins, sibling takes the rest');
  const max = mk(
    { h: 'fill', v: 'fixed', minW: null, maxW: 100, minH: null, maxH: null, absolute: false }, 400,
  );
  assert(byId(max, 'a').w === 100 && byId(max, 'b').w === 300, 'max caps, sibling takes the rest');
});

test('cross-axis fill stretches to the inner box', () => {
  const f = obj('frame', {
    id: 'f', w: 300, h: 100,
    layout: row({ paddingTop: 10, paddingBottom: 10 }),
  });
  const a = obj('rectangle', {
    id: 'a', parentId: 'f', w: 50, h: 5,
    sizing: { h: 'fixed', v: 'fill', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const out = layoutFrames(doc([page('p', [f, a])]), measure).pages[0].objects;
  const ra = byId(out, 'a');
  assert(ra.h === 80 && ra.y === 10, `h ${ra.h} y ${ra.y}`);
});

test('hug parent shrinks to its flow content', () => {
  const f = obj('frame', {
    id: 'f', w: 10, h: 10,
    layout: row({ gap: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5 }),
    sizing: { h: 'hug', v: 'hug', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
  const b = obj('rectangle', { id: 'b', parentId: 'f', w: 50, h: 30 });
  const out = layoutFrames(doc([page('p', [f, a, b])]), measure).pages[0].objects;
  const rf = byId(out, 'f');
  assert(rf.w === 120, `w ${rf.w}`);
  assert(rf.h === 50, `h ${rf.h}`);
});

test('hug parent keeps its size on axes with fill children', () => {
  const f = obj('frame', {
    id: 'f', w: 300, h: 10,
    layout: row({}),
    sizing: { h: 'hug', v: 'hug', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const a = obj('rectangle', {
    id: 'a', parentId: 'f', w: 10, h: 40,
    sizing: { h: 'fill', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const out = layoutFrames(doc([page('p', [f, a])]), measure).pages[0].objects;
  const rf = byId(out, 'f');
  assert(rf.w === 300, `main axis keeps size with fill, got ${rf.w}`);
  assert(rf.h === 40, `cross axis still hugs, got ${rf.h}`);
});

test('nested layout settles inner hug before the outer frame measures it', () => {
  const outer = obj('frame', { id: 'o', w: 400, h: 400, layout: row({}) });
  const inner = obj('frame', {
    id: 'i', parentId: 'o', w: 5, h: 5,
    layout: row({ direction: 'vertical', paddingTop: 4, paddingBottom: 4 }),
    sizing: { h: 'hug', v: 'hug', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const t = obj('text', {
    id: 't', parentId: 'i', text: 'hey', fontSize: 16,
    sizing: { h: 'hug', v: 'hug', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const out = layoutFrames(doc([page('p', [outer, inner, t])]), measure).pages[0].objects;
  const ri = byId(out, 'i');
  const rt = byId(out, 't');
  assert(rt.w === 30, `text w ${rt.w}`);
  assert(ri.w === 30, `inner w ${ri.w}`);
  assert(ri.h === rt.h + 8, `inner h ${ri.h} vs text ${rt.h}`);
  assert(ri.x === 0 && ri.y === 0, 'outer places the settled inner frame');
});

test('absolute children keep their geometry', () => {
  const f = obj('frame', { id: 'f', w: 400, h: 100, layout: row({ gap: 10 }) });
  const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
  const abs = obj('rectangle', {
    id: 'z', parentId: 'f', x: 300, y: 70, w: 20, h: 20,
    sizing: { h: 'fixed', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: true },
  });
  const out = layoutFrames(doc([page('p', [f, a, abs])]), measure).pages[0].objects;
  const rz = byId(out, 'z');
  assert(rz.x === 300 && rz.y === 70 && rz.w === 20, 'absolute untouched');
  assert(byId(out, 'a').x === 0, 'flow ignores the absolute child');
});

test('regen expansion mirrors are skipped by layout', () => {
  const f = obj('frame', { id: 'f', w: 400, h: 100, layout: row({ gap: 10 }) });
  const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
  const mirror = obj('rectangle', {
    id: 'i~s', parentId: 'f', x: 250, y: 10, w: 60, h: 40, sourceId: 's',
  });
  const out = layoutFrames(doc([page('p', [f, a, mirror])]), measure).pages[0].objects;
  assert(byId(out, 'i~s').x === 250, 'mirror keeps its regen-owned position');
  assert(byId(out, 'a').x === 0, 'flow ignores the mirror');
});

test('layout is idempotent: a settled doc solves to the same reference', () => {
  const f = obj('frame', {
    id: 'f', w: 10, h: 10,
    layout: row({ gap: 4, paddingLeft: 8, paddingRight: 8 }),
    sizing: { h: 'hug', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false },
  });
  const a = obj('rectangle', {
    id: 'a', parentId: 'f', w: 10, h: 40,
    sizing: { h: 'fill', v: 'fixed', minW: null, maxW: 90, minH: null, maxH: null, absolute: false },
  });
  const once = layoutFrames(doc([page('p', [f, a])]), measure);
  const twice = layoutFrames(once, measure);
  assert(twice === once, 'second pass changes nothing');
});

test('negative gaps clamp to zero', () => {
  const f = obj('frame', { id: 'f', w: 400, h: 100, layout: row({ gap: -20 }) });
  const a = obj('rectangle', { id: 'a', parentId: 'f', w: 50, h: 40 });
  const b = obj('rectangle', { id: 'b', parentId: 'f', w: 50, h: 40 });
  const out = layoutFrames(doc([page('p', [f, a, b])]), measure).pages[0].objects;
  assert(byId(out, 'b').x === 50, `b at ${byId(out, 'b').x}`);
});

test('constraints apply to absolute children but not flow children in layout frames', () => {
  const mk = (w: number): UndesignDoc => {
    const f = obj('frame', { id: 'f', w, h: 100, layout: row({}) });
    const flow = obj('rectangle', {
      id: 'c', parentId: 'f', x: 10, y: 10, w: 50, h: 40,
      constraints: { horizontal: 'scale', vertical: 'scale' },
    });
    const abs = obj('rectangle', {
      id: 'z', parentId: 'f', x: 10, y: 10, w: 50, h: 40,
      constraints: { horizontal: 'scale', vertical: 'scale' },
      sizing: { h: 'fixed', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: true },
    });
    return doc([page('p', [f, flow, abs])]);
  };
  const out = propagateConstraints(mk(100), mk(200)).pages[0].objects;
  const rc = byId(out, 'c');
  const rz = byId(out, 'z');
  assert(rc.x === 10 && rc.w === 50, 'flow child untouched by constraints');
  assert(rz.x === 20 && rz.w === 100, `absolute child scaled to ${rz.x},${rz.w}`);
});

test('constraints still apply to every child in non-layout frames', () => {
  const mk = (w: number): UndesignDoc => {
    const f = obj('frame', { id: 'f', w, h: 100 });
    const c = obj('rectangle', {
      id: 'c', parentId: 'f', x: 10, y: 10, w: 50, h: 40,
      constraints: { horizontal: 'scale', vertical: 'scale' },
    });
    return doc([page('p', [f, c])]);
  };
  const out = propagateConstraints(mk(100), mk(200)).pages[0].objects;
  const rc = byId(out, 'c');
  assert(rc.x === 20 && rc.w === 100, 'legacy behavior preserved');
});

test('default measurement falls back deterministically outside a browser', () => {
  assert(defaultMeasureLine('abcd', 'sans', 10, 400) === 4 * 10 * 0.55, 'fallback estimate');
});

test('storage preserves layout blocks and degrades garbage to null', () => {
  const good = obj('frame', {
    id: 'f', layout: row({ gap: 12 }),
    sizing: { h: 'hug', v: 'fill', minW: 10, maxW: null, minH: null, maxH: 90, absolute: false },
  });
  const bad = obj('rectangle', {
    id: 'r',
    layout: { direction: 'diagonal', gap: -5 } as unknown as FrameLayout,
    sizing: { h: 'stretch' } as unknown as DesignObject['sizing'],
  });
  const clean = validateDoc(doc([page('p', [good, bad])]));
  assert(clean !== null, 'doc validates');
  const rf = byId(clean.pages[0].objects, 'f');
  assert(rf.layout !== null && rf.layout.gap === 12, 'layout survives');
  assert(rf.sizing !== null && rf.sizing.h === 'hug' && rf.sizing.maxH === 90, 'sizing survives');
  const rr = byId(clean.pages[0].objects, 'r');
  assert(rr.layout === null && rr.sizing === null, 'garbage degrades');
  const legacy = validateDoc({ ...doc([page('p', [obj('frame', { id: 'l' })])]) });
  assert(legacy !== null && byId(legacy.pages[0].objects, 'l').layout === null, 'legacy docs default');
});

test('golden: the starter document has no layout blocks and solves untouched', () => {
  const sample = createSampleDoc();
  assert(layoutFrames(sample, measure) === sample, 'sample doc must stay layout-free');
});

test('instance roots participate in flow like any other child', () => {
  const f = obj('frame', { id: 'f', w: 400, h: 100, layout: row({ gap: 10 }) });
  const inst = obj('frame', {
    id: 'i', parentId: 'f', x: 300, y: 80, w: 60, h: 40, componentId: 'c1',
  });
  const out = layoutFrames(doc([page('p', [f, inst])]), measure).pages[0].objects;
  const ri = byId(out, 'i');
  assert(ri.x === 0 && ri.y === 0, `instance at ${ri.x},${ri.y}`);
});

test('perf smoke: 500 nodes across layout frames solve well inside budget', () => {
  const objects: DesignObject[] = [];
  for (let f = 0; f < 20; f++) {
    const fid = `pf${f}`;
    objects.push(obj('frame', { id: fid, w: 600, h: 60, layout: row({ gap: 4 }) }));
    for (let c = 0; c < 24; c++) {
      objects.push(obj('rectangle', {
        id: `pf${f}c${c}`, parentId: fid, x: c * 30, y: 0, w: 20, h: 40,
        sizing: c % 3 === 0
          ? { h: 'fill', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false }
          : null,
      }));
    }
  }
  const d = doc([page('p', objects)]);
  const t0 = Date.now();
  const once = layoutFrames(d, measure);
  const dt = Date.now() - t0;
  assert(once !== d, 'expected the pass to settle positions');
  assert(layoutFrames(once, measure) === once, 'second pass is a no-op');
  assert(dt < 2000, `solve took ${dt}ms`);
});

test('style-driven text growth re-settles layout in the commit order', () => {
  const f = obj('frame', { id: 'f', w: 200, h: 200, layout: row({ direction: 'vertical', gap: 8 }) });
  const t1 = obj('text', {
    id: 't1', parentId: 'f', text: 'hi', textStyleId: 'ts1',
    fontSize: 16, lineHeight: 1.4, w: 60, h: 16 * 1.4,
  });
  const t2 = obj('text', { id: 't2', parentId: 'f', text: 'yo', w: 60, h: 16 * 1.4 });
  const base = doc([page('p', [f, t1, t2])]);
  const style: TextStyle = {
    id: 'ts1', name: 'B', fontFamily: 'sans',
    fontSize: 16, fontWeight: 400, textAlign: 'left', lineHeight: 1.4,
  };
  const settled = layoutFrames({ ...base, textStyles: [style] }, measure);
  assert(byId(settled.pages[0].objects, 't2').y === 16 * 1.4 + 8, 'settled baseline');
  const edited: UndesignDoc = { ...settled, textStyles: [{ ...style, fontSize: 32 }] };
  // Same pass order as the store pipeline: propagate styles, then sweep layout.
  const mid = propagateTextStyles(settled, edited);
  assert(byId(mid.pages[0].objects, 't1').h === 32 * 1.4, 'text grew');
  assert(byId(mid.pages[0].objects, 't2').y === 16 * 1.4 + 8, 'layout stale before sweep');
  const out = layoutFrames(mid, measure);
  assert(byId(out.pages[0].objects, 't1').y === 0, 'first child stays parked');
  assert(byId(out.pages[0].objects, 't2').y === 32 * 1.4 + 8, 'final sweep re-settles followers');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL AUTOLAYOUT TESTS PASSED');
