/**
 * Reusable component library. A component source is a normal editable
 * subtree rooted at a frame on a real page; instances expand from it.
 *
 * Override model: each instance root carries a snapshot of its last
 * expansion. User edits apply to expanded children as ordinary document
 * edits; on source change, propagation re-expands and reapplies the
 * per-property diff (current vs snapshot) over the fresh expansion.
 * Structure (add/remove/reorder/sourceId set) always follows the source;
 * instance-local children without a sourceId are preserved untouched.
 */
import { IDENTITY, applyMatrix, invertMatrix, pageMatrixOf, transformedBounds } from './transform';
import { descendantIds, reparentLocal, rootsOf } from './utils';
import type { ComponentDef, DesignObject, DocPage, UndesignDoc, VariantSet } from './types';

export const COMPONENTS_PAGE_NAME = 'Components';
export const EXPANSION_SEP = '__x__';

/** Deterministic expansion id: stable across regenerations. */
export function expansionId(instanceId: string, sourceId: string): string {
  return `${instanceId}${EXPANSION_SEP}${sourceId}`;
}

export function isInstanceRoot(o: DesignObject): boolean {
  return o.componentId !== null && o.componentId !== undefined;
}

export function isExpansion(o: DesignObject): boolean {
  return o.sourceId !== null && o.sourceId !== undefined;
}

function frameShell(init: {
  id: string;
  name: string;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}): DesignObject {
  return {
    id: init.id,
    type: 'frame',
    name: init.name,
    parentId: init.parentId,
    x: init.x,
    y: init.y,
    w: init.w,
    h: init.h,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    fill: '',
    fillOpacity: 1,
    fillGradient: null,
    fillStyleId: null,
    textStyleId: null,
    shadow: null,
    effectStyleId: null,
    constraints: null,
    layout: null,
    sizing: null,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0,
    cornerRadii: null,
    componentId: null,
    sourceId: null,
    componentSnapshot: null,
    variant: null,
    exposedValues: null,
    imageId: null,
    imageName: '',
    naturalW: 0,
    naturalH: 0,
    clip: false,
    text: '',
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.4,
  };
}

/* ================= deep equality + prop diff ================= */

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

const DIFF_SKIP = new Set(['id', 'parentId', 'sourceId', 'componentId', 'componentSnapshot', 'variant', 'exposedValues']);

/** Top-level props where current differs from base (identity excluded). */
export function diffProps(current: DesignObject, base: DesignObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const c = current as unknown as Record<string, unknown>;
  const b = base as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(c), ...Object.keys(b)]);
  for (const k of keys) {
    if (DIFF_SKIP.has(k)) continue;
    if (!deepEqual(c[k], b[k])) out[k] = c[k];
  }
  return out;
}

function snapshotEqual(a: Record<string, DesignObject>, b: Record<string, DesignObject>): boolean {
  const ka = Object.keys(a);
  const kb = new Set(Object.keys(b));
  if (ka.length !== kb.size) return false;
  return ka.every((k) => kb.has(k) && deepEqual(a[k], b[k]));
}

/* ================= source lookup + expansion ================= */

export interface LiveSource {
  def: ComponentDef;
  page: DocPage;
  root: DesignObject;
  /** Root first, then descendants in page order. */
  subtree: DesignObject[];
}

export function liveSource(doc: UndesignDoc, def: ComponentDef): LiveSource | null {
  const page = doc.pages.find((p) => p.id === def.pageId);
  if (!page) return null;
  const root = page.objects.find((o) => o.id === def.rootId);
  if (!root) return null;
  const desc = new Set(descendantIds(page.objects, root.id));
  const subtree = page.objects.filter((o) => o.id === root.id || desc.has(o.id));
  return { def, page, root, subtree };
}

/**
 * Fresh expansion children for an instance root. Source-relative locals are
 * copied verbatim (the instance transform places them, exactly like group
 * children); ids are deterministic so regeneration is selection-stable.
 */
export function expandChildren(
  root: DesignObject,
  descendants: DesignObject[],
  instanceId: string,
): DesignObject[] {
  return descendants.map((s) => ({
    ...s,
    id: expansionId(instanceId, s.id),
    parentId: s.parentId === root.id || s.parentId === null ? instanceId : expansionId(instanceId, s.parentId),
    sourceId: s.id,
    // Nested instance roots keep their identity (regen expands them
    // recursively); every other copy is a plain mirror of its source node.
    componentId: s.componentId ?? null,
    componentSnapshot: null,
    variant: s.variant ? { setId: s.variant.setId, values: { ...s.variant.values } } : null,
  }));
}

export function snapshotOf(children: DesignObject[]): Record<string, DesignObject> {
  const snap: Record<string, DesignObject> = {};
  for (const c of children) {
    if (c.sourceId !== null && c.sourceId !== undefined) snap[c.sourceId] = c;
  }
  return snap;
}

/* ================= variant sets + properties ================= */

/** Default values record for a set's property definitions. */
export function defaultPropValues(set: VariantSet): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {};
  for (const p of set.properties) out[p.name] = p.default;
  return out;
}

/** The set an instance root belongs to, if any. */
export function liveSet(doc: UndesignDoc, root: DesignObject): VariantSet | null {
  const setId = root.variant?.setId;
  if (!setId) return null;
  return (doc.variantSets ?? []).find((s) => s.id === setId) ?? null;
}

/**
 * Apply bound property values over fresh expansion children. Boolean props
 * drive the named layer's visibility, text props drive a text layer's
 * characters. Matching is by layer name; the first match consumes a binding.
 */
export function applyPropValues(
  children: DesignObject[],
  set: VariantSet,
  values: Record<string, boolean | string>,
  consumed: Set<string> = new Set(),
): DesignObject[] {
  if (set.properties.length === 0) return children;
  const defs = new Map(set.properties.map((p) => [p.name, p]));
  if (Object.keys(set.bindings).length === 0) return children;
  return children.map((c) => {
    let out = c;
    for (const [prop, layer] of Object.entries(set.bindings)) {
      if (layer !== c.name || consumed.has(prop)) continue;
      const def = defs.get(prop);
      if (!def) continue;
      const v = values[prop] ?? def.default;
      if (def.kind === 'boolean' && typeof v === 'boolean') {
        out = { ...out, visible: v };
        consumed.add(prop);
      } else if (def.kind === 'text' && typeof v === 'string' && out.type === 'text') {
        out = { ...out, text: v };
        consumed.add(prop);
      }
    }
    return out;
  });
}

const RETAIN_SKIP = new Set(['id', 'parentId', 'sourceId', 'componentId', 'componentSnapshot', 'variant', 'exposedValues']);

/**
 * Overrides carried onto a fresh child from a same-named child of another
 * variant: per-property, kept where the old baseline and the fresh child
 * agree (both variants held the same value); text content is always kept.
 */
export function retainedOverrides(
  cur: DesignObject,
  base: DesignObject | undefined,
  fresh: DesignObject,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!base) return out;
  const c = cur as unknown as Record<string, unknown>;
  const b = base as unknown as Record<string, unknown>;
  const f = fresh as unknown as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (RETAIN_SKIP.has(k)) continue;
    if (k === 'text' && cur.type === 'text' && fresh.type === 'text') {
      if (!deepEqual(c[k], b[k])) out[k] = c[k];
      continue;
    }
    if (deepEqual(c[k], b[k])) continue;
    if (deepEqual(b[k], f[k])) out[k] = c[k];
  }
  return out;
}

/* ================= propagation ================= */

function isUnder(objects: DesignObject[], id: string, ancestorId: string): boolean {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  let p = byId.get(id)?.parentId ?? null;
  while (p !== null && !seen.has(p)) {
    if (p === ancestorId) return true;
    seen.add(p);
    p = byId.get(p)?.parentId ?? null;
  }
  return false;
}

export interface RegenPropCtx {
  set: VariantSet;
  values: Record<string, boolean | string>;
}

/** Hard cap on instance nesting depth (fail-safe; cycles degrade earlier). */
export const MAX_NEST_DEPTH = 8;
/** Hard cap on expansion nodes per instance tree (fail-safe). */
export const MAX_TREE_EXPANSION = 2000;

/** Snapshot covering one level: direct children of a parent copy. */
function snapshotOfDirect(children: DesignObject[], parentId: string): Record<string, DesignObject> {
  const snap: Record<string, DesignObject> = {};
  for (const c of children) {
    if (c.parentId === parentId && c.sourceId !== null && c.sourceId !== undefined) snap[c.sourceId] = c;
  }
  return snap;
}

/** Strip instance markers, degrading a copy to a plain mirror. */
function degradeCopy(c: DesignObject): DesignObject {
  return { ...c, componentId: null, componentSnapshot: null, variant: null };
}

interface TreeCtx {
  doc: UndesignDoc;
  defs: Map<string, ComponentDef>;
  budget: { n: number };
}

/**
 * Recursively expand an instance tree with flat deterministic ids (tree
 * root id + source node id — the same scheme as pre-nesting expansion, so
 * existing instances keep their child ids). seen guards reference cycles
 * (a def referencing itself degrades to plain); depth/budget caps bound
 * hostile documents. Prop values apply per level; exposed aliases from the
 * enclosing def merge into each nested level's values.
 */
function expandTree(
  ctx: TreeCtx,
  src: LiveSource,
  def: ComponentDef,
  treeId: string,
  parentId: string,
  sourceParentId: string,
  set: VariantSet | null,
  values: Record<string, boolean | string>,
  depth: number,
  seen: Set<string>,
  consumed: Set<string>,
): DesignObject[] {
  const direct = src.subtree.filter(
    (s) =>
      s.id !== src.root.id &&
      (s.parentId === sourceParentId || (sourceParentId === src.root.id && s.parentId === null)),
  );
  let level: DesignObject[] = direct.map((s) => ({
    ...s,
    id: expansionId(treeId, s.id),
    parentId,
    sourceId: s.id,
    componentId: s.componentId ?? null,
    componentSnapshot: null,
    variant: s.variant ? { setId: s.variant.setId, values: { ...s.variant.values } } : null,
  }));
  if (set) level = applyPropValues(level, set, values, consumed);
  const out: DesignObject[] = [];
  for (const c of level) {
    if (ctx.budget.n >= MAX_TREE_EXPANSION || depth >= MAX_NEST_DEPTH) {
      out.push(degradeCopy(c));
      continue;
    }
    ctx.budget.n += 1;
    const nestedId = c.componentId;
    const nestedDef = nestedId ? ctx.defs.get(nestedId) : undefined;
    const nestedSrc = nestedDef ? liveSource(ctx.doc, nestedDef) : null;
    if (nestedId && (!nestedDef || !nestedSrc || seen.has(nestedId))) {
      out.push(degradeCopy(c));
      continue;
    }
    if (!nestedId || !nestedDef || !nestedSrc) {
      out.push(c);
      if (src.subtree.some((s) => s.parentId === (c.sourceId as string))) {
        out.push(
          ...expandTree(ctx, src, def, treeId, c.id, c.sourceId as string, set, values, depth, seen, consumed),
        );
      }
      continue;
    }
    // Nested instance: exposed aliases from this level's def flow in.
    const nestedValues: Record<string, boolean | string> = { ...(c.variant?.values ?? {}), ...(c.exposedValues ?? {}) };
    const nestedSet = liveSet(ctx.doc, c);
    const nestedDefs = nestedSet ? new Map(nestedSet.properties.map((p) => [p.name, p])) : null;
    for (const [alias, target] of Object.entries(def.exposed ?? {})) {
      if (target.instance !== c.sourceId || !(alias in values)) continue;
      const pd = nestedDefs?.get(target.prop);
      const v = values[alias];
      if (!pd) continue;
      if (pd.kind === 'boolean' && typeof v === 'boolean') nestedValues[target.prop] = v;
      else if (pd.kind === 'text' && typeof v === 'string') nestedValues[target.prop] = v;
    }
    if (nestedSet) c.variant = { setId: nestedSet.id, values: nestedValues };
    const kids = expandTree(
      ctx, nestedSrc, nestedDef, treeId, c.id, nestedSrc.root.id,
      nestedSet, nestedValues, depth + 1, new Set([...seen, nestedId]), new Set(),
    );
    c.componentSnapshot = snapshotOfDirect(kids, c.id);
    out.push(c, ...kids);
  }
  return out;
}

function regenOne(
  doc: UndesignDoc,
  objects: DesignObject[],
  root: DesignObject,
  def: ComponentDef,
  src: LiveSource,
  propCtx: RegenPropCtx | null = null,
): DesignObject[] {
  const ctx: TreeCtx = {
    doc,
    defs: new Map((doc.components ?? []).map((d) => [d.id, d])),
    budget: { n: 0 },
  };
  const topValues = { ...(propCtx?.values ?? {}), ...(root.exposedValues ?? {}) };
  const fresh = expandTree(
    ctx, src, def, root.id, root.id, src.root.id,
    propCtx?.set ?? null, topValues, 0, new Set([def.id]), new Set(),
  );
  const byId = new Map(objects.map((o) => [o.id, o]));
  const currentIds = new Set<string>();
  for (const o of objects) {
    if (o.sourceId !== null && o.sourceId !== undefined && isUnder(objects, o.id, root.id)) currentIds.add(o.id);
  }
  const freshIds = new Set(fresh.map((f) => f.id));
  // Orphan pool for same-name retention, keyed per level by parent + name.
  const pool = new Map<string, DesignObject[]>();
  for (const id of currentIds) {
    if (freshIds.has(id)) continue;
    const o = byId.get(id);
    if (!o) continue;
    const key = `${o.parentId ?? ''}::${o.name}`;
    const list = pool.get(key);
    if (list) list.push(o);
    else pool.set(key, [o]);
  }
  const snapOf = (parentId: string): Record<string, DesignObject> => {
    if (parentId === root.id) return root.componentSnapshot ?? {};
    return byId.get(parentId)?.componentSnapshot ?? {};
  };
  const merged: DesignObject[] = [];
  let same = true;
  for (const f of fresh) {
    const cur = currentIds.has(f.id) ? byId.get(f.id) : undefined;
    if (cur) {
      const base = snapOf(f.parentId as string)[f.sourceId as string];
      const over = base ? diffProps(cur, base) : {};
      const m = { ...f, ...over, id: f.id, parentId: f.parentId };
      if (deepEqual(m, cur)) {
        merged.push(cur);
      } else {
        merged.push(m);
        same = false;
      }
      continue;
    }
    // Added child: variant switches carry same-named overrides over.
    const match = pool.get(`${f.parentId ?? ''}::${f.name}`)?.shift();
    const base = match?.sourceId != null ? snapOf(match.parentId as string)[match.sourceId] : undefined;
    const over = match ? retainedOverrides(match, base, f) : {};
    merged.push(Object.keys(over).length > 0 ? { ...f, ...over, id: f.id, parentId: f.parentId } : f);
    same = false;
  }
  if ([...currentIds].some((id) => !freshIds.has(id))) same = false;
  const newSnap = snapshotOfDirect(fresh, root.id);
  const snapSame = snapshotEqual(root.componentSnapshot ?? {}, newSnap);
  if (same && snapSame) return objects;
  // Merged output replaces the whole current expansion set (matched
  // children included); removals are simply absent from merged.
  const dropIds = new Set(currentIds);
  const out: DesignObject[] = [];
  for (const o of objects) {
    if (dropIds.has(o.id)) continue;
    if (o.id === root.id) {
      out.push(snapSame ? root : { ...root, componentSnapshot: newSnap });
      out.push(...merged);
    } else {
      out.push(o);
    }
  }
  return out;
}

/**
 * Propagate all live sources to their instances. Returns the identical
 * document reference when nothing changes (keeps history bail-outs working).
 * Runs inside applyDoc so source edits and instance updates share one step.
 */
export function regenInstances(doc: UndesignDoc): UndesignDoc {
  const defs = doc.components ?? [];
  if (defs.length === 0) return doc;
  let any = false;
  for (const p of doc.pages) {
    if (p.objects.some(isInstanceRoot)) {
      any = true;
      break;
    }
  }
  if (!any) return doc;
  const byId = new Map(defs.map((d) => [d.id, d]));
  const lookup = new Map<string, DesignObject>();
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (!page.objects.some(isInstanceRoot)) return page;
    let objects = page.objects;
    let pageChanged = false;
    for (const root of page.objects.filter(isInstanceRoot)) {
      // Nested copies regenerate with their own tree; only roots without an
      // instance-root ancestor drive regen (source-embedded roots included).
      lookup.clear();
      for (const o of objects) lookup.set(o.id, o);
      let p = root.parentId;
      let nested = false;
      const seen = new Set<string>();
      while (p !== null && p !== undefined && !seen.has(p)) {
        seen.add(p);
        const anc = lookup.get(p);
        if (!anc) break;
        if (isInstanceRoot(anc)) {
          nested = true;
          break;
        }
        p = anc.parentId;
      }
      if (nested) continue;
      const def = root.componentId !== null ? byId.get(root.componentId) : undefined;
      const src = def ? liveSource(doc, def) : null;
      if (!def || !src) continue;
      const set = liveSet(doc, root);
      const ctx = set ? { set, values: root.variant?.values ?? {} } : null;
      const next = regenOne(doc, objects, root, def, src, ctx);
      if (next !== objects) {
        objects = next;
        pageChanged = true;
      }
    }
    if (!pageChanged) return page;
    changed = true;
    return { ...page, objects };
  });
  return changed ? { ...doc, pages } : doc;
}

/* ================= creation ================= */

export type CreationBlocker = 'empty' | 'nested';

export function creationBlockers(objects: DesignObject[], ids: string[]): CreationBlocker | null {
  const wanted = new Set(ids);
  const sel = objects.filter((o) => wanted.has(o.id));
  if (sel.length === 0) return 'empty';
  // Instance roots may be wrapped (nested instances); only bare expansion
  // parts selected without their root are refused.
  for (const t of rootsOf(sel)) {
    if (isExpansion(t)) return 'nested';
  }
  return null;
}

export interface ComponentIdPack {
  compId: string;
  componentsPageId: string;
  sourceRootId: string;
  instanceId: string;
  cloneId: (oldId: string) => string;
}

export type CreateResult = { doc: UndesignDoc } | { error: CreationBlocker };

/**
 * Turn the selected tops on a page into a component: clone them under a new
 * source frame on the components page, register the def, and replace the
 * selection with an instance. Page visuals are preserved exactly.
 */
export function createComponent(
  doc: UndesignDoc,
  pageId: string,
  ids: string[],
  name: string,
  pack: ComponentIdPack,
): CreateResult {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return { error: 'empty' };
  const blocker = creationBlockers(page.objects, ids);
  if (blocker) return { error: blocker };
  const wanted = new Set(ids);
  const tops = rootsOf(page.objects.filter((o) => wanted.has(o.id)));
  const inSel = new Set<string>();
  for (const t of tops) {
    inSel.add(t.id);
    for (const d of descendantIds(page.objects, t.id)) inSel.add(d);
  }
  const sub = page.objects.filter((o) => inSel.has(o.id));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of sub) {
    const b = transformedBounds(page.objects, o);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (x0 === Infinity) return { error: 'empty' };
  const parents = new Set(tops.map((t) => t.parentId));
  const commonParent = parents.size === 1 ? tops[0].parentId : null;
  const parentObj =
    commonParent === null ? null : page.objects.find((o) => o.id === commonParent) ?? null;
  const parentM = parentObj ? pageMatrixOf(page.objects, parentObj) : IDENTITY;
  const inv = invertMatrix(parentM);
  const origin = inv ? applyMatrix(inv, x0, y0) : { x: x0, y: y0 };

  const instanceRoot = frameShell({
    id: pack.instanceId,
    name,
    parentId: commonParent,
    x: origin.x,
    y: origin.y,
    w: x1 - x0,
    h: y1 - y0,
  });
  // Source clone ids, then expansion locals: tops reparented exactly
  // (group-style), descendants copied verbatim under identical parents.
  const srcIds = new Map<string, string>();
  for (const o of sub) srcIds.set(o.id, pack.cloneId(o.id));
  const withRoot = [...page.objects, instanceRoot];
  const topIds = new Set(tops.map((t) => t.id));
  // Nested content keeps its identity through creation: nested roots mirror
  // the new source nodes, while nested-inner copies keep regen-matching ids
  // (tree id + original source id) plus seeded snapshots, so a later regen
  // matches them by id and preserves their values as overrides.
  const subById = new Map(sub.map((o) => [o.id, o]));
  const nestedRoots = new Set(sub.filter((o) => isInstanceRoot(o)).map((o) => o.id));
  const nestedInner = new Set<string>();
  for (const o of sub) {
    if (nestedRoots.has(o.id)) continue;
    let p = o.parentId;
    const seenP = new Set<string>();
    while (p !== null && p !== undefined && !seenP.has(p)) {
      seenP.add(p);
      if (nestedRoots.has(p)) {
        nestedInner.add(o.id);
        break;
      }
      p = subById.get(p)?.parentId ?? null;
    }
  }
  const outerRootOf = (id: string): string | null => {
    let cur: string | null | undefined = id;
    let found: string | null = null;
    const seenO = new Set<string>();
    while (cur !== null && cur !== undefined && !seenO.has(cur)) {
      seenO.add(cur);
      if (nestedRoots.has(cur)) found = cur;
      cur = subById.get(cur)?.parentId ?? null;
    }
    return found;
  };
  const nestedMarkersOf = (o: DesignObject): Pick<DesignObject, 'componentId' | 'componentSnapshot' | 'variant'> =>
    nestedRoots.has(o.id) || nestedInner.has(o.id)
      ? {
          componentId: o.componentId,
          componentSnapshot: o.componentSnapshot ? { ...o.componentSnapshot } : null,
          variant: o.variant ? { setId: o.variant.setId, values: { ...o.variant.values } } : null,
        }
      : { componentId: null, componentSnapshot: null, variant: null };
  const expansion: DesignObject[] = sub.map((o) => {
    const sid = srcIds.get(o.id) as string;
    const inner = nestedInner.has(o.id);
    const eid = inner ? expansionId(pack.instanceId, o.sourceId as string) : expansionId(pack.instanceId, sid);
    const esid = inner ? o.sourceId : sid;
    if (topIds.has(o.id)) {
      const l = reparentLocal(withRoot, o, pack.instanceId, { round: false });
      return { ...o, id: eid, parentId: pack.instanceId, x: l.x, y: l.y, rotation: l.rotation, sourceId: esid, ...nestedMarkersOf(o) };
    }
    const p = subById.get(o.parentId as string);
    const ppid =
      p && nestedInner.has(p.id)
        ? expansionId(pack.instanceId, p.sourceId as string)
        : expansionId(pack.instanceId, srcIds.get(o.parentId as string) as string);
    return { ...o, id: eid, parentId: ppid, sourceId: esid, ...nestedMarkersOf(o) };
  });
  const liveRoot: DesignObject = {
    ...instanceRoot,
    componentId: pack.compId,
    componentSnapshot: snapshotOfDirect(expansion, pack.instanceId),
  };

  // Source wrapper + clones on the components page (relative layout copied).
  let compPage = doc.pages.find((p) => p.id === pack.componentsPageId) ?? null;
  const cursorY =
    compPage === null
      ? 0
      : compPage.objects.reduce((m, o) => (o.parentId === null ? Math.max(m, o.y + o.h) : m), 0);
  const gapY = compPage === null || compPage.objects.length === 0 ? 0 : cursorY + 48;
  const sourceRoot = frameShell({
    id: pack.sourceRootId,
    name: `${name} source`,
    parentId: null,
    x: 0,
    y: gapY,
    w: x1 - x0,
    h: y1 - y0,
  });
  const expByOld = new Map(expansion.map((e) => [e.sourceId as string, e]));
  const clones = sub.map((o) => {
    const inner = nestedInner.has(o.id);
    const e = expByOld.get((inner ? o.sourceId : srcIds.get(o.id)) as string) as DesignObject;
    if (inner) {
      // Nested-inner clones live under their outermost root clone with
      // regen-matching ids, mirroring the canvas side one level down.
      const outer = outerRootOf(o.id) as string;
      const rclone = srcIds.get(outer) as string;
      const p = subById.get(o.parentId as string);
      const ppid =
        p && nestedRoots.has(p.id) && !nestedInner.has(p.id)
          ? (srcIds.get(p.id) as string)
          : expansionId(rclone, p?.sourceId as string);
      return {
        ...o,
        id: expansionId(rclone, o.sourceId as string),
        parentId: ppid,
        x: e.x,
        y: e.y,
        rotation: e.rotation,
        sourceId: o.sourceId,
        ...nestedMarkersOf(o),
      };
    }
    return {
      ...o,
      id: srcIds.get(o.id) as string,
      parentId: topIds.has(o.id) ? pack.sourceRootId : (srcIds.get(o.parentId as string) as string),
      x: e.x,
      y: e.y,
      rotation: e.rotation,
      sourceId: null,
      ...nestedMarkersOf(o),
    };
  });

  const firstIdx = Math.min(...tops.map((t) => page.objects.findIndex((o) => o.id === t.id)));
  const kept = page.objects.filter((o) => !inSel.has(o.id));
  kept.splice(firstIdx, 0, liveRoot, ...expansion);
  const def: ComponentDef = { id: pack.compId, name, pageId: pack.componentsPageId, rootId: pack.sourceRootId, exposed: {} };
  const pages = doc.pages.map((p) => (p.id === page.id ? { ...p, objects: kept } : p));
  if (compPage === null) {
    pages.push({ id: pack.componentsPageId, name: COMPONENTS_PAGE_NAME, objects: [sourceRoot, ...clones] });
  } else {
    const idx = pages.findIndex((p) => p.id === compPage.id);
    pages[idx] = { ...pages[idx], objects: [...pages[idx].objects, sourceRoot, ...clones] };
  }
  return { doc: { ...doc, pages, components: [...(doc.components ?? []), def] } };
}

/* ================= instances: insert / detach / reset ================= */

/** Fresh root + expansion for inserting an instance of a component. */
export function buildInstance(
  doc: UndesignDoc,
  compId: string,
  instanceId: string,
): { root: DesignObject; children: DesignObject[] } | null {
  const def = (doc.components ?? []).find((d) => d.id === compId);
  const src = def ? liveSource(doc, def) : null;
  if (!def || !src) return null;
  const set = (doc.variantSets ?? []).find((s) => s.variants.includes(compId)) ?? null;
  const values = set ? defaultPropValues(set) : {};
  const ctx: TreeCtx = {
    doc,
    defs: new Map((doc.components ?? []).map((d) => [d.id, d])),
    budget: { n: 0 },
  };
  const children = expandTree(ctx, src, def, instanceId, instanceId, src.root.id, set, values, 0, new Set([compId]), new Set());
  const root: DesignObject = {
    ...frameShell({ id: instanceId, name: def.name, parentId: null, x: 0, y: 0, w: src.root.w, h: src.root.h }),
    componentId: compId,
    componentSnapshot: snapshotOfDirect(children, instanceId),
    variant: set ? { setId: set.id, values } : null,
  };
  return { root, children };
}

/** Turn one instance into plain objects; geometry and visuals untouched. */
export function detachInstance(objects: DesignObject[], instanceId: string): DesignObject[] | null {
  const root = objects.find((o) => o.id === instanceId);
  if (!root || !isInstanceRoot(root)) return null;
  const under = new Set([instanceId, ...descendantIds(objects, instanceId)]);
  return objects.map((o) => {
    if (o.id === instanceId) {
      return { ...o, componentId: null, componentSnapshot: null, variant: null, exposedValues: null };
    }
    if (under.has(o.id) && isExpansion(o)) {
      // Nested copies strip fully (no dangling roots); plain mirrors keep
      // their values as ordinary objects.
      return isInstanceRoot(o)
        ? { ...o, sourceId: null, componentId: null, componentSnapshot: null, variant: null, exposedValues: null }
        : { ...o, sourceId: null };
    }
    return o;
  });
}

/**
 * Drop defs by id. Instances of a dropped def move to their set's default
 * surviving variant when one exists, else detach into plain objects.
 * Sets left without variants are removed. The applyDoc regen pass
 * re-expands re-pointed instances in the same commit.
 */
export function detachComponents(doc: UndesignDoc, compIds: string[]): UndesignDoc {
  const drop = new Set(compIds);
  if (drop.size === 0) return doc;
  const defs = doc.components ?? [];
  if (!defs.some((d) => drop.has(d.id))) return doc;
  const sets = (doc.variantSets ?? [])
    .map((s) => ({ ...s, variants: s.variants.filter((v) => !drop.has(v)) }))
    .filter((s) => s.variants.length > 0);
  const setById = new Map(sets.map((s) => [s.id, s]));
  const pages = doc.pages.map((page) => {
    if (!page.objects.some((o) => o.componentId !== null && drop.has(o.componentId as string))) {
      return page;
    }
    let objects = page.objects;
    for (const root of page.objects.filter(
      (o) => o.componentId !== null && drop.has(o.componentId as string),
    )) {
      const rescue = root.variant ? setById.get(root.variant.setId)?.variants[0] : undefined;
      if (rescue) {
        objects = objects.map((o) => (o.id === root.id ? { ...o, componentId: rescue } : o));
        continue;
      }
      const next = detachInstance(objects, root.id);
      if (next) objects = next;
    }
    return objects === page.objects ? page : { ...page, objects };
  });
  return {
    ...doc,
    pages,
    components: defs.filter((d) => !drop.has(d.id)),
    variantSets: sets,
  };
}

/** Re-expand one instance fresh from its source, dropping all overrides. */
export function resetInstance(doc: UndesignDoc, instanceId: string): UndesignDoc {
  for (const page of doc.pages) {
    const root = page.objects.find((o) => o.id === instanceId);
    if (!root || !isInstanceRoot(root)) continue;
    const def = (doc.components ?? []).find((d) => d.id === root.componentId);
    const src = def ? liveSource(doc, def) : null;
    if (!src) return doc;
    if (root.sourceId !== null && root.sourceId !== undefined) continue;
    const set = liveSet(doc, root);
    const values = set ? defaultPropValues(set) : {};
    const ctx: TreeCtx = {
      doc,
      defs: new Map((doc.components ?? []).map((d) => [d.id, d])),
      budget: { n: 0 },
    };
    if (!def) return doc;
    const based = expandTree(ctx, src, def, root.id, root.id, src.root.id, set, values, 0, new Set([def.id]), new Set());
    const newSnap = snapshotOfDirect(based, root.id);
    const dropIds = new Set<string>();
    for (const o of page.objects) {
      if (isExpansion(o) && isUnder(page.objects, o.id, root.id)) dropIds.add(o.id);
    }
    const current = page.objects.filter((o) => dropIds.has(o.id));
    const sameOrder =
      current.length === based.length &&
      current.every((c, i) => c.id === based[i].id && deepEqual(c, based[i]));
    const valuesSame = !set || !root.variant || deepEqual(root.variant.values, values);
    const exposedSame =
      root.exposedValues === null ||
      root.exposedValues === undefined ||
      Object.keys(root.exposedValues).length === 0;
    if (sameOrder && snapshotEqual(root.componentSnapshot ?? {}, newSnap) && valuesSame && exposedSame) return doc;
    const objects: DesignObject[] = [];
    for (const o of page.objects) {
      if (dropIds.has(o.id)) continue;
      if (o.id === root.id) {
        objects.push({
          ...root,
          componentSnapshot: newSnap,
          variant: set && root.variant ? { setId: set.id, values } : root.variant,
          exposedValues: null,
        });
        objects.push(...based);
      } else {
        objects.push(o);
      }
    }
    return {
      ...doc,
      pages: doc.pages.map((p) => (p.id === page.id ? { ...p, objects } : p)),
    };
  }
  return doc;
}

/* ================= variant sets: combine / switch / props ================= */

/** The set containing a component def, if any. */
export function setContaining(doc: UndesignDoc, compId: string): VariantSet | null {
  return (doc.variantSets ?? []).find((s) => s.variants.includes(compId)) ?? null;
}

export type CombineResult = { doc: UndesignDoc; setId: string; instanceId: string } | { error: CreationBlocker | 'single' };

/**
 * Turn 2+ selected tops into a variant set: each top becomes its own def +
 * source, the first top's position keeps the set instance, the rest are
 * removed from the canvas (their sources remain). One commit.
 */
export function combineAsVariants(
  doc: UndesignDoc,
  pageId: string,
  ids: string[],
  name: string,
  setId: string,
  packFor: (i: number) => ComponentIdPack,
): CombineResult {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return { error: 'empty' };
  const blocker = creationBlockers(page.objects, ids);
  if (blocker) return { error: blocker };
  const wanted = new Set(ids);
  const tops = rootsOf(page.objects.filter((o) => wanted.has(o.id)));
  if (tops.length < 2) return { error: 'single' };
  let cur = doc;
  const defIds: string[] = [];
  const instanceIds: string[] = [];
  for (let i = 0; i < tops.length; i++) {
    const pack = packFor(i);
    const res = createComponent(cur, pageId, [tops[i].id], `${name} / ${tops[i].name}`, pack);
    if ('error' in res) return res;
    cur = res.doc;
    defIds.push(pack.compId);
    instanceIds.push(pack.instanceId);
  }
  const pg = cur.pages.find((p) => p.id === pageId);
  if (!pg) return { error: 'empty' };
  const doomed = new Set<string>();
  for (const iid of instanceIds.slice(1)) {
    doomed.add(iid);
    for (const d of descendantIds(pg.objects, iid)) doomed.add(d);
  }
  const set: VariantSet = { id: setId, name, properties: [], variants: defIds, bindings: {} };
  const pages = cur.pages.map((p) => {
    if (p.id !== pageId) return p;
    return {
      ...p,
      objects: p.objects
        .filter((o) => !doomed.has(o.id))
        .map((o) => (o.id === instanceIds[0] ? { ...o, variant: { setId, values: {} } } : o)),
    };
  });
  return {
    doc: { ...cur, pages, variantSets: [...(cur.variantSets ?? []), set] },
    setId,
    instanceId: instanceIds[0],
  };
}

/**
 * Switch an instance to another variant of its set. Expansion re-resolves
 * from the new source with same-name override retention (see regenOne).
 */
export function switchVariant(doc: UndesignDoc, instanceId: string, targetCompId: string): UndesignDoc {
  const set = setContaining(doc, targetCompId);
  if (!set) return doc;
  const def = (doc.components ?? []).find((d) => d.id === targetCompId);
  if (!def || !liveSource(doc, def)) return doc;
  let found = false;
  const pages = doc.pages.map((page) => {
    const root = page.objects.find((o) => o.id === instanceId);
    if (!root || !isInstanceRoot(root)) return page;
    if (root.sourceId !== null && root.sourceId !== undefined) return page;
    if (root.variant?.setId !== set.id) return page;
    if (root.componentId === targetCompId) return page;
    found = true;
    return {
      ...page,
      objects: page.objects.map((o) => (o.id === instanceId ? { ...o, componentId: targetCompId } : o)),
    };
  });
  if (!found) return doc;
  return regenInstances({ ...doc, pages });
}

/**
 * Set property values on an instance. Unknown properties and mistyped
 * values are ignored; no valid change returns the identical document.
 */
export function setInstancePropValues(
  doc: UndesignDoc,
  instanceId: string,
  patch: Record<string, boolean | string>,
): UndesignDoc {
  for (const page of doc.pages) {
    const root = page.objects.find((o) => o.id === instanceId);
    if (!root || !isInstanceRoot(root)) continue;
    if (root.sourceId !== null && root.sourceId !== undefined) continue;
    const set = liveSet(doc, root);
    const def = (doc.components ?? []).find((d) => d.id === root.componentId);
    const controls = def ? new Map(exposedControls(doc, def).map((c) => [c.alias, c])) : new Map();
    if ((!set || !root.variant) && controls.size === 0) return doc;
    const propDefs = new Map((set?.properties ?? []).map((p) => [p.name, p]));
    const values = { ...(root.variant?.values ?? {}) };
    const exposed = { ...(root.exposedValues ?? {}) };
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      const pd = propDefs.get(k);
      if (pd && set && root.variant) {
        if (pd.kind === 'boolean' && typeof v !== 'boolean') continue;
        if (pd.kind === 'text' && typeof v !== 'string') continue;
        if (!Object.is(values[k], v)) {
          values[k] = v;
          changed = true;
        }
        continue;
      }
      const ctrl = controls.get(k);
      if (!ctrl) continue;
      if (ctrl.kind === 'boolean' && typeof v !== 'boolean') continue;
      if (ctrl.kind === 'text' && typeof v !== 'string') continue;
      if (!Object.is(exposed[k], v)) {
        exposed[k] = v;
        changed = true;
      }
    }
    if (!changed) return doc;
    const next: UndesignDoc = {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === page.id
          ? {
              ...p,
              objects: p.objects.map((o) =>
                o.id === instanceId
                  ? {
                      ...o,
                      variant: set && root.variant ? { setId: set.id, values } : root.variant,
                      exposedValues: Object.keys(exposed).length > 0 ? exposed : null,
                    }
                  : o,
              ),
            }
          : p,
      ),
    };
    return regenInstances(next);
  }
  return doc;
}

/**
 * Drop one property override from an instance root, restoring the default.
 * Deletes the key from variant values or exposed values (whichever holds
 * it); a prop with no stored override is a no-op (same doc reference).
 */
export function resetInstancePropValue(
  doc: UndesignDoc,
  instanceId: string,
  prop: string,
): UndesignDoc {
  for (const page of doc.pages) {
    const root = page.objects.find((o) => o.id === instanceId);
    if (!root || !isInstanceRoot(root)) continue;
    if (root.sourceId !== null && root.sourceId !== undefined) continue;
    const inVariant =
      root.variant !== null && root.variant !== undefined && prop in root.variant.values;
    const inExposed =
      root.exposedValues !== null &&
      root.exposedValues !== undefined &&
      prop in root.exposedValues;
    if (!inVariant && !inExposed) return doc;
    const values = { ...(root.variant?.values ?? {}) };
    delete values[prop];
    const exposed = { ...(root.exposedValues ?? {}) };
    delete exposed[prop];
    const next: UndesignDoc = {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === page.id
          ? {
              ...p,
              objects: p.objects.map((o) =>
                o.id === instanceId
                  ? {
                      ...o,
                      variant: root.variant ? { setId: root.variant.setId, values } : root.variant,
                      exposedValues: Object.keys(exposed).length > 0 ? exposed : null,
                    }
                  : o,
              ),
            }
          : p,
      ),
    };
    return regenInstances(next);
  }
  return doc;
}

/** Add a boolean/text property to the set containing a component def. */
export function addComponentProp(doc: UndesignDoc, compId: string, kind: 'boolean' | 'text'): UndesignDoc {
  const set = setContaining(doc, compId);
  if (!set) return doc;
  const names = new Set(set.properties.map((p) => p.name));
  let n = set.properties.length + 1;
  let name = `Property ${n}`;
  while (names.has(name)) {
    n += 1;
    name = `Property ${n}`;
  }
  const prop = { name, kind, default: (kind === 'boolean' ? true : '') as boolean | string };
  return {
    ...doc,
    variantSets: (doc.variantSets ?? []).map((s) =>
      s.id === set.id ? { ...s, properties: [...s.properties, prop] } : s,
    ),
  };
}

/** Delete a property (plus its binding and instance values) from a set. */
export function deleteComponentProp(doc: UndesignDoc, compId: string, name: string): UndesignDoc {
  const set = setContaining(doc, compId);
  if (!set || !set.properties.some((p) => p.name === name)) return doc;
  const bindings = { ...set.bindings };
  delete bindings[name];
  const sets = (doc.variantSets ?? []).map((s) =>
    s.id === set.id
      ? { ...s, properties: s.properties.filter((p) => p.name !== name), bindings }
      : s,
  );
  const pages = doc.pages.map((page) => {
    if (!page.objects.some((o) => o.variant?.setId === set.id)) return page;
    return {
      ...page,
      objects: page.objects.map((o) => {
        if (o.variant?.setId !== set.id) return o;
        const values = { ...o.variant.values };
        delete values[name];
        return { ...o, variant: { setId: set.id, values } };
      }),
    };
  });
  return regenInstances({ ...doc, pages, variantSets: sets });
}

/**
 * Bind a property to a source layer name (or unbind with null). The layer
 * must exist in the component's own source subtree; other variants resolve
 * the same name in theirs at regen time (missing names are skipped).
 */
export function bindComponentProp(
  doc: UndesignDoc,
  compId: string,
  name: string,
  layer: string | null,
): UndesignDoc {
  const set = setContaining(doc, compId);
  if (!set || !set.properties.some((p) => p.name === name)) return doc;
  const def = (doc.components ?? []).find((d) => d.id === compId);
  const src = def ? liveSource(doc, def) : null;
  if (!src) return doc;
  if (layer !== null) {
    const names = new Set(src.subtree.map((o) => o.name));
    if (!names.has(layer)) return doc;
  }
  const bindings = { ...set.bindings };
  if (layer === null) delete bindings[name];
  else bindings[name] = layer;
  const sets = (doc.variantSets ?? []).map((s) => (s.id === set.id ? { ...s, bindings } : s));
  return regenInstances({ ...doc, variantSets: sets });
}

/** Delete a set. Member defs stay; instances degrade to plain instances. */
export function deleteVariantSet(doc: UndesignDoc, setId: string): UndesignDoc {
  if (!(doc.variantSets ?? []).some((s) => s.id === setId)) return doc;
  const pages = doc.pages.map((page) => {
    if (!page.objects.some((o) => o.variant?.setId === setId)) return page;
    return {
      ...page,
      objects: page.objects.map((o) => (o.variant?.setId === setId ? { ...o, variant: null } : o)),
    };
  });
  return regenInstances({
    ...doc,
    pages,
    variantSets: (doc.variantSets ?? []).filter((s) => s.id !== setId),
  });
}

/* ================= reference cycles ================= */

/** Def-level reference graph: def -> defs instanced in its source subtree. */
export function componentRefGraph(doc: UndesignDoc): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const def of doc.components ?? []) {
    const src = liveSource(doc, def);
    const refs = new Set<string>();
    if (src) {
      for (const o of src.subtree) {
        if (o.componentId !== null && o.componentId !== undefined) refs.add(o.componentId);
      }
    }
    graph.set(def.id, refs);
  }
  return graph;
}

/** True when the def graph contains a reference cycle. */
export function hasComponentCycle(doc: UndesignDoc): boolean {
  const graph = componentRefGraph(doc);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  for (const id of graph.keys()) {
    if (visit(id)) return true;
  }
  return false;
}

/**
 * Break reference cycles in untrusted documents: nested instance roots
 * that reference cycle members degrade to plain subtrees (markers stripped
 * recursively). Idempotent; returns the identical doc when acyclic.
 */
export function breakComponentCycles(doc: UndesignDoc): UndesignDoc {
  const graph = componentRefGraph(doc);
  const reachesSelf = (start: string): boolean => {
    const stack = [...(graph.get(start) ?? [])];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === start) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of graph.get(id) ?? []) stack.push(next);
    }
    return false;
  };
  const cyclic = new Set<string>();
  for (const id of graph.keys()) {
    if (reachesSelf(id)) cyclic.add(id);
  }
  if (cyclic.size === 0) return doc;
  const stripIds = new Set<string>();
  for (const defId of cyclic) {
    const def = (doc.components ?? []).find((d) => d.id === defId);
    const src = def ? liveSource(doc, def) : null;
    if (!src) continue;
    for (const o of src.subtree) {
      if (o.componentId === null || o.componentId === undefined || !cyclic.has(o.componentId)) continue;
      stripIds.add(o.id);
      const stack = [o.id];
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        for (const k of src.subtree) {
          if (k.parentId === cur && !stripIds.has(k.id)) {
            stripIds.add(k.id);
            stack.push(k.id);
          }
        }
      }
    }
  }
  if (stripIds.size === 0) return doc;
  const pages = doc.pages.map((page) => {
    if (!page.objects.some((o) => stripIds.has(o.id))) return page;
    return {
      ...page,
      objects: page.objects.map((o) =>
        stripIds.has(o.id)
          ? { ...o, componentId: null, sourceId: null, componentSnapshot: null, variant: null }
          : o,
      ),
    };
  });
  return { ...doc, pages };
}

/* ================= swap / exposed / per-layer reset ================= */

/**
 * Swap an instance to another component (any set or plain). Same-name
 * overrides carry over via regen retention; same-named same-kind prop
 * values are kept, the rest reset to the target's defaults.
 */
export function swapInstance(doc: UndesignDoc, instanceId: string, targetCompId: string): UndesignDoc {
  const def = (doc.components ?? []).find((d) => d.id === targetCompId);
  if (!def || !liveSource(doc, def)) return doc;
  const targetSet = setContaining(doc, targetCompId);
  let found = false;
  const pages = doc.pages.map((page) => {
    const root = page.objects.find((o) => o.id === instanceId);
    if (!root || !isInstanceRoot(root)) return page;
    if (root.sourceId !== null && root.sourceId !== undefined) return page;
    if (root.componentId === targetCompId) return page;
    found = true;
    let variant: DesignObject['variant'] = null;
    if (targetSet) {
      const values = defaultPropValues(targetSet);
      const old = root.variant?.values ?? {};
      const kinds = new Map(targetSet.properties.map((p) => [p.name, p.kind]));
      for (const [k, v] of Object.entries(old)) {
        const kind = kinds.get(k);
        if (kind === 'boolean' && typeof v === 'boolean') values[k] = v;
        else if (kind === 'text' && typeof v === 'string') values[k] = v;
      }
      variant = { setId: targetSet.id, values };
    }
    return {
      ...page,
      objects: page.objects.map((o) =>
        o.id === instanceId ? { ...o, componentId: targetCompId, variant, exposedValues: null } : o,
      ),
    };
  });
  if (!found) return doc;
  return regenInstances({ ...doc, pages });
}

/** One control surfaced on instances for an exposed nested property. */
export interface ExposedControl {
  alias: string;
  kind: 'boolean' | 'text';
  default: boolean | string;
  /** Human label: nested layer name + prop, for UI. */
  label: string;
}

/** Resolved exposed controls for a def (dangling targets skipped). */
export function exposedControls(doc: UndesignDoc, def: ComponentDef): ExposedControl[] {
  const src = liveSource(doc, def);
  if (!src) return [];
  const subById = new Map(src.subtree.map((o) => [o.id, o]));
  const out: ExposedControl[] = [];
  for (const [alias, target] of Object.entries(def.exposed ?? {})) {
    const node = subById.get(target.instance);
    const nestedSet = node?.componentId ? setContaining(doc, node.componentId) : null;
    const prop = nestedSet?.properties.find((p) => p.name === target.prop);
    if (!node || !nestedSet || !prop) continue;
    out.push({ alias, kind: prop.kind, default: prop.default, label: `${node.name} · ${prop.name}` });
  }
  return out;
}

/**
 * Expose a nested instance's property under an alias. Refused when the
 * nested node is not an instance root, the prop is unknown on its set, or
 * the alias collides with a set property name or another target.
 */
export function exposeNestedProp(
  doc: UndesignDoc,
  compId: string,
  nestedSourceId: string,
  prop: string,
  alias: string,
): UndesignDoc {
  const clean = alias.trim();
  if (clean === '') return doc;
  const def = (doc.components ?? []).find((d) => d.id === compId);
  const src = def ? liveSource(doc, def) : null;
  if (!def || !src) return doc;
  const node = src.subtree.find((o) => o.id === nestedSourceId);
  if (!node || !node.componentId) return doc;
  const nestedSet = setContaining(doc, node.componentId);
  if (!nestedSet || !nestedSet.properties.some((p) => p.name === prop)) return doc;
  const ownSet = setContaining(doc, compId);
  if (ownSet && ownSet.properties.some((p) => p.name === clean)) return doc;
  const prev = (def.exposed ?? {})[clean];
  if (prev && (prev.instance !== nestedSourceId || prev.prop !== prop)) return doc;
  if (prev) return doc;
  const exposed = { ...(def.exposed ?? {}), [clean]: { instance: nestedSourceId, prop } };
  const next: UndesignDoc = {
    ...doc,
    components: (doc.components ?? []).map((d) => (d.id === compId ? { ...d, exposed } : d)),
  };
  return regenInstances(next);
}

/** Remove an exposed alias (plus its instance values) from a def. */
export function removeExposed(doc: UndesignDoc, compId: string, alias: string): UndesignDoc {
  const def = (doc.components ?? []).find((d) => d.id === compId);
  if (!def || !(def.exposed ?? {})[alias]) return doc;
  const exposed = { ...(def.exposed ?? {}) };
  delete exposed[alias];
  const pages = doc.pages.map((page) => {
    if (!page.objects.some((o) => o.componentId === compId && o.exposedValues)) return page;
    return {
      ...page,
      objects: page.objects.map((o) => {
        if (o.componentId !== compId || !o.exposedValues) return o;
        const values = { ...o.exposedValues };
        delete values[alias];
        return { ...o, exposedValues: Object.keys(values).length > 0 ? values : null };
      }),
    };
  });
  const next: UndesignDoc = {
    ...doc,
    pages,
    components: (doc.components ?? []).map((d) => (d.id === compId ? { ...d, exposed } : d)),
  };
  return regenInstances(next);
}

/**
 * Reset one expansion child's overrides back to its snapshot baseline
 * (post-prop values). Deeper levels under it are untouched.
 */
export function resetLayerOverride(doc: UndesignDoc, expansionId: string): UndesignDoc {
  for (const page of doc.pages) {
    const target = page.objects.find((o) => o.id === expansionId);
    if (!target || target.sourceId === null || target.sourceId === undefined) continue;
    const byId = new Map(page.objects.map((o) => [o.id, o]));
    let p = target.parentId;
    let owner: DesignObject | null = null;
    const seen = new Set<string>();
    while (p !== null && p !== undefined && !seen.has(p)) {
      seen.add(p);
      const node = byId.get(p);
      if (!node) break;
      if (isInstanceRoot(node)) {
        owner = node;
        break;
      }
      p = node.parentId;
    }
    if (!owner) return doc;
    const base = (owner.componentSnapshot ?? {})[target.sourceId];
    if (!base || deepEqual(target, base)) return doc;
    const restored = { ...base, id: target.id, parentId: target.parentId };
    const objects = page.objects.map((o) => (o.id === target.id ? restored : o));
    return { ...doc, pages: doc.pages.map((pp) => (pp.id === page.id ? { ...page, objects } : pp)) };
  }
  return doc;
}

/* ================= clone remap (duplicate / paste) ================= */

/**
 * Fix component markers on freshly cloned objects (which already carry new
 * random ids): instance roots get a new deterministic identity with remapped
 * descendants and snapshots; lone expansion children become plain objects.
 */
export function remapClonedInstances(
  clones: DesignObject[],
  freshId: () => string,
): DesignObject[] {
  const idMap = new Map<string, string>();
  const byId = new Map(clones.map((o) => [o.id, o]));
  const hasRootAncestor = (id: string): boolean => {
    let p = byId.get(id)?.parentId;
    const seen = new Set<string>();
    while (p !== null && p !== undefined && !seen.has(p)) {
      seen.add(p);
      const node = byId.get(p);
      if (!node) return false;
      if (isInstanceRoot(node)) return true;
      p = node.parentId;
    }
    return false;
  };
  const descendantsOf = (id: string): DesignObject[] => {
    const out: DesignObject[] = [];
    const stack = clones.filter((c) => c.parentId === id);
    while (stack.length > 0) {
      const c = stack.pop() as DesignObject;
      out.push(c);
      stack.push(...clones.filter((k) => k.parentId === c.id));
    }
    return out;
  };
  // Only outermost roots take fresh ids; the whole tree (nested levels
  // included) re-keys flat under the new top id, matching regen's scheme.
  for (const c of clones) {
    if (!isInstanceRoot(c) || hasRootAncestor(c.id)) continue;
    const newIid = freshId();
    idMap.set(c.id, newIid);
    for (const d of descendantsOf(c.id)) {
      if (isExpansion(d) && d.sourceId) idMap.set(d.id, expansionId(newIid, d.sourceId));
    }
  }
  const remapped = clones.map((c) => {
    let next = c;
    if (idMap.has(c.id)) next = { ...next, id: idMap.get(c.id) as string };
    if (c.parentId !== null && idMap.has(c.parentId)) {
      next = { ...next, parentId: idMap.get(c.parentId) as string };
    }
    return next;
  });
  // Snapshot values carry original-document ids; re-anchor them onto the
  // remapped children (matched per root by sourceId), keeping baseline props.
  const rebyId = new Map(remapped.map((c) => [c.id, c]));
  const ownerOf = (c: DesignObject): string | null => {
    const seen = new Set<string>();
    let p: string | null = c.id;
    while (p !== null && !seen.has(p)) {
      const node = rebyId.get(p);
      if (!node) return null;
      if (isInstanceRoot(node)) return node.id;
      seen.add(p);
      p = node.parentId;
    }
    return null;
  };
  const byOwnerSource = new Map<string, Map<string, DesignObject>>();
  for (const c of remapped) {
    if (!isExpansion(c) || !c.sourceId) continue;
    const owner = ownerOf(c);
    if (!owner) continue;
    let m = byOwnerSource.get(owner);
    if (!m) {
      m = new Map();
      byOwnerSource.set(owner, m);
    }
    m.set(c.sourceId, c);
  }
  const resnapped = remapped.map((c) => {
    if (!isInstanceRoot(c) || !c.componentSnapshot) return c;
    const kids = byOwnerSource.get(c.id);
    const ns: Record<string, DesignObject> = {};
    for (const [k, v] of Object.entries(c.componentSnapshot)) {
      const match = kids?.get(k);
      ns[k] = match ? { ...v, id: match.id, parentId: match.parentId } : { ...v };
    }
    return { ...c, componentSnapshot: ns };
  });
  // Lone expansion children (no instance-root ancestor in the set) go plain.
  // (ownerOf starts at self, so roots and lone children resolve correctly.)
  return resnapped.map((c) => {
    if (isExpansion(c) && ownerOf(c) === null) return { ...c, sourceId: null };
    return c;
  });
}
