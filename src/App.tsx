import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { EditorProvider, useEditor } from './store';
import { isFormTarget } from './utils';
import { TopToolbar } from './components/TopToolbar';
import { LeftSidebar } from './components/LeftSidebar';
import { CanvasView } from './components/CanvasView';
import { EngineLab } from './components/EngineLab';
import { PropertiesPanel } from './components/PropertiesPanel';
import { exportPageSvg } from './assets';

export default function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}

function Shell() {
  const [preview, setPreview] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [leftVisible, setLeftVisible] = useState(() => window.innerWidth > 900);
  const [rightVisible, setRightVisible] = useState(() => window.innerWidth > 1100);
  const { notice, dismissNotice } = useEditor();

  return (
    <div className="app">
      <TopToolbar
        onPreview={() => setPreview(true)}
        leftVisible={leftVisible}
        rightVisible={rightVisible}
        onToggleLeft={() => setLeftVisible((v) => !v)}
        onToggleRight={() => setRightVisible((v) => !v)}
        labOpen={labOpen}
        onToggleLab={() => setLabOpen((v) => !v)}
      />
      <div className="workbench">
        {leftVisible && <LeftSidebar />}
        {labOpen ? <EngineLab /> : <CanvasView />}
        {rightVisible && <PropertiesPanel />}
      </div>
      <KeyboardShortcuts previewOpen={preview} closePreview={() => setPreview(false)} />
      {preview && <PreviewOverlay onClose={() => setPreview(false)} />}
      {notice && (
        <div className="notice-toast" role="status">
          <span>{notice}</span>
          <button className="mini-btn" onClick={dismissNotice} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function KeyboardShortcuts({ previewOpen, closePreview }: { previewOpen: boolean; closePreview: () => void }) {
  const editor = useEditor();
  const editorRef = useCallback(() => editor, [editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ed = editorRef();
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = el !== null && isFormTarget(el.tagName, el.isContentEditable);
      const modalOpen = document.querySelector('.modal-overlay') !== null;

      if (e.key === 'Escape') {
        if (previewOpen) {
          closePreview();
          return;
        }
        if (typing || modalOpen) return; // inputs and modals handle their own Escape
        // Dropdown and context menus close themselves; keep the selection.
        if (document.querySelector('.menu-drop, .ctx-menu') !== null) return;
        ed.clearSelection();
        return;
      }
      if (typing || modalOpen || previewOpen) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        ed.undo();
        return;
      }
      if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) {
        e.preventDefault();
        ed.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        ed.duplicateSelected();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        ed.selectAll();
        return;
      }
      if (mod && key === 'c') {
        e.preventDefault();
        ed.copySelected();
        return;
      }
      if (mod && key === 'x') {
        e.preventDefault();
        ed.cutSelected();
        return;
      }
      if (mod && key === 'v') {
        e.preventDefault();
        ed.paste();
        return;
      }
      if (mod && key === 'e') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('undesign:open-export'));
        return;
      }
      if (mod && e.altKey && e.code === 'KeyN') {
        // Ctrl+N is browser-reserved; the confirm dialog owns the action.
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('undesign:new-document'));
        return;
      }
      if (mod && e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        ed.createComponentFromSelected();
        return;
      }
      if (mod && (key === '+' || key === '=')) {
        e.preventDefault();
        ed.zoomIn();
        return;
      }
      if (mod && (key === '-' || key === '_')) {
        e.preventDefault();
        ed.zoomOut();
        return;
      }
      if (mod && key === '0') {
        e.preventDefault();
        ed.zoomReset();
        return;
      }
      if (mod && key === '.') {
        e.preventDefault();
        ed.toggleGrid();
        return;
      }
      if (mod && key === 'g' && !e.shiftKey) {
        e.preventDefault();
        ed.groupSelected();
        return;
      }
      if (mod && key === 'g' && e.shiftKey) {
        e.preventDefault();
        ed.ungroupSelected();
        return;
      }
      if (mod && key === ']') {
        e.preventDefault();
        if (ed.selectedIds.length === 1) ed.reorder(ed.selectedIds[0], 'up');
        return;
      }
      if (mod && key === '[') {
        e.preventDefault();
        if (ed.selectedIds.length === 1) ed.reorder(ed.selectedIds[0], 'down');
        return;
      }
      if (mod) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        ed.deleteSelected();
        return;
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') ed.moveSelected(-step, 0);
        else if (e.key === 'ArrowRight') ed.moveSelected(step, 0);
        else if (e.key === 'ArrowUp') ed.moveSelected(0, -step);
        else if (e.key === 'ArrowDown') ed.moveSelected(0, step);
        return;
      }
      if (e.shiftKey && e.key === '!') {
        // Shift+1 — fit canvas
        window.dispatchEvent(new CustomEvent('undesign:fit'));
        return;
      }
      if (e.shiftKey && e.key === '@') {
        // Shift+2 — fit selection
        window.dispatchEvent(new CustomEvent('undesign:fit-selection'));
        return;
      }
      if (e.key === '?') {
        window.dispatchEvent(new CustomEvent('undesign:open-shortcuts'));
        return;
      }
      const toolKeys: Record<string, 'select' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'line'> = {
        v: 'select',
        h: 'hand',
        f: 'frame',
        r: 'rectangle',
        o: 'ellipse',
        t: 'text',
        l: 'line',
      };
      if (toolKeys[key] && !e.shiftKey) {
        ed.setTool(toolKeys[key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorRef, previewOpen, closePreview]);

  return null;
}

interface PresentScreen {
  pageId: string;
}

function PreviewOverlay({ onClose }: { onClose: () => void }) {
  const { doc, page } = useEditor();
  const [trail, setTrail] = useState<PresentScreen[]>([{ pageId: page.id }]);
  const screen = trail[trail.length - 1];
  const currentPage = doc.pages.find((p) => p.id === screen.pageId) ?? page;
  const [svg, setSvg] = useState('');

  useEffect(() => {
    setSvg(exportPageSvg(currentPage, undefined, { includeIds: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, onClose]);

  const follow = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest?.('[data-undesign-id]');
    const sourceId = el?.getAttribute('data-undesign-id');
    if (!sourceId) return;
    const link = (doc.prototypeLinks ?? []).find((l) => l.sourceId === sourceId);
    if (!link) return;
    const targetPage = doc.pages.find((p) => p.objects.some((o) => o.id === link.targetFrameId));
    if (!targetPage) return;
    setTrail((t) => [...t, { pageId: targetPage.id }]);
  };

  const hoverCursor = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest?.('[data-undesign-id]');
    const sourceId = el?.getAttribute('data-undesign-id');
    const linked = !!sourceId && (doc.prototypeLinks ?? []).some((l) => l.sourceId === sourceId);
    (e.currentTarget as HTMLElement).style.cursor = linked ? 'pointer' : '';
  };

  return (
    <div className="preview-overlay" role="dialog" aria-label="Prototype preview">
      <div className="preview-bar">
        <span>{currentPage.name}</span>
        <span className="dim">
          {trail.length > 1 ? `Step ${trail.length}` : 'Click a linked object to navigate'}
        </span>
        <span className="preview-actions">
          {trail.length > 1 && (
            <button className="btn secondary small" onClick={() => setTrail((t) => t.slice(0, -1))}>
              Back
            </button>
          )}
          <button className="btn secondary small" onClick={onClose} aria-label="Exit preview">
            <X size={14} />
            <span>Exit (Esc)</span>
          </button>
        </span>
      </div>
      <div className="preview-stage" onClick={follow} onMouseMove={hoverCursor}>
        {/* Generated from the live document model — no external content. */}
        <div className="preview-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
