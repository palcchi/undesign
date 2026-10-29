/**
 * Regression tests for variant sets (combine, switch retention, boolean/text
 * properties, bindings, set-aware delete/reset).
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  addComponentProp,
  bindComponentProp,
  buildInstance,
  combineAsVariants,
  createComponent,
  deleteComponentProp,
  deleteVariantSet,
  detachComponents,
  expansionId,
  liveSource,
  regenInstances,
  resetInstance,
  resetInstancePropValue,
  setInstancePropValues,
  switchVariant,
} from '../src/library';
import { validateDoc } from '../src/storage';
import type { ComponentIdPack, LiveSource } from '../src/library';
import type { DesignObject, DocPage, ObjectType, UndesignDoc, VariantSet } from '../src/types';

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
    id: `v${seq}`,
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
    componentId: null, sourceId: null, componentSnapshot: null, variant: null,
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
    components: [], variantSets: [], colorStyles: [], textStyles: [], prototypeLinks: [],
  };
}

function byId(objects: DesignObject[], id: string): DesignObject {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`missing object ${id}`);
  return o;
}

function packFor(tag: string): (i: number) => ComponentIdPack {
  return (i: number) => ({
    compId: `${tag}c${i}`,
    componentsPageId: `${tag}cp`,
    sourceRootId: `${tag}sr${i}`,
    instanceId: `${tag}i${i}`,
    cloneId: (old: string) => `${tag}s${i}_${old}`,
  });
}

function setDoc(tag: string): { d: UndesignDoc; set: VariantSet; instanceId: string } {
  const a = obj('rectangle', { id: 'a', name: 'Body', x: 0, y: 0, w: 100, h: 40, fill: '#111111' });
  const b = obj('rectangle', { id: 'b', name: 'Body', x: 200, y: 0, w: 200, h: 40, fill: '#111111' });
  const r = combineAsVariants(doc([page('p', [a, b])]), 'p', ['a', 'b'], 'Btn', `${tag}set`, packFor(tag));
  if ('error' in r) throw new Error(`combine failed: ${r.error}`);
  const set = (r.doc.variantSets ?? []).find((s) => s.id === `${tag}set`);
  if (!set) throw new Error('set missing');
  return { d: r.doc, set, instanceId: r.instanceId };
}

function expansionOf(d: UndesignDoc, pageId: string, instanceId: string, sourceId: string): DesignObject {
  const pg = d.pages.find((p) => p.id === pageId);
  if (!pg) throw new Error('page missing');
  return byId(pg.objects, expansionId(instanceId, sourceId));
}

test('combineAsVariants groups tops into a set with one canvas instance', () => {
  const { d, set, instanceId } = setDoc('t1');
  assert(set.variants.length === 2, 'two variants registered');
  assert(d.components.length === 2, 'two defs registered');
  const main = d.pages.find((p) => p.id === 'p');
  assert(main !== undefined, 'main page kept');
  const roots = main.objects.filter((o) => o.parentId === null);
  assert(roots.length === 1 && roots[0].id === instanceId, 'single instance on canvas');
  assert(roots[0].componentId === set.variants[0], 'instance shows default variant');
  assert(roots[0].variant?.setId === set.id, 'instance joined the set');
  const cp = d.pages.find((p) => p.id === 't1cp');
  assert(cp !== undefined && cp.objects.length === 4, 'sources hold two wrappers + two clones');
});

test('combineAsVariants rejects single and empty selections', () => {
  const a = obj('rectangle', { id: 'a' });
  const r1 = combineAsVariants(doc([page('p', [a])]), 'p', ['a'], 'S', 's', packFor('x'));
  assert('error' in r1 && r1.error === 'single', 'single top rejected');
  const r2 = combineAsVariants(doc([page('p', [a])]), 'p', [], 'S', 's', packFor('x'));
  assert('error' in r2 && r2.error === 'empty', 'empty rejected');
  const c = createComponent(doc([page('p', [obj('rectangle', { id: 'a' }), obj('rectangle', { id: 'b' })])]), 'p', ['a'], 'C', {
    compId: 'c1', componentsPageId: 'cp', sourceRootId: 'sr', instanceId: 'i1', cloneId: (o: string) => `s_${o}`,
  });
  if ('error' in c) throw new Error('setup failed');
  // Instances may be wrapped: the set nests the instance as a variant source.
  const r3 = combineAsVariants(c.doc, 'p', ['i1', 'b'], 'S', 's', packFor('x'));
  assert(!('error' in r3), 'instance in selection allowed (nested)');
});

test('switchVariant keeps same-name overrides where variants agree', () => {
  const { d, set, instanceId } = setDoc('t3');
  const pg = d.pages.find((p) => p.id === 'p');
  if (!pg) throw new Error('page missing');
  // Override the Body fill on the instance (both variants hold #111111).
  const src0 = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  const expId = expansionId(instanceId, src0.id);
  const edited: UndesignDoc = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === 'p'
        ? { ...p, objects: p.objects.map((o) => (o.id === expId ? { ...o, fill: '#FF0000' } : o)) }
        : p,
    ),
  };
  const out = switchVariant(edited, instanceId, set.variants[1]);
  assert(out !== edited, 'switch produces a new doc');
  const root = byId(out.pages.find((p) => p.id === 'p')!.objects, instanceId);
  assert(root.componentId === set.variants[1], 'instance points at variant B');
  const src1 = (liveSource(out, out.components[1]) as LiveSource).subtree[1];
  const kept = expansionOf(out, 'p', instanceId, src1.id);
  assert(kept.fill === '#FF0000', 'fill override kept (both variants agreed)');
  assert(kept.w === 200, 'differing width follows the new variant');
});

test('switchVariant always keeps text overrides', () => {
  const a = obj('text', { id: 'a', name: 'Label', text: 'Alpha', w: 120 });
  const b = obj('text', { id: 'b', name: 'Label', text: 'Beta', w: 120 });
  const r = combineAsVariants(doc([page('p', [a, b])]), 'p', ['a', 'b'], 'T', 't4set', packFor('t4'));
  if ('error' in r) throw new Error('combine failed');
  const set = r.doc.variantSets[0];
  const iid = r.instanceId;
  const src0 = (liveSource(r.doc, r.doc.components[0]) as LiveSource).subtree[1];
  const expId = expansionId(iid, src0.id);
  const edited: UndesignDoc = {
    ...r.doc,
    pages: r.doc.pages.map((p) =>
      p.id === 'p'
        ? { ...p, objects: p.objects.map((o) => (o.id === expId ? { ...o, text: 'Custom' } : o)) }
        : p,
    ),
  };
  const out = switchVariant(edited, iid, set.variants[1]);
  const src1 = (liveSource(out, out.components[1]) as LiveSource).subtree[1];
  assert(expansionOf(out, 'p', iid, src1.id).text === 'Custom', 'text override survives switch');
});

test('switchVariant validates target, instance, and membership', () => {
  const { d, set, instanceId } = setDoc('t5');
  assert(switchVariant(d, instanceId, 'nope') === d, 'unknown target no-op');
  assert(switchVariant(d, 'nope', set.variants[1]) === d, 'unknown instance no-op');
  assert(switchVariant(d, instanceId, set.variants[0]) === d, 'same variant no-op');
  const plain = createComponent(
    doc([page('p', [obj('rectangle', { id: 'a' })])]), 'p', ['a'], 'C',
    { compId: 'c9', componentsPageId: 'cp', sourceRootId: 'sr', instanceId: 'i9', cloneId: (o: string) => `s_${o}` },
  );
  if ('error' in plain) throw new Error('setup failed');
  assert(switchVariant(plain.doc, 'i9', set.variants[0]) === plain.doc, 'plain instance cannot switch into a set');
});

test('boolean props drive visibility and survive source edits', () => {
  let { d, instanceId } = setDoc('t6');
  const compId = d.components[0].id;
  d = addComponentProp(d, compId, 'boolean');
  d = bindComponentProp(d, compId, 'Property 1', 'Body');
  d = setInstancePropValues(d, instanceId, { 'Property 1': false });
  const src0 = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  assert(expansionOf(d, 'p', instanceId, src0.id).visible === false, 'bound layer hidden');
  // Edit the source fill: regen keeps the prop-driven visibility.
  const cp = d.pages.find((p) => p.id === 't6cp');
  if (!cp) throw new Error('source page missing');
  const edited: UndesignDoc = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === cp.id
        ? { ...p, objects: p.objects.map((o) => (o.id === src0.id ? { ...o, fill: '#00FF00' } : o)) }
        : p,
    ),
  };
  const out = regenInstances(edited);
  const kept = expansionOf(out, 'p', instanceId, src0.id);
  assert(kept.fill === '#00FF00', 'source edit flows');
  assert(kept.visible === false, 'prop value survives source edit');
});

test('explicit overrides win over later prop changes', () => {
  let { d, instanceId } = setDoc('t7');
  const compId = d.components[0].id;
  d = addComponentProp(d, compId, 'boolean');
  d = bindComponentProp(d, compId, 'Property 1', 'Body');
  d = setInstancePropValues(d, instanceId, { 'Property 1': false });
  const src0 = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  const expId = expansionId(instanceId, src0.id);
  const direct: UndesignDoc = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === 'p'
        ? { ...p, objects: p.objects.map((o) => (o.id === expId ? { ...o, visible: true } : o)) }
        : p,
    ),
  };
  const out = setInstancePropValues(regenInstances(direct), instanceId, { 'Property 1': false });
  assert(expansionOf(out, 'p', instanceId, src0.id).visible === true, 'direct edit wins over prop');
});

test('text props drive characters; hostile values are ignored', () => {
  let { d, instanceId } = setDoc('t8');
  // Rename the first variant's layer to text for this test via a fresh setup.
  const a = obj('text', { id: 'a', name: 'Title', text: 'Hello' });
  const b = obj('text', { id: 'b', name: 'Title', text: 'World' });
  const r = combineAsVariants(doc([page('p', [a, b])]), 'p', ['a', 'b'], 'T', 't8set', packFor('t8'));
  if ('error' in r) throw new Error('combine failed');
  d = r.doc;
  instanceId = r.instanceId;
  const compId = d.components[0].id;
  d = addComponentProp(d, compId, 'text');
  d = bindComponentProp(d, compId, 'Property 1', 'Title');
  d = setInstancePropValues(d, instanceId, { 'Property 1': 'Bound!' });
  const src0 = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  assert(expansionOf(d, 'p', instanceId, src0.id).text === 'Bound!', 'bound text applied');
  assert(setInstancePropValues(d, instanceId, { Nope: 'x' }) === d, 'unknown prop ignored');
  assert(setInstancePropValues(d, instanceId, { 'Property 1': true as unknown as string }) === d, 'mistyped value ignored');
  assert(setInstancePropValues(d, instanceId, { 'Property 1': 'Bound!' }) === d, 'unchanged value no-op');
  assert(bindComponentProp(d, compId, 'Property 1', 'Missing layer') === d, 'unknown layer refused');
  const unbound = bindComponentProp(d, compId, 'Property 1', null);
  assert(unbound !== d, 'unbind applies');
  assert(expansionOf(unbound, 'p', instanceId, src0.id).text === 'Hello', 'unbind restores source text');
});

test('deleteComponentProp drops binding, values, and regen state', () => {
  let { d, instanceId } = setDoc('t9');
  const compId = d.components[0].id;
  d = addComponentProp(d, compId, 'boolean');
  d = bindComponentProp(d, compId, 'Property 1', 'Body');
  d = setInstancePropValues(d, instanceId, { 'Property 1': false });
  d = deleteComponentProp(d, compId, 'Property 1');
  const set = d.variantSets[0];
  assert(set.properties.length === 0 && Object.keys(set.bindings).length === 0, 'prop and binding gone');
  const root = byId(d.pages.find((p) => p.id === 'p')!.objects, instanceId);
  assert(!('Property 1' in (root.variant?.values ?? {})), 'instance value stripped');
  const src0 = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  assert(expansionOf(d, 'p', instanceId, src0.id).visible === true, 'layer visible again');
  assert(deleteComponentProp(d, compId, 'Property 1') === d, 'repeat delete no-op');
});

test('deleteVariantSet degrades instances to plain instances', () => {
  const { d, set, instanceId } = setDoc('t10');
  const out = deleteVariantSet(d, set.id);
  assert((out.variantSets ?? []).length === 0, 'set removed');
  assert(out.components.length === 2, 'member defs kept');
  const root = byId(out.pages.find((p) => p.id === 'p')!.objects, instanceId);
  assert(root.variant === null, 'membership cleared');
  assert(root.componentId === set.variants[0], 'still an instance of the same def');
  assert(deleteVariantSet(out, set.id) === out, 'repeat delete no-op');
});

test('deleting a def moves set instances to the default survivor', () => {
  const { d, set, instanceId } = setDoc('t11');
  const out = regenInstances(detachComponents(d, [set.variants[0]]));
  assert(out.variantSets[0].variants.length === 1, 'set pruned to survivor');
  const root = byId(out.pages.find((p) => p.id === 'p')!.objects, instanceId);
  assert(root.componentId === set.variants[1], 'instance re-pointed, not detached');
  assert(root.variant?.setId === set.id, 'membership kept');
  const gone = regenInstances(detachComponents(out, [set.variants[1]]));
  assert((gone.variantSets ?? []).length === 0, 'empty set removed');
  const flat = byId(gone.pages.find((p) => p.id === 'p')!.objects, instanceId);
  assert(flat.componentId === null && flat.variant === null, 'last def detaches');
});

test('buildInstance joins sets with defaults; reset restores defaults', () => {
  const { d, set } = setDoc('t12');
  const compId = d.components[0].id;
  const withProp = bindComponentProp(addComponentProp(d, compId, 'boolean'), compId, 'Property 1', 'Body');
  const built = buildInstance(withProp, compId, 'ni');
  if (!built) throw new Error('build failed');
  assert(built.root.variant?.setId === set.id, 'joins the set');
  assert(built.root.variant?.values['Property 1'] === true, 'starts at default');
  const page = withProp.pages.find((p) => p.id === 'p');
  if (!page) throw new Error('page missing');
  let ins: UndesignDoc = {
    ...withProp,
    pages: withProp.pages.map((p) => (p.id === 'p' ? { ...p, objects: [...p.objects, built.root, ...built.children] } : p)),
  };
  ins = setInstancePropValues(ins, 'ni', { 'Property 1': false });
  const src0 = (liveSource(ins, ins.components[0]) as LiveSource).subtree[1];
  assert(expansionOf(ins, 'p', 'ni', src0.id).visible === false, 'value applied');
  const reset = resetInstance(ins, 'ni');
  const root = byId(reset.pages.find((p) => p.id === 'p')!.objects, 'ni');
  assert(root.variant?.values['Property 1'] === true, 'reset restores default');
  assert(expansionOf(reset, 'p', 'ni', src0.id).visible === true, 'reset re-shows layer');
  const plain = buildInstance(withProp, 'missing', 'nx');
  assert(plain === null, 'unknown def returns null');
});

test('validateDoc repairs sets and memberships from untrusted docs', () => {
  const raw = {
    version: 1, name: 't',
    pages: [
      { id: 'p', name: 'p', objects: [{ id: 'i', type: 'frame', componentId: 'c1', variant: { setId: 's1', values: { P: true, Ghost: 1 } } }] },
      { id: 'cp', name: 'cp', objects: [{ id: 'sr', type: 'frame' }] },
    ],
    activePageId: 'p',
    components: [{ id: 'c1', name: 'C', pageId: 'cp', rootId: 'sr' }],
    variantSets: [
      { id: 's1', name: 'S', properties: [{ name: 'P', kind: 'boolean', default: true }, { name: '', kind: 'text' }], variants: ['c1', 'gone'], bindings: { P: 'Body', Ghost: 'x' } },
      { id: 's2', name: 'Empty', properties: [], variants: ['gone'], bindings: {} },
      { id: '', name: 'bad' },
    ],
    colorStyles: [], textStyles: [], prototypeLinks: [],
  };
  const out = validateDoc(raw);
  assert(out !== null, 'valid doc');
  assert(out.variantSets.length === 1, 'drops empty and id-less sets');
  assert(out.variantSets[0].variants.length === 1, 'drops unknown def refs');
  assert(out.variantSets[0].properties.length === 1, 'drops nameless props');
  assert(Object.keys(out.variantSets[0].bindings).length === 1, 'drops unknown-prop bindings');
  const root = out.pages[0].objects[0];
  assert(root.variant?.setId === 's1', 'membership kept');
  assert(Object.keys(root.variant?.values ?? {}).length === 1, 'unknown values pruned');
  const bad = validateDoc({
    ...raw,
    pages: [{ id: 'p', name: 'p', objects: [{ id: 'i', type: 'frame', componentId: 'c1', variant: { setId: 'nope', values: {} } }] }],
  });
  assert(bad !== null && bad.pages[0].objects[0].variant === null, 'unknown set degrades to plain instance');
  const legacy = validateDoc({ ...raw, variantSets: undefined });
  assert(legacy !== null && (legacy.variantSets ?? []).length === 0, 'missing collection defaults');
});

test('resetInstancePropValue drops one override and restores the default', () => {
  let { d, instanceId } = setDoc('t9');
  const compId = d.components[0].id;
  d = addComponentProp(d, compId, 'boolean');
  d = bindComponentProp(d, compId, 'Property 1', 'Body');
  d = setInstancePropValues(d, instanceId, { 'Property 1': false });
  const src0 = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  assert(expansionOf(d, 'p', instanceId, src0.id).visible === false, 'override hides layer');
  const root0 = (d.pages.find((p) => p.id === 'p') as DocPage).objects.find((o) => o.id === instanceId);
  assert(root0?.variant?.values['Property 1'] === false, 'override stored');
  const out = resetInstancePropValue(d, instanceId, 'Property 1');
  assert(out !== d, 'new doc produced');
  const root1 = (out.pages.find((p) => p.id === 'p') as DocPage).objects.find((o) => o.id === instanceId);
  assert(root1?.variant && !('Property 1' in root1.variant.values), 'override key deleted');
  assert(expansionOf(out, 'p', instanceId, src0.id).visible === true, 'default (visible) restored');
  assert(resetInstancePropValue(out, instanceId, 'Property 1') === out, 'second reset no-op');
  assert(resetInstancePropValue(out, instanceId, 'Nope') === out, 'unknown prop no-op');
  assert(resetInstancePropValue(out, 'missing', 'Property 1') === out, 'unknown instance no-op');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL VARIANT TESTS PASSED');
