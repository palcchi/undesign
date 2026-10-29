import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Component,
  Eye,
  EyeOff,
  Files,
  Frame,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Minus,
  Pen,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { FONT_STACKS, useEditor } from '../store';
import type { DesignObject } from '../types';
import { childrenOf, isHexColor, normalizeHex, rootsOf, uid } from '../utils';
import { creationBlockers, liveSource } from '../library';
import { canHaveEffectStyle, canHaveFillStyle, canHaveTextStyle } from '../system';
import { ContextMenu, useContextMenu, useEnterEscape, useNativePickerEnd } from './ui';

type Tab = 'layers' | 'assets' | 'pages';

function TypeIcon({ type, size = 13 }: { type: DesignObject['type']; size?: number }) {
  switch (type) {
    case 'frame':
      return <Frame size={size} />;
    case 'rectangle':
      return <Square size={size} />;
    case 'ellipse':
      return <Circle size={size} />;
    case 'text':
      return <Type size={size} />;
    case 'line':
      return <Minus size={size} />;
    case 'image':
      return <ImageIcon size={size} />;
  }
}

export function LeftSidebar() {
  const [tab, setTab] = useState<Tab>('layers');
  return (
    <div className="sidebar left">
      <div className="sidebar-tabs" role="tablist">
        <button
          className={`sidebar-tab${tab === 'layers' ? ' active' : ''}`}
          role="tab"
          aria-selected={tab === 'layers'}
          onClick={() => setTab('layers')}
        >
          <Layers size={14} />
          <span>Layers</span>
        </button>
        <button
          className={`sidebar-tab${tab === 'assets' ? ' active' : ''}`}
          role="tab"
          aria-selected={tab === 'assets'}
          onClick={() => setTab('assets')}
        >
          <Component size={14} />
          <span>Assets</span>
        </button>
        <button
          className={`sidebar-tab${tab === 'pages' ? ' active' : ''}`}
          role="tab"
          aria-selected={tab === 'pages'}
          onClick={() => setTab('pages')}
        >
          <Files size={14} />
          <span>Pages</span>
        </button>
      </div>
      <div className="sidebar-body">
        {tab === 'layers' && <LayersPanel />}
        {tab === 'assets' && <AssetsPanel />}
        {tab === 'pages' && <PagesPanel />}
      </div>
    </div>
  );
}

/* ================= Layers ================= */

type DropPos = 'before' | 'after' | 'inside' | null;

function LayersPanel() {
  const {
    page, selectedIds, select, renameObject, toggleVisibility, toggleLock,
    deleteObjects, duplicateSelected, copySelected, cutSelected, paste,
    hasClipboard, reorder, moveObject, selectAll,
    groupSelected, ungroupSelected, createComponentFromSelected, detachSelectedInstance,
  } = useEditor();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: DropPos }>({ id: '', pos: null });
  const { menu, open, close } = useContextMenu();
  const listRef = useRef<HTMLDivElement>(null);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(page.objects.filter((o) => o.name.toLowerCase().includes(q)).map((o) => o.id));
  }, [page.objects, query]);

  const rows = useMemo(() => {
    const out: { obj: DesignObject; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const kids = childrenOf(page.objects, parentId).slice().reverse();
      for (const k of kids) {
        if (filtered && !filtered.has(k.id)) {
          // Still show matching descendants of non-matching frames.
          if (k.type === 'frame') {
            const hasMatch = page.objects.some(
              (o) => filtered.has(o.id) && isDescendant(page.objects, k.id, o.id),
            );
            if (!hasMatch) continue;
          } else continue;
        }
        out.push({ obj: k, depth });
        if (k.type === 'frame' && !collapsed.has(k.id)) walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [page.objects, collapsed, filtered]);

  const commitRename = () => {
    if (editingId) renameObject(editingId, draft);
    setEditingId(null);
  };
  const renameKeys = useEnterEscape(commitRename, () => setEditingId(null));

  const openRowMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(id)) select([id]);
    const obj = page.objects.find((o) => o.id === id);
    open(e.clientX, e.clientY, [
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: cutSelected },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: copySelected },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !hasClipboard, onSelect: paste },
      { divider: true },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: duplicateSelected },
      { label: 'Rename', onSelect: () => { setEditingId(id); setDraft(obj?.name ?? ''); } },
      { label: obj?.visible ? 'Hide' : 'Show', onSelect: () => toggleVisibility(id) },
      { label: obj?.locked ? 'Unlock' : 'Lock', onSelect: () => toggleLock(id) },
      { divider: true },
      { label: 'Bring forward', shortcut: 'Ctrl+]', onSelect: () => reorder(id, 'up') },
      { label: 'Send backward', shortcut: 'Ctrl+[', onSelect: () => reorder(id, 'down') },
      { label: 'Bring to front', onSelect: () => reorder(id, 'top') },
      { label: 'Send to back', onSelect: () => reorder(id, 'bottom') },
      { divider: true },
      { label: 'Group selection', shortcut: 'Ctrl+G', onSelect: groupSelected },
      ...(obj?.type === 'frame'
        ? [{ label: 'Ungroup selection', shortcut: 'Ctrl+Shift+G', onSelect: ungroupSelected }]
        : []),
      { divider: true },
      {
        label: 'Create component',
        shortcut: 'Ctrl+Alt+K',
        disabled: creationBlockers(page.objects, selectedIds.includes(id) ? selectedIds : [id]) !== null,
        onSelect: createComponentFromSelected,
      },
      ...(obj?.componentId
        ? [{
          label: 'Detach instance',
          disabled: (selectedIds.includes(id) ? selectedIds : [id]).length !== 1,
          onSelect: detachSelectedInstance,
        }]
        : []),
      { divider: true },
      { label: 'Delete', shortcut: 'Del', danger: true, onSelect: () => deleteObjects(selectedIds.includes(id) ? selectedIds : [id]) },
    ]);
  };

  const siblingIndex = (id: string): { parentId: string | null; index: number } => {
    const obj = page.objects.find((o) => o.id === id);
    if (!obj) return { parentId: null, index: 0 };
    const siblings = childrenOf(page.objects, obj.parentId);
    return { parentId: obj.parentId, index: siblings.findIndex((s) => s.id === id) };
  };

  const handleDrop = (targetId: string | null) => {
    if (!dragId) return;
    if (!targetId) {
      const roots = childrenOf(page.objects, null);
      moveObject(dragId, null, roots.length);
    } else if (dropTarget.pos === 'inside') {
      const kids = childrenOf(page.objects, targetId);
      moveObject(dragId, targetId, kids.length);
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    } else if (dropTarget.pos) {
      const { parentId, index } = siblingIndex(targetId);
      const from = siblingIndex(dragId);
      let idx = dropTarget.pos === 'after' ? index + 1 : index;
      if (from.parentId === parentId && from.index < idx) idx -= 1;
      moveObject(dragId, parentId, idx);
    }
    setDragId(null);
    setDropTarget({ id: '', pos: null });
  };

  return (
    <div className="layers-panel">
      <div className="layers-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search layers"
          aria-label="Search layers"
        />
      </div>
      <div
        ref={listRef}
        className="layers-list"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('layers-list')) {
            e.preventDefault();
            open(e.clientX, e.clientY, [
              { label: 'Select all', shortcut: 'Ctrl+A', onSelect: selectAll },
              { label: 'Paste', shortcut: 'Ctrl+V', disabled: !hasClipboard, onSelect: paste },
            ]);
          }
        }}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if ((e.target as HTMLElement).classList.contains('layers-list')) {
            e.preventDefault();
            handleDrop(null);
          }
        }}
      >
        {rows.length === 0 && (
          <div className="empty-note">
            {page.objects.length === 0 ? (
              <>
                <p>No layers yet.</p>
                <p className="dim">Press R for rectangle, T for text, F for frame.</p>
              </>
            ) : (
              <p className="dim">No layers match “{query}”.</p>
            )}
          </div>
        )}
        {rows.map(({ obj, depth }) => {
          const kids = childrenOf(page.objects, obj.id);
          const hasKids = kids.length > 0;
          const isCollapsed = collapsed.has(obj.id);
          const selected = selectedIds.includes(obj.id);
          const dropPos = dropTarget.id === obj.id ? dropTarget.pos : null;
          return (
            <div
              key={obj.id}
              className={`layer-row${selected ? ' selected' : ''}${dropPos === 'before' ? ' drop-before' : ''}${dropPos === 'after' ? ' drop-after' : ''}${dropPos === 'inside' ? ' drop-inside' : ''}${!obj.visible ? ' hidden-obj' : ''}`}
              style={{ paddingLeft: 6 + depth * 16 }}
              draggable={editingId !== obj.id}
              onDragStart={(e) => {
                e.stopPropagation();
                setDragId(obj.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget({ id: '', pos: null });
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === obj.id) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientY - rect.top) / rect.height;
                const pos: DropPos =
                  ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : obj.type === 'frame' ? 'inside' : ratio < 0.5 ? 'before' : 'after';
                setDropTarget({ id: obj.id, pos });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDrop(obj.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                select([obj.id], e.shiftKey || e.metaKey || e.ctrlKey);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(obj.id);
                setDraft(obj.name);
              }}
              onContextMenu={(e) => openRowMenu(e, obj.id)}
            >
              <span
                className={`collapse-btn${hasKids ? '' : ' invisible'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(obj.id);
                }}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </span>
              <span className="layer-type">
                {obj.componentId ? <Component size={13} /> : <TypeIcon type={obj.type} />}
              </span>
              {editingId === obj.id ? (
                <input
                  className="layer-rename"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  {...renameKeys}
                  onFocus={(e) => e.target.select()}
                  aria-label="Layer name"
                />
              ) : (
                <span className="layer-name" title={obj.name}>
                  {obj.name}
                </span>
              )}
              <span className="layer-actions">
                <button
                  className={`mini-btn${obj.locked ? ' on' : ''}`}
                  title={obj.locked ? 'Unlock' : 'Lock'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLock(obj.id);
                  }}
                >
                  {obj.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
                <button
                  className="mini-btn"
                  title={obj.visible ? 'Hide' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVisibility(obj.id);
                  }}
                >
                  {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

function isDescendant(objects: DesignObject[], ancestorId: string, id: string): boolean {
  let current = objects.find((o) => o.id === id);
  let guard = 0;
  while (current?.parentId && guard < 100) {
    if (current.parentId === ancestorId) return true;
    current = objects.find((o) => o.id === current?.parentId);
    guard += 1;
  }
  return false;
}

/* ================= Pages ================= */

function PagesPanel() {
  const { doc, selectPage, addPage, renamePage, deletePage } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const { menu, open, close } = useContextMenu();

  const commit = () => {
    if (editingId) renamePage(editingId, draft);
    setEditingId(null);
  };
  const keys = useEnterEscape(commit, () => setEditingId(null));

  return (
    <div className="pages-panel">
      <button className="btn secondary full" onClick={addPage}>
        <Plus size={14} />
        <span>Add page</span>
      </button>
      <div className="pages-list">
        {doc.pages.map((p, i) => (
          <div
            key={p.id}
            className={`page-row${p.id === doc.activePageId ? ' active' : ''}`}
            onClick={() => selectPage(p.id)}
            onDoubleClick={() => {
              setEditingId(p.id);
              setDraft(p.name);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              open(e.clientX, e.clientY, [
                { label: 'Rename', onSelect: () => { setEditingId(p.id); setDraft(p.name); } },
                { label: 'Delete', danger: true, disabled: doc.pages.length === 1 && p.objects.length === 0, onSelect: () => deletePage(p.id) },
              ]);
            }}
          >
            <span className="page-index">{i + 1}</span>
            {editingId === p.id ? (
              <input
                className="layer-rename"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                {...keys}
                onFocus={(e) => e.target.select()}
                aria-label="Page name"
              />
            ) : (
              <span className="page-name" title={p.name}>
                {p.name}
              </span>
            )}
            <span className="page-count">{p.objects.length}</span>
            {doc.pages.length > 1 && (
              <button
                className="mini-btn danger-hover"
                title="Delete page"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePage(p.id);
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

/* ================= Assets ================= */

const COLOR_STYLES = [
  { name: 'Ink', value: '#111111' },
  { name: 'Charcoal', value: '#3A3A3A' },
  { name: 'Gray', value: '#8A8A8A' },
  { name: 'Mist', value: '#D9D9D9' },
  { name: 'Paper', value: '#F4F4F2' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Accent', value: '#FF4D00' },
  { name: 'Moss', value: '#1F5C3D' },
];

const TEXT_STYLES = [
  { name: 'Display', fontSize: 64, fontWeight: 700, fontStack: 0 },
  { name: 'Heading', fontSize: 36, fontWeight: 600, fontStack: 0 },
  { name: 'Body', fontSize: 16, fontWeight: 400, fontStack: 0 },
  { name: 'Caption', fontSize: 12, fontWeight: 500, fontStack: 2 },
  { name: 'Serif quote', fontSize: 24, fontWeight: 400, fontStack: 1 },
];

function assetObjects(kind: string): DesignObject[] {
  const frameId = uid('obj');
  const mk = (partial: Partial<DesignObject> & Pick<DesignObject, 'id' | 'type'>): DesignObject => ({
    name: 'Layer', parentId: null, x: 0, y: 0, w: 100, h: 40, rotation: 0,
    visible: true, locked: false, opacity: 1, fill: '', fillOpacity: 1, fillGradient: null,
    fillStyleId: null, textStyleId: null, shadow: null, effectStyleId: null, constraints: null,
    layout: null, sizing: null,
    stroke: '', strokeWidth: 0, cornerRadius: 0, cornerRadii: null, clip: false, text: '',
    fontFamily: FONT_STACKS[0].value, fontSize: 14, fontWeight: 400,
    textAlign: 'left', lineHeight: 1.4, componentId: null, sourceId: null,
    componentSnapshot: null, variant: null, exposedValues: null, imageId: null, imageName: '', naturalW: 0, naturalH: 0, ...partial,
  });
  switch (kind) {
    case 'button':
      return [
        mk({ id: frameId, type: 'frame', name: 'Button / Primary', w: 168, h: 48, fill: '#111111', cornerRadius: 24, clip: true }),
        mk({ id: uid('obj'), type: 'text', name: 'Label', parentId: frameId, x: 0, y: 13, w: 168, h: 22, text: 'Button', fontSize: 14, fontWeight: 600, fill: '#FFFFFF', textAlign: 'center' }),
      ];
    case 'card':
      return [
        mk({ id: frameId, type: 'frame', name: 'Card', w: 264, h: 220, fill: '#FFFFFF', stroke: '#D9D9D9', strokeWidth: 1, cornerRadius: 12, clip: true }),
        mk({ id: uid('obj'), type: 'rectangle', name: 'Cover', parentId: frameId, x: 16, y: 16, w: 232, h: 104, fill: '#E9E9E7', cornerRadius: 8 }),
        mk({ id: uid('obj'), type: 'text', name: 'Title', parentId: frameId, x: 16, y: 132, w: 232, h: 24, text: 'Card title', fontSize: 16, fontWeight: 600, fill: '#111111' }),
        mk({ id: uid('obj'), type: 'text', name: 'Body', parentId: frameId, x: 16, y: 158, w: 232, h: 44, text: 'A short supporting line of body copy.', fontSize: 13, fill: '#555555', lineHeight: 1.5 }),
      ];
    case 'avatar':
      return [mk({ id: frameId, type: 'ellipse', name: 'Avatar', w: 56, h: 56, fill: '#3A3A3A' })];
    case 'badge':
      return [
        mk({ id: frameId, type: 'frame', name: 'Badge', w: 92, h: 30, fill: '#FF4D00', cornerRadius: 15, clip: true }),
        mk({ id: uid('obj'), type: 'text', name: 'Label', parentId: frameId, x: 0, y: 6, w: 92, h: 18, text: 'NEW', fontSize: 12, fontWeight: 700, fill: '#FFFFFF', textAlign: 'center' }),
      ];
    default:
      return [];
  }
}

function LibrarySection() {
  const {
    doc, page, selectedIds, createComponentFromSelected, insertComponentInstance,
    deleteComponent, renameComponent, gotoComponentSource, combineVariantsFromSelected,
    insertSetInstance, deleteVariantSet, renameVariantSet,
  } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const defs = doc.components ?? [];
  const sets = doc.variantSets ?? [];
  const blocker = creationBlockers(page.objects, selectedIds);
  const tops = rootsOf(page.objects.filter((o) => selectedIds.includes(o.id)));
  const counts = new Map<string, number>();
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if (o.componentId) counts.set(o.componentId, (counts.get(o.componentId) ?? 0) + 1);
    }
  }
  const commitRename = (id: string) => {
    if (editingId === id) renameComponent(id, draft);
    setEditingId(null);
  };
  const commitRenameSet = (id: string) => {
    if (editingSetId === id) renameVariantSet(id, draft);
    setEditingSetId(null);
  };
  const renameSetKeys = (id: string) => ({
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRenameSet(id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setEditingSetId(null);
      }
    },
  });
  const renameKeys = (id: string) => ({
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename(id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setEditingId(null);
      }
    },
  });

  return (
    <div className="asset-section">
      <h3>Library</h3>
      <p className="dim small">Reusable components. Edit a source — every instance updates.</p>
      <button
        className="btn secondary full"
        disabled={blocker !== null}
        title={
          blocker === 'empty'
            ? 'Select objects on the canvas first'
            : blocker === 'nested'
              ? 'Select the whole instance instead of its parts'
              : undefined
        }
        onClick={createComponentFromSelected}
      >
        <Plus size={14} />
        <span>New component from selection</span>
      </button>
      <button
        className="btn secondary full"
        disabled={blocker !== null || tops.length < 2}
        title={
          blocker === 'nested'
            ? 'Select the whole instance instead of its parts'
            : tops.length < 2
              ? 'Select two or more objects to combine'
              : undefined
        }
        onClick={combineVariantsFromSelected}
      >
        <Layers size={14} />
        <span>Combine as variants</span>
      </button>
      {defs.length === 0 ? (
        <p className="dim small comp-empty">No components yet.</p>
      ) : (
        <div className="comp-list">
          {defs.map((def) => {
            const missing = liveSource(doc, def) === null;
            const n = counts.get(def.id) ?? 0;
            return (
              <div className="comp-row" key={def.id}>
                <span className="layer-type">
                  <Component size={13} />
                </span>
                <span className="comp-main">
                  {editingId === def.id ? (
                    <input
                      className="layer-rename"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(def.id)}
                      onFocus={(e) => e.target.select()}
                      {...renameKeys(def.id)}
                      aria-label="Component name"
                    />
                  ) : (
                    <span
                      className="comp-name"
                      title="Double-click to rename"
                      onDoubleClick={() => {
                        setEditingId(def.id);
                        setDraft(def.name);
                      }}
                    >
                      {def.name}
                    </span>
                  )}
                  <span className="dim small">
                    {missing ? 'Source missing' : `${n} instance${n === 1 ? '' : 's'}`}
                  </span>
                </span>
                <span className="comp-actions">
                  <button
                    className="mini-btn"
                    title={missing ? 'Source missing' : 'Insert instance at canvas center'}
                    disabled={missing}
                    onClick={() => insertComponentInstance(def.id)}
                    aria-label={`Insert ${def.name}`}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    className="mini-btn"
                    title={missing ? 'Source missing' : 'Go to source'}
                    disabled={missing}
                    onClick={() => gotoComponentSource(def.id)}
                    aria-label={`Edit ${def.name} source`}
                  >
                    <Pen size={13} />
                  </button>
                  <button
                    className="mini-btn danger-hover"
                    title="Delete component (instances become plain objects)"
                    onClick={() => deleteComponent(def.id)}
                    aria-label={`Delete ${def.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {sets.length > 0 && (
        <div className="comp-list">
          {sets.map((s) => {
            const missing = s.variants.some((v) => (doc.components ?? []).find((d) => d.id === v) === undefined);
            return (
              <div className="comp-row" key={s.id}>
                <span className="layer-type">
                  <Layers size={13} />
                </span>
                <span className="comp-main">
                  {editingSetId === s.id ? (
                    <input
                      className="layer-rename"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRenameSet(s.id)}
                      onFocus={(e) => e.target.select()}
                      {...renameSetKeys(s.id)}
                      aria-label="Variant set name"
                    />
                  ) : (
                    <span
                      className="comp-name"
                      title="Double-click to rename"
                      onDoubleClick={() => {
                        setEditingSetId(s.id);
                        setDraft(s.name);
                      }}
                    >
                      {s.name}
                    </span>
                  )}
                  <span className="dim small">
                    {missing ? 'Variant missing' : `${s.variants.length} variant${s.variants.length === 1 ? '' : 's'}`}
                  </span>
                </span>
                <span className="comp-actions">
                  <button
                    className="mini-btn"
                    title={missing ? 'Variant missing' : 'Insert default variant at canvas center'}
                    disabled={missing}
                    onClick={() => insertSetInstance(s.id)}
                    aria-label={`Insert ${s.name}`}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    className="mini-btn danger-hover"
                    title="Delete set (member components are kept)"
                    onClick={() => deleteVariantSet(s.id)}
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StyleSwatch({ styleId, color }: { styleId: string; color: string }) {
  const { transientUpdate, endTransient } = useEditor();
  const ref = useRef<HTMLInputElement>(null);
  useNativePickerEnd(ref);
  return (
    <label className="swatch-input small" title={color} onClick={(e) => e.stopPropagation()}>
      <span className="swatch-input-color" style={{ background: color }} />
      <input
        ref={ref}
        type="color"
        value={isHexColor(color) ? normalizeHex(color, '#111111') : '#111111'}
        onChange={(e) => {
          const next = normalizeHex(e.target.value, '#111111');
          transientUpdate((d) => ({
            ...d,
            colorStyles: (d.colorStyles ?? []).map((s) => (s.id === styleId ? { ...s, color: next } : s)),
          }));
        }}
        onBlur={() => endTransient()}
        aria-label="Style color"
      />
    </label>
  );
}

function ColorStylesManager() {
  const {
    doc, selected, createColorStyle, applyColorStyle,
    renameColorStyle, deleteColorStyle,
  } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const styles = doc.colorStyles ?? [];
  const canCreate = selected.some((s) => canHaveFillStyle(s.type));
  const counts = new Map<string, number>();
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if (o.fillStyleId) counts.set(o.fillStyleId, (counts.get(o.fillStyleId) ?? 0) + 1);
    }
  }
  const commitRename = (id: string) => {
    if (editingId === id) renameColorStyle(id, draft);
    setEditingId(null);
  };
  const keys = useEnterEscape(
    () => {
      if (editingId) commitRename(editingId);
    },
    () => setEditingId(null),
  );

  return (
    <div className="style-manager">
      <button
        className="btn secondary full"
        disabled={!canCreate}
        title={canCreate ? 'Create a shared style from the selection' : 'Select a shape or text first'}
        onClick={createColorStyle}
      >
        <Plus size={14} />
        <span>New style from selection</span>
      </button>
      {styles.length > 0 && (
        <div className="comp-list">
          {styles.map((s) => {
            const n = counts.get(s.id) ?? 0;
            return (
              <div
                className="comp-row style-row"
                key={s.id}
                role="button"
                tabIndex={0}
                title={canCreate ? 'Apply to selection' : 'Select a shape or text to apply'}
                onClick={() => applyColorStyle(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyColorStyle(s.id);
                }}
              >
                <StyleSwatch styleId={s.id} color={s.color} />
                <span className="comp-main">
                  {editingId === s.id ? (
                    <input
                      className="layer-rename"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(s.id)}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // Don't let Enter also trigger the row's apply action.
                        if (e.key === 'Enter') e.stopPropagation();
                        keys.onKeyDown(e);
                      }}
                      aria-label="Style name"
                    />
                  ) : (
                    <span
                      className="comp-name"
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                        setDraft(s.name);
                      }}
                    >
                      {s.name}
                    </span>
                  )}
                  <span className="dim small">{`${n} linked`}</span>
                </span>
                <span className="comp-actions">
                  <button
                    className="mini-btn danger-hover"
                    title="Delete style (fills keep their colors)"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteColorStyle(s.id);
                    }}
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TextStylesManager() {
  const {
    doc, selected, createTextStyle, applyTextStyle,
    updateTextStyle, renameTextStyle, deleteTextStyle,
  } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const styles = doc.textStyles ?? [];
  const canCreate = selected.some((s) => canHaveTextStyle(s.type));
  const counts = new Map<string, number>();
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if (o.textStyleId) counts.set(o.textStyleId, (counts.get(o.textStyleId) ?? 0) + 1);
    }
  }
  const commitRename = (id: string) => {
    if (editingId === id) renameTextStyle(id, draft);
    setEditingId(null);
  };
  const keys = useEnterEscape(
    () => {
      if (editingId) commitRename(editingId);
    },
    () => setEditingId(null),
  );

  return (
    <div className="style-manager">
      <button
        className="btn secondary full"
        disabled={!canCreate}
        title={canCreate ? 'Create a shared style from the selection' : 'Select a text layer first'}
        onClick={createTextStyle}
      >
        <Plus size={14} />
        <span>New style from selection</span>
      </button>
      {styles.length > 0 && (
        <div className="comp-list">
          {styles.map((s) => {
            const n = counts.get(s.id) ?? 0;
            return (
              <div
                className="comp-row style-row"
                key={s.id}
                role="button"
                tabIndex={0}
                title={canCreate ? 'Apply to selection' : 'Select a text layer to apply'}
                onClick={() => applyTextStyle(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyTextStyle(s.id);
                }}
              >
                <span
                  className="text-style-sample"
                  style={{
                    fontFamily: s.fontFamily,
                    fontWeight: s.fontWeight,
                    fontSize: Math.min(s.fontSize, 22),
                  }}
                  aria-hidden="true"
                >
                  Ag
                </span>
                <span className="comp-main">
                  {editingId === s.id ? (
                    <input
                      className="layer-rename"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(s.id)}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // Don't let Enter also trigger the row's apply action.
                        if (e.key === 'Enter') e.stopPropagation();
                        keys.onKeyDown(e);
                      }}
                      aria-label="Text style name"
                    />
                  ) : (
                    <span
                      className="comp-name"
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                        setDraft(s.name);
                      }}
                    >
                      {s.name}
                    </span>
                  )}
                  <span className="dim small">{`${n} linked`}</span>
                </span>
                <span className="comp-actions">
                  <button
                    className="mini-btn"
                    disabled={!canCreate}
                    title={canCreate ? 'Update style from selection' : 'Select a text layer first'}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTextStyle(s.id);
                    }}
                    aria-label={`Update ${s.name} from selection`}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    className="mini-btn danger-hover"
                    title="Delete style (text keeps its formatting)"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteTextStyle(s.id);
                    }}
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EffectStylesManager() {
  const {
    doc, selected, createEffectStyle, applyEffectStyle,
    updateEffectStyle, renameEffectStyle, deleteEffectStyle,
  } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const styles = doc.effectStyles ?? [];
  const canCreate = selected.some((s) => canHaveEffectStyle(s.type));
  const counts = new Map<string, number>();
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if (o.effectStyleId) counts.set(o.effectStyleId, (counts.get(o.effectStyleId) ?? 0) + 1);
    }
  }
  const commitRename = (id: string) => {
    if (editingId === id) renameEffectStyle(id, draft);
    setEditingId(null);
  };
  const keys = useEnterEscape(
    () => {
      if (editingId) commitRename(editingId);
    },
    () => setEditingId(null),
  );

  return (
    <div className="style-manager">
      <button
        className="btn secondary full"
        disabled={!canCreate}
        title={canCreate ? 'Create a shared style from the selection' : 'Select an object first'}
        onClick={createEffectStyle}
      >
        <Plus size={14} />
        <span>New style from selection</span>
      </button>
      {styles.length > 0 && (
        <div className="comp-list">
          {styles.map((s) => {
            const n = counts.get(s.id) ?? 0;
            const sh = s.shadow;
            return (
              <div
                className="comp-row style-row"
                key={s.id}
                role="button"
                tabIndex={0}
                title={canCreate ? 'Apply to selection' : 'Select an object to apply'}
                onClick={() => applyEffectStyle(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyEffectStyle(s.id);
                }}
              >
                <span
                  className="swatch-color"
                  style={{ background: '#FFFFFF', boxShadow: `${sh.offsetX}px ${sh.offsetY}px ${sh.blur}px ${sh.spread ?? 0}px ${sh.color}` }}
                  aria-hidden="true"
                />
                <span className="comp-main">
                  {editingId === s.id ? (
                    <input
                      className="layer-rename"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(s.id)}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // Don't let Enter also trigger the row's apply action.
                        if (e.key === 'Enter') e.stopPropagation();
                        keys.onKeyDown(e);
                      }}
                      aria-label="Effect style name"
                    />
                  ) : (
                    <span
                      className="comp-name"
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                        setDraft(s.name);
                      }}
                    >
                      {s.name}
                    </span>
                  )}
                  <span className="dim small">{`${n} linked`}</span>
                </span>
                <span className="comp-actions">
                  <button
                    className="mini-btn"
                    disabled={!canCreate}
                    title={canCreate ? 'Update style from selection' : 'Select an object first'}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateEffectStyle(s.id);
                    }}
                    aria-label={`Update ${s.name} from selection`}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    className="mini-btn danger-hover"
                    title="Delete style (shadows keep their values)"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteEffectStyle(s.id);
                    }}
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssetsPanel() {
  const { insertAtCenter, selected, updateObjects } = useEditor();
  const selectedIds = selected.map((s) => s.id);
  const hasTextSelected = selected.some((s) => s.type === 'text');

  return (
    <div className="assets-panel">
      <LibrarySection />
      <div className="asset-section">
        <h3>Components</h3>
        <p className="dim small">Click to insert at the canvas center.</p>
        <div className="asset-grid">
          <button className="asset-card" onClick={() => insertAtCenter(assetObjects('button'))}>
            <span className="asset-preview"><span className="pv-btn">Button</span></span>
            <span className="asset-name">Button / Primary</span>
          </button>
          <button className="asset-card" onClick={() => insertAtCenter(assetObjects('card'))}>
            <span className="asset-preview"><span className="pv-card"><span className="pv-cover" /><span className="pv-line" /><span className="pv-line short" /></span></span>
            <span className="asset-name">Card</span>
          </button>
          <button className="asset-card" onClick={() => insertAtCenter(assetObjects('avatar'))}>
            <span className="asset-preview"><span className="pv-avatar" /></span>
            <span className="asset-name">Avatar</span>
          </button>
          <button className="asset-card" onClick={() => insertAtCenter(assetObjects('badge'))}>
            <span className="asset-preview"><span className="pv-badge">NEW</span></span>
            <span className="asset-name">Badge</span>
          </button>
        </div>
      </div>
      <div className="asset-section">
        <h3>Color styles</h3>
        <ColorStylesManager />
        <p className="dim small comp-empty">Quick colors apply a plain fill.</p>
        <p className="dim small">
          {selected.length > 0 ? 'Click to apply fill to the selection.' : 'Select an object to apply a fill.'}
        </p>
        <div className="swatch-grid">
          {COLOR_STYLES.map((c) => (
            <button
              key={c.name}
              className="swatch"
              title={`${c.name} ${c.value}`}
              disabled={selected.length === 0}
              onClick={() => updateObjects(selectedIds, { fill: c.value, fillStyleId: null })}
            >
              <span className="swatch-color" style={{ background: c.value }} />
              <span className="swatch-name">{c.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="asset-section">
        <h3>Text styles</h3>
        <TextStylesManager />
        <p className="dim small">
          {hasTextSelected ? 'Click to apply to selected text.' : 'Select a text layer to apply a style.'}
        </p>
        <div className="text-style-list">
          {TEXT_STYLES.map((t) => (
            <button
              key={t.name}
              className="text-style-row"
              disabled={!hasTextSelected}
              onClick={() =>
                updateObjects(
                  selected.filter((s) => s.type === 'text').map((s) => s.id),
                  { fontSize: t.fontSize, fontWeight: t.fontWeight, fontFamily: FONT_STACKS[t.fontStack].value, textStyleId: null },
                )
              }
            >
              <span
                className="text-style-sample"
                style={{
                  fontFamily: FONT_STACKS[t.fontStack].value,
                  fontWeight: t.fontWeight,
                  fontSize: Math.min(t.fontSize, 22),
                }}
              >
                Ag
              </span>
              <span className="text-style-meta">
                <span className="text-style-name">{t.name}</span>
                <span className="dim small">{t.fontSize}px · {t.fontWeight}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="asset-section">
        <h3>Effect styles</h3>
        <EffectStylesManager />
      </div>
    </div>
  );
}
