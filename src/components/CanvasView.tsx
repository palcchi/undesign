import { useEffect, useRef, useState } from 'react';
import { Frame, Plus, Square, Type } from 'lucide-react';
import { useEditor } from '../store';
import type { DesignObject } from '../types';
import {
  GRID_PITCH,
  SNAP_THRESHOLD_PX,
  canonicalLine,
  childrenOf,
  clamp,
  descendantIds,
  effectiveGradient,
  gradientVector,
  hasIndependentCorners,
  isFormTarget,
  marqueeHits,
  moveLineEnd,
  resolveRadii,
  rootsOf,
  roundedRectPath,
  screenToWorld,
  snapMoveDelta,
  worldToScreen,
} from '../utils';
import type { SnapBounds, SnapGuide } from '../utils';
import {
  IDENTITY,
  applyMatrix,
  fmtNum,
  invertMatrix,
  objectCorners,
  pageMatrixOf,
  parentLocalPoint,
  pointInObject,
  transformedBounds,
  translateLocalByPageDelta,
} from '../transform';
import type { Matrix } from '../transform';
import { ContextMenu, useContextMenu } from './ui';
import { cachedDataUrl, resolveAssetDataUrl } from '../assets';
import { creationBlockers } from '../library';

const SELECT_BLUE = '#0D99FF';

type DragState =
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'move'; startSX: number; startSY: number; moved: boolean; orig: Map<string, { x: number; y: number }>; pendingCollapse: string | null }
  | { kind: 'draw'; startWX: number; startWY: number; id: string; parentId: string | null; moved: boolean }
  | { kind: 'marquee'; startSX: number; startSY: number; curSX: number; curSY: number; active: boolean }
  | { kind: 'resize'; id: string; handle: string; inv: Matrix; startLX: number; startLY: number; orig: { x: number; y: number; w: number; h: number; rotation: number } }
  | { kind: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRot: number }
  | { kind: 'line-end'; id: string; end: 0 | 1; inv: Matrix; startLX: number; startLY: number; orig: { x: number; y: number; w: number; h: number } };

const CLICK_THRESHOLD = 3;

/** Async image element: resolves pixels from the asset store, else a placeholder. */
function CanvasImage({ obj }: { obj: DesignObject }) {
  const [url, setUrl] = useState<string | null>(() => (obj.imageId ? cachedDataUrl(obj.imageId) : null));
  useEffect(() => {
    if (!obj.imageId) {
      setUrl(null);
      return;
    }
    const cached = cachedDataUrl(obj.imageId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let live = true;
    setUrl(null);
    resolveAssetDataUrl(obj.imageId).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [obj.imageId]);
  if (!url) {
    const label = (obj.imageName || 'Image unavailable').slice(0, 28);
    return (
      <g>
        <rect x={0} y={0} width={obj.w} height={obj.h} fill="#E9E9E9" stroke="#B5B5B5" strokeWidth={1} strokeDasharray="4 3" />
        {obj.h >= 24 && (
          <text x={obj.w / 2} y={obj.h / 2 + 4} textAnchor="middle" fontSize={12} fill="#8A8A8A">
            {label}
          </text>
        )}
      </g>
    );
  }
  return <image x={0} y={0} width={obj.w} height={obj.h} href={url} preserveAspectRatio="none" />;
}

export function CanvasView() {
  const editor = useEditor();
  const { doc, page, selectedIds, selected, tool, viewport, gridVisible } = editor;
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const { menu, open, close } = useContextMenu();

  // Latest editor handle for native listeners (avoids stale closures).
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const pageRef = useRef(page);
  pageRef.current = page;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  /* ---------- fit on mount and page switch ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) editorRef.current.zoomFit(w, h);
    };
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  /* ---------- external fit requests (Shift+1 / Shift+2) ---------- */
  useEffect(() => {
    const onFit = () => {
      const el = wrapRef.current;
      if (el && el.clientWidth > 0) editorRef.current.zoomFit(el.clientWidth, el.clientHeight);
    };
    const onFitSelection = () => {
      const el = wrapRef.current;
      if (el && el.clientWidth > 0) editorRef.current.zoomFitSelection(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('undesign:fit-selection', onFitSelection);
    window.addEventListener('undesign:fit', onFit);
    return () => {
      window.removeEventListener('undesign:fit', onFit);
      window.removeEventListener('undesign:fit-selection', onFitSelection);
    };
  }, []);

  /* ---------- wheel: zoom on ctrl/pinch, pan otherwise ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ed = editorRef.current;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        ed.zoomAt(sx, sy, ed.viewport.zoom * factor);
      } else {
        const v = ed.viewport;
        ed.setViewport({ zoom: v.zoom, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- report canvas size for anchored zoom ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const report = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        editorRef.current.setCanvasSize(el.clientWidth, el.clientHeight);
      }
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- space key for temporary pan ---------- */
  useEffect(() => {
    // Buttons keep native Space activation on top of the shared form guard.
    const keepNative = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      return t.tagName === 'BUTTON' || isFormTarget(t.tagName, t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !keepNative(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  /* ---------- Escape cancels the active drag before global deselect ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!dragRef.current) return;
      // Registered before the global shortcut handler; keep it from deselecting.
      e.stopImmediatePropagation();
      e.preventDefault();
      dragRef.current = null;
      setPanning(false);
      setMarquee(null);
      setSnapGuides([]);
      editorRef.current.abortTransient();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- pointer helpers ---------- */
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const frameAtPoint = (wx: number, wy: number): DesignObject | null => {
    const objs = pageRef.current.objects;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type !== 'frame' || !o.visible || o.locked) continue;
      if (pointInObject(objs, o, wx, wy)) return o;
    }
    return null;
  };

  /* ---------- background pointer down ---------- */
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    close();
    if (editingId) return;
    const ed = editorRef.current;
    const pt = toLocal(e);
    const t = toolRef.current;

    if (e.button === 2) return;
    if (e.button === 1) {
      e.preventDefault();
      const v = viewportRef.current;
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: v.x, origY: v.y };
      setPanning(true);
      return;
    }
    if (t === 'hand' || spaceDown || e.button === 1) {
      const v = viewportRef.current;
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: v.x, origY: v.y };
      setPanning(true);
      return;
    }
    if (t === 'select') {
      if (!e.shiftKey) ed.clearSelection();
      dragRef.current = { kind: 'marquee', startSX: pt.x, startSY: pt.y, curSX: pt.x, curSY: pt.y, active: false };
      return;
    }
    // Draw tools: create the object immediately, resize during drag.
    const world = screenToWorld(pt.x, pt.y, viewportRef.current);
    const parent = frameAtPoint(world.x, world.y);
    const localPt = parentLocalPoint(pageRef.current.objects, parent, world.x, world.y) ?? {
      x: world.x,
      y: world.y,
    };
    const local = { x: Math.round(localPt.x), y: Math.round(localPt.y) };
    ed.beginTransient();
    // Non-committing insert: the whole draw (insert + drag sizing) is one step.
    const id = ed.addObject(t, { x: local.x, y: local.y, w: 2, h: t === 'line' ? 0 : 2, parentId: parent?.id ?? null }, false);
    dragRef.current = { kind: 'draw', startWX: world.x, startWY: world.y, id, parentId: parent?.id ?? null, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  /* ---------- object pointer down ---------- */
  const onObjectPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || editingId) return;
    e.stopPropagation();
    close();
    const ed = editorRef.current;
    const t = toolRef.current;
    if (t !== 'select' || spaceDown) {
      // Draw tools paint through objects; space/hand pans from anywhere,
      // including drags that start on top of an object.
      onBackgroundPointerDown(e);
      return;
    }
    const obj = pageRef.current.objects.find((o) => o.id === id);
    if (!obj || !obj.visible || obj.locked) return;
    const sel = selectedIdsRef.current;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ed.select([id], true);
      return;
    }
    const pt = toLocal(e);
    if (!sel.includes(id)) {
      ed.select([id]);
    }
    const current = sel.includes(id) ? sel : [id];
    // Top-most only: dragging a frame already moves its children.
    const topIds = new Set(
      rootsOf(
        current
          .map((oid) => pageRef.current.objects.find((oo) => oo.id === oid))
          .filter((o): o is DesignObject => o !== undefined),
      ).map((o) => o.id),
    );
    const orig = new Map<string, { x: number; y: number }>();
    for (const oid of current) {
      const o = pageRef.current.objects.find((oo) => oo.id === oid);
      if (o && topIds.has(oid) && !o.locked) orig.set(oid, { x: o.x, y: o.y });
    }
    dragRef.current = {
      kind: 'move', startSX: pt.x, startSY: pt.y, moved: false, orig,
      pendingCollapse: sel.includes(id) && sel.length > 1 ? id : null,
    };
  };

  /* ---------- global move/up ---------- */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const ed = editorRef.current;
      const rect = wrapRef.current?.getBoundingClientRect();
      const sx = e.clientX - (rect?.left ?? 0);
      const sy = e.clientY - (rect?.top ?? 0);
      const v = viewportRef.current;

      switch (drag.kind) {
        case 'pan': {
          ed.setViewport({ zoom: v.zoom, x: drag.origX + (e.clientX - drag.startX), y: drag.origY + (e.clientY - drag.startY) });
          break;
        }
        case 'move': {
          const dxW = (sx - drag.startSX) / v.zoom;
          const dyW = (sy - drag.startSY) / v.zoom;
          if (!drag.moved && Math.hypot(sx - drag.startSX, sy - drag.startSY) < CLICK_THRESHOLD) break;
          if (!drag.moved) {
            drag.moved = true;
            ed.beginTransient();
          }
          const orig = drag.orig;
          // Smart guides + grid snap adjust the page-space delta before it is
          // mapped into each object's local frame. Alt bypasses snapping.
          let ax = dxW;
          let ay = dyW;
          let exactX = false;
          let exactY = false;
          const wantSnap = !e.altKey && (ed.snapObjects || (ed.snapGrid && ed.gridVisible));
          if (wantSnap && orig.size > 0) {
            const pg = pageRef.current;
            const movedIds = new Set(orig.keys());
            for (const oid of orig.keys()) {
              for (const did of descendantIds(pg.objects, oid)) movedIds.add(did);
            }
            const hypo = pg.objects.map((o) => {
              const s = orig.get(o.id);
              if (!s) return o;
              const nl = translateLocalByPageDelta(pg.objects, { ...o, x: s.x, y: s.y }, dxW, dyW);
              return { ...o, x: nl.x, y: nl.y };
            });
            let mx0 = Infinity;
            let my0 = Infinity;
            let mx1 = -Infinity;
            let my1 = -Infinity;
            for (const o of hypo) {
              if (!movedIds.has(o.id)) continue;
              const b = transformedBounds(hypo, o);
              mx0 = Math.min(mx0, b.x);
              my0 = Math.min(my0, b.y);
              mx1 = Math.max(mx1, b.x + b.w);
              my1 = Math.max(my1, b.y + b.h);
            }
            if (mx0 !== Infinity) {
              const cands: SnapBounds[] = [];
              if (ed.snapObjects) {
                for (const o of pg.objects) {
                  if (movedIds.has(o.id) || !o.visible) continue;
                  cands.push(transformedBounds(pg.objects, o));
                }
              }
              const r = snapMoveDelta(
                { x: mx0, y: my0, w: mx1 - mx0, h: my1 - my0 },
                cands,
                {
                  grid: ed.snapGrid && ed.gridVisible ? GRID_PITCH : null,
                  threshold: SNAP_THRESHOLD_PX / v.zoom,
                },
              );
              ax = dxW + r.dx;
              ay = dyW + r.dy;
              // Object snaps land on exact (possibly fractional) coordinates;
              // grid snaps and untouched axes keep the standard rounding.
              exactX = r.dx !== 0 && r.guides.some((g) => g.x1 === g.x2);
              exactY = r.dy !== 0 && r.guides.some((g) => g.y1 === g.y2);
              setSnapGuides(r.guides);
            } else {
              setSnapGuides([]);
            }
          } else {
            setSnapGuides([]);
          }
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) => {
                  const s = orig.get(o.id);
                  if (!s) return o;
                  const nl = translateLocalByPageDelta(
                    p.objects,
                    { ...o, x: s.x, y: s.y },
                    ax,
                    ay,
                  );
                  return { ...o, x: exactX ? nl.x : Math.round(nl.x), y: exactY ? nl.y : Math.round(nl.y) };
                }),
              },
            ),
          }));
          break;
        }
        case 'draw': {
          const world = screenToWorld(sx, sy, v);
          const dx = world.x - drag.startWX;
          const dy = world.y - drag.startWY;
          if (Math.hypot(dx, dy) * v.zoom < CLICK_THRESHOLD) break;
          drag.moved = true;
          const pg = pageRef.current;
          const parent = drag.parentId
            ? (pg.objects.find((o) => o.id === drag.parentId) ?? null)
            : null;
          const p1 = parentLocalPoint(pg.objects, parent, drag.startWX, drag.startWY) ?? {
            x: drag.startWX,
            y: drag.startWY,
          };
          const p2 = parentLocalPoint(pg.objects, parent, world.x, world.y) ?? {
            x: world.x,
            y: world.y,
          };
          const x1 = p1.x;
          const y1 = p1.y;
          const x2 = p2.x;
          const y2 = p2.y;
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) => {
                  if (o.id !== drag.id) return o;
                  if (o.type === 'line') {
                    const g = canonicalLine(x1, y1, x2, y2);
                    return {
                      ...o,
                      x: Math.round(g.x),
                      y: Math.round(g.y),
                      w: Math.round(g.w),
                      h: Math.round(g.h),
                    };
                  }
                  return {
                    ...o,
                    x: Math.round(Math.min(x1, x2)),
                    y: Math.round(Math.min(y1, y2)),
                    w: Math.max(2, Math.round(Math.abs(x2 - x1))),
                    h: Math.max(2, Math.round(Math.abs(y2 - y1))),
                  };
                }),
              },
            ),
          }));
          break;
        }
        case 'marquee': {
          drag.curSX = sx;
          drag.curSY = sy;
          if (!drag.active && Math.hypot(sx - drag.startSX, sy - drag.startSY) < CLICK_THRESHOLD) break;
          drag.active = true;
          setMarquee({
            x: Math.min(drag.startSX, sx),
            y: Math.min(drag.startSY, sy),
            w: Math.abs(sx - drag.startSX),
            h: Math.abs(sy - drag.startSY),
          });
          break;
        }
        case 'resize': {
          const world = screenToWorld(sx, sy, v);
          const cur = applyMatrix(drag.inv, world.x, world.y);
          const dxL = cur.x - drag.startLX;
          const dyL = cur.y - drag.startLY;
          const rad = (drag.orig.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const hnd = drag.handle;
          let { x, y, w, h } = drag.orig;
          let ldx = 0;
          let ldy = 0;
          if (hnd.includes('e')) w = drag.orig.w + dxL;
          if (hnd.includes('s')) h = drag.orig.h + dyL;
          if (hnd.includes('w')) {
            w = drag.orig.w - dxL;
            ldx = dxL;
          }
          if (hnd.includes('n')) {
            h = drag.orig.h - dyL;
            ldy = dyL;
          }
          const target = pageRef.current.objects.find((o) => o.id === drag.id);
          const isLine = target?.type === 'line';
          // Shift locks image proportions (photos should not stretch by accident).
          if (e.shiftKey && target?.type === 'image' && drag.orig.w > 0 && drag.orig.h > 0) {
            const ratio = drag.orig.w / drag.orig.h;
            const corner =
              (hnd.includes('e') || hnd.includes('w')) && (hnd.includes('s') || hnd.includes('n'));
            if (corner) {
              if (Math.abs(w / drag.orig.w - 1) >= Math.abs(h / drag.orig.h - 1)) h = w / ratio;
              else w = h * ratio;
            } else if (hnd.includes('e') || hnd.includes('w')) {
              h = w / ratio;
            } else {
              w = h * ratio;
            }
          }
          w = Math.max(isLine && !hnd.includes('w') && !hnd.includes('e') ? drag.orig.w : 1, w);
          h = isLine ? Math.max(0, h) : Math.max(1, h);
          // Clamp origin shift when clamped.
          if (hnd.includes('w')) ldx = drag.orig.w - w;
          if (hnd.includes('n')) ldy = drag.orig.h - h;
          x = drag.orig.x + ldx * cos - ldy * sin;
          y = drag.orig.y + ldx * sin + ldy * cos;
          const nx = Math.round(x);
          const ny = Math.round(y);
          const nw = Math.round(w);
          const nh = Math.round(h);
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) => (o.id === drag.id ? { ...o, x: nx, y: ny, w: nw, h: nh } : o)),
              },
            ),
          }));
          break;
        }
        case 'rotate': {
          const world = screenToWorld(sx, sy, v);
          const angle = (Math.atan2(world.y - drag.cy, world.x - drag.cx) * 180) / Math.PI;
          let rot = drag.startRot + (angle - drag.startAngle);
          if (e.shiftKey) rot = Math.round(rot / 15) * 15;
          rot = Math.round(rot * 10) / 10;
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) => (o.id === drag.id ? { ...o, rotation: rot } : o)),
              },
            ),
          }));
          break;
        }
        case 'line-end': {
          const world = screenToWorld(sx, sy, v);
          const cur = applyMatrix(drag.inv, world.x, world.y);
          const g = moveLineEnd(drag.orig, drag.end, cur.x - drag.startLX, cur.y - drag.startLY);
          const x = Math.round(g.x);
          const y = Math.round(g.y);
          const w = Math.round(g.w);
          const h = Math.round(g.h);
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) =>
                  o.id === drag.id ? { ...o, x, y, w, h } : o,
                ),
              },
            ),
          }));
          break;
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setPanning(false);
      setSnapGuides([]);
      const ed = editorRef.current;
      const v = viewportRef.current;

      if (drag.kind === 'move') {
        if (drag.moved) {
          ed.endTransient();
        } else if (drag.pendingCollapse) {
          ed.select([drag.pendingCollapse]);
        }
      } else if (drag.kind === 'draw') {
        const pg = pageRef.current;
        const obj = pg.objects.find((o) => o.id === drag.id);
        if (obj && !drag.moved) {
          // Click without drag: sensible default sized object.
          const defaults: Record<string, { w: number; h: number }> = {
            frame: { w: 480, h: 320 },
            rectangle: { w: 160, h: 120 },
            ellipse: { w: 140, h: 140 },
            text: { w: 240, h: 30 },
            line: { w: 160, h: 0 },
          };
          const dd = defaults[obj.type];
          const t = toolRef.current;
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) =>
                  o.id === drag.id ? { ...o, w: dd.w, h: dd.h, text: o.type === 'text' ? 'Type something' : o.text } : o,
                ),
              },
            ),
          }));
          if (t === 'text') setEditingId(drag.id);
        }
        ed.endTransient();
      } else if (drag.kind === 'marquee') {
        setMarquee(null);
        if (drag.active) {
          const r1 = screenToWorld(Math.min(drag.startSX, drag.curSX), Math.min(drag.startSY, drag.curSY), v);
          const r2 = screenToWorld(Math.max(drag.startSX, drag.curSX), Math.max(drag.startSY, drag.curSY), v);
          const pg = pageRef.current;
          const hits = marqueeHits(pg.objects, r1, r2);
          if (e.shiftKey) {
            const merged = new Set([...selectedIdsRef.current, ...hits]);
            ed.select([...merged]);
          } else {
            ed.select(hits);
          }
        }
      } else {
        ed.endTransient();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /* ---------- resize / rotate / line handles ---------- */
  const startResize = (e: React.PointerEvent, id: string, handle: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const obj = page.objects.find((o) => o.id === id);
    if (!obj || obj.locked) return;
    const pt = toLocal(e);
    const world = screenToWorld(pt.x, pt.y, viewport);
    const inv = invertMatrix(pageMatrixOf(page.objects, obj)) ?? IDENTITY;
    const startLocal = applyMatrix(inv, world.x, world.y);
    editor.beginTransient();
    dragRef.current = {
      kind: 'resize', id, handle, inv, startLX: startLocal.x, startLY: startLocal.y,
      orig: { x: obj.x, y: obj.y, w: obj.w, h: obj.h, rotation: obj.rotation },
    };
  };

  const startRotate = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const obj = page.objects.find((o) => o.id === id);
    if (!obj || obj.locked) return;
    const center = applyMatrix(pageMatrixOf(page.objects, obj), obj.w / 2, obj.h / 2);
    const cx = center.x;
    const cy = center.y;
    const pt = toLocal(e);
    const world = screenToWorld(pt.x, pt.y, viewport);
    const startAngle = (Math.atan2(world.y - cy, world.x - cx) * 180) / Math.PI;
    editor.beginTransient();
    dragRef.current = { kind: 'rotate', id, cx, cy, startAngle, startRot: obj.rotation };
  };

  const startLineEnd = (e: React.PointerEvent, id: string, end: 0 | 1) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const obj = page.objects.find((o) => o.id === id);
    if (!obj || obj.locked) return;
    const pt = toLocal(e);
    const world = screenToWorld(pt.x, pt.y, viewport);
    const inv = invertMatrix(pageMatrixOf(page.objects, obj)) ?? IDENTITY;
    const startLocal = applyMatrix(inv, world.x, world.y);
    editor.beginTransient();
    dragRef.current = {
      kind: 'line-end', id, end, inv, startLX: startLocal.x, startLY: startLocal.y,
      orig: { x: obj.x, y: obj.y, w: obj.w, h: obj.h },
    };
  };

  /* ---------- text editing ---------- */
  const beginTextEdit = (id: string) => {
    const obj = page.objects.find((o) => o.id === id);
    if (!obj || obj.type !== 'text' || obj.locked) return;
    editor.select([id]);
    editor.setTool('select');
    editor.beginTransient();
    setEditingId(id);
  };

  const editingObj = editingId ? page.objects.find((o) => o.id === editingId) : undefined;

  /* ---------- context menus ---------- */
  const onObjectContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const ed = editorRef.current;
    if (!selectedIdsRef.current.includes(id)) ed.select([id]);
    const sel = selectedIdsRef.current.includes(id) ? selectedIdsRef.current : [id];
    open(e.clientX, e.clientY, [
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: ed.cutSelected },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: ed.copySelected },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !ed.hasClipboard, onSelect: ed.paste },
      { divider: true },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: ed.duplicateSelected },
      { label: 'Delete', shortcut: 'Del', danger: true, onSelect: () => ed.deleteObjects(sel) },
      { divider: true },
      { label: 'Bring forward', shortcut: 'Ctrl+]', disabled: sel.length !== 1, onSelect: () => ed.reorder(sel[0], 'up') },
      { label: 'Send backward', shortcut: 'Ctrl+[', disabled: sel.length !== 1, onSelect: () => ed.reorder(sel[0], 'down') },
      { divider: true },
      { label: 'Group selection', shortcut: 'Ctrl+G', onSelect: ed.groupSelected },
      { label: 'Ungroup selection', shortcut: 'Ctrl+Shift+G', onSelect: ed.ungroupSelected },
      { divider: true },
      {
        label: 'Create component',
        shortcut: 'Ctrl+Alt+K',
        disabled: creationBlockers(pageRef.current.objects, sel) !== null,
        onSelect: ed.createComponentFromSelected,
      },
      ...(pageRef.current.objects.find((o) => o.id === id)?.componentId
        ? [{
          label: 'Detach instance',
          disabled: sel.length !== 1,
          onSelect: ed.detachSelectedInstance,
        }]
        : []),
    ]);
  };

  const onCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const ed = editorRef.current;
    open(e.clientX, e.clientY, [
      { label: 'Select all', shortcut: 'Ctrl+A', onSelect: ed.selectAll },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !ed.hasClipboard, onSelect: ed.paste },
      { divider: true },
      { label: 'Fit canvas', shortcut: 'Shift+1', onSelect: () => {
        const el = wrapRef.current;
        if (el) ed.zoomFit(el.clientWidth, el.clientHeight);
      } },
    ]);
  };

  /* ---------- rendering ---------- */
  const renderNode = (obj: DesignObject): React.ReactNode => {
    if (!obj.visible) return null;
    const kids = childrenOf(page.objects, obj.id);
    const locked = obj.locked;
    const common = {
      onPointerDown: locked ? undefined : (e: React.PointerEvent) => onObjectPointerDown(e, obj.id),
      onDoubleClick: obj.type === 'text' && !locked ? (e: React.MouseEvent) => { e.stopPropagation(); beginTextEdit(obj.id); } : undefined,
      onContextMenu: locked ? undefined : (e: React.MouseEvent) => onObjectContextMenu(e, obj.id),
      style: { cursor: tool === 'hand' || spaceDown ? (panning ? 'grabbing' : 'grab') : tool === 'select' ? undefined : 'crosshair', pointerEvents: (locked ? 'none' : 'auto') as React.CSSProperties['pointerEvents'] },
    };
    const transform = `translate(${obj.x} ${obj.y})${obj.rotation !== 0 ? ` rotate(${obj.rotation} ${obj.w / 2} ${obj.h / 2})` : ''}`;
    const gradPaint = effectiveGradient(obj) ? `url(#ugrad-${obj.id})` : null;
    const paintFor = (fallback: string): string => (gradPaint === null ? obj.fill || fallback : gradPaint);

    let shape: React.ReactNode = null;
    if (obj.type === 'frame' || obj.type === 'rectangle') {
      shape = hasIndependentCorners(obj) ? (
        <path
          d={roundedRectPath(obj.w, obj.h, resolveRadii(obj))}
          fill={paintFor('none')} fillOpacity={obj.fillOpacity}
          stroke={obj.stroke || 'none'} strokeWidth={obj.strokeWidth}
        />
      ) : (
        <rect
          x={0} y={0} width={obj.w} height={obj.h} rx={obj.cornerRadius}
          fill={paintFor('none')} fillOpacity={obj.fillOpacity}
          stroke={obj.stroke || 'none'} strokeWidth={obj.strokeWidth}
        />
      );
    } else if (obj.type === 'ellipse') {
      shape = (
        <ellipse
          cx={obj.w / 2} cy={obj.h / 2} rx={obj.w / 2} ry={obj.h / 2}
          fill={paintFor('none')} fillOpacity={obj.fillOpacity}
          stroke={obj.stroke || 'none'} strokeWidth={obj.strokeWidth}
        />
      );
    } else if (obj.type === 'text' && obj.id !== editingId) {
      const anchor = obj.textAlign === 'center' ? 'middle' : obj.textAlign === 'right' ? 'end' : 'start';
      const tx = obj.textAlign === 'center' ? obj.w / 2 : obj.textAlign === 'right' ? obj.w : 0;
      const lines = obj.text.split('\n');
      shape = (
        <text
          x={tx} y={obj.fontSize * 0.85}
          fontFamily={obj.fontFamily} fontSize={obj.fontSize} fontWeight={obj.fontWeight}
          textAnchor={anchor} fill={paintFor('#111111')} fillOpacity={obj.fillOpacity}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={tx} dy={i === 0 ? 0 : obj.fontSize * obj.lineHeight}>
              {line === '' ? ' ' : line}
            </tspan>
          ))}
        </text>
      );
    } else if (obj.type === 'line') {
      shape = (
        <>
          <line x1={0} y1={0} x2={obj.w} y2={obj.h} stroke="transparent" strokeWidth={Math.max(12, obj.strokeWidth)} />
          <line
            x1={0} y1={0} x2={obj.w} y2={obj.h}
            stroke={obj.stroke || '#111111'} strokeWidth={obj.strokeWidth || 1} strokeLinecap="round"
          />
        </>
      );
    } else if (obj.type === 'image') {
      shape = <CanvasImage obj={obj} />;
    }

    return (
      <g key={obj.id} transform={transform} opacity={obj.opacity} {...common}>
        {shape}
        {kids.length > 0 && (
          obj.clip && obj.type === 'frame' ? (
            <g clipPath={`url(#clip-${obj.id})`}>{kids.map((k) => renderNode(k))}</g>
          ) : (
            <g>{kids.map((k) => renderNode(k))}</g>
          )
        )}
      </g>
    );
  };

  const renderSelection = () => {
    const z = viewport.zoom;
    return (
      <g pointerEvents="none">
        {selected.map((obj) => {
          if (!obj.visible) return null;
          const corners = objectCorners(page.objects, obj);
          const points = corners.map((c) => `${fmtNum(c.x)},${fmtNum(c.y)}`).join(' ');
          const color = obj.locked ? '#8A8A8A' : SELECT_BLUE;
          return (
            <polygon
              key={`sel-${obj.id}`}
              points={points}
              fill="none" stroke={color} strokeWidth={1.5 / z} strokeLinejoin="round"
              strokeDasharray={obj.locked ? `${4 / z} ${3 / z}` : undefined}
            />
          );
        })}
      </g>
    );
  };

  const renderHandles = () => {
    if (selected.length !== 1 || tool !== 'select') return null;
    const obj = selected[0];
    if (!obj.visible || obj.locked) return null;
    const z = viewport.zoom;
    const m = pageMatrixOf(page.objects, obj);
    const at = (lx: number, ly: number) => applyMatrix(m, lx, ly);
    const s = 9 / z;
    const hs = s / 2;
    const w = obj.w;
    const h = obj.type === 'line' ? 0 : obj.h;

    if (obj.type === 'line') {
      const pts = [
        { pt: at(0, 0), end: 0 as const },
        { pt: at(obj.w, obj.h), end: 1 as const },
      ];
      return (
        <g>
          {pts.map((p, i) => (
            <rect
              key={i}
              x={p.pt.x - hs} y={p.pt.y - hs} width={s} height={s}
              fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z}
              style={{ cursor: 'move', pointerEvents: 'all' }}
              onPointerDown={(e) => startLineEnd(e, obj.id, p.end)}
            />
          ))}
        </g>
      );
    }

    const handles: { id: string; x: number; y: number; cursor: string }[] = [
      { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
      { id: 'ne', x: w, y: 0, cursor: 'nesw-resize' },
      { id: 'sw', x: 0, y: h, cursor: 'nesw-resize' },
      { id: 'se', x: w, y: h, cursor: 'nwse-resize' },
      { id: 'n', x: w / 2, y: 0, cursor: 'ns-resize' },
      { id: 's', x: w / 2, y: h, cursor: 'ns-resize' },
      { id: 'w', x: 0, y: h / 2, cursor: 'ew-resize' },
      { id: 'e', x: w, y: h / 2, cursor: 'ew-resize' },
    ];
    const rotLocal = { x: w / 2, y: -26 / z };
    const rotPos = at(rotLocal.x, rotLocal.y);
    const topPos = at(w / 2, 0);
    return (
      <g>
        <line x1={topPos.x} y1={topPos.y} x2={rotPos.x} y2={rotPos.y} stroke={SELECT_BLUE} strokeWidth={1.5 / z} />
        <circle
          cx={rotPos.x} cy={rotPos.y} r={s / 1.6}
          fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z}
          style={{ cursor: 'grab', pointerEvents: 'all' }}
          onPointerDown={(e) => startRotate(e, obj.id)}
        />
        {handles.map((hh) => {
          const pos = at(hh.x, hh.y);
          return (
            <rect
              key={hh.id}
              x={pos.x - hs} y={pos.y - hs} width={s} height={s}
              fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z}
              style={{ cursor: hh.cursor, pointerEvents: 'all' }}
              onPointerDown={(e) => startResize(e, obj.id, hh.id)}
            />
          );
        })}
      </g>
    );
  };

  const renderPrototypeBadges = () => {
    if (tool !== 'select') return null;
    const z = viewport.zoom;
    const sources = new Set((doc.prototypeLinks ?? []).map((l) => l.sourceId));
    if (sources.size === 0) return null;
    return (
      <g pointerEvents="none">
        {page.objects.filter((o) => o.visible && sources.has(o.id)).map((o) => {
          const c = objectCorners(page.objects, o);
          const cx = (c[1].x + c[3].x) / 2;
          const cy = (c[1].y + c[3].y) / 2;
          const r = 7 / z;
          return (
            <g key={`plink-${o.id}`}>
              <circle cx={cx} cy={cy} r={r} fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z} />
              <path
                d={`M ${cx - r * 0.45} ${cy} L ${cx + r * 0.3} ${cy} M ${cx - r * 0.05} ${cy - r * 0.35} L ${cx + r * 0.3} ${cy} L ${cx - r * 0.05} ${cy + r * 0.35}`}
                fill="none" stroke={SELECT_BLUE} strokeWidth={1.2 / z} strokeLinecap="round" strokeLinejoin="round"
              />
            </g>
          );
        })}
      </g>
    );
  };

  const roots = childrenOf(page.objects, null);
  const cursorClass =
    tool === 'hand' || spaceDown ? (panning ? 'cursor-grabbing' : 'cursor-grab')
    : tool === 'select' ? '' : 'cursor-crosshair';

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap ${cursorClass}`}
      onContextMenu={onCanvasContextMenu}
      onDragStart={(e) => e.preventDefault()}
    >
      <svg className="canvas-svg" width="100%" height="100%" onPointerDown={onBackgroundPointerDown}>
        <defs>
          <pattern id="undot" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.2" cy="1.2" r="1.2" fill="#CFCFCF" />
          </pattern>
          {page.objects.filter((o) => o.type === 'frame' && o.clip).map((o) => (
            <clipPath key={o.id} id={`clip-${o.id}`}>
              {hasIndependentCorners(o) ? (
                <path d={roundedRectPath(o.w, o.h, resolveRadii(o))} />
              ) : (
                <rect x={0} y={0} width={o.w} height={o.h} rx={o.cornerRadius} />
              )}
            </clipPath>
          ))}
          {page.objects.filter((o) => o.visible && effectiveGradient(o)).map((o) => {
            const g = effectiveGradient(o);
            const v = gradientVector(g ? g.angle : 90);
            return (
              <linearGradient key={o.id} id={`ugrad-${o.id}`} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
                {(g ? g.stops : []).map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
            );
          })}
        </defs>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {gridVisible && <rect x={-10000} y={-10000} width={20000} height={20000} fill="url(#undot)" />}
          {roots.map((o) => renderNode(o))}
          {renderSelection()}
          {renderHandles()}
          {renderPrototypeBadges()}
          {snapGuides.map((g, i) => (
            <line
              key={i}
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              stroke="#E5484D"
              strokeWidth={1 / viewport.zoom}
              pointerEvents="none"
            />
          ))}
        </g>
      </svg>

      {marquee && (
        <div
          className="marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}

      {editingObj && <TextEditor obj={editingObj} objects={page.objects} viewport={viewport} onDone={() => { setEditingId(null); editor.endTransient(); }} />}

      {page.objects.length === 0 && (
        <div className="canvas-empty">
          <div className="canvas-empty-card">
            <div className="canvas-empty-icon">
              <Plus size={20} />
            </div>
            <h2>This page is empty</h2>
            <p>Draw a shape, or start from a frame to lay out a screen or poster.</p>
            <div className="canvas-empty-actions">
              <button className="btn secondary" onClick={() => editor.addObject('frame')}>
                <Frame size={14} />
                <span>Frame</span>
              </button>
              <button className="btn secondary" onClick={() => editor.addObject('rectangle')}>
                <Square size={14} />
                <span>Rectangle</span>
              </button>
              <button className="btn secondary" onClick={() => editor.addObject('text')}>
                <Type size={14} />
                <span>Text</span>
              </button>
            </div>
            <p className="dim small">Shortcuts: F · R · O · T · L — drag on the canvas to size</p>
          </div>
        </div>
      )}

      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

/* ---------- inline text editor overlay ---------- */

function TextEditor({
  obj,
  objects,
  viewport,
  onDone,
}: {
  obj: DesignObject;
  objects: DesignObject[];
  viewport: { zoom: number; x: number; y: number };
  onDone: () => void;
}) {
  const editor = useEditor();
  const [value, setValue] = useState(obj.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const ta = ref.current;
    if (ta) {
      ta.focus();
      ta.select();
    }
  }, []);

  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    // No keystroke: cancel the eagerly opened session instead of leaving a
    // phantom undo step. With edits, onDone commits the single session entry.
    if (!dirtyRef.current) editor.abortTransient();
    onDone();
  };

  const topLeft = applyMatrix(pageMatrixOf(objects, obj), 0, 0);
  const s = worldToScreen(topLeft.x, topLeft.y, viewport);
  const z = viewport.zoom;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        dirtyRef.current = true;
        const lines = Math.max(1, v.split('\n').length);
        const h = Math.max(obj.fontSize * obj.lineHeight, lines * obj.fontSize * obj.lineHeight);
        editor.transientUpdate((d) => ({
          ...d,
          pages: d.pages.map((pg) =>
            pg.id !== d.activePageId ? pg : {
              ...pg,
              objects: pg.objects.map((o) => (o.id === obj.id ? { ...o, text: v, h } : o)),
            },
          ),
        }));
      }}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
          e.preventDefault();
          done();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        left: clamp(s.x - 2, 0, 10000),
        top: clamp(s.y, 0, 10000),
        width: Math.max(60, obj.w * z + 8),
        minHeight: Math.max(24, obj.h * z + 8),
        fontFamily: obj.fontFamily,
        fontSize: obj.fontSize * z,
        fontWeight: obj.fontWeight,
        lineHeight: obj.lineHeight,
        textAlign: obj.textAlign,
        color: obj.fill || '#111111',
      }}
      aria-label="Edit text"
    />
  );
}
