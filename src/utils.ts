import type { CornerRadii, DesignObject, DocPage, DropShadow, FillGradient, UndesignDoc, Viewport } from './types';
import {
  IDENTITY,
  ancestorChain,
  ancestorMatrixOf,
  applyMatrix,
  fmtNum,
  invertMatrix,
  isIdentity,
  matrixToSvg,
  normalizeDegrees,
  objectCorners,
  pageMatrixOf,
  pointInObject,
  quadsOverlap,
  rotateMatrix,
  transformedBounds,
  worldRotation,
} from './transform';

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
const FIT_MAX_ZOOM = 2;
const FIT_PAD = 96;

let counter = 0;

/** Short unique id, stable enough for document objects. */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`;
}

export function cloneDoc(doc: UndesignDoc): UndesignDoc {
  return JSON.parse(JSON.stringify(doc)) as UndesignDoc;
}

export function getPage(doc: UndesignDoc, id?: string): DocPage {
  const page =
    doc.pages.find((p) => p.id === (id ?? doc.activePageId)) ?? doc.pages[0];
  if (!page) throw new Error('Document has no pages');
  return page;
}

export function childrenOf(objects: DesignObject[], parentId: string | null): DesignObject[] {
  return objects.filter((o) => o.parentId === parentId);
}

/** All descendant ids of an object (frames can nest). Cycle-safe. */
export function descendantIds(objects: DesignObject[], id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const visit = (pid: string): void => {
    for (const o of objects) {
      if (o.parentId !== pid || seen.has(o.id)) continue;
      seen.add(o.id);
      out.push(o.id);
      visit(o.id);
    }
  };
  visit(id);
  return out;
}

/** Absolute page-space position of an object (walks up through frame parents). */
export function absolutePosition(
  objects: DesignObject[],
  obj: DesignObject,
): { x: number; y: number } {
  let x = obj.x;
  let y = obj.y;
  let current = obj;
  const byId = new Map(objects.map((o) => [o.id, o]));
  let guard = 0;
  while (current.parentId && guard < 100) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    current = parent;
    guard += 1;
  }
  return { x, y };
}

/** Geometric bounds of a w/h vector: origin at the min corner, non-negative size. */
export function vectorBounds(
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(0, w), y: Math.min(0, h), w: Math.abs(w), h: Math.abs(h) };
}

/** Absolute page-space geometric bounds (correct for negative line dims). */
export function absoluteBounds(
  objects: DesignObject[],
  obj: DesignObject,
): { x: number; y: number; w: number; h: number } {
  const p = absolutePosition(objects, obj);
  const g = vectorBounds(obj.w, obj.h);
  return { x: p.x + g.x, y: p.y + g.y, w: g.w, h: g.h };
}

/**
 * Canonical line geometry from two endpoints. The start is the leftmost
 * endpoint (tie: topmost), so w >= 0 always; h keeps its sign so the
 * diagonal direction (\ vs /) is preserved.
 */
export function canonicalLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; w: number; h: number } {
  if (x2 < x1 || (x2 === x1 && y2 < y1)) {
    return { x: x2, y: y2, w: x1 - x2, h: y1 - y2 };
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Move one line endpoint by a delta; returns canonical geometry.
 * Safe to drag an endpoint past the other end: the endpoints swap roles
 * instead of mirroring or collapsing the line.
 */
export function moveLineEnd(
  obj: { x: number; y: number; w: number; h: number },
  end: 0 | 1,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  const p0 = { x: obj.x, y: obj.y };
  const p1 = { x: obj.x + obj.w, y: obj.y + obj.h };
  if (end === 0) {
    p0.x += dx;
    p0.y += dy;
  } else {
    p1.x += dx;
    p1.y += dy;
  }
  return canonicalLine(p0.x, p0.y, p1.x, p1.y);
}

/**
 * New parent-relative origin after a resize to w/h via a compass handle.
 * The opposite corner/edge (the anchor) stays fixed in parent space: exact
 * for rotated objects, where a plain local shift would drift as the
 * center-based rotation frame moves. Identical to the legacy shift when
 * rotation is 0.
 */
export function resizeOrigin(
  orig: { x: number; y: number; w: number; h: number; rotation: number },
  handle: string,
  w: number,
  h: number,
): { x: number; y: number } {
  const axOld = handle.includes('e') ? 0 : handle.includes('w') ? orig.w : orig.w / 2;
  const ayOld = handle.includes('s') ? 0 : handle.includes('n') ? orig.h : orig.h / 2;
  const axNew = handle.includes('e') ? 0 : handle.includes('w') ? w : w / 2;
  const ayNew = handle.includes('s') ? 0 : handle.includes('n') ? h : h / 2;
  const anchor = applyMatrix(
    rotateMatrix(orig.rotation, orig.w / 2, orig.h / 2),
    axOld,
    ayOld,
  );
  const shifted = applyMatrix(rotateMatrix(orig.rotation, w / 2, h / 2), axNew, ayNew);
  return { x: orig.x + anchor.x - shifted.x, y: orig.y + anchor.y - shifted.y };
}

/** Deepest visible, unlocked frame containing a page-space point (draw auto-parent). */
export function deepestFrameAt(
  objects: DesignObject[],
  wx: number,
  wy: number,
): DesignObject | null {
  let best: DesignObject | null = null;
  let bestDepth = -1;
  for (const o of objects) {
    if (o.type !== 'frame' || !o.visible || o.locked) continue;
    if (!pointInObject(objects, o, wx, wy)) continue;
    const depth = ancestorChain(objects, o).length;
    if (depth >= bestDepth) {
      best = o;
      bestDepth = depth;
    }
  }
  return best;
}

/** Ids of selectable objects intersecting a marquee rect (page-space corners). */
export function marqueeHits(
  objects: DesignObject[],
  r1: { x: number; y: number },
  r2: { x: number; y: number },
): string[] {
  const minX = Math.min(r1.x, r2.x);
  const maxX = Math.max(r1.x, r2.x);
  const minY = Math.min(r1.y, r2.y);
  const maxY = Math.max(r1.y, r2.y);
  const box = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  return objects
    .filter((o) => {
      if (!o.visible || o.locked) return false;
      return quadsOverlap(objectCorners(objects, o), box);
    })
    .map((o) => o.id);
}

/** Axis-aligned bounds of visible objects in page space (rotation-aware). */
export function pageBounds(
  objects: DesignObject[],
): { x: number; y: number; w: number; h: number } | null {
  const visible = objects.filter((o) => o.visible);
  if (visible.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of visible) {
    const b = transformedBounds(objects, o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Union of transformed bounds over the given ids (hidden/unknown skipped). */
export function selectionBounds(
  objects: DesignObject[],
  ids: string[],
): { x: number; y: number; w: number; h: number } | null {
  const wanted = new Set(ids);
  const sel = objects.filter((o) => wanted.has(o.id) && o.visible);
  if (sel.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of sel) {
    const b = transformedBounds(objects, o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True for event targets where global shortcuts must stay out of the way:
 * text entry, native select type-ahead/arrows, and rich-text editing.
 */
export function isFormTarget(tagName: string | undefined, isContentEditable: boolean): boolean {
  return isContentEditable || (tagName !== undefined && FORM_TAGS.has(tagName.toUpperCase()));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Default display name for a new object of a type. */
export function defaultName(
  type: DesignObject['type'],
  objects: DesignObject[],
): string {
  const base =
    type === 'frame'
      ? 'Frame'
      : type === 'rectangle'
        ? 'Rectangle'
        : type === 'ellipse'
          ? 'Ellipse'
          : type === 'text'
            ? 'Text'
            : type === 'image'
              ? 'Image'
              : 'Line';
  const count = objects.filter((o) => o.type === type).length + 1;
  return `${base} ${count}`;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function normalizeHex(value: string, fallback: string): string {
  const v = value.trim();
  if (!isHexColor(v)) return fallback;
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  }
  return v.toUpperCase();
}

/** Commit decision for numeric property fields (parse, clamp, skip no-ops). */
export function resolveNumericCommit(
  text: string,
  current: number,
  min?: number,
  max?: number,
): { action: 'commit' | 'noop'; value?: number } {
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return { action: 'noop' };
  let v = parsed;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  if (v === current) return { action: 'noop' };
  return { action: 'commit', value: v };
}

/** Commit decision for hex color fields (normalize, clear, skip no-ops). */
export function resolveHexCommit(
  hex: string,
  current: string,
): { action: 'commit' | 'clear' | 'noop'; value?: string } {
  const trimmed = hex.trim();
  if (trimmed === '') {
    return current === '' ? { action: 'noop' } : { action: 'clear' };
  }
  if (!isHexColor(trimmed)) return { action: 'noop' };
  const v = normalizeHex(trimmed, current || '#111111');
  if (v === current) return { action: 'noop' };
  return { action: 'commit', value: v };
}

/** Convert world/page coordinates to screen coordinates. */
export function worldToScreen(
  wx: number,
  wy: number,
  viewport: { zoom: number; x: number; y: number },
): { x: number; y: number } {
  return { x: wx * viewport.zoom + viewport.x, y: wy * viewport.zoom + viewport.y };
}

/** Convert screen coordinates to world/page coordinates. */
export function screenToWorld(
  sx: number,
  sy: number,
  viewport: { zoom: number; x: number; y: number },
): { x: number; y: number } {
  return { x: (sx - viewport.x) / viewport.zoom, y: (sy - viewport.y) / viewport.zoom };
}

/** World-space point at the center of the visible canvas viewport. */
export function viewportCenterWorld(
  viewport: Viewport,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  return screenToWorld(canvasW / 2, canvasH / 2, viewport);
}

/** Integer origin placing a w/h box centered on a target point. */
export function centeredOrigin(
  w: number,
  h: number,
  target: { x: number; y: number },
): { x: number; y: number } {
  return { x: Math.round(target.x - w / 2), y: Math.round(target.y - h / 2) };
}

/** Members of a set whose parent is absent from it (insertion roots). */
export function rootsOf(objects: DesignObject[]): DesignObject[] {
  const ids = new Set(objects.map((o) => o.id));
  return objects.filter((o) => !o.parentId || !ids.has(o.parentId));
}

/**
 * Offset root objects so their combined geometric bounds center lands on the
 * target. Children keep their relative pose (positions are parent-relative),
 * so group structure is preserved.
 */
export function placeRootsAtCenter(
  objects: DesignObject[],
  target: { x: number; y: number },
): DesignObject[] {
  const roots = rootsOf(objects);
  if (roots.length === 0) return objects;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of roots) {
    const gx = r.x + Math.min(0, r.w);
    const gy = r.y + Math.min(0, r.h);
    minX = Math.min(minX, gx);
    minY = Math.min(minY, gy);
    maxX = Math.max(maxX, gx + Math.abs(r.w));
    maxY = Math.max(maxY, gy + Math.abs(r.h));
  }
  const dx = Math.round(target.x - (minX + maxX) / 2);
  const dy = Math.round(target.y - (minY + maxY) / 2);
  const rootIds = new Set(roots.map((r) => r.id));
  return objects.map((o) =>
    rootIds.has(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o,
  );
}

/** Zoom keeping the world point under (sx, sy) fixed. */
export function zoomAtPoint(
  v: Viewport,
  sx: number,
  sy: number,
  zoom: number,
): Viewport {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const world = screenToWorld(sx, sy, v);
  return { zoom: z, x: sx - world.x * z, y: sy - world.y * z };
}

/** Zoom keeping the container center fixed. */
export function zoomCentered(
  v: Viewport,
  containerW: number,
  containerH: number,
  zoom: number,
): Viewport {
  return zoomAtPoint(v, containerW / 2, containerH / 2, zoom);
}

/** Viewport fitting bounds into a container (graceful fallback when empty). */
export function fitViewport(
  bounds: { x: number; y: number; w: number; h: number } | null,
  containerW: number,
  containerH: number,
): Viewport {
  if (!bounds) {
    return { zoom: 1, x: containerW / 2 - 200, y: containerH / 3 };
  }
  const z = clamp(
    Math.min((containerW - FIT_PAD) / bounds.w, (containerH - FIT_PAD) / bounds.h),
    ZOOM_MIN,
    FIT_MAX_ZOOM,
  );
  return {
    zoom: z,
    x: (containerW - bounds.w * z) / 2 - bounds.x * z,
    y: (containerH - bounds.h * z) / 2 - bounds.y * z,
  };
}

/** Auto text-box height from explicit newlines (no wrapping engine in v1). */
export function autoTextHeight(text: string, fontSize: number, lineHeight: number): number {
  const lines = Math.max(1, text.split('\n').length);
  return Math.max(fontSize * lineHeight, lines * fontSize * lineHeight);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inner primitives of a drop-shadow filter. Zero spread keeps the compact
 * feDropShadow shorthand; positive spread expands the alpha with a dilate
 * stage first (the shorthand has no spread parameter). Shared by the canvas
 * and SVG export so both render identical shadows.
 */
export function shadowFilterInner(s: DropShadow): string {
  const spread = Math.max(0, s.spread ?? 0);
  if (spread === 0) {
    return `<feDropShadow dx="${fmtNum(s.offsetX)}" dy="${fmtNum(s.offsetY)}" stdDeviation="${fmtNum(s.blur)}" flood-color="${escapeXml(s.color)}" flood-opacity="${fmtNum(s.opacity)}" />`;
  }
  return (
    `<feMorphology in="SourceAlpha" operator="dilate" radius="${fmtNum(spread)}" result="d" />` +
    `<feGaussianBlur in="d" stdDeviation="${fmtNum(s.blur)}" result="b" />` +
    `<feOffset in="b" dx="${fmtNum(s.offsetX)}" dy="${fmtNum(s.offsetY)}" result="o" />` +
    `<feFlood flood-color="${escapeXml(s.color)}" flood-opacity="${fmtNum(s.opacity)}" result="c" />` +
    `<feComposite in="c" in2="o" operator="in" result="s" />` +
    `<feMerge><feMergeNode in="s" /><feMergeNode in="SourceGraphic" /></feMerge>`
  );
}

/** True when the object and all its ancestors are visible. */
function isEffectivelyVisible(objects: DesignObject[], obj: DesignObject): boolean {
  if (!obj.visible) return false;
  return ancestorChain(objects, obj).every((a) => a.visible);
}

function hasSelectedAncestor(
  objects: DesignObject[],
  sel: Set<string>,
  obj: DesignObject,
): boolean {
  return ancestorChain(objects, obj).some((a) => sel.has(a.id));
}

/** Top-most selected objects: effectively visible, with no selected ancestor. */
function topMostSelected(objects: DesignObject[], sel: Set<string>): DesignObject[] {
  return objects.filter(
    (o) =>
      sel.has(o.id) && isEffectivelyVisible(objects, o) && !hasSelectedAncestor(objects, sel, o),
  );
}

/** Roots plus their visible descendants (hidden subtrees skipped, cycle-safe). */
function collectRendered(objects: DesignObject[], roots: DesignObject[]): DesignObject[] {
  const out: DesignObject[] = [];
  const seen = new Set<string>();
  const visit = (o: DesignObject) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    out.push(o);
    for (const k of childrenOf(objects, o.id)) {
      if (k.visible) visit(k);
    }
  };
  roots.forEach(visit);
  return out;
}

function unionBounds(
  objects: DesignObject[],
  rendered: DesignObject[],
): { x: number; y: number; w: number; h: number } | null {
  if (rendered.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of rendered) {
    const b = transformedBounds(objects, o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/** Resolves an image asset id to an embeddable data URL (null when unavailable). */
export type AssetResolver = (imageId: string | null) => string | null;

function objectToSvg(
  objects: DesignObject[],
  obj: DesignObject,
  indent: string,
  clipIds: Map<string, string>,
  gradIds: Map<string, string>,
  shadowIds: Map<string, string>,
  assetDataUrl: AssetResolver | null,
  includeIds: boolean,
): string {
  const kids = childrenOf(objects, obj.id).filter((k) => k.visible);
  const inner = kids.map((k) => objectToSvg(objects, k, indent + '  ', clipIds, gradIds, shadowIds, assetDataUrl, includeIds)).join('');
  const shadowRef = shadowIds.get(obj.id);
  const filter = shadowRef ? ` filter="url(#${shadowRef})"` : '';
  const t =
    `translate(${fmtNum(obj.x)} ${fmtNum(obj.y)})` +
    (obj.rotation !== 0
      ? ` rotate(${fmtNum(obj.rotation)} ${fmtNum(obj.w / 2)} ${fmtNum(obj.h / 2)})`
      : '');
  const opacity = obj.opacity < 1 ? ` opacity="${obj.opacity}"` : '';
  const clipId = obj.type === 'frame' && obj.clip ? clipIds.get(obj.id) : undefined;
  const clip = clipId ? ` clip-path="url(#${clipId})"` : '';
  const idAttr = includeIds ? ` data-undesign-id="${escapeXml(obj.id)}"` : '';
  const open = `${indent}<g transform="${t}"${opacity}${clip}${idAttr}>\n`;
  const close = `${indent}</g>\n`;
  const si = indent + '  ';
  const gradRef = gradIds.get(obj.id);
  const paint = (fallback: string): string =>
    gradRef ? `url(#${gradRef})` : obj.fill ? escapeXml(obj.fill) : fallback;

  switch (obj.type) {
    case 'frame':
    case 'rectangle': {
      const fill = paint('none');
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      const stroke = obj.stroke
        ? ` stroke="${escapeXml(obj.stroke)}" stroke-width="${obj.strokeWidth}"`
        : '';
      if (hasIndependentCorners(obj)) {
        const d = roundedRectPath(obj.w, obj.h, resolveRadii(obj), (n) => String(fmtNum(n)));
        return `${open}${si}<path d="${d}" fill="${fill}"${fillOp}${stroke}${filter} />\n${inner}${close}`;
      }
      const rx = obj.cornerRadius > 0 ? ` rx="${fmtNum(obj.cornerRadius)}"` : '';
      return `${open}${si}<rect x="0" y="0" width="${fmtNum(obj.w)}" height="${fmtNum(obj.h)}" fill="${fill}"${fillOp}${stroke}${rx}${filter} />\n${inner}${close}`;
    }
    case 'ellipse': {
      const fill = paint('none');
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      const stroke = obj.stroke
        ? ` stroke="${escapeXml(obj.stroke)}" stroke-width="${obj.strokeWidth}"`
        : '';
      return `${open}${si}<ellipse cx="${fmtNum(obj.w / 2)}" cy="${fmtNum(obj.h / 2)}" rx="${fmtNum(obj.w / 2)}" ry="${fmtNum(obj.h / 2)}" fill="${fill}"${fillOp}${stroke}${filter} />\n${inner}${close}`;
    }
    case 'text': {
      const anchor =
        obj.textAlign === 'center' ? 'middle' : obj.textAlign === 'right' ? 'end' : 'start';
      const tx = obj.textAlign === 'center' ? obj.w / 2 : obj.textAlign === 'right' ? obj.w : 0;
      const lines = obj.text.split('\n');
      const tspans = lines
        .map(
          (line, i) =>
            `${si}  <tspan x="${fmtNum(tx)}" dy="${i === 0 ? 0 : fmtNum(obj.fontSize * obj.lineHeight)}">${escapeXml(line) || ' '}</tspan>`,
        )
        .join('\n');
      const fill = paint('#111111');
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      return `${open}${si}<text x="${fmtNum(tx)}" y="${fmtNum(obj.fontSize * 0.85)}" font-family="${escapeXml(obj.fontFamily)}" font-size="${obj.fontSize}" font-weight="${obj.fontWeight}" text-anchor="${anchor}" fill="${fill}"${fillOp}${filter}>\n${tspans}\n${si}</text>\n${inner}${close}`;
    }
    case 'line': {
      const stroke = obj.stroke ? escapeXml(obj.stroke) : '#111111';
      return `${open}${si}<line x1="0" y1="0" x2="${fmtNum(obj.w)}" y2="${fmtNum(obj.h)}" stroke="${stroke}" stroke-width="${obj.strokeWidth || 1}" stroke-linecap="round"${filter} />\n${inner}${close}`;
    }
    case 'image': {
      const dataUrl = assetDataUrl ? assetDataUrl(obj.imageId) : null;
      if (!dataUrl) {
        const label = escapeXml(obj.imageName || obj.name || 'image');
        return `${open}${si}<!-- image "${label}" not embedded: asset unavailable in this session -->\n${si}<rect x="0" y="0" width="${fmtNum(obj.w)}" height="${fmtNum(obj.h)}" fill="#E4E4E4" stroke="#B5B5B5" stroke-width="1" stroke-dasharray="4 3" />\n${inner}${close}`;
      }
      return `${open}${si}<image x="0" y="0" width="${fmtNum(obj.w)}" height="${fmtNum(obj.h)}" href="${escapeXml(dataUrl)}" preserveAspectRatio="none"${filter} />\n${inner}${close}`;
    }
  }
}

/** Render an export root, wrapping non-page-roots in their ancestor matrix. */
function renderExportRoot(
  objects: DesignObject[],
  obj: DesignObject,
  clipIds: Map<string, string>,
  gradIds: Map<string, string>,
  shadowIds: Map<string, string>,
  assetDataUrl: AssetResolver | null,
  includeIds: boolean,
): string {
  const m = ancestorMatrixOf(objects, obj);
  if (obj.parentId === null || isIdentity(m)) {
    return objectToSvg(objects, obj, '  ', clipIds, gradIds, shadowIds, assetDataUrl, includeIds);
  }
  return `  <g transform="${matrixToSvg(m)}">\n${objectToSvg(objects, obj, '    ', clipIds, gradIds, shadowIds, assetDataUrl, includeIds)}  </g>\n`;
}

/**
 * Serialize a page to a standalone SVG document. With onlyIds, exports the
 * selected visual content: top-most selected objects (no duplicates when a
 * parent and descendant are both selected) with descendants of selected
 * frames, positioned in page coordinates.
 */
export function pageToSvg(
  page: DocPage,
  onlyIds?: string[],
  assetDataUrl?: AssetResolver | null,
  opts?: { includeIds?: boolean },
): string {
  const includeIds = opts?.includeIds === true;
  const objects = page.objects;
  const roots = !onlyIds
    ? childrenOf(objects, null).filter((o) => o.visible)
    : topMostSelected(objects, new Set(onlyIds));
  const rendered = collectRendered(objects, roots);
  const bounds = unionBounds(objects, rendered) ?? { x: 0, y: 0, w: 800, h: 600 };
  const clipped = rendered.filter((o) => o.type === 'frame' && o.clip);
  const clipIds = new Map(clipped.map((o, i) => [o.id, `expclip${i}`]));
  const graded = rendered.filter((o) => effectiveGradient(o) !== null);
  const gradIds = new Map(graded.map((o, i) => [o.id, `expgrad${i}`]));
  const shadowed = rendered.filter((o) => o.shadow !== null && o.shadow !== undefined);
  const shadowIds = new Map(shadowed.map((o, i) => [o.id, `expshd${i}`]));
  const clipParts = clipped.map((o) => {
    const shape = hasIndependentCorners(o)
      ? `<path d="${roundedRectPath(o.w, o.h, resolveRadii(o), (n) => String(fmtNum(n)))}" />`
      : `<rect x="0" y="0" width="${fmtNum(o.w)}" height="${fmtNum(o.h)}"${o.cornerRadius > 0 ? ` rx="${fmtNum(o.cornerRadius)}"` : ''} />`;
    return `<clipPath id="${clipIds.get(o.id)}">${shape}</clipPath>`;
  });
  const gradParts = graded.map((o) => {
    const g = effectiveGradient(o);
    const v = gradientVector(g ? g.angle : 90);
    const stops = (g ? g.stops : [])
      .map((s) => `<stop offset="${fmtNum(s.offset)}" stop-color="${escapeXml(s.color)}" />`)
      .join('');
    return `<linearGradient id="${gradIds.get(o.id)}" x1="${fmtNum(v.x1)}" y1="${fmtNum(v.y1)}" x2="${fmtNum(v.x2)}" y2="${fmtNum(v.y2)}">${stops}</linearGradient>`;
  });
  const shadowParts = shadowed.map((o) => {
    const s = o.shadow as NonNullable<DesignObject['shadow']>;
    return `<filter id="${shadowIds.get(o.id)}" x="-50%" y="-50%" width="200%" height="200%">${shadowFilterInner(s)}</filter>`;
  });
  const defParts = [...clipParts, ...gradParts, ...shadowParts];
  const defs =
    defParts.length > 0 ? `  <defs>\n${defParts.map((p) => `    ${p}`).join('\n')}\n  </defs>\n` : '';
  const body = roots.map((o) => renderExportRoot(objects, o, clipIds, gradIds, shadowIds, assetDataUrl ?? null, includeIds)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.w)}" height="${Math.ceil(bounds.h)}" viewBox="${fmtNum(bounds.x)} ${fmtNum(bounds.y)} ${fmtNum(bounds.w)} ${fmtNum(bounds.h)}">\n${defs}${body}</svg>\n`;
}

/* ================= move snapping ================= */

/** World-unit pitch of the canvas dot grid (mirrors the `undot` pattern). */
export const GRID_PITCH = 24;
/** Grab distance for snapping, in screen pixels (divide by zoom for world units). */
export const SNAP_THRESHOLD_PX = 6;
/** Guide overshoot past the aligned objects, in world units. */
const GUIDE_MARGIN = 8;

export interface SnapBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface AxisHit {
  offset: number;
  pos: number;
  candidate: SnapBounds;
}

function axisPoints(b: SnapBounds, horizontal: boolean): [number, number, number] {
  // Center first: when same-size boxes align, the center guide wins ties.
  return horizontal
    ? [b.x + b.w / 2, b.x, b.x + b.w]
    : [b.y + b.h / 2, b.y, b.y + b.h];
}

/**
 * Best object alignment on one axis. Compares the moving left/center/right
 * (top/center/bottom) against every candidate's; ranks by distance, then
 * same-kind pairs (edge-to-edge over edge-to-center), then point order.
 */
function snapAxisObject(
  moving: SnapBounds,
  candidates: SnapBounds[],
  horizontal: boolean,
  threshold: number,
): AxisHit | null {
  const mp = axisPoints(moving, horizontal);
  let best: AxisHit | null = null;
  let bestRank: [number, number, number, number] | null = null;
  for (const c of candidates) {
    const cp = axisPoints(c, horizontal);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const offset = cp[j] - mp[i];
        if (Math.abs(offset) > threshold) continue;
        const rank: [number, number, number, number] = [
          Math.abs(offset),
          i === j ? 0 : 1,
          i,
          j,
        ];
        if (
          bestRank === null ||
          rank[0] < bestRank[0] ||
          (rank[0] === bestRank[0] &&
            (rank[1] < bestRank[1] ||
              (rank[1] === bestRank[1] &&
                (rank[2] < bestRank[2] || (rank[2] === bestRank[2] && rank[3] < bestRank[3])))))
        ) {
          bestRank = rank;
          best = { offset, pos: cp[j], candidate: c };
        }
      }
    }
  }
  return best;
}

function snapAxisGrid(moving: SnapBounds, horizontal: boolean, pitch: number, threshold: number): number | null {
  let best: number | null = null;
  for (const m of axisPoints(moving, horizontal)) {
    const offset = Math.round(m / pitch) * pitch - m;
    if (Math.abs(offset) > threshold) continue;
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}

export function snapMoveDelta(
  moving: SnapBounds,
  candidates: SnapBounds[],
  opts: { grid: number | null; threshold: number },
): { dx: number; dy: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let dx = 0;
  let dy = 0;
  const hitX = snapAxisObject(moving, candidates, true, opts.threshold);
  if (hitX) {
    dx = hitX.offset;
    const c = hitX.candidate;
    guides.push({
      x1: hitX.pos,
      x2: hitX.pos,
      y1: Math.min(moving.y, c.y) - GUIDE_MARGIN,
      y2: Math.max(moving.y + moving.h, c.y + c.h) + GUIDE_MARGIN,
    });
  } else if (opts.grid !== null) {
    dx = snapAxisGrid(moving, true, opts.grid, opts.threshold) ?? 0;
  }
  const hitY = snapAxisObject(moving, candidates, false, opts.threshold);
  if (hitY) {
    dy = hitY.offset;
    const c = hitY.candidate;
    guides.push({
      y1: hitY.pos,
      y2: hitY.pos,
      x1: Math.min(moving.x, c.x) - GUIDE_MARGIN,
      x2: Math.max(moving.x + moving.w, c.x + c.w) + GUIDE_MARGIN,
    });
  } else if (opts.grid !== null) {
    dy = snapAxisGrid(moving, false, opts.grid, opts.threshold) ?? 0;
  }
  return { dx, dy, guides };
}

/* ================= group / ungroup ================= */

/**
 * Local transform that places `obj` under a new parent without any visual
 * change. Rotation angles compose additively, so the new rotation is the old
 * one minus the ancestor-rotation delta; the new origin maps the page corner
 * back through the new parent and then subtracts the center-rotation offset
 * (rotation is center-based, so the local origin is not the x/y position).
 * Rounding matches the drag/drop legacy; group operations pass
 * `{ round: false }` for exact (fractional-safe) placement.
 */
export function reparentLocal(
  objects: DesignObject[],
  obj: DesignObject,
  targetParentId: string | null,
  opts?: { round?: boolean },
): { parentId: string | null; x: number; y: number; rotation: number } {
  const round = opts?.round ?? true;
  const target =
    targetParentId === null ? null : objects.find((o) => o.id === targetParentId) ?? null;
  if (targetParentId !== null && !target) {
    return { parentId: obj.parentId, x: obj.x, y: obj.y, rotation: obj.rotation };
  }
  const oldM = pageMatrixOf(objects, obj);
  const newParentM = target ? pageMatrixOf(objects, target) : IDENTITY;
  const rotDelta =
    worldRotation(newParentM) - worldRotation(ancestorMatrixOf(objects, obj));
  const rotation =
    Math.abs(rotDelta) < 1e-9 ? obj.rotation : normalizeDegrees(obj.rotation - rotDelta);
  const inv = invertMatrix(newParentM);
  const pagePos = applyMatrix(oldM, 0, 0);
  const landing = inv ? applyMatrix(inv, pagePos.x, pagePos.y) : { x: obj.x, y: obj.y };
  const centerOffset =
    rotation === 0 ? { x: 0, y: 0 } : applyMatrix(rotateMatrix(rotation, obj.w / 2, obj.h / 2), 0, 0);
  const lx = landing.x - centerOffset.x;
  const ly = landing.y - centerOffset.y;
  return {
    parentId: targetParentId,
    x: round ? Math.round(lx) : lx,
    y: round ? Math.round(ly) : ly,
    rotation,
  };
}

/**
 * Wrap `ids` in a new transparent frame. Groups the top-most selection (a
 * selected child follows its parent), parents the frame to the common parent
 * (or the page for mixed parents), and preserves every page transform
 * exactly. The frame is stacked where the first grouped object was.
 * Returns null when nothing groupable is selected.
 */
export function groupObjects(
  objects: DesignObject[],
  ids: string[],
  groupId: string,
): DesignObject[] | null {
  const wanted = new Set(ids);
  const sel = objects.filter((o) => wanted.has(o.id));
  if (sel.length === 0) return null;
  const tops = rootsOf(sel);
  if (tops.length === 0) return null;
  const parents = new Set(tops.map((t) => t.parentId));
  const commonParent = parents.size === 1 ? tops[0].parentId : null;
  const inGroup = new Set(tops.map((t) => t.id));
  for (const t of tops) {
    for (const d of descendantIds(objects, t.id)) inGroup.add(d);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of objects) {
    if (!inGroup.has(o.id)) continue;
    const b = transformedBounds(objects, o);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (x0 === Infinity) return null;
  const parentObj =
    commonParent === null ? null : objects.find((o) => o.id === commonParent) ?? null;
  const parentM = parentObj ? pageMatrixOf(objects, parentObj) : IDENTITY;
  const inv = invertMatrix(parentM);
  const origin = inv ? applyMatrix(inv, x0, y0) : { x: x0, y: y0 };
  const shell: DesignObject = {
    id: groupId,
    type: 'frame',
    name: 'Group',
    parentId: commonParent,
    x: origin.x,
    y: origin.y,
    w: x1 - x0,
    h: y1 - y0,
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
  const withGroup = [...objects, shell];
  const topIds = new Set(tops.map((t) => t.id));
  const moved = withGroup.map((o) => {
    if (!topIds.has(o.id)) return o;
    const l = reparentLocal(withGroup, o, groupId, { round: false });
    return { ...o, parentId: l.parentId, x: l.x, y: l.y, rotation: l.rotation };
  });
  const firstIdx = Math.min(
    ...tops.map((t) => objects.findIndex((o) => o.id === t.id)),
  );
  const shellObj = moved.find((o) => o.id === groupId);
  if (!shellObj) return null;
  const result = moved.filter((o) => o.id !== groupId);
  result.splice(firstIdx, 0, shellObj);
  return result;
}

/**
 * Dissolve the selected frames, reparenting each direct child to the
 * grandparent with its page transform preserved. Nested selections dissolve
 * outer-first; empty groups are simply removed. Returns the surviving
 * children ids for selection, or null when no frame is selected.
 */
export function ungroupObjects(
  objects: DesignObject[],
  ids: string[],
): { objects: DesignObject[]; selectedIds: string[] } | null {
  const wanted = new Set(ids);
  const byDepth = objects
    .filter((o) => wanted.has(o.id) && o.type === 'frame')
    .map((o) => ({ o, depth: ancestorChain(objects, o).length }))
    .sort((p, q) => p.depth - q.depth);
  if (byDepth.length === 0) return null;
  let current = objects;
  const selectedIds: string[] = [];
  let dissolved = 0;
  for (const { o: stale } of byDepth) {
    const frame = current.find((o) => o.id === stale.id);
    if (!frame) continue;
    const kids = current.filter((o) => o.parentId === frame.id);
    const grandparent = frame.parentId;
    current = current.map((o) => {
      if (o.parentId !== frame.id) return o;
      const l = reparentLocal(current, o, grandparent, { round: false });
      return { ...o, parentId: l.parentId, x: l.x, y: l.y, rotation: l.rotation };
    });
    current = current.filter((o) => o.id !== frame.id);
    dissolved += 1;
    for (const k of kids) selectedIds.push(k.id);
  }
  if (dissolved === 0) return null;
  return { objects: current, selectedIds };
}

/* ================= gradient + corner styling ================= */

/** Object-space gradient vector for an angle in degrees (0 runs left-to-right). */
export function gradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

/** The gradient to render, or null when the solid fill applies. */
export function effectiveGradient(obj: DesignObject): FillGradient | null {
  const g = obj.fillGradient;
  if (!g || !Array.isArray(g.stops) || g.stops.length < 2) return null;
  return g;
}

/** Corner radii in TL/TR/BR/BL order, honoring the independent override. */
export function resolveRadii(obj: DesignObject): CornerRadii {
  return (
    obj.cornerRadii ?? [obj.cornerRadius, obj.cornerRadius, obj.cornerRadius, obj.cornerRadius]
  );
}

/** Whether per-corner radii are active (independent mode, even if uniform). */
export function hasIndependentCorners(obj: DesignObject): boolean {
  return obj.cornerRadii !== null && obj.cornerRadii !== undefined;
}

/**
 * Rounded-rectangle path with independent corners, each clamped to half the
 * shortest side. All-zero radii still produce a valid (rectangular) path.
 */
export function roundedRectPath(
  w: number,
  h: number,
  radii: CornerRadii,
  fmt: (n: number) => string = (n) => String(n),
): string {
  const m = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.min(Math.max(0, r), m));
  return (
    `M ${fmt(tl)} 0` +
    ` H ${fmt(w - tr)} Q ${fmt(w)} 0 ${fmt(w)} ${fmt(tr)}` +
    ` V ${fmt(h - br)} Q ${fmt(w)} ${fmt(h)} ${fmt(w - br)} ${fmt(h)}` +
    ` H ${fmt(bl)} Q 0 ${fmt(h)} 0 ${fmt(h - bl)}` +
    ` V ${fmt(tl)} Q 0 0 ${fmt(tl)} 0` +
    ' Z'
  );
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
