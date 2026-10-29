/**
 * Engine store: React state over the FigCraft-owned document. The WASM engine
 * is the single source of truth — this store keeps a rendered snapshot
 * (pages, tree, selection, SVG) plus UI-only state (tool, viewport), and
 * every editing action calls the adapter first, then re-reads the snapshot.
 * Nothing here maintains a parallel editable document.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EngineAdapter, type EngineNode, type EnginePage } from './adapter';
import { convertUndesignToEngine, type ConvertResult } from './convert';
import { readEngineSnapshot } from './readback';
import { loadWasmEngine, type WasmEngineInstance } from '../wasm/engine';
import { loadStoredDoc } from '../storage';
import { createSampleDoc } from '../sample';
import type { Tool, UndesignDoc, Viewport } from '../types';
import { ZOOM_MAX, ZOOM_MIN, clamp, fitViewport, zoomAtPoint, zoomCentered } from '../utils';

export const ENGINE_STORAGE_KEY = 'undesign.engine.v1';

export type EngineStatus = 'loading' | 'ready' | 'error';

export interface EngineSnapshot {
  pages: EnginePage[];
  activePageId: number | null;
  /** Active page subtree (type PAGE). */
  tree: EngineNode | null;
  byId: Map<number, EngineNode>;
  selection: number[];
  svg: string;
  viewBox: { x: number; y: number; w: number; h: number };
  undoDepth: number;
  redoDepth: number;
  docName: string;
}

export interface ViewportState extends Viewport {
  w: number;
  h: number;
}

interface EngineContextValue {
  status: EngineStatus;
  error: string | null;
  snapshot: EngineSnapshot;
  tool: Tool;
  setTool: (t: Tool) => void;
  viewport: ViewportState;
  setViewport: (v: Viewport) => void;
  setCanvasSize: (w: number, h: number) => void;
  zoomAt: (sx: number, sy: number, zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomTo: (z: number) => void;
  zoomFit: () => void;
  notice: string | null;
  setNotice: (m: string | null) => void;
  dismissNotice: () => void;
  migration: ConvertResult | null;
  canUndo: boolean;
  canRedo: boolean;
  // Selection + inspection.
  refresh: () => void;
  select: (ids: number[], additive?: boolean) => void;
  clearSelection: () => void;
  clickSelect: (x: number, y: number, additive?: boolean) => void;
  marqueeSelect: (x: number, y: number, w: number, h: number, additive?: boolean) => void;
  selectedNodes: EngineNode[];
  // Editing.
  createShape: (kind: 'rectangle' | 'ellipse' | 'line', opts: { x: number; y: number; w: number; h: number; parent?: number }) => number | null;
  createFrame: (opts: { x: number; y: number; w: number; h: number; parent?: number }) => number | null;
  createText: (opts: { x: number; y: number; parent?: number }) => number | null;
  moveSelected: (dx: number, dy: number) => void;
  resizeSelected: (w: number, h: number, anchor: string) => void;
  setNodeProps: (id: number, props: Record<string, unknown>) => void;
  setNodeText: (id: number, characters: string) => void;
  renameNode: (id: number, name: string) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  pasteAtCenter: () => void;
  selectAll: () => void;
  hasClipboard: boolean;
  groupSelected: () => void;
  ungroupSelected: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  alignSelected: (which: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
  distributeSelected: (dir: 'horizontal' | 'vertical') => void;
  toggleVisible: (id: number) => void;
  toggleLock: (id: number) => void;
  reorderNode: (id: number, index: number) => void;
  reparentNodes: (ids: number[], parent: number, index?: number) => void;
  undo: () => void;
  redo: () => void;
  // Pages.
  addPage: () => void;
  selectPage: (id: number) => void;
  renamePage: (id: number, name: string) => void;
  deletePage: (id: number) => void;
  duplicatePage: (id: number) => void;
  // Document IO.
  newDocument: () => void;
  importUndesignDoc: (doc: UndesignDoc) => ConvertResult | null;
  importEngineJson: (json: string) => boolean;
  exportUndesignDoc: () => UndesignDoc | null;
  exportSvg: () => string | null;
  exportEngineJson: () => string | null;
  adapter: EngineAdapter | null;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used within EngineProvider');
  return ctx;
}

const EMPTY_SNAPSHOT: EngineSnapshot = {
  pages: [],
  activePageId: null,
  tree: null,
  byId: new Map(),
  selection: [],
  svg: '',
  viewBox: { x: 0, y: 0, w: 0, h: 0 },
  undoDepth: 0,
  redoDepth: 0,
  docName: 'Untitled',
};

function indexTree(root: EngineNode, map: Map<number, EngineNode>): void {
  map.set(root.id, root);
  for (const c of root.children) indexTree(c, map);
}

/** Read the `<svg … viewBox="x y w h">` origin so overlays align to page space. */
export function parseSvgViewBox(svg: string): { x: number; y: number; w: number; h: number } {
  const m = svg.match(/<svg[^>]*viewBox="([^"]+)"/);
  if (!m) return { x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = m[1].split(/[\s,]+/).map(Number);
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return { x: 0, y: 0, w: 0, h: 0 };
  return { x, y, w, h };
}

/** Page point → screen px given the parsed viewBox, zoom, and pan. */
export function pageToScreen(
  vb: { x: number; y: number },
  v: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: (x - vb.x) * v.zoom + v.x, y: (y - vb.y) * v.zoom + v.y };
}

/** Screen px → page point. */
export function screenToPage(
  vb: { x: number; y: number },
  v: Viewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return { x: vb.x + (sx - v.x) / v.zoom, y: vb.y + (sy - v.y) / v.zoom };
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const adapterRef = useRef<EngineAdapter | null>(null);
  const factoryRef = useRef<(() => WasmEngineInstance) | null>(null);
  const [status, setStatus] = useState<EngineStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY_SNAPSHOT);
  const [tool, setToolState] = useState<Tool>('select');
  const [viewport, setViewportState] = useState<ViewportState>({ zoom: 1, x: 80, y: 60, w: 1280, h: 800 });
  const [notice, setNotice] = useState<string | null>(null);
  const [migration, setMigration] = useState<ConvertResult | null>(null);
  const persistTimer = useRef<number | null>(null);

  const setTool = useCallback((t: Tool) => setToolState(t), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const persist = useCallback(() => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      const api = adapterRef.current;
      if (!api) return;
      try {
        window.localStorage.setItem(ENGINE_STORAGE_KEY, api.save());
      } catch {
        // Storage full or unavailable — the app keeps working in memory.
      }
    }, 400);
  }, []);

  const refresh = useCallback(() => {
    const api = adapterRef.current;
    if (!api) return;
    try {
      const pages = api.pages();
      const active = pages.find((p) => p.current) ?? pages[0] ?? null;
      const tree = api.describePage(32);
      const byId = new Map<number, EngineNode>();
      indexTree(tree, byId);
      const selection = api.selection().filter((id) => byId.has(id));
      let svg = '';
      try {
        svg = api.svg();
      } catch {
        svg = ''; // Empty pages export nothing; the canvas shows an empty state.
      }
      const [undoDepth, redoDepth] = api.undoDepth();
      const docName = api.docName();
      setSnapshot({ pages, activePageId: active?.id ?? null, tree, byId, selection, svg, viewBox: parseSvgViewBox(svg), undoDepth, redoDepth, docName });
    } catch (e) {
      setNotice(`Engine read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /** Run an adapter mutation, then re-read the snapshot and persist. */
  const mutate = useCallback(
    (fn: (api: EngineAdapter) => void, failure: string) => {
      const api = adapterRef.current;
      if (!api) return;
      try {
        fn(api);
      } catch (e) {
        setNotice(`${failure}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      refresh();
      persist();
    },
    [refresh, persist],
  );

  // ---- boot: stored engine doc → legacy UND conversion → sample seed ----
  useEffect(() => {
    let alive = true;
    loadWasmEngine()
      .then(({ engine, createSession }) => {
        if (!alive) return;
        factoryRef.current = createSession;
        const api = new EngineAdapter(engine);
        adapterRef.current = api;
        let note: string | null = null;
        try {
          const stored = window.localStorage.getItem(ENGINE_STORAGE_KEY);
          if (stored) {
            api.load(stored);
          } else {
            const legacy = loadStoredDoc();
            if (legacy) {
              const res = convertUndesignToEngine(legacy, { execute: (cmd, params) => api.cmd(cmd, params) });
              setMigration(res);
              note =
                res.warnings.length === 0
                  ? `Migrated your document (${res.objects} objects, ${res.pages} pages).`
                  : `Migrated your document (${res.objects} objects) with ${res.warnings.length} noted approximation(s).`;
            } else {
              convertUndesignToEngine(createSampleDoc(), { execute: (cmd, params) => api.cmd(cmd, params) });
            }
            window.localStorage.setItem(ENGINE_STORAGE_KEY, api.save());
          }
        } catch (e) {
          if (!alive) return;
          setStatus('error');
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
        if (!alive) return;
        setStatus('ready');
        if (note) setNotice(note);
        refresh();
      })
      .catch((e: unknown) => {
        if (alive) {
          setStatus('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [refresh]);

  // ---- viewport ----
  const setViewport = useCallback(
    (v: Viewport) => setViewportState((p) => ({ ...p, zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX), x: v.x, y: v.y })),
    [],
  );
  const setCanvasSize = useCallback((w: number, h: number) => {
    setViewportState((p) => (p.w === w && p.h === h ? p : { ...p, w, h }));
  }, []);
  const zoomAt = useCallback(
    (sx: number, sy: number, zoom: number) => setViewportState((p) => ({ ...p, ...zoomAtPoint(p, sx, sy, zoom) })),
    [],
  );
  const zoomIn = useCallback(() => setViewportState((p) => ({ ...p, ...zoomCentered(p, p.w, p.h, p.zoom * 1.25) })), []);
  const zoomOut = useCallback(() => setViewportState((p) => ({ ...p, ...zoomCentered(p, p.w, p.h, p.zoom / 1.25) })), []);
  const zoomReset = useCallback(() => setViewportState((p) => ({ ...p, ...zoomCentered(p, p.w, p.h, 1) })), []);
  const zoomTo = useCallback((z: number) => setViewportState((p) => ({ ...p, ...zoomCentered(p, p.w, p.h, z) })), []);
  const zoomFit = useCallback(() => {
    setViewportState((p) => {
      // Content is rendered relative to the viewBox origin, so fit the
      // viewBox size in render space.
      const vb = snapshot.viewBox;
      const w = vb.w > 0 ? vb.w : 800;
      const h = vb.h > 0 ? vb.h : 600;
      return { ...p, ...fitViewport({ x: 0, y: 0, w, h }, p.w, p.h) };
    });
  }, [snapshot.viewBox]);

  // ---- selection ----
  const select = useCallback(
    (ids: number[], additive = false) => {
      const api = adapterRef.current;
      if (!api) return;
      mutate(
        (a) => {
          if (!additive) {
            a.setSelection(ids);
            return;
          }
          const cur = new Set(a.selection());
          for (const id of ids) {
            if (cur.has(id)) cur.delete(id);
            else cur.add(id);
          }
          a.setSelection([...cur]);
        },
        'Select failed',
      );
    },
    [mutate],
  );
  const clearSelection = useCallback(() => mutate((a) => a.clearSelection(), 'Clear selection failed'), [mutate]);
  const clickSelect = useCallback(
    (x: number, y: number, additive = false) => {
      const api = adapterRef.current;
      if (!api) return;
      mutate(
        (a) => {
          const top = a.hitTop(x, y);
          if (top === null) {
            if (!additive) a.clearSelection();
            return;
          }
          if (!additive) {
            a.setSelection([top]);
            return;
          }
          const cur = new Set(a.selection());
          if (cur.has(top)) cur.delete(top);
          else cur.add(top);
          a.setSelection([...cur]);
        },
        'Select failed',
      );
    },
    [mutate],
  );
  const marqueeSelect = useCallback(
    (x: number, y: number, w: number, h: number, additive = false) => {
      mutate((a) => {
        a.marquee(x, y, w, h, additive);
      }, 'Marquee select failed');
    },
    [mutate],
  );

  const selectedNodes = useMemo(
    () => snapshot.selection.map((id) => snapshot.byId.get(id)).filter((n): n is EngineNode => n !== undefined),
    [snapshot],
  );

  // ---- editing ----
  const createShape = useCallback(
    (kind: 'rectangle' | 'ellipse' | 'line', opts: { x: number; y: number; w: number; h: number; parent?: number }) => {
      const api = adapterRef.current;
      if (!api) return null;
      let id: number | null = null;
      mutate((a) => {
        if (kind === 'line') {
          const len = Math.hypot(opts.w, opts.h);
          if (len < 1) throw new Error('line is too short');
          const deg = (Math.atan2(opts.h, opts.w) * 180) / Math.PI;
          id = a.createShape('line', { x: opts.x + opts.w / 2 - len / 2, y: opts.y + opts.h / 2, width: len, parent: opts.parent, props: { rotation: deg } });
        } else {
          id = a.createShape(kind, { x: opts.x, y: opts.y, width: Math.max(1, opts.w), height: Math.max(1, opts.h), parent: opts.parent });
        }
      }, 'Create failed');
      return id;
    },
    [mutate],
  );
  const createFrame = useCallback(
    (opts: { x: number; y: number; w: number; h: number; parent?: number }) => {
      const api = adapterRef.current;
      if (!api) return null;
      let id: number | null = null;
      mutate((a) => {
        id = a.createFrame({ x: opts.x, y: opts.y, width: Math.max(1, opts.w), height: Math.max(1, opts.h), parent: opts.parent });
      }, 'Create frame failed');
      return id;
    },
    [mutate],
  );
  const createText = useCallback(
    (opts: { x: number; y: number; parent?: number }) => {
      const api = adapterRef.current;
      if (!api) return null;
      let id: number | null = null;
      mutate((a) => {
        id = a.createText({ text: 'Text', x: opts.x, y: opts.y, parent: opts.parent });
      }, 'Create text failed');
      return id;
    },
    [mutate],
  );
  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      if (snapshot.selection.length === 0) return;
      mutate((a) => a.move(snapshot.selection, dx, dy), 'Move failed');
    },
    [mutate, snapshot.selection],
  );
  const resizeSelected = useCallback(
    (w: number, h: number, anchor: string) => {
      if (snapshot.selection.length === 0) return;
      mutate((a) => a.resize(snapshot.selection, Math.max(1, w), Math.max(1, h), anchor), 'Resize failed');
    },
    [mutate, snapshot.selection],
  );
  const setNodeProps = useCallback((id: number, props: Record<string, unknown>) => mutate((a) => a.setProps(id, props), 'Edit failed'), [mutate]);
  const setNodeText = useCallback((id: number, characters: string) => mutate((a) => a.setText(id, characters), 'Text edit failed'), [mutate]);
  const renameNode = useCallback((id: number, name: string) => mutate((a) => a.rename(id, name), 'Rename failed'), [mutate]);
  const removeSelected = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => a.remove(snapshot.selection), 'Delete failed');
  }, [mutate, snapshot.selection]);
  const duplicateSelected = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => {
      const ids = a.duplicate(snapshot.selection);
      if (ids.length > 0) a.setSelection(ids);
    }, 'Duplicate failed');
  }, [mutate, snapshot.selection]);
  const clipboard = useRef(0);
  const [, bumpClipboard] = useState(0);
  const copySelected = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => {
      a.cmd('edit.copy', { ids: snapshot.selection });
      clipboard.current = snapshot.selection.length;
    }, 'Copy failed');
    bumpClipboard((n) => n + 1);
  }, [mutate, snapshot.selection]);
  const cutSelected = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => {
      // One undo step for the cut.
      a.cmd('command.batch', {
        label: 'Cut',
        commands: [
          { command: 'edit.copy', params: { ids: snapshot.selection } },
          { command: 'edit.delete', params: { ids: snapshot.selection } },
        ],
      });
      clipboard.current = snapshot.selection.length;
    }, 'Cut failed');
    bumpClipboard((n) => n + 1);
  }, [mutate, snapshot.selection]);
  const pasteAtCenter = useCallback(() => {
    if (clipboard.current === 0) return;
    mutate((a) => {
      const c = screenToPage(snapshot.viewBox, viewport, viewport.w / 2, viewport.h / 2);
      const r = a.cmd<{ ids: unknown }>('edit.paste', { x: c.x, y: c.y });
      const ids = Array.isArray(r.ids) ? (r.ids as number[]) : [];
      if (ids.length > 0) a.setSelection(ids);
    }, 'Paste failed');
  }, [mutate, snapshot.viewBox, viewport]);
  const selectAll = useCallback(() => mutate((a) => void a.cmd('select.all'), 'Select all failed'), [mutate]);
  const groupSelected = useCallback(() => {
    if (snapshot.selection.length < 2) return;
    mutate((a) => {
      a.group(snapshot.selection);
    }, 'Group failed');
  }, [mutate, snapshot.selection]);
  const ungroupSelected = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => a.ungroup(snapshot.selection), 'Ungroup failed');
  }, [mutate, snapshot.selection]);
  const bringForward = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => a.bringForward(snapshot.selection), 'Reorder failed');
  }, [mutate, snapshot.selection]);
  const sendBackward = useCallback(() => {
    if (snapshot.selection.length === 0) return;
    mutate((a) => a.sendBackward(snapshot.selection), 'Reorder failed');
  }, [mutate, snapshot.selection]);
  const alignSelected = useCallback(
    (which: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
      if (snapshot.selection.length === 0) return;
      mutate((a) => a.align(snapshot.selection, which), 'Align failed');
    },
    [mutate, snapshot.selection],
  );
  const distributeSelected = useCallback(
    (dir: 'horizontal' | 'vertical') => {
      if (snapshot.selection.length < 3) return;
      mutate((a) => a.distribute(snapshot.selection, dir), 'Distribute failed');
    },
    [mutate, snapshot.selection],
  );
  const toggleVisible = useCallback(
    (id: number) => {
      const n = snapshot.byId.get(id);
      if (!n) return;
      mutate((a) => a.setVisible([id], !n.visible), 'Visibility failed');
    },
    [mutate, snapshot.byId],
  );
  const toggleLock = useCallback(
    (id: number) => {
      const n = snapshot.byId.get(id);
      if (!n) return;
      mutate((a) => a.setLocked([id], !n.locked), 'Lock failed');
    },
    [mutate, snapshot.byId],
  );
  const reorderNode = useCallback((id: number, index: number) => mutate((a) => a.reorder(id, index), 'Reorder failed'), [mutate]);
  const reparentNodes = useCallback(
    (ids: number[], parent: number, index?: number) => mutate((a) => a.reparent(ids, parent, index), 'Reparent failed'),
    [mutate],
  );
  const undo = useCallback(() => mutate((a) => void a.undo(), 'Undo failed'), [mutate]);
  const redo = useCallback(() => mutate((a) => void a.redo(), 'Redo failed'), [mutate]);

  // ---- pages ----
  const addPage = useCallback(() => mutate((a) => void a.addPage(), 'Add page failed'), [mutate]);
  const selectPage = useCallback((id: number) => mutate((a) => a.selectPage(id), 'Select page failed'), [mutate]);
  const renamePage = useCallback((id: number, name: string) => mutate((a) => a.renamePage(id, name), 'Rename page failed'), [mutate]);
  const deletePage = useCallback((id: number) => mutate((a) => a.deletePage(id), 'Delete page failed'), [mutate]);
  const duplicatePage = useCallback((id: number) => mutate((a) => void a.duplicatePage(id), 'Duplicate page failed'), [mutate]);

  // ---- document IO ----
  const newDocument = useCallback(() => {
    const factory = factoryRef.current;
    if (!factory) return;
    adapterRef.current = new EngineAdapter(factory());
    setMigration(null);
    refresh();
    persist();
    setNotice('Started a new document.');
  }, [refresh, persist]);

  const importUndesignDoc = useCallback(
    (doc: UndesignDoc): ConvertResult | null => {
      const api = adapterRef.current;
      if (!api) return null;
      try {
        const res = convertUndesignToEngine(doc, { execute: (cmd, params) => api.cmd(cmd, params) });
        setMigration(res);
        refresh();
        persist();
        setNotice(
          res.warnings.length === 0
            ? `Imported ${res.objects} objects.`
            : `Imported ${res.objects} objects with ${res.warnings.length} noted approximation(s).`,
        );
        return res;
      } catch (e) {
        setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    },
    [refresh, persist],
  );

  const importEngineJson = useCallback(
    (json: string): boolean => {
      const api = adapterRef.current;
      if (!api) return false;
      try {
        api.load(json);
      } catch (e) {
        setNotice(`Open failed: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
      setMigration(null);
      refresh();
      persist();
      setNotice('Document opened.');
      return true;
    },
    [refresh, persist],
  );

  const snapshotAllPages = useCallback((): { pages: EnginePage[]; trees: Map<number, EngineNode> } | null => {
    const api = adapterRef.current;
    if (!api) return null;
    try {
      const pages = api.pages();
      const current = pages.find((p) => p.current) ?? pages[0] ?? null;
      const trees = new Map<number, EngineNode>();
      for (const p of pages) {
        api.selectPage(p.id);
        trees.set(p.id, api.describePage(32));
      }
      if (current) api.selectPage(current.id);
      refresh();
      return { pages, trees };
    } catch (e) {
      setNotice(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
      refresh();
      return null;
    }
  }, [refresh]);

  const exportUndesignDoc = useCallback((): UndesignDoc | null => {
    const snap = snapshotAllPages();
    if (!snap) return null;
    const { doc } = readEngineSnapshot(snap.pages, snap.trees, snapshot.docName);
    return doc;
  }, [snapshotAllPages, snapshot.docName]);

  const exportSvg = useCallback((): string | null => {
    const api = adapterRef.current;
    if (!api) return null;
    try {
      return api.svg();
    } catch (e) {
      setNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);

  const exportEngineJson = useCallback((): string | null => {
    const api = adapterRef.current;
    if (!api) return null;
    try {
      return api.save();
    } catch (e) {
      setNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);

  const value: EngineContextValue = {
    status,
    error,
    snapshot,
    tool,
    setTool,
    viewport,
    setViewport,
    setCanvasSize,
    zoomAt,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomTo,
    zoomFit,
    notice,
    setNotice,
    dismissNotice,
    migration,
    canUndo: snapshot.undoDepth > 0,
    canRedo: snapshot.redoDepth > 0,
    refresh,
    select,
    clearSelection,
    clickSelect,
    marqueeSelect,
    selectedNodes,
    createShape,
    createFrame,
    createText,
    moveSelected,
    resizeSelected,
    setNodeProps,
    setNodeText,
    renameNode,
    removeSelected,
    duplicateSelected,
    copySelected,
    cutSelected,
    pasteAtCenter,
    selectAll,
    hasClipboard: clipboard.current > 0,
    groupSelected,
    ungroupSelected,
    bringForward,
    sendBackward,
    alignSelected,
    distributeSelected,
    toggleVisible,
    toggleLock,
    reorderNode,
    reparentNodes,
    undo,
    redo,
    addPage,
    selectPage,
    renamePage,
    deletePage,
    duplicatePage,
    newDocument,
    importUndesignDoc,
    importEngineJson,
    exportUndesignDoc,
    exportSvg,
    exportEngineJson,
    adapter: adapterRef.current,
  };
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
