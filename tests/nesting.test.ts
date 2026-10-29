/**
 * Regression tests for nested instances (recursive expansion, wrap
 * preservation, cycle safety), instance swapping, exposed nested props,
 * and per-layer override reset.
 * Run with `npm test` (bundled by the project's esbuild, executed by node).
 */
import {
  addComponentProp,
  bindComponentProp,
  breakComponentCycles,
  buildInstance,
  combineAsVariants,
  createComponent,
  detachInstance,
  expansionId,
  exposeNestedProp,
  exposedControls,
  hasComponentCycle,
  liveSource,
  regenInstances,
  remapClonedInstances,
  removeExposed,
  resetLayerOverride,
  setInstancePropValues,
  swapInstance,
  switchVariant,
} from '../src/library';
import { validateDoc } from '../src/storage';
import type { ComponentIdPack, LiveSource } from '../src/library';
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
    id: `n${seq}`,
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
    componentId: null, sourceId: null, componentSnapshot: null, variant: null, exposedValues: null,
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
    components: [], variantSets: [], colorStyles: [], textStyles: [], effectStyles: [], prototypeLinks: [],
  };
}

function byId(objects: DesignObject[], id: string): DesignObject {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`missing object ${id}`);
  return o;
}

function pack(tag: string, overrides: Partial<ComponentIdPack> = {}): ComponentIdPack {
  return {
    compId: `${tag}c`, componentsPageId: `${tag}cp`, sourceRootId: `${tag}sr`,
    instanceId: `${tag}i`, cloneId: (old: string) => `${tag}s_${old}`,
    ...overrides,
  };
}

function mainPage(d: UndesignDoc): DesignObject[] {
  return d.pages.find((p) => p.id === 'p')!.objects;
}

/** Button B, then card A wrapping an instance of B. Returns live handles. */
function nestedSetup(tag: string): { d: UndesignDoc; defB: string; defA: string; instA: string } {
  const r = obj('rectangle', { id: 'body', name: 'Body', fill: '#111111' });
  const c1 = createComponent(doc([page('p', [r])]), 'p', ['body'], 'B', pack(`${tag}b`));
  if ('error' in c1) throw new Error('setup B failed');
  let d = c1.doc;
  const built = buildInstance(d, `${tag}bc`, `${tag}ib`);
  if (!built) throw new Error('setup instance failed');
  d = {
    ...d,
    pages: d.pages.map((p) => (p.id === 'p' ? { ...p, objects: [...p.objects, built.root, ...built.children] } : p)),
  };
  const c2 = createComponent(d, 'p', [`${tag}ib`], 'A', pack(`${tag}a`));
  if ('error' in c2) throw new Error('setup A failed');
  d = regenInstances(c2.doc);
  return { d, defB: `${tag}bc`, defA: `${tag}ac`, instA: `${tag}ai` };
}

function nestedCopyOf(d: UndesignDoc, instId: string): DesignObject {
  const found = mainPage(d).find((o) => o.componentId !== null && o.sourceId !== null && o.id !== instId);
  if (!found) throw new Error('nested copy missing');
  return found;
}

test('nested instances expand recursively with flat stable ids', () => {
  const { d, defB, instA } = nestedSetup('t1');
  const nested = nestedCopyOf(d, instA);
  assert(nested.componentId === defB, 'nested copy points at B');
  assert(nested.id === expansionId(instA, nested.sourceId as string), 'flat id under tree root');
  assert(nested.componentSnapshot !== null && Object.keys(nested.componentSnapshot).length === 1, 'nested level snapshotted');
  const deep = mainPage(d).find((o) => o.parentId === nested.id);
  assert(deep !== undefined && deep.sourceId !== null, 'nested content expanded');
  assert(deep.id === expansionId(instA, deep.sourceId as string), 'deep id flat under tree root');
  // Regen is idempotent: a second pass changes nothing.
  assert(regenInstances(d) === d, 'regen idempotent on nested tree');
});

test('source edits flow through nesting levels', () => {
  let { d, defB, instA } = nestedSetup('t2');
  const def = d.components.find((x) => x.id === defB);
  if (!def) throw new Error('def missing');
  const src = liveSource(d, def) as LiveSource;
  const bodyId = src.subtree[1].id;
  d = {
    ...d,
    pages: d.pages.map((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === bodyId ? { ...o, fill: '#00FF00' } : o)),
    })),
  };
  const out = regenInstances(d);
  const nested = nestedCopyOf(out, instA);
  const deep = mainPage(out).find((o) => o.parentId === nested.id);
  assert(deep !== undefined && deep.fill === '#00FF00', 'deep edit flows through levels');
});

test('wrapping an instance preserves its nested overrides', () => {
  const r = obj('rectangle', { id: 'body', name: 'Body', fill: '#111111' });
  const c1 = createComponent(doc([page('p', [r])]), 'p', ['body'], 'B', pack('t3b'));
  if ('error' in c1) throw new Error('setup failed');
  let d = c1.doc;
  const built = buildInstance(d, 't3bc', 't3ib');
  if (!built) throw new Error('instance failed');
  d = {
    ...d,
    pages: d.pages.map((p) => (p.id === 'p' ? { ...p, objects: [...p.objects, built.root, ...built.children] } : p)),
  };
  // Override the nested content before wrapping.
  const expId = expansionId('t3ib', 't3bs_body');
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === 'p' ? { ...p, objects: p.objects.map((o) => (o.id === expId ? { ...o, fill: '#FF0000' } : o)) } : p,
    ),
  };
  const c2 = createComponent(d, 'p', ['t3ib'], 'A', pack('t3a'));
  if ('error' in c2) throw new Error('wrap failed');
  const out = regenInstances(c2.doc);
  const nested = nestedCopyOf(out, 't3ai');
  const deep = mainPage(out).find((o) => o.parentId === nested.id);
  assert(deep !== undefined && deep.fill === '#FF0000', 'nested override preserved through wrap');
});

test('reference cycles degrade safely and break on load', () => {
  const { d, defA } = nestedSetup('t4');
  // Hand-build a cycle: insert an instance of A into B's own source subtree.
  const defB = d.components.find((x) => x.id === 't4bc');
  if (!defB) throw new Error('def missing');
  const srcB = liveSource(d, defB) as LiveSource;
  const built = buildInstance(d, defA, 'cyc');
  if (!built) throw new Error('build failed');
  const placed: DesignObject = { ...built.root, id: 'cyc', parentId: srcB.root.id, sourceId: null };
  let cyclic: UndesignDoc = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === defB.pageId ? { ...p, objects: [...p.objects, placed] } : p,
    ),
  };
  assert(hasComponentCycle(cyclic), 'cycle detected');
  const regened = regenInstances(cyclic);
  const nested = nestedCopyOf(regened, 't4ai');
  const deep = mainPage(regened).find((o) => o.parentId === nested.id);
  assert(deep !== undefined, 'outer level still expands');
  // The cyclic level degrades to a plain mirror (no runaway expansion).
  const byIdA = new Map(mainPage(regened).map((o) => [o.id, o]));
  const underA = (id: string): boolean => {
    let p: string | null | undefined = id;
    const seen = new Set<string>();
    while (p !== null && p !== undefined && !seen.has(p)) {
      if (p === 't4ai') return true;
      seen.add(p);
      p = byIdA.get(p)?.parentId ?? null;
    }
    return false;
  };
  const degraded = mainPage(regened).find((o) => o.sourceId === 'cyc' && underA(o.id));
  assert(degraded !== undefined && degraded.componentId === null, 'cyclic copy degraded to plain');
  assert(mainPage(regened).filter((o) => o.parentId === (degraded as DesignObject).id).length === 0, 'degraded copy carries no children');
  // The sibling tree degrades precisely one level deeper, not blanket-flat.
  const expanded = mainPage(regened).find((o) => o.sourceId === 'cyc' && !underA(o.id));
  assert(expanded !== undefined && expanded.componentId !== null, 'acyclic path still expands');
  const inner = expanded ? mainPage(regened).find((o) => o.parentId === (expanded as DesignObject).id) : undefined;
  assert(inner !== undefined && inner.componentId === null, 'inner cyclic copy degraded');
  const broken = breakComponentCycles(cyclic);
  assert(broken !== cyclic, 'breaker rewrites');
  assert(!hasComponentCycle(broken), 'breaker restores acyclicity');
  assert(breakComponentCycles(broken) === broken, 'breaker idempotent');
  const loaded = validateDoc(JSON.parse(JSON.stringify(cyclic)));
  assert(loaded !== null && !hasComponentCycle(regenInstances(loaded)), 'untrusted cycles break on load');
});

test('self-nesting degrades instead of recursing', () => {
  const r = obj('rectangle', { id: 'body', name: 'Body' });
  const c1 = createComponent(doc([page('p', [r])]), 'p', ['body'], 'S', pack('t5'));
  if ('error' in c1) throw new Error('setup failed');
  let d = c1.doc;
  const def = d.components[0];
  const src = liveSource(d, def) as LiveSource;
  const built = buildInstance(d, def.id, 'self');
  if (!built) throw new Error('build failed');
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === def.pageId ? { ...p, objects: [...p.objects, { ...built.root, id: 'self', parentId: src.root.id, sourceId: null }] } : p,
    ),
  };
  assert(hasComponentCycle(d), 'self-cycle detected');
  const out = regenInstances(d);
  const copies = out.pages
    .flatMap((p) => p.objects)
    .filter((o) => o.componentId === def.id && o.sourceId !== null);
  assert(copies.length === 0, 'self-nested copies degrade to plain');
});

test('swapInstance moves across components keeping matched overrides', () => {
  const a = obj('rectangle', { id: 'a', name: 'Body', fill: '#111111', w: 100 });
  const r1 = createComponent(doc([page('p', [a])]), 'p', ['a'], 'A', pack('t6a'));
  if ('error' in r1) throw new Error('setup A failed');
  let d = r1.doc;
  const b = obj('rectangle', { id: 'b', name: 'Body', fill: '#111111', w: 200 });
  d = { ...d, pages: d.pages.map((p) => (p.id === 'p' ? { ...p, objects: [...p.objects, b] } : p)) };
  const r2 = createComponent(d, 'p', ['b'], 'B', { ...pack('t6b'), componentsPageId: 't6acp' });
  if ('error' in r2) throw new Error('setup B failed');
  d = r2.doc;
  const instId = 't6ai';
  const srcA = (liveSource(d, d.components[0]) as LiveSource).subtree[1];
  const expId = expansionId(instId, srcA.id);
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === 'p' ? { ...p, objects: p.objects.map((o) => (o.id === expId ? { ...o, fill: '#FF0000' } : o)) } : p,
    ),
  };
  const out = swapInstance(d, instId, 't6bc');
  const root = byId(mainPage(out), instId);
  assert(root.componentId === 't6bc', 'instance points at B');
  const srcB = (liveSource(out, out.components[1]) as LiveSource).subtree[1];
  const kept = byId(mainPage(out), expansionId(instId, srcB.id));
  assert(kept.fill === '#FF0000', 'agreed fill carried over');
  assert(kept.w === 200, 'differing width follows target');
  assert(swapInstance(out, instId, 't6bc') === out, 'same-target no-op');
  assert(swapInstance(out, instId, 'missing') === out, 'unknown target no-op');
});

test('swap keeps same-named same-kind prop values, resets the rest', () => {
  const x1 = obj('rectangle', { id: 'x1', name: 'Body' });
  const y1 = obj('rectangle', { id: 'y1', name: 'Body' });
  const r1 = combineAsVariants(doc([page('p', [x1, y1])]), 'p', ['x1', 'y1'], 'S1', 's1', (i: number) => ({
    compId: `s1c${i}`, componentsPageId: 's1cp', sourceRootId: `s1sr${i}`,
    instanceId: `s1i${i}`, cloneId: (o: string) => `s1s${i}_${o}`,
  }));
  if ('error' in r1) throw new Error('combine 1 failed');
  let d = r1.doc;
  const x2 = obj('rectangle', { id: 'x2', name: 'Body' });
  const y2 = obj('rectangle', { id: 'y2', name: 'Body' });
  d = { ...d, pages: d.pages.map((p) => (p.id === 'p' ? { ...p, objects: [...p.objects, x2, y2] } : p)) };
  const r2 = combineAsVariants(d, 'p', ['x2', 'y2'], 'S2', 's2', (i: number) => ({
    compId: `s2c${i}`, componentsPageId: 's2cp', sourceRootId: `s2sr${i}`,
    instanceId: `s2i${i}`, cloneId: (o: string) => `s2s${i}_${o}`,
  }));
  if ('error' in r2) throw new Error('combine 2 failed');
  d = r2.doc;
  d = {
    ...d,
    variantSets: d.variantSets.map((s) =>
      s.id === 's1'
        ? { ...s, properties: [{ name: 'Shared', kind: 'boolean' as const, default: true }] }
        : { ...s, properties: [{ name: 'Shared', kind: 'boolean' as const, default: true }, { name: 'Extra', kind: 'text' as const, default: 'd' }] },
    ),
  };
  d = setInstancePropValues(d, 's1i0', { Shared: false });
  const out = swapInstance(d, 's1i0', 's2c0');
  const root = byId(mainPage(out), 's1i0');
  assert(root.variant?.setId === 's2', 'membership moved');
  assert(root.variant?.values.Shared === false, 'shared value kept');
  assert(root.variant?.values.Extra === 'd', 'new prop defaulted');
});

test('exposed aliases drive nested props end to end', () => {
  // B as a variant set with a bound boolean prop.
  const b1 = obj('rectangle', { id: 'b1', name: 'Body' });
  const b2 = obj('rectangle', { id: 'b2', name: 'Body' });
  const rb = combineAsVariants(doc([page('p', [b1, b2])]), 'p', ['b1', 'b2'], 'Btn', 'bset', (i: number) => ({
    compId: `bc${i}`, componentsPageId: 'bcp', sourceRootId: `bsr${i}`,
    instanceId: `bi${i}`, cloneId: (o: string) => `bs${i}_${o}`,
  }));
  if ('error' in rb) throw new Error('combine B failed');
  let d = rb.doc;
  d = addComponentProp(d, 'bc0', 'boolean');
  d = bindComponentProp(d, 'bc0', 'Property 1', 'Body');
  // A wraps an instance of B's default variant.
  const built = buildInstance(d, 'bc0', 'ib');
  if (!built) throw new Error('instance failed');
  d = {
    ...d,
    pages: d.pages.map((p) => (p.id === 'p' ? { ...p, objects: [...p.objects, built.root, ...built.children] } : p)),
  };
  const cA = createComponent(d, 'p', ['ib'], 'A', pack('t8a'));
  if ('error' in cA) throw new Error('wrap failed');
  d = regenInstances(cA.doc);
  const defA = d.components.find((x) => x.id === 't8ac')!;
  const srcA = liveSource(d, defA) as LiveSource;
  const nestedNode = srcA.subtree.find((o) => o.componentId !== null);
  if (!nestedNode) throw new Error('nested node missing');
  assert(exposedControls(d, defA).length === 0, 'nothing exposed yet');
  d = exposeNestedProp(d, defA.id, nestedNode.id, 'Property 1', 'ShowBody');
  assert(d.components.find((x) => x.id === defA.id)!.exposed.ShowBody !== undefined, 'alias recorded');
  const ctrls = exposedControls(d, d.components.find((x) => x.id === defA.id)!);
  assert(ctrls.length === 1 && ctrls[0].kind === 'boolean', 'control resolved');
  d = setInstancePropValues(d, 't8ai', { ShowBody: false });
  const nested = mainPage(d).find((o) => o.componentId === 'bc0' && o.sourceId !== null);
  const deep = nested ? mainPage(d).find((o) => o.parentId === nested.id) : undefined;
  assert(deep !== undefined && deep.visible === false, 'alias drives nested prop');
  d = removeExposed(d, defA.id, 'ShowBody');
  const nested2 = mainPage(d).find((o) => o.componentId === 'bc0' && o.sourceId !== null);
  const deep2 = nested2 ? mainPage(d).find((o) => o.parentId === nested2.id) : undefined;
  assert(deep2 !== undefined && deep2.visible === true, 'remove restores source visibility');
  assert(exposeNestedProp(d, defA.id, 'nope', 'Property 1', 'X') === d, 'unknown node refused');
  assert(exposeNestedProp(d, defA.id, nestedNode.id, 'Nope', 'X') === d, 'unknown prop refused');
  assert(exposeNestedProp(d, defA.id, nestedNode.id, 'Property 1', '  ') === d, 'blank alias refused');
});

test('resetLayerOverride restores one layer, keeps siblings', () => {
  const a = obj('rectangle', { id: 'a', name: 'A', fill: '#111111' });
  const b = obj('rectangle', { id: 'b', name: 'B', fill: '#222222' });
  const c = createComponent(doc([page('p', [a, b])]), 'p', ['a', 'b'], 'C', pack('t9'));
  if ('error' in c) throw new Error('setup failed');
  let d = c.doc;
  const ea = expansionId('t9i', 't9s_a');
  const eb = expansionId('t9i', 't9s_b');
  d = {
    ...d,
    pages: d.pages.map((p) =>
      p.id === 'p'
        ? { ...p, objects: p.objects.map((o) => (o.id === ea || o.id === eb ? { ...o, fill: '#FF0000' } : o)) }
        : p,
    ),
  };
  const out = resetLayerOverride(d, ea);
  assert(out !== d, 'reset produces a new doc');
  assert(byId(mainPage(out), ea).fill === '#111111', 'target restored');
  assert(byId(mainPage(out), eb).fill === '#FF0000', 'sibling kept');
  assert(resetLayerOverride(out, ea) === out, 'clean layer no-op');
  assert(resetLayerOverride(out, 't9i') === out, 'root id no-op');
  assert(resetLayerOverride(out, 'missing') === out, 'unknown id no-op');
});

test('detach flattens nested trees with no dangling roots', () => {
  const { d, instA } = nestedSetup('t12');
  const pageObjs = mainPage(d);
  const out = detachInstance(pageObjs, instA);
  if (!out) throw new Error('detach failed');
  const inTree = (objects: DesignObject[]): Set<string> => {
    const ids = new Set([instA]);
    let grown = true;
    while (grown) {
      grown = false;
      for (const o of objects) {
        if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
          ids.add(o.id);
          grown = true;
        }
      }
    }
    return ids;
  };
  const before = inTree(pageObjs);
  const after = inTree(out);
  assert(after.size === before.size, 'values preserved as plain objects');
  for (const o of out) {
    if (!after.has(o.id)) continue;
    assert(o.componentId === null, 'no component links remain');
    assert(o.sourceId === null, 'no expansion marks remain');
    assert(o.componentSnapshot === null && o.variant === null && o.exposedValues === null, 'no instance state remains');
  }
});

test('switchVariant and prop edits refuse nested roots', () => {
  const { d, instA } = nestedSetup('t10');
  const nested = nestedCopyOf(d, instA);
  assert(switchVariant(d, nested.id, d.components[0].id) === d, 'nested switch refused');
  assert(setInstancePropValues(d, nested.id, { P: true }) === d, 'nested prop edit refused');
});

test('remap reclones nested trees flat under the new top id', () => {
  const { d, instA } = nestedSetup('t11');
  const tree = mainPage(d).filter((o) => o.id === instA || o.sourceId !== null);
  const out = remapClonedInstances(tree, () => 'ni2');
  const root = out.find((o) => o.id === 'ni2');
  assert(root !== undefined && root.componentId !== null, 'new top root');
  assert(out.filter((o) => o.id !== 'ni2').length === tree.length - 1, 'whole tree remapped');
  const nested = out.find((o) => o.componentId !== null && o.sourceId !== null);
  assert(nested !== undefined, 'nested copy survived');
  assert(nested.id === expansionId('ni2', nested.sourceId as string), 'nested id flat under new top');
  const deep = out.find((o) => o.parentId === nested.id);
  assert(deep !== undefined && deep.id === expansionId('ni2', deep.sourceId as string), 'deep id flat under new top');
  const snap = root.componentSnapshot ?? {};
  assert(Object.keys(snap).length === 1, 'top snapshot re-anchored');
});

test('validateDoc sanitizes exposed maps and values', () => {
  const raw = {
    version: 1, name: 't',
    pages: [{ id: 'p', name: 'p', objects: [{ id: 'i', type: 'frame', componentId: 'c1', exposedValues: { A: true, Ghost: 1, Bad: [1] } }] }],
    activePageId: 'p',
    components: [{ id: 'c1', name: 'C', pageId: 'p', rootId: 'r', exposed: { A: { instance: 'n', prop: 'P' }, Bad: { instance: 1 }, Empty: { instance: '', prop: 'x' } } }],
    variantSets: [], colorStyles: [], textStyles: [], effectStyles: [], prototypeLinks: [],
  };
  const out = validateDoc(raw);
  assert(out !== null, 'valid doc');
  assert(Object.keys(out.components[0].exposed ?? {}).length === 1, 'malformed exposed dropped');
  assert(Object.keys(out.pages[0].objects[0].exposedValues ?? {}).length === 1, 'unknown aliases pruned');
  const bad = validateDoc({
    ...raw,
    pages: [{ id: 'p', name: 'p', objects: [{ id: 'i', type: 'frame', componentId: 'c1', exposedValues: { Ghost: true } }] }],
  });
  assert(bad !== null && bad.pages[0].objects[0].exposedValues === null, 'fully-unknown values nulled');
});

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
}
console.log('ALL NESTING TESTS PASSED');
