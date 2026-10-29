import { useEffect, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Ban,
  Circle,
  Component as ComponentIcon,
  Copy,
  Download,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  Link2,
  Lock,
  LockOpen,
  Maximize2,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Pen,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import { FONT_STACKS, useEditor } from '../store';
import type { ChildSizing, Constraints, CornerRadii, DesignObject, FillGradient, FrameLayout, GradientStop, ObjectPatch, SizingMode, TextAlign } from '../types';
import { defaultChildSizing, defaultFrameLayout } from '../layout';
import { clamp, downloadFile, effectiveGradient, hasIndependentCorners, isHexColor, normalizeHex, resolveHexCommit, resolveNumericCommit, resolveRadii, round1 } from '../utils';
import type { DocPage } from '../types';
import { exportPageSvg, fitImageSize } from '../assets';
import { exposedControls, liveSource, setContaining } from '../library';
import { canHaveEffectStyle } from '../system';
import { useNativePickerEnd } from './ui';

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
    case 'image':
      return <ImageIcon size={14} />;
  }
}

const TYPE_LABEL: Record<DesignObject['type'], string> = {
  frame: 'Frame',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  line: 'Line',
  image: 'Image',
};

const H_CONSTRAINTS = [
  { v: 'left', label: 'Left' },
  { v: 'center', label: 'Center' },
  { v: 'right', label: 'Right' },
  { v: 'stretch', label: 'Stretch' },
  { v: 'scale', label: 'Scale' },
] as const;

const V_CONSTRAINTS = [
  { v: 'top', label: 'Top' },
  { v: 'middle', label: 'Middle' },
  { v: 'bottom', label: 'Bottom' },
  { v: 'stretch', label: 'Stretch' },
  { v: 'scale', label: 'Scale' },
] as const;

export function PropertiesPanel() {
  const { selected } = useEditor();
  if (selected.length === 0) return <PageProperties />;
  if (selected.length === 1) return <SingleProperties obj={selected[0]} />;
  return <MultiProperties objs={selected} />;
}

/* ================= no selection: page ================= */

function PageProperties() {
  const { page, renamePage, addObject, importImageFiles } = useEditor();
  const [name, setName] = useState(page.name);
  useEffect(() => setName(page.name), [page.id, page.name]);
  const imgRef = useRef<HTMLInputElement>(null);

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
          <button className="btn secondary full import-image-btn" onClick={() => imgRef.current?.click()}>
            <ImageIcon size={14} />
            <span>Import image…</span>
          </button>
          <input
            ref={imgRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) importImageFiles(e.target.files);
              e.target.value = '';
            }}
          />
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
  const { updateObjects, toggleVisibility, toggleLock, renameObject, duplicateSelected, deleteSelected, detachFillStyle } = editor;
  const ids = [obj.id];
  const [name, setName] = useState(obj.name);
  useEffect(() => setName(obj.name), [obj.id, obj.name]);
  const instanceDef = obj.componentId
    ? (editor.doc.components ?? []).find((d) => d.id === obj.componentId) ?? null
    : null;
  const childOfDef = (() => {
    if (!obj.sourceId) return null;
    const byId = new Map(editor.page.objects.map((o) => [o.id, o]));
    const seen = new Set<string>();
    let p = obj.parentId;
    while (p !== null && !seen.has(p)) {
      const par = byId.get(p);
      if (!par) return null;
      if (par.componentId) {
        return (editor.doc.components ?? []).find((d) => d.id === par.componentId) ?? { name: 'component' };
      }
      seen.add(p);
      p = par.parentId;
    }
    return null;
  })();

  const sourceDefAuthorable = (() => {
    const def = (editor.doc.components ?? []).find((d) => d.rootId === obj.id) ?? null;
    if (!def) return null;
    const inSet = (editor.doc.variantSets ?? []).some((s) => s.variants.includes(def.id));
    if (inSet) return def;
    const src = liveSource(editor.doc, def);
    const hasNested = src
      ? src.subtree.some((o) => o.componentId !== null && o.componentId !== undefined)
      : false;
    return hasNested ? def : null;
  })();

  const showStroke = obj.type !== 'text' && obj.type !== 'image';
  const showEffects = canHaveEffectStyle(obj.type);
  const showRadius = obj.type === 'frame' || obj.type === 'rectangle';
  const parentIsFrame =
    obj.parentId !== null &&
    editor.page.objects.find((o) => o.id === obj.parentId)?.type === 'frame';
  const parentLayout = (() => {
    if (obj.parentId === null) return null;
    const p = editor.page.objects.find((o) => o.id === obj.parentId);
    if (!p || p.type !== 'frame') return null;
    return p.layout ?? null;
  })();
  const isFlowChild =
    parentLayout !== null &&
    !(obj.sizing?.absolute ?? false) &&
    (obj.sourceId === null || obj.sourceId === undefined);
  const curConstraints: Constraints = obj.constraints ?? { horizontal: 'left', vertical: 'top' };
  const linkedStyle = obj.fillStyleId
    ? (editor.doc.colorStyles ?? []).find((s) => s.id === obj.fillStyleId) ?? null
    : null;
  const grad = effectiveGradient(obj);
  const independent = hasIndependentCorners(obj);
  const radii = resolveRadii(obj);

  const enableGradient = () => {
    if (grad) return;
    const first = isHexColor(obj.fill) ? normalizeHex(obj.fill, '#111111') : '#111111';
    updateObjects(ids, {
      fillGradient: { angle: 90, stops: [{ offset: 0, color: first }, { offset: 1, color: '#FFFFFF' }] },
    });
  };
  const disableGradient = () => {
    if (obj.fillGradient === null || obj.fillGradient === undefined) return;
    updateObjects(ids, { fillGradient: null });
  };
  const unlinkCorners = () => {
    const r = obj.cornerRadius;
    updateObjects(ids, { cornerRadii: [r, r, r, r] });
  };
  const linkCorners = () => {
    updateObjects(ids, { cornerRadius: radii[0], cornerRadii: null });
  };
  const setRadius = (i: number, v: number): ObjectPatch => {
    const next = [...radii] as CornerRadii;
    next[i] = Math.max(0, v);
    return { cornerRadii: next };
  };

  return (
    <div className="sidebar right">
      <div className="props-scroll">
        <div className="prop-head">
          <span className="prop-type">
            {obj.componentId ? <ComponentIcon size={14} /> : <TypeIcon type={obj.type} />}
            {TYPE_LABEL[obj.type]}{obj.componentId ? ' (Instance)' : ''}
          </span>
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

        {obj.componentId && (
          <InstanceSection
            obj={obj}
            defName={instanceDef?.name ?? null}
            sourceLive={instanceDef ? liveSource(editor.doc, instanceDef) !== null : false}
          />
        )}
        {obj.sourceId && childOfDef && (
          <div className="prop-section">
            <div className="instance-note">Part of “{childOfDef.name}” — edits become overrides.</div>
            <button
              className="btn secondary full"
              onClick={editor.resetSelectedLayerOverride}
              title="Drop this layer's overrides back to the source"
            >
              <RotateCcw size={14} />
              <span>Reset layer</span>
            </button>
          </div>
        )}
        {sourceDefAuthorable && <ComponentSourceSection defId={sourceDefAuthorable.id} />}

        <div className="prop-section">
          <div className="prop-title">Layout</div>
          <div className="prop-grid-2">
            <NumField label="X" value={obj.x} ids={ids} patch={(v) => ({ x: v })} />
            <NumField label="Y" value={obj.y} ids={ids} patch={(v) => ({ y: v })} />
            <NumField label="W" value={obj.w} min={1} ids={ids} patch={(v) => ({ w: Math.max(1, v) })} />
            {obj.type === 'line' ? (
              <NumField label="H" value={obj.h} ids={ids} patch={(v) => ({ h: v })} />
            ) : (
              <NumField label="H" value={obj.h} min={1} ids={ids} patch={(v) => ({ h: Math.max(1, v) })} />
            )}
            <NumField label="Rotation" value={obj.rotation} suffix="°" ids={ids} patch={(v) => ({ rotation: round1(v) })} />
            {showRadius && !independent && (
              <div className="radius-row">
                <NumField label="Radius" value={obj.cornerRadius} min={0} ids={ids} patch={(v) => ({ cornerRadius: Math.max(0, v) })} />
                <button className="mini-btn" title="Independent corners" onClick={unlinkCorners} aria-label="Independent corners">
                  <Unlink size={13} />
                </button>
              </div>
            )}
            {showRadius && independent && (
              <div className="radii-row">
                {(['TL', 'TR', 'BR', 'BL'] as const).map((label, i) => (
                  <NumField key={label} label={label} value={radii[i]} min={0} ids={ids} patch={(v) => setRadius(i, v)} />
                ))}
                <button className="mini-btn on" title="Link corners" onClick={linkCorners} aria-label="Link corners" aria-pressed={true}>
                  <Link2 size={13} />
                </button>
              </div>
            )}
          </div>
          {isFlowChild && (
            <div className="prop-hint">Positioned by the parent stack — drag to reorder.</div>
          )}
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
          {parentIsFrame && (
            <div className="constraint-block">
              <span className="prop-label">Horizontal</span>
              <div className="seg tight" role="group" aria-label="Horizontal constraints">
                {H_CONSTRAINTS.map((o) => (
                  <button
                    key={o.v}
                    className={`seg-btn${curConstraints.horizontal === o.v ? ' active' : ''}`}
                    onClick={() => updateObjects(ids, { constraints: { ...curConstraints, horizontal: o.v } })}
                    aria-pressed={curConstraints.horizontal === o.v}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span className="prop-label">Vertical</span>
              <div className="seg tight" role="group" aria-label="Vertical constraints">
                {V_CONSTRAINTS.map((o) => (
                  <button
                    key={o.v}
                    className={`seg-btn${curConstraints.vertical === o.v ? ' active' : ''}`}
                    onClick={() => updateObjects(ids, { constraints: { ...curConstraints, vertical: o.v } })}
                    aria-pressed={curConstraints.vertical === o.v}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {obj.type === 'frame' && <AutoLayoutSection obj={obj} ids={ids} />}
        {parentLayout && <ChildSizingSection obj={obj} ids={ids} />}

        {obj.type === 'image' ? (
          <ImageSection obj={obj} />
        ) : (
        <div className="prop-section">
          <div className="prop-title">{obj.type === 'text' ? 'Color' : 'Fill'}</div>
          {obj.type === 'line' ? (
            <div className="prop-hint">Lines use stroke only.</div>
          ) : (
            <>
              <div className="seg panel-seg" role="group" aria-label="Fill type">
                <button
                  className={`seg-btn${grad ? '' : ' active'}`}
                  onClick={disableGradient}
                  aria-pressed={!grad}
                >
                  Solid
                </button>
                <button
                  className={`seg-btn${grad ? ' active' : ''}`}
                  onClick={enableGradient}
                  aria-pressed={!!grad}
                >
                  Gradient
                </button>
              </div>
              {grad ? (
                <GradientEditor ids={ids} grad={grad} />
              ) : (
                <>
                  {linkedStyle && (
                    <div className="style-link">
                      <Link2 size={13} />
                      <span>{linkedStyle.name}</span>
                      <button
                        className="mini-btn"
                        title="Detach style (keep color)"
                        onClick={detachFillStyle}
                        aria-label="Detach fill style"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <ColorField
                    value={obj.fill}
                    opacity={obj.fillOpacity}
                    ids={ids}
                    colorPatch={(fill) => ({ fill, fillStyleId: null })}
                    opacityPatch={(fillOpacity) => ({ fillOpacity })}
                  />
                </>
              )}
            </>
          )}
        </div>
        )}

        {showStroke && (
          <div className="prop-section">
            <div className="prop-title">Stroke</div>
            <div className="stroke-row">
              <ColorField
                value={obj.stroke}
                ids={ids}
                colorPatch={(stroke) => ({
                  stroke,
                  strokeWidth: stroke && obj.strokeWidth === 0 ? 1 : obj.strokeWidth,
                })}
              />
              <NumField label="Width" value={obj.strokeWidth} min={0} ids={ids} patch={(v) => ({ strokeWidth: Math.max(0, v) })} />
            </div>
          </div>
        )}

        {obj.type === 'text' && <TextSection obj={obj} />}

        {showEffects && <EffectsSection obj={obj} />}

        <PrototypeSection obj={obj} />

        <div className="prop-section">
          <div className="prop-title">Layer</div>
          <OpacityField ids={ids} value={obj.opacity} />
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

const SIZING_MODES: { v: SizingMode; label: string }[] = [
  { v: 'fixed', label: 'Fixed' },
  { v: 'hug', label: 'Hug' },
  { v: 'fill', label: 'Fill' },
];

const ALIGN_MAIN_OPTS: { v: FrameLayout['alignMain']; label: string }[] = [
  { v: 'start', label: 'Start' },
  { v: 'center', label: 'Center' },
  { v: 'end', label: 'End' },
  { v: 'space-between', label: 'Space' },
];

const ALIGN_CROSS_OPTS: { v: FrameLayout['alignCross']; label: string }[] = [
  { v: 'start', label: 'Start' },
  { v: 'center', label: 'Center' },
  { v: 'end', label: 'End' },
];

function AutoLayoutSection({ obj, ids }: { obj: DesignObject; ids: string[] }) {
  const { updateObjects } = useEditor();
  const L = obj.layout ?? null;
  if (!L) {
    return (
      <div className="prop-section">
        <div className="prop-title">Auto layout</div>
        <div className="seg panel-seg" role="group" aria-label="Add auto layout">
          <button
            className="seg-btn"
            onClick={() => updateObjects(ids, { layout: defaultFrameLayout('horizontal') })}
            title="Stack children in a row"
          >
            <MoveHorizontal size={13} />
            <span>Row</span>
          </button>
          <button
            className="seg-btn"
            onClick={() => updateObjects(ids, { layout: defaultFrameLayout('vertical') })}
            title="Stack children in a column"
          >
            <MoveVertical size={13} />
            <span>Column</span>
          </button>
        </div>
        <div className="prop-hint">Stack children with gap, padding, and alignment.</div>
      </div>
    );
  }
  const set = (patch: Partial<FrameLayout>) => updateObjects(ids, { layout: { ...L, ...patch } });
  const horiz = L.direction === 'horizontal';
  return (
    <div className="prop-section">
      <div className="prop-title">Auto layout</div>
      <div className="seg panel-seg" role="group" aria-label="Direction">
        <button
          className={`seg-btn${horiz ? ' active' : ''}`}
          onClick={() => set({ direction: 'horizontal' })}
          aria-pressed={horiz}
        >
          <MoveHorizontal size={13} />
          <span>Row</span>
        </button>
        <button
          className={`seg-btn${!horiz ? ' active' : ''}`}
          onClick={() => set({ direction: 'vertical' })}
          aria-pressed={!horiz}
        >
          <MoveVertical size={13} />
          <span>Column</span>
        </button>
      </div>
      <div className="prop-grid-2">
        <NumField label="Gap" value={L.gap} min={0} ids={ids} patch={(v) => ({ layout: { ...L, gap: Math.max(0, v) } })} />
      </div>
      <span className="prop-label">Padding</span>
      <div className="prop-grid-2">
        <NumField label="Top" value={L.paddingTop} min={0} ids={ids} patch={(v) => ({ layout: { ...L, paddingTop: Math.max(0, v) } })} />
        <NumField label="Right" value={L.paddingRight} min={0} ids={ids} patch={(v) => ({ layout: { ...L, paddingRight: Math.max(0, v) } })} />
        <NumField label="Bottom" value={L.paddingBottom} min={0} ids={ids} patch={(v) => ({ layout: { ...L, paddingBottom: Math.max(0, v) } })} />
        <NumField label="Left" value={L.paddingLeft} min={0} ids={ids} patch={(v) => ({ layout: { ...L, paddingLeft: Math.max(0, v) } })} />
      </div>
      <span className="prop-label">{horiz ? 'Horizontal align' : 'Vertical align'}</span>
      <div className="seg tight" role="group" aria-label="Main axis alignment">
        {ALIGN_MAIN_OPTS.map((o) => (
          <button
            key={o.v}
            className={`seg-btn${L.alignMain === o.v ? ' active' : ''}`}
            onClick={() => set({ alignMain: o.v })}
            aria-pressed={L.alignMain === o.v}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="prop-label">{horiz ? 'Vertical align' : 'Horizontal align'}</span>
      <div className="seg tight" role="group" aria-label="Cross axis alignment">
        {ALIGN_CROSS_OPTS.map((o) => (
          <button
            key={o.v}
            className={`seg-btn${L.alignCross === o.v ? ' active' : ''}`}
            onClick={() => set({ alignCross: o.v })}
            aria-pressed={L.alignCross === o.v}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button className="btn secondary full" onClick={() => updateObjects(ids, { layout: null })}>
        <X size={14} />
        <span>Remove auto layout</span>
      </button>
    </div>
  );
}

function ChildSizingSection({ obj, ids }: { obj: DesignObject; ids: string[] }) {
  const { updateObjects } = useEditor();
  const s: ChildSizing = obj.sizing ?? defaultChildSizing();
  const set = (patch: Partial<ChildSizing>) => updateObjects(ids, { sizing: { ...s, ...patch } });
  return (
    <div className="prop-section">
      <div className="prop-title">Sizing</div>
      <span className="prop-label">Width</span>
      <div className="seg tight" role="group" aria-label="Width sizing">
        {SIZING_MODES.map((o) => (
          <button
            key={o.v}
            className={`seg-btn${s.h === o.v ? ' active' : ''}`}
            onClick={() => set({ h: o.v })}
            aria-pressed={s.h === o.v}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="prop-label">Height</span>
      <div className="seg tight" role="group" aria-label="Height sizing">
        {SIZING_MODES.map((o) => (
          <button
            key={o.v}
            className={`seg-btn${s.v === o.v ? ' active' : ''}`}
            onClick={() => set({ v: o.v })}
            aria-pressed={s.v === o.v}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="prop-grid-2">
        <OptNumField label="Min W" value={s.minW} ids={ids} patch={(v) => ({ sizing: { ...s, minW: v } })} />
        <OptNumField label="Max W" value={s.maxW} ids={ids} patch={(v) => ({ sizing: { ...s, maxW: v } })} />
        <OptNumField label="Min H" value={s.minH} ids={ids} patch={(v) => ({ sizing: { ...s, minH: v } })} />
        <OptNumField label="Max H" value={s.maxH} ids={ids} patch={(v) => ({ sizing: { ...s, maxH: v } })} />
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={s.absolute}
          onChange={(e) => set({ absolute: e.target.checked })}
        />
        <span>Absolute position</span>
      </label>
      {s.absolute && <div className="prop-hint">Leaves the stack; X/Y place it freely.</div>}
    </div>
  );
}

/** Nullable numeric field: empty commits null. Mirrors NumField's caret-safe pattern. */
function OptNumField({
  label,
  value,
  ids,
  patch,
}: {
  label: string;
  value: number | null;
  ids: string[];
  patch: (v: number | null) => ObjectPatch;
}) {
  const { updateObjects } = useEditor();
  const show = (v: number | null): string => (v === null ? '' : String(round1(v)));
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!focused) setText(show(value));
  }, [value, focused]);

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      if (value !== null) updateObjects(ids, patch(null));
    } else {
      const n = Number(t);
      if (Number.isFinite(n)) updateObjects(ids, patch(Math.max(0, round1(n))));
      else setText(show(value));
    }
  };

  return (
    <label className="prop-field">
      <span className="prop-label">{label}</span>
      <span className="num-wrap">
        <input
          className="text-input num"
          value={text}
          placeholder="—"
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (cancelledRef.current) {
              cancelledRef.current = false;
              setText(show(value));
            } else {
              commit();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') {
              e.stopPropagation();
              cancelledRef.current = true;
              setText(show(value));
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label={label}
        />
      </span>
    </label>
  );
}

function PrototypeSection({ obj }: { obj: DesignObject }) {
  const { doc, setPrototypeLink } = useEditor();
  const current = (doc.prototypeLinks ?? []).find((l) => l.sourceId === obj.id)?.targetFrameId ?? '';
  const frames = doc.pages.flatMap((p) =>
    p.objects.filter((o) => o.type === 'frame' && o.id !== obj.id).map((o) => ({ page: p, frame: o })),
  );
  if (frames.length === 0) return null;
  return (
    <div className="prop-section">
      <div className="prop-title">Prototype</div>
      <label className="prop-field full">
        <span className="prop-label">On click, go to</span>
        <select
          className="text-input"
          value={current}
          onChange={(e) => setPrototypeLink(obj.id, e.target.value === '' ? null : e.target.value)}
          aria-label="Prototype link target"
        >
          <option value="">None</option>
          {frames.map(({ page, frame }) => (
            <option key={frame.id} value={frame.id}>
              {doc.pages.length > 1 ? `${page.name} / ${frame.name}` : frame.name}
            </option>
          ))}
        </select>
      </label>
      <div className="prop-hint">Preview the prototype with Present, then click this object.</div>
    </div>
  );
}

function exportSelection(objs: DesignObject[], page: DocPage) {
  downloadFile(
    'selection.svg',
    exportPageSvg(page, objs.map((o) => o.id)),
    'image/svg+xml',
  );
}

/* ================= component instance ================= */

function PropTextInput({ prop, value }: { prop: string; value: string }) {
  const { setInstancePropValue } = useEditor();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [prop, value]);
  return (
    <input
      className="text-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) setInstancePropValue(prop, draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label={`Property ${prop}`}
    />
  );
}

function InstanceSection({ obj, defName, sourceLive }: { obj: DesignObject; defName: string | null; sourceLive: boolean }) {
  const { doc, detachSelectedInstance, resetSelectedInstance, gotoComponentSource, switchInstanceVariant, swapSelectedInstance, setInstancePropValue, resetInstancePropValue } = useEditor();
  const compId = obj.componentId as string;
  const nested = obj.sourceId !== null && obj.sourceId !== undefined;
  const def = (doc.components ?? []).find((d) => d.id === compId) ?? null;
  const exposed = def ? exposedControls(doc, def) : [];
  const set = obj.variant
    ? (doc.variantSets ?? []).find((s) => s.id === obj.variant?.setId) ?? null
    : null;
  const defs = doc.components ?? [];
  const defNameOf = (id: string): string => defs.find((d) => d.id === id)?.name ?? 'Variant';
  return (
    <div className="prop-section">
      <div className="prop-title">Component</div>
      <div className="prop-hint">
        {defName === null ? 'Component deleted — detach to keep editing.' : !sourceLive ? 'Source missing — instance is frozen.' : defName}
      </div>
      {set && !nested && (
        <>
          <label className="prop-field full">
            <span className="prop-label">Variant</span>
            <select
              className="text-input"
              value={compId}
              onChange={(e) => switchInstanceVariant(e.target.value)}
              aria-label="Variant"
            >
              {set.variants.map((v) => (
                <option key={v} value={v}>
                  {defNameOf(v)}
                </option>
              ))}
            </select>
          </label>
          {set.properties.map((p) => {
            const v = obj.variant?.values[p.name] ?? p.default;
            const overridden = !Object.is(v, p.default);
            const reset = overridden ? (
              <button
                className="mini-btn"
                title={`Reset ${p.name} to default`}
                onClick={() => resetInstancePropValue(p.name)}
                aria-label={`Reset ${p.name}`}
              >
                <RotateCcw size={12} />
              </button>
            ) : null;
            return p.kind === 'boolean' ? (
              <div className="prop-value-row" key={p.name}>
                <label className="check-row grow">
                  <input
                    type="checkbox"
                    checked={v === true}
                    onChange={(e) => setInstancePropValue(p.name, e.target.checked)}
                  />
                  <span>{p.name}</span>
                </label>
                {reset}
              </div>
            ) : (
              <div className="prop-value-row end" key={p.name}>
                <label className="prop-field full grow">
                  <span className="prop-label">{p.name}</span>
                  <PropTextInput prop={p.name} value={typeof v === 'string' ? v : ''} />
                </label>
                {reset}
              </div>
            );
          })}
        </>
      )}
      {!nested && defs.length > 1 && (
        <label className="prop-field full">
          <span className="prop-label">Swap</span>
          <select
            className="text-input"
            value={compId}
            onChange={(e) => swapSelectedInstance(e.target.value)}
            aria-label="Swap component"
          >
            {defs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!nested &&
        exposed.map((c) => {
          const v = obj.exposedValues?.[c.alias] ?? c.default;
          const overridden = !Object.is(v, c.default);
          const reset = overridden ? (
            <button
              className="mini-btn"
              title={`Reset ${c.alias} to default`}
              onClick={() => resetInstancePropValue(c.alias)}
              aria-label={`Reset ${c.alias}`}
            >
              <RotateCcw size={12} />
            </button>
          ) : null;
          return c.kind === 'boolean' ? (
            <div className="prop-value-row" key={c.alias}>
              <label className="check-row grow">
                <input
                  type="checkbox"
                  checked={v === true}
                  onChange={(e) => setInstancePropValue(c.alias, e.target.checked)}
                />
                <span>{c.label}</span>
              </label>
              {reset}
            </div>
          ) : (
            <div className="prop-value-row end" key={c.alias}>
              <label className="prop-field full grow">
                <span className="prop-label">{c.label}</span>
                <PropTextInput prop={c.alias} value={typeof v === 'string' ? v : ''} />
              </label>
              {reset}
            </div>
          );
        })}
      {nested && (
        <div className="prop-hint">Nested instance — switch and swap from its own source.</div>
      )}
      <button
        className="btn secondary full"
        disabled={!sourceLive}
        onClick={() => gotoComponentSource(compId)}
      >
        <Pen size={14} />
        <span>Go to source</span>
      </button>
      {!nested && (
        <div className="row-2 comp-btn-row">
          <button className="btn secondary" onClick={resetSelectedInstance} title="Drop all overrides back to the source">
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
          <button className="btn secondary" onClick={detachSelectedInstance} title="Turn into plain editable objects">
            <Unlink size={14} />
            <span>Detach</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ComponentSourceSection({ defId }: { defId: string }) {
  const { doc, addVariantProp, deleteVariantProp, bindVariantProp, exposeNestedProp, removeExposedAlias } = useEditor();
  const set = (doc.variantSets ?? []).find((s) => s.variants.includes(defId)) ?? null;
  const def = (doc.components ?? []).find((d) => d.id === defId) ?? null;
  const src = def ? liveSource(doc, def) : null;
  if (!def || !src) return null;
  const layerNames = [...new Set(src.subtree.map((o) => o.name))];
  const nested = src.subtree.filter((o) => o.componentId !== null && o.componentId !== undefined);
  const taken = new Set([...(set?.properties.map((p) => p.name) ?? []), ...Object.keys(def.exposed ?? {})]);
  const aliasOf = (nodeId: string, prop: string): string | null => {
    for (const [a, t] of Object.entries(def.exposed ?? {})) {
      if (t.instance === nodeId && t.prop === prop) return a;
    }
    return null;
  };
  if (!set && nested.length === 0) return null;
  return (
    <div className="prop-section">
      <div className="prop-title">Properties</div>
      {set && (
        <>
          <div className="prop-hint">Boolean drives visibility · text drives characters.</div>
          {set.properties.map((p) => (
            <div className="prop-field full" key={p.name}>
              <span className="prop-label">
                {p.name} <span className="dim small">({p.kind})</span>
              </span>
              <div className="field-row">
                <select
                  className="text-input"
                  value={set.bindings[p.name] ?? ''}
                  onChange={(e) => bindVariantProp(defId, p.name, e.target.value === '' ? null : e.target.value)}
                  aria-label={`Bind ${p.name}`}
                >
                  <option value="">Not bound</option>
                  {layerNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  className="mini-btn danger-hover"
                  title={`Delete property ${p.name}`}
                  onClick={() => deleteVariantProp(defId, p.name)}
                  aria-label={`Delete property ${p.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          <div className="row-2 comp-btn-row">
            <button className="btn secondary" onClick={() => addVariantProp(defId, 'boolean')}>
              <span>+ Boolean</span>
            </button>
            <button className="btn secondary" onClick={() => addVariantProp(defId, 'text')}>
              <span>+ Text</span>
            </button>
          </div>
        </>
      )}
      {nested.length > 0 && (
        <>
          <div className="prop-hint">Expose nested properties to drive them from instances.</div>
          {nested.map((n) => {
            const nset = n.componentId ? setContaining(doc, n.componentId) : null;
            if (!nset || nset.properties.length === 0) return null;
            return (
              <div className="prop-field full" key={n.id}>
                <span className="prop-label">{n.name}</span>
                {nset.properties.map((p) => {
                  const alias = aliasOf(n.id, p.name);
                  const autoAlias = taken.has(p.name) ? `${n.name}.${p.name}` : p.name;
                  const blocked = alias === null && taken.has(autoAlias);
                  return (
                    <label className="check-row" key={p.name} title={blocked ? 'Alias taken' : undefined}>
                      <input
                        type="checkbox"
                        checked={alias !== null}
                        disabled={blocked}
                        onChange={(e) => {
                          if (e.target.checked) exposeNestedProp(defId, n.id, p.name, autoAlias);
                          else if (alias) removeExposedAlias(defId, alias);
                        }}
                      />
                      <span>
                        {p.name} <span className="dim small">({p.kind}{alias ? ` · ${alias}` : ''})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ================= image ================= */

function ImageSection({ obj }: { obj: DesignObject }) {
  const { updateObjects, replaceImage } = useEditor();
  const ids = [obj.id];
  const fileRef = useRef<HTMLInputElement>(null);
  const hasPixels = obj.naturalW > 0 && obj.naturalH > 0;
  const resetSize = () => {
    if (!hasPixels) return;
    const { w, h } = fitImageSize(obj.naturalW, obj.naturalH);
    if (obj.w === w && obj.h === h) return;
    updateObjects(ids, { w, h });
  };
  return (
    <div className="prop-section">
      <div className="prop-title">Image</div>
      <div className="prop-hint">{obj.imageName || 'No file attached'}</div>
      {hasPixels && (
        <div className="prop-hint">
          {obj.naturalW} × {obj.naturalH} px
        </div>
      )}
      <div className="row-2">
        <button className="btn secondary" onClick={() => fileRef.current?.click()}>
          <Upload size={14} />
          <span>Replace…</span>
        </button>
        <button className="btn secondary" disabled={!hasPixels} onClick={resetSize} title="Reset to the imported pixel size">
          <Maximize2 size={14} />
          <span>Natural size</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) replaceImage(obj.id, f);
          e.target.value = '';
        }}
      />
      <div className="prop-hint">Shift + resize keeps proportions.</div>
    </div>
  );
}

/* ================= effects ================= */

function EffectsSection({ obj }: { obj: DesignObject }) {
  const { doc, updateObjects, detachEffectStyle } = useEditor();
  const ids = [obj.id];
  const linkedStyle = obj.effectStyleId
    ? (doc.effectStyles ?? []).find((s) => s.id === obj.effectStyleId) ?? null
    : null;
  const s = obj.shadow;
  const addShadow = () => {
    updateObjects(ids, {
      shadow: { offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.25 },
      effectStyleId: null,
    });
  };
  return (
    <div className="prop-section">
      <div className="prop-title">Effects</div>
      {linkedStyle && (
        <div className="style-link">
          <Link2 size={13} />
          <span>{linkedStyle.name}</span>
          <button
            className="mini-btn"
            title="Detach style (keep shadow)"
            onClick={detachEffectStyle}
            aria-label="Detach effect style"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {s === null || s === undefined ? (
        <button className="btn secondary full" onClick={addShadow}>
          <Plus size={14} />
          <span>Add drop shadow</span>
        </button>
      ) : (
        <>
          <div className="prop-grid-2">
            <NumField label="X" value={s.offsetX} ids={ids} patch={(v) => ({ shadow: { ...s, offsetX: round1(v) }, effectStyleId: null })} />
            <NumField label="Y" value={s.offsetY} ids={ids} patch={(v) => ({ shadow: { ...s, offsetY: round1(v) }, effectStyleId: null })} />
            <NumField label="Blur" value={s.blur} min={0} ids={ids} patch={(v) => ({ shadow: { ...s, blur: Math.max(0, v) }, effectStyleId: null })} />
            <NumField label="Spread" value={s.spread ?? 0} min={0} ids={ids} patch={(v) => ({ shadow: { ...s, spread: Math.max(0, v) }, effectStyleId: null })} />
            <NumField label="Opacity" value={s.opacity} min={0} step={0.05} ids={ids} patch={(v) => ({ shadow: { ...s, opacity: clamp(v, 0, 1) }, effectStyleId: null })} />
          </div>
          <ColorField
            value={s.color}
            ids={ids}
            colorPatch={(color) => ({ shadow: { ...s, color }, effectStyleId: null })}
          />
          <button
            className="btn secondary full"
            onClick={() => updateObjects(ids, { shadow: null, effectStyleId: null })}
          >
            <X size={14} />
            <span>Remove shadow</span>
          </button>
        </>
      )}
    </div>
  );
}

/* ================= text ================= */

function TextSection({ obj }: { obj: DesignObject }) {
  const { doc, updateObjects, transientPatchObjects, endTransient, abortTransient, detachTextStyle } = useEditor();
  const ids = [obj.id];
  const linkedStyle = obj.textStyleId
    ? (doc.textStyles ?? []).find((s) => s.id === obj.textStyleId) ?? null
    : null;
  const aligns: { id: TextAlign; label: string }[] = [
    { id: 'left', label: 'Left' },
    { id: 'center', label: 'Center' },
    { id: 'right', label: 'Right' },
  ];
  return (
    <div className="prop-section">
      <div className="prop-title">Typography</div>
      {linkedStyle && (
        <div className="style-link">
          <Link2 size={13} />
          <span>{linkedStyle.name}</span>
          <button
            className="mini-btn"
            title="Detach style (keep formatting)"
            onClick={detachTextStyle}
            aria-label="Detach text style"
          >
            <X size={13} />
          </button>
        </div>
      )}
      <label className="prop-field full">
        <span className="prop-label">Font</span>
        <select
          className="text-input"
          value={obj.fontFamily}
          onChange={(e) => updateObjects(ids, { fontFamily: e.target.value, textStyleId: null })}
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
        <NumField label="Size" value={obj.fontSize} min={1} ids={ids} patch={(v) => ({ fontSize: Math.max(1, v), textStyleId: null })} />
        <label className="prop-field">
          <span className="prop-label">Weight</span>
          <select
            className="text-input"
            value={obj.fontWeight}
            onChange={(e) => updateObjects(ids, { fontWeight: Number(e.target.value), textStyleId: null })}
            aria-label="Font weight"
          >
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={600}>Semibold</option>
            <option value={700}>Bold</option>
            <option value={800}>Extra bold</option>
          </select>
        </label>
        <NumField label="Line height" value={obj.lineHeight} min={0.5} step={0.05} ids={ids} patch={(v) => ({ lineHeight: clamp(v, 0.5, 4), textStyleId: null })} />
        <div className="prop-field">
          <span className="prop-label">Align</span>
          <div className="seg">
            {aligns.map((a) => (
              <button
                key={a.id}
                className={`seg-btn${obj.textAlign === a.id ? ' active' : ''}`}
                title={a.label}
                onClick={() => updateObjects(ids, { textAlign: a.id, textStyleId: null })}
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
          onChange={(e) => transientPatchObjects(ids, { text: e.target.value })}
          onBlur={() => endTransient()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              abortTransient();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Text content"
        />
      </label>
    </div>
  );
}

/* ================= multi selection ================= */

function MultiProperties({ objs }: { objs: DesignObject[] }) {
  const editor = useEditor();
  const { align, distribute, duplicateSelected, deleteSelected } = editor;
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
          <OpacityField ids={ids} value={avgOpacity} />
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
  ids,
  patch,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  ids: string[];
  patch: (v: number) => ObjectPatch;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const { transientPatchObjects, endTransient, abortTransient } = useEditor();
  const [text, setText] = useState(String(round1(value)));
  const [focused, setFocused] = useState(false);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!focused) setText(String(round1(value)));
  }, [value, focused]);

  const commit = () => {
    const r = resolveNumericCommit(text, value, min, max);
    if (r.action === 'commit' && r.value !== undefined) {
      transientPatchObjects(ids, patch(r.value));
    }
    endTransient();
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
            if (cancelledRef.current) {
              cancelledRef.current = false;
              setText(String(round1(value)));
            } else {
              commit();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : step);
              const r = resolveNumericCommit(String(round1(value + delta)), value, min, max);
              if (r.action === 'commit' && r.value !== undefined) {
                setText(String(r.value));
                transientPatchObjects(ids, patch(r.value));
              }
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              cancelledRef.current = true;
              abortTransient();
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
  ids,
  colorPatch,
  opacityPatch,
}: {
  value: string;
  opacity?: number;
  ids: string[];
  colorPatch: (color: string) => ObjectPatch;
  opacityPatch?: (v: number) => ObjectPatch;
}) {
  const { transientPatchObjects, endTransient, abortTransient } = useEditor();
  const [hex, setHex] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelledRef = useRef(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  useNativePickerEnd(pickerRef);
  useEffect(() => {
    if (!focused) setHex(value);
  }, [value, focused]);

  const commitHex = () => {
    const r = resolveHexCommit(hex, value);
    if (r.action === 'commit' && r.value !== undefined) {
      transientPatchObjects(ids, colorPatch(r.value));
    } else if (r.action === 'clear') {
      transientPatchObjects(ids, colorPatch(''));
    }
    endTransient();
    setHex(value);
  };

  const clearColor = () => {
    if (value === '') return;
    transientPatchObjects(ids, colorPatch(''));
    endTransient();
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
          ref={pickerRef}
          type="color"
          value={isHexColor(value) ? normalizeHex(value, '#111111') : '#111111'}
          onChange={(e) =>
            transientPatchObjects(ids, colorPatch(normalizeHex(e.target.value, '#111111')))
          }
          onBlur={() => endTransient()}
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
          if (cancelledRef.current) {
            cancelledRef.current = false;
            setHex(value);
          } else {
            commitHex();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelledRef.current = true;
            setHex(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Hex color"
      />
      <button
        className={`mini-btn${value === '' ? ' on' : ''}`}
        title="No fill"
        onClick={clearColor}
        aria-pressed={value === ''}
      >
        <Ban size={13} />
      </button>
      {opacity !== undefined && opacityPatch && (
        <label className="opacity-inline" title="Fill opacity">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => transientPatchObjects(ids, opacityPatch(Number(e.target.value) / 100))}
            onBlur={() => endTransient()}
            onPointerUp={() => endTransient()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                abortTransient();
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Fill opacity"
          />
          <span>{Math.round(opacity * 100)}%</span>
        </label>
      )}
    </div>
  );
}

function StopSwatch({
  color,
  ids,
  patch,
}: {
  color: string;
  ids: string[];
  patch: (color: string) => ObjectPatch;
}) {
  const { transientPatchObjects, endTransient } = useEditor();
  const ref = useRef<HTMLInputElement>(null);
  useNativePickerEnd(ref);
  return (
    <label className="swatch-input small" title={color}>
      <span className="swatch-input-color" style={{ background: color }} />
      <input
        ref={ref}
        type="color"
        value={isHexColor(color) ? normalizeHex(color, '#111111') : '#111111'}
        onChange={(e) => transientPatchObjects(ids, patch(normalizeHex(e.target.value, '#111111')))}
        onBlur={() => endTransient()}
        aria-label="Stop color"
      />
    </label>
  );
}

function GradientEditor({ ids, grad }: { ids: string[]; grad: FillGradient }) {
  const { updateObjects, transientPatchObjects, endTransient, abortTransient } = useEditor();
  const withGrad = (g: FillGradient): ObjectPatch => ({ fillGradient: g });
  const setStop = (i: number, stop: GradientStop): ObjectPatch =>
    withGrad({ ...grad, stops: grad.stops.map((s, j) => (j === i ? stop : s)) });

  const addStop = () => {
    if (grad.stops.length >= 8) return;
    const ss = grad.stops;
    let bi = 0;
    let bw = -1;
    for (let i = 0; i < ss.length - 1; i += 1) {
      const w = ss[i + 1].offset - ss[i].offset;
      if (w > bw) {
        bw = w;
        bi = i;
      }
    }
    const at = Math.round(((ss[bi].offset + ss[bi + 1].offset) / 2) * 100) / 100;
    const stops = [...ss.slice(0, bi + 1), { offset: at, color: ss[bi].color }, ...ss.slice(bi + 1)];
    updateObjects(ids, withGrad({ ...grad, stops }));
  };
  const removeStop = (i: number) => {
    if (grad.stops.length <= 2) return;
    updateObjects(ids, withGrad({ ...grad, stops: grad.stops.filter((_, j) => j !== i) }));
  };

  // Document order is the stops' identity: offsets may cross during a drag
  // and renderers clamp them; nothing re-sorts behind the user's back.
  const preview = `linear-gradient(${grad.angle + 90}deg, ${grad.stops
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(', ')})`;
  return (
    <div className="grad-editor">
      <div className="grad-preview" style={{ background: preview }} aria-hidden="true" />
      <NumField
        label="Angle"
        value={grad.angle}
        suffix="°"
        ids={ids}
        patch={(v) => withGrad({ ...grad, angle: round1(v) })}
      />
      {grad.stops.map((s, i) => (
        <div className="stop-row" key={i}>
          <StopSwatch color={s.color} ids={ids} patch={(color) => setStop(i, { ...s, color })} />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.offset * 100)}
            onChange={(e) =>
              transientPatchObjects(ids, setStop(i, { ...s, offset: Number(e.target.value) / 100 }))
            }
            onBlur={() => endTransient()}
            onPointerUp={() => endTransient()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                abortTransient();
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label={`Stop ${i + 1} offset`}
          />
          <span className="stop-pct">{Math.round(s.offset * 100)}%</span>
          <button
            className="mini-btn danger-hover"
            title="Remove stop"
            disabled={grad.stops.length <= 2}
            onClick={() => removeStop(i)}
            aria-label={`Remove stop ${i + 1}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn secondary full" disabled={grad.stops.length >= 8} onClick={addStop}>
        <Plus size={14} />
        <span>Add stop</span>
      </button>
    </div>
  );
}

function OpacityField({ ids, value }: { ids: string[]; value: number }) {
  const { transientPatchObjects, endTransient, abortTransient } = useEditor();
  return (
    <label className="opacity-row">
      <span className="prop-label">Opacity</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => transientPatchObjects(ids, { opacity: Number(e.target.value) / 100 })}
        onBlur={() => endTransient()}
        onPointerUp={() => endTransient()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            abortTransient();
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Layer opacity"
      />
      <span className="opacity-val">{Math.round(value * 100)}%</span>
    </label>
  );
}
