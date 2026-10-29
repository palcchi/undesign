import type { DesignObject, DocPage, UndesignDoc, Viewport } from './types';

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

/** All descendant ids of an object (frames can nest). */
export function descendantIds(objects: DesignObject[], id: string): string[] {
  const direct = objects.filter((o) => o.parentId === id);
  const out: string[] = [];
  for (const child of direct) {
    out.push(child.id, ...descendantIds(objects, child.id));
  }
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
  return objects
    .filter((o) => {
      if (!o.visible || o.locked) return false;
      const b = absoluteBounds(objects, o);
      return b.x < maxX && b.x + b.w > minX && b.y < maxY && b.y + b.h > minY;
    })
    .map((o) => o.id);
}

/** Axis-aligned bounds of visible objects in page space (rotation ignored). */
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
    const b = absoluteBounds(objects, o);
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function objectToSvg(
  objects: DesignObject[],
  obj: DesignObject,
  indent: string,
): string {
  const kids = childrenOf(objects, obj.id);
  const inner = kids.map((k) => objectToSvg(objects, k, indent + '  ')).join('');
  const rot =
    obj.rotation !== 0
      ? ` rotate(${obj.rotation} ${(obj.x + obj.w / 2).toFixed(1)} ${(obj.y + obj.h / 2).toFixed(1)})`
      : '';
  const opacity = obj.opacity < 1 ? ` opacity="${obj.opacity}"` : '';
  const common = `${opacity}${rot ? ` transform="${rot.trim()}"` : ''}`;
  const cx = obj.x;
  const cy = obj.y;

  switch (obj.type) {
    case 'frame':
    case 'rectangle': {
      const fill = obj.fill ? obj.fill : 'none';
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      const stroke = obj.stroke ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth}"` : '';
      const rx = obj.cornerRadius > 0 ? ` rx="${obj.cornerRadius}"` : '';
      const clipAttr =
        obj.type === 'frame' && obj.clip
          ? ` clip-path="inset(0 round ${obj.cornerRadius}px)"`
          : '';
      return `${indent}<g${common}${clipAttr}>\n${indent}  <rect x="${cx}" y="${cy}" width="${obj.w}" height="${obj.h}" fill="${fill}"${fillOp}${stroke}${rx} />\n${inner}${indent}</g>\n`;
    }
    case 'ellipse': {
      const fill = obj.fill ? obj.fill : 'none';
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      const stroke = obj.stroke ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth}"` : '';
      return `${indent}<ellipse cx="${cx + obj.w / 2}" cy="${cy + obj.h / 2}" rx="${obj.w / 2}" ry="${obj.h / 2}" fill="${fill}"${fillOp}${stroke}${common} />\n`;
    }
    case 'text': {
      const anchor = obj.textAlign === 'center' ? 'middle' : obj.textAlign === 'right' ? 'end' : 'start';
      const tx = obj.textAlign === 'center' ? cx + obj.w / 2 : obj.textAlign === 'right' ? cx + obj.w : cx;
      const lines = obj.text.split('\n');
      const tspans = lines
        .map(
          (line, i) =>
            `${indent}  <tspan x="${tx}" dy="${i === 0 ? 0 : obj.fontSize * obj.lineHeight}">${escapeXml(line) || ' '}</tspan>`,
        )
        .join('\n');
      const fill = obj.fill ? obj.fill : '#111111';
      return `${indent}<text x="${tx}" y="${cy + obj.fontSize * 0.85}" font-family="${escapeXml(obj.fontFamily)}" font-size="${obj.fontSize}" font-weight="${obj.fontWeight}" text-anchor="${anchor}" fill="${fill}"${common}>\n${tspans}\n${indent}</text>\n`;
    }
    case 'line': {
      const stroke = obj.stroke ? obj.stroke : '#111111';
      return `${indent}<line x1="${cx}" y1="${cy}" x2="${cx + obj.w}" y2="${cy + obj.h}" stroke="${stroke}" stroke-width="${obj.strokeWidth || 1}" stroke-linecap="round"${common} />\n`;
    }
  }
}

/** Serialize a page (or a subset of root objects) to a standalone SVG document. */
export function pageToSvg(page: DocPage, onlyIds?: string[]): string {
  const roots = childrenOf(page.objects, null).filter(
    (o) => o.visible && (!onlyIds || onlyIds.includes(o.id)),
  );
  const bounds = pageBounds(
    onlyIds ? page.objects.filter((o) => onlyIds.includes(o.id)) : page.objects.filter((o) => o.visible),
  ) ?? { x: 0, y: 0, w: 800, h: 600 };
  const body = roots.map((o) => objectToSvg(page.objects, o, '  ')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.w)}" height="${Math.ceil(bounds.h)}" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">\n${body}</svg>\n`;
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
