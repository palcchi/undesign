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
  ZOOM_MAX,
  ZOOM_MIN,
  centeredOrigin,
  childrenOf,
  clamp,
  defaultName,
  descendantIds,
  fitViewport,
  getPage,
  groupObjects,
  pageBounds,
  placeRootsAtCenter,
  reparentLocal,
  rootsOf,
  selectionBounds,
  uid,
  ungroupObjects,
  viewportCenterWorld,
  zoomAtPoint,
  zoomCentered,
} from './utils';
import { createBlankDoc, createSampleDoc } from './sample';
import { loadStoredDoc, saveStoredDoc } from './storage';
import {
  decodeImageSize,
  deleteAsset,
  docImageIds,
  fitImageSize,
  historyImageIds,
  layerNameFromFile,
  newAssetId,
  putAsset,
  resolveAssetDataUrl,
  validateImageFile,
} from './assets';
import {
  buildInstance,
  createComponent,
  creationBlockers,
  detachComponents,
  detachInstance,
  isExpansion,
  isInstanceRoot,
  regenInstances,
  remapClonedInstances,
  resetInstance,
} from './library';
import { propagateConstraints } from './layout';
import { canHaveFillStyle, propagateStyles } from './system';
import { pruneLinks, setOutgoingLink } from './prototype';
import { aiSelectionPatch, buildAiObjects, summarizeAiPlan } from './ai';
import type { AiEditOp } from './ai';
import {
  abortTransientEntry,
  beginTransientEntry,
  commitDoc,
  endTransientEntry,
  redoHistory,
  setPresent,
  undoHistory,
} from './history';
import type { HistoryState } from './history';
import {
  transformedBounds,
  translateLocalByPageDelta,
} from './transform';

export const FONT_STACKS = [
  { label: 'Sans', value: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
];

/** Delete candidates referenced by no history state (undo can never need them). */
function pruneCandidates(states: UndesignDoc[], candidates: string[]): void {
  if (candidates.length === 0) return;
  const live = historyImageIds(states);
  for (const id of candidates) {
    if (!live.has(id)) void deleteAsset(id);
  }
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

/** Pure object patch used by both committed and transient updates. */
export function patchDocObjects(
  doc: UndesignDoc,
  ids: string[],
  patch: ObjectPatch,
): UndesignDoc {
  const idSet = new Set(ids);
  return withActivePage(doc, (p) => ({
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
  }));
}

/**
 * Pure deletion plan: expansion children locked inside a component instance
 * can never be deleted directly (detach first); everything else takes its
 * whole subtree with it. Unknown ids are harmless no-ops downstream.
 */
export function planObjectDeletion(
  objects: DesignObject[],
  ids: string[],
): { allowed: string[]; locked: string[]; doomed: Set<string> } {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const locked = ids.filter((id) => {
    const o = byId.get(id);
    return o !== undefined && isExpansion(o);
  });
  const lockedSet = new Set(locked);
  const allowed = ids.filter((id) => !lockedSet.has(id));
  const doomed = new Set<string>();
  for (const id of allowed) {
    doomed.add(id);
    for (const child of descendantIds(objects, id)) doomed.add(child);
  }
  return { allowed, locked, doomed };
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
  snapObjects: boolean;
  snapGrid: boolean;
  canUndo: boolean;
  canRedo: boolean;
  notice: string | null;
  dismissNotice: () => void;

  setTool: (tool: Tool) => void;
  setViewport: (viewport: Viewport) => void;
  setCanvasSize: (w: number, h: number) => void;
  zoomAt: (screenX: number, screenY: number, zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomTo: (zoom: number) => void;
  zoomFit: (containerW: number, containerH: number) => void;
  zoomFitSelection: (containerW: number, containerH: number) => void;
  toggleGrid: () => void;
  toggleSnapObjects: () => void;
  toggleSnapGrid: () => void;

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
    commit?: boolean,
  ) => string;
  insertObjects: (objects: DesignObject[], selectIds?: string[], commit?: boolean) => void;
  insertAtCenter: (objects: DesignObject[]) => void;
  updateObjects: (ids: string[], patch: ObjectPatch) => void;
  transientPatchObjects: (ids: string[], patch: ObjectPatch) => void;
  beginTransient: () => void;
  transientUpdate: (fn: (doc: UndesignDoc) => UndesignDoc) => void;
  endTransient: () => void;
  abortTransient: () => void;
  moveSelected: (dx: number, dy: number) => void;
  deleteSelected: () => void;
  deleteObjects: (ids: string[]) => void;
  duplicateSelected: () => void;
  renameObject: (id: string, name: string) => void;
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  reorder: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  moveObject: (id: string, targetParentId: string | null, index: number) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  createComponentFromSelected: () => void;
  insertComponentInstance: (compId: string) => void;
  detachSelectedInstance: () => void;
  resetSelectedInstance: () => void;
  deleteComponent: (compId: string) => void;
  renameComponent: (compId: string, name: string) => void;
  gotoComponentSource: (compId: string) => void;
  createColorStyle: () => void;
  applyColorStyle: (styleId: string) => void;
  renameColorStyle: (styleId: string, name: string) => void;
  deleteColorStyle: (styleId: string) => void;
  detachFillStyle: () => void;
  setPrototypeLink: (sourceId: string, targetFrameId: string | null) => void;
  applyAiOps: (ops: AiEditOp[]) => void;
  align: (kind: AlignKind) => void;
  distribute: (kind: DistributeKind) => void;

  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  hasClipboard: boolean;
  importImageFiles: (files: FileList | File[]) => void;
  replaceImage: (id: string, file: File) => void;

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
  const historyRef = useRef(history);
  historyRef.current = history;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [viewport, setViewportState] = useState<Viewport>({ zoom: 0.6, x: 48, y: 40 });
  const [canvasSize, setCanvasSizeState] = useState({ w: 1280, h: 800 });
  const [gridVisible, setGridVisible] = useState(true);
  const [snapObjects, setSnapObjects] = useState(true);
  const [snapGrid, setSnapGrid] = useState(true);
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
        // Component, layout, and style propagation ride every commit and
        // transient tick so derived updates share one history step. Each
        // pass is a ref-preserving no-op when it has nothing to do.
        const withInstances = regenInstances(next);
        const withLayout = propagateConstraints(h.present, withInstances);
        const withStyles = propagateStyles(h.present, withLayout);
        return commit ? commitDoc(h, withStyles) : setPresent(h, withStyles);
      });
    },
    [],
  );

  const beginTransient = useCallback(() => {
    if (transientRef.current) return;
    transientRef.current = true;
    setHistory(beginTransientEntry);
  }, []);

  const transientUpdate = useCallback(
    (fn: (d: UndesignDoc) => UndesignDoc) => {
      if (!transientRef.current) beginTransient();
      applyDoc(fn, false);
    },
    [applyDoc, beginTransient],
  );

  const endTransient = useCallback(() => {
    if (!transientRef.current) return;
    transientRef.current = false;
    // Untouched sessions (no tick since begin) pop their begin snapshot so
    // a click without a drag never leaves a phantom undo step.
    setHistory(endTransientEntry);
  }, []);

  const abortTransient = useCallback(() => {
    if (!transientRef.current) return;
    transientRef.current = false;
    setHistory(abortTransientEntry);
  }, []);

  const setViewport = useCallback((v: Viewport) => {
    setViewportState({ zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX), x: v.x, y: v.y });
  }, []);

  const setCanvasSize = useCallback((w: number, h: number) => {
    setCanvasSizeState((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  const zoomAt = useCallback(
    (sx: number, sy: number, zoom: number) => {
      setViewportState((v) => zoomAtPoint(v, sx, sy, zoom));
    },
    [],
  );

  const zoomIn = useCallback(() => {
    setViewportState((v) => zoomCentered(v, canvasSize.w, canvasSize.h, v.zoom * 1.25));
  }, [canvasSize]);
  const zoomOut = useCallback(() => {
    setViewportState((v) => zoomCentered(v, canvasSize.w, canvasSize.h, v.zoom / 1.25));
  }, [canvasSize]);
  const zoomReset = useCallback(() => {
    setViewportState((v) => zoomCentered(v, canvasSize.w, canvasSize.h, 1));
  }, [canvasSize]);
  const zoomTo = useCallback(
    (zoom: number) => {
      setViewportState((v) => zoomCentered(v, canvasSize.w, canvasSize.h, zoom));
    },
    [canvasSize],
  );

  const zoomFit = useCallback(
    (containerW: number, containerH: number) => {
      const bounds = pageBounds(page.objects.filter((o) => o.parentId === null));
      setViewportState(fitViewport(bounds, containerW, containerH));
    },
    [page],
  );

  const zoomFitSelection = useCallback(
    (containerW: number, containerH: number) => {
      const bounds = selectionBounds(page.objects, selectedIds);
      if (!bounds) return;
      setViewportState(fitViewport(bounds, containerW, containerH));
    },
    [page, selectedIds],
  );

  const toggleGrid = useCallback(() => setGridVisible((g) => !g), []);
  const toggleSnapObjects = useCallback(() => setSnapObjects((s) => !s), []);
  const toggleSnapGrid = useCallback(() => setSnapGrid((s) => !s), []);

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
      const single = history.present.pages.length === 1;
      const gone: string[] = [];
      for (const p of history.present.pages) {
        if (single || p.id === id) {
          for (const o of p.objects) {
            if (o.imageId) gone.push(o.imageId);
          }
        }
      }
      const doomedDefs = (history.present.components ?? [])
        .filter((c) => single || c.pageId === id)
        .map((c) => c.id);
      applyDoc((d) => {
        if (!d.pages.some((p) => p.id === id)) return d;
        let next: UndesignDoc;
        if (d.pages.length === 1) {
          const fresh = createBlankDoc();
          next = { ...d, pages: fresh.pages, activePageId: fresh.pages[0].id };
        } else {
          const idx = d.pages.findIndex((p) => p.id === id);
          const pages = d.pages.filter((p) => p.id !== id);
          const activePageId =
            d.activePageId === id ? pages[Math.max(0, idx - 1)].id : d.activePageId;
          next = { ...d, pages, activePageId };
        }
        // Sources live on pages: dropping their page detaches all instances.
        if (doomedDefs.length > 0) next = detachComponents(next, doomedDefs);
        const links = pruneLinks(next.pages, next.prototypeLinks ?? []);
        if (links !== next.prototypeLinks) next = { ...next, prototypeLinks: links };
        return next;
      }, true);
      setSelectedIds([]);
      if (doomedDefs.length > 0) {
        setNotice(
          doomedDefs.length === 1
            ? 'Page deleted — its component was detached into plain objects.'
            : `Page deleted — ${doomedDefs.length} components were detached into plain objects.`,
        );
      }
      const nextPages = single
        ? createBlankDoc().pages
        : history.present.pages.filter((p) => p.id !== id);
      pruneCandidates(
        [...history.past, ...history.future, { ...history.present, pages: nextPages }],
        gone,
      );
    },
    [applyDoc, history],
  );

  const insertObjects = useCallback(
    (objects: DesignObject[], selectIds?: string[], commit = true) => {
      applyDoc(
        (d) =>
          withActivePage(d, (p) => ({
            ...p,
            objects: [...p.objects, ...objects],
          })),
        commit,
      );
      // Default selection is roots only; explicit lists (duplicate/paste
      // multi-select) pass through untouched.
      setSelectedIds(selectIds ?? rootsOf(objects).map((o) => o.id));
    },
    [applyDoc],
  );

  const insertAtCenter = useCallback(
    (objects: DesignObject[]) => {
      if (objects.length === 0) return;
      const center = viewportCenterWorld(viewport, canvasSize.w, canvasSize.h);
      insertObjects(placeRootsAtCenter(objects, center));
    },
    [viewport, canvasSize, insertObjects],
  );

  const addObject = useCallback(
    (
      type: ObjectType,
      init?: Partial<DesignObject> & { x?: number; y?: number; w?: number; h?: number },
      commit = true,
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
          case 'image':
            return { w: 320, h: 240 };
        }
      })();
      const center = viewportCenterWorld(viewport, canvasSize.w, canvasSize.h);
      const origin = centeredOrigin(
        init?.w ?? defaults.w ?? 100,
        init?.h ?? defaults.h ?? 100,
        center,
      );
      const obj: DesignObject = {
        name: defaultName(type, pageNow.objects),
        parentId: null,
        x: origin.x,
        y: origin.y,
        w: 100,
        h: 100,
        rotation: 0,
        visible: true,
        locked: false,
        opacity: 1,
        fill: '',
        fillOpacity: 1,
        fillGradient: null,
        fillStyleId: null,
        constraints: null,
        stroke: '',
        strokeWidth: 0,
        cornerRadius: 0,
        cornerRadii: null,
        componentId: null,
        sourceId: null,
        componentSnapshot: null,
        imageId: null,
        imageName: '',
        naturalW: 0,
        naturalH: 0,
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
      insertObjects([obj], [id], commit);
      return id;
    },
    [history.present, insertObjects, viewport, canvasSize],
  );

  const updateObjects = useCallback(
    (ids: string[], patch: ObjectPatch) => {
      if (ids.length === 0) return;
      applyDoc((d) => patchDocObjects(d, ids, patch), true);
    },
    [applyDoc],
  );

  const transientPatchObjects = useCallback(
    (ids: string[], patch: ObjectPatch) => {
      if (ids.length === 0) return;
      transientUpdate((d) => patchDocObjects(d, ids, patch));
    },
    [transientUpdate],
  );

  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      if (selectedIds.length === 0) return;
      const idSet = new Set(selectedIds);
      applyDoc(
        (d) =>
          withActivePage(d, (p) => {
            // Top-most only: moving a frame already moves its children.
            const topIds = new Set(
              rootsOf(p.objects.filter((o) => idSet.has(o.id))).map((o) => o.id),
            );
            return {
              ...p,
              objects: p.objects.map((o) => {
                if (!topIds.has(o.id) || o.locked) return o;
                const nl = translateLocalByPageDelta(p.objects, o, dx, dy);
                return { ...o, x: Math.round(nl.x), y: Math.round(nl.y) };
              }),
            };
          }),
        true,
      );
    },
    [applyDoc, selectedIds],
  );

  const deleteObjects = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const pg = getPage(history.present);
      const { allowed, locked, doomed } = planObjectDeletion(pg.objects, ids);
      if (locked.length > 0) {
        setNotice(
          allowed.length === 0
            ? 'Objects inside an instance are structure-locked — detach the instance first.'
            : `Skipped ${locked.length} object(s) locked inside an instance.`,
        );
      }
      if (allowed.length === 0) return;
      const gone = pg.objects.filter((o) => doomed.has(o.id) && o.imageId).map((o) => o.imageId as string);
      const survivors = pg.objects.filter((o) => !doomed.has(o.id));
      applyDoc((d) => {
        const dp = getPage(d);
        // Replan from the allowed ids only: locked expansions stay untouched.
        const { doomed: ddoomed } = planObjectDeletion(dp.objects, allowed);
        const cut = withActivePage(d, (p) => ({
          ...p,
          objects: p.objects.filter((o) => !ddoomed.has(o.id)),
        }));
        const links = pruneLinks(cut.pages, cut.prototypeLinks ?? []);
        return links === cut.prototypeLinks ? cut : { ...cut, prototypeLinks: links };
      }, true);
      setSelectedIds((prev) => prev.filter((id) => !allowed.includes(id)));
      const nextPresent: UndesignDoc = {
        ...history.present,
        pages: history.present.pages.map((p) => (p.id === pg.id ? { ...p, objects: survivors } : p)),
      };
      pruneCandidates([...history.past, ...history.future, nextPresent], gone);
    },
    [applyDoc, history],
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
    const fixed = remapClonedInstances(clones, () => uid('obj'));
    const fixedIds = new Set(fixed.map((c) => c.id));
    insertObjects(
      fixed,
      fixed.filter((c) => !c.parentId || !fixedIds.has(c.parentId)).map((c) => c.id),
    );
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
      const target = getPage(history.present).objects.find((o) => o.id === id);
      if (target && isExpansion(target)) {
        setNotice('Instance contents keep source order — detach first.');
        return;
      }
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
    [applyDoc, history.present],
  );

  const moveObject = useCallback(
    (id: string, targetParentId: string | null, index: number) => {
      const pg = getPage(history.present);
      const obj = pg.objects.find((o) => o.id === id);
      if (obj && isExpansion(obj)) {
        setNotice('Objects inside an instance cannot be moved — detach first.');
        return;
      }
      if (targetParentId !== null) {
        const seen = new Set<string>();
        let t = pg.objects.find((o) => o.id === targetParentId);
        while (t !== undefined && !seen.has(t.id)) {
          if (isInstanceRoot(t)) {
            setNotice('Cannot move objects into an instance.');
            return;
          }
          seen.add(t.id);
          t = t.parentId ? pg.objects.find((o) => o.id === (t as DesignObject).parentId) : undefined;
        }
      }
      applyDoc((d) => {
        const pg = getPage(d);
        const obj = pg.objects.find((o) => o.id === id);
        if (!obj) return d;
        if (id === targetParentId) return d;
        if (targetParentId && descendantIds(pg.objects, id).includes(targetParentId)) return d;
        const target = targetParentId ? pg.objects.find((o) => o.id === targetParentId) : null;
        if (targetParentId && (!target || target.type !== 'frame')) return d;
        // Shared reparent math: the object keeps its exact visual transform.
        const local = reparentLocal(pg.objects, obj, targetParentId);
        const moved: DesignObject = {
          ...obj,
          parentId: local.parentId,
          x: local.x,
          y: local.y,
          rotation: local.rotation,
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
    [applyDoc, history.present],
  );

  const importImageFiles = useCallback(
    (input: FileList | File[]) => {
      const files = [...input].filter(
        (f): f is File => !!f && typeof (f as File).name === 'string',
      );
      if (files.length === 0) return;
      void (async () => {
        const pageNow = getPage(history.present);
        const center = viewportCenterWorld(viewport, canvasSize.w, canvasSize.h);
        const placed: DesignObject[] = [];
        let n = pageNow.objects.filter((o) => o.type === 'image').length;
        for (const file of files) {
          const problem = validateImageFile(file);
          if (problem) {
            setNotice(problem);
            continue;
          }
          const size = await decodeImageSize(file);
          if (!size) {
            setNotice(`Could not decode “${file.name}”.`);
            continue;
          }
          const assetId = newAssetId();
          await putAsset(assetId, file);
          await resolveAssetDataUrl(assetId);
          const { w, h } = fitImageSize(size.w, size.h);
          n += 1;
          const origin = centeredOrigin(w, h, center);
          const cascade = placed.length * 24;
          placed.push({
            id: uid('obj'),
            type: 'image',
            name: layerNameFromFile(file.name, n),
            parentId: null,
            x: origin.x + cascade,
            y: origin.y + cascade,
            w,
            h,
            rotation: 0,
            visible: true,
            locked: false,
            opacity: 1,
            fill: '',
            fillOpacity: 1,
            fillGradient: null,
            fillStyleId: null,
            constraints: null,
            stroke: '',
            strokeWidth: 0,
            cornerRadius: 0,
            cornerRadii: null,
            componentId: null,
            sourceId: null,
            componentSnapshot: null,
            imageId: assetId,
            imageName: file.name,
            naturalW: size.w,
            naturalH: size.h,
            clip: false,
            text: '',
            fontFamily: FONT_STACKS[0].value,
            fontSize: 16,
            fontWeight: 400,
            textAlign: 'left',
            lineHeight: 1.4,
          });
        }
        // One undo step for the whole batch.
        if (placed.length > 0) insertObjects(placed);
      })();
    },
    [history.present, viewport, canvasSize, insertObjects],
  );

  const replaceImage = useCallback(
    (id: string, file: File) => {
      const obj = getPage(history.present).objects.find((o) => o.id === id);
      if (!obj || obj.type !== 'image') return;
      const problem = validateImageFile(file);
      if (problem) {
        setNotice(problem);
        return;
      }
      void (async () => {
        const size = await decodeImageSize(file);
        if (!size) {
          setNotice(`Could not decode “${file.name}”.`);
          return;
        }
        const assetId = newAssetId();
        await putAsset(assetId, file);
        await resolveAssetDataUrl(assetId);
        const h = historyRef.current;
        const target = getPage(h.present).objects.find((o) => o.id === id);
        if (!target || target.type !== 'image') {
          // Target vanished mid-flight: drop the staged asset, change nothing.
          await deleteAsset(assetId);
          return;
        }
        const oldId = target.imageId;
        const { w, h: nh } = fitImageSize(size.w, size.h);
        updateObjects([id], {
          imageId: assetId,
          imageName: file.name,
          naturalW: size.w,
          naturalH: size.h,
          w,
          h: nh,
        });
        if (oldId && oldId !== assetId) {
          const pg = getPage(h.present);
          const nextPresent: UndesignDoc = {
            ...h.present,
            pages: h.present.pages.map((p) =>
              p.id === pg.id
                ? { ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, imageId: assetId } : o)) }
                : p,
            ),
          };
          pruneCandidates([...h.past, ...h.future, nextPresent], [oldId]);
        }
      })();
    },
    [history, updateObjects],
  );

  const groupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const objs = getPage(history.present).objects;
    if (selectedIds.some((sid) => {
      const o = objs.find((x) => x.id === sid);
      return o !== undefined && isExpansion(o);
    })) {
      setNotice('Detach the instance before grouping its contents.');
      return;
    }
    const id = uid('obj');
    if (!groupObjects(getPage(history.present).objects, selectedIds, id)) return;
    applyDoc((d) => {
      const pg = getPage(d);
      const next = groupObjects(pg.objects, selectedIds, id);
      if (!next) return d;
      return withActivePage(d, (p) => ({ ...p, objects: next }));
    }, true);
    setSelectedIds([id]);
  }, [applyDoc, history.present, selectedIds]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const objs = getPage(history.present).objects;
    if (selectedIds.some((sid) => {
      const o = objs.find((x) => x.id === sid);
      return o !== undefined && isInstanceRoot(o);
    })) {
      setNotice('Detach the instance instead of ungrouping it.');
      return;
    }
    const res = ungroupObjects(objs, selectedIds);
    if (!res) return;
    applyDoc((d) => {
      const pg = getPage(d);
      const r = ungroupObjects(pg.objects, selectedIds);
      if (!r) return d;
      return withActivePage(d, (p) => ({ ...p, objects: r.objects }));
    }, true);
    setSelectedIds(res.selectedIds);
  }, [applyDoc, history.present, selectedIds]);

  const createComponentFromSelected = useCallback(() => {
    const pg = getPage(history.present);
    const blocker = creationBlockers(pg.objects, selectedIds);
    if (blocker === 'empty') return;
    if (blocker === 'nested') {
      setNotice('Components cannot nest — detach instances first.');
      return;
    }
    const defs = history.present.components ?? [];
    const name = `Component ${defs.length + 1}`;
    const pack = {
      compId: uid('comp'),
      componentsPageId: defs[0]?.pageId ?? uid('page'),
      sourceRootId: uid('obj'),
      instanceId: uid('obj'),
      cloneId: () => uid('obj'),
    };
    const res = createComponent(history.present, pg.id, selectedIds, name, pack);
    if ('error' in res) return;
    applyDoc(() => res.doc, true);
    setSelectedIds([pack.instanceId]);
    setNotice(`Component “${name}” created — the selection is now an instance.`);
  }, [applyDoc, history.present, selectedIds]);

  const insertComponentInstance = useCallback(
    (compId: string) => {
      const built = buildInstance(history.present, compId, uid('obj'));
      if (!built) {
        setNotice('That component has no editable source.');
        return;
      }
      insertAtCenter([built.root, ...built.children]);
    },
    [history.present, insertAtCenter],
  );

  const detachSelectedInstance = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    if (!detachInstance(getPage(history.present).objects, id)) return;
    applyDoc(
      (d) => withActivePage(d, (p) => ({ ...p, objects: detachInstance(p.objects, id) ?? p.objects })),
      true,
    );
  }, [applyDoc, history.present, selectedIds]);

  const resetSelectedInstance = useCallback(() => {
    if (selectedIds.length !== 1) return;
    if (resetInstance(history.present, selectedIds[0]) === history.present) return;
    applyDoc(() => resetInstance(history.present, selectedIds[0]), true);
  }, [applyDoc, history.present, selectedIds]);

  const deleteComponent = useCallback(
    (compId: string) => {
      const defs = history.present.components ?? [];
      const def = defs.find((d) => d.id === compId);
      if (!def) return;
      const count = history.present.pages
        .flatMap((p) => p.objects)
        .filter((o) => o.componentId === compId).length;
      applyDoc((d) => detachComponents(d, [compId]), true);
      setNotice(
        count === 0
          ? `Component “${def.name}” deleted.`
          : `Component “${def.name}” deleted — ${count} instance(s) detached.`,
      );
    },
    [applyDoc, history.present],
  );

  const renameComponent = useCallback(
    (compId: string, name: string) => {
      const clean = name.trim() || 'Component';
      const def = (history.present.components ?? []).find((d) => d.id === compId);
      if (!def || def.name === clean) return;
      applyDoc(
        (d) => ({
          ...d,
          components: (d.components ?? []).map((c) => (c.id === compId ? { ...c, name: clean } : c)),
        }),
        true,
      );
    },
    [applyDoc, history.present],
  );

  const gotoComponentSource = useCallback(
    (compId: string) => {
      const def = (history.present.components ?? []).find((d) => d.id === compId);
      if (!def) return;
      selectPage(def.pageId);
      select([def.rootId]);
    },
    [history.present, selectPage, select],
  );

  const styleTargets = (ids: string[]): DesignObject[] =>
    getPage(history.present).objects.filter((o) => ids.includes(o.id) && canHaveFillStyle(o.type));

  const createColorStyle = useCallback(() => {
    const targets = styleTargets(selectedIds);
    if (targets.length === 0) return;
    const color = targets[0].fill !== '' ? targets[0].fill : '#111111';
    const styles = history.present.colorStyles ?? [];
    const id = uid('style');
    const name = `Style ${styles.length + 1}`;
    applyDoc((d) => {
      const withStyle: UndesignDoc = {
        ...d,
        colorStyles: [...(d.colorStyles ?? []), { id, name, color }],
      };
      return patchDocObjects(
        withStyle,
        targets.map((t) => t.id),
        { fill: color, fillStyleId: id },
      );
    }, true);
    setNotice(`Style “${name}” created and applied.`);
  }, [applyDoc, history.present, selectedIds]);

  const applyColorStyle = useCallback(
    (styleId: string) => {
      const style = (history.present.colorStyles ?? []).find((s) => s.id === styleId);
      const targets = style ? styleTargets(selectedIds) : [];
      if (!style || targets.length === 0) return;
      updateObjects(
        targets.map((t) => t.id),
        { fill: style.color, fillStyleId: styleId },
      );
    },
    [history.present, selectedIds, updateObjects],
  );

  const renameColorStyle = useCallback(
    (styleId: string, name: string) => {
      const clean = name.trim() || 'Style';
      const style = (history.present.colorStyles ?? []).find((s) => s.id === styleId);
      if (!style || style.name === clean) return;
      applyDoc(
        (d) => ({
          ...d,
          colorStyles: (d.colorStyles ?? []).map((s) => (s.id === styleId ? { ...s, name: clean } : s)),
        }),
        true,
      );
    },
    [applyDoc, history.present],
  );

  const deleteColorStyle = useCallback(
    (styleId: string) => {
      const style = (history.present.colorStyles ?? []).find((s) => s.id === styleId);
      if (!style) return;
      applyDoc((d) => {
        const noStyle: UndesignDoc = {
          ...d,
          colorStyles: (d.colorStyles ?? []).filter((s) => s.id !== styleId),
        };
        const linked = d.pages
          .flatMap((p) => p.objects)
          .filter((o) => o.fillStyleId === styleId)
          .map((o) => o.id);
        return linked.length === 0 ? noStyle : patchDocObjects(noStyle, linked, { fillStyleId: null });
      }, true);
      setNotice(`Style “${style.name}” deleted — fills kept their colors.`);
    },
    [applyDoc, history.present],
  );

  const detachFillStyle = useCallback(() => {
    const linked = styleTargets(selectedIds).filter((o) => o.fillStyleId !== null);
    if (linked.length === 0) return;
    updateObjects(
      linked.map((o) => o.id),
      { fillStyleId: null },
    );
  }, [history.present, selectedIds, updateObjects]);

  const setPrototypeLink = useCallback(
    (sourceId: string, targetFrameId: string | null) => {
      if (targetFrameId !== null) {
        const target = history.present.pages
          .flatMap((p) => p.objects)
          .find((o) => o.id === targetFrameId);
        if (!target || target.type !== 'frame') return;
      }
      applyDoc((d) => {
        const links = setOutgoingLink(d.prototypeLinks ?? [], sourceId, targetFrameId, () => uid('link'));
        if (links === d.prototypeLinks) return d;
        return { ...d, prototypeLinks: links };
      }, true);
    },
    [applyDoc, history.present],
  );

  const applyAiOps = useCallback(
    (ops: AiEditOp[]) => {
      if (ops.length === 0) return;
      const center = viewportCenterWorld(viewport, canvasSize.w, canvasSize.h);
      const placed = placeRootsAtCenter(buildAiObjects(ops, () => uid('obj')), center);
      const patch = aiSelectionPatch(ops);
      const editable = patch && selectedIds.length > 0 ? patch : null;
      if (placed.length === 0 && !editable) {
        setNotice('That plan only edits the selection — select objects first, or ask for new ones.');
        return;
      }
      applyDoc((d) => {
        const withAdds =
          placed.length === 0
            ? d
            : withActivePage(d, (p) => ({ ...p, objects: [...p.objects, ...placed] }));
        return editable ? patchDocObjects(withAdds, selectedIds, editable) : withAdds;
      }, true);
      if (placed.length > 0) setSelectedIds(rootsOf(placed).map((o) => o.id));
      const droppedEdits = patch !== null && selectedIds.length === 0;
      setNotice(
        droppedEdits
          ? `AI plan applied (${summarizeAiPlan(ops)}); selection edits skipped — nothing was selected.`
          : `AI plan applied: ${summarizeAiPlan(ops)}. Undo reverts it in one step.`,
      );
    },
    [applyDoc, viewport, canvasSize, selectedIds],
  );

  const align = useCallback(
    (kind: AlignKind) => {
      if (selectedIds.length < 2) return;
      applyDoc((d) => {
        const pg = getPage(d);
        const idSet = new Set(selectedIds);
        const items = pg.objects.filter((o) => idSet.has(o.id));
        if (items.length < 2) return d;
        const abs = items.map((o) => ({ o, b: transformedBounds(pg.objects, o) }));
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const { b } of abs) {
          minX = Math.min(minX, b.x);
          maxX = Math.max(maxX, b.x + b.w);
          minY = Math.min(minY, b.y);
          maxY = Math.max(maxY, b.y + b.h);
        }
        const moved = new Map<string, { x: number; y: number }>();
        for (const { o, b } of abs) {
          let tbx = b.x;
          let tby = b.y;
          if (kind === 'left') tbx = minX;
          else if (kind === 'right') tbx = maxX - b.w;
          else if (kind === 'centerX') tbx = (minX + maxX) / 2 - b.w / 2;
          else if (kind === 'top') tby = minY;
          else if (kind === 'bottom') tby = maxY - b.h;
          else if (kind === 'centerY') tby = (minY + maxY) / 2 - b.h / 2;
          const nl = translateLocalByPageDelta(pg.objects, o, tbx - b.x, tby - b.y);
          moved.set(o.id, { x: Math.round(nl.x), y: Math.round(nl.y) });
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
        const abs = items.map((o) => ({ o, b: transformedBounds(pg.objects, o) }));
        const horizontal = kind === 'horizontal';
        abs.sort((a, b) =>
          horizontal ? a.b.x + a.b.w / 2 - (b.b.x + b.b.w / 2) : a.b.y + a.b.h / 2 - (b.b.y + b.b.h / 2),
        );
        const first = horizontal ? abs[0].b.x + abs[0].b.w / 2 : abs[0].b.y + abs[0].b.h / 2;
        const last = horizontal
          ? abs[abs.length - 1].b.x + abs[abs.length - 1].b.w / 2
          : abs[abs.length - 1].b.y + abs[abs.length - 1].b.h / 2;
        const step = (last - first) / (abs.length - 1);
        const moved = new Map<string, { x: number; y: number }>();
        abs.forEach(({ o, b }, i) => {
          const center = first + step * i;
          const tbx = horizontal ? center - b.w / 2 : b.x;
          const tby = horizontal ? b.y : center - b.h / 2;
          const nl = translateLocalByPageDelta(pg.objects, o, tbx - b.x, tby - b.y);
          moved.set(o.id, { x: Math.round(nl.x), y: Math.round(nl.y) });
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
    const raw = clipboard.map((o) => ({
      ...(JSON.parse(JSON.stringify(o)) as DesignObject),
      id: idMap.get(o.id) as string,
      parentId: o.parentId && clipIds.has(o.parentId) ? (idMap.get(o.parentId) as string) : null,
    }));
    const clones = remapClonedInstances(raw, () => uid('obj'));
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
    // Undo mid-session (e.g. Ctrl+Z during a drag) first discards the
    // uncommitted session so its snapshot never pollutes the redo stack,
    // then undoes the last confirmed entry.
    abortTransient();
    setHistory(undoHistory);
  }, [abortTransient]);

  const redo = useCallback(() => {
    abortTransient();
    setHistory(redoHistory);
  }, [abortTransient]);

  const replaceDoc = useCallback(
    (next: UndesignDoc) => {
      const gone = docImageIds(history.present);
      applyDoc(() => next, true);
      setSelectedIds([]);
      // Redo is cleared by the commit, so only past + next can need assets.
      pruneCandidates([...history.past, next], gone);
    },
    [applyDoc, history],
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
    snapObjects,
    snapGrid,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    notice,
    dismissNotice,
    setTool,
    setViewport,
    setCanvasSize,
    zoomAt,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomTo,
    zoomFit,
    zoomFitSelection,
    toggleGrid,
    toggleSnapObjects,
    toggleSnapGrid,
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
    insertAtCenter,
    updateObjects,
    transientPatchObjects,
    beginTransient,
    transientUpdate,
    endTransient,
    abortTransient,
    moveSelected,
    deleteSelected,
    deleteObjects,
    duplicateSelected,
    renameObject,
    toggleVisibility,
    toggleLock,
    reorder,
    moveObject,
    groupSelected,
    ungroupSelected,
    createComponentFromSelected,
    insertComponentInstance,
    detachSelectedInstance,
    resetSelectedInstance,
    deleteComponent,
    renameComponent,
    gotoComponentSource,
    createColorStyle,
    applyColorStyle,
    renameColorStyle,
    deleteColorStyle,
    detachFillStyle,
    setPrototypeLink,
    applyAiOps,
    align,
    distribute,
    copySelected,
    cutSelected,
    paste,
    hasClipboard: clipboard.length > 0,
    importImageFiles,
    replaceImage,
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
