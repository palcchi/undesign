/**
 * Design system foundation: shared color styles with linked fills.
 * Editing a style recolors every linked object in the same commit via
 * propagateStyles; direct fill edits detach the link (set fillStyleId null
 * at the edit site). Runs inside applyDoc; ref-preserving when idle.
 */
import type { DesignObject, UndesignDoc } from './types';

export function propagateStyles(prev: UndesignDoc, next: UndesignDoc): UndesignDoc {
  const prevColors = new Map((prev.colorStyles ?? []).map((s) => [s.id, s.color]));
  const changed = new Map<string, string>();
  for (const s of next.colorStyles ?? []) {
    const old = prevColors.get(s.id);
    if (old !== undefined && old !== s.color) changed.set(s.id, s.color);
  }
  if (changed.size === 0) return next;
  let docChanged = false;
  const pages = next.pages.map((page) => {
    const hit = page.objects.some(
      (o) => o.fillStyleId !== null && o.fillStyleId !== undefined && changed.has(o.fillStyleId),
    );
    if (!hit) return page;
    docChanged = true;
    return {
      ...page,
      objects: page.objects.map((o) =>
        o.fillStyleId !== null && o.fillStyleId !== undefined && changed.has(o.fillStyleId)
          ? { ...o, fill: changed.get(o.fillStyleId) as string }
          : o,
      ),
    };
  });
  return docChanged ? { ...next, pages } : next;
}

/** Object types that carry an editable solid fill (style-capable). */
export function canHaveFillStyle(type: DesignObject['type']): boolean {
  return type === 'frame' || type === 'rectangle' || type === 'ellipse' || type === 'text';
}
