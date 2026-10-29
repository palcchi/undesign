/**
 * Regression tests for frame-aware SVG export (nested selection export).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { pageToSvg } from '../src/utils';
import type { DesignObject, DocPage } from '../src/types';

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

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function viewBoxOf(svg: string): [number, number, number, number] {
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) throw new Error('no viewBox found');
  const parts = m[1].split(' ').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`malformed viewBox: ${m[1]}`);
  }
  return parts as [number, number, number, number];
}

function assertNear(actual: number, expected: number, msg: string, eps = 0.05): void {
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
    cornerRadius: 0,
    cornerRadii: null,
    imageId: null,
    componentId: null,
    sourceId: null,
    componentSnapshot: null,
    imageName: '',
    naturalW: 0,
    naturalH: 0,
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

function page(objects: DesignObject[]): DocPage {
  return { id: 'p', name: 'p', objects };
}

/* ---------- root and nested rendering ---------- */

test('single root object exports with tight viewBox', () => {
  const svg = pageToSvg(page([mkObj({ id: 'r', x: 10, y: 20, w: 100, h: 50 })]));
  assert(svg.includes('<rect'), 'rect rendered');
  const [x, y, w, h] = viewBoxOf(svg);
  assertNear(x, 10, 'vb x');
  assertNear(y, 20, 'vb y');
  assertNear(w, 100, 'vb w');
  assertNear(h, 50, 'vb h');
  assert(svg.includes('width="100"'), 'output width');
  assert(svg.includes('height="50"'), 'output height');
});

test('objects outside the origin shift the viewBox, not the artwork', () => {
  const svg = pageToSvg(page([mkObj({ id: 'r', x: 200, y: 100, w: 60, h: 40 })]));
  const [x, y, w, h] = viewBoxOf(svg);
  assertNear(x, 200, 'vb x');
  assertNear(y, 100, 'vb y');
  assertNear(w, 60, 'vb w');
  assertNear(h, 40, 'vb h');
});

test('single child exports at page coords without its frame', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 100, y: 50, w: 400, h: 300, fill: '#ABCDEF' });
  const c = mkObj({ id: 'c', parentId: 'f', x: 10, y: 20, w: 60, h: 40 });
  const svg = pageToSvg(page([f, c]), ['c']);
  assert(!svg.includes('#ABCDEF'), 'frame itself not rendered');
  assert(svg.includes('matrix(1 0 0 1 100 50)'), 'ancestor offset wrapper present');
  assert(svg.includes('translate(10 20)'), 'child local translate present');
  const [x, y, w, h] = viewBoxOf(svg);
  assertNear(x, 110, 'vb x');
  assertNear(y, 70, 'vb y');
  assertNear(w, 60, 'vb w');
  assertNear(h, 40, 'vb h');
});

test('multiple siblings export without the frame', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 100, y: 50, w: 400, h: 300, fill: '#ABCDEF' });
  const a = mkObj({ id: 'a', parentId: 'f', x: 0, y: 0, w: 50, h: 50, fill: '#111111' });
  const b = mkObj({ id: 'b', parentId: 'f', x: 100, y: 100, w: 50, h: 50, fill: '#222222' });
  const svg = pageToSvg(page([f, a, b]), ['a', 'b']);
  assert(!svg.includes('#ABCDEF'), 'frame not rendered');
  assert(svg.includes('#111111') && svg.includes('#222222'), 'both siblings rendered');
  const [x, y, w, h] = viewBoxOf(svg);
  assertNear(x, 100, 'vb x');
  assertNear(y, 50, 'vb y');
  assertNear(w, 150, 'vb w');
  assertNear(h, 150, 'vb h');
});

test('exported frame includes descendants at nested positions', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 100, y: 50, w: 400, h: 300 });
  const c = mkObj({ id: 'c', type: 'text', parentId: 'f', x: 10, y: 20, w: 200, h: 24, text: 'NESTED-CHILD' });
  const svg = pageToSvg(page([f, c]), ['f']);
  assert(svg.includes('NESTED-CHILD'), 'descendant rendered');
  assert(svg.includes('translate(100 50)'), 'frame positioned');
  assert(svg.includes('translate(10 20)'), 'child nested inside frame');
});

test('mixed parent+child selection renders the child exactly once', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300 });
  const c = mkObj({ id: 'c', type: 'text', parentId: 'f', x: 10, y: 20, w: 200, h: 24, text: 'CHILD-UNIQUE-1' });
  const svg = pageToSvg(page([f, c]), ['f', 'c']);
  assert(count(svg, 'CHILD-UNIQUE-1') === 1, 'no duplicate rendering');
});

test('triple-nested frames compose translations', () => {
  const f1 = mkObj({ id: 'f1', type: 'frame', x: 10, y: 10, w: 500, h: 500 });
  const f2 = mkObj({ id: 'f2', type: 'frame', parentId: 'f1', x: 20, y: 20, w: 300, h: 300 });
  const r = mkObj({ id: 'r', parentId: 'f2', x: 5, y: 5, w: 30, h: 10 });
  const svg = pageToSvg(page([f1, f2, r]));
  assert(svg.includes('translate(10 10)'), 'outer frame');
  assert(svg.includes('translate(20 20)'), 'middle frame');
  assert(svg.includes('translate(5 5)'), 'innermost rect');
  const [x, y] = viewBoxOf(svg);
  assertNear(x, 10, 'vb x');
  assertNear(y, 10, 'vb y');
});

test('negative-dimension lines export correct local endpoints', () => {
  const line = mkObj({ id: 'l', type: 'line', x: 10, y: 70, w: 100, h: -50, stroke: '#111111', strokeWidth: 2 });
  const svg = pageToSvg(page([line]), ['l']);
  assert(svg.includes('x1="0" y1="0" x2="100" y2="-50"'), 'local endpoints kept');
  const [x, y, w, h] = viewBoxOf(svg);
  assertNear(x, 10, 'vb x');
  assertNear(y, 20, 'vb y');
  assertNear(w, 100, 'vb w');
  assertNear(h, 50, 'vb h');
});

test('rotated objects keep rotation with encompassing viewBox', () => {
  const rect = mkObj({ id: 'r', x: 0, y: 0, w: 100, h: 100, rotation: 45 });
  const svg = pageToSvg(page([rect]), ['r']);
  assert(svg.includes('rotate(45 50 50)'), 'rotation preserved');
  const [x, y, w, h] = viewBoxOf(svg);
  const e = 50 * Math.SQRT2;
  assertNear(x, 50 - e, 'vb x');
  assertNear(y, 50 - e, 'vb y');
  assertNear(w, 2 * e, 'vb w');
  assertNear(h, 2 * e, 'vb h');
});

test('child of a rotated frame exports through the ancestor matrix', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 100, h: 100, rotation: 90 });
  const c = mkObj({ id: 'c', parentId: 'f', x: 0, y: 0, w: 20, h: 10 });
  const svg = pageToSvg(page([f, c]), ['c']);
  assert(svg.includes('<rect'), 'child rendered');
  // Ancestor matrix rotates the child subtree; corners land in [90..100]x[0..20].
  const [x, y, w, h] = viewBoxOf(svg);
  assertNear(x, 90, 'vb x');
  assertNear(y, 0, 'vb y');
  assertNear(w, 10, 'vb w');
  assertNear(h, 20, 'vb h');
});

/* ---------- visibility, clipping, scope ---------- */

test('hidden selected objects are excluded', () => {
  const hidden = mkObj({ id: 'h', x: 10, y: 10, w: 50, h: 50, visible: false });
  const svg = pageToSvg(page([hidden]), ['h']);
  assert(!svg.includes('<rect'), 'nothing rendered');
  const [, , w, h] = viewBoxOf(svg);
  assertNear(w, 800, 'fallback width');
  assertNear(h, 600, 'fallback height');
});

test('hidden children of an exported frame are excluded', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300 });
  const shown = mkObj({ id: 's', type: 'text', parentId: 'f', text: 'SHOWN-CHILD' });
  const hid = mkObj({ id: 'h', type: 'text', parentId: 'f', text: 'HIDDEN-CHILD', visible: false });
  const svg = pageToSvg(page([f, shown, hid]), ['f']);
  assert(svg.includes('SHOWN-CHILD'), 'visible child rendered');
  assert(!svg.includes('HIDDEN-CHILD'), 'hidden child excluded');
});

test('child of a hidden frame is excluded', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300, visible: false });
  const c = mkObj({ id: 'c', type: 'text', parentId: 'f', text: 'ORPHAN-VISIBLE' });
  const svg = pageToSvg(page([f, c]), ['c']);
  assert(!svg.includes('ORPHAN-VISIBLE'), 'excluded with hidden ancestor');
});

test('locked objects are still exported', () => {
  const rect = mkObj({ id: 'r', x: 0, y: 0, w: 50, h: 50, locked: true, fill: '#123456' });
  const svg = pageToSvg(page([rect]), ['r']);
  assert(svg.includes('#123456'), 'locked object rendered');
});

test('clipped frames emit clipPath defs', () => {
  const f = mkObj({ id: 'f', type: 'frame', x: 0, y: 0, w: 200, h: 100, clip: true, cornerRadius: 8 });
  const svg = pageToSvg(page([f]), ['f']);
  assert(count(svg, '<clipPath') === 1, 'one clip def');
  assert(svg.includes('clip-path="url(#'), 'clip reference present');
});

test('unrelated page objects are never exported in selection scope', () => {
  const a = mkObj({ id: 'a', x: 0, y: 0, w: 50, h: 50, fill: '#AAAAAA' });
  const b = mkObj({ id: 'b', x: 500, y: 500, w: 50, h: 50, fill: '#BBBBBB' });
  const svg = pageToSvg(page([a, b]), ['a']);
  assert(svg.includes('#AAAAAA'), 'selected rendered');
  assert(!svg.includes('#BBBBBB'), 'unselected excluded');
});

test('empty selection keeps the graceful fallback', () => {
  const svg = pageToSvg(page([mkObj({ id: 'a' })]), []);
  const [, , w, h] = viewBoxOf(svg);
  assertNear(w, 800, 'fallback width');
  assertNear(h, 600, 'fallback height');
});

/* ---------- styling fidelity ---------- */

test('text styling, opacity, and stroke survive export', () => {
  const t = mkObj({
    id: 't', type: 'text', x: 0, y: 0, w: 200, h: 24,
    text: 'Styled', fontSize: 24, fontWeight: 700, textAlign: 'center',
    fill: '#112233', opacity: 0.5,
  });
  const svg = pageToSvg(page([t]), ['t']);
  assert(svg.includes('font-size="24"'), 'font size');
  assert(svg.includes('font-weight="700"'), 'font weight');
  assert(svg.includes('text-anchor="middle"'), 'alignment');
  assert(svg.includes('fill="#112233"'), 'fill');
  assert(svg.includes('opacity="0.5"'), 'opacity');
  const s = mkObj({ id: 's', x: 300, y: 0, w: 60, h: 40, stroke: '#445566', strokeWidth: 3, fillOpacity: 0.25 });
  const svg2 = pageToSvg(page([t, s]), ['s']);
  assert(svg2.includes('stroke="#445566"'), 'stroke');
  assert(svg2.includes('stroke-width="3"'), 'stroke width');
  assert(svg2.includes('fill-opacity="0.25"'), 'fill opacity');
});

test('ellipse uses local center coordinates', () => {
  const e = mkObj({ id: 'e', type: 'ellipse', x: 40, y: 30, w: 100, h: 50 });
  const svg = pageToSvg(page([e]), ['e']);
  assert(svg.includes('cx="50" cy="25"'), 'local center');
  assert(svg.includes('rx="50" ry="25"'), 'radii');
});

test('untrusted strings are XML-escaped', () => {
  const t = mkObj({ id: 't', type: 'text', text: 'a<b>&"c' });
  const svg = pageToSvg(page([t]), ['t']);
  assert(svg.includes('a&lt;b&gt;&amp;&quot;c'), 'text escaped');
  const evil = mkObj({ id: 'e', fill: 'red" onload="alert(1)' });
  const svg2 = pageToSvg(page([evil]), ['e']);
  assert(svg2.includes('&quot;'), 'quotes escaped');
  assert(!svg2.includes('onload="alert(1)'), 'no attribute breakout');
});

test('gradient fills export linearGradient defs with url paint', () => {
  const svg = pageToSvg(
    page([
      mkObj({
        id: 'g',
        w: 100,
        h: 60,
        fillGradient: {
          angle: 0,
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#FFFFFF' },
          ],
        },
      }),
    ]),
  );
  assert(svg.includes('<linearGradient id="expgrad0" x1="0" y1="0.5" x2="1" y2="0.5">'), 'def with vector');
  assert(svg.includes('<stop offset="0" stop-color="#000000" />'), 'first stop');
  assert(svg.includes('<stop offset="1" stop-color="#FFFFFF" />'), 'last stop');
  assert(svg.includes('fill="url(#expgrad0)"'), 'shape references the gradient');
  assert(!svg.includes('fill="#FFFFFF"'), 'solid fill overridden, not duplicated');
});

test('degenerate gradients fall back to the solid fill', () => {
  const svg = pageToSvg(
    page([
      mkObj({ id: 'a', fill: '#123456', fillGradient: { angle: 0, stops: [{ offset: 0, color: '#000000' }] } }),
    ]),
  );
  assert(!svg.includes('linearGradient'), 'no def emitted');
  assert(svg.includes('fill="#123456"'), 'solid fill kept');
});

test('independent corner radii export a path, uniform keeps rect', () => {
  const svg = pageToSvg(
    page([
      mkObj({ id: 'i', w: 100, h: 60, cornerRadii: [4, 8, 12, 16] }),
      mkObj({ id: 'u', x: 200, w: 100, h: 60, cornerRadius: 10 }),
    ]),
  );
  assert(
    svg.includes('<path d="M 4 0 H 92 Q 100 0 100 8 V 48 Q 100 60 88 60 H 16 Q 0 60 0 44 V 4 Q 0 0 4 0 Z"'),
    'independent corners become a path',
  );
  assert(svg.includes('<rect x="0" y="0" width="100" height="60"') && svg.includes('rx="10"'), 'uniform keeps rect+rx');
});

test('clipped frames with independent radii emit path clipPaths', () => {
  const svg = pageToSvg(
    page([
      mkObj({ id: 'f', type: 'frame', w: 100, h: 60, cornerRadii: [10, 10, 10, 10], clip: true }),
      mkObj({ id: 'k', parentId: 'f', x: 5, y: 5, w: 20, h: 20 }),
    ]),
  );
  assert(svg.includes('<clipPath id="expclip0"><path d="M 10 0 H 90'), 'clip uses the corner path');
  assert(svg.includes('clip-path="url(#expclip0)"'), 'frame references the clip');
});

test('selection scope exports only rendered gradients', () => {
  const svg = pageToSvg(
    page([
      mkObj({ id: 'a', fillGradient: { angle: 0, stops: [{ offset: 0, color: '#111111' }, { offset: 1, color: '#222222' }] } }),
      mkObj({ id: 'b', x: 200, fillGradient: { angle: 0, stops: [{ offset: 0, color: '#333333' }, { offset: 1, color: '#444444' }] } }),
    ]),
    ['a'],
  );
  assert(svg.includes('#111111') && svg.includes('#222222'), 'selected gradient present');
  assert(!svg.includes('#333333') && !svg.includes('#444444'), 'unrelated gradient excluded');
});

test('images embed resolved data URLs', () => {
  const svg = pageToSvg(
    page([mkObj({ id: 'i', type: 'image', w: 40, h: 30, imageName: 'cat.png' })]),
    undefined,
    () => 'data:image/png;base64,AAAA',
  );
  assert(
    svg.includes('<image x="0" y="0" width="40" height="30" href="data:image/png;base64,AAAA" preserveAspectRatio="none" />'),
    'embedded image element',
  );
});

test('images without resolved assets export an honest placeholder', () => {
  const svg = pageToSvg(
    page([mkObj({ id: 'i', type: 'image', w: 40, h: 30, imageId: 'img_gone', imageName: 'cat.png' })]),
    undefined,
    () => null,
  );
  assert(!svg.includes('<image'), 'no dangling image element');
  assert(svg.includes('cat.png') && svg.includes('not embedded'), 'placeholder explains itself');
  assert(svg.includes('stroke-dasharray="4 3"'), 'placeholder shape');
});

test('includeIds tags every rendered object, default export stays clean', () => {
  const objs = [
    mkObj({ id: 'f', type: 'frame', w: 100, h: 100 }),
    mkObj({ id: 'r', parentId: 'f', x: 5, y: 5, w: 10, h: 10 }),
  ];
  const tagged = pageToSvg(page(objs), undefined, null, { includeIds: true });
  assert(tagged.includes('data-undesign-id="f"'), 'frame tagged');
  assert(tagged.includes('data-undesign-id="r"'), 'child tagged');
  const plain = pageToSvg(page(objs));
  assert(!plain.includes('data-undesign-id'), 'production export untagged');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL EXPORT TESTS PASSED');
