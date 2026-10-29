/**
 * Engine-driven top toolbar: menus, history, zoom, import/export/share, and
 * dialogs. Creation tools live in the floating ToolPalette. Every action
 * operates on the engine document through the store — no legacy TypeScript
 * document state is read or written here.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Download,
  Play,
  Redo2,
  Share2,
  Undo2,
} from 'lucide-react';
import { useEngine } from '../engine/store';
import { downloadFile } from '../utils';
import { downloadBlob, svgToPngBlob } from '../exportPng';
import { validateDoc } from '../storage';
import { Modal } from './ui';

const SHORTCUTS: Array<[string, string]> = [
  ['V H R O P T L F', 'Tools (select, pan, rectangle, ellipse, polygon, text, line, frame)'],
  ['Delete', 'Delete selection'],
  ['Ctrl/⌘ D', 'Duplicate selection'],
  ['Ctrl/⌘ Z / Shift+Z', 'Undo / redo'],
  ['Ctrl/⌘ X C V', 'Cut / copy / paste'],
  ['Ctrl/⌘ A', 'Select all'],
  ['Arrows (Shift)', 'Move 1px (10px)'],
  ['Ctrl/⌘ G / Shift+G', 'Group / ungroup'],
  ['[ ]', 'Send backward / bring forward'],
  ['Ctrl/⌘ + - 0', 'Zoom in / out / 100%'],
  ['Shift+1', 'Zoom to fit'],
  ['Esc', 'Clear selection / close'],
  ['?', 'This list'],
];

export function TopToolbar({
  onPreview,
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
  labOpen,
  onToggleLab,
  shortcutsOpen,
  onToggleShortcuts,
}: {
  onPreview: () => void;
  leftVisible: boolean;
  rightVisible: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  labOpen: boolean;
  onToggleLab: () => void;
  shortcutsOpen: boolean;
  onToggleShortcuts: () => void;
}) {
  const ed = useEngine();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const ready = ed.status === 'ready';
  const hasSel = ed.snapshot.selection.length > 0;

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const pick = (fn: () => void) => () => {
    setOpenMenu(null);
    fn();
  };

  const doExportSvg = () => {
    const svg = ed.exportSvg();
    if (svg) downloadFile('page.svg', svg, 'image/svg+xml');
  };

  const doExportPng = async () => {
    const svg = ed.exportSvg();
    if (!svg) return;
    try {
      const blob = await svgToPngBlob(svg, 2);
      downloadBlob('page.png', blob);
    } catch {
      ed.setNotice('PNG export failed for this page.');
    }
  };

  const doExportUnd = () => {
    const doc = ed.exportUndesignDoc();
    if (doc) downloadFile('document.undesign.json', JSON.stringify(doc, null, 2), 'application/json');
  };

  const doExportEngine = () => {
    const json = ed.exportEngineJson();
    if (json) downloadFile('document.engine.json', json, 'application/json');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      ed.setNotice('Import failed: not valid JSON.');
      return;
    }
    // Engine saves carry numeric page ids; UND docs carry page objects.
    const pages = (parsed as { pages?: unknown }).pages;
    if (Array.isArray(pages) && (pages.length === 0 || typeof pages[0] === 'number')) {
      ed.importEngineJson(text);
      return;
    }
    const und = validateDoc(parsed);
    if (!und) {
      ed.setNotice('Import failed: neither engine JSON nor a valid Undesign document.');
      return;
    }
    setConfirm({
      title: 'Import Undesign document',
      message: `Convert "${und.name}" (${und.pages.length} page(s)) into the current engine document? Unsupported features are recorded, never silently dropped.`,
      action: () => {
        ed.importUndesignDoc(und);
      },
    });
  };

  const onImageFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') ed.placeImageAtCenter(reader.result, f.name);
      else ed.setNotice('Place image failed: could not read the file.');
    };
    reader.onerror = () => ed.setNotice('Place image failed: could not read the file.');
    reader.readAsDataURL(f);
  };

  const menuItem = (label: string, hint: string | null, fn: () => void, disabled = false) => (
    <button key={label} className="menu-item" disabled={disabled} onClick={pick(fn)}>
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );

  return (
    <div className="topbar" ref={barRef}>
      <div className="brand" title="Undesign — engine-driven editor">
        <span className="brand-mark" aria-hidden="true">U</span>
        <span className="brand-name">Undesign</span>
      </div>

      <div className="topbar-menus">
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}>File</button>
          {openMenu === 'file' && (
            <div className="menu-drop" role="menu">
              {menuItem('New document', null, () =>
                setConfirm({ title: 'New document', message: 'Start a blank engine document? The current document stays in local history only as long as this session.', action: ed.newDocument }),
              )}
              {menuItem('Open…', null, () => fileRef.current?.click(), !ready)}
              {menuItem('Place image…', null, () => imageRef.current?.click(), !ready)}
              <div className="menu-sep" />
              {menuItem('Export SVG', null, doExportSvg, !ready)}
              {menuItem('Export PNG', null, () => void doExportPng(), !ready)}
              {menuItem('Export Undesign JSON', null, doExportUnd, !ready)}
              {menuItem('Export engine JSON', null, doExportEngine, !ready)}
              <div className="menu-sep" />
              {menuItem('Migration report…', null, () => setReportOpen(true), ed.migration === null)}
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}>Edit</button>
          {openMenu === 'edit' && (
            <div className="menu-drop" role="menu">
              {menuItem('Undo', 'Ctrl+Z', ed.undo, !ed.canUndo)}
              {menuItem('Redo', 'Ctrl+Shift+Z', ed.redo, !ed.canRedo)}
              <div className="menu-sep" />
              {menuItem('Cut', 'Ctrl+X', ed.cutSelected, !hasSel)}
              {menuItem('Copy', 'Ctrl+C', ed.copySelected, !hasSel)}
              {menuItem('Paste', 'Ctrl+V', ed.pasteAtCenter, !ed.hasClipboard)}
              {menuItem('Duplicate', 'Ctrl+D', ed.duplicateSelected, !hasSel)}
              {menuItem('Delete', 'Del', ed.removeSelected, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Select all', 'Ctrl+A', ed.selectAll, !ready)}
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setOpenMenu(openMenu === 'object' ? null : 'object')}>Object</button>
          {openMenu === 'object' && (
            <div className="menu-drop" role="menu">
              {menuItem('Group', 'Ctrl+G', ed.groupSelected, ed.snapshot.selection.length < 2)}
              {menuItem('Ungroup', 'Ctrl+Shift+G', ed.ungroupSelected, !hasSel)}
              {menuItem('Frame selection', null, () => ed.frameSelected(), !hasSel)}
              {menuItem('Remove frame', null, ed.removeFrameSelected, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Use as mask', null, ed.maskSelected, !hasSel)}
              {menuItem('Release mask', null, ed.releaseMaskSelected, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Union', null, () => ed.booleanSelected('union'), ed.snapshot.selection.length < 2)}
              {menuItem('Subtract', null, () => ed.booleanSelected('subtract'), ed.snapshot.selection.length < 2)}
              {menuItem('Intersect', null, () => ed.booleanSelected('intersect'), ed.snapshot.selection.length < 2)}
              {menuItem('Exclude', null, () => ed.booleanSelected('exclude'), ed.snapshot.selection.length < 2)}
              {menuItem('Flatten', null, ed.flattenSelected, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Swap orientation', null, ed.swapOrientationSelected, !hasSel)}
              {menuItem('Rasterize', null, ed.rasterizeSelected, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Add auto-layout', null, () => ed.layoutAddSelected(), !hasSel)}
              {menuItem('Remove auto-layout', null, ed.layoutRemoveSelected, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Create component', null, ed.createComponentFromSelection, !hasSel)}
              {menuItem('Detach instance', null, ed.detachSelectedInstances, !hasSel)}
              {menuItem('Reset instance', null, ed.resetSelectedInstances, !hasSel)}
              <div className="menu-sep" />
              {menuItem('Insert polygon', null, () => ed.insertShapeAtCenter('polygon'), !ready)}
              {menuItem('Insert star', null, () => ed.insertShapeAtCenter('star'), !ready)}
              {menuItem('Insert arrow', null, () => ed.insertShapeAtCenter('arrow'), !ready)}
              <div className="menu-sep" />
              {menuItem('Bring forward', ']', ed.bringForward, !hasSel)}
              {menuItem('Send backward', '[', ed.sendBackward, !hasSel)}
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}>View</button>
          {openMenu === 'view' && (
            <div className="menu-drop" role="menu">
              {menuItem('Zoom in', 'Ctrl++', ed.zoomIn)}
              {menuItem('Zoom out', 'Ctrl+-', ed.zoomOut)}
              {menuItem('Zoom to 100%', 'Ctrl+0', ed.zoomReset)}
              {menuItem('Zoom to fit', 'Shift+1', ed.zoomFit)}
              <div className="menu-sep" />
              {menuItem(leftVisible ? 'Hide layers panel' : 'Show layers panel', null, onToggleLeft)}
              {menuItem(rightVisible ? 'Hide inspector' : 'Show inspector', null, onToggleRight)}
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}>Help</button>
          {openMenu === 'help' && (
            <div className="menu-drop" role="menu">
              {menuItem('Keyboard shortcuts', '?', onToggleShortcuts)}
              {menuItem('About Undesign', null, () => setAboutOpen(true))}
            </div>
          )}
        </div>
      </div>

      <div className="topbar-tools" role="toolbar" aria-label="History and zoom">
        <button className="tool-btn" data-tip="Undo (Ctrl+Z)" disabled={!ed.canUndo} onClick={ed.undo} aria-label="Undo">
          <Undo2 size={15} />
        </button>
        <button className="tool-btn" data-tip="Redo (Ctrl+Shift+Z)" disabled={!ed.canRedo} onClick={ed.redo} aria-label="Redo">
          <Redo2 size={15} />
        </button>
        <span className="toolbar-sep" />
        <button className="btn ghost zoom-label" data-tip="Zoom to fit (Shift+1)" onClick={ed.zoomFit}>
          {Math.round(ed.viewport.zoom * 100)}%
        </button>
      </div>

      <div className="topbar-right">
        <button
          className={`btn ghost${labOpen ? ' active' : ''}`}
          data-tip="Toggle the WASM engine lab (diagnostic)"
          onClick={onToggleLab}
          aria-pressed={labOpen}
        >
          <Cpu size={14} />
          <span>Engine</span>
        </button>
        <button className="btn ghost" data-tip="Present this page fullscreen (Esc to exit)" onClick={onPreview}>
          <Play size={14} />
          <span>Present</span>
        </button>
        <button className="btn ghost" data-tip="Share the document as portable JSON" onClick={() => setShareOpen(true)}>
          <Share2 size={14} />
          <span>Share</span>
        </button>
        <button className="btn primary" data-tip="Download this page as SVG" onClick={doExportSvg} disabled={!ready}>
          <Download size={14} />
          <span>Export</span>
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onImageFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

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

      {shareOpen && (
        <ShareDialog
          onClose={() => setShareOpen(false)}
          getJson={() => {
            const doc = ed.exportUndesignDoc();
            return doc ? JSON.stringify(doc) : null;
          }}
        />
      )}

      {shortcutsOpen && (
        <Modal title="Keyboard shortcuts" onClose={onToggleShortcuts} width={440}>
          <div className="shortcut-list">
            {SHORTCUTS.map(([keys, what]) => (
              <div className="shortcut-row" key={what}>
                <code>{keys}</code>
                <span>{what}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {aboutOpen && (
        <Modal title="About Undesign" onClose={() => setAboutOpen(false)} width={400}>
          <p className="dialog-text">
            Undesign is a web-based visual design editor. The canvas runs on the FigCraft-derived Rust engine compiled to
            WebAssembly (see README for the upstream revision and licenses).
          </p>
        </Modal>
      )}

      {reportOpen && ed.migration && (
        <Modal title="Migration report" onClose={() => setReportOpen(false)} width={480}>
          <p className="dialog-text">
            {ed.migration.objects} object(s) across {ed.migration.pages} page(s)
            {ed.migration.skipped > 0 ? `, ${ed.migration.skipped} skipped` : ''}.
          </p>
          {ed.migration.warnings.length === 0 ? (
            <p className="dialog-text">No approximations — everything mapped cleanly.</p>
          ) : (
            <pre className="lab-log">
              {ed.migration.warnings.map((w, i) => `${i + 1}. [${w.scope}] ${w.property}: ${w.detail}`).join('\n')}
            </pre>
          )}
        </Modal>
      )}
    </div>
  );
}

function ShareDialog({ onClose, getJson }: { onClose: () => void; getJson: () => string | null }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Modal title="Share document" onClose={onClose} width={400}>
      <p className="dialog-text">Copy the document as portable Undesign JSON. Anyone can re-import it via File → Open.</p>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose}>
          Close
        </button>
        <button
          className="btn primary"
          onClick={() => {
            const json = getJson();
            if (!json) {
              setFailed(true);
              return;
            }
            void navigator.clipboard
              .writeText(json)
              .then(() => setCopied(true))
              .catch(() => setFailed(true));
          }}
        >
          Copy JSON
        </button>
      </div>
      {copied && <p className="dialog-text">Copied to the clipboard.</p>}
      {failed && <p className="dialog-text">Could not access the clipboard in this browser.</p>}
    </Modal>
  );
}
