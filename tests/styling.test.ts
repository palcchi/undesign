/**
 * Regression tests for gradient fills and independent corner radii.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  effectiveGradient,
  gradientVector,
  hasIndependentCorners,
  resolveRadii,
  roundedRectPath,
} from '../src/utils';
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

function near(actual: number, expected: number, msg: string, eps = 1e-9): void {
  assert(Math.abs(actual - expected) <= eps, `${msg} (got ${actual}, want ${expected})`);
}

let seq = 0;
function obj(type: ObjectType, over: Partial<DesignObject> = {}): DesignObject {
  seq += 1;
  return {
    id: `s${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#FF0000', fillOpacity: 1, fillGradient: null,
    fillStyleId: null,
    constraints: null,
    stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    componentId: null, sourceId: null, componentSnapshot: null, clip: false,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  };
}

test('gradientVector maps cardinal angles to object-space endpoints', () => {
  const r0 = gradientVector(0);
  near(r0.x1, 0, '0deg x1'); near(r0.y1, 0.5, '0deg y1');
  near(r0.x2, 1, '0deg x2'); near(r0.y2, 0.5, '0deg y2');
  const r90 = gradientVector(90);
  near(r90.x1, 0.5, '90deg x1'); near(r90.y1, 0, '90deg y1');
  near(r90.x2, 0.5, '90deg x2'); near(r90.y2, 1, '90deg y2');
  const r180 = gradientVector(180);
  near(r180.x1, 1, '180deg x1'); near(r180.x2, 0, '180deg x2');
  const r270 = gradientVector(270);
  near(r270.y1, 1, '270deg y1'); near(r270.y2, 0, '270deg y2');
});

test('effectiveGradient requires at least two stops', () => {
  assert(effectiveGradient(obj('rectangle')) === null, 'solid fill');
  assert(
    effectiveGradient(obj('rectangle', { fillGradient: { angle: 90, stops: [{ offset: 0, color: '#000000' }] } })) === null,
    'single stop ignored',
  );
  const g = { angle: 45, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }] };
  assert(effectiveGradient(obj('rectangle', { fillGradient: g })) === g, 'valid gradient kept');
});

test('resolveRadii honors the independent override', () => {
  assert(JSON.stringify(resolveRadii(obj('rectangle', { cornerRadius: 8 }))) === '[8,8,8,8]', 'uniform');
  assert(
    JSON.stringify(resolveRadii(obj('rectangle', { cornerRadius: 8, cornerRadii: [1, 2, 3, 4] }))) === '[1,2,3,4]',
    'override wins',
  );
  assert(hasIndependentCorners(obj('rectangle')) === false, 'linked by default');
  assert(hasIndependentCorners(obj('rectangle', { cornerRadii: [8, 8, 8, 8] })) === true, 'unlinked even when uniform');
});

test('roundedRectPath emits exact geometry for uniform radii', () => {
  assert(
    roundedRectPath(100, 60, [0, 0, 0, 0]) ===
      'M 0 0 H 100 Q 100 0 100 0 V 60 Q 100 60 100 60 H 0 Q 0 60 0 60 V 0 Q 0 0 0 0 Z',
    'zero radii stay valid',
  );
  assert(
    roundedRectPath(100, 60, [10, 10, 10, 10]) ===
      'M 10 0 H 90 Q 100 0 100 10 V 50 Q 100 60 90 60 H 10 Q 0 60 0 50 V 10 Q 0 0 10 0 Z',
    'uniform radii',
  );
});

test('roundedRectPath supports independent radii with clamping', () => {
  assert(
    roundedRectPath(100, 60, [4, 8, 12, 16]) ===
      'M 4 0 H 92 Q 100 0 100 8 V 48 Q 100 60 88 60 H 16 Q 0 60 0 44 V 4 Q 0 0 4 0 Z',
    'independent radii',
  );
  assert(
    roundedRectPath(100, 60, [50, 50, 50, 50]) ===
      'M 30 0 H 70 Q 100 0 100 30 V 30 Q 100 60 70 60 H 30 Q 0 60 0 30 V 30 Q 0 0 30 0 Z',
    'clamped to half the short side',
  );
  assert(
    roundedRectPath(100, 60, [-5, 0, 0, 0]).startsWith('M 0 0'),
    'negative radii clamped to zero',
  );
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL STYLING TESTS PASSED');
