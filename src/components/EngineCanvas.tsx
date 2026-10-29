/**
 * Engine-driven main canvas. The document render comes from the engine
 * (`export_page_svg`); selection outlines, handles, marquee, and draw
 * ghosts are React overlays aligned through the SVG viewBox. Every commit —
 * create, move, resize, rotate, select — goes to the engine first; the
 * snapshot re-read updates the render. Transient drag state never touches
 * the document until pointer-up.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { pageToScreen, screenToPage, useEngine } from '../engine/store';
import {
  chainToPageMatrix,
  findChain,
  localToParentMatrix,
  pageBounds,
  pageCorners,
  pageToLocal,
  pageToParentLocal,
  unionBounds,
  type Pt,
} from '../engine/geometry';
import { applyMatrix, multiplyMatrices, rotateMatrix } from '../transform';
import type { EngineNode } from '../engine/adapter';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_ANCHOR: Record<Handle, string> = {
  nw: 'br', n: 'b', ne: 'bl', e: 'l', se: 'tl', s: 't', sw: 'tr', w: 'r',
};

type Drag =
  | { mode: 'pan'; lastX: number; lastY: number }
  | { mode: 'marquee'; start: Pt; cur: Pt; additive: boolean; active: boolean }
  | { mode: 'move'; start: Pt; cur: Pt; active: boolean }
  | { mode: 'draw'; start: Pt; cur: Pt }
  | { mode: 'resize'; handle: Handle; nodeId: number; startW: number; startH: number; start: Pt; cur: Pt }
  | { mode: 'rotate'; nodeId: number; center: Pt; angle: number }
  | null;

const CLICK_PX = 3;

export function EngineCanvas() {
  const ed = useEngine();
  const { snapshot, viewport, tool } = ed;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      ed.setCanvasSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    ed.setCanvasSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceDown(false);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  const toScreen = (p: Pt): Pt => pageToScreen(snapshot.viewBox, viewport, p.x, p.y);

  const chains = useMemo(() => {
    const map = new Map<number, EngineNode[]>();
    if (!snapshot.tree) return map;
    for (const id of snapshot.selection) {
      const chain = findChain(snapshot.tree, id);
      if (chain) map.set(id, chain);
    }
    return map;
  }, [snapshot.tree, snapshot.selection]);

  const ancestorsOf = (id: number): EngineNode[] => {
    const c = chains.get(id) ?? [];
    return c.slice(0, -1);
  };

  const single = ed.selectedNodes.length === 1 ? ed.selectedNodes[0] : null;

  const handleLayout = useMemo(() => {
    if (!single || single.type === 'LINE' || !snapshot.tree) return null;
    const corners = pageCorners(single, ancestorsOf(single.id)).map(toScreen);
    const [tl, tr, br, bl] = corners;
    const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const top = mid(tl, tr);
    const edge = { x: tr.x - tl.x, y: tr.y - tl.y };
    const len = Math.hypot(edge.x, edge.y) || 1;
    const normal = { x: -edge.y / len, y: edge.x / len };
    const rotateAt = { x: top.x + normal.x * 22, y: top.y + normal.y * 22 };
    return {
      handles: { nw: tl, n: top, ne: tr, e: mid(tr, br), se: br, s: mid(br, bl), sw: bl, w: mid(bl, tl) } as Record<Handle, Pt>,
      rotateAt,
      rotateBase: top,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, snapshot.tree, snapshot.viewBox, viewport]);

  const hitHandle = (sx: number, sy: number): Handle | 'rotate' | null => {
    if (!handleLayout) return null;
    const near = (p: Pt): boolean => Math.hypot(p.x - sx, p.y - sy) <= 9;
    if (near(handleLayout.rotateAt)) return 'rotate';
    for (const [k, p] of Object.entries(handleLayout.handles) as Array<[Handle, Pt]>) {
      if (near(p)) return k;
    }
    return null;
  };

  /** Engine-resolved click target (null on empty canvas). */
  const safeTop = (page: Pt): number | null => {
    try {
      return ed.adapter?.hitTop(page.x, page.y) ?? null;
    } catch {
      return null;
    }
  };

  const localPos = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (ed.status !== 'ready') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      setDrag({ mode: 'pan', lastX: e.clientX, lastY: e.clientY });
      return;
    }
    if (e.button !== 0) return;
    const s = localPos(e);
    const page = screenToPage(snapshot.viewBox, viewport, s.x, s.y);
    if (tool !== 'select') {
      setDrag({ mode: 'draw', start: page, cur: page });
      return;
    }
    const h = hitHandle(s.x, s.y);
    if ((h === 'rotate' || (h !== null && single)) && single) {
      if (h === 'rotate') {
        const box = pageBounds(single, ancestorsOf(single.id));
        const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
        setDrag({ mode: 'rotate', nodeId: single.id, center, angle: -single.rotation });
      } else {
        setDrag({ mode: 'resize', handle: h, nodeId: single.id, startW: single.width, startH: single.height, start: page, cur: page });
      }
      return;
    }
    const top = safeTop(page);
    if (top !== null) {
      if (!e.shiftKey && !snapshot.selection.includes(top)) ed.select([top]);
      setDrag({ mode: 'move', start: page, cur: page, active: false });
      return;
    }
    setDrag({ mode: 'marquee', start: page, cur: page, additive: e.shiftKey, active: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = localPos(e);
    if (!drag) {
      if (tool === 'select' && ed.status === 'ready' && e.buttons === 0) {
        const page = screenToPage(snapshot.viewBox, viewport, s.x, s.y);
        setHoverId(safeTop(page));
      }
      return;
    }
    if (drag.mode === 'pan') {
      ed.setViewport({ zoom: viewport.zoom, x: viewport.x + e.clientX - drag.lastX, y: viewport.y + e.clientY - drag.lastY });
      setDrag({ mode: 'pan', lastX: e.clientX, lastY: e.clientY });
      return;
    }
    const page = screenToPage(snapshot.viewBox, viewport, s.x, s.y);
    if (drag.mode === 'marquee') {
      const active = drag.active || Math.hypot(page.x - drag.start.x, page.y - drag.start.y) * viewport.zoom >= CLICK_PX;
      setDrag({ ...drag, cur: page, active });
      return;
    }
    if (drag.mode === 'move') {
      const active = drag.active || Math.hypot(page.x - drag.start.x, page.y - drag.start.y) * viewport.zoom >= CLICK_PX;
      setDrag({ ...drag, cur: page, active });
      return;
    }
    if (drag.mode === 'draw' || drag.mode === 'resize') {
      setDrag({ ...drag, cur: page });
      return;
    }
    if (drag.mode === 'rotate') {
      const dx = page.x - drag.center.x;
      const dy = page.y - drag.center.y;
      let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      setDrag({ ...drag, angle: deg });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || d.mode === 'pan') return;
    const s = localPos(e);
    const page = screenToPage(snapshot.viewBox, viewport, s.x, s.y);
    if (d.mode === 'marquee') {
      if (!d.active) {
        if (!d.additive) ed.clearSelection();
        return;
      }
      ed.marqueeSelect(
        Math.min(d.start.x, page.x), Math.min(d.start.y, page.y),
        Math.abs(page.x - d.start.x), Math.abs(page.y - d.start.y), d.additive,
      );
      return;
    }
    if (d.mode === 'move') {
      if (!d.active) {
        if (e.shiftKey) {
          const top = safeTop(page);
          if (top !== null) ed.select([top], true);
        }
        return;
      }
      ed.moveSelected(page.x - d.start.x, page.y - d.start.y);
      return;
    }
    if (d.mode === 'draw') {
      commitDraw(d.start, page);
      return;
    }
    if (d.mode === 'resize') {
      const box = transientResizeBox(d, page);
      if (box) ed.resizeSelected(box.w, box.h, HANDLE_ANCHOR[d.handle]);
      return;
    }
    if (d.mode === 'rotate') {
      ed.setNodeProps(d.nodeId, { rotation: -d.angle });
    }
  };

  /** Local-space resized size from a drag; shared by the preview and commit. */
  const transientResizeBox = (
    d: { nodeId: number; handle: Handle; startW: number; startH: number; start: Pt },
    curPage: Pt,
  ): { w: number; h: number } | null => {
    const n = ed.snapshot.byId.get(d.nodeId);
    if (!n) return null;
    const ancestors = ancestorsOf(d.nodeId);
    const cur = pageToLocal(n, ancestors, curPage);
    const start = pageToLocal(n, ancestors, d.start);
    if (!cur || !start) return null;
    const anchor = HANDLE_ANCHOR[d.handle];
    const fixed = anchorPoint(anchor, d.startW, d.startH);
    const grabAt = anchorPoint(oppositeAnchor(d.handle), d.startW, d.startH);
    const grabbed = { x: cur.x - (start.x - grabAt.x), y: cur.y - (start.y - grabAt.y) };
    // Edge handles resize one dimension; ignore drift along the other.
    const w = d.handle === 'n' || d.handle === 's' ? d.startW : Math.max(1, Math.abs(grabbed.x - fixed.x));
    const h = d.handle === 'e' || d.handle === 'w' ? d.startH : Math.max(1, Math.abs(grabbed.y - fixed.y));
    return { w, h };
  };

  const commitDraw = (a: Pt, b: Pt) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const cx = x + w / 2;
    const cy = y + h / 2;
    let parent: number | undefined;
    let local = { x, y };
    try {
      const hits = ed.adapter?.hitTest(cx, cy) ?? [];
      const frame = hits.find((hh) => hh.type === 'FRAME' || hh.type === 'GROUP');
      if (frame && snapshot.tree) {
        const chain = findChain(snapshot.tree, frame.id);
        if (chain) {
          const p = pageToParentLocal(chain, { x, y });
          if (p) {
            parent = frame.id;
            local = p;
          }
        }
      }
    } catch {
      parent = undefined;
    }
    if (tool === 'text') {
      ed.createText({ x: local.x, y: local.y, parent });
      return;
    }
    if (tool === 'line') {
      // Lines stay at page root: their center-based angle math is page-space.
      const x0 = Math.min(a.x, b.x);
      const y0 = a.x <= b.x ? a.y : b.y;
      const x1 = Math.max(a.x, b.x);
      const y1 = a.x <= b.x ? b.y : a.y;
      if (Math.hypot(x1 - x0, y1 - y0) * viewport.zoom < CLICK_PX) return;
      ed.createShape('line', { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      return;
    }
    const tiny = w * viewport.zoom < 4 || h * viewport.zoom < 4;
    const size = tiny ? defaultSize(tool) : { w, h };
    if (tool === 'frame') ed.createFrame({ x: local.x, y: local.y, w: size.w, h: size.h, parent });
    else if (tool === 'rectangle' || tool === 'ellipse') {
      ed.createShape(tool, { x: local.x, y: local.y, w: size.w, h: size.h, parent });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = localPos(e);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      ed.zoomAt(s.x, s.y, viewport.zoom * Math.pow(1.0015, -e.deltaY));
    } else {
      e.preventDefault();
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      ed.setViewport({ zoom: viewport.zoom, x: viewport.x - dx, y: viewport.y - dy });
    }
  };

  const cursor = tool === 'hand' || spaceDown ? (drag?.mode === 'pan' ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair';
  const moveDelta = drag?.mode === 'move' && drag.active ? { x: drag.cur.x - drag.start.x, y: drag.cur.y - drag.start.y } : null;

  return (
    <div
      ref={wrapRef}
      className="engine-canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <div
        className="engine-grid"
        style={{ backgroundSize: `${Math.max(6, 24 * viewport.zoom)}px ${Math.max(6, 24 * viewport.zoom)}px` }}
      />
      {ed.status === 'loading' && (
        <div className="engine-center">
          <p className="dim">Loading the engine…</p>
        </div>
      )}
      {ed.status === 'error' && (
        <div className="engine-center">
          <div className="lab-error" role="alert">
            <p><strong>The engine failed to load.</strong></p>
            <p className="dim">{ed.error}</p>
            <p className="dim">Run <code>npm run build:wasm</code>, then reload.</p>
          </div>
        </div>
      )}
      {ed.status === 'ready' && snapshot.svg === '' && (
        <div className="engine-center engine-empty">
          <p>This page is empty.</p>
          <p className="dim small">Pick a shape tool and drag, or press R for a rectangle.</p>
        </div>
      )}
      {ed.status === 'ready' && snapshot.svg !== '' && (
        <div
          className="engine-svg"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
          dangerouslySetInnerHTML={{ __html: snapshot.svg }}
        />
      )}
      {ed.status === 'ready' && (
        <svg className="engine-overlay" width="100%" height="100%">
          {renderOverlays()}
        </svg>
      )}
    </div>
  );

  function renderOverlays(): React.ReactNode {
    if (!snapshot.tree) return null;
    const els: React.ReactNode[] = [];
    const shift = moveDelta ?? { x: 0, y: 0 };
    if (hoverId !== null && !snapshot.selection.includes(hoverId)) {
      const n = snapshot.byId.get(hoverId);
      if (n && n.type !== 'PAGE') els.push(<g key="hover">{outline(n, ancestorsOf(n.id), '#0d99ff', 1, 0.55, { x: 0, y: 0 })}</g>);
    }
    for (const id of snapshot.selection) {
      const n = snapshot.byId.get(id);
      if (!n || n.type === 'PAGE') continue;
      const off = shift;
      if (drag?.mode === 'rotate' && drag.nodeId === id) {
        els.push(<g key={`sel-${id}`}>{rotatedPreview(n, ancestorsOf(id), drag.angle)}</g>);
      } else if (drag?.mode === 'resize' && drag.nodeId === id) {
        els.push(<g key={`sel-${id}`}>{resizedPreview(n, ancestorsOf(id), drag)}</g>);
      } else {
        els.push(<g key={`sel-${id}`}>{outline(n, ancestorsOf(id), '#0d99ff', 1.5, 1, off)}</g>);
      }
    }
    if (snapshot.selection.length > 1) {
      const boxes = snapshot.selection
        .map((id) => snapshot.byId.get(id))
        .filter((n): n is EngineNode => !!n && n.type !== 'PAGE')
        .map((n) => pageBounds(n, ancestorsOf(n.id)));
      const u = unionBounds(boxes);
      if (u) {
        const s0 = toScreen({ x: u.x + shift.x, y: u.y + shift.y });
        const s1 = toScreen({ x: u.x + u.w + shift.x, y: u.y + u.h + shift.y });
        els.push(
          <rect key="union" x={s0.x} y={s0.y} width={s1.x - s0.x} height={s1.y - s0.y} fill="none" stroke="#0d99ff" strokeWidth={1} strokeDasharray="5 4" />,
        );
      }
    }
    if (handleLayout && single && !(drag && drag.mode !== 'rotate' && drag.mode !== 'resize')) {
      const dx = shift.x * viewport.zoom;
      const dy = shift.y * viewport.zoom;
      els.push(
        <g key="handles" transform={`translate(${dx} ${dy})`}>
          {Object.entries(handleLayout.handles).map(([k, p]) => (
            <rect key={k} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="#ffffff" stroke="#0d99ff" strokeWidth={1.5} />
          ))}
          <line x1={handleLayout.rotateBase.x} y1={handleLayout.rotateBase.y} x2={handleLayout.rotateAt.x} y2={handleLayout.rotateAt.y} stroke="#0d99ff" strokeWidth={1.5} />
          <circle cx={handleLayout.rotateAt.x} cy={handleLayout.rotateAt.y} r={5} fill="#ffffff" stroke="#0d99ff" strokeWidth={1.5} />
        </g>,
      );
    }
    if (drag?.mode === 'marquee' && drag.active) {
      els.push(<g key="marquee">{ghostRect(drag.start, drag.cur)}</g>);
    }
    if (drag?.mode === 'draw') {
      els.push(<g key="draw">{ghostLine(drag.start, drag.cur)}</g>);
    }
    return els;
  }

  function outline(n: EngineNode, ancestors: EngineNode[], color: string, width: number, opacity: number, off: Pt): React.ReactNode {
    if (n.type === 'LINE') {
      const m = chainToPageMatrix([...ancestors, n]);
      const a = toScreen({ x: m.e + off.x, y: m.f + off.y });
      const b = toScreen(applyMatrix({ ...m, e: m.e + off.x, f: m.f + off.y }, n.width, 0));
      return (
        <g opacity={opacity}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width + 1} />
          <circle cx={a.x} cy={a.y} r={3.5} fill="#fff" stroke={color} strokeWidth={1.5} />
          <circle cx={b.x} cy={b.y} r={3.5} fill="#fff" stroke={color} strokeWidth={1.5} />
        </g>
      );
    }
    const pts = pageCorners(n, ancestors)
      .map((p) => toScreen({ x: p.x + off.x, y: p.y + off.y }))
      .map((p) => `${p.x},${p.y}`)
      .join(' ');
    return <polygon points={pts} fill="none" stroke={color} strokeWidth={width} opacity={opacity} />;
  }

  /** Rotate the live corners about their bbox center by the transient delta. */
  function rotatedPreview(n: EngineNode, ancestors: EngineNode[], angleDeg: number): React.ReactNode {
    const corners = pageCorners(n, ancestors);
    const box = pageBounds(n, ancestors);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const displayedClockwise = -n.rotation;
    const m = rotateMatrix(angleDeg - displayedClockwise, cx, cy);
    const pts = corners.map((p) => applyMatrix(m, p.x, p.y)).map((p) => toScreen(p)).map((p) => `${p.x},${p.y}`).join(' ');
    return <polygon points={pts} fill="rgba(13,153,255,0.08)" stroke="#0d99ff" strokeWidth={1.5} />;
  }

  /** Recompute the frame at the transient resized size (anchor point fixed). */
  function resizedPreview(n: EngineNode, ancestors: EngineNode[], d: Extract<Drag, { mode: 'resize' }>): React.ReactNode {
    const box = transientResizeBox(d, d.cur);
    const w = box?.w ?? n.width;
    const h = box?.h ?? n.height;
    const m = multiplyMatrices(chainToPageMatrix(ancestors), localToParentMatrix(n));
    const anchor = HANDLE_ANCHOR[d.handle];
    const fixed = anchorPoint(anchor, n.width, n.height);
    const ax = anchor.includes('l') ? 0 : anchor.includes('r') ? 1 : 0.5;
    const ay = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? 1 : 0.5;
    const ox = fixed.x - ax * w;
    const oy = fixed.y - ay * h;
    const pts = [
      { x: ox, y: oy }, { x: ox + w, y: oy }, { x: ox + w, y: oy + h }, { x: ox, y: oy + h },
    ].map((p) => applyMatrix(m, p.x, p.y)).map((p) => toScreen(p)).map((p) => `${p.x},${p.y}`).join(' ');
    return <polygon points={pts} fill="rgba(13,153,255,0.08)" stroke="#0d99ff" strokeWidth={1.5} />;
  }

  function ghostRect(a: Pt, b: Pt): React.ReactNode {
    const s0 = toScreen({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) });
    const s1 = toScreen({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) });
    return (
      <rect x={s0.x} y={s0.y} width={Math.max(1, s1.x - s0.x)} height={Math.max(1, s1.y - s0.y)} fill="rgba(13,153,255,0.08)" stroke="#0d99ff" strokeWidth={1} strokeDasharray="4 3" />
    );
  }

  function ghostLine(a: Pt, b: Pt): React.ReactNode {
    if (tool === 'line') {
      const s0 = toScreen(a);
      const s1 = toScreen(b);
      return <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke="#0d99ff" strokeWidth={1.5} />;
    }
    const s0 = toScreen({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) });
    const s1 = toScreen({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) });
    return <rect x={s0.x} y={s0.y} width={Math.max(1, s1.x - s0.x)} height={Math.max(1, s1.y - s0.y)} fill="none" stroke="#0d99ff" strokeWidth={1} />;
  }
}

function defaultSize(tool: string): { w: number; h: number } {
  switch (tool) {
    case 'frame':
      return { w: 300, h: 200 };
    case 'ellipse':
      return { w: 80, h: 80 };
    default:
      return { w: 100, h: 60 };
  }
}

function anchorPoint(anchor: string, w: number, h: number): Pt {
  const fx = anchor.includes('l') ? 0 : anchor.includes('r') ? w : w / 2;
  const fy = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? h : h / 2;
  return { x: fx, y: fy };
}

function oppositeAnchor(handle: Handle): string {
  const opposite: Record<Handle, string> = { nw: 'tl', n: 't', ne: 'tr', e: 'r', se: 'br', s: 'b', sw: 'bl', w: 'l' };
  return opposite[handle];
}
