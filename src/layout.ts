/**
 * Responsive layout: children with constraints follow parent frame resizes.
 * propagateConstraints(prev, next) applies the parent-size delta onto the
 * CURRENT child values, so a direct child edit in the same commit is never
 * clobbered. Runs inside applyDoc; ref-preserving when nothing applies.
 */
import type { Constraints, UndesignDoc } from './types';

type Rule = 'near' | 'center' | 'far' | 'stretch' | 'scale';

function hRule(h: Constraints['horizontal']): Rule {
  if (h === 'left') return 'near';
  if (h === 'center') return 'center';
  if (h === 'right') return 'far';
  return h;
}

function vRule(v: Constraints['vertical']): Rule {
  if (v === 'top') return 'near';
  if (v === 'middle') return 'center';
  if (v === 'bottom') return 'far';
  return v;
}

function solveAxis(
  rule: Rule,
  pos: number,
  size: number,
  oldLen: number,
  newLen: number,
): { pos: number; size: number } {
  if (oldLen === newLen) return { pos, size };
  switch (rule) {
    case 'near':
      return { pos, size };
    case 'far':
      return { pos: pos + (newLen - oldLen), size };
    case 'center':
      return { pos: pos + (newLen - oldLen) / 2, size };
    case 'stretch':
      return { pos, size: Math.max(1, size + (newLen - oldLen)) };
    case 'scale': {
      if (oldLen <= 0) return { pos, size };
      const k = newLen / oldLen;
      return { pos: pos * k, size: Math.max(1, size * k) };
    }
  }
}

export function propagateConstraints(prev: UndesignDoc, next: UndesignDoc): UndesignDoc {
  let changed = false;
  const pages = next.pages.map((page) => {
    const prevPage = prev.pages.find((p) => p.id === page.id);
    if (!prevPage) return page;
    const prevById = new Map(prevPage.objects.map((o) => [o.id, o]));
    const deltas = new Map<string, { ow: number; oh: number; nw: number; nh: number }>();
    for (const o of page.objects) {
      if (o.type !== 'frame') continue;
      const po = prevById.get(o.id);
      if (!po || po.type !== 'frame') continue;
      if (po.w === o.w && po.h === o.h) continue;
      deltas.set(o.id, { ow: po.w, oh: po.h, nw: o.w, nh: o.h });
    }
    if (deltas.size === 0) return page;
    let pageChanged = false;
    const objects = page.objects.map((o) => {
      if (o.parentId === null || o.constraints === null || o.constraints === undefined) return o;
      const d = deltas.get(o.parentId);
      if (!d) return o;
      const hx = solveAxis(hRule(o.constraints.horizontal), o.x, o.w, d.ow, d.nw);
      const vy = solveAxis(vRule(o.constraints.vertical), o.y, o.h, d.oh, d.nh);
      if (hx.pos === o.x && hx.size === o.w && vy.pos === o.y && vy.size === o.h) return o;
      pageChanged = true;
      return { ...o, x: hx.pos, y: vy.pos, w: hx.size, h: vy.size };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, objects };
  });
  return changed ? { ...next, pages } : next;
}


