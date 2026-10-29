import { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Ban,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Frame,
  Lock,
  LockOpen,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { FONT_STACKS, useEditor } from '../store';
import type { DesignObject, TextAlign } from '../types';
import { clamp, downloadFile, isHexColor, normalizeHex, pageToSvg, round1 } from '../utils';
import type { DocPage } from '../types';

function TypeIcon({ type }: { type: DesignObject['type'] }) {
  switch (type) {
    case 'frame':
      return <Frame size={14} />;
    case 'rectangle':
      return <Square size={14} />;
    case 'ellipse':
      return <Circle size={14} />;
    case 'text':
      return <Type size={14} />;
    case 'line':
      return <Minus size={14} />;
  }
}

const TYPE_LABEL: Record<DesignObject['type'], string> = {
  frame: 'Frame',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  line: 'Line',
};

export function PropertiesPanel() {
  const { selected } = useEditor();
  if (selected.length === 0) return <PageProperties />;
  if (selected.length === 1) return <SingleProperties obj={selected[0]} />;
  return <MultiProperties objs={selected} />;
}

/* ================= no selection: page ================= */

function PageProperties() {
  const { page, renamePage, addObject } = useEditor();
  const [name, setName] = useState(page.name);
  useEffect(() => setName(page.name), [page.id, page.name]);

  return (
    <div className="sidebar right">
      <div className="props-scroll">
        <div className="prop-section">
          <div className="prop-title">Page</div>
          <label className="prop-field full">
            <span className="prop-label">Name</span>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => renamePage(page.id, name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              aria-label="Page name"
            />
          </label>
          <div className="prop-hint">{page.objects.length} objects</div>
        </div>
        <div className="prop-section">
          <div className="prop-title">Insert</div>
          <div className="insert-grid">
            <button className="btn secondary" onClick={() => addObject('frame')}><Frame size={14} /><span>Frame</span></button>
            <button className="btn secondary" onClick={() => addObject('rectangle')}><Square size={14} /><span>Rect</span></button>
            <button className="btn secondary" onClick={() => addObject('ellipse')}><Circle size={14} /><span>Ellipse</span></button>
            <button className="btn secondary" onClick={() => addObject('text')}><Type size={14} /><span>Text</span></button>
            <button className="btn secondary" onClick={() => addObject('line')}><Minus size={14} /><span>Line</span></button>
          </div>
          <div className="prop-hint">New objects land at the canvas center. Press F R O T L, then drag to size.</div>
        </div>
        <div className="prop-section">
          <div className="prop-title">Tips</div>
          <ul className="tips">
            <li>Drag to move · handles to resize</li>
            <li>Double-click text to edit it</li>
            <li>Space + drag, or scroll, to pan</li>
            <li>Ctrl + scroll to zoom</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ================= single selection ================= */

function SingleProperties({ obj }: { obj: DesignObject }) {
  const editor = useEditor();
  const { updateObjects, toggleVisibility, toggleLock, renameObject, duplicateSelected, deleteSelected } = editor;
  const ids = [obj.id];
  const [name, setName] = useState(obj.name);
  useEffect(() => setName(obj.name), [obj.id, obj.name]);

  const showStroke = obj.type !== 'text';
  const showRadius = obj.type === 'frame' || obj.type === 'rectangle';

  return (
    <div className="sidebar right">
      <div className="props-scroll">
        <div className="prop-head">
          <span className="prop-type"><TypeIcon type={obj.type} />{TYPE_LABEL[obj.type]}</span>
          <span className="prop-head-actions">
            <button className={`mini-btn${obj.locked ? ' on' : ''}`} title={obj.locked ? 'Unlock' : 'Lock'} onClick={() => toggleLock(obj.id)}>
              {obj.locked ? <Lock size={13} /> : <LockOpen size={13} />}
            </button>
            <button className="mini-btn" title={obj.visible ? 'Hide' : 'Show'} onClick={() => toggleVisibility(obj.id)}>
              {obj.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </span>
        </div>
        <div className="prop-section">
          <label className="prop-field full">
            <span className="prop-label">Layer</span>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => renameObject(obj.id, name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              aria-label="Layer name"
            />
          </label>
        </div>

        <div className="prop-section">
          <div className="prop-title">Layout</div>
          <div className="prop-grid-2">
            <NumField label="X" value={obj.x} onCommit={(v) => updateObjects(ids, { x: v })} />
            <NumField label="Y" value={obj.y} onCommit={(v) => updateObjects(ids, { y: v })} />
            <NumField label="W" value={obj.w} min={1} onCommit={(v) => updateObjects(ids, { w: Math.max(1, v) })} />
            {obj.type === 'line' ? (
              <NumField label="H" value={obj.h} onCommit={(v) => updateObjects(ids, { h: v })} />
            ) : (
              <NumField label="H" value={obj.h} min={1} onCommit={(v) => updateObjects(ids, { h: Math.max(1, v) })} />
            )}
            <NumField label="Rotation" value={obj.rotation} suffix="°" onCommit={(v) => updateObjects(ids, { rotation: round1(v) })} />
            {showRadius && (
              <NumField label="Radius" value={obj.cornerRadius} min={0} onCommit={(v) => updateObjects(ids, { cornerRadius: Math.max(0, v) })} />
            )}
          </div>
          {obj.type === 'frame' && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={obj.clip}
                onChange={(e) => updateObjects(ids, { clip: e.target.checked })}
              />
              <span>Clip children to bounds</span>
            </label>
          )}
        </div>

        <div className="prop-section">
          <div className="prop-title">{obj.type === 'text' ? 'Color' : 'Fill'}</div>
          {obj.type === 'line' ? (
            <div className="prop-hint">Lines use stroke only.</div>
          ) : (
            <ColorField
              value={obj.fill}
              opacity={obj.fillOpacity}
              onCommit={(fill) => updateObjects(ids, { fill })}
              onOpacity={(fillOpacity) => updateObjects(ids, { fillOpacity })}
            />
          )}
        </div>

        {showStroke && (
          <div className="prop-section">
            <div className="prop-title">Stroke</div>
            <div className="stroke-row">
              <ColorField
                value={obj.stroke}
                onCommit={(stroke) =>
                  updateObjects(ids, {
                    stroke,
                    strokeWidth: stroke && obj.strokeWidth === 0 ? 1 : obj.strokeWidth,
                  })
                }
              />
              <NumField label="Width" value={obj.strokeWidth} min={0} onCommit={(v) => updateObjects(ids, { strokeWidth: Math.max(0, v) })} />
            </div>
          </div>
        )}

        {obj.type === 'text' && <TextSection obj={obj} />}

        <div className="prop-section">
          <div className="prop-title">Layer</div>
          <OpacityField value={obj.opacity} onCommit={(opacity) => updateObjects(ids, { opacity })} />
        </div>

        <div className="prop-section">
          <div className="prop-title">Export</div>
          <button className="btn secondary full" onClick={() => exportSelection([obj], editor.page)}>
            <Download size={14} />
            <span>Export selection as SVG</span>
          </button>
        </div>

        <div className="prop-section">
          <div className="row-2">
            <button className="btn secondary" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
              <Copy size={14} />
              <span>Duplicate</span>
            </button>
            <button className="btn secondary danger-hover" onClick={deleteSelected} title="Delete (Del)">
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function exportSelection(objs: DesignObject[], page: DocPage) {
  const ids = new Set(objs.map((o) => o.id));
  const include = new Set<string>(ids);
  const queue = [...objs];
  while (queue.length > 0) {
    const cur = queue.pop() as DesignObject;
    for (const child of page.objects.filter((o) => o.parentId === cur.id)) {
      if (!include.has(child.id)) {
        include.add(child.id);
        queue.push(child);
      }
    }
  }
  const temp: DocPage = {
    ...page,
    objects: page.objects
      .filter((o) => include.has(o.id))
      .map((o) => (ids.has(o.id) ? { ...o } : o)),
  };
  const roots = temp.objects.filter((o) => ids.has(o.id)).map((o) => o.id);
  downloadFile('selection.svg', pageToSvg(temp, roots), 'image/svg+xml');
}

/* ================= text ================= */

function TextSection({ obj }: { obj: DesignObject }) {
  const { updateObjects } = useEditor();
  const ids = [obj.id];
  const aligns: { id: TextAlign; label: string }[] = [
    { id: 'left', label: 'Left' },
    { id: 'center', label: 'Center' },
    { id: 'right', label: 'Right' },
  ];
  return (
    <div className="prop-section">
      <div className="prop-title">Typography</div>
      <label className="prop-field full">
        <span className="prop-label">Font</span>
        <select
          className="text-input"
          value={obj.fontFamily}
          onChange={(e) => updateObjects(ids, { fontFamily: e.target.value })}
          aria-label="Font family"
        >
          {FONT_STACKS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="prop-grid-2">
        <NumField label="Size" value={obj.fontSize} min={1} onCommit={(v) => updateObjects(ids, { fontSize: Math.max(1, v) })} />
        <label className="prop-field">
          <span className="prop-label">Weight</span>
          <select
            className="text-input"
            value={obj.fontWeight}
            onChange={(e) => updateObjects(ids, { fontWeight: Number(e.target.value) })}
            aria-label="Font weight"
          >
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={600}>Semibold</option>
            <option value={700}>Bold</option>
            <option value={800}>Extra bold</option>
          </select>
        </label>
        <NumField label="Line height" value={obj.lineHeight} min={0.5} step={0.05} onCommit={(v) => updateObjects(ids, { lineHeight: clamp(v, 0.5, 4) })} />
        <div className="prop-field">
          <span className="prop-label">Align</span>
          <div className="seg">
            {aligns.map((a) => (
              <button
                key={a.id}
                className={`seg-btn${obj.textAlign === a.id ? ' active' : ''}`}
                title={a.label}
                onClick={() => updateObjects(ids, { textAlign: a.id })}
                aria-pressed={obj.textAlign === a.id}
              >
                {a.label[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="prop-field full">
        <span className="prop-label">Content</span>
        <textarea
          className="text-input content-area"
          value={obj.text}
          rows={3}
          onChange={(e) => updateObjects(ids, { text: e.target.value })}
          aria-label="Text content"
        />
      </label>
    </div>
  );
}

/* ================= multi selection ================= */

function MultiProperties({ objs }: { objs: DesignObject[] }) {
  const editor = useEditor();
  const { align, distribute, updateObjects, duplicateSelected, deleteSelected } = editor;
  const ids = objs.map((o) => o.id);
  const avgOpacity = objs.reduce((s, o) => s + o.opacity, 0) / objs.length;

  return (
    <div className="sidebar right">
      <div className="props-scroll">
        <div className="prop-head">
          <span className="prop-type">{objs.length} objects selected</span>
        </div>
        <div className="prop-section">
          <div className="prop-title">Align</div>
          <div className="align-grid">
            <button className="icon-btn" data-tip="Align left" onClick={() => align('left')}><AlignStartVertical size={15} /></button>
            <button className="icon-btn" data-tip="Align center" onClick={() => align('centerX')}><AlignCenterVertical size={15} /></button>
            <button className="icon-btn" data-tip="Align right" onClick={() => align('right')}><AlignEndVertical size={15} /></button>
            <button className="icon-btn" data-tip="Align top" onClick={() => align('top')}><AlignStartHorizontal size={15} /></button>
            <button className="icon-btn" data-tip="Align middle" onClick={() => align('centerY')}><AlignCenterHorizontal size={15} /></button>
            <button className="icon-btn" data-tip="Align bottom" onClick={() => align('bottom')}><AlignEndHorizontal size={15} /></button>
          </div>
        </div>
        <div className="prop-section">
          <div className="prop-title">Distribute</div>
          <div className="row-2">
            <button className="btn secondary" disabled={objs.length < 3} title={objs.length < 3 ? 'Needs 3+ objects' : undefined} onClick={() => distribute('horizontal')}>
              <MoveHorizontal size={14} />
              <span>Horizontal</span>
            </button>
            <button className="btn secondary" disabled={objs.length < 3} title={objs.length < 3 ? 'Needs 3+ objects' : undefined} onClick={() => distribute('vertical')}>
              <MoveVertical size={14} />
              <span>Vertical</span>
            </button>
          </div>
        </div>
        <div className="prop-section">
          <div className="prop-title">Layer</div>
          <OpacityField value={avgOpacity} onCommit={(opacity) => updateObjects(ids, { opacity })} />
        </div>
        <div className="prop-section">
          <div className="prop-title">Export</div>
          <button className="btn secondary full" onClick={() => exportSelection(objs, editor.page)}>
            <Download size={14} />
            <span>Export selection as SVG</span>
          </button>
        </div>
        <div className="prop-section">
          <div className="row-2">
            <button className="btn secondary" onClick={duplicateSelected}>
              <Copy size={14} />
              <span>Duplicate</span>
            </button>
            <button className="btn secondary danger-hover" onClick={deleteSelected}>
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= field primitives ================= */

function NumField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [text, setText] = useState(String(round1(value)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(round1(value)));
  }, [value, focused]);

  const commit = () => {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) {
      let v = parsed;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onCommit(v);
    }
    setText(String(round1(value)));
  };

  return (
    <label className="prop-field">
      <span className="prop-label">{label}</span>
      <span className="num-wrap">
        <input
          className="text-input num"
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : step);
              onCommit(round1(value + delta));
            } else if (e.key === 'Escape') {
              setText(String(round1(value)));
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label={label}
        />
        {suffix && <span className="num-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

function ColorField({
  value,
  opacity,
  onCommit,
  onOpacity,
}: {
  value: string;
  opacity?: number;
  onCommit: (v: string) => void;
  onOpacity?: (v: number) => void;
}) {
  const [hex, setHex] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setHex(value);
  }, [value, focused]);

  const commitHex = () => {
    if (hex.trim() === '') {
      onCommit('');
      return;
    }
    if (isHexColor(hex)) onCommit(normalizeHex(hex, value || '#111111'));
    else setHex(value);
  };

  return (
    <div className="color-field">
      <label className="swatch-input" title={value || 'None — click to pick'}>
        {value ? (
          <span className="swatch-input-color" style={{ background: value }} />
        ) : (
          <span className="swatch-input-none"><Ban size={13} /></span>
        )}
        <input
          type="color"
          value={isHexColor(value) ? normalizeHex(value, '#111111') : '#111111'}
          onChange={(e) => onCommit(normalizeHex(e.target.value, '#111111'))}
          aria-label="Pick color"
        />
      </label>
      <input
        className="text-input hex"
        value={hex}
        placeholder="None"
        spellCheck={false}
        onChange={(e) => setHex(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitHex();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setHex(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Hex color"
      />
      <button
        className={`mini-btn${value === '' ? ' on' : ''}`}
        title="No fill"
        onClick={() => onCommit('')}
        aria-pressed={value === ''}
      >
        <Ban size={13} />
      </button>
      {opacity !== undefined && onOpacity && (
        <label className="opacity-inline" title="Fill opacity">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            aria-label="Fill opacity"
          />
          <span>{Math.round(opacity * 100)}%</span>
        </label>
      )}
    </div>
  );
}

function OpacityField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <label className="opacity-row">
      <span className="prop-label">Opacity</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onCommit(Number(e.target.value) / 100)}
        aria-label="Layer opacity"
      />
      <span className="opacity-val">{Math.round(value * 100)}%</span>
    </label>
  );
}
