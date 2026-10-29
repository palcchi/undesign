/**
 * Draw-commit math for the creation tools. Pure function of the drag
 * endpoints so the FigCraft-shape tools (polygon/star/arrow) commit exactly
 * what the drag ghost shows. Positions ride in the caller's coordinate
 * space: the caller passes parent-adjusted `local` for box tools, while
 * lines/arrows stay in page space (their center-based angle math is
 * page-space, page root only).
 */
import type { Tool } from '../types';
import type { Pt } from './geometry';

export type DrawableShape = 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow';

export type DrawCommit =
  | { kind: 'text' }
  | { kind: 'frame'; x: number; y: number; w: number; h: number }
  | { kind: 'shape'; shape: DrawableShape; x: number; y: number; w: number; h: number }
  | null;

/** Click (no drag) fallback sizes per tool. */
export function defaultDrawSize(tool: Tool): { w: number; h: number } {
  switch (tool) {
    case 'frame':
      return { w: 300, h: 200 };
    case 'ellipse':
    case 'polygon':
    case 'star':
      return { w: 80, h: 80 };
    default:
      return { w: 100, h: 60 };
  }
}

const CLICK_PX = 4;

/**
 * Commit parameters for a creation drag from `a` to `b` (page space) with
 * the parent-adjusted top-left `local`. Returns null when the gesture is
 * too small to commit or the tool does not draw.
 */
export function drawParamsForTool(tool: Tool, a: Pt, b: Pt, local: Pt, zoom: number): DrawCommit {
  if (tool === 'select' || tool === 'hand') return null;
  if (tool === 'text') return { kind: 'text' };
  if (tool === 'line' || tool === 'arrow') {
    const x0 = Math.min(a.x, b.x);
    const y0 = a.x <= b.x ? a.y : b.y;
    const x1 = Math.max(a.x, b.x);
    const y1 = a.x <= b.x ? b.y : a.y;
    if (Math.hypot(x1 - x0, y1 - y0) * zoom < CLICK_PX) return null;
    return { kind: 'shape', shape: tool, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const tiny = w * zoom < CLICK_PX || h * zoom < CLICK_PX;
  const size = tiny ? defaultDrawSize(tool) : { w, h };
  if (tool === 'frame') return { kind: 'frame', x: local.x, y: local.y, w: size.w, h: size.h };
  return { kind: 'shape', shape: tool, x: local.x, y: local.y, w: size.w, h: size.h };
}
