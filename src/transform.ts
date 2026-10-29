import type { DesignObject } from './types';

/**
 * Affine 2D matrix in SVG order: x' = a*x + c*y + e; y' = b*x + d*y + f.
 * Single source of truth for coordinate transforms shared by rendering,
 * hit-testing, selection overlays, and export.
 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translateMatrix(x: number, y: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function rotateMatrix(deg: number, cx = 0, cy = 0): Matrix {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: cx - cx * cos + cy * sin,
    f: cy - cx * sin - cy * cos,
  };
}

/** Compose m1 after m2 (apply m2 first). Matches SVG transform nesting. */
export function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function invertMatrix(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function isIdentity(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/** Round for stable serialization (kills float noise and -0). */
export function fmtNum(n: number): number {
  const r = Math.round(n * 10000) / 10000;
  return r === 0 ? 0 : r;
}

export function matrixToSvg(m: Matrix): string {
  return `matrix(${fmtNum(m.a)} ${fmtNum(m.b)} ${fmtNum(m.c)} ${fmtNum(m.d)} ${fmtNum(m.e)} ${fmtNum(m.f)})`;
}

/** Local matrix of an object: translate(x,y), then rotate about its center. */
export function objectLocalMatrix(obj: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}): Matrix {
  const t = translateMatrix(obj.x, obj.y);
  if (obj.rotation === 0) return t;
  return multiplyMatrices(t, rotateMatrix(obj.rotation, obj.w / 2, obj.h / 2));
}

/** Ancestor chain root-first, excluding obj itself. Cycle-safe. */
export function ancestorChain(objects: DesignObject[], obj: DesignObject): DesignObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const chain: DesignObject[] = [];
  const seen = new Set<string>([obj.id]);
  let current = obj.parentId ? byId.get(obj.parentId) : undefined;
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** Composed matrix of the ancestor chain only (identity for page roots). */
export function ancestorMatrixOf(objects: DesignObject[], obj: DesignObject): Matrix {
  let m: Matrix = IDENTITY;
  for (const a of ancestorChain(objects, obj)) {
    m = multiplyMatrices(m, objectLocalMatrix(a));
  }
  return m;
}

/** Full page-space matrix of an object (ancestors composed with local). */
export function pageMatrixOf(objects: DesignObject[], obj: DesignObject): Matrix {
  return multiplyMatrices(ancestorMatrixOf(objects, obj), objectLocalMatrix(obj));
}

/** Page-space axis-aligned bounds of an object's local rect. Rotation-aware. */
export function transformedBounds(
  objects: DesignObject[],
  obj: DesignObject,
): { x: number; y: number; w: number; h: number } {
  const corners = objectCorners(objects, obj);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Page-space corners of an object's local rect, in local order. */
export function objectCorners(
  objects: DesignObject[],
  obj: DesignObject,
): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  const m = pageMatrixOf(objects, obj);
  return [
    [0, 0],
    [obj.w, 0],
    [0, obj.h],
    [obj.w, obj.h],
  ].map(([x, y]) => applyMatrix(m, x, y)) as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
}

/** Map a page-space point into an object's local frame (null when singular). */
export function objectLocalPoint(
  objects: DesignObject[],
  obj: DesignObject,
  pageX: number,
  pageY: number,
): { x: number; y: number } | null {
  const inv = invertMatrix(pageMatrixOf(objects, obj));
  return inv ? applyMatrix(inv, pageX, pageY) : null;
}

/** Map a page-space point into a parent frame (null parent = identity). */
export function parentLocalPoint(
  objects: DesignObject[],
  parent: DesignObject | null,
  pageX: number,
  pageY: number,
): { x: number; y: number } | null {
  if (!parent) return { x: pageX, y: pageY };
  const inv = invertMatrix(pageMatrixOf(objects, parent));
  return inv ? applyMatrix(inv, pageX, pageY) : null;
}

/**
 * New local x/y after moving an object by a page-space delta.
 * Exact under rotated ancestors (falls back to plain addition if singular).
 */
export function translateLocalByPageDelta(
  objects: DesignObject[],
  obj: DesignObject,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const parentM = ancestorMatrixOf(objects, obj);
  const inv = invertMatrix(parentM);
  if (!inv) return { x: obj.x + dx, y: obj.y + dy };
  const cur = applyMatrix(parentM, obj.x, obj.y);
  return applyMatrix(inv, cur.x + dx, cur.y + dy);
}

/** Separating-axis overlap test for convex quads; touching edges count as miss. */
export function quadsOverlap(
  a: Array<{ x: number; y: number }>,
  b: Array<{ x: number; y: number }>,
): boolean {
  const project = (poly: Array<{ x: number; y: number }>, nx: number, ny: number) => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
      const v = p.x * nx + p.y * ny;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max] as const;
  };
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const nx = -(p2.y - p1.y);
      const ny = p2.x - p1.x;
      if (nx === 0 && ny === 0) continue;
      const [mina, maxa] = project(a, nx, ny);
      const [minb, maxb] = project(b, nx, ny);
      if (maxa <= minb || maxb <= mina) return false;
    }
  }
  return true;
}

/** Exact hit test of a page-space point against an object (rotation-aware). */
export function pointInObject(
  objects: DesignObject[],
  obj: DesignObject,
  pageX: number,
  pageY: number,
): boolean {
  const p = objectLocalPoint(objects, obj, pageX, pageY);
  if (!p) return false;
  return p.x >= 0 && p.x <= obj.w && p.y >= 0 && p.y <= obj.h;
}

/** Total rotation of a composed matrix in degrees. */
export function worldRotation(m: Matrix): number {
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

/** Wrap degrees to [-180, 180). */
export function normalizeDegrees(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}
