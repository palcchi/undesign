/**
 * Regression tests for shared text styles (linked typography follows edits).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import { applyTextStyleValues, canHaveTextStyle, propagateTextStyles, textStyleValuesEqual, textStyleValuesOf } from '../src/system';
import { validateDoc } from '../src/storage';
import { patchAllPages } from '../src/docpatch';
import type { DesignObject, DocPage, ObjectType, TextStyle, UndesignDoc } from '../src/types';

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
    id: `t${seq}`,
    type,
    name: `${type}${seq}`,
    parentId: null,
    x: 0, y: 0, w: 100, h: 60,
    rotation: 0,
    visible: true, locked: false, opacity: 1,
    fill: '#CCCCCC', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, textStyleId: null, constraints: null,
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

function style(over: Partial<TextStyle> = {}): TextStyle {
  return {
    id: 'ts1', name: 'Body', fontFamily: 'sans',
    fontSize: 16, fontWeight: 400, textAlign: 'left', lineHeight: 1.4,
    ...over,
  };
}

function doc(pages: DocPage[], textStyles: TextStyle[] = []): UndesignDoc {
  return {
    version: 1, name: 't', pages, activePageId: pages[0].id,
    components: [], colorStyles: [], textStyles, prototypeLinks: [],
  };
}

test('editing a text style updates linked text across pages', () => {
  const a = obj('text', { textStyleId: 'ts1', text: 'one\ntwo' });
  const b = obj('text', { textStyleId: 'ts1' });
  const plain = obj('text', { fontSize: 12 });
  const prev = doc(
    [
      { id: 'p1', name: 'p1', objects: [a, plain] },
      { id: 'p2', name: 'p2', objects: [b] },
    ],
    [style()],
  );
  const next: UndesignDoc = {
    ...prev,
    textStyles: [style({ fontSize: 20, fontWeight: 700 })],
  };
  const out = propagateTextStyles(prev, next);
  assert(out !== next, 'new doc produced');
  const oa = out.pages[0].objects[0];
  assert(oa.fontSize === 20 && oa.fontWeight === 700, 'page 1 linked values');
  assert(oa.h === 2 * 20 * 1.4, `page 1 height refreshed, got ${oa.h}`);
  assert(out.pages[1].objects[0].fontSize === 20, 'page 2 linked');
  assert(out.pages[0].objects[1].fontSize === 12, 'unlinked untouched');
  assert(out.pages[0].objects[1] === plain, 'unlinked keeps ref');
});

test('only changed styles propagate; add/remove/rename are no-ops', () => {
  const a = obj('text', { textStyleId: 'ts1' });
  const b = obj('text', { textStyleId: 'ts2' });
  const prev = doc([{ id: 'p', name: 'p', objects: [a, b] }], [
    style({ id: 'ts1', name: 'A' }),
    style({ id: 'ts2', name: 'B' }),
  ]);
  const edited: UndesignDoc = {
    ...prev,
    textStyles: [style({ id: 'ts1', name: 'A', fontSize: 24 }), style({ id: 'ts2', name: 'B renamed' })],
  };
  const out = propagateTextStyles(prev, edited);
  assert(out.pages[0].objects[0].fontSize === 24, 'changed style applies');
  assert(out.pages[0].objects[1] === b, 'rename-only keeps ref');
  const added: UndesignDoc = { ...prev, textStyles: [...prev.textStyles, style({ id: 'ts3' })] };
  assert(propagateTextStyles(prev, added) === added, 'added style no-op');
  const removed: UndesignDoc = { ...prev, textStyles: [] };
  assert(propagateTextStyles(prev, removed) === removed, 'removed style no-op');
  assert(propagateTextStyles(prev, prev) === prev, 'identical states');
});

test('canHaveTextStyle matches text only', () => {
  assert(canHaveTextStyle('text'), 'text');
  assert(!canHaveTextStyle('frame'), 'frame excluded');
  assert(!canHaveTextStyle('rectangle'), 'rectangle excluded');
  assert(!canHaveTextStyle('ellipse'), 'ellipse excluded');
  assert(!canHaveTextStyle('line'), 'line excluded');
  assert(!canHaveTextStyle('image'), 'image excluded');
});

test('validateDoc sanitizes text styles and detaches dangling links', () => {
  const raw = {
    version: 1,
    name: 't',
    pages: [
      {
        id: 'p', name: 'p', objects: [
          { id: 'a', type: 'text', textStyleId: 'ts1' },
          { id: 'b', type: 'text', textStyleId: 'gone' },
        ],
      },
    ],
    activePageId: 'p',
    components: [],
    colorStyles: [],
    textStyles: [
      { id: 'ts1', name: 'Body', fontFamily: 'x', fontSize: 0, fontWeight: 700, textAlign: 'middle', lineHeight: 2 },
      { id: '', name: 'bad' },
    ],
    prototypeLinks: [],
  };
  const out = validateDoc(raw);
  assert(out !== null, 'valid doc');
  assert(out.textStyles.length === 1, 'drops id-less style');
  assert(out.textStyles[0].fontSize === 1, 'clamps size to >= 1');
  assert(out.textStyles[0].textAlign === 'left', 'falls back bad align');
  const byId = new Map(out.pages[0].objects.map((o) => [o.id, o]));
  assert(byId.get('a')?.textStyleId === 'ts1', 'live link kept');
  assert(byId.get('b')?.textStyleId === null, 'dangling link detached');
  const legacy = validateDoc({ ...raw, textStyles: undefined });
  assert(legacy !== null && legacy.textStyles.length === 0, 'missing collection defaults');
});

test('patchAllPages reaches linked objects on every page', () => {
  const a = obj('text', { id: 'a', textStyleId: 'ts1' });
  const b = obj('text', { id: 'b', textStyleId: 'ts1' });
  const d = doc([
    { id: 'p1', name: 'p1', objects: [a] },
    { id: 'p2', name: 'p2', objects: [b] },
  ]);
  const out = patchAllPages(d, ['a', 'b'], { textStyleId: null });
  assert(out !== d, 'new doc produced');
  assert(out.pages[0].objects[0].textStyleId === null, 'active page detached');
  assert(out.pages[1].objects[0].textStyleId === null, 'other page detached');
  assert(patchAllPages(d, ['zzz'], { textStyleId: null }) === d, 'unknown ids no-op');
});

test('textStyleValuesOf reads the style-shaped values off a text object', () => {
  const t = obj('text', { fontFamily: 'serif', fontSize: 24, fontWeight: 700, textAlign: 'center', lineHeight: 2 });
  const v = textStyleValuesOf(t);
  assert(v.fontFamily === 'serif' && v.fontSize === 24 && v.fontWeight === 700, 'values read');
  assert(v.textAlign === 'center' && v.lineHeight === 2, 'align and leading read');
  assert(!('id' in v) && !('name' in v), 'no identity fields leak');
});

test('textStyleValuesEqual compares values only', () => {
  assert(textStyleValuesEqual(style(), style()), 'identical equal');
  assert(!textStyleValuesEqual(style(), style({ fontSize: 20 })), 'size differs');
  assert(!textStyleValuesEqual(style(), style({ lineHeight: 2 })), 'leading differs');
  assert(textStyleValuesEqual(style({ id: 'x', name: 'y' }), style()), 'identity ignored');
});

test('applyTextStyleValues writes values and ignores unknown ids', () => {
  const d = doc([{ id: 'p', name: 'p', objects: [] }], [style()]);
  const out = applyTextStyleValues(d, 'ts1', {
    fontFamily: 'serif', fontSize: 24, fontWeight: 700, textAlign: 'center', lineHeight: 2,
  });
  assert(out !== d, 'new doc produced');
  assert(out.textStyles[0].fontSize === 24 && out.textStyles[0].textAlign === 'center', 'values written');
  assert(out.textStyles[0].name === 'Body', 'name preserved');
  assert(d.textStyles[0].fontSize === 16, 'input untouched');
  assert(applyTextStyleValues(d, 'gone', textStyleValuesOf(obj('text'))) === d, 'unknown id no-op');
});

test('update flow: style edit propagates to linked objects and refreshes heights', () => {
  const a = obj('text', { textStyleId: 'ts1', text: 'one\ntwo' });
  const b = obj('text', { textStyleId: 'ts1', text: 'solo' });
  const prev = doc(
    [
      { id: 'p1', name: 'p1', objects: [a] },
      { id: 'p2', name: 'p2', objects: [b] },
    ],
    [style()],
  );
  // Same composition as the store's updateTextStyle action: write the
  // style, then run the propagation pass over the pre-edit doc.
  const source = obj('text', { fontFamily: 'serif', fontSize: 20, fontWeight: 700, textAlign: 'right', lineHeight: 2 });
  const written = applyTextStyleValues(prev, 'ts1', textStyleValuesOf(source));
  const out = propagateTextStyles(prev, written);
  const oa = out.pages[0].objects[0];
  assert(oa.fontFamily === 'serif' && oa.fontWeight === 700 && oa.textAlign === 'right', 'page 1 linked values');
  assert(oa.h === 2 * 20 * 2, `page 1 height refreshed, got ${oa.h}`);
  const ob = out.pages[1].objects[0];
  assert(ob.fontSize === 20, 'page 2 linked value');
  assert(ob.h === 1 * 20 * 2, `page 2 height refreshed, got ${ob.h}`);
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL TEXT STYLE TESTS PASSED');
