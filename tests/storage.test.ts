/**
 * Regression tests for document validation: new styling fields must
 * round-trip, and documents written before they existed must still load.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { validateDoc } from '../src/storage';

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

function rawDoc(objects: unknown[]): unknown {
  return {
    version: 1,
    name: 't',
    pages: [{ id: 'p', name: 'p', objects }],
    activePageId: 'p',
  };
}

function rawObj(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a', type: 'rectangle', name: 'a', parentId: null,
    x: 0, y: 0, w: 100, h: 60, rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#FF0000', fillOpacity: 1,
    stroke: '', strokeWidth: 0, cornerRadius: 0, clip: false,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  };
}

test('documents without styling fields load with null defaults', () => {
  const doc = validateDoc(rawDoc([rawObj()]));
  assert(doc !== null, 'doc valid');
  assert(doc!.pages[0].objects[0].fillGradient === null, 'gradient defaults to null');
  assert(doc!.pages[0].objects[0].cornerRadii === null, 'radii default to null');
});

test('valid gradients and radii round-trip through validation', () => {
  const doc = validateDoc(
    rawDoc([
      rawObj({
        fillGradient: {
          angle: 45,
          stops: [
            { offset: 1, color: '#FFFFFF' },
            { offset: 0, color: '#000000' },
          ],
        },
        cornerRadii: [4, 8, 12, 16],
      }),
    ]),
  );
  assert(doc !== null, 'doc valid');
  const o = doc!.pages[0].objects[0];
  assert(o.fillGradient !== null && o.fillGradient.angle === 45, 'angle kept');
  assert(
    JSON.stringify(o.fillGradient!.stops) ===
      JSON.stringify([{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }]),
    'stops sorted by offset',
  );
  assert(JSON.stringify(o.cornerRadii) === '[4,8,12,16]', 'radii kept');
  // JSON serialization preserves the fields for the next load.
  const again = validateDoc(JSON.parse(JSON.stringify(doc)) as unknown);
  assert(again !== null, 'reserialized doc valid');
  assert(again!.pages[0].objects[0].fillGradient !== null, 'gradient survives JSON');
  assert(again!.pages[0].objects[0].cornerRadii !== null, 'radii survive JSON');
});

test('malformed styling fields sanitize to null', () => {
  const doc = validateDoc(
    rawDoc([
      rawObj({ fillGradient: { angle: 0, stops: [{ offset: 0, color: '#000' }] } }),
      rawObj({ id: 'b', fillGradient: { angle: 0, stops: 'nope' } }),
      rawObj({ id: 'c', fillGradient: { angle: 0, stops: [{ offset: 0, color: '' }, { offset: 1, color: '' }] } }),
      rawObj({ id: 'd', cornerRadii: [1, 2, 3] }),
      rawObj({ id: 'e', cornerRadii: [1, -2, 3, 4] }),
      rawObj({ id: 'f', cornerRadii: 'round' }),
    ]),
  );
  assert(doc !== null, 'doc valid');
  const [a, b, c, d, e, f] = doc!.pages[0].objects;
  assert(a.fillGradient === null, 'single stop dropped');
  assert(b.fillGradient === null, 'non-array stops dropped');
  assert(c.fillGradient === null, 'empty colors dropped');
  assert(d.cornerRadii === null, 'short tuple dropped');
  assert(e.cornerRadii === null, 'negative radius dropped');
  assert(f.cornerRadii === null, 'non-array radii dropped');
});

test('gradient offsets clamp and excess stops are capped', () => {
  const stops = [{ offset: -2, color: '#111111' }];
  for (let i = 0; i < 10; i += 1) stops.push({ offset: i / 9, color: '#222222' });
  const doc = validateDoc(rawDoc([rawObj({ fillGradient: { angle: 0, stops } })]));
  assert(doc !== null, 'doc valid');
  const g = doc!.pages[0].objects[0].fillGradient!;
  assert(g.stops.length === 8, `capped at 8 (got ${g.stops.length})`);
  assert(g.stops[0].offset === 0, 'offset clamped to [0,1]');
});

test('image references round-trip; legacy objects default cleanly', () => {
  const legacy = validateDoc(rawDoc([rawObj()]));
  assert(legacy !== null, 'legacy doc valid');
  const lo = legacy!.pages[0].objects[0];
  assert(lo.imageId === null && lo.imageName === '' && lo.naturalW === 0 && lo.naturalH === 0, 'image fields default');
  const doc = validateDoc(
    rawDoc([
      rawObj({ id: 'i', type: 'image', imageId: 'img_1', imageName: 'a.png', naturalW: 800, naturalH: 600 }),
      rawObj({ id: 'e', type: 'image', imageId: '' }),
    ]),
  );
  assert(doc !== null, 'doc valid');
  assert(doc!.pages[0].objects.length === 2, 'image type accepted');
  const io = doc!.pages[0].objects[0];
  assert(io.imageId === 'img_1' && io.imageName === 'a.png', 'reference kept');
  assert(io.naturalW === 800 && io.naturalH === 600, 'dimensions kept');
  assert(doc!.pages[0].objects[1].imageId === null, 'empty id normalizes to null');
});

test('component defs and instance markers round-trip; legacy docs default', () => {
  const legacy = validateDoc(rawDoc([rawObj()]));
  assert(legacy !== null && Array.isArray(legacy.components) && legacy.components.length === 0, 'legacy defaults to []');
  const o = legacy!.pages[0].objects[0];
  assert(o.componentId === null && o.sourceId === null && o.componentSnapshot === null, 'markers default');
  const doc = validateDoc({
    ...rawDoc([
      rawObj({ id: 'i', type: 'frame', componentId: 'c1', componentSnapshot: { s_a: rawObj({ id: 'x' }) } }),
      rawObj({ id: 'k', parentId: 'i', sourceId: 's_a' }),
    ]) as Record<string, unknown>,
    components: [
      { id: 'c1', name: 'Card', pageId: 'p', rootId: 'sr' },
      { id: '', name: 'Bad', pageId: 'p', rootId: 'x' },
      'nope',
    ],
  });
  assert(doc !== null, 'doc valid');
  assert(doc!.components.length === 1 && doc!.components[0].name === 'Card', 'valid def kept, bad dropped');
  assert(doc!.pages[0].objects[0].componentSnapshot !== null, 'snapshot kept');
  assert(doc!.pages[0].objects[1].sourceId === 's_a', 'sourceId kept');
  const again = validateDoc(JSON.parse(JSON.stringify(doc)) as unknown);
  assert(again !== null && again.components.length === 1, 'defs survive JSON');
  assert(again!.pages[0].objects[0].componentSnapshot !== null, 'snapshot survives JSON');
});

test('constraints and color styles round-trip; dangling refs detach', () => {
  const legacy = validateDoc(rawDoc([rawObj()]));
  assert(legacy !== null && legacy.colorStyles.length === 0, 'legacy styles default');
  assert(legacy!.pages[0].objects[0].constraints === null, 'constraints default');
  assert(legacy!.pages[0].objects[0].fillStyleId === null, 'style ref defaults');
  const doc = validateDoc({
    ...rawDoc([
      rawObj({ id: 'a', fillStyleId: 's1', constraints: { horizontal: 'right', vertical: 'stretch' } }),
      rawObj({ id: 'b', fillStyleId: 'gone', constraints: { horizontal: 'nope', vertical: 'top' } }),
    ]) as Record<string, unknown>,
    colorStyles: [
      { id: 's1', name: 'Ink', color: '#111111' },
      { id: '', name: 'Bad', color: '#222222' },
    ],
  });
  assert(doc !== null, 'doc valid');
  assert(doc!.colorStyles.length === 1 && doc!.colorStyles[0].color === '#111111', 'valid style kept');
  const [a, b] = doc!.pages[0].objects;
  assert(a.fillStyleId === 's1', 'live ref kept');
  assert(JSON.stringify(a.constraints) === JSON.stringify({ horizontal: 'right', vertical: 'stretch' }), 'constraints kept');
  assert(b.fillStyleId === null, 'dangling ref detached');
  assert(b.constraints === null, 'invalid constraints dropped');
  const again = validateDoc(JSON.parse(JSON.stringify(doc)) as unknown);
  assert(again !== null && again.colorStyles.length === 1, 'styles survive JSON');
  assert(again!.pages[0].objects[0].fillStyleId === 's1', 'refs survive JSON');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL STORAGE TESTS PASSED');
