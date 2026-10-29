/**
 * Page-space geometry for engine nodes. The engine reports each node's local
 * box (x, y, width, height) plus a counter-clockwise-positive rotation; this
 * module composes those through ancestor chains into page-space corners so
 * the canvas can draw selection outlines and handles exactly where the
 * engine renders. Verified against real engine `absoluteBounds` in
 * tests/geometry.test.ts.
 */
import {
  IDENTITY,
  applyMatrix,
  invertMatrix,
  multiplyMatrices,
  rotateMatrix,
  translateMatrix,
  type Matrix,
} from '../transform';
import type { EngineNode } from './adapter';

export interface Pt {
  x: number;
  y: number;
}

/**
 * Local→parent matrix for one node. The engine stores rotation
 * counter-clockwise-positive, so it is negated into the screen-clockwise
 * matrices used everywhere else here.
 */
export function localToParentMatrix(n: { x: number; y: number; rotation: number }): Matrix {
  return multiplyMatrices(translateMatrix(n.x, n.y), rotateMatrix(-n.rotation));
}

/** Root-first chain from the tree root down to and including `id`, or null. */
export function findChain(root: EngineNode, id: number): EngineNode[] | null {
  if (root.id === id) return [root];
  for (const c of root.children) {
    const sub = findChain(c, id);
    if (sub) return [root, ...sub];
  }
  return null;
}

/** Composed local→page matrix for a root-first chain (page root included). */
export function chainToPageMatrix(chain: EngineNode[]): Matrix {
  let m = IDENTITY;
  for (const n of chain) m = multiplyMatrices(m, localToParentMatrix(n));
  return m;
}

/** The four page-space corners of a node's local box, clockwise from top-left. */
export function pageCorners(node: EngineNode, ancestorsRootFirst: EngineNode[]): [Pt, Pt, Pt, Pt] {
  const m = chainToPageMatrix([...ancestorsRootFirst, node]);
  const { width: w, height: h } = node;
  return [
    applyMatrix(m, 0, 0),
    applyMatrix(m, w, 0),
    applyMatrix(m, w, h),
    applyMatrix(m, 0, h),
  ];
}

/**
 * Page-space rotation pivot: the node's local-box center, which is what the
 * engine's rotation setter preserves (`set_rotation_about_center`,
 * upstream props.rs). A rotation-only commit never translates this point,
 * so the drag and preview must pivot here too — the page-space AABB center
 * only coincides with it while the node is unrotated, and pivoting there
 * makes already-rotated objects swing on pointer-up.
 */
export function rotationPivot(node: EngineNode, ancestorsRootFirst: EngineNode[]): Pt {
  const m = chainToPageMatrix([...ancestorsRootFirst, node]);
  return applyMatrix(m, node.width / 2, node.height / 2);
}

/** Clockwise-from-north angle of p about center, in degrees. */
export function pointerAngleDeg(center: Pt, p: Pt): number {
  return (Math.atan2(p.x - center.x, -(p.y - center.y)) * 180) / Math.PI;
}

/**
 * Displayed rotation for a drag pointer position. The grab offset (pointer
 * angle minus displayed rotation at grab time) keeps the first move
 * continuous no matter where the handle sits relative to the pivot.
 */
export function rotationFromPointer(center: Pt, p: Pt, grabOffset: number): number {
  return pointerAngleDeg(center, p) - grabOffset;
}

/** Axis-aligned page-space box of a (possibly rotated, nested) node. */
export function pageBounds(node: EngineNode, ancestorsRootFirst: EngineNode[]): { x: number; y: number; w: number; h: number } {
  const corners = pageCorners(node, ancestorsRootFirst);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** Page point → node's local box point; null when the chain is singular. */
export function pageToLocal(
  node: EngineNode,
  ancestorsRootFirst: EngineNode[],
  p: Pt,
): Pt | null {
  const inv = invertMatrix(chainToPageMatrix([...ancestorsRootFirst, node]));
  if (!inv) return null;
  return applyMatrix(inv, p.x, p.y);
}

/** Page point → a parent's local point (for creating nested objects). */
export function pageToParentLocal(
  parentChainRootFirst: EngineNode[],
  p: Pt,
): Pt | null {
  const inv = invertMatrix(chainToPageMatrix(parentChainRootFirst));
  if (!inv) return null;
  return applyMatrix(inv, p.x, p.y);
}

/** Union of several page-space boxes. */
export function unionBounds(boxes: Array<{ x: number; y: number; w: number; h: number }>): { x: number; y: number; w: number; h: number } | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
