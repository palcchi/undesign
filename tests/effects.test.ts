/**
 * Regression tests for drop shadows and shared effect styles.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { applyEffectStyleShadow, canHaveEffectStyle, propagateEffectStyles, shadowEqual } from '../src/system';
import { validateDoc } from '../src/storage';
import { pageToSvg, shadowFilterInner } from '../src/utils';
import type { DesignObject, DocPage, DropShadow, EffectStyle, ObjectType, UndesignDoc } from '../src/types';

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
    id: `e${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, textStyleId: null, shadow: null, effectStyleId: null,
    constraints: null,
    stroke: '', strokeWidth: 0,
    cornerRadius: 0, cornerRadii: null,
    componentId: null, sourceId: null, componentSnapshot: null, variant: null,
    imageId: null, imageName: '', naturalW: 0, naturalH: 0,
    clip: false,
    text: '', fontFamily: 'sans', fontSize: 16, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4,
    ...over,
  } as DesignObject;
}

const SHADOW: DropShadow = { offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.25 };

function style(over: Partial<EffectStyle> = {}): EffectStyle {
  return { id: 'es1', name: 'Soft', shadow: { ...SHADOW }, ...over };
}

function doc(pages: DocPage[], effectStyles: EffectStyle[] = []): UndesignDoc {
  return {
    version: 1, name: 't', pages, activePageId: pages[0].id,
    components: [], variantSets: [], colorStyles: [], textStyles: [], effectStyles,
    prototypeLinks: [],
  };
}

test('editing an effect style updates linked shadows across pages', () => {
  const a = obj('rectangle', { effectStyleId: 'es1', shadow: { ...SHADOW } });
  const b = obj('ellipse', { effectStyleId: 'es1', shadow: { ...SHADOW } });
  const plain = obj('rectangle', { shadow: { ...SHADOW, blur: 2 } });
  const prev = doc(
    [
      { id: 'p1', name: 'p1', objects: [a, plain] },
      { id: 'p2', name: 'p2', objects: [b] },
    ],
    [style()],
  );
  const next: UndesignDoc = {
    ...prev,
    effectStyles: [style({ shadow: { ...SHADOW, blur: 24, opacity: 0.5 } })],
  };
  const out = propagateEffectStyles(prev, next);
  assert(out !== next, 'new doc produced');
  assert(out.pages[0].objects[0].shadow?.blur === 24, 'page 1 linked blur');
  assert(out.pages[0].objects[0].shadow?.opacity === 0.5, 'page 1 linked opacity');
  assert(out.pages[1].objects[0].shadow?.blur === 24, 'page 2 linked');
  assert(out.pages[0].objects[1].shadow?.blur === 2, 'unlinked untouched');
  assert(out.pages[0].objects[1] === plain, 'unlinked keeps ref');
  assert(
    out.pages[0].objects[0].shadow !== out.pages[1].objects[0].shadow,
    'linked objects get independent copies',
  );
});

test('only changed styles propagate; add/remove/rename are no-ops', () => {
  const a = obj('rectangle', { effectStyleId: 'es1', shadow: { ...SHADOW } });
  const prev = doc([{ id: 'p', name: 'p', objects: [a] }], [style()]);
  const edited: UndesignDoc = {
    ...prev,
    effectStyles: [style({ shadow: { ...SHADOW, offsetX: 8 } })],
  };
  assert(propagateEffectStyles(prev, edited).pages[0].objects[0].shadow?.offsetX === 8, 'changed applies');
  const renamed: UndesignDoc = { ...prev, effectStyles: [style({ name: 'Renamed' })] };
  assert(propagateEffectStyles(prev, renamed) === renamed, 'rename-only no-op');
  const added: UndesignDoc = { ...prev, effectStyles: [...prev.effectStyles, style({ id: 'es2' })] };
  assert(propagateEffectStyles(prev, added) === added, 'added style no-op');
  const removed: UndesignDoc = { ...prev, effectStyles: [] };
  assert(propagateEffectStyles(prev, removed) === removed, 'removed style no-op');
  assert(propagateEffectStyles(prev, prev) === prev, 'identical states');
});

test('canHaveEffectStyle excludes lines only', () => {
  assert(canHaveEffectStyle('frame'), 'frame');
  assert(canHaveEffectStyle('rectangle'), 'rectangle');
  assert(canHaveEffectStyle('ellipse'), 'ellipse');
  assert(canHaveEffectStyle('text'), 'text');
  assert(canHaveEffectStyle('image'), 'image');
  assert(!canHaveEffectStyle('line'), 'line excluded');
});

test('validateDoc sanitizes shadows and detaches dangling links', () => {
  const raw = {
    version: 1, name: 't',
    pages: [
      {
        id: 'p', name: 'p', objects: [
          { id: 'a', type: 'rectangle', effectStyleId: 'es1', shadow: { offsetX: 2, offsetY: 3, blur: -5, spread: -4, color: '#000', opacity: 9 } },
          { id: 'b', type: 'rectangle', effectStyleId: 'gone', shadow: { offsetX: 0, offsetY: 0, blur: 1, color: '', opacity: 1 } },
        ],
      },
    ],
    activePageId: 'p',
    components: [], variantSets: [], colorStyles: [], textStyles: [],
    effectStyles: [
      { id: 'es1', name: 'S', shadow: { offsetX: 0, offsetY: 4, blur: 12, color: '#000000', opacity: 0.25 } },
      { id: 'es2', name: 'Broken' },
    ],
    prototypeLinks: [],
  };
  const out = validateDoc(raw);
  assert(out !== null, 'valid doc');
  assert(out.effectStyles.length === 1, 'drops shadow-less style');
  const byId = new Map(out.pages[0].objects.map((o) => [o.id, o]));
  assert(byId.get('a')?.effectStyleId === 'es1', 'live link kept');
  assert(byId.get('a')?.shadow?.blur === 0, 'negative blur clamped');
  assert(byId.get('a')?.shadow?.spread === 0, 'negative spread clamped');
  assert(byId.get('a')?.shadow?.opacity === 1, 'opacity clamped');
  assert(out.effectStyles[0].shadow.spread === 0, 'legacy style without spread migrates to 0');
  assert(byId.get('b')?.effectStyleId === null, 'dangling link detached');
  assert(byId.get('b')?.shadow === null, 'colorless shadow dropped');
  const legacy = validateDoc({ ...raw, effectStyles: undefined });
  assert(legacy !== null && legacy.effectStyles.length === 0, 'missing collection defaults');
});

test('pageToSvg emits drop-shadow filters for shadowed objects only', () => {
  const a = obj('rectangle', { id: 'a', shadow: { ...SHADOW } });
  const b = obj('rectangle', { id: 'b' });
  const svg = pageToSvg({ id: 'p', name: 'p', objects: [a, b] });
  assert(svg.includes('<feDropShadow'), 'filter def emitted');
  assert(svg.includes('filter="url(#expshd0)"'), 'shape references its filter');
  assert(!svg.includes('expshd1'), 'unshadowed object gets no filter');
  const clean = pageToSvg({ id: 'p', name: 'p', objects: [b] });
  assert(!clean.includes('feDropShadow'), 'no filters without shadows');
});

test('shadowFilterInner uses shorthand at zero spread, dilate chain above', () => {
  const flat = shadowFilterInner({ ...SHADOW });
  assert(flat.includes('<feDropShadow'), 'zero spread keeps shorthand');
  assert(!flat.includes('feMorphology'), 'zero spread has no dilate stage');
  const wide = shadowFilterInner({ ...SHADOW, spread: 6 });
  assert(wide.includes('<feMorphology in="SourceAlpha" operator="dilate" radius="6"'), 'dilate stage');
  assert(wide.includes('<feGaussianBlur in="d" stdDeviation="12"'), 'blur follows dilate');
  assert(wide.includes('dx="0" dy="4"'), 'offset preserved');
  assert(wide.includes('flood-color="#000000" flood-opacity="0.25"'), 'color preserved');
  assert(wide.includes('<feMergeNode in="SourceGraphic"'), 'source drawn over shadow');
  const evil = shadowFilterInner({ ...SHADOW, spread: 2, color: '#000"><x' });
  assert(!evil.includes('"><x'), 'color is escaped');
});

test('spread-only style edits propagate to linked shadows', () => {
  const a = obj('rectangle', { effectStyleId: 'es1', shadow: { ...SHADOW } });
  const prev = doc([{ id: 'p', name: 'p', objects: [a] }], [style()]);
  const edited: UndesignDoc = {
    ...prev,
    effectStyles: [style({ shadow: { ...SHADOW, spread: 6 } })],
  };
  assert(!shadowEqual(SHADOW, { ...SHADOW, spread: 6 }), 'spread counts as a change');
  assert(shadowEqual(SHADOW, { ...SHADOW }), 'identical shadows equal');
  const out = propagateEffectStyles(prev, edited);
  assert(out.pages[0].objects[0].shadow?.spread === 6, 'spread applied to linked');
});

test('applyEffectStyleShadow writes values and ignores unknown ids', () => {
  const d = doc([{ id: 'p', name: 'p', objects: [] }], [style()]);
  const out = applyEffectStyleShadow(d, 'es1', { ...SHADOW, spread: 3 });
  assert(out !== d, 'new doc produced');
  assert(out.effectStyles[0].shadow.spread === 3, 'shadow written');
  assert(out.effectStyles[0].shadow !== d.effectStyles[0].shadow, 'independent copy');
  assert(d.effectStyles[0].shadow.spread === 0, 'input untouched');
  assert(applyEffectStyleShadow(d, 'gone', { ...SHADOW }) === d, 'unknown id no-op');
});

test('update flow: style edit propagates to linked objects across pages', () => {
  const a = obj('rectangle', { effectStyleId: 'es1', shadow: { ...SHADOW } });
  const b = obj('ellipse', { effectStyleId: 'es1', shadow: { ...SHADOW } });
  const prev = doc(
    [
      { id: 'p1', name: 'p1', objects: [a] },
      { id: 'p2', name: 'p2', objects: [b] },
    ],
    [style()],
  );
  // Same composition as the store's updateEffectStyle action: write the
  // style, then run the propagation pass over the pre-edit doc.
  const written = applyEffectStyleShadow(prev, 'es1', { ...SHADOW, blur: 30, spread: 2 });
  const out = propagateEffectStyles(prev, written);
  assert(out.pages[0].objects[0].shadow?.blur === 30, 'page 1 linked blur');
  assert(out.pages[0].objects[0].shadow?.spread === 2, 'page 1 linked spread');
  assert(out.pages[1].objects[0].shadow?.blur === 30, 'page 2 linked blur');
});

test('pageToSvg renders spread shadows with a dilate stage', () => {
  const a = obj('rectangle', { id: 'a', shadow: { ...SHADOW, spread: 4 } });
  const svg = pageToSvg({ id: 'p', name: 'p', objects: [a] });
  assert(svg.includes('<feMorphology'), 'dilate stage emitted');
  assert(svg.includes('radius="4"'), 'spread radius emitted');
  assert(svg.includes('filter="url(#expshd0)"'), 'shape references its filter');
  const flat = pageToSvg({ id: 'p', name: 'p', objects: [obj('rectangle', { id: 'b', shadow: { ...SHADOW } })] });
  assert(flat.includes('<feDropShadow'), 'zero spread keeps shorthand');
  assert(!flat.includes('feMorphology'), 'zero spread has no dilate stage');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL EFFECT TESTS PASSED');
