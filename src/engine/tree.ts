/**
 * Layer-tree helpers: flattening (top-most first), parent maps, and the
 * display↔engine index math for drag reorder/reparent. Pure and tested in
 * tests/tree.test.ts.
 */
import type { EngineNode } from './adapter';

export interface FlatRow {
  node: EngineNode;
  depth: number;
  /** Engine children-array index within the parent. */
  index: number;
  parentId: number;
}

/** Flatten visible rows top-most first (engine children are bottom-first). */
export function flattenTree(root: EngineNode, expanded: Set<number>): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (n: EngineNode, depth: number): void => {
    const kids = n.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i];
      rows.push({ node: c, depth, index: i, parentId: n.id });
      if (expanded.has(c.id)) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Map every node id to its parent id (root maps to itself). */
export function parentMap(root: EngineNode): Map<number, number> {
  const map = new Map<number, number>();
  map.set(root.id, root.id);
  const walk = (n: EngineNode): void => {
    for (const c of n.children) {
      map.set(c.id, n.id);
      walk(c);
    }
  };
  walk(root);
  return map;
}

/** All ids in a subtree including the root. */
export function subtreeIds(root: EngineNode, id: number): Set<number> {
  const out = new Set<number>();
  const find = (n: EngineNode): EngineNode | null => {
    if (n.id === id) return n;
    for (const c of n.children) {
      const r = find(c);
      if (r) return r;
    }
    return null;
  };
  const sub = find(root);
  if (!sub) return out;
  const walk = (n: EngineNode): void => {
    out.add(n.id);
    for (const c of n.children) walk(c);
  };
  walk(sub);
  return out;
}

/**
 * Engine children-array insertion index for a drop between displayed rows.
 * `siblingCount` is the parent's child count; `displayRow` is the 0-based
 * top-first row the pointer is over; `pos` is above/below that row.
 */
export function dropIndex(siblingCount: number, displayRow: number, pos: 'before' | 'after'): number {
  const clamped = Math.max(0, Math.min(siblingCount - 1, displayRow));
  // Display row i shows children[k-1-i]; "before" inserts above it.
  return pos === 'before' ? siblingCount - clamped : siblingCount - 1 - clamped;
}

/**
 * Adjust a same-parent reorder index for the removal of the dragged node:
 * dropping below its own slot shifts by one once it is lifted out.
 */
export function adjustedReorderIndex(fromIndex: number, toIndex: number): number {
  return toIndex > fromIndex ? toIndex - 1 : toIndex;
}
