/**
 * Engine-driven left sidebar: Layers, Pages, and Assets over the live engine
 * snapshot. Layer rows support select, expand, rename, visibility/lock, and
 * drag reorder/reparent; page rows support select, add, rename, duplicate,
 * delete, and move-selection-here; the Assets tab lists engine shared styles
 * and components with create/apply/insert actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
  Component,
  Copy,
  Eye,
  EyeOff,
  FilePlus,
  Frame,
  Group,
  Layers,
  Lock,
  LockOpen,
  Minus,
  MoveRight,
  Plus,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { useEngine } from '../engine/store';
import { adjustedReorderIndex, dropIndex, flattenTree, subtreeIds, type FlatRow } from '../engine/tree';
import { findChain } from '../engine/geometry';
import type { EngineNode } from '../engine/adapter';

function TypeIcon({ type }: { type: string }) {
  const size = 13;
  switch (type) {
    case 'FRAME':
      return <Frame size={size} />;
    case 'GROUP':
      return <Group size={size} />;
    case 'RECTANGLE':
      return <Square size={size} />;
    case 'ELLIPSE':
      return <Circle size={size} />;
    case 'TEXT':
      return <Type size={size} />;
    case 'LINE':
      return <Minus size={size} />;
    case 'COMPONENT':
      return <Component size={size} />;
    case 'COMPONENT_SET':
      return <Layers size={size} />;
    case 'INSTANCE':
      return <Copy size={size} />;
    default:
      return <Box size={size} />;
  }
}

type DropPos = { targetId: number; pos: 'before' | 'after' | 'inside' } | null;

export function EngineSidebar() {
  const ed = useEngine();
  const [tab, setTab] = useState<'layers' | 'pages' | 'assets'>('layers');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [editingPage, setEditingPage] = useState<number | null>(null);
  const [pageDraft, setPageDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [drop, setDrop] = useState<DropPos>(null);
  const dragIds = useRef<number[]>([]);
  const dragActive = useRef(false);
  const justDragged = useRef(false);

  const rows = useMemo(() => {
    if (!ed.snapshot.tree) return [];
    const all = flattenTree(ed.snapshot.tree, expanded);
    const q = filter.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((r) => r.node.name.toLowerCase().includes(q) || r.node.type.toLowerCase().includes(q));
  }, [ed.snapshot.tree, expanded, filter]);

  // Follow canvas selection: expand ancestors of the new selection and
  // bring the first selected row into view (manual collapse still wins
  // until the next selection change).
  useEffect(() => {
    const tree = ed.snapshot.tree;
    if (!tree || ed.snapshot.selection.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ed.snapshot.selection) {
        const chain = findChain(tree, id) ?? [];
        for (const n of chain) {
          if (n.id !== id) next.add(n.id);
        }
      }
      return next;
    });
    const first = ed.snapshot.selection[0];
    // Rows render after the expand above; scroll once they exist.
    window.setTimeout(() => {
      document.querySelector(`[data-layer-row="${first}"]`)?.scrollIntoView({ block: 'nearest' });
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.snapshot.selection]);

  // Releasing outside the list cancels the drag (commits happen in-list).
  useEffect(() => {
    const cancel = () => {
      dragIds.current = [];
      dragActive.current = false;
      setDrop(null);
    };
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitRename = (id: number) => {
    if (draft.trim() !== '') ed.renameNode(id, draft.trim());
    setEditingId(null);
  };

  const commitPageRename = (id: number) => {
    if (pageDraft.trim() !== '') ed.renamePage(id, pageDraft.trim());
    setEditingPage(null);
  };

  // ---- layer drag reorder / reparent ----
  const onRowPointerDown = (e: React.PointerEvent, row: FlatRow) => {
    if (e.button !== 0 || ed.status !== 'ready') return;
    justDragged.current = false;
    dragIds.current = ed.snapshot.selection.includes(row.node.id) ? [...ed.snapshot.selection] : [row.node.id];
    dragActive.current = false;
    // No pointer capture: moves are resolved through elementFromPoint so
    // hovering any row updates the drop indicator.
  };

  const onRowPointerMove = (e: React.PointerEvent, row: FlatRow) => {
    if (dragIds.current.length === 0 || e.buttons === 0 || filter.trim() !== '') {
      if (filter.trim() !== '') setDrop(null);
      return;
    }
    if (!dragActive.current) {
      dragActive.current = true;
      if (!ed.snapshot.selection.includes(row.node.id)) ed.select(dragIds.current);
    }
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const el = under?.closest?.('[data-layer-row]') as HTMLElement | null;
    if (!el) {
      setDrop(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
    const targetId = Number(el.dataset.layerRow);
    const target = ed.snapshot.byId.get(targetId);
    if (!target) {
      setDrop(null);
      return;
    }
    // Never drop into the dragged subtree itself.
    if (ed.snapshot.tree && dragIds.current.some((id) => subtreeIds(ed.snapshot.tree!, id).has(targetId))) {
      setDrop(null);
      return;
    }
    if ((target.type === 'FRAME' || target.type === 'GROUP') && ratio > 0.3 && ratio < 0.7) {
      setDrop({ targetId, pos: 'inside' });
    } else {
      setDrop({ targetId, pos: ratio <= 0.5 ? 'before' : 'after' });
    }
  };

  const onRowPointerUp = () => {
    const ids = dragIds.current;
    const d = drop;
    dragIds.current = [];
    setDrop(null);
    if (!dragActive.current) return;
    dragActive.current = false;
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 0);
    if (!d || ids.length === 0 || !ed.snapshot.tree) return;
    const target = ed.snapshot.byId.get(d.targetId);
    if (!target) return;
    if (d.pos === 'inside') {
      ed.reparentNodes(ids, d.targetId, target.children.length);
      setExpanded((prev) => new Set(prev).add(d.targetId));
      return;
    }
    // Sibling drop: find the target's parent and display position.
    const flat = flattenTree(ed.snapshot.tree, new Set(ed.snapshot.byId.keys()));
    const siblings = flat.filter((r) => r.parentId === (parentOf(d.targetId) ?? -1));
    const rowIdx = siblings.findIndex((r) => r.node.id === d.targetId);
    if (rowIdx < 0) return;
    const parentId = parentOf(d.targetId);
    if (parentId === null || parentId === undefined) return;
    let idx = dropIndex(siblings.length, rowIdx, d.pos);
    const sameParent = ids.length === 1 && parentOf(ids[0]) === parentId;
    if (sameParent) {
      const from = siblings.findIndex((r) => r.node.id === ids[0]);
      idx = adjustedReorderIndex(from, idx);
      if (idx === from) return;
      ed.reorderNode(ids[0], idx);
    } else {
      ed.reparentNodes(ids, parentId, idx);
    }
  };

  const parentOf = (id: number): number | null => {
    if (!ed.snapshot.tree) return null;
    const walk = (n: EngineNode): number | null => {
      for (const c of n.children) {
        if (c.id === id) return n.id;
        const r = walk(c);
        if (r !== null) return r;
      }
      return null;
    };
    return walk(ed.snapshot.tree);
  };

  return (
    <div className="sidebar left">
      <div className="sidebar-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'layers'} className={`sidebar-tab${tab === 'layers' ? ' active' : ''}`} onClick={() => setTab('layers')}>
          Layers
        </button>
        <button role="tab" aria-selected={tab === 'pages'} className={`sidebar-tab${tab === 'pages' ? ' active' : ''}`} onClick={() => setTab('pages')}>
          Pages
        </button>
        <button role="tab" aria-selected={tab === 'assets'} className={`sidebar-tab${tab === 'assets' ? ' active' : ''}`} onClick={() => setTab('assets')}>
          Assets
        </button>
      </div>

      {tab === 'layers' && (
        <div className="sidebar-body">
          <input
            className="text-input"
            placeholder="Filter layers"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter layers"
          />
          <div className="layer-list" onPointerUp={onRowPointerUp}>
            {rows.length === 0 && <p className="dim small">No layers on this page yet.</p>}
            {rows.map((row) => {
              const n = row.node;
              const selected = ed.snapshot.selection.includes(n.id);
              const isOpen = expanded.has(n.id);
              const hasKids = n.children.length > 0;
              const dropCls = drop && drop.targetId === n.id ? ` drop-${drop.pos}` : '';
              return (
                <div
                  key={n.id}
                  data-layer-row={n.id}
                  className={`layer-row${selected ? ' selected' : ''}${dropCls}`}
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                  onClick={(e) => {
                    if (justDragged.current) return;
                    e.stopPropagation();
                    ed.select([n.id], e.shiftKey);
                  }}
                  onDoubleClick={() => {
                    setEditingId(n.id);
                    setDraft(n.name);
                  }}
                  onPointerDown={(e) => onRowPointerDown(e, row)}
                  onPointerMove={(e) => onRowPointerMove(e, row)}
                >
                  <span
                    className="layer-chevron"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasKids) toggleExpand(n.id);
                    }}
                  >
                    {hasKids ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
                  </span>
                  <span className="layer-icon" style={{ opacity: n.visible ? 1 : 0.4 }}>
                    <TypeIcon type={n.type} />
                  </span>
                  {editingId === n.id ? (
                    <input
                      className="text-input layer-rename"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(n.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(n.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="layer-name" style={{ opacity: n.visible ? 1 : 0.55 }}>{n.name}</span>
                  )}
                  <span className="layer-actions">
                    <button
                      className="mini-btn"
                      title={n.locked ? 'Unlock' : 'Lock'}
                      onClick={(e) => {
                        e.stopPropagation();
                        ed.toggleLock(n.id);
                      }}
                    >
                      {n.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                    </button>
                    <button
                      className="mini-btn"
                      title={n.visible ? 'Hide' : 'Show'}
                      onClick={(e) => {
                        e.stopPropagation();
                        ed.toggleVisible(n.id);
                      }}
                    >
                      {n.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'pages' && (
        <div className="sidebar-body">
          <div className="row-between">
            <span className="prop-label">Pages</span>
            <button className="btn secondary" onClick={ed.addPage} title="Add page">
              <FilePlus size={13} /> Add
            </button>
          </div>
          <div className="page-list">
            {ed.snapshot.pages.map((p) => (
              <div
                key={p.id}
                className={`page-row${p.current ? ' selected' : ''}`}
                onClick={() => ed.selectPage(p.id)}
                onDoubleClick={() => {
                  setEditingPage(p.id);
                  setPageDraft(p.name);
                }}
              >
                {editingPage === p.id ? (
                  <input
                    className="text-input layer-rename"
                    value={pageDraft}
                    autoFocus
                    onChange={(e) => setPageDraft(e.target.value)}
                    onBlur={() => commitPageRename(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitPageRename(p.id);
                      if (e.key === 'Escape') setEditingPage(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="layer-name">{p.name}</span>
                )}
                <span className="dim small">{p.children}</span>
                <span className="layer-actions">
                  <button
                    className="mini-btn"
                    title={p.current ? 'Selection is already on this page' : 'Move selection to this page'}
                    disabled={p.current || ed.snapshot.selection.length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      ed.moveSelectionToPage(p.id);
                    }}
                  >
                    <MoveRight size={12} />
                  </button>
                  <button className="mini-btn" title="Duplicate page" onClick={(e) => { e.stopPropagation(); ed.duplicatePage(p.id); }}>
                    <Copy size={12} />
                  </button>
                  <button
                    className="mini-btn danger-hover"
                    title={ed.snapshot.pages.length <= 1 ? 'A document needs at least one page' : 'Delete page'}
                    disabled={ed.snapshot.pages.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      ed.deletePage(p.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'assets' && <AssetsPanel />}
    </div>
  );
}

function AssetsPanel() {
  const ed = useEngine();
  const [styles, setStyles] = useState<Array<{ id: string; name: string }>>([]);
  const [components, setComponents] = useState<Array<{ id: number; name: string; type: string; instances: number }>>([]);
  const [styleName, setStyleName] = useState('');
  const [styleType, setStyleType] = useState<'paint' | 'text' | 'effect' | 'grid'>('paint');
  const hasSel = ed.snapshot.selection.length > 0;

  // The style/component registries live in the engine, outside the rendered
  // snapshot; re-read them whenever the snapshot (or tab) changes.
  useEffect(() => {
    if (ed.status !== 'ready') {
      setStyles([]);
      setComponents([]);
      return;
    }
    setStyles(ed.queryStyles());
    setComponents(ed.queryComponents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.status, ed.snapshot]);

  const createStyle = () => {
    const name = styleName.trim();
    if (name === '' || !hasSel) return;
    ed.createStyleFromSelection(styleType, name);
    setStyleName('');
  };

  return (
    <div className="sidebar-body">
      <div className="row-between">
        <span className="prop-label">Styles</span>
      </div>
      {styles.length === 0 && <p className="dim small">No shared styles yet.</p>}
      <div className="page-list">
        {styles.map((s) => (
          <div key={s.id} className="page-row">
            <span className="layer-name">{s.name}</span>
            <span className="layer-actions">
              <button
                className="mini-btn"
                title="Apply to selection fill"
                disabled={!hasSel}
                onClick={() => ed.applyStyleToSelection(s.id, 'fill')}
              >
                <Plus size={12} />
              </button>
              <button
                className="mini-btn danger-hover"
                title="Delete style"
                onClick={() => ed.deleteStyleById(s.id)}
              >
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="row-between">
        <input
          className="text-input"
          placeholder="New style name"
          value={styleName}
          onChange={(e) => setStyleName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createStyle();
          }}
          aria-label="New style name"
        />
      </div>
      <div className="row-between">
        <select
          className="text-input"
          value={styleType}
          onChange={(e) => setStyleType(e.target.value as 'paint' | 'text' | 'effect' | 'grid')}
          aria-label="Style type"
        >
          <option value="paint">Paint</option>
          <option value="text">Text</option>
          <option value="effect">Effect</option>
          <option value="grid">Grid</option>
        </select>
        <button className="btn secondary" disabled={!hasSel || styleName.trim() === ''} onClick={createStyle} title="Create style from selection">
          Create
        </button>
      </div>

      <div className="row-between">
        <span className="prop-label">Components</span>
        <button className="btn secondary" disabled={!hasSel} onClick={ed.createComponentFromSelection} title="Create component from selection">
          <Plus size={13} /> New
        </button>
      </div>
      {components.length === 0 && <p className="dim small">No components yet.</p>}
      <div className="page-list">
        {components.map((c) => (
          <div key={c.id} className="page-row">
            <span className="layer-icon">
              <TypeIcon type={c.type} />
            </span>
            <span className="layer-name">{c.name}</span>
            <span className="dim small">{c.instances}</span>
            <span className="layer-actions">
              <button
                className="mini-btn"
                title="Insert instance at viewport center"
                onClick={() => ed.createInstanceAtCenter(c.id)}
              >
                <Plus size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
