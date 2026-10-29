/**
 * Engine-driven right inspector: edits the engine selection through store
 * actions only. Single selection gets geometry, fill, stroke, corners,
 * opacity, visibility, lock, rotation, clip, and text controls; multiple
 * selection gets align/distribute/group. Nothing here touches the legacy
 * TypeScript store.
 */
import { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
} from 'lucide-react';
import { useEngine } from '../engine/store';
import type { EngineNode } from '../engine/adapter';

function NumField({
  label, value, onCommit, min, step = 1, disabled,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const shown = draft ?? String(Math.round(value * 100) / 100);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (Number.isFinite(n)) onCommit(min !== undefined ? Math.max(min, n) : n);
  };
  return (
    <label className="prop-field">
      <span className="prop-label">{label}</span>
      <input
        className="text-input"
        type="number"
        step={step}
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

function TextRow({ label, value, onCommit, mono }: { label: string; value: string; onCommit: (v: string) => void; mono?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <label className="prop-field full">
      <span className="prop-label">{label}</span>
      <input
        className={`text-input${mono ? ' mono' : ''}`}
        value={draft ?? value}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

function ColorRow({ color, label, onCommit }: { color: string; label: string; onCommit: (v: string) => void }) {
  // Draft locally: committing every picker tick would spam undo history.
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [color]);
  const shown = draft ?? toHex6(color);
  return (
    <>
      <input
        type="color"
        className="swatch-input-color"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== toHex6(color)) onCommit(draft);
          setDraft(null);
        }}
        title={label}
        aria-label={label}
      />
      <span className="prop-value mono">{shown}</span>
    </>
  );
}

function TextContentArea({ id, value, onCommit }: { id: number; value: string; onCommit: (v: string) => void }) {
  // Draft locally: committing per keystroke would spam undo history.
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [id, value]);
  return (
    <label className="prop-field full">
      <span className="prop-label">Content</span>
      <textarea
        className="text-input"
        rows={3}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
      />
    </label>
  );
}

function firstSolid(n: EngineNode, which: 'fills' | 'strokes'): { color: string; opacity: number } | null {
  const p = n[which][0];
  if (!p || p.type !== 'solid' || typeof p.color !== 'string') return null;
  return { color: p.color, opacity: p.opacity ?? 1 };
}

export function EngineInspector() {
  const ed = useEngine();
  const sel = ed.selectedNodes;

  if (ed.status !== 'ready') {
    return (
      <div className="sidebar right inspector">
        <p className="dim small">{ed.status === 'loading' ? 'Loading…' : 'Engine unavailable.'}</p>
      </div>
    );
  }

  if (sel.length === 0) {
    return (
      <div className="sidebar right inspector">
        <div className="prop-section">
          <div className="prop-title">Document</div>
          <div className="prop-grid-2">
            <div className="prop-field">
              <span className="prop-label">Pages</span>
              <span className="prop-value">{ed.snapshot.pages.length}</span>
            </div>
            <div className="prop-field">
              <span className="prop-label">Layers</span>
              <span className="prop-value">{ed.snapshot.byId.size - 1}</span>
            </div>
          </div>
          <p className="dim small">Select a layer on the canvas or in the Layers panel to edit it.</p>
        </div>
      </div>
    );
  }

  if (sel.length > 1) {
    return (
      <div className="sidebar right inspector">
        <div className="prop-section">
          <div className="prop-title">{sel.length} selected</div>
          <div className="lab-buttons">
            <button className="btn secondary" title="Align left" onClick={() => ed.alignSelected('left')}>
              <AlignStartVertical size={14} />
            </button>
            <button className="btn secondary" title="Align horizontal centers" onClick={() => ed.alignSelected('hcenter')}>
              <AlignCenterVertical size={14} />
            </button>
            <button className="btn secondary" title="Align right" onClick={() => ed.alignSelected('right')}>
              <AlignEndVertical size={14} />
            </button>
            <button className="btn secondary" title="Align top" onClick={() => ed.alignSelected('top')}>
              <AlignStartHorizontal size={14} />
            </button>
            <button className="btn secondary" title="Align vertical centers" onClick={() => ed.alignSelected('vcenter')}>
              <AlignCenterHorizontal size={14} />
            </button>
            <button className="btn secondary" title="Align bottom" onClick={() => ed.alignSelected('bottom')}>
              <AlignEndHorizontal size={14} />
            </button>
          </div>
          <div className="lab-buttons">
            <button className="btn secondary" disabled={sel.length < 3} title="Distribute horizontally" onClick={() => ed.distributeSelected('horizontal')}>
              Distribute H
            </button>
            <button className="btn secondary" disabled={sel.length < 3} title="Distribute vertically" onClick={() => ed.distributeSelected('vertical')}>
              Distribute V
            </button>
            <button className="btn secondary" title="Group selection" onClick={ed.groupSelected}>
              Group
            </button>
          </div>
        </div>
      </div>
    );
  }

  const n = sel[0];
  const fill = firstSolid(n, 'fills');
  const stroke = firstSolid(n, 'strokes');
  const isLine = n.type === 'LINE';
  const isText = n.type === 'TEXT';
  const isFrame = n.type === 'FRAME' || n.type === 'GROUP';
  const cornersMixed = Array.isArray(n.cornerRadius);
  // Displayed clockwise-positive; the engine takes ccw-positive.
  const rotationCw = Math.round(-n.rotation * 100) / 100;

  return (
    <div className="sidebar right inspector">
      <div className="prop-section">
        <div className="prop-title">{typeLabel(n.type)}</div>
        <TextRow label="Name" value={n.name} onCommit={(v) => ed.renameNode(n.id, v)} />
        <div className="prop-grid-2">
          <NumField label="X" value={n.x} onCommit={(v) => ed.setNodeProps(n.id, { x: v })} />
          <NumField label="Y" value={n.y} onCommit={(v) => ed.setNodeProps(n.id, { y: v })} />
          {!isLine && <NumField label="W" value={n.width} min={1} onCommit={(v) => ed.setNodeProps(n.id, { width: v })} />}
          {!isLine && <NumField label="H" value={n.height} min={1} onCommit={(v) => ed.setNodeProps(n.id, { height: v })} />}
          {isLine && <NumField label="Length" value={n.width} min={1} onCommit={(v) => ed.setNodeProps(n.id, { width: v })} />}
          {!isLine && (
            <NumField label="Rotation" value={rotationCw} step={1} onCommit={(v) => ed.setNodeProps(n.id, { rotation: -v })} />
          )}
        </div>
        {isLine && <p className="dim small">Line endpoints are not draggable yet — move or delete the line.</p>}
        <div className="lab-buttons">
          <button className="btn secondary" title={n.visible ? 'Hide' : 'Show'} onClick={() => ed.toggleVisible(n.id)}>
            {n.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button className="btn secondary" title={n.locked ? 'Unlock' : 'Lock'} onClick={() => ed.toggleLock(n.id)}>
            {n.locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
        </div>
      </div>

      <div className="prop-section">
        <div className="prop-title">Fill</div>
        {fill ? (
          <div className="lab-buttons">
            <ColorRow color={fill.color} label="Fill color" onCommit={(v) => ed.setNodeProps(n.id, { fill: v })} />
            <button className="btn secondary" title="Remove fill" onClick={() => ed.setNodeProps(n.id, { fills: [] })}>
              Remove
            </button>
          </div>
        ) : (
          <div className="lab-buttons">
            <button className="btn secondary" title="Add fill" onClick={() => ed.setNodeProps(n.id, { fill: '#D9D9D9' })}>
              Add fill
            </button>
            {n.fills.length > 0 && <span className="dim small">Non-solid fill (not editable yet)</span>}
          </div>
        )}
        <NumField label="Opacity" value={n.opacity} min={0} step={0.05} onCommit={(v) => ed.setNodeProps(n.id, { opacity: Math.min(1, v) })} />
      </div>

      {!isText && (
        <div className="prop-section">
          <div className="prop-title">Stroke</div>
          {stroke ? (
            <div className="lab-buttons">
              <ColorRow color={stroke.color} label="Stroke color" onCommit={(v) => ed.setNodeProps(n.id, { stroke: v })} />
              <button className="btn secondary" title="Remove stroke" onClick={() => ed.setNodeProps(n.id, { strokes: [] })}>
                Remove
              </button>
            </div>
          ) : (
            <div className="lab-buttons">
              <button className="btn secondary" title="Add stroke" onClick={() => ed.setNodeProps(n.id, { stroke: '#000000', strokeWeight: 1 })}>
                Add stroke
              </button>
            </div>
          )}
          {stroke && <NumField label="Weight" value={n.strokeWeight} min={0} step={0.5} onCommit={(v) => ed.setNodeProps(n.id, { strokeWeight: v })} />}
        </div>
      )}

      {!isText && !isLine && (
        <div className="prop-section">
          <div className="prop-title">Corners</div>
          <NumField
            label={cornersMixed ? 'Radius (mixed)' : 'Radius'}
            value={typeof n.cornerRadius === 'number' ? n.cornerRadius : 0}
            min={0}
            onCommit={(v) => ed.setNodeProps(n.id, { cornerRadius: v })}
          />
        </div>
      )}

      {isFrame && (
        <div className="prop-section">
          <label className="check-row">
            <input type="checkbox" checked={n.clip} onChange={(e) => ed.setNodeProps(n.id, { clip: e.target.checked })} />
            <span>Clip content</span>
          </label>
        </div>
      )}

      {isText && (
        <div className="prop-section">
          <div className="prop-title">Text</div>
          <TextContentArea id={n.id} value={n.characters ?? ''} onCommit={(v) => ed.setNodeText(n.id, v)} />
          <div className="prop-grid-2">
            <NumField label="Size" value={n.fontSize ?? 16} min={1} onCommit={(v) => ed.setNodeProps(n.id, { fontSize: v })} />
            <label className="prop-field">
              <span className="prop-label">Align</span>
              <select
                className="text-input"
                value={n.textAlign ?? 'left'}
                onChange={(e) => ed.setNodeProps(n.id, { textAlign: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
          <TextRow label="Font" value={n.fontFamily ?? ''} onCommit={(v) => ed.setNodeProps(n.id, { fontFamily: v })} />
        </div>
      )}
    </div>
  );
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    FRAME: 'Frame',
    GROUP: 'Group',
    RECTANGLE: 'Rectangle',
    ELLIPSE: 'Ellipse',
    TEXT: 'Text',
    LINE: 'Line',
    VECTOR: 'Vector',
    COMPONENT: 'Component',
    COMPONENT_SET: 'Component set',
    INSTANCE: 'Instance',
    SECTION: 'Section',
    SLICE: 'Slice',
  };
  return labels[type] ?? type;
}

function toHex6(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return '#000000';
}
