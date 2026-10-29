/**
 * Responsive layout: children with constraints follow parent frame resizes.
 * propagateConstraints(prev, next) applies the parent-size delta onto the
 * CURRENT child values, so a direct child edit in the same commit is never
 * clobbered. Runs inside applyDoc; ref-preserving when nothing applies.
 */
import type { ChildSizing, Constraints, DesignObject, FrameLayout, SizingMode, UndesignDoc } from './types';
import { autoTextHeight } from './utils';

function kids(objects: DesignObject[], parentId: string): DesignObject[] {
  return objects.filter((o) => o.parentId === parentId);
}

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
    // In auto-layout frames, flow children are layout-owned: constraints
    // apply to absolute children only. Non-layout frames keep full behavior.
    const layoutOwned = new Set<string>();
    for (const f of page.objects) {
      if (f.type !== 'frame' || f.layout === null || f.layout === undefined) continue;
      for (const k of kids(page.objects, f.id)) {
        if (!(k.sizing?.absolute ?? false)) layoutOwned.add(k.id);
      }
    }
    let pageChanged = false;
    const objects = page.objects.map((o) => {
      if (o.parentId === null || o.constraints === null || o.constraints === undefined) return o;
      if (layoutOwned.has(o.id)) return o;
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

/* ================= auto-layout ================= */

/** Fresh container block: tidy row/column with a comfortable default gap. */
export function defaultFrameLayout(direction: FrameLayout['direction']): FrameLayout {
  return {
    direction,
    gap: 8,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    alignMain: 'start',
    alignCross: 'start',
  };
}

/** Fresh child sizing: fixed on both axes, in-flow. */
export function defaultChildSizing(): ChildSizing {
  return { h: 'fixed', v: 'fixed', minW: null, maxW: null, minH: null, maxH: null, absolute: false };
}

/** Width of one text line in px (injectable for deterministic tests). */
export type MeasureFn = (
  line: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
) => number;

let canvasCtx: CanvasRenderingContext2D | null | undefined;

/** Browser text measurement with a deterministic fallback (SSR/tests). */
export function defaultMeasureLine(
  line: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
): number {
  if (typeof document !== 'undefined') {
    try {
      canvasCtx ??= document.createElement('canvas').getContext('2d');
      if (canvasCtx) {
        canvasCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        return canvasCtx.measureText(line === '' ? ' ' : line).width;
      }
    } catch {
      // Fall through to the estimate below.
    }
  }
  return line.length * fontSize * 0.55;
}

function clampNum(v: number, min: number | null | undefined, max: number | null | undefined): number {
  let out = v;
  if (min !== null && min !== undefined) out = Math.max(min, out);
  if (max !== null && max !== undefined) out = Math.min(max, out);
  return out;
}

function treeDepth(objects: DesignObject[], id: string): number {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  let d = 0;
  let p = byId.get(id)?.parentId;
  while (p !== null && p !== undefined && !seen.has(p)) {
    seen.add(p);
    d += 1;
    p = byId.get(p)?.parentId;
  }
  return d;
}

/**
 * Content box for hug sizing. Text measures its lines; plain frames union
 * their direct children in local space (rotation ignored — accepted
 * limitation shared with the constraint solver); layout frames never reach
 * this branch (their own pass solves them); anything else has no intrinsic
 * content and keeps its current size.
 */
function hugContentSize(
  o: DesignObject,
  objects: DesignObject[],
  measure: MeasureFn,
): { w: number; h: number } {
  if (o.type === 'text') {
    let w = 0;
    for (const ln of o.text.split('\n')) {
      w = Math.max(w, measure(ln, o.fontFamily, o.fontSize, o.fontWeight));
    }
    return { w, h: autoTextHeight(o.text, o.fontSize, o.lineHeight) };
  }
  if (o.type === 'frame') {
    const children = kids(objects, o.id);
    if (children.length === 0) return { w: o.w, h: o.h };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const k of children) {
      x0 = Math.min(x0, k.x);
      y0 = Math.min(y0, k.y);
      x1 = Math.max(x1, k.x + k.w);
      y1 = Math.max(y1, k.y + k.h);
    }
    return { w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }
  return { w: o.w, h: o.h };
}

interface FlowItem {
  o: DesignObject;
  w: number;
  h: number;
}

/**
 * Lay out one auto-layout frame: solve child hug/fill sizes (main axis,
 * then cross axis), position the flow, then resize a hug parent on any
 * axis free of fill children. Pure: returns the input array when nothing
 * moves, otherwise a new array with only moved objects replaced.
 */
function layoutOneFrame(objects: DesignObject[], frame: DesignObject, measure: MeasureFn): DesignObject[] {
  const L = frame.layout as FrameLayout;
  const horiz = L.direction === 'horizontal';
  const gap = Math.max(0, L.gap);
  // Flow = direct children minus absolute ones and regen-owned mirrors.
  const flow = kids(objects, frame.id).filter(
    (k) => (k.sourceId === null || k.sourceId === undefined) && !(k.sizing?.absolute ?? false),
  );
  const mainMode = (o: DesignObject): SizingMode => (horiz ? (o.sizing?.h ?? 'fixed') : (o.sizing?.v ?? 'fixed'));
  const crossMode = (o: DesignObject): SizingMode => (horiz ? (o.sizing?.v ?? 'fixed') : (o.sizing?.h ?? 'fixed'));
  const mainMin = (o: DesignObject): number | null =>
    (horiz ? o.sizing?.minW : o.sizing?.minH) ?? null;
  const mainMax = (o: DesignObject): number | null =>
    (horiz ? o.sizing?.maxW : o.sizing?.maxH) ?? null;
  const crossMin = (o: DesignObject): number | null =>
    (horiz ? o.sizing?.minH : o.sizing?.minW) ?? null;
  const crossMax = (o: DesignObject): number | null =>
    (horiz ? o.sizing?.maxH : o.sizing?.maxW) ?? null;
  const mainLen = (it: FlowItem): number => (horiz ? it.w : it.h);
  const crossLen = (it: FlowItem): number => (horiz ? it.h : it.w);
  const setMain = (it: FlowItem, v: number): void => {
    if (horiz) it.w = v;
    else it.h = v;
  };
  const setCross = (it: FlowItem, v: number): void => {
    if (horiz) it.h = v;
    else it.w = v;
  };

  // 1. Intrinsic (hug) sizes, clamped by the child's own min/max. Frames with
  // their own layout block keep the size their deeper-first pass solved —
  // re-hugging them from the raw union box would drop their padding.
  const items: FlowItem[] = flow.map((o) => {
    const s = o.sizing;
    let w = o.w;
    let h = o.h;
    const selfSolved = o.type === 'frame' && o.layout !== null && o.layout !== undefined;
    if ((s?.h === 'hug' || s?.v === 'hug') && !selfSolved) {
      const content = hugContentSize(o, objects, measure);
      if (s.h === 'hug') w = clampNum(content.w, s.minW, s.maxW);
      if (s.v === 'hug') h = clampNum(content.h, s.minH, s.maxH);
    }
    return { o, w, h };
  });

  const padMainStart = horiz ? L.paddingLeft : L.paddingTop;
  const padMainEnd = horiz ? L.paddingRight : L.paddingBottom;
  const padCrossStart = horiz ? L.paddingTop : L.paddingLeft;
  const padCrossEnd = horiz ? L.paddingBottom : L.paddingRight;
  const mainBox = Math.max(0, (horiz ? frame.w : frame.h) - padMainStart - padMainEnd);
  const crossBox = Math.max(0, (horiz ? frame.h : frame.w) - padCrossStart - padCrossEnd);
  const gaps = gap * Math.max(0, items.length - 1);

  // 2. Main-axis fill: split the remainder, re-splitting around min/max clamps.
  const fills = items.filter((it) => mainMode(it.o) === 'fill');
  if (fills.length > 0) {
    const fixedTotal = items.reduce((s, it) => s + (mainMode(it.o) === 'fill' ? 0 : mainLen(it)), 0);
    let remaining = mainBox - fixedTotal - gaps;
    let open = [...fills];
    for (let round = 0; round <= fills.length && open.length > 0; round++) {
      const share = remaining / open.length;
      const clamped = open.filter((it) => clampNum(share, mainMin(it.o), mainMax(it.o)) !== share);
      if (clamped.length === 0) {
        for (const it of open) setMain(it, Math.max(0, share));
        break;
      }
      for (const it of clamped) {
        const v = Math.max(0, clampNum(share, mainMin(it.o), mainMax(it.o)));
        setMain(it, v);
        remaining -= v;
      }
      open = open.filter((it) => !clamped.includes(it));
    }
  }

  // 3. Cross-axis fill: stretch to the inner box (independent per child).
  for (const it of items) {
    if (crossMode(it.o) === 'fill') setCross(it, clampNum(crossBox, crossMin(it.o), crossMax(it.o)));
  }

  // 4. Main-axis positions.
  const contentMain = items.reduce((s, it) => s + mainLen(it), 0) + gaps;
  const free = mainBox - contentMain;
  let cursor: number;
  let step = gap;
  if (L.alignMain === 'end') cursor = padMainStart + Math.max(0, free);
  else if (L.alignMain === 'center') cursor = padMainStart + Math.max(0, free) / 2;
  else if (L.alignMain === 'space-between' && items.length > 1) {
    cursor = padMainStart;
    step = gap + Math.max(0, free) / (items.length - 1);
  } else cursor = padMainStart;
  const placeMain: number[] = [];
  for (const it of items) {
    placeMain.push(cursor);
    cursor += mainLen(it) + step;
  }
  const placeCross = (it: FlowItem): number => {
    const len = crossLen(it);
    if (L.alignCross === 'center') return padCrossStart + Math.max(0, crossBox - len) / 2;
    if (L.alignCross === 'end') return padCrossStart + Math.max(0, crossBox - len);
    return padCrossStart;
  };

  // 5. Hug parent: only on axes free of fill children (coherence rule), and
  // only when the parent itself opts into hug via its own sizing block.
  let fw = frame.w;
  let fh = frame.h;
  const fs = frame.sizing;
  if (!items.some((it) => mainMode(it.o) === 'fill')) {
    const want = horiz ? fs?.h === 'hug' : fs?.v === 'hug';
    if (want) {
      const v = clampNum(
        contentMain + padMainStart + padMainEnd,
        horiz ? fs?.minW : fs?.minH,
        horiz ? fs?.maxW : fs?.maxH,
      );
      if (horiz) fw = v;
      else fh = v;
    }
  }
  if (!items.some((it) => crossMode(it.o) === 'fill')) {
    const want = horiz ? fs?.v === 'hug' : fs?.h === 'hug';
    if (want) {
      const extent = items.reduce((m, it) => Math.max(m, crossLen(it)), 0);
      const v = clampNum(
        extent + padCrossStart + padCrossEnd,
        horiz ? fs?.minH : fs?.minW,
        horiz ? fs?.maxH : fs?.maxW,
      );
      if (horiz) fh = v;
      else fw = v;
    }
  }

  // 6. Write back only what moved.
  let changed = false;
  const targets = new Map<string, { x: number; y: number; w: number; h: number }>();
  items.forEach((it, i) => {
    targets.set(it.o.id, {
      x: horiz ? placeMain[i] : placeCross(it),
      y: horiz ? placeCross(it) : placeMain[i],
      w: it.w,
      h: it.h,
    });
  });
  const out = objects.map((o) => {
    if (o.id === frame.id) {
      if (o.w === fw && o.h === fh) return o;
      changed = true;
      return { ...o, w: fw, h: fh };
    }
    const p = targets.get(o.id);
    if (!p) return o;
    if (o.x === p.x && o.y === p.y && o.w === p.w && o.h === p.h) return o;
    changed = true;
    return { ...o, x: p.x, y: p.y, w: p.w, h: p.h };
  });
  return changed ? out : objects;
}

/**
 * Run auto-layout over every page. Layout frames are solved deepest-first
 * so inner hug sizes settle before outer frames measure them; the whole
 * sweep repeats while sizes still change (cap 4 rounds, nested content).
 * Docs without layout blocks return the input doc untouched.
 */
export function layoutFrames(next: UndesignDoc, measure: MeasureFn = defaultMeasureLine): UndesignDoc {
  let changed = false;
  const pages = next.pages.map((page) => {
    const frames = page.objects.filter((o) => o.type === 'frame' && o.layout !== null && o.layout !== undefined);
    if (frames.length === 0) return page;
    const ordered = [...frames].sort((a, b) => treeDepth(page.objects, b.id) - treeDepth(page.objects, a.id));
    let objects = page.objects;
    for (let round = 0; round < 4; round++) {
      let roundChanged = false;
      for (const f of ordered) {
        const live = objects.find((o) => o.id === f.id);
        if (!live || live.type !== 'frame') continue;
        const solved = layoutOneFrame(objects, live, measure);
        if (solved !== objects) {
          objects = solved;
          roundChanged = true;
        }
      }
      if (!roundChanged) break;
    }
    if (objects === page.objects) return page;
    changed = true;
    return { ...page, objects };
  });
  return changed ? { ...next, pages } : next;
}


