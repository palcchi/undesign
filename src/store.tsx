import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type {
  AlignKind,
  DesignObject,
  DistributeKind,
  DocPage,
  ObjectPatch,
  ObjectType,
  Tool,
  UndesignDoc,
  Viewport,
} from './types';
import {
  absolutePosition,
  childrenOf,
  clamp,
  defaultName,
  descendantIds,
  getPage,
  pageBounds,
  screenToWorld,
  uid,
} from './utils';
import { createBlankDoc, createSampleDoc } from './sample';
import { loadStoredDoc, saveStoredDoc } from './storage';

export const FONT_STACKS = [
  { label: 'Sans', value: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
];

const HISTORY_LIMIT = 60;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

interface HistoryState {
  past: UndesignDoc[];
  present: UndesignDoc;
  future: UndesignDoc[];
}

function autoTextHeight(text: string, fontSize: number, lineHeight: number): number {
  const lines = Math.max(1, text.split('\n').length);
  return Math.max(fontSize * lineHeight, lines * fontSize * lineHeight);
}

function withActivePage(doc: UndesignDoc, fn: (page: DocPage) => DocPage): UndesignDoc {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === doc.activePageId ? fn(p) : p)),
  };
}

/** Clone root objects plus descendants, remapping ids. Keeps parent when requested. */
function cloneSubtrees(
  objects: DesignObject[],
  roots: DesignObject[],
  keepParent: (originalParentId: string | null) => boolean,
): { clones: DesignObject[]; rootIds: string[] } {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const idMap = new Map<string, string>();
  const clones: DesignObject[] = [];
  const rootIds: string[] = [];
  const visit = (obj: DesignObject, isRoot: boolean) => {
    const newId = uid('obj');
    idMap.set(obj.id, newId);
    if (isRoot) rootIds.push(newId);
    const clone: DesignObject = {
      ...JSON.parse(JSON.stringify(obj)) as DesignObject,
      id: newId,
      parentId:
        obj.parentId && (idMap.has(obj.parentId) || (!isRoot && idMap.has(obj.parentId)))
          ? (idMap.get(obj.parentId) as string)
          : obj.parentId && keepParent(obj.parentId) && !isRoot
            ? obj.parentId
            : isRoot
              ? keepParent(obj.parentId)
                ? obj.parentId
                : null
              : (idMap.get(obj.parentId ?? '') ?? null),
    };
    clones.push(clone);
    for (const child of objects.filter((o) => o.parentId === obj.id)) {
      void byId;
      visit(child, false);
    }
  };
  for (const root of roots) visit(root, true);
  return { clones, rootIds };
}

interface EditorContextValue {
  doc: UndesignDoc;
  page: DocPage;
  selectedIds: string[];
  selected: DesignObject[];
  tool: Tool;
  viewport: Viewport;
  gridVisible: boolean;
  canUndo: boolean;
  canRedo: boolean;
  notice: string | null;
  dismissNotice: () => void;

  setTool: (tool: Tool) => void;
  setViewport: (viewport: Viewport) => void;
  zoomAt: (screenX: number, screenY: number, zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomFit: (containerW: number, containerH: number) => void;
  toggleGrid: () => void;

  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  selectAll: () => void;

  setDocName: (name: string) => void;
  addPage: () => void;
  selectPage: (id: string) => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;

  addObject: (
    type: ObjectType,
    init?: Partial<DesignObject> & { x?: number; y?: number; w?: number; h?: number },
  ) => string;
  insertObjects: (objects: DesignObject[], selectIds?: string[]) => void;
  updateObjects: (ids: string[], patch: ObjectPatch) => void;
  beginTransient: () => void;
  transientUpdate: (fn: (doc: UndesignDoc) => UndesignDoc) => void;
  endTransient: () => void;
  moveSelected: (dx: number, dy: number) => void;
  deleteSelected: () => void;
  deleteObjects: (ids: string[]) => void;
  duplicateSelected: () => void;
  renameObject: (id: string, name: string) => void;
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  reorder: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  moveObject: (id: string, targetParentId: string | null, index: number) => void;
  align: (kind: AlignKind) => void;
  distribute: (kind: DistributeKind) => void;

  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  hasClipboard: boolean;

  undo: () => void;
  redo: () => void;
  replaceDoc: (doc: UndesignDoc) => void;
  resetSample: () => void;
  newBlankDoc: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

function initialHistory(): { history: HistoryState; notice: string | null } {
  const stored = loadStoredDoc();
  if (stored) {
    return { history: { past: [], present: stored, future: [] }, notice: null };
  }
  let notice: string | null = null;
  try {
    if (window.localStorage.getItem('undesign.doc.v1')) {
      notice = 'Stored document was invalid, so a fresh sample was loaded.';
    }
  } catch {
    // Storage unavailable — proceed in memory.
  }
  return { history: { past: [], present: createSampleDoc(), future: [] }, notice };
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialHistory);
  const [history, setHistory] = useState<HistoryState>(initial.history);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [viewport, setViewportState] = useState<Viewport>({ zoom: 0.6, x: 48, y: 40 });
  const [gridVisible, setGridVisible] = useState(true);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const [clipboard, setClipboard] = useState<DesignObject[]>([]);
  const transientRef = useRef(false);

  const doc = history.present;
  const page = getPage(doc);

  // Persist (debounced) and prune selection when the document changes.
  useEffect(() => {
    const t = window.setTimeout(() => saveStoredDoc(doc), 400);
    return () => window.clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    setSelectedIds((ids) => {
      const alive = new Set(getPage(doc).objects.map((o) => o.id));
      const next = ids.filter((id) => alive.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [doc]);

  const applyDoc = useCallback(
    (fn: (d: UndesignDoc) => UndesignDoc, commit: boolean) => {
      setHistory((h) => {
        const next = fn(h.present);
        if (next === h.present) return h;
        if (commit) {
          return {
            past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present],
            present: next,
            future: [],
          };
        }
        return { ...h, present: next };
      });
    },
    [],
  );

  const beginTransient = useCallback(() => {
    if (transientRef.current) return;
    transientRef.current = true;
    setHistory((h) => ({
      past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present],
      present: h.present,
      future: [],
    }));
  }, []);

  const transientUpdate = useCallback(
    (fn: (d: UndesignDoc) => UndesignDoc) => {
      if (!transientRef.current) beginTransient();
      applyDoc(fn, false);
    },
    [applyDoc, beginTransient],
  );

  const endTransient = useCallback(() => {
    transientRef.current = false;
  }, []);

  const setViewport = useCallback((v: Viewport) => {
    setViewportState({ zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM), x: v.x, y: v.y });
  }, []);

  const zoomAt = useCallback(
    (sx: number, sy: number, zoom: number) => {
      setViewportState((v) => {
        const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
        const world = screenToWorld(sx, sy, v);
        return { zoom: z, x: sx - world.x * z, y: sy - world.y * z };
      });
    },
    [],
  );

  const zoomIn = useCallback(() => {
    setViewportState((v) => ({ ...v, zoom: clamp(v.zoom * 1.25, MIN_ZOOM, MAX_ZOOM) }));
  }, []);
  const zoomOut = useCallback(() => {
    setViewportState((v) => ({ ...v, zoom: clamp(v.zoom / 1.25, MIN_ZOOM, MAX_ZOOM) }));
  }, []);
  const zoomReset = useCallback(() => {
    setViewportState((v) => ({ ...v, zoom: 1 }));
  }, []);

  const zoomFit = useCallback(
    (containerW: number, containerH: number) => {
      const bounds = pageBounds(page.objects.filter((o) => o.parentId === null));
      if (!bounds) {
        setViewportState({ zoom: 1, x: containerW / 2 - 200, y: containerH / 3 });
        return;
      }
      const pad = 96;
      const z = clamp(
        Math.min((containerW - pad) / bounds.w, (containerH - pad) / bounds.h),
        MIN_ZOOM,
        2,
      );
      setViewportState({
        zoom: z,
        x: (containerW - bounds.w * z) / 2 - bounds.x * z,
        y: (containerH - bounds.h * z) / 2 - bounds.y * z,
      });
    },
    [page],
  );

  const toggleGrid = useCallback(() => setGridVisible((g) => !g), []);

  const select = useCallback((ids: string[], additive = false) => {
    setSelectedIds((prev) => {
      if (!additive) return [...ids];
      const next = new Set(prev);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const selectAll = useCallback(() => {
    setSelectedIds(getPage(history.present).objects.filter((o) => o.visible && !o.locked).map((o) => o.id));
  }, [history.present]);

  const setDocName = useCallback(
    (name: string) => {
      const clean = name.trim() || 'Untitled';
      applyDoc((d) => (d.name === clean ? d : { ...d, name: clean }), true);
    },
    [applyDoc],
  );

  const addPage = useCallback(() => {
    const id = uid('page');
    applyDoc((d) => {
      const n = d.pages.length + 1;
      return {
        ...d,
        pages: [...d.pages, { id, name: `Page ${n}`, objects: [] }],
        activePageId: id,
      };
    }, true);
    setSelectedIds([]);
  }, [applyDoc]);

  const selectPage = useCallback(
    (id: string) => {
      applyDoc((d) => (d.activePageId === id ? d : { ...d, activePageId: id }), false);
      setSelectedIds([]);
    },
    [applyDoc],
  );

  const renamePage = useCallback(
    (id: string, name: string) => {
      const clean = name.trim() || 'Page';
      applyDoc(
        (d) => ({
          ...d,
          pages: d.pages.map((p) => (p.id === id ? { ...p, name: clean } : p)),
        }),
        true,
      );
    },
    [applyDoc],
  );

  const deletePage = useCallback(
    (id: string) => {
      applyDoc((d) => {
        if (d.pages.length === 1) {
          const fresh = createBlankDoc();
          return { ...d, pages: fresh.pages, activePageId: fresh.pages[0].id };
        }
        const idx = d.pages.findIndex((p) => p.id === id);
        const pages = d.pages.filter((p) => p.id !== id);
        const activePageId =
          d.activePageId === id ? pages[Math.max(0, idx - 1)].id : d.activePageId;
        return { ...d, pages, activePageId };
      }, true);
      setSelectedIds([]);
    },
    [applyDoc],
  );

  const insertObjects = useCallback(
    (objects: DesignObject[], selectIds?: string[]) => {
      applyDoc(
        (d) =>
          withActivePage(d, (p) => ({
            ...p,
            objects: [...p.objects, ...objects],
          })),
        true,
      );
      setSelectedIds(selectIds ?? objects.map((o) => o.id));
    },
    [applyDoc],
  );

  const addObject = useCallback(
    (
      type: ObjectType,
      init?: Partial<DesignObject> & { x?: number; y?: number; w?: number; h?: number },
    ): string => {
      const id = uid('obj');
      const pageNow = getPage(history.present);
      const defaults: Partial<DesignObject> = (() => {
        switch (type) {
          case 'frame':
            return { w: 480, h: 320, fill: '#FFFFFF', stroke: '#D9D9D9', strokeWidth: 1, clip: true };
          case 'rectangle':
            return { w: 160, h: 120, fill: '#D9D9D9' };
          case 'ellipse':
            return { w: 140, h: 140, fill: '#D9D9D9' };
          case 'text':
            return {
              w: 240, h: 30, fill: '#111111', text: 'Type something',
              fontSize: 20, fontWeight: 500,
            };
          case 'line':
            return { w: 160, h: 0, stroke: '#111111', strokeWidth: 2 };
        }
      })();
      const center = screenToWorld(480, 320, viewport);
      const obj: DesignObject = {
        name: defaultName(type, pageNow.objects),
        parentId: null,
        x: Math.round(center.x - (init?.w ?? defaults.w ?? 100) / 2),
        y: Math.round(center.y - (init?.h ?? defaults.h ?? 100) / 2),
        w: 100,
        h: 100,
        rotation: 0,
        visible: true,
        locked: false,
        opacity: 1,
        fill: '',
        fillOpacity: 1,
        stroke: '',
        strokeWidth: 0,
        cornerRadius: 0,
        clip: false,
        text: '',
        fontFamily: FONT_STACKS[0].value,
        fontSize: 16,
        fontWeight: 400,
        textAlign: 'left',
        lineHeight: 1.4,
        ...defaults,
        ...init,
        id,
        type,
      };
      if (type === 'text') obj.h = autoTextHeight(obj.text, obj.fontSize, obj.lineHeight);
      insertObjects([obj], [id]);
      return id;
    },
    [history.present, insertObjects, viewport],
  );

  const updateObjects = useCallback(
    (ids: string[], patch: ObjectPatch) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      applyDoc(
        (d) =>
          withActivePage(d, (p) => ({
            ...p,
            objects: p.objects.map((o) => {
              if (!idSet.has(o.id)) return o;
              const next = { ...o, ...patch };
              if (
                o.type === 'text' &&
                patch.h === undefined &&
                (patch.text !== undefined ||
                  patch.fontSize !== undefined ||
                  patch.lineHeight !== undefined)
              ) {
                next.h = autoTextHeight(next.text, next.fontSize, next.lineHeight);
              }
              return next;
            }),
          })),
        true,
      );
    },
    [applyDoc],
  );

  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      if (selectedIds.length === 0) return;
      const idSet = new Set(selectedIds);
      applyDoc(
        (d) =>
          withActivePage(d, (p) => ({
            ...p,
            objects: p.objects.map((o) =>
              idSet.has(o.id) && !o.locked ? { ...o, x: o.x + dx, y: o.y + dy } : o,
            ),
          })),
        true,
      );
    },
    [applyDoc, selectedIds],
  );

  const deleteObjects = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      applyDoc((d) => {
        const pg = getPage(d);
        const doomed = new Set<string>();
        for (const id of ids) {
          doomed.add(id);
          for (const child of descendantIds(pg.objects, id)) doomed.add(child);
        }
        return withActivePage(d, (p) => ({
          ...p,
          objects: p.objects.filter((o) => !doomed.has(o.id)),
        }));
      }, true);
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    },
    [applyDoc],
  );

  const deleteSelected = useCallback(() => {
    deleteObjects(selectedIds);
  }, [deleteObjects, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const pg = getPage(history.present);
    const idSet = new Set(selectedIds);
    // Only duplicate top-most selected roots (skip selected descendants of selected frames).
    const roots = pg.objects.filter(
      (o) => idSet.has(o.id) && !(o.parentId && idSet.has(o.parentId)),
    );
    const { clones, rootIds } = cloneSubtrees(pg.objects, roots, () => true);
    for (const c of clones) {
      if (rootIds.includes(c.id)) {
        c.x += 24;
        c.y += 24;
      }
    }
    insertObjects(clones, rootIds);
  }, [history.present, insertObjects, selectedIds]);

  const renameObject = useCallback(
    (id: string, name: string) => {
      const clean = name.trim() || 'Layer';
      updateObjects([id], { name: clean });
    },
    [updateObjects],
  );

  const toggleVisibility = useCallback(
    (id: string) => {
      const obj = getPage(history.present).objects.find((o) => o.id === id);
      if (obj) updateObjects([id], { visible: !obj.visible });
    },
    [history.present, updateObjects],
  );

  const toggleLock = useCallback(
    (id: string) => {
      const obj = getPage(history.present).objects.find((o) => o.id === id);
      if (obj) updateObjects([id], { locked: !obj.locked });
    },
    [history.present, updateObjects],
  );

  const reorder = useCallback(
    (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
      applyDoc((d) => {
        const pg = getPage(d);
        const obj = pg.objects.find((o) => o.id === id);
        if (!obj) return d;
        const siblings = pg.objects.filter((o) => o.parentId === obj.parentId);
        if (siblings.length < 2) return d;
        const order = siblings.map((s) => s.id);
        const idx = order.indexOf(id);
        const next = [...order];
        if (dir === 'up' && idx < next.length - 1) {
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        } else if (dir === 'down' && idx > 0) {
          [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
        } else if (dir === 'top') {
          next.splice(idx, 1);
          next.push(id);
        } else if (dir === 'bottom') {
          next.splice(idx, 1);
          next.unshift(id);
        } else {
          return d;
        }
        const rank = new Map(next.map((sid, i) => [sid, i]));
        const others = pg.objects.filter((o) => o.parentId !== obj.parentId);
        const reordered = siblings
          .slice()
          .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        // Preserve global array positions of the sibling group: rebuild by
        // replacing sibling slots in order.
        const result: DesignObject[] = [];
        const queue = [...reordered];
        for (const o of pg.objects) {
          result.push(o.parentId === obj.parentId ? (queue.shift() as DesignObject) : o);
        }
        void others;
        return withActivePage(d, (p) => ({ ...p, objects: result }));
      }, true);
    },
    [applyDoc],
  );

  const moveObject = useCallback(
    (id: string, targetParentId: string | null, index: number) => {
      applyDoc((d) => {
        const pg = getPage(d);
        const obj = pg.objects.find((o) => o.id === id);
        if (!obj) return d;
        if (id === targetParentId) return d;
        if (targetParentId && descendantIds(pg.objects, id).includes(targetParentId)) return d;
        const target = targetParentId ? pg.objects.find((o) => o.id === targetParentId) : null;
        if (targetParentId && (!target || target.type !== 'frame')) return d;
        // Convert position between coordinate spaces.
        const abs = absolutePosition(pg.objects, obj);
        let newParentAbs = { x: 0, y: 0 };
        if (target) newParentAbs = absolutePosition(pg.objects, target);
        const moved: DesignObject = {
          ...obj,
          parentId: targetParentId,
          x: Math.round(abs.x - newParentAbs.x),
          y: Math.round(abs.y - newParentAbs.y),
        };
        const rest = pg.objects.filter((o) => o.id !== id);
        const siblings = rest.filter((o) => o.parentId === targetParentId);
        const clamped = clamp(index, 0, siblings.length);
        const result: DesignObject[] = [];
        if (siblings.length === 0 || clamped >= siblings.length) {
          // Append after the last sibling (or at end).
          let inserted = false;
          for (const o of rest) {
            result.push(o);
            if (!inserted && siblings.length > 0 && o.id === siblings[siblings.length - 1].id) {
              result.push(moved);
              inserted = true;
            }
          }
          if (!inserted) result.push(moved);
        } else {
          for (const o of rest) {
            if (o.id === siblings[clamped].id) result.push(moved);
            result.push(o);
          }
        }
        return withActivePage(d, (p) => ({ ...p, objects: result }));
      }, true);
    },
    [applyDoc],
  );

  const align = useCallback(
    (kind: AlignKind) => {
      if (selectedIds.length < 2) return;
      applyDoc((d) => {
        const pg = getPage(d);
        const idSet = new Set(selectedIds);
        const items = pg.objects.filter((o) => idSet.has(o.id));
        if (items.length < 2) return d;
        const abs = items.map((o) => ({ o, p: absolutePosition(pg.objects, o) }));
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const { o, p } of abs) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x + o.w);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y + o.h);
        }
        const byId = new Map(pg.objects.map((o) => [o.id, o]));
        const moved = new Map<string, { x: number; y: number }>();
        for (const { o, p } of abs) {
          let nx = p.x;
          let ny = p.y;
          if (kind === 'left') nx = minX;
          else if (kind === 'right') nx = maxX - o.w;
          else if (kind === 'centerX') nx = (minX + maxX) / 2 - o.w / 2;
          else if (kind === 'top') ny = minY;
          else if (kind === 'bottom') ny = maxY - o.h;
          else if (kind === 'centerY') ny = (minY + maxY) / 2 - o.h / 2;
          const parent = o.parentId ? byId.get(o.parentId) : undefined;
          const parentAbs = parent ? absolutePosition(pg.objects, parent) : { x: 0, y: 0 };
          moved.set(o.id, { x: Math.round(nx - parentAbs.x), y: Math.round(ny - parentAbs.y) });
        }
        return withActivePage(d, (pp) => ({
          ...pp,
          objects: pp.objects.map((o) => {
            const m = moved.get(o.id);
            return m ? { ...o, x: m.x, y: m.y } : o;
          }),
        }));
      }, true);
    },
    [applyDoc, selectedIds],
  );

  const distribute = useCallback(
    (kind: DistributeKind) => {
      if (selectedIds.length < 3) return;
      applyDoc((d) => {
        const pg = getPage(d);
        const idSet = new Set(selectedIds);
        const items = pg.objects.filter((o) => idSet.has(o.id));
        if (items.length < 3) return d;
        const abs = items.map((o) => ({ o, p: absolutePosition(pg.objects, o) }));
        const horizontal = kind === 'horizontal';
        abs.sort((a, b) =>
          horizontal ? a.p.x + a.o.w / 2 - (b.p.x + b.o.w / 2) : a.p.y + a.o.h / 2 - (b.p.y + b.o.h / 2),
        );
        const first = horizontal ? abs[0].p.x + abs[0].o.w / 2 : abs[0].p.y + abs[0].o.h / 2;
        const last = horizontal
          ? abs[abs.length - 1].p.x + abs[abs.length - 1].o.w / 2
          : abs[abs.length - 1].p.y + abs[abs.length - 1].o.h / 2;
        const step = (last - first) / (abs.length - 1);
        const byId = new Map(pg.objects.map((o) => [o.id, o]));
        const moved = new Map<string, { x: number; y: number }>();
        abs.forEach(({ o, p }, i) => {
          const center = first + step * i;
          const nx = horizontal ? center - o.w / 2 : p.x;
          const ny = horizontal ? p.y : center - o.h / 2;
          const parent = o.parentId ? byId.get(o.parentId) : undefined;
          const parentAbs = parent ? absolutePosition(pg.objects, parent) : { x: 0, y: 0 };
          moved.set(o.id, { x: Math.round(nx - parentAbs.x), y: Math.round(ny - parentAbs.y) });
        });
        return withActivePage(d, (pp) => ({
          ...pp,
          objects: pp.objects.map((o) => {
            const m = moved.get(o.id);
            return m ? { ...o, x: m.x, y: m.y } : o;
          }),
        }));
      }, true);
    },
    [applyDoc, selectedIds],
  );

  const copySelected = useCallback(() => {
    const pg = getPage(history.present);
    const idSet = new Set(selectedIds);
    const roots = pg.objects.filter(
      (o) => idSet.has(o.id) && !(o.parentId && idSet.has(o.parentId)),
    );
    if (roots.length === 0) return;
    const out: DesignObject[] = [];
    const collect = (o: DesignObject) => {
      out.push(JSON.parse(JSON.stringify(o)) as DesignObject);
      for (const child of pg.objects.filter((c) => c.parentId === o.id)) collect(child);
    };
    roots.forEach(collect);
    setClipboard(out);
  }, [history.present, selectedIds]);

  const cutSelected = useCallback(() => {
    copySelected();
    deleteSelected();
  }, [copySelected, deleteSelected]);

  const paste = useCallback(() => {
    if (clipboard.length === 0) return;
    const pg = getPage(history.present);
    const clipIds = new Set(clipboard.map((o) => o.id));
    const idMap = new Map<string, string>();
    for (const o of clipboard) idMap.set(o.id, uid('obj'));
    const clones = clipboard.map((o) => ({
      ...(JSON.parse(JSON.stringify(o)) as DesignObject),
      id: idMap.get(o.id) as string,
      parentId: o.parentId && clipIds.has(o.parentId) ? (idMap.get(o.parentId) as string) : null,
    }));
    // Offset only top-level clones so groups keep internal layout.
    const cloneIds = new Set(clones.map((c) => c.id));
    for (const c of clones) {
      if (!c.parentId || !cloneIds.has(c.parentId)) {
        c.x += 24;
        c.y += 24;
      }
      c.name = c.name || defaultName(c.type, pg.objects);
    }
    insertObjects(clones, clones.filter((c) => !c.parentId || !cloneIds.has(c.parentId)).map((c) => c.id));
  }, [clipboard, history.present, insertObjects]);

  const undo = useCallback(() => {
    transientRef.current = false;
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    transientRef.current = false;
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const [next, ...rest] = h.future;
      return { past: [...h.past, h.present], present: next, future: rest };
    });
  }, []);

  const replaceDoc = useCallback(
    (next: UndesignDoc) => {
      applyDoc(() => next, true);
      setSelectedIds([]);
    },
    [applyDoc],
  );

  const resetSample = useCallback(() => {
    replaceDoc(createSampleDoc());
  }, [replaceDoc]);

  const newBlankDoc = useCallback(() => {
    replaceDoc(createBlankDoc());
  }, [replaceDoc]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const selected = useMemo(() => {
    const idSet = new Set(selectedIds);
    return page.objects.filter((o) => idSet.has(o.id));
  }, [page.objects, selectedIds]);

  const value: EditorContextValue = {
    doc,
    page,
    selectedIds,
    selected,
    tool,
    viewport,
    gridVisible,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    notice,
    dismissNotice,
    setTool,
    setViewport,
    zoomAt,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomFit,
    toggleGrid,
    select,
    clearSelection,
    selectAll,
    setDocName,
    addPage,
    selectPage,
    renamePage,
    deletePage,
    addObject,
    insertObjects,
    updateObjects,
    beginTransient,
    transientUpdate,
    endTransient,
    moveSelected,
    deleteSelected,
    deleteObjects,
    duplicateSelected,
    renameObject,
    toggleVisibility,
    toggleLock,
    reorder,
    moveObject,
    align,
    distribute,
    copySelected,
    cutSelected,
    paste,
    hasClipboard: clipboard.length > 0,
    undo,
    redo,
    replaceDoc,
    resetSample,
    newBlankDoc,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

/** Children lookup helper re-exported for components. */
export { childrenOf };
