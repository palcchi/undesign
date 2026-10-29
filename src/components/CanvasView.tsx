import { useEffect, useRef, useState } from 'react';
import { Frame, Plus, Square, Type } from 'lucide-react';
import { useEditor } from '../store';
import type { DesignObject } from '../types';
import {
  absolutePosition,
  childrenOf,
  clamp,
  screenToWorld,
  worldToScreen,
} from '../utils';
import { ContextMenu, useContextMenu } from './ui';

const SELECT_BLUE = '#0D99FF';

type DragState =
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'move'; startSX: number; startSY: number; moved: boolean; orig: Map<string, { x: number; y: number }>; pendingCollapse: string | null }
  | { kind: 'draw'; startWX: number; startWY: number; id: string; parentId: string | null; moved: boolean }
  | { kind: 'marquee'; startSX: number; startSY: number; curSX: number; curSY: number; active: boolean }
  | { kind: 'resize'; id: string; handle: string; startWX: number; startWY: number; orig: { x: number; y: number; w: number; h: number; rotation: number } }
  | { kind: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRot: number }
  | { kind: 'line-end'; id: string; end: 0 | 1; startWX: number; startWY: number; orig: { x: number; y: number; w: number; h: number } };

const CLICK_THRESHOLD = 3;

export function CanvasView() {
  const editor = useEditor();
  const { page, selectedIds, selected, tool, viewport, gridVisible } = editor;
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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

  /* ---------- external fit request (Shift+1) ---------- */
  useEffect(() => {
    const onFit = () => {
      const el = wrapRef.current;
      if (el && el.clientWidth > 0) editorRef.current.zoomFit(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('undesign:fit', onFit);
    return () => window.removeEventListener('undesign:fit', onFit);
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

  /* ---------- space key for temporary pan ---------- */
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTyping(e.target)) {
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
      const p = absolutePosition(objs, o);
      if (wx >= p.x && wx <= p.x + o.w && wy >= p.y && wy <= p.y + o.h) return o;
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
    const parentAbs = parent ? absolutePosition(pageRef.current.objects, parent) : { x: 0, y: 0 };
    const local = { x: Math.round(world.x - parentAbs.x), y: Math.round(world.y - parentAbs.y) };
    ed.beginTransient();
    const id = ed.addObject(t, { x: local.x, y: local.y, w: 2, h: t === 'line' ? 0 : 2, parentId: parent?.id ?? null });
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
      // In draw modes, clicks pass through to background drawing.
      if (t !== 'select') onBackgroundPointerDown(e);
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
    const orig = new Map<string, { x: number; y: number }>();
    for (const oid of current) {
      const o = pageRef.current.objects.find((oo) => oo.id === oid);
      if (o && !o.locked) orig.set(oid, { x: o.x, y: o.y });
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
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) => {
                  const s = orig.get(o.id);
                  return s ? { ...o, x: Math.round(s.x + dxW), y: Math.round(s.y + dyW) } : o;
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
          const parent = drag.parentId ? pg.objects.find((o) => o.id === drag.parentId) : null;
          const parentAbs = parent ? absolutePosition(pg.objects, parent) : { x: 0, y: 0 };
          const x1 = drag.startWX - parentAbs.x;
          const y1 = drag.startWY - parentAbs.y;
          const x2 = world.x - parentAbs.x;
          const y2 = world.y - parentAbs.y;
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) => {
                  if (o.id !== drag.id) return o;
                  if (o.type === 'line') {
                    return { ...o, x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
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
          const dxW = world.x - drag.startWX;
          const dyW = world.y - drag.startWY;
          const rad = (drag.orig.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const dxL = dxW * cos + dyW * sin;
          const dyL = -dxW * sin + dyW * cos;
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
          const isLine = pageRef.current.objects.find((o) => o.id === drag.id)?.type === 'line';
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
          const dx = world.x - drag.startWX;
          const dy = world.y - drag.startWY;
          let { x, y, w, h } = drag.orig;
          if (drag.end === 0) {
            x = drag.orig.x + dx;
            y = drag.orig.y + dy;
            w = drag.orig.w - dx;
            h = drag.orig.h - dy;
          } else {
            w = drag.orig.w + dx;
            h = drag.orig.h + dy;
          }
          if (w < 0) {
            x += w;
            w = -w;
          }
          ed.transientUpdate((d) => ({
            ...d,
            pages: d.pages.map((p) =>
              p.id !== d.activePageId ? p : {
                ...p,
                objects: p.objects.map((o) =>
                  o.id === drag.id ? { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } : o,
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
          const hits = pg.objects.filter((o) => {
            if (!o.visible || o.locked) return false;
            const p = absolutePosition(pg.objects, o);
            return p.x < r2.x && p.x + o.w > r1.x && p.y < r2.y && p.y + o.h > r1.y;
          }).map((o) => o.id);
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
    editor.beginTransient();
    dragRef.current = {
      kind: 'resize', id, handle, startWX: world.x, startWY: world.y,
      orig: { x: obj.x, y: obj.y, w: obj.w, h: obj.h, rotation: obj.rotation },
    };
  };

  const startRotate = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const obj = page.objects.find((o) => o.id === id);
    if (!obj || obj.locked) return;
    const p = absolutePosition(page.objects, obj);
    const cx = p.x + obj.w / 2;
    const cy = p.y + obj.h / 2;
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
    editor.beginTransient();
    dragRef.current = {
      kind: 'line-end', id, end, startWX: world.x, startWY: world.y,
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

    let shape: React.ReactNode = null;
    if (obj.type === 'frame' || obj.type === 'rectangle') {
      shape = (
        <rect
          x={0} y={0} width={obj.w} height={obj.h} rx={obj.cornerRadius}
          fill={obj.fill || 'none'} fillOpacity={obj.fillOpacity}
          stroke={obj.stroke || 'none'} strokeWidth={obj.strokeWidth}
        />
      );
    } else if (obj.type === 'ellipse') {
      shape = (
        <ellipse
          cx={obj.w / 2} cy={obj.h / 2} rx={obj.w / 2} ry={obj.h / 2}
          fill={obj.fill || 'none'} fillOpacity={obj.fillOpacity}
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
          textAnchor={anchor} fill={obj.fill || '#111111'} fillOpacity={obj.fillOpacity}
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
          const p = absolutePosition(page.objects, obj);
          const w = obj.w;
          const h = obj.type === 'line' ? Math.max(obj.h, 0) : obj.h;
          const color = obj.locked ? '#8A8A8A' : SELECT_BLUE;
          return (
            <g key={`sel-${obj.id}`} transform={`translate(${p.x} ${p.y})${obj.rotation !== 0 ? ` rotate(${obj.rotation} ${w / 2} ${h / 2})` : ''}`}>
              <rect
                x={0} y={0} width={w} height={obj.type === 'line' && h === 0 ? 0.1 : h}
                fill="none" stroke={color} strokeWidth={1.5 / z}
                strokeDasharray={obj.locked ? `${4 / z} ${3 / z}` : undefined}
              />
            </g>
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
    const p = absolutePosition(page.objects, obj);
    const s = 9 / z;
    const hs = s / 2;
    const w = obj.w;
    const h = obj.type === 'line' ? 0 : obj.h;

    if (obj.type === 'line') {
      const pts = [
        { x: 0, y: 0, end: 0 as const },
        { x: obj.w, y: obj.h, end: 1 as const },
      ];
      return (
        <g transform={`translate(${p.x} ${p.y})${obj.rotation !== 0 ? ` rotate(${obj.rotation} ${obj.w / 2} ${obj.h / 2})` : ''}`}>
          {pts.map((pt, i) => (
            <rect
              key={i}
              x={pt.x - hs} y={pt.y - hs} width={s} height={s}
              fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z}
              style={{ cursor: 'move', pointerEvents: 'all' }}
              onPointerDown={(e) => startLineEnd(e, obj.id, pt.end)}
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
    const rotY = -26 / z;
    return (
      <g transform={`translate(${p.x} ${p.y})${obj.rotation !== 0 ? ` rotate(${obj.rotation} ${w / 2} ${h / 2})` : ''}`}>
        <line x1={w / 2} y1={0} x2={w / 2} y2={rotY} stroke={SELECT_BLUE} strokeWidth={1.5 / z} />
        <circle
          cx={w / 2} cy={rotY} r={s / 1.6}
          fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z}
          style={{ cursor: 'grab', pointerEvents: 'all' }}
          onPointerDown={(e) => startRotate(e, obj.id)}
        />
        {handles.map((hh) => (
          <rect
            key={hh.id}
            x={hh.x - hs} y={hh.y - hs} width={s} height={s}
            fill="#fff" stroke={SELECT_BLUE} strokeWidth={1.5 / z}
            style={{ cursor: hh.cursor, pointerEvents: 'all' }}
            onPointerDown={(e) => startResize(e, obj.id, hh.id)}
          />
        ))}
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
              <rect x={0} y={0} width={o.w} height={o.h} rx={o.cornerRadius} />
            </clipPath>
          ))}
        </defs>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {gridVisible && <rect x={-10000} y={-10000} width={20000} height={20000} fill="url(#undot)" />}
          {roots.map((o) => renderNode(o))}
          {renderSelection()}
          {renderHandles()}
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
    onDone();
  };

  const p = absolutePosition(objects, obj);
  const s = worldToScreen(p.x, p.y, viewport);
  const z = viewport.zoom;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
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
