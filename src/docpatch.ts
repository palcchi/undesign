/**
 * Pure legacy-document patch helpers, extracted from the retired TypeScript
 * editor store so the regression suite keeps covering them. The live editor
 * no longer uses these; all main-route editing goes through the engine.
 */
import type { DesignObject, DocPage, ObjectPatch, UndesignDoc } from './types';
import { autoTextHeight, descendantIds } from './utils';
import { isExpansion } from './library';

function withActivePage(doc: UndesignDoc, fn: (page: DocPage) => DocPage): UndesignDoc {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === doc.activePageId ? fn(p) : p)),
  };
}

/** Pure object patch used by both committed and transient updates. */
export function patchDocObjects(
  doc: UndesignDoc,
  ids: string[],
  patch: ObjectPatch,
): UndesignDoc {
  const idSet = new Set(ids);
  return withActivePage(doc, (p) => ({
    ...p,
    objects: p.objects.map((o) => {
      if (!idSet.has(o.id)) return o;
      const next = { ...o, ...patch };
      if (
        o.type === 'text' &&
        patch.h === undefined &&
        (patch.text !== undefined ||
          patch.fontSize !== undefined ||
          patch.lineHeight !== undefined)
      ) {
        next.h = autoTextHeight(next.text, next.fontSize, next.lineHeight);
      }
      return next;
    }),
  }));
}

/**
 * Pure patch by id across every page. Style detach on delete must reach
 * linked objects on all pages, not just the active one.
 */
export function patchAllPages(
  doc: UndesignDoc,
  ids: string[],
  patch: ObjectPatch,
): UndesignDoc {
  const idSet = new Set(ids);
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (!p.objects.some((o) => idSet.has(o.id))) return p;
    changed = true;
    return { ...p, objects: p.objects.map((o) => (idSet.has(o.id) ? { ...o, ...patch } : o)) };
  });
  return changed ? { ...doc, pages } : doc;
}

/**
 * Pure deletion plan: expansion children locked inside a component instance
 * can never be deleted directly (detach first); everything else takes its
 * whole subtree with it. Unknown ids are harmless no-ops downstream.
 */
export function planObjectDeletion(
  objects: DesignObject[],
  ids: string[],
): { allowed: string[]; locked: string[]; doomed: Set<string> } {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const locked = ids.filter((id) => {
    const o = byId.get(id);
    return o !== undefined && isExpansion(o);
  });
  const lockedSet = new Set(locked);
  const allowed = ids.filter((id) => !lockedSet.has(id));
  const doomed = new Set<string>();
  for (const id of allowed) {
    doomed.add(id);
    for (const child of descendantIds(objects, id)) doomed.add(child);
  }
  return { allowed, locked, doomed };
}
