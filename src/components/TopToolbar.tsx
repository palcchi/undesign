import { useEffect, useRef, useState } from 'react';
import {
  Circle,
  Cpu,
  Download,
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Play,
  Redo2,
  Share2,
  Sparkles,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEditor } from '../store';
import type { Tool } from '../types';
import { downloadFile } from '../utils';
import { docImageIds, exportPageSvg } from '../assets';
import { downloadBlob, svgToPngBlob } from '../exportPng';
import {
  aiConfigured,
  generateAiPlan,
  loadAiConfig,
  saveAiConfig,
  summarizeAiPlan,
  validateAiPlan,
} from '../ai';
import type { AiConfig, AiEditOp } from '../ai';
import { validateDoc } from '../storage';
import { Modal, useEnterEscape } from './ui';

const TOOLS: { id: Tool; label: string; shortcut: string; Icon: typeof Square }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 },
  { id: 'hand', label: 'Hand', shortcut: 'H', Icon: Hand },
  { id: 'frame', label: 'Frame', shortcut: 'F', Icon: Frame },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', Icon: Circle },
  { id: 'text', label: 'Text', shortcut: 'T', Icon: Type },
  { id: 'line', label: 'Line', shortcut: 'L', Icon: Minus },
];

interface MenuItem {
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  onSelect?: () => void;
}

export function TopToolbar({
  onPreview,
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
  labOpen,
  onToggleLab,
}: {
  onPreview: () => void;
  leftVisible: boolean;
  rightVisible: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  labOpen: boolean;
  onToggleLab: () => void;
}) {
  const editor = useEditor();
  const {
    doc, selectedIds, selected, tool, setTool, viewport, canUndo, canRedo,
    undo, redo, zoomIn, zoomOut, zoomReset, zoomTo, newBlankDoc, resetSample,
    replaceDoc, copySelected, cutSelected, paste, hasClipboard, duplicateSelected,
    deleteSelected, selectAll, reorder, align, distribute, toggleGrid, gridVisible,
    snapObjects, snapGrid, toggleSnapObjects, toggleSnapGrid,
    groupSelected, ungroupSelected, importImageFiles,
  } = editor;

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(doc.name);
  const [dialog, setDialog] = useState<'export' | 'share' | 'shortcuts' | 'about' | 'ai' | null>(null);
  const [zoomMenu, setZoomMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onExport = () => setDialog('export');
    const onShortcuts = () => setDialog('shortcuts');
    const onNew = () => setConfirm({ title: 'New document', message: 'Start a blank document? Unsaved changes are kept in the undo history of this session only until you edit.', action: newBlankDoc });
    window.addEventListener('undesign:open-export', onExport);
    window.addEventListener('undesign:open-shortcuts', onShortcuts);
    window.addEventListener('undesign:new-document', onNew);
    return () => {
      window.removeEventListener('undesign:open-export', onExport);
      window.removeEventListener('undesign:open-shortcuts', onShortcuts);
      window.removeEventListener('undesign:new-document', onNew);
    };
  }, [newBlankDoc]);

  useEffect(() => {
    if (!openMenu && !zoomMenu) return;
    const close = () => {
      setOpenMenu(null);
      setZoomMenu(false);
    };
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    // Escape dismisses the dropdown; the App-level handler keeps the
    // selection when a menu is open, so this only closes the menu.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu, zoomMenu]);

  const showToast = (msg: string) => setToast(msg);

  const commitName = () => {
    editor.setDocName(nameDraft);
    setEditingName(false);
  };
  const nameKeys = useEnterEscape(commitName, () => {
    setNameDraft(doc.name);
    setEditingName(false);
  });

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = validateDoc(JSON.parse(String(reader.result)) as unknown);
        if (!parsed) {
          showToast('That file is not a valid Undesign document.');
          return;
        }
        replaceDoc(parsed);
        showToast(`Imported “${parsed.name}”.`);
      } catch {
        showToast('Could not read that file.');
      }
    };
    reader.readAsText(file);
  };

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New document', shortcut: 'Ctrl+Alt+N', onSelect: () => setConfirm({ title: 'New document', message: 'Start a blank document? Unsaved changes are kept in the undo history of this session only until you edit.', action: newBlankDoc }) },
      { label: 'Restore sample document', onSelect: () => setConfirm({ title: 'Restore sample', message: 'Replace the current document with the original sample?', action: resetSample }) },
      { divider: true },
      { label: 'Export…', shortcut: 'Ctrl+E', onSelect: () => setDialog('export') },
      {
        label: 'Copy document JSON', onSelect: () => {
          navigator.clipboard?.writeText(JSON.stringify(doc)).then(
            () => showToast('Document JSON copied to clipboard.'),
            () => showToast('Clipboard unavailable in this browser.'),
          );
        },
      },
      { label: 'Import JSON…', onSelect: () => fileRef.current?.click() },
      { label: 'Import image…', onSelect: () => imgRef.current?.click() },
      { divider: true },
      { label: 'Rename document', onSelect: () => { setNameDraft(doc.name); setEditingName(true); } },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, onSelect: undo },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !canRedo, onSelect: redo },
      { divider: true },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: selectedIds.length === 0, onSelect: cutSelected },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: selectedIds.length === 0, onSelect: copySelected },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !hasClipboard, onSelect: paste },
      { divider: true },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: selectedIds.length === 0, onSelect: duplicateSelected },
      { label: 'Delete', shortcut: 'Del', disabled: selectedIds.length === 0, onSelect: deleteSelected },
      { label: 'Select all', shortcut: 'Ctrl+A', onSelect: selectAll },
    ],
    View: [
      { label: 'Zoom in', shortcut: 'Ctrl++', onSelect: zoomIn },
      { label: 'Zoom out', shortcut: 'Ctrl+−', onSelect: zoomOut },
      { label: 'Reset to 100%', shortcut: 'Ctrl+0', onSelect: zoomReset },
      { label: 'Fit canvas', shortcut: 'Shift+1', onSelect: () => window.dispatchEvent(new CustomEvent('undesign:fit')) },
      { label: 'Fit selection', shortcut: 'Shift+2', disabled: selectedIds.length === 0, onSelect: () => window.dispatchEvent(new CustomEvent('undesign:fit-selection')) },
      { divider: true },
      { label: gridVisible ? 'Hide grid' : 'Show grid', shortcut: 'Ctrl+.', onSelect: toggleGrid },
      { label: snapObjects ? 'Disable object snapping' : 'Enable object snapping', onSelect: toggleSnapObjects },
      { label: snapGrid ? 'Disable grid snapping' : 'Enable grid snapping', onSelect: toggleSnapGrid },
      { label: leftVisible ? 'Hide left sidebar' : 'Show left sidebar', onSelect: onToggleLeft },
      { label: rightVisible ? 'Hide right sidebar' : 'Show right sidebar', onSelect: onToggleRight },
    ],
    Arrange: [
      { label: 'Bring forward', shortcut: 'Ctrl+]', disabled: selectedIds.length !== 1, onSelect: () => reorder(selectedIds[0], 'up') },
      { label: 'Send backward', shortcut: 'Ctrl+[', disabled: selectedIds.length !== 1, onSelect: () => reorder(selectedIds[0], 'down') },
      { label: 'Bring to front', disabled: selectedIds.length !== 1, onSelect: () => reorder(selectedIds[0], 'top') },
      { label: 'Send to back', disabled: selectedIds.length !== 1, onSelect: () => reorder(selectedIds[0], 'bottom') },
      { divider: true },
      { label: 'Align left', disabled: selectedIds.length < 2, onSelect: () => align('left') },
      { label: 'Align center', disabled: selectedIds.length < 2, onSelect: () => align('centerX') },
      { label: 'Align right', disabled: selectedIds.length < 2, onSelect: () => align('right') },
      { label: 'Align top', disabled: selectedIds.length < 2, onSelect: () => align('top') },
      { label: 'Align middle', disabled: selectedIds.length < 2, onSelect: () => align('centerY') },
      { label: 'Align bottom', disabled: selectedIds.length < 2, onSelect: () => align('bottom') },
      { divider: true },
      { label: 'Distribute horizontally', disabled: selectedIds.length < 3, onSelect: () => distribute('horizontal') },
      { label: 'Distribute vertically', disabled: selectedIds.length < 3, onSelect: () => distribute('vertical') },
      { divider: true },
      { label: 'Group selection', shortcut: 'Ctrl+G', disabled: selectedIds.length === 0, onSelect: groupSelected },
      { label: 'Ungroup selection', shortcut: 'Ctrl+Shift+G', disabled: !selected.some((o) => o.type === 'frame'), onSelect: ungroupSelected },
    ],
    Help: [
      { label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => setDialog('shortcuts') },
      { label: 'About Undesign', onSelect: () => setDialog('about') },
    ],
  };

  return (
    <div ref={barRef} className="topbar">
      <div className="topbar-left">
        <div className="brand" title="Undesign">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="1" width="20" height="20" rx="5" fill="#111111" />
            <rect x="6" y="6" width="10" height="10" rx="1.5" fill="none" stroke="#fff" strokeWidth="2" />
            <circle cx="15.5" cy="6.5" r="2.4" fill="#FF4D00" />
          </svg>
          <span className="brand-name">Undesign</span>
        </div>
        <nav className="menus" aria-label="Main menu">
          {Object.keys(menus).map((name) => (
            <div key={name} className="menu-wrap">
              <button
                className={`menu-btn${openMenu === name ? ' open' : ''}`}
                onClick={() => setOpenMenu(openMenu === name ? null : name)}
                onPointerEnter={() => openMenu && setOpenMenu(name)}
                aria-haspopup="menu"
                aria-expanded={openMenu === name}
              >
                {name}
              </button>
              {openMenu === name && (
                <div className="menu-drop" role="menu">
                  {menus[name].map((item, i) =>
                    item.divider ? (
                      <div key={i} className="menu-divider" />
                    ) : (
                      <button
                        key={i}
                        className="menu-item"
                        disabled={item.disabled}
                        onClick={() => {
                          setOpenMenu(null);
                          item.onSelect?.();
                        }}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="doc-name" title="Click to rename">
          {editingName ? (
            <input
              className="doc-name-input"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              {...nameKeys}
              onFocus={(e) => e.target.select()}
              aria-label="Document name"
            />
          ) : (
            <button
              className="doc-name-btn"
              onClick={() => {
                setNameDraft(doc.name);
                setEditingName(true);
              }}
            >
              {doc.name}
            </button>
          )}
        </div>
      </div>

      <div className="topbar-center">
        <div className="tool-group" role="toolbar" aria-label="History">
          <button className="icon-btn" data-tip="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <Undo2 size={16} />
          </button>
          <button className="icon-btn" data-tip="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <Redo2 size={16} />
          </button>
        </div>
        <div className="tool-sep" />
        <div className="tool-group" role="toolbar" aria-label="Tools">
          {TOOLS.map(({ id, label, shortcut, Icon }) => (
            <button
              key={id}
              className={`icon-btn${tool === id ? ' active' : ''}`}
              data-tip={`${label} (${shortcut})`}
              onClick={() => setTool(id)}
              aria-label={label}
              aria-pressed={tool === id}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <div className="tool-sep" />
        <div className="tool-group" role="toolbar" aria-label="Zoom">
          <button className="icon-btn" data-tip="Zoom out (Ctrl+−)" onClick={zoomOut} aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <div className="menu-wrap">
            <button
              className="zoom-label"
              data-tip="Zoom options"
              onClick={() => setZoomMenu(!zoomMenu)}
              aria-haspopup="menu"
              aria-expanded={zoomMenu}
            >
              {Math.round(viewport.zoom * 100)}%
            </button>
            {zoomMenu && (
              <div className="menu-drop zoom-drop" role="menu">
                {[25, 50, 100, 200, 400].map((z) => (
                  <button
                    key={z}
                    className="menu-item"
                    onClick={() => {
                      zoomTo(z / 100);
                      setZoomMenu(false);
                    }}
                  >
                    <span>{z}%</span>
                  </button>
                ))}
                <div className="menu-divider" />
                <button
                  className="menu-item"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('undesign:fit'));
                    setZoomMenu(false);
                  }}
                >
                  <span>Fit canvas</span>
                  <span className="menu-shortcut">Shift+1</span>
                </button>
                <button
                  className="menu-item"
                  disabled={selectedIds.length === 0}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('undesign:fit-selection'));
                    setZoomMenu(false);
                  }}
                >
                  <span>Fit selection</span>
                  <span className="menu-shortcut">Shift+2</span>
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    zoomReset();
                    setZoomMenu(false);
                  }}
                >
                  <span>Reset to 100%</span>
                  <span className="menu-shortcut">Ctrl+0</span>
                </button>
              </div>
            )}
          </div>
          <button className="icon-btn" data-tip="Zoom in (Ctrl++)" onClick={zoomIn} aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className={`btn ghost${labOpen ? ' active' : ''}`}
          data-tip="Toggle the WASM engine lab"
          onClick={onToggleLab}
          aria-pressed={labOpen}
        >
          <Cpu size={14} />
          <span>Engine</span>
        </button>
        <button className="btn ghost" data-tip="Present this page fullscreen (Esc to exit)" onClick={onPreview}>
          <Play size={14} />
          <span>Preview</span>
        </button>
        <button className="btn ghost" data-tip="Generate editable objects from a text brief" onClick={() => setDialog('ai')}>
          <Sparkles size={14} />
          <span>AI</span>
        </button>
        <button className="btn secondary" data-tip="Share via link or portable JSON" onClick={() => setDialog('share')}>
          <Share2 size={14} />
          <span>Share</span>
        </button>
        <button className="btn primary" data-tip="Export page or selection (Ctrl+E)" onClick={() => setDialog('export')}>
          <Download size={14} />
          <span>Export</span>
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = '';
        }}
      />

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

      {dialog === 'ai' && <AiDialog onClose={() => setDialog(null)} notify={showToast} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} notify={showToast} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} notify={showToast} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && (
        <Modal title="About Undesign" onClose={() => setDialog(null)}>
          <p className="dialog-text">
            <strong>Undesign 0.1.0</strong> — a web-based visual design editor.
          </p>
          <p className="dialog-text dim">
            This milestone covers the core editing workflow: pages, frames, shapes, text,
            layers, properties, and SVG/JSON export. AI generation, accounts, and
            collaboration are intentionally out of scope and the architecture leaves room
            for them.
          </p>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)} width={380}>
          <p className="dialog-text">{confirm.message}</p>
          <div className="dialog-actions">
            <button className="btn secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AiDialog({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const { selected, applyAiOps } = useEditor();
  const [cfg, setCfg] = useState<AiConfig>(() => loadAiConfig());
  const [brief, setBrief] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy' | 'preview'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<AiEditOp[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  const ready = aiConfigured(cfg);

  const generate = () => {
    if (!ready || brief.trim() === '' || phase === 'busy') return;
    saveAiConfig(cfg);
    setError(null);
    setPlan(null);
    setPhase('busy');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = window.setTimeout(() => ctrl.abort(), 60000);
    const summary =
      selected.length === 0
        ? 'none'
        : selected.map((o) => `${o.type} “${o.name}”`).join(', ');
    generateAiPlan(cfg, brief.trim(), summary, ctrl.signal).then(
      (raw) => {
        window.clearTimeout(timer);
        const checked = validateAiPlan(raw);
        if (!checked.ok) {
          setPhase('idle');
          setError(`The plan failed validation and was not applied: ${checked.error}`);
          return;
        }
        setPlan(checked.ops);
        setPhase('preview');
      },
      (e: Error) => {
        window.clearTimeout(timer);
        setPhase('idle');
        setError(e.message);
      },
    );
  };

  const apply = () => {
    if (!plan) return;
    applyAiOps(plan);
    notify('AI plan applied — Undo reverts it in one step.');
    onClose();
  };

  const field = (key: keyof AiConfig, label: string, placeholder: string, secret = false) => (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <input
        className="text-input"
        type={secret ? 'password' : 'text'}
        value={cfg[key]}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setCfg({ ...cfg, [key]: e.target.value })}
        aria-label={label}
      />
    </div>
  );

  return (
    <Modal title="AI design assistant" onClose={onClose} width={460}>
      {!ready && (
        <p className="dialog-text dim">
          No provider configured. Enter an OpenAI-compatible endpoint, model, and API key — the key
          stays in this tab’s session storage and is never saved into the document.
        </p>
      )}
      {field('baseUrl', 'Endpoint', 'https://api.openai.com/v1')}
      {field('model', 'Model', 'gpt-4o-mini')}
      {field('apiKey', 'API key', 'sk-…', true)}
      <div className="field-row">
        <span className="field-label">Brief</span>
        <textarea
          className="text-input"
          rows={3}
          value={brief}
          placeholder="A hero card: cream frame, headline text, and a coral button…"
          onChange={(e) => setBrief(e.target.value)}
          aria-label="Design brief"
        />
      </div>
      {phase === 'preview' && plan && (
        <p className="dialog-text">
          Plan ready: {summarizeAiPlan(plan)}. New objects land at the canvas center as editable
          shapes and text — nothing is applied until you confirm.
        </p>
      )}
      {error && <p className="dialog-text error">{error}</p>}
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          {phase === 'preview' ? 'Discard' : 'Close'}
        </button>
        {phase === 'preview' ? (
          <button className="btn primary" onClick={apply}>
            <Sparkles size={14} />
            <span>Apply plan</span>
          </button>
        ) : phase === 'busy' ? (
          <button className="btn secondary" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={generate}
            disabled={!ready || brief.trim() === ''}
            title={!ready ? 'Configure the endpoint, model, and API key first' : undefined}
          >
            <Sparkles size={14} />
            <span>Generate</span>
          </button>
        )}
      </div>
    </Modal>
  );
}

function ExportDialog({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const { doc, page, selectedIds } = useEditor();
  const [format, setFormat] = useState<'svg' | 'png' | 'json'>('svg');
  const [scope, setScope] = useState<'page' | 'selection'>('page');
  const [scale, setScale] = useState<1 | 2 | 3>(2);
  const [busy, setBusy] = useState(false);

  const doExport = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      downloadFile(`${doc.name}-${stamp}.json`, JSON.stringify(doc, null, 2), 'application/json');
      notify('Document JSON downloaded.');
      onClose();
      return;
    }
    if (format === 'svg') {
      const ids = scope === 'selection' ? selectedIds : undefined;
      const svg = exportPageSvg(page, ids);
      const name = scope === 'selection' ? `${page.name}-selection` : page.name;
      downloadFile(`${name}-${stamp}.svg`, svg, 'image/svg+xml');
      notify('SVG downloaded.');
      onClose();
      return;
    }
    setBusy(true);
    const ids = scope === 'selection' ? selectedIds : undefined;
    const name = scope === 'selection' ? `${page.name}-selection` : page.name;
    svgToPngBlob(exportPageSvg(page, ids), scale).then(
      (blob) => {
        downloadBlob(`${name}-${stamp}@${scale}x.png`, blob);
        notify(`PNG downloaded at ${scale}x.`);
        onClose();
      },
      (e: Error) => {
        setBusy(false);
        notify(e.message || 'PNG export failed.');
      },
    );
  };

  const raster = format !== 'json';

  return (
    <Modal title="Export" onClose={onClose} width={400}>
      <div className="field-row">
        <span className="field-label">Format</span>
        <div className="seg">
          <button className={`seg-btn${format === 'svg' ? ' active' : ''}`} onClick={() => setFormat('svg')}>
            SVG
          </button>
          <button className={`seg-btn${format === 'png' ? ' active' : ''}`} onClick={() => setFormat('png')}>
            PNG
          </button>
          <button className={`seg-btn${format === 'json' ? ' active' : ''}`} onClick={() => setFormat('json')}>
            JSON
          </button>
        </div>
      </div>
      {raster && (
        <div className="field-row">
          <span className="field-label">Scope</span>
          <div className="seg">
            <button className={`seg-btn${scope === 'page' ? ' active' : ''}`} onClick={() => setScope('page')}>
              This page
            </button>
            <button
              className={`seg-btn${scope === 'selection' ? ' active' : ''}`}
              onClick={() => setScope('selection')}
              disabled={selectedIds.length === 0}
              title={selectedIds.length === 0 ? 'Select objects on the canvas first' : undefined}
            >
              Selection
            </button>
          </div>
        </div>
      )}
      {format === 'png' && (
        <div className="field-row">
          <span className="field-label">Scale</span>
          <div className="seg">
            {([1, 2, 3] as const).map((s) => (
              <button
                key={s}
                className={`seg-btn${scale === s ? ' active' : ''}`}
                onClick={() => setScale(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="dialog-text dim">
        {format === 'svg'
          ? 'Vector SVG of the current page — opens in any browser or design tool.'
          : format === 'png'
            ? 'Raster PNG with a transparent background, rendered from the same vector output.'
            : 'Full portable document. Re-import it later with File → Import JSON.'}
      </p>
      {docImageIds(doc).length > 0 && format !== 'json' && (
        <p className="dialog-text dim">
          Imported images embed from this browser session; missing assets export as placeholders.
        </p>
      )}
      {docImageIds(doc).length > 0 && format === 'json' && (
        <p className="dialog-text dim">
          Image pixels stay in this browser’s local asset store — JSON carries references only.
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={doExport} disabled={busy}>
          <Download size={14} />
          <span>{busy ? 'Rendering…' : 'Download'}</span>
        </button>
      </div>
    </Modal>
  );
}

function ShareDialog({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const { doc } = useEditor();
  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(ok);
    } catch {
      notify('Clipboard unavailable in this browser.');
    }
  };
  return (
    <Modal title="Share" onClose={onClose} width={420}>
      <p className="dialog-text dim">
        Cloud collaboration is not part of this milestone. Share this design by sending its
        portable JSON — anyone can restore it with File → Import JSON.
      </p>
      <div className="dialog-actions column">
        <button className="btn secondary full" onClick={() => copy(window.location.href, 'App link copied.')}>
          Copy app link
        </button>
        <button
          className="btn secondary full"
          onClick={() => copy(JSON.stringify(doc), 'Document JSON copied.')}
        >
          Copy “{doc.name}” as JSON
        </button>
        <button
          className="btn primary full"
          onClick={() => {
            downloadFile(`${doc.name}.json`, JSON.stringify(doc, null, 2), 'application/json');
            notify('Document JSON downloaded.');
            onClose();
          }}
        >
          <Download size={14} />
          <span>Download .json</span>
        </button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['V / H / F / R / O / T / L', 'Select, hand, frame, rectangle, ellipse, text, line'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'],
  ['Ctrl+D', 'Duplicate selection'],
  ['Delete / Backspace', 'Delete selection'],
  ['Ctrl+A', 'Select all on page'],
  ['Arrow keys', 'Nudge 1px (Shift: 10px)'],
  ['Ctrl+E', 'Export'],
  ['Ctrl+Alt+N', 'New document (with confirmation)'],
  ['Ctrl++ / Ctrl+− / Ctrl+0', 'Zoom in / out / reset'],
  ['Shift+1', 'Fit canvas'],
  ['Shift+2', 'Fit selection'],
  ['Ctrl+.', 'Toggle grid'],
  ['Ctrl+] / Ctrl+[', 'Bring forward / send backward'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup selection'],
  ['Ctrl+Alt+K', 'Create component from selection'],
  ['Space + drag', 'Pan canvas'],
  ['Double-click text', 'Edit text content'],
  ['Esc', 'Deselect / cancel edit / close dialog'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={480}>
      <div className="shortcut-list">
        {SHORTCUTS.map(([keys, desc]) => (
          <div key={keys} className="shortcut-row">
            <span className="shortcut-keys">{keys}</span>
            <span className="shortcut-desc">{desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
