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
import type { ComponentDef, DesignObject, DocPage, UndesignDoc } from './types';

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
    constraints: null,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0,
    cornerRadii: null,
    componentId: null,
    sourceId: null,
    componentSnapshot: null,
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

const DIFF_SKIP = new Set(['id', 'parentId']);

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
    // Nested instances degrade to plain frames (unreachable via UI guards).
    componentId: null,
    componentSnapshot: null,
  }));
}

export function snapshotOf(children: DesignObject[]): Record<string, DesignObject> {
  const snap: Record<string, DesignObject> = {};
  for (const c of children) {
    if (c.sourceId !== null && c.sourceId !== undefined) snap[c.sourceId] = c;
  }
  return snap;
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

function regenOne(
  objects: DesignObject[],
  root: DesignObject,
  src: LiveSource,
): DesignObject[] {
  const [, ...desc] = src.subtree;
  const fresh = expandChildren(src.root, desc, root.id);
  const snap = root.componentSnapshot ?? {};
  const currentBySource = new Map<string, DesignObject>();
  for (const o of objects) {
    if (o.sourceId !== null && o.sourceId !== undefined && isUnder(objects, o.id, root.id)) {
      currentBySource.set(o.sourceId, o);
    }
  }
  const merged: DesignObject[] = [];
  let same = true;
  for (const f of fresh) {
    const key = f.sourceId as string;
    const cur = currentBySource.get(key);
    if (!cur) {
      merged.push(f);
      same = false;
      continue;
    }
    const base = snap[key];
    const over = base ? diffProps(cur, base) : {};
    const m = { ...f, ...over, id: f.id, parentId: f.parentId };
    if (deepEqual(m, cur)) {
      merged.push(cur);
    } else {
      merged.push(m);
      same = false;
    }
  }
  const freshKeys = new Set(fresh.map((f) => f.sourceId));
  const removed = [...currentBySource.keys()].filter((k) => !freshKeys.has(k));
  if (removed.length > 0) same = false;
  const newSnap = snapshotOf(fresh);
  const snapSame = snapshotEqual(snap, newSnap);
  if (same && snapSame) return objects;
  const dropIds = new Set([...currentBySource.values()].map((o) => o.id));
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
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (!page.objects.some(isInstanceRoot)) return page;
    let objects = page.objects;
    let pageChanged = false;
    for (const root of page.objects.filter(isInstanceRoot)) {
      const def = root.componentId !== null ? byId.get(root.componentId) : undefined;
      const src = def ? liveSource(doc, def) : null;
      if (!src) continue;
      const next = regenOne(objects, root, src);
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
  const under = new Set<string>();
  for (const t of rootsOf(sel)) {
    under.add(t.id);
    for (const d of descendantIds(objects, t.id)) under.add(d);
  }
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const id of under) {
    const o = byId.get(id);
    if (o && (isInstanceRoot(o) || isExpansion(o))) return 'nested';
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
  const expansion: DesignObject[] = sub.map((o) => {
    const sid = srcIds.get(o.id) as string;
    if (topIds.has(o.id)) {
      const l = reparentLocal(withRoot, o, pack.instanceId, { round: false });
      return { ...o, id: expansionId(pack.instanceId, sid), parentId: pack.instanceId, x: l.x, y: l.y, rotation: l.rotation, sourceId: sid, componentId: null, componentSnapshot: null };
    }
    const psid = srcIds.get(o.parentId as string) as string;
    return { ...o, id: expansionId(pack.instanceId, sid), parentId: expansionId(pack.instanceId, psid), sourceId: sid, componentId: null, componentSnapshot: null };
  });
  const liveRoot: DesignObject = {
    ...instanceRoot,
    componentId: pack.compId,
    componentSnapshot: snapshotOf(expansion),
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
    const e = expByOld.get(srcIds.get(o.id) as string) as DesignObject;
    return {
      ...o,
      id: srcIds.get(o.id) as string,
      parentId: topIds.has(o.id) ? pack.sourceRootId : (srcIds.get(o.parentId as string) as string),
      x: e.x,
      y: e.y,
      rotation: e.rotation,
      sourceId: null,
      componentId: null,
      componentSnapshot: null,
    };
  });

  const firstIdx = Math.min(...tops.map((t) => page.objects.findIndex((o) => o.id === t.id)));
  const kept = page.objects.filter((o) => !inSel.has(o.id));
  kept.splice(firstIdx, 0, liveRoot, ...expansion);
  const def: ComponentDef = { id: pack.compId, name, pageId: pack.componentsPageId, rootId: pack.sourceRootId };
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
  const [, ...desc] = src.subtree;
  const children = expandChildren(src.root, desc, instanceId);
  const root: DesignObject = {
    ...frameShell({ id: instanceId, name: def.name, parentId: null, x: 0, y: 0, w: src.root.w, h: src.root.h }),
    componentId: compId,
    componentSnapshot: snapshotOf(children),
  };
  return { root, children };
}

/** Turn one instance into plain objects; geometry and visuals untouched. */
export function detachInstance(objects: DesignObject[], instanceId: string): DesignObject[] | null {
  const root = objects.find((o) => o.id === instanceId);
  if (!root || !isInstanceRoot(root)) return null;
  const under = new Set([instanceId, ...descendantIds(objects, instanceId)]);
  return objects.map((o) => {
    if (o.id === instanceId) return { ...o, componentId: null, componentSnapshot: null };
    if (under.has(o.id) && isExpansion(o)) return { ...o, sourceId: null };
    return o;
  });
}

/** Drop defs by id, detaching every instance of them on all pages. */
export function detachComponents(doc: UndesignDoc, compIds: string[]): UndesignDoc {
  const drop = new Set(compIds);
  if (drop.size === 0) return doc;
  const defs = doc.components ?? [];
  if (!defs.some((d) => drop.has(d.id))) return doc;
  const pages = doc.pages.map((page) => {
    if (!page.objects.some((o) => o.componentId !== null && drop.has(o.componentId as string))) {
      return page;
    }
    let objects = page.objects;
    for (const root of page.objects.filter(
      (o) => o.componentId !== null && drop.has(o.componentId as string),
    )) {
      const next = detachInstance(objects, root.id);
      if (next) objects = next;
    }
    return objects === page.objects ? page : { ...page, objects };
  });
  return { ...doc, pages, components: defs.filter((d) => !drop.has(d.id)) };
}

/** Re-expand one instance fresh from its source, dropping all overrides. */
export function resetInstance(doc: UndesignDoc, instanceId: string): UndesignDoc {
  for (const page of doc.pages) {
    const root = page.objects.find((o) => o.id === instanceId);
    if (!root || !isInstanceRoot(root)) continue;
    const def = (doc.components ?? []).find((d) => d.id === root.componentId);
    const src = def ? liveSource(doc, def) : null;
    if (!src) return doc;
    const [, ...desc] = src.subtree;
    const fresh = expandChildren(src.root, desc, root.id);
    const newSnap = snapshotOf(fresh);
    const dropIds = new Set<string>();
    for (const o of page.objects) {
      if (isExpansion(o) && isUnder(page.objects, o.id, root.id)) dropIds.add(o.id);
    }
    const current = page.objects.filter((o) => dropIds.has(o.id));
    const sameOrder =
      current.length === fresh.length &&
      current.every((c, i) => c.id === fresh[i].id && deepEqual(c, fresh[i]));
    if (sameOrder && snapshotEqual(root.componentSnapshot ?? {}, newSnap)) return doc;
    const objects: DesignObject[] = [];
    for (const o of page.objects) {
      if (dropIds.has(o.id)) continue;
      if (o.id === root.id) {
        objects.push({ ...root, componentSnapshot: newSnap });
        objects.push(...fresh);
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
  for (const c of clones) {
    if (!isInstanceRoot(c)) continue;
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
